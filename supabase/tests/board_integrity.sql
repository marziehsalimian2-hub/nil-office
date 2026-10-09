-- =============================================================================
-- NIL Office — Board Secretariat (migrations 0144-0149) integrity + security tests.
-- Run by hand in the Supabase SQL editor AFTER migration 0149, with at least one active ADMIN profile.
-- ONE transaction, ROLLED BACK at the end. SYNTHETIC fixtures only (members «آزمون …», meetings in year 2099).
-- The script temporarily re-roles the first ADMIN profile (rolled back) — do NOT run it while that admin is actively using the app.
-- Success = the statement finishes with no error ("Success. No rows returned" in the Supabase editor).
--
-- Covers: grants (anon nothing, audit read-only, service_role granted, internal helpers not callable), RLS per tier (none / VIEW / CREATE /
-- APPROVE / ADMIN), approval only through the RPC, every completeness check, continuous numbering from the paper baseline, resolution
-- numbers in agenda order, the suggested next meeting, the snapshot, the post-approval lock (even for the table owner) with follow_status as
-- the only mutable column, FK reset of next_meeting_id, previous open resolutions in the next snapshot, append-only audit, the
-- self-escalation freeze, NIL Verify (gates + minimal public snapshot), storage + attachments confidentiality, Factory Reset manifest.
-- =============================================================================
begin;

create function pg_temp.persona(p_user uuid, p_role text, p_board text default null) returns void
language plpgsql as $$
begin
  execute 'reset role';
  update public.profiles set role = p_role::app_role, board_role = p_board::board_role, is_active = true where id = p_user;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  execute 'set role authenticated';
end $$;

create function pg_temp.owner() returns void
language plpgsql as $$
begin
  execute 'reset role';
end $$;

create function pg_temp.expect_err(p_sql text, p_code text) returns void
language plpgsql as $$
declare m text;
begin
  begin execute p_sql;
  exception when others then
    get stacked diagnostics m = message_text;
    if position(p_code in m) = 0 then raise exception 'FAIL: expected %, got: %', p_code, m; end if;
    return;
  end;
  raise exception 'FAIL: no error raised, expected % (sql: %)', p_code, left(p_sql, 120);
end $$;

create function pg_temp.chk(p_label text, p_ok boolean) returns void
language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL(%)', p_label; end if;
end $$;

do $$
declare
  v_admin uuid; v_chair uuid; v_sec uuid; v_ext uuid; v_inactive uuid; m1 uuid; m2 uuid; v_next uuid;
  a1 uuid; a2 uuid; r1 uuid; r2 uuid; r3 uuid; v_res jsonb; v_snap jsonb; v_cnt integer; v_txt text; v_ver jsonb; v_vid uuid; v_base integer;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active order by created_at limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;
  -- the numbering baseline must be above any real meeting number so the expected numbers below are deterministic
  select greatest(coalesce((select max(meeting_number) from public.board_meetings), 0), (select last_manual_meeting_number from public.board_settings where id = 1)) + 1000
    into v_base;

  -- 1) grants ---------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.chk('anon has nothing on board tables', not has_table_privilege('anon', 'public.board_meetings', 'select')
    and not has_table_privilege('anon', 'public.board_resolutions', 'select') and not has_table_privilege('anon', 'public.board_audit_log', 'select'));
  perform pg_temp.chk('audit is read-only for authenticated', has_table_privilege('authenticated', 'public.board_audit_log', 'select')
    and not has_table_privilege('authenticated', 'public.board_audit_log', 'insert')
    and not has_table_privilege('authenticated', 'public.board_audit_log', 'update') and not has_table_privilege('authenticated', 'public.board_audit_log', 'delete'));
  perform pg_temp.chk('service_role granted on every board table',
    has_table_privilege('service_role', 'public.board_meetings', 'select,insert,update,delete') and has_table_privilege('service_role', 'public.board_members', 'select,insert,update,delete')
    and has_table_privilege('service_role', 'public.board_agenda_items', 'select,insert,update,delete') and has_table_privilege('service_role', 'public.board_attendance', 'select,insert,update,delete')
    and has_table_privilege('service_role', 'public.board_resolutions', 'select,insert,update,delete') and has_table_privilege('service_role', 'public.board_settings', 'select,update')
    and has_table_privilege('service_role', 'public.board_audit_log', 'select,insert'));
  perform pg_temp.chk('internal helpers are not callable by authenticated',
    not has_function_privilege('authenticated', 'public._board_log(uuid,text,uuid,text,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public._board_minutes_snapshot(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.board_approve_meeting(uuid,timestamptz)', 'execute')
    and not has_function_privilege('anon', 'public.board_approve_meeting(uuid,timestamptz)', 'execute'));
  perform pg_temp.chk('RLS on every board table', (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('board_settings','board_members','board_meetings','board_agenda_items','board_attendance','board_resolutions','board_audit_log')));

  -- 2) fixtures as CREATE --------------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'CREATE');
  insert into public.board_members (full_name, position_title, kind, sort_order, created_by) values ('آزمون رئیس', 'رئیس هیئت‌مدیره', 'INTERNAL', 1, v_admin) returning id into v_chair;
  insert into public.board_members (full_name, position_title, kind, sort_order, created_by) values ('آزمون دبیر', 'دبیر', 'INTERNAL', 2, v_admin) returning id into v_sec;
  insert into public.board_members (full_name, position_title, kind, sort_order, created_by) values ('آزمون بیرونی', 'عضو غیرموظف', 'EXTERNAL', 3, v_admin) returning id into v_ext;
  insert into public.board_members (full_name, kind, is_active, sort_order, created_by) values ('آزمون غیرفعال', 'INTERNAL', false, 9, v_admin) returning id into v_inactive;
  perform pg_temp.expect_err(format($q$insert into public.board_members (full_name, kind, profile_id, created_by) values ('آزمون بیرونی دو', 'EXTERNAL', %L, %L)$q$, v_admin, v_admin),
    'ck_board_member_external_no_profile');
  perform pg_temp.expect_err(format($q$insert into public.board_members (full_name, kind, created_by) values ('آزمون جعلی', 'INTERNAL', %L)$q$, gen_random_uuid()), 'row-level security');

  -- real (non-test) active members would also need an attendance row; deactivate them for this transaction (rolled back)
  perform pg_temp.owner();
  update public.board_members set is_active = false where id not in (v_chair, v_sec, v_ext, v_inactive) and is_active;
  perform pg_temp.persona(v_admin, 'USER', 'CREATE');

  insert into public.board_meetings (scheduled_at, location, created_by) values ('2099-03-01 09:00:00+03:30', 'آزمون دفتر', v_admin) returning id into m1;
  perform pg_temp.expect_err(format($q$insert into public.board_meetings (scheduled_at, location, created_by, status) values (now(), 'x', %L, 'APPROVED')$q$, v_admin), 'BOARD_APPROVAL_RPC_ONLY');
  perform pg_temp.expect_err(format($q$update public.board_meetings set status = 'APPROVED' where id = %L$q$, m1), 'BOARD_APPROVAL_RPC_ONLY');
  perform pg_temp.expect_err(format($q$update public.board_meetings set meeting_number = 1 where id = %L$q$, m1), 'BOARD_APPROVAL_RPC_ONLY');

  insert into public.board_agenda_items (meeting_id, position, title, discussion) values (m1, 2, 'آزمون بند دوم', null) returning id into a2;
  insert into public.board_agenda_items (meeting_id, position, title, discussion) values (m1, 1, 'آزمون بند اول', 'بحث شد') returning id into a1;
  -- resolutions: r1 under agenda 2, r2 under agenda 1, r3 without agenda (non-action) -> numbering order must be r2, r1, r3
  insert into public.board_resolutions (meeting_id, agenda_item_id, position, text, owner_member_id, due_date, created_by)
    values (m1, a2, 1, 'آزمون مصوبه بند دوم', v_sec, '2099-03-20', v_admin) returning id into r1;
  insert into public.board_resolutions (meeting_id, agenda_item_id, position, text, owner_member_id, due_date, created_by)
    values (m1, a1, 1, 'آزمون مصوبه بند اول', v_ext, '2099-03-10', v_admin) returning id into r2;
  insert into public.board_resolutions (meeting_id, position, text, requires_action, owner_member_id, due_date, created_by)
    values (m1, 9, 'آزمون تصویب گزارش', false, v_sec, '2099-04-01', v_admin) returning id into r3;
  perform pg_temp.chk('non-action resolution normalised', (select follow_status = 'NO_ACTION' and owner_member_id is null and due_date is null from public.board_resolutions where id = r3));
  perform pg_temp.expect_err(format($q$insert into public.board_resolutions (meeting_id, position, text, created_by) values (%L, 1, 'بی‌مسئول', %L)$q$, m1, v_admin), 'ck_board_resolution_action');
  perform pg_temp.expect_err(format($q$insert into public.board_resolutions (meeting_id, position, text, requires_action, resolution_number, created_by) values (%L, 1, 'x', false, '1-1', %L)$q$, m1, v_admin), 'BOARD_APPROVAL_RPC_ONLY');
  perform pg_temp.expect_err(format($q$update public.board_resolutions set resolution_number = '5-1' where id = %L$q$, r1), 'BOARD_APPROVAL_RPC_ONLY');
  perform pg_temp.expect_err(format($q$select public.board_approve_meeting(%L)$q$, m1), 'NOT_AUTHORIZED');

  -- 3) no access / VIEW ----------------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null);
  perform pg_temp.chk('no access: nothing visible', (select count(*) from public.board_meetings) = 0 and (select count(*) from public.board_members) = 0
    and (select count(*) from public.board_resolutions) = 0 and (select count(*) from public.board_audit_log) = 0);
  perform pg_temp.expect_err(format($q$insert into public.board_meetings (scheduled_at, location, created_by) values (now(), 'x', %L)$q$, v_admin), 'row-level security');
  perform pg_temp.persona(v_admin, 'USER', 'VIEW');
  perform pg_temp.chk('VIEW reads', (select count(*) from public.board_meetings where id = m1) = 1 and (select count(*) from public.board_resolutions where meeting_id = m1) = 3);
  update public.board_meetings set location = 'تغییر' where id = m1;
  get diagnostics v_cnt = row_count;
  perform pg_temp.chk('VIEW cannot update', v_cnt = 0);
  perform pg_temp.expect_err(format($q$insert into public.board_agenda_items (meeting_id, title) values (%L, 'x')$q$, m1), 'row-level security');

  -- 4) self-escalation freeze ----------------------------------------------------------------------------------------------------------
  perform pg_temp.expect_err(format($q$update public.profiles set board_role = 'ADMIN' where id = %L$q$, v_admin), 'row-level security');

  -- 5) approval: every completeness check, then success ---------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'ADMIN');
  update public.board_settings set last_manual_meeting_number = v_base where id = 1;
  perform pg_temp.persona(v_admin, 'USER', 'APPROVE');
  perform pg_temp.expect_err(format($q$select public.board_approve_meeting(%L)$q$, m1), 'BOARD_APPROVE_MISSING_FIELDS');
  update public.board_meetings set started_at = '2099-03-01 09:05:00+03:30', ended_at = '2099-03-01 10:30:00+03:30', chair_member_id = v_chair, secretary_member_id = v_sec where id = m1;
  perform pg_temp.expect_err(format($q$update public.board_meetings set ended_at = '2099-03-01 08:00:00+03:30' where id = %L$q$, m1), 'ck_board_meeting_times');
  perform pg_temp.expect_err(format($q$select public.board_approve_meeting(%L)$q$, m1), 'BOARD_APPROVE_ATTENDANCE_INCOMPLETE');
  insert into public.board_attendance (meeting_id, member_id, status) values (m1, v_chair, 'PRESENT'), (m1, v_sec, 'ABSENT'), (m1, v_ext, 'EXCUSED');
  perform pg_temp.expect_err(format($q$select public.board_approve_meeting(%L)$q$, m1), 'BOARD_APPROVE_OFFICIALS_ABSENT');
  update public.board_attendance set status = 'PRESENT' where meeting_id = m1 and member_id = v_sec;
  update public.board_resolutions set due_date = '2099-02-28' where id = r1;
  perform pg_temp.expect_err(format($q$select public.board_approve_meeting(%L)$q$, m1), 'BOARD_RESOLUTION_DUE_BEFORE_MEETING');
  update public.board_resolutions set due_date = '2099-03-01' where id = r1;                 -- the meeting day itself is allowed
  perform pg_temp.expect_err(format($q$select public.board_approve_meeting(%L, '2099-02-01 09:00:00+03:30')$q$, m1), 'BOARD_NEXT_MEETING_INVALID');
  update public.board_agenda_items set discussion = null where meeting_id = m1;
  perform pg_temp.expect_err(format($q$select public.board_approve_meeting(%L)$q$, m1), 'BOARD_APPROVE_NO_DISCUSSION');
  update public.board_agenda_items set discussion = 'بحث شد' where id = a1;

  v_res := public.board_approve_meeting(m1, '2099-03-15 09:00:00+03:30');
  perform pg_temp.chk('continuous number from the paper baseline', (v_res ->> 'meeting_number')::integer = v_base + 1);
  perform pg_temp.chk('3 resolutions numbered', (v_res ->> 'resolutions')::integer = 3);
  v_next := (v_res ->> 'next_meeting_id')::uuid;
  perform pg_temp.chk('resolution numbers follow agenda order',
    (select resolution_number from public.board_resolutions where id = r2) = format('%s-1', v_base + 1)
    and (select resolution_number from public.board_resolutions where id = r1) = format('%s-2', v_base + 1)
    and (select resolution_number from public.board_resolutions where id = r3) = format('%s-3', v_base + 1));
  perform pg_temp.chk('next meeting is a DRAFT at the chosen time, same location',
    (select status = 'DRAFT' and meeting_number is null and scheduled_at = '2099-03-15 09:00:00+03:30' and location = 'آزمون دفتر' from public.board_meetings where id = v_next));
  select snapshot into v_snap from public.board_meetings where id = m1;
  perform pg_temp.chk('snapshot', (v_snap #>> '{meeting,number}')::integer = v_base + 1 and jsonb_array_length(v_snap -> 'attendance') = 3
    and jsonb_array_length(v_snap -> 'resolutions') = 3 and (v_snap #>> '{resolutions,0,number}') = format('%s-1', v_base + 1)
    and (v_snap #>> '{chair,name}') = 'آزمون رئیس' and v_snap -> 'next_meeting' is not null and v_snap ->> 'approved_at' is not null);
  perform pg_temp.expect_err(format($q$select public.board_approve_meeting(%L)$q$, m1), 'BOARD_MEETING_LOCKED');

  -- 6) the lock — even the table owner cannot change an approved meeting ---------------------------------------------------------------
  update public.board_meetings set location = 'تغییر' where id = m1;
  get diagnostics v_cnt = row_count;
  perform pg_temp.chk('approved meeting: no browser update', v_cnt = 0);
  perform pg_temp.owner();
  perform pg_temp.expect_err(format($q$update public.board_meetings set general_notes = 'دستکاری' where id = %L$q$, m1), 'BOARD_MEETING_LOCKED');
  perform pg_temp.expect_err(format($q$delete from public.board_meetings where id = %L$q$, m1), 'BOARD_MEETING_LOCKED');
  perform pg_temp.expect_err(format($q$update public.board_resolutions set text = 'دستکاری' where id = %L$q$, r1), 'BOARD_MEETING_LOCKED');
  perform pg_temp.expect_err(format($q$update public.board_resolutions set due_date = '2099-12-01' where id = %L$q$, r1), 'BOARD_MEETING_LOCKED');
  perform pg_temp.expect_err(format($q$delete from public.board_resolutions where id = %L$q$, r1), 'BOARD_MEETING_LOCKED');
  perform pg_temp.expect_err(format($q$insert into public.board_agenda_items (meeting_id, title) values (%L, 'بند اضافه')$q$, m1), 'BOARD_MEETING_LOCKED');
  perform pg_temp.expect_err(format($q$update public.board_attendance set status = 'ABSENT' where meeting_id = %L and member_id = %L$q$, m1, v_chair), 'BOARD_MEETING_LOCKED');
  perform pg_temp.expect_err(format($q$delete from public.board_attendance where meeting_id = %L$q$, m1), 'BOARD_MEETING_LOCKED');
  -- the ONLY mutable column; since 0150 only through the follow-up RPCs (flag nil.board_follow) — simulated here
  perform set_config('nil.board_follow', 'on', true);
  update public.board_resolutions set follow_status = 'IN_PROGRESS' where id = r1;
  perform set_config('nil.board_follow', 'off', true);
  perform pg_temp.chk('follow_status changes after approval', (select follow_status from public.board_resolutions where id = r1) = 'IN_PROGRESS');
  perform pg_temp.chk('snapshot unchanged by follow-up', (select snapshot from public.board_meetings where id = m1) = v_snap);

  -- 7) the suggested next meeting can be deleted; the approved one just forgets the link ------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'CREATE');
  delete from public.board_meetings where id = v_next;
  perform pg_temp.chk('next_meeting_id reset by FK', (select next_meeting_id is null and status = 'APPROVED' from public.board_meetings where id = m1));

  -- 8) second meeting: numbering continues, previous open resolutions carried into the snapshot ----------------------------------------
  insert into public.board_meetings (scheduled_at, location, created_by, started_at, ended_at, chair_member_id, secretary_member_id, general_notes)
    values ('2099-04-01 09:00:00+03:30', 'آزمون دفتر', v_admin, '2099-04-01 09:00:00+03:30', '2099-04-01 10:00:00+03:30', v_chair, v_sec, 'مقدمه') returning id into m2;
  insert into public.board_agenda_items (meeting_id, title) values (m2, 'آزمون پیگیری');
  insert into public.board_attendance (meeting_id, member_id, status) values (m2, v_chair, 'PRESENT'), (m2, v_sec, 'PRESENT'), (m2, v_ext, 'ABSENT');
  perform pg_temp.persona(v_admin, 'USER', 'APPROVE');
  v_res := public.board_approve_meeting(m2);
  perform pg_temp.chk('second number', (v_res ->> 'meeting_number')::integer = v_base + 2 and v_res ->> 'next_meeting_id' is null);
  select snapshot into v_snap from public.board_meetings where id = m2;
  perform pg_temp.chk('previous open action resolutions (not the non-action one) in the snapshot',
    jsonb_array_length(v_snap -> 'previous_followups') = 2
    and (v_snap #>> '{previous_followups,0,number}') = format('%s-1', v_base + 1)
    and (v_snap #>> '{previous_followups,1,follow_status}') = 'IN_PROGRESS');

  -- 9) audit ---------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.chk('audit rows', (select count(*) from public.board_audit_log where meeting_id = m1 and action = 'MEETING_APPROVED') = 1
    and (select count(*) from public.board_audit_log where meeting_id = m1 and entity = 'board_resolutions') >= 3);
  perform pg_temp.expect_err($q$insert into public.board_audit_log (entity, action) values ('x', 'FORGED')$q$, 'permission denied');
  perform pg_temp.owner();
  perform pg_temp.expect_err(format($q$update public.board_audit_log set action = 'X' where meeting_id = %L$q$, m1), 'BOARD_AUDIT_APPEND_ONLY');
  perform pg_temp.expect_err(format($q$delete from public.board_audit_log where meeting_id = %L$q$, m1), 'BOARD_AUDIT_APPEND_ONLY');

  -- 10) members: a member used in a meeting cannot be deleted; only the board ADMIN deletes ------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'APPROVE');
  delete from public.board_members where id = v_inactive;
  get diagnostics v_cnt = row_count;
  perform pg_temp.chk('APPROVE tier cannot delete members', v_cnt = 0);
  perform pg_temp.persona(v_admin, 'USER', 'ADMIN');
  perform pg_temp.expect_err(format($q$delete from public.board_members where id = %L$q$, v_chair), 'foreign key');
  delete from public.board_members where id = v_inactive;
  get diagnostics v_cnt = row_count;
  perform pg_temp.chk('board ADMIN deletes an unused member', v_cnt = 1);

  -- 11) NIL Verify ---------------------------------------------------------------------------------------------------------------------
  perform pg_temp.owner();
  v_snap := public._verify_snapshot('BOARD_MINUTES', m1);
  perform pg_temp.chk('public snapshot = number + meeting date only', v_snap ->> 'number' = (v_base + 1)::text
    and (select array_agg(k order by k) from jsonb_object_keys(v_snap -> 'metadata') k) = array['meeting_date']
    and v_snap #>> '{metadata,meeting_date}' = '2099-03-01');
  perform pg_temp.persona(v_admin, 'USER', 'CREATE');
  insert into public.board_meetings (scheduled_at, location, created_by) values ('2099-05-01 09:00:00+03:30', 'آزمون', v_admin) returning id into v_next;
  perform pg_temp.persona(v_admin, 'USER', 'VIEW');
  perform pg_temp.expect_err(format($q$select public.verify_begin('BOARD_MINUTES', %L, repeat('a', 64))$q$, m1), 'NOT_AUTHORIZED');
  perform pg_temp.chk('VIEW reads verification status', (public.verify_document_status('BOARD_MINUTES', m1) ->> 'exists') = 'false');
  perform pg_temp.persona(v_admin, 'USER', null);
  perform pg_temp.expect_err(format($q$select public.verify_document_status('BOARD_MINUTES', %L)$q$, m1), 'NOT_AUTHORIZED');
  perform pg_temp.persona(v_admin, 'USER', 'APPROVE');
  perform pg_temp.expect_err(format($q$select public.verify_begin('BOARD_MINUTES', %L, repeat('b', 64))$q$, v_next), 'VERIFY_NOT_ELIGIBLE');
  v_ver := public.verify_begin('BOARD_MINUTES', m1, repeat('c', 64));
  v_vid := (v_ver ->> 'id')::uuid;
  perform pg_temp.chk('verification PENDING with the meeting number', v_ver ->> 'status' = 'PENDING' and v_ver ->> 'document_number' = (v_base + 1)::text);
  perform public.verify_activate(v_vid, repeat('d', 64), 1234, 'verified/' || v_vid || '.pdf');

  -- 12) storage + attachments confidentiality ------------------------------------------------------------------------------------------
  perform pg_temp.owner();
  insert into storage.objects (bucket_id, name, owner) values
    ('nil-files', 'verified/' || v_vid || '.pdf', v_admin),
    ('nil-files', 'verified/00000000-0000-0000-0000-00000000abcd.pdf', v_admin),
    ('nil-files', 'board_meeting/' || m1 || '/scan.pdf', v_admin);
  insert into public.attachments (entity_type, entity_id, file_name, storage_path, mime_type, size_bytes, uploaded_by)
    values ('BOARD_MEETING', m1, 'minutes.pdf', 'verified/' || v_vid || '.pdf', 'application/pdf', 1234, v_admin);
  perform pg_temp.persona(v_admin, 'USER', null);
  perform pg_temp.chk('non-board user cannot see the minutes file, the board prefix or the attachment row',
    (select count(*) from storage.objects where name = 'verified/' || v_vid || '.pdf') = 0
    and (select count(*) from storage.objects where name like 'board_meeting/%') = 0
    and (select count(*) from public.attachments where entity_type = 'BOARD_MEETING' and entity_id = m1) = 0);
  perform pg_temp.chk('other verified files stay readable', (select count(*) from storage.objects where name = 'verified/00000000-0000-0000-0000-00000000abcd.pdf') = 1);
  perform pg_temp.expect_err(format($q$insert into storage.objects (bucket_id, name, owner) values ('nil-files', 'board_meeting/%s/x.pdf', %L)$q$, m1, v_admin), 'row-level security');
  perform pg_temp.persona(v_admin, 'USER', 'VIEW');
  perform pg_temp.chk('board VIEW sees them', (select count(*) from storage.objects where name = 'verified/' || v_vid || '.pdf') = 1
    and (select count(*) from storage.objects where name like 'board_meeting/%') = 1
    and (select count(*) from public.attachments where entity_type = 'BOARD_MEETING' and entity_id = m1) = 1);

  -- 13) Factory Reset ------------------------------------------------------------------------------------------------------------------
  perform pg_temp.owner();
  perform pg_temp.chk('manifest rows', (select count(*) from public.system_reset_manifest where module = 'board') >= 7
    and (select classification from public.system_reset_manifest where object_name = 'board_settings') = 'PRESERVE'
    and (select classification from public.system_reset_manifest where object_name = 'board_meetings') = 'DELETE');
  perform pg_temp.chk('board_meeting/ storage rule', (select action from public.system_reset_storage_rules where prefix = 'board_meeting/') = 'DELETE');

  raise notice 'PASS: board integrity';
end $$;

rollback;

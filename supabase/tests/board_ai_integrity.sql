-- =============================================================================
-- NIL Office — Board Secretariat Phase 3 (migration 0151) integrity + security tests: assistant suggestions for the minutes.
-- Run by hand in the Supabase SQL editor AFTER migration 0151, with at least one active ADMIN profile.
-- ONE transaction, ROLLED BACK at the end. SYNTHETIC fixtures only (members «آزمون …», meetings in year 2099, Telegram ids 9100000xx).
-- The script temporarily re-roles the first ADMIN profile (rolled back) — do NOT run it while that admin is actively using the app.
-- Success = the statement finishes with no error ("Success. No rows returned" in the Supabase editor).
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
  v_admin uuid; v_sec uuid; v_ext uuid; m1 uuid; m_appr uuid; a1 uuid; d1 uuid; d2 uuid; d3 uuid; v_res jsonb; v_cnt integer;
  v_sugg jsonb := '{"version":1,"general_notes":null,"remaining_topics":null,"agenda":[],"resolutions":[],"warnings":[]}';
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active order by created_at limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;

  -- 1) grants ---------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.chk('grants', not has_table_privilege('anon', 'public.board_ai_drafts', 'select')
    and has_table_privilege('authenticated', 'public.board_ai_drafts', 'select,insert,update')
    and not has_table_privilege('authenticated', 'public.board_ai_drafts', 'delete')
    and has_table_privilege('service_role', 'public.board_ai_drafts', 'select,insert,update,delete')
    and not has_function_privilege('authenticated', 'public.board_member_drafter_profile(uuid)', 'execute')
    and has_function_privilege('service_role', 'public.board_member_drafter_profile(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.board_apply_ai_draft(uuid,text,text,jsonb,jsonb,jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.board_apply_ai_draft(uuid,text,text,jsonb,jsonb,jsonb)', 'execute'));

  -- 2) fixtures ---------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.owner();
  update public.board_members set is_active = false where is_active;                      -- real members out of the way (rolled back)
  update public.board_members set profile_id = null where profile_id = v_admin;            -- the admin's real member row, if any (rolled back)
  perform pg_temp.persona(v_admin, 'USER', 'APPROVE');
  insert into public.board_members (full_name, kind, sort_order, profile_id, created_by) values ('آزمون دبیر', 'INTERNAL', 1, v_admin, v_admin) returning id into v_sec;
  insert into public.board_members (full_name, kind, sort_order, created_by) values ('آزمون بیرونی', 'EXTERNAL', 2, v_admin) returning id into v_ext;
  insert into public.board_meetings (scheduled_at, location, created_by, general_notes) values ('2099-03-01 09:00:00+03:30', 'آزمون', v_admin, 'مقدمهٔ موجود') returning id into m1;
  insert into public.board_agenda_items (meeting_id, position, title, discussion) values (m1, 1, 'آزمون بند', 'بحث قبلی') returning id into a1;

  -- 3) RLS on insert ----------------------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'VIEW');
  perform pg_temp.expect_err(format($q$insert into public.board_ai_drafts (meeting_id, source, notes, suggestion, created_by) values (%L, 'WEB', 'n', %L, %L)$q$, m1, v_sugg, v_admin), 'row-level security');
  perform pg_temp.persona(v_admin, 'USER', 'CREATE');
  perform pg_temp.expect_err(format($q$insert into public.board_ai_drafts (meeting_id, source, notes, suggestion, created_by) values (%L, 'TELEGRAM', 'n', %L, %L)$q$, m1, v_sugg, v_admin), 'row-level security');
  perform pg_temp.expect_err(format($q$insert into public.board_ai_drafts (meeting_id, source, notes, suggestion, created_by) values (%L, 'WEB', 'n', %L, %L)$q$, m1, v_sugg, gen_random_uuid()), 'row-level security');
  insert into public.board_ai_drafts (meeting_id, source, notes, suggestion, created_by) values (m1, 'WEB', 'یادداشت آزمون', v_sugg, v_admin) returning id into d1;
  insert into public.board_ai_drafts (meeting_id, source, notes, suggestion, created_by) values (m1, 'WEB', 'یادداشت آزمون ۲', v_sugg, v_admin) returning id into d2;

  -- 4) a suggestion is immutable; only PENDING -> APPLIED | DISCARDED, once ----------------------------------------------------------------
  perform pg_temp.expect_err(format($q$update public.board_ai_drafts set notes = 'دستکاری' where id = %L$q$, d1), 'BOARD_AI_DRAFT_IMMUTABLE');
  perform pg_temp.expect_err(format($q$update public.board_ai_drafts set suggestion = '{}' where id = %L$q$, d1), 'BOARD_AI_DRAFT_IMMUTABLE');
  update public.board_ai_drafts set status = 'DISCARDED', decided_at = now(), decided_by = v_admin where id = d2;
  update public.board_ai_drafts set status = 'PENDING' where id = d2;
  get diagnostics v_cnt = row_count;
  perform pg_temp.chk('a decided suggestion is out of reach of the browser', v_cnt = 0);
  perform pg_temp.owner();
  perform pg_temp.expect_err(format($q$update public.board_ai_drafts set status = 'PENDING' where id = %L$q$, d2), 'BOARD_AI_DRAFT_IMMUTABLE');

  -- 5) apply: permission, all-or-nothing, then success --------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'VIEW');
  perform pg_temp.expect_err(format($q$select public.board_apply_ai_draft(%L, null, null, '[]', '[]', '[]')$q$, d1), 'NOT_AUTHORIZED');
  perform pg_temp.persona(v_admin, 'USER', 'CREATE');
  -- an action resolution without owner/deadline fails the whole apply (the new agenda item before it is rolled back too)
  perform pg_temp.expect_err(format($q$select public.board_apply_ai_draft(%L, null, null, '[{"key":"a0","title":"بند تازه","discussion":"x"}]', '[]',
    '[{"text":"بی‌مسئول","requires_action":true}]')$q$, d1), 'ck_board_resolution_action');
  perform pg_temp.chk('nothing partially applied', (select count(*) from public.board_agenda_items where meeting_id = m1) = 1
    and (select status from public.board_ai_drafts where id = d1) = 'PENDING');
  perform pg_temp.expect_err(format($q$select public.board_apply_ai_draft(%L, null, null, '[]', '[{"agenda_item_id":"%s","discussion":"x"}]', '[]')$q$, d1, gen_random_uuid()), 'BOARD_INVALID');

  v_res := public.board_apply_ai_draft(d1, 'مقدمهٔ دستیار', 'موضوع باقی‌مانده',
    '[{"key":"a1","title":"بند تازه","discussion":"مذاکرات بند تازه"}]'::jsonb,
    jsonb_build_array(jsonb_build_object('agenda_item_id', a1, 'discussion', 'بحث دستیار')),
    jsonb_build_array(
      jsonb_build_object('agenda_key', 'a1', 'text', 'مصوبهٔ اجرایی', 'requires_action', true, 'owner_member_id', v_ext, 'due_date', '2099-03-20', 'expected_output', 'گزارش'),
      jsonb_build_object('agenda_item_id', a1, 'text', 'مصوبهٔ تصویبی', 'requires_action', false, 'vote_note', 'با اتفاق آرا')));
  perform pg_temp.chk('apply counts', v_res = '{"new_agenda":1,"discussions":1,"resolutions":2}'::jsonb);
  perform pg_temp.chk('appended, never overwritten', (select discussion from public.board_agenda_items where id = a1) = E'بحث قبلی\n\nبحث دستیار'
    and (select general_notes from public.board_meetings where id = m1) = E'مقدمهٔ موجود\n\nمقدمهٔ دستیار'
    and (select remaining_topics from public.board_meetings where id = m1) = 'موضوع باقی‌مانده');
  perform pg_temp.chk('new agenda item after the existing ones; resolution linked to it',
    (select position from public.board_agenda_items where meeting_id = m1 and title = 'بند تازه') = 2
    and (select r.agenda_item_id = i.id from public.board_resolutions r join public.board_agenda_items i on i.title = 'بند تازه' and i.meeting_id = m1
          where r.meeting_id = m1 and r.text = 'مصوبهٔ اجرایی'));
  perform pg_temp.chk('resolutions are ordinary DRAFT rows (no number yet)', (select count(*) from public.board_resolutions where meeting_id = m1 and resolution_number is null) = 2
    and (select follow_status from public.board_resolutions where meeting_id = m1 and text = 'مصوبهٔ تصویبی') = 'NO_ACTION');
  perform pg_temp.chk('suggestion marked APPLIED', (select status = 'APPLIED' and decided_by = v_admin from public.board_ai_drafts where id = d1));
  perform pg_temp.expect_err(format($q$select public.board_apply_ai_draft(%L, null, null, '[]', '[]', '[]')$q$, d1), 'BOARD_AI_DRAFT_IMMUTABLE');

  -- 6) an approved meeting never receives a suggestion ---------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'APPROVE');
  insert into public.board_meetings (scheduled_at, location, created_by, started_at, ended_at, chair_member_id, secretary_member_id, general_notes)
    values ('2099-04-01 09:00:00+03:30', 'آزمون', v_admin, '2099-04-01 09:00:00+03:30', '2099-04-01 10:00:00+03:30', v_sec, v_sec, 'مقدمه') returning id into m_appr;
  insert into public.board_agenda_items (meeting_id, title) values (m_appr, 'آزمون');
  insert into public.board_attendance (meeting_id, member_id, status) values (m_appr, v_sec, 'PRESENT'), (m_appr, v_ext, 'PRESENT');
  insert into public.board_ai_drafts (meeting_id, source, notes, suggestion, created_by) values (m_appr, 'WEB', 'یادداشت', v_sugg, v_admin) returning id into d3;
  perform public.board_approve_meeting(m_appr);
  perform pg_temp.expect_err(format($q$select public.board_apply_ai_draft(%L, 'x', null, '[]', '[]', '[]')$q$, d3), 'BOARD_MEETING_LOCKED');

  -- 7) who may draft from the bot -------------------------------------------------------------------------------------------------------
  perform pg_temp.owner();
  perform pg_temp.chk('not linked to Telegram: no', public.board_member_drafter_profile(v_sec) is null);
  insert into public.board_telegram_links (member_id, telegram_user_id, telegram_chat_id) values (v_sec, 910000001, 910000001), (v_ext, 910000002, 910000002);
  update public.profiles set role = 'USER', board_role = 'CREATE' where id = v_admin;
  perform pg_temp.chk('linked + CREATE tier: yes, as that profile', public.board_member_drafter_profile(v_sec) = v_admin);
  update public.profiles set board_role = 'VIEW' where id = v_admin;
  perform pg_temp.chk('VIEW tier: no', public.board_member_drafter_profile(v_sec) is null);
  perform pg_temp.chk('external member (no profile): no', public.board_member_drafter_profile(v_ext) is null);
  update public.profiles set role = 'ADMIN', board_role = null where id = v_admin;
  perform pg_temp.chk('global ADMIN: yes', public.board_member_drafter_profile(v_sec) = v_admin);
  update public.board_members set is_active = false where id = v_sec;
  perform pg_temp.chk('inactive member: no', public.board_member_drafter_profile(v_sec) is null);

  -- 8) Factory Reset ----------------------------------------------------------------------------------------------------------------------
  perform pg_temp.chk('manifest', (select classification from public.system_reset_manifest where object_name = 'board_ai_drafts') = 'DELETE');

  raise notice 'PASS: board assistant integrity';
end $$;

rollback;

-- =============================================================================
-- NIL Office — Board Secretariat Phase 2 (migration 0150) integrity + security tests: follow-up, Telegram linking, notifications.
-- Run by hand in the Supabase SQL editor AFTER migration 0150, with at least one active ADMIN profile.
-- ONE transaction, ROLLED BACK at the end. SYNTHETIC fixtures only (members «آزمون …», meetings in year 2099, Telegram ids 9000000xx).
-- The script temporarily re-roles the first ADMIN profile (rolled back) — do NOT run it while that admin is actively using the app.
-- Success = the statement finishes with no error ("Success. No rows returned" in the Supabase editor).
-- «as service» steps run as the table owner (the SQL editor's role), which — like service_role — bypasses RLS.
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

create function pg_temp.h(p_seed text) returns text language sql as $$ select encode(sha256(convert_to(p_seed, 'UTF8')), 'hex') $$;

do $$
declare
  v_admin uuid; v_chair uuid; v_sec uuid; v_ext uuid; m1 uuid; m_draft uuid; a1 uuid; r_own uuid; r_other uuid; r_noact uuid; r_draft uuid;
  v_up uuid; v_res jsonb; v_cnt integer; v_n integer; v_due date := '2099-03-20';
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active order by created_at limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;

  -- 1) grants ---------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.chk('browser cannot touch tokens / outbox / bot tables',
    not has_table_privilege('authenticated', 'public.board_link_tokens', 'select') and not has_table_privilege('authenticated', 'public.board_notifications', 'select')
    and not has_table_privilege('authenticated', 'public.board_bot_state', 'select') and not has_table_privilege('authenticated', 'public.board_bot_updates', 'select')
    and not has_table_privilege('authenticated', 'public.board_telegram_links', 'insert') and not has_table_privilege('authenticated', 'public.board_telegram_links', 'update')
    and not has_table_privilege('authenticated', 'public.board_resolution_updates', 'insert') and not has_table_privilege('anon', 'public.board_resolution_updates', 'select'));
  perform pg_temp.chk('service_role granted on every new table',
    has_table_privilege('service_role', 'public.board_link_tokens', 'select,insert,update,delete') and has_table_privilege('service_role', 'public.board_notifications', 'select,insert,update,delete')
    and has_table_privilege('service_role', 'public.board_telegram_links', 'select,insert,update,delete') and has_table_privilege('service_role', 'public.board_bot_state', 'select,insert,update,delete')
    and has_table_privilege('service_role', 'public.board_bot_updates', 'select,insert') and has_table_privilege('service_role', 'public.board_resolution_updates', 'select,insert')
    and has_table_privilege('service_role', 'public.board_resolution_files', 'select,insert'));
  perform pg_temp.chk('bot / cron functions are service_role only',
    not has_function_privilege('authenticated', 'public.board_member_report_progress(uuid,uuid,text,text,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.board_consume_link_token(text,bigint,bigint)', 'execute')
    and not has_function_privilege('authenticated', 'public.board_enqueue_reminders(date)', 'execute')
    and not has_function_privilege('authenticated', 'public.board_claim_notifications(integer)', 'execute')
    and not has_function_privilege('authenticated', 'public._board_apply_followup(uuid,text,text,text,text,uuid,uuid,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public._board_enqueue(uuid,text,text,uuid,uuid,jsonb)', 'execute')
    and has_function_privilege('service_role', 'public.board_member_report_progress(uuid,uuid,text,text,jsonb)', 'execute')
    and has_function_privilege('service_role', 'public.board_claim_notifications(integer)', 'execute')
    and has_function_privilege('authenticated', 'public.board_report_progress(uuid,text,text,jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.board_report_progress(uuid,text,text,jsonb)', 'execute'));

  -- 2) fixtures: an approved meeting (through the real RPC) + a draft --------------------------------------------------------------------
  perform pg_temp.owner();
  update public.board_members set is_active = false where is_active;                      -- real members out of the way (rolled back)
  perform pg_temp.persona(v_admin, 'USER', 'APPROVE');
  insert into public.board_members (full_name, kind, sort_order, created_by) values ('آزمون رئیس', 'INTERNAL', 1, v_admin) returning id into v_chair;
  insert into public.board_members (full_name, kind, sort_order, is_notice_recipient, created_by) values ('آزمون دبیر', 'INTERNAL', 2, true, v_admin) returning id into v_sec;
  insert into public.board_members (full_name, kind, sort_order, created_by) values ('آزمون بیرونی', 'EXTERNAL', 3, v_admin) returning id into v_ext;
  insert into public.board_meetings (scheduled_at, location, created_by, started_at, ended_at, chair_member_id, secretary_member_id, general_notes)
    values ('2099-03-01 09:00:00+03:30', 'آزمون', v_admin, '2099-03-01 09:00:00+03:30', '2099-03-01 10:00:00+03:30', v_chair, v_sec, 'مقدمه') returning id into m1;
  insert into public.board_agenda_items (meeting_id, title) values (m1, 'آزمون بند') returning id into a1;
  insert into public.board_attendance (meeting_id, member_id, status) values (m1, v_chair, 'PRESENT'), (m1, v_sec, 'PRESENT'), (m1, v_ext, 'PRESENT');
  insert into public.board_resolutions (meeting_id, agenda_item_id, position, text, owner_member_id, due_date, created_by)
    values (m1, a1, 1, 'آزمون مصوبه عضو بیرونی', v_ext, v_due, v_admin) returning id into r_own;
  insert into public.board_resolutions (meeting_id, agenda_item_id, position, text, owner_member_id, due_date, created_by)
    values (m1, a1, 2, 'آزمون مصوبه رئیس', v_chair, v_due, v_admin) returning id into r_other;
  insert into public.board_resolutions (meeting_id, position, text, requires_action, created_by) values (m1, 3, 'آزمون تصویب', false, v_admin) returning id into r_noact;
  perform public.board_approve_meeting(m1);
  insert into public.board_meetings (scheduled_at, location, created_by) values ('2099-06-01 09:00:00+03:30', 'آزمون', v_admin) returning id into m_draft;
  insert into public.board_resolutions (meeting_id, position, text, owner_member_id, due_date, created_by)
    values (m_draft, 1, 'آزمون پیش‌نویس', v_ext, '2099-06-10', v_admin) returning id into r_draft;

  -- 3) follow_status only through the RPCs ---------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'CREATE');
  perform pg_temp.expect_err(format($q$update public.board_resolutions set follow_status = 'DONE' where id = %L$q$, r_own), 'BOARD_FOLLOWUP_RPC_ONLY');
  perform pg_temp.owner();
  perform pg_temp.expect_err(format($q$update public.board_resolutions set follow_status = 'DONE' where id = %L$q$, r_own), 'BOARD_FOLLOWUP_RPC_ONLY');

  -- 4) web progress --------------------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'VIEW');
  perform pg_temp.expect_err(format($q$select public.board_report_progress(%L, 'IN_PROGRESS', 'x')$q$, r_own), 'NOT_AUTHORIZED');
  perform pg_temp.persona(v_admin, 'USER', 'CREATE');
  perform pg_temp.expect_err(format($q$select public.board_report_progress(%L, 'DONE', 'x')$q$, r_own), 'BOARD_INVALID');
  perform pg_temp.expect_err(format($q$select public.board_report_progress(%L, 'IN_PROGRESS', '  ')$q$, r_own), 'BOARD_NOTE_REQUIRED');
  perform pg_temp.expect_err(format($q$select public.board_report_progress(%L, 'IN_PROGRESS', 'x')$q$, r_noact), 'BOARD_FOLLOWUP_NOT_ALLOWED');
  perform pg_temp.expect_err(format($q$select public.board_report_progress(%L, 'IN_PROGRESS', 'x')$q$, r_draft), 'BOARD_FOLLOWUP_NOT_ALLOWED');
  perform pg_temp.expect_err(format($q$select public.board_report_progress(%L, 'IN_PROGRESS', 'x', '[{"storage_path":"verified/x.pdf","file_name":"x.pdf","mime_type":"application/pdf","size_bytes":10}]')$q$, r_own),
    'BOARD_FILE_PATH_INVALID');
  perform pg_temp.expect_err(format($q$select public.board_report_progress(%L, 'IN_PROGRESS', 'x', '[{"storage_path":"board_meeting/%s/followup/%s/../../../x.pdf","file_name":"x.pdf","mime_type":"application/pdf","size_bytes":10}]')$q$, r_own, m1, r_own),
    'BOARD_FILE_PATH_INVALID');
  perform pg_temp.expect_err(format($q$select public.board_report_progress(%L, 'IN_PROGRESS', 'x', '[{"storage_path":"board_meeting/%s/followup/%s/a.pdf","file_name":"x.pdf","mime_type":"application/pdf","size_bytes":10}]')$q$, r_own, m1, r_other),
    'BOARD_FILE_PATH_INVALID');                                                          -- another resolution's folder
  v_up := public.board_report_progress(r_own, 'IN_PROGRESS', 'تلفنی گزارش شد',
    jsonb_build_array(jsonb_build_object('storage_path', format('board_meeting/%s/followup/%s/e1.pdf', m1, r_own), 'file_name', 'گزارش.pdf', 'mime_type', 'application/pdf', 'size_bytes', 2048)));
  perform pg_temp.chk('web progress recorded', (select follow_status from public.board_resolutions where id = r_own) = 'IN_PROGRESS'
    and (select source = 'WEB' and actor_profile_id = v_admin and kind = 'PROGRESS' from public.board_resolution_updates where id = v_up)
    and (select count(*) from public.board_resolution_files where update_id = v_up) = 1);
  perform pg_temp.chk('snapshot untouched by follow-up', (select snapshot #>> '{resolutions,0,text}' from public.board_meetings where id = m1) = 'آزمون مصوبه عضو بیرونی');

  -- 5) history is append-only ----------------------------------------------------------------------------------------------------------
  perform pg_temp.owner();
  perform pg_temp.expect_err(format($q$update public.board_resolution_updates set note = 'دستکاری' where id = %L$q$, v_up), 'BOARD_FOLLOWUP_APPEND_ONLY');
  perform pg_temp.expect_err(format($q$update public.board_resolution_files set file_name = 'y' where update_id = %L$q$, v_up), 'BOARD_FOLLOWUP_APPEND_ONLY');

  -- 6) linking -------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'VIEW');
  perform pg_temp.expect_err(format($q$select public.board_issue_link_token(%L, %L)$q$, v_ext, pg_temp.h('t0')), 'NOT_AUTHORIZED');
  perform pg_temp.persona(v_admin, 'USER', 'CREATE');
  perform public.board_issue_link_token(v_ext, pg_temp.h('t1'));
  perform public.board_issue_link_token(v_ext, pg_temp.h('t2'));                         -- revokes t1
  perform pg_temp.expect_err($q$select count(*) from public.board_link_tokens$q$, 'permission denied');
  perform pg_temp.expect_err(format($q$insert into public.board_telegram_links (member_id, telegram_user_id, telegram_chat_id) values (%L, 1, 1)$q$, v_ext), 'permission denied');
  perform pg_temp.owner();
  perform pg_temp.chk('only the hash is stored', (select count(*) from public.board_link_tokens where member_id = v_ext and token_hash = pg_temp.h('t2') and expires_at > now() + interval '6 days') = 1);
  perform pg_temp.chk('revoked token refused', (public.board_consume_link_token(pg_temp.h('t1'), 900000001, 900000001) ->> 'ok') = 'false');
  perform pg_temp.chk('unknown token refused', (public.board_consume_link_token(pg_temp.h('nope'), 900000001, 900000001) ->> 'ok') = 'false');
  v_res := public.board_consume_link_token(pg_temp.h('t2'), 900000001, 900000001);
  perform pg_temp.chk('valid token links', v_res ->> 'ok' = 'true' and (v_res ->> 'member_id')::uuid = v_ext
    and (select telegram_chat_id from public.board_telegram_links where member_id = v_ext) = 900000001);
  perform pg_temp.chk('a token works once', (public.board_consume_link_token(pg_temp.h('t2'), 900000002, 900000002) ->> 'ok') = 'false');
  perform pg_temp.persona(v_admin, 'USER', 'CREATE');
  perform public.board_issue_link_token(v_sec, pg_temp.h('t3'));
  perform public.board_issue_link_token(v_chair, pg_temp.h('t4'));
  perform pg_temp.owner();
  perform pg_temp.chk('one Telegram account = one member', (public.board_consume_link_token(pg_temp.h('t3'), 900000001, 900000001) ->> 'reason') = 'ACCOUNT_IN_USE');
  perform pg_temp.chk('secretary links', (public.board_consume_link_token(pg_temp.h('t3'), 900000003, 900000003) ->> 'ok') = 'true');
  update public.board_link_tokens set expires_at = now() - interval '1 minute' where token_hash = pg_temp.h('t4');
  perform pg_temp.chk('expired token refused', (public.board_consume_link_token(pg_temp.h('t4'), 900000004, 900000004) ->> 'ok') = 'false');

  -- 7) progress from the bot (service_role path) ---------------------------------------------------------------------------------------
  perform pg_temp.expect_err(format($q$select public.board_member_report_progress(%L, %L, 'IN_PROGRESS', 'x')$q$, v_ext, r_other), 'NOT_AUTHORIZED');   -- not the owner
  perform pg_temp.expect_err(format($q$select public.board_member_report_progress(%L, %L, 'IN_PROGRESS', 'x')$q$, v_chair, r_other), 'NOT_AUTHORIZED'); -- owner, not linked
  v_up := public.board_member_report_progress(v_ext, r_own, 'PENDING_REVIEW', 'انجام شد، فایل پیوست است',
    jsonb_build_array(jsonb_build_object('storage_path', format('board_meeting/%s/followup/%s/e2.pdf', m1, r_own), 'file_name', 'نتیجه.pdf', 'mime_type', 'application/pdf', 'size_bytes', 4096)));
  perform pg_temp.chk('bot progress recorded', (select source = 'TELEGRAM' and actor_member_id = v_ext and actor_profile_id is null from public.board_resolution_updates where id = v_up)
    and (select follow_status from public.board_resolutions where id = r_own) = 'PENDING_REVIEW');
  perform pg_temp.chk('review request queued for the linked notice recipient only',
    (select count(*) from public.board_notifications where kind = 'REVIEW_REQUEST' and resolution_id = r_own) = 1
    and (select member_id from public.board_notifications where kind = 'REVIEW_REQUEST' and resolution_id = r_own) = v_sec);

  -- 8) close / reopen (secretary only) -------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'CREATE');
  perform pg_temp.expect_err(format($q$select public.board_close_resolution(%L, 'بسته شد')$q$, r_own), 'NOT_AUTHORIZED');
  perform pg_temp.persona(v_admin, 'USER', 'APPROVE');
  perform pg_temp.expect_err(format($q$select public.board_close_resolution(%L, '')$q$, r_own), 'BOARD_NOTE_REQUIRED');
  perform pg_temp.expect_err(format($q$select public.board_reopen_resolution(%L, 'x')$q$, r_own), 'BOARD_RESOLUTION_NOT_CLOSED');
  perform public.board_close_resolution(r_own, 'نتیجه بررسی و تأیید شد');
  perform pg_temp.owner();
  perform pg_temp.chk('closed', (select follow_status from public.board_resolutions where id = r_own) = 'DONE'
    and (select count(*) from public.board_notifications where kind = 'CLOSED' and resolution_id = r_own and member_id = v_ext) = 1);
  perform pg_temp.persona(v_admin, 'USER', 'APPROVE');
  perform pg_temp.expect_err(format($q$select public.board_report_progress(%L, 'IN_PROGRESS', 'x')$q$, r_own), 'BOARD_RESOLUTION_CLOSED');
  perform pg_temp.owner();
  perform pg_temp.expect_err(format($q$select public.board_member_report_progress(%L, %L, 'IN_PROGRESS', 'x')$q$, v_ext, r_own), 'BOARD_RESOLUTION_CLOSED');
  perform pg_temp.persona(v_admin, 'USER', 'APPROVE');
  perform public.board_reopen_resolution(r_own, 'نیاز به اصلاح دارد');
  perform pg_temp.chk('reopened', (select follow_status from public.board_resolutions where id = r_own) = 'IN_PROGRESS'
    and (select count(*) from public.board_resolution_updates where resolution_id = r_own) = 4);

  -- 9) minutes notification after approval ---------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'CREATE');
  perform pg_temp.expect_err(format($q$select public.board_enqueue_minutes(%L)$q$, m1), 'NOT_AUTHORIZED');
  perform pg_temp.persona(v_admin, 'USER', 'APPROVE');
  perform pg_temp.expect_err(format($q$select public.board_enqueue_minutes(%L)$q$, m_draft), 'BOARD_FOLLOWUP_NOT_ALLOWED');
  v_n := public.board_enqueue_minutes(m1);
  perform pg_temp.chk('idempotent', public.board_enqueue_minutes(m1) = 0);
  perform pg_temp.owner();
  perform pg_temp.chk('minutes to the 2 linked members + new-resolution list to the linked owner (the chair is not linked)', v_n = 3
    and (select count(*) from public.board_notifications where meeting_id = m1 and kind = 'MINUTES') = 2
    and (select count(*) from public.board_notifications where meeting_id = m1 and kind = 'NEW_RESOLUTIONS' and member_id = v_ext) = 1);

  -- 10) reminders ----------------------------------------------------------------------------------------------------------------------
  perform pg_temp.owner();
  v_n := public.board_enqueue_reminders(v_due - 3);                                     -- (separate statement: same-statement reads see the old snapshot)
  perform pg_temp.chk('3 days before', v_n = 1
    and (select count(*) from public.board_notifications where kind = 'DUE_SOON' and resolution_id = r_own) = 1
    and (select count(*) from public.board_notifications where kind = 'DUE_SOON' and resolution_id = r_other) = 0);   -- the chair is not linked
  perform pg_temp.chk('2 days before: nothing', public.board_enqueue_reminders(v_due - 2) = 0);
  perform public.board_enqueue_reminders(v_due);
  perform pg_temp.chk('on the deadline', (select count(*) from public.board_notifications where kind = 'DUE_TODAY' and resolution_id = r_own) = 1);
  perform public.board_enqueue_reminders(v_due + 4);
  perform pg_temp.chk('overdue +4: none', (select count(*) from public.board_notifications where kind = 'OVERDUE') = 0);
  perform public.board_enqueue_reminders(v_due + 3);
  perform public.board_enqueue_reminders(v_due + 3);
  perform pg_temp.chk('overdue every 3 days, once per day, + digest to the notice recipient',
    (select count(*) from public.board_notifications where kind = 'OVERDUE' and resolution_id = r_own) = 1
    and (select count(*) from public.board_notifications where kind = 'DIGEST' and member_id = v_sec) >= 1
    and (select (payload ->> 'overdue')::integer from public.board_notifications where dedupe_key = 'digest:' || v_sec || ':' || (v_due + 3)) = 2);
  -- a resolution awaiting review gets no reminder
  perform public.board_member_report_progress(v_ext, r_own, 'PENDING_REVIEW', 'دوباره ارسال شد');
  perform pg_temp.chk('no reminder while awaiting review', public.board_enqueue_reminders(v_due + 6) = 0);

  -- 11) outbox claim / finish ----------------------------------------------------------------------------------------------------------
  select count(*) into v_cnt from public.board_claim_notifications(500);
  perform pg_temp.chk('claim leases every pending row', v_cnt = (select count(*) from public.board_notifications where sent_at is null));
  perform pg_temp.chk('a leased row is not claimed twice', (select count(*) from public.board_claim_notifications(500)) = 0);
  perform public.board_finish_notification((select min(id) from public.board_notifications), null);
  perform public.board_finish_notification((select max(id) from public.board_notifications), 'telegram down');
  perform pg_temp.chk('finish', (select sent_at is not null from public.board_notifications where id = (select min(id) from public.board_notifications))
    and (select sent_at is null and last_error = 'telegram down' from public.board_notifications where id = (select max(id) from public.board_notifications)));

  -- 12) unlink -------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'CREATE');
  perform public.board_unlink_telegram(v_ext);
  perform pg_temp.chk('unlinked', (select count(*) from public.board_telegram_links where member_id = v_ext) = 0);
  perform pg_temp.owner();
  perform pg_temp.expect_err(format($q$select public.board_member_report_progress(%L, %L, 'IN_PROGRESS', 'x')$q$, v_ext, r_own), 'NOT_AUTHORIZED');

  -- 13) Factory Reset ------------------------------------------------------------------------------------------------------------------
  perform pg_temp.chk('manifest rows', (select count(*) from public.system_reset_manifest where object_name in
    ('board_resolution_updates','board_resolution_files','board_telegram_links','board_link_tokens','board_notifications','board_bot_updates','board_bot_state')
    and classification = 'DELETE') = 7);

  raise notice 'PASS: board follow-up integrity';
end $$;

rollback;

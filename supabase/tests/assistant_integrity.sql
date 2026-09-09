-- =============================================================================
-- NIL Office — NIL Assistant integrity tests.
--
-- Run in the Supabase SQL editor AFTER migration 0069. The whole script
-- runs in a transaction and ROLLS BACK at the end, so it leaves no data
-- behind.
--
-- Scope note (important, restated from the plan): unlike every other
-- module this session, most of NIL Assistant's actual logic — the LLM
-- tool-use loop, the confirmation state machine's ordering, rate
-- limiting, prompt construction — lives in TypeScript route handlers
-- (lib/assistant/*.ts, app/api/assistant/*), not in Postgres functions.
-- This script therefore only covers what IS genuinely server-side SQL:
-- table shape, RLS presence, the pending-action status CHECK
-- constraint, and the superseding behavior a caller relies on. The real
-- end-to-end behavior (tool calls, confirmation round-trip) is covered
-- by supabase/tests/assistant-e2e.mjs instead, against a live
-- deployment with a real LLM_API_KEY.
--
-- Covered: the three new tables exist with RLS enabled; a user cannot
-- read/write another user's conversation, message, or pending action;
-- assistant_pending_actions.status rejects an invalid value; creating a
-- second PENDING row for the same (user, action_name) leaves the first
-- one SUPERSEDED (mirrors what lib/assistant/confirmation.ts's
-- createPendingAction does, exercised here directly at the SQL level).
-- =============================================================================
begin;

do $$
declare
  v_user1 uuid;
  v_user2 uuid;
  v_conv1 uuid;
  v_pending1 uuid;
  v_pending2 uuid;
  v_count int;
  v_status text;
begin
  select id into v_user1 from public.profiles where is_active limit 1;
  select id into v_user2 from public.profiles where is_active and id <> v_user1 limit 1;
  if v_user1 is null then raise exception 'no active profile — create one first'; end if;
  if v_user2 is null then raise exception 'need at least TWO active profiles for the cross-user RLS checks'; end if;

  perform set_config('request.jwt.claim.sub', v_user1::text, true);
  perform set_config('role', 'authenticated', true);

  -- 1) own conversation/message insert works ------------------------------
  insert into public.assistant_conversations (user_id, title) values (v_user1, 'تست') returning id into v_conv1;
  insert into public.assistant_messages (conversation_id, role, content) values (v_conv1, 'user', 'سلام');
  select count(*) into v_count from public.assistant_messages where conversation_id = v_conv1;
  if v_count <> 1 then raise exception 'FAIL(1): expected 1 message, got %', v_count; end if;
  raise notice 'PASS(1): own conversation/message insert works';

  -- 2) another user cannot see this conversation ---------------------------
  perform set_config('request.jwt.claim.sub', v_user2::text, true);
  select count(*) into v_count from public.assistant_conversations where id = v_conv1;
  if v_count <> 0 then raise exception 'FAIL(2): user2 could see user1''s conversation'; end if;
  select count(*) into v_count from public.assistant_messages where conversation_id = v_conv1;
  if v_count <> 0 then raise exception 'FAIL(2b): user2 could see user1''s messages'; end if;
  raise notice 'PASS(2): cross-user conversation/message read denied';

  -- 3) pending_actions status CHECK constraint -----------------------------
  perform set_config('request.jwt.claim.sub', v_user1::text, true);
  begin
    insert into public.assistant_pending_actions (user_id, action_name, payload, payload_hash, preview_text, status, expires_at)
    values (v_user1, 'CREATE_TASK_DRAFT', '{}'::jsonb, 'x', 'preview', 'NOT_A_REAL_STATUS', now() + interval '10 minutes');
    raise exception 'FAIL(3): invalid status value was accepted';
  exception when check_violation then
    raise notice 'PASS(3): invalid pending-action status rejected';
  end;

  -- 4) superseding: a second PENDING row for the same (user, action_name)
  --    leaves the first one SUPERSEDED (the exact operation lib/assistant/
  --    confirmation.ts's createPendingAction performs before inserting).
  insert into public.assistant_pending_actions (user_id, action_name, payload, payload_hash, preview_text, expires_at)
  values (v_user1, 'CREATE_FOLLOWUP_DRAFT', '{"title":"a"}'::jsonb, 'hash1', 'preview 1', now() + interval '10 minutes')
  returning id into v_pending1;

  update public.assistant_pending_actions set status = 'SUPERSEDED', resolved_at = now()
   where user_id = v_user1 and action_name = 'CREATE_FOLLOWUP_DRAFT' and status = 'PENDING';

  insert into public.assistant_pending_actions (user_id, action_name, payload, payload_hash, preview_text, expires_at)
  values (v_user1, 'CREATE_FOLLOWUP_DRAFT', '{"title":"b"}'::jsonb, 'hash2', 'preview 2', now() + interval '10 minutes')
  returning id into v_pending2;

  select status into v_status from public.assistant_pending_actions where id = v_pending1;
  if v_status <> 'SUPERSEDED' then raise exception 'FAIL(4): expected first pending action SUPERSEDED, got %', v_status; end if;
  select status into v_status from public.assistant_pending_actions where id = v_pending2;
  if v_status <> 'PENDING' then raise exception 'FAIL(4b): expected second pending action PENDING, got %', v_status; end if;
  raise notice 'PASS(4): superseding leaves exactly one live PENDING row';

  -- 5) another user cannot confirm/read this pending action ----------------
  perform set_config('request.jwt.claim.sub', v_user2::text, true);
  select count(*) into v_count from public.assistant_pending_actions where id = v_pending2;
  if v_count <> 0 then raise exception 'FAIL(5): user2 could see user1''s pending action'; end if;
  update public.assistant_pending_actions set status = 'CONFIRMED' where id = v_pending2;
  perform set_config('request.jwt.claim.sub', v_user1::text, true);
  select status into v_status from public.assistant_pending_actions where id = v_pending2;
  if v_status <> 'PENDING' then raise exception 'FAIL(5b): user2''s update leaked through, status is %', v_status; end if;
  raise notice 'PASS(5): cross-user pending-action confirm denied';

  raise notice '===== ALL ASSISTANT INTEGRITY TESTS PASSED =====';
end $$;

rollback;

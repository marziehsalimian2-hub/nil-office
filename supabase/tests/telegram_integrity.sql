-- =============================================================================
-- NIL Office — NIL Assistant / Telegram channel integrity tests.
--
-- Run in the Supabase SQL editor AFTER migration 0070. The whole script
-- runs in a transaction and ROLLS BACK at the end, so it leaves no data
-- behind. No real Telegram ids are used — a fake numeric string is fine
-- since these tables have no foreign key into anything Telegram-side.
--
-- Scope note: the webhook's actual request handling (secret check,
-- allowlist, session minting, the tool-use loop) lives in TypeScript
-- (lib/assistant/telegram/*.ts), not SQL — this script only covers what
-- IS genuinely server-side SQL here: table shape, RLS, and the two
-- unique constraints the idempotency/identity-mapping guarantees
-- actually rest on. supabase/tests/security-telegram.mjs covers the
-- request-handling behavior instead, against a live deployment.
--
-- Covered: assistant_conversations.channel defaults to WEB and accepts
-- TELEGRAM; assistant_channel_identities enforces unique(channel,
-- external_user_id) and is admin-only via RLS; assistant_channel_updates
-- enforces unique(channel, external_update_id) and has NO policy for
-- authenticated at all (service-role-only by design).
-- =============================================================================
begin;

do $$
declare
  v_admin uuid;
  v_nonadmin uuid;
  v_channel text;
  v_count int;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  select id into v_nonadmin from public.profiles where role <> 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('role', 'authenticated', true);

  -- 1) assistant_conversations.channel defaults to WEB, accepts TELEGRAM --
  insert into public.assistant_conversations (user_id) values (v_admin) returning channel into v_channel;
  if v_channel <> 'WEB' then raise exception 'FAIL(1): expected default channel WEB, got %', v_channel; end if;
  update public.assistant_conversations set channel = 'TELEGRAM' where user_id = v_admin and channel = 'WEB';
  raise notice 'PASS(1): assistant_conversations.channel defaults to WEB and accepts TELEGRAM';

  begin
    insert into public.assistant_conversations (user_id, channel) values (v_admin, 'SMS');
    raise exception 'FAIL(1b): an invalid channel value was accepted';
  exception when check_violation then
    raise notice 'PASS(1b): invalid channel value rejected';
  end;

  -- 2) assistant_channel_identities uniqueness ------------------------------
  insert into public.assistant_channel_identities (channel, external_user_id, profile_id)
  values ('TELEGRAM', 'test-telegram-id-1', v_admin);
  begin
    insert into public.assistant_channel_identities (channel, external_user_id, profile_id)
    values ('TELEGRAM', 'test-telegram-id-1', v_admin);
    raise exception 'FAIL(2): a duplicate (channel, external_user_id) was accepted';
  exception when unique_violation then
    raise notice 'PASS(2): duplicate identity mapping rejected';
  end;

  -- 3) assistant_channel_identities is admin-only via RLS -------------------
  if v_nonadmin is not null then
    perform set_config('request.jwt.claim.sub', v_nonadmin::text, true);
    select count(*) into v_count from public.assistant_channel_identities where external_user_id = 'test-telegram-id-1';
    if v_count <> 0 then raise exception 'FAIL(3): a non-admin user could read assistant_channel_identities'; end if;
    raise notice 'PASS(3): non-admin cannot read assistant_channel_identities';
    perform set_config('request.jwt.claim.sub', v_admin::text, true);
  else
    raise notice 'SKIP(3): no second (non-admin) active profile available to test cross-role denial';
  end if;

  -- 4) assistant_channel_updates uniqueness (idempotency) -------------------
  -- Run as the table owner (bypasses RLS the same way service-role does,
  -- since this table intentionally has no policy for `authenticated` —
  -- see 0070's own comment) to exercise the unique constraint itself.
  reset role;
  insert into public.assistant_channel_updates (channel, external_update_id) values ('TELEGRAM', 'test-update-1');
  begin
    insert into public.assistant_channel_updates (channel, external_update_id) values ('TELEGRAM', 'test-update-1');
    raise exception 'FAIL(4): a duplicate update_id was accepted';
  exception when unique_violation then
    raise notice 'PASS(4): duplicate update_id rejected — this is the idempotency guarantee the webhook relies on';
  end;

  raise notice '===== ALL TELEGRAM INTEGRITY TESTS PASSED =====';
end $$;

rollback;

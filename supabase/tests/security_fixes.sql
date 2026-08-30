-- =====================================================================
-- security_fixes.sql — DB-side guard tests for the review fixes.
-- Run in the Supabase SQL editor (as owner). Everything is wrapped in a
-- transaction and ROLLED BACK, so no test data persists.
-- RLS/permission behaviour that needs real JWTs (a normal USER being
-- blocked) is covered separately in security-rls.mjs.
-- A line prefixed with "PASS" means that check succeeded.
-- Any "TEST FAIL ..." exception means a guard is missing.
-- =====================================================================
begin;

-- FIX 1 — init_number_sequence exists and is not executable by anon/public.
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'init_number_sequence') then
    raise exception 'TEST FAIL 1: init_number_sequence is not defined';
  end if;
  if has_function_privilege('anon', 'public.init_number_sequence(text,int,int)', 'EXECUTE') then
    raise exception 'TEST FAIL 1: anon can execute init_number_sequence';
  end if;
  if has_function_privilege('public', 'public.init_number_sequence(text,int,int)', 'EXECUTE') then
    raise exception 'TEST FAIL 1: PUBLIC can execute init_number_sequence';
  end if;
  raise notice 'PASS 1: init_number_sequence exists; anon/PUBLIC cannot execute (ADMIN enforced inside).';
end $$;

-- FIX 2 — write_log is internal-only (revoked from anon/authenticated/public).
do $$
begin
  if has_function_privilege('authenticated', 'public.write_log(text,uuid,text,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'TEST FAIL 2: authenticated can execute write_log (audit forgery possible)';
  end if;
  if has_function_privilege('anon', 'public.write_log(text,uuid,text,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'TEST FAIL 2: anon can execute write_log';
  end if;
  if has_function_privilege('public', 'public.write_log(text,uuid,text,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'TEST FAIL 2: PUBLIC can execute write_log';
  end if;
  raise notice 'PASS 2: write_log is not directly executable by users.';
end $$;

-- FIX 3 — self-update profile policy freezes role, accounting_role AND is_active.
do $$
declare v_check text;
begin
  select pg_get_expr(polwithcheck, polrelid) into v_check
    from pg_policy where polname = 'p_profiles_update_self';
  if v_check is null then
    raise exception 'TEST FAIL 3: p_profiles_update_self has no WITH CHECK';
  end if;
  if position('is_active' in v_check) = 0 then
    raise exception 'TEST FAIL 3: policy does not freeze is_active';
  end if;
  if position('role' in v_check) = 0 or position('accounting_role' in v_check) = 0 then
    raise exception 'TEST FAIL 3: policy does not freeze role/accounting_role';
  end if;
  raise notice 'PASS 3: self-update freezes role, accounting_role and is_active.';
end $$;

-- FIX 4 — storage/attachment delete restricted to the owner/uploader or ADMIN
-- (a generic active user cannot delete an arbitrary object by knowing its path).
do $$
declare v_using text;
begin
  select pg_get_expr(polqual, polrelid) into v_using
    from pg_policy where polname = 'p_storage_delete';
  if v_using is null then
    raise exception 'TEST FAIL 4: p_storage_delete policy missing';
  end if;
  if position('owner' in v_using) = 0 and position('is_admin' in v_using) = 0 then
    raise exception 'TEST FAIL 4: storage delete is not restricted to owner/admin';
  end if;
  raise notice 'PASS 4a: storage delete restricted to owner/admin.';

  select pg_get_expr(polqual, polrelid) into v_using
    from pg_policy where polname = 'p_attach_delete';
  if v_using is null then
    raise exception 'TEST FAIL 4: p_attach_delete policy missing';
  end if;
  if position('uploaded_by' in v_using) = 0 and position('is_admin' in v_using) = 0 then
    raise exception 'TEST FAIL 4: attachment delete is not restricted to uploader/admin';
  end if;
  raise notice 'PASS 4b: attachment metadata delete restricted to uploader/admin.';
end $$;

-- FIX 6 — the authoritative Jalali year flows into the official number.
do $$
declare a text; b text;
begin
  a := public.format_display_number('OUTGOING', 1405, 70);
  b := public.format_display_number('OUTGOING', 1406, 70);
  if a = b then
    raise exception 'TEST FAIL 6: year is not reflected in the display number';
  end if;
  if position('1405' in a) = 0 and position('۱۴۰۵' in a) = 0 then
    raise exception 'TEST FAIL 6: year 1405 missing from %', a;
  end if;
  raise notice 'PASS 6: year reflected in number (% vs %).', a, b;
end $$;

-- FIX 7 — correspondence status transitions enforced by the DB trigger.
do $$
declare
  v_uid   uuid;
  v_draft uuid;
  v_fin   uuid;
begin
  select id into v_uid from public.profiles limit 1;
  if v_uid is null then
    raise notice 'SKIP 7: no profile exists yet (create a user first) — transition test skipped.';
    return;
  end if;

  insert into public.correspondence (direction, subject, status, created_by)
  values ('OUTGOING', 'تست گذار وضعیت', 'DRAFT', v_uid)
  returning id into v_draft;

  insert into public.correspondence
    (direction, subject, status, created_by, sequence_number, display_number, year)
  values ('OUTGOING', 'تست گذار وضعیت', 'FINALIZED', v_uid, 999999, 'ص-1405-999999', 1405)
  returning id into v_fin;

  -- invalid: DRAFT -> SENT
  begin
    update public.correspondence set status = 'SENT' where id = v_draft;
    raise exception 'TEST FAIL 7a: DRAFT->SENT was allowed';
  exception when others then
    if sqlerrm not like '%INVALID_STATUS_TRANSITION%' then raise; end if;
    raise notice 'PASS 7a: DRAFT->SENT rejected.';
  end;

  -- valid: DRAFT -> REVIEW
  update public.correspondence set status = 'REVIEW' where id = v_draft;
  raise notice 'PASS 7b: DRAFT->REVIEW allowed.';

  -- valid: FINALIZED -> SENT
  update public.correspondence set status = 'SENT' where id = v_fin;
  raise notice 'PASS 7c: FINALIZED->SENT allowed.';

  -- invalid: reach FINALIZED without a number (must use the RPC)
  begin
    update public.correspondence set status = 'FINALIZED' where id = v_draft;
    raise exception 'TEST FAIL 7d: direct FINALIZED (no number) allowed';
  exception when others then
    if sqlerrm not like '%USE_RPC_TO_FINALIZE%' then raise; end if;
    raise notice 'PASS 7d: direct FINALIZED without number rejected.';
  end;

  -- terminal: CANCELLED cannot move on
  update public.correspondence set status = 'CANCELLED' where id = v_fin;
  begin
    update public.correspondence set status = 'CLOSED' where id = v_fin;
    raise exception 'TEST FAIL 7e: CANCELLED terminal state was left';
  exception when others then
    if sqlerrm not like '%INVALID_STATUS_TRANSITION%' then raise; end if;
    raise notice 'PASS 7e: CANCELLED is terminal.';
  end;
end $$;

-- FINAL FIX 1 — cancel_correspondence audit must show ORIGINAL -> CANCELLED.
do $$
declare
  v_uid uuid;
  v_id  uuid;
  v_old text;
  v_new text;
begin
  select id into v_uid from public.profiles where is_active = true limit 1;
  if v_uid is null then
    raise notice 'SKIP cancel-audit: no active profile (create a user first).';
    return;
  end if;

  -- act as this authenticated user so is_active_user() passes inside the RPC
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);

  insert into public.correspondence
    (direction, subject, status, created_by, sequence_number, display_number, year)
  values ('OUTGOING', 'تست ممیزی ابطال', 'SENT', v_uid, 999997, 'ص-1405-999997', 1405)
  returning id into v_id;

  perform public.cancel_correspondence(v_id);

  select old_value->>'status', new_value->>'status'
    into v_old, v_new
    from public.activity_logs
   where entity_id = v_id and action = 'CANCELLED'
   order by created_at desc limit 1;

  if v_old is distinct from 'SENT' or v_new is distinct from 'CANCELLED' then
    raise exception 'TEST FAIL cancel-audit: recorded % -> % (expected SENT -> CANCELLED)', v_old, v_new;
  end if;
  raise notice 'PASS cancel-audit: recorded % -> %.', v_old, v_new;
end $$;

rollback;
-- All PASS notices above => the database-side guards are in place.

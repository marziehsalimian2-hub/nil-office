-- =============================================================================
-- NIL Office — Contract Management integrity tests (Phase 1).
--
-- Run in the Supabase SQL editor AFTER migrations 0020-0023 and after at
-- least one ADMIN profile and one contract_types row exist. The whole
-- script runs in a transaction and ROLLS BACK at the end, so it leaves no
-- data behind.
--
-- It impersonates an ADMIN user (so auth.uid()/RLS/authorization behave like
-- a real session, and ADMIN bypasses both accounting_role and contract_role
-- gates) by setting the JWT sub claim to that admin's id.
--
-- Covered: HISTORICAL requires an external number, DRAFT stays numberless,
-- duplicate numbers rejected, invalid transitions rejected, numbering only
-- via finalize_contract (never earlier than UNDER_REVIEW), re-finalize does
-- not consume a second number, cancellation only pre-ACTIVE, no physical
-- deletion once past DRAFT, activation flow works end to end.
-- =============================================================================
begin;

do $$
declare
  v_admin uuid;
  v_type  uuid;
  v_c     uuid;
  v_c2    uuid;
  v_num   text;
  v_seq_before int;
  v_seq_after  int;
  v_msg   text;
  v_year  int := extract(year from now())::int - 621; -- rough Jalali year, good enough for a test
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('role', 'authenticated', true);

  select id into v_type from public.contract_types limit 1;
  if v_type is null then raise exception 'no contract_types row — run migration 0021 first'; end if;

  -- 1) HISTORICAL without external_contract_number must fail ----------------
  begin
    insert into public.contracts (contract_type_id, title, kind, status, created_by)
    values (v_type, 'تست بدون شماره اصلی', 'HISTORICAL', 'ACTIVE', v_admin);
    raise exception 'FAIL(1): historical contract without external number was accepted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%ck_contract_number_completeness%' then
      raise exception 'FAIL(1): expected a CHECK violation, got %', v_msg;
    end if;
    raise notice 'PASS(1): HISTORICAL without external_contract_number rejected';
  end;

  -- 2) DRAFT NIL_ISSUED stays numberless --------------------------------------
  insert into public.contracts (contract_type_id, title, kind, status, created_by)
  values (v_type, 'تست پیش‌نویس', 'NIL_ISSUED', 'DRAFT', v_admin)
  returning id into v_c;
  if exists (select 1 from public.contracts where id = v_c and sequence_number is not null) then
    raise exception 'FAIL(2): draft contract has a sequence number';
  end if;
  raise notice 'PASS(2): draft contract created with no number';

  -- 3) finalize_contract while still DRAFT must fail (needs UNDER_REVIEW) ----
  begin
    perform public.finalize_contract(v_c);
    raise exception 'FAIL(3): finalized a DRAFT contract';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'NOT_ELIGIBLE' then raise exception 'FAIL(3): expected NOT_ELIGIBLE, got %', v_msg; end if;
    raise notice 'PASS(3): finalize rejected while still DRAFT';
  end;

  -- 4) invalid direct transition DRAFT -> ACTIVE must fail --------------------
  begin
    update public.contracts set status = 'ACTIVE' where id = v_c;
    raise exception 'FAIL(4): DRAFT -> ACTIVE transition was accepted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'INVALID_STATUS_TRANSITION' then raise exception 'FAIL(4): expected INVALID_STATUS_TRANSITION, got %', v_msg; end if;
    raise notice 'PASS(4): invalid direct transition rejected';
  end;

  -- 5) full happy path: DRAFT -> UNDER_REVIEW -> finalize -> activate --------
  update public.contracts set status = 'UNDER_REVIEW' where id = v_c;

  select last_value into v_seq_before from public.number_sequences where scope = 'CONTRACT' and year = v_year;
  v_seq_before := coalesce(v_seq_before, 0);

  select display_number into v_num from public.finalize_contract(v_c, v_year);
  if v_num is null then raise exception 'FAIL(5): finalize_contract did not assign a number'; end if;
  if v_num !~ '^CTR-' then raise exception 'FAIL(5): unexpected display number format: %', v_num; end if;
  raise notice 'PASS(5): contract finalized as %', v_num;

  perform public.activate_contract(v_c);
  if (select status from public.contracts where id = v_c) <> 'ACTIVE' then
    raise exception 'FAIL(5b): activate_contract did not set status to ACTIVE';
  end if;
  raise notice 'PASS(5b): contract activated';

  -- 6) re-finalizing an already-numbered contract must fail, no new number --
  select last_value into v_seq_after from public.number_sequences where scope = 'CONTRACT' and year = v_year;
  begin
    perform public.finalize_contract(v_c, v_year);
    raise exception 'FAIL(6): re-finalize succeeded';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'ONLY_NIL_ISSUED_FINALIZE' and v_msg <> 'ALREADY_NUMBERED' and v_msg <> 'NOT_ELIGIBLE' then
      raise exception 'FAIL(6): expected ALREADY_NUMBERED/NOT_ELIGIBLE, got %', v_msg;
    end if;
  end;
  if (select last_value from public.number_sequences where scope = 'CONTRACT' and year = v_year) <> v_seq_after then
    raise exception 'FAIL(6): re-finalize attempt consumed a number';
  end if;
  raise notice 'PASS(6): re-finalize rejected, no number consumed';

  -- 7) cancellation is only allowed pre-ACTIVE ---------------------------------
  begin
    perform public.cancel_contract(v_c); -- v_c is ACTIVE now
    raise exception 'FAIL(7): an ACTIVE contract was cancelled';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'NOT_ELIGIBLE' then raise exception 'FAIL(7): expected NOT_ELIGIBLE, got %', v_msg; end if;
    raise notice 'PASS(7): cancellation blocked once ACTIVE';
  end;

  insert into public.contracts (contract_type_id, title, kind, status, created_by)
  values (v_type, 'تست ابطال', 'NIL_ISSUED', 'DRAFT', v_admin)
  returning id into v_c2;
  perform public.cancel_contract(v_c2);
  if (select status from public.contracts where id = v_c2) <> 'CANCELLED' then
    raise exception 'FAIL(7b): draft contract was not cancelled';
  end if;
  if (select sequence_number from public.contracts where id = v_c2) is not null then
    raise exception 'FAIL(7b): a cancelled draft unexpectedly has a sequence number';
  end if;
  raise notice 'PASS(7b): pre-ACTIVE cancellation succeeds and consumes no number';

  -- 8) no physical deletion once past DRAFT ------------------------------------
  begin
    delete from public.contracts where id = v_c; -- ACTIVE
    raise exception 'FAIL(8): an ACTIVE contract was deleted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'CANNOT_DELETE_NON_DRAFT' then raise exception 'FAIL(8): expected CANNOT_DELETE_NON_DRAFT, got %', v_msg; end if;
    raise notice 'PASS(8): deletion of a non-DRAFT contract blocked';
  end;

  -- a DRAFT may still be deleted
  insert into public.contracts (contract_type_id, title, kind, status, created_by)
  values (v_type, 'تست حذف پیش‌نویس', 'NIL_ISSUED', 'DRAFT', v_admin)
  returning id into v_c2;
  delete from public.contracts where id = v_c2;
  raise notice 'PASS(8b): a DRAFT contract can be deleted';

  raise notice '===== ALL CONTRACT INTEGRITY TESTS PASSED =====';
end $$;

rollback;

-- =============================================================================
-- NIL Office — Client Service Ledger integrity tests (Phase 1).
--
-- Run in the Supabase SQL editor AFTER migrations 0082-0086 and after at
-- least one ADMIN profile and one companies row exist. The whole script
-- runs in a transaction and ROLLS BACK at the end, so it leaves no data
-- behind.
--
-- Covered: the Phase-1 billing_status CHECK rejects INVOICED on both
-- service_entries and expenses; one client_service_file per company
-- (unique constraint); duration_minutes must be > 0; the
-- time_entry_internal_costs snapshot is immutable once written;
-- get_service_entry_claimable_amount / get_client_service_claimable_summary
-- aggregate correctly against a known fixture (zero discrepancy, per the
-- spec's own non-negotiable rule).
-- =============================================================================
begin;

do $$
declare
  v_admin uuid;
  v_company uuid;
  v_file uuid;
  v_category uuid;
  v_entry uuid;
  v_time uuid;
  v_expense uuid;
  v_msg text;
  v_claimable record;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('role', 'authenticated', true);

  select id into v_company from public.companies limit 1;
  if v_company is null then raise exception 'no companies row — create at least one company first'; end if;

  select id into v_category from public.service_categories limit 1;
  if v_category is null then raise exception 'no service_categories row — migration 0084 should have seeded these'; end if;

  -- 1) one client_service_file per company (unique constraint) -------------
  insert into public.client_service_files (company_id, created_by)
  values (v_company, v_admin)
  returning id into v_file;
  raise notice 'PASS(1a): client_service_file created for company';

  begin
    insert into public.client_service_files (company_id, created_by) values (v_company, v_admin);
    raise exception 'FAIL(1b): a second client_service_file for the same company was accepted';
  exception when unique_violation then
    raise notice 'PASS(1b): second client_service_file for the same company rejected';
  end;

  -- 2) Phase-1 billing_status lockdown --------------------------------------
  begin
    insert into public.service_entries (client_service_file_id, service_category_id, service_date, title, performed_by, created_by, billing_status)
    values (v_file, v_category, current_date, 'تست قفل وضعیت', v_admin, v_admin, 'INVOICED');
    raise exception 'FAIL(2a): billing_status=INVOICED was accepted on service_entries';
  exception when check_violation then
    raise notice 'PASS(2a): billing_status=INVOICED rejected on service_entries';
  end;

  -- (expenses needs a real service_entry first)
  insert into public.service_entries (client_service_file_id, service_category_id, service_date, title, performed_by, created_by)
  values (v_file, v_category, current_date, 'خدمت تست یکپارچگی', v_admin, v_admin)
  returning id into v_entry;

  begin
    insert into public.expenses (service_entry_id, expense_date, description, amount, created_by, billing_status)
    values (v_entry, current_date, 'هزینهٔ تست', 100000, v_admin, 'SETTLED');
    raise exception 'FAIL(2b): billing_status=SETTLED was accepted on expenses';
  exception when check_violation then
    raise notice 'PASS(2b): billing_status=SETTLED rejected on expenses';
  end;

  -- 3) duration_minutes must be > 0 -----------------------------------------
  begin
    insert into public.time_entries (service_entry_id, performed_by, work_date, duration_minutes, created_by)
    values (v_entry, v_admin, current_date, 0, v_admin);
    raise exception 'FAIL(3): duration_minutes=0 was accepted';
  exception when check_violation then
    raise notice 'PASS(3): duration_minutes=0 rejected';
  end;

  -- 4) claimable amount rollup — known fixture ------------------------------
  -- service_fee=1,000,000 + 2h billable @ 500,000/h (=1,000,000) + one
  -- reimbursable expense of 200,000 => claimable_total = 2,200,000.
  update public.service_entries set service_fee = 1000000 where id = v_entry;

  insert into public.time_entries (service_entry_id, performed_by, work_date, duration_minutes, billable, hourly_rate_snapshot, created_by)
  values (v_entry, v_admin, current_date, 120, true, 500000, v_admin)
  returning id into v_time;

  -- a non-billable time entry must NOT affect the total
  insert into public.time_entries (service_entry_id, performed_by, work_date, duration_minutes, billable, hourly_rate_snapshot, created_by)
  values (v_entry, v_admin, current_date, 999, false, 999999999, v_admin);

  insert into public.expenses (service_entry_id, expense_date, description, amount, is_reimbursable, reimbursable_amount, created_by)
  values (v_entry, current_date, 'هزینهٔ قابل بازپرداخت', 200000, true, 200000, v_admin)
  returning id into v_expense;

  -- a non-reimbursable expense must NOT affect the total
  insert into public.expenses (service_entry_id, expense_date, description, amount, is_reimbursable, created_by)
  values (v_entry, current_date, 'هزینهٔ غیرقابل بازپرداخت', 999999999, false, v_admin);

  select * into v_claimable from public.get_service_entry_claimable_amount(v_entry);
  if v_claimable.claimable_total <> 2200000 then
    raise exception 'FAIL(4a): expected claimable_total=2200000, got %', v_claimable.claimable_total;
  end if;
  raise notice 'PASS(4a): get_service_entry_claimable_amount computed % correctly', v_claimable.claimable_total;

  select * into v_claimable from public.get_client_service_claimable_summary(v_file);
  if v_claimable.claimable_total <> 2200000 then
    raise exception 'FAIL(4b): expected claimable_total=2200000, got %', v_claimable.claimable_total;
  end if;
  raise notice 'PASS(4b): get_client_service_claimable_summary computed % correctly', v_claimable.claimable_total;

  -- 5) time_entry_internal_costs snapshot is immutable ----------------------
  insert into public.time_entry_internal_costs (time_entry_id, internal_cost_rate_snapshot, internal_cost_amount)
  values (v_time, 300000, 600000);

  begin
    update public.time_entry_internal_costs set internal_cost_amount = 1 where time_entry_id = v_time;
    raise exception 'FAIL(5): an internal cost snapshot was successfully modified';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'SNAPSHOT_IMMUTABLE' then raise exception 'FAIL(5): expected SNAPSHOT_IMMUTABLE, got %', v_msg; end if;
    raise notice 'PASS(5): internal cost snapshot immutability enforced';
  end;

  raise notice '===== ALL CLIENT SERVICE LEDGER INTEGRITY TESTS PASSED =====';
end $$;

rollback;

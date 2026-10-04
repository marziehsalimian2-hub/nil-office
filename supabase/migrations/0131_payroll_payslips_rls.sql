-- =====================================================================
-- NIL Office — 0131_payroll_payslips_rls.sql
-- HR & Payroll — Phase 6 — RLS + grants for payroll_payslips, the `payslips/%` path carve-out on all four storage.objects
-- policies (RESTATED from their CURRENT bodies in 0112, verified by grep; 0005/0011 are older), p_logs_read restated from the
-- CURRENT body (0129, verified by grep) + 'payroll_payslips', function grants.
-- Archive rules: payslip objects are readable by payroll-access users and by the OWNER only (via is_my_personnel);
-- insertable only by the payroll APPROVE tier; NEVER updatable or deletable (permanent archive, spec §53/§70).
-- No public / signed URLs: the download route streams with the caller's own session, so these policies ARE the gate.
-- service_role: NOT granted.
-- =====================================================================
alter table public.payroll_payslips enable row level security;

drop policy if exists p_payroll_payslips_read on public.payroll_payslips;
create policy p_payroll_payslips_read on public.payroll_payslips for select
  using (public.has_payroll_access() or public.is_my_personnel(personnel_id));
revoke all on public.payroll_payslips from anon;
grant select on public.payroll_payslips to authenticated;   -- 0013 gotcha: explicit grant

drop policy if exists p_storage_read on storage.objects;
create policy p_storage_read on storage.objects for select using (
  bucket_id = 'nil-files' and public.is_active_user()
  and (name not like 'personnel/%' or public.has_hr_access())
  and (name not like 'payslips/%' or public.has_payroll_access()
       or exists (select 1 from public.payroll_payslips s where s.storage_path = name and public.is_my_personnel(s.personnel_id)))
);

drop policy if exists p_storage_insert on storage.objects;
create policy p_storage_insert on storage.objects for insert with check (
  bucket_id = 'nil-files' and public.is_active_user()
  and (name not like 'personnel/%' or public.can_create_hr())
  and (name not like 'payslips/%' or public.can_approve_payroll())
);

drop policy if exists p_storage_update on storage.objects;
create policy p_storage_update on storage.objects for update using (
  bucket_id = 'nil-files' and (owner = auth.uid() or public.is_admin())
  and (name not like 'personnel/%' or public.can_create_hr())
  and name not like 'payslips/%'
);

drop policy if exists p_storage_delete on storage.objects;
create policy p_storage_delete on storage.objects for delete using (
  bucket_id = 'nil-files' and (owner = auth.uid() or public.is_admin())
  and (name not like 'personnel/%' or public.can_create_hr())
  and name not like 'payslips/%'
);

drop policy if exists p_logs_read on public.activity_logs;
create policy p_logs_read on public.activity_logs for select using (
  public.is_active_user()
  and (entity_type not in ('personnel', 'employment_records') or public.has_hr_access())
  and (entity_type not in ('salary_components','salary_component_versions','compensation_profiles',
                           'compensation_lines','legal_rule_sets','legal_rule_entries',
                           'payroll_periods','payroll_batches','payroll_eligibility_overrides','payroll_work_data',
                           'payroll_work_inputs','payroll_calculations','payroll_results','payroll_result_lines',
                           'payroll_calc_warnings','payroll_accounting_settings','payroll_component_accounts',
                           'payroll_payments','payroll_payslips') or public.has_payroll_access())
  and (entity_type <> 'personnel_payment_destinations' or public.can_view_payroll_bank_details())
  and (entity_type not in ('journal_entries','journal_entry_lines','journal_entry',
                           'payments','payment','receipts','receipt') or public.has_accounting_access())
);

do $$
declare f text;
begin
  foreach f in array array[
    'set_personnel_profile(uuid,uuid)',
    'payroll_payslip_data(uuid)',
    'register_payroll_payslip(uuid,uuid,text,text,bigint,text,text)',
    'payroll_payslips_for_batch(uuid)',
    'my_payslips()',
    'record_payslip_access(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- helpers used inside RLS policies must stay callable by the policy evaluator (authenticated); internal result helper must not
  execute 'revoke execute on function public.is_my_personnel(uuid) from public, anon';
  execute 'grant execute on function public.is_my_personnel(uuid) to authenticated';
  execute 'revoke execute on function public._payroll_result_payment(uuid) from public, anon, authenticated';
end $$;

-- =====================================================================
-- ROLLBACK: restore the 0129 p_logs_read body and the 0112 storage.objects policies (drop the payslips/% terms);
--   revoke select on payroll_payslips from authenticated; drop policy p_payroll_payslips_read; disable RLS.
-- =====================================================================

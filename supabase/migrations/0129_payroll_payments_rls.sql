-- =====================================================================
-- NIL Office — 0129_payroll_payments_rls.sql
-- HR & Payroll — Phase 5 — RLS + grants for payroll_payments, p_logs_read restated from the CURRENT body
-- (0126, verified by grep) + 'payroll_payments', and payments/receipts audit rows restricted to accounting users:
-- the generic tg_audit() copies WHOLE rows (payee + amount) into activity_logs, which every active user could read,
-- and payroll now creates payments for individual employees. (No UI reads these rows.)
-- SELECT-only policy/grant (RLS-by-omission for writes). service_role: NOT granted.
-- =====================================================================
alter table public.payroll_payments enable row level security;

drop policy if exists p_payroll_payments_read on public.payroll_payments;
create policy p_payroll_payments_read on public.payroll_payments for select using (public.has_payroll_access());
revoke all on public.payroll_payments from anon;
grant select on public.payroll_payments to authenticated;   -- 0013 gotcha: explicit grant

drop policy if exists p_logs_read on public.activity_logs;
create policy p_logs_read on public.activity_logs for select using (
  public.is_active_user()
  and (entity_type not in ('personnel', 'employment_records') or public.has_hr_access())
  and (entity_type not in ('salary_components','salary_component_versions','compensation_profiles',
                           'compensation_lines','legal_rule_sets','legal_rule_entries',
                           'payroll_periods','payroll_batches','payroll_eligibility_overrides','payroll_work_data',
                           'payroll_work_inputs','payroll_calculations','payroll_results','payroll_result_lines',
                           'payroll_calc_warnings','payroll_accounting_settings','payroll_component_accounts',
                           'payroll_payments') or public.has_payroll_access())
  and (entity_type <> 'personnel_payment_destinations' or public.can_view_payroll_bank_details())
  and (entity_type not in ('journal_entries','journal_entry_lines','journal_entry',
                           'payments','payment','receipts','receipt') or public.has_accounting_access())
);

do $$
declare f text;
begin
  foreach f in array array[
    'payroll_bank_accounts()',
    'payroll_payment_summary(uuid)',
    'create_payroll_payment_drafts(uuid,uuid,date,text,jsonb)',
    'discard_payroll_payment_drafts(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke execute on function public._payroll_has_live_payments(uuid) from public, anon, authenticated';
end $$;

-- =====================================================================
-- ROLLBACK: restore the 0126 p_logs_read body; revoke select on payroll_payments from authenticated;
--   drop policy p_payroll_payments_read; alter table public.payroll_payments disable row level security.
-- =====================================================================

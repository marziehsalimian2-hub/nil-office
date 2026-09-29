-- =====================================================================
-- NIL Office — 0095_internal_service_reports.sql
-- Client Service Ledger — Phase 5 (Internal Management Report).
--
-- Populates the report_family='INTERNAL' branch that 0093/0094 already
-- reserved schema readiness for. No new profitability math is added
-- here — get_client_service_profitability() (0092) already computes
-- everything this report needs; this migration only widens the
-- section allowlist and the RLS gate.
-- =====================================================================

create or replace function public.allowed_report_sections(p_report_family text)
returns text[]
language sql
stable
as $$
  select case
    when p_report_family = 'INTERNAL' then array[
      'COVER_PAGE','EXECUTIVE_SUMMARY','SERVICES_PERFORMED','SERVICE_DATE','SERVICE_CATEGORY',
      'SERVICE_DESCRIPTION','SERVICE_PERFORMER','TIME_SPENT','CONTRACTS_RELATED','PROJECTS_RELATED',
      'DIRECT_EXPENSES','REIMBURSABLE_EXPENSES','SERVICE_FEES','CLAIMABLE_AMOUNTS','INVOICES_PROFORMAS',
      'AMOUNTS_RECEIVED','OUTSTANDING_AMOUNT','BILLING_SUMMARY','DOCUMENTS_REFERENCE','PERIOD_SUMMARY',
      'CUSTOM_NOTES','FINAL_SUMMARY',
      'DATE','CATEGORY','SERVICE_TITLE','DESCRIPTION','PERFORMER','DURATION','SERVICE_FEE','EXPENSE',
      'CLAIMABLE_AMOUNT','BILLING_STATUS',
      'INTERNAL_TIME_COST','DIRECT_NIL_COST','REVENUE','REIMBURSED_COST','UNREIMBURSED_COST',
      'CONTRIBUTION_MARGIN','PROFITABILITY_ANALYSIS','INTERNAL_NOTES'
    ]::text[]
    else array[
      'COVER_PAGE','EXECUTIVE_SUMMARY','SERVICES_PERFORMED','SERVICE_DATE','SERVICE_CATEGORY',
      'SERVICE_DESCRIPTION','SERVICE_PERFORMER','TIME_SPENT','CONTRACTS_RELATED','PROJECTS_RELATED',
      'DIRECT_EXPENSES','REIMBURSABLE_EXPENSES','SERVICE_FEES','CLAIMABLE_AMOUNTS','INVOICES_PROFORMAS',
      'AMOUNTS_RECEIVED','OUTSTANDING_AMOUNT','BILLING_SUMMARY','DOCUMENTS_REFERENCE','PERIOD_SUMMARY',
      'CUSTOM_NOTES','FINAL_SUMMARY',
      'DATE','CATEGORY','SERVICE_TITLE','DESCRIPTION','PERFORMER','DURATION','SERVICE_FEE','EXPENSE',
      'CLAIMABLE_AMOUNT','BILLING_STATUS'
    ]::text[]
  end;
$$;

alter table public.client_service_reports add column if not exists custom_notes text;
alter table public.client_service_report_templates add column if not exists default_custom_notes text;

-- RLS: an 'INTERNAL' row additionally requires can_view_internal_cost()
-- — both at insert time AND every later read, so an already-archived
-- internal report can't be read by someone who loses/never had that
-- tier. 'CLIENT' rows are completely unaffected (the added clause is a
-- no-op for them).
drop policy if exists p_client_service_reports_read  on public.client_service_reports;
drop policy if exists p_client_service_reports_write on public.client_service_reports;

create policy p_client_service_reports_read on public.client_service_reports
  for select using (
    public.has_service_ledger_access()
    and (report_family = 'CLIENT' or public.can_view_internal_cost())
  );

create policy p_client_service_reports_write on public.client_service_reports
  for insert with check (
    public.can_create_service_entry()
    and (report_family = 'CLIENT' or public.can_view_internal_cost())
  );

drop policy if exists p_report_templates_read   on public.client_service_report_templates;
drop policy if exists p_report_templates_write  on public.client_service_report_templates;
drop policy if exists p_report_templates_update on public.client_service_report_templates;

create policy p_report_templates_read on public.client_service_report_templates
  for select using (
    public.has_service_ledger_access()
    and (report_family = 'CLIENT' or public.can_view_internal_cost())
  );

create policy p_report_templates_write on public.client_service_report_templates
  for insert with check (
    public.can_create_service_entry()
    and (report_family = 'CLIENT' or public.can_view_internal_cost())
  );

create policy p_report_templates_update on public.client_service_report_templates
  for update
  using (public.can_create_service_entry() and (report_family = 'CLIENT' or public.can_view_internal_cost()))
  with check (public.can_create_service_entry() and (report_family = 'CLIENT' or public.can_view_internal_cost()));

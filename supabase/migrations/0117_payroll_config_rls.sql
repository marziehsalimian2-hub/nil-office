-- =====================================================================
-- NIL Office — 0117_payroll_config_rls.sql
-- HR & Payroll — Phase 2 — RLS + grants + activity_logs narrowing.
-- SELECT-only policies; NO insert/update/delete policy (RLS-by-omission, 0112/0100
-- pattern) and SELECT-only grants (least privilege for confidential tables;
-- deliberate tightening vs 0112's full-privilege grants). The 0013 gotcha is
-- satisfied: explicit GRANT SELECT TO authenticated on every table.
-- service_role: NOT granted — the Telegram/Assistant path does not touch
-- these tables in Phase 2.
-- =====================================================================
alter table public.salary_components              enable row level security;
alter table public.salary_component_versions      enable row level security;
alter table public.compensation_profiles          enable row level security;
alter table public.compensation_lines             enable row level security;
alter table public.personnel_payment_destinations enable row level security;
alter table public.legal_rule_sets                enable row level security;
alter table public.legal_rule_entries             enable row level security;
alter table public.legal_rule_set_transitions     enable row level security;

drop policy if exists p_salary_components_read on public.salary_components;
create policy p_salary_components_read on public.salary_components for select using (public.has_payroll_access());
drop policy if exists p_salary_component_versions_read on public.salary_component_versions;
create policy p_salary_component_versions_read on public.salary_component_versions for select using (public.has_payroll_access());
drop policy if exists p_compensation_profiles_read on public.compensation_profiles;
create policy p_compensation_profiles_read on public.compensation_profiles for select using (public.has_payroll_access());
drop policy if exists p_compensation_lines_read on public.compensation_lines;
create policy p_compensation_lines_read on public.compensation_lines for select using (public.has_payroll_access());
drop policy if exists p_personnel_payment_destinations_read on public.personnel_payment_destinations;
create policy p_personnel_payment_destinations_read on public.personnel_payment_destinations for select using (public.can_view_payroll_bank_details());
drop policy if exists p_legal_rule_sets_read on public.legal_rule_sets;
create policy p_legal_rule_sets_read on public.legal_rule_sets for select using (public.has_payroll_access());
drop policy if exists p_legal_rule_entries_read on public.legal_rule_entries;
create policy p_legal_rule_entries_read on public.legal_rule_entries for select using (public.has_payroll_access());
drop policy if exists p_legal_rule_set_transitions_read on public.legal_rule_set_transitions;
create policy p_legal_rule_set_transitions_read on public.legal_rule_set_transitions for select using (public.has_payroll_access());

grant select on public.salary_components, public.salary_component_versions, public.compensation_profiles,
  public.compensation_lines, public.personnel_payment_destinations, public.legal_rule_sets,
  public.legal_rule_entries, public.legal_rule_set_transitions to authenticated;

-- activity_logs: CURRENT body (0113) + payroll entity types. Bank-destination logs need the bank tier.
drop policy if exists p_logs_read on public.activity_logs;
create policy p_logs_read on public.activity_logs for select using (
  public.is_active_user()
  and (entity_type not in ('personnel', 'employment_records') or public.has_hr_access())
  and (entity_type not in ('salary_components','salary_component_versions','compensation_profiles',
                           'compensation_lines','legal_rule_sets','legal_rule_entries') or public.has_payroll_access())
  and (entity_type <> 'personnel_payment_destinations' or public.can_view_payroll_bank_details())
);

-- =====================================================================
-- ROLLBACK
-- drop policy if exists p_logs_read on public.activity_logs;
-- create policy p_logs_read on public.activity_logs for select using (
--   public.is_active_user() and (entity_type not in ('personnel','employment_records') or public.has_hr_access()));  -- 0113 body
-- revoke select on <the 8 tables> from authenticated; drop the 8 p_*_read policies; alter table ... disable row level security;
-- =====================================================================

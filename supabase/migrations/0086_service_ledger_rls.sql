-- =====================================================================
-- NIL Office — 0086_service_ledger_rls.sql
-- Client Service Ledger — Phase 1 — RLS + grants.
--
--   * client_service_files/service_arrangements/service_categories ->
--     standard 4-tier service_ledger_role loop (has_service_ledger_access
--     / can_create_service_entry / is_service_ledger_admin), same shape
--     every prior module used. service_categories write is admin-only
--     (mirrors contract_types).
--
--   * service_entries/expenses -> DELIBERATELY NOT the same loop, same
--     reasoning as tasks (0054_project_task_rls.sql): Quick Add's whole
--     premise is that any active user logs their own work, and — like
--     tasks — the SELECT policy must let a creator read back their own
--     row even without a formal service_ledger_role, or Quick Add would
--     create rows the creator immediately can't see. So:
--       SELECT: has_service_ledger_access() OR you created it OR
--               (service_entries only) you performed it.
--       INSERT: any active user (is_active_user()), same bar tasks uses
--               — logging your own work is not a role-gated action.
--       UPDATE: creator OR can_approve_service_entry().
--       DELETE: creator while still DRAFT (service_entries only) OR
--               is_service_ledger_admin().
--     Do NOT "fix" this back to the uniform 4-policy loop later — it is
--     intentionally different, matching this project's approved plan.
--
--   * time_entries -> same shape as service_entries (own work log).
--
--   * time_entry_internal_costs -> confidentiality split table (plan
--     decision #2): SELECT/UPDATE/DELETE = can_view_internal_cost() OR
--     performed_by = auth.uid() (an employee can see their OWN
--     snapshotted cost, per the user's explicit choice — not admin-only).
--     INSERT is checked against the PARENT time_entries row's own
--     creator, not a column on this table.
--
--   * internal_cost_rates -> ADMIN-tier only, all four operations (this
--     is the rate-management table, not a personal log).
-- =====================================================================

-- 10th layering of the self-escalation freeze on profiles — already
-- applied in 0082_service_ledger_role.sql (kept there since that's where
-- the service_ledger_role column itself was added, matching how
-- 0073_cheque_role.sql did both in one file). No further change needed
-- here.

alter table public.client_service_files      enable row level security;
alter table public.service_arrangements      enable row level security;
alter table public.service_categories        enable row level security;
alter table public.service_entries           enable row level security;
alter table public.time_entries              enable row level security;
alter table public.time_entry_internal_costs enable row level security;
alter table public.internal_cost_rates       enable row level security;
alter table public.expenses                  enable row level security;

-- Generic policy generator for the uniform-loop tables.
do $$
declare t text;
begin
  foreach t in array array['client_service_files','service_arrangements']
  loop
    execute format('drop policy if exists p_%1$s_read   on public.%1$s;', t);
    execute format('drop policy if exists p_%1$s_write  on public.%1$s;', t);
    execute format('drop policy if exists p_%1$s_update on public.%1$s;', t);
    execute format('drop policy if exists p_%1$s_delete on public.%1$s;', t);
    execute format('create policy p_%1$s_read   on public.%1$s for select using (public.has_service_ledger_access());', t);
    execute format('create policy p_%1$s_write  on public.%1$s for insert with check (public.can_create_service_entry());', t);
    execute format('create policy p_%1$s_update on public.%1$s for update using (public.can_create_service_entry()) with check (public.can_create_service_entry());', t);
    execute format('create policy p_%1$s_delete on public.%1$s for delete using (public.is_service_ledger_admin());', t);
  end loop;
end $$;

-- service_categories: anyone with service-ledger access reads; only
-- service-ledger admins write (mirrors contract_types exactly).
drop policy if exists p_service_categories_read  on public.service_categories;
drop policy if exists p_service_categories_write on public.service_categories;
create policy p_service_categories_read  on public.service_categories
  for select using (public.has_service_ledger_access());
create policy p_service_categories_write on public.service_categories
  for all using (public.is_service_ledger_admin()) with check (public.is_service_ledger_admin());

-- service_entries — hand-written, non-uniform policies (see header comment).
drop policy if exists p_service_entries_read   on public.service_entries;
drop policy if exists p_service_entries_write  on public.service_entries;
drop policy if exists p_service_entries_update on public.service_entries;
drop policy if exists p_service_entries_delete on public.service_entries;

create policy p_service_entries_read on public.service_entries
  for select using (
    public.has_service_ledger_access()
    or created_by = auth.uid()
    or performed_by = auth.uid()
  );

create policy p_service_entries_write on public.service_entries
  for insert with check (public.is_active_user() and created_by = auth.uid());

create policy p_service_entries_update on public.service_entries
  for update
  using (created_by = auth.uid() or public.can_approve_service_entry())
  with check (created_by = auth.uid() or public.can_approve_service_entry());

create policy p_service_entries_delete on public.service_entries
  for delete using (
    (created_by = auth.uid() and status = 'DRAFT')
    or public.is_service_ledger_admin()
  );

-- time_entries — same shape as service_entries (own work log).
drop policy if exists p_time_entries_read   on public.time_entries;
drop policy if exists p_time_entries_write  on public.time_entries;
drop policy if exists p_time_entries_update on public.time_entries;
drop policy if exists p_time_entries_delete on public.time_entries;

create policy p_time_entries_read on public.time_entries
  for select using (
    public.has_service_ledger_access()
    or created_by = auth.uid()
    or performed_by = auth.uid()
  );

create policy p_time_entries_write on public.time_entries
  for insert with check (public.is_active_user() and created_by = auth.uid());

create policy p_time_entries_update on public.time_entries
  for update
  using (created_by = auth.uid() or public.can_approve_service_entry())
  with check (created_by = auth.uid() or public.can_approve_service_entry());

create policy p_time_entries_delete on public.time_entries
  for delete using (created_by = auth.uid() or public.is_service_ledger_admin());

-- expenses — same "own work" shape (no status column to gate delete on,
-- unlike service_entries).
drop policy if exists p_expenses_read   on public.expenses;
drop policy if exists p_expenses_write  on public.expenses;
drop policy if exists p_expenses_update on public.expenses;
drop policy if exists p_expenses_delete on public.expenses;

create policy p_expenses_read on public.expenses
  for select using (public.has_service_ledger_access() or created_by = auth.uid());

create policy p_expenses_write on public.expenses
  for insert with check (public.is_active_user() and created_by = auth.uid());

create policy p_expenses_update on public.expenses
  for update
  using (created_by = auth.uid() or public.can_approve_service_entry())
  with check (created_by = auth.uid() or public.can_approve_service_entry());

create policy p_expenses_delete on public.expenses
  for delete using (created_by = auth.uid() or public.is_service_ledger_admin());

-- time_entry_internal_costs — confidentiality split table. INSERT is
-- checked against the PARENT time_entries row's own creator (this table
-- has no created_by of its own); SELECT/UPDATE/DELETE require admin
-- tier OR being the same person the time was logged for.
drop policy if exists p_time_entry_internal_costs_read   on public.time_entry_internal_costs;
drop policy if exists p_time_entry_internal_costs_write  on public.time_entry_internal_costs;
drop policy if exists p_time_entry_internal_costs_update on public.time_entry_internal_costs;
drop policy if exists p_time_entry_internal_costs_delete on public.time_entry_internal_costs;

create policy p_time_entry_internal_costs_read on public.time_entry_internal_costs
  for select using (
    public.can_view_internal_cost()
    or exists (
      select 1 from public.time_entries te
      where te.id = time_entry_id and te.performed_by = auth.uid()
    )
  );

create policy p_time_entry_internal_costs_write on public.time_entry_internal_costs
  for insert with check (
    public.is_active_user()
    and exists (
      select 1 from public.time_entries te
      where te.id = time_entry_id and te.created_by = auth.uid()
    )
  );

create policy p_time_entry_internal_costs_update on public.time_entry_internal_costs
  for update using (public.can_view_internal_cost()) with check (public.can_view_internal_cost());

create policy p_time_entry_internal_costs_delete on public.time_entry_internal_costs
  for delete using (public.is_service_ledger_admin());

-- internal_cost_rates — admin-tier only, every operation (rate
-- management, not a personal log).
drop policy if exists p_internal_cost_rates_read   on public.internal_cost_rates;
drop policy if exists p_internal_cost_rates_write  on public.internal_cost_rates;
drop policy if exists p_internal_cost_rates_update on public.internal_cost_rates;
drop policy if exists p_internal_cost_rates_delete on public.internal_cost_rates;

create policy p_internal_cost_rates_read on public.internal_cost_rates
  for select using (public.can_view_internal_cost());
create policy p_internal_cost_rates_write on public.internal_cost_rates
  for insert with check (public.can_view_internal_cost());
create policy p_internal_cost_rates_update on public.internal_cost_rates
  for update using (public.can_view_internal_cost()) with check (public.can_view_internal_cost());
create policy p_internal_cost_rates_delete on public.internal_cost_rates
  for delete using (public.can_view_internal_cost());

-- Mandatory base grants already issued in 0085 (the 0013_table_grants.sql gotcha).

-- =====================================================================
-- NIL Office — 0054_project_task_rls.sql
-- Project & Task Management Phase 1 — RLS.
--
--   * projects/project_phases/project_milestones/project_members ->
--     standard 4-tier project_role loop (has_project_access /
--     can_create_project / is_project_admin), same shape every prior
--     module used.
--
--   * tasks -> DELIBERATELY NOT the same loop. Spec's whole premise is
--     that every active user manages their own work regardless of
--     project_role, so:
--       SELECT: has_project_access() OR you're the assignee OR you
--               created it.
--       INSERT: any active user (is_active_user()) — same bar
--               companies/documents already use; task creation is not
--               a role-gated action.
--       UPDATE: assignee OR creator OR can_create_project() (a project
--               manager can update any task).
--       DELETE: creator (while still TODO) OR is_project_admin().
--     Do NOT "fix" this back to the uniform 4-policy loop later — it
--     is intentionally different, see the Phase 1 plan's decision #3.
-- =====================================================================

-- 6th layering of the self-escalation freeze on profiles
-- (0009 -> 0011 -> 0023 -> 0032 -> 0044 -> here), adding project_role.
drop policy if exists p_profiles_update_self on public.profiles;
create policy p_profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and role             =              (select role             from public.profiles where id = auth.uid())
    and accounting_role  is not distinct from (select accounting_role from public.profiles where id = auth.uid())
    and contract_role    is not distinct from (select contract_role   from public.profiles where id = auth.uid())
    and invoice_role     is not distinct from (select invoice_role    from public.profiles where id = auth.uid())
    and crm_role         is not distinct from (select crm_role        from public.profiles where id = auth.uid())
    and project_role     is not distinct from (select project_role    from public.profiles where id = auth.uid())
    and is_active        =              (select is_active        from public.profiles where id = auth.uid())
  );

alter table public.projects           enable row level security;
alter table public.project_phases     enable row level security;
alter table public.project_milestones enable row level security;
alter table public.project_members    enable row level security;
alter table public.tasks              enable row level security;

do $$
declare t text;
begin
  foreach t in array array['projects','project_phases','project_milestones','project_members']
  loop
    execute format('drop policy if exists p_%1$s_read   on public.%1$s;', t);
    execute format('drop policy if exists p_%1$s_write  on public.%1$s;', t);
    execute format('drop policy if exists p_%1$s_update on public.%1$s;', t);
    execute format('drop policy if exists p_%1$s_delete on public.%1$s;', t);
    execute format('create policy p_%1$s_read   on public.%1$s for select using (public.has_project_access());', t);
    execute format('create policy p_%1$s_write  on public.%1$s for insert with check (public.can_create_project());', t);
    execute format('create policy p_%1$s_update on public.%1$s for update using (public.can_create_project()) with check (public.can_create_project());', t);
    execute format('create policy p_%1$s_delete on public.%1$s for delete using (public.is_project_admin());', t);
  end loop;
end $$;

-- Tasks — hand-written, non-uniform policies (see header comment).
drop policy if exists p_tasks_read   on public.tasks;
drop policy if exists p_tasks_write  on public.tasks;
drop policy if exists p_tasks_update on public.tasks;
drop policy if exists p_tasks_delete on public.tasks;

create policy p_tasks_read on public.tasks
  for select using (
    public.has_project_access()
    or assigned_to = auth.uid()
    or created_by = auth.uid()
  );

create policy p_tasks_write on public.tasks
  for insert with check (public.is_active_user());

create policy p_tasks_update on public.tasks
  for update
  using (
    assigned_to = auth.uid()
    or created_by = auth.uid()
    or public.can_create_project()
  )
  with check (
    assigned_to = auth.uid()
    or created_by = auth.uid()
    or public.can_create_project()
  );

create policy p_tasks_delete on public.tasks
  for delete using (
    (created_by = auth.uid() and status = 'TODO')
    or public.is_project_admin()
  );

-- Mandatory base grants already issued in 0052 (the 0013_table_grants.sql gotcha).

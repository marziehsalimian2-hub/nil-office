-- =====================================================================
-- NIL Office — 0056_task_dependencies.sql
-- Project & Task Management Phase 2 — "Task B depends on Task A" (spec
-- §18), surfaced as "مسدود توسط..." in the UI. Purely informational —
-- no trigger ever touches tasks.status because of a dependency (spec
-- explicitly forbids auto-completing a dependent task).
--
-- Cycle prevention is deliberately partial: self-dependency and the
-- direct reverse pair are rejected ("obvious cycles where practical",
-- per spec); a longer transitive cycle (A->B->C->A) is NOT detected.
-- =====================================================================

create table if not exists public.task_dependencies (
  id                 uuid primary key default gen_random_uuid(),
  task_id            uuid not null references public.tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks(id) on delete cascade,
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),

  check (task_id <> depends_on_task_id),
  unique (task_id, depends_on_task_id)
);

create index if not exists idx_task_dependencies_task       on public.task_dependencies (task_id);
create index if not exists idx_task_dependencies_depends_on on public.task_dependencies (depends_on_task_id);

create or replace function public.tg_task_dependency_cycle_guard()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.task_dependencies
    where task_id = new.depends_on_task_id and depends_on_task_id = new.task_id
  ) then
    raise exception 'REVERSE_DEPENDENCY_EXISTS' using errcode = '22000';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_task_dependency_cycle_guard on public.task_dependencies;
create trigger trg_task_dependency_cycle_guard
  before insert on public.task_dependencies
  for each row execute function public.tg_task_dependency_cycle_guard();

drop trigger if exists trg_audit_task_dependencies on public.task_dependencies;
create trigger trg_audit_task_dependencies
  after insert or update or delete on public.task_dependencies
  for each row execute function public.tg_audit();

-- ---------------------------------------------------------------------
-- RLS — visibility/write follows the DEPENDENT task's own Phase 1
-- ownership rules (has_project_access() OR assigned_to/created_by),
-- via a subquery — not a fresh permission tier (Phase 2 plan decision #4).
-- ---------------------------------------------------------------------
alter table public.task_dependencies enable row level security;

drop policy if exists p_task_dependencies_read   on public.task_dependencies;
drop policy if exists p_task_dependencies_write  on public.task_dependencies;
drop policy if exists p_task_dependencies_delete on public.task_dependencies;

create policy p_task_dependencies_read on public.task_dependencies
  for select using (
    exists (
      select 1 from public.tasks t where t.id = task_dependencies.task_id
        and (public.has_project_access() or t.assigned_to = auth.uid() or t.created_by = auth.uid())
    )
  );

create policy p_task_dependencies_write on public.task_dependencies
  for insert with check (
    exists (
      select 1 from public.tasks t where t.id = task_dependencies.task_id
        and (t.assigned_to = auth.uid() or t.created_by = auth.uid() or public.can_create_project())
    )
  );

create policy p_task_dependencies_delete on public.task_dependencies
  for delete using (
    exists (
      select 1 from public.tasks t where t.id = task_dependencies.task_id
        and (t.assigned_to = auth.uid() or t.created_by = auth.uid() or public.can_create_project())
    )
  );

grant select, insert, delete on public.task_dependencies to authenticated;

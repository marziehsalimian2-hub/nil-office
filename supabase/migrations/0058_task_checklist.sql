-- =====================================================================
-- NIL Office — 0058_task_checklist.sql
-- Project & Task Management Phase 2 — lightweight checklist items
-- (spec §17) for small execution steps within a task. Not a Subtasks
-- replacement — Subtasks (tasks.parent_task_id, Phase 1) stays the
-- mechanism for anything substantial enough to need its own
-- assignee/status/due date.
-- =====================================================================

create table if not exists public.task_checklist_items (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references public.tasks(id) on delete cascade,
  label          text not null,
  is_done        boolean not null default false,
  sort_order     integer not null default 0,
  completed_by   uuid references public.profiles(id) on delete set null,
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists idx_task_checklist_items_task on public.task_checklist_items (task_id, sort_order);

drop trigger if exists trg_audit_task_checklist_items on public.task_checklist_items;
create trigger trg_audit_task_checklist_items
  after insert or update or delete on public.task_checklist_items
  for each row execute function public.tg_audit();

-- ---------------------------------------------------------------------
-- RLS — mirrors tasks' own UPDATE rule (Phase 2 plan decision #6): a
-- checklist item is part of executing the task, same actors who can
-- already change the task's status.
-- ---------------------------------------------------------------------
alter table public.task_checklist_items enable row level security;

drop policy if exists p_task_checklist_items_read   on public.task_checklist_items;
drop policy if exists p_task_checklist_items_write  on public.task_checklist_items;
drop policy if exists p_task_checklist_items_update on public.task_checklist_items;
drop policy if exists p_task_checklist_items_delete on public.task_checklist_items;

create policy p_task_checklist_items_read on public.task_checklist_items
  for select using (
    exists (
      select 1 from public.tasks t where t.id = task_checklist_items.task_id
        and (public.has_project_access() or t.assigned_to = auth.uid() or t.created_by = auth.uid())
    )
  );

create policy p_task_checklist_items_write on public.task_checklist_items
  for insert with check (
    exists (
      select 1 from public.tasks t where t.id = task_checklist_items.task_id
        and (t.assigned_to = auth.uid() or t.created_by = auth.uid() or public.can_create_project())
    )
  );

create policy p_task_checklist_items_update on public.task_checklist_items
  for update using (
    exists (
      select 1 from public.tasks t where t.id = task_checklist_items.task_id
        and (t.assigned_to = auth.uid() or t.created_by = auth.uid() or public.can_create_project())
    )
  )
  with check (
    exists (
      select 1 from public.tasks t where t.id = task_checklist_items.task_id
        and (t.assigned_to = auth.uid() or t.created_by = auth.uid() or public.can_create_project())
    )
  );

create policy p_task_checklist_items_delete on public.task_checklist_items
  for delete using (
    exists (
      select 1 from public.tasks t where t.id = task_checklist_items.task_id
        and (t.assigned_to = auth.uid() or t.created_by = auth.uid() or public.can_create_project())
    )
  );

grant select, insert, update, delete on public.task_checklist_items to authenticated;

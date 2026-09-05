-- =====================================================================
-- NIL Office — 0051_task_tables.sql
-- Project & Task Management Phase 1 — tasks.
--
-- No task_number / numbering machinery at all — the spec itself marks
-- a task number "nullable" and never asks for atomic/Jalali numbering
-- the way every other entity this session has needed. A task is
-- referenced by link, not by a printed number.
--
-- project_id (and phase_id/milestone_id) are nullable — a task may
-- exist entirely independent of any project (spec §11), which is the
-- foundation for "کارهای من" being useful to every user, not just
-- people on structured projects.
-- =====================================================================

do $$ begin
  create type task_status as enum ('TODO','IN_PROGRESS','BLOCKED','WAITING','DONE','CANCELLED');
exception when duplicate_object then null; end $$;

create table if not exists public.tasks (
  id                  uuid primary key default gen_random_uuid(),

  title               text not null,
  description         text,

  project_id          uuid references public.projects(id) on delete set null,
  phase_id            uuid references public.project_phases(id) on delete set null,
  milestone_id        uuid references public.project_milestones(id) on delete set null,

  company_id          uuid references public.companies(id) on delete set null,
  case_id             uuid references public.cases(id) on delete set null,
  crm_opportunity_id  uuid references public.crm_opportunities(id) on delete set null,
  contract_id         uuid references public.contracts(id) on delete set null,

  assigned_to         uuid references public.profiles(id) on delete set null,
  created_by          uuid not null references public.profiles(id),

  status              task_status not null default 'TODO',
  priority            pm_priority not null default 'NORMAL',

  start_date          date,
  due_date            date,
  completed_at        timestamptz,

  estimated_minutes   integer check (estimated_minutes is null or estimated_minutes >= 0),
  actual_minutes      integer check (actual_minutes is null or actual_minutes >= 0),

  parent_task_id      uuid references public.tasks(id) on delete cascade,
  blocked_reason      text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz
);

create index if not exists idx_tasks_project      on public.tasks (project_id);
create index if not exists idx_tasks_phase        on public.tasks (phase_id);
create index if not exists idx_tasks_milestone    on public.tasks (milestone_id);
create index if not exists idx_tasks_assigned_to  on public.tasks (assigned_to);
create index if not exists idx_tasks_created_by   on public.tasks (created_by);
create index if not exists idx_tasks_status       on public.tasks (status);
create index if not exists idx_tasks_due_date     on public.tasks (due_date);
create index if not exists idx_tasks_parent       on public.tasks (parent_task_id);

-- ---------------------------------------------------------------------
-- tg_task_subtask_depth_guard — subtasks are exactly one level deep
-- (spec §14: "avoid unlimited pathological nesting"). Rejects a task
-- whose chosen parent already has a parent of its own.
-- ---------------------------------------------------------------------
create or replace function public.tg_task_subtask_depth_guard()
returns trigger
language plpgsql
as $$
declare
  v_grandparent uuid;
begin
  if new.parent_task_id is null then
    return new;
  end if;
  if new.parent_task_id = new.id then
    raise exception 'TASK_SELF_PARENT' using errcode = '22000';
  end if;
  select parent_task_id into v_grandparent from public.tasks where id = new.parent_task_id;
  if v_grandparent is not null then
    raise exception 'SUBTASK_DEPTH_EXCEEDED' using errcode = '22000';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_task_subtask_depth_guard on public.tasks;
create trigger trg_task_subtask_depth_guard
  before insert or update on public.tasks
  for each row execute function public.tg_task_subtask_depth_guard();

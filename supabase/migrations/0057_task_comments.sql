-- =====================================================================
-- NIL Office — 0057_task_comments.sql
-- Project & Task Management Phase 2 — a lightweight per-task work-log
-- (spec §16), not a chat system. Author-only edits, NO delete policy
-- at all — a comment is operational history; a correction is an edit
-- (audited via tg_audit), never a deletion (spec: "preserve operational
-- history... where editing is allowed, audit it").
-- =====================================================================

create table if not exists public.task_comments (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.tasks(id) on delete cascade,
  author_user_id  uuid not null references public.profiles(id),
  body            text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);

create index if not exists idx_task_comments_task on public.task_comments (task_id, created_at);

drop trigger if exists trg_touch_task_comments on public.task_comments;
create trigger trg_touch_task_comments
  before update on public.task_comments
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists trg_audit_task_comments on public.task_comments;
create trigger trg_audit_task_comments
  after insert or update on public.task_comments
  for each row execute function public.tg_audit();

-- ---------------------------------------------------------------------
-- RLS — visibility follows the task's own Phase 1 ownership rules
-- (Phase 2 plan decision #4). Author-only insert/update, no delete.
-- ---------------------------------------------------------------------
alter table public.task_comments enable row level security;

drop policy if exists p_task_comments_read   on public.task_comments;
drop policy if exists p_task_comments_write  on public.task_comments;
drop policy if exists p_task_comments_update on public.task_comments;

create policy p_task_comments_read on public.task_comments
  for select using (
    exists (
      select 1 from public.tasks t where t.id = task_comments.task_id
        and (public.has_project_access() or t.assigned_to = auth.uid() or t.created_by = auth.uid())
    )
  );

create policy p_task_comments_write on public.task_comments
  for insert with check (
    author_user_id = auth.uid()
    and exists (
      select 1 from public.tasks t where t.id = task_comments.task_id
        and (public.has_project_access() or t.assigned_to = auth.uid() or t.created_by = auth.uid())
    )
  );

create policy p_task_comments_update on public.task_comments
  for update using (author_user_id = auth.uid()) with check (author_user_id = auth.uid());

-- No delete grant either — belt-and-suspenders alongside the missing policy.
grant select, insert, update on public.task_comments to authenticated;

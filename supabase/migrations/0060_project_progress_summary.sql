-- =====================================================================
-- NIL Office — 0060_project_progress_summary.sql
-- Project & Task Management Phase 3 — one read-only aggregation
-- function powering the deterministic progress/health computation
-- (spec §26-28). Not security definer: only aggregates rows the
-- caller can already see via projects/tasks/project_milestones RLS,
-- same reasoning as get_stale_crm_opportunities (0048).
--
-- Progress formula: done tasks / (all tasks - cancelled tasks) across
-- the whole project (spec allows "weighted or simple" — a plain ratio
-- needs no per-phase weight configuration). Falls back to the
-- Phase 1 manually-entered projects.progress_percent when a project
-- has zero tasks yet (0% would be misleading before any task exists).
-- Health itself is computed in TypeScript (lib/project-health.ts) from
-- the two boolean flags this function returns — no DB concept at all.
-- =====================================================================

create or replace function public.get_project_progress_summary()
returns table (
  project_id               uuid,
  computed_progress_percent int,
  has_overdue_milestone    boolean,
  has_blocked_task         boolean,
  overdue_task_count       int
)
language sql
stable
as $$
  select
    p.id,
    coalesce(
      round(
        100.0 * count(t.id) filter (where t.status = 'DONE')
        / nullif(count(t.id) filter (where t.status <> 'CANCELLED'), 0)
      ),
      p.progress_percent
    )::int,
    exists (
      select 1 from public.project_milestones m
      where m.project_id = p.id and m.due_date < current_date and m.status not in ('COMPLETED','CANCELLED')
    ),
    exists (
      select 1 from public.tasks bt
      where bt.project_id = p.id and bt.status = 'BLOCKED'
    ),
    (
      select count(*) from public.tasks ot
      where ot.project_id = p.id and ot.due_date < current_date and ot.status not in ('DONE','CANCELLED')
    )::int
  from public.projects p
  left join public.tasks t on t.project_id = p.id
  group by p.id, p.progress_percent;
$$;

grant execute on function public.get_project_progress_summary() to authenticated;

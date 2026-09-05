-- =====================================================================
-- NIL Office — 0053_project_task_cross_links.sql
-- Project & Task Management Phase 1 — additive nullable FK columns onto
-- existing tables, following the established specific-FK convention
-- (not a generic entity reference) already used for CRM's
-- opportunity_id additions (0041_crm_cross_links.sql).
-- =====================================================================

alter table public.documents      add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.documents      add column if not exists task_id    uuid references public.tasks(id) on delete set null;
alter table public.correspondence add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.followups      add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.followups      add column if not exists task_id    uuid references public.tasks(id) on delete set null;
alter table public.sales_documents add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists idx_documents_project      on public.documents (project_id);
create index if not exists idx_documents_task         on public.documents (task_id);
create index if not exists idx_correspondence_project on public.correspondence (project_id);
create index if not exists idx_followups_project      on public.followups (project_id);
create index if not exists idx_followups_task         on public.followups (task_id);
create index if not exists idx_sales_documents_project on public.sales_documents (project_id);

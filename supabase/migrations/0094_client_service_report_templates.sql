-- =====================================================================
-- NIL Office — 0094_client_service_report_templates.sql
-- Client Service Ledger — Phase 4 (Saved Report Templates).
--
-- Versioning (spec §64): a plain incrementing `version` int, bumped
-- only by the explicit "Save Changes To Template" action — copied
-- verbatim into client_service_reports.template_version at generation
-- time. A historical report's displayed template reference therefore
-- never changes when the template is edited later, without needing a
-- heavier template_versions snapshot-history table.
--
-- No DELETE policy is ever granted on this table — "deactivate, never
-- hard-delete a template used in history" (spec §67) is structural,
-- not an app-level check that could be bypassed. The FK from
-- client_service_reports.template_id (added below, deferred from 0093
-- since this table didn't exist yet) uses ON DELETE RESTRICT as a
-- second, DB-level backstop for the same rule.
-- =====================================================================

create table if not exists public.client_service_report_templates (
  id                     uuid primary key default gen_random_uuid(),
  template_name          text not null,
  scope                  text not null check (scope in ('GLOBAL','CLIENT')),
  company_id             uuid references public.companies(id),
  report_family          text not null default 'CLIENT' check (report_family in ('CLIENT','INTERNAL')),
  report_type            text not null check (report_type in ('CLIENT_PERFORMANCE_REPORT','CLIENT_FINANCIAL_REPORT','CLIENT_FULL_REPORT','CUSTOM_REPORT')),
  selected_sections      text[] not null,
  selected_fields        text[] not null,
  detail_level           text not null check (detail_level in ('SUMMARY','STANDARD','DETAILED')),
  default_title          text,
  default_introduction   text,
  default_final_note     text,
  show_logo              boolean not null default true,
  show_page_numbers      boolean not null default true,
  is_active              boolean not null default true,
  version                integer not null default 1,
  created_by             uuid not null references public.profiles(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint ck_report_templates_scope check (
    (scope = 'GLOBAL' and company_id is null) or (scope = 'CLIENT' and company_id is not null)
  )
);

create index if not exists idx_report_templates_company on public.client_service_report_templates (company_id);
create index if not exists idx_report_templates_active on public.client_service_report_templates (is_active);

drop trigger if exists trg_enforce_report_field_security_tpl on public.client_service_report_templates;
create trigger trg_enforce_report_field_security_tpl
  before insert or update on public.client_service_report_templates
  for each row execute function public.tg_enforce_report_field_security();

drop trigger if exists trg_touch_client_service_report_templates on public.client_service_report_templates;
create trigger trg_touch_client_service_report_templates
  before update on public.client_service_report_templates
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists trg_audit_client_service_report_templates on public.client_service_report_templates;
create trigger trg_audit_client_service_report_templates
  after insert or update or delete on public.client_service_report_templates
  for each row execute function public.tg_audit();

alter table public.client_service_reports
  add constraint fk_client_service_reports_template
  foreign key (template_id) references public.client_service_report_templates(id) on delete restrict;

alter table public.client_service_files
  add column if not exists default_report_template_id uuid references public.client_service_report_templates(id) on delete set null;

-- RLS: read for module access, insert/update for CREATE-tier+, no DELETE ever.
alter table public.client_service_report_templates enable row level security;

drop policy if exists p_report_templates_read   on public.client_service_report_templates;
drop policy if exists p_report_templates_write  on public.client_service_report_templates;
drop policy if exists p_report_templates_update on public.client_service_report_templates;

create policy p_report_templates_read on public.client_service_report_templates
  for select using (public.has_service_ledger_access());

create policy p_report_templates_write on public.client_service_report_templates
  for insert with check (public.can_create_service_entry());

create policy p_report_templates_update on public.client_service_report_templates
  for update using (public.can_create_service_entry()) with check (public.can_create_service_entry());

grant select, insert, update on public.client_service_report_templates to authenticated;

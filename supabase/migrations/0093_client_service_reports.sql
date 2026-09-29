-- =====================================================================
-- NIL Office — 0093_client_service_reports.sql
-- Client Service Ledger — Phase 4 (Configurable PDF Report Builder).
--
-- client_service_reports is an append-only archive: no UPDATE/DELETE
-- RLS policy at all, so a generated report can never be altered or
-- removed once created (spec §57 — "no historical PDF is ever
-- Overwrite-able"). template_id has no FK yet — added in 0094 once
-- client_service_report_templates exists.
--
-- report_family ('CLIENT'/'INTERNAL') and the allowed_report_sections()
-- allowlist + tg_enforce_report_field_security() trigger are built now
-- even though this phase only ever inserts 'CLIENT' rows — the
-- Internal Management Report (a later phase) reuses this exact
-- mechanism instead of requiring a breaking rework. allowed_report_sections
-- is the literal, DB-level answer to spec §50/§65: even a
-- maliciously-crafted payload via direct API manipulation can never
-- smuggle a confidential section/field into a 'CLIENT' report, because
-- the trigger — not just app-level validation — rejects it.
-- =====================================================================

create table if not exists public.client_service_reports (
  id                      uuid primary key default gen_random_uuid(),
  client_service_file_id  uuid not null references public.client_service_files(id),
  report_family           text not null default 'CLIENT' check (report_family in ('CLIENT','INTERNAL')),
  report_type             text not null check (report_type in ('CLIENT_PERFORMANCE_REPORT','CLIENT_FINANCIAL_REPORT','CLIENT_FULL_REPORT','CUSTOM_REPORT')),
  period_start            date not null,
  period_end              date not null,
  title                   text not null,
  introduction            text,
  final_note              text,
  selected_sections       text[] not null,
  selected_fields         text[] not null,
  detail_level            text not null check (detail_level in ('SUMMARY','STANDARD','DETAILED')),
  show_logo               boolean not null default true,
  show_page_numbers       boolean not null default true,
  template_id             uuid,
  template_version        integer,
  data_as_of              timestamptz not null,
  generated_by            uuid not null references public.profiles(id),
  generated_at            timestamptz not null default now(),
  storage_path            text not null,
  file_name               text not null,

  constraint ck_client_service_reports_period check (period_end >= period_start)
);

create index if not exists idx_client_service_reports_file on public.client_service_reports (client_service_file_id, generated_at desc);

-- ---------------------------------------------------------------------
-- allowed_report_sections — the single place a later phase widens the
-- 'INTERNAL' branch. Today both branches return the same client-safe
-- set (spec §47/§48), since no code path can produce an 'INTERNAL' row
-- yet — this is inert schema readiness, not a security gap.
-- ---------------------------------------------------------------------
create or replace function public.allowed_report_sections(p_report_family text)
returns text[]
language sql
stable
as $$
  select array[
    'COVER_PAGE','EXECUTIVE_SUMMARY','SERVICES_PERFORMED','SERVICE_DATE','SERVICE_CATEGORY',
    'SERVICE_DESCRIPTION','SERVICE_PERFORMER','TIME_SPENT','CONTRACTS_RELATED','PROJECTS_RELATED',
    'DIRECT_EXPENSES','REIMBURSABLE_EXPENSES','SERVICE_FEES','CLAIMABLE_AMOUNTS','INVOICES_PROFORMAS',
    'AMOUNTS_RECEIVED','OUTSTANDING_AMOUNT','BILLING_SUMMARY','DOCUMENTS_REFERENCE','PERIOD_SUMMARY',
    'CUSTOM_NOTES','FINAL_SUMMARY',
    'DATE','CATEGORY','SERVICE_TITLE','DESCRIPTION','PERFORMER','DURATION','SERVICE_FEE','EXPENSE',
    'CLAIMABLE_AMOUNT','BILLING_STATUS'
  ]::text[];
$$;

create or replace function public.tg_enforce_report_field_security()
returns trigger
language plpgsql
as $$
declare
  v_allowed text[];
begin
  v_allowed := public.allowed_report_sections(new.report_family);
  if exists (select 1 from unnest(new.selected_sections) s where s <> all (v_allowed)) then
    raise exception 'CONFIDENTIAL_FIELD_NOT_ALLOWED' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(new.selected_fields) f where f <> all (v_allowed)) then
    raise exception 'CONFIDENTIAL_FIELD_NOT_ALLOWED' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_report_field_security on public.client_service_reports;
create trigger trg_enforce_report_field_security
  before insert on public.client_service_reports
  for each row execute function public.tg_enforce_report_field_security();

-- ---------------------------------------------------------------------
-- get_client_service_report_entries — per-row services list for the
-- "Services Performed" report section. Deliberately selects ONLY
-- client-safe columns — internal cost data is structurally absent from
-- this query's result set, not merely hidden downstream.
-- ---------------------------------------------------------------------
create or replace function public.get_client_service_report_entries(
  p_client_service_file_id uuid,
  p_period_start           date,
  p_period_end             date
)
returns table (
  service_entry_id  uuid,
  service_date      date,
  category_name     text,
  title             text,
  description       text,
  performer_name    text,
  duration_minutes  numeric,
  service_fee       numeric(20,4),
  expense_amount    numeric(20,4),
  claimable_amount  numeric(20,4),
  billing_status    text,
  currency_code     text,
  contract_title    text,
  project_title     text
)
language sql
stable
as $$
  select
    se.id as service_entry_id,
    se.service_date,
    sc.name as category_name,
    se.title,
    se.description,
    p.full_name as performer_name,
    coalesce((select sum(t.duration_minutes) from public.time_entries t where t.service_entry_id = se.id), 0) as duration_minutes,
    se.service_fee,
    coalesce((select sum(e.amount) from public.expenses e where e.service_entry_id = se.id), 0) as expense_amount,
    se.service_fee
      + coalesce((select sum(t.duration_minutes / 60.0 * t.hourly_rate_snapshot) from public.time_entries t where t.service_entry_id = se.id and t.billable and t.hourly_rate_snapshot is not null), 0)
      + coalesce((select sum(e.reimbursable_amount) from public.expenses e where e.service_entry_id = se.id and e.is_reimbursable), 0) as claimable_amount,
    se.billing_status::text,
    se.currency as currency_code,
    ct.title as contract_title,
    pr.title as project_title
  from public.service_entries se
  join public.service_categories sc on sc.id = se.service_category_id
  join public.profiles p on p.id = se.performed_by
  left join public.contracts ct on ct.id = se.contract_id
  left join public.projects pr on pr.id = se.project_id
  where se.client_service_file_id = p_client_service_file_id
    and se.service_date between p_period_start and p_period_end
  order by se.service_date, se.created_at;
$$;

-- ---------------------------------------------------------------------
-- get_client_service_report_invoices — the "Invoices / Proformas" /
-- "Amounts Received" / "Outstanding Amount" sections' data source.
-- Reads the EXISTING sales_documents engine directly through the
-- billing_batches bridge (0089) — never a parallel invoiced/received
-- truth. status itself (SETTLED/PARTIALLY_SETTLED/ISSUED/...) is the
-- collection signal; this function does not attempt to compute an
-- exact received amount (that lives in the receipts/settlement
-- machinery, out of scope for this read-only report source).
-- ---------------------------------------------------------------------
create or replace function public.get_client_service_report_invoices(
  p_client_service_file_id uuid,
  p_period_start           date,
  p_period_end             date
)
returns table (
  sales_document_id uuid,
  doc_type          text,
  display_number    text,
  status            text,
  issue_date        date,
  total_amount      numeric(20,4),
  currency_code     text
)
language sql
stable
as $$
  select distinct
    sd.id as sales_document_id,
    sd.type::text as doc_type,
    sd.display_number,
    sd.status::text as status,
    sd.issue_date,
    sd.total_amount,
    sd.currency_code
  from public.billing_batches bb
  join public.sales_documents sd on sd.id = bb.sales_document_id
  where bb.client_service_file_id = p_client_service_file_id
    and coalesce(sd.issue_date, bb.period_end) between p_period_start and p_period_end
  order by issue_date;
$$;

-- RLS: SELECT for anyone with module access; INSERT for CREATE-tier+
-- (generating a report is a create-like action). No UPDATE/DELETE
-- policy at all — see file header.
alter table public.client_service_reports enable row level security;

drop policy if exists p_client_service_reports_read  on public.client_service_reports;
drop policy if exists p_client_service_reports_write on public.client_service_reports;

create policy p_client_service_reports_read on public.client_service_reports
  for select using (public.has_service_ledger_access());

create policy p_client_service_reports_write on public.client_service_reports
  for insert with check (public.can_create_service_entry());

grant select, insert on public.client_service_reports to authenticated;
grant execute on function public.allowed_report_sections(text) to authenticated;
grant execute on function public.get_client_service_report_entries(uuid, date, date) to authenticated;
grant execute on function public.get_client_service_report_invoices(uuid, date, date) to authenticated;

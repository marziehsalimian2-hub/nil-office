-- =====================================================================
-- NIL Office — 0141_factory_reset.sql
-- Factory Reset / Operational Clean Start v1.0 — controlled, audited, dry-run-first.
--
-- THIS MIGRATION DELETES NOTHING. It only creates the reset subsystem (manifest, plans, history, maintenance lock,
-- permission table) and the RPCs. Every RPC is granted to service_role ONLY (never to anon / authenticated): destructive
-- logic is reachable only from the privileged server side, never from a browser or a user session.
--
--   * Manifest = single source of truth (system_reset_manifest, 105 public tables + the subsystem's own tables), versioned and hashed.
--     A table that exists in the catalog but not in the manifest is UNKNOWN and blocks execution.
--   * Mode OPERATIONAL (A): removes business / operational / test data; keeps users, roles, configuration, chart of accounts, fiscal years,
--     templates, branding, numbering architecture. Mode FULL (B): manifest + dry run only — execution is NOT implemented in this version.
--   * One TRUNCATE of the manifest DELETE set inside ONE transaction (dependency-aware: every FK-related table is in the same
--     statement; no CASCADE, no session_replication_role). Row-level no-delete / audit triggers do not fire for TRUNCATE by design.
--   * Permission SYSTEM_FACTORY_RESET = active ADMIN profile + a non-revoked row in system_reset_grants. NOTHING is granted here.
--   * Production guard: environment is decided server-side; production is refused unless explicitly allowed by the server.
--   * Plans expire; the executed plan must match the reviewed plan (manifest hash, schema hash, user, mode, environment, one-time token).
--   * Reset history, phase events and the permission table are NEVER touched by any reset.
-- Forward-only. service_role is granted explicitly on every new table (0072/0096 gotcha).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) tables
-- ---------------------------------------------------------------------
create table if not exists public.system_reset_grants (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,
  granted_by  uuid references public.profiles(id) on delete set null,
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  note        text
);

create table if not exists public.system_maintenance (
  id         integer primary key default 1 check (id = 1),
  locked     boolean not null default false,
  reset_id   uuid,
  locked_by  uuid,
  locked_at  timestamptz,
  reason     text
);
insert into public.system_maintenance (id) values (1) on conflict (id) do nothing;

create table if not exists public.system_reset_manifest (
  object_name      text primary key,
  object_kind      text not null default 'TABLE' check (object_kind in ('TABLE')),
  module           text not null,
  classification   text not null check (classification in ('DELETE', 'PRESERVE', 'CONDITIONAL', 'NEVER_TOUCH')),
  mode_a           text not null check (mode_a in ('DELETE', 'TRUNCATE_KEEP', 'PRESERVE', 'FILTERED_DELETE', 'RESET_VALUE', 'NEVER')),
  mode_b           text not null check (mode_b in ('DELETE', 'TRUNCATE_KEEP', 'PRESERVE', 'FILTERED_DELETE', 'RESET_VALUE', 'ADMINS_ONLY', 'NEVER')),
  reason           text not null,
  depends_on       text,
  reset_order      integer not null default 0,
  sequence_impact  text not null default '-',
  storage_impact   text not null default '-',
  risk             text not null default 'LOW' check (risk in ('LOW', 'MEDIUM', 'HIGH')),
  manifest_version integer not null default 1
);

create table if not exists public.system_reset_storage_rules (
  prefix  text primary key,
  action  text not null check (action in ('DELETE', 'PRESERVE')),
  reason  text not null
);

create table if not exists public.system_reset_plans (
  id               uuid primary key default gen_random_uuid(),
  tenant_key       text not null default 'default',
  mode             text not null check (mode in ('OPERATIONAL', 'FULL')),
  environment      text not null check (environment in ('development', 'uat', 'production')),
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  status           text not null default 'PLANNED' check (status in ('PLANNED', 'READY', 'USED', 'EXPIRED', 'CANCELLED')),
  manifest_version integer not null,
  manifest_hash    text not null,
  schema_hash      text not null,
  params           jsonb not null default '{}'::jsonb,
  preview          jsonb not null default '{}'::jsonb,
  backup_reference text,
  backup_timestamp timestamptz,
  backup_status    text,
  armed_at         timestamptz,
  token_hash       text,
  token_expires_at timestamptz
);

create table if not exists public.system_reset_runs (
  id                uuid primary key default gen_random_uuid(),     -- = reset_id
  plan_id           uuid not null unique references public.system_reset_plans(id),
  tenant_key        text not null default 'default',
  mode              text not null,
  environment       text not null,
  initiated_by      uuid references public.profiles(id) on delete set null,
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  status            text not null default 'RUNNING' check (status in ('PLANNED', 'READY', 'RUNNING', 'VERIFYING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  phase             text not null default 'PREPARED' check (phase in (
                      'PREPARED', 'DB_RESET_STARTED', 'DB_RESET_COMPLETED', 'STORAGE_CLEANUP_STARTED', 'STORAGE_CLEANUP_COMPLETED', 'VERIFICATION', 'COMPLETED', 'FAILED')),
  backup_reference  text,
  backup_timestamp  timestamptz,
  manifest_version  integer not null,
  counts_before     jsonb,
  counts_deleted    jsonb,
  storage_cleanup   jsonb,
  integrity_result  jsonb,
  report            jsonb,
  error             text
);

create table if not exists public.system_reset_run_events (
  id      uuid primary key default gen_random_uuid(),
  run_id  uuid not null references public.system_reset_runs(id),
  at      timestamptz not null default clock_timestamp(),
  phase   text not null,
  ok      boolean not null default true,
  detail  jsonb not null default '{}'::jsonb
);
create index if not exists idx_system_reset_run_events_run on public.system_reset_run_events (run_id, at);

create table if not exists public.system_reset_storage_items (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.system_reset_runs(id),
  bucket        text not null default 'nil-files',
  path          text not null,
  reason        text not null,
  status        text not null default 'PENDING' check (status in ('PENDING', 'DONE', 'FAILED')),
  error         text,
  processed_at  timestamptz,
  constraint uq_system_reset_storage_item unique (run_id, path)
);

alter table public.system_reset_grants         enable row level security;
alter table public.system_maintenance          enable row level security;
alter table public.system_reset_manifest       enable row level security;
alter table public.system_reset_storage_rules  enable row level security;
alter table public.system_reset_plans          enable row level security;
alter table public.system_reset_runs           enable row level security;
alter table public.system_reset_run_events     enable row level security;
alter table public.system_reset_storage_items  enable row level security;
-- (no policies on purpose: only service_role / SECURITY DEFINER functions can touch these tables)

revoke all on public.system_reset_grants, public.system_maintenance, public.system_reset_manifest, public.system_reset_storage_rules,
              public.system_reset_plans, public.system_reset_runs, public.system_reset_run_events, public.system_reset_storage_items
  from public, anon, authenticated;
grant select, insert, update on public.system_reset_grants, public.system_maintenance, public.system_reset_plans,
                                public.system_reset_runs, public.system_reset_run_events, public.system_reset_storage_items to service_role;
grant select on public.system_reset_manifest, public.system_reset_storage_rules to service_role;

-- ---------------------------------------------------------------------
-- 2) manifest + storage rules (seed; classification of the ACTUAL schema, migrations 0001-0140)
-- ---------------------------------------------------------------------
insert into public.system_reset_manifest
  (object_name, module, classification, mode_a, mode_b, reason, risk, reset_order, sequence_impact, storage_impact, manifest_version)
values
  ('correspondence', 'correspondence', 'DELETE', 'DELETE', 'DELETE', 'Letters (incoming/outgoing) are operational documents', 'MEDIUM', 10, 'OUTGOING, INCOMING', 'correspondence/ PDFs and scans', 1),
  ('correspondence_links', 'correspondence', 'DELETE', 'DELETE', 'DELETE', 'Links between letters', 'LOW', 10, '-', '-', 1),
  ('cases', 'correspondence', 'DELETE', 'DELETE', 'DELETE', 'Case files group letters/documents', 'LOW', 10, 'CASE', '-', 1),
  ('documents', 'correspondence', 'DELETE', 'DELETE', 'DELETE', 'Archive documents', 'LOW', 10, '-', 'document/ files', 1),
  ('attachments', 'documents', 'DELETE', 'DELETE', 'DELETE', 'Polymorphic file registry; every row belongs to a deleted parent', 'MEDIUM', 12, '-', 'all registered business files', 1),
  ('followups', 'correspondence', 'DELETE', 'DELETE', 'DELETE', 'Follow-up reminders', 'LOW', 10, '-', '-', 1),
  ('companies', 'crm', 'DELETE', 'DELETE', 'DELETE', 'Customers / counterparties entered during UAT (user decision: delete)', 'MEDIUM', 20, '-', 'company/ files', 1),
  ('company_contacts', 'crm', 'DELETE', 'DELETE', 'DELETE', 'Contacts of companies', 'LOW', 20, '-', '-', 1),
  ('crm_company_roles', 'crm', 'DELETE', 'DELETE', 'DELETE', 'Role assignments of companies', 'LOW', 20, '-', '-', 1),
  ('crm_opportunities', 'crm', 'DELETE', 'DELETE', 'DELETE', 'Opportunities', 'MEDIUM', 21, 'OPPORTUNITY', 'opportunity/ files', 1),
  ('crm_opportunity_stage_history', 'crm', 'DELETE', 'DELETE', 'DELETE', 'Stage history of opportunities', 'LOW', 21, '-', '-', 1),
  ('crm_opportunity_parties', 'crm', 'DELETE', 'DELETE', 'DELETE', 'Buyer/seller/broker links of opportunities', 'LOW', 21, '-', '-', 1),
  ('crm_opportunity_trade_details', 'crm', 'DELETE', 'DELETE', 'DELETE', 'Trade details of opportunities', 'LOW', 21, '-', '-', 1),
  ('crm_quotations', 'crm', 'DELETE', 'DELETE', 'DELETE', 'Quotations', 'LOW', 21, '-', '-', 1),
  ('crm_activities', 'crm', 'DELETE', 'DELETE', 'DELETE', 'CRM activities', 'LOW', 21, '-', '-', 1),
  ('crm_pipelines', 'crm', 'PRESERVE', 'PRESERVE', 'PRESERVE', 'System pipeline definitions (seeded defaults, configurable)', 'LOW', 200, '-', '-', 1),
  ('crm_pipeline_stages', 'crm', 'PRESERVE', 'PRESERVE', 'PRESERVE', 'Stages of the pipeline definitions', 'LOW', 200, '-', '-', 1),
  ('contracts', 'contracts', 'DELETE', 'DELETE', 'DELETE', 'Contracts (milestones/obligations live inside this module''s rows)', 'MEDIUM', 30, 'CONTRACT', 'contract/ files', 1),
  ('contract_types', 'contracts', 'PRESERVE', 'PRESERVE', 'PRESERVE', 'Contract type definitions (seeded + configured)', 'LOW', 200, '-', '-', 1),
  ('sales_documents', 'sales', 'DELETE', 'DELETE', 'DELETE', 'Proformas and invoices', 'HIGH', 40, 'PROFORMA, INVOICE', 'sales_document/ files', 1),
  ('sales_document_items', 'sales', 'DELETE', 'DELETE', 'DELETE', 'Lines of proformas/invoices', 'LOW', 40, '-', '-', 1),
  ('projects', 'projects', 'DELETE', 'DELETE', 'DELETE', 'Projects', 'MEDIUM', 50, 'PROJECT', 'project/ files', 1),
  ('project_phases', 'projects', 'DELETE', 'DELETE', 'DELETE', 'Phases', 'LOW', 50, '-', '-', 1),
  ('project_milestones', 'projects', 'DELETE', 'DELETE', 'DELETE', 'Milestones', 'LOW', 50, '-', '-', 1),
  ('project_members', 'projects', 'DELETE', 'DELETE', 'DELETE', 'Project membership', 'LOW', 50, '-', '-', 1),
  ('project_deliverables', 'projects', 'DELETE', 'DELETE', 'DELETE', 'Deliverables', 'LOW', 50, '-', '-', 1),
  ('tasks', 'projects', 'DELETE', 'DELETE', 'DELETE', 'Tasks and subtasks', 'LOW', 51, '-', 'task/ files', 1),
  ('task_dependencies', 'projects', 'DELETE', 'DELETE', 'DELETE', 'Task dependencies', 'LOW', 51, '-', '-', 1),
  ('task_comments', 'projects', 'DELETE', 'DELETE', 'DELETE', 'Task comments', 'LOW', 51, '-', '-', 1),
  ('task_checklist_items', 'projects', 'DELETE', 'DELETE', 'DELETE', 'Task checklists', 'LOW', 51, '-', '-', 1),
  ('client_service_files', 'client_service', 'DELETE', 'DELETE', 'DELETE', 'Client service files', 'MEDIUM', 60, '-', 'service_entry/ service_expense/ files', 1),
  ('service_arrangements', 'client_service', 'DELETE', 'DELETE', 'DELETE', 'Service arrangements', 'LOW', 60, '-', '-', 1),
  ('service_entries', 'client_service', 'DELETE', 'DELETE', 'DELETE', 'Service entries', 'MEDIUM', 60, '-', '-', 1),
  ('time_entries', 'client_service', 'DELETE', 'DELETE', 'DELETE', 'Time entries (worklogs)', 'LOW', 60, '-', '-', 1),
  ('time_entry_internal_costs', 'client_service', 'DELETE', 'DELETE', 'DELETE', 'Internal cost snapshots of time entries', 'LOW', 60, '-', '-', 1),
  ('expenses', 'client_service', 'DELETE', 'DELETE', 'DELETE', 'Expenses', 'LOW', 60, '-', '-', 1),
  ('billing_batches', 'client_service', 'DELETE', 'DELETE', 'DELETE', 'Billing batches', 'MEDIUM', 61, '-', '-', 1),
  ('billing_batch_items', 'client_service', 'DELETE', 'DELETE', 'DELETE', 'Billing batch lines', 'LOW', 61, '-', '-', 1),
  ('client_service_reports', 'client_service', 'DELETE', 'DELETE', 'DELETE', 'Generated client service reports', 'MEDIUM', 61, '-', 'client-service-reports/ PDFs', 1),
  ('client_service_report_templates', 'client_service', 'CONDITIONAL', 'TRUNCATE_KEEP', 'TRUNCATE_KEEP', 'GLOBAL templates are configuration and are kept; CLIENT-scope templates belong to deleted companies. Truncated together with companies (FK) and the GLOBAL rows restored', 'MEDIUM', 62, '-', '-', 1),
  ('service_categories', 'client_service', 'PRESERVE', 'PRESERVE', 'PRESERVE', 'Service category definitions (seeded + configured)', 'LOW', 200, '-', '-', 1),
  ('internal_cost_rates', 'client_service', 'PRESERVE', 'PRESERVE', 'DELETE', 'Per-user internal cost configuration (profiles survive in Mode A)', 'MEDIUM', 200, '-', '-', 1),
  ('receipts', 'finance', 'DELETE', 'DELETE', 'DELETE', 'Financial receipts', 'HIGH', 70, 'RECEIPT', 'receipt/ cash-evidence/ files', 1),
  ('payments', 'finance', 'DELETE', 'DELETE', 'DELETE', 'Financial payments', 'HIGH', 70, 'PAYMENT', 'payment/ cash-evidence/ files', 1),
  ('cash_allocations', 'finance', 'DELETE', 'DELETE', 'DELETE', 'Receipt/payment allocations', 'MEDIUM', 70, '-', '-', 1),
  ('journal_entries', 'accounting', 'DELETE', 'DELETE', 'DELETE', 'Journal entries (test postings and reversals)', 'HIGH', 71, 'accounting_sequences', 'journal/ files', 1),
  ('journal_entry_lines', 'accounting', 'DELETE', 'DELETE', 'DELETE', 'Journal lines', 'HIGH', 71, '-', '-', 1),
  ('detail_accounts', 'accounting', 'DELETE', 'DELETE', 'DELETE', 'Sub-ledger (detail) accounts auto-created for companies/personnel', 'MEDIUM', 71, '-', '-', 1),
  ('cheque_books', 'cheques', 'DELETE', 'DELETE', 'DELETE', 'Cheque books', 'MEDIUM', 72, 'CHEQUE', '-', 1),
  ('cheques', 'cheques', 'DELETE', 'DELETE', 'DELETE', 'Cheques (test cheques and print history)', 'MEDIUM', 72, 'CHEQUE', 'cheque/ files', 1),
  ('cheque_print_templates', 'cheques', 'PRESERVE', 'PRESERVE', 'PRESERVE', 'Cheque print templates (system/organization configuration)', 'LOW', 200, '-', '-', 1),
  ('cheque_print_template_fields', 'cheques', 'PRESERVE', 'PRESERVE', 'PRESERVE', 'Field layout of print templates', 'LOW', 200, '-', '-', 1),
  ('cheque_status_transitions', 'cheques', 'PRESERVE', 'PRESERVE', 'PRESERVE', 'Seeded status state machine (lookup, not data)', 'LOW', 200, '-', '-', 1),
  ('accounts', 'accounting', 'PRESERVE', 'PRESERVE', 'PRESERVE', 'Chart of accounts (structure must survive)', 'HIGH', 200, '-', '-', 1),
  ('fiscal_years', 'accounting', 'PRESERVE', 'PRESERVE', 'PRESERVE', 'Fiscal configuration', 'HIGH', 200, '-', '-', 1),
  ('bank_accounts', 'accounting', 'PRESERVE', 'PRESERVE', 'PRESERVE', 'Company bank/cash accounts (organization setup, GL-linked)', 'MEDIUM', 200, '-', '-', 1),
  ('accounting_sequences', 'accounting', 'CONDITIONAL', 'RESET_VALUE', 'RESET_VALUE', 'Journal numbering counters per fiscal year: last_value reset to 0, rows kept', 'MEDIUM', 75, 'journal numbers', '-', 1),
  ('personnel', 'hr', 'DELETE', 'DELETE', 'DELETE', 'Personnel records (distinct from profiles; user accounts survive)', 'HIGH', 80, 'PERSONNEL', 'personnel/ files', 1),
  ('personnel_sensitive_details', 'hr', 'DELETE', 'DELETE', 'DELETE', 'Sensitive PII of personnel', 'HIGH', 80, '-', '-', 1),
  ('employment_records', 'hr', 'DELETE', 'DELETE', 'DELETE', 'Employment history', 'MEDIUM', 80, '-', '-', 1),
  ('personnel_payment_destinations', 'payroll', 'DELETE', 'DELETE', 'DELETE', 'Bank destinations of personnel', 'HIGH', 80, '-', '-', 1),
  ('personnel_status_transitions', 'hr', 'PRESERVE', 'PRESERVE', 'PRESERVE', 'Seeded status state machine (lookup, not data)', 'LOW', 200, '-', '-', 1),
  ('compensation_profiles', 'payroll', 'DELETE', 'DELETE', 'DELETE', 'Compensation profiles', 'HIGH', 81, '-', '-', 1),
  ('compensation_lines', 'payroll', 'DELETE', 'DELETE', 'DELETE', 'Compensation lines', 'HIGH', 81, '-', '-', 1),
  ('payroll_periods', 'payroll', 'DELETE', 'DELETE', 'DELETE', 'Payroll periods', 'MEDIUM', 82, '-', '-', 1),
  ('payroll_batches', 'payroll', 'DELETE', 'DELETE', 'DELETE', 'Payroll batches', 'HIGH', 82, 'PAYROLL_BATCH', '-', 1),
  ('payroll_eligibility_overrides', 'payroll', 'DELETE', 'DELETE', 'DELETE', 'Eligibility overrides', 'LOW', 82, '-', '-', 1),
  ('payroll_work_data', 'payroll', 'DELETE', 'DELETE', 'DELETE', 'Monthly work data', 'MEDIUM', 82, '-', '-', 1),
  ('payroll_work_inputs', 'payroll', 'DELETE', 'DELETE', 'DELETE', 'Manual payroll inputs', 'MEDIUM', 82, '-', '-', 1),
  ('payroll_calculations', 'payroll', 'DELETE', 'DELETE', 'DELETE', 'Payroll calculations', 'HIGH', 82, '-', '-', 1),
  ('payroll_results', 'payroll', 'DELETE', 'DELETE', 'DELETE', 'Payroll results', 'HIGH', 82, '-', '-', 1),
  ('payroll_result_lines', 'payroll', 'DELETE', 'DELETE', 'DELETE', 'Payroll result lines', 'HIGH', 82, '-', '-', 1),
  ('payroll_calc_warnings', 'payroll', 'DELETE', 'DELETE', 'DELETE', 'Calculation warnings', 'LOW', 82, '-', '-', 1),
  ('payroll_payments', 'payroll', 'DELETE', 'DELETE', 'DELETE', 'Payroll payment links', 'HIGH', 82, '-', '-', 1),
  ('payroll_payslips', 'payroll', 'DELETE', 'DELETE', 'DELETE', 'Payslip archive', 'HIGH', 82, '-', 'payslips/ PDFs', 1),
  ('payroll_batch_transitions', 'payroll', 'PRESERVE', 'PRESERVE', 'PRESERVE', 'Seeded status state machine (lookup, not data)', 'LOW', 200, '-', '-', 1),
  ('salary_components', 'payroll', 'PRESERVE', 'PRESERVE', 'DELETE', 'Salary component definitions (company configuration, nothing legal seeded)', 'MEDIUM', 200, '-', '-', 1),
  ('salary_component_versions', 'payroll', 'PRESERVE', 'PRESERVE', 'DELETE', 'Versions of salary component definitions', 'MEDIUM', 200, '-', '-', 1),
  ('legal_rule_sets', 'payroll', 'PRESERVE', 'PRESERVE', 'DELETE', 'Approved rule-set architecture', 'MEDIUM', 200, '-', '-', 1),
  ('legal_rule_entries', 'payroll', 'PRESERVE', 'PRESERVE', 'DELETE', 'Rule entries of rule sets', 'MEDIUM', 200, '-', '-', 1),
  ('legal_rule_set_transitions', 'payroll', 'PRESERVE', 'PRESERVE', 'PRESERVE', 'Seeded status state machine (lookup, not data)', 'LOW', 200, '-', '-', 1),
  ('payroll_accounting_settings', 'payroll', 'PRESERVE', 'PRESERVE', 'RESET_VALUE', 'Payroll account mapping (accounting configuration)', 'MEDIUM', 200, '-', '-', 1),
  ('payroll_component_accounts', 'payroll', 'PRESERVE', 'PRESERVE', 'DELETE', 'Component to account mapping', 'MEDIUM', 200, '-', '-', 1),
  ('trade_offers', 'trade', 'DELETE', 'DELETE', 'DELETE', 'Trade portal offers', 'MEDIUM', 90, 'OFFER', 'trade/offers/ uploads', 1),
  ('trade_offer_buyers', 'trade', 'DELETE', 'DELETE', 'DELETE', 'Buyer assignments (portal tokens die with them)', 'MEDIUM', 90, '-', '-', 1),
  ('trade_offer_responses', 'trade', 'DELETE', 'DELETE', 'DELETE', 'Buyer responses', 'LOW', 90, '-', '-', 1),
  ('trade_offer_documents', 'trade', 'DELETE', 'DELETE', 'DELETE', 'Uploaded LOI/ICPO documents', 'MEDIUM', 90, '-', 'trade/offers/ uploads', 1),
  ('trade_offer_deadline_history', 'trade', 'DELETE', 'DELETE', 'DELETE', 'Deadline history', 'LOW', 90, '-', '-', 1),
  ('trade_offer_events', 'trade', 'DELETE', 'DELETE', 'DELETE', 'Offer events', 'LOW', 90, '-', '-', 1),
  ('assistant_conversations', 'assistant', 'DELETE', 'DELETE', 'DELETE', 'Conversation sessions', 'LOW', 100, '-', '-', 1),
  ('assistant_messages', 'assistant', 'DELETE', 'DELETE', 'DELETE', 'Conversation messages', 'LOW', 100, '-', '-', 1),
  ('assistant_pending_actions', 'assistant', 'DELETE', 'DELETE', 'DELETE', 'Pending / confirmed actions', 'MEDIUM', 100, '-', '-', 1),
  ('assistant_channel_updates', 'assistant', 'DELETE', 'DELETE', 'DELETE', 'Telegram update idempotency records', 'LOW', 100, '-', '-', 1),
  ('assistant_usage', 'assistant', 'DELETE', 'DELETE', 'DELETE', 'Daily usage counters', 'LOW', 100, '-', '-', 1),
  ('assistant_channel_identities', 'assistant', 'PRESERVE', 'PRESERVE', 'DELETE', 'Telegram identity links of users (configuration; users survive)', 'MEDIUM', 200, '-', '-', 1),
  ('external_intakes', 'external_bot', 'DELETE', 'DELETE', 'DELETE', 'External correspondence intakes', 'MEDIUM', 110, '-', 'external-correspondence/ files', 1),
  ('external_intake_documents', 'external_bot', 'DELETE', 'DELETE', 'DELETE', 'Intake documents', 'MEDIUM', 110, '-', '-', 1),
  ('external_intake_events', 'external_bot', 'DELETE', 'DELETE', 'DELETE', 'Intake events', 'LOW', 110, '-', '-', 1),
  ('external_bot_rate_limits', 'external_bot', 'DELETE', 'DELETE', 'DELETE', 'Rate limit state', 'LOW', 110, '-', '-', 1),
  ('external_bot_updates', 'external_bot', 'DELETE', 'DELETE', 'DELETE', 'Update idempotency records', 'LOW', 110, '-', '-', 1),
  ('external_bot_conversation_state', 'external_bot', 'DELETE', 'DELETE', 'DELETE', 'Conversation state', 'LOW', 110, '-', '-', 1),
  ('profiles', 'auth', 'PRESERVE', 'PRESERVE', 'ADMINS_ONLY', 'Application profiles = users, roles and signature paths. Required for administrative access', 'HIGH', 200, '-', '-', 1),
  ('app_settings', 'system', 'PRESERVE', 'PRESERVE', 'PRESERVE', 'Application, organization, branding and accounting-default configuration', 'HIGH', 200, '-', '-', 1),
  ('number_sequences', 'numbering', 'CONDITIONAL', 'RESET_VALUE', 'RESET_VALUE', 'Operational counters: current year reset to the configured baselines, other years to 0; rows and CHECK scopes kept', 'HIGH', 76, 'all scopes', '-', 1),
  ('activity_logs', 'audit', 'CONDITIONAL', 'FILTERED_DELETE', 'FILTERED_DELETE', 'Audit trail: only rows of reset business entity types are purged; security/system/config rows and the reset''s own events stay', 'MEDIUM', 77, '-', '-', 1),
  ('system_reset_manifest', 'system_reset', 'NEVER_TOUCH', 'NEVER', 'NEVER', 'The manifest itself', 'HIGH', 900, '-', '-', 1),
  ('system_reset_storage_rules', 'system_reset', 'NEVER_TOUCH', 'NEVER', 'NEVER', 'Storage classification rules', 'HIGH', 900, '-', '-', 1),
  ('system_reset_plans', 'system_reset', 'NEVER_TOUCH', 'NEVER', 'NEVER', 'Dry-run plans (history)', 'HIGH', 900, '-', '-', 1),
  ('system_reset_runs', 'system_reset', 'NEVER_TOUCH', 'NEVER', 'NEVER', 'Reset history - must survive every reset', 'HIGH', 900, '-', '-', 1),
  ('system_reset_run_events', 'system_reset', 'NEVER_TOUCH', 'NEVER', 'NEVER', 'Reset phase events - must survive every reset', 'HIGH', 900, '-', '-', 1),
  ('system_reset_storage_items', 'system_reset', 'NEVER_TOUCH', 'NEVER', 'NEVER', 'Per-run storage cleanup items', 'HIGH', 900, '-', '-', 1),
  ('system_maintenance', 'system_reset', 'NEVER_TOUCH', 'NEVER', 'NEVER', 'Maintenance lock', 'HIGH', 900, '-', '-', 1),
  ('system_reset_grants', 'system_reset', 'NEVER_TOUCH', 'NEVER', 'NEVER', 'SYSTEM_FACTORY_RESET permission grants', 'HIGH', 900, '-', '-', 1)
on conflict (object_name) do update set
  module = excluded.module, classification = excluded.classification, mode_a = excluded.mode_a, mode_b = excluded.mode_b,
  reason = excluded.reason, risk = excluded.risk, reset_order = excluded.reset_order, sequence_impact = excluded.sequence_impact,
  storage_impact = excluded.storage_impact, manifest_version = excluded.manifest_version;

insert into public.system_reset_storage_rules (prefix, action, reason) values
  ('correspondence/',            'DELETE',   'letter PDFs and scans'),
  ('document/',                  'DELETE',   'archive documents'),
  ('case/',                      'DELETE',   'case attachments'),
  ('journal/',                   'DELETE',   'journal attachments'),
  ('receipt/',                   'DELETE',   'receipt attachments'),
  ('payment/',                   'DELETE',   'payment attachments'),
  ('cash-evidence/',             'DELETE',   'receipt/payment evidence (assistant + web)'),
  ('contract/',                  'DELETE',   'contract files'),
  ('sales_document/',            'DELETE',   'proforma / invoice files'),
  ('company/',                   'DELETE',   'company attachments'),
  ('opportunity/',               'DELETE',   'opportunity attachments'),
  ('project/',                   'DELETE',   'project files'),
  ('task/',                      'DELETE',   'task files'),
  ('cheque/',                    'DELETE',   'cheque files'),
  ('service_entry/',             'DELETE',   'service ledger files'),
  ('service_expense/',           'DELETE',   'service ledger expense files'),
  ('personnel/',                 'DELETE',   'HR documents'),
  ('payslips/',                  'DELETE',   'payslip PDFs'),
  ('client-service-reports/',    'DELETE',   'client service report PDFs'),
  ('trade/',                     'DELETE',   'trade portal uploads (LOI / ICPO)'),
  ('external-correspondence/',   'DELETE',   'external correspondence intake files'),
  ('settings/',                  'PRESERVE', 'letterhead / stamp / branding'),
  ('signatures/',                'PRESERVE', 'user signature images')
on conflict (prefix) do update set action = excluded.action, reason = excluded.reason;

-- ---------------------------------------------------------------------
-- 3) internal helpers (not granted to anyone but service_role)
-- ---------------------------------------------------------------------
create or replace function public._srs_set(p_mode text)
returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(m.object_name order by m.reset_order, m.object_name), '{}'::text[])
    from public.system_reset_manifest m
   where m.object_kind = 'TABLE'
     and (case when p_mode = 'FULL' then m.mode_b else m.mode_a end) in ('DELETE', 'TRUNCATE_KEEP');
$$;

-- validated row count: the name must be a real public table AND be in the manifest (no arbitrary table name ever reaches format())
create or replace function public._srs_count(p_name text)
returns bigint
language plpgsql stable security definer set search_path = public as $$
declare v bigint;
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = p_name and c.relkind in ('r', 'p')) then
    return null;
  end if;
  if not exists (select 1 from public.system_reset_manifest m where m.object_name = p_name) then
    raise exception 'RESET_OBJECT_NOT_IN_MANIFEST' using errcode = '22000';
  end if;
  execute format('select count(*) from public.%I', p_name) into v;
  return v;
end; $$;

create or replace function public.system_reset_manifest_hash()
returns text
language sql stable security definer set search_path = public as $$
  select md5(coalesce(string_agg(concat_ws('|', m.object_name, m.classification, m.mode_a, m.mode_b, m.reset_order::text, m.manifest_version::text),
                                  ';' order by m.object_name), ''))
    from public.system_reset_manifest m;
$$;

create or replace function public.system_reset_schema_hash()
returns text
language sql stable security definer set search_path = public as $$
  select md5(coalesce(string_agg(c.table_name || '.' || c.column_name || ':' || c.data_type, ';' order by c.table_name, c.ordinal_position), ''))
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
   where c.table_schema = 'public';
$$;

create or replace function public.system_reset_unknown_tables()
returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(c.relname order by c.relname), '{}'::text[])
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and not exists (select 1 from public.system_reset_manifest m where m.object_name = c.relname);
$$;

create or replace function public.system_reset_missing_objects()
returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(m.object_name order by m.object_name), '{}'::text[])
    from public.system_reset_manifest m
   where not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relname = m.object_name and c.relkind in ('r', 'p'));
$$;

-- a table that is NOT truncated but holds a foreign key to a table that IS truncated would make TRUNCATE fail: report it before anything runs
create or replace function public.system_reset_fk_blockers(p_mode text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('referencing', cr.relname, 'referenced', cf.relname, 'constraint', k.conname)
                            order by cr.relname, k.conname), '[]'::jsonb)
    from pg_constraint k
    join pg_class cr on cr.oid = k.conrelid
    join pg_namespace nr on nr.oid = cr.relnamespace
    join pg_class cf on cf.oid = k.confrelid
    join pg_namespace nf on nf.oid = cf.relnamespace
   where k.contype = 'f' and nr.nspname = 'public' and nf.nspname = 'public'
     and cf.relname = any (public._srs_set(p_mode))
     and not (cr.relname = any (public._srs_set(p_mode)));
$$;

-- activity_logs entity types that belong to reset business data (table names + the singular aliases the audit code uses)
create or replace function public._srs_audit_types(p_mode text)
returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct t), '{}'::text[])
    from (
      select m.object_name as t from public.system_reset_manifest m
       where (case when p_mode = 'FULL' then m.mode_b else m.mode_a end) = 'DELETE'
      union select 'receipt' union select 'payment' union select 'journal_entry'
    ) x;
$$;

-- storage classification of the bucket (rules by longest prefix; registered paths of reset tables; hard preserve for branding paths)
create or replace function public._srs_storage_classify()
returns table (path text, action text, reason text)
language plpgsql stable security definer set search_path = public, storage as $$
begin
  return query
  with obj as (
    select o.name
      from storage.objects o
     where o.bucket_id = 'nil-files' and o.name not like '%/.emptyFolderPlaceholder' and o.name <> '.emptyFolderPlaceholder'
  ), keep as (
    select a.letterhead_path as p from public.app_settings a
    union select a.stamp_path from public.app_settings a
    union select pr.signature_path from public.profiles pr
  ), reg as (
    select x.storage_path as p from public.attachments x
    union select x.storage_path from public.trade_offer_documents x
    union select x.storage_path from public.client_service_reports x
    union select x.storage_path from public.external_intake_documents x
    union select x.storage_path from public.payroll_payslips x
  ), best as (
    select o.name,
           (select r.prefix from public.system_reset_storage_rules r where starts_with(o.name, r.prefix) order by length(r.prefix) desc limit 1) as pfx
      from obj o
  )
  select b.name::text,
         (case when b.name in (select k.p from keep k where k.p is not null) then 'PRESERVE'
               when rr.action is not null then rr.action
               when b.name in (select g.p from reg g) then 'DELETE'
               else 'UNKNOWN' end)::text,
         (case when b.name in (select k.p from keep k where k.p is not null) then 'branding / signature path in use'
               when rr.action is not null then rr.reason
               when b.name in (select g.p from reg g) then 'registered by a reset table'
               else 'unclassified prefix: reported, never deleted' end)::text
    from best b
    left join public.system_reset_storage_rules rr on rr.prefix = b.pfx;
end; $$;

create or replace function public._srs_env_guard(p_env text, p_allow_production boolean)
returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_env is null or p_env not in ('development', 'uat', 'production') then
    raise exception 'RESET_ENVIRONMENT_INVALID' using errcode = '22000';
  end if;
  if p_env = 'production' and not coalesce(p_allow_production, false) then
    raise exception 'RESET_PRODUCTION_BLOCKED' using errcode = '22000';
  end if;
end; $$;

create or replace function public.system_reset_has_permission(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_user is not null
     and exists (select 1 from public.profiles pr where pr.id = p_user and pr.is_active and pr.role = 'ADMIN')
     and exists (select 1 from public.system_reset_grants g where g.profile_id = p_user and g.revoked_at is null);
$$;

create or replace function public._srs_require_permission(p_user uuid)
returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.system_reset_has_permission(p_user) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
end; $$;

-- parameters: current Jalali year + per-scope "last used number" baselines. Anything else is rejected.
create or replace function public._srs_params(p_params jsonb)
returns jsonb
language plpgsql immutable as $$
declare
  v_year integer; v_base jsonb := '{}'::jsonb; k text; v jsonb;
  c_scopes text[] := array['OUTGOING','INCOMING','CASE','CONTRACT','PROFORMA','INVOICE','OPPORTUNITY','PROJECT','OFFER','CHEQUE','RECEIPT','PAYMENT','PERSONNEL','PAYROLL_BATCH'];
begin
  if p_params is null or jsonb_typeof(p_params) <> 'object' then raise exception 'RESET_PARAMS_INVALID' using errcode = '22000'; end if;
  if exists (select 1 from jsonb_object_keys(p_params) x where x not in ('current_year', 'baselines')) then
    raise exception 'RESET_PARAMS_INVALID' using errcode = '22000';
  end if;
  begin v_year := (p_params ->> 'current_year')::integer; exception when others then v_year := null; end;
  if v_year is null or v_year < 1300 or v_year > 1600 then raise exception 'RESET_PARAMS_INVALID' using errcode = '22000'; end if;
  if p_params ? 'baselines' then
    if jsonb_typeof(p_params -> 'baselines') <> 'object' then raise exception 'RESET_PARAMS_INVALID' using errcode = '22000'; end if;
    for k, v in select * from jsonb_each(p_params -> 'baselines') loop
      if k <> all (c_scopes) or jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{1,8}$' then
        raise exception 'RESET_PARAMS_INVALID' using errcode = '22000';
      end if;
      v_base := v_base || jsonb_build_object(k, (v #>> '{}')::integer);
    end loop;
  end if;
  return jsonb_build_object('current_year', v_year, 'baselines', v_base);
end; $$;

-- ---------------------------------------------------------------------
-- 4) preview (read-only) and dry run (stores a plan)
-- ---------------------------------------------------------------------
create or replace function public.system_reset_preview(p_mode text, p_params jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public, storage as $$
declare
  v_par jsonb; v_set text[]; v_year integer; v_types text[]; v_tables jsonb; v_rows bigint; v_preserve jsonb;
  v_audit_del bigint; v_audit_keep bigint; v_audit_unknown jsonb; v_seq jsonb; v_seq_new jsonb; v_acc jsonb;
  v_sto jsonb; v_unknown text[]; v_missing text[]; v_fk jsonb; v_admins jsonb; v_warn jsonb := '[]'::jsonb;
  v_tpl_keep bigint; v_tpl_rm bigint; v_att_orphans bigint; v_unreg bigint;
begin
  if p_mode is null or p_mode not in ('OPERATIONAL', 'FULL') then raise exception 'RESET_MODE_INVALID' using errcode = '22000'; end if;
  v_par := public._srs_params(p_params);
  v_year := (v_par ->> 'current_year')::integer;
  v_set := public._srs_set(p_mode);
  v_types := public._srs_audit_types(p_mode);

  select coalesce(jsonb_agg(jsonb_build_object('name', m.object_name, 'module', m.module, 'rows', public._srs_count(m.object_name),
                              'method', (case when p_mode = 'FULL' then m.mode_b else m.mode_a end), 'risk', m.risk,
                              'storage', m.storage_impact, 'sequence', m.sequence_impact) order by m.reset_order, m.object_name), '[]'::jsonb),
         coalesce(sum(public._srs_count(m.object_name)), 0)
    into v_tables, v_rows
    from public.system_reset_manifest m
   where m.object_name = any (v_set);

  select coalesce(jsonb_agg(jsonb_build_object('name', m.object_name, 'module', m.module, 'rows', public._srs_count(m.object_name),
                              'method', (case when p_mode = 'FULL' then m.mode_b else m.mode_a end), 'reason', m.reason) order by m.object_name), '[]'::jsonb)
    into v_preserve
    from public.system_reset_manifest m
   where not (m.object_name = any (v_set)) and m.mode_a <> 'NEVER';

  select count(*) filter (where scope = 'GLOBAL'), count(*) filter (where scope <> 'GLOBAL')
    into v_tpl_keep, v_tpl_rm from public.client_service_report_templates;

  select count(*) filter (where l.entity_type = any (v_types)), count(*) filter (where not (l.entity_type = any (v_types)))
    into v_audit_del, v_audit_keep from public.activity_logs l;
  select coalesce(jsonb_agg(distinct l.entity_type), '[]'::jsonb) into v_audit_unknown
    from public.activity_logs l
   where not (l.entity_type = any (v_types))
     and not exists (select 1 from public.system_reset_manifest m where m.object_name = l.entity_type)
     and l.entity_type not in ('fiscal_year', 'assistant', 'system_reset', 'payroll_reports', 'hr_reports');

  select coalesce(jsonb_agg(jsonb_build_object('scope', s.scope, 'year', s.year, 'from', s.last_value,
                              'to', (case when s.year = v_year then coalesce((v_par -> 'baselines' ->> s.scope)::integer, 0) else 0 end))
                            order by s.scope, s.year), '[]'::jsonb)
    into v_seq from public.number_sequences s;
  select coalesce(jsonb_agg(jsonb_build_object('scope', b.key, 'year', v_year, 'to', (b.value #>> '{}')::integer) order by b.key), '[]'::jsonb)
    into v_seq_new
    from jsonb_each(v_par -> 'baselines') b
   where not exists (select 1 from public.number_sequences s where s.scope = b.key and s.year = v_year);
  select jsonb_build_object('rows', count(*), 'sum_last_value', coalesce(sum(last_value), 0)) into v_acc from public.accounting_sequences;

  select jsonb_build_object(
           'delete_count', count(*) filter (where c.action = 'DELETE'),
           'preserve_count', count(*) filter (where c.action = 'PRESERVE'),
           'unknown_count', count(*) filter (where c.action = 'UNKNOWN'),
           'unknown_sample', coalesce((select jsonb_agg(u.path) from (select x.path from public._srs_storage_classify() x where x.action = 'UNKNOWN' order by x.path limit 20) u), '[]'::jsonb))
    into v_sto from public._srs_storage_classify() c;
  select count(*) into v_att_orphans from public.attachments a
   where not exists (select 1 from storage.objects o where o.bucket_id = 'nil-files' and o.name = a.storage_path);
  select count(*) into v_unreg from public._srs_storage_classify() c
   where c.action = 'DELETE' and not exists (select 1 from public.attachments a where a.storage_path = c.path)
     and not exists (select 1 from public.payroll_payslips a where a.storage_path = c.path)
     and not exists (select 1 from public.client_service_reports a where a.storage_path = c.path)
     and not exists (select 1 from public.trade_offer_documents a where a.storage_path = c.path)
     and not exists (select 1 from public.external_intake_documents a where a.storage_path = c.path);

  v_unknown := public.system_reset_unknown_tables();
  v_missing := public.system_reset_missing_objects();
  v_fk := public.system_reset_fk_blockers(p_mode);
  select jsonb_build_object('count', count(*), 'profile_ids', coalesce(jsonb_agg(p.id), '[]'::jsonb))
    into v_admins from public.profiles p where p.is_active and p.role = 'ADMIN';

  if p_mode = 'FULL' then v_warn := v_warn || jsonb_build_array('MODE_FULL_DRY_RUN_ONLY'); end if;
  if coalesce(array_length(v_unknown, 1), 0) > 0 then v_warn := v_warn || jsonb_build_array('UNKNOWN_TABLES_BLOCK_EXECUTION'); end if;
  if jsonb_array_length(v_fk) > 0 then v_warn := v_warn || jsonb_build_array('FK_BLOCKERS_BLOCK_EXECUTION'); end if;
  if coalesce((v_admins ->> 'count')::integer, 0) < 1 then v_warn := v_warn || jsonb_build_array('NO_ACTIVE_ADMIN'); end if;
  if (v_sto ->> 'unknown_count')::integer > 0 then v_warn := v_warn || jsonb_build_array('UNKNOWN_STORAGE_OBJECTS_WILL_BE_KEPT'); end if;

  return jsonb_build_object(
    'mode', p_mode,
    'manifest_version', (select coalesce(max(manifest_version), 0) from public.system_reset_manifest),
    'manifest_hash', public.system_reset_manifest_hash(),
    'schema_hash', public.system_reset_schema_hash(),
    'params', v_par,
    'tables_to_delete', v_tables,
    'tables_preserved', v_preserve,
    'totals', jsonb_build_object('tables', coalesce(array_length(v_set, 1), 0), 'rows_to_delete', v_rows,
                                 'audit_rows_to_delete', v_audit_del, 'storage_objects_to_delete', (v_sto ->> 'delete_count')::integer),
    'templates', jsonb_build_object('global_kept', v_tpl_keep, 'client_scope_removed', v_tpl_rm),
    'audit', jsonb_build_object('rows_to_delete', v_audit_del, 'rows_kept', v_audit_keep, 'unclassified_entity_types', v_audit_unknown,
                                'deleted_entity_types', to_jsonb(v_types)),
    'sequences', jsonb_build_object('number_sequences', v_seq, 'rows_to_create', v_seq_new, 'accounting_sequences', v_acc),
    'storage', v_sto,
    'unknown_tables', to_jsonb(v_unknown),
    'missing_manifest_objects', to_jsonb(v_missing),
    'fk_blockers', v_fk,
    'orphan_risks', jsonb_build_object('attachments_without_file', v_att_orphans, 'business_files_without_record', v_unreg,
                                       'unknown_storage_objects', (v_sto ->> 'unknown_count')::integer),
    'admins_preserved', v_admins,
    'warnings', v_warn,
    'executable', (p_mode = 'OPERATIONAL' and coalesce(array_length(v_unknown, 1), 0) = 0 and jsonb_array_length(v_fk) = 0
                   and coalesce(array_length(v_missing, 1), 0) = 0 and coalesce((v_admins ->> 'count')::integer, 0) >= 1)
  );
end; $$;

create or replace function public.system_reset_dry_run(
  p_user uuid, p_mode text, p_params jsonb, p_environment text, p_allow_production boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prev jsonb; v_id uuid; v_exp timestamptz := now() + interval '30 minutes'; v_par jsonb;
begin
  perform public._srs_require_permission(p_user);
  perform public._srs_env_guard(p_environment, p_allow_production);
  v_prev := public.system_reset_preview(p_mode, p_params);           -- validates mode + params
  v_par := v_prev -> 'params';
  update public.system_reset_plans set status = 'EXPIRED' where created_by = p_user and status in ('PLANNED', 'READY');
  insert into public.system_reset_plans (mode, environment, created_by, expires_at, manifest_version, manifest_hash, schema_hash, params, preview)
  values (p_mode, p_environment, p_user, v_exp, (v_prev ->> 'manifest_version')::integer, v_prev ->> 'manifest_hash', v_prev ->> 'schema_hash', v_par, v_prev)
  returning id into v_id;
  perform public.write_log('system_reset', v_id, 'FACTORY_RESET_DRY_RUN', null,
    jsonb_build_object('mode', p_mode, 'environment', p_environment, 'user_id', p_user, 'rows_to_delete', v_prev #>> '{totals,rows_to_delete}'));
  return jsonb_build_object('plan_id', v_id, 'expires_at', v_exp, 'preview', v_prev);
end; $$;

create or replace function public.system_reset_cancel_plan(p_user uuid, p_plan uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._srs_require_permission(p_user);
  update public.system_reset_plans set status = 'CANCELLED' where id = p_plan and created_by = p_user and status in ('PLANNED', 'READY');
end; $$;

-- ---------------------------------------------------------------------
-- 5) arm (backup gate + typed phrase + second confirmation -> one-time token) and begin (atomic claim + maintenance lock)
-- ---------------------------------------------------------------------
create or replace function public.system_reset_arm(
  p_user uuid, p_plan uuid, p_phrase text, p_second_confirm boolean,
  p_backup_reference text, p_backup_timestamp timestamptz, p_backup_status text,
  p_environment text, p_allow_production boolean default false
) returns text
language plpgsql security definer set search_path = public as $$
declare v_plan public.system_reset_plans; v_token text;
begin
  perform public._srs_require_permission(p_user);
  perform public._srs_env_guard(p_environment, p_allow_production);
  select * into v_plan from public.system_reset_plans where id = p_plan for update;
  if not found or v_plan.created_by is distinct from p_user then raise exception 'RESET_PLAN_INVALID' using errcode = '22000'; end if;
  if v_plan.status not in ('PLANNED', 'READY') then raise exception 'RESET_PLAN_INVALID' using errcode = '22000'; end if;
  if v_plan.expires_at < now() then
    update public.system_reset_plans set status = 'EXPIRED' where id = p_plan;
    raise exception 'RESET_PLAN_EXPIRED' using errcode = '22000';
  end if;
  if v_plan.environment is distinct from p_environment then raise exception 'RESET_PLAN_STALE' using errcode = '22000'; end if;
  if v_plan.mode <> 'OPERATIONAL' then raise exception 'MODE_NOT_ENABLED' using errcode = '22000'; end if;
  if v_plan.manifest_hash is distinct from public.system_reset_manifest_hash() or v_plan.schema_hash is distinct from public.system_reset_schema_hash() then
    raise exception 'RESET_PLAN_STALE' using errcode = '22000';
  end if;
  if coalesce(array_length(public.system_reset_unknown_tables(), 1), 0) > 0 or jsonb_array_length(public.system_reset_fk_blockers(v_plan.mode)) > 0 then
    raise exception 'RESET_NOT_EXECUTABLE' using errcode = '22000';
  end if;
  if p_phrase is distinct from 'RESET NIL OFFICE' then raise exception 'RESET_CONFIRMATION_INVALID' using errcode = '22000'; end if;
  if not coalesce(p_second_confirm, false) then raise exception 'RESET_CONFIRMATION_INVALID' using errcode = '22000'; end if;
  if p_backup_reference is null or length(btrim(p_backup_reference)) < 4 or length(p_backup_reference) > 200
     or p_backup_timestamp is null or p_backup_timestamp > now() + interval '5 minutes' or p_backup_timestamp < now() - interval '48 hours'
     or p_backup_status is distinct from 'CONFIRMED_BY_ADMIN' then
    raise exception 'RESET_BACKUP_REQUIRED' using errcode = '22000';
  end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  update public.system_reset_plans
     set status = 'READY', armed_at = now(), backup_reference = btrim(p_backup_reference), backup_timestamp = p_backup_timestamp,
         backup_status = p_backup_status, token_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), token_expires_at = now() + interval '10 minutes'
   where id = p_plan;
  perform public.write_log('system_reset', p_plan, 'FACTORY_RESET_ARMED', null,
    jsonb_build_object('user_id', p_user, 'backup_reference', btrim(p_backup_reference), 'backup_timestamp', p_backup_timestamp));
  return v_token;
end; $$;

create or replace function public.system_reset_begin(
  p_user uuid, p_plan uuid, p_token text, p_environment text, p_allow_production boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_plan public.system_reset_plans; v_run uuid; v_claimed uuid; v_lock public.system_maintenance;
begin
  perform public._srs_require_permission(p_user);
  perform public._srs_env_guard(p_environment, p_allow_production);
  select * into v_plan from public.system_reset_plans where id = p_plan for update;
  if not found or v_plan.created_by is distinct from p_user then raise exception 'RESET_PLAN_INVALID' using errcode = '22000'; end if;
  if v_plan.status <> 'READY' then raise exception 'RESET_PLAN_INVALID' using errcode = '22000'; end if;   -- USED / EXPIRED / CANCELLED / not armed
  if v_plan.expires_at < now() or v_plan.token_expires_at is null or v_plan.token_expires_at < now() then raise exception 'RESET_PLAN_EXPIRED' using errcode = '22000'; end if;
  if v_plan.environment is distinct from p_environment then raise exception 'RESET_PLAN_STALE' using errcode = '22000'; end if;
  if v_plan.mode <> 'OPERATIONAL' then raise exception 'MODE_NOT_ENABLED' using errcode = '22000'; end if;
  if p_token is null or v_plan.token_hash is distinct from encode(sha256(convert_to(p_token, 'UTF8')), 'hex') then raise exception 'RESET_CONFIRMATION_INVALID' using errcode = '22000'; end if;
  if v_plan.manifest_hash is distinct from public.system_reset_manifest_hash() or v_plan.schema_hash is distinct from public.system_reset_schema_hash() then
    raise exception 'RESET_PLAN_STALE' using errcode = '22000';
  end if;
  if coalesce(array_length(public.system_reset_unknown_tables(), 1), 0) > 0 or jsonb_array_length(public.system_reset_fk_blockers(v_plan.mode)) > 0 then
    raise exception 'RESET_NOT_EXECUTABLE' using errcode = '22000';
  end if;

  select * into v_lock from public.system_maintenance where id = 1 for update;
  if v_lock.locked then raise exception 'RESET_ALREADY_RUNNING' using errcode = '22000'; end if;

  -- atomic one-shot claim: a double click / retry / second request finds status <> READY and fails above
  update public.system_reset_plans set status = 'USED', token_hash = null where id = p_plan and status = 'READY' returning id into v_claimed;
  if v_claimed is null then raise exception 'RESET_ALREADY_RUNNING' using errcode = '22000'; end if;

  insert into public.system_reset_runs (plan_id, tenant_key, mode, environment, initiated_by, backup_reference, backup_timestamp, manifest_version)
  values (p_plan, v_plan.tenant_key, v_plan.mode, v_plan.environment, p_user, v_plan.backup_reference, v_plan.backup_timestamp, v_plan.manifest_version)
  returning id into v_run;
  update public.system_maintenance set locked = true, reset_id = v_run, locked_by = p_user, locked_at = now(), reason = 'FACTORY_RESET' where id = 1;
  insert into public.system_reset_run_events (run_id, phase, detail) values (v_run, 'PREPARED', jsonb_build_object('plan_id', p_plan));
  perform public.write_log('system_reset', v_run, 'FACTORY_RESET_STARTED', null,
    jsonb_build_object('plan_id', p_plan, 'mode', v_plan.mode, 'environment', v_plan.environment, 'user_id', p_user, 'backup_reference', v_plan.backup_reference));
  return v_run;
end; $$;

-- ---------------------------------------------------------------------
-- 6) the destructive DB phase: ONE transaction. Nothing here runs unless begin() succeeded for this run.
-- ---------------------------------------------------------------------
create or replace function public.system_reset_execute_db(
  p_user uuid, p_run uuid, p_environment text, p_allow_production boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, storage as $$
declare
  v_run public.system_reset_runs; v_plan public.system_reset_plans; v_set text[]; v_lock_list text; v_trunc text;
  v_before jsonb := '{}'::jsonb; v_after_total bigint := 0; v_name text; v_n bigint; v_types text[]; v_year integer; v_base jsonb;
  v_audit_deleted bigint; v_items bigint; v_deleted jsonb := '{}'::jsonb; v_t0 timestamptz := now(); v_tpl_kept bigint;
begin
  perform public._srs_require_permission(p_user);                              -- second permission check, immediately before execution
  perform public._srs_env_guard(p_environment, p_allow_production);
  perform set_config('lock_timeout', '30s', true);
  perform set_config('statement_timeout', '300s', true);

  select * into v_run from public.system_reset_runs where id = p_run for update;
  if not found or v_run.initiated_by is distinct from p_user then raise exception 'RESET_PLAN_INVALID' using errcode = '22000'; end if;
  if v_run.phase = 'DB_RESET_COMPLETED' or v_run.phase in ('STORAGE_CLEANUP_STARTED', 'STORAGE_CLEANUP_COMPLETED', 'VERIFICATION', 'COMPLETED') then
    return jsonb_build_object('already_done', true, 'phase', v_run.phase);   -- idempotent: the DB phase is never run twice
  end if;
  if v_run.status <> 'RUNNING' or v_run.phase <> 'PREPARED' or v_run.mode <> 'OPERATIONAL' then raise exception 'RESET_PLAN_INVALID' using errcode = '22000'; end if;
  if v_run.environment is distinct from p_environment then raise exception 'RESET_PLAN_STALE' using errcode = '22000'; end if;
  if not exists (select 1 from public.system_maintenance where id = 1 and locked and reset_id = p_run) then raise exception 'RESET_PLAN_INVALID' using errcode = '22000'; end if;
  select * into v_plan from public.system_reset_plans where id = v_run.plan_id;
  if v_plan.manifest_hash is distinct from public.system_reset_manifest_hash() or v_plan.schema_hash is distinct from public.system_reset_schema_hash() then
    raise exception 'RESET_PLAN_STALE' using errcode = '22000';
  end if;
  if coalesce(array_length(public.system_reset_unknown_tables(), 1), 0) > 0 or jsonb_array_length(public.system_reset_fk_blockers('OPERATIONAL')) > 0
     or coalesce(array_length(public.system_reset_missing_objects(), 1), 0) > 0 then
    raise exception 'RESET_NOT_EXECUTABLE' using errcode = '22000';
  end if;

  v_set := public._srs_set('OPERATIONAL');
  v_types := public._srs_audit_types('OPERATIONAL');
  v_year := (v_plan.params ->> 'current_year')::integer;
  v_base := coalesce(v_plan.params -> 'baselines', '{}'::jsonb);

  update public.system_reset_runs set phase = 'DB_RESET_STARTED' where id = p_run;

  -- block every concurrent writer for the rest of this transaction
  select string_agg(format('public.%I', t), ', ') into v_lock_list
    from unnest(v_set || array['activity_logs', 'number_sequences', 'accounting_sequences']) t;
  execute 'lock table ' || v_lock_list || ' in access exclusive mode';

  -- counts before (authoritative: under the lock)
  foreach v_name in array v_set loop
    v_n := public._srs_count(v_name);
    v_before := v_before || jsonb_build_object(v_name, v_n);
  end loop;
  for v_name in select m.object_name from public.system_reset_manifest m where m.mode_a in ('PRESERVE', 'RESET_VALUE', 'FILTERED_DELETE') loop
    v_before := v_before || jsonb_build_object('preserve:' || v_name, public._srs_count(v_name));
  end loop;
  select count(*) into v_tpl_kept from public.client_service_report_templates where scope = 'GLOBAL';
  v_before := v_before || jsonb_build_object('_templates_global', v_tpl_kept,
                                             '_policies', (select count(*) from pg_policies where schemaname in ('public', 'storage')),
                                             '_fk_not_validated', (select count(*) from pg_constraint where contype = 'f' and not convalidated),
                                             '_admins', (select count(*) from public.profiles where is_active and role = 'ADMIN'));

  -- storage cleanup list is decided HERE, from the server-side classification, before any record disappears
  insert into public.system_reset_storage_items (run_id, path, reason)
  select p_run, c.path, c.reason from public._srs_storage_classify() c where c.action = 'DELETE'
  on conflict (run_id, path) do nothing;
  get diagnostics v_items = row_count;

  -- keep-rows of the one partially preserved table (its FK to companies forces it into the same TRUNCATE)
  create temp table _srs_keep_templates on commit drop as select * from public.client_service_report_templates where scope = 'GLOBAL';

  -- ONE statement, no CASCADE: Postgres refuses it unless every FK-related table is in the list (checked above too)
  select 'truncate table ' || string_agg(format('public.%I', t), ', ') into v_trunc from unnest(v_set) t;
  execute v_trunc;

  insert into public.client_service_report_templates select * from _srs_keep_templates;
  delete from public.activity_logs where entity_type = 'client_service_report_templates' and created_at = v_t0;   -- noise of the restore insert only

  -- audit: business-entity rows only; security / system / config rows and the reset's own events stay
  delete from public.activity_logs where entity_type = any (v_types);
  get diagnostics v_audit_deleted = row_count;

  -- numbering: current Jalali year -> configured baselines, every other year -> 0, journal counters -> 0
  update public.number_sequences set last_value = 0, updated_at = now() where year <> v_year;
  update public.number_sequences s
     set last_value = coalesce((v_base ->> s.scope)::integer, 0), updated_at = now() where s.year = v_year;
  insert into public.number_sequences (scope, year, last_value)
  select b.key, v_year, (b.value #>> '{}')::integer from jsonb_each(v_base) b
   where not exists (select 1 from public.number_sequences s where s.scope = b.key and s.year = v_year);
  update public.accounting_sequences set last_value = 0, updated_at = now();

  -- in-transaction postcheck: every truncated table is empty, otherwise the whole thing rolls back
  foreach v_name in array v_set loop
    v_n := public._srs_count(v_name);
    if v_name <> 'client_service_report_templates' then
      v_after_total := v_after_total + coalesce(v_n, 0);
    end if;
    v_deleted := v_deleted || jsonb_build_object(v_name, coalesce((v_before ->> v_name)::bigint, 0) - case when v_name = 'client_service_report_templates' then v_tpl_kept else 0 end);
  end loop;
  if v_after_total <> 0 then raise exception 'RESET_POSTCHECK_FAILED' using errcode = '22000'; end if;

  update public.system_reset_runs
     set phase = 'DB_RESET_COMPLETED', counts_before = v_before,
         counts_deleted = v_deleted || jsonb_build_object('_audit_rows', v_audit_deleted, '_storage_items', v_items)
   where id = p_run;
  insert into public.system_reset_run_events (run_id, phase, detail)
  values (p_run, 'DB_RESET_COMPLETED', jsonb_build_object('tables', coalesce(array_length(v_set, 1), 0), 'audit_rows_deleted', v_audit_deleted, 'storage_items', v_items));
  perform public.write_log('system_reset', p_run, 'FACTORY_RESET_DB_COMPLETED', null,
    jsonb_build_object('tables', coalesce(array_length(v_set, 1), 0), 'audit_rows_deleted', v_audit_deleted, 'storage_items', v_items));
  return jsonb_build_object('phase', 'DB_RESET_COMPLETED', 'tables', coalesce(array_length(v_set, 1), 0), 'audit_rows_deleted', v_audit_deleted, 'storage_items', v_items);
end; $$;

-- ---------------------------------------------------------------------
-- 7) storage phase bookkeeping (the paths come ONLY from system_reset_storage_items, i.e. from the server-side classification)
-- ---------------------------------------------------------------------
create or replace function public.system_reset_storage_pending(p_user uuid, p_run uuid, p_limit integer default 100)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_run public.system_reset_runs; v_paths jsonb;
begin
  perform public._srs_require_permission(p_user);
  select * into v_run from public.system_reset_runs where id = p_run for update;
  if not found or v_run.initiated_by is distinct from p_user then raise exception 'RESET_PLAN_INVALID' using errcode = '22000'; end if;
  if v_run.phase not in ('DB_RESET_COMPLETED', 'STORAGE_CLEANUP_STARTED') and not (v_run.status = 'FAILED' and v_run.phase = 'FAILED' and v_run.counts_before is not null) then
    raise exception 'RESET_PLAN_INVALID' using errcode = '22000';
  end if;
  if v_run.phase <> 'STORAGE_CLEANUP_STARTED' then
    update public.system_reset_runs set phase = 'STORAGE_CLEANUP_STARTED', status = 'RUNNING', error = null where id = p_run;
    insert into public.system_reset_run_events (run_id, phase) values (p_run, 'STORAGE_CLEANUP_STARTED');
  end if;
  select coalesce(jsonb_agg(x.path), '[]'::jsonb) into v_paths
    from (select i.path from public.system_reset_storage_items i where i.run_id = p_run and i.status = 'PENDING' order by i.path limit greatest(1, least(coalesce(p_limit, 100), 200))) x;
  return v_paths;
end; $$;

create or replace function public.system_reset_storage_mark(p_user uuid, p_run uuid, p_paths text[], p_error text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._srs_require_permission(p_user);
  if not exists (select 1 from public.system_reset_runs r where r.id = p_run and r.initiated_by = p_user) then raise exception 'RESET_PLAN_INVALID' using errcode = '22000'; end if;
  update public.system_reset_storage_items
     set status = case when p_error is null then 'DONE' else 'FAILED' end, error = left(p_error, 300), processed_at = now()
   where run_id = p_run and path = any (p_paths) and status in ('PENDING', 'FAILED');
end; $$;

create or replace function public.system_reset_storage_summary(p_run uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('total', count(*), 'done', count(*) filter (where status = 'DONE'),
                            'pending', count(*) filter (where status = 'PENDING'), 'failed', count(*) filter (where status = 'FAILED'))
    from public.system_reset_storage_items where run_id = p_run;
$$;

create or replace function public.system_reset_storage_retry(p_user uuid, p_run uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  perform public._srs_require_permission(p_user);
  if not exists (select 1 from public.system_reset_runs r where r.id = p_run and r.initiated_by = p_user) then raise exception 'RESET_PLAN_INVALID' using errcode = '22000'; end if;
  update public.system_reset_storage_items set status = 'PENDING', error = null where run_id = p_run and status = 'FAILED';
  get diagnostics v_n = row_count;
  return v_n;
end; $$;

create or replace function public.system_reset_storage_complete(p_user uuid, p_run uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_sum jsonb;
begin
  perform public._srs_require_permission(p_user);
  if not exists (select 1 from public.system_reset_runs r where r.id = p_run and r.initiated_by = p_user) then raise exception 'RESET_PLAN_INVALID' using errcode = '22000'; end if;
  v_sum := public.system_reset_storage_summary(p_run);
  if (v_sum ->> 'pending')::integer > 0 or (v_sum ->> 'failed')::integer > 0 then raise exception 'RESET_STORAGE_INCOMPLETE' using errcode = '22000'; end if;
  update public.system_reset_runs set phase = 'STORAGE_CLEANUP_COMPLETED', status = 'VERIFYING', storage_cleanup = v_sum where id = p_run;
  insert into public.system_reset_run_events (run_id, phase, detail) values (p_run, 'STORAGE_CLEANUP_COMPLETED', v_sum);
  return v_sum;
end; $$;

create or replace function public.system_reset_storage_scan()
returns jsonb
language sql stable security definer set search_path = public, storage as $$
  select jsonb_build_object(
           'delete_remaining', count(*) filter (where c.action = 'DELETE'),
           'preserved', count(*) filter (where c.action = 'PRESERVE'),
           'unknown', count(*) filter (where c.action = 'UNKNOWN'),
           'unknown_sample', coalesce((select jsonb_agg(u.path) from (select x.path from public._srs_storage_classify() x where x.action = 'UNKNOWN' order by x.path limit 20) u), '[]'::jsonb))
    from public._srs_storage_classify() c;
$$;

-- ---------------------------------------------------------------------
-- 8) verification + finish / fail / release
-- ---------------------------------------------------------------------
create or replace function public.system_reset_verify(p_user uuid, p_run uuid)
returns jsonb
language plpgsql security definer set search_path = public, storage as $$
declare
  v_run public.system_reset_runs; v_plan public.system_reset_plans; v_checks jsonb := '[]'::jsonb; v_set text[]; v_name text; v_n bigint; v_bad text[] := '{}';
  v_year integer; v_base jsonb; v_exp integer; v_debit numeric; v_credit numeric; v_ok boolean; v_before bigint;
begin
  perform public._srs_require_permission(p_user);
  select * into v_run from public.system_reset_runs where id = p_run;
  if not found or v_run.initiated_by is distinct from p_user or v_run.counts_before is null then raise exception 'RESET_PLAN_INVALID' using errcode = '22000'; end if;
  select * into v_plan from public.system_reset_plans where id = v_run.plan_id;
  v_set := public._srs_set('OPERATIONAL');
  v_year := (v_plan.params ->> 'current_year')::integer;
  v_base := coalesce(v_plan.params -> 'baselines', '{}'::jsonb);

  foreach v_name in array v_set loop
    if v_name = 'client_service_report_templates' then
      select count(*) into v_n from public.client_service_report_templates where scope <> 'GLOBAL';
    else
      v_n := public._srs_count(v_name);
    end if;
    if coalesce(v_n, 0) <> 0 then v_bad := v_bad || v_name; end if;
  end loop;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'DELETE_TABLES_EMPTY', 'ok', coalesce(array_length(v_bad, 1), 0) = 0, 'detail', to_jsonb(v_bad)));

  v_bad := '{}';
  for v_name in select m.object_name from public.system_reset_manifest m where m.mode_a = 'PRESERVE' loop
    v_before := coalesce((v_run.counts_before ->> ('preserve:' || v_name))::bigint, -1);
    if public._srs_count(v_name) is distinct from v_before then v_bad := v_bad || v_name; end if;
  end loop;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'PRESERVED_TABLES_UNCHANGED', 'ok', coalesce(array_length(v_bad, 1), 0) = 0, 'detail', to_jsonb(v_bad)));

  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'GLOBAL_TEMPLATES_KEPT',
    'ok', (select count(*) from public.client_service_report_templates where scope = 'GLOBAL') = coalesce((v_run.counts_before ->> '_templates_global')::bigint, -1)));

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_debit, v_credit from public.journal_entry_lines;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'ACCOUNTING_CLEAN',
    'ok', (select count(*) from public.journal_entries) = 0 and v_debit = 0 and v_credit = 0
          and (select count(*) from public.accounting_sequences where last_value <> 0) = 0
          and (select count(*) from public.cash_allocations) = 0 and (select count(*) from public.payroll_payments) = 0
          and (select count(*) from public.cheques) = 0 and (select count(*) from public.receipts) = 0 and (select count(*) from public.payments) = 0));

  select count(*) into v_exp from public.number_sequences s
   where s.last_value <> (case when s.year = v_year then coalesce((v_base ->> s.scope)::integer, 0) else 0 end);
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'SEQUENCES_AT_BASELINE', 'ok', v_exp = 0
    and not exists (select 1 from jsonb_each(v_base) b where not exists (select 1 from public.number_sequences s where s.scope = b.key and s.year = v_year))));

  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'NO_ORPHAN_ATTACHMENTS',
    'ok', (select count(*) from public.attachments) = 0 and (select count(*) from public.documents) = 0));

  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'FK_CONSTRAINTS_VALID',
    'ok', (select count(*) from pg_constraint where contype = 'f' and not convalidated) <= coalesce((v_run.counts_before ->> '_fk_not_validated')::bigint, 0)));

  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'POLICIES_UNCHANGED',
    'ok', (select count(*) from pg_policies where schemaname in ('public', 'storage')) = coalesce((v_run.counts_before ->> '_policies')::bigint, -1)));

  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'ADMIN_ACCESS_PRESERVED',
    'ok', (select count(*) from public.profiles where is_active and role = 'ADMIN') >= 1
          and public.system_reset_has_permission(v_run.initiated_by)
          and (select count(*) from public.profiles where is_active and role = 'ADMIN') = coalesce((v_run.counts_before ->> '_admins')::bigint, -1)));

  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'CONFIGURATION_PRESERVED',
    'ok', exists (select 1 from public.app_settings where id = 1) and (select count(*) from public.accounts) > 0 and (select count(*) from public.fiscal_years) > 0
          and (select count(*) from public.system_reset_manifest) > 0));

  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'RESET_HISTORY_PRESENT',
    'ok', exists (select 1 from public.system_reset_runs where id = p_run) and exists (select 1 from public.activity_logs where entity_type = 'system_reset' and entity_id = p_run)));

  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'STORAGE_CLEANUP_COMPLETE',
    'ok', coalesce((public.system_reset_storage_summary(p_run) ->> 'pending')::integer, 1) = 0 and coalesce((public.system_reset_storage_summary(p_run) ->> 'failed')::integer, 1) = 0));

  select bool_and((c ->> 'ok')::boolean) into v_ok from jsonb_array_elements(v_checks) c;
  return jsonb_build_object('ok', coalesce(v_ok, false), 'checks', v_checks);
end; $$;

create or replace function public.system_reset_finish(p_user uuid, p_run uuid, p_integrity jsonb, p_report jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare v_ok boolean := coalesce((p_integrity ->> 'ok')::boolean, false);
begin
  perform public._srs_require_permission(p_user);
  if not exists (select 1 from public.system_reset_runs r where r.id = p_run and r.initiated_by = p_user) then raise exception 'RESET_PLAN_INVALID' using errcode = '22000'; end if;
  update public.system_reset_runs
     set status = case when v_ok then 'COMPLETED' else 'FAILED' end, phase = case when v_ok then 'COMPLETED' else 'FAILED' end,
         completed_at = now(), integrity_result = p_integrity, report = p_report,
         error = case when v_ok then null else 'INTEGRITY_CHECK_FAILED' end
   where id = p_run;
  insert into public.system_reset_run_events (run_id, phase, ok, detail)
  values (p_run, case when v_ok then 'COMPLETED' else 'FAILED' end, v_ok, jsonb_build_object('integrity_ok', v_ok));
  update public.system_maintenance set locked = false, reset_id = null, locked_by = null, locked_at = null, reason = null where id = 1 and reset_id = p_run;
  perform public.write_log('system_reset', p_run, case when v_ok then 'FACTORY_RESET_COMPLETED' else 'FACTORY_RESET_FAILED' end, null,
    jsonb_build_object('integrity_ok', v_ok, 'user_id', p_user));
end; $$;

-- an unexpected failure: records WHERE it stopped; the lock is released only when it is safe (DB phase never committed, or the DB part is complete)
create or replace function public.system_reset_fail(p_user uuid, p_run uuid, p_phase text, p_error text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_run public.system_reset_runs;
begin
  perform public._srs_require_permission(p_user);
  select * into v_run from public.system_reset_runs where id = p_run for update;
  if not found or v_run.initiated_by is distinct from p_user then raise exception 'RESET_PLAN_INVALID' using errcode = '22000'; end if;
  if v_run.status in ('COMPLETED', 'CANCELLED') then return; end if;
  update public.system_reset_runs set status = 'FAILED', error = left(coalesce(p_error, 'UNKNOWN'), 300),
         phase = case when phase = 'PREPARED' or phase = 'DB_RESET_STARTED' then 'FAILED' else phase end,
         completed_at = now()
   where id = p_run;
  insert into public.system_reset_run_events (run_id, phase, ok, detail) values (p_run, coalesce(p_phase, 'FAILED'), false, jsonb_build_object('error', left(coalesce(p_error, 'UNKNOWN'), 300)));
  update public.system_maintenance set locked = false, reset_id = null, locked_by = null, locked_at = null, reason = null where id = 1 and reset_id = p_run;
  perform public.write_log('system_reset', p_run, 'FACTORY_RESET_FAILED', null, jsonb_build_object('phase', coalesce(p_phase, 'FAILED'), 'user_id', p_user));
end; $$;

-- bool only; callable without a session so the middleware can answer 503 while a reset is running
create or replace function public.system_maintenance_status()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('locked', coalesce((select m.locked from public.system_maintenance m where m.id = 1), false));
$$;

-- ---------------------------------------------------------------------
-- 9) grants: service_role ONLY for every destructive / administrative function
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    '_srs_set(text)', '_srs_count(text)', 'system_reset_manifest_hash()', 'system_reset_schema_hash()', 'system_reset_unknown_tables()',
    'system_reset_missing_objects()', 'system_reset_fk_blockers(text)', '_srs_audit_types(text)', '_srs_storage_classify()',
    '_srs_env_guard(text,boolean)', 'system_reset_has_permission(uuid)', '_srs_require_permission(uuid)', '_srs_params(jsonb)',
    'system_reset_preview(text,jsonb)', 'system_reset_dry_run(uuid,text,jsonb,text,boolean)', 'system_reset_cancel_plan(uuid,uuid)',
    'system_reset_arm(uuid,uuid,text,boolean,text,timestamptz,text,text,boolean)', 'system_reset_begin(uuid,uuid,text,text,boolean)',
    'system_reset_execute_db(uuid,uuid,text,boolean)', 'system_reset_storage_pending(uuid,uuid,integer)',
    'system_reset_storage_mark(uuid,uuid,text[],text)', 'system_reset_storage_summary(uuid)', 'system_reset_storage_retry(uuid,uuid)',
    'system_reset_storage_complete(uuid,uuid)', 'system_reset_storage_scan()', 'system_reset_verify(uuid,uuid)',
    'system_reset_finish(uuid,uuid,jsonb,jsonb)', 'system_reset_fail(uuid,uuid,text,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

revoke all on function public.system_maintenance_status() from public;
grant execute on function public.system_maintenance_status() to anon, authenticated, service_role;

-- =====================================================================
-- ROLLBACK: drop the functions above (system_reset_* and _srs_*, system_maintenance_status), then
--   drop table system_reset_storage_items, system_reset_run_events, system_reset_runs, system_reset_plans, system_reset_storage_rules,
--   system_reset_manifest, system_maintenance, system_reset_grants (this loses reset history).
-- =====================================================================

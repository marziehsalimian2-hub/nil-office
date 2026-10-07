# Reset manifest — what Factory Reset deletes, preserves and never touches

Source of truth: the table `system_reset_manifest` (seeded by `supabase/migrations/0141_factory_reset.sql`, version 1) — generated from the
ACTUAL schema (migrations 0001–0143: 105 + 4 NIL Verify tables, plus the reset subsystem's own 8). A vitest guard (`lib/system-reset/manifest.test.ts`)
fails the build if any migration creates a table that is not classified here, and the database refuses to execute while an unclassified
table exists (it is reported as **UNKNOWN** in the Dry Run).

## Meaning of the classes
| Class | Meaning in this system |
|---|---|
| **DELETE** | Business / operational / test data. Emptied by Operational Clean Start (one `TRUNCATE`, no CASCADE). |
| **PRESERVE** | Users, configuration, definitions, chart of accounts, templates, lookups. Row counts are recorded before and compared after. |
| **CONDITIONAL** | Partly deleted / value-reset: audit log (business rows only), numbering counters (value reset, rows kept), report templates (GLOBAL kept). |
| **NEVER TOUCH** | The reset subsystem itself (manifest, plans, history, events, lock, grants), Auth, storage configuration, migrations. |
| **UNKNOWN** | A table that exists in the catalog but not in the manifest. Computed at runtime; **blocks execution** until classified. |

Mode A = Operational Clean Start (executable). Mode B = Full Factory Reset (Dry Run only in v1; its column below shows the planned scope).
`TRUNCATE_KEEP` = truncated together with its FK partner and the kept rows restored; `RESET_VALUE` = rows kept, value reset; `FILTERED_DELETE` = row-level delete by rule.


## DELETE (class A) — 78 objects

| Object | Module | Mode A | Mode B | Reason | Reset order | Sequence impact | Storage impact | Risk |
|---|---|---|---|---|---|---|---|---|
| `cases` | correspondence | DELETE | DELETE | Case files group letters/documents | 10 | CASE | - | LOW |
| `correspondence` | correspondence | DELETE | DELETE | Letters (incoming/outgoing) are operational documents | 10 | OUTGOING, INCOMING | correspondence/ PDFs and scans | MEDIUM |
| `correspondence_links` | correspondence | DELETE | DELETE | Links between letters | 10 | - | - | LOW |
| `documents` | correspondence | DELETE | DELETE | Archive documents | 10 | - | document/ files | LOW |
| `followups` | correspondence | DELETE | DELETE | Follow-up reminders | 10 | - | - | LOW |
| `attachments` | documents | DELETE | DELETE | Polymorphic file registry; every row belongs to a deleted parent | 12 | - | all registered business files | MEDIUM |
| `companies` | crm | DELETE | DELETE | Customers / counterparties entered during UAT (user decision: delete) | 20 | - | company/ files | MEDIUM |
| `company_contacts` | crm | DELETE | DELETE | Contacts of companies | 20 | - | - | LOW |
| `crm_company_roles` | crm | DELETE | DELETE | Role assignments of companies | 20 | - | - | LOW |
| `crm_activities` | crm | DELETE | DELETE | CRM activities | 21 | - | - | LOW |
| `crm_opportunities` | crm | DELETE | DELETE | Opportunities | 21 | OPPORTUNITY | opportunity/ files | MEDIUM |
| `crm_opportunity_parties` | crm | DELETE | DELETE | Buyer/seller/broker links of opportunities | 21 | - | - | LOW |
| `crm_opportunity_stage_history` | crm | DELETE | DELETE | Stage history of opportunities | 21 | - | - | LOW |
| `crm_opportunity_trade_details` | crm | DELETE | DELETE | Trade details of opportunities | 21 | - | - | LOW |
| `crm_quotations` | crm | DELETE | DELETE | Quotations | 21 | - | - | LOW |
| `contracts` | contracts | DELETE | DELETE | Contracts (milestones/obligations live inside this module's rows) | 30 | CONTRACT | contract/ files | MEDIUM |
| `sales_document_items` | sales | DELETE | DELETE | Lines of proformas/invoices | 40 | - | - | LOW |
| `sales_documents` | sales | DELETE | DELETE | Proformas and invoices | 40 | PROFORMA, INVOICE | sales_document/ files | HIGH |
| `project_deliverables` | projects | DELETE | DELETE | Deliverables | 50 | - | - | LOW |
| `project_members` | projects | DELETE | DELETE | Project membership | 50 | - | - | LOW |
| `project_milestones` | projects | DELETE | DELETE | Milestones | 50 | - | - | LOW |
| `project_phases` | projects | DELETE | DELETE | Phases | 50 | - | - | LOW |
| `projects` | projects | DELETE | DELETE | Projects | 50 | PROJECT | project/ files | MEDIUM |
| `task_checklist_items` | projects | DELETE | DELETE | Task checklists | 51 | - | - | LOW |
| `task_comments` | projects | DELETE | DELETE | Task comments | 51 | - | - | LOW |
| `task_dependencies` | projects | DELETE | DELETE | Task dependencies | 51 | - | - | LOW |
| `tasks` | projects | DELETE | DELETE | Tasks and subtasks | 51 | - | task/ files | LOW |
| `client_service_files` | client_service | DELETE | DELETE | Client service files | 60 | - | service_entry/ service_expense/ files | MEDIUM |
| `expenses` | client_service | DELETE | DELETE | Expenses | 60 | - | - | LOW |
| `service_arrangements` | client_service | DELETE | DELETE | Service arrangements | 60 | - | - | LOW |
| `service_entries` | client_service | DELETE | DELETE | Service entries | 60 | - | - | MEDIUM |
| `time_entries` | client_service | DELETE | DELETE | Time entries (worklogs) | 60 | - | - | LOW |
| `time_entry_internal_costs` | client_service | DELETE | DELETE | Internal cost snapshots of time entries | 60 | - | - | LOW |
| `billing_batch_items` | client_service | DELETE | DELETE | Billing batch lines | 61 | - | - | LOW |
| `billing_batches` | client_service | DELETE | DELETE | Billing batches | 61 | - | - | MEDIUM |
| `client_service_reports` | client_service | DELETE | DELETE | Generated client service reports | 61 | - | client-service-reports/ PDFs | MEDIUM |
| `cash_allocations` | finance | DELETE | DELETE | Receipt/payment allocations | 70 | - | - | MEDIUM |
| `payments` | finance | DELETE | DELETE | Financial payments | 70 | PAYMENT | payment/ cash-evidence/ files | HIGH |
| `receipts` | finance | DELETE | DELETE | Financial receipts | 70 | RECEIPT | receipt/ cash-evidence/ files | HIGH |
| `detail_accounts` | accounting | DELETE | DELETE | Sub-ledger (detail) accounts auto-created for companies/personnel | 71 | - | - | MEDIUM |
| `journal_entries` | accounting | DELETE | DELETE | Journal entries (test postings and reversals) | 71 | accounting_sequences | journal/ files | HIGH |
| `journal_entry_lines` | accounting | DELETE | DELETE | Journal lines | 71 | - | - | HIGH |
| `cheque_books` | cheques | DELETE | DELETE | Cheque books | 72 | CHEQUE | - | MEDIUM |
| `cheques` | cheques | DELETE | DELETE | Cheques (test cheques and print history) | 72 | CHEQUE | cheque/ files | MEDIUM |
| `employment_records` | hr | DELETE | DELETE | Employment history | 80 | - | - | MEDIUM |
| `personnel` | hr | DELETE | DELETE | Personnel records (distinct from profiles; user accounts survive) | 80 | PERSONNEL | personnel/ files | HIGH |
| `personnel_payment_destinations` | payroll | DELETE | DELETE | Bank destinations of personnel | 80 | - | - | HIGH |
| `personnel_sensitive_details` | hr | DELETE | DELETE | Sensitive PII of personnel | 80 | - | - | HIGH |
| `compensation_lines` | payroll | DELETE | DELETE | Compensation lines | 81 | - | - | HIGH |
| `compensation_profiles` | payroll | DELETE | DELETE | Compensation profiles | 81 | - | - | HIGH |
| `payroll_batches` | payroll | DELETE | DELETE | Payroll batches | 82 | PAYROLL_BATCH | - | HIGH |
| `payroll_calc_warnings` | payroll | DELETE | DELETE | Calculation warnings | 82 | - | - | LOW |
| `payroll_calculations` | payroll | DELETE | DELETE | Payroll calculations | 82 | - | - | HIGH |
| `payroll_eligibility_overrides` | payroll | DELETE | DELETE | Eligibility overrides | 82 | - | - | LOW |
| `payroll_payments` | payroll | DELETE | DELETE | Payroll payment links | 82 | - | - | HIGH |
| `payroll_payslips` | payroll | DELETE | DELETE | Payslip archive | 82 | - | payslips/ PDFs | HIGH |
| `payroll_periods` | payroll | DELETE | DELETE | Payroll periods | 82 | - | - | MEDIUM |
| `payroll_result_lines` | payroll | DELETE | DELETE | Payroll result lines | 82 | - | - | HIGH |
| `payroll_results` | payroll | DELETE | DELETE | Payroll results | 82 | - | - | HIGH |
| `payroll_work_data` | payroll | DELETE | DELETE | Monthly work data | 82 | - | - | MEDIUM |
| `payroll_work_inputs` | payroll | DELETE | DELETE | Manual payroll inputs | 82 | - | - | MEDIUM |
| `trade_offer_buyers` | trade | DELETE | DELETE | Buyer assignments (portal tokens die with them) | 90 | - | - | MEDIUM |
| `trade_offer_deadline_history` | trade | DELETE | DELETE | Deadline history | 90 | - | - | LOW |
| `trade_offer_documents` | trade | DELETE | DELETE | Uploaded LOI/ICPO documents | 90 | - | trade/offers/ uploads | MEDIUM |
| `trade_offer_events` | trade | DELETE | DELETE | Offer events | 90 | - | - | LOW |
| `trade_offer_responses` | trade | DELETE | DELETE | Buyer responses | 90 | - | - | LOW |
| `trade_offers` | trade | DELETE | DELETE | Trade portal offers | 90 | OFFER | trade/offers/ uploads | MEDIUM |
| `assistant_channel_updates` | assistant | DELETE | DELETE | Telegram update idempotency records | 100 | - | - | LOW |
| `assistant_conversations` | assistant | DELETE | DELETE | Conversation sessions | 100 | - | - | LOW |
| `assistant_messages` | assistant | DELETE | DELETE | Conversation messages | 100 | - | - | LOW |
| `assistant_pending_actions` | assistant | DELETE | DELETE | Pending / confirmed actions | 100 | - | - | MEDIUM |
| `assistant_usage` | assistant | DELETE | DELETE | Daily usage counters | 100 | - | - | LOW |
| `external_bot_conversation_state` | external_bot | DELETE | DELETE | Conversation state | 110 | - | - | LOW |
| `external_bot_rate_limits` | external_bot | DELETE | DELETE | Rate limit state | 110 | - | - | LOW |
| `external_bot_updates` | external_bot | DELETE | DELETE | Update idempotency records | 110 | - | - | LOW |
| `external_intake_documents` | external_bot | DELETE | DELETE | Intake documents | 110 | - | - | MEDIUM |
| `external_intake_events` | external_bot | DELETE | DELETE | Intake events | 110 | - | - | LOW |
| `external_intakes` | external_bot | DELETE | DELETE | External correspondence intakes | 110 | - | external-correspondence/ files | MEDIUM |
| `document_verifications` | verify | DELETE | DELETE | Verification records of issued documents (operational; their documents are deleted by the reset) | 15 | - | verified/ final PDFs | MEDIUM |
| `verification_rate_limits` | verify | DELETE | DELETE | Transient public-verify rate-limit counters | 15 | - | - | LOW |

## PRESERVE (class B) — 23 objects

| Object | Module | Mode A | Mode B | Reason | Reset order | Sequence impact | Storage impact | Risk |
|---|---|---|---|---|---|---|---|---|
| `accounts` | accounting | PRESERVE | PRESERVE | Chart of accounts (structure must survive) | 200 | - | - | HIGH |
| `app_settings` | system | PRESERVE | PRESERVE | Application, organization, branding and accounting-default configuration | 200 | - | - | HIGH |
| `assistant_channel_identities` | assistant | PRESERVE | DELETE | Telegram identity links of users (configuration; users survive) | 200 | - | - | MEDIUM |
| `bank_accounts` | accounting | PRESERVE | PRESERVE | Company bank/cash accounts (organization setup, GL-linked) | 200 | - | - | MEDIUM |
| `cheque_print_template_fields` | cheques | PRESERVE | PRESERVE | Field layout of print templates | 200 | - | - | LOW |
| `cheque_print_templates` | cheques | PRESERVE | PRESERVE | Cheque print templates (system/organization configuration) | 200 | - | - | LOW |
| `cheque_status_transitions` | cheques | PRESERVE | PRESERVE | Seeded status state machine (lookup, not data) | 200 | - | - | LOW |
| `contract_types` | contracts | PRESERVE | PRESERVE | Contract type definitions (seeded + configured) | 200 | - | - | LOW |
| `crm_pipeline_stages` | crm | PRESERVE | PRESERVE | Stages of the pipeline definitions | 200 | - | - | LOW |
| `crm_pipelines` | crm | PRESERVE | PRESERVE | System pipeline definitions (seeded defaults, configurable) | 200 | - | - | LOW |
| `fiscal_years` | accounting | PRESERVE | PRESERVE | Fiscal configuration | 200 | - | - | HIGH |
| `internal_cost_rates` | client_service | PRESERVE | DELETE | Per-user internal cost configuration (profiles survive in Mode A) | 200 | - | - | MEDIUM |
| `legal_rule_entries` | payroll | PRESERVE | DELETE | Rule entries of rule sets | 200 | - | - | MEDIUM |
| `legal_rule_set_transitions` | payroll | PRESERVE | PRESERVE | Seeded status state machine (lookup, not data) | 200 | - | - | LOW |
| `legal_rule_sets` | payroll | PRESERVE | DELETE | Approved rule-set architecture | 200 | - | - | MEDIUM |
| `payroll_accounting_settings` | payroll | PRESERVE | RESET_VALUE | Payroll account mapping (accounting configuration) | 200 | - | - | MEDIUM |
| `payroll_batch_transitions` | payroll | PRESERVE | PRESERVE | Seeded status state machine (lookup, not data) | 200 | - | - | LOW |
| `payroll_component_accounts` | payroll | PRESERVE | DELETE | Component to account mapping | 200 | - | - | MEDIUM |
| `personnel_status_transitions` | hr | PRESERVE | PRESERVE | Seeded status state machine (lookup, not data) | 200 | - | - | LOW |
| `profiles` | auth | PRESERVE | ADMINS_ONLY | Application profiles = users, roles and signature paths. Required for administrative access | 200 | - | - | HIGH |
| `salary_component_versions` | payroll | PRESERVE | DELETE | Versions of salary component definitions | 200 | - | - | MEDIUM |
| `salary_components` | payroll | PRESERVE | DELETE | Salary component definitions (company configuration, nothing legal seeded) | 200 | - | - | MEDIUM |
| `service_categories` | client_service | PRESERVE | PRESERVE | Service category definitions (seeded + configured) | 200 | - | - | LOW |
| `verification_settings` | verify | PRESERVE | PRESERVE | NIL Verify configuration (enabled, issuer name, public label, contract-amount policy) | 200 | - | - | LOW |
| `verification_doc_types` | verify | PRESERVE | PRESERVE | NIL Verify per-document-type enablement and QR layout | 200 | - | - | LOW |

## CONDITIONAL (class C) — 4 objects

| Object | Module | Mode A | Mode B | Reason | Reset order | Sequence impact | Storage impact | Risk |
|---|---|---|---|---|---|---|---|---|
| `client_service_report_templates` | client_service | TRUNCATE_KEEP | TRUNCATE_KEEP | GLOBAL templates are configuration and are kept; CLIENT-scope templates belong to deleted companies. Truncated together with companies (FK) and the GLOBAL rows restored | 62 | - | - | MEDIUM |
| `accounting_sequences` | accounting | RESET_VALUE | RESET_VALUE | Journal numbering counters per fiscal year: last_value reset to 0, rows kept | 75 | journal numbers | - | MEDIUM |
| `number_sequences` | numbering | RESET_VALUE | RESET_VALUE | Operational counters: current year reset to the configured baselines, other years to 0; rows and CHECK scopes kept | 76 | all scopes | - | HIGH |
| `activity_logs` | audit | FILTERED_DELETE | FILTERED_DELETE | Audit trail: only rows of reset business entity types are purged; security/system/config rows and the reset's own events stay | 77 | - | - | MEDIUM |

## NEVER TOUCH (class D) — 8 objects

| Object | Module | Mode A | Mode B | Reason | Reset order | Sequence impact | Storage impact | Risk |
|---|---|---|---|---|---|---|---|---|
| `system_maintenance` | system_reset | NEVER | NEVER | Maintenance lock | 900 | - | - | HIGH |
| `system_reset_grants` | system_reset | NEVER | NEVER | SYSTEM_FACTORY_RESET permission grants | 900 | - | - | HIGH |
| `system_reset_manifest` | system_reset | NEVER | NEVER | The manifest itself | 900 | - | - | HIGH |
| `system_reset_plans` | system_reset | NEVER | NEVER | Dry-run plans (history) | 900 | - | - | HIGH |
| `system_reset_run_events` | system_reset | NEVER | NEVER | Reset phase events - must survive every reset | 900 | - | - | HIGH |
| `system_reset_runs` | system_reset | NEVER | NEVER | Reset history - must survive every reset | 900 | - | - | HIGH |
| `system_reset_storage_items` | system_reset | NEVER | NEVER | Per-run storage cleanup items | 900 | - | - | HIGH |
| `system_reset_storage_rules` | system_reset | NEVER | NEVER | Storage classification rules | 900 | - | - | HIGH |

## E — UNKNOWN / needs review
None in the current schema (verified statically against migrations 0001–0140 and checked again at runtime by `system_reset_unknown_tables()`).
Any future table must be added to the manifest in the same migration that creates it.

## Foreign keys (why the delete set is one TRUNCATE)
`TRUNCATE` is refused by PostgreSQL unless every table that references a truncated table is truncated in the same statement. The reset therefore
computes the FK graph from `pg_constraint` (`system_reset_fk_blockers`) and refuses to run if a PRESERVE table references a DELETE table.
Static analysis of all migrations found exactly one such edge: `client_service_report_templates.company_id → companies` — handled by
**TRUNCATE_KEEP** (the GLOBAL templates are snapshotted into a temp table and re-inserted; CLIENT-scope templates disappear with their companies).
No `CASCADE`, no `session_replication_role`, no trigger disabling.

## Audit log (`activity_logs`)
Deleted: rows whose `entity_type` is a Mode-A DELETE table name or one of the audit aliases `receipt`, `payment`, `journal_entry`.
Kept: everything else — security events (`assistant`), configuration events (`number_sequences`, `fiscal_year`, `profiles`, …), report-export audit,
unclassified types (reported in the Dry Run), and the reset's own events (`system_reset`, never deleted).

## Numbering
`number_sequences`: for the **current Jalali year** every scope is set to the configured baseline (default: OUTGOING 69, INCOMING 18, every other scope 0 — the
number is the LAST USED one, the next issued number is baseline + 1); rows of other years are set to 0; missing rows for a baseline are created.
`accounting_sequences` (journal numbers per fiscal year) → 0. The 14 scopes are the CHECK list of migration 0118.

## Storage (`nil-files`)
Rules (`system_reset_storage_rules`, longest prefix wins):

| Prefix | Action |
|---|---|
| `correspondence/` | DELETE |
| `document/` | DELETE |
| `case/` | DELETE |
| `journal/` | DELETE |
| `receipt/` | DELETE |
| `payment/` | DELETE |
| `cash-evidence/` | DELETE |
| `contract/` | DELETE |
| `sales_document/` | DELETE |
| `company/` | DELETE |
| `opportunity/` | DELETE |
| `project/` | DELETE |
| `task/` | DELETE |
| `cheque/` | DELETE |
| `service_entry/` | DELETE |
| `service_expense/` | DELETE |
| `personnel/` | DELETE |
| `payslips/` | DELETE |
| `client-service-reports/` | DELETE |
| `trade/` | DELETE |
| `external-correspondence/` | DELETE |
| `verified/` | DELETE |
| `settings/` | PRESERVE |
| `signatures/` | PRESERVE |

Also **DELETE**: any object whose path is registered by a reset table (`attachments`, `document_verifications`, `trade_offer_documents`, `client_service_reports`, `external_intake_documents`, `payroll_payslips`).
Always **PRESERVE**: the current `app_settings.letterhead_path`, `app_settings.stamp_path` and every `profiles.signature_path`, whatever their prefix.
**UNKNOWN** (any other object): reported, never deleted.

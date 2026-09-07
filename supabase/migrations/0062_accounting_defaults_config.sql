-- =====================================================================
-- NIL Office — 0062_accounting_defaults_config.sql
-- Invoice Phase 3 — configurable default GL accounts for auto-created
-- accounting drafts (never hardcode account codes, which would
-- silently break if the chart of accounts is ever restructured).
--
-- sales_documents.accounting_journal_entry_id is a sentinel marking
-- "a draft already exists for this invoice" — prevents duplicates and
-- lets the UI link straight to it instead of re-offering the button.
-- =====================================================================

alter table public.app_settings add column if not exists default_ar_account_id             uuid references public.accounts(id);
alter table public.app_settings add column if not exists default_sales_revenue_account_id  uuid references public.accounts(id);

alter table public.sales_documents add column if not exists accounting_journal_entry_id uuid references public.journal_entries(id) on delete set null;

create index if not exists idx_sales_documents_journal_entry on public.sales_documents (accounting_journal_entry_id);

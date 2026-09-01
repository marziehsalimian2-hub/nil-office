-- =====================================================================
-- NIL Office — 0027_contract_financial_links.sql
-- Contract Management module — Phase 3 (financial integration), part 1.
-- Adds a nullable contract_id link to the accounting entities that can
-- record real money movement against a contract, mirroring the
-- existing company_id/case_id columns on the same tables exactly
-- (0007_accounting_tables.sql:98-99,111-112,141-142,166-167).
-- No RLS/function changes here — see 0028 for the read-side bridge.
-- =====================================================================

alter table public.receipts            add column if not exists contract_id uuid references public.contracts(id) on delete set null;
alter table public.payments            add column if not exists contract_id uuid references public.contracts(id) on delete set null;
alter table public.journal_entry_lines add column if not exists contract_id uuid references public.contracts(id) on delete set null;

create index if not exists idx_receipts_contract on public.receipts (contract_id);
create index if not exists idx_payments_contract on public.payments (contract_id);
create index if not exists idx_jel_contract       on public.journal_entry_lines (contract_id);

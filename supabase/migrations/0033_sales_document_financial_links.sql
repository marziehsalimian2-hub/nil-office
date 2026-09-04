-- =====================================================================
-- NIL Office — 0033_sales_document_financial_links.sql
-- Lets a receipt/payment/journal line reference the sales_document
-- (invoice) it settles — mirrors 0027_contract_financial_links.sql
-- exactly, same nullable-FK-with-index pattern already used for
-- company_id/case_id/contract_id on these same three tables.
-- =====================================================================

alter table public.receipts            add column if not exists sales_document_id uuid references public.sales_documents(id) on delete set null;
alter table public.payments            add column if not exists sales_document_id uuid references public.sales_documents(id) on delete set null;
alter table public.journal_entry_lines add column if not exists sales_document_id uuid references public.sales_documents(id) on delete set null;

create index if not exists idx_receipts_sales_document on public.receipts (sales_document_id);
create index if not exists idx_payments_sales_document on public.payments (sales_document_id);
create index if not exists idx_jel_sales_document       on public.journal_entry_lines (sales_document_id);

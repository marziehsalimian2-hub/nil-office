-- =====================================================================
-- NIL Office — 0065_sales_document_language.sql
-- Invoice/Proforma — let a document be issued in Persian or English.
-- Mirrors correspondence.language's shape (0002_tables.sql), just
-- actually used this time: invoices are structured (fixed labels, a
-- totals table, a signoff block) so the PDF template branches on it,
-- unlike letters where the body is free-typed prose either way.
-- =====================================================================

alter table public.sales_documents add column if not exists language text not null default 'FA' check (language in ('FA','EN'));

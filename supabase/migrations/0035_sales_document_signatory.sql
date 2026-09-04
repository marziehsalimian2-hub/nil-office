-- =====================================================================
-- NIL Office — 0035_sales_document_signatory.sql
-- Lets a sales document (proforma/invoice) carry an explicit signatory
-- (for the PDF's signature block — name AND job title are read from
-- that profile), instead of always defaulting to whoever issued/
-- created it. Existing RLS policies and table grants on sales_documents
-- already cover this new column — no further migration needed for
-- access control.
-- =====================================================================

alter table public.sales_documents add column if not exists signatory_id uuid references public.profiles(id) on delete set null;

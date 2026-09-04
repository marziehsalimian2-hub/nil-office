-- =====================================================================
-- NIL Office — 0029_sales_document_attach_entity.sql
-- Adds the SALES_DOCUMENT value to attach_entity so the existing
-- attachment architecture (nil-files bucket, RLS, upload validation)
-- can be reused as-is for the Invoice/Proforma module (Phase 1). One
-- shared value for both PROFORMA and INVOICE rows — they live in the
-- same table/id-space, mirroring how 'CONTRACT' is one value regardless
-- of a contract's `kind`.
--
-- Isolated in its own migration on purpose: Postgres does not allow a
-- newly added enum value to be used by code in the SAME transaction it
-- was added in (bit 0007_accounting_tables.sql and 0020_contract_attach_
-- entity.sql before this). Nothing in this file references
-- 'SALES_DOCUMENT' — later migrations do.
-- =====================================================================

alter type public.attach_entity add value if not exists 'SALES_DOCUMENT';

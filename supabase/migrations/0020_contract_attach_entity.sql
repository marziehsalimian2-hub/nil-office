-- =====================================================================
-- NIL Office — 0020_contract_attach_entity.sql
-- Adds the CONTRACT value to attach_entity so the existing attachment
-- architecture (nil-files bucket, RLS, upload validation) can be reused
-- as-is for the Contract Management module (Phase 1).
--
-- This lives in its own migration/transaction on purpose: Postgres does
-- not allow a newly added enum value to be used by code in the SAME
-- transaction it was added in (0007_accounting_tables.sql hit the same
-- constraint when it added JOURNAL/RECEIPT/PAYMENT). Nothing in this
-- file references 'CONTRACT' — later migrations do.
-- =====================================================================

alter type public.attach_entity add value if not exists 'CONTRACT';

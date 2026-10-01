-- =====================================================================
-- NIL Office — 0109_personnel_attach_entity.sql
-- Reuse the existing generic attachments mechanism for HR documents
-- (employment contracts, ID documents, certificates, insurance/tax
-- documents) — no new storage bucket or table. Standalone file:
-- ALTER TYPE ... ADD VALUE cannot run in the same transaction as code
-- using the new value (same reason every prior entity-type addition
-- got its own migration file).
-- =====================================================================

alter type public.attach_entity add value if not exists 'PERSONNEL';

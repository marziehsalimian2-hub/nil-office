-- =====================================================================
-- NIL Office — 0083_service_ledger_attach_entity.sql
-- Reuse the existing generic attachments mechanism for the Client
-- Service Ledger (expense receipts, service evidence) — no new storage
-- bucket or table. Standalone file: ALTER TYPE ... ADD VALUE cannot run
-- in the same transaction as code using the new value, same reason
-- 0020/0029/0036/0049/0079 are each their own migration.
-- =====================================================================

alter type public.attach_entity add value if not exists 'SERVICE_ENTRY';
alter type public.attach_entity add value if not exists 'SERVICE_EXPENSE';

-- =====================================================================
-- NIL Office — 0079_cheque_attach_entity.sql
-- Reuse the existing generic attachments mechanism for cheques (cheque
-- image, delivery receipt, bank document, clearance receipt) — no new
-- storage bucket or table. Standalone file: ALTER TYPE ... ADD VALUE
-- cannot run in the same transaction as code using the new value, same
-- reason 0020/0029/0036/0049 are each their own migration.
-- =====================================================================

alter type public.attach_entity add value if not exists 'CHEQUE';

-- =====================================================================
-- NIL Office — 0144_board_attach_entity.sql
-- Board Secretariat (دبیرخانه هیئت‌مدیره) — Phase 1.
-- The verified (frozen, QR-stamped) minutes PDF is registered in the generic attachments table like every other verified document
-- (lib/verify/issue.ts). Standalone file: ALTER TYPE ... ADD VALUE cannot run in the same transaction as code using the new value
-- (same reason every prior entity-type addition got its own migration file, e.g. 0109).
-- =====================================================================

alter type public.attach_entity add value if not exists 'BOARD_MEETING';

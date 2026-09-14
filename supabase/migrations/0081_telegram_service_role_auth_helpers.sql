-- =====================================================================
-- NIL Office — 0081_telegram_service_role_auth_helpers.sql
-- Root cause of a live "شما مجاز به انجام این عملیات نیستید." error when
-- confirming CREATE_LETTER_DRAFT over Telegram: lib/assistant/telegram/
-- session.ts (5b2ab46, this session) made every Telegram-originated
-- query run as service_role — a decision already known to bypass RLS
-- (documented there, and separately patched for base object grants in
-- 0072_service_role_base_grants.sql). What wasn't accounted for: several
-- RPCs (finalize_correspondence, finalize_sales_document, ...) ALSO run
-- their OWN internal auth.uid()-based authorization check (is_active_
-- user()/can_approve_invoice()/etc.), independent of RLS. auth.uid()
-- resolves to NULL for service_role (no "sub" claim on that key's JWT),
-- so these checks fail outright rather than being bypassed — a THIRD
-- distinct mechanism from RLS and base object grants, and the third
-- "0013-style gotcha" this Telegram integration has hit.
--
-- Fix: widen the two helper functions Phase 1 actually needs so a
-- service_role caller passes, exactly matching the trust level RLS
-- already grants it project-wide (service_role bypassing an
-- authorization check it already bypasses at the RLS layer is not a new
-- capability — it is removing a check that was accidentally more
-- restrictive than RLS itself for this one role). Telegram's own
-- ActionDefinition.requiredAccess closures (checked in orchestrator.ts
-- before any RPC is ever called) remain the real permission gate for
-- Telegram requests, per session.ts's own documented design.
--
-- NOT widened here (deliberately out of scope — Phase 1 doesn't call
-- them via Telegram yet, so they're still untested in this configuration):
-- is_admin(), can_create_cheque()/can_approve_cheque()/is_cheque_admin(),
-- can_create_trade()/can_approve_trade()/is_trade_admin(), and the
-- contract/project/crm equivalents. Any future phase that confirms a
-- HIGH-risk action reaching one of THOSE functions via Telegram will
-- need the identical one-line widening, not a new mechanism.
-- =====================================================================

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role' or exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
  );
$$;

create or replace function public.can_approve_invoice()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role' or exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or invoice_role in ('APPROVE','ADMIN'))
  );
$$;

-- =====================================================================
-- ROLLBACK
-- ---------------------------------------------------------------------
-- -- Re-run 0031_sales_document_functions.sql's can_approve_invoice()
-- -- definition verbatim to drop the service_role clause.
-- -- Re-run 0003_functions.sql's is_active_user() definition verbatim
-- -- to drop the service_role clause.
-- =====================================================================

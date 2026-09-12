-- =====================================================================
-- NIL Office — 0071_assistant_telegram_grants.sql
-- Fix: 0070_assistant_telegram.sql's assistant_channel_identities /
-- assistant_channel_updates tables are read/written directly (not
-- through a SECURITY DEFINER function) by the Telegram webhook's
-- service-role client — and bypassing RLS is NOT the same thing as
-- bypassing the base object-privilege system. This is the exact same
-- "0013_table_grants.sql gotcha" this codebase has hit and documented
-- many times before, just newly missed for a role (`service_role`)
-- that hadn't needed a *direct* table grant anywhere else this session
-- (every prior service-role write, e.g. Trade Portal's, went through a
-- SECURITY DEFINER function executing as the function owner instead).
-- Confirmed live: every webhook call failed with
-- "permission denied for table assistant_channel_updates" (42501).
-- =====================================================================

grant select, insert on public.assistant_channel_identities to service_role;
grant insert on public.assistant_channel_updates to service_role;

-- =====================================================================
-- NIL Office — 0017_letter_branding.sql
--
-- Adds storage-path columns for the company letterhead, company stamp,
-- and each user's signature image — used to render outgoing letters as
-- PDF on the official letterhead. No RLS changes needed:
--   * app_settings: p_settings_admin (0009) already restricts writes to
--     admins.
--   * profiles: p_profiles_update_self (0011) only pins role /
--     accounting_role / is_active — any other column (including this
--     new signature_path) is already self-editable, and
--     p_profiles_admin_all lets an admin upload on someone else's
--     behalf.
-- =====================================================================

alter table public.app_settings add column if not exists letterhead_path text;
alter table public.app_settings add column if not exists stamp_path      text;
alter table public.profiles     add column if not exists signature_path  text;

-- =====================================================================
-- NIL Office — 0024_contract_signatory.sql
-- Lets a contract carry a signatory (for the downloadable letterhead
-- PDF's signature block), matching correspondence's signatory_id +
-- signatory_label pair. Existing RLS policies and table grants on
-- `contracts` already cover these new columns — no further migration
-- needed for access control.
-- =====================================================================

alter table public.contracts add column if not exists signatory_id uuid references public.profiles(id) on delete set null;
alter table public.contracts add column if not exists signatory_label text;

-- =====================================================================
-- NIL Office — 0018_signatory_label.sql
--
-- Free-text name/title printed under the signature+stamp on the letter
-- PDF, set per letter. Kept separate from profiles.full_name (which for
-- at least one real account currently holds an email address, not a
-- display name) so the letterhead output is never at the mercy of
-- profile data quality.
-- =====================================================================

alter table public.correspondence add column if not exists signatory_label text;

-- =====================================================================
-- NIL Office — 0006_seed.sql  (BOOTSTRAP — edit before running)
-- Run this AFTER the first user has signed up, so a profile row exists.
-- Everything here is idempotent and safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Promote the first/owner account to ADMIN.
--    Replace the email with the real owner address.
-- ---------------------------------------------------------------------
-- update public.profiles p
--    set role = 'ADMIN', is_active = true
--   from auth.users u
--  where u.id = p.id
--    and u.email = 'owner@nil.example';

-- ---------------------------------------------------------------------
-- 2) Initialise sequence counters so numbering continues from the
--    existing paper archive WITHOUT renumbering history.
--
--    Set year to the CURRENT Jalali year and last_value to the last
--    number already used on paper. The next issued number is last_value+1.
--
--    Per current archive:
--      OUTGOING last used = 69  -> next outgoing becomes ص-<year>-0070
--      INCOMING last used = 18  -> next incoming becomes و-<year>-0019
--    Adjust the INCOMING value to your real last-used number.
-- ---------------------------------------------------------------------
insert into public.number_sequences (scope, year, last_value)
values
  ('OUTGOING', 1405, 69),
  ('INCOMING', 1405, 18)
on conflict (scope, year) do update
  set last_value = excluded.last_value,
      updated_at = now();

-- Case codes start fresh; leave CASE at 0 (row auto-creates on first use),
-- or seed it here if you are importing existing case numbers:
-- insert into public.number_sequences (scope, year, last_value)
-- values ('CASE', 1405, 0)
-- on conflict (scope, year) do nothing;

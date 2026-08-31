-- =====================================================================
-- NIL Office — 0026_contract_counterparty_rep.sql
-- Adds the counterparty's representative name so it can be typed once
-- in the app and printed on the signoff table, instead of always being
-- left blank for hand-writing (spec §8: "counterparty representative").
-- Existing RLS policies and table grants on `contracts` already cover
-- this new column — no further migration needed for access control.
-- =====================================================================

alter table public.contracts add column if not exists counterparty_representative_name text;

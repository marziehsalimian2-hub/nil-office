-- =====================================================================
-- NIL Office — 0025_contract_cancel_check_fix.sql
-- Bug fix: ck_contract_number_completeness (0021_contract_tables.sql)
-- only allowed a NIL_ISSUED contract to stay numberless while status
-- was DRAFT or UNDER_REVIEW. cancel_contract() can legally move an
-- unnumbered contract straight to CANCELLED (per the transition map in
-- 0022_contract_functions.sql), but the CHECK constraint rejected that
-- update — every cancellation of a not-yet-approved contract failed
-- with a raw constraint-violation error. CANCELLED must be allowed to
-- carry no number too; an already-numbered contract cancelled from
-- APPROVED still satisfies the constraint via the second branch.
-- =====================================================================

alter table public.contracts drop constraint if exists ck_contract_number_completeness;
alter table public.contracts add constraint ck_contract_number_completeness check (
  (kind = 'NIL_ISSUED' and (
     (status in ('DRAFT','UNDER_REVIEW','CANCELLED') and sequence_number is null)
     or (sequence_number is not null and display_number is not null and year is not null)
   ))
  or (kind = 'HISTORICAL' and external_contract_number is not null and sequence_number is null)
);

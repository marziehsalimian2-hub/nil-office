-- =====================================================================
-- NIL Office — 0108_personnel_numbering.sql
-- Human Resources & Payroll — Phase 1 — number_sequences scope +
-- format_display_number, additive. FULL existing case list restated
-- (0074/0104's own documented gotcha: CREATE OR REPLACE FUNCTION and a
-- CHECK constraint both replace their whole body — never append-only).
-- PERSONNEL numbers look like EMP-1405-0001, issued atomically at
-- INSERT via tg_personnel_number (0111), immutable thereafter (no
-- draft/finalize lifecycle — mirrors CHEQUE/OPPORTUNITY/PROJECT/OFFER,
-- not CORRESPONDENCE/RECEIPT/PAYMENT).
-- =====================================================================

alter table public.number_sequences drop constraint if exists ck_sequence_scope;
alter table public.number_sequences add constraint ck_sequence_scope
  check (scope in ('OUTGOING','INCOMING','CASE','CONTRACT','PROFORMA','INVOICE','OPPORTUNITY','PROJECT','OFFER','CHEQUE','RECEIPT','PAYMENT','PERSONNEL'));

create or replace function public.format_display_number(p_scope text, p_year int, p_seq int)
returns text
language sql
immutable
as $$
  select case p_scope
    when 'OUTGOING'    then 'ص-'   || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'INCOMING'    then 'و-'   || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'CASE'        then 'CASE-' || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'CONTRACT'    then 'CTR-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'PROFORMA'    then 'PI-'   || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'INVOICE'     then 'INV-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'OPPORTUNITY' then 'OPP-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'PROJECT'     then 'PRJ-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'OFFER'       then 'OFR-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'CHEQUE'      then 'CHQ-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'RECEIPT'     then 'RCT-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'PAYMENT'     then 'PMT-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'PERSONNEL'   then 'EMP-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    else p_scope || '-' || p_year::text || '-' || lpad(p_seq::text, 4, '0')
  end;
$$;

-- =====================================================================
-- ROLLBACK
-- ---------------------------------------------------------------------
-- Restore 0104's format_display_number/ck_sequence_scope (without
-- PERSONNEL) if this must be reverted.
-- =====================================================================

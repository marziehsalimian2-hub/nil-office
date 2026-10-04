-- =====================================================================
-- NIL Office — 0118_payroll_numbering.sql
-- HR & Payroll — Phase 3 — number_sequences scope PAYROLL_BATCH.
-- FULL case list / CHECK restated from 0108 (verified latest; 0111 only calls it).
-- PAYROLL_BATCH numbers: PRL-<jalali year of the PERIOD>-<seq:4>, issued
-- atomically inside create_payroll_batch (0120).
-- =====================================================================
alter table public.number_sequences drop constraint if exists ck_sequence_scope;
alter table public.number_sequences add constraint ck_sequence_scope
  check (scope in ('OUTGOING','INCOMING','CASE','CONTRACT','PROFORMA','INVOICE','OPPORTUNITY','PROJECT','OFFER','CHEQUE','RECEIPT','PAYMENT','PERSONNEL','PAYROLL_BATCH'));

create or replace function public.format_display_number(p_scope text, p_year int, p_seq int)
returns text
language sql
immutable
as $$
  select case p_scope
    when 'OUTGOING'      then 'ص-'    || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'INCOMING'      then 'و-'    || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'CASE'          then 'CASE-' || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'CONTRACT'      then 'CTR-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'PROFORMA'      then 'PI-'   || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'INVOICE'       then 'INV-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'OPPORTUNITY'   then 'OPP-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'PROJECT'       then 'PRJ-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'OFFER'         then 'OFR-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'CHEQUE'        then 'CHQ-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'RECEIPT'       then 'RCT-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'PAYMENT'       then 'PMT-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'PERSONNEL'     then 'EMP-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'PAYROLL_BATCH' then 'PRL-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    else p_scope || '-' || p_year::text || '-' || lpad(p_seq::text, 4, '0')
  end;
$$;

-- =====================================================================
-- ROLLBACK: re-run 0108 (drops PAYROLL_BATCH from the CHECK and the CASE). Only safe if no PAYROLL_BATCH row exists in number_sequences.
-- =====================================================================

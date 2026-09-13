-- =====================================================================
-- NIL Office — 0074_cheque_numbering.sql
-- Additive branch on the shared numbering functions, same technique
-- 0066_trade_portal.sql used for 'OFFER'. display_number is NIL
-- Office's own internal reference for a cheque row — separate from the
-- physical cheque_number printed on the bank leaf itself.
-- =====================================================================

alter table public.number_sequences drop constraint if exists ck_sequence_scope;
alter table public.number_sequences add constraint ck_sequence_scope
  check (scope in ('OUTGOING','INCOMING','CASE','CONTRACT','PROFORMA','INVOICE','OPPORTUNITY','PROJECT','OFFER','CHEQUE'));

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
    else p_scope || '-' || p_year::text || '-' || lpad(p_seq::text, 4, '0')
  end;
$$;

-- =====================================================================
-- ROLLBACK
-- ---------------------------------------------------------------------
-- alter table public.number_sequences drop constraint if exists ck_sequence_scope;
-- alter table public.number_sequences add constraint ck_sequence_scope
--   check (scope in ('OUTGOING','INCOMING','CASE','CONTRACT','PROFORMA','INVOICE','OPPORTUNITY','PROJECT','OFFER'));
-- delete from public.number_sequences where scope = 'CHEQUE';
-- -- Re-run 0066's format_display_number definition (without the CHEQUE
-- -- branch) if the function itself must be reverted; leaving the extra
-- -- `when` branch in place is harmless (dead code) otherwise.
-- =====================================================================

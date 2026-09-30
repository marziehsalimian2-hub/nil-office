-- =====================================================================
-- NIL Office — 0104_receipt_payment_verification_numbering.sql
-- Financial Receipts & Payments — Phase 1, part 4 (verification status
-- + official numbering). Combined into one migration deliberately:
-- both changes land inside the same post_receipt/post_payment
-- redefinition, and CREATE OR REPLACE FUNCTION replaces the whole
-- body — splitting this across two files would risk the second file's
-- CREATE OR REPLACE silently dropping the first file's gate.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Verification columns.
-- ---------------------------------------------------------------------
alter table public.receipts add column if not exists verified_by uuid references public.profiles(id);
alter table public.receipts add column if not exists verified_at timestamptz;
alter table public.payments add column if not exists verified_by uuid references public.profiles(id);
alter table public.payments add column if not exists verified_at timestamptz;

-- ---------------------------------------------------------------------
-- 2. Official numbering columns — same names/shapes as every other
--    numbered document (sales_documents/contracts/cheques): sequence_
--    number/display_number/year, NOT the existing fiscal_year_id FK
--    (that's a separate accounting-period concept used by
--    allocate_accounting_number/post_journal_entry's own ACC-YYYY-NNNNNN
--    numbering — this is the independent official-document scope).
-- ---------------------------------------------------------------------
alter table public.receipts add column if not exists sequence_number int;
alter table public.receipts add column if not exists display_number  text;
alter table public.receipts add column if not exists year            int;
alter table public.payments add column if not exists sequence_number int;
alter table public.payments add column if not exists display_number  text;
alter table public.payments add column if not exists year            int;

create unique index if not exists uq_receipt_seq     on public.receipts (year, sequence_number) where sequence_number is not null;
create unique index if not exists uq_receipt_display on public.receipts (display_number)         where display_number  is not null;
create unique index if not exists uq_payment_seq     on public.payments (year, sequence_number) where sequence_number is not null;
create unique index if not exists uq_payment_display on public.payments (display_number)         where display_number  is not null;

-- ---------------------------------------------------------------------
-- 3. number_sequences scope + format_display_number — additive, FULL
--    existing case list restated (0074's own documented gotcha).
-- ---------------------------------------------------------------------
alter table public.number_sequences drop constraint if exists ck_sequence_scope;
alter table public.number_sequences add constraint ck_sequence_scope
  check (scope in ('OUTGOING','INCOMING','CASE','CONTRACT','PROFORMA','INVOICE','OPPORTUNITY','PROJECT','OFFER','CHEQUE','RECEIPT','PAYMENT'));

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
    else p_scope || '-' || p_year::text || '-' || lpad(p_seq::text, 4, '0')
  end;
$$;

-- ---------------------------------------------------------------------
-- 4. verify_receipt / verify_payment — CREATE tier (segregation of
--    duties: the preparer or any CREATE+ user can verify; POST tier
--    remains reserved for whoever actually posts).
-- ---------------------------------------------------------------------
create or replace function public.verify_receipt(p_receipt_id uuid)
returns public.receipts
language plpgsql security definer set search_path = public as $$
declare v_row public.receipts;
begin
  if not public.can_create_accounting() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_row from public.receipts where id = p_receipt_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status <> 'DRAFT' then raise exception 'CASH_DOC_NOT_DRAFT' using errcode = '22000'; end if;
  if v_row.verified_at is not null then raise exception 'ALREADY_VERIFIED' using errcode = '22000'; end if;

  update public.receipts set verified_by = auth.uid(), verified_at = now(), updated_at = now()
   where id = p_receipt_id returning * into v_row;

  perform public.write_log('receipt', p_receipt_id, 'VERIFIED', null, jsonb_build_object('verified_by', auth.uid()));
  return v_row;
end; $$;

create or replace function public.verify_payment(p_payment_id uuid)
returns public.payments
language plpgsql security definer set search_path = public as $$
declare v_row public.payments;
begin
  if not public.can_create_accounting() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_row from public.payments where id = p_payment_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status <> 'DRAFT' then raise exception 'CASH_DOC_NOT_DRAFT' using errcode = '22000'; end if;
  if v_row.verified_at is not null then raise exception 'ALREADY_VERIFIED' using errcode = '22000'; end if;

  update public.payments set verified_by = auth.uid(), verified_at = now(), updated_at = now()
   where id = p_payment_id returning * into v_row;

  perform public.write_log('payment', p_payment_id, 'VERIFIED', null, jsonb_build_object('verified_by', auth.uid()));
  return v_row;
end; $$;

grant execute on function public.verify_receipt(uuid) to authenticated, service_role;
grant execute on function public.verify_payment(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. post_receipt / post_payment — full redefinition of the 0008
--    bodies: verification gate (NOT_VERIFIED) + atomic official
--    numbering at post time, alongside the existing _post_cash_document
--    journal-entry creation. Behavior tightening confirmed safe:
--    nothing already POSTED is touched by this change; existing DRAFT
--    rows just need to go through verify_* before post_* going
--    forward — this also applies uniformly to clear_cheque()'s (0077)
--    auto-created DRAFT rows, which is intentional: a cheque-originated
--    draft is not exempt from the same human verify-then-post
--    discipline.
-- ---------------------------------------------------------------------
create or replace function public.post_receipt(p_receipt_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r record; v_bank_account uuid; v_entry uuid;
  v_year int; v_seq int; v_disp text;
begin
  if not public.can_post_accounting() then raise exception 'NOT_AUTHORIZED'; end if;
  select * into r from public.receipts where id = p_receipt_id for update;
  if not found            then raise exception 'NOT_FOUND'; end if;
  if r.status = 'POSTED'  then raise exception 'ALREADY_POSTED'; end if;
  if r.verified_at is null then raise exception 'NOT_VERIFIED'; end if;
  if r.fiscal_year_id is null or r.bank_account_id is null or r.counterpart_account_id is null
    then raise exception 'MISSING_ACCOUNTS'; end if;

  select account_id into v_bank_account from public.bank_accounts where id = r.bank_account_id;
  if v_bank_account is null then raise exception 'BANK_ACCOUNT_UNLINKED'; end if;

  -- receipt: Dr bank/cash, Cr counterpart
  v_entry := public._post_cash_document(
    r.fiscal_year_id, r.receipt_date, coalesce('دریافت: '||r.description, 'دریافت'),
    v_bank_account, r.counterpart_account_id, r.amount, r.detail_account_id, r.company_id, r.case_id);

  v_year := coalesce(r.year, public.jalali_year(r.receipt_date::timestamptz));
  v_seq  := public.allocate_sequence('RECEIPT', v_year);
  v_disp := public.format_display_number('RECEIPT', v_year, v_seq);

  update public.receipts
     set status = 'POSTED', journal_entry_id = v_entry,
         sequence_number = v_seq, display_number = v_disp, year = v_year,
         updated_at = now()
   where id = p_receipt_id;

  perform public.write_log('receipt', p_receipt_id, 'POST', null,
    jsonb_build_object('journal_entry', v_entry, 'display_number', v_disp));
  return v_entry;
end;
$$;

create or replace function public.post_payment(p_payment_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r record; v_bank_account uuid; v_entry uuid;
  v_year int; v_seq int; v_disp text;
begin
  if not public.can_post_accounting() then raise exception 'NOT_AUTHORIZED'; end if;
  select * into r from public.payments where id = p_payment_id for update;
  if not found            then raise exception 'NOT_FOUND'; end if;
  if r.status = 'POSTED'  then raise exception 'ALREADY_POSTED'; end if;
  if r.verified_at is null then raise exception 'NOT_VERIFIED'; end if;
  if r.fiscal_year_id is null or r.bank_account_id is null or r.counterpart_account_id is null
    then raise exception 'MISSING_ACCOUNTS'; end if;

  select account_id into v_bank_account from public.bank_accounts where id = r.bank_account_id;
  if v_bank_account is null then raise exception 'BANK_ACCOUNT_UNLINKED'; end if;

  -- payment: Dr counterpart, Cr bank/cash
  v_entry := public._post_cash_document(
    r.fiscal_year_id, r.payment_date, coalesce('پرداخت: '||r.description, 'پرداخت'),
    r.counterpart_account_id, v_bank_account, r.amount, r.detail_account_id, r.company_id, r.case_id);

  v_year := coalesce(r.year, public.jalali_year(r.payment_date::timestamptz));
  v_seq  := public.allocate_sequence('PAYMENT', v_year);
  v_disp := public.format_display_number('PAYMENT', v_year, v_seq);

  update public.payments
     set status = 'POSTED', journal_entry_id = v_entry,
         sequence_number = v_seq, display_number = v_disp, year = v_year,
         updated_at = now()
   where id = p_payment_id;

  perform public.write_log('payment', p_payment_id, 'POST', null,
    jsonb_build_object('journal_entry', v_entry, 'display_number', v_disp));
  return v_entry;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Grants. post_receipt/post_payment already have authenticated
--    EXECUTE (0008) and are covered by 0096's blanket service_role
--    refresh — CREATE OR REPLACE FUNCTION with an unchanged signature
--    preserves existing ACLs, but both are re-stated below anyway,
--    defensively.
-- ---------------------------------------------------------------------
grant execute on function public.post_receipt(uuid) to authenticated, service_role;
grant execute on function public.post_payment(uuid) to authenticated, service_role;

-- =====================================================================
-- ROLLBACK
-- ---------------------------------------------------------------------
-- Re-run 0008's original post_receipt/post_payment bodies (no verify/
-- numbering) to revert function behavior; drop verify_receipt/
-- verify_payment; drop the RECEIPT/PAYMENT columns/indexes above;
-- restore 0074's format_display_number/ck_sequence_scope (without
-- RECEIPT/PAYMENT) if the scope itself must be reverted.
-- =====================================================================

-- =====================================================================
-- NIL Office — 0061_sales_document_bank_account.sql
-- Invoice/Proforma Phase 2 — a document may reference one of NIL's
-- existing bank_accounts (0007_accounting_tables.sql) for wire-transfer
-- instructions on the printed PDF. Snapshotted at issue time, exactly
-- like the customer_*_snapshot columns (0030) — an already-issued PDF
-- must never change if the bank_accounts row is edited later.
-- =====================================================================

alter table public.sales_documents add column if not exists bank_account_id uuid references public.bank_accounts(id) on delete set null;
alter table public.sales_documents add column if not exists bank_kind_snapshot           text;
alter table public.sales_documents add column if not exists bank_name_snapshot           text;
alter table public.sales_documents add column if not exists bank_account_title_snapshot  text;
alter table public.sales_documents add column if not exists bank_account_number_snapshot text;
alter table public.sales_documents add column if not exists bank_account_iban_snapshot   text;

-- ---------------------------------------------------------------------
-- finalize_sales_document — same body as 0031, plus one added step:
-- snapshot the chosen bank account's fields at the moment the display
-- number is assigned.
-- ---------------------------------------------------------------------
create or replace function public.finalize_sales_document(
  p_id   uuid,
  p_year int default null
)
returns public.sales_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.sales_documents;
  v_year  int;
  v_seq   int;
  v_disp  text;
  v_scope text;
  v_bank  public.bank_accounts;
begin
  if not public.can_approve_invoice() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_row from public.sales_documents where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_row.sequence_number is not null then
    raise exception 'ALREADY_NUMBERED' using errcode = '22000';
  end if;
  if v_row.status <> 'APPROVED' then
    raise exception 'NOT_ELIGIBLE' using errcode = '22000';
  end if;
  if v_row.company_id is null then
    raise exception 'CUSTOMER_REQUIRED' using errcode = '22000';
  end if;

  v_year := coalesce(p_year, v_row.year, public.jalali_year(now()));
  if v_year < 1300 or v_year > 1600 then
    raise exception 'INVALID_YEAR' using errcode = '22000';
  end if;

  -- v_row.type is 'PROFORMA' or 'INVOICE' — matches the number_sequences
  -- scope CHECK and format_display_number's case branches directly, no
  -- translation needed.
  v_scope := v_row.type::text;

  v_seq  := public.allocate_sequence(v_scope, v_year);
  v_disp := public.format_display_number(v_scope, v_year, v_seq);

  if v_row.bank_account_id is not null then
    select * into v_bank from public.bank_accounts where id = v_row.bank_account_id;
  end if;

  update public.sales_documents
     set sequence_number = v_seq,
         display_number  = v_disp,
         year            = v_year,
         status          = 'ISSUED',
         issued_by       = auth.uid(),
         issued_at       = now(),
         updated_at      = now(),
         bank_kind_snapshot           = v_bank.kind::text,
         bank_name_snapshot           = v_bank.bank_name,
         bank_account_title_snapshot  = v_bank.account_title,
         bank_account_number_snapshot = v_bank.account_number,
         bank_account_iban_snapshot   = v_bank.iban
   where id = p_id
   returning * into v_row;

  perform public.write_log(
    'sales_documents', p_id, 'ISSUED',
    jsonb_build_object('status', 'APPROVED'),
    jsonb_build_object('status', 'ISSUED', 'display_number', v_disp,
                       'sequence_number', v_seq, 'year', v_year)
  );

  return v_row;
end;
$$;

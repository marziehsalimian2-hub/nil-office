-- =====================================================================
-- NIL Office — 0140_payroll_toman_ledger.sql
-- HR & Payroll — Phase 9 (part 2): a TOMAN payroll batch may reach the books.
--
-- Until now a batch could create its accounting draft / payment drafts only when batch.currency = app_settings.base_currency_code
-- (default 'IRR', not editable in the UI). A company that pays and books in Toman could calculate, approve and issue payslips but
-- never reach accounting. The system's own convention (app_settings.display_unit) is "stored amounts are already in the configured
-- unit — no silent conversion". So:
--
--   accounting_ledger_currencies() = { base_currency_code }                       when display_unit = 'RIAL' (or any other base code)
--                                  = { 'IRR', 'TOMAN' }                           when display_unit = 'TOMAN' and the base code is IRR / TOMAN
--
-- With display unit TOMAN every ledger amount is a Toman number whichever code it carries (documents coded 'TOMAN' or coded 'IRR with
-- Toman numbers), so a batch / bank account in either of those two codes is accepted. With display unit RIAL a TOMAN batch is still
-- refused (that would need x10 — not modelled; no conversion happens anywhere). USD / EUR / ... are refused exactly as before.
--
-- Restated from the CURRENT bodies (grep of ALL migrations): payroll_accounting_readiness + create_payroll_accounting_draft (0125 only),
-- create_payroll_payment_drafts (0128 only). Signatures unchanged => existing grants stay; error keys unchanged.
-- No label / document-currency change anywhere: labels keep following each document's own currency code.
-- =====================================================================

create or replace function public.accounting_ledger_currencies()
returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when s.display_unit = 'TOMAN' and s.base_currency_code in ('IRR', 'TOMAN') then array['IRR', 'TOMAN']
                else array[s.base_currency_code] end
      from public.app_settings s where s.id = 1), array[]::text[]);
$$;

revoke execute on function public.accounting_ledger_currencies() from public, anon;
grant execute on function public.accounting_ledger_currencies() to authenticated;

-- ---------------------------------------------------------------------
-- Readiness for the batch page: now also says which unit setting applies (no amounts)
-- ---------------------------------------------------------------------
create or replace function public.payroll_accounting_readiness(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_b public.payroll_batches; v_base text; v_unit text; v_s public.payroll_accounting_settings; v_missing jsonb; v_j jsonb;
begin
  if not public.has_payroll_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_b from public.payroll_batches where id = p_batch_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select base_currency_code, display_unit into v_base, v_unit from public.app_settings where id = 1;
  select * into v_s from public.payroll_accounting_settings limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('code', x.component_code, 'name', x.label) order by x.component_code), '[]'::jsonb)
    into v_missing
    from (select distinct l.component_code, l.label from public._payroll_journal_lines(p_batch_id) l
           where l.account_id is null and l.kind in ('EARNING','EMPLOYER_COST','DEDUCTION') and l.component_code <> 'BASE_SALARY') x;

  select jsonb_build_object('id', j.id, 'status', j.status, 'document_number', j.document_number)
    into v_j from public.journal_entries j where j.id = v_b.accounting_journal_entry_id;

  return jsonb_build_object(
    'base_currency', v_base,
    'display_unit', v_unit,
    'ledger_currencies', to_jsonb(public.accounting_ledger_currencies()),
    'currency_ok', v_b.currency = any(public.accounting_ledger_currencies()),
    'settings_ok', v_s.base_salary_expense_account_id is not null and v_s.net_payable_account_id is not null,
    'missing_components', v_missing,
    'journal', v_j,
    'can_draft', v_b.status = 'APPROVED' and not public._payroll_live_journal(v_b.accounting_journal_entry_id));
end; $$;

-- ---------------------------------------------------------------------
-- Create the DRAFT journal entry (idempotent per batch): only the currency check changes
-- ---------------------------------------------------------------------
create or replace function public.create_payroll_accounting_draft(p_batch_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_b public.payroll_batches; v_period public.payroll_periods; v_s public.payroll_accounting_settings;
  v_fy uuid; v_entry uuid; v_debit numeric; v_credit numeric; v_missing integer; v_bad integer; v_lines integer;
begin
  if not public.can_approve_payroll() or not public.can_create_accounting() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select * into v_b from public.payroll_batches where id = p_batch_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_b.status <> 'APPROVED' then raise exception 'PAYROLL_NOT_APPROVED' using errcode = '22000'; end if;
  if public._payroll_live_journal(v_b.accounting_journal_entry_id) then
    raise exception 'PAYROLL_ACCOUNTING_DRAFT_EXISTS' using errcode = '22000';
  end if;

  if not coalesce(v_b.currency = any(public.accounting_ledger_currencies()), false) then
    raise exception 'PAYROLL_CURRENCY_NOT_BASE' using errcode = '22000';
  end if;

  select * into v_s from public.payroll_accounting_settings limit 1;
  if v_s.base_salary_expense_account_id is null or v_s.net_payable_account_id is null then
    raise exception 'PAYROLL_ACCOUNT_MAPPING_MISSING' using errcode = '22000';
  end if;
  select count(*), count(*) filter (where l.account_id is null),
         count(*) filter (where l.account_id is not null and not public._payroll_account_ok(l.account_id)),
         coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0)
    into v_lines, v_missing, v_bad, v_debit, v_credit
    from public._payroll_journal_lines(p_batch_id) l;
  if v_missing > 0 then raise exception 'PAYROLL_ACCOUNT_MAPPING_MISSING' using errcode = '22000'; end if;
  if v_bad > 0 then raise exception 'PAYROLL_ACCOUNT_INVALID' using errcode = '22000'; end if;
  if v_lines < 2 or v_debit <= 0 or v_debit <> v_credit then raise exception 'PAYROLL_LEDGER_MISMATCH' using errcode = '22000'; end if;

  select * into v_period from public.payroll_periods where id = v_b.period_id;
  select id into v_fy from public.fiscal_years
   where status = 'OPEN' and start_date <= v_period.period_end and end_date >= v_period.period_end limit 1;
  if v_fy is null then raise exception 'FISCAL_YEAR_CLOSED' using errcode = '22000'; end if;

  insert into public.journal_entries (fiscal_year_id, document_date, description, reference, status, created_by)
  values (v_fy, v_period.period_end, 'حقوق و دستمزد — دستهٔ ' || v_b.batch_number, v_b.batch_number, 'DRAFT', auth.uid())
  returning id into v_entry;

  insert into public.journal_entry_lines (journal_entry_id, account_id, description, debit, credit, line_no)
  select v_entry, l.account_id, l.label, l.debit, l.credit, row_number() over (order by l.ord, l.component_code)
    from public._payroll_journal_lines(p_batch_id) l;

  update public.payroll_batches
     set accounting_journal_entry_id = v_entry, accounting_drafted_by = auth.uid(), accounting_drafted_at = now(), updated_at = now()
   where id = p_batch_id;

  perform public.write_log('payroll_batches', p_batch_id, 'ACCOUNTING_DRAFT_CREATED', null, jsonb_build_object('journal_entry_id', v_entry, 'line_count', v_lines));
  perform public.write_log('journal_entries', v_entry, 'CREATED_FROM_PAYROLL_BATCH', null, jsonb_build_object('payroll_batch_id', p_batch_id));
  return v_entry;
end; $$;

-- ---------------------------------------------------------------------
-- Create DRAFT payments: batch currency check + bank-account currency check (same currency, OR both are ledger currencies)
-- ---------------------------------------------------------------------
create or replace function public.create_payroll_payment_drafts(
  p_batch_id uuid, p_bank_account_id uuid, p_payment_date date, p_method text, p_items jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_b public.payroll_batches; v_s public.payroll_accounting_settings; v_bank public.bank_accounts; v_ledger text[];
  v_fy uuid; v_it jsonb; v_rid uuid; v_amt numeric; v_res public.payroll_results; v_avail numeric;
  v_pid uuid; v_n integer := 0; v_seen uuid[] := '{}'; v_method text := coalesce(nullif(btrim(coalesce(p_method, '')), ''), 'انتقال بانکی');
begin
  if not public.can_approve_payroll() or not public.can_create_accounting() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'PAYROLL_NO_PAYMENTS' using errcode = '22000';
  end if;
  if p_payment_date is null then raise exception 'INVALID_VALUE' using errcode = '22000'; end if;

  select * into v_b from public.payroll_batches where id = p_batch_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_b.status <> 'APPROVED' then raise exception 'PAYROLL_NOT_APPROVED' using errcode = '22000'; end if;
  v_ledger := public.accounting_ledger_currencies();
  if not coalesce(v_b.currency = any(v_ledger), false) then raise exception 'PAYROLL_CURRENCY_NOT_BASE' using errcode = '22000'; end if;

  select * into v_s from public.payroll_accounting_settings limit 1;
  if v_s.net_payable_account_id is null or not public._payroll_account_ok(v_s.net_payable_account_id) then
    raise exception 'PAYROLL_ACCOUNT_MAPPING_MISSING' using errcode = '22000';
  end if;
  select * into v_bank from public.bank_accounts where id = p_bank_account_id and is_active and account_id is not null;
  if not found then raise exception 'PAYROLL_BANK_ACCOUNT_INVALID' using errcode = '22000'; end if;
  if v_bank.currency_code is distinct from v_b.currency
     and not coalesce(v_bank.currency_code = any(v_ledger), false) then
    raise exception 'PAYROLL_BANK_CURRENCY_MISMATCH' using errcode = '22000';
  end if;
  select id into v_fy from public.fiscal_years
   where status = 'OPEN' and start_date <= p_payment_date and end_date >= p_payment_date limit 1;
  if v_fy is null then raise exception 'FISCAL_YEAR_CLOSED' using errcode = '22000'; end if;

  for v_it in select * from jsonb_array_elements(p_items) loop
    begin
      v_rid := nullif(v_it ->> 'result_id', '')::uuid;
      v_amt := nullif(v_it ->> 'amount', '')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'INVALID_VALUE' using errcode = '22000';
    end;
    if v_rid is null or v_amt is null or v_rid = any(v_seen) then raise exception 'INVALID_VALUE' using errcode = '22000'; end if;
    v_seen := v_seen || v_rid;
    if v_amt <= 0 or round(v_amt, 4) <> v_amt then raise exception 'PAYROLL_PAYMENT_AMOUNT_INVALID' using errcode = '22000'; end if;

    select * into v_res from public.payroll_results where id = v_rid and batch_id = p_batch_id and calculation_id = v_b.approved_calculation_id;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

    select v_res.net
           - coalesce(sum(p.amount) filter (where p.status = 'POSTED' and j.status = 'POSTED'), 0)
           - coalesce(sum(p.amount) filter (where p.status = 'DRAFT'), 0)
      into v_avail
      from public.payroll_payments pp
      join public.payments p on p.id = pp.payment_id
      left join public.journal_entries j on j.id = p.journal_entry_id
     where pp.result_id = v_rid;
    if v_amt > v_avail then raise exception 'PAYROLL_PAYMENT_AMOUNT_INVALID' using errcode = '22000'; end if;

    insert into public.payments (payment_date, payee, amount, currency_code, bank_account_id, counterpart_account_id,
                                 method, reference, description, fiscal_year_id, status, created_by)
    values (p_payment_date, v_res.personnel_name, v_amt, v_b.currency, p_bank_account_id, v_s.net_payable_account_id,
            v_method, v_b.batch_number, 'حقوق — ' || v_res.personnel_number || ' — دستهٔ ' || v_b.batch_number, v_fy, 'DRAFT', auth.uid())
    returning id into v_pid;
    insert into public.payroll_payments (batch_id, result_id, payment_id, amount_snapshot, currency, created_by)
    values (p_batch_id, v_rid, v_pid, v_amt, v_b.currency, auth.uid());
    v_n := v_n + 1;
  end loop;

  perform public.write_log('payroll_batches', p_batch_id, 'PAYMENT_DRAFTS_CREATED', null, jsonb_build_object('count', v_n));
  return v_n;
end; $$;

-- =====================================================================
-- ROLLBACK: re-run 0125's payroll_accounting_readiness / create_payroll_accounting_draft and 0128's create_payroll_payment_drafts;
--   drop function if exists public.accounting_ledger_currencies();
-- =====================================================================

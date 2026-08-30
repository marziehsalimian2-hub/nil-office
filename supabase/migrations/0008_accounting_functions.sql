-- =============================================================================
-- NIL Office v1.0  |  Migration 0008 — Accounting Functions, Triggers, Views
-- Atomic numbering, balanced posting, reversal, fiscal-year close, cash docs.
-- =============================================================================

-- ---- authority helpers ------------------------------------------------------
create or replace function public.has_accounting_access()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or accounting_role is not null)
  );
$$;

create or replace function public.can_create_accounting()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or accounting_role in ('CREATE','POST','ADMIN'))
  );
$$;

create or replace function public.can_post_accounting()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or accounting_role in ('POST','ADMIN'))
  );
$$;

create or replace function public.is_accounting_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or accounting_role = 'ADMIN')
  );
$$;

-- ---- atomic accounting-document numbering (fiscal-year scoped) --------------
create or replace function public.allocate_accounting_number(p_fiscal_year_id uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_val bigint;
begin
  insert into public.accounting_sequences (fiscal_year_id, last_value)
  values (p_fiscal_year_id, 0)
  on conflict (fiscal_year_id) do nothing;

  update public.accounting_sequences
     set last_value = last_value + 1, updated_at = now()
   where fiscal_year_id = p_fiscal_year_id
   returning last_value into v_val;

  return v_val;
end;
$$;
revoke execute on function public.allocate_accounting_number(uuid) from public, anon, authenticated;

-- ---- immutability guards for posted history --------------------------------
create or replace function public.tg_journal_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('POSTED','REVERSED') then raise exception 'CANNOT_DELETE_POSTED'; end if;
    return old;
  end if;
  -- UPDATE: a posted entry is frozen unless a sanctioned RPC sets the guard.
  if old.status = 'POSTED'
     and coalesce(current_setting('nil.acc_guard', true), '') <> 'on' then
    raise exception 'POSTED_ENTRY_IMMUTABLE';
  end if;
  if old.status = 'REVERSED' then raise exception 'POSTED_ENTRY_IMMUTABLE'; end if;
  return new;
end;
$$;
drop trigger if exists trg_journal_guard on public.journal_entries;
create trigger trg_journal_guard before update or delete on public.journal_entries
  for each row execute function public.tg_journal_guard();

create or replace function public.tg_journal_line_guard()
returns trigger language plpgsql set search_path = public as $$
declare v_status posting_status;
begin
  select status into v_status from public.journal_entries
   where id = coalesce(new.journal_entry_id, old.journal_entry_id);
  if v_status is distinct from 'DRAFT'
     and coalesce(current_setting('nil.acc_guard', true), '') <> 'on' then
    raise exception 'POSTED_ENTRY_IMMUTABLE';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_jel_guard on public.journal_entry_lines;
create trigger trg_jel_guard before insert or update or delete on public.journal_entry_lines
  for each row execute function public.tg_journal_line_guard();

-- ---- CRITICAL: post a journal entry (spec §10,33,34) ------------------------
create or replace function public.post_journal_entry(p_entry_id uuid)
returns table (id uuid, document_number text, status posting_status)
language plpgsql security definer set search_path = public as $$
declare
  v_status  posting_status;
  v_fy      uuid;
  v_fy_st   fiscal_year_status;
  v_start   date;
  v_year    int;
  v_lines   int;
  v_bad     int;
  v_debit   numeric(20,4);
  v_credit  numeric(20,4);
  v_seq     bigint;
  v_num     text;
begin
  if not public.can_post_accounting() then raise exception 'NOT_AUTHORIZED'; end if;

  select status, fiscal_year_id into v_status, v_fy
  from public.journal_entries where id = p_entry_id for update;
  if not found            then raise exception 'NOT_FOUND'; end if;
  if v_status = 'POSTED'  then raise exception 'ALREADY_POSTED'; end if;
  if v_status <> 'DRAFT'  then raise exception 'NOT_ELIGIBLE'; end if;

  select status, start_date into v_fy_st, v_start from public.fiscal_years where id = v_fy;
  if v_fy_st <> 'OPEN' then raise exception 'FISCAL_YEAR_CLOSED'; end if;

  select count(*),
         count(*) filter (where not a.allows_posting or not a.is_active)
    into v_lines, v_bad
  from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
  where l.journal_entry_id = p_entry_id;

  if v_lines < 2 then raise exception 'TOO_FEW_LINES'; end if;
  if v_bad   > 0 then raise exception 'NON_POSTING_ACCOUNT'; end if;

  select coalesce(sum(debit),0), coalesce(sum(credit),0)
    into v_debit, v_credit
  from public.journal_entry_lines where journal_entry_id = p_entry_id;

  if v_debit <> v_credit or v_debit = 0 then raise exception 'UNBALANCED'; end if;

  v_year := public.jalali_year(v_start::timestamptz);
  v_seq  := public.allocate_accounting_number(v_fy);
  v_num  := 'ACC-' || v_year || '-' || lpad(v_seq::text, 6, '0');

  update public.journal_entries
     set document_number = v_num,
         status          = 'POSTED',
         posted_by       = auth.uid(),
         posted_at       = now(),
         updated_at      = now()
   where id = p_entry_id;

  perform public.write_log('journal_entry', p_entry_id, 'POST', null,
    jsonb_build_object('document_number', v_num, 'debit', v_debit, 'credit', v_credit));

  return query select p_entry_id, v_num, 'POSTED'::posting_status;
end;
$$;

-- ---- reversal (never destroy posted history) -------------------------------
create or replace function public.reverse_journal_entry(p_entry_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_status posting_status;
  v_fy     uuid;
  v_fy_st  fiscal_year_status;
  v_date   date;
  v_new    uuid;
begin
  if not public.can_post_accounting() then raise exception 'NOT_AUTHORIZED'; end if;

  select status, fiscal_year_id, document_date into v_status, v_fy, v_date
  from public.journal_entries where id = p_entry_id for update;
  if not found              then raise exception 'NOT_FOUND'; end if;
  if v_status <> 'POSTED'   then raise exception 'NOT_ELIGIBLE'; end if;

  select status into v_fy_st from public.fiscal_years where id = v_fy;
  if v_fy_st <> 'OPEN' then raise exception 'FISCAL_YEAR_CLOSED'; end if;

  -- new draft reversal with swapped debit/credit
  insert into public.journal_entries (fiscal_year_id, document_date, description, status, reversal_of, created_by)
  values (v_fy, current_date, 'برگشت سند', 'DRAFT', p_entry_id, auth.uid())
  returning id into v_new;

  insert into public.journal_entry_lines
    (journal_entry_id, account_id, detail_account_id, description, debit, credit, company_id, case_id, line_no)
  select v_new, account_id, detail_account_id, description, credit, debit, company_id, case_id, line_no
  from public.journal_entry_lines where journal_entry_id = p_entry_id;

  -- post the reversal (balanced by construction)
  perform public.post_journal_entry(v_new);

  -- mark the original REVERSED (guarded update)
  perform set_config('nil.acc_guard', 'on', true);
  update public.journal_entries set status = 'REVERSED', updated_at = now() where id = p_entry_id;
  perform set_config('nil.acc_guard', 'off', true);

  perform public.write_log('journal_entry', p_entry_id, 'REVERSE', null,
    jsonb_build_object('reversal_entry', v_new));

  return v_new;
end;
$$;

-- ---- fiscal-year close ------------------------------------------------------
create or replace function public.close_fiscal_year(p_fiscal_year_id uuid, p_force boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_drafts int; v_st fiscal_year_status;
begin
  if not public.is_accounting_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  select status into v_st from public.fiscal_years where id = p_fiscal_year_id for update;
  if not found          then raise exception 'NOT_FOUND'; end if;
  if v_st = 'CLOSED'    then return; end if;

  select count(*) into v_drafts from public.journal_entries
   where fiscal_year_id = p_fiscal_year_id and status = 'DRAFT';
  if v_drafts > 0 and not p_force then raise exception 'DRAFTS_EXIST'; end if;

  update public.fiscal_years set status = 'CLOSED', closed_at = now() where id = p_fiscal_year_id;
  perform public.write_log('fiscal_year', p_fiscal_year_id, 'CLOSE', null,
    jsonb_build_object('drafts_at_close', v_drafts));
end;
$$;

-- ---- cash documents: build a balanced 2-line entry and post it -------------
create or replace function public._post_cash_document(
  p_fy uuid, p_date date, p_desc text,
  p_debit_account uuid, p_credit_account uuid, p_amount numeric,
  p_detail uuid, p_company uuid, p_case uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_entry uuid;
begin
  insert into public.journal_entries (fiscal_year_id, document_date, description, status, created_by)
  values (p_fy, p_date, p_desc, 'DRAFT', auth.uid())
  returning id into v_entry;

  insert into public.journal_entry_lines (journal_entry_id, account_id, detail_account_id, debit, credit, company_id, case_id, line_no)
  values
    (v_entry, p_debit_account,  p_detail, p_amount, 0, p_company, p_case, 1),
    (v_entry, p_credit_account, p_detail, 0, p_amount, p_company, p_case, 2);

  perform public.post_journal_entry(v_entry);
  return v_entry;
end;
$$;
revoke execute on function public._post_cash_document(uuid,date,text,uuid,uuid,numeric,uuid,uuid,uuid) from public, anon, authenticated;

create or replace function public.post_receipt(p_receipt_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare r record; v_bank_account uuid; v_entry uuid;
begin
  if not public.can_post_accounting() then raise exception 'NOT_AUTHORIZED'; end if;
  select * into r from public.receipts where id = p_receipt_id for update;
  if not found            then raise exception 'NOT_FOUND'; end if;
  if r.status = 'POSTED'  then raise exception 'ALREADY_POSTED'; end if;
  if r.fiscal_year_id is null or r.bank_account_id is null or r.counterpart_account_id is null
    then raise exception 'MISSING_ACCOUNTS'; end if;

  select account_id into v_bank_account from public.bank_accounts where id = r.bank_account_id;
  if v_bank_account is null then raise exception 'BANK_ACCOUNT_UNLINKED'; end if;

  -- receipt: Dr bank/cash, Cr counterpart
  v_entry := public._post_cash_document(
    r.fiscal_year_id, r.receipt_date, coalesce('دریافت: '||r.description, 'دریافت'),
    v_bank_account, r.counterpart_account_id, r.amount, r.detail_account_id, r.company_id, r.case_id);

  update public.receipts set status = 'POSTED', journal_entry_id = v_entry, updated_at = now()
   where id = p_receipt_id;
  perform public.write_log('receipt', p_receipt_id, 'POST', null, jsonb_build_object('journal_entry', v_entry));
  return v_entry;
end;
$$;

create or replace function public.post_payment(p_payment_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare r record; v_bank_account uuid; v_entry uuid;
begin
  if not public.can_post_accounting() then raise exception 'NOT_AUTHORIZED'; end if;
  select * into r from public.payments where id = p_payment_id for update;
  if not found            then raise exception 'NOT_FOUND'; end if;
  if r.status = 'POSTED'  then raise exception 'ALREADY_POSTED'; end if;
  if r.fiscal_year_id is null or r.bank_account_id is null or r.counterpart_account_id is null
    then raise exception 'MISSING_ACCOUNTS'; end if;

  select account_id into v_bank_account from public.bank_accounts where id = r.bank_account_id;
  if v_bank_account is null then raise exception 'BANK_ACCOUNT_UNLINKED'; end if;

  -- payment: Dr counterpart, Cr bank/cash
  v_entry := public._post_cash_document(
    r.fiscal_year_id, r.payment_date, coalesce('پرداخت: '||r.description, 'پرداخت'),
    r.counterpart_account_id, v_bank_account, r.amount, r.detail_account_id, r.company_id, r.case_id);

  update public.payments set status = 'POSTED', journal_entry_id = v_entry, updated_at = now()
   where id = p_payment_id;
  perform public.write_log('payment', p_payment_id, 'POST', null, jsonb_build_object('journal_entry', v_entry));
  return v_entry;
end;
$$;

-- ---- reporting views (RLS-respecting via security_invoker) ------------------
-- Posted lines only — DRAFT never appears in official reports (spec §20,33).
create or replace view public.v_posted_lines
with (security_invoker = on) as
select
  l.id, l.account_id, l.detail_account_id, l.debit, l.credit,
  l.company_id, l.case_id, e.id as journal_entry_id, e.document_number,
  e.document_date, e.fiscal_year_id, a.code as account_code, a.name as account_name,
  a.account_type, a.nature
from public.journal_entry_lines l
join public.journal_entries e on e.id = l.journal_entry_id
join public.accounts a        on a.id = l.account_id
where e.status = 'POSTED';

create or replace view public.v_trial_balance
with (security_invoker = on) as
select
  a.id as account_id, a.code, a.name, a.account_type, a.nature,
  coalesce(sum(l.debit),0)  as total_debit,
  coalesce(sum(l.credit),0) as total_credit,
  coalesce(sum(l.debit),0) - coalesce(sum(l.credit),0) as balance,
  e.fiscal_year_id
from public.accounts a
left join public.journal_entry_lines l on l.account_id = a.id
left join public.journal_entries e on e.id = l.journal_entry_id and e.status = 'POSTED'
group by a.id, a.code, a.name, a.account_type, a.nature, e.fiscal_year_id;

-- ---- grants -----------------------------------------------------------------
grant execute on function public.has_accounting_access()                to authenticated;
grant execute on function public.can_create_accounting()                to authenticated;
grant execute on function public.can_post_accounting()                  to authenticated;
grant execute on function public.is_accounting_admin()                  to authenticated;
grant execute on function public.post_journal_entry(uuid)               to authenticated;
grant execute on function public.reverse_journal_entry(uuid)            to authenticated;
grant execute on function public.close_fiscal_year(uuid, boolean)       to authenticated;
grant execute on function public.post_receipt(uuid)                     to authenticated;
grant execute on function public.post_payment(uuid)                     to authenticated;
grant select on public.v_posted_lines, public.v_trial_balance           to authenticated;

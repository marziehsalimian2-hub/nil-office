-- =====================================================================
-- NIL Office — 0128_payroll_payments.sql
-- HR & Payroll — Phase 5 — salary payments THROUGH the existing Financial Receipts & Payments module.
--  * payroll_payments: immutable link payment <-> payroll result (no change to the allocation engine).
--  * create_payroll_payment_drafts inserts DRAFT rows straight into public.payments (precedent: clear_cheque, 0077).
--    Verification/posting stay Accounting's own flow (verify_payment / post_payment).
--  * Paid / outstanding / batch payment state are DERIVED from real payments (never stored, never a manual flag).
--  * reopen_payroll_batch and cancel-after-approval are blocked while a linked payment is DRAFT or POSTED.
-- RESTATED (each had its latest definition in 0125, verified by grep): reopen_payroll_batch, change_payroll_batch_status.
-- No write_log payload contains an amount. Writes only via SECURITY DEFINER RPCs; RLS/grants in 0129.
-- =====================================================================

create table if not exists public.payroll_payments (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null references public.payroll_batches(id) on delete restrict,
  result_id       uuid not null references public.payroll_results(id) on delete restrict,
  payment_id      uuid not null unique references public.payments(id) on delete restrict,
  amount_snapshot numeric(20,4) not null check (amount_snapshot > 0),   -- amount when drafted (detects later edits in Accounting)
  currency        text not null,
  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now()
);
create index if not exists idx_payroll_payments_result on public.payroll_payments (result_id);
create index if not exists idx_payroll_payments_batch  on public.payroll_payments (batch_id);

-- Links are immutable; they may be deleted ONLY by discard_payroll_payment_drafts (which sets the session flag).
create or replace function public.tg_payroll_payments_delete_guard() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('nil.payroll_discard', true), '') <> 'on' then
    raise exception 'PAYROLL_NO_DELETE' using errcode = '22000';
  end if;
  return old;
end; $$;

drop trigger if exists trg_no_delete_payroll_payments on public.payroll_payments;
create trigger trg_no_delete_payroll_payments before delete on public.payroll_payments
  for each row execute function public.tg_payroll_payments_delete_guard();
drop trigger if exists trg_frozen_payroll_payments on public.payroll_payments;
create trigger trg_frozen_payroll_payments before update on public.payroll_payments
  for each row execute function public.tg_payroll_frozen();
drop trigger if exists trg_payroll_audit_payroll_payments on public.payroll_payments;
create trigger trg_payroll_audit_payroll_payments after insert or update or delete on public.payroll_payments
  for each row execute function public.tg_payroll_audit('batch_id,result_id,payment_id,currency');

-- A linked payment that is still DRAFT or POSTED keeps the batch locked.
create or replace function public._payroll_has_live_payments(p_batch_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.payroll_payments pp join public.payments p on p.id = pp.payment_id
                  where pp.batch_id = p_batch_id and p.status in ('DRAFT','POSTED'));
$$;

create or replace function public.reopen_payroll_batch(p_batch_id uuid, p_reason text)
returns public.payroll_batches
language plpgsql security definer set search_path = public as $$
declare v_row public.payroll_batches; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_payroll_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED' using errcode = '22000'; end if;
  select * into v_row from public.payroll_batches where id = p_batch_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status = 'CANCELLED' then raise exception 'PAYROLL_BATCH_CANCELLED' using errcode = '22000'; end if;
  if v_row.status <> 'APPROVED' then raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000'; end if;
  if public._payroll_live_journal(v_row.accounting_journal_entry_id) or public._payroll_has_live_payments(p_batch_id) then
    raise exception 'PAYROLL_REOPEN_BLOCKED' using errcode = '22000';
  end if;

  update public.payroll_batches set
    status = 'UNDER_REVIEW', approved_by = null, approved_at = null, approved_calculation_id = null,
    reviewed_by = null, reviewed_at = null, status_note = v_reason, updated_at = now()
   where id = p_batch_id returning * into v_row;
  perform public.write_log('payroll_batches', p_batch_id, 'REOPENED', null,
    jsonb_build_object('calculation_version', v_row.calculation_version, 'reason', v_reason));
  return v_row;
end; $$;


create or replace function public.change_payroll_batch_status(p_batch_id uuid, p_new_status text, p_note text default null)
returns public.payroll_batches
language plpgsql security definer set search_path = public as $$
declare v_row public.payroll_batches; v_tier text; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.has_payroll_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_row from public.payroll_batches where id = p_batch_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status = 'CANCELLED' then raise exception 'PAYROLL_BATCH_CANCELLED' using errcode = '22000'; end if;
  if p_new_status = 'CALCULATED' and v_row.status = 'DRAFT' then raise exception 'PAYROLL_USE_CALCULATE' using errcode = '22000'; end if;
  if p_new_status = 'APPROVED' then raise exception 'PAYROLL_USE_APPROVE' using errcode = '22000'; end if;
  if v_row.status = 'APPROVED' and p_new_status = 'UNDER_REVIEW' then raise exception 'PAYROLL_USE_REOPEN' using errcode = '22000'; end if;

  select required_tier into v_tier from public.payroll_batch_transitions where from_status = v_row.status and to_status = p_new_status;
  if not found then raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000'; end if;
  if v_tier = 'ADMIN' then
    if not public.is_payroll_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  elsif v_tier = 'APPROVE' then
    if not public.can_approve_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  else
    if not public.can_create_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  end if;
  if (p_new_status = 'CANCELLED' or (v_row.status = 'UNDER_REVIEW' and p_new_status = 'CALCULATED')) and v_note is null then
    raise exception 'REASON_REQUIRED' using errcode = '22000';
  end if;
  if v_row.status = 'CALCULATED' and p_new_status = 'UNDER_REVIEW' then
    if v_row.current_calculation_id is null then raise exception 'PAYROLL_NOT_CALCULATED' using errcode = '22000'; end if;
    if cardinality(public._payroll_batch_stale(p_batch_id)) > 0 then raise exception 'PAYROLL_BATCH_STALE' using errcode = '22000'; end if;
  end if;
  if v_row.status = 'APPROVED' and p_new_status = 'CANCELLED'
     and (public._payroll_live_journal(v_row.accounting_journal_entry_id) or public._payroll_has_live_payments(p_batch_id)) then
    raise exception 'PAYROLL_REOPEN_BLOCKED' using errcode = '22000';
  end if;

  update public.payroll_batches set
    status       = p_new_status,
    status_note  = v_note,
    submitted_by = case p_new_status when 'UNDER_REVIEW' then auth.uid() when 'CALCULATED' then null else submitted_by end,
    submitted_at = case p_new_status when 'UNDER_REVIEW' then now()      when 'CALCULATED' then null else submitted_at end,
    reviewed_by  = case when p_new_status = 'CALCULATED' then null else reviewed_by end,
    reviewed_at  = case when p_new_status = 'CALCULATED' then null else reviewed_at end,
    cancelled_by = case when p_new_status = 'CANCELLED' then auth.uid() else cancelled_by end,
    cancelled_at = case when p_new_status = 'CANCELLED' then now()      else cancelled_at end,
    updated_at   = now()
   where id = p_batch_id returning * into v_row;
  return v_row;   -- tg_payroll_audit already logs the status change (whitelisted columns, no note)
end; $$;


-- ---------------------------------------------------------------------
-- Company bank/cash accounts selectable for payroll payments (bank_accounts needs accounting access).
-- No account numbers are returned.
-- ---------------------------------------------------------------------
create or replace function public.payroll_bank_accounts()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_payroll_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'kind', b.kind, 'bank_name', b.bank_name,
                                                      'account_title', b.account_title, 'currency_code', b.currency_code)
                                    order by b.account_title)
                     from public.bank_accounts b where b.is_active and b.account_id is not null), '[]'::jsonb);
end; $$;

-- ---------------------------------------------------------------------
-- Derived payment summary of an APPROVED batch (amounts as TEXT).
-- paid     = linked payments with status POSTED whose journal entry is still POSTED (a reversed journal no longer counts)
-- drafted  = linked payments still DRAFT
-- outstanding = net - paid;  available (for new drafts) = max(net - paid - drafted, 0)
-- payment_state: NONE (no link) / DRAFTED (links, nothing paid) / PARTIALLY_PAID / PAID (every result fully paid)
-- ---------------------------------------------------------------------
create or replace function public.payroll_payment_summary(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_b public.payroll_batches; v_rows jsonb; v_net numeric; v_paid numeric; v_drafted numeric; v_links bigint;
  v_all_paid boolean; v_state text; v_jstatus text;
begin
  if not public.has_payroll_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_b from public.payroll_batches where id = p_batch_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select j.status::text into v_jstatus from public.journal_entries j where j.id = v_b.accounting_journal_entry_id;

  with res as (
    select r.id, r.personnel_number, r.personnel_name, r.net
      from public.payroll_results r where r.calculation_id = v_b.approved_calculation_id
  ), pay as (
    select pp.result_id, p.id as payment_id, p.status::text as status, p.amount, pp.amount_snapshot,
           p.display_number, p.payment_date, j.status::text as j_status
      from public.payroll_payments pp
      join public.payments p on p.id = pp.payment_id
      left join public.journal_entries j on j.id = p.journal_entry_id
     where pp.batch_id = p_batch_id
  ), agg as (
    select res.id as result_id, res.personnel_number, res.personnel_name, res.net,
           coalesce(sum(pay.amount) filter (where pay.status = 'POSTED' and pay.j_status = 'POSTED'), 0) as paid,
           coalesce(sum(pay.amount) filter (where pay.status = 'DRAFT'), 0) as drafted,
           count(pay.payment_id) as n,
           coalesce(bool_or(pay.amount <> pay.amount_snapshot), false) as changed
      from res left join pay on pay.result_id = res.id
     group by res.id, res.personnel_number, res.personnel_name, res.net
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'result_id', a.result_id, 'personnel_number', a.personnel_number, 'personnel_name', a.personnel_name,
           'net', a.net::text, 'paid', a.paid::text, 'drafted', a.drafted::text,
           'outstanding', (a.net - a.paid)::text, 'available', greatest(a.net - a.paid - a.drafted, 0)::text,
           'overpaid', a.paid > a.net, 'amount_changed', a.changed,
           'payments', (select coalesce(jsonb_agg(jsonb_build_object(
                          'payment_id', y.payment_id, 'status', y.status, 'journal_status', y.j_status,
                          'display_number', y.display_number, 'payment_date', y.payment_date, 'amount', y.amount::text)
                          order by y.payment_date, y.payment_id), '[]'::jsonb)
                          from pay y where y.result_id = a.result_id))
           order by a.personnel_number), '[]'::jsonb),
         coalesce(sum(a.net), 0), coalesce(sum(a.paid), 0), coalesce(sum(a.drafted), 0), coalesce(sum(a.n), 0),
         coalesce(bool_and(a.paid >= a.net), false)
    into v_rows, v_net, v_paid, v_drafted, v_links, v_all_paid
    from agg a;

  v_state := case when v_links = 0 then 'NONE'
                  when v_all_paid then 'PAID'
                  when v_paid > 0 then 'PARTIALLY_PAID'
                  else 'DRAFTED' end;
  return jsonb_build_object(
    'payment_state', v_state, 'rows', v_rows,
    'totals', jsonb_build_object('net', v_net::text, 'paid', v_paid::text, 'drafted', v_drafted::text, 'outstanding', (v_net - v_paid)::text),
    'accounting_journal_status', v_jstatus);
end; $$;

-- ---------------------------------------------------------------------
-- Create DRAFT payments (one per item). p_items: [{result_id, amount (exact STRING)}].
-- Needs BOTH payroll-approve and accounting-create (same gate as the accounting draft).
-- ---------------------------------------------------------------------
create or replace function public.create_payroll_payment_drafts(
  p_batch_id uuid, p_bank_account_id uuid, p_payment_date date, p_method text, p_items jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_b public.payroll_batches; v_base text; v_s public.payroll_accounting_settings; v_bank public.bank_accounts;
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
  select base_currency_code into v_base from public.app_settings where id = 1;
  if v_b.currency is distinct from v_base then raise exception 'PAYROLL_CURRENCY_NOT_BASE' using errcode = '22000'; end if;

  select * into v_s from public.payroll_accounting_settings limit 1;
  if v_s.net_payable_account_id is null or not public._payroll_account_ok(v_s.net_payable_account_id) then
    raise exception 'PAYROLL_ACCOUNT_MAPPING_MISSING' using errcode = '22000';
  end if;
  select * into v_bank from public.bank_accounts where id = p_bank_account_id and is_active and account_id is not null;
  if not found then raise exception 'PAYROLL_BANK_ACCOUNT_INVALID' using errcode = '22000'; end if;
  if v_bank.currency_code is distinct from v_b.currency then raise exception 'PAYROLL_BANK_CURRENCY_MISMATCH' using errcode = '22000'; end if;
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

-- ---------------------------------------------------------------------
-- Discard the batch's DRAFT payments (and their links). POSTED payments are never touched (Accounting reverses them).
-- ---------------------------------------------------------------------
create or replace function public.discard_payroll_payment_drafts(p_batch_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_b public.payroll_batches; v_n integer := 0; v_l record;
begin
  if not public.can_approve_payroll() or not public.can_create_accounting() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select * into v_b from public.payroll_batches where id = p_batch_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  perform set_config('nil.payroll_discard', 'on', true);
  for v_l in
    select pp.id as link_id, pp.payment_id from public.payroll_payments pp join public.payments p on p.id = pp.payment_id
     where pp.batch_id = p_batch_id and p.status = 'DRAFT'
  loop
    delete from public.payroll_payments where id = v_l.link_id;
    delete from public.payments where id = v_l.payment_id;
    v_n := v_n + 1;
  end loop;
  perform set_config('nil.payroll_discard', 'off', true);

  if v_n = 0 then raise exception 'PAYROLL_NO_PAYMENTS' using errcode = '22000'; end if;
  perform public.write_log('payroll_batches', p_batch_id, 'PAYMENT_DRAFTS_DISCARDED', null, jsonb_build_object('count', v_n));
  return v_n;
end; $$;

-- =====================================================================
-- ROLLBACK: drop function if exists public.discard_payroll_payment_drafts(uuid),
--   public.create_payroll_payment_drafts(uuid,uuid,date,text,jsonb), public.payroll_payment_summary(uuid),
--   public.payroll_bank_accounts(), public._payroll_has_live_payments(uuid);
-- drop table if exists public.payroll_payments cascade; drop function if exists public.tg_payroll_payments_delete_guard();
-- then re-run 0125 (reopen_payroll_batch, change_payroll_batch_status).
-- =====================================================================

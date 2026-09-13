-- =====================================================================
-- NIL Office — 0077_cheque_functions.sql
-- Every status-changing operation on a cheque goes through one of these
-- SECURITY DEFINER RPCs — never a plain UPDATE (0078's RLS blocks that
-- once status has left DRAFT anyway). Each wrapper does its own role
-- gate, then delegates the generic "look up the transition table, apply
-- it, stamp the timestamp, write a semantic audit entry" work to the
-- private helper transition_cheque() (not granted to authenticated —
-- reachable only from inside another SECURITY DEFINER function in this
-- file, exactly like write_log() itself is never granted directly).
--
-- Accounting integration (spec §12, confirmed with the user): clear_
-- cheque() is the ONLY place this module ever touches Accounting, and it
-- only ever inserts a DRAFT payments/receipts row (method='CHEQUE') —
-- never post_journal_entry, never journal_entries directly. Mirrors
-- create_accounting_draft_from_sales_document (0063) exactly: if that
-- DRAFT row is never posted by a human, nothing else happens — same as
-- any manually-entered unposted payment/receipt today.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Cheque book lifecycle.
-- ---------------------------------------------------------------------
create or replace function public.create_cheque_book(
  p_bank_account_id uuid,
  p_book_identifier text,
  p_first_cheque_number text,
  p_last_cheque_number text,
  p_leaves_count int,
  p_issue_date date,
  p_description text default null
)
returns public.cheque_books
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.cheque_books;
begin
  if not public.can_create_cheque() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.bank_accounts where id = p_bank_account_id) then
    raise exception 'BANK_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.cheque_books
    (bank_account_id, book_identifier, first_cheque_number, last_cheque_number, leaves_count, issue_date, description, created_by)
  values
    (p_bank_account_id, p_book_identifier, p_first_cheque_number, p_last_cheque_number, p_leaves_count, p_issue_date, p_description, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.set_cheque_book_status(p_id uuid, p_status cheque_book_status)
returns public.cheque_books
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.cheque_books;
  v_old cheque_book_status;
begin
  if not public.can_approve_cheque() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_row from public.cheque_books where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_old := v_row.status;

  update public.cheque_books set status = p_status, updated_at = now()
   where id = p_id returning * into v_row;

  perform public.write_log('cheque_books', p_id, 'STATUS_CHANGED',
    jsonb_build_object('status', v_old), jsonb_build_object('status', p_status));

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Draft create/update. Counterparty snapshot is ALWAYS computed
--    server-side from companies.legal_name when a company is selected
--    (mirrors sales_documents' customer_legal_name_snapshot pattern,
--    0030) — a client-supplied name is only trusted for a free-text
--    counterparty (no companies row exists to look up).
-- ---------------------------------------------------------------------
create or replace function public.create_cheque_draft(
  p_direction cheque_direction,
  p_amount numeric,
  p_currency_code text,
  p_amount_in_words text,
  p_cheque_date date,
  p_cheque_number text,
  p_cheque_book_id uuid default null,
  p_sayad_id text default null,
  p_counterparty_company_id uuid default null,
  p_counterparty_name text default null,
  p_drawer_bank_name text default null,
  p_drawer_branch text default null,
  p_drawer_account_number text default null,
  p_purpose text default null,
  p_description text default null,
  p_company_id uuid default null,
  p_contract_id uuid default null,
  p_sales_document_id uuid default null,
  p_case_id uuid default null,
  p_project_id uuid default null
)
returns public.cheques
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot text;
  v_row public.cheques;
begin
  if not public.can_create_cheque() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = '22000';
  end if;
  if p_currency_code not in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY') then
    raise exception 'INVALID_CURRENCY' using errcode = '22000';
  end if;
  if p_cheque_number is null or length(trim(p_cheque_number)) = 0 then
    raise exception 'CHEQUE_NUMBER_REQUIRED' using errcode = '22000';
  end if;

  if p_direction = 'PAYABLE' then
    if p_cheque_book_id is null then
      raise exception 'CHEQUE_BOOK_REQUIRED' using errcode = '22000';
    end if;
    if not exists (select 1 from public.cheque_books where id = p_cheque_book_id and status = 'ACTIVE') then
      raise exception 'CHEQUE_BOOK_NOT_ACTIVE' using errcode = '22000';
    end if;
  else
    if p_drawer_bank_name is null or length(trim(p_drawer_bank_name)) = 0 then
      raise exception 'DRAWER_BANK_REQUIRED' using errcode = '22000';
    end if;
  end if;

  if p_counterparty_company_id is not null then
    select legal_name into v_snapshot from public.companies where id = p_counterparty_company_id;
    if v_snapshot is null then
      raise exception 'COMPANY_NOT_FOUND' using errcode = 'P0002';
    end if;
  else
    if p_counterparty_name is null or length(trim(p_counterparty_name)) = 0 then
      raise exception 'COUNTERPARTY_REQUIRED' using errcode = '22000';
    end if;
    v_snapshot := p_counterparty_name;
  end if;

  insert into public.cheques (
    direction, cheque_book_id, cheque_number, sayad_id,
    counterparty_company_id, counterparty_name_snapshot,
    drawer_bank_name, drawer_branch, drawer_account_number,
    amount, currency_code, amount_in_words, cheque_date, purpose, description,
    company_id, contract_id, sales_document_id, case_id, project_id,
    created_by
  ) values (
    p_direction, p_cheque_book_id, p_cheque_number, p_sayad_id,
    p_counterparty_company_id, v_snapshot,
    p_drawer_bank_name, p_drawer_branch, p_drawer_account_number,
    p_amount, p_currency_code, p_amount_in_words, p_cheque_date, p_purpose, p_description,
    p_company_id, p_contract_id, p_sales_document_id, p_case_id, p_project_id,
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.update_cheque_draft(
  p_id uuid,
  p_cheque_number text default null,
  p_sayad_id text default null,
  p_counterparty_company_id uuid default null,
  p_counterparty_name text default null,
  p_drawer_bank_name text default null,
  p_drawer_branch text default null,
  p_drawer_account_number text default null,
  p_amount numeric default null,
  p_currency_code text default null,
  p_amount_in_words text default null,
  p_cheque_date date default null,
  p_purpose text default null,
  p_description text default null
)
returns public.cheques
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.cheques;
  v_snapshot text;
begin
  if not public.can_create_cheque() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_row from public.cheques where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status <> 'DRAFT' then
    raise exception 'CHEQUE_NOT_DRAFT' using errcode = '22000';
  end if;
  if p_currency_code is not null and p_currency_code not in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY') then
    raise exception 'INVALID_CURRENCY' using errcode = '22000';
  end if;
  if p_amount is not null and p_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = '22000';
  end if;

  if p_counterparty_company_id is not null then
    select legal_name into v_snapshot from public.companies where id = p_counterparty_company_id;
    if v_snapshot is null then
      raise exception 'COMPANY_NOT_FOUND' using errcode = 'P0002';
    end if;
  elsif p_counterparty_name is not null then
    v_snapshot := p_counterparty_name;
  end if;

  update public.cheques set
    cheque_number               = coalesce(p_cheque_number, cheque_number),
    sayad_id                    = coalesce(p_sayad_id, sayad_id),
    counterparty_company_id     = coalesce(p_counterparty_company_id, counterparty_company_id),
    counterparty_name_snapshot  = coalesce(v_snapshot, counterparty_name_snapshot),
    drawer_bank_name            = coalesce(p_drawer_bank_name, drawer_bank_name),
    drawer_branch               = coalesce(p_drawer_branch, drawer_branch),
    drawer_account_number       = coalesce(p_drawer_account_number, drawer_account_number),
    amount                      = coalesce(p_amount, amount),
    currency_code               = coalesce(p_currency_code, currency_code),
    amount_in_words             = coalesce(p_amount_in_words, amount_in_words),
    cheque_date                 = coalesce(p_cheque_date, cheque_date),
    purpose                     = coalesce(p_purpose, purpose),
    description                 = coalesce(p_description, description),
    updated_at                  = now()
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. transition_cheque — private helper (no grant to authenticated).
--    Looks up cheque_status_transitions, applies the update, stamps the
--    matching timestamp column, writes one semantic audit entry. The
--    generic tg_audit trigger on `cheques` (0075) also fires its own
--    'UPDATED' row on every call here — the same intentional double-
--    logging already used by create_accounting_draft_from_sales_document
--    (0063) alongside sales_documents' own tg_audit trigger.
-- ---------------------------------------------------------------------
create or replace function public.transition_cheque(p_id uuid, p_to_status cheque_status)
returns public.cheques
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.cheques;
begin
  select * into v_row from public.cheques where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.cheque_status_transitions
     where direction = v_row.direction and from_status = v_row.status and to_status = p_to_status
  ) then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000';
  end if;

  update public.cheques set
    status       = p_to_status,
    prepared_at  = case when p_to_status = 'PREPARED'  then now() else prepared_at  end,
    issued_at    = case when p_to_status = 'ISSUED'    then now() else issued_at    end,
    delivered_at = case when p_to_status = 'DELIVERED' then now() else delivered_at end,
    received_at  = case when p_to_status = 'RECEIVED'  then now() else received_at  end,
    deposited_at = case when p_to_status = 'DEPOSITED' then now() else deposited_at end,
    cleared_at   = case when p_to_status = 'CLEARED'   then now() else cleared_at   end,
    updated_at   = now()
  where id = p_id
  returning * into v_row;

  perform public.write_log('cheques', p_id, 'STATUS_' || p_to_status::text, null, jsonb_build_object('status', p_to_status));

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. PAYABLE-only transitions.
-- ---------------------------------------------------------------------
create or replace function public.prepare_cheque(p_id uuid)
returns public.cheques
language plpgsql security definer set search_path = public as $$
declare v_direction cheque_direction;
begin
  if not public.can_create_cheque() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select direction into v_direction from public.cheques where id = p_id;
  if v_direction is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_direction <> 'PAYABLE' then raise exception 'CHEQUE_WRONG_DIRECTION' using errcode = '22000'; end if;
  return public.transition_cheque(p_id, 'PREPARED');
end; $$;

create or replace function public.issue_cheque(p_id uuid)
returns public.cheques
language plpgsql security definer set search_path = public as $$
declare v_direction cheque_direction;
begin
  if not public.can_approve_cheque() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select direction into v_direction from public.cheques where id = p_id;
  if v_direction is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_direction <> 'PAYABLE' then raise exception 'CHEQUE_WRONG_DIRECTION' using errcode = '22000'; end if;
  return public.transition_cheque(p_id, 'ISSUED');
end; $$;

create or replace function public.deliver_cheque(p_id uuid)
returns public.cheques
language plpgsql security definer set search_path = public as $$
declare v_direction cheque_direction;
begin
  if not public.can_approve_cheque() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select direction into v_direction from public.cheques where id = p_id;
  if v_direction is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_direction <> 'PAYABLE' then raise exception 'CHEQUE_WRONG_DIRECTION' using errcode = '22000'; end if;
  return public.transition_cheque(p_id, 'DELIVERED');
end; $$;

-- ---------------------------------------------------------------------
-- 5. RECEIVABLE-only transitions.
-- ---------------------------------------------------------------------
create or replace function public.receive_cheque(p_id uuid)
returns public.cheques
language plpgsql security definer set search_path = public as $$
declare v_direction cheque_direction;
begin
  if not public.can_create_cheque() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select direction into v_direction from public.cheques where id = p_id;
  if v_direction is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_direction <> 'RECEIVABLE' then raise exception 'CHEQUE_WRONG_DIRECTION' using errcode = '22000'; end if;
  return public.transition_cheque(p_id, 'RECEIVED');
end; $$;

create or replace function public.deposit_cheque(p_id uuid)
returns public.cheques
language plpgsql security definer set search_path = public as $$
declare v_direction cheque_direction;
begin
  if not public.can_approve_cheque() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select direction into v_direction from public.cheques where id = p_id;
  if v_direction is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_direction <> 'RECEIVABLE' then raise exception 'CHEQUE_WRONG_DIRECTION' using errcode = '22000'; end if;
  return public.transition_cheque(p_id, 'DEPOSITED');
end; $$;

-- ---------------------------------------------------------------------
-- 6. clear_cheque — shared by both directions, THE accounting bridge.
--    Never calls post_journal_entry; the DRAFT row it creates sits in
--    Accounting's own unposted queue exactly like any manually-entered
--    draft until a human posts it through the existing flow.
-- ---------------------------------------------------------------------
create or replace function public.clear_cheque(p_id uuid)
returns public.cheques
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.cheques;
  v_bank_account uuid;
  v_bridge_id uuid;
begin
  if not public.can_approve_cheque() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.cheques where id = p_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  v_row := public.transition_cheque(p_id, 'CLEARED');

  if v_row.direction = 'PAYABLE' then
    select bank_account_id into v_bank_account from public.cheque_books where id = v_row.cheque_book_id;
    insert into public.payments
      (payment_date, payee, amount, currency_code, bank_account_id, method, reference, description,
       company_id, case_id, contract_id, sales_document_id, status, created_by)
    values
      (current_date, v_row.counterparty_name_snapshot, v_row.amount, v_row.currency_code, v_bank_account,
       'CHEQUE', v_row.display_number, v_row.purpose, v_row.company_id, v_row.case_id, v_row.contract_id,
       v_row.sales_document_id, 'DRAFT', auth.uid())
    returning id into v_bridge_id;
    update public.cheques set payment_id = v_bridge_id, updated_at = now() where id = p_id;
  else
    insert into public.receipts
      (receipt_date, payer, amount, currency_code, method, reference, description,
       company_id, case_id, contract_id, sales_document_id, status, created_by)
    values
      (current_date, v_row.counterparty_name_snapshot, v_row.amount, v_row.currency_code,
       'CHEQUE', v_row.display_number, v_row.purpose, v_row.company_id, v_row.case_id, v_row.contract_id,
       v_row.sales_document_id, 'DRAFT', auth.uid())
    returning id into v_bridge_id;
    update public.cheques set receipt_id = v_bridge_id, updated_at = now() where id = p_id;
  end if;

  perform public.write_log('cheques', p_id, 'ACCOUNTING_DRAFT_CREATED',
    null, jsonb_build_object('direction', v_row.direction, 'bridge_id', v_bridge_id));

  select * into v_row from public.cheques where id = p_id;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Returned / Void / Cancelled — VOID is PAYABLE-only (spec: a
--    RECEIVABLE cheque isn't ours to void; a data-entry mistake there
--    uses cancel_cheque instead). Number never reused: the unique index
--    on (cheque_book_id, cheque_number) still holds for a VOID row.
-- ---------------------------------------------------------------------
create or replace function public.mark_cheque_returned(p_id uuid, p_reason text)
returns public.cheques
language plpgsql security definer set search_path = public as $$
declare v_row public.cheques;
begin
  if not public.can_approve_cheque() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'REASON_REQUIRED' using errcode = '22000'; end if;

  v_row := public.transition_cheque(p_id, 'RETURNED');
  update public.cheques set return_reason = p_reason, updated_at = now() where id = p_id returning * into v_row;
  perform public.write_log('cheques', p_id, 'RETURNED', null, jsonb_build_object('reason', p_reason));
  return v_row;
end; $$;

create or replace function public.void_cheque(p_id uuid, p_reason text)
returns public.cheques
language plpgsql security definer set search_path = public as $$
declare v_row public.cheques;
begin
  if not public.can_approve_cheque() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'REASON_REQUIRED' using errcode = '22000'; end if;

  select * into v_row from public.cheques where id = p_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.direction <> 'PAYABLE' then raise exception 'CHEQUE_WRONG_DIRECTION' using errcode = '22000'; end if;

  v_row := public.transition_cheque(p_id, 'VOID');
  update public.cheques set void_reason = p_reason, updated_at = now() where id = p_id returning * into v_row;
  perform public.write_log('cheques', p_id, 'VOIDED', null, jsonb_build_object('reason', p_reason));
  return v_row;
end; $$;

create or replace function public.cancel_cheque(p_id uuid, p_reason text default null)
returns public.cheques
language plpgsql security definer set search_path = public as $$
declare v_row public.cheques;
begin
  if not public.can_create_cheque() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  v_row := public.transition_cheque(p_id, 'CANCELLED');
  update public.cheques set cancel_reason = p_reason, updated_at = now() where id = p_id returning * into v_row;
  perform public.write_log('cheques', p_id, 'CANCELLED', null, jsonb_build_object('reason', p_reason));
  return v_row;
end; $$;

-- ---------------------------------------------------------------------
-- 8. record_cheque_print — PAYABLE only. A test print touches nothing
--    but the audit log (spec: must never change status/count). A real
--    print of an ISSUED+ cheque requires can_approve_cheque() (the
--    "reprint" permission tier) and logs a distinguished action so the
--    "strong warning + permission + audit" requirement has a queryable
--    signal, not just a bumped counter.
-- ---------------------------------------------------------------------
create or replace function public.record_cheque_print(p_id uuid, p_is_test_print boolean, p_template_id uuid default null)
returns public.cheques
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.cheques;
begin
  select * into v_row from public.cheques where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.direction <> 'PAYABLE' then
    raise exception 'CHEQUE_WRONG_DIRECTION' using errcode = '22000';
  end if;

  if p_is_test_print then
    if not public.can_create_cheque() then
      raise exception 'NOT_AUTHORIZED' using errcode = '42501';
    end if;
    perform public.write_log('cheques', p_id, 'TEST_PRINTED', null, jsonb_build_object('template_id', p_template_id));
    return v_row;
  end if;

  if v_row.status >= 'ISSUED'::cheque_status then
    if not public.can_approve_cheque() then
      raise exception 'NOT_AUTHORIZED' using errcode = '42501';
    end if;
    update public.cheques set
      print_count = print_count + 1,
      last_printed_at = now(),
      first_printed_at = coalesce(first_printed_at, now()),
      printed_by = auth.uid(),
      print_template_id = coalesce(p_template_id, print_template_id),
      updated_at = now()
    where id = p_id
    returning * into v_row;
    perform public.write_log('cheques', p_id, 'REPRINT_ISSUED_CHEQUE',
      null, jsonb_build_object('template_id', p_template_id, 'print_count', v_row.print_count));
    return v_row;
  end if;

  if not public.can_create_cheque() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  update public.cheques set
    print_count = print_count + 1,
    last_printed_at = now(),
    first_printed_at = coalesce(first_printed_at, now()),
    printed_by = auth.uid(),
    print_template_id = coalesce(p_template_id, print_template_id),
    updated_at = now()
  where id = p_id
  returning * into v_row;
  perform public.write_log('cheques', p_id, 'PRINTED',
    null, jsonb_build_object('template_id', p_template_id, 'print_count', v_row.print_count));
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Grants — every wrapper above to `authenticated` (RLS + can_*/is_*
--    checks still gate what actually happens); transition_cheque is
--    intentionally NOT granted — reachable only from inside these.
-- ---------------------------------------------------------------------
grant execute on function public.create_cheque_book(uuid, text, text, text, int, date, text) to authenticated;
grant execute on function public.set_cheque_book_status(uuid, cheque_book_status) to authenticated;
grant execute on function public.create_cheque_draft(
  cheque_direction, numeric, text, text, date, text, uuid, text, uuid, text, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid
) to authenticated;
grant execute on function public.update_cheque_draft(
  uuid, text, text, uuid, text, text, text, text, numeric, text, text, date, text, text
) to authenticated;
grant execute on function public.prepare_cheque(uuid) to authenticated;
grant execute on function public.issue_cheque(uuid) to authenticated;
grant execute on function public.deliver_cheque(uuid) to authenticated;
grant execute on function public.receive_cheque(uuid) to authenticated;
grant execute on function public.deposit_cheque(uuid) to authenticated;
grant execute on function public.clear_cheque(uuid) to authenticated;
grant execute on function public.mark_cheque_returned(uuid, text) to authenticated;
grant execute on function public.void_cheque(uuid, text) to authenticated;
grant execute on function public.cancel_cheque(uuid, text) to authenticated;
grant execute on function public.record_cheque_print(uuid, boolean, uuid) to authenticated;

-- =====================================================================
-- ROLLBACK
-- ---------------------------------------------------------------------
-- drop function if exists public.record_cheque_print(uuid, boolean, uuid);
-- drop function if exists public.cancel_cheque(uuid, text);
-- drop function if exists public.void_cheque(uuid, text);
-- drop function if exists public.mark_cheque_returned(uuid, text);
-- drop function if exists public.clear_cheque(uuid);
-- drop function if exists public.deposit_cheque(uuid);
-- drop function if exists public.receive_cheque(uuid);
-- drop function if exists public.deliver_cheque(uuid);
-- drop function if exists public.issue_cheque(uuid);
-- drop function if exists public.prepare_cheque(uuid);
-- drop function if exists public.transition_cheque(uuid, cheque_status);
-- drop function if exists public.update_cheque_draft(uuid, text, text, uuid, text, text, text, text, numeric, text, text, date, text, text);
-- drop function if exists public.create_cheque_draft(cheque_direction, numeric, text, text, date, text, uuid, text, uuid, text, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid);
-- drop function if exists public.set_cheque_book_status(uuid, cheque_book_status);
-- drop function if exists public.create_cheque_book(uuid, text, text, text, int, date, text);
-- =====================================================================

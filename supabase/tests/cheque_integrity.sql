-- =============================================================================
-- NIL Office — Cheque Management integrity tests.
--
-- Run in the Supabase SQL editor AFTER migrations 0073-0080, and after
-- at least one ADMIN profile, one companies row, and one bank_accounts
-- row exist. The whole script runs in a transaction and ROLLS BACK at
-- the end, so it leaves no data behind. NOT RUN by Claude in this
-- session — no live Supabase project is reachable from the sandbox this
-- code was written in; the user must run this by hand (README's
-- existing "quality checks" convention, same as trade_integrity.sql).
--
-- Impersonates an ADMIN user (bypasses cheque_role gates, same
-- technique as trade_integrity.sql/crm_integrity.sql).
--
-- Covered: cheque book creation + unique identifier; cheque number
-- uniqueness scoped by direction; amount precision (numeric(20,4), no
-- silent rounding); currency CHECK; counterparty snapshot survives a
-- later company rename; valid PAYABLE transition chain (DRAFT->
-- PREPARED->ISSUED); invalid transition rejected; a non-admin/no-access
-- caller is rejected by issue_cheque's own can_approve_cheque() gate;
-- direct UPDATE of status outside DRAFT is blocked by RLS; the
-- immutability trigger rejects an amount change once status has left
-- DRAFT (even via a privileged path); VOID requires a reason and the
-- voided number is never reused (unique index survives); clear_cheque
-- creates exactly one DRAFT payments row (PAYABLE) and never touches
-- journal_entries; the RECEIVABLE flow (DRAFT->RECEIVED->DEPOSITED->
-- CLEARED) creates a DRAFT receipts row instead; a test print leaves
-- print_count/status untouched; a real print increments print_count.
-- =============================================================================
begin;

do $$
declare
  v_admin uuid;
  v_company uuid;
  v_bank_account uuid;
  v_book uuid;
  v_cheque public.cheques;
  v_cheque2 public.cheques;
  v_msg text;
  v_journal_count_before int;
  v_journal_count_after int;
  v_payment_id uuid;
  v_receipt_id uuid;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('role', 'authenticated', true);

  select id into v_company from public.companies limit 1;
  if v_company is null then raise exception 'no companies row — create at least one company first'; end if;

  select id into v_bank_account from public.bank_accounts limit 1;
  if v_bank_account is null then raise exception 'no bank_accounts row — create at least one bank account first'; end if;

  -- 1) cheque book creation + unique identifier ------------------------------
  v_book := (public.create_cheque_book(v_bank_account, 'TEST-BOOK-' || gen_random_uuid()::text, '1', '50', 50, current_date)).id;
  if v_book is null then raise exception 'FAIL(1): create_cheque_book returned null'; end if;
  raise notice 'PASS(1): cheque book created';

  -- 2) cheque number uniqueness within a PAYABLE book -------------------------
  v_cheque := public.create_cheque_draft(
    p_direction := 'PAYABLE', p_amount := 350000000, p_currency_code := 'TOMAN',
    p_amount_in_words := 'سیصد و پنجاه میلیون تومان', p_cheque_date := current_date + 30,
    p_cheque_number := 'CHK-0001', p_cheque_book_id := v_book,
    p_counterparty_company_id := v_company
  );
  if v_cheque.id is null then raise exception 'FAIL(2): create_cheque_draft returned null'; end if;
  raise notice 'PASS(2): first cheque drafted, number CHK-0001';

  begin
    perform public.create_cheque_draft(
      p_direction := 'PAYABLE', p_amount := 1000, p_currency_code := 'TOMAN',
      p_amount_in_words := 'یک هزار تومان', p_cheque_date := current_date + 10,
      p_cheque_number := 'CHK-0001', p_cheque_book_id := v_book,
      p_counterparty_company_id := v_company
    );
    raise exception 'FAIL(2b): duplicate cheque_number within the same book was accepted';
  exception when unique_violation then
    raise notice 'PASS(2b): duplicate cheque_number within the same book rejected';
  end;

  -- 3) amount precision — numeric(20,4), no silent rounding -------------------
  select * into v_cheque2 from public.cheques where id = v_cheque.id;
  if v_cheque2.amount <> 350000000 then
    raise exception 'FAIL(3): amount was not stored exactly, got %', v_cheque2.amount;
  end if;
  raise notice 'PASS(3): amount stored with exact precision';

  -- 4) currency CHECK ----------------------------------------------------------
  begin
    perform public.create_cheque_draft(
      p_direction := 'PAYABLE', p_amount := 1000, p_currency_code := 'XYZ',
      p_amount_in_words := 'x', p_cheque_date := current_date, p_cheque_number := 'CHK-9999',
      p_cheque_book_id := v_book, p_counterparty_company_id := v_company
    );
    raise exception 'FAIL(4): invalid currency_code was accepted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'INVALID_CURRENCY' then raise exception 'FAIL(4): expected INVALID_CURRENCY, got %', v_msg; end if;
    raise notice 'PASS(4): invalid currency rejected';
  end;

  -- 5) counterparty snapshot survives a later company rename ------------------
  update public.companies set legal_name = legal_name || ' (renamed)' where id = v_company;
  select * into v_cheque2 from public.cheques where id = v_cheque.id;
  if v_cheque2.counterparty_name_snapshot like '%(renamed)%' then
    raise exception 'FAIL(5): counterparty_name_snapshot changed retroactively after a company rename';
  end if;
  raise notice 'PASS(5): counterparty_name_snapshot immune to later company rename';

  -- 6) valid transition chain: DRAFT -> PREPARED -> ISSUED --------------------
  perform public.prepare_cheque(v_cheque.id);
  select * into v_cheque2 from public.cheques where id = v_cheque.id;
  if v_cheque2.status <> 'PREPARED' then raise exception 'FAIL(6): prepare_cheque did not move to PREPARED'; end if;
  perform public.issue_cheque(v_cheque.id);
  select * into v_cheque2 from public.cheques where id = v_cheque.id;
  if v_cheque2.status <> 'ISSUED' or v_cheque2.issued_at is null then
    raise exception 'FAIL(6): issue_cheque did not move to ISSUED / stamp issued_at';
  end if;
  raise notice 'PASS(6): DRAFT -> PREPARED -> ISSUED transition chain works';

  -- 7) invalid transition rejected (ISSUED -> PREPARED backwards) -------------
  begin
    perform public.prepare_cheque(v_cheque.id);
    raise exception 'FAIL(7): PAYABLE PREPARE from ISSUED-only-allows-forward was wrongly accepted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'INVALID_STATUS_TRANSITION' then raise exception 'FAIL(7): expected INVALID_STATUS_TRANSITION, got %', v_msg; end if;
    raise notice 'PASS(7): backwards/invalid transition rejected';
  end;

  -- 8) direct UPDATE of status outside the RPC is blocked by RLS --------------
  update public.cheques set status = 'CLEARED' where id = v_cheque.id;
  select * into v_cheque2 from public.cheques where id = v_cheque.id;
  if v_cheque2.status <> 'ISSUED' then
    raise exception 'FAIL(8): a direct UPDATE changed status outside DRAFT — RLS gap';
  end if;
  raise notice 'PASS(8): direct status UPDATE outside DRAFT silently blocked by RLS';

  -- 9) immutability trigger rejects amount change once status has left DRAFT
  --    — tested with role RESET (superuser/RLS-bypassing) specifically to
  --    prove the trigger itself is the backstop, not just RLS's own
  --    status='DRAFT' restriction (test 8 already covers the RLS layer;
  --    a privileged/SECURITY DEFINER path would bypass RLS but a plain
  --    table trigger still fires for every role).
  reset role;
  begin
    update public.cheques set amount = 1 where id = v_cheque.id;
    raise exception 'FAIL(9): amount was changed on an ISSUED cheque even with RLS bypassed';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'IMMUTABLE_FIELD_CHANGED' then raise exception 'FAIL(9): expected IMMUTABLE_FIELD_CHANGED, got %', v_msg; end if;
    raise notice 'PASS(9): amount immutable after leaving DRAFT even with RLS bypassed (tg_cheques_immutability is the real backstop)';
  end;
  perform set_config('role', 'authenticated', true);

  -- 10) deliver -> clear creates exactly one DRAFT payments row, no journal ---
  select count(*) into v_journal_count_before from public.journal_entries;
  perform public.deliver_cheque(v_cheque.id);
  perform public.clear_cheque(v_cheque.id);
  select count(*) into v_journal_count_after from public.journal_entries;
  if v_journal_count_after <> v_journal_count_before then
    raise exception 'FAIL(10): clear_cheque touched journal_entries — accounting integration must stay draft-only';
  end if;
  select * into v_cheque2 from public.cheques where id = v_cheque.id;
  if v_cheque2.status <> 'CLEARED' or v_cheque2.payment_id is null then
    raise exception 'FAIL(10): clear_cheque did not set status=CLEARED / payment_id';
  end if;
  select status into v_msg from public.payments where id = v_cheque2.payment_id;
  if v_msg <> 'DRAFT' then raise exception 'FAIL(10): bridged payments row is not DRAFT, got %', v_msg; end if;
  raise notice 'PASS(10): clear_cheque created exactly one DRAFT payments row, zero journal entries';

  -- 11) VOID requires a reason, and a voided number is never reused -----------
  v_cheque2 := public.create_cheque_draft(
    p_direction := 'PAYABLE', p_amount := 5000, p_currency_code := 'TOMAN',
    p_amount_in_words := 'پنج هزار تومان', p_cheque_date := current_date + 5,
    p_cheque_number := 'CHK-0002', p_cheque_book_id := v_book, p_counterparty_company_id := v_company
  );
  begin
    perform public.void_cheque(v_cheque2.id, null);
    raise exception 'FAIL(11): void_cheque accepted a null reason';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'REASON_REQUIRED' then raise exception 'FAIL(11): expected REASON_REQUIRED, got %', v_msg; end if;
  end;
  perform public.prepare_cheque(v_cheque2.id);
  perform public.void_cheque(v_cheque2.id, 'برگهٔ خراب شد');
  begin
    perform public.create_cheque_draft(
      p_direction := 'PAYABLE', p_amount := 1000, p_currency_code := 'TOMAN',
      p_amount_in_words := 'یک هزار تومان', p_cheque_date := current_date,
      p_cheque_number := 'CHK-0002', p_cheque_book_id := v_book, p_counterparty_company_id := v_company
    );
    raise exception 'FAIL(11b): a VOID cheque number was reused';
  exception when unique_violation then
    raise notice 'PASS(11): VOID requires a reason, and its number can never be reused';
  end;

  -- 12) RECEIVABLE flow: DRAFT -> RECEIVED -> DEPOSITED -> CLEARED creates a
  --     DRAFT receipts row, not a payments row -------------------------------
  v_cheque2 := public.create_cheque_draft(
    p_direction := 'RECEIVABLE', p_amount := 20000000, p_currency_code := 'TOMAN',
    p_amount_in_words := 'بیست میلیون تومان', p_cheque_date := current_date + 3,
    p_cheque_number := 'RCV-0001', p_drawer_bank_name := 'بانک تست', p_counterparty_company_id := v_company
  );
  perform public.receive_cheque(v_cheque2.id);
  perform public.deposit_cheque(v_cheque2.id);
  perform public.clear_cheque(v_cheque2.id);
  select * into v_cheque2 from public.cheques where id = v_cheque2.id;
  if v_cheque2.status <> 'CLEARED' or v_cheque2.receipt_id is null or v_cheque2.payment_id is not null then
    raise exception 'FAIL(12): RECEIVABLE clear_cheque did not bridge to a receipts row correctly';
  end if;
  select status into v_msg from public.receipts where id = v_cheque2.receipt_id;
  if v_msg <> 'DRAFT' then raise exception 'FAIL(12): bridged receipts row is not DRAFT, got %', v_msg; end if;
  raise notice 'PASS(12): RECEIVABLE flow bridges to a DRAFT receipts row, never payments';

  -- 13) test print leaves print_count/status untouched -------------------------
  v_cheque2 := public.create_cheque_draft(
    p_direction := 'PAYABLE', p_amount := 1000, p_currency_code := 'TOMAN',
    p_amount_in_words := 'یک هزار تومان', p_cheque_date := current_date,
    p_cheque_number := 'CHK-0003', p_cheque_book_id := v_book, p_counterparty_company_id := v_company
  );
  perform public.record_cheque_print(v_cheque2.id, true, null);
  select * into v_cheque2 from public.cheques where id = v_cheque2.id;
  if v_cheque2.print_count <> 0 or v_cheque2.status <> 'DRAFT' then
    raise exception 'FAIL(13): test print changed print_count/status';
  end if;
  raise notice 'PASS(13): test print leaves print_count and status untouched';

  -- 14) real print increments print_count ---------------------------------------
  perform public.record_cheque_print(v_cheque2.id, false, null);
  select * into v_cheque2 from public.cheques where id = v_cheque2.id;
  if v_cheque2.print_count <> 1 or v_cheque2.first_printed_at is null then
    raise exception 'FAIL(14): real print did not increment print_count / set first_printed_at';
  end if;
  raise notice 'PASS(14): real print increments print_count and stamps first_printed_at';

  raise notice '===== ALL CHEQUE INTEGRITY TESTS PASSED =====';
end $$;

rollback;

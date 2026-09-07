-- =============================================================================
-- NIL Office — Invoice/Proforma Phase 2 & 3 integrity tests.
--
-- Run in the Supabase SQL editor AFTER migrations 0061-0064, after
-- configuring app_settings.default_ar_account_id/default_sales_revenue_account_id,
-- and after at least one ADMIN profile, one companies row, and one
-- active bank_accounts row exist. Runs in a transaction and ROLLS BACK
-- at the end, so it leaves no data behind.
--
-- Covered: bank account snapshot is copied atomically on finalize and
-- stays fixed after the bank_accounts row is later edited;
-- create_accounting_draft_from_sales_document rejects a PROFORMA,
-- rejects a second draft for the same invoice, rejects when defaults
-- aren't configured; the created journal entry is DRAFT with two
-- balanced lines; posting a POSTED receipt for less than the total
-- moves ISSUED->PARTIALLY_SETTLED; posting enough moves it to SETTLED;
-- a SETTLED invoice is not moved back down if a receipt is deleted.
-- =============================================================================
begin;

do $$
declare
  v_admin uuid;
  v_company uuid;
  v_bank uuid;
  v_fy uuid;
  v_ar uuid;
  v_rev uuid;
  v_doc uuid;
  v_doc2 uuid;
  v_num text;
  v_entry uuid;
  v_bank_title_before text;
  v_bank_title_after text;
  v_receipt uuid;
  v_msg text;
  v_saved_ar uuid;
  v_saved_rev uuid;
  v_debit numeric(20,4);
  v_credit numeric(20,4);
  v_status text;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('role', 'authenticated', true);

  select id into v_company from public.companies limit 1;
  if v_company is null then raise exception 'no companies row — create at least one company first'; end if;

  select id into v_bank from public.bank_accounts where is_active limit 1;
  if v_bank is null then raise exception 'no active bank_accounts row — create at least one first'; end if;

  select id into v_fy from public.fiscal_years where status = 'OPEN' and start_date <= current_date and end_date >= current_date limit 1;
  if v_fy is null then raise exception 'no OPEN fiscal year covering today — create one first'; end if;

  select default_ar_account_id, default_sales_revenue_account_id into v_saved_ar, v_saved_rev from public.app_settings where id = 1;

  -- 1) bank account snapshot copied atomically on finalize, frozen thereafter
  select account_title into v_bank_title_before from public.bank_accounts where id = v_bank;

  insert into public.sales_documents (type, status, company_id, bank_account_id, customer_legal_name_snapshot, created_by)
  values ('INVOICE', 'DRAFT', v_company, v_bank, 'مشتری تست فاز ۲', v_admin)
  returning id into v_doc;
  insert into public.sales_document_items (sales_document_id, line_no, description, quantity, unit_price)
  values (v_doc, 1, 'ردیف تست', 1, 100000000);

  update public.sales_documents set status = 'REVIEW' where id = v_doc;
  update public.sales_documents set status = 'APPROVED' where id = v_doc;
  select display_number into v_num from public.finalize_sales_document(v_doc);
  if (select bank_account_title_snapshot from public.sales_documents where id = v_doc) is distinct from v_bank_title_before then
    raise exception 'FAIL(1): bank snapshot not copied correctly on finalize';
  end if;

  update public.bank_accounts set account_title = account_title || ' (ویرایش‌شده)' where id = v_bank;
  select bank_account_title_snapshot into v_bank_title_after from public.sales_documents where id = v_doc;
  if v_bank_title_after <> v_bank_title_before then
    raise exception 'FAIL(1b): bank snapshot changed after editing bank_accounts — PDF immutability broken';
  end if;
  raise notice 'PASS(1): bank account snapshot copied on finalize and stays fixed thereafter (%)', v_num;

  -- 2) create_accounting_draft_from_sales_document rejects when defaults not configured
  update public.app_settings set default_ar_account_id = null, default_sales_revenue_account_id = null where id = 1;
  begin
    perform public.create_accounting_draft_from_sales_document(v_doc);
    raise exception 'FAIL(2): draft created without configured defaults';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'ACCOUNTING_DEFAULTS_NOT_CONFIGURED' then raise exception 'FAIL(2): expected ACCOUNTING_DEFAULTS_NOT_CONFIGURED, got %', v_msg; end if;
    raise notice 'PASS(2): draft creation rejected without configured defaults';
  end;

  select id into v_ar  from public.accounts where allows_posting and is_active and account_type = 'ASSET'   limit 1;
  select id into v_rev from public.accounts where allows_posting and is_active and account_type = 'REVENUE' limit 1;
  if v_ar is null or v_rev is null then raise exception 'no posting-eligible ASSET/REVENUE account found — check seed chart of accounts'; end if;
  update public.app_settings set default_ar_account_id = v_ar, default_sales_revenue_account_id = v_rev where id = 1;

  -- 3) rejects a PROFORMA
  insert into public.sales_documents (type, status, company_id, customer_legal_name_snapshot, created_by)
  values ('PROFORMA', 'ISSUED', v_company, 'مشتری پیش‌فاکتور', v_admin)
  returning id into v_doc2;
  begin
    perform public.create_accounting_draft_from_sales_document(v_doc2);
    raise exception 'FAIL(3): draft created for a PROFORMA';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'NOT_ELIGIBLE' then raise exception 'FAIL(3): expected NOT_ELIGIBLE, got %', v_msg; end if;
    raise notice 'PASS(3): draft creation rejected for a PROFORMA';
  end;

  -- 4) happy path: DRAFT journal entry with two balanced lines
  v_entry := public.create_accounting_draft_from_sales_document(v_doc);
  select status into v_status from public.journal_entries where id = v_entry;
  if v_status <> 'DRAFT' then raise exception 'FAIL(4): created entry is not DRAFT'; end if;
  select sum(debit), sum(credit) into v_debit, v_credit from public.journal_entry_lines where journal_entry_id = v_entry;
  if v_debit <> v_credit or v_debit <> 100000000 then raise exception 'FAIL(4b): lines not balanced/correct amount (debit=%, credit=%)', v_debit, v_credit; end if;
  if (select accounting_journal_entry_id from public.sales_documents where id = v_doc) <> v_entry then
    raise exception 'FAIL(4c): sales_documents.accounting_journal_entry_id not stamped';
  end if;
  raise notice 'PASS(4): accounting draft created — DRAFT entry, balanced lines';

  -- 5) rejects a second draft for the same invoice
  begin
    perform public.create_accounting_draft_from_sales_document(v_doc);
    raise exception 'FAIL(5): a second draft was created for the same invoice';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'ACCOUNTING_DRAFT_ALREADY_EXISTS' then raise exception 'FAIL(5): expected ACCOUNTING_DRAFT_ALREADY_EXISTS, got %', v_msg; end if;
    raise notice 'PASS(5): duplicate draft creation rejected';
  end;

  -- 6) settlement: partial receipt -> PARTIALLY_SETTLED
  insert into public.receipts (receipt_date, amount, sales_document_id, fiscal_year_id, status, created_by)
  values (current_date, 40000000, v_doc, v_fy, 'POSTED', v_admin)
  returning id into v_receipt;
  if (select status from public.sales_documents where id = v_doc) <> 'PARTIALLY_SETTLED' then
    raise exception 'FAIL(6): status did not auto-derive to PARTIALLY_SETTLED';
  end if;
  raise notice 'PASS(6): partial POSTED receipt auto-derived PARTIALLY_SETTLED';

  -- 7) settlement: remainder -> SETTLED
  insert into public.receipts (receipt_date, amount, sales_document_id, fiscal_year_id, status, created_by)
  values (current_date, 60000000, v_doc, v_fy, 'POSTED', v_admin);
  if (select status from public.sales_documents where id = v_doc) <> 'SETTLED' then
    raise exception 'FAIL(7): status did not auto-derive to SETTLED';
  end if;
  raise notice 'PASS(7): remaining POSTED receipt auto-derived SETTLED';

  -- 8) SETTLED is terminal — deleting a receipt does not de-escalate it
  delete from public.receipts where id = v_receipt;
  if (select status from public.sales_documents where id = v_doc) <> 'SETTLED' then
    raise exception 'FAIL(8): SETTLED status was de-escalated after a receipt was removed';
  end if;
  raise notice 'PASS(8): SETTLED status stays terminal even after a receipt is removed';

  -- restore whatever defaults existed before this test ran
  update public.app_settings set default_ar_account_id = v_saved_ar, default_sales_revenue_account_id = v_saved_rev where id = 1;

  raise notice '===== ALL INVOICE PHASE 2/3 INTEGRITY TESTS PASSED =====';
end $$;

rollback;

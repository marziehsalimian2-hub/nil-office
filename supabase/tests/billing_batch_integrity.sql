-- =============================================================================
-- NIL Office — Client Service Ledger Phase 2 (Billing Integration) integrity
-- tests. Run in the Supabase SQL editor AFTER migrations 0087-0090, and
-- after at least one ADMIN profile, one companies row, and the seeded
-- service_categories exist. Runs in a transaction and ROLLS BACK at the
-- end, so it leaves no data behind.
--
-- Covered: billing_status CHECK-replacement adjacency trigger rejects a
-- direct INVOICED write with no batch; double-billing rejection;
-- currency-mismatch rejection; batch-not-editable-once-READY rejection;
-- the full happy path (mark ready -> batch -> convert -> INVOICED,
-- correct total, no double-counted expense); cancelling the resulting
-- sales_document reverts the batch and its source rows.
-- =============================================================================
begin;

do $$
declare
  v_admin    uuid;
  v_company  uuid;
  v_file     uuid;
  v_category uuid;
  v_entry    uuid;
  v_entry2   uuid;
  v_expense  uuid;
  v_batch    uuid;
  v_item1    uuid;
  v_doc      record;
  v_msg      text;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('role', 'authenticated', true);

  select id into v_company from public.companies limit 1;
  if v_company is null then raise exception 'no companies row — create at least one company first'; end if;

  select id into v_category from public.service_categories limit 1;
  if v_category is null then raise exception 'no service_categories row — migration 0084 should have seeded these'; end if;

  insert into public.client_service_files (company_id, created_by) values (v_company, v_admin) returning id into v_file;

  -- 1) direct billing_status='INVOICED' write with no batch is rejected --
  insert into public.service_entries (client_service_file_id, service_category_id, service_date, title, performed_by, created_by, service_fee)
  values (v_file, v_category, current_date, 'خدمت تست فاز ۲', v_admin, v_admin, 1000000)
  returning id into v_entry;

  update public.service_entries set billing_status = 'BILLABLE' where id = v_entry;

  begin
    update public.service_entries set billing_status = 'INVOICED' where id = v_entry;
    raise exception 'FAIL(1): direct BILLABLE -> INVOICED (no batch) was accepted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'USE_BILLING_BATCH_TO_INVOICE' then raise exception 'FAIL(1): expected USE_BILLING_BATCH_TO_INVOICE, got %', v_msg; end if;
    raise notice 'PASS(1): direct billing_status=INVOICED (no batch) rejected';
  end;

  -- 2) BILLABLE -> READY_TO_BILL happy path, plus a second entry + an expense
  update public.service_entries set billing_status = 'READY_TO_BILL' where id = v_entry;

  insert into public.time_entries (service_entry_id, performed_by, work_date, duration_minutes, billable, hourly_rate_snapshot, created_by)
  values (v_entry, v_admin, current_date, 120, true, 500000, v_admin);

  insert into public.expenses (service_entry_id, expense_date, description, amount, is_reimbursable, reimbursable_amount, created_by)
  values (v_entry, current_date, 'هزینهٔ تست فاز ۲', 200000, true, 200000, v_admin)
  returning id into v_expense;
  update public.expenses set billing_status = 'BILLABLE' where id = v_expense;
  update public.expenses set billing_status = 'READY_TO_BILL' where id = v_expense;

  insert into public.service_entries (client_service_file_id, service_category_id, service_date, title, performed_by, created_by, service_fee)
  values (v_file, v_category, current_date, 'خدمت دوم تست', v_admin, v_admin, 0)
  returning id into v_entry2;

  raise notice 'PASS(2): fixture built (entry with fee+time+expense, second entry with no fee)';

  -- 3) build a batch, add the three granular lines ------------------------
  insert into public.billing_batches (client_service_file_id, currency, created_by)
  values (v_file, 'IRR', v_admin)
  returning id into v_batch;

  insert into public.billing_batch_items (batch_id, source_type, source_id, description, amount, currency, line_no)
  values (v_batch, 'SERVICE_ENTRY', v_entry, 'حق‌الزحمه', 1000000, 'IRR', 1)
  returning id into v_item1;
  insert into public.billing_batch_items (batch_id, source_type, source_id, description, amount, currency, line_no)
  values (v_batch, 'TIME_ENTRY', v_entry, 'زمان', 1000000, 'IRR', 2);
  insert into public.billing_batch_items (batch_id, source_type, source_id, description, amount, currency, line_no)
  values (v_batch, 'EXPENSE', v_expense, 'هزینه', 200000, 'IRR', 3);

  if (select total_amount from public.billing_batches where id = v_batch) <> 2200000 then
    raise exception 'FAIL(3): expected batch total_amount=2200000, got %', (select total_amount from public.billing_batches where id = v_batch);
  end if;
  raise notice 'PASS(3): batch rollup total is correct (2,200,000 — no double-counted expense)';

  -- 4) double-billing rejected ---------------------------------------------
  begin
    insert into public.billing_batch_items (batch_id, source_type, source_id, description, amount, currency, line_no)
    values (v_batch, 'SERVICE_ENTRY', v_entry, 'دوباره همون ردیف', 1000000, 'IRR', 4);
    raise exception 'FAIL(4): re-adding the same (source_type, source_id) to a batch was accepted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'DOUBLE_BILLING' then raise exception 'FAIL(4): expected DOUBLE_BILLING, got %', v_msg; end if;
    raise notice 'PASS(4): double-billing rejected';
  end;

  -- 5) currency mismatch rejected -------------------------------------------
  begin
    insert into public.billing_batch_items (batch_id, source_type, source_id, description, amount, currency, line_no)
    values (v_batch, 'EXPENSE', v_expense, 'ارز اشتباه', 10, 'USD', 5);
    raise exception 'FAIL(5): a currency-mismatched item was accepted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'CURRENCY_MISMATCH' then raise exception 'FAIL(5): expected CURRENCY_MISMATCH, got %', v_msg; end if;
    raise notice 'PASS(5): currency mismatch rejected';
  end;

  -- 6) mark READY, then batch is no longer editable -------------------------
  update public.billing_batches set status = 'READY' where id = v_batch;
  begin
    insert into public.billing_batch_items (batch_id, source_type, source_id, description, amount, currency, line_no)
    values (v_batch, 'MANUAL_ADJUSTMENT', null, 'دیرشده', 1, 'IRR', 6);
    raise exception 'FAIL(6): an item was added to a non-DRAFT batch';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'BATCH_NOT_EDITABLE' then raise exception 'FAIL(6): expected BATCH_NOT_EDITABLE, got %', v_msg; end if;
    raise notice 'PASS(6): item insert into a non-DRAFT batch rejected';
  end;

  -- 7) convert to a real sales_document, confirm cascade --------------------
  select * into v_doc from public.convert_billing_batch_to_sales_document(v_batch, 'INVOICE');
  if v_doc.status <> 'DRAFT' or v_doc.type <> 'INVOICE' then
    raise exception 'FAIL(7): unexpected conversion result status=% type=%', v_doc.status, v_doc.type;
  end if;
  if (select count(*) from public.sales_document_items where sales_document_id = v_doc.id) <> 3 then
    raise exception 'FAIL(7): expected 3 sales_document_items, got %', (select count(*) from public.sales_document_items where sales_document_id = v_doc.id);
  end if;
  if v_doc.total_amount <> 2200000 then
    raise exception 'FAIL(7): expected sales_document total_amount=2200000, got %', v_doc.total_amount;
  end if;
  if (select billing_status from public.service_entries where id = v_entry) <> 'INVOICED' then
    raise exception 'FAIL(7): source service_entry did not flip to INVOICED';
  end if;
  if (select billing_status from public.expenses where id = v_expense) <> 'INVOICED' then
    raise exception 'FAIL(7): source expense did not flip to INVOICED';
  end if;
  if (select status from public.billing_batches where id = v_batch) <> 'CONVERTED' then
    raise exception 'FAIL(7): batch did not flip to CONVERTED';
  end if;
  raise notice 'PASS(7): batch converted to a % (%) with correct total and cascaded billing_status', v_doc.type, v_doc.id;

  -- 8) cancel the resulting document, confirm full revert -------------------
  perform public.cancel_sales_document(v_doc.id);

  if (select status from public.billing_batches where id = v_batch) <> 'READY' then
    raise exception 'FAIL(8): batch did not revert to READY after cancel';
  end if;
  if (select sales_document_id from public.billing_batches where id = v_batch) is not null then
    raise exception 'FAIL(8): batch still references the cancelled sales_document';
  end if;
  if (select billing_status from public.service_entries where id = v_entry) <> 'READY_TO_BILL' then
    raise exception 'FAIL(8): source service_entry did not revert to READY_TO_BILL';
  end if;
  if (select billing_status from public.expenses where id = v_expense) <> 'READY_TO_BILL' then
    raise exception 'FAIL(8): source expense did not revert to READY_TO_BILL';
  end if;
  raise notice 'PASS(8): cancelling the resulting document reverted the batch and its source rows';

  raise notice '===== ALL BILLING BATCH INTEGRITY TESTS PASSED =====';
end $$;

rollback;

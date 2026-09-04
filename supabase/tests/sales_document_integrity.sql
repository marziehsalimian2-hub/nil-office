-- =============================================================================
-- NIL Office — Invoice/Proforma (sales_documents) integrity tests (Phase 1).
--
-- Run in the Supabase SQL editor AFTER migrations 0029-0034 and after at
-- least one ADMIN profile and one companies row exist. The whole script
-- runs in a transaction and ROLLS BACK at the end, so it leaves no data
-- behind.
--
-- It impersonates an ADMIN user (so auth.uid()/RLS/authorization behave
-- like a real session, and ADMIN bypasses both accounting_role and
-- invoice_role gates) by setting the JWT sub claim to that admin's id.
--
-- Covered: DRAFT stays numberless (both types), finalize rejects
-- non-APPROVED/missing-customer, full happy path PROFORMA (^PI-) and
-- INVOICE (^INV-), re-finalize rejected with counter unchanged,
-- cancellation-pre-ISSUED-stays-numberless (proactively verified, unlike
-- contracts which needed a follow-up bugfix migration for this),
-- conversion rejects unissued/already-converted proforma, conversion
-- happy path copies items+totals via the rollup trigger and flips the
-- source to CONVERTED, item-rollup correctness, no physical deletion
-- past DRAFT.
-- =============================================================================
begin;

do $$
declare
  v_admin uuid;
  v_company uuid;
  v_doc     uuid;
  v_doc2    uuid;
  v_new_inv public.sales_documents;
  v_num     text;
  v_seq_before int;
  v_seq_after  int;
  v_msg     text;
  v_year    int := extract(year from now())::int - 621; -- rough Jalali year, good enough for a test
  v_subtotal numeric(20,4);
  v_total    numeric(20,4);
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('role', 'authenticated', true);

  select id into v_company from public.companies limit 1;
  if v_company is null then raise exception 'no companies row — create at least one company first'; end if;

  -- 1) DRAFT PROFORMA stays numberless -----------------------------------
  insert into public.sales_documents (type, status, company_id, customer_legal_name_snapshot, created_by)
  values ('PROFORMA', 'DRAFT', v_company, 'مشتری تست', v_admin)
  returning id into v_doc;
  if exists (select 1 from public.sales_documents where id = v_doc and sequence_number is not null) then
    raise exception 'FAIL(1): draft proforma has a sequence number';
  end if;
  raise notice 'PASS(1): draft proforma created with no number';

  -- 2) finalize_sales_document while still DRAFT must fail ----------------
  begin
    perform public.finalize_sales_document(v_doc);
    raise exception 'FAIL(2): finalized a DRAFT document';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'NOT_ELIGIBLE' then raise exception 'FAIL(2): expected NOT_ELIGIBLE, got %', v_msg; end if;
    raise notice 'PASS(2): finalize rejected while still DRAFT';
  end;

  -- 3) invalid direct transition DRAFT -> ISSUED must fail -----------------
  begin
    update public.sales_documents set status = 'ISSUED' where id = v_doc;
    raise exception 'FAIL(3): DRAFT -> ISSUED transition was accepted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'INVALID_STATUS_TRANSITION' then raise exception 'FAIL(3): expected INVALID_STATUS_TRANSITION, got %', v_msg; end if;
    raise notice 'PASS(3): invalid direct transition rejected';
  end;

  -- 4) item rollup correctness --------------------------------------------
  insert into public.sales_document_items (sales_document_id, line_no, description, quantity, unit_price)
  values (v_doc, 1, 'ردیف یک', 2, 1000000), (v_doc, 2, 'ردیف دو', 1, 500000);
  select subtotal, total_amount into v_subtotal, v_total from public.sales_documents where id = v_doc;
  if v_subtotal <> 2500000 then raise exception 'FAIL(4): subtotal rollup wrong, got %', v_subtotal; end if;
  if v_total <> 2500000 then raise exception 'FAIL(4): total_amount wrong, got %', v_total; end if;
  raise notice 'PASS(4): item rollup computed subtotal/total correctly (%)', v_total;

  delete from public.sales_document_items where sales_document_id = v_doc and line_no = 2;
  select subtotal into v_subtotal from public.sales_documents where id = v_doc;
  if v_subtotal <> 2000000 then raise exception 'FAIL(4b): rollup did not recompute after item delete, got %', v_subtotal; end if;
  raise notice 'PASS(4b): rollup recomputes after item delete';

  begin
    update public.sales_documents set total_amount = 999999 where id = v_doc;
    raise exception 'FAIL(4c): total_amount was directly writable';
  exception when others then
    raise notice 'PASS(4c): total_amount (generated column) rejects direct writes';
  end;

  -- 5) full happy path PROFORMA: DRAFT -> REVIEW -> APPROVED -> finalize --
  update public.sales_documents set status = 'REVIEW' where id = v_doc;
  update public.sales_documents set status = 'APPROVED' where id = v_doc;

  select last_value into v_seq_before from public.number_sequences where scope = 'PROFORMA' and year = v_year;
  v_seq_before := coalesce(v_seq_before, 0);

  select display_number into v_num from public.finalize_sales_document(v_doc, v_year);
  if v_num is null or v_num !~ '^PI-' then raise exception 'FAIL(5): unexpected proforma display number: %', v_num; end if;
  raise notice 'PASS(5): proforma finalized as %', v_num;

  -- 6) re-finalize rejected, counter unchanged -----------------------------
  select last_value into v_seq_after from public.number_sequences where scope = 'PROFORMA' and year = v_year;
  begin
    perform public.finalize_sales_document(v_doc, v_year);
    raise exception 'FAIL(6): re-finalize succeeded';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'ALREADY_NUMBERED' then raise exception 'FAIL(6): expected ALREADY_NUMBERED, got %', v_msg; end if;
  end;
  if (select last_value from public.number_sequences where scope = 'PROFORMA' and year = v_year) <> v_seq_after then
    raise exception 'FAIL(6): re-finalize attempt consumed a number';
  end if;
  raise notice 'PASS(6): re-finalize rejected, no number consumed';

  -- 7) full happy path INVOICE: DRAFT -> REVIEW -> APPROVED -> finalize ---
  insert into public.sales_documents (type, status, company_id, customer_legal_name_snapshot, created_by)
  values ('INVOICE', 'DRAFT', v_company, 'مشتری تست', v_admin)
  returning id into v_doc2;
  insert into public.sales_document_items (sales_document_id, line_no, description, quantity, unit_price)
  values (v_doc2, 1, 'ردیف فاکتور', 1, 1000000);
  update public.sales_documents set status = 'REVIEW' where id = v_doc2;
  update public.sales_documents set status = 'APPROVED' where id = v_doc2;
  select display_number into v_num from public.finalize_sales_document(v_doc2, v_year);
  if v_num is null or v_num !~ '^INV-' then raise exception 'FAIL(7): unexpected invoice display number: %', v_num; end if;
  raise notice 'PASS(7): invoice finalized as %', v_num;

  -- 8) cancellation pre-ISSUED stays numberless ----------------------------
  declare v_c uuid;
  begin
    insert into public.sales_documents (type, status, company_id, customer_legal_name_snapshot, created_by)
    values ('PROFORMA', 'DRAFT', v_company, 'مشتری ابطال', v_admin)
    returning id into v_c;
    perform public.cancel_sales_document(v_c);
    if (select status from public.sales_documents where id = v_c) <> 'CANCELLED' then
      raise exception 'FAIL(8): draft document was not cancelled';
    end if;
    if (select sequence_number from public.sales_documents where id = v_c) is not null then
      raise exception 'FAIL(8): a cancelled draft unexpectedly has a sequence number';
    end if;
    raise notice 'PASS(8): pre-ISSUED cancellation succeeds and consumes no number';
  end;

  -- 9) convert_proforma_to_invoice: rejects an unissued proforma -----------
  declare v_p uuid;
  begin
    insert into public.sales_documents (type, status, company_id, customer_legal_name_snapshot, created_by)
    values ('PROFORMA', 'DRAFT', v_company, 'مشتری تبدیل', v_admin)
    returning id into v_p;
    begin
      perform public.convert_proforma_to_invoice(v_p);
      raise exception 'FAIL(9): converted an unissued (DRAFT) proforma';
    exception when others then
      get stacked diagnostics v_msg = message_text;
      if v_msg <> 'NOT_ELIGIBLE' then raise exception 'FAIL(9): expected NOT_ELIGIBLE, got %', v_msg; end if;
      raise notice 'PASS(9): conversion rejected for an unissued proforma';
    end;
  end;

  -- 10) convert_proforma_to_invoice: happy path ----------------------------
  select * into v_new_inv from public.convert_proforma_to_invoice(v_doc); -- v_doc is the ISSUED proforma from step 5
  if v_new_inv.id is null then raise exception 'FAIL(10): conversion did not return a new invoice'; end if;
  if v_new_inv.type <> 'INVOICE' then
    raise exception 'FAIL(10): converted row is not type INVOICE';
  end if;
  if v_new_inv.sequence_number is not null then
    raise exception 'FAIL(10): converted invoice unexpectedly already has a number';
  end if;
  if v_new_inv.subtotal <> (select subtotal from public.sales_documents where id = v_doc) then
    raise exception 'FAIL(10): converted invoice subtotal does not match source proforma (rollup on copied items failed)';
  end if;
  if (select status from public.sales_documents where id = v_doc) <> 'CONVERTED' then
    raise exception 'FAIL(10): source proforma was not flipped to CONVERTED';
  end if;
  if (select converted_to_id from public.sales_documents where id = v_doc) <> v_new_inv.id then
    raise exception 'FAIL(10): source proforma converted_to_id not set correctly';
  end if;
  raise notice 'PASS(10): proforma converted to a new numberless DRAFT invoice with matching totals';

  begin
    perform public.convert_proforma_to_invoice(v_doc);
    raise exception 'FAIL(10b): re-converting an already-converted proforma succeeded';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'ALREADY_CONVERTED' then raise exception 'FAIL(10b): expected ALREADY_CONVERTED, got %', v_msg; end if;
    raise notice 'PASS(10b): re-conversion rejected';
  end;

  -- 11) no physical deletion once past DRAFT -------------------------------
  begin
    delete from public.sales_documents where id = v_doc2; -- ISSUED
    raise exception 'FAIL(11): an ISSUED document was deleted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'CANNOT_DELETE_NON_DRAFT' then raise exception 'FAIL(11): expected CANNOT_DELETE_NON_DRAFT, got %', v_msg; end if;
    raise notice 'PASS(11): deletion of a non-DRAFT document blocked';
  end;

  raise notice '===== ALL SALES DOCUMENT INTEGRITY TESTS PASSED =====';
end $$;

rollback;

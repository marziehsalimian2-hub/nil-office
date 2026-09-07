-- =====================================================================
-- NIL Office — 0063_create_accounting_draft_function.sql
-- Invoice Phase 3 — "Create Accounting Draft": push an ISSUED invoice
-- into a DRAFT journal entry for a human accountant to review and post
-- later. NEVER calls post_journal_entry itself — the entry sits in
-- Accounting's own DRAFT queue exactly like any manually-created one
-- (createJournalEntry, app/actions/accounting.ts, follows the same
-- never-auto-post rule).
--
-- Gated on can_create_accounting(), NOT can_create_invoice() — this
-- writes into journal_entries/journal_entry_lines, which is
-- Accounting's territory. An invoice-only user must not be able to
-- write into the ledger, even a DRAFT row.
-- =====================================================================

create or replace function public.create_accounting_draft_from_sales_document(p_sales_document_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc         public.sales_documents;
  v_ar_account  uuid;
  v_rev_account uuid;
  v_detail      uuid;
  v_fiscal_year uuid;
  v_entry_id    uuid;
  v_doc_date    date;
begin
  if not public.can_create_accounting() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_doc from public.sales_documents where id = p_sales_document_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_doc.type <> 'INVOICE' then
    raise exception 'NOT_ELIGIBLE' using errcode = '22000';
  end if;
  if v_doc.status not in ('ISSUED', 'PARTIALLY_SETTLED', 'OVERDUE') then
    raise exception 'NOT_ELIGIBLE' using errcode = '22000';
  end if;
  if v_doc.accounting_journal_entry_id is not null then
    raise exception 'ACCOUNTING_DRAFT_ALREADY_EXISTS' using errcode = '22000';
  end if;

  select default_ar_account_id, default_sales_revenue_account_id
    into v_ar_account, v_rev_account
    from public.app_settings where id = 1;
  if v_ar_account is null or v_rev_account is null then
    raise exception 'ACCOUNTING_DEFAULTS_NOT_CONFIGURED' using errcode = '22000';
  end if;

  -- Find-or-create the customer's detail account — nothing in the app
  -- populates companies -> detail_accounts today, so this is the one
  -- place that bridges the gap, idempotently (reused on every
  -- subsequent invoice for the same company).
  select id into v_detail from public.detail_accounts where company_id = v_doc.company_id and kind = 'CUSTOMER' limit 1;
  if v_detail is null then
    insert into public.detail_accounts (name, kind, company_id)
    values (v_doc.customer_legal_name_snapshot, 'CUSTOMER', v_doc.company_id)
    returning id into v_detail;
  end if;

  v_doc_date := coalesce(v_doc.issue_date, current_date);
  select id into v_fiscal_year from public.fiscal_years
   where status = 'OPEN' and start_date <= v_doc_date and end_date >= v_doc_date
   limit 1;
  if v_fiscal_year is null then
    raise exception 'FISCAL_YEAR_CLOSED' using errcode = '22000';
  end if;

  insert into public.journal_entries (fiscal_year_id, document_date, description, status, created_by)
  values (v_fiscal_year, v_doc_date, 'فاکتور ' || coalesce(v_doc.display_number, ''), 'DRAFT', auth.uid())
  returning id into v_entry_id;

  insert into public.journal_entry_lines
    (journal_entry_id, account_id, detail_account_id, description, debit, credit, company_id, case_id, sales_document_id, line_no)
  values
    (v_entry_id, v_ar_account,  v_detail, 'حساب‌های دریافتنی — ' || coalesce(v_doc.display_number, ''), v_doc.total_amount, 0, v_doc.company_id, v_doc.case_id, p_sales_document_id, 1),
    (v_entry_id, v_rev_account, null,     'درآمد فروش — '        || coalesce(v_doc.display_number, ''), 0, v_doc.total_amount, v_doc.company_id, v_doc.case_id, p_sales_document_id, 2);

  update public.sales_documents set accounting_journal_entry_id = v_entry_id, updated_at = now() where id = p_sales_document_id;

  perform public.write_log('sales_documents', p_sales_document_id, 'ACCOUNTING_DRAFT_CREATED', null, jsonb_build_object('journal_entry_id', v_entry_id));
  perform public.write_log('journal_entries', v_entry_id, 'CREATED_FROM_SALES_DOCUMENT', null, jsonb_build_object('sales_document_id', p_sales_document_id));

  return v_entry_id;
end;
$$;

grant execute on function public.create_accounting_draft_from_sales_document(uuid) to authenticated;

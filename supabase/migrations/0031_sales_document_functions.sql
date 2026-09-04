-- =====================================================================
-- NIL Office — 0031_sales_document_functions.sql
-- Invoice/Proforma module — Phase 1 functions/triggers.
-- Numbering mirrors finalize_contract (0022_contract_functions.sql)
-- exactly: deferred atomic allocation, never on DRAFT/REVIEW/APPROVED
-- insert or edit. One shared finalize_sales_document RPC for both
-- PROFORMA and INVOICE (spec explicitly wants one architecture, not
-- duplicated logic) — only the scope string differs, and it happens to
-- equal sales_documents.type::text directly.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Display number formatter: add PROFORMA/INVOICE branches.
-- ---------------------------------------------------------------------
create or replace function public.format_display_number(p_scope text, p_year int, p_seq int)
returns text
language sql
immutable
as $$
  select case p_scope
    when 'OUTGOING' then 'ص-' || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'INCOMING' then 'و-' || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'CASE'     then 'CASE-' || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'CONTRACT' then 'CTR-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'PROFORMA' then 'PI-'   || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'INVOICE'  then 'INV-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    else p_scope || '-' || p_year::text || '-' || lpad(p_seq::text, 4, '0')
  end;
$$;

-- ---------------------------------------------------------------------
-- Authority helpers — same shape as contract_role / accounting_role.
-- EDIT folds into CREATE; ISSUE and CANCEL fold into APPROVE (both are
-- finality-changing actions, same tier as contract approval).
-- ---------------------------------------------------------------------
create or replace function public.has_invoice_access()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or invoice_role is not null)
  );
$$;

create or replace function public.can_create_invoice()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or invoice_role in ('CREATE','APPROVE','ADMIN'))
  );
$$;

create or replace function public.can_approve_invoice()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or invoice_role in ('APPROVE','ADMIN'))
  );
$$;

create or replace function public.is_invoice_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or invoice_role = 'ADMIN')
  );
$$;

-- ---------------------------------------------------------------------
-- Item rollup — subtotal/discount_amount/tax_amount on the header are
-- maintained ONLY here, never by app code (spec §7: no frontend-only
-- calculation). total_amount is a generated column (0030), so Postgres
-- itself rejects any direct write to it.
-- ---------------------------------------------------------------------
create or replace function public.tg_sales_document_items_rollup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc_id   uuid;
  v_subtotal numeric(20,4);
  v_discount numeric(20,4);
  v_tax      numeric(20,4);
begin
  v_doc_id := coalesce(new.sales_document_id, old.sales_document_id);

  select coalesce(sum(quantity * unit_price), 0),
         coalesce(sum(discount_amount), 0),
         coalesce(sum(tax_amount), 0)
    into v_subtotal, v_discount, v_tax
    from public.sales_document_items
   where sales_document_id = v_doc_id;

  update public.sales_documents
     set subtotal        = v_subtotal,
         discount_amount = v_discount,
         tax_amount      = v_tax,
         updated_at      = now()
   where id = v_doc_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sales_document_items_rollup on public.sales_document_items;
create trigger trg_sales_document_items_rollup
  after insert or update or delete on public.sales_document_items
  for each row execute function public.tg_sales_document_items_rollup();

-- ---------------------------------------------------------------------
-- finalize_sales_document — issue the official PI-/INV- number.
-- Atomic: authorise -> lock -> validate eligibility -> allocate ->
-- assign -> audit -> commit.
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

  update public.sales_documents
     set sequence_number = v_seq,
         display_number  = v_disp,
         year            = v_year,
         status          = 'ISSUED',
         issued_by       = auth.uid(),
         issued_at       = now(),
         updated_at      = now()
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

-- ---------------------------------------------------------------------
-- convert_proforma_to_invoice — creates a NEW, numberless DRAFT invoice
-- (never pre-numbered — keeps finalize_sales_document the single
-- numbering code path in the whole module), copies items (the rollup
-- trigger fills the new invoice's totals automatically), flips the
-- source proforma to CONVERTED. Both remain available afterwards.
-- ---------------------------------------------------------------------
create or replace function public.convert_proforma_to_invoice(p_proforma_id uuid)
returns public.sales_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src    public.sales_documents;
  v_new    public.sales_documents;
  v_new_id uuid;
begin
  if not public.can_approve_invoice() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_src from public.sales_documents where id = p_proforma_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_src.type <> 'PROFORMA' then
    raise exception 'ONLY_PROFORMA_CONVERTIBLE' using errcode = '22000';
  end if;
  if v_src.status not in ('ISSUED','ACCEPTED') then
    raise exception 'NOT_ELIGIBLE' using errcode = '22000';
  end if;
  if v_src.converted_to_id is not null then
    raise exception 'ALREADY_CONVERTED' using errcode = '22000';
  end if;

  insert into public.sales_documents (
    type, status, company_id, contract_id, case_id,
    currency_code, payment_terms, notes,
    customer_legal_name_snapshot, customer_english_name_snapshot,
    customer_registration_number_snapshot, customer_national_id_snapshot,
    customer_economic_code_snapshot, customer_address_snapshot,
    customer_postal_code_snapshot, customer_contact_person_snapshot,
    customer_email_snapshot, customer_phone_snapshot,
    converted_from_id, created_by
  )
  values (
    'INVOICE', 'DRAFT', v_src.company_id, v_src.contract_id, v_src.case_id,
    v_src.currency_code, v_src.payment_terms, v_src.notes,
    v_src.customer_legal_name_snapshot, v_src.customer_english_name_snapshot,
    v_src.customer_registration_number_snapshot, v_src.customer_national_id_snapshot,
    v_src.customer_economic_code_snapshot, v_src.customer_address_snapshot,
    v_src.customer_postal_code_snapshot, v_src.customer_contact_person_snapshot,
    v_src.customer_email_snapshot, v_src.customer_phone_snapshot,
    v_src.id, auth.uid()
  )
  returning id into v_new_id;

  insert into public.sales_document_items (
    sales_document_id, line_no, item_type, description, unit, quantity, unit_price, discount_amount, tax_amount
  )
  select v_new_id, line_no, item_type, description, unit, quantity, unit_price, discount_amount, tax_amount
    from public.sales_document_items
   where sales_document_id = v_src.id;

  update public.sales_documents
     set status = 'CONVERTED', converted_to_id = v_new_id, converted_at = now(), updated_at = now()
   where id = v_src.id;

  perform public.write_log(
    'sales_documents', v_src.id, 'CONVERTED',
    jsonb_build_object('status', v_src.status),
    jsonb_build_object('status', 'CONVERTED', 'converted_to_id', v_new_id)
  );
  perform public.write_log(
    'sales_documents', v_new_id, 'CREATED_FROM_PROFORMA',
    null, jsonb_build_object('converted_from_id', v_src.id)
  );

  select * into v_new from public.sales_documents where id = v_new_id;
  return v_new;
end;
$$;

-- ---------------------------------------------------------------------
-- cancel_sales_document — keeps the record and any assigned number,
-- marks CANCELLED. Not allowed once CONVERTED or SETTLED.
-- ---------------------------------------------------------------------
create or replace function public.cancel_sales_document(p_id uuid)
returns public.sales_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.sales_documents;
begin
  if not public.can_approve_invoice() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_row from public.sales_documents where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status = 'CANCELLED' then
    raise exception 'ALREADY_CANCELLED' using errcode = '22000';
  end if;
  if v_row.status in ('CONVERTED','SETTLED') then
    raise exception 'NOT_ELIGIBLE' using errcode = '22000';
  end if;

  update public.sales_documents
     set status = 'CANCELLED', updated_at = now()
   where id = p_id
   returning * into v_row;

  perform public.write_log(
    'sales_documents', p_id, 'CANCELLED',
    jsonb_build_object('status', v_row.status),
    jsonb_build_object('status', 'CANCELLED', 'display_number', v_row.display_number)
  );

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- Guard trigger: numbering fields immutable once set; no physical
-- deletion once past DRAFT.
-- ---------------------------------------------------------------------
create or replace function public.tg_sales_document_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then
      raise exception 'CANNOT_DELETE_NON_DRAFT' using errcode = '22000';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.sequence_number is not null
       and new.sequence_number is distinct from old.sequence_number then
      raise exception 'SEQUENCE_NUMBER_IMMUTABLE' using errcode = '22000';
    end if;
    if old.display_number is not null
       and new.display_number is distinct from old.display_number then
      raise exception 'DISPLAY_NUMBER_IMMUTABLE' using errcode = '22000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sales_document_guard on public.sales_documents;
create trigger trg_sales_document_guard
  before update or delete on public.sales_documents
  for each row execute function public.tg_sales_document_guard();

-- ---------------------------------------------------------------------
-- Status transition trigger — explicit adjacency map per type:
--   PROFORMA: DRAFT->REVIEW/CANCELLED; REVIEW->DRAFT/APPROVED/CANCELLED;
--             APPROVED->CANCELLED (->ISSUED via RPC only);
--             ISSUED->ACCEPTED/EXPIRED/CANCELLED (->CONVERTED via RPC only);
--             ACCEPTED->EXPIRED/CANCELLED.
--   INVOICE:  DRAFT->REVIEW/CANCELLED; REVIEW->DRAFT/APPROVED/CANCELLED;
--             APPROVED->CANCELLED (->ISSUED via RPC only);
--             ISSUED->PARTIALLY_SETTLED/SETTLED/OVERDUE/CANCELLED;
--             PARTIALLY_SETTLED->SETTLED/OVERDUE/CANCELLED;
--             OVERDUE->PARTIALLY_SETTLED/SETTLED/CANCELLED.
-- ---------------------------------------------------------------------
create or replace function public.tg_sales_document_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then

    if new.status = 'ISSUED' then
      if old.sequence_number is null and new.sequence_number is not null then
        return new; -- legitimate numbering by finalize_sales_document
      end if;
      raise exception 'USE_RPC_TO_FINALIZE' using errcode = '22000';
    end if;

    if new.status = 'CONVERTED' then
      if old.converted_at is null and new.converted_at is not null then
        return new; -- legitimate flip by convert_proforma_to_invoice
      end if;
      raise exception 'USE_RPC_TO_CONVERT' using errcode = '22000';
    end if;

    if new.type = 'PROFORMA' then
      if not (
        (old.status = 'DRAFT'    and new.status in ('REVIEW','CANCELLED')) or
        (old.status = 'REVIEW'   and new.status in ('DRAFT','APPROVED','CANCELLED')) or
        (old.status = 'APPROVED' and new.status in ('CANCELLED')) or
        (old.status = 'ISSUED'   and new.status in ('ACCEPTED','EXPIRED','CANCELLED')) or
        (old.status = 'ACCEPTED' and new.status in ('EXPIRED','CANCELLED'))
      ) then
        raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000';
      end if;
    else -- INVOICE
      if not (
        (old.status = 'DRAFT'             and new.status in ('REVIEW','CANCELLED')) or
        (old.status = 'REVIEW'            and new.status in ('DRAFT','APPROVED','CANCELLED')) or
        (old.status = 'APPROVED'          and new.status in ('CANCELLED')) or
        (old.status = 'ISSUED'            and new.status in ('PARTIALLY_SETTLED','SETTLED','OVERDUE','CANCELLED')) or
        (old.status = 'PARTIALLY_SETTLED' and new.status in ('SETTLED','OVERDUE','CANCELLED')) or
        (old.status = 'OVERDUE'           and new.status in ('PARTIALLY_SETTLED','SETTLED','CANCELLED'))
      ) then
        raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sales_document_status on public.sales_documents;
create trigger trg_sales_document_status
  before update on public.sales_documents
  for each row execute function public.tg_sales_document_status();

-- ---------------------------------------------------------------------
-- updated_at touch + generic audit trigger for both new tables.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['sales_documents','sales_document_items']
  loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s;', t);
    execute format(
      'create trigger trg_touch_%1$s before update on public.%1$s
       for each row execute function public.tg_touch_updated_at();', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['sales_documents','sales_document_items']
  loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$s;', t);
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$s
       for each row execute function public.tg_audit();', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Unified search — add sales_documents.
-- ---------------------------------------------------------------------
create or replace function public.search_all(p_q text)
returns table (
  entity_type text,
  id          uuid,
  title       text,
  subtitle    text,
  extra       text,
  created_at  timestamptz
)
language sql
stable
as $$
  with q as (select btrim(coalesce(p_q, '')) as term)
  select 'correspondence', c.id,
         coalesce(c.subject, '(بدون موضوع)'),
         coalesce(c.display_number, 'پیش‌نویس'),
         c.direction::text,
         c.created_at
    from public.correspondence c, q
   where q.term <> '' and (
         c.subject ilike '%'||q.term||'%'
      or c.display_number ilike '%'||q.term||'%'
      or c.external_letter_number ilike '%'||q.term||'%'
      or c.recipient_name ilike '%'||q.term||'%')
  union all
  select 'case', ca.id, ca.title, coalesce(ca.case_code, ''), ca.status::text, ca.created_at
    from public.cases ca, q
   where q.term <> '' and (ca.title ilike '%'||q.term||'%' or ca.case_code ilike '%'||q.term||'%'
                           or exists (select 1 from unnest(ca.tags) tg where tg ilike '%'||q.term||'%'))
  union all
  select 'document', d.id, d.title, d.document_type::text, null, d.created_at
    from public.documents d, q
   where q.term <> '' and d.title ilike '%'||q.term||'%'
  union all
  select 'company', co.id, co.legal_name, coalesce(co.english_name, ''), co.country, co.created_at
    from public.companies co, q
   where q.term <> '' and (co.legal_name ilike '%'||q.term||'%' or co.english_name ilike '%'||q.term||'%')
  union all
  select 'contract', k.id,
         k.title,
         coalesce(k.display_number, k.external_contract_number, 'پیش‌نویس'),
         k.status::text,
         k.created_at
    from public.contracts k, q
   where q.term <> '' and (
         k.title ilike '%'||q.term||'%'
      or k.display_number ilike '%'||q.term||'%'
      or k.external_contract_number ilike '%'||q.term||'%')
  union all
  select 'sales_document', sd.id,
         coalesce(sd.display_number, sd.customer_legal_name_snapshot, 'پیش‌نویس'),
         sd.type::text || ' — ' || coalesce(sd.display_number, 'پیش‌نویس'),
         sd.status::text,
         sd.created_at
    from public.sales_documents sd, q
   where q.term <> '' and (
         sd.display_number ilike '%'||q.term||'%'
      or sd.customer_legal_name_snapshot ilike '%'||q.term||'%'
      or sd.notes ilike '%'||q.term||'%')
  order by created_at desc
  limit 50;
$$;

-- ---------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------
grant execute on function public.has_invoice_access()               to authenticated;
grant execute on function public.can_create_invoice()                to authenticated;
grant execute on function public.can_approve_invoice()               to authenticated;
grant execute on function public.is_invoice_admin()                  to authenticated;
grant execute on function public.finalize_sales_document(uuid,int)   to authenticated;
grant execute on function public.convert_proforma_to_invoice(uuid)   to authenticated;
grant execute on function public.cancel_sales_document(uuid)         to authenticated;

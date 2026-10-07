-- =====================================================================
-- NIL Office — 0143_nil_verify.sql
-- NIL Verify v1.0 — document authenticity layer for OFFICIAL, FINALIZED documents:
--   OUTGOING_CORRESPONDENCE, PROFORMA, INVOICE, CONTRACT (NIL_ISSUED).  The core is generic: a new type = one gate branch + one snapshot branch.
--
-- Model: every issued document gets ONE verification record with an unguessable public token (only its SHA-256 is stored — the raw token exists
-- only inside the QR of the PDF), a human-readable code, a PUBLIC METADATA SNAPSHOT (deny-by-default, built once at issuance) and the SHA-256 of the
-- EXACT frozen PDF. The public page reads ONLY through service_role RPCs that return a fixed allow-list projection.
--
-- Lifecycle: PENDING (identity created, PDF not yet frozen) -> ACTIVE (hash + stored PDF registered) -> REVOKED | SUPERSEDED. PENDING never becomes
-- ACTIVE without a hash and a stored file. Revoked / superseded records stay readable (the QR is never dead).
-- Idempotency/concurrency: a partial unique index allows at most one PENDING/ACTIVE verification per document; verify_begin also takes a per-document
-- advisory lock. Revoke / supersede / configuration = system ADMIN only, reason required, audited. A cancelled document auto-REVOKES (trigger).
-- RLS on every table with NO policies: no browser role can read or write them; authenticated users only get the gated RPCs below.
-- Everything in this file that UPDATEs/DELETEs has a WHERE (Supabase pg-safeupdate — lesson of 0142).
-- No backfill: existing documents are NOT verified. Forward-only; service_role granted explicitly on every new table (0072 gotcha).
-- Factory Reset (0141) integration at the bottom: manifest rows + storage rule + _srs_storage_classify restated (CURRENT body = 0141).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) configuration (PRESERVED by a reset)
-- ---------------------------------------------------------------------
create table if not exists public.verification_settings (
  id                    integer primary key default 1 check (id = 1),
  enabled               boolean not null default true,
  issuer_name           text not null default 'شرکت توسعه مدیریت راهبردی نیل' check (length(btrim(issuer_name)) between 1 and 200),
  public_label          text not null default 'استعلام اصالت سند' check (length(btrim(public_label)) between 1 and 120),
  show_contract_amount  boolean not null default false,           -- PUBLIC BY DEFAULT = FALSE
  updated_by            uuid references public.profiles(id) on delete set null,
  updated_at            timestamptz not null default now()
);
insert into public.verification_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.verification_doc_types (
  document_type  text primary key check (document_type in ('OUTGOING_CORRESPONDENCE', 'PROFORMA', 'INVOICE', 'CONTRACT')),
  enabled        boolean not null default true,
  page           text not null default 'LAST' check (page in ('FIRST', 'LAST')),
  x_mm           numeric(6,2) not null default 18 check (x_mm >= 0 and x_mm <= 150),    -- from the LEFT edge to the plate's left edge
  y_mm           numeric(6,2) not null default 10 check (y_mm >= 0 and y_mm <= 250),    -- from the BOTTOM edge to the plate's bottom edge
  size_mm        numeric(6,2) not null default 22 check (size_mm >= 15 and size_mm <= 60),
  show_label     boolean not null default true,
  show_code      boolean not null default true,
  label_text     text not null default 'استعلام اصالت سند — NIL Verify' check (length(btrim(label_text)) between 1 and 120),
  updated_by     uuid references public.profiles(id) on delete set null,
  updated_at     timestamptz not null default now()
);
insert into public.verification_doc_types (document_type, x_mm, y_mm, size_mm) values
  ('OUTGOING_CORRESPONDENCE', 20, 8, 24),
  ('PROFORMA',                18, 10, 22),
  ('INVOICE',                 18, 10, 22),
  ('CONTRACT',                20, 10, 22)
on conflict (document_type) do nothing;

-- ---------------------------------------------------------------------
-- 2) the verification record (operational data)
-- ---------------------------------------------------------------------
create table if not exists public.document_verifications (
  id                              uuid primary key default gen_random_uuid(),
  verification_code               text not null unique check (verification_code ~ '^NIL-V-[A-Z2-9]{4}-[A-Z2-9]{4}$'),
  token_hash                      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),     -- SHA-256 of the public token; the token itself is never stored
  document_type                   text not null check (document_type in ('OUTGOING_CORRESPONDENCE', 'PROFORMA', 'INVOICE', 'CONTRACT')),
  document_id                     uuid not null,
  document_number_snapshot        text not null,
  issued_at                       timestamptz not null,
  issuer_snapshot                 text not null,
  public_metadata_snapshot        jsonb not null default '{}'::jsonb,
  pdf_hash_algorithm              text not null default 'SHA-256' check (pdf_hash_algorithm in ('SHA-256')),
  pdf_hash                        text check (pdf_hash is null or pdf_hash ~ '^[0-9a-f]{64}$'),
  pdf_size_bytes                  bigint check (pdf_size_bytes is null or pdf_size_bytes > 0),
  pdf_storage_path                text check (pdf_storage_path is null or (pdf_storage_path like 'verified/%' and length(pdf_storage_path) <= 300)),
  status                          text not null default 'PENDING' check (status in ('PENDING', 'ACTIVE', 'REVOKED', 'SUPERSEDED')),
  activated_at                    timestamptz,
  revoked_at                      timestamptz,
  revoked_by                      uuid references public.profiles(id) on delete set null,
  revocation_reason               text,
  superseded_by_verification_id   uuid references public.document_verifications(id),
  verification_count              integer not null default 0 check (verification_count >= 0),
  last_verified_at                timestamptz,
  created_at                      timestamptz not null default now(),
  created_by                      uuid references public.profiles(id) on delete set null,
  updated_at                      timestamptz not null default now(),
  -- ACTIVE (and anything that was ACTIVE) must carry the exact-file evidence
  constraint ck_verification_active_evidence check (status = 'PENDING' or (pdf_hash is not null and pdf_storage_path is not null and activated_at is not null) or (status = 'REVOKED' and activated_at is null)),
  constraint ck_verification_revoked check (status <> 'REVOKED' or (revoked_at is not null and revocation_reason is not null)),
  constraint ck_verification_superseded check (status <> 'SUPERSEDED' or (superseded_by_verification_id is not null and revoked_at is not null))
);
-- ONE live (PENDING / ACTIVE) verification per document: idempotent finalize retries and concurrent finalizes cannot create a second identity
create unique index if not exists uq_document_verification_live on public.document_verifications (document_type, document_id) where status in ('PENDING', 'ACTIVE');
create index if not exists idx_document_verifications_doc on public.document_verifications (document_type, document_id);

create table if not exists public.verification_rate_limits (
  scope         text not null,
  key           text not null,
  window_start  timestamptz not null,
  count         integer not null default 0,
  primary key (scope, key, window_start)
);

alter table public.verification_settings    enable row level security;
alter table public.verification_doc_types   enable row level security;
alter table public.document_verifications   enable row level security;
alter table public.verification_rate_limits enable row level security;
-- (no policies on purpose: only SECURITY DEFINER functions / service_role touch these tables)

revoke all on public.verification_settings, public.verification_doc_types, public.document_verifications, public.verification_rate_limits from public, anon, authenticated;
grant select, insert, update on public.verification_settings, public.verification_doc_types, public.document_verifications, public.verification_rate_limits to service_role;

-- ---------------------------------------------------------------------
-- 3) guards: frozen identity after PENDING, valid transitions only, never deleted by a user
-- ---------------------------------------------------------------------
create or replace function public.tg_verification_guard()
returns trigger
language plpgsql as $$
declare v_old jsonb; v_new jsonb; k text;
begin
  if tg_op = 'DELETE' then
    raise exception 'VERIFY_NO_DELETE' using errcode = '22000';
  end if;
  -- status machine
  if new.status is distinct from old.status then
    if not ((old.status = 'PENDING' and new.status in ('ACTIVE', 'REVOKED'))
         or (old.status = 'ACTIVE' and new.status in ('REVOKED', 'SUPERSEDED'))) then
      raise exception 'VERIFY_INVALID_TRANSITION' using errcode = '22000';
    end if;
  end if;
  -- identity / evidence is frozen once the row has left PENDING; while PENDING only the token hash may be re-issued and the evidence filled in
  v_old := to_jsonb(old); v_new := to_jsonb(new);
  foreach k in array array['id', 'verification_code', 'document_type', 'document_id', 'document_number_snapshot', 'issued_at', 'issuer_snapshot',
                           'public_metadata_snapshot', 'created_at', 'created_by'] loop
    if v_old -> k is distinct from v_new -> k then raise exception 'VERIFY_FIELD_IMMUTABLE' using errcode = '22000'; end if;
  end loop;
  if old.status <> 'PENDING' then
    foreach k in array array['token_hash', 'pdf_hash_algorithm', 'pdf_hash', 'pdf_size_bytes', 'pdf_storage_path', 'activated_at'] loop
      if v_old -> k is distinct from v_new -> k then raise exception 'VERIFY_FIELD_IMMUTABLE' using errcode = '22000'; end if;
    end loop;
  end if;
  return new;
end; $$;

drop trigger if exists trg_verification_guard on public.document_verifications;
create trigger trg_verification_guard before update or delete on public.document_verifications
  for each row execute function public.tg_verification_guard();

-- ---------------------------------------------------------------------
-- 4) helpers (internal): per-type permission gates, public snapshot (DENY BY DEFAULT)
-- ---------------------------------------------------------------------
-- who may CREATE / ACTIVATE a verification = who may finalize that document type (same gates as the finalize RPCs)
create or replace function public._verify_require_issuer(p_type text)
returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_type = 'OUTGOING_CORRESPONDENCE' then
    if not public.is_active_user() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  elsif p_type in ('PROFORMA', 'INVOICE') then
    if not public.can_approve_invoice() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  elsif p_type = 'CONTRACT' then
    if not public.can_approve_contract() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  else
    raise exception 'VERIFY_INVALID' using errcode = '22000';
  end if;
end; $$;

-- who may READ the verification status of a document (detail pages, PDF routes) = who can open that module
create or replace function public._verify_require_reader(p_type text)
returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_type = 'OUTGOING_CORRESPONDENCE' then
    if not public.is_active_user() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  elsif p_type in ('PROFORMA', 'INVOICE') then
    if not public.has_invoice_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  elsif p_type = 'CONTRACT' then
    if not public.has_contract_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  else
    raise exception 'VERIFY_INVALID' using errcode = '22000';
  end if;
end; $$;

-- The PUBLIC DISCLOSURE POLICY. Explicit field list per type — nothing is public by accident. Returns {number, issued_at, metadata}.
-- Not shown, ever: internal ids / notes / attachments / follow-ups / audit / creator, line items, bank or settlement data, internal contract terms.
create or replace function public._verify_snapshot(p_type text, p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_s public.verification_settings; c public.correspondence; d public.sales_documents; k public.contracts; v_meta jsonb;
begin
  select * into v_s from public.verification_settings where id = 1;
  if p_type = 'OUTGOING_CORRESPONDENCE' then
    select * into c from public.correspondence where id = p_id;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if c.direction <> 'OUTGOING' or c.sequence_number is null or c.display_number is null or c.status in ('DRAFT', 'REVIEW', 'CANCELLED') then
      raise exception 'VERIFY_NOT_ELIGIBLE' using errcode = '22000';
    end if;
    v_meta := jsonb_build_object(
      'recipient', coalesce((select co.legal_name from public.companies co where co.id = c.recipient_company_id), c.recipient_name),
      'subject', c.subject);
    return jsonb_build_object('number', c.display_number, 'issued_at', coalesce(c.finalized_at, c.updated_at), 'metadata', jsonb_strip_nulls(v_meta));
  elsif p_type in ('PROFORMA', 'INVOICE') then
    select * into d from public.sales_documents where id = p_id;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if d.type::text <> p_type or d.sequence_number is null or d.display_number is null or d.status in ('DRAFT', 'REVIEW', 'APPROVED', 'CANCELLED') then
      raise exception 'VERIFY_NOT_ELIGIBLE' using errcode = '22000';
    end if;
    v_meta := jsonb_build_object(
      'customer', d.customer_legal_name_snapshot,
      'issue_date', coalesce(d.issue_date, d.issued_at::date),
      'valid_until', case when p_type = 'PROFORMA' then d.validity_date end,
      'currency', d.currency_code,
      'total_amount', d.total_amount::text);
    return jsonb_build_object('number', d.display_number, 'issued_at', coalesce(d.issued_at, d.updated_at), 'metadata', jsonb_strip_nulls(v_meta));
  elsif p_type = 'CONTRACT' then
    select * into k from public.contracts where id = p_id;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if k.kind <> 'NIL_ISSUED' or k.sequence_number is null or k.display_number is null or k.status in ('DRAFT', 'UNDER_REVIEW', 'CANCELLED') then
      raise exception 'VERIFY_NOT_ELIGIBLE' using errcode = '22000';
    end if;
    v_meta := jsonb_build_object(
      'counterparty', (select co.legal_name from public.companies co where co.id = k.counterparty_company_id),
      'contract_date', coalesce(k.signed_date, k.finalized_at::date));
    if v_s.show_contract_amount then
      v_meta := v_meta || jsonb_build_object('total_amount', k.total_amount::text, 'currency', k.currency_code);
    end if;
    return jsonb_build_object('number', k.display_number, 'issued_at', coalesce(k.finalized_at, k.updated_at), 'metadata', jsonb_strip_nulls(v_meta));
  end if;
  raise exception 'VERIFY_INVALID' using errcode = '22000';
end; $$;

-- 8 random characters from an ambiguity-free alphabet; uniqueness is enforced by the table (collision => retry)
create or replace function public._verify_new_code()
returns text
language plpgsql volatile as $$
declare
  c_alpha constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';        -- 31 chars, no I L O 0 1
  v_bytes bytea := uuid_send(gen_random_uuid()); v_code text := ''; i integer;
begin
  for i in 0 .. 7 loop
    v_code := v_code || substr(c_alpha, 1 + (get_byte(v_bytes, i) % 31), 1);
    if i = 3 then v_code := v_code || '-'; end if;
  end loop;
  return 'NIL-V-' || v_code;
end; $$;

-- ---------------------------------------------------------------------
-- 5) issuance RPCs (authenticated; gated like the module's own finalize)
-- ---------------------------------------------------------------------
create or replace function public.verify_get_config(p_type text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_s public.verification_settings; v_t public.verification_doc_types;
begin
  perform public._verify_require_reader(p_type);
  select * into v_s from public.verification_settings where id = 1;
  select * into v_t from public.verification_doc_types where document_type = p_type;
  return jsonb_build_object(
    'enabled', coalesce(v_s.enabled, false) and coalesce(v_t.enabled, false),
    'issuer_name', v_s.issuer_name, 'public_label', v_s.public_label,
    'layout', case when v_t.document_type is null then null else jsonb_build_object(
      'page', v_t.page, 'x_mm', v_t.x_mm, 'y_mm', v_t.y_mm, 'size_mm', v_t.size_mm,
      'show_label', v_t.show_label, 'show_code', v_t.show_code, 'label_text', v_t.label_text) end);
end; $$;

create or replace function public.verify_begin(p_type text, p_id uuid, p_token_hash text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.document_verifications; v_snap jsonb; v_s public.verification_settings; v_t public.verification_doc_types; v_try integer := 0; v_code text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_id is null then raise exception 'VERIFY_INVALID' using errcode = '22000'; end if;
  perform public._verify_require_issuer(p_type);
  select * into v_s from public.verification_settings where id = 1;
  select * into v_t from public.verification_doc_types where document_type = p_type;
  if not coalesce(v_s.enabled, false) or not coalesce(v_t.enabled, false) then raise exception 'VERIFY_DISABLED' using errcode = '22000'; end if;

  perform pg_advisory_xact_lock(hashtext('verify:' || p_type || ':' || p_id::text));
  select * into v_row from public.document_verifications where document_type = p_type and document_id = p_id and status in ('PENDING', 'ACTIVE');
  if found then
    if v_row.status = 'ACTIVE' then
      return jsonb_build_object('id', v_row.id, 'status', 'ACTIVE', 'code', v_row.verification_code, 'already_active', true);
    end if;
    -- PENDING retry: no QR has been issued yet, so the unused token is simply replaced
    update public.document_verifications set token_hash = p_token_hash, updated_at = now() where id = v_row.id and status = 'PENDING' returning * into v_row;
    return jsonb_build_object('id', v_row.id, 'status', 'PENDING', 'code', v_row.verification_code, 'document_number', v_row.document_number_snapshot,
                              'issuer_name', v_row.issuer_snapshot);
  end if;
  if exists (select 1 from public.document_verifications where document_type = p_type and document_id = p_id) then
    raise exception 'VERIFY_ALREADY_CLOSED' using errcode = '22000';       -- a revoked / superseded document is never re-verified silently
  end if;

  v_snap := public._verify_snapshot(p_type, p_id);                         -- raises VERIFY_NOT_ELIGIBLE unless the document is really finalized
  loop
    v_try := v_try + 1;
    v_code := public._verify_new_code();
    begin
      insert into public.document_verifications (verification_code, token_hash, document_type, document_id, document_number_snapshot, issued_at,
                                                 issuer_snapshot, public_metadata_snapshot, created_by)
      values (v_code, p_token_hash, p_type, p_id, v_snap ->> 'number', (v_snap ->> 'issued_at')::timestamptz, v_s.issuer_name, v_snap -> 'metadata', auth.uid())
      returning * into v_row;
      exit;
    exception when unique_violation then
      if v_try >= 10 then raise exception 'VERIFY_CODE_COLLISION' using errcode = '22000'; end if;
      select * into v_row from public.document_verifications where document_type = p_type and document_id = p_id and status in ('PENDING', 'ACTIVE');
      if found then exit; end if;                                          -- a concurrent finalize won: return ITS record
    end;
  end loop;
  perform public.write_log('document_verifications', v_row.id, 'VERIFICATION_CREATED', null,
    jsonb_build_object('document_type', p_type, 'document_id', p_id, 'code', v_row.verification_code));
  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'code', v_row.verification_code, 'document_number', v_row.document_number_snapshot,
                            'issuer_name', v_row.issuer_snapshot);
end; $$;

create or replace function public.verify_activate(p_id uuid, p_hash text, p_size bigint, p_path text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row public.document_verifications;
begin
  select * into v_row from public.document_verifications where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public._verify_require_issuer(v_row.document_type);
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_size is null or p_size <= 0
     or p_path is null or p_path <> 'verified/' || p_id::text || '.pdf' then
    raise exception 'VERIFY_INVALID' using errcode = '22000';
  end if;
  if v_row.status <> 'PENDING' then raise exception 'VERIFY_NOT_PENDING' using errcode = '22000'; end if;
  update public.document_verifications
     set status = 'ACTIVE', pdf_hash = p_hash, pdf_hash_algorithm = 'SHA-256', pdf_size_bytes = p_size, pdf_storage_path = p_path,
         activated_at = now(), updated_at = now()
   where id = p_id and status = 'PENDING' returning * into v_row;
  perform public.write_log('document_verifications', p_id, 'PDF_HASH_REGISTERED', null, jsonb_build_object('algorithm', 'SHA-256', 'size_bytes', p_size));
  perform public.write_log('document_verifications', p_id, 'VERIFICATION_ACTIVATED', null,
    jsonb_build_object('document_type', v_row.document_type, 'document_id', v_row.document_id, 'code', v_row.verification_code));
  return jsonb_build_object('id', v_row.id, 'status', 'ACTIVE', 'code', v_row.verification_code);
end; $$;

-- status of a document's verification for the detail pages and the PDF routes (module-access gate); includes the private storage path
create or replace function public.verify_document_status(p_type text, p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_row public.document_verifications; v_cfg jsonb;
begin
  perform public._verify_require_reader(p_type);
  select * into v_row from public.document_verifications where document_type = p_type and document_id = p_id order by created_at desc limit 1;
  if not found then return jsonb_build_object('exists', false); end if;
  return jsonb_build_object('exists', true, 'id', v_row.id, 'status', v_row.status, 'code', v_row.verification_code, 'document_number', v_row.document_number_snapshot,
    'activated_at', v_row.activated_at, 'revoked_at', v_row.revoked_at, 'hash_prefix', left(v_row.pdf_hash, 12),
    'pdf_storage_path', v_row.pdf_storage_path, 'verification_count', v_row.verification_count);
end; $$;

-- ---------------------------------------------------------------------
-- 6) ADMIN actions: revoke, supersede, configuration (reason required, audited)
-- ---------------------------------------------------------------------
create or replace function public.verify_revoke(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_row public.document_verifications; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then raise exception 'REASON_REQUIRED' using errcode = '22000'; end if;
  select * into v_row from public.document_verifications where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status not in ('PENDING', 'ACTIVE') then raise exception 'VERIFY_INVALID_TRANSITION' using errcode = '22000'; end if;
  update public.document_verifications
     set status = 'REVOKED', revoked_at = now(), revoked_by = auth.uid(), revocation_reason = v_reason, updated_at = now()
   where id = p_id;
  perform public.write_log('document_verifications', p_id, 'VERIFICATION_REVOKED', jsonb_build_object('status', v_row.status),
    jsonb_build_object('status', 'REVOKED', 'reason', v_reason));
end; $$;

create or replace function public.verify_supersede(p_old uuid, p_new uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_old public.document_verifications; v_new public.document_verifications; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then raise exception 'REASON_REQUIRED' using errcode = '22000'; end if;
  if p_old is null or p_new is null or p_old = p_new then raise exception 'VERIFY_INVALID' using errcode = '22000'; end if;
  select * into v_old from public.document_verifications where id = p_old for update;
  select * into v_new from public.document_verifications where id = p_new for update;
  if v_old.id is null or v_new.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_old.status <> 'ACTIVE' or v_new.status <> 'ACTIVE' or v_old.document_type <> v_new.document_type then
    raise exception 'VERIFY_INVALID_TRANSITION' using errcode = '22000';
  end if;
  update public.document_verifications
     set status = 'SUPERSEDED', superseded_by_verification_id = p_new, revoked_at = now(), revoked_by = auth.uid(), revocation_reason = v_reason, updated_at = now()
   where id = p_old;
  perform public.write_log('document_verifications', p_old, 'VERIFICATION_SUPERSEDED', jsonb_build_object('status', 'ACTIVE'),
    jsonb_build_object('status', 'SUPERSEDED', 'superseded_by', p_new, 'reason', v_reason));
end; $$;

-- candidates for "superseded by": the ACTIVE verifications of one document type (admin only; code + number only)
create or replace function public.verify_list_active(p_type text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_type is null or p_type not in ('OUTGOING_CORRESPONDENCE', 'PROFORMA', 'INVOICE', 'CONTRACT') then raise exception 'VERIFY_INVALID' using errcode = '22000'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'code', x.verification_code, 'document_number', x.document_number_snapshot) order by x.created_at desc)
                     from (select * from public.document_verifications v where v.document_type = p_type and v.status = 'ACTIVE' order by v.created_at desc limit 200) x),
                  '[]'::jsonb);
end; $$;

create or replace function public.verify_get_settings()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return jsonb_build_object(
    'settings', (select to_jsonb(s) - 'updated_by' from public.verification_settings s where s.id = 1),
    'types', coalesce((select jsonb_agg(to_jsonb(t) - 'updated_by' order by t.document_type) from public.verification_doc_types t), '[]'::jsonb));
end; $$;

create or replace function public.verify_update_settings(p_enabled boolean, p_issuer_name text, p_public_label text, p_show_contract_amount boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare v_old public.verification_settings;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_enabled is null or p_show_contract_amount is null or length(btrim(coalesce(p_issuer_name, ''))) not between 1 and 200
     or length(btrim(coalesce(p_public_label, ''))) not between 1 and 120 then
    raise exception 'VERIFY_INVALID' using errcode = '22000';
  end if;
  select * into v_old from public.verification_settings where id = 1 for update;
  update public.verification_settings
     set enabled = p_enabled, issuer_name = btrim(p_issuer_name), public_label = btrim(p_public_label), show_contract_amount = p_show_contract_amount,
         updated_by = auth.uid(), updated_at = now()
   where id = 1;
  perform public.write_log('verification_settings', null, 'VERIFY_SETTINGS_CHANGED',
    jsonb_build_object('enabled', v_old.enabled, 'show_contract_amount', v_old.show_contract_amount),
    jsonb_build_object('enabled', p_enabled, 'show_contract_amount', p_show_contract_amount));
end; $$;

create or replace function public.verify_update_doc_type(
  p_type text, p_enabled boolean, p_page text, p_x numeric, p_y numeric, p_size numeric, p_show_label boolean, p_show_code boolean, p_label_text text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  begin
    update public.verification_doc_types
       set enabled = p_enabled, page = p_page, x_mm = p_x, y_mm = p_y, size_mm = p_size, show_label = p_show_label, show_code = p_show_code,
           label_text = btrim(p_label_text), updated_by = auth.uid(), updated_at = now()
     where document_type = p_type;
  exception when check_violation or not_null_violation or numeric_value_out_of_range then
    raise exception 'VERIFY_INVALID' using errcode = '22000';
  end;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.write_log('verification_settings', null, 'VERIFY_LAYOUT_CHANGED', null,
    jsonb_build_object('document_type', p_type, 'enabled', p_enabled, 'page', p_page, 'x_mm', p_x, 'y_mm', p_y, 'size_mm', p_size));
end; $$;

-- ---------------------------------------------------------------------
-- 7) automatic REVOKE when the underlying document is cancelled (user decision)
-- ---------------------------------------------------------------------
create or replace function public.tg_verification_autorevoke()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_type text; v_n integer;
begin
  if new.status::text <> 'CANCELLED' or old.status::text = 'CANCELLED' then return new; end if;
  -- NOT new.type: a bare field reference is resolved when the expression is planned, so it would fail on tables without that column
  v_type := case tg_table_name when 'correspondence' then 'OUTGOING_CORRESPONDENCE' when 'contracts' then 'CONTRACT' else to_jsonb(new) ->> 'type' end;
  update public.document_verifications
     set status = 'REVOKED', revoked_at = now(), revoked_by = auth.uid(), revocation_reason = 'DOCUMENT_CANCELLED', updated_at = now()
   where document_type = v_type and document_id = new.id and status in ('PENDING', 'ACTIVE');
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform public.write_log('document_verifications', new.id, 'VERIFICATION_REVOKED', null, jsonb_build_object('reason', 'DOCUMENT_CANCELLED', 'document_type', v_type));
  end if;
  return new;
end; $$;

drop trigger if exists trg_verification_autorevoke on public.correspondence;
create trigger trg_verification_autorevoke after update of status on public.correspondence
  for each row execute function public.tg_verification_autorevoke();
drop trigger if exists trg_verification_autorevoke on public.sales_documents;
create trigger trg_verification_autorevoke after update of status on public.sales_documents
  for each row execute function public.tg_verification_autorevoke();
drop trigger if exists trg_verification_autorevoke on public.contracts;
create trigger trg_verification_autorevoke after update of status on public.contracts
  for each row execute function public.tg_verification_autorevoke();

-- ---------------------------------------------------------------------
-- 8) PUBLIC side (service_role ONLY — the public route calls these after its own rate limit). Fixed allow-list projection.
-- ---------------------------------------------------------------------
create or replace function public.verify_rate_check(p_scope text, p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_ws timestamptz; v_cnt integer;
begin
  if p_scope is null or p_scope !~ '^[A-Z_]{2,30}$' or p_key is null or p_key !~ '^[0-9a-f]{16,64}$'
     or p_limit is null or p_limit < 1 or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'VERIFY_INVALID' using errcode = '22000';
  end if;
  v_ws := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.verification_rate_limits (scope, key, window_start, count) values (p_scope, p_key, v_ws, 1)
  on conflict (scope, key, window_start) do update set count = public.verification_rate_limits.count + 1
  returning count into v_cnt;
  if random() < 0.02 then
    delete from public.verification_rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_cnt <= p_limit;
end; $$;

create or replace function public.verify_public_lookup(p_token_hash text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row public.document_verifications; v_s public.verification_settings; v_next public.document_verifications;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('found', false); end if;
  select * into v_row from public.document_verifications where token_hash = p_token_hash and status <> 'PENDING';     -- a PENDING record is not public yet
  if not found then return jsonb_build_object('found', false); end if;
  select * into v_s from public.verification_settings where id = 1;
  update public.document_verifications set verification_count = verification_count + 1, last_verified_at = now() where id = v_row.id;
  if v_row.superseded_by_verification_id is not null then
    select * into v_next from public.document_verifications where id = v_row.superseded_by_verification_id;
  end if;
  return jsonb_build_object(
    'found', true,
    'status', v_row.status,
    'document_type', v_row.document_type,
    'document_number', v_row.document_number_snapshot,
    'issued_at', v_row.issued_at,
    'issuer', v_row.issuer_snapshot,
    'code', v_row.verification_code,
    'public_label', v_s.public_label,
    'metadata', v_row.public_metadata_snapshot,
    'revoked_at', case when v_row.status in ('REVOKED', 'SUPERSEDED') then v_row.revoked_at end,
    'replacement', case when v_next.id is not null then jsonb_build_object('document_number', v_next.document_number_snapshot, 'document_type', v_next.document_type) end);
end; $$;

create or replace function public.verify_public_hash_check(p_token_hash text, p_hash text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row public.document_verifications;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('found', false); end if;
  select * into v_row from public.document_verifications where token_hash = p_token_hash and status <> 'PENDING';
  if not found then return jsonb_build_object('found', false); end if;
  if p_hash is null or lower(p_hash) !~ '^[0-9a-f]{64}$' then return jsonb_build_object('found', true, 'invalid', true, 'match', false); end if;
  return jsonb_build_object('found', true, 'match', v_row.pdf_hash = lower(p_hash), 'status', v_row.status, 'algorithm', v_row.pdf_hash_algorithm);
end; $$;

-- ---------------------------------------------------------------------
-- 9) grants
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    '_verify_require_issuer(text)', '_verify_require_reader(text)', '_verify_snapshot(text,uuid)', '_verify_new_code()',
    'verify_rate_check(text,text,integer,integer)', 'verify_public_lookup(text)', 'verify_public_hash_check(text,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array[
    'verify_get_config(text)', 'verify_begin(text,uuid,text)', 'verify_activate(uuid,text,bigint,text)', 'verify_document_status(text,uuid)',
    'verify_revoke(uuid,text)', 'verify_supersede(uuid,uuid,text)', 'verify_get_settings()', 'verify_list_active(text)',
    'verify_update_settings(boolean,text,text,boolean)', 'verify_update_doc_type(text,boolean,text,numeric,numeric,numeric,boolean,boolean,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 10) Factory Reset integration (0141): classify the new tables, add the storage prefix, make registered verified PDFs "known"
-- ---------------------------------------------------------------------
insert into public.system_reset_manifest
  (object_name, module, classification, mode_a, mode_b, reason, risk, reset_order, sequence_impact, storage_impact, manifest_version)
values
  ('document_verifications',   'verify', 'DELETE',   'DELETE',   'DELETE',   'Verification records of issued documents (operational; their documents are deleted by the reset)', 'MEDIUM', 15, '-', 'verified/ final PDFs'),
  ('verification_rate_limits', 'verify', 'DELETE',   'DELETE',   'DELETE',   'Transient public-verify rate-limit counters', 'LOW', 15, '-', '-'),
  ('verification_settings',    'verify', 'PRESERVE', 'PRESERVE', 'PRESERVE', 'NIL Verify configuration (enabled, issuer name, public label, contract-amount policy)', 'LOW', 200, '-', '-'),
  ('verification_doc_types',   'verify', 'PRESERVE', 'PRESERVE', 'PRESERVE', 'NIL Verify per-document-type enablement and QR layout', 'LOW', 200, '-', '-')
on conflict (object_name) do update set
  module = excluded.module, classification = excluded.classification, mode_a = excluded.mode_a, mode_b = excluded.mode_b,
  reason = excluded.reason, risk = excluded.risk, reset_order = excluded.reset_order, sequence_impact = excluded.sequence_impact,
  storage_impact = excluded.storage_impact, manifest_version = excluded.manifest_version;

insert into public.system_reset_storage_rules (prefix, action, reason)
values ('verified/', 'DELETE', 'NIL Verify frozen final PDFs')
on conflict (prefix) do update set action = excluded.action, reason = excluded.reason;

-- restated from its CURRENT body (0141 only): + paths registered by document_verifications
create or replace function public._srs_storage_classify()
returns table (path text, action text, reason text)
language plpgsql stable security definer set search_path = public, storage as $$
begin
  return query
  with obj as (
    select o.name
      from storage.objects o
     where o.bucket_id = 'nil-files' and o.name not like '%/.emptyFolderPlaceholder' and o.name <> '.emptyFolderPlaceholder'
  ), keep as (
    select a.letterhead_path as p from public.app_settings a
    union select a.stamp_path from public.app_settings a
    union select pr.signature_path from public.profiles pr
  ), reg as (
    select x.storage_path as p from public.attachments x
    union select x.storage_path from public.trade_offer_documents x
    union select x.storage_path from public.client_service_reports x
    union select x.storage_path from public.external_intake_documents x
    union select x.storage_path from public.payroll_payslips x
    union select x.pdf_storage_path from public.document_verifications x where x.pdf_storage_path is not null
  ), best as (
    select o.name,
           (select r.prefix from public.system_reset_storage_rules r where starts_with(o.name, r.prefix) order by length(r.prefix) desc limit 1) as pfx
      from obj o
  )
  select b.name::text,
         (case when b.name in (select k.p from keep k where k.p is not null) then 'PRESERVE'
               when rr.action is not null then rr.action
               when b.name in (select g.p from reg g) then 'DELETE'
               else 'UNKNOWN' end)::text,
         (case when b.name in (select k.p from keep k where k.p is not null) then 'branding / signature path in use'
               when rr.action is not null then rr.reason
               when b.name in (select g.p from reg g) then 'registered by a reset table'
               else 'unclassified prefix: reported, never deleted' end)::text
    from best b
    left join public.system_reset_storage_rules rr on rr.prefix = b.pfx;
end; $$;

-- =====================================================================
-- ROLLBACK: drop triggers trg_verification_autorevoke on correspondence / sales_documents / contracts; drop the verify_* / _verify_* functions;
--   drop table document_verifications, verification_rate_limits, verification_doc_types, verification_settings (loses all verification records);
--   delete from system_reset_manifest where object_name in (...the four above...); delete from system_reset_storage_rules where prefix = 'verified/';
--   re-run 0141's _srs_storage_classify.
-- =====================================================================

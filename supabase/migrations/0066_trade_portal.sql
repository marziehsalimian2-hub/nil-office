-- =====================================================================
-- NIL Office — 0066_trade_portal.sql
-- Trade Portal v0.1 Pilot — NIL staff create commercial "offers" and
-- generate secure, single-purpose links so external buyers can view an
-- offer and respond (interest / LOI / ICPO) without ever holding a NIL
-- Office account. Forward-only, fully idempotent, self-contained — does
-- not modify any pre-existing table, function, or policy from 0001-0065
-- except two additive, backward-compatible extensions explicitly called
-- out below (format_display_number gets one more `when` branch;
-- number_sequences' scope CHECK gets one more allowed value — both are
-- the exact same technique already used for CRM/OPPORTUNITY in 0040).
--
-- SECURITY MODEL (see docs/trade-portal.md for the full write-up):
--   * Every trade_* table has RLS enabled with SELECT-only policies for
--     `authenticated` (gated by the trade_role 4-tier below). No table
--     ever gets an INSERT/UPDATE/DELETE policy for a buyer-reachable
--     role — all writes for buyer_assignment/response/document/deadline
--     history/events happen exclusively through SECURITY DEFINER
--     functions below, which run with the function owner's privileges
--     and therefore bypass RLS by design (same mechanism already used
--     for crm_opportunity_stage_history's insert-only trigger, 0043-44).
--   * `anon` is granted NOTHING on any trade_* table or function. Every
--     buyer-facing operation is reached only via the Next.js service-
--     role client (lib/supabase/service.ts), calling one of the
--     `trade_get_buyer_view` / `trade_submit_response` /
--     `trade_record_document_upload` functions below, each of which
--     re-derives authorization from the token hash on every single call
--     — never from a cached/trusted prior check.
--   * No raw token is ever stored. `trade_offer_buyers.token_hash` is
--     the caller-supplied SHA-256 hex of a 256-bit random token
--     generated in Node (lib/trade/token.ts) — this migration never
--     generates, sees, or stores the raw value.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. trade_role permission tier — identical 4-tier shape to
--    crm_role/project_role (0043_crm_functions.sql:11-51).
-- ---------------------------------------------------------------------
do $$ begin
  create type trade_role as enum ('VIEW','CREATE','APPROVE','ADMIN');
exception when duplicate_object then null; end $$;

alter table public.profiles add column if not exists trade_role trade_role;

create or replace function public.has_trade_access()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or trade_role is not null)
  );
$$;

create or replace function public.can_create_trade()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or trade_role in ('CREATE','APPROVE','ADMIN'))
  );
$$;

create or replace function public.can_approve_trade()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or trade_role in ('APPROVE','ADMIN'))
  );
$$;

create or replace function public.is_trade_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or trade_role = 'ADMIN')
  );
$$;

-- 8th layering of the self-escalation freeze on profiles (0009 -> 0011 ->
-- 0023_contract_rls.sql -> 0032_sales_document_rls.sql -> 0044_crm_rls.sql
-- -> 0053(project) -> here), adding trade_role.
drop policy if exists p_profiles_update_self on public.profiles;
create policy p_profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and role             =              (select role             from public.profiles where id = auth.uid())
    and accounting_role  is not distinct from (select accounting_role from public.profiles where id = auth.uid())
    and contract_role    is not distinct from (select contract_role   from public.profiles where id = auth.uid())
    and invoice_role     is not distinct from (select invoice_role    from public.profiles where id = auth.uid())
    and crm_role         is not distinct from (select crm_role        from public.profiles where id = auth.uid())
    and project_role     is not distinct from (select project_role    from public.profiles where id = auth.uid())
    and trade_role        is not distinct from (select trade_role      from public.profiles where id = auth.uid())
    and is_active        =              (select is_active        from public.profiles where id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 2. Numbering — additive branch on the existing shared functions.
-- ---------------------------------------------------------------------
alter table public.number_sequences drop constraint if exists ck_sequence_scope;
alter table public.number_sequences add constraint ck_sequence_scope
  check (scope in ('OUTGOING','INCOMING','CASE','CONTRACT','PROFORMA','INVOICE','OPPORTUNITY','PROJECT','OFFER'));

create or replace function public.format_display_number(p_scope text, p_year int, p_seq int)
returns text
language sql
immutable
as $$
  select case p_scope
    when 'OUTGOING'    then 'ص-'   || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'INCOMING'    then 'و-'   || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'CASE'        then 'CASE-' || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'CONTRACT'    then 'CTR-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'PROFORMA'    then 'PI-'   || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'INVOICE'     then 'INV-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'OPPORTUNITY' then 'OPP-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'PROJECT'     then 'PRJ-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'OFFER'       then 'OFR-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    else p_scope || '-' || p_year::text || '-' || lpad(p_seq::text, 4, '0')
  end;
$$;

-- ---------------------------------------------------------------------
-- 3. trade_offers — numbered AT INSERT (like CRM opportunities, not
--    like contracts/invoices): an offer isn't a legal document with a
--    deferred-draft numbering gap, it just needs a stable, immutable
--    code from the moment it exists. document_deadline is guaranteed
--    >= interest_deadline by CHECK, which lets EXPIRED be computed off
--    document_deadline alone (see trade_offer_effective_status below).
-- ---------------------------------------------------------------------
create table if not exists public.trade_offers (
  id                  uuid primary key default gen_random_uuid(),

  sequence_number     integer not null,
  offer_code          text not null,
  year                integer not null,

  title               text not null,
  product_name        text not null,
  product_type        text,
  quantity            numeric(20,4) not null check (quantity > 0),
  unit                text not null,
  price               numeric(20,4) not null check (price >= 0),
  currency_code       text not null default 'USD'
    check (currency_code in ('IRR','TOMAN','USD','EUR','AED','TRY','CNY')),
  price_basis         text not null,

  origin              text,
  delivery_location   text,
  delivery_terms      text,
  payment_terms       text,
  description         text,
  terms_and_conditions text,

  interest_deadline   timestamptz not null,
  document_deadline   timestamptz not null,
  timezone            text not null default 'Asia/Tehran',

  status              text not null default 'DRAFT'
    check (status in ('DRAFT','ACTIVE','EXPIRED','CLOSED','CANCELLED')),

  created_by          uuid not null references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  published_at        timestamptz,
  closed_at           timestamptz,
  cancelled_at        timestamptz,

  constraint ck_trade_offer_deadlines check (document_deadline >= interest_deadline)
);

create unique index if not exists uq_trade_offer_seq    on public.trade_offers (year, sequence_number);
create unique index if not exists uq_trade_offer_code   on public.trade_offers (offer_code);
create index if not exists idx_trade_offers_status      on public.trade_offers (status);
create index if not exists idx_trade_offers_created_by  on public.trade_offers (created_by);
create index if not exists idx_trade_offers_product     on public.trade_offers (product_name);

-- ---------------------------------------------------------------------
-- 4. trade_offer_buyers — one buyer (existing `companies` row) assigned
--    to one offer, with token metadata. No RLS write policy at all
--    (see security model banner) — assign/revoke/rotate are exclusively
--    the SECURITY DEFINER RPCs below (§8). Partial unique index: at
--    most one LIVE (non-revoked) assignment per (offer, company) at a
--    time; rotation revokes-then-inserts, never updates a token in
--    place, so a leaked/rotated link is provably unusable afterward.
-- ---------------------------------------------------------------------
create table if not exists public.trade_offer_buyers (
  id                 uuid primary key default gen_random_uuid(),
  offer_id           uuid not null references public.trade_offers(id) on delete cascade,
  company_id         uuid not null references public.companies(id) on delete restrict,

  token_hash         text not null,
  token_expires_at   timestamptz not null,
  revoked_at         timestamptz,
  last_viewed_at     timestamptz,

  created_by         uuid not null references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists uq_trade_offer_buyer_token on public.trade_offer_buyers (token_hash);
create unique index if not exists uq_trade_offer_buyer_live
  on public.trade_offer_buyers (offer_id, company_id) where revoked_at is null;
create index if not exists idx_trade_offer_buyers_offer   on public.trade_offer_buyers (offer_id);
create index if not exists idx_trade_offer_buyers_company on public.trade_offer_buyers (company_id);

-- ---------------------------------------------------------------------
-- 5. trade_offer_responses — append-only (spec §51: history, not a
--    single mutable "current response" row). "Current" = latest row per
--    buyer_assignment_id, ordered by created_at. No RLS write policy —
--    only trade_submit_response() (§9) can insert.
-- ---------------------------------------------------------------------
create table if not exists public.trade_offer_responses (
  id                  uuid primary key default gen_random_uuid(),
  offer_id            uuid not null references public.trade_offers(id) on delete cascade,
  buyer_assignment_id uuid not null references public.trade_offer_buyers(id) on delete cascade,
  response_type       text not null check (response_type in ('INTERESTED','NOT_INTERESTED','REQUEST_MORE_TIME')),
  explanation         text,
  created_at          timestamptz not null default now()
);

create index if not exists idx_trade_offer_responses_assignment
  on public.trade_offer_responses (buyer_assignment_id, created_at desc);
create index if not exists idx_trade_offer_responses_offer on public.trade_offer_responses (offer_id);

-- ---------------------------------------------------------------------
-- 6. trade_offer_documents — one row per uploaded LOI/ICPO. Deliberately
--    NOT the existing generic attachments/attach_entity mechanism —
--    that mechanism's upload flow and storage RLS are authenticated-
--    only by design (is_active_user()-gated); bending it to also serve
--    an anonymous actor would weaken a working, authenticated-only
--    invariant elsewhere in the app. Storage path convention (deter-
--    ministic, spec §28): trade/offers/{offer_id}/buyers/{buyer_
--    assignment_id}/{document_id}/{safe_file_name}, in the existing
--    private `nil-files` bucket (0005_storage.sql) — no bucket/policy
--    change needed, the buyer upload path always goes through the
--    service-role client, which bypasses storage RLS entirely.
-- ---------------------------------------------------------------------
create table if not exists public.trade_offer_documents (
  id                  uuid primary key default gen_random_uuid(),
  offer_id            uuid not null references public.trade_offers(id) on delete cascade,
  buyer_assignment_id uuid not null references public.trade_offer_buyers(id) on delete cascade,
  document_type       text not null check (document_type in ('LOI','ICPO')),
  storage_path        text not null,
  file_name           text not null,
  mime_type           text not null,
  size_bytes          bigint not null check (size_bytes > 0),
  uploaded_at         timestamptz not null default now()
);

create unique index if not exists uq_trade_offer_document_path on public.trade_offer_documents (storage_path);
create index if not exists idx_trade_offer_documents_assignment on public.trade_offer_documents (buyer_assignment_id);
create index if not exists idx_trade_offer_documents_offer on public.trade_offer_documents (offer_id);

-- ---------------------------------------------------------------------
-- 7. trade_offer_deadline_history — insert-only (spec §23: extension
--    history must never be deleted). No RLS write policy — only
--    extend_trade_offer_deadline() (§8) can insert.
-- ---------------------------------------------------------------------
create table if not exists public.trade_offer_deadline_history (
  id            uuid primary key default gen_random_uuid(),
  offer_id      uuid not null references public.trade_offers(id) on delete cascade,
  deadline_type text not null check (deadline_type in ('INTEREST','DOCUMENT')),
  old_value     timestamptz not null,
  new_value     timestamptz not null,
  changed_by    uuid not null references public.profiles(id),
  changed_at    timestamptz not null default now(),
  reason        text
);

create index if not exists idx_trade_offer_deadline_history_offer
  on public.trade_offer_deadline_history (offer_id, changed_at desc);

-- ---------------------------------------------------------------------
-- 8. trade_offer_events — the audit trail (spec §31). NOT routed
--    through the existing write_log()/activity_logs mechanism, because
--    that function hardcodes auth.uid() as the actor
--    (0003_functions.sql:42-58) and a buyer action has no auth.uid() at
--    all. Own table, with an explicit actor_type/actor_user_id pair so
--    ADMIN/BUYER/SYSTEM events are distinguishable. Never stores a raw
--    token or its hash — only buyer_assignment_id. No RLS write policy
--    — only the SECURITY DEFINER functions below insert into it.
-- ---------------------------------------------------------------------
create table if not exists public.trade_offer_events (
  id                  uuid primary key default gen_random_uuid(),
  offer_id            uuid not null references public.trade_offers(id) on delete cascade,
  buyer_assignment_id uuid references public.trade_offer_buyers(id) on delete set null,
  event_type          text not null check (event_type in (
    'OFFER_CREATED','OFFER_UPDATED','OFFER_PUBLISHED','OFFER_VIEWED',
    'BUYER_ASSIGNED','BUYER_ACCESS_CREATED','BUYER_RESPONSE_SUBMITTED',
    'MORE_TIME_REQUESTED','DOCUMENT_UPLOADED','DEADLINE_EXTENDED',
    'OFFER_EXPIRED','OFFER_CLOSED','OFFER_CANCELLED','ACCESS_REVOKED'
  )),
  actor_type   text not null check (actor_type in ('ADMIN','BUYER','SYSTEM')),
  actor_user_id uuid references public.profiles(id),
  metadata     jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists idx_trade_offer_events_offer on public.trade_offer_events (offer_id, created_at desc);
create index if not exists idx_trade_offer_events_assignment on public.trade_offer_events (buyer_assignment_id);

-- ---------------------------------------------------------------------
-- 9. touch/audit triggers — trade_offers and trade_offer_buyers only
--    (the append-only log-shaped tables have no updated_at and are
--    already their own audit trail). Mirrors the exact loop shape used
--    everywhere else (0003_functions.sql:324-334, 367-377).
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['trade_offers','trade_offer_buyers']
  loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s;', t);
    execute format(
      'create trigger trg_touch_%1$s before update on public.%1$s
       for each row execute function public.tg_touch_updated_at();', t);
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$s;', t);
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$s
       for each row execute function public.tg_audit();', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 10. tg_trade_offer_number — numbers an offer at INSERT time, and
--     stamps a semantic OFFER_CREATED event (distinct from tg_audit's
--     generic 'CREATED' row above — this one carries the offer_code and
--     satisfies spec §31's literal event_type list).
-- ---------------------------------------------------------------------
create or replace function public.tg_trade_offer_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int;
  v_seq  int;
begin
  v_year := public.jalali_year(now());
  v_seq  := public.allocate_sequence('OFFER', v_year);

  new.year            := v_year;
  new.sequence_number := v_seq;
  new.offer_code       := public.format_display_number('OFFER', v_year, v_seq);

  return new;
end;
$$;

drop trigger if exists trg_trade_offer_number on public.trade_offers;
create trigger trg_trade_offer_number
  before insert on public.trade_offers
  for each row execute function public.tg_trade_offer_number();

create or replace function public.tg_trade_offer_created_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.trade_offer_events (offer_id, event_type, actor_type, actor_user_id, metadata)
  values (new.id, 'OFFER_CREATED', 'ADMIN', new.created_by, jsonb_build_object('offer_code', new.offer_code));
  return new;
end;
$$;

drop trigger if exists trg_trade_offer_created_event on public.trade_offers;
create trigger trg_trade_offer_created_event
  after insert on public.trade_offers
  for each row execute function public.tg_trade_offer_created_event();

-- ---------------------------------------------------------------------
-- 11. trade_offer_effective_status — pure, single source of truth for
--     "is this offer actually still open", used both by the admin list
--     sweep and by every buyer-facing authorization check below. EXPIRED
--     is derived from document_deadline alone because the table CHECK
--     guarantees document_deadline >= interest_deadline, so document_
--     deadline is always the later of the two.
-- ---------------------------------------------------------------------
create or replace function public.trade_offer_effective_status(
  p_status text,
  p_document_deadline timestamptz,
  p_now timestamptz default now()
)
returns text
language sql
stable
as $$
  select case
    when p_status in ('DRAFT','CLOSED','CANCELLED') then p_status
    when p_now > p_document_deadline then 'EXPIRED'
    else 'ACTIVE'
  end;
$$;

-- ---------------------------------------------------------------------
-- 12. publish_trade_offer / set_trade_offer_status / extend_trade_
--     offer_deadline — the only sanctioned status-transition paths.
--     Gated can_approve_trade() (mirrors contract/invoice "finalize"
--     tier) — a plain UPDATE on trade_offers cannot change `status` at
--     all once it leaves DRAFT (RLS §13 restricts the app's own UPDATE
--     policy to status='DRAFT' rows), so these RPCs are the only route.
-- ---------------------------------------------------------------------
create or replace function public.publish_trade_offer(p_id uuid)
returns public.trade_offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.trade_offers;
begin
  if not public.can_approve_trade() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_row from public.trade_offers where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status <> 'DRAFT' then
    raise exception 'NOT_ELIGIBLE' using errcode = '22000';
  end if;
  if v_row.document_deadline <= now() then
    raise exception 'DEADLINE_ALREADY_PASSED' using errcode = '22000';
  end if;

  update public.trade_offers
     set status = 'ACTIVE', published_at = now(), updated_at = now()
   where id = p_id
   returning * into v_row;

  insert into public.trade_offer_events (offer_id, event_type, actor_type, actor_user_id)
  values (p_id, 'OFFER_PUBLISHED', 'ADMIN', auth.uid());

  return v_row;
end;
$$;

create or replace function public.set_trade_offer_status(p_id uuid, p_new_status text)
returns public.trade_offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.trade_offers;
  v_eff text;
begin
  if not public.can_approve_trade() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_new_status not in ('CLOSED','CANCELLED') then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000';
  end if;

  select * into v_row from public.trade_offers where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  v_eff := public.trade_offer_effective_status(v_row.status, v_row.document_deadline);
  if v_eff not in ('ACTIVE','EXPIRED') then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000';
  end if;

  update public.trade_offers
     set status = p_new_status,
         closed_at    = case when p_new_status = 'CLOSED'    then now() else closed_at end,
         cancelled_at = case when p_new_status = 'CANCELLED' then now() else cancelled_at end,
         updated_at = now()
   where id = p_id
   returning * into v_row;

  insert into public.trade_offer_events (offer_id, event_type, actor_type, actor_user_id)
  values (p_id, case when p_new_status = 'CLOSED' then 'OFFER_CLOSED' else 'OFFER_CANCELLED' end, 'ADMIN', auth.uid());

  return v_row;
end;
$$;

create or replace function public.extend_trade_offer_deadline(
  p_id uuid,
  p_deadline_type text,
  p_new_value timestamptz,
  p_reason text default null
)
returns public.trade_offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.trade_offers;
  v_old timestamptz;
begin
  if not public.can_approve_trade() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_deadline_type not in ('INTEREST','DOCUMENT') then
    raise exception 'INVALID_DEADLINE_TYPE' using errcode = '22000';
  end if;
  if p_new_value <= now() then
    raise exception 'DEADLINE_MUST_BE_FUTURE' using errcode = '22000';
  end if;

  select * into v_row from public.trade_offers where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status in ('CLOSED','CANCELLED','DRAFT') then
    raise exception 'NOT_ELIGIBLE' using errcode = '22000';
  end if;

  if p_deadline_type = 'INTEREST' then
    v_old := v_row.interest_deadline;
    if p_new_value > v_row.document_deadline then
      raise exception 'INTEREST_DEADLINE_AFTER_DOCUMENT_DEADLINE' using errcode = '22000';
    end if;
    update public.trade_offers set interest_deadline = p_new_value, updated_at = now()
     where id = p_id returning * into v_row;
  else
    v_old := v_row.document_deadline;
    if p_new_value < v_row.interest_deadline then
      raise exception 'DOCUMENT_DEADLINE_BEFORE_INTEREST_DEADLINE' using errcode = '22000';
    end if;
    update public.trade_offers set document_deadline = p_new_value, updated_at = now()
     where id = p_id returning * into v_row;
  end if;

  -- The only path back from EXPIRED (spec §8/§23): a fresh future
  -- document_deadline makes the offer effectively open again.
  if v_row.status = 'EXPIRED' and public.trade_offer_effective_status(v_row.status, v_row.document_deadline) = 'ACTIVE' then
    update public.trade_offers set status = 'ACTIVE', updated_at = now() where id = p_id returning * into v_row;
  end if;

  insert into public.trade_offer_deadline_history (offer_id, deadline_type, old_value, new_value, changed_by, reason)
  values (p_id, p_deadline_type, v_old, p_new_value, auth.uid(), p_reason);

  insert into public.trade_offer_events (offer_id, event_type, actor_type, actor_user_id, metadata)
  values (p_id, 'DEADLINE_EXTENDED', 'ADMIN', auth.uid(),
          jsonb_build_object('deadline_type', p_deadline_type, 'old_value', v_old, 'new_value', p_new_value));

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- 13. sync_trade_offers_expiry — opportunistic, idempotent sweep (spec
--     §11: no cron needed for a pilot; "server requests can synchronize
--     an expired offer"). Called from the admin list/detail loaders.
--     Purely a UX nicety for the stored `status` column — buyer-facing
--     authorization NEVER relies on this having run; every buyer RPC
--     below recomputes effective status live against now() regardless.
-- ---------------------------------------------------------------------
create or replace function public.sync_trade_offers_expiry(p_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if not public.has_trade_access() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  for r in
    select id from public.trade_offers
     where (p_id is null or id = p_id)
       and status = 'ACTIVE' and now() > document_deadline
     for update
  loop
    update public.trade_offers set status = 'EXPIRED', updated_at = now() where id = r.id;
    insert into public.trade_offer_events (offer_id, event_type, actor_type)
    values (r.id, 'OFFER_EXPIRED', 'SYSTEM');
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 14. Buyer assignment / token lifecycle — assign / revoke / rotate.
--     The raw token is generated and hashed entirely in Node
--     (lib/trade/token.ts); these functions only ever see p_token_hash.
-- ---------------------------------------------------------------------
create or replace function public.assign_trade_offer_buyer(
  p_offer_id uuid,
  p_company_id uuid,
  p_token_hash text,
  p_token_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.can_create_trade() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.trade_offers where id = p_offer_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.trade_offer_buyers
     where offer_id = p_offer_id and company_id = p_company_id and revoked_at is null
  ) then
    raise exception 'BUYER_ALREADY_ASSIGNED' using errcode = '22000';
  end if;

  insert into public.trade_offer_buyers (offer_id, company_id, token_hash, token_expires_at, created_by)
  values (p_offer_id, p_company_id, p_token_hash, p_token_expires_at, auth.uid())
  returning id into v_id;

  insert into public.trade_offer_events (offer_id, buyer_assignment_id, event_type, actor_type, actor_user_id)
  values (p_offer_id, v_id, 'BUYER_ASSIGNED', 'ADMIN', auth.uid());
  insert into public.trade_offer_events (offer_id, buyer_assignment_id, event_type, actor_type, actor_user_id)
  values (p_offer_id, v_id, 'BUYER_ACCESS_CREATED', 'ADMIN', auth.uid());

  return v_id;
end;
$$;

create or replace function public.revoke_trade_offer_buyer(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer_id uuid;
begin
  if not public.can_create_trade() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select offer_id into v_offer_id from public.trade_offer_buyers where id = p_assignment_id and revoked_at is null;
  if v_offer_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.trade_offer_buyers set revoked_at = now(), updated_at = now() where id = p_assignment_id;

  insert into public.trade_offer_events (offer_id, buyer_assignment_id, event_type, actor_type, actor_user_id)
  values (v_offer_id, p_assignment_id, 'ACCESS_REVOKED', 'ADMIN', auth.uid());
end;
$$;

-- Rotation = revoke the live row, then assign a brand new one. Returns
-- the new assignment id. The old token_hash can never be un-revoked —
-- "no way to recover the old raw token" is a security property, not a
-- bug (spec §39).
create or replace function public.regenerate_trade_offer_buyer_token(
  p_assignment_id uuid,
  p_new_token_hash text,
  p_new_token_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer_id uuid;
  v_company_id uuid;
  v_new_id uuid;
begin
  if not public.can_create_trade() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select offer_id, company_id into v_offer_id, v_company_id
    from public.trade_offer_buyers where id = p_assignment_id and revoked_at is null;
  if v_offer_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.trade_offer_buyers set revoked_at = now(), updated_at = now() where id = p_assignment_id;
  insert into public.trade_offer_events (offer_id, buyer_assignment_id, event_type, actor_type, actor_user_id)
  values (v_offer_id, p_assignment_id, 'ACCESS_REVOKED', 'ADMIN', auth.uid());

  insert into public.trade_offer_buyers (offer_id, company_id, token_hash, token_expires_at, created_by)
  values (v_offer_id, v_company_id, p_new_token_hash, p_new_token_expires_at, auth.uid())
  returning id into v_new_id;

  insert into public.trade_offer_events (offer_id, buyer_assignment_id, event_type, actor_type, actor_user_id)
  values (v_offer_id, v_new_id, 'BUYER_ACCESS_CREATED', 'ADMIN', auth.uid());

  return v_new_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 15. Buyer-facing functions — the ONLY way an anonymous request ever
--     reads or writes trade data. Each one independently re-derives the
--     full chain: token_hash -> assignment -> revoked/expiry check ->
--     offer status/deadline (live, never the stored column alone) ->
--     authorize -> act -> project only the allowed fields (spec §34).
--     Granted to service_role only (see grants block) — the app never
--     calls these except through lib/supabase/service.ts's client.
-- ---------------------------------------------------------------------
create or replace function public.trade_get_buyer_view(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assign public.trade_offer_buyers;
  v_offer  public.trade_offers;
  v_first_view boolean;
  v_latest public.trade_offer_responses;
  v_eff text;
begin
  select * into v_assign from public.trade_offer_buyers where token_hash = p_token_hash;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'INVALID_LINK');
  end if;
  if v_assign.revoked_at is not null then
    return jsonb_build_object('ok', false, 'error', 'ACCESS_REVOKED');
  end if;
  if now() > v_assign.token_expires_at then
    return jsonb_build_object('ok', false, 'error', 'ACCESS_EXPIRED');
  end if;

  select * into v_offer from public.trade_offers where id = v_assign.offer_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'INVALID_LINK');
  end if;
  if v_offer.status = 'DRAFT' then
    return jsonb_build_object('ok', false, 'error', 'OFFER_NOT_PUBLISHED');
  end if;

  v_eff := public.trade_offer_effective_status(v_offer.status, v_offer.document_deadline);

  v_first_view := (v_assign.last_viewed_at is null);
  update public.trade_offer_buyers set last_viewed_at = now() where id = v_assign.id;
  if v_first_view then
    insert into public.trade_offer_events (offer_id, buyer_assignment_id, event_type, actor_type)
    values (v_offer.id, v_assign.id, 'OFFER_VIEWED', 'BUYER');
  end if;

  select * into v_latest from public.trade_offer_responses
   where buyer_assignment_id = v_assign.id order by created_at desc limit 1;

  return jsonb_build_object(
    'ok', true,
    'state', v_eff,
    'offer', jsonb_build_object(
      'offer_code', v_offer.offer_code,
      'title', v_offer.title,
      'product_name', v_offer.product_name,
      'product_type', v_offer.product_type,
      'quantity', v_offer.quantity,
      'unit', v_offer.unit,
      'price', v_offer.price,
      'currency_code', v_offer.currency_code,
      'price_basis', v_offer.price_basis,
      'origin', v_offer.origin,
      'delivery_location', v_offer.delivery_location,
      'delivery_terms', v_offer.delivery_terms,
      'payment_terms', v_offer.payment_terms,
      'description', v_offer.description,
      'terms_and_conditions', v_offer.terms_and_conditions,
      'interest_deadline', v_offer.interest_deadline,
      'document_deadline', v_offer.document_deadline,
      'timezone', v_offer.timezone,
      'interest_open', (v_eff = 'ACTIVE' and now() <= v_offer.interest_deadline),
      'document_open', (v_eff = 'ACTIVE' and now() <= v_offer.document_deadline)
    ),
    'assignment', jsonb_build_object(
      'viewed_before', not v_first_view,
      'latest_response_type', v_latest.response_type,
      'latest_response_at', v_latest.created_at
    )
  );
end;
$$;

create or replace function public.trade_submit_response(
  p_token_hash text,
  p_response_type text,
  p_explanation text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assign public.trade_offer_buyers;
  v_offer  public.trade_offers;
  v_eff text;
begin
  if p_response_type not in ('INTERESTED','NOT_INTERESTED','REQUEST_MORE_TIME') then
    raise exception 'INVALID_RESPONSE_TYPE' using errcode = '22000';
  end if;

  select * into v_assign from public.trade_offer_buyers where token_hash = p_token_hash;
  if not found then
    raise exception 'TOKEN_INVALID' using errcode = '22000';
  end if;
  if v_assign.revoked_at is not null then
    raise exception 'ACCESS_REVOKED' using errcode = '22000';
  end if;
  if now() > v_assign.token_expires_at then
    raise exception 'TOKEN_EXPIRED' using errcode = '22000';
  end if;

  select * into v_offer from public.trade_offers where id = v_assign.offer_id for update;
  v_eff := public.trade_offer_effective_status(v_offer.status, v_offer.document_deadline);
  if v_eff <> 'ACTIVE' then
    raise exception 'OFFER_NOT_ACTIVE' using errcode = '22000';
  end if;
  if now() > v_offer.interest_deadline then
    raise exception 'INTEREST_DEADLINE_PASSED' using errcode = '22000';
  end if;

  insert into public.trade_offer_responses (offer_id, buyer_assignment_id, response_type, explanation)
  values (v_offer.id, v_assign.id, p_response_type, p_explanation);

  insert into public.trade_offer_events (offer_id, buyer_assignment_id, event_type, actor_type, metadata)
  values (v_offer.id, v_assign.id, 'BUYER_RESPONSE_SUBMITTED', 'BUYER', jsonb_build_object('response_type', p_response_type));

  if p_response_type = 'REQUEST_MORE_TIME' then
    insert into public.trade_offer_events (offer_id, buyer_assignment_id, event_type, actor_type)
    values (v_offer.id, v_assign.id, 'MORE_TIME_REQUESTED', 'BUYER');
  end if;
end;
$$;

create or replace function public.trade_record_document_upload(
  p_token_hash text,
  p_document_id uuid,
  p_document_type text,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assign public.trade_offer_buyers;
  v_offer  public.trade_offers;
  v_eff text;
begin
  if p_document_type not in ('LOI','ICPO') then
    raise exception 'INVALID_DOCUMENT_TYPE' using errcode = '22000';
  end if;

  select * into v_assign from public.trade_offer_buyers where token_hash = p_token_hash;
  if not found then
    raise exception 'TOKEN_INVALID' using errcode = '22000';
  end if;
  if v_assign.revoked_at is not null then
    raise exception 'ACCESS_REVOKED' using errcode = '22000';
  end if;
  if now() > v_assign.token_expires_at then
    raise exception 'TOKEN_EXPIRED' using errcode = '22000';
  end if;

  select * into v_offer from public.trade_offers where id = v_assign.offer_id for update;
  v_eff := public.trade_offer_effective_status(v_offer.status, v_offer.document_deadline);
  if v_eff <> 'ACTIVE' then
    raise exception 'OFFER_NOT_ACTIVE' using errcode = '22000';
  end if;
  if now() > v_offer.document_deadline then
    raise exception 'DOCUMENT_DEADLINE_PASSED' using errcode = '22000';
  end if;

  insert into public.trade_offer_documents
    (id, offer_id, buyer_assignment_id, document_type, storage_path, file_name, mime_type, size_bytes)
  values
    (p_document_id, v_offer.id, v_assign.id, p_document_type, p_storage_path, p_file_name, p_mime_type, p_size_bytes);

  insert into public.trade_offer_events (offer_id, buyer_assignment_id, event_type, actor_type, metadata)
  values (v_offer.id, v_assign.id, 'DOCUMENT_UPLOADED', 'BUYER', jsonb_build_object('document_type', p_document_type, 'document_id', p_document_id));
end;
$$;

-- ---------------------------------------------------------------------
-- 16. RLS — enable on every trade_* table. Only SELECT policies for
--     `authenticated`, gated by the trade_role tier; trade_offers also
--     gets a DRAFT-only INSERT/UPDATE and an ADMIN+DRAFT-only DELETE.
--     No policy of any kind is ever granted to `anon`. See the security
--     model banner at the top of this file for the full rationale.
-- ---------------------------------------------------------------------
alter table public.trade_offers                enable row level security;
alter table public.trade_offer_buyers           enable row level security;
alter table public.trade_offer_responses        enable row level security;
alter table public.trade_offer_documents        enable row level security;
alter table public.trade_offer_deadline_history enable row level security;
alter table public.trade_offer_events           enable row level security;

drop policy if exists p_trade_offers_read   on public.trade_offers;
drop policy if exists p_trade_offers_write  on public.trade_offers;
drop policy if exists p_trade_offers_update on public.trade_offers;
drop policy if exists p_trade_offers_delete on public.trade_offers;
create policy p_trade_offers_read   on public.trade_offers for select using (public.has_trade_access());
create policy p_trade_offers_write  on public.trade_offers for insert with check (public.can_create_trade());
create policy p_trade_offers_update on public.trade_offers for update
  using (public.can_create_trade() and status = 'DRAFT')
  with check (public.can_create_trade() and status = 'DRAFT');
create policy p_trade_offers_delete on public.trade_offers for delete
  using (public.is_trade_admin() and status = 'DRAFT');

do $$
declare t text;
begin
  foreach t in array array[
    'trade_offer_buyers','trade_offer_responses','trade_offer_documents',
    'trade_offer_deadline_history','trade_offer_events'
  ]
  loop
    execute format('drop policy if exists p_%1$s_read on public.%1$s;', t);
    execute format('create policy p_%1$s_read on public.%1$s for select using (public.has_trade_access());', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 17. Grants. Mandatory base object-privilege grant before RLS is even
--     evaluated (the 0013_table_grants.sql gap) — `authenticated` for
--     the admin surface, `service_role` execute-only on the buyer-
--     facing functions (anon gets nothing anywhere, on purpose).
-- ---------------------------------------------------------------------
grant select, insert, update, delete on
  public.trade_offers,
  public.trade_offer_buyers,
  public.trade_offer_responses,
  public.trade_offer_documents,
  public.trade_offer_deadline_history,
  public.trade_offer_events
  to authenticated;

grant execute on function public.has_trade_access()    to authenticated;
grant execute on function public.can_create_trade()     to authenticated;
grant execute on function public.can_approve_trade()    to authenticated;
grant execute on function public.is_trade_admin()       to authenticated;
grant execute on function public.publish_trade_offer(uuid) to authenticated;
grant execute on function public.set_trade_offer_status(uuid, text) to authenticated;
grant execute on function public.extend_trade_offer_deadline(uuid, text, timestamptz, text) to authenticated;
grant execute on function public.sync_trade_offers_expiry(uuid) to authenticated;
grant execute on function public.assign_trade_offer_buyer(uuid, uuid, text, timestamptz) to authenticated;
grant execute on function public.revoke_trade_offer_buyer(uuid) to authenticated;
grant execute on function public.regenerate_trade_offer_buyer_token(uuid, text, timestamptz) to authenticated;
grant execute on function public.trade_offer_effective_status(text, timestamptz, timestamptz) to authenticated;

grant execute on function public.trade_get_buyer_view(text) to service_role;
grant execute on function public.trade_submit_response(text, text, text) to service_role;
grant execute on function public.trade_record_document_upload(text, uuid, text, text, text, text, bigint) to service_role;

-- =====================================================================
-- ROLLBACK — drops ONLY Trade Portal objects. Never touches Companies,
-- Accounting, Correspondence, existing storage, or profiles beyond the
-- trade_role column/self-escalation-freeze layer added above. Restated
-- in docs/trade-portal.md. Run manually and only if the whole module
-- needs to be removed; there is no automatic down-migration mechanism
-- in this project (forward-only, same as every other migration here).
-- ---------------------------------------------------------------------
-- drop function if exists public.trade_record_document_upload(text, uuid, text, text, text, text, bigint);
-- drop function if exists public.trade_submit_response(text, text, text);
-- drop function if exists public.trade_get_buyer_view(text);
-- drop function if exists public.regenerate_trade_offer_buyer_token(uuid, text, timestamptz);
-- drop function if exists public.revoke_trade_offer_buyer(uuid);
-- drop function if exists public.assign_trade_offer_buyer(uuid, uuid, text, timestamptz);
-- drop function if exists public.sync_trade_offers_expiry(uuid);
-- drop function if exists public.extend_trade_offer_deadline(uuid, text, timestamptz, text);
-- drop function if exists public.set_trade_offer_status(uuid, text);
-- drop function if exists public.publish_trade_offer(uuid);
-- drop function if exists public.trade_offer_effective_status(text, timestamptz, timestamptz);
-- drop trigger if exists trg_trade_offer_created_event on public.trade_offers;
-- drop function if exists public.tg_trade_offer_created_event();
-- drop trigger if exists trg_trade_offer_number on public.trade_offers;
-- drop function if exists public.tg_trade_offer_number();
-- drop table if exists public.trade_offer_events;
-- drop table if exists public.trade_offer_deadline_history;
-- drop table if exists public.trade_offer_documents;
-- drop table if exists public.trade_offer_responses;
-- drop table if exists public.trade_offer_buyers;
-- drop table if exists public.trade_offers;
-- alter table public.number_sequences drop constraint if exists ck_sequence_scope;
-- alter table public.number_sequences add constraint ck_sequence_scope
--   check (scope in ('OUTGOING','INCOMING','CASE','CONTRACT','PROFORMA','INVOICE','OPPORTUNITY','PROJECT'));
-- delete from public.number_sequences where scope = 'OFFER';
-- -- format_display_number: re-run 0052/whatever last defined it WITHOUT the OFFER branch if you need the
-- -- function itself reverted; leaving the extra `when` branch in place is harmless (dead code) if you don't.
-- drop function if exists public.is_trade_admin();
-- drop function if exists public.can_approve_trade();
-- drop function if exists public.can_create_trade();
-- drop function if exists public.has_trade_access();
-- alter table public.profiles drop column if exists trade_role;
-- drop type if exists trade_role;
-- -- Re-run 0053_project_task_functions_rls.sql's (or whichever the current latest is at rollback time)
-- -- p_profiles_update_self definition to drop the trade_role clause from the self-escalation freeze.
-- =====================================================================

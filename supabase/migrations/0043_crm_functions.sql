-- =====================================================================
-- NIL Office — 0043_crm_functions.sql
-- CRM module — permission helpers, opportunity numbering trigger, stage
-- history trigger, touch/audit attachment, search, grants. The spec's
-- 6-tier permission list (§38) collapses onto the same 4-tier
-- VIEW/CREATE/APPROVE/ADMIN shape already used by contract_role /
-- invoice_role: EDIT -> CREATE; CLOSE_OPPORTUNITY and MANAGE_PIPELINE
-- -> APPROVE; ADMIN stays ADMIN.
-- =====================================================================

do $$ begin
  create type crm_role as enum ('VIEW','CREATE','APPROVE','ADMIN');
exception when duplicate_object then null; end $$;

alter table public.profiles add column if not exists crm_role crm_role;

create or replace function public.has_crm_access()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or crm_role is not null)
  );
$$;

create or replace function public.can_create_crm()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or crm_role in ('CREATE','APPROVE','ADMIN'))
  );
$$;

create or replace function public.can_approve_crm()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or crm_role in ('APPROVE','ADMIN'))
  );
$$;

create or replace function public.is_crm_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or crm_role = 'ADMIN')
  );
$$;

-- ---------------------------------------------------------------------
-- Display number formatter: add the OPPORTUNITY branch.
-- ---------------------------------------------------------------------
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
    else p_scope || '-' || p_year::text || '-' || lpad(p_seq::text, 4, '0')
  end;
$$;

-- ---------------------------------------------------------------------
-- tg_crm_opportunity_number — numbers an opportunity at INSERT time
-- (decision #1 in the Phase 1 plan: not a legal document, no deferred-
-- draft state needed). Year is computed server-side from now(), never
-- trusted from the app. Runs before NOT NULL is checked, so the app
-- never supplies sequence_number/opportunity_number/year itself.
-- ---------------------------------------------------------------------
create or replace function public.tg_crm_opportunity_number()
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
  v_seq  := public.allocate_sequence('OPPORTUNITY', v_year);

  new.year               := v_year;
  new.sequence_number     := v_seq;
  new.opportunity_number  := public.format_display_number('OPPORTUNITY', v_year, v_seq);

  return new;
end;
$$;

drop trigger if exists trg_crm_opportunity_number on public.crm_opportunities;
create trigger trg_crm_opportunity_number
  before insert on public.crm_opportunities
  for each row execute function public.tg_crm_opportunity_number();

-- ---------------------------------------------------------------------
-- tg_crm_opportunity_stage_pipeline_check — stage_id must always belong
-- to pipeline_id (both are freely editable columns, so this can't be a
-- simple CHECK constraint referencing another table). Runs on every
-- insert/update, not just the dedicated move/close RPCs, so the
-- invariant holds regardless of write path.
-- ---------------------------------------------------------------------
create or replace function public.tg_crm_opportunity_stage_pipeline_check()
returns trigger
language plpgsql
as $$
declare
  v_pipeline uuid;
begin
  select pipeline_id into v_pipeline from public.crm_pipeline_stages where id = new.stage_id;
  if v_pipeline is null or v_pipeline <> new.pipeline_id then
    raise exception 'STAGE_PIPELINE_MISMATCH' using errcode = '22000';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_crm_opportunity_stage_pipeline_check on public.crm_opportunities;
create trigger trg_crm_opportunity_stage_pipeline_check
  before insert or update on public.crm_opportunities
  for each row execute function public.tg_crm_opportunity_stage_pipeline_check();

-- ---------------------------------------------------------------------
-- tg_crm_opportunity_stage_history — logs every stage move (including
-- Won/Lost closures, which are just moves onto a terminal stage) into
-- crm_opportunity_stage_history. SECURITY DEFINER and never granted an
-- app-facing insert policy of its own (0044) — the app cannot forge
-- history, only cause it by legitimately moving stage_id.
-- ---------------------------------------------------------------------
create or replace function public.tg_crm_opportunity_stage_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stage_id is distinct from old.stage_id then
    insert into public.crm_opportunity_stage_history (opportunity_id, from_stage_id, to_stage_id, changed_by)
    values (new.id, old.stage_id, new.stage_id, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_crm_opportunity_stage_history on public.crm_opportunities;
create trigger trg_crm_opportunity_stage_history
  after update on public.crm_opportunities
  for each row execute function public.tg_crm_opportunity_stage_history();

-- ---------------------------------------------------------------------
-- updated_at touch + generic audit trigger for the new tables.
-- crm_opportunity_stage_history is deliberately excluded: it is already
-- a dedicated, insert-only audit trail (see above), and has no
-- updated_at column to touch.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['crm_company_roles','company_contacts','crm_pipelines','crm_pipeline_stages','crm_opportunities','crm_activities']
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
  foreach t in array array['crm_company_roles','company_contacts','crm_pipelines','crm_pipeline_stages','crm_opportunities','crm_activities']
  loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$s;', t);
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$s
       for each row execute function public.tg_audit();', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Unified search — add company_contacts and crm_opportunities.
-- For company_contact, `extra` carries company_id (not a status/enum
-- like the other branches) so the UI can route straight to that
-- company's people tab without a second lookup.
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
  union all
  select 'company_contact', cc.id,
         btrim(coalesce(cc.first_name, '') || ' ' || coalesce(cc.last_name, '')),
         co.legal_name,
         cc.company_id::text,
         cc.created_at
    from public.company_contacts cc join public.companies co on co.id = cc.company_id, q
   where q.term <> '' and (
         cc.first_name ilike '%'||q.term||'%'
      or cc.last_name ilike '%'||q.term||'%'
      or cc.email ilike '%'||q.term||'%'
      or cc.mobile ilike '%'||q.term||'%'
      or cc.phone ilike '%'||q.term||'%')
  union all
  select 'opportunity', o.id, o.title, o.opportunity_number, s.name, o.created_at
    from public.crm_opportunities o join public.crm_pipeline_stages s on s.id = o.stage_id, q
   where q.term <> '' and (
         o.title ilike '%'||q.term||'%'
      or o.opportunity_number ilike '%'||q.term||'%'
      or o.description ilike '%'||q.term||'%')
  order by created_at desc
  limit 50;
$$;

-- ---------------------------------------------------------------------
-- move_opportunity_stage — ordinary pipeline progress (gated
-- can_create_crm(), same tier as editing). Moving onto a WON/LOST stage
-- directly is rejected — that must go through close_opportunity_won/
-- close_opportunity_lost so won_at/lost_at/lost_reason are always set
-- together with the stage (mirrors USE_RPC_TO_FINALIZE elsewhere).
-- crm_opportunity_stage_history logs the move automatically via the
-- after-update trigger (0043 above) — not written here.
-- ---------------------------------------------------------------------
create or replace function public.move_opportunity_stage(p_id uuid, p_stage_id uuid)
returns public.crm_opportunities
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     public.crm_opportunities;
  v_pipeline uuid;
  v_won     boolean;
  v_lost    boolean;
begin
  if not public.can_create_crm() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_row from public.crm_opportunities where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.won_at is not null or v_row.lost_at is not null then
    raise exception 'ALREADY_CLOSED' using errcode = '22000';
  end if;

  select pipeline_id, is_won, is_lost into v_pipeline, v_won, v_lost
    from public.crm_pipeline_stages where id = p_stage_id;
  if v_pipeline is null or v_pipeline <> v_row.pipeline_id then
    raise exception 'STAGE_PIPELINE_MISMATCH' using errcode = '22000';
  end if;
  if v_won or v_lost then
    raise exception 'USE_CLOSE_ACTION' using errcode = '22000';
  end if;

  update public.crm_opportunities set stage_id = p_stage_id, updated_at = now()
   where id = p_id
   returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- close_opportunity_won / close_opportunity_lost — the only ways an
-- opportunity reaches its pipeline's WON/LOST stage (gated
-- can_approve_crm() — spec §38's CRM_CLOSE_OPPORTUNITY folded into
-- APPROVE). Each pipeline has at most one WON and one LOST stage
-- (enforced by the partial unique indexes in 0039), so the target
-- stage is picked unambiguously.
-- ---------------------------------------------------------------------
create or replace function public.close_opportunity_won(p_id uuid)
returns public.crm_opportunities
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row       public.crm_opportunities;
  v_won_stage uuid;
begin
  if not public.can_approve_crm() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_row from public.crm_opportunities where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.won_at is not null or v_row.lost_at is not null then
    raise exception 'ALREADY_CLOSED' using errcode = '22000';
  end if;

  select id into v_won_stage from public.crm_pipeline_stages
   where pipeline_id = v_row.pipeline_id and is_won limit 1;
  if v_won_stage is null then
    raise exception 'NO_WON_STAGE' using errcode = '22000';
  end if;

  update public.crm_opportunities
     set stage_id = v_won_stage, won_at = now(), updated_at = now()
   where id = p_id
   returning * into v_row;

  perform public.write_log('crm_opportunities', p_id, 'WON', null, jsonb_build_object('stage_id', v_won_stage));
  return v_row;
end;
$$;

create or replace function public.close_opportunity_lost(
  p_id uuid,
  p_lost_reason crm_lost_reason,
  p_lost_reason_note text default null
)
returns public.crm_opportunities
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row        public.crm_opportunities;
  v_lost_stage uuid;
begin
  if not public.can_approve_crm() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_lost_reason is null then
    raise exception 'LOST_REASON_REQUIRED' using errcode = '22000';
  end if;

  select * into v_row from public.crm_opportunities where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.won_at is not null or v_row.lost_at is not null then
    raise exception 'ALREADY_CLOSED' using errcode = '22000';
  end if;

  select id into v_lost_stage from public.crm_pipeline_stages
   where pipeline_id = v_row.pipeline_id and is_lost limit 1;
  if v_lost_stage is null then
    raise exception 'NO_LOST_STAGE' using errcode = '22000';
  end if;

  update public.crm_opportunities
     set stage_id = v_lost_stage, lost_at = now(),
         lost_reason = p_lost_reason, lost_reason_note = p_lost_reason_note,
         updated_at = now()
   where id = p_id
   returning * into v_row;

  perform public.write_log('crm_opportunities', p_id, 'LOST', null,
    jsonb_build_object('stage_id', v_lost_stage, 'lost_reason', p_lost_reason));
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- set_company_crm — the only sanctioned way to change a company's CRM
-- status/owner/roles. companies' own RLS (0004_rls.sql) lets ANY active
-- user update the row directly (unchanged, to avoid regressing every
-- other module that already writes to companies), so these
-- CRM-specific fields are instead gated here, in a SECURITY DEFINER
-- RPC that actually checks can_create_crm() — the one write path the
-- app uses for them.
-- ---------------------------------------------------------------------
create or replace function public.set_company_crm(
  p_company_id uuid,
  p_crm_status crm_company_status,
  p_owner_user_id uuid,
  p_roles crm_company_role[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_create_crm() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  update public.companies
     set crm_status = p_crm_status,
         owner_user_id = p_owner_user_id,
         updated_at = now()
   where id = p_company_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  delete from public.crm_company_roles where company_id = p_company_id;
  insert into public.crm_company_roles (company_id, role)
  select p_company_id, r from unnest(p_roles) r;

  perform public.write_log(
    'companies', p_company_id, 'CRM_UPDATED',
    null, jsonb_build_object('crm_status', p_crm_status, 'owner_user_id', p_owner_user_id, 'roles', p_roles)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------
grant execute on function public.set_company_crm(uuid, crm_company_status, uuid, crm_company_role[]) to authenticated;
grant execute on function public.move_opportunity_stage(uuid, uuid) to authenticated;
grant execute on function public.close_opportunity_won(uuid) to authenticated;
grant execute on function public.close_opportunity_lost(uuid, crm_lost_reason, text) to authenticated;
grant execute on function public.has_crm_access()    to authenticated;
grant execute on function public.can_create_crm()     to authenticated;
grant execute on function public.can_approve_crm()    to authenticated;
grant execute on function public.is_crm_admin()       to authenticated;

grant select, insert, update, delete on
  public.crm_company_roles,
  public.company_contacts,
  public.crm_pipelines,
  public.crm_pipeline_stages,
  public.crm_opportunities,
  public.crm_opportunity_stage_history,
  public.crm_activities
  to authenticated;

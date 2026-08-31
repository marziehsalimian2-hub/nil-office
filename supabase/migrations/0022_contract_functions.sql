-- =====================================================================
-- NIL Office — 0022_contract_functions.sql
-- Contract Management module — Phase 1 functions/triggers.
-- Numbering RPC mirrors finalize_correspondence (0003_functions.sql)
-- exactly: deferred atomic allocation, never on DRAFT insert. Status
-- transitions mirror tg_correspondence_status (0011_security_fixes.sql).
-- Permission helpers mirror the accounting dual-role-axis pattern
-- (0008_accounting_functions.sql).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Display number formatter: add the CONTRACT branch (CTR-1405-0001).
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
    else p_scope || '-' || p_year::text || '-' || lpad(p_seq::text, 4, '0')
  end;
$$;

-- ---------------------------------------------------------------------
-- Authority helpers — same shape as the accounting module's.
-- EDIT folds into the CREATE tier, matching how accounting folds
-- create+edit-draft together.
-- ---------------------------------------------------------------------
create or replace function public.has_contract_access()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or contract_role is not null)
  );
$$;

create or replace function public.can_create_contract()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or contract_role in ('CREATE','APPROVE','ADMIN'))
  );
$$;

create or replace function public.can_approve_contract()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or contract_role in ('APPROVE','ADMIN'))
  );
$$;

create or replace function public.is_contract_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or contract_role = 'ADMIN')
  );
$$;

-- ---------------------------------------------------------------------
-- finalize_contract — issue the official CTR-YYYY-NNNN number.
-- Atomic: authorise -> lock -> validate eligibility -> allocate ->
-- assign -> audit -> commit. NIL_ISSUED contracts only; a HISTORICAL
-- contract already carries its own external number and never goes
-- through this RPC (see tg_contract_status's bypass for it).
-- ---------------------------------------------------------------------
create or replace function public.finalize_contract(
  p_contract_id uuid,
  p_year        int default null
)
returns public.contracts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  public.contracts;
  v_year int;
  v_seq  int;
  v_disp text;
begin
  if not public.can_approve_contract() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_row from public.contracts where id = p_contract_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_row.kind <> 'NIL_ISSUED' then
    raise exception 'ONLY_NIL_ISSUED_FINALIZE' using errcode = '22000';
  end if;
  if v_row.sequence_number is not null then
    raise exception 'ALREADY_NUMBERED' using errcode = '22000';
  end if;
  if v_row.status <> 'UNDER_REVIEW' then
    raise exception 'NOT_ELIGIBLE' using errcode = '22000';
  end if;

  v_year := coalesce(p_year, v_row.year, public.jalali_year(now()));
  if v_year < 1300 or v_year > 1600 then
    raise exception 'INVALID_YEAR' using errcode = '22000';
  end if;

  v_seq  := public.allocate_sequence('CONTRACT', v_year);
  v_disp := public.format_display_number('CONTRACT', v_year, v_seq);

  update public.contracts
     set sequence_number = v_seq,
         display_number  = v_disp,
         year            = v_year,
         status          = 'APPROVED',
         approved_by     = auth.uid(),
         approved_at     = now(),
         finalized_at    = now(),
         updated_at      = now()
   where id = p_contract_id
   returning * into v_row;

  perform public.write_log(
    'contracts', p_contract_id, 'APPROVED',
    jsonb_build_object('status', 'UNDER_REVIEW'),
    jsonb_build_object('status', 'APPROVED', 'display_number', v_disp,
                       'sequence_number', v_seq, 'year', v_year)
  );

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- activate_contract — APPROVED -> ACTIVE, its own audited event.
-- ---------------------------------------------------------------------
create or replace function public.activate_contract(p_contract_id uuid)
returns public.contracts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.contracts;
begin
  if not public.can_approve_contract() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_row from public.contracts where id = p_contract_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status <> 'APPROVED' then
    raise exception 'NOT_ELIGIBLE' using errcode = '22000';
  end if;

  update public.contracts
     set status = 'ACTIVE', updated_at = now()
   where id = p_contract_id
   returning * into v_row;

  perform public.write_log(
    'contracts', p_contract_id, 'ACTIVATED',
    jsonb_build_object('status', 'APPROVED'),
    jsonb_build_object('status', 'ACTIVE')
  );

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- cancel_contract — only reachable pre-ACTIVE ("before execution" per
-- spec §7); keeps the record, never recycles a number.
-- ---------------------------------------------------------------------
create or replace function public.cancel_contract(p_contract_id uuid)
returns public.contracts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.contracts;
begin
  if not public.can_create_contract() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_row from public.contracts where id = p_contract_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status = 'CANCELLED' then
    raise exception 'ALREADY_CANCELLED' using errcode = '22000';
  end if;
  if v_row.status not in ('DRAFT','UNDER_REVIEW','APPROVED') then
    raise exception 'NOT_ELIGIBLE' using errcode = '22000';
  end if;

  update public.contracts
     set status = 'CANCELLED', updated_at = now()
   where id = p_contract_id
   returning * into v_row;

  perform public.write_log(
    'contracts', p_contract_id, 'CANCELLED',
    jsonb_build_object('status', v_row.status),
    jsonb_build_object('status', 'CANCELLED', 'display_number', v_row.display_number)
  );

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- Guard trigger: numbering/external-number fields immutable once set,
-- and no physical deletion once past DRAFT (spec §32).
-- ---------------------------------------------------------------------
create or replace function public.tg_contract_guard()
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
    if old.external_contract_number is not null
       and new.external_contract_number is distinct from old.external_contract_number then
      raise exception 'EXTERNAL_NUMBER_IMMUTABLE' using errcode = '22000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contract_guard on public.contracts;
create trigger trg_contract_guard
  before update or delete on public.contracts
  for each row execute function public.tg_contract_guard();

-- ---------------------------------------------------------------------
-- Status transition trigger — explicit adjacency map (spec §7):
--   DRAFT        -> UNDER_REVIEW | CANCELLED
--   UNDER_REVIEW -> DRAFT | CANCELLED           (APPROVED via RPC only, unless HISTORICAL)
--   APPROVED     -> ACTIVE | CANCELLED
--   ACTIVE       -> SUSPENDED | COMPLETED | EXPIRED | TERMINATED
--   SUSPENDED    -> ACTIVE | TERMINATED
--   COMPLETED / EXPIRED / TERMINATED / CANCELLED -> terminal
-- A HISTORICAL contract never gets a sequence number, so it may reach
-- APPROVED via a plain update from UNDER_REVIEW; a NIL_ISSUED contract
-- may only reach APPROVED when finalize_contract has just assigned a
-- sequence_number in the same statement.
-- ---------------------------------------------------------------------
create or replace function public.tg_contract_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'APPROVED' then
      if new.kind = 'HISTORICAL' then
        if old.status <> 'UNDER_REVIEW' then
          raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000';
        end if;
        return new;
      end if;
      if old.sequence_number is null and new.sequence_number is not null then
        return new; -- legitimate numbering by finalize_contract
      end if;
      raise exception 'USE_RPC_TO_FINALIZE' using errcode = '22000';
    end if;

    if not (
      (old.status = 'DRAFT'        and new.status in ('UNDER_REVIEW','CANCELLED')) or
      (old.status = 'UNDER_REVIEW' and new.status in ('DRAFT','CANCELLED')) or
      (old.status = 'APPROVED'     and new.status in ('ACTIVE','CANCELLED')) or
      (old.status = 'ACTIVE'       and new.status in ('SUSPENDED','COMPLETED','EXPIRED','TERMINATED')) or
      (old.status = 'SUSPENDED'    and new.status in ('ACTIVE','TERMINATED'))
    ) then
      raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contract_status on public.contracts;
create trigger trg_contract_status
  before update on public.contracts
  for each row execute function public.tg_contract_status();

-- ---------------------------------------------------------------------
-- updated_at touch + generic audit trigger for the two new tables.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['contracts','contract_types']
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
  foreach t in array array['contracts','contract_types']
  loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$s;', t);
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$s
       for each row execute function public.tg_audit();', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Unified search — add contracts.
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
  order by created_at desc
  limit 50;
$$;

-- ---------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------
grant execute on function public.has_contract_access()      to authenticated;
grant execute on function public.can_create_contract()       to authenticated;
grant execute on function public.can_approve_contract()      to authenticated;
grant execute on function public.is_contract_admin()         to authenticated;
grant execute on function public.finalize_contract(uuid,int) to authenticated;
grant execute on function public.activate_contract(uuid)     to authenticated;
grant execute on function public.cancel_contract(uuid)       to authenticated;

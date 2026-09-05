-- =====================================================================
-- NIL Office — 0052_project_task_functions.sql
-- Project & Task Management Phase 1 — permission helpers, numbering,
-- status transitions, touch/audit attachment, search, grants.
-- =====================================================================

do $$ begin
  create type project_role as enum ('VIEW','CREATE','APPROVE','ADMIN');
exception when duplicate_object then null; end $$;

alter table public.profiles add column if not exists project_role project_role;

create or replace function public.has_project_access()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or project_role is not null)
  );
$$;

create or replace function public.can_create_project()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or project_role in ('CREATE','APPROVE','ADMIN'))
  );
$$;

create or replace function public.can_approve_project()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or project_role in ('APPROVE','ADMIN'))
  );
$$;

create or replace function public.is_project_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or project_role = 'ADMIN')
  );
$$;

-- ---------------------------------------------------------------------
-- Display number formatter: add the PROJECT branch.
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
    when 'PROJECT'     then 'PRJ-'  || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    else p_scope || '-' || p_year::text || '-' || lpad(p_seq::text, 4, '0')
  end;
$$;

-- ---------------------------------------------------------------------
-- finalize_project — DRAFT -> PLANNED, issuing the official PRJ- number.
-- Mirrors finalize_contract exactly (0022_contract_functions.sql):
-- authorise -> lock -> validate eligibility -> allocate -> assign ->
-- audit -> commit.
-- ---------------------------------------------------------------------
create or replace function public.finalize_project(
  p_id   uuid,
  p_year int default null
)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  public.projects;
  v_year int;
  v_seq  int;
  v_disp text;
begin
  if not public.can_approve_project() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_row from public.projects where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_row.sequence_number is not null then
    raise exception 'ALREADY_NUMBERED' using errcode = '22000';
  end if;
  if v_row.status <> 'DRAFT' then
    raise exception 'NOT_ELIGIBLE' using errcode = '22000';
  end if;

  v_year := coalesce(p_year, v_row.year, public.jalali_year(now()));
  if v_year < 1300 or v_year > 1600 then
    raise exception 'INVALID_YEAR' using errcode = '22000';
  end if;

  v_seq  := public.allocate_sequence('PROJECT', v_year);
  v_disp := public.format_display_number('PROJECT', v_year, v_seq);

  update public.projects
     set sequence_number = v_seq,
         display_number  = v_disp,
         year            = v_year,
         status          = 'PLANNED',
         updated_at      = now()
   where id = p_id
   returning * into v_row;

  perform public.write_log(
    'projects', p_id, 'FINALIZED',
    jsonb_build_object('status', 'DRAFT'),
    jsonb_build_object('status', 'PLANNED', 'display_number', v_disp, 'sequence_number', v_seq, 'year', v_year)
  );

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- Guard trigger: numbering immutable once set; no physical deletion
-- once past DRAFT.
-- ---------------------------------------------------------------------
create or replace function public.tg_project_guard()
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

drop trigger if exists trg_project_guard on public.projects;
create trigger trg_project_guard
  before update or delete on public.projects
  for each row execute function public.tg_project_guard();

-- ---------------------------------------------------------------------
-- Status transition trigger — explicit adjacency map.
-- ---------------------------------------------------------------------
create or replace function public.tg_project_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then

    if new.status = 'PLANNED' then
      if old.status = 'DRAFT' and old.sequence_number is null and new.sequence_number is not null then
        return new; -- legitimate numbering by finalize_project
      end if;
      raise exception 'USE_RPC_TO_FINALIZE' using errcode = '22000';
    end if;

    if not (
      (old.status = 'DRAFT'      and new.status in ('CANCELLED')) or
      (old.status = 'PLANNED'    and new.status in ('ACTIVE','CANCELLED')) or
      (old.status = 'ACTIVE'     and new.status in ('ON_HOLD','COMPLETED','CANCELLED')) or
      (old.status = 'ON_HOLD'    and new.status in ('ACTIVE','CANCELLED')) or
      (old.status = 'COMPLETED'  and new.status in ('ARCHIVED')) or
      (old.status = 'CANCELLED'  and new.status in ('ARCHIVED'))
    ) then
      raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_project_status on public.projects;
create trigger trg_project_status
  before update on public.projects
  for each row execute function public.tg_project_status();

-- ---------------------------------------------------------------------
-- updated_at touch + generic audit trigger for the new tables.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['projects','project_phases','project_milestones','project_members','tasks']
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
  foreach t in array array['projects','project_phases','project_milestones','project_members','tasks']
  loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$s;', t);
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$s
       for each row execute function public.tg_audit();', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Unified search — add projects and tasks.
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
  union all
  select 'project', p.id,
         p.title,
         coalesce(p.display_number, 'پیش‌نویس'),
         p.status::text,
         p.created_at
    from public.projects p, q
   where q.term <> '' and (
         p.title ilike '%'||q.term||'%'
      or p.display_number ilike '%'||q.term||'%'
      or p.description ilike '%'||q.term||'%')
  union all
  select 'task', t.id, t.title, coalesce(p2.display_number, p2.title, ''), t.status::text, t.created_at
    from public.tasks t left join public.projects p2 on p2.id = t.project_id, q
   where q.term <> '' and (
         t.title ilike '%'||q.term||'%'
      or t.description ilike '%'||q.term||'%')
  order by created_at desc
  limit 50;
$$;

-- ---------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------
grant execute on function public.has_project_access()      to authenticated;
grant execute on function public.can_create_project()       to authenticated;
grant execute on function public.can_approve_project()      to authenticated;
grant execute on function public.is_project_admin()         to authenticated;
grant execute on function public.finalize_project(uuid, int) to authenticated;

grant select, insert, update, delete on
  public.projects,
  public.project_phases,
  public.project_milestones,
  public.project_members,
  public.tasks
  to authenticated;

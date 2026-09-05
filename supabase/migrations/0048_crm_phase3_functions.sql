-- =====================================================================
-- NIL Office — 0048_crm_phase3_functions.sql
-- CRM module Phase 3 — read-only helper functions for the dashboard
-- (stale opportunities) and duplicate warnings (companies/contacts).
-- None of these are SECURITY DEFINER: they only read tables the caller
-- can already SELECT via existing RLS (has_crm_access() for CRM tables,
-- the existing open policy for companies/company_contacts), so running
-- as the calling role is both simpler and safer than bypassing RLS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- get_stale_crm_opportunities — OPEN opportunities (not Won/Lost) whose
-- most recent sign of life (created_at, latest activity, latest stage
-- move — whichever is newest) is older than p_days. Never closes or
-- flags anything itself (spec §35: "flag them for review", never
-- auto-close) — purely a read for the dashboard to list.
-- ---------------------------------------------------------------------
create or replace function public.get_stale_crm_opportunities(p_days int default 14)
returns table (
  id               uuid,
  opportunity_number text,
  title            text,
  company_name     text,
  owner_name       text,
  last_activity_at timestamptz,
  days_stale       int
)
language sql
stable
as $$
  with last_signal as (
    select
      o.id,
      greatest(
        o.created_at,
        coalesce((select max(a.activity_date) from public.crm_activities a where a.opportunity_id = o.id), o.created_at),
        coalesce((select max(h.changed_at) from public.crm_opportunity_stage_history h where h.opportunity_id = o.id), o.created_at)
      ) as last_at
    from public.crm_opportunities o
    where o.won_at is null and o.lost_at is null
  )
  select
    o.id,
    o.opportunity_number,
    o.title,
    co.legal_name,
    p.full_name,
    ls.last_at,
    extract(day from now() - ls.last_at)::int
  from last_signal ls
  join public.crm_opportunities o on o.id = ls.id
  join public.companies co on co.id = o.company_id
  left join public.profiles p on p.id = o.owner_user_id
  where ls.last_at < now() - (p_days || ' days')::interval
  order by ls.last_at asc;
$$;

-- ---------------------------------------------------------------------
-- find_similar_companies — trigram name similarity + exact email/phone
-- match, for the "possible duplicate" warning at creation time (spec
-- §29). Never used to block or auto-merge — purely advisory.
-- ---------------------------------------------------------------------
create or replace function public.find_similar_companies(
  p_legal_name text,
  p_email      text default null,
  p_phone      text default null
)
returns table (
  id           uuid,
  legal_name   text,
  english_name text,
  email        text,
  phone        text,
  score        real
)
language sql
stable
as $$
  select c.id, c.legal_name, c.english_name, c.email, c.phone,
    greatest(
      similarity(c.legal_name, coalesce(p_legal_name, '')),
      similarity(coalesce(c.english_name, ''), coalesce(p_legal_name, '')),
      case when p_email <> '' and c.email = p_email then 1.0 else 0 end,
      case when p_phone <> '' and c.phone = p_phone then 1.0 else 0 end
    ) as score
  from public.companies c
  where btrim(coalesce(p_legal_name, '')) <> ''
    and (
      similarity(c.legal_name, p_legal_name) > 0.35
      or similarity(coalesce(c.english_name, ''), p_legal_name) > 0.35
      or (p_email is not null and p_email <> '' and c.email = p_email)
      or (p_phone is not null and p_phone <> '' and c.phone = p_phone)
    )
  order by score desc
  limit 5;
$$;

-- ---------------------------------------------------------------------
-- find_similar_contacts — within one company only (spec §30: "based on
-- company, email, mobile, WhatsApp number").
-- ---------------------------------------------------------------------
create or replace function public.find_similar_contacts(
  p_company_id uuid,
  p_email      text default null,
  p_mobile     text default null
)
returns table (
  id         uuid,
  first_name text,
  last_name  text,
  email      text,
  mobile     text,
  score      real
)
language sql
stable
as $$
  select cc.id, cc.first_name, cc.last_name, cc.email, cc.mobile,
    case
      when p_email  is not null and p_email  <> '' and cc.email  = p_email  then 1.0
      when p_mobile is not null and p_mobile <> '' and cc.mobile = p_mobile then 1.0
      else 0.5
    end as score
  from public.company_contacts cc
  where cc.company_id = p_company_id
    and (
      (p_email  is not null and p_email  <> '' and cc.email  = p_email)
      or (p_mobile is not null and p_mobile <> '' and cc.mobile = p_mobile)
    )
  order by score desc
  limit 5;
$$;

grant execute on function public.get_stale_crm_opportunities(int) to authenticated;
grant execute on function public.find_similar_companies(text, text, text) to authenticated;
grant execute on function public.find_similar_contacts(uuid, text, text) to authenticated;

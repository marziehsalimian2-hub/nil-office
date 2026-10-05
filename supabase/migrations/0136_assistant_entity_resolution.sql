-- =====================================================================
-- NIL Office — 0136_assistant_entity_resolution.sql
-- Internal Assistant v1.0 — Slice 3: code-level entity resolution (spec §19 / §45).
--
-- Why a new function instead of search_all(): search_all() (0052) is ONE union over every module ordered by created_at
-- with `limit 50`, and the assistant filtered by entity_type AFTERWARDS — for a common word the 50 newest rows of any type
-- could push the right company out. It is also plain `ilike` on raw text, so Arabic/Persian letter variants (ي/ی, ك/ک),
-- ZWNJ vs space and digit variants never matched.
--
--   assistant_norm_fa(text)                       immutable SQL twin of lib/assistant/entityMatch.ts normalizeFa()
--   assistant_entity_candidates(profile, type,    PER-TYPE candidate fetch (limit applies per type, no cross-module crowding)
--       query, company, limit)                    with a normalized token + trigram prefilter. SQL only FETCHES plausible
--                                                 candidates; scoring / tiers / "is this resolved?" live in TypeScript.
--
-- Caller = service_role (Telegram) or the profile itself; the profile must be active; the per-type gate mirrors the web
-- (company = any active user, p_companies_read; contact = CRM access; contract = contract access; project = project access).
-- Returns id / name / aliases / secondary / number only — nothing sensitive. service_role is granted explicitly
-- (0072/0096: a blanket grant is not retroactive).
-- =====================================================================

create or replace function public.assistant_norm_fa(p_text text)
returns text
language sql immutable as $$
  select btrim(regexp_replace(
           regexp_replace(
             lower(translate(
               regexp_replace(
                 regexp_replace(coalesce(p_text, ''), '[‌‍ ]', ' ', 'g'),
                 '[ـً-ٰٟء]', '', 'g'),
               'يكىةۀئأإٱؤ٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
               'یکیههیاااو01234567890123456789')),
             '[\-_.,;:/\\()\[\]{}"''«»!?+*&%$#@=<>|~^،؛؟]', ' ', 'g'),
           '\s+', ' ', 'g'));
$$;

create or replace function public.assistant_entity_candidates(
  p_profile_id uuid, p_type text, p_query text, p_company_id uuid default null, p_limit integer default 25
) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$   -- (pg_trgm's similarity() lives in public or, on Supabase, extensions)
declare
  v_q text; v_tokens text[]; v_prof public.profiles; v_limit integer; v_rows jsonb;
begin
  if not (auth.role() = 'service_role' or (p_profile_id is not null and p_profile_id = auth.uid())) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select * into v_prof from public.profiles where id = p_profile_id and is_active;
  if not found then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_type is null or p_type not in ('company', 'contact', 'contract', 'project') then
    raise exception 'INVALID_TYPE' using errcode = '22023';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_q := public.assistant_norm_fa(p_query);
  if length(v_q) < 2 then return '[]'::jsonb; end if;
  v_tokens := array(select t from unnest(string_to_array(v_q, ' ')) t where length(t) >= 2);
  if cardinality(v_tokens) = 0 then v_tokens := array[v_q]; end if;

  if p_type = 'company' then
    select coalesce(jsonb_agg(x.j order by x.hits desc, x.sim desc), '[]'::jsonb) into v_rows from (
      select jsonb_build_object('id', co.id, 'name', co.legal_name, 'aliases', jsonb_build_array(co.english_name),
                                'secondary', co.country, 'number', null) as j, h.hits, h.sim
        from public.companies co
        cross join lateral (select public.assistant_norm_fa(co.legal_name) as n1, public.assistant_norm_fa(co.english_name) as n2) n
        cross join lateral (select (select count(*) from unnest(v_tokens) t where position(t in n.n1) > 0 or position(t in n.n2) > 0) as hits,
                                   greatest(similarity(n.n1, v_q), similarity(n.n2, v_q)) as sim) h
       where h.hits > 0 or h.sim > 0.25
       order by h.hits desc, h.sim desc
       limit v_limit) x;

  elsif p_type = 'contact' then
    if not (v_prof.role = 'ADMIN' or v_prof.crm_role is not null) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
    select coalesce(jsonb_agg(x.j order by x.hits desc, x.sim desc), '[]'::jsonb) into v_rows from (
      select jsonb_build_object('id', cc.id, 'name', btrim(coalesce(cc.first_name, '') || ' ' || coalesce(cc.last_name, '')),
                                'aliases', '[]'::jsonb, 'secondary', co.legal_name, 'number', null, 'company_id', cc.company_id) as j, h.hits, h.sim
        from public.company_contacts cc
        join public.companies co on co.id = cc.company_id
        cross join lateral (select public.assistant_norm_fa(coalesce(cc.first_name, '') || ' ' || coalesce(cc.last_name, '')) as n1) n
        cross join lateral (select (select count(*) from unnest(v_tokens) t where position(t in n.n1) > 0) as hits,
                                   similarity(n.n1, v_q) as sim) h
       where (p_company_id is null or cc.company_id = p_company_id)
         and (h.hits > 0 or h.sim > 0.25)
       order by h.hits desc, h.sim desc
       limit v_limit) x;

  elsif p_type = 'contract' then
    if not (v_prof.role = 'ADMIN' or v_prof.contract_role is not null) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
    select coalesce(jsonb_agg(x.j order by x.hits desc, x.sim desc), '[]'::jsonb) into v_rows from (
      select jsonb_build_object('id', k.id, 'name', k.title,
                                'aliases', jsonb_build_array(k.display_number, k.external_contract_number),
                                'secondary', k.status::text, 'number', coalesce(k.display_number, k.external_contract_number)) as j, h.hits, h.sim
        from public.contracts k
        cross join lateral (select public.assistant_norm_fa(k.title) as n1,
                                   public.assistant_norm_fa(coalesce(k.display_number, '') || ' ' || coalesce(k.external_contract_number, '')) as n2) n
        cross join lateral (select (select count(*) from unnest(v_tokens) t where position(t in n.n1) > 0 or position(t in n.n2) > 0) as hits,
                                   greatest(similarity(n.n1, v_q), similarity(n.n2, v_q)) as sim) h
       where (p_company_id is null or k.counterparty_company_id = p_company_id)
         and (h.hits > 0 or h.sim > 0.25)
       order by h.hits desc, h.sim desc
       limit v_limit) x;

  else  -- 'project'
    if not (v_prof.role = 'ADMIN' or v_prof.project_role is not null) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
    select coalesce(jsonb_agg(x.j order by x.hits desc, x.sim desc), '[]'::jsonb) into v_rows from (
      select jsonb_build_object('id', p.id, 'name', p.title, 'aliases', jsonb_build_array(p.display_number),
                                'secondary', p.status::text, 'number', p.display_number) as j, h.hits, h.sim
        from public.projects p
        cross join lateral (select public.assistant_norm_fa(p.title) as n1, public.assistant_norm_fa(coalesce(p.display_number, '')) as n2) n
        cross join lateral (select (select count(*) from unnest(v_tokens) t where position(t in n.n1) > 0 or position(t in n.n2) > 0) as hits,
                                   greatest(similarity(n.n1, v_q), similarity(n.n2, v_q)) as sim) h
       where (p_company_id is null or p.company_id = p_company_id)
         and (h.hits > 0 or h.sim > 0.25)
       order by h.hits desc, h.sim desc
       limit v_limit) x;
  end if;

  return v_rows;
end; $$;

revoke all on function public.assistant_norm_fa(text) from public;
revoke all on function public.assistant_entity_candidates(uuid, text, text, uuid, integer) from public;
grant execute on function public.assistant_norm_fa(text) to authenticated, service_role;
grant execute on function public.assistant_entity_candidates(uuid, text, text, uuid, integer) to authenticated, service_role;

-- =====================================================================
-- ROLLBACK: drop function if exists public.assistant_entity_candidates(uuid,text,text,uuid,integer), public.assistant_norm_fa(text);
-- =====================================================================

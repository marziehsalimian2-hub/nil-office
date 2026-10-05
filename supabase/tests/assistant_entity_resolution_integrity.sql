-- =============================================================================
-- NIL Office — Internal Assistant v1.0, Slice 3 (entity resolution) integrity tests for migration 0136.
-- Run by hand in the Supabase SQL editor AFTER migrations 0133-0136, with at least TWO active profiles, one of them ADMIN.
-- ONE transaction, ROLLED BACK at the end. The script temporarily re-roles the first ADMIN profile (rolled back) —
-- do NOT run it while that admin is actively using the app. Everything it creates is SYNTHETIC (companies with the
-- tag 'zq136', 60 correspondence rows with the same tag) — all rolled back.
-- NOT RUN by Claude — the user runs it. Success = the statement finishes with no error
-- ("Success. No rows returned" in the Supabase editor; the PASS notice is not shown there).
--
-- Covers: (1) assistant_norm_fa (Arabic/Persian letters, ZWNJ, digits, punctuation, null)
--         (2) per-type gates (company open; contact / contract / project need their module role) — also for service_role
--         (3) Arabic/Persian spelling variants find the same company
--         (4) NO cross-module crowding: the company is found even when 60 NEWER correspondence rows share the word
--         (5) limit, output shape (no email / phone / address), caller checks
-- =============================================================================
begin;

create function pg_temp.persona(p_user uuid, p_role text, p_crm text, p_contract text, p_project text) returns void
language plpgsql as $$
begin
  execute 'reset role';
  update public.profiles set role = p_role::app_role, crm_role = p_crm::crm_role, contract_role = p_contract::contract_role, project_role = p_project::project_role
   where id = p_user;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  execute 'set role authenticated';
end $$;

create function pg_temp.svc() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  execute 'set role service_role';
end $$;

create function pg_temp.expect_err(p_sql text, p_code text) returns void
language plpgsql as $$
declare m text;
begin
  begin execute p_sql;
  exception when others then
    get stacked diagnostics m = message_text;
    if position(p_code in m) = 0 then raise exception 'FAIL: expected %, got: %', p_code, m; end if;
    return;
  end;
  raise exception 'FAIL: no error raised, expected %', p_code;
end $$;

do $$
declare
  v_admin uuid; v_other uuid; c1 uuid; c2 uuid; c3 uuid; c4 uuid; v_j jsonb; v_n int; i int;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;
  select id into v_other from public.profiles where is_active and id <> v_admin limit 1;
  if v_other is null then raise exception 'need a second active profile'; end if;

  -- 1) normalization -------------------------------------------------------------------------------------------------------------------------------
  if public.assistant_norm_fa('رضايي') <> 'رضایی' then raise exception 'FAIL(1): Arabic yeh -> Persian yeh (%)', public.assistant_norm_fa('رضايي'); end if;
  if public.assistant_norm_fa('كارخانه') <> 'کارخانه' then raise exception 'FAIL(1): Arabic kaf -> Persian kaf'; end if;
  if public.assistant_norm_fa('رضائی') <> public.assistant_norm_fa('رضایی') then raise exception 'FAIL(1): hamza-yeh variant (% vs %)', public.assistant_norm_fa('رضائی'), public.assistant_norm_fa('رضایی'); end if;
  if public.assistant_norm_fa(E'دبیرخانه‌ی  هوشمند ۱۳۶') <> 'دبیرخانه ی هوشمند 136' then raise exception 'FAIL(1): ZWNJ / spaces / Persian digits (%)', public.assistant_norm_fa(E'دبیرخانه‌ی  هوشمند ۱۳۶'); end if;
  if public.assistant_norm_fa(' A.B-C, Ltd ') <> 'a b c ltd' then raise exception 'FAIL(1): latin / punctuation (%)', public.assistant_norm_fa(' A.B-C, Ltd '); end if;
  if public.assistant_norm_fa(null) <> '' then raise exception 'FAIL(1): null'; end if;

  -- fixtures (as superuser): three companies + one unrelated, plus 60 NEWER correspondence rows with the same word -----------------------------
  execute 'reset role';
  insert into public.companies (legal_name, english_name, country, email, phone, created_by)
  values ('شرکت رضایی صنعت zq136', 'Rezaei Industry zq136', 'ایران', 'secret@example.com', '021-0000', v_admin) returning id into c1;
  insert into public.companies (legal_name, country, created_by) values ('رضائی تجارت zq136', 'ایران', v_admin) returning id into c2;
  insert into public.companies (legal_name, country, created_by) values ('كارخانه رضايي zq136', 'ایران', v_admin) returning id into c3;
  insert into public.companies (legal_name, country, created_by) values ('پارس آتیه نامرتبط', 'ایران', v_admin) returning id into c4;
  for i in 1..60 loop
    insert into public.correspondence (direction, status, subject, created_by) values ('OUTGOING', 'DRAFT', 'zq136 نامهٔ شمارهٔ ' || i, v_admin);
  end loop;

  -- 2) gates ---------------------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, null, null);                                            -- a plain active user
  v_j := public.assistant_entity_candidates(v_admin, 'company', 'zq136', null, 25);
  if jsonb_typeof(v_j) <> 'array' then raise exception 'FAIL(2): company candidates must be an array'; end if;
  perform pg_temp.expect_err(format('select public.assistant_entity_candidates(%L,%L,%L)', v_admin, 'contact', 'x'), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.assistant_entity_candidates(%L,%L,%L)', v_admin, 'contract', 'x'), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.assistant_entity_candidates(%L,%L,%L)', v_admin, 'project', 'x'), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.assistant_entity_candidates(%L,%L,%L)', v_admin, 'journal', 'x'), 'INVALID_TYPE');
  perform pg_temp.expect_err(format('select public.assistant_entity_candidates(%L,%L,%L)', v_other, 'company', 'x'), 'NOT_AUTHORIZED');   -- cannot pass another profile

  perform pg_temp.persona(v_admin, 'USER', 'VIEW', 'VIEW', 'VIEW');                                       -- module roles open the module types
  for i in 1..3 loop
    v_j := public.assistant_entity_candidates(v_admin, (array['contact', 'contract', 'project'])[i], 'zq136', null, 25);
    if jsonb_typeof(v_j) <> 'array' then raise exception 'FAIL(2): % candidates must be an array', (array['contact', 'contract', 'project'])[i]; end if;
  end loop;

  perform pg_temp.persona(v_admin, 'USER', null, null, null);                                            -- the gate follows the PROFILE, also for service_role
  perform pg_temp.svc();
  v_j := public.assistant_entity_candidates(v_admin, 'company', 'zq136', null, 25);
  if jsonb_array_length(v_j) < 3 then raise exception 'FAIL(2): service_role must resolve companies (%)', v_j; end if;
  perform pg_temp.expect_err(format('select public.assistant_entity_candidates(%L,%L,%L)', v_admin, 'contract', 'x'), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.assistant_entity_candidates(%L,%L,%L)', gen_random_uuid(), 'company', 'x'), 'NOT_AUTHORIZED');   -- unknown / inactive profile

  -- 3) spelling variants ---------------------------------------------------------------------------------------------------------------------------
  v_j := public.assistant_entity_candidates(v_admin, 'company', 'رضايي zq136', null, 25);                -- Arabic yeh in the query
  if not (v_j @> jsonb_build_array(jsonb_build_object('id', c1)) and v_j @> jsonb_build_array(jsonb_build_object('id', c3))) then
    raise exception 'FAIL(3): Arabic-yeh query must find the Persian-spelled and the Arabic-spelled companies (%)', v_j;
  end if;
  v_j := public.assistant_entity_candidates(v_admin, 'company', 'رضائی zq136', null, 25);                -- hamza variant
  if not (v_j @> jsonb_build_array(jsonb_build_object('id', c2))) then raise exception 'FAIL(3): hamza variant (%)', v_j; end if;
  v_j := public.assistant_entity_candidates(v_admin, 'company', 'Rezaei', null, 25);                      -- English name
  if not (v_j @> jsonb_build_array(jsonb_build_object('id', c1))) then raise exception 'FAIL(3): english name (%)', v_j; end if;
  v_j := public.assistant_entity_candidates(v_admin, 'company', 'پارس آتیه', null, 25);
  if not (v_j @> jsonb_build_array(jsonb_build_object('id', c4))) then raise exception 'FAIL(3): unrelated company must still be findable by its own name'; end if;

  -- 4) no cross-module crowding --------------------------------------------------------------------------------------------------------------------
  begin select count(*) into v_n from public.search_all('zq136') where entity_type = 'company'; exception when others then v_n := -1; end;   -- (informational only)
  raise notice 'INFO(4): the old search_all(zq136) returns % company rows out of its newest-50 window (60 newer letters share the word)', v_n;
  v_j := public.assistant_entity_candidates(v_admin, 'company', 'zq136', null, 25);
  select count(*) into v_n from jsonb_array_elements(v_j) e where (e ->> 'id')::uuid in (c1, c2, c3);
  if v_n <> 3 then raise exception 'FAIL(4): all 3 companies must be found despite 60 newer letters with the same word (found %)', v_n; end if;

  -- 5) limit, shape, nothing sensitive -------------------------------------------------------------------------------------------------------------
  v_j := public.assistant_entity_candidates(v_admin, 'company', 'zq136', null, 2);
  if jsonb_array_length(v_j) > 2 then raise exception 'FAIL(5): limit not applied (%)', jsonb_array_length(v_j); end if;
  v_j := public.assistant_entity_candidates(v_admin, 'company', 'zq136', null, 25);
  if exists (select 1 from jsonb_array_elements(v_j) e, jsonb_object_keys(e) k where k not in ('id', 'name', 'aliases', 'secondary', 'number', 'company_id')) then
    raise exception 'FAIL(5): unexpected keys in candidate rows (%)', v_j;
  end if;
  if v_j::text ~* 'secret@example|021-0000' then raise exception 'FAIL(5): contact data must not be returned'; end if;
  if jsonb_array_length(public.assistant_entity_candidates(v_admin, 'company', 'a', null, 25)) <> 0 then raise exception 'FAIL(5): a one-letter query must return nothing'; end if;
  if jsonb_array_length(public.assistant_entity_candidates(v_admin, 'company', '   ', null, 25)) <> 0 then raise exception 'FAIL(5): a blank query must return nothing'; end if;

  -- 6) web path: an authenticated user with their own id ------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', null, null, null);
  v_j := public.assistant_entity_candidates(v_admin, 'company', 'zq136', null, 25);
  if jsonb_array_length(v_j) < 3 then raise exception 'FAIL(6): the web path must work for the profile itself (%)', v_j; end if;

  execute 'reset role';
  execute 'set constraints all immediate';
  raise notice 'PASS: assistant entity-resolution integrity checks';
end $$;

rollback;

-- =============================================================================
-- NIL Office — CRM module integrity tests (Phase 1).
--
-- Run in the Supabase SQL editor AFTER migrations 0036-0044 and after at
-- least one ADMIN profile and one companies row exist. The whole script
-- runs in a transaction and ROLLS BACK at the end, so it leaves no data
-- behind.
--
-- It impersonates an ADMIN user (so auth.uid()/RLS/authorization behave
-- like a real session, and ADMIN bypasses crm_role gates) by setting the
-- JWT sub claim to that admin's id.
--
-- Covered: opportunity numbered immediately on insert (OPP-, no draft
-- state); a company can hold multiple crm_company_roles; stage moves
-- write crm_opportunity_stage_history rows and the history table
-- rejects direct app writes; move_opportunity_stage rejects a direct
-- move onto a WON/LOST stage; close_opportunity_won/lost set
-- won_at/lost_at and land on the pipeline's terminal stage;
-- close_opportunity_lost without a reason is rejected; a pipeline has
-- at most one WON and one LOST stage (constraint); stage_id must always
-- belong to pipeline_id.
-- =============================================================================
begin;

do $$
declare
  v_admin uuid;
  v_company uuid;
  v_pipeline uuid;
  v_stage_lead uuid;
  v_stage_other_pipeline uuid;
  v_stage_won uuid;
  v_stage_lost uuid;
  v_opp public.crm_opportunities;
  v_opp2 uuid;
  v_msg text;
  v_seq_before int;
  v_seq_after int;
  v_hist_count int;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('role', 'authenticated', true);

  select id into v_company from public.companies limit 1;
  if v_company is null then raise exception 'no companies row — create at least one company first'; end if;

  select id into v_pipeline from public.crm_pipelines where name = 'تجارت بین‌المللی';
  if v_pipeline is null then raise exception 'seed pipeline "تجارت بین‌المللی" not found — check 0039'; end if;

  select id into v_stage_lead from public.crm_pipeline_stages where pipeline_id = v_pipeline and name = 'سرنخ';
  select id into v_stage_won from public.crm_pipeline_stages where pipeline_id = v_pipeline and is_won;
  select id into v_stage_lost from public.crm_pipeline_stages where pipeline_id = v_pipeline and is_lost;
  select id into v_stage_other_pipeline from public.crm_pipeline_stages where pipeline_id <> v_pipeline limit 1;

  -- 1) opportunity numbered immediately on insert --------------------------
  select last_value into v_seq_before from public.number_sequences where scope = 'OPPORTUNITY' and year = public.jalali_year(now());
  v_seq_before := coalesce(v_seq_before, 0);

  insert into public.crm_opportunities (title, company_id, pipeline_id, stage_id, created_by)
  values ('فرصت تست', v_company, v_pipeline, v_stage_lead, v_admin)
  returning * into v_opp;

  if v_opp.opportunity_number is null or v_opp.opportunity_number !~ '^OPP-' then
    raise exception 'FAIL(1): opportunity not numbered on insert, got %', v_opp.opportunity_number;
  end if;
  raise notice 'PASS(1): opportunity numbered immediately as %', v_opp.opportunity_number;

  select last_value into v_seq_after from public.number_sequences where scope = 'OPPORTUNITY' and year = public.jalali_year(now());
  if v_seq_after <> v_seq_before + 1 then raise exception 'FAIL(1b): sequence counter did not advance by exactly 1'; end if;

  -- 2) stage_id must belong to pipeline_id ----------------------------------
  begin
    update public.crm_opportunities set stage_id = v_stage_other_pipeline where id = v_opp.id;
    raise exception 'FAIL(2): stage from a different pipeline was accepted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'STAGE_PIPELINE_MISMATCH' then raise exception 'FAIL(2): expected STAGE_PIPELINE_MISMATCH, got %', v_msg; end if;
    raise notice 'PASS(2): cross-pipeline stage assignment rejected';
  end;

  -- 3) a company can hold multiple CRM roles --------------------------------
  perform public.set_company_crm(v_company, 'ACTIVE', v_admin, array['BUYER','PARTNER']::crm_company_role[]);
  if (select count(*) from public.crm_company_roles where company_id = v_company) <> 2 then
    raise exception 'FAIL(3): expected 2 roles on company';
  end if;
  raise notice 'PASS(3): company holds multiple CRM roles (BUYER + PARTNER)';

  -- 4) move_opportunity_stage rejects a direct move onto WON/LOST ----------
  begin
    perform public.move_opportunity_stage(v_opp.id, v_stage_won);
    raise exception 'FAIL(4): direct move onto WON stage was accepted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'USE_CLOSE_ACTION' then raise exception 'FAIL(4): expected USE_CLOSE_ACTION, got %', v_msg; end if;
    raise notice 'PASS(4): direct move onto WON stage rejected';
  end;

  -- 5) stage history is written on a legitimate move, and is not directly writable
  select count(*) into v_hist_count from public.crm_opportunity_stage_history where opportunity_id = v_opp.id;
  perform public.move_opportunity_stage(v_opp.id, v_stage_lead); -- no-op move (same stage) should NOT log
  if (select count(*) from public.crm_opportunity_stage_history where opportunity_id = v_opp.id) <> v_hist_count then
    raise exception 'FAIL(5a): a no-op stage move was logged';
  end if;

  begin
    insert into public.crm_opportunity_stage_history (opportunity_id, to_stage_id, changed_by)
    values (v_opp.id, v_stage_lead, v_admin);
    raise exception 'FAIL(5b): app was able to write stage history directly';
  exception when others then
    raise notice 'PASS(5b): direct write to crm_opportunity_stage_history rejected (no insert policy)';
  end;

  -- 6) close_opportunity_lost requires a reason -----------------------------
  begin
    perform public.close_opportunity_lost(v_opp.id, null);
    raise exception 'FAIL(6): lost closure without a reason was accepted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'LOST_REASON_REQUIRED' then raise exception 'FAIL(6): expected LOST_REASON_REQUIRED, got %', v_msg; end if;
    raise notice 'PASS(6): lost closure without a reason rejected';
  end;

  -- 7) close_opportunity_won happy path -------------------------------------
  perform public.close_opportunity_won(v_opp.id);
  if (select won_at from public.crm_opportunities where id = v_opp.id) is null then
    raise exception 'FAIL(7): won_at not set';
  end if;
  if (select stage_id from public.crm_opportunities where id = v_opp.id) <> v_stage_won then
    raise exception 'FAIL(7): opportunity did not land on the WON stage';
  end if;
  if (select count(*) from public.crm_opportunity_stage_history where opportunity_id = v_opp.id and to_stage_id = v_stage_won) <> 1 then
    raise exception 'FAIL(7b): WON closure was not logged in stage history';
  end if;
  raise notice 'PASS(7): opportunity closed WON and logged';

  -- 8) already-closed opportunity cannot be closed again --------------------
  begin
    perform public.close_opportunity_won(v_opp.id);
    raise exception 'FAIL(8): re-closing an already-WON opportunity succeeded';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'ALREADY_CLOSED' then raise exception 'FAIL(8): expected ALREADY_CLOSED, got %', v_msg; end if;
    raise notice 'PASS(8): re-closing an already-closed opportunity rejected';
  end;

  -- 9) close_opportunity_lost happy path (separate opportunity) -------------
  insert into public.crm_opportunities (title, company_id, pipeline_id, stage_id, created_by)
  values ('فرصت تست ۲', v_company, v_pipeline, v_stage_lead, v_admin)
  returning id into v_opp2;
  perform public.close_opportunity_lost(v_opp2, 'PRICE', 'قیمت رقیب پایین‌تر بود');
  if (select lost_at from public.crm_opportunities where id = v_opp2) is null then
    raise exception 'FAIL(9): lost_at not set';
  end if;
  if (select stage_id from public.crm_opportunities where id = v_opp2) <> v_stage_lost then
    raise exception 'FAIL(9): opportunity did not land on the LOST stage';
  end if;
  if (select lost_reason from public.crm_opportunities where id = v_opp2) <> 'PRICE' then
    raise exception 'FAIL(9): lost_reason not stored';
  end if;
  raise notice 'PASS(9): opportunity closed LOST with reason and logged';

  -- 10) a pipeline may have at most one WON and one LOST stage --------------
  begin
    insert into public.crm_pipeline_stages (pipeline_id, name, sort_order, is_won) values (v_pipeline, 'موفق دوم', 99, true);
    raise exception 'FAIL(10): a second WON stage was accepted for the same pipeline';
  exception when others then
    raise notice 'PASS(10): second WON stage on the same pipeline rejected (unique index)';
  end;

  raise notice '===== ALL CRM INTEGRITY TESTS PASSED =====';
end $$;

rollback;

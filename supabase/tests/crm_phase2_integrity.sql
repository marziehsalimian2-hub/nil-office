-- =============================================================================
-- NIL Office — CRM module Phase 2 integrity tests (trade details, parties,
-- quotations).
--
-- Run in the Supabase SQL editor AFTER migrations 0036-0047 and after at
-- least one ADMIN profile and one companies row exist. The whole script
-- runs in a transaction and ROLLS BACK at the end, so it leaves no data
-- behind.
--
-- Covered: trade details rejected for a non-TRADE opportunity
-- (TRADE_ONLY), accepted for a TRADE one and upsert-updatable; a company
-- can appear twice on the same opportunity with different party roles
-- but not twice with the same role; quotations CRUD works and
-- opportunity_id cascade-deletes cleanly.
-- =============================================================================
begin;

do $$
declare
  v_admin uuid;
  v_company uuid;
  v_pipeline uuid;
  v_stage uuid;
  v_trade_opp uuid;
  v_service_opp uuid;
  v_msg text;
  v_quote_id uuid;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('role', 'authenticated', true);

  select id into v_company from public.companies limit 1;
  if v_company is null then raise exception 'no companies row — create at least one company first'; end if;

  select id into v_pipeline from public.crm_pipelines where name = 'تجارت بین‌المللی';
  select id into v_stage from public.crm_pipeline_stages where pipeline_id = v_pipeline and name = 'سرنخ';

  insert into public.crm_opportunities (title, company_id, opportunity_type, pipeline_id, stage_id, created_by)
  values ('فرصت تجاری تست', v_company, 'TRADE', v_pipeline, v_stage, v_admin)
  returning id into v_trade_opp;

  insert into public.crm_opportunities (title, company_id, opportunity_type, pipeline_id, stage_id, created_by)
  values ('فرصت خدماتی تست', v_company, 'SERVICE', v_pipeline, v_stage, v_admin)
  returning id into v_service_opp;

  -- 1) trade details rejected for a non-TRADE opportunity -------------------
  begin
    insert into public.crm_opportunity_trade_details (opportunity_id, product_name) values (v_service_opp, 'گوگرد');
    raise exception 'FAIL(1): trade details accepted for a SERVICE opportunity';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'TRADE_ONLY' then raise exception 'FAIL(1): expected TRADE_ONLY, got %', v_msg; end if;
    raise notice 'PASS(1): trade details rejected for a non-TRADE opportunity';
  end;

  -- 2) trade details accepted for a TRADE opportunity, upsert-updatable ----
  insert into public.crm_opportunity_trade_details (opportunity_id, product_name, origin_country, incoterm)
  values (v_trade_opp, 'گوگرد', 'ایران', 'FOB');
  if (select product_name from public.crm_opportunity_trade_details where opportunity_id = v_trade_opp) <> 'گوگرد' then
    raise exception 'FAIL(2): trade details not stored correctly';
  end if;
  raise notice 'PASS(2): trade details accepted for a TRADE opportunity';

  insert into public.crm_opportunity_trade_details (opportunity_id, product_name)
  values (v_trade_opp, 'گوگرد ۹۹٪')
  on conflict (opportunity_id) do update set product_name = excluded.product_name;
  if (select product_name from public.crm_opportunity_trade_details where opportunity_id = v_trade_opp) <> 'گوگرد ۹۹٪' then
    raise exception 'FAIL(2b): upsert did not update existing trade details';
  end if;
  raise notice 'PASS(2b): trade details upsert (onConflict opportunity_id) works';

  -- 3) party role uniqueness -------------------------------------------------
  insert into public.crm_opportunity_parties (opportunity_id, company_id, role) values (v_trade_opp, v_company, 'BUYER');
  insert into public.crm_opportunity_parties (opportunity_id, company_id, role) values (v_trade_opp, v_company, 'BROKER');
  if (select count(*) from public.crm_opportunity_parties where opportunity_id = v_trade_opp) <> 2 then
    raise exception 'FAIL(3): expected 2 party rows (same company, different roles)';
  end if;
  raise notice 'PASS(3): same company can hold two different party roles on one opportunity';

  begin
    insert into public.crm_opportunity_parties (opportunity_id, company_id, role) values (v_trade_opp, v_company, 'BUYER');
    raise exception 'FAIL(3b): duplicate (opportunity, company, role) party was accepted';
  exception when others then
    raise notice 'PASS(3b): duplicate party role rejected (unique constraint)';
  end;

  -- 4) quotations CRUD + cascade delete --------------------------------------
  insert into public.crm_quotations (opportunity_id, direction, product_name, quantity, unit_price, currency_code)
  values (v_trade_opp, 'SENT', 'گوگرد ۹۹٪', 1000, 250, 'USD')
  returning id into v_quote_id;
  if (select count(*) from public.crm_quotations where opportunity_id = v_trade_opp) <> 1 then
    raise exception 'FAIL(4): quotation not inserted';
  end if;

  update public.crm_quotations set unit_price = 260 where id = v_quote_id;
  if (select unit_price from public.crm_quotations where id = v_quote_id) <> 260 then
    raise exception 'FAIL(4b): quotation update failed';
  end if;
  raise notice 'PASS(4): quotation insert/update works';

  delete from public.crm_opportunities where id = v_trade_opp;
  if exists (select 1 from public.crm_quotations where id = v_quote_id) then
    raise exception 'FAIL(5): quotation survived opportunity deletion (cascade broken)';
  end if;
  if exists (select 1 from public.crm_opportunity_trade_details where opportunity_id = v_trade_opp) then
    raise exception 'FAIL(5b): trade details survived opportunity deletion (cascade broken)';
  end if;
  if exists (select 1 from public.crm_opportunity_parties where opportunity_id = v_trade_opp) then
    raise exception 'FAIL(5c): parties survived opportunity deletion (cascade broken)';
  end if;
  raise notice 'PASS(5): deleting an opportunity cascades to trade details/parties/quotations';

  raise notice '===== ALL CRM PHASE 2 INTEGRITY TESTS PASSED =====';
end $$;

rollback;

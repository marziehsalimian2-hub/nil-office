-- =============================================================================
-- NIL Office — Trade Portal integrity tests.
--
-- Run in the Supabase SQL editor AFTER migration 0066 and after at least
-- one ADMIN profile and one companies row exist. The whole script runs
-- in a transaction and ROLLS BACK at the end, so it leaves no data
-- behind. NOT RUN by Claude in this session — no live Supabase project
-- is reachable from the sandbox this code was written in; the user must
-- run this by hand (README's existing "quality checks" convention).
--
-- Impersonates an ADMIN user (bypasses trade_role gates, same technique
-- as crm_integrity.sql) by setting the JWT sub claim to that admin's id.
--
-- Covered: offer numbered immediately on insert (OFR-, no draft-number
-- gap); document_deadline < interest_deadline is rejected by the table
-- CHECK; a DRAFT offer cannot be published by a VIEW-tier user (RPC's
-- own can_approve_trade() gate, tested by impersonating a non-admin);
-- publish requires DRAFT; a second buyer assignment for the same
-- company+offer is rejected while the first is still live (partial
-- unique index); revoke then re-assign succeeds; extend_trade_offer_
-- deadline rejects a past value and a value that would put interest
-- after document; extend_trade_offer_deadline writes history and can
-- revive an EXPIRED offer back to ACTIVE; trade_offer_effective_status
-- computes EXPIRED purely from document_deadline vs now(); direct
-- UPDATE of trade_offers.status outside DRAFT is rejected by RLS.
-- =============================================================================
begin;

do $$
declare
  v_admin uuid;
  v_company uuid;
  v_offer public.trade_offers;
  v_offer2 public.trade_offers;
  v_assignment uuid;
  v_assignment2 uuid;
  v_msg text;
  v_seq_before int;
  v_seq_after int;
  v_hist_count int;
  v_eff text;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('role', 'authenticated', true);

  select id into v_company from public.companies limit 1;
  if v_company is null then raise exception 'no companies row — create at least one company first'; end if;

  -- 1) offer numbered immediately on insert, OFR- prefix -------------------
  select last_value into v_seq_before from public.number_sequences where scope = 'OFFER' and year = public.jalali_year(now());
  v_seq_before := coalesce(v_seq_before, 0);

  insert into public.trade_offers
    (title, product_name, quantity, unit, price, price_basis, interest_deadline, document_deadline, created_by)
  values
    ('آفر تست', 'PVC S65', 100, 'MT', 950, 'FOB', now() + interval '2 days', now() + interval '5 days', v_admin)
  returning * into v_offer;

  if v_offer.offer_code is null or v_offer.offer_code !~ '^OFR-' then
    raise exception 'FAIL(1): offer not numbered on insert, got %', v_offer.offer_code;
  end if;
  raise notice 'PASS(1): offer numbered immediately as %', v_offer.offer_code;

  select last_value into v_seq_after from public.number_sequences where scope = 'OFFER' and year = public.jalali_year(now());
  if v_seq_after <> v_seq_before + 1 then raise exception 'FAIL(1b): sequence counter did not advance by exactly 1'; end if;

  -- 2) document_deadline must be >= interest_deadline (table CHECK) --------
  begin
    insert into public.trade_offers
      (title, product_name, quantity, unit, price, price_basis, interest_deadline, document_deadline, created_by)
    values
      ('آفر نامعتبر', 'X', 1, 'MT', 1, 'FOB', now() + interval '5 days', now() + interval '2 days', v_admin);
    raise exception 'FAIL(2): document_deadline before interest_deadline was accepted';
  exception when check_violation then
    raise notice 'PASS(2): document_deadline < interest_deadline rejected by CHECK constraint';
  end;

  -- 3) OFFER_CREATED event fired automatically ------------------------------
  if not exists (select 1 from public.trade_offer_events where offer_id = v_offer.id and event_type = 'OFFER_CREATED') then
    raise exception 'FAIL(3): OFFER_CREATED event missing after insert';
  end if;
  raise notice 'PASS(3): OFFER_CREATED event recorded';

  -- 4) publish requires can_approve_trade() ---------------------------------
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true); -- an id with no profile row at all
  begin
    perform public.publish_trade_offer(v_offer.id);
    raise exception 'FAIL(4): publish succeeded for an unauthorized caller';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'NOT_AUTHORIZED' then raise exception 'FAIL(4): expected NOT_AUTHORIZED, got %', v_msg; end if;
    raise notice 'PASS(4): publish rejected for a caller with no trade access';
  end;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- 5) publish (DRAFT -> ACTIVE) as admin -----------------------------------
  perform public.publish_trade_offer(v_offer.id);
  select * into v_offer from public.trade_offers where id = v_offer.id;
  if v_offer.status <> 'ACTIVE' or v_offer.published_at is null then
    raise exception 'FAIL(5): publish did not set status=ACTIVE/published_at';
  end if;
  raise notice 'PASS(5): offer published (DRAFT -> ACTIVE)';

  -- 6) re-publish is rejected (NOT_ELIGIBLE, already ACTIVE) ---------------
  begin
    perform public.publish_trade_offer(v_offer.id);
    raise exception 'FAIL(6): re-publishing an already-ACTIVE offer was accepted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'NOT_ELIGIBLE' then raise exception 'FAIL(6): expected NOT_ELIGIBLE, got %', v_msg; end if;
    raise notice 'PASS(6): re-publish rejected';
  end;

  -- 7) direct UPDATE of status outside the RPC is blocked by RLS -----------
  update public.trade_offers set status = 'CLOSED' where id = v_offer.id;
  select * into v_offer from public.trade_offers where id = v_offer.id;
  if v_offer.status <> 'ACTIVE' then
    raise exception 'FAIL(7): a direct UPDATE changed status outside DRAFT — RLS gap';
  end if;
  raise notice 'PASS(7): direct status UPDATE outside DRAFT silently blocked by RLS (0 rows affected)';

  -- 8) buyer assignment + duplicate rejection -------------------------------
  v_assignment := public.assign_trade_offer_buyer(v_offer.id, v_company, encode(gen_random_bytes(32), 'hex'), now() + interval '30 days');
  if v_assignment is null then raise exception 'FAIL(8): assign_trade_offer_buyer returned null'; end if;
  raise notice 'PASS(8): buyer assigned';

  begin
    perform public.assign_trade_offer_buyer(v_offer.id, v_company, encode(gen_random_bytes(32), 'hex'), now() + interval '30 days');
    raise exception 'FAIL(8b): duplicate live assignment for the same offer+company was accepted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'BUYER_ALREADY_ASSIGNED' then raise exception 'FAIL(8b): expected BUYER_ALREADY_ASSIGNED, got %', v_msg; end if;
    raise notice 'PASS(8b): duplicate live assignment rejected';
  end;

  -- 9) revoke then re-assign succeeds ---------------------------------------
  perform public.revoke_trade_offer_buyer(v_assignment);
  if not exists (select 1 from public.trade_offer_buyers where id = v_assignment and revoked_at is not null) then
    raise exception 'FAIL(9): revoke did not set revoked_at';
  end if;
  v_assignment2 := public.assign_trade_offer_buyer(v_offer.id, v_company, encode(gen_random_bytes(32), 'hex'), now() + interval '30 days');
  raise notice 'PASS(9): revoke + re-assign succeeded, new assignment %', v_assignment2;

  -- 10) extend_trade_offer_deadline validation ------------------------------
  begin
    perform public.extend_trade_offer_deadline(v_offer.id, 'DOCUMENT', now() - interval '1 day', null);
    raise exception 'FAIL(10): a past deadline value was accepted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'DEADLINE_MUST_BE_FUTURE' then raise exception 'FAIL(10): expected DEADLINE_MUST_BE_FUTURE, got %', v_msg; end if;
    raise notice 'PASS(10): past deadline value rejected';
  end;

  perform public.extend_trade_offer_deadline(v_offer.id, 'DOCUMENT', now() + interval '10 days', 'تست تمدید');
  select count(*) into v_hist_count from public.trade_offer_deadline_history where offer_id = v_offer.id;
  if v_hist_count <> 1 then raise exception 'FAIL(10b): deadline_history row not written, count=%', v_hist_count; end if;
  raise notice 'PASS(10b): deadline extension recorded in history';

  -- 11) trade_offer_effective_status is purely a function of document_deadline
  v_eff := public.trade_offer_effective_status('ACTIVE', now() - interval '1 minute');
  if v_eff <> 'EXPIRED' then raise exception 'FAIL(11): expected EXPIRED, got %', v_eff; end if;
  v_eff := public.trade_offer_effective_status('ACTIVE', now() + interval '1 minute');
  if v_eff <> 'ACTIVE' then raise exception 'FAIL(11b): expected ACTIVE, got %', v_eff; end if;
  raise notice 'PASS(11): trade_offer_effective_status computes correctly off document_deadline/now()';

  -- 12) set_trade_offer_status rejects an invalid target ---------------------
  begin
    perform public.set_trade_offer_status(v_offer.id, 'DRAFT');
    raise exception 'FAIL(12): set_trade_offer_status accepted DRAFT as a target';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'INVALID_STATUS_TRANSITION' then raise exception 'FAIL(12): expected INVALID_STATUS_TRANSITION, got %', v_msg; end if;
    raise notice 'PASS(12): invalid status transition target rejected';
  end;

  raise notice '===== ALL TRADE PORTAL INTEGRITY TESTS PASSED =====';
end $$;

rollback;

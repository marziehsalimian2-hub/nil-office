-- =============================================================================
-- NIL Office — NIL Verify (migration 0143) integrity + security tests.
-- Run by hand in the Supabase SQL editor AFTER migration 0143, with at least one active ADMIN profile.
-- ONE transaction, ROLLED BACK at the end. SYNTHETIC fixtures only (documents with far-future numbers: letter ص-1500-…, year 1500).
-- The script temporarily re-roles the first ADMIN profile (rolled back) — do NOT run it while that admin is actively using the app.
-- NOT RUN by Claude — the user runs it. Success = the statement finishes with no error
-- ("Success. No rows returned" in the Supabase editor; the PASS notice is not shown there).
--
-- Covers: grants (nothing public except via service_role), RLS / no policies, config defaults, issuance gates, PENDING -> ACTIVE evidence,
-- idempotency + the one-live-record index, frozen identity, no delete, public lookup allow-list (no ids / hashes / paths), PENDING is not public,
-- hash check, disclosure policy per type (contract amount off by default), revoke / supersede gates + reason, QR never dead after revoke,
-- auto-revoke on cancel, rate limiter, ADMIN-only settings, Factory Reset integration.
-- =============================================================================
begin;

create function pg_temp.persona(p_user uuid, p_role text, p_invoice text default null, p_contract text default null) returns void
language plpgsql as $$
begin
  execute 'reset role';
  update public.profiles set role = p_role::app_role, invoice_role = p_invoice::invoice_role, contract_role = p_contract::contract_role where id = p_user;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  execute 'set role authenticated';
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

create function pg_temp.chk(p_label text, p_ok boolean) returns void
language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL(%)', p_label; end if;
end $$;

create function pg_temp.h(p_seed text) returns text language sql as $$ select encode(sha256(convert_to(p_seed, 'UTF8')), 'hex') $$;

do $$
declare
  v_admin uuid; v_type uuid; v_co uuid;
  v_l uuid; v_d uuid; v_p uuid; v_p2 uuid; v_i uuid; v_k uuid; v_k2 uuid; v_cancel_l uuid;
  v_b jsonb; v_v_l uuid; v_v_p uuid; v_v_p2 uuid; v_v_i uuid; v_v_k uuid; v_v_k2 uuid; v_pub jsonb; v_chk jsonb; v_cnt integer; v_hash text;
  v_hash_l text := pg_temp.h('letter-final-pdf'); v_hash_other text := pg_temp.h('some-other-file');
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active order by created_at limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;
  select id into v_type from public.contract_types limit 1;
  if v_type is null then raise exception 'no contract_types row'; end if;

  -- 1) grants / RLS ----------------------------------------------------------------------------------------------------------------------
  perform pg_temp.chk('anon has no table access', not has_table_privilege('anon', 'public.document_verifications', 'select') and not has_table_privilege('anon', 'public.verification_settings', 'select'));
  perform pg_temp.chk('authenticated has no table access', not has_table_privilege('authenticated', 'public.document_verifications', 'select')
                      and not has_table_privilege('authenticated', 'public.document_verifications', 'update') and not has_table_privilege('authenticated', 'public.verification_rate_limits', 'select'));
  perform pg_temp.chk('public lookup / hash check / rate check: service_role only',
    not has_function_privilege('anon', 'public.verify_public_lookup(text)', 'execute') and not has_function_privilege('authenticated', 'public.verify_public_lookup(text)', 'execute')
    and not has_function_privilege('anon', 'public.verify_public_hash_check(text,text)', 'execute') and not has_function_privilege('authenticated', 'public.verify_public_hash_check(text,text)', 'execute')
    and not has_function_privilege('anon', 'public.verify_rate_check(text,text,integer,integer)', 'execute') and not has_function_privilege('authenticated', 'public.verify_rate_check(text,text,integer,integer)', 'execute')
    and has_function_privilege('service_role', 'public.verify_public_lookup(text)', 'execute'));
  perform pg_temp.chk('anon cannot issue / revoke / configure',
    not has_function_privilege('anon', 'public.verify_begin(text,uuid,text)', 'execute') and not has_function_privilege('anon', 'public.verify_revoke(uuid,text)', 'execute')
    and not has_function_privilege('anon', 'public.verify_update_settings(boolean,text,text,boolean)', 'execute'));
  perform pg_temp.chk('RLS on, and NO policy exists, on the four tables',
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('document_verifications','verification_settings','verification_doc_types','verification_rate_limits') and c.relrowsecurity) = 4
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('document_verifications','verification_settings','verification_doc_types','verification_rate_limits')));

  -- 2) configuration defaults -------------------------------------------------------------------------------------------------------------
  perform pg_temp.chk('settings default: enabled, contract amount NOT public', (select enabled and not show_contract_amount from public.verification_settings where id = 1));
  perform pg_temp.chk('four document types, all enabled, defaults in range', (select count(*) from public.verification_doc_types where enabled) = 4);

  -- 3) fixtures (finalized documents, far-future numbers) -----------------------------------------------------------------------------------
  insert into public.companies (legal_name, created_by) values ('شرکت آزمایشی نیل‌ورفای', v_admin) returning id into v_co;
  insert into public.correspondence (direction, status, subject, recipient_company_id, created_by, sequence_number, display_number, year, finalized_at)
    values ('OUTGOING', 'FINALIZED', 'موضوع محرمانه نیست', v_co, v_admin, 987001, 'ص-1500-0001', 1500, now()) returning id into v_l;
  insert into public.correspondence (direction, status, subject, created_by) values ('OUTGOING', 'DRAFT', 'پیش‌نویس', v_admin) returning id into v_d;
  insert into public.correspondence (direction, status, subject, created_by, sequence_number, display_number, year, finalized_at)
    values ('OUTGOING', 'FINALIZED', 'نامهٔ لغوشونده', v_admin, 987002, 'ص-1500-0002', 1500, now()) returning id into v_cancel_l;
  insert into public.sales_documents (type, status, sequence_number, display_number, year, customer_legal_name_snapshot, company_id, created_by, issue_date, validity_date, currency_code, subtotal, issued_at)
    values ('PROFORMA', 'ISSUED', 987001, 'PI-1500-0001', 1500, 'مشتری پیش‌فاکتور', v_co, v_admin, date '2071-04-01', date '2071-05-01', 'IRR', 12500000, now()) returning id into v_p;
  insert into public.sales_documents (type, status, sequence_number, display_number, year, customer_legal_name_snapshot, company_id, created_by, issue_date, currency_code, subtotal, issued_at, customer_national_id_snapshot, notes)
    values ('PROFORMA', 'ISSUED', 987002, 'PI-1500-0002', 1500, 'مشتری پیش‌فاکتور ۲', v_co, v_admin, date '2071-04-02', 'IRR', 100, now(), '1234567890', 'INTERNAL-NOTE') returning id into v_p2;
  insert into public.sales_documents (type, status, sequence_number, display_number, year, customer_legal_name_snapshot, company_id, created_by, issue_date, currency_code, subtotal, issued_at, customer_phone_snapshot, notes)
    values ('INVOICE', 'ISSUED', 987003, 'INV-1500-0001', 1500, 'مشتری فاکتور', v_co, v_admin, date '2071-04-03', 'USD', 3500, now(), '09120000000', 'INTERNAL-NOTE') returning id into v_i;
  insert into public.contracts (contract_type_id, title, kind, status, created_by, counterparty_company_id, sequence_number, display_number, year, finalized_at, signed_date, base_amount, currency_code, internal_notes, description)
    values (v_type, 'قرارداد آزمایشی', 'NIL_ISSUED', 'APPROVED', v_admin, v_co, 987001, 'C-1500-0001', 1500, now(), date '2071-04-05', 9000000, 'IRR', 'INTERNAL-NOTE', 'INTERNAL-TERMS') returning id into v_k;
  insert into public.contracts (contract_type_id, title, kind, status, created_by, counterparty_company_id, sequence_number, display_number, year, finalized_at, base_amount, currency_code)
    values (v_type, 'قرارداد آزمایشی ۲', 'NIL_ISSUED', 'APPROVED', v_admin, v_co, 987002, 'C-1500-0002', 1500, now(), 7000000, 'IRR') returning id into v_k2;

  -- 4) issuance gates -----------------------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'ADMIN');
  perform pg_temp.expect_err(format('select public.verify_begin(%L,%L,%L)', 'OUTGOING_CORRESPONDENCE', v_d, pg_temp.h('t-draft')), 'VERIFY_NOT_ELIGIBLE');         -- a draft is never verified
  perform pg_temp.expect_err(format('select public.verify_begin(%L,%L,%L)', 'PAYSLIP', v_l, pg_temp.h('t-x')), 'VERIFY_INVALID');                                  -- out of scope type
  perform pg_temp.expect_err(format('select public.verify_begin(%L,%L,%L)', 'OUTGOING_CORRESPONDENCE', v_l, 'not-a-hash'), 'VERIFY_INVALID');
  perform pg_temp.expect_err(format('select public.verify_begin(%L,%L,%L)', 'OUTGOING_CORRESPONDENCE', gen_random_uuid(), pg_temp.h('t-nf')), 'NOT_FOUND');
  perform pg_temp.expect_err(format('select public.verify_begin(%L,%L,%L)', 'INVOICE', v_p, pg_temp.h('t-wrong-type')), 'VERIFY_NOT_ELIGIBLE');                  -- a PROFORMA is not an INVOICE
  perform pg_temp.persona(v_admin, 'USER');                                                                                                                      -- an ordinary user (no invoice / contract role)
  perform pg_temp.expect_err(format('select public.verify_begin(%L,%L,%L)', 'INVOICE', v_i, pg_temp.h('t-nope')), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.verify_begin(%L,%L,%L)', 'CONTRACT', v_k, pg_temp.h('t-nope2')), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.verify_document_status(%L,%L)', 'INVOICE', v_i), 'NOT_AUTHORIZED');
  execute 'reset role';
  perform pg_temp.chk('nothing was created by the refused calls', (select count(*) from public.document_verifications) = 0);

  -- 5) letter: begin (PENDING) -> token replace -> activate (ACTIVE) --------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'ADMIN');
  v_b := public.verify_begin('OUTGOING_CORRESPONDENCE', v_l, pg_temp.h('tok-l-1'));
  v_v_l := (v_b ->> 'id')::uuid;
  perform pg_temp.chk('PENDING with a well-formed code', v_b ->> 'status' = 'PENDING' and v_b ->> 'code' ~ '^NIL-V-[A-Z2-9]{4}-[A-Z2-9]{4}$');
  v_b := public.verify_begin('OUTGOING_CORRESPONDENCE', v_l, pg_temp.h('tok-l-2'));                                  -- retry: same record, new (unused) token
  execute 'reset role';                                                                                              -- (the verification tables are not readable by `authenticated` - by design)
  perform pg_temp.chk('idempotent: still ONE record, same id, token replaced', (v_b ->> 'id')::uuid = v_v_l and (select count(*) from public.document_verifications where document_id = v_l) = 1);
  perform pg_temp.chk('the raw token is not stored, only a hash', (select token_hash from public.document_verifications where id = v_v_l) = pg_temp.h('tok-l-2'));
  perform pg_temp.chk('PENDING is not public (old or new token)', (public.verify_public_lookup(pg_temp.h('tok-l-1')) ->> 'found')::boolean = false and (public.verify_public_lookup(pg_temp.h('tok-l-2')) ->> 'found')::boolean = false);
  perform pg_temp.expect_err(format($q$insert into public.document_verifications (verification_code, token_hash, document_type, document_id, document_number_snapshot, issued_at, issuer_snapshot)
      values ('NIL-V-AAAA-BBBB', %L, 'OUTGOING_CORRESPONDENCE', %L, 'x', now(), 'x')$q$, pg_temp.h('tok-dup'), v_l), 'uq_document_verification_live');   -- a second live record for the same document: refused by the DB
  perform pg_temp.persona(v_admin, 'ADMIN');
  perform pg_temp.expect_err(format('select public.verify_activate(%L,%L,%s,%L)', v_v_l, 'zz', 100, 'verified/' || v_v_l || '.pdf'), 'VERIFY_INVALID');           -- bad hash
  perform pg_temp.expect_err(format('select public.verify_activate(%L,%L,%s,%L)', v_v_l, v_hash_l, 100, 'verified/other.pdf'), 'VERIFY_INVALID');                 -- path is derived from the id only
  perform pg_temp.expect_err(format('select public.verify_activate(%L,%L,%s,%L)', v_v_l, v_hash_l, 0, 'verified/' || v_v_l || '.pdf'), 'VERIFY_INVALID');        -- empty file
  perform public.verify_activate(v_v_l, v_hash_l, 4096, 'verified/' || v_v_l || '.pdf');
  perform pg_temp.expect_err(format('select public.verify_activate(%L,%L,%s,%L)', v_v_l, v_hash_l, 4096, 'verified/' || v_v_l || '.pdf'), 'VERIFY_NOT_PENDING');
  v_b := public.verify_begin('OUTGOING_CORRESPONDENCE', v_l, pg_temp.h('tok-l-3'));
  perform pg_temp.chk('status RPC for the module, and begin on an ACTIVE document is a no-op', (public.verify_document_status('OUTGOING_CORRESPONDENCE', v_l) ->> 'status') = 'ACTIVE' and (v_b ->> 'already_active')::boolean);
  execute 'reset role';
  perform pg_temp.chk('ACTIVE with the hash recorded, and still no second identity', (select status = 'ACTIVE' and pdf_hash = v_hash_l and pdf_hash_algorithm = 'SHA-256' and activated_at is not null from public.document_verifications where id = v_v_l)
                      and (select count(*) from public.document_verifications where document_id = v_l) = 1);
  perform pg_temp.expect_err(format('update public.document_verifications set pdf_hash = %L where id = %L', v_hash_other, v_v_l), 'VERIFY_FIELD_IMMUTABLE');           -- evidence is frozen
  perform pg_temp.expect_err(format('update public.document_verifications set verification_code = %L where id = %L', 'NIL-V-ZZZZ-ZZZZ', v_v_l), 'VERIFY_FIELD_IMMUTABLE');
  perform pg_temp.expect_err(format('update public.document_verifications set public_metadata_snapshot = %L where id = %L', '{"x":1}', v_v_l), 'VERIFY_FIELD_IMMUTABLE');
  perform pg_temp.expect_err(format('delete from public.document_verifications where id = %L', v_v_l), 'VERIFY_NO_DELETE');
  perform pg_temp.expect_err(format('update public.document_verifications set status = %L where id = %L', 'PENDING', v_v_l), 'VERIFY_INVALID_TRANSITION');

  -- 6) public lookup: fixed allow-list projection, nothing internal -----------------------------------------------------------------------------
  v_hash := pg_temp.h('tok-l-3');                                                                    -- (the token hash of an ACTIVE letter is the one stored last: tok-l-2)
  v_pub := public.verify_public_lookup(pg_temp.h('tok-l-2'));
  perform pg_temp.chk('lookup found, ACTIVE, correct number', (v_pub ->> 'found')::boolean and v_pub ->> 'status' = 'ACTIVE' and v_pub ->> 'document_number' = 'ص-1500-0001' and v_pub ->> 'document_type' = 'OUTGOING_CORRESPONDENCE');
  perform pg_temp.chk('projection keys are exactly the allow-list',
    (select array_agg(k order by k) from jsonb_object_keys(v_pub) k) = array['code','document_number','document_type','found','issued_at','issuer','metadata','public_label','replacement','revoked_at','status']::text[]
    or (select array_agg(k order by k) from jsonb_object_keys(v_pub) k) = array['code','document_number','document_type','found','issued_at','issuer','metadata','public_label','status']::text[]);
  perform pg_temp.chk('letter metadata = recipient + subject only', (select array_agg(k order by k) from jsonb_object_keys(v_pub -> 'metadata') k) = array['recipient','subject']::text[]);
  perform pg_temp.chk('no internal id, hash or storage path leaks',
    position(v_l::text in v_pub::text) = 0 and position(v_v_l::text in v_pub::text) = 0 and position(v_hash_l in v_pub::text) = 0 and position('verified/' in v_pub::text) = 0
    and position(v_admin::text in v_pub::text) = 0 and position(v_co::text in v_pub::text) = 0);
  perform pg_temp.chk('metadata snapshot comes from the document at issuance', v_pub #>> '{metadata,subject}' = 'موضوع محرمانه نیست' and v_pub #>> '{metadata,recipient}' = 'شرکت آزمایشی نیل‌ورفای');
  perform pg_temp.chk('malformed / unknown identifiers are a generic not-found',
    (public.verify_public_lookup('1') ->> 'found')::boolean = false and (public.verify_public_lookup('') ->> 'found')::boolean = false
    and (public.verify_public_lookup(null) ->> 'found')::boolean = false and (public.verify_public_lookup(repeat('a', 64)) ->> 'found')::boolean = false
    and (public.verify_public_lookup('x'';drop table document_verifications;--') ->> 'found')::boolean = false);
  perform pg_temp.chk('the lookup counts', (select verification_count >= 1 and last_verified_at is not null from public.document_verifications where id = v_v_l));
  -- file check
  v_chk := public.verify_public_hash_check(pg_temp.h('tok-l-2'), v_hash_l);
  perform pg_temp.chk('exact file -> MATCH', (v_chk ->> 'match')::boolean and (v_chk ->> 'found')::boolean);
  perform pg_temp.chk('other file -> MISMATCH (and the stored hash is never returned)', not (public.verify_public_hash_check(pg_temp.h('tok-l-2'), v_hash_other) ->> 'match')::boolean
                      and position(v_hash_l in public.verify_public_hash_check(pg_temp.h('tok-l-2'), v_hash_other)::text) = 0);
  perform pg_temp.chk('uppercase hash still compares', (public.verify_public_hash_check(pg_temp.h('tok-l-2'), upper(v_hash_l)) ->> 'match')::boolean);
  perform pg_temp.chk('malformed hash is flagged invalid, unknown token is not found',
    (public.verify_public_hash_check(pg_temp.h('tok-l-2'), 'abc') ->> 'invalid')::boolean and not (public.verify_public_hash_check(pg_temp.h('nope'), v_hash_l) ->> 'found')::boolean);

  -- 7) disclosure policy per type -------------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'ADMIN');
  v_v_p  := (public.verify_begin('PROFORMA', v_p, pg_temp.h('tok-p')) ->> 'id')::uuid;
  v_v_p2 := (public.verify_begin('PROFORMA', v_p2, pg_temp.h('tok-p2')) ->> 'id')::uuid;
  v_v_i  := (public.verify_begin('INVOICE', v_i, pg_temp.h('tok-i')) ->> 'id')::uuid;
  v_v_k  := (public.verify_begin('CONTRACT', v_k, pg_temp.h('tok-k')) ->> 'id')::uuid;
  perform public.verify_activate(v_v_p,  pg_temp.h('f-p'),  100, 'verified/' || v_v_p  || '.pdf');
  perform public.verify_activate(v_v_p2, pg_temp.h('f-p2'), 100, 'verified/' || v_v_p2 || '.pdf');
  perform public.verify_activate(v_v_i,  pg_temp.h('f-i'),  100, 'verified/' || v_v_i  || '.pdf');
  perform public.verify_activate(v_v_k,  pg_temp.h('f-k'),  100, 'verified/' || v_v_k  || '.pdf');
  execute 'reset role';
  perform pg_temp.chk('proforma metadata: customer, issue date, valid until, currency, total',
    (select array_agg(k order by k) from jsonb_object_keys(public.verify_public_lookup(pg_temp.h('tok-p')) -> 'metadata') k) = array['currency','customer','issue_date','total_amount','valid_until']::text[]
    and public.verify_public_lookup(pg_temp.h('tok-p')) #>> '{metadata,total_amount}' = '12500000.0000');
  perform pg_temp.chk('invoice metadata: no valid_until; USD total', (select array_agg(k order by k) from jsonb_object_keys(public.verify_public_lookup(pg_temp.h('tok-i')) -> 'metadata') k) = array['currency','customer','issue_date','total_amount']::text[]
                      and public.verify_public_lookup(pg_temp.h('tok-i')) #>> '{metadata,currency}' = 'USD');
  perform pg_temp.chk('NOTHING internal reaches the public projection (national id, phone, notes, terms, bank)',
    position('1234567890' in (public.verify_public_lookup(pg_temp.h('tok-p2')))::text) = 0 and position('09120000000' in (public.verify_public_lookup(pg_temp.h('tok-i')))::text) = 0
    and position('INTERNAL' in (public.verify_public_lookup(pg_temp.h('tok-i')))::text) = 0 and position('INTERNAL' in (public.verify_public_lookup(pg_temp.h('tok-k')))::text) = 0
    and position('INTERNAL' in (public.verify_public_lookup(pg_temp.h('tok-p2')))::text) = 0);
  perform pg_temp.chk('contract metadata: counterparty + date; the AMOUNT is NOT public by default',
    (select array_agg(k order by k) from jsonb_object_keys(public.verify_public_lookup(pg_temp.h('tok-k')) -> 'metadata') k) = array['contract_date','counterparty']::text[]);
  perform pg_temp.persona(v_admin, 'ADMIN');
  perform public.verify_update_settings(true, 'شرکت توسعه مدیریت راهبردی نیل', 'استعلام اصالت سند', true);              -- the admin explicitly allows the amount
  v_v_k2 := (public.verify_begin('CONTRACT', v_k2, pg_temp.h('tok-k2')) ->> 'id')::uuid;
  perform public.verify_activate(v_v_k2, pg_temp.h('f-k2'), 100, 'verified/' || v_v_k2 || '.pdf');
  execute 'reset role';
  perform pg_temp.chk('with the policy on, NEW contracts show the amount',
    public.verify_public_lookup(pg_temp.h('tok-k2')) #>> '{metadata,total_amount}' = '7000000.0000');
  perform pg_temp.chk('...and the already-issued contract is NOT rewritten (snapshot principle)', not (public.verify_public_lookup(pg_temp.h('tok-k')) -> 'metadata' ? 'total_amount'));

  -- 8) revoke / supersede gates ------------------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER');
  perform pg_temp.expect_err(format('select public.verify_revoke(%L,%L)', v_v_i, 'reason here'), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.verify_supersede(%L,%L,%L)', v_v_p, v_v_p2, 'reason here'), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err('select public.verify_get_settings()', 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.verify_update_settings(true,%L,%L,false)', 'x', 'y'), 'NOT_AUTHORIZED');
  perform pg_temp.expect_err(format('select public.verify_update_doc_type(%L,true,%L,10,10,22,true,true,%L)', 'INVOICE', 'LAST', 'x'), 'NOT_AUTHORIZED');
  perform pg_temp.persona(v_admin, 'ADMIN');
  perform pg_temp.expect_err(format('select public.verify_revoke(%L,%L)', v_v_i, ''), 'REASON_REQUIRED');
  perform pg_temp.expect_err(format('select public.verify_revoke(%L,%L)', v_v_i, 'ab'), 'REASON_REQUIRED');
  perform public.verify_revoke(v_v_i, 'صدور اشتباه');
  execute 'reset role';
  v_pub := public.verify_public_lookup(pg_temp.h('tok-i'));
  perform pg_temp.chk('revoked: the page still answers (QR never dead), says REVOKED, and does not expose the reason',
    (v_pub ->> 'found')::boolean and v_pub ->> 'status' = 'REVOKED' and v_pub ->> 'revoked_at' is not null and position('صدور اشتباه' in v_pub::text) = 0);
  perform pg_temp.chk('the file check still works on a revoked record', (public.verify_public_hash_check(pg_temp.h('tok-i'), pg_temp.h('f-i')) ->> 'match')::boolean);
  perform pg_temp.persona(v_admin, 'ADMIN');
  perform pg_temp.expect_err(format('select public.verify_revoke(%L,%L)', v_v_i, 'twice'), 'VERIFY_INVALID_TRANSITION');
  perform pg_temp.expect_err(format('select public.verify_begin(%L,%L,%L)', 'INVOICE', v_i, pg_temp.h('tok-i-again')), 'VERIFY_ALREADY_CLOSED');          -- never silently re-verified
  perform pg_temp.expect_err(format('select public.verify_supersede(%L,%L,%L)', v_v_p, v_v_k, 'cross type'), 'VERIFY_INVALID_TRANSITION');
  perform pg_temp.expect_err(format('select public.verify_supersede(%L,%L,%L)', v_v_p, v_v_p, 'self'), 'VERIFY_INVALID');
  perform public.verify_supersede(v_v_p, v_v_p2, 'اصلاح مبلغ و صدور نسخهٔ جدید');
  execute 'reset role';
  v_pub := public.verify_public_lookup(pg_temp.h('tok-p'));
  perform pg_temp.chk('superseded: status + the replacement number is shown', v_pub ->> 'status' = 'SUPERSEDED' and v_pub #>> '{replacement,document_number}' = 'PI-1500-0002' and v_pub #>> '{replacement,document_type}' = 'PROFORMA');
  perform pg_temp.chk('the replacement is ACTIVE', public.verify_public_lookup(pg_temp.h('tok-p2')) ->> 'status' = 'ACTIVE');
  perform pg_temp.persona(v_admin, 'ADMIN');
  perform pg_temp.expect_err(format('select public.verify_supersede(%L,%L,%L)', v_v_p, v_v_p2, 'again'), 'VERIFY_INVALID_TRANSITION');
  perform pg_temp.expect_err(format('select public.verify_update_doc_type(%L,true,%L,10,10,5,true,true,%L)', 'INVOICE', 'LAST', 'x'), 'VERIFY_INVALID');         -- size below the minimum
  perform pg_temp.expect_err(format('select public.verify_update_doc_type(%L,true,%L,10,10,22,true,true,%L)', 'PAYSLIP', 'LAST', 'x'), 'NOT_FOUND');
  perform public.verify_update_doc_type('INVOICE', true, 'LAST', 25, 12, 24, true, true, 'استعلام اصالت سند');
  perform pg_temp.chk('layout saved (read back through the admin RPC)', (select (t ->> 'x_mm')::numeric = 25 and (t ->> 'y_mm')::numeric = 12 and (t ->> 'size_mm')::numeric = 24
                        from jsonb_array_elements(public.verify_get_settings() -> 'types') t where t ->> 'document_type' = 'INVOICE'));
  perform pg_temp.chk('settings readable by the admin', (public.verify_get_settings() -> 'types') is not null and jsonb_array_length(public.verify_get_settings() -> 'types') = 4);
  perform public.verify_update_settings(false, 'شرکت توسعه مدیریت راهبردی نیل', 'استعلام اصالت سند', false);
  perform pg_temp.expect_err(format('select public.verify_begin(%L,%L,%L)', 'OUTGOING_CORRESPONDENCE', v_cancel_l, pg_temp.h('tok-off')), 'VERIFY_DISABLED');          -- global switch off
  perform public.verify_update_settings(true, 'شرکت توسعه مدیریت راهبردی نیل', 'استعلام اصالت سند', false);
  execute 'reset role';

  -- 9) a cancelled document auto-revokes -------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'ADMIN');
  v_b := public.verify_begin('OUTGOING_CORRESPONDENCE', v_cancel_l, pg_temp.h('tok-c'));
  perform public.verify_activate((v_b ->> 'id')::uuid, pg_temp.h('f-c'), 100, 'verified/' || (v_b ->> 'id') || '.pdf');
  perform public.cancel_correspondence(v_cancel_l);                                    -- the module's own cancel RPCs, as the ADMIN
  execute 'reset role';
  perform pg_temp.chk('letter cancelled -> verification REVOKED (reason DOCUMENT_CANCELLED), page stays',
    (select status = 'REVOKED' and revocation_reason = 'DOCUMENT_CANCELLED' from public.document_verifications where document_id = v_cancel_l)
    and public.verify_public_lookup(pg_temp.h('tok-c')) ->> 'status' = 'REVOKED');
  perform pg_temp.persona(v_admin, 'ADMIN');
  perform public.cancel_contract(v_k2);
  execute 'reset role';
  perform pg_temp.chk('contract cancelled -> REVOKED', (select status from public.document_verifications where document_id = v_k2) = 'REVOKED');
  perform pg_temp.chk('an unrelated status change does not touch verifications', (select status from public.document_verifications where document_id = v_l) = 'ACTIVE');

  -- 10) rate limiter -----------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.chk('allows up to the limit, then refuses',
    public.verify_rate_check('VERIFY_TEST', repeat('ab', 16), 3, 60) and public.verify_rate_check('VERIFY_TEST', repeat('ab', 16), 3, 60) and public.verify_rate_check('VERIFY_TEST', repeat('ab', 16), 3, 60)
    and not public.verify_rate_check('VERIFY_TEST', repeat('ab', 16), 3, 60));
  perform pg_temp.chk('another caller key has its own bucket', public.verify_rate_check('VERIFY_TEST', repeat('cd', 16), 3, 60));
  perform pg_temp.expect_err($q$select public.verify_rate_check('bad scope', 'abababababababab', 3, 60)$q$, 'VERIFY_INVALID');
  perform pg_temp.expect_err($q$select public.verify_rate_check('VERIFY_TEST', 'NOT HEX', 3, 60)$q$, 'VERIFY_INVALID');
  perform pg_temp.expect_err($q$select public.verify_rate_check('VERIFY_TEST', 'abababababababab', 0, 60)$q$, 'VERIFY_INVALID');

  -- 11) audit ------------------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.chk('created / activated / hash registered / revoked / superseded / settings changes are audited',
    (select count(distinct action) from public.activity_logs where entity_type in ('document_verifications', 'verification_settings')
       and action in ('VERIFICATION_CREATED', 'VERIFICATION_ACTIVATED', 'PDF_HASH_REGISTERED', 'VERIFICATION_REVOKED', 'VERIFICATION_SUPERSEDED', 'VERIFY_SETTINGS_CHANGED', 'VERIFY_LAYOUT_CHANGED')) = 7);
  perform pg_temp.chk('audit rows carry no hash / token / path', not exists (select 1 from public.activity_logs where entity_type = 'document_verifications'
    and (new_value::text like '%' || v_hash_l || '%' or new_value::text like '%verified/%')));

  -- 12) Factory Reset integration -----------------------------------------------------------------------------------------------------------------
  perform pg_temp.chk('no UNKNOWN table, no FK blocker', public.system_reset_unknown_tables() = '{}'::text[] and public.system_reset_fk_blockers('OPERATIONAL') = '[]'::jsonb);
  perform pg_temp.chk('verification tables classified: records + limits deleted, configuration preserved',
    public._srs_set('OPERATIONAL') @> array['document_verifications','verification_rate_limits'] and not (public._srs_set('OPERATIONAL') && array['verification_settings','verification_doc_types']));
  insert into storage.objects (bucket_id, name) values ('nil-files', 'verified/' || v_v_l || '.pdf'), ('nil-files', 'verified/orphan-test.pdf');
  perform pg_temp.chk('verified/ files are reset-class DELETE', (select count(*) from public._srs_storage_classify() where path like 'verified/%' and action = 'DELETE') = 2);

  raise notice 'PASS: nil_verify_integrity (rolled back)';
end $$;

rollback;

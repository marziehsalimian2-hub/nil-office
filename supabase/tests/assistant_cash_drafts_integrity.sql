-- =============================================================================
-- NIL Office — Internal Assistant v1.0, Slice 2 (receipt / payment drafts) integrity tests for migration 0135.
-- Run by hand in the Supabase SQL editor AFTER migrations 0133-0135, with at least TWO active profiles, one of them ADMIN.
-- ONE transaction, ROLLED BACK at the end. The script temporarily re-roles the first ADMIN profile (rolled back) —
-- do NOT run it while that admin is actively using the app. Everything it creates is SYNTHETIC (receipt reference
-- 'TRK-T135', storage object 'cash-evidence/receipt/…', attachments) — all rolled back; nothing posts or verifies anything.
-- NOT RUN by Claude — the user runs it. Success = the statement finishes with no error
-- ("Success. No rows returned" in the Supabase editor; the PASS notice is not shown there).
--
-- Covers: (1) evidence visibility (attachments RECEIPT/PAYMENT + storage cash-evidence/%): accounting-only read, CREATE-tier insert,
--         permanent (no delete) — while every other attachment type still behaves as before
--         (2) assistant_cash_duplicates: HARD (same file / same reference+amount+currency), SOFT, exact numeric compare,
--         kind separation, caller + role checks, the internal helper is not callable
-- =============================================================================
begin;

-- App persona (authenticated Postgres role; both JWT claim settings set so auth.role() is deterministic).
create function pg_temp.persona(p_user uuid, p_role text, p_acc text) returns void
language plpgsql as $$
begin
  execute 'reset role';
  update public.profiles set role = p_role::app_role, accounting_role = p_acc::accounting_role where id = p_user;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  execute 'set role authenticated';
end $$;

-- The Telegram path: Postgres role service_role, JWT role claim 'service_role', NO sub.
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
  v_admin uuid; v_other uuid; v_rec uuid; v_att uuid; v_att_case uuid; v_n int; v_j jsonb;
  v_sha text := repeat('a', 64);
  v_path text; v_today date := current_date;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;
  select id into v_other from public.profiles where is_active and id <> v_admin limit 1;
  if v_other is null then raise exception 'need a second active profile'; end if;

  -- 1) fixtures (as superuser): one DRAFT receipt + its evidence attachment + storage object -------------------------------------------------------
  execute 'reset role';
  insert into public.receipts (receipt_date, payer, amount, currency_code, reference, status, created_by)
  values (v_today, 'تست۱۳۵', 100000000, 'IRR', 'TRK-T135', 'DRAFT', v_admin) returning id into v_rec;
  v_path := 'cash-evidence/receipt/' || v_rec || '/1.pdf';
  insert into public.attachments (entity_type, entity_id, file_name, storage_path, mime_type, size_bytes, uploaded_by, sha256)
  values ('RECEIPT', v_rec, 'مدرک.pdf', v_path, 'application/pdf', 100, v_admin, v_sha) returning id into v_att;
  insert into storage.objects (bucket_id, name) values ('nil-files', v_path);

  -- 2) evidence visibility ------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'VIEW');                                    -- any accounting role reads
  select count(*) into v_n from public.attachments where id = v_att;
  if v_n <> 1 then raise exception 'FAIL(2): accounting VIEW must read the evidence attachment (got %)', v_n; end if;
  select count(*) into v_n from storage.objects where bucket_id = 'nil-files' and name = v_path;
  if v_n <> 1 then raise exception 'FAIL(2): accounting VIEW must read the evidence object (got %)', v_n; end if;

  perform pg_temp.persona(v_admin, 'USER', null);                                      -- an active user without accounting access reads nothing
  select count(*) into v_n from public.attachments where entity_type in ('RECEIPT', 'PAYMENT');
  if v_n <> 0 then raise exception 'FAIL(2): non-accounting user read % evidence attachments', v_n; end if;
  select count(*) into v_n from storage.objects where bucket_id = 'nil-files' and name like 'cash-evidence/%';
  if v_n <> 0 then raise exception 'FAIL(2): non-accounting user read % evidence objects', v_n; end if;

  -- other attachment types keep working for everyone (no regression)
  insert into public.attachments (entity_type, entity_id, file_name, storage_path, uploaded_by)
  values ('CASE', gen_random_uuid(), 'x.txt', 'cases/test135/x.txt', v_admin) returning id into v_att_case;
  select count(*) into v_n from public.attachments where id = v_att_case;
  if v_n <> 1 then raise exception 'FAIL(2): a plain user must still read/write ordinary attachments'; end if;

  -- insert: VIEW tier cannot add evidence, CREATE tier can; nobody can delete it
  perform pg_temp.persona(v_admin, 'USER', 'VIEW');
  perform pg_temp.expect_err(format($f$insert into public.attachments (entity_type, entity_id, file_name, storage_path, uploaded_by)
    values ('RECEIPT', %L, 'e.pdf', 'cash-evidence/receipt/%s/2.pdf', %L)$f$, v_rec, v_rec, v_admin), 'row-level security');
  perform pg_temp.expect_err(format($f$insert into storage.objects (bucket_id, name) values ('nil-files', 'cash-evidence/receipt/%s/3.pdf')$f$, v_rec), 'row-level security');
  perform pg_temp.persona(v_admin, 'USER', 'CREATE');
  insert into public.attachments (entity_type, entity_id, file_name, storage_path, uploaded_by, sha256)
  values ('PAYMENT', gen_random_uuid(), 'e.pdf', 'cash-evidence/payment/' || gen_random_uuid() || '/1.pdf', v_admin, repeat('b', 64));
  perform pg_temp.persona(v_admin, 'ADMIN', 'ADMIN');
  delete from public.attachments where id = v_att;                                      -- evidence is permanent: policy leaves 0 rows
  begin delete from storage.objects where bucket_id = 'nil-files' and name = v_path; exception when others then null; end;
  begin update storage.objects set name = name || '.moved' where bucket_id = 'nil-files' and name = v_path; exception when others then null; end;
  execute 'reset role';
  if (select count(*) from public.attachments where id = v_att) <> 1 then raise exception 'FAIL(2): evidence attachment must not be deletable'; end if;
  if (select count(*) from storage.objects where bucket_id = 'nil-files' and name = v_path) <> 1 then raise exception 'FAIL(2): evidence object must be neither deleted nor renamed'; end if;

  -- 3) duplicate lookup as the Telegram session (service_role) ------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'CREATE');                                   -- the profile row the function checks
  perform pg_temp.svc();
  v_j := public.assistant_cash_duplicates(v_admin, 'RECEIPT', '100000000', 'IRR', null, v_today, null, v_sha);
  if jsonb_array_length(v_j -> 'hard') <> 1 or v_j -> 'hard' -> 0 ->> 'reason' <> 'SAME_FILE' or (v_j -> 'hard' -> 0 ->> 'id')::uuid <> v_rec then
    raise exception 'FAIL(3): same evidence file must be a HARD duplicate (%)', v_j;
  end if;
  v_j := public.assistant_cash_duplicates(v_admin, 'PAYMENT', '5', 'USD', null, v_today, null, v_sha);
  if jsonb_array_length(v_j -> 'hard') <> 1 then raise exception 'FAIL(3): the same FILE is a duplicate even as the other kind / another amount (%)', v_j; end if;

  v_j := public.assistant_cash_duplicates(v_admin, 'RECEIPT', '100000000', 'IRR', 'TRK-T135', v_today + 30, null, null);
  if jsonb_array_length(v_j -> 'hard') <> 1 or v_j -> 'hard' -> 0 ->> 'reason' <> 'SAME_REFERENCE' then raise exception 'FAIL(3): same reference+amount+currency (%)', v_j; end if;
  v_j := public.assistant_cash_duplicates(v_admin, 'RECEIPT', '100000000.0000', 'IRR', '  trk-t135 ', v_today, null, null);
  if jsonb_array_length(v_j -> 'hard') <> 1 then raise exception 'FAIL(3): reference match is case/space-insensitive and amounts compare as exact numbers (%)', v_j; end if;
  if (v_j -> 'hard' -> 0 ->> 'amount')::numeric <> 100000000 or jsonb_typeof(v_j -> 'hard' -> 0 -> 'amount') <> 'string' then raise exception 'FAIL(3): amounts leave as text (%)', v_j; end if;
  v_j := public.assistant_cash_duplicates(v_admin, 'RECEIPT', '100000001', 'IRR', 'TRK-T135', v_today, null, null);
  if jsonb_array_length(v_j -> 'hard') <> 0 then raise exception 'FAIL(3): a different amount is not the same reference duplicate (%)', v_j; end if;
  v_j := public.assistant_cash_duplicates(v_admin, 'RECEIPT', '100000000', 'USD', 'TRK-T135', v_today, null, null);
  if jsonb_array_length(v_j -> 'hard') <> 0 then raise exception 'FAIL(3): a different currency is not a duplicate (%)', v_j; end if;
  v_j := public.assistant_cash_duplicates(v_admin, 'PAYMENT', '100000000', 'IRR', 'TRK-T135', v_today, null, null);
  if jsonb_array_length(v_j -> 'hard') <> 0 then raise exception 'FAIL(3): the reference rule is per kind — a payment is not a duplicate of a receipt (%)', v_j; end if;

  v_j := public.assistant_cash_duplicates(v_admin, 'RECEIPT', '100000000', 'IRR', null, v_today, null, null);                     -- same day + amount + currency, no reference
  if jsonb_array_length(v_j -> 'hard') <> 0 or jsonb_array_length(v_j -> 'soft') <> 1 or v_j -> 'soft' -> 0 ->> 'reason' <> 'SAME_DAY_AMOUNT' then raise exception 'FAIL(3): soft same-day match (%)', v_j; end if;
  v_j := public.assistant_cash_duplicates(v_admin, 'RECEIPT', '100000000', 'IRR', null, v_today + 10, null, null);                -- 10 days apart, no company -> nothing
  if jsonb_array_length(v_j -> 'hard') <> 0 or jsonb_array_length(v_j -> 'soft') <> 0 then raise exception 'FAIL(3): unrelated date must not match (%)', v_j; end if;
  if v_j::text ~ 'account_number|iban' then raise exception 'FAIL(3): no bank data in the duplicate report'; end if;

  perform pg_temp.expect_err(format('select public.assistant_cash_duplicates(%L,%L,%L,%L,null,%L,null,null)', v_admin, 'RECEIPT', 'abc', 'IRR', v_today), 'INVALID_AMOUNT');
  perform pg_temp.expect_err(format('select public.assistant_cash_duplicates(%L,%L,%L,%L,null,%L,null,null)', v_admin, 'JOURNAL', '1', 'IRR', v_today), 'INVALID_KIND');
  perform pg_temp.expect_err('select * from public._assistant_cash_docs()', 'permission denied');                                   -- (as service_role: revoked from public, owner-only)

  -- 4) caller + role checks as an app user ------------------------------------------------------------------------------------------------------------------
  perform pg_temp.persona(v_admin, 'USER', 'CREATE');
  v_j := public.assistant_cash_duplicates(v_admin, 'RECEIPT', '100000000', 'IRR', 'TRK-T135', v_today, null, null);                -- own id + CREATE tier: allowed
  if jsonb_array_length(v_j -> 'hard') <> 1 then raise exception 'FAIL(4): an accounting CREATE user may query (%)', v_j; end if;
  perform pg_temp.expect_err(format('select public.assistant_cash_duplicates(%L,%L,%L,%L,null,%L,null,null)', v_other, 'RECEIPT', '1', 'IRR', v_today), 'NOT_AUTHORIZED');   -- cannot pass another profile
  perform pg_temp.persona(v_admin, 'USER', 'VIEW');
  perform pg_temp.expect_err(format('select public.assistant_cash_duplicates(%L,%L,%L,%L,null,%L,null,null)', v_admin, 'RECEIPT', '1', 'IRR', v_today), 'NOT_AUTHORIZED');       -- VIEW tier is not enough
  perform pg_temp.persona(v_admin, 'USER', null);
  perform pg_temp.expect_err(format('select public.assistant_cash_duplicates(%L,%L,%L,%L,null,%L,null,null)', v_admin, 'RECEIPT', '1', 'IRR', v_today), 'NOT_AUTHORIZED');       -- no accounting role at all
  perform pg_temp.expect_err('select * from public._assistant_cash_docs()', 'permission denied');

  execute 'reset role';
  execute 'set constraints all immediate';
  raise notice 'PASS: assistant cash-draft evidence + duplicate-lookup integrity checks';
end $$;

rollback;

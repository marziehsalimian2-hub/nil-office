-- =============================================================================
-- NIL Office — Accounting integrity tests (spec §34)
--
-- Run in the Supabase SQL editor AFTER migrations 0007-0010 and after at least
-- one ADMIN profile exists. The whole script runs in a transaction and ROLLS
-- BACK at the end, so it leaves no data behind.
--
-- It impersonates an ADMIN user (so auth.uid()/RLS/authorization behave like a
-- real session) by setting the JWT sub claim to that admin's id.
--
-- Covered: unbalanced->fail, balanced->post, repeat-post->no new number,
-- posted line edit->fail, closed-year post->fail, drafts excluded from posted
-- view, trial balance reconciles.
-- =============================================================================
begin;

do $$
declare
  v_admin uuid;
  v_fy    uuid;
  v_a     uuid;  -- a posting account (debit side)
  v_b     uuid;  -- a posting account (credit side)
  v_e     uuid;
  v_num   text;
  v_seq_before bigint;
  v_seq_after  bigint;
  v_msg   text;
  v_td    numeric;
  v_tc    numeric;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;

  -- impersonate the admin for auth.uid()/RLS
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('role', 'authenticated', true);

  select id into v_fy from public.fiscal_years where status = 'OPEN' order by start_date desc limit 1;
  if v_fy is null then
    insert into public.fiscal_years (title, start_date, end_date, status)
    values ('تست', current_date, current_date + 300, 'OPEN') returning id into v_fy;
  end if;

  select id into v_a from public.accounts where allows_posting and is_active order by code limit 1;
  select id into v_b from public.accounts where allows_posting and is_active and id <> v_a order by code limit 1;
  if v_a is null or v_b is null then raise exception 'need two posting accounts (run seed 0010)'; end if;

  -- 1) UNBALANCED entry must fail --------------------------------------------
  insert into public.journal_entries (fiscal_year_id, document_date, description, status)
  values (v_fy, current_date, 'تست نامتوازن', 'DRAFT') returning id into v_e;
  insert into public.journal_entry_lines (journal_entry_id, account_id, debit, credit, line_no)
  values (v_e, v_a, 100, 0, 1), (v_e, v_b, 0, 90, 2);   -- 100 <> 90
  begin
    perform public.post_journal_entry(v_e);
    raise exception 'FAIL(1): unbalanced entry was posted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'UNBALANCED' then raise exception 'FAIL(1): expected UNBALANCED, got %', v_msg; end if;
    raise notice 'PASS(1): unbalanced entry rejected';
  end;

  -- 2) BALANCED entry must post and get a number ------------------------------
  select last_value into v_seq_before from public.accounting_sequences where fiscal_year_id = v_fy;
  v_seq_before := coalesce(v_seq_before, 0);
  update public.journal_entry_lines set credit = 100 where journal_entry_id = v_e and account_id = v_b;
  select document_number into v_num from public.post_journal_entry(v_e);
  if v_num is null then raise exception 'FAIL(2): balanced entry did not post'; end if;
  raise notice 'PASS(2): balanced entry posted as %', v_num;

  -- 3) Re-posting must NOT consume another number -----------------------------
  select last_value into v_seq_after from public.accounting_sequences where fiscal_year_id = v_fy;
  begin
    perform public.post_journal_entry(v_e);
    raise exception 'FAIL(3): re-post succeeded';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'ALREADY_POSTED' then raise exception 'FAIL(3): expected ALREADY_POSTED, got %', v_msg; end if;
  end;
  if (select last_value from public.accounting_sequences where fiscal_year_id = v_fy) <> v_seq_after then
    raise exception 'FAIL(3): re-post consumed a number';
  end if;
  raise notice 'PASS(3): re-post rejected, no number consumed';

  -- 4) Editing a POSTED line must fail ---------------------------------------
  begin
    update public.journal_entry_lines set debit = 999 where journal_entry_id = v_e and account_id = v_a;
    raise exception 'FAIL(4): posted line was edited';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'POSTED_ENTRY_IMMUTABLE' then raise exception 'FAIL(4): expected POSTED_ENTRY_IMMUTABLE, got %', v_msg; end if;
    raise notice 'PASS(4): posted line is immutable';
  end;

  -- 5) Deleting a POSTED entry must fail -------------------------------------
  begin
    delete from public.journal_entries where id = v_e;
    raise exception 'FAIL(5): posted entry was deleted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'CANNOT_DELETE_POSTED' then raise exception 'FAIL(5): expected CANNOT_DELETE_POSTED, got %', v_msg; end if;
    raise notice 'PASS(5): posted entry cannot be deleted';
  end;

  -- 6) Trial balance reconciles (posted only) --------------------------------
  select coalesce(sum(total_debit),0), coalesce(sum(total_credit),0)
    into v_td, v_tc from public.v_trial_balance;
  if v_td <> v_tc then raise exception 'FAIL(6): trial balance does not reconcile (% vs %)', v_td, v_tc; end if;
  raise notice 'PASS(6): trial balance reconciles (debit=credit=%)', v_td;

  -- 7) Drafts excluded from posted view --------------------------------------
  insert into public.journal_entries (fiscal_year_id, document_date, description, status)
  values (v_fy, current_date, 'پیش‌نویس تست', 'DRAFT') returning id into v_e;
  insert into public.journal_entry_lines (journal_entry_id, account_id, debit, credit, line_no)
  values (v_e, v_a, 500, 0, 1), (v_e, v_b, 0, 500, 2);
  if exists (select 1 from public.v_posted_lines where journal_entry_id = v_e) then
    raise exception 'FAIL(7): draft appears in posted view';
  end if;
  raise notice 'PASS(7): drafts excluded from official reports';

  -- 8) Posting into a CLOSED fiscal year must fail ---------------------------
  perform set_config('nil.acc_guard', 'off', true);
  update public.fiscal_years set status = 'CLOSED' where id = v_fy;
  begin
    perform public.post_journal_entry(v_e);
    raise exception 'FAIL(8): posted into a closed year';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'FISCAL_YEAR_CLOSED' then raise exception 'FAIL(8): expected FISCAL_YEAR_CLOSED, got %', v_msg; end if;
    raise notice 'PASS(8): closed year blocks posting';
  end;

  raise notice '===== ALL ACCOUNTING INTEGRITY TESTS PASSED =====';
end $$;

rollback;

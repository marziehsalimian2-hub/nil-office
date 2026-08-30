-- =====================================================================
-- NIL Office — 0014_fix_post_journal_entry.sql
--
-- BUG: post_journal_entry declares `returns table (id uuid,
-- document_number text, status posting_status)`. In PL/pgSQL, RETURNS
-- TABLE columns become implicitly-declared OUT variables visible for the
-- whole function body — so every *unqualified* `id` / `status` reference
-- inside a query against `journal_entries` or `fiscal_years` (both of
-- which also have `id` and `status` columns) is ambiguous between the
-- OUT variable and the table column. Postgres rejects this at call time
-- with "column reference \"status\" is ambiguous" (42702), so no journal
-- entry could ever be posted.
--
-- Fix: qualify every such reference with a table alias. Behavior is
-- otherwise identical to the 0008 definition.
-- =====================================================================

create or replace function public.post_journal_entry(p_entry_id uuid)
returns table (id uuid, document_number text, status posting_status)
language plpgsql security definer set search_path = public as $$
declare
  v_status  posting_status;
  v_fy      uuid;
  v_fy_st   fiscal_year_status;
  v_start   date;
  v_year    int;
  v_lines   int;
  v_bad     int;
  v_debit   numeric(20,4);
  v_credit  numeric(20,4);
  v_seq     bigint;
  v_num     text;
begin
  if not public.can_post_accounting() then raise exception 'NOT_AUTHORIZED'; end if;

  select je.status, je.fiscal_year_id into v_status, v_fy
  from public.journal_entries je where je.id = p_entry_id for update;
  if not found            then raise exception 'NOT_FOUND'; end if;
  if v_status = 'POSTED'  then raise exception 'ALREADY_POSTED'; end if;
  if v_status <> 'DRAFT'  then raise exception 'NOT_ELIGIBLE'; end if;

  select fy.status, fy.start_date into v_fy_st, v_start
  from public.fiscal_years fy where fy.id = v_fy;
  if v_fy_st <> 'OPEN' then raise exception 'FISCAL_YEAR_CLOSED'; end if;

  select count(*),
         count(*) filter (where not a.allows_posting or not a.is_active)
    into v_lines, v_bad
  from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
  where l.journal_entry_id = p_entry_id;

  if v_lines < 2 then raise exception 'TOO_FEW_LINES'; end if;
  if v_bad   > 0 then raise exception 'NON_POSTING_ACCOUNT'; end if;

  select coalesce(sum(jel.debit),0), coalesce(sum(jel.credit),0)
    into v_debit, v_credit
  from public.journal_entry_lines jel where jel.journal_entry_id = p_entry_id;

  if v_debit <> v_credit or v_debit = 0 then raise exception 'UNBALANCED'; end if;

  v_year := public.jalali_year(v_start::timestamptz);
  v_seq  := public.allocate_accounting_number(v_fy);
  v_num  := 'ACC-' || v_year || '-' || lpad(v_seq::text, 6, '0');

  update public.journal_entries je
     set document_number = v_num,
         status          = 'POSTED',
         posted_by       = auth.uid(),
         posted_at       = now(),
         updated_at      = now()
   where je.id = p_entry_id;

  perform public.write_log('journal_entry', p_entry_id, 'POST', null,
    jsonb_build_object('document_number', v_num, 'debit', v_debit, 'credit', v_credit));

  return query select p_entry_id, v_num, 'POSTED'::posting_status;
end;
$$;

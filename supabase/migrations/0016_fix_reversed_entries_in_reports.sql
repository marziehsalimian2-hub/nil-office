-- =====================================================================
-- NIL Office — 0016_fix_reversed_entries_in_reports.sql
--
-- BUG: reverse_journal_entry posts a new balancing entry and flips the
-- ORIGINAL entry's status to 'REVERSED' (0008, line ~197). But
-- v_posted_lines and v_trial_balance filter strictly on
-- `status = 'POSTED'`, so the moment an entry is reversed its own lines
-- vanish from every report (ledger, trial balance, P&L, balance sheet) —
-- only the reversal's one-sided lines remain. Instead of netting to
-- zero (the entire point of a reversal), the books show a lingering,
-- unbalanced phantom transaction. Confirmed live: reversing three test
-- entries left the trial balance off by the reversal amounts instead of
-- back at zero.
--
-- Fix: a REVERSED entry genuinely happened and belongs in the official
-- record right alongside the entry that cancels it — that's how the
-- pair nets to zero. Include both statuses.
-- =====================================================================

create or replace view public.v_posted_lines
with (security_invoker = on) as
select
  l.id, l.account_id, l.detail_account_id, l.debit, l.credit,
  l.company_id, l.case_id, e.id as journal_entry_id, e.document_number,
  e.document_date, e.fiscal_year_id, a.code as account_code, a.name as account_name,
  a.account_type, a.nature
from public.journal_entry_lines l
join public.journal_entries e on e.id = l.journal_entry_id
join public.accounts a        on a.id = l.account_id
where e.status in ('POSTED', 'REVERSED');

create or replace view public.v_trial_balance
with (security_invoker = on) as
select
  a.id as account_id, a.code, a.name, a.account_type, a.nature,
  coalesce(sum(l.debit),0)  as total_debit,
  coalesce(sum(l.credit),0) as total_credit,
  coalesce(sum(l.debit),0) - coalesce(sum(l.credit),0) as balance,
  e.fiscal_year_id
from public.accounts a
left join public.journal_entry_lines l on l.account_id = a.id
left join public.journal_entries e on e.id = l.journal_entry_id and e.status in ('POSTED', 'REVERSED')
group by a.id, a.code, a.name, a.account_type, a.nature, e.fiscal_year_id;

grant select on public.v_posted_lines, public.v_trial_balance to authenticated;

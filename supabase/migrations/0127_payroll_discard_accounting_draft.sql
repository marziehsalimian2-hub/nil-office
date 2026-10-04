-- =====================================================================
-- NIL Office — 0127_payroll_discard_accounting_draft.sql
-- HR & Payroll — Phase 4 — discard a payroll-created DRAFT journal entry.
-- Why: the Accounting module has no "delete draft" path (deleting a journal header cascades into
-- journal_entry_lines, and tg_journal_line_guard (0008) then sees no parent and refuses), so a wrong draft
-- would block reopen/cancel of the payroll batch forever. This RPC deletes the lines first, then the header,
-- and only for a DRAFT entry linked to the batch. POSTED/REVERSED entries are never touched (reverse them in Accounting).
-- Needs BOTH payroll-approve and accounting-create (same gate as create_payroll_accounting_draft).
-- =====================================================================
create or replace function public.discard_payroll_accounting_draft(p_batch_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_b public.payroll_batches; v_entry uuid; v_status posting_status;
begin
  if not public.can_approve_payroll() or not public.can_create_accounting() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select * into v_b from public.payroll_batches where id = p_batch_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  v_entry := v_b.accounting_journal_entry_id;
  if v_entry is null then raise exception 'PAYROLL_NO_ACCOUNTING_DRAFT' using errcode = '22000'; end if;
  select status into v_status from public.journal_entries where id = v_entry for update;
  if v_status is distinct from 'DRAFT' then raise exception 'PAYROLL_ACCOUNTING_NOT_DRAFT' using errcode = '22000'; end if;

  update public.payroll_batches
     set accounting_journal_entry_id = null, accounting_drafted_by = null, accounting_drafted_at = null, updated_at = now()
   where id = p_batch_id;
  delete from public.journal_entry_lines where journal_entry_id = v_entry;   -- lines first (tg_journal_line_guard needs the DRAFT parent)
  delete from public.journal_entries where id = v_entry;
  perform public.write_log('payroll_batches', p_batch_id, 'ACCOUNTING_DRAFT_DISCARDED', null, jsonb_build_object('journal_entry_id', v_entry));
end; $$;

revoke execute on function public.discard_payroll_accounting_draft(uuid) from public, anon;
grant execute on function public.discard_payroll_accounting_draft(uuid) to authenticated;

-- =====================================================================
-- ROLLBACK: drop function if exists public.discard_payroll_accounting_draft(uuid);
-- =====================================================================

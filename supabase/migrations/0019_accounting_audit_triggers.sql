-- =====================================================================
-- NIL Office — 0019_accounting_audit_triggers.sql
-- journal_entries, journal_entry_lines, receipts, and payments were
-- never attached to the generic tg_audit() trigger from 0003_functions
-- (only correspondence, cases, documents, followups, attachments, and
-- companies were). Accounting therefore only got audit coverage for
-- the specific lifecycle events the posting RPCs explicitly logged via
-- write_log — any other edit (e.g. editing a DRAFT row's fields before
-- posting) left no trail. tg_audit() is generic (keyed off
-- tg_table_name, assumes a uuid `id` column, which all four tables
-- have), so it applies as-is; write_log and tg_audit are both
-- SECURITY DEFINER, so the trigger's insert into activity_logs bypasses
-- RLS the same way it already does for the tables in 0003.
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array['journal_entries','journal_entry_lines','receipts','payments']
  loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$s;', t);
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$s
       for each row execute function public.tg_audit();', t);
  end loop;
end $$;

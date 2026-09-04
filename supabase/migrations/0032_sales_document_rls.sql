-- =====================================================================
-- NIL Office — 0032_sales_document_rls.sql
-- Invoice/Proforma module — Phase 1 RLS + grants.
--   * no invoice access        -> sales_documents tables are invisible
--   * VIEW/CREATE/APPROVE/ADMIN -> progressive rights; ADMIN role bypasses all
--   * issue/convert/cancel     -> gated in the SECURITY DEFINER RPCs (0031)
-- =====================================================================

-- 4th layering of the self-escalation freeze on profiles (0009 -> 0011 ->
-- 0023_contract_rls.sql -> here), adding invoice_role.
drop policy if exists p_profiles_update_self on public.profiles;
create policy p_profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and role             =              (select role             from public.profiles where id = auth.uid())
    and accounting_role  is not distinct from (select accounting_role from public.profiles where id = auth.uid())
    and contract_role    is not distinct from (select contract_role   from public.profiles where id = auth.uid())
    and invoice_role     is not distinct from (select invoice_role    from public.profiles where id = auth.uid())
    and is_active        =              (select is_active        from public.profiles where id = auth.uid())
  );

alter table public.sales_documents      enable row level security;
alter table public.sales_document_items enable row level security;

do $$
declare t text;
begin
  foreach t in array array['sales_documents','sales_document_items']
  loop
    execute format('drop policy if exists p_%1$s_read   on public.%1$s;', t);
    execute format('drop policy if exists p_%1$s_write  on public.%1$s;', t);
    execute format('drop policy if exists p_%1$s_update on public.%1$s;', t);
    execute format('drop policy if exists p_%1$s_delete on public.%1$s;', t);
    execute format('create policy p_%1$s_read   on public.%1$s for select using (public.has_invoice_access());', t);
    execute format('create policy p_%1$s_write  on public.%1$s for insert with check (public.can_create_invoice());', t);
    execute format('create policy p_%1$s_update on public.%1$s for update using (public.can_create_invoice()) with check (public.can_create_invoice());', t);
    execute format('create policy p_%1$s_delete on public.%1$s for delete using (public.is_invoice_admin());', t);
  end loop;
end $$;

-- Mandatory base grant — Postgres checks object privilege before RLS
-- (the exact gap 0013_table_grants.sql was created to close); skipping
-- this makes every query 42501 regardless of correct RLS.
grant select, insert, update, delete on public.sales_documents, public.sales_document_items to authenticated;

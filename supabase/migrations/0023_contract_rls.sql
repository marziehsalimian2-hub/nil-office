-- =====================================================================
-- NIL Office — 0023_contract_rls.sql
-- Contract Management module — Phase 1 RLS + grants.
--   * no contract access      -> contracts tables are invisible
--   * VIEW/CREATE/APPROVE/ADMIN -> progressive rights; ADMIN role bypasses all
--   * approve/activate/cancel -> gated in the SECURITY DEFINER RPCs (0022)
-- =====================================================================

-- Close the self-escalation gap for the new contract_role column too
-- (mirrors 0009/0011's layering over accounting_role).
drop policy if exists p_profiles_update_self on public.profiles;
create policy p_profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and role             =              (select role             from public.profiles where id = auth.uid())
    and accounting_role  is not distinct from (select accounting_role from public.profiles where id = auth.uid())
    and contract_role    is not distinct from (select contract_role   from public.profiles where id = auth.uid())
    and is_active        =              (select is_active        from public.profiles where id = auth.uid())
  );

alter table public.contracts      enable row level security;
alter table public.contract_types enable row level security;

-- Generic policy generator, same shape as the accounting one.
do $$
declare t text;
begin
  foreach t in array array['contracts']
  loop
    execute format('drop policy if exists p_%1$s_read   on public.%1$s;', t);
    execute format('drop policy if exists p_%1$s_write  on public.%1$s;', t);
    execute format('drop policy if exists p_%1$s_update on public.%1$s;', t);
    execute format('drop policy if exists p_%1$s_delete on public.%1$s;', t);
    execute format('create policy p_%1$s_read   on public.%1$s for select using (public.has_contract_access());', t);
    execute format('create policy p_%1$s_write  on public.%1$s for insert with check (public.can_create_contract());', t);
    execute format('create policy p_%1$s_update on public.%1$s for update using (public.can_create_contract()) with check (public.can_create_contract());', t);
    execute format('create policy p_%1$s_delete on public.%1$s for delete using (public.is_contract_admin());', t);
  end loop;
end $$;

-- contract_types: anyone with contract access reads; only contract admins write.
drop policy if exists p_contract_types_read  on public.contract_types;
drop policy if exists p_contract_types_write on public.contract_types;
create policy p_contract_types_read  on public.contract_types
  for select using (public.has_contract_access());
create policy p_contract_types_write on public.contract_types
  for all using (public.is_contract_admin()) with check (public.is_contract_admin());

-- Mandatory base grant — Postgres checks object privilege before RLS
-- (the exact gap 0013_table_grants.sql was created to close); skipping
-- this makes every query 42501 regardless of correct RLS.
grant select, insert, update, delete on public.contracts, public.contract_types to authenticated;

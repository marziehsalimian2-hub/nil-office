-- =====================================================================
-- NIL Office — 0022_contract_rls.sql
--
-- Contract Management, Phase 1: RLS for contracts/contract_types, and
-- extending the self-escalation guard (0009 -> 0011) to also pin
-- contract_role so a user can't grant themselves contract powers by
-- editing their own profile.
-- =====================================================================

drop policy if exists p_profiles_update_self on public.profiles;
create policy p_profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and role            =                  (select role            from public.profiles where id = auth.uid())
    and accounting_role is not distinct from (select accounting_role from public.profiles where id = auth.uid())
    and contract_role   is not distinct from (select contract_role   from public.profiles where id = auth.uid())
    and is_active       =                  (select is_active       from public.profiles where id = auth.uid())
  );

alter table public.contracts      enable row level security;
alter table public.contract_types enable row level security;

drop policy if exists p_contract_types_read on public.contract_types;
create policy p_contract_types_read on public.contract_types
  for select using (public.can_view_contracts());
drop policy if exists p_contract_types_admin on public.contract_types;
create policy p_contract_types_admin on public.contract_types
  for all using (public.is_contract_admin()) with check (public.is_contract_admin());

drop policy if exists p_contracts_read on public.contracts;
create policy p_contracts_read on public.contracts
  for select using (public.can_view_contracts());
drop policy if exists p_contracts_write on public.contracts;
create policy p_contracts_write on public.contracts
  for insert with check (public.can_create_contracts() and created_by = auth.uid());
drop policy if exists p_contracts_update on public.contracts;
create policy p_contracts_update on public.contracts
  for update using (public.can_edit_contracts()) with check (public.can_edit_contracts());
-- Only a never-numbered, non-historical DRAFT may be hard-deleted, by its
-- creator or a contract admin (mirrors p_corr_delete exactly).
drop policy if exists p_contracts_delete on public.contracts;
create policy p_contracts_delete on public.contracts
  for delete using (
    public.is_contract_admin()
    or (created_by = auth.uid() and status = 'DRAFT' and sequence_number is null and not is_historical)
  );

grant execute on function public.approve_contract(uuid, int)    to authenticated;
grant execute on function public.activate_contract(uuid)        to authenticated;
grant execute on function public.suspend_contract(uuid)         to authenticated;
grant execute on function public.resume_contract(uuid)          to authenticated;
grant execute on function public.complete_contract(uuid)        to authenticated;
grant execute on function public.terminate_contract(uuid, text) to authenticated;
grant execute on function public.cancel_contract(uuid, text)    to authenticated;
grant execute on function public.can_view_contracts()           to authenticated;
grant execute on function public.can_create_contracts()         to authenticated;
grant execute on function public.can_edit_contracts()           to authenticated;
grant execute on function public.can_approve_contracts()        to authenticated;
grant execute on function public.is_contract_admin()            to authenticated;

grant select, insert, update, delete on public.contracts, public.contract_types to authenticated;

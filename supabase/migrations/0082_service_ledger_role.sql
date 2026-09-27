-- =====================================================================
-- NIL Office — 0082_service_ledger_role.sql
-- Client Service Ledger — Phase 1 — permission tier. Identical 4-tier
-- shape to trade_role/crm_role/project_role/invoice_role/contract_role/
-- cheque_role (this codebase has zero exceptions to the "one enum
-- column per domain, checked by SECURITY DEFINER helpers" convention).
-- =====================================================================

do $$ begin
  create type service_ledger_role as enum ('VIEW','CREATE','APPROVE','ADMIN');
exception when duplicate_object then null; end $$;

alter table public.profiles add column if not exists service_ledger_role service_ledger_role;

create or replace function public.has_service_ledger_access()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or service_ledger_role is not null)
  );
$$;

create or replace function public.can_create_service_entry()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or service_ledger_role in ('CREATE','APPROVE','ADMIN'))
  );
$$;

create or replace function public.can_approve_service_entry()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or service_ledger_role in ('APPROVE','ADMIN'))
  );
$$;

create or replace function public.is_service_ledger_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or service_ledger_role = 'ADMIN')
  );
$$;

-- Confidential internal-cost visibility: ADMIN tier of this role (the
-- "or it's your own logged time entry" half of the rule lives in the
-- RLS policy itself, 0086, since this function has no row context).
create or replace function public.can_view_internal_cost()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or service_ledger_role = 'ADMIN')
  );
$$;

-- 10th layering of the self-escalation freeze on profiles (0009 -> 0011 ->
-- 0023 -> 0032 -> 0044 -> 0053 -> 0054 -> 0066 -> 0073 -> here), adding
-- service_ledger_role.
drop policy if exists p_profiles_update_self on public.profiles;
create policy p_profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and role                 =              (select role                 from public.profiles where id = auth.uid())
    and accounting_role      is not distinct from (select accounting_role      from public.profiles where id = auth.uid())
    and contract_role        is not distinct from (select contract_role        from public.profiles where id = auth.uid())
    and invoice_role         is not distinct from (select invoice_role         from public.profiles where id = auth.uid())
    and crm_role             is not distinct from (select crm_role             from public.profiles where id = auth.uid())
    and project_role         is not distinct from (select project_role         from public.profiles where id = auth.uid())
    and trade_role           is not distinct from (select trade_role           from public.profiles where id = auth.uid())
    and cheque_role          is not distinct from (select cheque_role          from public.profiles where id = auth.uid())
    and service_ledger_role  is not distinct from (select service_ledger_role  from public.profiles where id = auth.uid())
    and is_active            =              (select is_active            from public.profiles where id = auth.uid())
  );

grant execute on function public.has_service_ledger_access()  to authenticated;
grant execute on function public.can_create_service_entry()   to authenticated;
grant execute on function public.can_approve_service_entry()  to authenticated;
grant execute on function public.is_service_ledger_admin()    to authenticated;
grant execute on function public.can_view_internal_cost()     to authenticated;

-- =====================================================================
-- ROLLBACK
-- ---------------------------------------------------------------------
-- drop function if exists public.can_view_internal_cost();
-- drop function if exists public.is_service_ledger_admin();
-- drop function if exists public.can_approve_service_entry();
-- drop function if exists public.can_create_service_entry();
-- drop function if exists public.has_service_ledger_access();
-- alter table public.profiles drop column if exists service_ledger_role;
-- drop type if exists service_ledger_role;
-- -- Re-run 0073_cheque_role.sql's p_profiles_update_self definition to
-- -- drop the service_ledger_role clause from the self-escalation freeze.
-- =====================================================================

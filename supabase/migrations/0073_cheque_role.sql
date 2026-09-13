-- =====================================================================
-- NIL Office — 0073_cheque_role.sql
-- Cheque Management & Printing v1 — permission tier. Identical 4-tier
-- shape to trade_role/crm_role/project_role/invoice_role/contract_role
-- (0066_trade_portal.sql:36-97) — this codebase has zero exceptions to
-- the "one enum column per domain, checked by SECURITY DEFINER helpers"
-- convention, so Cheques follows it rather than the spec's literal 8
-- named permissions (CHEQUE_VIEW/CREATE/PRINT/ISSUE/... — reconciled in
-- lib/assistant/actions/cheque.ts and the RPCs in 0077, not as separate
-- DB grants).
-- =====================================================================

do $$ begin
  create type cheque_role as enum ('VIEW','CREATE','APPROVE','ADMIN');
exception when duplicate_object then null; end $$;

alter table public.profiles add column if not exists cheque_role cheque_role;

create or replace function public.has_cheque_access()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or cheque_role is not null)
  );
$$;

create or replace function public.can_create_cheque()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or cheque_role in ('CREATE','APPROVE','ADMIN'))
  );
$$;

create or replace function public.can_approve_cheque()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or cheque_role in ('APPROVE','ADMIN'))
  );
$$;

create or replace function public.is_cheque_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or cheque_role = 'ADMIN')
  );
$$;

-- 9th layering of the self-escalation freeze on profiles (0009 -> 0011 ->
-- 0023 -> 0032 -> 0044 -> 0053 -> 0066 -> here), adding cheque_role.
drop policy if exists p_profiles_update_self on public.profiles;
create policy p_profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and role             =              (select role             from public.profiles where id = auth.uid())
    and accounting_role  is not distinct from (select accounting_role from public.profiles where id = auth.uid())
    and contract_role    is not distinct from (select contract_role   from public.profiles where id = auth.uid())
    and invoice_role     is not distinct from (select invoice_role    from public.profiles where id = auth.uid())
    and crm_role         is not distinct from (select crm_role        from public.profiles where id = auth.uid())
    and project_role     is not distinct from (select project_role    from public.profiles where id = auth.uid())
    and trade_role       is not distinct from (select trade_role      from public.profiles where id = auth.uid())
    and cheque_role      is not distinct from (select cheque_role     from public.profiles where id = auth.uid())
    and is_active        =              (select is_active        from public.profiles where id = auth.uid())
  );

grant execute on function public.has_cheque_access()  to authenticated;
grant execute on function public.can_create_cheque()  to authenticated;
grant execute on function public.can_approve_cheque() to authenticated;
grant execute on function public.is_cheque_admin()    to authenticated;

-- =====================================================================
-- ROLLBACK
-- ---------------------------------------------------------------------
-- drop function if exists public.is_cheque_admin();
-- drop function if exists public.can_approve_cheque();
-- drop function if exists public.can_create_cheque();
-- drop function if exists public.has_cheque_access();
-- alter table public.profiles drop column if exists cheque_role;
-- drop type if exists cheque_role;
-- -- Re-run 0066_trade_portal.sql's p_profiles_update_self definition to
-- -- drop the cheque_role clause from the self-escalation freeze.
-- =====================================================================

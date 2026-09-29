-- =====================================================================
-- NIL Office — 0097_external_correspondence_role.sql
-- External Correspondence Telegram Bot — Phase 1 — permission tier.
-- Identical 4-tier shape to trade_role/service_ledger_role/cheque_role
-- (this codebase has zero exceptions to the "one enum column per
-- domain, checked by SECURITY DEFINER helpers" convention). Spec §70
-- lists 7 named permissions (VIEW/REVIEW/REGISTER/REJECT/ASSIGN/REPLY/
-- ADMIN) — collapsed onto this codebase's established 4-tier shape:
-- VIEW = read the External Inbox; CREATE = VIEW + non-irreversible
-- review actions (Request Info, Assign, link Company/Case, Follow-up);
-- APPROVE = CREATE + Register/Reject (consumes the official number or
-- closes out a submission — Reply joins this tier in a later phase);
-- ADMIN = full control. Matches how APPROVE is already used identically
-- for trade_role's offer-approval and service_ledger_role's billing-
-- approval tiers.
-- =====================================================================

do $$ begin
  create type external_correspondence_role as enum ('VIEW','CREATE','APPROVE','ADMIN');
exception when duplicate_object then null; end $$;

alter table public.profiles add column if not exists external_correspondence_role external_correspondence_role;

create or replace function public.has_external_correspondence_access()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or external_correspondence_role is not null)
  );
$$;

create or replace function public.can_review_external_correspondence()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or external_correspondence_role in ('CREATE','APPROVE','ADMIN'))
  );
$$;

create or replace function public.can_approve_external_correspondence()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or external_correspondence_role in ('APPROVE','ADMIN'))
  );
$$;

create or replace function public.is_external_correspondence_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or external_correspondence_role = 'ADMIN')
  );
$$;

-- 11th layering of the self-escalation freeze on profiles (0009 -> 0011 ->
-- 0023 -> 0032 -> 0044 -> 0053 -> 0054 -> 0066 -> 0073 -> 0082 -> here),
-- adding external_correspondence_role.
drop policy if exists p_profiles_update_self on public.profiles;
create policy p_profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and role                          =              (select role                          from public.profiles where id = auth.uid())
    and accounting_role               is not distinct from (select accounting_role               from public.profiles where id = auth.uid())
    and contract_role                 is not distinct from (select contract_role                 from public.profiles where id = auth.uid())
    and invoice_role                  is not distinct from (select invoice_role                  from public.profiles where id = auth.uid())
    and crm_role                      is not distinct from (select crm_role                      from public.profiles where id = auth.uid())
    and project_role                  is not distinct from (select project_role                  from public.profiles where id = auth.uid())
    and trade_role                    is not distinct from (select trade_role                    from public.profiles where id = auth.uid())
    and cheque_role                   is not distinct from (select cheque_role                   from public.profiles where id = auth.uid())
    and service_ledger_role           is not distinct from (select service_ledger_role           from public.profiles where id = auth.uid())
    and external_correspondence_role  is not distinct from (select external_correspondence_role  from public.profiles where id = auth.uid())
    and is_active                     =              (select is_active                     from public.profiles where id = auth.uid())
  );

grant execute on function public.has_external_correspondence_access()     to authenticated;
grant execute on function public.can_review_external_correspondence()     to authenticated;
grant execute on function public.can_approve_external_correspondence()    to authenticated;
grant execute on function public.is_external_correspondence_admin()       to authenticated;

-- =====================================================================
-- ROLLBACK
-- ---------------------------------------------------------------------
-- drop function if exists public.is_external_correspondence_admin();
-- drop function if exists public.can_approve_external_correspondence();
-- drop function if exists public.can_review_external_correspondence();
-- drop function if exists public.has_external_correspondence_access();
-- alter table public.profiles drop column if exists external_correspondence_role;
-- drop type if exists external_correspondence_role;
-- -- Re-run 0082_service_ledger_role.sql's p_profiles_update_self definition to
-- -- drop the external_correspondence_role clause from the self-escalation freeze.
-- =====================================================================

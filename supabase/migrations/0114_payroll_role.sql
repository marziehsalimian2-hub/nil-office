-- =====================================================================
-- NIL Office — 0114_payroll_role.sql
-- HR & Payroll — Phase 2 (configuration layer) — permission tier.
-- Same 4-tier shape as every domain role. Deliberately SEPARATE from
-- hr_role (spec §67/§59): an HR user must not see salary data.
--   VIEW    read salary components, compensation, legal rule sets (NOT bank details)
--   CREATE  VIEW + create components / compensation versions / DRAFT rule sets + entries
--   APPROVE CREATE + review/approve rule sets (and retire non-approved ones)
--   ADMIN   APPROVE + bank/payment-destination access + retire an APPROVED rule set
-- Global profiles.role='ADMIN' passes every helper.
-- 13th layering of the self-escalation freeze (... -> 0097 -> 0107 -> here);
-- body re-stated from 0107 (verified latest) + payroll_role.
-- =====================================================================
do $$ begin
  create type payroll_role as enum ('VIEW','CREATE','APPROVE','ADMIN');
exception when duplicate_object then null; end $$;

alter table public.profiles add column if not exists payroll_role payroll_role;

create or replace function public.has_payroll_access()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
    where id = auth.uid() and is_active and (role = 'ADMIN' or payroll_role is not null));
$$;
create or replace function public.can_create_payroll()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
    where id = auth.uid() and is_active and (role = 'ADMIN' or payroll_role in ('CREATE','APPROVE','ADMIN')));
$$;
create or replace function public.can_approve_payroll()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
    where id = auth.uid() and is_active and (role = 'ADMIN' or payroll_role in ('APPROVE','ADMIN')));
$$;
create or replace function public.is_payroll_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
    where id = auth.uid() and is_active and (role = 'ADMIN' or payroll_role = 'ADMIN'));
$$;
-- Own function (not an inline is_payroll_admin call) so it can diverge later — precedent: can_view_hr_sensitive (0107).
create or replace function public.can_view_payroll_bank_details()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
    where id = auth.uid() and is_active and (role = 'ADMIN' or payroll_role = 'ADMIN'));
$$;

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
    and hr_role                       is not distinct from (select hr_role                       from public.profiles where id = auth.uid())
    and payroll_role                  is not distinct from (select payroll_role                  from public.profiles where id = auth.uid())
    and is_active                     =              (select is_active                     from public.profiles where id = auth.uid())
  );

grant execute on function public.has_payroll_access()             to authenticated;
grant execute on function public.can_create_payroll()             to authenticated;
grant execute on function public.can_approve_payroll()            to authenticated;
grant execute on function public.is_payroll_admin()               to authenticated;
grant execute on function public.can_view_payroll_bank_details()  to authenticated;

-- =====================================================================
-- ROLLBACK
-- drop function if exists public.can_view_payroll_bank_details();
-- drop function if exists public.is_payroll_admin();
-- drop function if exists public.can_approve_payroll();
-- drop function if exists public.can_create_payroll();
-- drop function if exists public.has_payroll_access();
-- alter table public.profiles drop column if exists payroll_role;
-- drop type if exists payroll_role;
-- -- Re-run 0107_hr_role.sql's p_profiles_update_self to drop the payroll_role clause.
-- =====================================================================

-- =====================================================================
-- NIL Office — 0107_hr_role.sql
-- Human Resources & Payroll — Phase 1 (Personnel + Employment only) —
-- permission tier. Identical 4-tier shape to every other domain role
-- (this codebase has zero exceptions to the "one enum column per
-- domain, checked by SECURITY DEFINER helpers" convention). Spec §67
-- lists 6 named permissions (HR_PERSONNEL_VIEW / HR_PERSONNEL_CREATE /
-- HR_PERSONNEL_EDIT / HR_PERSONNEL_SENSITIVE_VIEW / HR_DOCUMENT_VIEW /
-- HR_DOCUMENT_MANAGE) — collapsed onto this codebase's established
-- 4-tier shape:
--   VIEW    = HR_PERSONNEL_VIEW + HR_DOCUMENT_VIEW (read the personnel
--             registry and its documents; NOT the sensitive fields —
--             see can_view_hr_sensitive() below).
--   CREATE  = VIEW + HR_PERSONNEL_CREATE + HR_PERSONNEL_EDIT (non-status
--             changes) + HR_DOCUMENT_MANAGE (upload/delete HR docs) +
--             ordinary employment-record changes (job title, manager,
--             department, hours) + non-terminal status transitions
--             (ACTIVE <-> ON_LEAVE/SUSPENDED).
--   APPROVE = CREATE + higher-stakes approvals. Phase 1 has no separate
--             approve workflow beyond status transitions (split
--             CREATE-tier vs ADMIN-tier below) — kept only for
--             enum-shape consistency with every other domain; a later
--             phase (e.g. payroll batch approval) can adopt it without
--             a schema change.
--   ADMIN   = full control + HR_PERSONNEL_SENSITIVE_VIEW (national_id /
--             passport_number / birth_date / emergency_contact — see
--             personnel_sensitive_details, 0110) + TERMINATED/ARCHIVED
--             status transitions + rehire (TERMINATED -> ACTIVE) +
--             hr_role assignment (via profiles ADMIN, same as every
--             other domain).
--
-- SENSITIVE_VIEW is deliberately mapped to ADMIN-tier only, not
-- APPROVE-or-above: national_id/passport_number are government identity
-- numbers, at least as sensitive as the internal cost-rate data this
-- codebase already reserves for ADMIN-tier service_ledger_role via
-- can_view_internal_cost() (0082/0086) — an ordinary CREATE/APPROVE-tier
-- HR user does not need routine visibility into identity-document
-- numbers to log a job-title change or approve a leave request.
-- =====================================================================

do $$ begin
  create type hr_role as enum ('VIEW','CREATE','APPROVE','ADMIN');
exception when duplicate_object then null; end $$;

alter table public.profiles add column if not exists hr_role hr_role;

create or replace function public.has_hr_access()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or hr_role is not null)
  );
$$;

create or replace function public.can_create_hr()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or hr_role in ('CREATE','APPROVE','ADMIN'))
  );
$$;

create or replace function public.can_approve_hr()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or hr_role in ('APPROVE','ADMIN'))
  );
$$;

create or replace function public.is_hr_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or hr_role = 'ADMIN')
  );
$$;

-- Confidential PII visibility (national_id/passport_number/birth_date/
-- emergency_contact, see personnel_sensitive_details, 0110) — ADMIN
-- tier of hr_role, kept as its own function (not just calling
-- is_hr_admin() inline at every call site) so a future phase can
-- diverge the two without touching every caller — same precedent as
-- can_view_internal_cost() (0082_service_ledger_role.sql), which is
-- identical to is_service_ledger_admin() today for the same reason.
create or replace function public.can_view_hr_sensitive()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or hr_role = 'ADMIN')
  );
$$;

-- 12th layering of the self-escalation freeze on profiles (0009 -> 0011
-- -> 0023 -> 0032 -> 0044 -> 0053 -> 0054 -> 0066 -> 0073 -> 0082 ->
-- 0097 -> here), adding hr_role. Full body re-stated from 0097's exact
-- current version, confirmed by reading it directly.
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
    and is_active                     =              (select is_active                     from public.profiles where id = auth.uid())
  );

grant execute on function public.has_hr_access()        to authenticated;
grant execute on function public.can_create_hr()         to authenticated;
grant execute on function public.can_approve_hr()        to authenticated;
grant execute on function public.is_hr_admin()           to authenticated;
grant execute on function public.can_view_hr_sensitive() to authenticated;

-- =====================================================================
-- ROLLBACK
-- ---------------------------------------------------------------------
-- drop function if exists public.can_view_hr_sensitive();
-- drop function if exists public.is_hr_admin();
-- drop function if exists public.can_approve_hr();
-- drop function if exists public.can_create_hr();
-- drop function if exists public.has_hr_access();
-- alter table public.profiles drop column if exists hr_role;
-- drop type if exists hr_role;
-- -- Re-run 0097_external_correspondence_role.sql's p_profiles_update_self
-- -- definition to drop the hr_role clause from the self-escalation freeze.
-- =====================================================================

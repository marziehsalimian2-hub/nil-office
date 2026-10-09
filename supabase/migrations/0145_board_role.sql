-- =====================================================================
-- NIL Office — 0145_board_role.sql
-- Board Secretariat — Phase 1 — permission tier. Same 4-tier shape as every domain role. Deliberately SEPARATE from every other role:
-- board minutes are confidential — an HR, accounting or contracts user must not see them.
--   VIEW    read meetings, minutes, resolutions, members
--   CREATE  VIEW + prepare DRAFT meetings (agenda, attendance, discussion, resolutions) + manage the member list
--   APPROVE CREATE + final approval of the minutes (locks them, issues the meeting number, frozen PDF + NIL Verify)
--   ADMIN   APPROVE + board settings (numbering baseline) + delete members
-- Global profiles.role='ADMIN' passes every helper.
-- 14th layering of the self-escalation freeze (... -> 0107 -> 0114 -> here); body re-stated from 0114 (verified latest by grep) + board_role.
-- =====================================================================
do $$ begin
  create type board_role as enum ('VIEW','CREATE','APPROVE','ADMIN');
exception when duplicate_object then null; end $$;

alter table public.profiles add column if not exists board_role board_role;

create or replace function public.has_board_access()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
    where id = auth.uid() and is_active and (role = 'ADMIN' or board_role is not null));
$$;
create or replace function public.can_create_board()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
    where id = auth.uid() and is_active and (role = 'ADMIN' or board_role in ('CREATE','APPROVE','ADMIN')));
$$;
create or replace function public.can_approve_board()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
    where id = auth.uid() and is_active and (role = 'ADMIN' or board_role in ('APPROVE','ADMIN')));
$$;
create or replace function public.is_board_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
    where id = auth.uid() and is_active and (role = 'ADMIN' or board_role = 'ADMIN'));
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
    and board_role                    is not distinct from (select board_role                    from public.profiles where id = auth.uid())
    and is_active                     =              (select is_active                     from public.profiles where id = auth.uid())
  );

grant execute on function public.has_board_access()  to authenticated, service_role;
grant execute on function public.can_create_board()  to authenticated, service_role;
grant execute on function public.can_approve_board() to authenticated, service_role;
grant execute on function public.is_board_admin()    to authenticated, service_role;

-- =====================================================================
-- ROLLBACK
-- drop function if exists public.is_board_admin();
-- drop function if exists public.can_approve_board();
-- drop function if exists public.can_create_board();
-- drop function if exists public.has_board_access();
-- alter table public.profiles drop column if exists board_role;
-- drop type if exists board_role;
-- -- Re-run 0114_payroll_role.sql's p_profiles_update_self to drop the board_role clause.
-- =====================================================================

-- =====================================================================
-- NIL Office — 0134_assistant_payslip_company.sql
-- Internal Assistant v1.0 — Slice 1, part 3: «فیش حقوقی خودم» + «مانده حساب شرکت» over Telegram.
--
-- Over Telegram every query runs as service_role (auth.uid() is NULL, RLS bypassed — see
-- lib/assistant/telegram/session.ts), and the HR/payroll migrations deliberately omit service_role
-- grants. So the assistant gets NARROW, owner-checked SECURITY DEFINER functions instead of table access:
--
--   assistant_my_payslips(profile)            the caller's OWN payslips only (list, net as text)
--   assistant_payslip_file(profile, payslip)  storage path of ONE payslip, only if it belongs to that profile
--   assistant_record_payslip_access(...)      audit row for a delivery (no amounts)
--   assistant_company_balance(profile, co)    per-currency received/paid/outstanding as exact TEXT
--
-- Every function: (a) the caller must be service_role OR the profile itself (a web user can never pass
-- someone else's id), (b) the profile must be active, (c) the personnel record is resolved ONLY through
-- personnel.profile_id — there is no parameter that names a person. Nobody can ask for another employee's
-- payslip through these functions. No amount is ever written to the audit log.
--
-- has_contract_access() gets the 0081 service_role branch so the existing get_company_financial_summary()
-- (0105) works for the Telegram session; the assistant action's own requiredAccess (ADMIN or an
-- accounting/invoice/contract role) remains the real gate, and assistant_company_balance re-checks it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) has_contract_access(): + service_role branch (0081 precedent). Restated from its CURRENT body (0022).
-- ---------------------------------------------------------------------
create or replace function public.has_contract_access()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.role() = 'service_role' or exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or contract_role is not null)
  );
$$;

grant execute on function public.get_company_financial_summary(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 1) internal helper: caller check + personnel resolution (never granted to end users)
-- ---------------------------------------------------------------------
create or replace function public._assistant_personnel_for(p_profile_id uuid)
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_pid uuid;
begin
  if not (auth.role() = 'service_role' or (p_profile_id is not null and p_profile_id = auth.uid())) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and is_active) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select id into v_pid from public.personnel where profile_id = p_profile_id;
  return v_pid;   -- null = this profile is not linked to a personnel record
end; $$;

-- ---------------------------------------------------------------------
-- 2) the caller's own payslips (same eligibility rule as my_payslips(), 0130: APPROVED batch + its approved calculation)
-- ---------------------------------------------------------------------
create or replace function public.assistant_my_payslips(p_profile_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_pid uuid := public._assistant_personnel_for(p_profile_id);
begin
  if v_pid is null then return jsonb_build_object('linked', false, 'items', '[]'::jsonb); end if;
  return jsonb_build_object('linked', true, 'items', coalesce((
    select jsonb_agg(x.item order by x.y desc, x.m desc, x.rev desc)
      from (
        select per.jalali_year as y, per.jalali_month as m, s.revision as rev,
               jsonb_build_object(
                 'id', s.id, 'revision', s.revision, 'payment_state', s.payment_state_at_issue, 'issued_at', s.issued_at,
                 'jalali_year', per.jalali_year, 'jalali_month', per.jalali_month, 'currency', b.currency, 'net', r.net::text,
                 'is_latest', s.revision = (select max(s2.revision) from public.payroll_payslips s2 where s2.result_id = s.result_id)) as item
          from public.payroll_payslips s
          join public.payroll_results r on r.id = s.result_id
          join public.payroll_batches b on b.id = s.batch_id and b.status = 'APPROVED' and b.approved_calculation_id = r.calculation_id
          join public.payroll_periods per on per.id = b.period_id
         where s.personnel_id = v_pid
         order by per.jalali_year desc, per.jalali_month desc, s.revision desc
         limit 24) x), '[]'::jsonb));
end; $$;

-- ---------------------------------------------------------------------
-- 3) storage path of ONE payslip — only if it is the profile's own. "Not yours" and "does not exist" are
--    the same error (no existence oracle).
-- ---------------------------------------------------------------------
create or replace function public.assistant_payslip_file(p_profile_id uuid, p_payslip_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_pid uuid := public._assistant_personnel_for(p_profile_id); v_row record;
begin
  if v_pid is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select s.storage_path, s.file_name, s.revision, s.payment_state_at_issue
    into v_row
    from public.payroll_payslips s
    join public.payroll_results r on r.id = s.result_id
    join public.payroll_batches b on b.id = s.batch_id and b.status = 'APPROVED' and b.approved_calculation_id = r.calculation_id
   where s.id = p_payslip_id and s.personnel_id = v_pid;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object('storage_path', v_row.storage_path, 'file_name', v_row.file_name,
                            'revision', v_row.revision, 'payment_state', v_row.payment_state_at_issue);
end; $$;

-- ---------------------------------------------------------------------
-- 4) audit one delivery (attributed to the profile explicitly; no amounts)
-- ---------------------------------------------------------------------
create or replace function public.assistant_record_payslip_access(p_profile_id uuid, p_payslip_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_pid uuid := public._assistant_personnel_for(p_profile_id);
begin
  if v_pid is null or not exists (select 1 from public.payroll_payslips where id = p_payslip_id and personnel_id = v_pid) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into public.activity_logs (user_id, entity_type, entity_id, action, new_value)
  values (p_profile_id, 'payroll_payslips', p_payslip_id, 'ACCESSED', jsonb_build_object('by', 'OWNER', 'channel', 'TELEGRAM'));
end; $$;

-- ---------------------------------------------------------------------
-- 5) company balance — per-currency, exact text, never summed across currencies
-- ---------------------------------------------------------------------
create or replace function public.assistant_company_balance(p_profile_id uuid, p_company_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_company record; v_rows jsonb;
begin
  if not (auth.role() = 'service_role' or (p_profile_id is not null and p_profile_id = auth.uid())) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not exists (
       select 1 from public.profiles
        where id = p_profile_id and is_active
          and (role = 'ADMIN' or accounting_role is not null or invoice_role is not null or contract_role is not null)) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  -- a web caller is additionally bound by the same bridge the company page uses
  if not (auth.role() = 'service_role' or public.has_contract_access()) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select id, legal_name into v_company from public.companies where id = p_company_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'currency', f.currency_code,
           'received', f.received_amount::text,
           'paid', f.paid_amount::text,
           'outstanding_invoices', f.outstanding_invoices_amount::text) order by f.currency_code), '[]'::jsonb)
    into v_rows
    from public.get_company_financial_summary(p_company_id) f;

  return jsonb_build_object('company', jsonb_build_object('id', v_company.id, 'name', v_company.legal_name), 'currencies', v_rows);
end; $$;

-- ---------------------------------------------------------------------
-- Grants (service_role explicit — 0072/0096 gotcha; the helper is internal and granted to nobody)
-- ---------------------------------------------------------------------
revoke all on function public._assistant_personnel_for(uuid) from public;
revoke all on function public.assistant_my_payslips(uuid) from public;
revoke all on function public.assistant_payslip_file(uuid, uuid) from public;
revoke all on function public.assistant_record_payslip_access(uuid, uuid) from public;
revoke all on function public.assistant_company_balance(uuid, uuid) from public;
grant execute on function public.assistant_my_payslips(uuid) to authenticated, service_role;
grant execute on function public.assistant_payslip_file(uuid, uuid) to authenticated, service_role;
grant execute on function public.assistant_record_payslip_access(uuid, uuid) to authenticated, service_role;
grant execute on function public.assistant_company_balance(uuid, uuid) to authenticated, service_role;

-- =====================================================================
-- ROLLBACK: drop function if exists public.assistant_company_balance(uuid,uuid), public.assistant_record_payslip_access(uuid,uuid),
--   public.assistant_payslip_file(uuid,uuid), public.assistant_my_payslips(uuid), public._assistant_personnel_for(uuid);
--   re-run 0022's has_contract_access() to drop the service_role branch.
-- =====================================================================

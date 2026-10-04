-- =====================================================================
-- NIL Office — 0130_payroll_payslips.sql
-- HR & Payroll — Phase 6 — payslips: immutable archive of issued PDFs + employee self-service reads.
--  * payroll_payslips: append-only (frozen + no-delete), unique (result_id, revision). No amounts in columns.
--  * Issuance is manual (payroll APPROVE tier) and only for an APPROVED batch's complete result. A NEW revision is allowed
--    only when the derived payment state changed since the latest revision (no silent regeneration).
--  * Self-service: personnel.profile_id links an employee to a login. It is now UNIQUE and can change ONLY through
--    set_personnel_profile (HR ADMIN) — before, any HR-create user could re-link it (IDOR on payslips).
--  * Employees read ONLY through SECURITY DEFINER RPCs / their own-row policy; payroll tables stay payroll-only.
--  * _payroll_has_live_payments (0128) now also reports issued payslips, so reopen / cancel-after-approval stay blocked
--    once a payslip exists (no restate of those two functions is needed).
-- No write_log payload contains an amount. RLS/grants in 0131.
-- =====================================================================

-- ---------------------------------------------------------------------
-- personnel.profile_id: unique + guarded
-- ---------------------------------------------------------------------
create unique index if not exists uq_personnel_profile on public.personnel (profile_id) where profile_id is not null;

create or replace function public.tg_personnel_profile_guard() returns trigger language plpgsql as $$
begin
  if new.profile_id is distinct from old.profile_id and coalesce(current_setting('nil.personnel_link', true), '') <> 'on' then
    raise exception 'PERSONNEL_PROFILE_LOCKED' using errcode = '22000';
  end if;
  return new;
end; $$;
drop trigger if exists trg_personnel_profile_guard on public.personnel;
create trigger trg_personnel_profile_guard before update on public.personnel
  for each row execute function public.tg_personnel_profile_guard();

create or replace function public.set_personnel_profile(p_personnel_id uuid, p_profile_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_hr_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  perform 1 from public.personnel where id = p_personnel_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_profile_id is not null and not exists (select 1 from public.profiles where id = p_profile_id and is_active) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  perform set_config('nil.personnel_link', 'on', true);
  begin
    update public.personnel set profile_id = p_profile_id, updated_at = now() where id = p_personnel_id;
  exception when unique_violation then
    perform set_config('nil.personnel_link', 'off', true);
    raise exception 'PERSONNEL_PROFILE_LINKED' using errcode = '22000';
  end;
  perform set_config('nil.personnel_link', 'off', true);
  perform public.write_log('personnel', p_personnel_id, 'PROFILE_LINK_CHANGED', null, jsonb_build_object('linked', p_profile_id is not null));
end; $$;

-- Does the caller own this personnel record? (SECURITY DEFINER because personnel itself is HR-only.)
create or replace function public.is_my_personnel(p_personnel uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_user()
     and exists (select 1 from public.personnel p where p.id = p_personnel and p.profile_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- Archive table
-- ---------------------------------------------------------------------
create table if not exists public.payroll_payslips (
  id                    uuid primary key default gen_random_uuid(),
  result_id             uuid not null references public.payroll_results(id) on delete restrict,
  batch_id              uuid not null references public.payroll_batches(id) on delete restrict,
  personnel_id          uuid not null references public.personnel(id) on delete restrict,
  revision              integer not null check (revision >= 1),
  payment_state_at_issue text not null check (payment_state_at_issue in ('NOT_PAID','PARTIALLY_PAID','PAID')),
  storage_path          text not null unique,
  file_name             text not null,
  size_bytes            bigint not null check (size_bytes > 0),
  sha256                text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  issued_by             uuid not null references public.profiles(id),
  issued_at             timestamptz not null default now(),
  constraint uq_payroll_payslip_revision unique (result_id, revision)
);
create index if not exists idx_payroll_payslips_batch on public.payroll_payslips (batch_id);
create index if not exists idx_payroll_payslips_personnel on public.payroll_payslips (personnel_id);

drop trigger if exists trg_no_delete_payroll_payslips on public.payroll_payslips;
create trigger trg_no_delete_payroll_payslips before delete on public.payroll_payslips
  for each row execute function public.tg_payroll_no_delete();
drop trigger if exists trg_frozen_payroll_payslips on public.payroll_payslips;
create trigger trg_frozen_payroll_payslips before update on public.payroll_payslips
  for each row execute function public.tg_payroll_frozen();
drop trigger if exists trg_payroll_audit_payroll_payslips on public.payroll_payslips;
create trigger trg_payroll_audit_payroll_payslips after insert or update or delete on public.payroll_payslips
  for each row execute function public.tg_payroll_audit('result_id,batch_id,personnel_id,revision,payment_state_at_issue');

-- Locked by downstream documents: a linked payment that is DRAFT/POSTED, OR any issued payslip (restated from 0128).
create or replace function public._payroll_has_live_payments(p_batch_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.payroll_payments pp join public.payments p on p.id = pp.payment_id
                  where pp.batch_id = p_batch_id and p.status in ('DRAFT','POSTED'))
      or exists (select 1 from public.payroll_payslips s where s.batch_id = p_batch_id);
$$;

-- ---------------------------------------------------------------------
-- Derived per-result payment facts (same rule as Phase 5: a payment counts only if it is POSTED and its journal is still POSTED).
-- ---------------------------------------------------------------------
create or replace function public._payroll_result_payment(p_result_id uuid)
returns table (net numeric, paid numeric, last_date date, numbers text[], state text)
language sql stable security definer set search_path = public as $$
  with r as (select id, net from public.payroll_results where id = p_result_id),
  p as (
    select pay.amount, pay.payment_date, pay.display_number
      from public.payroll_payments pp
      join public.payments pay on pay.id = pp.payment_id
      join public.journal_entries j on j.id = pay.journal_entry_id
     where pp.result_id = p_result_id and pay.status = 'POSTED' and j.status = 'POSTED'
  )
  select r.net,
         coalesce((select sum(p.amount) from p), 0),
         (select max(p.payment_date) from p),
         coalesce((select array_agg(p.display_number order by p.payment_date, p.display_number) from p where p.display_number is not null), '{}'::text[]),
         case when r.net > 0 and coalesce((select sum(p.amount) from p), 0) >= r.net then 'PAID'
              when coalesce((select sum(p.amount) from p), 0) > 0 then 'PARTIALLY_PAID'
              else 'NOT_PAID' end
    from r;
$$;

-- ---------------------------------------------------------------------
-- Everything the PDF needs for ONE result (payroll APPROVE tier). Amounts as TEXT.
-- Lines: EARNING/DEDUCTION only, COMPUTED only; components with display_on_payslip = false are folded into one
-- «سایر مزایا / سایر کسورات» line so the visible lines always reconcile with the totals.
-- ---------------------------------------------------------------------
create or replace function public.payroll_payslip_data(p_result_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_r public.payroll_results; v_b public.payroll_batches; v_per public.payroll_periods; v_p public.personnel;
  v_pay record; v_lines jsonb; v_hidden_e numeric; v_hidden_d numeric; v_latest record; v_can boolean; v_reason text;
begin
  if not public.can_approve_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_r from public.payroll_results where id = p_result_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_b from public.payroll_batches where id = v_r.batch_id;
  if v_b.status <> 'APPROVED' or v_b.approved_calculation_id is distinct from v_r.calculation_id then
    raise exception 'PAYROLL_NOT_APPROVED' using errcode = '22000';
  end if;
  if not v_r.is_complete then raise exception 'PAYSLIP_RESULT_INVALID' using errcode = '22000'; end if;
  select * into v_per from public.payroll_periods where id = v_b.period_id;
  select * into v_p from public.personnel where id = v_r.personnel_id;
  select * into v_pay from public._payroll_result_payment(p_result_id);

  select coalesce(sum(l.amount) filter (where l.component_type = 'EARNING'), 0),
         coalesce(sum(l.amount) filter (where l.component_type = 'DEDUCTION'), 0)
    into v_hidden_e, v_hidden_d
    from public.payroll_result_lines l
    join public.salary_component_versions v on v.id = l.component_version_id
   where l.result_id = p_result_id and l.status = 'COMPUTED' and l.component_type in ('EARNING','DEDUCTION') and not v.display_on_payslip;

  select coalesce(jsonb_agg(x.o order by x.ord), '[]'::jsonb) into v_lines from (
    select l.line_order as ord, jsonb_build_object('code', l.component_code, 'name', l.component_name_fa,
                                                    'type', l.component_type, 'amount', l.amount::text) as o
      from public.payroll_result_lines l
      left join public.salary_component_versions v on v.id = l.component_version_id
     where l.result_id = p_result_id and l.status = 'COMPUTED' and l.component_type in ('EARNING','DEDUCTION')
       and coalesce(v.display_on_payslip, true)
    union all
    select 100000, jsonb_build_object('code', 'OTHER_EARNINGS', 'name', 'سایر مزایا', 'type', 'EARNING', 'amount', v_hidden_e::text) where v_hidden_e > 0
    union all
    select 100001, jsonb_build_object('code', 'OTHER_DEDUCTIONS', 'name', 'سایر کسورات', 'type', 'DEDUCTION', 'amount', v_hidden_d::text) where v_hidden_d > 0
  ) x;

  select s.revision, s.payment_state_at_issue as state into v_latest
    from public.payroll_payslips s where s.result_id = p_result_id order by s.revision desc limit 1;
  v_can := v_latest.revision is null or v_latest.state is distinct from v_pay.state;
  v_reason := case when v_can then null else 'UP_TO_DATE' end;

  return jsonb_build_object(
    'result_id', v_r.id, 'personnel_id', v_r.personnel_id,
    'batch', jsonb_build_object('id', v_b.id, 'batch_number', v_b.batch_number, 'currency', v_b.currency),
    'period', jsonb_build_object('jalali_year', v_per.jalali_year, 'jalali_month', v_per.jalali_month,
                                 'period_start', v_per.period_start, 'period_end', v_per.period_end),
    'personnel', jsonb_build_object('number', v_r.personnel_number, 'name', v_r.personnel_name, 'job_title', v_p.job_title,
                                    'department', v_p.department, 'hire_date', v_p.hire_date),
    'lines', v_lines,
    'totals', jsonb_build_object('gross', v_r.gross::text, 'deductions', v_r.total_deductions::text, 'net', v_r.net::text),
    'payment', jsonb_build_object('state', v_pay.state, 'paid', v_pay.paid::text, 'last_date', v_pay.last_date, 'numbers', to_jsonb(v_pay.numbers)),
    'next_revision', coalesce(v_latest.revision, 0) + 1,
    'latest_revision', v_latest.revision,
    'can_issue', v_can, 'reason', v_reason);
end; $$;

-- ---------------------------------------------------------------------
-- Register an issued payslip (after the server uploaded the PDF). The server RE-DERIVES the payment state: if it differs from
-- what the PDF claims, the PDF must be regenerated (PAYSLIP_STATE_CHANGED) — a PDF is never edited or silently replaced.
-- ---------------------------------------------------------------------
create or replace function public.register_payroll_payslip(
  p_result_id uuid, p_payslip_id uuid, p_storage_path text, p_file_name text, p_size bigint, p_sha256 text, p_state text
) returns public.payroll_payslips
language plpgsql security definer set search_path = public as $$
declare
  v_r public.payroll_results; v_b public.payroll_batches; v_pay record; v_latest record; v_row public.payroll_payslips; v_rev integer;
begin
  if not public.can_approve_payroll() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_r from public.payroll_results where id = p_result_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_b from public.payroll_batches where id = v_r.batch_id for update;        -- serialises revisions per batch
  if v_b.status <> 'APPROVED' or v_b.approved_calculation_id is distinct from v_r.calculation_id then
    raise exception 'PAYROLL_NOT_APPROVED' using errcode = '22000';
  end if;
  if not v_r.is_complete then raise exception 'PAYSLIP_RESULT_INVALID' using errcode = '22000'; end if;
  if p_payslip_id is null or p_storage_path is distinct from ('payslips/' || v_r.personnel_id::text || '/' || p_payslip_id::text || '.pdf')
     or p_file_name is null or length(btrim(p_file_name)) = 0 or p_size is null or p_size <= 0 or p_sha256 is null then
    raise exception 'PAYSLIP_PATH_INVALID' using errcode = '22000';
  end if;

  select * into v_pay from public._payroll_result_payment(p_result_id);
  if p_state is distinct from v_pay.state then raise exception 'PAYSLIP_STATE_CHANGED' using errcode = '22000'; end if;
  select s.revision, s.payment_state_at_issue as state into v_latest
    from public.payroll_payslips s where s.result_id = p_result_id order by s.revision desc limit 1;
  if v_latest.revision is not null and v_latest.state is not distinct from v_pay.state then
    raise exception 'PAYSLIP_UP_TO_DATE' using errcode = '22000';
  end if;
  v_rev := coalesce(v_latest.revision, 0) + 1;

  insert into public.payroll_payslips (id, result_id, batch_id, personnel_id, revision, payment_state_at_issue,
                                       storage_path, file_name, size_bytes, sha256, issued_by)
  values (p_payslip_id, p_result_id, v_r.batch_id, v_r.personnel_id, v_rev, v_pay.state,
          p_storage_path, btrim(p_file_name), p_size, p_sha256, auth.uid())
  returning * into v_row;
  perform public.write_log('payroll_payslips', v_row.id, 'ISSUED', null,
    jsonb_build_object('revision', v_rev, 'payment_state', v_pay.state));
  return v_row;
end; $$;

-- ---------------------------------------------------------------------
-- Batch view for payroll: per result, latest revision + whether a new one may be issued. No amounts.
-- ---------------------------------------------------------------------
create or replace function public.payroll_payslips_for_batch(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_b public.payroll_batches;
begin
  if not public.has_payroll_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_b from public.payroll_batches where id = p_batch_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_b.status <> 'APPROVED' then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'result_id', r.id, 'personnel_number', r.personnel_number, 'personnel_name', r.personnel_name,
             'current_state', cp.state,
             'can_issue', (not exists (select 1 from public.payroll_payslips s where s.result_id = r.id))
                          or (select s2.payment_state_at_issue from public.payroll_payslips s2 where s2.result_id = r.id order by s2.revision desc limit 1) is distinct from cp.state,
             'revisions', (select coalesce(jsonb_agg(jsonb_build_object('id', s3.id, 'revision', s3.revision,
                              'state', s3.payment_state_at_issue, 'issued_at', s3.issued_at) order by s3.revision), '[]'::jsonb)
                             from public.payroll_payslips s3 where s3.result_id = r.id))
           order by r.personnel_number)
      from public.payroll_results r
      cross join lateral public._payroll_result_payment(r.id) cp
     where r.calculation_id = v_b.approved_calculation_id and r.is_complete), '[]'::jsonb);
end; $$;

-- ---------------------------------------------------------------------
-- Employee self-service: ONLY the caller's own payslips. Never returns employer cost, warnings, inputs, bank data or other staff.
-- ---------------------------------------------------------------------
create or replace function public.my_payslips()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pid uuid;
begin
  if not public.is_active_user() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select id into v_pid from public.personnel where profile_id = auth.uid();
  if v_pid is null then return jsonb_build_object('linked', false, 'items', '[]'::jsonb); end if;
  return jsonb_build_object('linked', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'revision', s.revision, 'payment_state', s.payment_state_at_issue, 'issued_at', s.issued_at,
             'jalali_year', per.jalali_year, 'jalali_month', per.jalali_month, 'currency', b.currency, 'net', r.net::text,
             'is_latest', s.revision = (select max(s2.revision) from public.payroll_payslips s2 where s2.result_id = s.result_id))
           order by per.jalali_year desc, per.jalali_month desc, s.revision desc)
      from public.payroll_payslips s
      join public.payroll_results r on r.id = s.result_id
      join public.payroll_batches b on b.id = s.batch_id and b.status = 'APPROVED' and b.approved_calculation_id = r.calculation_id
      join public.payroll_periods per on per.id = b.period_id
     where s.personnel_id = v_pid), '[]'::jsonb));
end; $$;

-- One log row per download (who: payroll or owner). No amounts.
create or replace function public.record_payslip_access(p_payslip_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_payroll boolean := public.has_payroll_access();
begin
  if not public.is_active_user() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select personnel_id into v_pid from public.payroll_payslips where id = p_payslip_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not (v_payroll or public.is_my_personnel(v_pid)) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  perform public.write_log('payroll_payslips', p_payslip_id, 'ACCESSED', null,
    jsonb_build_object('by', case when v_payroll then 'PAYROLL' else 'OWNER' end));
end; $$;

-- =====================================================================
-- ROLLBACK: drop function if exists public.record_payslip_access(uuid), public.my_payslips(), public.payroll_payslips_for_batch(uuid),
--   public.register_payroll_payslip(uuid,uuid,text,text,bigint,text,text), public.payroll_payslip_data(uuid),
--   public._payroll_result_payment(uuid), public.is_my_personnel(uuid), public.set_personnel_profile(uuid,uuid);
-- drop table if exists public.payroll_payslips cascade; drop trigger trg_personnel_profile_guard on public.personnel;
-- drop function public.tg_personnel_profile_guard(); drop index public.uq_personnel_profile; re-run 0128 for _payroll_has_live_payments.
-- =====================================================================

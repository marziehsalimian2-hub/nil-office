-- =====================================================================
-- NIL Office — 0111_personnel_functions.sql
-- Human Resources & Payroll — Phase 1 — numbering trigger + the three
-- SECURITY DEFINER RPCs that are the ONLY sanctioned write paths for
-- personnel/employment_records (no INSERT policy exists on either
-- table in 0112 — mirrors external_intakes' RLS-by-omission, 0100).
-- =====================================================================

-- ---------------------------------------------------------------------
-- tg_personnel_number — numbers a personnel row at INSERT, same shape
-- as tg_cheque_number (0075): no deferred-draft numbering gap needed,
-- Personnel isn't a draft-then-finalize document.
-- ---------------------------------------------------------------------
create or replace function public.tg_personnel_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int;
  v_seq  int;
begin
  v_year := public.jalali_year(now());
  v_seq  := public.allocate_sequence('PERSONNEL', v_year);

  new.year             := v_year;
  new.sequence_number  := v_seq;
  new.personnel_number := public.format_display_number('PERSONNEL', v_year, v_seq);

  return new;
end;
$$;

drop trigger if exists trg_personnel_number on public.personnel;
create trigger trg_personnel_number
  before insert on public.personnel
  for each row execute function public.tg_personnel_number();

-- ---------------------------------------------------------------------
-- create_employment_record — the ONLY way an Employment Record is ever
-- written. Atomically closes the personnel's current open record (if
-- any) and opens a new one, then syncs personnel's denormalized
-- snapshot. Called directly for ordinary job changes, and internally by
-- onboard_personnel() (initial hire) and change_personnel_status()
-- (rehire).
-- ---------------------------------------------------------------------
create or replace function public.create_employment_record(
  p_personnel_id                    uuid,
  p_employment_type                 text,
  p_job_title                       text,
  p_department                      text default null,
  p_manager_personnel_id            uuid default null,
  p_start_date                      date default current_date,
  p_work_schedule_type              text default null,
  p_standard_monthly_hours          numeric default null,
  p_standard_weekly_hours           numeric default null,
  p_employment_contract_document_id uuid default null
)
returns public.employment_records
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  public.employment_records;
  v_prev public.employment_records;
begin
  if not public.can_create_hr() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  perform 1 from public.personnel where id = p_personnel_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_prev from public.employment_records
   where personnel_id = p_personnel_id and end_date is null
   for update;

  if found then
    if p_start_date < v_prev.start_date then
      raise exception 'START_DATE_BEFORE_CURRENT_RECORD' using errcode = '22000';
    end if;
    update public.employment_records
       set end_date = p_start_date, status = 'ENDED', updated_at = now()
     where id = v_prev.id;
  end if;

  insert into public.employment_records (
    personnel_id, employment_type, job_title, department, manager_personnel_id,
    start_date, work_schedule_type, standard_monthly_hours, standard_weekly_hours,
    employment_contract_document_id, status, created_by
  ) values (
    p_personnel_id, p_employment_type::personnel_employment_type, p_job_title, p_department, p_manager_personnel_id,
    p_start_date, p_work_schedule_type, p_standard_monthly_hours, p_standard_weekly_hours,
    p_employment_contract_document_id, 'ACTIVE', auth.uid()
  ) returning * into v_row;

  update public.personnel
     set employment_type      = v_row.employment_type,
         job_title             = v_row.job_title,
         department            = v_row.department,
         manager_personnel_id  = v_row.manager_personnel_id,
         updated_at            = now()
   where id = p_personnel_id;

  perform public.write_log('personnel', p_personnel_id, 'EMPLOYMENT_RECORD_CREATED',
    case when v_prev.id is not null then to_jsonb(v_prev) else null end, to_jsonb(v_row));
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- onboard_personnel — the ONLY way a Personnel row is ever created.
-- Inserts personnel (trigger issues the number) AND seeds the first
-- Employment Record in one transaction, so every personnel row always
-- has at least one employment_records row (an invariant the Employment/
-- History tabs rely on).
-- ---------------------------------------------------------------------
create or replace function public.onboard_personnel(
  p_first_name              text,
  p_last_name                text,
  p_hire_date                 date,
  p_job_title                  text,
  p_employment_type            text,
  p_department                 text default null,
  p_manager_personnel_id       uuid default null,
  p_work_location               text default null,
  p_work_schedule_type          text default null,
  p_standard_monthly_hours      numeric default null,
  p_standard_weekly_hours       numeric default null,
  p_mobile                      text default null,
  p_email                       text default null,
  p_address                     text default null,
  p_notes                       text default null,
  p_profile_id                  uuid default null
)
returns public.personnel
language plpgsql
security definer
set search_path = public
as $$
declare
  v_personnel public.personnel;
begin
  if not public.can_create_hr() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_first_name is null or length(btrim(p_first_name)) = 0 then
    raise exception 'FIRST_NAME_REQUIRED' using errcode = '22000';
  end if;
  if p_last_name is null or length(btrim(p_last_name)) = 0 then
    raise exception 'LAST_NAME_REQUIRED' using errcode = '22000';
  end if;

  insert into public.personnel (
    profile_id, first_name, last_name, mobile, email, address,
    hire_date, job_title, department, manager_personnel_id, employment_type,
    work_location, notes, created_by
  ) values (
    p_profile_id, btrim(p_first_name), btrim(p_last_name), p_mobile, p_email, p_address,
    p_hire_date, p_job_title, p_department, p_manager_personnel_id, p_employment_type::personnel_employment_type,
    p_work_location, p_notes, auth.uid()
  ) returning * into v_personnel;

  perform public.create_employment_record(
    v_personnel.id, p_employment_type, p_job_title, p_department, p_manager_personnel_id,
    p_hire_date, p_work_schedule_type, p_standard_monthly_hours, p_standard_weekly_hours, null
  );

  perform public.write_log('personnel', v_personnel.id, 'ONBOARDED', null, to_jsonb(v_personnel));
  return v_personnel;
end;
$$;

-- ---------------------------------------------------------------------
-- change_personnel_status — the ONLY way employment_status ever
-- changes. Validates against personnel_status_transitions; TERMINATED/
-- ARCHIVED (either direction) requires ADMIN tier, everything else
-- CREATE tier+. Moving to TERMINATED closes the open employment record.
-- Rehire (TERMINATED -> ACTIVE) REQUIRES fresh employment details and
-- atomically opens a new employment record via create_employment_record
-- — otherwise a rehired person would be ACTIVE with no current record.
-- ---------------------------------------------------------------------
create or replace function public.change_personnel_status(
  p_personnel_id            uuid,
  p_new_status              text,
  p_reason                  text default null,
  p_effective_date          date default current_date,
  -- rehire-only (TERMINATED -> ACTIVE): required together, ignored otherwise
  p_employment_type         text default null,
  p_job_title                text default null,
  p_department                text default null,
  p_manager_personnel_id      uuid default null,
  p_work_schedule_type        text default null,
  p_standard_monthly_hours    numeric default null,
  p_standard_weekly_hours     numeric default null
)
returns public.personnel
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row            public.personnel;
  v_old_status     personnel_status;
  v_requires_admin boolean;
  v_is_rehire      boolean;
begin
  select * into v_row from public.personnel where id = p_personnel_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_old_status := v_row.employment_status;

  if not exists (
    select 1 from public.personnel_status_transitions
     where from_status = v_old_status and to_status = p_new_status::personnel_status
  ) then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000';
  end if;

  v_is_rehire := (v_old_status = 'TERMINATED' and p_new_status::personnel_status = 'ACTIVE');

  v_requires_admin := p_new_status::personnel_status in ('TERMINATED','ARCHIVED') or v_old_status = 'TERMINATED';
  if v_requires_admin then
    if not public.is_hr_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  else
    if not public.can_create_hr() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  end if;

  if v_is_rehire and (p_employment_type is null or p_job_title is null) then
    raise exception 'REHIRE_REQUIRES_EMPLOYMENT_DETAILS' using errcode = '22000';
  end if;

  update public.personnel
     set employment_status = p_new_status::personnel_status,
         termination_date  = case
                                when p_new_status = 'TERMINATED' then p_effective_date
                                when p_new_status = 'ACTIVE'     then null
                                else termination_date
                              end,
         updated_at = now()
   where id = p_personnel_id
   returning * into v_row;

  if p_new_status = 'TERMINATED' then
    update public.employment_records
       set end_date = p_effective_date, status = 'ENDED', updated_at = now()
     where personnel_id = p_personnel_id and end_date is null;
  end if;

  if v_is_rehire then
    perform public.create_employment_record(
      p_personnel_id, p_employment_type, p_job_title, p_department, p_manager_personnel_id,
      p_effective_date, p_work_schedule_type, p_standard_monthly_hours, p_standard_weekly_hours, null
    );
  end if;

  perform public.write_log('personnel', p_personnel_id, 'STATUS_CHANGED',
    jsonb_build_object('employment_status', v_old_status),
    jsonb_build_object('employment_status', p_new_status, 'reason', p_reason, 'effective_date', p_effective_date));

  return v_row;
end;
$$;

grant execute on function public.onboard_personnel(text,text,date,text,text,text,uuid,text,text,numeric,numeric,text,text,text,text,uuid) to authenticated;
grant execute on function public.create_employment_record(uuid,text,text,text,uuid,date,text,numeric,numeric,uuid) to authenticated;
grant execute on function public.change_personnel_status(uuid,text,text,date,text,text,text,uuid,text,numeric,numeric) to authenticated;

-- =====================================================================
-- ROLLBACK
-- ---------------------------------------------------------------------
-- drop function if exists public.change_personnel_status(uuid,text,text,date,text,text,text,uuid,text,numeric,numeric);
-- drop function if exists public.onboard_personnel(text,text,date,text,text,text,uuid,text,text,numeric,numeric,text,text,text,text,uuid);
-- drop function if exists public.create_employment_record(uuid,text,text,text,uuid,date,text,numeric,numeric,uuid);
-- drop trigger if exists trg_personnel_number on public.personnel;
-- drop function if exists public.tg_personnel_number();
-- =====================================================================

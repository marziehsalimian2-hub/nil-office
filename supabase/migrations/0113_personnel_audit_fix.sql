-- =====================================================================
-- NIL Office — 0113_personnel_audit_fix.sql
-- Human Resources & Payroll — Phase 1 follow-up (found live, same day).
--
-- BUG 1 — saving personnel_sensitive_details always failed.
-- 0110 wired the generic tg_audit() trigger onto this table, but
-- tg_audit() reads new.id/old.id (0003_functions.sql) and this table's
-- primary key is personnel_id, not id -> every insert/update/delete
-- raised 'record "new" has no field "id"'.
--
-- BUG 2 (confidentiality, would have surfaced the moment bug 1 was
-- fixed naively) — tg_audit() writes to_jsonb(old)/to_jsonb(new) into
-- activity_logs, and activity_logs is readable by ANY active user
-- (p_logs_read = is_active_user(), 0004). A plain id-column fix would
-- have copied national_id / passport_number / birth_date /
-- emergency_contact in cleartext into a table every employee can read,
-- defeating the whole point of the ADMIN-only split table (0110/0112).
--
-- FIX:
--   1. Drop the generic audit trigger from personnel_sensitive_details
--      and replace it with a dedicated, REDACTED one: it records THAT
--      the sensitive record was created/changed/deleted and WHICH
--      field names changed — never the values (spec §69 "Sensitive
--      bank data changed" / sensitive-data audit).
--   2. Narrow activity_logs SELECT so personnel/employment_records log
--      rows (which legitimately contain name/mobile/email/address/job
--      history via tg_audit, onboard_personnel and friends) are only
--      readable by HR-access users — every other entity_type keeps its
--      exact current "any active user" behavior.
-- =====================================================================

drop trigger if exists trg_audit_personnel_sensitive_details on public.personnel_sensitive_details;

create or replace function public.tg_personnel_sensitive_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed text[] := '{}';
begin
  if tg_op = 'DELETE' then
    perform public.write_log('personnel', old.personnel_id, 'SENSITIVE_DETAILS_DELETED', null, null);
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.national_id        is not null then v_changed := v_changed || 'national_id'::text; end if;
    if new.passport_number    is not null then v_changed := v_changed || 'passport_number'::text; end if;
    if new.birth_date         is not null then v_changed := v_changed || 'birth_date'::text; end if;
    if new.emergency_contact  is not null then v_changed := v_changed || 'emergency_contact'::text; end if;
    perform public.write_log('personnel', new.personnel_id, 'SENSITIVE_DETAILS_CREATED', null,
      jsonb_build_object('fields', to_jsonb(v_changed)));
    return new;
  end if;

  -- UPDATE: field NAMES only, never old/new values.
  if new.national_id        is distinct from old.national_id        then v_changed := v_changed || 'national_id'::text; end if;
  if new.passport_number    is distinct from old.passport_number    then v_changed := v_changed || 'passport_number'::text; end if;
  if new.birth_date         is distinct from old.birth_date         then v_changed := v_changed || 'birth_date'::text; end if;
  if new.emergency_contact  is distinct from old.emergency_contact  then v_changed := v_changed || 'emergency_contact'::text; end if;

  if cardinality(v_changed) > 0 then
    perform public.write_log('personnel', new.personnel_id, 'SENSITIVE_DETAILS_CHANGED', null,
      jsonb_build_object('fields', to_jsonb(v_changed)));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_personnel_sensitive_audit on public.personnel_sensitive_details;
create trigger trg_personnel_sensitive_audit
  after insert or update or delete on public.personnel_sensitive_details
  for each row execute function public.tg_personnel_sensitive_audit();

-- activity_logs: HR-only for personnel-related entity types.
drop policy if exists p_logs_read on public.activity_logs;
create policy p_logs_read on public.activity_logs for select using (
  public.is_active_user()
  and (entity_type not in ('personnel', 'employment_records') or public.has_hr_access())
);

-- =====================================================================
-- ROLLBACK
-- ---------------------------------------------------------------------
-- drop trigger if exists trg_personnel_sensitive_audit on public.personnel_sensitive_details;
-- drop function if exists public.tg_personnel_sensitive_audit();
-- drop policy if exists p_logs_read on public.activity_logs;
-- create policy p_logs_read on public.activity_logs for select using (public.is_active_user());
-- =====================================================================

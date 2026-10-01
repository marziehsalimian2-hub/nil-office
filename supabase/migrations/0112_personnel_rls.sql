-- =====================================================================
-- NIL Office — 0112_personnel_rls.sql
-- Human Resources & Payroll — Phase 1 — RLS + grants.
--
--   * personnel/employment_records: NO insert policy on either table —
--     creation only via onboard_personnel()/create_employment_record()
--     (SECURITY DEFINER, bypass RLS) — mirrors external_intakes'
--     RLS-by-omission (0100). SELECT = has_hr_access(). UPDATE is
--     allowed directly for ordinary field edits (name/contact info on
--     personnel; employment_contract_document_id on employment_records)
--     but the "controlled-path-only" columns are frozen via the
--     self-comparison-subquery idiom p_profiles_update_self already
--     uses (personnel) / tg_employment_records_immutability (0110,
--     employment_records). NO delete policy on either — nothing is
--     ever deleted (spec §11).
--
--   * personnel_sensitive_details: ADMIN-tier-only (can_view_hr_sensitive)
--     for all four operations — identical shape to internal_cost_rates
--     (0086_service_ledger_rls.sql).
--
--   * personnel_status_transitions: reference data, SELECT only,
--     mirrors cheque_status_transitions (0078).
--
--   * attachments/storage.objects: PERSONNEL carve-out, CORRECTED to
--     preserve 0011_security_fixes.sql's later tightening. The CURRENT
--     (confirmed by reading every migration that touches these
--     policies, not just the original 0004/0005 definitions) bodies are:
--       p_attach_read    = is_active_user()                              [0004, unchanged since]
--       p_attach_write   = is_active_user() and uploaded_by = auth.uid() [0004, unchanged since]
--       p_attach_delete  = uploaded_by = auth.uid() or is_admin()        [0011 — LATER than 0004, tightened]
--       p_storage_read   = is_active_user()                              [0005, unchanged since]
--       p_storage_insert = is_active_user()                              [0005, unchanged since]
--       p_storage_update = owner = auth.uid() or is_admin()              [0011 — LATER than 0005, tightened]
--       p_storage_delete = owner = auth.uid() or is_admin()              [0011 — LATER than 0005, tightened]
--     Every policy below re-states its CURRENT body exactly (not the
--     superseded 0004/0005 one) with only the PERSONNEL carve-out added
--     on top — the 0011 fix is never regressed. Every other entity_type
--     keeps its exact current behavior unchanged.
-- =====================================================================

alter table public.personnel                   enable row level security;
alter table public.employment_records           enable row level security;
alter table public.personnel_sensitive_details   enable row level security;
alter table public.personnel_status_transitions  enable row level security;

-- personnel
drop policy if exists p_personnel_read   on public.personnel;
drop policy if exists p_personnel_update on public.personnel;
create policy p_personnel_read on public.personnel
  for select using (public.has_hr_access());
create policy p_personnel_update on public.personnel
  for update using (public.can_create_hr())
  with check (
    public.can_create_hr()
    and employment_status    =              (select employment_status    from public.personnel p2 where p2.id = personnel.id)
    and termination_date     is not distinct from (select termination_date     from public.personnel p2 where p2.id = personnel.id)
    and personnel_number     =              (select personnel_number     from public.personnel p2 where p2.id = personnel.id)
    and sequence_number      =              (select sequence_number      from public.personnel p2 where p2.id = personnel.id)
    and year                 =              (select year                 from public.personnel p2 where p2.id = personnel.id)
    and job_title             =              (select job_title             from public.personnel p2 where p2.id = personnel.id)
    and department            is not distinct from (select department            from public.personnel p2 where p2.id = personnel.id)
    and manager_personnel_id  is not distinct from (select manager_personnel_id  from public.personnel p2 where p2.id = personnel.id)
    and employment_type       =              (select employment_type       from public.personnel p2 where p2.id = personnel.id)
  );

-- employment_records — plain UPDATE allowed for can_create_hr(); the
-- fine-grained "which columns may actually change" gate lives in
-- tg_employment_records_immutability (0110), not here.
drop policy if exists p_employment_records_read   on public.employment_records;
drop policy if exists p_employment_records_update on public.employment_records;
create policy p_employment_records_read on public.employment_records
  for select using (public.has_hr_access());
create policy p_employment_records_update on public.employment_records
  for update using (public.can_create_hr()) with check (public.can_create_hr());

-- personnel_sensitive_details
drop policy if exists p_personnel_sensitive_details_read   on public.personnel_sensitive_details;
drop policy if exists p_personnel_sensitive_details_write  on public.personnel_sensitive_details;
drop policy if exists p_personnel_sensitive_details_update on public.personnel_sensitive_details;
drop policy if exists p_personnel_sensitive_details_delete on public.personnel_sensitive_details;
create policy p_personnel_sensitive_details_read   on public.personnel_sensitive_details for select using (public.can_view_hr_sensitive());
create policy p_personnel_sensitive_details_write  on public.personnel_sensitive_details for insert with check (public.can_view_hr_sensitive());
create policy p_personnel_sensitive_details_update on public.personnel_sensitive_details for update using (public.can_view_hr_sensitive()) with check (public.can_view_hr_sensitive());
create policy p_personnel_sensitive_details_delete on public.personnel_sensitive_details for delete using (public.can_view_hr_sensitive());

-- personnel_status_transitions — reference data only, never written by any role.
drop policy if exists p_personnel_status_transitions_read on public.personnel_status_transitions;
create policy p_personnel_status_transitions_read on public.personnel_status_transitions
  for select using (public.has_hr_access());

-- Mandatory base object-privilege grants (the 0013 gotcha) — RLS above
-- does the real gating; authenticated gets the full privilege set per
-- this codebase's own convention (matches 0100_external_correspondence_
-- rls_grants.sql exactly, even where no write policy exists).
grant select, insert, update, delete on
  public.personnel,
  public.employment_records,
  public.personnel_sensitive_details
  to authenticated;
grant select on public.personnel_status_transitions to authenticated;

-- ---------------------------------------------------------------------
-- attachments/storage.objects — PERSONNEL carve-out, preserving every
-- existing restriction (see header comment for the exact current
-- bodies this restates).
-- ---------------------------------------------------------------------
drop policy if exists p_attach_read on public.attachments;
create policy p_attach_read on public.attachments for select using (
  public.is_active_user() and (entity_type <> 'PERSONNEL' or public.has_hr_access())
);

drop policy if exists p_attach_write on public.attachments;
create policy p_attach_write on public.attachments for insert with check (
  public.is_active_user() and uploaded_by = auth.uid()
  and (entity_type <> 'PERSONNEL' or public.can_create_hr())
);

drop policy if exists p_attach_delete on public.attachments;
create policy p_attach_delete on public.attachments for delete using (
  (uploaded_by = auth.uid() or public.is_admin())
  and (entity_type <> 'PERSONNEL' or public.can_create_hr())
);

drop policy if exists p_storage_read on storage.objects;
create policy p_storage_read on storage.objects for select using (
  bucket_id = 'nil-files' and public.is_active_user()
  and (name not like 'personnel/%' or public.has_hr_access())
);

drop policy if exists p_storage_insert on storage.objects;
create policy p_storage_insert on storage.objects for insert with check (
  bucket_id = 'nil-files' and public.is_active_user()
  and (name not like 'personnel/%' or public.can_create_hr())
);

drop policy if exists p_storage_update on storage.objects;
create policy p_storage_update on storage.objects for update using (
  bucket_id = 'nil-files' and (owner = auth.uid() or public.is_admin())
  and (name not like 'personnel/%' or public.can_create_hr())
);

drop policy if exists p_storage_delete on storage.objects;
create policy p_storage_delete on storage.objects for delete using (
  bucket_id = 'nil-files' and (owner = auth.uid() or public.is_admin())
  and (name not like 'personnel/%' or public.can_create_hr())
);

-- =====================================================================
-- ROLLBACK
-- ---------------------------------------------------------------------
-- Restore 0011_security_fixes.sql's p_storage_delete/p_storage_update/
-- p_attach_delete and 0004_rls.sql's/0005_storage.sql's remaining
-- originals (no PERSONNEL carve-out) if this must be reverted.
-- revoke all on public.personnel_status_transitions from authenticated;
-- revoke all on public.personnel_sensitive_details, public.employment_records, public.personnel from authenticated;
-- drop policy if exists p_personnel_status_transitions_read on public.personnel_status_transitions;
-- drop policy if exists p_personnel_sensitive_details_delete on public.personnel_sensitive_details;
-- drop policy if exists p_personnel_sensitive_details_update on public.personnel_sensitive_details;
-- drop policy if exists p_personnel_sensitive_details_write on public.personnel_sensitive_details;
-- drop policy if exists p_personnel_sensitive_details_read on public.personnel_sensitive_details;
-- drop policy if exists p_employment_records_update on public.employment_records;
-- drop policy if exists p_employment_records_read on public.employment_records;
-- drop policy if exists p_personnel_update on public.personnel;
-- drop policy if exists p_personnel_read on public.personnel;
-- =====================================================================

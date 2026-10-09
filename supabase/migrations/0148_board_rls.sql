-- =====================================================================
-- NIL Office — 0148_board_rls.sql
-- Board Secretariat — Phase 1 — RLS + grants on the board tables, and the BOARD_MEETING carve-out on attachments
-- (policies RESTATED from their CURRENT bodies in 0135_assistant_cash_drafts.sql, verified by grep; 0112/0011 are older).
-- Every board table: readable only with board access; drafts writable by the CREATE tier (the triggers of 0146 enforce the lock,
-- so an APPROVED meeting cannot be changed even by a direct API call); approval only through board_approve_meeting (0147).
-- The audit log has no browser write path at all. service_role granted explicitly on every new table (0072 gotcha) — the Phase 2
-- Telegram follow-up runs as service_role.
-- =====================================================================

alter table public.board_settings     enable row level security;
alter table public.board_members      enable row level security;
alter table public.board_meetings     enable row level security;
alter table public.board_agenda_items enable row level security;
alter table public.board_attendance   enable row level security;
alter table public.board_resolutions  enable row level security;
alter table public.board_audit_log    enable row level security;

-- settings
drop policy if exists p_board_settings_read on public.board_settings;
create policy p_board_settings_read on public.board_settings for select using (public.has_board_access());
drop policy if exists p_board_settings_update on public.board_settings;
create policy p_board_settings_update on public.board_settings for update using (public.is_board_admin()) with check (public.is_board_admin());

-- members
drop policy if exists p_board_members_read on public.board_members;
create policy p_board_members_read on public.board_members for select using (public.has_board_access());
drop policy if exists p_board_members_insert on public.board_members;
create policy p_board_members_insert on public.board_members for insert with check (public.can_create_board() and created_by = auth.uid());
drop policy if exists p_board_members_update on public.board_members;
create policy p_board_members_update on public.board_members for update using (public.can_create_board()) with check (public.can_create_board());
drop policy if exists p_board_members_delete on public.board_members;
create policy p_board_members_delete on public.board_members for delete using (public.is_board_admin());

-- meetings
drop policy if exists p_board_meetings_read on public.board_meetings;
create policy p_board_meetings_read on public.board_meetings for select using (public.has_board_access());
drop policy if exists p_board_meetings_insert on public.board_meetings;
create policy p_board_meetings_insert on public.board_meetings for insert with check (public.can_create_board() and created_by = auth.uid());
drop policy if exists p_board_meetings_update on public.board_meetings;
create policy p_board_meetings_update on public.board_meetings for update using (public.can_create_board() and status = 'DRAFT')
  with check (public.can_create_board());
drop policy if exists p_board_meetings_delete on public.board_meetings;
create policy p_board_meetings_delete on public.board_meetings for delete using (public.can_create_board() and status = 'DRAFT');

-- agenda / attendance / resolutions
do $$
declare t text;
begin
  foreach t in array array['board_agenda_items', 'board_attendance', 'board_resolutions'] loop
    execute format('drop policy if exists p_%1$s_read on public.%1$s;', t);
    execute format('create policy p_%1$s_read on public.%1$s for select using (public.has_board_access());', t);
    execute format('drop policy if exists p_%1$s_update on public.%1$s;', t);
    execute format('create policy p_%1$s_update on public.%1$s for update using (public.can_create_board()) with check (public.can_create_board());', t);
    execute format('drop policy if exists p_%1$s_delete on public.%1$s;', t);
    execute format('create policy p_%1$s_delete on public.%1$s for delete using (public.can_create_board());', t);
  end loop;
end $$;
drop policy if exists p_board_agenda_items_insert on public.board_agenda_items;
create policy p_board_agenda_items_insert on public.board_agenda_items for insert with check (public.can_create_board());
drop policy if exists p_board_attendance_insert on public.board_attendance;
create policy p_board_attendance_insert on public.board_attendance for insert with check (public.can_create_board());
drop policy if exists p_board_resolutions_insert on public.board_resolutions;
create policy p_board_resolutions_insert on public.board_resolutions for insert with check (public.can_create_board() and created_by = auth.uid());

-- audit (read-only for the browser)
drop policy if exists p_board_audit_read on public.board_audit_log;
create policy p_board_audit_read on public.board_audit_log for select using (public.has_board_access());

-- grants (0013 convention: explicit, per table; service_role too — 0072 gotcha)
revoke all on public.board_settings, public.board_members, public.board_meetings, public.board_agenda_items,
              public.board_attendance, public.board_resolutions, public.board_audit_log from anon;
grant select, update                 on public.board_settings to authenticated;
grant select, insert, update, delete on public.board_members, public.board_meetings, public.board_agenda_items,
                                        public.board_attendance, public.board_resolutions to authenticated;
grant select                         on public.board_audit_log to authenticated;
grant select, insert, update, delete on public.board_settings, public.board_members, public.board_meetings, public.board_agenda_items,
                                        public.board_attendance, public.board_resolutions to service_role;
grant select, insert                 on public.board_audit_log to service_role;

-- ---------------------------------------------------------------------
-- attachments: CURRENT body (0135) + BOARD_MEETING carve-out (the frozen minutes PDF is registered here by lib/verify/issue.ts)
-- ---------------------------------------------------------------------
drop policy if exists p_attach_read on public.attachments;
create policy p_attach_read on public.attachments for select using (
  public.is_active_user()
  and (entity_type <> 'PERSONNEL' or public.has_hr_access())
  and (entity_type not in ('RECEIPT', 'PAYMENT') or public.has_accounting_access())
  and (entity_type <> 'BOARD_MEETING' or public.has_board_access())
);

drop policy if exists p_attach_write on public.attachments;
create policy p_attach_write on public.attachments for insert with check (
  public.is_active_user() and uploaded_by = auth.uid()
  and (entity_type <> 'PERSONNEL' or public.can_create_hr())
  and (entity_type not in ('RECEIPT', 'PAYMENT') or public.can_create_accounting())
  and (entity_type <> 'BOARD_MEETING' or public.can_create_board())
);

drop policy if exists p_attach_delete on public.attachments;
create policy p_attach_delete on public.attachments for delete using (
  (uploaded_by = auth.uid() or public.is_admin())
  and (entity_type <> 'PERSONNEL' or public.can_create_hr())
  and entity_type not in ('RECEIPT', 'PAYMENT')               -- financial evidence is permanent
  and (entity_type <> 'BOARD_MEETING' or public.is_board_admin())
);

-- =====================================================================
-- ROLLBACK: restore the 0135 attachments policies (drop the BOARD_MEETING terms); drop the p_board_* policies; disable RLS on the
--   board tables; revoke the grants above.
-- =====================================================================

-- =====================================================================
-- NIL Office — 0078_cheque_rls_grants.sql
-- RLS for every Cheque table, paired with the mandatory base
-- object-privilege grant to `authenticated` (the 0013_table_grants.sql
-- gotcha — RLS alone is a no-op without this; this session's own
-- Telegram module hit the missing-grant version of this mistake THREE
-- separate times, so this migration exists specifically to not repeat
-- it here). `anon` gets nothing on any table in this file.
--
-- cheques mirrors trade_offers' own shape exactly (0066): plain
-- INSERT/UPDATE is allowed for `authenticated` but restricted to
-- status='DRAFT' rows — a real safety net even though every actual
-- write in the app goes through the SECURITY DEFINER RPCs in 0077 (which
-- run as the function owner and bypass RLS regardless). Once a cheque
-- leaves DRAFT, no direct UPDATE can touch it at all — only the RPCs
-- can move it further, and tg_cheques_immutability (0075) blocks the
-- five sensitive columns even from those RPCs.
-- =====================================================================

alter table public.cheque_books                enable row level security;
alter table public.cheques                      enable row level security;
alter table public.cheque_status_transitions    enable row level security;
alter table public.cheque_print_templates       enable row level security;
alter table public.cheque_print_template_fields enable row level security;

drop policy if exists p_cheque_books_read   on public.cheque_books;
drop policy if exists p_cheque_books_write  on public.cheque_books;
drop policy if exists p_cheque_books_update on public.cheque_books;
create policy p_cheque_books_read   on public.cheque_books for select using (public.has_cheque_access());
create policy p_cheque_books_write  on public.cheque_books for insert with check (public.can_create_cheque());
create policy p_cheque_books_update on public.cheque_books for update
  using (public.can_create_cheque())
  with check (public.can_create_cheque());

drop policy if exists p_cheques_read   on public.cheques;
drop policy if exists p_cheques_write  on public.cheques;
drop policy if exists p_cheques_update on public.cheques;
create policy p_cheques_read   on public.cheques for select using (public.has_cheque_access());
create policy p_cheques_write  on public.cheques for insert with check (public.can_create_cheque());
create policy p_cheques_update on public.cheques for update
  using (public.can_create_cheque() and status = 'DRAFT')
  with check (public.can_create_cheque() and status = 'DRAFT');

-- Reference data only — never written by any role, not even ADMIN;
-- changing valid transitions is a migration-time decision.
drop policy if exists p_cheque_status_transitions_read on public.cheque_status_transitions;
create policy p_cheque_status_transitions_read on public.cheque_status_transitions
  for select using (public.has_cheque_access());

drop policy if exists p_cheque_print_templates_read   on public.cheque_print_templates;
drop policy if exists p_cheque_print_templates_write  on public.cheque_print_templates;
drop policy if exists p_cheque_print_templates_update on public.cheque_print_templates;
drop policy if exists p_cheque_print_templates_delete on public.cheque_print_templates;
create policy p_cheque_print_templates_read   on public.cheque_print_templates for select using (public.has_cheque_access());
create policy p_cheque_print_templates_write  on public.cheque_print_templates for insert with check (public.is_cheque_admin());
create policy p_cheque_print_templates_update on public.cheque_print_templates for update
  using (public.is_cheque_admin()) with check (public.is_cheque_admin());
create policy p_cheque_print_templates_delete on public.cheque_print_templates for delete using (public.is_cheque_admin());

drop policy if exists p_cheque_print_template_fields_read   on public.cheque_print_template_fields;
drop policy if exists p_cheque_print_template_fields_write  on public.cheque_print_template_fields;
drop policy if exists p_cheque_print_template_fields_update on public.cheque_print_template_fields;
drop policy if exists p_cheque_print_template_fields_delete on public.cheque_print_template_fields;
create policy p_cheque_print_template_fields_read   on public.cheque_print_template_fields for select using (public.has_cheque_access());
create policy p_cheque_print_template_fields_write  on public.cheque_print_template_fields for insert with check (public.is_cheque_admin());
create policy p_cheque_print_template_fields_update on public.cheque_print_template_fields for update
  using (public.is_cheque_admin()) with check (public.is_cheque_admin());
create policy p_cheque_print_template_fields_delete on public.cheque_print_template_fields for delete using (public.is_cheque_admin());

-- ---------------------------------------------------------------------
-- Base object-privilege grants (the 0013 gotcha).
-- ---------------------------------------------------------------------
grant select, insert, update, delete on
  public.cheque_books,
  public.cheques,
  public.cheque_print_templates,
  public.cheque_print_template_fields
  to authenticated;

-- Reference table: read-only for authenticated, same treatment as
-- number_sequences/activity_logs in 0013_table_grants.sql.
grant select on public.cheque_status_transitions to authenticated;

-- =====================================================================
-- ROLLBACK
-- ---------------------------------------------------------------------
-- revoke all on public.cheque_status_transitions from authenticated;
-- revoke all on public.cheque_print_template_fields, public.cheque_print_templates, public.cheques, public.cheque_books from authenticated;
-- drop policy if exists p_cheque_print_template_fields_delete on public.cheque_print_template_fields;
-- drop policy if exists p_cheque_print_template_fields_update on public.cheque_print_template_fields;
-- drop policy if exists p_cheque_print_template_fields_write on public.cheque_print_template_fields;
-- drop policy if exists p_cheque_print_template_fields_read on public.cheque_print_template_fields;
-- drop policy if exists p_cheque_print_templates_delete on public.cheque_print_templates;
-- drop policy if exists p_cheque_print_templates_update on public.cheque_print_templates;
-- drop policy if exists p_cheque_print_templates_write on public.cheque_print_templates;
-- drop policy if exists p_cheque_print_templates_read on public.cheque_print_templates;
-- drop policy if exists p_cheque_status_transitions_read on public.cheque_status_transitions;
-- drop policy if exists p_cheques_update on public.cheques;
-- drop policy if exists p_cheques_write on public.cheques;
-- drop policy if exists p_cheques_read on public.cheques;
-- drop policy if exists p_cheque_books_update on public.cheque_books;
-- drop policy if exists p_cheque_books_write on public.cheque_books;
-- drop policy if exists p_cheque_books_read on public.cheque_books;
-- =====================================================================

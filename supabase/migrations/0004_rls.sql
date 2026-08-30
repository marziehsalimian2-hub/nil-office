-- =====================================================================
-- NIL Office — 0004_rls.sql
-- Row Level Security. Nothing internal is reachable without an active
-- profile; privileged surfaces (sequences, audit) are locked down.
-- =====================================================================

alter table public.profiles              enable row level security;
alter table public.companies             enable row level security;
alter table public.number_sequences      enable row level security;
alter table public.cases                 enable row level security;
alter table public.correspondence        enable row level security;
alter table public.correspondence_links  enable row level security;
alter table public.documents             enable row level security;
alter table public.attachments           enable row level security;
alter table public.followups             enable row level security;
alter table public.activity_logs         enable row level security;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
drop policy if exists p_profiles_select on public.profiles;
create policy p_profiles_select on public.profiles
  for select using (public.is_active_user());

drop policy if exists p_profiles_update_self on public.profiles;
create policy p_profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));
  -- self-service edits allowed, but a user cannot change their own role.

drop policy if exists p_profiles_admin_all on public.profiles;
create policy p_profiles_admin_all on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Shared operational-record policy shape:
--   read  -> any active user
--   write -> any active user, own created_by
--   delete-> admin (plus special cases handled per table)
-- ---------------------------------------------------------------------

-- companies
drop policy if exists p_companies_read on public.companies;
create policy p_companies_read on public.companies for select using (public.is_active_user());
drop policy if exists p_companies_write on public.companies;
create policy p_companies_write on public.companies for insert with check (public.is_active_user() and created_by = auth.uid());
drop policy if exists p_companies_update on public.companies;
create policy p_companies_update on public.companies for update using (public.is_active_user()) with check (public.is_active_user());
drop policy if exists p_companies_delete on public.companies;
create policy p_companies_delete on public.companies for delete using (public.is_admin());

-- cases
drop policy if exists p_cases_read on public.cases;
create policy p_cases_read on public.cases for select using (public.is_active_user());
drop policy if exists p_cases_write on public.cases;
create policy p_cases_write on public.cases for insert with check (public.is_active_user() and created_by = auth.uid());
drop policy if exists p_cases_update on public.cases;
create policy p_cases_update on public.cases for update using (public.is_active_user()) with check (public.is_active_user());
drop policy if exists p_cases_delete on public.cases;
create policy p_cases_delete on public.cases for delete using (public.is_admin());

-- correspondence
drop policy if exists p_corr_read on public.correspondence;
create policy p_corr_read on public.correspondence for select using (public.is_active_user());
drop policy if exists p_corr_write on public.correspondence;
create policy p_corr_write on public.correspondence for insert with check (public.is_active_user() and created_by = auth.uid());
drop policy if exists p_corr_update on public.correspondence;
create policy p_corr_update on public.correspondence for update using (public.is_active_user()) with check (public.is_active_user());
-- Only DRAFT letters may be hard-deleted, and only by their creator or an
-- admin. Numbered letters are cancelled, never deleted.
drop policy if exists p_corr_delete on public.correspondence;
create policy p_corr_delete on public.correspondence
  for delete using (
    public.is_admin()
    or (created_by = auth.uid() and status = 'DRAFT' and sequence_number is null)
  );

-- correspondence_links
drop policy if exists p_links_read on public.correspondence_links;
create policy p_links_read on public.correspondence_links for select using (public.is_active_user());
drop policy if exists p_links_write on public.correspondence_links;
create policy p_links_write on public.correspondence_links for insert with check (public.is_active_user());
drop policy if exists p_links_delete on public.correspondence_links;
create policy p_links_delete on public.correspondence_links for delete using (public.is_active_user());

-- documents
drop policy if exists p_docs_read on public.documents;
create policy p_docs_read on public.documents for select using (public.is_active_user());
drop policy if exists p_docs_write on public.documents;
create policy p_docs_write on public.documents for insert with check (public.is_active_user() and created_by = auth.uid());
drop policy if exists p_docs_update on public.documents;
create policy p_docs_update on public.documents for update using (public.is_active_user()) with check (public.is_active_user());
drop policy if exists p_docs_delete on public.documents;
create policy p_docs_delete on public.documents for delete using (public.is_admin());

-- attachments
drop policy if exists p_attach_read on public.attachments;
create policy p_attach_read on public.attachments for select using (public.is_active_user());
drop policy if exists p_attach_write on public.attachments;
create policy p_attach_write on public.attachments for insert with check (public.is_active_user() and uploaded_by = auth.uid());
drop policy if exists p_attach_delete on public.attachments;
create policy p_attach_delete on public.attachments for delete using (public.is_active_user());

-- followups
drop policy if exists p_followups_read on public.followups;
create policy p_followups_read on public.followups for select using (public.is_active_user());
drop policy if exists p_followups_write on public.followups;
create policy p_followups_write on public.followups for insert with check (public.is_active_user() and created_by = auth.uid());
drop policy if exists p_followups_update on public.followups;
create policy p_followups_update on public.followups for update using (public.is_active_user()) with check (public.is_active_user());
drop policy if exists p_followups_delete on public.followups;
create policy p_followups_delete on public.followups for delete using (public.is_admin());

-- ---------------------------------------------------------------------
-- number_sequences — read-only to users; only admins may seed initial
-- values (deployment). Increments happen exclusively through the
-- SECURITY DEFINER RPCs, which bypass RLS. No normal path lets a user
-- mutate a counter directly.
-- ---------------------------------------------------------------------
drop policy if exists p_seq_read on public.number_sequences;
create policy p_seq_read on public.number_sequences for select using (public.is_active_user());
drop policy if exists p_seq_admin_write on public.number_sequences;
create policy p_seq_admin_write on public.number_sequences for insert with check (public.is_admin());
drop policy if exists p_seq_admin_update on public.number_sequences;
create policy p_seq_admin_update on public.number_sequences for update using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- activity_logs — readable by active users, but never writable/editable
-- through the API. Inserts arrive only via write_log (SECURITY DEFINER).
-- With RLS enabled and no INSERT/UPDATE/DELETE policy, direct writes are
-- rejected for every non-superuser role.
-- ---------------------------------------------------------------------
drop policy if exists p_logs_read on public.activity_logs;
create policy p_logs_read on public.activity_logs for select using (public.is_active_user());

-- ---------------------------------------------------------------------
-- Function execution grants.
-- ---------------------------------------------------------------------
revoke all on function public.allocate_sequence(text, int) from public, anon, authenticated;

grant execute on function public.finalize_correspondence(uuid, int) to authenticated;
grant execute on function public.register_incoming(uuid, int)       to authenticated;
grant execute on function public.cancel_correspondence(uuid)         to authenticated;
grant execute on function public.search_all(text)                    to authenticated;
grant execute on function public.is_active_user()                    to authenticated;
grant execute on function public.is_admin()                          to authenticated;
grant execute on function public.jalali_year(timestamptz)            to authenticated, anon;
grant execute on function public.format_display_number(text,int,int) to authenticated, anon;

-- =============================================================================
-- NIL Office v1.0  |  Migration 0009 — Accounting RLS (spec §28,33)
-- View/create/post authority is separated from secretariat access.
--   * no accounting access  -> accounting tables are invisible
--   * VIEW/CREATE/POST/ADMIN -> progressive rights; ADMIN role bypasses all
--   * posting/reversal/close -> gated in the SECURITY DEFINER RPCs (0008)
-- =============================================================================

-- Close a privilege-escalation gap: a user editing their own profile must not
-- be able to grant themselves accounting powers (accounting_role) either.
drop policy if exists p_profiles_update_self on public.profiles;
create policy p_profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select role from public.profiles where id = auth.uid())
    and accounting_role is not distinct from (select accounting_role from public.profiles where id = auth.uid())
  );

alter table public.app_settings          enable row level security;
alter table public.fiscal_years           enable row level security;
alter table public.accounts               enable row level security;
alter table public.detail_accounts        enable row level security;
alter table public.accounting_sequences   enable row level security;
alter table public.journal_entries        enable row level security;
alter table public.journal_entry_lines    enable row level security;
alter table public.bank_accounts          enable row level security;
alter table public.receipts               enable row level security;
alter table public.payments               enable row level security;

alter table public.accounting_sequences   force row level security;

-- app_settings: everyone active reads (to display the unit); admin writes.
drop policy if exists p_settings_read  on public.app_settings;
drop policy if exists p_settings_admin on public.app_settings;
create policy p_settings_read  on public.app_settings for select using (public.is_active_user());
create policy p_settings_admin on public.app_settings for all using (public.is_admin()) with check (public.is_admin());

-- Generic accounting policy generator: SELECT for anyone with access,
-- INSERT/UPDATE for creators, DELETE for accounting admins.
do $$
declare t text;
begin
  foreach t in array array[
    'fiscal_years','accounts','detail_accounts','journal_entries',
    'journal_entry_lines','bank_accounts','receipts','payments'
  ] loop
    execute format('drop policy if exists p_%1$s_read   on public.%1$s;', t);
    execute format('drop policy if exists p_%1$s_write  on public.%1$s;', t);
    execute format('drop policy if exists p_%1$s_update on public.%1$s;', t);
    execute format('drop policy if exists p_%1$s_delete on public.%1$s;', t);
    execute format('create policy p_%1$s_read   on public.%1$s for select using (public.has_accounting_access());', t);
    execute format('create policy p_%1$s_write  on public.%1$s for insert with check (public.can_create_accounting());', t);
    execute format('create policy p_%1$s_update on public.%1$s for update using (public.can_create_accounting()) with check (public.can_create_accounting());', t);
    execute format('create policy p_%1$s_delete on public.%1$s for delete using (public.is_accounting_admin());', t);
  end loop;
end $$;

-- accounting_sequences: readable by accounting admins; NO direct writes
-- (only the SECURITY DEFINER allocator touches it).
drop policy if exists p_acc_seq_read on public.accounting_sequences;
create policy p_acc_seq_read on public.accounting_sequences
  for select using (public.is_accounting_admin());

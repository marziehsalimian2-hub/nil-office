-- =====================================================================
-- NIL Office — 0044_crm_rls.sql
-- CRM module — RLS + grants.
--   * no crm access             -> CRM tables are invisible
--   * VIEW/CREATE/APPROVE/ADMIN -> progressive rights; ADMIN role bypasses all
--   * crm_opportunity_stage_history -> read-only to the app; only the
--     SECURITY DEFINER trigger (0043) can ever write it (runs as the
--     function owner, which bypasses RLS) — no forgeable audit trail.
--   * crm_pipelines/crm_pipeline_stages -> configuration, so only
--     is_crm_admin() may write (spec §38's CRM_MANAGE_PIPELINE, folded
--     into ADMIN); any CRM user may still read them.
-- companies itself keeps its EXISTING RLS (0004_rls.sql) unchanged —
-- any active user already has select/insert/update on it.
-- =====================================================================

-- 5th layering of the self-escalation freeze on profiles
-- (0009 -> 0011 -> 0023_contract_rls.sql -> 0032_sales_document_rls.sql -> here),
-- adding crm_role.
drop policy if exists p_profiles_update_self on public.profiles;
create policy p_profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and role             =              (select role             from public.profiles where id = auth.uid())
    and accounting_role  is not distinct from (select accounting_role from public.profiles where id = auth.uid())
    and contract_role    is not distinct from (select contract_role   from public.profiles where id = auth.uid())
    and invoice_role     is not distinct from (select invoice_role    from public.profiles where id = auth.uid())
    and crm_role         is not distinct from (select crm_role        from public.profiles where id = auth.uid())
    and is_active        =              (select is_active        from public.profiles where id = auth.uid())
  );

alter table public.crm_company_roles           enable row level security;
alter table public.company_contacts            enable row level security;
alter table public.crm_opportunities           enable row level security;
alter table public.crm_opportunity_stage_history enable row level security;
alter table public.crm_activities              enable row level security;
alter table public.crm_pipelines               enable row level security;
alter table public.crm_pipeline_stages         enable row level security;

do $$
declare t text;
begin
  foreach t in array array['crm_company_roles','company_contacts','crm_opportunities','crm_activities']
  loop
    execute format('drop policy if exists p_%1$s_read   on public.%1$s;', t);
    execute format('drop policy if exists p_%1$s_write  on public.%1$s;', t);
    execute format('drop policy if exists p_%1$s_update on public.%1$s;', t);
    execute format('drop policy if exists p_%1$s_delete on public.%1$s;', t);
    execute format('create policy p_%1$s_read   on public.%1$s for select using (public.has_crm_access());', t);
    execute format('create policy p_%1$s_write  on public.%1$s for insert with check (public.can_create_crm());', t);
    execute format('create policy p_%1$s_update on public.%1$s for update using (public.can_create_crm()) with check (public.can_create_crm());', t);
    execute format('create policy p_%1$s_delete on public.%1$s for delete using (public.is_crm_admin());', t);
  end loop;
end $$;

-- Pipeline configuration — read for any CRM user, write only for admins.
do $$
declare t text;
begin
  foreach t in array array['crm_pipelines','crm_pipeline_stages']
  loop
    execute format('drop policy if exists p_%1$s_read   on public.%1$s;', t);
    execute format('drop policy if exists p_%1$s_write  on public.%1$s;', t);
    execute format('drop policy if exists p_%1$s_update on public.%1$s;', t);
    execute format('drop policy if exists p_%1$s_delete on public.%1$s;', t);
    execute format('create policy p_%1$s_read   on public.%1$s for select using (public.has_crm_access());', t);
    execute format('create policy p_%1$s_write  on public.%1$s for insert with check (public.is_crm_admin());', t);
    execute format('create policy p_%1$s_update on public.%1$s for update using (public.is_crm_admin()) with check (public.is_crm_admin());', t);
    execute format('create policy p_%1$s_delete on public.%1$s for delete using (public.is_crm_admin());', t);
  end loop;
end $$;

-- Stage history — read-only to the app, no write policy at all.
drop policy if exists p_crm_opportunity_stage_history_read on public.crm_opportunity_stage_history;
create policy p_crm_opportunity_stage_history_read on public.crm_opportunity_stage_history
  for select using (public.has_crm_access());

-- Mandatory base grant — Postgres checks object privilege before RLS
-- (the 0013_table_grants.sql gap); already issued for the writable
-- tables in 0043, repeated here for select-only completeness on the
-- stage history table.
grant select on public.crm_opportunity_stage_history to authenticated;

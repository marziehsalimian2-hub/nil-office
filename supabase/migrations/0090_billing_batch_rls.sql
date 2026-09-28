-- =====================================================================
-- NIL Office — 0090_billing_batch_rls.sql
-- Client Service Ledger — Phase 2 — RLS.
--
--   * billing_batches: RLS gates WHO may touch the table at all; the
--     SPECIFIC per-transition bars (READY/CANCELLED require approve
--     tier, CONVERTED is RPC-only) live in tg_billing_batch_status
--     (0089) — same division of labor sales_documents already uses
--     between its own RLS and tg_sales_document_status.
--   * billing_batch_items: no UPDATE policy at all — items are
--     insert/delete only, by design (write-once snapshot lines).
-- =====================================================================

alter table public.billing_batches      enable row level security;
alter table public.billing_batch_items  enable row level security;

drop policy if exists p_billing_batches_read   on public.billing_batches;
drop policy if exists p_billing_batches_write  on public.billing_batches;
drop policy if exists p_billing_batches_update on public.billing_batches;
drop policy if exists p_billing_batches_delete on public.billing_batches;

create policy p_billing_batches_read on public.billing_batches
  for select using (public.has_service_ledger_access());

create policy p_billing_batches_write on public.billing_batches
  for insert with check (public.can_create_service_entry());

create policy p_billing_batches_update on public.billing_batches
  for update using (public.can_create_service_entry()) with check (public.can_create_service_entry());

create policy p_billing_batches_delete on public.billing_batches
  for delete using (public.is_service_ledger_admin());

drop policy if exists p_billing_batch_items_read   on public.billing_batch_items;
drop policy if exists p_billing_batch_items_write  on public.billing_batch_items;
drop policy if exists p_billing_batch_items_delete on public.billing_batch_items;

create policy p_billing_batch_items_read on public.billing_batch_items
  for select using (
    exists (
      select 1 from public.billing_batches bb
      where bb.id = batch_id and public.has_service_ledger_access()
    )
  );

create policy p_billing_batch_items_write on public.billing_batch_items
  for insert with check (
    public.can_create_service_entry()
    and exists (select 1 from public.billing_batches bb where bb.id = batch_id and bb.status = 'DRAFT')
  );

create policy p_billing_batch_items_delete on public.billing_batch_items
  for delete using (
    public.can_create_service_entry()
    and exists (select 1 from public.billing_batches bb where bb.id = batch_id and bb.status = 'DRAFT')
  );

-- Mandatory base grants already issued in 0087 (the 0013_table_grants.sql gotcha).

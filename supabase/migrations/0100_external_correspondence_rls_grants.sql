-- =====================================================================
-- NIL Office — 0100_external_correspondence_rls_grants.sql
-- External Correspondence Telegram Bot — Phase 1 — RLS + grants.
--
-- external_intakes/documents/events: SELECT-only policies for
-- `authenticated`, gated by has_external_correspondence_access() — no
-- INSERT/UPDATE/DELETE policy anywhere; every write happens exclusively
-- through the SECURITY DEFINER functions in 0099 (mirrors 0066_trade_
-- portal.sql's RLS-by-omission for its own externally-writable tables).
--
-- external_bot_rate_limits: RLS enabled with ZERO policies at all —
-- fully closed even to `authenticated`/`service_role`, since only the
-- SECURITY DEFINER functions (running as their owner, not as
-- service_role) ever need to touch it.
--
-- service_role: unlike the internal Telegram bot's old table-query
-- pattern (which needed the 0096 fix), this bot's backend NEVER queries
-- external_* tables directly — it only calls the narrow SECURITY
-- DEFINER functions, which run as their OWNER's privileges, not
-- service_role's. So service_role gets EXECUTE ONLY on the specific
-- external-facing functions below — no table grants needed at all.
-- =====================================================================

alter table public.external_intakes           enable row level security;
alter table public.external_intake_documents  enable row level security;
alter table public.external_intake_events     enable row level security;
alter table public.external_bot_rate_limits    enable row level security;
alter table public.external_bot_updates         enable row level security;
alter table public.external_bot_conversation_state enable row level security;
-- No policy at all on rate_limits/updates for any role — service_role
-- bypasses RLS entirely regardless (a Postgres role attribute, not
-- policy-dependent), and nothing else should ever touch these two
-- tables directly.

drop policy if exists p_external_intakes_read on public.external_intakes;
create policy p_external_intakes_read on public.external_intakes
  for select using (public.has_external_correspondence_access());

drop policy if exists p_external_intake_documents_read on public.external_intake_documents;
create policy p_external_intake_documents_read on public.external_intake_documents
  for select using (
    exists (
      select 1 from public.external_intakes ei
      where ei.id = intake_id and public.has_external_correspondence_access()
    )
  );

drop policy if exists p_external_intake_events_read on public.external_intake_events;
create policy p_external_intake_events_read on public.external_intake_events
  for select using (
    exists (
      select 1 from public.external_intakes ei
      where ei.id = intake_id and public.has_external_correspondence_access()
    )
  );

-- Mandatory base grants (0013_table_grants.sql gotcha) — RLS above does
-- the real gating; authenticated gets the full privilege set per this
-- codebase's own convention (matches 0066_trade_portal.sql exactly)
-- even though only SELECT policies exist.
grant select, insert, update, delete on
  public.external_intakes,
  public.external_intake_documents,
  public.external_intake_events
  to authenticated;

grant execute on function public.has_external_correspondence_access()   to authenticated;
grant execute on function public.can_review_external_correspondence()   to authenticated;
grant execute on function public.can_approve_external_correspondence()  to authenticated;
grant execute on function public.is_external_correspondence_admin()     to authenticated;

grant execute on function public.external_intake_accept_and_register(uuid, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.external_intake_reject(uuid, text, text)                          to authenticated;
grant execute on function public.external_intake_request_information(uuid, text)                   to authenticated;
grant execute on function public.external_intake_assign(uuid, uuid)                                to authenticated;
grant execute on function public.external_intake_link_company(uuid, uuid)                          to authenticated;
grant execute on function public.external_intake_link_case(uuid, uuid)                             to authenticated;

-- External-facing functions — service_role ONLY, never anon, never
-- authenticated. The Telegram webhook backend is the sole caller.
grant execute on function public.external_intake_create_and_submit(uuid, bigint, bigint, text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.external_intake_record_document(uuid, bigint, uuid, text, text, text, text, bigint, text)                to service_role;
grant execute on function public.external_intake_get_my_submissions(bigint)                                                              to service_role;
grant execute on function public.external_intake_get_status(text, bigint)                                                                to service_role;
grant execute on function public.external_intake_add_information(text, bigint, text)                                                     to service_role;

-- The shared rate-limit helper is called from inside both external- and
-- internal-facing functions above (all SECURITY DEFINER, so it never
-- needs a direct grant to any role that calls through them) — granted
-- to service_role too defensively, in case a future function calls it
-- directly from that role without going through another SECURITY
-- DEFINER wrapper.
grant execute on function public.external_intake_check_rate_limit(text, text, int, int) to service_role;

-- external_bot_updates: the one narrow exception to "service_role never
-- touches external_* tables directly" — the webhook's very first action
-- (before any function call) is a raw insert-and-check-unique-violation
-- claim, mirroring the internal bot's own assistant_channel_updates
-- pattern exactly. INSERT only — the webhook never reads this table back.
grant insert on public.external_bot_updates to service_role;

-- external_bot_conversation_state: pure ephemeral UI bookkeeping (no
-- business data, no authorization decisions ever read from it) — the
-- webhook backend manages it directly via service_role, no SECURITY
-- DEFINER wrapper needed. select/insert/update/delete since the
-- conversation flow upserts and clears rows as it progresses.
grant select, insert, update, delete on public.external_bot_conversation_state to service_role;

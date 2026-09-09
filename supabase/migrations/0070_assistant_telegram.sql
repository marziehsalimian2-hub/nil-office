-- =====================================================================
-- NIL Office — 0070_assistant_telegram.sql
-- NIL Assistant — Telegram channel adapter. Telegram is a CHANNEL, not a
-- second Assistant: the webhook mints a real per-user Supabase session
-- for the mapped profile (lib/assistant/telegram/session.ts) and then
-- calls the exact same runChatTurn()/confirmPendingAction() every other
-- caller already uses — RLS applies unchanged, nothing here bypasses it.
--
-- Only two things genuinely need to happen BEFORE a session can exist —
-- "which profile does this Telegram user map to" and "have I already
-- processed this update_id" — so only those two tables are ever touched
-- via the service-role client, exactly mirroring the Trade Portal's own
-- token-lookup precedent (0066_trade_portal.sql) for the same
-- chicken-and-egg reason. Everything else this migration adds inherits
-- the ordinary RLS-is-the-enforcement doctrine used everywhere else.
-- =====================================================================

-- ---------------------------------------------------------------------
-- assistant_conversations gets a channel column so a Telegram chat can
-- be one persistent thread per person (unlike the web UI's per-tab
-- conversations) instead of a fresh row every message.
-- ---------------------------------------------------------------------
alter table public.assistant_conversations
  add column if not exists channel text not null default 'WEB' check (channel in ('WEB','TELEGRAM'));

create index if not exists idx_assistant_conversations_user_channel
  on public.assistant_conversations (user_id, channel, updated_at desc);

-- ---------------------------------------------------------------------
-- assistant_channel_identities — external_user_id (Telegram numeric id,
-- stored as text to stay bigint-safe across any future channel) ->
-- profile_id. Looked up via service-role from the webhook (no session
-- exists yet at that point) — RLS stays enabled and admin-only so no
-- other path can read/write it.
-- ---------------------------------------------------------------------
create table if not exists public.assistant_channel_identities (
  id                uuid primary key default gen_random_uuid(),
  channel           text not null check (channel in ('TELEGRAM')),
  external_user_id  text not null,
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint uq_assistant_channel_identity unique (channel, external_user_id)
);
create index if not exists idx_assistant_channel_identities_profile on public.assistant_channel_identities (profile_id);

alter table public.assistant_channel_identities enable row level security;
drop policy if exists p_assistant_channel_identities_admin on public.assistant_channel_identities;
create policy p_assistant_channel_identities_admin on public.assistant_channel_identities
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- assistant_channel_updates — idempotency ledger. The webhook's very
-- first action, before any auth/session work: insert (channel,
-- external_update_id); a unique-violation means "already processed,"
-- return 200 immediately and do nothing else (also what makes the "ack
-- fast" contract with Telegram's own retry behavior work). Service-role
-- only — no application role ever needs to read or write this directly.
-- ---------------------------------------------------------------------
create table if not exists public.assistant_channel_updates (
  id                 uuid primary key default gen_random_uuid(),
  channel            text not null check (channel in ('TELEGRAM')),
  external_update_id text not null,
  processed_at       timestamptz not null default now(),
  status             text not null default 'OK' check (status in ('OK','ERROR')),
  constraint uq_assistant_channel_update unique (channel, external_update_id)
);

alter table public.assistant_channel_updates enable row level security;
-- Deliberately no policy at all (mirrors crm_opportunity_stage_history's
-- "no write policy" doctrine, 0044_crm_rls.sql) — service-role bypasses
-- RLS by definition; every other role gets nothing.

-- ---------------------------------------------------------------------
-- Grants. assistant_channel_identities needs an authenticated grant only
-- because its RLS policy allows admin access via the normal client too
-- (e.g. a future settings-page identity manager) — the 0013_table_
-- grants.sql gotcha, same as every other module. assistant_channel_
-- updates gets NO grant to authenticated/anon at all — service-role
-- bypasses the grant system entirely, so none is needed for it to work,
-- and omitting it keeps the table's only access path explicit.
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.assistant_channel_identities to authenticated;

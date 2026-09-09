-- =====================================================================
-- NIL Office — 0069_assistant.sql
-- NIL Assistant v1 — conversation storage + a real confirmation state
-- machine for the small set of write actions the assistant is allowed
-- to propose (task/follow-up drafts). No new permission tier: every
-- Action Registry entry (lib/assistant/actions/*.ts) checks the SAME
-- per-module role column every other page already checks, and every
-- read query is the SAME RLS-bound query every other page already
-- runs — this migration only adds the assistant's own conversation/
-- confirmation bookkeeping, strictly scoped to `user_id = auth.uid()`.
--
-- Nothing here is SECURITY DEFINER: RLS alone is enough for
-- "you can only see/touch your own conversations and your own pending
-- actions" — same doctrine already used by search_all() (plain stable
-- SQL, no elevated privilege) rather than reaching for SECURITY DEFINER
-- by default.
-- =====================================================================

create table if not exists public.assistant_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_assistant_conversations_user on public.assistant_conversations (user_id, updated_at desc);

create table if not exists public.assistant_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant','tool')),
  content         text,
  -- Small structured tool-call/tool-result summaries only (ids + display
  -- fields already returned by an Action Registry handler) — never a raw
  -- table dump and never the full LLM prompt/system prompt (spec §22).
  tool_calls      jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists idx_assistant_messages_conversation on public.assistant_messages (conversation_id, created_at);

-- ---------------------------------------------------------------------
-- assistant_pending_actions — the Confirmation Engine's state machine.
-- A write action (CREATE_TASK_DRAFT / CREATE_FOLLOWUP_DRAFT) never
-- inserts directly; it creates a PENDING row here with a human-readable
-- preview. Confirming is a single atomic conditional UPDATE done from
-- the app layer (lib/assistant/confirmation.ts) — no RPC needed, RLS is
-- the whole enforcement:
--   update ... set status='CONFIRMED', resolved_at=now()
--   where id=$1 and user_id=auth.uid() and status='PENDING' and expires_at>now()
--   returning *;
-- Zero rows back covers every "not confirmable" case uniformly (already
-- consumed, expired, superseded, or someone else's row) and is also
-- what makes a double-submit safe (spec §40) — a second confirm on an
-- already-CONFIRMED row matches nothing and does nothing.
-- ---------------------------------------------------------------------
create table if not exists public.assistant_pending_actions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  action_name  text not null,
  payload      jsonb not null,
  payload_hash text not null,
  preview_text text not null,
  status       text not null default 'PENDING'
    check (status in ('PENDING','CONFIRMED','CANCELLED','EXPIRED','SUPERSEDED')),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  resolved_at  timestamptz
);
create index if not exists idx_assistant_pending_actions_user_status
  on public.assistant_pending_actions (user_id, action_name, status);

-- ---------------------------------------------------------------------
-- RLS — every table is strictly own-user-only. No cross-user visibility
-- of conversations, messages, or pending actions, ever — an ADMIN app
-- role gets no special bypass here either, unlike every other module's
-- RLS: a conversation is personal, not a company record.
-- ---------------------------------------------------------------------
alter table public.assistant_conversations   enable row level security;
alter table public.assistant_messages        enable row level security;
alter table public.assistant_pending_actions enable row level security;

drop policy if exists p_assistant_conversations_all on public.assistant_conversations;
create policy p_assistant_conversations_all on public.assistant_conversations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Messages carry no user_id of their own (they belong to a conversation
-- that already does) — gate through the parent conversation's ownership.
drop policy if exists p_assistant_messages_all on public.assistant_messages;
create policy p_assistant_messages_all on public.assistant_messages
  for all using (
    exists (select 1 from public.assistant_conversations c where c.id = conversation_id and c.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.assistant_conversations c where c.id = conversation_id and c.user_id = auth.uid())
  );

drop policy if exists p_assistant_pending_actions_all on public.assistant_pending_actions;
create policy p_assistant_pending_actions_all on public.assistant_pending_actions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Mandatory base object-privilege grant before RLS is even evaluated
-- (the 0013_table_grants.sql gap, still the same gotcha every migration
-- since has had to repeat).
grant select, insert, update, delete on
  public.assistant_conversations,
  public.assistant_messages,
  public.assistant_pending_actions
  to authenticated;

-- ---------------------------------------------------------------------
-- assistant_write_log — a thin, explicitly-granted wrapper around the
-- existing write_log() (0003_functions.sql), which has no grant to
-- `authenticated` of its own (every existing caller invokes it from
-- *inside* another SECURITY DEFINER function, never directly from the
-- app). Only write-action OUTCOMES are audited here (spec §20/§56
-- doctrine already used by every other module: reads aren't audited,
-- writes are) — the LLM prompt/response itself never is.
-- ---------------------------------------------------------------------
create or replace function public.assistant_write_log(
  p_pending_action_id uuid,
  p_action_name text,
  p_result text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.write_log('assistant_pending_actions', p_pending_action_id, p_action_name || '_' || p_result, null,
    jsonb_build_object('action_name', p_action_name, 'result', p_result));
end;
$$;

grant execute on function public.assistant_write_log(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- ROLLBACK — drops only these three tables. Never touches any other
-- module. Run manually if the whole module needs to be removed.
-- ---------------------------------------------------------------------
-- drop table if exists public.assistant_pending_actions;
-- drop table if exists public.assistant_messages;
-- drop table if exists public.assistant_conversations;

-- =====================================================================
-- NIL Office — 0098_external_correspondence_tables.sql
-- External Correspondence Telegram Bot — Phase 1 — schema.
--
-- Modeled on 0066_trade_portal.sql's solution to the same problem class
-- (an anonymous external actor submits/reads data with no auth.uid()):
--   * external_intakes gets NO insert/update RLS policy at all — every
--     write happens through the SECURITY DEFINER functions in 0099.
--   * external_intake_documents is a DEDICATED table, not the generic
--     attachments/attach_entity mechanism — that mechanism's upload
--     flow and storage RLS are authenticated-only by design; bending it
--     to also serve an anonymous sender would weaken a working,
--     authenticated-only invariant elsewhere in the app.
--   * external_intake_events is a DEDICATED append-only audit table,
--     NOT write_log()/activity_logs — write_log() hardcodes auth.uid()
--     as the actor, and an external sender has none.
--   * external_bot_rate_limits is genuinely new infrastructure — no
--     existing rate limiter in this app is keyed on a pre-auth actor.
-- =====================================================================

create table if not exists public.external_intakes (
  id                        uuid primary key default gen_random_uuid(),

  status                    text not null default 'DRAFT'
    check (status in ('DRAFT','SUBMITTED','PENDING_REVIEW','ACCEPTED','REJECTED',
                       'NEEDS_INFORMATION','REGISTERED','UNDER_REVIEW','REPLIED','CLOSED')),

  sender_type               text check (sender_type in ('INDIVIDUAL','ORGANIZATION')),
  sender_full_name          text,
  sender_position           text,
  sender_mobile             text,
  sender_email              text,
  sender_org_name_raw       text, -- never auto-FK'd to companies — spec §6/§23

  telegram_user_id          bigint not null,
  telegram_chat_id          bigint not null,

  subject                   text,
  description               text,

  tracking_code             text not null,

  official_correspondence_id uuid references public.correspondence(id),
  assigned_to               uuid references public.profiles(id),
  case_id                   uuid references public.cases(id),
  company_id                uuid references public.companies(id),

  internal_note             text,
  public_reject_reason      text,

  submitted_at              timestamptz,
  reviewed_at               timestamptz,
  registered_at             timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create unique index if not exists uq_external_intakes_tracking_code on public.external_intakes (tracking_code);
create index if not exists idx_external_intakes_status on public.external_intakes (status);
create index if not exists idx_external_intakes_telegram_user on public.external_intakes (telegram_user_id);
create index if not exists idx_external_intakes_official_corr on public.external_intakes (official_correspondence_id);

create table if not exists public.external_intake_documents (
  id                 uuid primary key default gen_random_uuid(),
  intake_id          uuid not null references public.external_intakes(id) on delete cascade,
  storage_path       text not null,
  file_name_sanitized text not null,
  declared_mime      text not null,
  detected_signature text,
  size_bytes         bigint not null check (size_bytes > 0),
  sha256_hash        text not null,
  is_original        boolean not null default true, -- replacements insert new rows (spec §61 immutability), never update
  uploaded_at        timestamptz not null default now()
);

create unique index if not exists uq_external_intake_documents_path on public.external_intake_documents (storage_path);
create index if not exists idx_external_intake_documents_intake on public.external_intake_documents (intake_id);
create index if not exists idx_external_intake_documents_hash on public.external_intake_documents (sha256_hash);

create table if not exists public.external_intake_events (
  id                     uuid primary key default gen_random_uuid(),
  intake_id              uuid not null references public.external_intakes(id) on delete cascade,
  event_type             text not null check (event_type in (
    'SUBMISSION_CREATED','FILE_UPLOADED','SUBMISSION_SUBMITTED','REVIEW_OPENED',
    'ACCEPTED','REJECTED','NEEDS_INFORMATION','ADDITIONAL_INFO_RECEIVED',
    'OFFICIAL_CORRESPONDENCE_REGISTERED','COMPANY_LINKED','CASE_LINKED',
    'FOLLOWUP_CREATED','ASSIGNED','REPLY_ISSUED','REPLY_DELIVERED','STATUS_CHANGED'
  )),
  actor_type             text not null check (actor_type in ('EXTERNAL_TELEGRAM_USER','INTERNAL_USER','SYSTEM')),
  actor_telegram_user_id bigint,
  actor_profile_id       uuid references public.profiles(id),
  metadata               jsonb,
  created_at             timestamptz not null default now()
);

create index if not exists idx_external_intake_events_intake on public.external_intake_events (intake_id, created_at desc);

create table if not exists public.external_bot_rate_limits (
  id           uuid primary key default gen_random_uuid(),
  scope        text not null check (scope in ('TELEGRAM_USER','CHAT','SUBMISSION','UPLOAD','TRACKING_LOOKUP')),
  key          text not null,
  window_start timestamptz not null,
  count        integer not null default 0
);

create unique index if not exists uq_external_bot_rate_limits_bucket on public.external_bot_rate_limits (scope, key, window_start);

-- Dedicated idempotency ledger — deliberately NOT the internal bot's
-- assistant_channel_updates (its channel CHECK is locked to 'TELEGRAM'
-- and its sibling assistant_channel_identities maps external ids to
-- INTERNAL profiles, a concept that doesn't even apply to an external
-- sender). Spec §0's "two independent trust zones" rule means this bot
-- gets its own idempotency table, never shares the internal one, even
-- though the mechanism (insert; unique-violation = already seen) is
-- identical. Same insert-only-claim pattern as assistant_channel_updates.
create table if not exists public.external_bot_updates (
  id                 uuid primary key default gen_random_uuid(),
  external_update_id text not null unique,
  processed_at       timestamptz not null default now(),
  status             text not null default 'OK' check (status in ('OK','ERROR'))
);

-- In-progress conversation state, keyed by chat — a webhook is
-- stateless between calls, so the multi-step "new correspondence" form
-- (sender type -> details -> subject -> description -> uploads ->
-- preview -> confirm) needs SOMEWHERE to hold partial answers between
-- messages. Deliberately NOT a DRAFT row in external_intakes itself —
-- that would create a permanent-ish DB row for every abandoned/never-
-- finished conversation; this table is upserted per message and cleared
-- once the user confirms (at which point external_intake_create_and_
-- submit creates the real, permanent row in one shot) or explicitly
-- cancels.
create table if not exists public.external_bot_conversation_state (
  telegram_chat_id bigint primary key,
  telegram_user_id bigint not null,
  step             text not null default 'MENU',
  data             jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now()
);

-- touch trigger for external_intakes only (the other three tables are
-- either append-only or write-once-per-row and have no updated_at).
drop trigger if exists trg_touch_external_intakes on public.external_intakes;
create trigger trg_touch_external_intakes
  before update on public.external_intakes
  for each row execute function public.tg_touch_updated_at();

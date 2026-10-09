-- =====================================================================
-- NIL Office — 0150_board_followup.sql
-- Board Secretariat — Phase 2 — resolution follow-up, the dedicated board Telegram bot, notifications and reminders.
--
-- Decisions (user, 2026-10-09):
--   * a DEDICATED board bot (not the assistant bot, not the external-correspondence bot); every member — internal or external — links
--     their Telegram account with a ONE-TIME link the secretary creates (no NIL Office account needed);
--   * members report progress from the bot (status + note + PDF/JPG/PNG evidence); CLOSING a resolution is the secretary's decision only
--     (APPROVE tier), with a note; reopening needs a reason;
--   * after approval the frozen minutes PDF goes to ALL active linked members;
--   * reminders at 09:00 Tehran: 3 days before the deadline, on the deadline, then every 3 days while overdue; a daily digest of overdue /
--     awaiting-review items goes to the member(s) flagged as notice recipients (the secretary).
--
-- Model:
--   board_resolution_updates  append-only follow-up history (who / when / status / note; WEB or TELEGRAM)
--   board_resolution_files    evidence files of an update (storage prefix board_meeting/<meeting>/followup/<resolution>/, protected since 0149)
--   board_telegram_links      member <-> Telegram account; NO browser write path (an editor must not be able to redirect a member's
--                             messages, i.e. the minutes, to their own chat) — linked only by the bot with a one-time token
--   board_link_tokens         one-time link tokens; only the SHA-256 is stored, 7-day expiry, a new token revokes the previous one
--   board_notifications       outbox (dedupe key, lease, attempts) drained by the cron route and right after each event
--   board_bot_updates / board_bot_state   the bot's own idempotency ledger and conversation state (never shared with other bots)
-- follow_status is now changed ONLY through the follow-up RPCs (flag nil.board_follow), so every change has a history row.
-- service_role granted on every new table (0072 gotcha); the bot and the cron route run as service_role.
-- Everything that UPDATEs/DELETEs has a WHERE (Supabase pg-safeupdate, lesson of 0142).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) who receives the secretary's notices (review requests, daily digest)
-- ---------------------------------------------------------------------
alter table public.board_members add column if not exists is_notice_recipient boolean not null default false;

-- ---------------------------------------------------------------------
-- 2) follow-up history + evidence
-- ---------------------------------------------------------------------
create table if not exists public.board_resolution_updates (
  id                uuid primary key default gen_random_uuid(),
  resolution_id     uuid not null references public.board_resolutions(id) on delete cascade,
  kind              text not null check (kind in ('PROGRESS', 'CLOSED', 'REOPENED')),
  status            text not null check (status in ('IN_PROGRESS', 'BLOCKED', 'PENDING_REVIEW', 'DONE')),
  note              text not null check (length(btrim(note)) between 1 and 4000),
  source            text not null check (source in ('WEB', 'TELEGRAM')),
  actor_profile_id  uuid references public.profiles(id) on delete set null,
  actor_member_id   uuid references public.board_members(id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint ck_board_update_actor check (actor_profile_id is not null or actor_member_id is not null)
);
create index if not exists idx_board_updates_resolution on public.board_resolution_updates (resolution_id, created_at);

create table if not exists public.board_resolution_files (
  id             uuid primary key default gen_random_uuid(),
  update_id      uuid not null references public.board_resolution_updates(id) on delete cascade,
  resolution_id  uuid not null references public.board_resolutions(id) on delete cascade,
  storage_path   text not null unique check (storage_path like 'board_meeting/%' and length(storage_path) <= 400),
  file_name      text not null check (length(btrim(file_name)) between 1 and 200),
  mime_type      text check (mime_type is null or length(mime_type) <= 100),
  size_bytes     bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  created_at     timestamptz not null default now()
);
create index if not exists idx_board_files_resolution on public.board_resolution_files (resolution_id);

create or replace function public.tg_board_followup_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'BOARD_FOLLOWUP_APPEND_ONLY' using errcode = '22000';
end; $$;

drop trigger if exists trg_board_updates_append_only on public.board_resolution_updates;
create trigger trg_board_updates_append_only before update on public.board_resolution_updates
  for each row execute function public.tg_board_followup_append_only();
drop trigger if exists trg_board_files_append_only on public.board_resolution_files;
create trigger trg_board_files_append_only before update on public.board_resolution_files
  for each row execute function public.tg_board_followup_append_only();

-- ---------------------------------------------------------------------
-- 3) Telegram linking
-- ---------------------------------------------------------------------
create table if not exists public.board_telegram_links (
  member_id         uuid primary key references public.board_members(id) on delete cascade,
  telegram_user_id  bigint not null unique,
  telegram_chat_id  bigint not null unique,
  linked_at         timestamptz not null default now()
);

create table if not exists public.board_link_tokens (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.board_members(id) on delete cascade,
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),   -- SHA-256 of the raw token; the token itself is never stored
  expires_at  timestamptz not null,
  used_at     timestamptz,
  revoked_at  timestamptz,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_board_link_tokens_member on public.board_link_tokens (member_id);

-- ---------------------------------------------------------------------
-- 4) outbox + bot bookkeeping
-- ---------------------------------------------------------------------
create table if not exists public.board_notifications (
  id             bigint generated always as identity primary key,
  dedupe_key     text not null unique check (length(dedupe_key) <= 200),
  member_id      uuid not null references public.board_members(id) on delete cascade,
  kind           text not null check (kind in ('MINUTES', 'NEW_RESOLUTIONS', 'DUE_SOON', 'DUE_TODAY', 'OVERDUE', 'REVIEW_REQUEST', 'CLOSED', 'REOPENED', 'DIGEST')),
  meeting_id     uuid,                       -- no FK: a notification row outlives nothing it must keep alive
  resolution_id  uuid,
  payload        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  sent_at        timestamptz,
  lease_until    timestamptz,
  attempts       integer not null default 0 check (attempts >= 0),
  last_error     text check (last_error is null or length(last_error) <= 300)
);
create index if not exists idx_board_notifications_pending on public.board_notifications (id) where sent_at is null;

create table if not exists public.board_bot_updates (
  update_id     text primary key,
  processed_at  timestamptz not null default now()
);

create table if not exists public.board_bot_state (
  telegram_chat_id  bigint primary key,
  member_id         uuid not null references public.board_members(id) on delete cascade,
  step              text not null default 'MENU' check (length(step) <= 40),
  data              jsonb not null default '{}'::jsonb,
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5) follow_status only through the follow-up RPCs — tg_board_child_guard RESTATED from its CURRENT body (0146, verified by grep)
--    with the nil.board_follow requirement in the APPROVED branch
-- ---------------------------------------------------------------------
create or replace function public.tg_board_child_guard()
returns trigger language plpgsql as $$
declare
  v_meeting uuid; v_status text; v_rpc boolean := coalesce(current_setting('nil.board_approve', true), 'off') = 'on';
begin
  if tg_op = 'DELETE' then v_meeting := old.meeting_id; else v_meeting := new.meeting_id; end if;
  if tg_op = 'UPDATE' then
    if new.meeting_id is distinct from old.meeting_id then raise exception 'BOARD_FIELD_IMMUTABLE' using errcode = '22000'; end if;
  end if;
  select m.status into v_status from public.board_meetings m where m.id = v_meeting;
  if v_status is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;                                         -- the FK itself rejects an insert into a non-existent meeting
  end if;

  if v_status = 'DRAFT' then
    -- the resolution number is issued by the approval RPC only
    if tg_table_name = 'board_resolutions' and tg_op <> 'DELETE' and not v_rpc then
      if tg_op = 'INSERT' then
        if new.resolution_number is not null then raise exception 'BOARD_APPROVAL_RPC_ONLY' using errcode = '22000'; end if;
      elsif new.resolution_number is distinct from old.resolution_number then
        raise exception 'BOARD_APPROVAL_RPC_ONLY' using errcode = '22000';
      end if;
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- APPROVED: only follow_status may change, and only through the follow-up RPCs (each change has a history row)
  if tg_table_name = 'board_resolutions' and tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'follow_status' - 'updated_at') = (to_jsonb(old) - 'follow_status' - 'updated_at') then
      if new.follow_status is distinct from old.follow_status
         and coalesce(current_setting('nil.board_follow', true), 'off') <> 'on' then
        raise exception 'BOARD_FOLLOWUP_RPC_ONLY' using errcode = '22000';
      end if;
      return new;
    end if;
  end if;
  raise exception 'BOARD_MEETING_LOCKED' using errcode = '22000';
end; $$;

-- ---------------------------------------------------------------------
-- 6) internal helpers
-- ---------------------------------------------------------------------
create or replace function public._board_enqueue(p_member uuid, p_kind text, p_key text, p_meeting uuid default null,
                                                 p_resolution uuid default null, p_payload jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.board_notifications (dedupe_key, member_id, kind, meeting_id, resolution_id, payload)
  select p_key, p_member, p_kind, p_meeting, p_resolution, coalesce(p_payload, '{}'::jsonb)
   where exists (select 1 from public.board_members b join public.board_telegram_links l on l.member_id = b.id where b.id = p_member and b.is_active)
  on conflict (dedupe_key) do nothing;
$$;

-- one follow-up step: history row + evidence + new follow_status + notifications. Callers have already checked WHO may do it.
create or replace function public._board_apply_followup(
  p_resolution uuid, p_kind text, p_status text, p_note text, p_source text, p_profile uuid, p_member uuid, p_files jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r public.board_resolutions; v_meeting public.board_meetings; v_update uuid; f jsonb; v_prefix text; v_n integer := 0; v_rec record;
begin
  select * into r from public.board_resolutions where id = p_resolution for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_meeting from public.board_meetings where id = r.meeting_id;
  if v_meeting.status <> 'APPROVED' or not r.requires_action then raise exception 'BOARD_FOLLOWUP_NOT_ALLOWED' using errcode = '22000'; end if;
  if length(btrim(coalesce(p_note, ''))) not between 1 and 4000 then raise exception 'BOARD_NOTE_REQUIRED' using errcode = '22000'; end if;
  if p_kind = 'PROGRESS' then
    if r.follow_status = 'DONE' then raise exception 'BOARD_RESOLUTION_CLOSED' using errcode = '22000'; end if;
    if p_status not in ('IN_PROGRESS', 'BLOCKED', 'PENDING_REVIEW') then raise exception 'BOARD_INVALID' using errcode = '22000'; end if;
  elsif p_kind = 'CLOSED' then
    if r.follow_status = 'DONE' then raise exception 'BOARD_RESOLUTION_CLOSED' using errcode = '22000'; end if;
    p_status := 'DONE';
  elsif p_kind = 'REOPENED' then
    if r.follow_status <> 'DONE' then raise exception 'BOARD_RESOLUTION_NOT_CLOSED' using errcode = '22000'; end if;
    p_status := 'IN_PROGRESS';
  else
    raise exception 'BOARD_INVALID' using errcode = '22000';
  end if;

  insert into public.board_resolution_updates (resolution_id, kind, status, note, source, actor_profile_id, actor_member_id)
  values (r.id, p_kind, p_status, btrim(p_note), p_source, p_profile, p_member)
  returning id into v_update;

  v_prefix := 'board_meeting/' || r.meeting_id || '/followup/' || r.id || '/';
  if p_files is not null and jsonb_typeof(p_files) = 'array' then
    if jsonb_array_length(p_files) > 10 then raise exception 'BOARD_TOO_MANY_FILES' using errcode = '22000'; end if;
    for f in select * from jsonb_array_elements(p_files) loop
      if coalesce(f ->> 'storage_path', '') not like v_prefix || '%' or position('..' in f ->> 'storage_path') > 0 then
        raise exception 'BOARD_FILE_PATH_INVALID' using errcode = '22000';
      end if;
      insert into public.board_resolution_files (update_id, resolution_id, storage_path, file_name, mime_type, size_bytes)
      values (v_update, r.id, f ->> 'storage_path', f ->> 'file_name', f ->> 'mime_type', (f ->> 'size_bytes')::bigint);
      v_n := v_n + 1;
    end loop;
  end if;

  perform set_config('nil.board_follow', 'on', true);
  update public.board_resolutions set follow_status = p_status where id = r.id;
  perform set_config('nil.board_follow', 'off', true);

  perform public._board_log(r.meeting_id, 'board_resolutions', r.id, 'FOLLOWUP_' || p_kind,
    jsonb_build_object('status', p_status, 'source', p_source, 'files', v_n, 'update_id', v_update));

  -- notifications
  if p_kind = 'PROGRESS' and p_status = 'PENDING_REVIEW' then
    for v_rec in select b.id from public.board_members b where b.is_active and b.is_notice_recipient loop
      perform public._board_enqueue(v_rec.id, 'REVIEW_REQUEST', 'review:' || v_update || ':' || v_rec.id, r.meeting_id, r.id);
    end loop;
  elsif p_kind in ('CLOSED', 'REOPENED') and r.owner_member_id is not null then
    perform public._board_enqueue(r.owner_member_id, p_kind, lower(p_kind) || ':' || v_update, r.meeting_id, r.id, jsonb_build_object('note', btrim(p_note)));
  end if;
  return v_update;
end; $$;

-- ---------------------------------------------------------------------
-- 7) follow-up RPCs
-- ---------------------------------------------------------------------
-- web: anyone who may prepare minutes records progress on behalf of the owner (e.g. reported by phone / in a meeting)
create or replace function public.board_report_progress(p_resolution uuid, p_status text, p_note text, p_files jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.can_create_board() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return public._board_apply_followup(p_resolution, 'PROGRESS', p_status, p_note, 'WEB', auth.uid(), null, p_files);
end; $$;

-- closing is the secretary's decision (APPROVE tier) and needs the outcome written down
create or replace function public.board_close_resolution(p_resolution uuid, p_note text, p_files jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.can_approve_board() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return public._board_apply_followup(p_resolution, 'CLOSED', 'DONE', p_note, 'WEB', auth.uid(), null, p_files);
end; $$;

create or replace function public.board_reopen_resolution(p_resolution uuid, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.can_approve_board() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return public._board_apply_followup(p_resolution, 'REOPENED', 'IN_PROGRESS', p_note, 'WEB', auth.uid(), null, '[]'::jsonb);
end; $$;

-- bot (service_role only): a LINKED, ACTIVE member reports on a resolution they OWN
create or replace function public.board_member_report_progress(p_member uuid, p_resolution uuid, p_status text, p_note text, p_files jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.board_members b join public.board_telegram_links l on l.member_id = b.id where b.id = p_member and b.is_active) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.board_resolutions r where r.id = p_resolution and r.owner_member_id = p_member) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  return public._board_apply_followup(p_resolution, 'PROGRESS', p_status, p_note, 'TELEGRAM', null, p_member, p_files);
end; $$;

-- ---------------------------------------------------------------------
-- 8) linking RPCs
-- ---------------------------------------------------------------------
create or replace function public.board_issue_link_token(p_member uuid, p_token_hash text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_exp timestamptz := now() + interval '7 days';
begin
  if not public.can_create_board() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'BOARD_INVALID' using errcode = '22000'; end if;
  if not exists (select 1 from public.board_members where id = p_member and is_active) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  update public.board_link_tokens set revoked_at = now() where member_id = p_member and used_at is null and revoked_at is null;
  insert into public.board_link_tokens (member_id, token_hash, expires_at, created_by) values (p_member, p_token_hash, v_exp, auth.uid());
  perform public._board_log(null, 'board_members', p_member, 'TELEGRAM_LINK_ISSUED', jsonb_build_object('expires_at', v_exp));
  return v_exp;
end; $$;

create or replace function public.board_unlink_telegram(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_create_board() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  delete from public.board_bot_state where member_id = p_member;
  delete from public.board_telegram_links where member_id = p_member;
  update public.board_link_tokens set revoked_at = now() where member_id = p_member and used_at is null and revoked_at is null;
  perform public._board_log(null, 'board_members', p_member, 'TELEGRAM_UNLINKED', null);
end; $$;

-- bot (service_role only): consumes a one-time token. A Telegram account can belong to ONE member; re-linking a member replaces its old account.
create or replace function public.board_consume_link_token(p_token_hash text, p_telegram_user bigint, p_telegram_chat bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.board_link_tokens; v_name text; v_other uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_telegram_user is null or p_telegram_chat is null then
    return jsonb_build_object('ok', false, 'reason', 'INVALID');
  end if;
  select * into t from public.board_link_tokens where token_hash = p_token_hash for update;
  if not found or t.used_at is not null or t.revoked_at is not null or t.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'INVALID');
  end if;
  if not exists (select 1 from public.board_members where id = t.member_id and is_active) then
    return jsonb_build_object('ok', false, 'reason', 'INVALID');
  end if;
  select member_id into v_other from public.board_telegram_links
   where (telegram_user_id = p_telegram_user or telegram_chat_id = p_telegram_chat) and member_id <> t.member_id limit 1;
  if v_other is not null then
    return jsonb_build_object('ok', false, 'reason', 'ACCOUNT_IN_USE');
  end if;
  update public.board_link_tokens set used_at = now() where id = t.id;
  delete from public.board_telegram_links where member_id = t.member_id;
  insert into public.board_telegram_links (member_id, telegram_user_id, telegram_chat_id) values (t.member_id, p_telegram_user, p_telegram_chat);
  select full_name into v_name from public.board_members where id = t.member_id;
  perform public._board_log(null, 'board_members', t.member_id, 'TELEGRAM_LINKED', null);
  return jsonb_build_object('ok', true, 'member_id', t.member_id, 'name', v_name);
end; $$;

-- ---------------------------------------------------------------------
-- 9) notifications: minutes after approval, reminders, outbox claim
-- ---------------------------------------------------------------------
-- after approval (the server action calls this once the frozen PDF exists): the minutes to every active linked member + each owner's list
create or replace function public.board_enqueue_minutes(p_meeting uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare m public.board_meetings; v_rec record; v_before integer; v_after integer;
begin
  if not public.can_approve_board() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into m from public.board_meetings where id = p_meeting;
  if not found or m.status <> 'APPROVED' then raise exception 'BOARD_FOLLOWUP_NOT_ALLOWED' using errcode = '22000'; end if;
  select count(*) into v_before from public.board_notifications where meeting_id = p_meeting;
  for v_rec in select b.id from public.board_members b join public.board_telegram_links l on l.member_id = b.id where b.is_active loop
    perform public._board_enqueue(v_rec.id, 'MINUTES', 'minutes:' || p_meeting || ':' || v_rec.id, p_meeting);
  end loop;
  for v_rec in select distinct r.owner_member_id as mid from public.board_resolutions r
                where r.meeting_id = p_meeting and r.requires_action and r.owner_member_id is not null loop
    perform public._board_enqueue(v_rec.mid, 'NEW_RESOLUTIONS', 'newres:' || p_meeting || ':' || v_rec.mid, p_meeting);
  end loop;
  select count(*) into v_after from public.board_notifications where meeting_id = p_meeting;
  return v_after - v_before;
end; $$;

-- cron (service_role only). p_today = the Tehran calendar date, computed by the caller. Returns the number of reminders queued.
create or replace function public.board_enqueue_reminders(p_today date)
returns integer language plpgsql security definer set search_path = public as $$
declare v_rec record; v_kind text; v_days integer; v_before integer; v_after integer; v_overdue integer; v_review integer;
begin
  if p_today is null then raise exception 'BOARD_INVALID' using errcode = '22000'; end if;
  select count(*) into v_before from public.board_notifications where kind in ('DUE_SOON', 'DUE_TODAY', 'OVERDUE');
  for v_rec in
    select r.id, r.meeting_id, r.owner_member_id, r.due_date
      from public.board_resolutions r join public.board_meetings m on m.id = r.meeting_id
     where m.status = 'APPROVED' and r.requires_action and r.follow_status in ('OPEN', 'IN_PROGRESS', 'BLOCKED')
       and r.owner_member_id is not null and r.due_date is not null
  loop
    v_days := v_rec.due_date - p_today;
    v_kind := case when v_days = 3 then 'DUE_SOON' when v_days = 0 then 'DUE_TODAY' when v_days < 0 and (-v_days) % 3 = 0 then 'OVERDUE' end;
    if v_kind is not null then
      perform public._board_enqueue(v_rec.owner_member_id, v_kind, 'rem:' || v_rec.id || ':' || p_today, v_rec.meeting_id, v_rec.id,
        jsonb_build_object('days', v_days));
    end if;
  end loop;

  select count(*) into v_overdue from public.board_resolutions r join public.board_meetings m on m.id = r.meeting_id
   where m.status = 'APPROVED' and r.requires_action and r.follow_status in ('OPEN', 'IN_PROGRESS', 'BLOCKED') and r.due_date < p_today;
  select count(*) into v_review from public.board_resolutions r join public.board_meetings m on m.id = r.meeting_id
   where m.status = 'APPROVED' and r.follow_status = 'PENDING_REVIEW';
  if v_overdue + v_review > 0 then
    for v_rec in select b.id from public.board_members b where b.is_active and b.is_notice_recipient loop
      perform public._board_enqueue(v_rec.id, 'DIGEST', 'digest:' || v_rec.id || ':' || p_today, null, null,
        jsonb_build_object('overdue', v_overdue, 'pending_review', v_review));
    end loop;
  end if;
  select count(*) into v_after from public.board_notifications where kind in ('DUE_SOON', 'DUE_TODAY', 'OVERDUE');
  return v_after - v_before;                                                          -- reminders actually queued (linked owners only)
end; $$;

-- outbox claim (service_role only): a 5-minute lease, at most 8 attempts; SKIP LOCKED so two dispatchers never send the same row
create or replace function public.board_claim_notifications(p_limit integer default 50)
returns setof public.board_notifications language sql security definer set search_path = public as $$
  update public.board_notifications n
     set lease_until = now() + interval '5 minutes', attempts = n.attempts + 1
   where n.id in (select x.id from public.board_notifications x
                   where x.sent_at is null and x.attempts < 8 and (x.lease_until is null or x.lease_until < now())
                   order by x.id limit greatest(1, least(coalesce(p_limit, 50), 200))
                   for update skip locked)
  returning n.*;
$$;

create or replace function public.board_finish_notification(p_id bigint, p_error text default null)
returns void language sql security definer set search_path = public as $$
  update public.board_notifications
     set sent_at = case when p_error is null then now() else sent_at end,
         lease_until = case when p_error is null then null else lease_until end,
         last_error = left(p_error, 300)
   where id = p_id;
$$;

-- ---------------------------------------------------------------------
-- 10) RLS + grants
-- ---------------------------------------------------------------------
alter table public.board_resolution_updates enable row level security;
alter table public.board_resolution_files   enable row level security;
alter table public.board_telegram_links     enable row level security;
alter table public.board_link_tokens        enable row level security;
alter table public.board_notifications      enable row level security;
alter table public.board_bot_updates        enable row level security;
alter table public.board_bot_state          enable row level security;

drop policy if exists p_board_updates_read on public.board_resolution_updates;
create policy p_board_updates_read on public.board_resolution_updates for select using (public.has_board_access());
drop policy if exists p_board_files_read on public.board_resolution_files;
create policy p_board_files_read on public.board_resolution_files for select using (public.has_board_access());
drop policy if exists p_board_links_read on public.board_telegram_links;
create policy p_board_links_read on public.board_telegram_links for select using (public.has_board_access());
-- (link tokens, outbox, bot updates and bot state: no policies — only SECURITY DEFINER functions and service_role touch them)

revoke all on public.board_resolution_updates, public.board_resolution_files, public.board_telegram_links, public.board_link_tokens,
              public.board_notifications, public.board_bot_updates, public.board_bot_state from public, anon, authenticated;
grant select on public.board_resolution_updates, public.board_resolution_files, public.board_telegram_links to authenticated;
grant select, insert, update, delete on public.board_resolution_updates, public.board_resolution_files, public.board_telegram_links,
                                        public.board_link_tokens, public.board_notifications, public.board_bot_updates,
                                        public.board_bot_state to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    '_board_enqueue(uuid,text,text,uuid,uuid,jsonb)', '_board_apply_followup(uuid,text,text,text,text,uuid,uuid,jsonb)',
    'board_member_report_progress(uuid,uuid,text,text,jsonb)', 'board_consume_link_token(text,bigint,bigint)',
    'board_enqueue_reminders(date)', 'board_claim_notifications(integer)', 'board_finish_notification(bigint,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array[
    'board_report_progress(uuid,text,text,jsonb)', 'board_close_resolution(uuid,text,jsonb)', 'board_reopen_resolution(uuid,text)',
    'board_issue_link_token(uuid,text)', 'board_unlink_telegram(uuid)', 'board_enqueue_minutes(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 11) Factory Reset (0141) integration
-- ---------------------------------------------------------------------
insert into public.system_reset_manifest
  (object_name, module, classification, mode_a, mode_b, reason, risk, reset_order, sequence_impact, storage_impact, manifest_version)
values
  ('board_resolution_files',   'board', 'DELETE', 'DELETE', 'DELETE', 'Evidence files of resolution follow-ups (operational)', 'LOW', 16, '-', 'board_meeting/ followup files', 1),
  ('board_resolution_updates', 'board', 'DELETE', 'DELETE', 'DELETE', 'Resolution follow-up history (operational)', 'MEDIUM', 17, '-', '-', 1),
  ('board_notifications',      'board', 'DELETE', 'DELETE', 'DELETE', 'Board bot outbox (transient)', 'LOW', 17, '-', '-', 1),
  ('board_link_tokens',        'board', 'DELETE', 'DELETE', 'DELETE', 'One-time Telegram link tokens (transient)', 'LOW', 17, '-', '-', 1),
  ('board_telegram_links',     'board', 'DELETE', 'DELETE', 'DELETE', 'Member Telegram links (re-link after a reset)', 'LOW', 17, '-', '-', 1),
  ('board_bot_state',          'board', 'DELETE', 'DELETE', 'DELETE', 'Board bot conversation state (transient)', 'LOW', 17, '-', '-', 1),
  ('board_bot_updates',        'board', 'DELETE', 'DELETE', 'DELETE', 'Board bot idempotency ledger (transient)', 'LOW', 17, '-', '-', 1)
on conflict (object_name) do update set
  module = excluded.module, classification = excluded.classification, mode_a = excluded.mode_a, mode_b = excluded.mode_b,
  reason = excluded.reason, risk = excluded.risk, reset_order = excluded.reset_order, sequence_impact = excluded.sequence_impact,
  storage_impact = excluded.storage_impact, manifest_version = excluded.manifest_version;

-- =====================================================================
-- ROLLBACK: drop the functions above; re-run 0146's tg_board_child_guard; drop tables board_bot_state, board_bot_updates,
--   board_notifications, board_link_tokens, board_telegram_links, board_resolution_files, board_resolution_updates;
--   alter table board_members drop column is_notice_recipient; delete the 7 manifest rows.
-- =====================================================================

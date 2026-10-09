-- =====================================================================
-- NIL Office — 0146_board_tables.sql
-- Board Secretariat (دبیرخانه هیئت‌مدیره) — Phase 1 — core schema.
-- Rules carried over from the ACTA v0.1 prototype (reviewed 2026-10-09), re-implemented natively:
--   * a meeting is a DRAFT until the secretary approves it; approval (board_approve_meeting, 0147) is the ONLY way to APPROVED;
--   * an APPROVED meeting is immutable — its agenda, attendance, discussion and resolutions are locked by triggers (not just hidden
--     buttons), and a full JSON snapshot of the approved minutes is stored on the row: the PDF is always rendered from that snapshot;
--   * after approval only a resolution's follow-up status may change (Phase 2 follow-up workflow) — never its text/owner/deadline;
--   * meeting numbers are CONTINUOUS (never reset per year, user decision 2026-10-09) and issued only at approval, so a deleted draft
--     never leaves a gap; board_settings.last_manual_meeting_number lets the series continue from the last paper minutes.
-- Board members are NOT profiles: two of NIL's board members are external and get no NIL Office account. An internal member may be
-- linked to a profile (Phase 2 Telegram follow-up); an external one never is.
-- Audit: a DEDICATED board_audit_log (readable only with board access) — NOT the generic tg_audit()/activity_logs, which every active
-- user can read (confidential-data rule, see 0113).
-- Everything that UPDATEs/DELETEs has a WHERE (Supabase pg-safeupdate, lesson of 0142).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) settings (PRESERVED by a factory reset)
-- ---------------------------------------------------------------------
create table if not exists public.board_settings (
  id                          integer primary key default 1 check (id = 1),
  last_manual_meeting_number  integer not null default 0 check (last_manual_meeting_number >= 0 and last_manual_meeting_number < 100000),
  default_location            text check (default_location is null or length(btrim(default_location)) between 1 and 300),
  updated_by                  uuid references public.profiles(id) on delete set null,
  updated_at                  timestamptz not null default now()
);
insert into public.board_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2) members of the board (internal or external)
-- ---------------------------------------------------------------------
create table if not exists public.board_members (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null check (length(btrim(full_name)) between 2 and 200),
  position_title  text check (position_title is null or length(btrim(position_title)) between 1 and 200),   -- سمت در هیئت‌مدیره
  kind            text not null default 'INTERNAL' check (kind in ('INTERNAL', 'EXTERNAL')),
  profile_id      uuid references public.profiles(id) on delete set null,
  is_active       boolean not null default true,
  sort_order      integer not null default 0 check (sort_order between 0 and 1000),
  notes           text check (notes is null or length(notes) <= 2000),
  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ck_board_member_external_no_profile check (kind = 'INTERNAL' or profile_id is null)
);
create unique index if not exists uq_board_members_profile on public.board_members (profile_id) where profile_id is not null;

-- ---------------------------------------------------------------------
-- 3) meetings
-- ---------------------------------------------------------------------
create table if not exists public.board_meetings (
  id                    uuid primary key default gen_random_uuid(),
  meeting_number        integer unique check (meeting_number is null or meeting_number > 0),   -- issued at approval only
  meeting_type          text not null default 'ORDINARY' check (meeting_type in ('ORDINARY', 'EXTRAORDINARY')),
  status                text not null default 'DRAFT' check (status in ('DRAFT', 'APPROVED')),
  scheduled_at          timestamptz not null,
  location              text not null check (length(btrim(location)) between 1 and 300),
  started_at            timestamptz,
  ended_at              timestamptz,
  chair_member_id       uuid references public.board_members(id),
  secretary_member_id   uuid references public.board_members(id),
  invitees              text check (invitees is null or length(invitees) <= 2000),            -- مدعوین (non-members present)
  general_notes         text check (general_notes is null or length(general_notes) <= 20000), -- مقدمه / خلاصهٔ کلی مذاکرات
  remaining_topics      text check (remaining_topics is null or length(remaining_topics) <= 5000),
  approved_by           uuid references public.profiles(id),
  approved_at           timestamptz,
  snapshot              jsonb,
  next_meeting_id       uuid references public.board_meetings(id) on delete set null,
  created_by            uuid not null references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint ck_board_meeting_times check (ended_at is null or started_at is null or ended_at >= started_at),
  constraint ck_board_meeting_approved check (
    status <> 'APPROVED' or (meeting_number is not null and approved_by is not null and approved_at is not null and snapshot is not null
                             and started_at is not null and ended_at is not null and chair_member_id is not null and secretary_member_id is not null)),
  constraint ck_board_meeting_draft check (status <> 'DRAFT' or (meeting_number is null and approved_at is null and snapshot is null))
);
create index if not exists idx_board_meetings_scheduled on public.board_meetings (scheduled_at desc);
create index if not exists idx_board_meetings_status on public.board_meetings (status);

-- ---------------------------------------------------------------------
-- 4) agenda items (each with its own discussion summary)
-- ---------------------------------------------------------------------
create table if not exists public.board_agenda_items (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references public.board_meetings(id) on delete cascade,
  position    integer not null default 1 check (position between 1 and 500),
  title       text not null check (length(btrim(title)) between 1 and 500),
  discussion  text check (discussion is null or length(discussion) <= 20000),                    -- خلاصهٔ مذاکرات این بند
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_board_agenda_meeting on public.board_agenda_items (meeting_id, position);

-- ---------------------------------------------------------------------
-- 5) attendance (one row per member per meeting)
-- ---------------------------------------------------------------------
create table if not exists public.board_attendance (
  meeting_id  uuid not null references public.board_meetings(id) on delete cascade,
  member_id   uuid not null references public.board_members(id),
  status      text not null check (status in ('PRESENT', 'ABSENT', 'EXCUSED')),
  note        text check (note is null or length(note) <= 500),
  updated_at  timestamptz not null default now(),
  primary key (meeting_id, member_id)
);
create index if not exists idx_board_attendance_member on public.board_attendance (member_id);

-- ---------------------------------------------------------------------
-- 6) resolutions (مصوبات)
-- ---------------------------------------------------------------------
create table if not exists public.board_resolutions (
  id                 uuid primary key default gen_random_uuid(),
  meeting_id         uuid not null references public.board_meetings(id) on delete cascade,
  agenda_item_id     uuid references public.board_agenda_items(id) on delete set null,
  position           integer not null default 1 check (position between 1 and 500),
  resolution_number  text unique check (resolution_number is null or resolution_number ~ '^[0-9]{1,6}-[0-9]{1,3}$'),   -- «<meeting>-<n>», issued at approval
  text               text not null check (length(btrim(text)) between 1 and 10000),
  requires_action    boolean not null default true,
  owner_member_id    uuid references public.board_members(id),
  due_date           date,
  expected_output    text check (expected_output is null or length(expected_output) <= 1000),
  vote_note          text check (vote_note is null or length(vote_note) <= 2000),               -- نتیجهٔ رأی / نظر مخالف
  follow_status      text not null default 'OPEN'
                     check (follow_status in ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'PENDING_REVIEW', 'DONE', 'NO_ACTION')),
  created_by         uuid not null references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- an action resolution must name WHO and BY WHEN (ACTA rule: never an unknown owner or deadline)
  constraint ck_board_resolution_action check (not requires_action or (owner_member_id is not null and due_date is not null)),
  constraint ck_board_resolution_no_action check (requires_action or follow_status = 'NO_ACTION')
);
create index if not exists idx_board_resolutions_meeting on public.board_resolutions (meeting_id, position);
create index if not exists idx_board_resolutions_owner on public.board_resolutions (owner_member_id);
create index if not exists idx_board_resolutions_follow on public.board_resolutions (follow_status, due_date);

-- ---------------------------------------------------------------------
-- 7) dedicated, append-only audit log (written only by SECURITY DEFINER triggers/functions)
-- ---------------------------------------------------------------------
create table if not exists public.board_audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid references public.profiles(id) on delete set null,
  meeting_id  uuid,                         -- no FK on purpose: the log outlives a deleted draft
  entity      text not null,
  entity_id   uuid,
  action      text not null,
  detail      jsonb
);
create index if not exists idx_board_audit_meeting on public.board_audit_log (meeting_id, at);

create or replace function public.tg_board_audit_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'BOARD_AUDIT_APPEND_ONLY' using errcode = '22000';
end; $$;

drop trigger if exists trg_board_audit_append_only on public.board_audit_log;
create trigger trg_board_audit_append_only before update or delete on public.board_audit_log
  for each row execute function public.tg_board_audit_append_only();

create or replace function public._board_log(p_meeting uuid, p_entity text, p_entity_id uuid, p_action text, p_detail jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.board_audit_log (actor_id, meeting_id, entity, entity_id, action, detail)
  values (auth.uid(), p_meeting, p_entity, p_entity_id, p_action, p_detail);
$$;

-- Row audit: WHAT changed (field names), never a copy of the row — the snapshot / discussion texts stay in their own tables.
create or replace function public.tg_board_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb; v_old jsonb; v_keys text[]; v_entity_id uuid; v_meeting uuid;
begin
  if tg_op = 'DELETE' then v_row := to_jsonb(old); else v_row := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    select coalesce(array_agg(k order by k), '{}'::text[]) into v_keys
      from jsonb_object_keys(v_row) k
     where k <> 'updated_at' and v_row -> k is distinct from v_old -> k;
    if cardinality(v_keys) = 0 then return new; end if;
  end if;
  v_entity_id := case when tg_table_name = 'board_attendance' then (v_row ->> 'member_id')::uuid else (v_row ->> 'id')::uuid end;
  v_meeting   := case when tg_table_name = 'board_meetings' then (v_row ->> 'id')::uuid else (v_row ->> 'meeting_id')::uuid end;
  perform public._board_log(v_meeting, tg_table_name, v_entity_id,
    case tg_op when 'INSERT' then 'CREATED' when 'DELETE' then 'DELETED' else 'UPDATED' end,
    case when tg_op = 'UPDATE' then jsonb_build_object('fields', to_jsonb(v_keys)) end);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

-- ---------------------------------------------------------------------
-- 8) locks
-- ---------------------------------------------------------------------
-- meetings: approval fields only through board_approve_meeting (flag nil.board_approve); an APPROVED row never changes again
-- (except the FK-driven reset of next_meeting_id when that suggested draft is deleted).
create or replace function public.tg_board_meeting_guard()
returns trigger language plpgsql as $$
declare v_rpc boolean := coalesce(current_setting('nil.board_approve', true), 'off') = 'on';
begin
  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then raise exception 'BOARD_MEETING_LOCKED' using errcode = '22000'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'DRAFT' or new.meeting_number is not null or new.approved_by is not null or new.approved_at is not null
       or new.snapshot is not null or new.next_meeting_id is not null then
      raise exception 'BOARD_APPROVAL_RPC_ONLY' using errcode = '22000';
    end if;
    return new;
  end if;
  if old.status = 'APPROVED' then
    if (to_jsonb(new) - 'next_meeting_id' - 'updated_at') is distinct from (to_jsonb(old) - 'next_meeting_id' - 'updated_at')
       or (new.next_meeting_id is not null and new.next_meeting_id is distinct from old.next_meeting_id) then
      raise exception 'BOARD_MEETING_LOCKED' using errcode = '22000';
    end if;
    return new;
  end if;
  if not v_rpc and (new.status is distinct from old.status or new.meeting_number is distinct from old.meeting_number
                    or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at
                    or new.snapshot is distinct from old.snapshot or new.next_meeting_id is distinct from old.next_meeting_id) then
    raise exception 'BOARD_APPROVAL_RPC_ONLY' using errcode = '22000';
  end if;
  return new;
end; $$;

drop trigger if exists trg_board_meeting_guard on public.board_meetings;
create trigger trg_board_meeting_guard before insert or update or delete on public.board_meetings
  for each row execute function public.tg_board_meeting_guard();

-- agenda / attendance / resolutions: writable only while the meeting is a DRAFT. After approval a resolution's follow_status is the
-- only column that may change. A missing parent = the draft meeting itself is being deleted (FK cascade) -> allowed.
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

  -- APPROVED
  if tg_table_name = 'board_resolutions' and tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'follow_status' - 'updated_at') = (to_jsonb(old) - 'follow_status' - 'updated_at') then
      return new;
    end if;
  end if;
  raise exception 'BOARD_MEETING_LOCKED' using errcode = '22000';
end; $$;

-- resolutions: a non-action resolution carries no owner/deadline and is NO_ACTION; an action one is never NO_ACTION;
-- the agenda item must belong to the same meeting.
create or replace function public.tg_board_resolution_normalize()
returns trigger language plpgsql as $$
begin
  if not new.requires_action then
    new.owner_member_id := null; new.due_date := null; new.expected_output := null; new.follow_status := 'NO_ACTION';
  elsif new.follow_status = 'NO_ACTION' then
    new.follow_status := 'OPEN';
  end if;
  if new.agenda_item_id is not null
     and not exists (select 1 from public.board_agenda_items a where a.id = new.agenda_item_id and a.meeting_id = new.meeting_id) then
    raise exception 'BOARD_INVALID' using errcode = '22000';
  end if;
  return new;
end; $$;

drop trigger if exists trg_board_resolution_normalize on public.board_resolutions;
create trigger trg_board_resolution_normalize before insert or update on public.board_resolutions
  for each row execute function public.tg_board_resolution_normalize();

-- touch / guard / audit wiring
do $$
declare t text;
begin
  foreach t in array array['board_members', 'board_meetings', 'board_agenda_items', 'board_attendance', 'board_resolutions'] loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s;', t);
    execute format('create trigger trg_touch_%1$s before update on public.%1$s for each row execute function public.tg_touch_updated_at();', t);
    execute format('drop trigger if exists trg_board_audit_%1$s on public.%1$s;', t);
    execute format('create trigger trg_board_audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.tg_board_audit();', t);
  end loop;
  foreach t in array array['board_agenda_items', 'board_attendance', 'board_resolutions'] loop
    execute format('drop trigger if exists trg_board_child_guard on public.%1$s;', t);
    execute format('create trigger trg_board_child_guard before insert or update or delete on public.%1$s for each row execute function public.tg_board_child_guard();', t);
  end loop;
end $$;

-- =====================================================================
-- ROLLBACK
-- drop table if exists public.board_audit_log, public.board_resolutions, public.board_attendance, public.board_agenda_items,
--   public.board_meetings, public.board_members, public.board_settings;
-- drop function if exists public.tg_board_resolution_normalize(), public.tg_board_child_guard(), public.tg_board_meeting_guard(),
--   public.tg_board_audit(), public._board_log(uuid,text,uuid,text,jsonb), public.tg_board_audit_append_only();
-- =====================================================================

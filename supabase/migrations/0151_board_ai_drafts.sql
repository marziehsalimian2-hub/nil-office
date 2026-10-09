-- =====================================================================
-- NIL Office — 0151_board_ai_drafts.sql
-- Board Secretariat — Phase 3 — assistant drafts of the minutes from the secretary's TEXT notes.
--
-- Decisions (user, 2026-10-09): input = the secretary's raw notes as TEXT only (typed, pasted, or phone-keyboard dictation — the system never
-- receives or sends audio); used from the draft meeting page and from the board bot (secretary only); the text goes to the LLM provider.
-- Contract carried over from ACTA: the assistant only SUGGESTS. A suggestion is stored here and applied item by item by a person through the
-- normal draft editor path (RLS + triggers of 0146/0148); it never approves, never invents an owner or a deadline (validated in code against
-- the member list / the notes), and every suggested item carries a quote from the notes it came from.
-- service_role granted (the bot runs as service_role). Everything that UPDATEs/DELETEs has a WHERE (pg-safeupdate, lesson of 0142).
-- =====================================================================

create table if not exists public.board_ai_drafts (
  id                  uuid primary key default gen_random_uuid(),
  meeting_id          uuid not null references public.board_meetings(id) on delete cascade,
  source              text not null check (source in ('WEB', 'TELEGRAM')),
  notes               text not null check (length(btrim(notes)) between 1 and 30000),     -- the raw input, kept as the reference the quotes point into
  suggestion          jsonb not null,                                                       -- validated, normalised result (lib/board/assistant/draft.ts)
  status              text not null default 'PENDING' check (status in ('PENDING', 'APPLIED', 'DISCARDED')),
  model               text check (model is null or length(model) <= 100),
  input_tokens        integer check (input_tokens is null or input_tokens >= 0),
  output_tokens       integer check (output_tokens is null or output_tokens >= 0),
  created_by          uuid references public.profiles(id) on delete set null,
  created_by_member   uuid references public.board_members(id) on delete set null,
  created_at          timestamptz not null default now(),
  decided_at          timestamptz,
  decided_by          uuid references public.profiles(id) on delete set null,
  constraint ck_board_ai_draft_decided check (status = 'PENDING' or decided_at is not null)
);
create index if not exists idx_board_ai_drafts_meeting on public.board_ai_drafts (meeting_id, created_at desc);

-- a suggestion is immutable; only its status moves PENDING -> APPLIED | DISCARDED (once)
create or replace function public.tg_board_ai_draft_guard()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'status' - 'decided_at' - 'decided_by') is distinct from (to_jsonb(old) - 'status' - 'decided_at' - 'decided_by')
     or old.status <> 'PENDING' then
    raise exception 'BOARD_AI_DRAFT_IMMUTABLE' using errcode = '22000';
  end if;
  return new;
end; $$;

drop trigger if exists trg_board_ai_draft_guard on public.board_ai_drafts;
create trigger trg_board_ai_draft_guard before update on public.board_ai_drafts
  for each row execute function public.tg_board_ai_draft_guard();

-- the bot may draft only for a member who is linked to a NIL Office profile that holds the board CREATE tier (or global ADMIN):
-- returns that profile id (usage is metered against it), or null
create or replace function public.board_member_drafter_profile(p_member uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select p.id
    from public.board_members b
    join public.board_telegram_links l on l.member_id = b.id
    join public.profiles p on p.id = b.profile_id
   where b.id = p_member and b.is_active and p.is_active
     and (p.role = 'ADMIN' or p.board_role in ('CREATE', 'APPROVE', 'ADMIN'));
$$;

-- Applies the items the secretary TICKED, in ONE transaction (all or nothing; a second click finds the draft no longer PENDING).
-- Writes go into the normal draft tables, so every 0146 trigger still applies (only a DRAFT meeting can change; an action resolution
-- needs an owner and a deadline — the person fills in what the assistant left empty before applying).
--   p_new_agenda   [{key, title, discussion}]                       new agenda items, appended after the existing ones
--   p_discussions  [{agenda_item_id, discussion}]                   appended to an existing item's discussion
--   p_resolutions  [{agenda_item_id?, agenda_key?, text, requires_action, owner_member_id?, due_date?, expected_output?, vote_note?}]
create or replace function public.board_apply_ai_draft(
  p_draft uuid, p_general text, p_remaining text, p_new_agenda jsonb, p_discussions jsonb, p_resolutions jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d public.board_ai_drafts; m public.board_meetings; v_pos integer; v_rpos integer; x jsonb; v_id uuid; v_keys jsonb := '{}'::jsonb;
  v_na integer := 0; v_nd integer := 0; v_nr integer := 0; v_agenda uuid;
begin
  if not public.can_create_board() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into d from public.board_ai_drafts where id = p_draft for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if d.status <> 'PENDING' then raise exception 'BOARD_AI_DRAFT_IMMUTABLE' using errcode = '22000'; end if;
  select * into m from public.board_meetings where id = d.meeting_id for update;
  if m.status <> 'DRAFT' then raise exception 'BOARD_MEETING_LOCKED' using errcode = '22000'; end if;

  select coalesce(max(position), 0) into v_pos from public.board_agenda_items where meeting_id = m.id;
  for x in select * from jsonb_array_elements(coalesce(p_new_agenda, '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    insert into public.board_agenda_items (meeting_id, position, title, discussion)
    values (m.id, least(v_pos, 500), x ->> 'title', nullif(btrim(coalesce(x ->> 'discussion', '')), ''))
    returning id into v_id;
    v_keys := v_keys || jsonb_build_object(x ->> 'key', v_id);
    v_na := v_na + 1;
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p_discussions, '[]'::jsonb)) loop
    update public.board_agenda_items
       set discussion = case when coalesce(btrim(discussion), '') = '' then x ->> 'discussion' else discussion || E'\n\n' || (x ->> 'discussion') end
     where id = (x ->> 'agenda_item_id')::uuid and meeting_id = m.id;
    if not found then raise exception 'BOARD_INVALID' using errcode = '22000'; end if;
    v_nd := v_nd + 1;
  end loop;

  if coalesce(btrim(p_general), '') <> '' or coalesce(btrim(p_remaining), '') <> '' then
    update public.board_meetings
       set general_notes = case when coalesce(btrim(p_general), '') = '' then general_notes
                                when coalesce(btrim(general_notes), '') = '' then btrim(p_general)
                                else general_notes || E'\n\n' || btrim(p_general) end,
           remaining_topics = case when coalesce(btrim(p_remaining), '') = '' then remaining_topics
                                   when coalesce(btrim(remaining_topics), '') = '' then btrim(p_remaining)
                                   else remaining_topics || E'\n' || btrim(p_remaining) end
     where id = m.id;
  end if;

  select coalesce(max(position), 0) into v_rpos from public.board_resolutions where meeting_id = m.id;
  for x in select * from jsonb_array_elements(coalesce(p_resolutions, '[]'::jsonb)) loop
    v_rpos := v_rpos + 1;
    v_agenda := coalesce(nullif(x ->> 'agenda_item_id', '')::uuid, nullif(v_keys ->> coalesce(x ->> 'agenda_key', ''), '')::uuid);
    insert into public.board_resolutions (meeting_id, agenda_item_id, position, text, requires_action, owner_member_id, due_date, expected_output, vote_note, created_by)
    values (m.id, v_agenda, least(v_rpos, 500), x ->> 'text', coalesce((x ->> 'requires_action')::boolean, true),
            nullif(x ->> 'owner_member_id', '')::uuid, nullif(x ->> 'due_date', '')::date,
            nullif(btrim(coalesce(x ->> 'expected_output', '')), ''), nullif(btrim(coalesce(x ->> 'vote_note', '')), ''), auth.uid());
    v_nr := v_nr + 1;
  end loop;

  update public.board_ai_drafts set status = 'APPLIED', decided_at = now(), decided_by = auth.uid() where id = d.id;
  perform public._board_log(m.id, 'board_ai_drafts', d.id, 'AI_DRAFT_APPLIED',
    jsonb_build_object('new_agenda', v_na, 'discussions', v_nd, 'resolutions', v_nr));
  return jsonb_build_object('new_agenda', v_na, 'discussions', v_nd, 'resolutions', v_nr);
end; $$;

revoke all on function public.board_apply_ai_draft(uuid, text, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.board_apply_ai_draft(uuid, text, text, jsonb, jsonb, jsonb) to authenticated, service_role;

alter table public.board_ai_drafts enable row level security;
drop policy if exists p_board_ai_drafts_read on public.board_ai_drafts;
create policy p_board_ai_drafts_read on public.board_ai_drafts for select using (public.has_board_access());
drop policy if exists p_board_ai_drafts_insert on public.board_ai_drafts;
create policy p_board_ai_drafts_insert on public.board_ai_drafts for insert
  with check (public.can_create_board() and source = 'WEB' and created_by = auth.uid() and status = 'PENDING');
drop policy if exists p_board_ai_drafts_update on public.board_ai_drafts;
create policy p_board_ai_drafts_update on public.board_ai_drafts for update
  using (public.can_create_board() and status = 'PENDING') with check (public.can_create_board() and decided_by = auth.uid());

revoke all on public.board_ai_drafts from public, anon;
grant select, insert, update on public.board_ai_drafts to authenticated;
grant select, insert, update, delete on public.board_ai_drafts to service_role;

revoke all on function public.board_member_drafter_profile(uuid) from public, anon, authenticated;
grant execute on function public.board_member_drafter_profile(uuid) to service_role;

insert into public.system_reset_manifest
  (object_name, module, classification, mode_a, mode_b, reason, risk, reset_order, sequence_impact, storage_impact, manifest_version)
values
  ('board_ai_drafts', 'board', 'DELETE', 'DELETE', 'DELETE', 'Assistant suggestions for board minutes (operational)', 'LOW', 17, '-', '-', 1)
on conflict (object_name) do update set
  module = excluded.module, classification = excluded.classification, mode_a = excluded.mode_a, mode_b = excluded.mode_b,
  reason = excluded.reason, risk = excluded.risk, reset_order = excluded.reset_order, sequence_impact = excluded.sequence_impact,
  storage_impact = excluded.storage_impact, manifest_version = excluded.manifest_version;

-- =====================================================================
-- ROLLBACK: drop function board_apply_ai_draft(uuid,text,text,jsonb,jsonb,jsonb); drop function board_member_drafter_profile(uuid);
--   drop table board_ai_drafts; drop function tg_board_ai_draft_guard();
--   delete from system_reset_manifest where object_name = 'board_ai_drafts';
-- =====================================================================

-- =====================================================================
-- NIL Office — 0147_board_functions.sql
-- Board Secretariat — Phase 1 — the approval RPC and the minutes snapshot.
-- board_approve_meeting is the ONLY path DRAFT -> APPROVED (guard trigger + nil.board_approve flag, 0146). It:
--   1. checks the minutes are complete (actual start/end, chair + secretary present, every active member's attendance recorded,
--      at least one agenda item, some discussion text, no action deadline before the meeting day);
--   2. issues the next CONTINUOUS meeting number (advisory lock; baseline = board_settings.last_manual_meeting_number) and the
--      resolution numbers «<meeting>-<n>» in agenda order;
--   3. optionally creates the suggested next meeting as a new DRAFT (never automatic — the UI proposes +14 days, the user decides);
--   4. stores the full snapshot and locks the meeting. The PDF / page of an approved meeting is ALWAYS rendered from the snapshot.
-- System approval is the secretary's approval only — the printed minutes are signed by hand by the members (user decision 2026-10-09).
-- =====================================================================

create or replace function public._board_minutes_snapshot(p_meeting uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'version', 1,
    'meeting', jsonb_build_object(
      'id', m.id, 'number', m.meeting_number, 'type', m.meeting_type, 'scheduled_at', m.scheduled_at, 'location', m.location,
      'started_at', m.started_at, 'ended_at', m.ended_at, 'invitees', m.invitees, 'general_notes', m.general_notes,
      'remaining_topics', m.remaining_topics),
    'chair', (select jsonb_build_object('name', b.full_name, 'title', b.position_title) from public.board_members b where b.id = m.chair_member_id),
    'secretary', (select jsonb_build_object('name', b.full_name, 'title', b.position_title) from public.board_members b where b.id = m.secretary_member_id),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object('member_id', b.id, 'name', b.full_name, 'title', b.position_title, 'kind', b.kind,
                                          'status', a.status, 'note', a.note) order by b.sort_order, b.full_name)
        from public.board_attendance a join public.board_members b on b.id = a.member_id
       where a.meeting_id = m.id), '[]'::jsonb),
    'agenda', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'position', i.position, 'title', i.title, 'discussion', i.discussion)
                       order by i.position, i.created_at)
        from public.board_agenda_items i
       where i.meeting_id = m.id), '[]'::jsonb),
    'resolutions', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'number', r.resolution_number, 'agenda_item_id', r.agenda_item_id, 'text', r.text,
                                          'requires_action', r.requires_action, 'owner_name', o.full_name, 'due_date', r.due_date,
                                          'expected_output', r.expected_output, 'vote_note', r.vote_note)
                       order by ai.position nulls last, r.position, r.created_at)
        from public.board_resolutions r
        left join public.board_agenda_items ai on ai.id = r.agenda_item_id
        left join public.board_members o on o.id = r.owner_member_id
       where r.meeting_id = m.id), '[]'::jsonb),
    -- section «بررسی مصوبات جلسات قبل»: still-open action resolutions of earlier approved meetings, as they stood at approval time
    'previous_followups', coalesce((
      select jsonb_agg(x.obj order by x.mn, x.rn)
        from (select jsonb_build_object('number', r.resolution_number, 'text', r.text, 'owner_name', o.full_name, 'due_date', r.due_date,
                                        'follow_status', r.follow_status) as obj,
                     pm.meeting_number as mn, split_part(r.resolution_number, '-', 2)::integer as rn
                from public.board_resolutions r
                join public.board_meetings pm on pm.id = r.meeting_id
                left join public.board_members o on o.id = r.owner_member_id
               where pm.status = 'APPROVED' and pm.id <> m.id and pm.scheduled_at < m.scheduled_at
                 and r.requires_action and r.follow_status not in ('DONE', 'NO_ACTION')) x), '[]'::jsonb)
  )
  from public.board_meetings m
  where m.id = p_meeting;
$$;

create or replace function public.board_approve_meeting(p_meeting_id uuid, p_next_scheduled_at timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.board_meetings; v_base integer; v_num integer; v_n integer := 0; v_next uuid; v_snap jsonb; v_day date; r record;
begin
  if not public.can_approve_board() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into m from public.board_meetings where id = p_meeting_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if m.status <> 'DRAFT' then raise exception 'BOARD_MEETING_LOCKED' using errcode = '22000'; end if;

  -- completeness
  if m.started_at is null or m.ended_at is null or m.chair_member_id is null or m.secretary_member_id is null then
    raise exception 'BOARD_APPROVE_MISSING_FIELDS' using errcode = '22000';
  end if;
  if not exists (select 1 from public.board_agenda_items i where i.meeting_id = m.id) then
    raise exception 'BOARD_APPROVE_NO_AGENDA' using errcode = '22000';
  end if;
  if coalesce(btrim(m.general_notes), '') = ''
     and not exists (select 1 from public.board_agenda_items i where i.meeting_id = m.id and coalesce(btrim(i.discussion), '') <> '') then
    raise exception 'BOARD_APPROVE_NO_DISCUSSION' using errcode = '22000';
  end if;
  if exists (select 1 from public.board_members b
              where b.is_active and not exists (select 1 from public.board_attendance a where a.meeting_id = m.id and a.member_id = b.id)) then
    raise exception 'BOARD_APPROVE_ATTENDANCE_INCOMPLETE' using errcode = '22000';
  end if;
  if not exists (select 1 from public.board_attendance a where a.meeting_id = m.id and a.member_id = m.chair_member_id and a.status = 'PRESENT')
     or not exists (select 1 from public.board_attendance a where a.meeting_id = m.id and a.member_id = m.secretary_member_id and a.status = 'PRESENT') then
    raise exception 'BOARD_APPROVE_OFFICIALS_ABSENT' using errcode = '22000';
  end if;
  v_day := (m.scheduled_at at time zone 'Asia/Tehran')::date;
  if exists (select 1 from public.board_resolutions r2 where r2.meeting_id = m.id and r2.requires_action and r2.due_date < v_day) then
    raise exception 'BOARD_RESOLUTION_DUE_BEFORE_MEETING' using errcode = '22000';
  end if;
  if p_next_scheduled_at is not null and p_next_scheduled_at <= m.scheduled_at then
    raise exception 'BOARD_NEXT_MEETING_INVALID' using errcode = '22000';
  end if;

  -- continuous numbering
  perform pg_advisory_xact_lock(hashtext('board_meeting_number'));
  select s.last_manual_meeting_number into v_base from public.board_settings s where s.id = 1;
  select greatest(coalesce(max(x.meeting_number), 0), coalesce(v_base, 0)) + 1 into v_num from public.board_meetings x;

  perform set_config('nil.board_approve', 'on', true);
  for r in
    select x.id from public.board_resolutions x
      left join public.board_agenda_items ai on ai.id = x.agenda_item_id
     where x.meeting_id = m.id
     order by ai.position nulls last, x.position, x.created_at
  loop
    v_n := v_n + 1;
    update public.board_resolutions set resolution_number = format('%s-%s', v_num, v_n) where id = r.id;
  end loop;

  if p_next_scheduled_at is not null then
    insert into public.board_meetings (meeting_type, scheduled_at, location, created_by)
    values ('ORDINARY', p_next_scheduled_at, m.location, auth.uid())
    returning id into v_next;
  end if;

  v_snap := jsonb_set(public._board_minutes_snapshot(m.id), '{meeting,number}', to_jsonb(v_num))
            || jsonb_build_object(
                 'approved_at', now(),
                 'approved_by_name', (select p.full_name from public.profiles p where p.id = auth.uid()),
                 'next_meeting', case when v_next is not null then jsonb_build_object('scheduled_at', p_next_scheduled_at, 'location', m.location) end);

  update public.board_meetings
     set status = 'APPROVED', meeting_number = v_num, approved_by = auth.uid(), approved_at = now(), snapshot = v_snap, next_meeting_id = v_next
   where id = m.id;
  perform set_config('nil.board_approve', 'off', true);

  perform public._board_log(m.id, 'board_meetings', m.id, 'MEETING_APPROVED',
    jsonb_build_object('meeting_number', v_num, 'resolutions', v_n, 'next_meeting_id', v_next));
  return jsonb_build_object('meeting_number', v_num, 'resolutions', v_n, 'next_meeting_id', v_next);
end; $$;

do $$
declare f text;
begin
  foreach f in array array['_board_minutes_snapshot(uuid)', '_board_log(uuid,text,uuid,text,jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  execute 'revoke all on function public.board_approve_meeting(uuid,timestamptz) from public, anon';
  execute 'grant execute on function public.board_approve_meeting(uuid,timestamptz) to authenticated, service_role';
end $$;

-- =====================================================================
-- ROLLBACK
-- drop function if exists public.board_approve_meeting(uuid, timestamptz);
-- drop function if exists public._board_minutes_snapshot(uuid);
-- =====================================================================

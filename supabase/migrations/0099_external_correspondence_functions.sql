-- =====================================================================
-- NIL Office — 0099_external_correspondence_functions.sql
-- External Correspondence Telegram Bot — Phase 1 — service layer.
--
-- External-facing functions (granted to service_role ONLY, 0100) each
-- independently re-derive authorization from the telegram_user_id
-- passed in — never a cached session (mirrors trade_get_buyer_view /
-- trade_submit_response / trade_record_document_upload, 0066).
-- Internal-facing functions (granted to authenticated, 0100) are gated
-- by the 0097 role tier and reuse the EXISTING register_incoming RPC
-- unchanged — intake never allocates its own official number.
-- =====================================================================

-- ---------------------------------------------------------------------
-- external_intake_check_rate_limit — shared atomic increment-and-check,
-- called from INSIDE each entry-point function below (never a separate
-- pre-check, to avoid a check-then-use race). Bucketed by minute for
-- short windows, by day when p_window_minutes >= 1440.
-- ---------------------------------------------------------------------
create or replace function public.external_intake_check_rate_limit(
  p_scope text,
  p_key text,
  p_window_minutes int,
  p_max int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_count int;
begin
  v_window := case when p_window_minutes >= 1440 then date_trunc('day', now()) else date_trunc('minute', now()) end;

  insert into public.external_bot_rate_limits (scope, key, window_start, count)
  values (p_scope, p_key, v_window, 1)
  on conflict (scope, key, window_start) do update set count = external_bot_rate_limits.count + 1
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

-- ---------------------------------------------------------------------
-- external_intake_create_and_submit — spec §3-§17, one call covering
-- the whole conversational flow through confirmation. Rate-limited on
-- both telegram_user_id and chat_id (per-minute) plus a per-day
-- submission cap per telegram_user_id (blunts slow-drip spam, spec §50).
--
-- p_intake_id is accepted (not generated internally) because the bot's
-- own conversation flow uploads documents to storage DURING the
-- multi-step form (spec §3's own ordering: upload happens before
-- preview/confirm), before this function ever runs — the TS layer
-- pre-generates the id, uses it as the storage path prefix while
-- staging uploads in external_bot_conversation_state, then passes the
-- SAME id here so external_intake_record_document (called right after,
-- once per staged document) attaches to a row that now really exists.
-- ---------------------------------------------------------------------
create or replace function public.external_intake_create_and_submit(
  p_intake_id uuid,
  p_telegram_user_id bigint,
  p_telegram_chat_id bigint,
  p_sender_type text,
  p_sender_full_name text,
  p_sender_position text,
  p_sender_mobile text,
  p_sender_email text,
  p_sender_org_name_raw text,
  p_subject text,
  p_description text,
  p_tracking_code text
)
returns public.external_intakes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.external_intakes;
begin
  if p_sender_type not in ('INDIVIDUAL','ORGANIZATION') then
    raise exception 'INVALID_SENDER_TYPE' using errcode = '22000';
  end if;
  if p_subject is null or length(btrim(p_subject)) = 0 then
    raise exception 'SUBJECT_REQUIRED' using errcode = '22000';
  end if;

  if not public.external_intake_check_rate_limit('TELEGRAM_USER', p_telegram_user_id::text, 1, 5) then
    raise exception 'RATE_LIMITED' using errcode = '22000';
  end if;
  if not public.external_intake_check_rate_limit('CHAT', p_telegram_chat_id::text, 1, 10) then
    raise exception 'RATE_LIMITED' using errcode = '22000';
  end if;
  if not public.external_intake_check_rate_limit('SUBMISSION', p_telegram_user_id::text, 1440, 20) then
    raise exception 'RATE_LIMITED' using errcode = '22000';
  end if;

  insert into public.external_intakes (
    id, status, sender_type, sender_full_name, sender_position, sender_mobile, sender_email,
    sender_org_name_raw, telegram_user_id, telegram_chat_id, subject, description,
    tracking_code, submitted_at
  ) values (
    p_intake_id, 'PENDING_REVIEW', p_sender_type, p_sender_full_name, p_sender_position, p_sender_mobile, p_sender_email,
    p_sender_org_name_raw, p_telegram_user_id, p_telegram_chat_id, p_subject, p_description,
    p_tracking_code, now()
  )
  returning * into v_row;

  insert into public.external_intake_events (intake_id, event_type, actor_type, actor_telegram_user_id)
  values (v_row.id, 'SUBMISSION_CREATED', 'EXTERNAL_TELEGRAM_USER', p_telegram_user_id);
  insert into public.external_intake_events (intake_id, event_type, actor_type, actor_telegram_user_id)
  values (v_row.id, 'SUBMISSION_SUBMITTED', 'EXTERNAL_TELEGRAM_USER', p_telegram_user_id);

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- external_intake_record_document — ownership-checked (telegram_user_id
-- must match the intake's own sender) before recording a file already
-- uploaded to storage by the caller (validation + storage write happen
-- in TS, lib/external-correspondence/validation.ts — this function only
-- records the already-validated metadata).
-- ---------------------------------------------------------------------
create or replace function public.external_intake_record_document(
  p_intake_id uuid,
  p_telegram_user_id bigint,
  p_document_id uuid,
  p_storage_path text,
  p_file_name_sanitized text,
  p_declared_mime text,
  p_detected_signature text,
  p_size_bytes bigint,
  p_sha256_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intake public.external_intakes;
begin
  select * into v_intake from public.external_intakes where id = p_intake_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_intake.telegram_user_id <> p_telegram_user_id then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if v_intake.status not in ('DRAFT','SUBMITTED','PENDING_REVIEW','NEEDS_INFORMATION') then
    raise exception 'SUBMISSION_NOT_EDITABLE' using errcode = '22000';
  end if;
  if not public.external_intake_check_rate_limit('UPLOAD', p_telegram_user_id::text, 1, 10) then
    raise exception 'RATE_LIMITED' using errcode = '22000';
  end if;

  insert into public.external_intake_documents (
    id, intake_id, storage_path, file_name_sanitized, declared_mime, detected_signature, size_bytes, sha256_hash
  ) values (
    p_document_id, p_intake_id, p_storage_path, p_file_name_sanitized, p_declared_mime, p_detected_signature, p_size_bytes, p_sha256_hash
  );

  insert into public.external_intake_events (intake_id, event_type, actor_type, actor_telegram_user_id, metadata)
  values (p_intake_id, 'FILE_UPLOADED', 'EXTERNAL_TELEGRAM_USER', p_telegram_user_id,
          jsonb_build_object('file_name', p_file_name_sanitized, 'size_bytes', p_size_bytes));
end;
$$;

-- ---------------------------------------------------------------------
-- external_intake_get_my_submissions / external_intake_get_status —
-- deliberately project only PUBLIC-SAFE columns (spec §33) — internal
-- fields (assigned_to, internal_note, company_id, case_id) are
-- structurally absent from the return shape, not merely hidden by the
-- caller. get_status is rate-limited by the REQUESTING telegram_user_id
-- (not by the code itself), since the real threat is one actor
-- enumerating many different codes, not hammering one valid code.
-- ---------------------------------------------------------------------
create or replace function public.external_intake_get_my_submissions(p_telegram_user_id bigint)
returns table (
  id uuid,
  tracking_code text,
  subject text,
  status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select id, tracking_code, subject, status, created_at
  from public.external_intakes
  where telegram_user_id = p_telegram_user_id
  order by created_at desc
  limit 20;
$$;

create or replace function public.external_intake_get_status(p_tracking_code text, p_telegram_user_id bigint)
returns table (
  id uuid,
  tracking_code text,
  subject text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.external_intake_check_rate_limit('TRACKING_LOOKUP', p_telegram_user_id::text, 1, 10) then
    raise exception 'RATE_LIMITED' using errcode = '22000';
  end if;

  return query
  select ei.id, ei.tracking_code, ei.subject, ei.status, ei.created_at
  from public.external_intakes ei
  where ei.tracking_code = p_tracking_code;
end;
$$;

-- ---------------------------------------------------------------------
-- external_intake_add_information — spec §28/§60: never mutates the
-- original description; recorded only as an append-only
-- ADDITIONAL_INFO_RECEIVED event, preserving historical integrity.
-- ---------------------------------------------------------------------
create or replace function public.external_intake_add_information(
  p_tracking_code text,
  p_telegram_user_id bigint,
  p_text text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intake public.external_intakes;
begin
  if not public.external_intake_check_rate_limit('SUBMISSION', p_telegram_user_id::text || ':addinfo', 1, 5) then
    raise exception 'RATE_LIMITED' using errcode = '22000';
  end if;

  select * into v_intake from public.external_intakes where tracking_code = p_tracking_code for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_intake.telegram_user_id <> p_telegram_user_id then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if v_intake.status not in ('PENDING_REVIEW','NEEDS_INFORMATION','UNDER_REVIEW') then
    raise exception 'SUBMISSION_NOT_EDITABLE' using errcode = '22000';
  end if;

  if v_intake.status = 'NEEDS_INFORMATION' then
    update public.external_intakes set status = 'PENDING_REVIEW', updated_at = now() where id = v_intake.id;
  end if;

  insert into public.external_intake_events (intake_id, event_type, actor_type, actor_telegram_user_id, metadata)
  values (v_intake.id, 'ADDITIONAL_INFO_RECEIVED', 'EXTERNAL_TELEGRAM_USER', p_telegram_user_id, jsonb_build_object('text', p_text));
end;
$$;

-- =======================================================================
-- Internal-facing functions — granted to `authenticated`, gated by the
-- 0097 role tier. auth.uid() here is the REAL internal reviewer (these
-- run under the caller's own authenticated web session, never
-- service_role), so register_incoming()'s own is_active_user() check
-- and its write_log() attribution both work correctly unchanged.
-- =======================================================================

-- ---------------------------------------------------------------------
-- external_intake_accept_and_register — spec §21/§22/§52. The only
-- function that ever creates a real correspondence row from an intake.
-- Idempotency: official_correspondence_id already set is a hard error,
-- never a second number — the `for update` lock makes a retried/
-- concurrent double-call safe.
-- ---------------------------------------------------------------------
create or replace function public.external_intake_accept_and_register(
  p_intake_id uuid,
  p_draft_text_html text,
  p_company_id uuid default null,
  p_case_id uuid default null,
  p_assigned_to uuid default null
)
returns public.correspondence
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intake public.external_intakes;
  v_corr   public.correspondence;
  v_sender_name text;
begin
  if not public.can_approve_external_correspondence() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_intake from public.external_intakes where id = p_intake_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_intake.official_correspondence_id is not null then
    raise exception 'ALREADY_REGISTERED' using errcode = '22000';
  end if;
  if v_intake.status not in ('PENDING_REVIEW','UNDER_REVIEW') then
    raise exception 'NOT_ELIGIBLE_FOR_REGISTRATION' using errcode = '22000';
  end if;
  if v_intake.subject is null or length(btrim(v_intake.subject)) = 0 then
    raise exception 'SUBJECT_REQUIRED' using errcode = '22000';
  end if;

  v_sender_name := coalesce(
    nullif(btrim(v_intake.sender_org_name_raw), ''),
    nullif(btrim(v_intake.sender_full_name), ''),
    'نامشخص'
  );

  insert into public.correspondence (
    direction, subject, recipient_name, sender_company_id, case_id, assigned_to,
    draft_text, status, created_by
  ) values (
    'INCOMING', v_intake.subject, v_sender_name,
    coalesce(p_company_id, v_intake.company_id), coalesce(p_case_id, v_intake.case_id), coalesce(p_assigned_to, v_intake.assigned_to),
    p_draft_text_html, 'DRAFT', auth.uid()
  )
  returning * into v_corr;

  v_corr := public.register_incoming(v_corr.id);

  update public.external_intakes
     set status = 'REGISTERED',
         official_correspondence_id = v_corr.id,
         company_id   = coalesce(p_company_id, company_id),
         case_id      = coalesce(p_case_id, case_id),
         assigned_to  = coalesce(p_assigned_to, assigned_to),
         registered_at = now(),
         reviewed_at   = coalesce(reviewed_at, now()),
         updated_at    = now()
   where id = p_intake_id;

  insert into public.external_intake_events (intake_id, event_type, actor_type, actor_profile_id, metadata)
  values (p_intake_id, 'OFFICIAL_CORRESPONDENCE_REGISTERED', 'INTERNAL_USER', auth.uid(),
          jsonb_build_object('correspondence_id', v_corr.id, 'display_number', v_corr.display_number));

  if p_company_id is not null then
    insert into public.external_intake_events (intake_id, event_type, actor_type, actor_profile_id, metadata)
    values (p_intake_id, 'COMPANY_LINKED', 'INTERNAL_USER', auth.uid(), jsonb_build_object('company_id', p_company_id));
  end if;
  if p_case_id is not null then
    insert into public.external_intake_events (intake_id, event_type, actor_type, actor_profile_id, metadata)
    values (p_intake_id, 'CASE_LINKED', 'INTERNAL_USER', auth.uid(), jsonb_build_object('case_id', p_case_id));
  end if;

  return v_corr;
end;
$$;

create or replace function public.external_intake_reject(
  p_intake_id uuid,
  p_internal_reason text,
  p_public_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intake public.external_intakes;
begin
  if not public.can_approve_external_correspondence() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_intake from public.external_intakes where id = p_intake_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_intake.official_correspondence_id is not null then
    raise exception 'ALREADY_REGISTERED' using errcode = '22000';
  end if;

  update public.external_intakes
     set status = 'REJECTED',
         internal_note = p_internal_reason,
         public_reject_reason = p_public_reason,
         reviewed_at = coalesce(reviewed_at, now()),
         updated_at = now()
   where id = p_intake_id;

  insert into public.external_intake_events (intake_id, event_type, actor_type, actor_profile_id, metadata)
  values (p_intake_id, 'REJECTED', 'INTERNAL_USER', auth.uid(), jsonb_build_object('public_reason', p_public_reason));
end;
$$;

create or replace function public.external_intake_request_information(
  p_intake_id uuid,
  p_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intake public.external_intakes;
begin
  if not public.can_review_external_correspondence() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_intake from public.external_intakes where id = p_intake_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_intake.official_correspondence_id is not null then
    raise exception 'ALREADY_REGISTERED' using errcode = '22000';
  end if;

  update public.external_intakes
     set status = 'NEEDS_INFORMATION',
         reviewed_at = coalesce(reviewed_at, now()),
         updated_at = now()
   where id = p_intake_id;

  insert into public.external_intake_events (intake_id, event_type, actor_type, actor_profile_id, metadata)
  values (p_intake_id, 'NEEDS_INFORMATION', 'INTERNAL_USER', auth.uid(), jsonb_build_object('message', p_message));
end;
$$;

create or replace function public.external_intake_assign(
  p_intake_id uuid,
  p_assigned_to uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_review_external_correspondence() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.external_intakes where id = p_intake_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.external_intakes set assigned_to = p_assigned_to, updated_at = now() where id = p_intake_id;

  insert into public.external_intake_events (intake_id, event_type, actor_type, actor_profile_id, metadata)
  values (p_intake_id, 'ASSIGNED', 'INTERNAL_USER', auth.uid(), jsonb_build_object('assigned_to', p_assigned_to));
end;
$$;

create or replace function public.external_intake_link_company(
  p_intake_id uuid,
  p_company_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_review_external_correspondence() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.external_intakes where id = p_intake_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.external_intakes set company_id = p_company_id, updated_at = now() where id = p_intake_id;

  insert into public.external_intake_events (intake_id, event_type, actor_type, actor_profile_id, metadata)
  values (p_intake_id, 'COMPANY_LINKED', 'INTERNAL_USER', auth.uid(), jsonb_build_object('company_id', p_company_id));
end;
$$;

create or replace function public.external_intake_link_case(
  p_intake_id uuid,
  p_case_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_review_external_correspondence() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.external_intakes where id = p_intake_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.external_intakes set case_id = p_case_id, updated_at = now() where id = p_intake_id;

  insert into public.external_intake_events (intake_id, event_type, actor_type, actor_profile_id, metadata)
  values (p_intake_id, 'CASE_LINKED', 'INTERNAL_USER', auth.uid(), jsonb_build_object('case_id', p_case_id));
end;
$$;

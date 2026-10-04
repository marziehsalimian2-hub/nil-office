-- =====================================================================
-- NIL Office — 0133_assistant_hardening.sql
-- Internal Assistant v1.0 — Slice 1, part 1 (security hardening).
--
--  * assistant_pending_actions becomes tamper-proof: once a proposal is created,
--    only status / resolved_at may change, and only out of PENDING (trigger fires for
--    every role, including service_role). The payload/hash/owner/preview/expiry can no
--    longer be rewritten through PostgREST by the owner of the row.
--  * assistant_audit(): one audit row per assistant security event (proposed / denied /
--    tampered / expired / file / voice / rate-limited ...). Attributed to the acting
--    profile explicitly because auth.uid() is NULL over the Telegram (service_role) path.
--    Metadata is codes/ids/counts only — never payloads, never salary, never user text.
--  * assistant_usage + assistant_record_usage()/assistant_usage_today(): token / voice
--    accounting for the daily cost cap. The table has NO grant for authenticated
--    (function-only access); service_role is granted explicitly (0072/0096 gotcha:
--    a blanket grant is not retroactive).
--  * activity_logs.p_logs_read: restated from its CURRENT body (0132, verified by grep —
--    no later migration touches it) + entity type 'assistant' -> ADMIN only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Pending actions: immutability guard
-- ---------------------------------------------------------------------
create or replace function public.tg_assistant_pending_guard()
returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.action_name is distinct from old.action_name
     or new.payload is distinct from old.payload
     or new.payload_hash is distinct from old.payload_hash
     or new.preview_text is distinct from old.preview_text
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'ASSISTANT_PENDING_IMMUTABLE' using errcode = '42501';
  end if;
  if old.status <> 'PENDING' and new.status is distinct from old.status then
    raise exception 'ASSISTANT_PENDING_FINAL' using errcode = '42501';
  end if;
  return new;
end; $$;

drop trigger if exists trg_assistant_pending_guard on public.assistant_pending_actions;
create trigger trg_assistant_pending_guard
  before update on public.assistant_pending_actions
  for each row execute function public.tg_assistant_pending_guard();

-- A forged INSERT can only ever be a PENDING row; the app additionally HMACs the payload
-- (a user cannot compute the HMAC), so a hand-crafted row fails verification at confirm time.
create or replace function public.tg_assistant_pending_insert_guard()
returns trigger language plpgsql as $$
begin
  -- (an invalid status value is left to the table's own CHECK constraint)
  if new.status in ('CONFIRMED','CANCELLED','EXPIRED','SUPERSEDED') or new.resolved_at is not null then
    raise exception 'ASSISTANT_PENDING_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end; $$;

drop trigger if exists trg_assistant_pending_insert_guard on public.assistant_pending_actions;
create trigger trg_assistant_pending_insert_guard
  before insert on public.assistant_pending_actions
  for each row execute function public.tg_assistant_pending_insert_guard();

-- ---------------------------------------------------------------------
-- 2) Audit
-- ---------------------------------------------------------------------
create or replace function public.assistant_audit(
  p_user_id uuid, p_event text, p_action text default null, p_meta jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare v_meta jsonb := coalesce(p_meta, '{}'::jsonb);
begin
  -- Caller: the Telegram path (service_role) may attribute to any profile; a web session only to itself.
  if not (auth.role() = 'service_role' or (p_user_id is not null and p_user_id = auth.uid())) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_event is null or p_event !~ '^[A-Z_]{3,40}$' then
    raise exception 'ASSISTANT_AUDIT_INVALID_EVENT' using errcode = '22023';
  end if;
  if p_action is not null and p_action !~ '^[A-Z_]{1,60}$' then
    raise exception 'ASSISTANT_AUDIT_INVALID_EVENT' using errcode = '22023';
  end if;
  if octet_length(v_meta::text) > 2000 then
    v_meta := jsonb_build_object('truncated', true);
  end if;

  -- Flood control: anyone on Telegram can message the bot, so these two are written at most once a minute.
  if p_event = 'UNAUTHORIZED_TELEGRAM' and exists (
       select 1 from public.activity_logs
        where entity_type = 'assistant' and action = p_event and created_at > now() - interval '1 minute') then
    return;
  end if;
  if p_event = 'RATE_LIMITED' and exists (
       select 1 from public.activity_logs
        where entity_type = 'assistant' and action = p_event and user_id is not distinct from p_user_id
          and created_at > now() - interval '1 minute') then
    return;
  end if;

  insert into public.activity_logs (user_id, entity_type, entity_id, action, new_value)
  values (p_user_id, 'assistant', null, p_event, jsonb_build_object('action', p_action, 'meta', v_meta));
end; $$;

-- ---------------------------------------------------------------------
-- 3) Usage / cost accounting
-- ---------------------------------------------------------------------
create table if not exists public.assistant_usage (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  channel    text not null check (channel in ('TELEGRAM','WEB')),
  kind       text not null check (kind in ('LLM','STT','VISION')),
  units_in   integer not null default 0 check (units_in >= 0),   -- LLM: input tokens; STT: audio seconds
  units_out  integer not null default 0 check (units_out >= 0),  -- LLM: output tokens
  ms         integer not null default 0 check (ms >= 0),
  created_at timestamptz not null default now()
);
create index if not exists idx_assistant_usage_user_day on public.assistant_usage (user_id, kind, created_at desc);

alter table public.assistant_usage enable row level security;   -- no policy, no authenticated grant: function-only access
grant select, insert, update, delete on public.assistant_usage to service_role;

create or replace function public.assistant_record_usage(
  p_user_id uuid, p_channel text, p_kind text, p_units_in integer, p_units_out integer, p_ms integer
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (auth.role() = 'service_role' or (p_user_id is not null and p_user_id = auth.uid())) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  insert into public.assistant_usage (user_id, channel, kind, units_in, units_out, ms)
  values (p_user_id, p_channel, p_kind, greatest(coalesce(p_units_in, 0), 0), greatest(coalesce(p_units_out, 0), 0), greatest(coalesce(p_ms, 0), 0));
end; $$;

-- Today = the Tehran calendar day (the office's day), not UTC.
create or replace function public.assistant_usage_today(p_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Tehran')::date; v_out jsonb;
begin
  if not (auth.role() = 'service_role' or (p_user_id is not null and p_user_id = auth.uid())) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'llm_tokens', coalesce(sum(units_in + units_out) filter (where kind = 'LLM'), 0),
           'stt_seconds', coalesce(sum(units_in) filter (where kind = 'STT'), 0),
           'stt_last_minute', count(*) filter (where kind = 'STT' and created_at > now() - interval '1 minute'))
    into v_out
    from public.assistant_usage
   where user_id = p_user_id and (created_at at time zone 'Asia/Tehran')::date = v_today;
  return v_out;
end; $$;

revoke all on function public.assistant_audit(uuid, text, text, jsonb) from public;
revoke all on function public.assistant_record_usage(uuid, text, text, integer, integer, integer) from public;
revoke all on function public.assistant_usage_today(uuid) from public;
grant execute on function public.assistant_audit(uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.assistant_record_usage(uuid, text, text, integer, integer, integer) to authenticated, service_role;
grant execute on function public.assistant_usage_today(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4) activity_logs: CURRENT body (0132, verified by grep) + 'assistant' -> ADMIN only.
-- ---------------------------------------------------------------------
drop policy if exists p_logs_read on public.activity_logs;
create policy p_logs_read on public.activity_logs for select using (
  public.is_active_user()
  and (entity_type not in ('personnel', 'employment_records', 'hr_reports') or public.has_hr_access())
  and (entity_type not in ('salary_components','salary_component_versions','compensation_profiles',
                           'compensation_lines','legal_rule_sets','legal_rule_entries',
                           'payroll_periods','payroll_batches','payroll_eligibility_overrides','payroll_work_data',
                           'payroll_work_inputs','payroll_calculations','payroll_results','payroll_result_lines',
                           'payroll_calc_warnings','payroll_accounting_settings','payroll_component_accounts',
                           'payroll_payments','payroll_payslips','payroll_reports') or public.has_payroll_access())
  and (entity_type <> 'personnel_payment_destinations' or public.can_view_payroll_bank_details())
  and (entity_type not in ('journal_entries','journal_entry_lines','journal_entry',
                           'payments','payment','receipts','receipt') or public.has_accounting_access())
  and (entity_type <> 'assistant' or public.is_admin())
);

-- =====================================================================
-- ROLLBACK: drop trigger trg_assistant_pending_guard / trg_assistant_pending_insert_guard on public.assistant_pending_actions;
--   drop function public.tg_assistant_pending_guard(), public.tg_assistant_pending_insert_guard(),
--     public.assistant_audit(uuid,text,text,jsonb), public.assistant_record_usage(uuid,text,text,integer,integer,integer),
--     public.assistant_usage_today(uuid); drop table public.assistant_usage;
--   re-run 0132's p_logs_read block to drop the 'assistant' line.
-- =====================================================================

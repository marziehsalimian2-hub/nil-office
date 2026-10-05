-- =====================================================================
-- NIL Office — 0021_contract_functions.sql
--
-- Contract Management, Phase 1: permission helpers, the numbering RPC
-- (approve_contract) and the rest of the status-transition RPCs, the
-- state-machine guard trigger, and wiring contracts into the generic
-- touch/audit triggers (the accounting tables were never wired into
-- these loops — a real gap found and flagged separately; contracts get
-- it right from the start).
-- =====================================================================

-- ---- permission helpers (mirrors has_accounting_access / can_create_accounting / is_accounting_admin) ----
create or replace function public.can_view_contracts() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or contract_role is not null)
  );
$$;

create or replace function public.can_create_contracts() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or contract_role in ('CREATE','EDIT','APPROVE','ADMIN'))
  );
$$;

create or replace function public.can_edit_contracts() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or contract_role in ('EDIT','APPROVE','ADMIN'))
  );
$$;

create or replace function public.can_approve_contracts() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or contract_role in ('APPROVE','ADMIN'))
  );
$$;

create or replace function public.is_contract_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
      and (role = 'ADMIN' or contract_role = 'ADMIN')
  );
$$;

-- ---- numbering: allocate the official CTR-1405-0001 number on approval ----
create or replace function public.approve_contract(p_contract_id uuid, p_year int default null)
returns public.contracts
language plpgsql security definer set search_path = public as $$
declare
  v_row  public.contracts;
  v_year int;
  v_seq  int;
  v_disp text;
begin
  if not public.can_approve_contracts() then
    raise exception 'CONTRACT_NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_row from public.contracts where id = p_contract_id for update;
  if not found then raise exception 'CONTRACT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.is_historical then raise exception 'CONTRACT_HISTORICAL_NO_NUMBER' using errcode = '22000'; end if;
  if v_row.sequence_number is not null then raise exception 'CONTRACT_NUMBER_ISSUED' using errcode = '22000'; end if;
  if v_row.status <> 'UNDER_REVIEW' then raise exception 'CONTRACT_NOT_APPROVABLE' using errcode = '22000'; end if;
  if v_row.title is null or length(btrim(v_row.title)) = 0 then
    raise exception 'CONTRACT_TITLE_REQUIRED' using errcode = '22000';
  end if;

  v_year := coalesce(p_year, public.jalali_year(now()));
  if v_year < 1300 or v_year > 1600 then raise exception 'INVALID_YEAR' using errcode = '22000'; end if;

  v_seq  := public.allocate_sequence('CONTRACT', v_year);
  v_disp := public.format_display_number('CTR', v_year, v_seq); -- => CTR-1405-0001

  update public.contracts
     set sequence_number = v_seq,
         display_number  = v_disp,
         year            = v_year,
         status          = 'APPROVED',
         finalized_at    = now(),
         updated_at      = now()
   where id = p_contract_id
   returning * into v_row;

  perform public.write_log('contracts', p_contract_id, 'APPROVED',
    jsonb_build_object('status', 'UNDER_REVIEW'),
    jsonb_build_object('status', 'APPROVED', 'display_number', v_disp, 'sequence_number', v_seq, 'year', v_year));

  return v_row;
end;
$$;

-- ---- remaining lifecycle transitions ----
create or replace function public.activate_contract(p_contract_id uuid)
returns public.contracts
language plpgsql security definer set search_path = public as $$
declare v_row public.contracts;
begin
  if not public.can_edit_contracts() then raise exception 'CONTRACT_NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_row from public.contracts where id = p_contract_id for update;
  if not found then raise exception 'CONTRACT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status <> 'APPROVED' then raise exception 'CONTRACT_STATUS_LOCKED' using errcode = '22000'; end if;

  update public.contracts set status = 'ACTIVE', activated_at = now(), updated_at = now()
   where id = p_contract_id returning * into v_row;

  perform public.write_log('contracts', p_contract_id, 'ACTIVATED', null, jsonb_build_object('status', 'ACTIVE'));
  return v_row;
end;
$$;

create or replace function public.suspend_contract(p_contract_id uuid)
returns public.contracts
language plpgsql security definer set search_path = public as $$
declare v_row public.contracts;
begin
  if not public.can_edit_contracts() then raise exception 'CONTRACT_NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_row from public.contracts where id = p_contract_id for update;
  if not found then raise exception 'CONTRACT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status <> 'ACTIVE' then raise exception 'CONTRACT_STATUS_LOCKED' using errcode = '22000'; end if;

  update public.contracts set status = 'SUSPENDED', updated_at = now()
   where id = p_contract_id returning * into v_row;

  perform public.write_log('contracts', p_contract_id, 'SUSPENDED', null, jsonb_build_object('status', 'SUSPENDED'));
  return v_row;
end;
$$;

create or replace function public.resume_contract(p_contract_id uuid)
returns public.contracts
language plpgsql security definer set search_path = public as $$
declare v_row public.contracts;
begin
  if not public.can_edit_contracts() then raise exception 'CONTRACT_NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_row from public.contracts where id = p_contract_id for update;
  if not found then raise exception 'CONTRACT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status <> 'SUSPENDED' then raise exception 'CONTRACT_STATUS_LOCKED' using errcode = '22000'; end if;

  update public.contracts set status = 'ACTIVE', updated_at = now()
   where id = p_contract_id returning * into v_row;

  perform public.write_log('contracts', p_contract_id, 'RESUMED', null, jsonb_build_object('status', 'ACTIVE'));
  return v_row;
end;
$$;

create or replace function public.complete_contract(p_contract_id uuid)
returns public.contracts
language plpgsql security definer set search_path = public as $$
declare v_row public.contracts;
begin
  if not public.can_edit_contracts() then raise exception 'CONTRACT_NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_row from public.contracts where id = p_contract_id for update;
  if not found then raise exception 'CONTRACT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status <> 'ACTIVE' then raise exception 'CONTRACT_STATUS_LOCKED' using errcode = '22000'; end if;

  update public.contracts set status = 'COMPLETED', completed_at = now(), updated_at = now()
   where id = p_contract_id returning * into v_row;

  perform public.write_log('contracts', p_contract_id, 'COMPLETED', null, jsonb_build_object('status', 'COMPLETED'));
  return v_row;
end;
$$;

create or replace function public.terminate_contract(p_contract_id uuid, p_reason text default null)
returns public.contracts
language plpgsql security definer set search_path = public as $$
declare v_row public.contracts;
begin
  if not public.can_edit_contracts() then raise exception 'CONTRACT_NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_row from public.contracts where id = p_contract_id for update;
  if not found then raise exception 'CONTRACT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status not in ('ACTIVE','SUSPENDED') then raise exception 'CONTRACT_STATUS_LOCKED' using errcode = '22000'; end if;

  update public.contracts
     set status = 'TERMINATED',
         terminated_at = now(),
         updated_at = now(),
         internal_notes = case
           when p_reason is null or btrim(p_reason) = '' then internal_notes
           when internal_notes is null or btrim(internal_notes) = '' then 'فسخ: ' || p_reason
           else internal_notes || E'\n' || 'فسخ: ' || p_reason
         end
   where id = p_contract_id
   returning * into v_row;

  perform public.write_log('contracts', p_contract_id, 'TERMINATED',
    null, jsonb_build_object('status', 'TERMINATED', 'reason', p_reason));
  return v_row;
end;
$$;

create or replace function public.cancel_contract(p_contract_id uuid, p_reason text default null)
returns public.contracts
language plpgsql security definer set search_path = public as $$
declare v_row public.contracts;
begin
  if not public.can_edit_contracts() then raise exception 'CONTRACT_NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_row from public.contracts where id = p_contract_id for update;
  if not found then raise exception 'CONTRACT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status not in ('DRAFT','UNDER_REVIEW','APPROVED') then
    raise exception 'CONTRACT_STATUS_LOCKED' using errcode = '22000';
  end if;

  update public.contracts
     set status = 'CANCELLED',
         updated_at = now(),
         internal_notes = case
           when p_reason is null or btrim(p_reason) = '' then internal_notes
           when internal_notes is null or btrim(internal_notes) = '' then 'ابطال: ' || p_reason
           else internal_notes || E'\n' || 'ابطال: ' || p_reason
         end
   where id = p_contract_id
   returning * into v_row;

  perform public.write_log('contracts', p_contract_id, 'CANCELLED',
    null, jsonb_build_object('status', 'CANCELLED', 'reason', p_reason));
  return v_row;
end;
$$;

-- ---- state-machine + immutability guard (mirrors tg_correspondence_status) ----
create or replace function public.tg_contract_status()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if not (
      (old.status = 'DRAFT'        and new.status in ('UNDER_REVIEW','CANCELLED')) or
      (old.status = 'UNDER_REVIEW' and new.status in ('DRAFT','APPROVED','CANCELLED')) or
      (old.status = 'APPROVED'     and new.status in ('ACTIVE','CANCELLED')) or
      (old.status = 'ACTIVE'       and new.status in ('SUSPENDED','COMPLETED','EXPIRED','TERMINATED')) or
      (old.status = 'SUSPENDED'    and new.status in ('ACTIVE','TERMINATED'))
    ) then
      raise exception 'CONTRACT_STATUS_LOCKED' using errcode = '22000';
    end if;
    if new.status = 'APPROVED' and new.sequence_number is null then
      raise exception 'CONTRACT_APPROVE_RPC_ONLY' using errcode = '22000';
    end if;
  end if;

  if old.sequence_number is not null and new.sequence_number is distinct from old.sequence_number then
    raise exception 'SEQUENCE_NUMBER_IMMUTABLE' using errcode = '22000';
  end if;
  if old.display_number is not null and new.display_number is distinct from old.display_number then
    raise exception 'CONTRACT_NUMBER_LOCKED' using errcode = '22000';
  end if;

  if old.status not in ('DRAFT','UNDER_REVIEW') and tg_op = 'UPDATE' then
    if new.total_amount is distinct from old.total_amount
       or new.base_amount is distinct from old.base_amount
       or new.party_company_id is distinct from old.party_company_id then
      raise exception 'CONTRACT_FIELDS_LOCKED' using errcode = '22000';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_contract_status on public.contracts;
create trigger trg_contract_status before update on public.contracts
  for each row execute function public.tg_contract_status();

-- ---- wire into the generic touch/audit triggers (0003_functions.sql) ----
do $$ declare t text; begin
  foreach t in array array['contracts','contract_types'] loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s;', t);
    execute format('create trigger trg_touch_%1$s before update on public.%1$s for each row execute function public.tg_touch_updated_at();', t);
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$s;', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.tg_audit();', t);
  end loop;
end $$;

-- ---- allow the admin sequence-seeding RPC to accept the new scope ----
create or replace function public.init_number_sequence(p_scope text, p_year int, p_last_value int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_scope not in ('OUTGOING','INCOMING','CASE','CONTRACT') then
    raise exception 'INVALID_SCOPE' using errcode = '22000';
  end if;
  if p_year is null or p_year < 1300 or p_year > 1600 then raise exception 'INVALID_YEAR' using errcode = '22000'; end if;
  if p_last_value is null or p_last_value < 0 then raise exception 'INVALID_VALUE' using errcode = '22000'; end if;
  insert into public.number_sequences (scope, year, last_value) values (p_scope, p_year, p_last_value)
  on conflict (scope, year) do update set last_value = excluded.last_value, updated_at = now();
  perform public.write_log('number_sequences', null, 'INIT_SEQUENCE', null,
    jsonb_build_object('scope', p_scope, 'year', p_year, 'last_value', p_last_value));
end;
$$;

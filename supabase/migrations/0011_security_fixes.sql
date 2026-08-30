-- =====================================================================
-- 0011_security_fixes.sql
-- Blocking security corrections applied after code review.
-- Each block is idempotent and safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- FIX 1 — init_number_sequence RPC (was called by the app + documented,
-- but never defined). ADMIN-only, validated, atomic upsert, audited.
-- ---------------------------------------------------------------------
create or replace function public.init_number_sequence(
  p_scope      text,
  p_year       int,
  p_last_value int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Authorisation is enforced INSIDE the function: only ADMIN may run it,
  -- even though EXECUTE is granted to authenticated (see grants below).
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_scope not in ('OUTGOING','INCOMING','CASE') then
    raise exception 'INVALID_SCOPE' using errcode = '22000';
  end if;
  if p_year is null or p_year < 1300 or p_year > 1600 then
    raise exception 'INVALID_YEAR' using errcode = '22000';
  end if;
  if p_last_value is null or p_last_value < 0 then
    raise exception 'INVALID_VALUE' using errcode = '22000';
  end if;

  insert into public.number_sequences (scope, year, last_value)
  values (p_scope, p_year, p_last_value)
  on conflict (scope, year)
  do update set last_value = excluded.last_value,
                updated_at = now();

  perform public.write_log(
    'number_sequences', null, 'INIT_SEQUENCE',
    null,
    jsonb_build_object('scope', p_scope, 'year', p_year, 'last_value', p_last_value)
  );
end;
$$;

revoke execute on function public.init_number_sequence(text, int, int) from public, anon;
grant  execute on function public.init_number_sequence(text, int, int) to authenticated;

-- ---------------------------------------------------------------------
-- FIX 2 — write_log must be an internal trusted function only.
-- It is SECURITY DEFINER, so the SECURITY DEFINER callers (RPCs, audit
-- trigger) keep working as the owner; direct calls by users are blocked
-- so audit events cannot be forged.
-- ---------------------------------------------------------------------
revoke execute on function public.write_log(text, uuid, text, jsonb, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- FIX 3 — self-service profile update must also freeze is_active
-- (in addition to role and accounting_role). An inactive user must not
-- be able to reactivate themselves; nobody may self-escalate privileges.
-- ---------------------------------------------------------------------
drop policy if exists p_profiles_update_self on public.profiles;
create policy p_profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and role             =              (select role             from public.profiles where id = auth.uid())
    and accounting_role  is not distinct from (select accounting_role from public.profiles where id = auth.uid())
    and is_active        =              (select is_active        from public.profiles where id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- FIX 4 — storage delete must not let a generic active user remove any
-- object just by knowing its path. Restrict delete/update on nil-files
-- to the object's uploader (owner) or an ADMIN. (The server action also
-- resolves the storage_path from the DB row, never from client input.)
-- ---------------------------------------------------------------------
drop policy if exists p_storage_delete on storage.objects;
create policy p_storage_delete on storage.objects
  for delete using (
    bucket_id = 'nil-files'
    and (owner = auth.uid() or public.is_admin())
  );

drop policy if exists p_storage_update on storage.objects;
create policy p_storage_update on storage.objects
  for update using (
    bucket_id = 'nil-files'
    and (owner = auth.uid() or public.is_admin())
  );

-- Attachment metadata rows: only the uploader or an ADMIN may delete.
drop policy if exists p_attach_delete on public.attachments;
create policy p_attach_delete on public.attachments
  for delete using (uploaded_by = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- FIX 7 — correspondence status transitions enforced database-side.
-- A direct/malicious UPDATE that skips the workflow is rejected, not
-- just hidden UI buttons.
--   DRAFT             -> REVIEW | CANCELLED
--   REVIEW            -> DRAFT  | CANCELLED         (FINALIZED via RPC only)
--   FINALIZED         -> SENT   | CANCELLED
--   SENT              -> WAITING_RESPONSE | CLOSED | CANCELLED
--   WAITING_RESPONSE  -> RESPONSE_RECEIVED | CLOSED | CANCELLED
--   RESPONSE_RECEIVED -> CLOSED | CANCELLED
--   CLOSED / CANCELLED-> terminal
-- FINALIZED is reachable only when a sequence number is first assigned,
-- i.e. through finalize_correspondence / register_incoming.
-- CANCELLED is permitted from any non-terminal state so that
-- cancel_correspondence keeps working; every other edge follows the map.
-- ---------------------------------------------------------------------
create or replace function public.tg_correspondence_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'FINALIZED' then
      if old.sequence_number is null and new.sequence_number is not null then
        return new; -- legitimate numbering by the RPC
      end if;
      raise exception 'USE_RPC_TO_FINALIZE' using errcode = '22000';
    end if;

    if not (
      (old.status = 'DRAFT'             and new.status in ('REVIEW','CANCELLED')) or
      (old.status = 'REVIEW'            and new.status in ('DRAFT','CANCELLED')) or
      (old.status = 'FINALIZED'         and new.status in ('SENT','CANCELLED')) or
      (old.status = 'SENT'              and new.status in ('WAITING_RESPONSE','CLOSED','CANCELLED')) or
      (old.status = 'WAITING_RESPONSE'  and new.status in ('RESPONSE_RECEIVED','CLOSED','CANCELLED')) or
      (old.status = 'RESPONSE_RECEIVED' and new.status in ('CLOSED','CANCELLED'))
    ) then
      raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_correspondence_status on public.correspondence;
create trigger trg_correspondence_status
  before update on public.correspondence
  for each row execute function public.tg_correspondence_status();

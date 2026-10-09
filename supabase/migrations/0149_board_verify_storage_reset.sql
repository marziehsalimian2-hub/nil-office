-- =====================================================================
-- NIL Office — 0149_board_verify_storage_reset.sql
-- Board Secretariat — Phase 1 — integration with NIL Verify (0143), Storage and Factory Reset (0141).
--
-- 1) NIL Verify: new document type BOARD_MINUTES (approved minutes). The core is generic (0143 header): one gate branch + one snapshot
--    branch. Restated from their CURRENT bodies (0143 only — verified by grep): _verify_require_issuer, _verify_require_reader,
--    _verify_snapshot, verify_list_active. PUBLIC DISCLOSURE for board minutes is minimal on purpose: meeting number + meeting date.
--    Never members, agenda, discussion or resolutions.
-- 2) Storage: before this file, every active user could read any object under `verified/` (fine for letters/invoices/contracts,
--    NOT for board minutes). Objects registered as BOARD_MINUTES verifications now need board access. The generic attachment prefix `board_meeting/` (app/actions/attachments.ts: <entity>/<id>/...) is
--    restricted the same way (Phase 2: signed scans). storage.objects policies RESTATED from their CURRENT bodies (0135, verified by grep).
-- 3) Factory Reset: every new table classified (the vitest manifest guard fails otherwise); `board_meeting/` = DELETE storage prefix.
-- Everything that UPDATEs/DELETEs has a WHERE (Supabase pg-safeupdate, lesson of 0142).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1a) allow the new type in both CHECK constraints (dropped by definition, not by guessed name)
-- ---------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select con.conname, con.conrelid::regclass::text as tbl
      from pg_constraint con
     where con.conrelid in ('public.verification_doc_types'::regclass, 'public.document_verifications'::regclass)
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%OUTGOING_CORRESPONDENCE%'
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;

alter table public.verification_doc_types add constraint ck_verification_doc_types_type
  check (document_type in ('OUTGOING_CORRESPONDENCE', 'PROFORMA', 'INVOICE', 'CONTRACT', 'BOARD_MINUTES'));
alter table public.document_verifications add constraint ck_document_verifications_type
  check (document_type in ('OUTGOING_CORRESPONDENCE', 'PROFORMA', 'INVOICE', 'CONTRACT', 'BOARD_MINUTES'));

-- plate sits bottom-left, beside the centred page footer of the minutes renderer (lib/pdf/renderBoardMinutesPdf.ts)
insert into public.verification_doc_types (document_type, x_mm, y_mm, size_mm)
values ('BOARD_MINUTES', 14, 9, 20)
on conflict (document_type) do nothing;

-- ---------------------------------------------------------------------
-- 1b) gates + snapshot (CURRENT bodies from 0143 + the BOARD_MINUTES branch)
-- ---------------------------------------------------------------------
create or replace function public._verify_require_issuer(p_type text)
returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_type = 'OUTGOING_CORRESPONDENCE' then
    if not public.is_active_user() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  elsif p_type in ('PROFORMA', 'INVOICE') then
    if not public.can_approve_invoice() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  elsif p_type = 'CONTRACT' then
    if not public.can_approve_contract() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  elsif p_type = 'BOARD_MINUTES' then
    if not public.can_approve_board() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  else
    raise exception 'VERIFY_INVALID' using errcode = '22000';
  end if;
end; $$;

create or replace function public._verify_require_reader(p_type text)
returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_type = 'OUTGOING_CORRESPONDENCE' then
    if not public.is_active_user() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  elsif p_type in ('PROFORMA', 'INVOICE') then
    if not public.has_invoice_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  elsif p_type = 'CONTRACT' then
    if not public.has_contract_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  elsif p_type = 'BOARD_MINUTES' then
    if not public.has_board_access() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  else
    raise exception 'VERIFY_INVALID' using errcode = '22000';
  end if;
end; $$;

-- The PUBLIC DISCLOSURE POLICY. Explicit field list per type — nothing is public by accident. Returns {number, issued_at, metadata}.
-- Not shown, ever: internal ids / notes / attachments / follow-ups / audit / creator, line items, bank or settlement data, internal contract terms,
-- board members, agenda, discussion, resolutions.
create or replace function public._verify_snapshot(p_type text, p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_s public.verification_settings; c public.correspondence; d public.sales_documents; k public.contracts; bm public.board_meetings; v_meta jsonb;
begin
  select * into v_s from public.verification_settings where id = 1;
  if p_type = 'OUTGOING_CORRESPONDENCE' then
    select * into c from public.correspondence where id = p_id;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if c.direction <> 'OUTGOING' or c.sequence_number is null or c.display_number is null or c.status in ('DRAFT', 'REVIEW', 'CANCELLED') then
      raise exception 'VERIFY_NOT_ELIGIBLE' using errcode = '22000';
    end if;
    v_meta := jsonb_build_object(
      'recipient', coalesce((select co.legal_name from public.companies co where co.id = c.recipient_company_id), c.recipient_name),
      'subject', c.subject);
    return jsonb_build_object('number', c.display_number, 'issued_at', coalesce(c.finalized_at, c.updated_at), 'metadata', jsonb_strip_nulls(v_meta));
  elsif p_type in ('PROFORMA', 'INVOICE') then
    select * into d from public.sales_documents where id = p_id;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if d.type::text <> p_type or d.sequence_number is null or d.display_number is null or d.status in ('DRAFT', 'REVIEW', 'APPROVED', 'CANCELLED') then
      raise exception 'VERIFY_NOT_ELIGIBLE' using errcode = '22000';
    end if;
    v_meta := jsonb_build_object(
      'customer', d.customer_legal_name_snapshot,
      'issue_date', coalesce(d.issue_date, d.issued_at::date),
      'valid_until', case when p_type = 'PROFORMA' then d.validity_date end,
      'currency', d.currency_code,
      'total_amount', d.total_amount::text);
    return jsonb_build_object('number', d.display_number, 'issued_at', coalesce(d.issued_at, d.updated_at), 'metadata', jsonb_strip_nulls(v_meta));
  elsif p_type = 'CONTRACT' then
    select * into k from public.contracts where id = p_id;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if k.kind <> 'NIL_ISSUED' or k.sequence_number is null or k.display_number is null or k.status in ('DRAFT', 'UNDER_REVIEW', 'CANCELLED') then
      raise exception 'VERIFY_NOT_ELIGIBLE' using errcode = '22000';
    end if;
    v_meta := jsonb_build_object(
      'counterparty', (select co.legal_name from public.companies co where co.id = k.counterparty_company_id),
      'contract_date', coalesce(k.signed_date, k.finalized_at::date));
    if v_s.show_contract_amount then
      v_meta := v_meta || jsonb_build_object('total_amount', k.total_amount::text, 'currency', k.currency_code);
    end if;
    return jsonb_build_object('number', k.display_number, 'issued_at', coalesce(k.finalized_at, k.updated_at), 'metadata', jsonb_strip_nulls(v_meta));
  elsif p_type = 'BOARD_MINUTES' then
    select * into bm from public.board_meetings where id = p_id;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if bm.status <> 'APPROVED' or bm.meeting_number is null or bm.approved_at is null then
      raise exception 'VERIFY_NOT_ELIGIBLE' using errcode = '22000';
    end if;
    v_meta := jsonb_build_object('meeting_date', (bm.scheduled_at at time zone 'Asia/Tehran')::date);
    return jsonb_build_object('number', bm.meeting_number::text, 'issued_at', bm.approved_at, 'metadata', jsonb_strip_nulls(v_meta));
  end if;
  raise exception 'VERIFY_INVALID' using errcode = '22000';
end; $$;

create or replace function public.verify_list_active(p_type text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_type is null or p_type not in ('OUTGOING_CORRESPONDENCE', 'PROFORMA', 'INVOICE', 'CONTRACT', 'BOARD_MINUTES') then raise exception 'VERIFY_INVALID' using errcode = '22000'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'code', x.verification_code, 'document_number', x.document_number_snapshot) order by x.created_at desc)
                     from (select * from public.document_verifications v where v.document_type = p_type and v.status = 'ACTIVE' order by v.created_at desc limit 200) x),
                  '[]'::jsonb);
end; $$;

-- ---------------------------------------------------------------------
-- 2) storage: verified BOARD_MINUTES files and the board_meeting/ prefix need board access
-- ---------------------------------------------------------------------
-- (document_verifications has no browser grants, so the policy needs a definer helper; it only answers "is this path board minutes")
create or replace function public._board_is_minutes_file(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.document_verifications v where v.document_type = 'BOARD_MINUTES' and v.pdf_storage_path = p_name);
$$;
revoke all on function public._board_is_minutes_file(text) from public, anon;
grant execute on function public._board_is_minutes_file(text) to authenticated, service_role;

drop policy if exists p_storage_read on storage.objects;
create policy p_storage_read on storage.objects for select using (
  bucket_id = 'nil-files' and public.is_active_user()
  and (name not like 'personnel/%' or public.has_hr_access())
  and (name not like 'payslips/%' or public.has_payroll_access()
       or exists (select 1 from public.payroll_payslips s where s.storage_path = name and public.is_my_personnel(s.personnel_id)))
  and (name not like 'cash-evidence/%' or public.has_accounting_access())
  and (name not like 'board_meeting/%' or public.has_board_access())
  and (name not like 'verified/%' or public.has_board_access() or not public._board_is_minutes_file(name))
);

drop policy if exists p_storage_insert on storage.objects;
create policy p_storage_insert on storage.objects for insert with check (
  bucket_id = 'nil-files' and public.is_active_user()
  and (name not like 'personnel/%' or public.can_create_hr())
  and (name not like 'payslips/%' or public.can_approve_payroll())
  and (name not like 'cash-evidence/%' or public.can_create_accounting())
  and (name not like 'board_meeting/%' or public.can_create_board())
);

drop policy if exists p_storage_update on storage.objects;
create policy p_storage_update on storage.objects for update using (
  bucket_id = 'nil-files' and (owner = auth.uid() or public.is_admin())
  and (name not like 'personnel/%' or public.can_create_hr())
  and name not like 'payslips/%'
  and name not like 'cash-evidence/%'
  and (name not like 'board_meeting/%' or public.can_create_board())
  and (name not like 'verified/%' or public.has_board_access() or not public._board_is_minutes_file(name))
);

drop policy if exists p_storage_delete on storage.objects;
create policy p_storage_delete on storage.objects for delete using (
  bucket_id = 'nil-files' and (owner = auth.uid() or public.is_admin())
  and (name not like 'personnel/%' or public.can_create_hr())
  and name not like 'payslips/%'
  and name not like 'cash-evidence/%'
  and (name not like 'board_meeting/%' or public.is_board_admin())
  and (name not like 'verified/%' or public.is_board_admin() or not public._board_is_minutes_file(name))
);

-- ---------------------------------------------------------------------
-- 3) Factory Reset (0141) integration
-- ---------------------------------------------------------------------
insert into public.system_reset_manifest
  (object_name, module, classification, mode_a, mode_b, reason, risk, reset_order, sequence_impact, storage_impact, manifest_version)
values
  ('board_resolutions',  'board', 'DELETE',   'DELETE',   'DELETE',   'Board resolutions (operational)', 'MEDIUM', 18, 'board meeting numbers restart from board_settings', '-', 1),
  ('board_attendance',   'board', 'DELETE',   'DELETE',   'DELETE',   'Board meeting attendance (operational)', 'LOW', 18, '-', '-', 1),
  ('board_agenda_items', 'board', 'DELETE',   'DELETE',   'DELETE',   'Board meeting agenda and discussion (operational)', 'MEDIUM', 18, '-', '-', 1),
  ('board_meetings',     'board', 'DELETE',   'DELETE',   'DELETE',   'Board meetings and approved minutes snapshots (operational)', 'HIGH', 19, 'meeting_number', 'verified/ minutes PDFs', 1),
  ('board_members',      'board', 'DELETE',   'DELETE',   'DELETE',   'Board member list (test data before go-live)', 'LOW', 19, '-', '-', 1),
  ('board_audit_log',    'board', 'DELETE',   'DELETE',   'DELETE',   'Board audit trail of the deleted operational data', 'LOW', 19, '-', '-', 1),
  ('board_settings',     'board', 'PRESERVE', 'PRESERVE', 'PRESERVE', 'Board configuration (numbering baseline, default location)', 'LOW', 200, '-', '-', 1)
on conflict (object_name) do update set
  module = excluded.module, classification = excluded.classification, mode_a = excluded.mode_a, mode_b = excluded.mode_b,
  reason = excluded.reason, risk = excluded.risk, reset_order = excluded.reset_order, sequence_impact = excluded.sequence_impact,
  storage_impact = excluded.storage_impact, manifest_version = excluded.manifest_version;

insert into public.system_reset_storage_rules (prefix, action, reason)
values ('board_meeting/', 'DELETE', 'Board meeting attachments (generic uploader path <entity>/; Phase 2: signed minutes scans)')
on conflict (prefix) do update set action = excluded.action, reason = excluded.reason;

-- =====================================================================
-- ROLLBACK: restore the 0135 storage.objects policies; drop function _board_is_minutes_file(text); re-run 0143's _verify_require_issuer /
--   _verify_require_reader / _verify_snapshot / verify_list_active; delete from verification_doc_types where document_type = 'BOARD_MINUTES'
--   (only when no BOARD_MINUTES verification exists); restore the two 4-type CHECK constraints; delete the board rows from
--   system_reset_manifest and the 'board_meeting/' storage rule.
-- =====================================================================

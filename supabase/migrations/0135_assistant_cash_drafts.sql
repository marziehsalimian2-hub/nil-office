-- =====================================================================
-- NIL Office — 0135_assistant_cash_drafts.sql
-- Internal Assistant v1.0 — Slice 2: receipt / payment DRAFTS from image, PDF, voice or text.
--
--  * attachments.sha256 — content hash of an archived evidence file (duplicate detection).
--  * Evidence confidentiality: attachments of entity type RECEIPT / PAYMENT and storage objects under
--    `cash-evidence/%` are readable only with accounting access, writable only with the CREATE tier and
--    PERMANENT (nobody updates / deletes them — same rule as payslips/%). Restated from the CURRENT bodies:
--      attachments policies  <- 0112 (no later migration touches them, verified by grep)
--      storage.objects       <- 0131 (personnel/% + payslips/% terms preserved)
--  * assistant_cash_duplicates(): exact-numeric duplicate lookup over receipts/payments/evidence hashes.
--    Caller must be service_role (Telegram) or the profile itself, and the profile needs accounting CREATE tier.
--
-- Nothing here posts, verifies or allocates anything: the assistant only ever creates DRAFT rows
-- (docs/ACCOUNTING_AI_SAFETY.md). service_role is granted explicitly (0072/0096: a blanket grant is not retroactive).
-- =====================================================================

alter table public.attachments add column if not exists sha256 text;
create index if not exists idx_attachments_sha256 on public.attachments (sha256) where sha256 is not null;

-- ---------------------------------------------------------------------
-- attachments policies: CURRENT body (0112) + RECEIPT/PAYMENT carve-out
-- ---------------------------------------------------------------------
drop policy if exists p_attach_read on public.attachments;
create policy p_attach_read on public.attachments for select using (
  public.is_active_user()
  and (entity_type <> 'PERSONNEL' or public.has_hr_access())
  and (entity_type not in ('RECEIPT', 'PAYMENT') or public.has_accounting_access())
);

drop policy if exists p_attach_write on public.attachments;
create policy p_attach_write on public.attachments for insert with check (
  public.is_active_user() and uploaded_by = auth.uid()
  and (entity_type <> 'PERSONNEL' or public.can_create_hr())
  and (entity_type not in ('RECEIPT', 'PAYMENT') or public.can_create_accounting())
);

drop policy if exists p_attach_delete on public.attachments;
create policy p_attach_delete on public.attachments for delete using (
  (uploaded_by = auth.uid() or public.is_admin())
  and (entity_type <> 'PERSONNEL' or public.can_create_hr())
  and entity_type not in ('RECEIPT', 'PAYMENT')               -- financial evidence is permanent
);

-- ---------------------------------------------------------------------
-- storage.objects: CURRENT body (0131) + `cash-evidence/%`
-- ---------------------------------------------------------------------
drop policy if exists p_storage_read on storage.objects;
create policy p_storage_read on storage.objects for select using (
  bucket_id = 'nil-files' and public.is_active_user()
  and (name not like 'personnel/%' or public.has_hr_access())
  and (name not like 'payslips/%' or public.has_payroll_access()
       or exists (select 1 from public.payroll_payslips s where s.storage_path = name and public.is_my_personnel(s.personnel_id)))
  and (name not like 'cash-evidence/%' or public.has_accounting_access())
);

drop policy if exists p_storage_insert on storage.objects;
create policy p_storage_insert on storage.objects for insert with check (
  bucket_id = 'nil-files' and public.is_active_user()
  and (name not like 'personnel/%' or public.can_create_hr())
  and (name not like 'payslips/%' or public.can_approve_payroll())
  and (name not like 'cash-evidence/%' or public.can_create_accounting())
);

drop policy if exists p_storage_update on storage.objects;
create policy p_storage_update on storage.objects for update using (
  bucket_id = 'nil-files' and (owner = auth.uid() or public.is_admin())
  and (name not like 'personnel/%' or public.can_create_hr())
  and name not like 'payslips/%'
  and name not like 'cash-evidence/%'
);

drop policy if exists p_storage_delete on storage.objects;
create policy p_storage_delete on storage.objects for delete using (
  bucket_id = 'nil-files' and (owner = auth.uid() or public.is_admin())
  and (name not like 'personnel/%' or public.can_create_hr())
  and name not like 'payslips/%'
  and name not like 'cash-evidence/%'
);

-- ---------------------------------------------------------------------
-- Duplicate lookup. HARD = same evidence file (any receipt/payment) or same reference + amount + currency (same kind).
-- SOFT = same date + amount + currency, or +-3 days + same company. Amounts compare as exact numeric.
-- ---------------------------------------------------------------------
create or replace function public._assistant_cash_docs()
returns table (kind text, id uuid, status text, display_number text, d date, amount numeric, currency text,
               reference text, company_id uuid, counterparty text)
language sql stable security definer set search_path = public as $$
  select 'RECEIPT', r.id, r.status::text, r.display_number, r.receipt_date, r.amount, r.currency_code, r.reference, r.company_id, r.payer
    from public.receipts r
  union all
  select 'PAYMENT', p.id, p.status::text, p.display_number, p.payment_date, p.amount, p.currency_code, p.reference, p.company_id, p.payee
    from public.payments p;
$$;
revoke all on function public._assistant_cash_docs() from public;     -- internal: reachable only through assistant_cash_duplicates

create or replace function public.assistant_cash_duplicates(
  p_profile_id uuid, p_kind text, p_amount text, p_currency text, p_reference text,
  p_date date, p_company uuid, p_sha256 text
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_amount numeric; v_ref text := nullif(lower(btrim(coalesce(p_reference, ''))), ''); v_hard jsonb; v_soft jsonb;
begin
  if not (auth.role() = 'service_role' or (p_profile_id is not null and p_profile_id = auth.uid())) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and is_active
                  and (role = 'ADMIN' or accounting_role in ('CREATE', 'POST', 'ADMIN'))) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_kind not in ('RECEIPT', 'PAYMENT') then raise exception 'INVALID_KIND' using errcode = '22023'; end if;
  begin v_amount := p_amount::numeric; exception when others then raise exception 'INVALID_AMOUNT' using errcode = '22023'; end;

  with hard as (
    select distinct on (c.id) c.*, 'SAME_FILE' as reason
      from public._assistant_cash_docs() c join public.attachments a on a.entity_type::text = c.kind and a.entity_id = c.id
     where p_sha256 is not null and a.sha256 = p_sha256
    union all
    select c.*, 'SAME_REFERENCE'
      from public._assistant_cash_docs() c
     where v_ref is not null and c.kind = p_kind and lower(btrim(coalesce(c.reference, ''))) = v_ref
       and c.amount = v_amount and c.currency = p_currency
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', h.kind, 'id', h.id, 'status', h.status, 'display_number', h.display_number,
           'date', h.d, 'amount', h.amount::text, 'currency', h.currency, 'counterparty', h.counterparty, 'reason', h.reason)), '[]'::jsonb)
    into v_hard from (select * from hard limit 5) h;

  with soft as (
    select distinct on (c.id) c.*, case when c.d = p_date then 'SAME_DAY_AMOUNT' else 'NEAR_DATE_SAME_COMPANY' end as reason
      from public._assistant_cash_docs() c
     where c.kind = p_kind and c.amount = v_amount and c.currency = p_currency
       and (c.d = p_date or (p_company is not null and c.company_id = p_company and c.d between p_date - 3 and p_date + 3))
       and not exists (select 1 from jsonb_array_elements(v_hard) x where (x ->> 'id')::uuid = c.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', s.kind, 'id', s.id, 'status', s.status, 'display_number', s.display_number,
           'date', s.d, 'amount', s.amount::text, 'currency', s.currency, 'counterparty', s.counterparty, 'reason', s.reason)), '[]'::jsonb)
    into v_soft from (select * from soft limit 5) s;

  return jsonb_build_object('hard', v_hard, 'soft', v_soft);
end; $$;

revoke all on function public.assistant_cash_duplicates(uuid, text, text, text, text, date, uuid, text) from public;
grant execute on function public.assistant_cash_duplicates(uuid, text, text, text, text, date, uuid, text) to authenticated, service_role;

-- =====================================================================
-- ROLLBACK: drop function public.assistant_cash_duplicates(uuid,text,text,text,text,date,uuid,text), public._assistant_cash_docs();
--   re-run 0112's p_attach_* block and 0131's four storage.objects policies (drops the cash-evidence terms);
--   drop index idx_attachments_sha256; alter table attachments drop column sha256.
-- =====================================================================

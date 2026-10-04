-- =====================================================================
-- NIL Office — 0124_payroll_approval_schema.sql
-- HR & Payroll — Phase 4 — schema for final approval + lock + accounting draft.
--  * payroll_batches.status gains APPROVED (text + CHECK, as 0119 designed — no ALTER TYPE).
--  * payroll_batch_transitions: tier CHECK widened to ADMIN; 3 new workflow rows.
--  * payroll_batches: approval + accounting-link columns; guard trigger RESTATED IN FULL
--    (0119 body + new mutable columns + APPROVED lock).
--  * payroll_accounting_settings (singleton) + payroll_component_accounts: configurable
--    component -> chart-of-accounts mapping. Nothing is seeded; nothing is hardcoded.
-- Writes happen only through SECURITY DEFINER RPCs (0125); RLS/grants in 0126.
-- =====================================================================

alter table public.payroll_batches drop constraint if exists ck_payroll_batches_status;
alter table public.payroll_batches add constraint ck_payroll_batches_status
  check (status in ('DRAFT','CALCULATED','UNDER_REVIEW','APPROVED','CANCELLED'));

alter table public.payroll_batch_transitions drop constraint if exists payroll_batch_transitions_required_tier_check;
alter table public.payroll_batch_transitions add constraint payroll_batch_transitions_required_tier_check
  check (required_tier in ('CREATE','APPROVE','ADMIN'));

insert into public.payroll_batch_transitions (from_status, to_status, required_tier) values
  ('UNDER_REVIEW','APPROVED','APPROVE'),   -- only via approve_payroll_batch
  ('APPROVED','UNDER_REVIEW','ADMIN'),     -- controlled reopen (reason required) via reopen_payroll_batch
  ('APPROVED','CANCELLED','ADMIN')         -- reason required; refused while a live journal is linked
on conflict do nothing;

alter table public.payroll_batches
  add column if not exists approved_by             uuid references public.profiles(id),
  add column if not exists approved_at             timestamptz,
  add column if not exists approved_calculation_id uuid,
  add column if not exists accounting_journal_entry_id uuid references public.journal_entries(id) on delete set null,
  add column if not exists accounting_drafted_by   uuid references public.profiles(id),
  add column if not exists accounting_drafted_at   timestamptz;

do $$ begin
  alter table public.payroll_batches add constraint fk_payroll_batches_approved_calc
    foreign key (approved_calculation_id, id) references public.payroll_calculations (id, batch_id) on delete restrict;
exception when duplicate_object then null; end $$;

alter table public.payroll_batches drop constraint if exists ck_payroll_batches_approval_stamp;
alter table public.payroll_batches add constraint ck_payroll_batches_approval_stamp
  check ((approved_by is null) = (approved_at is null));
alter table public.payroll_batches drop constraint if exists ck_payroll_batches_approved;
alter table public.payroll_batches add constraint ck_payroll_batches_approved
  check (status <> 'APPROVED'
         or (approved_at is not null and approved_calculation_id is not null and approved_calculation_id = current_calculation_id));

-- One batch <-> one journal entry link (idempotency backstop for create_payroll_accounting_draft).
create unique index if not exists uq_payroll_batch_journal
  on public.payroll_batches (accounting_journal_entry_id) where accounting_journal_entry_id is not null;

-- ---------------------------------------------------------------------
-- Guard: RESTATED IN FULL from 0119 (single prior definition, verified by grep).
-- Added: new mutable columns; settings frozen in UNDER_REVIEW and APPROVED;
-- APPROVED freezes calculation pointer/version and the approval stamp.
-- ---------------------------------------------------------------------
create or replace function public.tg_payroll_batches_guard() returns trigger language plpgsql as $$
declare
  v_mut text[] := array['status','jurisdiction','rounding_scale','rounding_mode','calculation_version','current_calculation_id',
    'calculated_by','calculated_at','submitted_by','submitted_at','reviewed_by','reviewed_at','cancelled_by','cancelled_at',
    'status_note','notes','updated_at',
    'approved_by','approved_at','approved_calculation_id','accounting_journal_entry_id','accounting_drafted_by','accounting_drafted_at'];
begin
  if old.status = 'CANCELLED' then raise exception 'PAYROLL_BATCH_CANCELLED' using errcode = '22000'; end if;
  if (to_jsonb(new) - v_mut) is distinct from (to_jsonb(old) - v_mut) then
    raise exception 'PAYROLL_VERSION_FIELD_IMMUTABLE' using errcode = '22000';
  end if;
  if new.status is distinct from old.status and not exists (
       select 1 from public.payroll_batch_transitions t where t.from_status = old.status and t.to_status = new.status) then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000';
  end if;
  if old.status in ('UNDER_REVIEW','APPROVED') and new.status = old.status
     and (new.jurisdiction is distinct from old.jurisdiction or new.rounding_scale <> old.rounding_scale or new.rounding_mode <> old.rounding_mode) then
    raise exception 'PAYROLL_BATCH_NOT_EDITABLE' using errcode = '22000';
  end if;
  if new.calculation_version < old.calculation_version then
    raise exception 'PAYROLL_VERSION_FIELD_IMMUTABLE' using errcode = '22000';
  end if;
  -- APPROVED = financial lock: the approved calculation can never be swapped or re-stamped in place.
  if old.status = 'APPROVED' and new.status = 'APPROVED'
     and (new.current_calculation_id is distinct from old.current_calculation_id
          or new.calculation_version <> old.calculation_version
          or new.approved_calculation_id is distinct from old.approved_calculation_id
          or new.approved_by is distinct from old.approved_by
          or new.approved_at is distinct from old.approved_at
          or new.reviewed_by is distinct from old.reviewed_by
          or new.reviewed_at is distinct from old.reviewed_at) then
    raise exception 'PAYROLL_APPROVED_LOCKED' using errcode = '22000';
  end if;
  return new;
end; $$;

-- Audit whitelist for batches: ids/status only — still no amounts, notes or reasons.
drop trigger if exists trg_payroll_audit_payroll_batches on public.payroll_batches;
create trigger trg_payroll_audit_payroll_batches after insert or update or delete on public.payroll_batches
  for each row execute function public.tg_payroll_audit(
    'batch_number,period_id,payroll_type,currency,jurisdiction,rounding_scale,rounding_mode,status,calculation_version,approved_by,accounting_journal_entry_id');

-- ---------------------------------------------------------------------
-- Account mapping (configurable). Singleton settings + per-component mapping.
-- ---------------------------------------------------------------------
create table if not exists public.payroll_accounting_settings (
  id                            uuid not null default gen_random_uuid() unique,
  singleton                     boolean primary key default true check (singleton),
  base_salary_expense_account_id uuid references public.accounts(id) on delete restrict,   -- synthetic BASE_SALARY line (debit)
  net_payable_account_id         uuid references public.accounts(id) on delete restrict,   -- total net pay (credit)
  updated_by                    uuid references public.profiles(id),
  updated_at                    timestamptz not null default now()
);

create table if not exists public.payroll_component_accounts (
  id                   uuid not null default gen_random_uuid() unique,
  component_id         uuid primary key,
  component_type       salary_component_type not null,      -- denormalised so the CHECK below can see it
  expense_account_id   uuid references public.accounts(id) on delete restrict,   -- debit side (EARNING, EMPLOYER_COST)
  liability_account_id uuid references public.accounts(id) on delete restrict,   -- credit side (DEDUCTION, EMPLOYER_COST)
  updated_by           uuid references public.profiles(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint fk_pca_component foreign key (component_id, component_type)
    references public.salary_components (id, component_type) on delete restrict,
  constraint ck_pca_sides check (
       (component_type = 'EARNING'       and expense_account_id is not null and liability_account_id is null)
    or (component_type = 'DEDUCTION'     and liability_account_id is not null and expense_account_id is null)
    or (component_type = 'EMPLOYER_COST' and expense_account_id is not null and liability_account_id is not null))
);

do $$
declare t text;
begin
  foreach t in array array['payroll_accounting_settings','payroll_component_accounts']
  loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s;', t);
    execute format('create trigger trg_touch_%1$s before update on public.%1$s for each row execute function public.tg_touch_updated_at();', t);
    execute format('drop trigger if exists trg_no_delete_%1$s on public.%1$s;', t);
    execute format('create trigger trg_no_delete_%1$s before delete on public.%1$s for each row execute function public.tg_payroll_no_delete();', t);
  end loop;
end $$;

drop trigger if exists trg_payroll_audit_payroll_accounting_settings on public.payroll_accounting_settings;
create trigger trg_payroll_audit_payroll_accounting_settings after insert or update or delete on public.payroll_accounting_settings
  for each row execute function public.tg_payroll_audit('base_salary_expense_account_id,net_payable_account_id');
drop trigger if exists trg_payroll_audit_payroll_component_accounts on public.payroll_component_accounts;
create trigger trg_payroll_audit_payroll_component_accounts after insert or update or delete on public.payroll_component_accounts
  for each row execute function public.tg_payroll_audit('component_id,expense_account_id,liability_account_id');

-- =====================================================================
-- ROLLBACK (drops Phase 4 data): drop table if exists public.payroll_component_accounts, public.payroll_accounting_settings cascade;
-- drop index if exists public.uq_payroll_batch_journal; alter table public.payroll_batches drop column ... (the 6 new columns + constraints);
-- delete the 3 new rows from payroll_batch_transitions; re-run 0119's tg_payroll_batches_guard + status CHECK.
-- =====================================================================

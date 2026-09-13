-- =====================================================================
-- NIL Office — 0076_cheque_print_templates.sql
-- PAYABLE-only concept: a physical print layout, mm-positioned, so
-- printing lands on the real bank leaf instead of a plain A4 PDF.
-- Two tables, not one JSON blob — matches this codebase's preference
-- for real columns (journal_entry_lines, not a lines jsonb) and lets the
-- calibration UI (numeric X/Y form, confirmed for v1) update one field
-- row at a time.
-- =====================================================================

create table if not exists public.cheque_print_templates (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  bank_account_id   uuid references public.bank_accounts(id) on delete set null,
  page_width_mm     numeric(6,2) not null check (page_width_mm > 0),
  page_height_mm    numeric(6,2) not null check (page_height_mm > 0),
  orientation       text not null default 'LANDSCAPE' check (orientation in ('LANDSCAPE','PORTRAIT')),
  print_date_format text not null default 'JALALI' check (print_date_format in ('JALALI','GREGORIAN')),
  offset_x_mm       numeric(6,2) not null default 0,
  offset_y_mm       numeric(6,2) not null default 0,
  is_active         boolean not null default true,
  created_by        uuid not null references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_cheque_print_templates_bank on public.cheque_print_templates(bank_account_id);

create table if not exists public.cheque_print_template_fields (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references public.cheque_print_templates(id) on delete cascade,
  field_key     text not null check (field_key in
                  ('DATE','PAYEE','AMOUNT_NUMERIC','AMOUNT_WORDS','PURPOSE','SAYAD_ID','ACCOUNT_INFO','CUSTOM_TEXT')),
  custom_label  text,
  x_mm          numeric(6,2) not null,
  y_mm          numeric(6,2) not null,
  width_mm      numeric(6,2) not null check (width_mm > 0),
  height_mm     numeric(6,2) not null check (height_mm > 0),
  font_size_pt  numeric(5,2) not null default 10,
  alignment     text not null default 'RIGHT' check (alignment in ('LEFT','RIGHT','CENTER')),
  direction     text not null default 'RTL' check (direction in ('RTL','LTR')),
  rotation_deg  numeric(5,2) not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists uq_cheque_template_field
  on public.cheque_print_template_fields(template_id, field_key, coalesce(custom_label, ''));
create index if not exists idx_cheque_template_fields_template on public.cheque_print_template_fields(template_id);

alter table public.cheques
  add constraint fk_cheques_print_template
  foreign key (print_template_id) references public.cheque_print_templates(id);

do $$
declare t text;
begin
  foreach t in array array['cheque_print_templates','cheque_print_template_fields']
  loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s;', t);
    execute format(
      'create trigger trg_touch_%1$s before update on public.%1$s
       for each row execute function public.tg_touch_updated_at();', t);
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$s;', t);
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$s
       for each row execute function public.tg_audit();', t);
  end loop;
end $$;

-- =====================================================================
-- ROLLBACK
-- ---------------------------------------------------------------------
-- alter table public.cheques drop constraint if exists fk_cheques_print_template;
-- drop trigger if exists trg_audit_cheque_print_template_fields on public.cheque_print_template_fields;
-- drop trigger if exists trg_touch_cheque_print_template_fields on public.cheque_print_template_fields;
-- drop trigger if exists trg_audit_cheque_print_templates on public.cheque_print_templates;
-- drop trigger if exists trg_touch_cheque_print_templates on public.cheque_print_templates;
-- drop table if exists public.cheque_print_template_fields;
-- drop table if exists public.cheque_print_templates;
-- =====================================================================

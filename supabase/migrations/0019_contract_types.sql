-- =====================================================================
-- NIL Office — 0019_contract_types.sql
--
-- Contract Management, Phase 1. Contract "types" (خدمات/فروش/...) must be
-- admin-extensible, so this is a managed lookup table rather than a fixed
-- Postgres enum or TS union.
--
-- Note: the existing `document_type` enum already has a value literally
-- named 'CONTRACT' — that's for tagging a generic uploaded file in the
-- pre-existing `documents` table as "a contract-type document", and is
-- unrelated to this new `contracts` table / `contract_types` lookup.
-- =====================================================================

create table if not exists public.contract_types (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  label_fa    text not null,
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into public.contract_types (code, label_fa, sort_order) values
  ('SERVICES',        'خدمات',        1),
  ('SALES',           'فروش',         2),
  ('PURCHASE',        'خرید',         3),
  ('CONSULTING',      'مشاوره',       4),
  ('SOFTWARE',        'نرم‌افزار',     5),
  ('SUPPORT',         'پشتیبانی',     6),
  ('AGENCY',          'نمایندگی',     7),
  ('COOPERATION',     'همکاری',       8),
  ('SUPPLY',          'تأمین',        9),
  ('CONFIDENTIALITY', 'محرمانگی',    10),
  ('OTHER',           'سایر',        11)
on conflict (code) do nothing;

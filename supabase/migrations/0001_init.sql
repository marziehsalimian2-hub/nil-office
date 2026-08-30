-- =====================================================================
-- NIL Office — 0001_init.sql
-- Extensions, enum types, and pure helper functions.
-- =====================================================================

-- gen_random_uuid(), trigram search
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------
-- Enum types. Adding a value later (e.g. Arabic 'AR', new roles) is done
-- with `alter type ... add value ...` — no table rewrite required.
-- ---------------------------------------------------------------------
do $$ begin
  create type app_role         as enum ('ADMIN', 'USER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type corr_direction   as enum ('OUTGOING', 'INCOMING');
exception when duplicate_object then null; end $$;

do $$ begin
  create type corr_status      as enum ('DRAFT','REVIEW','FINALIZED','SENT','WAITING_RESPONSE','RESPONSE_RECEIVED','CLOSED','CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type corr_priority    as enum ('NORMAL','URGENT','CONFIDENTIAL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type corr_language    as enum ('FA','EN');
exception when duplicate_object then null; end $$;

do $$ begin
  create type case_status      as enum ('ACTIVE','WAITING','CLOSED','CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type document_type    as enum ('PROCEDURE','LOI','ICPO','CONTRACT','ANALYSIS','COMPANY_DOCUMENT','BANK_DOCUMENT','INVOICE','OTHER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type followup_status  as enum ('OPEN','DONE','CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type link_relation    as enum ('REPLY_TO','RELATED_TO');
exception when duplicate_object then null; end $$;

do $$ begin
  create type attach_entity    as enum ('CORRESPONDENCE','DOCUMENT','CASE');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Jalali year of a timestamp.
-- The AUTHORITATIVE Jalali conversion happens in the application (JS,
-- see lib/jalali.ts) and the correct year is passed into the numbering
-- RPCs. This function is only a safe server-side fallback so sequences
-- still reset correctly if the caller omits the year. Nowruz falls on
-- 20/21 March; we treat 21 March as the boundary.
-- ---------------------------------------------------------------------
create or replace function public.jalali_year(p_ts timestamptz)
returns int
language sql
immutable
as $$
  select case
    when (extract(month from p_ts) > 3)
      or (extract(month from p_ts) = 3 and extract(day from p_ts) >= 21)
    then extract(year from p_ts)::int - 621
    else extract(year from p_ts)::int - 622
  end;
$$;

-- ---------------------------------------------------------------------
-- Official display number formatter.
--   OUTGOING  ص-1405-0070
--   INCOMING  و-1405-0018
--   CASE      CASE-1405-0012
-- ---------------------------------------------------------------------
create or replace function public.format_display_number(p_scope text, p_year int, p_seq int)
returns text
language sql
immutable
as $$
  select case p_scope
    when 'OUTGOING' then 'ص-' || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'INCOMING' then 'و-' || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    when 'CASE'     then 'CASE-' || p_year::text || '-' || lpad(p_seq::text, 4, '0')
    else p_scope || '-' || p_year::text || '-' || lpad(p_seq::text, 4, '0')
  end;
$$;

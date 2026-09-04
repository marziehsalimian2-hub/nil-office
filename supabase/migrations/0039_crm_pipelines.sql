-- =====================================================================
-- NIL Office — 0039_crm_pipelines.sql
-- CRM module — configurable pipelines/stages (spec §12), not one
-- hard-coded universal pipeline. Seeds the two default pipelines from
-- spec §13 (International Trade) and §14 (Service/Project). WON/LOST
-- are modeled as terminal stages (is_won/is_lost flags), not a separate
-- status column — see the Phase 1 plan's architectural decision #2: the
-- same "move stage" codepath then drives both ordinary pipeline
-- progress and closing, with one audit mechanism for both.
-- =====================================================================

create table if not exists public.crm_pipelines (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.crm_pipeline_stages (
  id          uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.crm_pipelines(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  is_won      boolean not null default false,
  is_lost     boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint ck_crm_pipeline_stage_not_both_won_lost check (not (is_won and is_lost))
);

create index if not exists idx_crm_pipeline_stages_pipeline on public.crm_pipeline_stages (pipeline_id, sort_order);

-- At most one WON stage and one LOST stage per pipeline — the "close"
-- actions (closeOpportunityWon/closeOpportunityLost) rely on this to
-- unambiguously pick a target stage.
create unique index if not exists uq_crm_pipeline_stage_won
  on public.crm_pipeline_stages (pipeline_id) where is_won;
create unique index if not exists uq_crm_pipeline_stage_lost
  on public.crm_pipeline_stages (pipeline_id) where is_lost;

-- ---------------------------------------------------------------------
-- Seed: International Trade pipeline (spec §13).
-- ---------------------------------------------------------------------
do $$
declare v_pipeline_id uuid;
begin
  if not exists (select 1 from public.crm_pipelines where name = 'تجارت بین‌المللی') then
    insert into public.crm_pipelines (name, sort_order) values ('تجارت بین‌المللی', 1)
      returning id into v_pipeline_id;

    insert into public.crm_pipeline_stages (pipeline_id, name, sort_order, is_won, is_lost) values
      (v_pipeline_id, 'سرنخ',            1, false, false),
      (v_pipeline_id, 'واجد شرایط',       2, false, false),
      (v_pipeline_id, 'استعلام',          3, false, false),
      (v_pipeline_id, 'تأمین',            4, false, false),
      (v_pipeline_id, 'پیشنهاد قیمت',     5, false, false),
      (v_pipeline_id, 'مذاکره',           6, false, false),
      (v_pipeline_id, 'LOI / ICPO',       7, false, false),
      (v_pipeline_id, 'قرارداد',          8, false, false),
      (v_pipeline_id, 'موفق',             9, true,  false),
      (v_pipeline_id, 'از دست رفته',     10, false, true);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Seed: Service/Project pipeline (spec §14).
-- ---------------------------------------------------------------------
do $$
declare v_pipeline_id uuid;
begin
  if not exists (select 1 from public.crm_pipelines where name = 'خدمات و پروژه') then
    insert into public.crm_pipelines (name, sort_order) values ('خدمات و پروژه', 2)
      returning id into v_pipeline_id;

    insert into public.crm_pipeline_stages (pipeline_id, name, sort_order, is_won, is_lost) values
      (v_pipeline_id, 'سرنخ',        1, false, false),
      (v_pipeline_id, 'نیازسنجی',    2, false, false),
      (v_pipeline_id, 'پیشنهاد',     3, false, false),
      (v_pipeline_id, 'مذاکره',      4, false, false),
      (v_pipeline_id, 'قرارداد',     5, false, false),
      (v_pipeline_id, 'موفق',        6, true,  false),
      (v_pipeline_id, 'از دست رفته', 7, false, true);
  end if;
end $$;

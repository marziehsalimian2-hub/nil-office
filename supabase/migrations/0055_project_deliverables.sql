-- =====================================================================
-- NIL Office — 0055_project_deliverables.sql
-- Project & Task Management Phase 2 — deliverables with an
-- RPC-gated acceptance workflow, mirroring close_opportunity_won/
-- close_opportunity_lost (0043_crm_functions.sql) exactly. ACCEPTED is
-- terminal — an accepted deliverable is never reopened.
-- =====================================================================

do $$ begin
  create type deliverable_status as enum
    ('PLANNED','IN_PROGRESS','READY_FOR_REVIEW','ACCEPTED','REJECTED','CANCELLED');
exception when duplicate_object then null; end $$;

create table if not exists public.project_deliverables (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  phase_id            uuid references public.project_phases(id) on delete set null,
  milestone_id        uuid references public.project_milestones(id) on delete set null,

  title               text not null,
  description         text,
  due_date            date,

  status              deliverable_status not null default 'PLANNED',
  responsible_user_id uuid references public.profiles(id) on delete set null,

  accepted_by         uuid references public.profiles(id) on delete set null,
  accepted_at         timestamptz,
  rejection_reason    text,

  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_project_deliverables_project on public.project_deliverables (project_id);
create index if not exists idx_project_deliverables_phase   on public.project_deliverables (phase_id);
create index if not exists idx_project_deliverables_milestone on public.project_deliverables (milestone_id);

-- ---------------------------------------------------------------------
-- accept_deliverable / reject_deliverable — the only ways a deliverable
-- reaches ACCEPTED/REJECTED (gated can_approve_project(), spec §23's
-- acceptance workflow needing an authorized reviewer).
-- ---------------------------------------------------------------------
create or replace function public.accept_deliverable(p_id uuid)
returns public.project_deliverables
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.project_deliverables;
begin
  if not public.can_approve_project() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_row from public.project_deliverables where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status = 'ACCEPTED' then
    raise exception 'ALREADY_ACCEPTED' using errcode = '22000';
  end if;
  if v_row.status <> 'READY_FOR_REVIEW' then
    raise exception 'NOT_ELIGIBLE' using errcode = '22000';
  end if;

  update public.project_deliverables
     set status = 'ACCEPTED', accepted_by = auth.uid(), accepted_at = now(),
         rejection_reason = null, updated_at = now()
   where id = p_id
   returning * into v_row;

  perform public.write_log('project_deliverables', p_id, 'ACCEPTED', null,
    jsonb_build_object('accepted_by', v_row.accepted_by, 'accepted_at', v_row.accepted_at));
  return v_row;
end;
$$;

create or replace function public.reject_deliverable(p_id uuid, p_reason text)
returns public.project_deliverables
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.project_deliverables;
begin
  if not public.can_approve_project() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'REJECTION_REASON_REQUIRED' using errcode = '22000';
  end if;

  select * into v_row from public.project_deliverables where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status = 'ACCEPTED' then
    raise exception 'ALREADY_ACCEPTED' using errcode = '22000';
  end if;
  if v_row.status <> 'READY_FOR_REVIEW' then
    raise exception 'NOT_ELIGIBLE' using errcode = '22000';
  end if;

  update public.project_deliverables
     set status = 'REJECTED', rejection_reason = p_reason, updated_at = now()
   where id = p_id
   returning * into v_row;

  perform public.write_log('project_deliverables', p_id, 'REJECTED', null,
    jsonb_build_object('rejection_reason', p_reason));
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- Status transition trigger — ACCEPTED/REJECTED only via the RPCs
-- above (mirrors USE_RPC_TO_FINALIZE); everything else is a plain
-- adjacency-checked update.
-- ---------------------------------------------------------------------
create or replace function public.tg_deliverable_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then

    if new.status in ('ACCEPTED','REJECTED') then
      -- Column-shape check alone isn't a real authorization gate — a plain
      -- UPDATE (via RLS's can_create_project() policy) could otherwise
      -- forge the exact same shape. Require can_approve_project() here
      -- too, so this trigger can't be bypassed into skipping the
      -- approval-tier check the RPCs below enforce.
      if not public.can_approve_project() then
        raise exception 'NOT_AUTHORIZED' using errcode = '42501';
      end if;
      if old.status = 'READY_FOR_REVIEW'
         and ((new.status = 'ACCEPTED' and new.accepted_at is not null and old.accepted_at is null)
              or (new.status = 'REJECTED' and new.rejection_reason is not null and old.status <> 'REJECTED')) then
        return new; -- legitimate transition by accept_deliverable/reject_deliverable
      end if;
      raise exception 'USE_ACCEPT_OR_REJECT_ACTION' using errcode = '22000';
    end if;

    if old.status = 'ACCEPTED' then
      raise exception 'ACCEPTED_IS_TERMINAL' using errcode = '22000';
    end if;

    if not (
      (old.status = 'PLANNED'          and new.status in ('IN_PROGRESS','CANCELLED')) or
      (old.status = 'IN_PROGRESS'      and new.status in ('READY_FOR_REVIEW','CANCELLED')) or
      (old.status = 'READY_FOR_REVIEW' and new.status in ('CANCELLED')) or
      (old.status = 'REJECTED'         and new.status in ('IN_PROGRESS','CANCELLED'))
    ) then
      raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_deliverable_status on public.project_deliverables;
create trigger trg_deliverable_status
  before update on public.project_deliverables
  for each row execute function public.tg_deliverable_status();

drop trigger if exists trg_touch_project_deliverables on public.project_deliverables;
create trigger trg_touch_project_deliverables
  before update on public.project_deliverables
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists trg_audit_project_deliverables on public.project_deliverables;
create trigger trg_audit_project_deliverables
  after insert or update or delete on public.project_deliverables
  for each row execute function public.tg_audit();

-- ---------------------------------------------------------------------
-- RLS — project-structural, same 4-tier project_role loop as
-- project_phases/project_milestones (not the task-ownership pattern —
-- a deliverable belongs to a project, not to an individual).
-- ---------------------------------------------------------------------
alter table public.project_deliverables enable row level security;

drop policy if exists p_project_deliverables_read   on public.project_deliverables;
drop policy if exists p_project_deliverables_write  on public.project_deliverables;
drop policy if exists p_project_deliverables_update on public.project_deliverables;
drop policy if exists p_project_deliverables_delete on public.project_deliverables;
create policy p_project_deliverables_read   on public.project_deliverables for select using (public.has_project_access());
create policy p_project_deliverables_write  on public.project_deliverables for insert with check (public.can_create_project());
create policy p_project_deliverables_update on public.project_deliverables for update using (public.can_create_project()) with check (public.can_create_project());
create policy p_project_deliverables_delete on public.project_deliverables for delete using (public.is_project_admin());

grant select, insert, update, delete on public.project_deliverables to authenticated;
grant execute on function public.accept_deliverable(uuid) to authenticated;
grant execute on function public.reject_deliverable(uuid, text) to authenticated;

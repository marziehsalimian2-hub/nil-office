-- =====================================================================
-- NIL Office — 0059_project_status_guard_fix.sql
-- Security fix found while building Phase 2's deliverable-acceptance
-- trigger: tg_project_status() (0052) recognizes a legitimate
-- DRAFT->PLANNED numbering purely by column SHAPE (old.sequence_number
-- null, new.sequence_number not null) — but projects' own UPDATE RLS
-- policy only requires can_create_project() (CREATE tier), so a
-- CREATE-tier user could forge that exact shape via a plain UPDATE,
-- self-assigning an arbitrary sequence_number/display_number pair
-- WITHOUT going through finalize_project()'s can_approve_project()
-- check or its atomic allocate_sequence() call.
--
-- Fix: require can_approve_project() explicitly inside the trigger for
-- this branch, exactly as 0055_project_deliverables.sql's
-- tg_deliverable_status() now does for ACCEPTED/REJECTED.
-- =====================================================================

create or replace function public.tg_project_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then

    if new.status = 'PLANNED' then
      if old.status = 'DRAFT' and old.sequence_number is null and new.sequence_number is not null then
        if not public.can_approve_project() then
          raise exception 'NOT_AUTHORIZED' using errcode = '42501';
        end if;
        return new; -- legitimate numbering by finalize_project
      end if;
      raise exception 'USE_RPC_TO_FINALIZE' using errcode = '22000';
    end if;

    if not (
      (old.status = 'DRAFT'      and new.status in ('CANCELLED')) or
      (old.status = 'PLANNED'    and new.status in ('ACTIVE','CANCELLED')) or
      (old.status = 'ACTIVE'     and new.status in ('ON_HOLD','COMPLETED','CANCELLED')) or
      (old.status = 'ON_HOLD'    and new.status in ('ACTIVE','CANCELLED')) or
      (old.status = 'COMPLETED'  and new.status in ('ARCHIVED')) or
      (old.status = 'CANCELLED'  and new.status in ('ARCHIVED'))
    ) then
      raise exception 'INVALID_STATUS_TRANSITION' using errcode = '22000';
    end if;
  end if;
  return new;
end;
$$;

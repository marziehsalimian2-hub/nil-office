-- =====================================================================
-- 0012_final_fixes.sql
-- Final correction: cancel_correspondence must record the ORIGINAL status
-- as the audit old_value (e.g. SENT -> CANCELLED), not CANCELLED -> CANCELLED.
-- Idempotent: replaces the function in place. The record and its number
-- are preserved exactly as before.
-- =====================================================================
create or replace function public.cancel_correspondence(p_letter_id uuid)
returns public.correspondence
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      public.correspondence;
  v_prev_st  corr_status;  -- original status captured BEFORE the update
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_row from public.correspondence where id = p_letter_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status = 'CANCELLED' then
    raise exception 'ALREADY_CANCELLED' using errcode = '22000';
  end if;

  v_prev_st := v_row.status;

  update public.correspondence
     set status = 'CANCELLED', updated_at = now()
   where id = p_letter_id
   returning * into v_row;

  perform public.write_log(
    'correspondence', p_letter_id, 'CANCELLED',
    jsonb_build_object('status', v_prev_st),
    jsonb_build_object('status', 'CANCELLED', 'display_number', v_row.display_number)
  );

  return v_row;
end;
$$;

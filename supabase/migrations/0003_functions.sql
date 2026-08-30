-- =====================================================================
-- NIL Office — 0003_functions.sql
-- Business logic that MUST live in the database: atomic numbering,
-- audit logging, immutability guards, case-code generation, search.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Role helpers. SECURITY DEFINER so they read profiles without tripping
-- profiles' own RLS (avoids recursive policy evaluation).
-- ---------------------------------------------------------------------
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and role = 'ADMIN'
  );
$$;

-- ---------------------------------------------------------------------
-- write_log — the only sanctioned way to append to the audit trail.
-- SECURITY DEFINER so audit writes cannot be blocked or forged through
-- table RLS.
-- ---------------------------------------------------------------------
create or replace function public.write_log(
  p_entity_type text,
  p_entity_id   uuid,
  p_action      text,
  p_old         jsonb default null,
  p_new         jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity_logs (user_id, entity_type, entity_id, action, old_value, new_value)
  values (auth.uid(), p_entity_type, p_entity_id, p_action, p_old, p_new);
end;
$$;

-- ---------------------------------------------------------------------
-- allocate_sequence — the atomic counter.
-- The UPDATE ... RETURNING takes a row-level lock on the (scope, year)
-- row; concurrent callers serialise on that lock and therefore always
-- receive distinct, gap-free values. NOT granted to end users: it is an
-- internal building block invoked only by the SECURITY DEFINER RPCs
-- below.
-- ---------------------------------------------------------------------
create or replace function public.allocate_sequence(p_scope text, p_year int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_val int;
begin
  -- Ensure the counter row exists (race-safe).
  insert into public.number_sequences (scope, year, last_value)
  values (p_scope, p_year, 0)
  on conflict (scope, year) do nothing;

  -- Atomic increment under row lock.
  update public.number_sequences
     set last_value = last_value + 1,
         updated_at = now()
   where scope = p_scope and year = p_year
   returning last_value into v_val;

  return v_val;
end;
$$;

-- ---------------------------------------------------------------------
-- finalize_correspondence — issue the official OUTGOING number.
-- Atomic: authorise → lock letter → validate eligibility → allocate →
-- assign → audit → commit. Two concurrent calls can never collide.
-- p_year: authoritative Jalali year from the app; falls back to the
-- server approximation when omitted.
-- ---------------------------------------------------------------------
create or replace function public.finalize_correspondence(
  p_letter_id uuid,
  p_year      int default null
)
returns public.correspondence
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.correspondence;
  v_year  int;
  v_seq   int;
  v_disp  text;
begin
  -- 1. authorisation
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  -- 2. lock the letter row for the duration of the transaction
  select * into v_row from public.correspondence where id = p_letter_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_row.direction <> 'OUTGOING' then
    raise exception 'ONLY_OUTGOING_FINALIZE' using errcode = '22000';
  end if;
  if v_row.sequence_number is not null then
    raise exception 'ALREADY_NUMBERED' using errcode = '22000';
  end if;
  if v_row.status not in ('DRAFT','REVIEW') then
    raise exception 'NOT_ELIGIBLE' using errcode = '22000';
  end if;
  if v_row.subject is null or length(btrim(v_row.subject)) = 0 then
    raise exception 'SUBJECT_REQUIRED' using errcode = '22000';
  end if;

  -- 3. Jalali year
  v_year := coalesce(p_year, v_row.year, public.jalali_year(now()));
  if v_year < 1300 or v_year > 1600 then
    raise exception 'INVALID_YEAR' using errcode = '22000';
  end if;

  -- 4-6. allocate atomically
  v_seq  := public.allocate_sequence('OUTGOING', v_year);
  -- 7. display number
  v_disp := public.format_display_number('OUTGOING', v_year, v_seq);

  -- 8. assign + finalize
  update public.correspondence
     set sequence_number = v_seq,
         display_number  = v_disp,
         year            = v_year,
         status          = 'FINALIZED',
         finalized_at    = now(),
         updated_at      = now()
   where id = p_letter_id
   returning * into v_row;

  -- 9. audit
  perform public.write_log(
    'correspondence', p_letter_id, 'FINALIZED',
    jsonb_build_object('status', 'DRAFT'),
    jsonb_build_object('status','FINALIZED','display_number', v_disp,
                       'sequence_number', v_seq, 'year', v_year)
  );

  return v_row; -- 10. commit on return
end;
$$;

-- ---------------------------------------------------------------------
-- register_incoming — assign the INCOMING registration number.
-- Same atomic guarantees as finalize; used when an incoming letter is
-- logged into the register.
-- ---------------------------------------------------------------------
create or replace function public.register_incoming(
  p_letter_id uuid,
  p_year      int default null
)
returns public.correspondence
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  public.correspondence;
  v_year int;
  v_seq  int;
  v_disp text;
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_row from public.correspondence where id = p_letter_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_row.direction <> 'INCOMING' then
    raise exception 'ONLY_INCOMING_REGISTER' using errcode = '22000';
  end if;
  if v_row.sequence_number is not null then
    raise exception 'ALREADY_NUMBERED' using errcode = '22000';
  end if;
  if v_row.subject is null or length(btrim(v_row.subject)) = 0 then
    raise exception 'SUBJECT_REQUIRED' using errcode = '22000';
  end if;

  v_year := coalesce(p_year, v_row.year, public.jalali_year(now()));
  if v_year < 1300 or v_year > 1600 then
    raise exception 'INVALID_YEAR' using errcode = '22000';
  end if;

  v_seq  := public.allocate_sequence('INCOMING', v_year);
  v_disp := public.format_display_number('INCOMING', v_year, v_seq);

  update public.correspondence
     set sequence_number = v_seq,
         display_number  = v_disp,
         year            = v_year,
         status          = 'FINALIZED',
         finalized_at    = now(),
         updated_at      = now()
   where id = p_letter_id
   returning * into v_row;

  perform public.write_log(
    'correspondence', p_letter_id, 'REGISTERED',
    null,
    jsonb_build_object('status','FINALIZED','display_number', v_disp,
                       'sequence_number', v_seq, 'year', v_year)
  );

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- cancel_correspondence — keep the number, keep the record, mark cancelled.
-- ---------------------------------------------------------------------
create or replace function public.cancel_correspondence(p_letter_id uuid)
returns public.correspondence
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.correspondence;
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

  update public.correspondence
     set status = 'CANCELLED', updated_at = now()
   where id = p_letter_id
   returning * into v_row;

  perform public.write_log(
    'correspondence', p_letter_id, 'CANCELLED',
    jsonb_build_object('status', v_row.status),
    jsonb_build_object('status', 'CANCELLED', 'display_number', v_row.display_number)
  );

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- Guard trigger: numbering fields are immutable once set, and FINALIZED
-- can only be reached through the RPC (never a direct client update).
-- ---------------------------------------------------------------------
create or replace function public.tg_correspondence_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if old.sequence_number is not null
       and new.sequence_number is distinct from old.sequence_number then
      raise exception 'SEQUENCE_NUMBER_IMMUTABLE' using errcode = '22000';
    end if;
    if old.display_number is not null
       and new.display_number is distinct from old.display_number then
      raise exception 'DISPLAY_NUMBER_IMMUTABLE' using errcode = '22000';
    end if;
    if new.status = 'FINALIZED' and new.sequence_number is null then
      raise exception 'USE_RPC_TO_FINALIZE' using errcode = '22000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_correspondence_guard on public.correspondence;
create trigger trg_correspondence_guard
  before update on public.correspondence
  for each row execute function public.tg_correspondence_guard();

-- ---------------------------------------------------------------------
-- updated_at touch trigger
-- ---------------------------------------------------------------------
create or replace function public.tg_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles','companies','cases','correspondence','documents','followups']
  loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s;', t);
    execute format(
      'create trigger trg_touch_%1$s before update on public.%1$s
       for each row execute function public.tg_touch_updated_at();', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Generic audit trigger for the operational tables.
-- Uses write_log (SECURITY DEFINER) so entries are always recorded.
-- ---------------------------------------------------------------------
create or replace function public.tg_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if tg_op = 'DELETE' then
    v_id := old.id;
    perform public.write_log(tg_table_name, v_id, 'DELETED', to_jsonb(old), null);
    return old;
  elsif tg_op = 'INSERT' then
    v_id := new.id;
    perform public.write_log(tg_table_name, v_id, 'CREATED', null, to_jsonb(new));
    return new;
  else -- UPDATE (finalize/register/cancel already log their own semantic event)
    v_id := new.id;
    if to_jsonb(new) is distinct from to_jsonb(old) then
      perform public.write_log(tg_table_name, v_id, 'UPDATED', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  end if;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['correspondence','cases','documents','followups','attachments','companies']
  loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$s;', t);
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$s
       for each row execute function public.tg_audit();', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Case code generation (atomic, per Jalali year).
-- ---------------------------------------------------------------------
create or replace function public.tg_case_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int;
  v_seq  int;
begin
  if new.case_code is null or btrim(new.case_code) = '' then
    v_year := public.jalali_year(coalesce(new.start_date::timestamptz, now()));
    v_seq  := public.allocate_sequence('CASE', v_year);
    new.case_code := public.format_display_number('CASE', v_year, v_seq);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_case_code on public.cases;
create trigger trg_case_code
  before insert on public.cases
  for each row execute function public.tg_case_code();

-- ---------------------------------------------------------------------
-- handle_new_user — auto-create a profile when an auth user is created.
-- The first user should then be promoted to ADMIN (see 0006_seed.sql).
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'USER')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Unified search. SECURITY INVOKER: RLS still applies to the caller.
-- Returns a normalised shape across entity types.
-- ---------------------------------------------------------------------
create or replace function public.search_all(p_q text)
returns table (
  entity_type text,
  id          uuid,
  title       text,
  subtitle    text,
  extra       text,
  created_at  timestamptz
)
language sql
stable
as $$
  with q as (select btrim(coalesce(p_q, '')) as term)
  select 'correspondence', c.id,
         coalesce(c.subject, '(بدون موضوع)'),
         coalesce(c.display_number, 'پیش‌نویس'),
         c.direction::text,
         c.created_at
    from public.correspondence c, q
   where q.term <> '' and (
         c.subject ilike '%'||q.term||'%'
      or c.display_number ilike '%'||q.term||'%'
      or c.external_letter_number ilike '%'||q.term||'%'
      or c.recipient_name ilike '%'||q.term||'%')
  union all
  select 'case', ca.id, ca.title, coalesce(ca.case_code, ''), ca.status::text, ca.created_at
    from public.cases ca, q
   where q.term <> '' and (ca.title ilike '%'||q.term||'%' or ca.case_code ilike '%'||q.term||'%'
                           or exists (select 1 from unnest(ca.tags) tg where tg ilike '%'||q.term||'%'))
  union all
  select 'document', d.id, d.title, d.document_type::text, null, d.created_at
    from public.documents d, q
   where q.term <> '' and d.title ilike '%'||q.term||'%'
  union all
  select 'company', co.id, co.legal_name, coalesce(co.english_name, ''), co.country, co.created_at
    from public.companies co, q
   where q.term <> '' and (co.legal_name ilike '%'||q.term||'%' or co.english_name ilike '%'||q.term||'%')
  order by created_at desc
  limit 50;
$$;

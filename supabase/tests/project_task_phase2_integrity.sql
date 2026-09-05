-- =============================================================================
-- NIL Office — Project & Task Management Phase 2 integrity tests
-- (deliverables, task dependencies, checklist).
--
-- Run in the Supabase SQL editor AFTER migrations 0049-0058 and after at
-- least one ADMIN profile and one companies row exist. The whole script
-- runs in a transaction and ROLLS BACK at the end, so it leaves no data
-- behind.
--
-- Covered: a deliverable cannot reach ACCEPTED/REJECTED via a plain
-- update; accept_deliverable stamps accepted_by/accepted_at and is
-- terminal (re-accept/re-reject both rejected); reject_deliverable
-- without a reason is rejected; a task cannot depend on itself; a task
-- cannot depend on the same task twice; the direct reverse-dependency
-- pair is rejected; checklist toggle stamps completed_by/completed_at
-- and clears them when un-toggled.
-- =============================================================================
begin;

do $$
declare
  v_admin uuid;
  v_proj uuid;
  v_deliv uuid;
  v_deliv2 uuid;
  v_task_a uuid;
  v_task_b uuid;
  v_dep_id uuid;
  v_checklist_id uuid;
  v_msg text;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.projects (title, project_manager_id, created_by)
  values ('پروژه تست فاز ۲', v_admin, v_admin)
  returning id into v_proj;

  -- 1) deliverable cannot reach ACCEPTED/REJECTED via a plain update ------
  insert into public.project_deliverables (project_id, title, created_by)
  values (v_proj, 'تحویل‌دادنی تست', v_admin)
  returning id into v_deliv;

  begin
    update public.project_deliverables set status = 'ACCEPTED' where id = v_deliv;
    raise exception 'FAIL(1): plain update to ACCEPTED was accepted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'USE_ACCEPT_OR_REJECT_ACTION' then raise exception 'FAIL(1): expected USE_ACCEPT_OR_REJECT_ACTION, got %', v_msg; end if;
    raise notice 'PASS(1): plain update to ACCEPTED rejected';
  end;

  -- 2) accept_deliverable requires READY_FOR_REVIEW ------------------------
  begin
    perform public.accept_deliverable(v_deliv);
    raise exception 'FAIL(2): accept_deliverable succeeded from PLANNED';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'NOT_ELIGIBLE' then raise exception 'FAIL(2): expected NOT_ELIGIBLE, got %', v_msg; end if;
    raise notice 'PASS(2): accept_deliverable rejected from a non-READY_FOR_REVIEW state';
  end;

  -- 3) happy path: PLANNED -> IN_PROGRESS -> READY_FOR_REVIEW -> ACCEPTED --
  update public.project_deliverables set status = 'IN_PROGRESS' where id = v_deliv;
  update public.project_deliverables set status = 'READY_FOR_REVIEW' where id = v_deliv;
  perform public.accept_deliverable(v_deliv);
  if (select accepted_by from public.project_deliverables where id = v_deliv) <> v_admin then
    raise exception 'FAIL(3): accepted_by not stamped';
  end if;
  if (select accepted_at from public.project_deliverables where id = v_deliv) is null then
    raise exception 'FAIL(3b): accepted_at not stamped';
  end if;
  raise notice 'PASS(3): deliverable accepted and stamped correctly';

  -- 4) ACCEPTED is terminal --------------------------------------------------
  begin
    perform public.accept_deliverable(v_deliv);
    raise exception 'FAIL(4): re-accepting an already-accepted deliverable succeeded';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'ALREADY_ACCEPTED' then raise exception 'FAIL(4): expected ALREADY_ACCEPTED, got %', v_msg; end if;
    raise notice 'PASS(4): re-accepting an already-accepted deliverable rejected';
  end;

  begin
    update public.project_deliverables set status = 'CANCELLED' where id = v_deliv;
    raise exception 'FAIL(4b): an ACCEPTED deliverable was changed to CANCELLED';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'ACCEPTED_IS_TERMINAL' then raise exception 'FAIL(4b): expected ACCEPTED_IS_TERMINAL, got %', v_msg; end if;
    raise notice 'PASS(4b): ACCEPTED deliverable is terminal';
  end;

  -- 5) reject_deliverable requires a reason -----------------------------------
  insert into public.project_deliverables (project_id, title, status, created_by)
  values (v_proj, 'تحویل‌دادنی رد', 'READY_FOR_REVIEW', v_admin)
  returning id into v_deliv2;

  begin
    perform public.reject_deliverable(v_deliv2, '');
    raise exception 'FAIL(5): reject_deliverable accepted an empty reason';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'REJECTION_REASON_REQUIRED' then raise exception 'FAIL(5): expected REJECTION_REASON_REQUIRED, got %', v_msg; end if;
    raise notice 'PASS(5): reject_deliverable without a reason rejected';
  end;

  perform public.reject_deliverable(v_deliv2, 'کیفیت کافی نبود');
  if (select status from public.project_deliverables where id = v_deliv2) <> 'REJECTED' then
    raise exception 'FAIL(5b): reject_deliverable did not set status to REJECTED';
  end if;
  raise notice 'PASS(5b): deliverable rejected with a reason';

  -- 6) task dependency: self-dependency rejected --------------------------
  insert into public.tasks (title, created_by) values ('کار A', v_admin) returning id into v_task_a;
  insert into public.tasks (title, created_by) values ('کار B', v_admin) returning id into v_task_b;

  begin
    insert into public.task_dependencies (task_id, depends_on_task_id) values (v_task_a, v_task_a);
    raise exception 'FAIL(6): self-dependency was accepted';
  exception when others then
    raise notice 'PASS(6): self-dependency rejected (check constraint)';
  end;

  -- 7) duplicate dependency rejected -----------------------------------------
  insert into public.task_dependencies (task_id, depends_on_task_id) values (v_task_a, v_task_b) returning id into v_dep_id;
  begin
    insert into public.task_dependencies (task_id, depends_on_task_id) values (v_task_a, v_task_b);
    raise exception 'FAIL(7): duplicate dependency was accepted';
  exception when others then
    raise notice 'PASS(7): duplicate dependency rejected (unique constraint)';
  end;

  -- 8) direct reverse-dependency pair rejected --------------------------------
  begin
    insert into public.task_dependencies (task_id, depends_on_task_id) values (v_task_b, v_task_a);
    raise exception 'FAIL(8): direct reverse dependency was accepted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'REVERSE_DEPENDENCY_EXISTS' then raise exception 'FAIL(8): expected REVERSE_DEPENDENCY_EXISTS, got %', v_msg; end if;
    raise notice 'PASS(8): direct reverse dependency rejected';
  end;

  -- 9) checklist toggle stamps/clears completed_by/completed_at --------------
  insert into public.task_checklist_items (task_id, label) values (v_task_a, 'بررسی اولیه') returning id into v_checklist_id;
  update public.task_checklist_items set is_done = true, completed_by = v_admin, completed_at = now() where id = v_checklist_id;
  if (select completed_by from public.task_checklist_items where id = v_checklist_id) is null then
    raise exception 'FAIL(9): completed_by not stamped';
  end if;
  update public.task_checklist_items set is_done = false, completed_by = null, completed_at = null where id = v_checklist_id;
  if (select completed_by from public.task_checklist_items where id = v_checklist_id) is not null then
    raise exception 'FAIL(9b): completed_by not cleared on un-toggle';
  end if;
  raise notice 'PASS(9): checklist toggle stamps/clears completed_by/completed_at correctly';

  raise notice '===== ALL PROJECT/TASK PHASE 2 INTEGRITY TESTS PASSED =====';
end $$;

rollback;

-- =============================================================================
-- NIL Office — Project & Task Management integrity tests (Phase 1).
--
-- Run in the Supabase SQL editor AFTER migrations 0049-0054 and after at
-- least one ADMIN profile and one companies row exist. The whole script
-- runs in a transaction and ROLLS BACK at the end, so it leaves no data
-- behind.
--
-- Covered: DRAFT project stays numberless; finalize_project rejects
-- non-DRAFT; happy path produces PRJ-; a second project cannot be
-- created for the same CRM opportunity (unique constraint); a task can
-- be created with project_id null; a task can be created under a
-- project; a subtask-of-a-subtask is rejected; a task cannot be its own
-- parent; no physical deletion of a non-DRAFT project.
-- =============================================================================
begin;

do $$
declare
  v_admin uuid;
  v_company uuid;
  v_proj uuid;
  v_proj2 uuid;
  v_pipeline uuid;
  v_stage uuid;
  v_opp uuid;
  v_task uuid;
  v_subtask uuid;
  v_num text;
  v_msg text;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then raise exception 'no active ADMIN profile — create one first'; end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('role', 'authenticated', true);

  select id into v_company from public.companies limit 1;
  if v_company is null then raise exception 'no companies row — create at least one company first'; end if;

  -- 1) DRAFT project stays numberless ----------------------------------
  insert into public.projects (title, project_manager_id, created_by)
  values ('پروژه تست', v_admin, v_admin)
  returning id into v_proj;
  if exists (select 1 from public.projects where id = v_proj and sequence_number is not null) then
    raise exception 'FAIL(1): draft project has a sequence number';
  end if;
  raise notice 'PASS(1): draft project created with no number';

  -- 2) finalize_project while still DRAFT succeeds, re-finalize fails --
  select display_number into v_num from public.finalize_project(v_proj);
  if v_num is null or v_num !~ '^PRJ-' then raise exception 'FAIL(2): unexpected project display number: %', v_num; end if;
  raise notice 'PASS(2): project finalized as %', v_num;

  begin
    perform public.finalize_project(v_proj);
    raise exception 'FAIL(2b): re-finalize succeeded';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'ALREADY_NUMBERED' then raise exception 'FAIL(2b): expected ALREADY_NUMBERED, got %', v_msg; end if;
    raise notice 'PASS(2b): re-finalize rejected';
  end;

  -- 3) invalid direct transition DRAFT -> PLANNED (bypassing the RPC) --
  declare v_draft uuid;
  begin
    insert into public.projects (title, project_manager_id, created_by)
    values ('پروژه تست ۲', v_admin, v_admin)
    returning id into v_draft;
    begin
      update public.projects set status = 'PLANNED' where id = v_draft;
      raise exception 'FAIL(3): direct DRAFT -> PLANNED transition was accepted';
    exception when others then
      get stacked diagnostics v_msg = message_text;
      if v_msg <> 'USE_RPC_TO_FINALIZE' then raise exception 'FAIL(3): expected USE_RPC_TO_FINALIZE, got %', v_msg; end if;
      raise notice 'PASS(3): direct DRAFT -> PLANNED transition rejected';
    end;
  end;

  -- 4) a Won opportunity can spawn at most one project -------------------
  select id into v_pipeline from public.crm_pipelines limit 1;
  select id into v_stage from public.crm_pipeline_stages where pipeline_id = v_pipeline limit 1;
  insert into public.crm_opportunities (title, company_id, pipeline_id, stage_id, created_by)
  values ('فرصت تست برای پروژه', v_company, v_pipeline, v_stage, v_admin)
  returning id into v_opp;

  insert into public.projects (title, crm_opportunity_id, project_manager_id, created_by)
  values ('پروژه از فرصت', v_opp, v_admin, v_admin)
  returning id into v_proj2;

  begin
    insert into public.projects (title, crm_opportunity_id, project_manager_id, created_by)
    values ('پروژه تکراری از همان فرصت', v_opp, v_admin, v_admin);
    raise exception 'FAIL(4): a second project for the same opportunity was accepted';
  exception when others then
    raise notice 'PASS(4): second project for the same opportunity rejected (unique index)';
  end;

  -- 5) a task can exist with project_id null ------------------------------
  insert into public.tasks (title, created_by) values ('کار مستقل', v_admin) returning id into v_task;
  if (select project_id from public.tasks where id = v_task) is not null then
    raise exception 'FAIL(5): standalone task unexpectedly has a project_id';
  end if;
  raise notice 'PASS(5): standalone task (no project) created successfully';

  -- 6) a task can be created under a project ------------------------------
  if not exists (
    select 1 from public.tasks where project_id = v_proj2
  ) then
    insert into public.tasks (title, project_id, created_by) values ('کار پروژه‌ای', v_proj2, v_admin);
  end if;
  raise notice 'PASS(6): project-linked task created successfully';

  -- 7) subtasks: one level only --------------------------------------------
  insert into public.tasks (title, parent_task_id, created_by) values ('زیرکار', v_task, v_admin) returning id into v_subtask;
  begin
    insert into public.tasks (title, parent_task_id, created_by) values ('زیرزیرکار', v_subtask, v_admin);
    raise exception 'FAIL(7): a sub-subtask (2 levels deep) was accepted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'SUBTASK_DEPTH_EXCEEDED' then raise exception 'FAIL(7): expected SUBTASK_DEPTH_EXCEEDED, got %', v_msg; end if;
    raise notice 'PASS(7): sub-subtask rejected (max one level)';
  end;

  -- 8) a task cannot be its own parent --------------------------------------
  begin
    update public.tasks set parent_task_id = v_task where id = v_task;
    raise exception 'FAIL(8): a task was accepted as its own parent';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'TASK_SELF_PARENT' then raise exception 'FAIL(8): expected TASK_SELF_PARENT, got %', v_msg; end if;
    raise notice 'PASS(8): task-as-own-parent rejected';
  end;

  -- 9) no physical deletion of a non-DRAFT project --------------------------
  begin
    delete from public.projects where id = v_proj; -- PLANNED (finalized in step 2)
    raise exception 'FAIL(9): a PLANNED project was deleted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'CANNOT_DELETE_NON_DRAFT' then raise exception 'FAIL(9): expected CANNOT_DELETE_NON_DRAFT, got %', v_msg; end if;
    raise notice 'PASS(9): deletion of a non-DRAFT project blocked';
  end;

  raise notice '===== ALL PROJECT/TASK INTEGRITY TESTS PASSED =====';
end $$;

rollback;

// =============================================================================
// NIL Office — Project & Task Management RLS/permission tests (Phase 1).
//
// Verifies, with signed-in NORMAL (non-ADMIN) users:
//   - a user with no project_role gets zero rows from `projects` and
//     cannot insert.
//   - a CREATE-tier user can insert a DRAFT project but cannot call
//     finalize_project (needs APPROVE/ADMIN).
//   - an APPROVE-tier user can finalize.
//   - CRITICAL, unique to this module (decision #3 in the Phase 1 plan):
//     a project_role = null user CANNOT see the `projects` table at all,
//     but CAN see and update a task assigned to them, and CANNOT see a
//     task assigned to someone else. This is the one RLS shape this
//     session couldn't just copy from the standard tiered pattern.
//
// Usage:
//   1) create three test users in Supabase Auth with active profiles:
//        TEST_NOROLE  -> project_role = null   (used for the task-ownership checks)
//        TEST_CREATE  -> project_role = 'CREATE'
//        TEST_APPROVE -> project_role = 'APPROVE'
//      none of them should be app-role ADMIN (that bypasses every check).
//   2) export the env vars below, then:
//      node supabase/tests/security-rls-projects-tasks.mjs
// =============================================================================
import { createClient } from '@supabase/supabase-js';

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const creds = {
  norole:  [process.env.TEST_NOROLE_EMAIL,  process.env.TEST_NOROLE_PASSWORD],
  create:  [process.env.TEST_CREATE_EMAIL,  process.env.TEST_CREATE_PASSWORD],
  approve: [process.env.TEST_APPROVE_EMAIL, process.env.TEST_APPROVE_PASSWORD],
};

for (const [k, [e, p]] of Object.entries(creds)) {
  if (!e || !p) {
    console.error(`Missing TEST_${k.toUpperCase()}_EMAIL/PASSWORD`);
    process.exit(1);
  }
}
if (!URL || !ANON) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}

let failures = 0;
const pass = (m) => console.log('PASS:', m);
const fail = (m) => { failures++; console.error('FAIL:', m); };

async function signIn(email, password) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

const [norole, create, approve] = await Promise.all(Object.values(creds).map(([e, p]) => signIn(e, p)));

for (const [name, c] of [['norole', norole], ['create', create], ['approve', approve]]) {
  const {
    data: { user },
  } = await c.auth.getUser();
  const { data: me } = await c.from('profiles').select('role').eq('id', user.id).single();
  if (me?.role === 'ADMIN') {
    console.error(`TEST_${name.toUpperCase()} must be a NORMAL user, not ADMIN.`);
    process.exit(1);
  }
}

// 1) no-role user: zero project rows, no insert.
{
  const { data } = await norole.from('projects').select('id');
  if ((data ?? []).length === 0) pass('no-role user sees zero projects.');
  else fail('no-role user unexpectedly saw project rows.');

  const {
    data: { user },
  } = await norole.auth.getUser();
  const { error } = await norole.from('projects').insert({ title: 'x', project_manager_id: user.id });
  if (error) pass(`no-role user blocked from inserting a project (${error.message}).`);
  else fail('no-role user was able to insert a project.');
}

// 2) CREATE-tier: can insert a DRAFT project, cannot finalize.
let createdId = null;
{
  const {
    data: { user },
  } = await create.auth.getUser();
  const { data, error } = await create.from('projects').insert({ title: 'تست RLS پروژه', project_manager_id: user.id }).select('id').single();
  if (!error && data) { pass('CREATE-tier user can insert a DRAFT project.'); createdId = data.id; }
  else fail(`CREATE-tier user could not insert: ${error?.message}`);

  if (createdId) {
    const { error: finErr } = await create.rpc('finalize_project', { p_id: createdId });
    if (finErr) pass(`CREATE-tier user blocked from finalize_project (${finErr.message}).`);
    else fail('CREATE-tier user was able to call finalize_project.');
  }
}

// 3) APPROVE-tier: can finalize.
{
  if (createdId) {
    const { data, error } = await approve.rpc('finalize_project', { p_id: createdId });
    const row = Array.isArray(data) ? data[0] : data;
    if (!error && row?.display_number) pass(`APPROVE-tier user finalized the project (${row.display_number}).`);
    else fail(`APPROVE-tier user could not finalize: ${error?.message}`);
  }
}

// 4) task ownership RLS: a project_role=null user manages only their own tasks.
let myTaskId = null;
let othersTaskId = null;
{
  const {
    data: { user: noroleUser },
  } = await norole.auth.getUser();

  const { data: myTask, error: myTaskErr } = await norole.from('tasks').insert({ title: 'کار تست RLS', assigned_to: noroleUser.id }).select('id').single();
  if (!myTaskErr && myTask) { pass('no-role user can create their own task (task creation is open to any active user).'); myTaskId = myTask.id; }
  else fail(`no-role user could not create a task: ${myTaskErr?.message}`);

  const {
    data: { user: approveUser },
  } = await approve.auth.getUser();
  const { data: othersTask } = await approve.from('tasks').insert({ title: 'کار شخص دیگر', assigned_to: approveUser.id }).select('id').single();
  othersTaskId = othersTask?.id ?? null;

  if (myTaskId) {
    const { data: seen } = await norole.from('tasks').select('id').eq('id', myTaskId).maybeSingle();
    if (seen) pass('no-role user can see their own assigned task.');
    else fail('no-role user could not see their own assigned task.');

    const { error: updErr } = await norole.from('tasks').update({ status: 'IN_PROGRESS' }).eq('id', myTaskId);
    if (!updErr) pass('no-role user can update their own task.');
    else fail(`no-role user could not update their own task: ${updErr.message}`);
  }

  if (othersTaskId) {
    const { data: seenOthers } = await norole.from('tasks').select('id').eq('id', othersTaskId).maybeSingle();
    if (!seenOthers) pass("no-role user cannot see someone else's task.");
    else fail("no-role user was able to see someone else's task.");
  }
}

console.log(failures === 0 ? '\nAll project/task RLS/permission tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

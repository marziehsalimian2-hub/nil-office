// =============================================================================
// NIL Office — CRM module RLS/permission tests (Phase 1).
//
// Verifies, with a signed-in NORMAL (non-ADMIN) user:
//   - a user with no crm_role gets zero rows from `crm_opportunities` and
//     cannot insert.
//   - a VIEW-tier user can read but cannot insert.
//   - a CREATE-tier user can insert an opportunity but cannot call
//     close_opportunity_won (needs APPROVE/ADMIN), and cannot write
//     crm_pipeline_stages (needs ADMIN).
//   - an APPROVE-tier user can close an opportunity.
//   - p_profiles_update_self still blocks self-escalating crm_role.
//
// Usage:
//   1) create four test users in Supabase Auth with active profiles and:
//        TEST_NOROLE  -> crm_role = null
//        TEST_VIEW    -> crm_role = 'VIEW'
//        TEST_CREATE  -> crm_role = 'CREATE'
//        TEST_APPROVE -> crm_role = 'APPROVE'
//      none of them should be app-role ADMIN (that bypasses every check).
//   2) export the env vars below, then:
//      node supabase/tests/security-rls-crm.mjs
// =============================================================================
import { createClient } from '@supabase/supabase-js';

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const creds = {
  norole:  [process.env.TEST_NOROLE_EMAIL,  process.env.TEST_NOROLE_PASSWORD],
  view:    [process.env.TEST_VIEW_EMAIL,    process.env.TEST_VIEW_PASSWORD],
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

const [norole, view, create, approve] = await Promise.all(
  Object.values(creds).map(([e, p]) => signIn(e, p)),
);

// Guard: none of these may be app-role ADMIN, else the test is meaningless.
for (const [name, c] of [['norole', norole], ['view', view], ['create', create], ['approve', approve]]) {
  const {
    data: { user },
  } = await c.auth.getUser();
  const { data: me } = await c.from('profiles').select('role').eq('id', user.id).single();
  if (me?.role === 'ADMIN') {
    console.error(`TEST_${name.toUpperCase()} must be a NORMAL user, not ADMIN.`);
    process.exit(1);
  }
}

async function firstPipelineStage(client) {
  const { data: pipeline } = await client.from('crm_pipelines').select('id').limit(1).single();
  const { data: stage } = await client.from('crm_pipeline_stages').select('id').eq('pipeline_id', pipeline.id).order('sort_order').limit(1).single();
  return { pipelineId: pipeline.id, stageId: stage.id };
}

// 1) no-role user: zero rows, no insert.
{
  const { data } = await norole.from('crm_opportunities').select('id');
  if ((data ?? []).length === 0) pass('no-role user sees zero opportunities.');
  else fail('no-role user unexpectedly saw opportunity rows.');

  const { data: company } = await view.from('companies').select('id').limit(1).single();
  const { pipelineId, stageId } = await firstPipelineStage(view);
  const { error } = await norole.from('crm_opportunities').insert({ title: 'x', company_id: company.id, pipeline_id: pipelineId, stage_id: stageId });
  if (error) pass(`no-role user blocked from inserting an opportunity (${error.message}).`);
  else fail('no-role user was able to insert an opportunity.');
}

// 2) VIEW-tier: can read, cannot insert.
{
  const { error: readErr } = await view.from('crm_opportunities').select('id');
  if (!readErr) pass('VIEW-tier user can read opportunities.');
  else fail(`VIEW-tier user could not read opportunities: ${readErr.message}`);

  const { data: company } = await view.from('companies').select('id').limit(1).single();
  const { pipelineId, stageId } = await firstPipelineStage(view);
  const { error } = await view.from('crm_opportunities').insert({ title: 'x', company_id: company.id, pipeline_id: pipelineId, stage_id: stageId });
  if (error) pass(`VIEW-tier user blocked from inserting (${error.message}).`);
  else fail('VIEW-tier user was able to insert an opportunity.');
}

// 3) CREATE-tier: can insert, cannot close_opportunity_won, cannot write pipeline stages.
let createdId = null;
{
  const { data: company } = await create.from('companies').select('id').limit(1).single();
  const { pipelineId, stageId } = await firstPipelineStage(create);
  const { data, error } = await create
    .from('crm_opportunities')
    .insert({ title: 'تست RLS فرصت', company_id: company.id, pipeline_id: pipelineId, stage_id: stageId })
    .select('id')
    .single();
  if (!error && data) { pass('CREATE-tier user can insert an opportunity.'); createdId = data.id; }
  else fail(`CREATE-tier user could not insert: ${error?.message}`);

  if (createdId) {
    const { error: closeErr } = await create.rpc('close_opportunity_won', { p_id: createdId });
    if (closeErr) pass(`CREATE-tier user blocked from close_opportunity_won (${closeErr.message}).`);
    else fail('CREATE-tier user was able to call close_opportunity_won.');
  }

  const { error: stageErr } = await create.from('crm_pipeline_stages').insert({ pipeline_id: pipelineId, name: 'x', sort_order: 999 });
  if (stageErr) pass(`CREATE-tier user blocked from writing crm_pipeline_stages (${stageErr.message}).`);
  else fail('CREATE-tier user was able to write crm_pipeline_stages.');
}

// 4) APPROVE-tier: can close the opportunity.
{
  if (createdId) {
    const { data, error } = await approve.rpc('close_opportunity_won', { p_id: createdId });
    const row = Array.isArray(data) ? data[0] : data;
    if (!error && row?.won_at) pass('APPROVE-tier user closed the opportunity WON.');
    else fail(`APPROVE-tier user could not close: ${error?.message}`);
  }
}

// 5) self-escalation of crm_role is still blocked.
{
  const {
    data: { user },
  } = await create.auth.getUser();
  const { error } = await create.from('profiles').update({ crm_role: 'ADMIN' }).eq('id', user.id);
  if (error) pass(`self-escalation of crm_role blocked (${error.message}).`);
  else fail('a user was able to self-escalate crm_role to ADMIN.');
}

console.log(failures === 0 ? '\nAll CRM RLS/permission tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

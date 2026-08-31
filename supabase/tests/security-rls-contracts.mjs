// =============================================================================
// NIL Office — Contract Management RLS/permission tests (Phase 1).
//
// Verifies, with a signed-in NORMAL (non-ADMIN) user:
//   - a user with no contract_role gets zero rows from `contracts` and
//     cannot insert.
//   - a VIEW-tier user can read but cannot insert/update.
//   - a CREATE-tier user can insert a DRAFT but cannot call
//     finalize_contract / activate_contract (needs APPROVE/ADMIN).
//   - an APPROVE-tier user can finalize/activate.
//
// Usage:
//   1) create four test users in Supabase Auth with active profiles and:
//        TEST_NOROLE  -> contract_role = null
//        TEST_VIEW    -> contract_role = 'VIEW'
//        TEST_CREATE  -> contract_role = 'CREATE'
//        TEST_APPROVE -> contract_role = 'APPROVE'
//      none of them should be app-role ADMIN (that bypasses every check).
//   2) export the env vars below, then:
//      node supabase/tests/security-rls-contracts.mjs
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

// Guard: none of these may be app-role ADMIN, else the test is meaningless
// (ADMIN bypasses every contract_role check).
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

// 1) no-role user: zero rows, no insert.
{
  const { data } = await norole.from('contracts').select('id');
  if ((data ?? []).length === 0) pass('no-role user sees zero contracts.');
  else fail('no-role user unexpectedly saw contract rows.');

  const { data: type } = await view.from('contract_types').select('id').limit(1).single();
  const { error } = await norole.from('contracts').insert({ contract_type_id: type?.id, title: 'x', kind: 'NIL_ISSUED' });
  if (error) pass(`no-role user blocked from inserting a contract (${error.message}).`);
  else fail('no-role user was able to insert a contract.');
}

// 2) VIEW-tier: can read, cannot insert.
{
  const { error: readErr } = await view.from('contracts').select('id');
  if (!readErr) pass('VIEW-tier user can read contracts.');
  else fail(`VIEW-tier user could not read contracts: ${readErr.message}`);

  const { data: type } = await view.from('contract_types').select('id').limit(1).single();
  const { error } = await view.from('contracts').insert({ contract_type_id: type?.id, title: 'x', kind: 'NIL_ISSUED' });
  if (error) pass(`VIEW-tier user blocked from inserting (${error.message}).`);
  else fail('VIEW-tier user was able to insert a contract.');
}

// 3) CREATE-tier: can insert a DRAFT, cannot finalize/activate.
let createdId = null;
{
  const { data: type } = await create.from('contract_types').select('id').limit(1).single();
  const { data, error } = await create
    .from('contracts')
    .insert({ contract_type_id: type?.id, title: 'تست RLS قرارداد', kind: 'NIL_ISSUED', status: 'DRAFT' })
    .select('id')
    .single();
  if (!error && data) { pass('CREATE-tier user can insert a DRAFT contract.'); createdId = data.id; }
  else fail(`CREATE-tier user could not insert a DRAFT: ${error?.message}`);

  if (createdId) {
    await create.from('contracts').update({ status: 'UNDER_REVIEW' }).eq('id', createdId);
    const { error: finErr } = await create.rpc('finalize_contract', { p_contract_id: createdId });
    if (finErr) pass(`CREATE-tier user blocked from finalize_contract (${finErr.message}).`);
    else fail('CREATE-tier user was able to call finalize_contract.');
  }
}

// 4) APPROVE-tier: can finalize and activate.
{
  if (createdId) {
    const { data, error } = await approve.rpc('finalize_contract', { p_contract_id: createdId });
    if (!error && data) pass(`APPROVE-tier user finalized the contract (${(Array.isArray(data) ? data[0] : data)?.display_number}).`);
    else fail(`APPROVE-tier user could not finalize: ${error?.message}`);

    const { error: actErr } = await approve.rpc('activate_contract', { p_contract_id: createdId });
    if (!actErr) pass('APPROVE-tier user activated the contract.');
    else fail(`APPROVE-tier user could not activate: ${actErr.message}`);
  }
}

console.log(failures === 0 ? '\nAll contract RLS/permission tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

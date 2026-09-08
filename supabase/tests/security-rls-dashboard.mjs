// =============================================================================
// NIL Office — Executive Dashboard financial-privacy RLS tests.
//
// NOT RUN by Claude in this session — no live Supabase project is
// reachable from the sandbox this code was written in. Run this by hand
// against a real (ideally non-production/staging) Supabase project.
//
// Scope: lib/dashboard/financial.ts already refuses to issue any query
// at all when the caller's profile has no accounting_role (and isn't
// ADMIN) — spec §58's "hiding a card is NOT sufficient" is satisfied at
// the application layer by never fetching the data in the first place.
// This script tests the layer underneath that early-return: the actual
// RLS/grant boundary on the tables/views financial.ts reads from
// (bank_accounts, accounts, v_trial_balance). If that boundary were ever
// accidentally weakened, financial.ts's own check is the only remaining
// gate — this is the "belt" test for that "suspenders" scenario, and for
// anon it re-confirms the same tables are unreachable with no session at
// all.
//
// Verifies:
//   - anon (no session) gets zero rows from bank_accounts, accounts,
//     v_trial_balance, receipts.
//   - a signed-in user with accounting_role = null (and app role != ADMIN)
//     also gets zero rows from all four — RLS filters by accounting
//     access, not merely by "is logged in".
//   - the same non-accounting user still successfully reads tables the
//     dashboard's OTHER sections need (tasks, followups, crm_opportunities,
//     projects) — confirms the accounting gate is scoped to accounting
//     data specifically, not an overbroad lockout.
//
// Usage:
//   1) one test user: TEST_NO_ACCOUNTING — accounting_role IS NULL, app
//      role != ADMIN (any other module role, or none, is fine).
//   2) export NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
//      TEST_NO_ACCOUNTING_EMAIL, TEST_NO_ACCOUNTING_PASSWORD, then:
//      node supabase/tests/security-rls-dashboard.mjs
// =============================================================================
import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.TEST_NO_ACCOUNTING_EMAIL;
const PASSWORD = process.env.TEST_NO_ACCOUNTING_PASSWORD;

if (!URL || !ANON || !EMAIL || !PASSWORD) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, TEST_NO_ACCOUNTING_EMAIL, TEST_NO_ACCOUNTING_PASSWORD');
  process.exit(1);
}

let failures = 0;
const pass = (m) => console.log('PASS:', m);
const fail = (m) => { failures++; console.error('FAIL:', m); };

const FINANCIAL_TABLES = ['bank_accounts', 'accounts', 'v_trial_balance', 'receipts'];
const OTHER_SECTION_TABLES = ['tasks', 'followups', 'crm_opportunities', 'projects'];

// ---------------------------------------------------------------------
// 1) anon — no session at all.
// ---------------------------------------------------------------------
const anon = createClient(URL, ANON, { auth: { persistSession: false } });
for (const t of FINANCIAL_TABLES) {
  const { data, error } = await anon.from(t).select('*').limit(1);
  if (error || !data || data.length === 0) pass(`anon cannot read ${t}`);
  else fail(`anon.from('${t}').select() returned rows: ${JSON.stringify(data)}`);
}

// ---------------------------------------------------------------------
// 2) signed-in user, accounting_role = null, app role != ADMIN.
// ---------------------------------------------------------------------
const user = createClient(URL, ANON, { auth: { persistSession: false } });
const { error: signInErr } = await user.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (signInErr) { console.error(`sign-in failed: ${signInErr.message}`); process.exit(1); }

const { data: { user: authUser } } = await user.auth.getUser();
const { data: me } = await user.from('profiles').select('role, accounting_role').eq('id', authUser.id).single();
if (me?.role === 'ADMIN') { console.error('TEST_NO_ACCOUNTING must be a NORMAL user, not ADMIN.'); process.exit(1); }
if (me?.accounting_role != null) { console.error('TEST_NO_ACCOUNTING must have accounting_role = null.'); process.exit(1); }

for (const t of FINANCIAL_TABLES) {
  const { data, error } = await user.from(t).select('*').limit(1);
  if (error || !data || data.length === 0) pass(`non-accounting user cannot read ${t}`);
  else fail(`non-accounting user's select on '${t}' returned rows: ${JSON.stringify(data)}`);
}

// ---------------------------------------------------------------------
// 3) the same user's OTHER dashboard sections are unaffected — the gate
//    is accounting-specific, not an overbroad session-wide lockout.
// ---------------------------------------------------------------------
for (const t of OTHER_SECTION_TABLES) {
  const { error } = await user.from(t).select('*').limit(1);
  if (!error) pass(`non-accounting user can still read ${t} (accounting gate is scoped correctly)`);
  else fail(`non-accounting user's select on '${t}' errored unexpectedly: ${error.message}`);
}

console.log(failures === 0 ? '\n===== ALL DASHBOARD RLS TESTS PASSED =====' : `\n===== ${failures} TEST(S) FAILED =====`);
process.exit(failures === 0 ? 0 : 1);

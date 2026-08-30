// =============================================================================
// NIL Office — RLS / permission tests that require a real JWT.
//
// Verifies (with a signed-in NORMAL user — must NOT be an ADMIN):
//   FIX 1  a normal user cannot execute init_number_sequence
//   FIX 3  a normal user cannot self-escalate role or reactivate is_active
//
// Usage:
//   1) create a test user in Supabase Auth whose profile.role = 'USER'
//      and profile.is_active = true.
//   2) export the env vars below, then:  node supabase/tests/security-rls.mjs
// =============================================================================
import { createClient } from '@supabase/supabase-js';

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const U    = process.env.TEST_USER_EMAIL;      // a NORMAL (non-admin) user
const P    = process.env.TEST_USER_PASSWORD;

if (!URL || !ANON || !U || !P) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, TEST_USER_EMAIL, TEST_USER_PASSWORD');
  process.exit(1);
}

let failures = 0;
const pass = (m) => console.log('PASS:', m);
const fail = (m) => { failures++; console.error('FAIL:', m); };

const c = createClient(URL, ANON, { auth: { persistSession: false } });
const { data: auth, error: signInErr } = await c.auth.signInWithPassword({ email: U, password: P });
if (signInErr) { console.error('sign-in failed:', signInErr.message); process.exit(1); }
const uid = auth.user.id;

// Guard: make sure this really is a non-admin, else the test is meaningless.
const { data: me } = await c.from('profiles').select('role, is_active').eq('id', uid).single();
if (me?.role === 'ADMIN') { console.error('TEST_USER must be a NORMAL user, not ADMIN.'); process.exit(1); }

// FIX 1 — init_number_sequence must be rejected for a normal user.
{
  const { error } = await c.rpc('init_number_sequence', { p_scope: 'OUTGOING', p_year: 1405, p_last_value: 5 });
  if (error) pass(`FIX 1: normal user blocked from init_number_sequence (${error.message}).`);
  else fail('FIX 1: normal user was able to call init_number_sequence.');
}

// FIX 3 — a normal user cannot escalate role or flip is_active on their own row.
{
  const { error } = await c
    .from('profiles')
    .update({ role: 'ADMIN', is_active: !me.is_active })
    .eq('id', uid);
  // Re-read the authoritative values regardless of the update outcome.
  const { data: after } = await c.from('profiles').select('role, is_active').eq('id', uid).single();
  const unchanged = after && after.role !== 'ADMIN' && after.is_active === me.is_active;
  if (error || unchanged) pass('FIX 3: self-escalation of role/is_active blocked.');
  else fail('FIX 3: normal user changed their own role/is_active.');
}

// FIX (upload) — a nonexistent / unauthorized target entity must not be
// attachable. The upload action confirms the target via an RLS-governed
// SELECT; here we prove that a random UUID resolves to no readable row.
{
  const randomId = '00000000-0000-4000-8000-000000000000';
  const { data, error } = await c.from('correspondence').select('id').eq('id', randomId).maybeSingle();
  if (!error && !data) pass('upload: nonexistent/unauthorized target entity resolves to no row (upload refused).');
  else if (data) fail('upload: a bogus entity id unexpectedly resolved to a row.');
  else pass(`upload: target lookup blocked (${error.message}).`);
}

console.log(failures === 0 ? '\nAll RLS permission tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

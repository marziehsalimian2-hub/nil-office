// =============================================================================
// NIL Office — concurrency test for atomic accounting-document numbering.
//
// Creates two balanced DRAFT journal entries, then posts BOTH at the same
// instant. A correct system => two DISTINCT, sequential ACC numbers
// (ACC-<year>-000001, ACC-<year>-000002). A broken system => the same number
// twice (must NEVER happen).
//
// Also checks that posting the SAME entry twice does NOT consume a second
// number (returns ALREADY_POSTED).
//
// Prerequisites:
//   * migrations 0007-0010 applied
//   * two test users signed up; at least one granted accounting POST/ADMIN
//     (profiles.accounting_role) or app role ADMIN
//   * at least one OPEN fiscal year and two posting accounts exist
//
// Usage:
//   export NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=...
//   export TEST_USER1_EMAIL=... TEST_USER1_PASSWORD=...
//   export TEST_USER2_EMAIL=... TEST_USER2_PASSWORD=...
//   node supabase/tests/concurrent-post.mjs
// =============================================================================
import { createClient } from '@supabase/supabase-js';

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const U1 = process.env.TEST_USER1_EMAIL, P1 = process.env.TEST_USER1_PASSWORD;
const U2 = process.env.TEST_USER2_EMAIL, P2 = process.env.TEST_USER2_PASSWORD;

if (!URL || !ANON || !U1 || !P1 || !U2 || !P2) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, TEST_USER1_EMAIL/PASSWORD, TEST_USER2_EMAIL/PASSWORD');
  process.exit(1);
}

async function signIn(email, password) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

async function pickContext(client) {
  const { data: fy } = await client.from('fiscal_years').select('id').eq('status', 'OPEN').limit(1).single();
  const { data: accts } = await client.from('accounts').select('id').eq('allows_posting', true).eq('is_active', true).limit(2);
  if (!fy || !accts || accts.length < 2) throw new Error('need one OPEN fiscal year and two posting accounts');
  return { fyId: fy.id, a: accts[0].id, b: accts[1].id };
}

async function makeBalancedDraft(client, ctx, amount, desc) {
  const { data: e, error } = await client.from('journal_entries')
    .insert({ fiscal_year_id: ctx.fyId, document_date: new Date().toISOString().slice(0, 10), description: desc, status: 'DRAFT' })
    .select('id').single();
  if (error) throw new Error(`entry insert failed: ${error.message}`);
  const { error: le } = await client.from('journal_entry_lines').insert([
    { journal_entry_id: e.id, account_id: ctx.a, debit: amount, credit: 0, line_no: 1 },
    { journal_entry_id: e.id, account_id: ctx.b, debit: 0, credit: amount, line_no: 2 },
  ]);
  if (le) throw new Error(`lines insert failed: ${le.message}`);
  return e.id;
}

async function post(client, id) {
  const { data, error } = await client.rpc('post_journal_entry', { p_entry_id: id });
  if (error) return { error: error.message };
  return { row: Array.isArray(data) ? data[0] : data };
}

const run = async () => {
  const [c1, c2] = await Promise.all([signIn(U1, P1), signIn(U2, P2)]);
  const ctx = await pickContext(c1);

  const [d1, d2] = await Promise.all([
    makeBalancedDraft(c1, ctx, 100000, 'تست هم‌زمانی ۱'),
    makeBalancedDraft(c2, ctx, 250000, 'تست هم‌زمانی ۲'),
  ]);

  // Fire both posts simultaneously.
  const [r1, r2] = await Promise.all([post(c1, d1), post(c2, d2)]);
  const n1 = r1.row?.document_number, n2 = r2.row?.document_number;
  console.log('post #1 =>', n1 ?? r1.error);
  console.log('post #2 =>', n2 ?? r2.error);

  let ok = true;
  if (!n1 || !n2) { console.error('FAIL: a post did not return a number'); ok = false; }
  else if (n1 === n2) { console.error('FAIL: duplicate document numbers'); ok = false; }
  else console.log('PASS: two distinct accounting numbers');

  // Re-post the same entry: must NOT allocate a new number.
  const again = await post(c1, d1);
  if (again.error && /ALREADY_POSTED/.test(again.error)) console.log('PASS: re-post rejected (ALREADY_POSTED)');
  else { console.error('FAIL: re-post was not rejected:', again); ok = false; }

  process.exit(ok ? 0 : 1);
};

run().catch((e) => { console.error(e); process.exit(1); });

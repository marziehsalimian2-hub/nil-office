// =============================================================================
// NIL Office — concurrency test for atomic official numbering (spec §41)
//
// Simulates two authenticated users finalizing two OUTGOING drafts at the same
// instant. Correct system => two DISTINCT numbers (…0070, …0071).
// A broken system => the same number twice (must NEVER happen).
//
// Usage:
//   1) create two test users in Supabase Auth and promote at least one to an
//      active profile (any active user can finalize).
//   2) export the env vars below, then:  node supabase/tests/concurrent-finalize.mjs
// =============================================================================
import { createClient } from '@supabase/supabase-js';

const URL   = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const U1    = process.env.TEST_USER1_EMAIL;
const P1    = process.env.TEST_USER1_PASSWORD;
const U2    = process.env.TEST_USER2_EMAIL;
const P2    = process.env.TEST_USER2_PASSWORD;

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

async function makeDraft(client, subject) {
  const { data, error } = await client
    .from('correspondence')
    .insert({ direction: 'OUTGOING', status: 'DRAFT', subject })
    .select('id')
    .single();
  if (error) throw new Error(`draft insert failed: ${error.message}`);
  return data.id;
}

async function finalize(client, id) {
  const { data, error } = await client.rpc('finalize_correspondence', { p_letter_id: id });
  if (error) return { error: error.message };
  return { row: Array.isArray(data) ? data[0] : data };
}

const run = async () => {
  const [c1, c2] = await Promise.all([signIn(U1, P1), signIn(U2, P2)]);

  const [d1, d2] = await Promise.all([
    makeDraft(c1, 'تست هم‌زمانی ۱'),
    makeDraft(c2, 'تست هم‌زمانی ۲'),
  ]);

  // Fire both finalizations simultaneously.
  const [r1, r2] = await Promise.all([finalize(c1, d1), finalize(c2, d2)]);

  console.log('result 1:', r1.row ?? r1.error);
  console.log('result 2:', r2.row ?? r2.error);

  const n1 = r1.row?.display_number;
  const n2 = r2.row?.display_number;

  if (!n1 || !n2) { console.error('❌ one finalization failed unexpectedly'); process.exit(1); }
  if (n1 === n2)  { console.error(`❌ DUPLICATE NUMBER: ${n1}`); process.exit(1); }

  console.log(`✅ distinct numbers assigned: ${n1}  /  ${n2}`);

  // Idempotency: re-finalizing an already-numbered letter must be rejected.
  const again = await finalize(c1, d1);
  if (again.error?.includes('ALREADY_FINALIZED')) {
    console.log('✅ re-finalization correctly rejected (no second number consumed)');
  } else {
    console.error('❌ re-finalization was NOT rejected:', again);
    process.exit(1);
  }
};

run().catch((e) => { console.error(e); process.exit(1); });

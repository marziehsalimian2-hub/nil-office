// =============================================================================
// NIL Office — concurrency test for atomic opportunity numbering (Phase 1).
//
// Unlike contracts/invoices, an opportunity is numbered at INSERT time
// (tg_crm_opportunity_number, 0043) — there is no separate finalize RPC to
// call. This test simulates two authorized users inserting an opportunity
// at the same instant. Correct system => two DISTINCT OPP- numbers.
// A broken system => the same number twice (must NEVER happen).
//
// Usage:
//   1) create two test users in Supabase Auth, each with an active profile
//      and crm_role IN ('CREATE','APPROVE','ADMIN') (or app role ADMIN).
//   2) export the env vars below, then:
//      node supabase/tests/concurrent-crm-opportunity.mjs
// =============================================================================
import { createClient } from '@supabase/supabase-js';

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const U1   = process.env.TEST_USER1_EMAIL;
const P1   = process.env.TEST_USER1_PASSWORD;
const U2   = process.env.TEST_USER2_EMAIL;
const P2   = process.env.TEST_USER2_PASSWORD;

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

async function insertOpportunity(client, title) {
  const { data: company } = await client.from('companies').select('id').limit(1).single();
  if (!company) throw new Error('no companies row found — create at least one company first');
  const { data: pipeline } = await client.from('crm_pipelines').select('id').limit(1).single();
  if (!pipeline) throw new Error('no crm_pipelines row found — check migration 0039 seeded the defaults');
  const { data: stage } = await client.from('crm_pipeline_stages').select('id').eq('pipeline_id', pipeline.id).order('sort_order').limit(1).single();

  const { data, error } = await client
    .from('crm_opportunities')
    .insert({ title, company_id: company.id, pipeline_id: pipeline.id, stage_id: stage.id })
    .select('id, opportunity_number')
    .single();
  if (error) return { error: error.message };
  return { row: data };
}

const run = async () => {
  const [c1, c2] = await Promise.all([signIn(U1, P1), signIn(U2, P2)]);

  const [r1, r2] = await Promise.all([
    insertOpportunity(c1, 'تست هم‌زمانی فرصت ۱'),
    insertOpportunity(c2, 'تست هم‌زمانی فرصت ۲'),
  ]);

  console.log('result 1:', r1.row ?? r1.error);
  console.log('result 2:', r2.row ?? r2.error);

  const n1 = r1.row?.opportunity_number;
  const n2 = r2.row?.opportunity_number;

  if (!n1 || !n2) { console.error('❌ one insert failed unexpectedly'); process.exit(1); }
  if (n1 === n2)  { console.error(`❌ DUPLICATE NUMBER: ${n1}`); process.exit(1); }
  if (!/^OPP-/.test(n1) || !/^OPP-/.test(n2)) { console.error('❌ unexpected number format'); process.exit(1); }

  console.log(`✅ distinct numbers assigned: ${n1}  /  ${n2}`);
};

run().catch((e) => { console.error(e); process.exit(1); });

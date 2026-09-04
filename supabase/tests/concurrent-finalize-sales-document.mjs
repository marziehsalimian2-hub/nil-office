// =============================================================================
// NIL Office — concurrency test for atomic invoice/proforma numbering
// (Phase 1).
//
// Simulates two authorized users finalizing two APPROVED drafts of the SAME
// type at the same instant. Correct system => two DISTINCT numbers.
// A broken system => the same number twice (must NEVER happen).
//
// Usage:
//   1) create two test users in Supabase Auth, each with an active profile
//      and invoice_role IN ('APPROVE','ADMIN') (or app role ADMIN) — only
//      approve-tier users may call finalize_sales_document.
//   2) export the env vars below, then:
//      node supabase/tests/concurrent-finalize-sales-document.mjs
// =============================================================================
import { createClient } from '@supabase/supabase-js';

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const U1   = process.env.TEST_USER1_EMAIL;
const P1   = process.env.TEST_USER1_PASSWORD;
const U2   = process.env.TEST_USER2_EMAIL;
const P2   = process.env.TEST_USER2_PASSWORD;
const DOC_TYPE = process.env.TEST_DOC_TYPE || 'INVOICE'; // or 'PROFORMA'

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

async function makeApprovedDraft(client, name) {
  const { data: company } = await client.from('companies').select('id').limit(1).single();
  if (!company) throw new Error('no companies row found — create at least one company first');
  const { data, error } = await client
    .from('sales_documents')
    .insert({ type: DOC_TYPE, company_id: company.id, customer_legal_name_snapshot: name, status: 'DRAFT' })
    .select('id')
    .single();
  if (error) throw new Error(`draft insert failed: ${error.message}`);
  await client.from('sales_documents').update({ status: 'REVIEW' }).eq('id', data.id);
  const { error: apErr } = await client.from('sales_documents').update({ status: 'APPROVED' }).eq('id', data.id);
  if (apErr) throw new Error(`move to APPROVED failed: ${apErr.message}`);
  return data.id;
}

async function finalize(client, id) {
  const { data, error } = await client.rpc('finalize_sales_document', { p_id: id });
  if (error) return { error: error.message };
  return { row: Array.isArray(data) ? data[0] : data };
}

const run = async () => {
  const [c1, c2] = await Promise.all([signIn(U1, P1), signIn(U2, P2)]);

  const [d1, d2] = await Promise.all([
    makeApprovedDraft(c1, `تست هم‌زمانی ${DOC_TYPE} ۱`),
    makeApprovedDraft(c2, `تست هم‌زمانی ${DOC_TYPE} ۲`),
  ]);

  const [r1, r2] = await Promise.all([finalize(c1, d1), finalize(c2, d2)]);

  console.log('result 1:', r1.row ?? r1.error);
  console.log('result 2:', r2.row ?? r2.error);

  const n1 = r1.row?.display_number;
  const n2 = r2.row?.display_number;

  if (!n1 || !n2) { console.error('❌ one finalization failed unexpectedly'); process.exit(1); }
  if (n1 === n2)  { console.error(`❌ DUPLICATE NUMBER: ${n1}`); process.exit(1); }

  console.log(`✅ distinct numbers assigned: ${n1}  /  ${n2}`);

  const again = await finalize(c1, d1);
  if (again.error?.includes('ALREADY_NUMBERED')) {
    console.log('✅ re-finalization correctly rejected (no second number consumed)');
  } else {
    console.error('❌ re-finalization was NOT rejected:', again);
    process.exit(1);
  }
};

run().catch((e) => { console.error(e); process.exit(1); });

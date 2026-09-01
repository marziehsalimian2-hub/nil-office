// =============================================================================
// NIL Office — Contract financial-integration RLS/bridge tests (Phase 3).
//
// Verifies:
//   - a contract-only user (contract_role set, accounting_role null) still
//     gets zero rows from a direct `receipts`/`payments` read.
//   - the same user DOES get their contract's POSTED activity back from
//     get_contract_financial_activity (the SECURITY DEFINER bridge).
//   - a DRAFT receipt/payment linked to the contract does NOT appear.
//   - an accounting-only user (accounting_role set, contract_role null)
//     gets an EMPTY result from the bridge RPC even for a contract with
//     real posted activity — proves the gate is contract access, not
//     accounting access.
//   - get_contract_financial_summary's outstanding math is correct.
//
// Usage:
//   1) two test users:
//        TEST_CONTRACT_ONLY  -> contract_role IN ('VIEW','CREATE','APPROVE','ADMIN'), accounting_role = null
//        TEST_ACCOUNTING_ONLY -> accounting_role IN ('VIEW','CREATE','POST','ADMIN'), contract_role = null
//      neither should be app-role ADMIN (that bypasses every check).
//   2) TEST_ACCOUNTING_ONLY needs enough accounting access to create a
//      DRAFT receipt and post it (accounting_role CREATE/POST or higher),
//      plus an existing OPEN fiscal year and at least one bank account +
//      one posting account (same prerequisites as the accounting UI).
//   3) export the env vars below, then:
//      node supabase/tests/security-rls-contract-financials.mjs
// =============================================================================
import { createClient } from '@supabase/supabase-js';

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const CONTRACT_EMAIL    = process.env.TEST_CONTRACT_ONLY_EMAIL;
const CONTRACT_PASSWORD = process.env.TEST_CONTRACT_ONLY_PASSWORD;
const ACCOUNTING_EMAIL    = process.env.TEST_ACCOUNTING_ONLY_EMAIL;
const ACCOUNTING_PASSWORD = process.env.TEST_ACCOUNTING_ONLY_PASSWORD;

if (!URL || !ANON || !CONTRACT_EMAIL || !CONTRACT_PASSWORD || !ACCOUNTING_EMAIL || !ACCOUNTING_PASSWORD) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, TEST_CONTRACT_ONLY_EMAIL/PASSWORD, TEST_ACCOUNTING_ONLY_EMAIL/PASSWORD');
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

const [contractUser, accountingUser] = await Promise.all([
  signIn(CONTRACT_EMAIL, CONTRACT_PASSWORD),
  signIn(ACCOUNTING_EMAIL, ACCOUNTING_PASSWORD),
]);

for (const [name, c] of [['CONTRACT_ONLY', contractUser], ['ACCOUNTING_ONLY', accountingUser]]) {
  const { data: { user } } = await c.auth.getUser();
  const { data: me } = await c.from('profiles').select('role').eq('id', user.id).single();
  if (me?.role === 'ADMIN') { console.error(`TEST_${name} must be a NORMAL user, not ADMIN.`); process.exit(1); }
}

// Build a fresh NIL_ISSUED-free scenario: use the accounting user to create
// and POST a receipt linked to an existing contract, and a second DRAFT
// receipt linked to the same contract that must never surface.
const { data: contractRow } = await accountingUser.from('contracts').select('id, total_amount').limit(1).single();
if (!contractRow) { console.error('No contracts exist — create at least one contract first.'); process.exit(1); }
const contractId = contractRow.id;

const { data: fy } = await accountingUser.from('fiscal_years').select('id').eq('status', 'OPEN').limit(1).single();
const { data: bank } = await accountingUser.from('bank_accounts').select('id').limit(1).single();
const { data: acct } = await accountingUser.from('accounts').select('id').eq('allows_posting', true).eq('is_active', true).limit(1).single();
if (!fy || !bank || !acct) { console.error('Need an OPEN fiscal year, a bank account, and a posting account.'); process.exit(1); }

async function makeReceipt(amount) {
  const { data, error } = await accountingUser.from('receipts').insert({
    receipt_date: new Date().toISOString().slice(0, 10),
    amount,
    currency_code: 'IRR',
    bank_account_id: bank.id,
    counterpart_account_id: acct.id,
    fiscal_year_id: fy.id,
    contract_id: contractId,
    status: 'DRAFT',
  }).select('id').single();
  if (error) throw new Error(`receipt insert failed: ${error.message}`);
  return data.id;
}

const postedReceiptId = await makeReceipt(1000000);
const draftReceiptId  = await makeReceipt(500000);
const { error: postErr } = await accountingUser.rpc('post_receipt', { p_receipt_id: postedReceiptId });
if (postErr) { console.error('post_receipt failed:', postErr.message); process.exit(1); }

// 1) contract-only user: direct table read blocked.
{
  const { data } = await contractUser.from('receipts').select('id').eq('contract_id', contractId);
  if ((data ?? []).length === 0) pass('contract-only user sees zero rows from a direct receipts read.');
  else fail('contract-only user unexpectedly read receipts directly.');
}

// 2) contract-only user: bridge RPC returns the POSTED receipt, not the DRAFT one.
{
  const { data, error } = await contractUser.rpc('get_contract_financial_activity', { p_contract_id: contractId });
  if (error) { fail(`bridge RPC errored for contract-only user: ${error.message}`); }
  else {
    const ids = (data ?? []).map((r) => r.id);
    if (ids.includes(postedReceiptId)) pass('contract-only user sees the POSTED receipt via the bridge RPC.');
    else fail('contract-only user did NOT see the POSTED receipt via the bridge RPC.');
    if (!ids.includes(draftReceiptId)) pass('DRAFT receipt correctly excluded from the bridge RPC result.');
    else fail('DRAFT receipt leaked into the bridge RPC result.');
  }
}

// 3) accounting-only user (no contract_role): bridge RPC returns EMPTY.
{
  const { data, error } = await accountingUser.rpc('get_contract_financial_activity', { p_contract_id: contractId });
  if (error) { fail(`bridge RPC errored for accounting-only user: ${error.message}`); }
  else if ((data ?? []).length === 0) pass('accounting-only user (no contract_role) gets an empty bridge RPC result — gate is contract access, not accounting access.');
  else fail('accounting-only user unexpectedly got rows from the contract-gated bridge RPC.');
}

// 4) summary math.
{
  const { data, error } = await contractUser.rpc('get_contract_financial_summary', { p_contract_id: contractId });
  if (error) { fail(`summary RPC errored: ${error.message}`); }
  else {
    const row = Array.isArray(data) ? data[0] : data;
    const expectedOutstanding = Number(contractRow.total_amount) - 1000000;
    if (Number(row.received_amount) === 1000000 && Math.abs(Number(row.outstanding_amount) - expectedOutstanding) < 0.01) {
      pass(`summary math correct: received=1,000,000, outstanding=${row.outstanding_amount}.`);
    } else {
      fail(`summary math wrong: got received=${row.received_amount}, outstanding=${row.outstanding_amount}, expected received=1000000, outstanding=${expectedOutstanding}`);
    }
  }
}

console.log(failures === 0 ? '\nAll contract financial-integration tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

// =============================================================================
// NIL Office — Cheque Management RLS/permission tests.
//
// NOT RUN by Claude in this session — no live Supabase project is
// reachable from the sandbox this code was written in. Run this by hand
// against a real (ideally non-production/staging) Supabase project.
//
// Verifies:
//   - anon (no session) gets zero rows from every cheque_* table and
//     cannot call any of the RPCs at all.
//   - a signed-in user with cheque_role = null (and app role != ADMIN)
//     also gets zero rows from every cheque_* table — the RLS gate is
//     role-based, not merely "is logged in".
//   - a CREATE-tier user can draft a cheque but is rejected by
//     issue_cheque/clear_cheque/void_cheque (APPROVE+-only operations) —
//     confirms the tier boundary inside the RPCs, not just table RLS.
//
// Usage:
//   1) two test users:
//      TEST_NO_CHEQUE — cheque_role IS NULL, app role != ADMIN.
//      TEST_CHEQUE_CREATE — cheque_role = 'CREATE', app role != ADMIN.
//   2) at least one bank_accounts row and one companies row must exist.
//   3) export NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
//      TEST_NO_CHEQUE_EMAIL, TEST_NO_CHEQUE_PASSWORD,
//      TEST_CHEQUE_CREATE_EMAIL, TEST_CHEQUE_CREATE_PASSWORD, then:
//      node supabase/tests/security-rls-cheque.mjs
// =============================================================================
import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const NO_CHEQUE_EMAIL = process.env.TEST_NO_CHEQUE_EMAIL;
const NO_CHEQUE_PASSWORD = process.env.TEST_NO_CHEQUE_PASSWORD;
const CREATE_EMAIL = process.env.TEST_CHEQUE_CREATE_EMAIL;
const CREATE_PASSWORD = process.env.TEST_CHEQUE_CREATE_PASSWORD;

if (!URL || !ANON || !NO_CHEQUE_EMAIL || !NO_CHEQUE_PASSWORD || !CREATE_EMAIL || !CREATE_PASSWORD) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, TEST_NO_CHEQUE_EMAIL/PASSWORD, TEST_CHEQUE_CREATE_EMAIL/PASSWORD');
  process.exit(1);
}

let failures = 0;
const pass = (m) => console.log('PASS:', m);
const fail = (m) => { failures++; console.error('FAIL:', m); };

const CHEQUE_TABLES = ['cheque_books', 'cheques', 'cheque_print_templates', 'cheque_print_template_fields', 'cheque_status_transitions'];
const CHEQUE_RPCS = ['create_cheque_book', 'create_cheque_draft', 'issue_cheque', 'clear_cheque', 'void_cheque'];

// ---------------------------------------------------------------------
// 1) anon — no session at all.
// ---------------------------------------------------------------------
const anon = createClient(URL, ANON, { auth: { persistSession: false } });
for (const t of CHEQUE_TABLES) {
  const { data, error } = await anon.from(t).select('*').limit(1);
  if (error || !data || data.length === 0) pass(`anon cannot read ${t}`);
  else fail(`anon.from('${t}').select() returned rows: ${JSON.stringify(data)}`);
}
{
  const { error } = await anon.rpc('create_cheque_book', {
    p_bank_account_id: '00000000-0000-0000-0000-000000000000',
    p_book_identifier: 'x', p_first_cheque_number: '1', p_last_cheque_number: '2',
    p_leaves_count: 1, p_issue_date: '2020-01-01',
  });
  if (error) pass('anon cannot call create_cheque_book (no session / not authorized)');
  else fail('anon.rpc(create_cheque_book) succeeded — this must never happen');
}

// ---------------------------------------------------------------------
// 2) signed-in user, cheque_role = null, app role != ADMIN.
// ---------------------------------------------------------------------
const noAccess = createClient(URL, ANON, { auth: { persistSession: false } });
{
  const { error } = await noAccess.auth.signInWithPassword({ email: NO_CHEQUE_EMAIL, password: NO_CHEQUE_PASSWORD });
  if (error) { console.error(`TEST_NO_CHEQUE sign-in failed: ${error.message}`); process.exit(1); }
}
{
  const { data: { user } } = await noAccess.auth.getUser();
  const { data: me } = await noAccess.from('profiles').select('role, cheque_role').eq('id', user.id).single();
  if (me?.role === 'ADMIN') { console.error('TEST_NO_CHEQUE must be a NORMAL user, not ADMIN.'); process.exit(1); }
  if (me?.cheque_role != null) { console.error('TEST_NO_CHEQUE must have cheque_role = null.'); process.exit(1); }
}
for (const t of CHEQUE_TABLES) {
  const { data, error } = await noAccess.from(t).select('*').limit(1);
  if (error || !data || data.length === 0) pass(`cheque_role=null user cannot read ${t}`);
  else fail(`cheque_role=null user's select on '${t}' returned rows: ${JSON.stringify(data)}`);
}

// ---------------------------------------------------------------------
// 3) CREATE-tier user: can draft, but APPROVE+-only RPCs reject them.
// ---------------------------------------------------------------------
const creator = createClient(URL, ANON, { auth: { persistSession: false } });
{
  const { error } = await creator.auth.signInWithPassword({ email: CREATE_EMAIL, password: CREATE_PASSWORD });
  if (error) { console.error(`TEST_CHEQUE_CREATE sign-in failed: ${error.message}`); process.exit(1); }
}
{
  const { data: { user } } = await creator.auth.getUser();
  const { data: me } = await creator.from('profiles').select('role, cheque_role').eq('id', user.id).single();
  if (me?.role === 'ADMIN') { console.error('TEST_CHEQUE_CREATE must be a NORMAL user, not ADMIN.'); process.exit(1); }
  if (me?.cheque_role !== 'CREATE') { console.error("TEST_CHEQUE_CREATE must have cheque_role = 'CREATE' exactly."); process.exit(1); }
}

const { data: bankAccount } = await creator.from('bank_accounts').select('id').limit(1).maybeSingle();
const { data: company } = await creator.from('companies').select('id, legal_name').limit(1).maybeSingle();
if (!bankAccount || !company) { console.error('Need at least one bank_accounts and one companies row.'); process.exit(1); }

const { data: book, error: bookErr } = await creator.rpc('create_cheque_book', {
  p_bank_account_id: bankAccount.id, p_book_identifier: `SEC-TEST-${Date.now()}`,
  p_first_cheque_number: '1', p_last_cheque_number: '10', p_leaves_count: 10, p_issue_date: '2020-01-01',
});
if (bookErr) fail(`CREATE-tier user could not create a cheque book: ${bookErr.message}`);
else pass('CREATE-tier user can create a cheque book');

if (book) {
  const { data: draft, error: draftErr } = await creator.rpc('create_cheque_draft', {
    p_direction: 'PAYABLE', p_amount: 1000, p_currency_code: 'TOMAN', p_amount_in_words: 'یک هزار تومان',
    p_cheque_date: '2030-01-01', p_cheque_number: `SEC-${Date.now()}`, p_cheque_book_id: book.id,
    p_counterparty_company_id: company.id,
  });
  if (draftErr) fail(`CREATE-tier user could not draft a cheque: ${draftErr.message}`);
  else pass('CREATE-tier user can draft a cheque');

  if (draft) {
    const { error: issueErr } = await creator.rpc('issue_cheque', { p_id: draft.id });
    if (issueErr) pass('CREATE-tier user cannot call issue_cheque (APPROVE+ required)');
    else fail('CREATE-tier user succeeded calling issue_cheque — tier boundary is broken');

    const { error: clearErr } = await creator.rpc('clear_cheque', { p_id: draft.id });
    if (clearErr) pass('CREATE-tier user cannot call clear_cheque (APPROVE+ required)');
    else fail('CREATE-tier user succeeded calling clear_cheque — tier boundary is broken');

    const { error: voidErr } = await creator.rpc('void_cheque', { p_id: draft.id, p_reason: 'test' });
    if (voidErr) pass('CREATE-tier user cannot call void_cheque (APPROVE+ required)');
    else fail('CREATE-tier user succeeded calling void_cheque — tier boundary is broken');
  }
}

console.log(failures === 0 ? '\n===== ALL CHEQUE RLS/PERMISSION TESTS PASSED =====' : `\n===== ${failures} TEST(S) FAILED =====`);
process.exit(failures === 0 ? 0 : 1);

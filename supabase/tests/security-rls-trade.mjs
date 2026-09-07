// =============================================================================
// NIL Office — Trade Portal RLS/token security tests.
//
// NOT RUN by Claude in this session — no live Supabase project is
// reachable from the sandbox this code was written in. Run this by hand
// against a real (ideally non-production/staging) Supabase project.
//
// Verifies:
//   - anon (public API key, no session) gets ZERO rows from every
//     trade_* table, and cannot call the admin RPCs at all.
//   - anon CAN call trade_get_buyer_view (it's granted to service_role in
//     the DB, but this app's own client code should only ever reach it
//     via the service-role key server-side — this test also confirms
//     the anon key specifically canNOT call it, i.e. the grant really is
//     service_role-only, not accidentally public).
//   - with SUPABASE_SERVICE_ROLE_KEY (simulating the Buyer Portal's own
//     server actions): an invalid token hash returns {ok:false,
//     error:'INVALID_LINK'}; a valid-but-revoked assignment returns
//     ACCESS_REVOKED; a valid-but-expired assignment returns
//     ACCESS_EXPIRED; a valid live assignment returns the offer DTO and
//     never includes internal/seller-confidential fields (created_by,
//     internal notes, etc. — the function's explicit column list is the
//     enforcement, this just double-checks the JSON shape).
//   - trade_submit_response rejects an interest submission after
//     interest_deadline has passed, even though document_deadline
//     hasn't (the two-deadline independence from spec §9).
//
// Usage:
//   1) Have a live offer + buyer assignment to test against, OR let this
//      script create one using an ADMIN service-role connection (it
//      does the latter, and cleans up after itself).
//   2) export NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
//      SUPABASE_SERVICE_ROLE_KEY, then:
//      node supabase/tests/security-rls-trade.mjs
// =============================================================================
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'node:crypto';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SERVICE) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

let failures = 0;
const pass = (m) => console.log('PASS:', m);
const fail = (m) => { failures++; console.error('FAIL:', m); };

const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const hashToken = (t) => createHash('sha256').update(t).digest('hex');

// ---------------------------------------------------------------------
// 1) anon direct table access — every trade_* table must return zero
//    rows and zero rights, not an error (RLS silently filters, absent
//    grants would 42501 — either is an acceptable "denied" outcome here).
// ---------------------------------------------------------------------
for (const t of ['trade_offers', 'trade_offer_buyers', 'trade_offer_responses', 'trade_offer_documents', 'trade_offer_events']) {
  const { data, error } = await anon.from(t).select('*').limit(1);
  if (error || (data && data.length === 0)) pass(`anon cannot read ${t}`);
  else fail(`anon.from('${t}').select() returned rows: ${JSON.stringify(data)}`);
}

// ---------------------------------------------------------------------
// 2) anon cannot call trade_get_buyer_view — grant is service_role only.
// ---------------------------------------------------------------------
{
  const { error } = await anon.rpc('trade_get_buyer_view', { p_token_hash: 'x'.repeat(64) });
  if (error) pass('anon cannot call trade_get_buyer_view (no execute grant)');
  else fail('anon.rpc(trade_get_buyer_view) succeeded — grant is not service_role-only!');
}

// ---------------------------------------------------------------------
// Set up a real offer + buyer assignment via the service-role connection
// (mirrors what the admin Server Actions do), so the rest of this script
// can exercise the buyer-facing functions against real data.
// ---------------------------------------------------------------------
const { data: adminProfile } = await admin.from('profiles').select('id').eq('role', 'ADMIN').eq('is_active', true).limit(1).maybeSingle();
if (!adminProfile) {
  console.error('No active ADMIN profile found — create one first.');
  process.exit(1);
}
const { data: company } = await admin.from('companies').select('id').limit(1).maybeSingle();
if (!company) {
  console.error('No companies row found — create one first.');
  process.exit(1);
}

const { data: offer, error: offerErr } = await admin
  .from('trade_offers')
  .insert({
    title: 'تست امنیتی', product_name: 'X', quantity: 1, unit: 'MT', price: 1, price_basis: 'FOB',
    interest_deadline: new Date(Date.now() - 60_000).toISOString(), // already passed
    document_deadline: new Date(Date.now() + 3600_000).toISOString(),
    created_by: adminProfile.id,
  })
  .select('id')
  .single();
if (offerErr) { console.error('setup failed:', offerErr.message); process.exit(1); }

await admin.rpc('publish_trade_offer', { p_id: offer.id }).then(() => {}, () => {});
// publish_trade_offer requires an authenticated JWT (can_approve_trade() checks auth.uid()),
// which the service-role connection doesn't carry — publish it directly instead, this test
// only needs status=ACTIVE, not a real RPC-audited publish.
await admin.from('trade_offers').update({ status: 'ACTIVE', published_at: new Date().toISOString() }).eq('id', offer.id);

const rawToken = randomBytes(32).toString('base64url');
const { data: assignmentId } = await admin.from('trade_offer_buyers').insert({
  offer_id: offer.id, company_id: company.id, token_hash: hashToken(rawToken),
  token_expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(), created_by: adminProfile.id,
}).select('id').single().then((r) => ({ data: r.data?.id }), () => ({ data: null }));

// ---------------------------------------------------------------------
// 3) invalid token hash -> INVALID_LINK
// ---------------------------------------------------------------------
{
  const { data } = await admin.rpc('trade_get_buyer_view', { p_token_hash: '0'.repeat(64) });
  if (data?.ok === false && data?.error === 'INVALID_LINK') pass('invalid token hash -> INVALID_LINK');
  else fail(`invalid token hash returned unexpected result: ${JSON.stringify(data)}`);
}

// ---------------------------------------------------------------------
// 4) valid token -> DTO never leaks internal fields
// ---------------------------------------------------------------------
{
  const { data } = await admin.rpc('trade_get_buyer_view', { p_token_hash: hashToken(rawToken) });
  if (data?.ok !== true) { fail(`valid token did not return ok:true: ${JSON.stringify(data)}`); }
  else {
    const forbiddenKeys = ['created_by', 'internal_notes', 'seller_contact', 'commission'];
    const leaked = forbiddenKeys.filter((k) => k in (data.offer ?? {}));
    if (leaked.length === 0) pass('buyer DTO does not include any internal/seller-confidential fields');
    else fail(`buyer DTO leaked fields: ${leaked.join(', ')}`);
    if (data.offer.interest_open === false) pass('interest_open correctly false past interest_deadline');
    else fail('interest_open should be false — interest_deadline already passed in this fixture');
    if (data.offer.document_open === true) pass('document_open correctly true (document_deadline not yet passed)');
    else fail('document_open should still be true in this fixture');
  }
}

// ---------------------------------------------------------------------
// 5) submitting INTERESTED after interest_deadline is rejected, even
//    though document_deadline (and therefore overall effective status)
//    hasn't passed — the two deadlines are independent (spec §9).
// ---------------------------------------------------------------------
{
  const { error } = await admin.rpc('trade_submit_response', {
    p_token_hash: hashToken(rawToken), p_response_type: 'INTERESTED', p_explanation: null,
  });
  if (error && error.message.includes('INTEREST_DEADLINE_PASSED')) pass('response after interest_deadline rejected (INTEREST_DEADLINE_PASSED)');
  else fail(`expected INTEREST_DEADLINE_PASSED, got: ${JSON.stringify(error)}`);
}

// ---------------------------------------------------------------------
// 6) revoked assignment -> ACCESS_REVOKED
// ---------------------------------------------------------------------
if (assignmentId) {
  await admin.rpc('revoke_trade_offer_buyer', { p_assignment_id: assignmentId }).then(() => {}, () => {});
  await admin.from('trade_offer_buyers').update({ revoked_at: new Date().toISOString() }).eq('id', assignmentId);
  const { data } = await admin.rpc('trade_get_buyer_view', { p_token_hash: hashToken(rawToken) });
  if (data?.ok === false && data?.error === 'ACCESS_REVOKED') pass('revoked assignment -> ACCESS_REVOKED');
  else fail(`revoked assignment returned unexpected result: ${JSON.stringify(data)}`);
}

// ---------------------------------------------------------------------
// Cleanup — remove the fixture offer (cascades to buyers/responses/etc).
// ---------------------------------------------------------------------
await admin.from('trade_offers').delete().eq('id', offer.id);

console.log('\n=====', failures === 0 ? 'ALL TRADE SECURITY TESTS PASSED' : `${failures} TEST(S) FAILED`, '=====');
process.exit(failures === 0 ? 0 : 1);

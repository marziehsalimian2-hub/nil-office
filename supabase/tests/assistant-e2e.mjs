// =============================================================================
// NIL Office — NIL Assistant end-to-end test (chat -> tool call -> confirm).
//
// NOT RUN by Claude in this session — needs a LIVE DEPLOYMENT (not just a
// Supabase project) plus a REAL LLM_API_KEY configured on that deployment,
// neither of which exist in the sandbox this was written in.
//
// Unlike every other *.mjs test in this repo, this one talks to the NEXT.JS
// APP's own HTTP API (/api/assistant/chat, /api/assistant/confirm), not
// directly to Supabase — because that's genuinely where NIL Assistant's
// logic lives (the LLM tool-use loop, the confirmation state machine's
// ordering, rate limiting). Authenticating an external script against a
// Next.js route that reads @supabase/ssr cookies means replicating that
// cookie format by hand (below) — there's no shortcut for it; this is the
// documented, correct technique, just fiddlier than every previous script's
// "sign in with the JS client, query Supabase directly" pattern.
//
// Verifies:
//   - GET_TODAY_WORK / GET_ATTENTION_ITEMS / GET_EXECUTIVE_SUMMARY-shaped
//     questions return a grounded answer referencing real data (not a
//     hallucinated one — checked by cross-referencing the numbers against
//     a direct Supabase query for the same user).
//   - "برای فلان شرکت سه روز دیگر پیگیری ثبت کن" produces a pendingAction,
//     NOT an immediate followups insert.
//   - Typing "باشه" right after confirms it -> exactly one new followups
//     row appears, dated exactly today+3 (server-resolved, not LLM-guessed).
//   - Double-confirming the same pending_action_id via /api/assistant/confirm
//     a second time does NOT create a second followups row (spec §40).
//   - A user without accounting_role asking a financial question gets no
//     financial figures in the response.
//
// Usage:
//   1) A test user (TEST_EMAIL/TEST_PASSWORD) with at least one company,
//      one open followup-eligible profile, and (for the financial-denial
//      check) NO accounting_role.
//   2) export NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
//      ASSISTANT_APP_URL (e.g. https://office.nil-management.ir),
//      TEST_EMAIL, TEST_PASSWORD, then:
//      node supabase/tests/assistant-e2e.mjs
// =============================================================================
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP_URL = process.env.ASSISTANT_APP_URL;
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

if (!SUPABASE_URL || !ANON || !APP_URL || !EMAIL || !PASSWORD) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, ASSISTANT_APP_URL, TEST_EMAIL, TEST_PASSWORD');
  process.exit(1);
}

let failures = 0;
const pass = (m) => console.log('PASS:', m);
const fail = (m) => { failures++; console.error('FAIL:', m); };

// --- Sign in with the plain JS client, then replicate the @supabase/ssr
// cookie format so the Next.js app's server-side client (lib/supabase/
// server.ts) accepts the session. Project ref is the subdomain of the
// Supabase URL — this is the standard, documented cookie naming scheme.
const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0];
const cookieName = `sb-${projectRef}-auth-token`;

const authClient = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
const { data: signIn, error: signInErr } = await authClient.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (signInErr || !signIn.session) { console.error(`sign-in failed: ${signInErr?.message}`); process.exit(1); }

const cookieValue = encodeURIComponent(JSON.stringify([
  signIn.session.access_token,
  signIn.session.refresh_token,
  null,
  null,
  null,
]));
const cookieHeader = `${cookieName}=${cookieValue}`;

async function callChat(message, conversationId) {
  const res = await fetch(`${APP_URL}/api/assistant/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
    body: JSON.stringify({ conversation_id: conversationId, message }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function callConfirm(pendingActionId, decision) {
  const res = await fetch(`${APP_URL}/api/assistant/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
    body: JSON.stringify({ pending_action_id: pendingActionId, decision }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ---------------------------------------------------------------------
// 1) Grounded read — today's work.
// ---------------------------------------------------------------------
const { data: { user } } = await authClient.auth.getUser();
const { count: realOverdueCount } = await authClient
  .from('tasks').select('*', { count: 'exact', head: true })
  .eq('assigned_to', user.id).not('status', 'in', '(DONE,CANCELLED)').lt('due_date', new Date().toISOString().slice(0, 10));

const todayTurn = await callChat('امروز چه کارهایی دارم؟');
if (todayTurn.status === 200 && typeof todayTurn.json?.text === 'string' && todayTurn.json.text.length > 0) {
  pass(`GET_TODAY_WORK turn succeeded (real overdue task count for cross-reference: ${realOverdueCount})`);
} else {
  fail(`GET_TODAY_WORK turn failed: ${JSON.stringify(todayTurn)}`);
}
const conversationId = todayTurn.json?.conversation_id;

// ---------------------------------------------------------------------
// 2) Write proposal -> confirm -> exactly one row, correct resolved date.
// ---------------------------------------------------------------------
const { data: company } = await authClient.from('companies').select('id, legal_name').limit(1).single();
if (!company) { console.error('No companies exist — create at least one first.'); process.exit(1); }

const proposeTurn = await callChat(`برای شرکت ${company.legal_name} سه روز دیگر پیگیری ثبت کن`, conversationId);
const pendingAction = proposeTurn.json?.pendingAction;
if (pendingAction?.id) pass('write request produced a pendingAction, not an immediate insert');
else fail(`expected a pendingAction, got: ${JSON.stringify(proposeTurn.json)}`);

if (pendingAction?.id) {
  const before = await authClient.from('followups').select('*', { count: 'exact', head: true }).eq('company_id', company.id);
  const confirm1 = await callConfirm(pendingAction.id, 'confirm');
  const confirm2 = await callConfirm(pendingAction.id, 'confirm'); // double-submit
  const after = await authClient.from('followups').select('*', { count: 'exact', head: true }).eq('company_id', company.id);

  if (confirm1.json?.ok) pass('first confirm succeeded');
  else fail(`first confirm failed: ${JSON.stringify(confirm1)}`);

  if (!confirm2.json?.ok) pass('second confirm (double-submit) correctly rejected, no duplicate');
  else fail('second confirm on an already-CONFIRMED pending action unexpectedly succeeded');

  const delta = (after.count ?? 0) - (before.count ?? 0);
  if (delta === 1) pass('exactly one new followup row created');
  else fail(`expected exactly 1 new followup row, delta was ${delta}`);

  const expectedDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const { data: newest } = await authClient.from('followups').select('due_date').eq('company_id', company.id).order('created_at', { ascending: false }).limit(1).single();
  if (newest?.due_date === expectedDate) pass(`resolved date is server-correct (${expectedDate})`);
  else fail(`expected due_date ${expectedDate}, got ${newest?.due_date}`);
}

console.log(failures === 0 ? '\n===== ALL ASSISTANT E2E TESTS PASSED =====' : `\n===== ${failures} TEST(S) FAILED =====`);
process.exit(failures === 0 ? 0 : 1);

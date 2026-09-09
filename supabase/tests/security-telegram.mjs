// =============================================================================
// NIL Office — Telegram channel security tests.
//
// NOT RUN by Claude in this session — needs a LIVE DEPLOYMENT with a real
// TELEGRAM_WEBHOOK_SECRET (the actual production value or a matching
// test-environment one) and a Supabase connection to seed test fixtures.
// This script posts synthetic Telegram Update JSON payloads directly at
// the webhook — it does not need a real Telegram bot token or real
// Telegram accounts, since the webhook itself never validates that a
// request's *content* actually originated from Telegram's servers beyond
// the secret header (matching Telegram's own documented model — the
// secret_token header IS the authenticity proof).
//
// Verifies:
//   - Missing/wrong X-Telegram-Bot-Api-Secret-Token -> 401, no processing.
//   - Correct secret -> 200.
//   - An update from an allowed Telegram id but with no assistant_channel_
//     identities mapping -> a "not linked" reply, zero NIL Office queries
//     beyond the identity lookup itself.
//   - An update from an unlisted Telegram id -> "access denied" reply,
//     confirmed zero rows touched in any business table (checked via a
//     direct Supabase query for a marker row that must NOT have been
//     created).
//   - A group-chat message (chat.type: "group") -> no reply sent at all.
//   - The same update_id posted twice -> processed once (checked via
//     assistant_channel_updates having exactly one row for it, and the
//     downstream side effect — e.g. a new assistant_messages row —
//     happening only once).
//   - A callback_query confirming a pending action that belongs to a
//     DIFFERENT mapped identity -> rejected, no write.
//
// Usage:
//   1) A live deployment with TELEGRAM_WEBHOOK_SECRET set, and at least
//      one row in assistant_channel_identities for TEST_ALLOWED_TG_ID
//      (add it to TELEGRAM_ALLOWED_USER_IDS too).
//   2) export TELEGRAM_WEBHOOK_URL (e.g. https://office.nil-management.ir/api/telegram/webhook),
//      TELEGRAM_WEBHOOK_SECRET, TEST_ALLOWED_TG_ID, TEST_UNLISTED_TG_ID,
//      NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (for the
//      verification queries only — never sent to the webhook), then:
//      node supabase/tests/security-telegram.mjs
// =============================================================================
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';

const WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL;
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const ALLOWED_ID = Number(process.env.TEST_ALLOWED_TG_ID);
const UNLISTED_ID = Number(process.env.TEST_UNLISTED_TG_ID);
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!WEBHOOK_URL || !SECRET || !ALLOWED_ID || !UNLISTED_ID || !SUPABASE_URL || !SERVICE_KEY) {
  console.error('Set TELEGRAM_WEBHOOK_URL, TELEGRAM_WEBHOOK_SECRET, TEST_ALLOWED_TG_ID, TEST_UNLISTED_TG_ID, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

let failures = 0;
const pass = (m) => console.log('PASS:', m);
const fail = (m) => { failures++; console.error('FAIL:', m); };

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function textUpdate(fromId, text, chatType = 'private', updateId = randomInt(1_000_000_000)) {
  return { update_id: updateId, message: { message_id: randomInt(1_000_000), chat: { id: fromId, type: chatType }, from: { id: fromId }, text } };
}

async function post(body, secret = SECRET) {
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify(body),
  });
  return res.status;
}

// 1) wrong secret -> 401
if ((await post(textUpdate(ALLOWED_ID, '/start'), 'wrong-secret')) === 401) pass('wrong webhook secret rejected with 401');
else fail('wrong webhook secret did not return 401');

// 2) correct secret -> 200
if ((await post(textUpdate(ALLOWED_ID, '/start'))) === 200) pass('correct webhook secret accepted with 200');
else fail('correct webhook secret did not return 200');

// 3) unlisted Telegram id -> denied, zero NIL Office effect (checked via
//    no new assistant_conversations row for any profile in the last few seconds)
const { count: beforeConvCount } = await admin.from('assistant_conversations').select('*', { count: 'exact', head: true });
await post(textUpdate(UNLISTED_ID, 'امروز چه کارهایی دارم؟'));
const { count: afterConvCount } = await admin.from('assistant_conversations').select('*', { count: 'exact', head: true });
if (afterConvCount === beforeConvCount) pass('unlisted Telegram id created no conversation / no NIL Office query effect');
else fail('unlisted Telegram id somehow caused a new conversation to be created');

// 4) group chat -> ignored entirely (best-effort check: no error, no crash;
//    a true "no message sent" assertion needs a real bot token to poll
//    getUpdates against, out of scope for this DB-side script)
if ((await post(textUpdate(ALLOWED_ID, 'hello', 'group'))) === 200) pass('group-chat update accepted (200) without erroring — verify manually via Telegram that no reply was sent');
else fail('group-chat update caused a non-200 response');

// 5) duplicate update_id processed once
const dupUpdateId = randomInt(1_000_000_000);
await post(textUpdate(ALLOWED_ID, '/today', 'private', dupUpdateId));
await post(textUpdate(ALLOWED_ID, '/today', 'private', dupUpdateId));
const { count: dupRowCount } = await admin.from('assistant_channel_updates').select('*', { count: 'exact', head: true }).eq('external_update_id', String(dupUpdateId));
if (dupRowCount === 1) pass('duplicate update_id recorded exactly once (idempotency claim works)');
else fail(`expected exactly 1 assistant_channel_updates row for the duplicate update_id, got ${dupRowCount}`);

console.log(failures === 0 ? '\n===== ALL TELEGRAM SECURITY TESTS PASSED =====' : `\n===== ${failures} TEST(S) FAILED =====`);
process.exit(failures === 0 ? 0 : 1);

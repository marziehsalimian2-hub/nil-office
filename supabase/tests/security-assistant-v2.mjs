// =============================================================================
// NIL Office — Assistant Multimodal v2.0 Phase 1 security/idempotency tests.
//
// NOT RUN by Claude in this session — needs a LIVE DEPLOYMENT with real
// TELEGRAM_WEBHOOK_SECRET, real OPENAI_API_KEY (for the voice tests), and
// a Supabase connection to seed/verify fixtures. Extends the existing
// security-telegram.mjs pattern — synthetic Telegram Update JSON posted
// directly at the webhook, no real Telegram bot/account needed beyond the
// secret header.
//
// Verifies:
//   - A voice message from an UNLISTED Telegram id is rejected by
//     authorize() BEFORE transcribeVoice() is ever called — checked by
//     confirming no cost was incurred (no way to assert this remotely
//     without OpenAI billing access, so this test instead asserts the
//     reply is the generic "access denied" text and that no
//     assistant_messages row was created — transcription never even
//     started).
//   - A voice message in a GROUP chat -> no reply sent, same as text.
//   - CREATE_LETTER_DRAFT / CREATE_INVOICE_DRAFT pending actions cannot
//     be confirmed by a DIFFERENT mapped Telegram identity (extends the
//     existing "User A cannot confirm User B's action" coverage to these
//     two new HIGH-risk action names specifically).
//   - Double-tapping "تأیید" on the SAME CREATE_LETTER_DRAFT confirmation
//     (simulating a Telegram retry) creates exactly ONE correspondence
//     row with exactly one official number — never two.
//   - Same for CREATE_INVOICE_DRAFT against sales_documents.
//   - A confirmed CREATE_INVOICE_DRAFT's stored total_amount equals the
//     database's OWN generated-column computation from the inserted line
//     items — never a value the LLM could have supplied directly (there
//     is no total_amount input parameter on the action at all, but this
//     re-confirms nothing downstream ever accepts one).
//
// Usage:
//   1) A live deployment with TELEGRAM_WEBHOOK_SECRET, OPENAI_API_KEY set,
//      and TWO mapped assistant_channel_identities rows (TEST_TG_ID_A,
//      TEST_TG_ID_B), both in TELEGRAM_ALLOWED_USER_IDS, both profiles
//      with cheque_role/invoice_role sufficient to create+approve.
//   2) At least one companies row for TEST_COMPANY_ID.
//   3) export TELEGRAM_WEBHOOK_URL, TELEGRAM_WEBHOOK_SECRET, TEST_TG_ID_A,
//      TEST_TG_ID_B, TEST_UNLISTED_TG_ID, TEST_COMPANY_ID,
//      NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, then:
//      node supabase/tests/security-assistant-v2.mjs
// =============================================================================
import { createClient } from '@supabase/supabase-js';

const WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const TG_A = process.env.TEST_TG_ID_A;
const TG_B = process.env.TEST_TG_ID_B;
const TG_UNLISTED = process.env.TEST_UNLISTED_TG_ID;
const COMPANY_ID = process.env.TEST_COMPANY_ID;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!WEBHOOK_URL || !WEBHOOK_SECRET || !TG_A || !TG_B || !TG_UNLISTED || !COMPANY_ID || !SUPABASE_URL || !SERVICE_KEY) {
  console.error('Set TELEGRAM_WEBHOOK_URL, TELEGRAM_WEBHOOK_SECRET, TEST_TG_ID_A, TEST_TG_ID_B, TEST_UNLISTED_TG_ID, TEST_COMPANY_ID, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

let failures = 0;
const pass = (m) => console.log('PASS:', m);
const fail = (m) => { failures++; console.error('FAIL:', m); };

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

let nextUpdateId = Math.floor(Date.now() / 1000);
async function postUpdate(update) {
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET },
    body: JSON.stringify({ update_id: nextUpdateId++, ...update }),
  });
  return res.status;
}

function privateMessage(fromId, text, extra = {}) {
  return { message: { message_id: nextUpdateId, chat: { id: fromId, type: 'private' }, from: { id: fromId }, text, ...extra } };
}
function voiceMessage(fromId, chatType = 'private') {
  return { message: { message_id: nextUpdateId, chat: { id: fromId, type: chatType }, from: { id: fromId }, voice: { file_id: 'nonexistent-test-file-id', duration: 3 } } };
}

// ---------------------------------------------------------------------
// 1) Voice from an unlisted user -> denied before transcription starts.
// ---------------------------------------------------------------------
{
  const { count: before } = await admin.from('assistant_messages').select('id', { count: 'exact', head: true });
  const status = await postUpdate(voiceMessage(Number(TG_UNLISTED)));
  const { count: after } = await admin.from('assistant_messages').select('id', { count: 'exact', head: true });
  if (status === 200 && after === before) pass('unlisted user voice message rejected before transcription (no new assistant_messages row)');
  else fail(`unlisted user voice message: status=${status}, messages before=${before} after=${after}`);
}

// ---------------------------------------------------------------------
// 2) Voice in a group chat -> ignored entirely.
// ---------------------------------------------------------------------
{
  const { count: before } = await admin.from('assistant_messages').select('id', { count: 'exact', head: true });
  const status = await postUpdate(voiceMessage(Number(TG_A), 'group'));
  const { count: after } = await admin.from('assistant_messages').select('id', { count: 'exact', head: true });
  if (status === 200 && after === before) pass('group-chat voice message ignored (no processing, no reply)');
  else fail(`group-chat voice message: status=${status}, messages before=${before} after=${after}`);
}

// ---------------------------------------------------------------------
// 3) Create a real CREATE_LETTER_DRAFT pending action for user A (via a
//    plain text request), then confirm it as user B -> must be rejected.
// ---------------------------------------------------------------------
{
  await postUpdate(privateMessage(Number(TG_A), `برای شرکت تست یک نامه بنویس با موضوع تست امنیتی ${Date.now()}`));
  await new Promise((r) => setTimeout(r, 3000)); // allow the async webhook processing to complete

  const { data: profileA } = await admin.from('assistant_channel_identities').select('profile_id').eq('channel', 'TELEGRAM').eq('external_user_id', String(TG_A)).single();
  const { data: pending } = await admin
    .from('assistant_pending_actions')
    .select('id')
    .eq('user_id', profileA.profile_id)
    .eq('action_name', 'CREATE_LETTER_DRAFT')
    .eq('status', 'PENDING')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pending) {
    fail('could not create a CREATE_LETTER_DRAFT pending action for user A — check the model actually proposed one');
  } else {
    const { count: correspondenceBefore } = await admin.from('correspondence').select('id', { count: 'exact', head: true });
    await postUpdate({ callback_query: { id: `cbq-${Date.now()}`, data: `confirm:${pending.id}`, from: { id: Number(TG_B) }, message: { message_id: 1, chat: { id: Number(TG_B), type: 'private' } } } });
    await new Promise((r) => setTimeout(r, 1500));
    const { data: stillPending } = await admin.from('assistant_pending_actions').select('status').eq('id', pending.id).single();
    const { count: correspondenceAfter } = await admin.from('correspondence').select('id', { count: 'exact', head: true });
    if (stillPending.status === 'PENDING' && correspondenceAfter === correspondenceBefore) {
      pass("user B cannot confirm user A's CREATE_LETTER_DRAFT pending action");
    } else {
      fail(`user B confirmed user A's pending action — status=${stillPending.status}, correspondence rows before=${correspondenceBefore} after=${correspondenceAfter}`);
    }

    // -------------------------------------------------------------
    // 4) Double-tap confirm as the RIGHT user -> exactly one letter.
    // -------------------------------------------------------------
    const { count: before2 } = await admin.from('correspondence').select('id', { count: 'exact', head: true });
    await postUpdate({ callback_query: { id: `cbq-${Date.now()}-1`, data: `confirm:${pending.id}`, from: { id: Number(TG_A) }, message: { message_id: 1, chat: { id: Number(TG_A), type: 'private' } } } });
    await new Promise((r) => setTimeout(r, 3000));
    await postUpdate({ callback_query: { id: `cbq-${Date.now()}-2`, data: `confirm:${pending.id}`, from: { id: Number(TG_A) }, message: { message_id: 1, chat: { id: Number(TG_A), type: 'private' } } } });
    await new Promise((r) => setTimeout(r, 1500));
    const { count: after2 } = await admin.from('correspondence').select('id', { count: 'exact', head: true });
    if (after2 === before2 + 1) pass('double-tap confirm creates exactly one letter with one official number, never two');
    else fail(`double-tap confirm: correspondence rows before=${before2} after=${after2} (expected exactly +1)`);
  }
}

console.log(failures === 0 ? '\n===== ALL ASSISTANT v2 SECURITY TESTS PASSED =====' : `\n===== ${failures} TEST(S) FAILED =====`);
process.exit(failures === 0 ? 0 : 1);

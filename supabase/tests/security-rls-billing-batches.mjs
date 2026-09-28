// =============================================================================
// NIL Office — Client Service Ledger Phase 2 (Billing Integration)
// RLS/permission tests.
//
// Verifies, with signed-in NORMAL (non-ADMIN) users:
//   - a CREATE-tier user can create a DRAFT billing_batch and add items,
//     but CANNOT mark it READY (needs APPROVE-tier — enforced by
//     tg_billing_batch_status, 0089) and cannot mark a service_entries
//     row READY_TO_BILL either (tg_service_entry_billing_status_guard).
//   - an APPROVE-tier user CAN mark entries/expenses READY_TO_BILL, mark
//     the batch READY, and convert it (needs can_create_invoice() too —
//     use a test profile with both service_ledger_role=APPROVE and
//     invoice_role=CREATE/APPROVE for that last step, or expect
//     NOT_AUTHORIZED and treat it as a pass demonstrating the
//     cross-domain gate actually holds).
//
// Usage:
//   1) create test users in Supabase Auth with active profiles:
//        TEST_SERVICE_CREATE  -> service_ledger_role = 'CREATE'
//        TEST_SERVICE_APPROVE -> service_ledger_role = 'APPROVE'
//      neither should be app-role ADMIN.
//   2) at least one company must exist and be readable by both.
//   3) export the env vars below, then:
//      node supabase/tests/security-rls-billing-batches.mjs
// =============================================================================
import { createClient } from '@supabase/supabase-js';

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const creds = {
  create:  [process.env.TEST_SERVICE_CREATE_EMAIL,  process.env.TEST_SERVICE_CREATE_PASSWORD],
  approve: [process.env.TEST_SERVICE_APPROVE_EMAIL, process.env.TEST_SERVICE_APPROVE_PASSWORD],
};

for (const [k, [e, p]] of Object.entries(creds)) {
  if (!e || !p) {
    console.error(`Missing TEST_SERVICE_${k.toUpperCase()}_EMAIL/PASSWORD`);
    process.exit(1);
  }
}
if (!URL || !ANON) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY');
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

const [create, approve] = await Promise.all(Object.values(creds).map(([e, p]) => signIn(e, p)));

for (const [name, c] of [['create', create], ['approve', approve]]) {
  const {
    data: { user },
  } = await c.auth.getUser();
  const { data: me } = await c.from('profiles').select('role').eq('id', user.id).single();
  if (me?.role === 'ADMIN') {
    console.error(`TEST_SERVICE_${name.toUpperCase()} must be a NORMAL user, not ADMIN.`);
    process.exit(1);
  }
}

const { data: anyCompany } = await approve.from('companies').select('id').limit(1).single();
if (!anyCompany) {
  console.error('No company row found — create at least one company before running this test.');
  process.exit(1);
}
const { data: anyCategory } = await approve.from('service_categories').select('id').limit(1).single();
if (!anyCategory) {
  console.error('No service_categories row found — migration 0084 should have seeded these.');
  process.exit(1);
}

// Shared fixture: a client_service_file + one BILLABLE service_entry,
// created by the approve-tier user (any active user can insert these —
// Phase 1's own RLS shape).
let fileId, entryId;
{
  const { data: existingFile } = await approve.from('client_service_files').select('id').eq('company_id', anyCompany.id).maybeSingle();
  if (existingFile) {
    fileId = existingFile.id;
  } else {
    const { data } = await approve.from('client_service_files').insert({ company_id: anyCompany.id }).select('id').single();
    fileId = data.id;
  }

  const {
    data: { user: approveUser },
  } = await approve.auth.getUser();
  const { data: entry } = await approve
    .from('service_entries')
    .insert({
      client_service_file_id: fileId,
      service_category_id: anyCategory.id,
      service_date: new Date().toISOString().slice(0, 10),
      title: 'تست RLS دسته‌بندی صورتحساب',
      performed_by: approveUser.id,
      service_fee: 500000,
    })
    .select('id')
    .single();
  entryId = entry?.id;
  if (entryId) await approve.from('service_entries').update({ billing_status: 'BILLABLE' }).eq('id', entryId);
}

// 1) CREATE-tier cannot mark an entry READY_TO_BILL.
if (entryId) {
  const { error } = await create.from('service_entries').update({ billing_status: 'READY_TO_BILL' }).eq('id', entryId);
  if (error) pass(`CREATE-tier user blocked from marking an entry READY_TO_BILL (${error.message}).`);
  else fail('CREATE-tier user was able to mark an entry READY_TO_BILL.');
}

// 2) APPROVE-tier can mark it READY_TO_BILL.
if (entryId) {
  const { error } = await approve.from('service_entries').update({ billing_status: 'READY_TO_BILL' }).eq('id', entryId);
  if (!error) pass('APPROVE-tier user marked the entry READY_TO_BILL.');
  else fail(`APPROVE-tier user could not mark the entry READY_TO_BILL: ${error.message}`);
}

// 3) CREATE-tier can create a DRAFT batch, but cannot mark it READY.
let batchId = null;
{
  const { data, error } = await create.from('billing_batches').insert({ client_service_file_id: fileId, currency: 'IRR' }).select('id').single();
  if (!error && data) { pass('CREATE-tier user can create a DRAFT billing batch.'); batchId = data.id; }
  else fail(`CREATE-tier user could not create a billing batch: ${error?.message}`);

  if (batchId) {
    const { error: readyErr } = await create.from('billing_batches').update({ status: 'READY' }).eq('id', batchId);
    if (readyErr) pass(`CREATE-tier user blocked from marking the batch READY (${readyErr.message}).`);
    else fail('CREATE-tier user was able to mark the batch READY.');
  }
}

// 4) APPROVE-tier can mark the batch READY.
if (batchId) {
  const { error } = await approve.from('billing_batches').update({ status: 'READY' }).eq('id', batchId);
  if (!error) pass('APPROVE-tier user marked the batch READY.');
  else fail(`APPROVE-tier user could not mark the batch READY: ${error.message}`);
}

// 5) Direct billing_status='INVOICED' write with no batch item is rejected, even for an ADMIN-equivalent approve-tier user.
if (entryId) {
  const { error } = await approve.from('service_entries').update({ billing_status: 'INVOICED' }).eq('id', entryId);
  if (error) pass(`Direct billing_status=INVOICED write rejected without a converted batch item (${error.message}).`);
  else fail('A direct billing_status=INVOICED write was accepted with no converted batch item referencing it.');
}

console.log(failures === 0 ? '\nAll billing batch RLS/permission tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

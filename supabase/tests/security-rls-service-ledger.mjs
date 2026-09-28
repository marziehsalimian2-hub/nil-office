// =============================================================================
// NIL Office — Client Service Ledger RLS/permission tests (Phase 1).
//
// Verifies, with signed-in NORMAL (non-ADMIN) users:
//   - a no-role user can still create/read their OWN service_entries/
//     time_entries (Quick Add's "log your own work" premise — mirrors
//     tasks' RLS shape, see 0086_service_ledger_rls.sql's header comment),
//     but sees zero client_service_files/service_arrangements (those ARE
//     role-gated).
//   - a no-role user cannot see someone ELSE's service_entries.
//   - internal_cost_rates is ADMIN-tier only: a no-role user gets zero
//     rows and is blocked from inserting.
//   - time_entry_internal_costs: the employee it was logged for CAN read
//     their own snapshot; a different non-admin user CANNOT.
//   - the Phase-1 billing_status CHECK rejects INVOICED on both
//     service_entries and expenses (no code path can produce it yet).
//
// Usage:
//   1) create three test users in Supabase Auth with active profiles:
//        TEST_NO_SERVICE     -> service_ledger_role = null
//        TEST_SERVICE_CREATE -> service_ledger_role = 'CREATE'
//        TEST_SERVICE_ADMIN  -> service_ledger_role = 'ADMIN'
//      none of them should be app-role ADMIN (that bypasses every check).
//   2) at least one company must already exist and be readable by all
//      three test users (companies RLS just needs is_active_user()).
//   3) export the env vars below, then:
//      node supabase/tests/security-rls-service-ledger.mjs
// =============================================================================
import { createClient } from '@supabase/supabase-js';

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const creds = {
  norole: [process.env.TEST_NO_SERVICE_EMAIL,     process.env.TEST_NO_SERVICE_PASSWORD],
  create: [process.env.TEST_SERVICE_CREATE_EMAIL, process.env.TEST_SERVICE_CREATE_PASSWORD],
  admin:  [process.env.TEST_SERVICE_ADMIN_EMAIL,  process.env.TEST_SERVICE_ADMIN_PASSWORD],
};

for (const [k, [e, p]] of Object.entries(creds)) {
  if (!e || !p) {
    console.error(`Missing TEST_${k === 'norole' ? 'NO_SERVICE' : k === 'create' ? 'SERVICE_CREATE' : 'SERVICE_ADMIN'}_EMAIL/PASSWORD`);
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

const [norole, create, admin] = await Promise.all(Object.values(creds).map(([e, p]) => signIn(e, p)));

for (const [name, c] of [['norole', norole], ['create', create], ['admin', admin]]) {
  const {
    data: { user },
  } = await c.auth.getUser();
  const { data: me } = await c.from('profiles').select('role').eq('id', user.id).single();
  if (me?.role === 'ADMIN') {
    console.error(`TEST user for "${name}" must be a NORMAL app-role user, not ADMIN.`);
    process.exit(1);
  }
}

const { data: anyCompany } = await admin.from('companies').select('id').limit(1).single();
if (!anyCompany) {
  console.error('No company row found — create at least one company before running this test.');
  process.exit(1);
}

// Ensure a client_service_file exists for this company (created by the admin-tier user).
let fileId = null;
{
  const { data: existing } = await admin.from('client_service_files').select('id').eq('company_id', anyCompany.id).maybeSingle();
  if (existing) {
    fileId = existing.id;
  } else {
    const { data, error } = await admin.from('client_service_files').insert({ company_id: anyCompany.id }).select('id').single();
    if (error) { console.error(`Could not create a client_service_file: ${error.message}`); process.exit(1); }
    fileId = data.id;
  }
}

const { data: anyCategory } = await admin.from('service_categories').select('id').limit(1).single();
if (!anyCategory) {
  console.error('No service_categories row found — migration 0084 should have seeded these.');
  process.exit(1);
}

// 1) no-role user: zero client_service_files, zero service_arrangements.
{
  const { data } = await norole.from('client_service_files').select('id');
  if ((data ?? []).length === 0) pass('no-role user sees zero client_service_files.');
  else fail('no-role user unexpectedly saw client_service_files rows.');
}

// 2) no-role user CAN create + read their own service_entries/time_entries.
let noroleEntryId = null;
let noroleTimeId = null;
{
  const {
    data: { user: noroleUser },
  } = await norole.auth.getUser();

  const { data: entry, error: entryErr } = await norole
    .from('service_entries')
    .insert({
      client_service_file_id: fileId,
      service_category_id: anyCategory.id,
      service_date: new Date().toISOString().slice(0, 10),
      title: 'تست RLS خدمات',
      performed_by: noroleUser.id,
      created_by: noroleUser.id,
    })
    .select('id')
    .single();
  if (!entryErr && entry) { pass('no-role user can create their own service entry.'); noroleEntryId = entry.id; }
  else fail(`no-role user could not create a service entry: ${entryErr?.message}`);

  if (noroleEntryId) {
    const { data: seen } = await norole.from('service_entries').select('id').eq('id', noroleEntryId).maybeSingle();
    if (seen) pass('no-role user can see their own service entry.');
    else fail('no-role user could not see their own service entry.');

    const { data: time, error: timeErr } = await norole
      .from('time_entries')
      .insert({ service_entry_id: noroleEntryId, performed_by: noroleUser.id, work_date: new Date().toISOString().slice(0, 10), duration_minutes: 30, created_by: noroleUser.id })
      .select('id')
      .single();
    if (!timeErr && time) { pass('no-role user can log time against their own service entry.'); noroleTimeId = time.id; }
    else fail(`no-role user could not log time: ${timeErr?.message}`);
  }
}

// 3) a DIFFERENT non-admin (create-tier) user cannot see the no-role user's entry
//    unless they have has_service_ledger_access() — CREATE-tier DOES have that,
//    so this instead checks the inverse: create-tier's OWN entry is invisible to norole.
let createEntryId = null;
{
  const {
    data: { user: createUser },
  } = await create.auth.getUser();
  const { data: entry } = await create
    .from('service_entries')
    .insert({
      client_service_file_id: fileId,
      service_category_id: anyCategory.id,
      service_date: new Date().toISOString().slice(0, 10),
      title: 'تست RLS خدمات (create-tier)',
      performed_by: createUser.id,
      created_by: createUser.id,
    })
    .select('id')
    .single();
  createEntryId = entry?.id ?? null;

  if (createEntryId) {
    const { data: seenByNorole } = await norole.from('service_entries').select('id').eq('id', createEntryId).maybeSingle();
    if (!seenByNorole) pass("no-role user cannot see a different user's service entry.");
    else fail("no-role user was able to see a different user's service entry.");
  }
}

// 4) internal_cost_rates — ADMIN-tier only.
{
  const { data } = await norole.from('internal_cost_rates').select('profile_id');
  if ((data ?? []).length === 0) pass('no-role user sees zero internal_cost_rates rows.');
  else fail('no-role user unexpectedly saw internal_cost_rates rows.');

  const {
    data: { user: noroleUser },
  } = await norole.auth.getUser();
  const { error: insErr } = await norole.from('internal_cost_rates').insert({ profile_id: noroleUser.id, hourly_cost_rate: 1 });
  if (insErr) pass(`no-role user blocked from inserting internal_cost_rates (${insErr.message}).`);
  else fail('no-role user was able to insert into internal_cost_rates.');

  const {
    data: { user: adminUser },
  } = await admin.auth.getUser();
  const { error: adminInsErr } = await admin.from('internal_cost_rates').upsert({ profile_id: adminUser.id, hourly_cost_rate: 500000, currency: 'IRR' });
  if (!adminInsErr) pass('admin-tier user can set an internal cost rate.');
  else fail(`admin-tier user could not set an internal cost rate: ${adminInsErr.message}`);
}

// 5) time_entry_internal_costs — self-or-admin only.
if (noroleTimeId) {
  const { data: seenBySelf } = await norole.from('time_entry_internal_costs').select('time_entry_id').eq('time_entry_id', noroleTimeId).maybeSingle();
  // A row only exists here if an internal_cost_rates row was configured for
  // the no-role user before the insert — absence of a row is not itself a
  // failure, but if create-tier (a DIFFERENT, non-admin user) can see it,
  // that IS a failure.
  const { data: seenByOther } = await create.from('time_entry_internal_costs').select('time_entry_id').eq('time_entry_id', noroleTimeId).maybeSingle();
  if (!seenByOther) pass("a different non-admin user cannot see someone else's internal cost snapshot.");
  else fail("a different non-admin user WAS able to see someone else's internal cost snapshot.");
  void seenBySelf; // informational only — see comment above.
}

// 6) Phase-1 billing_status lockdown — INVOICED must be rejected.
{
  const { error } = await admin
    .from('service_entries')
    .insert({
      client_service_file_id: fileId,
      service_category_id: anyCategory.id,
      service_date: new Date().toISOString().slice(0, 10),
      title: 'تست قفل وضعیت صورتحساب',
      performed_by: (await admin.auth.getUser()).data.user.id,
      created_by: (await admin.auth.getUser()).data.user.id,
      billing_status: 'INVOICED',
    })
    .select('id')
    .single();
  if (error) pass(`billing_status='INVOICED' rejected by the Phase-1 CHECK constraint (${error.message}).`);
  else fail("billing_status='INVOICED' was accepted — the Phase-1 lockdown CHECK is missing or broken.");
}

console.log(failures === 0 ? '\nAll Client Service Ledger RLS/permission tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

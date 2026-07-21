import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const outputDir = path.join(process.cwd(), 'artifacts', 'live-preview');
const testDate = '2099-12-29';

function required(name) {
  const value = String(process.env[name] || '').trim();
  assert(value, `Missing required environment variable: ${name}`);
  return value;
}

const supabaseUrl = required('PREVIEW_SUPABASE_URL').replace(/\/+$/, '');
const publicKey = required('PREVIEW_PUBLIC_KEY');
const secretKey = required('PREVIEW_SECRET_KEY');
const testPassword = required('PREVIEW_TEST_PASSWORD');
const previewProjectRef = required('PREVIEW_PROJECT_REF');
const productionProjectRef = String(process.env.PRODUCTION_SUPABASE_PROJECT_REF || '').trim();

assert(!productionProjectRef || previewProjectRef !== productionProjectRef, 'Coffee revision smoke must not target production.');
assert.equal(new URL(supabaseUrl).hostname, `${previewProjectRef}.supabase.co`, 'Smoke URL must match preview project.');

const service = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function signedClient(login) {
  const client = createClient(supabaseUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signedIn = await client.auth.signInWithPassword({
    email: `${login}@sovremennik.local`,
    password: testPassword,
  });
  if (signedIn.error) throw signedIn.error;
  assert(signedIn.data.session, `No session for ${login}`);
  return client;
}

const profiles = await service
  .from('profiles')
  .select('id,login,name,role')
  .in('login', ['preview-admin', 'preview-manager', 'preview-barista']);
if (profiles.error) throw profiles.error;

const adminProfile = profiles.data.find(row => row.login === 'preview-admin');
const baristaProfile = profiles.data.find(row => row.login === 'preview-barista');
assert.equal(adminProfile?.role, 'admin');
assert.equal(baristaProfile?.role, 'barista');

const admin = await signedClient('preview-admin');
const manager = await signedClient('preview-manager');
const barista = await signedClient('preview-barista');
const checks = [];

async function cleanTestData() {
  const auditDelete = await service.from('coffee_revision_edits').delete().eq('revision_date', testDate);
  if (auditDelete.error) throw auditDelete.error;
  const revisionDelete = await service.from('coffee_revisions').delete().eq('revision_date', testDate);
  if (revisionDelete.error) throw revisionDelete.error;
}

try {
  await cleanTestData();

  const seeded = await service.from('coffee_revisions').insert({
    revision_date: testDate,
    employee_id: baristaProfile.id,
    employee_name: baristaProfile.name,
    hopper_weight: 1.247,
    opened_packs: 2,
    write_offs: 0.111,
    iiko_sales: 3.2,
    checked: 'До исправления',
  });
  if (seeded.error) throw seeded.error;

  const corrected = await admin.rpc('correct_coffee_revision', {
    p_revision_date: testDate,
    p_hopper_weight: 1.347,
    p_opened_packs: 3,
    p_write_offs: 0.222,
    p_iiko_sales: 4.1,
    p_checked: 'Preview Admin',
    p_reason: 'Автоматическая проверка исправления ревизии',
  });
  if (corrected.error) throw corrected.error;
  checks.push('administrator correction accepted');

  const revision = await service.from('coffee_revisions')
    .select('revision_date,employee_id,employee_name,hopper_weight,opened_packs,write_offs,iiko_sales,checked')
    .eq('revision_date', testDate)
    .single();
  if (revision.error) throw revision.error;
  assert.equal(revision.data.employee_id, baristaProfile.id, 'Original employee id must remain unchanged.');
  assert.equal(revision.data.employee_name, baristaProfile.name, 'Original employee name must remain unchanged.');
  assert.equal(Number(revision.data.hopper_weight), 1.347);
  assert.equal(revision.data.opened_packs, 3);
  assert.equal(Number(revision.data.write_offs), 0.222);
  assert.equal(Number(revision.data.iiko_sales), 4.1);
  assert.equal(revision.data.checked, 'Preview Admin');
  checks.push('date and original employee preserved');

  const history = await service.from('coffee_revision_edits')
    .select('revision_date,edited_by,editor_name,reason,before_data,after_data')
    .eq('revision_date', testDate)
    .single();
  if (history.error) throw history.error;
  assert.equal(history.data.edited_by, adminProfile.id);
  assert.equal(history.data.editor_name, adminProfile.name);
  assert.equal(history.data.reason, 'Автоматическая проверка исправления ревизии');
  assert.equal(Number(history.data.before_data.hopper_weight), 1.247);
  assert.equal(Number(history.data.after_data.hopper_weight), 1.347);
  checks.push('immutable audit entry created');

  const managerAttempt = await manager.rpc('correct_coffee_revision', {
    p_revision_date: testDate,
    p_hopper_weight: 9,
    p_opened_packs: 9,
    p_write_offs: 9,
    p_iiko_sales: 9,
    p_checked: 'Manager',
    p_reason: 'Manager must be rejected',
  });
  assert(managerAttempt.error, 'Manager correction must be rejected.');
  checks.push('manager correction rejected');

  const baristaAttempt = await barista.rpc('correct_coffee_revision', {
    p_revision_date: testDate,
    p_hopper_weight: 8,
    p_opened_packs: 8,
    p_write_offs: 8,
    p_iiko_sales: 8,
    p_checked: 'Barista',
    p_reason: 'Barista must be rejected',
  });
  assert(baristaAttempt.error, 'Barista correction must be rejected.');
  checks.push('barista correction rejected');

  const employeeHistory = await barista.from('coffee_revision_edits').select('id').eq('revision_date', testDate);
  assert(employeeHistory.error || (employeeHistory.data || []).length === 0, 'Barista must not read correction history.');
  checks.push('audit history hidden from employee');
} finally {
  await cleanTestData();
}

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, 'coffee-revision-smoke.json'), JSON.stringify({
  ok: true,
  projectRef: previewProjectRef,
  checks,
  cleanedTestDate: testDate,
  completedAt: new Date().toISOString(),
}, null, 2));

console.log('Audited coffee revision correction preview smoke test passed.');

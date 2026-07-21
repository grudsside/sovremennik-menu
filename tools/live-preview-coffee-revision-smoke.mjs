import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const outputDir = path.join(process.cwd(), 'artifacts', 'live-preview');
const testDates = ['2099-12-27', '2099-12-28', '2099-12-29', '2099-12-30'];
const [firstDate, secondDate, correctionDate, followingDate] = testDates;

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
  const auditDelete = await service.from('coffee_revision_edits').delete().in('revision_date', testDates);
  if (auditDelete.error) throw auditDelete.error;
  const revisionDelete = await service.from('coffee_revisions').delete().in('revision_date', testDates);
  if (revisionDelete.error) throw revisionDelete.error;
}

try {
  await cleanTestData();

  const seeded = await service.from('coffee_revisions').insert([
    {
      revision_date:firstDate,
      employee_id:baristaProfile.id,
      employee_name:baristaProfile.name,
      hopper_weight:1.847,
      opened_packs:0,
      write_offs:0,
      iiko_sales:0,
      grain_delivery:0,
      stock_balance_override:60,
      checked:'Stock baseline',
    },
    {
      revision_date:secondDate,
      employee_id:baristaProfile.id,
      employee_name:baristaProfile.name,
      hopper_weight:1.347,
      opened_packs:4,
      write_offs:0.1,
      iiko_sales:4.3,
      grain_delivery:10,
      checked:'До ручного ввода',
    },
    {
      revision_date:correctionDate,
      employee_id:baristaProfile.id,
      employee_name:baristaProfile.name,
      hopper_weight:1.147,
      opened_packs:3,
      write_offs:0.111,
      iiko_sales:3.2,
      grain_delivery:0,
      checked:'До исправления',
    },
    {
      revision_date:followingDate,
      employee_id:baristaProfile.id,
      employee_name:baristaProfile.name,
      hopper_weight:0.947,
      opened_packs:2,
      write_offs:0.1,
      iiko_sales:2.0,
      grain_delivery:5,
      checked:'После контрольной точки',
    },
  ]);
  if (seeded.error) throw seeded.error;

  const manualUpdate = await admin
    .from('coffee_revisions')
    .update({ write_offs:0.2, iiko_sales:4.4, checked:'Preview Admin' })
    .eq('revision_date', secondDate)
    .select('revision_date,employee_id,employee_name,write_offs,iiko_sales,checked')
    .single();
  if (manualUpdate.error) throw manualUpdate.error;
  assert.equal(manualUpdate.data.employee_id, baristaProfile.id, 'Manual control update must preserve the original employee.');
  assert.equal(Number(manualUpdate.data.write_offs), 0.2);
  assert.equal(Number(manualUpdate.data.iiko_sales), 4.4);
  checks.push('manual write-offs and iiko update accepted without upsert');

  const dayTwoFormula = await admin
    .from('coffee_revision_report')
    .select('clean_hopper_weight,total_coffee_usage,difference,total_loss_weight,losses_percent,grain_delivery,total_grain_balance')
    .eq('revision_date', secondDate)
    .single();
  if (dayTwoFormula.error) throw dayTwoFormula.error;
  assert.equal(Number(dayTwoFormula.data.clean_hopper_weight), 0.5);
  assert.equal(Number(dayTwoFormula.data.total_coffee_usage), 4.5);
  assert.equal(Number(dayTwoFormula.data.difference), -0.3);
  assert.equal(Number(dayTwoFormula.data.total_loss_weight), 0.5);
  assert.equal(Number(dayTwoFormula.data.losses_percent), 11.36);
  assert.equal(Number(dayTwoFormula.data.grain_delivery), 10);
  assert.equal(Number(dayTwoFormula.data.total_grain_balance), 65.5);
  checks.push('opening stock, delivery and daily usage calculate end-of-day stock');

  const corrected = await admin.rpc('correct_coffee_revision', {
    p_revision_date:correctionDate,
    p_hopper_weight:1.047,
    p_opened_packs:4,
    p_write_offs:0.1,
    p_iiko_sales:4.5,
    p_checked:'Preview Admin',
    p_grain_delivery:2,
    p_stock_balance_override:58,
    p_reason:'Автоматическая проверка контрольного остатка зерна',
  });
  if (corrected.error) throw corrected.error;
  checks.push('administrator correction accepted');

  const revision = await service.from('coffee_revisions')
    .select('revision_date,employee_id,employee_name,hopper_weight,opened_packs,write_offs,iiko_sales,grain_delivery,stock_balance_override,checked')
    .eq('revision_date', correctionDate)
    .single();
  if (revision.error) throw revision.error;
  assert.equal(revision.data.employee_id, baristaProfile.id, 'Original employee id must remain unchanged.');
  assert.equal(revision.data.employee_name, baristaProfile.name, 'Original employee name must remain unchanged.');
  assert.equal(Number(revision.data.hopper_weight), 1.047);
  assert.equal(revision.data.opened_packs, 4);
  assert.equal(Number(revision.data.write_offs), 0.1);
  assert.equal(Number(revision.data.iiko_sales), 4.5);
  assert.equal(Number(revision.data.grain_delivery), 2);
  assert.equal(Number(revision.data.stock_balance_override), 58);
  assert.equal(revision.data.checked, 'Preview Admin');
  checks.push('date and original employee preserved');

  const dayThreeFormula = await admin
    .from('coffee_revision_report')
    .select('clean_hopper_weight,total_coffee_usage,difference,total_loss_weight,losses_percent,total_grain_balance')
    .eq('revision_date', correctionDate)
    .single();
  if (dayThreeFormula.error) throw dayThreeFormula.error;
  assert.equal(Number(dayThreeFormula.data.clean_hopper_weight), 0.2);
  assert.equal(Number(dayThreeFormula.data.total_coffee_usage), 4.3);
  assert.equal(Number(dayThreeFormula.data.difference), 0.1);
  assert.equal(Number(dayThreeFormula.data.total_loss_weight), 0.1);
  assert.equal(Number(dayThreeFormula.data.losses_percent), 2.22);
  assert.equal(Number(dayThreeFormula.data.total_grain_balance), 58, 'Manual end-of-day stock must override the calculated value.');
  checks.push('manual stock check becomes a new control point');

  const followingFormula = await admin
    .from('coffee_revision_report')
    .select('total_coffee_usage,grain_delivery,total_grain_balance')
    .eq('revision_date', followingDate)
    .single();
  if (followingFormula.error) throw followingFormula.error;
  assert.equal(Number(followingFormula.data.total_coffee_usage), 2.1);
  assert.equal(Number(followingFormula.data.grain_delivery), 5);
  assert.equal(Number(followingFormula.data.total_grain_balance), 60.9);
  checks.push('following days continue from corrected stock with deliveries');

  const history = await service.from('coffee_revision_edits')
    .select('revision_date,edited_by,editor_name,reason,before_data,after_data')
    .eq('revision_date', correctionDate)
    .single();
  if (history.error) throw history.error;
  assert.equal(history.data.edited_by, adminProfile.id);
  assert.equal(history.data.editor_name, adminProfile.name);
  assert.equal(history.data.reason, 'Автоматическая проверка контрольного остатка зерна');
  assert.equal(Number(history.data.before_data.hopper_weight), 1.147);
  assert.equal(Number(history.data.after_data.hopper_weight), 1.047);
  assert.equal(Number(history.data.after_data.grain_delivery), 2);
  assert.equal(Number(history.data.after_data.stock_balance_override), 58);
  checks.push('immutable audit entry created');

  const rejectedPayload = {
    p_revision_date:correctionDate,
    p_hopper_weight:9,
    p_opened_packs:9,
    p_write_offs:9,
    p_iiko_sales:9,
    p_checked:'Rejected',
    p_grain_delivery:9,
    p_stock_balance_override:9,
    p_reason:'Non-admin must be rejected',
  };

  const managerAttempt = await manager.rpc('correct_coffee_revision', rejectedPayload);
  assert(managerAttempt.error, 'Manager correction must be rejected.');
  checks.push('manager correction rejected');

  const baristaAttempt = await barista.rpc('correct_coffee_revision', rejectedPayload);
  assert(baristaAttempt.error, 'Barista correction must be rejected.');
  checks.push('barista correction rejected');

  const employeeHistory = await barista.from('coffee_revision_edits').select('id').eq('revision_date', correctionDate);
  assert(employeeHistory.error || (employeeHistory.data || []).length === 0, 'Barista must not read correction history.');
  checks.push('audit history hidden from employee');
} finally {
  await cleanTestData();
}

await fs.mkdir(outputDir, { recursive:true });
await fs.writeFile(path.join(outputDir, 'coffee-revision-smoke.json'), JSON.stringify({
  ok:true,
  projectRef:previewProjectRef,
  checks,
  cleanedTestDates:testDates,
  completedAt:new Date().toISOString(),
}, null, 2));

console.log('Audited coffee revision correction, formula and total stock preview smoke test passed.');

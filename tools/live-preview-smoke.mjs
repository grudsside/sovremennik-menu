import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const outputDir = path.join(process.cwd(), 'artifacts', 'live-preview');

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

assert(!productionProjectRef || previewProjectRef !== productionProjectRef, 'Smoke test must not target production.');
assert.equal(
  new URL(supabaseUrl).hostname,
  `${previewProjectRef}.supabase.co`,
  'Smoke test URL must match the dedicated preview project.',
);

const service = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function signedClient(login) {
  const instance = createClient(supabaseUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const result = await instance.auth.signInWithPassword({
    email: `${login}@sovremennik.local`,
    password: testPassword,
  });
  if (result.error) throw result.error;
  assert(result.data.session, `No session for ${login}`);
  return instance;
}

async function invoke(instance, name, body, shouldSucceed = true) {
  const result = await instance.functions.invoke(name, { body });
  if (shouldSucceed && result.error) throw result.error;
  if (!shouldSucceed) assert(result.error, `${name} request should be rejected.`);
  return result.data;
}

await fs.mkdir(outputDir, { recursive: true });
const deployment = JSON.parse(await fs.readFile(path.join(outputDir, 'deployment.json'), 'utf8'));
assert.equal(deployment.projectRef, previewProjectRef, 'Deployment report belongs to another Supabase project.');

const siteResponse = await fetch(deployment.siteUrl, { redirect: 'follow' });
assert.equal(siteResponse.status, 200, 'Preview index must be publicly readable.');
const siteHtml = await siteResponse.text();
assert.match(siteHtml, /assets\/js\/supabase-config\.js/i, 'Preview index must load its configuration.');
assert.match(siteHtml, /Современник|Sovremennik/i, 'Preview index must be the application.');

const admin = await signedClient('preview-admin');
const waiter = await signedClient('preview-waiter');
const profiles = await service
  .from('profiles')
  .select('id,login,role,is_active')
  .in('login', ['preview-admin', 'preview-barista', 'preview-waiter']);
if (profiles.error) throw profiles.error;

const adminProfile = profiles.data.find(row => row.login === 'preview-admin');
const baristaProfile = profiles.data.find(row => row.login === 'preview-barista');
assert(adminProfile?.id && baristaProfile?.id, 'Seeded preview profiles were not found.');

const checks = [];
let roleChanged = false;
let scheduleClosed = false;

try {
  await invoke(admin, 'admin-employees', {
    action: 'set_role',
    userId: adminProfile.id,
    login: 'preview-admin',
    role: 'waiter',
  }, false);
  checks.push('current admin demotion rejected');

  await invoke(admin, 'admin-employees', {
    action: 'set_role',
    userId: baristaProfile.id,
    login: 'preview-barista',
    role: 'manager',
  });
  roleChanged = true;

  const changed = await service.from('profiles').select('role').eq('id', baristaProfile.id).single();
  if (changed.error) throw changed.error;
  assert.equal(changed.data.role, 'manager');
  checks.push('admin changed employee role');

  await invoke(waiter, 'admin-employees', {
    action: 'set_role',
    userId: baristaProfile.id,
    login: 'preview-barista',
    role: 'waiter',
  }, false);
  checks.push('non-admin role change rejected');

  await invoke(admin, 'admin-maintenance', {
    action: 'set',
    sectionId: 'schedule',
    isClosed: true,
  });
  scheduleClosed = true;

  const visible = await waiter.from('section_maintenance')
    .select('section_id,is_closed')
    .eq('section_id', 'schedule')
    .single();
  if (visible.error) throw visible.error;
  assert.equal(visible.data.is_closed, true);
  checks.push('closed section visible to employee');

  const directWrite = await waiter.from('section_maintenance')
    .update({ is_closed: false })
    .eq('section_id', 'schedule')
    .select();
  assert(directWrite.error, 'Authenticated client must not update maintenance state directly.');
  checks.push('direct client maintenance write rejected');

  await invoke(admin, 'admin-maintenance', {
    action: 'set',
    sectionId: 'home',
    isClosed: true,
  }, false);
  checks.push('protected home section rejected');
} finally {
  if (roleChanged) {
    await invoke(admin, 'admin-employees', {
      action: 'set_role',
      userId: baristaProfile.id,
      login: 'preview-barista',
      role: 'barista',
    });
  }
  if (scheduleClosed) {
    await invoke(admin, 'admin-maintenance', {
      action: 'set',
      sectionId: 'schedule',
      isClosed: false,
    });
  }
}

const finalRole = await service.from('profiles').select('role').eq('id', baristaProfile.id).single();
if (finalRole.error) throw finalRole.error;
assert.equal(finalRole.data.role, 'barista');
const finalMaintenance = await service.from('section_maintenance').select('is_closed').eq('section_id', 'schedule').single();
if (finalMaintenance.error) throw finalMaintenance.error;
assert.equal(finalMaintenance.data.is_closed, false);

const report = {
  ok: true,
  projectRef: previewProjectRef,
  siteUrl: deployment.siteUrl,
  checks,
  restored: { previewBaristaRole: finalRole.data.role, scheduleClosed: finalMaintenance.data.is_closed },
  completedAt: new Date().toISOString(),
};
await fs.writeFile(path.join(outputDir, 'smoke-report.json'), JSON.stringify(report, null, 2));
await fs.writeFile(path.join(outputDir, 'summary.md'), [
  '## Live Supabase preview',
  '',
  `- URL: ${deployment.siteUrl}`,
  `- Dedicated preview project ref: \`${previewProjectRef}\``,
  `- Uploaded frontend files: ${deployment.uploadedFiles}`,
  `- Authenticated checks: ${checks.length}`,
  '- Test data restored after the run.',
  '- Production project was not modified.',
  '',
].join('\n'));

console.log('Authenticated live preview smoke test passed.');

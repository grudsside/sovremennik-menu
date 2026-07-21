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
assert.equal(deployment.launcherFile, 'preview-launcher.html', 'Preview artifact must contain the local launcher.');
assert.match(
  deployment.storageBaseUrl,
  new RegExp(`^https://${previewProjectRef}\\.supabase\\.co/storage/v1/object/public/open-test-preview/$`),
  'Preview assets must use the dedicated Storage bucket.',
);

const launcherPath = path.join(outputDir, deployment.launcherFile);
const launcherSource = await fs.readFile(launcherPath, 'utf8');
assert.match(launcherSource, /<base\s+href=/i, 'Preview launcher must define an asset base URL.');
assert.match(launcherSource, new RegExp(previewProjectRef), 'Preview launcher must target the dedicated project.');
assert.doesNotMatch(
  launcherSource,
  new RegExp(productionProjectRef || 'tjibbzfdughhjenumzxo'),
  'Preview launcher must not target production.',
);
assert.match(launcherSource, /assets\/js\/supabase-config\.js/i, 'Preview launcher must load its configuration.');
assert.match(launcherSource, /Современник|Sovremennik/i, 'Preview launcher must contain the application.');

const configUrl = new URL('assets/js/supabase-config.js', deployment.storageBaseUrl);
const configResponse = await fetch(configUrl);
assert.equal(configResponse.status, 200, 'Preview configuration asset must be publicly readable.');
assert.match(
  configResponse.headers.get('content-type') || '',
  /javascript/i,
  'Preview JavaScript must use a browser-executable MIME type.',
);
const configSource = await configResponse.text();
assert.match(configSource, new RegExp(previewProjectRef), 'Preview configuration must target the dedicated project.');
assert.doesNotMatch(
  configSource,
  new RegExp(productionProjectRef || 'tjibbzfdughhjenumzxo'),
  'Preview configuration must not target production.',
);

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

const checks = [
  'downloadable preview launcher generated',
  'preview JavaScript served with executable MIME type',
];
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
  launcherFile: deployment.launcherFile,
  storageBaseUrl: deployment.storageBaseUrl,
  checks,
  restored: { previewBaristaRole: finalRole.data.role, scheduleClosed: finalMaintenance.data.is_closed },
  completedAt: new Date().toISOString(),
};
await fs.writeFile(path.join(outputDir, 'smoke-report.json'), JSON.stringify(report, null, 2));
await fs.writeFile(path.join(outputDir, 'summary.md'), [
  '## Live Supabase preview',
  '',
  `- Open the downloaded artifact file: \`${deployment.launcherFile}\``,
  `- Dedicated preview project ref: \`${previewProjectRef}\``,
  `- Uploaded frontend files: ${deployment.uploadedFiles}`,
  `- Authenticated and launcher checks: ${checks.length}`,
  '- Supabase Free rewrites hosted HTML to text/plain, so the launcher opens locally and loads assets from the dedicated preview Storage bucket.',
  '- Test data restored after the run.',
  '- Production project was not modified.',
  '',
].join('\n'));

console.log('Authenticated live preview smoke test passed.');

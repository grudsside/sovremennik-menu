import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const root = process.cwd();
const outputDir = path.join(root, 'artifacts', 'live-preview');
const bucketId = 'open-test-preview';

function required(name) {
  const value = String(process.env[name] || '').trim();
  assert(value, `Missing required environment variable: ${name}`);
  return value;
}

const supabaseUrl = required('PREVIEW_SUPABASE_URL').replace(/\/+$/, '');
const publicKey = required('PREVIEW_PUBLIC_KEY');
const secretKey = required('PREVIEW_SECRET_KEY');
const password = required('PREVIEW_TEST_PASSWORD');
const previewProjectRef = required('PREVIEW_PROJECT_REF');
const productionProjectRef = String(process.env.PRODUCTION_SUPABASE_PROJECT_REF || '').trim();

assert(!productionProjectRef || previewProjectRef !== productionProjectRef, 'Preview project ref must differ from production.');
assert.equal(
  new URL(supabaseUrl).hostname,
  `${previewProjectRef}.supabase.co`,
  'Preview URL must match the dedicated preview project ref.',
);
if (productionProjectRef) {
  assert(!supabaseUrl.includes(`${productionProjectRef}.supabase.co`), 'Preview URL must not target production.');
}

const admin = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const previewUsers = [
  { login: 'preview-admin', name: 'Preview Admin', role: 'admin' },
  { login: 'preview-manager', name: 'Preview Manager', role: 'manager' },
  { login: 'preview-barista', name: 'Preview Barista', role: 'barista' },
  { login: 'preview-waiter', name: 'Preview Waiter', role: 'waiter' },
].map(user => ({ ...user, email: `${user.login}@sovremennik.local` }));

async function listAllUsers() {
  const users = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    users.push(...(data?.users || []));
    if ((data?.users || []).length < 200) break;
  }
  return users;
}

async function seedPreviewUsers() {
  const existingUsers = await listAllUsers();
  const seeded = [];

  for (const account of previewUsers) {
    let user = existingUsers.find(item => item.email?.toLowerCase() === account.email);
    if (!user) {
      const created = await admin.auth.admin.createUser({
        email: account.email,
        password,
        email_confirm: true,
        user_metadata: {
          name: account.name,
          login: account.login,
          role: account.role,
          preview: true,
        },
      });
      if (created.error) throw created.error;
      user = created.data.user;
    } else {
      const updated = await admin.auth.admin.updateUserById(user.id, {
        password,
        user_metadata: {
          ...(user.user_metadata || {}),
          name: account.name,
          login: account.login,
          role: account.role,
          preview: true,
        },
      });
      if (updated.error) throw updated.error;
      user = updated.data.user;
    }

    const profile = await admin.from('profiles').upsert({
      id: user.id,
      login: account.login,
      name: account.name,
      role: account.role,
      is_active: true,
    }, { onConflict: 'id' });
    if (profile.error) throw profile.error;

    seeded.push({ id: user.id, login: account.login, role: account.role });
  }

  return seeded;
}

const excludedTopLevel = new Set([
  '.git',
  '.github',
  '.vscode',
  '.live-preview-workspace',
  'artifacts',
  'docs',
  'node_modules',
  'supabase',
  'tools',
]);

const excludedFiles = new Set([
  '.gitignore',
  'README.md',
  'package-lock.json',
  'package.json',
]);

async function collectFiles(directory, relative = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!relative && excludedTopLevel.has(entry.name)) continue;
    if (!relative && excludedFiles.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.name !== '.nojekyll') continue;

    const relativePath = path.posix.join(relative, entry.name);
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files.push({ relativePath, absolutePath });
    }
  }

  return files;
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.pdf': 'application/pdf',
  })[extension] || 'application/octet-stream';
}

function previewConfigSource() {
  const functionBase = `${supabaseUrl}/functions/v1`;
  return `window.SOVREMENNIK_SUPABASE = ${JSON.stringify({
    url: supabaseUrl,
    anonKey: publicKey,
    employeeFunctionUrl: `${functionBase}/admin-employees`,
    maintenanceFunctionUrl: `${functionBase}/admin-maintenance`,
    notifyFunctionUrl: '',
    pushSendFunctionUrl: '',
    deadlineFunctionUrl: '',
    vapidPublicKey: '',
    loginDomain: 'sovremennik.local',
    preview: true,
  }, null, 2)};\n`;
}

async function ensureBucket() {
  const listed = await admin.storage.listBuckets();
  if (listed.error) throw listed.error;
  const exists = (listed.data || []).some(bucket => bucket.id === bucketId || bucket.name === bucketId);

  if (!exists) {
    const created = await admin.storage.createBucket(bucketId, {
      public: true,
      fileSizeLimit: '50MB',
    });
    if (created.error) throw created.error;
  } else {
    const updated = await admin.storage.updateBucket(bucketId, {
      public: true,
      fileSizeLimit: '50MB',
    });
    if (updated.error) throw updated.error;
    const emptied = await admin.storage.emptyBucket(bucketId);
    if (emptied.error) throw emptied.error;
  }
}

async function publishFrontend() {
  await ensureBucket();
  const files = await collectFiles(root);
  assert(files.some(file => file.relativePath === 'index.html'), 'Preview bundle does not contain index.html.');

  let uploaded = 0;
  for (const file of files) {
    const body = file.relativePath === 'assets/js/supabase-config.js'
      ? Buffer.from(previewConfigSource(), 'utf8')
      : await fs.readFile(file.absolutePath);
    const upload = await admin.storage.from(bucketId).upload(file.relativePath, body, {
      contentType: contentType(file.relativePath),
      cacheControl: file.relativePath.endsWith('.html') || file.relativePath.endsWith('.js') ? '60' : '3600',
      upsert: true,
    });
    if (upload.error) throw new Error(`Upload failed for ${file.relativePath}: ${upload.error.message}`);
    uploaded += 1;
  }

  const publicUrl = admin.storage.from(bucketId).getPublicUrl('index.html').data.publicUrl;
  assert(publicUrl, 'Supabase Storage did not return a preview URL.');
  return { publicUrl, uploaded };
}

await fs.mkdir(outputDir, { recursive: true });
const seededUsers = await seedPreviewUsers();
const site = await publishFrontend();

const report = {
  ok: true,
  projectRef: previewProjectRef,
  siteUrl: site.publicUrl,
  uploadedFiles: site.uploaded,
  users: seededUsers.map(({ login, role }) => ({ login, role })),
  generatedAt: new Date().toISOString(),
};

await fs.writeFile(path.join(outputDir, 'deployment.json'), JSON.stringify(report, null, 2));
await fs.writeFile(path.join(outputDir, 'preview-url.txt'), `${site.publicUrl}\n`);
await fs.writeFile(path.join(outputDir, 'accounts.md'), [
  '# Preview accounts',
  '',
  ...seededUsers.map(user => `- \`${user.login}\` — ${user.role}`),
  '',
  'Password is stored only in the GitHub Actions secret `PREVIEW_TEST_PASSWORD`.',
  '',
].join('\n'));

console.log(`Live preview published: ${site.publicUrl}`);

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = process.cwd();
const trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const failures = [];
const ownPath = 'tools/ci-check.mjs';

function fail(message) {
  failures.push(message);
}

function readTracked(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

const forbiddenTrackedFiles = [
  'vapid.env',
  'assets/js/push-vapid-rotation.js',
];

for (const path of trackedFiles) {
  const baseName = path.split('/').at(-1) || '';
  const isEnvironmentFile = /^\.env(?:\..+)?$/.test(baseName) && baseName !== '.env.example';
  if (isEnvironmentFile || forbiddenTrackedFiles.includes(path)) {
    fail(`Forbidden tracked file: ${path}`);
  }
}

const forbiddenTextPatterns = [
  ['legacy built-in admin constant', /\bBUILTIN_ADMIN\b/],
  ['legacy built-in admin token', /\bBUILTIN_ADMIN_TOKEN\b/],
  ['legacy built-in auth helper', /\bbuiltinAdminAuth\b/],
  ['legacy built-in credential helper', /\bisBuiltinAdminCredentials\b/],
  ['temporary VAPID loader', /\bloadVapidRotationHelper\b/],
  ['temporary VAPID helper path', /push-vapid-rotation\.js/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['JWT-shaped value', /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
  ['Supabase secret key value', /\bsb_secret_[A-Za-z0-9_-]{16,}\b/],
];

for (const path of trackedFiles) {
  if (path === ownPath) continue;
  let text;
  try {
    text = readTracked(path);
  } catch {
    continue;
  }

  for (const [label, pattern] of forbiddenTextPatterns) {
    if (pattern.test(text)) {
      fail(`${label} found in ${path}`);
    }
  }
}

const jsonFiles = trackedFiles.filter((path) => path.endsWith('.json') || path.endsWith('.webmanifest'));
for (const path of jsonFiles) {
  try {
    JSON.parse(readTracked(path));
  } catch (error) {
    fail(`Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const config = readTracked('assets/js/supabase-config.js');
if (!config.includes('vapidPublicKey:')) fail('Public VAPID key is missing from supabase-config.js');
if (!config.includes('anonKey:')) fail('Supabase publishable key is missing from supabase-config.js');

const cronIndex = readTracked('supabase/functions/deadline-checker/index.ts');
const cronAuth = readTracked('supabase/functions/deadline-checker/cron-auth.ts');
for (const marker of ['validateCronAuth', 'req.method !== "POST"', 'missing_configuration', 'unauthorized']) {
  if (!`${cronIndex}\n${cronAuth}`.includes(marker)) {
    fail(`deadline-checker security marker is missing: ${marker}`);
  }
}

if (failures.length > 0) {
  console.error('CI repository checks failed:');
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log(`CI repository checks passed for ${trackedFiles.length} tracked files.`);
console.log(`Validated ${jsonFiles.length} JSON/webmanifest files.`);
console.log(`Repository root: ${relative(root, root) || '.'}`);

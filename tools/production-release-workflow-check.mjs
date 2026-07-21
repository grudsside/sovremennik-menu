import fs from 'node:fs';

const workflow = fs.readFileSync(
  '.github/workflows/production-admin-controls-release.yml',
  'utf8',
);
const release = fs.readFileSync(
  'tools/production-admin-controls-release.mjs',
  'utf8',
);

const productionRef = 'tjibbzfdughhjenumzxo';
const previewRef = 'enkftanmqlwvjydliwue';

const required = [
  [workflow.includes('branches:\n      - main'), 'workflow must run only from main'],
  [workflow.includes(`PRODUCTION_PROJECT_REF: ${productionRef}`), 'workflow must use the fixed production ref'],
  [workflow.includes('SUPABASE_ACCESS_TOKEN'), 'workflow must use the protected Supabase access token'],
  [workflow.includes('production-admin-controls-release.mjs'), 'workflow must use the reviewed production release script'],
  [workflow.includes('functions deploy admin-employees'), 'admin-employees must be deployed'],
  [workflow.includes('functions deploy admin-maintenance'), 'admin-maintenance must be deployed'],
  [workflow.includes("status\" == '401'") || workflow.includes("status\" == '403'"), 'workflow must verify authentication gates'],
  [release.includes(`/projects/${'${projectRef}'}/database/query`), 'release must use the Management API database query endpoint'],
  [release.includes('20260720193000_section_maintenance.sql'), 'release must apply the reviewed maintenance migration'],
  [release.includes('exactly 9 allowed maintenance sections'), 'release must verify all maintenance rows'],
  [release.includes("has_table_privilege('authenticated'"), 'release must verify authenticated privileges'],
  [release.includes("has_table_privilege('anon'"), 'release must verify anon privileges'],
  [release.includes('relrowsecurity'), 'release must verify RLS'],
];

const forbidden = [
  [workflow.includes(previewRef) || release.includes(previewRef), 'production release must not reference the preview project'],
  [workflow.includes('functions deploy preview-site'), 'preview-site must not be deployed to production'],
  [workflow.includes('PREVIEW_DB_PASSWORD') || workflow.includes('PREVIEW_TEST_PASSWORD'), 'production release must not use preview credentials'],
  [/sbp_[A-Za-z0-9_-]{16,}|sb_secret_[A-Za-z0-9_-]{16,}|service_role_[A-Za-z0-9_-]{16,}/.test(workflow + release), 'secrets must never be hardcoded'],
  [workflow.includes('--no-verify-jwt'), 'production admin functions must keep JWT verification enabled'],
];

const failures = [
  ...required.filter(([ok]) => !ok).map(([, message]) => message),
  ...forbidden.filter(([matched]) => matched).map(([, message]) => message),
];

if (failures.length) {
  console.error('Production release workflow checks failed:');
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log('Production release workflow safety checks passed.');

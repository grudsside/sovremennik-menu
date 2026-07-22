import fs from 'node:fs';

const releaseWorkflow = fs.readFileSync('.github/workflows/production-checklist-photo-release.yml', 'utf8');
const retentionWorkflow = fs.readFileSync('.github/workflows/checklist-photo-retention.yml', 'utf8');
const releaseScript = fs.readFileSync('tools/production-checklist-photo-release.mjs', 'utf8');
const retentionFunction = fs.readFileSync('supabase/functions/checklist-photo-retention/index.ts', 'utf8');
const authorization = fs.readFileSync('supabase/functions/checklist-photo-retention/authorization.ts', 'utf8');

const productionRef = 'tjibbzfdughhjenumzxo';
const previewRef = 'enkftanmqlwvjydliwue';
const combined = releaseWorkflow + retentionWorkflow + releaseScript + retentionFunction + authorization;

const required = [
  [releaseWorkflow.includes('branches:\n      - main'), 'production release must run from main'],
  [releaseWorkflow.includes(`PRODUCTION_PROJECT_REF: ${productionRef}`), 'release must use the fixed production ref'],
  [releaseWorkflow.includes('production-checklist-photo-release.mjs'), 'release must run the reviewed migration verifier'],
  [releaseWorkflow.includes('functions deploy checklist-photo-retention'), 'retention function must be deployed'],
  [releaseWorkflow.includes('--no-verify-jwt'), 'retention function must allow its internal authorization layer to run'],
  [releaseWorkflow.includes('production/checklist-photos'), 'release must publish a stable production status'],
  [releaseWorkflow.includes('Verify published GitHub Pages frontend'), 'release must verify published photo-report assets'],
  [releaseWorkflow.includes('checklist-photo-reports.js?v=20260722-1'), 'release must verify the photo-report cache-bust'],
  [releaseWorkflow.includes('service_role') && releaseWorkflow.includes('dry_run'), 'release must run a non-destructive authenticated retention check'],
  [releaseScript.includes('20260722130000_checklist_photo_reports_preview.sql'), 'release script must apply the checklist photo migration'],
  [releaseScript.includes('bucket_public is not false'), 'release must verify the Storage bucket is private'],
  [releaseScript.includes("interval '90 days'"), 'release must verify the 90-day retention migration marker'],
  [releaseScript.includes('checklist_submission_photos_select_visible'), 'release must verify photo metadata RLS'],
  [retentionWorkflow.includes("cron: '25 3 * * *'"), 'automatic cleanup must run daily'],
  [retentionWorkflow.includes(`PRODUCTION_PROJECT_REF: ${productionRef}`), 'scheduled cleanup must use the fixed production ref'],
  [retentionWorkflow.includes('/api-keys?reveal=true'), 'scheduled cleanup must resolve its service key at runtime'],
  [retentionWorkflow.includes('limit\\\":500'), 'scheduled cleanup must use a bounded batch size'],
  [retentionFunction.includes('serviceRoleAuthorized'), 'retention function must recognize the verified scheduler'],
  [authorization.includes('actor: "service_role"'), 'authorization must expose the scheduler actor explicitly'],
];

const forbidden = [
  [new RegExp(`PRODUCTION_PROJECT_REF:\\s*${previewRef}`).test(combined), 'production workflows must never target preview'],
  [/sbp_[A-Za-z0-9_-]{16,}|sb_secret_[A-Za-z0-9_-]{16,}|service_role_[A-Za-z0-9_-]{16,}/.test(combined), 'secret keys must never be hardcoded'],
  [retentionWorkflow.includes('schedule:') && !retentionWorkflow.includes('SUPABASE_ACCESS_TOKEN'), 'scheduled cleanup must use protected credentials'],
  [releaseScript.includes('read_only: true'), 'production migration must not be submitted as read-only'],
  [releaseWorkflow.includes('functions deploy preview-site'), 'preview-site must not be deployed to production'],
  [releaseWorkflow.includes('PREVIEW_DB_PASSWORD') || retentionWorkflow.includes('PREVIEW_TEST_PASSWORD'), 'production workflows must not use preview credentials'],
];

const failures = [
  ...required.filter(([ok]) => !ok).map(([, message]) => message),
  ...forbidden.filter(([matched]) => matched).map(([, message]) => message),
];

if (failures.length) {
  console.error('Checklist photo production workflow checks failed:');
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log('Checklist photo production release and retention workflow checks passed.');

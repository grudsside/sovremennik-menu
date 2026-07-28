import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const workflow = await fs.readFile('.github/workflows/production-attestations-release.yml', 'utf8');
const releaseTool = await fs.readFile('tools/production-attestations-release.mjs', 'utf8');
const migration = await fs.readFile('supabase/migrations/20260728130000_attestations_preview.sql', 'utf8');

for (const marker of [
  "branches:\n      - main",
  "PRODUCTION_PROJECT_REF: tjibbzfdughhjenumzxo",
  "PRODUCTION_SUPABASE_URL: https://tjibbzfdughhjenumzxo.supabase.co",
  "PRODUCTION_PAGES_URL: https://grudsside.github.io/sovremennik-menu",
  "node tools/production-attestations-release.mjs",
  "context='production/attestations'",
  'assets/js/attestations-core.js',
  'assets/js/attestations-ready-bank.js',
  'assets/js/attestations-preview.js',
  'assets/js/attestations-tab-guard.js',
  'assets/css/attestations-preview.css',
  'service-worker.js',
]) {
  assert(workflow.includes(marker), `Production workflow marker is missing: ${marker}`);
}

assert(!workflow.includes('enkftanmqlwvjydliwue'), 'Production workflow must not reference preview Project Ref.');
assert(!workflow.includes('PREVIEW_'), 'Production workflow must not use preview environment variables.');
assert(workflow.includes('cmp -s "$file" "$downloaded"'), 'GitHub Pages files must be compared byte-for-byte with the release source.');
assert(workflow.includes('cancel-in-progress: false'), 'Production release must not cancel an active deployment.');

for (const marker of [
  "const expectedProductionRef = 'tjibbzfdughhjenumzxo'",
  "const previewRef = 'enkftanmqlwvjydliwue'",
  "const migrationFile = '20260728130000_attestations_preview.sql'",
  'await executeSql(migrationSql)',
  'await executeSql(verificationSql)',
  'attestation_questions',
  'create_attestation_test',
  'start_attestation_attempt',
  'submit_attestation_attempt',
  'list_attestation_results',
]) {
  assert(releaseTool.includes(marker), `Production release tool marker is missing: ${marker}`);
}

assert(migration.toLowerCase().includes('enable row level security'), 'Attestations migration must enable RLS.');
assert(migration.toLowerCase().includes("question.snapshot - 'correctanswer' - 'explanation'"), 'Employee payload must strip correct answers.');
assert(!migration.includes('tjibbzfdughhjenumzxo'), 'Migration must not contain production Project Ref.');
assert(!migration.includes('enkftanmqlwvjydliwue'), 'Migration must not contain preview Project Ref.');

console.log('Production attestations workflow safety check passed.');

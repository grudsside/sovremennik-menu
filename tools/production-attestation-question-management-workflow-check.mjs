import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const workflow = await fs.readFile('.github/workflows/production-attestation-question-management-release.yml', 'utf8');
const releaseTool = await fs.readFile('tools/production-attestation-question-management-release.mjs', 'utf8');
const migration = await fs.readFile('supabase/migrations/20260728223000_attestation_question_management.sql', 'utf8');

for(const marker of [
  "branches:\n      - main",
  'PRODUCTION_PROJECT_REF: tjibbzfdughhjenumzxo',
  'PRODUCTION_SUPABASE_URL: https://tjibbzfdughhjenumzxo.supabase.co',
  'PRODUCTION_PAGES_URL: https://grudsside.github.io/sovremennik-menu',
  'node tools/production-attestation-question-management-release.mjs',
  "context='production/attestation-question-management'",
  'assets/js/attestations-question-management-core.js',
  'assets/js/attestations-question-management.js',
  'assets/js/attestations-question-management-guard.js',
  'assets/css/attestations-question-management.css',
  'service-worker.js'
]) assert(workflow.includes(marker), `Production question management workflow marker is missing: ${marker}`);

assert(!workflow.includes('enkftanmqlwvjydliwue'), 'Production workflow must not reference preview Project Ref.');
assert(!workflow.includes('PREVIEW_'), 'Production workflow must not use preview environment variables.');
assert(workflow.includes('cmp -s "$file" "$downloaded"'), 'Published files must be compared byte-for-byte.');
assert(workflow.includes('cancel-in-progress: false'), 'Production deployment must not be cancelled by a later run.');

for(const marker of [
  "const expectedProductionRef = 'tjibbzfdughhjenumzxo'",
  "const previewRef = 'enkftanmqlwvjydliwue'",
  "const migrationFile = '20260728223000_attestation_question_management.sql'",
  'await executeSql(migrationSql)',
  'await executeSql(verificationSql)',
  'attestation_questions_admin_update',
  'attestation_questions_admin_delete'
]) assert(releaseTool.includes(marker), `Production question management tool marker is missing: ${marker}`);

for(const marker of [
  'add column if not exists deleted_at',
  'add column if not exists deleted_by',
  'public.is_admin()',
  'attestation_questions_admin_update',
  'attestation_questions_admin_delete'
]) assert(migration.toLowerCase().includes(marker.toLowerCase()), `Question management migration marker is missing: ${marker}`);

assert(!migration.includes('tjibbzfdughhjenumzxo'));
assert(!migration.includes('enkftanmqlwvjydliwue'));

console.log('Production attestation question management workflow and post-login guard safety check passed.');
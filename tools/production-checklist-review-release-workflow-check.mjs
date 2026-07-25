import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/production-checklist-review-release.yml', 'utf8');
const script = fs.readFileSync('tools/production-checklist-review-release.mjs', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260724210000_checklist_review_tools_preview.sql', 'utf8');

for (const marker of [
  'name: Production checklist review release',
  "PRODUCTION_PROJECT_REF: tjibbzfdughhjenumzxo",
  'Apply and verify checklist review database migration',
  "context='production/checklist-review'",
  'files=(',
  '"assets/js/checklist-review-observer-guard.js"',
  '"assets/js/checklist-review-tools.js"',
  '"assets/js/control-revision-scroll-fix.js"',
  '"assets/js/checklist-photo-rules-open-fix.js"',
  'cmp -s "$file" "$downloaded"',
  'sha256sum "$file"',
  'exact checklist review release assets',
  'production-checklist-review-release',
]) {
  assert.ok(workflow.includes(marker), `Production checklist review workflow marker is missing: ${marker}`);
}

for (const marker of [
  "const expectedProductionRef = 'tjibbzfdughhjenumzxo'",
  "const migrationFile = '20260724210000_checklist_review_tools_preview.sql'",
  'checklist_submission_comments table is missing',
  'Checklist review RPC functions are missing',
  'Soft-deleted checklist submissions are not excluded',
  'has_function_privilege',
  'search_path=public',
]) {
  assert.ok(script.includes(marker), `Production checklist review verifier marker is missing: ${marker}`);
}

for (const marker of [
  'create table if not exists public.checklist_submission_comments',
  'create or replace function public.create_checklist_submission_comment',
  'create or replace function public.delete_checklist_submission',
  'deleted_at is null',
]) {
  assert.ok(migration.toLowerCase().includes(marker.toLowerCase()), `Checklist review migration marker is missing: ${marker}`);
}

assert.ok(!workflow.includes('removedNodes'), 'Production release must not depend on obsolete implementation markers.');
assert.ok(!workflow.includes('sovremennik-offline-20260725-v10'), 'Production release must not hardcode an obsolete PWA cache version.');
assert.ok(!workflow.includes('enkftanmqlwvjydliwue'), 'Production workflow must not reference the preview project.');
assert.ok(!script.includes("projectRef = 'enkftanmqlwvjydliwue'"), 'Production verifier must not target the preview project.');
assert.ok(!workflow.includes('--no-verify-jwt'), 'Checklist review production release does not deploy Edge Functions.');
assert.ok(!workflow.includes('PRODUCTION_SERVICE_KEY'), 'Checklist review production release must not resolve or expose service-role credentials.');

console.log('Production checklist review release workflow is valid.');
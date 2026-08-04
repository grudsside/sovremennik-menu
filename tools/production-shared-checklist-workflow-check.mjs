import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/production-shared-checklists-release.yml', 'utf8');
const release = fs.readFileSync('tools/production-shared-checklist-release.mjs', 'utf8');

const productionRef = 'tjibbzfdughhjenumzxo';
const previewRef = 'enkftanmqlwvjydliwue';
const migrations = [
  '20260804170000_checklist_shared_drafts_schema.sql',
  '20260804171000_checklist_shared_drafts_photos_finalize.sql',
  '20260804172000_checklist_shared_drafts_security.sql',
];

const required = [
  [workflow.includes('branches:\n      - main'), 'workflow must run from main'],
  [workflow.includes(`PRODUCTION_PROJECT_REF: ${productionRef}`), 'workflow must use fixed production ref'],
  [workflow.includes('SUPABASE_ACCESS_TOKEN'), 'workflow must use protected Supabase token'],
  [workflow.includes('production-shared-checklist-release.mjs'), 'workflow must run reviewed release script'],
  [migrations.every(file => workflow.includes(file)), 'workflow must trigger for every shared checklist migration'],
  [migrations.every(file => release.includes(file)), 'release script must apply every shared checklist migration'],
  [workflow.includes('control-v4-shared-drafts.js') && workflow.includes('control-v4-checklists.js'), 'workflow must trigger for shared runtime'],
  [workflow.includes('Verify published GitHub Pages frontend'), 'workflow must verify production frontend'],
  [workflow.includes('production/shared-checklists'), 'workflow must publish stable release status'],
  [workflow.includes('statuses: write'), 'workflow needs status permission'],
  [release.includes(`/projects/${'${projectRef}'}/database/query`), 'release must use Management API database endpoint'],
  [release.includes('read_only: false'), 'migrations must execute as writes'],
  [release.includes('checklist_shared_drafts') && release.includes('relrowsecurity'), 'release must verify shared table RLS'],
  [release.includes("has_table_privilege('authenticated'"), 'release must verify browser privileges'],
  [release.includes('pg_publication_tables') && release.includes('supabase_realtime'), 'release must verify Realtime publication'],
  [release.includes('checklist_shared_photo_storage_select_accessible'), 'release must verify private collaborative photo access'],
  [release.includes('finalize_checklist_shared_draft(uuid,text)'), 'release must verify one-shot finalization RPC'],
];

const forbidden = [
  [new RegExp(`PRODUCTION_PROJECT_REF:\\s*${previewRef}`).test(workflow), 'production ref must never point to preview'],
  [new RegExp(`PRODUCTION_SUPABASE_URL:[^\\n]*${previewRef}`).test(workflow), 'production URL must never point to preview'],
  [workflow.includes('PREVIEW_DB_PASSWORD') || workflow.includes('PREVIEW_TEST_PASSWORD'), 'production workflow must not use preview secrets'],
  [/sbp_[A-Za-z0-9_-]{16,}|sb_secret_[A-Za-z0-9_-]{16,}|service_role_[A-Za-z0-9_-]{16,}/.test(workflow + release), 'secrets must not be hardcoded'],
  [release.includes('read_only: true'), 'release must not submit migrations as read-only'],
  [workflow.includes('cancel-in-progress: true'), 'production migrations must not be cancelled mid-release'],
];

const failures = [
  ...required.filter(([ok]) => !ok).map(([, message]) => message),
  ...forbidden.filter(([matched]) => matched).map(([, message]) => message),
];

if (failures.length) {
  console.error('Shared checklist production workflow checks failed:');
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

assert.doesNotThrow(() => JSON.parse(JSON.stringify({ productionRef, migrations })));
console.log('Shared checklist production release target, migrations, RLS, Realtime and frontend verification checks passed.');

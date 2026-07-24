import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const loader = readFileSync('assets/js/push.js', 'utf8');
const worker = readFileSync('service-worker.js', 'utf8');
const core = readFileSync('assets/js/checklist-editor-core.js', 'utf8');
const editor = readFileSync('assets/js/checklist-editor.js', 'utf8');
const css = readFileSync('assets/css/checklist-editor.css', 'utf8');
const migration = readFileSync('supabase/migrations/20260724110000_checklist_template_editor_preview.sql', 'utf8');

for(const marker of [
  'assets/css/checklist-editor.css?v=20260724-1',
  'assets/js/checklist-editor-core.js?v=20260724-1',
  'assets/js/checklist-editor.js?v=20260724-1'
]) assert.ok(loader.includes(marker), `Loader marker missing: ${marker}`);

for(const path of [
  './assets/css/checklist-editor.css',
  './assets/js/checklist-editor-core.js',
  './assets/js/checklist-editor.js'
]) assert.ok(worker.includes(path), `Offline cache marker missing: ${path}`);

assert.match(core, /flattenChecklistStable/);
assert.match(core, /rowItemKey/);
assert.match(editor, /save_checklist_template_override/);
assert.match(editor, /reset_checklist_template_override/);
assert.match(editor, /data-checklist-template-edit/);
assert.match(css, /@media\(max-width:640px\)/);

for(const marker of [
  'checklist_template_overrides',
  'checklist_template_edits',
  'normalize_checklist_template_sections',
  'save_checklist_template_override',
  'reset_checklist_template_override',
  'public.is_admin()',
  "using (public.is_active_user())",
  "using (public.is_admin())",
  "errcode = '40001'"
]) assert.ok(migration.includes(marker), `Migration marker missing: ${marker}`);

assert.match(migration, /delete from public\.checklist_photo_rules[\s\S]*itemValue|delete from public\.checklist_photo_rules[\s\S]*item_value/i);
console.log('Checklist editor integration checks passed.');

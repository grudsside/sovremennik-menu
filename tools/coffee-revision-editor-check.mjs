import fs from 'node:fs';

const editor = fs.readFileSync('assets/js/coffee-revision-editor.js', 'utf8');
const styles = fs.readFileSync('assets/css/coffee-revision-editor.css', 'utf8');
const config = fs.readFileSync('assets/js/supabase-config.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260721183000_coffee_revision_admin_correction.sql', 'utf8');
const previewPlan = fs.readFileSync('tools/live-preview-prepare-migrations.mjs', 'utf8');
const previewConfig = fs.readFileSync('tools/live-preview-feature-config.mjs', 'utf8');
const previewSmoke = fs.readFileSync('tools/live-preview-coffee-revision-smoke.mjs', 'utf8');

const required = [
  [config.includes('coffee-revision-editor.js') && config.includes('coffee-revision-editor.css'), 'production config must load the correction module and styles'],
  [editor.includes("normalizeRole(currentUser()?.role) === 'admin'"), 'correction interface must be visible only to admin'],
  [editor.includes('Дата ревизии и сотрудник, который её отправил, сохраняются без изменений'), 'interface must explain immutable date and author'],
  [editor.includes('name="reason"') && editor.includes('required'), 'correction reason must be required'],
  [editor.includes("supa.rpc('correct_coffee_revision'"), 'interface must use the protected correction RPC'],
  [editor.includes("from('coffee_revision_edits')"), 'interface must display the correction audit history'],
  [styles.includes('.revision-correction') && styles.includes('@media (max-width: 720px)'), 'correction interface must include desktop and mobile styles'],
  [migration.includes('create table if not exists public.coffee_revision_edits'), 'migration must create an audit table'],
  [migration.includes('before_data jsonb not null') && migration.includes('after_data jsonb not null'), 'audit must keep before and after values'],
  [migration.includes('create or replace function public.correct_coffee_revision'), 'migration must create the correction RPC'],
  [migration.includes('security definer') && migration.includes('not public.is_admin()'), 'correction RPC must enforce administrator role server-side'],
  [migration.includes('where revision_date = p_revision_date') && !migration.includes('set revision_date ='), 'correction must not change the revision date'],
  [migration.includes('update public.coffee_revisions') && !/set[\s\S]{0,200}employee_(id|name)\s*=/.test(migration), 'correction must not change the original employee'],
  [migration.includes('coffee_revision_edits_select_admin'), 'audit history must have an admin-only RLS policy'],
  [previewPlan.includes('20260721183000_coffee_revision_admin_correction.sql'), 'dedicated preview must apply the correction migration'],
  [previewConfig.includes('coffee-revision-editor.js') && previewConfig.includes('must not target production'), 'preview config must load the editor and reject production'],
  [previewSmoke.includes('administrator correction accepted'), 'live preview must test successful admin correction'],
  [previewSmoke.includes('manager correction rejected') && previewSmoke.includes('barista correction rejected'), 'live preview must reject non-admin correction'],
  [previewSmoke.includes('immutable audit entry created') && previewSmoke.includes('cleanTestData'), 'live preview must test audit creation and clean test data'],
];

const forbidden = [
  [/\.from\(['"]coffee_revisions['"]\)\.update/.test(editor), 'browser must not directly update coffee revisions'],
  [/service_role_[A-Za-z0-9_-]{16,}|sb_secret_[A-Za-z0-9_-]{16,}/.test(editor + config + previewConfig + previewSmoke), 'no secret key may be hardcoded'],
  [/employee_id\s*=\s*p_|employee_name\s*=\s*p_/.test(migration), 'correction RPC must not accept replacement employee identity'],
];

const failures = [
  ...required.filter(([ok]) => !ok).map(([, message]) => message),
  ...forbidden.filter(([matched]) => matched).map(([, message]) => message),
];

if (failures.length) {
  console.error('Coffee revision correction checks failed:');
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log('Coffee revision correction checks passed.');

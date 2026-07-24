import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const workspace = path.join(root, '.live-preview-workspace');
const migrationsDir = path.join(workspace, 'supabase', 'migrations');
const artifactDir = path.join(root, 'artifacts', 'live-preview');

const plan = [
  ['supabase/sql/STEP_1_SCHEMA_AND_POLICIES.sql', '20260720010000_step_1_schema_and_policies.sql'],
  ['supabase/sql/STEP_4_PATCH_ROLES_PERMISSIONS_TASKS.sql', '20260720040000_step_4_roles_permissions_tasks.sql'],
  ['supabase/sql/STEP_5_PUSH_NOTIFICATIONS.sql', '20260720050000_step_5_push_notifications.sql'],
  ['supabase/sql/STEP_6_CONTENT_SYNC_TECHCARDS_PHOTOS.sql', '20260720060000_step_6_content_sync.sql'],
  ['supabase/sql/STEP_8_CONTENT_EDITING_METHOD_TECH.sql', '20260720080000_step_8_content_editing.sql'],
  ['supabase/sql/STEP_9_MOBILE_TASKS_ERRORS_NOTIFICATIONS.sql', '20260720090000_step_9_mobile_fixes.sql'],
  ['supabase/sql/STEP_10_HARDEN_RLS.sql', '20260720100000_step_10_harden_rls.sql'],
  ['supabase/sql/STEP_10B_HARDEN_RLS_VIEW_PRIVILEGES.sql', '20260720100100_step_10b_finalize_rls.sql'],
  ['supabase/sql/STEP_12_NOTIFICATION_HISTORY.sql', '20260720120000_step_12_notification_history.sql'],
  ['supabase/migrations/20260720193000_section_maintenance.sql', '20260720193000_section_maintenance.sql'],
  ['supabase/migrations/20260721183000_coffee_revision_admin_correction.sql', '20260721183000_coffee_revision_admin_correction.sql'],
  ['supabase/migrations/20260721190000_coffee_revision_formula_corrections.sql', '20260721190000_coffee_revision_formula_corrections.sql'],
  ['supabase/migrations/20260721203000_coffee_revision_total_stock.sql', '20260721203000_coffee_revision_total_stock.sql'],
  ['supabase/migrations/20260721223000_coffee_revision_integrity_summary.sql', '20260721223000_coffee_revision_integrity_summary.sql'],
  ['supabase/migrations/20260722130000_checklist_photo_reports_preview.sql', '20260722130000_checklist_photo_reports_preview.sql'],
  ['supabase/migrations/20260723150000_shift_handoff_preview.sql', '20260723150000_shift_handoff_preview.sql'],
  ['supabase/migrations/20260723190000_shift_handoff_barista_only.sql', '20260723190000_shift_handoff_barista_only.sql'],
  ['supabase/migrations/20260723203000_shift_handoff_admin_lifecycle.sql', '20260723203000_shift_handoff_admin_lifecycle.sql'],
  ['supabase/migrations/20260724110000_checklist_template_editor_preview.sql', '20260724110000_checklist_template_editor_preview.sql'],
  ['supabase/migrations/20260724150000_role_security_preview.sql', '20260724150000_role_security_preview.sql'],
];

const forbiddenSources = [
  'ROLLBACK_STEP_12_NOTIFICATION_HISTORY.sql',
  'STEP_2_SEED_ADMIN_AFTER_AUTH_USER.sql',
  'STEP_3_OPTIONAL_JULY_SCHEDULE.sql',
  'STEP_7_FIX_RLS_CONTENT_SYNC.sql',
];

for (const forbidden of forbiddenSources) {
  assert(!plan.some(([source]) => source.endsWith(forbidden)), `Forbidden preview SQL selected: ${forbidden}`);
}

await fs.rm(workspace, { recursive: true, force: true });
await fs.mkdir(migrationsDir, { recursive: true });
await fs.mkdir(artifactDir, { recursive: true });
await fs.copyFile(path.join(root, 'supabase', 'config.toml'), path.join(workspace, 'supabase', 'config.toml'));

const report = [];
for (const [source, target] of plan) {
  const sourcePath = path.join(root, source);
  const targetPath = path.join(migrationsDir, target);
  const sql = await fs.readFile(sourcePath, 'utf8');
  assert(sql.trim(), `Migration source is empty: ${source}`);
  await fs.writeFile(targetPath, sql);
  report.push({ source, migration: `supabase/migrations/${target}`, bytes: Buffer.byteLength(sql) });
}

await fs.writeFile(
  path.join(artifactDir, 'migration-plan.json'),
  JSON.stringify({ workspace: '.live-preview-workspace', migrations: report }, null, 2),
);

console.log('Prepared dedicated Free preview migration bundle:');
for (const item of report) console.log(`- ${item.source} -> ${item.migration}`);

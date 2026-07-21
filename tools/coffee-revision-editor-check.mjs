import './coffee-revision-formula-check.mjs';
import fs from 'node:fs';

const editor = fs.readFileSync('assets/js/coffee-revision-editor.js', 'utf8');
const formulaCore = fs.readFileSync('assets/js/coffee-revision-formula-core.js', 'utf8');
const formulaFix = fs.readFileSync('assets/js/coffee-revision-formula-fix.js', 'utf8');
const styles = fs.readFileSync('assets/css/coffee-revision-editor.css', 'utf8');
const config = fs.readFileSync('assets/js/supabase-config.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260721183000_coffee_revision_admin_correction.sql', 'utf8');
const formulaMigration = fs.readFileSync('supabase/migrations/20260721190000_coffee_revision_formula_corrections.sql', 'utf8');
const stockMigration = fs.readFileSync('supabase/migrations/20260721203000_coffee_revision_total_stock.sql', 'utf8');
const previewPlan = fs.readFileSync('tools/live-preview-prepare-migrations.mjs', 'utf8');
const previewConfig = fs.readFileSync('tools/live-preview-feature-config.mjs', 'utf8');
const previewSmoke = fs.readFileSync('tools/live-preview-coffee-revision-smoke.mjs', 'utf8');

const required = [
  [config.includes('coffee-revision-editor.js') && config.includes('coffee-revision-editor.css'), 'production config must load the correction module and styles'],
  [config.includes('coffee-revision-formula-core.js') && config.includes('coffee-revision-formula-fix.js'), 'production config must load formula fixes before the editor'],
  [editor.includes("normalizeRole(currentUser()?.role) === 'admin'"), 'correction interface must be visible only to admin'],
  [editor.includes('Дата и первоначальный сотрудник сохраняются'), 'interface must explain immutable date and author'],
  [editor.includes('name="reason"') && editor.includes('required'), 'correction reason must be required'],
  [editor.includes("supa.rpc('correct_coffee_revision'"), 'interface must use the protected correction RPC'],
  [editor.includes("from('coffee_revision_edits')"), 'interface must display the correction audit history'],
  [editor.includes('name="grainDelivery"') && editor.includes('name="stockBalanceOverride"'), 'editor must include delivery and end-of-day stock inputs'],
  [editor.includes('p_grain_delivery') && editor.includes('p_stock_balance_override'), 'editor must submit stock values through the protected RPC'],
  [formulaCore.includes('totalLossWeight') && formulaCore.includes('Math.max(0, -difference)'), 'formula core must include write-offs and negative discrepancy in total losses'],
  [formulaCore.includes('previousTotalGrainBalance') && formulaCore.includes('grainDelivery') && formulaCore.includes('stockBalanceOverride'), 'formula core must calculate stock from an anchor, deliveries and usage'],
  [formulaFix.includes(".from('coffee_revisions')") && formulaFix.includes('.update(values)'), 'manual control form must update an existing revision'],
  [formulaFix.includes('Потери всего (кг.)') && formulaFix.includes('Потери от продаж'), 'table must show total loss weight and percentage separately'],
  [formulaFix.includes('Поставка зерна (кг.)') && formulaFix.includes('Общий остаток зерна (кг.)'), 'table must display delivery and total stock'],
  [styles.includes('grid-template-columns: repeat(12') && styles.includes('height: 48px') && styles.includes('@media (max-width: 1100px)') && styles.includes('@media (max-width: 720px)'), 'correction form must use an ordered responsive grid with equal-height controls'],
  [migration.includes('create table if not exists public.coffee_revision_edits'), 'migration must create an audit table'],
  [migration.includes('before_data jsonb not null') && migration.includes('after_data jsonb not null'), 'audit must keep before and after values'],
  [migration.includes('coffee_revision_edits_select_admin'), 'audit history must have an admin-only RLS policy'],
  [formulaMigration.includes('write_offs + greatest(-difference_calc, 0)') && formulaMigration.includes('total_loss_weight'), 'database view must calculate total losses using write-offs and negative discrepancy'],
  [stockMigration.includes('add column if not exists grain_delivery') && stockMigration.includes('add column if not exists stock_balance_override'), 'stock migration must add delivery and stock anchor fields'],
  [stockMigration.includes('with recursive') && stockMigration.includes('total_grain_balance_calc'), 'stock migration must calculate a sequential end-of-day balance'],
  [stockMigration.includes('create or replace function public.correct_coffee_revision') && stockMigration.includes('p_stock_balance_override'), 'stock migration must replace the correction RPC'],
  [stockMigration.includes('where revision_date = p_revision_date') && !stockMigration.includes('set revision_date ='), 'correction must not change the revision date'],
  [stockMigration.includes('update public.coffee_revisions') && !/set[\s\S]{0,300}employee_(id|name)\s*=/.test(stockMigration), 'correction must not change the original employee'],
  [previewPlan.includes('20260721183000_coffee_revision_admin_correction.sql'), 'dedicated preview must apply the correction migration'],
  [previewPlan.includes('20260721190000_coffee_revision_formula_corrections.sql'), 'dedicated preview must apply the formula migration'],
  [previewPlan.includes('20260721203000_coffee_revision_total_stock.sql'), 'dedicated preview must apply the stock migration'],
  [previewConfig.includes('coffee-revision-editor.js') && previewConfig.includes('coffee-revision-formula-fix.js') && previewConfig.includes('must not target production'), 'preview config must load all revision tools and reject production'],
  [previewSmoke.includes('administrator correction accepted'), 'live preview must test successful admin correction'],
  [previewSmoke.includes('manager correction rejected') && previewSmoke.includes('barista correction rejected'), 'live preview must reject non-admin correction'],
  [previewSmoke.includes('immutable audit entry created') && previewSmoke.includes('cleanTestData'), 'live preview must test audit creation and clean test data'],
];

const forbidden = [
  [/\.from\(['"]coffee_revisions['"]\)\.update/.test(editor), 'full correction editor must not directly update coffee revisions'],
  [/service_role_[A-Za-z0-9_-]{16,}|sb_secret_[A-Za-z0-9_-]{16,}/.test(editor + formulaFix + config + previewConfig + previewSmoke), 'no secret key may be hardcoded'],
  [/employee_id\s*=\s*p_|employee_name\s*=\s*p_/.test(stockMigration), 'correction RPC must not accept replacement employee identity'],
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

console.log('Coffee revision correction, layout and total stock checks passed.');
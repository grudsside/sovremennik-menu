import assert from 'node:assert/strict';
import fs from 'node:fs';

const core = fs.readFileSync('assets/js/shift-handoff-core.js', 'utf8');
const integration = fs.readFileSync('assets/js/shift-handoff.js', 'utf8');
const css = fs.readFileSync('assets/css/shift-handoff.css', 'utf8');
const hotfixCss = fs.readFileSync('assets/css/shift-handoff-hotfix.css', 'utf8');
const mobileInputFix = fs.readFileSync('assets/js/shift-handoff-mobile-input-fix.js', 'utf8');
const loader = fs.readFileSync('assets/js/push.js', 'utf8');
const serviceWorker = fs.readFileSync('service-worker.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260723150000_shift_handoff_preview.sql', 'utf8');
const roleMigration = fs.readFileSync('supabase/migrations/20260723190000_shift_handoff_barista_only.sql', 'utf8');
const lifecycleMigration = fs.readFileSync('supabase/migrations/20260723203000_shift_handoff_admin_lifecycle.sql', 'utf8');
const previewPlan = fs.readFileSync('tools/live-preview-prepare-migrations.mjs', 'utf8');
const productionScript = fs.readFileSync('tools/production-shift-handoff-release.mjs', 'utf8');
const productionWorkflow = fs.readFileSync('.github/workflows/production-shift-handoff-release.yml', 'utf8');

for (const token of ['splitLines', 'pendingForUser', 'buildStoragePath']) {
  assert(core.includes(token), `Core helper is missing: ${token}`);
}
for (const token of [
  "const CLOSING_CHECKLIST_ID = 'closing-checklist'",
  "new Set(['admin', 'barista'])",
  'Текущая передача смены',
  'Передача ещё не отправлена',
  'Замечаний нет',
  'Финальный шаг чек-листа закрытия',
  'data-shift-handoff-checklist',
  "event.target.closest('.submit-checklist')",
  "supa.rpc('create_shift_handoff'",
  "supa.rpc('acknowledge_shift_handoff'",
  'await createHandoffFromDraft()',
  'currentHandoff()',
  'localStorage.setItem(DRAFT_KEY',
  'MAX_PHOTOS = 3',
]) {
  assert(integration.includes(token), `Shift handoff integration is missing: ${token}`);
}
assert(!integration.includes('doc?.file'), 'Checklist matching must not use the shared open/close file name');
assert(!integration.includes('data-shift-handoff-open'), 'Standalone handoff creation button must not remain on the home dashboard');
assert(css.includes('.shift-handoff-read-state'), 'Persistent acknowledgement status styles are missing');
assert(css.includes('.shift-handoff-checklist-step'), 'Compact closing-checklist step styles are missing');
assert(css.includes('@media(max-width:760px)'), 'Mobile shift handoff layout is missing');
for (const token of [
  '#top-home > .shift-handoff-incoming',
  'margin-top:24px !important',
  'margin-top:20px !important',
  'font-size:16px !important',
  'pointer-events:auto !important',
]) {
  assert(hotfixCss.includes(token), `Shift handoff spacing/mobile CSS hotfix is missing: ${token}`);
}
for (const token of [
  'protectsFocusedShiftEditor',
  "this.matches?.('[data-shift-handoff-checklist]')",
  "document.addEventListener('focusin'",
  'shift-handoff-mobile-editing',
]) {
  assert(mobileInputFix.includes(token), `Shift handoff mobile focus fix is missing: ${token}`);
}
assert(loader.indexOf('shift-handoff-core.js') < loader.indexOf('shift-handoff.js'), 'Core must load before integration');
assert(loader.indexOf('shift-handoff.js') < loader.indexOf('shift-handoff-mobile-input-fix.js'), 'Mobile focus fix must load after integration');
assert(loader.includes('shift-handoff-hotfix.css?v=20260724-1'), 'Hotfix CSS cache-busting is missing');
assert(loader.includes('shift-handoff-mobile-input-fix.js?v=20260724-1'), 'Mobile focus hotfix cache-busting is missing');
for (const asset of [
  'assets/css/shift-handoff.css',
  'assets/css/shift-handoff-hotfix.css',
  'assets/js/shift-handoff-core.js',
  'assets/js/shift-handoff.js',
  'assets/js/shift-handoff-mobile-input-fix.js',
]) {
  assert(serviceWorker.includes(asset), `Offline app shell is missing ${asset}`);
}
for (const token of [
  'sovremennik-offline-20260724-v2',
  'const NETWORK_TIMEOUT_MS = 4000',
  'new AbortController()',
  'controller.abort()',
  'fetch(request, { signal:controller.signal })',
]) {
  assert(serviceWorker.includes(token), `Bounded network-first fallback is missing: ${token}`);
}
for (const token of [
  'create table if not exists public.shift_handoffs',
  'create table if not exists public.shift_handoff_acknowledgements',
  'create table if not exists public.shift_handoff_photos',
  'create or replace function public.create_shift_handoff',
  'create or replace function public.acknowledge_shift_handoff',
  "'shift-handoff-photos'",
]) {
  assert(migration.includes(token), `Shift handoff migration is missing: ${token}`);
}
for (const source of [roleMigration, lifecycleMigration]) {
  for (const token of [
    'create or replace function public.is_shift_handoff_user',
    "profile.role in ('admin','barista')",
    'public.is_shift_handoff_user()',
    "'9999-12-31 23:59:59+00'",
    'Active administrator or barista profile required',
  ]) {
    assert(source.includes(token), `Admin lifecycle migration is missing: ${token}`);
  }
}
assert(previewPlan.includes('20260723150000_shift_handoff_preview.sql'), 'Live preview migration plan is missing shift handoff schema');
assert(previewPlan.includes('20260723190000_shift_handoff_barista_only.sql'), 'Live preview migration plan is missing role migration');
assert(previewPlan.includes('20260723203000_shift_handoff_admin_lifecycle.sql'), 'Live preview migration plan is missing admin lifecycle migration');
for (const token of [
  "expectedProductionRef = 'tjibbzfdughhjenumzxo'",
  '20260723150000_shift_handoff_preview.sql',
  '20260723190000_shift_handoff_barista_only.sql',
  '20260723203000_shift_handoff_admin_lifecycle.sql',
  "to_regclass('public.shift_handoffs')",
  "to_regprocedure('public.is_shift_handoff_user()')",
  "bucket: 'shift-handoff-photos'",
]) {
  assert(productionScript.includes(token), `Production shift handoff verification is missing: ${token}`);
}
for (const token of [
  'name: Production shift handoff release',
  'production/shift-handoff',
  'node tools/production-shift-handoff-release.mjs',
  'shift-handoff-hotfix.css?v=20260724-1',
  'shift-handoff-mobile-input-fix.js?v=20260724-1',
  'PRODUCTION_PROJECT_REF: tjibbzfdughhjenumzxo',
  "! grep -q 'enkftanmqlwvjydliwue'",
]) {
  assert(productionWorkflow.includes(token), `Production shift handoff workflow is missing: ${token}`);
}
assert(!productionWorkflow.includes('PRODUCTION_PROJECT_REF: enkftanmqlwvjydliwue'), 'Production target must not use Preview Supabase');

console.log('Shift handoff roles, lifecycle, spacing, mobile focus, offline fallback and production rollout checks passed.');
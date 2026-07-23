import assert from 'node:assert/strict';
import fs from 'node:fs';

const core = fs.readFileSync('assets/js/shift-handoff-core.js', 'utf8');
const integration = fs.readFileSync('assets/js/shift-handoff.js', 'utf8');
const css = fs.readFileSync('assets/css/shift-handoff.css', 'utf8');
const loader = fs.readFileSync('assets/js/push.js', 'utf8');
const serviceWorker = fs.readFileSync('service-worker.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260723150000_shift_handoff_preview.sql', 'utf8');
const previewPlan = fs.readFileSync('tools/live-preview-prepare-migrations.mjs', 'utf8');

for (const token of ['splitLines', 'pendingForUser', 'buildStoragePath']) {
  assert(core.includes(token), `Core helper is missing: ${token}`);
}
for (const token of [
  'От предыдущей смены',
  'Финальный шаг чек-листа закрытия',
  'Замечаний нет',
  'Есть информация',
  'data-shift-handoff-checklist',
  "event.target.closest('.submit-checklist')",
  "supa.rpc('create_shift_handoff'",
  "supa.rpc('acknowledge_shift_handoff'",
  'localStorage.setItem(DRAFT_KEY',
  'MAX_PHOTOS = 3',
]) {
  assert(integration.includes(token), `Shift handoff integration is missing: ${token}`);
}
assert(!integration.includes('data-shift-handoff-open'), 'Standalone handoff button must not remain on the home dashboard');
assert(css.includes('.shift-handoff-checklist-step'), 'Compact closing-checklist step styles are missing');
assert(css.includes('@media(max-width:760px)'), 'Mobile shift handoff layout is missing');
assert(loader.indexOf('shift-handoff-core.js') < loader.indexOf('shift-handoff.js'), 'Core must load before integration');
for (const asset of ['assets/css/shift-handoff.css', 'assets/js/shift-handoff-core.js', 'assets/js/shift-handoff.js']) {
  assert(serviceWorker.includes(asset), `Offline app shell is missing ${asset}`);
}
for (const token of [
  'create table if not exists public.shift_handoffs',
  'create table if not exists public.shift_handoff_acknowledgements',
  'create table if not exists public.shift_handoff_photos',
  'create or replace function public.create_shift_handoff',
  'create or replace function public.acknowledge_shift_handoff',
  "'shift-handoff-photos'",
  'shift_handoff_storage_insert_owner',
]) {
  assert(migration.includes(token), `Shift handoff migration is missing: ${token}`);
}
assert(previewPlan.includes('20260723150000_shift_handoff_preview.sql'), 'Live preview migration plan is missing shift handoff');

console.log('Shift handoff closing-checklist integration checks passed.');

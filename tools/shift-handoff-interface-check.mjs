import assert from 'node:assert/strict';
import fs from 'node:fs';

const core = fs.readFileSync('assets/js/shift-handoff-core.js','utf8');
const integration = fs.readFileSync('assets/js/shift-handoff.js','utf8');
const mobileFix = fs.readFileSync('assets/js/shift-handoff-mobile-input-fix.js','utf8');
const css = fs.readFileSync('assets/css/shift-handoff.css','utf8');
const hotfixCss = fs.readFileSync('assets/css/shift-handoff-hotfix.css','utf8');
const loader = fs.readFileSync('assets/js/push.js','utf8');
const serviceWorker = fs.readFileSync('service-worker.js','utf8');
const migration = fs.readFileSync('supabase/migrations/20260723130000_shift_handoff_preview.sql','utf8');
const roleMigration = fs.readFileSync('supabase/migrations/20260723143000_shift_handoff_roles_preview.sql','utf8');
const lifecycleMigration = fs.readFileSync('supabase/migrations/20260723150000_shift_handoff_lifecycle_preview.sql','utf8');

for(const token of [
  "const VERSION = '2026-07-23-shift-handoff-core-1'",
  'normalizeHandoff','validateDraft','needsAcknowledgement','departmentForRole','audienceIncludes'
]) assert(core.includes(token),`Shift handoff core is missing: ${token}`);
for(const token of [
  'data-shift-handoff-form','data-shift-handoff-current','data-shift-handoff-previous','data-shift-handoff-ack',
  "rpc('create_shift_handoff'","rpc('acknowledge_shift_handoff'",'shift-handoff-photos','queueEnhance'
]) assert(integration.includes(token),`Shift handoff integration is missing: ${token}`);
for(const token of ['focusin','visualViewport','scrollIntoView','data-shift-handoff-form']) assert(mobileFix.includes(token),`Shift handoff mobile fix is missing: ${token}`);
for(const token of ['.shift-handoff-card{','.shift-handoff-form{','.shift-handoff-feed{','.shift-handoff-status{']) assert(css.includes(token),`Shift handoff CSS is missing: ${token}`);
for(const token of ['.shift-handoff-form input','.shift-handoff-form textarea','font-size:16px']) assert(hotfixCss.includes(token),`Shift handoff hotfix CSS is missing: ${token}`);

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
]) assert(serviceWorker.includes(asset), `Offline app shell is missing ${asset}`);
assert(/sovremennik-offline-20260730-v\d+/.test(serviceWorker), 'PWA cache was not refreshed for the current app shell');

for (const token of [
  'create table if not exists public.shift_handoffs',
  'create table if not exists public.shift_handoff_acknowledgements',
  'create table if not exists public.shift_handoff_photos',
  'create or replace function public.create_shift_handoff',
  'create or replace function public.acknowledge_shift_handoff',
  "'shift-handoff-photos'",
]) assert(migration.includes(token), `Shift handoff migration is missing: ${token}`);
for (const source of [roleMigration, lifecycleMigration]) {
  assert(source.includes('shift_handoff'), 'Shift handoff follow-up migration is incomplete');
}

console.log('Shift handoff interface checks passed.');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('assets/js/control-v4-core.js', 'utf8');
const storage = fs.readFileSync('assets/js/control-v4-storage.js', 'utf8');
const service = fs.readFileSync('assets/js/control-v4-service.js', 'utf8');
const control = fs.readFileSync('assets/js/control-v4-control.js', 'utf8');
const checklists = fs.readFileSync('assets/js/control-v4-checklists.js', 'utf8');
const bootstrap = fs.readFileSync('assets/js/control-v4.js', 'utf8');
const css = fs.readFileSync('assets/css/control-v4.css', 'utf8');
const loader = fs.readFileSync('assets/js/push.js', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');

const context = { window:{} };
context.window.window = context.window;
context.window.crypto = { randomUUID:() => '00000000-0000-4000-8000-000000000001' };
vm.runInNewContext(source, context);
const Core = context.window.SovremennikControlV4Core;
assert.ok(Core, 'Control v4 core must load');

const doc = { id:'waiter-opening', title:'Чек-лист открытия официанта', sections:[{ title:'Зал', rows:[{task:'Столы готовы'},{task:'Меню на месте'}] }] };
assert.equal(Core.departmentForDoc(doc), 'waiter');
assert.equal(Core.flattenChecklist(doc).length, 2);
const summary = Core.summarize([
  {itemKey:'one', checkedByUser:true, requiredPhotoCount:1, photoCount:1},
  {itemKey:'two', checkedByUser:true, requiredPhotoCount:1, photoCount:0}
]);
assert.equal(summary.done, 1);
assert.equal(summary.missingPhotos, 1);
assert.equal(summary.incomplete, true);
assert.equal(JSON.stringify(Core.photoPaths({userId:'user 1',submissionId:'submission 1',itemKey:'item/1',index:2})), JSON.stringify({
  fullPath:'user-1/submission-1/item-1/full-2.jpg',
  thumbnailPath:'user-1/submission-1/item-1/thumb-2.jpg'
}));
assert.equal(
  Core.snapshotFingerprint({userId:'u',checklistId:'c',employeeName:'Анна',tasks:[{itemKey:'1',checkedByUser:true}]}),
  Core.snapshotFingerprint({tasks:[{checkedByUser:true,itemKey:'1'}],employeeName:'Анна',checklistId:'c',userId:'u'})
);

for(const marker of [
  "DB_NAME = 'sovremennik-control-v4'", "const DRAFTS = 'drafts'", "const QUEUE = 'queue'",
  'submissionId', 'migrateLegacy', "readLegacyDatabase('sovremennik-offline-v1'", "readLegacyDatabase('sovremennik-checklist-photo-drafts-v1'"
]) assert.ok(storage.includes(marker), `Missing storage marker: ${marker}`);

for(const marker of [
  'ensureSubmissionRow', 'existingPhoto', 'syncPending', 'finalize_checklist_photo_submission',
  'PHOTO_RULES_CACHE', 'Core.isDuplicateError', 'Core.photoPaths'
]) assert.ok(service.includes(marker), `Missing service marker: ${marker}`);

for(const marker of [
  'function renderControl()', 'data-control-v4-department-panel', 'data-control-v4-day-toggle',
  'data-control-v4-report-toggle', "document.addEventListener('click'", 'function setDepartment('
]) assert.ok(control.includes(marker), `Missing Control journal marker: ${marker}`);
assert.ok(!control.includes('stopImmediatePropagation'), 'Control v4 must not cancel competing mobile clicks');
assert.ok(!control.includes('<details') && !control.includes('<summary'), 'Control v4 journal must not depend on native details/summary interactions');

for(const marker of [
  "insertAdjacentHTML('afterend'", 'locks=new Set()', 'async function submit(', 'Storage.saveQueue(item)',
  'Storage.deleteDraft(', 'function restoreOfflineSession()', 'data-control-v4-photo-field'
]) assert.ok(checklists.includes(marker), `Missing checklist lifecycle marker: ${marker}`);
const submitBody = checklists.slice(checklists.indexOf('async function submit('));
assert.ok(submitBody.indexOf('Storage.saveQueue(item)') < submitBody.indexOf('Storage.deleteDraft('), 'Queue must be durable before draft deletion');

for(const marker of [
  "const VERSION='2026-07-30-control-v4-1'", 'global.renderControl=Control.render',
  'global.submitChecklist=Checklists.submit', 'global.SovremennikOffline=Object.freeze',
  "const SUMMARY_RESTORE_VERSION='2026-07-31-summary-restore-1'", 'function installSummaryRestore()',
  'global.renderControlSummaryV21', 'global.renderManualReportBuilderV23',
  'app.controlRecords=Array.isArray(Control.ui.submissions)'
]) assert.ok(bootstrap.includes(marker), `Missing bootstrap marker: ${marker}`);
assert.ok(bootstrap.includes('if(oldButton)oldButton.remove()'), 'Summary must keep one global refresh action');

for(const marker of [
  'touch-action:manipulation', '.control-v4-day-toggle', '.control-v4-report-toggle',
  '.control-v4-department-panel', '@media(max-width:720px)'
]) assert.ok(css.includes(marker), `Missing Control v4 CSS marker: ${marker}`);

const v4Assets = [
  'control-v4-core.js', 'control-v4-storage.js', 'control-v4-service.js',
  'control-v4-control.js', 'control-v4-checklists.js', 'control-v4.js'
];
for(const asset of v4Assets) assert.ok(loader.includes(asset), `Control v4 loader missing: ${asset}`);
assert.ok(
  loader.indexOf('control-v4-core.js') < loader.indexOf('control-v4-storage.js') &&
  loader.indexOf('control-v4-storage.js') < loader.indexOf('control-v4-service.js') &&
  loader.indexOf('control-v4-service.js') < loader.indexOf('control-v4-control.js') &&
  loader.indexOf('control-v4-control.js') < loader.indexOf('control-v4-checklists.js') &&
  loader.indexOf('control-v4-checklists.js') < loader.indexOf('control-v4.js'),
  'Control v4 modules must load in dependency order'
);
for(const old of [
  'checklist-photo-reports.js','offline-sync.js','checklist-review-observer-guard.js',
  'checklist-review-tools.js','checklist-photo-draft-fix.js','control-v3-core.js',
  'control-v3.js','control-v3-regression-fix.js'
]) assert.ok(!loader.includes(old), `Legacy runtime still loaded: ${old}`);

assert.ok(worker.includes('sovremennik-offline-20260730-v30'), 'PWA cache v30 trace is required');
assert.ok(worker.includes("sovremennik-offline-20260730-v32"), 'PWA cache v32 is required');
for(const asset of v4Assets) assert.ok(worker.includes(`./assets/js/${asset}`), `Control v4 app shell missing: ${asset}`);
assert.ok(worker.includes('./assets/css/control-v4.css'), 'Control v4 CSS must be precached');
for(const old of ['checklist-photo-reports.js','offline-sync.js','checklist-review-tools.js','checklist-photo-draft-fix.js','control-v3.js']) {
  assert.ok(!worker.includes(`./assets/js/${old}`), `Legacy app-shell asset remains: ${old}`);
}

console.log('Control v4 core, storage, one-shot submission, restored summary and runtime isolation checks passed.');

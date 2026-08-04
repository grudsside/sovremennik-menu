import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const shared = fs.readFileSync('assets/js/control-v4-shared-drafts.js', 'utf8');
const storage = fs.readFileSync('assets/js/control-v4-storage.js', 'utf8');
const checklists = fs.readFileSync('assets/js/control-v4-checklists.js', 'utf8');
const loader = fs.readFileSync('assets/js/push.js', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');
const migrationFiles = [
  'supabase/migrations/20260804170000_checklist_shared_drafts_schema.sql',
  'supabase/migrations/20260804171000_checklist_shared_drafts_photos_finalize.sql',
  'supabase/migrations/20260804172000_checklist_shared_drafts_security.sql'
];
const migration = migrationFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
const previewPlan = fs.readFileSync('tools/live-preview-prepare-migrations.mjs', 'utf8');
const workflow = fs.readFileSync('.github/workflows/shared-checklist-sync.yml', 'utf8');

for(const marker of [
  'open_checklist_shared_draft', 'patch_checklist_shared_draft',
  'attach_checklist_shared_draft_photo', 'remove_checklist_shared_draft_photo',
  'finalize_checklist_shared_draft', "status in ('draft','submitting','submitted')",
  'can_access_checklist_shared_department', 'checklist_shared_photo_storage_select_accessible',
  'alter publication supabase_realtime add table public.checklist_shared_drafts',
  'Only the submission owner may attach photos',
  'submission.employee_id = auth.uid()'
]) assert.ok(migration.includes(marker), `Missing shared-draft migration marker: ${marker}`);

assert.ok(!shared.includes('upsert:true'), 'Shared photo retries must not require Storage UPDATE permission');
assert.ok(migration.includes('unique (checklist_id, department, work_date)'), 'One shared draft per checklist, department and work date is required');
assert.ok(!migration.includes('grant insert on table public.checklist_shared_drafts to authenticated'), 'Browser clients must not write shared tables directly');

for(const marker of [
  'SovremennikControlV4SharedDrafts', "table:'checklist_shared_draft_items'",
  "table:'checklist_shared_draft_photos'", "event:'sync'", 'syncPendingFinalizations',
  'pendingFinalize', 'mergeLocal', 'Service.signedUrl', 'upsert:false', 'uploadObject'
]) assert.ok(shared.includes(marker), `Missing shared runtime marker: ${marker}`);

for(const marker of [
  'sharedDraftId', 'dirtyItemKeys', 'dirtyEmployeeName',
  'pendingFinalize', 'finalizeEmployeeName', "remote ? 'synced' : 'pending'"
]) assert.ok(storage.includes(marker), `IndexedDB shared state missing: ${marker}`);

for(const marker of [
  'Shared.open', 'Shared.sync', 'Shared.finalize', 'Shared.removePhoto',
  'sov:control-v4-shared-remote', 'sov:control-v4-shared-presence',
  'Синхронизировано на всех устройствах', 'Storage.saveDraft(draft)',
  'pendingDirtyItems', 'pendingDirtyNames'
]) assert.ok(checklists.includes(marker), `Checklist UI shared marker missing: ${marker}`);

const assets = [
  'control-v4-core.js', 'control-v4-storage.js', 'control-v4-service.js',
  'control-v4-shared-drafts.js', 'control-v4-control.js', 'control-v4-checklists.js', 'control-v4.js'
];
for(const asset of assets){
  assert.ok(loader.includes(asset), `Loader missing ${asset}`);
  assert.ok(worker.includes(`./assets/js/${asset}`), `PWA shell missing ${asset}`);
}
assert.ok(loader.indexOf('control-v4-service.js') < loader.indexOf('control-v4-shared-drafts.js'), 'Shared module must load after the Supabase service');
assert.ok(loader.indexOf('control-v4-shared-drafts.js') < loader.indexOf('control-v4-checklists.js'), 'Shared module must load before checklist UI');
assert.ok(worker.includes('sovremennik-offline-20260804-v34'), 'PWA cache must be bumped for shared checklist assets');
for(const file of migrationFiles){
  assert.ok(previewPlan.includes(file.split('/').pop()), `Live preview must apply ${file}`);
  assert.ok(workflow.includes(file), `Shared sync workflow must watch and apply ${file}`);
}
assert.ok(workflow.includes('control-v4-shared-drafts-check.mjs'), 'Repository CI must run the shared-draft check');
assert.ok(workflow.includes('checklist-shared-drafts-db-smoke.sql'), 'Database preview must exercise multi-user draft finalization');

const context = {
  navigator:{ onLine:true },
  CustomEvent:class CustomEvent { constructor(type, init){ this.type = type; this.detail = init?.detail; } },
  setTimeout,
  clearTimeout,
  console,
  window:{
    addEventListener(){},
    dispatchEvent(){},
    localStorage:{ getItem(){ return ''; }, setItem(){} },
    SovremennikControlV4Core:{
      text:value => String(value ?? '').trim(),
      uuid:() => '00000000-0000-4000-8000-000000000001',
      draftKey:(userId, checklistId) => `${userId}|${checklistId}`,
      normalizeTask:row => ({
        itemKey:String(row?.itemKey || row?.item_key || ''),
        text:String(row?.text || row?.task || ''),
        sectionTitle:String(row?.sectionTitle || ''),
        checkedByUser:Boolean(row?.checkedByUser),
        checked:Boolean(row?.checkedByUser),
        photoRequired:Boolean(row?.photoRequired),
        requiredPhotoCount:Number(row?.requiredPhotoCount || 0),
        photoCount:Number(row?.photoCount || 0)
      })
    },
    SovremennikControlV4Storage:{ draftsForUser:async() => [], saveDraft:async row => row, deleteDraft:async() => {} },
    SovremennikControlV4Service:{
      client:() => null,
      user:() => ({ id:'user-1', name:'Анна' }),
      authenticated:() => true,
      signedUrl:async path => `signed:${path}`,
      PHOTO_BUCKET:'checklist-photo-reports'
    }
  }
};
context.window.window = context.window;
context.window.navigator = context.navigator;
context.window.CustomEvent = context.CustomEvent;
vm.runInNewContext(shared, context);
const Shared = context.window.SovremennikControlV4SharedDrafts;
assert.ok(Shared, 'Shared draft module must load');

const remote = Shared.normalizePayload({
  id:'draft-1', submissionId:'submission-1', checklistId:'opening', checklistTitle:'Открытие',
  department:'barista', workDate:'2026-08-04', status:'draft', version:3,
  items:[
    { itemKey:'one', text:'Первый', checkedByUser:false },
    { itemKey:'two', text:'Второй', checkedByUser:true }
  ],
  photos:[]
});
const merged = Shared.mergeLocal(remote, {
  userId:'user-1', checklistId:'opening', employeeName:'Анна', dirtyEmployeeName:true,
  tasks:[
    { itemKey:'one', text:'Первый', checkedByUser:true },
    { itemKey:'two', text:'Второй', checkedByUser:false }
  ],
  dirtyItemKeys:['one'],
  photos:[{ id:'local-photo', itemKey:'one', fullBlob:{ size:10, type:'image/jpeg' }, thumbnailBlob:{ size:5 } }]
});
assert.equal(merged.tasks.find(row => row.itemKey === 'one').checkedByUser, true, 'Dirty local field must win until it is synced');
assert.equal(merged.tasks.find(row => row.itemKey === 'two').checkedByUser, true, 'Untouched field must keep the remote value');
assert.equal(merged.employeeName, 'Анна', 'Dirty employee name must survive a remote refresh');
assert.equal(merged.photos.length, 1, 'Pending local photo must survive a remote refresh');
assert.deepEqual(Array.from(merged.dirtyItemKeys), ['one']);

const submitted = Shared.mergeLocal({ ...remote, sharedStatus:'submitted', status:'submitted' }, merged);
assert.equal(submitted.dirtyItemKeys.length, 0, 'Submitted draft must clear local dirty fields');
assert.equal(submitted.pendingFinalize, false, 'Submitted draft must stop pending finalization');

console.log('Shared checklist multi-device, Realtime, offline resume, RLS and runtime wiring checks passed.');

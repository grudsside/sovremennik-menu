import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('assets/js/checklist-photo-core.js', 'utf8');
const loader = readFileSync('assets/js/push.js', 'utf8');
const viewerFit = readFileSync('assets/css/checklist-photo-viewer-fit.css', 'utf8');
const migration = readFileSync('supabase/migrations/20260722130000_checklist_photo_reports_preview.sql', 'utf8');
const retention = readFileSync('supabase/functions/checklist-photo-retention/index.ts', 'utf8');

const context = { console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'checklist-photo-core.js' });
const core = context.SovremennikChecklistPhotoCore;
assert.ok(core, 'Checklist photo core must be published');

const document = {
  id: 'opening',
  title: 'Чек-лист открытия',
  sections: [
    { title: 'Бар', rows: [{ task: 'Проверить витрину' }, { task: 'Протереть кофемашину' }] },
    { title: 'Зал', rows: [{ task: 'Проверить столы' }] },
  ],
};
const flattened = core.flattenChecklist(document);
assert.deepEqual(
  Array.from(flattened, row => row.itemKey),
  ['opening:0:0', 'opening:0:1', 'opening:1:0'],
  'Checklist item keys must remain stable for the same document order',
);

const rules = core.rulesByKey([
  { checklist_id: 'opening', item_key: 'opening:0:1', item_text: 'Протереть кофемашину', required_count: 2, is_active: true },
]);
assert.equal(rules.get('opening|opening:0:1').requiredCount, 2);

const withoutPhoto = core.evaluateTask({
  itemKey: 'opening:0:1',
  text: 'Протереть кофемашину',
  checkedByUser: true,
  photoRequired: true,
  requiredPhotoCount: 2,
}, 1);
assert.equal(withoutPhoto.checked, false, 'Checkbox alone must not complete a photo-required item');
assert.equal(withoutPhoto.photoStatus, 'partial');
assert.equal(withoutPhoto.missingPhotoCount, 1);

const withPhotos = core.evaluateTask({
  itemKey: 'opening:0:1',
  text: 'Протереть кофемашину',
  checkedByUser: true,
  requiredPhotoCount: 2,
}, 2);
assert.equal(withPhotos.checked, true, 'Required photo count plus checkbox must complete the item');

const summary = core.summarize([
  { itemKey: 'opening:0:0', text: 'Проверить витрину', checkedByUser: true, checked: true },
  { itemKey: 'opening:0:1', text: 'Протереть кофемашину', checkedByUser: true, requiredPhotoCount: 2 },
  { itemKey: 'opening:1:0', text: 'Проверить столы', checkedByUser: false, checked: false },
], [
  { itemKey: 'opening:0:1' },
  { itemKey: 'opening:0:1' },
]);
assert.equal(summary.done, 2);
assert.equal(summary.total, 3);
assert.equal(summary.percent, 67);
assert.equal(summary.requiredPhotos, 2);
assert.equal(summary.attachedPhotos, 2);
assert.equal(summary.missingPhotos, 0);
assert.equal(summary.incomplete, true);

const grouped = core.groupRecordsByDay([
  { id: 'old', createdAt: '2026-07-20T10:00:00Z' },
  { id: 'new-a', createdAt: '2026-07-22T09:00:00Z' },
  { id: 'new-b', createdAt: '2026-07-22T12:00:00Z' },
]);
assert.equal(grouped.length, 2);
assert.equal(grouped[0].dateKey, '2026-07-22');
assert.deepEqual(Array.from(grouped[0].records, row => row.id), ['new-b', 'new-a']);

const paths = core.buildStoragePaths({
  userId: 'employee-id',
  submissionId: 'submission-id',
  itemKey: 'opening:0:1',
  index: 2,
  nonce: 'fixed',
});
assert.match(paths.fullPath, /^employee-id\/submission-id\/opening-0-1\/full-2-fixed\.jpg$/);
assert.match(paths.thumbnailPath, /^employee-id\/submission-id\/opening-0-1\/thumb-2-fixed\.jpg$/);

for (const marker of [
  'assets/css/checklist-photo-reports.css?v=20260722-1',
  'assets/css/checklist-photo-viewer-fit.css?v=20260722-1',
  'assets/js/checklist-photo-core.js?v=20260722-1',
  'assets/js/checklist-photo-reports.js?v=20260722-1',
]) {
  assert.ok(loader.includes(marker), `Missing checklist photo loader marker: ${marker}`);
}

assert.match(viewerFit, /@media \(min-width:641px\)/, 'Desktop viewer fix must not change the working mobile layout');
assert.match(viewerFit, /max-height:calc\(100dvh - 56px\)/, 'Viewer image must be bounded by the visible desktop height');
assert.match(viewerFit, /width:auto;[\s\S]*height:auto;/, 'Portrait photos must keep their aspect ratio');
assert.match(viewerFit, /object-fit:contain/, 'Desktop photos must fit without cropping');

for (const marker of [
  'checklist_photo_rules',
  'checklist_submission_photos',
  'finalize_checklist_photo_submission',
  'replace_checklist_photo_rules',
  'set_checklist_photo_retained',
  "'checklist-photo-reports'",
  "interval '90 days'",
  'storage.foldername(name)',
]) {
  assert.ok(migration.includes(marker), `Missing checklist photo migration marker: ${marker}`);
}
assert.ok(retention.includes('retention_90_days'));
assert.ok(retention.includes('CHECKLIST_PHOTO_RETENTION_SECRET'));
assert.ok(retention.includes('.remove(objectPaths)'));

console.log('Checklist photo report core checks passed.');
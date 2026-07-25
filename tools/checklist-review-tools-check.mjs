import fs from 'node:fs';
import assert from 'node:assert/strict';

const js = fs.readFileSync('assets/js/checklist-review-tools.js', 'utf8');
const css = fs.readFileSync('assets/css/checklist-review-tools.css', 'utf8');
const observerGuard = fs.readFileSync('assets/js/checklist-review-observer-guard.js', 'utf8');
const stability = fs.readFileSync('assets/js/control-section-stability-v2.js', 'utf8');
const draftKeyBridge = fs.readFileSync('assets/js/control-section-draft-key-bridge.js', 'utf8');
const photoDraftFix = fs.readFileSync('assets/js/checklist-photo-draft-fix.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260724210000_checklist_review_tools_preview.sql', 'utf8');
const loader = fs.readFileSync('assets/js/push.js', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');

for (const marker of [
  'data-checklist-review-viewer','data-viewer-previous','data-viewer-next','data-viewer-zoom-in','data-viewer-zoom-out',
  "event.key === 'ArrowLeft'","event.key === 'ArrowRight'",'pointerDistance()','data-checklist-comment-form',
  "rpc('create_checklist_submission_comment'","rpc('delete_checklist_submission'",'data-checklist-department="barista"','data-checklist-department="waiter"'
]) assert.ok(js.includes(marker), `Missing JS marker: ${marker}`);

for (const marker of ['.checklist-review-viewer-stage{','touch-action:none','object-fit:contain!important','height:100dvh','.checklist-review-filter{','.checklist-review-form{','.checklist-review-delete{']) assert.ok(css.includes(marker), `Missing CSS marker: ${marker}`);

for (const marker of ['create table if not exists public.checklist_submission_comments','create or replace function public.create_checklist_submission_comment','insert into public.tasks','create or replace function public.delete_checklist_submission','public.is_admin_or_manager()','public.is_admin()','deleted_at timestamptz']) assert.ok(migration.includes(marker), `Missing migration marker: ${marker}`);

assert.ok(observerGuard.includes("closest?.('#control-records')"), 'Observer guard must ignore internal Control review mutations');
assert.ok(stability.includes("const VERSION = '2026-07-25-control-section-stability-2'"), 'Unified Control stability coordinator v2 is missing');
assert.ok(stability.includes("document.addEventListener('pointerdown'"), 'Touch must lock Control before asynchronous refresh');
assert.ok(stability.includes('pendingRefresh = { context:this, args }'), 'Refresh requested during touch must be deferred');
assert.ok(stability.includes('signature() === lastSignature'), 'Redundant comment/photo refreshes must be skipped');
assert.ok(stability.includes('captureOpen()') && stability.includes('restoreOpen()'), 'Native details state preservation is missing');
assert.ok(stability.includes('captureAnchor()') && stability.includes('restoreAnchor(anchor)'), 'Unified Control viewport preservation is missing');
assert.ok(stability.includes('rememberComment') && stability.includes('restoreComments'), 'Comment draft preservation is missing');
assert.ok(stability.includes('rememberPhotoRules') && stability.includes('restorePhotoRules'), 'Photo rule draft preservation is missing');
assert.ok(stability.includes('if(!force && !checklistDrafts.has(id) && !meaningful) return;'), 'Offline-restored checklist drafts must not be overwritten by blank initial state');
assert.ok(draftKeyBridge.includes('drafts.set = function') && draftKeyBridge.includes('input?.dataset?.task') && draftKeyBridge.includes('input?.dataset?.photoItemKey'), 'Offline draft keys must work before and after photo enhancement');
assert.ok(!stability.includes('event.preventDefault()'), 'Unified coordinator must not manually override native details clicks');
assert.ok(photoDraftFix.includes('sovremennik-checklist-photo-drafts-v1'), 'Persistent photo draft storage is missing');
assert.ok(photoDraftFix.includes('new DataTransfer()'), 'Photo draft restoration is missing');
assert.ok(loader.includes('assets/css/checklist-review-tools.css'), 'Review CSS is not loaded');
assert.ok(loader.includes('assets/js/checklist-review-observer-guard.js'), 'Control observer guard is not loaded');
assert.ok(loader.indexOf('assets/js/checklist-review-observer-guard.js') < loader.indexOf('assets/js/checklist-review-tools.js'), 'Observer guard must load directly before review tools');
assert.ok(loader.includes('assets/js/checklist-review-tools.js?v=20260725-2'), 'Current review JS is not loaded');
assert.ok(loader.includes('assets/js/checklist-photo-draft-fix.js?v=20260725-2'), 'Current photo draft fix is not loaded');
assert.ok(loader.includes('assets/js/control-section-stability-v2.js?v=20260725-2'), 'Unified Control stability coordinator v2 is not loaded');
assert.ok(loader.includes('assets/js/control-section-draft-key-bridge.js?v=20260725-1'), 'Offline Control draft key bridge is not loaded');
assert.ok(!loader.includes('checklist-ui-state-fix.js') && !loader.includes('control-revision-scroll-fix.js') && !loader.includes('checklist-photo-rules-open-fix.js') && !loader.includes('control-section-stability.js?v='), 'Legacy competing Control modules are still loaded');
assert.ok(worker.includes('sovremennik-offline-20260725-v17'), 'Current PWA cache is not active');
assert.ok(worker.includes('./assets/css/checklist-review-tools.css'), 'Review CSS is not cached');
assert.ok(worker.includes('./assets/js/checklist-review-observer-guard.js'), 'Control observer guard is not cached');
assert.ok(worker.includes('./assets/js/checklist-review-tools.js'), 'Review JS is not cached');
assert.ok(worker.includes('./assets/js/checklist-photo-draft-fix.js'), 'Photo draft fix is not cached');
assert.ok(worker.includes('./assets/js/control-section-stability-v2.js'), 'Unified Control coordinator v2 is not cached');
assert.ok(worker.includes('./assets/js/control-section-draft-key-bridge.js'), 'Offline draft key bridge is not cached');

console.log('Checklist review tools structure is valid.');

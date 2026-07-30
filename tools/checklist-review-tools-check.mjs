import fs from 'node:fs';
import assert from 'node:assert/strict';

const js = fs.readFileSync('assets/js/checklist-review-tools.js', 'utf8');
const css = fs.readFileSync('assets/css/checklist-review-tools.css', 'utf8');
const controlCss = fs.readFileSync('assets/css/control-v3.css', 'utf8');
const observerGuard = fs.readFileSync('assets/js/checklist-review-observer-guard.js', 'utf8');
const controlCore = fs.readFileSync('assets/js/control-v3-core.js', 'utf8');
const control = fs.readFileSync('assets/js/control-v3.js', 'utf8');
const regressionFix = fs.readFileSync('assets/js/control-v3-regression-fix.js', 'utf8');
const photoDraftFix = fs.readFileSync('assets/js/checklist-photo-draft-fix.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260724210000_checklist_review_tools_preview.sql', 'utf8');
const loader = fs.readFileSync('assets/js/push.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');

for (const marker of [
  'data-checklist-review-viewer','data-viewer-previous','data-viewer-next','data-viewer-zoom-in','data-viewer-zoom-out',
  "event.key === 'ArrowLeft'","event.key === 'ArrowRight'",'pointerDistance()','data-checklist-comment-form',
  "rpc('create_checklist_submission_comment'","rpc('delete_checklist_submission'",'data-checklist-department="barista"','data-checklist-department="waiter"'
]) assert.ok(js.includes(marker), `Missing JS marker: ${marker}`);

for (const marker of ['.checklist-review-viewer-stage{','touch-action:none','object-fit:contain!important','height:100dvh','.checklist-review-filter{','.checklist-review-form{','.checklist-review-delete{']) assert.ok(css.includes(marker), `Missing CSS marker: ${marker}`);
for (const marker of ['.control-v3-stage{','overflow-anchor:none','contain:layout style','.control-v3-toolbar{']) assert.ok(controlCss.includes(marker), `Missing Control v3 CSS marker: ${marker}`);

for (const marker of ['create table if not exists public.checklist_submission_comments','create or replace function public.create_checklist_submission_comment','insert into public.tasks','create or replace function public.delete_checklist_submission','public.is_admin_or_manager()','public.is_admin()','deleted_at timestamptz']) assert.ok(migration.includes(marker), `Missing migration marker: ${marker}`);

assert.ok(observerGuard.includes("closest?.('#control-records')"), 'Observer guard must ignore internal Control review mutations');
assert.ok(controlCore.includes("const VERSION = '2026-07-30-control-v3-core-1'"), 'Control v3 core is missing');
assert.ok(controlCore.includes('tabSignature') && controlCore.includes('captureOpen') && controlCore.includes('restoreOpen'), 'Control v3 pure state helpers are incomplete');
assert.ok(control.includes("const VERSION = '2026-07-30-control-v3-1'"), 'Control v3 renderer is missing');
assert.ok(control.includes('function renderControlV3()') && control.includes('function refreshActive(') && control.includes('function setControlTabV3('), 'Control v3 lifecycle is incomplete');
assert.ok(control.includes('signatures.get(current) === nextSignature'), 'Unchanged Control data must not replace the DOM');
assert.ok(control.includes('oldFolder.replaceChildren()'), 'Inactive heavy Control folders must be removed');
assert.ok(control.includes('Core.captureOpen(target)') && control.includes('Core.restoreOpen(target, open)'), 'Expanded records must survive changed-data refreshes');
assert.ok(!control.includes('scrollTo(') && !control.includes('scrollBy(') && !control.includes('scrollIntoView('), 'Control v3 must not own page scrolling');
assert.ok(regressionFix.includes("const VERSION = '2026-07-30-control-v3-regression-fix-1'"), 'Control v3 regression guard is missing');
assert.ok(regressionFix.includes('function safeRevisionRenderer()') && regressionFix.includes('REVISION_TIMEOUT'), 'Revision loading fallback is incomplete');
assert.ok(regressionFix.includes("[data-checklist-department]") && regressionFix.includes('.checklist-submission-details > summary'), 'Waiter filter and deterministic report toggle are missing');
assert.ok(regressionFix.includes('RECEIPTS_KEY') && regressionFix.includes('pendingEquivalent') && regressionFix.includes('purgeDrafts'), 'One-shot checklist submission protection is incomplete');
assert.ok(photoDraftFix.includes('sovremennik-checklist-photo-drafts-v1'), 'Persistent photo draft storage is missing');
assert.ok(photoDraftFix.includes('new DataTransfer()'), 'Photo draft restoration is missing');

assert.ok(loader.includes('assets/css/checklist-review-tools.css'), 'Review CSS is not loaded');
assert.ok(loader.includes('assets/css/control-v3.css?v=20260730-1'), 'Control v3 CSS is not loaded');
assert.ok(loader.includes('assets/js/checklist-review-observer-guard.js'), 'Control observer guard is not loaded');
assert.ok(loader.indexOf('assets/js/checklist-review-observer-guard.js') < loader.indexOf('assets/js/checklist-review-tools.js'), 'Observer guard must load directly before review tools');
assert.ok(loader.includes("'assets/js/control-v3-core.js?v=20260730-1'"), 'Control v3 core is not configured');
assert.ok(loader.includes("'assets/js/control-v3.js?v=20260730-1'"), 'Control v3 renderer is not configured');
assert.ok(loader.includes("'assets/js/control-v3-regression-fix.js?v=20260730-1'"), 'Control v3 regression guard is not configured');
assert.ok(loader.indexOf('control-v3.js?v=20260730-1') < loader.indexOf('control-v3-regression-fix.js?v=20260730-1'), 'Regression guard must load after Control v3');
assert.ok(loader.includes("window.addEventListener('load', load, { once:true })"), 'Control v3 must load after parser feature modules');
assert.ok(loader.includes('window.SovremennikControlV3Load'), 'Control v3 load diagnostics are missing');
assert.ok(!loader.includes('control-section-stability-v2.js?v=') && !loader.includes('control-section-draft-key-bridge.js?v=') && !loader.includes('control-viewport-jitter-fix.js?v='), 'Legacy Control coordinators are still loaded');
assert.ok(index.indexOf('assets/js/push.js') < index.indexOf('assets/js/attestations-preview.js'), 'Regression precondition changed: push loader is expected before attestations');
assert.ok(worker.includes("const CACHE_VERSION = 'sovremennik-offline-20260730-v29'"), 'Control v3 regression PWA cache is not active');
assert.ok(worker.includes('./assets/css/control-v3.css'), 'Control v3 CSS is not cached');
assert.ok(worker.includes('./assets/js/control-v3-core.js') && worker.includes('./assets/js/control-v3.js'), 'Control v3 scripts are not cached');
assert.ok(worker.includes('./assets/js/control-v3-regression-fix.js'), 'Control v3 regression guard is not cached');
assert.ok(!worker.includes('./assets/js/control-section-stability-v2.js') && !worker.includes('./assets/js/control-viewport-jitter-fix.js'), 'Unused legacy Control coordinators remain in the app shell');

console.log('Checklist review tools, Control v3 and regression guard structure are valid.');
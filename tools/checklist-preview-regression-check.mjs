import assert from 'node:assert/strict';
import fs from 'node:fs';

const push = fs.readFileSync('assets/js/push.js', 'utf8');
const serviceWorker = fs.readFileSync('service-worker.js', 'utf8');
const reviewCss = fs.readFileSync('assets/css/checklist-review-tools.css', 'utf8');
const controlCss = fs.readFileSync('assets/css/control-v3.css', 'utf8');
const controlCore = fs.readFileSync('assets/js/control-v3-core.js', 'utf8');
const control = fs.readFileSync('assets/js/control-v3.js', 'utf8');
const reviewTools = fs.readFileSync('assets/js/checklist-review-tools.js', 'utf8');
const photoReports = fs.readFileSync('assets/js/checklist-photo-reports.js', 'utf8');
const photoDraftFix = fs.readFileSync('assets/js/checklist-photo-draft-fix.js', 'utf8');

const required = [
  [push.includes('checklist-review-observer-guard.js?v=20260724-1'), 'Control observer guard must load directly before review tools'],
  [push.indexOf('checklist-review-observer-guard.js') < push.indexOf('checklist-review-tools.js'), 'Control observer guard must precede review tools'],
  [push.includes('checklist-review-tools.js?v=20260725-2'), 'current checklist review tools must be loaded'],
  [push.includes('checklist-photo-draft-fix.js?v=20260725-2'), 'photo draft fix must be loaded'],
  [push.includes('control-v3.css?v=20260730-1'), 'Control v3 CSS must be loaded'],
  [push.includes("'assets/js/control-v3-core.js?v=20260730-1'"), 'Control v3 core must be configured'],
  [push.includes("'assets/js/control-v3.js?v=20260730-1'"), 'Control v3 renderer must be configured'],
  [push.indexOf('control-v3-core.js') < push.indexOf('control-v3.js'), 'Control v3 core must load before the renderer'],
  [push.includes("window.addEventListener('load', load, { once:true })"), 'Control v3 must become the final renderer after parser-loaded feature modules'],
  [!push.includes('control-section-stability-v2.js?v=') && !push.includes('control-section-draft-key-bridge.js?v=') && !push.includes('control-viewport-jitter-fix.js?v='), 'old Control state/scroll modules must be disconnected'],
  [serviceWorker.includes('sovremennik-offline-20260730-v28'), 'PWA cache must be refreshed for Control v3'],
  [serviceWorker.includes('control-v3-core.js') && serviceWorker.includes('control-v3.js') && serviceWorker.includes('control-v3.css'), 'Control v3 assets must be precached'],
  [reviewCss.includes('height:100dvh') && reviewCss.includes('object-fit:contain!important'), 'desktop viewer must fit the complete photo inside the viewport'],
  [controlCss.includes('overflow-anchor:none') && controlCss.includes('contain:layout style'), 'Control v3 must isolate browser scroll anchoring and layout'],
  [controlCore.includes('tabSignature') && controlCore.includes('detailsKey'), 'Control v3 core must provide deterministic state keys'],
  [control.includes('signatures.get(current) === nextSignature'), 'unchanged review/photo refreshes must not replace the DOM'],
  [control.includes('target.innerHTML = standardBody(current)'), 'changed data must update only the active Control folder'],
  [control.includes('oldFolder.replaceChildren()'), 'inactive Control folders must not keep heavy hidden DOM'],
  [control.includes('Core.captureOpen(target)') && control.includes('Core.restoreOpen(target, open)'), 'expanded Control records must survive a real data update'],
  [!control.includes('scrollTo(') && !control.includes('scrollBy(') && !control.includes('scrollIntoView('), 'Control v3 must never move the page programmatically'],
  [reviewTools.includes("if(typeof refreshControl === 'function') refreshControl();"), 'review metadata must continue to request the public Control refresh'],
  [photoReports.includes('state.controlLoading = true') && photoReports.includes("if(typeof refreshControl === 'function') refreshControl();"), 'photo report data must continue through the public Control refresh'],
  [photoDraftFix.includes("DB_NAME = 'sovremennik-checklist-photo-drafts-v1'"), 'photo drafts must use persistent IndexedDB storage'],
  [photoDraftFix.includes('new DataTransfer()') && photoDraftFix.includes("input.dispatchEvent(new Event('change'"), 'stored photos must be restored into the checklist photo module'],
];

const failures = required.filter(([ok]) => !ok).map(([, message]) => message);
if(failures.length){
  console.error('Checklist preview regression checks failed:');
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log('Checklist preview and Control v3 regression checks passed.');

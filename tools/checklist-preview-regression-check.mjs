import assert from 'node:assert/strict';
import fs from 'node:fs';

const push = fs.readFileSync('assets/js/push.js', 'utf8');
const serviceWorker = fs.readFileSync('service-worker.js', 'utf8');
const css = fs.readFileSync('assets/css/checklist-review-tools.css', 'utf8');
const stability = fs.readFileSync('assets/js/control-section-stability-v2.js', 'utf8');
const reviewTools = fs.readFileSync('assets/js/checklist-review-tools.js', 'utf8');
const photoReports = fs.readFileSync('assets/js/checklist-photo-reports.js', 'utf8');
const photoDraftFix = fs.readFileSync('assets/js/checklist-photo-draft-fix.js', 'utf8');

const required = [
  [push.includes('checklist-review-observer-guard.js?v=20260724-1'), 'Control observer guard must load directly before review tools'],
  [push.indexOf('checklist-review-observer-guard.js') < push.indexOf('checklist-review-tools.js'), 'Control observer guard must precede review tools'],
  [push.includes('checklist-review-tools.js?v=20260725-2'), 'current checklist review tools must be loaded'],
  [push.includes('checklist-photo-draft-fix.js?v=20260725-2'), 'photo draft fix must be loaded'],
  [push.includes('control-section-stability-v2.js?v=20260725-2'), 'unified Control stability coordinator v2 must be loaded'],
  [push.indexOf('checklist-review-tools.js') < push.indexOf('control-section-stability-v2.js'), 'Control coordinator must wrap the final review refresh chain'],
  [!push.includes('checklist-ui-state-fix.js') && !push.includes('control-revision-scroll-fix.js') && !push.includes('checklist-photo-rules-open-fix.js') && !push.includes('control-section-stability.js?v='), 'competing legacy state and scroll scripts must not be loaded'],
  [serviceWorker.includes("sovremennik-offline-20260725-v16"), 'PWA cache must be refreshed'],
  [serviceWorker.includes('control-section-stability-v2.js'), 'unified Control coordinator v2 must be precached'],
  [!serviceWorker.includes("'./assets/js/checklist-ui-state-fix.js'") && !serviceWorker.includes("'./assets/js/control-revision-scroll-fix.js'") && !serviceWorker.includes("'./assets/js/checklist-photo-rules-open-fix.js'") && !serviceWorker.includes("'./assets/js/control-section-stability.js'"), 'legacy competing scripts must not be in the active app shell'],
  [css.includes('height:100dvh') && css.includes('object-fit:contain!important'), 'desktop viewer must fit the complete photo inside the viewport'],
  [css.includes('grid-template-rows:minmax(48px,auto) minmax(0,1fr) 48px'), 'viewer must reserve bounded rows for header, photo and toolbar'],
  [stability.includes("document.addEventListener('pointerdown'"), 'touch interaction must lock Control before background renders'],
  [stability.includes('pendingRefresh = { context:this, args }') && stability.includes('interacting()'), 'refreshes must be deferred while a summary is being touched'],
  [stability.includes('signature() === lastSignature'), 'unchanged review/photo refreshes must be coalesced'],
  [stability.includes('controlLoading:controls.length ? false'), 'loading flags must not replace already visible checklist records'],
  [stability.includes('captureOpen()') && stability.includes('restoreOpen()'), 'all Control details must keep native open state across real renders'],
  [stability.includes('captureAnchor()') && stability.includes('restoreAnchor(anchor)'), 'one unified viewport anchor must preserve scroll'],
  [stability.includes('global.scrollBy(0, delta)'), 'viewport anchor correction must be available'],
  [stability.includes('rememberComment') && stability.includes('rememberPhotoRules'), 'comment and photo-rule drafts must survive a changed-data render'],
  [stability.includes('if(!force && !checklistDrafts.has(id) && !meaningful) return;'), 'empty initial form state must not overwrite restored offline drafts'],
  [!stability.includes('event.preventDefault()'), 'native details clicks must not be manually double-toggled'],
  [reviewTools.includes("if(typeof refreshControl === 'function') refreshControl();"), 'review metadata still requests refresh and must be handled by the coordinator'],
  [photoReports.includes('state.controlLoading = true') && photoReports.includes("if(typeof refreshControl === 'function') refreshControl();"), 'photo report redraw sequence must be covered by the coordinator'],
  [photoDraftFix.includes("DB_NAME = 'sovremennik-checklist-photo-drafts-v1'"), 'photo drafts must use persistent IndexedDB storage'],
  [photoDraftFix.includes('new DataTransfer()') && photoDraftFix.includes("input.dispatchEvent(new Event('change'"), 'stored photos must be restored into the checklist photo module'],
];

const failures = required.filter(([ok]) => !ok).map(([, message]) => message);
if(failures.length){
  console.error('Checklist preview regression checks failed:');
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log('Checklist preview regression checks passed.');

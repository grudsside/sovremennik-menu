import assert from 'node:assert/strict';
import fs from 'node:fs';

const push = fs.readFileSync('assets/js/push.js', 'utf8');
const serviceWorker = fs.readFileSync('service-worker.js', 'utf8');
const css = fs.readFileSync('assets/css/checklist-review-tools.css', 'utf8');
const stateFix = fs.readFileSync('assets/js/checklist-ui-state-fix.js', 'utf8');
const revisionScrollFix = fs.readFileSync('assets/js/control-revision-scroll-fix.js', 'utf8');
const photoDraftFix = fs.readFileSync('assets/js/checklist-photo-draft-fix.js', 'utf8');
const photoRulesOpenFix = fs.readFileSync('assets/js/checklist-photo-rules-open-fix.js', 'utf8');

const required = [
  [push.includes('checklist-review-observer-guard.js?v=20260724-1'), 'Control observer guard must load directly before review tools'],
  [push.indexOf('checklist-review-observer-guard.js') < push.indexOf('checklist-review-tools.js'), 'Control observer guard must precede review tools'],
  [push.includes('checklist-review-tools.js?v=20260725-2'), 'current checklist review tools must be loaded'],
  [push.includes('checklist-photo-draft-fix.js?v=20260725-2'), 'photo draft fix must be loaded'],
  [push.includes('checklist-ui-state-fix.js?v=20260725-4'), 'Control checklist state and viewport fix must be loaded'],
  [push.includes('control-revision-scroll-fix.js?v=20260725-1'), 'Control revision and scroll fix must be loaded'],
  [push.indexOf('checklist-ui-state-fix.js') < push.indexOf('control-revision-scroll-fix.js'), 'revision fix must follow the base checklist state fix'],
  [push.includes('checklist-photo-rules-open-fix.js?v=20260725-2'), 'photo rules open-state fix v2 must be loaded last'],
  [serviceWorker.includes("sovremennik-offline-20260725-v14"), 'PWA cache must be refreshed'],
  [serviceWorker.includes('control-revision-scroll-fix.js'), 'revision and scroll fix must be precached'],
  [serviceWorker.includes('checklist-review-observer-guard.js') && serviceWorker.includes('checklist-photo-draft-fix.js') && serviceWorker.includes('checklist-ui-state-fix.js') && serviceWorker.includes('checklist-photo-rules-open-fix.js'), 'review and regression scripts must be precached'],
  [css.includes('height:100dvh') && css.includes('object-fit:contain!important'), 'desktop viewer must fit the complete photo inside the viewport'],
  [css.includes('grid-template-rows:minmax(48px,auto) minmax(0,1fr) 48px'), 'viewer must reserve bounded rows for header, photo and toolbar'],
  [stateFix.includes("wrapRender('renderApp')") && stateFix.includes("wrapRender('refreshControl')"), 'background renders must preserve checklist state'],
  [stateFix.includes("document.addEventListener('toggle'") && stateFix.includes('openState.set'), 'opened details must be tracked'],
  [stateFix.includes("target?.closest?.('#control-records details > summary')") && stateFix.includes('genericControlKey(details)'), 'submitted checklist summaries must use the stable delegated toggle path'],
  [stateFix.includes('captureViewportAnchor()') && stateFix.includes('restoreViewport(viewportAnchor)'), 'checklist history redraws must preserve the visible viewport anchor'],
  [revisionScrollFix.includes("event.target.closest?.('#top-control details > summary')"), 'revisions outside #control-records must use the delegated first-click path'],
  [revisionScrollFix.includes("!details.closest('#control-records')") && revisionScrollFix.includes('revisionKey(details)'), 'revision state must be tracked separately from checklist history'],
  [revisionScrollFix.includes('captureAnchor()') && revisionScrollFix.includes('restoreAnchor(anchor)'), 'full Control redraws must preserve the active folder viewport'],
  [revisionScrollFix.includes('global.scrollBy(0, delta)') && revisionScrollFix.includes('event.preventDefault();'), 'revision click and scroll correction must be synchronous'],
  [stateFix.includes('observer?.takeRecords();') && revisionScrollFix.includes('observer?.takeRecords();'), 'queued mutation records must be cleared before controlled redraws'],
  [stateFix.includes('if(!event.target.isConnected || !document.documentElement.contains(event.target)) return;'), 'detached toggle events must not overwrite Control state'],
  [photoDraftFix.includes("DB_NAME = 'sovremennik-checklist-photo-drafts-v1'"), 'photo drafts must use persistent IndexedDB storage'],
  [photoDraftFix.includes("document.addEventListener('change'") && photoDraftFix.includes('saveSelectedFiles'), 'selected files must be saved immediately'],
  [photoDraftFix.includes('scheduleRestore(0);'), 'photo draft must schedule restoration immediately after persistence'],
  [photoDraftFix.includes('new DataTransfer()') && photoDraftFix.includes("input.dispatchEvent(new Event('change'"), 'stored photos must be restored into the checklist photo module'],
  [photoRulesOpenFix.includes("const SELECTOR = '[data-photo-rules-card],.checklist-photo-rules-card'"), 'photo rules panel selector must be explicit'],
  [photoRulesOpenFix.includes("document.addEventListener('toggle'") && photoRulesOpenFix.includes('desiredOpen = Boolean(details.open)'), 'manual photo rules panel state must be remembered'],
  [photoRulesOpenFix.includes('if(!details.isConnected || card() !== details) return;'), 'detached photo rules toggle events must not overwrite the remembered state'],
  [photoRulesOpenFix.includes("target?.matches?.('#checklist-photo-rules-admin')") && photoRulesOpenFix.includes('restore();') && photoRulesOpenFix.includes('queueRestore();'), 'photo rules container replacements must restore state immediately and after paint'],
];

const failures = required.filter(([ok]) => !ok).map(([, message]) => message);
if(failures.length){
  console.error('Checklist preview regression checks failed:');
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log('Checklist preview regression checks passed.');
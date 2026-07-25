import assert from 'node:assert/strict';
import fs from 'node:fs';

const push = fs.readFileSync('assets/js/push.js', 'utf8');
const serviceWorker = fs.readFileSync('service-worker.js', 'utf8');
const css = fs.readFileSync('assets/css/checklist-review-tools.css', 'utf8');
const stateFix = fs.readFileSync('assets/js/checklist-ui-state-fix.js', 'utf8');
const photoDraftFix = fs.readFileSync('assets/js/checklist-photo-draft-fix.js', 'utf8');

const required = [
  [push.includes('checklist-photo-draft-fix.js?v=20260725-1'), 'photo draft fix must be loaded'],
  [push.includes('checklist-ui-state-fix.js?v=20260725-1'), 'UI state fix must be loaded last'],
  [!push.includes('checklist-review-observer-guard.js'), 'global MutationObserver monkeypatch must not be loaded'],
  [serviceWorker.includes("sovremennik-offline-20260725-v9"), 'PWA cache must be refreshed'],
  [serviceWorker.includes('checklist-photo-draft-fix.js') && serviceWorker.includes('checklist-ui-state-fix.js'), 'new scripts must be precached'],
  [css.includes('height:100dvh') && css.includes('object-fit:contain!important'), 'desktop viewer must fit the complete photo inside the viewport'],
  [css.includes('grid-template-rows:minmax(48px,auto) minmax(0,1fr) 48px'), 'viewer must reserve bounded rows for header, photo and toolbar'],
  [stateFix.includes("wrapRender('renderApp')") && stateFix.includes("wrapRender('refreshControl')"), 'background renders must preserve checklist state'],
  [stateFix.includes("document.addEventListener('toggle'") && stateFix.includes('openState.set'), 'opened details must be tracked'],
  [photoDraftFix.includes("DB_NAME = 'sovremennik-checklist-photo-drafts-v1'"), 'photo drafts must use persistent IndexedDB storage'],
  [photoDraftFix.includes("document.addEventListener('change'") && photoDraftFix.includes('saveSelectedFiles'), 'selected files must be saved immediately'],
  [photoDraftFix.includes('new DataTransfer()') && photoDraftFix.includes("input.dispatchEvent(new Event('change'"), 'stored photos must be restored into the checklist photo module'],
];

const failures = required.filter(([ok]) => !ok).map(([, message]) => message);
if(failures.length){
  console.error('Checklist preview regression checks failed:');
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log('Checklist preview regression checks passed.');

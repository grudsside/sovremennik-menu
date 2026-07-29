import { chromium } from 'playwright';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const browser = await chromium.launch({ headless:true });
const page = await browser.newPage({ viewport:{ width:1440, height:900 } });

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font-family:Arial}.top-panel{display:block}.spacer{height:520px}.submission-body{height:2600px;background:linear-gradient(#fafaf6,#efefe7)}summary{height:70px;display:flex;align-items:center;background:#f5f5ee}.marker{margin-top:850px}.late-block{height:1px}
</style></head><body><div id="app"><section id="top-control" class="top-panel active"><div id="control-checklists" class="control-folder active"><div class="spacer"></div><details class="control-day-group" open><summary><strong>29 июля 2026</strong></summary><details class="checklist-submission-details" data-checklist-submission="submission-1" open><summary><strong>Чек-лист открытия</strong></summary><div class="submission-body"><p class="marker">Точка чтения</p><div id="late-block" class="late-block"></div></div></details></details></div></section></div></body></html>`;
await page.route('http://preview.local/**', route => route.fulfill({ status:200, contentType:'text/html; charset=utf-8', body:html }));
await page.goto('http://preview.local/');

await page.evaluate(() => {
  window.state = {
    activeControl:'checklists',
    controlRecords:[{ id:'submission-1', checklistId:'opening', checklistTitle:'Открытие', employeeName:'Анна', createdAt:'2026-07-29T10:00:00Z', completed:1, total:1, percent:100, photoCount:2, tasks:[], photos:[] }],
    revisionRecords:[], errorReports:[], controlLoading:false, revisionLoading:false,
    checklistPhotoVisibleDays:14, checklistPhotoControlHasMore:false, checklistPhotoControlCursor:''
  };
  window.refreshControl = () => undefined;
  window.renderApp = () => undefined;
});

await page.addScriptTag({ path:path.join(root, 'assets/js/control-section-stability-v2.js') });
await page.addScriptTag({ path:path.join(root, 'assets/js/control-viewport-jitter-fix.js') });

await page.evaluate(() => {
  window.dispatchEvent(new WheelEvent('wheel', { deltaY:1000, bubbles:true }));
  window.scrollTo(0, 1450);
});
await page.waitForTimeout(120);

const before = await page.evaluate(() => ({
  scrollY:window.scrollY,
  markerTop:document.querySelector('.marker').getBoundingClientRect().top
}));
assert(before.scrollY > 1000, 'Desktop Control must be scrolled deep into the expanded checklist');

await page.evaluate(() => {
  const late = document.querySelector('#late-block');
  setTimeout(() => window.scrollBy(0, -260), 700);
  setTimeout(() => { late.innerHTML = '<span>late render 1</span>'; window.scrollBy(0, -180); }, 900);
  setTimeout(() => { late.innerHTML = '<span>late render 2</span>'; window.scrollBy(0, -120); }, 1100);
});
await page.waitForTimeout(1450);

const after = await page.evaluate(() => ({
  scrollY:window.scrollY,
  markerTop:document.querySelector('.marker').getBoundingClientRect().top,
  version:window.SovremennikControlViewportJitterFix?.VERSION
}));
assert.equal(after.version, '2026-07-30-control-viewport-jitter-1', 'Viewport jitter guard must load');
assert(Math.abs(after.scrollY - before.scrollY) <= 3, `Control viewport jumped vertically: ${before.scrollY} -> ${after.scrollY}`);
assert(Math.abs(after.markerTop - before.markerTop) <= 3, `Visible checklist content moved: ${before.markerTop} -> ${after.markerTop}`);

await page.evaluate(() => {
  window.dispatchEvent(new WheelEvent('wheel', { deltaY:300, bubbles:true }));
  window.scrollTo(0, 1700);
});
await page.waitForTimeout(80);
const movedByUser = await page.evaluate(() => window.scrollY);
assert(movedByUser > before.scrollY, 'The guard must not block deliberate user scrolling');

await browser.close();
console.log('Desktop Control viewport jitter smoke passed.');

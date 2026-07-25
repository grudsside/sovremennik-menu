import { chromium } from 'playwright';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const browser = await chromium.launch({ headless:true });
const page = await browser.newPage({ viewport:{ width:1280, height:720 } });

const controlMarkup = () => `
<section id="control-records">
  <div style="height:760px" data-top-spacer></div>
  <details class="control-day-group" open>
    <summary><strong>25 июля 2026</strong></summary>
    <div>
      <details class="checklist-submission-details" data-checklist-submission="submission-1">
        <summary><strong>Открытие смены</strong></summary>
        <div style="height:900px" data-checklist-body><p style="padding-top:360px" data-scroll-marker>Середина выполненного чек-листа</p></div>
      </details>
      <details class="revision-result-details" data-revision-id="revision-2026-07-25">
        <summary><strong>Ревизия кофе 25.07.2026</strong></summary>
        <div style="height:420px">Данные ревизии</div>
      </details>
    </div>
  </details>
</section>`;

const pageHtml = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}summary{min-height:48px;display:flex;align-items:center;cursor:pointer}</style></head><body><div id="app">${controlMarkup()}</div></body></html>`;
await page.route('http://preview.local/**', route => route.fulfill({ status:200, contentType:'text/html; charset=utf-8', body:pageHtml }));
await page.goto('http://preview.local/');

await page.evaluate(markup => {
  window.__controlMarkup = markup;
  window.renderApp = () => { document.querySelector('#app').innerHTML = window.__controlMarkup; };
  window.refreshControl = () => {
    const current = document.querySelector('#control-records');
    current.outerHTML = window.__controlMarkup;
  };
}, controlMarkup());

await page.addScriptTag({ path:path.join(root, 'assets/js/checklist-ui-state-fix.js') });

// First click on a revision must win even when the same click starts a full Control redraw.
await page.evaluate(() => {
  document.addEventListener('click', event => {
    if(event.target.closest('[data-revision-id] > summary')) window.refreshControl();
  }, { once:true });
});
await page.locator('[data-revision-id] > summary').click();
await page.waitForFunction(() => document.querySelector('[data-revision-id]')?.open === true);
assert.equal(await page.locator('[data-revision-id]').evaluate(node => node.open), true, 'Revision must open on the first click');

// Closing and reopening must also work on the first attempt.
await page.locator('[data-revision-id] > summary').click();
await page.waitForFunction(() => document.querySelector('[data-revision-id]')?.open === false);
await page.locator('[data-revision-id] > summary').click();
await page.waitForFunction(() => document.querySelector('[data-revision-id]')?.open === true);

// Keep an expanded checklist and the same visible content while Control is redrawn repeatedly.
await page.locator('[data-checklist-submission] > summary').click();
await page.waitForFunction(() => document.querySelector('[data-checklist-submission]')?.open === true);
await page.locator('[data-scroll-marker]').scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, 120));

const before = await page.evaluate(() => ({
  scrollY:window.scrollY,
  markerTop:document.querySelector('[data-scroll-marker]').getBoundingClientRect().top
}));

for(let index = 0; index < 5; index += 1){
  await page.evaluate(() => window.refreshControl());
  await page.waitForFunction(() => document.querySelector('[data-checklist-submission]')?.open === true);
}

const after = await page.evaluate(() => ({
  scrollY:window.scrollY,
  markerTop:document.querySelector('[data-scroll-marker]').getBoundingClientRect().top,
  checklistOpen:document.querySelector('[data-checklist-submission]')?.open,
  revisionOpen:document.querySelector('[data-revision-id]')?.open
}));

assert.equal(after.checklistOpen, true, 'Expanded checklist must stay open after background redraws');
assert.equal(after.revisionOpen, true, 'Expanded revision must stay open after background redraws');
assert(Math.abs(after.scrollY - before.scrollY) <= 3, `Scroll position changed: ${before.scrollY} -> ${after.scrollY}`);
assert(Math.abs(after.markerTop - before.markerTop) <= 3, `Visible checklist content moved: ${before.markerTop} -> ${after.markerTop}`);

await browser.close();
console.log('Control revision toggle and scroll stability browser smoke passed.');

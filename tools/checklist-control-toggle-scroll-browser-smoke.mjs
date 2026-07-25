import { chromium } from 'playwright';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const browser = await chromium.launch({ headless:true });
const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });

const pageHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font-family:Arial}.control-folder:not(.active){display:none}summary{min-height:52px;display:flex;align-items:center;cursor:pointer;background:#f4f4ef;border-bottom:1px solid #ddd}.spacer{height:680px}.submission-body{height:1100px}.marker{padding-top:420px}.checklist-review-section{min-height:180px}.photo-rule-list{min-height:300px}
</style></head><body><div id="app"></div></body></html>`;
await page.route('http://preview.local/**', route => route.fulfill({ status:200, contentType:'text/html; charset=utf-8', body:pageHtml }));
await page.goto('http://preview.local/');

await page.evaluate(() => {
  window.state = {
    activeControl:'checklists',
    controlRecords:[{
      id:'submission-1', checklistId:'opening', checklistTitle:'Открытие смены', employeeName:'Анна',
      createdAt:'2026-07-25T08:00:00Z', completed:2, total:2, percent:100, photoCount:0,
      tasks:[{ itemKey:'one', text:'Первый пункт', checked:true }, { itemKey:'two', text:'Второй пункт', checked:true }],
      photos:[]
    }],
    revisionRecords:[{ id:'revision-1', dateKey:'2026-07-25', employeeName:'Анна', hopperWeight:'1.2', openedPacks:'2' }],
    errorReports:[], controlLoading:false, revisionLoading:false, checklistPhotoVisibleDays:14,
    checklistPhotoControlHasMore:false, checklistPhotoControlCursor:'2026-07-25T08:00:00Z'
  };
  window.__renderCount = 0;

  window.__markup = () => {
    const active = window.state.activeControl;
    const record = window.state.controlRecords[0];
    return `<section id="top-control" class="top-panel active">
      <div id="control-checklists" class="control-folder ${active === 'checklists' ? 'active' : ''}">
        <details class="checklist-photo-rules-card" data-photo-rules-card>
          <summary><strong>Настройка фотоотчёта</strong></summary>
          <form data-photo-rules-form><select name="checklistId"><option value="opening">Открытие</option></select><div class="photo-rule-list"><article data-photo-rule-row data-item-key="one"><input data-rule-enabled type="checkbox"><select data-rule-count><option>1</option><option>2</option></select><input data-rule-hint></article></div></form>
        </details>
        <section id="control-records"><div class="spacer"></div><div class="checklist-control-days">
          <details class="control-day-group" open><summary><strong>25 июля 2026</strong></summary><div>
            <details class="checklist-submission-details" data-checklist-submission="${record.id}"><summary><strong>${record.checklistTitle}</strong><small>фото ${record.photoCount}</small></summary>
              <div class="submission-body"><p class="marker" data-scroll-marker>Середина выполненного чек-листа</p></div>
              <section class="checklist-review-section" data-checklist-review-section><form data-checklist-comment-form data-submission-id="${record.id}"><select name="assigneeId"><option value="employee-1">Анна</option></select><textarea name="body"></textarea></form></section>
            </details>
          </div></details>
        </div></section>
      </div>
      <div id="control-revisions" class="control-folder ${active === 'revisions' ? 'active' : ''}"><div class="spacer"></div>
        <details class="revision-result-details" data-revision-id="revision-1"><summary><strong>Ревизия кофе 25.07.2026</strong></summary><div style="height:500px">Данные ревизии</div></details>
      </div>
    </section>`;
  };
  window.renderApp = () => { window.__renderCount += 1; document.querySelector('#app').innerHTML = window.__markup(); };
  window.refreshControl = () => { window.__renderCount += 1; document.querySelector('#top-control').outerHTML = window.__markup(); };
  document.querySelector('#app').innerHTML = window.__markup();
});

await page.addScriptTag({ path:path.join(root, 'assets/js/control-section-stability-v2.js') });

async function touchRace(selector, mutate = null){
  return await page.evaluate(({ selector, mutate }) => {
    const summary = document.querySelector(selector);
    const details = summary.parentElement;
    summary.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, pointerId:7, pointerType:'touch', isPrimary:true, button:0 }));
    if(mutate === 'photo') window.state.controlRecords[0].photoCount += 1;
    if(mutate === 'revision') window.state.revisionRecords[0].hopperWeight = String(Number(window.state.revisionRecords[0].hopperWeight) + 0.1);
    window.refreshControl();
    const connectedDuringTouch = summary.isConnected;
    summary.dispatchEvent(new PointerEvent('pointerup', { bubbles:true, pointerId:7, pointerType:'touch', isPrimary:true, button:0 }));
    summary.click();
    return { connectedDuringTouch, oldDetailsOpen:details.open };
  }, { selector, mutate });
}

const first = await touchRace('[data-checklist-submission] > summary');
assert.equal(first.connectedDuringTouch, true, 'Background review refresh must not detach the touched summary');
await page.waitForTimeout(750);
assert.equal(await page.locator('[data-checklist-submission]').evaluate(node => node.open), true, 'The first tap must open the checklist');
assert.equal(await page.evaluate(() => window.__renderCount), 0, 'Redundant review refresh must not redraw Control');

await page.locator('[data-checklist-submission] > summary').click();
await page.waitForFunction(() => document.querySelector('[data-checklist-submission]')?.open === false);
const changed = await touchRace('[data-checklist-submission] > summary', 'photo');
assert.equal(changed.connectedDuringTouch, true, 'A changed-data refresh must wait until the touch/click sequence completes');
await page.waitForTimeout(800);
assert.equal(await page.locator('[data-checklist-submission]').evaluate(node => node.open), true, 'The checklist must remain open after the deferred changed-data render');
assert.equal(await page.evaluate(() => window.__renderCount), 1, 'Changed data must render exactly once');

await page.evaluate(() => { window.refreshControl(); window.refreshControl(); window.refreshControl(); });
await page.waitForTimeout(100);
assert.equal(await page.evaluate(() => window.__renderCount), 1, 'Unchanged background refreshes must not replace the DOM');

await page.locator('[data-scroll-marker]').scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, 90));
await page.waitForTimeout(50);
const before = await page.evaluate(() => ({ scrollY:window.scrollY, markerTop:document.querySelector('[data-scroll-marker]').getBoundingClientRect().top }));
await page.evaluate(() => { window.state.controlRecords[0].photoCount += 1; window.refreshControl(); });
await page.waitForTimeout(180);
const after = await page.evaluate(() => ({
  scrollY:window.scrollY,
  markerTop:document.querySelector('[data-scroll-marker]').getBoundingClientRect().top,
  open:document.querySelector('[data-checklist-submission]').open
}));
assert.equal(after.open, true, 'Expanded checklist must survive a real data redraw');
assert(Math.abs(after.scrollY - before.scrollY) <= 3, `Scroll changed: ${before.scrollY} -> ${after.scrollY}`);
assert(Math.abs(after.markerTop - before.markerTop) <= 3, `Visible content moved: ${before.markerTop} -> ${after.markerTop}`);

await page.locator('[data-photo-rules-card] > summary').click();
await page.locator('[data-rule-enabled]').check();
await page.locator('[data-rule-count]').selectOption('2');
await page.locator('[data-rule-hint]').fill('Покажите итог крупным планом');
await page.evaluate(() => { window.state.controlRecords[0].photoCount += 1; window.refreshControl(); });
await page.waitForTimeout(180);
assert.equal(await page.locator('[data-photo-rules-card]').evaluate(node => node.open), true, 'Photo settings must stay open');
assert.equal(await page.locator('[data-rule-enabled]').isChecked(), true, 'Unsaved photo rule checkbox must survive');
assert.equal(await page.locator('[data-rule-count]').inputValue(), '2', 'Unsaved photo count must survive');
assert.equal(await page.locator('[data-rule-hint]').inputValue(), 'Покажите итог крупным планом', 'Unsaved photo hint must survive');

await page.evaluate(() => { window.state.activeControl = 'revisions'; window.refreshControl(); });
await page.waitForTimeout(180);
const revision = await touchRace('[data-revision-id] > summary', 'revision');
assert.equal(revision.connectedDuringTouch, true, 'Revision summary must stay connected until click');
await page.waitForTimeout(800);
assert.equal(await page.locator('[data-revision-id]').evaluate(node => node.open), true, 'Revision must open on the first tap and stay open after redraw');

await browser.close();
console.log('Control touch race, render coalescing and viewport stability smoke passed.');

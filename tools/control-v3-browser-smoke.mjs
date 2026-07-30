import { chromium } from 'playwright';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const browser = await chromium.launch({ headless:true });
const page = await browser.newPage({ viewport:{ width:1440, height:900 } });

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font-family:Arial}.top-panel:not(.active){display:none}.control-folder:not(.active){display:none}
.subtabs{position:sticky;top:0;background:white;padding:12px}.submission-body{height:1900px}.marker{padding-top:860px}
.control-v3-stage{min-height:500px}summary{min-height:54px;display:flex;align-items:center}
</style></head><body><div id="panels"></div></body></html>`;
await page.route('http://preview.local/**', route => route.fulfill({ status:200, contentType:'text/html; charset=utf-8', body:html }));
await page.goto('http://preview.local/');

await page.evaluate(() => {
  window.state = {
    menu:{}, activeTop:'control', activeControl:'checklists',
    controlRecords:[{ id:'submission-1', checklistId:'opening', checklistTitle:'Открытие смены', employeeName:'Анна', createdAt:'2026-07-30T08:00:00Z', completed:2, total:2, percent:100, photoCount:0, tasks:[{ itemKey:'one', text:'Первый пункт', checked:true }, { itemKey:'two', text:'Второй пункт', checked:true }], photos:[] }],
    revisionRecords:[{ id:'revision-1', dateKey:'2026-07-30', employeeName:'Анна', hopperWeight:'1.2' }],
    errorReports:[], controlLoading:false, revisionLoading:false, errorReportsLoading:false, controlError:'', revisionError:'', errorReportsError:'', checklistPhotoVisibleDays:14, checklistPhotoControlHasMore:false, checklistPhotoControlCursor:''
  };
  window.__legacySetTab = 0;
  window.__legacyRefresh = 0;
  window.__renderCount = 0;
  window.__enhanceCount = 0;
  window.__scrollCalls = [];

  window.esc = value => String(value ?? '').replace(/[&<>"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[character]));
  window.currentUser = () => ({ id:'admin-1', role:'admin', name:'Администратор' });
  window.normalizeRole = role => String(role || '').toLowerCase();
  window.isAuthenticated = () => true;
  window.renderControlSummaryV21 = () => '<section data-summary>Сводка</section>';
  window.renderManualReportBuilderV23 = () => '<form id="report-builder-form"><select name="source"><option value="all">Все</option></select><input name="employee"><input name="dateFrom"><input name="dateTo"><button data-report-reset type="button">Сброс</button><button type="submit">Сформировать</button><button data-report-export type="button">Экспорт</button><div id="manual-report-table"></div></form>';
  window.renderManualReportTableV23 = () => '<p>Таблица</p>';
  window.renderControlRecordsTable = () => {
    const record = window.state.controlRecords[0];
    return `<div class="checklist-control-days"><details class="control-day-group" open><summary><strong>30 июля 2026</strong></summary><details class="checklist-submission-details" data-checklist-submission="${record.id}"><summary><strong>${record.checklistTitle}</strong><small>фото ${record.photoCount}</small></summary><div class="submission-body"><p class="marker" data-marker>Середина чек-листа</p></div></details></details></div>`;
  };
  window.renderRevisionManualForm = () => '<details class="revision-manual"><summary>Внести вручную</summary><form id="revision-manual-form"><input name="revisionDate" value="2026-07-30"><button type="submit">Сохранить</button></form></details>';
  window.renderRevisionRecordsTable = () => '<details data-revision-id="revision-1"><summary>Ревизия 30.07</summary><div style="height:700px">Данные</div></details>';
  window.renderErrorReportsTable = () => '<div data-errors>Ошибок нет</div>';
  window.exportControlCsv = () => {};
  window.exportRevisionCsv = () => {};
  window.exportManualReportV23 = () => {};
  window.submitRevisionManual = () => {};
  window.loadControlRecords = async () => {};
  window.loadRevisionRecords = async () => {};
  window.loadErrorReports = async () => {};
  window.SovremennikChecklistPhotoReports = { queueEnhance(){ window.__enhanceCount += 1; } };
  window.SovremennikChecklistReviewTools = { queueEnhance(){ window.__enhanceCount += 1; } };

  window.setControlTab = target => { window.__legacySetTab += 1; window.state.activeControl = target; };
  window.refreshControl = () => { window.__legacyRefresh += 1; };
  window.renderControl = () => '<section id="top-control"></section>';
  window.renderApp = () => { window.__renderCount += 1; document.querySelector('#panels').innerHTML = window.renderControl(); };

  const nativeScrollTo = window.scrollTo.bind(window);
  const nativeScrollBy = window.scrollBy.bind(window);
  window.scrollTo = (...args) => { window.__scrollCalls.push(['to', ...args]); return nativeScrollTo(...args); };
  window.scrollBy = (...args) => { window.__scrollCalls.push(['by', ...args]); return nativeScrollBy(...args); };
});

await page.addScriptTag({ path:path.join(root, 'assets/js/control-v3-core.js') });
await page.addScriptTag({ path:path.join(root, 'assets/js/control-v3.js') });
await page.waitForFunction(() => window.SovremennikControlV3?.VERSION);

assert.equal(await page.locator('#top-control').getAttribute('data-control-version'), '2026-07-30-control-v3-1');
assert.equal(await page.locator('#control-checklists').isVisible(), true);
assert.equal(await page.locator('#control-summary').isVisible(), false);
assert.equal(await page.locator('#control-summary').innerHTML(), '', 'Inactive standard folders must stay empty');

await page.locator('[data-checklist-submission] > summary').click();
assert.equal(await page.locator('[data-checklist-submission]').evaluate(node => node.open), true);
await page.locator('[data-marker]').scrollIntoViewIfNeeded();
await page.evaluate(() => { window.scrollBy(0, 120); window.__scrollCalls = []; });

const before = await page.evaluate(() => { const details = document.querySelector('[data-checklist-submission]'); window.__detailsBefore = details; return { scrollY:window.scrollY }; });
await page.evaluate(() => window.refreshControl());
await page.waitForTimeout(80);
const unchanged = await page.evaluate(() => ({ same:window.__detailsBefore === document.querySelector('[data-checklist-submission]'), scrollY:window.scrollY, scrollCalls:window.__scrollCalls.slice(), legacyRefresh:window.__legacyRefresh }));
assert.equal(unchanged.same, true, 'Unchanged data must not replace the active checklist DOM');
assert(Math.abs(unchanged.scrollY - before.scrollY) <= 1, `Unchanged refresh moved scroll: ${before.scrollY} -> ${unchanged.scrollY}`);
assert.deepEqual(unchanged.scrollCalls, [], 'Control v3 must not call scrollTo/scrollBy');
assert.equal(unchanged.legacyRefresh, 0, 'The old refresh renderer must be disconnected');

await page.evaluate(() => { window.state.controlRecords[0].photoCount = 1; window.refreshControl(); });
await page.waitForTimeout(80);
const changed = await page.evaluate(() => ({ open:document.querySelector('[data-checklist-submission]')?.open, scrollY:window.scrollY, scrollCalls:window.__scrollCalls.slice(), text:document.querySelector('[data-checklist-submission] small')?.textContent }));
assert.equal(changed.open, true, 'Changed data refresh must restore the expanded checklist');
assert.equal(changed.text, 'фото 1');
assert(Math.abs(changed.scrollY - before.scrollY) <= 2, `Changed refresh moved scroll: ${before.scrollY} -> ${changed.scrollY}`);
assert.deepEqual(changed.scrollCalls, [], 'Changed refresh must not use programmatic scrolling');

await page.evaluate(() => window.setControlTab('revisions'));
assert.equal(await page.locator('#control-revisions').isVisible(), true);
assert.equal(await page.locator('#control-checklists').innerHTML(), '', 'Leaving the checklist tab must remove its heavy DOM');
assert.equal(await page.evaluate(() => window.__legacySetTab), 1, 'Legacy tab hook should only be used for data side effects');

await page.evaluate(() => window.setControlTab('checklists'));
assert.equal(await page.locator('#control-checklists').isVisible(), true);
assert.equal(await page.locator('[data-checklist-submission]').count(), 1);
assert.equal(await page.evaluate(() => window.__legacySetTab), 2);
assert.equal(await page.evaluate(() => Boolean(window.SovremennikControlSectionStability)), false, 'Old Control coordinator must not be required');
assert.equal(await page.evaluate(() => Boolean(window.SovremennikControlViewportJitterFix)), false, 'Old viewport jitter guard must not be required');

await browser.close();
console.log('Control v3 isolated rendering and viewport stability smoke passed.');

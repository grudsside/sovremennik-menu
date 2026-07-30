import { chromium } from 'playwright';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const browser = await chromium.launch({ headless:true });
const page = await browser.newPage({ viewport:{ width:1440, height:900 } });

const markup = `<!doctype html><html><head><meta charset="utf-8"><style>
[hidden]{display:none!important}.control-day-group{display:block}.checklist-submission-details{display:block}
summary{cursor:pointer;padding:10px}.active{font-weight:700}.control-table{border-collapse:collapse}.control-table td,.control-table th{border:1px solid #ccc;padding:4px}
</style></head><body>
<section id="top-control">
  <button type="button" data-control-target="revisions">Ревизии</button>
  <div id="control-revisions"><div id="revision-records"></div></div>
  <div id="control-records">
    <div data-checklist-department-filter>
      <button type="button" class="active" data-checklist-department="barista">Бармены</button>
      <button type="button" data-checklist-department="waiter">Официанты</button>
    </div>
    <div class="checklist-control-days">
      <details class="control-day-group" open>
        <summary>30 июля 2026</summary>
        <details class="checklist-submission-details" data-checklist-submission="bar-1">
          <summary><strong>Чек-лист бариста</strong></summary><div>Бариста</div>
        </details>
        <details class="checklist-submission-details" data-checklist-submission="waiter-1" hidden>
          <summary><strong>Чек-лист официанта</strong></summary><div>Официант</div>
        </details>
      </details>
    </div>
  </div>
</section>
<div class="doc-card" data-checklist-id="opening">
  <input class="employee-name" value="Софья">
  <label><input class="task-checkbox" type="checkbox" data-task="Открыть смену" checked></label>
  <div class="submit-panel"><button type="button" class="submit-checklist">Отправить</button><span class="submit-status"></span></div>
</div>
</body></html>`;

await page.route('http://preview.local/**', route => route.fulfill({ status:200, contentType:'text/html; charset=utf-8', body:markup }));
await page.goto('http://preview.local/');

await page.evaluate(() => {
  window.state = {
    activeTop:'control',
    activeControl:'revisions',
    revisionLoading:true,
    revisionError:'',
    revisionRecords:[{
      id:'coffee-2026-07-29', dateKey:'2026-07-29', date:'29.07.2026', employeeName:'Софья',
      hopperWeight:'1.250', openedPacks:'2', writeOffs:'0.120', iikoSales:'3.500',
      difference:'-0.100', losses:'-2.86%', checked:'Руководитель', cleanHopperWeight:'0.403',
      totalCoffeeUsage:'3.600', createdAt:'2026-07-29T20:00:00Z'
    }],
    controlRecords:[
      { id:'bar-1', department:'barista' },
      { id:'waiter-1', department:'waiter' }
    ]
  };
  window.__revisionLoads = 0;
  window.__refreshes = 0;
  window.__department = 'barista';
  window.__submitCalls = 0;
  window.__photoDraftClears = 0;

  window.esc = value => String(value ?? '').replace(/[&<>"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[character]));
  window.currentUser = () => ({ id:'employee-1', name:'Софья', role:'barista' });
  window.getRevisionRecords = () => window.state.revisionRecords;
  window.mergeRevisionRecordsByDate = rows => rows.slice();
  window.displayDateFromKey = key => key === '2026-07-29' ? '29.07.2026' : key;
  window.formatDateTime = value => value;
  window.revisionValueClass = () => '';
  window.renderRevisionRecordsTable = () => window.state.revisionLoading
    ? '<div data-legacy-loader>Загружаю данные ревизий…</div>'
    : `<div data-legacy-revision>${window.state.revisionRecords[0]?.hopperWeight || 'нет данных'}</div>`;
  window.loadRevisionRecords = async () => {
    window.__revisionLoads += 1;
    window.state.revisionLoading = true;
    await new Promise(resolve => setTimeout(resolve, 40));
    window.state.revisionRecords = [{
      id:'coffee-2026-07-30', dateKey:'2026-07-30', date:'30.07.2026', employeeName:'Софья',
      hopperWeight:'1.400', openedPacks:'3', createdAt:'2026-07-30T08:00:00Z'
    }];
    window.state.revisionLoading = false;
    return window.state.revisionRecords;
  };
  window.SovremennikControlV3 = {
    refresh(){
      window.__refreshes += 1;
      document.querySelector('#revision-records').innerHTML = window.renderRevisionRecordsTable();
      return true;
    }
  };
  window.SovremennikChecklistReviewTools = {
    departmentForRecord(record){ return record.department; },
    setDepartmentForTesting(value){ window.__department = value; },
    queueEnhance(){}
  };
  window.SovremennikChecklistPhotoReports = { queueEnhance(){} };
  window.SovremennikChecklistPhotoDraftFix = {
    async clearChecklist(){ window.__photoDraftClears += 1; }
  };
  window.submitChecklist = async checklistId => {
    window.__submitCalls += 1;
    const card = document.querySelector(`.doc-card[data-checklist-id="${checklistId}"]`);
    card.querySelector('.employee-name').value = '';
    card.querySelectorAll('.task-checkbox').forEach(input => { input.checked = false; });
    card.querySelector('.submit-status').textContent = 'Чек-лист отправлен.';
  };
});

await page.addScriptTag({ path:path.join(root, 'assets/js/control-v3-regression-fix.js') });
await page.waitForFunction(() => window.SovremennikControlV3RegressionFix?.VERSION);

const cachedRevision = await page.evaluate(() => window.renderRevisionRecordsTable());
assert(cachedRevision.includes('data-legacy-revision'), 'Cached revisions must remain visible while a refresh is running');
assert(cachedRevision.includes('Обновляю ревизии'), 'Cached revision render must explain background refresh');
assert(!cachedRevision.includes('data-legacy-loader'), 'Background refresh must not replace cached revisions with an endless loader');

await page.evaluate(() => window.loadRevisionRecords());
await page.waitForTimeout(80);
assert.equal(await page.evaluate(() => window.__revisionLoads), 1, 'Revision loader must execute once');
assert.equal(await page.evaluate(() => window.state.revisionLoading), false, 'Revision loading flag must always be released');
assert.equal(await page.locator('#revision-records').textContent(), '1.400', 'Fresh revision data must replace cached data');

await page.locator('[data-checklist-department="waiter"]').click();
await page.waitForTimeout(120);
assert.equal(await page.evaluate(() => window.__department), 'waiter', 'Waiter filter must be applied directly');
assert.equal(await page.locator('[data-checklist-submission="bar-1"]').isHidden(), true, 'Barista report must be hidden in waiter mode');
assert.equal(await page.locator('[data-checklist-submission="waiter-1"]').isVisible(), true, 'Waiter report must become visible');
assert.equal(await page.locator('[data-checklist-department="waiter"]').getAttribute('aria-pressed'), 'true');

await page.locator('[data-checklist-submission="waiter-1"] > summary').click();
assert.equal(await page.locator('[data-checklist-submission="waiter-1"]').evaluate(node => node.open), true, 'Waiter report summary must open deterministically');

await page.evaluate(() => window.submitChecklist('opening'));
await page.waitForTimeout(260);
assert.equal(await page.evaluate(() => window.__submitCalls), 1, 'First checklist submission must reach the original sender');
assert.equal(await page.inputValue('.doc-card .employee-name'), '', 'Successful submission must clear employee name');
assert.equal(await page.isChecked('.doc-card .task-checkbox'), false, 'Successful submission must clear checklist state');
assert((await page.evaluate(() => window.__photoDraftClears)) >= 1, 'Successful submission must clear the independent photo draft store');

await page.evaluate(() => {
  const card = document.querySelector('.doc-card[data-checklist-id="opening"]');
  card.querySelector('.employee-name').value = 'Софья';
  card.querySelector('.task-checkbox').checked = true;
  card.querySelector('.submit-status').textContent = '';
});
await page.evaluate(() => window.submitChecklist('opening'));
await page.waitForTimeout(180);
assert.equal(await page.evaluate(() => window.__submitCalls), 1, 'An identical restored draft must not create a second submission');
assert.equal(await page.inputValue('.doc-card .employee-name'), '', 'Blocked duplicate draft must be cleared');
assert((await page.locator('.doc-card .submit-status').textContent()).includes('уже был отправлен'), 'The employee must see why the repeated draft was removed');

await browser.close();
console.log('Control v3 regression hotfix browser smoke passed.');

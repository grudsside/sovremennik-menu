import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const browser = await chromium.launch({ headless:true });
const page = await browser.newPage({ viewport:{ width:1280, height:800 } });

await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="app"><section id="control-records"><div class="checklist-control-days">
  <details class="control-day-group" open><summary><span><strong>24 июля 2026</strong><small>2 отчёта</small></span><span class="control-day-percent progress-complete">100%</span></summary>
    <div class="control-day-records">
      <details class="checklist-submission-details" data-checklist-submission="barista-report" open>
        <summary><span class="control-submission-main"><strong>Открытие смены</strong></span><span class="control-submission-metrics"><b>100%</b></span></summary>
        <div class="control-checklist-task-list">
          <article class="control-checklist-task"><div class="control-checklist-task-head"><strong>Проверить кофемолку</strong></div><div class="control-photo-card"><button data-photo-view data-photo-path="barista/1.jpg"><span data-photo-thumb-placeholder>Фото 1</span></button></div><div class="control-photo-card"><button data-photo-view data-photo-path="barista/2.jpg"><span data-photo-thumb-placeholder>Фото 2</span></button></div></article>
        </div>
      </details>
      <details class="checklist-submission-details" data-checklist-submission="waiter-report" open>
        <summary><span class="control-submission-main"><strong>Официант · открытие смены</strong></span><span class="control-submission-metrics"><b>50%</b></span></summary>
        <div class="control-checklist-task-list"><article class="control-checklist-task"><div class="control-checklist-task-head"><strong>Проверить зал</strong></div></article></div>
      </details>
    </div>
  </details>
</div></section></div>
</body></html>`);

await page.addStyleTag({ path:path.join(root, 'assets/css/checklist-review-tools.css') });
await page.evaluate(() => {
  window.state = {
    menu:{ checklists:[
      { id:'opening-checklist', title:'Открытие смены', department:'barista' },
      { id:'waiter-opening-checklist', title:'Официант · открытие смены', department:'waiter' }
    ] },
    controlRecords:[
      { id:'barista-report', checklistId:'opening-checklist', checklistTitle:'Открытие смены', tasks:[{ checked:true }] },
      { id:'waiter-report', checklistId:'waiter-opening-checklist', checklistTitle:'Официант · открытие смены', tasks:[{ checked:false },{ checked:true }] }
    ]
  };
  window.__user = { id:'manager-id', role:'manager', name:'Руководитель' };
  window.currentUser = () => window.__user;
  window.refreshControl = () => {};
  window.renderApp = () => {};
  window.loadControlRecords = async () => window.state.controlRecords;
  window.SovremennikChecklistCore = {
    normalizeRole:value => String(value || '').toLowerCase(),
    departmentForDoc:doc => doc?.department === 'waiter' || String(doc?.title || '').includes('Официант') ? 'waiter' : 'barista'
  };
  window.SovremennikChecklistPhotoCore = { progressClass:percent => percent >= 100 ? 'complete' : percent >= 70 ? 'warning' : 'danger' };
  window.__rpcCalls = [];
  const metadata = [
    { id:'barista-report', employee_id:'barista-id', checklist_id:'opening-checklist', checklist_title:'Открытие смены', deleted_at:null },
    { id:'waiter-report', employee_id:'waiter-id', checklist_id:'waiter-opening-checklist', checklist_title:'Официант · открытие смены', deleted_at:null }
  ];
  const profiles = [
    { id:'barista-id', name:'Анна', role:'barista', is_active:true },
    { id:'waiter-id', name:'Иван', role:'waiter', is_active:true }
  ];
  function builder(table){
    const api = {
      select(){ return api; },
      in(){
        if(table === 'checklist_submissions') return Promise.resolve({ data:metadata, error:null });
        if(table === 'checklist_submission_comments') return Promise.resolve({ data:[], error:null });
        return Promise.resolve({ data:[], error:null });
      },
      eq(){ return api; },
      order(){ return Promise.resolve({ data:table === 'profiles' ? profiles : [], error:null }); }
    };
    return api;
  }
  window.supa = {
    from:builder,
    rpc:async (name,args) => { window.__rpcCalls.push({ name,args }); return { data:name === 'delete_checklist_submission' ? args.p_submission_id : [], error:null }; },
    storage:{ from:() => ({ createSignedUrl:async () => ({ data:{ signedUrl:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40"%3E%3Crect width="40" height="40" fill="%23ddd"/%3E%3C/svg%3E' }, error:null }) }) }
  };
  window.confirm = () => true;
});

await page.addScriptTag({ path:path.join(root, 'assets/js/checklist-review-tools.js') });
await page.waitForSelector('[data-checklist-department-filter]');
await page.waitForSelector('[data-checklist-comment-form]');

assert.equal(await page.locator('[data-checklist-department="barista"]').getAttribute('class'), 'active');
assert.equal(await page.locator('[data-checklist-submission="barista-report"]').isHidden(), false);
assert.equal(await page.locator('[data-checklist-submission="waiter-report"]').isHidden(), true);

await page.click('[data-checklist-department="waiter"]');
await page.waitForFunction(() => !document.querySelector('[data-checklist-submission="waiter-report"]').hidden);
assert.equal(await page.locator('[data-checklist-submission="barista-report"]').isHidden(), true);
assert.equal(await page.locator('[data-checklist-submission="waiter-report"]').isHidden(), false);

await page.click('[data-checklist-department="barista"]');
await page.waitForFunction(() => !document.querySelector('[data-checklist-submission="barista-report"]').hidden);
await page.click('[data-photo-path="barista/1.jpg"]');
await page.waitForSelector('[data-checklist-review-viewer]:not([hidden])');
assert.equal(await page.locator('[data-viewer-counter]').textContent(), '1 из 2');
await page.click('[data-viewer-next]');
assert.equal(await page.locator('[data-viewer-counter]').textContent(), '2 из 2');
await page.click('[data-viewer-zoom-in]');
assert.equal(await page.locator('[data-viewer-zoom]').textContent(), '125%');
await page.keyboard.press('Escape');
assert.equal(await page.locator('[data-checklist-review-viewer]').isHidden(), true);

const form = page.locator('[data-checklist-submission="barista-report"] [data-checklist-comment-form]');
await form.locator('textarea').fill('Проверьте повторно кофемолку.');
await form.locator('select').selectOption('barista-id');
await form.locator('button[type="submit"]').click();
await page.waitForFunction(() => window.__rpcCalls.some(call => call.name === 'create_checklist_submission_comment'));

await page.evaluate(() => { window.__user.role = 'admin'; window.SovremennikChecklistReviewTools.queueEnhance(); });
await page.waitForSelector('[data-checklist-delete="barista-report"]');
await page.click('[data-checklist-delete="barista-report"]');
await page.waitForFunction(() => window.__rpcCalls.some(call => call.name === 'delete_checklist_submission'));

await browser.close();
console.log('Checklist review browser smoke passed.');

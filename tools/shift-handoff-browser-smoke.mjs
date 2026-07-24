import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const artifactDir = path.join(process.cwd(), 'artifacts', 'open-test-preview');
await fs.mkdir(artifactDir, { recursive:true });

const browser = await chromium.launch({ headless:true });
const page = await browser.newPage({ viewport:{ width:390, height:844 }, deviceScaleFactor:1 });
page.on('dialog', dialog => dialog.accept());

await page.setContent(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
body{margin:0;background:#eef1eb;font-family:Arial,sans-serif}.page{padding:14px}.top-panel{display:block}.v3-dashboard-card,.doc-card{background:#fff;border-radius:18px;padding:15px;margin-bottom:14px}.small-action,.submit-checklist{border:0;border-radius:11px;padding:10px 13px;background:#365d47;color:#fff}.secondary{background:#e7ede7;color:#365044}.doc-details{display:block}.submit-panel{margin-top:14px}.submit-status.error{color:#9a3d2c}
</style></head><body><main class="page"><div id="app"></div></main></body></html>`);
await page.addStyleTag({ path:'assets/css/shift-handoff.css' });
await page.addStyleTag({ path:'assets/css/shift-handoff-hotfix.css' });

await page.evaluate(() => {
  const user = { id:'22222222-2222-4222-8222-222222222222', name:'Администратор', role:'admin' };
  window.state = {
    auth:{ user, session:{ access_token:'test', user:{ id:user.id } } },
    menu:{ checklists:[
      { id:'opening-checklist', title:'Чек-лист открытия', file:'assets/documents/checklist_open_close.xlsx' },
      { id:'closing-checklist', title:'Чек-лист закрытия', file:'assets/documents/checklist_open_close.xlsx' },
    ] }
  };
  window.__handoffs = [{
    id:'33333333-3333-4333-8333-333333333333',
    created_by:'11111111-1111-4111-8111-111111111111',
    created_by_name:'Анна',
    created_by_role:'barista',
    unfinished:['Не разобрана поставка'],
    out_of_stock:['Овсяное молоко'],
    equipment_issues:[],
    next_shift_control:['Проверить поставку'],
    notes:'',
    created_at:new Date(Date.now() - 60_000).toISOString(),
    visible_until:'9999-12-31T23:59:59+00:00',
  }];
  window.__acks = [];
  window.__photos = [];
  window.__submittedChecklists = [];
  window.__uuidCounter = 0;
  window.currentUser = () => window.state.auth.user;
  window.isAuthenticated = () => true;
  window.normalizeRole = role => String(role || '').toLowerCase();
  window.roleLabel = role => ({ barista:'Бариста', waiter:'Официант', admin:'Администратор' }[role] || role);
  window.esc = value => String(value ?? '').replace(/[&<>\"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char]));
  window.makeUuidV26 = () => `55555555-5555-4555-8555-${String(++window.__uuidCounter).padStart(12, '0')}`;
  window.submitChecklist = async docId => { window.__submittedChecklists.push(docId); };
  window.setTop = () => {};
  window.renderApp = () => {
    document.querySelector('#app').innerHTML = `
      <section id="top-home"><section class="v3-summary-card"></section></section>
      <section id="top-checklists">
        <article class="doc-card" data-checklist-id="opening-checklist">
          <details class="doc-details" open><summary>Открыть чек-лист открытия</summary>
            <label><input class="task-checkbox" type="checkbox" checked>Открыть кассу</label>
            <div class="submit-panel"><button class="submit-checklist" data-checklist-id="opening-checklist">Отправить открытие</button></div>
          </details>
        </article>
        <article class="doc-card" data-checklist-id="closing-checklist">
          <details class="doc-details" open><summary>Открыть чек-лист закрытия</summary>
            <label><input class="task-checkbox" type="checkbox" checked>Закрыть кассу</label>
            <div class="submit-panel"><button class="submit-checklist" data-checklist-id="closing-checklist">Отправить закрытие</button></div>
          </details>
        </article>
      </section>`;
    document.querySelectorAll('.submit-checklist').forEach(button => {
      button.addEventListener('click', () => window.submitChecklist(button.dataset.checklistId));
    });
  };

  function query(table){
    const chain = {
      select(){ return chain; }, gte(){ return chain; }, order(){ return chain; }, limit(){ return chain; }, in(){ return chain; },
      insert(payload){
        if(table === 'shift_handoff_photos') window.__photos.push({ ...payload, id:window.makeUuidV26(), created_at:new Date().toISOString() });
        return chain;
      },
      then(resolve, reject){
        let data = [];
        if(table === 'shift_handoffs') data = window.__handoffs.slice();
        if(table === 'shift_handoff_acknowledgements') data = window.__acks.slice();
        if(table === 'shift_handoff_photos') data = window.__photos.slice();
        return new Promise(done => setTimeout(() => done({ data, error:null }), 40)).then(resolve, reject);
      },
    };
    return chain;
  }

  window.supa = {
    from:query,
    rpc:async (name, args) => {
      const actor = window.state.auth.user;
      if(name === 'acknowledge_shift_handoff'){
        const existing = window.__acks.find(item => item.handoff_id === args.p_handoff_id && item.employee_id === actor.id);
        if(!existing) window.__acks.push({ handoff_id:args.p_handoff_id, employee_id:actor.id, employee_name:actor.name, acknowledged_at:new Date().toISOString() });
        return { data:window.__acks.filter(item => item.handoff_id === args.p_handoff_id && item.employee_id === actor.id), error:null };
      }
      if(name === 'create_shift_handoff'){
        window.__handoffs.forEach(item => { item.visible_until = new Date(Date.now() - 1000).toISOString(); });
        window.__handoffs.unshift({
          id:args.p_id, created_by:actor.id, created_by_name:actor.name, created_by_role:actor.role,
          unfinished:args.p_unfinished, out_of_stock:args.p_out_of_stock,
          equipment_issues:args.p_equipment_issues, next_shift_control:args.p_next_shift_control,
          notes:args.p_notes, created_at:new Date().toISOString(),
          visible_until:'9999-12-31T23:59:59+00:00',
        });
        return { data:[window.__handoffs[0]], error:null };
      }
      return { data:null, error:new Error(`Unexpected RPC: ${name}`) };
    },
    storage:{ from:() => ({
      createSignedUrl:async filePath => ({ data:{ signedUrl:`https://example.test/${filePath}` }, error:null }),
      upload:async filePath => ({ data:{ path:filePath }, error:null }),
    }) },
  };
});

await page.addScriptTag({ path:'assets/js/shift-handoff-core.js' });
await page.addScriptTag({ path:'assets/js/shift-handoff.js' });
await page.addScriptTag({ path:'assets/js/shift-handoff-mobile-input-fix.js' });
await page.evaluate(() => window.renderApp());

const openingCard = page.locator('.doc-card[data-checklist-id="opening-checklist"]');
const closingCard = page.locator('.doc-card[data-checklist-id="closing-checklist"]');
const homeCard = page.locator('[data-shift-handoff-incoming]');
await homeCard.waitFor();
await page.getByText('Овсяное молоко').waitFor();
assert.equal(await openingCard.locator('[data-shift-handoff-checklist]').count(), 0);
await closingCard.locator('[data-shift-handoff-checklist]').waitFor();
assert.equal(await page.evaluate(() => window.SovremennikShiftHandoff.isAvailable()), true, 'Administrator must have shift handoff access');
const homeMargin = await homeCard.evaluate(element => Number.parseFloat(getComputedStyle(element).marginTop));
assert(homeMargin >= 20, `Shift handoff card must have a visible external gap, received ${homeMargin}px`);

await page.locator('[data-shift-handoff-accept]').click();
await page.getByText(/Принято ·/).waitFor();
await page.getByText('Овсяное молоко').waitFor();
assert.equal(await page.locator('[data-shift-handoff-incoming]').count(), 1, 'Acknowledgement must not hide current handoff');

await openingCard.locator('.submit-checklist').click();
await page.waitForFunction(() => window.__submittedChecklists.length === 1);
assert.deepEqual(await page.evaluate(() => window.__submittedChecklists), ['opening-checklist']);

await closingCard.locator('.submit-checklist').click();
await page.getByText('Перед отправкой выберите статус передачи смены.').waitFor();

await page.getByRole('button', { name:'Замечаний нет' }).click();
await closingCard.locator('.submit-checklist').click();
await page.waitForFunction(() => window.__submittedChecklists.length === 2 && window.__handoffs.length === 2);
await page.getByText('Текущая передача смены').waitFor();
await homeCard.getByText('Замечаний нет', { exact:true }).waitFor();
assert.equal(await page.evaluate(() => new Date(window.__handoffs[1].visible_until).getTime() < Date.now()), true, 'Previous handoff must expire when new closing checklist is submitted');

await closingCard.locator('[data-shift-handoff-checklist] summary').click();
await page.getByRole('button', { name:'Есть информация' }).click();
const outOfStock = page.locator('textarea[name="outOfStock"]');
await outOfStock.focus();
assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'outOfStock');
const refreshPromise = page.evaluate(() => window.SovremennikShiftHandoff.refresh());
await page.waitForTimeout(20);
assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'outOfStock', 'Background loading rerender must not dismiss the mobile keyboard');
await refreshPromise;
assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'outOfStock', 'Background completion rerender must preserve textarea focus');
await outOfStock.type('Сироп ваниль');
assert.equal(await outOfStock.inputValue(), 'Сироп ваниль');
await closingCard.locator('.submit-checklist').click();
await page.waitForFunction(() => window.__submittedChecklists.length === 3 && window.__handoffs.length === 3);
await homeCard.getByText('Сироп ваниль').waitFor();
assert.equal(await page.evaluate(() => new Date(window.__handoffs[1].visible_until).getTime() < Date.now()), true, 'Next closing checklist must replace yesterday handoff');

await page.evaluate(() => {
  window.state.auth.user.role = 'waiter';
  window.renderApp();
});
await page.waitForFunction(() => document.querySelectorAll('[data-shift-handoff-incoming],[data-shift-handoff-checklist]').length === 0);

await page.evaluate(() => {
  window.state.auth.user.role = 'admin';
  window.renderApp();
});
await page.locator('[data-shift-handoff-incoming]').waitFor();
await page.locator('.doc-card[data-checklist-id="closing-checklist"] [data-shift-handoff-checklist]').waitFor();
assert.equal(await page.evaluate(() => window.SovremennikShiftHandoff.isAvailable()), true);

await page.screenshot({ path:path.join(artifactDir, 'shift-handoff-admin-lifecycle-mobile.png'), fullPage:true });
await browser.close();
console.log('Shift handoff spacing, mobile focus, admin access and latest-until-next-closing browser smoke passed.');
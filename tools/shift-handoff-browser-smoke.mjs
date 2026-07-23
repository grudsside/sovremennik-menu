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

await page.evaluate(() => {
  const receiver = { id:'22222222-2222-4222-8222-222222222222', name:'Иван', role:'barista' };
  window.state = {
    auth:{ user:receiver, session:{ access_token:'test', user:{ id:receiver.id } } },
    menu:{ checklists:[
      { id:'opening-checklist', title:'Чек-лист открытия', description:'Открытие смены', file:'assets/documents/checklist_open_close.xlsx' },
      { id:'closing-checklist', title:'Чек-лист закрытия', description:'Закрытие смены', file:'assets/documents/checklist_open_close.xlsx' },
    ] }
  };
  window.__handoffs = [{
    id:'33333333-3333-4333-8333-333333333333',
    created_by:'11111111-1111-4111-8111-111111111111',
    created_by_name:'Анна',
    created_by_role:'barista',
    unfinished:['Не разобрана поставка'],
    out_of_stock:['Овсяное молоко'],
    equipment_issues:['Правый гриндер выдаёт ошибку'],
    next_shift_control:['Проверить поставку сиропов'],
    notes:'',
    created_at:new Date(Date.now() - 60_000).toISOString(),
    visible_until:new Date(Date.now() + 86_400_000).toISOString(),
  }];
  window.__acks = [];
  window.__photos = [];
  window.__submittedChecklists = [];
  window.__uuidCounter = 0;
  window.currentUser = () => window.state.auth.user;
  window.isAuthenticated = () => true;
  window.normalizeRole = role => String(role || '').toLowerCase();
  window.roleLabel = role => ({ barista:'Бариста', waiter:'Официант', admin:'Администратор', manager:'Руководитель' }[role] || role);
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
            <label><input class="task-checkbox" type="checkbox" data-task="Открыть кассу" checked>Открыть кассу</label>
            <div class="submit-panel"><input class="employee-name" value="Иван"><button class="submit-checklist" type="button" data-checklist-id="opening-checklist">Отправить открытие</button><p class="submit-status"></p></div>
          </details>
        </article>
        <article class="doc-card" data-checklist-id="closing-checklist">
          <details class="doc-details" open><summary>Открыть чек-лист закрытия</summary>
            <label><input class="task-checkbox" type="checkbox" data-task="Закрыть кассу" checked>Закрыть кассу</label>
            <div class="submit-panel"><input class="employee-name" value="Иван"><button class="submit-checklist" type="button" data-checklist-id="closing-checklist">Отправить закрытие</button><p class="submit-status"></p></div>
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
        return Promise.resolve({ data, error:null }).then(resolve, reject);
      },
    };
    return chain;
  }

  window.supa = {
    from:query,
    rpc:async (name, args) => {
      if(name === 'acknowledge_shift_handoff'){
        const existing = window.__acks.find(item => item.handoff_id === args.p_handoff_id && item.employee_id === receiver.id);
        if(!existing) window.__acks.push({ handoff_id:args.p_handoff_id, employee_id:receiver.id, employee_name:receiver.name, acknowledged_at:new Date().toISOString() });
        return { data:window.__acks.filter(item => item.handoff_id === args.p_handoff_id && item.employee_id === receiver.id), error:null };
      }
      if(name === 'create_shift_handoff'){
        window.__handoffs.forEach(item => { item.visible_until = new Date(Date.now() - 1000).toISOString(); });
        window.__handoffs.unshift({
          id:args.p_id, created_by:receiver.id, created_by_name:receiver.name, created_by_role:receiver.role,
          unfinished:args.p_unfinished, out_of_stock:args.p_out_of_stock,
          equipment_issues:args.p_equipment_issues, next_shift_control:args.p_next_shift_control,
          notes:args.p_notes, created_at:new Date().toISOString(),
          visible_until:new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
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
await page.evaluate(() => window.renderApp());

const incoming = page.locator('[data-shift-handoff-incoming]');
await incoming.waitFor();
await page.getByText('Овсяное молоко').waitFor();

const openingCard = page.locator('.doc-card[data-checklist-id="opening-checklist"]');
const closingCard = page.locator('.doc-card[data-checklist-id="closing-checklist"]');
assert.equal(await openingCard.locator('[data-shift-handoff-checklist]').count(), 0, 'Opening checklist must not contain shift handoff');
const step = closingCard.locator('[data-shift-handoff-checklist]');
await step.waitFor();
assert.equal(await step.getAttribute('open'), null, 'Closing checklist step should be collapsed by default');
await page.getByText('Финальный шаг чек-листа закрытия').waitFor();

await openingCard.locator('.submit-checklist').click();
await page.waitForFunction(() => window.__submittedChecklists.length === 1);
assert.deepEqual(await page.evaluate(() => window.__submittedChecklists), ['opening-checklist']);

await closingCard.locator('.submit-checklist').click();
await page.getByText('Перед отправкой выберите статус передачи смены.').waitFor();
assert.equal(await page.evaluate(() => window.__submittedChecklists.length), 1, 'Closing checklist must be blocked until shift handoff is addressed');

await page.locator('[data-shift-handoff-accept]').click();
await page.getByText('Новых сообщений нет').waitFor();
assert.equal(await page.evaluate(() => window.__acks.length), 1, 'Incoming handoff must be acknowledged exactly once');

await page.getByRole('button', { name:'Замечаний нет' }).click();
await closingCard.locator('.submit-checklist').click();
await page.waitForFunction(() => window.__submittedChecklists.length === 2);
assert.equal(await page.evaluate(() => window.__handoffs.length), 1, 'No handoff row should be created when there are no remarks');

await closingCard.locator('[data-shift-handoff-checklist] summary').click();
await page.getByRole('button', { name:'Есть информация' }).click();
await page.locator('textarea[name="outOfStock"]').fill('Миндальное молоко\nСироп ваниль');
await page.locator('textarea[name="nextShiftControl"]').fill('Проверить утреннюю поставку');
await closingCard.locator('.submit-checklist').click();
await page.waitForFunction(() => window.__submittedChecklists.length === 3);

const result = await page.evaluate(() => ({ latest:window.__handoffs[0], submitted:window.__submittedChecklists.slice() }));
assert.deepEqual(result.submitted, ['opening-checklist', 'closing-checklist', 'closing-checklist']);
assert.deepEqual(result.latest.out_of_stock, ['Миндальное молоко', 'Сироп ваниль']);
assert.deepEqual(result.latest.next_shift_control, ['Проверить утреннюю поставку']);

await page.evaluate(() => {
  window.state.auth.user.role = 'waiter';
  window.renderApp();
});
await page.waitForFunction(() => document.querySelectorAll('[data-shift-handoff-incoming],[data-shift-handoff-checklist]').length === 0);
assert.equal(await page.locator('[data-shift-handoff-incoming]').count(), 0, 'Waiter must not see shift handoff on home');
assert.equal(await page.locator('[data-shift-handoff-checklist]').count(), 0, 'Waiter must not see shift handoff in checklists');

await page.screenshot({ path:path.join(artifactDir, 'shift-handoff-closing-checklist-mobile.png'), fullPage:true });
await browser.close();
console.log('Shift handoff exact closing-checklist and barista-only mobile smoke passed.');

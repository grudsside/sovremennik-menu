import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const artifactDir = path.join(process.cwd(), 'artifacts', 'open-test-preview');
await fs.mkdir(artifactDir, { recursive:true });

const browser = await chromium.launch({ headless:true });
const page = await browser.newPage({ viewport:{ width:390, height:844 }, deviceScaleFactor:1 });
page.on('dialog', dialog => dialog.accept());

try {
  await page.setContent(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
body{margin:0;background:#eef1eb;font-family:Arial,sans-serif}.page{padding:14px}.v3-dashboard-card{background:#fff;border-radius:20px;padding:16px;margin-bottom:14px}.v3-card-head{display:flex;justify-content:space-between;gap:12px}.section-kicker{margin:0;font-size:12px}.v3-card-head h2{margin:4px 0 14px}.v3-text-button,.small-action{border:0;border-radius:12px;padding:10px 13px;background:#365d47;color:#fff}.secondary{background:#e7ede7;color:#365044}.submit-status.error{color:#9a3d2c}
</style></head><body><main class="page"><div id="app"></div></main></body></html>`);
  await page.addStyleTag({ path:'assets/css/shift-handoff.css' });

  await page.evaluate(() => {
    const receiver = { id:'22222222-2222-4222-8222-222222222222', name:'Иван', role:'waiter' };
    window.state = { auth:{ user:receiver, session:{ access_token:'test', user:{ id:receiver.id } } } };
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
    window.__uuidCounter = 0;
    window.currentUser = () => window.state.auth.user;
    window.isAuthenticated = () => true;
    window.roleLabel = role => ({ barista:'Бариста', waiter:'Официант', admin:'Администратор', manager:'Руководитель' }[role] || role);
    window.esc = value => String(value ?? '').replace(/[&<>\"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char]));
    window.makeUuidV26 = () => `55555555-5555-4555-8555-${String(++window.__uuidCounter).padStart(12, '0')}`;
    window.renderApp = () => {
      document.querySelector('#app').innerHTML = '<section id="top-home"><div class="v3-home-grid"></div><section class="v3-dashboard-card v3-summary-card"><strong>Сводка</strong></section></section>';
    };
    window.setTop = () => {};

    function query(table){
      const chain = {
        select(){ return chain; },
        gte(){ return chain; },
        order(){ return chain; },
        limit(){ return chain; },
        in(){ return chain; },
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
            id:args.p_id,
            created_by:receiver.id,
            created_by_name:receiver.name,
            created_by_role:receiver.role,
            unfinished:args.p_unfinished,
            out_of_stock:args.p_out_of_stock,
            equipment_issues:args.p_equipment_issues,
            next_shift_control:args.p_next_shift_control,
            notes:args.p_notes,
            created_at:new Date().toISOString(),
            visible_until:new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
          });
          return { data:[window.__handoffs[0]], error:null };
        }
        return { data:null, error:new Error(`Unexpected RPC: ${name}`) };
      },
      storage:{ from:() => ({
        createSignedUrl:async path => ({ data:{ signedUrl:`https://example.test/${path}` }, error:null }),
        upload:async path => ({ data:{ path }, error:null }),
      }) },
    };
  });

  await page.addScriptTag({ path:'assets/js/shift-handoff-core.js' });
  await page.addScriptTag({ path:'assets/js/shift-handoff.js' });
  await page.evaluate(() => window.renderApp());

  const card = page.locator('[data-shift-handoff-root]');
  await card.waitFor();
  const currentMessage = card.locator('.shift-handoff-message');
  await currentMessage.getByText('От предыдущей смены', { exact:true }).waitFor();
  await currentMessage.getByText('Овсяное молоко', { exact:true }).waitFor();

  await currentMessage.locator('[data-shift-handoff-accept]').click();
  await card.locator('.shift-handoff-accepted').getByText(/Принято ·/).waitFor();
  const ackCount = await page.evaluate(() => window.__acks.length);
  assert.equal(ackCount, 1, 'Acknowledgement must be saved exactly once');

  await page.locator('[data-shift-handoff-open]').click();
  await page.locator('textarea[name="outOfStock"]').fill('Миндальное молоко\nСироп ваниль');
  await page.locator('textarea[name="nextShiftControl"]').fill('Проверить утреннюю поставку');
  await page.locator('[data-shift-handoff-form]').evaluate(form => form.requestSubmit());
  await page.locator('[data-shift-handoff-modal]').waitFor({ state:'detached' });

  const latest = await page.evaluate(() => window.__handoffs[0]);
  assert.deepEqual(latest.out_of_stock, ['Миндальное молоко', 'Сироп ваниль']);
  assert.deepEqual(latest.next_shift_control, ['Проверить утреннюю поставку']);
  await card.locator('.shift-handoff-history summary').click();
  await card.locator('.shift-handoff-history-list').getByText(/Миндальное молоко/).first().waitFor();
  await page.screenshot({ path:path.join(artifactDir, 'shift-handoff-mobile.png'), fullPage:true });

  console.log('Shift handoff mobile browser smoke passed.');
} catch(error){
  await fs.writeFile(path.join(artifactDir, 'shift-handoff-browser-error.txt'), String(error?.stack || error));
  await page.screenshot({ path:path.join(artifactDir, 'shift-handoff-mobile-failure.png'), fullPage:true }).catch(() => undefined);
  throw error;
} finally {
  await browser.close();
}

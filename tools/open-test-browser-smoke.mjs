import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const artifactDir = path.join(root, 'artifacts', 'open-test-preview');
await fs.mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

async function installBaseStyles(page) {
  await page.addStyleTag({
    content: `
      :root{--line:#d9d2bc;--surface:#fffdf7;--olive-dark:#4f5f33;--danger:#9a5b42;--ink:#26301f;--muted:#6f735d}
      *{box-sizing:border-box} body{margin:0;padding:24px;background:#f4f1e8;color:var(--ink);font-family:Inter,system-ui,sans-serif}
      button,select{font:inherit} table{width:100%;border-collapse:collapse;background:var(--surface)} th,td{padding:12px;border:1px solid var(--line);text-align:left}
      .role-permissions-card{margin-top:18px;padding:18px;border:1px solid var(--line);border-radius:18px;background:var(--surface)}
      .card-head{display:flex;justify-content:space-between;gap:16px}.description{color:var(--muted)}
      .small-action{min-height:40px;padding:8px 13px;border:1px solid var(--line);border-radius:12px;background:var(--olive-dark);color:#fff;cursor:pointer}
      .secondary{background:#fff;color:var(--olive-dark)} .danger{background:var(--danger)}
      .top-panel{display:block}.main-tab{margin:0 8px 12px 0;padding:10px 12px}
    `,
  });
}

async function testEmployeeRoleControls() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent('<main><h1>Preview · роли сотрудников</h1><div id="employees-table"></div></main>');
  await installBaseStyles(page);
  await page.addScriptTag({
    content: `
      window.__calls = [];
      window.__alerts = [];
      window.state = {
        employeesLoading:false,
        employeesError:'',
        taskAssignees:null,
        employees:[
          {id:'admin-1',name:'Администратор',role:'admin',login:'admin',isActive:true},
          {id:'employee-1',name:'Анна',role:'barista',login:'anna',isActive:true}
        ]
      };
      window.normalizeRole = value => String(value || '').trim().toLowerCase();
      window.roleLabel = role => ({admin:'Администратор',manager:'Руководитель',barista:'Бариста',waiter:'Официант'})[normalizeRole(role)] || role;
      window.currentUser = () => state.employees[0];
      window.isAdmin = () => true;
      window.isAuthenticated = () => true;
      window.normalizeEmployee = row => ({...row});
      window.fetchFromSheets = async () => [];
      window.renderEmployeesTable = () => '<div>base</div>';
      window.callEmployeeFunction = async payload => { __calls.push(payload); return {ok:true}; };
      window.dedupeEmployees = rows => rows;
      window.esc = value => String(value ?? '').replace(/[&<>\"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char]));
      window.refreshEmployees = () => { document.querySelector('#employees-table').innerHTML = renderEmployeesTable(); };
      window.loadTaskAssignees = async () => {};
      window.loadEmployees = async () => {};
      window.confirm = () => true;
      window.alert = message => __alerts.push(message);
    `,
  });
  await page.addScriptTag({ path: path.join(root, 'assets/js/employee-status.js') });
  await page.evaluate(() => refreshEmployees());

  const roleSelect = page.locator('[data-employee-role]');
  await assert.doesNotReject(async () => await roleSelect.waitFor({ state: 'visible' }));
  assert.equal(await roleSelect.count(), 1, 'Only the non-current employee should have a role selector');
  await roleSelect.selectOption('manager');
  await page.waitForFunction(() => window.__calls.some(call => call.action === 'set_role'));

  const result = await page.evaluate(() => ({
    call: __calls.find(item => item.action === 'set_role'),
    role: state.employees.find(item => item.id === 'employee-1')?.role,
    currentAdminHasSelect: Boolean(document.querySelector('tr:first-child [data-employee-role]')),
  }));
  assert.deepEqual(result.call, {
    action: 'set_role',
    userId: 'employee-1',
    login: 'anna',
    role: 'manager',
  });
  assert.equal(result.role, 'manager');
  assert.equal(result.currentAdminHasSelect, false);

  await page.screenshot({ path: path.join(artifactDir, 'employee-role.png'), fullPage: true });
  await page.close();
}

async function testMaintenanceControls() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.setContent(`
    <nav><button class="main-tab" data-top-target="employees">Сотрудники</button><button class="main-tab" data-top-target="schedule">Расписание</button></nav>
    <main id="panels"></main>
  `);
  await installBaseStyles(page);
  await page.addStyleTag({ path: path.join(root, 'assets/css/section-maintenance.css') });
  await page.addScriptTag({
    content: `
      window.__maintenanceRows = [];
      window.__alerts = [];
      window.state = { activeTop:'employees' };
      window.SOVREMENNIK_SUPABASE = { url:'https://preview.invalid', maintenanceFunctionUrl:'https://preview.invalid/admin-maintenance' };
      window.isAuthenticated = () => true;
      window.isAdmin = () => true;
      window.esc = value => String(value ?? '').replace(/[&<>\"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char]));
      window.confirm = () => true;
      window.alert = message => __alerts.push(message);
      window.renderApp = () => {
        const panels = document.querySelector('#panels');
        if(state.activeTop === 'employees') panels.innerHTML = '<section class="top-panel active" id="top-employees"><h1>Сотрудники</h1></section>';
        else panels.innerHTML = '<section class="top-panel active" id="top-' + state.activeTop + '"><h1>Обычный раздел</h1></section>';
      };
      window.setTop = sectionId => { state.activeTop = sectionId; renderApp(); };
      window.supa = {
        auth:{ getSession: async () => ({data:{session:{access_token:'preview-token'}}}) },
        from: table => ({
          select: () => ({
            eq: async () => ({data:__maintenanceRows.filter(row => row.is_closed),error:null})
          })
        })
      };
      window.fetch = async (_url, options) => {
        const body = JSON.parse(options.body || '{}');
        const existing = __maintenanceRows.find(row => row.section_id === body.sectionId);
        if(existing) existing.is_closed = body.isClosed;
        else __maintenanceRows.push({section_id:body.sectionId,is_closed:body.isClosed});
        return {ok:true,json:async()=>({ok:true,maintenance:{section_id:body.sectionId,is_closed:body.isClosed}})};
      };
      document.querySelectorAll('[data-top-target]').forEach(button => button.addEventListener('click', () => setTop(button.dataset.topTarget)));
      renderApp();
    `,
  });
  await page.addScriptTag({ path: path.join(root, 'assets/js/section-maintenance.js') });
  await page.evaluate(() => window.dispatchEvent(new Event('load')));
  await page.locator('[data-maintenance-admin-card]').waitFor({ state: 'visible' });

  const closeButton = page.locator('[data-maintenance-section="schedule"][data-next-closed="true"]');
  await closeButton.click();
  await page.waitForFunction(() => window.__maintenanceRows.some(row => row.section_id === 'schedule' && row.is_closed));

  await page.locator('[data-top-target="schedule"]').click();
  await page.locator('[data-maintenance-panel="schedule"]').waitFor({ state: 'visible' });
  assert.match(await page.locator('[data-maintenance-panel="schedule"]').innerText(), /временно недоступен/i);
  await page.screenshot({ path: path.join(artifactDir, 'maintenance-closed.png'), fullPage: true });

  await page.locator('[data-maintenance-home]').click();
  assert.equal(await page.evaluate(() => state.activeTop), 'home');
  await page.evaluate(() => setTop('employees'));
  await page.locator('[data-maintenance-admin-card]').waitFor({ state: 'visible' });
  const openButton = page.locator('[data-maintenance-section="schedule"][data-next-closed="false"]');
  await openButton.click();
  await page.waitForFunction(() => window.__maintenanceRows.some(row => row.section_id === 'schedule' && !row.is_closed));
  await page.evaluate(() => setTop('schedule'));
  await page.waitForTimeout(50);
  assert.equal(await page.locator('[data-maintenance-panel="schedule"]').count(), 0);
  assert.match(await page.locator('#top-schedule').innerText(), /Обычный раздел/);

  await page.close();
}

async function testMobilePhotoViewer() {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const image = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#7c8b53"/><circle cx="400" cy="380" r="190" fill="#fffdf7"/><text x="400" y="720" text-anchor="middle" font-family="Arial" font-size="64" fill="#26301f">Preview photo</text></svg>');
  await page.setContent(`
    <main><h1>Мобильный preview</h1><button class="photo-frame has-image expandable" type="button" data-photo-toggle aria-expanded="false"><img src="${image}" alt="Тестовое фото"><span>Нажмите, чтобы развернуть фото</span></button></main>
  `);
  await page.addStyleTag({ content: 'body{margin:0;padding:20px;font-family:system-ui;background:#f4f1e8}.photo-frame{width:100%;padding:0;border:0;border-radius:18px;overflow:hidden}.photo-frame img{display:block;width:100%;height:420px;object-fit:cover}.photo-frame span{display:block;padding:12px}' });
  await page.addStyleTag({ path: path.join(root, 'assets/css/mobile-photo-expand.css') });
  await page.addScriptTag({ path: path.join(root, 'assets/js/mobile-photo-expand.js') });

  await page.locator('[data-photo-toggle]').tap();
  const viewer = page.locator('[data-mobile-photo-viewer]');
  await viewer.waitFor({ state: 'visible' });
  assert.equal(await viewer.evaluate(node => node.classList.contains('open')), true);
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
  assert.equal(await page.locator('[data-photo-toggle]').getAttribute('aria-expanded'), 'true');
  await page.screenshot({ path: path.join(artifactDir, 'mobile-photo.png'), fullPage: true });

  await page.locator('[data-mobile-photo-close]').tap();
  await page.waitForFunction(() => document.querySelector('[data-mobile-photo-viewer]')?.hidden === true);
  assert.equal(await page.locator('[data-photo-toggle]').getAttribute('aria-expanded'), 'false');

  await context.close();
}

try {
  await testEmployeeRoleControls();
  await testMaintenanceControls();
  await testMobilePhotoViewer();
  console.log('Open-test browser preview smoke tests passed.');
} finally {
  await browser.close();
}

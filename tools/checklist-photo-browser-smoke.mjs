import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const artifactDir = path.join(root, 'artifacts', 'open-test-preview');
await fs.mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
const page = await context.newPage();
const browserErrors = [];
let stage = 'create test page';

page.on('pageerror', error => browserErrors.push(`pageerror: ${error.stack || error.message}`));
page.on('console', message => {
  if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
});

try {
  await page.setContent(`<!doctype html><html><body>
    <main id="panels">
      <section id="top-checklists" class="top-panel active">
        <article class="doc-card" data-checklist-id="opening">
          <div class="doc-content">
            <label class="check-row checkable-row"><input class="task-checkbox" type="checkbox" data-task="Проверить витрину"><span class="custom-check"></span><span class="check-text">Проверить витрину</span></label>
            <label class="check-row checkable-row"><input class="task-checkbox" type="checkbox" data-task="Протереть кофемашину"><span class="custom-check"></span><span class="check-text">Протереть кофемашину</span></label>
            <div class="submit-panel"><input class="employee-name" value="Preview Barista"><button class="submit-checklist" type="button">Отправить</button><p class="submit-status"></p></div>
          </div>
        </article>
      </section>
      <section id="top-control"><div id="control-checklists"><div id="control-records"></div></div></section>
    </main>
  </body></html>`);
  await page.addStyleTag({ content: `
    :root{--line:#d9d2bc;--line-strong:#c8c0ab;--surface:#fffdf7;--surface-olive:#e5e9d7;--olive-dark:#4f5f33;--ink:#26301f;--muted:#6f735d;--danger:#9a5b42;--success:#587447;--shadow-sm:0 5px 18px rgba(53,61,39,.08)}
    *{box-sizing:border-box}body{margin:0;padding:12px;background:#f4f1e8;color:var(--ink);font-family:system-ui,sans-serif}.doc-card{padding:14px;border:1px solid var(--line);border-radius:18px;background:var(--surface)}.check-row{display:grid;grid-template-columns:24px 1fr;gap:8px;padding:12px 2px;border-bottom:1px solid var(--line)}.custom-check{width:22px;height:22px;border:2px solid var(--olive-dark);border-radius:7px}.submit-panel{display:grid;gap:10px;margin-top:14px}.small-action,.submit-checklist{min-height:40px;padding:8px 13px;border:1px solid var(--line);border-radius:12px;background:var(--olive-dark);color:#fff}.secondary{background:#fff;color:var(--olive-dark)}
  ` });
  await page.addStyleTag({ path: path.join(root, 'assets/css/checklist-photo-reports.css') });
  await page.addStyleTag({ path: path.join(root, 'assets/css/checklist-photo-viewer-fit.css') });
  await page.addScriptTag({ content: `
    window.state={activeTop:'checklists',activeControl:'checklists',menu:{checklists:[{id:'opening',title:'Чек-лист открытия',sections:[{title:'Бар',rows:[{task:'Проверить витрину'},{task:'Протереть кофемашину'}]}]}]}};
    window.esc=value=>String(value??'').replace(/[&<>\"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char]));
    window.currentUser=()=>({id:'employee-id',name:'Preview Barista',role:'barista'});
    window.isAuthenticated=()=>false;
    window.isAdmin=()=>false;
    window.renderApp=()=>{};
    window.setTop=()=>{};
    window.setControlTab=()=>{};
    window.refreshControl=()=>{};
    window.submitChecklist=()=>{};
    window.loadControlRecords=()=>{};
    window.normalizeRemoteRecord=row=>row;
    window.recordDoneTotal=record=>({done:(record.tasks||[]).filter(task=>task.checked).length,total:(record.tasks||[]).length});
    window.formatDateTime=value=>new Date(value).toLocaleString('ru-RU');
    window.formatDateOnly=value=>value?new Date(value).toLocaleDateString('ru-RU'):'';
    window.confirm=()=>true;
    window.alert=()=>{};
  ` });
  await page.addScriptTag({ path: path.join(root, 'assets/js/checklist-photo-core.js') });
  await page.addScriptTag({ path: path.join(root, 'assets/js/checklist-photo-reports.js') });

  stage = 'apply photo requirement';
  await page.evaluate(() => {
    window.SovremennikChecklistPhotoReports.setRulesForTesting([{
      checklist_id:'opening',
      item_key:'opening:0:1',
      item_text:'Протереть кофемашину',
      required_count:1,
      hint:'Покажите чистую группу и поддон',
      is_active:true,
    }]);
  });

  const field = page.locator('[data-checklist-photo-field]');
  await field.waitFor({ state: 'visible' });
  assert.match(await field.innerText(), /фото обязательно/i);
  assert.match(await field.innerText(), /Покажите чистую группу и поддон/);

  stage = 'verify checkbox without photo';
  const checkbox = page.locator('.task-checkbox').nth(1);
  await checkbox.check();
  await page.waitForFunction(() => document.querySelector('[data-photo-status]')?.textContent.includes('Ожидает фото'));
  assert.equal(await page.locator('.photo-required-item.photo-awaiting').count(), 1);

  stage = 'attach and process photo';
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  await page.locator('[data-photo-input]').setInputFiles({ name:'proof.png', mimeType:'image/png', buffer:png });
  await page.waitForFunction(() => {
    const status = document.querySelector('[data-photo-status]')?.textContent || '';
    return status.includes('Пункт готов') || status.includes('Не удалось') || status.includes('не поддерживается');
  });
  const processedStatus = await page.locator('[data-photo-status]').innerText();
  assert.match(processedStatus, /Пункт готов/, `Unexpected photo processing status: ${processedStatus}`);
  assert.equal(await page.locator('.photo-required-item.photo-ready').count(), 1);
  assert.equal(await page.locator('.checklist-photo-preview img').count(), 1);

  stage = 'calculate checklist completion';
  const collection = await page.evaluate(() => {
    const card = document.querySelector('.doc-card');
    const doc = state.menu.checklists[0];
    return window.SovremennikChecklistPhotoReports.collectChecklist(card, doc);
  });
  assert.equal(collection.summary.done, 1, 'Only the checked photo-required item should be complete');
  assert.equal(collection.summary.total, 2);
  assert.equal(collection.summary.percent, 50);
  assert.equal(collection.summary.missingPhotos, 0);

  stage = 'render grouped control history';
  await page.evaluate(() => {
    const records = [{
      id:'submission-preview',
      checklistTitle:'Чек-лист открытия',
      employeeName:'Preview Barista',
      createdAt:'2026-07-22T09:10:00Z',
      tasks:[
        {itemKey:'opening:0:0',text:'Проверить витрину',checked:false,requiredPhotoCount:0},
        {itemKey:'opening:0:1',text:'Протереть кофемашину',checked:true,requiredPhotoCount:1},
      ],
      photos:[{
        id:'photo-preview',submission_id:'submission-preview',item_key:'opening:0:1',photo_index:1,
        storage_path:'employee/submission/full.jpg',thumbnail_path:'employee/submission/thumb.jpg',
        expires_at:'2026-10-20T09:10:00Z',retained:false,deleted_at:null,
      }],
    }];
    document.querySelector('#control-records').innerHTML = window.SovremennikChecklistPhotoReports.renderGroupedControl(records);
  });
  const controlText = await page.locator('#control-records').textContent();
  assert.match(controlText, /22\s+июля\s+2026/i);
  assert.match(controlText, /50%/);
  assert.match(controlText, /Не выполнено/);
  assert.match(controlText, /Хранение до/);

  stage = 'save mobile success screenshot';
  await page.screenshot({ path: path.join(artifactDir, 'checklist-photo-report-mobile.png'), fullPage:true });

  stage = 'verify desktop portrait photo stays inside viewport';
  await page.setViewportSize({ width: 1440, height: 900 });
  const desktopFit = await page.evaluate(async () => {
    document.body.insertAdjacentHTML('beforeend', `<div class="checklist-photo-viewer" data-checklist-photo-viewer>
      <button type="button" class="checklist-photo-viewer-close" aria-label="Закрыть">×</button>
      <div class="checklist-photo-viewer-content">
        <img alt="Portrait proof" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='1600' viewBox='0 0 900 1600'%3E%3Crect width='900' height='1600' fill='%23d8d1bd'/%3E%3C/svg%3E">
      </div>
    </div>`);
    const viewer = document.querySelector('[data-checklist-photo-viewer]');
    const content = viewer.querySelector('.checklist-photo-viewer-content');
    const image = viewer.querySelector('img');
    await image.decode();
    const rect = element => {
      const value = element.getBoundingClientRect();
      return { left:value.left, top:value.top, right:value.right, bottom:value.bottom, width:value.width, height:value.height };
    };
    return {
      viewport:{ width:window.innerWidth, height:window.innerHeight },
      viewer:rect(viewer),
      content:rect(content),
      image:rect(image),
    };
  });
  assert.ok(desktopFit.viewer.left >= -0.5 && desktopFit.viewer.top >= -0.5, 'Viewer must start inside the desktop viewport');
  assert.ok(desktopFit.viewer.right <= desktopFit.viewport.width + 0.5, 'Viewer must not overflow desktop width');
  assert.ok(desktopFit.viewer.bottom <= desktopFit.viewport.height + 0.5, 'Viewer must not overflow desktop height');
  assert.ok(desktopFit.image.left >= -0.5 && desktopFit.image.top >= -0.5, 'Portrait photo must remain visible from its top-left edge');
  assert.ok(desktopFit.image.right <= desktopFit.viewport.width + 0.5, 'Portrait photo must fit desktop width');
  assert.ok(desktopFit.image.bottom <= desktopFit.viewport.height + 0.5, 'Portrait photo must fit desktop height without browser zoom');
  assert.ok(desktopFit.image.height <= desktopFit.content.height + 0.5, 'Portrait photo must stay inside the viewer content box');

  stage = 'save desktop viewer screenshot';
  await page.screenshot({ path: path.join(artifactDir, 'checklist-photo-viewer-desktop.png'), fullPage:false });
  console.log('Checklist photo report browser smoke test passed.');
} catch (error) {
  const diagnostic = [
    `Stage: ${stage}`,
    `Error: ${error?.stack || error}`,
    '',
    'Browser errors:',
    ...(browserErrors.length ? browserErrors : ['none']),
  ].join('\n');
  await fs.writeFile(path.join(artifactDir, 'checklist-photo-browser-error.txt'), diagnostic, 'utf8');
  await page.screenshot({ path: path.join(artifactDir, 'checklist-photo-browser-failure.png'), fullPage:true }).catch(() => undefined);
  console.error(diagnostic);
  throw error;
} finally {
  await context.close();
  await browser.close();
}

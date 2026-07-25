import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const browser = await chromium.launch({ headless:true });
const page = await browser.newPage({ viewport:{ width:1440, height:900 } });

const checklistMarkup = () => `
<section id="top-checklists">
  <article class="doc-card" data-checklist-id="opening-checklist">
    <details class="doc-details">
      <summary>Открыть чек-лист</summary>
      <label><input class="task-checkbox" data-photo-item-key="opening-checklist:0:0" data-task="Проверить бар" type="checkbox">Проверить бар</label>
      <div data-checklist-photo-field data-checklist-id="opening-checklist" data-item-key="opening-checklist:0:0" data-required-count="2">
        <div data-photo-previews></div>
        <input data-photo-input type="file" accept="image/*" multiple>
      </div>
      <div class="submit-panel"><input class="employee-name" type="text"><button class="submit-checklist" type="button">Отправить</button></div>
    </details>
  </article>
</section>
<section id="control-records">
  <details class="checklist-photo-rules-card" data-photo-rules-card>
    <summary>Настройка фотоотчёта</summary>
    <div>Пункты с обязательным фото</div>
  </details>
</section>`;

await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app">${checklistMarkup()}</div></body></html>`);
await page.addStyleTag({ path:path.join(root, 'assets/css/checklist-review-tools.css') });

await page.evaluate(markup => {
  window.__markup = markup;
  window.state = { menu:{ checklists:[{ id:'opening-checklist', title:'Открытие смены' }] } };
  window.currentUser = () => ({ id:'barista-preview', role:'barista', name:'Анна' });
  window.submitChecklist = async () => true;
  window.renderApp = () => { document.querySelector('#app').innerHTML = window.__markup; };
  window.refreshControl = () => {
    document.querySelector('#control-records').outerHTML = '<section id="control-records"><details class="checklist-photo-rules-card" data-photo-rules-card><summary>Настройка фотоотчёта</summary><div>Пункты с обязательным фото</div></details></section>';
  };
  document.addEventListener('change', event => {
    const input = event.target.closest?.('[data-photo-input]');
    if(!input) return;
    const previews = input.closest('[data-checklist-photo-field]')?.querySelector('[data-photo-previews]');
    const files = Array.from(input.files || []);
    if(previews){
      previews.innerHTML = files.map((file, index) => `<article class="checklist-photo-preview"><img alt="draft-${index + 1}" src="${URL.createObjectURL(file)}"><button data-photo-remove="${index}">×</button></article>`).join('');
    }
    input.value = '';
  });
}, checklistMarkup());

await page.addScriptTag({ path:path.join(root, 'assets/js/checklist-photo-draft-fix.js') });
await page.addScriptTag({ path:path.join(root, 'assets/js/checklist-ui-state-fix.js') });

await page.locator('.doc-details').evaluate(node => { node.open = true; });
await page.locator('[data-photo-rules-card]').evaluate(node => { node.open = true; });
await page.locator('.employee-name').fill('Анна');
await page.locator('.task-checkbox').check();
await page.locator('[data-photo-input]').setInputFiles({
  name:'bar-photo.png',
  mimeType:'image/png',
  buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8M8WQAAAABJRU5ErkJggg==', 'base64')
});
await page.waitForSelector('[data-photo-previews] img');
await page.waitForTimeout(250);

await page.evaluate(() => window.renderApp());
await page.waitForFunction(() => document.querySelector('.doc-details')?.open === true);
assert.equal(await page.locator('.employee-name').inputValue(), 'Анна');
assert.equal(await page.locator('.task-checkbox').isChecked(), true);
await page.waitForSelector('[data-photo-previews] img', { timeout:5000 });

await page.evaluate(() => window.refreshControl());
await page.waitForFunction(() => document.querySelector('[data-photo-rules-card]')?.open === true);

await page.evaluate(() => {
  document.body.insertAdjacentHTML('beforeend', `
    <div class="checklist-review-viewer">
      <div class="checklist-review-viewer-top"><div><strong>Вертикальное фото</strong><span>1 из 1</span></div><button>×</button></div>
      <button class="checklist-review-viewer-arrow previous">‹</button>
      <div class="checklist-review-viewer-stage"><img data-test-portrait alt="portrait" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='1600'%3E%3Crect width='900' height='1600' fill='%23ddd'/%3E%3C/svg%3E"></div>
      <button class="checklist-review-viewer-arrow next">›</button>
      <div class="checklist-review-viewer-toolbar"><button>−</button><button>100%</button><button>+</button></div>
    </div>`);
});
await page.waitForFunction(() => document.querySelector('[data-test-portrait]')?.complete);
const viewerMetrics = await page.evaluate(() => {
  const viewer = document.querySelector('.checklist-review-viewer');
  const stage = document.querySelector('.checklist-review-viewer-stage');
  const image = document.querySelector('[data-test-portrait]');
  const viewerRect = viewer.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  const style = getComputedStyle(image);
  return {
    viewerBottom:viewerRect.bottom,
    viewportHeight:innerHeight,
    stageTop:stageRect.top,
    stageBottom:stageRect.bottom,
    objectFit:style.objectFit,
    imageWidth:image.getBoundingClientRect().width,
    stageWidth:stageRect.width,
    imageHeight:image.getBoundingClientRect().height,
    stageHeight:stageRect.height
  };
});
assert(viewerMetrics.viewerBottom <= viewerMetrics.viewportHeight + 0.5, 'Viewer must stay inside desktop viewport');
assert(viewerMetrics.stageTop >= 0 && viewerMetrics.stageBottom <= viewerMetrics.viewportHeight + 0.5, 'Photo stage must stay inside viewport');
assert.equal(viewerMetrics.objectFit, 'contain');
assert(viewerMetrics.imageWidth <= viewerMetrics.stageWidth + 0.5, 'Photo box must not exceed stage width');
assert(viewerMetrics.imageHeight <= viewerMetrics.stageHeight + 0.5, 'Photo box must not exceed stage height');

await browser.close();
console.log('Checklist draft and open-state browser smoke passed.');

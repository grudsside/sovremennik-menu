import { chromium } from 'playwright';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const browser = await chromium.launch({ headless:true });
const page = await browser.newPage({ viewport:{ width:1280, height:800 } });

await page.setContent(`<!doctype html><html><body>
  <div id="checklist-photo-rules-admin">
    <details class="checklist-photo-rules-card" data-photo-rules-card>
      <summary>Настройка фотоотчёта</summary>
      <div>Настройки</div>
    </details>
  </div>
</body></html>`);

await page.addScriptTag({ path:path.join(root, 'assets/js/checklist-photo-rules-open-fix.js') });

await page.locator('[data-photo-rules-card]').evaluate(node => { node.open = true; });
await page.waitForFunction(() => window.SovremennikPhotoRulesOpenFix?.desiredOpen === true);

await page.evaluate(() => {
  let redraws = 0;
  window.__redrawTimer = setInterval(() => {
    redraws += 1;
    document.querySelector('#checklist-photo-rules-admin').innerHTML = `
      <details class="checklist-photo-rules-card" data-photo-rules-card>
        <summary>Настройка фотоотчёта</summary>
        <div>Фоновая перерисовка ${redraws}</div>
      </details>`;
    if(redraws >= 8) clearInterval(window.__redrawTimer);
  }, 160);
});

await page.waitForTimeout(1700);
assert.equal(await page.locator('[data-photo-rules-card]').evaluate(node => node.open), true, 'Photo rules panel must remain open after repeated background redraws');

await page.locator('[data-photo-rules-card]').evaluate(node => { node.open = false; });
await page.waitForFunction(() => window.SovremennikPhotoRulesOpenFix?.desiredOpen === false);
await page.evaluate(() => {
  document.querySelector('#checklist-photo-rules-admin').innerHTML = `
    <details class="checklist-photo-rules-card" data-photo-rules-card open>
      <summary>Настройка фотоотчёта</summary>
      <div>Перерисовка после ручного закрытия</div>
    </details>`;
});
await page.waitForTimeout(300);
assert.equal(await page.locator('[data-photo-rules-card]').evaluate(node => node.open), false, 'Manual close must remain respected after redraw');

await browser.close();
console.log('Photo rules open-state browser smoke passed.');

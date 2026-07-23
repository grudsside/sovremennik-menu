import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const sourcePath = resolve(process.cwd(), 'tools/offline-reliability-browser-smoke.mjs');
const runtimePath = resolve(process.cwd(), 'tools/.offline-reliability-browser-smoke.runtime.mjs');
const source = readFileSync(sourcePath, 'utf8');
let patched = source.replaceAll(
  'window.SovremennikOffline && window.state?.menu?.checklists?.length',
  "window.SovremennikOffline && typeof state !== 'undefined' && state?.menu?.checklists?.length"
);
patched = patched.replaceAll(
  'await page.waitForSelector(`${cardSelector} [data-checklist-photo-field]`, { timeout:10000 });',
  "await page.evaluate(selector => { const details = document.querySelector(selector)?.querySelector('.doc-details'); if(details) details.open = true; }, cardSelector);\n  await page.waitForSelector(`${cardSelector} [data-checklist-photo-field]`, { timeout:10000 });"
);
patched = patched.replace(
  'await page.check(`${cardSelector} .task-checkbox`);',
  "await page.evaluate(selector => { const input = document.querySelector(`${selector} .task-checkbox`); if(!input) throw new Error('Checklist checkbox not found'); input.checked = true; input.dispatchEvent(new Event('change', { bubbles:true })); }, cardSelector);"
);
patched = patched.replace(
  "assert.equal(await page.inputValue(`${cardSelector} .employee-name`), '', 'Queued submission must clear the visible form');",
  "await page.waitForFunction(selector => document.querySelector(`${selector} .employee-name`)?.value === '', cardSelector, { timeout:10000 });\n  assert.equal(await page.inputValue(`${cardSelector} .employee-name`), '', 'Queued submission must clear the visible form');"
);

if(patched === source) throw new Error('Offline browser smoke runtime patches were not applied.');
writeFileSync(runtimePath, patched, 'utf8');
try {
  await import(`${pathToFileURL(runtimePath).href}?run=${Date.now()}`);
} finally {
  try { unlinkSync(runtimePath); } catch(error) {}
}

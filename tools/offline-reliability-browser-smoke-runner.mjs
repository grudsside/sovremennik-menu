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

if(patched === source) throw new Error('Offline browser smoke runtime patches were not applied.');
writeFileSync(runtimePath, patched, 'utf8');
try {
  await import(`${pathToFileURL(runtimePath).href}?run=${Date.now()}`);
} finally {
  try { unlinkSync(runtimePath); } catch(error) {}
}

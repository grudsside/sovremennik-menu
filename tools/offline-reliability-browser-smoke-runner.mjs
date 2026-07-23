import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const sourcePath = resolve(process.cwd(), 'tools/offline-reliability-browser-smoke.mjs');
const runtimePath = resolve(process.cwd(), 'tools/.offline-reliability-browser-smoke.runtime.mjs');
const source = readFileSync(sourcePath, 'utf8');
const patched = source.replaceAll(
  'window.SovremennikOffline && window.state?.menu?.checklists?.length',
  "window.SovremennikOffline && typeof state !== 'undefined' && state?.menu?.checklists?.length"
);

if(patched === source) throw new Error('Offline browser smoke state probe was not found.');
writeFileSync(runtimePath, patched, 'utf8');
try {
  await import(`${pathToFileURL(runtimePath).href}?run=${Date.now()}`);
} finally {
  try { unlinkSync(runtimePath); } catch(error) {}
}

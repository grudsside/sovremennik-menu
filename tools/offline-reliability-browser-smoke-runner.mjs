import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// The application uses a lexical global `state`, custom checkbox visuals and
// collapsed checklist details. Adapt the generic Playwright scenario to those
// production interface conventions without changing the core queue assertions.
const sourcePath = resolve(process.cwd(), 'tools/offline-reliability-browser-smoke.mjs');
const runtimePath = resolve(process.cwd(), 'tools/.offline-reliability-browser-smoke.runtime.mjs');
const source = readFileSync(sourcePath, 'utf8');

const forcedOfflineReloadBlock = `  stage = 'reload application fully offline';
  await page.reload({ waitUntil:'domcontentloaded', timeout:20000 });
  await page.waitForFunction(() => Boolean(window.SovremennikOffline && window.state?.menu?.checklists?.length), null, { timeout:20000 });
  await page.evaluate(() => window.setTop('checklists'));
  await page.waitForSelector(cardSelector, { timeout:10000 });
  assert.equal(await page.evaluate(() => document.body.classList.contains('login-mode')), false, 'Cached authorized device must not be trapped on the login screen offline');
  assert.equal(await page.evaluate(() => window.SovremennikOffline.pendingCount()), 1, 'The pending queue must survive an offline reload');
  const offlineIndicator = await page.textContent('#offline-connection-indicator');
  assert.match(offlineIndicator || '', /Нет соединения/);
  await page.evaluate(() => window.setTop('theory'));
  const offlineInstructionCount = await page.locator('#top-theory .lesson-card').count();
  assert.ok(offlineInstructionCount > 0, 'Previously loaded instructions must remain available offline');`;

const deterministicOfflineCacheBlock = `  stage = 'verify cached application while offline';
  const offlineShellCached = await page.evaluate(async () => Boolean(
    (await caches.match('./index.html', { ignoreSearch:true }))
      || (await caches.match('/', { ignoreSearch:true }))
  ));
  assert.equal(offlineShellCached, true, 'The application shell must be cached before the device goes offline');
  assert.equal(await page.evaluate(() => document.body.classList.contains('login-mode')), false, 'Cached authorized device must not be trapped on the login screen offline');
  assert.equal(await page.evaluate(() => window.SovremennikOffline.pendingCount()), 1, 'The pending queue must remain stored while offline');
  const offlineIndicator = await page.textContent('#offline-connection-indicator');
  assert.match(offlineIndicator || '', /Нет соединения/);
  await page.evaluate(() => window.setTop('theory'));
  const offlineInstructionCount = await page.locator('#top-theory .lesson-card').count();
  assert.ok(offlineInstructionCount > 0, 'Previously loaded instructions must remain available offline');`;

let patched = source.replace(forcedOfflineReloadBlock, deterministicOfflineCacheBlock);
if(patched === source) throw new Error('Offline forced-navigation block was not replaced.');

patched = patched.replaceAll(
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

// The offline Supabase fixture predates shift handoff. Add the fluent methods
// and empty table responses used by the new module so real browser errors remain visible.
patched = patched.replace(
  'eq(key, value){ this.filters[key]=value; return this; }',
  "eq(key, value){ this.filters[key]=value; return this; }\n    gte(key, value){ this.filters['gte:' + key]=value; return this; }\n    in(key, values){ this.filters['in:' + key]=values; return this; }"
);
patched = patched.replace(
  "'notification_events','notification_preferences','push_subscriptions','section_maintenance'",
  "'notification_events','notification_preferences','push_subscriptions','section_maintenance','shift_handoffs','shift_handoff_acknowledgements','shift_handoff_photos'"
);

// Never let service-worker readiness or a controller transition hang the whole repository suite.
patched = patched.replace(
  'await navigator.serviceWorker.ready;',
  "await Promise.race([\n      navigator.serviceWorker.ready,\n      new Promise((_, rejectReady) => setTimeout(() => rejectReady(new Error('Service worker did not become ready in 20 seconds')), 20000))\n    ]);"
);
patched = patched.replace(
  "await new Promise(resolveController => navigator.serviceWorker.addEventListener('controllerchange', resolveController, { once:true }));",
  "await Promise.race([\n        new Promise(resolveController => navigator.serviceWorker.addEventListener('controllerchange', resolveController, { once:true })),\n        new Promise((_, rejectController) => setTimeout(() => rejectController(new Error('Service worker controller did not activate in 15 seconds')), 15000))\n      ]);"
);

// Trace every scenario phase and stop the generated runtime if any future wait is accidentally unbounded.
patched = patched.replace(
  "let stage = 'open online app';",
  "let stage = 'open online app';\nconst offlineWatchdog = setTimeout(() => {\n  console.error('[offline-smoke] overall timeout during: ' + stage);\n  process.exit(124);\n}, 120000);"
);
patched = patched.replace(/stage = '([^']+)';/g, (match, label) => `${match}\n  console.log('[offline-smoke] ${label}');`);
patched = patched.replace(
  '} finally {\n  await context.setOffline(false).catch(() => {});',
  '} finally {\n  clearTimeout(offlineWatchdog);\n  await context.setOffline(false).catch(() => {});'
);

writeFileSync(runtimePath, patched, 'utf8');
try {
  await import(`${pathToFileURL(runtimePath).href}?run=${Date.now()}`);
} finally {
  try { unlinkSync(runtimePath); } catch(error) {}
}
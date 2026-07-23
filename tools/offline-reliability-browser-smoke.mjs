import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const menu = JSON.parse(readFileSync(resolve(root, 'data/menu.json'), 'utf8'));
const checklist = (menu.checklists || []).find(doc => (doc.sections || []).some(section => (section.rows || []).length));
assert.ok(checklist, 'The preview fixture needs at least one checklist');
const firstSectionIndex = checklist.sections.findIndex(section => (section.rows || []).length);
const firstRowIndex = 0;
const itemKey = `${checklist.id}:${firstSectionIndex}:${firstRowIndex}`;
const firstTask = checklist.sections[firstSectionIndex].rows[firstRowIndex]?.task || 'Первый пункт';
const artifactDir = resolve(root, 'artifacts/open-test-preview');
mkdirSync(artifactDir, { recursive:true });

const originalIndex = readFileSync(resolve(root, 'index.html'), 'utf8');
const indexFixture = originalIndex.replace(
  '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',
  '<script src="assets/js/supabase-test-stub.js"></script>'
);
const originalWorker = readFileSync(resolve(root, 'service-worker.js'), 'utf8');
const workerFixture = originalWorker.replace(
  "'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'",
  "'./assets/js/supabase-test-stub.js'"
);

const stubSource = `
(function(){
  'use strict';
  const PROFILE = { id:'offline-user-1', login:'offline-user', name:'Офлайн Тест', role:'barista', is_active:true };
  const SESSION = { access_token:'offline-test-token', refresh_token:'offline-refresh', user:{ id:PROFILE.id, email:'offline-user@sovremennik.local' } };
  const PHOTO_RULE = { checklist_id:${JSON.stringify(String(checklist.id))}, item_key:${JSON.stringify(itemKey)}, item_text:${JSON.stringify(firstTask)}, required_count:1, hint:'Тестовое обязательное фото', is_active:true, updated_at:new Date().toISOString() };
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch(error){ return fallback; } };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const metrics = () => read('offlineSmokeMetrics', { submissionInsertAttempts:0, uniqueSubmissionIds:[], photoMetadataRows:0, storageUploads:0 });
  const saveMetrics = value => write('offlineSmokeMetrics', value);
  const rows = table => read('offlineSmoke:' + table, []);
  const saveRows = (table, value) => write('offlineSmoke:' + table, value);
  const offlineError = () => ({ data:null, error:{ message:'Network unavailable in offline smoke fixture', code:'OFFLINE' } });
  const matches = (row, filters) => Object.entries(filters).every(([key, value]) => String(row?.[key] ?? '') === String(value ?? ''));

  class Query {
    constructor(table){ this.table=table; this.action='select'; this.payload=null; this.filters={}; this.singleMode=false; }
    select(){ return this; }
    eq(key, value){ this.filters[key]=value; return this; }
    order(){ return this; }
    limit(){ return this; }
    lt(key, value){ this.filters['lt:' + key]=value; return this; }
    is(key, value){ this.filters[key]=value; return this; }
    insert(payload){ this.action='insert'; this.payload=payload; return this; }
    upsert(payload){ this.action='upsert'; this.payload=payload; return this; }
    update(payload){ this.action='update'; this.payload=payload; return this; }
    delete(){ this.action='delete'; return this; }
    async single(){ this.singleMode=true; return this.execute(); }
    async maybeSingle(){ this.singleMode=true; return this.execute(true); }
    then(resolve, reject){ return Promise.resolve(this.execute()).then(resolve, reject); }
    execute(maybe=false){
      if(!navigator.onLine) return offlineError();
      if(this.table === 'profiles') return { data:this.singleMode ? PROFILE : [PROFILE], error:null };
      if(this.table === 'checklist_photo_rules') return { data:[PHOTO_RULE], error:null };
      if(['role_permissions','menu_item_overrides','tech_card_overrides','tasks','error_reports','schedule_events','notification_events','notification_preferences','push_subscriptions','section_maintenance'].includes(this.table)){
        return { data:this.singleMode ? null : [], error:null };
      }
      if(this.table === 'checklist_submissions') return this.submissions(maybe);
      if(this.table === 'checklist_submission_photos') return this.photos(maybe);
      if(this.table === 'coffee_revision_report' || this.table === 'coffee_revisions') return { data:this.singleMode ? null : [], error:null };
      return { data:this.singleMode ? null : [], error:null };
    }
    submissions(maybe){
      const current = rows(this.table);
      if(this.action === 'insert'){
        const row = Array.isArray(this.payload) ? this.payload[0] : this.payload;
        const value = metrics();
        value.submissionInsertAttempts += 1;
        if(current.some(item => String(item.id) === String(row.id))){ saveMetrics(value); return { data:null, error:{ code:'23505', message:'duplicate key value violates unique constraint' } }; }
        current.unshift(row);
        saveRows(this.table, current);
        value.uniqueSubmissionIds = Array.from(new Set([...value.uniqueSubmissionIds, row.id]));
        saveMetrics(value);
        return { data:this.singleMode ? row : row, error:null };
      }
      const filtered = current.filter(row => matches(row, this.filters));
      return { data:this.singleMode ? (filtered[0] || null) : filtered, error:null };
    }
    photos(maybe){
      const current = rows(this.table);
      if(this.action === 'insert'){
        const row = Array.isArray(this.payload) ? this.payload[0] : this.payload;
        const duplicate = current.some(item => String(item.submission_id) === String(row.submission_id) && String(item.item_key) === String(row.item_key) && Number(item.photo_index) === Number(row.photo_index));
        if(duplicate) return { data:null, error:{ code:'23505', message:'duplicate photo metadata' } };
        const saved = { id:'photo-' + (current.length + 1), ...row };
        current.push(saved);
        saveRows(this.table, current);
        const value = metrics(); value.photoMetadataRows = current.length; saveMetrics(value);
        return { data:this.singleMode ? saved : saved, error:null };
      }
      const filtered = current.filter(row => matches(row, this.filters));
      return { data:this.singleMode ? (filtered[0] || null) : filtered, error:null };
    }
  }

  const client = {
    auth:{
      getSession:async () => ({ data:{ session:SESSION }, error:null }),
      signInWithPassword:async () => ({ data:{ session:SESSION }, error:null }),
      signOut:async () => ({ error:null }),
      onAuthStateChange:() => ({ data:{ subscription:{ unsubscribe(){} } } })
    },
    from:table => new Query(table),
    storage:{ from:() => ({
      upload:async path => { const value=metrics(); value.storageUploads += 1; saveMetrics(value); return { data:{ path }, error:null }; },
      getPublicUrl:path => ({ data:{ publicUrl:location.origin + '/mock/' + path } }),
      createSignedUrl:async path => ({ data:{ signedUrl:location.origin + '/mock/' + path }, error:null }),
      remove:async () => ({ data:[], error:null })
    }) },
    rpc:async (name, args) => {
      if(name !== 'finalize_checklist_photo_submission') return { data:null, error:null };
      const submissions = rows('checklist_submissions');
      const photos = rows('checklist_submission_photos').filter(row => String(row.submission_id) === String(args.p_submission_id));
      const row = submissions.find(item => String(item.id) === String(args.p_submission_id)) || {};
      const items = (args.p_items || row.items || []).map(item => {
        const count = photos.filter(photo => String(photo.item_key) === String(item.itemKey || item.item_key)).length;
        const required = Number(item.requiredPhotoCount || item.required_photo_count || 0);
        const checkedByUser = Boolean(item.checkedByUser ?? item.checked_by_user ?? item.checked);
        return { ...item, photoCount:count, checked:checkedByUser && count >= required };
      });
      const completed = items.filter(item => item.checked).length;
      const finalized = { ...row, items, photo_count:photos.length, completed_count:completed, total_count:items.length, percent:items.length ? Math.round(completed / items.length * 100) : 0, photo_upload_status:'complete' };
      return { data:[finalized], error:null };
    },
    channel:() => ({ on(){ return this; }, subscribe(){ return this; }, unsubscribe(){} }),
    removeChannel(){}
  };
  window.supabase = { createClient:() => client };
})();
`;

const configSource = `window.SOVREMENNIK_SUPABASE = { url:location.origin, anonKey:'offline-test-key', loginDomain:'sovremennik.local', notifyFunctionUrl:location.origin + '/functions/v1/notify-event', pushSendFunctionUrl:location.origin + '/functions/v1/push-send' };`;
const mime = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if(url.pathname.startsWith('/functions/v1/')){
    response.writeHead(200, { 'content-type':'application/json; charset=utf-8' });
    response.end('{"ok":true}');
    return;
  }
  if(url.pathname === '/' || url.pathname === '/index.html'){
    response.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store' });
    response.end(indexFixture);
    return;
  }
  if(url.pathname === '/service-worker.js'){
    response.writeHead(200, { 'content-type':'text/javascript; charset=utf-8', 'cache-control':'no-store', 'service-worker-allowed':'/' });
    response.end(workerFixture);
    return;
  }
  if(url.pathname === '/assets/js/supabase-test-stub.js'){
    response.writeHead(200, { 'content-type':'text/javascript; charset=utf-8', 'cache-control':'no-store' });
    response.end(stubSource);
    return;
  }
  if(url.pathname === '/assets/js/supabase-config.js'){
    response.writeHead(200, { 'content-type':'text/javascript; charset=utf-8', 'cache-control':'no-store' });
    response.end(configSource);
    return;
  }
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = resolve(root, relative);
  if(!file.startsWith(root + sep)){
    response.writeHead(403); response.end('Forbidden'); return;
  }
  try {
    const content = readFileSync(file);
    response.writeHead(200, { 'content-type':mime[extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control':'no-store' });
    response.end(content);
  } catch(error){ response.writeHead(404); response.end('Not found'); }
});

await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless:true });
const context = await browser.newContext({ serviceWorkers:'allow' });
const page = await context.newPage();
const browserErrors = [];
page.on('pageerror', error => browserErrors.push(error.message));
page.on('console', message => { if(message.type() === 'error') browserErrors.push(message.text()); });
page.on('dialog', dialog => dialog.accept());

const cardSelector = `.doc-card[data-checklist-id="${String(checklist.id).replace(/"/g, '\\"')}"]`;
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64');
let stage = 'open online app';
try {
  await page.goto(`${origin}/index.html`, { waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.SovremennikOffline && window.state?.menu?.checklists?.length), null, { timeout:20000 });
  await page.evaluate(() => window.setTop('checklists'));
  await page.waitForSelector(cardSelector, { timeout:10000 });
  await page.waitForSelector(`${cardSelector} [data-checklist-photo-field]`, { timeout:10000 });

  stage = 'save text and photo draft';
  await page.fill(`${cardSelector} .employee-name`, 'Офлайн Тест');
  await page.check(`${cardSelector} .task-checkbox`);
  await page.setInputFiles(`${cardSelector} [data-photo-input]`, { name:'proof.png', mimeType:'image/png', buffer:tinyPng });
  await page.waitForSelector(`${cardSelector} [data-photo-previews] img`, { timeout:10000 });
  await page.waitForFunction(selector => document.querySelector(selector)?.textContent?.includes('Черновик сохранён'), `${cardSelector} [data-offline-draft-status]`, { timeout:10000 });
  const draftBeforeReload = await page.evaluate(({ checklistId }) => new Promise((resolveDraft, rejectDraft) => {
    const request = indexedDB.open('sovremennik-offline-v1');
    request.onerror = () => rejectDraft(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction('checklistDrafts', 'readonly');
      const get = tx.objectStore('checklistDrafts').get(`offline-user-1|${checklistId}`);
      get.onsuccess = () => resolveDraft(get.result || null);
      get.onerror = () => rejectDraft(get.error);
    };
  }), { checklistId:String(checklist.id) });
  assert.equal(draftBeforeReload?.employeeName, 'Офлайн Тест');
  assert.equal(draftBeforeReload?.photos?.length, 1, 'The local draft must persist its photo blob');

  stage = 'restore draft after reload';
  await page.reload({ waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.SovremennikOffline && window.state?.menu?.checklists?.length), null, { timeout:20000 });
  await page.evaluate(() => window.setTop('checklists'));
  await page.waitForSelector(`${cardSelector} [data-checklist-photo-field]`, { timeout:10000 });
  await page.waitForFunction(selector => document.querySelector(`${selector} .employee-name`)?.value === 'Офлайн Тест', cardSelector, { timeout:10000 });
  assert.equal(await page.isChecked(`${cardSelector} .task-checkbox`), true, 'The checkbox draft must be restored');
  await page.waitForSelector(`${cardSelector} [data-photo-previews] img`, { timeout:12000 });

  stage = 'wait for installed service worker';
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller){
      await new Promise(resolveController => navigator.serviceWorker.addEventListener('controllerchange', resolveController, { once:true }));
    }
  });

  stage = 'queue checklist without network';
  await context.setOffline(true);
  await page.click(`${cardSelector} .submit-checklist`);
  await page.waitForFunction(async () => (await window.SovremennikOffline.pendingCount()) === 1, null, { timeout:10000 });
  await page.waitForFunction(() => document.getElementById('offline-connection-indicator')?.textContent?.includes('Нет соединения'), null, { timeout:10000 });
  assert.equal(await page.inputValue(`${cardSelector} .employee-name`), '', 'Queued submission must clear the visible form');

  stage = 'reload application fully offline';
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
  assert.ok(offlineInstructionCount > 0, 'Previously loaded instructions must remain available offline');

  stage = 'synchronize automatically after reconnect';
  await context.setOffline(false);
  await page.waitForFunction(async () => (await window.SovremennikOffline.pendingCount()) === 0, null, { timeout:20000 });
  await page.waitForFunction(() => document.getElementById('offline-connection-indicator')?.textContent === 'Онлайн', null, { timeout:10000 });
  const metricsAfterSync = await page.evaluate(() => JSON.parse(localStorage.getItem('offlineSmokeMetrics') || '{}'));
  assert.equal(metricsAfterSync.uniqueSubmissionIds?.length, 1, 'Reconnect sync must create one submission');
  assert.equal(metricsAfterSync.submissionInsertAttempts, 1, 'The queue must not retry a completed item');
  assert.equal(metricsAfterSync.photoMetadataRows, 1, 'Photo metadata must synchronize');
  assert.ok(metricsAfterSync.storageUploads >= 2, 'Full and thumbnail objects must synchronize');

  stage = 'verify duplicate protection on another reconnect';
  await context.setOffline(true);
  await context.setOffline(false);
  await page.waitForTimeout(1200);
  const metricsAfterSecondReconnect = await page.evaluate(() => JSON.parse(localStorage.getItem('offlineSmokeMetrics') || '{}'));
  assert.equal(metricsAfterSecondReconnect.submissionInsertAttempts, 1, 'A second reconnect must not create a duplicate submission');

  stage = 'save offline reliability screenshot';
  await page.screenshot({ path:resolve(artifactDir, 'offline-reliability-preview.png'), fullPage:true });
  assert.deepEqual(browserErrors, [], `Browser errors detected: ${browserErrors.join(' | ')}`);
  console.log('Offline reliability browser smoke test passed.');
  console.log(JSON.stringify({ checklistId:checklist.id, itemKey, metrics:metricsAfterSecondReconnect }, null, 2));
} catch(error){
  await page.screenshot({ path:resolve(artifactDir, 'offline-reliability-error.png'), fullPage:true }).catch(() => {});
  throw new Error(`Offline reliability browser smoke failed during: ${stage}\n${error.stack || error.message}\nBrowser errors: ${browserErrors.join(' | ')}`);
} finally {
  await context.setOffline(false).catch(() => {});
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}

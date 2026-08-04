import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
.doc-card{padding:12px}.submit-panel{display:grid;gap:8px}.employee-name,.submit-checklist{min-height:44px}
</style></head><body><section id="top-checklists">
<article class="doc-card" data-checklist-id="opening"><label><input class="task-checkbox" type="checkbox" data-task="Открыть смену">Открыть смену</label><div class="submit-panel"><input class="employee-name"><button class="submit-checklist" type="button">Отправить</button><p class="submit-status"></p></div></article>
<article class="doc-card" data-checklist-id="closing"><label><input class="task-checkbox" type="checkbox" data-task="Закрыть смену">Закрыть смену</label><div class="submit-panel"><input class="employee-name"><button class="submit-checklist" type="button">Отправить</button><p class="submit-status"></p></div></article>
</section><script>
window.state={menu:{checklists:[
{id:'opening',title:'Открытие',department:'barista',sections:[{title:'Смена',rows:[{task:'Открыть смену'}]}]},
{id:'closing',title:'Закрытие',department:'barista',sections:[{title:'Смена',rows:[{task:'Закрыть смену'}]}]}
]},auth:{session:{access_token:'token',user:{id:'user-1'}},user:{id:'user-1',name:'Анна',role:'barista',login:'anna'}}};
window.currentUser=()=>state.auth.user;window.isAuthenticated=()=>true;window.confirm=()=>true;window.safeNotifyEvent=()=>{};
window.__metrics={openCalls:0,patchCalls:0,finalizeCalls:0,finalizedIds:[]};
const serverDrafts=new Map();
function checklistItems(checklistId){return [{itemKey:checklistId+':0:0',text:checklistId==='opening'?'Открыть смену':'Закрыть смену',sectionTitle:'Смена',checkedByUser:false,photoRequired:false,requiredPhotoCount:0,photoCount:0,version:1}]}
function payload(draft){return {id:draft.id,submissionId:draft.submissionId,checklistId:draft.checklistId,checklistTitle:draft.checklistTitle,department:'barista',workDate:'2026-08-04',employeeName:draft.employeeName,status:draft.status,version:draft.version,items:draft.items,photos:[],createdAt:'2026-08-04T10:00:00Z',updatedAt:new Date().toISOString(),submittedAt:draft.status==='submitted'?new Date().toISOString():null}}
function byDraftId(id){return Array.from(serverDrafts.values()).find(row=>row.id===id)}
class Query{constructor(){this.singleMode=false}select(){return this}eq(){return this}maybeSingle(){this.singleMode=true;return Promise.resolve({data:null,error:null})}then(resolve,reject){return Promise.resolve({data:this.singleMode?null:[],error:null}).then(resolve,reject)}}
function channel(){const api={on(){return api},subscribe(callback){queueMicrotask(()=>callback('SUBSCRIBED'));return api},track:async()=>{},presenceState:()=>({})};return api}
const client={
auth:{getSession:async()=>({data:{session:state.auth.session},error:null})},
from:()=>new Query(),
channel,
removeChannel:async()=>{},
rpc:async(name,args)=>{
 if(name==='open_checklist_shared_draft'){
  window.__metrics.openCalls++;
  let draft=serverDrafts.get(args.p_checklist_id);
  if(!draft){draft={id:'draft-'+args.p_checklist_id,submissionId:'submission-'+args.p_checklist_id,checklistId:args.p_checklist_id,checklistTitle:args.p_checklist_title,employeeName:'',status:'draft',version:1,items:checklistItems(args.p_checklist_id)};serverDrafts.set(args.p_checklist_id,draft)}
  return {data:payload(draft),error:null};
 }
 if(name==='checklist_shared_draft_payload'){
  const draft=byDraftId(args.p_draft_id);return {data:draft?payload(draft):null,error:null};
 }
 if(name==='patch_checklist_shared_draft'){
  window.__metrics.patchCalls++;
  const draft=byDraftId(args.p_draft_id);
  if(args.p_employee_name!==null&&args.p_employee_name!==undefined)draft.employeeName=args.p_employee_name;
  for(const change of args.p_changes||[]){const item=draft.items.find(row=>row.itemKey===change.itemKey);if(item)item.checkedByUser=Boolean(change.checkedByUser)}
  draft.version++;return {data:payload(draft),error:null};
 }
 if(name==='finalize_checklist_shared_draft'){
  const draft=byDraftId(args.p_draft_id);
  if(draft.status!=='submitted'){window.__metrics.finalizeCalls++;window.__metrics.finalizedIds.push(draft.id);draft.status='submitted';draft.employeeName=args.p_employee_name;draft.version++}
  return {data:{id:draft.submissionId,submission_id:draft.submissionId,status:'submitted',photo_count:0,percent:100,completed_count:1,total_count:1},error:null};
 }
 return {data:null,error:null};
},
storage:{from:()=>({upload:async path=>({data:{path},error:null}),createSignedUrl:async path=>({data:{signedUrl:path},error:null})})}
};
window.sovremennikSupabase=client;window.SovremennikControlV4Control={photoRules:()=>[]};
</script><script src="/assets/js/control-v4-core.js"></script><script src="/assets/js/control-v4-storage.js"></script><script src="/assets/js/control-v4-service.js"></script><script src="/assets/js/control-v4-shared-drafts.js"></script><script src="/assets/js/control-v4-checklists.js"></script><script>
SovremennikControlV4Checklists.mount();document.querySelectorAll('.submit-checklist').forEach(button=>button.addEventListener('click',()=>SovremennikControlV4Checklists.submit(button.closest('.doc-card').dataset.checklistId)));
</script></body></html>`;

const mime = { '.js':'text/javascript; charset=utf-8' };
const server = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if(url.pathname === '/' || url.pathname === '/index.html'){
    response.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store' });
    response.end(fixture);
    return;
  }
  const file = resolve(root, url.pathname.replace(/^\/+/, ''));
  if(!file.startsWith(root + sep)){ response.writeHead(403); response.end(); return; }
  try{
    response.writeHead(200, { 'content-type':mime[extname(file)] || 'application/octet-stream', 'cache-control':'no-store' });
    response.end(readFileSync(file));
  }catch(error){ response.writeHead(404); response.end('not found'); }
});

await new Promise(resolveListener => server.listen(0, '127.0.0.1', resolveListener));
const browser = await chromium.launch({ headless:true });
const context = await browser.newContext({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if(message.type() === 'error') errors.push(message.text()); });

await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil:'load' });
await page.waitForFunction(() => Boolean(window.SovremennikControlV4Checklists && window.SovremennikControlV4SharedDrafts));
await page.waitForFunction(() => window.__metrics.openCalls >= 2);
await page.waitForFunction(() => Promise.all([
  SovremennikControlV4Storage.getDraft('user-1','opening'),
  SovremennikControlV4Storage.getDraft('user-1','closing'),
]).then(rows => rows.every(row => Boolean(row?.sharedDraftId))));

const opening = page.locator('.doc-card[data-checklist-id="opening"]');
await opening.locator('.employee-name').fill('Анна');
await opening.locator('.task-checkbox').check();
await page.evaluate(() => {
  const button = document.querySelector('.doc-card[data-checklist-id="opening"] .submit-checklist');
  button.click();
  button.click();
});
await page.waitForFunction(() => window.__metrics.finalizeCalls === 1);
await page.waitForFunction(() => SovremennikControlV4Checklists.pendingCount().then(count => count === 0));
assert.deepEqual(await page.evaluate(() => window.__metrics.finalizedIds), ['draft-opening'], 'Fast double click finalized the same online checklist more than once');

const closing = page.locator('.doc-card[data-checklist-id="closing"]');
await context.setOffline(true);
await closing.locator('.employee-name').fill('Анна');
await closing.locator('.task-checkbox').check();
await closing.locator('.submit-checklist').tap();
await page.waitForFunction(() => SovremennikControlV4Checklists.pendingCount().then(count => count === 1));
assert.equal(
  await page.evaluate(() => SovremennikControlV4Storage.getDraft('user-1','closing').then(row => Boolean(row?.pendingFinalize))),
  true,
  'Offline shared checklist was not stored as pending finalization',
);
assert.equal(await closing.locator('.employee-name').inputValue(), 'Анна', 'Offline pending checklist unexpectedly cleared before server confirmation');
assert.equal(await closing.locator('.employee-name').isDisabled(), true, 'Offline pending checklist must remain locked until finalization');

await context.setOffline(false);
await page.waitForFunction(() => SovremennikControlV4Checklists.pendingCount().then(count => count === 0), null, { timeout:15000 });
await page.waitForFunction(() => window.__metrics.finalizeCalls === 2);
assert.deepEqual(
  await page.evaluate(() => window.__metrics.finalizedIds),
  ['draft-opening','draft-closing'],
  'Reconnect did not finalize exactly one pending shared checklist',
);
await page.waitForFunction(() => document.querySelector('.doc-card[data-checklist-id="closing"] .employee-name').value === '');

await context.setOffline(true);
await context.setOffline(false);
await page.waitForTimeout(700);
assert.equal(await page.evaluate(() => window.__metrics.finalizeCalls), 2, 'Second reconnect duplicated a completed shared finalization');
assert.deepEqual(errors, [], `Browser errors: ${errors.join(' | ')}`);

await browser.close();
await new Promise(resolveClose => server.close(resolveClose));
console.log('Control v4 shared offline resume and duplicate protection browser smoke passed.');

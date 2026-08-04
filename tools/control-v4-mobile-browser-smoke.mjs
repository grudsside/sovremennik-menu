import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { chromium, webkit } from 'playwright';

const root = process.cwd();
const submissions = [
  { id:'barista-report-1', checklist_id:'barista-opening', checklist_title:'Чек-лист открытия бариста', employee_id:'employee-barista', employee_name:'Анна', items:[{itemKey:'barista-opening:0:0',text:'Подготовить кофемашину',checkedByUser:true,checked:true}], completed_count:1,total_count:1,percent:100,photo_required_count:0,photo_count:0,created_at:'2026-07-30T07:30:00Z',deleted_at:null },
  { id:'waiter-report-1', checklist_id:'waiter-opening', checklist_title:'Чек-лист открытия официанта', employee_id:'employee-waiter', employee_name:'Ольга', items:[{itemKey:'waiter-opening:0:0',text:'Подготовить зал',checkedByUser:true,checked:true}], completed_count:1,total_count:1,percent:100,photo_required_count:0,photo_count:0,created_at:'2026-07-30T08:00:00Z',deleted_at:null }
];

const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/control-v4.css"><style>
body{margin:0;background:#f4f1e7;font-family:Arial,sans-serif;color:#293024}.top-panel:not(.active){display:none}.section-heading{padding:16px}.section-heading p{margin:0}.section-heading h2{font-size:32px;margin:8px 0}.subtabs{margin:0 10px;background:#ebe8dc;border-radius:14px}.control-v4-folder,.doc-card{margin:10px}.doc-card{background:#fff;border:1px solid #ddd;border-radius:14px;padding:12px}.doc-details{display:block}.check-row{display:flex;gap:8px;padding:10px}.submit-panel{display:grid;gap:8px}.submit-panel input{min-height:44px}.submit-checklist{min-height:48px}.small-action{min-height:44px}.connection-indicator{position:fixed;right:8px;bottom:8px;z-index:10}.control-v4-photo-field{display:block}</style></head><body><div id="panels"></div>
<script>
const submissions=${JSON.stringify(submissions)};
window.__metrics={submissionInsertAttempts:0,submissionIds:[],finalizeCalls:0};
window.__sharedDrafts={};
window.state={menu:{checklists:[
{id:'barista-opening',title:'Чек-лист открытия бариста',department:'barista',sections:[{title:'Бар',rows:[{task:'Подготовить кофемашину'}]}]},
{id:'waiter-opening',title:'Чек-лист открытия официанта',department:'waiter',sections:[{title:'Зал',rows:[{task:'Подготовить зал'}]}]}
]},activeTop:'control',activeControl:'checklists',auth:{session:{access_token:'token',user:{id:'admin-1'}},user:{id:'admin-1',name:'Администратор',role:'admin',login:'admin'}},controlRecords:null,revisionRecords:null,controlLoading:false,revisionLoading:false};
window.currentUser=()=>state.auth?.user||null; window.isAuthenticated=()=>Boolean(state.auth?.session?.access_token); window.normalizeRole=value=>String(value||'').toLowerCase(); window.esc=value=>String(value??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
window.safeNotifyEvent=()=>{}; window.alert=()=>{}; window.confirm=()=>true;
window.renderControl=()=>'<section id="top-control"></section>'; window.refreshControl=()=>{}; window.setControlTab=value=>{state.activeControl=value};
window.loadControlRecords=async()=>[]; window.loadRevisionRecords=async()=>[]; window.loadErrorReports=async()=>[]; window.submitChecklist=async()=>{};
function checklistCard(doc){const item=doc.sections[0].rows[0];return '<article class="doc-card" data-checklist-id="'+doc.id+'"><h3>'+doc.title+'</h3><div class="doc-details"><label class="check-row"><input class="task-checkbox" type="checkbox" data-task="'+item.task+'"><span>'+item.task+'</span></label><div class="submit-panel"><input class="employee-name"><button class="submit-checklist" type="button" data-checklist-id="'+doc.id+'">Отправить</button><p class="submit-status"></p></div></div></article>'}
window.renderApp=function(){const checklists='<section class="top-panel '+(state.activeTop==='checklists'?'active':'')+'" id="top-checklists">'+state.menu.checklists.map(checklistCard).join('')+'</section>';document.querySelector('#panels').innerHTML=checklists+window.renderControl();document.querySelectorAll('.submit-checklist').forEach(button=>button.addEventListener('click',()=>window.submitChecklist(button.dataset.checklistId)));};
class Query{constructor(table){this.table=table;this.action='select';this.payload=null;this.filters={};this.singleMode=false}select(){return this}is(){return this}order(){return this}limit(){return this}in(key,value){this.filters[key]=value;return this}eq(key,value){this.filters[key]=value;return this}insert(payload){this.action='insert';this.payload=payload;return this}upsert(payload){this.action='upsert';this.payload=payload;return this}single(){this.singleMode=true;return Promise.resolve(this.execute())}maybeSingle(){this.singleMode=true;return Promise.resolve(this.execute())}then(resolve,reject){return Promise.resolve(this.execute()).then(resolve,reject)}execute(){
if(this.table==='checklist_submissions'){
 if(this.action==='insert'){const row=Array.isArray(this.payload)?this.payload[0]:this.payload;window.__metrics.submissionInsertAttempts++;if(window.__metrics.submissionIds.includes(row.id))return {data:null,error:{code:'23505',message:'duplicate key'}};window.__metrics.submissionIds.push(row.id);submissions.unshift({...row,created_at:new Date().toISOString(),deleted_at:null});return {data:this.singleMode?row:row,error:null}}
 return {data:submissions.slice(),error:null}}
if(this.table==='checklist_submission_photos'||this.table==='checklist_submission_comments'||this.table==='error_reports')return {data:this.singleMode?null:[],error:null};
if(this.table==='coffee_revision_report')return {data:[{id:'rev-1',revision_date:'2026-07-30',employee_name:'Анна',hopper_weight:1.4,opened_packs:2,write_offs:.1,iiko_sales:3.2,losses_percent:2.1,created_at:'2026-07-30T09:00:00Z'}],error:null};
if(this.table==='profiles')return {data:[{id:'employee-barista',name:'Анна',role:'barista',is_active:true},{id:'employee-waiter',name:'Ольга',role:'waiter',is_active:true}],error:null};
if(this.table==='checklist_photo_rules')return {data:[],error:null};
if(this.table==='coffee_revisions')return {data:this.singleMode?this.payload:this.payload,error:null};
return {data:this.singleMode?null:[],error:null}}
}
function clone(value){return JSON.parse(JSON.stringify(value))}
function sharedById(id){return Object.values(window.__sharedDrafts).find(row=>String(row.id)===String(id))||null}
function sharedOpen(args){
 const key=String(args.p_checklist_id);let row=window.__sharedDrafts[key];
 if(!row){const now=new Date().toISOString();row={id:'shared-'+key,submissionId:'submission-'+key,checklistId:key,checklistTitle:String(args.p_checklist_title||'Чек-лист'),department:String(args.p_department||''),workDate:String(args.p_work_date||''),employeeName:'',status:'draft',version:1,updatedAt:now,createdAt:now,submittedAt:null,photos:[],items:(args.p_items||[]).map(item=>({itemKey:String(item.itemKey),text:String(item.text||''),sectionTitle:String(item.sectionTitle||''),checkedByUser:false,requiredPhotoCount:Number(item.requiredPhotoCount||0),photoCount:0}))};window.__sharedDrafts[key]=row}
 return clone(row)
}
function sharedPatch(args){const row=sharedById(args.p_draft_id);if(!row)throw new Error('shared draft not found');if(args.p_employee_name!==null&&args.p_employee_name!==undefined)row.employeeName=String(args.p_employee_name||'');for(const change of (args.p_changes||[])){const item=row.items.find(value=>String(value.itemKey)===String(change.itemKey));if(item)item.checkedByUser=Boolean(change.checkedByUser)}row.version++;row.updatedAt=new Date().toISOString();return clone(row)}
function sharedFinalize(args){const row=sharedById(args.p_draft_id);if(!row)throw new Error('shared draft not found');if(row.status!=='submitted'){row.status='submitted';row.employeeName=String(args.p_employee_name||row.employeeName||'');row.submittedAt=new Date().toISOString();row.updatedAt=row.submittedAt;window.__metrics.submissionInsertAttempts++;if(!window.__metrics.submissionIds.includes(row.submissionId))window.__metrics.submissionIds.push(row.submissionId);submissions.unshift({id:row.submissionId,checklist_id:row.checklistId,checklist_title:row.checklistTitle,employee_id:'admin-1',employee_name:row.employeeName,items:row.items.map(item=>({...item,checked:Boolean(item.checkedByUser)})),completed_count:row.items.filter(item=>item.checkedByUser).length,total_count:row.items.length,percent:100,photo_required_count:0,photo_count:0,created_at:row.submittedAt,deleted_at:null})}return clone(submissions.find(item=>item.id===row.submissionId))}
const client={auth:{getSession:async()=>({data:{session:state.auth.session},error:null})},from:table=>new Query(table),rpc:async(name,args)=>{try{if(name==='open_checklist_shared_draft')return {data:sharedOpen(args),error:null};if(name==='patch_checklist_shared_draft')return {data:sharedPatch(args),error:null};if(name==='checklist_shared_draft_payload')return {data:clone(sharedById(args.p_draft_id)),error:null};if(name==='finalize_checklist_shared_draft')return {data:sharedFinalize(args),error:null};if(name==='finalize_checklist_photo_submission'){window.__metrics.finalizeCalls++;const row=submissions.find(item=>item.id===args.p_submission_id)||{};return {data:[{...row,items:args.p_items,completed_count:(args.p_items||[]).filter(item=>item.checked).length,total_count:(args.p_items||[]).length,percent:100,photo_count:0}],error:null}}return {data:[],error:null}}catch(error){return {data:null,error:{message:error.message}}}},storage:{from:()=>({upload:async path=>({data:{path},error:null}),createSignedUrl:async path=>({data:{signedUrl:'/photo/'+path},error:null})})}};
window.sovremennikSupabase=client;window.supabase={createClient:()=>client};
</script>
<script src="/assets/js/control-v4-core.js"></script><script src="/assets/js/control-v4-storage.js"></script><script src="/assets/js/control-v4-service.js"></script><script src="/assets/js/control-v4-control.js"></script><script src="/assets/js/control-v4-shared-drafts.js"></script><script src="/assets/js/control-v4-checklists.js"></script><script src="/assets/js/control-v4.js"></script></body></html>`;

const mime={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const server=createServer((request,response)=>{const url=new URL(request.url||'/','http://127.0.0.1');if(url.pathname==='/'||url.pathname==='/index.html'){response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end(fixture);return}const file=resolve(root,url.pathname.replace(/^\/+/,''));if(!file.startsWith(root+sep)){response.writeHead(403);response.end();return}try{response.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','cache-control':'no-store'});response.end(readFileSync(file))}catch(error){response.writeHead(404);response.end('not found')}});
await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));
const origin=`http://127.0.0.1:${server.address().port}`;

for(const [name,browserType] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await browserType.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
  await page.goto(origin,{waitUntil:'load'});
  try{await page.waitForFunction(()=>Boolean(window.SovremennikControlV4?.VERSION))}catch(error){throw new Error(name+': Control v4 runtime did not start: '+errors.join(' | '),{cause:error})}
  await page.waitForFunction(()=>document.querySelectorAll('[data-control-v4-report-id]').length===2);

  const waiterButton=page.locator('[data-control-v4-department="waiter"]');
  await page.evaluate(()=>{window.__waiterButtonBefore=document.querySelector('[data-control-v4-department="waiter"]')});
  await waiterButton.tap();
  assert.equal(await waiterButton.getAttribute('aria-pressed'),'true',`${name}: waiter filter did not activate`);
  assert.equal(await page.locator('[data-control-v4-department-panel="waiter"]').isVisible(),true,`${name}: waiter panel is hidden`);
  assert.equal(await page.evaluate(()=>window.__waiterButtonBefore===document.querySelector('[data-control-v4-department="waiter"]')),true,`${name}: filter tap replaced its DOM node`);

  const day=page.locator('[data-control-v4-department-panel="waiter"] [data-control-v4-day-toggle]').first();
  await day.tap();
  assert.equal(await day.getAttribute('aria-expanded'),'false',`${name}: day did not close`);
  await day.tap();
  assert.equal(await day.getAttribute('aria-expanded'),'true',`${name}: day did not open`);
  const report=page.locator('[data-control-v4-department-panel="waiter"] [data-control-v4-report-toggle]').first();
  await report.tap();
  assert.equal(await report.getAttribute('aria-expanded'),'true',`${name}: waiter report did not open`);
  assert.equal(await page.locator('[data-control-v4-department-panel="waiter"] [data-control-v4-report-body]').first().isVisible(),true,`${name}: waiter report body is hidden`);

  await page.locator('[data-control-v4-tab="revisions"]').tap();
  await page.waitForSelector('#revision-records table');
  assert.match(await page.locator('#revision-records').innerText(),/30\.07\.2026|30 июля 2026/,`${name}: revisions did not render`);

  await page.evaluate(()=>{state.activeTop='checklists';window.renderApp()});
  await page.waitForFunction(()=>document.querySelectorAll('.doc-card[data-control-v4-restored="1"]').length===2);
  const card=page.locator('.doc-card[data-checklist-id="barista-opening"]');
  await card.locator('.employee-name').fill('Анна');
  await card.locator('.task-checkbox').check();
  await page.evaluate(()=>{const button=document.querySelector('.doc-card[data-checklist-id="barista-opening"] .submit-checklist');button.click();button.click()});
  await page.waitForFunction(()=>window.__metrics.submissionInsertAttempts===1);
  await page.waitForFunction(()=>window.SovremennikControlV4.pendingCount().then(count=>count===0));
  assert.equal(await page.evaluate(()=>window.__metrics.submissionIds.length),1,`${name}: double submit created duplicate ids`);
  assert.equal(await card.locator('.employee-name').inputValue(),'',`${name}: submitted form was not cleared`);

  await context.setOffline(true);
  const waiterCard=page.locator('.doc-card[data-checklist-id="waiter-opening"]');
  await waiterCard.locator('.employee-name').fill('Ольга');
  await waiterCard.locator('.task-checkbox').check();
  await waiterCard.locator('.submit-checklist').tap();
  await page.waitForFunction(()=>window.SovremennikControlV4.pendingCount().then(count=>count===1));
  assert.equal(await page.evaluate(()=>window.SovremennikControlV4Storage.getDraft('admin-1','waiter-opening').then(draft=>Boolean(draft?.pendingFinalize))),true,`${name}: offline checklist was not retained as a pending shared draft`);
  assert.equal(await waiterCard.locator('.employee-name').inputValue(),'',`${name}: offline queued form was not cleared`);
  await context.setOffline(false);
  await page.waitForFunction(()=>window.SovremennikControlV4.pendingCount().then(count=>count===0),null,{timeout:15000});
  assert.equal(await page.evaluate(()=>window.SovremennikControlV4Storage.getDraft('admin-1','waiter-opening').then(Boolean)),false,`${name}: completed offline draft was not removed`);
  const attempts=await page.evaluate(()=>window.__metrics.submissionInsertAttempts);
  assert.equal(attempts,2,`${name}: reconnect created an unexpected number of submissions`);
  await context.setOffline(true);await context.setOffline(false);await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>window.__metrics.submissionInsertAttempts),2,`${name}: second reconnect duplicated a completed queue item`);
  assert.deepEqual(errors,[],`${name}: browser errors: ${errors.join(' | ')}`);
  await browser.close();
  console.log(`Control v4 mobile taps and one-shot submission passed in ${name}.`);
}
await new Promise(resolveClose=>server.close(resolveClose));

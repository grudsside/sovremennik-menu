import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const root=process.cwd();
const fixture=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
.doc-card{padding:12px}.submit-panel{display:grid;gap:8px}.employee-name,.submit-checklist{min-height:44px}
</style></head><body><section id="top-checklists"><article class="doc-card" data-checklist-id="opening"><label><input class="task-checkbox" type="checkbox" data-task="Открыть смену">Открыть смену</label><div class="submit-panel"><input class="employee-name"><button class="submit-checklist" type="button">Отправить</button><p class="submit-status"></p></div></article></section><script>
window.state={menu:{checklists:[{id:'opening',title:'Открытие',sections:[{title:'Смена',rows:[{task:'Открыть смену'}]}]}]},auth:{session:{access_token:'token',user:{id:'user-1'}},user:{id:'user-1',name:'Анна',role:'barista',login:'anna'}}};
window.currentUser=()=>state.auth.user;window.isAuthenticated=()=>true;window.confirm=()=>true;window.safeNotifyEvent=()=>{};
window.__metrics={insertAttempts:0,ids:[],finalizeCalls:0};const rows=[];
class Query{constructor(table){this.table=table;this.action='select';this.payload=null;this.filters={};this.singleMode=false}select(){return this}eq(key,value){this.filters[key]=value;return this}maybeSingle(){this.singleMode=true;return Promise.resolve(this.execute())}insert(payload){this.action='insert';this.payload=payload;return this}then(resolve,reject){return Promise.resolve(this.execute()).then(resolve,reject)}execute(){if(this.table==='checklist_submissions'){if(this.action==='insert'){const row=Array.isArray(this.payload)?this.payload[0]:this.payload;window.__metrics.insertAttempts++;if(window.__metrics.ids.includes(row.id))return{data:null,error:{code:'23505',message:'duplicate'}};window.__metrics.ids.push(row.id);rows.push(row);return{data:row,error:null}}return{data:rows,error:null}}if(this.table==='checklist_submission_photos')return{data:this.singleMode?null:[],error:null};return{data:this.singleMode?null:[],error:null}}}
const client={auth:{getSession:async()=>({data:{session:state.auth.session},error:null})},from:table=>new Query(table),rpc:async(name,args)=>{if(name==='finalize_checklist_photo_submission'){window.__metrics.finalizeCalls++;return{data:[{id:args.p_submission_id,items:args.p_items,completed_count:1,total_count:1,percent:100,photo_count:0}],error:null}}return{data:null,error:null}},storage:{from:()=>({upload:async path=>({data:{path},error:null})})}};
window.sovremennikSupabase=client;window.SovremennikControlV4Control={photoRules:()=>[]};
</script><script src="/assets/js/control-v4-core.js"></script><script src="/assets/js/control-v4-storage.js"></script><script src="/assets/js/control-v4-service.js"></script><script src="/assets/js/control-v4-checklists.js"></script><script>
SovremennikControlV4Checklists.mount();document.querySelector('.submit-checklist').addEventListener('click',()=>SovremennikControlV4Checklists.submit('opening'));
</script></body></html>`;
const mime={'.js':'text/javascript; charset=utf-8'};
const server=createServer((request,response)=>{const url=new URL(request.url||'/','http://127.0.0.1');if(url.pathname==='/'||url.pathname==='/index.html'){response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end(fixture);return}const file=resolve(root,url.pathname.replace(/^\/+/,''));if(!file.startsWith(root+sep)){response.writeHead(403);response.end();return}try{response.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','cache-control':'no-store'});response.end(readFileSync(file))}catch(error){response.writeHead(404);response.end('not found')}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
const page=await context.newPage();
const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'load'});
await page.waitForFunction(()=>Boolean(window.SovremennikControlV4Checklists));
const card=page.locator('.doc-card');
await card.locator('.employee-name').fill('Анна');await card.locator('.task-checkbox').check();
await page.evaluate(()=>{const button=document.querySelector('.submit-checklist');button.click();button.click()});
await page.waitForFunction(()=>window.__metrics.insertAttempts===1);
await page.waitForFunction(()=>SovremennikControlV4Checklists.pendingCount().then(count=>count===0));
assert.equal(await page.evaluate(()=>window.__metrics.ids.length),1,'Fast double click created a duplicate online submission');

await context.setOffline(true);
await card.locator('.employee-name').fill('Анна');await card.locator('.task-checkbox').check();await card.locator('.submit-checklist').tap();
await page.waitForFunction(()=>SovremennikControlV4Checklists.pendingCount().then(count=>count===1));
assert.equal(await page.evaluate(()=>SovremennikControlV4Storage.getDraft('user-1','opening').then(Boolean)),false,'Queued checklist remained in draft storage');
assert.equal(await card.locator('.employee-name').inputValue(),'','Queued checklist did not clear the form');
await context.setOffline(false);
await page.waitForFunction(()=>SovremennikControlV4Checklists.pendingCount().then(count=>count===0),null,{timeout:15000});
assert.equal(await page.evaluate(()=>window.__metrics.insertAttempts),2,'Reconnect did not synchronize exactly one queued checklist');
await context.setOffline(true);await context.setOffline(false);await page.waitForTimeout(700);
assert.equal(await page.evaluate(()=>window.__metrics.insertAttempts),2,'Second reconnect duplicated a completed queue item');
assert.deepEqual(errors,[],`Browser errors: ${errors.join(' | ')}`);
await browser.close();await new Promise(resolve=>server.close(resolve));
console.log('Control v4 offline queue and duplicate protection browser smoke passed.');

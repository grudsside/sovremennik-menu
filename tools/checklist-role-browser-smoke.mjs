import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root=process.cwd();
const artifactDir=path.join(root,'artifacts','open-test-preview');
await fs.mkdir(artifactDir,{recursive:true});
const browser=await chromium.launch({headless:true});

try{
  const page=await browser.newPage({viewport:{width:1280,height:1000}});
  await page.setContent('<main id="panels"></main>');
  await page.addStyleTag({path:path.join(root,'assets/css/checklist-role-workflow.css')});
  await page.addStyleTag({path:path.join(root,'assets/css/shift-handoff.css')});
  await page.addStyleTag({path:path.join(root,'assets/css/home-layout-v4.css')});
  await page.addStyleTag({content:'body{margin:0;padding:24px;background:#f4f1e8;font-family:Inter,system-ui,sans-serif;color:#26301f}.top-panel{display:block}.doc-card{margin:12px 0;padding:16px;border:1px solid #ddd;border-radius:14px;background:#fff}.doc-actions{margin:8px 0}.doc-details{display:block}.v3-welcome-card,.v3-dashboard-card{padding:18px;margin:8px 0;background:#fff;border:1px solid #ddd;border-radius:16px}.v3-home-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.v3-card-head{display:flex;justify-content:space-between;gap:16px}button{font:inherit}' });
  await page.addScriptTag({content:`
    window.__displayRole='waiter';
    window.__taskUpdates=[];
    window.__rpcCalls=[];
    window.__taskRows=[{id:'task-1',title:'Проверить сервировку',description:'',assignee_id:'waiter-1',is_vip:false,due_date:new Date().toISOString().slice(0,10),due_at:null,status:'open',completed_at:null,created_at:new Date().toISOString()}];
    window.__handoffRows=[{id:'handoff-1',created_by:'barista-1',created_by_name:'Анна',created_by_role:'barista',created_at:new Date().toISOString(),visible_until:new Date(Date.now()+86400000).toISOString(),unfinished:['Разобрать поставку'],out_of_stock:['Овсяное молоко'],equipment_issues:[],next_shift_control:['Проверить сиропы'],notes:''}];
    window.__handoffAcks=[];
    window.state={activeTop:'home',menu:{checklists:[
      {id:'bar-opening-checklist',title:'Бариста · открытие смены',department:'barista',shiftPhase:'opening',file:'',sections:[{title:'Открытие',rows:[{task:'Открыть кофейню'}]}]},
      {id:'bar-closing-checklist',title:'Бариста · закрытие смены',department:'barista',shiftPhase:'closing',file:'',sections:[{title:'Закрытие',rows:[{task:'Закрыть кофейню'}]}]}
    ]}};
    window.currentUser=()=>({id:'waiter-1',name:'Preview Waiter',login:'preview-waiter',role:'waiter',is_active:true});
    window.SovremennikRoleInterface={displayRole:()=>window.__displayRole};
    window.normalizeRole=value=>String(value||'').trim().toLowerCase();
    window.roleLabel=role=>({admin:'Администратор',manager:'Руководитель',barista:'Бариста',waiter:'Официант'})[role]||role;
    window.esc=value=>String(value??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
    window.renderChecklists=()=>{
      const cards=(state.menu.checklists||[]).map(doc=>'<article class="doc-card" data-checklist-id="'+doc.id+'"><div class="doc-actions"><a href="'+(doc.file||'')+'">Скачать</a></div><details class="doc-details"><summary>'+doc.title+'</summary></details></article>').join('');
      return '<section class="top-panel" id="top-checklists"><div class="section-heading"><h2>Чек-листы</h2></div>'+cards+'</section>';
    };
    window.renderApp=()=>{
      const panels=document.querySelector('#panels');
      if(state.activeTop==='checklists') panels.innerHTML=window.renderChecklists();
      else panels.innerHTML='<section class="top-panel" id="top-home"><section class="v3-welcome-card"><h1>Всё необходимое для смены — в одном месте.</h1></section><div class="v3-home-grid"><section class="v3-dashboard-card v3-shift-card"><h2>Сегодняшняя смена</h2></section><section class="v3-dashboard-card v3-upcoming-card"><h2>Ближайшие события</h2></section></div><section class="v3-dashboard-card v3-summary-card"><h2>Рабочая информация</h2></section></section>';
    };
    window.setTop=target=>{state.activeTop=target;window.renderApp();};
    window.sendPayloadToSheets=async payload=>payload;
    function query(table){
      let mode='select'; let updateValues=null; let taskId=''; let handoffId='';
      const q={
        select(){return q;},eq(key,value){if(key==='id') taskId=String(value);if(key==='handoff_id') handoffId=String(value);return q;},gte(){return q;},lt(){return q;},in(){return q;},order(){return q;},limit(){return q;},
        update(values){mode='update';updateValues=values;return q;},
        maybeSingle(){
          if(table==='tasks'&&mode==='update'){
            const task=window.__taskRows.find(row=>String(row.id)===taskId);
            if(!task) return Promise.resolve({data:null,error:null});
            Object.assign(task,updateValues||{}); window.__taskUpdates.push({id:taskId,...updateValues});
            return Promise.resolve({data:{id:task.id,status:task.status,completed_at:task.completed_at},error:null});
          }
          return Promise.resolve({data:null,error:null});
        },
        then(resolve){
          let data=[];
          if(table==='tasks') data=window.__taskRows.map(row=>({...row}));
          if(table==='shift_handoffs') data=window.__handoffRows.map(row=>({...row}));
          if(table==='shift_handoff_acknowledgements') data=window.__handoffAcks.filter(row=>!handoffId||row.handoff_id===handoffId).map(row=>({...row}));
          if(table==='shift_handoff_photos') data=[];
          resolve({data,error:null});
        }
      };
      return q;
    }
    window.sovremennikSupabase={
      from:query,
      rpc:async(name,args)=>{window.__rpcCalls.push({name,args});if(name==='acknowledge_shift_handoff')window.__handoffAcks.push({handoff_id:args.p_handoff_id,employee_id:'waiter-1',employee_name:'Preview Waiter',acknowledged_at:new Date().toISOString()});return {data:true,error:null};},
      storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:''},error:null})})}
    };
    window.renderApp();
  `});
  await page.addScriptTag({path:path.join(root,'assets/js/checklist-role-core.js')});
  await page.addScriptTag({path:path.join(root,'assets/js/checklist-role-workflow.js')});
  await page.addScriptTag({path:path.join(root,'assets/js/shift-handoff-core.js')});
  await page.addScriptTag({path:path.join(root,'assets/js/home-layout-v4.js')});

  await page.locator('[data-role-today-work]').waitFor({state:'visible'});
  const waiterText=await page.locator('[data-role-today-work]').innerText();
  assert.match(waiterText,/Работа официанта на сегодня/);
  assert.match(waiterText,/Открытие смены/);
  assert.match(waiterText,/Закрытие смены/);
  assert.match(waiterText,/Проверить сервировку/);
  assert.doesNotMatch(waiterText,/Ревизия по кофе/);

  const homeOrder=await page.evaluate(()=>Array.from(document.querySelector('#top-home').children).map(node=>node.className||node.tagName));
  assert.match(homeOrder[0],/v3-welcome-card/,'welcome must stay first');
  assert.match(homeOrder[1],/role-today-work/,'work for today must be directly below welcome');
  assert.equal(await page.locator('.v3-summary-card').count(),0,'summary block must be removed');
  assert.equal(await page.locator('.v3-shift-card').count(),0,'employee roster card must be removed');
  assert.equal(await page.locator('.v3-home-grid > [data-waiter-shift-handoff]:first-child').count(),1,'handoff must replace roster in the first grid slot');
  assert.match(await page.locator('[data-waiter-shift-handoff]').innerText(),/От предыдущей смены/);
  assert.match(await page.locator('[data-waiter-shift-handoff]').innerText(),/Овсяное молоко/);
  assert.equal(await page.locator('.v3-upcoming-card').count(),1,'upcoming events must remain');

  await page.locator('[data-waiter-handoff-accept]').click();
  await page.waitForFunction(()=>window.__rpcCalls.some(call=>call.name==='acknowledge_shift_handoff')&&document.querySelector('[data-waiter-shift-handoff]')?.textContent.includes('Принято'));

  await page.locator('[data-today-task-complete="task-1"]').click();
  await page.waitForFunction(()=>window.__taskUpdates.length===1&&document.querySelector('[data-today-task-row="task-1"]')?.classList.contains('completed'));
  assert.equal(await page.locator('[data-today-task-row="task-1"] .role-today-status').innerText(),'Завершена');

  await page.evaluate(()=>{
    window.__displayRole='manager';
    document.querySelector('#top-home')?.insertAdjacentHTML('afterbegin','<section data-role-home-intro><h2>Требует внимания</h2></section>');
    window.SovremennikChecklistWorkflow.enhanceHome();
  });
  assert.equal(await page.locator('#top-home [data-role-home-intro]').count(),0,'manager attention placeholder must be removed');

  await page.evaluate(()=>{
    window.__displayRole='admin';
    state.activeTop='checklists';
    window.renderApp();
  });
  await page.locator('[data-checklist-department-tab]').first().waitFor({state:'visible'});
  assert.equal(await page.locator('[data-checklist-department-tab]').count(),2);
  assert.deepEqual(await page.locator('[data-checklist-department-tab]').allTextContents(),['Бариста','Официант']);

  await page.locator('[data-checklist-department-tab="waiter"]').click();
  assert.equal(await page.locator('.doc-card[data-checklist-audience="waiter"]').count(),2);
  assert.equal(await page.locator('.doc-card[data-checklist-audience="waiter"] .doc-actions').count(),0,'embedded waiter checklists must not show a fake download link');

  await page.evaluate(()=>{window.__displayRole='waiter';state.activeTop='home';window.renderApp();});
  await page.locator('[data-waiter-shift-handoff]').waitFor({state:'visible'});
  await page.screenshot({path:path.join(artifactDir,'role-today-and-waiter-checklists.png'),fullPage:true});
  await page.close();
  console.log('Checklist tabs, revised employee home layout and handoff browser smoke passed.');
} finally {
  await browser.close();
}

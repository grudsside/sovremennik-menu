import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root=process.cwd();
const artifactDir=path.join(root,'artifacts','open-test-preview');
await fs.mkdir(artifactDir,{recursive:true});
const browser=await chromium.launch({headless:true});

try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.setContent('<main id="panels"></main>');
  await page.addStyleTag({path:path.join(root,'assets/css/checklist-role-workflow.css')});
  await page.addStyleTag({content:'body{margin:0;padding:24px;background:#f4f1e8;font-family:Inter,system-ui,sans-serif;color:#26301f}.top-panel{display:block}.doc-card{margin:12px 0;padding:16px;border:1px solid #ddd;border-radius:14px;background:#fff}.doc-actions{margin:8px 0}.doc-details{display:block}.v3-dashboard-card{padding:12px;margin:8px 0;background:#fff}button{font:inherit}'});
  await page.addScriptTag({content:`
    window.__displayRole='waiter';
    window.__taskUpdates=[];
    window.__taskRows=[{id:'task-1',title:'Проверить сервировку',description:'',assignee_id:'waiter-1',is_vip:false,due_date:new Date().toISOString().slice(0,10),due_at:null,status:'open',completed_at:null,created_at:new Date().toISOString()}];
    window.state={activeTop:'home',menu:{checklists:[
      {id:'bar-opening-checklist',title:'Бариста · открытие смены',department:'barista',shiftPhase:'opening',file:'',sections:[{title:'Открытие',rows:[{task:'Открыть кофейню'}]}]},
      {id:'bar-closing-checklist',title:'Бариста · закрытие смены',department:'barista',shiftPhase:'closing',file:'',sections:[{title:'Закрытие',rows:[{task:'Закрыть кофейню'}]}]}
    ]}};
    window.currentUser=()=>({id:'waiter-1',name:'Preview Waiter',login:'preview-waiter',role:'waiter',is_active:true});
    window.SovremennikRoleInterface={displayRole:()=>window.__displayRole};
    window.esc=value=>String(value??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
    window.renderChecklists=()=>{
      const cards=(state.menu.checklists||[]).map(doc=>'<article class="doc-card" data-checklist-id="'+doc.id+'"><div class="doc-actions"><a href="'+(doc.file||'')+'">Скачать</a></div><details class="doc-details"><summary>'+doc.title+'</summary></details></article>').join('');
      return '<section class="top-panel" id="top-checklists"><div class="section-heading"><h2>Чек-листы</h2></div>'+cards+'</section>';
    };
    window.renderApp=()=>{
      const panels=document.querySelector('#panels');
      if(state.activeTop==='checklists') panels.innerHTML=window.renderChecklists();
      else panels.innerHTML='<section class="top-panel" id="top-home"><div class="v3-dashboard-card">Смена</div><div class="v3-dashboard-card">События</div></section>';
    };
    window.setTop=target=>{state.activeTop=target;window.renderApp();};
    window.sendPayloadToSheets=async payload=>payload;
    function query(table){
      let mode='select'; let updateValues=null; let taskId='';
      const q={
        select(){return q;},eq(key,value){if(key==='id') taskId=String(value);return q;},gte(){return q;},lt(){return q;},in(){return q;},order(){return q;},limit(){return q;},
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
        then(resolve,reject){
          let data=[];
          if(table==='tasks') data=window.__taskRows.map(row=>({...row}));
          resolve({data,error:null});
        }
      };
      return q;
    }
    window.sovremennikSupabase={from:query};
    window.renderApp();
  `});
  await page.addScriptTag({path:path.join(root,'assets/js/checklist-role-core.js')});
  await page.addScriptTag({path:path.join(root,'assets/js/checklist-role-workflow.js')});

  await page.locator('[data-role-today-work]').waitFor({state:'visible'});
  const waiterText=await page.locator('[data-role-today-work]').innerText();
  assert.match(waiterText,/Работа официанта на сегодня/);
  assert.match(waiterText,/Открытие смены/);
  assert.match(waiterText,/Закрытие смены/);
  assert.match(waiterText,/Проверить сервировку/);
  assert.doesNotMatch(waiterText,/Ревизия по кофе/);

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

  await page.screenshot({path:path.join(artifactDir,'role-today-and-waiter-checklists.png'),fullPage:true});
  await page.close();
  console.log('Checklist tabs and role-specific work-for-today browser smoke passed.');
} finally {
  await browser.close();
}

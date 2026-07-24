import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const artifactDir = path.join(root, 'artifacts', 'open-test-preview');
await fs.mkdir(artifactDir, { recursive:true });

const browser = await chromium.launch({ headless:true });
const context = await browser.newContext({
  viewport:{ width:390, height:844 },
  screen:{ width:390, height:844 },
  hasTouch:true,
  isMobile:true,
  deviceScaleFactor:2,
});
const page = await context.newPage();
const browserErrors = [];
let stage = 'prepare editor page';
page.on('pageerror', error => browserErrors.push(`pageerror: ${error.stack || error.message}`));
page.on('console', message => { if(message.type() === 'error') browserErrors.push(`console: ${message.text()}`); });

try {
  await page.setContent('<!doctype html><html><body><main id="app"></main></body></html>');
  await page.addStyleTag({ content:`
    *{box-sizing:border-box}body{margin:0;padding:14px;background:#f4f1e8;font-family:system-ui,sans-serif;color:#26301f}
    .doc-card{padding:16px;border:1px solid #d9d2bc;border-radius:18px;background:#fff}.card-head{display:flex;gap:8px;align-items:center}.doc-actions{display:flex;gap:8px;margin-top:14px}.small-action{min-height:40px;padding:8px 13px;border:1px solid #c8c0ab;border-radius:12px;background:#4f5f33;color:#fff}.secondary,.ghost{background:#fff;color:#4f5f33}.source-badge{font-size:12px}
  ` });
  await page.addStyleTag({ path:path.join(root, 'assets/css/checklist-editor.css') });
  await page.addScriptTag({ content:`
    const baseMenu={checklists:[{id:'opening',title:'Чек-лист открытия',description:'До начала смены',file:'Чек-лист открытия',sections:[{title:'Бар',rows:[{task:'Проверить витрину'},{task:'Протереть кофемашину'}]}]}]};
    window.state={menu:JSON.parse(JSON.stringify(baseMenu)),activeTop:'checklists'};
    window.remoteOverrides=[];
    window.rpcCalls=[];
    window.esc=value=>String(value??'').replace(/[&<>\"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char]));
    window.currentUser=()=>({id:'admin-id',name:'Preview Admin',role:'admin'});
    window.isAuthenticated=()=>true;
    window.isAdmin=()=>true;
    window.confirm=()=>true;
    window.alert=message=>{ window.lastAlert=message; };
    window.loadMenu=async()=>JSON.parse(JSON.stringify(baseMenu));
    window.setTop=target=>{ state.activeTop=target; };
    window.renderApp=()=>{
      const doc=state.menu.checklists[0];
      document.querySelector('#app').innerHTML='<article class="doc-card" data-checklist-id="'+doc.id+'"><div class="card-head"><h2>'+doc.title+'</h2><span class="source-badge">'+doc.file+'</span></div><p>'+doc.description+'</p><div class="doc-actions"><button class="small-action">Открыть</button></div></article>';
    };
    window.supa={
      from(table){
        if(table!=='checklist_template_overrides') throw new Error('Unexpected table '+table);
        return { select(){ return { order(){ return Promise.resolve({data:window.remoteOverrides,error:null}); } }; } };
      },
      async rpc(name,args){
        window.rpcCalls.push({name,args:JSON.parse(JSON.stringify(args||{}))});
        if(name==='save_checklist_template_override'){
          const row={checklist_id:args.p_checklist_id,title:args.p_title,description:args.p_description,sections:args.p_sections,version:Number(args.p_expected_version||0)+1,updated_at:'2026-07-24T08:00:00Z'};
          window.remoteOverrides=[row];
          return {data:[row],error:null};
        }
        if(name==='reset_checklist_template_override'){
          window.remoteOverrides=[];
          return {data:true,error:null};
        }
        return {data:null,error:{message:'Unexpected RPC'}};
      }
    };
    renderApp();
  ` });
  await page.addScriptTag({ path:path.join(root, 'assets/js/checklist-photo-core.js') });
  await page.addScriptTag({ path:path.join(root, 'assets/js/checklist-editor-core.js') });
  await page.addScriptTag({ path:path.join(root, 'assets/js/checklist-editor.js') });

  stage = 'open mobile editor';
  const editButton = page.locator('[data-checklist-template-edit]');
  await editButton.waitFor({ state:'visible' });
  await editButton.click();
  const modal = page.locator('[data-checklist-editor-modal]');
  await modal.waitFor({ state:'visible' });
  const fit = await page.evaluate(() => {
    const rect=document.querySelector('.checklist-editor-dialog').getBoundingClientRect();
    return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:innerWidth,height:innerHeight};
  });
  assert.ok(fit.left >= -0.5 && fit.right <= fit.width + 0.5, 'Editor dialog must fit mobile width');
  assert.ok(fit.top >= -0.5 && fit.bottom <= fit.height + 0.5, 'Editor dialog must fit mobile height');

  stage = 'edit and reorder checklist';
  await page.locator('[name="title"]').fill('Открытие обновлённое');
  await page.locator('[data-editor-row-down]').first().click();
  await page.locator('[data-editor-add-row]').click();
  await page.locator('[data-editor-task]').last().fill('Проверить сиропы');
  await page.locator('[data-editor-responsible]').last().fill('Бариста');
  await page.locator('[data-editor-save]').click();
  await page.waitForFunction(() => document.querySelector('.doc-card h2')?.textContent === 'Открытие обновлённое');
  await page.waitForFunction(() => document.querySelector('.checklist-template-status')?.textContent === 'изменён');

  const saved = await page.evaluate(() => ({
    menu:state.menu,
    calls:window.rpcCalls,
    badge:document.querySelector('.checklist-template-status')?.textContent || '',
    alert:window.lastAlert || ''
  }));
  assert.equal(saved.calls[0].name, 'save_checklist_template_override');
  assert.equal(saved.calls[0].args.p_expected_version, 0);
  assert.equal(saved.menu.checklists[0].sections[0].rows[0].itemKey, 'opening:0:1');
  assert.equal(saved.menu.checklists[0].sections[0].rows[1].itemKey, 'opening:0:0');
  assert.match(saved.menu.checklists[0].sections[0].rows[2].itemKey, /^opening:custom:/);
  assert.equal(saved.menu.checklists[0].sections[0].rows[2].task, 'Проверить сиропы');
  assert.equal(saved.badge, 'изменён');
  assert.match(saved.alert, /обновлён/i);

  stage = 'save mobile editor screenshot';
  await page.screenshot({ path:path.join(artifactDir, 'checklist-editor-mobile.png'), fullPage:true });

  stage = 'reset template';
  await page.locator('[data-checklist-template-edit]').click();
  await page.locator('[data-editor-reset]').click();
  await page.waitForFunction(() => document.querySelector('.doc-card h2')?.textContent === 'Чек-лист открытия');
  const reset = await page.evaluate(() => ({ calls:window.rpcCalls, title:state.menu.checklists[0].title, override:state.menu.checklists[0].__templateOverride }));
  assert.equal(reset.calls.at(-1).name, 'reset_checklist_template_override');
  assert.equal(reset.title, 'Чек-лист открытия');
  assert.equal(Boolean(reset.override), false);

  assert.deepEqual(browserErrors, [], `Browser errors: ${browserErrors.join('\n')}`);
  console.log('Checklist editor mobile browser smoke test passed.');
} catch(error){
  const diagnostic=[`Stage: ${stage}`,`Error: ${error?.stack || error}`,'','Browser errors:',...(browserErrors.length?browserErrors:['none'])].join('\n');
  await fs.writeFile(path.join(artifactDir,'checklist-editor-browser-error.txt'),diagnostic,'utf8');
  await page.screenshot({ path:path.join(artifactDir,'checklist-editor-browser-failure.png'),fullPage:true }).catch(()=>undefined);
  console.error(diagnostic);
  throw error;
} finally {
  await context.close();
  await browser.close();
}

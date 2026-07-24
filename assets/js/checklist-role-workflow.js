/* Современник — checklist department tabs and role-specific work for today. */
(function(global){
  'use strict';

  const core=global.SovremennikChecklistCore;
  if(!core||typeof state==='undefined') return;

  const STORAGE_KEY='sovremennikChecklistDepartmentV1';
  const baseRenderChecklists=typeof global.renderChecklists==='function'?global.renderChecklists:null;
  const baseRenderApp=typeof global.renderApp==='function'?global.renderApp:null;
  const baseSendPayload=typeof global.sendPayloadToSheets==='function'?global.sendPayloadToSheets:null;
  let activeDepartment='';
  let bound=false;
  let observer=null;
  let enhanceQueued=false;
  let loadGeneration=0;

  function escapeHtml(value){
    return String(value??'').replace(/[&<>"']/g,character=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[character]));
  }
  function currentProfile(){
    try{return typeof global.currentUser==='function'?global.currentUser():null;}
    catch(error){return null;}
  }
  function displayRole(){
    const interfaceApi=global.SovremennikRoleInterface;
    if(typeof interfaceApi?.displayRole==='function') return interfaceApi.displayRole();
    return core.normalizeRole(currentProfile()?.role);
  }
  function client(){
    if(global.sovremennikSupabase) return global.sovremennikSupabase;
    try{return typeof supa!=='undefined'?supa:null;}catch(error){return null;}
  }
  function allowedDepartments(role=displayRole()){
    if(role==='admin'||role==='manager') return ['barista','waiter'];
    return [role==='waiter'?'waiter':'barista'];
  }
  function initialDepartment(role=displayRole()){
    const allowed=allowedDepartments(role);
    if(activeDepartment&&allowed.includes(activeDepartment)) return activeDepartment;
    try{
      const saved=global.localStorage?.getItem(STORAGE_KEY);
      if(saved&&allowed.includes(saved)) return saved;
    }catch(error){}
    return allowed[0];
  }
  function setDepartment(value){
    const allowed=allowedDepartments();
    activeDepartment=allowed.includes(value)?value:allowed[0];
    try{global.localStorage?.setItem(STORAGE_KEY,activeDepartment);}catch(error){}
  }
  function ensureDocuments(){
    if(!state.menu) return [];
    state.menu.checklists=core.injectWaiterChecklists(state.menu.checklists||[]);
    return state.menu.checklists;
  }
  function tabsMarkup(){
    const allowed=allowedDepartments();
    const selected=initialDepartment();
    return `<nav class="checklist-department-tabs" aria-label="Подразделение чек-листов">
      ${allowed.map(department=>`<button type="button" class="checklist-department-tab ${selected===department?'active':''}" data-checklist-department-tab="${department}" aria-pressed="${selected===department}">${department==='barista'?'Бариста':'Официант'}</button>`).join('')}
    </nav>`;
  }
  function withDepartmentDocuments(callback){
    const all=ensureDocuments();
    const selected=initialDepartment();
    const previous=state.menu.checklists;
    state.menu.checklists=core.docsForDepartment(all,selected);
    try{return callback();}
    finally{state.menu.checklists=previous;}
  }
  function decorateChecklistHtml(html){
    if(!global.document?.createElement) return html;
    const template=document.createElement('template');
    template.innerHTML=String(html||'').trim();
    const panel=template.content.firstElementChild;
    if(!panel) return html;
    const selected=initialDepartment();
    panel.dataset.checklistDepartment=selected;
    panel.querySelector('.section-heading')?.insertAdjacentHTML('afterend',tabsMarkup());
    panel.querySelectorAll('.doc-card').forEach(card=>{
      const doc=(ensureDocuments()||[]).find(item=>String(item.id)===String(card.dataset.checklistId));
      if(!doc) return;
      card.dataset.checklistAudience=core.departmentForDoc(doc);
      if(core.departmentForDoc(doc)==='waiter'&&!doc.file) card.querySelector('.doc-actions')?.remove();
    });
    return panel.outerHTML;
  }
  function renderChecklists(){
    if(typeof baseRenderChecklists!=='function') return '';
    return decorateChecklistHtml(withDepartmentDocuments(()=>baseRenderChecklists()));
  }
  function rerenderChecklists(){
    if(typeof global.renderApp!=='function') return;
    state.activeTop='checklists';
    global.renderApp();
    global.setTop?.('checklists');
  }
  function openChecklist(docId){
    const docs=ensureDocuments();
    const doc=docs.find(item=>String(item.id)===String(docId));
    if(!doc) return;
    setDepartment(core.departmentForDoc(doc));
    rerenderChecklists();
    global.requestAnimationFrame?.(()=>{
      const selectorValue=global.CSS?.escape?CSS.escape(doc.id):doc.id;
      const card=document.querySelector(`.doc-card[data-checklist-id="${selectorValue}"]`);
      const details=card?.querySelector('.doc-details');
      if(details) details.open=true;
      card?.scrollIntoView?.({behavior:'smooth',block:'start'});
    });
  }
  function localDayBounds(){
    const now=new Date();
    const start=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    const end=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1);
    return {today:core.localDateKey(now),start:start.toISOString(),end:end.toISOString()};
  }
  function statusBadge(done,label){return `<span class="role-today-status ${done?'done':'pending'}">${escapeHtml(label)}</span>`;}
  function checklistRow(doc,phase,status){
    const title=phase==='opening'?'Открытие смены':'Закрытие смены';
    if(!doc) return `<div class="role-today-row unavailable"><span class="role-today-check">—</span><span><strong>${title}</strong><small>Чек-лист не настроен</small></span>${statusBadge(false,'Недоступно')}</div>`;
    return `<button type="button" class="role-today-row ${status.done?'completed':''}" data-today-checklist="${escapeHtml(doc.id)}">
      <span class="role-today-check">${status.done?'✓':'○'}</span><span><strong>${title}</strong><small>${escapeHtml(doc.title)}</small></span>${statusBadge(status.done,status.label)}
    </button>`;
  }
  function revisionRow(done){
    return `<button type="button" class="role-today-row ${done?'completed':''}" data-today-section="revisions">
      <span class="role-today-check">${done?'✓':'○'}</span><span><strong>Ревизия по кофе</strong><small>Ежедневная ревизия зерна</small></span>${statusBadge(done,done?'Выполнено':'Не выполнено')}
    </button>`;
  }
  function taskTimeLabel(task,today){
    const due=core.taskDueKey(task);
    if(!due) return 'Без срока';
    if(due<today&&!core.taskIsDone(task)) return 'Просрочено';
    return due===today?'Сегодня':due;
  }
  function taskRow(task,today){
    const done=core.taskIsDone(task);
    return `<div class="role-today-row role-today-task ${done?'completed':''}" data-today-task-row="${escapeHtml(task.id)}">
      <button type="button" class="role-today-task-toggle" data-today-task-complete="${escapeHtml(task.id)}" ${done?'disabled':''} aria-label="${done?'Задача выполнена':'Отметить задачу выполненной'}">${done?'✓':'○'}</button>
      <button type="button" class="role-today-task-open" data-today-section="tasks"><strong>${escapeHtml(task.title||'Задача')}</strong><small>${escapeHtml(taskTimeLabel(task,today))}${task.is_vip||task.isVip?' · VIP':''}</small></button>
      ${statusBadge(done,done?'Завершена':'В работе')}
    </div>`;
  }
  function emptyTasksRow(){
    return `<div class="role-today-empty"><span>✓</span><div><strong>Личных задач на сегодня нет</strong><small>Новые назначенные задачи появятся здесь автоматически.</small></div></div>`;
  }
  function todayWorkMarkup(role){
    const title=role==='barista'?'Работа бариста на сегодня':'Работа официанта на сегодня';
    return `<section class="role-today-work" data-role-home-intro data-role-today-work data-role="${escapeHtml(role)}">
      <header><div><p>${escapeHtml(role==='barista'?'Бариста':'Официант')} · текущая смена</p><h2>${title}</h2></div><span class="role-today-progress" data-role-today-progress>Загрузка…</span></header>
      <div class="role-today-content" data-role-today-content><div class="role-today-loading">Загружаю чек-листы и задачи…</div></div>
    </section>`;
  }
  function normalizeTask(row){
    return {
      ...row,
      id:String(row?.id||''),
      title:String(row?.title||'Задача'),
      dueDate:row?.due_date||row?.dueDate||null,
      dueAt:row?.due_at||row?.dueAt||null,
      completedAt:row?.completed_at||row?.completedAt||null,
      isVip:Boolean(row?.is_vip??row?.isVip)
    };
  }
  async function loadTodayData(role){
    const profile=currentProfile();
    const supabase=client();
    const bounds=localDayBounds();
    if(!profile?.id||!supabase) return {today:bounds.today,submissions:[],revisions:[],tasks:[],offline:true};
    const checklistQuery=supabase.from('checklist_submissions')
      .select('id,checklist_id,checklist_title,employee_id,employee_name,items,completed_count,total_count,created_at')
      .eq('employee_id',profile.id).gte('created_at',bounds.start).lt('created_at',bounds.end)
      .order('created_at',{ascending:false});
    const revisionPromise=role==='barista'
      ? supabase.from('coffee_revisions').select('revision_date,employee_id,employee_name').eq('revision_date',bounds.today)
      : Promise.resolve({data:[],error:null});
    const taskQuery=supabase.from('tasks')
      .select('id,title,description,assignee_id,is_vip,due_date,due_at,status,completed_at,created_at')
      .eq('assignee_id',profile.id).in('status',['open','done'])
      .order('is_vip',{ascending:false}).order('due_at',{ascending:true,nullsFirst:false}).limit(100);
    const [checklists,revisions,tasks]=await Promise.all([checklistQuery,revisionPromise,taskQuery]);
    if(checklists.error) throw checklists.error;
    if(revisions.error) throw revisions.error;
    if(tasks.error) throw tasks.error;
    return {
      today:bounds.today,
      submissions:checklists.data||[],
      revisions:revisions.data||[],
      tasks:(tasks.data||[]).map(normalizeTask).filter(task=>core.taskForToday(task,bounds.today)),
      offline:false
    };
  }
  function renderTodayData(root,role,data){
    const docs=ensureDocuments();
    const department=role==='waiter'?'waiter':'barista';
    const opening=core.findShiftDoc(docs,department,'opening');
    const closing=core.findShiftDoc(docs,department,'closing');
    const profile=currentProfile();
    const openingStatus=core.submissionProgress(data.submissions,opening,profile?.id,data.today);
    const closingStatus=core.submissionProgress(data.submissions,closing,profile?.id,data.today);
    const revisionDone=role==='barista'&&core.revisionCompleted(data.revisions,profile?.id,data.today);
    const tasks=data.tasks||[];
    const total=2+(role==='barista'?1:0)+tasks.length;
    const completed=Number(openingStatus.done)+Number(closingStatus.done)+(role==='barista'?Number(revisionDone):0)+tasks.filter(core.taskIsDone).length;
    const content=root.querySelector('[data-role-today-content]');
    const progress=root.querySelector('[data-role-today-progress]');
    if(progress) progress.textContent=`${completed} из ${total} выполнено`;
    if(!content) return;
    content.innerHTML=`<div class="role-today-group"><h3>Обязательные действия</h3>${checklistRow(opening,'opening',openingStatus)}${checklistRow(closing,'closing',closingStatus)}${role==='barista'?revisionRow(revisionDone):''}</div>
      <div class="role-today-group"><div class="role-today-group-head"><h3>Личные задачи</h3><button type="button" data-today-section="tasks">Все задачи</button></div>${tasks.length?tasks.map(task=>taskRow(task,data.today)).join(''):emptyTasksRow()}</div>
      ${data.offline?'<p class="role-today-note">Показана локальная структура. Статусы обновятся после восстановления подключения.</p>':''}`;
  }
  async function hydrateTodayWork(){
    const root=document.querySelector('[data-role-today-work]');
    const role=displayRole();
    if(!root||!['barista','waiter'].includes(role)) return;
    const generation=++loadGeneration;
    try{
      const data=await loadTodayData(role);
      if(generation!==loadGeneration||!document.contains(root)) return;
      renderTodayData(root,role,data);
    }catch(error){
      console.warn('Today work loading failed',error);
      if(generation!==loadGeneration||!document.contains(root)) return;
      renderTodayData(root,role,{today:core.localDateKey(),submissions:[],revisions:[],tasks:[],offline:true});
      const content=root.querySelector('[data-role-today-content]');
      content?.insertAdjacentHTML('beforeend',`<p class="role-today-error">Не удалось обновить статусы: ${escapeHtml(error?.message||'проверьте подключение.')}</p>`);
    }
  }
  function enhanceHome(){
    enhanceQueued=false;
    const home=document.querySelector('#top-home');
    if(!home) return;
    const role=displayRole();
    let current=home.querySelector('[data-role-home-intro]');
    if(role==='manager'){
      current?.remove();
      return;
    }
    if(!['barista','waiter'].includes(role)) return;
    let shouldHydrate=false;
    if(!current?.matches?.('[data-role-today-work]')||current.dataset.role!==role){
      current?.remove();
      home.insertAdjacentHTML('afterbegin',todayWorkMarkup(role));
      current=home.querySelector('[data-role-today-work]');
      shouldHydrate=true;
    }
    if(current?.querySelector('.role-today-loading')) shouldHydrate=true;
    home.querySelectorAll('.v3-dashboard-card,.home-card').forEach((card,index)=>card.classList.toggle('role-secondary-home',index>4));
    if(shouldHydrate) void hydrateTodayWork();
  }
  function scheduleEnhanceHome(){
    if(enhanceQueued) return;
    enhanceQueued=true;
    queueMicrotask(enhanceHome);
  }
  async function completeTodayTask(taskId,button){
    if(!taskId||button?.disabled) return;
    const supabase=client();
    if(!supabase) return global.alert?.('Нет подключения к Supabase.');
    button.disabled=true;
    button.textContent='…';
    try{
      const result=await supabase.from('tasks').update({status:'done',completed_at:new Date().toISOString()})
        .eq('id',taskId).select('id,status,completed_at').maybeSingle();
      if(result.error) throw result.error;
      if(!result.data) throw new Error('Задача уже завершена или у вас нет доступа.');
      const row=button.closest('[data-today-task-row]');
      row?.classList.add('completed');
      button.textContent='✓';
      row?.querySelector('.role-today-status')?.replaceChildren(document.createTextNode('Завершена'));
      await hydrateTodayWork();
    }catch(error){
      console.error(error);
      button.disabled=false;
      button.textContent='○';
      global.alert?.('Не удалось завершить задачу: '+(error?.message||'проверьте подключение.'));
    }
  }
  function bind(){
    if(bound) return;
    bound=true;
    document.addEventListener('click',event=>{
      const tab=event.target.closest('[data-checklist-department-tab]');
      if(tab){event.preventDefault();setDepartment(tab.dataset.checklistDepartmentTab);rerenderChecklists();return;}
      const checklist=event.target.closest('[data-today-checklist]');
      if(checklist){event.preventDefault();openChecklist(checklist.dataset.todayChecklist);return;}
      const section=event.target.closest('[data-today-section]');
      if(section){event.preventDefault();global.setTop?.(section.dataset.todaySection);return;}
      const complete=event.target.closest('[data-today-task-complete]');
      if(complete){event.preventDefault();void completeTodayTask(complete.dataset.todayTaskComplete,complete);}
    },true);
    global.addEventListener('focus',()=>void hydrateTodayWork());
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible') void hydrateTodayWork();});
  }
  function startObserver(){
    if(observer||!global.MutationObserver) return;
    observer=new MutationObserver(scheduleEnhanceHome);
    observer.observe(document.documentElement,{childList:true,subtree:true});
  }
  function wrapRenderApp(){
    if(typeof baseRenderApp!=='function') return;
    function renderAppWithTodayWork(){
      const result=baseRenderApp.apply(this,arguments);
      scheduleEnhanceHome();
      return result;
    }
    global.renderApp=renderAppWithTodayWork;
  }
  function wrapPayload(){
    if(typeof baseSendPayload!=='function') return;
    async function sendPayloadWithTodayRefresh(payload){
      const result=await baseSendPayload.apply(this,arguments);
      if(['checklist','coffeeRevision','coffeeRevisionManual'].includes(String(payload?.payloadType||''))) queueMicrotask(()=>void hydrateTodayWork());
      return result;
    }
    global.sendPayloadToSheets=sendPayloadWithTodayRefresh;
  }

  ensureDocuments();
  if(typeof baseRenderChecklists==='function') global.renderChecklists=renderChecklists;
  wrapRenderApp();
  wrapPayload();
  bind();
  startObserver();
  activeDepartment=initialDepartment();
  global.setInterval?.(()=>{if(document.visibilityState==='visible') void hydrateTodayWork();},60000);
  scheduleEnhanceHome();

  global.SovremennikChecklistWorkflow=Object.freeze({
    renderChecklists,enhanceHome,hydrateTodayWork,openChecklist,
    activeDepartment:()=>initialDepartment(),
    waiterChecklists:()=>core.WAITER_CHECKLISTS.map(doc=>({...doc}))
  });
})(window);
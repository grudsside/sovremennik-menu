/* Современник — role-aware shell, profile and safe administrator preview. */
(function(){
  'use strict';
  const roles=window.SovremennikRoles;
  if(!roles||typeof state==='undefined') return;
  const legacy={renderApp:typeof renderApp==='function'?renderApp:null,setTop:typeof setTop==='function'?setTop:null,hasAccess:typeof hasAccess==='function'?hasAccess:null,allMainTabs:typeof allMainTabs==='function'?allMainTabs:null};
  let previewRole='';
  let bound=false;
  let watchedUserId='';
  let profileChannel=null;
  let profilePollTimer=null;
  function user(){return typeof currentUser==='function'?currentUser():null;}
  function realRole(){return roles.normalizeRole(user()?.role);}
  function displayRole(){return realRole()==='admin'&&roles.isKnown(previewRole)?previewRole:realRole();}
  function isPreview(){return realRole()==='admin'&&displayRole()!=='admin';}
  function html(v){return typeof esc==='function'?esc(v):String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
  function client(){
    if(window.sovremennikSupabase) return window.sovremennikSupabase;
    try{return typeof supa!=='undefined'?supa:null;}catch(error){return null;}
  }
  function hasRoute(target){
    if(target==='tasks') return true;
    const maintenance=Boolean(window.SovremennikMaintenance?.isClosed?.(target));
    return roles.canRoute(displayRole(),target,{maintenance,realRole:realRole()});
  }
  function safeTop(target){
    if(hasRoute(target)) return legacy.setTop?.(target);
    showDenied(target); return false;
  }
  function showDenied(){
    const panels=document.querySelector('#panels');
    if(!panels) return;
    document.querySelector('[data-role-access-denied]')?.remove();
    panels.insertAdjacentHTML('afterbegin','<section class="role-access-denied" data-role-access-denied><strong>У вас нет доступа к этому разделу</strong><p>Раздел не входит в права вашей роли или временно закрыт на техническое обслуживание.</p><button type="button" data-role-home>Вернуться на главную</button></section>');
  }
  function tabs(){
    const base=legacy.allMainTabs?legacy.allMainTabs():[];
    const byId=new Map((base||[]).map(row=>[row.id,row]));
    return roles.navigation(displayRole()).map(row=>byId.get(row.id)||{id:row.id,title:row.label});
  }
  function profileHtml(){
    const current=user()||{};
    return `<div class="role-profile-modal" data-role-profile-modal><section role="dialog" aria-modal="true" aria-labelledby="role-profile-title"><button class="role-profile-close" type="button" data-role-profile-close aria-label="Закрыть">×</button><p class="role-profile-kicker">Профиль сотрудника</p><h2 id="role-profile-title">${html(current.name||'Пользователь')}</h2><span class="role-badge role-${html(realRole())}">${html(roles.roleLabel(realRole()))}</span><dl><div><dt>Логин</dt><dd>${html(current.login||'—')}</dd></div><div><dt>Статус</dt><dd>${current.is_active===false?'Заблокирован':'Активен'}</dd></div></dl>${realRole()==='admin'?`<div class="role-preview-picker"><strong>Предпросмотр интерфейса</strong><p>Меняет только отображение. Реальные права администратора сохраняются.</p><div><button type="button" data-role-preview="admin">Администратор</button>${roles.previewRoles('admin').map(role=>`<button type="button" data-role-preview="${role}">${html(roles.roleLabel(role))}</button>`).join('')}</div></div>`:''}</section></div>`;
  }
  function openProfile(){document.querySelector('[data-role-profile-modal]')?.remove();document.body.insertAdjacentHTML('beforeend',profileHtml());document.body.classList.add('role-profile-open');}
  function closeProfile(){document.querySelector('[data-role-profile-modal]')?.remove();document.body.classList.remove('role-profile-open');}
  function previewBanner(){
    document.querySelector('[data-role-preview-banner]')?.remove();
    if(!isPreview()) return;
    document.body.insertAdjacentHTML('afterbegin',`<div class="role-preview-banner" data-role-preview-banner>Вы просматриваете интерфейс роли: <strong>${html(roles.roleLabel(displayRole()))}</strong><button type="button" data-role-preview="admin">Выйти из предпросмотра</button></div>`);
  }
  function decorateUserPanel(){
    const panel=document.querySelector('#user-panel');
    if(!panel||!user()) return;
    panel.querySelectorAll('[data-role-profile-open]').forEach(node=>node.removeAttribute('data-role-profile-open'));
    const logout=panel.querySelector('.logout-btn');
    if(logout){
      logout.querySelectorAll('.role-badge').forEach(node=>node.remove());
      logout.textContent='Выйти';
      logout.removeAttribute('role');
      logout.removeAttribute('tabindex');
    }
    let trigger=panel.querySelector('.user-chip');
    if(!trigger){
      trigger=document.createElement('button');
      trigger.className='user-chip role-profile-trigger';
      trigger.textContent=`${user()?.name||'Пользователь'} · ${roles.roleLabel(realRole())}`;
      panel.prepend(trigger);
    } else if(trigger.tagName!=='BUTTON'){
      const button=document.createElement('button');
      button.className=`${trigger.className} role-profile-trigger`.trim();
      button.innerHTML=trigger.innerHTML;
      trigger.replaceWith(button);
      trigger=button;
    }
    trigger.type='button';
    trigger.classList.add('role-profile-trigger');
    trigger.setAttribute('data-role-profile-open','');
    trigger.setAttribute('aria-haspopup','dialog');
    trigger.setAttribute('aria-label','Открыть профиль сотрудника');
  }
  function ensureAdminRoleOption(){
    if(realRole()!=='admin') return;
    document.querySelectorAll('select[name="role"],select[data-employee-role]').forEach(select=>{
      const values=new Set(Array.from(select.options).map(option=>String(option.value||'').toLowerCase()));
      if(!values.has('admin')&&['manager','barista','waiter'].some(role=>values.has(role))){
        const option=document.createElement('option');
        option.value='admin';
        option.textContent='Администратор';
        select.append(option);
      }
    });
  }
  function hideMoreNavigation(){
    document.querySelectorAll('[data-top="more"],[data-target="more"],[data-more-menu],.mobile-more,.more-menu-toggle').forEach(node=>{node.hidden=true;});
    document.querySelectorAll('.main-tabs button,.v3-side-nav button').forEach(node=>{
      if(String(node.textContent||'').trim().toLowerCase()==='ещё') node.hidden=true;
    });
  }
  function applyNavigation(){
    const allowed=new Set(tabs().map(tab=>tab.id));
    document.querySelectorAll('[data-top],.main-tabs [data-target],.v3-side-nav [data-top]').forEach(node=>{
      const id=node.dataset.top||node.dataset.target; if(id) node.hidden=!allowed.has(id);
    });
    hideMoreNavigation();
    document.body.dataset.displayRole=displayRole(); document.body.dataset.realRole=realRole();
    document.body.classList.toggle('role-preview-active',isPreview());
  }
  function primaryAction(){
    if(displayRole()==='barista') return {title:'Главное действие',text:'Проверьте активный чек-лист, ревизию по кофе и личные задачи.',target:'checklists'};
    if(displayRole()==='waiter') return {title:'Главное действие',text:'Проверьте активный чек-лист и личные задачи на смену.',target:'checklists'};
    return null;
  }
  function rows(name){
    try{const fn=window[name];const value=typeof fn==='function'?fn():[];return Array.isArray(value)?value:[];}
    catch(error){return [];}
  }
  function taskDeadline(task){return new Date(task?.deadline||task?.deadlineAt||task?.due_at||task?.dueAt||'').getTime();}
  function managerCounts(){
    const tasks=rows('getTasks');
    const checklists=rows('getControlRecords');
    const revisions=rows('getRevisionRecords');
    const problems=rows('getErrorReports');
    const now=Date.now();
    const today=new Date().toISOString().slice(0,10);
    const overdue=tasks.filter(task=>String(task.status||'open')!=='done'&&Number.isFinite(taskDeadline(task))&&taskDeadline(task)<now).length;
    const incomplete=checklists.filter(record=>{
      const items=Array.isArray(record.tasks)?record.tasks:[];
      const total=Number(record.total)||items.length;
      const done=Number(record.done)||items.filter(item=>item.checked||item.done).length;
      return total>0&&done<total;
    }).length;
    const revisionToday=revisions.some(record=>String(record.dateKey||record.revision_date||'').slice(0,10)===today);
    const newProblems=problems.filter(row=>!row.status||String(row.status).toLowerCase()==='new').length;
    return {overdue,incomplete,missingRevisions:revisionToday?0:1,newProblems,critical:0,unreadImportant:0};
  }
  function attentionButton(label,count,target){return `<button type="button" data-top-jump="${target}"><b>${Number(count)||0}</b><span>${html(label)}</span></button>`;}
  function managerHome(){
    const counts=managerCounts();
    return `<section class="role-home-intro manager" data-role-home-intro data-role-card-target="control" role="link" tabindex="0" aria-label="Открыть операционную панель"><p>Операционная панель</p><h2>Требует внимания</h2><div class="role-attention-grid">${attentionButton('Просроченные задачи',counts.overdue,'tasks')}${attentionButton('Незавершённые чек-листы',counts.incomplete,'checklists')}${attentionButton('Незаполненные ревизии',counts.missingRevisions,'revisions')}${attentionButton('Новые технические проблемы',counts.newProblems,'reportError')}${attentionButton('Критические уведомления',counts.critical,'home')}${attentionButton('Не ознакомились с информацией',counts.unreadImportant,'home')}</div><div class="role-manager-links"><button type="button" data-top-jump="schedule">Сотрудники на смене и ближайшие события</button><button type="button" data-top-jump="reportError">Проблемы и оборудование</button><button type="button" data-top-jump="theory">Обучение и аттестации</button><button type="button" data-top-jump="checklists">Информация от предыдущей смены</button><button type="button" data-top-jump="control">Последние важные действия</button></div></section>`;
  }
  function personalizeHome(){
    const home=document.querySelector('#top-home'); if(!home) return;
    home.querySelector('[data-role-home-intro]')?.remove();
    const role=displayRole();
    if(role==='manager') home.insertAdjacentHTML('afterbegin',managerHome());
    else if(role==='admin') home.insertAdjacentHTML('afterbegin','<section class="role-home-intro admin" data-role-home-intro><p>Техническая сводка</p><h2>Администрирование приложения</h2><span>Системные настройки, сотрудники, права и техническое обслуживание.</span></section>');
    else if(role==='barista'||role==='waiter'){
      const action=primaryAction();
      home.insertAdjacentHTML('afterbegin',`<section class="role-home-intro employee" data-role-home-intro data-role-card-target="${action.target}" role="link" tabindex="0" aria-label="Открыть ${html(action.title)}"><p>${html(roles.roleLabel(role))} · текущая смена</p><h2>${html(action.title)}</h2><span>${html(action.text)}</span><button type="button" data-top-jump="${action.target}">Открыть</button></section>`);
      home.querySelectorAll('.v3-dashboard-card,.home-card').forEach((card,index)=>{card.classList.toggle('role-secondary-home',index>4);});
    }
  }
  function validateRole(){
    document.body.classList.toggle('role-unknown',Boolean(user()&&!roles.isKnown(realRole())));
    if(!user()||roles.isKnown(realRole())) return true;
    console.error('Unknown or missing application role',user()?.role,user()?.id);
    const home=document.querySelector('#top-home');
    if(home&&!home.querySelector('[data-role-unknown]')) home.insertAdjacentHTML('afterbegin','<section class="role-unknown-message" data-role-unknown><strong>Роль пользователя не настроена</strong><p>Доступ ограничен. Обратитесь к администратору, чтобы исправить профиль.</p></section>');
    return false;
  }
  function clearRoleCaches(){
    for(const key of ['sovremennikUserRole','sovremennikProfileRole','sovremennikRolePermissionsV1','sovremennikRolePermissionsV2']){
      try{localStorage.removeItem(key);}catch(error){}
    }
    state.rolePermissions=null;
  }
  function syncOwnProfile(profile){
    if(!profile||profile.id!==user()?.id) return;
    const next=roles.normalizeRole(profile.role);
    const previous=realRole();
    if(profile.is_active===false&&typeof handleLogout==='function'){handleLogout();return;}
    if(next===previous) return;
    clearRoleCaches();
    previewRole='';
    state.auth.user={...state.auth.user,role:next,is_active:profile.is_active!==false};
    if(state.activeTop&&!hasRoute(state.activeTop)) state.activeTop='home';
    render();
    legacy.setTop?.(state.activeTop||'home');
  }
  async function refreshOwnProfile(){
    const current=user();
    const supabase=client();
    if(!current?.id||!supabase) return;
    const result=await supabase.from('profiles').select('id,role,is_active').eq('id',current.id).maybeSingle();
    if(result.error){console.warn('Role refresh failed',result.error);return;}
    if(result.data) syncOwnProfile(result.data);
  }
  function stopRoleWatcher(){
    const supabase=client();
    if(profileChannel&&supabase) supabase.removeChannel(profileChannel).catch(()=>{});
    profileChannel=null;
    if(profilePollTimer!==null) window.clearInterval(profilePollTimer);
    profilePollTimer=null;
    watchedUserId='';
  }
  function startRoleWatcher(){
    const current=user();
    const supabase=client();
    if(!current?.id||!supabase||watchedUserId===current.id) return;
    stopRoleWatcher();
    watchedUserId=current.id;
    profileChannel=supabase.channel(`employee-role:${current.id}`)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'profiles',filter:`id=eq.${current.id}`},payload=>syncOwnProfile(payload.new))
      .subscribe();
    profilePollTimer=window.setInterval(()=>{if(document.visibilityState==='visible') refreshOwnProfile();},45000);
  }
  function enhance(){validateRole();applyNavigation();decorateUserPanel();ensureAdminRoleOption();previewBanner();personalizeHome();startRoleWatcher();}
  function render(){const result=legacy.renderApp?.apply(this,arguments);queueMicrotask(enhance);return result;}
  function setPreview(next){
    if(realRole()!=='admin') return;
    previewRole=next==='admin'?'':roles.normalizeRole(next);
    closeProfile();
    if(state.activeTop&&!hasRoute(state.activeTop)) state.activeTop='home';
    render(); legacy.setTop?.(state.activeTop||'home');
  }
  function activateRoleCard(card){
    const target=card?.dataset?.roleCardTarget;
    if(!target) return false;
    safeTop(target);
    return true;
  }
  function bind(){
    if(bound) return; bound=true;
    document.addEventListener('click',event=>{
      const profile=event.target.closest('[data-role-profile-open]'); if(profile){event.preventDefault();openProfile();return;}
      if(event.target.closest('[data-role-profile-close]')||event.target.matches('[data-role-profile-modal]')){closeProfile();return;}
      const preview=event.target.closest('[data-role-preview]'); if(preview){event.preventDefault();setPreview(preview.dataset.rolePreview);return;}
      if(event.target.closest('[data-role-home]')){document.querySelector('[data-role-access-denied]')?.remove();safeTop('home');return;}
      const introJump=event.target.closest('[data-role-home-intro] [data-top-jump]');
      if(introJump){event.preventDefault();event.stopImmediatePropagation();safeTop(introJump.dataset.topJump);return;}
      const card=event.target.closest('[data-role-card-target]');
      if(card){event.preventDefault();event.stopImmediatePropagation();activateRoleCard(card);return;}
      const jump=event.target.closest('[data-top-jump]'); if(jump&&!hasRoute(jump.dataset.topJump)){event.preventDefault();event.stopImmediatePropagation();showDenied();}
    },true);
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape') closeProfile();
      if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-role-card-target]')){event.preventDefault();activateRoleCard(event.target);}
    });
    window.addEventListener('focus',refreshOwnProfile);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible') refreshOwnProfile();});
  }
  window.hasAccess=hasAccess=hasRoute;
  window.allMainTabs=allMainTabs=tabs;
  window.renderApp=renderApp=render;
  if(legacy.setTop) window.setTop=setTop=safeTop;
  window.SovremennikRoleInterface=Object.freeze({realRole,displayRole,isPreview,setPreview,hasRoute,can:(operation)=>roles.can(displayRole(),operation,{realRole:realRole()}),openProfile,enhance,refreshOwnProfile});
  bind();queueMicrotask(enhance);
})();
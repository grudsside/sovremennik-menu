/* Современник — role-aware shell, profile and safe administrator preview. */
(function(){
  'use strict';
  const roles=window.SovremennikRoles;
  if(!roles||typeof state==='undefined') return;
  const legacy={renderApp:typeof renderApp==='function'?renderApp:null,setTop:typeof setTop==='function'?setTop:null,hasAccess:typeof hasAccess==='function'?hasAccess:null,allMainTabs:typeof allMainTabs==='function'?allMainTabs:null};
  let previewRole='';
  let bound=false;
  function user(){return typeof currentUser==='function'?currentUser():null;}
  function realRole(){return roles.normalizeRole(user()?.role);}
  function displayRole(){return realRole()==='admin'&&roles.isKnown(previewRole)?previewRole:realRole();}
  function isPreview(){return realRole()==='admin'&&displayRole()!=='admin';}
  function html(v){return typeof esc==='function'?esc(v):String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));}
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
    const panel=document.querySelector('#user-panel'); if(!panel||!user()) return;
    const trigger=panel.querySelector('button')||panel;
    trigger.setAttribute('data-role-profile-open',''); trigger.setAttribute('role','button'); trigger.setAttribute('tabindex','0');
    if(!trigger.querySelector('.role-badge')) trigger.insertAdjacentHTML('beforeend',`<span class="role-badge role-${html(realRole())}">${html(roles.roleLabel(realRole()))}</span>`);
  }
  function applyNavigation(){
    const allowed=new Set(tabs().map(tab=>tab.id));
    document.querySelectorAll('[data-top],.main-tabs [data-target],.v3-side-nav [data-top]').forEach(node=>{
      const id=node.dataset.top||node.dataset.target; if(id) node.hidden=!allowed.has(id);
    });
    document.body.dataset.displayRole=displayRole(); document.body.dataset.realRole=realRole();
    document.body.classList.toggle('role-preview-active',isPreview());
  }
  function primaryAction(){
    if(displayRole()==='barista') return {title:'Главное действие',text:'Проверьте активный чек-лист, ревизию по кофе и личные задачи.',target:'checklists'};
    if(displayRole()==='waiter') return {title:'Главное действие',text:'Проверьте активный чек-лист и личные задачи на смену.',target:'checklists'};
    return null;
  }
  function personalizeHome(){
    const home=document.querySelector('#top-home'); if(!home) return;
    home.querySelector('[data-role-home-intro]')?.remove();
    const role=displayRole();
    if(role==='manager') home.insertAdjacentHTML('afterbegin','<section class="role-home-intro manager" data-role-home-intro><p>Операционная панель</p><h2>Требует внимания</h2><div class="role-attention-grid"><button data-top-jump="tasks">Просроченные задачи</button><button data-top-jump="checklists">Незавершённые чек-листы</button><button data-top-jump="revisions">Незаполненные ревизии</button><button data-top-jump="reportError">Новые проблемы</button><button data-top-jump="schedule">Сотрудники на смене</button><button data-top-jump="theory">Обучение и аттестации</button></div></section>');
    else if(role==='admin') home.insertAdjacentHTML('afterbegin','<section class="role-home-intro admin" data-role-home-intro><p>Техническая сводка</p><h2>Администрирование приложения</h2><span>Системные настройки, сотрудники, права и техническое обслуживание.</span></section>');
    else {
      const action=primaryAction();
      home.insertAdjacentHTML('afterbegin',`<section class="role-home-intro employee" data-role-home-intro><p>${html(roles.roleLabel(role))} · текущая смена</p><h2>${html(action.title)}</h2><span>${html(action.text)}</span><button type="button" data-top-jump="${action.target}">Открыть</button></section>`);
      home.querySelectorAll('.v3-dashboard-card,.home-card').forEach((card,index)=>{if(index>4) card.classList.add('role-secondary-home');});
    }
  }
  function validateRole(){
    if(!user()||roles.isKnown(realRole())) return true;
    console.error('Unknown or missing application role',user()?.role,user()?.id);
    document.body.classList.add('role-unknown');
    const home=document.querySelector('#top-home');
    if(home&&!home.querySelector('[data-role-unknown]')) home.insertAdjacentHTML('afterbegin','<section class="role-unknown-message" data-role-unknown><strong>Роль пользователя не настроена</strong><p>Доступ ограничен. Обратитесь к администратору, чтобы исправить профиль.</p></section>');
    return false;
  }
  function enhance(){validateRole();applyNavigation();decorateUserPanel();previewBanner();personalizeHome();}
  function render(){const result=legacy.renderApp?.apply(this,arguments);queueMicrotask(enhance);return result;}
  function setPreview(next){
    if(realRole()!=='admin') return;
    previewRole=next==='admin'?'':roles.normalizeRole(next);
    closeProfile();
    if(state.activeTop&&!hasRoute(state.activeTop)) state.activeTop='home';
    render(); legacy.setTop?.(state.activeTop||'home');
  }
  function bind(){
    if(bound) return; bound=true;
    document.addEventListener('click',event=>{
      const profile=event.target.closest('[data-role-profile-open]'); if(profile){event.preventDefault();openProfile();return;}
      if(event.target.closest('[data-role-profile-close]')||event.target.matches('[data-role-profile-modal]')){closeProfile();return;}
      const preview=event.target.closest('[data-role-preview]'); if(preview){event.preventDefault();setPreview(preview.dataset.rolePreview);return;}
      if(event.target.closest('[data-role-home]')){document.querySelector('[data-role-access-denied]')?.remove();safeTop('home');return;}
      const jump=event.target.closest('[data-top-jump]'); if(jump&&!hasRoute(jump.dataset.topJump)){event.preventDefault();event.stopImmediatePropagation();showDenied();}
    },true);
    document.addEventListener('keydown',event=>{if(event.key==='Escape') closeProfile();if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-role-profile-open]')) openProfile();});
  }
  window.hasAccess=hasAccess=hasRoute;
  window.allMainTabs=allMainTabs=tabs;
  window.renderApp=renderApp=render;
  if(legacy.setTop) window.setTop=setTop=safeTop;
  window.SovremennikRoleInterface=Object.freeze({realRole,displayRole,isPreview,setPreview,hasRoute,can:(operation)=>roles.can(displayRole(),operation,{realRole:realRole()}),openProfile,enhance});
  bind();queueMicrotask(enhance);
})();
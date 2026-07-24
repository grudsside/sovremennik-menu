/* Современник — final employee home layout: today work below welcome, no summary, barista-only handoff. */
(function(global){
  'use strict';

  const VERSION='2026-07-24-home-layout-v4-4';
  let queued=false;
  let observer=null;

  function currentProfile(){
    try{return typeof global.currentUser==='function'?global.currentUser():null;}
    catch(error){return null;}
  }

  function normalizeRole(value){
    if(typeof global.normalizeRole==='function') return global.normalizeRole(value);
    const role=String(value||'').trim().toLowerCase();
    return ({'администратор':'admin','руководитель':'manager','бариста':'barista','официант':'waiter'})[role]||role;
  }

  function displayRole(){
    const api=global.SovremennikRoleInterface;
    if(typeof api?.displayRole==='function') return api.displayRole();
    return normalizeRole(currentProfile()?.role);
  }

  function removeHandoffForWaiter(home){
    // The shift handoff feature belongs to baristas only. This also removes a
    // card that could have been mounted while an admin was previewing another role.
    home.querySelectorAll('[data-shift-handoff-incoming],[data-waiter-shift-handoff]').forEach(card=>card.remove());
  }

  function applyLayout(){
    queued=false;
    const home=document.querySelector('#top-home');
    if(!home) return;

    home.querySelectorAll('.v3-summary-card').forEach(card=>card.remove());

    const welcome=home.querySelector('.v3-welcome-card');
    const todayWork=home.querySelector('[data-role-today-work]');
    if(welcome&&todayWork&&welcome.nextElementSibling!==todayWork){
      welcome.insertAdjacentElement('afterend',todayWork);
    }

    const grid=home.querySelector('.v3-home-grid');
    if(!grid) return;

    const role=displayRole();
    const sharedHandoff=home.querySelector('[data-shift-handoff-incoming]');

    if(role==='barista'){
      grid.querySelector('.v3-shift-card')?.remove();
      home.querySelector('[data-waiter-shift-handoff]')?.remove();
      if(sharedHandoff&&grid.firstElementChild!==sharedHandoff) grid.prepend(sharedHandoff);
    }else if(role==='waiter'){
      grid.querySelector('.v3-shift-card')?.remove();
      removeHandoffForWaiter(home);
    }else{
      home.querySelector('[data-waiter-shift-handoff]')?.remove();
      if(sharedHandoff&&sharedHandoff.parentElement!==home){
        grid.insertAdjacentElement('afterend',sharedHandoff);
      }else if(sharedHandoff&&sharedHandoff.previousElementSibling!==grid){
        grid.insertAdjacentElement('afterend',sharedHandoff);
      }
    }

    document.documentElement.setAttribute('data-home-layout-v4-version',VERSION);
  }

  function queueLayout(){
    if(queued) return;
    queued=true;
    queueMicrotask(applyLayout);
  }

  function install(){
    const previousRenderApp=typeof global.renderApp==='function'?global.renderApp:null;
    if(previousRenderApp){
      global.renderApp=function(){const result=previousRenderApp.apply(this,arguments);queueLayout();return result;};
      try{renderApp=global.renderApp;}catch(error){}
    }

    const previousSetTop=typeof global.setTop==='function'?global.setTop:null;
    if(previousSetTop){
      global.setTop=function(){const result=previousSetTop.apply(this,arguments);queueLayout();return result;};
      try{setTop=global.setTop;}catch(error){}
    }

    if(global.MutationObserver&&document.body){
      observer=new MutationObserver(queueLayout);
      observer.observe(document.body,{childList:true,subtree:true});
    }

    queueLayout();
  }

  global.SovremennikHomeLayoutV4=Object.freeze({VERSION,applyLayout});
  install();
})(window);

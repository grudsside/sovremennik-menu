/* Современник: гарантированное подключение вкладки «Аттестации» после авторизации. */
(function(global){
  'use strict';

  const VERSION = '2026-07-28-attestations-tab-guard-1';
  let syncing = false;
  let retryLoaded = false;
  let retryInFlight = false;
  let observer = null;
  let timer = 0;

  function normalizedRole(){
    try{
      if(typeof normalizeRole === 'function' && typeof currentUser === 'function'){
        return normalizeRole(currentUser()?.role);
      }
      return String(typeof currentUser === 'function' ? currentUser()?.role || '' : '').trim().toLowerCase();
    }catch(error){ return ''; }
  }

  function authenticated(){
    try{ return typeof isAuthenticated === 'function' && isAuthenticated(); }
    catch(error){ return false; }
  }

  function canManage(){ return normalizedRole() === 'admin'; }
  function canTake(){ return ['barista','waiter'].includes(normalizedRole()); }
  function canOpenTop(){ return canManage() || canTake(); }

  function syncModel(){
    if(typeof state === 'undefined' || !state?.menu?.site) return false;
    const tabs = state.menu.site.mainTabs;
    if(Array.isArray(tabs) && !tabs.some(tab => tab?.id === 'attestations')){
      const before = tabs.findIndex(tab => tab?.id === 'reportError');
      tabs.splice(before >= 0 ? before : tabs.length, 0, { id:'attestations', title:'Аттестации' });
    }

    try{
      if(Array.isArray(ALL_SECTIONS) && !ALL_SECTIONS.includes('attestations')){
        const before = ALL_SECTIONS.indexOf('control');
        ALL_SECTIONS.splice(before >= 0 ? before : ALL_SECTIONS.length, 0, 'attestations');
      }
      ['barista','waiter'].forEach(role => {
        const defaults = DEFAULT_ACCESS_BY_ROLE?.[role];
        if(Array.isArray(defaults) && !defaults.includes('attestations')){
          const before = defaults.indexOf('reportError');
          defaults.splice(before >= 0 ? before : defaults.length, 0, 'attestations');
        }
        const active = state.rolePermissions?.[role];
        if(Array.isArray(active) && !active.includes('attestations')) active.push('attestations');
      });
    }catch(error){ console.warn('Attestations guard could not extend access model.', error); }
    return true;
  }

  function activatePanel(){
    if(typeof state !== 'undefined') state.activeTop = 'attestations';
    document.querySelectorAll('.main-tab').forEach(button => {
      button.classList.toggle('active', button.dataset.topTarget === 'attestations');
    });
    document.querySelectorAll('.top-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === 'top-attestations');
    });
    try{
      if(typeof setTop === 'function') setTop('attestations');
    }catch(error){ console.warn('Attestations guard could not use setTop.', error); }
  }

  function ensureButton(){
    const nav = document.querySelector('.main-tabs');
    if(!nav) return false;
    const existing = nav.querySelector('[data-top-target="attestations"]');
    if(!canOpenTop()){
      existing?.remove();
      return true;
    }
    if(existing) return true;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'main-tab';
    button.dataset.topTarget = 'attestations';
    button.textContent = 'Аттестации';
    button.addEventListener('click', activatePanel);
    const reportButton = nav.querySelector('[data-top-target="reportError"]');
    nav.insertBefore(button, reportButton || null);
    return true;
  }

  function reloadFeatureOnce(){
    if(retryLoaded || retryInFlight || !authenticated() || !canOpenTop()) return;
    if(document.querySelector('#top-attestations')) return;
    retryInFlight = true;
    const script = document.createElement('script');
    script.src = `assets/js/attestations-preview.js?v=20260728-auth-ready-1`;
    script.async = false;
    script.onload = () => {
      retryLoaded = true;
      retryInFlight = false;
      queueMicrotask(scheduleSync);
    };
    script.onerror = () => {
      retryInFlight = false;
      console.error('Attestations guard could not reload the feature module.');
    };
    document.head.appendChild(script);
  }

  function renderReadyApplication(){
    if(!authenticated() || !canOpenTop() || document.querySelector('#top-attestations')) return;
    try{
      if(typeof renderApp === 'function') renderApp();
    }catch(error){ console.warn('Attestations guard render retry failed.', error); }
    if(!document.querySelector('#top-attestations')) reloadFeatureOnce();
  }

  function sync(){
    if(syncing) return;
    syncing = true;
    try{
      global.SovAttestationsTabGuard = {
        version: VERSION,
        authenticated: authenticated(),
        role: normalizedRole(),
        coreLoaded: Boolean(global.SovAttestationsCore),
        featurePanel: Boolean(document.querySelector('#top-attestations')),
        retryLoaded
      };
      if(!authenticated()) return;
      syncModel();
      ensureButton();
      renderReadyApplication();
      ensureButton();
      global.SovAttestationsTabGuard.featurePanel = Boolean(document.querySelector('#top-attestations'));
    }finally{
      syncing = false;
    }
  }

  function scheduleSync(){
    clearTimeout(timer);
    timer = setTimeout(sync, 30);
  }

  observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, { childList:true, subtree:true });
  document.addEventListener('submit', event => {
    if(event.target?.id === 'login-form'){
      setTimeout(sync, 150);
      setTimeout(sync, 700);
      setTimeout(sync, 1800);
    }
  }, true);
  window.addEventListener('hashchange', scheduleSync);
  setInterval(sync, 1500);
  sync();
})(window);

/* Современник mobile active-panel renderer — keep only the visible section in the mobile DOM */
(function(){
  'use strict';

  const VERSION = '2026-07-19-mobile-active-panel-2';
  const QUERY = '(max-width: 920px), (pointer: coarse)';
  const media = window.matchMedia(QUERY);
  const renderAppBeforeLean = typeof renderApp === 'function' ? renderApp : null;
  const setTopBeforeLean = typeof setTop === 'function' ? setTop : null;
  let modeWasMobile = media.matches;
  let rendering = false;

  function isMobile(){
    return media.matches;
  }

  function activeTop(){
    return typeof state !== 'undefined' && state?.activeTop ? state.activeTop : 'home';
  }

  function activePanel(){
    return document.querySelector(`#top-${CSS.escape(activeTop())}`);
  }

  function closeOrphanTaskModal(){
    if(activeTop() === 'tasks') return;
    document.querySelectorAll('body > #task-modal').forEach(modal => modal.remove());
    document.body.classList.remove('task-modal-open', 'task-form-panel-open');
  }

  function pruneInactivePanels(){
    if(!isMobile()){
      document.body.classList.remove('mobile-active-panel-only');
      return;
    }

    const panels = document.querySelector('#panels');
    if(!panels) return;
    const keepId = `top-${activeTop()}`;
    Array.from(panels.children).forEach(node => {
      if(node.classList?.contains('top-panel') && node.id !== keepId) node.remove();
    });

    const current = panels.querySelector(`#${CSS.escape(keepId)}`);
    if(current){
      current.classList.add('active');
      current.removeAttribute('aria-hidden');
    }
    closeOrphanTaskModal();
    document.body.classList.add('mobile-active-panel-only');
    document.documentElement.dataset.mobilePanelCount = String(panels.querySelectorAll(':scope > .top-panel').length);
  }

  function renderAppLean(...args){
    if(!renderAppBeforeLean || rendering) return;
    rendering = true;
    try {
      const result = renderAppBeforeLean.apply(this, args);
      pruneInactivePanels();
      return result;
    } finally {
      rendering = false;
    }
  }

  function setTopLean(target, ...args){
    if(!setTopBeforeLean) return;
    if(!isMobile()) return setTopBeforeLean.call(this, target, ...args);

    const result = setTopBeforeLean.call(this, target, ...args);
    const expected = document.querySelector(`#top-${CSS.escape(activeTop())}`);
    if(!expected) renderAppLean();
    else pruneInactivePanels();
    return result;
  }

  if(renderAppBeforeLean){
    window.renderApp = renderAppLean;
    if(typeof renderApp !== 'undefined') renderApp = renderAppLean;
  }
  if(setTopBeforeLean){
    window.setTop = setTopLean;
    if(typeof setTop !== 'undefined') setTop = setTopLean;
  }

  function handleModeChange(){
    const mobile = isMobile();
    if(mobile === modeWasMobile) return;
    modeWasMobile = mobile;
    if(renderAppBeforeLean) renderAppLean();
  }

  media.addEventListener?.('change', handleModeChange);
  window.addEventListener('orientationchange', () => window.setTimeout(handleModeChange, 120), { passive:true });
  window.addEventListener('pageshow', pruneInactivePanels, { passive:true });

  document.documentElement.dataset.mobileActivePanelVersion = VERSION;
  pruneInactivePanels();
})();

/* Современник: do not render the application while menu data is temporarily unavailable. */
(function(){
  'use strict';

  const renderBeforeGuard = typeof renderApp === 'function' ? renderApp : window.renderApp;
  if(typeof renderBeforeGuard !== 'function') return;

  let retryScheduled = false;
  function guardedRenderApp(...args){
    if(typeof state !== 'undefined' && !state.menu){
      if(!retryScheduled){
        retryScheduled = true;
        setTimeout(() => {
          retryScheduled = false;
          if(typeof state !== 'undefined' && state.menu) guardedRenderApp(...args);
        }, 0);
      }
      return;
    }
    return renderBeforeGuard.apply(this, args);
  }

  window.renderApp = guardedRenderApp;
  try { renderApp = guardedRenderApp; } catch(error){}
})();

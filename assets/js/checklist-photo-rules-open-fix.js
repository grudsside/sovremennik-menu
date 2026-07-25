/* Современник — keep the photo-report settings panel open across background redraws. */
(function(global){
  'use strict';

  const VERSION = '2026-07-25-photo-rules-open-2';
  const SELECTOR = '[data-photo-rules-card],.checklist-photo-rules-card';
  let desiredOpen = null;
  let restoreQueued = false;
  let observer = null;

  function card(){ return document.querySelector(SELECTOR); }

  function remember(details){
    if(!details || !details.matches?.(SELECTOR)) return;
    if(!details.isConnected || card() !== details) return;
    desiredOpen = Boolean(details.open);
  }

  function restore(){
    const details = card();
    if(!details || desiredOpen === null || details.open === desiredOpen) return;
    details.open = desiredOpen;
  }

  function queueRestore(){
    if(restoreQueued) return;
    restoreQueued = true;
    requestAnimationFrame(() => {
      restoreQueued = false;
      restore();
      setTimeout(restore, 30);
      setTimeout(restore, 180);
    });
  }

  document.addEventListener('toggle', event => {
    if(event.target instanceof HTMLDetailsElement && event.target.matches(SELECTOR)) remember(event.target);
  }, true);

  const startObserver = () => {
    if(observer || !global.MutationObserver) return;
    observer = new MutationObserver(records => {
      const replaced = records.some(record => {
        const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
        if(target?.matches?.('#checklist-photo-rules-admin') || target?.closest?.('#checklist-photo-rules-admin')) return true;
        return Array.from(record.addedNodes || []).some(node =>
          node.nodeType === 1 && (node.matches?.(SELECTOR) || node.querySelector?.(SELECTOR))
        );
      });
      if(replaced){
        restore();
        queueRestore();
      }
    });
    observer.observe(document.body, { childList:true, subtree:true });
  };

  const initial = card();
  if(initial?.open) desiredOpen = true;
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once:true });
  else startObserver();
  queueRestore();

  global.SovremennikPhotoRulesOpenFix = Object.freeze({
    VERSION,
    restore,
    queueRestore,
    get desiredOpen(){ return desiredOpen; },
    setOpenForTesting(value){ desiredOpen = Boolean(value); queueRestore(); }
  });
})(window);

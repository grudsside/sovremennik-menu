/* Современник — Control viewport jitter guard for desktop and mobile. */
(function(global){
  'use strict';

  if(global.SovremennikControlViewportJitterFix) return;

  const VERSION = '2026-07-30-control-viewport-jitter-1';
  const USER_INTENT_MS = 240;
  const VIEWPORT_HOLD_MS = 1800;
  const TOGGLE_HOLD_MS = 1200;
  const nativeScrollBy = global.scrollBy.bind(global);
  const nativeScrollTo = global.scrollTo.bind(global);

  let userIntentUntil = 0;
  let viewportHoldUntil = 0;
  let desiredScrollY = Number(global.scrollY || 0);
  let scrollbarDrag = false;
  let internalScrollUntil = 0;
  let toggleAnchor = null;
  let frame = 0;

  function activeControl(){
    const root = document.querySelector('#top-control');
    return Boolean(root?.isConnected && root.classList.contains('active') && root.getClientRects().length);
  }

  function maxScrollY(){
    return Math.max(0, Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0) - (global.innerHeight || 0));
  }

  function clampScrollY(value){
    const number = Number(value || 0);
    return Math.min(maxScrollY(), Math.max(0, Number.isFinite(number) ? number : 0));
  }

  function hasUserIntent(){
    return scrollbarDrag || Date.now() < userIntentUntil;
  }

  function schedule(){
    if(frame) return;
    frame = global.requestAnimationFrame(tick);
  }

  function markUserIntent(duration = USER_INTENT_MS){
    const now = Date.now();
    userIntentUntil = Math.max(userIntentUntil, now + duration);
    viewportHoldUntil = Math.max(viewportHoldUntil, now + VIEWPORT_HOLD_MS);
    toggleAnchor = null;
    schedule();
  }

  function runInternalScroll(callback){
    internalScrollUntil = Date.now() + 100;
    callback();
  }

  function correctViewport(){
    const target = clampScrollY(desiredScrollY);
    if(Math.abs(Number(global.scrollY || 0) - target) <= 1) return;
    runInternalScroll(() => nativeScrollTo(0, target));
  }

  function correctToggleAnchor(){
    const anchor = toggleAnchor;
    if(!anchor || Date.now() >= anchor.until || hasUserIntent()){
      toggleAnchor = null;
      return;
    }
    if(!anchor.summary?.isConnected){
      toggleAnchor = null;
      return;
    }
    const currentTop = anchor.summary.getBoundingClientRect().top;
    const delta = currentTop - anchor.top;
    if(!Number.isFinite(delta) || Math.abs(delta) <= 1) return;
    runInternalScroll(() => nativeScrollBy(0, delta));
    desiredScrollY = Number(global.scrollY || desiredScrollY);
  }

  function tick(){
    frame = 0;
    const now = Date.now();
    if(!activeControl()){
      toggleAnchor = null;
      return;
    }
    correctToggleAnchor();
    if(now < viewportHoldUntil && !hasUserIntent()) correctViewport();
    if((toggleAnchor && now < toggleAnchor.until) || now < viewportHoldUntil) schedule();
  }

  function summaryFor(target){
    const summary = target?.closest?.('#top-control details > summary');
    if(!summary || target.closest?.('button,a,input,select,textarea,label')) return null;
    const details = summary.parentElement;
    return details instanceof HTMLDetailsElement && summary === details.querySelector(':scope > summary') ? summary : null;
  }

  function beginToggleGuard(summary){
    if(!summary || !activeControl()) return;
    const now = Date.now();
    desiredScrollY = Number(global.scrollY || 0);
    viewportHoldUntil = Math.max(viewportHoldUntil, now + VIEWPORT_HOLD_MS);
    toggleAnchor = { summary, top:summary.getBoundingClientRect().top, until:now + TOGGLE_HOLD_MS };
    schedule();
  }

  function verticalDelta(args){
    const first = args[0];
    if(first && typeof first === 'object') return Number(first.top ?? first.y ?? 0);
    return Number(args[1] ?? 0);
  }

  function verticalTarget(args){
    const first = args[0];
    if(first && typeof first === 'object') return Number(first.top ?? first.y ?? global.scrollY ?? 0);
    return Number(args[1] ?? 0);
  }

  global.scrollBy = function(){
    const args = Array.from(arguments);
    const delta = verticalDelta(args);
    if(activeControl() && Date.now() < viewportHoldUntil && !hasUserIntent() && Math.abs(delta) > 0.5) return undefined;
    return nativeScrollBy(...args);
  };

  global.scrollTo = function(){
    const args = Array.from(arguments);
    const target = verticalTarget(args);
    if(activeControl() && Date.now() < viewportHoldUntil && !hasUserIntent() && Number.isFinite(target) && Math.abs(target - Number(global.scrollY || 0)) > 0.5) return undefined;
    return nativeScrollTo(...args);
  };

  global.addEventListener('wheel', () => markUserIntent(), { passive:true, capture:true });
  global.addEventListener('touchmove', () => markUserIntent(), { passive:true, capture:true });
  global.addEventListener('keydown', event => {
    if(!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key)) return;
    const summary = summaryFor(event.target);
    if(summary && ['Enter',' '].includes(event.key)) beginToggleGuard(summary);
    else markUserIntent(360);
  }, true);

  document.addEventListener('pointerdown', event => {
    const summary = summaryFor(event.target);
    if(summary){ beginToggleGuard(summary); return; }
    if(event.clientX >= (global.innerWidth || 0) - 24){
      scrollbarDrag = true;
      markUserIntent(1000);
    }
  }, true);

  document.addEventListener('pointermove', () => {
    if(scrollbarDrag) markUserIntent(1000);
  }, true);

  const finishScrollbarDrag = () => {
    if(!scrollbarDrag) return;
    scrollbarDrag = false;
    desiredScrollY = Number(global.scrollY || 0);
    viewportHoldUntil = Math.max(viewportHoldUntil, Date.now() + VIEWPORT_HOLD_MS);
    schedule();
  };
  document.addEventListener('pointerup', finishScrollbarDrag, true);
  document.addEventListener('pointercancel', finishScrollbarDrag, true);

  global.addEventListener('scroll', () => {
    const now = Date.now();
    if(now < internalScrollUntil) return;
    if(hasUserIntent()){
      desiredScrollY = Number(global.scrollY || 0);
      viewportHoldUntil = Math.max(viewportHoldUntil, now + VIEWPORT_HOLD_MS);
      schedule();
      return;
    }
    if(activeControl() && now < viewportHoldUntil) schedule();
  }, { passive:true });

  global.SovremennikControlViewportJitterFix = Object.freeze({
    VERSION,
    get desiredScrollY(){ return desiredScrollY; },
    get viewportHoldUntil(){ return viewportHoldUntil; }
  });
})(window);

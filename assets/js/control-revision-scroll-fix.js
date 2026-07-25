/* Современник — stable Control revisions and viewport across background redraws. */
(function(global){
  'use strict';

  const VERSION = '2026-07-25-control-revision-scroll-1';
  const INTENT_TTL_MS = 20000;
  const ANCHOR_TTL_MS = 1500;
  const openState = new Map();
  const intents = new Map();
  let observer = null;
  let restoreQueued = false;
  let pendingAnchor = null;
  let lastAnchor = null;
  let restoring = false;

  function normalize(value){ return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 240); }
  function hash(value){
    const text = String(value || '');
    let result = 2166136261;
    for(let index = 0; index < text.length; index += 1){
      result ^= text.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  }
  function topControl(){ return document.querySelector('#top-control'); }
  function insidePhotoRules(details){ return Boolean(details?.closest?.('[data-photo-rules-card],.checklist-photo-rules-card')); }
  function revisionDetails(){
    const root = topControl();
    if(!root) return [];
    return Array.from(root.querySelectorAll('details')).filter(details =>
      details.isConnected && !details.closest('#control-records') && !insidePhotoRules(details)
    );
  }
  function datasetIdentity(node){
    if(!node?.dataset) return '';
    return Object.entries(node.dataset)
      .filter(([name, value]) => /(revision|record|date|key|id)/i.test(name) && normalize(value))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}:${normalize(value)}`)
      .join('|');
  }
  function revisionKey(details){
    if(!details) return '';
    if(details.id) return `control-revision-id:${details.id}`;
    const folder = details.closest('.control-folder') || topControl();
    const owner = details.closest('[data-revision-id],[data-revision-date],[data-revision-key],[data-record-id],[data-date-key]');
    const data = datasetIdentity(details) || (owner && owner !== details ? datasetIdentity(owner) : '');
    const summary = normalize(details.querySelector(':scope > summary')?.textContent || '');
    const row = details.closest('tr');
    const rowText = row ? normalize(Array.from(row.children || []).slice(0, 4).map(cell => cell.textContent || '').join('|')) : '';
    const classes = Array.from(details.classList || []).sort().join('.') || 'details';
    const position = folder ? Array.from(folder.querySelectorAll('details')).indexOf(details) : -1;
    const stable = [folder?.id || '', data, rowText, summary, classes].filter(Boolean).join('||');
    return stable ? `control-revision:${hash(stable)}:${position}` : '';
  }
  function unifiedKey(details){
    if(details?.closest?.('#control-records')){
      const baseKey = global.SovremennikChecklistUiStateFix?.detailKey?.(details);
      return baseKey ? `base:${baseKey}` : '';
    }
    const key = revisionKey(details);
    return key ? `revision:${key}` : '';
  }
  function currentIntent(key){
    const row = intents.get(key);
    if(!row) return null;
    if(row.expiresAt <= Date.now()){
      intents.delete(key);
      return null;
    }
    return row;
  }
  function captureState(){
    revisionDetails().forEach(details => {
      const key = revisionKey(details);
      if(!key) return;
      const intent = currentIntent(key);
      if(intent && Boolean(details.open) !== intent.open) return;
      openState.set(key, Boolean(details.open));
    });
  }
  function restoreState(){
    revisionDetails().forEach(details => {
      const key = revisionKey(details);
      if(!key) return;
      const intent = currentIntent(key);
      const desired = intent ? intent.open : openState.get(key);
      if(typeof desired === 'boolean' && details.open !== desired) details.open = desired;
    });
  }
  function activeFolder(){
    const root = topControl();
    return root?.querySelector('.control-folder.active') || root;
  }
  function allAnchorDetails(){
    const folder = activeFolder();
    return folder ? Array.from(folder.querySelectorAll('details')).filter(details => !insidePhotoRules(details) && unifiedKey(details)) : [];
  }
  function captureAnchor(){
    const root = topControl();
    if(!root || root.getClientRects().length === 0) return null;
    const rows = allAnchorDetails();
    if(!rows.length) return null;
    const viewportHeight = Math.max(1, global.innerHeight || document.documentElement.clientHeight || 1);
    const referenceY = Math.min(viewportHeight - 1, Math.max(72, Math.round(viewportHeight * 0.28)));
    const containing = rows.map(details => ({ details, rect:details.getBoundingClientRect() }))
      .filter(row => row.rect.top <= referenceY && row.rect.bottom >= referenceY)
      .sort((left, right) => left.rect.height - right.rect.height);
    const chosen = containing[0]?.details || rows.map(details => ({
      details,
      distance:Math.abs((details.querySelector(':scope > summary') || details).getBoundingClientRect().top - referenceY)
    })).sort((left, right) => left.distance - right.distance)[0]?.details;
    if(!chosen) return null;
    const summary = chosen.querySelector(':scope > summary') || chosen;
    return {
      key:unifiedKey(chosen),
      top:summary.getBoundingClientRect().top,
      scrollY:Number(global.scrollY || global.pageYOffset || 0),
      capturedAt:Date.now(),
      lastRestored:null
    };
  }
  function findAnchorDetails(key){ return allAnchorDetails().find(details => unifiedKey(details) === key) || null; }
  function restoreAnchor(anchor){
    if(!anchor || Date.now() - anchor.capturedAt > ANCHOR_TTL_MS) return;
    if(anchor.lastRestored !== null && Math.abs((global.scrollY || 0) - anchor.lastRestored) > 32) return;
    const details = findAnchorDetails(anchor.key);
    if(details){
      const summary = details.querySelector(':scope > summary') || details;
      const delta = summary.getBoundingClientRect().top - anchor.top;
      if(Number.isFinite(delta) && Math.abs(delta) > 0.5) global.scrollBy(0, delta);
    } else if(Math.abs((global.scrollY || 0) - anchor.scrollY) > 0.5){
      global.scrollTo(0, anchor.scrollY);
    }
    anchor.lastRestored = Number(global.scrollY || global.pageYOffset || 0);
    lastAnchor = anchor;
  }
  function restore(anchor = null){
    restoring = true;
    try{
      restoreState();
      restoreAnchor(anchor);
    } finally {
      restoring = false;
    }
  }
  function queueRestore(anchor = null){
    if(anchor) pendingAnchor = anchor;
    if(restoreQueued) return;
    restoreQueued = true;
    requestAnimationFrame(() => {
      restoreQueued = false;
      const nextAnchor = pendingAnchor;
      pendingAnchor = null;
      restore(nextAnchor);
      setTimeout(() => restore(), 50);
      setTimeout(() => restore(), 220);
    });
  }
  function wrapRender(name){
    const original = global[name];
    if(typeof original !== 'function' || original.__controlRevisionScrollWrapped) return;
    function wrapped(){
      observer?.takeRecords();
      const anchor = captureAnchor();
      if(anchor) lastAnchor = anchor;
      captureState();
      const result = original.apply(this, arguments);
      restore(anchor);
      queueRestore(anchor);
      if(result && typeof result.then === 'function') result.finally(() => queueRestore(captureAnchor()));
      return result;
    }
    wrapped.__controlRevisionScrollWrapped = true;
    wrapped.__controlRevisionScrollOriginal = original;
    global[name] = wrapped;
    try{
      if(name === 'renderApp') renderApp = wrapped;
      if(name === 'refreshControl') refreshControl = wrapped;
    } catch(error){}
  }

  document.addEventListener('click', event => {
    const summary = event.target.closest?.('#top-control details > summary');
    if(!summary || event.defaultPrevented) return;
    const details = summary.parentElement;
    if(!(details instanceof HTMLDetailsElement) || details.closest('#control-records') || insidePhotoRules(details)) return;
    if(summary !== details.querySelector(':scope > summary')) return;
    if(event.button !== undefined && event.button !== 0) return;
    if(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if(event.target.closest?.('button,a,input,select,textarea')) return;
    const key = revisionKey(details);
    if(!key) return;
    lastAnchor = captureAnchor();
    const desired = !details.open;
    openState.set(key, desired);
    intents.set(key, { open:desired, expiresAt:Date.now() + INTENT_TTL_MS });
    event.preventDefault();
    details.open = desired;
    queueRestore();
  }, true);

  document.addEventListener('toggle', event => {
    const details = event.target;
    if(restoring || !(details instanceof HTMLDetailsElement) || !details.isConnected) return;
    if(details.closest('#control-records') || !details.closest('#top-control') || insidePhotoRules(details)) return;
    const key = revisionKey(details);
    if(!key) return;
    const intent = currentIntent(key);
    if(intent && Boolean(details.open) !== intent.open){
      details.open = intent.open;
      return;
    }
    openState.set(key, Boolean(details.open));
  }, true);

  const startObserver = () => {
    const root = topControl();
    if(!root || !global.MutationObserver) return;
    observer = new MutationObserver(records => {
      const nodes = records.flatMap(record => [...Array.from(record.addedNodes || []), ...Array.from(record.removedNodes || [])]);
      const relevant = nodes.some(node => node.nodeType === 1 && (node.matches?.('details,.control-folder,#revision-records') || node.querySelector?.('details,.control-folder,#revision-records')));
      if(!relevant) return;
      const anchor = lastAnchor && Date.now() - lastAnchor.capturedAt <= ANCHOR_TTL_MS ? lastAnchor : null;
      queueRestore(anchor);
    });
    observer.observe(root, { childList:true, subtree:true });
  };

  captureState();
  lastAnchor = captureAnchor();
  wrapRender('renderApp');
  wrapRender('refreshControl');
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once:true });
  else startObserver();
  queueRestore();

  global.SovremennikControlRevisionScrollFix = Object.freeze({
    VERSION,
    revisionKey,
    captureState,
    restoreState,
    captureAnchor,
    restoreAnchor,
    openState,
    intents
  });
})(window);

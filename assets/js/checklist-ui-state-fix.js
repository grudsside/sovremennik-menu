/* Современник — preserve Control/checklist UI state and viewport across background renders. */
(function(global){
  'use strict';

  const VERSION = '2026-07-25-checklist-ui-state-4';
  const USER_INTENT_TTL_MS = 20000;
  const VIEWPORT_ANCHOR_TTL_MS = 1500;
  const openState = new Map();
  const userIntents = new Map();
  const checklistState = new Map();
  const commentState = new Map();
  let restoreQueued = false;
  let pendingViewportAnchor = null;
  let lastViewportAnchor = null;
  let restoring = false;
  let observer = null;
  let scrollCaptureQueued = false;

  function normalizeKeyPart(value){
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
  }

  function hashText(value){
    const text = String(value || '');
    let hash = 2166136261;
    for(let index = 0; index < text.length; index += 1){
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function datasetIdentity(node){
    if(!node?.dataset) return '';
    const preferred = [
      'checklistSubmission', 'revisionId', 'revisionDate', 'revisionKey',
      'recordId', 'entryId', 'rowId', 'submissionId', 'dateKey', 'id', 'key'
    ];
    const parts = [];
    preferred.forEach(name => {
      const value = normalizeKeyPart(node.dataset[name]);
      if(value) parts.push(`${name}:${value}`);
    });
    if(parts.length) return parts.join('|');
    return Object.entries(node.dataset)
      .filter(([name, value]) => /(revision|record|submission|date|key|id)/i.test(name) && normalizeKeyPart(value))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}:${normalizeKeyPart(value)}`)
      .join('|');
  }

  function genericControlKey(details){
    const directIdentity = datasetIdentity(details);
    const owner = details.closest?.(
      '[data-revision-id],[data-revision-date],[data-revision-key],[data-record-id],[data-entry-id],[data-row-id],[data-date-key],[data-submission-id]'
    );
    const ownerIdentity = owner && owner !== details ? datasetIdentity(owner) : '';
    const summary = normalizeKeyPart(details.querySelector(':scope > summary')?.textContent || '');
    const row = details.closest?.('tr');
    const rowIdentity = row
      ? normalizeKeyPart(Array.from(row.children || []).slice(0, 4).map(cell => cell.textContent || '').join('|'))
      : '';
    const article = details.closest?.('article');
    const articleIdentity = article && article !== details
      ? normalizeKeyPart(article.querySelector('h2,h3,h4,strong,[data-title]')?.textContent || '')
      : '';
    const classes = Array.from(details.classList || []).sort().join('.') || 'details';
    const root = details.closest?.('#control-records');
    const position = root ? Array.from(root.querySelectorAll('details')).indexOf(details) : -1;
    const fingerprint = [directIdentity, ownerIdentity, rowIdentity, articleIdentity, summary, classes].filter(Boolean).join('||');
    if(!fingerprint && position < 0) return '';
    return `control-generic:${hashText(fingerprint || `${classes}:${position}`)}:${position}`;
  }

  function detailKey(details){
    if(!details) return '';
    const card = details.closest?.('.doc-card[data-checklist-id]');
    if(card && details.matches('.doc-details')) return `checklist:${card.dataset.checklistId}:main`;
    if(details.matches('[data-photo-rules-card],.checklist-photo-rules-card')) return 'control:photo-rules';
    if(details.matches('.checklist-submission-details[data-checklist-submission]')) return `submission:${details.dataset.checklistSubmission}`;
    if(details.matches('.control-day-group')){
      const label = details.querySelector(':scope>summary strong')?.textContent?.trim() || '';
      return label ? `control-day:${label}` : genericControlKey(details);
    }
    const submission = details.closest?.('[data-checklist-submission]');
    if(submission){
      const classes = Array.from(details.classList || []).sort().join('.') || details.tagName.toLowerCase();
      return `submission-child:${submission.dataset.checklistSubmission}:${classes}`;
    }
    if(details.id) return `details-id:${details.id}`;
    if(details.closest?.('#control-records')) return genericControlKey(details);
    return '';
  }

  function currentIntent(key){
    const intent = userIntents.get(key);
    if(!intent) return null;
    if(intent.expiresAt <= Date.now()){
      userIntents.delete(key);
      return null;
    }
    return intent;
  }

  function rememberUserIntent(details, open){
    const key = detailKey(details);
    if(!key) return;
    const desired = Boolean(open);
    openState.set(key, desired);
    userIntents.set(key, { open:desired, expiresAt:Date.now() + USER_INTENT_TTL_MS });
    if(details.open !== desired) details.open = desired;
  }

  function itemKey(input, index){
    return String(input?.dataset?.photoItemKey || input?.dataset?.task || index);
  }

  function rememberChecklist(card){
    const id = String(card?.dataset?.checklistId || '');
    if(!id) return;
    const checks = Array.from(card.querySelectorAll('.task-checkbox')).map((input, index) => ({
      key:itemKey(input, index),
      checked:Boolean(input.checked)
    }));
    checklistState.set(id, {
      employeeName:String(card.querySelector('.employee-name')?.value || ''),
      checks
    });
  }

  function rememberCommentForm(form){
    const id = String(form?.dataset?.submissionId || '');
    if(!id) return;
    commentState.set(id, {
      assigneeId:String(form.elements?.assigneeId?.value || ''),
      body:String(form.elements?.body?.value || '')
    });
  }

  function managedDetails(){
    return Array.from(document.querySelectorAll('#top-checklists details,#control-records details'))
      .filter(details => details.isConnected && detailKey(details));
  }

  function captureCurrent(){
    managedDetails().forEach(details => {
      const key = detailKey(details);
      const intent = currentIntent(key);
      if(intent && Boolean(details.open) !== intent.open) return;
      openState.set(key, Boolean(details.open));
    });
    document.querySelectorAll('.doc-card[data-checklist-id]').forEach(rememberChecklist);
    document.querySelectorAll('[data-checklist-comment-form]').forEach(rememberCommentForm);
  }

  function findDetailsByKey(key){
    if(!key) return null;
    return managedDetails().find(details => detailKey(details) === key) || null;
  }

  function captureViewportAnchor(){
    const control = document.querySelector('#control-records');
    if(!control || control.getClientRects().length === 0) return null;
    const detailsRows = managedDetails().filter(details => details.closest('#control-records'));
    if(!detailsRows.length) return null;
    const viewportHeight = Math.max(1, global.innerHeight || document.documentElement.clientHeight || 1);
    const referenceY = Math.min(viewportHeight - 1, Math.max(72, Math.round(viewportHeight * 0.28)));
    const containing = detailsRows.map(details => ({ details, rect:details.getBoundingClientRect() }))
      .filter(row => row.rect.top <= referenceY && row.rect.bottom >= referenceY)
      .sort((left, right) => left.rect.height - right.rect.height);
    let chosen = containing[0]?.details || null;
    if(!chosen){
      chosen = detailsRows.map(details => ({
        details,
        distance:Math.abs((details.querySelector(':scope > summary') || details).getBoundingClientRect().top - referenceY)
      })).sort((left, right) => left.distance - right.distance)[0]?.details || null;
    }
    if(!chosen) return null;
    const key = detailKey(chosen);
    const summary = chosen.querySelector(':scope > summary') || chosen;
    return {
      key,
      summaryTop:summary.getBoundingClientRect().top,
      scrollY:Number(global.scrollY || global.pageYOffset || 0),
      capturedAt:Date.now(),
      lastRestoredScrollY:null
    };
  }

  function restoreViewport(anchor){
    if(!anchor || Date.now() - anchor.capturedAt > VIEWPORT_ANCHOR_TTL_MS) return;
    if(anchor.lastRestoredScrollY !== null && Math.abs((global.scrollY || 0) - anchor.lastRestoredScrollY) > 32) return;
    const details = findDetailsByKey(anchor.key);
    if(details){
      const summary = details.querySelector(':scope > summary') || details;
      const delta = summary.getBoundingClientRect().top - anchor.summaryTop;
      if(Number.isFinite(delta) && Math.abs(delta) > 0.5) global.scrollBy(0, delta);
    } else if(Math.abs((global.scrollY || 0) - anchor.scrollY) > 0.5){
      global.scrollTo(0, anchor.scrollY);
    }
    anchor.lastRestoredScrollY = Number(global.scrollY || global.pageYOffset || 0);
    lastViewportAnchor = anchor;
  }

  function restoreDetails(){
    managedDetails().forEach(details => {
      const key = detailKey(details);
      const intent = currentIntent(key);
      const desired = intent ? intent.open : openState.get(key);
      if(typeof desired === 'boolean' && details.open !== desired) details.open = desired;
    });
  }

  function restoreChecklists(){
    document.querySelectorAll('.doc-card[data-checklist-id]').forEach(card => {
      const saved = checklistState.get(String(card.dataset.checklistId || ''));
      if(!saved) return;
      const name = card.querySelector('.employee-name');
      if(name && !name.value && saved.employeeName) name.value = saved.employeeName;
      const byKey = new Map(saved.checks.map(row => [row.key, row.checked]));
      Array.from(card.querySelectorAll('.task-checkbox')).forEach((input, index) => {
        const key = itemKey(input, index);
        if(byKey.has(key)) input.checked = Boolean(byKey.get(key));
      });
    });
  }

  function restoreComments(){
    document.querySelectorAll('[data-checklist-comment-form]').forEach(form => {
      const saved = commentState.get(String(form.dataset.submissionId || ''));
      if(!saved) return;
      if(form.elements?.assigneeId && saved.assigneeId) form.elements.assigneeId.value = saved.assigneeId;
      if(form.elements?.body && !form.elements.body.value) form.elements.body.value = saved.body;
    });
  }

  function restoreCurrent(viewportAnchor = null){
    restoring = true;
    try{
      restoreDetails();
      restoreChecklists();
      restoreComments();
      restoreViewport(viewportAnchor);
    } finally {
      restoring = false;
    }
  }

  function queueRestore(viewportAnchor = null){
    if(viewportAnchor) pendingViewportAnchor = viewportAnchor;
    if(restoreQueued) return;
    restoreQueued = true;
    requestAnimationFrame(() => {
      restoreQueued = false;
      const anchor = pendingViewportAnchor;
      pendingViewportAnchor = null;
      restoreCurrent(anchor);
      setTimeout(() => restoreCurrent(), 40);
      setTimeout(() => restoreCurrent(), 220);
    });
  }

  function wrapRender(name){
    const original = global[name];
    if(typeof original !== 'function' || original.__checklistStateWrapped) return;
    function wrapped(){
      observer?.takeRecords();
      const viewportAnchor = captureViewportAnchor();
      if(viewportAnchor) lastViewportAnchor = viewportAnchor;
      captureCurrent();
      const result = original.apply(this, arguments);
      restoreCurrent(viewportAnchor);
      queueRestore(viewportAnchor);
      if(result && typeof result.then === 'function'){
        result.finally(() => {
          const asyncAnchor = captureViewportAnchor();
          captureCurrent();
          queueRestore(asyncAnchor);
        });
      }
      return result;
    }
    wrapped.__checklistStateWrapped = true;
    wrapped.__checklistStateOriginal = original;
    global[name] = wrapped;
    try{
      if(name === 'renderApp') renderApp = wrapped;
      if(name === 'refreshControl') refreshControl = wrapped;
    } catch(error){}
  }

  function managedControlSummary(target){
    const summary = target?.closest?.('#control-records details > summary');
    if(!summary) return null;
    const details = summary.parentElement;
    if(!(details instanceof HTMLDetailsElement)) return null;
    if(summary !== details.querySelector(':scope > summary')) return null;
    if(details.matches('[data-photo-rules-card],.checklist-photo-rules-card') || details.closest('[data-photo-rules-card],.checklist-photo-rules-card')) return null;
    if(!detailKey(details)) return null;
    return { summary, details };
  }

  document.addEventListener('click', event => {
    const managed = managedControlSummary(event.target);
    if(!managed || event.defaultPrevented) return;
    if(event.button !== undefined && event.button !== 0) return;
    if(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if(event.target.closest?.('button,a,input,select,textarea')) return;
    lastViewportAnchor = captureViewportAnchor();
    event.preventDefault();
    rememberUserIntent(managed.details, !managed.details.open);
    queueRestore();
  }, true);

  document.addEventListener('toggle', event => {
    if(restoring || !(event.target instanceof HTMLDetailsElement)) return;
    if(!event.target.isConnected || !document.documentElement.contains(event.target)) return;
    const key = detailKey(event.target);
    if(!key) return;
    const intent = currentIntent(key);
    if(intent && Boolean(event.target.open) !== intent.open){
      event.target.open = intent.open;
      return;
    }
    openState.set(key, Boolean(event.target.open));
  }, true);

  document.addEventListener('input', event => {
    const card = event.target.closest?.('.doc-card[data-checklist-id]');
    if(card) rememberChecklist(card);
    const form = event.target.closest?.('[data-checklist-comment-form]');
    if(form) rememberCommentForm(form);
  }, true);

  document.addEventListener('change', event => {
    const card = event.target.closest?.('.doc-card[data-checklist-id]');
    if(card) rememberChecklist(card);
    const form = event.target.closest?.('[data-checklist-comment-form]');
    if(form) rememberCommentForm(form);
  }, true);

  global.addEventListener('scroll', () => {
    if(restoring || scrollCaptureQueued) return;
    scrollCaptureQueued = true;
    requestAnimationFrame(() => {
      scrollCaptureQueued = false;
      if(!restoring) lastViewportAnchor = captureViewportAnchor();
    });
  }, { passive:true });

  const startObserver = () => {
    const root = document.querySelector('#app') || document.body;
    if(!root || !global.MutationObserver) return;
    observer = new MutationObserver(records => {
      const nodes = records.flatMap(record => [...Array.from(record.addedNodes || []), ...Array.from(record.removedNodes || [])]);
      const relevant = nodes.some(node =>
        node.nodeType === 1 && (node.matches?.('details,.doc-card,[data-checklist-comment-form],#control-records') || node.querySelector?.('details,.doc-card,[data-checklist-comment-form],#control-records'))
      );
      if(!relevant) return;
      const replacedControl = nodes.some(node =>
        node.nodeType === 1 && (node.matches?.('#control-records,.checklist-control-days,.revision-pivot,details') || node.querySelector?.('#control-records,.checklist-control-days,.revision-pivot'))
      );
      const recentAnchor = lastViewportAnchor && Date.now() - lastViewportAnchor.capturedAt <= VIEWPORT_ANCHOR_TTL_MS
        ? lastViewportAnchor
        : null;
      queueRestore(replacedControl ? recentAnchor : null);
    });
    observer.observe(root, { childList:true, subtree:true });
  };

  captureCurrent();
  lastViewportAnchor = captureViewportAnchor();
  wrapRender('renderApp');
  wrapRender('refreshControl');
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once:true });
  else startObserver();
  queueRestore();

  global.SovremennikChecklistUiStateFix = Object.freeze({
    VERSION,
    captureCurrent,
    restoreCurrent,
    queueRestore,
    rememberUserIntent,
    captureViewportAnchor,
    detailKey,
    openState,
    userIntents
  });
})(window);

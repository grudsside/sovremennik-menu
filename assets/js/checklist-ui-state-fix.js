/* Современник — preserve checklist UI state across background renders. */
(function(global){
  'use strict';

  const VERSION = '2026-07-25-checklist-ui-state-3';
  const USER_INTENT_TTL_MS = 15000;
  const openState = new Map();
  const userIntents = new Map();
  const checklistState = new Map();
  const commentState = new Map();
  let restoreQueued = false;
  let restoring = false;
  let observer = null;

  function detailKey(details){
    if(!details) return '';
    const card = details.closest?.('.doc-card[data-checklist-id]');
    if(card && details.matches('.doc-details')) return `checklist:${card.dataset.checklistId}:main`;
    if(details.matches('[data-photo-rules-card],.checklist-photo-rules-card')) return 'control:photo-rules';
    if(details.matches('.checklist-submission-details[data-checklist-submission]')) return `submission:${details.dataset.checklistSubmission}`;
    if(details.matches('.control-day-group')){
      const label = details.querySelector(':scope>summary strong')?.textContent?.trim() || '';
      return label ? `control-day:${label}` : '';
    }
    const submission = details.closest?.('[data-checklist-submission]');
    if(submission){
      const classes = Array.from(details.classList || []).sort().join('.') || details.tagName.toLowerCase();
      return `submission-child:${submission.dataset.checklistSubmission}:${classes}`;
    }
    if(details.id) return `details-id:${details.id}`;
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

  function captureCurrent(){
    document.querySelectorAll('#top-checklists details,#control-records details').forEach(details => {
      if(!details.isConnected) return;
      const key = detailKey(details);
      if(!key) return;
      const intent = currentIntent(key);
      if(intent && Boolean(details.open) !== intent.open) return;
      openState.set(key, Boolean(details.open));
    });
    document.querySelectorAll('.doc-card[data-checklist-id]').forEach(rememberChecklist);
    document.querySelectorAll('[data-checklist-comment-form]').forEach(rememberCommentForm);
  }

  function restoreDetails(){
    document.querySelectorAll('#top-checklists details,#control-records details').forEach(details => {
      if(!details.isConnected) return;
      const key = detailKey(details);
      if(!key) return;
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

  function restoreCurrent(){
    restoring = true;
    try{
      restoreDetails();
      restoreChecklists();
      restoreComments();
    } finally {
      restoring = false;
    }
  }

  function queueRestore(){
    if(restoreQueued) return;
    restoreQueued = true;
    requestAnimationFrame(() => {
      restoreQueued = false;
      restoreCurrent();
      setTimeout(restoreCurrent, 40);
      setTimeout(restoreCurrent, 220);
    });
  }

  function wrapRender(name){
    const original = global[name];
    if(typeof original !== 'function' || original.__checklistStateWrapped) return;
    function wrapped(){
      observer?.takeRecords();
      captureCurrent();
      const result = original.apply(this, arguments);
      queueRestore();
      if(result && typeof result.then === 'function') result.finally(queueRestore);
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
    if(!details.matches('.checklist-submission-details[data-checklist-submission],.control-details')) return null;
    return { summary, details };
  }

  document.addEventListener('click', event => {
    const managed = managedControlSummary(event.target);
    if(!managed || event.defaultPrevented) return;
    if(event.button !== undefined && event.button !== 0) return;
    if(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if(event.target.closest?.('button,a,input,select,textarea')) return;
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

  const startObserver = () => {
    const root = document.querySelector('#app') || document.body;
    if(!root || !global.MutationObserver) return;
    observer = new MutationObserver(records => {
      const relevant = records.some(record => Array.from(record.addedNodes || []).some(node =>
        node.nodeType === 1 && (node.matches?.('details,.doc-card,[data-checklist-comment-form]') || node.querySelector?.('details,.doc-card,[data-checklist-comment-form]'))
      ));
      if(relevant) queueRestore();
    });
    observer.observe(root, { childList:true, subtree:true });
  };

  captureCurrent();
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
    openState,
    userIntents
  });
})(window);

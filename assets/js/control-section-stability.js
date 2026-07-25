/* Современник — one coordinator for Control rendering, native details and viewport stability. */
(function(global){
  'use strict';

  const VERSION = '2026-07-25-control-section-stability-1';
  const INTERACTION_GRACE_MS = 650;
  const ANCHOR_TTL_MS = 2600;
  const SECOND_RESTORE_DELAY_MS = 120;

  const openState = new Map();
  const checklistDrafts = new Map();
  const commentDrafts = new Map();
  const photoRulesDrafts = new Map();

  let nativeRefreshControl = typeof global.refreshControl === 'function' ? global.refreshControl : null;
  let nativeRenderApp = typeof global.renderApp === 'function' ? global.renderApp : null;
  let interactionUntil = 0;
  let activePointerCount = 0;
  let pendingRefresh = null;
  let pendingRender = null;
  let flushTimer = 0;
  let restoring = false;
  let rendering = false;
  let observer = null;
  let restoreFrame = 0;
  let delayedRestoreTimer = 0;
  let pendingAnchor = null;
  let lastAnchor = null;
  let userEpoch = 0;
  let scrollCaptureFrame = 0;
  let lastRenderedControlSignature = '';

  function normalize(value){
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
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
    return Object.entries(node.dataset)
      .filter(([name, value]) => /(submission|revision|record|entry|row|date|checklist|key|id)/i.test(name) && normalize(value))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}:${normalize(value)}`)
      .join('|');
  }

  function detailsKey(details){
    if(!(details instanceof HTMLDetailsElement)) return '';
    if(details.matches('.checklist-submission-details[data-checklist-submission]')){
      return `submission:${normalize(details.dataset.checklistSubmission)}`;
    }
    if(details.matches('.control-day-group')){
      const title = normalize(details.querySelector(':scope > summary strong')?.textContent || details.querySelector(':scope > summary')?.textContent);
      return title ? `control-day:${title}` : '';
    }
    if(details.matches('[data-photo-rules-card],.checklist-photo-rules-card')) return 'control:photo-rules';
    const checklistCard = details.closest('.doc-card[data-checklist-id]');
    if(checklistCard && details.matches('.doc-details')) return `checklist:${normalize(checklistCard.dataset.checklistId)}:main`;
    if(details.id) return `details-id:${normalize(details.id)}`;

    const root = details.closest('#top-control,#top-checklists');
    if(!root) return '';
    const folder = details.closest('.control-folder');
    const owner = details.closest('[data-checklist-submission],[data-revision-id],[data-revision-date],[data-revision-key],[data-record-id],[data-entry-id],[data-row-id],[data-date-key]');
    const identity = datasetIdentity(details) || (owner && owner !== details ? datasetIdentity(owner) : '');
    const summary = normalize(details.querySelector(':scope > summary')?.textContent || '');
    const row = details.closest('tr');
    const rowText = row ? normalize(Array.from(row.children || []).slice(0, 5).map(cell => cell.textContent || '').join('|')) : '';
    const classes = Array.from(details.classList || []).sort().join('.') || 'details';
    const scope = folder || root;
    const position = Array.from(scope.querySelectorAll('details')).indexOf(details);
    const fingerprint = [root.id, folder?.id || '', identity, rowText, summary, classes].filter(Boolean).join('||');
    return fingerprint ? `details:${hashText(fingerprint)}:${position}` : '';
  }

  function managedDetails(){
    return Array.from(document.querySelectorAll('#top-control details,#top-checklists details'))
      .filter(details => details.isConnected && detailsKey(details));
  }

  function rememberOpenStates(){
    managedDetails().forEach(details => openState.set(detailsKey(details), Boolean(details.open)));
  }

  function restoreOpenStates(){
    managedDetails().forEach(details => {
      const key = detailsKey(details);
      if(openState.has(key) && details.open !== openState.get(key)) details.open = Boolean(openState.get(key));
    });
  }

  function itemKey(input, index){
    return normalize(input?.dataset?.photoItemKey || input?.dataset?.task || index);
  }

  function rememberChecklistCard(card){
    const id = normalize(card?.dataset?.checklistId);
    if(!id) return;
    checklistDrafts.set(id, {
      employeeName:String(card.querySelector('.employee-name')?.value || ''),
      checks:Array.from(card.querySelectorAll('.task-checkbox')).map((input, index) => ({ key:itemKey(input, index), checked:Boolean(input.checked) }))
    });
  }

  function restoreChecklistDrafts(){
    document.querySelectorAll('.doc-card[data-checklist-id]').forEach(card => {
      const saved = checklistDrafts.get(normalize(card.dataset.checklistId));
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

  function rememberCommentForm(form){
    const id = normalize(form?.dataset?.submissionId);
    if(!id) return;
    commentDrafts.set(id, {
      assigneeId:String(form.elements?.assigneeId?.value || ''),
      body:String(form.elements?.body?.value || '')
    });
  }

  function restoreCommentDrafts(){
    document.querySelectorAll('[data-checklist-comment-form]').forEach(form => {
      const saved = commentDrafts.get(normalize(form.dataset.submissionId));
      if(!saved) return;
      if(form.elements?.assigneeId && saved.assigneeId) form.elements.assigneeId.value = saved.assigneeId;
      if(form.elements?.body && !form.elements.body.value) form.elements.body.value = saved.body;
    });
  }

  function photoRulesChecklistId(form){
    return normalize(form?.elements?.checklistId?.value || 'default');
  }

  function rememberPhotoRules(form){
    if(!form) return;
    const checklistId = photoRulesChecklistId(form);
    photoRulesDrafts.set(checklistId, {
      rows:Array.from(form.querySelectorAll('[data-photo-rule-row]')).map(row => ({
        itemKey:normalize(row.dataset.itemKey),
        enabled:Boolean(row.querySelector('[data-rule-enabled]')?.checked),
        count:String(row.querySelector('[data-rule-count]')?.value || '1'),
        hint:String(row.querySelector('[data-rule-hint]')?.value || '')
      }))
    });
  }

  function restorePhotoRulesDrafts(){
    document.querySelectorAll('[data-photo-rules-form]').forEach(form => {
      const saved = photoRulesDrafts.get(photoRulesChecklistId(form));
      if(!saved) return;
      const byKey = new Map(saved.rows.map(row => [row.itemKey, row]));
      form.querySelectorAll('[data-photo-rule-row]').forEach(row => {
        const savedRow = byKey.get(normalize(row.dataset.itemKey));
        if(!savedRow) return;
        const enabled = row.querySelector('[data-rule-enabled]');
        const count = row.querySelector('[data-rule-count]');
        const hint = row.querySelector('[data-rule-hint]');
        if(enabled) enabled.checked = savedRow.enabled;
        if(count) count.value = savedRow.count;
        if(hint && !hint.value) hint.value = savedRow.hint;
      });
    });
  }

  function captureForms(){
    document.querySelectorAll('.doc-card[data-checklist-id]').forEach(rememberChecklistCard);
    document.querySelectorAll('[data-checklist-comment-form]').forEach(rememberCommentForm);
    document.querySelectorAll('[data-photo-rules-form]').forEach(rememberPhotoRules);
  }

  function activeControlFolder(){
    const root = document.querySelector('#top-control');
    return root?.querySelector('.control-folder.active') || root;
  }

  function anchorCandidates(){
    const folder = activeControlFolder();
    if(!folder || folder.getClientRects().length === 0) return [];
    return Array.from(folder.querySelectorAll('details'))
      .filter(details => details.isConnected && detailsKey(details) && details.getClientRects().length > 0);
  }

  function captureAnchor(){
    const root = document.querySelector('#top-control');
    if(!root || root.getClientRects().length === 0) return null;
    const candidates = anchorCandidates();
    if(!candidates.length) return null;
    const viewportHeight = Math.max(1, global.innerHeight || document.documentElement.clientHeight || 1);
    const referenceY = Math.min(viewportHeight - 1, Math.max(72, Math.round(viewportHeight * 0.3)));
    const rows = candidates.map(details => {
      const summary = details.querySelector(':scope > summary') || details;
      return { details, summary, rect:details.getBoundingClientRect(), summaryTop:summary.getBoundingClientRect().top };
    });
    const containing = rows.filter(row => row.rect.top <= referenceY && row.rect.bottom >= referenceY)
      .sort((left, right) => left.rect.height - right.rect.height);
    const chosen = containing[0] || rows.sort((left, right) => Math.abs(left.summaryTop - referenceY) - Math.abs(right.summaryTop - referenceY))[0];
    if(!chosen) return null;
    return {
      key:detailsKey(chosen.details),
      top:chosen.summaryTop,
      scrollY:Number(global.scrollY || global.pageYOffset || 0),
      capturedAt:Date.now(),
      epoch:userEpoch
    };
  }

  function findDetails(key){
    return managedDetails().find(details => detailsKey(details) === key) || null;
  }

  function restoreAnchor(anchor){
    if(!anchor || Date.now() - anchor.capturedAt > ANCHOR_TTL_MS || anchor.epoch !== userEpoch) return;
    const details = findDetails(anchor.key);
    restoring = true;
    try{
      if(details){
        const summary = details.querySelector(':scope > summary') || details;
        const delta = summary.getBoundingClientRect().top - anchor.top;
        if(Number.isFinite(delta) && Math.abs(delta) > 0.5) global.scrollBy(0, delta);
      } else if(Math.abs(Number(global.scrollY || 0) - anchor.scrollY) > 0.5){
        global.scrollTo(0, anchor.scrollY);
      }
    } finally {
      restoring = false;
    }
    lastAnchor = { ...anchor, capturedAt:Date.now(), scrollY:Number(global.scrollY || global.pageYOffset || 0) };
  }

  function restoreAll(anchor = null){
    restoring = true;
    try{
      restoreOpenStates();
      restoreChecklistDrafts();
      restoreCommentDrafts();
      restorePhotoRulesDrafts();
    } finally {
      restoring = false;
    }
    if(anchor) restoreAnchor(anchor);
  }

  function queueRestore(anchor = null){
    if(anchor) pendingAnchor = anchor;
    if(restoreFrame) return;
    restoreFrame = global.requestAnimationFrame(() => {
      restoreFrame = 0;
      const nextAnchor = pendingAnchor;
      pendingAnchor = null;
      restoreAll(nextAnchor);
      global.clearTimeout(delayedRestoreTimer);
      if(nextAnchor){
        delayedRestoreTimer = global.setTimeout(() => restoreAll(nextAnchor), SECOND_RESTORE_DELAY_MS);
      }
    });
  }

  function compactTask(task){
    return [
      normalize(task?.itemKey || task?.item_key),
      normalize(task?.text || task?.task),
      Boolean(task?.checked),
      Number(task?.requiredPhotoCount ?? task?.required_photo_count ?? 0),
      Number(task?.photoCount ?? task?.photo_count ?? 0),
      normalize(task?.photoStatus || task?.photo_status)
    ];
  }

  function compactPhoto(photo){
    return [
      normalize(photo?.id), normalize(photo?.item_key), Number(photo?.photo_index || 0),
      normalize(photo?.storage_path), normalize(photo?.thumbnail_path), Boolean(photo?.retained),
      normalize(photo?.deleted_at), normalize(photo?.deleted_reason)
    ];
  }

  function compactControlRecord(record){
    return [
      normalize(record?.id), normalize(record?.checklistId || record?.checklist_id),
      normalize(record?.checklistTitle || record?.checklist_title), normalize(record?.employeeName || record?.employee_name),
      normalize(record?.createdAt || record?.created_at), Number(record?.completed || record?.completed_count || 0),
      Number(record?.total || record?.total_count || 0), Number(record?.percent || 0),
      Number(record?.photoCount || record?.photo_count || 0), normalize(record?.photoUploadStatus || record?.photo_upload_status),
      (record?.tasks || record?.items || []).map(compactTask), (record?.photos || []).map(compactPhoto)
    ];
  }

  function compactRevision(record){
    return [
      normalize(record?.id), normalize(record?.dateKey || record?.revisionDate || record?.revision_date || record?.date),
      normalize(record?.employeeName || record?.employee_name), normalize(record?.hopperWeight || record?.hopper_weight),
      normalize(record?.openedPacks || record?.opened_packs), normalize(record?.writeOffs || record?.write_offs),
      normalize(record?.iikoSales || record?.iiko_sales), normalize(record?.difference), normalize(record?.losses || record?.losses_percent),
      normalize(record?.checked), normalize(record?.updatedAt || record?.updated_at || record?.createdAt || record?.created_at)
    ];
  }

  function compactError(record){
    return [normalize(record?.id), normalize(record?.createdAt || record?.created_at), normalize(record?.employeeName), normalize(record?.text || record?.message)];
  }

  function controlSignature(){
    if(typeof state === 'undefined') return '';
    const controlRows = Array.isArray(state.controlRecords) ? state.controlRecords : [];
    const revisionRows = Array.isArray(state.revisionRecords) ? state.revisionRecords : [];
    const errorRows = Array.isArray(state.errorReports) ? state.errorReports : [];
    const payload = {
      active:normalize(state.activeControl),
      control:controlRows.map(compactControlRecord),
      revisions:revisionRows.map(compactRevision),
      errors:(state.activeControl === 'errors' || state.activeControl === 'summary') ? errorRows.map(compactError) : [],
      controlLoading:controlRows.length ? false : Boolean(state.controlLoading),
      revisionLoading:revisionRows.length ? false : Boolean(state.revisionLoading),
      errorsLoading:errorRows.length ? false : Boolean(state.errorReportsLoading),
      controlError:normalize(state.controlError),
      revisionError:normalize(state.revisionError),
      errorsError:normalize(state.errorReportsError),
      visibleDays:Number(state.checklistPhotoVisibleDays || 14),
      hasMore:Boolean(state.checklistPhotoControlHasMore),
      cursor:normalize(state.checklistPhotoControlCursor)
    };
    return hashText(JSON.stringify(payload));
  }

  function controlDomReady(){
    const root = document.querySelector('#top-control');
    if(!root || !root.isConnected) return false;
    const active = activeControlFolder();
    if(!active) return false;
    if(state?.activeControl === 'checklists') return Boolean(active.querySelector('#control-records'));
    return true;
  }

  function captureCurrent(){
    rememberOpenStates();
    captureForms();
  }

  function interactionActive(){
    return activePointerCount > 0 || Date.now() < interactionUntil;
  }

  function runRefresh(context, args){
    if(!nativeRefreshControl) return undefined;
    observer?.takeRecords();
    const anchor = captureAnchor();
    if(anchor) lastAnchor = anchor;
    captureCurrent();
    rendering = true;
    let result;
    try{
      result = nativeRefreshControl.apply(context, args || []);
      lastRenderedControlSignature = controlSignature();
      restoreAll(anchor);
      queueRestore(anchor);
    } finally {
      rendering = false;
    }
    if(result && typeof result.then === 'function'){
      result.finally(() => {
        lastRenderedControlSignature = controlSignature();
        queueRestore(captureAnchor() || anchor);
      });
    }
    return result;
  }

  function runRender(context, args){
    if(!nativeRenderApp) return undefined;
    observer?.takeRecords();
    const anchor = captureAnchor();
    if(anchor) lastAnchor = anchor;
    captureCurrent();
    rendering = true;
    let result;
    try{
      result = nativeRenderApp.apply(context, args || []);
      lastRenderedControlSignature = controlSignature();
      restoreAll(anchor);
      queueRestore(anchor);
    } finally {
      rendering = false;
    }
    if(result && typeof result.then === 'function'){
      result.finally(() => {
        lastRenderedControlSignature = controlSignature();
        queueRestore(captureAnchor() || anchor);
      });
    }
    return result;
  }

  function scheduleFlush(delay = INTERACTION_GRACE_MS){
    interactionUntil = Math.max(interactionUntil, Date.now() + delay);
    global.clearTimeout(flushTimer);
    flushTimer = global.setTimeout(flushPending, delay + 20);
  }

  function flushPending(){
    if(interactionActive()){
      scheduleFlush(Math.max(40, interactionUntil - Date.now()));
      return;
    }
    const render = pendingRender;
    const refresh = pendingRefresh;
    pendingRender = null;
    pendingRefresh = null;
    if(render) runRender(render.context, render.args);
    if(refresh){
      const nextSignature = controlSignature();
      if(!controlDomReady() || nextSignature !== lastRenderedControlSignature) runRefresh(refresh.context, refresh.args);
    }
  }

  function wrappedRefreshControl(){
    const args = Array.from(arguments);
    if(interactionActive()){
      pendingRefresh = { context:this, args };
      scheduleFlush();
      return undefined;
    }
    const nextSignature = controlSignature();
    if(controlDomReady() && nextSignature === lastRenderedControlSignature){
      return undefined;
    }
    return runRefresh(this, args);
  }

  function wrappedRenderApp(){
    const args = Array.from(arguments);
    if(interactionActive() && document.querySelector('#top-control.active')){
      pendingRender = { context:this, args };
      scheduleFlush();
      return undefined;
    }
    return runRender(this, args);
  }

  function managedSummary(target){
    const summary = target?.closest?.('#top-control details > summary,#top-checklists details > summary');
    if(!summary) return null;
    const details = summary.parentElement;
    if(!(details instanceof HTMLDetailsElement) || summary !== details.querySelector(':scope > summary')) return null;
    if(target.closest?.('button,a,input,select,textarea,label')) return null;
    return detailsKey(details) ? { summary, details } : null;
  }

  function beginInteraction(event){
    if(event.button !== undefined && event.button !== 0) return;
    if(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const managed = managedSummary(event.target);
    if(!managed) return;
    activePointerCount += 1;
    interactionUntil = Number.POSITIVE_INFINITY;
    captureCurrent();
    lastAnchor = captureAnchor() || lastAnchor;
  }

  function endInteraction(){
    activePointerCount = Math.max(0, activePointerCount - 1);
    if(activePointerCount === 0){
      interactionUntil = Date.now() + INTERACTION_GRACE_MS;
      scheduleFlush();
    }
  }

  function noteUserMotion(){
    if(restoring) return;
    userEpoch += 1;
  }

  document.addEventListener('pointerdown', beginInteraction, true);
  document.addEventListener('pointerup', endInteraction, true);
  document.addEventListener('pointercancel', endInteraction, true);
  document.addEventListener('click', event => {
    if(!managedSummary(event.target)) return;
    scheduleFlush();
    global.setTimeout(() => {
      const details = event.target?.closest?.('details');
      if(details?.isConnected){
        const key = detailsKey(details);
        if(key) openState.set(key, Boolean(details.open));
      }
    }, 0);
  }, true);
  document.addEventListener('keydown', event => {
    if(!['Enter',' '].includes(event.key) || !managedSummary(event.target)) return;
    interactionUntil = Date.now() + INTERACTION_GRACE_MS;
    scheduleFlush();
  }, true);

  document.addEventListener('toggle', event => {
    const details = event.target;
    if(restoring || !(details instanceof HTMLDetailsElement) || !details.isConnected) return;
    const key = detailsKey(details);
    if(key) openState.set(key, Boolean(details.open));
  }, true);

  document.addEventListener('input', event => {
    const card = event.target.closest?.('.doc-card[data-checklist-id]');
    if(card) rememberChecklistCard(card);
    const comment = event.target.closest?.('[data-checklist-comment-form]');
    if(comment) rememberCommentForm(comment);
    const rules = event.target.closest?.('[data-photo-rules-form]');
    if(rules) rememberPhotoRules(rules);
  }, true);

  document.addEventListener('change', event => {
    const card = event.target.closest?.('.doc-card[data-checklist-id]');
    if(card) rememberChecklistCard(card);
    const comment = event.target.closest?.('[data-checklist-comment-form]');
    if(comment) rememberCommentForm(comment);
    const rules = event.target.closest?.('[data-photo-rules-form]');
    if(rules) rememberPhotoRules(rules);
  }, true);

  global.addEventListener('wheel', noteUserMotion, { passive:true, capture:true });
  global.addEventListener('touchmove', noteUserMotion, { passive:true, capture:true });
  global.addEventListener('scroll', () => {
    if(restoring || scrollCaptureFrame) return;
    scrollCaptureFrame = global.requestAnimationFrame(() => {
      scrollCaptureFrame = 0;
      if(!restoring) lastAnchor = captureAnchor() || lastAnchor;
    });
  }, { passive:true });

  function startObserver(){
    const root = document.querySelector('#app') || document.body;
    if(!root || !global.MutationObserver || observer) return;
    observer = new MutationObserver(records => {
      if(rendering) return;
      const relevant = records.some(record => {
        const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
        if(target?.closest?.('#top-control,#top-checklists')) return true;
        return [...Array.from(record.addedNodes || []), ...Array.from(record.removedNodes || [])].some(node =>
          node.nodeType === 1 && (node.matches?.('#top-control,#top-checklists,#control-records,details,[data-checklist-comment-form]') || node.querySelector?.('#top-control,#top-checklists,#control-records,details,[data-checklist-comment-form]'))
        );
      });
      if(!relevant) return;
      const anchor = lastAnchor && Date.now() - lastAnchor.capturedAt <= ANCHOR_TTL_MS ? lastAnchor : null;
      queueRestore(anchor);
    });
    observer.observe(root, { childList:true, subtree:true });
  }

  captureCurrent();
  lastAnchor = captureAnchor();
  lastRenderedControlSignature = controlSignature();

  if(nativeRefreshControl){
    wrappedRefreshControl.__controlSectionStabilityWrapped = true;
    wrappedRefreshControl.__controlSectionStabilityOriginal = nativeRefreshControl;
    global.refreshControl = wrappedRefreshControl;
    try { refreshControl = wrappedRefreshControl; } catch(error){}
  }
  if(nativeRenderApp){
    wrappedRenderApp.__controlSectionStabilityWrapped = true;
    wrappedRenderApp.__controlSectionStabilityOriginal = nativeRenderApp;
    global.renderApp = wrappedRenderApp;
    try { renderApp = wrappedRenderApp; } catch(error){}
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once:true });
  else startObserver();
  queueRestore();

  global.SovremennikControlSectionStability = Object.freeze({
    VERSION,
    detailsKey,
    captureCurrent,
    captureAnchor,
    controlSignature,
    flushPending,
    openState,
    get interactionActive(){ return interactionActive(); },
    get lastRenderedControlSignature(){ return lastRenderedControlSignature; }
  });
})(window);

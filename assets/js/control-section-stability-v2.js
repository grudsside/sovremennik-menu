/* Современник — unified Control render, touch and viewport coordinator v2. */
(function(global){
  'use strict';

  const VERSION = '2026-07-25-control-section-stability-2';
  const GRACE_MS = 650;
  const ANCHOR_TTL_MS = 2600;
  const openStates = new Map();
  const checklistDrafts = new Map();
  const commentDrafts = new Map();
  const photoRuleDrafts = new Map();
  const nativeRefresh = typeof global.refreshControl === 'function' ? global.refreshControl : null;
  const nativeRender = typeof global.renderApp === 'function' ? global.renderApp : null;

  let pointerDepth = 0;
  let graceUntil = 0;
  let pendingRefresh = null;
  let pendingRender = null;
  let flushTimer = 0;
  let restoring = false;
  let rendering = false;
  let observer = null;
  let restoreFrame = 0;
  let delayedRestore = 0;
  let pendingAnchor = null;
  let lastAnchor = null;
  let scrollEpoch = 0;
  let scrollFrame = 0;
  let lastSignature = '';

  const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  function hash(value){
    let result = 2166136261;
    for(const char of String(value || '')){ result ^= char.charCodeAt(0); result = Math.imul(result, 16777619); }
    return (result >>> 0).toString(36);
  }

  function dataIdentity(node){
    if(!node?.dataset) return '';
    return Object.entries(node.dataset)
      .filter(([key, value]) => /(submission|revision|record|entry|row|date|checklist|key|id)/i.test(key) && norm(value))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${norm(value)}`).join('|');
  }

  function detailsKey(details){
    if(!(details instanceof HTMLDetailsElement)) return '';
    if(details.matches('.checklist-submission-details[data-checklist-submission]')) return `submission:${norm(details.dataset.checklistSubmission)}`;
    if(details.matches('.control-day-group')){
      const title = norm(details.querySelector(':scope > summary strong')?.textContent || details.querySelector(':scope > summary')?.textContent);
      return title ? `day:${title}` : '';
    }
    if(details.matches('[data-photo-rules-card],.checklist-photo-rules-card')) return 'photo-rules';
    const card = details.closest('.doc-card[data-checklist-id]');
    if(card && details.matches('.doc-details')) return `checklist:${norm(card.dataset.checklistId)}:main`;
    if(details.id) return `id:${norm(details.id)}`;
    const root = details.closest('#top-control,#top-checklists');
    if(!root) return '';
    const folder = details.closest('.control-folder');
    const owner = details.closest('[data-checklist-submission],[data-revision-id],[data-revision-date],[data-revision-key],[data-record-id],[data-entry-id],[data-row-id],[data-date-key]');
    const identity = dataIdentity(details) || (owner && owner !== details ? dataIdentity(owner) : '');
    const summary = norm(details.querySelector(':scope > summary')?.textContent);
    const row = details.closest('tr');
    const rowText = row ? norm(Array.from(row.children || []).slice(0, 5).map(cell => cell.textContent || '').join('|')) : '';
    const position = Array.from((folder || root).querySelectorAll('details')).indexOf(details);
    return `details:${hash([root.id, folder?.id || '', identity, rowText, summary, Array.from(details.classList).sort().join('.')].join('||'))}:${position}`;
  }

  function managedDetails(){
    return Array.from(document.querySelectorAll('#top-control details,#top-checklists details')).filter(node => node.isConnected && detailsKey(node));
  }
  function captureOpen(){ managedDetails().forEach(node => openStates.set(detailsKey(node), Boolean(node.open))); }
  function restoreOpen(){
    managedDetails().forEach(node => {
      const key = detailsKey(node);
      if(openStates.has(key) && node.open !== openStates.get(key)) node.open = Boolean(openStates.get(key));
    });
  }

  function checkboxKey(input, index){ return norm(input?.dataset?.photoItemKey || input?.dataset?.task || index); }
  function rememberChecklist(card, force = false){
    const id = norm(card?.dataset?.checklistId);
    if(!id) return;
    const draft = {
      employeeName:String(card.querySelector('.employee-name')?.value || ''),
      checks:Array.from(card.querySelectorAll('.task-checkbox')).map((input, index) => ({ key:checkboxKey(input, index), checked:Boolean(input.checked) }))
    };
    const meaningful = Boolean(draft.employeeName.trim()) || draft.checks.some(row => row.checked);
    if(!force && !checklistDrafts.has(id) && !meaningful) return;
    checklistDrafts.set(id, draft);
  }
  function restoreChecklists(){
    document.querySelectorAll('.doc-card[data-checklist-id]').forEach(card => {
      const saved = checklistDrafts.get(norm(card.dataset.checklistId));
      if(!saved) return;
      const name = card.querySelector('.employee-name');
      if(name && !name.value && saved.employeeName) name.value = saved.employeeName;
      const checks = new Map(saved.checks.map(row => [row.key, row.checked]));
      Array.from(card.querySelectorAll('.task-checkbox')).forEach((input, index) => {
        const key = checkboxKey(input, index);
        if(checks.has(key)) input.checked = Boolean(checks.get(key));
      });
    });
  }

  function rememberComment(form, force = false){
    const id = norm(form?.dataset?.submissionId);
    if(!id) return;
    const draft = { assigneeId:String(form.elements?.assigneeId?.value || ''), body:String(form.elements?.body?.value || '') };
    if(!force && !commentDrafts.has(id) && !draft.body.trim()) return;
    commentDrafts.set(id, draft);
  }
  function restoreComments(){
    document.querySelectorAll('[data-checklist-comment-form]').forEach(form => {
      const saved = commentDrafts.get(norm(form.dataset.submissionId));
      if(!saved) return;
      if(form.elements?.assigneeId && saved.assigneeId) form.elements.assigneeId.value = saved.assigneeId;
      if(form.elements?.body && !form.elements.body.value) form.elements.body.value = saved.body;
    });
  }

  function photoFormId(form){ return norm(form?.elements?.checklistId?.value || 'default'); }
  function rememberPhotoRules(form, force = false){
    if(!form) return;
    const id = photoFormId(form);
    const rows = Array.from(form.querySelectorAll('[data-photo-rule-row]')).map(row => ({
      itemKey:norm(row.dataset.itemKey),
      enabled:Boolean(row.querySelector('[data-rule-enabled]')?.checked),
      count:String(row.querySelector('[data-rule-count]')?.value || '1'),
      hint:String(row.querySelector('[data-rule-hint]')?.value || '')
    }));
    const meaningful = rows.some(row => row.enabled || row.count !== '1' || row.hint.trim());
    if(!force && !photoRuleDrafts.has(id) && !meaningful) return;
    photoRuleDrafts.set(id, { rows });
  }
  function restorePhotoRules(){
    document.querySelectorAll('[data-photo-rules-form]').forEach(form => {
      const saved = photoRuleDrafts.get(photoFormId(form));
      if(!saved) return;
      const rows = new Map(saved.rows.map(row => [row.itemKey, row]));
      form.querySelectorAll('[data-photo-rule-row]').forEach(row => {
        const savedRow = rows.get(norm(row.dataset.itemKey));
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
    document.querySelectorAll('.doc-card[data-checklist-id]').forEach(card => rememberChecklist(card, false));
    document.querySelectorAll('[data-checklist-comment-form]').forEach(form => rememberComment(form, false));
    document.querySelectorAll('[data-photo-rules-form]').forEach(form => rememberPhotoRules(form, false));
  }
  function captureCurrent(){ captureOpen(); captureForms(); }

  function activeFolder(){
    const root = document.querySelector('#top-control');
    return root?.querySelector('.control-folder.active') || root;
  }
  function captureAnchor(){
    const root = document.querySelector('#top-control');
    const folder = activeFolder();
    if(!root || !folder || root.getClientRects().length === 0 || folder.getClientRects().length === 0) return null;
    const rows = Array.from(folder.querySelectorAll('details')).filter(node => node.isConnected && detailsKey(node) && node.getClientRects().length > 0).map(node => {
      const summary = node.querySelector(':scope > summary') || node;
      const rect = node.getBoundingClientRect();
      return { node, summary, rect, top:summary.getBoundingClientRect().top };
    });
    if(!rows.length) return null;
    const reference = Math.min((global.innerHeight || 800) - 1, Math.max(72, Math.round((global.innerHeight || 800) * 0.3)));
    const containing = rows.filter(row => row.rect.top <= reference && row.rect.bottom >= reference).sort((a, b) => a.rect.height - b.rect.height);
    const chosen = containing[0] || rows.sort((a, b) => Math.abs(a.top - reference) - Math.abs(b.top - reference))[0];
    return { key:detailsKey(chosen.node), top:chosen.top, scrollY:Number(global.scrollY || 0), capturedAt:Date.now(), epoch:scrollEpoch };
  }
  function restoreAnchor(anchor){
    if(!anchor || Date.now() - anchor.capturedAt > ANCHOR_TTL_MS || anchor.epoch !== scrollEpoch) return;
    const node = managedDetails().find(item => detailsKey(item) === anchor.key);
    restoring = true;
    try{
      if(node){
        const top = (node.querySelector(':scope > summary') || node).getBoundingClientRect().top;
        const delta = top - anchor.top;
        if(Number.isFinite(delta) && Math.abs(delta) > 0.5) global.scrollBy(0, delta);
      } else if(Math.abs(Number(global.scrollY || 0) - anchor.scrollY) > 0.5){
        global.scrollTo(0, anchor.scrollY);
      }
    } finally { restoring = false; }
    lastAnchor = { ...anchor, capturedAt:Date.now(), scrollY:Number(global.scrollY || 0) };
  }
  function restoreAll(anchor = null){
    restoring = true;
    try{ restoreOpen(); restoreChecklists(); restoreComments(); restorePhotoRules(); }
    finally { restoring = false; }
    if(anchor) restoreAnchor(anchor);
  }
  function queueRestore(anchor = null){
    if(anchor) pendingAnchor = anchor;
    if(restoreFrame) return;
    restoreFrame = global.requestAnimationFrame(() => {
      restoreFrame = 0;
      const current = pendingAnchor;
      pendingAnchor = null;
      restoreAll(current);
      global.clearTimeout(delayedRestore);
      if(current) delayedRestore = global.setTimeout(() => restoreAll(current), 120);
    });
  }

  const compactTask = task => [norm(task?.itemKey || task?.item_key), norm(task?.text || task?.task), Boolean(task?.checked), Number(task?.requiredPhotoCount ?? task?.required_photo_count ?? 0), Number(task?.photoCount ?? task?.photo_count ?? 0), norm(task?.photoStatus || task?.photo_status)];
  const compactPhoto = photo => [norm(photo?.id), norm(photo?.item_key), Number(photo?.photo_index || 0), norm(photo?.storage_path), norm(photo?.thumbnail_path), Boolean(photo?.retained), norm(photo?.deleted_at), norm(photo?.deleted_reason)];
  function signature(){
    if(typeof state === 'undefined') return '';
    const controls = Array.isArray(state.controlRecords) ? state.controlRecords : [];
    const revisions = Array.isArray(state.revisionRecords) ? state.revisionRecords : [];
    const errors = Array.isArray(state.errorReports) ? state.errorReports : [];
    return hash(JSON.stringify({
      active:norm(state.activeControl),
      controls:controls.map(record => [norm(record?.id), norm(record?.checklistId || record?.checklist_id), norm(record?.checklistTitle || record?.checklist_title), norm(record?.employeeName || record?.employee_name), norm(record?.createdAt || record?.created_at), Number(record?.completed || record?.completed_count || 0), Number(record?.total || record?.total_count || 0), Number(record?.percent || 0), Number(record?.photoCount || record?.photo_count || 0), norm(record?.photoUploadStatus || record?.photo_upload_status), (record?.tasks || record?.items || []).map(compactTask), (record?.photos || []).map(compactPhoto)]),
      revisions:revisions.map(record => [norm(record?.id), norm(record?.dateKey || record?.revisionDate || record?.revision_date || record?.date), norm(record?.employeeName || record?.employee_name), norm(record?.hopperWeight || record?.hopper_weight), norm(record?.openedPacks || record?.opened_packs), norm(record?.writeOffs || record?.write_offs), norm(record?.iikoSales || record?.iiko_sales), norm(record?.difference), norm(record?.losses || record?.losses_percent), norm(record?.checked), norm(record?.updatedAt || record?.updated_at || record?.createdAt || record?.created_at)]),
      errors:(state.activeControl === 'errors' || state.activeControl === 'summary') ? errors.map(record => [norm(record?.id), norm(record?.createdAt || record?.created_at), norm(record?.employeeName), norm(record?.text || record?.message)]) : [],
      controlLoading:controls.length ? false : Boolean(state.controlLoading),
      revisionLoading:revisions.length ? false : Boolean(state.revisionLoading),
      errorsLoading:errors.length ? false : Boolean(state.errorReportsLoading),
      controlError:norm(state.controlError), revisionError:norm(state.revisionError), errorsError:norm(state.errorReportsError),
      days:Number(state.checklistPhotoVisibleDays || 14), more:Boolean(state.checklistPhotoControlHasMore), cursor:norm(state.checklistPhotoControlCursor)
    }));
  }
  function domReady(){
    const root = document.querySelector('#top-control');
    if(!root?.isConnected) return false;
    if(state?.activeControl === 'checklists') return Boolean(activeFolder()?.querySelector('#control-records'));
    return true;
  }

  function run(fn, context, args){
    if(!fn) return undefined;
    observer?.takeRecords();
    const anchor = captureAnchor();
    if(anchor) lastAnchor = anchor;
    captureCurrent();
    rendering = true;
    let result;
    try{
      result = fn.apply(context, args || []);
      lastSignature = signature();
      restoreAll(anchor);
      queueRestore(anchor);
    } finally { rendering = false; }
    if(result && typeof result.then === 'function') result.finally(() => { lastSignature = signature(); queueRestore(captureAnchor() || anchor); });
    return result;
  }
  function interacting(){ return pointerDepth > 0 || Date.now() < graceUntil; }
  function scheduleFlush(delay = GRACE_MS){
    graceUntil = Math.max(graceUntil, Date.now() + delay);
    global.clearTimeout(flushTimer);
    flushTimer = global.setTimeout(flush, delay + 20);
  }
  function flush(){
    if(interacting()){ scheduleFlush(Math.max(40, graceUntil - Date.now())); return; }
    const render = pendingRender;
    const refresh = pendingRefresh;
    pendingRender = pendingRefresh = null;
    if(render) run(nativeRender, render.context, render.args);
    if(refresh && (!domReady() || signature() !== lastSignature)) run(nativeRefresh, refresh.context, refresh.args);
  }
  function wrappedRefresh(){
    const args = Array.from(arguments);
    if(interacting()){ pendingRefresh = { context:this, args }; scheduleFlush(); return undefined; }
    if(domReady() && signature() === lastSignature) return undefined;
    return run(nativeRefresh, this, args);
  }
  function wrappedRender(){
    const args = Array.from(arguments);
    if(interacting() && document.querySelector('#top-control.active')){ pendingRender = { context:this, args }; scheduleFlush(); return undefined; }
    return run(nativeRender, this, args);
  }

  function summaryFor(target){
    const summary = target?.closest?.('#top-control details > summary,#top-checklists details > summary');
    if(!summary || target.closest?.('button,a,input,select,textarea,label')) return null;
    const details = summary.parentElement;
    return details instanceof HTMLDetailsElement && summary === details.querySelector(':scope > summary') && detailsKey(details) ? details : null;
  }
  document.addEventListener('pointerdown', event => {
    if((event.button ?? 0) !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !summaryFor(event.target)) return;
    pointerDepth += 1;
    graceUntil = Number.POSITIVE_INFINITY;
    captureCurrent();
    lastAnchor = captureAnchor() || lastAnchor;
  }, true);
  const finishPointer = () => {
    pointerDepth = Math.max(0, pointerDepth - 1);
    if(pointerDepth === 0){ graceUntil = Date.now() + GRACE_MS; scheduleFlush(); }
  };
  document.addEventListener('pointerup', finishPointer, true);
  document.addEventListener('pointercancel', finishPointer, true);
  document.addEventListener('click', event => {
    const details = summaryFor(event.target);
    if(!details) return;
    scheduleFlush();
    global.setTimeout(() => { if(details.isConnected) openStates.set(detailsKey(details), Boolean(details.open)); }, 0);
  }, true);
  document.addEventListener('keydown', event => {
    if(!['Enter',' '].includes(event.key) || !summaryFor(event.target)) return;
    graceUntil = Date.now() + GRACE_MS;
    scheduleFlush();
  }, true);
  document.addEventListener('toggle', event => {
    const details = event.target;
    if(restoring || !(details instanceof HTMLDetailsElement) || !details.isConnected) return;
    const key = detailsKey(details);
    if(key) openStates.set(key, Boolean(details.open));
  }, true);
  document.addEventListener('input', event => {
    const card = event.target.closest?.('.doc-card[data-checklist-id]'); if(card) rememberChecklist(card, true);
    const comment = event.target.closest?.('[data-checklist-comment-form]'); if(comment) rememberComment(comment, true);
    const rules = event.target.closest?.('[data-photo-rules-form]'); if(rules) rememberPhotoRules(rules, true);
  }, true);
  document.addEventListener('change', event => {
    const card = event.target.closest?.('.doc-card[data-checklist-id]'); if(card) rememberChecklist(card, true);
    const comment = event.target.closest?.('[data-checklist-comment-form]'); if(comment) rememberComment(comment, true);
    const rules = event.target.closest?.('[data-photo-rules-form]'); if(rules) rememberPhotoRules(rules, true);
  }, true);

  const noteUserScroll = () => { if(!restoring) scrollEpoch += 1; };
  global.addEventListener('wheel', noteUserScroll, { passive:true, capture:true });
  global.addEventListener('touchmove', noteUserScroll, { passive:true, capture:true });
  global.addEventListener('scroll', () => {
    if(restoring || scrollFrame) return;
    scrollFrame = global.requestAnimationFrame(() => { scrollFrame = 0; if(!restoring) lastAnchor = captureAnchor() || lastAnchor; });
  }, { passive:true });

  function startObserver(){
    const root = document.querySelector('#app') || document.body;
    if(!root || !global.MutationObserver || observer) return;
    observer = new MutationObserver(records => {
      if(rendering) return;
      const relevant = records.some(record => {
        const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
        if(target?.closest?.('#top-control,#top-checklists')) return true;
        return [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && (node.matches?.('#top-control,#top-checklists,#control-records,details,[data-checklist-comment-form]') || node.querySelector?.('#top-control,#top-checklists,#control-records,details,[data-checklist-comment-form]')));
      });
      if(relevant) queueRestore(lastAnchor && Date.now() - lastAnchor.capturedAt <= ANCHOR_TTL_MS ? lastAnchor : null);
    });
    observer.observe(root, { childList:true, subtree:true });
  }

  captureCurrent();
  lastAnchor = captureAnchor();
  lastSignature = signature();
  if(nativeRefresh){ global.refreshControl = wrappedRefresh; try { refreshControl = wrappedRefresh; } catch(error){} }
  if(nativeRender){ global.renderApp = wrappedRender; try { renderApp = wrappedRender; } catch(error){} }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once:true }); else startObserver();
  queueRestore();

  global.SovremennikControlSectionStability = Object.freeze({ VERSION, detailsKey, captureCurrent, captureAnchor, signature, flush, openStates, checklistDrafts });
})(window);

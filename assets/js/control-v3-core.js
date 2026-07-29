/* Современник — Control v3 pure state and DOM helpers. */
(function(global){
  'use strict';

  if(global.SovremennikControlV3Core) return;

  const VERSION = '2026-07-30-control-v3-core-1';
  const STANDARD_TABS = Object.freeze(['summary','checklists','revisions','errors']);

  const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  function hash(value){
    let result = 2166136261;
    for(const char of String(value || '')){
      result ^= char.charCodeAt(0);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  }

  function normalizeTab(value){
    const tab = text(value).toLowerCase();
    return [...STANDARD_TABS, 'attestations'].includes(tab) ? tab : 'checklists';
  }

  function recordKey(record){
    return text(record?.id || record?.submission_id || record?.dateKey || record?.revision_date || record?.createdAt || record?.created_at);
  }

  function compactTask(task){
    return [
      text(task?.itemKey || task?.item_key),
      text(task?.text || task?.task),
      Boolean(task?.checked ?? task?.done),
      Number(task?.requiredPhotoCount ?? task?.required_photo_count ?? 0),
      Number(task?.photoCount ?? task?.photo_count ?? 0),
      text(task?.photoStatus || task?.photo_status)
    ];
  }

  function compactPhoto(photo){
    return [
      text(photo?.id),
      text(photo?.item_key),
      Number(photo?.photo_index || 0),
      text(photo?.storage_path),
      text(photo?.thumbnail_path),
      Boolean(photo?.retained),
      text(photo?.deleted_at)
    ];
  }

  function tabSignature(appState, tab){
    const active = normalizeTab(tab);
    const controls = Array.isArray(appState?.controlRecords) ? appState.controlRecords : [];
    const revisions = Array.isArray(appState?.revisionRecords) ? appState.revisionRecords : [];
    const errors = Array.isArray(appState?.errorReports) ? appState.errorReports : [];

    let payload;
    if(active === 'checklists'){
      payload = {
        rows:controls.map(record => [
          recordKey(record),
          text(record?.checklistId || record?.checklist_id),
          text(record?.checklistTitle || record?.checklist_title),
          text(record?.employeeName || record?.employee_name),
          text(record?.createdAt || record?.created_at),
          Number(record?.completed || record?.completed_count || 0),
          Number(record?.total || record?.total_count || 0),
          Number(record?.percent || 0),
          Number(record?.photoCount || record?.photo_count || 0),
          (record?.tasks || record?.items || []).map(compactTask),
          (record?.photos || []).map(compactPhoto)
        ]),
        loading:controls.length ? false : Boolean(appState?.controlLoading),
        error:text(appState?.controlError),
        days:Number(appState?.checklistPhotoVisibleDays || 14),
        cursor:text(appState?.checklistPhotoControlCursor),
        more:Boolean(appState?.checklistPhotoControlHasMore)
      };
    }else if(active === 'revisions'){
      payload = {
        rows:revisions.map(record => [
          recordKey(record),
          text(record?.dateKey || record?.revisionDate || record?.revision_date || record?.date),
          text(record?.employeeName || record?.employee_name),
          text(record?.hopperWeight || record?.hopper_weight),
          text(record?.openedPacks || record?.opened_packs),
          text(record?.writeOffs || record?.write_offs),
          text(record?.iikoSales || record?.iiko_sales),
          text(record?.difference),
          text(record?.losses || record?.losses_percent),
          text(record?.checked),
          text(record?.updatedAt || record?.updated_at || record?.createdAt || record?.created_at)
        ]),
        loading:revisions.length ? false : Boolean(appState?.revisionLoading),
        error:text(appState?.revisionError)
      };
    }else if(active === 'errors'){
      payload = {
        rows:errors.map(record => [
          recordKey(record),
          text(record?.createdAt || record?.created_at),
          text(record?.employeeName || record?.employee_name),
          text(record?.text || record?.message)
        ]),
        loading:errors.length ? false : Boolean(appState?.errorReportsLoading),
        error:text(appState?.errorReportsError)
      };
    }else if(active === 'summary'){
      payload = {
        checklists:tabSignature(appState, 'checklists'),
        revisions:tabSignature(appState, 'revisions'),
        errors:tabSignature(appState, 'errors'),
        report:appState?.manualReportFilter || null
      };
    }else{
      payload = { tab:active };
    }
    return hash(JSON.stringify(payload));
  }

  function detailsKey(details){
    if(!(details instanceof HTMLDetailsElement)) return '';
    if(details.dataset?.checklistSubmission) return `submission:${text(details.dataset.checklistSubmission)}`;
    if(details.dataset?.revisionId) return `revision:${text(details.dataset.revisionId)}`;
    if(details.dataset?.revisionDate) return `revision-date:${text(details.dataset.revisionDate)}`;
    if(details.matches('.control-day-group')){
      const title = text(details.querySelector(':scope > summary')?.textContent);
      return title ? `day:${title}` : '';
    }
    if(details.id) return `id:${text(details.id)}`;
    const summary = text(details.querySelector(':scope > summary')?.textContent);
    const owner = details.closest('[data-checklist-id],[data-record-id],[data-entry-id]');
    const ownerKey = owner ? text(owner.dataset.checklistId || owner.dataset.recordId || owner.dataset.entryId) : '';
    return summary ? `generic:${hash(`${ownerKey}|${summary}|${Array.from(details.classList).sort().join('.')}`)}` : '';
  }

  function captureOpen(root){
    const result = new Map();
    root?.querySelectorAll?.('details').forEach(details => {
      const key = detailsKey(details);
      if(key) result.set(key, Boolean(details.open));
    });
    return result;
  }

  function restoreOpen(root, states){
    if(!(states instanceof Map)) return;
    root?.querySelectorAll?.('details').forEach(details => {
      const key = detailsKey(details);
      if(key && states.has(key)) details.open = Boolean(states.get(key));
    });
  }

  global.SovremennikControlV3Core = Object.freeze({
    VERSION,
    STANDARD_TABS,
    normalizeTab,
    tabSignature,
    detailsKey,
    captureOpen,
    restoreOpen
  });
})(window);

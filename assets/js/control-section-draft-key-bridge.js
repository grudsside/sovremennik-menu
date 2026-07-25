/* Современник — keep checklist draft keys stable before and after photo-report enhancement. */
(function(global){
  'use strict';
  const api = global.SovremennikControlSectionStability;
  const drafts = api?.checklistDrafts;
  if(!(drafts instanceof Map) || drafts.__sovremennikStableKeys) return;

  const nativeSet = drafts.set.bind(drafts);
  Object.defineProperty(drafts, '__sovremennikStableKeys', { value:true });

  drafts.set = function(checklistId, draft){
    const card = document.querySelector(`.doc-card[data-checklist-id="${CSS.escape(String(checklistId || ''))}"]`);
    const inputs = card ? Array.from(card.querySelectorAll('.task-checkbox')) : [];
    const checks = [];
    (draft?.checks || []).forEach((row, index) => {
      const input = inputs[index];
      const keys = new Set([
        String(row?.key || '').trim(),
        String(input?.dataset?.task || '').trim(),
        String(input?.dataset?.photoItemKey || '').trim(),
        String(index)
      ].filter(Boolean));
      keys.forEach(key => checks.push({ key, checked:Boolean(row?.checked) }));
    });
    return nativeSet(checklistId, { ...draft, checks });
  };

  function openRestoredDraft(card){
    if(!card || card.dataset.offlineRestored !== '1') return;
    const hasContent = Boolean(
      card.querySelector('.employee-name')?.value?.trim() ||
      card.querySelector('.task-checkbox:checked') ||
      card.querySelector('[data-photo-previews] img') ||
      card.querySelector('[data-offline-draft-status]')?.textContent?.trim()
    );
    if(!hasContent) return;
    const details = card.querySelector(':scope .doc-details');
    if(!(details instanceof HTMLDetailsElement)) return;
    details.open = true;
    const key = api.detailsKey?.(details);
    if(key) api.openStates?.set(key, true);
  }

  function scan(){
    document.querySelectorAll('.doc-card[data-checklist-id][data-offline-restored="1"]').forEach(openRestoredDraft);
  }

  const observer = new MutationObserver(records => {
    const relevant = records.some(record => {
      const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
      return Boolean(target?.closest?.('.doc-card[data-checklist-id]'));
    });
    if(!relevant) return;
    queueMicrotask(scan);
    setTimeout(scan, 120);
    setTimeout(scan, 1100);
  });
  observer.observe(document.querySelector('#app') || document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['data-offline-restored'] });
  scan();

  global.SovremennikControlDraftKeyBridge = Object.freeze({
    VERSION:'2026-07-25-control-draft-key-2',
    scan
  });
})(window);

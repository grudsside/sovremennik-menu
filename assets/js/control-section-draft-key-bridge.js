/* Современник — keep checklist drafts stable before and after photo/offline enhancement. */
(function(global){
  'use strict';
  const api = global.SovremennikControlSectionStability;
  const drafts = api?.checklistDrafts;
  if(!(drafts instanceof Map) || drafts.__sovremennikStableKeys) return;

  // The coordinator loads after the checklist UI and may initially see an auto-filled
  // employee name with every checkbox still false. That is not a user draft and must
  // never override the later IndexedDB restoration.
  drafts.clear();

  const nativeSet = drafts.set.bind(drafts);
  Object.defineProperty(drafts, '__sovremennikStableKeys', { value:true });

  drafts.set = function(checklistId, draft){
    const id = String(checklistId || '');
    const card = document.querySelector(`.doc-card[data-checklist-id="${CSS.escape(id)}"]`);
    if(card?.dataset?.offlineSuppressDraft === '1'){
      drafts.delete(id);
      return drafts;
    }

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

    const hasCheckedItem = checks.some(row => row.checked);
    const active = document.activeElement;
    const userEditingThisCard = Boolean(card && active && card.contains(active));
    const alreadyTracked = drafts.has(id);

    // Ignore background snapshots consisting only of the auto-filled name and false
    // checkboxes. A real input/change event has focus inside the card and is accepted.
    if(!alreadyTracked && !hasCheckedItem && !userEditingThisCard) return drafts;
    return nativeSet(id, { ...draft, checks });
  };

  function clearSuppressedDraft(card){
    if(!card || card.dataset.offlineSuppressDraft !== '1') return false;
    const id = String(card.dataset.checklistId || '');
    if(id) drafts.delete(id);
    const details = card.querySelector(':scope .doc-details');
    const key = details instanceof HTMLDetailsElement ? api.detailsKey?.(details) : '';
    if(key) api.openStates?.delete(key);
    return true;
  }

  function snapshotRestoredCard(card){
    const id = String(card?.dataset?.checklistId || '');
    if(!id || clearSuppressedDraft(card)) return;
    const inputs = Array.from(card.querySelectorAll('.task-checkbox'));
    const checks = inputs.map((input, index) => ({
      key:String(input.dataset.photoItemKey || input.dataset.task || index),
      checked:Boolean(input.checked)
    }));
    if(!checks.some(row => row.checked) && !card.querySelector('[data-photo-previews] img')) return;
    drafts.set(id, {
      employeeName:String(card.querySelector('.employee-name')?.value || ''),
      checks
    });
  }

  function openRestoredDraft(card){
    if(!card || clearSuppressedDraft(card) || card.dataset.offlineRestored !== '1') return;
    const hasContent = Boolean(
      card.querySelector('.employee-name')?.value?.trim() ||
      card.querySelector('.task-checkbox:checked') ||
      card.querySelector('[data-photo-previews] img') ||
      card.querySelector('[data-offline-draft-status]')?.textContent?.trim()
    );
    if(!hasContent) return;

    snapshotRestoredCard(card);

    const details = card.querySelector(':scope .doc-details');
    if(!(details instanceof HTMLDetailsElement)) return;
    details.open = true;
    const key = api.detailsKey?.(details);
    if(key) api.openStates?.set(key, true);
  }

  function scan(){
    document.querySelectorAll('.doc-card[data-checklist-id]').forEach(card => {
      if(clearSuppressedDraft(card)) return;
      if(card.dataset.offlineRestored === '1') openRestoredDraft(card);
    });
  }

  const observer = new MutationObserver(records => {
    const relevant = records.some(record => {
      const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
      return Boolean(target?.closest?.('.doc-card[data-checklist-id]'));
    });
    if(!relevant) return;
    // Run synchronously in the observer microtask so the coordinator's rAF restoration
    // sees the draft already removed when offline submission intentionally clears it.
    scan();
    queueMicrotask(scan);
    setTimeout(scan, 120);
    setTimeout(scan, 1100);
  });
  observer.observe(document.querySelector('#app') || document.body, {
    childList:true,
    subtree:true,
    attributes:true,
    attributeFilter:['data-offline-restored','data-offline-suppress-draft']
  });
  scan();

  global.SovremennikControlDraftKeyBridge = Object.freeze({
    VERSION:'2026-07-25-control-draft-key-4',
    scan
  });
})(window);

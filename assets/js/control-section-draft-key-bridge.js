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

  global.SovremennikControlDraftKeyBridge = Object.freeze({
    VERSION:'2026-07-25-control-draft-key-1'
  });
})(window);

/* Современник checklist details — keep submitted item rows visible in Control. */
(function(){
  'use strict';

  if(typeof normalizeRemoteRecord !== 'function') return;

  const normalizeRemoteRecordBeforeChecklistDetailsFix = normalizeRemoteRecord;
  const renderRecordDetailsBeforeChecklistDetailsFix = typeof renderRecordDetails === 'function'
    ? renderRecordDetails
    : null;

  function parseChecklistItems(value){
    let items = value;
    if(typeof items === 'string'){
      try { items = JSON.parse(items); }
      catch(error){ return []; }
    }
    if(!Array.isArray(items)) return [];

    return items.map(item => {
      const checkedValue = item?.checked;
      const checked = checkedValue === true
        || checkedValue === 1
        || String(checkedValue ?? '').trim().toLowerCase() === 'true'
        || String(checkedValue ?? '').trim() === '1';
      return {
        text: item?.text || item?.task || item?.label || 'Пункт чек-листа',
        checked
      };
    });
  }

  function normalizeChecklistRecord(row){
    const normalized = normalizeRemoteRecordBeforeChecklistDetailsFix(row);
    if(Array.isArray(normalized?.tasks) && normalized.tasks.length) return normalized;

    const sources = [row?.tasks, row?.items, row?.details];
    for(const source of sources){
      const tasks = parseChecklistItems(source);
      if(tasks.length){
        normalized.tasks = tasks;
        break;
      }
    }
    return normalized;
  }

  window.normalizeRemoteRecord = normalizeRemoteRecord = normalizeChecklistRecord;

  if(renderRecordDetailsBeforeChecklistDetailsFix){
    function renderChecklistDetails(record){
      const tasks = Array.isArray(record?.tasks) ? record.tasks : [];
      if(tasks.length) return renderRecordDetailsBeforeChecklistDetailsFix(record);
      const totals = typeof recordDoneTotal === 'function'
        ? recordDoneTotal(record)
        : { done:Number(record?.completed || 0), total:Number(record?.total || 0) };
      return `<details class="control-details"><summary>Показать заполненный чек-лист</summary><p class="control-details-empty">Пункты этой записи не сохранились. Итог выполнения: ${totals.done}/${totals.total}.</p></details>`;
    }
    window.renderRecordDetails = renderRecordDetails = renderChecklistDetails;
  }
})();

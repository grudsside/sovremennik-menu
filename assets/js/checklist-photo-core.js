/* Современник checklist photo reports — pure shared calculations. */
(function(root){
  'use strict';

  const VERSION = '2026-07-22-photo-preview-1';

  function text(value){ return String(value ?? '').trim(); }
  function number(value, fallback = 0){
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  function bool(value){
    if(value === true || value === 1) return true;
    const normalized = text(value).toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'да';
  }
  function clampRequired(value){ return Math.max(0, Math.min(3, Math.round(number(value, 0)))); }
  function itemKey(checklistId, sectionIndex, rowIndex){
    return `${text(checklistId) || 'checklist'}:${number(sectionIndex, 0)}:${number(rowIndex, 0)}`;
  }
  function ruleKey(checklistId, key){ return `${text(checklistId)}|${text(key)}`; }
  function rowText(row){
    return text(row?.task || row?.text || row?.label || 'Пункт чек-листа');
  }
  function flattenChecklist(doc){
    const rows = [];
    (doc?.sections || []).forEach((section, sectionIndex) => {
      (section?.rows || []).forEach((row, rowIndex) => {
        rows.push({
          checklistId: text(doc?.id),
          checklistTitle: text(doc?.title),
          sectionIndex,
          rowIndex,
          sectionTitle: text(section?.title),
          itemKey: itemKey(doc?.id, sectionIndex, rowIndex),
          itemText: rowText(row),
          row
        });
      });
    });
    return rows;
  }
  function rulesByKey(rows){
    const map = new Map();
    (rows || []).forEach(row => {
      if(row?.is_active === false || row?.isActive === false) return;
      const checklistId = text(row?.checklist_id || row?.checklistId);
      const key = text(row?.item_key || row?.itemKey);
      if(!checklistId || !key) return;
      map.set(ruleKey(checklistId, key), {
        checklistId,
        itemKey:key,
        itemText:text(row?.item_text || row?.itemText),
        requiredCount:Math.max(1, clampRequired(row?.required_count ?? row?.requiredCount ?? 1)),
        hint:text(row?.hint),
        isActive:true
      });
    });
    return map;
  }
  function activePhotos(photos){ return (photos || []).filter(photo => !photo?.deleted_at && !photo?.deletedAt); }
  function photoCountsByItem(photos){
    const map = new Map();
    activePhotos(photos).forEach(photo => {
      const key = text(photo?.item_key || photo?.itemKey);
      if(!key) return;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }
  function evaluateTask(task, attachedCount = 0){
    const requiredCount = clampRequired(task?.requiredPhotoCount ?? task?.required_photo_count ?? (bool(task?.photoRequired ?? task?.photo_required) ? 1 : 0));
    const checkedByUser = task?.checkedByUser === undefined && task?.checked_by_user === undefined
      ? bool(task?.checked)
      : bool(task?.checkedByUser ?? task?.checked_by_user);
    const photoCount = Math.max(0, Math.round(number(attachedCount, task?.photoCount ?? task?.photo_count ?? 0)));
    const photoSatisfied = requiredCount === 0 || photoCount >= requiredCount;
    const checked = checkedByUser && photoSatisfied;
    const photoStatus = requiredCount === 0
      ? 'not_required'
      : photoCount >= requiredCount
        ? 'complete'
        : photoCount > 0
          ? 'partial'
          : checkedByUser
            ? 'awaiting_photo'
            : 'missing';
    return {
      ...task,
      itemKey:text(task?.itemKey || task?.item_key),
      text:text(task?.text || task?.task || task?.label || 'Пункт чек-листа'),
      checkedByUser,
      checked,
      photoRequired:requiredCount > 0,
      requiredPhotoCount:requiredCount,
      photoCount,
      missingPhotoCount:Math.max(0, requiredCount - photoCount),
      photoStatus
    };
  }
  function summarize(items, photos = []){
    const counts = photoCountsByItem(photos);
    const evaluated = (items || []).map(item => evaluateTask(item, counts.get(text(item?.itemKey || item?.item_key)) || 0));
    const total = evaluated.length;
    const done = evaluated.filter(item => item.checked).length;
    const requiredPhotos = evaluated.reduce((sum, item) => sum + item.requiredPhotoCount, 0);
    const attachedPhotos = activePhotos(photos).length;
    const missingPhotos = evaluated.reduce((sum, item) => sum + item.missingPhotoCount, 0);
    const percent = total ? Math.round(done / total * 100) : 0;
    const photoUploadStatus = requiredPhotos === 0
      ? 'not_required'
      : missingPhotos === 0
        ? 'complete'
        : attachedPhotos > 0
          ? 'partial'
          : 'pending';
    return {
      items:evaluated,
      done,
      total,
      percent,
      requiredPhotos,
      attachedPhotos,
      missingPhotos,
      photoUploadStatus,
      incomplete:done < total
    };
  }
  function localDateKey(value){
    const date = value instanceof Date ? value : new Date(value);
    if(Number.isNaN(date.getTime())) return text(value).slice(0, 10) || 'unknown';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  function groupRecordsByDay(records){
    const map = new Map();
    (records || []).forEach(record => {
      const key = localDateKey(record?.createdAt || record?.created_at || record?.date || '');
      if(!map.has(key)) map.set(key, []);
      map.get(key).push(record);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([dateKey, rows]) => ({
        dateKey,
        records:rows.sort((a,b) => String(b?.createdAt || b?.created_at || '').localeCompare(String(a?.createdAt || a?.created_at || '')))
      }));
  }
  function safePathSegment(value){
    const normalized = text(value)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    return normalized || 'item';
  }
  function buildStoragePaths({ userId, submissionId, itemKey: key, index = 1, nonce = Date.now() }){
    const base = `${safePathSegment(userId)}/${safePathSegment(submissionId)}/${safePathSegment(key)}`;
    const suffix = `${Math.max(1, Math.min(3, Math.round(number(index, 1))))}-${safePathSegment(nonce)}`;
    return {
      fullPath:`${base}/full-${suffix}.jpg`,
      thumbnailPath:`${base}/thumb-${suffix}.jpg`
    };
  }
  function progressClass(percent){
    const value = number(percent, 0);
    if(value >= 100) return 'complete';
    if(value >= 80) return 'warning';
    return 'danger';
  }

  root.SovremennikChecklistPhotoCore = Object.freeze({
    VERSION,
    bool,
    clampRequired,
    itemKey,
    ruleKey,
    flattenChecklist,
    rulesByKey,
    activePhotos,
    photoCountsByItem,
    evaluateTask,
    summarize,
    localDateKey,
    groupRecordsByDay,
    safePathSegment,
    buildStoragePaths,
    progressClass
  });
})(typeof window !== 'undefined' ? window : globalThis);

/* Современник — Control v4 pure helpers. */
(function(global){
  'use strict';

  if(global.SovremennikControlV4Core) return;

  const VERSION = '2026-07-30-control-v4-core-1';
  const ROLE_ALIASES = Object.freeze({
    'администратор':'admin', admin:'admin',
    'руководитель':'manager', manager:'manager', 'менеджер':'manager',
    'бариста':'barista', barista:'barista', 'бармен':'barista', bartender:'barista',
    'официант':'waiter', waiter:'waiter'
  });

  function text(value){ return String(value ?? '').replace(/\s+/g, ' ').trim(); }
  function normalizeRole(value){
    const role = text(value).toLowerCase();
    return ROLE_ALIASES[role] || role;
  }
  function uuid(){
    if(global.crypto?.randomUUID) return global.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
      const random = Math.random() * 16 | 0;
      const value = character === 'x' ? random : (random & 0x3 | 0x8);
      return value.toString(16);
    });
  }
  function clamp(value, min, max){ return Math.min(max, Math.max(min, Number(value) || 0)); }
  function dateKey(value){
    if(!value) return '';
    if(/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
    const date = value instanceof Date ? value : new Date(value);
    if(Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  function displayDate(value){
    const key = dateKey(value);
    if(!key) return text(value) || '—';
    const date = new Date(`${key}T12:00:00`);
    return date.toLocaleDateString('ru-RU', { day:'2-digit', month:'long', year:'numeric' });
  }
  function displayDateTime(value){
    const date = value ? new Date(value) : null;
    if(!date || Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('ru-RU', {
      day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit'
    });
  }
  function itemKey(checklistId, sectionIndex, rowIndex, row){
    return text(row?.itemKey || row?.item_key || `${checklistId}:${sectionIndex}:${rowIndex}`);
  }
  function flattenChecklist(doc){
    const result = [];
    (doc?.sections || []).forEach((section, sectionIndex) => {
      (section?.rows || []).forEach((row, rowIndex) => result.push({
        itemKey:itemKey(doc?.id || '', sectionIndex, rowIndex, row),
        itemText:text(row?.task || row?.text || row?.label || 'Пункт чек-листа'),
        sectionTitle:text(section?.title),
        row,
        sectionIndex,
        rowIndex
      }));
    });
    return result;
  }
  function departmentForDoc(doc){
    const explicit = normalizeRole(doc?.department || doc?.role || doc?.audience);
    if(explicit === 'waiter') return 'waiter';
    if(explicit === 'barista') return 'barista';
    const source = `${doc?.id || ''} ${doc?.title || ''} ${doc?.description || ''}`.toLowerCase();
    return /waiter|официант/.test(source) ? 'waiter' : 'barista';
  }
  function normalizeTask(raw, index = 0){
    const checkedByUser = Boolean(raw?.checkedByUser ?? raw?.checked_by_user ?? raw?.checked);
    const requiredPhotoCount = Math.max(0, Number(raw?.requiredPhotoCount ?? raw?.required_photo_count ?? 0) || 0);
    const photoCount = Math.max(0, Number(raw?.photoCount ?? raw?.photo_count ?? 0) || 0);
    return {
      itemKey:text(raw?.itemKey || raw?.item_key || raw?.text || `item-${index}`),
      text:text(raw?.text || raw?.task || raw?.label || 'Пункт чек-листа'),
      sectionTitle:text(raw?.sectionTitle || raw?.section_title),
      checkedByUser,
      checked:Boolean(raw?.checked ?? (checkedByUser && photoCount >= requiredPhotoCount)),
      photoRequired:Boolean(raw?.photoRequired ?? raw?.photo_required ?? requiredPhotoCount > 0),
      requiredPhotoCount,
      photoCount,
      photoStatus:text(raw?.photoStatus || raw?.photo_status)
    };
  }
  function summarize(tasks){
    const items = (tasks || []).map(normalizeTask);
    const done = items.filter(item => item.checked).length;
    const total = items.length;
    const requiredPhotos = items.reduce((sum, item) => sum + item.requiredPhotoCount, 0);
    const photoCount = items.reduce((sum, item) => sum + item.photoCount, 0);
    const missingPhotos = items.reduce((sum, item) => sum + Math.max(0, item.requiredPhotoCount - item.photoCount), 0);
    return {
      items,
      done,
      total,
      percent:total ? Math.round(done / total * 100) : 0,
      requiredPhotos,
      photoCount,
      missingPhotos,
      incomplete:done < total || missingPhotos > 0
    };
  }
  function normalizeSubmission(row){
    const tasks = Array.isArray(row?.items) ? row.items : Array.isArray(row?.tasks) ? row.tasks : [];
    const normalizedTasks = tasks.map(normalizeTask);
    const summary = summarize(normalizedTasks);
    return {
      id:text(row?.id),
      checklistId:text(row?.checklist_id || row?.checklistId),
      checklistTitle:text(row?.checklist_title || row?.checklistTitle || 'Чек-лист'),
      employeeId:text(row?.employee_id || row?.employeeId),
      employeeName:text(row?.employee_name || row?.employeeName),
      createdAt:row?.created_at || row?.createdAt || new Date().toISOString(),
      tasks:normalizedTasks,
      completed:Number(row?.completed_count ?? row?.completed ?? summary.done),
      total:Number(row?.total_count ?? row?.total ?? summary.total),
      percent:Number(row?.percent ?? summary.percent),
      photoRequiredCount:Number(row?.photo_required_count ?? row?.photoRequiredCount ?? summary.requiredPhotos),
      photoCount:Number(row?.photo_count ?? row?.photoCount ?? summary.photoCount),
      photoUploadStatus:text(row?.photo_upload_status || row?.photoUploadStatus || 'not_required'),
      submittedIncomplete:Boolean(row?.submitted_incomplete ?? row?.submittedIncomplete),
      deletedAt:row?.deleted_at || null,
      photos:Array.isArray(row?.photos) ? row.photos : [],
      comments:Array.isArray(row?.comments) ? row.comments : []
    };
  }
  function groupSubmissions(rows){
    const groups = new Map();
    (rows || []).map(normalizeSubmission).forEach(row => {
      const key = dateKey(row.createdAt) || 'unknown';
      if(!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    return Array.from(groups.entries())
      .sort((left, right) => right[0].localeCompare(left[0]))
      .map(([key, records]) => ({
        dateKey:key,
        label:displayDate(key),
        records:records.sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      }));
  }
  function progressClass(percent){
    const value = Number(percent) || 0;
    if(value >= 100) return 'complete';
    if(value >= 70) return 'warning';
    return 'danger';
  }
  function draftKey(userId, checklistId){ return `${text(userId)}|${text(checklistId)}`; }
  function isDuplicateError(error){
    const code = String(error?.code || '');
    const message = String(error?.message || '').toLowerCase();
    return code === '23505' || message.includes('duplicate') || message.includes('unique constraint');
  }
  function safeFilePart(value){
    return text(value || 'item').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'item';
  }
  function photoPaths({ userId, submissionId, itemKey:item, index }){
    const base = `${safeFilePart(userId)}/${safeFilePart(submissionId)}/${safeFilePart(item)}`;
    const number = Math.max(1, Number(index) || 1);
    return {
      fullPath:`${base}/full-${number}.jpg`,
      thumbnailPath:`${base}/thumb-${number}.jpg`
    };
  }
  function stableStringify(value){
    if(value === null || typeof value !== 'object') return JSON.stringify(value);
    if(Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  function hash(value){
    let result = 2166136261;
    for(const character of String(value || '')){
      result ^= character.charCodeAt(0);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  }
  function snapshotFingerprint(snapshot){
    return hash(stableStringify({
      userId:text(snapshot?.userId),
      checklistId:text(snapshot?.checklistId),
      employeeName:text(snapshot?.employeeName).toLowerCase(),
      tasks:(snapshot?.tasks || []).map(task => {
        const item = normalizeTask(task);
        return [item.itemKey, item.checkedByUser, item.requiredPhotoCount, item.photoCount];
      })
    }));
  }

  global.SovremennikControlV4Core = Object.freeze({
    VERSION,
    text,
    normalizeRole,
    uuid,
    clamp,
    dateKey,
    displayDate,
    displayDateTime,
    flattenChecklist,
    departmentForDoc,
    normalizeTask,
    summarize,
    normalizeSubmission,
    groupSubmissions,
    progressClass,
    draftKey,
    isDuplicateError,
    photoPaths,
    stableStringify,
    snapshotFingerprint
  });
})(window);

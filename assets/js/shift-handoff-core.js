/* Современник — pure helpers for shift handoff. */
(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.SovremennikShiftHandoffCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function(){
  'use strict';

  const SECTIONS = [
    { key:'unfinished', label:'Осталось незавершённым' },
    { key:'outOfStock', label:'Закончились позиции' },
    { key:'equipmentIssues', label:'Проблемы с оборудованием' },
    { key:'nextShiftControl', label:'Проконтролировать следующей смене' }
  ];

  function cleanText(value){
    return String(value == null ? '' : value).replace(/\r/g, '').trim();
  }

  function splitLines(value){
    const source = Array.isArray(value) ? value : cleanText(value).split('\n');
    const seen = new Set();
    return source
      .flatMap(item => String(item == null ? '' : item).split('\n'))
      .map(item => item.replace(/^\s*[-•–—]\s*/, '').trim())
      .filter(Boolean)
      .filter(item => {
        const marker = item.toLocaleLowerCase('ru-RU');
        if(seen.has(marker)) return false;
        seen.add(marker);
        return true;
      })
      .slice(0, 30);
  }

  function normalizeDraft(value){
    const source = value || {};
    return {
      unfinished:splitLines(source.unfinished),
      outOfStock:splitLines(source.outOfStock || source.out_of_stock),
      equipmentIssues:splitLines(source.equipmentIssues || source.equipment_issues),
      nextShiftControl:splitLines(source.nextShiftControl || source.next_shift_control),
      notes:cleanText(source.notes).slice(0, 2000)
    };
  }

  function hasContent(value){
    const draft = normalizeDraft(value);
    return SECTIONS.some(section => draft[section.key].length > 0) || Boolean(draft.notes);
  }

  function toDatabaseRow(value){
    const draft = normalizeDraft(value);
    return {
      unfinished:draft.unfinished,
      out_of_stock:draft.outOfStock,
      equipment_issues:draft.equipmentIssues,
      next_shift_control:draft.nextShiftControl,
      notes:draft.notes
    };
  }

  function fromDatabaseRow(row){
    const source = row || {};
    return {
      ...source,
      unfinished:splitLines(source.unfinished),
      outOfStock:splitLines(source.out_of_stock || source.outOfStock),
      equipmentIssues:splitLines(source.equipment_issues || source.equipmentIssues),
      nextShiftControl:splitLines(source.next_shift_control || source.nextShiftControl),
      notes:cleanText(source.notes),
      acknowledgements:Array.isArray(source.acknowledgements) ? source.acknowledgements : [],
      photos:Array.isArray(source.photos) ? source.photos : []
    };
  }

  function sectionRows(row){
    const normalized = fromDatabaseRow(row);
    return SECTIONS
      .map(section => ({ ...section, items:normalized[section.key] }))
      .filter(section => section.items.length > 0);
  }

  function isAcknowledgedBy(row, userId){
    const id = String(userId || '');
    return Boolean(id && (row?.acknowledgements || []).some(item => String(item.employee_id || item.employeeId || '') === id));
  }

  function pendingForUser(rows, userId, now = new Date()){
    const current = now instanceof Date ? now : new Date(now);
    return (Array.isArray(rows) ? rows : [])
      .map(fromDatabaseRow)
      .filter(row => String(row.created_by || row.createdBy || '') !== String(userId || ''))
      .filter(row => !isAcknowledgedBy(row, userId))
      .filter(row => {
        const visibleUntil = row.visible_until || row.visibleUntil;
        return !visibleUntil || new Date(visibleUntil) >= current;
      })
      .sort((a,b) => new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0))[0] || null;
  }

  function buildStoragePath(userId, handoffId, photoId){
    const safe = value => String(value || '').replace(/[^a-zA-Z0-9-]/g, '');
    const owner = safe(userId);
    const handoff = safe(handoffId);
    const photo = safe(photoId);
    if(!owner || !handoff || !photo) throw new Error('Не удалось подготовить путь фотографии.');
    return `${owner}/${handoff}/${photo}.jpg`;
  }

  function formatDateTime(value, locale = 'ru-RU'){
    const date = value instanceof Date ? value : new Date(value);
    if(Number.isNaN(date.getTime())) return 'время не указано';
    return date.toLocaleString(locale, { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }

  return {
    SECTIONS,
    cleanText,
    splitLines,
    normalizeDraft,
    hasContent,
    toDatabaseRow,
    fromDatabaseRow,
    sectionRows,
    isAcknowledgedBy,
    pendingForUser,
    buildStoragePath,
    formatDateTime
  };
});

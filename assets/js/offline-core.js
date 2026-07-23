/* Современник offline reliability — pure helpers. */
(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  root.SovremennikOfflineCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';

  const VERSION = '2026-07-23-offline-v1';

  function text(value){ return String(value ?? '').trim(); }
  function number(value, fallback = 0){
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  function uuid(){
    if(globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
      const random = Math.random() * 16 | 0;
      const value = char === 'x' ? random : (random & 0x3 | 0x8);
      return value.toString(16);
    });
  }
  function draftKey(userId, checklistId){
    return `${text(userId) || 'anonymous'}|${text(checklistId) || 'checklist'}`;
  }
  function queueKey(userId, submissionId){
    return `${text(userId) || 'anonymous'}|${text(submissionId) || uuid()}`;
  }
  function normalizeTask(task, index = 0){
    const required = Math.max(0, Math.round(number(task?.requiredPhotoCount ?? task?.required_photo_count, 0)));
    const checkedByUser = Boolean(task?.checkedByUser ?? task?.checked_by_user ?? task?.checked);
    const photoCount = Math.max(0, Math.round(number(task?.photoCount ?? task?.photo_count, 0)));
    const checked = checkedByUser && (required === 0 || photoCount >= required);
    return {
      itemKey:text(task?.itemKey || task?.item_key || `item-${index}`),
      text:text(task?.text || task?.task || task?.label || 'Пункт чек-листа'),
      sectionTitle:text(task?.sectionTitle || task?.section_title),
      checkedByUser,
      checked,
      photoRequired:required > 0,
      requiredPhotoCount:required,
      photoCount,
      photoStatus:required === 0 ? 'not_required' : photoCount >= required ? 'selected' : checkedByUser ? 'awaiting_photo' : 'missing'
    };
  }
  function summarize(tasks){
    const items = (tasks || []).map(normalizeTask);
    const total = items.length;
    const done = items.filter(item => item.checked).length;
    const requiredPhotos = items.reduce((sum, item) => sum + item.requiredPhotoCount, 0);
    const photoCount = items.reduce((sum, item) => sum + item.photoCount, 0);
    const missingPhotos = items.reduce((sum, item) => sum + Math.max(0, item.requiredPhotoCount - item.photoCount), 0);
    return {
      items,
      total,
      done,
      percent:total ? Math.round(done / total * 100) : 0,
      requiredPhotos,
      photoCount,
      missingPhotos,
      incomplete:done < total
    };
  }
  function retryDelay(attempt){
    const step = Math.max(0, Math.round(number(attempt, 0)));
    return Math.min(5 * 60 * 1000, 2000 * Math.pow(2, Math.min(step, 8)));
  }
  function isDuplicateError(error){
    const code = text(error?.code).toLowerCase();
    const message = text(error?.message).toLowerCase();
    return code === '23505' || message.includes('duplicate key') || message.includes('already exists');
  }
  function connectionLabel({ online, pending = 0, syncing = false }){
    const count = Math.max(0, Math.round(number(pending, 0)));
    if(syncing) return count ? `Синхронизация · ${count}` : 'Синхронизация';
    if(!online) return count ? `Нет соединения · ожидает отправки: ${count}` : 'Нет соединения';
    if(count) return `Онлайн · ожидает отправки: ${count}`;
    return 'Онлайн';
  }

  return Object.freeze({
    VERSION,
    text,
    number,
    uuid,
    draftKey,
    queueKey,
    normalizeTask,
    summarize,
    retryDelay,
    isDuplicateError,
    connectionLabel
  });
});

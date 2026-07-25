/* Современник — reliable checklist photo drafts independent from DOM redraws. */
(function(global){
  'use strict';

  const VERSION = '2026-07-25-checklist-photo-draft-2';
  const DB_NAME = 'sovremennik-checklist-photo-drafts-v1';
  const STORE = 'photoDrafts';
  const restoreTimers = new Set();
  let databasePromise = null;
  let observer = null;

  function currentUserSafe(){
    try { return typeof currentUser === 'function' ? currentUser() : null; }
    catch(error){ return null; }
  }

  function cachedUserId(){
    try { return String(JSON.parse(localStorage.getItem('sovremennikOfflineProfileV1') || 'null')?.id || ''); }
    catch(error){ return ''; }
  }

  function currentUserId(){ return String(currentUserSafe()?.id || cachedUserId() || ''); }
  function draftKey(checklistId, itemKey){ return `${currentUserId()}|${checklistId}|${itemKey}`; }

  function openDatabase(){
    if(databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if(!db.objectStoreNames.contains(STORE)){
          const store = db.createObjectStore(STORE, { keyPath:'key' });
          store.createIndex('userId', 'userId', { unique:false });
          store.createIndex('checklistId', 'checklistId', { unique:false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Не удалось открыть хранилище фото-черновиков.'));
    });
    return databasePromise;
  }

  async function requestStore(mode, callback){
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const store = transaction.objectStore(STORE);
      let request;
      try { request = callback(store); }
      catch(error){ reject(error); return; }
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = () => reject(transaction.error || request?.error || new Error('Ошибка хранилища фото-черновиков.'));
      transaction.onabort = () => reject(transaction.error || new Error('Сохранение фото-черновика отменено.'));
    });
  }

  async function getRecord(key){ return await requestStore('readonly', store => store.get(key)); }
  async function putRecord(value){ await requestStore('readwrite', store => store.put(value)); return value; }
  async function deleteRecord(key){ await requestStore('readwrite', store => store.delete(key)); }
  async function getAll(){ return (await requestStore('readonly', store => store.getAll())) || []; }

  function fieldInfo(input){
    const field = input?.closest?.('[data-checklist-photo-field]');
    const card = input?.closest?.('.doc-card[data-checklist-id]');
    if(!field || !card) return null;
    const checklistId = String(card.dataset.checklistId || field.dataset.checklistId || '');
    const itemKey = String(field.dataset.itemKey || '');
    if(!checklistId || !itemKey || !currentUserId()) return null;
    return { field, card, checklistId, itemKey, required:Number(field.dataset.requiredCount || 3) || 3 };
  }

  function serializeFiles(files){
    return Array.from(files || []).map(file => ({
      name:String(file.name || 'photo.jpg'),
      type:String(file.type || 'image/jpeg'),
      lastModified:Number(file.lastModified || Date.now()),
      blob:file
    }));
  }

  async function saveSelectedFiles(input, selectedFiles){
    const info = fieldInfo(input);
    if(!info || !selectedFiles.length || info.field.dataset.photoDraftRestoring === '1') return;
    const key = draftKey(info.checklistId, info.itemKey);
    const existing = await getRecord(key).catch(() => null);
    const merged = [ ...(existing?.files || []), ...serializeFiles(selectedFiles) ].slice(0, info.required);
    await putRecord({
      key,
      userId:currentUserId(),
      checklistId:info.checklistId,
      itemKey:info.itemKey,
      files:merged,
      updatedAt:new Date().toISOString()
    });
    scheduleRestore(0);
  }

  async function removeStoredFile(button, index){
    const field = button?.closest?.('[data-checklist-photo-field]');
    const card = button?.closest?.('.doc-card[data-checklist-id]');
    const checklistId = String(card?.dataset?.checklistId || field?.dataset?.checklistId || '');
    const itemKey = String(field?.dataset?.itemKey || '');
    if(!checklistId || !itemKey || !currentUserId() || index < 0) return;
    const key = draftKey(checklistId, itemKey);
    const record = await getRecord(key).catch(() => null);
    if(!record) return;
    const files = (record.files || []).filter((_, fileIndex) => fileIndex !== index);
    if(files.length) await putRecord({ ...record, files, updatedAt:new Date().toISOString() });
    else await deleteRecord(key);
  }

  async function restoreField(field){
    if(!field || field.dataset.photoDraftRestoring === '1' || field.dataset.offlineRestoring === '1') return;
    if(field.querySelector('[data-photo-previews] img')) return;
    const card = field.closest('.doc-card[data-checklist-id]');
    const checklistId = String(card?.dataset?.checklistId || field.dataset.checklistId || '');
    const itemKey = String(field.dataset.itemKey || '');
    const input = field.querySelector('[data-photo-input]');
    if(!checklistId || !itemKey || !input || !currentUserId() || typeof DataTransfer === 'undefined') return;
    const record = await getRecord(draftKey(checklistId, itemKey)).catch(() => null);
    if(!record?.files?.length || field.querySelector('[data-photo-previews] img')) return;

    field.dataset.photoDraftRestoring = '1';
    field.dataset.offlineRestoring = '1';
    try{
      const transfer = new DataTransfer();
      (record.files || []).forEach((stored, index) => {
        const blob = stored.blob;
        if(!blob) return;
        transfer.items.add(new File(
          [blob],
          stored.name || `draft-photo-${index + 1}.jpg`,
          { type:stored.type || blob.type || 'image/jpeg', lastModified:Number(stored.lastModified || Date.now()) }
        ));
      });
      if(transfer.files.length){
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles:true }));
      }
    } catch(error){
      console.warn('Checklist photo draft restore skipped', error);
    } finally {
      setTimeout(() => {
        field.dataset.photoDraftRestoring = '0';
        field.dataset.offlineRestoring = '0';
      }, 1800);
    }
  }

  async function restoreAll(){
    if(!currentUserId()) return;
    const fields = Array.from(document.querySelectorAll('[data-checklist-photo-field]'));
    for(const field of fields) await restoreField(field);
  }

  function scheduleRestore(delay = 120){
    const timer = setTimeout(async () => {
      restoreTimers.delete(timer);
      await restoreAll();
    }, delay);
    restoreTimers.add(timer);
  }

  async function clearChecklist(checklistId){
    const userId = currentUserId();
    if(!userId || !checklistId) return;
    const rows = await getAll().catch(() => []);
    for(const row of rows){
      if(String(row.userId) === userId && String(row.checklistId) === String(checklistId)) await deleteRecord(row.key);
    }
  }

  function cardIsEmpty(card){
    if(!card) return false;
    const noName = !String(card.querySelector('.employee-name')?.value || '').trim();
    const noChecks = !Array.from(card.querySelectorAll('.task-checkbox')).some(input => input.checked);
    const noPhotos = !card.querySelector('[data-photo-previews] img');
    return noName && noChecks && noPhotos;
  }

  function wrapSubmit(){
    const original = global.submitChecklist;
    if(typeof original !== 'function' || original.__photoDraftWrapped) return;
    async function wrapped(docId){
      const result = await original.apply(this, arguments);
      setTimeout(async () => {
        const card = document.querySelector(`.doc-card[data-checklist-id="${CSS.escape(String(docId))}"]`);
        if(cardIsEmpty(card)) await clearChecklist(String(docId));
        else scheduleRestore(0);
      }, 1200);
      return result;
    }
    wrapped.__photoDraftWrapped = true;
    wrapped.__photoDraftOriginal = original;
    global.submitChecklist = wrapped;
    try { submitChecklist = wrapped; } catch(error){}
  }

  document.addEventListener('change', event => {
    const input = event.target.closest?.('[data-photo-input]');
    if(!input) return;
    const selected = Array.from(input.files || []);
    if(selected.length) void saveSelectedFiles(input, selected);
  }, true);

  document.addEventListener('click', event => {
    const remove = event.target.closest?.('[data-photo-remove]');
    if(!remove) return;
    const preview = remove.closest('.checklist-photo-preview');
    const container = preview?.parentElement;
    const index = preview && container ? Array.from(container.children).indexOf(preview) : -1;
    void removeStoredFile(remove, index);
  }, true);

  const startObserver = () => {
    if(observer || !global.MutationObserver) return;
    observer = new MutationObserver(records => {
      const relevant = records.some(record => Array.from(record.addedNodes || []).some(node =>
        node.nodeType === 1 && (node.matches?.('.doc-card,[data-checklist-photo-field]') || node.querySelector?.('.doc-card,[data-checklist-photo-field]'))
      ));
      if(relevant){
        scheduleRestore(80);
        scheduleRestore(500);
      }
    });
    observer.observe(document.body, { childList:true, subtree:true });
  };

  wrapSubmit();
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once:true });
  else startObserver();
  scheduleRestore(150);
  scheduleRestore(900);

  global.SovremennikChecklistPhotoDraftFix = Object.freeze({
    VERSION,
    restoreAll,
    clearChecklist,
    scheduleRestore,
    getAllForTesting:getAll
  });
})(window);

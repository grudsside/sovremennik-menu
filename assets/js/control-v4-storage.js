/* Современник — Control v4 single IndexedDB storage. */
(function(global){
  'use strict';

  if(global.SovremennikControlV4Storage) return;

  const Core = global.SovremennikControlV4Core;
  if(!Core || !global.indexedDB){
    console.error('Control v4 storage cannot start: IndexedDB or core is unavailable.');
    return;
  }

  const VERSION = '2026-07-30-control-v4-storage-1';
  const DB_NAME = 'sovremennik-control-v4';
  const DB_VERSION = 1;
  const DRAFTS = 'drafts';
  const QUEUE = 'queue';
  const META = 'meta';
  let databasePromise = null;

  function open(){
    if(databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = global.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if(!db.objectStoreNames.contains(DRAFTS)){
          const store = db.createObjectStore(DRAFTS, { keyPath:'key' });
          store.createIndex('userId', 'userId', { unique:false });
          store.createIndex('checklistId', 'checklistId', { unique:false });
          store.createIndex('status', 'status', { unique:false });
        }
        if(!db.objectStoreNames.contains(QUEUE)){
          const store = db.createObjectStore(QUEUE, { keyPath:'id' });
          store.createIndex('userId', 'userId', { unique:false });
          store.createIndex('checklistId', 'checklistId', { unique:false });
          store.createIndex('status', 'status', { unique:false });
          store.createIndex('createdAt', 'createdAt', { unique:false });
        }
        if(!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath:'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Не удалось открыть единое хранилище Control v4.'));
      request.onblocked = () => reject(new Error('Обновление локального хранилища заблокировано другой вкладкой.'));
    });
    return databasePromise;
  }

  async function request(storeName, mode, callback){
    const db = await open();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let operation;
      try { operation = callback(store); }
      catch(error){ reject(error); return; }
      transaction.oncomplete = () => resolve(operation?.result);
      transaction.onerror = () => reject(transaction.error || operation?.error || new Error('Ошибка локального хранилища.'));
      transaction.onabort = () => reject(transaction.error || new Error('Операция локального хранилища отменена.'));
    });
  }
  async function get(store, key){ return await request(store, 'readonly', target => target.get(key)); }
  async function put(store, value){ await request(store, 'readwrite', target => target.put(value)); return value; }
  async function remove(store, key){ await request(store, 'readwrite', target => target.delete(key)); }
  async function all(store){ return (await request(store, 'readonly', target => target.getAll())) || []; }

  function now(){ return new Date().toISOString(); }
  function normalizeDraft(raw){
    if(!raw) return null;
    const userId = Core.text(raw.userId);
    const checklistId = Core.text(raw.checklistId);
    if(!userId || !checklistId) return null;
    const tasks = (raw.tasks || raw.summary?.items || []).map(Core.normalizeTask);
    return {
      key:Core.draftKey(userId, checklistId),
      submissionId:Core.text(raw.submissionId || raw.id) || Core.uuid(),
      userId,
      checklistId,
      checklistTitle:Core.text(raw.checklistTitle),
      employeeName:Core.text(raw.employeeName),
      tasks,
      photos:Array.isArray(raw.photos) ? raw.photos.map((photo, index) => ({
        id:Core.text(photo?.id) || Core.uuid(),
        itemKey:Core.text(photo?.itemKey || photo?.item_key),
        index:Number(photo?.index || photo?.photoIndex || index + 1),
        name:Core.text(photo?.name) || `photo-${index + 1}.jpg`,
        type:Core.text(photo?.type || photo?.blob?.type) || 'image/jpeg',
        fullBlob:photo?.fullBlob || photo?.blob || null,
        thumbnailBlob:photo?.thumbnailBlob || photo?.blob || null
      })).filter(photo => photo.itemKey && photo.fullBlob) : [],
      status:['draft','submitting','pending','failed'].includes(raw.status) ? raw.status : 'draft',
      lastError:Core.text(raw.lastError),
      createdAt:raw.createdAt || now(),
      updatedAt:raw.updatedAt || now()
    };
  }
  function normalizeQueue(raw){
    if(!raw) return null;
    const userId = Core.text(raw.userId);
    const checklistId = Core.text(raw.checklistId);
    const id = Core.text(raw.id || raw.submissionId) || Core.uuid();
    if(!userId || !checklistId) return null;
    const tasks = (raw.tasks || raw.summary?.items || []).map(Core.normalizeTask);
    const summary = Core.summarize(tasks);
    return {
      id,
      userId,
      checklistId,
      checklistTitle:Core.text(raw.checklistTitle),
      employeeName:Core.text(raw.employeeName),
      tasks,
      photos:Array.isArray(raw.photos) ? raw.photos.map((photo, index) => ({
        id:Core.text(photo?.id) || Core.uuid(),
        itemKey:Core.text(photo?.itemKey || photo?.item_key),
        index:Number(photo?.index || photo?.photoIndex || index + 1),
        name:Core.text(photo?.name) || `photo-${index + 1}.jpg`,
        type:Core.text(photo?.type || photo?.blob?.type) || 'image/jpeg',
        fullBlob:photo?.fullBlob || photo?.blob || null,
        thumbnailBlob:photo?.thumbnailBlob || photo?.blob || null
      })).filter(photo => photo.itemKey && photo.fullBlob) : [],
      summary:raw.summary || summary,
      status:['pending','syncing','failed'].includes(raw.status) ? raw.status : 'pending',
      attemptCount:Number(raw.attemptCount || 0),
      lastError:Core.text(raw.lastError),
      createdAt:raw.createdAt || now(),
      updatedAt:raw.updatedAt || now()
    };
  }

  async function getDraft(userId, checklistId){ return normalizeDraft(await get(DRAFTS, Core.draftKey(userId, checklistId))); }
  async function saveDraft(raw){
    const draft = normalizeDraft({ ...raw, updatedAt:now() });
    if(!draft) throw new Error('Не удалось определить пользователя или чек-лист для черновика.');
    return await put(DRAFTS, draft);
  }
  async function deleteDraft(userId, checklistId){ await remove(DRAFTS, Core.draftKey(userId, checklistId)); }
  async function draftsForUser(userId){ return (await all(DRAFTS)).map(normalizeDraft).filter(row => row?.userId === String(userId)); }
  async function getQueue(id){ return normalizeQueue(await get(QUEUE, id)); }
  async function saveQueue(raw){
    const row = normalizeQueue({ ...raw, updatedAt:now() });
    if(!row) throw new Error('Не удалось подготовить запись очереди.');
    return await put(QUEUE, row);
  }
  async function deleteQueue(id){ await remove(QUEUE, id); }
  async function queueForUser(userId){
    return (await all(QUEUE)).map(normalizeQueue)
      .filter(row => row?.userId === String(userId))
      .sort((a,b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }
  async function pendingForChecklist(userId, checklistId){
    return (await queueForUser(userId)).filter(row => row.checklistId === String(checklistId));
  }
  async function setMeta(key, value){ return await put(META, { key, value, updatedAt:now() }); }
  async function getMeta(key){ return (await get(META, key))?.value; }

  async function readLegacyDatabase(name, stores){
    return await new Promise(resolve => {
      const request = global.indexedDB.open(name);
      let created = false;
      request.onupgradeneeded = () => { created = true; };
      request.onerror = () => resolve({});
      request.onsuccess = async () => {
        const db = request.result;
        if(created){ db.close(); global.indexedDB.deleteDatabase(name); resolve({}); return; }
        const result = {};
        for(const storeName of stores){
          if(!db.objectStoreNames.contains(storeName)){ result[storeName] = []; continue; }
          result[storeName] = await new Promise(done => {
            const tx = db.transaction(storeName, 'readonly');
            const getAll = tx.objectStore(storeName).getAll();
            getAll.onsuccess = () => done(getAll.result || []);
            getAll.onerror = () => done([]);
          });
        }
        db.close();
        resolve(result);
      };
    });
  }

  async function migrateLegacy(userId){
    const marker = `legacy-migrated:${userId}`;
    if(await getMeta(marker)) return { drafts:0, queue:0, photos:0 };
    const [offline, photoDrafts] = await Promise.all([
      readLegacyDatabase('sovremennik-offline-v1', ['checklistDrafts','submissionQueue']),
      readLegacyDatabase('sovremennik-checklist-photo-drafts-v1', ['photoDrafts'])
    ]);
    let draftCount = 0;
    let queueCount = 0;
    let photoCount = 0;
    const drafts = new Map();

    for(const raw of offline.checklistDrafts || []){
      if(String(raw?.userId || '') !== String(userId)) continue;
      const draft = normalizeDraft(raw);
      if(!draft) continue;
      drafts.set(draft.key, draft);
    }
    for(const row of photoDrafts.photoDrafts || []){
      if(String(row?.userId || '') !== String(userId)) continue;
      const checklistId = Core.text(row?.checklistId);
      const itemKey = Core.text(row?.itemKey);
      if(!checklistId || !itemKey) continue;
      const key = Core.draftKey(userId, checklistId);
      const draft = drafts.get(key) || normalizeDraft({ userId, checklistId, tasks:[], photos:[] });
      (row.files || []).forEach((file, index) => {
        const blob = file?.blob;
        if(!blob) return;
        draft.photos.push({
          id:Core.uuid(), itemKey, index:index + 1,
          name:Core.text(file?.name) || `legacy-${index + 1}.jpg`,
          type:Core.text(file?.type || blob.type) || 'image/jpeg',
          fullBlob:blob, thumbnailBlob:blob
        });
        photoCount += 1;
      });
      drafts.set(key, draft);
    }
    for(const draft of drafts.values()){
      if(!draft.employeeName && !draft.tasks.some(task => task.checkedByUser) && !draft.photos.length) continue;
      await saveDraft(draft);
      draftCount += 1;
    }
    for(const raw of offline.submissionQueue || []){
      if(String(raw?.userId || '') !== String(userId) || raw?.status === 'synced') continue;
      const row = normalizeQueue(raw);
      if(!row) continue;
      await saveQueue(row);
      await deleteDraft(userId, row.checklistId);
      queueCount += 1;
    }
    await setMeta(marker, { at:now(), draftCount, queueCount, photoCount });
    return { drafts:draftCount, queue:queueCount, photos:photoCount };
  }

  global.SovremennikControlV4Storage = Object.freeze({
    VERSION,
    DB_NAME,
    DRAFTS,
    QUEUE,
    open,
    getDraft,
    saveDraft,
    deleteDraft,
    draftsForUser,
    getQueue,
    saveQueue,
    deleteQueue,
    queueForUser,
    pendingForChecklist,
    migrateLegacy,
    getMeta,
    setMeta,
    normalizeDraft,
    normalizeQueue
  });
})(window);

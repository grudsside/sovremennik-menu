/* Современник offline reliability — drafts, pending queue and reconnect sync. */
(function(){
  'use strict';

  const core = window.SovremennikOfflineCore;
  if(!core || typeof document === 'undefined') return;

  const DB_NAME = 'sovremennik-offline-v1';
  const DB_VERSION = 1;
  const DRAFT_STORE = 'checklistDrafts';
  const QUEUE_STORE = 'submissionQueue';
  const PROFILE_KEY = 'sovremennikOfflineProfileV1';
  const INDICATOR_ID = 'offline-connection-indicator';
  const SAVE_DELAY = 450;
  const originalSubmitChecklist = typeof submitChecklist === 'function' ? submitChecklist : null;
  const originalRenderApp = typeof renderApp === 'function' ? renderApp : null;
  const originalShowLogin = typeof showLogin === 'function' ? showLogin : null;
  const saveTimers = new Map();
  let databasePromise = null;
  let syncing = false;
  let restoreScheduled = false;
  let mutationObserver = null;

  function currentUserSafe(){
    try { return typeof currentUser === 'function' ? currentUser() : null; }
    catch(error){ return null; }
  }
  function currentUserId(){ return String(currentUserSafe()?.id || readCachedProfile()?.id || ''); }
  function authenticated(){
    try { return typeof isAuthenticated === 'function' ? isAuthenticated() : Boolean(currentUserSafe()?.id); }
    catch(error){ return Boolean(currentUserSafe()?.id); }
  }
  function checklistDocs(){
    try { return Array.isArray(state?.menu?.checklists) ? state.menu.checklists : []; }
    catch(error){ return []; }
  }
  function checklistDoc(id){ return checklistDocs().find(doc => String(doc.id) === String(id)) || null; }
  function cardFor(id){ return document.querySelector(`.doc-card[data-checklist-id="${CSS.escape(String(id))}"]`); }
  function text(value){ return core.text(value); }
  function now(){ return new Date().toISOString(); }
  function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

  function readCachedProfile(){
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); }
    catch(error){ return null; }
  }
  function cacheCurrentProfile(){
    const user = currentUserSafe();
    if(!user?.id) return;
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify({
        id:user.id,
        name:user.name || '',
        role:user.role || '',
        login:user.login || '',
        cachedAt:now()
      }));
    } catch(error){ console.warn('Offline profile cache skipped', error); }
  }

  function openDatabase(){
    if(databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if(!db.objectStoreNames.contains(DRAFT_STORE)){
          const drafts = db.createObjectStore(DRAFT_STORE, { keyPath:'key' });
          drafts.createIndex('userId', 'userId', { unique:false });
          drafts.createIndex('updatedAt', 'updatedAt', { unique:false });
        }
        if(!db.objectStoreNames.contains(QUEUE_STORE)){
          const queue = db.createObjectStore(QUEUE_STORE, { keyPath:'key' });
          queue.createIndex('userId', 'userId', { unique:false });
          queue.createIndex('status', 'status', { unique:false });
          queue.createIndex('createdAt', 'createdAt', { unique:false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Не удалось открыть локальное хранилище.'));
    });
    return databasePromise;
  }
  async function storeRequest(storeName, mode, callback){
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let result;
      try { result = callback(store); }
      catch(error){ reject(error); return; }
      transaction.oncomplete = () => resolve(result?.result);
      transaction.onerror = () => reject(transaction.error || result?.error || new Error('Ошибка локального хранилища.'));
      transaction.onabort = () => reject(transaction.error || new Error('Операция локального хранилища отменена.'));
    });
  }
  async function getRecord(storeName, key){ return await storeRequest(storeName, 'readonly', store => store.get(key)); }
  async function putRecord(storeName, value){ await storeRequest(storeName, 'readwrite', store => store.put(value)); return value; }
  async function deleteRecord(storeName, key){ await storeRequest(storeName, 'readwrite', store => store.delete(key)); }
  async function allRecords(storeName){ return (await storeRequest(storeName, 'readonly', store => store.getAll())) || []; }
  async function userQueue(){
    const userId = currentUserId();
    if(!userId) return [];
    return (await allRecords(QUEUE_STORE))
      .filter(item => item.userId === userId && item.status !== 'synced')
      .sort((a,b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  async function blobFromImage(image){
    const source = image?.currentSrc || image?.src || '';
    if(!source) return null;
    try {
      const response = await fetch(source);
      if(!response.ok) return null;
      return await response.blob();
    } catch(error){ return null; }
  }
  async function collectPhotos(card){
    const photos = [];
    const fields = Array.from(card.querySelectorAll('[data-checklist-photo-field]'));
    for(const field of fields){
      const itemKey = field.dataset.itemKey || '';
      const images = Array.from(field.querySelectorAll('[data-photo-previews] img'));
      for(let index = 0; index < images.length; index += 1){
        const blob = await blobFromImage(images[index]);
        if(!blob) continue;
        photos.push({
          id:core.uuid(),
          itemKey,
          index:index + 1,
          name:`${itemKey || 'photo'}-${index + 1}.jpg`,
          type:blob.type || 'image/jpeg',
          blob
        });
      }
    }
    return photos;
  }
  function taskRows(card, doc, photos){
    const byItem = new Map();
    (photos || []).forEach(photo => byItem.set(photo.itemKey, (byItem.get(photo.itemKey) || 0) + 1));
    const inputs = Array.from(card.querySelectorAll('.task-checkbox'));
    return inputs.map((input, index) => {
      const field = input.dataset.photoItemKey
        ? card.querySelector(`[data-checklist-photo-field][data-item-key="${CSS.escape(input.dataset.photoItemKey)}"]`)
        : null;
      const itemKey = input.dataset.photoItemKey || `${doc.id}:${index}`;
      const required = Number(field?.dataset.requiredCount || 0);
      return core.normalizeTask({
        itemKey,
        text:input.dataset.task || input.closest('label')?.innerText || 'Пункт чек-листа',
        checkedByUser:Boolean(input.checked),
        requiredPhotoCount:required,
        photoCount:byItem.get(itemKey) || 0
      }, index);
    });
  }
  async function collectSnapshot(card, doc){
    const photos = await collectPhotos(card);
    const tasks = taskRows(card, doc, photos);
    const summary = core.summarize(tasks);
    return {
      key:core.draftKey(currentUserId(), doc.id),
      userId:currentUserId(),
      checklistId:String(doc.id || ''),
      checklistTitle:String(doc.title || ''),
      employeeName:text(card.querySelector('.employee-name')?.value),
      tasks:summary.items,
      photos,
      summary,
      updatedAt:now()
    };
  }
  function hasDraftContent(snapshot){
    return Boolean(snapshot.employeeName || snapshot.tasks.some(task => task.checkedByUser) || snapshot.photos.length);
  }
  async function saveCardDraft(card){
    if(!card || card.dataset.offlineSuppressDraft === '1') return;
    const doc = checklistDoc(card.dataset.checklistId);
    if(!doc || !currentUserId()) return;
    try {
      const snapshot = await collectSnapshot(card, doc);
      if(hasDraftContent(snapshot)) await putRecord(DRAFT_STORE, snapshot);
      else await deleteRecord(DRAFT_STORE, snapshot.key);
      updateCardDraftStatus(card, hasDraftContent(snapshot) ? 'Черновик сохранён на устройстве' : '');
    } catch(error){ console.warn('Checklist draft save failed', error); }
  }
  function scheduleDraftSave(card, delay = SAVE_DELAY){
    if(!card) return;
    const id = card.dataset.checklistId || '';
    clearTimeout(saveTimers.get(id));
    saveTimers.set(id, setTimeout(() => {
      saveTimers.delete(id);
      saveCardDraft(card);
    }, delay));
  }

  function updateCardDraftStatus(card, message){
    const submitPanel = card?.querySelector('.submit-panel');
    if(!submitPanel) return;
    let node = submitPanel.querySelector('[data-offline-draft-status]');
    if(!node){
      node = document.createElement('span');
      node.className = 'offline-draft-status';
      node.dataset.offlineDraftStatus = '1';
      submitPanel.appendChild(node);
    }
    node.textContent = message || '';
    node.hidden = !message;
  }
  function pendingBadge(card, count){
    const submitPanel = card?.querySelector('.submit-panel');
    if(!submitPanel) return;
    let node = submitPanel.querySelector('[data-offline-pending-status]');
    if(!node){
      node = document.createElement('span');
      node.className = 'offline-pending-status';
      node.dataset.offlinePendingStatus = '1';
      submitPanel.appendChild(node);
    }
    node.textContent = count ? (count === 1 ? 'Ожидает отправки' : `Ожидает отправки: ${count}`) : '';
    node.hidden = !count;
  }
  async function refreshCardBadges(){
    const queue = await userQueue().catch(() => []);
    const counts = new Map();
    queue.forEach(item => counts.set(item.checklistId, (counts.get(item.checklistId) || 0) + 1));
    document.querySelectorAll('.doc-card[data-checklist-id]').forEach(card => pendingBadge(card, counts.get(card.dataset.checklistId) || 0));
  }

  async function restorePhotos(card, snapshot){
    const groups = new Map();
    (snapshot.photos || []).forEach(photo => {
      if(!groups.has(photo.itemKey)) groups.set(photo.itemKey, []);
      groups.get(photo.itemKey).push(photo);
    });
    for(const [itemKey, photos] of groups){
      const field = card.querySelector(`[data-checklist-photo-field][data-item-key="${CSS.escape(itemKey)}"]`);
      if(!field || field.querySelector('[data-photo-previews] img') || field.dataset.offlineRestoring === '1') continue;
      const input = field.querySelector('[data-photo-input]');
      if(!input || typeof DataTransfer === 'undefined') continue;
      field.dataset.offlineRestoring = '1';
      try {
        const transfer = new DataTransfer();
        photos.forEach((photo, index) => {
          const blob = photo.blob;
          if(!blob) return;
          transfer.items.add(new File([blob], photo.name || `offline-photo-${index + 1}.jpg`, { type:photo.type || blob.type || 'image/jpeg' }));
        });
        if(transfer.files.length){
          input.files = transfer.files;
          input.dispatchEvent(new Event('change', { bubbles:true }));
          await sleep(900);
        }
      } catch(error){ console.warn('Offline photo restore skipped', error); }
      finally { field.dataset.offlineRestoring = '0'; }
    }
  }
  async function restoreCardDraft(card){
    if(!card || card.dataset.offlineRestored === '1' || !currentUserId()) return;
    const doc = checklistDoc(card.dataset.checklistId);
    if(!doc) return;
    const snapshot = await getRecord(DRAFT_STORE, core.draftKey(currentUserId(), doc.id)).catch(() => null);
    card.dataset.offlineRestored = '1';
    if(!snapshot || !hasDraftContent(snapshot)) return;
    const nameInput = card.querySelector('.employee-name');
    if(nameInput && !nameInput.value) nameInput.value = snapshot.employeeName || '';
    const byKey = new Map((snapshot.tasks || []).map(task => [String(task.itemKey), task]));
    Array.from(card.querySelectorAll('.task-checkbox')).forEach((input, index) => {
      const key = input.dataset.photoItemKey || `${doc.id}:${index}`;
      const task = byKey.get(key);
      if(task) input.checked = Boolean(task.checkedByUser);
    });
    await restorePhotos(card, snapshot);
    updateCardDraftStatus(card, 'Черновик восстановлен с устройства');
  }
  async function restoreAllDrafts(){
    if(!authenticated()) return;
    const cards = Array.from(document.querySelectorAll('.doc-card[data-checklist-id]'));
    for(const card of cards) await restoreCardDraft(card);
    await refreshCardBadges();
  }
  function scheduleRestore(){
    if(restoreScheduled) return;
    restoreScheduled = true;
    setTimeout(async () => {
      restoreScheduled = false;
      cacheCurrentProfile();
      await restoreAllDrafts();
      await updateIndicator();
    }, 250);
  }

  function incompleteMessage(summary){
    const lines = [`Чек-лист заполнен на ${summary.percent}% (${summary.done}/${summary.total}).`];
    if(summary.total - summary.done > 0) lines.push(`Не выполнено пунктов: ${summary.total - summary.done}.`);
    if(summary.missingPhotos > 0) lines.push(`Не хватает обязательных фотографий: ${summary.missingPhotos}.`);
    lines.push('', 'Сохранить и отправить неполный чек-лист?');
    return lines.join('\n');
  }
  function queueFromSnapshot(snapshot){
    const id = core.uuid();
    return {
      key:core.queueKey(snapshot.userId, id),
      id,
      userId:snapshot.userId,
      checklistId:snapshot.checklistId,
      checklistTitle:snapshot.checklistTitle,
      employeeName:snapshot.employeeName,
      tasks:snapshot.summary.items,
      photos:snapshot.photos,
      summary:snapshot.summary,
      hasPhotos:snapshot.photos.length > 0 || snapshot.summary.requiredPhotos > 0,
      status:'pending',
      attemptCount:0,
      lastError:'',
      createdAt:now(),
      updatedAt:now()
    };
  }
  async function ensureSubmissionRow(item){
    const row = {
      id:item.id,
      checklist_id:item.checklistId,
      checklist_title:item.checklistTitle,
      employee_id:item.userId,
      employee_name:item.employeeName,
      items:item.tasks,
      completed_count:item.summary.done,
      total_count:item.summary.total,
      percent:item.summary.percent
    };
    if(item.hasPhotos){
      Object.assign(row, {
        photo_required_count:item.summary.requiredPhotos,
        photo_count:0,
        photo_upload_status:item.summary.requiredPhotos ? 'pending' : 'not_required',
        submitted_incomplete:item.summary.incomplete,
        version:2
      });
    }
    const result = await supa.from('checklist_submissions').insert(row);
    if(result.error && !core.isDuplicateError(result.error)) throw result.error;
    return row;
  }
  async function existingPhoto(item, photo){
    const result = await supa.from('checklist_submission_photos')
      .select('id,storage_path,thumbnail_path')
      .eq('submission_id', item.id)
      .eq('item_key', photo.itemKey)
      .eq('photo_index', photo.index)
      .maybeSingle();
    if(result.error) throw result.error;
    return result.data || null;
  }
  function offlinePhotoPaths(item, photo){
    const photoCore = window.SovremennikChecklistPhotoCore;
    if(photoCore?.buildStoragePaths){
      return photoCore.buildStoragePaths({
        userId:item.userId,
        submissionId:item.id,
        itemKey:photo.itemKey,
        index:photo.index,
        nonce:`offline-${photo.index}`
      });
    }
    const clean = value => String(value || 'item').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80) || 'item';
    const base = `${clean(item.userId)}/${clean(item.id)}/${clean(photo.itemKey)}`;
    return { fullPath:`${base}/full-offline-${photo.index}.jpg`, thumbnailPath:`${base}/thumb-offline-${photo.index}.jpg` };
  }
  async function syncPhoto(item, photo){
    if(await existingPhoto(item, photo)) return;
    const paths = offlinePhotoPaths(item, photo);
    const blob = photo.blob;
    if(!blob) throw new Error('Локальная фотография недоступна.');
    const full = await supa.storage.from('checklist-photo-reports').upload(paths.fullPath, blob, { contentType:photo.type || blob.type || 'image/jpeg', cacheControl:'3600', upsert:true });
    if(full.error) throw full.error;
    const thumb = await supa.storage.from('checklist-photo-reports').upload(paths.thumbnailPath, blob, { contentType:photo.type || blob.type || 'image/jpeg', cacheControl:'3600', upsert:true });
    if(thumb.error) throw thumb.error;
    const metadata = {
      submission_id:item.id,
      checklist_id:item.checklistId,
      item_key:photo.itemKey,
      item_text:item.tasks.find(task => task.itemKey === photo.itemKey)?.text || '',
      photo_index:photo.index,
      storage_path:full.data.path,
      thumbnail_path:thumb.data.path,
      mime_type:photo.type || blob.type || 'image/jpeg',
      file_size:blob.size,
      thumbnail_size:blob.size,
      created_by:item.userId
    };
    const inserted = await supa.from('checklist_submission_photos').insert(metadata);
    if(inserted.error && !core.isDuplicateError(inserted.error)) throw inserted.error;
  }
  async function finalizePhotoItem(item){
    const result = await supa.rpc('finalize_checklist_photo_submission', { p_submission_id:item.id, p_items:item.tasks });
    if(result.error) throw result.error;
    return Array.isArray(result.data) ? result.data[0] : result.data;
  }
  function saveLocalSyncedRecord(item, finalized){
    try {
      if(typeof getLocalControlRecords === 'function' && typeof saveLocalControlRecord === 'function'){
        if(getLocalControlRecords().some(record => String(record.id) === String(item.id))) return;
        saveLocalControlRecord({
          id:item.id,
          checklistId:item.checklistId,
          checklistTitle:item.checklistTitle,
          employeeName:item.employeeName,
          createdAt:item.createdAt,
          tasks:finalized?.items || item.tasks,
          completed:Number(finalized?.completed_count ?? item.summary.done),
          total:Number(finalized?.total_count ?? item.summary.total),
          percent:Number(finalized?.percent ?? item.summary.percent),
          photoCount:Number(finalized?.photo_count ?? item.photos.length)
        });
      }
    } catch(error){ console.warn('Local synced record skipped', error); }
  }
  async function syncQueueItem(item){
    if(!navigator.onLine) throw new Error('Нет соединения с интернетом.');
    if(!authenticated() || currentUserId() !== item.userId) throw new Error('Нужно войти под сотрудником, который заполнил чек-лист.');
    item.status = 'syncing';
    item.updatedAt = now();
    await putRecord(QUEUE_STORE, item);
    await ensureSubmissionRow(item);
    let finalized = null;
    if(item.hasPhotos){
      for(const photo of item.photos || []) await syncPhoto(item, photo);
      finalized = await finalizePhotoItem(item);
    }
    if(typeof safeNotifyEvent === 'function') safeNotifyEvent('checklist_submitted', {
      submission_id:item.id,
      checklist_title:item.checklistTitle,
      employee_name:item.employeeName,
      photo_count:Number(finalized?.photo_count ?? item.photos.length)
    });
    saveLocalSyncedRecord(item, finalized);
    await deleteRecord(QUEUE_STORE, item.key);
  }
  async function syncPending(){
    if(syncing || !navigator.onLine || !authenticated()) return;
    syncing = true;
    await updateIndicator();
    try {
      const queue = await userQueue();
      for(const item of queue){
        try { await syncQueueItem(item); }
        catch(error){
          console.warn('Pending checklist sync failed', error);
          item.status = 'pending';
          item.attemptCount = Number(item.attemptCount || 0) + 1;
          item.lastError = error.message || 'Не удалось отправить.';
          item.updatedAt = now();
          await putRecord(QUEUE_STORE, item);
          if(!navigator.onLine) break;
        }
      }
    } finally {
      syncing = false;
      await refreshCardBadges();
      await updateIndicator();
      try {
        if(typeof loadControlRecords === 'function' && state?.activeTop === 'control') loadControlRecords();
      } catch(error){}
    }
  }

  function clearCardAfterQueued(card){
    card.dataset.offlineSuppressDraft = '1';
    card.querySelectorAll('[data-photo-remove]').forEach(button => button.click());
    card.querySelectorAll('.task-checkbox').forEach(input => { input.checked = false; });
    const nameInput = card.querySelector('.employee-name');
    if(nameInput) nameInput.value = '';
    delete card.dataset.photoSubmissionId;
    setTimeout(() => { card.dataset.offlineSuppressDraft = '0'; }, 800);
  }
  function cardWasCleared(card){
    const noName = !text(card.querySelector('.employee-name')?.value);
    const noChecks = !Array.from(card.querySelectorAll('.task-checkbox')).some(input => input.checked);
    const noPhotos = !card.querySelector('[data-photo-previews] img');
    return noName && noChecks && noPhotos;
  }
  function setSubmitStatus(card, message, kind = ''){
    const status = card?.querySelector('.submit-status');
    if(!status) return;
    status.textContent = message || '';
    status.className = `submit-status${kind ? ` ${kind}` : ''}`;
  }
  async function submitOfflineAware(docId){
    const doc = checklistDoc(docId);
    const card = cardFor(docId);
    if(!doc || !card || card.dataset.offlineSubmitting === '1') return;
    const nameInput = card.querySelector('.employee-name');
    const employeeName = text(nameInput?.value);
    if(!employeeName){
      setSubmitStatus(card, 'Введите имя сотрудника перед отправкой.', 'error');
      nameInput?.focus();
      return;
    }
    card.dataset.offlineSubmitting = '1';
    const button = card.querySelector('.submit-checklist');
    if(button) button.disabled = true;
    try {
      const snapshot = await collectSnapshot(card, doc);
      if(snapshot.summary.incomplete && !window.confirm(incompleteMessage(snapshot.summary))) return;
      const item = queueFromSnapshot(snapshot);
      await putRecord(QUEUE_STORE, item);
      await putRecord(DRAFT_STORE, snapshot);
      await refreshCardBadges();
      await updateIndicator();

      const hasPhotoFields = Boolean(card.querySelector('[data-checklist-photo-field]'));
      if(navigator.onLine && hasPhotoFields && originalSubmitChecklist){
        try {
          await ensureSubmissionRow(item);
          card.dataset.photoSubmissionId = item.id;
          const nativeConfirm = window.confirm;
          window.confirm = () => true;
          try { await originalSubmitChecklist(docId); }
          finally { window.confirm = nativeConfirm; }
          await sleep(100);
          if(cardWasCleared(card)){
            await deleteRecord(QUEUE_STORE, item.key);
            await deleteRecord(DRAFT_STORE, snapshot.key);
            setSubmitStatus(card, '');
          } else {
            setSubmitStatus(card, 'Сохранено на устройстве · ожидает отправки.', 'error');
          }
        } catch(error){
          console.warn('Online photo submission retained in queue', error);
          setSubmitStatus(card, 'Сохранено на устройстве · ожидает отправки.', 'error');
        }
      } else if(navigator.onLine && !hasPhotoFields){
        try {
          await syncQueueItem(item);
          await deleteRecord(DRAFT_STORE, snapshot.key);
          clearCardAfterQueued(card);
          setSubmitStatus(card, 'Чек-лист отправлен.');
          setTimeout(() => setSubmitStatus(card, ''), 2500);
        } catch(error){
          console.warn('Checklist retained in queue', error);
          clearCardAfterQueued(card);
          await deleteRecord(DRAFT_STORE, snapshot.key);
          setSubmitStatus(card, 'Сохранено на устройстве · ожидает отправки.', 'error');
        }
      } else {
        clearCardAfterQueued(card);
        await deleteRecord(DRAFT_STORE, snapshot.key);
        setSubmitStatus(card, 'Нет соединения. Чек-лист сохранён · ожидает отправки.', 'error');
        registerBackgroundSync();
      }
    } catch(error){
      console.error('Offline checklist submit failed', error);
      setSubmitStatus(card, 'Не удалось сохранить на устройстве: ' + (error.message || 'освободите место и повторите.'), 'error');
    } finally {
      card.dataset.offlineSubmitting = '0';
      if(button) button.disabled = false;
      await refreshCardBadges();
      await updateIndicator();
    }
  }

  async function pendingCount(){ return (await userQueue().catch(() => [])).length; }
  function ensureIndicator(){
    let node = document.getElementById(INDICATOR_ID);
    if(node) return node;
    node = document.createElement('button');
    node.id = INDICATOR_ID;
    node.type = 'button';
    node.className = 'connection-indicator';
    node.setAttribute('aria-live', 'polite');
    node.title = 'Нажмите, чтобы повторить отправку сохранённых чек-листов';
    node.addEventListener('click', () => syncPending());
    document.body.appendChild(node);
    return node;
  }
  async function updateIndicator(){
    const node = ensureIndicator();
    const count = await pendingCount();
    const online = navigator.onLine;
    node.textContent = core.connectionLabel({ online, pending:count, syncing });
    node.classList.toggle('is-online', online && !syncing && count === 0);
    node.classList.toggle('is-offline', !online);
    node.classList.toggle('is-pending', Boolean(count) || syncing);
  }
  async function registerBackgroundSync(){
    try {
      const registration = await navigator.serviceWorker?.ready;
      if(registration?.sync) await registration.sync.register('sovremennik-checklist-sync');
    } catch(error){}
  }

  async function restoreOfflineAccess(){
    if(navigator.onLine || authenticated() || typeof supa === 'undefined') return false;
    const profile = readCachedProfile();
    if(!profile?.id) return false;
    try {
      const result = await supa.auth.getSession();
      const session = result?.data?.session;
      if(!session?.user?.id || session.user.id !== profile.id) return false;
      if(typeof state !== 'undefined') state.auth = { session, user:profile };
      if(!state.menu && typeof readEmbeddedMenu === 'function') state.menu = readEmbeddedMenu();
      document.body.classList.remove('login-mode');
      if(typeof renderApp === 'function') renderApp();
      scheduleRestore();
      return true;
    } catch(error){
      console.warn('Offline access restore failed', error);
      return false;
    }
  }

  function installEventHandlers(){
    document.addEventListener('input', event => {
      const card = event.target.closest?.('.doc-card[data-checklist-id]');
      if(card) scheduleDraftSave(card);
    }, true);
    document.addEventListener('change', event => {
      const card = event.target.closest?.('.doc-card[data-checklist-id]');
      if(card) scheduleDraftSave(card, event.target.matches('[data-photo-input]') ? 1400 : SAVE_DELAY);
    }, true);
    window.addEventListener('online', async () => {
      await updateIndicator();
      await syncPending();
    });
    window.addEventListener('offline', updateIndicator);
    document.addEventListener('visibilitychange', () => {
      if(document.visibilityState === 'hidden') document.querySelectorAll('.doc-card[data-checklist-id]').forEach(card => saveCardDraft(card));
    });
    window.addEventListener('pagehide', () => document.querySelectorAll('.doc-card[data-checklist-id]').forEach(card => saveCardDraft(card)));
    navigator.serviceWorker?.addEventListener('message', event => {
      if(event.data?.type === 'SOVREMENNIK_SYNC_PENDING') syncPending();
    });
    mutationObserver = new MutationObserver(mutations => {
      let shouldRestore = false;
      mutations.forEach(mutation => {
        if(Array.from(mutation.addedNodes || []).some(node => node.nodeType === 1 && (node.matches?.('.doc-card,[data-checklist-photo-field]') || node.querySelector?.('.doc-card,[data-checklist-photo-field]')))) shouldRestore = true;
        const card = mutation.target?.closest?.('.doc-card[data-checklist-id]');
        if(card && Array.from(mutation.addedNodes || []).some(node => node.nodeType === 1 && (node.matches?.('[data-photo-previews] img') || node.querySelector?.('[data-photo-previews] img')))) scheduleDraftSave(card, 700);
      });
      if(shouldRestore) scheduleRestore();
    });
    mutationObserver.observe(document.body, { childList:true, subtree:true });
  }

  if(originalShowLogin){
    showLogin = function(){
      const result = originalShowLogin.apply(this, arguments);
      if(!navigator.onLine) setTimeout(restoreOfflineAccess, 0);
      return result;
    };
  }
  if(originalRenderApp){
    renderApp = function(){
      const result = originalRenderApp.apply(this, arguments);
      scheduleRestore();
      return result;
    };
  }
  if(originalSubmitChecklist) submitChecklist = submitOfflineAware;

  window.SovremennikOffline = Object.freeze({
    version:core.VERSION,
    saveDrafts:restoreAllDrafts,
    syncPending,
    pendingCount,
    restoreOfflineAccess
  });

  async function start(){
    ensureIndicator();
    installEventHandlers();
    await openDatabase().catch(error => console.error('Offline storage unavailable', error));
    cacheCurrentProfile();
    await restoreOfflineAccess();
    setTimeout(restoreOfflineAccess, 1200);
    setTimeout(restoreOfflineAccess, 3500);
    scheduleRestore();
    await updateIndicator();
    if(navigator.onLine) syncPending();
    setInterval(() => {
      cacheCurrentProfile();
      updateIndicator();
      if(navigator.onLine) syncPending();
    }, 30000);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();

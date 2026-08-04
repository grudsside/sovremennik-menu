/* Современник — Control v4 shared checklist drafts across devices. */
(function(global){
  'use strict';

  if(global.SovremennikControlV4SharedDrafts) return;

  const Core = global.SovremennikControlV4Core;
  const Storage = global.SovremennikControlV4Storage;
  const Service = global.SovremennikControlV4Service;
  if(!Core || !Storage || !Service){
    console.error('Control v4 shared drafts cannot start: core or service is unavailable.');
    return;
  }

  const VERSION = '2026-08-04-control-v4-shared-drafts-1';
  const DEVICE_KEY = 'sovremennikControlV4DeviceId';
  const sessions = new Map();
  const signedUrls = new Map();
  const presenceByChecklist = new Map();
  let pendingSyncPromise = null;

  function db(){ return Service.client(); }
  function currentUser(){ return Service.user(); }
  function available(){ return Boolean(navigator.onLine && Service.authenticated() && db()); }
  function localDateKey(date = new Date()){
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  function deviceId(){
    try{
      let value = global.localStorage?.getItem(DEVICE_KEY) || '';
      if(!value){ value = Core.uuid(); global.localStorage?.setItem(DEVICE_KEY, value); }
      return value;
    }catch(error){ return Core.uuid(); }
  }
  function safePart(value){
    return String(value || 'item').trim().toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
  }
  function bool(value){ return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true'; }
  function array(value){ return Array.isArray(value) ? value : []; }
  function unique(values){ return Array.from(new Set(array(values).map(String).filter(Boolean))); }
  function hasLocalContent(draft){
    return Boolean(Core.text(draft?.employeeName) || array(draft?.tasks).some(row => row.checkedByUser) || array(draft?.photos).length);
  }

  function normalizeRemotePhoto(photo){
    return {
      id:Core.text(photo?.id) || Core.uuid(),
      itemKey:Core.text(photo?.itemKey || photo?.item_key),
      index:Number(photo?.index || photo?.photoIndex || photo?.photo_index || 1),
      storagePath:Core.text(photo?.storagePath || photo?.storage_path),
      thumbnailPath:Core.text(photo?.thumbnailPath || photo?.thumbnail_path),
      type:Core.text(photo?.mimeType || photo?.mime_type) || 'image/jpeg',
      fileSize:Number(photo?.fileSize || photo?.file_size || 0),
      thumbnailSize:Number(photo?.thumbnailSize || photo?.thumbnail_size || 0),
      createdBy:Core.text(photo?.createdBy || photo?.created_by),
      createdByName:Core.text(photo?.createdByName || photo?.created_by_name),
      createdAt:photo?.createdAt || photo?.created_at || new Date().toISOString(),
      remote:true,
      syncStatus:'synced',
      thumbnailUrl:Core.text(photo?.thumbnailUrl),
      fullUrl:Core.text(photo?.fullUrl)
    };
  }

  function normalizePayload(raw){
    if(!raw) return null;
    const id = Core.text(raw.id);
    const checklistId = Core.text(raw.checklistId || raw.checklist_id);
    if(!id || !checklistId) return null;
    const tasks = array(raw.items || raw.tasks).map(row => Core.normalizeTask({
      ...row,
      itemKey:row?.itemKey || row?.item_key,
      text:row?.text || row?.itemText || row?.item_text,
      sectionTitle:row?.sectionTitle || row?.section_title,
      checkedByUser:bool(row?.checkedByUser ?? row?.checked_by_user),
      checked:bool(row?.checkedByUser ?? row?.checked_by_user),
      photoRequired:bool(row?.photoRequired ?? row?.photo_required),
      requiredPhotoCount:Number(row?.requiredPhotoCount ?? row?.required_photo_count ?? 0),
      photoCount:Number(row?.photoCount ?? row?.photo_count ?? 0)
    }));
    return {
      sharedDraftId:id,
      submissionId:Core.text(raw.submissionId || raw.submission_id) || Core.uuid(),
      checklistId,
      checklistTitle:Core.text(raw.checklistTitle || raw.checklist_title),
      department:Core.text(raw.department),
      workDate:Core.text(raw.workDate || raw.work_date) || localDateKey(),
      employeeName:Core.text(raw.employeeName || raw.employee_name),
      tasks,
      photos:array(raw.photos).map(normalizeRemotePhoto).filter(photo => photo.itemKey && photo.storagePath),
      sharedStatus:Core.text(raw.status) || 'draft',
      serverVersion:Number(raw.version || 1),
      serverUpdatedAt:raw.updatedAt || raw.updated_at || new Date().toISOString(),
      createdAt:raw.createdAt || raw.created_at || new Date().toISOString(),
      submittedAt:raw.submittedAt || raw.submitted_at || null,
      dirtyItemKeys:[],
      dirtyEmployeeName:false,
      status:'draft'
    };
  }

  async function signed(path){
    const clean = Core.text(path);
    if(!clean) return '';
    const cached = signedUrls.get(clean);
    if(cached?.promise) return cached.promise;
    if(cached?.url && cached.expiresAt > Date.now()) return cached.url;
    const promise = Service.signedUrl(clean, 900).catch(() => '');
    signedUrls.set(clean, { promise });
    const value = await promise;
    signedUrls.set(clean, { url:value, expiresAt:Date.now() + 12 * 60 * 1000 });
    return value;
  }

  async function hydratePhotos(draft){
    if(!draft) return draft;
    const photos = await Promise.all(array(draft.photos).map(async photo => {
      if(!photo.remote) return photo;
      return {
        ...photo,
        thumbnailUrl:photo.thumbnailUrl || await signed(photo.thumbnailPath),
        fullUrl:photo.fullUrl || await signed(photo.storagePath)
      };
    }));
    return { ...draft, photos };
  }

  function normalizePendingPhoto(photo){
    if(!photo?.itemKey) return null;
    if(photo.remote || photo.storagePath) return normalizeRemotePhoto(photo);
    if(!photo.fullBlob) return null;
    return {
      id:Core.text(photo.id) || Core.uuid(),
      itemKey:Core.text(photo.itemKey),
      index:Number(photo.index || 1),
      name:Core.text(photo.name) || 'photo.jpg',
      type:Core.text(photo.type || photo.fullBlob?.type) || 'image/jpeg',
      fullBlob:photo.fullBlob,
      thumbnailBlob:photo.thumbnailBlob || photo.fullBlob,
      remote:false,
      syncStatus:'pending'
    };
  }

  function mergeLocal(remoteRaw, localRaw){
    const remote = normalizePayload(remoteRaw) || remoteRaw;
    if(!remote) return localRaw || null;
    const local = localRaw || {};
    const legacy = !Core.text(local.sharedDraftId) && hasLocalContent(local);
    const dirtyKeys = unique(legacy
      ? array(local.tasks).filter(row => row.checkedByUser).map(row => row.itemKey)
      : local.dirtyItemKeys);
    const dirtyName = legacy ? Boolean(Core.text(local.employeeName)) : Boolean(local.dirtyEmployeeName);
    const localTasks = new Map(array(local.tasks).map(row => [Core.text(row.itemKey), Core.normalizeTask(row)]));
    const tasks = array(remote.tasks).map(row => dirtyKeys.includes(row.itemKey) && localTasks.has(row.itemKey)
      ? Core.normalizeTask({ ...row, checkedByUser:localTasks.get(row.itemKey).checkedByUser })
      : Core.normalizeTask(row));
    const remotePhotoIds = new Set(array(remote.photos).map(row => String(row.id)));
    const pending = array(local.photos).map(normalizePendingPhoto)
      .filter(Boolean)
      .filter(photo => !photo.remote && !remotePhotoIds.has(String(photo.id)));
    const photos = [...array(remote.photos), ...pending];
    return {
      ...remote,
      key:Core.draftKey(Core.text(local.userId || currentUser()?.id), remote.checklistId),
      userId:Core.text(local.userId || currentUser()?.id),
      employeeName:dirtyName ? Core.text(local.employeeName) : remote.employeeName,
      tasks,
      photos,
      dirtyItemKeys:remote.sharedStatus === 'draft' ? dirtyKeys : [],
      dirtyEmployeeName:remote.sharedStatus === 'draft' ? dirtyName : false,
      pendingFinalize:remote.sharedStatus === 'draft' ? Boolean(local.pendingFinalize) : false,
      finalizeEmployeeName:remote.sharedStatus === 'draft' ? Core.text(local.finalizeEmployeeName) : '',
      lastError:Core.text(local.lastError),
      status:local.status || 'draft'
    };
  }

  async function rpc(name, parameters){
    const client = db();
    if(!client) throw new Error('Supabase недоступен.');
    const result = await client.rpc(name, parameters);
    if(result.error) throw result.error;
    return result.data;
  }

  async function fetchPayload(sharedDraftId){
    const data = await rpc('checklist_shared_draft_payload', { p_draft_id:String(sharedDraftId) });
    return await hydratePhotos(normalizePayload(data));
  }

  function dispatchRemote(checklistId, draft){
    global.dispatchEvent(new CustomEvent('sov:control-v4-shared-remote', {
      detail:{ checklistId:String(checklistId), draft }
    }));
  }

  async function refreshSession(sharedDraftId){
    const session = sessions.get(String(sharedDraftId));
    if(!session || !available()) return;
    try{
      const draft = await fetchPayload(sharedDraftId);
      if(draft) dispatchRemote(session.checklistId, draft);
    }catch(error){
      console.warn('Shared checklist Realtime refresh failed.', error);
    }
  }

  function scheduleRefresh(sharedDraftId){
    const key = String(sharedDraftId);
    const session = sessions.get(key);
    if(!session) return;
    clearTimeout(session.timer);
    session.timer = setTimeout(() => void refreshSession(key), 120);
  }

  function publishPresence(checklistId, channel){
    const rows = [];
    const state = channel?.presenceState?.() || {};
    Object.values(state).forEach(group => array(group).forEach(row => rows.push({
      userId:Core.text(row.userId),
      name:Core.text(row.name),
      deviceId:Core.text(row.deviceId),
      onlineAt:row.onlineAt || null
    })));
    const uniqueDevices = Array.from(new Map(rows.map(row => [row.deviceId || `${row.userId}:${row.name}`, row])).values());
    presenceByChecklist.set(String(checklistId), uniqueDevices);
    global.dispatchEvent(new CustomEvent('sov:control-v4-shared-presence', {
      detail:{ checklistId:String(checklistId), people:uniqueDevices }
    }));
  }

  function watch(draft){
    if(!draft?.sharedDraftId || !db()?.channel) return;
    const key = String(draft.sharedDraftId);
    if(sessions.has(key)) return;
    const channel = db().channel(`control-v4-shared-${key}`, {
      config:{ presence:{ key:deviceId() } }
    });
    const session = { checklistId:String(draft.checklistId), channel, timer:null };
    sessions.set(key, session);
    const refresh = () => scheduleRefresh(key);
    channel
      .on('postgres_changes', { event:'*', schema:'public', table:'checklist_shared_drafts', filter:`id=eq.${key}` }, refresh)
      .on('postgres_changes', { event:'*', schema:'public', table:'checklist_shared_draft_items', filter:`draft_id=eq.${key}` }, refresh)
      .on('postgres_changes', { event:'*', schema:'public', table:'checklist_shared_draft_photos', filter:`draft_id=eq.${key}` }, refresh)
      .on('presence', { event:'sync' }, () => publishPresence(draft.checklistId, channel))
      .subscribe(status => {
        if(status !== 'SUBSCRIBED') return;
        const row = currentUser() || {};
        void channel.track({
          userId:Core.text(row.id),
          name:Core.text(row.name || row.login),
          deviceId:deviceId(),
          onlineAt:new Date().toISOString()
        });
      });
  }

  async function unwatch(sharedDraftId){
    const key = String(sharedDraftId || '');
    const session = sessions.get(key);
    if(!session) return;
    clearTimeout(session.timer);
    sessions.delete(key);
    try{ await db()?.removeChannel?.(session.channel); }catch(error){}
  }

  function dirtyChanges(draft){
    const byKey = new Map(array(draft.tasks).map(row => [String(row.itemKey), row]));
    return unique(draft.dirtyItemKeys).map(key => byKey.get(key)).filter(Boolean).map(row => ({
      itemKey:row.itemKey,
      checkedByUser:Boolean(row.checkedByUser)
    }));
  }

  async function uploadPendingPhoto(draft, photo){
    const client = db();
    const actor = currentUser();
    if(!client || !actor?.id) throw new Error('Нужно войти в аккаунт.');
    const base = `${safePart(actor.id)}/shared/${safePart(draft.sharedDraftId)}/${safePart(photo.itemKey)}/${safePart(photo.id)}`;
    const storagePath = `${base}/full.jpg`;
    const thumbnailPath = `${base}/thumb.jpg`;
    const full = await client.storage.from(Service.PHOTO_BUCKET).upload(storagePath, photo.fullBlob, {
      contentType:photo.type || 'image/jpeg', cacheControl:'3600', upsert:true
    });
    if(full.error) throw full.error;
    const thumbBlob = photo.thumbnailBlob || photo.fullBlob;
    const thumb = await client.storage.from(Service.PHOTO_BUCKET).upload(thumbnailPath, thumbBlob, {
      contentType:'image/jpeg', cacheControl:'3600', upsert:true
    });
    if(thumb.error) throw thumb.error;
    const data = await rpc('attach_checklist_shared_draft_photo', {
      p_draft_id:String(draft.sharedDraftId),
      p_photo_id:String(photo.id),
      p_item_key:String(photo.itemKey),
      p_storage_path:full.data.path,
      p_thumbnail_path:thumb.data.path,
      p_mime_type:photo.type || 'image/jpeg',
      p_file_size:Number(photo.fullBlob?.size || 0),
      p_thumbnail_size:Number(thumbBlob?.size || 0)
    });
    return await hydratePhotos(normalizePayload(data));
  }

  async function sync(rawDraft){
    if(!rawDraft?.sharedDraftId || !available()) return rawDraft;
    let draft = rawDraft;
    const keys = unique(draft.dirtyItemKeys);
    const nameDirty = Boolean(draft.dirtyEmployeeName);
    const changes = dirtyChanges(draft);
    if(nameDirty || changes.length){
      const data = await rpc('patch_checklist_shared_draft', {
        p_draft_id:String(draft.sharedDraftId),
        p_employee_name:nameDirty ? Core.text(draft.employeeName) : null,
        p_changes:changes
      });
      const cleanLocal = {
        ...draft,
        dirtyItemKeys:unique(draft.dirtyItemKeys).filter(key => !keys.includes(key)),
        dirtyEmployeeName:false
      };
      draft = mergeLocal(await hydratePhotos(normalizePayload(data)), cleanLocal);
    }

    const pending = array(draft.photos).filter(photo => !photo.remote && photo.fullBlob);
    for(const photo of pending){
      const withoutCurrent = { ...draft, photos:array(draft.photos).filter(row => String(row.id) !== String(photo.id)) };
      const remote = await uploadPendingPhoto(draft, photo);
      draft = mergeLocal(remote, withoutCurrent);
    }
    watch(draft);
    return draft;
  }

  async function open(options){
    const localDraft = options?.localDraft || null;
    if(!available()) return localDraft;
    const data = await rpc('open_checklist_shared_draft', {
      p_checklist_id:String(options.checklistId),
      p_checklist_title:String(options.checklistTitle || 'Чек-лист'),
      p_department:String(options.department),
      p_work_date:String(options.workDate || localDateKey()),
      p_items:array(options.items).map(row => ({
        itemKey:row.itemKey,
        text:row.text,
        sectionTitle:row.sectionTitle || '',
        requiredPhotoCount:Number(row.requiredPhotoCount || 0)
      }))
    });
    let draft = mergeLocal(await hydratePhotos(normalizePayload(data)), localDraft);
    watch(draft);
    if(draft?.sharedStatus === 'draft' && (
      draft.dirtyEmployeeName || array(draft.dirtyItemKeys).length ||
      array(draft.photos).some(photo => !photo.remote && photo.fullBlob)
    )) draft = await sync(draft);
    return draft;
  }

  async function removePhoto(draft, photo){
    if(!photo?.remote){
      return { ...draft, photos:array(draft.photos).filter(row => String(row.id) !== String(photo?.id)) };
    }
    if(!available()) throw new Error('Для удаления синхронизированного фото нужен интернет.');
    const data = await rpc('remove_checklist_shared_draft_photo', {
      p_draft_id:String(draft.sharedDraftId),
      p_photo_id:String(photo.id)
    });
    const remote = await hydratePhotos(normalizePayload(data));
    return mergeLocal(remote, { ...draft, photos:array(draft.photos).filter(row => String(row.id) !== String(photo.id)) });
  }

  async function finalize(draft, employeeName){
    if(!available()) throw new Error('Нет соединения с интернетом.');
    const synced = await sync({ ...draft, employeeName:Core.text(employeeName) });
    const result = await rpc('finalize_checklist_shared_draft', {
      p_draft_id:String(synced.sharedDraftId),
      p_employee_name:Core.text(employeeName)
    });
    notifySubmitted(synced, result);
    await unwatch(synced.sharedDraftId);
    return result;
  }

  function notifySubmitted(draft, finalized){
    try{
      if(typeof global.safeNotifyEvent === 'function') global.safeNotifyEvent('checklist_submitted', {
        submission_id:draft.submissionId,
        checklist_title:draft.checklistTitle,
        employee_name:draft.employeeName,
        photo_count:Number(finalized?.photo_count ?? draft.photos?.length ?? 0)
      });
    }catch(error){ console.warn('Shared checklist notification skipped.', error); }
  }

  async function syncPendingFinalizations(){
    if(pendingSyncPromise) return pendingSyncPromise;
    if(!available()) return [];
    pendingSyncPromise = (async () => {
      const actor = currentUser();
      const rows = await Storage.draftsForUser(actor?.id || '');
      const results = [];
      for(const row of rows.filter(draft => draft?.pendingFinalize)){
        try{
          let draft = row;
          if(!draft.sharedDraftId){
            draft = await open({
              checklistId:draft.checklistId,
              checklistTitle:draft.checklistTitle,
              department:draft.department,
              workDate:draft.workDate || localDateKey(),
              items:array(draft.tasks),
              localDraft:draft
            });
            draft.pendingFinalize = true;
            draft.finalizeEmployeeName = row.finalizeEmployeeName || row.employeeName;
            await Storage.saveDraft(draft);
          }
          draft = await sync(draft);
          const finalized = await finalize(draft, draft.finalizeEmployeeName || draft.employeeName);
          await Storage.deleteDraft(draft.userId, draft.checklistId);
          global.dispatchEvent(new CustomEvent('sov:control-v4-shared-submitted', {
            detail:{ checklistId:draft.checklistId, draft, finalized }
          }));
          results.push({ checklistId:draft.checklistId, ok:true, finalized });
        }catch(error){
          row.lastError = error?.message || 'Не удалось отправить общий чек-лист.';
          row.status = 'failed';
          await Storage.saveDraft(row);
          results.push({ checklistId:row.checklistId, ok:false, error:row.lastError });
          if(!navigator.onLine) break;
        }
      }
      return results;
    })().finally(() => { pendingSyncPromise = null; });
    return pendingSyncPromise;
  }

  function people(checklistId){ return presenceByChecklist.get(String(checklistId)) || []; }
  function isSyncingPending(){ return Boolean(pendingSyncPromise); }

  global.addEventListener('online', () => { void syncPendingFinalizations(); });
  global.addEventListener('offline', () => {
    for(const session of sessions.values()) clearTimeout(session.timer);
  });

  global.SovremennikControlV4SharedDrafts = Object.freeze({
    VERSION,
    available,
    localDateKey,
    normalizePayload,
    mergeLocal,
    open,
    sync,
    removePhoto,
    finalize,
    syncPendingFinalizations,
    isSyncingPending,
    fetchPayload,
    watch,
    unwatch,
    people
  });
})(window);

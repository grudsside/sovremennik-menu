/* Современник — Control v4 Supabase service and idempotent submission pipeline. */
(function(global){
  'use strict';

  if(global.SovremennikControlV4Service) return;

  const Core = global.SovremennikControlV4Core;
  const Storage = global.SovremennikControlV4Storage;
  if(!Core || !Storage){
    console.error('Control v4 service cannot start: core or storage is unavailable.');
    return;
  }

  const VERSION = '2026-07-30-control-v4-service-1';
  const PHOTO_BUCKET = 'checklist-photo-reports';
  const SUBMISSION_CACHE = 'sovremennikControlV4SubmissionsCache';
  const REVISION_CACHE = 'sovremennikControlV4RevisionsCache';
  const ERROR_CACHE = 'sovremennikControlV4ErrorsCache';
  const PHOTO_RULES_CACHE = 'sovremennikControlV4PhotoRulesCache';
  const MAX_RAW_BYTES = 25 * 1024 * 1024;
  const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
  let syncing = false;
  let syncPromise = null;

  function client(){
    try { return global.sovremennikSupabase || (typeof supa !== 'undefined' ? supa : null); }
    catch(error){ return null; }
  }
  function user(){
    try { return typeof global.currentUser === 'function' ? global.currentUser() : null; }
    catch(error){ return null; }
  }
  function authenticated(){
    const current = user();
    try { return typeof global.isAuthenticated === 'function' ? global.isAuthenticated() : Boolean(current?.id); }
    catch(error){ return Boolean(current?.id); }
  }
  function readCache(key, fallback = []){
    try { return JSON.parse(global.localStorage?.getItem(key) || JSON.stringify(fallback)); }
    catch(error){ return fallback; }
  }
  function writeCache(key, value){
    try { global.localStorage?.setItem(key, JSON.stringify(value)); }
    catch(error){ console.warn('Control v4 cache write skipped.', error); }
  }
  function chunks(rows, size = 70){
    const result = [];
    for(let offset = 0; offset < rows.length; offset += size) result.push(rows.slice(offset, offset + size));
    return result;
  }

  async function fetchBySubmission(table, columns, ids){
    const db = client();
    if(!db || !ids.length) return [];
    const rows = [];
    for(const part of chunks(ids)){
      const result = await db.from(table).select(columns).in('submission_id', part);
      if(result.error) throw result.error;
      rows.push(...(result.data || []));
    }
    return rows;
  }

  async function loadSubmissions({ limit = 180 } = {}){
    const db = client();
    if(!authenticated() || !db) return { rows:readCache(SUBMISSION_CACHE), offline:true, error:'Нет подключения к Supabase.' };
    try{
      const result = await db.from('checklist_submissions')
        .select('id,checklist_id,checklist_title,employee_id,employee_name,items,completed_count,total_count,percent,photo_required_count,photo_count,photo_upload_status,submitted_incomplete,version,created_at,deleted_at')
        .is('deleted_at', null)
        .order('created_at', { ascending:false })
        .limit(limit);
      if(result.error) throw result.error;
      const source = result.data || [];
      const ids = source.map(row => String(row.id || '')).filter(Boolean);
      const [photos, comments] = await Promise.all([
        fetchBySubmission('checklist_submission_photos', 'id,submission_id,checklist_id,item_key,item_text,photo_index,storage_path,thumbnail_path,mime_type,file_size,thumbnail_size,created_at,expires_at,retained,deleted_at,deleted_reason', ids),
        fetchBySubmission('checklist_submission_comments', 'id,submission_id,author_id,author_name,assignee_id,assignee_name,body,task_id,created_at', ids)
      ]);
      const photosById = new Map();
      photos.forEach(photo => {
        const key = String(photo.submission_id || '');
        if(!photosById.has(key)) photosById.set(key, []);
        photosById.get(key).push(photo);
      });
      const commentsById = new Map();
      comments.forEach(comment => {
        const key = String(comment.submission_id || '');
        if(!commentsById.has(key)) commentsById.set(key, []);
        commentsById.get(key).push(comment);
      });
      const rows = source.map(row => Core.normalizeSubmission({
        ...row,
        photos:photosById.get(String(row.id)) || [],
        comments:(commentsById.get(String(row.id)) || []).sort((a,b) => String(a.created_at).localeCompare(String(b.created_at)))
      }));
      writeCache(SUBMISSION_CACHE, rows.map(row => ({ ...row, photos:[], comments:row.comments })));
      return { rows, offline:false, error:'' };
    }catch(error){
      console.warn('Control v4 submissions load failed.', error);
      return { rows:readCache(SUBMISSION_CACHE).map(Core.normalizeSubmission), offline:true, error:error?.message || 'Не удалось загрузить чек-листы.' };
    }
  }

  function mapRevision(row){
    const key = Core.dateKey(row?.revision_date || row?.dateKey || row?.date || row?.created_at);
    return {
      id:String(row?.id || `coffee-${key}`),
      dateKey:key,
      date:Core.displayDate(key),
      employeeName:Core.text(row?.employee_name || row?.employeeName),
      hopperWeight:row?.hopper_weight ?? row?.hopperWeight ?? '',
      openedPacks:row?.opened_packs ?? row?.openedPacks ?? '',
      writeOffs:row?.write_offs ?? row?.writeOffs ?? '',
      iikoSales:row?.iiko_sales ?? row?.iikoSales ?? '',
      difference:row?.difference ?? '',
      losses:row?.losses_percent === null || row?.losses_percent === undefined ? (row?.losses || '') : `${row.losses_percent}%`,
      checked:row?.checked || '',
      cleanHopperWeight:row?.clean_hopper_weight ?? row?.cleanHopperWeight ?? '',
      totalCoffeeUsage:row?.total_coffee_usage ?? row?.totalCoffeeUsage ?? '',
      createdAt:row?.created_at || row?.updated_at || row?.createdAt || new Date().toISOString()
    };
  }
  function mergeRevisions(rows){
    if(typeof global.mergeRevisionRecordsByDate === 'function'){
      try { return global.mergeRevisionRecordsByDate((rows || []).map(mapRevision)); }
      catch(error){ console.warn('Global revision merge failed, Control v4 fallback is used.', error); }
    }
    const map = new Map();
    (rows || []).map(mapRevision).forEach(row => {
      if(!row.dateKey) return;
      map.set(row.dateKey, { ...(map.get(row.dateKey) || {}), ...row });
    });
    return Array.from(map.values()).sort((a,b) => String(a.dateKey).localeCompare(String(b.dateKey)));
  }
  async function loadRevisions(){
    const db = client();
    if(!authenticated() || !db) return { rows:readCache(REVISION_CACHE), offline:true, error:'Нет подключения к Supabase.' };
    try{
      const result = await db.from('coffee_revision_report').select('*').order('revision_date', { ascending:true });
      if(result.error) throw result.error;
      const rows = mergeRevisions(result.data || []);
      writeCache(REVISION_CACHE, rows);
      return { rows, offline:false, error:'' };
    }catch(error){
      console.warn('Control v4 revisions load failed.', error);
      return { rows:mergeRevisions(readCache(REVISION_CACHE)), offline:true, error:error?.message || 'Не удалось загрузить ревизии.' };
    }
  }
  async function loadErrors(){
    const db = client();
    if(!authenticated() || !db) return { rows:readCache(ERROR_CACHE), offline:true, error:'Нет подключения к Supabase.' };
    try{
      const result = await db.from('error_reports').select('*').order('created_at', { ascending:false }).limit(300);
      if(result.error) throw result.error;
      const rows = (result.data || []).map(row => ({
        id:String(row.id || ''),
        employeeName:Core.text(row.employee_name || row.employeeName),
        text:Core.text(row.message || row.text),
        createdAt:row.created_at || row.createdAt
      }));
      writeCache(ERROR_CACHE, rows);
      return { rows, offline:false, error:'' };
    }catch(error){
      console.warn('Control v4 error reports load failed.', error);
      return { rows:readCache(ERROR_CACHE), offline:true, error:error?.message || 'Не удалось загрузить сообщения.' };
    }
  }
  async function loadProfiles(){
    const db = client();
    if(!db || !authenticated()) return [];
    const result = await db.from('profiles').select('id,name,role,login,is_active').eq('is_active', true).order('name', { ascending:true });
    if(result.error) throw result.error;
    return (result.data || []).map(row => ({ id:String(row.id || ''), name:Core.text(row.name || row.login), role:Core.normalizeRole(row.role) }));
  }
  async function loadPhotoRules(){
    const db = client();
    const cached = readCache(PHOTO_RULES_CACHE);
    if(!db || !authenticated() || !navigator.onLine) return cached;
    try{
      const result = await db.from('checklist_photo_rules')
        .select('checklist_id,item_key,item_text,required_count,hint,is_active,updated_at')
        .eq('is_active', true)
        .order('checklist_id', { ascending:true })
        .order('item_key', { ascending:true });
      if(result.error) throw result.error;
      const rows = result.data || [];
      writeCache(PHOTO_RULES_CACHE, rows);
      return rows;
    }catch(error){
      console.warn('Control v4 photo rules load failed.', error);
      return cached;
    }
  }
  async function replacePhotoRules(checklistId, rules){
    const db = client();
    if(!db) throw new Error('Supabase недоступен.');
    const result = await db.rpc('replace_checklist_photo_rules', { p_checklist_id:String(checklistId), p_rules:rules || [] });
    if(result.error) throw result.error;
    return result.data;
  }
  async function createComment(submissionId, assigneeId, body){
    const db = client();
    if(!db) throw new Error('Supabase недоступен.');
    const result = await db.rpc('create_checklist_submission_comment', {
      p_submission_id:String(submissionId),
      p_assignee_id:String(assigneeId),
      p_body:Core.text(body)
    });
    if(result.error) throw result.error;
    return result.data;
  }
  async function deleteSubmission(submissionId){
    const db = client();
    if(!db) throw new Error('Supabase недоступен.');
    const result = await db.rpc('delete_checklist_submission', {
      p_submission_id:String(submissionId),
      p_reason:'Удалено администратором из Control v4'
    });
    if(result.error) throw result.error;
    return result.data;
  }
  async function saveRevisionManual(payload){
    const db = client();
    const current = user();
    if(!db || !current?.id) throw new Error('Нужно войти в аккаунт.');
    const row = {
      revision_date:Core.dateKey(payload.revisionDate),
      employee_id:current.id,
      employee_name:Core.text(payload.employeeName || current.name)
    };
    if(payload.writeOffs !== '' && payload.writeOffs !== undefined) row.write_offs = Number(payload.writeOffs);
    if(payload.iikoSales !== '' && payload.iikoSales !== undefined) row.iiko_sales = Number(payload.iikoSales);
    if(payload.checked !== '' && payload.checked !== undefined) row.checked = Core.text(payload.checked);
    const result = await db.from('coffee_revisions').upsert(row, { onConflict:'revision_date' }).select().single();
    if(result.error) throw result.error;
    return result.data;
  }

  function imageFromFile(file){
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Формат фотографии не поддерживается браузером.')); };
      image.src = url;
    });
  }
  function canvasBlob(image, maxSide, quality){
    const widthSource = image.naturalWidth || image.width;
    const heightSource = image.naturalHeight || image.height;
    const ratio = Math.min(1, maxSide / Math.max(widthSource, heightSource));
    const width = Math.max(1, Math.round(widthSource * ratio));
    const height = Math.max(1, Math.round(heightSource * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha:false });
    if(!context) throw new Error('Браузер не поддерживает обработку фотографии.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Не удалось подготовить фотографию.')),
      'image/jpeg', quality
    ));
  }
  async function prepareImage(file){
    if(!file?.type?.startsWith('image/')) throw new Error('Можно прикрепить только фотографию.');
    if(file.size > MAX_RAW_BYTES) throw new Error('Исходное фото слишком большое. Максимум — 25 МБ.');
    const image = await imageFromFile(file);
    let fullBlob = await canvasBlob(image, 1600, 0.78);
    if(fullBlob.size > MAX_UPLOAD_BYTES) fullBlob = await canvasBlob(image, 1400, 0.64);
    if(fullBlob.size > MAX_UPLOAD_BYTES) throw new Error('Не удалось уменьшить фото до допустимого размера.');
    const thumbnailBlob = await canvasBlob(image, 360, 0.72);
    return {
      id:Core.uuid(),
      name:Core.text(file.name) || 'photo.jpg',
      type:'image/jpeg',
      fullBlob,
      thumbnailBlob
    };
  }

  async function ensureSubmissionRow(item){
    const db = client();
    const summary = item.summary || Core.summarize(item.tasks);
    const row = {
      id:item.id,
      checklist_id:item.checklistId,
      checklist_title:item.checklistTitle,
      employee_id:item.userId,
      employee_name:item.employeeName,
      items:item.tasks,
      completed_count:summary.done,
      total_count:summary.total,
      percent:summary.percent,
      photo_required_count:summary.requiredPhotos,
      photo_count:0,
      photo_upload_status:summary.requiredPhotos ? 'pending' : 'not_required',
      submitted_incomplete:summary.incomplete,
      version:4
    };
    const result = await db.from('checklist_submissions').insert(row);
    if(result.error && !Core.isDuplicateError(result.error)) throw result.error;
    return row;
  }
  async function existingPhoto(item, photo){
    const db = client();
    const result = await db.from('checklist_submission_photos')
      .select('id,storage_path,thumbnail_path')
      .eq('submission_id', item.id)
      .eq('item_key', photo.itemKey)
      .eq('photo_index', photo.index)
      .maybeSingle();
    if(result.error) throw result.error;
    return result.data || null;
  }
  async function uploadPhoto(item, photo){
    if(await existingPhoto(item, photo)) return;
    const db = client();
    const paths = Core.photoPaths({ userId:item.userId, submissionId:item.id, itemKey:photo.itemKey, index:photo.index });
    const full = await db.storage.from(PHOTO_BUCKET).upload(paths.fullPath, photo.fullBlob, {
      contentType:photo.type || 'image/jpeg', cacheControl:'3600', upsert:true
    });
    if(full.error) throw full.error;
    const thumb = await db.storage.from(PHOTO_BUCKET).upload(paths.thumbnailPath, photo.thumbnailBlob || photo.fullBlob, {
      contentType:'image/jpeg', cacheControl:'3600', upsert:true
    });
    if(thumb.error) throw thumb.error;
    const task = (item.tasks || []).find(row => row.itemKey === photo.itemKey) || {};
    const metadata = {
      submission_id:item.id,
      checklist_id:item.checklistId,
      item_key:photo.itemKey,
      item_text:task.text || '',
      photo_index:photo.index,
      storage_path:full.data.path,
      thumbnail_path:thumb.data.path,
      mime_type:photo.type || 'image/jpeg',
      file_size:photo.fullBlob?.size || 0,
      thumbnail_size:(photo.thumbnailBlob || photo.fullBlob)?.size || 0,
      created_by:item.userId
    };
    const inserted = await db.from('checklist_submission_photos').insert(metadata);
    if(inserted.error && !Core.isDuplicateError(inserted.error)) throw inserted.error;
  }
  async function finalize(item){
    const db = client();
    const result = await db.rpc('finalize_checklist_photo_submission', { p_submission_id:item.id, p_items:item.tasks });
    if(result.error) throw result.error;
    return Array.isArray(result.data) ? result.data[0] : result.data;
  }
  function notifySubmitted(item, finalized){
    try{
      if(typeof global.safeNotifyEvent === 'function') global.safeNotifyEvent('checklist_submitted', {
        submission_id:item.id,
        checklist_title:item.checklistTitle,
        employee_name:item.employeeName,
        photo_count:Number(finalized?.photo_count ?? item.photos?.length ?? 0)
      });
    }catch(error){ console.warn('Checklist notification skipped.', error); }
  }
  async function syncItem(item){
    if(!navigator.onLine) throw new Error('Нет соединения с интернетом.');
    if(!authenticated() || String(user()?.id || '') !== String(item.userId)) throw new Error('Нужно войти под сотрудником, который заполнил чек-лист.');
    item.status = 'syncing';
    await Storage.saveQueue(item);
    await ensureSubmissionRow(item);
    for(const photo of item.photos || []) await uploadPhoto(item, photo);
    const finalized = await finalize(item);
    notifySubmitted(item, finalized);
    await Storage.deleteQueue(item.id);
    global.dispatchEvent(new CustomEvent('sov:control-v4-submitted', { detail:{ item, finalized } }));
    return finalized;
  }
  async function syncPending(){
    if(syncPromise) return syncPromise;
    if(!navigator.onLine || !authenticated()) return [];
    syncing = true;
    global.dispatchEvent(new CustomEvent('sov:control-v4-sync-state', { detail:{ syncing:true } }));
    syncPromise = (async () => {
      const rows = await Storage.queueForUser(user()?.id || '');
      const results = [];
      for(const item of rows){
        try{
          const finalized = await syncItem(item);
          results.push({ id:item.id, ok:true, finalized });
        }catch(error){
          item.status = 'failed';
          item.attemptCount = Number(item.attemptCount || 0) + 1;
          item.lastError = error?.message || 'Не удалось отправить чек-лист.';
          await Storage.saveQueue(item);
          results.push({ id:item.id, ok:false, error:item.lastError });
          if(!navigator.onLine) break;
        }
      }
      return results;
    })().finally(() => {
      syncing = false;
      syncPromise = null;
      global.dispatchEvent(new CustomEvent('sov:control-v4-sync-state', { detail:{ syncing:false } }));
    });
    return syncPromise;
  }
  function isSyncing(){ return syncing; }
  async function signedUrl(path, seconds = 600){
    const db = client();
    if(!db) throw new Error('Supabase недоступен.');
    const result = await db.storage.from(PHOTO_BUCKET).createSignedUrl(path, seconds);
    if(result.error) throw result.error;
    return result.data?.signedUrl || '';
  }

  global.addEventListener('online', () => { void syncPending(); });

  global.SovremennikControlV4Service = Object.freeze({
    VERSION,
    PHOTO_BUCKET,
    client,
    user,
    authenticated,
    loadSubmissions,
    loadRevisions,
    loadErrors,
    loadProfiles,
    loadPhotoRules,
    replacePhotoRules,
    createComment,
    deleteSubmission,
    saveRevisionManual,
    prepareImage,
    syncItem,
    syncPending,
    isSyncing,
    signedUrl,
    mergeRevisions,
    readCache
  });
})(window);

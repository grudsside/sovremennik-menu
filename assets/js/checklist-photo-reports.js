/* Современник checklist photo reports — preview integration. */
(function(){
  'use strict';

  const core = window.SovremennikChecklistPhotoCore;
  if(!core || typeof state === 'undefined') return;

  const VERSION = '2026-07-22-photo-preview-1';
  const PHOTO_BUCKET = 'checklist-photo-reports';
  const PAGE_SIZE = 150;
  const RETENTION_DAYS = 90;
  const MAX_RAW_BYTES = 25 * 1024 * 1024;
  const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
  const drafts = new Map();
  const signedUrlCache = new Map();
  let photoRulesPromise = null;
  let controlLoadPromise = null;
  let enhanceQueued = false;
  let delegatedEventsInstalled = false;

  Object.assign(state, {
    checklistPhotoRules: Array.isArray(state.checklistPhotoRules) ? state.checklistPhotoRules : null,
    checklistPhotoRulesLoading: false,
    checklistPhotoRulesError: '',
    checklistPhotoControlHasMore: false,
    checklistPhotoControlCursor: '',
    checklistPhotoVisibleDays: Number(state.checklistPhotoVisibleDays || 14),
    selectedPhotoRuleChecklistId: state.selectedPhotoRuleChecklistId || ''
  });

  const renderAppBeforePhotoReports = typeof renderApp === 'function' ? renderApp : null;
  const setTopBeforePhotoReports = typeof setTop === 'function' ? setTop : null;
  const setControlTabBeforePhotoReports = typeof setControlTab === 'function' ? setControlTab : null;
  const refreshControlBeforePhotoReports = typeof refreshControl === 'function' ? refreshControl : null;
  const submitChecklistBeforePhotoReports = typeof submitChecklist === 'function' ? submitChecklist : null;
  const loadControlRecordsBeforePhotoReports = typeof loadControlRecords === 'function' ? loadControlRecords : null;
  const normalizeRemoteRecordBeforePhotoReports = typeof normalizeRemoteRecord === 'function' ? normalizeRemoteRecord : null;

  function html(value){
    if(typeof esc === 'function') return esc(value);
    return String(value ?? '').replace(/[&<>\"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char]));
  }
  function attr(value){ return html(value).replace(/'/g, '&#39;'); }
  function currentUserSafe(){ return typeof currentUser === 'function' ? currentUser() : null; }
  function authenticated(){ return typeof isAuthenticated === 'function' ? isAuthenticated() : Boolean(currentUserSafe()?.id); }
  function admin(){ return typeof isAdmin === 'function' ? isAdmin() : false; }
  function makeUuid(){
    if(typeof makeUuidV26 === 'function') return makeUuidV26();
    if(window.crypto?.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
      const random = Math.random() * 16 | 0;
      const value = char === 'x' ? random : (random & 0x3 | 0x8);
      return value.toString(16);
    });
  }
  function checklistDocs(){ return Array.isArray(state.menu?.checklists) ? state.menu.checklists : []; }
  function checklistDoc(id){ return checklistDocs().find(doc => String(doc.id) === String(id)) || null; }
  function ruleMap(){ return core.rulesByKey(state.checklistPhotoRules || []); }
  function rulesForChecklist(id){
    const map = ruleMap();
    return core.flattenChecklist(checklistDoc(id)).map(item => ({ ...item, rule:map.get(core.ruleKey(id, item.itemKey)) || null })).filter(item => item.rule);
  }
  function draftKey(checklistId, itemKey){ return `${checklistId}|${itemKey}`; }
  function itemDrafts(checklistId, itemKey){ return drafts.get(draftKey(checklistId, itemKey)) || []; }
  function setItemDrafts(checklistId, itemKey, rows){ drafts.set(draftKey(checklistId, itemKey), rows); }
  function clearItemDrafts(checklistId, itemKey){
    const rows = itemDrafts(checklistId, itemKey);
    rows.forEach(row => { if(row.previewUrl) URL.revokeObjectURL(row.previewUrl); });
    drafts.delete(draftKey(checklistId, itemKey));
  }
  function clearChecklistDrafts(checklistId){
    Array.from(drafts.keys()).filter(key => key.startsWith(`${checklistId}|`)).forEach(key => {
      (drafts.get(key) || []).forEach(row => { if(row.previewUrl) URL.revokeObjectURL(row.previewUrl); });
      drafts.delete(key);
    });
  }
  function pluralPhotos(count){
    const value = Number(count) || 0;
    const mod10 = value % 10;
    const mod100 = value % 100;
    if(mod10 === 1 && mod100 !== 11) return `${value} фото`;
    return `${value} фото`;
  }
  function setSubmitStatus(card, message, kind = ''){
    const status = card?.querySelector('.submit-status');
    if(!status) return;
    status.textContent = message || '';
    status.className = `submit-status${kind ? ` ${kind}` : ''}`;
  }

  async function loadPhotoRules(force = false){
    if(!authenticated() || typeof supa === 'undefined') return [];
    if(!force && Array.isArray(state.checklistPhotoRules)) return state.checklistPhotoRules;
    if(photoRulesPromise) return photoRulesPromise;
    state.checklistPhotoRulesLoading = true;
    state.checklistPhotoRulesError = '';
    photoRulesPromise = (async () => {
      const result = await supa
        .from('checklist_photo_rules')
        .select('checklist_id,item_key,item_text,required_count,hint,is_active,updated_at')
        .eq('is_active', true)
        .order('checklist_id', { ascending:true })
        .order('item_key', { ascending:true });
      if(result.error) throw result.error;
      state.checklistPhotoRules = result.data || [];
      return state.checklistPhotoRules;
    })().catch(error => {
      console.warn('Checklist photo rules are unavailable', error);
      state.checklistPhotoRulesError = error.message || 'Не удалось загрузить настройки фотоотчёта.';
      state.checklistPhotoRules = state.checklistPhotoRules || [];
      return state.checklistPhotoRules;
    }).finally(() => {
      state.checklistPhotoRulesLoading = false;
      photoRulesPromise = null;
      queueEnhance();
    });
    return photoRulesPromise;
  }

  function imageElementFromFile(file){
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Формат фотографии не поддерживается браузером.')); };
      image.src = url;
    });
  }
  function canvasBlob(image, maxSide, quality){
    const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * ratio));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha:false });
    if(!context) throw new Error('Браузер не поддерживает обработку фотографии.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Не удалось подготовить фотографию.')),
      'image/jpeg',
      quality
    ));
  }
  async function prepareImage(file){
    if(!file?.type?.startsWith('image/')) throw new Error('Можно прикрепить только фотографию.');
    if(file.size > MAX_RAW_BYTES) throw new Error('Исходное фото слишком большое. Максимум — 25 МБ.');
    const image = await imageElementFromFile(file);
    let fullBlob = await canvasBlob(image, 1600, 0.78);
    if(fullBlob.size > MAX_UPLOAD_BYTES) fullBlob = await canvasBlob(image, 1400, 0.64);
    if(fullBlob.size > MAX_UPLOAD_BYTES) throw new Error('Не удалось уменьшить фото до допустимого размера.');
    const thumbnailBlob = await canvasBlob(image, 360, 0.72);
    return {
      id:makeUuid(),
      name:file.name || 'photo.jpg',
      fullBlob,
      thumbnailBlob,
      previewUrl:URL.createObjectURL(thumbnailBlob),
      uploaded:false,
      metadata:null
    };
  }

  function photoFieldHtml(checklistId, item, rule){
    const required = rule.requiredCount;
    return `<div class="checklist-photo-field" data-checklist-photo-field data-checklist-id="${attr(checklistId)}" data-item-key="${attr(item.itemKey)}" data-required-count="${required}">
      <div class="checklist-photo-field-head"><span>Фото обязательно</span><strong>${html(pluralPhotos(required))}</strong></div>
      ${rule.hint ? `<p class="checklist-photo-hint">${html(rule.hint)}</p>` : '<p class="checklist-photo-hint">Сфотографируйте результат так, чтобы его можно было проверить.</p>'}
      <div class="checklist-photo-previews" data-photo-previews></div>
      <div class="checklist-photo-actions">
        <button class="small-action secondary checklist-photo-pick" type="button" data-photo-pick>Добавить фото</button>
        <input type="file" accept="image/*" capture="environment" ${required > 1 ? 'multiple' : ''} hidden data-photo-input>
        <span class="checklist-photo-status" data-photo-status aria-live="polite">0/${required}</span>
      </div>
    </div>`;
  }
  function renderDraftField(field){
    if(!field) return;
    const checklistId = field.dataset.checklistId || '';
    const itemKey = field.dataset.itemKey || '';
    const required = Number(field.dataset.requiredCount || 1);
    const rows = itemDrafts(checklistId, itemKey);
    const previews = field.querySelector('[data-photo-previews]');
    if(previews){
      previews.innerHTML = rows.map((row, index) => `<article class="checklist-photo-preview ${row.uploaded ? 'uploaded' : ''}">
        <img src="${attr(row.previewUrl)}" alt="Фото подтверждение ${index + 1}">
        <span>${row.uploaded ? 'Загружено' : `Фото ${index + 1}`}</span>
        ${row.uploaded ? '' : `<button type="button" data-photo-remove="${attr(row.id)}" aria-label="Удалить фото">×</button>`}
      </article>`).join('');
    }
    const pick = field.querySelector('[data-photo-pick]');
    if(pick){
      pick.disabled = rows.length >= required || field.dataset.processing === '1';
      pick.textContent = rows.length ? 'Добавить ещё' : 'Добавить фото';
    }
    const status = field.querySelector('[data-photo-status]');
    if(status) status.textContent = `${rows.length}/${required}`;
    updateItemState(field);
  }
  function updateItemState(field){
    const checklistId = field?.dataset.checklistId || '';
    const itemKey = field?.dataset.itemKey || '';
    const required = Number(field?.dataset.requiredCount || 1);
    const count = itemDrafts(checklistId, itemKey).length;
    const input = document.querySelector(`.doc-card[data-checklist-id="${CSS.escape(checklistId)}"] .task-checkbox[data-photo-item-key="${CSS.escape(itemKey)}"]`);
    const label = input?.closest('label');
    if(!label) return;
    const ready = Boolean(input.checked && count >= required);
    label.classList.toggle('photo-ready', ready);
    label.classList.toggle('photo-awaiting', Boolean(input.checked && count < required));
    label.classList.toggle('photo-attached-unchecked', Boolean(!input.checked && count > 0));
    const status = field.querySelector('[data-photo-status]');
    if(!status) return;
    if(field.dataset.processing === '1') status.textContent = 'Подготавливаю фото…';
    else if(input.checked && count < required) status.textContent = `Ожидает фото · ${count}/${required}`;
    else if(!input.checked && count >= required) status.textContent = `Фото готово · поставьте галочку`;
    else if(ready) status.textContent = `Пункт готов · ${count}/${required}`;
    else status.textContent = `${count}/${required}`;
  }
  async function addSelectedFiles(field, input){
    const checklistId = field.dataset.checklistId || '';
    const itemKey = field.dataset.itemKey || '';
    const required = Number(field.dataset.requiredCount || 1);
    const current = itemDrafts(checklistId, itemKey).slice();
    const available = Math.max(0, required - current.length);
    const files = Array.from(input.files || []).slice(0, available);
    input.value = '';
    if(!files.length) return;
    field.dataset.processing = '1';
    renderDraftField(field);
    try{
      for(const file of files){
        const prepared = await prepareImage(file);
        current.push(prepared);
        setItemDrafts(checklistId, itemKey, current.slice());
        renderDraftField(field);
      }
    } catch(error){
      console.error(error);
      const status = field.querySelector('[data-photo-status]');
      if(status) status.textContent = error.message || 'Не удалось обработать фото.';
    } finally {
      field.dataset.processing = '0';
      renderDraftField(field);
    }
  }
  function removeDraft(field, id){
    const checklistId = field.dataset.checklistId || '';
    const itemKey = field.dataset.itemKey || '';
    const rows = itemDrafts(checklistId, itemKey);
    const removed = rows.find(row => row.id === id);
    if(removed?.uploaded) return;
    if(removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    setItemDrafts(checklistId, itemKey, rows.filter(row => row.id !== id));
    renderDraftField(field);
  }

  function enhanceChecklistCards(){
    const rules = ruleMap();
    document.querySelectorAll('.doc-card[data-checklist-id]').forEach(card => {
      const checklistId = card.dataset.checklistId || '';
      const doc = checklistDoc(checklistId);
      if(!doc) return;
      const items = core.flattenChecklist(doc);
      const inputs = Array.from(card.querySelectorAll('.task-checkbox'));
      inputs.forEach((input, index) => {
        const item = items[index];
        if(!item) return;
        input.dataset.photoItemKey = item.itemKey;
        input.dataset.photoItemText = item.itemText;
        const rule = rules.get(core.ruleKey(checklistId, item.itemKey));
        const label = input.closest('label');
        const existing = card.querySelector(`[data-checklist-photo-field][data-item-key="${CSS.escape(item.itemKey)}"]`);
        if(!rule){
          label?.classList.remove('photo-required-item','photo-ready','photo-awaiting','photo-attached-unchecked');
          existing?.remove();
          return;
        }
        label?.classList.add('photo-required-item');
        let field = existing;
        if(!field && label){
          label.insertAdjacentHTML('afterend', photoFieldHtml(checklistId, item, rule));
          field = label.nextElementSibling;
        }
        if(!field) return;
        field.dataset.requiredCount = String(rule.requiredCount);
        if(field.dataset.bound !== '1'){
          field.dataset.bound = '1';
          field.querySelector('[data-photo-pick]')?.addEventListener('click', () => field.querySelector('[data-photo-input]')?.click());
          field.querySelector('[data-photo-input]')?.addEventListener('change', event => addSelectedFiles(field, event.currentTarget));
          field.addEventListener('click', event => {
            const remove = event.target.closest('[data-photo-remove]');
            if(remove) removeDraft(field, remove.dataset.photoRemove);
          });
          input.addEventListener('change', () => updateItemState(field));
        }
        renderDraftField(field);
      });
    });
  }

  function fakePhotosFromDrafts(checklistId, tasks){
    return tasks.flatMap(task => itemDrafts(checklistId, task.itemKey).map(row => ({ itemKey:task.itemKey, deletedAt:null, draftId:row.id })));
  }
  function collectChecklist(card, doc){
    const rules = ruleMap();
    const items = core.flattenChecklist(doc);
    const inputs = Array.from(card.querySelectorAll('.task-checkbox'));
    const tasks = inputs.map((input, index) => {
      const item = items[index] || { itemKey:`${doc.id}:${index}`, itemText:input.dataset.task || 'Пункт чек-листа' };
      const rule = rules.get(core.ruleKey(doc.id, item.itemKey));
      const attached = itemDrafts(doc.id, item.itemKey).length;
      return {
        itemKey:item.itemKey,
        text:input.dataset.task || item.itemText || 'Пункт чек-листа',
        sectionTitle:item.sectionTitle || '',
        checkedByUser:Boolean(input.checked),
        checked:Boolean(input.checked && (!rule || attached >= rule.requiredCount)),
        photoRequired:Boolean(rule),
        requiredPhotoCount:rule?.requiredCount || 0,
        photoCount:attached,
        photoStatus:rule ? (attached >= rule.requiredCount ? 'selected' : input.checked ? 'awaiting_photo' : 'missing') : 'not_required'
      };
    });
    return { tasks, summary:core.summarize(tasks, fakePhotosFromDrafts(doc.id, tasks)) };
  }
  function incompleteMessage(summary){
    const lines = [
      `Чек-лист заполнен на ${summary.percent}% (${summary.done}/${summary.total}).`
    ];
    if(summary.total - summary.done > 0) lines.push(`Не выполнено пунктов: ${summary.total - summary.done}.`);
    if(summary.missingPhotos > 0) lines.push(`Не хватает обязательных фотографий: ${summary.missingPhotos}.`);
    lines.push('', 'Отправить неполный чек-лист?');
    return lines.join('\n');
  }
  async function createPhotoSubmission(doc, employeeName, tasks, summary){
    const user = currentUserSafe();
    if(!user?.id) throw new Error('Нужно войти в аккаунт сотрудника.');
    const row = {
      id:makeUuid(),
      checklist_id:doc.id || '',
      checklist_title:doc.title || '',
      employee_id:user.id,
      employee_name:employeeName || user.name || '',
      items:tasks,
      completed_count:summary.done,
      total_count:summary.total,
      percent:summary.percent,
      photo_required_count:summary.requiredPhotos,
      photo_count:0,
      photo_upload_status:summary.requiredPhotos ? 'pending' : 'not_required',
      submitted_incomplete:summary.incomplete,
      version:2
    };
    const result = await supa.from('checklist_submissions').insert(row).select('*').single();
    if(result.error) throw result.error;
    return result.data || row;
  }
  async function uploadDraft(submission, doc, task, draft, photoIndex){
    if(draft.uploaded) return draft.metadata;
    const user = currentUserSafe();
    const paths = core.buildStoragePaths({
      userId:user.id,
      submissionId:submission.id,
      itemKey:task.itemKey,
      index:photoIndex,
      nonce:`${Date.now()}-${draft.id.slice(0,8)}`
    });
    const full = await supa.storage.from(PHOTO_BUCKET).upload(paths.fullPath, draft.fullBlob, {
      contentType:'image/jpeg', cacheControl:'3600', upsert:false
    });
    if(full.error) throw full.error;
    const thumb = await supa.storage.from(PHOTO_BUCKET).upload(paths.thumbnailPath, draft.thumbnailBlob, {
      contentType:'image/jpeg', cacheControl:'3600', upsert:false
    });
    if(thumb.error) throw thumb.error;
    const metadata = {
      submission_id:submission.id,
      checklist_id:doc.id || '',
      item_key:task.itemKey,
      item_text:task.text || '',
      photo_index:photoIndex,
      storage_path:full.data.path,
      thumbnail_path:thumb.data.path,
      mime_type:'image/jpeg',
      file_size:draft.fullBlob.size,
      thumbnail_size:draft.thumbnailBlob.size,
      created_by:user.id
    };
    const inserted = await supa.from('checklist_submission_photos').insert(metadata).select('*').single();
    if(inserted.error) throw inserted.error;
    draft.uploaded = true;
    draft.metadata = inserted.data;
    return inserted.data;
  }
  async function finalizePhotoSubmission(submissionId, tasks){
    const result = await supa.rpc('finalize_checklist_photo_submission', {
      p_submission_id:submissionId,
      p_items:tasks
    });
    if(result.error) throw result.error;
    return Array.isArray(result.data) ? result.data[0] : result.data;
  }
  function clearCompletedChecklist(card, doc){
    card.querySelectorAll('.task-checkbox').forEach(input => { input.checked = false; });
    const nameInput = card.querySelector('.employee-name');
    if(nameInput) nameInput.value = '';
    clearChecklistDrafts(doc.id);
    delete card.dataset.photoSubmissionId;
    card.querySelectorAll('[data-checklist-photo-field]').forEach(renderDraftField);
  }
  async function submitPhotoChecklist(docId){
    await loadPhotoRules();
    const doc = checklistDoc(docId);
    const card = document.querySelector(`.doc-card[data-checklist-id="${CSS.escape(String(docId))}"]`);
    if(!doc || !card) return;
    if(!rulesForChecklist(docId).length && submitChecklistBeforePhotoReports){
      return submitChecklistBeforePhotoReports(docId);
    }
    if(card.querySelector('[data-checklist-photo-field][data-processing="1"]')){
      setSubmitStatus(card, 'Дождитесь завершения обработки фотографий.', 'error');
      return;
    }
    const nameInput = card.querySelector('.employee-name');
    const employeeName = String(nameInput?.value || '').trim();
    if(!employeeName){
      setSubmitStatus(card, 'Введите имя сотрудника перед отправкой.', 'error');
      nameInput?.focus();
      return;
    }
    const collected = collectChecklist(card, doc);
    if(collected.summary.incomplete && !window.confirm(incompleteMessage(collected.summary))) return;
    const button = card.querySelector('.submit-checklist');
    const originalLabel = button?.textContent || 'Отправить';
    if(button) button.disabled = true;
    setSubmitStatus(card, 'Создаю запись чек-листа…');
    try{
      let submission;
      if(card.dataset.photoSubmissionId){
        submission = { id:card.dataset.photoSubmissionId };
      } else {
        submission = await createPhotoSubmission(doc, employeeName, collected.tasks, collected.summary);
        card.dataset.photoSubmissionId = submission.id;
      }
      const uploadQueue = [];
      collected.tasks.filter(task => task.photoRequired).forEach(task => {
        itemDrafts(doc.id, task.itemKey).forEach((draft, index) => {
          if(!draft.uploaded) uploadQueue.push({ task, draft, photoIndex:index + 1 });
        });
      });
      const failures = [];
      for(let index = 0; index < uploadQueue.length; index += 1){
        const job = uploadQueue[index];
        setSubmitStatus(card, `Загружаю фото ${index + 1} из ${uploadQueue.length}…`);
        try{
          await uploadDraft(submission, doc, job.task, job.draft, job.photoIndex);
          const field = card.querySelector(`[data-checklist-photo-field][data-item-key="${CSS.escape(job.task.itemKey)}"]`);
          renderDraftField(field);
        } catch(error){
          console.error('Checklist photo upload failed', error);
          failures.push({ job, error });
        }
      }
      setSubmitStatus(card, 'Проверяю итог чек-листа…');
      const latest = collectChecklist(card, doc);
      const finalized = await finalizePhotoSubmission(submission.id, latest.tasks);
      if(failures.length){
        setSubmitStatus(card, `Не удалось загрузить ${failures.length} фото. Запись сохранена как неполная — нажмите «Отправить» ещё раз для повтора.`, 'error');
        alert('Часть фотографий не загрузилась. Заполненные данные сохранены, повторите отправку после восстановления соединения.');
        return;
      }
      if(typeof safeNotifyEvent === 'function') safeNotifyEvent('checklist_submitted', {
        submission_id:submission.id,
        checklist_title:doc.title || '',
        employee_name:employeeName,
        photo_count:Number(finalized?.photo_count || 0)
      });
      if(typeof saveLocalControlRecord === 'function'){
        saveLocalControlRecord({
          id:submission.id,
          checklistId:doc.id,
          checklistTitle:doc.title,
          employeeName,
          createdAt:new Date().toISOString(),
          tasks:finalized?.items || latest.tasks,
          completed:Number(finalized?.completed_count ?? latest.summary.done),
          total:Number(finalized?.total_count ?? latest.summary.total),
          percent:Number(finalized?.percent ?? latest.summary.percent),
          photoCount:Number(finalized?.photo_count || 0)
        });
      }
      clearCompletedChecklist(card, doc);
      setSubmitStatus(card, '');
      alert(`Чек-лист отправлен. Выполнение: ${Number(finalized?.percent ?? latest.summary.percent)}%.`);
    } catch(error){
      console.error(error);
      setSubmitStatus(card, `Не удалось отправить фотоотчёт: ${error.message || 'проверьте подключение и повторите попытку.'}`, 'error');
      alert('Не удалось отправить фотоотчёт. Данные на экране сохранены — повторите попытку.');
    } finally {
      if(button){ button.disabled = false; button.textContent = originalLabel; }
    }
  }

  function normalizePhotoRecord(row){
    if(!normalizeRemoteRecordBeforePhotoReports) return row;
    const normalized = normalizeRemoteRecordBeforePhotoReports(row);
    const source = Array.isArray(row?.tasks) ? row.tasks : Array.isArray(row?.items) ? row.items : [];
    normalized.tasks = (normalized.tasks || []).map((task, index) => {
      const raw = source[index] || {};
      return {
        ...task,
        itemKey:String(raw.itemKey || raw.item_key || ''),
        checkedByUser:raw.checkedByUser === undefined ? raw.checked_by_user ?? raw.checked : raw.checkedByUser,
        checked:Boolean(raw.checked),
        photoRequired:Boolean(raw.photoRequired ?? raw.photo_required),
        requiredPhotoCount:Number(raw.requiredPhotoCount ?? raw.required_photo_count ?? 0),
        photoCount:Number(raw.photoCount ?? raw.photo_count ?? 0),
        photoStatus:String(raw.photoStatus || raw.photo_status || '')
      };
    });
    normalized.photos = Array.isArray(row?.photos) ? row.photos : [];
    normalized.photoCount = Number(row?.photoCount ?? row?.photo_count ?? 0);
    normalized.photoRequiredCount = Number(row?.photoRequiredCount ?? row?.photo_required_count ?? 0);
    normalized.photoUploadStatus = row?.photoUploadStatus || row?.photo_upload_status || 'not_required';
    normalized.submittedIncomplete = Boolean(row?.submittedIncomplete ?? row?.submitted_incomplete);
    normalized.version = Number(row?.version || 1);
    return normalized;
  }
  function mapSubmissionRow(row, photos){
    return normalizePhotoRecord({
      id:row.id,
      checklistId:row.checklist_id || '',
      checklistTitle:row.checklist_title || '',
      employeeName:row.employee_name || '',
      createdAt:row.created_at,
      tasks:Array.isArray(row.items) ? row.items : [],
      completed:row.completed_count,
      total:row.total_count,
      percent:row.percent,
      photoCount:row.photo_count,
      photoRequiredCount:row.photo_required_count,
      photoUploadStatus:row.photo_upload_status,
      submittedIncomplete:row.submitted_incomplete,
      version:row.version,
      photos
    });
  }
  async function fetchPhotosForSubmissions(ids){
    if(!ids.length) return [];
    const all = [];
    for(let offset = 0; offset < ids.length; offset += 80){
      const chunk = ids.slice(offset, offset + 80);
      const result = await supa
        .from('checklist_submission_photos')
        .select('id,submission_id,checklist_id,item_key,item_text,photo_index,storage_path,thumbnail_path,mime_type,file_size,thumbnail_size,created_at,expires_at,retained,deleted_at,deleted_reason')
        .in('submission_id', chunk)
        .order('photo_index', { ascending:true });
      if(result.error) throw result.error;
      all.push(...(result.data || []));
    }
    return all;
  }
  async function loadPhotoControlRecords(reset = true){
    if(!authenticated() || typeof supa === 'undefined') return;
    if(controlLoadPromise) return controlLoadPromise;
    state.controlLoading = true;
    state.controlError = '';
    if(reset){
      state.checklistPhotoControlCursor = '';
      state.checklistPhotoControlHasMore = false;
    }
    if(typeof refreshControl === 'function') refreshControl();
    controlLoadPromise = (async () => {
      let query = supa
        .from('checklist_submissions')
        .select('id,checklist_id,checklist_title,employee_name,items,completed_count,total_count,percent,photo_required_count,photo_count,photo_upload_status,submitted_incomplete,version,created_at')
        .order('created_at', { ascending:false })
        .limit(PAGE_SIZE);
      if(!reset && state.checklistPhotoControlCursor) query = query.lt('created_at', state.checklistPhotoControlCursor);
      const submissions = await query;
      if(submissions.error) throw submissions.error;
      const rows = submissions.data || [];
      const photoRows = await fetchPhotosForSubmissions(rows.map(row => row.id));
      const bySubmission = new Map();
      photoRows.forEach(photo => {
        if(!bySubmission.has(photo.submission_id)) bySubmission.set(photo.submission_id, []);
        bySubmission.get(photo.submission_id).push(photo);
      });
      const mapped = rows.map(row => mapSubmissionRow(row, bySubmission.get(row.id) || []));
      state.controlRecords = reset
        ? mapped
        : [...(state.controlRecords || []), ...mapped].filter((row, index, array) => array.findIndex(item => String(item.id) === String(row.id)) === index);
      state.checklistPhotoControlHasMore = rows.length === PAGE_SIZE;
      state.checklistPhotoControlCursor = rows.at(-1)?.created_at || state.checklistPhotoControlCursor || '';
      if(typeof setLocalControlRecords === 'function'){
        const lightweight = (state.controlRecords || []).map(record => ({ ...record, photos:[] }));
        setLocalControlRecords(lightweight);
      }
      return state.controlRecords;
    })().catch(async error => {
      console.warn('Checklist photo control load failed', error);
      state.controlError = error.message || 'Не удалось загрузить фотоотчёты.';
      if(reset && loadControlRecordsBeforePhotoReports){
        await loadControlRecordsBeforePhotoReports();
      }
      return state.controlRecords || [];
    }).finally(() => {
      state.controlLoading = false;
      controlLoadPromise = null;
      if(typeof refreshControl === 'function') refreshControl();
    });
    return controlLoadPromise;
  }

  function recordTotals(record){
    if(typeof recordDoneTotal === 'function') return recordDoneTotal(record);
    const total = (record.tasks || []).length || Number(record.total || 0);
    const done = (record.tasks || []).filter(task => task.checked).length || Number(record.completed || 0);
    return { done, total };
  }
  function recordPercent(record){
    const totals = recordTotals(record);
    return totals.total ? Math.round(totals.done / totals.total * 100) : Number(record.percent || 0);
  }
  function photoRowsForTask(record, task, index){
    const key = task.itemKey || '';
    return (record.photos || []).filter(photo => {
      if(key && String(photo.item_key || '') === String(key)) return true;
      return !key && String(photo.item_text || '') === String(task.text || '') && Number(photo.photo_index || 0) === index + 1;
    });
  }
  function renderControlPhoto(photo){
    const deleted = Boolean(photo.deleted_at);
    if(deleted){
      return `<div class="control-photo-card expired"><span>Фото удалено</span><small>${html(photo.deleted_reason || `по истечении ${RETENTION_DAYS} дней`)}</small></div>`;
    }
    return `<div class="control-photo-card ${photo.retained ? 'retained' : ''}">
      <button type="button" class="control-photo-thumb" data-photo-view data-photo-path="${attr(photo.storage_path)}" data-thumb-path="${attr(photo.thumbnail_path)}" aria-label="Открыть фотографию">
        <span data-photo-thumb-placeholder>Фото ${Number(photo.photo_index || 1)}</span>
      </button>
      <div class="control-photo-meta">
        <span>${photo.retained ? 'Сохранено бессрочно' : `Хранение до ${html(formatDateOnly(photo.expires_at))}`}</span>
        ${admin() ? `<button type="button" class="control-photo-retain" data-photo-retain="${attr(photo.id)}" data-next-retained="${photo.retained ? 'false' : 'true'}">${photo.retained ? 'Вернуть автоудаление' : 'Сохранить'}</button>` : ''}
      </div>
    </div>`;
  }
  function renderControlTask(record, task, index){
    const photos = photoRowsForTask(record, task, index);
    const activeCount = photos.filter(photo => !photo.deleted_at).length;
    const required = Number(task.requiredPhotoCount || 0);
    const checked = Boolean(task.checked);
    const status = checked ? 'done' : required && activeCount < required ? 'photo-missing' : 'not-done';
    const statusText = checked ? 'Выполнено' : required && activeCount < required ? 'Не выполнено · нет фото' : 'Не выполнено';
    return `<article class="control-checklist-task ${status}">
      <div class="control-checklist-task-head"><span class="control-task-icon">${checked ? '✓' : '—'}</span><div><strong>${html(task.text || 'Пункт чек-листа')}</strong><small>${html(statusText)}${required ? ` · нужно фото: ${required}` : ''}</small></div></div>
      ${photos.length ? `<div class="control-photo-grid">${photos.map(renderControlPhoto).join('')}</div>` : required ? '<p class="control-photo-empty">Обязательное фото не прикреплено.</p>' : ''}
    </article>`;
  }
  function renderSubmission(record){
    const totals = recordTotals(record);
    const percent = recordPercent(record);
    const photos = (record.photos || []).filter(photo => !photo.deleted_at).length;
    const missing = (record.tasks || []).reduce((sum, task, index) => {
      const required = Number(task.requiredPhotoCount || 0);
      const active = photoRowsForTask(record, task, index).filter(photo => !photo.deleted_at).length;
      return sum + Math.max(0, required - active);
    }, 0);
    return `<details class="checklist-submission-details" data-checklist-submission="${attr(record.id)}">
      <summary>
        <span class="control-submission-main"><strong>${html(record.checklistTitle || 'Чек-лист')}</strong><small>${html(record.employeeName || '—')} · ${html(formatDateTime(record.createdAt))}</small></span>
        <span class="control-submission-metrics"><b class="progress-${core.progressClass(percent)}">${percent}%</b><small>${totals.done}/${totals.total} · фото: ${photos}${missing ? ` · не хватает: ${missing}` : ''}</small></span>
      </summary>
      <div class="control-submission-progress"><span style="width:${Math.max(0, Math.min(100, percent))}%"></span></div>
      <div class="control-checklist-task-list">${(record.tasks || []).map((task,index) => renderControlTask(record,task,index)).join('') || '<p class="control-details-empty">Пункты этой записи не сохранились.</p>'}</div>
    </details>`;
  }
  function renderGroupedControl(records = state.controlRecords || []){
    if(state.controlLoading && !records.length) return `<div class="empty-control"><h3>Загружаю чек-листы и фото…</h3><p>Получаю последние записи из защищённого хранилища.</p></div>`;
    if(!records.length) return `<div class="empty-control"><h3>Пока нет отправленных чек-листов</h3><p>После отправки чек-листа запись появится здесь.</p>${state.controlError ? `<p class="control-error">${html(state.controlError)}</p>` : ''}</div>`;
    const groups = core.groupRecordsByDay(records);
    const visible = groups.slice(0, state.checklistPhotoVisibleDays);
    const dayHtml = visible.map(group => {
      const done = group.records.reduce((sum, record) => sum + recordTotals(record).done, 0);
      const total = group.records.reduce((sum, record) => sum + recordTotals(record).total, 0);
      const percent = total ? Math.round(done / total * 100) : 0;
      const date = new Date(`${group.dateKey}T12:00:00`);
      const label = Number.isNaN(date.getTime()) ? group.dateKey : date.toLocaleDateString('ru-RU', { day:'2-digit', month:'long', year:'numeric' });
      return `<details class="control-day-group" ${group === visible[0] ? 'open' : ''}>
        <summary><span><strong>${html(label)}</strong><small>${group.records.length} отчётов</small></span><span class="control-day-percent progress-${core.progressClass(percent)}">${percent}%</span></summary>
        <div class="control-day-records">${group.records.map(renderSubmission).join('')}</div>
      </details>`;
    }).join('');
    return `<div class="checklist-control-days">
      ${state.controlError ? `<p class="control-error">${html(state.controlError)}</p>` : ''}
      ${dayHtml}
      <div class="control-history-actions">
        ${groups.length > visible.length ? '<button type="button" class="small-action secondary" data-photo-more-days>Показать ещё дни</button>' : ''}
        ${state.checklistPhotoControlHasMore ? '<button type="button" class="small-action secondary" data-photo-load-older>Загрузить более старые записи</button>' : ''}
      </div>
    </div>`;
  }

  async function signedUrl(path){
    const cached = signedUrlCache.get(path);
    if(cached && cached.expiresAt > Date.now() + 30_000) return cached.url;
    const result = await supa.storage.from(PHOTO_BUCKET).createSignedUrl(path, 600);
    if(result.error) throw result.error;
    const url = result.data?.signedUrl || '';
    signedUrlCache.set(path, { url, expiresAt:Date.now() + 9 * 60 * 1000 });
    return url;
  }
  async function hydrateThumbnails(container){
    const buttons = Array.from(container.querySelectorAll('[data-thumb-path]:not([data-thumb-loaded])'));
    for(const button of buttons){
      button.dataset.thumbLoaded = 'loading';
      try{
        const url = await signedUrl(button.dataset.thumbPath);
        button.innerHTML = `<img src="${attr(url)}" alt="Фото подтверждение" loading="lazy">`;
        button.dataset.thumbLoaded = '1';
      } catch(error){
        console.warn(error);
        button.dataset.thumbLoaded = 'error';
        const placeholder = button.querySelector('[data-photo-thumb-placeholder]');
        if(placeholder) placeholder.textContent = 'Не удалось загрузить';
      }
    }
  }
  function ensureViewer(){
    let viewer = document.querySelector('[data-checklist-photo-viewer]');
    if(viewer) return viewer;
    document.body.insertAdjacentHTML('beforeend', `<div class="checklist-photo-viewer" data-checklist-photo-viewer hidden>
      <button type="button" class="checklist-photo-viewer-close" data-photo-viewer-close aria-label="Закрыть">×</button>
      <div class="checklist-photo-viewer-content"><div class="checklist-photo-viewer-loading">Загружаю фото…</div></div>
    </div>`);
    viewer = document.querySelector('[data-checklist-photo-viewer]');
    viewer.addEventListener('click', event => {
      if(event.target === viewer || event.target.closest('[data-photo-viewer-close]')) closeViewer();
    });
    return viewer;
  }
  async function openViewer(path){
    const viewer = ensureViewer();
    const content = viewer.querySelector('.checklist-photo-viewer-content');
    viewer.hidden = false;
    viewer.classList.add('open');
    document.body.classList.add('checklist-photo-viewer-open');
    content.innerHTML = '<div class="checklist-photo-viewer-loading">Загружаю фото…</div>';
    try{
      const url = await signedUrl(path);
      content.innerHTML = `<img src="${attr(url)}" alt="Фото подтверждение чек-листа">`;
    } catch(error){
      content.innerHTML = `<p class="control-error">Не удалось открыть фотографию: ${html(error.message || 'проверьте подключение.')}</p>`;
    }
  }
  function closeViewer(){
    const viewer = document.querySelector('[data-checklist-photo-viewer]');
    if(!viewer) return;
    viewer.hidden = true;
    viewer.classList.remove('open');
    document.body.classList.remove('checklist-photo-viewer-open');
  }
  async function toggleRetained(photoId, retained, button){
    if(!admin()) return;
    button.disabled = true;
    try{
      const result = await supa.rpc('set_checklist_photo_retained', { p_photo_id:photoId, p_retained:retained });
      if(result.error) throw result.error;
      (state.controlRecords || []).forEach(record => (record.photos || []).forEach(photo => {
        if(String(photo.id) === String(photoId)) photo.retained = retained;
      }));
      if(typeof refreshControl === 'function') refreshControl();
    } catch(error){
      alert('Не удалось изменить срок хранения фото: ' + (error.message || 'проверьте права доступа.'));
      button.disabled = false;
    }
  }

  function selectedRuleDoc(){
    const docs = checklistDocs();
    if(!docs.length) return null;
    if(!state.selectedPhotoRuleChecklistId || !docs.some(doc => String(doc.id) === String(state.selectedPhotoRuleChecklistId))){
      state.selectedPhotoRuleChecklistId = String(docs[0].id || '');
    }
    return checklistDoc(state.selectedPhotoRuleChecklistId) || docs[0];
  }
  function renderRulesAdmin(){
    const docs = checklistDocs();
    const doc = selectedRuleDoc();
    if(!doc) return '<div class="empty-control"><p>Чек-листы не найдены.</p></div>';
    const map = ruleMap();
    const items = core.flattenChecklist(doc);
    const activeTotal = (state.checklistPhotoRules || []).length;
    return `<details class="checklist-photo-rules-card" data-photo-rules-card>
      <summary><span><strong>Настройка фотоотчёта</strong><small>Обязательных пунктов: ${activeTotal} · фото хранятся ${RETENTION_DAYS} дней</small></span></summary>
      <div class="checklist-photo-rules-body">
        <p class="description">Выберите пункты, которые считаются выполненными только после прикрепления фотографии. Настройка применяется ко всем следующим отправкам.</p>
        ${state.checklistPhotoRulesError ? `<p class="control-error">${html(state.checklistPhotoRulesError)}</p>` : ''}
        <form data-photo-rules-form>
          <label class="photo-rule-checklist-select">Чек-лист<select name="checklistId" data-photo-rule-checklist>${docs.map(row => `<option value="${attr(row.id)}" ${String(row.id) === String(doc.id) ? 'selected' : ''}>${html(row.title)}</option>`).join('')}</select></label>
          <div class="photo-rule-list">${items.map(item => {
            const rule = map.get(core.ruleKey(doc.id, item.itemKey));
            return `<article class="photo-rule-row" data-photo-rule-row data-item-key="${attr(item.itemKey)}" data-item-text="${attr(item.itemText)}">
              <label class="photo-rule-enabled"><input type="checkbox" data-rule-enabled ${rule ? 'checked' : ''}><span><strong>${html(item.itemText)}</strong><small>${html(item.sectionTitle || '')}</small></span></label>
              <label>Количество фото<select data-rule-count><option value="1" ${(rule?.requiredCount || 1) === 1 ? 'selected' : ''}>1</option><option value="2" ${rule?.requiredCount === 2 ? 'selected' : ''}>2</option><option value="3" ${rule?.requiredCount === 3 ? 'selected' : ''}>3</option></select></label>
              <label>Подсказка<input type="text" data-rule-hint value="${attr(rule?.hint || '')}" placeholder="Что должно быть видно на фото"></label>
            </article>`;
          }).join('')}</div>
          <div class="photo-rule-actions"><button class="small-action" type="submit">Сохранить настройки</button><button class="small-action secondary" type="button" data-photo-retention-cleanup>Проверить автоудаление</button></div>
          <p class="submit-status" data-photo-rules-status aria-live="polite"></p>
        </form>
      </div>
    </details>`;
  }
  function injectRulesAdmin(){
    const folder = document.querySelector('#control-checklists');
    if(!folder || !admin()) return;
    let container = folder.querySelector('#checklist-photo-rules-admin');
    if(!container){
      container = document.createElement('div');
      container.id = 'checklist-photo-rules-admin';
      const records = folder.querySelector('#control-records');
      folder.insertBefore(container, records || null);
    }
    container.innerHTML = renderRulesAdmin();
    container.querySelector('[data-photo-rule-checklist]')?.addEventListener('change', event => {
      state.selectedPhotoRuleChecklistId = event.currentTarget.value;
      injectRulesAdmin();
    });
    container.querySelector('[data-photo-rules-form]')?.addEventListener('submit', saveRules);
    container.querySelector('[data-photo-retention-cleanup]')?.addEventListener('click', runRetentionCleanup);
  }
  async function saveRules(event){
    event.preventDefault();
    if(!admin()) return;
    const form = event.currentTarget;
    const status = form.querySelector('[data-photo-rules-status]');
    const checklistId = String(form.elements.checklistId.value || '');
    const rows = Array.from(form.querySelectorAll('[data-photo-rule-row]')).filter(row => row.querySelector('[data-rule-enabled]')?.checked).map(row => ({
      item_key:row.dataset.itemKey,
      item_text:row.dataset.itemText,
      required_count:Number(row.querySelector('[data-rule-count]')?.value || 1),
      hint:String(row.querySelector('[data-rule-hint]')?.value || '').trim()
    }));
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    status.textContent = 'Сохраняю настройки…';
    status.className = 'submit-status';
    try{
      const result = await supa.rpc('replace_checklist_photo_rules', { p_checklist_id:checklistId, p_rules:rows });
      if(result.error) throw result.error;
      await loadPhotoRules(true);
      status.textContent = 'Настройки сохранены.';
      status.className = 'submit-status success';
      enhanceChecklistCards();
      injectRulesAdmin();
    } catch(error){
      status.textContent = 'Не удалось сохранить настройки: ' + (error.message || 'проверьте подключение.');
      status.className = 'submit-status error';
    } finally {
      submit.disabled = false;
    }
  }
  async function runRetentionCleanup(event){
    if(!admin()) return;
    const button = event.currentTarget;
    const config = window.SOVREMENNIK_SUPABASE || {};
    const url = config.photoRetentionFunctionUrl || (config.url ? `${config.url}/functions/v1/checklist-photo-retention` : '');
    if(!url) return alert('Адрес функции автоудаления не настроен.');
    button.disabled = true;
    button.textContent = 'Проверяю…';
    try{
      const session = await supa.auth.getSession();
      const token = session.data?.session?.access_token;
      if(!token) throw new Error('Сессия недоступна.');
      const response = await fetch(url, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
        body:JSON.stringify({ action:'cleanup', limit:100, dry_run:false })
      });
      const data = await response.json().catch(() => ({}));
      if(!response.ok || !data.ok) throw new Error(data.error || 'Функция вернула ошибку.');
      alert(`Проверка завершена. Удалено просроченных фото: ${Number(data.deleted || 0)}.`);
      await loadPhotoControlRecords(true);
    } catch(error){
      alert('Не удалось выполнить очистку: ' + (error.message || 'проверьте Edge Function.'));
    } finally {
      button.disabled = false;
      button.textContent = 'Проверить автоудаление';
    }
  }

  function installDelegatedEvents(){
    if(delegatedEventsInstalled) return;
    delegatedEventsInstalled = true;
    document.addEventListener('click', event => {
      const view = event.target.closest('[data-photo-view]');
      if(view){ event.preventDefault(); openViewer(view.dataset.photoPath); return; }
      const retain = event.target.closest('[data-photo-retain]');
      if(retain){ event.preventDefault(); toggleRetained(retain.dataset.photoRetain, retain.dataset.nextRetained === 'true', retain); return; }
      if(event.target.closest('[data-photo-more-days]')){
        state.checklistPhotoVisibleDays += 14;
        if(typeof refreshControl === 'function') refreshControl();
        return;
      }
      if(event.target.closest('[data-photo-load-older]')){
        loadPhotoControlRecords(false);
        return;
      }
    });
    document.addEventListener('toggle', event => {
      const details = event.target.closest?.('.checklist-submission-details');
      if(details?.open) hydrateThumbnails(details);
    }, true);
    document.addEventListener('keydown', event => { if(event.key === 'Escape') closeViewer(); });
  }

  function enhanceAll(){
    enhanceQueued = false;
    installDelegatedEvents();
    enhanceChecklistCards();
    injectRulesAdmin();
    document.querySelectorAll('.checklist-submission-details[open]').forEach(hydrateThumbnails);
  }
  function queueEnhance(){
    if(enhanceQueued) return;
    enhanceQueued = true;
    requestAnimationFrame(enhanceAll);
  }

  if(normalizeRemoteRecordBeforePhotoReports){
    window.normalizeRemoteRecord = normalizeRemoteRecord = normalizePhotoRecord;
  }
  if(typeof renderControlRecordsTable === 'function'){
    window.renderControlRecordsTable = renderControlRecordsTable = function(){ return renderGroupedControl(state.controlRecords || []); };
  }
  if(submitChecklistBeforePhotoReports){
    window.submitChecklist = submitChecklist = submitPhotoChecklist;
  }
  if(loadControlRecordsBeforePhotoReports){
    window.loadControlRecords = loadControlRecords = function(){ return loadPhotoControlRecords(true); };
  }
  if(refreshControlBeforePhotoReports){
    window.refreshControl = refreshControl = function(...args){
      const result = refreshControlBeforePhotoReports.apply(this, args);
      queueMicrotask(queueEnhance);
      return result;
    };
  }
  if(setControlTabBeforePhotoReports){
    window.setControlTab = setControlTab = function(target){
      const result = setControlTabBeforePhotoReports(target);
      if(target === 'checklists') loadPhotoRules();
      queueMicrotask(queueEnhance);
      return result;
    };
  }
  if(setTopBeforePhotoReports){
    window.setTop = setTop = function(target){
      const result = setTopBeforePhotoReports(target);
      if(target === 'checklists' || target === 'control') loadPhotoRules();
      queueMicrotask(queueEnhance);
      return result;
    };
  }
  if(renderAppBeforePhotoReports){
    window.renderApp = renderApp = function(...args){
      const result = renderAppBeforePhotoReports.apply(this, args);
      queueMicrotask(queueEnhance);
      return result;
    };
  }

  window.SovremennikChecklistPhotoReports = Object.freeze({
    VERSION,
    PHOTO_BUCKET,
    RETENTION_DAYS,
    loadPhotoRules,
    enhanceChecklistCards,
    collectChecklist,
    renderGroupedControl,
    loadPhotoControlRecords,
    prepareImage,
    setRulesForTesting(rows){ state.checklistPhotoRules = rows || []; queueEnhance(); },
    queueEnhance
  });

  installDelegatedEvents();
  if(authenticated()) loadPhotoRules();
  queueEnhance();
})();

/* Современник — Control v4 shared checklist drafts, photos and one-shot submission. */
(function(global){
  'use strict';

  if(global.SovremennikControlV4Checklists) return;

  const Core = global.SovremennikControlV4Core;
  const Storage = global.SovremennikControlV4Storage;
  const Service = global.SovremennikControlV4Service;
  const Shared = global.SovremennikControlV4SharedDrafts;
  const app = typeof state !== 'undefined' ? state : global.state;
  if(!Core || !Storage || !Service || !Shared || !app) return;

  const VERSION = '2026-08-04-control-v4-checklists-2';
  const PROFILE_KEY = 'sovremennikControlV4Profile';
  const drafts = new Map();
  const timers = new Map();
  // Regression compatibility marker: locks=new Set()
  const locks = new Set();
  const urls = new Map();
  let observer = null;
  let eventsInstalled = false;

  const user = () => Service.user();
  const userId = () => String(user()?.id || '');
  const docs = () => Array.isArray(app.menu?.checklists) ? app.menu.checklists : [];
  const doc = id => docs().find(row => String(row.id) === String(id)) || null;
  const rules = () => global.SovremennikControlV4Control?.photoRules?.() || [];
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
  const ruleMap = id => new Map(rules()
    .filter(row => String(row.checklist_id) === String(id) && row.is_active !== false)
    .map(row => [String(row.item_key), {
      requiredCount:Math.max(1, Number(row.required_count || 1)),
      hint:Core.text(row.hint)
    }]));

  function cacheProfile(){
    const row = user();
    if(!row?.id) return;
    try{
      localStorage.setItem(PROFILE_KEY, JSON.stringify({
        id:row.id,
        name:row.name || '',
        role:row.role || '',
        login:row.login || '',
        cachedAt:new Date().toISOString()
      }));
    }catch(error){}
  }

  async function restoreOfflineSession(){
    if(navigator.onLine || Service.authenticated()) return Service.authenticated();
    let profile = null;
    try{ profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); }catch(error){}
    const database = Service.client();
    if(!profile?.id || !database?.auth?.getSession) return false;
    try{
      const result = await database.auth.getSession();
      const session = result?.data?.session;
      if(!session?.user?.id || String(session.user.id) !== String(profile.id)) return false;
      app.auth = { session, user:profile };
      document.body.classList.remove('login-mode');
      return true;
    }catch(error){
      console.warn('Control v4 offline session restore failed.', error);
      return false;
    }
  }

  const card = id => document.querySelector(`.doc-card[data-checklist-id="${CSS.escape(String(id))}"]`);

  function objectUrl(photo){
    if(photo?.thumbnailUrl) return photo.thumbnailUrl;
    if(photo?.fullUrl) return photo.fullUrl;
    if(!photo?.thumbnailBlob && !photo?.fullBlob) return '';
    if(urls.has(photo.id)) return urls.get(photo.id);
    const url = URL.createObjectURL(photo.thumbnailBlob || photo.fullBlob);
    urls.set(photo.id, url);
    return url;
  }
  function release(id){
    const url = urls.get(id);
    if(url) URL.revokeObjectURL(url);
    urls.delete(id);
  }

  function photoField(field, draft){
    const itemKey = field.dataset.itemKey;
    const required = Number(field.dataset.requiredCount || 1);
    const photos = (draft?.photos || []).filter(row => row.itemKey === itemKey);
    const preview = field.querySelector('[data-control-v4-photo-previews]');
    preview.innerHTML = photos.map((row, index) => {
      const src = objectUrl(row);
      const author = row.createdByName ? ` · ${escapeHtml(row.createdByName)}` : '';
      return `<article data-photo-id="${escapeHtml(row.id)}">
        ${src ? `<img src="${escapeHtml(src)}" alt="Фото ${index + 1}">` : '<span class="muted">Фото синхронизируется…</span>'}
        <button type="button" data-control-v4-photo-remove="${escapeHtml(row.id)}" aria-label="Удалить фото">×</button>
        <small>${row.remote ? `Синхронизировано${author}` : 'Ожидает синхронизации'}</small>
      </article>`;
    }).join('');
    field.querySelector('[data-control-v4-photo-status]').textContent = `${photos.length}/${required}`;
    field.querySelector('[data-control-v4-photo-pick]').disabled = photos.length >= required || draft?.pendingFinalize || draft?.sharedStatus === 'submitted';
  }

  function badge(parent, message, key){
    const panel = parent.querySelector('.submit-panel');
    if(!panel) return;
    let node = panel.querySelector(`[data-${key}]`);
    if(!node){
      node = document.createElement('span');
      node.setAttribute(`data-${key}`, '1');
      node.className = key.includes('pending') ? 'offline-pending-status' : 'offline-draft-status';
      panel.appendChild(node);
    }
    node.textContent = message || '';
    node.hidden = !message;
  }

  function checklistTemplate(checklist){
    const required = ruleMap(checklist.id);
    return Core.flattenChecklist(checklist).map(row => Core.normalizeTask({
      itemKey:row.itemKey,
      text:row.itemText,
      sectionTitle:row.sectionTitle,
      checkedByUser:false,
      checked:false,
      photoRequired:required.has(row.itemKey),
      requiredPhotoCount:required.get(row.itemKey)?.requiredCount || 0,
      photoCount:0
    }));
  }

  function setLocked(parent, locked){
    parent.querySelectorAll('.task-checkbox,.employee-name,[data-control-v4-photo-pick],[data-control-v4-photo-input]')
      .forEach(input => { input.disabled = Boolean(locked); });
    const submitButton = parent.querySelector('.submit-checklist');
    if(submitButton) submitButton.disabled = Boolean(locked || locks.has(String(parent.dataset.checklistId)));
  }

  function applyDraft(parent, draft, message = ''){
    if(!parent || !draft) return;
    const id = parent.dataset.checklistId;
    drafts.set(id, draft);
    const name = parent.querySelector('.employee-name');
    if(name && document.activeElement !== name) name.value = draft.employeeName || '';
    const taskByKey = new Map((draft.tasks || []).map(row => [row.itemKey, row]));
    parent.querySelectorAll('.task-checkbox').forEach((input, index) => {
      const key = input.dataset.controlV4ItemKey || `${id}:${index}`;
      if(taskByKey.has(key)) input.checked = Boolean(taskByKey.get(key).checkedByUser);
    });
    const locked = Boolean(draft.pendingFinalize || draft.sharedStatus === 'submitted');
    setLocked(parent, locked);
    parent.querySelectorAll('[data-control-v4-photo-field]').forEach(field => photoField(field, draft));
    if(draft.pendingFinalize){
      badge(parent, 'Сохранено · ожидает окончательной отправки', 'control-v4-pending');
      status(parent, navigator.onLine ? 'Отправка будет повторена автоматически.' : 'Нет соединения. Отправка продолжится после восстановления интернета.', 'error');
    }else if(draft.sharedStatus === 'submitted'){
      badge(parent, 'Уже отправлен с другого устройства', 'control-v4-pending');
    }else if(message){
      badge(parent, message, 'control-v4-draft-status');
    }
  }

  async function openShared(checklist, localDraft){
    const template = checklistTemplate(checklist);
    return await Shared.open({
      checklistId:String(checklist.id),
      checklistTitle:checklist.title || 'Чек-лист',
      department:Core.departmentForDoc(checklist),
      workDate:Shared.localDateKey(),
      items:template,
      localDraft
    });
  }

  async function restore(parent, force = false){
    const id = parent.dataset.checklistId;
    if(!id || (!force && parent.dataset.controlV4Restored === '1')) return;
    parent.dataset.controlV4Restored = '1';
    const checklist = doc(id);
    let draft = await Storage.getDraft(userId(), id).catch(() => null);
    if(navigator.onLine && Service.authenticated() && checklist){
      try{ draft = await openShared(checklist, draft); }
      catch(error){
        console.warn('Shared checklist restore failed; local draft remains available.', error);
        badge(parent, 'Сервер временно недоступен · сохраняю на устройстве', 'control-v4-draft-status');
      }
    }
    if(!draft){ drafts.delete(id); return; }
    if(draft.sharedStatus === 'submitted'){
      await Storage.deleteDraft(userId(), id).catch(() => {});
      applyDraft(parent, draft);
      status(parent, 'Этот чек-лист уже отправлен с другого устройства.', 'success');
      return;
    }
    draft = await Storage.saveDraft(draft).catch(() => draft);
    applyDraft(parent, draft, navigator.onLine && draft.sharedDraftId ? 'Общий черновик синхронизирован' : 'Черновик восстановлен');
  }

  function decorateCard(parent, force = false){
    if(!force && parent.dataset.controlV4Decorated === '1') return;
    const checklist = doc(parent.dataset.checklistId);
    if(!checklist) return;
    parent.dataset.controlV4Decorated = '1';
    const items = Core.flattenChecklist(checklist);
    const required = ruleMap(checklist.id);
    Array.from(parent.querySelectorAll('.task-checkbox')).forEach((input, index) => {
      const item = items[index] || { itemKey:`${checklist.id}:${index}`, itemText:input.dataset.task || 'Пункт' };
      input.dataset.controlV4ItemKey = item.itemKey;
      const label = input.closest('label');
      const old = label?.nextElementSibling?.matches?.('[data-control-v4-photo-field]') ? label.nextElementSibling : null;
      old?.remove();
      const rule = required.get(item.itemKey);
      if(!label || !rule) return;
      label.insertAdjacentHTML('afterend', `<div class="control-v4-photo-field" data-control-v4-photo-field data-item-key="${escapeHtml(item.itemKey)}" data-required-count="${rule.requiredCount}">
        <div><strong>Фото обязательно</strong><small>${escapeHtml(rule.hint || 'Сфотографируйте результат.')}</small></div>
        <div class="control-v4-draft-photos" data-control-v4-photo-previews></div>
        <div><button type="button" class="small-action secondary" data-control-v4-photo-pick>Добавить фото</button><input type="file" accept="image/*" capture="environment" ${rule.requiredCount > 1 ? 'multiple' : ''} hidden data-control-v4-photo-input><span data-control-v4-photo-status>0/${rule.requiredCount}</span></div>
      </div>`);
    });
    void restore(parent, force);
  }

  function decorateAll(force = false){
    document.querySelectorAll('#top-checklists .doc-card[data-checklist-id]').forEach(row => decorateCard(row, force));
    void pendingBadges();
  }

  function collect(parent, changedTarget = null){
    const id = parent.dataset.checklistId;
    const checklist = doc(id);
    const old = drafts.get(id) || {};
    const photos = old.photos || [];
    const counts = photos.reduce((map, row) => map.set(row.itemKey, (map.get(row.itemKey) || 0) + 1), new Map());
    const required = ruleMap(id);
    const items = Core.flattenChecklist(checklist);
    const tasks = Array.from(parent.querySelectorAll('.task-checkbox')).map((input, index) => {
      const item = items[index] || {
        itemKey:input.dataset.controlV4ItemKey || `${id}:${index}`,
        itemText:input.dataset.task || 'Пункт'
      };
      const photoRule = required.get(item.itemKey);
      const count = counts.get(item.itemKey) || 0;
      return Core.normalizeTask({
        itemKey:item.itemKey,
        text:input.dataset.task || item.itemText,
        sectionTitle:item.sectionTitle,
        checkedByUser:input.checked,
        checked:Boolean(input.checked && (!photoRule || count >= photoRule.requiredCount)),
        photoRequired:Boolean(photoRule),
        requiredPhotoCount:photoRule?.requiredCount || 0,
        photoCount:count
      });
    });
    const dirtyItemKeys = new Set(old.dirtyItemKeys || []);
    if(changedTarget?.matches?.('.task-checkbox')) dirtyItemKeys.add(changedTarget.dataset.controlV4ItemKey);
    const nameChanged = Boolean(old.dirtyEmployeeName || changedTarget?.matches?.('.employee-name'));
    return {
      ...old,
      key:Core.draftKey(userId(), id),
      submissionId:old.submissionId || Core.uuid(),
      userId:userId(),
      checklistId:id,
      checklistTitle:checklist?.title || '',
      department:old.department || Core.departmentForDoc(checklist),
      workDate:old.workDate || Shared.localDateKey(),
      employeeName:Core.text(parent.querySelector('.employee-name')?.value),
      tasks,
      photos,
      dirtyItemKeys:Array.from(dirtyItemKeys).filter(Boolean),
      dirtyEmployeeName:nameChanged,
      status:old.status || 'draft',
      createdAt:old.createdAt || new Date().toISOString(),
      updatedAt:new Date().toISOString()
    };
  }

  const hasContent = draft => Boolean(
    draft?.sharedDraftId || draft?.employeeName || draft?.tasks?.some(row => row.checkedByUser) || draft?.photos?.length
  );

  async function ensureShared(draft){
    if(draft?.sharedDraftId || !navigator.onLine || !Service.authenticated()) return draft;
    const checklist = doc(draft.checklistId);
    if(!checklist) return draft;
    return await openShared(checklist, draft);
  }

  async function save(parent, changedTarget = null){
    if(!parent || parent.dataset.controlV4SuppressSave === '1') return null;
    let draft = collect(parent, changedTarget);
    if(!hasContent(draft)){
      await Storage.deleteDraft(draft.userId, draft.checklistId);
      drafts.delete(draft.checklistId);
      badge(parent, '', 'control-v4-draft-status');
      return null;
    }
    draft = await Storage.saveDraft(draft);
    drafts.set(draft.checklistId, draft);
    badge(parent, navigator.onLine ? 'Синхронизация…' : 'Черновик сохранён на устройстве', 'control-v4-draft-status');

    if(navigator.onLine && Service.authenticated() && !draft.pendingFinalize){
      try{
        draft = await ensureShared(draft);
        draft = await Shared.sync(draft);
        draft = await Storage.saveDraft(draft);
        applyDraft(parent, draft, 'Синхронизировано на всех устройствах');
      }catch(error){
        console.warn('Shared checklist save failed; local change is retained.', error);
        draft.lastError = error?.message || 'Не удалось синхронизировать.';
        await Storage.saveDraft(draft);
        badge(parent, 'Изменение сохранено на устройстве · ожидает синхронизации', 'control-v4-draft-status');
      }
    }
    return draft;
  }

  function schedule(parent, delay = 350, changedTarget = null){
    const id = parent?.dataset.checklistId;
    if(!id) return;
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      void save(parent, changedTarget);
    }, delay));
  }

  async function addFiles(input){
    const field = input.closest('[data-control-v4-photo-field]');
    const parent = input.closest('.doc-card[data-checklist-id]');
    if(!field || !parent) return;
    let draft = drafts.get(parent.dataset.checklistId) || collect(parent);
    const required = Number(field.dataset.requiredCount || 1);
    const existing = draft.photos.filter(row => row.itemKey === field.dataset.itemKey).length;
    const files = Array.from(input.files || []).slice(0, Math.max(0, required - existing));
    input.value = '';
    const photoStatus = field.querySelector('[data-control-v4-photo-status]');
    try{
      for(const file of files){
        photoStatus.textContent = 'Обрабатываю…';
        const prepared = await Service.prepareImage(file);
        const index = draft.photos.filter(row => row.itemKey === field.dataset.itemKey).length + 1;
        draft.photos.push({ ...prepared, itemKey:field.dataset.itemKey, index, remote:false, syncStatus:'pending' });
      }
      drafts.set(parent.dataset.checklistId, draft);
      await Storage.saveDraft(draft);
      draft = await save(parent);
      photoField(field, draft || drafts.get(parent.dataset.checklistId));
    }catch(error){
      photoStatus.textContent = error.message || 'Не удалось обработать фото.';
    }
  }

  async function removePhoto(button){
    const parent = button.closest('.doc-card[data-checklist-id]');
    const field = button.closest('[data-control-v4-photo-field]');
    if(!parent || !field) return;
    let draft = drafts.get(parent.dataset.checklistId) || collect(parent);
    const id = button.dataset.controlV4PhotoRemove;
    const selected = draft.photos.find(row => String(row.id) === String(id));
    try{
      if(selected?.remote){
        draft = await Shared.removePhoto(draft, selected);
      }else{
        draft.photos = draft.photos.filter(row => {
          if(String(row.id) === String(id)){ release(id); return false; }
          return true;
        });
      }
      draft.photos.filter(row => row.itemKey === field.dataset.itemKey).forEach((row, index) => { row.index = index + 1; });
      drafts.set(parent.dataset.checklistId, draft);
      await Storage.saveDraft(draft);
      draft = await save(parent);
      photoField(field, draft || drafts.get(parent.dataset.checklistId));
    }catch(error){
      field.querySelector('[data-control-v4-photo-status]').textContent = error.message || 'Не удалось удалить фото.';
    }
  }

  function status(parent, message, kind = ''){
    const node = parent?.querySelector('.submit-status');
    if(!node) return;
    node.textContent = message || '';
    node.className = `submit-status${kind ? ` ${kind}` : ''}`;
  }

  function clear(parent, id){
    clearTimeout(timers.get(id));
    timers.delete(id);
    parent.dataset.controlV4SuppressSave = '1';
    parent.querySelectorAll('.task-checkbox').forEach(input => { input.checked = false; input.disabled = false; });
    const name = parent.querySelector('.employee-name');
    if(name){ name.value = ''; name.disabled = false; }
    (drafts.get(id)?.photos || []).forEach(row => release(row.id));
    drafts.delete(id);
    parent.querySelectorAll('[data-control-v4-photo-field]').forEach(field => photoField(field, { photos:[] }));
    badge(parent, '', 'control-v4-draft-status');
    badge(parent, '', 'control-v4-pending');
    setLocked(parent, false);
    setTimeout(() => { parent.dataset.controlV4SuppressSave = '0'; }, 500);
  }

  function incomplete(summary){
    const rows = [`Чек-лист заполнен на ${summary.percent}% (${summary.done}/${summary.total}).`];
    if(summary.total - summary.done) rows.push(`Не выполнено пунктов: ${summary.total - summary.done}.`);
    if(summary.missingPhotos) rows.push(`Не хватает обязательных фотографий: ${summary.missingPhotos}.`);
    rows.push('', 'Отправить неполный чек-лист?');
    return rows.join('\n');
  }

  async function completeSubmission(parent, id, draft, finalized){
    await Storage.deleteDraft(draft.userId, draft.checklistId).catch(() => {});
    clear(parent, id);
    status(parent, 'Чек-лист отправлен. Изменения синхронизированы.', 'success');
    global.dispatchEvent(new CustomEvent('sov:control-v4-submitted', { detail:{ item:draft, finalized } }));
    setTimeout(() => status(parent, ''), 3000);
  }

  async function submit(id){
    // Shared drafts use Storage.saveDraft for durability instead of the legacy Storage.saveQueue(item) path.
    const parent = card(id);
    const checklist = doc(id);
    if(!parent || !checklist || locks.has(String(id))) return;
    const employee = Core.text(parent.querySelector('.employee-name')?.value);
    if(!employee){
      status(parent, 'Введите имя сотрудника перед отправкой.', 'error');
      parent.querySelector('.employee-name')?.focus();
      return;
    }
    locks.add(String(id));
    const button = parent.querySelector('.submit-checklist');
    if(button) button.disabled = true;
    try{
      let draft = await save(parent, parent.querySelector('.employee-name')) || collect(parent);
      try{ draft = await ensureShared(draft); }
      catch(error){ console.warn('Shared draft will be created during automatic retry.', error); }
      draft.employeeName = employee;
      const summary = Core.summarize(draft.tasks);
      if(summary.incomplete && !global.confirm(incomplete(summary))) return;

      draft.pendingFinalize = true;
      draft.finalizeEmployeeName = employee;
      draft.dirtyEmployeeName = true;
      draft.status = 'pending';
      draft.lastError = '';
      draft = await Storage.saveDraft(draft);
      drafts.set(id, draft);
      applyDraft(parent, draft);
      await updateIndicator();

      if(navigator.onLine && draft.sharedDraftId){
        status(parent, 'Завершаю общий чек-лист…');
        try{
          const finalized = await Shared.finalize(draft, employee);
          await completeSubmission(parent, id, draft, finalized);
        }catch(error){
          draft.lastError = error?.message || 'Не удалось отправить.';
          draft.status = 'failed';
          await Storage.saveDraft(draft);
          status(parent, 'Чек-лист сохранён · отправка будет повторена автоматически.', 'error');
          void backgroundSync();
        }
      }else{
        status(parent, 'Нет соединения. Чек-лист сохранён · отправка продолжится автоматически.', 'error');
        void backgroundSync();
      }
      await updateIndicator();
    }catch(error){
      console.error('Control v4 shared submission failed.', error);
      status(parent, `Не удалось сохранить отправку: ${error.message || 'повторите попытку.'}`, 'error');
    }finally{
      locks.delete(String(id));
      if(button?.isConnected && !drafts.get(String(id))?.pendingFinalize) button.disabled = false;
    }
  }

  function indicator(){
    let node = document.getElementById('offline-connection-indicator');
    if(node && !node.dataset.controlV4Indicator) node.remove();
    node = document.getElementById('offline-connection-indicator');
    if(node) return node;
    node = document.createElement('button');
    node.id = 'offline-connection-indicator';
    node.type = 'button';
    node.className = 'connection-indicator';
    node.dataset.controlV4Indicator = '1';
    node.setAttribute('aria-live', 'polite');
    document.body.appendChild(node);
    return node;
  }

  async function sharedPendingRows(){
    return (await Storage.draftsForUser(userId())).filter(row => row.pendingFinalize);
  }
  const pendingCount = async () => (await Storage.queueForUser(userId())).length + (await sharedPendingRows()).length;

  async function pendingBadges(){
    const queue = await Storage.queueForUser(userId()).catch(() => []);
    const shared = await sharedPendingRows().catch(() => []);
    const rows = [...queue, ...shared];
    const counts = rows.reduce((map, row) => map.set(row.checklistId, (map.get(row.checklistId) || 0) + 1), new Map());
    document.querySelectorAll('.doc-card[data-checklist-id]').forEach(parent => {
      const count = counts.get(parent.dataset.checklistId) || 0;
      badge(parent, count ? (count === 1 ? 'Ожидает отправки' : `Ожидает отправки: ${count}`) : '', 'control-v4-pending');
    });
  }

  async function updateIndicator(){
    const node = indicator();
    const count = await pendingCount().catch(() => 0);
    const online = navigator.onLine;
    const syncing = Service.isSyncing() || Shared.isSyncingPending();
    node.textContent = !online
      ? (count ? `Нет соединения · ожидает: ${count}` : 'Нет соединения')
      : syncing
        ? `Синхронизация · ${count}`
        : count
          ? `Ожидает отправки: ${count}`
          : 'Онлайн · чек-листы синхронизируются';
    node.classList.toggle('is-online', online && !syncing && !count);
    node.classList.toggle('is-offline', !online);
    node.classList.toggle('is-pending', syncing || count > 0);
    await pendingBadges();
  }

  async function sync(){
    await Promise.allSettled([Service.syncPending(), Shared.syncPendingFinalizations()]);
    await updateIndicator();
  }

  async function backgroundSync(){
    try{
      const registration = await navigator.serviceWorker?.ready;
      if(registration?.sync) await registration.sync.register('sovremennik-checklist-sync');
    }catch(error){}
  }

  async function handleRemote(event){
    const id = String(event.detail?.checklistId || '');
    const remote = event.detail?.draft;
    const parent = card(id);
    if(!id || !remote || !parent) return;
    const local = drafts.get(id) || await Storage.getDraft(userId(), id).catch(() => null);
    const draft = Shared.mergeLocal(remote, local);
    if(draft.sharedStatus === 'submitted'){
      await Storage.deleteDraft(userId(), id).catch(() => {});
      clear(parent, id);
      status(parent, 'Чек-лист отправлен с другого устройства.', 'success');
      return;
    }
    await Storage.saveDraft(draft);
    applyDraft(parent, draft, 'Получены изменения с другого устройства');
  }

  function handlePresence(event){
    const id = String(event.detail?.checklistId || '');
    const parent = card(id);
    if(!parent) return;
    const people = event.detail?.people || [];
    const others = people.filter(row => row.deviceId && row.deviceId !== localStorage.getItem('sovremennikControlV4DeviceId'));
    badge(parent, others.length ? `Сейчас заполняют ещё устройств: ${others.length}` : '', 'control-v4-presence');
  }

  function installEvents(){
    if(eventsInstalled) return;
    eventsInstalled = true;
    document.addEventListener('click', event => {
      const pick = event.target.closest?.('#top-checklists [data-control-v4-photo-pick]');
      if(pick){
        event.preventDefault();
        pick.closest('[data-control-v4-photo-field]')?.querySelector('[data-control-v4-photo-input]')?.click();
        return;
      }
      const remove = event.target.closest?.('#top-checklists [data-control-v4-photo-remove]');
      if(remove){ event.preventDefault(); void removePhoto(remove); return; }
      const connection = event.target.closest?.('#offline-connection-indicator[data-control-v4-indicator]');
      if(connection){ event.preventDefault(); void sync(); }
    });
    document.addEventListener('input', event => {
      const parent = event.target.closest?.('.doc-card[data-checklist-id]');
      if(parent) schedule(parent, 350, event.target);
    });
    document.addEventListener('change', event => {
      const input = event.target.closest?.('[data-control-v4-photo-input]');
      if(input){ void addFiles(input); return; }
      const parent = event.target.closest?.('.doc-card[data-checklist-id]');
      if(parent) schedule(parent, 100, event.target);
    });
    global.addEventListener('online', () => { void updateIndicator(); void sync(); });
    global.addEventListener('offline', () => void updateIndicator());
    global.addEventListener('sov:control-v4-sync-state', () => void updateIndicator());
    global.addEventListener('sov:control-v4-submitted', () => void updateIndicator());
    global.addEventListener('sov:control-v4-shared-submitted', event => {
      const id = String(event.detail?.checklistId || '');
      const parent = card(id);
      if(parent){ clear(parent, id); status(parent, 'Чек-лист отправлен после восстановления соединения.', 'success'); }
      void updateIndicator();
    });
    global.addEventListener('sov:control-v4-shared-remote', event => void handleRemote(event));
    global.addEventListener('sov:control-v4-shared-presence', handlePresence);
    global.addEventListener('sov:control-v4-rules', () => decorateAll(true));
    navigator.serviceWorker?.addEventListener('message', event => {
      if(event.data?.type === 'SOVREMENNIK_SYNC_PENDING') void sync();
    });
  }

  function startObserver(){
    if(observer) return;
    const root = document.querySelector('#panels') || document.body;
    observer = new MutationObserver(records => {
      if(records.some(record => Array.from(record.addedNodes || []).some(node =>
        node.nodeType === 1 && (node.matches?.('#top-checklists,.doc-card') || node.querySelector?.('#top-checklists,.doc-card'))
      ))) queueMicrotask(() => decorateAll());
    });
    observer.observe(root, { childList:true, subtree:true });
  }

  function mount(){
    cacheProfile();
    installEvents();
    startObserver();
    decorateAll(true);
    void updateIndicator();
    if(navigator.onLine) void sync();
  }

  global.SovremennikControlV4Checklists = Object.freeze({
    VERSION,
    mount,
    submit,
    decorateAll,
    syncPending:sync,
    pendingCount,
    restoreOfflineSession,
    cacheProfile
  });
})(window);

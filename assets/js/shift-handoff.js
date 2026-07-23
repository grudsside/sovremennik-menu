/* Современник — shift handoff for baristas and administrators in the closing checklist. */
(function(){
  'use strict';

  const core = window.SovremennikShiftHandoffCore;
  if(!core || typeof state === 'undefined') return;

  const VERSION = '2026-07-23-shift-handoff-preview-5';
  const CLOSING_CHECKLIST_ID = 'closing-checklist';
  const PHOTO_BUCKET = 'shift-handoff-photos';
  const DRAFT_KEY = 'sovremennikShiftHandoffDraftV2';
  const LEGACY_DRAFT_KEY = 'sovremennikShiftHandoffDraftV1';
  const NO_REMARKS_NOTE = 'Замечаний нет';
  const MAX_PHOTOS = 3;
  const MAX_RAW_BYTES = 25 * 1024 * 1024;
  const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
  const ALLOWED_ROLES = new Set(['admin', 'barista']);
  const originalSubmitChecklist = typeof submitChecklist === 'function'
    ? submitChecklist
    : (typeof window.submitChecklist === 'function' ? window.submitChecklist : null);

  function emptyDraft(){
    return { unfinished:'', outOfStock:'', equipmentIssues:'', nextShiftControl:'', notes:'' };
  }

  function readPersistedDraft(){
    try{
      const parsed = JSON.parse(localStorage.getItem(DRAFT_KEY) || localStorage.getItem(LEGACY_DRAFT_KEY) || '{}');
      return {
        mode:String(parsed.mode || ''),
        draft:{
          unfinished:String(parsed.unfinished || ''),
          outOfStock:String(parsed.outOfStock || ''),
          equipmentIssues:String(parsed.equipmentIssues || ''),
          nextShiftControl:String(parsed.nextShiftControl || ''),
          notes:String(parsed.notes || '')
        }
      };
    } catch(error){
      return { mode:'', draft:emptyDraft() };
    }
  }

  const persisted = readPersistedDraft();
  const model = {
    rows:[],
    loading:false,
    loaded:false,
    error:'',
    checklistOpen:false,
    submitting:false,
    selectedPhotos:[],
    mode:persisted.mode,
    draft:persisted.draft
  };

  let loadPromise = null;
  let mountQueued = false;
  let eventsBound = false;

  function html(value){
    if(typeof esc === 'function') return esc(value);
    return String(value ?? '').replace(/[&<>\"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char]));
  }

  function attr(value){ return html(value).replace(/'/g, '&#39;'); }
  function current(){ return typeof currentUser === 'function' ? currentUser() : null; }
  function authenticated(){ return typeof isAuthenticated === 'function' ? isAuthenticated() : Boolean(current()?.id); }

  function currentRole(){
    const role = String(current()?.role || '').trim().toLowerCase();
    if(typeof normalizeRole === 'function') return normalizeRole(role);
    return ({
      'администратор':'admin',
      'админ':'admin',
      'бариста':'barista',
      'официант':'waiter'
    })[role] || role;
  }

  function isShiftHandoffUser(){
    return authenticated() && ALLOWED_ROLES.has(currentRole());
  }

  function uuid(){
    if(typeof makeUuidV26 === 'function') return makeUuidV26();
    if(window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `handoff-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function saveDraft(){
    try{
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ mode:model.mode, ...model.draft }));
      localStorage.removeItem(LEGACY_DRAFT_KEY);
    } catch(error){
      console.warn('Shift handoff draft was not saved', error);
    }
  }

  function clearSelectedPhotos(){
    model.selectedPhotos.forEach(photo => {
      if(photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    });
    model.selectedPhotos = [];
  }

  function clearDraft(){
    model.mode = '';
    model.draft = emptyDraft();
    clearSelectedPhotos();
    try{
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(LEGACY_DRAFT_KEY);
    } catch(error){}
  }

  function imageElementFromFile(file){
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Формат фотографии не поддерживается браузером.'));
      };
      image.src = url;
    });
  }

  function canvasBlob(image, maxSide, quality){
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const ratio = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * ratio));
    canvas.height = Math.max(1, Math.round(sourceHeight * ratio));
    const context = canvas.getContext('2d', { alpha:false });
    if(!context) throw new Error('Браузер не поддерживает обработку фотографии.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Не удалось подготовить фотографию.')),
      'image/jpeg',
      quality
    ));
  }

  async function preparePhoto(file){
    if(!file?.type?.startsWith('image/')) throw new Error('Можно прикрепить только фотографию.');
    if(file.size > MAX_RAW_BYTES) throw new Error('Исходное фото слишком большое. Максимум — 25 МБ.');
    const image = await imageElementFromFile(file);
    let blob = await canvasBlob(image, 1600, 0.78);
    if(blob.size > MAX_UPLOAD_BYTES) blob = await canvasBlob(image, 1400, 0.64);
    if(blob.size > MAX_UPLOAD_BYTES) throw new Error('Не удалось уменьшить фото до допустимого размера.');
    return { id:uuid(), blob, previewUrl:URL.createObjectURL(blob), name:file.name || 'photo.jpg' };
  }

  function normalizedDraft(){ return core.normalizeDraft(model.draft); }
  function draftHasContent(){ return core.hasContent(normalizedDraft()); }

  function draftItemCount(){
    return core.sectionRows(normalizedDraft())
      .reduce((total, section) => total + section.items.length, 0);
  }

  function decisionReady(){
    return model.mode === 'empty' || (model.mode === 'details' && draftHasContent());
  }

  function decisionLabel(){
    if(model.mode === 'empty') return NO_REMARKS_NOTE;
    if(model.mode === 'details' && draftHasContent()){
      const count = draftItemCount();
      return `Заполнено · ${count} ${count === 1 ? 'пункт' : count < 5 ? 'пункта' : 'пунктов'}`;
    }
    if(model.mode === 'details') return 'Нужно заполнить';
    return 'Не заполнено';
  }

  function decisionClass(){
    if(decisionReady()) return 'ready';
    if(model.mode === 'details') return 'attention';
    return 'empty';
  }

  function closingChecklistDoc(){
    const docs = state.menu?.checklists || [];
    return docs.find(doc => String(doc?.id || '') === CLOSING_CHECKLIST_ID)
      || docs.find(doc => String(doc?.title || '').trim().toLowerCase() === 'чек-лист закрытия')
      || null;
  }

  function closingChecklistCard(){
    const doc = closingChecklistDoc();
    if(!doc) return null;
    const card = Array.from(document.querySelectorAll('.doc-card'))
      .find(element => String(element.dataset.checklistId || '') === String(doc.id || ''));
    return card ? { doc, card } : null;
  }

  function isClosingChecklistId(docId){
    const doc = closingChecklistDoc();
    return Boolean(doc && String(doc.id || '') === String(docId || ''));
  }

  function rowUserAcknowledgement(row){
    const userId = current()?.id;
    return (row.acknowledgements || [])
      .find(item => String(item.employee_id || '') === String(userId || '')) || null;
  }

  function isActiveRow(row){
    const visibleUntil = row.visible_until || row.visibleUntil;
    if(!visibleUntil) return true;
    const timestamp = new Date(visibleUntil).getTime();
    return Number.isNaN(timestamp) || timestamp > Date.now();
  }

  function currentHandoff(){
    if(!isShiftHandoffUser()) return null;
    return model.rows
      .filter(isActiveRow)
      .sort((a,b) => new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0))[0]
      || null;
  }

  function authorLabel(row){
    return [
      row.created_by_name || 'Сотрудник',
      row.created_by_role
        ? (typeof roleLabel === 'function' ? roleLabel(row.created_by_role) : row.created_by_role)
        : ''
    ].filter(Boolean).join(' · ');
  }

  function renderSections(row){
    return core.sectionRows(row).map(section => `<section class="shift-handoff-section">
      <h4>${html(section.label)}</h4>
      <ul>${section.items.map(item => `<li>${html(item)}</li>`).join('')}</ul>
    </section>`).join('');
  }

  function renderPhotos(row){
    if(!row.photos?.length) return '';
    return `<div class="shift-handoff-photos" aria-label="Фотографии к передаче смены">${row.photos.map((photo, index) => {
      const url = photo.signedUrl || '';
      return url
        ? `<a href="${attr(url)}" target="_blank" rel="noopener" class="shift-handoff-photo"><img src="${attr(url)}" alt="Фото к передаче смены ${index + 1}"></a>`
        : '';
    }).join('')}</div>`;
  }

  function isNoRemarksHandoff(row){
    return core.sectionRows(row).length === 0
      && String(row.notes || '').trim().toLowerCase() === NO_REMARKS_NOTE.toLowerCase();
  }

  function acknowledgementControl(row){
    const own = String(row.created_by || row.createdBy || '') === String(current()?.id || '');
    if(own) return '<span class="shift-handoff-read-state">Отправлено</span>';
    const acknowledgement = rowUserAcknowledgement(row);
    if(acknowledgement){
      return `<span class="shift-handoff-read-state">Принято · ${html(core.formatDateTime(acknowledgement.acknowledged_at))}</span>`;
    }
    return `<button type="button" class="small-action" data-shift-handoff-accept="${attr(row.id)}">Принято</button>`;
  }

  function homeCardHtml(row){
    if(model.loading && !model.loaded){
      return `<section class="v3-dashboard-card shift-handoff-incoming shift-handoff-home-empty" data-shift-handoff-incoming data-version="${VERSION}">
        <div><p class="section-kicker">Передача смены</p><h2>Загружаю передачу…</h2></div>
      </section>`;
    }

    if(!row){
      return `<section class="v3-dashboard-card shift-handoff-incoming shift-handoff-home-empty" data-shift-handoff-incoming data-version="${VERSION}">
        <div><p class="section-kicker">Передача смены</p><h2>Передача ещё не отправлена</h2><p class="description">Последняя передача появится здесь сразу после отправки чек-листа закрытия.</p></div>
        ${model.error ? `<p class="shift-handoff-error">${html(model.error)}</p>` : ''}
      </section>`;
    }

    const own = String(row.created_by || row.createdBy || '') === String(current()?.id || '');
    const badge = own ? 'Текущая передача смены' : 'От предыдущей смены';
    const noRemarks = isNoRemarksHandoff(row);
    const sections = noRemarks
      ? `<section class="shift-handoff-section shift-handoff-no-remarks"><h4>Статус</h4><p>${NO_REMARKS_NOTE}</p></section>`
      : `<div class="shift-handoff-sections">${renderSections(row)}</div>`;

    return `<section class="v3-dashboard-card shift-handoff-incoming" data-shift-handoff-incoming data-version="${VERSION}">
      <div class="shift-handoff-incoming-head">
        <div><span class="shift-handoff-badge">${html(badge)}</span><h2>${html(authorLabel(row))}</h2><p>${html(core.formatDateTime(row.created_at))}</p></div>
        ${acknowledgementControl(row)}
      </div>
      ${sections}
      ${row.notes && !noRemarks ? `<section class="shift-handoff-section shift-handoff-note"><h4>Дополнительно</h4><p>${html(row.notes)}</p></section>` : ''}
      ${renderPhotos(row)}
    </section>`;
  }

  function renderPhotoDrafts(){
    if(!model.selectedPhotos.length) return '';
    return `<div class="shift-handoff-photo-drafts">${model.selectedPhotos.map((photo, index) => `<article>
      <img src="${attr(photo.previewUrl)}" alt="Выбранное фото ${index + 1}">
      <button type="button" data-shift-photo-remove="${attr(photo.id)}" aria-label="Удалить фото">×</button>
    </article>`).join('')}</div>`;
  }

  function textarea(name, label, placeholder){
    return `<label class="shift-handoff-field"><span>${html(label)}</span><textarea name="${attr(name)}" rows="2" placeholder="${attr(placeholder)}">${html(model.draft[name] || '')}</textarea></label>`;
  }

  function checklistStepHtml(){
    const ready = decisionReady();
    const taskText = model.mode === 'empty'
      ? `Передача смены: ${NO_REMARKS_NOTE.toLowerCase()}`
      : ready
        ? `Передача смены: заполнено (${draftItemCount()} пунктов)`
        : 'Передача смены: не заполнено';

    return `<details class="shift-handoff-checklist-step" data-shift-handoff-checklist ${model.checklistOpen ? 'open' : ''}>
      <summary>
        <span class="shift-handoff-step-icon" aria-hidden="true">↗</span>
        <span class="shift-handoff-step-copy"><strong>Передача смены</strong><small>Финальный шаг чек-листа закрытия</small></span>
        <span class="shift-handoff-step-status ${decisionClass()}">${html(decisionLabel())}</span>
      </summary>
      <div class="shift-handoff-checklist-body">
        <p class="shift-handoff-checklist-help">Выберите «Замечаний нет» или добавьте важную информацию для следующей смены. Передача появится на главной сразу после отправки чек-листа закрытия.</p>
        <div class="shift-handoff-mode-row" role="group" aria-label="Статус передачи смены">
          <button type="button" class="${model.mode === 'empty' ? 'active' : ''}" data-shift-handoff-mode="empty">Замечаний нет</button>
          <button type="button" class="${model.mode === 'details' ? 'active' : ''}" data-shift-handoff-mode="details">Есть информация</button>
        </div>
        ${model.mode === 'details' ? `<div class="shift-handoff-inline-form" data-shift-handoff-form>
          <div class="shift-handoff-form-grid">
            ${textarea('unfinished','Осталось незавершённым','Например: не разобрана поставка')}
            ${textarea('outOfStock','Закончились позиции','Например: овсяное молоко')}
            ${textarea('equipmentIssues','Проблемы с оборудованием','Например: правый гриндер выдаёт ошибку')}
            ${textarea('nextShiftControl','Проконтролировать следующей смене','Например: проверить поставку сиропов')}
          </div>
          ${textarea('notes','Дополнительный комментарий','Короткое пояснение при необходимости')}
          <div class="shift-handoff-photo-picker">
            <div><strong>Фотографии</strong><span>До ${MAX_PHOTOS} фото, только если они помогают понять проблему.</span></div>
            <button type="button" class="small-action secondary" data-shift-photo-pick ${model.selectedPhotos.length >= MAX_PHOTOS ? 'disabled' : ''}>Добавить фото</button>
            <input type="file" accept="image/*" capture="environment" multiple hidden data-shift-photo-input>
          </div>
          ${renderPhotoDrafts()}
        </div>` : ''}
        <input class="task-checkbox shift-handoff-checklist-task" type="checkbox" hidden data-task="${attr(taskText)}" ${ready ? 'checked' : ''}>
        <p class="shift-handoff-draft-note">${model.mode === 'details' ? 'Текст автоматически сохраняется на этом устройстве.' : 'Этот выбор обязателен перед отправкой чек-листа.'}</p>
        <p class="submit-status" data-shift-handoff-status aria-live="polite"></p>
      </div>
    </details>`;
  }

  function cleanupUi(){
    document.querySelectorAll('[data-shift-handoff-root]').forEach(element => element.remove());
    document.querySelectorAll('[data-shift-handoff-incoming]').forEach(element => element.remove());
    document.querySelectorAll('[data-shift-handoff-checklist]').forEach(element => element.remove());
  }

  function removeMisplacedChecklistSteps(){
    document.querySelectorAll('[data-shift-handoff-checklist]').forEach(element => {
      const card = element.closest('.doc-card');
      if(String(card?.dataset.checklistId || '') !== CLOSING_CHECKLIST_ID) element.remove();
    });
  }

  function mountHome(){
    const home = document.querySelector('#top-home');
    if(!home) return;
    const row = currentHandoff();
    const root = home.querySelector('[data-shift-handoff-incoming]');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = homeCardHtml(row);
    const next = wrapper.firstElementChild;
    if(root) root.replaceWith(next);
    else {
      const summary = home.querySelector('.v3-summary-card');
      if(summary) summary.insertAdjacentElement('beforebegin', next);
      else home.prepend(next);
    }
  }

  function mountChecklistStep(){
    removeMisplacedChecklistSteps();
    const pair = closingChecklistCard();
    if(!pair) return;
    const details = pair.card.querySelector('.doc-details');
    const submitPanel = pair.card.querySelector('.submit-panel');
    if(!details || !submitPanel) return;
    const existing = details.querySelector('[data-shift-handoff-checklist]');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = checklistStepHtml();
    const next = wrapper.firstElementChild;
    if(existing) existing.replaceWith(next);
    else submitPanel.insertAdjacentElement('beforebegin', next);
  }

  function mount(){
    mountQueued = false;
    document.querySelectorAll('[data-shift-handoff-root]').forEach(element => element.remove());
    if(!isShiftHandoffUser()){
      cleanupUi();
      return;
    }
    mountHome();
    mountChecklistStep();
    bindEvents();
    if(!model.loaded && !model.loading) loadRows();
  }

  function queueMount(){
    if(mountQueued) return;
    mountQueued = true;
    queueMicrotask(mount);
  }

  function setStatus(message, kind = ''){
    const status = document.querySelector('[data-shift-handoff-status]');
    if(!status) return;
    status.textContent = message || '';
    status.className = `submit-status${kind ? ` ${kind}` : ''}`;
  }

  function revealChecklistStep(message){
    model.checklistOpen = true;
    queueMount();
    queueMicrotask(() => {
      const root = document.querySelector('[data-shift-handoff-checklist]');
      if(root){
        root.open = true;
        root.scrollIntoView({ behavior:'smooth', block:'center' });
      }
      setStatus(message, 'error');
    });
  }

  async function signedUrl(path){
    const result = await supa.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600);
    return result.error ? '' : (result.data?.signedUrl || '');
  }

  async function loadRows(force = false){
    if(!isShiftHandoffUser() || typeof supa === 'undefined') return;
    if(loadPromise && !force) return loadPromise;

    model.loading = true;
    model.error = '';
    queueMount();

    loadPromise = (async () => {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const handoffs = await supa.from('shift_handoffs')
        .select('*')
        .gte('created_at', since)
        .order('created_at', { ascending:false })
        .limit(30);
      if(handoffs.error) throw handoffs.error;

      const rows = handoffs.data || [];
      const ids = rows.map(row => row.id);
      let acknowledgements = [];
      let photos = [];

      if(ids.length){
        const [acksResult, photosResult] = await Promise.all([
          supa.from('shift_handoff_acknowledgements')
            .select('handoff_id,employee_id,employee_name,acknowledged_at')
            .in('handoff_id', ids)
            .order('acknowledged_at', { ascending:true }),
          supa.from('shift_handoff_photos')
            .select('id,handoff_id,storage_path,created_at')
            .in('handoff_id', ids)
            .order('created_at', { ascending:true })
        ]);
        if(acksResult.error) throw acksResult.error;
        if(photosResult.error) throw photosResult.error;
        acknowledgements = acksResult.data || [];
        photos = photosResult.data || [];
      }

      const photosWithUrls = await Promise.all(photos.map(async photo => ({
        ...photo,
        signedUrl:await signedUrl(photo.storage_path)
      })));

      model.rows = rows.map(row => core.fromDatabaseRow({
        ...row,
        acknowledgements:acknowledgements.filter(item => item.handoff_id === row.id),
        photos:photosWithUrls.filter(item => item.handoff_id === row.id)
      }));
      model.loaded = true;
    })().catch(error => {
      console.error('Shift handoff loading failed', error);
      model.error = 'Передача смены временно недоступна.';
    }).finally(() => {
      model.loading = false;
      loadPromise = null;
      queueMount();
    });

    return loadPromise;
  }

  async function uploadPhotos(handoffId){
    const user = current();
    for(let index = 0; index < model.selectedPhotos.length; index += 1){
      const photo = model.selectedPhotos[index];
      setStatus(`Загружаю фото ${index + 1} из ${model.selectedPhotos.length}…`);
      const path = core.buildStoragePath(user.id, handoffId, photo.id);
      const upload = await supa.storage.from(PHOTO_BUCKET).upload(path, photo.blob, {
        contentType:'image/jpeg',
        cacheControl:'3600',
        upsert:false
      });
      if(upload.error) throw upload.error;

      const metadata = await supa.from('shift_handoff_photos').insert({
        handoff_id:handoffId,
        storage_path:upload.data.path,
        mime_type:'image/jpeg',
        file_size:photo.blob.size,
        created_by:user.id
      });
      if(metadata.error) throw metadata.error;
    }
  }

  async function createHandoffFromDraft(){
    if(!isShiftHandoffUser()) throw new Error('Передача смены доступна бариста и администратору.');

    const normalized = normalizedDraft();
    const row = core.toDatabaseRow(normalized);
    const handoffId = uuid();
    const noRemarks = model.mode === 'empty';
    const result = await supa.rpc('create_shift_handoff', {
      p_id:handoffId,
      p_unfinished:noRemarks ? [] : row.unfinished,
      p_out_of_stock:noRemarks ? [] : row.out_of_stock,
      p_equipment_issues:noRemarks ? [] : row.equipment_issues,
      p_next_shift_control:noRemarks ? [] : row.next_shift_control,
      p_notes:noRemarks ? NO_REMARKS_NOTE : row.notes
    });
    if(result.error) throw result.error;
    if(!noRemarks && model.selectedPhotos.length) await uploadPhotos(handoffId);
    window.dispatchEvent(new CustomEvent('sovremennik:shift-handoff-created', { detail:{ handoffId } }));
    return handoffId;
  }

  async function submitClosingChecklist(docId, button){
    if(!isShiftHandoffUser() || model.submitting || typeof originalSubmitChecklist !== 'function') return;

    if(!decisionReady()){
      revealChecklistStep(model.mode === 'details'
        ? 'Добавьте хотя бы один пункт или выберите «Замечаний нет».'
        : 'Перед отправкой выберите статус передачи смены.');
      return;
    }

    if(!navigator.onLine){
      saveDraft();
      revealChecklistStep('Нет подключения. Черновик сохранён — отправьте чек-лист после восстановления связи.');
      return;
    }

    model.submitting = true;
    if(button) button.disabled = true;

    try{
      setStatus('Сохраняю передачу смены…');
      await createHandoffFromDraft();
      setStatus('Отправляю чек-лист закрытия…');
      await originalSubmitChecklist(docId);
      clearDraft();
      model.checklistOpen = false;
      await loadRows(true);
      queueMount();
    } catch(error){
      console.error('Closing checklist with shift handoff failed', error);
      saveDraft();
      revealChecklistStep(`Не удалось отправить: ${error.message || 'проверьте подключение и повторите попытку.'}`);
    } finally {
      model.submitting = false;
      if(button) button.disabled = false;
      queueMount();
    }
  }

  async function acknowledge(id, button){
    if(!isShiftHandoffUser() || !id || button?.disabled) return;
    if(button) button.disabled = true;
    try{
      const result = await supa.rpc('acknowledge_shift_handoff', { p_handoff_id:id });
      if(result.error) throw result.error;
      await loadRows(true);
    } catch(error){
      console.error('Shift handoff acknowledgement failed', error);
      alert('Не удалось сохранить подтверждение. Проверьте подключение и повторите попытку.');
      if(button) button.disabled = false;
    }
  }

  async function pickPhotos(input){
    const available = Math.max(0, MAX_PHOTOS - model.selectedPhotos.length);
    const files = Array.from(input.files || []).slice(0, available);
    input.value = '';
    if(!files.length) return;
    setStatus('Подготавливаю фотографии…');
    try{
      for(const file of files) model.selectedPhotos.push(await preparePhoto(file));
      queueMount();
    } catch(error){
      setStatus(error.message || 'Не удалось подготовить фотографию.', 'error');
    }
  }

  function bindEvents(){
    if(eventsBound) return;
    eventsBound = true;

    document.addEventListener('click', event => {
      if(!isShiftHandoffUser()) return;

      const submit = event.target.closest('.submit-checklist');
      if(submit && isClosingChecklistId(submit.dataset.checklistId)){
        event.preventDefault();
        event.stopImmediatePropagation();
        submitClosingChecklist(submit.dataset.checklistId, submit);
        return;
      }

      const accept = event.target.closest('[data-shift-handoff-accept]');
      if(accept){
        event.preventDefault();
        acknowledge(accept.dataset.shiftHandoffAccept, accept);
        return;
      }

      const mode = event.target.closest('[data-shift-handoff-mode]');
      if(mode){
        event.preventDefault();
        model.mode = mode.dataset.shiftHandoffMode;
        model.checklistOpen = true;
        saveDraft();
        queueMount();
        return;
      }

      const pick = event.target.closest('[data-shift-photo-pick]');
      if(pick){
        event.preventDefault();
        document.querySelector('[data-shift-photo-input]')?.click();
        return;
      }

      const remove = event.target.closest('[data-shift-photo-remove]');
      if(remove){
        event.preventDefault();
        const index = model.selectedPhotos.findIndex(photo => photo.id === remove.dataset.shiftPhotoRemove);
        if(index >= 0){
          const [photo] = model.selectedPhotos.splice(index, 1);
          if(photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
          queueMount();
        }
      }
    }, true);

    document.addEventListener('toggle', event => {
      if(event.target.matches?.('[data-shift-handoff-checklist]')){
        model.checklistOpen = event.target.open;
      }
    }, true);

    document.addEventListener('input', event => {
      if(!isShiftHandoffUser()) return;
      const form = event.target.closest('[data-shift-handoff-form]');
      if(!form || !event.target.name) return;
      if(Object.prototype.hasOwnProperty.call(model.draft, event.target.name)){
        model.mode = 'details';
        model.draft[event.target.name] = event.target.value;
        saveDraft();
      }
    });

    document.addEventListener('change', event => {
      if(isShiftHandoffUser() && event.target.matches('[data-shift-photo-input]')){
        pickPhotos(event.target);
      }
    });

    window.addEventListener('online', () => {
      if(isShiftHandoffUser()) loadRows(true);
    });

    window.addEventListener('sovremennik:connection-changed', () => {
      if(navigator.onLine && isShiftHandoffUser()) loadRows(true);
    });
  }

  const previousRenderApp = typeof window.renderApp === 'function' ? window.renderApp : null;
  if(previousRenderApp){
    window.renderApp = function(){
      const result = previousRenderApp.apply(this, arguments);
      queueMount();
      return result;
    };
  }

  const previousSetTop = typeof window.setTop === 'function' ? window.setTop : null;
  if(previousSetTop){
    window.setTop = function(target){
      const result = previousSetTop.apply(this, arguments);
      if(target === 'home' || target === 'checklists') queueMount();
      return result;
    };
  }

  window.SovremennikShiftHandoff = {
    version:VERSION,
    refresh:() => isShiftHandoffUser() ? loadRows(true) : Promise.resolve(),
    open:() => {
      if(!isShiftHandoffUser()) return;
      model.mode = model.mode || 'details';
      model.checklistOpen = true;
      if(typeof window.setTop === 'function') window.setTop('checklists');
      queueMount();
    },
    getRows:() => isShiftHandoffUser() ? model.rows.slice() : [],
    isClosingChecklist:docId => isClosingChecklistId(docId),
    isAvailable:() => isShiftHandoffUser()
  };

  bindEvents();
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', queueMount, { once:true });
  } else {
    queueMount();
  }
})();

/* Современник — shift handoff workflow on the home dashboard. */
(function(){
  'use strict';

  const core = window.SovremennikShiftHandoffCore;
  if(!core || typeof state === 'undefined') return;

  const VERSION = '2026-07-23-shift-handoff-preview-1';
  const PHOTO_BUCKET = 'shift-handoff-photos';
  const DRAFT_KEY = 'sovremennikShiftHandoffDraftV1';
  const MAX_PHOTOS = 3;
  const MAX_RAW_BYTES = 25 * 1024 * 1024;
  const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
  const model = {
    rows:[],
    loading:false,
    loaded:false,
    error:'',
    formOpen:false,
    submitting:false,
    selectedPhotos:[],
    draft:loadDraft()
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
  function uuid(){
    if(typeof makeUuidV26 === 'function') return makeUuidV26();
    if(window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `handoff-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  function loadDraft(){
    try{
      const parsed = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
      return {
        unfinished:String(parsed.unfinished || ''),
        outOfStock:String(parsed.outOfStock || ''),
        equipmentIssues:String(parsed.equipmentIssues || ''),
        nextShiftControl:String(parsed.nextShiftControl || ''),
        notes:String(parsed.notes || '')
      };
    } catch(error){
      return { unfinished:'', outOfStock:'', equipmentIssues:'', nextShiftControl:'', notes:'' };
    }
  }
  function saveDraft(){
    try{ localStorage.setItem(DRAFT_KEY, JSON.stringify(model.draft)); } catch(error){ console.warn('Shift handoff draft was not saved', error); }
  }
  function clearDraft(){
    model.draft = { unfinished:'', outOfStock:'', equipmentIssues:'', nextShiftControl:'', notes:'' };
    try{ localStorage.removeItem(DRAFT_KEY); } catch(error){}
    clearSelectedPhotos();
  }
  function clearSelectedPhotos(){
    model.selectedPhotos.forEach(photo => { if(photo.previewUrl) URL.revokeObjectURL(photo.previewUrl); });
    model.selectedPhotos = [];
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
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
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

  function rowUserAcknowledgement(row){
    const userId = current()?.id;
    return (row.acknowledgements || []).find(item => String(item.employee_id || '') === String(userId || '')) || null;
  }
  function newestPending(){ return core.pendingForUser(model.rows, current()?.id, new Date()); }
  function authorLabel(row){
    return [row.created_by_name || 'Сотрудник', row.created_by_role ? (typeof roleLabel === 'function' ? roleLabel(row.created_by_role) : row.created_by_role) : ''].filter(Boolean).join(' · ');
  }

  function renderSections(row){
    const sections = core.sectionRows(row);
    return sections.map(section => `<section class="shift-handoff-section">
      <h4>${html(section.label)}</h4>
      <ul>${section.items.map(item => `<li>${html(item)}</li>`).join('')}</ul>
    </section>`).join('');
  }
  function renderPhotos(row){
    if(!row.photos?.length) return '';
    return `<div class="shift-handoff-photos" aria-label="Фотографии к передаче смены">${row.photos.map((photo, index) => {
      const url = photo.signedUrl || '';
      return url ? `<a href="${attr(url)}" target="_blank" rel="noopener" class="shift-handoff-photo"><img src="${attr(url)}" alt="Фото к передаче смены ${index + 1}"></a>` : '';
    }).join('')}</div>`;
  }
  function renderAcknowledgements(row){
    const rows = row.acknowledgements || [];
    if(!rows.length) return '<span class="shift-handoff-awaiting">Ожидает подтверждения</span>';
    return `<div class="shift-handoff-acks">${rows.map(item => `<span><strong>${html(item.employee_name || 'Сотрудник')}</strong> · ${html(core.formatDateTime(item.acknowledged_at))}</span>`).join('')}</div>`;
  }
  function renderPending(row){
    if(!row){
      return `<div class="shift-handoff-empty"><strong>Новых сообщений нет</strong><span>После следующей передачи здесь появится информация от предыдущей смены.</span></div>`;
    }
    const ownAck = rowUserAcknowledgement(row);
    return `<article class="shift-handoff-message" data-handoff-id="${attr(row.id)}">
      <div class="shift-handoff-message-head">
        <div><span class="shift-handoff-badge">От предыдущей смены</span><h3>${html(authorLabel(row))}</h3><p>${html(core.formatDateTime(row.created_at))}</p></div>
      </div>
      <div class="shift-handoff-sections">${renderSections(row)}</div>
      ${row.notes ? `<section class="shift-handoff-section"><h4>Дополнительно</h4><p>${html(row.notes)}</p></section>` : ''}
      ${renderPhotos(row)}
      <div class="shift-handoff-accept-row">
        ${ownAck ? `<span class="shift-handoff-accepted">Принято · ${html(core.formatDateTime(ownAck.acknowledged_at))}</span>` : `<button type="button" class="small-action" data-shift-handoff-accept="${attr(row.id)}">Принято</button>`}
      </div>
    </article>`;
  }
  function renderHistory(){
    const rows = model.rows.slice(0, 8);
    if(!rows.length) return '';
    return `<details class="shift-handoff-history"><summary>История передач</summary><div class="shift-handoff-history-list">${rows.map(row => `<article>
      <div><strong>${html(authorLabel(row))}</strong><span>${html(core.formatDateTime(row.created_at))}</span></div>
      <p>${html(core.sectionRows(row).flatMap(section => section.items).slice(0, 3).join(' · ') || row.notes || 'Передача без текстового описания')}</p>
      ${renderAcknowledgements(row)}
    </article>`).join('')}</div></details>`;
  }
  function renderPhotoDrafts(){
    if(!model.selectedPhotos.length) return '';
    return `<div class="shift-handoff-photo-drafts">${model.selectedPhotos.map((photo, index) => `<article><img src="${attr(photo.previewUrl)}" alt="Выбранное фото ${index + 1}"><button type="button" data-shift-photo-remove="${attr(photo.id)}" aria-label="Удалить фото">×</button></article>`).join('')}</div>`;
  }
  function textarea(name, label, placeholder){
    return `<label class="shift-handoff-field"><span>${html(label)}</span><textarea name="${attr(name)}" rows="3" placeholder="${attr(placeholder)}">${html(model.draft[name] || '')}</textarea></label>`;
  }
  function renderForm(){
    if(!model.formOpen) return '';
    return `<div class="shift-handoff-modal" data-shift-handoff-modal role="dialog" aria-modal="true" aria-labelledby="shift-handoff-form-title">
      <button type="button" class="shift-handoff-backdrop" data-shift-handoff-close aria-label="Закрыть форму"></button>
      <section class="shift-handoff-dialog">
        <div class="shift-handoff-dialog-head"><div><p class="section-kicker">Завершение работы</p><h2 id="shift-handoff-form-title">Передать смену</h2><span>Заполните только актуальные пункты. Каждый новый пункт пишите с новой строки.</span></div><button type="button" class="shift-handoff-close" data-shift-handoff-close aria-label="Закрыть">×</button></div>
        <form data-shift-handoff-form>
          <div class="shift-handoff-form-grid">
            ${textarea('unfinished','Что осталось незавершённым','Например: не разобрана поставка')}
            ${textarea('outOfStock','Какие позиции закончились','Например: овсяное молоко')}
            ${textarea('equipmentIssues','Проблемы с оборудованием','Например: правый гриндер выдаёт ошибку')}
            ${textarea('nextShiftControl','Что проконтролировать следующей смене','Например: проверить поставку сиропов')}
          </div>
          ${textarea('notes','Дополнительный комментарий','Короткое пояснение при необходимости')}
          <div class="shift-handoff-photo-picker">
            <div><strong>Фотографии</strong><span>До ${MAX_PHOTOS} фото, прикладывайте только когда они помогают понять проблему.</span></div>
            <button type="button" class="small-action secondary" data-shift-photo-pick ${model.selectedPhotos.length >= MAX_PHOTOS ? 'disabled' : ''}>Добавить фото</button>
            <input type="file" accept="image/*" capture="environment" multiple hidden data-shift-photo-input>
          </div>
          ${renderPhotoDrafts()}
          <p class="shift-handoff-draft-note">Текст автоматически сохраняется на этом устройстве до успешной отправки.</p>
          <p class="submit-status" data-shift-handoff-status aria-live="polite"></p>
          <div class="shift-handoff-form-actions"><button type="button" class="small-action secondary" data-shift-handoff-close>Отмена</button><button type="submit" class="small-action" ${model.submitting ? 'disabled' : ''}>${model.submitting ? 'Отправляю…' : 'Передать смену'}</button></div>
        </form>
      </section>
    </div>`;
  }
  function cardHtml(){
    const pending = newestPending();
    return `<section class="v3-dashboard-card shift-handoff-card" data-shift-handoff-root data-version="${VERSION}">
      <div class="v3-card-head"><div><p class="section-kicker">Коммуникация смен</p><h2>Передача смены</h2></div><button type="button" class="v3-text-button" data-shift-handoff-open>Передать смену</button></div>
      ${model.loading && !model.loaded ? '<div class="shift-handoff-loading">Загружаю передачу смены…</div>' : ''}
      ${model.error ? `<div class="shift-handoff-error">${html(model.error)}</div>` : ''}
      ${!model.loading || model.loaded ? renderPending(pending) : ''}
      ${renderHistory()}
      ${renderForm()}
    </section>`;
  }

  function mount(){
    mountQueued = false;
    if(!authenticated()) return;
    const home = document.querySelector('#top-home');
    if(!home) return;
    let root = home.querySelector('[data-shift-handoff-root]');
    if(!root){
      const summary = home.querySelector('.v3-summary-card');
      const wrapper = document.createElement('div');
      wrapper.innerHTML = cardHtml();
      root = wrapper.firstElementChild;
      if(summary) summary.insertAdjacentElement('beforebegin', root);
      else home.appendChild(root);
    } else {
      root.outerHTML = cardHtml();
    }
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

  async function signedUrl(path){
    const result = await supa.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600);
    if(result.error) return '';
    return result.data?.signedUrl || '';
  }
  async function loadRows(force = false){
    if(!authenticated() || typeof supa === 'undefined') return;
    if(loadPromise && !force) return loadPromise;
    model.loading = true;
    model.error = '';
    queueMount();
    loadPromise = (async () => {
      const since = new Date(Date.now() - 14 * 86400000).toISOString();
      const handoffs = await supa.from('shift_handoffs').select('*').gte('created_at', since).order('created_at', { ascending:false }).limit(30);
      if(handoffs.error) throw handoffs.error;
      const rows = handoffs.data || [];
      const ids = rows.map(row => row.id);
      let acknowledgements = [];
      let photos = [];
      if(ids.length){
        const [acksResult, photosResult] = await Promise.all([
          supa.from('shift_handoff_acknowledgements').select('handoff_id,employee_id,employee_name,acknowledged_at').in('handoff_id', ids).order('acknowledged_at', { ascending:true }),
          supa.from('shift_handoff_photos').select('id,handoff_id,storage_path,created_at').in('handoff_id', ids).order('created_at', { ascending:true })
        ]);
        if(acksResult.error) throw acksResult.error;
        if(photosResult.error) throw photosResult.error;
        acknowledgements = acksResult.data || [];
        photos = photosResult.data || [];
      }
      const photosWithUrls = await Promise.all(photos.map(async photo => ({ ...photo, signedUrl:await signedUrl(photo.storage_path) })));
      model.rows = rows.map(row => core.fromDatabaseRow({
        ...row,
        acknowledgements:acknowledgements.filter(item => item.handoff_id === row.id),
        photos:photosWithUrls.filter(item => item.handoff_id === row.id)
      }));
      model.loaded = true;
    })().catch(error => {
      console.error('Shift handoff loading failed', error);
      model.error = 'Передача смены временно недоступна. Обновите данные после восстановления соединения.';
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
      const upload = await supa.storage.from(PHOTO_BUCKET).upload(path, photo.blob, { contentType:'image/jpeg', cacheControl:'3600', upsert:false });
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
  async function submitForm(event){
    event.preventDefault();
    if(model.submitting) return;
    const normalized = core.normalizeDraft(model.draft);
    if(!core.hasContent(normalized)){
      setStatus('Добавьте хотя бы один пункт для следующей смены.', 'error');
      return;
    }
    if(!navigator.onLine){
      saveDraft();
      setStatus('Нет подключения. Черновик сохранён на устройстве — отправьте его после восстановления связи.', 'error');
      return;
    }
    model.submitting = true;
    queueMount();
    try{
      setStatus('Сохраняю передачу смены…');
      const row = core.toDatabaseRow(normalized);
      const handoffId = uuid();
      const result = await supa.rpc('create_shift_handoff', {
        p_id:handoffId,
        p_unfinished:row.unfinished,
        p_out_of_stock:row.out_of_stock,
        p_equipment_issues:row.equipment_issues,
        p_next_shift_control:row.next_shift_control,
        p_notes:row.notes
      });
      if(result.error) throw result.error;
      if(model.selectedPhotos.length) await uploadPhotos(handoffId);
      clearDraft();
      model.formOpen = false;
      await loadRows(true);
      window.dispatchEvent(new CustomEvent('sovremennik:shift-handoff-created', { detail:{ handoffId } }));
      alert('Передача смены сохранена. Следующая смена увидит её на главной странице.');
    } catch(error){
      console.error('Shift handoff submit failed', error);
      saveDraft();
      setStatus(`Не удалось отправить: ${error.message || 'проверьте подключение и повторите попытку.'}`, 'error');
    } finally {
      model.submitting = false;
      queueMount();
    }
  }
  async function acknowledge(id, button){
    if(!id || button?.disabled) return;
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
      const open = event.target.closest('[data-shift-handoff-open]');
      if(open){ model.formOpen = true; queueMount(); return; }
      const close = event.target.closest('[data-shift-handoff-close]');
      if(close && !model.submitting){ model.formOpen = false; queueMount(); return; }
      const accept = event.target.closest('[data-shift-handoff-accept]');
      if(accept){ acknowledge(accept.dataset.shiftHandoffAccept, accept); return; }
      const pick = event.target.closest('[data-shift-photo-pick]');
      if(pick){ document.querySelector('[data-shift-photo-input]')?.click(); return; }
      const remove = event.target.closest('[data-shift-photo-remove]');
      if(remove){
        const index = model.selectedPhotos.findIndex(photo => photo.id === remove.dataset.shiftPhotoRemove);
        if(index >= 0){
          const [photo] = model.selectedPhotos.splice(index, 1);
          if(photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
          queueMount();
        }
      }
    });
    document.addEventListener('input', event => {
      const form = event.target.closest('[data-shift-handoff-form]');
      if(!form || !event.target.name) return;
      if(Object.prototype.hasOwnProperty.call(model.draft, event.target.name)){
        model.draft[event.target.name] = event.target.value;
        saveDraft();
      }
    });
    document.addEventListener('change', event => {
      if(event.target.matches('[data-shift-photo-input]')) pickPhotos(event.target);
    });
    document.addEventListener('submit', event => {
      if(event.target.matches('[data-shift-handoff-form]')) submitForm(event);
    });
    window.addEventListener('online', () => { if(authenticated()) loadRows(true); });
    window.addEventListener('sovremennik:connection-changed', () => { if(navigator.onLine && authenticated()) loadRows(true); });
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
      if(target === 'home') queueMount();
      return result;
    };
  }

  window.SovremennikShiftHandoff = {
    version:VERSION,
    refresh:() => loadRows(true),
    open:() => { model.formOpen = true; queueMount(); },
    getRows:() => model.rows.slice()
  };

  bindEvents();
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', queueMount, { once:true });
  else queueMount();
})();

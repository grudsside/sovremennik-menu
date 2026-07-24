/* Современник — checklist review tools: gallery, comments, deletion and role filters. */
(function(){
  'use strict';

  if(typeof state === 'undefined') return;

  const VERSION = '2026-07-24-checklist-review-preview-1';
  const PHOTO_BUCKET = 'checklist-photo-reports';
  const roleCore = window.SovremennikChecklistCore || null;
  const signedUrlCache = new Map();
  const metadataById = new Map();
  const commentsBySubmission = new Map();
  const transientStatus = new Map();
  let assignees = [];
  let activeDepartment = 'barista';
  let reviewLoadPromise = null;
  let enhanceQueued = false;
  let observerInstalled = false;
  let delegatedEventsInstalled = false;

  const gallery = {
    items:[],
    index:0,
    zoom:1,
    x:0,
    y:0,
    requestToken:0,
    pointers:new Map(),
    pinchDistance:0,
    pinchZoom:1,
    dragOrigin:null
  };

  function html(value){
    if(typeof esc === 'function') return esc(value);
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[character]));
  }

  function attr(value){ return html(value); }
  function currentUserSafe(){ return typeof currentUser === 'function' ? currentUser() : null; }
  function normalizeRole(value){
    if(roleCore?.normalizeRole) return roleCore.normalizeRole(value);
    const role = String(value || '').trim().toLowerCase();
    return ({'администратор':'admin','руководитель':'manager','менеджер':'manager','бариста':'barista','официант':'waiter'})[role] || role;
  }
  function currentRole(){ return normalizeRole(currentUserSafe()?.role); }
  function canComment(){ return ['admin','manager'].includes(currentRole()); }
  function canDelete(){ return currentRole() === 'admin'; }
  function supabaseClient(){
    if(typeof supa !== 'undefined' && supa) return supa;
    return window.sovremennikSupabase || null;
  }
  function recordId(record){ return String(record?.id || ''); }
  function formatDateTimeSafe(value){
    if(typeof formatDateTime === 'function') return formatDateTime(value);
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime())
      ? date.toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
      : '—';
  }
  function pluralReports(count){
    const value = Number(count) || 0;
    const mod10 = value % 10;
    const mod100 = value % 100;
    if(mod10 === 1 && mod100 !== 11) return `${value} отчёт`;
    if([2,3,4].includes(mod10) && ![12,13,14].includes(mod100)) return `${value} отчёта`;
    return `${value} отчётов`;
  }

  function chunks(rows, size = 70){
    const result = [];
    for(let offset = 0; offset < rows.length; offset += size) result.push(rows.slice(offset, offset + size));
    return result;
  }

  async function fetchRowsBySubmission(table, columns, ids){
    const client = supabaseClient();
    if(!client || !ids.length) return [];
    const rows = [];
    for(const part of chunks(ids)){
      const result = await client.from(table).select(columns).in('submission_id', part);
      if(result.error) throw result.error;
      rows.push(...(result.data || []));
    }
    return rows;
  }

  async function loadReviewData(force = false){
    if(reviewLoadPromise) return reviewLoadPromise;
    const client = supabaseClient();
    if(!client) return;
    const ids = Array.from(new Set((state.controlRecords || []).map(recordId).filter(Boolean)));
    if(!ids.length){
      metadataById.clear();
      commentsBySubmission.clear();
      queueEnhance();
      return;
    }
    const missing = ids.filter(id => !metadataById.has(id));
    if(!force && !missing.length) return;

    reviewLoadPromise = (async () => {
      const metadataRows = [];
      for(const part of chunks(ids)){
        const result = await client
          .from('checklist_submissions')
          .select('id,employee_id,checklist_id,checklist_title,deleted_at,deleted_by,deletion_reason')
          .in('id', part);
        if(result.error) throw result.error;
        metadataRows.push(...(result.data || []));
      }

      metadataRows.forEach(row => metadataById.set(String(row.id), row));
      const visibleIds = new Set(metadataRows.filter(row => !row.deleted_at).map(row => String(row.id)));
      state.controlRecords = (state.controlRecords || []).filter(record => {
        const id = recordId(record);
        return !metadataById.has(id) || visibleIds.has(id);
      });

      const commentRows = await fetchRowsBySubmission(
        'checklist_submission_comments',
        'id,submission_id,author_id,author_name,assignee_id,assignee_name,body,task_id,created_at',
        Array.from(visibleIds)
      );
      commentsBySubmission.clear();
      commentRows
        .sort((left, right) => String(left.created_at || '').localeCompare(String(right.created_at || '')))
        .forEach(row => {
          const key = String(row.submission_id || '');
          if(!commentsBySubmission.has(key)) commentsBySubmission.set(key, []);
          commentsBySubmission.get(key).push(row);
        });

      if(canComment() && (!assignees.length || force)){
        const profiles = await client
          .from('profiles')
          .select('id,name,role,login,is_active')
          .eq('is_active', true)
          .order('name', { ascending:true });
        if(profiles.error) throw profiles.error;
        assignees = (profiles.data || []).map(profile => ({
          id:String(profile.id || ''),
          name:String(profile.name || profile.login || 'Сотрудник'),
          role:normalizeRole(profile.role)
        })).filter(profile => profile.id);
      }
    })().catch(error => {
      console.warn('Checklist review data is unavailable', error);
    }).finally(() => {
      reviewLoadPromise = null;
      if(typeof refreshControl === 'function') refreshControl();
      queueEnhance();
    });
    return reviewLoadPromise;
  }

  function checklistDocForRecord(record){
    const metadata = metadataById.get(recordId(record)) || {};
    const checklistId = String(metadata.checklist_id || record?.checklistId || '');
    const checklistTitle = String(metadata.checklist_title || record?.checklistTitle || '');
    const docs = Array.isArray(state.menu?.checklists) ? state.menu.checklists : [];
    return docs.find(doc => String(doc?.id || '') === checklistId)
      || docs.find(doc => String(doc?.title || '') === checklistTitle)
      || { id:checklistId, title:checklistTitle };
  }

  function departmentForRecord(record){
    const doc = checklistDocForRecord(record);
    if(roleCore?.departmentForDoc) return roleCore.departmentForDoc(doc);
    const source = `${doc?.id || ''} ${doc?.title || ''}`.toLowerCase();
    return source.includes('waiter') || source.includes('официант') ? 'waiter' : 'barista';
  }

  function recordTotals(record){
    if(typeof recordDoneTotal === 'function') return recordDoneTotal(record);
    const tasks = Array.isArray(record?.tasks) ? record.tasks : [];
    return {
      done:tasks.filter(task => task?.checked || task?.done).length || Number(record?.completed || 0),
      total:tasks.length || Number(record?.total || 0)
    };
  }

  function progressClass(percent){
    if(window.SovremennikChecklistPhotoCore?.progressClass) return window.SovremennikChecklistPhotoCore.progressClass(percent);
    if(percent >= 100) return 'complete';
    if(percent >= 70) return 'warning';
    return 'danger';
  }

  function ensureDepartmentFilter(){
    const root = document.querySelector('#control-records');
    const days = root?.querySelector('.checklist-control-days');
    if(!root || !days) return;

    const records = state.controlRecords || [];
    const counts = records.reduce((result, record) => {
      const department = departmentForRecord(record);
      result[department] = (result[department] || 0) + 1;
      return result;
    }, { barista:0, waiter:0 });

    if(!counts[activeDepartment]) activeDepartment = counts.barista ? 'barista' : 'waiter';

    let filter = root.querySelector('[data-checklist-department-filter]');
    if(!filter){
      filter = document.createElement('div');
      filter.className = 'checklist-review-filter';
      filter.dataset.checklistDepartmentFilter = '1';
      days.before(filter);
    }
    filter.innerHTML = `
      <button type="button" data-checklist-department="barista" class="${activeDepartment === 'barista' ? 'active' : ''}">
        <span>Бармены</span><b>${counts.barista}</b>
      </button>
      <button type="button" data-checklist-department="waiter" class="${activeDepartment === 'waiter' ? 'active' : ''}">
        <span>Официанты</span><b>${counts.waiter}</b>
      </button>`;

    root.querySelectorAll('.checklist-submission-details[data-checklist-submission]').forEach(details => {
      const id = String(details.dataset.checklistSubmission || '');
      const record = records.find(row => recordId(row) === id);
      const visible = record && departmentForRecord(record) === activeDepartment;
      details.hidden = !visible;
      details.dataset.reviewDepartment = record ? departmentForRecord(record) : '';
    });

    let visibleGroups = 0;
    root.querySelectorAll('.control-day-group').forEach(group => {
      const visibleDetails = Array.from(group.querySelectorAll('.checklist-submission-details')).filter(details => !details.hidden);
      group.hidden = visibleDetails.length === 0;
      if(group.hidden) return;
      visibleGroups += 1;
      const visibleRecords = visibleDetails.map(details => records.find(row => recordId(row) === String(details.dataset.checklistSubmission || ''))).filter(Boolean);
      const totals = visibleRecords.reduce((sum, record) => {
        const value = recordTotals(record);
        sum.done += value.done;
        sum.total += value.total;
        return sum;
      }, { done:0, total:0 });
      const percent = totals.total ? Math.round(totals.done / totals.total * 100) : 0;
      const small = group.querySelector('summary span:first-child small');
      if(small) small.textContent = `${pluralReports(visibleDetails.length)} · ${activeDepartment === 'waiter' ? 'официанты' : 'бариста'}`;
      const badge = group.querySelector('.control-day-percent');
      if(badge){
        badge.textContent = `${percent}%`;
        badge.className = `control-day-percent progress-${progressClass(percent)}`;
      }
    });

    let empty = root.querySelector('[data-checklist-department-empty]');
    if(!empty){
      empty = document.createElement('div');
      empty.className = 'checklist-review-empty';
      empty.dataset.checklistDepartmentEmpty = '1';
      days.after(empty);
    }
    empty.hidden = visibleGroups > 0;
    empty.textContent = activeDepartment === 'waiter'
      ? 'Отправленных чек-листов официантов пока нет.'
      : 'Отправленных чек-листов барменов пока нет.';
  }

  function roleLabel(role){
    return ({admin:'Администратор',manager:'Руководитель',barista:'Бариста',waiter:'Официант'})[normalizeRole(role)] || 'Сотрудник';
  }

  function renderComments(submissionId){
    const comments = commentsBySubmission.get(String(submissionId)) || [];
    if(!comments.length) return '<p class="checklist-review-comments-empty">Комментариев пока нет.</p>';
    return `<div class="checklist-review-comments-list">${comments.map(comment => `
      <article class="checklist-review-comment">
        <div><strong>${html(comment.author_name || 'Руководитель')}</strong><span>${html(formatDateTimeSafe(comment.created_at))}</span></div>
        <p>${html(comment.body || '')}</p>
        <small>Добавлено в актуальные задачи: ${html(comment.assignee_name || 'сотрудник')}</small>
      </article>`).join('')}</div>`;
  }

  function renderCommentForm(submissionId, metadata){
    if(!canComment()) return '';
    const defaultAssignee = String(metadata?.employee_id || '');
    const options = assignees.map(profile => `<option value="${attr(profile.id)}" ${profile.id === defaultAssignee ? 'selected' : ''}>${html(profile.name)} · ${html(roleLabel(profile.role))}</option>`).join('');
    return `<form class="checklist-review-form" data-checklist-comment-form data-submission-id="${attr(submissionId)}">
      <label>Кому добавить задачу<select name="assigneeId" required>${options}</select></label>
      <label>Комментарий<textarea name="body" rows="3" maxlength="2000" required placeholder="Что сотруднику нужно исправить или проконтролировать"></textarea></label>
      <div class="checklist-review-form-actions">
        <button type="submit" class="small-action">Добавить комментарий</button>
        <span data-checklist-review-status aria-live="polite">${html(transientStatus.get(String(submissionId)) || '')}</span>
      </div>
    </form>`;
  }

  function enhanceSubmissionReviews(){
    document.querySelectorAll('.checklist-submission-details[data-checklist-submission]').forEach(details => {
      const submissionId = String(details.dataset.checklistSubmission || '');
      if(!submissionId) return;
      const existing = details.querySelector('[data-checklist-review-section]');
      if(existing && existing.contains(document.activeElement)) return;
      const metadata = metadataById.get(submissionId) || {};
      const section = existing || document.createElement('section');
      section.className = 'checklist-review-section';
      section.dataset.checklistReviewSection = '1';
      section.innerHTML = `
        <div class="checklist-review-heading">
          <div><strong>Комментарии к чек-листу</strong><small>Комментарий создаёт актуальную задачу выбранному сотруднику.</small></div>
          ${canDelete() ? `<button type="button" class="checklist-review-delete" data-checklist-delete="${attr(submissionId)}">Удалить чек-лист</button>` : ''}
        </div>
        ${renderComments(submissionId)}
        ${renderCommentForm(submissionId, metadata)}`;
      if(!existing) details.appendChild(section);
    });
  }

  async function createComment(form){
    if(!canComment()) return;
    const client = supabaseClient();
    const submissionId = String(form.dataset.submissionId || '');
    const body = String(form.elements.body?.value || '').trim();
    const assigneeId = String(form.elements.assigneeId?.value || '');
    const status = form.querySelector('[data-checklist-review-status]');
    const button = form.querySelector('button[type="submit"]');
    if(!body || !assigneeId){
      if(status) status.textContent = 'Заполните комментарий и выберите сотрудника.';
      return;
    }
    if(button) button.disabled = true;
    if(status) status.textContent = 'Добавляю комментарий…';
    try{
      const result = await client.rpc('create_checklist_submission_comment', {
        p_submission_id:submissionId,
        p_assignee_id:assigneeId,
        p_body:body
      });
      if(result.error) throw result.error;
      transientStatus.set(submissionId, 'Комментарий добавлен в актуальные задачи.');
      form.reset();
      await loadReviewData(true);
    } catch(error){
      console.error(error);
      if(status) status.textContent = `Не удалось добавить комментарий: ${error.message || 'проверьте подключение.'}`;
    } finally {
      if(button) button.disabled = false;
    }
  }

  async function deleteSubmission(submissionId, button){
    if(!canDelete()) return;
    if(!window.confirm('Удалить отправленный чек-лист? Он исчезнет из раздела «Контроль». Это действие доступно только администратору.')) return;
    const client = supabaseClient();
    button.disabled = true;
    button.textContent = 'Удаляю…';
    try{
      const result = await client.rpc('delete_checklist_submission', {
        p_submission_id:String(submissionId),
        p_reason:'Удалено администратором из раздела «Контроль»'
      });
      if(result.error) throw result.error;
      state.controlRecords = (state.controlRecords || []).filter(record => recordId(record) !== String(submissionId));
      metadataById.delete(String(submissionId));
      commentsBySubmission.delete(String(submissionId));
      if(typeof setLocalControlRecords === 'function'){
        setLocalControlRecords((state.controlRecords || []).map(record => ({ ...record, photos:[] })));
      }
      if(typeof refreshControl === 'function') refreshControl();
      queueEnhance();
    } catch(error){
      console.error(error);
      alert('Не удалось удалить чек-лист: ' + (error.message || 'проверьте права доступа.'));
      button.disabled = false;
      button.textContent = 'Удалить чек-лист';
    }
  }

  async function signedUrl(path){
    const cached = signedUrlCache.get(path);
    if(cached && cached.expiresAt > Date.now() + 30000) return cached.url;
    const client = supabaseClient();
    const result = await client.storage.from(PHOTO_BUCKET).createSignedUrl(path, 600);
    if(result.error) throw result.error;
    const url = result.data?.signedUrl || '';
    signedUrlCache.set(path, { url, expiresAt:Date.now() + 9 * 60 * 1000 });
    return url;
  }

  function ensureViewer(){
    let viewer = document.querySelector('[data-checklist-review-viewer]');
    if(viewer) return viewer;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="checklist-review-viewer" data-checklist-review-viewer hidden>
        <div class="checklist-review-viewer-top">
          <div><strong data-viewer-title>Фото чек-листа</strong><span data-viewer-counter></span></div>
          <button type="button" data-viewer-close aria-label="Закрыть просмотр">×</button>
        </div>
        <button type="button" class="checklist-review-viewer-arrow previous" data-viewer-previous aria-label="Предыдущее фото">‹</button>
        <div class="checklist-review-viewer-stage" data-viewer-stage>
          <div class="checklist-review-viewer-loading" data-viewer-loading>Загружаю фото…</div>
          <img data-viewer-image alt="Фото подтверждение чек-листа" draggable="false">
        </div>
        <button type="button" class="checklist-review-viewer-arrow next" data-viewer-next aria-label="Следующее фото">›</button>
        <div class="checklist-review-viewer-toolbar">
          <button type="button" data-viewer-zoom-out aria-label="Уменьшить">−</button>
          <button type="button" data-viewer-reset><span data-viewer-zoom>100%</span></button>
          <button type="button" data-viewer-zoom-in aria-label="Увеличить">+</button>
        </div>
      </div>`);
    viewer = document.querySelector('[data-checklist-review-viewer]');
    bindViewer(viewer);
    return viewer;
  }

  function applyTransform(){
    const viewer = document.querySelector('[data-checklist-review-viewer]');
    const image = viewer?.querySelector('[data-viewer-image]');
    if(!image) return;
    if(gallery.zoom <= 1){
      gallery.x = 0;
      gallery.y = 0;
    }
    image.style.transform = `translate3d(${gallery.x}px, ${gallery.y}px, 0) scale(${gallery.zoom})`;
    const zoom = viewer.querySelector('[data-viewer-zoom]');
    if(zoom) zoom.textContent = `${Math.round(gallery.zoom * 100)}%`;
  }

  function setZoom(value){
    gallery.zoom = Math.max(0.5, Math.min(4, Number(value) || 1));
    applyTransform();
  }

  function resetTransform(){
    gallery.zoom = 1;
    gallery.x = 0;
    gallery.y = 0;
    applyTransform();
  }

  async function renderViewerItem(){
    const viewer = ensureViewer();
    const item = gallery.items[gallery.index];
    if(!item) return closeViewer();
    const token = ++gallery.requestToken;
    const image = viewer.querySelector('[data-viewer-image]');
    const loading = viewer.querySelector('[data-viewer-loading]');
    const title = viewer.querySelector('[data-viewer-title]');
    const counter = viewer.querySelector('[data-viewer-counter]');
    const previous = viewer.querySelector('[data-viewer-previous]');
    const next = viewer.querySelector('[data-viewer-next]');
    resetTransform();
    image.removeAttribute('src');
    image.hidden = true;
    loading.hidden = false;
    loading.textContent = 'Загружаю фото…';
    title.textContent = item.label || 'Фото чек-листа';
    counter.textContent = `${gallery.index + 1} из ${gallery.items.length}`;
    previous.disabled = gallery.index <= 0;
    next.disabled = gallery.index >= gallery.items.length - 1;
    try{
      const url = await signedUrl(item.path);
      if(token !== gallery.requestToken) return;
      image.onload = () => {
        if(token !== gallery.requestToken) return;
        loading.hidden = true;
        image.hidden = false;
      };
      image.onerror = () => {
        loading.hidden = false;
        loading.textContent = 'Не удалось загрузить фотографию.';
      };
      image.src = url;
    } catch(error){
      if(token !== gallery.requestToken) return;
      loading.hidden = false;
      loading.textContent = `Не удалось открыть фото: ${error.message || 'проверьте подключение.'}`;
    }
  }

  function openGallery(button){
    const report = button.closest('.checklist-submission-details') || document;
    const buttons = Array.from(report.querySelectorAll('[data-photo-view][data-photo-path]'));
    const items = buttons.map((row, index) => {
      const task = row.closest('.control-checklist-task');
      const taskTitle = task?.querySelector('.control-checklist-task-head strong')?.textContent?.trim() || 'Фото чек-листа';
      const photoLabel = row.closest('.control-photo-card')?.querySelector('[data-photo-thumb-placeholder]')?.textContent?.trim() || `Фото ${index + 1}`;
      return { path:String(row.dataset.photoPath || ''), label:`${taskTitle} · ${photoLabel}` };
    }).filter(item => item.path);
    if(!items.length) return;
    gallery.items = items;
    gallery.index = Math.max(0, buttons.indexOf(button));
    const viewer = ensureViewer();
    viewer.hidden = false;
    document.body.classList.add('checklist-review-viewer-open');
    renderViewerItem();
  }

  function closeViewer(){
    const viewer = document.querySelector('[data-checklist-review-viewer]');
    if(!viewer) return;
    viewer.hidden = true;
    document.body.classList.remove('checklist-review-viewer-open');
    gallery.items = [];
    gallery.pointers.clear();
    gallery.requestToken += 1;
    resetTransform();
  }

  function moveViewer(step){
    const nextIndex = gallery.index + step;
    if(nextIndex < 0 || nextIndex >= gallery.items.length) return;
    gallery.index = nextIndex;
    renderViewerItem();
  }

  function pointerDistance(){
    const points = Array.from(gallery.pointers.values());
    if(points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  function bindViewer(viewer){
    const stage = viewer.querySelector('[data-viewer-stage]');
    viewer.addEventListener('click', event => {
      if(event.target === viewer) closeViewer();
      if(event.target.closest('[data-viewer-close]')) closeViewer();
      if(event.target.closest('[data-viewer-previous]')) moveViewer(-1);
      if(event.target.closest('[data-viewer-next]')) moveViewer(1);
      if(event.target.closest('[data-viewer-zoom-in]')) setZoom(gallery.zoom + 0.25);
      if(event.target.closest('[data-viewer-zoom-out]')) setZoom(gallery.zoom - 0.25);
      if(event.target.closest('[data-viewer-reset]')) resetTransform();
    });
    stage.addEventListener('dblclick', event => {
      event.preventDefault();
      setZoom(gallery.zoom > 1 ? 1 : 2);
    });
    stage.addEventListener('wheel', event => {
      event.preventDefault();
      setZoom(gallery.zoom + (event.deltaY < 0 ? 0.2 : -0.2));
    }, { passive:false });
    stage.addEventListener('pointerdown', event => {
      stage.setPointerCapture?.(event.pointerId);
      gallery.pointers.set(event.pointerId, { x:event.clientX, y:event.clientY, startX:event.clientX, startY:event.clientY });
      if(gallery.pointers.size === 1){
        gallery.dragOrigin = { x:gallery.x, y:gallery.y, pointerX:event.clientX, pointerY:event.clientY };
      } else if(gallery.pointers.size === 2){
        gallery.pinchDistance = pointerDistance();
        gallery.pinchZoom = gallery.zoom;
      }
    });
    stage.addEventListener('pointermove', event => {
      const pointer = gallery.pointers.get(event.pointerId);
      if(!pointer) return;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      if(gallery.pointers.size >= 2){
        const distance = pointerDistance();
        if(gallery.pinchDistance > 0) setZoom(gallery.pinchZoom * distance / gallery.pinchDistance);
        return;
      }
      if(gallery.zoom > 1 && gallery.dragOrigin){
        gallery.x = gallery.dragOrigin.x + event.clientX - gallery.dragOrigin.pointerX;
        gallery.y = gallery.dragOrigin.y + event.clientY - gallery.dragOrigin.pointerY;
        applyTransform();
      }
    });
    const releasePointer = event => {
      const pointer = gallery.pointers.get(event.pointerId);
      gallery.pointers.delete(event.pointerId);
      if(pointer && gallery.zoom <= 1 && gallery.pointers.size === 0){
        const delta = event.clientX - pointer.startX;
        if(Math.abs(delta) > 70) moveViewer(delta < 0 ? 1 : -1);
      }
      if(gallery.pointers.size === 0) gallery.dragOrigin = null;
      if(gallery.pointers.size < 2) gallery.pinchDistance = 0;
    };
    stage.addEventListener('pointerup', releasePointer);
    stage.addEventListener('pointercancel', releasePointer);
  }

  function installDelegatedEvents(){
    if(delegatedEventsInstalled) return;
    delegatedEventsInstalled = true;
    document.addEventListener('click', event => {
      const view = event.target.closest?.('[data-photo-view][data-photo-path]');
      if(view){
        event.preventDefault();
        event.stopImmediatePropagation();
        openGallery(view);
        return;
      }
    }, true);
    document.addEventListener('click', event => {
      const filter = event.target.closest?.('[data-checklist-department]');
      if(filter){
        activeDepartment = filter.dataset.checklistDepartment === 'waiter' ? 'waiter' : 'barista';
        queueEnhance();
        return;
      }
      const remove = event.target.closest?.('[data-checklist-delete]');
      if(remove){
        event.preventDefault();
        deleteSubmission(remove.dataset.checklistDelete, remove);
      }
    });
    document.addEventListener('submit', event => {
      const form = event.target.closest?.('[data-checklist-comment-form]');
      if(!form) return;
      event.preventDefault();
      createComment(form);
    });
    document.addEventListener('keydown', event => {
      const viewer = document.querySelector('[data-checklist-review-viewer]:not([hidden])');
      if(!viewer) return;
      if(event.key === 'Escape') closeViewer();
      if(event.key === 'ArrowLeft') moveViewer(-1);
      if(event.key === 'ArrowRight') moveViewer(1);
      if(event.key === '+' || event.key === '=') setZoom(gallery.zoom + 0.25);
      if(event.key === '-') setZoom(gallery.zoom - 0.25);
      if(event.key === '0') resetTransform();
    });
  }

  function installObserver(){
    if(observerInstalled) return;
    observerInstalled = true;
    const start = () => {
      const root = document.querySelector('#app') || document.body;
      if(!root) return;
      const observer = new MutationObserver(queueEnhance);
      observer.observe(root, { childList:true, subtree:true });
    };
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
    else start();
  }

  function enhanceAll(){
    enhanceQueued = false;
    const control = document.querySelector('#control-records .checklist-control-days');
    if(!control) return;
    const ids = (state.controlRecords || []).map(recordId).filter(Boolean);
    if(ids.some(id => !metadataById.has(id)) && !reviewLoadPromise) void loadReviewData();
    ensureDepartmentFilter();
    enhanceSubmissionReviews();
  }

  function queueEnhance(){
    if(enhanceQueued) return;
    enhanceQueued = true;
    requestAnimationFrame(enhanceAll);
  }

  const loadControlBeforeReview = typeof loadControlRecords === 'function' ? loadControlRecords : null;
  const refreshControlBeforeReview = typeof refreshControl === 'function' ? refreshControl : null;
  const renderAppBeforeReview = typeof renderApp === 'function' ? renderApp : null;

  if(loadControlBeforeReview){
    window.loadControlRecords = loadControlRecords = async function(...args){
      const result = await loadControlBeforeReview.apply(this, args);
      await loadReviewData(true);
      queueEnhance();
      return result;
    };
  }
  if(refreshControlBeforeReview){
    window.refreshControl = refreshControl = function(...args){
      const result = refreshControlBeforeReview.apply(this, args);
      queueMicrotask(queueEnhance);
      return result;
    };
  }
  if(renderAppBeforeReview){
    window.renderApp = renderApp = function(...args){
      const result = renderAppBeforeReview.apply(this, args);
      queueMicrotask(queueEnhance);
      return result;
    };
  }

  window.SovremennikChecklistReviewTools = Object.freeze({
    VERSION,
    loadReviewData,
    departmentForRecord,
    openGallery,
    closeViewer,
    queueEnhance,
    setDepartmentForTesting(value){ activeDepartment = value === 'waiter' ? 'waiter' : 'barista'; queueEnhance(); }
  });

  installDelegatedEvents();
  installObserver();
  queueEnhance();
})();

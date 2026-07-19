/* Современник interface follow-up — mobile tasks, dashboard data and control refresh */
(function(){
  'use strict';

  const VERSION = '2026-07-19-interface-followup-1';
  const REVISION_POLL_MS = 60000;
  let taskModalPreviousFocus = null;
  let revisionLoadPromise = null;
  let controlRefreshPromise = null;
  let revisionChannel = null;
  let enhanceQueued = false;

  function appState(){
    return typeof state !== 'undefined' ? state : null;
  }

  function htmlEscape(value){
    return String(value ?? '').replace(/[&<>\"]/g, char => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;'
    }[char]));
  }

  function localDateKey(date = new Date()){
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function normalizeKey(value){
    if(typeof normalizeDateKey === 'function') return normalizeDateKey(value || '');
    const raw = String(value || '').trim();
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const ru = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    if(ru) return `${ru[3]}-${ru[2]}-${ru[1]}`;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? raw : localDateKey(date);
  }

  function dateFromKey(key){
    const match = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function scheduleRows(){
    try {
      if(typeof getScheduleEvents === 'function') return getScheduleEvents() || [];
      return Array.isArray(appState()?.scheduleEvents) ? appState().scheduleEvents : [];
    } catch(error){
      return [];
    }
  }

  function isOrdinaryShift(event){
    const type = String(event?.type || event?.eventType || '').trim().toLowerCase();
    const title = String(event?.title || '').trim().toLowerCase();
    return type.includes('смен')
      || /^смена(?:\s|:|—|-|$)/i.test(title)
      || /(?:^|:)\s*целая смена\s*$/i.test(title);
  }

  function upcomingNonShiftEvents(limit = 4){
    const today = dateFromKey(localDateKey());
    return scheduleRows()
      .map(event => ({
        event,
        key:normalizeKey(event?.eventDate || event?.event_date || event?.date || '')
      }))
      .map(item => ({ ...item, date:dateFromKey(item.key) }))
      .filter(item => item.date && item.date >= today && !isOrdinaryShift(item.event))
      .sort((a,b) => a.date - b.date || String(a.event?.title || '').localeCompare(String(b.event?.title || ''), 'ru'))
      .slice(0, limit);
  }

  function shiftEmployeeName(event){
    const title = String(event?.title || '').trim();
    const description = String(event?.description || '').trim();
    const explicit = description.match(/(?:сотрудник|сотрудники|бариста|официант|администратор)\s*[:—-]\s*([^,;\n]+)/i);
    if(explicit?.[1]) return explicit[1].trim();
    const cleaned = title
      .replace(/^смена\s*[:—-]?\s*/i, '')
      .replace(/\s+(?:с|от)?\s*\d{1,2}[.:]\d{2}\s*[—–-]\s*\d{1,2}[.:]\d{2}.*$/i, '')
      .trim();
    if(cleaned && cleaned.toLowerCase() !== 'смена') return cleaned;
    return String(event?.employeeName || event?.employee_name || '').trim() || 'Сотрудник';
  }

  function todayShiftCount(){
    const today = localDateKey();
    const seen = new Set();
    scheduleRows().forEach(event => {
      if(!isOrdinaryShift(event)) return;
      const key = normalizeKey(event?.eventDate || event?.event_date || event?.date || '');
      if(key !== today) return;
      seen.add(shiftEmployeeName(event).toLowerCase());
    });
    return seen.size;
  }

  function revisionRows(){
    try {
      if(typeof getRevisionRecords === 'function') return getRevisionRecords() || [];
      return Array.isArray(appState()?.revisionRecords) ? appState().revisionRecords : [];
    } catch(error){
      return [];
    }
  }

  function revisionDateKey(row){
    return normalizeKey(
      row?.dateKey
      || row?.revisionDate
      || row?.revision_date
      || row?.date
      || row?.createdAt
      || row?.created_at
      || ''
    );
  }

  function revisionAvailableToday(){
    const today = localDateKey();
    return revisionRows().some(row => revisionDateKey(row) === today) ? 0 : 1;
  }

  function activeTaskCount(){
    try { return typeof activeTasks === 'function' ? activeTasks().length : 0; }
    catch(error){ return 0; }
  }

  function renderUpcomingFollowup(){
    const rows = upcomingNonShiftEvents();
    const current = appState();
    if(current?.scheduleLoading && !rows.length){
      return '<div class="v3-empty-inline">Загружаю ближайшие события…</div>';
    }
    if(!rows.length){
      return '<div class="v3-empty-inline"><strong>Ближайших событий нет</strong><span>Генеральные уборки, ревизии, собрания и другие мероприятия появятся здесь автоматически.</span></div>';
    }
    return `<div class="v3-upcoming-list">${rows.map(({event, date}) => {
      const day = date.toLocaleDateString('ru-RU', { day:'2-digit' });
      const month = date.toLocaleDateString('ru-RU', { month:'long' }).replace(/\.$/, '');
      const title = event?.title || event?.type || 'Событие';
      const type = event?.type || 'Мероприятие';
      const description = event?.description ? ` · ${htmlEscape(event.description)}` : '';
      return `<button type="button" class="v3-upcoming-item" data-followup-schedule-jump>
        <span class="v3-date-chip" aria-label="${htmlEscape(`${day} ${month}`)}">
          <span class="v3-date-day">${htmlEscape(day)}</span>
          <span class="v3-date-month">${htmlEscape(month)}</span>
        </span>
        <span><strong>${htmlEscape(title)}</strong><small>${htmlEscape(type)}${description}</small></span>
      </button>`;
    }).join('')}</div>`;
  }

  function renderMetricsFollowup(){
    const revisionAvailable = revisionAvailableToday();
    return `<div class="v3-metrics-grid">
      <div class="v3-metric"><span>Мои задачи</span><strong>${activeTaskCount()}</strong><small>актуальных</small></div>
      <div class="v3-metric"><span>Сегодня в смене</span><strong>${todayShiftCount()}</strong><small>сотрудников</small></div>
      <div class="v3-metric v3-metric--placeholder"><span>Заготовочный план</span></div>
      <div class="v3-metric"><span>Ревизии</span><strong>${revisionAvailable}</strong><small>${revisionAvailable ? 'доступна сегодня' : 'закрыта на сегодня'}</small></div>
    </div>`;
  }

  function refreshDashboardFollowup(){
    const upcoming = document.querySelector('#v3-upcoming-events');
    if(upcoming){
      const signature = upcomingNonShiftEvents().map(item => `${item.event?.id || ''}:${item.key}:${item.event?.title || ''}`).join('|')
        + `|loading:${Boolean(appState()?.scheduleLoading)}`;
      if(upcoming.dataset.followupSignature !== signature){
        upcoming.dataset.followupSignature = signature;
        upcoming.innerHTML = renderUpcomingFollowup();
      }
    }

    const metrics = document.querySelector('#v3-home-metrics');
    if(metrics){
      const signature = `${activeTaskCount()}|${todayShiftCount()}|${revisionAvailableToday()}|${Boolean(appState()?.revisionLoading)}`;
      if(metrics.dataset.followupSignature !== signature){
        metrics.dataset.followupSignature = signature;
        metrics.innerHTML = renderMetricsFollowup();
      }
    }
  }

  function removeStaleTaskPortal(){
    const modal = document.querySelector('body > #task-modal');
    if(modal) modal.remove();
    document.body.classList.remove('task-modal-open');
  }

  function taskModal(){
    const modals = Array.from(document.querySelectorAll('#task-modal'));
    if(modals.length > 1) modals.slice(0, -1).forEach(modal => modal.remove());
    return modals.at(-1) || null;
  }

  function openTaskModalFollowup(){
    const modal = taskModal();
    if(!modal) return;
    taskModalPreviousFocus = document.activeElement;
    if(modal.parentElement !== document.body) document.body.appendChild(modal);
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('task-modal-open');

    const select = modal.querySelector('select[name="assigneeLogin"]');
    const current = appState();
    if((!select || select.options.length <= 1) && !current?.taskAssignees && typeof loadTaskAssignees === 'function'){
      loadTaskAssignees().catch(error => console.warn('Task assignee refresh failed', error));
    }

    requestAnimationFrame(() => modal.querySelector('input[name="title"]')?.focus({ preventScroll:true }));
  }

  function closeTaskModalFollowup(){
    const modal = taskModal();
    if(modal){
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('task-modal-open');
    const focusTarget = taskModalPreviousFocus;
    taskModalPreviousFocus = null;
    if(focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus({ preventScroll:true });
  }

  function enhanceTaskModal(){
    const modal = taskModal();
    if(!modal || modal.dataset.followupEnhanced === '1') return;
    modal.dataset.followupEnhanced = '1';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const title = modal.querySelector('.card-head h3');
    if(title){
      title.id ||= 'task-modal-title';
      modal.setAttribute('aria-labelledby', title.id);
    }
  }

  async function ensureRevisionRecords(force = false){
    const current = appState();
    if(!current || typeof loadRevisionRecords !== 'function') return;
    if(typeof isAuthenticated === 'function' && !isAuthenticated()) return;
    if(!force && Array.isArray(current.revisionRecords)){
      refreshDashboardFollowup();
      return current.revisionRecords;
    }
    if(revisionLoadPromise) return revisionLoadPromise;
    revisionLoadPromise = Promise.resolve(loadRevisionRecords())
      .catch(error => {
        console.warn('Home revision availability refresh failed', error);
        return null;
      })
      .finally(() => {
        revisionLoadPromise = null;
        refreshDashboardFollowup();
      });
    return revisionLoadPromise;
  }

  function enhanceControlSummary(){
    const grid = document.querySelector('.control-summary-grid');
    if(!grid) return;
    grid.querySelectorAll('[data-control-summary-refresh]').forEach(button => button.remove());

    let toolbar = grid.previousElementSibling;
    if(!toolbar?.matches('.control-summary-global-toolbar')){
      toolbar = document.createElement('div');
      toolbar.className = 'control-summary-global-toolbar';
      toolbar.innerHTML = `<div>
          <strong>Обновление сводки</strong>
          <span>Чек-листы, ревизии и сообщения об ошибках</span>
        </div>
        <button class="small-action secondary" type="button" data-refresh-control-summary-all>Обновить сводку</button>
        <p class="control-summary-refresh-status" data-control-summary-refresh-status aria-live="polite"></p>`;
      grid.insertAdjacentElement('beforebegin', toolbar);
    }
  }

  async function refreshControlSummaryAll(button){
    if(controlRefreshPromise) return controlRefreshPromise;
    const status = document.querySelector('[data-control-summary-refresh-status]');
    const originalLabel = button?.textContent || 'Обновить сводку';
    if(button){
      button.disabled = true;
      button.textContent = 'Обновляю…';
    }
    if(status) status.textContent = 'Получаю актуальные данные…';

    const jobs = [
      typeof loadControlRecords === 'function' ? loadControlRecords() : Promise.resolve(),
      typeof loadRevisionRecords === 'function' ? loadRevisionRecords() : Promise.resolve(),
      typeof loadErrorReports === 'function' ? loadErrorReports() : Promise.resolve()
    ];
    controlRefreshPromise = Promise.allSettled(jobs)
      .then(results => {
        enhanceControlSummary();
        const current = appState();
        const hasFailure = results.some(result => result.status === 'rejected')
          || Boolean(current?.controlError || current?.revisionError || current?.errorReportsError);
        const liveStatus = document.querySelector('[data-control-summary-refresh-status]');
        if(liveStatus) liveStatus.textContent = hasFailure
          ? 'Обновлено, но часть данных временно недоступна.'
          : 'Сводка обновлена.';
      })
      .finally(() => {
        controlRefreshPromise = null;
        const currentButton = document.querySelector('[data-refresh-control-summary-all]');
        if(currentButton){
          currentButton.disabled = false;
          currentButton.textContent = originalLabel;
        }
      });
    return controlRefreshPromise;
  }

  function installRealtimeRevisionSync(){
    const client = window.sovremennikSupabase;
    if(!client || revisionChannel) return;
    try {
      revisionChannel = client
        .channel(`home-revision-availability-${Date.now()}`)
        .on('postgres_changes', { event:'*', schema:'public', table:'coffee_revisions' }, () => ensureRevisionRecords(true))
        .subscribe();
    } catch(error){
      console.warn('Realtime revision availability is unavailable', error);
    }
  }

  function enhanceAll(){
    enhanceQueued = false;
    enhanceTaskModal();
    enhanceControlSummary();
    refreshDashboardFollowup();
    installRealtimeRevisionSync();

    const current = appState();
    if(current?.activeTop === 'home' && !Array.isArray(current.revisionRecords)) ensureRevisionRecords();
  }

  function queueEnhance(){
    if(enhanceQueued) return;
    enhanceQueued = true;
    requestAnimationFrame(enhanceAll);
  }

  if(typeof openTaskModal === 'function'){
    window.openTaskModal = openTaskModal = openTaskModalFollowup;
  }
  if(typeof closeTaskModal === 'function'){
    window.closeTaskModal = closeTaskModal = closeTaskModalFollowup;
  }

  if(typeof renderApp === 'function'){
    const renderAppBeforeFollowup = renderApp;
    window.renderApp = renderApp = function(...args){
      removeStaleTaskPortal();
      const result = renderAppBeforeFollowup.apply(this, args);
      queueMicrotask(queueEnhance);
      return result;
    };
  }

  if(typeof setTop === 'function'){
    const setTopBeforeFollowup = setTop;
    window.setTop = setTop = function(...args){
      const result = setTopBeforeFollowup.apply(this, args);
      queueMicrotask(queueEnhance);
      if(appState()?.activeTop === 'home') ensureRevisionRecords(true);
      return result;
    };
  }

  if(typeof refreshTasks === 'function'){
    const refreshTasksBeforeFollowup = refreshTasks;
    window.refreshTasks = refreshTasks = function(...args){
      const result = refreshTasksBeforeFollowup.apply(this, args);
      refreshDashboardFollowup();
      return result;
    };
  }

  if(typeof refreshSchedule === 'function'){
    const refreshScheduleBeforeFollowup = refreshSchedule;
    window.refreshSchedule = refreshSchedule = function(...args){
      const result = refreshScheduleBeforeFollowup.apply(this, args);
      refreshDashboardFollowup();
      return result;
    };
  }

  if(typeof loadTasks === 'function'){
    const loadTasksBeforeFollowup = loadTasks;
    window.loadTasks = loadTasks = async function(...args){
      const result = await loadTasksBeforeFollowup.apply(this, args);
      refreshDashboardFollowup();
      if(appState()?.activeTop === 'home') await ensureRevisionRecords(true);
      return result;
    };
  }

  if(typeof loadScheduleEvents === 'function'){
    const loadScheduleBeforeFollowup = loadScheduleEvents;
    window.loadScheduleEvents = loadScheduleEvents = async function(...args){
      const result = await loadScheduleBeforeFollowup.apply(this, args);
      refreshDashboardFollowup();
      return result;
    };
  }

  if(typeof loadRevisionRecords === 'function'){
    const loadRevisionsBeforeFollowup = loadRevisionRecords;
    window.loadRevisionRecords = loadRevisionRecords = async function(...args){
      const result = await loadRevisionsBeforeFollowup.apply(this, args);
      refreshDashboardFollowup();
      queueEnhance();
      return result;
    };
  }

  if(typeof sendPayloadToSheets === 'function'){
    const sendPayloadBeforeFollowup = sendPayloadToSheets;
    window.sendPayloadToSheets = sendPayloadToSheets = async function(payload, ...args){
      const result = await sendPayloadBeforeFollowup.call(this, payload, ...args);
      if(payload?.payloadType === 'coffeeRevision' || payload?.payloadType === 'coffeeRevisionManual'){
        queueMicrotask(() => ensureRevisionRecords(true));
      }
      return result;
    };
  }

  document.addEventListener('click', event => {
    const closeButton = event.target.closest('[data-close-task-modal]');
    if(closeButton){
      event.preventDefault();
      event.stopImmediatePropagation();
      closeTaskModalFollowup();
      return;
    }

    if(event.target.matches('#task-modal')){
      event.preventDefault();
      event.stopImmediatePropagation();
      closeTaskModalFollowup();
      return;
    }

    const taskSummary = event.target.closest('.task-details > summary');
    if(taskSummary){
      event.preventDefault();
      event.stopImmediatePropagation();
      const details = taskSummary.parentElement;
      if(details) details.open = !details.open;
      return;
    }

    const completeButton = event.target.closest('[data-task-complete]');
    if(completeButton){
      event.preventDefault();
      event.stopImmediatePropagation();
      if(typeof completeTask === 'function') completeTask(completeButton.dataset.taskComplete, completeButton);
      return;
    }

    const deleteButton = event.target.closest('[data-task-delete]');
    if(deleteButton){
      event.preventDefault();
      event.stopImmediatePropagation();
      if(typeof deleteTaskV21 === 'function') deleteTaskV21(deleteButton.dataset.taskDelete, deleteButton);
      return;
    }

    const summaryRefresh = event.target.closest('[data-refresh-control-summary-all]');
    if(summaryRefresh){
      event.preventDefault();
      event.stopImmediatePropagation();
      refreshControlSummaryAll(summaryRefresh);
      return;
    }

    const scheduleJump = event.target.closest('[data-followup-schedule-jump]');
    if(scheduleJump){
      event.preventDefault();
      event.stopImmediatePropagation();
      if(typeof setTop === 'function') setTop('schedule');
    }
  }, true);

  document.addEventListener('keydown', event => {
    if(event.key === 'Escape' && document.body.classList.contains('task-modal-open')) closeTaskModalFollowup();
  });

  document.addEventListener('visibilitychange', () => {
    if(!document.hidden && appState()?.activeTop === 'home') ensureRevisionRecords(true);
  });

  window.addEventListener('pageshow', () => {
    queueEnhance();
    if(appState()?.activeTop === 'home') ensureRevisionRecords(true);
  });

  window.setInterval(() => {
    if(document.hidden || appState()?.activeTop !== 'home') return;
    if(typeof isAuthenticated === 'function' && !isAuthenticated()) return;
    ensureRevisionRecords(true);
  }, REVISION_POLL_MS);

  document.documentElement.dataset.interfaceFollowupVersion = VERSION;
  const root = document.querySelector('.page') || document.body;
  const observer = new MutationObserver(queueEnhance);
  observer.observe(root, { subtree:true, childList:true });

  queueEnhance();
  if(typeof isAuthenticated === 'function' && isAuthenticated() && typeof renderApp === 'function') renderApp();
})();

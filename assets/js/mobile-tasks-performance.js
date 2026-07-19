/* Современник mobile tasks performance hotfix — lightweight task cards and stable iOS modal */
(function(){
  'use strict';

  const VERSION = '2026-07-19-mobile-tasks-performance-1';
  const MOBILE_PAGE_SIZE = 12;
  let visibleTaskCount = MOBILE_PAGE_SIZE;
  let assigneeLoadRequested = false;

  const legacyRenderTaskItem = typeof renderTaskItem === 'function' ? renderTaskItem : null;
  const legacyRenderTasksList = typeof renderTasksList === 'function' ? renderTasksList : null;
  const legacySetTop = typeof setTop === 'function' ? setTop : null;
  const legacyRenderApp = typeof renderApp === 'function' ? renderApp : null;

  function appState(){
    return typeof state !== 'undefined' ? state : null;
  }

  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>\"]/g, char => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;'
    }[char]));
  }

  function isMobileTaskMode(){
    return window.matchMedia('(max-width: 920px), (pointer: coarse)').matches;
  }

  function callOr(name, fallback, ...args){
    const fn = window[name];
    if(typeof fn !== 'function') return fallback;
    try { return fn(...args); }
    catch(error){ return fallback; }
  }

  function renderTaskItemOptimized(task){
    if(!isMobileTaskMode() && legacyRenderTaskItem) return legacyRenderTaskItem(task);

    const id = String(task?.id || '');
    const vip = Boolean(callOr('isVipTask', false, task));
    const deadlineText = callOr('taskDeadlineLabel', 'без срока', task);
    const deadlineFull = callOr('displayTaskDeadline', 'без срока', task);
    const assignedTo = task?.assigneeName || task?.assignee || task?.assigneeLogin || 'не указано';
    const localOnly = typeof isUuidLikeV21 === 'function' ? !isUuidLikeV21(id) : false;
    const canComplete = Boolean(callOr('canCompleteTask', false, task));
    const admin = typeof isAdmin === 'function' && isAdmin();
    const createdAt = typeof formatDateTime === 'function' ? formatDateTime(task?.createdAt) : (task?.createdAt || '');

    return `<article class="task-item task-compact mobile-task-card ${vip ? 'vip' : ''}" data-task-id="${escapeHtml(id)}">
      <button class="mobile-task-summary" type="button" data-mobile-task-toggle="${escapeHtml(id)}" aria-expanded="false">
        <span class="task-main">
          <span class="task-title">${escapeHtml(task?.title || 'Задача')}</span>
          <span class="task-mini-meta">${vip ? '<b class="vip-mark">VIP</b>' : ''}<span>${escapeHtml(deadlineFull)}</span><span>кому: ${escapeHtml(assignedTo)}</span>${localOnly ? '<span class="local-task-note">локально</span>' : ''}</span>
        </span>
        <span class="mobile-task-side"><span class="task-timer ${vip ? 'vip-timer' : ''}">${escapeHtml(deadlineText)}</span><span class="mobile-task-chevron" aria-hidden="true">⌄</span></span>
      </button>
      <div class="mobile-task-body" data-mobile-task-body="${escapeHtml(id)}" hidden>
        ${task?.description ? `<p class="description">${escapeHtml(task.description)}</p>` : ''}
        <div class="task-meta"><span>Поставил: ${escapeHtml(task?.authorName || '—')}</span><span>Создано: ${escapeHtml(createdAt)}</span></div>
        <div class="task-actions-row">
          ${canComplete ? `<button class="small-action task-complete" type="button" data-task-complete="${escapeHtml(id)}">Завершить задачу</button>` : ''}
          ${admin ? `<button class="small-action ghost task-delete" type="button" data-task-delete="${escapeHtml(id)}">Удалить</button>` : ''}
        </div>
      </div>
    </article>`;
  }

  function renderTasksListOptimized(){
    if(!isMobileTaskMode() && legacyRenderTasksList) return legacyRenderTasksList();

    const current = appState();
    if(current?.taskLoading) return '<div class="task-empty">Загружаю задачи…</div>';

    const tasks = typeof activeTasks === 'function' ? activeTasks() : [];
    if(!tasks.length){
      return `<div class="task-empty">Актуальных задач для вас пока нет.</div>${current?.taskError ? `<p class="employees-error">${escapeHtml(current.taskError)}</p>` : ''}`;
    }

    const visible = tasks.slice(0, visibleTaskCount);
    const remaining = Math.max(0, tasks.length - visible.length);
    return `<div class="task-list compact mobile-task-list">${visible.map(renderTaskItemOptimized).join('')}</div>
      ${remaining ? `<button class="small-action secondary mobile-tasks-more" type="button" data-mobile-tasks-more>Показать ещё ${Math.min(MOBILE_PAGE_SIZE, remaining)}</button>` : ''}
      ${current?.taskError ? `<p class="employees-error">${escapeHtml(current.taskError)}</p>` : ''}`;
  }

  function refreshTasksOptimized(){
    const list = document.querySelector('#tasks-list');
    if(!list) return;
    list.innerHTML = renderTasksListOptimized();
    if(typeof bindTaskCardEventsV21 === 'function') bindTaskCardEventsV21();
  }

  function findTaskModal(){
    const modals = Array.from(document.querySelectorAll('#task-modal'));
    if(modals.length > 1) modals.slice(0, -1).forEach(modal => modal.remove());
    return modals.at(-1) || null;
  }

  function openTaskModalOptimized(){
    const modal = findTaskModal();
    if(!modal) return;
    if(modal.parentElement !== document.body) document.body.appendChild(modal);
    modal.dataset.mobilePerformanceModal = '1';
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('task-modal-open');

    const select = modal.querySelector('select[name="assigneeLogin"]');
    const current = appState();
    if((!select || select.options.length <= 1) && !current?.taskAssignees && !assigneeLoadRequested && typeof loadTaskAssignees === 'function'){
      assigneeLoadRequested = true;
      Promise.resolve(loadTaskAssignees())
        .catch(error => console.warn('Task assignee refresh failed', error))
        .finally(() => { assigneeLoadRequested = false; });
    }
  }

  function closeTaskModalOptimized(){
    const modal = findTaskModal();
    if(modal){
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('task-modal-open');
  }

  function syncTaskModeClass(){
    const active = isMobileTaskMode() && appState()?.activeTop === 'tasks';
    document.body.classList.toggle('mobile-tasks-active', Boolean(active));
  }

  window.renderTaskItem = renderTaskItemOptimized;
  window.renderTasksList = renderTasksListOptimized;
  window.refreshTasks = refreshTasksOptimized;
  window.openTaskModal = openTaskModalOptimized;
  window.closeTaskModal = closeTaskModalOptimized;
  if(typeof renderTaskItem !== 'undefined') renderTaskItem = renderTaskItemOptimized;
  if(typeof renderTasksList !== 'undefined') renderTasksList = renderTasksListOptimized;
  if(typeof refreshTasks !== 'undefined') refreshTasks = refreshTasksOptimized;
  if(typeof openTaskModal !== 'undefined') openTaskModal = openTaskModalOptimized;
  if(typeof closeTaskModal !== 'undefined') closeTaskModal = closeTaskModalOptimized;

  if(legacySetTop){
    const setTopOptimized = function(...args){
      const result = legacySetTop.apply(this, args);
      if(args[0] === 'tasks') visibleTaskCount = MOBILE_PAGE_SIZE;
      queueMicrotask(() => {
        syncTaskModeClass();
        if(appState()?.activeTop === 'tasks') refreshTasksOptimized();
      });
      return result;
    };
    window.setTop = setTopOptimized;
    if(typeof setTop !== 'undefined') setTop = setTopOptimized;
  }

  if(legacyRenderApp){
    const renderAppOptimized = function(...args){
      const result = legacyRenderApp.apply(this, args);
      queueMicrotask(() => {
        syncTaskModeClass();
        if(document.querySelector('#tasks-list')) refreshTasksOptimized();
      });
      return result;
    };
    window.renderApp = renderAppOptimized;
    if(typeof renderApp !== 'undefined') renderApp = renderAppOptimized;
  }

  document.addEventListener('click', event => {
    const toggle = event.target.closest('[data-mobile-task-toggle]');
    if(toggle){
      event.preventDefault();
      event.stopPropagation();
      const card = toggle.closest('.mobile-task-card');
      const body = card?.querySelector('.mobile-task-body');
      if(!body) return;
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      body.hidden = expanded;
      return;
    }

    const more = event.target.closest('[data-mobile-tasks-more]');
    if(more){
      event.preventDefault();
      event.stopPropagation();
      visibleTaskCount += MOBILE_PAGE_SIZE;
      refreshTasksOptimized();
    }
  }, true);

  document.addEventListener('keydown', event => {
    if(event.key === 'Escape' && document.body.classList.contains('task-modal-open')) closeTaskModalOptimized();
  });

  window.matchMedia('(max-width: 920px), (pointer: coarse)').addEventListener?.('change', () => {
    visibleTaskCount = MOBILE_PAGE_SIZE;
    syncTaskModeClass();
    refreshTasksOptimized();
  });
  window.addEventListener('resize', syncTaskModeClass, { passive:true });
  window.addEventListener('pageshow', () => {
    syncTaskModeClass();
    refreshTasksOptimized();
  });

  document.documentElement.dataset.mobileTasksPerformanceVersion = VERSION;
  syncTaskModeClass();
  refreshTasksOptimized();
})();

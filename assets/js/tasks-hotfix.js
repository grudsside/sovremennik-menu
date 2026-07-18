/* Современник task workflow hotfix — deadline, completion, deep links and controls */
(function(){
  'use strict';

  const VERSION = '2026-07-18-task-hotfix-1';

  function normalizedDeadlineKey(row, deadlineAt){
    const raw = row?.deadline || row?.dueDate || row?.due_date || (deadlineAt ? String(deadlineAt).slice(0,10) : '');
    return typeof normalizeDateKey === 'function' ? normalizeDateKey(raw || '') : String(raw || '').slice(0,10);
  }

  function normalizeTaskRowHotfix(row = {}){
    const deadlineAt = row.deadlineAt || row.dueAt || row.due_at || '';
    return {
      id: row.id || `task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: row.createdAt || row.created_at || new Date().toISOString(),
      authorName: row.authorName || row.author || row.creatorName || '',
      assignee: row.assignee || row.to || row.assigneeName || '',
      assigneeName: row.assigneeName || row.assignee || row.to || '',
      assigneeLogin: row.assigneeLogin || row.login || '',
      title: row.title || '',
      description: row.description || '',
      deadlineAt,
      deadline: normalizedDeadlineKey(row, deadlineAt),
      status: row.status || 'Актуальная',
      priority: row.priority || row.isVip || row.is_vip || '',
      completedAt: row.completedAt || row.completed_at || '',
      completedBy: row.completedBy || ''
    };
  }

  async function completeTaskHotfix(taskId, button){
    const task = typeof getTasks === 'function'
      ? getTasks().find(item => String(item.id) === String(taskId))
      : null;
    if(!task) return;
    if(!confirm(`Завершить задачу «${task.title || 'Задача'}»?`)) return;

    const originalLabel = button?.textContent || 'Завершить задачу';
    if(button){
      button.disabled = true;
      button.textContent = 'Завершаю…';
    }

    try {
      const isRemote = typeof isUuidLikeV21 === 'function' && isUuidLikeV21(taskId) && currentUser()?.id;
      if(isRemote){
        await sendPayloadToSheets({ payloadType:'taskComplete', taskId });
      }

      const rows = getTasks().filter(item => String(item.id) !== String(taskId));
      setLocalArray(TASKS_STORAGE_KEY, rows);
      state.tasks = rows;
      refreshTasks();
      if(isRemote) await loadTasks();
    } catch(error){
      console.error(error);
      alert('Не удалось завершить задачу: ' + (error.message || 'проверьте доступ и подключение.'));
      if(button){
        button.disabled = false;
        button.textContent = originalLabel;
      }
    }
  }

  function requestedTopFromHash(){
    return decodeURIComponent(String(location.hash || '').replace(/^#/, '')).split('/')[0];
  }

  function syncMandatoryTaskPermissionUi(){
    const input = document.querySelector('#role-permissions-form input[name="sections"][value="tasks"]');
    const form = input?.closest('form') || document.querySelector('#role-permissions-form');
    input?.closest('.permission-check')?.remove();
    if(form && !form.querySelector('[data-mandatory-tasks-note]')){
      const note = document.createElement('p');
      note.className = 'description mandatory-tasks-note';
      note.dataset.mandatoryTasksNote = '1';
      note.textContent = 'Раздел «Мои задачи» обязателен для всех авторизованных сотрудников и не отключается в правах роли.';
      const grid = form.querySelector('.permissions-grid');
      if(grid) grid.insertAdjacentElement('afterend', note);
      else form.prepend(note);
    }
  }

  function applyRequestedTaskRoute(){
    if(requestedTopFromHash() !== 'tasks') return;
    if(typeof isAuthenticated === 'function' && !isAuthenticated()) return;
    if(typeof state === 'undefined' || !state.menu) return;
    state.activeTop = 'tasks';
  }

  if(typeof normalizeTaskRow === 'function'){
    window.normalizeTaskRow = normalizeTaskRow = normalizeTaskRowHotfix;
  }
  if(typeof completeTask === 'function'){
    window.completeTask = completeTask = completeTaskHotfix;
  }

  if(typeof renderApp === 'function'){
    const renderAppBeforeTaskHotfix = renderApp;
    window.renderApp = renderApp = function(...args){
      applyRequestedTaskRoute();
      const result = renderAppBeforeTaskHotfix.apply(this, args);
      queueMicrotask(syncMandatoryTaskPermissionUi);
      return result;
    };
  }

  document.addEventListener('click', async event => {
    const refreshButton = event.target.closest('[data-refresh-service]');
    if(refreshButton){
      event.preventDefault();
      event.stopImmediatePropagation();
      const originalLabel = refreshButton.textContent;
      refreshButton.disabled = true;
      refreshButton.textContent = 'Обновляю…';
      try {
        await loadTasks();
        if(state.activeTop === 'home' && typeof loadScheduleEvents === 'function') await loadScheduleEvents();
      } finally {
        refreshButton.disabled = false;
        refreshButton.textContent = originalLabel;
      }
      return;
    }

    const openTaskButton = event.target.closest('[data-open-task-modal]');
    if(openTaskButton){
      event.preventDefault();
      event.stopImmediatePropagation();
      openTaskModal();
    }
  }, true);

  window.addEventListener('hashchange', () => {
    if(requestedTopFromHash() === 'tasks' && typeof isAuthenticated === 'function' && isAuthenticated()){
      state.activeTop = 'tasks';
      if(typeof renderApp === 'function') renderApp();
    }
  });

  document.documentElement.dataset.taskHotfixVersion = VERSION;
  applyRequestedTaskRoute();
  if(typeof isAuthenticated === 'function' && isAuthenticated() && typeof renderApp === 'function') renderApp();
  else syncMandatoryTaskPermissionUi();
})();

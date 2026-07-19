/* Современник emergency maintenance mode for the unstable tasks section */
(function(){
  'use strict';

  const VERSION = '2026-07-19-tasks-maintenance-1';
  const MESSAGE = 'Ведутся технические работы и раздел временно недоступен, приносим свои извинения.';

  function appState(){
    return typeof state !== 'undefined' ? state : null;
  }

  function clearTaskState(){
    const current = appState();
    if(!current) return;
    current.tasks = [];
    current.taskAssignees = [];
    current.taskLoading = false;
    current.taskError = '';
  }

  function maintenanceMarkup(){
    return `<div class="tasks-maintenance-card" role="status" aria-live="polite">
      <div class="tasks-maintenance-icon" aria-hidden="true">⚙</div>
      <p class="section-kicker">Технические работы</p>
      <h3>Раздел «Мои задачи» временно недоступен</h3>
      <p>${MESSAGE}</p>
    </div>`;
  }

  function replaceTaskPanel(){
    document.querySelectorAll('#task-modal').forEach(node => node.remove());
    document.body.classList.remove('task-modal-open', 'task-form-panel-open', 'mobile-tasks-active');

    const panel = document.querySelector('#top-tasks');
    if(!panel) return;
    panel.dataset.tasksMaintenance = '1';
    panel.innerHTML = `<div class="section-heading v3-section-heading"><p>Основное</p><h2>Мои задачи</h2></div>${maintenanceMarkup()}`;
  }

  function disabledAsync(){
    clearTaskState();
    replaceTaskPanel();
    return Promise.resolve([]);
  }

  function disabledSync(){
    clearTaskState();
    replaceTaskPanel();
    return [];
  }

  clearTaskState();

  window.activeTasks = function(){ return []; };
  window.renderTaskItem = function(){ return ''; };
  window.renderTasksList = maintenanceMarkup;
  window.renderTaskModal = function(){ return ''; };
  window.refreshTasks = disabledSync;
  window.loadTasks = disabledAsync;
  window.loadTaskAssignees = disabledAsync;
  window.refreshTaskModalAssignees = function(){};
  window.bindTaskCardEventsV21 = function(){};
  window.openTaskModal = disabledSync;
  window.closeTaskModal = disabledSync;
  window.completeTask = disabledAsync;
  window.deleteTaskV21 = disabledAsync;
  window.submitTask = function(event){
    event?.preventDefault?.();
    replaceTaskPanel();
  };

  if(typeof renderApp === 'function'){
    const renderAppBeforeMaintenance = renderApp;
    window.renderApp = renderApp = function(...args){
      clearTaskState();
      const result = renderAppBeforeMaintenance.apply(this, args);
      replaceTaskPanel();
      return result;
    };
  }

  if(typeof setTop === 'function'){
    const setTopBeforeMaintenance = setTop;
    window.setTop = setTop = function(target, ...args){
      clearTaskState();
      const result = setTopBeforeMaintenance.call(this, target, ...args);
      if(target === 'tasks') replaceTaskPanel();
      return result;
    };
  }

  document.addEventListener('click', event => {
    const taskAction = event.target.closest(
      '#top-tasks [data-open-task-modal], #top-tasks [data-refresh-service], #top-tasks [data-task-complete], #top-tasks [data-task-delete], #top-tasks [data-mobile-task-toggle], #top-tasks [data-mobile-tasks-more]'
    );
    if(!taskAction) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    replaceTaskPanel();
  }, true);

  document.documentElement.dataset.tasksMaintenanceVersion = VERSION;
  replaceTaskPanel();
})();

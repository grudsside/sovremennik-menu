/* Современник tasks v2 — isolated task lifecycle and Supabase data layer */
(function(global){
  'use strict';

  const VERSION = '2026-07-19-tasks-v2-2';
  const MOBILE_QUERY = '(max-width: 920px), (pointer: coarse)';
  const PAGE_SIZE = 24;
  const SUPPORTED_ROLES = new Set(['admin', 'manager', 'barista', 'waiter']);

  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[character]));
  }

  function normalizeRole(value){
    const role = String(value || '').trim().toLowerCase();
    const aliases = {
      'администратор':'admin',
      'руководитель':'manager',
      'менеджер':'manager',
      'бариста':'barista',
      'официант':'waiter'
    };
    return aliases[role] || role;
  }

  function roleLabel(value){
    return {
      admin:'Администратор',
      manager:'Руководитель',
      barista:'Бариста',
      waiter:'Официант'
    }[normalizeRole(value)] || 'Сотрудник';
  }

  function randomUuid(){
    if(global.crypto?.randomUUID) return global.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
      const random = Math.random() * 16 | 0;
      const value = character === 'x' ? random : (random & 0x3 | 0x8);
      return value.toString(16);
    });
  }

  function localDatetimeToIso(value){
    const raw = String(value || '').trim();
    if(!raw) return null;
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    const date = match
      ? new Date(
          Number(match[1]), Number(match[2]) - 1, Number(match[3]),
          Number(match[4]), Number(match[5]), Number(match[6] || 0)
        )
      : new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function parseTaskDate(task){
    const raw = task?.dueAt || task?.due_at || task?.dueDate || task?.due_date || '';
    if(!raw) return null;
    const value = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:00` : raw;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDateTime(value){
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime())
      ? date.toLocaleString('ru-RU', {
          day:'2-digit', month:'2-digit', year:'numeric',
          hour:'2-digit', minute:'2-digit'
        })
      : '—';
  }

  function deadlineLabel(task){
    const date = parseTaskDate(task);
    if(!date) return 'Без срока';
    const difference = date.getTime() - Date.now();
    const absolute = Math.abs(difference);
    if(difference < 0){
      const value = absolute < 86400000
        ? `${Math.max(1, Math.ceil(absolute / 3600000))} ч`
        : `${Math.max(1, Math.ceil(absolute / 86400000))} д`;
      return `Просрочено на ${value}`;
    }
    if(difference < 86400000){
      return `Осталось ${Math.max(1, Math.ceil(difference / 3600000))} ч`;
    }
    return `Осталось ${Math.max(1, Math.ceil(difference / 86400000))} д`;
  }

  function canCompleteTask(task, user){
    const role = normalizeRole(user?.role);
    if(!SUPPORTED_ROLES.has(role) || !user?.id) return false;
    if(role === 'admin') return true;
    if(String(task?.assigneeId || '') === String(user.id)) return true;
    return role === 'manager' && String(task?.creatorId || '') === String(user.id);
  }

  function canDeleteTask(user){
    return Boolean(user?.id) && normalizeRole(user?.role) === 'admin';
  }

  function requestedTopFromHash(value){
    const raw = String(value || '').replace(/^.*#/, '').split('/')[0].trim().toLowerCase();
    try { return decodeURIComponent(raw) === 'tasks' ? 'tasks' : ''; }
    catch(error){ return raw === 'tasks' ? 'tasks' : ''; }
  }

  function applyInitialRoute(appState, locationLike = global.location){
    if(!appState || requestedTopFromHash(locationLike?.hash || locationLike?.href) !== 'tasks') return false;
    appState.activeTop = 'tasks';
    return true;
  }

  function sortTasks(rows){
    return rows.slice().sort((left, right) => {
      const vipDifference = Number(Boolean(right.isVip)) - Number(Boolean(left.isVip));
      if(vipDifference) return vipDifference;
      const leftDue = parseTaskDate(left)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightDue = parseTaskDate(right)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if(leftDue !== rightDue) return leftDue - rightDue;
      return String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
    });
  }

  function normalizeTask(row, profilesById = new Map()){
    const creatorId = row?.creatorId || row?.creator_id || '';
    const assigneeId = row?.assigneeId || row?.assignee_id || '';
    const creator = profilesById.get(String(creatorId)) || row?.creator || {};
    const assignee = profilesById.get(String(assigneeId)) || row?.assignee || {};
    return {
      id:String(row?.id || ''),
      title:String(row?.title || 'Задача'),
      description:String(row?.description || ''),
      creatorId:String(creatorId || ''),
      creatorName:String(row?.creatorName || row?.authorName || creator?.name || 'Сотрудник'),
      assigneeId:String(assigneeId || ''),
      assigneeName:String(row?.assigneeName || assignee?.name || 'Сотрудник'),
      isVip:Boolean(row?.isVip ?? row?.is_vip),
      dueDate:row?.dueDate || row?.due_date || null,
      dueAt:row?.dueAt || row?.due_at || null,
      status:String(row?.status || 'open'),
      completedAt:row?.completedAt || row?.completed_at || null,
      createdAt:row?.createdAt || row?.created_at || new Date().toISOString()
    };
  }

  function createSupabaseDataLayer(options = {}){
    let assignees = null;
    let assigneePromise = null;

    function client(){
      const value = options.client || global.sovremennikSupabase;
      if(!value) throw new Error('Supabase временно недоступен.');
      return value;
    }

    async function notify(eventType, data){
      try {
        const instance = client();
        const sessionResult = await instance.auth.getSession();
        const token = sessionResult?.data?.session?.access_token;
        const config = global.SOVREMENNIK_SUPABASE || {};
        const url = options.notifyUrl || config.notifyFunctionUrl;
        if(!url || !token) return;
        const response = await global.fetch(url, {
          method:'POST',
          headers:{
            'Content-Type':'application/json',
            'Authorization':`Bearer ${token}`
          },
          body:JSON.stringify({ event_type:eventType, data })
        });
        if(!response.ok) console.warn('Task notification was not sent', response.status);
      } catch(error){
        console.warn('Task notification was not sent', error);
      }
    }

    async function listAssignees(){
      if(assignees) return assignees;
      if(assigneePromise) return assigneePromise;
      assigneePromise = (async () => {
        const result = await client()
          .from('profiles')
          .select('id, name, role, login, is_active')
          .eq('is_active', true)
          .order('name', { ascending:true });
        if(result.error) throw result.error;
        assignees = (result.data || []).map(profile => ({
          id:String(profile.id || ''),
          name:String(profile.name || ''),
          role:normalizeRole(profile.role),
          login:String(profile.login || '')
        })).filter(profile => profile.id && profile.name);
        return assignees;
      })().finally(() => { assigneePromise = null; });
      return assigneePromise;
    }

    async function listTasks(){
      const result = await client()
        .from('tasks')
        .select('id, title, description, creator_id, assignee_id, is_vip, due_date, due_at, status, completed_at, created_at, updated_at')
        .eq('status', 'open')
        .order('is_vip', { ascending:false })
        .order('due_at', { ascending:true, nullsFirst:false })
        .order('due_date', { ascending:true, nullsFirst:false })
        .order('created_at', { ascending:false });
      if(result.error) throw result.error;
      return result.data || [];
    }

    async function createTask(input, user){
      const dueAt = localDatetimeToIso(input.dueAt);
      if(input.dueAt && !dueAt) throw new Error('Проверьте дату и время дедлайна.');
      const row = {
        id:randomUuid(),
        title:input.title,
        description:input.description || '',
        creator_id:user.id,
        assignee_id:input.assigneeId,
        is_vip:Boolean(input.isVip),
        due_date:input.dueAt ? String(input.dueAt).slice(0, 10) : null,
        due_at:dueAt
      };
      const result = await client().from('tasks').insert(row);
      if(result.error) throw result.error;
      void notify('task_assigned', { task_id:row.id });
      return { ...row, status:'open', created_at:new Date().toISOString() };
    }

    async function completeTask(taskId){
      const completedAt = new Date().toISOString();
      const result = await client()
        .from('tasks')
        .update({ status:'done', completed_at:completedAt })
        .eq('id', taskId)
        .select('id, status, completed_at')
        .maybeSingle();
      if(result.error) throw result.error;
      if(!result.data) throw new Error('Задача уже завершена или у вас нет доступа.');
      void notify('task_completed', { task_id:taskId });
      return result.data;
    }

    async function deleteTask(taskId){
      const result = await client()
        .from('tasks')
        .delete()
        .eq('id', taskId)
        .select('id')
        .maybeSingle();
      if(result.error) throw result.error;
      if(!result.data) throw new Error('Задача уже удалена или у вас нет доступа.');
      return result.data;
    }

    return {
      listTasks,
      listAssignees,
      createTask,
      completeTask,
      deleteTask
    };
  }

  function createModule(options = {}){
    const dataLayer = options.dataLayer || createSupabaseDataLayer(options);
    const getCurrentUser = options.getCurrentUser || (() => global.currentUser?.() || null);
    const askConfirmation = options.confirm || (message => global.confirm?.(message) !== false);
    const maintenanceEnabled = options.maintenanceEnabled || (() => (
      global.SOVREMENNIK_TASKS_MAINTENANCE === true
      || Boolean(global.document?.documentElement?.dataset?.tasksMaintenanceVersion)
    ));

    let root = null;
    let active = false;
    let generation = 0;
    let entryPromise = null;
    let assigneePromise = null;
    let assignees = null;
    let tasks = [];
    let visibleCount = PAGE_SIZE;
    let lastActiveCount = 0;
    let loading = false;
    let errorMessage = '';
    let assigneeError = '';
    let formOpen = false;
    const expandedTasks = new Set();
    const pendingActions = new Set();
    const instrumentation = {
      activations:0,
      deactivations:0,
      taskListRequests:0,
      assigneeRequests:0,
      renders:0,
      listenerAdds:0,
      listenerRemoves:0,
      formOpens:0,
      formCloses:0,
      creates:0,
      completions:0,
      deletions:0,
      showMore:0
    };

    function profileMap(){
      return new Map((assignees || []).map(profile => [String(profile.id), profile]));
    }

    function normalizeRows(rows){
      const profiles = profileMap();
      return sortTasks((rows || [])
        .map(row => normalizeTask(row, profiles))
        .filter(task => task.id && task.status === 'open'));
    }

    function renderTaskCard(task, user){
      const expanded = expandedTasks.has(task.id);
      const completeAllowed = canCompleteTask(task, user);
      const deleteAllowed = canDeleteTask(user);
      return `<article class="tasks-v2__card${task.isVip ? ' tasks-v2__card--vip' : ''}" data-tasks-v2-card data-task-id="${escapeHtml(task.id)}">
        <button class="tasks-v2__summary" type="button" data-tasks-v2-action="toggle" data-task-id="${escapeHtml(task.id)}" aria-expanded="${expanded}">
          <span class="tasks-v2__summary-main">
            <span class="tasks-v2__title">${escapeHtml(task.title)}</span>
            <span class="tasks-v2__meta-line">${task.isVip ? '<b class="tasks-v2__vip">VIP</b>' : ''}<span>${escapeHtml(formatDateTime(task.dueAt || task.dueDate))}</span><span>Исполнитель: ${escapeHtml(task.assigneeName)}</span></span>
          </span>
          <span class="tasks-v2__deadline">${escapeHtml(deadlineLabel(task))}</span>
        </button>
        <div class="tasks-v2__details" data-tasks-v2-body${expanded ? '' : ' hidden'}>
          ${task.description ? `<p>${escapeHtml(task.description)}</p>` : '<p class="tasks-v2__muted">Описание не добавлено.</p>'}
          <dl class="tasks-v2__facts">
            <div><dt>Автор</dt><dd>${escapeHtml(task.creatorName)}</dd></div>
            <div><dt>Создано</dt><dd>${escapeHtml(formatDateTime(task.createdAt))}</dd></div>
          </dl>
          ${(completeAllowed || deleteAllowed) ? `<div class="tasks-v2__card-actions">
            ${completeAllowed ? `<button type="button" class="tasks-v2__button" data-tasks-v2-action="complete" data-task-id="${escapeHtml(task.id)}" ${pendingActions.has(`complete:${task.id}`) ? 'disabled' : ''}>${pendingActions.has(`complete:${task.id}`) ? 'Завершаю…' : 'Завершить'}</button>` : ''}
            ${deleteAllowed ? `<button type="button" class="tasks-v2__button tasks-v2__button--danger" data-tasks-v2-action="delete" data-task-id="${escapeHtml(task.id)}" ${pendingActions.has(`delete:${task.id}`) ? 'disabled' : ''}>${pendingActions.has(`delete:${task.id}`) ? 'Удаляю…' : 'Удалить'}</button>` : ''}
          </div>` : ''}
        </div>
      </article>`;
    }

    function renderForm(user){
      const optionsMarkup = (assignees || []).map(profile => (
        `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)} · ${escapeHtml(roleLabel(profile.role))}</option>`
      )).join('');
      return `<section class="tasks-v2__form" aria-labelledby="tasks-v2-form-title">
        <div class="tasks-v2__form-heading">
          <div><p class="tasks-v2__kicker">Новая задача</p><h3 id="tasks-v2-form-title">Поставить задачу</h3></div>
          <button type="button" class="tasks-v2__button tasks-v2__button--secondary" data-tasks-v2-action="form-close">Закрыть</button>
        </div>
        <form data-tasks-v2-form>
          <div class="tasks-v2__form-grid">
            <label>Название<input name="title" type="text" maxlength="180" required autocomplete="off" placeholder="Например, проверить витрину"></label>
            <label>Исполнитель<select name="assigneeId" required><option value="">Выберите сотрудника</option>${optionsMarkup}</select></label>
            <label>Дедлайн<input name="dueAt" type="datetime-local"></label>
            <div class="tasks-v2__author"><span>Автор</span><strong>${escapeHtml(user?.name || 'Сотрудник')}</strong></div>
          </div>
          <label>Описание<textarea name="description" rows="4" maxlength="2000" placeholder="Что нужно сделать и на что обратить внимание"></textarea></label>
          <label class="tasks-v2__checkbox"><input name="isVip" type="checkbox"><span>VIP-приоритет</span></label>
          <div class="tasks-v2__form-actions">
            <button type="button" class="tasks-v2__button tasks-v2__button--secondary" data-tasks-v2-action="form-close">Отмена</button>
            <button type="submit" class="tasks-v2__button">Поставить задачу</button>
          </div>
          <p class="tasks-v2__form-status" data-tasks-v2-form-status aria-live="polite"></p>
        </form>
      </section>`;
    }

    function render(){
      if(!active || !root) return;
      instrumentation.renders += 1;
      const user = getCurrentUser();
      const refreshDisabled = loading || pendingActions.has('refresh');
      let content = '';
      if(loading && !tasks.length){
        content = '<div class="tasks-v2__state" role="status">Загружаю задачи…</div>';
      } else if(errorMessage && !tasks.length){
        content = `<div class="tasks-v2__state tasks-v2__state--error"><p>${escapeHtml(errorMessage)}</p><button class="tasks-v2__button tasks-v2__button--secondary" type="button" data-tasks-v2-action="refresh">Повторить</button></div>`;
      } else if(!tasks.length){
        content = '<div class="tasks-v2__state">Актуальных задач для вас пока нет.</div>';
      } else {
        const visibleTasks = tasks.slice(0, visibleCount);
        const remaining = Math.max(0, tasks.length - visibleTasks.length);
        content = `<div class="tasks-v2__list">${visibleTasks.map(task => renderTaskCard(task, user)).join('')}</div>
          ${remaining ? `<div class="tasks-v2__more"><button class="tasks-v2__button tasks-v2__button--secondary" type="button" data-tasks-v2-action="show-more">Показать ещё · ${Math.min(PAGE_SIZE, remaining)}</button><span>Показано ${visibleTasks.length} из ${tasks.length}</span></div>` : ''}`;
      }

      root.className = 'tasks-v2';
      root.innerHTML = `<div class="tasks-v2__heading">
          <div><p class="tasks-v2__kicker">Основное</p><h2>Мои задачи</h2><p>Задачи, которые вы создали или выполняете.</p></div>
          <div class="tasks-v2__toolbar">
            <button type="button" class="tasks-v2__button tasks-v2__button--secondary" data-tasks-v2-action="refresh" ${refreshDisabled ? 'disabled' : ''}>${refreshDisabled ? 'Обновляю…' : 'Обновить'}</button>
            <button type="button" class="tasks-v2__button" data-tasks-v2-action="form-open" ${!assignees?.length || Boolean(assigneeError) ? 'disabled' : ''}>Поставить задачу</button>
          </div>
        </div>
        ${errorMessage && tasks.length ? `<p class="tasks-v2__notice tasks-v2__notice--error">${escapeHtml(errorMessage)}</p>` : ''}
        ${assigneeError ? `<p class="tasks-v2__notice tasks-v2__notice--error">Список исполнителей недоступен: ${escapeHtml(assigneeError)}</p>` : ''}
        ${content}
        ${formOpen ? renderForm(user) : ''}`;
    }

    async function ensureAssignees(){
      if(assignees) return assignees;
      if(assigneePromise) return assigneePromise;
      instrumentation.assigneeRequests += 1;
      assigneePromise = Promise.resolve(dataLayer.listAssignees())
        .then(rows => {
          assignees = (rows || []).map(profile => ({
            id:String(profile.id || ''),
            name:String(profile.name || ''),
            role:normalizeRole(profile.role),
            login:String(profile.login || '')
          })).filter(profile => profile.id && profile.name);
          return assignees;
        })
        .finally(() => { assigneePromise = null; });
      return assigneePromise;
    }

    async function requestTasks(){
      instrumentation.taskListRequests += 1;
      return dataLayer.listTasks();
    }

    async function loadEntry(currentGeneration){
      loading = true;
      errorMessage = '';
      assigneeError = '';
      render();
      const [taskResult, assigneeResult] = await Promise.allSettled([
        requestTasks(),
        ensureAssignees()
      ]);
      if(!active || currentGeneration !== generation) return [];

      if(assigneeResult.status === 'rejected'){
        assigneeError = assigneeResult.reason?.message || 'не удалось загрузить сотрудников';
      }
      if(taskResult.status === 'fulfilled'){
        tasks = normalizeRows(taskResult.value);
        visibleCount = PAGE_SIZE;
        lastActiveCount = tasks.length;
      } else {
        tasks = [];
        errorMessage = taskResult.reason?.message || 'Не удалось загрузить задачи.';
      }
      loading = false;
      render();
      return tasks;
    }

    async function refresh(){
      if(!active || pendingActions.has('refresh')) return tasks;
      const currentGeneration = generation;
      pendingActions.add('refresh');
      loading = true;
      errorMessage = '';
      render();
      try {
        const rows = await requestTasks();
        if(active && currentGeneration === generation){
          tasks = normalizeRows(rows);
          visibleCount = PAGE_SIZE;
          lastActiveCount = tasks.length;
          expandedTasks.clear();
        }
      } catch(error){
        if(active && currentGeneration === generation){
          errorMessage = error?.message || 'Не удалось обновить задачи.';
        }
      } finally {
        if(active && currentGeneration === generation){
          pendingActions.delete('refresh');
          loading = false;
          render();
        }
      }
      return tasks;
    }

    function field(form, name){
      return form?.elements?.namedItem?.(name) || form?.elements?.[name] || null;
    }

    function setFormBusy(form, busy, message, isError = false){
      const button = form?.querySelector?.('button[type="submit"]');
      const status = form?.querySelector?.('[data-tasks-v2-form-status]');
      if(button){
        button.disabled = busy;
        button.textContent = busy ? 'Сохраняю…' : 'Поставить задачу';
      }
      if(status){
        status.textContent = message || '';
        status.classList?.toggle?.('tasks-v2__form-status--error', Boolean(isError));
      }
    }

    async function submitTask(form){
      if(pendingActions.has('create')) return;
      const user = getCurrentUser();
      if(!user?.id){
        setFormBusy(form, false, 'Нужно войти в аккаунт.', true);
        return;
      }
      const title = String(field(form, 'title')?.value || '').trim();
      const description = String(field(form, 'description')?.value || '').trim();
      const assigneeId = String(field(form, 'assigneeId')?.value || '').trim();
      const dueAt = String(field(form, 'dueAt')?.value || '').trim();
      const isVip = Boolean(field(form, 'isVip')?.checked);
      if(!title || !assigneeId){
        setFormBusy(form, false, 'Заполните название и выберите исполнителя.', true);
        return;
      }

      const currentGeneration = generation;
      pendingActions.add('create');
      setFormBusy(form, true, 'Сохраняю задачу…');
      try {
        const row = await dataLayer.createTask({ title, description, assigneeId, dueAt, isVip }, user);
        if(!active || currentGeneration !== generation) return;
        const task = normalizeTask(row, profileMap());
        tasks = sortTasks([task, ...tasks.filter(item => item.id !== task.id)]);
        lastActiveCount = tasks.length;
        instrumentation.creates += 1;
        formOpen = false;
        render();
      } catch(error){
        if(active && currentGeneration === generation){
          setFormBusy(form, false, error?.message || 'Не удалось поставить задачу.', true);
        }
      } finally {
        if(currentGeneration === generation) pendingActions.delete('create');
      }
    }

    async function complete(taskId){
      const key = `complete:${taskId}`;
      if(pendingActions.has(key)) return;
      const task = tasks.find(item => item.id === taskId);
      const user = getCurrentUser();
      if(!task || !canCompleteTask(task, user)) return;
      if(!askConfirmation(`Завершить задачу «${task.title}»?`)) return;
      const currentGeneration = generation;
      pendingActions.add(key);
      render();
      try {
        await dataLayer.completeTask(taskId);
        if(!active || currentGeneration !== generation) return;
        tasks = tasks.filter(item => item.id !== taskId);
        lastActiveCount = tasks.length;
        instrumentation.completions += 1;
        errorMessage = '';
      } catch(error){
        if(active && currentGeneration === generation){
          errorMessage = error?.message || 'Не удалось завершить задачу.';
        }
      } finally {
        if(currentGeneration === generation){
          pendingActions.delete(key);
          render();
        }
      }
    }

    async function remove(taskId){
      const key = `delete:${taskId}`;
      if(pendingActions.has(key)) return;
      const task = tasks.find(item => item.id === taskId);
      const user = getCurrentUser();
      if(!task || !canDeleteTask(user)) return;
      if(!askConfirmation(`Удалить задачу «${task.title}»?`)) return;
      const currentGeneration = generation;
      pendingActions.add(key);
      render();
      try {
        await dataLayer.deleteTask(taskId);
        if(!active || currentGeneration !== generation) return;
        tasks = tasks.filter(item => item.id !== taskId);
        lastActiveCount = tasks.length;
        instrumentation.deletions += 1;
        errorMessage = '';
      } catch(error){
        if(active && currentGeneration === generation){
          errorMessage = error?.message || 'Не удалось удалить задачу.';
        }
      } finally {
        if(currentGeneration === generation){
          pendingActions.delete(key);
          render();
        }
      }
    }

    async function onClick(event){
      const action = event.target?.closest?.('[data-tasks-v2-action]');
      if(!action || !root?.contains?.(action)) return;
      event.preventDefault?.();
      const name = action.dataset.tasksV2Action;
      const taskId = String(action.dataset.taskId || '');
      if(name === 'form-open'){
        if(!assignees?.length || assigneeError) return;
        formOpen = true;
        instrumentation.formOpens += 1;
        render();
      } else if(name === 'form-close'){
        formOpen = false;
        instrumentation.formCloses += 1;
        render();
      } else if(name === 'refresh'){
        await refresh();
      } else if(name === 'show-more'){
        visibleCount = Math.min(tasks.length, visibleCount + PAGE_SIZE);
        instrumentation.showMore += 1;
        render();
      } else if(name === 'toggle' && taskId){
        if(expandedTasks.has(taskId)) expandedTasks.delete(taskId);
        else expandedTasks.add(taskId);
        render();
      } else if(name === 'complete' && taskId){
        await complete(taskId);
      } else if(name === 'delete' && taskId){
        await remove(taskId);
      }
    }

    async function onSubmit(event){
      const form = event.target;
      if(!form?.matches?.('[data-tasks-v2-form]') || !root?.contains?.(form)) return;
      event.preventDefault?.();
      await submitTask(form);
    }

    function bind(){
      root.addEventListener('click', onClick);
      root.addEventListener('submit', onSubmit);
      instrumentation.listenerAdds += 2;
    }

    function unbind(){
      if(!root) return;
      root.removeEventListener('click', onClick);
      root.removeEventListener('submit', onSubmit);
      instrumentation.listenerRemoves += 2;
    }

    function deactivate(){
      generation += 1;
      entryPromise = null;
      if(root){
        unbind();
        root.innerHTML = '';
        root.className = '';
      }
      if(active) instrumentation.deactivations += 1;
      active = false;
      root = null;
      formOpen = false;
      loading = false;
      errorMessage = '';
      assigneeError = '';
      tasks = [];
      visibleCount = PAGE_SIZE;
      expandedTasks.clear();
      pendingActions.clear();
    }

    function activate(nextRoot){
      if(maintenanceEnabled()){
        deactivate();
        return Promise.resolve([]);
      }
      if(!nextRoot) return Promise.reject(new Error('Не найден корень раздела задач.'));
      if(active && root === nextRoot) return entryPromise || Promise.resolve(tasks);
      if(active || root) deactivate();
      root = nextRoot;
      active = true;
      generation += 1;
      instrumentation.activations += 1;
      bind();
      const currentGeneration = generation;
      entryPromise = loadEntry(currentGeneration).finally(() => {
        if(currentGeneration === generation) entryPromise = null;
      });
      return entryPromise;
    }

    return {
      activate,
      deactivate,
      refresh,
      ownsRoot:candidate => active && root === candidate,
      getActiveCount:() => active ? tasks.length : lastActiveCount,
      getInstrumentation:() => ({
        ...instrumentation,
        active,
        listenerBalance:instrumentation.listenerAdds - instrumentation.listenerRemoves
      }),
      getSnapshot:() => ({
        active,
        formOpen,
        visibleCount:Math.min(visibleCount, tasks.length),
        tasks:tasks.map(task => ({ ...task })),
        assignees:(assignees || []).map(profile => ({ ...profile }))
      })
    };
  }

  let defaultModule = null;
  function instance(){
    if(!defaultModule) defaultModule = createModule();
    return defaultModule;
  }

  global.SovremennikTasksV2 = Object.freeze({
    VERSION,
    MOBILE_QUERY,
    PAGE_SIZE,
    requestedTopFromHash,
    applyInitialRoute,
    normalizeTask,
    canCompleteTask,
    canDeleteTask,
    createSupabaseDataLayer,
    createModule,
    activate:root => instance().activate(root),
    deactivate:() => instance().deactivate(),
    refresh:() => instance().refresh(),
    ownsRoot:root => instance().ownsRoot(root),
    getActiveCount:() => instance().getActiveCount(),
    getInstrumentation:() => instance().getInstrumentation()
  });
})(window);

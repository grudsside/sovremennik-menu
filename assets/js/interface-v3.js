/* Современник interface v3 — approved navigation, dashboard and responsive fixes */
(function(){
  'use strict';

  const VERSION = '2026-07-19-v4';
  const navMeta = {
    home: ['Главная','Рабочая база и документы'],
    tasks: ['Мои задачи','Актуальные задачи и сроки'],
    method: ['Методичка','Меню, составы и рекомендации'],
    theory: ['Теория','Обучающие материалы'],
    checklists: ['Чек-листы','Рабочие задачи смены'],
    revisions: ['Ревизии','Учёт и расхождения'],
    techcards: ['Тех. карты','Ингредиенты и технологии'],
    schedule: ['Расписание','Смены и рабочие события'],
    reportError: ['Сообщить об ошибке','Обратная связь по сервису'],
    employees: ['Сотрудники','Управление командой'],
    control: ['Контроль','Отчёты и проверки']
  };

  const navGroups = [
    { title:'Основное', ids:['home','tasks','method','theory'] },
    { title:'Работа', ids:['checklists','revisions','techcards','schedule','reportError'] },
    { title:'Управление', ids:['employees','control'] }
  ];

  const iconPaths = {
    home:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/>',
    tasks:'<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M9 4.5h6"/><path d="m8.5 11 1.5 1.5 3-3"/><path d="M8.5 16h7"/>',
    method:'<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v17H6.5A2.5 2.5 0 0 0 4 22.5z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v17h4.5A2.5 2.5 0 0 1 20 22.5z"/>',
    theory:'<path d="M3.5 10.5 12 5l8.5 5.5L12 16z"/><path d="M7 13.5V18c2.8 1.7 7.2 1.7 10 0v-4.5"/><path d="M20.5 10.5V16"/>',
    checklists:'<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="m3.5 6 1.5 1.5L7.5 5"/><path d="m3.5 12 1.5 1.5 2.5-2.5"/><path d="m3.5 18 1.5 1.5 2.5-2.5"/>',
    revisions:'<path d="M6 3h12v18H6z"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M9 15h4"/>',
    techcards:'<path d="M9 3h6"/><path d="M10 3v5l-5 9a2.5 2.5 0 0 0 2.2 3.7h9.6A2.5 2.5 0 0 0 19 17l-5-9V3"/><path d="M8 14h8"/>',
    schedule:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M7 14h2M11 14h2M15 14h2M7 18h2M11 18h2"/>',
    reportError:'<path d="M12 3 2.8 20h18.4z"/><path d="M12 9v5"/><path d="M12 18h.01"/>',
    employees:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    control:'<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20V7"/><path d="M2 20h22"/>'
  };

  const legacy = {
    allMainTabs: typeof allMainTabs === 'function' ? allMainTabs : null,
    hasAccess: typeof hasAccess === 'function' ? hasAccess : null,
    renderApp: typeof renderApp === 'function' ? renderApp : null,
    setTop: typeof setTop === 'function' ? setTop : null,
    renderHome: typeof renderHome === 'function' ? renderHome : null,
    renderReportError: typeof renderReportError === 'function' ? renderReportError : null,
    submitErrorReport: typeof submitErrorReport === 'function' ? submitErrorReport : null,
    refreshSchedule: typeof refreshSchedule === 'function' ? refreshSchedule : null,
    loadScheduleEvents: typeof loadScheduleEvents === 'function' ? loadScheduleEvents : null,
    loadRolePermissions: typeof loadRolePermissions === 'function' ? loadRolePermissions : null
  };

  function tasksV2(){
    return window.SovremennikTasksV2 || null;
  }

  function localDateKey(date = new Date()){
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2,'0');
    const d = String(date.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }

  function dateFromKey(key){
    const match = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function ensureTasksPermission(){
    try {
      if(Array.isArray(ALL_SECTIONS) && !ALL_SECTIONS.includes('tasks')) ALL_SECTIONS.splice(1,0,'tasks');
      const permissionMaps = [
        typeof DEFAULT_ACCESS_BY_ROLE !== 'undefined' ? DEFAULT_ACCESS_BY_ROLE : null,
        typeof ACCESS_BY_ROLE !== 'undefined' ? ACCESS_BY_ROLE : null,
        typeof state !== 'undefined' ? state.rolePermissions : null
      ].filter(Boolean);
      permissionMaps.forEach(map => {
        Object.keys(map).forEach(role => {
          if(!Array.isArray(map[role])) return;
          if(!map[role].includes('tasks')){
            const homeIndex = map[role].indexOf('home');
            map[role].splice(homeIndex >= 0 ? homeIndex + 1 : 0, 0, 'tasks');
          }
        });
      });
    } catch(error){
      console.warn('Task permission enhancement skipped', error);
    }
  }

  function tabsWithTasks(){
    const base = legacy.allMainTabs ? legacy.allMainTabs() : [];
    const rows = Array.isArray(base) ? base.slice() : [];
    if(!rows.some(tab => tab.id === 'tasks')){
      const homeIndex = rows.findIndex(tab => tab.id === 'home');
      rows.splice(homeIndex >= 0 ? homeIndex + 1 : 0, 0, { id:'tasks', title:'Мои задачи' });
    }
    return rows;
  }

  function accessWithTasks(target){
    if(target === 'tasks') return typeof isAuthenticated === 'function' ? isAuthenticated() : true;
    return legacy.hasAccess ? legacy.hasAccess(target) : true;
  }

  function scheduleRows(){
    try {
      if(typeof getScheduleEvents === 'function') return getScheduleEvents() || [];
      if(Array.isArray(state?.scheduleEvents)) return state.scheduleEvents;
      return [];
    } catch(error){ return []; }
  }

  function shiftEmployeeName(event){
    const title = String(event?.title || '').trim();
    const description = String(event?.description || '').trim();
    const explicit = description.match(/(?:сотрудник|сотрудники|бариста|официант|администратор)\s*[:—-]\s*([^,;\n]+)/i);
    if(explicit?.[1]) return explicit[1].trim();
    const cleaned = title
      .replace(/^смена\s*[:—-]?\s*/i,'')
      .replace(/\s+(?:с|от)?\s*\d{1,2}[.:]\d{2}\s*[—–-]\s*\d{1,2}[.:]\d{2}.*$/i,'')
      .trim();
    if(cleaned && cleaned.toLowerCase() !== 'смена') return cleaned;
    return String(event?.employeeName || '').trim() || 'Сотрудник';
  }

  function shiftTimeText(event){
    const source = `${event?.title || ''} ${event?.description || ''}`;
    const range = source.match(/(\d{1,2}[.:]\d{2})\s*[—–-]\s*(\d{1,2}[.:]\d{2})/);
    if(range) return `${range[1].replace('.',':')}–${range[2].replace('.',':')}`;
    const single = source.match(/(?:с|начало)\s*(\d{1,2}[.:]\d{2})/i);
    if(single) return `с ${single[1].replace('.',':')}`;
    return 'время не указано';
  }

  function todayShiftEvents(){
    const key = localDateKey();
    const seen = new Set();
    return scheduleRows()
      .filter(event => String(event?.type || '').toLowerCase().includes('смен'))
      .filter(event => (typeof normalizeDateKey === 'function' ? normalizeDateKey(event.eventDate) : event.eventDate) === key)
      .map(event => ({ event, name:shiftEmployeeName(event), time:shiftTimeText(event) }))
      .filter(item => {
        const marker = `${item.name.toLowerCase()}|${item.time}`;
        if(seen.has(marker)) return false;
        seen.add(marker);
        return true;
      });
  }

  function upcomingScheduleEvents(limit = 4){
    const today = dateFromKey(localDateKey());
    return scheduleRows()
      .map(event => ({ event, key:typeof normalizeDateKey === 'function' ? normalizeDateKey(event.eventDate) : event.eventDate }))
      .map(item => ({ ...item, date:dateFromKey(item.key) }))
      .filter(item => item.date && item.date >= today)
      .sort((a,b) => a.date - b.date || String(a.event.title || '').localeCompare(String(b.event.title || ''),'ru'))
      .slice(0,limit);
  }

  function renderShiftRoster(){
    const shifts = todayShiftEvents();
    if(state?.scheduleLoading && !shifts.length){
      return '<div class="v3-empty-inline">Загружаю расписание смены…</div>';
    }
    if(!shifts.length){
      return '<div class="v3-empty-inline"><strong>Смена на сегодня не указана</strong><span>Сотрудники появятся здесь после добавления смен в расписание.</span></div>';
    }
    return `<div class="v3-shift-list">${shifts.map(item => `
      <div class="v3-shift-person">
        <span class="v3-avatar" aria-hidden="true">${esc(item.name.slice(0,1).toUpperCase())}</span>
        <span class="v3-shift-copy"><strong>${esc(item.name)}</strong><small>${esc(item.time)}</small></span>
      </div>`).join('')}</div>`;
  }

  function renderUpcoming(){
    const rows = upcomingScheduleEvents();
    if(state?.scheduleLoading && !rows.length) return '<div class="v3-empty-inline">Загружаю ближайшие события…</div>';
    if(!rows.length) return '<div class="v3-empty-inline"><strong>Ближайших событий нет</strong><span>Новые смены и мероприятия появятся здесь автоматически.</span></div>';
    return `<div class="v3-upcoming-list">${rows.map(({event,key}) => {
      const date = dateFromKey(key);
      const label = date ? date.toLocaleDateString('ru-RU',{day:'2-digit',month:'short'}) : key;
      return `<button type="button" class="v3-upcoming-item" data-top-jump="schedule"><span class="v3-date-chip">${esc(label)}</span><span><strong>${esc(event.title || event.type || 'Событие')}</strong><small>${esc(event.type || 'Мероприятие')}${event.description ? ` · ${esc(event.description)}` : ''}</small></span></button>`;
    }).join('')}</div>`;
  }

  function renderHomeMetrics(){
    const taskCount = tasksV2()?.getActiveCount?.() || 0;
    const checklistCount = Array.isArray(state?.menu?.checklists) ? state.menu.checklists.length : 0;
    const shiftCount = todayShiftEvents().length;
    const nextCount = upcomingScheduleEvents(50).length;
    return `<div class="v3-metrics-grid">
      <div class="v3-metric"><span>Мои задачи</span><strong>${taskCount}</strong><small>актуальных</small></div>
      <div class="v3-metric"><span>Сегодня в смене</span><strong>${shiftCount}</strong><small>сотрудников</small></div>
      <div class="v3-metric"><span>Чек-листы</span><strong>${checklistCount}</strong><small>доступно</small></div>
      <div class="v3-metric"><span>В расписании</span><strong>${nextCount}</strong><small>будущих событий</small></div>
    </div>`;
  }

  function renderHomeV3(){
    const user = typeof currentUser === 'function' ? currentUser() : null;
    const firstName = String(user?.name || '').trim().split(/\s+/)[0] || 'сотрудник';
    return `<section class="top-panel ${state.activeTop === 'home' ? 'active' : ''}" id="top-home">
      <section class="v3-welcome-card">
        <div class="v3-welcome-copy">
          <p class="section-kicker">Рабочая база</p>
          <h1>Всё необходимое для смены — в одном месте.</h1>
          <p>${esc(firstName)}, здесь собраны актуальные задачи, расписание, чек-листы, методические материалы и рабочие документы.</p>
          <div class="v3-welcome-actions">
            <button class="small-action" type="button" data-top-jump="tasks">Открыть мои задачи</button>
            <button class="small-action secondary" type="button" data-top-jump="checklists">Перейти к чек-листам</button>
          </div>
        </div>
        <div class="v3-welcome-status">
          <span>Сегодня</span>
          <strong>${new Date().toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'})}</strong>
          <small>Данные обновляются из задач и расписания</small>
        </div>
      </section>

      <div class="v3-home-grid">
        <section class="v3-dashboard-card v3-shift-card">
          <div class="v3-card-head"><div><p class="section-kicker">Команда</p><h2>Сегодняшняя смена</h2></div><button class="v3-text-button" type="button" data-top-jump="schedule">Расписание</button></div>
          <div id="v3-shift-roster">${renderShiftRoster()}</div>
        </section>
        <section class="v3-dashboard-card v3-upcoming-card">
          <div class="v3-card-head"><div><p class="section-kicker">План</p><h2>Ближайшие события</h2></div><button class="v3-text-button" type="button" data-top-jump="schedule">Весь месяц</button></div>
          <div id="v3-upcoming-events">${renderUpcoming()}</div>
        </section>
      </div>

      <section class="v3-dashboard-card v3-summary-card">
        <div class="v3-card-head"><div><p class="section-kicker">Сводка</p><h2>Рабочая информация</h2></div><button class="v3-text-button" type="button" data-refresh-service>Обновить</button></div>
        <div id="v3-home-metrics">${renderHomeMetrics()}</div>
      </section>

      <div class="home-dashboard v3-home-dashboard" aria-label="Настройки уведомлений"></div>
    </section>`;
  }

  function renderTasksPanel(){
    return `<section class="top-panel ${state.activeTop === 'tasks' ? 'active' : ''}" id="top-tasks">
      <div data-tasks-v2-root></div>
    </section>`;
  }

  function renderReportErrorV3(){
    return `<section class="top-panel ${state.activeTop === 'reportError' ? 'active' : ''}" id="top-reportError">
      <div class="section-heading"><p>Обратная связь</p><h2>Сообщить об ошибке</h2></div>
      <div class="report-layout"><div class="report-card v3-report-card">
        <p class="description">Укажите раздел, выберите тип проблемы и подробно опишите, что нужно исправить.</p>
        <form class="report-form" id="error-report-form">
          <div class="form-grid">
            <label>Раздел<select name="section"><option>Методичка</option><option>Теория</option><option>Чек-листы</option><option>Ревизии</option><option>Тех. карты</option><option>Расписание</option><option>Уведомления</option><option>Интерфейс сервиса</option><option>Другое</option></select></label>
            <label>Тип ошибки<select name="errorType"><option>Неверная информация</option><option>Не открывается файл</option><option>Не работает кнопка</option><option>Ошибка отображения</option><option>Ошибка доступа</option><option>Другое</option></select></label>
          </div>
          <label>Описание ошибки<textarea name="text" required placeholder="Опишите, что произошло, на каком устройстве и что ожидалось увидеть"></textarea></label>
          <button class="small-action" type="submit">Отправить</button>
          <p class="submit-status error-report-status" aria-live="polite"></p>
        </form>
      </div></div>
    </section>`;
  }

  async function submitErrorReportV3(event){
    event.preventDefault();
    const form = event.currentTarget;
    const status = form.querySelector('.error-report-status');
    const submitButton = form.querySelector('button[type="submit"]');
    const details = String(form.elements.text?.value || '').trim();
    const section = String(form.elements.section?.value || 'Другое').trim();
    const errorType = String(form.elements.errorType?.value || 'Другое').trim();
    if(!details){
      if(status){ status.textContent = 'Опишите ошибку.'; status.className = 'submit-status error'; }
      return;
    }
    const text = `[Раздел: ${section}] [Тип: ${errorType}] ${details}`;
    const record = { id:typeof makeUuidV26 === 'function' ? makeUuidV26() : `err-${Date.now()}`, text, employeeName:currentUserName(), createdAt:new Date().toISOString() };
    if(status){ status.textContent = 'Отправляю сообщение…'; status.className = 'submit-status'; }
    if(submitButton) submitButton.disabled = true;
    try {
      const saved = await sendPayloadToSheets({ payloadType:'errorReport', id:record.id, text, employeeName:currentUserName() });
      if(saved?.id) record.id = saved.id;
      const rows = [record, ...getLocalArray(ERROR_REPORTS_STORAGE_KEY).filter(item => String(item.id) !== String(record.id))];
      setLocalArray(ERROR_REPORTS_STORAGE_KEY, rows);
      state.errorReports = rows;
      if(status) status.textContent = '';
      alert('Отлично! Сообщение отправлено');
      form.reset();
    } catch(error){
      console.error(error);
      if(status){ status.textContent = 'Не удалось отправить сообщение: ' + (error.message || 'проверьте интернет и права доступа.'); status.className = 'submit-status error'; }
      alert('Не удалось отправить сообщение: ' + (error.message || 'проверьте интернет и права доступа.'));
    } finally {
      if(submitButton) submitButton.disabled = false;
    }
  }

  function renderAppV3(){
    if(!isAuthenticated()) return showLogin();
    tasksV2()?.deactivate?.();
    ensureTasksPermission();
    document.body.classList.remove('login-mode');
    const { site } = state.menu;
    ensureAllowedTop();
    if(!(site.methodTabs || []).some(tab => tab.id === state.activeMethod) && (site.methodTabs || []).length) state.activeMethod = site.methodTabs[0].id;
    document.title = `${site.title} — база сотрудников`;
    document.querySelector('.brand').textContent = site.title;
    document.querySelector('.kicker').textContent = site.subtitle;
    document.querySelector('.muted').textContent = site.description;
    const user = currentUser();
    const userPanel = document.querySelector('#user-panel');
    if(userPanel) userPanel.innerHTML = `<span class="user-chip">${esc(user.name)} · ${esc(roleLabel(user.role))}</span><button type="button" class="logout-btn">Выйти</button>`;
    const tabs = allowedMainTabs();
    document.querySelector('.main-tabs').innerHTML = tabs.map(tab => `<button class="main-tab ${tab.id === state.activeTop ? 'active' : ''} ${tab.id === 'employees' && hasAccess('employees') ? 'admin-visible' : ''}" data-top-target="${esc(tab.id)}" type="button">${esc(tab.title)}</button>`).join('');
    document.querySelector('#panels').innerHTML =
      renderHome() +
      (state.activeTop === 'tasks' ? renderTasksPanel() : '') +
      (hasAccess('method') ? renderMethod() : '') +
      (hasAccess('theory') ? renderTheoryTopPanel() : '') +
      (hasAccess('checklists') ? renderChecklists() : '') +
      (hasAccess('revisions') ? renderRevisions() : '') +
      (hasAccess('techcards') ? renderTechCards() : '') +
      (hasAccess('schedule') ? renderSchedule() : '') +
      (hasAccess('reportError') ? renderReportError() : '') +
      (hasAccess('employees') ? renderEmployees() : '') +
      (hasAccess('control') ? renderControl() : '');
    bindEvents();
    if(state.activeTop === 'tasks'){
      tasksV2()?.activate?.(document.querySelector('[data-tasks-v2-root]'))?.catch?.(console.error);
    }
    if(!state.rolePermissions && !state.rolePermissionsLoading) loadRolePermissions();
    if(isAdmin() && !state.employees) loadEmployees();
    if((state.activeTop === 'schedule' || state.activeTop === 'home') && !state.scheduleEvents) loadScheduleEvents();
    if(state.activeTop === 'employees' && !state.employees) loadEmployees();
    if(state.activeTop === 'control'){
      loadControlRecords();
      loadRevisionRecords();
      if(state.activeControl === 'errors' || state.activeControl === 'summary') loadErrorReports();
    }
    queueMicrotask(enhanceShellV3);
  }

  function setTopV3(target){
    if(!hasAccess(target)) target = 'home';
    if(target !== 'tasks'){
      tasksV2()?.deactivate?.();
      document.querySelector('#top-tasks')?.remove();
    }
    state.activeTop = target;
    if(target === 'tasks' && !document.querySelector('#top-tasks')){
      document.querySelector('#panels')?.insertAdjacentHTML('beforeend', renderTasksPanel());
    }
    document.querySelectorAll('.main-tab').forEach(button => button.classList.toggle('active', button.dataset.topTarget === target));
    document.querySelectorAll('.top-panel').forEach(panel => panel.classList.toggle('active', panel.id === `top-${target}`));
    history.replaceState(null,'',`#${target}`);
    window.scrollTo({ top:0, behavior:'smooth' });
    if(target === 'home'){
      loadScheduleEvents();
      refreshHomeWidgets();
    }
    if(target === 'tasks'){
      tasksV2()?.activate?.(document.querySelector('[data-tasks-v2-root]'))?.catch?.(console.error);
    }
    if(target === 'schedule') loadScheduleEvents();
    if(target === 'control'){
      loadControlRecords();
      loadRevisionRecords();
      if(state.activeControl === 'errors' || state.activeControl === 'summary') loadErrorReports();
    }
    if(target === 'employees'){
      loadEmployees();
      if(!state.rolePermissions && !state.rolePermissionsLoading) loadRolePermissions();
    }
    updateContextV3(target);
    closeMenuV3();
  }

  function refreshHomeWidgets(){
    const shift = document.querySelector('#v3-shift-roster');
    if(shift) shift.innerHTML = renderShiftRoster();
    const upcoming = document.querySelector('#v3-upcoming-events');
    if(upcoming) upcoming.innerHTML = renderUpcoming();
    const metrics = document.querySelector('#v3-home-metrics');
    if(metrics) metrics.innerHTML = renderHomeMetrics();
  }

  function svgFor(target){
    return `<svg class="v3-nav-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${iconPaths[target] || '<circle cx="12" cy="12" r="8"/>'}</svg>`;
  }

  function enhanceNavigation(){
    const tabs = document.querySelector('.main-tabs');
    if(!tabs) return;
    const buttons = Array.from(tabs.querySelectorAll('.main-tab'));
    const signature = buttons.map(button => button.dataset.topTarget || '').join('|');
    const expectedGroups = navGroups.filter(group => group.ids.some(id => buttons.some(button => button.dataset.topTarget === id))).length;
    const ready = tabs.dataset.v3Signature === signature
      && buttons.every(button => button.dataset.v3Enhanced === '1')
      && tabs.querySelectorAll('.shell-nav-group').length === expectedGroups;
    if(ready) return;
    tabs.querySelectorAll('.shell-nav-group').forEach(group => group.remove());
    buttons.forEach(button => {
      const target = button.dataset.topTarget || '';
      const label = navMeta[target]?.[0] || button.textContent.trim();
      button.innerHTML = `<span class="shell-nav-icon">${svgFor(target)}</span><span class="shell-nav-label">${esc(label)}</span>`;
      button.title = label;
      button.dataset.v3Enhanced = '1';
    });
    navGroups.forEach(group => {
      const first = group.ids.map(id => tabs.querySelector(`[data-top-target="${id}"]`)).find(Boolean);
      if(!first) return;
      const heading = document.createElement('div');
      heading.className = 'shell-nav-group';
      heading.textContent = group.title;
      tabs.insertBefore(heading, first);
    });
    tabs.dataset.v3Signature = signature;
  }

  function removeHeaderSettingsIcon(){
    const hero = document.querySelector('.hero');
    if(!hero) return;
    hero.querySelectorAll('.shell-settings-btn,[data-interface-settings],[data-settings-button],.header-settings,.settings-button').forEach(node => node.remove());
    hero.querySelectorAll('button').forEach(button => {
      const label = String(button.getAttribute('aria-label') || '').toLowerCase();
      const title = String(button.getAttribute('title') || '').toLowerCase();
      if(label.includes('настрой') || title.includes('настрой')) button.remove();
    });
  }

  function bindMenuButton(){
    const current = document.querySelector('.shell-menu-btn');
    if(!current || current.dataset.v3Bound === '1') return;
    const button = current.cloneNode(true);
    button.dataset.bound = '1';
    button.dataset.v3Bound = '1';
    current.replaceWith(button);
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const open = document.body.classList.toggle('menu-open');
      button.setAttribute('aria-expanded', String(open));
      button.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    });
  }

  function closeMenuV3(){
    document.body.classList.remove('menu-open');
    const button = document.querySelector('.shell-menu-btn');
    if(button){
      button.setAttribute('aria-expanded','false');
      button.setAttribute('aria-label','Открыть меню');
    }
  }

  function updateContextV3(target){
    const key = target || document.querySelector('.main-tab.active')?.dataset.topTarget || 'home';
    const meta = navMeta[key] || ['Современник','Рабочая база и документы'];
    const copy = document.querySelector('.shell-context-copy');
    if(!copy) return;
    const title = copy.querySelector('strong');
    const subtitle = copy.querySelector('span');
    if(title && title.textContent !== meta[0]) title.textContent = meta[0];
    if(subtitle && subtitle.textContent !== meta[1]) subtitle.textContent = meta[1];
  }

  function enhanceShellV3(){
    document.body.dataset.interfaceVersion = VERSION;
    ensureTasksPermission();
    removeHeaderSettingsIcon();
    enhanceNavigation();
    bindMenuButton();
    updateContextV3();
    const overlay = document.querySelector('.shell-overlay');
    if(overlay && overlay.dataset.v3Bound !== '1'){
      overlay.dataset.v3Bound = '1';
      overlay.addEventListener('click', closeMenuV3);
    }
  }

  function installOverrides(){
    ensureTasksPermission();
    window.allMainTabs = allMainTabs = tabsWithTasks;
    window.hasAccess = hasAccess = accessWithTasks;
    window.renderHome = renderHome = renderHomeV3;
    window.renderReportError = renderReportError = renderReportErrorV3;
    window.submitErrorReport = submitErrorReport = submitErrorReportV3;
    window.renderApp = renderApp = renderAppV3;
    window.setTop = setTop = setTopV3;

    if(legacy.refreshSchedule){
      window.refreshSchedule = refreshSchedule = function(){
        legacy.refreshSchedule();
        refreshHomeWidgets();
      };
    }
    if(legacy.loadScheduleEvents){
      window.loadScheduleEvents = loadScheduleEvents = async function(){
        await legacy.loadScheduleEvents();
        refreshHomeWidgets();
      };
    }
    if(legacy.loadRolePermissions){
      window.loadRolePermissions = loadRolePermissions = async function(){
        await legacy.loadRolePermissions();
        ensureTasksPermission();
      };
    }
  }

  document.addEventListener('click', event => {
    if(event.target.closest('.main-tab')) closeMenuV3();
  });
  document.addEventListener('keydown', event => {
    if(event.key === 'Escape') closeMenuV3();
  });
  window.addEventListener('resize', () => {
    if(window.innerWidth > 920) closeMenuV3();
  });

  installOverrides();
  if(typeof isAuthenticated === 'function' && isAuthenticated()) renderApp();
  enhanceShellV3();

  const root = document.querySelector('.page') || document.body;
  const observer = new MutationObserver(() => window.requestAnimationFrame(enhanceShellV3));
  observer.observe(root,{ subtree:true, childList:true });
})();

/* Современник schedule departments — bar/hall tabs, July waiter schedule and mobile agenda */
(function(global){
  'use strict';

  const VERSION = '2026-07-20-schedule-departments-1';
  const STORAGE_KEY = 'sovremennikScheduleDepartmentV1';
  const HALL_JULY_2026 = {"Макс Баринов":{"2":"Целая смена","4":"Утренняя смена","6":"Целая смена","7":"Целая смена","8":"Целая смена","10":"Целая смена","12":"Утренняя смена","13":"Целая смена","14":"Целая смена","15":"Утренняя смена","17":"Вечерняя смена","18":"Целая смена","19":"08:00–15:00","21":"Целая смена","22":"Целая смена","25":"Целая смена","26":"Целая смена","28":"Вечерняя смена","29":"Целая смена"},"Даша Яновская":{"4":"Утренняя смена","5":"Целая смена · с 10:00","8":"10:00–14:00","9":"Целая смена","11":"Утренняя смена","12":"Утренняя смена","13":"Целая смена","16":"Вечерняя смена","19":"Целая смена","21":"Вечерняя смена","22":"Утренняя смена","25":"Целая смена","26":"Утренняя смена","28":"Утренняя смена","30":"Вечерняя смена","31":"Утренняя смена"},"Оля Амелина":{"2":"Утренняя смена","3":"Утренняя смена","5":"10:00–14:00 · до","6":"Утренняя смена","7":"Утренняя смена","9":"10:00–14:00","10":"Утренняя смена","14":"Утренняя смена","17":"Целая смена","18":"Утренняя смена","19":"Утренняя смена","23":"Целая смена","25":"Утренняя смена · до","26":"Утренняя смена"},"Виталий Новиков":{"3":"Утренняя смена","4":"Целая смена · с 10:00","5":"Утренняя смена","7":"10:00–14:00","8":"Целая смена","10":"10:00–14:00","11":"Утренняя смена","14":"Целая смена","16":"10:00–14:00","17":"10:00–14:00","18":"Целая смена","19":"Утренняя смена","21":"Целая смена","23":"Вечерняя смена","24":"Утренняя смена","25":"Утренняя смена","26":"Целая смена","29":"Утренняя смена","30":"Вечерняя смена"},"Арина Каянова":{"1":"отпуск","2":"отпуск","3":"отпуск","4":"отпуск","5":"отпуск","6":"отпуск","7":"отпуск","8":"отпуск","9":"отпуск","10":"отпуск","11":"отпуск","12":"отпуск","13":"отпуск","14":"отпуск","27":"Целая смена","28":"Целая смена","31":"Целая смена"},"София Чистякова":{"2":"Вечерняя смена","3":"Вечерняя смена","4":"Целая смена · до с 10:00","5":"Утренняя смена","8":"Целая смена","9":"Целая смена","11":"Утренняя смена · до с 10:00","12":"Целая смена · с 10:00","13":"Целая смена","16":"Вечерняя смена","17":"Вечерняя смена","19":"Утренняя смена","20":"Целая смена","21":"Утренняя смена","22":"Утренняя смена","23":"Утренняя смена","29":"Вечерняя смена"},"Никита Новиков":{"1":"Целая смена","2":"Вечерняя смена","4":"Утренняя смена","5":"Целая смена","6":"Вечерняя смена","11":"Целая смена","12":"Целая смена","15":"Вечерняя смена","16":"Утренняя смена","18":"Утренняя смена","19":"Целая смена","22":"Вечерняя смена","24":"Вечерняя смена","25":"Утренняя смена","26":"Утренняя смена","29":"Вечерняя смена"},"Саша Романова":{"1":"Целая смена","2":"Утренняя смена","6":"Целая смена","7":"Целая смена","10":"Вечерняя смена","11":"Целая смена · с 10:00","12":"Утренняя смена · до с 10:00","15":"Целая смена","18":"Целая смена","19":"Утренняя смена","20":"Целая смена","22":"Вечерняя смена","24":"Целая смена","25":"Целая смена","26":"Утренняя смена","29":"Утренняя смена","30":"Утренняя смена"},"Юля Хрипунова":{"3":"Вечерняя смена","4":"Утренняя смена","5":"Утренняя смена","6":"10:00–14:00","7":"Вечерняя смена","10":"Целая смена","11":"Утренняя смена","12":"Утренняя смена","14":"Вечерняя смена","15":"10:00–14:00","16":"Утренняя смена","17":"Утренняя смена","26":"Целая смена","27":"Целая смена","30":"Утренняя смена","31":"Вечерняя смена"},"Саша Жигалкина":{"1":"Целая смена","3":"Целая смена","4":"Целая смена · с 10:00","5":"Целая смена","9":"Целая смена","11":"Целая смена","12":"Целая смена","15":"Целая смена","16":"Целая смена","17":"Утренняя смена","18":"Утренняя смена · с 10:00","19":"15:00–21:00","20":"Целая смена","23":"Целая смена","24":"Целая смена","25":"Утренняя смена","27":"Целая смена","28":"Целая смена","30":"Целая смена","31":"Целая смена"},"Генка":{"16":"Время не указано","30":"Время не указано"}};

  const baseApi = global.SovremennikScheduleManager || {};
  const baseRenderSchedule = global.renderSchedule || baseApi.renderSchedule;
  const baseRenderScheduleGrid = global.renderScheduleGrid || baseApi.renderScheduleGrid;
  const baseGetScheduleEvents = typeof global.getScheduleEvents === 'function' ? global.getScheduleEvents : null;

  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[character]));
  }
  function appState(){ return typeof state !== 'undefined' ? state : null; }
  function currentProfile(){ try { return typeof currentUser === 'function' ? currentUser() : null; } catch(error) { return null; } }
  function normalizeRoleValue(value){
    if(typeof normalizeRole === 'function') return normalizeRole(value);
    const role = String(value || '').trim().toLowerCase();
    return ({'администратор':'admin','руководитель':'manager','менеджер':'manager','официант':'waiter'})[role] || role;
  }
  function localDateKey(date = new Date()){
    if(typeof baseApi.localDateKey === 'function') return baseApi.localDateKey(date);
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function normalizeDateValue(value){
    if(typeof baseApi.normalizeDateValue === 'function') return baseApi.normalizeDateValue(value);
    return String(value || '').slice(0,10);
  }
  function isShift(event){ return String(event?.type || event?.event_type || '').toLowerCase().includes('смен'); }
  function canManageSchedule(){ return ['admin','manager'].includes(normalizeRoleValue(currentProfile()?.role)); }

  function initialDepartment(){
    try {
      const saved = global.localStorage?.getItem(STORAGE_KEY);
      if(saved === 'bar' || saved === 'hall') return saved;
    } catch(error) {}
    return normalizeRoleValue(currentProfile()?.role) === 'waiter' ? 'hall' : 'bar';
  }
  let activeDepartment = initialDepartment();

  function setActiveDepartment(value){
    activeDepartment = value === 'hall' ? 'hall' : 'bar';
    try { global.localStorage?.setItem(STORAGE_KEY, activeDepartment); } catch(error) {}
  }

  function hallEmbeddedEvents(){
    const rows = [];
    let sequence = 0;
    for(const [employee, days] of Object.entries(HALL_JULY_2026)){
      for(const [dayValue, descriptionValue] of Object.entries(days)){
        const day = String(dayValue).padStart(2,'0');
        const description = String(descriptionValue || '').trim();
        const vacation = description.toLowerCase() === 'отпуск';
        rows.push({
          id:`hall-embedded-2026-07-${day}-${++sequence}`,
          eventDate:`2026-07-${day}`,
          type:vacation ? 'Отпуск' : 'Смена',
          title:vacation ? `Отпуск: ${employee}` : `Смена: ${employee}`,
          description:vacation ? 'Отпуск' : description,
          employeeName:'',
          source:'hall:embedded',
          department:'hall',
          readOnly:true
        });
      }
    }
    return rows;
  }
  const embeddedHallEvents = hallEmbeddedEvents();

  function rawRemoteEvents(){
    try {
      if(baseGetScheduleEvents) return baseGetScheduleEvents.call(global) || [];
      return Array.isArray(appState()?.scheduleEvents) ? appState().scheduleEvents : [];
    } catch(error) {
      return Array.isArray(appState()?.scheduleEvents) ? appState().scheduleEvents : [];
    }
  }
  function eventKey(event){
    return [normalizeDateValue(event?.eventDate || event?.event_date), String(event?.type || event?.event_type || '').trim().toLowerCase(), String(event?.title || '').trim().toLowerCase(), String(event?.description || '').trim().toLowerCase()].join('|');
  }
  function allScheduleEvents(){
    const remote = rawRemoteEvents();
    const seen = new Set(remote.map(eventKey));
    return remote.concat(embeddedHallEvents.filter(event => !seen.has(eventKey(event))));
  }
  function sourceDepartment(event){
    const explicit = String(event?.department || '').trim().toLowerCase();
    if(explicit === 'hall' || explicit === 'зал') return 'hall';
    if(explicit === 'bar' || explicit === 'бар') return 'bar';
    const source = String(event?.source || '').trim().toLowerCase();
    if(source.startsWith('hall:') || source.startsWith('зал:')) return 'hall';
    if(source.startsWith('bar:') || source.startsWith('бар:')) return 'bar';
    if(!isShift(event)) return 'both';
    return 'bar';
  }
  function filteredScheduleEvents(){
    return allScheduleEvents().filter(event => {
      const department = sourceDepartment(event);
      return department === 'both' || department === activeDepartment;
    });
  }
  function withFilteredEvents(callback){
    const previous = global.getScheduleEvents;
    global.getScheduleEvents = filteredScheduleEvents;
    try { return callback(); } finally { global.getScheduleEvents = previous; }
  }

  function tabsMarkup(){
    return `<nav class="schedule-department-tabs" aria-label="Подразделение расписания">
      <button type="button" class="schedule-department-tab ${activeDepartment === 'bar' ? 'active' : ''}" data-schedule-department-tab="bar" aria-pressed="${activeDepartment === 'bar'}">Бар</button>
      <button type="button" class="schedule-department-tab ${activeDepartment === 'hall' ? 'active' : ''}" data-schedule-department-tab="hall" aria-pressed="${activeDepartment === 'hall'}">Зал</button>
    </nav>`;
  }
  function dateObject(key){
    const match = String(key).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? new Date(Number(match[1]), Number(match[2])-1, Number(match[3]), 12) : null;
  }
  function mobileEventMarkup(event){
    const vacation = String(event?.type || '').toLowerCase().includes('отпуск');
    const title = (isShift(event) || vacation) ? String(event?.title || '').replace(/^(?:смена|отпуск)\s*[:—-]?\s*/i,'').trim() : (event?.title || event?.type || 'Событие');
    return `<article class="schedule-mobile-event ${vacation ? 'schedule-mobile-event--vacation' : ''}">
      <strong>${escapeHtml(title)}</strong>
      ${event?.description ? `<span>${escapeHtml(event.description)}</span>` : ''}
    </article>`;
  }
  function mobileAgendaMarkup(){
    const month = String(appState()?.scheduleMonth || localDateKey().slice(0,7));
    const groups = new Map();
    filteredScheduleEvents()
      .filter(event => normalizeDateValue(event?.eventDate || event?.event_date).startsWith(month))
      .sort((a,b) => normalizeDateValue(a?.eventDate || a?.event_date).localeCompare(normalizeDateValue(b?.eventDate || b?.event_date)) || String(a?.title || '').localeCompare(String(b?.title || ''),'ru'))
      .forEach(event => {
        const key = normalizeDateValue(event?.eventDate || event?.event_date);
        if(!groups.has(key)) groups.set(key, []);
        groups.get(key).push(event);
      });
    if(!groups.size) return `<div class="schedule-mobile-agenda" data-schedule-mobile-agenda><div class="schedule-mobile-empty">В этом месяце записей нет.</div></div>`;
    return `<div class="schedule-mobile-agenda" data-schedule-mobile-agenda>${Array.from(groups.entries()).map(([key,events]) => {
      const date = dateObject(key);
      const weekday = date ? date.toLocaleDateString('ru-RU',{weekday:'short'}) : key;
      const label = date ? date.toLocaleDateString('ru-RU',{day:'numeric',month:'long'}) : key;
      return `<section class="schedule-mobile-day ${key === localDateKey() ? 'schedule-mobile-day--today' : ''}">
        <header><span>${escapeHtml(weekday)}</span><strong>${escapeHtml(label)}</strong></header>
        <div class="schedule-mobile-events">${events.map(mobileEventMarkup).join('')}</div>
      </section>`;
    }).join('')}</div>`;
  }

  function decorateScheduleHtml(html){
    if(!global.document?.createElement) return html;
    const template = document.createElement('template');
    if(!('content' in template)) return html;
    template.innerHTML = String(html || '').trim();
    const panel = template.content.firstElementChild;
    if(!panel) return html;
    panel.dataset.scheduleDepartment = activeDepartment;
    panel.querySelector('.section-heading')?.insertAdjacentHTML('afterend', tabsMarkup());
    const grid = panel.querySelector('#schedule-grid-wrap');
    if(grid){
      grid.classList.add('schedule-desktop-grid');
      grid.insertAdjacentHTML('afterend', mobileAgendaMarkup());
    }
    panel.querySelectorAll('[data-schedule-event-id^="hall-embedded-"]').forEach(card => {
      card.classList.add('schedule-event--embedded');
      card.querySelector('span')?.remove();
      card.querySelector('.schedule-event-actions')?.remove();
      if(card.textContent.toLowerCase().includes('отпуск')) card.classList.add('schedule-event--vacation');
    });
    if(activeDepartment === 'hall'){
      panel.querySelector('.schedule-manager-actions')?.remove();
      panel.querySelector('#schedule-form-wrap')?.remove();
      panel.querySelector('.schedule-import-wrap')?.remove();
      if(canManageSchedule()) panel.querySelector('.schedule-card')?.insertAdjacentHTML('beforeend','<p class="schedule-hall-source-note">График зала на июль загружен из файла. Для изменений загрузите обновлённый файл в следующем обновлении.</p>');
    }
    return panel.outerHTML;
  }

  function renderSchedule(){
    if(typeof baseRenderSchedule !== 'function') return '';
    return decorateScheduleHtml(withFilteredEvents(() => baseRenderSchedule()));
  }
  function renderScheduleGrid(){
    if(typeof baseRenderScheduleGrid !== 'function') return '';
    return withFilteredEvents(() => baseRenderScheduleGrid());
  }
  function rerenderPanel(){
    const panel = document.querySelector('#top-schedule');
    if(panel) panel.outerHTML = renderSchedule();
  }
  function changeMonth(delta){
    const current = appState();
    if(!current) return;
    const [year,month] = String(current.scheduleMonth || localDateKey().slice(0,7)).split('-').map(Number);
    const next = new Date(year,month-1+delta,1,12);
    current.scheduleMonth = `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}`;
    rerenderPanel();
  }
  function onWindowClick(event){
    const target = event.target?.closest?.('[data-schedule-department-tab], [data-schedule-prev], [data-schedule-next]');
    if(!target) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if(target.matches('[data-schedule-department-tab]')){
      setActiveDepartment(target.dataset.scheduleDepartmentTab);
      rerenderPanel();
    } else changeMonth(target.matches('[data-schedule-prev]') ? -1 : 1);
  }
  function install(){
    global.getScheduleEvents = allScheduleEvents;
    global.renderSchedule = renderSchedule;
    global.renderScheduleGrid = renderScheduleGrid;
    global.refreshSchedule = rerenderPanel;
    global.addEventListener?.('click',onWindowClick,true);
    if(document.querySelector('#top-schedule')) rerenderPanel();
    document.documentElement.dataset.scheduleDepartmentsVersion = VERSION;
  }
  global.SovremennikScheduleDepartments = Object.freeze({
    VERSION,
    hallEvents:embeddedHallEvents,
    allScheduleEvents,
    filteredScheduleEvents,
    sourceDepartment,
    get activeDepartment(){ return activeDepartment; },
    setActiveDepartment,
    renderSchedule,
    renderScheduleGrid,
    mobileAgendaMarkup
  });
  install();
})(window);

/* Современник schedule departments — bar/hall tabs, shared controls, shift colors and mobile agenda */
(function(global){
  'use strict';

  const VERSION = '2026-07-20-schedule-departments-2';
  const STORAGE_KEY = 'sovremennikScheduleDepartmentV1';
  const LOCAL_SCHEDULE_KEY = 'sovremennikScheduleEventsV2Clean';
  const HALL_IMPORT_SOURCE = 'hall:file:2026-07';
  const HALL_MARKER_SOURCE = 'hall:system:2026-07-imported-v2';
  const HALL_MARKER_TITLE = '__hall_schedule_imported_2026_07_v2__';
  const IMPORT_CHUNK_SIZE = 100;
  const SENIOR_WAITERS = new Set(['макс баринов','саша жигалкина']);
  const HALL_JULY_2026 = {"Макс Баринов":{"2":"Целая смена","4":"Утренняя смена","6":"Целая смена","7":"Целая смена","8":"Целая смена","10":"Целая смена","12":"Утренняя смена","13":"Целая смена","14":"Целая смена","15":"Утренняя смена","17":"Вечерняя смена","18":"Целая смена","19":"08:00–15:00","21":"Целая смена","22":"Целая смена","25":"Целая смена","26":"Целая смена","28":"Вечерняя смена","29":"Целая смена"},"Даша Яновская":{"4":"Утренняя смена","5":"Целая смена · с 10:00","8":"10:00–14:00","9":"Целая смена","11":"Утренняя смена","12":"Утренняя смена","13":"Целая смена","16":"Вечерняя смена","19":"Целая смена","21":"Вечерняя смена","22":"Утренняя смена","25":"Целая смена","26":"Утренняя смена","28":"Утренняя смена","30":"Вечерняя смена","31":"Утренняя смена"},"Оля Амелина":{"2":"Утренняя смена","3":"Утренняя смена","5":"10:00–14:00 · до","6":"Утренняя смена","7":"Утренняя смена","9":"10:00–14:00","10":"Утренняя смена","14":"Утренняя смена","17":"Целая смена","18":"Утренняя смена","19":"Утренняя смена","23":"Целая смена","25":"Утренняя смена · до","26":"Утренняя смена"},"Виталий Новиков":{"3":"Утренняя смена","4":"Целая смена · с 10:00","5":"Утренняя смена","7":"10:00–14:00","8":"Целая смена","10":"10:00–14:00","11":"Утренняя смена","14":"Целая смена","16":"10:00–14:00","17":"10:00–14:00","18":"Целая смена","19":"Утренняя смена","21":"Целая смена","23":"Вечерняя смена","24":"Утренняя смена","25":"Утренняя смена","26":"Целая смена","29":"Утренняя смена","30":"Вечерняя смена"},"Арина Каянова":{"27":"Целая смена","28":"Целая смена","31":"Целая смена"},"София Чистякова":{"2":"Вечерняя смена","3":"Вечерняя смена","4":"Целая смена · до с 10:00","5":"Утренняя смена","8":"Целая смена","9":"Целая смена","11":"Утренняя смена · до с 10:00","12":"Целая смена · с 10:00","13":"Целая смена","16":"Вечерняя смена","17":"Вечерняя смена","19":"Утренняя смена","20":"Целая смена","21":"Утренняя смена","22":"Утренняя смена","23":"Утренняя смена","29":"Вечерняя смена"},"Никита Новиков":{"1":"Целая смена","2":"Вечерняя смена","4":"Утренняя смена","5":"Целая смена","6":"Вечерняя смена","11":"Целая смена","12":"Целая смена","15":"Вечерняя смена","16":"Утренняя смена","18":"Утренняя смена","19":"Целая смена","22":"Вечерняя смена","24":"Вечерняя смена","25":"Утренняя смена","26":"Утренняя смена","29":"Вечерняя смена"},"Саша Романова":{"1":"Целая смена","2":"Утренняя смена","6":"Целая смена","7":"Целая смена","10":"Вечерняя смена","11":"Целая смена · с 10:00","12":"Утренняя смена · до с 10:00","15":"Целая смена","18":"Целая смена","19":"Утренняя смена","20":"Целая смена","22":"Вечерняя смена","24":"Целая смена","25":"Целая смена","26":"Утренняя смена","29":"Утренняя смена","30":"Утренняя смена"},"Юля Хрипунова":{"3":"Вечерняя смена","4":"Утренняя смена","5":"Утренняя смена","6":"10:00–14:00","7":"Вечерняя смена","10":"Целая смена","11":"Утренняя смена","12":"Утренняя смена","14":"Вечерняя смена","15":"10:00–14:00","16":"Утренняя смена","17":"Утренняя смена","26":"Целая смена","27":"Целая смена","30":"Утренняя смена","31":"Вечерняя смена"},"Саша Жигалкина":{"1":"Целая смена","3":"Целая смена","4":"Целая смена · с 10:00","5":"Целая смена","9":"Целая смена","11":"Целая смена","12":"Целая смена","15":"Целая смена","16":"Целая смена","17":"Утренняя смена","18":"Утренняя смена · с 10:00","19":"15:00–21:00","20":"Целая смена","23":"Целая смена","24":"Целая смена","25":"Утренняя смена","27":"Целая смена","28":"Целая смена","30":"Целая смена","31":"Целая смена"},"Генка":{"16":"Время не указано","30":"Время не указано"}};

  const baseApi = global.SovremennikScheduleManager || {};
  const baseRenderSchedule = global.renderSchedule || baseApi.renderSchedule;
  const baseRenderScheduleGrid = global.renderScheduleGrid || baseApi.renderScheduleGrid;
  const baseGetScheduleEvents = typeof global.getScheduleEvents === 'function' ? global.getScheduleEvents : null;
  const baseLoadScheduleEvents = typeof global.loadScheduleEvents === 'function' ? global.loadScheduleEvents : null;

  let activeDepartment = initialDepartment();
  let actionMode = '';
  let migrationPromise = null;

  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[character]));
  }

  function appState(){ return typeof state !== 'undefined' ? state : null; }
  function currentProfile(){
    try { return typeof currentUser === 'function' ? currentUser() : null; }
    catch(error){ return null; }
  }
  function normalizeRoleValue(value){
    if(typeof normalizeRole === 'function') return normalizeRole(value);
    const role = String(value || '').trim().toLowerCase();
    return ({'администратор':'admin','руководитель':'manager','менеджер':'manager','официант':'waiter'})[role] || role;
  }
  function canManageSchedule(){
    return ['admin','manager'].includes(normalizeRoleValue(currentProfile()?.role));
  }
  function client(){
    const value = global.sovremennikSupabase;
    if(!value) throw new Error('Supabase временно недоступен.');
    return value;
  }
  function localDateKey(date = new Date()){
    if(typeof baseApi.localDateKey === 'function') return baseApi.localDateKey(date);
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function normalizeDateValue(value){
    if(typeof baseApi.normalizeDateValue === 'function') return baseApi.normalizeDateValue(value);
    const text = String(value || '').trim();
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : text.slice(0,10);
  }
  function initialDepartment(){
    try {
      const saved = global.localStorage?.getItem(STORAGE_KEY);
      if(saved === 'bar' || saved === 'hall') return saved;
    } catch(error) {}
    return normalizeRoleValue(currentProfile()?.role) === 'waiter' ? 'hall' : 'bar';
  }
  function setActiveDepartment(value){
    activeDepartment = value === 'hall' ? 'hall' : 'bar';
    actionMode = '';
    try { global.localStorage?.setItem(STORAGE_KEY, activeDepartment); } catch(error) {}
  }
  function isShift(event){
    return String(event?.type || event?.event_type || '').toLowerCase().includes('смен');
  }
  function isVacation(event){
    const type = String(event?.type || event?.event_type || '').toLowerCase();
    const description = String(event?.description || '').toLowerCase();
    return type.includes('отпуск') || description === 'отпуск';
  }
  function isSystemMarker(event){
    return String(event?.source || '').toLowerCase() === HALL_MARKER_SOURCE
      || String(event?.title || '') === HALL_MARKER_TITLE;
  }
  function shiftEmployeeName(event){
    return String(event?.title || '')
      .replace(/^(?:смена|отпуск)\s*[:—-]?\s*/i,'')
      .trim() || 'Сотрудник';
  }
  function shiftKind(event){
    if(!isShift(event)) return '';
    const source = `${event?.title || ''} ${event?.description || ''}`.toLowerCase();
    if(source.includes('целая смена')) return 'full';
    if(source.includes('утренняя смена')) return 'morning';
    if(source.includes('вечерняя смена')) return 'evening';
    const range = source.match(/(\d{1,2})[.:]\d{2}\s*[—–-]\s*(\d{1,2})[.:]\d{2}/);
    if(range) return Number(range[1]) >= 14 ? 'evening' : 'morning';
    return '';
  }
  function isSeniorWaiter(event){
    return sourceDepartment(event) === 'hall' && SENIOR_WAITERS.has(shiftEmployeeName(event).toLowerCase());
  }
  function visualClasses(event, prefix = 'schedule-event'){
    const classes = [];
    const kind = shiftKind(event);
    if(kind) classes.push(`${prefix}--${kind}`);
    if(isSeniorWaiter(event)) classes.push(`${prefix}--senior`);
    return classes.join(' ');
  }

  function stableUuid(text){
    let h1 = 0xdeadbeef ^ String(text).length;
    let h2 = 0x41c6ce57 ^ String(text).length;
    for(let index = 0; index < String(text).length; index += 1){
      const code = String(text).charCodeAt(index);
      h1 = Math.imul(h1 ^ code, 2654435761);
      h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = (h1 ^ (h1 >>> 16)) >>> 0;
    h2 = (h2 ^ (h2 >>> 13)) >>> 0;
    const hex = [h1,h2,h1 ^ h2,Math.imul(h1,31) ^ h2].map(value => (value >>> 0).toString(16).padStart(8,'0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
  }

  function hallEmbeddedEvents(){
    const rows = [];
    for(const [employee, days] of Object.entries(HALL_JULY_2026)){
      for(const [dayValue, descriptionValue] of Object.entries(days)){
        const day = String(dayValue).padStart(2,'0');
        const description = String(descriptionValue || '').trim();
        if(!description || description.toLowerCase() === 'отпуск') continue;
        const id = stableUuid(`hall-2026-07-${day}-${employee}-${description}`);
        rows.push({
          id,
          eventDate:`2026-07-${day}`,
          type:'Смена',
          title:`Смена: ${employee}`,
          description,
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
    } catch(error){
      return Array.isArray(appState()?.scheduleEvents) ? appState().scheduleEvents : [];
    }
  }
  function eventKey(event){
    return [
      normalizeDateValue(event?.eventDate || event?.event_date),
      String(event?.type || event?.event_type || '').trim().toLowerCase(),
      String(event?.title || '').trim().toLowerCase(),
      String(event?.description || '').trim().toLowerCase()
    ].join('|');
  }
  function hasHallMarker(events = rawRemoteEvents()){
    return events.some(isSystemMarker);
  }
  function allScheduleEvents(){
    const remote = rawRemoteEvents();
    const visibleRemote = remote.filter(event => !isSystemMarker(event) && !isVacation(event));
    if(hasHallMarker(remote)) return visibleRemote;
    const seen = new Set(visibleRemote.map(eventKey));
    return visibleRemote.concat(embeddedHallEvents.filter(event => !seen.has(eventKey(event))));
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
  function findScheduleEvent(id){
    return allScheduleEvents().find(event => String(event?.id) === String(id)) || null;
  }
  function withFilteredEvents(callback){
    const previous = global.getScheduleEvents;
    global.getScheduleEvents = filteredScheduleEvents;
    try { return callback(); }
    finally { global.getScheduleEvents = previous; }
  }

  function tabsMarkup(){
    return `<nav class="schedule-department-tabs" aria-label="Подразделение расписания">
      <button type="button" class="schedule-department-tab ${activeDepartment === 'bar' ? 'active' : ''}" data-schedule-department-tab="bar" aria-pressed="${activeDepartment === 'bar'}">Бар</button>
      <button type="button" class="schedule-department-tab ${activeDepartment === 'hall' ? 'active' : ''}" data-schedule-department-tab="hall" aria-pressed="${activeDepartment === 'hall'}">Зал</button>
    </nav>`;
  }
  function legendMarkup(){
    return `<div class="schedule-shift-legend" aria-label="Обозначения смен">
      <span class="schedule-legend-item schedule-legend-item--morning">Утренняя</span>
      <span class="schedule-legend-item schedule-legend-item--evening">Вечерняя</span>
      <span class="schedule-legend-item schedule-legend-item--full">Целая</span>
      ${activeDepartment === 'hall' ? '<span class="schedule-legend-item schedule-legend-item--senior">Старший официант</span>' : ''}
    </div>`;
  }
  function commonActionsMarkup(){
    if(!canManageSchedule()) return '';
    return `<div class="schedule-common-actions" aria-label="Редактирование расписания">
      <button class="small-action secondary ${actionMode === 'edit' ? 'active' : ''}" type="button" data-schedule-action-mode="edit">Изменить</button>
      <button class="small-action secondary schedule-common-action--danger ${actionMode === 'delete' ? 'active' : ''}" type="button" data-schedule-action-mode="delete">Удалить</button>
    </div>`;
  }
  function selectionHintMarkup(){
    if(!actionMode) return '';
    const verb = actionMode === 'edit' ? 'изменить' : 'удалить';
    return `<p class="schedule-selection-hint" role="status">Выберите запись в нужном дне, которую нужно ${verb}. Повторное нажатие отменит выбор.</p>`;
  }
  function dateObject(key){
    const match = String(key).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? new Date(Number(match[1]), Number(match[2])-1, Number(match[3]), 12) : null;
  }
  function seniorBadgeMarkup(event){
    return isSeniorWaiter(event) ? '<span class="schedule-senior-badge">Старший</span>' : '';
  }
  function mobileEventMarkup(event){
    const title = isShift(event) ? shiftEmployeeName(event) : (event?.title || event?.type || 'Событие');
    const classes = visualClasses(event,'schedule-mobile-event');
    return `<article class="schedule-mobile-event ${classes}" data-schedule-event-id="${escapeHtml(event?.id || '')}" tabindex="${actionMode ? '0' : '-1'}">
      <div class="schedule-mobile-event-title"><strong>${escapeHtml(title)}</strong>${seniorBadgeMarkup(event)}</div>
      ${event?.description ? `<span>${escapeHtml(event.description)}</span>` : ''}
    </article>`;
  }
  function mobileAgendaMarkup(){
    const month = String(appState()?.scheduleMonth || localDateKey().slice(0,7));
    const groups = new Map();
    filteredScheduleEvents()
      .filter(event => normalizeDateValue(event?.eventDate || event?.event_date).startsWith(month))
      .sort((a,b) => normalizeDateValue(a?.eventDate || a?.event_date).localeCompare(normalizeDateValue(b?.eventDate || b?.event_date))
        || String(a?.title || '').localeCompare(String(b?.title || ''),'ru'))
      .forEach(event => {
        const key = normalizeDateValue(event?.eventDate || event?.event_date);
        if(!groups.has(key)) groups.set(key, []);
        groups.get(key).push(event);
      });
    if(!groups.size){
      return '<div class="schedule-mobile-agenda" data-schedule-mobile-agenda><div class="schedule-mobile-empty">В этом месяце записей нет.</div></div>';
    }
    return `<div class="schedule-mobile-agenda" data-schedule-mobile-agenda>${Array.from(groups.entries()).map(([key,events]) => {
      const date = dateObject(key);
      const weekday = date ? date.toLocaleDateString('ru-RU',{weekday:'short'}) : key;
      const label = date ? date.toLocaleDateString('ru-RU',{day:'numeric',month:'long'}) : key;
      return `<section class="schedule-mobile-day ${key === localDateKey() ? 'schedule-mobile-day--today' : ''}" data-schedule-date="${key}">
        <header><span>${escapeHtml(weekday)}</span><strong>${escapeHtml(label)}</strong></header>
        <div class="schedule-mobile-events">${events.map(mobileEventMarkup).join('')}</div>
      </section>`;
    }).join('')}</div>`;
  }

  function decorateEventCards(panel){
    const eventsById = new Map(allScheduleEvents().map(event => [String(event?.id),event]));
    panel.querySelectorAll('[data-schedule-event-id]').forEach(card => {
      const event = eventsById.get(String(card.dataset.scheduleEventId));
      card.querySelector('.schedule-event-actions')?.remove();
      if(!event) return;
      const classes = visualClasses(event);
      if(classes) card.classList.add(...classes.split(' '));
      if(isSeniorWaiter(event) && !card.querySelector('.schedule-senior-badge')){
        card.querySelector('strong')?.insertAdjacentHTML('afterend',seniorBadgeMarkup(event));
      }
      if(activeDepartment === 'hall' && isShift(event)){
        const firstSpan = card.querySelector('span:not(.schedule-senior-badge)');
        if(firstSpan && /^смена(?:\s|·|$)/i.test(firstSpan.textContent.trim())) firstSpan.remove();
      }
      if(actionMode){
        card.setAttribute('tabindex','0');
        card.setAttribute('role','button');
        card.setAttribute('aria-label',`${actionMode === 'edit' ? 'Изменить' : 'Удалить'}: ${event.title || event.type || 'запись'}`);
      }
    });
  }
  function decorateScheduleHtml(html){
    if(!global.document?.createElement) return html;
    const template = document.createElement('template');
    if(!('content' in template)) return html;
    template.innerHTML = String(html || '').trim();
    const panel = template.content.firstElementChild;
    if(!panel) return html;
    panel.dataset.scheduleDepartment = activeDepartment;
    if(actionMode) panel.classList.add('schedule-select-mode');
    panel.querySelector('.section-heading')?.insertAdjacentHTML('afterend',tabsMarkup() + legendMarkup());
    const toolbar = panel.querySelector('.schedule-manager-toolbar');
    toolbar?.insertAdjacentHTML('beforeend',commonActionsMarkup());
    toolbar?.insertAdjacentHTML('afterend',selectionHintMarkup());
    const grid = panel.querySelector('#schedule-grid-wrap');
    if(grid){
      grid.classList.add('schedule-desktop-grid');
      grid.insertAdjacentHTML('afterend',mobileAgendaMarkup());
    }
    decorateEventCards(panel);
    if(activeDepartment === 'hall'){
      panel.querySelector('.schedule-import-wrap')?.remove();
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
    actionMode = '';
    const [year,month] = String(current.scheduleMonth || localDateKey().slice(0,7)).split('-').map(Number);
    const next = new Date(year,month-1+delta,1,12);
    current.scheduleMonth = `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}`;
    rerenderPanel();
  }

  function shiftTimeRange(event){
    const source = `${event?.title || ''} ${event?.description || ''}`;
    const range = source.match(/(\d{1,2})[.:](\d{2})\s*[—–-]\s*(\d{1,2})[.:](\d{2})/);
    return range ? [`${String(range[1]).padStart(2,'0')}:${range[2]}`,`${String(range[3]).padStart(2,'0')}:${range[4]}`] : ['',''];
  }
  function shiftExtraDescription(event){
    return String(event?.description || '')
      .replace(/\b\d{1,2}[.:]\d{2}\s*[—–-]\s*\d{1,2}[.:]\d{2}\b/g,'')
      .replace(/^целая\s+смена\s*[·,;—–-]*\s*/i,'')
      .replace(/^\s*[·,;—–-]+\s*|\s*[·,;—–-]+\s*$/g,'')
      .trim();
  }
  function syncFormType(form){
    const shift = String(form?.elements?.type?.value || '').toLowerCase().includes('смен');
    const fields = form?.querySelector?.('[data-schedule-shift-fields]');
    if(fields) fields.hidden = !shift;
    const label = form?.querySelector?.('[data-schedule-title-label]');
    if(label) label.textContent = shift ? 'Сотрудник' : 'Название';
    if(form?.elements?.title) form.elements.title.placeholder = shift ? 'Например, Анна' : 'Например, обучение по новому меню';
  }
  function openEditForm(event){
    const details = document.querySelector('#schedule-form-wrap');
    const form = document.querySelector('#schedule-event-form');
    if(!details || !form || !event) return;
    form.reset();
    form.elements.eventId.value = event.id || '';
    form.elements.eventDate.value = normalizeDateValue(event.eventDate || event.event_date) || localDateKey();
    form.elements.type.value = event.type || event.event_type || 'Мероприятие';
    form.elements.employeeName.value = currentProfile()?.name || '';
    if(isShift(event)){
      form.elements.title.value = shiftEmployeeName(event);
      const [start,end] = shiftTimeRange(event);
      form.elements.startTime.value = start;
      form.elements.endTime.value = end;
      form.elements.description.value = shiftExtraDescription(event);
    } else {
      form.elements.title.value = event.title || '';
      form.elements.description.value = event.description || '';
    }
    syncFormType(form);
    const submit = form.querySelector('[data-schedule-submit]');
    if(submit) submit.textContent = 'Сохранить';
    const cancel = form.querySelector('[data-schedule-cancel]');
    if(cancel) cancel.hidden = false;
    const summary = document.querySelector('[data-schedule-form-summary]');
    if(summary) summary.textContent = 'Редактирование записи';
    details.open = true;
    details.scrollIntoView?.({block:'start',behavior:'smooth'});
    global.requestAnimationFrame?.(() => form.elements.title.focus?.({preventScroll:true}));
  }
  function buildShiftDescription(startTime,endTime,note){
    let timeText = '';
    if(startTime && endTime) timeText = `${startTime}–${endTime}`;
    else if(startTime) timeText = `с ${startTime}`;
    else if(endTime) timeText = `до ${endTime}`;
    else timeText = 'Целая смена';
    return [timeText,String(note || '').trim()].filter(Boolean).join(' · ');
  }
  function formRecord(form){
    const type = String(form.elements.type.value || 'Мероприятие').trim();
    const shift = type.toLowerCase().includes('смен');
    const rawTitle = String(form.elements.title.value || '').trim();
    const existing = findScheduleEvent(form.elements.eventId.value);
    return {
      id:String(form.elements.eventId.value || ''),
      existing,
      eventDate:normalizeDateValue(form.elements.eventDate.value),
      type,
      title:shift ? `Смена: ${rawTitle}` : rawTitle,
      description:shift
        ? buildShiftDescription(form.elements.startTime.value,form.elements.endTime.value,form.elements.description.value)
        : String(form.elements.description.value || '').trim()
    };
  }
  function sourceForRecord(record){
    const existingSource = String(record.existing?.source || '').trim().toLowerCase();
    if(existingSource.startsWith('hall:')) return 'hall:manual';
    if(existingSource.startsWith('bar:')) return 'bar:manual';
    if(record.existing && !isShift(record.existing)) return record.existing.source || 'manual';
    return `${activeDepartment}:manual`;
  }
  function resetFormAfterSave(form){
    form.reset();
    form.elements.eventId.value = '';
    form.elements.eventDate.value = localDateKey();
    form.elements.employeeName.value = currentProfile()?.name || '';
    const submit = form.querySelector('[data-schedule-submit]');
    if(submit) submit.textContent = 'Добавить';
    const cancel = form.querySelector('[data-schedule-cancel]');
    if(cancel) cancel.hidden = true;
    const summary = document.querySelector('[data-schedule-form-summary]');
    if(summary) summary.textContent = 'Добавить запись в расписание';
    syncFormType(form);
  }
  async function submitScheduleForm(event){
    const form = event.target;
    if(!form?.matches?.('#schedule-event-form')) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if(!canManageSchedule()) return;
    const record = formRecord(form);
    const status = form.querySelector('.schedule-status');
    if(!record.eventDate || !record.title || record.title === 'Смена: '){
      if(status){ status.textContent = 'Заполните дату и название или имя сотрудника.'; status.className = 'submit-status schedule-status error'; }
      return;
    }
    const profile = currentProfile();
    if(!profile?.id){
      if(status){ status.textContent = 'Нужно войти в аккаунт.'; status.className = 'submit-status schedule-status error'; }
      return;
    }
    const button = form.querySelector('[data-schedule-submit]');
    if(button) button.disabled = true;
    if(status){ status.textContent = record.id ? 'Сохраняю изменения…' : 'Добавляю запись…'; status.className = 'submit-status schedule-status'; }
    const row = {
      event_date:record.eventDate,
      event_type:record.type,
      title:record.title,
      description:record.description,
      source:sourceForRecord(record)
    };
    try {
      let result;
      if(record.id){
        result = await client().from('schedule_events').update(row).eq('id',record.id).select('*').maybeSingle();
      } else {
        result = await client().from('schedule_events').insert({
          id:global.crypto?.randomUUID?.() || stableUuid(`${Date.now()}-${Math.random()}`),
          ...row,
          employee_name:profile.name || '',
          created_by:profile.id
        }).select('*').single();
      }
      if(result.error) throw result.error;
      if(record.id && !result.data) throw new Error('Запись не найдена или у вас нет доступа.');
      actionMode = '';
      if(typeof global.loadScheduleEvents === 'function') await global.loadScheduleEvents();
      else rerenderPanel();
      resetFormAfterSave(form);
      const details = document.querySelector('#schedule-form-wrap');
      if(details) details.open = false;
      global.alert?.(record.id ? 'Изменения сохранены' : (record.type === 'Смена' ? 'Смена добавлена' : 'Мероприятие добавлено'));
    } catch(error){
      console.error(error);
      if(status){ status.textContent = error?.message || 'Не удалось сохранить расписание.'; status.className = 'submit-status schedule-status error'; }
    } finally {
      if(button) button.disabled = false;
    }
  }
  async function ensureEditableEvent(event){
    if(!event?.readOnly) return event;
    await migrateHallSchedule();
    return allScheduleEvents().find(candidate => !candidate.readOnly && eventKey(candidate) === eventKey(event)) || null;
  }
  async function deleteScheduleEvent(event){
    const editable = await ensureEditableEvent(event);
    if(!editable){
      global.alert?.('График ещё синхронизируется. Повторите действие через несколько секунд.');
      return;
    }
    if(global.confirm?.(`Удалить запись «${editable.title || editable.type}»?`) === false) return;
    const result = await client().from('schedule_events').delete().eq('id',editable.id).select('id').maybeSingle();
    if(result.error) throw result.error;
    if(!result.data) throw new Error('Запись не найдена или у вас нет доступа.');
    actionMode = '';
    if(typeof global.loadScheduleEvents === 'function') await global.loadScheduleEvents();
    else rerenderPanel();
  }
  async function handleSelectedEvent(event){
    const mode = actionMode;
    actionMode = '';
    const editable = await ensureEditableEvent(event);
    if(!editable){
      rerenderPanel();
      global.alert?.('График ещё синхронизируется. Повторите действие через несколько секунд.');
      return;
    }
    if(mode === 'edit'){
      rerenderPanel();
      openEditForm(editable);
      return;
    }
    if(mode === 'delete'){
      try { await deleteScheduleEvent(editable); }
      catch(error){ console.error(error); global.alert?.(error?.message || 'Не удалось удалить запись.'); rerenderPanel(); }
    }
  }

  function mapScheduleRow(row){
    return {
      id:row.id,
      eventDate:normalizeDateValue(row.event_date),
      createdAt:row.created_at,
      type:row.event_type || 'Мероприятие',
      title:row.title || '',
      description:row.description || '',
      employeeName:row.employee_name || '',
      source:row.source || ''
    };
  }
  async function loadScheduleEventsWithDepartment(){
    const current = appState();
    if(current){ current.scheduleLoading = true; current.scheduleError = ''; }
    try {
      const result = await client().from('schedule_events').select('*').order('event_date',{ascending:true});
      if(result.error) throw result.error;
      const rows = (result.data || []).map(mapScheduleRow);
      if(current) current.scheduleEvents = rows;
      try { global.localStorage?.setItem(LOCAL_SCHEDULE_KEY,JSON.stringify(rows)); } catch(error) {}
      return rows;
    } catch(error){
      console.warn(error);
      if(current) current.scheduleError = error?.message || 'Не удалось загрузить расписание.';
      if(baseLoadScheduleEvents) return await baseLoadScheduleEvents();
      return [];
    } finally {
      if(current) current.scheduleLoading = false;
      rerenderPanel();
    }
  }
  async function migrateHallSchedule(){
    if(!canManageSchedule()) return false;
    if(migrationPromise) return migrationPromise;
    migrationPromise = (async () => {
      const profile = currentProfile();
      if(!profile?.id) return false;
      const markerCheck = await client().from('schedule_events').select('id').eq('source',HALL_MARKER_SOURCE).limit(1);
      if(markerCheck.error) throw markerCheck.error;
      if(markerCheck.data?.length){
        await loadScheduleEventsWithDepartment();
        return true;
      }
      const rows = embeddedHallEvents.map(event => ({
        id:event.id,
        event_date:event.eventDate,
        event_type:'Смена',
        title:event.title,
        description:event.description,
        employee_name:profile.name || '',
        source:HALL_IMPORT_SOURCE,
        created_by:profile.id
      }));
      for(let offset = 0; offset < rows.length; offset += IMPORT_CHUNK_SIZE){
        const result = await client().from('schedule_events').upsert(rows.slice(offset,offset + IMPORT_CHUNK_SIZE),{onConflict:'id'});
        if(result.error) throw result.error;
      }
      const marker = {
        id:stableUuid(HALL_MARKER_SOURCE),
        event_date:'2026-07-01',
        event_type:'Система',
        title:HALL_MARKER_TITLE,
        description:'',
        employee_name:profile.name || '',
        source:HALL_MARKER_SOURCE,
        created_by:profile.id
      };
      const markerResult = await client().from('schedule_events').upsert(marker,{onConflict:'id'});
      if(markerResult.error) throw markerResult.error;
      await loadScheduleEventsWithDepartment();
      return true;
    })().catch(error => {
      console.warn('Не удалось синхронизировать график зала',error);
      return false;
    }).finally(() => { migrationPromise = null; });
    return migrationPromise;
  }

  function onWindowClick(event){
    const target = event.target?.closest?.('[data-schedule-department-tab], [data-schedule-prev], [data-schedule-next], [data-schedule-action-mode], [data-schedule-event-id]');
    if(!target) return;
    if(target.matches('[data-schedule-event-id]') && !actionMode) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if(target.matches('[data-schedule-department-tab]')){
      setActiveDepartment(target.dataset.scheduleDepartmentTab);
      rerenderPanel();
      if(activeDepartment === 'hall') void migrateHallSchedule();
      return;
    }
    if(target.matches('[data-schedule-prev], [data-schedule-next]')){
      changeMonth(target.matches('[data-schedule-prev]') ? -1 : 1);
      return;
    }
    if(target.matches('[data-schedule-action-mode]')){
      const requested = target.dataset.scheduleActionMode;
      actionMode = actionMode === requested ? '' : requested;
      rerenderPanel();
      return;
    }
    const selected = findScheduleEvent(target.dataset.scheduleEventId);
    if(selected) void handleSelectedEvent(selected);
  }
  function onWindowKeydown(event){
    if(!actionMode || !['Enter',' '].includes(event.key)) return;
    const target = event.target?.closest?.('[data-schedule-event-id]');
    if(!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const selected = findScheduleEvent(target.dataset.scheduleEventId);
    if(selected) void handleSelectedEvent(selected);
  }
  function onWindowSubmit(event){
    if(event.target?.matches?.('#schedule-event-form')) void submitScheduleForm(event);
  }

  function install(){
    global.getScheduleEvents = allScheduleEvents;
    global.loadScheduleEvents = loadScheduleEventsWithDepartment;
    global.renderSchedule = renderSchedule;
    global.renderScheduleGrid = renderScheduleGrid;
    global.refreshSchedule = rerenderPanel;
    global.addEventListener?.('click',onWindowClick,true);
    global.addEventListener?.('keydown',onWindowKeydown,true);
    global.addEventListener?.('submit',onWindowSubmit,true);
    if(document.querySelector('#top-schedule')) rerenderPanel();
    document.documentElement.dataset.scheduleDepartmentsVersion = VERSION;
    Promise.resolve().then(async () => {
      await loadScheduleEventsWithDepartment();
      if(canManageSchedule()) await migrateHallSchedule();
    });
  }

  global.SovremennikScheduleDepartments = Object.freeze({
    VERSION,
    HALL_IMPORT_SOURCE,
    HALL_MARKER_SOURCE,
    hallEvents:embeddedHallEvents,
    allScheduleEvents,
    filteredScheduleEvents,
    sourceDepartment,
    shiftKind,
    isSeniorWaiter,
    get activeDepartment(){ return activeDepartment; },
    get actionMode(){ return actionMode; },
    setActiveDepartment,
    renderSchedule,
    renderScheduleGrid,
    mobileAgendaMarkup,
    migrateHallSchedule
  });
  install();
})(window);

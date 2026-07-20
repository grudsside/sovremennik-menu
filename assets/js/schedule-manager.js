/* Современник schedule manager — local-date calendar, shift CRUD and spreadsheet import */
(function(global){
  'use strict';

  const VERSION = '2026-07-20-schedule-manager-1';
  const XLSX_CDN = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
  const IMPORT_LIMIT = 1000;
  const IMPORT_CHUNK_SIZE = 100;
  const MONTHS = [
    'январь','февраль','март','апрель','май','июнь',
    'июль','август','сентябрь','октябрь','ноябрь','декабрь'
  ];

  let sheetJsPromise = null;
  let pendingImport = [];

  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[character]));
  }

  function appState(){
    return typeof state !== 'undefined' ? state : null;
  }

  function currentProfile(){
    try { return typeof currentUser === 'function' ? currentUser() : null; }
    catch(error){ return null; }
  }

  function normalizeRoleValue(value){
    if(typeof normalizeRole === 'function') return normalizeRole(value);
    const role = String(value || '').trim().toLowerCase();
    return ({ 'администратор':'admin', 'руководитель':'manager', 'менеджер':'manager' })[role] || role;
  }

  function canManageSchedule(){
    return ['admin','manager'].includes(normalizeRoleValue(currentProfile()?.role));
  }

  function client(){
    const value = global.sovremennikSupabase;
    if(!value) throw new Error('Supabase временно недоступен.');
    return value;
  }

  function pad2(value){
    return String(value).padStart(2, '0');
  }

  function localDateKey(date = new Date()){
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function localMonthKey(date = new Date()){
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
  }

  function excelSerialDateKey(value){
    const serial = Number(value);
    if(!Number.isFinite(serial) || serial < 20000 || serial > 100000) return '';
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
    return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())}`;
  }

  function normalizeDateValue(value){
    if(value instanceof Date && !Number.isNaN(value.getTime())) return localDateKey(value);
    if(typeof value === 'number') return excelSerialDateKey(value);
    const text = String(value ?? '').trim();
    if(!text) return '';

    let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D|$)/);
    if(match) return `${match[1]}-${pad2(match[2])}-${pad2(match[3])}`;

    match = text.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})(?:\D|$)/);
    if(match) return `${match[3]}-${pad2(match[2])}-${pad2(match[1])}`;

    if(/^\d+(?:[.,]\d+)?$/.test(text)) return excelSerialDateKey(text.replace(',', '.'));

    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? '' : localDateKey(parsed);
  }

  function monthTitle(monthKey){
    const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    if(!match) return String(monthKey || '');
    const monthIndex = Number(match[2]) - 1;
    return `${MONTHS[monthIndex] || ''} ${match[1]}`.trim();
  }

  function scheduleRows(){
    try {
      if(typeof getScheduleEvents === 'function') return getScheduleEvents() || [];
      return Array.isArray(appState()?.scheduleEvents) ? appState().scheduleEvents : [];
    } catch(error){
      return [];
    }
  }

  function scheduleEventsForDate(dateKey){
    return scheduleRows().filter(event => normalizeDateValue(event?.eventDate || event?.event_date) === dateKey);
  }

  function scheduleEventClass(event){
    const type = String(event?.type || event?.event_type || '').toLowerCase();
    if(type.includes('смен')) return 'schedule-event schedule-event--shift';
    if(type.includes('собран')) return 'schedule-event schedule-event--meeting';
    if(type.includes('обуч')) return 'schedule-event schedule-event--training';
    return 'schedule-event schedule-event--event';
  }

  function isShift(event){
    return String(event?.type || event?.event_type || '').toLowerCase().includes('смен');
  }

  function shiftEmployeeName(event){
    const title = String(event?.title || '').trim();
    const cleaned = title
      .replace(/^смена\s*[:—-]?\s*/i, '')
      .replace(/\s*[:—-]\s*(?:целая\s+смена|\d{1,2}[.:]\d{2}\s*[—–-]\s*\d{1,2}[.:]\d{2}).*$/i, '')
      .trim();
    return cleaned || 'Сотрудник';
  }

  function shiftTimeRange(event){
    const source = `${event?.title || ''} ${event?.description || ''}`;
    const range = source.match(/(\d{1,2}[.:]\d{2})\s*[—–-]\s*(\d{1,2}[.:]\d{2})/);
    return range ? [range[1].replace('.', ':'), range[2].replace('.', ':')] : ['', ''];
  }

  function shiftExtraDescription(event){
    const description = String(event?.description || '').trim();
    return description
      .replace(/\b\d{1,2}[.:]\d{2}\s*[—–-]\s*\d{1,2}[.:]\d{2}\b/g, '')
      .replace(/^\s*[·,;—–-]+\s*|\s*[·,;—–-]+\s*$/g, '')
      .replace(/^целая\s+смена\s*[·,;—–-]*\s*/i, '')
      .trim();
  }

  function eventMarkup(event){
    const type = event?.type || event?.event_type || 'Мероприятие';
    const title = event?.title || type;
    const author = event?.employeeName || event?.employee_name || '';
    const description = event?.description || '';
    const controls = canManageSchedule() ? `<div class="schedule-event-actions">
      <button type="button" class="schedule-event-action" data-schedule-edit="${escapeHtml(event.id)}">Изменить</button>
      <button type="button" class="schedule-event-action schedule-event-action--danger" data-schedule-delete="${escapeHtml(event.id)}">Удалить</button>
    </div>` : '';
    return `<article class="${scheduleEventClass(event)}" data-schedule-event-id="${escapeHtml(event.id)}">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(type)}${author ? ` · ${escapeHtml(author)}` : ''}</span>
      ${description ? `<span>${escapeHtml(description)}</span>` : ''}
      ${controls}
    </article>`;
  }

  function renderScheduleGrid(){
    const current = appState();
    const monthKey = current?.scheduleMonth || localMonthKey();
    const [year, month] = monthKey.split('-').map(Number);
    const first = new Date(year, month - 1, 1, 12, 0, 0);
    const start = new Date(first);
    const offset = (first.getDay() + 6) % 7;
    start.setDate(first.getDate() - offset);
    const today = localDateKey();
    const days = [];

    for(let index = 0; index < 42; index += 1){
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = localDateKey(date);
      days.push({
        key,
        day:date.getDate(),
        muted:date.getMonth() !== month - 1,
        today:key === today,
        events:scheduleEventsForDate(key)
      });
    }

    const weekdays = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    return `<div class="schedule-grid">${weekdays.map(day => `<div class="schedule-weekday">${day}</div>`).join('')}${days.map(day => `
      <div class="schedule-day ${day.muted ? 'muted' : ''} ${day.today ? 'schedule-day--today' : ''}" data-schedule-date="${day.key}">
        <div class="schedule-date">${day.day}</div>
        <div class="schedule-events">${day.events.map(eventMarkup).join('')}</div>
      </div>`).join('')}</div>`;
  }

  function scheduleFormMarkup(){
    const profileName = currentProfile()?.name || '';
    return `<details class="schedule-form-wrap schedule-manager-form" id="schedule-form-wrap">
      <summary data-schedule-form-summary>Добавить запись в расписание</summary>
      <form class="schedule-event-form" id="schedule-event-form">
        <input name="eventId" type="hidden" value="">
        <div class="form-grid">
          <label>Дата<input name="eventDate" type="date" value="${localDateKey()}" required></label>
          <label>Тип<select name="type" data-schedule-type>
            <option>Мероприятие</option><option>Смена</option><option>Обучение</option><option>Собрание</option>
          </select></label>
          <label><span data-schedule-title-label>Название</span><input name="title" type="text" required placeholder="Например, обучение по новому меню"></label>
          <label>Добавил<input name="employeeName" type="text" value="${escapeHtml(profileName)}" readonly></label>
        </div>
        <div class="form-grid schedule-shift-fields" data-schedule-shift-fields hidden>
          <label>Начало смены<input name="startTime" type="time"></label>
          <label>Конец смены<input name="endTime" type="time"></label>
        </div>
        <label>Описание<textarea name="description" rows="3" placeholder="Время, участники, детали"></textarea></label>
        <div class="schedule-form-actions">
          <button class="small-action" type="submit" data-schedule-submit>Добавить</button>
          <button class="small-action secondary" type="button" data-schedule-cancel hidden>Отменить редактирование</button>
        </div>
        <p class="submit-status schedule-status" aria-live="polite"></p>
      </form>
    </details>`;
  }

  function scheduleImportMarkup(){
    return `<details class="schedule-import-wrap">
      <summary>Загрузить график файлом</summary>
      <div class="schedule-import-panel">
        <p>Поддерживаются Excel, ODS и CSV. Можно загрузить таблицу строками «Дата · Сотрудник · Начало · Конец» или матрицу, где сотрудники указаны по строкам, а даты — по столбцам.</p>
        <label class="schedule-file-label">Файл графика
          <input id="schedule-file-input" type="file" accept=".xlsx,.xls,.ods,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
        </label>
        <div class="schedule-import-preview" data-schedule-import-preview></div>
        <div class="schedule-import-actions">
          <button class="small-action" type="button" data-schedule-import-confirm hidden>Загрузить записи</button>
          <button class="small-action secondary" type="button" data-schedule-import-clear hidden>Очистить</button>
        </div>
        <p class="submit-status schedule-import-status" aria-live="polite"></p>
      </div>
    </details>`;
  }

  function renderSchedule(){
    const current = appState();
    const manageable = canManageSchedule();
    return `<section class="top-panel ${current?.activeTop === 'schedule' ? 'active' : ''}" id="top-schedule">
      <div class="section-heading"><p>График</p><h2>Расписание</h2></div>
      <div class="schedule-card">
        <div class="schedule-toolbar schedule-manager-toolbar">
          <div class="schedule-month-nav">
            <button class="small-action secondary" type="button" data-schedule-prev>←</button>
            <div class="schedule-month-title">${escapeHtml(monthTitle(current?.scheduleMonth || localMonthKey()))}</div>
            <button class="small-action secondary" type="button" data-schedule-next>→</button>
          </div>
          ${manageable ? `<div class="schedule-manager-actions">
            <button class="small-action" type="button" data-schedule-add-shift>Добавить смену</button>
            <button class="small-action secondary" type="button" data-toggle-schedule-form>Добавить мероприятие</button>
          </div>` : ''}
        </div>
        <div id="schedule-grid-wrap">${renderScheduleGrid()}</div>
        ${manageable ? scheduleFormMarkup() + scheduleImportMarkup() : ''}
        ${current?.scheduleError ? `<p class="employees-error">${escapeHtml(current.scheduleError)}</p>` : ''}
      </div>
    </section>`;
  }

  function refreshSchedule(){
    const current = appState();
    const wrap = document.querySelector('#schedule-grid-wrap');
    if(wrap) wrap.innerHTML = renderScheduleGrid();
    const title = document.querySelector('.schedule-month-title');
    if(title) title.textContent = monthTitle(current?.scheduleMonth || localMonthKey());
  }

  function changeMonth(delta){
    const current = appState();
    if(!current) return;
    const [year, month] = String(current.scheduleMonth || localMonthKey()).split('-').map(Number);
    const next = new Date(year, month - 1 + delta, 1, 12, 0, 0);
    current.scheduleMonth = localMonthKey(next);
    refreshSchedule();
  }

  function setStatus(selector, message, isError = false){
    const element = document.querySelector(selector);
    if(!element) return;
    element.textContent = message || '';
    element.className = `submit-status ${selector.includes('import') ? 'schedule-import-status' : 'schedule-status'}${isError ? ' error' : ''}`;
  }

  function syncFormType(form){
    if(!form) return;
    const shift = String(form.elements.type?.value || '').toLowerCase().includes('смен');
    const fields = form.querySelector('[data-schedule-shift-fields]');
    if(fields) fields.hidden = !shift;
    const label = form.querySelector('[data-schedule-title-label]');
    if(label) label.textContent = shift ? 'Сотрудник' : 'Название';
    const title = form.elements.title;
    if(title) title.placeholder = shift ? 'Например, Анна' : 'Например, обучение по новому меню';
  }

  function resetScheduleForm(options = {}){
    const form = document.querySelector('#schedule-event-form');
    if(!form) return;
    form.reset();
    form.elements.eventId.value = '';
    form.elements.eventDate.value = options.date || localDateKey();
    form.elements.type.value = options.type || 'Мероприятие';
    form.elements.employeeName.value = currentProfile()?.name || '';
    const submit = form.querySelector('[data-schedule-submit]');
    if(submit) submit.textContent = 'Добавить';
    const cancel = form.querySelector('[data-schedule-cancel]');
    if(cancel) cancel.hidden = true;
    const summary = document.querySelector('[data-schedule-form-summary]');
    if(summary) summary.textContent = options.type === 'Смена' ? 'Добавить смену' : 'Добавить запись в расписание';
    syncFormType(form);
    setStatus('.schedule-status', '');
  }

  function openScheduleForm(type = 'Мероприятие', date = localDateKey()){
    const details = document.querySelector('#schedule-form-wrap');
    resetScheduleForm({ type, date });
    if(details) details.open = true;
    const form = document.querySelector('#schedule-event-form');
    global.requestAnimationFrame?.(() => form?.elements?.title?.focus?.({ preventScroll:true }));
  }

  function findScheduleEvent(id){
    return scheduleRows().find(event => String(event?.id) === String(id)) || null;
  }

  function openEditForm(event){
    const details = document.querySelector('#schedule-form-wrap');
    const form = document.querySelector('#schedule-event-form');
    if(!details || !form || !event) return;
    resetScheduleForm({ type:event.type || event.event_type || 'Мероприятие', date:normalizeDateValue(event.eventDate || event.event_date) || localDateKey() });
    form.elements.eventId.value = event.id || '';
    form.elements.type.value = event.type || event.event_type || 'Мероприятие';
    if(isShift(event)){
      form.elements.title.value = shiftEmployeeName(event);
      const [start, end] = shiftTimeRange(event);
      form.elements.startTime.value = start;
      form.elements.endTime.value = end;
      form.elements.description.value = shiftExtraDescription(event);
    } else {
      form.elements.title.value = event.title || '';
      form.elements.description.value = event.description || '';
    }
    const submit = form.querySelector('[data-schedule-submit]');
    if(submit) submit.textContent = 'Сохранить';
    const cancel = form.querySelector('[data-schedule-cancel]');
    if(cancel) cancel.hidden = false;
    const summary = document.querySelector('[data-schedule-form-summary]');
    if(summary) summary.textContent = 'Редактирование записи';
    syncFormType(form);
    details.open = true;
    details.scrollIntoView?.({ block:'start', behavior:'smooth' });
    global.requestAnimationFrame?.(() => form.elements.title.focus?.({ preventScroll:true }));
  }

  function buildShiftDescription(startTime, endTime, note){
    let timeText = '';
    if(startTime && endTime) timeText = `${startTime}–${endTime}`;
    else if(startTime) timeText = `с ${startTime}`;
    else if(endTime) timeText = `до ${endTime}`;
    else timeText = 'Целая смена';
    return [timeText, String(note || '').trim()].filter(Boolean).join(' · ');
  }

  function formRecord(form){
    const type = String(form.elements.type.value || 'Мероприятие').trim();
    const shift = type.toLowerCase().includes('смен');
    const rawTitle = String(form.elements.title.value || '').trim();
    const date = normalizeDateValue(form.elements.eventDate.value);
    const description = String(form.elements.description.value || '').trim();
    const title = shift ? `Смена: ${rawTitle}` : rawTitle;
    return {
      id:String(form.elements.eventId.value || ''),
      eventDate:date,
      type,
      title,
      description:shift ? buildShiftDescription(form.elements.startTime.value, form.elements.endTime.value, description) : description,
      employeeName:currentProfile()?.name || ''
    };
  }

  async function saveScheduleRecord(record){
    const profile = currentProfile();
    if(!profile?.id) throw new Error('Нужно войти в аккаунт.');
    const row = {
      event_date:record.eventDate,
      event_type:record.type,
      title:record.title,
      description:record.description,
      source:'manual'
    };
    if(record.id){
      const result = await client().from('schedule_events').update(row).eq('id', record.id).select('*').maybeSingle();
      if(result.error) throw result.error;
      if(!result.data) throw new Error('Запись не найдена или у вас нет доступа.');
      return result.data;
    }
    const insertRow = {
      id:global.crypto?.randomUUID?.() || `event-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      ...row,
      employee_name:profile.name || '',
      created_by:profile.id
    };
    const result = await client().from('schedule_events').insert(insertRow).select('*').single();
    if(result.error) throw result.error;
    return result.data;
  }

  async function submitScheduleEvent(event){
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    const form = event.target?.matches?.('#schedule-event-form') ? event.target : event.currentTarget;
    if(!form?.matches?.('#schedule-event-form')) return;
    const status = form.querySelector('.schedule-status');
    if(!canManageSchedule()){
      if(status){ status.textContent = 'Редактировать расписание может руководитель или администратор.'; status.className = 'submit-status schedule-status error'; }
      return;
    }
    const record = formRecord(form);
    if(!record.eventDate || !record.title || record.title === 'Смена: '){
      if(status){ status.textContent = 'Заполните дату и название или имя сотрудника.'; status.className = 'submit-status schedule-status error'; }
      return;
    }
    const button = form.querySelector('[data-schedule-submit]');
    if(button) button.disabled = true;
    if(status){ status.textContent = record.id ? 'Сохраняю изменения…' : 'Добавляю запись…'; status.className = 'submit-status schedule-status'; }
    try {
      await saveScheduleRecord(record);
      if(typeof loadScheduleEvents === 'function') await loadScheduleEvents();
      else refreshSchedule();
      resetScheduleForm();
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

  async function deleteScheduleEvent(id){
    if(!canManageSchedule()) return;
    const event = findScheduleEvent(id);
    if(!event) return;
    if(global.confirm?.(`Удалить запись «${event.title || event.type}»?`) === false) return;
    try {
      const result = await client().from('schedule_events').delete().eq('id', id).select('id').maybeSingle();
      if(result.error) throw result.error;
      if(!result.data) throw new Error('Запись не найдена или у вас нет доступа.');
      if(typeof loadScheduleEvents === 'function') await loadScheduleEvents();
      else refreshSchedule();
    } catch(error){
      console.error(error);
      global.alert?.(error?.message || 'Не удалось удалить запись.');
    }
  }

  function canonicalHeader(value){
    return String(value ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, '');
  }

  function columnIndex(headers, aliases){
    const normalized = headers.map(canonicalHeader);
    return normalized.findIndex(header => aliases.some(alias => header === canonicalHeader(alias)));
  }

  function isEmptyShiftCell(value){
    const text = String(value ?? '').trim().toLowerCase();
    return !text || ['-','—','выходной','вых','off','нет'].includes(text);
  }

  function normalizeShiftCell(value){
    const text = String(value ?? '').trim();
    const range = text.match(/(\d{1,2}[.:]\d{2})\s*[—–-]\s*(\d{1,2}[.:]\d{2})/);
    if(range) return `${range[1].replace('.', ':')}–${range[2].replace('.', ':')}`;
    return text || 'Целая смена';
  }

  function importedRecord({ date, employee, type = 'Смена', title = '', description = '' }){
    const eventDate = normalizeDateValue(date);
    const normalizedType = String(type || 'Смена').trim() || 'Смена';
    const shift = normalizedType.toLowerCase().includes('смен');
    const employeeName = String(employee || '').trim();
    return {
      eventDate,
      type:normalizedType,
      title:shift ? `Смена: ${employeeName || String(title || '').trim() || 'Сотрудник'}` : String(title || normalizedType).trim(),
      description:String(description || '').trim(),
      source:'file'
    };
  }

  function parseRowTable(rows, headerIndex, headers){
    const dateIndex = columnIndex(headers, ['дата','день','date','event date','event_date']);
    const employeeIndex = columnIndex(headers, ['сотрудник','фио','имя','employee','бариста','официант']);
    const startIndex = columnIndex(headers, ['начало','с','start','start time','время начала']);
    const endIndex = columnIndex(headers, ['конец','до','end','end time','время окончания']);
    const timeIndex = columnIndex(headers, ['время','смена','график','часы','shift','time']);
    const typeIndex = columnIndex(headers, ['тип','type']);
    const titleIndex = columnIndex(headers, ['название','мероприятие','title']);
    const descriptionIndex = columnIndex(headers, ['описание','комментарий','примечание','description','note']);
    const records = [];

    for(const row of rows.slice(headerIndex + 1)){
      const date = dateIndex >= 0 ? row[dateIndex] : '';
      const eventDate = normalizeDateValue(date);
      if(!eventDate) continue;
      const employee = employeeIndex >= 0 ? row[employeeIndex] : '';
      const type = typeIndex >= 0 ? row[typeIndex] : (employee ? 'Смена' : 'Мероприятие');
      const title = titleIndex >= 0 ? row[titleIndex] : '';
      const note = descriptionIndex >= 0 ? row[descriptionIndex] : '';
      let time = timeIndex >= 0 ? row[timeIndex] : '';
      const start = startIndex >= 0 ? String(row[startIndex] || '').trim() : '';
      const end = endIndex >= 0 ? String(row[endIndex] || '').trim() : '';
      if(start || end) time = buildShiftDescription(start, end, '');
      const shift = String(type || '').toLowerCase().includes('смен') || Boolean(employee);
      const record = importedRecord({
        date:eventDate,
        employee,
        type:shift ? 'Смена' : type,
        title,
        description:shift ? [normalizeShiftCell(time), String(note || '').trim()].filter(Boolean).join(' · ') : note
      });
      if(record.eventDate && record.title) records.push(record);
    }
    return records;
  }

  function parseMatrixTable(rows){
    let headerIndex = -1;
    let dateColumns = [];
    for(let index = 0; index < Math.min(rows.length, 10); index += 1){
      const columns = rows[index].map((value, column) => ({ column, key:normalizeDateValue(value) })).filter(item => item.key);
      if(columns.length >= 2){
        headerIndex = index;
        dateColumns = columns;
        break;
      }
    }
    if(headerIndex < 0) return [];
    const headers = rows[headerIndex];
    const namedEmployeeIndex = columnIndex(headers, ['сотрудник','фио','имя','employee','бариста','официант']);
    const employeeIndex = namedEmployeeIndex >= 0 ? namedEmployeeIndex : Math.max(0, dateColumns[0].column - 1);
    const records = [];
    for(const row of rows.slice(headerIndex + 1)){
      const employee = String(row[employeeIndex] || '').trim();
      if(!employee) continue;
      for(const { column, key } of dateColumns){
        const value = row[column];
        if(isEmptyShiftCell(value)) continue;
        records.push(importedRecord({ date:key, employee, type:'Смена', description:normalizeShiftCell(value) }));
      }
    }
    return records;
  }

  function dedupeImported(records){
    const existing = new Set(scheduleRows().map(event => [
      normalizeDateValue(event.eventDate || event.event_date),
      String(event.type || event.event_type || '').trim().toLowerCase(),
      String(event.title || '').trim().toLowerCase(),
      String(event.description || '').trim().toLowerCase()
    ].join('|')));
    const seen = new Set();
    return records.filter(record => {
      const key = [record.eventDate, record.type.toLowerCase(), record.title.toLowerCase(), record.description.toLowerCase()].join('|');
      if(existing.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function parseImportedRows(rows){
    const cleanRows = (rows || []).map(row => Array.isArray(row) ? row : []).filter(row => row.some(value => String(value ?? '').trim()));
    if(!cleanRows.length) return [];
    let rowHeaderIndex = -1;
    let rowHeaders = null;
    for(let index = 0; index < Math.min(cleanRows.length, 10); index += 1){
      const headers = cleanRows[index];
      const dateIndex = columnIndex(headers, ['дата','день','date','event date','event_date']);
      const employeeIndex = columnIndex(headers, ['сотрудник','фио','имя','employee','бариста','официант']);
      const titleIndex = columnIndex(headers, ['название','мероприятие','title']);
      if(dateIndex >= 0 && (employeeIndex >= 0 || titleIndex >= 0)){
        rowHeaderIndex = index;
        rowHeaders = headers;
        break;
      }
    }
    const records = rowHeaderIndex >= 0 ? parseRowTable(cleanRows, rowHeaderIndex, rowHeaders) : parseMatrixTable(cleanRows);
    return dedupeImported(records).slice(0, IMPORT_LIMIT);
  }

  function parseCsv(text){
    const source = String(text || '').replace(/^\uFEFF/, '');
    const firstLine = source.split(/\r?\n/, 1)[0] || '';
    const delimiters = [';', ',', '\t'];
    const delimiter = delimiters.sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for(let index = 0; index < source.length; index += 1){
      const character = source[index];
      if(character === '"'){
        if(quoted && source[index + 1] === '"'){
          cell += '"';
          index += 1;
        } else quoted = !quoted;
      } else if(character === delimiter && !quoted){
        row.push(cell);
        cell = '';
      } else if((character === '\n' || character === '\r') && !quoted){
        if(character === '\r' && source[index + 1] === '\n') index += 1;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += character;
    }
    row.push(cell);
    rows.push(row);
    return rows;
  }

  function ensureSheetJs(){
    if(global.XLSX) return Promise.resolve(global.XLSX);
    if(sheetJsPromise) return sheetJsPromise;
    sheetJsPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = XLSX_CDN;
      script.async = true;
      script.onload = () => global.XLSX ? resolve(global.XLSX) : reject(new Error('Не удалось запустить обработку Excel.'));
      script.onerror = () => reject(new Error('Не удалось загрузить модуль чтения Excel. Проверьте интернет или используйте CSV.'));
      document.head.appendChild(script);
    }).finally(() => { if(!global.XLSX) sheetJsPromise = null; });
    return sheetJsPromise;
  }

  async function rowsFromFile(file){
    const extension = String(file?.name || '').split('.').pop().toLowerCase();
    if(extension === 'csv') return parseCsv(await file.text());
    const XLSX = await ensureSheetJs();
    const workbook = XLSX.read(await file.arrayBuffer(), { type:'array', cellDates:true });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if(!firstSheet) return [];
    return XLSX.utils.sheet_to_json(firstSheet, { header:1, raw:false, defval:'', blankrows:false });
  }

  function renderImportPreview(records){
    const preview = document.querySelector('[data-schedule-import-preview]');
    const confirmButton = document.querySelector('[data-schedule-import-confirm]');
    const clearButton = document.querySelector('[data-schedule-import-clear]');
    if(confirmButton){
      confirmButton.hidden = !records.length;
      confirmButton.textContent = records.length ? `Загрузить ${records.length} записей` : 'Загрузить записи';
    }
    if(clearButton) clearButton.hidden = !records.length;
    if(!preview) return;
    if(!records.length){
      preview.innerHTML = '';
      return;
    }
    const visible = records.slice(0, 12);
    preview.innerHTML = `<p><strong>Готово к загрузке: ${records.length}</strong>${records.length >= IMPORT_LIMIT ? ` · показан лимит ${IMPORT_LIMIT}` : ''}</p>
      <div class="schedule-import-table-wrap"><table><thead><tr><th>Дата</th><th>Тип</th><th>Название</th><th>Описание</th></tr></thead><tbody>
      ${visible.map(record => `<tr><td>${escapeHtml(record.eventDate)}</td><td>${escapeHtml(record.type)}</td><td>${escapeHtml(record.title)}</td><td>${escapeHtml(record.description)}</td></tr>`).join('')}
      </tbody></table></div>${records.length > visible.length ? `<small>Показаны первые ${visible.length} записей.</small>` : ''}`;
  }

  function clearImport(){
    pendingImport = [];
    const input = document.querySelector('#schedule-file-input');
    if(input) input.value = '';
    renderImportPreview([]);
    setStatus('.schedule-import-status', '');
  }

  async function prepareImport(file){
    setStatus('.schedule-import-status', 'Читаю файл…');
    try {
      pendingImport = parseImportedRows(await rowsFromFile(file));
      if(!pendingImport.length) throw new Error('Не нашёл новых записей. Проверьте столбцы или убедитесь, что такие смены ещё не загружены.');
      renderImportPreview(pendingImport);
      setStatus('.schedule-import-status', `Файл обработан: ${pendingImport.length} записей.`);
    } catch(error){
      pendingImport = [];
      renderImportPreview([]);
      setStatus('.schedule-import-status', error?.message || 'Не удалось прочитать файл.', true);
    }
  }

  async function confirmImport(){
    if(!pendingImport.length || !canManageSchedule()) return;
    const profile = currentProfile();
    if(!profile?.id){
      setStatus('.schedule-import-status', 'Нужно войти в аккаунт.', true);
      return;
    }
    const button = document.querySelector('[data-schedule-import-confirm]');
    if(button) button.disabled = true;
    setStatus('.schedule-import-status', `Загружаю ${pendingImport.length} записей…`);
    try {
      const rows = pendingImport.map(record => ({
        id:global.crypto?.randomUUID?.() || `event-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        event_date:record.eventDate,
        event_type:record.type,
        title:record.title,
        description:record.description,
        employee_name:profile.name || '',
        source:'file',
        created_by:profile.id
      }));
      for(let offset = 0; offset < rows.length; offset += IMPORT_CHUNK_SIZE){
        const result = await client().from('schedule_events').insert(rows.slice(offset, offset + IMPORT_CHUNK_SIZE));
        if(result.error) throw result.error;
      }
      const importedCount = rows.length;
      clearImport();
      if(typeof loadScheduleEvents === 'function') await loadScheduleEvents();
      else refreshSchedule();
      setStatus('.schedule-import-status', `График загружен: ${importedCount} записей.`);
    } catch(error){
      console.error(error);
      setStatus('.schedule-import-status', error?.message || 'Не удалось загрузить график.', true);
    } finally {
      if(button) button.disabled = false;
    }
  }

  function onDocumentClick(event){
    const target = event.target?.closest?.('[data-schedule-prev], [data-schedule-next], [data-toggle-schedule-form], [data-schedule-add-shift], [data-schedule-edit], [data-schedule-delete], [data-schedule-cancel], [data-schedule-import-confirm], [data-schedule-import-clear]');
    if(!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(target.matches('[data-schedule-prev]')) changeMonth(-1);
    else if(target.matches('[data-schedule-next]')) changeMonth(1);
    else if(target.matches('[data-toggle-schedule-form]')) openScheduleForm('Мероприятие');
    else if(target.matches('[data-schedule-add-shift]')) openScheduleForm('Смена');
    else if(target.matches('[data-schedule-edit]')) openEditForm(findScheduleEvent(target.dataset.scheduleEdit));
    else if(target.matches('[data-schedule-delete]')) void deleteScheduleEvent(target.dataset.scheduleDelete);
    else if(target.matches('[data-schedule-cancel]')) resetScheduleForm();
    else if(target.matches('[data-schedule-import-confirm]')) void confirmImport();
    else if(target.matches('[data-schedule-import-clear]')) clearImport();
  }

  function onDocumentChange(event){
    const target = event.target;
    if(target?.matches?.('[data-schedule-type]')) syncFormType(target.form);
    if(target?.matches?.('#schedule-file-input') && target.files?.[0]) void prepareImport(target.files[0]);
  }

  function onDocumentSubmit(event){
    if(!event.target?.matches?.('#schedule-event-form')) return;
    void submitScheduleEvent(event);
  }

  function installOverrides(){
    const current = appState();
    if(current){
      const utcMonth = new Date().toISOString().slice(0, 7);
      if(!current.scheduleMonth || current.scheduleMonth === utcMonth) current.scheduleMonth = localMonthKey();
    }

    global.renderSchedule = renderSchedule;
    global.renderScheduleGrid = renderScheduleGrid;
    global.refreshSchedule = refreshSchedule;
    global.submitScheduleEvent = submitScheduleEvent;

    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('change', onDocumentChange, true);
    document.addEventListener('submit', onDocumentSubmit, true);

    const visiblePanel = document.querySelector('#top-schedule');
    if(visiblePanel) visiblePanel.outerHTML = renderSchedule();
    document.documentElement.dataset.scheduleManagerVersion = VERSION;
  }

  global.SovremennikScheduleManager = Object.freeze({
    VERSION,
    XLSX_CDN,
    localDateKey,
    localMonthKey,
    normalizeDateValue,
    parseImportedRows,
    parseCsv,
    canManageSchedule,
    renderSchedule,
    renderScheduleGrid
  });

  installOverrides();
})(window);

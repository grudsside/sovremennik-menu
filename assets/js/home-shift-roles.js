/* Современник home shift roles — role badges and automatic shift times */
(function(global){
  'use strict';

  const VERSION = '2026-07-22-home-shift-roles-1';
  const ROLE_META = Object.freeze({
    barista:{ label:'Бариста', className:'barista' },
    waiter:{ label:'Официант', className:'waiter' }
  });
  let updateQueued = false;
  let observer = null;

  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[character]));
  }

  function localDateKey(date = new Date()){
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }

  function normalizeDateValue(value){
    if(typeof global.normalizeDateKey === 'function') return global.normalizeDateKey(value || '');
    const text = String(value || '').trim();
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : text.slice(0,10);
  }

  function dateFromKey(key){
    const match = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!match) return null;
    const value = new Date(Number(match[1]), Number(match[2])-1, Number(match[3]), 12);
    return Number.isNaN(value.getTime()) ? null : value;
  }

  function scheduleRows(){
    try {
      if(typeof global.getScheduleEvents === 'function') return global.getScheduleEvents() || [];
      return Array.isArray(global.state?.scheduleEvents) ? global.state.scheduleEvents : [];
    } catch(error){
      return [];
    }
  }

  function isShift(event){
    const type = String(event?.type || event?.eventType || event?.event_type || '').trim().toLowerCase();
    const title = String(event?.title || '').trim().toLowerCase();
    return type.includes('смен') || /^смена(?:\s|:|—|-|$)/i.test(title);
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
    return String(event?.employeeName || event?.employee_name || '').trim() || 'Сотрудник';
  }

  function shiftKind(event){
    const source = `${event?.title || ''} ${event?.description || ''}`.toLowerCase();
    if(source.includes('целая смена')) return 'full';
    if(source.includes('утренняя смена')) return 'morning';
    if(source.includes('вечерняя смена')) return 'evening';
    return '';
  }

  function explicitRange(event){
    const source = `${event?.title || ''} ${event?.description || ''}`;
    const range = source.match(/(\d{1,2})[.:](\d{2})\s*[—–-]\s*(\d{1,2})[.:](\d{2})/);
    if(!range) return '';
    return `${String(Number(range[1])).padStart(2,'0')}:${range[2]}–${String(Number(range[3])).padStart(2,'0')}:${range[4]}`;
  }

  function shiftTimeRange(event, dateKey = localDateKey()){
    const range = explicitRange(event);
    if(range) return range;
    const kind = shiftKind(event);
    const date = dateFromKey(dateKey);
    const weekend = date ? [0,6].includes(date.getDay()) : false;
    if(kind === 'full') return `${weekend ? '08:00' : '07:00'}–21:00`;
    if(kind === 'morning') return `${weekend ? '08:00' : '07:00'}–15:00`;
    if(kind === 'evening') return '15:00–21:00';
    return 'Время смены не указано';
  }

  function shiftLabel(event, dateKey = localDateKey()){
    const labels = { full:'Целая смена', morning:'Утренняя смена', evening:'Вечерняя смена' };
    const kind = shiftKind(event);
    const range = shiftTimeRange(event,dateKey);
    if(kind) return `${labels[kind]} · ${range}`;
    return range;
  }

  function employeeRoleFromState(name){
    const rows = Array.isArray(global.state?.employees) ? global.state.employees : [];
    const target = String(name || '').trim().toLowerCase();
    const employee = rows.find(row => String(row?.name || '').trim().toLowerCase() === target);
    const role = String(employee?.role || '').trim().toLowerCase();
    if(role === 'barista' || role === 'бариста') return 'barista';
    if(role === 'waiter' || role === 'официант') return 'waiter';
    return '';
  }

  function shiftRole(event, name = shiftEmployeeName(event)){
    const description = `${event?.title || ''} ${event?.description || ''}`.toLowerCase();
    if(description.includes('официант')) return 'waiter';
    if(description.includes('бариста')) return 'barista';

    const byEmployee = employeeRoleFromState(name);
    if(byEmployee) return byEmployee;

    const departments = global.SovremennikScheduleDepartments;
    const department = typeof departments?.sourceDepartment === 'function'
      ? departments.sourceDepartment(event)
      : (() => {
          const explicit = String(event?.department || '').trim().toLowerCase();
          const source = String(event?.source || '').trim().toLowerCase();
          if(explicit === 'hall' || explicit === 'зал' || source.startsWith('hall:') || source.startsWith('зал:')) return 'hall';
          return 'bar';
        })();
    return department === 'hall' ? 'waiter' : 'barista';
  }

  function todayShiftRows(date = new Date()){
    const key = localDateKey(date);
    const seen = new Set();
    return scheduleRows()
      .filter(isShift)
      .filter(event => normalizeDateValue(event?.eventDate || event?.event_date || event?.date || '') === key)
      .map(event => {
        const name = shiftEmployeeName(event);
        return { event, name, role:shiftRole(event,name), shift:shiftLabel(event,key) };
      })
      .filter(item => {
        const marker = `${item.name.toLowerCase()}|${item.shift}`;
        if(seen.has(marker)) return false;
        seen.add(marker);
        return true;
      });
  }

  function renderRoster(rows = todayShiftRows()){
    if(global.state?.scheduleLoading && !rows.length){
      return '<div class="v3-empty-inline">Загружаю расписание смены…</div>';
    }
    if(!rows.length){
      return '<div class="v3-empty-inline"><strong>Смена на сегодня не указана</strong><span>Сотрудники появятся здесь после добавления смен в расписание.</span></div>';
    }
    return `<div class="v3-shift-list v3-shift-list--roles">${rows.map(item => {
      const meta = ROLE_META[item.role] || ROLE_META.barista;
      return `<div class="v3-shift-person v3-shift-person--role-${meta.className}">
        <span class="v3-role-badge v3-role-badge--${meta.className}" aria-label="Роль: ${escapeHtml(meta.label)}">${escapeHtml(meta.label)}</span>
        <span class="v3-shift-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.shift)}</small></span>
      </div>`;
    }).join('')}</div>`;
  }

  function signature(rows){
    return rows.map(item => `${item.name}|${item.role}|${item.shift}`).join('||')
      + `|loading:${Boolean(global.state?.scheduleLoading)}`;
  }

  function refreshRoster(){
    updateQueued = false;
    const root = global.document?.querySelector?.('#v3-shift-roster');
    if(!root) return;
    const rows = todayShiftRows();
    const nextSignature = signature(rows);
    if(root.dataset.shiftRolesSignature === nextSignature && root.querySelector('.v3-shift-list--roles, .v3-empty-inline')) return;
    root.dataset.shiftRolesSignature = nextSignature;
    root.innerHTML = renderRoster(rows);
  }

  function queueRefresh(){
    if(updateQueued) return;
    updateQueued = true;
    const schedule = global.requestAnimationFrame || (callback => global.setTimeout(callback,0));
    schedule(refreshRoster);
  }

  function install(){
    if(typeof global.renderApp === 'function'){
      const previousRenderApp = global.renderApp;
      global.renderApp = function(...args){
        const result = previousRenderApp.apply(this,args);
        queueRefresh();
        return result;
      };
      try { renderApp = global.renderApp; } catch(error) {}
    }
    if(global.MutationObserver && global.document?.body){
      observer = new global.MutationObserver(queueRefresh);
      observer.observe(global.document.body,{childList:true,subtree:true});
    }
    global.document?.addEventListener?.('visibilitychange',() => {
      if(global.document.visibilityState === 'visible') queueRefresh();
    });
    global.setInterval?.(queueRefresh,60000);
    queueRefresh();
    global.document?.documentElement?.setAttribute?.('data-home-shift-roles-version',VERSION);
  }

  global.SovremennikHomeShiftRoles = Object.freeze({
    VERSION,
    localDateKey,
    shiftEmployeeName,
    shiftKind,
    shiftTimeRange,
    shiftLabel,
    shiftRole,
    todayShiftRows,
    renderRoster,
    refreshRoster
  });

  install();
})(window);

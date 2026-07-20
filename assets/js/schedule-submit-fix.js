/* Современник schedule submit fix — preserve named morning/evening shifts while editing */
(function(global){
  'use strict';

  const VERSION = '2026-07-20-schedule-submit-fix-1';
  const originalAddEventListener = global.addEventListener;
  let installed = false;

  function currentProfile(){
    try { return typeof currentUser === 'function' ? currentUser() : null; }
    catch(error){ return null; }
  }
  function normalizeRoleValue(value){
    if(typeof normalizeRole === 'function') return normalizeRole(value);
    const role = String(value || '').trim().toLowerCase();
    return ({'администратор':'admin','руководитель':'manager','менеджер':'manager'})[role] || role;
  }
  function canManageSchedule(){
    return ['admin','manager'].includes(normalizeRoleValue(currentProfile()?.role));
  }
  function client(){
    const value = global.sovremennikSupabase;
    if(!value) throw new Error('Supabase временно недоступен.');
    return value;
  }
  function normalizeDateValue(value){
    const api = global.SovremennikScheduleManager;
    if(typeof api?.normalizeDateValue === 'function') return api.normalizeDateValue(value);
    return String(value || '').slice(0,10);
  }
  function isShift(event){
    return String(event?.type || event?.event_type || '').toLowerCase().includes('смен');
  }
  function allScheduleEvents(){
    return global.SovremennikScheduleDepartments?.allScheduleEvents?.() || [];
  }
  function findScheduleEvent(id){
    return allScheduleEvents().find(event => String(event?.id) === String(id)) || null;
  }
  function buildShiftDescription(startTime,endTime,note){
    const cleanNote = String(note || '').trim();
    if(!startTime && !endTime && /^(?:утренняя|вечерняя|целая)\s+смена(?:\s|·|$)/i.test(cleanNote)){
      return cleanNote;
    }
    let timeText = '';
    if(startTime && endTime) timeText = `${startTime}–${endTime}`;
    else if(startTime) timeText = `с ${startTime}`;
    else if(endTime) timeText = `до ${endTime}`;
    else timeText = 'Целая смена';
    return [timeText,cleanNote].filter(Boolean).join(' · ');
  }
  function sourceForRecord(existing,type){
    const source = String(existing?.source || '').trim().toLowerCase();
    if(source.startsWith('hall:')) return 'hall:manual';
    if(source.startsWith('bar:')) return 'bar:manual';
    if(existing && !isShift(existing)) return existing.source || 'manual';
    const department = global.SovremennikScheduleDepartments?.activeDepartment === 'hall' ? 'hall' : 'bar';
    return `${department}:manual`;
  }
  function syncResetForm(form){
    form.reset();
    form.elements.eventId.value = '';
    const today = global.SovremennikScheduleManager?.localDateKey?.(new Date())
      || new Date().toISOString().slice(0,10);
    form.elements.eventDate.value = today;
    form.elements.employeeName.value = currentProfile()?.name || '';
    const fields = form.querySelector('[data-schedule-shift-fields]');
    if(fields) fields.hidden = true;
    const label = form.querySelector('[data-schedule-title-label]');
    if(label) label.textContent = 'Название';
    const submit = form.querySelector('[data-schedule-submit]');
    if(submit) submit.textContent = 'Добавить';
    const cancel = form.querySelector('[data-schedule-cancel]');
    if(cancel) cancel.hidden = true;
    const summary = document.querySelector('[data-schedule-form-summary]');
    if(summary) summary.textContent = 'Добавить запись в расписание';
  }
  async function fixedScheduleSubmit(event){
    const form = event.target;
    if(!form?.matches?.('#schedule-event-form')) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if(!canManageSchedule()) return;

    const type = String(form.elements.type.value || 'Мероприятие').trim();
    const shift = type.toLowerCase().includes('смен');
    const rawTitle = String(form.elements.title.value || '').trim();
    const id = String(form.elements.eventId.value || '');
    const existing = findScheduleEvent(id);
    const record = {
      id,
      eventDate:normalizeDateValue(form.elements.eventDate.value),
      type,
      title:shift ? `Смена: ${rawTitle}` : rawTitle,
      description:shift
        ? buildShiftDescription(form.elements.startTime.value,form.elements.endTime.value,form.elements.description.value)
        : String(form.elements.description.value || '').trim()
    };
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
      source:sourceForRecord(existing,type)
    };
    try {
      let result;
      if(record.id){
        result = await client().from('schedule_events').update(row).eq('id',record.id).select('*').maybeSingle();
      } else {
        result = await client().from('schedule_events').insert({
          id:global.crypto?.randomUUID?.(),
          ...row,
          employee_name:profile.name || '',
          created_by:profile.id
        }).select('*').single();
      }
      if(result.error) throw result.error;
      if(record.id && !result.data) throw new Error('Запись не найдена или у вас нет доступа.');
      if(typeof global.loadScheduleEvents === 'function') await global.loadScheduleEvents();
      syncResetForm(form);
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

  global.addEventListener = function(type,listener,options){
    if(!installed && type === 'submit' && listener?.name === 'onWindowSubmit'){
      installed = true;
      originalAddEventListener.call(global,type,fixedScheduleSubmit,options);
      global.addEventListener = originalAddEventListener;
      document.documentElement.dataset.scheduleSubmitFixVersion = VERSION;
      return;
    }
    return originalAddEventListener.call(global,type,listener,options);
  };

  global.SovremennikScheduleSubmitFix = Object.freeze({
    VERSION,
    buildShiftDescription
  });
})(window);

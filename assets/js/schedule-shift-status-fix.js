/* Современник — schedule cleanup labels, normalized barista hours and live roster status. */
(function(global){
  'use strict';

  const VERSION='2026-07-24-schedule-shift-status-fix-1';
  let queued=false;

  function text(value){return String(value||'').trim();}
  function lower(value){return text(value).toLowerCase();}
  function localDateKey(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
  function eventDate(event){return text(event?.eventDate||event?.event_date||event?.date).slice(0,10);}
  function isShift(event){return lower(event?.type||event?.event_type).includes('смен')||/^смена(?:\s|:|—|-|$)/i.test(text(event?.title));}
  function isGeneralCleaning(event){
    const source=lower(`${event?.title||''} ${event?.description||''} ${event?.employeeName||''}`);
    return /(^|\s|[:—-])генка($|\s|[.,;:—-])/.test(source)||source.includes('генеральная уборка')||source.includes('ген. уборка');
  }
  function department(event){
    const api=global.SovremennikScheduleDepartments;
    if(typeof api?.sourceDepartment==='function') return api.sourceDepartment(event);
    const explicit=lower(event?.department); const source=lower(event?.source);
    return explicit==='hall'||explicit==='зал'||source.startsWith('hall:')||source.startsWith('зал:')?'hall':'bar';
  }
  function shiftKind(event){
    const api=global.SovremennikScheduleDepartments;
    if(typeof api?.shiftKind==='function') return api.shiftKind(event);
    const source=lower(`${event?.title||''} ${event?.description||''}`);
    if(source.includes('целая смена')) return 'full';
    if(source.includes('утренняя смена')) return 'morning';
    if(source.includes('вечерняя смена')) return 'evening';
    return '';
  }
  function shiftRange(event){
    const kind=shiftKind(event);
    const key=eventDate(event)||localDateKey();
    const match=key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const date=match?new Date(Number(match[1]),Number(match[2])-1,Number(match[3]),12):new Date();
    const weekend=[0,6].includes(date.getDay());
    if(kind==='full') return `${weekend?'08:00':'07:00'}–21:00`;
    if(kind==='morning') return `${weekend?'08:00':'07:00'}–15:00`;
    if(kind==='evening') return '15:00–21:00';
    const source=`${event?.title||''} ${event?.description||''}`;
    const range=source.match(/(\d{1,2})[.:](\d{2})\s*[—–-]\s*(\d{1,2})[.:](\d{2})/);
    return range?`${String(Number(range[1])).padStart(2,'0')}:${range[2]}–${String(Number(range[3])).padStart(2,'0')}:${range[4]}`:'';
  }
  function shiftLabel(event){
    const labels={full:'Целая смена',morning:'Утренняя смена',evening:'Вечерняя смена'};
    const kind=shiftKind(event); const range=shiftRange(event);
    return kind?`${labels[kind]} · ${range}`:range;
  }
  function allEvents(){
    const api=global.SovremennikScheduleDepartments;
    try{return typeof api?.allScheduleEvents==='function'?(api.allScheduleEvents()||[]):[];}catch(error){return [];}
  }
  function eventMap(){return new Map(allEvents().map(event=>[String(event?.id||''),event]));}

  function decorateSchedule(){
    const panel=document.querySelector('#top-schedule');
    if(!panel) return;
    const events=eventMap();
    panel.querySelectorAll('[data-schedule-event-id]').forEach(card=>{
      const event=events.get(String(card.dataset.scheduleEventId||''));
      if(!event) return;
      const strong=card.querySelector('strong');
      const spans=[...card.querySelectorAll('span:not(.schedule-senior-badge)')];
      if(isGeneralCleaning(event)){
        card.classList.add('schedule-event--general-cleaning','schedule-mobile-event--general-cleaning');
        if(strong) strong.textContent='Генеральная уборка';
        spans.forEach(span=>span.remove());
        if(!card.querySelector('.schedule-general-cleaning-note')) card.insertAdjacentHTML('beforeend','<span class="schedule-general-cleaning-note">Служебная отметка</span>');
        return;
      }
      if(isShift(event)&&department(event)==='bar'){
        const label=shiftLabel(event);
        if(!label) return;
        spans.forEach(span=>span.remove());
        card.insertAdjacentHTML('beforeend',`<span class="schedule-normalized-time">${label}</span>`);
      }
    });
  }

  function minutes(value){const match=text(value).match(/(\d{1,2}):(\d{2})/);return match?Number(match[1])*60+Number(match[2]):null;}
  function rosterStatus(rangeText,now=new Date()){
    const values=text(rangeText).match(/\d{1,2}:\d{2}/g)||[];
    if(values.length<2) return null;
    const start=minutes(values[0]); const end=minutes(values[1]); const current=now.getHours()*60+now.getMinutes();
    if(current<start) return {key:'upcoming',label:'Ещё не на смене'};
    if(current>=end) return {key:'finished',label:'Закончил смену'};
    return {key:'active',label:'Сейчас на смене'};
  }
  function decorateRoster(){
    document.querySelectorAll('#v3-shift-roster .v3-shift-person').forEach(row=>{
      const small=row.querySelector('.v3-shift-copy small');
      if(!small) return;
      const status=rosterStatus(small.textContent);
      let badge=row.querySelector('.v3-live-shift-status');
      if(!status){badge?.remove();return;}
      if(!badge){badge=document.createElement('span');row.appendChild(badge);}
      badge.className=`v3-live-shift-status v3-live-shift-status--${status.key}`;
      badge.textContent=status.label;
    });
  }
  function apply(){queued=false;decorateSchedule();decorateRoster();document.documentElement.dataset.scheduleShiftStatusFixVersion=VERSION;}
  function queue(){if(queued)return;queued=true;(global.requestAnimationFrame||global.setTimeout)(apply,0);}

  if(global.MutationObserver&&document.body)new MutationObserver(queue).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')queue();});
  global.setInterval?.(queue,60000);
  global.SovremennikScheduleShiftStatusFix=Object.freeze({VERSION,isGeneralCleaning,shiftRange,shiftLabel,rosterStatus,apply});
  queue();
})(window);

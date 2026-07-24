/* Современник — final home layout: work for today below welcome, no summary, handoff instead of roster for employees. */
(function(global){
  'use strict';

  const VERSION='2026-07-24-home-layout-v4-2';
  const core=global.SovremennikShiftHandoffCore;
  const WAITER_REFRESH_MS=60000;
  let queued=false;
  let observer=null;
  let waiterLoading=false;
  let waiterLoaded=false;
  let waiterError='';
  let waiterRow=null;
  let waiterGeneration=0;

  function escapeHtml(value){
    return String(value??'').replace(/[&<>"']/g,character=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[character]));
  }

  function currentProfile(){
    try{return typeof global.currentUser==='function'?global.currentUser():null;}
    catch(error){return null;}
  }

  function normalizeRole(value){
    if(typeof global.normalizeRole==='function') return global.normalizeRole(value);
    const role=String(value||'').trim().toLowerCase();
    return ({'администратор':'admin','руководитель':'manager','бариста':'barista','официант':'waiter'})[role]||role;
  }

  function displayRole(){
    const api=global.SovremennikRoleInterface;
    if(typeof api?.displayRole==='function') return api.displayRole();
    return normalizeRole(currentProfile()?.role);
  }

  function realRole(){return normalizeRole(currentProfile()?.role);}
  function isEmployeeRole(role=displayRole()){return role==='barista'||role==='waiter';}

  function client(){
    if(global.sovremennikSupabase) return global.sovremennikSupabase;
    try{return typeof supa!=='undefined'?supa:null;}catch(error){return null;}
  }

  function roleText(value){
    try{return typeof global.roleLabel==='function'?global.roleLabel(value):String(value||'');}
    catch(error){return String(value||'');}
  }

  function activeHandoff(rows){
    const now=Date.now();
    return (rows||[])
      .filter(row=>{
        const until=row.visible_until||row.visibleUntil;
        if(!until) return true;
        const timestamp=new Date(until).getTime();
        return Number.isNaN(timestamp)||timestamp>now;
      })
      .sort((left,right)=>new Date(right.created_at||right.createdAt||0)-new Date(left.created_at||left.createdAt||0))[0]||null;
  }

  function authorLabel(row){
    return [row?.created_by_name||'Сотрудник',row?.created_by_role?roleText(row.created_by_role):''].filter(Boolean).join(' · ');
  }

  function waiterAcknowledgement(row){
    const userId=String(currentProfile()?.id||'');
    return (row?.acknowledgements||[]).find(item=>String(item.employee_id||item.employeeId||'')===userId)||null;
  }

  function waiterSignature(){
    const acknowledgement=waiterAcknowledgement(waiterRow);
    const photos=(waiterRow?.photos||[]).map(photo=>photo.signedUrl||photo.storage_path||photo.id||'').join('|');
    return [
      waiterLoading?'loading':'ready',
      waiterLoaded?'loaded':'initial',
      waiterError,
      waiterRow?.id||'empty',
      waiterRow?.created_at||'',
      acknowledgement?.acknowledged_at||'',
      photos
    ].join('::');
  }

  function sectionMarkup(row){
    if(!core) return '';
    const sections=core.sectionRows(row);
    if(!sections.length&&String(row?.notes||'').trim().toLowerCase()==='замечаний нет'){
      return '<section class="shift-handoff-section shift-handoff-no-remarks"><h4>Статус</h4><p>Замечаний нет</p></section>';
    }
    return `<div class="shift-handoff-sections">${sections.map(section=>`<section class="shift-handoff-section"><h4>${escapeHtml(section.label)}</h4><ul>${section.items.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ul></section>`).join('')}</div>`;
  }

  function photoMarkup(row){
    const photos=Array.isArray(row?.photos)?row.photos:[];
    if(!photos.length) return '';
    return `<div class="shift-handoff-photos" aria-label="Фотографии к передаче смены">${photos.map((photo,index)=>photo.signedUrl?`<a href="${escapeHtml(photo.signedUrl)}" target="_blank" rel="noopener" class="shift-handoff-photo"><img src="${escapeHtml(photo.signedUrl)}" alt="Фото к передаче смены ${index+1}"></a>`:'').join('')}</div>`;
  }

  function waiterCardHtml(signature=waiterSignature()){
    if(waiterLoading&&!waiterLoaded){
      return `<section class="v3-dashboard-card shift-handoff-incoming shift-handoff-home-empty" data-waiter-shift-handoff data-waiter-signature="${escapeHtml(signature)}" data-version="${VERSION}"><div><p class="section-kicker">Передача смены</p><h2>Загружаю передачу…</h2></div></section>`;
    }
    if(!waiterRow){
      return `<section class="v3-dashboard-card shift-handoff-incoming shift-handoff-home-empty" data-waiter-shift-handoff data-waiter-signature="${escapeHtml(signature)}" data-version="${VERSION}"><div><p class="section-kicker">Передача смены</p><h2>Передача ещё не отправлена</h2><p class="description">Последняя передача появится здесь сразу после отправки предыдущей сменой.</p></div>${waiterError?`<p class="shift-handoff-error">${escapeHtml(waiterError)}</p>`:''}</section>`;
    }
    const own=String(waiterRow.created_by||waiterRow.createdBy||'')===String(currentProfile()?.id||'');
    const acknowledgement=waiterAcknowledgement(waiterRow);
    const badge=own?'Текущая передача смены':'От предыдущей смены';
    const control=own
      ? '<span class="shift-handoff-read-state">Отправлено</span>'
      : acknowledgement
        ? `<span class="shift-handoff-read-state">Принято · ${escapeHtml(core?.formatDateTime?.(acknowledgement.acknowledged_at)||'')}</span>`
        : `<button type="button" class="small-action" data-waiter-handoff-accept="${escapeHtml(waiterRow.id)}">Принято</button>`;
    const noRemarks=core?.sectionRows?.(waiterRow)?.length===0&&String(waiterRow.notes||'').trim().toLowerCase()==='замечаний нет';
    return `<section class="v3-dashboard-card shift-handoff-incoming" data-waiter-shift-handoff data-waiter-signature="${escapeHtml(signature)}" data-version="${VERSION}"><div class="shift-handoff-incoming-head"><div><span class="shift-handoff-badge">${escapeHtml(badge)}</span><h2>${escapeHtml(authorLabel(waiterRow))}</h2><p>${escapeHtml(core?.formatDateTime?.(waiterRow.created_at)||'')}</p></div>${control}</div>${sectionMarkup(waiterRow)}${waiterRow.notes&&!noRemarks?`<section class="shift-handoff-section shift-handoff-note"><h4>Дополнительно</h4><p>${escapeHtml(waiterRow.notes)}</p></section>`:''}${photoMarkup(waiterRow)}${waiterError?`<p class="shift-handoff-error">${escapeHtml(waiterError)}</p>`:''}</section>`;
  }

  async function signedUrl(storagePath){
    const supabase=client();
    if(!supabase||!storagePath) return '';
    const result=await supabase.storage.from('shift-handoff-photos').createSignedUrl(storagePath,3600);
    return result.error?'':(result.data?.signedUrl||'');
  }

  async function loadWaiterHandoff(force=false){
    if(realRole()!=='waiter'||waiterLoading) return;
    if(waiterLoaded&&!force) return;
    const supabase=client();
    if(!supabase){
      waiterError='Передача смены временно недоступна.';
      waiterLoaded=true;
      queueLayout();
      return;
    }
    waiterLoading=true;
    waiterError='';
    const generation=++waiterGeneration;
    queueLayout();
    try{
      const since=new Date(Date.now()-30*86400000).toISOString();
      const handoffs=await supabase.from('shift_handoffs').select('*').gte('created_at',since).order('created_at',{ascending:false}).limit(30);
      if(handoffs.error) throw handoffs.error;
      let row=activeHandoff(handoffs.data||[]);
      if(row){
        const [acks,photos]=await Promise.all([
          supabase.from('shift_handoff_acknowledgements').select('handoff_id,employee_id,employee_name,acknowledged_at').eq('handoff_id',row.id).order('acknowledged_at',{ascending:true}),
          supabase.from('shift_handoff_photos').select('id,handoff_id,storage_path,created_at').eq('handoff_id',row.id).order('created_at',{ascending:true})
        ]);
        if(acks.error) throw acks.error;
        if(photos.error) throw photos.error;
        const photosWithUrls=await Promise.all((photos.data||[]).map(async photo=>({...photo,signedUrl:await signedUrl(photo.storage_path)})));
        row=core?.fromDatabaseRow?core.fromDatabaseRow({...row,acknowledgements:acks.data||[],photos:photosWithUrls}):{...row,acknowledgements:acks.data||[],photos:photosWithUrls};
      }
      if(generation!==waiterGeneration) return;
      waiterRow=row;
      waiterLoaded=true;
    }catch(error){
      console.warn('Waiter shift handoff loading failed',error);
      if(generation!==waiterGeneration) return;
      waiterError='Передача смены временно недоступна.';
      waiterLoaded=true;
    }finally{
      if(generation===waiterGeneration){waiterLoading=false;queueLayout();}
    }
  }

  async function acknowledgeWaiterHandoff(id,button){
    const supabase=client();
    if(!supabase||!id||button?.disabled) return;
    button.disabled=true;
    button.textContent='Сохраняю…';
    try{
      const result=await supabase.rpc('acknowledge_shift_handoff',{p_handoff_id:id});
      if(result.error) throw result.error;
      await loadWaiterHandoff(true);
    }catch(error){
      console.error('Waiter handoff acknowledgement failed',error);
      button.disabled=false;
      button.textContent='Принято';
      global.alert?.('Не удалось сохранить подтверждение. Проверьте подключение и повторите попытку.');
    }
  }

  function ensureWaiterCard(home,grid){
    const shared=home.querySelector('[data-shift-handoff-incoming]');
    const own=home.querySelector('[data-waiter-shift-handoff]');
    if(shared){own?.remove();return shared;}
    if(realRole()!=='waiter'){own?.remove();return null;}
    const signature=waiterSignature();
    if(own?.dataset.waiterSignature===signature) return own;
    const wrapper=document.createElement('div');
    wrapper.innerHTML=waiterCardHtml(signature);
    const next=wrapper.firstElementChild;
    if(own) own.replaceWith(next);
    else grid.prepend(next);
    return next;
  }

  function applyLayout(){
    queued=false;
    const home=document.querySelector('#top-home');
    if(!home) return;
    home.querySelectorAll('.v3-summary-card').forEach(card=>card.remove());

    const welcome=home.querySelector('.v3-welcome-card');
    const todayWork=home.querySelector('[data-role-today-work]');
    if(welcome&&todayWork&&welcome.nextElementSibling!==todayWork){
      welcome.insertAdjacentElement('afterend',todayWork);
    }

    const grid=home.querySelector('.v3-home-grid');
    if(!grid) return;
    const role=displayRole();
    const sharedHandoff=home.querySelector('[data-shift-handoff-incoming]');

    if(isEmployeeRole(role)){
      grid.querySelector('.v3-shift-card')?.remove();
      const handoff=role==='waiter'?ensureWaiterCard(home,grid):sharedHandoff;
      if(handoff&&grid.firstElementChild!==handoff) grid.prepend(handoff);
      if(role==='waiter'&&realRole()==='waiter'&&!waiterLoaded&&!waiterLoading) void loadWaiterHandoff();
    }else{
      home.querySelector('[data-waiter-shift-handoff]')?.remove();
      if(sharedHandoff&&sharedHandoff.parentElement!==home){grid.insertAdjacentElement('afterend',sharedHandoff);}
      else if(sharedHandoff&&sharedHandoff.previousElementSibling!==grid){grid.insertAdjacentElement('afterend',sharedHandoff);}
    }

    document.documentElement.setAttribute('data-home-layout-v4-version',VERSION);
  }

  function queueLayout(){
    if(queued) return;
    queued=true;
    queueMicrotask(applyLayout);
  }

  function install(){
    const previousRenderApp=typeof global.renderApp==='function'?global.renderApp:null;
    if(previousRenderApp){
      global.renderApp=function(){const result=previousRenderApp.apply(this,arguments);queueLayout();return result;};
      try{renderApp=global.renderApp;}catch(error){}
    }
    const previousSetTop=typeof global.setTop==='function'?global.setTop:null;
    if(previousSetTop){
      global.setTop=function(){const result=previousSetTop.apply(this,arguments);queueLayout();return result;};
      try{setTop=global.setTop;}catch(error){}
    }
    if(global.MutationObserver&&document.body){
      observer=new MutationObserver(queueLayout);
      observer.observe(document.body,{childList:true,subtree:true});
    }
    document.addEventListener('click',event=>{
      const accept=event.target.closest('[data-waiter-handoff-accept]');
      if(!accept) return;
      event.preventDefault();
      void acknowledgeWaiterHandoff(accept.dataset.waiterHandoffAccept,accept);
    },true);
    global.addEventListener('online',()=>{if(realRole()==='waiter') void loadWaiterHandoff(true);});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&realRole()==='waiter') void loadWaiterHandoff(true);});
    global.setInterval?.(()=>{if(realRole()==='waiter'&&document.visibilityState==='visible') void loadWaiterHandoff(true);},WAITER_REFRESH_MS);
    queueLayout();
  }

  global.SovremennikHomeLayoutV4=Object.freeze({VERSION,applyLayout,refreshWaiterHandoff:()=>loadWaiterHandoff(true)});
  install();
})(window);

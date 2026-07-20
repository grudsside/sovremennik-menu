/* Centralized section maintenance controls for open testing. */
(function(){
  'use strict';

  const CONFIG = window.SOVREMENNIK_SUPABASE || {};
  const FUNCTION_URL = CONFIG.maintenanceFunctionUrl
    || (CONFIG.url ? `${CONFIG.url}/functions/v1/admin-maintenance` : '');
  const REFRESH_INTERVAL_MS = 30000;
  const PROTECTED_SECTIONS = new Set(['home', 'employees']);
  const SECTION_LABELS = {
    tasks: 'Мои задачи',
    method: 'Методичка',
    theory: 'Теория',
    checklists: 'Чек-листы',
    revisions: 'Ревизии',
    techcards: 'Тех. карты',
    schedule: 'Расписание',
    reportError: 'Сообщить об ошибке',
    control: 'Контроль'
  };

  let closedSections = new Set();
  let loaded = false;
  let loading = false;
  let lastLoadAt = 0;
  let renderWrapped = false;

  function isSignedIn(){
    try { return typeof isAuthenticated === 'function' && isAuthenticated(); }
    catch(error){ return false; }
  }

  function isCurrentAdmin(){
    try { return typeof isAdmin === 'function' && isAdmin(); }
    catch(error){ return false; }
  }

  function currentSection(){
    try { return String(state?.activeTop || 'home'); }
    catch(error){ return 'home'; }
  }

  function escapeHtml(value){
    if(typeof esc === 'function') return esc(value);
    return String(value ?? '').replace(/[&<>\"]/g, char => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'
    }[char]));
  }

  function sectionLabel(sectionId){
    return SECTION_LABELS[sectionId] || sectionId;
  }

  function maintenanceMarkup(sectionId){
    return `<section class="top-panel active maintenance-section-panel" id="top-${escapeHtml(sectionId)}" data-maintenance-panel="${escapeHtml(sectionId)}">
      <div class="maintenance-message-card" role="status" aria-live="polite">
        <span class="maintenance-message-icon" aria-hidden="true">⚙</span>
        <p class="section-kicker">Техническое обслуживание</p>
        <h2>${escapeHtml(sectionLabel(sectionId))} временно недоступен</h2>
        <p>В разделе ведутся технические работы. Данные сохранены, доступ вернётся после завершения обслуживания.</p>
        <button class="small-action secondary" type="button" data-maintenance-home>Перейти на главную</button>
      </div>
    </section>`;
  }

  function markNavigation(){
    document.querySelectorAll('[data-top-target]').forEach(button => {
      const sectionId = String(button.dataset.topTarget || '');
      const closed = closedSections.has(sectionId);
      button.classList.toggle('maintenance-nav-item', closed);
      button.setAttribute('data-maintenance-closed', closed ? 'true' : 'false');
      let badge = button.querySelector('.maintenance-nav-badge');
      if(closed && !badge){
        badge = document.createElement('span');
        badge.className = 'maintenance-nav-badge';
        badge.textContent = 'Работы';
        button.appendChild(badge);
      }
      if(!closed && badge) badge.remove();
    });
  }

  function enforceActiveSection(){
    if(!isSignedIn()) return;
    const sectionId = currentSection();
    markNavigation();
    if(PROTECTED_SECTIONS.has(sectionId) || !closedSections.has(sectionId)) return;

    const panels = document.querySelector('#panels');
    if(!panels) return;
    const currentPanel = document.getElementById(`top-${sectionId}`);
    const markup = maintenanceMarkup(sectionId);
    if(currentPanel){
      if(!currentPanel.hasAttribute('data-maintenance-panel')) currentPanel.outerHTML = markup;
    }else{
      panels.insertAdjacentHTML('beforeend', markup);
    }
  }

  function rowsMarkup(){
    return Object.entries(SECTION_LABELS).map(([sectionId, label]) => {
      const closed = closedSections.has(sectionId);
      return `<div class="maintenance-admin-row">
        <div>
          <strong>${escapeHtml(label)}</strong>
          <span>${closed ? 'Закрыт для всех пользователей' : 'Доступен пользователям'}</span>
        </div>
        <button class="small-action ${closed ? 'secondary' : 'danger'}" type="button"
          data-maintenance-section="${escapeHtml(sectionId)}"
          data-next-closed="${closed ? 'false' : 'true'}">
          ${closed ? 'Открыть раздел' : 'Закрыть раздел'}
        </button>
      </div>`;
    }).join('');
  }

  function adminPanelMarkup(){
    return `<div class="role-permissions-card maintenance-admin-card" data-maintenance-admin-card>
      <div class="card-head">
        <div><h3>Техническое обслуживание</h3><p class="description">Закройте нестабильный раздел для всех пользователей на время исправления. Главная и раздел «Сотрудники» всегда остаются доступными.</p></div>
        <span class="source-badge">admin</span>
      </div>
      <div class="maintenance-admin-list">${rowsMarkup()}</div>
      <p class="submit-status maintenance-admin-status" aria-live="polite"></p>
    </div>`;
  }

  function injectAdminPanel(){
    if(!isCurrentAdmin()) return;
    const panel = document.querySelector('#top-employees');
    if(!panel) return;
    const existing = panel.querySelector('[data-maintenance-admin-card]');
    if(existing) return;
    panel.insertAdjacentHTML('beforeend', adminPanelMarkup());
  }

  function afterRender(){
    injectAdminPanel();
    enforceActiveSection();
  }

  function wrapRender(){
    if(renderWrapped || typeof renderApp !== 'function') return;
    const baseRender = renderApp;
    renderApp = function(){
      const result = baseRender.apply(this, arguments);
      queueMicrotask(afterRender);
      return result;
    };
    renderWrapped = true;
  }

  function setsEqual(left, right){
    if(left.size !== right.size) return false;
    for(const value of left){ if(!right.has(value)) return false; }
    return true;
  }

  async function getSession(){
    if(typeof supa === 'undefined') return null;
    const result = await supa.auth.getSession();
    return result.data?.session || null;
  }

  async function loadMaintenance(force = false){
    if(!isSignedIn() || typeof supa === 'undefined') return;
    const now = Date.now();
    if(loading || (!force && loaded && now - lastLoadAt < REFRESH_INTERVAL_MS)) return;
    loading = true;
    try {
      const response = await supa
        .from('section_maintenance')
        .select('section_id,is_closed,updated_at')
        .eq('is_closed', true);
      if(response.error) throw response.error;
      const next = new Set((response.data || [])
        .map(row => String(row.section_id || ''))
        .filter(sectionId => SECTION_LABELS[sectionId] && !PROTECTED_SECTIONS.has(sectionId)));
      const changed = !setsEqual(next, closedSections);
      closedSections = next;
      loaded = true;
      lastLoadAt = now;
      if(changed && typeof renderApp === 'function') renderApp();
      else afterRender();
    } catch(error){
      console.warn('Section maintenance state could not be loaded', error);
      afterRender();
    } finally {
      loading = false;
    }
  }

  async function setMaintenance(sectionId, isClosed){
    if(!isCurrentAdmin()) throw new Error('Закрывать разделы может только администратор.');
    if(!SECTION_LABELS[sectionId] || PROTECTED_SECTIONS.has(sectionId)) {
      throw new Error('Этот раздел нельзя перевести в технический режим.');
    }
    if(!FUNCTION_URL) throw new Error('Не настроена функция технического обслуживания.');
    const session = await getSession();
    if(!session?.access_token) throw new Error('Сессия администратора недоступна. Войдите заново.');

    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ action:'set', sectionId, isClosed })
    });
    const payload = await response.json().catch(() => ({}));
    if(!response.ok || payload.error) throw new Error(payload.error || 'Не удалось изменить доступность раздела.');

    if(isClosed) closedSections.add(sectionId);
    else closedSections.delete(sectionId);
    loaded = true;
    lastLoadAt = Date.now();
    if(typeof renderApp === 'function') renderApp();
    else afterRender();
  }

  document.addEventListener('click', event => {
    const homeButton = event.target.closest('[data-maintenance-home]');
    if(homeButton){
      event.preventDefault();
      if(typeof setTop === 'function') setTop('home');
      return;
    }

    const button = event.target.closest('[data-maintenance-section]');
    if(!button) return;
    event.preventDefault();
    const sectionId = String(button.dataset.maintenanceSection || '');
    const isClosed = button.dataset.nextClosed === 'true';
    const label = sectionLabel(sectionId);
    const confirmed = confirm(`${isClosed ? 'Закрыть' : 'Открыть'} раздел «${label}»${isClosed ? ' для всех пользователей' : ''}?`);
    if(!confirmed) return;

    const status = document.querySelector('.maintenance-admin-status');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = isClosed ? 'Закрываю…' : 'Открываю…';
    if(status){ status.textContent = 'Сохраняю изменение…'; status.className = 'submit-status maintenance-admin-status'; }
    setMaintenance(sectionId, isClosed)
      .then(() => alert(`Раздел «${label}» ${isClosed ? 'закрыт на техническое обслуживание' : 'снова открыт'}.`))
      .catch(error => {
        console.error(error);
        if(status){ status.textContent = error.message || 'Не удалось сохранить изменение.'; status.className = 'submit-status maintenance-admin-status error'; }
        button.disabled = false;
        button.textContent = originalText;
      });
  });

  document.addEventListener('click', event => {
    const target = event.target.closest('[data-top-target],[data-top-jump]');
    if(!target) return;
    const sectionId = String(target.dataset.topTarget || target.dataset.topJump || '');
    if(closedSections.has(sectionId)) queueMicrotask(enforceActiveSection);
    loadMaintenance().catch(console.warn);
  }, true);

  document.addEventListener('visibilitychange', () => {
    if(!document.hidden) loadMaintenance(true).catch(console.warn);
  });

  window.addEventListener('load', () => {
    wrapRender();
    afterRender();
    loadMaintenance(true).catch(console.warn);
    window.setInterval(() => loadMaintenance(true).catch(console.warn), REFRESH_INTERVAL_MS);
  }, { once:true });

  const observer = new MutationObserver(() => {
    wrapRender();
    afterRender();
    if(isSignedIn() && !loaded) loadMaintenance(true).catch(console.warn);
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });

  window.SovremennikMaintenance = {
    isClosed: sectionId => closedSections.has(String(sectionId || '')),
    refresh: () => loadMaintenance(true),
    getClosedSections: () => Array.from(closedSections)
  };
})();

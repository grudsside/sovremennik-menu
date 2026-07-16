/* Employee notification history backed by Supabase notification_events. */
(function(){
  'use strict';

  const PAGE_SIZE = 20;
  const TABLE = 'notification_events';
  const SELECT_COLUMNS = 'id,title,body,event_type,url,status,sent_at,created_at,read_at';
  const LOAD_ERROR = 'Не удалось загрузить уведомления. Попробуйте ещё раз';
  const state = {
    userId: '',
    rows: [],
    total: 0,
    unreadCount: 0,
    loading: false,
    loadingMore: false,
    actionLoading: false,
    error: '',
    open: false,
    channel: null,
    previousFocus: null
  };

  function client(){ return window.sovremennikSupabase || null; }
  function currentEmployee(){
    try { return typeof window.currentUser === 'function' ? window.currentUser() : null; }
    catch(error) { return null; }
  }
  function esc(value){
    return String(value ?? '').replace(/[&<>\"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;'
    }[char]));
  }
  function eventTypeLabel(type){
    const labels = {
      task_assigned: 'Задача',
      task_completed: 'Задача',
      task_deadline_24h: 'Дедлайн',
      task_deadline_1h: 'Дедлайн',
      task_overdue: 'Просрочка',
      checklist_submitted: 'Чек-лист',
      revision_submitted: 'Ревизия',
      error_report_submitted: 'Ошибка',
      schedule_event_added: 'Расписание',
      manual: 'Уведомление'
    };
    return labels[String(type || '')] || 'Уведомление';
  }
  function dateTimeParts(value){
    const date = new Date(value || '');
    if(Number.isNaN(date.getTime())) return { date: '—', time: '—' };
    return {
      date: date.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' }),
      time: date.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' })
    };
  }
  function bellIcon(){
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>`;
  }

  function ensurePanel(){
    if(document.querySelector('#notification-overlay')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="notification-overlay" id="notification-overlay" aria-hidden="true" hidden>
        <aside class="notification-panel" role="dialog" aria-modal="true" aria-labelledby="notification-panel-title" tabindex="-1">
          <header class="notification-panel-head">
            <div>
              <p class="section-kicker">Личный раздел</p>
              <h2 id="notification-panel-title">Уведомления</h2>
            </div>
            <button class="notification-close" type="button" data-notification-close aria-label="Закрыть уведомления">×</button>
          </header>
          <div class="notification-panel-actions">
            <span class="notification-unread-summary" data-notification-unread-summary></span>
            <button class="notification-mark-all" type="button" data-notification-mark-all>Отметить все как прочитанные</button>
          </div>
          <div class="notification-panel-content" data-notification-content aria-live="polite"></div>
        </aside>
      </div>`);
  }

  function ensureBell(userPanel){
    if(userPanel.querySelector('[data-notification-bell]')) return;
    const center = document.createElement('div');
    center.className = 'notification-center';
    center.innerHTML = `
      <button class="notification-bell" type="button" data-notification-bell aria-label="Открыть уведомления" aria-haspopup="dialog" aria-expanded="${state.open ? 'true' : 'false'}">
        ${bellIcon()}
        <span class="notification-badge" data-notification-badge aria-label="Непрочитанные уведомления" hidden></span>
      </button>`;
    const logout = userPanel.querySelector('.logout-btn');
    userPanel.insertBefore(center, logout || null);
  }

  function updateBadge(){
    const count = Math.max(0, Number(state.unreadCount) || 0);
    document.querySelectorAll('[data-notification-badge]').forEach(badge => {
      badge.hidden = count === 0;
      badge.textContent = count > 99 ? '99+' : String(count);
    });
    document.querySelectorAll('[data-notification-bell]').forEach(button => {
      button.classList.toggle('has-unread', count > 0);
      button.setAttribute('aria-label', count > 0
        ? `Открыть уведомления: непрочитанных ${count}`
        : 'Открыть уведомления');
    });
  }

  function notificationItem(row){
    const unread = !row.read_at;
    const parts = dateTimeParts(row.created_at);
    const title = row.title || 'Современник';
    return `<button class="notification-item ${unread ? 'unread' : 'read'}" type="button" data-notification-id="${esc(row.id)}" aria-label="${unread ? 'Непрочитанное' : 'Прочитанное'} уведомление: ${esc(title)}">
      <span class="notification-item-top">
        <span class="notification-type">${esc(eventTypeLabel(row.event_type))}</span>
        <span class="notification-read-status ${unread ? 'unread' : ''}">${unread ? 'Не прочитано' : 'Прочитано'}</span>
      </span>
      <strong class="notification-title">${esc(title)}</strong>
      <span class="notification-body">${esc(row.body || '')}</span>
      <span class="notification-date-time"><span>${esc(parts.date)}</span><span>${esc(parts.time)}</span></span>
    </button>`;
  }

  function renderPanel(){
    const content = document.querySelector('[data-notification-content]');
    const summary = document.querySelector('[data-notification-unread-summary]');
    const markAll = document.querySelector('[data-notification-mark-all]');
    if(!content || !summary || !markAll) return;

    summary.textContent = state.unreadCount > 0
      ? `Непрочитанных: ${state.unreadCount}`
      : 'Непрочитанных нет';
    markAll.disabled = state.unreadCount === 0 || state.actionLoading;

    if(state.loading && !state.rows.length){
      content.innerHTML = '<div class="notification-state">Загружаю уведомления…</div>';
      return;
    }
    if(state.error){
      content.innerHTML = `<div class="notification-state notification-error" role="alert"><p>${LOAD_ERROR}</p><button type="button" data-notification-retry>Повторить</button></div>`;
      return;
    }
    if(!state.rows.length){
      content.innerHTML = '<div class="notification-state"><p>У вас пока нет уведомлений</p></div>';
      return;
    }

    const hasMore = state.rows.length < state.total;
    content.innerHTML = `<div class="notification-list">${state.rows.map(notificationItem).join('')}</div>
      ${hasMore ? `<button class="notification-load-more" type="button" data-notification-load-more ${state.loadingMore ? 'disabled' : ''}>${state.loadingMore ? 'Загружаю…' : 'Показать ещё'}</button>` : ''}`;
  }

  async function loadUnreadCount(){
    const supabase = client();
    const requestUserId = state.userId;
    if(!supabase || !requestUserId) return;
    const { count, error } = await supabase
      .from(TABLE)
      .select('id', { count:'exact', head:true })
      .eq('user_id', requestUserId)
      .is('read_at', null);
    if(error) throw error;
    if(state.userId !== requestUserId) return;
    state.unreadCount = Number(count || 0);
    updateBadge();
    if(state.open) renderPanel();
  }

  async function loadFirstPage(){
    const supabase = client();
    const requestUserId = state.userId;
    if(!supabase || !requestUserId) return;
    state.loading = true;
    state.error = '';
    state.rows = [];
    state.total = 0;
    renderPanel();
    try {
      const { data, count, error } = await supabase
        .from(TABLE)
        .select(SELECT_COLUMNS, { count:'exact' })
        .eq('user_id', requestUserId)
        .order('created_at', { ascending:false })
        .range(0, PAGE_SIZE - 1);
      if(error) throw error;
      if(state.userId !== requestUserId) return;
      state.rows = data || [];
      state.total = Number(count ?? state.rows.length);
      await loadUnreadCount();
    } catch(error) {
      if(state.userId === requestUserId){
        state.error = LOAD_ERROR;
        console.warn('Notification history load failed', error);
      }
    } finally {
      if(state.userId === requestUserId){
        state.loading = false;
        renderPanel();
      }
    }
  }

  async function loadMore(){
    const supabase = client();
    const requestUserId = state.userId;
    if(!supabase || !requestUserId || state.loadingMore || state.rows.length >= state.total) return;
    const from = state.rows.length;
    state.loadingMore = true;
    renderPanel();
    try {
      const { data, count, error } = await supabase
        .from(TABLE)
        .select(SELECT_COLUMNS, { count:'exact' })
        .eq('user_id', requestUserId)
        .order('created_at', { ascending:false })
        .range(from, from + PAGE_SIZE - 1);
      if(error) throw error;
      if(state.userId !== requestUserId) return;
      const known = new Set(state.rows.map(row => row.id));
      state.rows = [...state.rows, ...(data || []).filter(row => !known.has(row.id))];
      state.total = Number(count ?? state.rows.length);
    } catch(error) {
      if(state.userId === requestUserId){
        state.error = LOAD_ERROR;
        console.warn('Notification history page load failed', error);
      }
    } finally {
      if(state.userId === requestUserId){
        state.loadingMore = false;
        renderPanel();
      }
    }
  }

  function openPanel(){
    if(!state.userId) return;
    ensurePanel();
    const overlay = document.querySelector('#notification-overlay');
    if(!overlay) return;
    state.open = true;
    state.previousFocus = document.activeElement;
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('notification-panel-open');
    document.querySelectorAll('[data-notification-bell]').forEach(button => button.setAttribute('aria-expanded', 'true'));
    overlay.querySelector('.notification-panel')?.focus();
    loadFirstPage().catch(error => console.warn('Notification history open failed', error));
  }

  function closePanel(){
    const overlay = document.querySelector('#notification-overlay');
    state.open = false;
    if(overlay){
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('notification-panel-open');
    document.querySelectorAll('[data-notification-bell]').forEach(button => button.setAttribute('aria-expanded', 'false'));
    const focusTarget = document.querySelector('[data-notification-bell]') || state.previousFocus;
    if(focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
  }

  function openRelatedSection(row){
    const rawUrl = String(row?.url || '').trim();
    if(!rawUrl) return;
    let target;
    try { target = new URL(rawUrl, location.origin); }
    catch(error) { return; }
    if(target.origin !== location.origin) return;

    const hash = target.hash.replace(/^#/, '');
    if(hash){
      const top = hash.split('/')[0];
      if(typeof window.setTop === 'function') window.setTop(top);
      else location.hash = target.hash;
      return;
    }
    if(target.pathname !== location.pathname || target.search !== location.search){
      location.assign(target.href);
    }
  }

  async function markNotificationRead(id, button){
    const supabase = client();
    const row = state.rows.find(item => String(item.id) === String(id));
    if(!supabase || !row || state.actionLoading) return;
    state.actionLoading = true;
    if(button) button.disabled = true;
    try {
      if(!row.read_at){
        const readAt = new Date().toISOString();
        const { error } = await supabase
          .from(TABLE)
          .update({ read_at: readAt })
          .eq('id', row.id)
          .eq('user_id', state.userId)
          .is('read_at', null);
        if(error) throw error;
        row.read_at = readAt;
        state.unreadCount = Math.max(0, state.unreadCount - 1);
        updateBadge();
      }
      closePanel();
      openRelatedSection(row);
      loadUnreadCount().catch(error => console.warn('Unread count refresh failed', error));
    } catch(error) {
      console.warn('Notification read update failed', error);
      alert('Не удалось отметить уведомление как прочитанное. Попробуйте ещё раз.');
      if(button) button.disabled = false;
    } finally {
      state.actionLoading = false;
      if(state.open) renderPanel();
    }
  }

  async function markAllRead(){
    const supabase = client();
    if(!supabase || !state.userId || state.actionLoading || state.unreadCount === 0) return;
    state.actionLoading = true;
    renderPanel();
    try {
      const readAt = new Date().toISOString();
      const { error } = await supabase
        .from(TABLE)
        .update({ read_at: readAt })
        .eq('user_id', state.userId)
        .is('read_at', null);
      if(error) throw error;
      state.rows = state.rows.map(row => row.read_at ? row : { ...row, read_at: readAt });
      state.unreadCount = 0;
      updateBadge();
    } catch(error) {
      console.warn('Mark all notifications failed', error);
      alert('Не удалось отметить уведомления как прочитанные. Попробуйте ещё раз.');
    } finally {
      state.actionLoading = false;
      renderPanel();
    }
  }

  function unsubscribe(){
    const supabase = client();
    if(state.channel && supabase){
      supabase.removeChannel(state.channel).catch(() => {});
    }
    state.channel = null;
  }

  function subscribe(userId){
    const supabase = client();
    if(!supabase || !userId) return;
    state.channel = supabase
      .channel(`employee-notifications:${userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: TABLE,
        filter: `user_id=eq.${userId}`
      }, () => {
        loadUnreadCount().catch(error => console.warn('Realtime unread refresh failed', error));
        if(state.open) loadFirstPage().catch(error => console.warn('Realtime notification refresh failed', error));
      })
      .subscribe();
  }

  function activate(userId){
    unsubscribe();
    state.userId = userId;
    state.rows = [];
    state.total = 0;
    state.unreadCount = 0;
    state.error = '';
    updateBadge();
    subscribe(userId);
    loadUnreadCount().catch(error => console.warn('Initial unread count failed', error));
  }

  function deactivate(){
    if(state.open) closePanel();
    unsubscribe();
    state.userId = '';
    state.rows = [];
    state.total = 0;
    state.unreadCount = 0;
    state.error = '';
    document.querySelectorAll('.notification-center').forEach(node => node.remove());
    updateBadge();
  }

  function syncAuthenticatedUi(){
    const userPanel = document.querySelector('#user-panel');
    const employee = currentEmployee();
    const active = Boolean(
      userPanel
      && client()
      && employee?.id
      && !document.body.classList.contains('login-mode')
      && userPanel.querySelector('.user-chip')
    );
    if(!active){
      if(state.userId) deactivate();
      return;
    }
    ensurePanel();
    ensureBell(userPanel);
    if(state.userId !== employee.id) activate(employee.id);
    else updateBadge();
  }

  document.addEventListener('click', event => {
    const bell = event.target.closest('[data-notification-bell]');
    if(bell){ event.preventDefault(); openPanel(); return; }
    if(event.target.closest('[data-notification-close]')){ event.preventDefault(); closePanel(); return; }
    if(event.target.id === 'notification-overlay'){ closePanel(); return; }
    if(event.target.closest('[data-notification-retry]')){ loadFirstPage(); return; }
    if(event.target.closest('[data-notification-load-more]')){ loadMore(); return; }
    if(event.target.closest('[data-notification-mark-all]')){ markAllRead(); return; }
    const item = event.target.closest('[data-notification-id]');
    if(item) markNotificationRead(item.dataset.notificationId, item);
  });

  document.addEventListener('keydown', event => {
    if(event.key === 'Escape' && state.open) closePanel();
  });

  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState !== 'visible' || !state.userId) return;
    loadUnreadCount().catch(error => console.warn('Visible unread refresh failed', error));
    if(state.open) loadFirstPage().catch(error => console.warn('Visible notification refresh failed', error));
  });

  window.addEventListener('focus', () => {
    if(!state.userId) return;
    loadUnreadCount().catch(error => console.warn('Focus unread refresh failed', error));
  });

  const userPanel = document.querySelector('#user-panel');
  if(userPanel){
    const observer = new MutationObserver(() => queueMicrotask(syncAuthenticatedUi));
    observer.observe(userPanel, { childList:true });
  }
  window.setInterval(() => {
    if(!state.userId || document.visibilityState !== 'visible') return;
    loadUnreadCount().catch(error => console.warn('Periodic unread refresh failed', error));
  }, 60000);
  syncAuthenticatedUi();
})();

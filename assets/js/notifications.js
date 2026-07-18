/* Employee notification history backed by Supabase notification_events. */
(function(){
  'use strict';

  const PAGE_SIZE = 20;
  const TABLE = 'notification_events';
  const SELECT_COLUMNS = 'id,title,body,event_type,url,status,sent_at,created_at,read_at';
  const LOAD_ERROR = 'Не удалось загрузить уведомления. Попробуйте ещё раз';
  const core = window.SovremennikNotificationHistory;
  if(!core?.createNotificationHistoryController){
    console.error('Notification history controller is unavailable.');
    return;
  }

  const ui = {
    open:false,
    channel:null,
    pollTimer:null,
    previousFocus:null
  };
  let historyState = null;

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
    if(Number.isNaN(date.getTime())) return { date:'—', time:'—' };
    return {
      date:date.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' }),
      time:date.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' })
    };
  }
  function bellIcon(){
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>`;
  }

  async function fetchPage({ userId, cursor, limit }){
    const supabase = client();
    if(!supabase || !userId) throw new Error('Notification client is unavailable.');
    let query = supabase
      .from(TABLE)
      .select(SELECT_COLUMNS)
      .eq('user_id', userId)
      .order('created_at', { ascending:false })
      .order('id', { ascending:false })
      .limit(limit + 1);
    if(cursor){
      query = query.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
      );
    }
    const { data, error } = await query;
    if(error) throw error;
    const allRows = data || [];
    return {
      rows:allRows.slice(0, limit),
      hasMore:allRows.length > limit
    };
  }

  async function fetchUnreadCount({ userId }){
    const supabase = client();
    if(!supabase || !userId) throw new Error('Notification client is unavailable.');
    const { count, error } = await supabase
      .from(TABLE)
      .select('id', { count:'exact', head:true })
      .eq('user_id', userId)
      .is('read_at', null);
    if(error) throw error;
    return Number(count || 0);
  }

  async function markRead({ userId, row }){
    const supabase = client();
    if(!supabase || !userId || !row?.id) throw new Error('Notification is unavailable.');
    const readAt = new Date().toISOString();
    const updated = await supabase
      .from(TABLE)
      .update({ read_at:readAt })
      .eq('id', row.id)
      .eq('user_id', userId)
      .is('read_at', null)
      .select('id,read_at')
      .maybeSingle();
    if(updated.error) throw updated.error;
    if(updated.data?.read_at) return updated.data;

    // Another device may have read the same row first. Confirm the persisted
    // status before reflecting it locally or following the notification URL.
    const verified = await supabase
      .from(TABLE)
      .select('id,read_at')
      .eq('id', row.id)
      .eq('user_id', userId)
      .maybeSingle();
    if(verified.error) throw verified.error;
    if(!verified.data?.read_at) throw new Error('Notification read status was not confirmed.');
    return verified.data;
  }

  async function markAllRead({ userId }){
    const supabase = client();
    if(!supabase || !userId) throw new Error('Notification client is unavailable.');
    const readAt = new Date().toISOString();
    const { data, error } = await supabase
      .from(TABLE)
      .update({ read_at:readAt })
      .eq('user_id', userId)
      .is('read_at', null)
      .select('id,read_at');
    if(error) throw error;
    return { rows:data || [], readAt };
  }

  const controller = core.createNotificationHistoryController({
    pageSize:PAGE_SIZE,
    loadError:LOAD_ERROR,
    fetchPage,
    fetchUnreadCount,
    markRead,
    markAllRead,
    onChange(nextState){
      historyState = nextState;
      updateBadge();
      if(ui.open) renderPanel();
    },
    onBackgroundError(error){
      console.warn('Notification background refresh failed', error);
    }
  });
  historyState = controller.getState();

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
      <button class="notification-bell" type="button" data-notification-bell aria-label="Открыть уведомления" aria-haspopup="dialog" aria-expanded="${ui.open ? 'true' : 'false'}">
        ${bellIcon()}
        <span class="notification-badge" data-notification-badge aria-label="Непрочитанные уведомления" hidden></span>
      </button>`;
    const logout = userPanel.querySelector('.logout-btn');
    userPanel.insertBefore(center, logout || null);
  }

  function updateBadge(){
    const count = Math.max(0, Number(historyState?.unreadCount) || 0);
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

  function notificationItem(row, disabled){
    const unread = !row.read_at;
    const parts = dateTimeParts(row.created_at);
    const title = row.title || 'Современник';
    return `<button class="notification-item ${unread ? 'unread' : 'read'}" type="button" data-notification-id="${esc(row.id)}" aria-label="${unread ? 'Непрочитанное' : 'Прочитанное'} уведомление: ${esc(title)}" ${disabled ? 'disabled' : ''}>
      <span class="notification-item-top">
        <span class="notification-type">${esc(eventTypeLabel(row.event_type))}</span>
        <span class="notification-read-status ${unread ? 'unread' : ''}">${unread ? 'Не прочитано' : 'Прочитано'}</span>
      </span>
      <strong class="notification-title">${esc(title)}</strong>
      <span class="notification-body">${esc(row.body || '')}</span>
      <span class="notification-date-time"><span>${esc(parts.date)}</span><span>${esc(parts.time)}</span></span>
    </button>`;
  }

  function errorMarkup(compact = false){
    return `<div class="notification-state notification-error ${compact ? 'compact' : ''}" role="alert"><p>${LOAD_ERROR}</p><button type="button" data-notification-retry>Повторить</button></div>`;
  }

  function renderPanel(){
    const state = historyState || controller.getState();
    const content = document.querySelector('[data-notification-content]');
    const summary = document.querySelector('[data-notification-unread-summary]');
    const markAll = document.querySelector('[data-notification-mark-all]');
    if(!content || !summary || !markAll) return;

    summary.textContent = state.unreadCount > 0
      ? `Непрочитанных: ${state.unreadCount}`
      : 'Непрочитанных нет';
    markAll.disabled = state.unreadCount === 0 || state.actionLoading || state.listBusy;

    if(state.initialLoading && !state.rows.length){
      content.innerHTML = '<div class="notification-state">Загружаю уведомления…</div>';
      return;
    }
    if(state.error && !state.rows.length){
      content.innerHTML = errorMarkup();
      return;
    }
    if(!state.rows.length){
      content.innerHTML = '<div class="notification-state"><p>У вас пока нет уведомлений</p></div>';
      return;
    }

    content.innerHTML = `${state.error ? errorMarkup(true) : ''}
      <div class="notification-list">${state.rows.map(row => notificationItem(row, state.actionLoading || state.listBusy)).join('')}</div>
      ${state.hasMore ? `<button class="notification-load-more" type="button" data-notification-load-more ${state.loadingMore || state.listBusy ? 'disabled' : ''}>${state.loadingMore ? 'Загружаю…' : 'Показать ещё'}</button>` : ''}`;
  }

  function refreshUnread(reason){
    controller.refreshUnread().catch(error => console.warn(`${reason} unread refresh failed`, error));
  }

  function loadInitial(reason){
    controller.loadInitial({ reset:true })
      .then(() => controller.refreshUnread())
      .catch(error => console.warn(`${reason} notification load failed`, error));
  }

  function refreshVisibleHistory(reason){
    const state = controller.getState();
    if(!ui.open) return;
    if(!state.loaded && !state.listBusy) loadInitial(reason);
    else controller.requestTopRefresh();
  }

  function openPanel(){
    const state = controller.getState();
    if(!state.active || !state.userId) return;
    ensurePanel();
    const overlay = document.querySelector('#notification-overlay');
    if(!overlay) return;
    ui.open = true;
    ui.previousFocus = document.activeElement;
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('notification-panel-open');
    document.querySelectorAll('[data-notification-bell]').forEach(button => button.setAttribute('aria-expanded', 'true'));
    overlay.querySelector('.notification-panel')?.focus();
    if(state.loaded) controller.requestTopRefresh();
    else loadInitial('Open');
    refreshUnread('Open');
  }

  function closePanel(){
    const overlay = document.querySelector('#notification-overlay');
    ui.open = false;
    if(overlay){
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('notification-panel-open');
    document.querySelectorAll('[data-notification-bell]').forEach(button => button.setAttribute('aria-expanded', 'false'));
    const focusTarget = document.querySelector('[data-notification-bell]') || ui.previousFocus;
    ui.previousFocus = null;
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

  async function markNotificationRead(id){
    try {
      const row = await controller.markOne(id);
      if(!row) return;
      closePanel();
      openRelatedSection(row);
    } catch(error) {
      console.warn('Notification read update failed', error);
      alert('Не удалось отметить уведомление как прочитанное. Попробуйте ещё раз.');
    }
  }

  async function markAllNotificationsRead(){
    try {
      await controller.markAll();
    } catch(error) {
      console.warn('Mark all notifications failed', error);
      alert('Не удалось отметить уведомления как прочитанные. Попробуйте ещё раз.');
    }
  }

  function unsubscribe(){
    const supabase = client();
    const channel = ui.channel;
    ui.channel = null;
    if(channel && supabase) supabase.removeChannel(channel).catch(() => {});
  }

  function stopPolling(){
    if(ui.pollTimer !== null){
      window.clearInterval(ui.pollTimer);
      ui.pollTimer = null;
    }
  }

  function startPolling(requestToken){
    stopPolling();
    ui.pollTimer = window.setInterval(() => {
      if(!controller.isCurrent(requestToken) || document.visibilityState !== 'visible') return;
      refreshUnread('Periodic');
    }, 60000);
  }

  function subscribe(requestToken){
    const supabase = client();
    if(!supabase || !requestToken?.userId) return;
    ui.channel = supabase
      .channel(`employee-notifications:${requestToken.userId}:${requestToken.generation}`)
      .on('postgres_changes', {
        event:'INSERT',
        schema:'public',
        table:TABLE,
        filter:`user_id=eq.${requestToken.userId}`
      }, () => {
        if(!controller.isCurrent(requestToken)) return;
        refreshUnread('Realtime');
        if(ui.open) controller.requestTopRefresh();
      })
      .subscribe();
  }

  function activate(userId){
    unsubscribe();
    stopPolling();
    const requestToken = controller.activate(userId);
    subscribe(requestToken);
    startPolling(requestToken);
    refreshUnread('Initial');
  }

  function deactivate(){
    if(ui.open) closePanel();
    unsubscribe();
    stopPolling();
    controller.deactivate();
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
      if(controller.getState().active) deactivate();
      return;
    }
    ensurePanel();
    ensureBell(userPanel);
    if(controller.getState().userId !== employee.id) activate(employee.id);
    else updateBadge();
  }

  document.addEventListener('click', event => {
    const bell = event.target.closest('[data-notification-bell]');
    if(bell){ event.preventDefault(); openPanel(); return; }
    if(event.target.closest('[data-notification-close]')){ event.preventDefault(); closePanel(); return; }
    if(event.target.id === 'notification-overlay'){ closePanel(); return; }
    if(event.target.closest('[data-notification-retry]')){ loadInitial('Retry'); return; }
    if(event.target.closest('[data-notification-load-more]')){
      controller.loadMore().catch(error => console.warn('Notification page load failed', error));
      return;
    }
    if(event.target.closest('[data-notification-mark-all]')){ markAllNotificationsRead(); return; }
    const item = event.target.closest('[data-notification-id]');
    if(item) markNotificationRead(item.dataset.notificationId);
  });

  document.addEventListener('keydown', event => {
    if(event.key === 'Escape' && ui.open) closePanel();
  });

  document.addEventListener('visibilitychange', () => {
    const state = controller.getState();
    if(document.visibilityState !== 'visible' || !state.active) return;
    refreshUnread('Visible');
    refreshVisibleHistory('Visible');
  });

  window.addEventListener('focus', () => {
    if(!controller.getState().active) return;
    refreshUnread('Focus');
  });

  const userPanel = document.querySelector('#user-panel');
  if(userPanel){
    const observer = new MutationObserver(() => queueMicrotask(syncAuthenticatedUi));
    observer.observe(userPanel, { childList:true });
  }
  syncAuthenticatedUi();
})();

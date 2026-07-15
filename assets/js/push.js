/* Push notifications for Современник PWA */
(function(){
  const CONFIG = window.SOVREMENNIK_SUPABASE || {};
  const SUPABASE_URL = CONFIG.url || '';
  const SUPABASE_ANON_KEY = CONFIG.anonKey || '';
  const VAPID_PUBLIC_KEY = CONFIG.vapidPublicKey || '';

  // app.js is a legacy monolith with global override blocks. RLS already
  // returns only rows visible to the current user, but the final client filter
  // previously kept only assignee tasks. Preserve assignee visibility and also
  // show rows created by the current user.
  function installTaskParticipantVisibilityFix(){
    if(typeof window.canSeeTask !== 'function') return;
    window.canSeeTask = function(task){
      if(typeof window.isAdmin === 'function' && window.isAdmin()) return true;
      const user = typeof window.currentUser === 'function' ? (window.currentUser() || {}) : {};
      const normalized = value => String(value || '').trim().toLowerCase();
      const userId = normalized(user.id);
      const userLogin = normalized(user.login);
      const userName = normalized(user.name);
      const assigneeId = normalized(task?.assigneeId || task?.assignee_id);
      const assigneeLogin = normalized(task?.assigneeLogin || task?.login);
      const assigneeName = normalized(task?.assigneeName || task?.assignee || task?.to);
      const creatorId = normalized(task?.creatorId || task?.creator_id);
      const creatorLogin = normalized(task?.creatorLogin);
      const creatorName = normalized(task?.authorName || task?.author || task?.creatorName);
      return Boolean(
        (userId && (userId === assigneeId || userId === creatorId))
        || (userLogin && (userLogin === assigneeLogin || userLogin === creatorLogin))
        || (userName && (userName === assigneeName || userName === creatorName))
      );
    };
  }
  installTaskParticipantVisibilityFix();

  const PREFS = [
    ['task_assigned', 'Новые задачи'],
    ['vip_tasks', 'VIP-задачи'],
    ['task_deadline_24h', 'Дедлайн задачи за 24 часа'],
    ['task_deadline_1h', 'Дедлайн задачи за 1 час'],
    ['task_overdue', 'Просроченные задачи'],
    ['task_completed', 'Завершение задач'],
    ['checklist_submitted', 'Отправленные чек-листы'],
    ['revision_submitted', 'Отправленные ревизии'],
    ['error_report_submitted', 'Сообщения об ошибках'],
    ['schedule_event_added', 'Новые события в расписании']
  ];

  const pushClient = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
    : null;

  function esc(value){ return String(value ?? '').replace(/[&<>\"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\\':'\\','"':'&quot;'}[ch])); }
  function unsupportedReason(){
    if(!('serviceWorker' in navigator)) return 'В этом браузере нет Service Worker.';
    if(!('PushManager' in window)) return 'В этом браузере нет Push API.';
    if(!('Notification' in window)) return 'В этом браузере нет Notification API.';
    if(!window.isSecureContext) return 'Push работает только на HTTPS.';
    if(!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.includes('PASTE_')) return 'Не вставлен VAPID_PUBLIC_KEY в assets/js/supabase-config.js.';
    return '';
  }
  function base64UrlToUint8Array(base64Url){
    const padding = '='.repeat((4 - base64Url.length % 4) % 4);
    const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for(let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }
  async function getSession(){ const { data } = await pushClient.auth.getSession(); return data?.session || null; }
  async function getUserId(){ const session = await getSession(); return session?.user?.id || ''; }
  async function getRegistration(){ return await navigator.serviceWorker.register('./service-worker.js', { scope: './' }); }
  async function getSubscription(){ const reg = await getRegistration(); return await reg.pushManager.getSubscription(); }
  function currentPermissionText(){
    if(!('Notification' in window)) return 'не поддерживается';
    if(Notification.permission === 'granted') return 'разрешены';
    if(Notification.permission === 'denied') return 'запрещены';
    return 'не включены';
  }
  function currentRole(){
    try {
      return typeof window.currentUser === 'function' ? String(window.currentUser()?.role || '').toLowerCase() : '';
    } catch(error){
      return '';
    }
  }
  function hasSectionAccess(section){
    try {
      return typeof window.hasAccess === 'function' ? !!window.hasAccess(section) : false;
    } catch(error){
      return false;
    }
  }
  function allowedPrefs(){
    const role = currentRole();
    const allowed = new Set(['task_assigned', 'vip_tasks', 'task_deadline_24h', 'task_deadline_1h', 'task_overdue', 'schedule_event_added']);
    if(role === 'admin' || role === 'manager' || hasSectionAccess('employees')) allowed.add('task_completed');
    if(hasSectionAccess('control')) {
      allowed.add('checklist_submitted');
      allowed.add('revision_submitted');
      allowed.add('error_report_submitted');
    }
    return PREFS.filter(([key]) => allowed.has(key));
  }

  async function saveSubscription(subscription){
    const userId = await getUserId();
    if(!userId) throw new Error('Сначала нужно войти в аккаунт.');
    const json = subscription.toJSON();
    const row = {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh_key: json.keys?.p256dh || '',
      auth_key: json.keys?.auth || '',
      subscription_json: json,
      user_agent: navigator.userAgent,
      device_name: /iPhone|iPad/i.test(navigator.userAgent) ? 'iPhone / iPad' : (/Android/i.test(navigator.userAgent) ? 'Android' : 'Компьютер'),
      is_active: true,
      last_seen_at: new Date().toISOString()
    };
    const { error } = await pushClient.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' });
    if(error) throw error;
    await ensurePrefs();
  }
  async function ensurePrefs(){
    const userId = await getUserId();
    if(!userId) return;
    const baseRow = { user_id: userId };
    PREFS.forEach(([key]) => { baseRow[key] = false; });
    allowedPrefs().forEach(([key]) => { baseRow[key] = true; });
    const { error } = await pushClient.from('notification_preferences').upsert(baseRow, { onConflict: 'user_id' });
    if(error) console.warn(error);
  }
  async function loadPrefs(){
    const userId = await getUserId();
    if(!userId) return {};
    await ensurePrefs();
    const { data, error } = await pushClient.from('notification_preferences').select('*').eq('user_id', userId).maybeSingle();
    if(error) throw error;
    return data || {};
  }
  async function savePrefs(form){
    const userId = await getUserId();
    if(!userId) throw new Error('Нет активного пользователя.');
    const row = { user_id: userId };
    PREFS.forEach(([key]) => { row[key] = false; });
    allowedPrefs().forEach(([key]) => row[key] = !!form.querySelector(`[name="${key}"]`)?.checked);
    const { error } = await pushClient.from('notification_preferences').upsert(row, { onConflict: 'user_id' });
    if(error) throw error;
  }
  async function enablePush(){
    const reason = unsupportedReason();
    if(reason) throw new Error(reason);
    if(!pushClient) throw new Error('Supabase не подключен.');
    const permission = await Notification.requestPermission();
    if(permission !== 'granted') throw new Error('Уведомления не разрешены в браузере/телефоне.');
    const reg = await getRegistration();
    let subscription = await reg.pushManager.getSubscription();
    if(!subscription){
      subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY) });
    }
    await saveSubscription(subscription);
    try { new Notification('Современник', { body: 'Уведомления включены на этом устройстве.' }); } catch(e) {}
  }
  async function disablePush(){
    const subscription = await getSubscription();
    if(subscription){
      await pushClient.from('push_subscriptions').update({ is_active: false }).eq('endpoint', subscription.endpoint);
      await subscription.unsubscribe().catch(()=>{});
    }
  }
  async function testPush(){
    const cfg = window.SOVREMENNIK_SUPABASE || {};
    const url = cfg.pushSendFunctionUrl || `${SUPABASE_URL}/functions/v1/push-send`;
    const session = await getSession();
    if(!session?.access_token) throw new Error('Нет активной сессии.');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ mode: 'self', title: 'Тест уведомлений', body: 'Если вы видите это сообщение, Push работает.', url: location.href })
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok || data.error) throw new Error(data.error || 'Не удалось отправить тест.');
  }
  async function renderPushBox(){
    if(!pushClient) return '';
    const reason = unsupportedReason();
    let subscribed = false;
    try { subscribed = Boolean(await getSubscription()); } catch(e) {}
    let prefs = {};
    try { prefs = await loadPrefs(); } catch(e) { console.warn(e); }
    const permission = currentPermissionText();
    const availablePrefs = allowedPrefs();
    const prefsHtml = availablePrefs.map(([key,label]) => {
      const checked = prefs[key] !== false;
      return `<label class="push-pref"><input type="checkbox" name="${esc(key)}" ${checked?'checked':''}> <span>${esc(label)}</span></label>`;
    }).join('');
    return `<section class="push-card" id="push-card">
      <div class="push-head"><div><p class="section-kicker">Уведомления</p><h3>Push на телефон</h3><p class="description">Показываются только уведомления, доступные для вашей роли.</p></div><span class="push-status ${subscribed?'ok':''}">${subscribed?'включены':esc(permission)}</span></div>
      ${reason?`<p class="push-error">${esc(reason)}</p>`:''}
      <div class="push-actions">
        <button class="small-action" type="button" data-push-enable>${subscribed?'Обновить устройство':'Включить уведомления'}</button>
        <button class="small-action ghost" type="button" data-push-test ${subscribed?'':'disabled'}>Тест</button>
        <button class="small-action ghost" type="button" data-push-disable ${subscribed?'':'disabled'}>Отключить</button>
      </div>
      <details class="push-details" ${subscribed?'open':''}><summary>Какие уведомления получать</summary><form id="push-preferences-form" class="push-prefs">${prefsHtml || '<p class="description">Для вашей роли сейчас нет дополнительных категорий уведомлений.</p>'}<button class="small-action" type="submit">Сохранить настройки</button></form></details>
      <p class="push-hint">iPhone: сначала откройте сайт в Safari → Поделиться → На экран «Домой», потом запускайте с иконки и включайте уведомления.</p>
    </section>`;
  }
  let isInjectingPushBox = false;

  function removeDuplicatePushBoxes(){
    const cards = Array.from(document.querySelectorAll('#push-card, .push-card'));
    if(cards.length <= 1) return;
    cards.slice(1).forEach(card => card.remove());
  }

  async function injectPushBox(){
    if(isInjectingPushBox) return;
    if(!document.body || document.body.classList.contains('login-mode')) return;
    const home = document.querySelector('#top-home .home-dashboard') || document.querySelector('#top-home');
    if(!home) return;
    removeDuplicatePushBoxes();
    if(document.querySelector('#push-card')) return;
    isInjectingPushBox = true;
    try {
      const holder = document.createElement('div');
      holder.innerHTML = await renderPushBox();
      const node = holder.firstElementChild;
      removeDuplicatePushBoxes();
      if(node && !document.querySelector('#push-card')) home.appendChild(node);
    } finally {
      isInjectingPushBox = false;
    }
  }
  async function refreshPushBox(){
    Array.from(document.querySelectorAll('#push-card, .push-card')).forEach(card => card.remove());
    await injectPushBox();
  }
  document.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-push-enable],[data-push-disable],[data-push-test]');
    if(!btn) return;
    const status = document.querySelector('#push-card .push-status');
    try {
      btn.disabled = true;
      if(btn.hasAttribute('data-push-enable')) { if(status) status.textContent = 'включаю…'; await enablePush(); }
      if(btn.hasAttribute('data-push-disable')) { if(status) status.textContent = 'отключаю…'; await disablePush(); }
      if(btn.hasAttribute('data-push-test')) { if(status) status.textContent = 'отправляю тест…'; await testPush(); }
      await refreshPushBox();
    } catch(error) {
      alert(error.message || 'Не удалось выполнить действие.');
      await refreshPushBox();
    } finally {
      btn.disabled = false;
    }
  });
  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('#push-preferences-form');
    if(!form) return;
    event.preventDefault();
    try { await savePrefs(form); alert('Настройки уведомлений сохранены.'); }
    catch(error) { alert(error.message || 'Не удалось сохранить настройки.'); }
  });
  const observer = new MutationObserver(() => injectPushBox().catch(console.warn));
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('load', () => injectPushBox().catch(console.warn));
})();

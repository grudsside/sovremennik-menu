/* Safe client migration after VAPID key rotation. */
(function(){
  const CONFIG = window.SOVREMENNIK_SUPABASE || {};
  const SUPABASE_URL = CONFIG.url || '';
  const SUPABASE_ANON_KEY = CONFIG.anonKey || '';
  const VAPID_PUBLIC_KEY = CONFIG.vapidPublicKey || '';

  function base64UrlToUint8Array(value){
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from(raw, ch => ch.charCodeAt(0));
  }

  function keysMatch(subscription){
    const actualBuffer = subscription?.options?.applicationServerKey;
    if(!actualBuffer) return false;
    const actual = new Uint8Array(actualBuffer);
    const expected = base64UrlToUint8Array(VAPID_PUBLIC_KEY);
    if(actual.length !== expected.length) return false;
    return actual.every((value, index) => value === expected[index]);
  }

  async function refreshStatus(){
    try {
      if(!('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID_PUBLIC_KEY) return;
      const registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
      const subscription = await registration.pushManager.getSubscription();
      if(!subscription || keysMatch(subscription)) return;
      const card = document.querySelector('#push-card');
      if(!card) return;
      const status = card.querySelector('.push-status');
      const testButton = card.querySelector('[data-push-test]');
      const enableButton = card.querySelector('[data-push-enable]');
      if(status){ status.textContent = 'требуется обновление'; status.classList.remove('ok'); }
      if(testButton) testButton.disabled = true;
      if(enableButton) enableButton.textContent = 'Обновить устройство';
    } catch(error){
      console.warn('VAPID status check failed', error);
    }
  }

  async function rotateSubscription(button){
    if(!window.isSecureContext) throw new Error('Push работает только на HTTPS.');
    if(!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      throw new Error('Push не поддерживается этим браузером.');
    }
    if(!SUPABASE_URL || !SUPABASE_ANON_KEY || !VAPID_PUBLIC_KEY) throw new Error('Не настроен Push.');

    const permission = await Notification.requestPermission();
    if(permission !== 'granted') throw new Error('Уведомления не разрешены в браузере/телефоне.');

    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    const { data: sessionData } = await client.auth.getSession();
    const userId = sessionData?.session?.user?.id || '';
    if(!userId) throw new Error('Сначала нужно войти в аккаунт.');

    const registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
    let subscription = await registration.pushManager.getSubscription();

    if(subscription && !keysMatch(subscription)){
      await client.from('push_subscriptions').update({ is_active: false }).eq('endpoint', subscription.endpoint);
      await subscription.unsubscribe().catch(()=>{});
      subscription = null;
    }

    if(!subscription){
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY)
      });
    }

    const json = subscription.toJSON();
    const { error } = await client.from('push_subscriptions').upsert({
      user_id: userId,
      endpoint: json.endpoint,
      p256dh_key: json.keys?.p256dh || '',
      auth_key: json.keys?.auth || '',
      subscription_json: json,
      user_agent: navigator.userAgent,
      device_name: /iPhone|iPad/i.test(navigator.userAgent) ? 'iPhone / iPad' : (/Android/i.test(navigator.userAgent) ? 'Android' : 'Компьютер'),
      is_active: true,
      last_seen_at: new Date().toISOString()
    }, { onConflict: 'endpoint' });
    if(error) throw error;

    if(button) button.textContent = 'Устройство обновлено';
    alert('Push-подписка на этом устройстве обновлена. Теперь выполните тест уведомления.');
    location.reload();
  }

  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-push-enable]');
    if(!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const status = document.querySelector('#push-card .push-status');
    try {
      button.disabled = true;
      if(status) status.textContent = 'обновляю…';
      await rotateSubscription(button);
    } catch(error){
      alert(error?.message || 'Не удалось обновить push-подписку.');
      button.disabled = false;
      await refreshStatus();
    }
  }, true);

  const observer = new MutationObserver(() => refreshStatus());
  if(document.body) observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('load', refreshStatus);
})();

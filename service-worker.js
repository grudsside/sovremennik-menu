self.addEventListener('install', event => {
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch(error) { data = { title: 'Современник', body: event.data ? event.data.text() : 'Новое уведомление' }; }
  const title = data.title || 'Современник';
  const options = {
    body: data.body || 'Новое уведомление',
    icon: data.icon || './assets/icons/icon-192.png',
    badge: data.badge || './assets/icons/badge-96.png',
    tag: data.tag || data.event_key || undefined,
    renotify: Boolean(data.renotify || data.requireInteraction),
    requireInteraction: Boolean(data.requireInteraction),
    data: { url: data.url || './', event_key: data.event_key || '' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || './', self.location.origin).href;
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        try { await client.navigate(targetUrl); } catch(e) {}
        return client.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(targetUrl);
  })());
});

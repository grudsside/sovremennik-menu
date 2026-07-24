/* Современник PWA: push notifications + offline app shell. */
const CACHE_VERSION = 'sovremennik-offline-20260724-v1';
const RUNTIME_CACHE = 'sovremennik-runtime-20260724-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './data/menu.json',
  './assets/css/styles.css',
  './assets/css/interface-v3-hotfix.css',
  './assets/css/interface-followup.css',
  './assets/css/tasks-v2.css',
  './assets/css/schedule-manager.css',
  './assets/css/schedule-departments.css',
  './assets/css/home-shift-roles.css',
  './assets/css/mobile-active-panel.css',
  './assets/css/section-maintenance.css',
  './assets/css/mobile-photo-expand.css',
  './assets/css/checklist-photo-reports.css',
  './assets/css/checklist-photo-viewer-fit.css',
  './assets/css/offline-reliability.css',
  './assets/css/shift-handoff.css',
  './assets/css/shift-handoff-hotfix.css',
  './assets/js/supabase-config.js',
  './assets/js/app.js',
  './assets/js/notification-history-core.js',
  './assets/js/notifications.js',
  './assets/js/push.js',
  './assets/js/push-legacy.js',
  './assets/js/employee-status.js',
  './assets/js/interface-redesign.js',
  './assets/js/tasks-v2.js',
  './assets/js/interface-v3.js',
  './assets/js/greeting-name.js',
  './assets/js/schedule-manager.js',
  './assets/js/schedule-submit-fix.js',
  './assets/js/schedule-departments.js',
  './assets/js/interface-followup.js',
  './assets/js/home-shift-roles.js',
  './assets/js/mobile-active-panel.js',
  './assets/js/section-maintenance.js',
  './assets/js/mobile-photo-expand.js',
  './assets/js/checklist-details-fix.js',
  './assets/js/checklist-photo-core.js',
  './assets/js/checklist-photo-reports.js',
  './assets/js/offline-core.js',
  './assets/js/offline-sync.js',
  './assets/js/shift-handoff-core.js',
  './assets/js/shift-handoff.js',
  './assets/js/shift-handoff-mobile-input-fix.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/badge-96.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

async function precache(){
  const cache = await caches.open(CACHE_VERSION);
  await Promise.allSettled(APP_SHELL.map(async url => {
    const request = new Request(url, { cache:'reload', mode:url.startsWith('http') ? 'no-cors' : 'same-origin' });
    const response = await fetch(request);
    if(response.ok || response.type === 'opaque') await cache.put(request, response);
  }));
}

self.addEventListener('install', event => {
  event.waitUntil(precache());
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('sovremennik-') && ![CACHE_VERSION, RUNTIME_CACHE].includes(name))
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, fallbackUrl){
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if(response.ok || response.type === 'opaque') cache.put(request, response.clone());
    return response;
  } catch(error){
    return (await cache.match(request, { ignoreSearch:true }))
      || (await caches.match(request, { ignoreSearch:true }))
      || (fallbackUrl ? await caches.match(fallbackUrl, { ignoreSearch:true }) : null)
      || Response.error();
  }
}

async function staleWhileRevalidate(request){
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await caches.match(request, { ignoreSearch:true });
  const update = fetch(request).then(response => {
    if(response.ok || response.type === 'opaque') cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || await update || Response.error();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if(request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  if(request.mode === 'navigate'){
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }

  if(sameOrigin && (url.pathname.endsWith('/data/menu.json') || url.pathname.endsWith('/manifest.webmanifest'))){
    event.respondWith(networkFirst(request));
    return;
  }

  if(sameOrigin){
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Previously loaded CDN scripts, instruction images and fonts remain available offline.
  if(['script','style','image','font'].includes(request.destination)) event.respondWith(staleWhileRevalidate(request));
});

self.addEventListener('sync', event => {
  if(event.tag !== 'sovremennik-checklist-sync') return;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type:'window', includeUncontrolled:true });
    windows.forEach(client => client.postMessage({ type:'SOVREMENNIK_SYNC_PENDING' }));
  })());
});

self.addEventListener('message', event => {
  if(event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch(error) { data = { title:'Современник', body:event.data ? event.data.text() : 'Новое уведомление' }; }
  const title = data.title || 'Современник';
  const options = {
    body:data.body || 'Новое уведомление',
    icon:data.icon || './assets/icons/icon-192.png',
    badge:data.badge || './assets/icons/badge-96.png',
    tag:data.tag || data.event_key || undefined,
    renotify:Boolean(data.renotify || data.requireInteraction),
    requireInteraction:Boolean(data.requireInteraction),
    data:{ url:data.url || './', event_key:data.event_key || '' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type:'window', includeUncontrolled:true });
    for(const client of allClients){
      if('focus' in client){
        try { await client.navigate(targetUrl); } catch(error){}
        return client.focus();
      }
    }
    if(clients.openWindow) return clients.openWindow(targetUrl);
  })());
});
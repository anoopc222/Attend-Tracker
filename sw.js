/* ═══════════════════════════════════════════════
   AttendTrack Pro — Service Worker
   Strategy:
     • Shell (index.html, icons, manifest) → Cache First
     • Google Fonts / external CDN            → Stale-While-Revalidate
     • Everything else                        → Network First with cache fallback
   Cache versioning: bump CACHE_VER to force update.
═══════════════════════════════════════════════ */

const CACHE_VER = 'at-pro-v2';
const SHELL_CACHE = `${CACHE_VER}-shell`;
const FONT_CACHE  = `${CACHE_VER}-fonts`;

/* Files that must be available offline */
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

/* ── INSTALL: pre-cache shell ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())   // activate immediately
  );
});

/* ── ACTIVATE: clean up old caches ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== FONT_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())  // take control of all open tabs
  );
});

/* ── FETCH: routing logic ── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Google Fonts — stale-while-revalidate
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }

  // 2. Shell assets — cache first
  if (SHELL_ASSETS.some(a => url.pathname.endsWith(a.replace('./', '/')))) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // 3. index.html navigation — cache first (SPA)
  if (request.mode === 'navigate') {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // 4. Everything else — network first with cache fallback
  event.respondWith(networkFirst(request, SHELL_CACHE));
});

/* ── Strategies ── */

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline — resource unavailable', { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Offline — resource unavailable', { status: 503 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || fetchPromise;
}

/* ── Background sync placeholder (future use) ── */
self.addEventListener('sync', event => {
  if (event.tag === 'sync-records') {
    console.log('[SW] Background sync triggered');
    // future: push local IDB changes to cloud
  }
});

/* ── Push notifications ── */
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json().catch(() => ({ title: 'AttendTrack Pro', body: event.data.text() }));
  event.waitUntil(
    data.then(d =>
      self.registration.showNotification(d.title || 'AttendTrack Pro', {
        body: d.body || "Don't forget to mark your attendance!",
        icon: './icon-192.png',
        badge: './icon-192.png',
        vibrate: [100, 50, 100],
        data: { url: self.location.origin },
        actions: [
          { action: 'open', title: 'Open App' },
          { action: 'dismiss', title: 'Dismiss' }
        ]
      })
    )
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action !== 'dismiss') {
    event.waitUntil(clients.openWindow(event.notification.data?.url || '/'));
  }
});

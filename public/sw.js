// FaB Trainer service worker:
//  - card images: cache-first, so cards keep their art without a connection
//  - the app itself (page, built assets, card database): network-first with an offline fallback, so an
//    installed web app (Add to Home Screen) opens and plays bots offline but always gets updates when online
const CACHE = 'card-images-v1';
const SHELL = 'app-shell-v1';
const MAX_IMAGES = 4000;
const IMAGE_HOSTS = ['legendstory-production-s3-public.s3.amazonaws.com', 'storage.googleapis.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['./', './data/cards.json', './data/bot-decks.json', './manifest.webmanifest']).catch(() => {})));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

async function shell(req) {
  const cache = await caches.open(SHELL);
  const url = new URL(req.url);
  // hashed build files never change: serve from cache when we have them
  if (url.pathname.includes('/assets/')) {
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) {
      await cache.put(req, res.clone());
      // old builds' files pile up after updates: keep the newest ones only
      const old = (await cache.keys()).filter((k) => k.url.includes('/assets/'));
      for (let i = 0; i < old.length - 40; i++) await cache.delete(old[i]);
    }
    return res;
  }
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req.mode === 'navigate' ? './' : req, res.clone());
    return res;
  } catch {
    return (await cache.match(req.mode === 'navigate' ? './' : req, { ignoreSearch: true })) ?? Response.error();
  }
}

let puts = 0;
async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_IMAGES; i++) await cache.delete(keys[i]); // oldest first
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // the app's own files (not the API or the game server connection)
  if (url.origin === self.location.origin && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/ws')) {
    e.respondWith(shell(req));
    return;
  }
  if (!IMAGE_HOSTS.includes(url.hostname) || !/\.(webp|png|jpe?g)$/i.test(url.pathname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req.url, { ignoreVary: true, ignoreSearch: true });
    if (hit) return hit;
    try {
      // the image host doesn't send CORS headers, so this is an opaque response; <img> can still show it
      const res = await fetch(req.url, { mode: 'no-cors', credentials: 'omit' });
      if (res.ok || res.type === 'opaque') {
        await cache.put(req.url, res.clone());
        if (++puts % 50 === 0) void trim(cache);
      }
      return res;
    } catch {
      return Response.error();
    }
  })());
});

// push notifications (friend challenges, friend cups); skipped if the app is open and visible
self.addEventListener('push', (e) => {
  let d = { title: 'FaB Trainer', body: '', url: '/' };
  try { d = { ...d, ...e.data.json() }; } catch { /* plain text */ }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === 'visible')) return;
    await self.registration.showNotification(d.title, { body: d.body, icon: './icons/icon-192.png', badge: './icons/icon-192.png', data: { url: d.url }, tag: d.url });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { if ('focus' in w) { await w.focus(); if ('navigate' in w) await w.navigate(url).catch(() => {}); return; } }
    await self.clients.openWindow(url);
  })());
});

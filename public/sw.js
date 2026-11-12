// FaB Trainer service worker: keeps card images on the device so cards show their art without a connection.
// Only card images are cached (cache-first); the app itself always loads fresh.
const CACHE = 'card-images-v1';
const MAX_IMAGES = 4000;
const IMAGE_HOSTS = ['legendstory-production-s3-public.s3.amazonaws.com', 'storage.googleapis.com'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

let puts = 0;
async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_IMAGES; i++) await cache.delete(keys[i]); // oldest first
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
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

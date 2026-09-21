/* Longevity OS service worker.
 *
 * Three strategies, chosen per request:
 *   - app shell & build assets  → cache-first (they are content-hashed)
 *   - today's plan (navigations) → network-first with a cache fallback, so the
 *     session still reads in a basement gym with no signal
 *   - exercise media / thumbnails → cache-first with a small LRU trim
 *
 * Nothing here talks to a third party and nothing is scheduled: it is a cache,
 * not a background service.
 */

const VERSION = 'v1';
const SHELL = `lo-shell-${VERSION}`;
const PLAN = `lo-plan-${VERSION}`;
const MEDIA = `lo-media-${VERSION}`;
const MEDIA_LIMIT = 120;

const PRECACHE = ['/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => ![SHELL, PLAN, MEDIA].includes(k)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)));
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response && response.status === 200 && response.type !== 'opaque') {
    cache.put(request, response.clone());
    if (cacheName === MEDIA) trim(MEDIA, MEDIA_LIMIT);
  }
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    // `response.redirected` means auth sent us somewhere else — caching it would
    // file the sign-in page under `/` and serve it back offline forever. It also
    // throws outright in `cache.put`, which would swallow the navigation.
    if (response && response.status === 200 && !response.redirected) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const hit = (await cache.match(request)) || (await cache.match('/'));
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache server actions, API routes or anything that writes.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, PLAN));
    return;
  }

  if (url.origin === self.location.origin && url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, SHELL));
    return;
  }

  if (
    request.destination === 'image' ||
    /\.(?:gif|png|jpg|jpeg|webp|avif|svg)$/i.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(request, MEDIA));
    return;
  }

  if (url.origin === self.location.origin && (request.destination === 'style' || request.destination === 'font')) {
    event.respondWith(cacheFirst(request, SHELL));
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

/*
 * Royal Diadem service worker — offline support for NON-SENSITIVE content only.
 *
 * Hard boundary (CLAUDE.md §3): no PHI/PII is ever cached client-side. This
 * worker touches only same-origin GET requests for static assets and the app
 * shell. API/data traffic (Supabase, Edge Functions — cross-origin) never
 * enters a cache here. Offline journal/crown-check sync arrives in a later
 * phase as an encrypted, server-mediated queue — not via this cache.
 */

const CACHE_NAME = 'rd-static-v2';

const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/assets/royal-diadem-logo.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-48.png',
];

const STATIC_PATH_PREFIXES = ['/assets/', '/icons/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    // Cross-origin (Supabase, Turnstile, Edge Functions): never intercepted,
    // never cached — the no-PHI-client-side rule depends on this.
    return;
  }

  const isStaticAsset =
    STATIC_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)) ||
    url.pathname === '/manifest.json' ||
    url.pathname.startsWith('/assets') ||
    /\.(?:js|css|png|svg|woff2?)$/.test(url.pathname);

  if (isStaticAsset) {
    // Cache-first: hashed build assets and brand images are immutable.
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
            }
            return response;
          }),
      ),
    );
    return;
  }

  if (request.mode === 'navigate') {
    // Network-first for navigations so users get fresh HTML, with the cached
    // app shell as the offline fallback.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put('/', copy)));
          }
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached ?? Response.error())),
    );
  }
});

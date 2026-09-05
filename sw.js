const CACHE_NAME = 'iron-ledger-v13';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './app.js',
  './new_icon.png',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).catch((err) => {
      // If a CDN asset fails to precache (e.g. no connection on first install),
      // don't block install — the app shell files still get cached individually.
      console.warn('Some assets failed to precache', err);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isAppShellRequest(url) {
  return PRECACHE_URLS.some((precached) => {
    if (precached.startsWith('http')) return url.href === precached;
    // local path — compare pathname endings
    return url.pathname.endsWith(precached.replace('./', '/'));
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept Firestore's own network traffic — its SDK manages
  // offline queuing/retries internally and does it better than we can here.
  if (url.hostname.includes('firestore.googleapis.com') || url.hostname.includes('googleapis.com')) {
    return;
  }

  if (event.request.method !== 'GET') return;

  if (isAppShellRequest(url) || url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const network = fetch(event.request)
          .then((response) => {
            if (response && response.status === 200) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            }
            return response;
          })
          .catch(() => cached); // offline — fall back to cache
        return cached || network;
      })
    );
  }
});

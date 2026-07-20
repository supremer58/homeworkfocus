// Caches the app shell so the app still loads (and recent screens keep
// working) through brief connection drops. Never touches Supabase or CDN
// requests — those always go straight to the network.
const CACHE_NAME = 'homeworkfocus-v1';
const APP_SHELL = [
  '/', '/index.html', '/student.html', '/reading.html', '/listening.html', '/teacher.html',
  '/style.css', '/config.js', '/db.js', '/activity-timer.js', '/student-common.js', '/student.js', '/teacher.js',
  '/manifest.json', '/icon-192.png', '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});

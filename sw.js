const CACHE_NAME = 'meterapp-v16';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './drive.js',
  './sync.js',
  './qr.js',
  './jsQR.js',
  './qrcode.min.js',
  './manifest.json',
  './xlsx.full.min.js',
  './seed_meters.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // ข้าม cache สำหรับ request ข้ามโดเมน (เช่น Google Apps Script API) เสมอ —
  // ถ้าปล่อยให้ cache-first ครอบด้วย จะได้ข้อมูลเก่าค้างตลอดไป (export endpoint ไม่มี
  // cache-busting param) ทำให้ refreshSheetLatestCache() ไม่เคยเห็นข้อมูลใหม่จริง
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return resp;
        })
        .catch(() => cached);
    })
  );
});

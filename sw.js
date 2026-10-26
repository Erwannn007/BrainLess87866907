// Cache hors-ligne : le jeu marche même sans réseau une fois ouvert.
// Change VERSION à chaque mise à jour pour forcer le rafraîchissement.
const VERSION = 'brainless-v7';
const FILES = [
  './', './index.html', './manifest.webmanifest',
  './js/main.js', './js/world.js', './js/noise.js', './js/raster.js', './js/nomu.js', './js/sprites.js', './js/font.js', './js/audio.js',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Réseau d'abord (pour recevoir les mises à jour), cache si hors-ligne.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

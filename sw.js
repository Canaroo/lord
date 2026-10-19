/*
 * Service worker: makes Beat Frets installable and playable offline.
 *
 * The game's own files are served from the cache straight away and refreshed
 * in the background, so an update shows up on the next launch. The bonus-track
 * list is fetched fresh when online. Songs and fonts are cached once they've
 * been loaded, so anything you've played before also works offline.
 */
'use strict';
const CACHE = 'beat-frets-v1';
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  ...['analyzer', 'chartgen', 'songs', 'bonus', 'save', 'library', 'sfx', 'input', 'render', 'game', 'share', 'main'].map((f) => `js/${f}.js`),
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameOrigin && !isFont) return;

  // The bonus-track list should be current: network first, cache as fallback.
  if (sameOrigin && url.pathname.endsWith('/songs/index.json')) {
    e.respondWith(
      fetch(req).then((res) => { putCache(req, res.clone()); return res; }).catch(() => caches.match(req))
    );
    return;
  }

  // Everything else: answer from cache, refresh it in the background.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') putCache(req, res.clone()); return res; });
      if (hit) { net.catch(() => {}); return hit; }
      return net;
    })
  );
});

function putCache(req, res) {
  return caches.open(CACHE).then((c) => c.put(req, res)).catch(() => {});
}

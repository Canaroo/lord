/*
 * Service worker: makes Beat Frets installable and playable offline.
 *
 * The game's own code and pages come from the network when it answers quickly,
 * so an update shows up as soon as it's published, and from the cache when
 * offline or on a slow connection. Songs, icons and fonts are served from the
 * cache once they've been loaded, so anything you've played before also works
 * offline.
 */
'use strict';
const CACHE = 'beat-frets-1.8'; // match VERSION in js/main.js
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  ...['analyzer', 'chartgen', 'songs', 'bonus', 'save', 'library', 'sfx', 'input', 'render', 'game', 'tiles', 'share', 'main'].map((f) => `js/${f}.js`),
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

  // Game code, pages and the bonus-track list: network first (if it answers within
  // a few seconds), cache as fallback.
  const isCode = sameOrigin && (req.mode === 'navigate' || /(\/|\.html|\.js|\.css|\.webmanifest|\/songs\/index\.json)$/.test(url.pathname));
  if (isCode) {
    e.respondWith(networkFirst(req));
    return;
  }

  // Songs, icons, fonts: answer from cache, refresh it in the background.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') putCache(req, res.clone()); return res; });
      if (hit) { net.catch(() => {}); return hit; }
      return net;
    })
  );
});

function networkFirst(req) {
  const net = fetch(req).then((res) => { if (res.ok) putCache(req, res.clone()); return res; });
  const slow = new Promise((resolve) => setTimeout(resolve, 3000));
  return Promise.race([net, slow.then(() => caches.match(req))])
    .then((res) => res || net)
    .catch(() => caches.match(req).then((hit) => hit || Promise.reject(new Error('offline'))));
}

function putCache(req, res) {
  return caches.open(CACHE).then((c) => c.put(req, res)).catch(() => {});
}

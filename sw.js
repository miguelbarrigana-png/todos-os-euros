// Service worker for "MAB360" (formerly "Contas em Dia") — caches the app
// shell so the app opens instantly and works offline. Firestore has its own
// offline cache (enabled in index.html) for the actual data.
//
// IMPORTANT: bump CACHE_NAME (v2, v3, ...) every time index.html changes.
// Changing this string is what makes the browser notice the service worker
// itself changed, install the new one, and throw away the old cached files.
// Without it, phones can keep showing an old version indefinitely.
// (The cache key name itself is an internal identifier, left as-is for
// upgrade compatibility with installs already running v5.)
var CACHE_NAME = 'contas-em-dia-v14';
var SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
 
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_FILES);
    }).then(function () { return self.skipWaiting(); })
  );
});
 
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (n) { return n !== CACHE_NAME; })
             .map(function (n) { return caches.delete(n); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});
 
// Page navigations and index.html: network-first, so a phone that's online
// always gets the latest version instead of being stuck on a cached one.
// Falls back to cache only when offline. Other shell files (icons,
// manifest — these rarely change): cache-first, fast and works offline.
// Everything else (Firebase, fonts, etc.): network, falling back to cache.
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
 
  var isNavigation = req.mode === 'navigate' || req.url.indexOf('index.html') !== -1;
 
  if (isNavigation) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (cached) {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }
 
  var isShellFile = SHELL_FILES.some(function (f) {
    return req.url.indexOf(f.replace('./', '')) !== -1;
  }) || new URL(req.url).origin === self.location.origin;
 
  if (isShellFile) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        return cached || fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
          return res;
        });
      }).catch(function () { return caches.match('./index.html'); })
    );
  } else {
    event.respondWith(
      fetch(req).catch(function () { return caches.match(req); })
    );
  }
});

const CACHE = 'life-os-v2';
const SHELL = ['./manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);

  // Never cache data/API — always live
  if (u.pathname.startsWith('/api')) return;

  const isHTML = e.request.mode === 'navigate' ||
                 u.pathname.endsWith('.html') ||
                 u.pathname === '/' ||
                 u.pathname.endsWith('/');

  if (isHTML) {
    // HTML pages: ALWAYS network-first with no stale fallback caching of the page.
    // This guarantees the newest interface loads the moment it's deployed.
    e.respondWith(
      fetch(e.request).catch(() =>
        caches.match(e.request).then(m => m || caches.match('./index.html'))
      )
    );
    return;
  }

  // Other assets (icons, manifest): network-first, cache for offline.
  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r && r.ok && r.status === 200 && r.type === 'basic') {
          const cp = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, cp));
        }
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});

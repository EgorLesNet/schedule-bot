const C = 'schedule-v50';
const SHELL = ['./', 'index.html', 'fast.js', 'app.js', 'ux.js', 'settings.js', 'extras.js', 'files.js', 'news.js', 'more.js', 'menu.js', 'hwx.js', 'plan.js', 'room.js', 'subj.js', 'library.js', 'clubs.js', 'hwfold.js', 'dlv.js', 'anim.js', 'visual.js', 'interactions.js', 'dates-eu.js', 'style.css', 'glass-theme.css', 'manifest.webmanifest', 'icon.svg'];
const NAV = ['glisse-nav.js', 'glisse-nav.css', 'glisse-notices.txt'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(C).then(async (c) => {
    await c.addAll(SHELL);
    await Promise.all(NAV.map((p) => c.add(p).catch(() => {})));
  }));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(caches.match(e.request).then((hit) => {
    const net = fetch(e.request).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(C).then((c) => c.put(e.request, cp)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});

const C = 'schedule-v41';
const SHELL = ['./', 'index.html', 'fast.js', 'app.js', 'ux.js', 'settings.js', 'extras.js', 'files.js', 'news.js', 'more.js', 'menu.js', 'hwx.js', 'plan.js', 'room.js', 'subj.js', 'clubs.js', 'hwfold.js', 'dlv.js', 'anim.js', 'navpill.js', 'style.css', 'manifest.webmanifest', 'icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(C).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(caches.match(e.request).then((hit) => {
    const net = fetch(e.request).then((r) => { const cp = r.clone(); caches.open(C).then((c) => c.put(e.request, cp)); return r; }).catch(() => hit);
    return hit || net;
  }));
});

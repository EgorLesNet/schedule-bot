// Versioned offline shell for the Mini App.
// RULE: change BUILD in every commit that touches files in web/. A new BUILD makes the browser install a fresh, complete cache.
// Safety: index.html is network-first, so a release is visible at once when online; static files are served from one consistent
// versioned cache; the new worker waits (no skipWaiting) and takes over on the next Mini App opening, never in the middle of a session.
const BUILD = '2026-11-28-1';
const PREFIX = 'schedule-shell-';
const CACHE = PREFIX + BUILD;
const LEGACY = ['schedule-v51'];
const NAV_WAIT_MS = 3000;
const scope = () => self.registration.scope;
const indexUrl = () => new URL('index.html', scope()).href;

function discover(html) {
  const found = new Set([indexUrl(), new URL('manifest.webmanifest', scope()).href, new URL('icon.svg', scope()).href]);
  const re = /(?:src|href)\s*=\s*['"]([^'"#]+)['"]/g;
  let m;
  while ((m = re.exec(html))) {
    let u;
    try { u = new URL(m[1], scope()); } catch (e) { continue; }
    if (u.origin !== self.location.origin || !u.href.startsWith(scope())) continue;
    if (/\/sw\.js$/.test(u.pathname)) continue;
    u.search = '';
    found.add(u.href);
  }
  return [...found];
}

async function precache() {
  const cache = await caches.open(CACHE);
  const res = await fetch(indexUrl(), { cache: 'reload' });
  if (!res.ok) throw new Error('index.html unavailable');
  const html = await res.clone().text();
  await cache.put(indexUrl(), res);
  const rest = discover(html).filter((u) => u !== indexUrl());
  await Promise.all(rest.map(async (u) => {
    try {
      const r = await fetch(u, { cache: 'reload' });
      if (r.ok && r.type === 'basic') await cache.put(u, r);
    } catch (e) {}
  }));
}

self.addEventListener('install', (event) => { event.waitUntil(precache()); });

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if ((name.startsWith(PREFIX) && name !== CACHE) || LEGACY.includes(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

function isIndexNav(request, url) {
  return request.mode === 'navigate' && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'));
}

async function navigate(event) {
  const cache = await caches.open(CACHE);
  const network = fetch(event.request).then(async (res) => {
    if (res.ok && res.type === 'basic') await cache.put(indexUrl(), res.clone());
    return res;
  });
  const cached = await cache.match(indexUrl());
  if (!cached) return network;
  event.waitUntil(network.catch(() => {}));
  const timer = new Promise((resolve) => setTimeout(() => resolve(cached), NAV_WAIT_MS));
  return Promise.race([network.catch(() => cached), timer]);
}

async function asset(event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(event.request, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(event.request);
  if (res.ok && res.type === 'basic') event.waitUntil(cache.put(event.request, res.clone()).catch(() => {}));
  return res;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(scope()) || /\/sw\.js$/.test(url.pathname)) return;
  if (request.mode === 'navigate') {
    if (isIndexNav(request, url)) event.respondWith(navigate(event));
    return;
  }
  event.respondWith(asset(event));
});

// React root cutover v1. Network-only shell until a versioned offline strategy is tested.
// No fetch interception: old cache-first HTML must not hide new releases.
self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Remove only the known legacy shell cache, not unrelated application caches or user data.
    await caches.delete('schedule-v51');
    await self.clients.claim();
  })());
});

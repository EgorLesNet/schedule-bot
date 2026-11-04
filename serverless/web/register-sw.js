(() => {
  if (!('serviceWorker' in navigator)) return;
  const script = document.currentScript;
  if (!script) return;
  const url = new URL('sw.js', script.src);
  let controlled = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controlled && !reloading) { reloading = true; window.location.reload(); }
    controlled = true;
  });
  navigator.serviceWorker.register(url.href, { scope: new URL('./', url).href, updateViaCache: 'none' })
    .then(registration => registration.update())
    .catch(error => console.warn('Service worker update failed:', error));
})();

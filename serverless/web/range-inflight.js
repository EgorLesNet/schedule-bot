// Share pending range reads only; fast.js remains responsible for offline caching.
(function () {
  const tg = window.Telegram && window.Telegram.WebApp;
  const api = tg && tg.Serverless;
  if (!api || typeof api.call !== 'function') return;
  const call = api.call.bind(api);
  const pending = new Map();
  api.call = function (name, params, callback) {
    if (name !== 'range' || typeof callback !== 'function') {
      pending.clear();
      return call(name, params, callback);
    }
    let key;
    try { key = JSON.stringify(params); } catch (_) { return call(name, params, callback); }
    const existing = pending.get(key);
    if (existing) { existing.callbacks.push(callback); return existing.handle; }
    const entry = { callbacks: [callback], handle: undefined };
    pending.set(key, entry);
    const forget = () => { if (pending.get(key) === entry) pending.delete(key); };
    const expiry = setTimeout(forget, 10000);
    try {
      entry.handle = call(name, params, (error, result) => {
        clearTimeout(expiry);
        forget();
        const callbacks = entry.callbacks.splice(0);
        for (const notify of callbacks) {
          try { notify(error, result); } catch (e) { console.error('range callback failed', e); }
        }
      });
      return entry.handle;
    } catch (e) {
      clearTimeout(expiry);
      forget();
      throw e;
    }
  };
})();

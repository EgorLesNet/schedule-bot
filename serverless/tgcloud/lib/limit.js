import * as store from './store.js';

// Простое ограничение частоты: не более max действий action от пользователя uid за окно windowMs (kv rl:<action>:<uid>).
// Возвращает true, если действие разрешено. Не защищает от одновременных запросов на уровне миллисекунд, но останавливает цикл спама.
export async function allow(uid, action, max, windowMs) {
  const key = 'rl:' + action + ':' + uid;
  const now = Date.now();
  const r = await store.get(key, null);
  if (!r || now - r.t >= windowMs) { await store.set(key, { t: now, n: 1 }); return true; }
  if (r.n >= max) return false;
  r.n += 1;
  await store.set(key, r);
  return true;
}

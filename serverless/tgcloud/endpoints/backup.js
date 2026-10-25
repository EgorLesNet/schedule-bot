import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { endpoint } from '../lib/auth.js';
import { createBackup } from '../lib/backup.js';

// Автоматическая копия: вызывается GitHub Actions (npx tgcloud run endpoints/backup '{}' --ctx ..., служебный id 1; у реальных пользователей такого id нет) или админом.
// В ответе и в логе только служебные числа (никаких данных пользователей), чтобы они могли попасть в лог GitHub Actions.
// Любая ошибка возвращается с причиной (только вызывающему, у которого есть права), иначе платформа показывает лишь «HTTP 500».
export default endpoint(async (input, u) => {
  if (u.id !== 1 && !store.isAdmin(u.username)) throw new EndpointError('forbidden');
  const t0 = Date.now();
  try {
    const r = await createBackup(u.id === 1 ? 'auto' : 'manual');
    console.log('backup ok: keys=' + r.keys + ' bytes=' + r.bytes + ' parts=' + r.parts + ' ms=' + (Date.now() - t0));
    return { id: r.id, keys: r.keys, bytes: r.bytes, parts: r.parts, pruned: r.pruned };
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 200);
    console.log('backup failed: ' + msg);
    throw new EndpointError('backup failed: ' + msg);
  }
});

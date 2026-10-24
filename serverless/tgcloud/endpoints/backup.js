import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { endpoint } from '../lib/auth.js';
import { createBackup } from '../lib/backup.js';

// Автоматическая копия: вызывается GitHub Actions (npx tgcloud run endpoints/backup, служебный id 1; у реальных пользователей такого id нет) или админом.
// В ответе только служебные числа (никаких данных пользователей), чтобы они могли попасть в лог GitHub Actions.
export default endpoint(async (input, u) => {
  if (u.id !== 1 && !store.isAdmin(u.username)) throw new EndpointError('forbidden');
  const r = await createBackup(u.id === 1 ? 'auto' : 'manual');
  return { id: r.id, keys: r.keys, bytes: r.bytes, parts: r.parts, pruned: r.pruned };
});

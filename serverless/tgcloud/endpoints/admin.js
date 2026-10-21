import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { collectStats } from '../lib/stats.js';
import { endpoint } from '../lib/auth.js';

// Админ-панель Mini App (только админ): статистика активности и список ассистентов
export default endpoint(async (input, u) => {
  if (!store.isAdmin(u.username)) throw new EndpointError('forbidden');
  const a = input.action;
  if (a === 'stats') return collectStats();
  if (a === 'assistants' || a === 'assistant_add' || a === 'assistant_del') {
    let list = await store.get('assistants', []);
    if (a !== 'assistants') {
      const name = String(input.username || '').split('@').join('').trim().toLowerCase();
      if (!/^[a-z0-9_]{3,32}$/.test(name)) throw new EndpointError('bad username');
      list = list.filter((x) => x !== name);
      if (a === 'assistant_add') list.push(name);
      await store.set('assistants', list);
    }
    return { assistants: list };
  }
  throw new EndpointError('bad action');
});

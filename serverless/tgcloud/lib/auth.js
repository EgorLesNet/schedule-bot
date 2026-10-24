import { EndpointError } from 'sdk';
import * as store from './store.js';
import { ADMIN_USERNAME } from './config.js';

// Роли привязаны к числовому id. Ник админа или ассистента при первом обращении запоминается вместе с id (kv idbind).
// Если тот же ник позже окажется у другого аккаунта (другой id), его username обнуляется и права не действуют.
// Привязка снимается сама, когда ник перестаёт быть админским или ассистентским и кто-то с таким ником заходит.
export async function secure(user) {
  const name = String(user.username || '').toLowerCase();
  if (!name) return user;
  const privileged = name === ADMIN_USERNAME || (await store.get('assistants', [])).includes(name);
  const bind = await store.get('idbind', {});
  if (!privileged) {
    if (bind[name] !== undefined) {
      delete bind[name];
      await store.set('idbind', bind);
    }
    return user;
  }
  if (bind[name] === undefined) {
    bind[name] = user.id;
    await store.set('idbind', bind);
    return user;
  }
  if (bind[name] === user.id) return user;
  return Object.assign({}, user, { username: '' });
}

export function endpoint(fn) {
  return async function (input, ctx) {
    const user = ctx && ctx.initData && ctx.initData.user;
    if (!user || !user.id) throw new EndpointError('unauthorized');
    return fn(input || {}, await secure(user));
  };
}

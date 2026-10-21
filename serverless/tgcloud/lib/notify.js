import * as store from './store.js';
import { send } from './bot.js';

// Рассылка потоку: всем, кто не отключил уведомления об изменениях (по умолчанию включены)
export async function notifyStream(course, stream, text, exceptId) {
  let n = 0;
  for (const id of await store.get('users', [])) {
    if (id === exceptId) continue;
    try {
      const u = await store.getUser(id);
      if (u.alerts === false || u.course !== course || u.stream !== stream) continue;
      await send(id, text);
      n++;
    } catch (e) {}
  }
  return n;
}

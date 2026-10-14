import * as store from './store.js';
import { send } from './bot.js';

export async function notifyStream(course, stream, text, exceptId) {
  let n = 0;
  for (const id of await store.get('users', [])) {
    if (id === exceptId) continue;
    try {
      const u = await store.getUser(id);
      if (!u.reminders || u.course !== course || u.stream !== stream) continue;
      await send(id, text);
      n++;
    } catch (e) {}
  }
  return n;
}

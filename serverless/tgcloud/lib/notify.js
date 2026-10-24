import * as store from './store.js';
import { send } from './bot.js';

// Рассылка потоку: всем, кто не отключил уведомления (по умолчанию включены).
// flag — поле настройки пользователя: 'alerts' (изменения расписания), 'hwAlerts' (новое ДЗ). exceptId — id или массив id, кому не слать.
// Отправка пачками по 3 (быстрее, чем по одному, и в пределах лимита Telegram), не дольше 25 секунд.
export async function notifyStream(course, stream, text, exceptId, flag = 'alerts') {
  const skip = Array.isArray(exceptId) ? exceptId : [exceptId];
  const t0 = Date.now();
  const targets = [];
  for (const id of await store.get('users', [])) {
    if (skip.includes(id)) continue;
    try {
      const u = await store.getUser(id);
      if (u[flag] === false || u.course !== course || u.stream !== stream) continue;
      targets.push(id);
    } catch (e) {}
  }
  let n = 0;
  for (let i = 0; i < targets.length; i += 3) {
    if (Date.now() - t0 > 25000) break;
    const res = await Promise.allSettled(targets.slice(i, i + 3).map((id) => send(id, text)));
    n += res.filter((r) => r.status === 'fulfilled').length;
  }
  return n;
}

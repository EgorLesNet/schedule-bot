import * as store from './store.js';
import { send } from './bot.js';
import { Batch, record } from './dlv.js';

// Рассылка потоку: всем, кто не отключил уведомления (по умолчанию включены).
// flag — поле настройки пользователя: 'alerts' (изменения расписания), 'hwAlerts' (новое ДЗ). exceptId — id или массив id, кому не слать.
// Отправка пачками по 3 (быстрее, чем по одному, и в пределах лимита Telegram), не дольше 25 секунд. Итог попадает в журнал рассылок.
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
  const b = new Batch(flag === 'hwAlerts' ? 'Новое ДЗ' : 'Изменения расписания', { course, stream }, text);
  let i = 0;
  for (; i < targets.length; i += 3) {
    if (Date.now() - t0 > 25000) break;
    const part = targets.slice(i, i + 3);
    const res = await Promise.allSettled(part.map((id) => send(id, text)));
    res.forEach((r, k) => { if (r.status === 'fulfilled') b.hit(); else b.miss(part[k], r.reason); });
  }
  if (i < targets.length) b.skip(targets.slice(i));
  try { await record(b); } catch (e) {}
  return b.ok;
}

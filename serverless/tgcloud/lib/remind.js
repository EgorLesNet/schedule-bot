import * as store from './store.js';
import { getRenames } from './schedule.js';
import { send } from './bot.js';
import { today, addDays } from './time.js';
import { NL } from './config.js';

export async function sendReminders() {
  const date = addDays(today(), 1);
  let sent = 0;
  for (const id of await store.get('users', [])) {
    const u = await store.getUser(id);
    if (!u.reminders || !u.course || !u.stream) continue;
    const list = store.futureHw(await store.loadHw(u.course, u.stream), date).filter((x) => x.date === date);
    if (!list.length) continue;
    const ren = await getRenames(u.course, u.stream);
    let t = '🔔 Напоминание о домашних заданиях на завтра:' + NL + NL;
    for (const x of list) t += '📖 ' + (ren[x.subject] || x.subject) + ':' + NL + x.text + NL + NL;
    try { await send(id, t); sent++; } catch (e) {}
  }
  return sent;
}

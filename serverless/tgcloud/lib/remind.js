import * as store from './store.js';
import { getRenames, loadEvents, buildDay, dayText } from './schedule.js';
import { userLang } from './lang.js';
import { send } from './bot.js';
import { today, addDays } from './time.js';
import { NL } from './config.js';
import { Batch, record } from './dlv.js';

// Вечернее напоминание: расписание на завтра и домашние задания. У каждого пользователя своё время (remindAt, МСК).
// У платформы нет планировщика, поэтому рассылку запускает tickReminders (endpoints/tick.js): GitHub Actions и раз в 5 минут открытое приложение.
// Тик срабатывает не чаще раза в минуту и отправляет не более MAX_PER_TICK сообщений за раз.
export const DEFAULT_AT = '20:00';
const TICK_MS = 60000;
const MAX_PER_TICK = 15;
const MSK = 3 * 3600000;

const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const nowMin = () => { const d = new Date(Date.now() + MSK); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const validAt = (t) => /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(String(t || ''));

export async function buildReminder(u, date, memo) {
  const sk = u.course + '_' + u.stream;
  let m = memo[sk];
  if (!m) {
    const [events, hw, ren] = await Promise.all([loadEvents(u.course, u.stream), store.loadHw(u.course, u.stream), getRenames(u.course, u.stream)]);
    m = { events, hw, ren };
    memo[sk] = m;
  }
  const day = buildDay(m.events, date, userLang(u), {});
  const hwList = store.futureHw(m.hw, date).filter((x) => x.date === date);
  if (!day.items.length && !hwList.length) return '';
  let t = '🔔 Напоминание на завтра' + NL + NL + dayText(day);
  if (hwList.length) {
    t += NL + '📝 Домашние задания на завтра:' + NL + NL;
    for (const x of hwList) t += '📖 ' + (m.ren[x.subject] || x.subject) + ':' + NL + x.text + NL + NL;
  }
  return t.trim().slice(0, 4000);
}

// force=true: всем, у кого включены напоминания, независимо от времени (команда /remind_now)
// force=false: только тем, у кого время уже наступило и сегодня ещё не отправляли.
// Итог каждой рассылки попадает в журнал. При временной ошибке (лимит, сбой сети) отметка «уже отправлено» снимается,
// и напоминание уйдёт при следующей проверке (пока у пользователя не наступил следующий день).
async function run(force, limit) {
  const day = today();
  const date = addDays(day, 1);
  const now = nowMin();
  const memo = {};
  const b = new Batch('Напоминание', {}, '');
  let sent = 0;
  for (const id of await store.get('users', [])) {
    if (sent >= limit) break;
    const u = await store.getUser(id);
    if (!u.reminders || !u.course || !u.stream) continue;
    if (!force) {
      if (u.remindSent === day) continue;
      if (now < toMin(validAt(u.remindAt) ? u.remindAt : DEFAULT_AT)) continue;
      await store.set('user:' + id, Object.assign({}, u, { remindSent: day }));
    }
    let text = '';
    try { text = await buildReminder(u, date, memo); } catch (e) { continue; }
    if (!text) continue;
    try {
      await send(id, text);
      sent++;
      b.hit();
    } catch (e) {
      const c = b.miss(id, e);
      if (c.retry && !force) await store.set('user:' + id, u);
    }
  }
  try { await record(b); } catch (e) {}
  return sent;
}

export const sendReminders = () => run(true, Infinity);

export async function tickReminders() {
  const now = Date.now();
  const st = await store.get('remind:tick', { at: 0 });
  if (now - st.at < TICK_MS) return 0;
  await store.set('remind:tick', { at: now });
  return run(false, MAX_PER_TICK);
}

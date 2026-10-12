import * as store from './store.js';
import { listSchedules, loadEvents, buildDay, dayText, getRenames } from './schedule.js';
import { today, addDays, weekStart, ruShort } from './time.js';
import { APP_URL, NL } from './config.js';

const b = (text, data) => ({ text, callback_data: data });
const kb = (rows) => ({ inline_keyboard: rows });
const back = kb([[b('⬅️ Меню', 'menu')]]);

export async function coursesView() {
  const s = await listSchedules();
  const courses = Object.keys(s).sort((x, y) => x - y);
  if (!courses.length) return { text: '❌ Не удалось найти файлы расписания. Попробуй позже.' };
  return { text: 'Привет! 🎓' + NL + 'Выбери свой курс:', markup: kb(courses.map((c) => [b(c + ' курс', 'c:' + c)])) };
}

export function englishView(course, stream) {
  const p = 'e:' + course + ':' + stream + ':';
  return { text: 'Выбери время для английского в четверг:', markup: kb([[b('🕘 9:00-12:10', p + 'm')], [b('🕑 14:00-17:10', p + 'a')], [b('❌ Без английского', p + 'n')]]) };
}

export async function streamsView(course) {
  const streams = (await listSchedules())[course] || [];
  if (!streams.length) return { text: '❌ Расписание для этого курса пока не добавлено.' };
  if (streams.length === 1) return englishView(course, streams[0].key);
  return { text: 'Выбери своё расписание:', markup: kb(streams.map((s) => [b('📖 ' + s.name, 's:' + course + ':' + s.key)])) };
}

export async function menuView(user) {
  const streams = (await listSchedules())[user.course] || [];
  const info = streams.find((x) => x.key === user.stream);
  let t = 'Выбран ' + user.course + ' курс' + (streams.length > 1 && info ? ', ' + info.name : '');
  if (user.englishTime === 'morning') t += NL + '💡 Английский: 9:00-12:10';
  if (user.englishTime === 'afternoon') t += NL + '💡 Английский: 14:00-17:10';
  t += NL + (user.reminders ? '🔔' : '🔕') + ' Напоминания: ' + (user.reminders ? 'вкл' : 'выкл') + NL + 'Выбери действие:';
  const rows = [
    [b('📅 Сегодня', 'd:0'), b('📅 Завтра', 'd:1')],
    [b('📊 Эта неделя', 'w:0'), b('📊 След. неделя', 'w:1')],
    [b('📝 Домашние задания', 'hw')],
    [b('🔔 Напоминания', 'rem')],
    [b('🔄 Обновить расписание', 'rf')],
  ];
  if (APP_URL) rows.unshift([{ text: '📱 Открыть приложение', web_app: { url: APP_URL } }]);
  if (streams.length > 1) rows.push([b('🔁 Сменить расписание', 'c:' + user.course)]);
  rows.push([b('⚙️ Сменить курс', 'courses')]);
  return { text: t, markup: kb(rows) };
}

export async function dayView(user, offset) {
  const date = addDays(today(), offset);
  const [events, hw] = await Promise.all([loadEvents(user.course, user.stream), store.loadHw(user.course, user.stream)]);
  return { text: dayText(buildDay(events, date, user.englishTime, hw), offset === 1 ? 'Завтра, ' : ''), markup: back };
}

export async function weekView(user, offset) {
  const start = weekStart(addDays(today(), 7 * offset));
  const [events, hw] = await Promise.all([loadEvents(user.course, user.stream), store.loadHw(user.course, user.stream)]);
  let t = '';
  for (let i = 0; i < 7; i++) t += dayText(buildDay(events, addDays(start, i), user.englishTime, hw));
  if (t.length > 4000) t = t.slice(0, 4000) + '…';
  return { text: t, markup: back };
}

export async function hwView(user) {
  const list = store.futureHw(await store.loadHw(user.course, user.stream), today());
  const ren = await getRenames(user.course, user.stream);
  let t = '📋 Список домашних заданий пуст';
  if (list.length) {
    t = '📋 Список домашних заданий:' + NL + NL;
    for (const x of list) t += '📖 ' + (ren[x.subject] || x.subject) + ' (' + ruShort(x.date) + '):' + NL + x.text + NL + NL;
  }
  return { text: t, markup: back };
}

export function remView(user) {
  const on = !!user.reminders;
  const t = '⚙️ Напоминания о ДЗ ' + (on ? 'включены ✅' : 'выключены ❌') + NL + NL + 'Цель: ДЗ на завтра приходит в 20:00 (МСК). Пока автоматический запуск по времени не подключён, админ рассылает напоминания командой /remind_now.';
  return { text: t, markup: kb([[b(on ? '🔕 Выключить' : '🔔 Включить', 'remt')], [b('⬅️ Меню', 'menu')]]) };
}

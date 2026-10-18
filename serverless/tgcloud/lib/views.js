import * as store from './store.js';
import { listSchedules, loadEvents, buildDay, dayText, getRenames } from './schedule.js';
import { today, addDays, weekStart, ruShort } from './time.js';
import { APP_URL, NL } from './config.js';
import { FACULTIES, COURSES_COUNT, filesFor } from './faculties.js';
import { userLang, langSpan, LANG_TIMES } from './lang.js';

const b = (text, data) => ({ text, callback_data: data });
const kb = (rows) => ({ inline_keyboard: rows });
const back = kb([[b('⬅️ Меню', 'menu')]]);
const has = (v) => v !== undefined && v !== null;

export function facultiesView() {
  return { text: 'Привет! 🎓' + NL + 'Выбери свой факультет:', markup: kb(FACULTIES.map((f, i) => [b(f.name, 'f:' + i)])) };
}

export async function coursesView() {
  const s = await listSchedules();
  if (!Object.keys(s).length) return { text: '❌ Не удалось найти файлы расписания. Попробуй позже.' };
  return facultiesView();
}

export function courseNumView(fi) {
  const f = FACULTIES[fi];
  if (!f) return facultiesView();
  const rows = [];
  for (let c = 1; c <= COURSES_COUNT; c++) rows.push([b(c + ' курс', 'k:' + fi + ':' + c)]);
  rows.push([b('⬅️ К факультетам', 'courses')]);
  return { text: f.name + ' факультет' + NL + 'Выбери курс:', markup: kb(rows) };
}

async function courseStreams(course, fi, di) {
  const all = (await listSchedules())[course] || [];
  if (!has(fi) || !has(di)) return all;
  const files = filesFor(fi, di);
  return all.filter((s) => files.includes(s.file));
}

export async function directionsView(fi, course) {
  const f = FACULTIES[fi];
  if (!f) return facultiesView();
  const rows = [];
  for (let i = 0; i < f.directions.length; i++) {
    const ok = (await courseStreams(course, fi, i)).length > 0;
    rows.push([b(f.directions[i] + (ok ? '' : ' (нет расписания)'), 'dr:' + fi + ':' + course + ':' + i)]);
  }
  rows.push([b('⬅️ Назад', 'f:' + fi)]);
  return { text: f.name + ' факультет, ' + course + ' курс' + NL + 'Выбери направление:', markup: kb(rows) };
}

export function langView(course, stream) {
  const rows = [];
  for (let i = 0; i < LANG_TIMES.length; i += 4) {
    rows.push(LANG_TIMES.slice(i, i + 4).map((t) => b(t, 'e:' + course + ':' + stream + ':' + t.replace(':', ''))));
  }
  rows.push([b('❌ Не выбрано', 'e:' + course + ':' + stream + ':n')]);
  return { text: '🗣 Ин. яз' + NL + 'Выбери время начала. Две пары по 90 минут, перерыв 10 минут.', markup: kb(rows) };
}

export async function streamsView(course, fi, di) {
  const streams = await courseStreams(course, fi, di);
  if (!streams.length) {
    const markup = has(fi) && has(di) ? kb([[b('⬅️ Назад', 'k:' + fi + ':' + course)]]) : kb([[b('⬅️ К факультетам', 'courses')]]);
    return { text: '😕 Расписание для этого направления и курса пока не добавлено.', markup };
  }
  if (streams.length === 1) return { single: streams[0].key };
  return { text: 'Выбери своё расписание:', markup: kb(streams.map((s) => [b('📖 ' + s.name, 's:' + course + ':' + s.key)])) };
}

export async function menuView(user) {
  const streams = await courseStreams(user.course, user.faculty, user.direction);
  const info = streams.find((x) => x.key === user.stream);
  let t = '';
  const f = has(user.faculty) ? FACULTIES[user.faculty] : null;
  if (f) t += '🏛 ' + f.name + ' факультет' + (f.directions[user.direction] ? ', ' + f.directions[user.direction] : '') + NL;
  t += 'Выбран ' + user.course + ' курс' + (streams.length > 1 && info ? ', ' + info.name : '');
  const ls = userLang(user);
  if (ls) t += NL + '🗣 Ин. яз: ' + langSpan(ls);
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
  rows.push([b('⚙️ Сменить факультет/курс', 'courses')]);
  return { text: t, markup: kb(rows) };
}

export async function dayView(user, offset) {
  const date = addDays(today(), offset);
  const [events, hw] = await Promise.all([loadEvents(user.course, user.stream), store.loadHw(user.course, user.stream)]);
  return { text: dayText(buildDay(events, date, userLang(user), hw), offset === 1 ? 'Завтра, ' : ''), markup: back };
}

export async function weekView(user, offset) {
  const start = weekStart(addDays(today(), 7 * offset));
  const [events, hw] = await Promise.all([loadEvents(user.course, user.stream), store.loadHw(user.course, user.stream)]);
  let t = '';
  for (let i = 0; i < 7; i++) t += dayText(buildDay(events, addDays(start, i), userLang(user), hw));
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

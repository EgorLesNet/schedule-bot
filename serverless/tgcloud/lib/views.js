import * as store from './store.js';
import { allEntries, loadEvents, buildDay, dayText, getRenames } from './schedule.js';
import { today, addDays, weekStart, ruShort } from './time.js';
import { APP_URL, NL } from './config.js';
import { COURSES_COUNT, facultyList, directionsOf, streamsOf } from './faculties.js';
import { userLang, langSpan, LANG_TIMES } from './lang.js';

const b = (text, data) => ({ text, callback_data: data });
const kb = (rows) => ({ inline_keyboard: rows });
const back = kb([[b('⬅️ Меню', 'menu')]]);

export function facultiesView(all) {
  const list = facultyList(all);
  return { text: 'Привет! 🎓' + NL + 'Выбери свой факультет:', markup: kb(list.map((n, i) => [b(n, 'f:' + i)])) };
}

export async function coursesView() {
  const all = await allEntries();
  if (!all.length) return { text: '❌ Не удалось найти файлы расписания. Попробуй позже.' };
  return facultiesView(all);
}

export async function courseNumView(fi) {
  const all = await allEntries();
  const name = facultyList(all)[fi];
  if (!name) return facultiesView(all);
  const rows = [];
  for (let c = 1; c <= COURSES_COUNT; c++) {
    const ok = directionsOf(all, name, c).length > 0;
    rows.push([b(c + ' курс' + (ok ? '' : ' (нет расписания)'), 'k:' + fi + ':' + c)]);
  }
  rows.push([b('⬅️ К факультетам', 'courses')]);
  return { text: name + ' факультет' + NL + 'Выбери курс:', markup: kb(rows) };
}

export async function directionsView(fi, course) {
  const all = await allEntries();
  const name = facultyList(all)[fi];
  if (!name) return facultiesView(all);
  const list = directionsOf(all, name, course);
  const rows = list.map((d, i) => [b(d, 'dr:' + fi + ':' + course + ':' + i)]);
  rows.push([b('⬅️ Назад', 'f:' + fi)]);
  const head = name + ' факультет, ' + course + ' курс' + NL;
  return { text: head + (list.length ? 'Выбери направление:' : 'Для этого курса расписания пока нет.'), markup: kb(rows) };
}

export async function resolveDirection(fi, course, di) {
  const all = await allEntries();
  const faculty = facultyList(all)[fi];
  const direction = faculty ? directionsOf(all, faculty, course)[di] : undefined;
  return faculty && direction ? { faculty, direction } : null;
}

export async function userEntry(user) {
  if (!user.course || !user.stream) return null;
  return (await allEntries()).find((e) => e.course === user.course && e.key === user.stream) || null;
}

export function langView(course, stream) {
  const rows = [];
  for (let i = 0; i < LANG_TIMES.length; i += 4) {
    rows.push(LANG_TIMES.slice(i, i + 4).map((t) => b(t, 'e:' + course + ':' + stream + ':' + t.replace(':', ''))));
  }
  rows.push([b('❌ Не выбрано', 'e:' + course + ':' + stream + ':n')]);
  return { text: '🗣 Ин. яз' + NL + 'Выбери время начала. Две пары по 90 минут, перерыв 10 минут.', markup: kb(rows) };
}

export async function streamsView(course, faculty, direction) {
  const all = await allEntries();
  const streams = streamsOf(all, faculty, course, direction);
  if (!streams.length) {
    const fi = facultyList(all).indexOf(faculty);
    const markup = kb([[b('⬅️ Назад', fi >= 0 ? 'k:' + fi + ':' + course : 'courses')]]);
    return { text: '😕 Расписание для этого направления и курса пока не добавлено.', markup };
  }
  if (streams.length === 1) return { single: streams[0].key };
  return { text: 'Выбери своё расписание:', markup: kb(streams.map((s) => [b('📖 ' + s.name, 's:' + course + ':' + s.key)])) };
}

export async function menuView(user) {
  const all = await allEntries();
  const info = all.find((e) => e.course === user.course && e.key === user.stream);
  let t = '';
  if (info) t += '🏛 ' + info.faculty + ' факультет, ' + info.direction + NL;
  t += 'Выбран ' + user.course + ' курс' + (info && info.stream ? ', ' + info.stream : '');
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
  if (info && streamsOf(all, info.faculty, user.course, info.direction).length > 1) rows.push([b('🔁 Сменить расписание', 'c:' + user.course)]);
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

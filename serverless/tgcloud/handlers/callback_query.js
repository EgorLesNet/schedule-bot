import { api } from 'sdk';
import * as store from '../lib/store.js';
import { edit } from '../lib/bot.js';
import * as V from '../lib/views.js';
import { listSchedules, loadEvents } from '../lib/schedule.js';
import { isLangStart } from '../lib/lang.js';
import { NL } from '../lib/config.js';

const NEED = ['menu', 'd', 'w', 'hw', 'rem', 'remt', 'rf'];

async function chooseStream(uid, course, stream) {
  if (course === '1' || course === '2') return V.langView(course, stream);
  const user = await store.saveUser(uid, { course, stream, langStart: null, englishTime: null });
  return await V.menuView(user);
}

export default async function (q) {
  try { await api.answerCallbackQuery({ callback_query_id: q.id }); } catch (e) {}
  if (!q.message) return;
  const uid = q.from.id;
  const p = (q.data || '').split(':');
  const a = p[0];
  let user = await store.getUser(uid);
  let v;
  if (NEED.includes(a) && !user.course) v = await V.coursesView();
  else if (a === 'courses') v = await V.coursesView();
  else if (a === 'f') v = V.courseNumView(+p[1]);
  else if (a === 'k') v = await V.directionsView(+p[1], p[2]);
  else if (a === 'dr') {
    user = await store.saveUser(uid, { faculty: +p[1], direction: +p[3] });
    v = await V.streamsView(p[2], +p[1], +p[3]);
    if (v.single) v = await chooseStream(uid, p[2], v.single);
  }
  else if (a === 'c') {
    v = await V.streamsView(p[1], user.faculty, user.direction);
    if (v.single) v = await chooseStream(uid, p[1], v.single);
  }
  else if (a === 's') v = await chooseStream(uid, p[1], p[2]);
  else if (a === 'e') {
    const raw = p[3] && p[3] !== 'n' ? p[3].slice(0, 2) + ':' + p[3].slice(2) : null;
    const ls = raw && isLangStart(raw) && (p[1] === '1' || p[1] === '2') ? raw : null;
    user = await store.saveUser(uid, { course: p[1], stream: p[2], langStart: ls, englishTime: null });
    v = await V.menuView(user);
  }
  else if (a === 'menu') v = await V.menuView(user);
  else if (a === 'd') v = await V.dayView(user, +p[1]);
  else if (a === 'w') v = await V.weekView(user, +p[1]);
  else if (a === 'hw') v = await V.hwView(user);
  else if (a === 'rem') v = V.remView(user);
  else if (a === 'remt') {
    user = await store.saveUser(uid, { reminders: !user.reminders });
    v = V.remView(user);
  }
  else if (a === 'rf') {
    await listSchedules(true);
    await loadEvents(user.course, user.stream, true);
    v = await V.menuView(user);
    v.text = '🔄 Расписание обновлено' + NL + v.text;
  }
  else return;
  await edit(q, v.text, v.markup);
}

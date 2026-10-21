import * as store from './store.js';
import { allEntries } from './schedule.js';

const DAY = 86400000;

// Статистика пользователей: активность и разбивка по факультетам и курсам (факультет и курс — по сохранённому потоку)
export async function collectStats() {
  const ids = await store.get('users', []);
  const entries = await allEntries();
  const byKey = new Map(entries.map((e) => [e.course + '|' + e.key, e]));
  const now = Date.now();
  const tree = {};
  const r = { total: ids.length, d1: 0, d7: 0, d30: 0, fresh: 0, unknown: 0, none: 0, lost: 0, reminders: 0, faculties: [] };
  for (const id of ids) {
    const u = await store.getUser(id);
    if (u.reminders) r.reminders++;
    const age = u.seen ? now - u.seen : Infinity;
    if (!u.seen) r.unknown++;
    if (age < DAY) r.d1++;
    if (age < 7 * DAY) r.d7++;
    if (age < 30 * DAY) r.d30++;
    if (u.since && now - u.since < 7 * DAY) r.fresh++;
    if (!u.course || !u.stream) { r.none++; continue; }
    const e = byKey.get(u.course + '|' + u.stream);
    if (!e) { r.lost++; continue; }
    const f = tree[e.faculty] || (tree[e.faculty] = { name: e.faculty, total: 0, active: 0, courses: {} });
    f.total++;
    if (age < 7 * DAY) f.active++;
    f.courses[u.course] = (f.courses[u.course] || 0) + 1;
  }
  r.faculties = Object.values(tree)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ru'))
    .map((f) => ({
      name: f.name,
      total: f.total,
      active: f.active,
      courses: Object.keys(f.courses).sort((a, b) => Number(a) - Number(b)).map((c) => ({ course: c, n: f.courses[c] })),
    }));
  return r;
}

import * as store from '../lib/store.js';
import { loadEvents, parseTeacherRoom } from '../lib/schedule.js';
import { endpoint } from '../lib/auth.js';
import { today } from '../lib/time.js';

// Экзамены и зачёты распознаются по ключевым словам в названии события в .ics («зачёт», «экзамен»); консультации и подготовка не в счёт
const EXAM = /зач[её]т|экзамен/i;
const NOT = /консультац|подготовк/i;

export default endpoint(async (input, u) => {
  const user = await store.getUser(u.id);
  if (!user.course || !user.stream) return { items: [] };
  const day = today();
  const events = await loadEvents(user.course, user.stream);
  const items = events
    .filter((e) => e.date >= day && EXAM.test(e.summary) && !NOT.test(e.summary))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
    .slice(0, 6)
    .map((e) => ({ summary: e.summary, date: e.date, start: e.start, end: e.end, room: parseTeacherRoom(e.desc || '').room }));
  return { items };
});

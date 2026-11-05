import * as store from '../lib/store.js';
import { allEntries, loadEvents, parseTeacherRoom } from '../lib/schedule.js';
import { endpoint } from '../lib/auth.js';
import { today } from '../lib/time.js';
import { resolveExamScope, sameExamScope } from '../lib/exam-scope.js';

const EXAM = /зач[её]т|экзамен/i;
const NOT = /консультац|подготовк/i;

export default endpoint(async (input, u) => {
  const user = await store.getUser(u.id);
  if (!user.course || !user.stream) return { items: [], scope: null };
  const scope = resolveExamScope(user, await allEntries());
  if (!scope) return { items: [], scope: null };
  // The DB selection is authoritative. Request context only detects stale requests.
  if (input.scope !== undefined && !sameExamScope(input.scope, scope)) {
    throw new Error('Выбранное расписание изменилось. Откройте экран заново.');
  }
  const day = today();
  const events = await loadEvents(scope.course, scope.stream);
  const items = events
    .filter(e => e.date >= day && EXAM.test(e.summary) && !NOT.test(e.summary))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
    .slice(0, 6)
    .map(e => ({ summary: e.summary, date: e.date, start: e.start, end: e.end, room: parseTeacherRoom(e.desc || '').room }));
  return { items, scope };
});

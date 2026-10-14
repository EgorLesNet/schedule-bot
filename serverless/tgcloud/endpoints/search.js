import * as store from '../lib/store.js';
import { loadEvents, parseTeacherRoom } from '../lib/schedule.js';
import { endpoint } from '../lib/auth.js';
import { today } from '../lib/time.js';

export default endpoint(async (input, u) => {
  const user = await store.getUser(u.id);
  if (!user.course) return [];
  const q = String(input.q || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const from = today();
  const events = await loadEvents(user.course, user.stream);
  const out = [];
  for (const e of events) {
    if (e.date < from) continue;
    const tr = parseTeacherRoom(e.desc || '');
    const hay = (e.summary + ' ' + tr.teacher + ' ' + tr.room).toLowerCase();
    if (!hay.includes(q)) continue;
    out.push({ date: e.date, start: e.start, end: e.end, summary: e.summary, original: e.original, teacher: tr.teacher, room: tr.room });
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  return out.slice(0, 60);
});

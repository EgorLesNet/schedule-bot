import * as store from '../lib/store.js';
import { allEntries, loadEvents, buildDay, parseTeacherRoom } from '../lib/schedule.js';
import { parseIcs } from '../lib/ics.js';
import { annotateLessonChanges } from '../lib/lesson-ui.js';
import { attachLinks } from '../lib/links.js';
import { userLang } from '../lib/lang.js';
import { endpoint } from '../lib/auth.js';
import { today, addDays } from '../lib/time.js';

export default endpoint(async (input, u) => {
  const user = await store.getUser(u.id);
  if (!user.course) throw new Error('no course');
  const n = Math.min(Math.max(+input.days || 1, 1), 14);
  const from = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.from || '') ? input.from : today();
  const [events, hw, links] = await Promise.all([loadEvents(user.course, user.stream), store.loadHw(user.course, user.stream), store.loadLinks(user.course, user.stream)]);
  const days = attachLinks(Array.from({ length: n }, (_, i) => buildDay(events, addDays(from, i), userLang(user), hw)), events, links);
  // Annotations are additive; a missing original cache must not break the timetable.
  try {
    const entry = (await allEntries()).find(e => e.course === user.course && e.key === user.stream);
    const cached = entry ? await store.get('cache:ics:' + entry.file) : null;
    const edits = (await store.get('edits', {}))[user.course + '_' + user.stream] || {};
    annotateLessonChanges(days, cached?.text ? parseIcs(cached.text) : [], edits, parseTeacherRoom);
  } catch (error) {}
  return days;
});

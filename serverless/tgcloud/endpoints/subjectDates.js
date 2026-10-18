import * as store from '../lib/store.js';
import { loadEvents } from '../lib/schedule.js';
import { langDates, LANG_NAME } from '../lib/lang.js';
import { endpoint } from '../lib/auth.js';
import { today } from '../lib/time.js';

export default endpoint(async (input, u) => {
  const user = await store.getUser(u.id);
  if (!user.course) return [];
  const subject = String(input.subject || '');
  if (!subject) return [];
  const from = today();
  const events = await loadEvents(user.course, user.stream);
  if (subject === LANG_NAME) return user.course === '1' || user.course === '2' ? langDates(events, from).slice(0, 400) : [];
  const dates = events.filter((e) => e.summary === subject && e.date >= from).map((e) => e.date);
  return Array.from(new Set(dates)).sort().slice(0, 400);
});

import * as store from '../lib/store.js';
import { loadEvents } from '../lib/schedule.js';
import { endpoint } from '../lib/auth.js';

export default endpoint(async (input, u) => {
  const user = await store.getUser(u.id);
  if (!user.course) return [];
  const events = await loadEvents(user.course, user.stream);
  const names = events.map((e) => e.summary).filter((s) => !/обед|перерыв/i.test(s));
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, 'ru'));
});

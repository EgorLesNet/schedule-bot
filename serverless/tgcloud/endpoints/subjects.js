import * as store from '../lib/store.js';
import { loadEvents } from '../lib/schedule.js';
import { endpoint } from '../lib/auth.js';

export default endpoint(async (input, u) => {
  const user = await store.getUser(u.id);
  if (!user.course) return [];
  const events = await loadEvents(user.course, user.stream);
  return Array.from(new Set(events.map((e) => e.summary))).sort((a, b) => a.localeCompare(b, 'ru'));
});

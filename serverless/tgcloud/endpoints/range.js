import * as store from '../lib/store.js';
import { loadEvents, buildDay } from '../lib/schedule.js';
import { endpoint } from '../lib/auth.js';
import { today, addDays } from '../lib/time.js';

export default endpoint(async (input, u) => {
  const user = await store.getUser(u.id);
  if (!user.course) throw new Error('no course');
  const n = Math.min(Math.max(+input.days || 1, 1), 14);
  const from = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.from || '') ? input.from : today();
  const [events, hw] = await Promise.all([loadEvents(user.course, user.stream), store.loadHw(user.course, user.stream)]);
  return Array.from({ length: n }, (_, i) => buildDay(events, addDays(from, i), user.englishTime, hw));
});

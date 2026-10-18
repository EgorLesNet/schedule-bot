import * as store from '../lib/store.js';
import { loadEvents, buildDay } from '../lib/schedule.js';
import { attachLinks } from '../lib/links.js';
import { userLang } from '../lib/lang.js';
import { endpoint } from '../lib/auth.js';
import { today, addDays } from '../lib/time.js';

export default endpoint(async (input, u) => {
  const user = await store.getUser(u.id);
  if (!user.course) throw new Error('no course');
  const n = Math.min(Math.max(+input.days || 1, 1), 14);
  const from = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.from || '') ? input.from : today();
  const [events, hw, links] = await Promise.all([
    loadEvents(user.course, user.stream),
    store.loadHw(user.course, user.stream),
    store.loadLinks(user.course, user.stream),
  ]);
  const lang = userLang(user);
  const days = Array.from({ length: n }, (_, i) => buildDay(events, addDays(from, i), lang, hw));
  return attachLinks(days, events, links);
});

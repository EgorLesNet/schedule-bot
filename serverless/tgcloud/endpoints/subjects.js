import * as store from '../lib/store.js';
import { loadEvents } from '../lib/schedule.js';
import { langInfo, LANG_NAME } from '../lib/lang.js';
import { endpoint } from '../lib/auth.js';

export default endpoint(async (input, u) => {
  const user = await store.getUser(u.id);
  if (!user.course) return [];
  const events = await loadEvents(user.course, user.stream);
  const names = events.map((e) => e.summary).filter((s) => !/обед|перерыв/i.test(s));
  if ((user.course === '1' || user.course === '2') && langInfo(events)) names.push(LANG_NAME);
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, 'ru'));
});

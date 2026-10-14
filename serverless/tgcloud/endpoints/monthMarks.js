import * as store from '../lib/store.js';
import { endpoint } from '../lib/auth.js';

export default endpoint(async (input, u) => {
  const user = await store.getUser(u.id);
  if (!user.course) return [];
  const m = String(input.month || '');
  if (!/^[0-9]{4}-[0-9]{2}$/.test(m)) return [];
  const all = await store.loadHw(user.course, user.stream);
  const dates = new Set();
  for (const k of Object.keys(all)) {
    const d = k.slice(k.lastIndexOf('|') + 1);
    if (d.startsWith(m)) dates.add(d);
  }
  return Array.from(dates).sort();
});

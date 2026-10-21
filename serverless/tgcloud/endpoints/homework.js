import * as store from '../lib/store.js';
import { getRenames, toOriginal } from '../lib/schedule.js';
import { applyHw } from '../lib/hwsync.js';
import { endpoint } from '../lib/auth.js';
import { canEdit } from '../lib/roles.js';
import { today } from '../lib/time.js';

export default endpoint(async (input, u) => {
  const user = await store.getUser(u.id);
  if (!user.course) throw new Error('no course');
  const { course, stream } = user;
  if (input.action === 'add' || input.action === 'delete') {
    if (!(await canEdit(u.username, user))) throw new Error('forbidden');
    const date = String(input.date || '');
    const subject = String(input.subject || '').trim();
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !subject) throw new Error('bad input');
    const original = await toOriginal(course, stream, subject);
    if (input.action === 'add') {
      const t = String(input.text || '').trim().slice(0, 1000);
      if (!t) throw new Error('empty text');
      await applyHw(course, stream, original, date, t);
    } else {
      await applyHw(course, stream, original, date, '');
    }
  }
  const all = await store.loadHw(course, stream);
  const ren = await getRenames(course, stream);
  return store.futureHw(all, today()).map((x) => ({ key: x.subject + '|' + x.date, subject: ren[x.subject] || x.subject, date: x.date, text: x.text }));
});

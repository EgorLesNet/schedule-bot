import * as store from '../lib/store.js';
import { listSchedules, loadEvents } from '../lib/schedule.js';
import { userLang } from '../lib/lang.js';
import { buildIcs } from '../lib/icsout.js';
import { endpoint } from '../lib/auth.js';

// Календарь текущего пользователя с учётом правок (переносы, отмены, переименования) и ин. яза: снимок на текущий момент
export default endpoint(async (input, u) => {
  const user = await store.getUser(u.id);
  if (!user.course || !user.stream) throw new Error('select schedule first');
  const info = ((await listSchedules())[user.course] || []).find((s) => s.key === user.stream);
  if (!info) throw new Error('schedule not found');
  const events = await loadEvents(user.course, user.stream);
  const title = info.faculty + ', ' + user.course + ' курс, ' + info.direction + (info.stream ? ', ' + info.stream : '');
  return { name: 'schedule-' + user.course + 'k.ics', text: buildIcs(title, events, userLang(user)) };
});

import { EndpointError } from 'sdk';
import { endpoint } from '../lib/auth.js';
import * as store from '../lib/store.js';
import { canEdit } from '../lib/roles.js';
import { loadEvents, parseTeacherRoom } from '../lib/schedule.js';
import { notifyStream } from '../lib/notify.js';

export default endpoint(async (input, u) => {
  const user = await store.getUser(u.id);
  const { course, stream } = user;
  if (!course || !stream || input.course !== course || input.stream !== stream || !(await canEdit(u.username, user))) throw new EndpointError('Нет доступа или поток изменился');
  const date = input.date;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new EndpointError('Некорректная дата');
  const edits = await store.get('edits', {}), scope = course + '_' + stream;
  const days = edits[scope] || {}, entries = days[date] || {};
  const referenced = key => Object.values(days).some(day => Object.values(day).some(ed => ed.moved_to === date + '|' + key));
  if (input.action === 'list') {
    const events = await loadEvents(course, stream);
    return {
      items: events.filter(e => e.date === date && !/обед|перерыв/i.test(e.summary)).map(e => {
        const key = e.original + '[' + e.start + ']';
        return { ...e, ...parseTeacherRoom(e.desc || ''), key, removable: !!entries[key]?.new && !referenced(key) };
      }),
      cancelled: Object.entries(entries).filter(([key, ed]) => ed.deleted && !ed.new && !ed.moved_to).map(([key]) => ({ key, title: key }))
    };
  }
  const key = input.key, ed = typeof key === 'string' && Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null;
  let text;
  if (input.action === 'restore') {
    if (!ed?.deleted || ed.new || ed.moved_to) throw new EndpointError('Эта отмена уже изменена');
    delete entries[key];
    text = 'Восстановлена пара: ' + key + '\n' + date;
  } else if (input.action === 'remove') {
    if (!ed?.new || referenced(key)) throw new EndpointError('Можно удалить только самостоятельно добавленную пару, не являющуюся целью переноса');
    delete entries[key];
    text = 'Убрана добавленная пара: ' + key + '\n' + date;
  } else throw new EndpointError('Неизвестное действие');
  if (!Object.keys(entries).length) delete days[date];
  edits[scope] = days;
  await store.set('edits', edits);
  let notified = null;
  try { notified = await notifyStream(course, stream, text, u.id); } catch (_) {}
  return { ok: true, notified };
});

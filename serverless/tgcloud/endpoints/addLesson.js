import { EndpointError } from 'sdk';
import { endpoint } from '../lib/auth.js';
import * as store from '../lib/store.js';
import { canEdit } from '../lib/roles.js';
import { allEntries, loadEvents } from '../lib/schedule.js';
import { notifyStream } from '../lib/notify.js';
import { today } from '../lib/time.js';

const time = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
const lunch = /обед|перерыв/i;
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export default endpoint(async (input, u) => {
  const user = await store.getUser(u.id);
  const { course, stream } = user;
  if (!course || !stream || input.course !== course || input.stream !== stream) throw new EndpointError('Поток изменился. Откройте форму заново.');
  if (!(await canEdit(u.username, user))) throw new EndpointError('Нет права редактировать этот поток');
  if (!(await allEntries()).some(e => e.course === course && e.key === stream)) throw new EndpointError('Поток не найден');
  const { date, start, end, subject } = input;
  const parsed = new Date(date + 'T00:00:00Z');
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== date || date < today()) throw new EndpointError('Выберите корректную дату не раньше сегодняшней');
  if (typeof start !== 'string' || typeof end !== 'string' || !time.test(start) || !time.test(end) || start >= end) throw new EndpointError('Проверьте время начала и окончания');
  const events = await loadEvents(course, stream);
  if (typeof subject !== 'string' || lunch.test(subject) || !events.some(e => e.summary === subject)) throw new EndpointError('Выберите предмет из расписания потока');
  const same = events.some(e => e.date === date && e.start === start && e.summary.trim().toLowerCase() === subject.trim().toLowerCase());
  if (same) throw new EndpointError('Пара этого предмета уже начинается в это время');
  const overlaps = events.filter(e => e.date === date && !lunch.test(e.summary) && start < e.end && end > e.start).map(({ summary, start, end }) => ({ summary, start, end }));
  if (overlaps.length && input.allowOverlap !== true) return { added: false, overlaps };
  const teacher = clean(input.teacher, 100);
  const room = clean(input.room, 60);
  const desc = [teacher && 'Преподаватель: ' + teacher, room && 'Аудитория: ' + room].filter(Boolean).join('\n');
  const edits = await store.get('edits', {});
  const scope = course + '_' + stream;
  const days = edits[scope] || (edits[scope] = {});
  const entries = days[date] || (days[date] = {});
  const key = subject + '[' + start + ']';
  if (Object.prototype.hasOwnProperty.call(entries, key)) throw new EndpointError('На эту пару уже есть правка расписания');
  entries[key] = { new: true, new_summary: subject, new_desc: desc, start_time: start, end_time: end };
  await store.set('edits', edits);
  const text = '➕ Добавлена пара: ' + subject + '\n' + date.split('-').reverse().join('.') + ' · ' + start + '–' + end + (desc ? '\n' + desc : '');
  let notified = null;
  try { notified = await notifyStream(course, stream, text, u.id); } catch (_) {}
  return { added: true, notified };
});

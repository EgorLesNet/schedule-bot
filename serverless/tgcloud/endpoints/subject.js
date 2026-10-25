import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { loadEvents, toOriginal, parseTeacherRoom } from '../lib/schedule.js';
import { loadFiles } from '../lib/files.js';
import { endpoint } from '../lib/auth.js';
import { today } from '../lib/time.js';

// Карточка предмета: ближайшие занятия, постоянная ссылка, ДЗ (актуальные и прошедшие), материалы (файлы ДЗ), личная заметка по предмету.
// Заметок по предметам не больше MAX_NOTES: при превышении самые старые удаляются сами (изменённая заметка считается новой).
const MAX_NOTES = 200;
const fm = (f) => ({ uid: f.uid, name: f.name, kind: f.kind, size: f.size });

export default endpoint(async (input, u) => {
  const user = await store.getUser(u.id);
  if (!user.course || !user.stream) throw new EndpointError('no course');
  const { course, stream } = user;
  const subject = String(input.subject || '').trim().slice(0, 150);
  if (!subject) throw new EndpointError('bad input');
  const original = await toOriginal(course, stream, subject);
  if (original === '__proto__') throw new EndpointError('bad input');
  const nkey = 'subnote:' + u.id;

  if (input.action === 'note') {
    const notes = await store.get(nkey, {});
    const t = String(input.text || '').trim().slice(0, 1000);
    if (t) {
      delete notes[original];
      notes[original] = t;
      const keys = Object.keys(notes);
      for (const old of keys.slice(0, Math.max(0, keys.length - MAX_NOTES))) delete notes[old];
    } else delete notes[original];
    await store.set(nkey, notes);
    return { note: t };
  }

  const day = today();
  const events = await loadEvents(course, stream);
  const hw = await store.loadHw(course, stream);
  const fl = await loadFiles(course, stream);
  const links = await store.loadLinks(course, stream);
  const notes = await store.get(nkey, {});

  const lessons = events
    .filter((e) => e.summary === subject && e.date >= day)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
    .slice(0, 6)
    .map((e) => {
      const tr = parseTeacherRoom(e.desc || '');
      return { date: e.date, start: e.start, end: e.end, teacher: tr.teacher, room: tr.room, link: links[e.original + '|' + e.date + '|' + e.start] || '' };
    });

  const rows = Object.entries(hw)
    .map(([k, text]) => { const i = k.lastIndexOf('|'); return { o: k.slice(0, i), date: k.slice(i + 1), text, files: (fl[k] || []).map(fm) }; })
    .filter((x) => x.o === original)
    .map((x) => ({ date: x.date, text: x.text, files: x.files }));

  return {
    subject,
    link: links[original + '|*'] || '',
    lessons,
    next: rows.filter((x) => x.date >= day).sort((a, b) => a.date.localeCompare(b.date)),
    past: rows.filter((x) => x.date < day).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
    materials: rows.filter((x) => x.files.length).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20),
    note: notes[original] || '',
  };
});

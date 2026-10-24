import * as store from '../lib/store.js';
import { getRenames, toOriginal } from '../lib/schedule.js';
import { applyHw, applyFiles } from '../lib/hwsync.js';
import { takeFromInbox, loadFiles, plain } from '../lib/files.js';
import { notifyStream } from '../lib/notify.js';
import { endpoint } from '../lib/auth.js';
import { canEdit } from '../lib/roles.js';
import { today } from '../lib/time.js';
import { NL } from '../lib/config.js';

const dm = (d) => d.slice(8) + '.' + d.slice(5, 7);

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
      const prev = (await store.loadHw(course, stream))[original + '|' + date];
      const touched = await applyHw(course, stream, original, date, t);
      const ids = Array.isArray(input.files) ? input.files.slice(0, 10).map(String) : [];
      let attached = 0;
      if (ids.length) {
        const items = await takeFromInbox(u.id, ids);
        if (items.length) {
          await applyFiles(course, stream, original, date, 'add', items.map(plain));
          attached = items.length;
        }
      }
      // Мгновенное уведомление потоку (и потокам-двойникам), кроме автора: только если ДЗ новое или изменилось и дата не в прошлом
      if (date >= today() && (prev !== t || attached)) {
        const head = prev === undefined ? '📝 Новое ДЗ' : prev !== t ? '✏️ ДЗ изменено' : '📎 К ДЗ добавлены файлы';
        const msg = head + ': ' + subject + ', ' + dm(date) + NL + t.slice(0, 300) + (attached ? NL + '📎 Файлов: ' + attached : '') + NL + 'Подробности — во вкладке «ДЗ».';
        for (const s of [stream, ...touched]) {
          try { await notifyStream(course, s, msg, u.id, 'hwAlerts'); } catch (e) {}
        }
      }
    } else {
      await applyHw(course, stream, original, date, '');
      await applyFiles(course, stream, original, date, 'clear', []);
    }
  }
  const all = await store.loadHw(course, stream);
  const ren = await getRenames(course, stream);
  const fl = await loadFiles(course, stream);
  return store.futureHw(all, today()).map((x) => ({
    key: x.subject + '|' + x.date,
    subject: ren[x.subject] || x.subject,
    date: x.date,
    text: x.text,
    files: (fl[x.subject + '|' + x.date] || []).map((f) => ({ name: f.name, kind: f.kind, size: f.size })),
  }));
});

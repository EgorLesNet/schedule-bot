import * as store from '../lib/store.js';
import { getRenames, toOriginal } from '../lib/schedule.js';
import { applyHw, applyFiles } from '../lib/hwsync.js';
import { takeFromInbox, loadFiles, plain } from '../lib/files.js';
import { loadHist, pushVersion, moveHist } from '../lib/hwhist.js';
import { notifyStream } from '../lib/notify.js';
import { endpoint } from '../lib/auth.js';
import { canEdit } from '../lib/roles.js';
import { today } from '../lib/time.js';
import { NL } from '../lib/config.js';

const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const PAGE = 20;
const dm = (d) => d.slice(8) + '.' + d.slice(5, 7);
const who = (u) => (u.username ? '@' + u.username : ([u.first_name, u.last_name].filter(Boolean).join(' ') || 'id' + u.id));
const fm = (f) => ({ uid: f.uid, name: f.name, kind: f.kind, size: f.size });

// Мгновенное уведомление потоку (и потокам-двойникам), кроме автора
async function announce(course, stream, touched, u, text) {
  for (const s of [stream, ...touched]) {
    try { await notifyStream(course, s, text, u.id, 'hwAlerts'); } catch (e) {}
  }
}

export default endpoint(async (input, u) => {
  const user = await store.getUser(u.id);
  if (!user.course) throw new Error('no course');
  const { course, stream } = user;
  const act = input.action || 'list';

  if (['add', 'delete', 'edit', 'restore', 'history'].includes(act)) {
    if (!(await canEdit(u.username, user))) throw new Error('forbidden');
    const date = String(input.date || '');
    const subject = String(input.subject || '').trim();
    if (!DATE.test(date) || !subject) throw new Error('bad input');
    const original = await toOriginal(course, stream, subject);
    const hk = original + '|' + date;
    const prev = (await store.loadHw(course, stream))[hk];

    if (act === 'history') {
      const list = ((await loadHist(course, stream))[hk]) || [];
      return { versions: list.map((v, i) => ({ i, t: v.t, by: v.by, text: v.text })).reverse() };
    }

    if (act === 'add') {
      const t = String(input.text || '').trim().slice(0, 1000);
      if (!t) throw new Error('empty text');
      const touched = await applyHw(course, stream, original, date, t);
      await pushVersion(course, stream, hk, t, who(u), prev);
      const ids = Array.isArray(input.files) ? input.files.slice(0, 10).map(String) : [];
      let attached = 0;
      if (ids.length) {
        const items = await takeFromInbox(u.id, ids);
        if (items.length) {
          await applyFiles(course, stream, original, date, 'add', items.map(plain));
          attached = items.length;
        }
      }
      if (date >= today() && (prev !== t || attached)) {
        const head = prev === undefined ? '📝 Новое ДЗ' : prev !== t ? '✏️ ДЗ изменено' : '📎 К ДЗ добавлены файлы';
        await announce(course, stream, touched, u, head + ': ' + subject + ', ' + dm(date) + NL + t.slice(0, 300) + (attached ? NL + '📎 Файлов: ' + attached : '') + NL + 'Подробности — во вкладке «ДЗ».');
      }
    } else if (act === 'delete') {
      await applyHw(course, stream, original, date, '');
      await applyFiles(course, stream, original, date, 'clear', []);
    } else if (act === 'edit') {
      // Правка: текст, дата, удаление отдельных файлов и добавление файлов из «входящих»
      if (prev === undefined) throw new Error('Задание не найдено');
      const t = String(input.text || '').trim().slice(0, 1000);
      if (!t) throw new Error('empty text');
      const newDate = DATE.test(String(input.newDate || '')) ? String(input.newDate) : date;
      const nk = original + '|' + newDate;
      if (newDate !== date && (await store.loadHw(course, stream))[nk] !== undefined) throw new Error('На эту дату уже есть ДЗ по этому предмету');
      const rm = Array.isArray(input.removeFiles) ? input.removeFiles.map(String).slice(0, 20) : [];
      if (rm.length) await applyFiles(course, stream, original, date, 'remove', rm);
      const ids = Array.isArray(input.files) ? input.files.slice(0, 10).map(String) : [];
      let attached = 0;
      if (ids.length) {
        const items = await takeFromInbox(u.id, ids);
        if (items.length) {
          await applyFiles(course, stream, original, date, 'add', items.map(plain));
          attached = items.length;
        }
      }
      let touched;
      if (newDate !== date) {
        const keep = (await loadFiles(course, stream))[hk] || [];
        await applyHw(course, stream, original, date, '');
        touched = await applyHw(course, stream, original, newDate, t);
        await applyFiles(course, stream, original, date, 'clear', []);
        if (keep.length) await applyFiles(course, stream, original, newDate, 'add', keep);
        await moveHist(course, stream, hk, nk);
      } else {
        touched = await applyHw(course, stream, original, date, t);
      }
      await pushVersion(course, stream, nk, t, who(u), prev);
      if (newDate >= today() && (prev !== t || newDate !== date || attached)) {
        const head = newDate !== date ? '📅 ДЗ перенесено: ' + subject + ', ' + dm(date) + ' → ' + dm(newDate) : '✏️ ДЗ изменено: ' + subject + ', ' + dm(newDate);
        await announce(course, stream, touched, u, head + NL + t.slice(0, 300) + (attached ? NL + '📎 Добавлено файлов: ' + attached : '') + NL + 'Подробности — во вкладке «ДЗ».');
      }
    } else {
      // Возврат старой версии текста (вложения не меняются); в истории появляется новая запись
      const list = ((await loadHist(course, stream))[hk]) || [];
      const v = list[Number(input.index)];
      if (!v || prev === undefined) throw new Error('Версия не найдена');
      const touched = await applyHw(course, stream, original, date, v.text);
      await pushVersion(course, stream, hk, v.text, who(u), prev);
      if (date >= today() && prev !== v.text) await announce(course, stream, touched, u, '✏️ ДЗ изменено: ' + subject + ', ' + dm(date) + NL + v.text.slice(0, 300) + NL + 'Подробности — во вкладке «ДЗ».');
    }
  }

  const all = await store.loadHw(course, stream);
  const ren = await getRenames(course, stream);
  const fl = await loadFiles(course, stream);

  if (act === 'archive') {
    // Прошедшие задания: поиск по предмету и тексту, порциями по 20, новые сверху
    const q = String(input.q || '').trim().toLowerCase().slice(0, 60);
    const day = today();
    const rows = Object.entries(all)
      .map(([k, text]) => { const i = k.lastIndexOf('|'); return { orig: k.slice(0, i), date: k.slice(i + 1), text }; })
      .filter((x) => x.date < day)
      .map((x) => ({ key: x.orig + '|' + x.date, subject: ren[x.orig] || x.orig, date: x.date, text: x.text, files: (fl[x.orig + '|' + x.date] || []).map(fm) }))
      .filter((x) => !q || x.subject.toLowerCase().includes(q) || x.text.toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date) || a.subject.localeCompare(b.subject, 'ru'));
    const off = Math.max(0, Number(input.offset) || 0);
    return { items: rows.slice(off, off + PAGE), more: rows.length > off + PAGE, total: rows.length };
  }

  const hist = await loadHist(course, stream);
  return store.futureHw(all, today()).map((x) => {
    const list = hist[x.subject + '|' + x.date] || [];
    const last = list[list.length - 1];
    return {
      key: x.subject + '|' + x.date,
      subject: ren[x.subject] || x.subject,
      date: x.date,
      text: x.text,
      files: (fl[x.subject + '|' + x.date] || []).map(fm),
      edited: list.length > 1 && last && last.t ? { t: last.t, by: last.by } : null,
    };
  });
});

import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { loadEvents, toOriginal } from '../lib/schedule.js';
import { LANG_NAME, langDates } from '../lib/lang.js';
import { applyHw, applyFiles } from '../lib/hwsync.js';
import { takeFromInbox, plain } from '../lib/files.js';
import { notifyStream } from '../lib/notify.js';
import { send } from '../lib/bot.js';
import { endpoint } from '../lib/auth.js';
import { canEdit } from '../lib/roles.js';
import { today } from '../lib/time.js';
import { NL } from '../lib/config.js';

const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const pkey = (c, s) => 'props:' + c + '_' + s;
const fmt = (d) => d.slice(8) + '.' + d.slice(5, 7);

// Уведомляем только тех ассистентов и админа, которые могут править этот поток (с учётом ролей)
async function notifyAssistants(course, stream, text, exceptId) {
  for (const id of await store.get('users', [])) {
    if (id === exceptId) continue;
    try {
      const u = await store.getUser(id);
      if (u.course !== course || u.stream !== stream || !u.username) continue;
      if (!(await canEdit(u.username, u))) continue;
      await send(id, text);
    } catch (e) {}
  }
}

export default endpoint(async (input, u) => {
  const user = await store.getUser(u.id);
  if (!user.course) throw new EndpointError('no course');
  const { course, stream } = user;
  const k = pkey(course, stream);
  let list = await store.get(k, []);
  const assistant = await canEdit(u.username, user);
  const a = input.action;

  if (a === 'add') {
    const date = String(input.date || '');
    const subject = String(input.subject || '').trim();
    const text = String(input.text || '').trim().slice(0, 1000);
    if (!DATE.test(date) || !subject || !text) throw new EndpointError('bad input');
    if (list.filter((p) => p.uid === u.id).length >= 5) throw new EndpointError('too many pending');
    if (list.length >= 100) throw new EndpointError('queue full');
    const events = await loadEvents(course, stream);
    const lang = subject === LANG_NAME && (course === '1' || course === '2') && langDates(events, date).includes(date);
    if (!lang && !events.some((e) => e.date === date && e.summary === subject)) throw new EndpointError('no such lesson');
    const original = await toOriginal(course, stream, subject);
    const ids = Array.isArray(input.files) ? input.files.slice(0, 10).map(String) : [];
    const files = ids.length ? (await takeFromInbox(u.id, ids)).map(plain) : [];
    const id = Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
    list.push({ id, uid: u.id, uname: u.username || '', subject, original, date, text, files, at: Date.now() });
    await store.set(k, list);
    await notifyAssistants(course, stream, '💡 Новое предложение ДЗ: ' + subject + ', ' + fmt(date) + NL + text.slice(0, 200) + (files.length ? NL + '📎 Файлов: ' + files.length : '') + NL + 'Откройте вкладку «ДЗ» в приложении.', u.id);
  } else if (a === 'cancel') {
    list = list.filter((p) => !(p.id === input.id && p.uid === u.id));
    await store.set(k, list);
  } else if (a === 'approve' || a === 'reject') {
    if (!assistant) throw new EndpointError('forbidden');
    const p = list.find((x) => x.id === input.id);
    if (p) {
      list = list.filter((x) => x.id !== p.id);
      await store.set(k, list);
      if (a === 'approve') {
        const t = String(input.text || p.text).trim().slice(0, 1000) || p.text;
        const prev = (await store.loadHw(course, stream))[p.original + '|' + p.date];
        const touched = await applyHw(course, stream, p.original, p.date, t);
        if (p.files && p.files.length) await applyFiles(course, stream, p.original, p.date, 'add', p.files);
        try { await send(p.uid, '✅ Ваше ДЗ принято: ' + p.subject + ', ' + fmt(p.date)); } catch (e) {}
        // Мгновенное уведомление потоку о новом или изменённом ДЗ (кроме ассистента и автора предложения)
        if (p.date >= today() && prev !== t) {
          const msg = (prev === undefined ? '📝 Новое ДЗ' : '✏️ ДЗ изменено') + ': ' + p.subject + ', ' + fmt(p.date) + NL + t.slice(0, 300) + (p.files && p.files.length ? NL + '📎 Файлов: ' + p.files.length : '') + NL + 'Подробности — во вкладке «ДЗ».';
          for (const s of [stream, ...touched]) {
            try { await notifyStream(course, s, msg, [u.id, p.uid], 'hwAlerts'); } catch (e) {}
          }
        }
      } else {
        try { await send(p.uid, '❌ Ваше предложение по ' + p.subject + ' (' + fmt(p.date) + ') отклонено'); } catch (e) {}
      }
    }
  }

  return {
    pending: assistant ? list : [],
    mine: list.filter((p) => p.uid === u.id),
  };
});

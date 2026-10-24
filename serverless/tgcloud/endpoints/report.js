import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { canEdit } from '../lib/roles.js';
import { send } from '../lib/bot.js';
import { endpoint } from '../lib/auth.js';
import { NL } from '../lib/config.js';

// Сообщения об ошибках в парах: студент пишет, ассистенты потока получают заявку и могут отметить «исправлено» или отклонить
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const TIME = /^[0-9]{2}:[0-9]{2}$/;
const rkey = (c, s) => 'reports:' + c + '_' + s;
const dm = (d) => d.slice(8) + '.' + d.slice(5, 7);

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
  if (!user.course || !user.stream) throw new EndpointError('no course');
  const { course, stream } = user;
  const k = rkey(course, stream);
  let list = await store.get(k, []);
  const assistant = await canEdit(u.username, user);
  const a = input.action;

  if (a === 'add') {
    const date = String(input.date || '');
    const start = String(input.start || '');
    const summary = String(input.summary || '').trim().slice(0, 100);
    const text = String(input.text || '').trim().slice(0, 500);
    if (!DATE.test(date) || !TIME.test(start) || !summary || !text) throw new EndpointError('bad input');
    if (list.filter((r) => r.uid === u.id).length >= 3) throw new EndpointError('Уже есть 3 неразобранных сообщения, дождитесь ответа');
    if (list.length >= 50) throw new EndpointError('queue full');
    const id = Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    list.push({ id, uid: u.id, uname: u.username || '', date, start, summary, text, at: Date.now() });
    await store.set(k, list);
    await notifyAssistants(course, stream, '⚠️ Сообщение об ошибке в расписании: ' + summary + ', ' + dm(date) + ' ' + start + NL + text.slice(0, 300) + NL + 'Откройте вкладку «ДЗ» в приложении.', u.id);
  } else if (a === 'resolve') {
    if (!assistant) throw new EndpointError('forbidden');
    const r = list.find((x) => x.id === input.id);
    if (r) {
      list = list.filter((x) => x.id !== r.id);
      await store.set(k, list);
      const msg = input.ok === false
        ? 'ℹ️ Мы проверили ваше сообщение по паре «' + r.summary + '» (' + dm(r.date) + '): изменений не требуется.'
        : '✅ Спасибо! Ошибку в расписании («' + r.summary + '», ' + dm(r.date) + ') исправили.';
      try { await send(r.uid, msg); } catch (e) {}
    }
  }

  return { pending: assistant ? list : [], mine: list.filter((r) => r.uid === u.id).length };
});

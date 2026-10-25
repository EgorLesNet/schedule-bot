import { api, EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { toOriginal } from '../lib/schedule.js';
import { applyFiles } from '../lib/hwsync.js';
import { getInbox, dropInbox, loadFiles, sendFiles } from '../lib/files.js';
import { send } from '../lib/bot.js';
import { endpoint } from '../lib/auth.js';
import { canEdit } from '../lib/roles.js';
import { allow } from '../lib/limit.js';

const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const fmt = (d) => d.slice(8) + '.' + d.slice(5, 7);

async function botName() {
  const cached = await store.get('botname', '');
  if (cached) return cached;
  try {
    const me = await api.getMe();
    if (me && me.username) { await store.set('botname', me.username); return me.username; }
  } catch (e) {}
  return '';
}

export default endpoint(async (input, u) => {
  const a = input.action;
  if (a === 'inbox' || a === 'drop') {
    if (a === 'drop') await dropInbox(u.id, (Array.isArray(input.ids) ? input.ids : []).map(String));
    const items = await getInbox(u.id);
    return { username: await botName(), items: items.map((f) => ({ id: f.id, kind: f.kind, name: f.name, size: f.size })) };
  }
  const user = await store.getUser(u.id);
  if (!user.course) throw new EndpointError('no course');
  const date = String(input.date || '');
  const subject = String(input.subject || '').trim();
  if (!DATE.test(date) || !subject) throw new EndpointError('bad input');
  const original = await toOriginal(user.course, user.stream, subject);
  if (a === 'send') {
    const files = (await loadFiles(user.course, user.stream))[original + '|' + date] || [];
    if (!files.length) throw new EndpointError('Файлов нет');
    // Каждая отправка — до 11 вызовов Telegram: не больше 6 раз за 10 минут на пользователя, чтобы не занимать общий лимит бота
    if (!(await allow(u.id, 'files-send', 6, 600000))) throw new EndpointError('Слишком часто, подождите несколько минут');
    try { await send(u.id, '📎 Файлы к ДЗ: ' + subject + ', ' + fmt(date)); } catch (e) { throw new EndpointError('Откройте чат с ботом, нажмите «Старт» и повторите'); }
    const sent = await sendFiles(u.id, files);
    return { sent, total: files.length };
  }
  if (a === 'clear') {
    if (!(await canEdit(u.username, user))) throw new EndpointError('forbidden');
    await applyFiles(user.course, user.stream, original, date, 'clear', []);
    return { ok: true };
  }
  throw new EndpointError('bad action');
});

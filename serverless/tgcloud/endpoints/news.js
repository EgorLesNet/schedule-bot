import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { allEntries } from '../lib/schedule.js';
import { scopesOf, canEdit } from '../lib/roles.js';
import { endpoint } from '../lib/auth.js';
import { today, addDays } from '../lib/time.js';

// Объявления старост (ассистентов и админа): ключ news в kv. Видны до даты until включительно (МСК), после неё пропадают.
// Зона контроля автора (роли факультет/курс/поток) фиксируется в момент публикации.
const D = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const MAX_TEXT = 500;
const MAX_DAYS = 120;
const MAX_ACTIVE = 20;
const KEEP_DAYS = 7;
const SHOW = 5;

const nameOf = (u) => (u.username ? '@' + u.username : ([u.first_name, u.last_name].filter(Boolean).join(' ') || 'староста'));

// Входит ли поток пользователя (e — запись расписания) в адресаты объявления
function visibleTo(n, user, e) {
  if (n.target === 'stream') return n.course === user.course && n.stream === user.stream;
  if (n.all) return true;
  return (n.scopes || []).some((s) => (!s.faculty || s.faculty === e.faculty) && (!s.course || s.course === e.course) && (!s.stream || s.stream === e.key));
}

export default endpoint(async (input, u) => {
  const day = today();
  const stored = await store.get('news', []);
  let all = stored.filter((n) => n.until >= addDays(day, -KEEP_DAYS));
  let dirty = all.length !== stored.length;
  const a = input.action;
  const user = await store.getUser(u.id);
  const admin = store.isAdmin(u.username);
  const assistant = await store.isAssistant(u.username);

  if (a === 'add') {
    if (!assistant) throw new EndpointError('forbidden');
    const text = String(input.text || '').trim().slice(0, MAX_TEXT);
    const until = String(input.until || '');
    const target = input.target === 'stream' ? 'stream' : 'scope';
    if (!text || !D.test(until)) throw new EndpointError('bad input');
    if (until < day || until > addDays(day, MAX_DAYS)) throw new EndpointError('Дата должна быть от сегодня до ' + MAX_DAYS + ' дней вперёд');
    if (all.filter((n) => n.uid === u.id && n.until >= day).length >= MAX_ACTIVE) throw new EndpointError('Слишком много активных объявлений, удалите ненужные');
    const n = { id: Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), uid: u.id, by: nameOf(u), text, until, at: Date.now(), target };
    if (target === 'stream') {
      if (!user.course || !user.stream) throw new EndpointError('Сначала выберите свой поток в настройках');
      if (!(await canEdit(u.username, user))) throw new EndpointError('Ваш поток вне зоны вашего контроля');
      n.course = user.course;
      n.stream = user.stream;
    } else {
      const scopes = admin ? [] : await scopesOf(u.username);
      n.all = scopes.length === 0;
      n.scopes = scopes;
    }
    all.push(n);
    dirty = true;
  } else if (a === 'delete') {
    const n = all.find((x) => x.id === input.id);
    if (n && (n.uid === u.id || admin)) {
      all = all.filter((x) => x.id !== n.id);
      dirty = true;
    }
  }
  if (dirty) await store.set('news', all);

  const entries = await allEntries();
  const e = entries.find((x) => x.course === user.course && x.key === user.stream);
  const items = e
    ? all.filter((n) => n.until >= day && visibleTo(n, user, e)).sort((x, y) => y.at - x.at).slice(0, SHOW)
      .map((n) => ({ id: n.id, by: n.by, text: n.text, until: n.until }))
    : [];
  const mine = assistant
    ? all.filter((n) => n.uid === u.id && n.until >= day).sort((x, y) => y.at - x.at)
      .map((n) => ({ id: n.id, text: n.text, until: n.until, target: n.target }))
    : [];
  return { items, mine, canPost: assistant };
});

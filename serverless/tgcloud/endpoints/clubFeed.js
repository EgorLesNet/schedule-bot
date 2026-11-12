import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { endpoint } from '../lib/auth.js';
import { allow } from '../lib/limit.js';

const fail = message => { throw new EndpointError(message); };
const txt = (value, max) => String(value || '').trim().slice(0, max);
function eventFields(p, old) {
  const date = p.eventDate === undefined ? old?.eventDate || '' : String(p.eventDate || '').trim();
  const time = p.eventTime === undefined ? old?.eventTime || '' : String(p.eventTime || '').trim();
  if (!date) { if (time) fail('Укажите дату мероприятия или очистите время'); return { eventDate: '', eventTime: '' }; }
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) fail('Некорректная дата мероприятия');
  const parsed = new Date(date + 'T12:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) fail('Такой даты не существует');
  if (time && !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time)) fail('Некорректное время мероприятия');
  return { eventDate: date, eventTime: time };
}
function link(value) {
  let s = txt(value, 2000);
  if (!s) return '';
  if (/[\s\u0000-\u001f\u007f\\<>"']/.test(s)) fail('Некорректная ссылка');
  if (/^@[a-z][a-z0-9_]{3,31}$/i.test(s)) s = 'https://t.me/' + s.slice(1);
  if (!/^https?:\/\//i.test(s)) { if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//')) fail('Нужна ссылка http:// или https://'); s = 'https://' + s; }
  const match = /^(https?):\/\/([^/?#]+)([^\s]*)$/i.exec(s);
  if (!match || match[2].includes('@')) fail('Некорректная ссылка');
  const port = /:([0-9]+)$/.exec(match[2]);
  if (port && (Number(port[1]) < 1 || Number(port[1]) > 65535)) fail('Некорректный порт');
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::[0-9]{1,5})?$/i.test(match[2])) fail('Укажите полный адрес сайта');
  return match[1].toLowerCase() + '://' + match[2].toLowerCase() + match[3];
}
export default endpoint(async (p, u) => {
  const data = await store.get('clubs', null);
  const section = data?.sections?.find(s => s.id === p.section);
  const club = section?.clubs?.find(c => c.id === p.club);
  const admin = store.isAdmin(u.username);
  const manages = Boolean(club && (admin || (Array.isArray(club.leaders) && club.leaders.includes(u.id))));
  if (!club || (data.open === false && !manages)) fail('Клуб недоступен');
  const action = p.action || 'feed';
  if (!['feed', 'feed_add', 'feed_edit', 'feed_delete'].includes(action)) fail('bad action');
  const key = 'clubfeed:' + JSON.stringify([section.id, club.id]);
  let posts = await store.get(key, []);
  if (action !== 'feed') {
    if (!manages) fail('forbidden');
    const old = posts.find(post => post.id === p.id);
    if (action !== 'feed_add' && !old) fail('Анонс не найден');
    if (action === 'feed_delete') posts = posts.filter(post => post !== old);
    else {
      if (action === 'feed_add' && posts.length >= 100) fail('Не больше 100 анонсов. Удалите устаревшие.');
      const title = txt(p.title, 120), body = txt(p.text, 4000), url = link(p.url);
      if (!title || (!body && !url)) fail('Добавьте заголовок и текст или ссылку');
      const event = eventFields(p, old);
      if (!(await allow(u.id, 'club-feed-write', 30, 3600000))) fail('Слишком часто, повторите позже');
      const by = u.username ? '@' + u.username : [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Глава клуба';
      if (old) Object.assign(old, { title, text: body, url, ...event, editedAt: Date.now(), editedBy: by });
      else posts.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 12), title, text: body, url, ...event, at: Date.now(), by });
    }
    await store.set(key, posts);
  }
  let offset = 0;
  if (action === 'feed' && p.before) { const index = posts.findIndex(post => post.id === p.before); if (index < 0) fail('Лента обновилась. Откройте клуб заново.'); offset = index + 1; }
  const items = posts.slice(offset, offset + 20);
  const { leaders, ...publicClub } = club;
  return { club: { ...publicClub, canManage: manages, ...(admin ? { leaders: Array.isArray(leaders) ? leaders : [] } : {}) }, items, next: offset + items.length < posts.length ? items[items.length - 1].id : '' };
});

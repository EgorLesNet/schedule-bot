import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { allEntries } from '../lib/schedule.js';
import { endpoint } from '../lib/auth.js';
import { today, addDays } from '../lib/time.js';

const D = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const nameOf = (u) => u.username ? '@' + u.username : ([u.first_name, u.last_name].filter(Boolean).join(' ') || 'староста');
const key = (e) => JSON.stringify([e.course, e.key]);
const matches = (s, e) => s && typeof s === 'object' &&
  [s.faculty, s.course, s.stream].some((v) => typeof v === 'string' && v.length > 0) &&
  (!s.faculty || s.faculty === e.faculty) && (!s.course || s.course === e.course) && (!s.stream || s.stream === e.key);

// Для объявлений пустые/отсутствующие ограничения не дают глобального доступа.
// Остальные права помощников этот эндпоинт не меняет.
export default endpoint(async (input, u) => {
  const day = today();
  const entries = await allEntries();
  const roles = await store.get('roles', {});
  const assistants = await store.get('assistants', []);
  const bindings = await store.get('idbind', {});
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const allowed = (name, id) => {
    name = String(name || '').toLowerCase();
    if (!own(bindings, name) || bindings[name] !== id) return [];
    if (store.isAdmin(name)) return entries;
    if (!assistants.includes(name)) return [];
    const scopes = own(roles, name) && Array.isArray(roles[name]) ? roles[name] : [];
    return entries.filter((e) => scopes.some((s) => matches(s, e)));
  };
  const user = await store.getUser(u.id);
  const current = entries.find((e) => e.course === user.course && e.key === user.stream);
  const permitted = allowed(u.username, u.id);
  const canPost = !!current && permitted.some((e) => key(e) === key(current));
  const admin = store.isAdmin(u.username);
  const stored = await store.get('news', []);
  let all = stored.filter((n) => n.until >= addDays(day, -7));
  let dirty = all.length !== stored.length;

  if (input.action === 'add') {
    if (input.course !== user.course || input.stream !== user.stream) throw new EndpointError('Курс или поток изменился. Откройте форму заново.');
    if (!canPost) throw new EndpointError('Выбранный поток вне вашей зоны контроля. Администратор должен назначить права на факультет, курс или поток.');
    if (!['scope', 'stream'].includes(input.target)) throw new EndpointError('bad target');
    const text = String(input.text || '').trim().slice(0, 500);
    const until = String(input.until || '');
    if (!text || !D.test(until)) throw new EndpointError('bad input');
    if (until < day || until > addDays(day, 120)) throw new EndpointError('Дата должна быть от сегодня до 120 дней вперёд');
    if (all.filter((n) => n.uid === u.id && n.until >= day).length >= 20) throw new EndpointError('Слишком много активных объявлений, удалите ненужные');
    // Аудитория фиксируется сервером: выбранный курс того же факультета, только разрешённые потоки.
    const recipients = permitted.filter((e) => e.faculty === current.faculty && e.course === current.course &&
      (input.target === 'scope' || e.key === current.key)).map(key);
    all.push({ id: Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36),
      version: 2, uid: u.id, author: String(u.username).toLowerCase(), by: nameOf(u), text, until,
      at: Date.now(), target: input.target, course: current.course, faculty: current.faculty,
      stream: current.key, recipients });
    dirty = true;
  } else if (input.action === 'delete') {
    const n = all.find((x) => x.id === input.id);
    if (n && (n.uid === u.id || admin)) {
      all = all.filter((x) => x.id !== n.id);
      dirty = true;
    }
  } else if (input.action !== 'list') {
    throw new EndpointError('bad action');
  }
  if (dirty) await store.set('news', all);

  // Повторная проверка текущих прав автора: отзыв или сужение роли скрывает объявление.
  // Старые записи без точной аудитории не показываем: выбранный при публикации курс восстановить нельзя.
  const items = current ? all.filter((n) => n.until >= day && n.version === 2 &&
    Array.isArray(n.recipients) && n.recipients.includes(key(current)) &&
    allowed(n.author, n.uid).some((e) => key(e) === key(current)))
    .sort((a, b) => b.at - a.at).slice(0, 5)
    .map((n) => ({ id: n.id, by: n.by, text: n.text, until: n.until })) : [];
  const mine = all.filter((n) => n.uid === u.id && n.until >= day).sort((a, b) => b.at - a.at)
    .map((n) => ({ id: n.id, text: n.text, until: n.until, target: n.target, course: n.course,
      legacy: n.version !== 2 }));
  return { items, mine, canPost, course: current ? current.course : '', stream: current ? current.key : '' };
});

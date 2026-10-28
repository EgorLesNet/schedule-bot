import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { endpoint } from '../lib/auth.js';
import { allEntries, loadEvents, toOriginal } from '../lib/schedule.js';
import { scopesOf } from '../lib/roles.js';
import { getInbox, dropInbox, plain, sendFiles } from '../lib/files.js';
import { allow } from '../lib/limit.js';
const categories = { program: 'Программа курса', assessment: 'Требования к зачёту / экзамену', literature: 'Литература', links: 'Полезные ссылки', other: 'Другие материалы' };
const text = (v, n) => String(v || '').trim().slice(0, n);
const author = (u) => u.username ? '@' + u.username : [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Студент';
const fail = (s) => { throw new EndpointError(s); };
function cleanUrl(v) {
  const s = text(v, 2000);
  if (!s) return '';
  try { const u = new URL(s); if (['https:', 'http:'].includes(u.protocol) && u.hostname && !u.username && !u.password) return u.href; } catch (e) {}
  return fail('Нужна ссылка http:// или https://');
}
export default endpoint(async (p, u) => {
  const user = await store.getUser(u.id);
  if (!user.course || !user.stream || p.course !== user.course || p.stream !== user.stream) fail('Курс или поток изменился. Откройте карточку предмета заново.');
  const entry = (await allEntries()).find((e) => e.course === user.course && e.key === user.stream);
  if (!entry) fail('Расписание не найдено');
  const subject = text(p.subject, 150);
  if (!subject) fail('Укажите предмет');
  const original = await toOriginal(user.course, user.stream, subject);
  const events = await loadEvents(user.course, user.stream);
  if (!events.some((e) => e.original === original || e.summary === subject)) fail('Предмет не найден в выбранном расписании');
  const scopes = await scopesOf(u.username);
  const editor = store.isAdmin(u.username) || ((await store.isAssistant(u.username)) && scopes.some((s) => s &&
    [s.faculty, s.course, s.stream].some((v) => typeof v === 'string' && v.length) &&
    (!s.faculty || s.faculty === entry.faculty) && (!s.course || s.course === entry.course) && (!s.stream || s.stream === entry.key)));
  const key = 'library:' + JSON.stringify([user.course, user.stream, original]);
  let items = await store.get(key, []);
  const a = p.action || 'list';
  const permitted = (x) => x.status === 'published' || editor || x.authorId === u.id;
  if (a === 'send') {
    const x = items.find((x) => x.id === p.id);
    if (!x || !permitted(x)) fail('Материал недоступен');
    if (!x.files.length) fail('Файлов нет');
    if (!(await allow(u.id, 'library-send', 6, 600000))) fail('Слишком часто, повторите позже');
    return { sent: await sendFiles(u.id, x.files), total: x.files.length };
  }
  if (a === 'add' || a === 'edit') {
    const old = a === 'edit' ? items.find((x) => x.id === p.id) : null;
    if (a === 'edit' && (!editor || !old)) fail('forbidden');
    if (a === 'add' && items.length >= 200) fail('Библиотека заполнена: удалите ненужные материалы');
    if (!editor && items.filter((x) => x.authorId === u.id && x.status === 'pending').length >= 10) fail('У вас уже 10 предложений на проверке');
    const title = text(p.title, 160), body = text(p.text, 6000), url = cleanUrl(p.url);
    if (!title || !Object.prototype.hasOwnProperty.call(categories, p.category)) fail('Укажите название и категорию');
    const ids = Array.isArray(p.files) ? [...new Set(p.files.map(String))] : [];
    if (ids.length > 5) fail('Не больше 5 новых файлов');
    const inbox = await getInbox(u.id);
    const attachments = ids.map((id) => inbox.find((f) => f.id === id));
    if (attachments.some((f) => !f)) fail('Файл отсутствует во входящих или срок хранения истёк');
    const keep = old && !p.clearFiles ? old.files : [];
    const fs = [...keep];
    for (const f of attachments.map(plain)) if (!fs.some((x) => x.uid === f.uid)) fs.push(f);
    if (fs.length > 10) fail('Не больше 10 файлов в материале');
    if (!body && !url && !fs.length) fail('Добавьте текст, ссылку или файл');
    if (!(await allow(u.id, 'library-write', 30, 3600000))) fail('Слишком часто, повторите позже');
    const now = Date.now();
    const x = { ...(old || { id: now.toString(36) + Math.random().toString(36).slice(2, 10), authorId: u.id, by: author(u), at: now }),
      title, text: body, url, category: p.category, files: fs, updatedAt: now,
      status: editor ? 'published' : 'pending', pinned: editor && !!p.pinned,
      reviewedBy: editor ? author(u) : '', reason: '' };
    if (old) items = items.map((v) => v === old ? x : v); else items.push(x);
    await store.set(key, items);
    if (ids.length) await dropInbox(u.id, ids);
  } else if (['approve', 'reject', 'pin', 'delete'].includes(a)) {
    const x = items.find((x) => x.id === p.id);
    if (!x) fail('Материал не найден');
    if (a === 'delete') {
      if (!editor && !(x.authorId === u.id && x.status !== 'published')) fail('forbidden');
      items = items.filter((v) => v !== x);
    } else {
      if (!editor) fail('forbidden');
      if (a === 'pin') { if (x.status !== 'published') fail('Материал не опубликован'); x.pinned = !!p.pinned; }
      else {
        if (x.status !== 'pending') fail('Предложение уже рассмотрено');
        x.status = a === 'approve' ? 'published' : 'rejected';
        x.reason = a === 'reject' ? text(p.reason, 500) : '';
        x.reviewedBy = author(u); x.reviewedAt = Date.now();
      }
      x.updatedAt = Date.now();
    }
    await store.set(key, items);
  } else if (a !== 'list') fail('bad action');
  return { editor, categories, items: items.filter(permitted).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.at - a.at)
    .map((x) => ({ id: x.id, title: x.title, text: x.text, url: x.url, category: x.category, by: x.by,
      at: x.at, status: x.status, pinned: x.pinned, reason: x.reason || '', reviewedBy: x.reviewedBy || '',
      mine: x.authorId === u.id, files: x.files.map((f) => ({ name: f.name, kind: f.kind, size: f.size })) })) };
});

import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { endpoint } from '../lib/auth.js';

// Клубы ГАУГН: разделы (по умолчанию «СНО ГАУГН» и «ССК ГАУГН») и клубы в них. Читает любой пользователь, правит только админ из приложения.
// kv clubs = { sections: [{ id, title, clubs: [{ id, name, url, status }] }] }; status: active (работает), paused (приостановлено), closed (закрыт на неопределённый срок).
const KEY = 'clubs';
const STATUS = ['active', 'paused', 'closed'];
const MAX_SECTIONS = 12;
const MAX_CLUBS = 60;
const URL_RE = /^https?:[/][/][^ ]{3,500}$/;

const defaults = () => ({ sections: [{ id: 'sno', title: 'СНО ГАУГН', clubs: [] }, { id: 'ssk', title: 'ССК ГАУГН', clubs: [] }] });
const newId = () => Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
const text = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);

function cleanUrl(v) {
  const url = String(v || '').trim();
  if (!url) return '';
  if (!URL_RE.test(url)) throw new EndpointError('Ссылка должна начинаться с http:// или https://');
  return url;
}

function cleanStatus(v, fallback) {
  const s = String(v || '');
  if (!s) return fallback;
  if (STATUS.indexOf(s) < 0) throw new EndpointError('bad status');
  return s;
}

export default endpoint(async (input, u) => {
  const admin = store.isAdmin(u.username);
  let data = await store.get(KEY, null);
  if (!data || !Array.isArray(data.sections)) data = defaults();
  const a = input.action || 'list';
  if (a === 'list') return { admin, sections: data.sections };
  if (!admin) throw new EndpointError('forbidden');

  if (a === 'section_add') {
    const title = text(input.title, 60);
    if (!title) throw new EndpointError('Введите название раздела');
    if (data.sections.length >= MAX_SECTIONS) throw new EndpointError('Слишком много разделов');
    data.sections.push({ id: newId(), title, clubs: [] });
  } else {
    const sec = data.sections.find((s) => s.id === String(input.section || ''));
    if (!sec) throw new EndpointError('Раздел не найден');
    if (a === 'section_edit') {
      const title = text(input.title, 60);
      if (!title) throw new EndpointError('Введите название раздела');
      sec.title = title;
    } else if (a === 'section_delete') {
      data.sections = data.sections.filter((s) => s !== sec);
    } else if (a === 'club_add') {
      const name = text(input.name, 80);
      if (!name) throw new EndpointError('Введите название клуба');
      if (sec.clubs.length >= MAX_CLUBS) throw new EndpointError('Слишком много клубов в разделе');
      sec.clubs.push({ id: newId(), name, url: cleanUrl(input.url), status: cleanStatus(input.status, 'active') });
    } else if (a === 'club_edit' || a === 'club_delete' || a === 'club_move') {
      const i = sec.clubs.findIndex((c) => c.id === String(input.club || ''));
      if (i < 0) throw new EndpointError('Клуб не найден');
      const c = sec.clubs[i];
      if (a === 'club_edit') {
        const name = text(input.name, 80);
        if (!name) throw new EndpointError('Введите название клуба');
        c.name = name;
        c.url = cleanUrl(input.url);
        c.status = cleanStatus(input.status, c.status);
      } else if (a === 'club_delete') {
        sec.clubs.splice(i, 1);
      } else {
        const j = i + (Number(input.dir) < 0 ? -1 : 1);
        if (j >= 0 && j < sec.clubs.length) { sec.clubs[i] = sec.clubs[j]; sec.clubs[j] = c; }
      }
    } else throw new EndpointError('bad action');
  }
  await store.set(KEY, data);
  return { admin, sections: data.sections };
});

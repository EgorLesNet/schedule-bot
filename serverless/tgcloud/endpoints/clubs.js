import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { endpoint } from '../lib/auth.js';
const text = (v, n) => String(v || '').trim().slice(0, n);
const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const statuses = ['active', 'paused', 'closed'];
function url(v, photo = false) {
  const s = text(v, 2000);
  if (!s) return '';
  try { const u = new URL(s); if ((photo ? u.protocol === 'https:' : ['http:', 'https:'].includes(u.protocol)) && u.hostname && !u.username && !u.password) return u.href; } catch (e) {}
  throw new EndpointError(photo ? 'Фото: нужна публичная HTTPS-ссылка на изображение' : 'Нужна ссылка http:// или https://');
}
function fields(p, old = {}) {
  const name = text(p.name, 80).replace(/\s+/g, ' ');
  if (!name) throw new EndpointError('Введите название клуба');
  const status = p.status || old.status || 'active';
  if (!statuses.includes(status)) throw new EndpointError('bad status');
  return { name, status, url: url(p.url),
    description: p.description === undefined ? old.description || '' : text(p.description, 3000),
    photo: p.photo === undefined ? old.photo || '' : url(p.photo, true) };
}
export default endpoint(async (p, u) => {
  const admin = store.isAdmin(u.username);
  let d = await store.get('clubs', null);
  if (!d || !Array.isArray(d.sections)) d = { open: true, sections: [{ id: 'sno', title: 'СНО ГАУГН', clubs: [] }, { id: 'ssk', title: 'ССК ГАУГН', clubs: [] }] };
  const result = () => ({ admin, open: d.open !== false, sections: d.open === false && !admin ? [] : d.sections });
  const a = p.action || 'list';
  if (a === 'list') return result();
  if (!admin) throw new EndpointError('forbidden');
  if (a === 'visibility') d.open = !!p.open;
  else if (a === 'section_add') {
    const title = text(p.title, 60);
    if (!title || d.sections.length >= 12) throw new EndpointError('Введите название; не больше 12 разделов');
    d.sections.push({ id: id(), title, clubs: [] });
  } else {
    const s = d.sections.find((x) => x.id === p.section);
    if (!s) throw new EndpointError('Раздел не найден');
    if (a === 'section_edit') { const t = text(p.title, 60); if (!t) throw new EndpointError('Введите название'); s.title = t; }
    else if (a === 'section_delete') d.sections = d.sections.filter((x) => x !== s);
    else if (a === 'club_add') {
      if (s.clubs.length >= 60) throw new EndpointError('Не больше 60 клубов в разделе');
      s.clubs.push({ id: id(), ...fields(p) });
    } else {
      const i = s.clubs.findIndex((x) => x.id === p.club);
      if (i < 0) throw new EndpointError('Клуб не найден');
      if (a === 'club_edit') Object.assign(s.clubs[i], fields(p, s.clubs[i]));
      else if (a === 'club_delete') s.clubs.splice(i, 1);
      else if (a === 'club_move') { const j = i + (Number(p.dir) < 0 ? -1 : 1); if (j >= 0 && j < s.clubs.length) [s.clubs[i], s.clubs[j]] = [s.clubs[j], s.clubs[i]]; }
      else throw new EndpointError('bad action');
    }
  }
  await store.set('clubs', d);
  return result();
});

import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { endpoint } from '../lib/auth.js';
import { allow } from '../lib/limit.js';
const text = (v, n) => String(v || '').trim().slice(0, n);
const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
const fail = (s) => { throw new EndpointError(s); };
const statuses = ['active', 'paused', 'closed'];
const leaders = (c) => Array.isArray(c.leaders) ? c.leaders : [];
const photoKey = (s, c) => 'clubphoto:' + JSON.stringify([s.id, c.id]);
function url(v) {
  const s = text(v, 2000);
  if (!s) return '';
  try { const u = new URL(s); if (['http:', 'https:'].includes(u.protocol) && u.hostname && !u.username && !u.password) return u.href; } catch (e) {}
  return fail('Нужна ссылка http:// или https://');
}
function fields(p, old = {}) {
  const name = text(p.name, 80).replace(/\s+/g, ' '), status = p.status || old.status || 'active';
  if (!name || !statuses.includes(status)) fail('Укажите название и допустимый статус');
  const f = { name, status, url: p.url === undefined ? old.url || '' : url(p.url),
    description: p.description === undefined ? old.description || '' : text(p.description, 3000) };
  if (p.photo !== undefined) {
    f.photo = url(p.photo);
    if (f.photo && !f.photo.startsWith('https://')) fail('Фото по ссылке должно использовать HTTPS');
  }
  return f;
}
function cleanLeaders(v) {
  if (!Array.isArray(v) || v.length > 10 || v.some((x) => !Number.isSafeInteger(x) || x <= 0)) fail('Не больше 10 положительных числовых Telegram ID');
  return [...new Set(v)];
}
export default endpoint(async (p, u) => {
  const admin = store.isAdmin(u.username);
  let d = await store.get('clubs', null);
  if (!d || !Array.isArray(d.sections)) d = { open: true, sections: [{ id: 'sno', title: 'СНО ГАУГН', clubs: [] }, { id: 'ssk', title: 'ССК ГАУГН', clubs: [] }] };
  const manages = (c) => admin || leaders(c).includes(u.id);
  const result = () => {
    const sections = d.sections.map((s) => ({ id: s.id, title: s.title,
      clubs: s.clubs.filter((c) => d.open !== false || manages(c)).map((c) => {
        const { leaders: hidden, ...out } = c;
        return { ...out, canManage: manages(c), ...(admin ? { leaders: leaders(c) } : {}) };
      }) })).filter((s) => d.open !== false || admin || s.clubs.length);
    return { admin, open: d.open !== false, canManage: admin || sections.some((s) => s.clubs.some((c) => c.canManage)), sections };
  };
  const a = p.action || 'list';
  if (a === 'list') return result();
  const s = d.sections.find((x) => x.id === p.section);
  const c = s && s.clubs.find((x) => x.id === p.club);
  if (a === 'photo') {
    if (!c || (d.open === false && !manages(c))) fail('Фото недоступно');
    const stored = await store.get(photoKey(s, c), null);
    return stored ? { data: stored.data, version: stored.version } : { data: '', version: '' };
  }
  if (['photo_begin', 'photo_part', 'photo_commit', 'photo_remove'].includes(a)) {
    if (!c || !manages(c)) fail('forbidden');
    const key = photoKey(s, c), stageKey = key + ':stage:' + u.id;
    if (a === 'photo_remove') {
      c.photo = ''; c.photoVersion = '';
      await store.set('clubs', d); await store.set(key, null); await store.set(stageKey, null);
      return result();
    }
    if (a === 'photo_begin') {
      if (!Number.isInteger(p.length) || p.length < 32 || p.length > 80000 || !Number.isInteger(p.count) || p.count !== Math.ceil(p.length / 12000)) fail('Недопустимый размер фото');
      if (!(await allow(u.id, 'club-photo', 10, 600000))) fail('Слишком часто, повторите позже');
      const token = id();
      await store.set(stageKey, { token, at: Date.now(), length: p.length, count: p.count, parts: Array(p.count).fill('') });
      return { token };
    }
    const stage = await store.get(stageKey, null);
    if (!stage || stage.token !== p.token || Date.now() - stage.at > 600000) fail('Загрузка истекла. Выберите фото заново.');
    if (a === 'photo_part') {
      if (!Number.isInteger(p.index) || p.index < 0 || p.index >= stage.count || typeof p.data !== 'string' || p.data.length !== Math.min(12000, stage.length - p.index * 12000)) fail('Некорректная часть фото');
      stage.parts[p.index] = p.data; await store.set(stageKey, stage);
      return { ok: true };
    }
    const data = stage.parts.join('');
    if (stage.parts.some((x) => !x) || data.length !== stage.length || !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(data)) fail('Ожидается сжатое JPEG-фото');
    const version = id();
    await store.set(key, { data, version });
    c.photo = ''; c.photoVersion = version;
    await store.set('clubs', d); await store.set(stageKey, null);
    return result();
  }
  if (a === 'club_edit') {
    if (!c || !manages(c)) fail('forbidden');
    if (!admin && p.leaders !== undefined) fail('Назначать глав клуба может только администратор');
    const next = fields(p, c);
    if (admin && p.leaders !== undefined) next.leaders = cleanLeaders(p.leaders);
    Object.assign(c, next);
    if (p.photo !== undefined) { c.photoVersion = ''; await store.set(photoKey(s, c), null); }
  } else {
    if (!admin) fail('forbidden');
    if (a === 'visibility') d.open = !!p.open;
    else if (a === 'section_add') {
      const title = text(p.title, 60);
      if (!title || d.sections.length >= 12) fail('Введите название; не больше 12 разделов');
      d.sections.push({ id: id(), title, clubs: [] });
    } else {
      if (!s) fail('Раздел не найден');
      if (a === 'section_edit') { const title = text(p.title, 60); if (!title) fail('Введите название'); s.title = title; }
      else if (a === 'section_delete') {
        for (const x of s.clubs) await store.set(photoKey(s, x), null);
        d.sections = d.sections.filter((x) => x !== s);
      } else if (a === 'club_add') {
        if (s.clubs.length >= 60) fail('Не больше 60 клубов в разделе');
        s.clubs.push({ id: id(), ...fields(p), leaders: cleanLeaders(p.leaders || []) });
      } else {
        if (!c) fail('Клуб не найден');
        const i = s.clubs.indexOf(c);
        if (a === 'club_delete') { await store.set(photoKey(s, c), null); s.clubs.splice(i, 1); }
        else if (a === 'club_move') { const j = i + (Number(p.dir) < 0 ? -1 : 1); if (j >= 0 && j < s.clubs.length) [s.clubs[i], s.clubs[j]] = [s.clubs[j], s.clubs[i]]; }
        else fail('bad action');
      }
    }
  }
  await store.set('clubs', d);
  return result();
});

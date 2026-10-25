import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { collectStats } from '../lib/stats.js';
import { allEntries } from '../lib/schedule.js';
import { facultyList } from '../lib/faculties.js';
import { endpoint } from '../lib/auth.js';

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

async function listView() {
  const names = await store.get('assistants', []);
  const roles = await store.get('roles', {});
  return { assistants: names.map((n) => ({ name: n, scopes: has(roles, n) ? roles[n] : [] })) };
}

// Админ-панель Mini App (только админ): статистика активности, ассистенты и их роли (ограничения по факультету, курсу, потоку).
// Ник как в Telegram: начинается с буквы, дальше буквы, цифры и подчёркивание (так не получится добавить служебные имена вроде __proto__).
export default endpoint(async (input, u) => {
  if (!store.isAdmin(u.username)) throw new EndpointError('forbidden');
  const a = input.action;
  if (a === 'stats') return collectStats();
  if (a === 'assistants') return listView();
  if (a === 'assistant_add' || a === 'assistant_del' || a === 'role_set') {
    const uname = String(input.username || '').split('@').join('').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{2,31}$/.test(uname)) throw new EndpointError('bad username');
    let list = await store.get('assistants', []);
    const roles = await store.get('roles', {});
    if (a === 'assistant_add') {
      list = list.filter((x) => x !== uname);
      list.push(uname);
    } else if (a === 'assistant_del') {
      list = list.filter((x) => x !== uname);
      delete roles[uname];
    } else {
      if (!list.includes(uname)) throw new EndpointError('not an assistant');
      const entries = await allEntries();
      const faculties = facultyList(entries);
      const courses = new Set(entries.map((e) => e.course));
      const keys = new Set(entries.map((e) => e.key));
      const scopes = [];
      for (const s of Array.isArray(input.scopes) ? input.scopes.slice(0, 30) : []) {
        const faculty = String((s && s.faculty) || '');
        const course = String((s && s.course) || '');
        const stream = String((s && s.stream) || '');
        if (faculty && !faculties.includes(faculty)) throw new EndpointError('bad faculty');
        if (course && !courses.has(course)) throw new EndpointError('bad course');
        if (stream && !keys.has(stream)) throw new EndpointError('bad stream');
        if (!faculty && !course && !stream) { scopes.length = 0; break; }
        scopes.push({ faculty, course, stream });
      }
      if (scopes.length) roles[uname] = scopes; else delete roles[uname];
    }
    await store.set('assistants', list);
    await store.set('roles', roles);
    return listView();
  }
  throw new EndpointError('bad action');
});

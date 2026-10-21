import * as store from './store.js';
import { allEntries } from './schedule.js';

// Роли ассистентов: roles[username] = [{ faculty, course, stream }, ...]; пустое поле = «любой», нет записи = полный доступ
export async function scopesOf(uname) {
  const roles = await store.get('roles', {});
  return roles[String(uname || '').toLowerCase()] || [];
}

// Может ли пользователь править расписание, ДЗ и ссылки на потоке, выбранном у него в профиле
export async function canEdit(uname, user) {
  if (store.isAdmin(uname)) return true;
  if (!(await store.isAssistant(uname))) return false;
  const scopes = await scopesOf(uname);
  if (!scopes.length) return true;
  if (!user || !user.course || !user.stream) return false;
  const e = (await allEntries()).find((x) => x.course === user.course && x.key === user.stream);
  if (!e) return false;
  return scopes.some((s) => (!s.faculty || s.faculty === e.faculty) && (!s.course || s.course === e.course) && (!s.stream || s.stream === e.key));
}

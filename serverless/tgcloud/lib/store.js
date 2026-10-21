import { db } from 'sdk';
import { eq } from 'sdk/db';
import { kv } from '../schema.js';
import { ADMIN_USERNAME } from './config.js';

export async function get(key, fallback = null) {
  const row = await db.select().from(kv).where(eq(kv.key, key)).get();
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch (e) { return fallback; }
}

export async function set(key, val) {
  const value = JSON.stringify(val);
  const updatedAt = Date.now();
  await db.insert(kv).values({ key, value, updatedAt }).onConflictDoUpdate({ target: kv.key, set: { value, updatedAt } }).run();
}

export const getUser = (id) => get('user:' + id, {});

export async function saveUser(id, patch) {
  const u = Object.assign({}, await getUser(id), patch);
  await set('user:' + id, u);
  const idx = await get('users', []);
  if (!idx.includes(id)) { idx.push(id); await set('users', idx); }
  return u;
}

const TOUCH_MS = 600000;

// Отмечает активность пользователя (не чаще раза в 10 минут): seen — последний заход, since — первый
export async function touch(id) {
  const u = await getUser(id);
  const now = Date.now();
  if (u.seen && now - u.seen < TOUCH_MS) return u;
  return saveUser(id, { seen: now, since: u.since || now });
}

const hwKey = (c, s) => 'hw:' + c + '_' + s;
export const loadHw = (c, s) => get(hwKey(c, s), {});
export const saveHw = (c, s, d) => set(hwKey(c, s), d);

const linkKey = (c, s) => 'links:' + c + '_' + s;
export const loadLinks = (c, s) => get(linkKey(c, s), {});
export const saveLinks = (c, s, d) => set(linkKey(c, s), d);

export function futureHw(all, from) {
  return Object.entries(all).map(([k, text]) => {
    const i = k.lastIndexOf('|');
    return { subject: k.slice(0, i), date: k.slice(i + 1), text };
  }).filter((x) => x.date >= from).sort((a, b) => a.date.localeCompare(b.date) || a.subject.localeCompare(b.subject));
}

export const isAdmin = (uname) => !!uname && uname.toLowerCase() === ADMIN_USERNAME;

export async function isAssistant(uname) {
  if (!uname) return false;
  if (isAdmin(uname)) return true;
  return (await get('assistants', [])).includes(uname.toLowerCase());
}

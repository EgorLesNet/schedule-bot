import { db } from 'sdk';
import { eq, gt, notLike, and, asc } from 'sdk/db';
import { kv } from '../schema.js';
import * as store from './store.js';

// Резервные копии всей базы (таблица kv): снимок целиком, кроме кэшей (cache:) и самих копий (backup:). Хранятся 2 суток.
// Старые копии удаляются при создании новой, так что хотя бы одна копия есть всегда.
// Платформа ограничивает процессорное время вызова (порядка 3 секунд, по замерам сообщества) и память, поэтому копия делается постранично:
// строки читаются порциями по PAGE по ключу, кэши и старые копии даже не загружаются, а каждая часть (~CHUNK символов) записывается сразу, без одной огромной строки.
// Формат fmt: 2 — каждая часть это отдельный JSON-массив строк [[key, value, updatedAt], ...]. Копии старого формата (одна строка, разбитая на части) по-прежнему читаются.
export const KEEP_MS = 2 * 86400000;
const CHUNK = 60000;
const PAGE = 100;
const skip = (k) => k.startsWith('cache:') || k.startsWith('backup:');

async function pageRows(after) {
  return db.select().from(kv)
    .where(and(gt(kv.key, after), notLike(kv.key, 'cache:%'), notLike(kv.key, 'backup:%')))
    .orderBy(asc(kv.key)).limit(PAGE).all();
}

async function putRaw(key, value) {
  const updatedAt = Date.now();
  await db.insert(kv).values({ key, value, updatedAt }).onConflictDoUpdate({ target: kv.key, set: { value, updatedAt } }).run();
}

async function getRaw(key) {
  const row = await db.select().from(kv).where(eq(kv.key, key)).get();
  return row ? row.value : '';
}

async function delRaw(key) {
  try { await db.delete(kv).where(eq(kv.key, key)).run(); } catch (e) { await putRaw(key, ''); }
}

export const backupId = (ts) => ts.toString(36);

export async function listBackups() {
  return store.get('backup:index', []);
}

export async function pruneBackups() {
  const now = Date.now();
  const index = await listBackups();
  const keep = index.filter((b) => now - b.ts <= KEEP_MS);
  const drop = index.filter((b) => now - b.ts > KEEP_MS);
  for (const b of drop) for (let i = 0; i < b.parts; i++) await delRaw('backup:' + b.ts + ':' + i);
  if (drop.length) await store.set('backup:index', keep);
  return drop.length;
}

export async function createBackup(label) {
  const ts = Date.now();
  let after = '';
  let keys = 0;
  let bytes = 0;
  let parts = 0;
  let buf = [];
  let size = 0;
  const flush = async () => {
    if (!buf.length) return;
    await putRaw('backup:' + ts + ':' + parts, JSON.stringify(buf));
    parts++;
    buf = [];
    size = 0;
  };
  for (;;) {
    const rows = await pageRows(after);
    if (!rows.length) break;
    for (const r of rows) {
      const len = r.key.length + r.value.length;
      if (buf.length && size + len > CHUNK) await flush();
      buf.push([r.key, r.value, r.updatedAt]);
      size += len;
      bytes += len;
      keys++;
    }
    after = rows[rows.length - 1].key;
    if (rows.length < PAGE) break;
  }
  await flush();
  if (!parts) { await putRaw('backup:' + ts + ':0', '[]'); parts = 1; }
  const index = (await listBackups()).filter((b) => b.ts !== ts);
  index.push({ ts, label, keys, bytes, parts, fmt: 2 });
  await store.set('backup:index', index);
  const pruned = await pruneBackups();
  return { id: backupId(ts), ts, keys, bytes, parts, pruned };
}

async function applyRows(rows) {
  let n = 0;
  for (const [key, value, updatedAt] of rows) {
    if (skip(key)) continue;
    await db.insert(kv).values({ key, value, updatedAt }).onConflictDoUpdate({ target: kv.key, set: { value, updatedAt } }).run();
    n++;
  }
  return n;
}

// Восстановление: значения из копии записываются поверх текущих. Ключи, появившиеся после копии, остаются. Перед записью делается ещё одна копия.
export async function restoreBackup(ts) {
  const b = (await listBackups()).find((x) => x.ts === ts);
  if (!b) return null;
  if (b.fmt === 2) {
    const all = [];
    for (let i = 0; i < b.parts; i++) all.push(JSON.parse(await getRaw('backup:' + ts + ':' + i)));
    await createBackup('before-restore');
    let n = 0;
    for (const rows of all) n += await applyRows(rows);
    return { restored: n };
  }
  let text = '';
  for (let i = 0; i < b.parts; i++) text += await getRaw('backup:' + ts + ':' + i);
  const rows = JSON.parse(text);
  await createBackup('before-restore');
  return { restored: await applyRows(rows) };
}

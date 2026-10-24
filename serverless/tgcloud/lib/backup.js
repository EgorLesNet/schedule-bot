import { db } from 'sdk';
import { eq } from 'sdk/db';
import { kv } from '../schema.js';
import * as store from './store.js';

// Резервные копии всей базы (таблица kv): снимок целиком, кроме кэшей (cache:) и самих копий (backup:). Хранятся 2 суток.
// Старые копии удаляются при создании новой, так что хотя бы одна копия есть всегда.
export const KEEP_MS = 2 * 86400000;
const CHUNK = 100000;
const skip = (k) => k.startsWith('cache:') || k.startsWith('backup:');

async function allRows() {
  const q = db.select().from(kv);
  return typeof q.all === 'function' ? await q.all() : await q;
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
  const rows = (await allRows()).filter((r) => !skip(r.key));
  const text = JSON.stringify(rows.map((r) => [r.key, r.value, r.updatedAt]));
  const parts = Math.max(1, Math.ceil(text.length / CHUNK));
  for (let i = 0; i < parts; i++) await putRaw('backup:' + ts + ':' + i, text.slice(i * CHUNK, (i + 1) * CHUNK));
  const index = (await listBackups()).filter((b) => b.ts !== ts);
  index.push({ ts, label, keys: rows.length, bytes: text.length, parts });
  await store.set('backup:index', index);
  const pruned = await pruneBackups();
  return { id: backupId(ts), ts, keys: rows.length, bytes: text.length, parts, pruned };
}

// Восстановление: значения из копии записываются поверх текущих. Ключи, появившиеся после копии, остаются. Перед записью делается ещё одна копия.
export async function restoreBackup(ts) {
  const b = (await listBackups()).find((x) => x.ts === ts);
  if (!b) return null;
  let text = '';
  for (let i = 0; i < b.parts; i++) text += await getRaw('backup:' + ts + ':' + i);
  const rows = JSON.parse(text);
  await createBackup('before-restore');
  let n = 0;
  for (const [key, value, updatedAt] of rows) {
    if (skip(key)) continue;
    await db.insert(kv).values({ key, value, updatedAt }).onConflictDoUpdate({ target: kv.key, set: { value, updatedAt } }).run();
    n++;
  }
  return { restored: n };
}

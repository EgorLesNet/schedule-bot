import { db, EndpointError } from 'sdk';
import { eq } from 'sdk/db';
import { kv } from '../schema.js';
import * as store from '../lib/store.js';

const KEY = 'backup:recovery-session';
const denied = () => { throw new EndpointError('recovery refused'); };
const validId = (value) => typeof value === 'string' && /^[a-z0-9]{1,32}$/.test(value);

export default async function (input, ctx) {
  if (ctx?.initData?.user?.id !== 1) denied();
  const body = input || {};
  const id = body.id;
  if (!validId(id)) denied();
  const session = await store.get(KEY, null);
  if (body.action === 'begin') {
    if (session || body.confirm !== 'ISOLATED_EMPTY_INSTANCE') denied();
    if ((await db.select().from(kv).limit(1).all()).length) denied();
    await store.set(KEY, { id, closed: false });
    return { ready: id };
  }
  if (!session || session.id !== id || session.closed) denied();
  if (body.action === 'finish') {
    await store.set(KEY, { id, closed: true });
    return { closed: id };
  }
  const rows = body.rows;
  if (body.action !== 'insert' || !Array.isArray(rows) || !rows.length || rows.length > 100) denied();
  const seen = new Set();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 3) denied();
    const [key, value, updatedAt] = row;
    if (typeof key !== 'string' || !key || key.startsWith('backup:') || key.startsWith('cache:') || seen.has(key) || typeof value !== 'string' || !Number.isSafeInteger(updatedAt)) denied();
    seen.add(key);
  }
  for (const [key, value, updatedAt] of rows) {
    await db.insert(kv).values({ key, value, updatedAt }).onConflictDoNothing().run();
    const saved = await db.select().from(kv).where(eq(kv.key, key)).get();
    if (!saved || saved.value !== value || saved.updatedAt !== updatedAt) denied();
  }
  return { accepted: rows.length };
}

import { db, EndpointError } from 'sdk';
import { eq } from 'sdk/db';
import { kv } from '../schema.js';
import * as store from '../lib/store.js';
import { endpoint } from '../lib/auth.js';
import { backupId, listBackups } from '../lib/backup.js';

// Export only completed, indexed snapshots. Use the same authorization as backup creation.
export default endpoint(async (input, user) => {
  if (user.id !== 1 && !store.isAdmin(user.username)) throw new EndpointError('forbidden');
  const snapshots = (await listBackups()).filter((item) => item.fmt === 2);
  if (input.action === 'list') {
    return { snapshots: snapshots.map(({ ts, keys, parts }) => ({ id: backupId(ts), ts, keys, parts })) };
  }
  if (input.action !== 'part' || typeof input.id !== 'string' || !Number.isSafeInteger(input.part) || input.part < 0) {
    throw new EndpointError('bad input');
  }
  const snapshot = snapshots.find(({ ts }) => backupId(ts) === input.id);
  if (!snapshot || input.part >= snapshot.parts) throw new EndpointError('snapshot part not found');
  const key = 'backup:' + snapshot.ts + ':' + input.part;
  const row = await db.select().from(kv).where(eq(kv.key, key)).get();
  if (!row || !row.value) throw new EndpointError('snapshot part unavailable');
  return { id: input.id, part: input.part, rows: JSON.parse(row.value) };
});

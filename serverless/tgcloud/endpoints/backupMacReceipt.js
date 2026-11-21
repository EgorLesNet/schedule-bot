import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { backupId, listBackups } from '../lib/backup.js';
import { ADMIN_USERNAME } from '../lib/config.js';
import { send } from '../lib/bot.js';

const hex = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
function equal(a, b) {
  if (!hex(a) || !hex(b)) return false;
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async function (input) {
  const body = input || {};
  if (!equal(body.token, await store.get('backup:mac-token', ''))) throw new EndpointError('forbidden');
  const { id, keys, attachments, sha256 } = body;
  if (typeof id !== 'string' || !/^[a-z0-9]{1,32}$/.test(id) || !hex(sha256) || !Number.isSafeInteger(attachments) || attachments < 0) throw new EndpointError('bad input');
  const snapshot = (await listBackups()).find((entry) => backupId(entry.ts) === id);
  if (!snapshot || keys !== snapshot.keys) throw new EndpointError('snapshot mismatch');
  const previous = await store.get('backup:mac-receipts', []);
  const old = previous.find((entry) => entry.id === id);
  if (old?.sha256 === sha256 && old.attachments === attachments) return { accepted: id };
  const receipt = { id, ts: snapshot.ts, keys, attachments, sha256, verifiedAt: Date.now() };
  await store.set('backup:mac-receipts', [receipt, ...previous.filter((entry) => entry.id !== id)].slice(0, 100));
  if (!old || old.sha256 !== sha256) {
    const bindings = await store.get('idbind', {});
    const admin = bindings[ADMIN_USERNAME];
    if (Number.isSafeInteger(admin) && admin > 1) {
      try { await send(admin, 'Бэкап проверен и сохранён на iMac: ' + id + '\nЗаписей: ' + keys + ', вложений: ' + attachments); } catch (_) {}
    }
  }
  return { accepted: id };
}

import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { createBackup } from '../lib/backup.js';
import backupExport from './backupExport.js';

const KEY = 'backup:mac-token';
const valid = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
function matches(a, b) {
  if (!valid(a) || !valid(b)) return false;
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async function (input, ctx) {
  const body = input || {};
  if (body.action === 'configure') {
    if (ctx?.initData?.user?.id !== 1 || !valid(body.token)) throw new EndpointError('forbidden');
    await store.set(KEY, body.token);
    return { configured: true };
  }
  if (!matches(body.token, await store.get(KEY, ''))) throw new EndpointError('forbidden');
  if (body.action === 'create') {
    const result = await createBackup('imac');
    return { id: result.id };
  }
  return backupExport({ action: body.action, id: body.id, part: body.part }, { initData: { user: { id: 1 } } });
}

import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';

// Only authenticated CLI execution; callers must verify the iMac signature first.
// verifiedAt is the first import time, not a new disk check on every workflow run.
export default async function (input, ctx) {
  if (ctx?.initData?.user?.id !== 1) throw new EndpointError('forbidden');
  const r = input || {};
  if (!/^[a-z0-9]{1,32}$/.test(r.id || '') || !/^[a-f0-9]{64}$/.test(r.sha256 || '') || !Number.isSafeInteger(r.ts) || r.ts <= 0 || r.id !== r.ts.toString(36) || !Number.isSafeInteger(r.keys) || r.keys < 0 || !Number.isSafeInteger(r.attachments) || r.attachments < 0) throw new EndpointError('bad receipt');
  const old = await store.get('backup:mac-receipts', []);
  const existing = old.find(x => x.id === r.id);
  if (existing) {
    if (['ts', 'keys', 'attachments', 'sha256'].some(k => existing[k] !== r[k])) throw new EndpointError('receipt conflict');
    return { accepted:r.id };
  }
  const receipt = { id:r.id, ts:r.ts, keys:r.keys, attachments:r.attachments, sha256:r.sha256, verifiedAt:Date.now() };
  await store.set('backup:mac-receipts', [receipt, ...old].sort((a,b)=>b.ts-a.ts).slice(0,100));
  return { accepted:r.id };
}

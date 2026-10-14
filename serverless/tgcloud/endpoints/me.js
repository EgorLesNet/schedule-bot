import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { endpoint } from '../lib/auth.js';

export default endpoint(async (input, u) => {
  const k = 'ud:' + u.id;
  const me = Object.assign({ done: [], notes: {}, favs: [] }, await store.get(k, {}));
  const a = input.action;
  if (a === 'done') {
    const key = String(input.key || '').slice(0, 300);
    if (!key) throw new EndpointError('bad input');
    me.done = me.done.filter((x) => x !== key);
    if (input.value) me.done.push(key);
    if (me.done.length > 500) me.done = me.done.slice(-500);
  } else if (a === 'note') {
    const key = String(input.key || '').slice(0, 300);
    if (!key) throw new EndpointError('bad input');
    const t = String(input.text || '').trim().slice(0, 500);
    if (t) me.notes[key] = t; else delete me.notes[key];
  } else if (a === 'fav') {
    const s = String(input.subject || '').slice(0, 200);
    if (!s) throw new EndpointError('bad input');
    me.favs = me.favs.filter((x) => x !== s);
    if (input.value) me.favs.push(s);
  }
  if (a === 'done' || a === 'note' || a === 'fav') await store.set(k, me);
  return me;
});

import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { endpoint } from '../lib/auth.js';

// Личные данные пользователя. Размеры ограничены: заметок не больше MAX_NOTES, избранного MAX_FAVS, отметок «сделано» MAX_DONE.
const MAX_NOTES = 200;
const MAX_FAVS = 100;
const MAX_DONE = 500;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const badKey = (k) => !k || k === '__proto__';

export default endpoint(async (input, u) => {
  const k = 'ud:' + u.id;
  const me = Object.assign({ done: [], notes: {}, favs: [] }, await store.get(k, {}));
  const a = input.action;
  if (a === 'done') {
    const key = String(input.key || '').slice(0, 300);
    if (badKey(key)) throw new EndpointError('bad input');
    me.done = me.done.filter((x) => x !== key);
    if (input.value) me.done.push(key);
    if (me.done.length > MAX_DONE) me.done = me.done.slice(-MAX_DONE);
  } else if (a === 'note') {
    const key = String(input.key || '').slice(0, 300);
    if (badKey(key)) throw new EndpointError('bad input');
    const t = String(input.text || '').trim().slice(0, 500);
    if (t) {
      if (!has(me.notes, key) && Object.keys(me.notes).length >= MAX_NOTES) throw new EndpointError('Слишком много заметок, удалите ненужные');
      me.notes[key] = t;
    } else delete me.notes[key];
  } else if (a === 'fav') {
    const s = String(input.subject || '').slice(0, 200);
    if (!s) throw new EndpointError('bad input');
    me.favs = me.favs.filter((x) => x !== s);
    if (input.value) me.favs.push(s);
    if (me.favs.length > MAX_FAVS) me.favs = me.favs.slice(-MAX_FAVS);
  }
  if (a === 'done' || a === 'note' || a === 'fav') await store.set(k, me);
  return me;
});

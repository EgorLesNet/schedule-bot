import * as store from './store.js';

// История версий ДЗ: kv hwhist:<курс>_<поток> → { 'предмет|дата': [{ t, by, text }] }, до 15 версий на задание.
// t = 0 — версия, сохранённая до появления истории (автор и время неизвестны).
const key = (c, s) => 'hwhist:' + c + '_' + s;
const MAX = 15;

export const loadHist = (c, s) => store.get(key(c, s), {});

export async function pushVersion(c, s, hk, text, by, prev) {
  const all = await loadHist(c, s);
  const list = all[hk] || [];
  if (!list.length && prev !== undefined && prev !== text) list.push({ t: 0, by: '', text: prev });
  if (list.length && list[list.length - 1].text === text) return;
  list.push({ t: Date.now(), by, text });
  all[hk] = list.slice(-MAX);
  await store.set(key(c, s), all);
}

export async function moveHist(c, s, from, to) {
  const all = await loadHist(c, s);
  if (!all[from]) return;
  all[to] = (all[to] || []).concat(all[from]).slice(-MAX);
  delete all[from];
  await store.set(key(c, s), all);
}

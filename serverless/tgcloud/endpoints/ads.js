import * as store from '../lib/store.js';
import { getText } from '../lib/http.js';
import { API_TREE, BASE, TTL } from '../lib/config.js';
import { endpoint } from '../lib/auth.js';

const AD_RE = /^docs\/ads\/(ad[0-9]+)[.](png|jpe?g|webp|gif)$/i;

async function listAds(force) {
  const c = await store.get('cache:ads');
  if (c && !force && Date.now() - c.at < TTL) return c.data;
  try {
    const tree = JSON.parse(await getText(API_TREE)).tree || [];
    const seen = new Set();
    const data = [];
    for (const it of tree) {
      if (it.type !== 'blob') continue;
      const m = AD_RE.exec(it.path);
      if (!m) continue;
      const id = m[1].toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      data.push({ id, path: it.path });
    }
    data.sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)));
    await store.set('cache:ads', { at: Date.now(), data });
    return data;
  } catch (e) {}
  return c ? c.data : [];
}

// Список рекламных картинок (docs/ads/ad1.*, ad2.*, ...) со ссылками; ссылки меняет только админ
export default endpoint(async (input, u) => {
  const admin = store.isAdmin(u.username);
  const links = await store.get('ads:links', {});
  if (input.action === 'set') {
    if (!admin) throw new Error('only admin');
    const id = String(input.id || '').toLowerCase();
    const url = String(input.url || '').trim();
    if (!/^ad[0-9]+$/.test(id)) throw new Error('bad id');
    if (url && !/^https?:\/\/\S+$/i.test(url)) throw new Error('link must start with http:// or https://');
    if (url) links[id] = url; else delete links[id];
    await store.set('ads:links', links);
  }
  const list = await listAds(input.action === 'refresh' && admin);
  return {
    admin,
    ads: list.map((a) => ({ id: a.id, src: BASE + '/' + a.path.split('/').map(encodeURIComponent).join('/'), url: links[a.id] || '' })),
  };
});

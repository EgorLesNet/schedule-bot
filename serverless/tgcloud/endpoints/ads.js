import * as store from '../lib/store.js';
import { getText } from '../lib/http.js';
import { API_TREE, BASE } from '../lib/config.js';
import { today, addDays } from '../lib/time.js';
import { endpoint } from '../lib/auth.js';

const AD_RE = /^docs\/ads\/(ad[0-9]+)[.](png|jpe?g|webp|gif)$/i;
const ADS_TTL = 300000;

async function listAds(force) {
  const c = await store.get('cache:ads2');
  if (c && !force && Date.now() - c.at < ADS_TTL) return c.data;
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
      data.push({ id, path: it.path, sha: it.sha || '' });
    }
    data.sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)));
    await store.set('cache:ads2', { at: Date.now(), data });
    return data;
  } catch (e) {}
  return c ? c.data : [];
}

// Ссылка привязана к версии картинки (sha файла): если картинку заменили, старая ссылка не остаётся
function urlFor(links, a) {
  const l = links[a.id];
  return l && typeof l === 'object' && l.sha === a.sha ? l.url : '';
}

// Счётчики от клиента: только известные id, целые положительные, с потолком на один запрос
function clean(o, max) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  for (const [k, v] of Object.entries(o)) {
    const id = String(k).toLowerCase();
    const n = Math.floor(Number(v));
    if (/^ad[0-9]+$/.test(id) && n > 0) out[id] = Math.min(n, max);
  }
  return out;
}

// Показы и клики за 7 и 30 дней (данные хранятся по дням: adstat:<дата>)
async function adStats() {
  const out = {};
  const t = today();
  for (let i = 0; i < 30; i++) {
    const day = await store.get('adstat:' + addDays(t, -i), null);
    if (!day) continue;
    for (const [id, s] of Object.entries(day)) {
      const o = out[id] || (out[id] = { v7: 0, c7: 0, v30: 0, c30: 0 });
      o.v30 += s.v || 0;
      o.c30 += s.c || 0;
      if (i < 7) { o.v7 += s.v || 0; o.c7 += s.c || 0; }
    }
  }
  return out;
}

// Список рекламных картинок (docs/ads/ad1.*, ad2.*, ...) со ссылками; ссылки меняет и статистику видит только админ
export default endpoint(async (input, u) => {
  const admin = store.isAdmin(u.username);
  if (input.action === 'track') {
    const views = clean(input.views, 120);
    const clicks = clean(input.clicks, 10);
    if (Object.keys(views).length || Object.keys(clicks).length) {
      const key = 'adstat:' + today();
      const day = await store.get(key, {});
      for (const [id, n] of Object.entries(views)) { day[id] = day[id] || { v: 0, c: 0 }; day[id].v += n; }
      for (const [id, n] of Object.entries(clicks)) { day[id] = day[id] || { v: 0, c: 0 }; day[id].c += n; }
      await store.set(key, day);
    }
    return { ok: true };
  }
  if (input.action === 'stats') {
    if (!admin) throw new Error('only admin');
    return { stats: await adStats() };
  }
  const links = await store.get('ads:links', {});
  let list;
  if (input.action === 'set') {
    if (!admin) throw new Error('only admin');
    const id = String(input.id || '').toLowerCase();
    const url = String(input.url || '').trim();
    if (!/^ad[0-9]+$/.test(id)) throw new Error('bad id');
    if (url && !/^https?:\/\/\S+$/i.test(url)) throw new Error('link must start with http:// or https://');
    list = await listAds(true);
    const ad = list.find((a) => a.id === id);
    if (!ad) throw new Error('no such image');
    if (url) links[id] = { url, sha: ad.sha }; else delete links[id];
    await store.set('ads:links', links);
  } else {
    list = await listAds(input.action === 'refresh' && admin);
  }
  return {
    admin,
    ads: list.map((a) => ({
      id: a.id,
      src: BASE + '/' + a.path.split('/').map(encodeURIComponent).join('/') + (a.sha ? '?v=' + a.sha.slice(0, 8) : ''),
      url: urlFor(links, a),
    })),
  };
});

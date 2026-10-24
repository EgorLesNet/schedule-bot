import * as store from './store.js';
import { listSchedules, loadEvents } from './schedule.js';
import { loadFiles, saveFiles, mergeFiles } from './files.js';

const norm = (s) => String(s).trim().toLowerCase();

async function loadAll(course) {
  const streams = (await listSchedules())[course] || [];
  const evs = {};
  for (const s of streams) evs[s.key] = await loadEvents(course, s.key);
  return { streams, evs };
}

function counterparts(ctx, stream, original, date) {
  const mine = (ctx.evs[stream] || []).filter((e) => e.date === date && norm(e.original) === norm(original));
  if (!mine.length) return [];
  const me = ctx.streams.find((x) => x.key === stream);
  const starts = new Set(mine.map((e) => e.start));
  const out = [];
  for (const s of ctx.streams) {
    if (s.key === stream) continue;
    if (me && me.faculty !== s.faculty) continue;
    const ev = (ctx.evs[s.key] || []).find((e) => e.date === date && starts.has(e.start) && norm(e.original) === norm(original));
    if (ev) out.push({ stream: s.key, original: ev.original });
  }
  return out;
}

// Возвращает массив потоков-двойников, в которые ТЕКСТ ДЗ тоже скопирован (для уведомлений)
export async function applyHw(course, stream, original, date, text) {
  const own = await store.loadHw(course, stream);
  const key = original + '|' + date;
  if (text) own[key] = text; else delete own[key];
  await store.saveHw(course, stream, own);
  const touched = [];
  try {
    const ctx = await loadAll(course);
    for (const c of counterparts(ctx, stream, original, date)) {
      const hw = await store.loadHw(course, c.stream);
      const k2 = c.original + '|' + date;
      if (text) hw[k2] = text; else delete hw[k2];
      await store.saveHw(course, c.stream, hw);
      touched.push(c.stream);
    }
  } catch (e) {}
  return touched;
}

// Вложения ДЗ: mode 'add' добавляет файлы к уже прикреплённым, 'clear' убирает все. Те же потоки-двойники, что и у текста ДЗ.
export async function applyFiles(course, stream, original, date, mode, files) {
  const targets = [{ stream, key: original + '|' + date }];
  try {
    const ctx = await loadAll(course);
    for (const c of counterparts(ctx, stream, original, date)) targets.push({ stream: c.stream, key: c.original + '|' + date });
  } catch (e) {}
  for (const t of targets) {
    const all = await loadFiles(course, t.stream);
    if (mode === 'clear') delete all[t.key];
    else all[t.key] = mergeFiles(all[t.key] || [], files);
    await saveFiles(course, t.stream, all);
  }
  return targets.length - 1;
}

export async function syncExisting(course) {
  const ctx = await loadAll(course);
  const hws = {};
  for (const s of ctx.streams) hws[s.key] = await store.loadHw(course, s.key);
  let copied = 0;
  let conflicts = 0;
  const dirty = new Set();
  for (const s of ctx.streams) {
    for (const [k, text] of Object.entries(hws[s.key])) {
      const i = k.lastIndexOf('|');
      const original = k.slice(0, i);
      const date = k.slice(i + 1);
      for (const c of counterparts(ctx, s.key, original, date)) {
        const k2 = c.original + '|' + date;
        const cur = hws[c.stream][k2];
        if (cur === undefined) { hws[c.stream][k2] = text; dirty.add(c.stream); copied++; }
        else if (cur !== text) conflicts++;
      }
    }
  }
  for (const key of dirty) await store.saveHw(course, key, hws[key]);
  return { copied, conflicts };
}

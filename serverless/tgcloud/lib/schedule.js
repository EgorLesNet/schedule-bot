import * as store from './store.js';
import { getText } from './http.js';
import { parseIcs } from './ics.js';
import { BASE, API_TREE, TTL, NL } from './config.js';
import { human } from './time.js';
import { langLessons } from './lang.js';
import { parseSchedule } from './faculties.js';
import { announceFileChanges } from './changes.js';

const LUNCH = /обед|перерыв/i;
const ONLINE = ['онлайн', 'online', 'zoom', 'teams', 'вебинар', 'webinar', 'дистанционно', 'удаленно', 'remote', 'ссылка', 'конференция', 'conference', 'meet', 'meeting'];

export async function listSchedules(force = false) {
  const c = await store.get('cache:schedules4');
  if (c && !force && Date.now() - c.at < TTL) return c.data;
  try {
    const tree = JSON.parse(await getText(API_TREE)).tree || [];
    const paths = tree
      .filter((it) => it.type === 'blob' && /[.]ics$/i.test(it.path) && (it.path.startsWith('docs/') || !it.path.includes('/')))
      .map((it) => it.path)
      .sort((a, b) => Number(b.startsWith('docs/')) - Number(a.startsWith('docs/')));
    const data = {};
    const seen = new Set();
    for (const path of paths) {
      const p = parseSchedule(path);
      if (!p || seen.has(p.key)) continue;
      seen.add(p.key);
      (data[p.course] = data[p.course] || []).push({ key: p.key, file: path, course: p.course, faculty: p.faculty, direction: p.direction, stream: p.stream, name: p.stream || p.direction });
    }
    for (const arr of Object.values(data)) arr.sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
    if (Object.keys(data).length) {
      await store.set('cache:schedules4', { at: Date.now(), data });
      return data;
    }
  } catch (e) {}
  return c ? c.data : {};
}

// Плоский список записей; курс берётся из ключа группы, так что работает и со старым кэшем
export function flatten(s) {
  return Object.entries(s).flatMap(([course, arr]) => arr.map((e) => Object.assign({}, e, { course })));
}

export async function allEntries(force = false) {
  return flatten(await listSchedules(force));
}

export async function getRenames(course, stream) {
  const all = await store.get('renames', {});
  return all[course + '_' + stream] || {};
}

export async function toOriginal(course, stream, name) {
  const ren = await getRenames(course, stream);
  for (const [orig, shown] of Object.entries(ren)) if (shown === name) return orig;
  return name;
}

function applyEdits(events, edits) {
  if (!edits) return events;
  const out = [];
  for (const e of events) {
    const ed = edits[e.date] && edits[e.date][e.original + '[' + e.start + ']'];
    if (!ed) { out.push(e); continue; }
    if (ed.deleted) continue;
    // Запись может менять название (new_summary) и/или описание (new_desc, например аудиторию); название из переименований остаётся, если new_summary не задан
    if (ed.new_summary || ed.new_desc !== undefined) out.push(Object.assign({}, e, ed.new_summary ? { summary: ed.new_summary } : {}, ed.new_desc !== undefined ? { desc: ed.new_desc } : {}));
    else out.push(e);
  }
  for (const [date, m] of Object.entries(edits)) {
    for (const ed of Object.values(m)) {
      if (ed.new && ed.start_time && ed.end_time) out.push({ date, start: ed.start_time, end: ed.end_time, summary: ed.new_summary, original: ed.new_summary, desc: ed.new_desc || '' });
    }
  }
  return out;
}

function dedupe(events) {
  const groups = new Map();
  for (const e of events) {
    const k = e.date + '|' + e.start + '|' + e.summary.trim().toLowerCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const out = [];
  for (const list of groups.values()) {
    const seen = new Set();
    const withT = [];
    for (const e of list) {
      const t = parseTeacherRoom(e.desc || '').teacher.trim().toLowerCase();
      if (t && !seen.has(t)) { seen.add(t); withT.push(e); }
    }
    if (withT.length) out.push(...withT); else out.push(list[0]);
  }
  return out;
}

export async function loadEvents(course, stream, force = false) {
  const info = ((await listSchedules())[course] || []).find((s) => s.key === stream);
  if (!info) return [];
  const ck = 'cache:ics:' + info.file;
  const c = await store.get(ck);
  let text;
  if (c && !force && Date.now() - c.at < TTL) text = c.text;
  else {
    try {
      text = await getText(BASE + '/' + info.file.split('/').map(encodeURIComponent).join('/'));
      await store.set(ck, { at: Date.now(), text });
      if (c && c.text && c.text !== text) {
        try { await announceFileChanges(course, stream, c.text, text); } catch (e) {}
      }
    } catch (e) {
      if (c) text = c.text; else return [];
    }
  }
  const ren = await getRenames(course, stream);
  const events = parseIcs(text).map((e) => Object.assign({}, e, { summary: ren[e.summary] || e.summary }));
  const edits = (await store.get('edits', {}))[course + '_' + stream];
  return dedupe(applyEdits(events, edits));
}

function after(desc, labels) {
  for (const l of labels) {
    const i = desc.toLowerCase().indexOf(l.toLowerCase() + ':');
    if (i >= 0) return desc.slice(i + l.length + 1).split(NL)[0].trim();
  }
  return '';
}

export function parseTeacherRoom(desc) {
  let teacher = after(desc, ['Преподаватель', 'Teacher']);
  let room = after(desc, ['Аудитория', 'Room', 'Auditorium']);
  if (!room) {
    if (/ИНИОН|INION/i.test(desc)) room = 'ИНИОН';
    else if (/марон|мар *он/i.test(desc)) room = 'Марон';
    else {
      const m = desc.match(/(?:ауд|аудитория|room|зал|каб|кабинет)[ :]*([0-9]{2,3})/i) || desc.match(/(?:^|[^0-9])([0-9]{3})(?:[^0-9]|$)/);
      if (m) room = m[1];
    }
  }
  if (!teacher) {
    const m = desc.match(/([А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+)/);
    if (m) teacher = m[1];
  }
  return { teacher, room };
}

export function buildDay(events, date, lang, hwAll) {
  const dayEv = events.filter((e) => e.date === date);
  const extra = langLessons(events, date, lang);
  const lunchOnly = !extra.length && dayEv.length > 0 && dayEv.every((e) => LUNCH.test(e.summary));
  const base = extra.length ? dayEv.filter((e) => !LUNCH.test(e.summary)) : dayEv;
  const list = base.concat(extra);
  list.sort((a, b) => a.start.localeCompare(b.start));
  const items = lunchOnly ? [] : list.map((e) => {
    const tr = parseTeacherRoom(e.desc || '');
    const hay = ((e.desc || '') + ' ' + e.summary).toLowerCase();
    return { start: e.start, end: e.end, summary: e.summary, teacher: tr.teacher, room: tr.room, online: ONLINE.some((k) => hay.includes(k)), lang: !!e.lang, hw: (hwAll || {})[e.original + '|' + date] || '' };
  });
  return { date, label: human(date), items };
}

export function dayText(d, prefix = '') {
  if (!d.items.length) return '📅 ' + prefix + d.label + ' — занятий нет' + NL;
  let t = '📅 ' + prefix + d.label + ':' + NL;
  for (const i of d.items) {
    t += i.start + '–' + i.end + ' ' + i.summary + (i.online ? ' 💻' : '') + NL;
    const who = [i.teacher ? '👤 ' + i.teacher : '', i.room ? '🏫 ' + i.room : ''].filter(Boolean).join(' | ');
    if (who) t += '   ' + who + NL;
    if (i.hw) t += '   📝 ДЗ: ' + i.hw + NL;
    t += NL;
  }
  return t;
}

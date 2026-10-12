import * as store from './store.js';
import { getText } from './http.js';
import { parseIcs } from './ics.js';
import { BASE, API_CONTENTS, TTL, NL } from './config.js';
import { weekday, human } from './time.js';

const NAME = /^GAUGN_([0-9]+)_kurs_(.+)[.]ics$/i;
const ONLINE = ['онлайн', 'online', 'zoom', 'teams', 'вебинар', 'webinar', 'дистанционно', 'удаленно', 'remote', 'ссылка', 'конференция', 'conference', 'meet', 'meeting'];

function hash(s) {
  let x = 5381;
  for (const c of s) x = ((x * 33) ^ c.charCodeAt(0)) >>> 0;
  return 's' + x.toString(36);
}

export async function listSchedules(force = false) {
  const c = await store.get('cache:schedules');
  if (c && !force && Date.now() - c.at < TTL) return c.data;
  try {
    const items = JSON.parse(await getText(API_CONTENTS));
    const by = {};
    for (const it of items) {
      if (it.type !== 'file') continue;
      const m = NAME.exec(it.name);
      if (!m) continue;
      (by[m[1]] = by[m[1]] || []).push({ key: hash(it.name), name: m[2].split('_').join(' ').trim(), file: it.name });
    }
    const data = {};
    for (const [course, arr] of Object.entries(by)) {
      arr.sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
      data[course] = arr;
    }
    if (Object.keys(data).length) {
      await store.set('cache:schedules', { at: Date.now(), data });
      return data;
    }
  } catch (e) {}
  return c ? c.data : {};
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
    if (ed.new_summary) out.push(Object.assign({}, e, { summary: ed.new_summary, desc: ed.new_desc !== undefined ? ed.new_desc : e.desc }));
    else out.push(e);
  }
  for (const [date, m] of Object.entries(edits)) {
    for (const ed of Object.values(m)) {
      if (ed.new && ed.start_time && ed.end_time) out.push({ date, start: ed.start_time, end: ed.end_time, summary: ed.new_summary, original: ed.new_summary, desc: ed.new_desc || '' });
    }
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
      text = await getText(BASE + '/' + encodeURIComponent(info.file));
      await store.set(ck, { at: Date.now(), text });
    } catch (e) {
      if (c) text = c.text; else return [];
    }
  }
  const ren = await getRenames(course, stream);
  const events = parseIcs(text).map((e) => Object.assign({}, e, { summary: ren[e.summary] || e.summary }));
  const edits = (await store.get('edits', {}))[course + '_' + stream];
  return applyEdits(events, edits);
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

export function buildDay(events, date, english, hwAll) {
  const dayEv = events.filter((e) => e.date === date);
  const lunchOnly = dayEv.length > 0 && dayEv.every((e) => /обед|перерыв/i.test(e.summary));
  const list = dayEv.slice();
  if (weekday(date) === 3 && (english === 'morning' || english === 'afternoon') && !list.some((e) => /английский/i.test(e.summary))) {
    const am = english === 'morning';
    list.push({ date, start: am ? '09:00' : '14:00', end: am ? '12:10' : '17:10', summary: 'Английский язык', original: 'Английский язык', desc: 'Онлайн занятие' });
  }
  list.sort((a, b) => a.start.localeCompare(b.start));
  const items = lunchOnly ? [] : list.map((e) => {
    const tr = parseTeacherRoom(e.desc || '');
    const hay = ((e.desc || '') + ' ' + e.summary).toLowerCase();
    return { start: e.start, end: e.end, summary: e.summary, teacher: tr.teacher, room: tr.room, online: ONLINE.some((k) => hay.includes(k)), hw: (hwAll || {})[e.original + '|' + date] || '' };
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

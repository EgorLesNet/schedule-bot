import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { loadEvents, toOriginal } from '../lib/schedule.js';
import { endpoint } from '../lib/auth.js';
import { canEdit } from '../lib/roles.js';
import { notifyStream } from '../lib/notify.js';
import { today } from '../lib/time.js';
import { NL } from '../lib/config.js';

const D = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const T = /^[0-9]{2}:[0-9]{2}$/;
const bad = () => new EndpointError('bad input');
const dm = (d) => d.slice(8) + '.' + d.slice(5, 7);
const LOG_MAX = 200;
const LOG_SHOW = 50;
const MAX_SHIFT_LESSONS = 80;
const who = (u) => (u.username ? '@' + u.username : ([u.first_name, u.last_name].filter(Boolean).join(' ') || 'id' + u.id));

const addMin = (t, d) => {
  const m = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) + d;
  if (m < 0 || m > 1439) return '';
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
};
const shiftLabel = (m) => {
  const a = Math.abs(m);
  const h = Math.floor(a / 60);
  const r = a % 60;
  return (m > 0 ? '+' : '−') + (h ? h + ' ч' : '') + (h && r ? ' ' : '') + (r ? r + ' мин' : '');
};
const lessons = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'пара' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'пары' : 'пар');

// Снимает перенос: удаляет запись об отмене и новую пару, на которую она указывала
function undoOne(se, date, ev) {
  const ed = se[date] && se[date][ev];
  if (ed && ed.moved_to) {
    const i = ed.moved_to.indexOf('|');
    const d2 = ed.moved_to.slice(0, i);
    const k2 = ed.moved_to.slice(i + 1);
    if (se[d2]) { delete se[d2][k2]; if (!Object.keys(se[d2]).length) delete se[d2]; }
  }
  if (se[date]) { delete se[date][ev]; if (!Object.keys(se[date]).length) delete se[date]; }
  return !!ed;
}

export default endpoint(async (input, u) => {
  const user = await store.getUser(u.id);
  if (!(await canEdit(u.username, user))) throw new EndpointError('forbidden');
  if (!user.course) throw new EndpointError('no course');
  const sk = user.course + '_' + user.stream;
  const edits = await store.get('edits', {});
  const ren = await store.get('renames', {});
  const se = edits[sk] || {};
  const sr = ren[sk] || {};
  const a = input.action;
  const orig = String(input.original || '').trim();
  const date = String(input.date || '');
  const start = String(input.start || '');
  const evKey = orig + '[' + start + ']';
  let changed = true;
  let note = '';
  let logText = '';

  if (a === 'cancel' || a === 'move') {
    if (!orig || !D.test(date) || !T.test(start)) throw bad();
    se[date] = se[date] || {};
    const title = String(input.summary || orig).trim() || orig;
    if (a === 'cancel') {
      se[date][evKey] = { deleted: true };
      note = '❌ Пара отменена: ' + title + NL + dm(date) + ' в ' + start;
      logText = '❌ Отмена: ' + title + ', ' + dm(date) + ' ' + start;
    } else {
      const nd = String(input.newDate || '');
      const ns = String(input.newStart || '');
      const ne = String(input.newEnd || '');
      if (!D.test(nd) || !T.test(ns) || !T.test(ne)) throw bad();
      const desc = [input.teacher ? 'Преподаватель: ' + input.teacher : '', input.room ? 'Аудитория: ' + input.room : ''].filter(Boolean).join(NL);
      const nk = title + '[' + ns + ']';
      se[nd] = se[nd] || {};
      se[nd][nk] = { new: true, new_summary: title, new_desc: desc, start_time: ns, end_time: ne };
      se[date][evKey] = { deleted: true, moved_to: nd + '|' + nk };
      note = '↪️ Пара перенесена: ' + title + NL + 'Было: ' + dm(date) + ' ' + start + NL + 'Стало: ' + dm(nd) + ' ' + ns + '–' + ne;
      logText = '↪️ Перенос: ' + title + ', ' + dm(date) + ' ' + start + ' → ' + dm(nd) + ' ' + ns + '–' + ne;
    }
  } else if (a === 'shift') {
    // Сдвиг всех пар предмета на N минут (в тот же день); scope 'all' — все будущие, иначе начиная с даты пары
    const mins = Number(input.minutes);
    const subj = String(input.summary || '').trim();
    if (!Number.isInteger(mins) || mins === 0 || Math.abs(mins) > 360 || !subj || !D.test(date)) throw bad();
    const from = input.scope === 'all' ? today() : date;
    const found = (await loadEvents(user.course, user.stream)).filter((e) => e.summary === subj && e.date >= from);
    if (!found.length) throw new EndpointError('Пар этого предмета не найдено');
    const plan = [];
    const seen = new Set();
    for (const e of found) {
      const oldKey = e.original + '[' + e.start + ']';
      if (seen.has(e.date + '|' + oldKey)) continue;
      seen.add(e.date + '|' + oldKey);
      const ns = addMin(e.start, mins);
      const ne = addMin(e.end, mins);
      if (!ns || !ne) throw new EndpointError('Время выходит за пределы суток: ' + dm(e.date) + ' ' + e.start);
      const existing = se[e.date] && se[e.date][oldKey];
      const inPlace = !!(existing && existing.new);
      const title = inPlace ? existing.new_summary : subj;
      plan.push({ e, oldKey, ns, ne, existing, inPlace, nk: title + '[' + ns + ']' });
    }
    if (plan.length > MAX_SHIFT_LESSONS) throw new EndpointError('Слишком много пар за раз, выберите «Начиная с этой даты»');
    const olds = {};
    for (const p of plan) (olds[p.e.date] = olds[p.e.date] || new Set()).add(p.oldKey);
    const news = {};
    for (const p of plan) {
      const ns2 = (news[p.e.date] = news[p.e.date] || new Set());
      const clash = ns2.has(p.nk) || olds[p.e.date].has(p.nk) || (se[p.e.date] && se[p.e.date][p.nk]);
      if (clash) throw new EndpointError('Сдвиг даёт совпадение времени двух пар в день ' + dm(p.e.date) + '. Выберите другой сдвиг');
      ns2.add(p.nk);
    }
    plan.sort((x, y) => x.e.date.localeCompare(y.e.date) || x.e.start.localeCompare(y.e.start));
    for (const p of plan) {
      const d = p.e.date;
      if (p.inPlace) {
        delete se[d][p.oldKey];
        se[d][p.nk] = Object.assign({}, p.existing, { start_time: p.ns, end_time: p.ne });
        for (const m of Object.values(se)) for (const rec of Object.values(m)) if (rec.moved_to === d + '|' + p.oldKey) rec.moved_to = d + '|' + p.nk;
      } else {
        se[d] = se[d] || {};
        se[d][p.oldKey] = { deleted: true, moved_to: d + '|' + p.nk };
        se[d][p.nk] = { new: true, new_summary: subj, new_desc: p.e.desc || '', start_time: p.ns, end_time: p.ne };
      }
    }
    const first = plan[0];
    note = '⏱ Время пар сдвинуто (' + shiftLabel(mins) + '): ' + subj + NL + plan.length + ' ' + lessons(plan.length) + ', начиная с ' + dm(first.e.date) + NL + 'Например: ' + dm(first.e.date) + ' ' + first.e.start + ' → ' + first.ns;
    logText = '⏱ Сдвиг ' + shiftLabel(mins) + ': ' + subj + ', ' + plan.length + ' ' + lessons(plan.length) + ' с ' + dm(first.e.date);
  } else if (a === 'unshift') {
    // Снимает все переносы пар предмета (в том числе одиночные) от даты или от сегодня
    const subj = String(input.summary || '').trim();
    if (!subj) throw bad();
    const from = input.scope === 'all' || !D.test(date) ? today() : date;
    const original = await toOriginal(user.course, user.stream, subj);
    const todo = [];
    for (const d of Object.keys(se)) {
      if (d < from) continue;
      for (const [key, ed] of Object.entries(se[d])) {
        if (ed.moved_to && (key.startsWith(original + '[') || key.startsWith(subj + '['))) todo.push([d, key]);
      }
    }
    if (!todo.length) throw new EndpointError('Переносов этого предмета нет');
    for (const [d, key] of todo) undoOne(se, d, key);
    note = '↩️ Вернули исходное время пар: ' + subj + NL + todo.length + ' ' + lessons(todo.length);
    logText = '↩️ Возврат времени: ' + subj + ', ' + todo.length + ' ' + lessons(todo.length);
  } else if (a === 'undo') {
    const ev = String(input.ev || '');
    if (undoOne(se, date, ev)) logText = '↩️ Возврат: ' + ev.split('[')[0] + ', ' + dm(date);
  } else if (a === 'rename') {
    if (!orig) throw bad();
    const to = String(input.to || '').trim().slice(0, 100);
    if (to && to !== orig) {
      sr[orig] = to;
      note = '✏️ Предмет переименован: ' + orig + ' → ' + to;
      logText = '✏️ Переименование: ' + orig + ' → ' + to;
    } else {
      if (sr[orig]) logText = '✏️ Сброс названия: ' + orig;
      delete sr[orig];
    }
  } else {
    changed = false;
  }

  const lk = 'editlog:' + sk;
  let lg = await store.get(lk, []);
  if (changed) {
    edits[sk] = se;
    ren[sk] = sr;
    await store.set('edits', edits);
    await store.set('renames', ren);
    if (logText) {
      lg = lg.concat([{ t: Date.now(), by: who(u), text: logText }]).slice(-LOG_MAX);
      await store.set(lk, lg);
    }
  }

  if (note) {
    try { await notifyStream(user.course, user.stream, note, u.id); } catch (e) {}
  }

  const list = [];
  for (const [d, m] of Object.entries(se)) {
    for (const [ev, ed] of Object.entries(m)) {
      if (ed.new) continue;
      let info = '';
      if (ed.moved_to) {
        const dd = ed.moved_to.split('|')[0];
        const tm = (ed.moved_to.split('[')[1] || '').split(']')[0];
        info = dd + ' ' + tm;
      }
      list.push({ date: d, ev, kind: ed.moved_to ? 'move' : ed.deleted ? 'cancel' : 'edit', info });
    }
  }
  list.sort((x, y) => x.date.localeCompare(y.date));
  return { edits: list, renames: Object.entries(sr).map(([from, to]) => ({ from, to })), log: lg.slice(-LOG_SHOW).reverse() };
});

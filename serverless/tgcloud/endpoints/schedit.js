import { EndpointError } from 'sdk';
import * as store from '../lib/store.js';
import { endpoint } from '../lib/auth.js';
import { NL } from '../lib/config.js';

const D = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const T = /^[0-9]{2}:[0-9]{2}$/;
const bad = () => new EndpointError('bad input');

export default endpoint(async (input, u) => {
  if (!(await store.isAssistant(u.username))) throw new EndpointError('forbidden');
  const user = await store.getUser(u.id);
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

  if (a === 'cancel' || a === 'move') {
    if (!orig || !D.test(date) || !T.test(start)) throw bad();
    se[date] = se[date] || {};
    if (a === 'cancel') {
      se[date][evKey] = { deleted: true };
    } else {
      const nd = String(input.newDate || '');
      const ns = String(input.newStart || '');
      const ne = String(input.newEnd || '');
      if (!D.test(nd) || !T.test(ns) || !T.test(ne)) throw bad();
      const summary = String(input.summary || orig).trim() || orig;
      const desc = [input.teacher ? 'Преподаватель: ' + input.teacher : '', input.room ? 'Аудитория: ' + input.room : ''].filter(Boolean).join(NL);
      const nk = summary + '[' + ns + ']';
      se[nd] = se[nd] || {};
      se[nd][nk] = { new: true, new_summary: summary, new_desc: desc, start_time: ns, end_time: ne };
      se[date][evKey] = { deleted: true, moved_to: nd + '|' + nk };
    }
  } else if (a === 'undo') {
    const ev = String(input.ev || '');
    const ed = se[date] && se[date][ev];
    if (ed && ed.moved_to) {
      const i = ed.moved_to.indexOf('|');
      const d2 = ed.moved_to.slice(0, i);
      const k2 = ed.moved_to.slice(i + 1);
      if (se[d2]) { delete se[d2][k2]; if (!Object.keys(se[d2]).length) delete se[d2]; }
    }
    if (se[date]) { delete se[date][ev]; if (!Object.keys(se[date]).length) delete se[date]; }
  } else if (a === 'rename') {
    if (!orig) throw bad();
    const to = String(input.to || '').trim().slice(0, 100);
    if (to && to !== orig) sr[orig] = to; else delete sr[orig];
  } else {
    changed = false;
  }

  if (changed) {
    edits[sk] = se;
    ren[sk] = sr;
    await store.set('edits', edits);
    await store.set('renames', ren);
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
  return { edits: list, renames: Object.entries(sr).map(([from, to]) => ({ from, to })) };
});

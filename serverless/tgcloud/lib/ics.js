import { NL } from './config.js';

const CR = String.fromCharCode(13);
const TAB = String.fromCharCode(9);
const BS = String.fromCharCode(92);

function unesc(s) {
  return s.split(BS + 'n').join(NL).split(BS + 'N').join(NL).split(BS + ',').join(',').split(BS + ';').join(';').split(BS + BS).join(BS);
}

function field(lines, name) {
  for (const l of lines) {
    if (l.startsWith(name + ':') || l.startsWith(name + ';')) return l.slice(l.indexOf(':') + 1).trim();
  }
  return '';
}

function dt(v) {
  if (!v || v.length < 15) return null;
  let t = Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(9, 11), +v.slice(11, 13));
  if (v.endsWith('Z')) t += 3 * 3600000;
  const iso = new Date(t).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

export function parseIcs(raw) {
  const text = raw.split(CR).join('').split(NL + ' ').join('').split(NL + TAB).join('');
  const out = [];
  for (const block of text.split('BEGIN:VEVENT').slice(1)) {
    if (!block.includes('END:VEVENT')) continue;
    const lines = block.split(NL);
    const s = dt(field(lines, 'DTSTART'));
    const e = dt(field(lines, 'DTEND'));
    const summary = unesc(field(lines, 'SUMMARY'));
    if (!s || !e || !summary) continue;
    out.push({ date: s.date, start: s.time, end: e.time, summary, original: summary, desc: unesc(field(lines, 'DESCRIPTION')) });
  }
  return out;
}

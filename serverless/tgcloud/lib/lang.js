import { weekday, addDays } from './time.js';

export const LANG_NAME = 'Ин. яз';

const pad = (n) => String(n).padStart(2, '0');
const LUNCH = /обед|перерыв/i;
const cache = new WeakMap();

export function toMin(t) {
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}

export function fmt(m) {
  return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
}

export const LANG_TIMES = (() => {
  const o = [];
  for (let m = 8 * 60; m <= 18 * 60; m += 30) o.push(fmt(m));
  return o;
})();

export const isLangStart = (s) => LANG_TIMES.includes(s);

export const langSpan = (start) => {
  const m = toMin(start);
  return fmt(m) + '–' + fmt(m + 90) + ', ' + fmt(m + 100) + '–' + fmt(m + 190);
};

export function userLang(u) {
  if (!u || (u.course !== '1' && u.course !== '2')) return '';
  if (u.langStart && isLangStart(u.langStart)) return u.langStart;
  if (u.englishTime === 'morning') return '09:00';
  if (u.englishTime === 'afternoon') return '14:00';
  return '';
}

export function langInfo(events) {
  if (cache.has(events)) return cache.get(events);
  const real = events.filter((e) => !LUNCH.test(e.summary));
  let info = null;
  if (real.length) {
    const dates = real.map((e) => e.date).sort();
    const used = new Set(real.map((e) => weekday(e.date)));
    const empty = [0, 1, 2, 3, 4].filter((w) => !used.has(w));
    if (empty.length === 1) info = { weekday: empty[0], from: dates[0], to: dates[dates.length - 1] };
  }
  cache.set(events, info);
  return info;
}

export function langDates(events, from) {
  const info = langInfo(events);
  if (!info) return [];
  const out = [];
  let d = info.from > from ? info.from : from;
  for (let i = 0; i < 400 && d <= info.to; i++) {
    if (weekday(d) === info.weekday) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

export function langLessons(events, date, start) {
  if (!start) return [];
  const info = langInfo(events);
  if (!info || weekday(date) !== info.weekday || date < info.from || date > info.to) return [];
  const s = toMin(start);
  const mk = (a) => ({ date, start: fmt(a), end: fmt(a + 90), summary: LANG_NAME, original: LANG_NAME, desc: '', lang: true });
  return [mk(s), mk(s + 100)];
}

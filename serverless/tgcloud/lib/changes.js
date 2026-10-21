import { parseIcs } from './ics.js';
import { notifyStream } from './notify.js';
import { today } from './time.js';
import { NL } from './config.js';

const LUNCH = /обед|перерыв/i;
const key = (e) => e.date + '|' + e.start + '|' + e.end + '|' + e.summary;
const dm = (d) => d.slice(8) + '.' + d.slice(5, 7);
const fmt = (e) => dm(e.date) + ' ' + e.start + '–' + e.end + ' ' + e.summary;
const byTime = (a, b) => (a.date + a.start).localeCompare(b.date + b.start);

// Различия между старой и новой версией .ics (только будущие даты, без обедов)
export function diffEvents(oldText, newText) {
  const from = today();
  const a = parseIcs(oldText).filter((e) => e.date >= from && !LUNCH.test(e.summary));
  const b = parseIcs(newText).filter((e) => e.date >= from && !LUNCH.test(e.summary));
  const sa = new Set(a.map(key));
  const sb = new Set(b.map(key));
  return { removed: a.filter((e) => !sb.has(key(e))).sort(byTime), added: b.filter((e) => !sa.has(key(e))).sort(byTime) };
}

// Если файл расписания изменился, сообщаем потоку: до 10 различий — списком, больше — коротким сообщением
export async function announceFileChanges(course, stream, oldText, newText) {
  const d = diffEvents(oldText, newText);
  const total = d.removed.length + d.added.length;
  if (!total) return 0;
  let text = '🗓 Расписание обновлено';
  if (total <= 10) {
    const lines = [];
    for (const e of d.removed) lines.push('➖ ' + fmt(e));
    for (const e of d.added) lines.push('➕ ' + fmt(e));
    text += NL + lines.join(NL);
  } else {
    text += ': изменено пар — ' + total + '. Откройте «Эта неделя» или приложение.';
  }
  return notifyStream(course, stream, text);
}

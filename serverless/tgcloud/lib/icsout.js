import { parseTeacherRoom } from './schedule.js';
import { langDates, langLessons } from './lang.js';
import { fileKey } from './faculties.js';
import { NL } from './config.js';

const BS = String.fromCharCode(92);
const CRLF = String.fromCharCode(13) + NL;
const LUNCH = /обед|перерыв/i;

const esc = (s) => String(s || '').split(BS).join(BS + BS).split(';').join(BS + ';').split(',').join(BS + ',').split(NL).join(BS + 'n');

// Строки .ics нужно переносить: продолжение начинается с пробела
function fold(line) {
  if (line.length <= 36) return line;
  const parts = [];
  for (let i = 0; i < line.length; i += 35) parts.push(line.slice(i, i + 35));
  return parts.join(CRLF + ' ');
}

const dt = (date, time) => date.split('-').join('') + 'T' + time.split(':').join('') + '00';
const stamp = () => new Date().toISOString().split('-').join('').split(':').join('').slice(0, 15) + 'Z';

// events — уже с учётом переименований, отмен и переносов (loadEvents); ин. яз добавляется по тем же правилам, что и в боте
export function buildIcs(name, events, langStart) {
  const all = events.filter((e) => !LUNCH.test(e.summary));
  if (langStart) {
    for (const d of langDates(events, '0000-01-01')) all.push(...langLessons(events, d, langStart));
  }
  all.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const L = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//schedule-bot//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + esc(name), 'X-WR-TIMEZONE:Europe/Moscow',
    'BEGIN:VTIMEZONE', 'TZID:Europe/Moscow', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0300', 'TZOFFSETTO:+0300', 'TZNAME:MSK', 'END:STANDARD', 'END:VTIMEZONE',
  ];
  const ts = stamp();
  for (const e of all) {
    const tr = parseTeacherRoom(e.desc || '');
    L.push('BEGIN:VEVENT', 'UID:' + fileKey(e.date + '|' + e.start + '|' + e.summary) + '@schedule-bot', 'DTSTAMP:' + ts,
      'DTSTART;TZID=Europe/Moscow:' + dt(e.date, e.start), 'DTEND;TZID=Europe/Moscow:' + dt(e.date, e.end), 'SUMMARY:' + esc(e.summary));
    if (tr.room) L.push('LOCATION:' + esc(tr.room));
    if (e.desc) L.push('DESCRIPTION:' + esc(e.desc));
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join(CRLF) + CRLF;
}

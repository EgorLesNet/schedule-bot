export const FACULTY_NAMES = ['Исторический', 'Мировой политики', 'Политологии', 'Психологии', 'Социологический', 'Философский', 'Юридический', 'Восточный', 'Экономический', 'Филологический'];

export const COURSES_COUNT = 4;

// Имя файла расписания: <Факультет>_<N>курс_<Направление>[_<Поток>].ics
// пример: Социологический_2курс_1поток.ics → факультет «Социологический», 2 курс, направление «1 поток».
// Ключ потока = хэш имени файла; для трёх переименованных файлов он считается от СТАРОГО имени,
// чтобы не потерять ДЗ, ссылки, правки и сохранённый выбор пользователей.
const NEW_TO_OLD = {
  'Социологический_1курс_Общий.ics': 'GAUGN_1_kurs_Общий.ics',
  'Социологический_2курс_1поток.ics': 'GAUGN_2_kurs_Поток_1.ics',
  'Социологический_2курс_2поток.ics': 'GAUGN_2_kurs_Поток_2.ics',
};
const OLD_TO_NEW = {};
for (const [n, o] of Object.entries(NEW_TO_OLD)) OLD_TO_NEW[o] = n;

export function fileKey(s) {
  let x = 5381;
  for (const c of s) x = ((x * 33) ^ c.charCodeAt(0)) >>> 0;
  return 's' + x.toString(36);
}

const FILE_RE = /^(.+?)_\s*([0-9]+)\s*курс_(.+)[.]ics$/i;

export function prettify(s) {
  return String(s).replace(/^([0-9]+)([^0-9\s].*)$/, '$1 $2').trim();
}

function canonFaculty(name) {
  const n = name.trim().toLowerCase();
  return FACULTY_NAMES.find((x) => x.toLowerCase() === n) || name.trim();
}

export function parseSchedule(file) {
  const norm = OLD_TO_NEW[file] || file;
  const m = FILE_RE.exec(norm);
  if (!m) return null;
  const parts = m[3].split('_').filter(Boolean);
  if (!parts.length) return null;
  return {
    faculty: canonFaculty(m[1]),
    course: String(Number(m[2])),
    direction: prettify(parts[0]),
    stream: parts.slice(1).map(prettify).join(' '),
    key: fileKey(NEW_TO_OLD[norm] || file),
  };
}

export function facultyList(entries) {
  const extra = [];
  for (const e of entries) if (!FACULTY_NAMES.includes(e.faculty) && !extra.includes(e.faculty)) extra.push(e.faculty);
  return FACULTY_NAMES.concat(extra.sort((a, b) => a.localeCompare(b, 'ru')));
}

export function directionsOf(entries, faculty, course) {
  const out = [];
  for (const e of entries) if (e.faculty === faculty && e.course === String(course) && !out.includes(e.direction)) out.push(e.direction);
  return out.sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
}

export function streamsOf(entries, faculty, course, direction) {
  return entries.filter((e) => e.faculty === faculty && e.course === String(course) && e.direction === direction);
}

// Пары (курс, направление) факультета: так их показывает Mini App (список направлений без привязки к курсу)
export function directionPairs(entries, faculty) {
  const out = [];
  for (const e of entries) if (e.faculty === faculty && !out.some((p) => p.course === e.course && p.direction === e.direction)) out.push({ course: e.course, direction: e.direction });
  return out.sort((a, b) => Number(a.course) - Number(b.course) || a.direction.localeCompare(b.direction, 'ru', { numeric: true }));
}

export const pairLabel = (p) => p.direction + ' (' + p.course + ' курс)';

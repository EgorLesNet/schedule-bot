// Список нужен только для канонического регистра и порядка; в выборе показываются только факультеты, для которых есть файлы в docs/
export const FACULTY_NAMES = ['Исторический', 'Мировой политики', 'Политологии', 'Психологии', 'Социологический', 'Философский', 'Юридический', 'Восточный', 'Экономический', 'Филологический'];

export const COURSES_COUNT = 4;

// Расписания лежат в docs/<Факультет>/<N>курс_<Направление>[_<Поток>].ics (ветка tgcloud).
// Префикс факультета в имени файла необязателен: Социологический_2курс_1поток.ics тоже подходит.
// Файлы в корне репозитория (с префиксом факультета) тоже читаются, пока их не перенесли.
const FILE_RE = /^(?:(.+?)_)?\s*([0-9]+)\s*курс_(.+)[.]ics$/i;

// Старые имена файлов в корне → поля расписания
const OLD_FILES = {
  'GAUGN_1_kurs_Общий.ics': { faculty: 'Социологический', course: '1', direction: 'Общий', stream: '' },
  'GAUGN_2_kurs_Поток_1.ics': { faculty: 'Социологический', course: '2', direction: '1 поток', stream: '' },
  'GAUGN_2_kurs_Поток_2.ics': { faculty: 'Социологический', course: '2', direction: '2 поток', stream: '' },
};

const idOf = (f) => [f.faculty, f.course, f.direction, f.stream].join('|');

// Ключ потока = хэш «факультет|курс|направление|поток», а не пути файла: файл можно переименовать и перенести
// без потери ДЗ, ссылок, правок и выбора пользователей. Для трёх старых файлов ключ считается от старого имени.
const LEGACY_KEYS = {};
for (const [name, f] of Object.entries(OLD_FILES)) LEGACY_KEYS[idOf(f)] = name;

export function fileKey(s) {
  let x = 5381;
  for (const c of s) x = ((x * 33) ^ c.charCodeAt(0)) >>> 0;
  return 's' + x.toString(36);
}

export function prettify(s) {
  return String(s).replace(/^([0-9]+)([^0-9\s].*)$/, '$1 $2').trim();
}

function canonFaculty(name) {
  const n = String(name || '').trim();
  if (!n) return '';
  return FACULTY_NAMES.find((x) => x.toLowerCase() === n.toLowerCase()) || n;
}

export function parseSchedule(path) {
  const parts = path.split('/');
  const base = parts[parts.length - 1];
  let f = OLD_FILES[base] ? Object.assign({}, OLD_FILES[base]) : null;
  if (!f) {
    const m = FILE_RE.exec(base);
    if (!m) return null;
    const segs = m[3].split('_').filter(Boolean);
    if (!segs.length) return null;
    const folder = parts.length >= 3 && parts[0] === 'docs' ? parts[1] : '';
    const faculty = canonFaculty(folder || m[1]);
    if (!faculty) return null;
    f = { faculty, course: String(Number(m[2])), direction: prettify(segs[0]), stream: segs.slice(1).map(prettify).join(' ') };
  }
  const id = idOf(f);
  return Object.assign(f, { key: fileKey(LEGACY_KEYS[id] || id) });
}

// Только факультеты, для которых есть файлы: сначала известные в привычном порядке, затем остальные по алфавиту
export function facultyList(entries) {
  const present = [];
  for (const e of entries) if (!present.includes(e.faculty)) present.push(e.faculty);
  const known = FACULTY_NAMES.filter((n) => present.includes(n));
  const extra = present.filter((n) => !FACULTY_NAMES.includes(n)).sort((a, b) => a.localeCompare(b, 'ru'));
  return known.concat(extra);
}

export function directionsOf(entries, faculty, course) {
  const out = [];
  for (const e of entries) if (e.faculty === faculty && e.course === String(course) && !out.includes(e.direction)) out.push(e.direction);
  return out.sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
}

export function streamsOf(entries, faculty, course, direction) {
  return entries.filter((e) => e.faculty === faculty && e.course === String(course) && e.direction === direction);
}

// Пары (курс, направление) факультета: так их показывает Mini App (web/settings.js фильтрует по курсу)
export function directionPairs(entries, faculty) {
  const out = [];
  for (const e of entries) if (e.faculty === faculty && !out.some((p) => p.course === e.course && p.direction === e.direction)) out.push({ course: e.course, direction: e.direction });
  return out.sort((a, b) => Number(a.course) - Number(b.course) || a.direction.localeCompare(b.direction, 'ru', { numeric: true }));
}

export const pairLabel = (p) => p.direction + ' (' + p.course + ' курс)';

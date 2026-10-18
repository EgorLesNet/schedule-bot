export const FACULTIES = [
  { name: 'Исторический', directions: ['Всеобщая история', 'Культурно-историческое наследие в современном мире', 'Коммуникации в социокультурной сфере', 'Археология'] },
  { name: 'Мировой политики', directions: ['Зарубежное регионоведение', 'Международные отношения'] },
  { name: 'Политологии', directions: ['Политология'] },
  { name: 'Психологии', directions: ['Психологическое консультирование', 'Общая и экспериментальная психология'] },
  { name: 'Социологический', directions: ['Социально-правовая экспертиза', 'Теория и практика социологических исследований'] },
  { name: 'Философский', directions: ['Философия в современном мире'] },
  { name: 'Юридический', directions: ['Юриспруденция', 'Общеправовой профиль', 'Социально-правовая экспертиза', 'Уголовно-правовой профиль'] },
  { name: 'Восточный', directions: ['Востоковедение'] },
  { name: 'Экономический', directions: ['Экономическое моделирование', 'Менеджмент организации', 'Экономическая логистика', 'Управление цифровым маркетингом и рекламой', 'Финансовый анализ и аудит', 'Бюджетный процесс и казначейское дело'] },
  { name: 'Филологический', directions: ['Лингвистика (межкультурное взаимодействие)', 'Лингвистика (фундаментальные исследования)'] },
];

export const COURSES_COUNT = 4;

const SOC = ['GAUGN_1_kurs_Общий.ics', 'GAUGN_2_kurs_Поток_1.ics', 'GAUGN_2_kurs_Поток_2.ics'];

// 'индекс факультета:индекс направления' -> имена .ics файлов из корня репозитория (ветка main)
// Новые расписания добавляйте сюда, например '0:0': ['GAUGN_1_kurs_История_Общий.ics']
export const FILES = {
  '4:0': SOC,
  '4:1': SOC,
};

export const filesFor = (fi, di) => FILES[fi + ':' + di] || [];

export function streamsFor(streams, fi, di) {
  const files = filesFor(fi, di);
  return (streams || []).filter((s) => files.includes(s.file));
}

export function sameGroup(a, b) {
  const groups = Object.values(FILES);
  const ga = groups.filter((g) => g.includes(a));
  const gb = groups.filter((g) => g.includes(b));
  if (!ga.length && !gb.length) return true;
  return ga.some((g) => g.includes(b));
}

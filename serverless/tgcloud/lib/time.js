const MSK = 3 * 3600000;
const DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const pad = (n) => String(n).padStart(2, '0');
const parse = (s) => new Date(s + 'T00:00:00Z');

export const ymd = (d) => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
export const today = () => ymd(new Date(Date.now() + MSK));
export const addDays = (s, n) => ymd(new Date(parse(s).getTime() + n * 86400000));
export const weekday = (s) => (parse(s).getUTCDay() + 6) % 7;
export const weekStart = (s) => addDays(s, -weekday(s));
export const human = (s) => DAYS[weekday(s)] + ', ' + parse(s).getUTCDate() + ' ' + MONTHS[parse(s).getUTCMonth()];
export const ruShort = (s) => s.slice(8) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4);

const tg = window.Telegram && window.Telegram.WebApp;
if (tg) { tg.ready(); tg.expand(); }
let offline = false;
const S = { tab: 'day', date: '', week: '', boot: null };
const P = (s) => new Date(s + 'T00:00:00Z');
const add = (s, n) => new Date(P(s).getTime() + n * 86400000).toISOString().slice(0, 10);
const wd = (s) => (P(s).getUTCDay() + 6) % 7;
const wk = (s) => add(s, -wd(s));
const $ = (q) => document.querySelector(q);

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = !!v;
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === false || kid === null || kid === undefined) continue;
    e.append(kid instanceof Node ? kid : String(kid));
  }
  return e;
}

async function call(name, p = {}, cache = false) {
  const key = 'sb:' + name + ':' + JSON.stringify(p);
  try {
    const r = await tg.Serverless.call(name, p);
    if (cache) localStorage.setItem(key, JSON.stringify(r));
    return r;
  } catch (e) {
    const c = cache && localStorage.getItem(key);
    if (c) { offline = true; return JSON.parse(c); }
    throw e;
  }
}

const safe = (f) => async () => {
  try { await f(); } catch (e) { const m = String((e && e.message) || e); if (tg && tg.showAlert) tg.showAlert(m); else alert(m); }
};

function nav(prev, next, reset) {
  const go = (f) => () => { f(); render(); };
  return h('div', { class: 'nav' }, h('button', { onclick: go(prev) }, '◀'), h('button', { onclick: go(reset) }, 'Сегодня'), h('button', { onclick: go(next) }, '▶'));
}

function dayCard(d) {
  const c = h('section', { class: 'card' }, h('h3', {}, d.label));
  if (!d.items.length) c.append(h('p', { class: 'muted' }, 'Занятий нет'));
  for (const i of d.items) {
    const who = [i.teacher ? '👤 ' + i.teacher : '', i.room ? '🏫 ' + i.room : ''].filter(Boolean).join(' · ');
    c.append(h('div', { class: 'lesson' }, h('div', { class: 'time' }, i.start + '–' + i.end),
      h('div', {}, h('b', {}, i.summary + (i.online ? ' 💻' : '')), who ? h('div', { class: 'muted' }, who) : null, i.hw ? h('div', { class: 'hw' }, '📝 ' + i.hw) : null)));
  }
  return c;
}

async function viewDay() {
  const days = await call('range', { from: S.date, days: 1 }, true);
  return h('div', {}, nav(() => { S.date = add(S.date, -1); }, () => { S.date = add(S.date, 1); }, () => { S.date = S.boot.today; }), dayCard(days[0]));
}

async function viewWeek() {
  const days = await call('range', { from: S.week, days: 7 }, true);
  return h('div', {}, nav(() => { S.week = add(S.week, -7); }, () => { S.week = add(S.week, 7); }, () => { S.week = wk(S.boot.today); }), days.map(dayCard));
}

async function hwForm() {
  const subs = await call('subjects', {}, true);
  const sel = h('select', {}, subs.map((s) => h('option', { value: s }, s)));
  const date = h('input', { type: 'date', value: S.boot.today });
  const text = h('textarea', { rows: 3, placeholder: 'Текст задания' });
  return h('section', { class: 'card' }, h('h3', {}, 'Добавить ДЗ'), sel, date, text,
    h('button', { onclick: safe(async () => { if (!text.value.trim()) return; await call('homework', { action: 'add', subject: sel.value, date: date.value, text: text.value }); render(); }) }, 'Сохранить'));
}

async function viewHw() {
  const list = await call('homework', { action: 'list' }, true);
  const box = h('div', {});
  if (!list.length) box.append(h('p', { class: 'muted' }, 'Список ДЗ пуст'));
  for (const x of list) {
    const card = h('section', { class: 'card' }, h('b', {}, x.subject + ' · ' + x.date.split('-').reverse().join('.')), h('p', {}, x.text));
    if (S.boot.assistant) card.append(h('button', { class: 'danger', onclick: safe(async () => { await call('homework', { action: 'delete', subject: x.subject, date: x.date }); render(); }) }, 'Удалить'));
    box.append(card);
  }
  if (S.boot.assistant) box.append(await hwForm());
  return box;
}

async function viewSet() {
  const sch = S.boot.schedules;
  const u = S.boot.user;
  const lab = (t, el) => h('label', {}, h('span', { class: 'muted' }, t), el);
  const course = h('select', {}, Object.keys(sch).sort((a, b) => a - b).map((c) => h('option', { value: c, selected: c === u.course }, c + ' курс')));
  const stream = h('select', {});
  const fill = () => stream.replaceChildren(...(sch[course.value] || []).map((s) => h('option', { value: s.key, selected: s.key === u.stream }, s.name)));
  fill();
  course.addEventListener('change', fill);
  const eng = h('select', {}, [['', 'Без английского'], ['morning', '9:00–12:10'], ['afternoon', '14:00–17:10']].map(([v, t]) => h('option', { value: v, selected: v === (u.englishTime || '') }, t)));
  const rem = h('input', { type: 'checkbox', checked: !!u.reminders });
  return h('section', { class: 'card' }, h('h3', {}, 'Настройки'), lab('Курс', course), lab('Расписание', stream), lab('Английский в четверг', eng),
    h('label', { class: 'row' }, rem, 'Напоминания о ДЗ'),
    h('button', { onclick: safe(async () => {
      S.boot.user = await call('settings', { course: course.value, stream: stream.value, englishTime: eng.value || null, reminders: rem.checked });
      S.tab = 'day'; S.date = S.boot.today; render();
    }) }, 'Сохранить'));
}

const TABS = [['day', 'Сегодня', viewDay], ['week', 'Неделя', viewWeek], ['hw', 'ДЗ', viewHw], ['set', 'Настройки', viewSet]];

async function render() {
  offline = false;
  $('#tabs').replaceChildren(...TABS.map(([id, t]) => h('button', { class: S.tab === id ? 'on' : '', onclick: () => { S.tab = id; render(); } }, t)));
  const v = $('#view');
  v.replaceChildren(h('p', { class: 'muted' }, 'Загрузка…'));
  try {
    const el = await TABS.find((x) => x[0] === S.tab)[2]();
    v.replaceChildren(offline ? h('p', { class: 'muted' }, 'Офлайн: показаны сохранённые данные') : null, el);
  } catch (e) {
    v.replaceChildren(h('p', { class: 'err' }, 'Ошибка: ' + ((e && e.message) || e)));
  }
}

(async () => {
  try { S.boot = await call('bootstrap', {}, true); } catch (e) { $('#view').replaceChildren(h('p', { class: 'err' }, 'Не удалось загрузить: ' + ((e && e.message) || e))); return; }
  S.date = S.boot.today;
  S.week = wk(S.boot.today);
  if (!S.boot.user.course) S.tab = 'set';
  render();
})();

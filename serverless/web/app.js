const tg = window.Telegram && window.Telegram.WebApp;
if (tg) { tg.ready(); tg.expand(); }
let offline = false;
const S = { tab: 'day', date: '', week: '', cm: '', boot: null, pre: null };
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MG = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const ICONS = {
  day: `<svg viewBox='0 0 24 24'><rect x='3' y='5' width='18' height='16' rx='4'/><path d='M3 10h18M8 3v4M16 3v4'/></svg>`,
  week: `<svg viewBox='0 0 24 24'><rect x='3' y='4' width='18' height='16' rx='4'/><path d='M3 9h18M9 9v11M15 9v11'/></svg>`,
  hw: `<svg viewBox='0 0 24 24'><path d='M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z'/><path d='M8 8h7M8 12h7'/></svg>`,
  set: `<svg viewBox='0 0 24 24'><path d='M4 7h10M18 7h2M4 17h2M10 17h10'/><circle cx='16' cy='7' r='2'/><circle cx='8' cy='17' r='2'/></svg>`,
};
const P = (s) => new Date(s + 'T00:00:00Z');
const add = (s, n) => new Date(P(s).getTime() + n * 86400000).toISOString().slice(0, 10);
const wd = (s) => (P(s).getUTCDay() + 6) % 7;
const wk = (s) => add(s, -wd(s));
const fd = (s) => P(s).getUTCDate() + ' ' + MG[P(s).getUTCMonth()];
const $ = (q) => document.querySelector(q);

function weekLabel(a) {
  const b = add(a, 6);
  const left = P(a).getUTCMonth() === P(b).getUTCMonth() ? String(P(a).getUTCDate()) : fd(a);
  return left + ' – ' + fd(b) + ' ' + P(b).getUTCFullYear();
}

const applyTheme = () => {
  const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = (tg && tg.colorScheme) || (dark ? 'dark' : 'light');
};
applyTheme();
if (tg && tg.onEvent) tg.onEvent('themeChanged', applyTheme);

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
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

function call(name, p = {}, cache = false) {
  const key = 'sb2:' + name + ':' + JSON.stringify(p);
  return new Promise((resolve, reject) => {
    const fail = (e) => {
      const c = cache && !(e && e.type === 'ENDPOINT_ERROR') && localStorage.getItem(key);
      let parsed;
      try { parsed = c ? JSON.parse(c) : undefined; } catch (x) { parsed = undefined; }
      if (parsed !== undefined) { offline = true; resolve(parsed); }
      else reject(e instanceof Error ? e : new Error((e && e.message) || String(e)));
    };
    try {
      tg.Serverless.call(name, p, (err, res) => {
        if (err) return fail(err);
        if (cache && res !== undefined) localStorage.setItem(key, JSON.stringify(res));
        resolve(res);
      });
    } catch (e) { fail(e); }
  });
}

const safe = (f) => async () => {
  try { await f(); } catch (e) { const m = String((e && e.message) || e); if (tg && tg.showAlert) tg.showAlert(m); else alert(m); }
};

const openLink = (u) => { if (tg && tg.openLink) tg.openLink(u); else window.open(u, '_blank'); };

function nav(prev, next, reset, label) {
  const go = (f) => () => { f(); render(); };
  return h('div', { class: 'nav' }, h('button', { onclick: go(prev) }, '◀'), h('button', { class: 'mid', onclick: go(reset) }, label), h('button', { onclick: go(next) }, '▶'));
}

function calendar() {
  const box = h('section', { class: 'cal' });
  const draw = () => {
    const [y, m] = S.cm.split('-').map(Number);
    const first = S.cm + '-01';
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const shift = (n) => { S.cm = new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); draw(); };
    const head = h('div', { class: 'head' },
      h('button', { onclick: () => shift(-1) }, '‹'),
      h('b', {}, MONTHS[m - 1] + ' ' + y),
      h('button', { onclick: () => shift(1) }, '›'));
    const grid = h('div', { class: 'grid' }, WD.map((x) => h('span', { class: 'wdn' }, x)));
    for (let i = 0; i < wd(first); i++) grid.append(h('span', {}));
    for (let day = 1; day <= dim; day++) {
      const ds = S.cm + '-' + String(day).padStart(2, '0');
      const cls = 'd' + (ds === S.boot.today ? ' today' : '') + (ds === S.date ? ' sel' : '');
      grid.append(h('button', { class: cls, onclick: () => { S.date = ds; render(); } }, day));
    }
    const todayBtn = h('button', { class: 'todaybtn', onclick: () => { S.date = S.boot.today; S.cm = S.boot.today.slice(0, 7); render(); } }, 'Сегодня');
    box.replaceChildren(head, grid, todayBtn);
  };
  draw();
  return box;
}

function linkForm(d, i) {
  const url = h('input', { type: 'url', placeholder: 'https://…', value: i.link || '' });
  const all = h('input', { type: 'checkbox', checked: i.linkAll });
  const form = h('div', { class: 'linkform' }, url,
    h('label', { class: 'row' }, all, 'Для всех занятий этого предмета'),
    h('button', { class: 'mini', onclick: safe(async () => {
      await call('link', { action: 'set', original: i.original, date: d.date, start: i.start, url: url.value, all: all.checked });
      render();
    }) }, 'Сохранить'));
  if (i.link) {
    form.append(h('button', { class: 'mini danger', onclick: safe(async () => {
      await call('link', { action: 'delete', original: i.original, date: d.date, start: i.start, all: i.linkAll });
      render();
    }) }, 'Удалить ссылку'));
  }
  return form;
}

function lessonRow(d, i) {
  const who = [i.teacher ? '👤 ' + i.teacher : '', i.room ? '🏫 ' + i.room : ''].filter(Boolean).join(' · ');
  const body = h('div', { class: 'grow' }, h('b', {}, i.summary + (i.online || i.link ? ' 💻' : '')),
    who ? h('div', { class: 'muted' }, who) : null,
    i.hw ? h('div', { class: 'hw' }, '📝 ' + i.hw) : null);
  const acts = h('div', { class: 'acts' });
  const slot = h('div', {});
  if (i.link) acts.append(h('button', { class: 'mini', onclick: () => openLink(i.link) }, '🔗 Подключиться'));
  if (S.boot.assistant) {
    acts.append(h('button', { class: 'mini alt', onclick: () => { if (slot.firstChild) slot.replaceChildren(); else slot.append(linkForm(d, i)); } }, i.link ? '✏️ Ссылка' : '＋ Ссылка'));
    acts.append(h('button', { class: 'mini alt', onclick: () => { S.pre = { subject: i.summary, date: d.date }; S.tab = 'hw'; render(); } }, '＋ ДЗ'));
  }
  body.append(acts, slot);
  return h('div', { class: 'lesson' }, h('div', { class: 'time' }, i.start + '–' + i.end), body);
}

function dayCard(d) {
  const c = h('section', { class: 'card' }, h('h3', {}, d.label));
  if (!d.items.length) c.append(h('p', { class: 'muted' }, 'Занятий нет'));
  for (const i of d.items) c.append(lessonRow(d, i));
  return c;
}

async function viewDay() {
  const days = await call('range', { from: S.date, days: 1 }, true);
  return h('div', {}, calendar(), dayCard(days[0]));
}

async function viewWeek() {
  const days = await call('range', { from: S.week, days: 7 }, true);
  const cur = S.week === wk(S.boot.today);
  return h('div', {},
    nav(() => { S.week = add(S.week, -7); }, () => { S.week = add(S.week, 7); }, () => { S.week = wk(S.boot.today); }, weekLabel(S.week)),
    h('p', { class: 'muted center' }, cur ? 'Текущая неделя' : 'Нажмите на интервал, чтобы вернуться к текущей неделе'),
    days.map(dayCard));
}

async function hwForm() {
  const subs = await call('subjects', {}, true);
  const pre = S.pre || {};
  const sel = h('select', {}, subs.map((s) => h('option', { value: s, selected: s === pre.subject }, s)));
  const date = h('input', { type: 'date', value: pre.date || S.boot.today });
  const text = h('textarea', { rows: 3, placeholder: 'Текст задания' });
  return h('section', { class: 'card' }, h('h3', {}, 'Добавить ДЗ'), sel, date, text,
    h('button', { onclick: safe(async () => {
      if (!text.value.trim()) return;
      await call('homework', { action: 'add', subject: sel.value, date: date.value, text: text.value });
      S.pre = null;
      render();
    }) }, 'Сохранить'));
}

async function viewHw() {
  const list = await call('homework', { action: 'list' }, true);
  const box = h('div', {});
  const form = S.boot.assistant ? await hwForm() : null;
  if (form && S.pre) box.append(form);
  if (!list.length) box.append(h('p', { class: 'muted' }, 'Список ДЗ пуст'));
  for (const x of list) {
    const card = h('section', { class: 'card' }, h('b', {}, x.subject + ' · ' + x.date.split('-').reverse().join('.')), h('p', {}, x.text));
    if (S.boot.assistant) card.append(h('button', { class: 'danger', onclick: safe(async () => { await call('homework', { action: 'delete', subject: x.subject, date: x.date }); render(); }) }, 'Удалить'));
    box.append(card);
  }
  if (form && !S.pre) box.append(form);
  return box;
}

async function viewSet() {
  const sch = {}; for (const x of S.boot.schedules) sch[x.course] = x.streams;
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
      S.tab = 'day'; S.date = S.boot.today; S.cm = S.boot.today.slice(0, 7); render();
    }) }, 'Сохранить'));
}

const TABS = [['day', 'Сегодня', viewDay], ['week', 'Неделя', viewWeek], ['hw', 'ДЗ', viewHw], ['set', 'Настройки', viewSet]];

async function render() {
  offline = false;
  $('#tabs').replaceChildren(...TABS.map(([id, t]) => h('button', { class: S.tab === id ? 'on' : '', onclick: () => { if (id !== 'hw') S.pre = null; S.tab = id; render(); } }, h('i', { html: ICONS[id] }), h('span', {}, t))));
  const v = $('#view');
  v.replaceChildren(h('p', { class: 'muted' }, 'Загрузка…'));
  try {
    const el = await TABS.find((x) => x[0] === S.tab)[2]();
    v.replaceChildren(...[offline ? h('p', { class: 'muted' }, 'Офлайн: показаны сохранённые данные') : null, el].filter(Boolean));
  } catch (e) {
    v.replaceChildren(h('p', { class: 'err' }, 'Ошибка: ' + ((e && e.message) || e)));
  }
}

(async () => {
  try { S.boot = await call('bootstrap', {}, true); } catch (e) { $('#view').replaceChildren(h('p', { class: 'err' }, 'Не удалось загрузить: ' + ((e && e.message) || e))); return; }
  S.date = S.boot.today;
  S.week = wk(S.boot.today);
  S.cm = S.boot.today.slice(0, 7);
  if (!S.boot.user.course) S.tab = 'set';
  render();
})();

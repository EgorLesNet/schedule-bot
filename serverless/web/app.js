const tg = window.Telegram && window.Telegram.WebApp;
if (tg) { tg.ready(); tg.expand(); }
let offline = false;
const S = { tab: 'day', date: '', week: '', cm: '', boot: null, pre: null, me: null, onlyFav: false, lastTap: 0, timer: null, marks: {} };

const hf = tg && tg.HapticFeedback;
const hv = (f) => { try { if (hf) f(); } catch (e) {} };
const buzz = {
  tap: () => hv(() => hf.impactOccurred('light')),
  heavy: () => hv(() => hf.impactOccurred('heavy')),
  pick: () => hv(() => hf.selectionChanged()),
  ok: () => hv(() => hf.notificationOccurred('success')),
  err: () => hv(() => hf.notificationOccurred('error')),
  warn: () => hv(() => hf.notificationOccurred('warning')),
  none: () => {},
};

const RAW = 'https://raw.githubusercontent.com/EgorLesNet/schedule-bot/main/';
const DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
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
const fullLabel = (s) => DAYS[wd(s)] + ', ' + fd(s);
const $ = (q) => document.querySelector(q);
const nowMsk = () => { const d = new Date(Date.now() + 3 * 3600000); return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() }; };
const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fmtMin = (m) => (m >= 60 ? Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин' : m + ' мин');
const hue = (s) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; };
const normMe = (m) => Object.assign({ done: [], notes: {}, favs: [] }, m || {});
const ask = (m) => new Promise((res) => { if (tg && tg.showConfirm) tg.showConfirm(m, res); else res(confirm(m)); });

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

const alertMsg = (m) => { if (tg && tg.showAlert) tg.showAlert(m); else alert(m); };

const safe = (f, kind) => async () => {
  try {
    const r = await f();
    if (r !== false) buzz[kind || 'ok']();
  } catch (e) {
    buzz.err();
    alertMsg(String((e && e.message) || e));
  }
};

const openLink = (u) => {
  try {
    if (tg && tg.openTelegramLink && u.startsWith('https://t.me/')) tg.openTelegramLink(u);
    else if (tg && tg.openLink && u.startsWith('http')) tg.openLink(u);
    else window.open(u, '_blank');
  } catch (e) { window.location.href = u; }
};

const STOP = '<>' + String.fromCharCode(34, 39);
const LINK_STYLE = 'color:var(--tg-theme-link-color,#2481cc);text-decoration:underline;word-break:break-all';

function linkify(text) {
  const s = String(text || '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    let start = -1;
    let j = i;
    while (j < s.length) {
      const k = s.indexOf('http', j);
      if (k < 0) break;
      if (s.startsWith('http://', k) || s.startsWith('https://', k)) { start = k; break; }
      j = k + 4;
    }
    if (start < 0) { out.push(s.slice(i)); break; }
    let end = start;
    while (end < s.length && s[end] > ' ' && STOP.indexOf(s[end]) < 0) end++;
    while (end > start && '.,;:!?)]}»'.indexOf(s[end - 1]) >= 0) end--;
    if (start > i) out.push(s.slice(i, start));
    const url = s.slice(start, end);
    out.push(h('a', { href: url, style: LINK_STYLE, onclick: (e) => { e.preventDefault(); openLink(url); } }, url));
    i = end;
  }
  return out;
}

const copy = async (t) => {
  try { await navigator.clipboard.writeText(t); buzz.ok(); alertMsg('Ссылка скопирована'); } catch (e) { alertMsg(t); }
};

function nav(prev, next, reset, label) {
  const go = (f) => () => { buzz.tap(); f(); render(); };
  return h('div', { class: 'nav' }, h('button', { onclick: go(prev) }, '◀'), h('button', { class: 'mid', onclick: go(reset) }, label), h('button', { onclick: go(next) }, '▶'));
}

async function monthMarks(month) {
  if (S.marks[month]) return S.marks[month];
  const r = await call('monthMarks', { month });
  S.marks[month] = r;
  return r;
}

function calendar() {
  const box = h('section', { class: 'cal' });
  let seq = 0;
  const dot = () => h('i', { style: 'display:block;width:5px;height:5px;border-radius:50%;background:currentColor;margin:1px auto 0' });
  const draw = () => {
    const my = ++seq;
    const month = S.cm;
    const [y, m] = month.split('-').map(Number);
    const first = month + '-01';
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const shift = (n) => { buzz.tap(); S.cm = new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); draw(); };
    const head = h('div', { class: 'head' },
      h('button', { onclick: () => shift(-1) }, '‹'),
      h('b', {}, MONTHS[m - 1] + ' ' + y),
      h('button', { onclick: () => shift(1) }, '›'));
    const grid = h('div', { class: 'grid' }, WD.map((x) => h('span', { class: 'wdn' }, x)));
    const btns = {};
    for (let i = 0; i < wd(first); i++) grid.append(h('span', {}));
    for (let day = 1; day <= dim; day++) {
      const ds = month + '-' + String(day).padStart(2, '0');
      const cls = 'd' + (ds === nowMsk().date ? ' today' : '') + (ds === S.date ? ' sel' : '');
      const b = h('button', { class: cls, onclick: () => { buzz.pick(); S.date = ds; render(); } }, day);
      btns[ds] = b;
      grid.append(b);
    }
    const todayBtn = h('button', { class: 'todaybtn', onclick: () => { buzz.tap(); jumpToday(); render(); } }, 'Сегодня');
    box.replaceChildren(head, grid, todayBtn);
    monthMarks(month).then((list) => {
      if (my !== seq) return;
      for (const ds of list) if (btns[ds]) btns[ds].append(dot());
    }).catch(() => {});
  };
  draw();
  return box;
}

function datePicker(dates, value, onPick) {
  const set = new Set(dates);
  const box = h('section', { class: 'cal' });
  let cm = (value || dates[0] || nowMsk().date).slice(0, 7);
  let sel = value;
  const draw = () => {
    const [y, m] = cm.split('-').map(Number);
    const first = cm + '-01';
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const shift = (n) => { buzz.tap(); cm = new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); draw(); };
    const head = h('div', { class: 'head' },
      h('button', { onclick: () => shift(-1) }, '‹'),
      h('b', {}, MONTHS[m - 1] + ' ' + y),
      h('button', { onclick: () => shift(1) }, '›'));
    const grid = h('div', { class: 'grid' }, WD.map((x) => h('span', { class: 'wdn' }, x)));
    for (let i = 0; i < wd(first); i++) grid.append(h('span', {}));
    for (let day = 1; day <= dim; day++) {
      const ds = cm + '-' + String(day).padStart(2, '0');
      const has = set.has(ds);
      grid.append(h('button', {
        class: 'd' + (ds === sel ? ' sel' : ''),
        disabled: !has,
        style: has ? 'font-weight:700;box-shadow:inset 0 0 0 2px var(--tg-theme-button-color,#2481cc)' : 'opacity:.25',
        onclick: () => { buzz.pick(); sel = ds; onPick(ds); draw(); },
      }, day));
    }
    box.replaceChildren(head, grid);
  };
  draw();
  return box;
}

function jumpToday() {
  const t = nowMsk().date;
  S.date = t; S.cm = t.slice(0, 7); S.week = wk(t);
}

function nowInfo(day) {
  const n = nowMsk();
  const cur = day.items.find((i) => mins(i.start) <= n.min && n.min < mins(i.end));
  if (cur) return { type: 'now', text: 'Сейчас идёт: ' + cur.summary + ' — до ' + cur.end };
  const next = day.items.find((i) => mins(i.start) > n.min);
  if (next) return { type: 'next', text: 'Следующая через ' + fmtMin(mins(next.start) - n.min) + ': ' + next.summary + ' в ' + next.start };
  return { type: 'done', text: day.items.length ? 'На сегодня пары закончились' : '' };
}

function liveBanner(day) {
  const box = h('div', { class: 'banner' });
  const upd = () => {
    const r = nowInfo(day);
    box.textContent = r.text;
    box.className = 'banner ' + r.type;
    box.style.display = r.text ? '' : 'none';
  };
  upd();
  S.timer = setInterval(upd, 30000);
  return box;
}

function noteForm(key, note) {
  const t = h('textarea', { rows: 2, placeholder: 'Личная заметка (видна только вам)' });
  t.value = note || '';
  return h('div', { class: 'linkform' }, t,
    h('button', { class: 'mini', onclick: safe(async () => { S.me = normMe(await call('me', { action: 'note', key, text: t.value })); render(); }) }, 'Сохранить'));
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
      buzz.heavy();
      await call('link', { action: 'delete', original: i.original, date: d.date, start: i.start, all: i.linkAll });
      render();
    }, 'none') }, 'Удалить ссылку'));
  }
  return form;
}

function editForm(d, i) {
  const nd = h('input', { type: 'date', value: d.date });
  const ns = h('input', { type: 'time', value: i.start });
  const ne = h('input', { type: 'time', value: i.end });
  const nn = h('input', { type: 'text', value: i.summary });
  const base = { original: i.original, date: d.date, start: i.start, summary: i.summary };
  const run = (ex, msg) => safe(async () => {
    if (msg) {
      buzz.warn();
      if (!(await ask(msg))) return false;
    }
    await call('schedit', Object.assign({}, base, typeof ex === 'function' ? ex() : ex));
    render();
  });
  return h('div', { class: 'linkform' },
    h('button', { class: 'mini danger', onclick: run({ action: 'cancel' }, 'Отменить эту пару для всех?') }, 'Отменить пару'),
    h('label', {}, h('span', { class: 'muted' }, 'Перенести на'), nd, h('div', { class: 'two' }, ns, ne)),
    h('button', { class: 'mini', onclick: run(() => ({ action: 'move', newDate: nd.value, newStart: ns.value, newEnd: ne.value, summary: i.summary, teacher: i.teacher, room: i.room })) }, 'Перенести'),
    h('label', {}, h('span', { class: 'muted' }, 'Название предмета (для всех занятий)'), nn),
    h('button', { class: 'mini', onclick: run(() => ({ action: 'rename', to: nn.value })) }, 'Переименовать'));
}

function lessonRow(d, i) {
  const key = i.original + '|' + d.date + '|' + i.start;
  const fav = S.me.favs.includes(i.original);
  const n = nowMsk();
  const live = d.date === n.date && mins(i.start) <= n.min && n.min < mins(i.end);
  const note = S.me.notes[key];
  const who = [i.teacher ? '👤 ' + i.teacher : '', i.room ? '🏫 ' + i.room : ''].filter(Boolean).join(' · ');
  const body = h('div', { class: 'grow' }, h('b', {}, (fav ? '★ ' : '') + i.summary + (i.online || i.link ? ' 💻' : '')),
    who ? h('div', { class: 'muted' }, who) : null,
    i.hw ? h('div', { class: 'hw', style: 'white-space:pre-wrap' }, '📝 ', linkify(i.hw)) : null,
    note ? h('div', { class: 'note', style: 'white-space:pre-wrap' }, '🗒 ', linkify(note)) : null);
  const acts = h('div', { class: 'acts' });
  const slot = h('div', {});
  const toggle = (id, fn) => () => {
    buzz.tap();
    if (slot.dataset.p === id) { slot.replaceChildren(); slot.dataset.p = ''; }
    else { slot.replaceChildren(fn()); slot.dataset.p = id; }
  };
  if (i.link) acts.append(h('button', { class: 'mini', onclick: () => { buzz.tap(); openLink(i.link); } }, '🔗 Подключиться'));
  acts.append(h('button', { class: 'mini alt', onclick: safe(async () => { S.me = normMe(await call('me', { action: 'fav', subject: i.original, value: !fav })); render(); }, 'tap') }, fav ? '★' : '☆'));
  acts.append(h('button', { class: 'mini alt', onclick: toggle('note', () => noteForm(key, note)) }, note ? '🗒 Заметка' : '🗒'));
  if (S.boot.assistant) {
    acts.append(h('button', { class: 'mini alt', onclick: toggle('link', () => linkForm(d, i)) }, i.link ? '✏️ Ссылка' : '＋ Ссылка'));
    acts.append(h('button', { class: 'mini alt', onclick: () => { buzz.tap(); S.pre = { subject: i.summary, date: d.date }; S.tab = 'hw'; render(); } }, '＋ ДЗ'));
    acts.append(h('button', { class: 'mini alt', onclick: toggle('edit', () => editForm(d, i)) }, '⚙️'));
  } else {
    acts.append(h('button', { class: 'mini alt', onclick: () => { buzz.tap(); S.pre = { subject: i.summary, date: d.date }; S.tab = 'hw'; render(); } }, '💡 ДЗ'));
  }
  body.append(acts, slot);
  return h('div', { class: 'lesson' + (live ? ' now' : ''), style: '--c:hsl(' + hue(i.original) + ' 65% 52%)' }, h('div', { class: 'time' }, i.start + '–' + i.end), body);
}

function dayCard(d) {
  const items = d.items.filter((i) => !S.onlyFav || S.me.favs.includes(i.original));
  const c = h('section', { class: 'card' }, h('h3', {}, d.label));
  if (!items.length) c.append(h('p', { class: 'muted' }, S.onlyFav ? 'Нет избранных пар' : 'Занятий нет'));
  for (const i of items) c.append(lessonRow(d, i));
  return c;
}

const favChip = () => h('button', { class: 'chip' + (S.onlyFav ? ' on' : ''), onclick: () => { buzz.tap(); S.onlyFav = !S.onlyFav; render(); } }, '★ Избранные');

function searchResults(list) {
  if (!list.length) return h('p', { class: 'muted center' }, 'Ничего не найдено');
  const box = h('div', {});
  let last = '';
  let card = null;
  for (const x of list) {
    if (x.date !== last) { last = x.date; card = h('section', { class: 'card' }, h('h3', {}, fullLabel(x.date))); box.append(card); }
    const who = [x.teacher ? '👤 ' + x.teacher : '', x.room ? '🏫 ' + x.room : ''].filter(Boolean).join(' · ');
    card.append(h('div', { class: 'res', style: '--c:hsl(' + hue(x.original) + ' 65% 52%)', onclick: () => { buzz.pick(); S.date = x.date; S.cm = x.date.slice(0, 7); render(); } },
      h('div', { class: 'time' }, x.start + '–' + x.end),
      h('div', { class: 'grow' }, h('b', {}, x.summary), who ? h('div', { class: 'muted' }, who) : null)));
  }
  return box;
}

async function viewDay() {
  const days = await call('range', { from: S.date, days: 1 }, true);
  const d = days[0];
  const live = nowMsk().date === d.date ? liveBanner(d) : null;
  const main = h('div', {}, live, calendar(), dayCard(d));
  const res = h('div', {});
  const q = h('input', { type: 'search', placeholder: 'Поиск: предмет или преподаватель' });
  let tm;
  q.addEventListener('input', () => {
    clearTimeout(tm);
    tm = setTimeout(async () => {
      const v = q.value.trim();
      if (v.length < 2) { res.replaceChildren(); main.style.display = ''; return; }
      main.style.display = 'none';
      res.replaceChildren(h('p', { class: 'muted center' }, 'Поиск…'));
      try { res.replaceChildren(searchResults(await call('search', { q: v }))); }
      catch (e) { res.replaceChildren(h('p', { class: 'err' }, 'Ошибка: ' + ((e && e.message) || e))); }
    }, 350);
  });
  return h('div', {}, h('div', { class: 'toolbar' }, q, favChip()), res, main);
}

async function viewWeek() {
  const days = await call('range', { from: S.week, days: 7 }, true);
  const cur = S.week === wk(nowMsk().date);
  return h('div', {},
    nav(() => { S.week = add(S.week, -7); }, () => { S.week = add(S.week, 7); }, () => { S.week = wk(nowMsk().date); }, weekLabel(S.week)),
    h('p', { class: 'muted center' }, cur ? 'Текущая неделя' : 'Нажмите на интервал, чтобы вернуться к текущей неделе'),
    h('div', { class: 'toolbar' }, h('span', { class: 'grow' }), favChip()),
    days.map(dayCard));
}

async function hwForm(mode = 'add') {
  const propose = mode === 'propose';
  const subs = await call('subjects', {}, true);
  const pre = S.pre || {};
  let date = '';
  const sel = h('select', {}, subs.map((s) => h('option', { value: s, selected: s === pre.subject }, s)));
  const pick = h('div', {});
  const chosen = h('p', { class: 'muted' }, '');
  const text = h('textarea', { rows: 3, placeholder: 'Текст задания' });
  const load = async () => {
    date = '';
    chosen.textContent = '';
    pick.replaceChildren(h('p', { class: 'muted' }, 'Загрузка дат…'));
    try {
      const dates = await call('subjectDates', { subject: sel.value });
      if (!dates.length) { pick.replaceChildren(h('p', { class: 'muted' }, 'Для этого предмета нет ближайших занятий')); return; }
      const show = (d) => { date = d; chosen.textContent = 'Выбрано: ' + d.split('-').reverse().join('.'); };
      show(pre.subject === sel.value && dates.includes(pre.date) ? pre.date : dates[0]);
      pick.replaceChildren(h('p', { class: 'muted' }, 'Отмечены даты, когда есть этот предмет'), datePicker(dates, date, show), chosen);
    } catch (e) { pick.replaceChildren(h('p', { class: 'err' }, 'Ошибка: ' + ((e && e.message) || e))); }
  };
  sel.addEventListener('change', () => { buzz.pick(); load(); });
  load();
  return h('section', { class: 'card' }, h('h3', {}, propose ? '💡 Предложить ДЗ' : 'Добавить ДЗ'),
    propose ? h('p', { class: 'muted' }, 'Ассистент проверит текст и опубликует его для всех') : null,
    sel, pick, text,
    h('button', { onclick: safe(async () => {
      if (!date) { buzz.err(); alertMsg('Выберите дату занятия'); return false; }
      if (!text.value.trim()) { buzz.err(); return false; }
      await call(propose ? 'proposal' : 'homework', { action: 'add', subject: sel.value, date, text: text.value });
      if (propose) alertMsg('Отправлено на проверку ассистенту');
      else S.marks = {};
      S.pre = null;
      render();
    }) }, propose ? 'Отправить на проверку' : 'Сохранить'));
}

function proposalCard(p, list) {
  const cur = list.find((x) => x.key === p.original + '|' + p.date);
  const t = h('textarea', { rows: 3 });
  t.value = p.text;
  return h('section', { class: 'card' },
    h('b', {}, '💡 ' + p.subject + ' · ' + p.date.split('-').reverse().join('.')),
    h('div', { class: 'muted' }, 'от ' + (p.uname ? '@' + p.uname : 'студента')),
    cur ? h('div', { class: 'muted' }, 'Сейчас в ДЗ: ' + cur.text) : null,
    t,
    h('button', { class: 'mini', onclick: safe(async () => { await call('proposal', { action: 'approve', id: p.id, text: t.value }); S.marks = {}; render(); }) }, '✓ Принять'),
    h('button', { class: 'mini danger', onclick: safe(async () => { buzz.heavy(); await call('proposal', { action: 'reject', id: p.id }); render(); }, 'none') }, '✕ Отклонить'));
}

function myProposals(mine) {
  const c = h('section', { class: 'card' }, h('h3', {}, 'Мои предложения'));
  for (const p of mine) {
    c.append(h('div', { class: 'erow' },
      h('span', {}, '⏳ ' + p.subject + ' · ' + p.date.split('-').reverse().join('.') + ': ' + p.text.slice(0, 60)),
      h('button', { class: 'mini danger', onclick: safe(async () => { await call('proposal', { action: 'cancel', id: p.id }); render(); }) }, 'Отозвать')));
  }
  return c;
}

async function viewHw() {
  const list = (await call('homework', { action: 'list' }, true)).map((x) => Object.assign({}, x, { key: x.key || x.subject + '|' + x.date }));
  const done = S.me.done;
  const sorted = list.slice().sort((a, b) => done.includes(a.key) - done.includes(b.key));
  const assistant = S.boot.assistant;
  const prop = await call('proposal', { action: 'list' }).catch(() => ({ pending: [], mine: [] }));
  const box = h('div', {});
  if (assistant && prop.pending.length) {
    box.append(h('p', { class: 'muted center' }, '💡 На проверке: ' + prop.pending.length));
    for (const p of prop.pending) box.append(proposalCard(p, list));
  }
  const form = await hwForm(assistant ? 'add' : 'propose');
  if (S.pre) box.append(form);
  if (!list.length) box.append(h('p', { class: 'muted' }, 'Список ДЗ пуст'));
  else box.append(h('p', { class: 'muted center' }, 'Выполнено ' + list.filter((x) => done.includes(x.key)).length + ' из ' + list.length));
  for (const x of sorted) {
    const dn = done.includes(x.key);
    const card = h('section', { class: 'card hwc' + (dn ? ' done' : '') }, h('b', {}, x.subject + ' · ' + x.date.split('-').reverse().join('.')), h('p', { style: 'white-space:pre-wrap' }, linkify(x.text)),
      h('button', { class: 'mini' + (dn ? '' : ' alt'), onclick: safe(async () => { S.me = normMe(await call('me', { action: 'done', key: x.key, value: !dn })); render(); }, 'tap') }, dn ? '✓ Сделано' : 'Отметить сделанным'));
    if (assistant) card.append(h('button', { class: 'mini danger', onclick: safe(async () => { buzz.heavy(); await call('homework', { action: 'delete', subject: x.subject, date: x.date }); S.marks = {}; render(); }, 'none') }, 'Удалить'));
    box.append(card);
  }
  if (!S.pre) box.append(form);
  if (!assistant && prop.mine.length) box.append(myProposals(prop.mine));
  return box;
}

function myFile() {
  const c = S.boot.schedules.find((s) => s.course === S.boot.user.course);
  const st = c && c.streams.find((s) => s.key === S.boot.user.stream);
  return st ? st.file : '';
}

function subCard() {
  const c = h('section', { class: 'card' }, h('h3', {}, 'Календарь'));
  const file = myFile();
  if (!file) { c.append(h('p', { class: 'muted' }, 'Сначала выберите курс и расписание')); return c; }
  const raw = RAW + encodeURIComponent(file);
  const web = raw.replace('https://', 'webcal://');
  c.append(h('p', { class: 'muted' }, 'Подписка на исходное расписание из файла. Отмены и переносы из приложения в календаре не отражаются.'),
    h('button', { onclick: () => { buzz.tap(); openLink(web); } }, 'Подписаться: Apple Календарь'),
    h('button', { class: 'alt', onclick: () => { buzz.tap(); openLink('https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(web)); } }, 'Подписаться: Google Календарь'),
    h('button', { class: 'alt', onclick: () => copy(raw) }, 'Копировать ссылку'));
  return c;
}

async function editsCard() {
  const r = await call('schedit', { action: 'list' });
  const c = h('section', { class: 'card' }, h('h3', {}, 'Изменения расписания'));
  if (!r.edits.length && !r.renames.length) c.append(h('p', { class: 'muted' }, 'Изменений нет'));
  for (const e of r.edits) {
    c.append(h('div', { class: 'erow' },
      h('span', {}, (e.kind === 'cancel' ? '❌ ' : '↪️ ') + e.date.split('-').reverse().join('.') + ' · ' + e.ev + (e.info ? ' → ' + e.info : '')),
      h('button', { class: 'mini danger', onclick: safe(async () => { await call('schedit', { action: 'undo', date: e.date, ev: e.ev }); render(); }) }, 'Вернуть')));
  }
  for (const n of r.renames) {
    c.append(h('div', { class: 'erow' },
      h('span', {}, '✏️ ' + n.from + ' → ' + n.to),
      h('button', { class: 'mini danger', onclick: safe(async () => { await call('schedit', { action: 'rename', original: n.from, to: '' }); render(); }) }, 'Сбросить')));
  }
  return c;
}

async function viewSet() {
  const sch = {}; for (const x of S.boot.schedules) sch[x.course] = x.streams;
  const FAC = S.boot.faculties || [];
  const FILES = S.boot.files || {};
  const u = S.boot.user;
  const lab = (t, el) => h('label', {}, h('span', { class: 'muted' }, t), el);
  const defFac = () => {
    const ks = Object.keys(FILES).filter((k) => (FILES[k] || []).length).map((k) => Number(k.split(':')[0]));
    return ks.length ? Math.min(...ks) : 0;
  };
  const f0 = Number.isInteger(u.faculty) ? u.faculty : defFac();
  const fac = h('select', {}, FAC.map((f, i) => h('option', { value: String(i), selected: i === f0 }, f.name)));
  const courseList = Array.from({ length: S.boot.courses || 4 }, (_, i) => String(i + 1));
  const course = h('select', {}, courseList.map((c) => h('option', { value: c, selected: c === u.course }, c + ' курс')));
  const dir = h('select', {});
  const stream = h('select', {});
  const info = h('p', { class: 'muted' }, '');
  const streamLab = lab('Поток / расписание', stream);
  const streamsNow = () => (sch[course.value] || []).filter((s) => (FILES[fac.value + ':' + dir.value] || []).includes(s.file));
  const fillDir = () => {
    const f = FAC[Number(fac.value)] || { directions: [] };
    const want = Number(fac.value) === u.faculty ? u.direction : 0;
    dir.replaceChildren(...f.directions.map((n, i) => h('option', { value: String(i), selected: i === want }, n)));
  };
  const fillStream = () => {
    const list = streamsNow();
    stream.replaceChildren(...list.map((s) => h('option', { value: s.key, selected: s.key === u.stream }, s.name)));
    streamLab.style.display = list.length > 1 ? '' : 'none';
    info.textContent = list.length ? '' : 'Расписание для этого направления и курса пока не добавлено';
  };
  fillDir();
  fillStream();
  fac.addEventListener('change', () => { buzz.pick(); fillDir(); fillStream(); });
  course.addEventListener('change', () => { buzz.pick(); fillStream(); });
  dir.addEventListener('change', () => { buzz.pick(); fillStream(); });
  const eng = h('select', {}, [['', 'Без английского'], ['morning', '9:00–12:10'], ['afternoon', '14:00–17:10']].map(([v, t]) => h('option', { value: v, selected: v === (u.englishTime || '') }, t)));
  const rem = h('input', { type: 'checkbox', checked: !!u.reminders });
  rem.addEventListener('change', () => buzz.pick());
  const form = h('section', { class: 'card' }, h('h3', {}, 'Настройки'),
    lab('Факультет', fac), lab('Курс', course), lab('Направление', dir), streamLab, info,
    lab('Английский в четверг', eng),
    h('label', { class: 'row' }, rem, 'Уведомления: ДЗ и изменения расписания'),
    h('button', { onclick: safe(async () => {
      if (!streamsNow().length) { buzz.err(); alertMsg('Для выбранных направления и курса расписание пока не добавлено'); return false; }
      S.boot.user = await call('settings', { faculty: Number(fac.value), direction: Number(dir.value), course: course.value, stream: stream.value, englishTime: eng.value || null, reminders: rem.checked });
      S.marks = {};
      jumpToday(); S.tab = 'day'; render();
    }) }, 'Сохранить'));
  const box = h('div', {}, form, subCard());
  if (S.boot.assistant && u.course) { try { box.append(await editsCard()); } catch (e) {} }
  return box;
}

const TABS = [['day', 'Сегодня', viewDay], ['week', 'Неделя', viewWeek], ['hw', 'ДЗ', viewHw], ['set', 'Настройки', viewSet]];

async function render() {
  clearInterval(S.timer);
  offline = false;
  $('#tabs').replaceChildren(...TABS.map(([id, t]) => h('button', {
    class: S.tab === id ? 'on' : '',
    onclick: () => {
      buzz.pick();
      const now = Date.now();
      const dbl = id === S.tab && now - S.lastTap < 350;
      S.lastTap = now;
      if (id !== 'hw') S.pre = null;
      S.tab = id;
      if (dbl) jumpToday();
      render();
    },
  }, h('i', { html: ICONS[id] }), h('span', {}, t))));
  const v = $('#view');
  v.replaceChildren(h('p', { class: 'muted' }, 'Загрузка…'));
  try {
    const el = await TABS.find((x) => x[0] === S.tab)[2]();
    v.replaceChildren(...[offline ? h('p', { class: 'muted' }, 'Офлайн: показаны сохранённые данные') : null, el].filter(Boolean));
  } catch (e) {
    v.replaceChildren(h('p', { class: 'err' }, 'Ошибка: ' + ((e && e.message) || e)));
  }
}

let tx = 0;
let ty = 0;
document.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; tx = t.clientX; ty = t.clientY; }, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!S.boot) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - tx;
  const dy = t.clientY - ty;
  if (Math.abs(dx) < 70 || Math.abs(dy) > 45) return;
  if (e.target.closest && e.target.closest('input,textarea,select,.cal,nav')) return;
  const dir = dx < 0 ? 1 : -1;
  if (S.tab === 'day') { buzz.pick(); S.date = add(S.date, dir); S.cm = S.date.slice(0, 7); render(); }
  else if (S.tab === 'week') { buzz.pick(); S.week = add(S.week, 7 * dir); render(); }
}, { passive: true });

(async () => {
  try { S.boot = await call('bootstrap', {}, true); } catch (e) { $('#view').replaceChildren(h('p', { class: 'err' }, 'Не удалось загрузить: ' + ((e && e.message) || e))); return; }
  S.me = normMe(S.boot.me);
  jumpToday();
  if (!S.boot.user.course) S.tab = 'set';
  render();
})();

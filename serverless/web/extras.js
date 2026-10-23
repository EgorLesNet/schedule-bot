// Дополнения поверх app.js и settings.js: время напоминания, группировка ДЗ по срокам, журнал правок расписания
(function () {
  const DEFAULT_AT = '20:00';
  const REMIND_TIMES = (() => { const o = []; for (let m = 360; m <= 1410; m += 30) o.push(hhmm(m)); return o; })();
  const HW_GROUPS = [['over', '⚠️ Просрочено'], ['today', 'Сегодня'], ['tom', 'Завтра'], ['week', 'На этой неделе'], ['later', 'Позже'], ['done', '✓ Выполнено']];

  const stamp = (ms) => {
    const d = new Date(ms + 3 * 3600000);
    return String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') + ' ' + hhmm(d.getUTCHours() * 60 + d.getUTCMinutes());
  };

  // ---------- Время напоминания: карточка сразу после «Уведомления» ----------
  function remindCard(root) {
    if (root.querySelector('.remind-card')) return;
    const anchor = root.querySelector('.alerts-card');
    if (!anchor) return;
    const u = (S.boot && S.boot.user) || {};
    const cur = u.remindAt || DEFAULT_AT;
    const sel = h('select', {}, REMIND_TIMES.map((t) => h('option', { value: t, selected: t === cur }, t)));
    sel.addEventListener('change', safe(async () => {
      const r = await call('remindAt', { at: sel.value });
      if (S.boot) S.boot.user = Object.assign({}, S.boot.user, r);
    }, 'pick'));
    anchor.insertAdjacentElement('afterend', h('section', { class: 'card remind-card' }, h('h3', {}, 'Время напоминания'),
      h('p', { class: 'muted' }, 'В это время бот присылает в чат расписание на завтра и домашние задания, если напоминания включены в настройках расписания. Время московское, отправка возможна с небольшой задержкой.'),
      sel));
  }

  // ---------- ДЗ: группы «Сегодня / Завтра / На этой неделе / Позже / Выполнено» ----------
  function groupHw(root) {
    if (root.querySelector('.hw-group')) return;
    const cards = [...root.querySelectorAll('.hwc')];
    if (!cards.length) return;
    const now = nowMsk().date;
    const tomorrow = add(now, 1);
    const weekEnd = add(wk(now), 6);
    const items = [];
    for (const el of cards) {
      const title = (el.querySelector('b') || {}).textContent || '';
      const m = /(\d{2})\.(\d{2})\.(\d{4})\s*$/.exec(title);
      if (!m) return;
      const date = m[3] + '-' + m[2] + '-' + m[1];
      const kind = el.classList.contains('done') ? 'done' : date < now ? 'over' : date === now ? 'today' : date === tomorrow ? 'tom' : date <= weekEnd ? 'week' : 'later';
      items.push({ el, date, title, kind });
    }
    const parent = cards[0].parentElement;
    const marker = document.createComment('');
    parent.insertBefore(marker, cards[0]);
    const frag = document.createDocumentFragment();
    for (const [kind, label] of HW_GROUPS) {
      const list = items.filter((x) => x.kind === kind).sort((a, b) => (kind === 'done' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)) || a.title.localeCompare(b.title, 'ru'));
      if (!list.length) continue;
      frag.append(h('p', { class: 'muted hw-group', style: 'font-weight:700;margin:14px 4px 4px;text-align:left' }, label + ' · ' + list.length));
      for (const x of list) frag.append(x.el);
    }
    parent.insertBefore(frag, marker);
    marker.remove();
  }

  // ---------- Журнал правок: карточка сразу после «Изменения расписания» (только ассистенты) ----------
  function logCard(root) {
    if (root.querySelector('.log-card') || !Array.isArray(S.editLog)) return;
    const head = [...root.querySelectorAll('h3')].find((x) => x.textContent === 'Изменения расписания');
    const card = head && head.closest('section');
    if (!card) return;
    const rows = S.editLog.slice(0, 30).map((e) => h('div', { class: 'erow' }, h('span', {}, stamp(e.t) + ' · ' + e.by + ' — ' + e.text)));
    card.insertAdjacentElement('afterend', h('section', { class: 'card log-card' }, h('h3', {}, 'Журнал правок'), rows.length ? rows : h('p', { class: 'muted' }, 'Пока пусто')));
  }

  const view = document.getElementById('view');
  if (view) {
    new MutationObserver(() => {
      try { remindCard(view); } catch (e) {}
      try { groupHw(view); } catch (e) {}
      try { logCard(view); } catch (e) {}
    }).observe(view, { childList: true, subtree: true });
  }

  // Ответ schedit содержит журнал: запоминаем, пока app.js рисует список правок
  const prevCall = call;
  call = function (name, p, cache) {
    const r = prevCall(name, p, cache);
    if (name === 'schedit') r.then((res) => { if (res && Array.isArray(res.log)) S.editLog = res.log; }).catch(() => {});
    return r;
  };

  // Платформа не умеет запускать код по расписанию: открытое приложение раз в 5 минут просит сервер разослать напоминания, чей час пришёл
  const tick = () => {
    if (document.visibilityState !== 'visible') return;
    try { call('tick', {}).catch(() => {}); } catch (e) {}
  };
  setTimeout(tick, 5000);
  setInterval(tick, 300000);
})();

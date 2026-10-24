// Дополнения поверх app.js и settings.js: время напоминания, Вкладка «ДЗ» (даты, форма сверху), журнал правок расписания
(function () {
  const DEFAULT_AT = '20:00';
  const REMIND_TIMES = (() => { const o = []; for (let m = 360; m <= 1410; m += 30) o.push(hhmm(m)); return o; })();

  // Кнопки вне карточек («Добавить ДЗ», «Новое объявление»): тот же вид, что у `.card button` и `.card button.alt` в style.css
  const css = document.createElement('style');
  css.textContent = 'button.big{display:block;width:100%;margin:0 0 12px;padding:10px;border:0;border-radius:14px;background:var(--tg-theme-button-color,#2481cc);color:var(--tg-theme-button-text-color,#fff);font-size:15px}button.big.alt{background:#8883;color:inherit}';
  document.head.append(css);

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

  // ---------- ДЗ: заголовки по датам (внутри даты сначала невыполненные) ----------
  function dateLabel(date, now) {
    const rel = date === now ? 'Сегодня · ' : date === add(now, 1) ? 'Завтра · ' : date === add(now, 2) ? 'Послезавтра · ' : '';
    return (date < now ? '⚠️ ' : '') + rel + fullLabel(date);
  }

  function groupHw(root) {
    if (root.querySelector('.hw-group')) return;
    const cards = [...root.querySelectorAll('.hwc')];
    if (!cards.length) return;
    const now = nowMsk().date;
    const items = [];
    for (const el of cards) {
      const title = (el.querySelector('b') || {}).textContent || '';
      const m = /(\d{2})\.(\d{2})\.(\d{4})\s*$/.exec(title);
      if (!m) return;
      items.push({ el, title, date: m[3] + '-' + m[2] + '-' + m[1], done: el.classList.contains('done') });
    }
    items.sort((a, b) => a.date.localeCompare(b.date) || (a.done - b.done) || a.title.localeCompare(b.title, 'ru'));
    const count = {};
    for (const x of items) count[x.date] = (count[x.date] || 0) + 1;
    const parent = cards[0].parentElement;
    const marker = document.createComment('');
    parent.insertBefore(marker, cards[0]);
    const frag = document.createDocumentFragment();
    let last = '';
    for (const x of items) {
      if (x.date !== last) {
        last = x.date;
        frag.append(h('p', { class: 'muted hw-group', style: 'font-weight:700;margin:14px 4px 4px;text-align:left' }, dateLabel(x.date, now) + ' · ' + count[x.date]));
      }
      frag.append(x.el);
    }
    parent.insertBefore(frag, marker);
    marker.remove();
  }

  // ---------- ДЗ: форма добавления в начале страницы, по умолчанию свёрнута в одну кнопку ----------
  // Если вкладку открыли кнопкой «ДЗ» у пары (S.pre), форма раскрыта сразу
  function hwFormTop(root) {
    if (root.querySelector('.hw-form-toggle')) return;
    const form = [...root.querySelectorAll('section.card')].find((s) => {
      const t = s.querySelector('h3');
      return t && /^(Добавить ДЗ|💡 Предложить ДЗ)$/.test(t.textContent.trim());
    });
    if (!form) return;
    const parent = form.parentElement;
    const open = !!S.pre;
    const name = form.querySelector('h3').textContent.trim().replace(/^💡\s*/, '');
    const btn = h('button', { class: 'big hw-form-toggle' });
    const setBtn = (isOpen) => {
      btn.textContent = isOpen ? '✕ Свернуть' : '＋ ' + name;
      btn.className = 'big hw-form-toggle' + (isOpen ? ' alt' : '');
    };
    setBtn(open);
    btn.addEventListener('click', () => {
      buzz.tap();
      const hidden = form.style.display === 'none';
      form.style.display = hidden ? '' : 'none';
      setBtn(hidden);
    });
    form.style.display = open ? '' : 'none';
    parent.prepend(form);
    form.before(btn);
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
      try { hwFormTop(view); } catch (e) {}
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

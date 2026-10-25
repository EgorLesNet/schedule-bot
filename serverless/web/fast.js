// Быстрый старт и офлайн-режим: кэш показывается сразу, свежие данные подменяют его; плашка «Нет сети»; скелетоны вместо «Загрузка…»; карточка «Добавить на главный экран» в настройках.
// Подключается ДО app.js (сразу после telegram-web-app.js): обёртка вокруг Telegram.WebApp.Serverless.call должна встать раньше первого запроса. app.js не правится.
(function () {
  const tg = window.Telegram && window.Telegram.WebApp;
  const API = tg && tg.Serverless;
  const LS = (() => { try { return window.localStorage; } catch (e) { return null; } })();
  const uid = String((tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id) || '0');
  const PFX = 'sw3:';
  const IDX = PFX + 'idx:' + uid;
  const MAX_KEYS = 80;
  const TTL = 14 * 86400000;
  const AFTER_WRITE = 6000;
  const view = document.getElementById('view');
  let lastMut = 0;
  let offlineOn = false;
  let bar = null;

  // ---------- Кэш (отдельно для каждого пользователя Telegram: на общем устройстве чужие данные не показываются) ----------
  const readIdx = () => { try { return JSON.parse(LS.getItem(IDX)) || []; } catch (e) { return []; } };
  const ckey = (name, p) => PFX + uid + ':' + name + ':' + JSON.stringify(p);

  function load(key) {
    if (!LS) return null;
    try {
      const r = JSON.parse(LS.getItem(key));
      if (!r || typeof r.s !== 'string' || Date.now() - r.t > TTL) return null;
      return r;
    } catch (e) { return null; }
  }

  function save(key, raw) {
    if (!LS || typeof raw !== 'string') return;
    try {
      LS.setItem(key, JSON.stringify({ t: Date.now(), s: raw }));
      const idx = readIdx().filter((x) => x[0] !== key);
      idx.push([key, Date.now()]);
      while (idx.length > MAX_KEYS) LS.removeItem(idx.shift()[0]);
      LS.setItem(IDX, JSON.stringify(idx));
    } catch (e) {
      try { for (const x of readIdx()) LS.removeItem(x[0]); LS.removeItem(IDX); } catch (e2) {}
    }
  }

  // Только чтения, которым безопасно показать кэш: стартовые данные, расписание, список ДЗ, предметы, экзамены, отметки месяца
  const isRead = (name, p) => name === 'bootstrap' || name === 'range' || name === 'subjects' || name === 'exams' || name === 'monthMarks' || (name === 'homework' && p.action === 'list');
  const READ_ACTIONS = ['list', 'stats', 'assistants', 'inbox', 'refresh', 'history', 'archive', 'track'];
  const isMutation = (name, p) => name === 'settings' || name === 'alerts' || name === 'hwAlerts' || name === 'remindAt' || !!(p.action && !p.preview && READ_ACTIONS.indexOf(p.action) < 0);

  const mskToday = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  // Для сравнения «изменилось ли» у стартовых данных не учитываем поля, которые меняются сами (время захода, дата)
  function sig(name, raw) {
    if (name !== 'bootstrap') return raw;
    try {
      const o = JSON.parse(raw);
      delete o.today;
      if (o.user) { delete o.user.seen; delete o.user.since; }
      return JSON.stringify(o);
    } catch (e) { return raw; }
  }
  function served(name, raw) {
    const o = JSON.parse(raw);
    if (name === 'bootstrap' && o && typeof o === 'object') o.today = mskToday();
    return o;
  }

  // ---------- Плашка «Нет сети» ----------
  function setOffline(on) {
    if (offlineOn === on) return;
    offlineOn = on;
    try {
      if (on) {
        if (!bar) { bar = document.createElement('div'); bar.className = 'net-bar'; bar.textContent = 'Нет сети · показаны сохранённые данные'; }
        if (document.body && !bar.isConnected) document.body.append(bar);
        requestAnimationFrame(() => { if (offlineOn) bar.classList.add('on'); });
      } else if (bar) {
        bar.classList.remove('on');
        setTimeout(() => { if (!offlineOn && bar) bar.remove(); }, 300);
      }
    } catch (e) {}
  }
  const okNet = () => { if (!(navigator.onLine === false)) setOffline(false); };
  const failNet = (err) => { if (err && err.type !== 'ENDPOINT_ERROR') setOffline(true); };

  // ---------- Перерисовка после обновления данных ----------
  let rr = null;
  let lastRR = 0;
  let tries = 0;
  function hasDraft() {
    if (!view) return false;
    for (const f of view.querySelectorAll('textarea, input[type=text], input[type=search], input[type=url]')) if (f.value) return true;
    return false;
  }
  function attempt() {
    rr = null;
    if (typeof render !== 'function') return;
    const first = view && view.firstElementChild;
    const loading = !!(first && first.classList && first.classList.contains('sk-wrap')) || !!(view && view.children.length === 1 && /Загрузка/.test(view.textContent));
    const ae = document.activeElement;
    const typing = !!(ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName));
    if (loading || typing || document.hidden || hasDraft()) {
      if (tries++ < 8) rr = setTimeout(attempt, 1500);
      return;
    }
    const gap = Date.now() - lastRR;
    if (gap < 4000) { rr = setTimeout(attempt, 4000 - gap); return; }
    lastRR = Date.now();
    const y = window.scrollY || 0;
    try { render(); } catch (e) { return; }
    setTimeout(() => window.scrollTo(0, y), 80);
    setTimeout(() => window.scrollTo(0, y), 350);
  }
  function scheduleRerender() {
    if (rr) return;
    tries = 0;
    rr = setTimeout(attempt, 400);
  }

  function changed(name, raw) {
    if (name === 'bootstrap') {
      try {
        const o = JSON.parse(raw);
        if (typeof S !== 'undefined' && S.boot) {
          S.boot = o;
          if (o.me && typeof normMe === 'function' && Date.now() - lastMut > AFTER_WRITE) S.me = normMe(o.me);
        }
      } catch (e) {}
    }
    scheduleRerender();
  }

  // ---------- Обёртка вокруг Serverless.call ----------
  if (API && typeof API.call === 'function') {
    const raw = API.call.bind(API);
    try {
      API.call = function (name, p, cb) {
        p = p || {};
        const done = (fn) => (err, res) => {
          if (err) failNet(err); else okNet();
          if (fn) fn(err, res);
        };
        if (!isRead(name, p)) {
          return raw(name, p, done((err, res) => {
            if (!err && isMutation(name, p)) lastMut = Date.now();
            if (cb) cb(err, res);
          }));
        }
        const key = ckey(name, p);
        const hit = Date.now() - lastMut > AFTER_WRITE ? load(key) : null;
        if (!hit) {
          return raw(name, p, done((err, res) => {
            if (!err && res !== undefined) save(key, JSON.stringify(res));
            if (cb) cb(err, res);
          }));
        }
        let ok = false;
        try { if (cb) cb(null, served(name, hit.s)); ok = true; } catch (e) {}
        if (!ok) return raw(name, p, done(cb));
        return raw(name, p, (err, res) => {
          if (err) { failNet(err); return; }
          okNet();
          if (res === undefined) return;
          const s = JSON.stringify(res);
          save(key, s);
          if (sig(name, s) !== sig(name, hit.s)) changed(name, s);
          else if (name === 'bootstrap' && typeof S !== 'undefined' && S.boot) S.boot = res;
        });
      };
    } catch (e) {}
  }
  window.addEventListener('offline', () => setOffline(true));
  window.addEventListener('online', () => { setOffline(false); scheduleRerender(); });
  if (navigator.onLine === false) setOffline(true);

  if (!view) return;

  // ---------- Скелетоны ----------
  const css = document.createElement('style');
  css.textContent = [
    '.sk{border-radius:10px;background:linear-gradient(90deg,rgba(136,136,136,.14) 25%,rgba(136,136,136,.28) 50%,rgba(136,136,136,.14) 75%);background-size:200% 100%;animation:skm 1.3s ease-in-out infinite}',
    '@keyframes skm{0%{background-position:200% 0}100%{background-position:-200% 0}}',
    '.net-bar{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 8px);z-index:120;transform:translate(-50%,-160%);opacity:0;transition:transform .3s ease,opacity .3s ease;padding:8px 14px;border-radius:16px;font-size:13px;font-weight:600;white-space:nowrap;background:rgba(255,149,0,.95);color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.25);pointer-events:none}',
    '.net-bar.on{transform:translate(-50%,0);opacity:1}',
    '@media (prefers-reduced-motion:reduce){.sk{animation:none}.net-bar{transition:none}}',
  ].join('\n');
  document.head.append(css);

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
    }
    for (const kid of kids) if (kid) e.append(kid);
    return e;
  }
  const sk = (w, h, extra) => el('div', { class: 'sk', style: 'width:' + w + ';height:' + h + 'px;' + (extra || '') });
  const lessonRow = () => el('div', { style: 'display:flex;gap:10px;padding:8px 0' }, sk('72px', 14), el('div', { style: 'flex:1' }, sk('70%', 16, 'margin-bottom:6px'), sk('45%', 12)));
  const dayCard = (n) => { const c = el('section', { class: 'card' }, sk('45%', 16, 'margin-bottom:6px')); for (let i = 0; i < n; i++) c.append(lessonRow()); return c; };
  const hwCard = () => el('section', { class: 'card' }, sk('55%', 16, 'margin-bottom:10px'), sk('100%', 12, 'margin-bottom:6px'), sk('80%', 12, 'margin-bottom:10px'), sk('120px', 30));
  const setCard = () => el('section', { class: 'card' }, sk('40%', 16, 'margin-bottom:10px'), sk('100%', 38, 'margin-bottom:8px'), sk('100%', 38));

  function skeleton(tab) {
    const wrap = el('div', { class: 'sk-wrap', 'aria-busy': 'true' });
    if (tab === 'day') wrap.append(el('section', { class: 'cal' }, sk('50%', 18, 'margin:0 auto 10px'), sk('100%', 190)), dayCard(4));
    else if (tab === 'week') wrap.append(el('div', { style: 'display:flex;gap:8px;margin-bottom:12px' }, sk('48px', 40), sk('100%', 40, 'flex:1'), sk('48px', 40)), dayCard(3), dayCard(3), dayCard(2));
    else if (tab === 'hw') wrap.append(hwCard(), hwCard(), hwCard());
    else wrap.append(setCard(), setCard(), setCard());
    return wrap;
  }

  function placeholder() {
    if (view.children.length !== 1) return;
    const only = view.firstElementChild;
    if (!only || only.tagName !== 'P' || only.textContent.trim() !== 'Загрузка…') return;
    view.replaceChildren(skeleton(typeof S !== 'undefined' ? S.tab : 'day'));
  }

  // ---------- Настройки: «Добавить на главный экран» ----------
  const tgHome = !!(tg && typeof tg.isVersionAtLeast === 'function' && tg.isVersionAtLeast('8.0') && typeof tg.addToHomeScreen === 'function' && typeof tg.checkHomeScreenStatus === 'function');
  let homeStatus = null;
  let homeBusy = false;
  let installEvent = null;
  const standalone = !!((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent || '');

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });

  function checkHome(cb) {
    try { tg.checkHomeScreenStatus((s) => { homeStatus = s; if (cb) cb(s); }); } catch (e) { homeStatus = 'unsupported'; if (cb) cb('unsupported'); }
  }
  if (tgHome && tg.onEvent) tg.onEvent('homeScreenAdded', () => { homeStatus = 'added'; const c = view.querySelector('.a2hs-card'); if (c) c.replaceWith(homeCard() || document.createComment('')); });

  function homeCard() {
    const card = el('section', { class: 'card a2hs-card' }, el('h3', {}, 'Быстрый доступ'));
    if (tgHome) {
      if (homeStatus === 'unsupported' || homeStatus === null) return null;
      if (homeStatus === 'added') { card.append(el('p', { class: 'muted' }, '✓ Приложение уже на главном экране')); return card; }
      card.append(el('p', { class: 'muted' }, 'Значок расписания на главном экране телефона: открывается в один тап, без поиска бота в чатах.'),
        el('button', { onclick: () => {
          try { if (typeof buzz !== 'undefined') buzz.tap(); } catch (e) {}
          try { tg.addToHomeScreen(); } catch (e) {}
          setTimeout(() => checkHome(() => { const c = view.querySelector('.a2hs-card'); const n = homeCard(); if (c && n) c.replaceWith(n); }), 1500);
        } }, 'Добавить на главный экран'));
      return card;
    }
    if (standalone) return null;
    if (installEvent) {
      card.append(el('p', { class: 'muted' }, 'Установите расписание как приложение: значок на главном экране и быстрый запуск.'),
        el('button', { onclick: async () => { try { installEvent.prompt(); await installEvent.userChoice; } catch (e) {} installEvent = null; const c = view.querySelector('.a2hs-card'); if (c) c.remove(); } }, 'Установить приложение'));
      return card;
    }
    if (ios) {
      card.append(el('p', { class: 'muted' }, 'В Safari нажмите «Поделиться» и выберите «На экран «Домой»», чтобы добавить значок расписания.'));
      return card;
    }
    return null;
  }

  function ensureHome() {
    if (typeof S === 'undefined' || S.tab !== 'set') return;
    if (!view.querySelector('.alerts-card') || view.querySelector('.a2hs-card')) return;
    const put = () => {
      if (S.tab !== 'set' || view.querySelector('.a2hs-card') || !view.querySelector('.alerts-card')) return;
      const c = homeCard();
      if (!c) return;
      const cards = view.querySelectorAll('section.card');
      cards[cards.length - 1].insertAdjacentElement('afterend', c);
    };
    if (tgHome && homeStatus === null) {
      if (homeBusy) return;
      homeBusy = true;
      checkHome(() => { homeBusy = false; put(); });
    } else put();
  }

  new MutationObserver(() => {
    try { placeholder(); } catch (e) {}
    try { ensureHome(); } catch (e) {}
  }).observe(view, { childList: true, subtree: true });
})();

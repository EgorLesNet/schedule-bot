// Подключается после app.js: первый запуск, направления в настройках зависят от курса, уведомления об изменениях, календарь (подписка и экспорт с правками), рекламные плашки, админ-панель
(function () {
  const LABEL = /^(.*) \(([0-9]+) курс\)$/;
  const RAW_FILES = 'https://raw.githubusercontent.com/EgorLesNet/schedule-bot/tgcloud/';
  const AD_W = 900;
  const AD_H = 163;

  // ---------- Реклама: картинки docs/ads/ad1.*, ad2.*, ... размером 900×163 ----------
  let ADS = [];
  let adsReady = null;

  function loadAds() {
    if (!adsReady) {
      adsReady = call('ads', { action: 'list' }, true)
        .then((r) => { ADS = (r && r.ads) || []; return r; })
        .catch(() => { adsReady = null; return null; });
    }
    return adsReady;
  }

  // Учёт показов и кликов: копим в памяти и отправляем пачкой (раз в 30 с, при сворачивании и при клике)
  const pending = { views: {}, clicks: {} };
  let pendingN = 0;

  function flushAds() {
    if (!pendingN) return;
    const body = { action: 'track', views: pending.views, clicks: pending.clicks };
    pending.views = {};
    pending.clicks = {};
    pendingN = 0;
    call('ads', body).catch(() => {});
  }

  const countView = (id) => { pending.views[id] = (pending.views[id] || 0) + 1; pendingN++; };
  const countClick = (id) => { pending.clicks[id] = (pending.clicks[id] || 0) + 1; pendingN++; flushAds(); };
  setInterval(flushAds, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAds(); });
  window.addEventListener('pagehide', flushAds);

  function adBanner() {
    const items = ADS.slice();
    if (!items.length) return null;
    const card = document.querySelector('.card');
    const radius = card ? getComputedStyle(card).borderRadius : '16px';
    const box = h('div', { class: 'ad', style: 'position:relative;overflow:hidden;width:100%;aspect-ratio:' + AD_W + ' / ' + AD_H + ';margin:12px 0;user-select:none;background:rgba(127,127,127,.12);border-radius:' + radius });
    const imgs = items.map((a, i) => {
      const im = h('img', { src: a.src, alt: '', draggable: 'false', style: 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:opacity .8s ease;opacity:' + (i === 0 ? '1' : '0') });
      im.addEventListener('error', () => { im.dataset.bad = '1'; });
      return im;
    });
    box.append(...imgs);
    let cur = 0;
    const urlOf = (i) => { const a = ADS.find((x) => x.id === items[i].id); return a ? a.url : ''; };
    const sync = () => { box.style.cursor = urlOf(cur) ? 'pointer' : 'default'; };
    sync();
    if (document.visibilityState === 'visible') countView(items[0].id);
    box.addEventListener('click', () => {
      const u = urlOf(cur);
      if (!u) return;
      buzz.tap();
      countClick(items[cur].id);
      openLink(u);
    });
    if (imgs.length > 1) {
      const t = setInterval(() => {
        if (!box.isConnected) { clearInterval(t); return; }
        let next = cur;
        for (let k = 1; k <= imgs.length; k++) {
          const c = (cur + k) % imgs.length;
          if (!imgs[c].dataset.bad) { next = c; break; }
        }
        if (next === cur) return;
        imgs[cur].style.opacity = '0';
        imgs[next].style.opacity = '1';
        cur = next;
        sync();
        if (document.visibilityState === 'visible') countView(items[cur].id);
      }, 5000);
    }
    return box;
  }

  // Сегодня: внизу экрана. Неделя: сразу под выбором недели, перед расписанием.
  function placeAds(view) {
    if (view.querySelector('.ad')) return;
    const week = view.querySelector('.nav');
    const cal = view.querySelector('.cal');
    const day = !week && cal && view.querySelector('input[type="search"]');
    if (!week && !day) return;
    if (!ADS.length) { loadAds().then(() => { if (ADS.length) placeAds(view); }); return; }
    const box = adBanner();
    if (!box) return;
    if (week) week.insertAdjacentElement('afterend', box);
    else cal.parentElement.append(box);
  }

  // ---------- Админ-панель (только админ): активность, реклама, ассистенты ----------
  const errBox = (e) => h('p', { class: 'err' }, 'Ошибка: ' + ((e && e.message) || e));
  const ctr = (v, c) => (v ? (c / v * 100).toFixed(1) + '%' : '—');

  async function drawActivity(body, alive) {
    try {
      const s = await call('admin', { action: 'stats' });
      if (!alive()) return;
      const top = h('section', { class: 'card' }, h('h3', {}, 'Активность'),
        h('p', {}, 'Пользователей: ' + s.total),
        h('p', {}, 'Заходили: за 24 ч — ' + s.d1 + ', за 7 дн. — ' + s.d7 + ', за 30 дн. — ' + s.d30),
        s.fresh ? h('p', {}, 'Новых за 7 дней: ' + s.fresh) : null,
        s.unknown ? h('p', { class: 'muted' }, 'Нет данных об активности: ' + s.unknown + ' (появятся после следующего захода)') : null,
        h('p', { class: 'muted' }, 'Не выбрали расписание: ' + s.none + ' · Расписание не найдено: ' + s.lost + ' · Напоминания включены: ' + s.reminders));
      const facs = s.faculties.map((f) => h('section', { class: 'card' },
        h('h3', {}, f.name + ': ' + f.total),
        h('p', { class: 'muted' }, 'Активны за 7 дней: ' + f.active),
        ...f.courses.map((c) => h('p', {}, c.course + ' курс: ' + c.n))));
      body.replaceChildren(top, ...facs);
    } catch (e) { if (alive()) body.replaceChildren(errBox(e)); }
  }

  async function drawAds(body, alive) {
    try {
      const [r, st] = await Promise.all([call('ads', { action: 'list' }), call('ads', { action: 'stats' })]);
      if (!alive()) return;
      ADS = (r && r.ads) || ADS;
      const stats = (st && st.stats) || {};
      const list = h('div', {});
      const draw = () => {
        if (!ADS.length) { list.replaceChildren(h('p', { class: 'muted' }, 'Картинок в docs/ads пока нет')); return; }
        list.replaceChildren(...ADS.map((a) => {
          const s = stats[a.id] || { v7: 0, c7: 0, v30: 0, c30: 0 };
          const url = h('input', { type: 'url', placeholder: 'https://…', value: a.url });
          const note = h('span', { class: 'muted' }, '');
          const im = h('img', { src: a.src, alt: a.id, style: 'width:100%;aspect-ratio:' + AD_W + ' / ' + AD_H + ';object-fit:cover;border-radius:10px' });
          im.addEventListener('load', () => {
            const ok = im.naturalWidth === AD_W && im.naturalHeight === AD_H;
            note.textContent = im.naturalWidth + '×' + im.naturalHeight + (ok ? ' ✓' : ' — нужен размер ' + AD_W + '×' + AD_H);
          });
          return h('div', { class: 'linkform' },
            im, h('b', {}, a.id), note,
            h('p', { class: 'muted' }, 'Показы: ' + s.v7 + ' за 7 дн. / ' + s.v30 + ' за 30 дн.'),
            h('p', { class: 'muted' }, 'Клики: ' + s.c7 + ' / ' + s.c30 + ' · CTR (7 дн.): ' + ctr(s.v7, s.c7) + ' · (30 дн.): ' + ctr(s.v30, s.c30)),
            url,
            h('button', { class: 'mini', onclick: safe(async () => {
              const res = await call('ads', { action: 'set', id: a.id, url: url.value.trim() });
              ADS = (res && res.ads) || ADS;
              draw();
            }) }, 'Сохранить'));
        }));
      };
      body.replaceChildren(h('section', { class: 'card' }, h('h3', {}, 'Реклама'),
        h('p', { class: 'muted' }, 'Картинки берутся из docs/ads (ad1, ad2, …), размер строго ' + AD_W + '×' + AD_H + '. Для каждой задайте ссылку, на которую перейдёт пользователь. Счётчики приблизительные.'),
        list,
        h('button', { class: 'mini alt', onclick: safe(async () => {
          const res = await call('ads', { action: 'refresh' });
          ADS = (res && res.ads) || ADS;
          draw();
        }) }, 'Обновить список картинок')));
      draw();
    } catch (e) { if (alive()) body.replaceChildren(errBox(e)); }
  }

  // Роли ассистентов: словарь потоков из данных bootstrap
  function streamIndex() {
    const m = {};
    for (const x of (S.boot && S.boot.schedules) || []) {
      for (const s of x.streams) m[s.key] = { course: x.course, faculty: s.faculty, label: s.direction + (s.stream ? ', ' + s.stream : '') };
    }
    return m;
  }

  const scopeLabel = (s, idx) => [
    s.faculty || 'все факультеты',
    s.course ? s.course + ' курс' : 'все курсы',
    s.stream ? ((idx[s.stream] && idx[s.stream].label) || 'поток') : 'все потоки',
  ].join(' · ');

  function scopeForm(idx, onAdd) {
    const F = ((S.boot && S.boot.faculties) || []).map((f) => f.name);
    const fac = h('select', {}, [h('option', { value: '' }, 'Любой факультет'), ...F.map((n) => h('option', { value: n }, n))]);
    const nCourses = (S.boot && S.boot.courses) || 4;
    const course = h('select', {}, [h('option', { value: '' }, 'Любой курс'), ...Array.from({ length: nCourses }, (_, i) => h('option', { value: String(i + 1) }, (i + 1) + ' курс'))]);
    const stream = h('select', {});
    const fill = () => {
      const opts = [h('option', { value: '' }, 'Любой поток')];
      for (const [key, v] of Object.entries(idx)) {
        if (fac.value && v.faculty !== fac.value) continue;
        if (course.value && v.course !== course.value) continue;
        opts.push(h('option', { value: key }, v.faculty + ' · ' + v.course + ' курс · ' + v.label));
      }
      stream.replaceChildren(...opts);
    };
    fac.addEventListener('change', fill);
    course.addEventListener('change', fill);
    fill();
    return h('div', {}, fac, course, stream,
      h('button', { class: 'mini', onclick: safe(async () => { await onAdd({ faculty: fac.value, course: course.value, stream: stream.value }); }) }, 'Добавить доступ'));
  }

  async function drawAssistants(body, alive) {
    try {
      let list = ((await call('admin', { action: 'assistants' })).assistants) || [];
      if (!alive()) return;
      const idx = streamIndex();
      const box = h('div', {});
      const setScopes = async (name, scopes) => {
        list = ((await call('admin', { action: 'role_set', username: name, scopes })).assistants) || [];
        draw();
      };
      const draw = () => {
        box.replaceChildren(...(list.length
          ? list.map((a) => {
            const scopes = a.scopes || [];
            return h('div', { class: 'linkform' },
              h('div', { class: 'erow' }, h('b', {}, '@' + a.name),
                h('button', { class: 'mini danger', onclick: safe(async () => {
                  if (!(await ask('Убрать ассистента @' + a.name + '?'))) return false;
                  list = ((await call('admin', { action: 'assistant_del', username: a.name })).assistants) || [];
                  draw();
                }, 'none') }, 'Убрать')),
              h('p', { class: 'muted' }, scopes.length ? 'Может править только:' : 'Доступ ко всем потокам'),
              ...scopes.map((s, i) => h('div', { class: 'erow' }, h('span', {}, scopeLabel(s, idx)),
                h('button', { class: 'mini danger', onclick: safe(async () => { await setScopes(a.name, scopes.filter((_, j) => j !== i)); }, 'none') }, '✕'))),
              scopeForm(idx, async (s) => { await setScopes(a.name, scopes.concat([s])); }));
          })
          : [h('p', { class: 'muted' }, 'Ассистентов пока нет (админ имеет все права)')]));
      };
      const name = h('input', { type: 'text', placeholder: '@username' });
      body.replaceChildren(h('section', { class: 'card' }, h('h3', {}, 'Ассистенты'),
        h('p', { class: 'muted' }, 'Ассистенты могут менять расписание, ДЗ и ссылки на своём выбранном потоке. Если не заданы ограничения, доступ полный; если заданы — только на подходящих потоках.'),
        box, name,
        h('button', { class: 'mini', onclick: safe(async () => {
          const v = name.value.trim();
          if (!v) return false;
          list = ((await call('admin', { action: 'assistant_add', username: v })).assistants) || [];
          name.value = '';
          draw();
        }) }, 'Добавить ассистента')));
      draw();
    } catch (e) { if (alive()) body.replaceChildren(errBox(e)); }
  }

  function openAdmin() {
    if (document.getElementById('admin-panel')) return;
    const cs = getComputedStyle(document.body);
    const bg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : '#ffffff';
    const panel = h('div', { id: 'admin-panel', style: 'position:fixed;inset:0;z-index:100;overflow:auto;padding:12px;box-sizing:border-box;background:' + bg + ';color:' + cs.color });
    const body = h('div', {});
    const tabs = h('div', { class: 'toolbar' });
    const sections = { act: ['Активность', drawActivity], ads: ['Реклама', drawAds], asst: ['Ассистенты', drawAssistants] };
    let seq = 0;
    const show = (k) => {
      const my = ++seq;
      for (const b of tabs.children) b.className = 'chip' + (b.dataset.k === k ? ' on' : '');
      body.replaceChildren(h('p', { class: 'muted center' }, 'Загрузка…'));
      sections[k][1](body, () => my === seq && panel.isConnected);
    };
    Object.keys(sections).forEach((k) => tabs.append(h('button', { class: 'chip', 'data-k': k, onclick: () => { buzz.tap(); show(k); } }, sections[k][0])));
    panel.append(h('div', { class: 'toolbar' }, h('button', { class: 'mini alt', onclick: () => { buzz.tap(); panel.remove(); } }, '← Назад'), h('b', {}, 'Админ-панель')), tabs, body);
    document.body.append(panel);
    show('act');
  }

  // Карточка в настройках (только админ)
  function adminEntry(root) {
    if (root.querySelector('.ad-admin')) return;
    root.append(h('section', { class: 'card ad-admin' }, h('h3', {}, 'Администрирование'),
      h('p', { class: 'muted' }, 'Активность пользователей, реклама и ассистенты.'),
      h('button', { onclick: () => { buzz.tap(); openAdmin(); } }, 'Открыть админ-панель')));
  }

  // ---------- Первый запуск: если расписание не выбрано (или файл уже не найден), открываем настройки с приветствием ----------
  const hasSchedule = () => {
    const u = (S.boot && S.boot.user) || {};
    if (!u.course || !u.stream) return false;
    const group = ((S.boot && S.boot.schedules) || []).find((x) => x.course === u.course);
    return !!group && group.streams.some((s) => s.key === u.stream);
  };

  let onboardDone = false;
  function startOnboarding() {
    if (onboardDone || !S.boot) return;
    onboardDone = true;
    if (hasSchedule()) return;
    S.tab = 'set';
    try { render(); } catch (e) {}
  }

  function welcomeCard(root) {
    if (root.querySelector('.welcome-card')) return;
    root.prepend(h('section', { class: 'card welcome-card' }, h('h3', {}, '👋 Добро пожаловать!'),
      h('p', {}, 'Выберите факультет, курс и направление и сохраните выбор — расписание появится на главном экране.')));
  }

  // ---------- Настройки: уведомления об изменениях расписания (раньше переключались только в боте) ----------
  function alertsCard(root) {
    if (root.querySelector('.alerts-card')) return;
    const u = (S.boot && S.boot.user) || {};
    const box = h('input', { type: 'checkbox', checked: u.alerts !== false });
    box.addEventListener('change', safe(async () => {
      const r = await call('alerts', { value: box.checked });
      if (S.boot) S.boot.user = Object.assign({}, S.boot.user, { alerts: r.alerts });
    }));
    root.append(h('section', { class: 'card alerts-card' }, h('h3', {}, 'Уведомления'),
      h('label', { class: 'row' }, box, 'Присылать в чат сообщения об отменах, переносах и обновлениях расписания')));
  }

  // ---------- Настройки: направления по курсу ----------
  function cascade(root) {
    const sel = root.querySelectorAll('select');
    const fac = sel[0];
    const course = sel[1];
    const dir = sel[2];
    const F = (S.boot && S.boot.faculties) || [];
    if (!fac || !course || !dir || !F.length || !fac.options.length || fac.options[0].textContent !== F[0].name) return;
    if (fac.dataset.cascade) return;
    fac.dataset.cascade = '1';
    const rebuild = () => {
      const f = F[Number(fac.value)] || { directions: [] };
      const prev = dir.value;
      const opts = [];
      f.directions.forEach((label, i) => {
        const m = LABEL.exec(label);
        if (m && m[2] === course.value) opts.push(h('option', { value: String(i), selected: String(i) === prev }, m[1]));
      });
      dir.replaceChildren(...opts);
      dir.dispatchEvent(new Event('change'));
    };
    fac.addEventListener('change', rebuild);
    course.addEventListener('change', rebuild);
    rebuild();
    if (!hasSchedule()) welcomeCard(root);
    alertsCard(root);
    if (S.boot && S.boot.admin) adminEntry(root);
  }

  // Экраны определяются по элементам на странице, а не подменой функций: не зависит от того, как app.js вызывает экраны
  const view = document.getElementById('view');
  if (view) {
    new MutationObserver(() => {
      try { startOnboarding(); } catch (e) {}
      try { cascade(view); } catch (e) {}
      try { placeAds(view); } catch (e) {}
    }).observe(view, { childList: true, subtree: true });
  }

  // После успешного сохранения настроек обновляем данные пользователя в памяти, чтобы вкладка настроек показывала новый выбор
  const baseCall = call;
  call = function (name, p, cache) {
    const r = baseCall(name, p, cache);
    if (name === 'settings') {
      r.then((user) => {
        if (user && typeof user === 'object' && S.boot) S.boot.user = Object.assign({}, S.boot.user, user);
      }).catch(() => {});
    }
    return r;
  };

  // ---------- Календарь: подписка на исходный файл и экспорт с правками ----------
  async function exportIcs() {
    const r = await call('ics', {});
    const file = new File([r.text], r.name, { type: 'text/calendar' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch (e) { if (e && e.name === 'AbortError') return false; throw e; }
      return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = r.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  subCard = function () {
    const c = h('section', { class: 'card' }, h('h3', {}, 'Календарь'));
    const file = myFile();
    if (!file) { c.append(h('p', { class: 'muted' }, 'Сначала выберите курс и расписание')); return c; }
    const raw = RAW_FILES + file.split('/').map(encodeURIComponent).join('/');
    const web = raw.replace('https://', 'webcal://');
    c.append(h('p', { class: 'muted' }, 'С правками: файл с переносами, отменами, переименованиями и ин. язом на текущий момент. Чтобы обновить календарь, скачайте файл заново.'),
      h('button', { onclick: safe(exportIcs) }, 'Скачать с правками (.ics)'),
      h('p', { class: 'muted' }, 'Подписка на исходное расписание из файла (без правок и ин. яза), обновляется сама:'),
      h('button', { class: 'alt', onclick: () => { buzz.tap(); openLink(web); } }, 'Подписаться: Apple Календарь'),
      h('button', { class: 'alt', onclick: () => { buzz.tap(); openLink('https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(web)); } }, 'Подписаться: Google Календарь'),
      h('button', { class: 'alt', onclick: () => copy(raw) }, 'Копировать ссылку'));
    return c;
  };
})();

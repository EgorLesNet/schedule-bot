// Страница «Клубы» (между «ДЗ» и «Настройки»): карточки разделов (СНО ГАУГН, ССК ГАУГН), внутри — клубы с подсветкой статуса и переходом по ссылке.
// Заполняет админ прямо в приложении; страницу можно закрыть для студентов (им показывается заглушка, содержимое сервер не отдаёт). Подключается после app.js: добавляет вкладку в TABS и значок в ICONS, app.js не правится.
(function () {
  if (typeof TABS === 'undefined' || typeof h !== 'function' || typeof call !== 'function') return;

  const ORDER = ['active', 'paused', 'closed'];
  const LABEL = { active: 'Работает', paused: 'Приостановлено', closed: 'Закрыт на неопределённый срок' };
  const RGB = { active: '52,199,89', paused: '255,204,0', closed: '255,59,48' };
  let openSec = null;
  let preview = false;

  const css = document.createElement('style');
  css.textContent = [
    '.card.club{border-left:5px solid rgb(var(--sc));background:rgba(var(--sc),.17)}',
    '.club-main{display:flex;align-items:center;gap:10px;cursor:pointer}',
    '.club-main.nolink{cursor:default}',
    '.club-main b{font-size:16px}',
    '.club-go{font-size:18px;color:var(--tg-theme-hint-color,#777)}',
    '.sec-card{cursor:pointer}',
    '.sec-card .row{display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.sec-card h3{margin:0 0 6px;font-size:18px}',
    '.sec-go{font-size:28px;line-height:1;color:var(--tg-theme-hint-color,#777)}',
    '.club-legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin:0 0 12px;font-size:12px;color:var(--tg-theme-hint-color,#777)}',
    '.club-legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;background:rgb(var(--sc))}',
    '.club-stub{text-align:center;padding:30px 16px}',
    '.club-stub .big{font-size:46px;margin-bottom:10px}',
    '.club-stub h3{font-size:18px;margin:0 0 6px}',
  ].join('\n');
  document.head.append(css);

  const word = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'клуб' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'клуба' : 'клубов');
  const legend = () => h('div', { class: 'club-legend' }, ORDER.map((s) => h('span', { style: '--sc:' + RGB[s] }, h('i', {}), LABEL[s])));
  const statusSelect = (cur) => h('select', {}, ORDER.map((s) => h('option', { value: s, selected: s === cur }, '● ' + LABEL[s])));

  // Запрос к серверу и перерисовка; msg — вопрос перед опасным действием
  const act = (get, msg) => safe(async () => {
    if (msg) {
      buzz.warn();
      if (!(await ask(msg))) return false;
    }
    await call('clubs', typeof get === 'function' ? get() : get);
    render();
  });

  // Заглушка для студентов, пока страница закрыта (админ может посмотреть её кнопкой «Как видят студенты»)
  function stubView(back) {
    const box = h('div', {});
    if (back) box.append(h('div', { class: 'toolbar' }, h('button', { class: 'chip', onclick: () => { buzz.tap(); preview = false; render(); } }, '← Вернуться к редактированию')));
    box.append(h('section', { class: 'card club-stub' },
      h('div', { class: 'big' }, '✨'),
      h('h3', {}, 'Готовим интересное обновление!'),
      h('p', { class: 'muted', style: 'margin:0' }, 'Все клубы ГАУГН будут тут')));
    return box;
  }

  function visibilityCard(open) {
    const c = h('section', { class: 'card', style: 'border-left:5px solid ' + (open ? '#34c759' : '#ff9500') },
      h('b', {}, open ? '🟢 Страница открыта для всех' : '🔒 Страница закрыта для студентов'),
      h('p', { class: 'muted', style: 'margin:6px 0 0' }, open ? 'Студенты видят все клубы.' : 'Студенты видят только заглушку, содержимое им не передаётся. Вы видите всё и можете редактировать.'));
    c.append(h('button', {
      class: open ? 'mini danger' : 'mini',
      onclick: act(() => ({ action: 'visibility', open: !open }), open ? 'Закрыть страницу «Клубы»? Студенты увидят заглушку «Готовим интересное обновление!»' : 'Открыть страницу «Клубы» для всех студентов?'),
    }, open ? 'Закрыть для студентов' : 'Открыть для всех'));
    if (!open) c.append(h('button', { class: 'mini alt', onclick: () => { buzz.tap(); preview = true; render(); } }, '👁 Как видят студенты'));
    return c;
  }

  function summary(s) {
    const n = { active: 0, paused: 0, closed: 0 };
    for (const c of s.clubs) if (n[c.status] !== undefined) n[c.status]++;
    const dots = ORDER.filter((k) => n[k]).map((k) => h('span', { style: '--sc:' + RGB[k] }, h('i', {}), String(n[k])));
    return h('div', { class: 'club-legend', style: 'margin:0' }, h('span', {}, s.clubs.length ? s.clubs.length + ' ' + word(s.clubs.length) : 'Пока пусто'), ...dots);
  }

  function clubForm(sec, c) {
    const name = h('input', { type: 'text', maxlength: '80', placeholder: 'Название клуба', value: c.name });
    const url = h('input', { type: 'url', placeholder: 'https://…', value: c.url || '' });
    const st = statusSelect(c.status);
    const base = { section: sec.id, club: c.id };
    return h('div', { class: 'linkform' }, name, url, st,
      h('button', { class: 'mini', onclick: act(() => Object.assign({ action: 'club_edit', name: name.value, url: url.value, status: st.value }, base)) }, 'Сохранить'),
      h('button', { class: 'mini alt', onclick: act(() => Object.assign({ action: 'club_move', dir: -1 }, base)) }, '▲ Выше'),
      h('button', { class: 'mini alt', onclick: act(() => Object.assign({ action: 'club_move', dir: 1 }, base)) }, '▼ Ниже'),
      h('button', { class: 'mini danger', onclick: act(() => Object.assign({ action: 'club_delete' }, base), 'Удалить клуб «' + c.name + '»?') }, 'Удалить'));
  }

  function clubCard(sec, c, admin) {
    const card = h('section', { class: 'card club', style: '--sc:' + (RGB[c.status] || RGB.active) });
    card.append(h('div', { class: 'club-main' + (c.url ? '' : ' nolink'), onclick: () => { if (!c.url) return; buzz.tap(); openLink(c.url); } },
      h('div', { class: 'grow' }, h('b', {}, c.name), h('div', { class: 'muted' }, (LABEL[c.status] || '') + (c.url ? '' : ' · ссылка не указана'))),
      c.url ? h('span', { class: 'club-go' }, '↗') : null));
    if (admin) {
      const slot = h('div', {});
      card.append(h('div', { class: 'acts' }, h('button', { class: 'mini alt', onclick: () => {
        buzz.tap();
        if (slot.firstChild) slot.replaceChildren(); else slot.replaceChildren(clubForm(sec, c));
      } }, '✏️ Изменить')), slot);
    }
    return card;
  }

  function addClubCard(sec) {
    const name = h('input', { type: 'text', maxlength: '80', placeholder: 'Название клуба' });
    const url = h('input', { type: 'url', placeholder: 'Ссылка: https://…' });
    const st = statusSelect('active');
    return h('section', { class: 'card' }, h('h3', {}, 'Добавить клуб'), name, url, st,
      h('button', { onclick: act(() => ({ action: 'club_add', section: sec.id, name: name.value, url: url.value, status: st.value })) }, 'Добавить'));
  }

  function sectionTools(sec) {
    const title = h('input', { type: 'text', maxlength: '60', placeholder: 'Название раздела', value: sec.title });
    return h('section', { class: 'card' }, h('h3', {}, 'Раздел'), title,
      h('button', { class: 'mini', onclick: act(() => ({ action: 'section_edit', section: sec.id, title: title.value })) }, 'Переименовать'),
      h('button', { class: 'mini danger', onclick: safe(async () => {
        buzz.warn();
        if (!(await ask('Удалить раздел «' + sec.title + '» вместе со всеми клубами?'))) return false;
        await call('clubs', { action: 'section_delete', section: sec.id });
        openSec = null;
        render();
      }, 'none') }, 'Удалить раздел'));
  }

  function sectionView(sec, admin) {
    const box = h('div', {});
    box.append(h('div', { class: 'toolbar' },
      h('button', { class: 'chip', onclick: () => { buzz.tap(); openSec = null; render(); } }, '← Назад'),
      h('b', { class: 'grow' }, sec.title)));
    box.append(legend());
    if (!sec.clubs.length) box.append(h('p', { class: 'muted center' }, admin ? 'Клубов пока нет. Добавьте первый ниже.' : 'Клубов пока нет'));
    for (const c of sec.clubs) box.append(clubCard(sec, c, admin));
    if (admin) box.append(addClubCard(sec), sectionTools(sec));
    return box;
  }

  function listView(sections, admin, open) {
    const box = h('div', {});
    if (admin) box.append(visibilityCard(open));
    for (const s of sections) {
      box.append(h('section', { class: 'card sec-card', onclick: () => { buzz.tap(); openSec = s.id; render(); } },
        h('div', { class: 'row' }, h('div', { class: 'grow' }, h('h3', {}, s.title), summary(s)), h('span', { class: 'sec-go' }, '›'))));
    }
    if (!sections.length) box.append(h('p', { class: 'muted center' }, 'Разделов пока нет'));
    if (admin) {
      const title = h('input', { type: 'text', maxlength: '60', placeholder: 'Название нового раздела' });
      box.append(h('section', { class: 'card' }, h('h3', {}, 'Добавить раздел'), title,
        h('button', { onclick: act(() => ({ action: 'section_add', title: title.value })) }, 'Добавить раздел')));
    }
    return box;
  }

  async function viewClubs() {
    const data = await call('clubs', { action: 'list' }, true);
    const sections = (data && data.sections) || [];
    const admin = !!(data && data.admin);
    const open = !(data && data.open === false);
    if (!admin && !open) return stubView(false);
    if (admin && preview && !open) return stubView(true);
    preview = false;
    const sec = openSec && sections.find((s) => s.id === openSec);
    if (openSec && !sec) openSec = null;
    return sec ? sectionView(sec, admin) : listView(sections, admin, open);
  }

  // ---------- Вкладка в меню: между «ДЗ» и «Настройки» ----------
  if (typeof ICONS !== 'undefined') ICONS.clubs = "<svg viewBox='0 0 24 24'><circle cx='9' cy='8' r='3'/><circle cx='17' cy='9' r='2.5'/><path d='M3 19c0-3.3 2.7-6 6-6s6 2.7 6 6M15 14.5c3 0 6 1.5 6 4.5'/></svg>";
  if (!TABS.some((t) => t[0] === 'clubs')) {
    const i = TABS.findIndex((t) => t[0] === 'set');
    TABS.splice(i < 0 ? TABS.length : i, 0, ['clubs', 'Клубы', viewClubs]);
  }

  // Если меню уже нарисовано без новой вкладки (первая отрисовка прошла до этого скрипта), добавляем кнопку; все следующие отрисовки берут её из TABS
  const nav = document.getElementById('tabs');
  function ensureNav() {
    if (!nav) return;
    const btns = Array.from(nav.querySelectorAll('button'));
    if (btns.length !== TABS.length - 1) return;
    const b = h('button', { onclick: () => { buzz.tap(); S.tab = 'clubs'; render(); } },
      h('i', { html: ICONS.clubs }), h('span', {}, 'Клубы'));
    nav.insertBefore(b, btns[btns.length - 1]);
  }
  ensureNav();
  if (nav) new MutationObserver(() => { try { ensureNav(); } catch (e) {} }).observe(nav, { childList: true });
})();

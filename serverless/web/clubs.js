// Клубы: описание, обложка по публичной HTTPS-ссылке; существующие разделы и статусы сохраняются.
(function () {
  if (typeof TABS === 'undefined') return;
  let selected = null, preview = false;
  const labels = { active: 'Работает', paused: 'Приостановлено', closed: 'Закрыт на неопределённый срок' };
  const color = { active: '#34c759', paused: '#ffcc00', closed: '#ff3b30' };
  const field = (label, el) => h('label', {}, h('span', { class: 'muted' }, label), el);
  const action = (p, question) => safe(async () => {
    if (question && !(await ask(question))) return false;
    await call('clubs', typeof p === 'function' ? p() : p);
    render();
  });
  function form(section, c = {}) {
    const name = h('input', { type: 'text', maxlength: '80', value: c.name || '', placeholder: 'Название клуба' });
    const description = h('textarea', { rows: 5, maxlength: '3000', placeholder: 'Чем занимается клуб, кому подойдёт и как вступить' });
    description.value = c.description || '';
    const photo = h('input', { type: 'url', value: c.photo || '', placeholder: 'https://…/photo.jpg' });
    const url = h('input', { type: 'url', value: c.url || '', placeholder: 'Ссылка на чат или страницу клуба' });
    const status = h('select', {}, Object.entries(labels).map(([value, title]) => h('option', { value, selected: value === (c.status || 'active') }, title)));
    return h('div', { class: 'linkform' }, field('Название', name), field('Описание', description),
      field('Фото: публичная HTTPS-ссылка на само изображение', photo),
      h('p', { class: 'muted' }, 'Без ссылки фото не показывается. Чтобы убрать обложку, очистите это поле.'),
      field('Ссылка клуба', url), field('Статус', status),
      h('button', { onclick: action(() => ({ action: c.id ? 'club_edit' : 'club_add', section, club: c.id,
        name: name.value, description: description.value, photo: photo.value, url: url.value, status: status.value })) }, c.id ? 'Сохранить' : 'Добавить клуб'),
      c.id ? h('button', { class: 'mini danger', onclick: action({ action: 'club_delete', section, club: c.id }, 'Удалить клуб?') }, 'Удалить') : null);
  }
  function card(s, c, admin) {
    const box = h('section', { class: 'card club', style: 'border-left:5px solid ' + (color[c.status] || color.active) });
    if (c.photo && /^https:\/\//i.test(c.photo)) {
      const img = h('img', { src: c.photo, alt: c.name, loading: 'lazy', referrerpolicy: 'no-referrer', style: 'display:block;width:100%;max-height:300px;object-fit:cover;border-radius:14px;margin-bottom:10px' });
      img.addEventListener('error', () => { img.replaceWith(h('p', { class: 'muted' }, 'Не удалось загрузить фото')); });
      box.append(img);
    }
    box.append(h('h3', {}, c.name), h('div', { class: 'muted' }, labels[c.status] || labels.active));
    if (c.description) box.append(h('p', { style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, linkify(c.description)));
    if (c.url) box.append(h('button', { class: 'mini', onclick: () => openLink(c.url) }, 'Открыть страницу клуба ↗'));
    if (admin) {
      const slot = h('div', {});
      box.append(h('div', { class: 'acts' },
        h('button', { class: 'mini alt', onclick: () => { slot.replaceChildren(...(slot.firstChild ? [] : [form(s.id, c)])); } }, '✏️ Изменить'),
        ...[-1, 1].map((dir) => h('button', { class: 'mini alt', onclick: action({ action: 'club_move', section: s.id, club: c.id, dir }) }, dir < 0 ? '▲' : '▼'))), slot);
    }
    return box;
  }
  function stub(admin) {
    return h('div', {}, admin ? h('button', { class: 'mini', onclick: () => { preview = false; render(); } }, '← К редактированию') : null,
      h('section', { class: 'card' }, h('h3', {}, 'Готовим интересное обновление!'), h('p', {}, 'Все клубы ГАУГН будут тут')));
  }
  async function viewClubs() {
    const d = await call('clubs', { action: 'list' });
    if (!d.open && (!d.admin || preview)) return stub(d.admin);
    const s = d.sections.find((x) => x.id === selected);
    const box = h('div', {});
    if (s) {
      box.append(h('div', { class: 'toolbar' }, h('button', { class: 'chip', onclick: () => { selected = null; render(); } }, '← Назад'), h('b', {}, s.title)));
      if (!s.clubs.length) box.append(h('p', { class: 'muted' }, 'Клубов пока нет'));
      s.clubs.forEach((c) => box.append(card(s, c, d.admin)));
      if (d.admin) {
        const title = h('input', { type: 'text', maxlength: '60', value: s.title });
        box.append(h('section', { class: 'card' }, h('h3', {}, 'Добавить клуб'), form(s.id)),
          h('section', { class: 'card' }, h('h3', {}, 'Раздел'), title,
            h('button', { class: 'mini', onclick: action(() => ({ action: 'section_edit', section: s.id, title: title.value })) }, 'Переименовать'),
            h('button', { class: 'mini danger', onclick: action({ action: 'section_delete', section: s.id }, 'Удалить раздел со всеми клубами?') }, 'Удалить раздел')));
      }
      return box;
    }
    selected = null;
    if (d.admin) box.append(h('section', { class: 'card' }, h('b', {}, d.open ? '🟢 Страница открыта' : '🔒 Страница закрыта для студентов'),
      h('button', { class: 'mini', onclick: action({ action: 'visibility', open: !d.open }, d.open ? 'Закрыть страницу для студентов?' : 'Открыть страницу для студентов?') }, d.open ? 'Закрыть' : 'Открыть'),
      !d.open ? h('button', { class: 'mini alt', onclick: () => { preview = true; render(); } }, 'Как видят студенты') : null));
    for (const sec of d.sections) box.append(h('section', { class: 'card', style: 'cursor:pointer', onclick: () => { selected = sec.id; render(); } },
      h('h3', {}, sec.title + ' ›'), h('p', { class: 'muted' }, 'Клубов: ' + sec.clubs.length + ' · ' + Object.entries(labels).map(([k, v]) => v + ': ' + sec.clubs.filter((c) => c.status === k).length).join(' · '))));
    if (d.admin) {
      const title = h('input', { type: 'text', maxlength: '60', placeholder: 'Название раздела' });
      box.append(h('section', { class: 'card' }, h('h3', {}, 'Добавить раздел'), title,
        h('button', { onclick: action(() => ({ action: 'section_add', title: title.value })) }, 'Добавить')));
    }
    return box;
  }
  ICONS.clubs = "<svg viewBox='0 0 24 24'><circle cx='9' cy='8' r='3'/><circle cx='17' cy='9' r='2.5'/><path d='M3 19c0-3.3 2.7-6 6-6s6 2.7 6 6M15 14.5c3 0 6 1.5 6 4.5'/></svg>";
  const existing = TABS.findIndex((t) => t[0] === 'clubs');
  if (existing >= 0) TABS[existing] = ['clubs', 'Клубы', viewClubs];
  else { const i = TABS.findIndex((t) => t[0] === 'set'); TABS.splice(i < 0 ? TABS.length : i, 0, ['clubs', 'Клубы', viewClubs]); }
  const nav = document.getElementById('tabs');
  function ensureNav() {
    if (!nav || nav.querySelectorAll('button').length !== TABS.length - 1) return;
    const b = h('button', { onclick: () => { S.tab = 'clubs'; render(); } }, h('i', { html: ICONS.clubs }), h('span', {}, 'Клубы'));
    nav.insertBefore(b, nav.lastElementChild);
  }
  ensureNav();
  if (nav) new MutationObserver(ensureNav).observe(nav, { childList: true });
})();

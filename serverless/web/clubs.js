// Обложки из галереи и отдельные главы клубов по Telegram ID. Общие роли расписания не меняются.
(function () {
  if (typeof TABS === 'undefined') return;
  let selected = null, preview = false;
  const labels = { active: 'Работает', paused: 'Приостановлено', closed: 'Закрыт на неопределённый срок' };
  const color = { active: '#34c759', paused: '#ffcc00', closed: '#ff3b30' };
  const field = (label, el) => h('label', {}, h('span', { class: 'muted' }, label), el);
  const action = (p, question) => safe(async () => {
    if (question && !(await ask(question))) return false;
    await call('clubs', typeof p === 'function' ? p() : p); render();
  });
  async function compress(file) {
    if (!file || file.size > 20 * 1024 * 1024 || (file.type && !file.type.startsWith('image/'))) throw new Error('Выберите изображение до 20 МБ');
    const src = URL.createObjectURL(file), img = new Image();
    try {
      await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('Не удалось прочитать фото. Попробуйте JPEG или PNG.')); img.src = src; });
      if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 60000000) throw new Error('Слишком большое разрешение фото');
      const canvas = document.createElement('canvas');
      for (const max of [960, 640, 400]) {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.max(1, Math.round(img.naturalWidth * k)); canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
        const g = canvas.getContext('2d'); if (!g) throw new Error('Обработка фото недоступна');
        g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height); g.drawImage(img, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.82, 0.6, 0.4]) {
          const data = canvas.toDataURL('image/jpeg', quality);
          if (data.startsWith('data:image/jpeg;base64,') && data.length <= 80000) return data;
        }
      }
      throw new Error('Не удалось сжать фото. Выберите другое изображение.');
    } finally { URL.revokeObjectURL(src); }
  }
  function upload(section, c) {
    const input = h('input', { type: 'file', accept: 'image/*' });
    const status = h('p', { class: 'muted' }, 'Фото сжимается на телефоне. Загрузка меняет только обложку.'), preview = h('div', {});
    let busy = false;
    input.addEventListener('change', safe(async () => {
      if (busy || !input.files[0]) return false;
      busy = true; input.disabled = true;
      try {
        status.textContent = 'Подготовка фото…';
        const data = await compress(input.files[0]), count = Math.ceil(data.length / 12000);
        preview.replaceChildren(h('img', { src: data, alt: 'Предпросмотр', style: 'max-width:100%;max-height:180px;border-radius:12px' }));
        const base = { section, club: c.id };
        const r = await call('clubs', { ...base, action: 'photo_begin', count, length: data.length });
        for (let index = 0; index < count; index++) {
          status.textContent = 'Загрузка: ' + Math.round(index / count * 100) + '%';
          await call('clubs', { ...base, action: 'photo_part', token: r.token, index, data: data.slice(index * 12000, (index + 1) * 12000) });
        }
        const saved = await call('clubs', { ...base, action: 'photo_commit', token: r.token });
        const fresh = saved.sections.find((s) => s.id === section).clubs.find((x) => x.id === c.id);
        c.photoVersion = fresh.photoVersion; c.photo = '';
        status.textContent = 'Фото сохранено. Изменения текста сохраняются отдельной кнопкой ниже/выше.';
      } catch (e) { status.textContent = 'Фото не сохранено. Можно выбрать файл повторно.'; throw e; }
      finally { busy = false; input.disabled = false; input.value = ''; }
    }));
    return h('div', { class: 'linkform' }, field('📷 Загрузить фото с телефона', input), status, preview,
      h('button', { class: 'mini danger', onclick: action({ action: 'photo_remove', section, club: c.id }, 'Убрать обложку клуба?') }, 'Удалить обложку'));
  }
  function form(section, c = {}, admin = false) {
    const name = h('input', { type: 'text', maxlength: '80', value: c.name || '', placeholder: 'Название клуба' });
    const description = h('textarea', { rows: 5, maxlength: '3000', placeholder: 'Чем занимается клуб, кому подойдёт и как вступить' }); description.value = c.description || '';
    const url = h('input', { type: 'url', value: c.url || '', placeholder: 'Ссылка на чат или страницу клуба' });
    const status = h('select', {}, Object.entries(labels).map(([value, title]) => h('option', { value, selected: value === (c.status || 'active') }, title)));
    const leaders = h('input', { type: 'text', value: (c.leaders || []).join(', '), placeholder: 'Telegram ID через запятую' });
    return h('div', { class: 'linkform' }, field('Название', name), field('Описание', description), field('Ссылка клуба', url), field('Статус', status),
      admin ? field('Главы клуба: числовые Telegram ID', leaders) : null,
      admin ? h('p', { class: 'muted' }, 'Укажите до 10 ID (не @username). Пустое поле снимает назначения. Эти права действуют только внутри данного клуба.') : null,
      h('button', { onclick: action(() => {
        const p = { action: c.id ? 'club_edit' : 'club_add', section, club: c.id, name: name.value, description: description.value, url: url.value, status: status.value };
        if (admin) {
          const raw = leaders.value.trim() ? leaders.value.trim().split(/[,;\s]+/) : [];
          if (raw.some((s) => !/^[0-9]+$/.test(s))) throw new Error('Нужны числовые Telegram ID, не имена пользователей');
          p.leaders = raw.map(Number);
        }
        return p;
      }) }, c.id ? (admin ? 'Сохранить текст и назначения' : 'Сохранить описание') : 'Добавить клуб'),
      !c.id ? h('p', { class: 'muted' }, 'Сначала создайте клуб, затем откройте его редактирование для загрузки фото.') : null,
      c.id ? upload(section, c) : null,
      c.id && admin ? h('button', { class: 'mini danger', onclick: action({ action: 'club_delete', section, club: c.id }, 'Удалить клуб?') }, 'Удалить клуб') : null);
  }
  function card(s, c, admin) {
    const box = h('section', { class: 'card club', style: 'border-left:5px solid ' + (color[c.status] || color.active) });
    const photo = h('div', {});
    const showPhoto = (src) => {
      const img = h('img', { src, alt: c.name, loading: 'lazy', referrerpolicy: 'no-referrer', style: 'display:block;width:100%;max-height:300px;object-fit:cover;border-radius:14px;margin-bottom:10px' });
      img.addEventListener('error', () => img.replaceWith(h('p', { class: 'muted' }, 'Не удалось загрузить фото')));
      photo.replaceChildren(img);
    };
    box.append(photo);
    if (c.photoVersion) {
      photo.append(h('p', { class: 'muted' }, 'Загрузка фото…'));
      call('clubs', { action: 'photo', section: s.id, club: c.id }).then((r) => {
        if (photo.isConnected && /^data:image\/jpeg;base64,/.test(r.data || '')) showPhoto(r.data);
        else if (photo.isConnected) photo.replaceChildren();
      }).catch(() => { if (photo.isConnected) photo.replaceChildren(h('p', { class: 'muted' }, 'Фото сейчас недоступно')); });
    } else if (c.photo && /^https:\/\//i.test(c.photo)) showPhoto(c.photo);
    box.append(h('h3', {}, c.name), h('div', { class: 'muted' }, labels[c.status] || labels.active));
    if (c.canManage && !admin) box.append(h('p', { class: 'muted' }, 'Вы — глава этого клуба'));
    if (c.description) box.append(h('p', { style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, linkify(c.description)));
    if (c.url) box.append(h('button', { class: 'mini', onclick: () => openLink(c.url) }, 'Открыть страницу клуба ↗'));
    if (c.canManage || admin) {
      const slot = h('div', {});
      box.append(h('div', { class: 'acts' }, h('button', { class: 'mini alt', onclick: () => slot.replaceChildren(...(slot.firstChild ? [] : [form(s.id, c, admin)])) }, '✏️ Управлять клубом'),
        ...(admin ? [-1, 1].map((dir) => h('button', { class: 'mini alt', onclick: action({ action: 'club_move', section: s.id, club: c.id, dir }) }, dir < 0 ? '▲' : '▼')) : [])), slot);
    }
    return box;
  }
  function stub(admin) {
    return h('div', {}, admin ? h('button', { class: 'mini', onclick: () => { preview = false; render(); } }, '← К редактированию') : null,
      h('section', { class: 'card' }, h('h3', {}, 'Готовим интересное обновление!'), h('p', {}, 'Все клубы ГАУГН будут тут')));
  }
  async function viewClubs() {
    const d = await call('clubs', { action: 'list' });
    if ((!d.open && !d.canManage) || (d.admin && preview && !d.open)) return stub(d.admin);
    const s = d.sections.find((x) => x.id === selected), box = h('div', {});
    if (!d.open && !d.admin) box.append(h('p', { class: 'muted' }, 'Страница закрыта для студентов. Доступны только ваши клубы.'));
    if (s) {
      box.append(h('div', { class: 'toolbar' }, h('button', { class: 'chip', onclick: () => { selected = null; render(); } }, '← Назад'), h('b', {}, s.title)));
      if (!s.clubs.length) box.append(h('p', { class: 'muted' }, 'Клубов пока нет'));
      s.clubs.forEach((c) => box.append(card(s, c, d.admin)));
      if (d.admin) {
        const title = h('input', { type: 'text', maxlength: '60', value: s.title });
        box.append(h('section', { class: 'card' }, h('h3', {}, 'Добавить клуб'), form(s.id, {}, true)),
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
    for (const sec of d.sections) box.append(h('section', { class: 'card', style: 'cursor:pointer', onclick: () => { selected = sec.id; render(); } }, h('h3', {}, sec.title + ' ›'),
      h('p', { class: 'muted' }, 'Клубов: ' + sec.clubs.length + ' · ' + Object.entries(labels).map(([k, v]) => v + ': ' + sec.clubs.filter((c) => c.status === k).length).join(' · '))));
    if (d.admin) {
      const title = h('input', { type: 'text', maxlength: '60', placeholder: 'Название раздела' });
      box.append(h('section', { class: 'card' }, h('h3', {}, 'Добавить раздел'), title, h('button', { onclick: action(() => ({ action: 'section_add', title: title.value })) }, 'Добавить')));
    }
    return box;
  }
  ICONS.clubs = "<svg viewBox='0 0 24 24'><circle cx='9' cy='8' r='3'/><circle cx='17' cy='9' r='2.5'/><path d='M3 19c0-3.3 2.7-6 6-6s6 2.7 6 6M15 14.5c3 0 6 1.5 6 4.5'/></svg>";
  const i = TABS.findIndex((t) => t[0] === 'clubs');
  if (i >= 0) TABS[i] = ['clubs', 'Клубы', viewClubs];
  else { const j = TABS.findIndex((t) => t[0] === 'set'); TABS.splice(j < 0 ? TABS.length : j, 0, ['clubs', 'Клубы', viewClubs]); }
  const nav = document.getElementById('tabs');
  function ensureNav() {
    if (!nav || nav.querySelectorAll('button').length !== TABS.length - 1) return;
    nav.insertBefore(h('button', { onclick: () => { S.tab = 'clubs'; render(); } }, h('i', { html: ICONS.clubs }), h('span', {}, 'Клубы')), nav.lastElementChild);
  }
  ensureNav(); if (nav) new MutationObserver(ensureNav).observe(nav, { childList: true });
})();

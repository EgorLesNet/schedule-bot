// Раздел -> карточки -> страница клуба: фото/описание, затем отдельная лента анонсов.
(function () {
  if (typeof TABS === 'undefined') return;
  let sectionId = null, clubId = null, preview = false;
  const labels = { active: 'Работает', paused: 'Приостановлено', closed: 'Закрыт на неопределённый срок' };
  const field = (title, el) => h('label', {}, h('span', { class: 'muted' }, title), el);
  const act = (p, question) => safe(async () => {
    if (question && !(await ask(question))) return false;
    await call('clubs', typeof p === 'function' ? p() : p); render();
  });
  const back = (title, fn) => h('div', { class: 'toolbar' }, h('button', { class: 'chip', onclick: () => { fn(); render(); } }, '← Назад'), h('b', {}, title));
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
        for (const q of [0.82, 0.6, 0.4]) { const data = canvas.toDataURL('image/jpeg', q); if (data.startsWith('data:image/jpeg;base64,') && data.length <= 80000) return data; }
      }
      throw new Error('Не удалось сжать фото');
    } finally { URL.revokeObjectURL(src); }
  }
  function photo(c, base) {
    const slot = h('div', {});
    const show = (src) => {
      const img = h('img', { src, alt: c.name, referrerpolicy: 'no-referrer', style: 'display:block;width:100%;max-height:360px;object-fit:cover;border-radius:14px;margin-bottom:12px' });
      img.addEventListener('error', () => slot.replaceChildren(h('p', { class: 'muted' }, 'Фото недоступно'))); slot.replaceChildren(img);
    };
    if (c.photoVersion) {
      slot.append(h('p', { class: 'muted' }, 'Загрузка фото…'));
      call('clubs', { ...base, action: 'photo' }).then((r) => { if (!slot.isConnected) return; if (/^data:image\/jpeg;base64,/.test(r.data || '')) show(r.data); else slot.replaceChildren(); })
        .catch(() => { if (slot.isConnected) slot.replaceChildren(h('p', { class: 'muted' }, 'Фото недоступно')); });
    } else if (/^https:\/\//i.test(c.photo || '')) show(c.photo);
    return slot;
  }
  function upload(c, base) {
    const input = h('input', { type: 'file', accept: 'image/*' }), status = h('p', { class: 'muted' }, 'Обложка сохраняется отдельно от текста.'), thumb = h('div', {});
    let busy = false;
    input.addEventListener('change', safe(async () => {
      if (busy || !input.files[0]) return false;
      busy = true; input.disabled = true;
      try {
        status.textContent = 'Подготовка фото…'; const data = await compress(input.files[0]), count = Math.ceil(data.length / 12000);
        thumb.replaceChildren(h('img', { src: data, alt: 'Предпросмотр', style: 'max-width:100%;max-height:180px;border-radius:12px' }));
        const r = await call('clubs', { ...base, action: 'photo_begin', count, length: data.length });
        for (let index = 0; index < count; index++) { status.textContent = 'Загрузка: ' + Math.round(index / count * 100) + '%'; await call('clubs', { ...base, action: 'photo_part', token: r.token, index, data: data.slice(index * 12000, (index + 1) * 12000) }); }
        await call('clubs', { ...base, action: 'photo_commit', token: r.token });
        status.textContent = 'Фото сохранено. Откройте клуб заново, чтобы обновить обложку сверху.';
      } catch (e) { status.textContent = 'Фото не сохранено. Повторите загрузку.'; throw e; }
      finally { busy = false; input.disabled = false; input.value = ''; }
    }));
    return h('div', { class: 'linkform' }, field('📷 Загрузить фото с телефона', input), status, thumb,
      h('button', { class: 'mini danger', onclick: act({ ...base, action: 'photo_remove' }, 'Удалить обложку?') }, 'Удалить обложку'));
  }
  function editor(section, c = {}, admin = false) {
    const base = { section, club: c.id };
    const name = h('input', { type: 'text', maxlength: '80', value: c.name || '', placeholder: 'Название клуба' });
    const description = h('textarea', { rows: 5, maxlength: '3000', placeholder: 'Описание клуба' }); description.value = c.description || '';
    const status = h('select', {}, Object.entries(labels).map(([value, title]) => h('option', { value, selected: value === (c.status || 'active') }, title)));
    const heads = h('input', { type: 'text', value: (c.leaders || []).join(', '), placeholder: 'Числовые Telegram ID через запятую' });
    const box = h('div', { class: 'linkform' }, field('Название', name), field('Описание', description), field('Статус', status),
      admin ? field('Главы клуба (до 10 ID, не @username)', heads) : null,
      h('button', { onclick: act(() => {
        const p = { ...base, action: c.id ? 'club_edit' : 'club_add', name: name.value, description: description.value, status: status.value };
        if (admin) { const ids = heads.value.trim() ? heads.value.trim().split(/[,;\s]+/) : []; if (ids.some((x) => !/^[0-9]+$/.test(x))) throw new Error('Нужны числовые Telegram ID'); p.leaders = ids.map(Number); }
        return p;
      }) }, 'Сохранить описание и настройки'));
    if (c.id) {
      const link = h('input', { type: 'text', inputmode: 'url', value: c.url || '', placeholder: '@club, t.me/club или https://…' }), note = h('p', { class: 'muted' }, 'Ссылка сохраняется отдельно. Пустое поле удаляет ссылку.');
      box.append(h('div', { class: 'linkform' }, field('Ссылка клуба', link), note, h('button', { class: 'mini', onclick: safe(async () => {
        const r = await call('clubs', { ...base, action: 'club_link', url: link.value }); link.value = r.url; c.url = r.url; note.textContent = r.url ? '✓ Ссылка сохранена: ' + r.url : '✓ Ссылка удалена';
      }) }, 'Сохранить ссылку')), upload(c, base));
      if (admin) box.append(...[-1, 1].map((dir) => h('button', { class: 'mini alt', onclick: act({ ...base, action: 'club_move', dir }) }, dir < 0 ? '▲ Выше' : '▼ Ниже')),
        h('button', { class: 'mini danger', onclick: act({ ...base, action: 'club_delete' }, 'Удалить клуб и его анонсы?') }, 'Удалить клуб'));
    } else box.append(h('p', { class: 'muted' }, 'После создания откройте клуб, чтобы добавить ссылку и фото.'));
    return box;
  }
  function feed(base) {
    const box = h('section', { class: 'card club-feed' });
    let current = null, items = [], next = '', seq = 0;
    const load = async (more = false) => {
      const ticket = ++seq, r = await call('clubs', { ...base, action: 'feed', ...(more && next ? { before: next } : {}) });
      if (!box.isConnected || ticket !== seq) return;
      current = r.club; next = r.next;
      items = more ? [...items, ...r.items.filter((x) => !items.some((old) => old.id === x.id))] : r.items; draw();
    };
    const mutate = (p, question) => safe(async () => { if (question && !(await ask(question))) return false; await call('clubs', { ...base, ...p }); await load(); });
    function form(old = {}) {
      const title = h('input', { type: 'text', maxlength: '120', value: old.title || '', placeholder: 'Заголовок анонса' });
      const text = h('textarea', { rows: 5, maxlength: '4000', placeholder: 'Что состоится, когда и где' }); text.value = old.text || '';
      const link = h('input', { type: 'text', inputmode: 'url', value: old.url || '', placeholder: 'Ссылка на регистрацию (необязательно)' });
      return h('div', { class: 'linkform' }, title, text, link, h('button', { onclick: safe(async () => {
        await call('clubs', { ...base, action: old.id ? 'feed_edit' : 'feed_add', id: old.id, title: title.value, text: text.value, url: link.value }); await load();
      }) }, old.id ? 'Сохранить анонс' : 'Опубликовать анонс'));
    }
    function draw() {
      box.replaceChildren(h('h3', {}, '📢 Анонсы клуба'));
      if (current.canManage) { const slot = h('div', {}); box.append(h('button', { class: 'mini', onclick: () => slot.replaceChildren(...(slot.firstChild ? [] : [form()])) }, '＋ Новый анонс'), slot); }
      if (!items.length) box.append(h('p', { class: 'muted' }, 'Анонсов пока нет'));
      for (const n of items) {
        const row = h('div', { class: 'linkform' }, h('h3', {}, n.title), h('p', { class: 'muted' }, new Date(n.at).toLocaleString('ru-RU') + ' · ' + n.by + (n.editedAt ? ' · изменено' : '')),
          h('p', { style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, linkify(n.text)));
        if (n.url) row.append(h('button', { class: 'mini', onclick: () => openLink(n.url) }, 'Подробнее ↗'));
        if (current.canManage) { const slot = h('div', {}); row.append(h('button', { class: 'mini alt', onclick: () => slot.replaceChildren(...(slot.firstChild ? [] : [form(n)])) }, 'Изменить'),
          h('button', { class: 'mini danger', onclick: mutate({ action: 'feed_delete', id: n.id }, 'Удалить анонс?') }, 'Удалить'), slot); }
        box.append(row);
      }
      if (next) box.append(h('button', { class: 'mini alt', onclick: safe(() => load(true)) }, 'Показать ещё'));
    }
    box.append(h('h3', {}, '📢 Анонсы клуба'), h('p', { class: 'muted' }, 'Загрузка…'));
    const retry = () => load().catch((e) => { if (box.isConnected) box.replaceChildren(h('h3', {}, '📢 Анонсы клуба'), h('p', { class: 'err' }, String(e.message || e)), h('button', { class: 'mini', onclick: retry }, 'Повторить')); });
    setTimeout(retry, 0); return box;
  }
  async function viewClubs() {
    const d = await call('clubs', { action: 'list' });
    if ((!d.open && !d.canManage) || (d.admin && preview && !d.open)) return h('div', {}, d.admin ? h('button', { class: 'mini', onclick: () => { preview = false; render(); } }, '← К редактированию') : null,
      h('section', { class: 'card' }, h('h3', {}, 'Готовим интересное обновление!'), h('p', {}, 'Все клубы ГАУГН будут тут')));
    const box = h('div', {}), s = d.sections.find((x) => x.id === sectionId), c = s && s.clubs.find((x) => x.id === clubId);
    if (clubId && !c) { clubId = null; box.append(h('p', { class: 'muted' }, 'Клуб удалён или недоступен')); }
    if (c) {
      const base = { section: s.id, club: c.id };
      const about = h('section', { class: 'card club-about' }, photo(c, base), h('h3', {}, c.name), h('p', { class: 'muted' }, labels[c.status] || labels.active),
        h('p', { style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, c.description ? linkify(c.description) : 'Описание пока не добавлено'));
      if (c.url) about.append(h('button', { class: 'mini', onclick: () => openLink(c.url) }, 'Открыть страницу клуба ↗'));
      box.append(back(c.name, () => { clubId = null; }), about, feed(base));
      if (c.canManage || d.admin) { const slot = h('div', {}); box.append(h('section', { class: 'card' }, h('button', { class: 'mini alt', onclick: () => slot.replaceChildren(...(slot.firstChild ? [] : [editor(s.id, c, d.admin)])) }, '⚙️ Управлять клубом'), slot)); }
      return box;
    }
    if (s) {
      box.append(back(s.title, () => { sectionId = null; clubId = null; }));
      if (!d.open) box.append(h('p', { class: 'muted' }, 'Раздел закрыт для студентов. Главам доступны только свои клубы.'));
      if (!s.clubs.length) box.append(h('p', { class: 'muted' }, 'Клубов пока нет'));
      for (const club of s.clubs) {
        const open = () => { clubId = club.id; render(); };
        box.append(h('section', { class: 'card', role: 'button', tabindex: '0', style: 'cursor:pointer', onclick: open, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } },
          h('h3', {}, club.name + ' ›'), h('p', { class: 'muted' }, (labels[club.status] || labels.active) + (club.canManage && !d.admin ? ' · Вы — глава клуба' : '')), h('p', { class: 'muted' }, (club.description || 'Информация и анонсы клуба').slice(0, 120))));
      }
      if (d.admin) {
        const title = h('input', { type: 'text', maxlength: '60', value: s.title });
        box.append(h('section', { class: 'card' }, h('h3', {}, 'Добавить клуб'), editor(s.id, {}, true)), h('section', { class: 'card' }, h('h3', {}, 'Раздел'), title,
          h('button', { class: 'mini', onclick: act(() => ({ action: 'section_edit', section: s.id, title: title.value })) }, 'Переименовать'),
          h('button', { class: 'mini danger', onclick: act({ action: 'section_delete', section: s.id }, 'Удалить раздел со всеми клубами и анонсами?') }, 'Удалить раздел')));
      }
      return box;
    }
    sectionId = null;
    if (d.admin) box.append(h('section', { class: 'card' }, h('b', {}, d.open ? '🟢 Страница открыта' : '🔒 Страница закрыта для студентов'),
      h('button', { class: 'mini', onclick: act({ action: 'visibility', open: !d.open }, 'Изменить доступность раздела?') }, d.open ? 'Закрыть' : 'Открыть'),
      !d.open ? h('button', { class: 'mini alt', onclick: () => { preview = true; render(); } }, 'Как видят студенты') : null));
    for (const sec of d.sections) box.append(h('section', { class: 'card', style: 'cursor:pointer', onclick: () => { sectionId = sec.id; clubId = null; render(); } }, h('h3', {}, sec.title + ' ›'), h('p', { class: 'muted' }, 'Клубов: ' + sec.clubs.length)));
    if (d.admin) { const title = h('input', { type: 'text', maxlength: '60', placeholder: 'Название раздела' }); box.append(h('section', { class: 'card' }, h('h3', {}, 'Добавить раздел'), title, h('button', { onclick: act(() => ({ action: 'section_add', title: title.value })) }, 'Добавить'))); }
    return box;
  }
  ICONS.clubs = "<svg viewBox='0 0 24 24'><circle cx='9' cy='8' r='3'/><circle cx='17' cy='9' r='2.5'/><path d='M3 19c0-3.3 2.7-6 6-6s6 2.7 6 6M15 14.5c3 0 6 1.5 6 4.5'/></svg>";
  const i = TABS.findIndex((t) => t[0] === 'clubs'); if (i >= 0) TABS[i] = ['clubs', 'Клубы', viewClubs]; else { const j = TABS.findIndex((t) => t[0] === 'set'); TABS.splice(j < 0 ? TABS.length : j, 0, ['clubs', 'Клубы', viewClubs]); }
  const nav = document.getElementById('tabs');
  function ensureNav() { if (!nav || nav.querySelectorAll('button').length !== TABS.length - 1) return; nav.insertBefore(h('button', { onclick: () => { S.tab = 'clubs'; render(); } }, h('i', { html: ICONS.clubs }), h('span', {}, 'Клубы')), nav.lastElementChild); }
  ensureNav(); if (nav) new MutationObserver(ensureNav).observe(nav, { childList: true });
})();

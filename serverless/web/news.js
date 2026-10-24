// Объявления старост: карточки вверху вкладки «Сегодня», у ассистентов — форма и список своих объявлений. Подключается после files.js
(function () {
  const cache = { at: 0, p: null };
  const fmtD = (d) => d.slice(8) + '.' + d.slice(5, 7);
  const TARGETS = { scope: 'всем, кого я контролирую', stream: 'только мой поток' };

  const load = (force) => {
    if (force || !cache.p || Date.now() - cache.at > 60000) cache.p = call('news', { action: 'list' }, true);
    if (force || Date.now() - cache.at > 60000) cache.at = Date.now();
    return cache.p;
  };

  const refresh = async (box) => {
    cache.p = null;
    const d = await load(true);
    if (box.isConnected) draw(box, d);
  };

  function card(n) {
    return h('section', { class: 'card news-card' },
      h('b', {}, '📢 Объявление' + (n.by ? ' · ' + n.by : '')),
      h('p', { style: 'white-space:pre-wrap' }, linkify(n.text)),
      h('div', { class: 'muted' }, 'Актуально до ' + fmtD(n.until) + ' включительно'));
  }

  function formCard(box) {
    const today = nowMsk().date;
    const text = h('textarea', { rows: 3, maxlength: '500', placeholder: 'Текст объявления (до 500 символов)' });
    const until = h('input', { type: 'date', value: add(today, 7), min: today, max: add(today, 120) });
    const target = h('select', {}, Object.entries(TARGETS).map(([v, l]) => h('option', { value: v }, l.charAt(0).toUpperCase() + l.slice(1))));
    return h('section', { class: 'card' }, h('h3', {}, 'Новое объявление'),
      text,
      h('label', {}, h('span', { class: 'muted' }, 'Показывать до (включительно)'), until),
      h('label', {}, h('span', { class: 'muted' }, 'Получатели'), target),
      h('button', { onclick: safe(async () => {
        if (!text.value.trim()) { buzz.err(); return false; }
        await call('news', { action: 'add', text: text.value, until: until.value, target: target.value });
        await refresh(box);
      }) }, 'Опубликовать'));
  }

  function mineCard(list, box) {
    const c = h('section', { class: 'card' }, h('h3', {}, 'Мои активные объявления'));
    for (const n of list) {
      c.append(h('div', { class: 'erow' },
        h('span', {}, n.text.slice(0, 60) + (n.text.length > 60 ? '…' : '') + ' (до ' + fmtD(n.until) + ', ' + (TARGETS[n.target] || '') + ')'),
        h('button', { class: 'mini danger', onclick: safe(async () => {
          buzz.heavy();
          if (!(await ask('Удалить объявление?'))) return false;
          await call('news', { action: 'delete', id: n.id });
          await refresh(box);
        }, 'none') }, 'Удалить')));
    }
    return c;
  }

  function draw(box, data) {
    const parts = (data.items || []).map(card);
    if (data.canPost) {
      const slot = h('div', {});
      parts.push(h('div', { class: 'toolbar' }, h('button', { class: 'mini alt', onclick: () => {
        buzz.tap();
        if (slot.firstChild) slot.replaceChildren(); else slot.replaceChildren(formCard(box));
      } }, '📢 Новое объявление')), slot);
      if ((data.mine || []).length) parts.push(mineCard(data.mine, box));
    }
    box.replaceChildren(...parts);
  }

  // Вкладка «Сегодня» узнаётся по календарю и поиску без выбора недели; объявления — перед панелью поиска
  function newsBox(root) {
    if (root.querySelector('.news-box')) return;
    const search = root.querySelector('input[type=search]');
    if (!search || !root.querySelector('.cal') || root.querySelector('.nav')) return;
    const bar = search.closest('.toolbar') || search;
    const box = h('div', { class: 'news-box' });
    bar.before(box);
    load().then((d) => { if (box.isConnected) draw(box, d); }).catch(() => {});
  }

  const view = document.getElementById('view');
  if (view) {
    new MutationObserver(() => {
      try { newsBox(view); } catch (e) {}
    }).observe(view, { childList: true, subtree: true });
  }
})();

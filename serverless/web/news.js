// Объявления старост: один слот вверху вкладки «Сегодня» (автолистание каждые 10 секунд, ручной свайп), у ассистентов — форма и список своих объявлений.
(function () {
  const cache = { at: 0, p: null };
  const fmtD = (d) => d.slice(8) + '.' + d.slice(5, 7);
  const TARGETS = { scope: 'всем, кого я контролирую', stream: 'только мой поток' };
  const AUTO_MS = 10000;

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

  // Один слот: объявления стоят в ряд и листаются сами после 10 секунд на экране; свайп влево/вправо и точки — ручное переключение (таймер начинается заново)
  function carousel(items) {
    const n = items.length;
    const slides = items.map((x) => {
      const c = card(x);
      c.style.margin = '0';
      c.style.flex = '0 0 100%';
      c.style.minWidth = '0';
      c.style.boxSizing = 'border-box';
      return c;
    });
    const track = h('div', { style: 'display:flex;will-change:transform' }, slides);
    const vp = h('div', { style: 'overflow:hidden;border-radius:18px;touch-action:pan-y;user-select:none' }, track);
    const dots = h('div', { style: 'display:flex;justify-content:center;gap:6px;margin:8px 0 0' },
      items.map((_, i) => h('span', { style: 'width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.25;cursor:pointer', onclick: () => { buzz.tap(); go(i); } })));
    const wrap = h('div', { style: 'margin:0 0 12px' }, vp, n > 1 ? dots : null);
    let idx = 0;
    let timer = 0;
    let drag = false;
    let locked = false;
    let startX = 0;
    let startY = 0;
    let dx = 0;

    const paint = () => {
      track.style.transition = 'transform .35s ease';
      track.style.transform = 'translateX(' + (-idx * 100) + '%)';
      [...dots.children].forEach((d, i) => { d.style.opacity = i === idx ? '.9' : '.25'; });
    };
    const arm = () => {
      clearTimeout(timer);
      if (n < 2) return;
      timer = setTimeout(() => {
        if (!wrap.isConnected) return;
        if (document.visibilityState === 'visible' && !drag) go(idx + 1); else arm();
      }, AUTO_MS);
    };
    const go = (i) => {
      idx = (i + n) % n;
      paint();
      arm();
    };

    if (n > 1) {
      vp.addEventListener('pointerdown', (e) => { drag = true; locked = false; startX = e.clientX; startY = e.clientY; dx = 0; });
      vp.addEventListener('pointermove', (e) => {
        if (!drag) return;
        dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!locked && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
          locked = true;
          try { vp.setPointerCapture(e.pointerId); } catch (x) {}
        }
        if (locked) {
          track.style.transition = 'none';
          track.style.transform = 'translateX(calc(' + (-idx * 100) + '% + ' + dx + 'px))';
        }
      });
      const end = () => {
        if (!drag) return;
        drag = false;
        if (locked && Math.abs(dx) > 40) go(idx + (dx < 0 ? 1 : -1));
        else { paint(); arm(); }
        locked = false;
        dx = 0;
      };
      vp.addEventListener('pointerup', end);
      vp.addEventListener('pointercancel', end);
    }
    paint();
    arm();
    return wrap;
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
    const parts = [];
    if ((data.items || []).length) parts.push(carousel(data.items));
    if (data.canPost) {
      const slot = h('div', {});
      const btn = h('button', { class: 'big' }, '📢 Новое объявление');
      btn.addEventListener('click', () => {
        buzz.tap();
        const open = !slot.firstChild;
        if (open) slot.replaceChildren(formCard(box)); else slot.replaceChildren();
        btn.textContent = open ? '✕ Свернуть' : '📢 Новое объявление';
        btn.className = 'big' + (open ? ' alt' : '');
      });
      parts.push(btn, slot);
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

// Объявления выбранного курса: без общего и офлайн-кэша между потоками.
(function () {
  const fmtD = (d) => d.slice(8) + '.' + d.slice(5, 7);
  const TARGETS = { scope: 'Выбранный курс — только потоки в моей зоне контроля', stream: 'Только выбранный поток' };
  const context = () => JSON.stringify([S.boot && S.boot.user && S.boot.user.course, S.boot && S.boot.user && S.boot.user.stream]);
  const load = () => call('news', { action: 'list' });
  const refresh = async (box) => {
    const ctx = context();
    const data = await load();
    if (box.isConnected && ctx === context()) draw(box, data);
  };
  function card(n) {
    return h('section', { class: 'card news-card', style: 'margin:0;flex:0 0 100%;min-width:0;box-sizing:border-box' },
      h('b', {}, '📢 Объявление' + (n.by ? ' · ' + n.by : '')),
      h('p', { style: 'white-space:pre-wrap' }, linkify(n.text)),
      h('div', { class: 'muted' }, 'Актуально до ' + fmtD(n.until) + ' включительно'));
  }
  function carousel(items) {
    const track = h('div', { style: 'display:flex;will-change:transform' }, items.map(card));
    const vp = h('div', { style: 'overflow:hidden;border-radius:18px;touch-action:pan-y;user-select:none' }, track);
    let idx = 0, timer = 0, drag = false, locked = false, x = 0, y = 0, dx = 0;
    const dots = h('div', { style: 'display:flex;justify-content:center;gap:6px;margin:8px 0 0' }, items.map((_, i) =>
      h('span', { style: 'width:7px;height:7px;border-radius:50%;background:currentColor;cursor:pointer', onclick: () => { buzz.tap(); go(i); } })));
    const wrap = h('div', { style: 'margin:0 0 12px' }, vp, items.length > 1 ? dots : null);
    const paint = () => {
      track.style.transition = 'transform .35s ease';
      track.style.transform = 'translateX(' + (-idx * 100) + '%)';
      [...dots.children].forEach((d, i) => { d.style.opacity = i === idx ? '.9' : '.25'; });
    };
    const arm = () => {
      clearTimeout(timer);
      if (items.length < 2) return;
      timer = setTimeout(() => {
        if (!wrap.isConnected) return;
        if (document.visibilityState === 'visible' && !drag) go(idx + 1); else arm();
      }, 10000);
    };
    const go = (i) => { idx = (i + items.length) % items.length; paint(); arm(); };
    if (items.length > 1) {
      vp.addEventListener('pointerdown', (e) => { drag = true; locked = false; x = e.clientX; y = e.clientY; dx = 0; });
      vp.addEventListener('pointermove', (e) => {
        if (!drag) return;
        dx = e.clientX - x;
        if (!locked && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(e.clientY - y)) {
          locked = true;
          try { vp.setPointerCapture(e.pointerId); } catch (err) {}
        }
        if (locked) { track.style.transition = 'none'; track.style.transform = 'translateX(calc(' + (-idx * 100) + '% + ' + dx + 'px))'; }
      });
      const end = () => { if (!drag) return; drag = false; go(idx + (locked && Math.abs(dx) > 40 ? (dx < 0 ? 1 : -1) : 0)); locked = false; dx = 0; };
      vp.addEventListener('pointerup', end);
      vp.addEventListener('pointercancel', end);
    }
    paint(); arm();
    return wrap;
  }
  function formCard(box, data) {
    const ctx = context(), today = nowMsk().date;
    const text = h('textarea', { rows: 3, maxlength: '500', placeholder: 'Текст объявления (до 500 символов)' });
    const until = h('input', { type: 'date', value: add(today, 7), min: today, max: add(today, 120) });
    const target = h('select', {}, Object.entries(TARGETS).map(([value, label]) => h('option', { value }, label)));
    return h('section', { class: 'card' }, h('h3', {}, 'Новое объявление · ' + data.course + ' курс'), text,
      h('label', {}, h('span', { class: 'muted' }, 'Показывать до (включительно)'), until),
      h('label', {}, h('span', { class: 'muted' }, 'Получатели'), target),
      h('button', { onclick: safe(async () => {
        if (ctx !== context()) throw new Error('Курс или поток изменился. Откройте форму заново.');
        if (!text.value.trim()) { buzz.err(); return false; }
        await call('news', { action: 'add', text: text.value, until: until.value, target: target.value, course: data.course, stream: data.stream });
        await refresh(box);
      }) }, 'Опубликовать'));
  }
  function draw(box, data) {
    const parts = [];
    if ((data.items || []).length) parts.push(carousel(data.items));
    if (data.canPost) {
      const slot = h('div', {}), btn = h('button', { class: 'big' }, '📢 Новое объявление');
      btn.addEventListener('click', () => {
        buzz.tap();
        const open = !slot.firstChild;
        slot.replaceChildren(...(open ? [formCard(box, data)] : []));
        btn.textContent = open ? '✕ Свернуть' : '📢 Новое объявление';
        btn.className = 'big' + (open ? ' alt' : '');
      });
      parts.push(btn, slot);
    }
    if ((data.mine || []).length) {
      const mine = h('section', { class: 'card' }, h('h3', {}, 'Мои активные объявления'));
      for (const n of data.mine) mine.append(h('div', { class: 'erow' },
        h('span', {}, n.text.slice(0, 60) + (n.text.length > 60 ? '…' : '') + ' (до ' + fmtD(n.until) + ')' +
          (n.legacy ? ' · Скрыто: опубликуйте заново с выбранным курсом' : ' · ' + n.course + ' курс')),
        h('button', { class: 'mini danger', onclick: safe(async () => {
          buzz.heavy();
          if (!(await ask('Удалить объявление?'))) return false;
          await call('news', { action: 'delete', id: n.id });
          await refresh(box);
        }, 'none') }, 'Удалить')));
      parts.push(mine);
    }
    box.replaceChildren(...parts);
  }
  function newsBox(root) {
    if (root.querySelector('.news-box')) return;
    const search = root.querySelector('input[type=search]');
    if (!search || !root.querySelector('.cal') || root.querySelector('.nav')) return;
    const box = h('div', { class: 'news-box' });
    (search.closest('.toolbar') || search).before(box);
    refresh(box).catch(() => {});
  }
  const view = document.getElementById('view');
  if (view) new MutationObserver(() => { try { newsBox(view); } catch (e) {} }).observe(view, { childList: true, subtree: true });
})();

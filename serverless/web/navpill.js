// Нижнее меню в стиле Apple: «стеклянная» плашка активной вкладки плавно скользит к новой вкладке с лёгкой пружиной и растяжением, значки меняют цвет без скачка,
// нажатие на вкладку слегка «вдавливается». Плашку можно перетаскивать пальцем: она следует за пальцем (чуть увеличивается), вкладка под ней подсвечивается с лёгкой вибрацией,
// при отпускании открывается ближайшая вкладка. Обычное нажатие работает как раньше: жест начинается только после сдвига на 8 px, а «хвостовой» клик после перетаскивания гасится.
// Работает поверх существующего меню (app.js не правится): плашка — отдельный элемент внутри #tabs. Подключается после anim.js
(function () {
  const tabs = document.getElementById('tabs');
  if (!tabs) return;
  const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const css = document.createElement('style');
  css.textContent = [
    '.tab-pill{position:absolute;left:0;top:0;border-radius:26px;pointer-events:none;opacity:0;background:rgba(255,255,255,.62);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 2px 10px rgba(0,0,0,.14);transition:transform .46s cubic-bezier(.34,1.42,.5,1),width .46s cubic-bezier(.34,1.42,.5,1),height .3s ease,opacity .2s ease,scale .25s ease}',
    '[data-theme=dark] .tab-pill{background:rgba(255,255,255,.16);box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 2px 10px rgba(0,0,0,.4)}',
    'nav#tabs{touch-action:none;-webkit-user-select:none;user-select:none}',
    'nav#tabs button.on{background:transparent!important;box-shadow:none!important}',
    'nav#tabs button{-webkit-tap-highlight-color:transparent;transition:color .28s ease,transform .16s ease}',
    'nav#tabs button:active{transform:scale(.92)}',
    'nav#tabs button.peek{color:var(--tg-theme-button-color,#2481cc)}',
    '@media (prefers-reduced-motion:reduce){.tab-pill{transition:none}nav#tabs button{transition:none}}',
  ].join('\n');
  document.head.append(css);

  const pill = document.createElement('span');
  pill.className = 'tab-pill';
  let placed = false;
  let lastX = null;
  let lastY = 0;
  let raf = 0;
  let drag = null;
  let suppress = false;
  let own = false;

  const buttons = () => Array.from(tabs.querySelectorAll('button'));

  function nearest(x) {
    const mid = x + (parseFloat(pill.style.width) || 0) / 2;
    let best = null;
    let dist = Infinity;
    for (const b of buttons()) {
      const d = Math.abs(b.offsetLeft + b.offsetWidth / 2 - mid);
      if (d < dist) { dist = d; best = b; }
    }
    return best;
  }

  function place() {
    raf = 0;
    if (drag && drag.on) return;
    if (!pill.isConnected) tabs.prepend(pill);
    const b = tabs.querySelector('button.on');
    if (!b || !b.offsetWidth) { pill.style.opacity = '0'; return; }
    const x = b.offsetLeft;
    const y = b.offsetTop;
    lastY = y;
    pill.style.opacity = '1';
    pill.style.width = b.offsetWidth + 'px';
    pill.style.height = b.offsetHeight + 'px';
    const tr = 'translate(' + x + 'px,' + y + 'px)';
    if (!placed) {
      pill.style.transition = 'none';
      pill.style.transform = tr;
      void pill.offsetWidth;
      pill.style.transition = '';
      placed = true;
      lastX = x;
      return;
    }
    pill.style.transform = tr;
    if (x !== lastX && !reduce && pill.animate) {
      try { pill.animate([{ scale: '1 1' }, { scale: '1.1 .93', offset: 0.35 }, { scale: '1 1' }], { duration: 460, easing: 'ease-out' }); } catch (e) {}
    }
    lastX = x;
  }

  const schedule = () => { if (!raf) raf = requestAnimationFrame(place); };

  function clearPeek() {
    for (const b of buttons()) b.classList.remove('peek');
  }

  tabs.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || !placed || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag = { id: e.pointerId, x0: e.clientX, base: lastX, cur: lastX, on: false, near: null };
  });

  tabs.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    if (!drag.on) {
      if (Math.abs(dx) < 8) return;
      drag.on = true;
      try { tabs.setPointerCapture(e.pointerId); } catch (err) {}
      pill.style.transition = 'scale .25s ease';
      pill.style.scale = '1.08';
    }
    const bs = buttons();
    if (!bs.length) return;
    const lo = bs[0].offsetLeft;
    const hi = bs[bs.length - 1].offsetLeft;
    const x = Math.max(lo, Math.min(hi, drag.base + dx));
    drag.cur = x;
    pill.style.transform = 'translate(' + x + 'px,' + lastY + 'px)';
    const n = nearest(x);
    if (n !== drag.near) {
      drag.near = n;
      clearPeek();
      if (n) n.classList.add('peek');
      try { buzz.pick(); } catch (err) {}
    }
  });

  function finish(cancel) {
    if (!drag) return;
    const d = drag;
    drag = null;
    clearPeek();
    if (!d.on) return;
    try { tabs.releasePointerCapture(d.id); } catch (err) {}
    pill.style.transition = '';
    pill.style.scale = '';
    suppress = true;
    setTimeout(() => { suppress = false; }, 350);
    const t = cancel ? null : nearest(d.cur);
    if (t && !t.classList.contains('on')) {
      own = true;
      try { t.click(); } finally { own = false; }
    }
    schedule();
  }

  tabs.addEventListener('pointerup', () => finish(false));
  tabs.addEventListener('pointercancel', () => finish(true));
  tabs.addEventListener('click', (e) => {
    if (suppress && !own) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  new MutationObserver(schedule).observe(tabs, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', () => { placed = false; schedule(); });
  schedule();
})();

// Нижнее меню в стиле Apple: «стеклянная» плашка активной вкладки плавно скользит к новой вкладке с лёгкой пружиной и растяжением, значки меняют цвет без скачка,
// нажатие на вкладку слегка «вдавливается». Работает поверх существующего меню (app.js не правится): плашка — отдельный элемент внутри #tabs. Подключается после anim.js
(function () {
  const tabs = document.getElementById('tabs');
  if (!tabs) return;
  const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const css = document.createElement('style');
  css.textContent = [
    '.tab-pill{position:absolute;left:0;top:0;border-radius:26px;pointer-events:none;opacity:0;background:rgba(255,255,255,.62);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 2px 10px rgba(0,0,0,.14);transition:transform .46s cubic-bezier(.34,1.42,.5,1),width .46s cubic-bezier(.34,1.42,.5,1),height .3s ease,opacity .2s ease}',
    '[data-theme=dark] .tab-pill{background:rgba(255,255,255,.16);box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 2px 10px rgba(0,0,0,.4)}',
    'nav#tabs button.on{background:transparent!important;box-shadow:none!important}',
    'nav#tabs button{-webkit-tap-highlight-color:transparent;transition:color .28s ease,transform .16s ease}',
    'nav#tabs button:active{transform:scale(.92)}',
    '@media (prefers-reduced-motion:reduce){.tab-pill{transition:none}nav#tabs button{transition:none}}',
  ].join('\n');
  document.head.append(css);

  const pill = document.createElement('span');
  pill.className = 'tab-pill';
  let placed = false;
  let lastX = null;
  let raf = 0;

  function place() {
    raf = 0;
    if (!pill.isConnected) tabs.prepend(pill);
    const b = tabs.querySelector('button.on');
    if (!b || !b.offsetWidth) { pill.style.opacity = '0'; return; }
    const x = b.offsetLeft;
    const y = b.offsetTop;
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
  new MutationObserver(schedule).observe(tabs, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', () => { placed = false; schedule(); });
  schedule();
})();

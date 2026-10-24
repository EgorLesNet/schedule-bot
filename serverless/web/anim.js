// Анимация переключения экранов (Сегодня, Неделя, ДЗ, Настройки): новый экран плавно выезжает со стороны вкладки, значок вкладки слегка «подпрыгивает».
// Работает поверх render() без правок app.js: отслеживает смену S.tab. При включённом «Уменьшить движение» в системе анимации нет. Подключается последним
(function () {
  const ORDER = ['day', 'week', 'hw', 'set'];
  const view = document.getElementById('view');
  const tabs = document.getElementById('tabs');
  if (!view || !view.animate) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let last = S.tab;
  let stamp = 0;

  function slide(dir) {
    const body = document.body;
    const prev = body.style.overflowX;
    body.style.overflowX = 'hidden';
    const a = view.animate(
      [{ opacity: 0, transform: 'translateX(' + dir * 26 + 'px) scale(.985)' }, { opacity: 1, transform: 'translateX(0) scale(1)' }],
      { duration: 260, easing: 'cubic-bezier(.22,.8,.3,1)' });
    const done = () => { body.style.overflowX = prev; };
    a.onfinish = done;
    a.oncancel = done;
  }

  function pop() {
    const ic = document.querySelector('#tabs button.on i');
    if (!ic || ic.dataset.pop === String(stamp)) return;
    ic.dataset.pop = String(stamp);
    ic.animate(
      [{ transform: 'scale(.78)' }, { transform: 'scale(1.16)', offset: 0.55 }, { transform: 'scale(1)' }],
      { duration: 340, easing: 'ease-out' });
  }

  function check() {
    if (S.tab !== last) {
      const from = ORDER.indexOf(last);
      const to = ORDER.indexOf(S.tab);
      last = S.tab;
      stamp = Date.now();
      slide(from < 0 || to < 0 || to >= from ? 1 : -1);
      pop();
    } else if (stamp && Date.now() - stamp < 400) {
      pop();
    }
  }

  const ob = new MutationObserver(() => {
    try { check(); } catch (e) {}
  });
  ob.observe(view, { childList: true });
  if (tabs) ob.observe(tabs, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
})();

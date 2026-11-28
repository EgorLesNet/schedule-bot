// Версия приложения внизу настроек. Значение берётся из version.js (self.APP_VERSION), то есть показывается версия реально загруженных файлов.
(function () {
  const view = document.getElementById('view');
  if (!view) return;
  function put() {
    if (typeof S === 'undefined' || S.tab !== 'set') return;
    if (!view.querySelector('.alerts-card')) return;
    const v = window.APP_VERSION;
    if (typeof v !== 'string' || !v) return;
    let el = view.querySelector('.app-version');
    if (!el) {
      el = document.createElement('p');
      el.className = 'muted center app-version';
      el.style.cssText = 'margin:16px 0 24px;font-size:12px;text-align:center;user-select:text';
      el.textContent = 'Версия ' + v;
    }
    if (view.lastElementChild !== el) view.append(el);
  }
  new MutationObserver(() => { try { put(); } catch (e) {} }).observe(view, { childList: true, subtree: true });
  put();
})();

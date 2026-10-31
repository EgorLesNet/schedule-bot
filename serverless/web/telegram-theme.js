// Telegram owns --tg-theme-*; this file only derives application variables.
(function () {
  const root = document.documentElement;
  const api = window.Telegram && window.Telegram.WebApp;
  const system = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const hex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : '';
  const rgb = (v) => [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)).join(',');
  const pause = () => root.classList.toggle('sb-glass-paused', document.hidden);
  function sync() {
    const p = (api && api.themeParams) || {};
    const dark = api && api.colorScheme ? api.colorScheme === 'dark' : !!(system && system.matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    const css = getComputedStyle(root);
    const color = (key) => hex(p[key]) || hex(css.getPropertyValue('--tg-theme-' + key.replace(/_/g, '-')));
    const colors = { '--sb-bg': color('bg_color'), '--sb-text': color('text_color'), '--sb-muted': color('hint_color'), '--sb-flat': color('secondary_bg_color') };
    for (const [name, value] of Object.entries(colors)) { if (value) root.style.setProperty(name, value); else root.style.removeProperty(name); }
    const bg = colors['--sb-bg'], panel = colors['--sb-flat'] || bg, accent = color('button_color');
    for (const [name, value] of [['--sb-bg-rgb', bg], ['--sb-panel-rgb', panel], ['--sb-accent-rgb', accent]]) {
      if (value) root.style.setProperty(name, rgb(value)); else root.style.removeProperty(name);
    }
    if (bg) {
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
      try { if (typeof api?.setBackgroundColor === 'function') api.setBackgroundColor(bg); } catch (e) {}
    }
    pause();
  }
  sync();
  try { api?.onEvent?.('themeChanged', sync); } catch (e) {}
  if (system && typeof system.addEventListener === 'function') system.addEventListener('change', sync);
  document.addEventListener('visibilitychange', pause);
})();

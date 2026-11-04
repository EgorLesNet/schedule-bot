// Temporary opening covers. No API/render overrides, caching, cloning or reparenting of application content.
(function () {
  if (!document.getElementById('view')) return;
  const media = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const records = new Map();
  const bypass = new WeakSet();
  const scope = '#view,#subj-panel,dialog.lesson-sheet';
  const containers = '.hw-editor,.hw-hist,.hw-archive,.subject-library,.club-feed,.linkform,.card,#subj-panel,dialog.lesson-sheet,#view';
  const loadingText = /^(?:Загрузка(?:\s+дат|\s+фото)?|Подключение|Поиск)[.…]*$/;
  let frame = 0;
  const style = document.createElement('style');
  style.textContent = '.sb-ready-cover{position:fixed!important;box-sizing:border-box!important;overflow:hidden!important;isolation:isolate;pointer-events:auto!important}.sb-ready-cover-shine{position:absolute;inset:0;pointer-events:none;background:linear-gradient(110deg,transparent 20%,rgba(128,128,128,.08) 50%,transparent 80%)}.sb-ready-cover-message{position:relative;margin:16px;padding:12px;font:14px/1.5 system-ui,sans-serif;color:inherit}';
  document.head.append(style);
  const reduced = () => Boolean(media && media.matches);
  function belongs(element) { return element instanceof Element && element.closest(scope) && !element.closest('.sb-ready-cover'); }
  function visible(element) {
    if (!element.isConnected || element.closest('[hidden]') || !element.getClientRects().length) return false;
    const css = getComputedStyle(element);
    return css.visibility !== 'hidden' && css.display !== 'none';
  }
  function rootFor(loader) {
    if (loader.classList.contains('sk-wrap')) return document.getElementById('view');
    return loader.closest(containers);
  }
  function findTargets() {
    const targets = new Set();
    for (const loader of document.querySelectorAll('#view .sk-wrap,#view p,#view div.muted,#subj-panel p,#subj-panel div.muted,dialog.lesson-sheet p,dialog.lesson-sheet div.muted')) {
      if (!belongs(loader) || !visible(loader) || loader.closest('.err,[role=alert]')) continue;
      if (!loader.classList.contains('sk-wrap') && (loader.children.length || !loadingText.test(loader.textContent.trim()))) continue;
      const root = rootFor(loader);
      if (root && visible(root)) targets.add(root);
    }
    return new Set([...targets].filter(element => ![...targets].some(parent => parent !== element && parent.contains(element))));
  }
  function restore(record) {
    if (record.root.getAttribute('aria-busy') === 'true') {
      if (record.busy === null) record.root.removeAttribute('aria-busy');
      else record.root.setAttribute('aria-busy', record.busy);
    }
    if ('inert' in record.root) record.root.inert = record.inert;
  }
  function remove(record) {
    clearTimeout(record.slowTimer); clearTimeout(record.limitTimer); clearTimeout(record.finishTimer);
    record.shimmer?.cancel(); record.fade?.cancel();
    record.cover.remove(); restore(record);
    if (records.get(record.root) === record) records.delete(record.root);
  }
  function place(record) {
    const rect = record.root.getBoundingClientRect();
    Object.assign(record.cover.style, { left: rect.left + 'px', top: rect.top + 'px', width: Math.max(0, rect.width) + 'px', height: Math.max(0, rect.height) + 'px' });
  }
  function create(root) {
    const cover = document.createElement('div');
    cover.className = 'sb-ready-cover';
    cover.setAttribute('role', 'status');
    cover.setAttribute('aria-label', 'Открытие раздела');
    const css = getComputedStyle(root);
    const body = getComputedStyle(document.body);
    const color = css.getPropertyValue('--tg-theme-bg-color').trim() || (body.backgroundColor !== 'rgba(0, 0, 0, 0)' ? body.backgroundColor : document.documentElement.dataset.theme === 'dark' ? '#10141b' : '#ffffff');
    Object.assign(cover.style, { background: color, color: body.color, borderRadius: css.borderRadius, zIndex: root.closest('#subj-panel') ? '91' : '2' });
    const shine = document.createElement('div'); shine.className = 'sb-ready-cover-shine'; shine.setAttribute('aria-hidden', 'true'); cover.append(shine);
    const record = { root, cover, started: performance.now(), busy: root.getAttribute('aria-busy'), inert: Boolean(root.inert), shimmer: null, fade: null, finishing: false };
    records.set(root, record);
    root.setAttribute('aria-busy', 'true');
    if ('inert' in root) root.inert = true;
    const dialog = root.closest('dialog[open]');
    (dialog || document.body).append(cover);
    place(record);
    if (!reduced() && shine.animate) record.shimmer = shine.animate([{ opacity: .15 }, { opacity: .85 }, { opacity: .15 }], { duration: 850, iterations: Infinity });
    record.slowTimer = setTimeout(() => {
      if (!root.isConnected) return remove(record);
      const message = document.createElement('p'); message.className = 'sb-ready-cover-message'; message.textContent = 'Соединение медленное. Ожидаем ответ сервера…'; cover.append(message);
    }, 1200);
    // Never leave the application hidden indefinitely if a request or a screen fails to settle.
    record.limitTimer = setTimeout(() => { bypass.add(root); remove(record); }, 15000);
    return record;
  }
  function reveal(record, immediate) {
    if (record.finishing) return;
    record.finishing = true;
    clearTimeout(record.slowTimer); clearTimeout(record.limitTimer);
    const delay = immediate || reduced() ? 0 : Math.max(0, 220 - (performance.now() - record.started));
    record.finishTimer = setTimeout(() => {
      if (!record.root.isConnected || immediate || reduced() || !record.cover.animate) return remove(record);
      record.shimmer?.cancel();
      record.fade = record.cover.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'cubic-bezier(.2,.65,.3,1)', fill: 'forwards' });
      record.fade.onfinish = () => remove(record);
    }, delay);
  }
  function update() {
    const targets = findTargets();
    for (const [root, record] of [...records]) {
      if (!root.isConnected || !visible(root)) { remove(record); continue; }
      const error = root.matches('.err,[role=alert]') || Boolean(root.querySelector('.err,[role=alert]'));
      if (error) { bypass.add(root); reveal(record, true); continue; }
      if (!targets.has(root)) reveal(record, false);
      else if (record.finishing) { remove(record); if (!bypass.has(root)) create(root); }
      else place(record);
    }
    for (const root of targets) {
      if (bypass.has(root) || records.has(root) || root.querySelector('.err,[role=alert]')) continue;
      create(root);
    }
  }
  const observer = new MutationObserver(changes => {
    if (!changes.some(change => !(change.target instanceof Element && change.target.closest('.sb-ready-cover')) && !(change.type === 'childList' && [...change.addedNodes, ...change.removedNodes].length && [...change.addedNodes, ...change.removedNodes].every(node => node instanceof Element && node.classList.contains('sb-ready-cover'))))) return;
    // Run before paint so intermediate placeholder text does not flash for one frame.
    update();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  function reposition() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; for (const record of records.values()) if (!record.finishing) place(record); });
  }
  window.addEventListener('scroll', reposition, { passive: true, capture: true });
  window.addEventListener('resize', reposition, { passive: true });
  const clear = () => { for (const record of [...records.values()]) remove(record); };
  window.addEventListener('pagehide', clear);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); else update(); });
  const onMotion = () => { if (reduced()) for (const record of records.values()) record.shimmer?.cancel(); };
  if (media?.addEventListener) media.addEventListener('change', onMotion);
  else if (media?.addListener) media.addListener(onMotion);
  update();
})();

// Opening effects only. No DOM reparenting, render/API wrappers, geometry, scroll or colour changes.
(function () {
  const view = document.getElementById('view');
  if (!view || typeof view.animate !== 'function') return;
  const media = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const active = new Map();
  const candidates = new Set();
  const panels = '#subj-panel,dialog.lesson-sheet,.hw-editor,.hw-hist,.hw-preview,.hw-draft,.hw-archive,.hw-archive .card,.hw-form-toggle + .card,.lesson-menu,.exam-card,.subject-library';
  const triggers = 'button,a,summary,[role=button],.card[style*="cursor"],.lesson b';
  let frame = 0;
  let rootDirty = false;
  let pendingNavigation = true;
  let interactionAt = -Infinity;
  let lastRoute = '';

  // Disable only the old opening animations that this file replaces.
  // Opacity-only effects never establish a containing block for fixed dialogs.
  const style = document.createElement('style');
  style.id = 'schedule-opening-effects';
  style.textContent = [
    '#subj-panel,.lesson-menu,.hw-form-toggle+.card,.hw-editor,.hw-hist,.hw-preview,.hw-draft,.hw-archive .card,.exam-card{animation:none!important}',
    '@media(prefers-reduced-motion:reduce){#subj-panel,.lesson-menu,.hw-form-toggle+.card,.hw-editor,.hw-hist,.hw-preview,.hw-draft,.hw-archive .card,.exam-card{animation:none!important}}'
  ].join('');
  document.head.append(style);

  function route() {
    try {
      if (typeof S === 'undefined') return '';
      const user = S.boot && S.boot.user || {};
      return [user.course || '',user.stream || '',S.tab || '',S.tab === 'day' ? S.date : S.tab === 'week' ? S.week : ''].join('|');
    } catch (error) { return ''; }
  }
  function reduced() { return Boolean(media && media.matches); }
  function visible(element) {
    return element.isConnected && !element.closest('[hidden]') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  }
  function loading() {
    const first = view.firstElementChild;
    return !first || first.classList.contains('sk-wrap') || (view.children.length === 1 && first.tagName === 'P' && /^(Загрузка|Подключение)/.test(first.textContent.trim()));
  }
  function cancel(element) {
    const animation = active.get(element);
    if (animation) { active.delete(element); animation.cancel(); }
  }
  function animate(element, duration) {
    if (reduced() || document.hidden || !visible(element)) return;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) if (active.has(parent)) return;
    cancel(element);
    const opacity = getComputedStyle(element).opacity;
    let animation;
    try {
      animation = element.animate([{ opacity: 0 }, { opacity }], { duration, easing: 'cubic-bezier(.2,.65,.3,1)', fill: 'none' });
    } catch (error) { return; }
    active.set(element, animation);
    const cleanup = () => { if (active.get(element) === animation) active.delete(element); };
    animation.onfinish = cleanup;
    animation.oncancel = cleanup;
  }
  function queue(element) {
    if (!(element instanceof Element)) return;
    if (element.matches(panels)) candidates.add(element);
    for (const child of element.querySelectorAll(panels)) candidates.add(child);
    // Library/club/link forms have no dedicated screen class. Only animate forms opened by the user.
    if (performance.now() - interactionAt < 800) {
      if (element.matches('.linkform')) candidates.add(element);
      for (const child of element.querySelectorAll('.linkform')) candidates.add(child);
    }
  }
  function flush() {
    frame = 0;
    for (const element of active.keys()) if (!element.isConnected) cancel(element);
    const currentRoute = route();
    const changedRoute = currentRoute !== lastRoute;
    const showRoot = rootDirty && !loading() && (pendingNavigation || changedRoute);
    rootDirty = false;
    if (showRoot) {
      for (const element of active.keys()) if (view.contains(element)) cancel(element);
      animate(view, 220);
      pendingNavigation = false;
      lastRoute = currentRoute;
    }
    const ready = [...candidates].filter(element => visible(element) && !(showRoot && view.contains(element)));
    candidates.clear();
    // A single parent fade is enough; never stack fades on a parent and its descendants.
    const outer = ready.filter(element => !ready.some(parent => parent !== element && parent.contains(element)));
    for (const element of outer) animate(element, element.id === 'subj-panel' ? 220 : 180);
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(flush); }
  function interaction(event) {
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target instanceof Element ? event.target.closest(triggers) : null;
    if (!target || (!target.closest('#view,#tabs,#subj-panel,dialog.lesson-sheet'))) return;
    if (target.matches(':disabled,[aria-disabled=true]')) return;
    interactionAt = performance.now();
    pendingNavigation = true;
  }
  document.addEventListener('click', interaction, true);
  document.addEventListener('keydown', interaction, true);

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') {
        if (record.target === view) rootDirty = true;
        for (const node of record.addedNodes) queue(node);
      } else {
        const element = record.target;
        // Attribute changes are only observed for known panels/details, not every button or input.
        if (element instanceof HTMLDetailsElement) {
          if (record.attributeName === 'open' && element.open) {
            for (const child of element.children) if (child.tagName !== 'SUMMARY') candidates.add(child);
          }
        } else if (element.matches(panels)) {
          if (visible(element)) candidates.add(element);
          else cancel(element);
        }
      }
    }
    schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open','hidden','style'] });
  function stopAll() {
    for (const element of [...active.keys()]) cancel(element);
    candidates.clear();
  }
  const onPreference = () => { if (reduced()) stopAll(); };
  if (media && media.addEventListener) media.addEventListener('change', onPreference);
  else if (media && media.addListener) media.addListener(onPreference);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAll(); });
  window.addEventListener('pagehide', stopAll);
  lastRoute = route();
  rootDirty = true;
  schedule();
})();

export const SURFACES = '.card,.cal,.banner,dialog.lesson-sheet,.ux-group>summary,.sheet-section>summary';
// Never move content or wrap existing cards. Only the dedicated decoration layer is owned here.
export function observeSurfaces({ doc = document, mount, frame = requestAnimationFrame, cancel = cancelAnimationFrame, Observer = MutationObserver, Intersection = globalThis.IntersectionObserver }) {
  const records = new Map(); let scheduled = 0, stopped = false;
  const eligible = (el) => {
    if (!el.isConnected || el.closest('.sb-glass-layer,#glisse-tabs,.lg-glass-copy') || el.matches('dialog:not([open])')) return false;
    const parent = el.tagName === 'SUMMARY' ? el.parentElement?.parentElement : el.parentElement;
    return !parent?.closest('details:not([open])');
  };
  const hide = (record) => {
    const stop = record.stop; record.stop = null;
    try { stop?.(); } finally { record.host?.remove(); record.host = null; if (record.el.classList.contains('sb-glass-rendered')) record.el.classList.remove('sb-glass-rendered'); }
  };
  const show = (record) => {
    if (record.stop || !record.visible || !eligible(record.el)) return;
    const host = doc.createElement('div'); host.className = 'sb-glass-layer'; host.setAttribute('aria-hidden', 'true'); host.setAttribute('inert', '');
    record.host = host; record.el.append(host);
    try { record.stop = mount(record.el, host) || (() => {}); }
    catch (error) { hide(record); console.warn('Glass surface fallback', error); }
  };
  const intersection = typeof Intersection === 'function' ? new Intersection((entries) => {
    if (stopped) return;
    for (const entry of entries) { const r = records.get(entry.target); if (!r) continue; r.visible = entry.isIntersecting; if (r.visible) show(r); else hide(r); }
  }, { rootMargin: '64px 0px' }) : null;
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom >= -64 && r.top <= (doc.defaultView?.innerHeight || 800) + 64; };
  function scan() {
    scheduled = 0; if (stopped) return;
    const targets = new Set(Array.from(doc.querySelectorAll(SURFACES)).filter(eligible));
    for (const [el, r] of records) {
      if (!targets.has(el)) { intersection?.unobserve(el); hide(r); el.classList.remove('sb-glass-surface'); records.delete(el); }
      else if (r.host && r.host.parentElement !== el) { hide(r); show(r); }
    }
    for (const el of targets) {
      if (!records.has(el)) {
        const r = { el, host: null, stop: null, visible: !intersection && visible(el) };
        records.set(el, r); if (!el.classList.contains('sb-glass-surface')) el.classList.add('sb-glass-surface');
        if (intersection) intersection.observe(el); else show(r);
      } else if (!intersection) { const r = records.get(el); r.visible = visible(el); if (r.visible) show(r); else hide(r); }
    }
  }
  function schedule() { if (!stopped && !scheduled) scheduled = frame(scan); }
  const changed = new Observer(schedule); changed.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'open'] });
  doc.defaultView?.addEventListener('resize', schedule); if (!intersection) doc.addEventListener('scroll', schedule, { passive: true, capture: true });
  scan();
  return () => {
    stopped = true; if (scheduled) cancel(scheduled); changed.disconnect(); intersection?.disconnect();
    doc.defaultView?.removeEventListener('resize', schedule); if (!intersection) doc.removeEventListener('scroll', schedule, { capture: true });
    for (const r of records.values()) { hide(r); r.el.classList.remove('sb-glass-surface'); } records.clear();
  };
}

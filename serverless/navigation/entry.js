import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { TabBar } from 'glisse';
import { readNavigation, activateTab } from './bridge.js';
import { startGlassSurfaces } from './surfaces.js';
import './nav.css';

// React owns only #glisse-tabs. The application continues to own #tabs and #view.
const legacy = document.getElementById('tabs');
if (legacy && typeof TABS !== 'undefined' && typeof S !== 'undefined' && typeof ResizeObserver === 'function') {
  const host = document.createElement('nav');
  host.id = 'glisse-tabs'; host.setAttribute('aria-label', 'Основные разделы');
  legacy.after(host);
  const html = document.documentElement;
  let failed = false, queued = 0, last = '';
  const restore = (error) => {
    failed = true;
    html.classList.remove('sb-glisse-ready'); html.dataset.navigation = 'legacy';
    legacy.removeAttribute('inert'); legacy.removeAttribute('aria-hidden');
    host.hidden = true;
    if (error) console.warn('Glisse navigation unavailable; original menu restored', error);
  };
  class Boundary extends React.Component {
    constructor(props) { super(props); this.state = { failed: false }; }
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch(error) { restore(error); }
    render() { return this.state.failed ? null : this.props.children; }
  }
  function Navigation({ snapshot }) {
    useEffect(() => {
      const frame = requestAnimationFrame(() => {
        if (failed || !host.querySelector('.lg-tab-bar[data-ready]')) return;
        html.classList.add('sb-glisse-ready'); html.dataset.navigation = 'glisse-0.4.3';
        const focused = legacy.contains(document.activeElement);
        legacy.setAttribute('aria-hidden', 'true');
        if (focused) host.querySelector('.lg-tab[data-selected]')?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }, [snapshot.signature]);
    const items = snapshot.items.map((item) => ({ value: item.value, label: React.createElement('span', { className: 'sb-nav-label' },
      React.createElement('i', { 'aria-hidden': true, dangerouslySetInnerHTML: { __html: item.icon } }), React.createElement('span', null, item.label)) }));
    return React.createElement(TabBar, { items, value: snapshot.value, 'aria-label': 'Разделы расписания',
      style: { '--lg-tab-width': snapshot.slot + 'px', '--lg-tab-height': '56px' },
      onValueChange: (value) => { activateTab(value, legacy, TABS); schedule(); } });
  }
  let root;
  function sync() {
    queued = 0;
    if (failed) return;
    const snapshot = readNavigation(legacy, TABS, S, host.clientWidth);
    if (!snapshot) {
      html.classList.remove('sb-glisse-ready'); legacy.removeAttribute('inert'); legacy.removeAttribute('aria-hidden'); last = '';
      return;
    }
    if (snapshot.signature === last) return;
    last = snapshot.signature;
    try { root.render(React.createElement(Boundary, null, React.createElement(Navigation, { snapshot }))); }
    catch (error) { restore(error); }
  }
  function schedule() { if (!failed && !queued) queued = requestAnimationFrame(sync); }
  try {
    root = createRoot(host);
    const changed = new MutationObserver(schedule);
    changed.observe(legacy, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    const resized = new ResizeObserver(schedule); resized.observe(host);
    window.addEventListener('resize', schedule);
    window.addEventListener('pageshow', schedule);
    schedule();
  } catch (error) { restore(error); }
}
startGlassSurfaces();

import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Glass } from 'glisse';
import { observeSurfaces } from './surface-controller.js';
export function startGlassSurfaces() {
  if (!document.body || typeof ResizeObserver !== 'function') return;
  const pause = () => document.documentElement.classList.toggle('sb-glass-paused', document.hidden);
  pause(); document.addEventListener('visibilitychange', pause);
  class SurfaceBoundary extends React.Component {
    constructor(props) { super(props); this.state = { failed: false }; }
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch(error) { this.props.surface.classList.remove('sb-glass-rendered'); console.warn('Glisse card fallback', error); }
    render() { return this.state.failed ? null : this.props.children; }
  }
  function Background({ surface, host }) {
    useEffect(() => {
      if (host.parentElement === surface && host.isConnected) surface.classList.add('sb-glass-rendered');
      return () => surface.classList.remove('sb-glass-rendered');
    }, [surface, host]);
    return React.createElement(Glass, { className: 'sb-card-glass', 'aria-hidden': true });
  }
  try {
    const stop = observeSurfaces({ mount: (surface, host) => {
      const root = createRoot(host);
      root.render(React.createElement(SurfaceBoundary, { surface }, React.createElement(Background, { surface, host })));
      return () => { root.unmount(); surface.classList.remove('sb-glass-rendered'); };
    } });
    return () => { stop(); document.removeEventListener('visibilitychange', pause); };
  } catch (error) { document.removeEventListener('visibilitychange', pause); console.warn('Glisse surfaces unavailable; CSS fallback remains', error); }
}

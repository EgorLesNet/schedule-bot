import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { observeSurfaces } from './surface-controller.js';
class Element {
  constructor(tag = 'SECTION') { this.tagName = tag; this.isConnected = true; this.parentElement = null; this.children = []; this.attrs = {}; this.classes = new Set(); this.classList = { add: (x) => this.classes.add(x), remove: (x) => this.classes.delete(x), contains: (x) => this.classes.has(x) }; }
  set className(v) { this.classes = new Set(v.split(' ')); } setAttribute(k, v) { this.attrs[k] = v; }
  append(x) { this.children.push(x); x.parentElement = this; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((x) => x !== this); this.parentElement = null; }
  matches() { return this.tagName === 'DIALOG' && this.closed; }
  closest(selector) { if (selector.startsWith('.sb-glass-layer')) return this.blocked ? this : null; return this.tagName === 'DETAILS' && this.closed ? this : this.parentElement?.closest(selector) || null; }
  getBoundingClientRect() { return { width: 300, height: 80, top: this.top || 0, bottom: (this.top || 0) + 80 }; }
}
function fixture(intersection = true) {
  const card = new Element(), child = { value: 'draft', handler: () => 42 }; card.append(child);
  let targets = [card], io, mo, mounted = 0, removed = 0, frames = new Map(), serial = 0;
  class Observer { constructor(cb) { this.cb = cb; mo = this; } observe() {} disconnect() {} }
  class Intersection { constructor(cb) { this.cb = cb; io = this; this.observed = new Set(); } observe(el) { this.observed.add(el); } unobserve(el) { this.observed.delete(el); } disconnect() { this.observed.clear(); } fire(el, visible) { this.cb([{ target: el, isIntersecting: visible }]); } }
  const doc = { body: {}, createElement: () => new Element('DIV'), querySelectorAll: () => targets, addEventListener() {}, removeEventListener() {}, defaultView: { innerHeight: 600, addEventListener() {}, removeEventListener() {} } };
  const stop = observeSurfaces({ doc, Observer, Intersection: intersection ? Intersection : null, frame: (fn) => { frames.set(++serial, fn); return serial; }, cancel: (n) => frames.delete(n), mount: (el) => { mounted++; el.classList.add('sb-glass-rendered'); return () => { removed++; el.classList.remove('sb-glass-rendered'); }; } });
  const update = () => { mo.cb([]); const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn()); };
  return { card, child, io, stop, update, setTargets: (v) => { targets = v; update(); }, counts: () => [mounted, removed] };
}
test('offscreen surfaces are not mounted before intersection', () => { const f = fixture(); assert.deepEqual(f.counts(), [0, 0]); assert.equal(f.card.children.length, 1); f.stop(); });
test('visible surface mounts only once', () => { const f = fixture(); f.io.fire(f.card, true); f.io.fire(f.card, true); f.update(); assert.deepEqual(f.counts(), [1, 0]); f.stop(); });
test('existing inputs handlers and node order are unchanged', () => { const f = fixture(); f.io.fire(f.card, true); assert.equal(f.card.children[0], f.child); assert.equal(f.child.value, 'draft'); assert.equal(f.child.handler(), 42); assert.equal(f.card.children[1].attrs['aria-hidden'], 'true'); f.stop(); });
test('offscreen roots unmount and can remount', () => { const f = fixture(); f.io.fire(f.card, true); f.io.fire(f.card, false); assert.deepEqual(f.counts(), [1, 1]); f.io.fire(f.card, true); assert.deepEqual(f.counts(), [2, 1]); f.stop(); });
test('replaceChildren-style removal cleans stale root and decorates again', () => { const f = fixture(); f.io.fire(f.card, true); const host = f.card.children[1]; host.remove(); f.update(); assert.deepEqual(f.counts(), [2, 1]); assert.equal(f.card.children[0], f.child); f.stop(); });
test('removed cards are unobserved and cleaned', () => { const f = fixture(); f.io.fire(f.card, true); f.card.isConnected = false; f.setTargets([]); assert.deepEqual(f.counts(), [1, 1]); assert.equal(f.io.observed.size, 0); f.stop(); });
test('closed details exclude contents but not their own summary header', () => { const f = fixture(); const details = new Element('DETAILS'); details.closed = true; const summary = new Element('SUMMARY'); summary.parentElement = details; f.card.parentElement = details; f.setTargets([f.card, summary]); assert.equal(f.io.observed.has(f.card), false); assert.equal(f.io.observed.has(summary), true); f.stop(); });
test('React decoration layers and copied backdrops are skipped', () => { const f = fixture(); f.card.blocked = true; f.update(); assert.equal(f.io.observed.has(f.card), false); f.stop(); });
test('fallback without IntersectionObserver handles visibility and cleanup', () => { const f = fixture(false); assert.deepEqual(f.counts(), [1, 0]); f.card.top = 2000; f.update(); f.update(); assert.deepEqual(f.counts(), [1, 1]); f.card.top = 0; f.update(); assert.deepEqual(f.counts(), [2, 1]); f.stop(); });
test('stopping twice does not double-unmount', () => { const f = fixture(); f.io.fire(f.card, true); f.stop(); f.stop(); assert.deepEqual(f.counts(), [1, 1]); });
test('light dark reduced-motion and solid fallbacks are defined', () => { const css = readFileSync(new URL('../web/glass-theme.css', import.meta.url), 'utf8'); for (const token of ['data-theme=dark', 'prefers-reduced-motion:reduce', 'prefers-reduced-transparency:reduce', '36s ease-in-out', '.sb-glass-surface.sb-glass-rendered']) assert.ok(css.includes(token)); assert.ok(css.includes('--sb-bg:#f6f8fc')); assert.ok(css.includes('--sb-bg:#10141b')); });
test('dialog keeps its existing fixed positioning', () => { const css = readFileSync(new URL('../web/glass-theme.css', import.meta.url), 'utf8'); assert.ok(css.includes('.sb-glass-surface:not(dialog){position:relative')); assert.ok(css.includes('dialog.sb-glass-surface{isolation:isolate}')); });

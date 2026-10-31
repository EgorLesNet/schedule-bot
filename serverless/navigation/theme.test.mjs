import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/telegram-theme.js', import.meta.url), 'utf8');
function run(params = {}, scheme = 'light', css = {}, telegram = true) {
  const values = {}, events = {}, native = [], meta = {}, classes = new Set();
  const api = { themeParams: params, colorScheme: scheme, onEvent: (n, fn) => { events[n] = fn; }, setBackgroundColor: (v) => native.push(v) };
  const root = { dataset: {}, classList: { toggle: (n, on) => on ? classes.add(n) : classes.delete(n) }, style: { setProperty: (k, v) => { values[k] = v; }, removeProperty: (k) => { delete values[k]; } } };
  const doc = { documentElement: root, hidden: false, querySelector: () => ({ setAttribute: (k, v) => { meta[k] = v; } }), addEventListener: (n, fn) => { events[n] = fn; } };
  const system = { matches: scheme === 'dark', addEventListener: (n, fn) => { events.system = fn; } };
  vm.runInNewContext(source, { document: doc, window: { Telegram: telegram ? { WebApp: api } : undefined, matchMedia: () => system }, getComputedStyle: () => ({ getPropertyValue: (k) => css[k] || '' }) });
  return { values, api, root, events, native, meta, classes, doc, system };
}
test('custom Telegram background is the exact base', () => { const r = run({ bg_color: '#E9DCCC', text_color: '#332211', hint_color: '#776655', secondary_bg_color: '#DDCCBB' }); assert.equal(r.values['--sb-bg'], '#e9dccc'); assert.equal(r.values['--sb-text'], '#332211'); assert.equal(r.values['--sb-panel-rgb'], '221,204,187'); assert.equal(r.meta.content, '#e9dccc'); });
test('does not overwrite Telegram-owned CSS variables', () => { const r = run({ bg_color: '#112233' }); assert.equal(Object.keys(r.values).some((k) => k.startsWith('--tg-theme-')), false); });
test('live Telegram theme change updates background and scheme', () => { const r = run({ bg_color: '#ffffff' }); r.api.colorScheme = 'dark'; r.api.themeParams = { bg_color: '#2B2420', secondary_bg_color: '#3A322C' }; r.events.themeChanged(); assert.equal(r.values['--sb-bg'], '#2b2420'); assert.equal(r.root.dataset.theme, 'dark'); assert.equal(r.values['--sb-bg-rgb'], '43,36,32'); });
test('CSS theme variables work when native params are absent', () => { const r = run({}, 'dark', { '--tg-theme-bg-color': '#123456' }); assert.equal(r.values['--sb-bg'], '#123456'); });
test('plain browser uses CSS defaults and tracks system scheme', () => { const r = run({}, 'light', {}, false); assert.equal(r.values['--sb-bg'], undefined); r.system.matches = true; r.events.system(); assert.equal(r.root.dataset.theme, 'dark'); });
test('invalid colors cannot be injected into CSS', () => { const r = run({ bg_color: 'red;display:none', button_color: 'url(x)' }); assert.equal(r.values['--sb-bg'], undefined); assert.equal(r.values['--sb-accent-rgb'], undefined); });
test('background pauses even without a React bundle', () => { const r = run(); r.doc.hidden = true; r.events.visibilitychange(); assert.equal(r.classes.has('sb-glass-paused'), true); });
test('removed theme parameters do not leave stale overrides', () => { const r = run({ bg_color: '#112233' }); r.api.themeParams = {}; r.events.themeChanged(); assert.equal(r.values['--sb-bg'], undefined); assert.equal(r.values['--sb-panel-rgb'], undefined); });
test('ambient layer is above base and below page content', () => { const css = readFileSync(new URL('../web/glass-theme.css', import.meta.url), 'utf8'); assert.match(css, /body::before\{[^}]*z-index:0/); assert.match(css, /main#view\{position:relative;z-index:1/); assert.doesNotMatch(css, /--tg-theme-[a-z-]+\s*:/); });
test('background is loaded independently of Glisse bundle', () => { const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8'); assert.ok(html.indexOf("src='telegram-theme.js'") < html.indexOf("src='app.js'")); assert.ok(html.includes("href='glass-theme.css'")); });

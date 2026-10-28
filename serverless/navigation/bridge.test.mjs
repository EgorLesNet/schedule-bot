import test from 'node:test';
import assert from 'node:assert/strict';
import { readNavigation, activateTab } from './bridge.js';
const tabs = [['day', 'Сегодня'], ['week', 'Неделя'], ['hw', 'ДЗ'], ['clubs', 'Клубы'], ['set', 'Настройки']];
function fixture(active = 0, count = 5) {
  const clicks = [];
  const buttons = Array.from({ length: count }, (_, i) => ({ disabled: false, classList: { contains: (c) => c === 'on' && i === active }, querySelector: () => ({ innerHTML: '<svg>' + i + '</svg>' }), click: () => clicks.push(i) }));
  return { clicks, buttons, legacy: { querySelectorAll: () => buttons } };
}
test('keeps all five tabs including clubs in their real order', () => { const f = fixture(); const d = readNavigation(f.legacy, tabs, { tab: 'clubs' }, 400); assert.deepEqual(d.items.map((x) => x.value), tabs.map((x) => x[0])); assert.equal(d.value, 'clubs'); });
test('uses the original button handler rather than duplicating routing', () => { const f = fixture(); assert.equal(activateTab('hw', f.legacy, tabs), true); assert.deepEqual(f.clicks, [2]); });
test('repeated selected-tab taps are both forwarded', () => { const f = fixture(); activateTab('day', f.legacy, tabs); activateTab('day', f.legacy, tabs); assert.deepEqual(f.clicks, [0, 0]); });
test('bootstrapping mismatched buttons leaves fallback available', () => { const f = fixture(0, 4); assert.equal(readNavigation(f.legacy, tabs, {}, 400), null); assert.equal(activateTab('day', f.legacy, tabs), false); });
test('unknown or disabled targets never click another tab', () => { const f = fixture(); f.buttons[3].disabled = true; assert.equal(activateTab('clubs', f.legacy, tabs), false); assert.equal(activateTab('missing', f.legacy, tabs), false); assert.deepEqual(f.clicks, []); });
test('resizes recalculate exact tab widths', () => { const f = fixture(); assert.equal(readNavigation(f.legacy, tabs, {}, 328).slot, 64); assert.equal(readNavigation(f.legacy, tabs, {}, 408).slot, 80); });
test('zero-width and missing menus are not mounted', () => { const f = fixture(); assert.equal(readNavigation(f.legacy, tabs, {}, 0), null); assert.equal(readNavigation(null, tabs, {}, 400), null); });
test('dynamic tabs work without hardcoded counts', () => { const f = fixture(0, 6); const d = readNavigation(f.legacy, [...tabs, ['extra', 'Ещё']], { tab: 'extra' }, 400); assert.equal(d.items.length, 6); assert.equal(d.value, 'extra'); });
test('invalid selection falls back to native active class', () => { const f = fixture(2); assert.equal(readNavigation(f.legacy, tabs, { tab: 'missing' }, 400).value, 'hw'); });
test('duplicate keys are rejected', () => { const f = fixture(); const duplicate = tabs.map((x) => [...x]); duplicate[1][0] = 'day'; assert.equal(readNavigation(f.legacy, duplicate, {}, 400), null); });
test('unchanged snapshots have stable signatures', () => { const f = fixture(); assert.equal(readNavigation(f.legacy, tabs, {}, 400).signature, readNavigation(f.legacy, tabs, {}, 400).signature); });

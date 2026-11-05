import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const helper = await readFile(new URL('../tgcloud/lib/exam-scope.js', import.meta.url), 'utf8');
const { resolveExamScope, sameExamScope } = await import('data:text/javascript;base64,' + Buffer.from(helper).toString('base64'));
const entries = [
  { faculty: 'Социологический', course: '1', key: 'soc', file: 'docs/Социологический/1курс_Общий.ics' },
  { faculty: 'Исторический', course: '1', key: 'hist', file: 'docs/Исторический/1курс_Общий.ics' },
  { faculty: 'Социологический', course: '2', key: 'soc2', file: 'docs/Социологический/2курс_Общий.ics' }
];
const selected = (faculty, stream, course = '1') => ({ faculty, stream, course });
test('same course in different faculties never shares scope', () => {
  const a = resolveExamScope(selected('Социологический', 'soc'), entries);
  const b = resolveExamScope(selected('Исторический', 'hist'), entries);
  assert.equal(a.faculty, 'Социологический'); assert.equal(b.faculty, 'Исторический');
  assert.equal(sameExamScope(a, b), false);
});
test('inconsistent saved faculty fails closed', () => {
  assert.equal(resolveExamScope(selected('Исторический', 'soc'), entries), null);
  assert.equal(resolveExamScope(selected(0, 'soc'), entries), null);
});
test('unknown or incomplete schedule has no fallback', () => {
  assert.equal(resolveExamScope({}, entries), null);
  assert.equal(resolveExamScope(selected('Социологический', 'missing'), entries), null);
  assert.equal(resolveExamScope(selected('Социологический', 'soc', '2'), entries), null);
});
test('legacy user without saved faculty resolves only its exact stream', () => {
  assert.equal(resolveExamScope({ course: '1', stream: 'hist' }, entries).faculty, 'Исторический');
});
test('scope validates every field including file', () => {
  const scope = resolveExamScope(selected('Социологический', 'soc'), entries);
  assert.equal(sameExamScope(scope, { ...scope }), true);
  for (const key of ['faculty', 'course', 'stream', 'file']) {
    assert.equal(sameExamScope(scope, { ...scope, [key]: '' }), false);
    assert.equal(sameExamScope(scope, { ...scope, [key]: 'wrong' }), false);
  }
  assert.equal(sameExamScope(null, scope), false);
});

const client = await readFile(new URL('../web/more.js', import.meta.url), 'utf8');
function harness(request) {
  const calls = [];
  const state = { boot: { user: { faculty: 0, course: '1', stream: 'soc' }, faculties: [{ name: 'Социологический' }, { name: 'Исторический' }], schedules: [{ course: '1', streams: entries.filter(e => e.course === '1') }] } };
  const context = { S: state, Date, Map, Promise, nowMsk: () => ({ date: '2026-11-05' }), document: { getElementById: () => null }, MutationObserver: class { observe() {} },
    call: (name, params, cache) => { calls.push({ name, params, cache }); return request ? request(name, params) : Promise.resolve({ items: [], scope: params.scope }); },
    h: (tag, attrs, ...children) => ({ dataset: {}, isConnected: true, children, append(...nodes) { this.children.push(...nodes); } }) };
  const marker = '  const dayWord';
  assert.ok(client.includes(marker));
  vm.runInNewContext(client.replace(marker, '  globalThis.examTest = { examScope, scopeKey, loadEx, examBox };\n' + marker), context);
  return { api: context.examTest, state, calls };
}
test('client cache and request keys differ after faculty switch', async () => {
  const { api, state, calls } = harness();
  const a = api.examScope();
  await api.loadEx(a); await api.loadEx(a);
  assert.equal(calls.length, 1);
  state.boot.user = { faculty: 1, course: '1', stream: 'hist' };
  const b = api.examScope(); await api.loadEx(b);
  assert.equal(calls.length, 2);
  assert.notEqual(JSON.stringify(calls[0].params), JSON.stringify(calls[1].params));
  assert.equal(calls[1].params.scope.faculty, 'Исторический');
  assert.equal(calls[0].cache, false);
  assert.equal(calls[1].params.scopeVersion, 2);
});
test('failed request is not retained in memory cache', async () => {
  let count = 0;
  const { api } = harness(() => ++count === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ items: [] }));
  await assert.rejects(api.loadEx(api.examScope()), /offline/);
  await api.loadEx(api.examScope()); assert.equal(count, 2);
});
test('client refuses faculty/stream mismatch', () => {
  const { api, state } = harness(); state.boot.user.faculty = 1;
  assert.equal(api.examScope(), null);
});
test('slow old-faculty response is not appended', async () => {
  let resolve;
  const { api, state } = harness(() => new Promise(done => { resolve = done; }));
  const scope = api.examScope(); let box;
  const search = { closest: () => ({ before: node => { box = node; } }) };
  const root = { querySelector: selector => selector === 'input[type=search]' ? search : selector === '.cal' ? {} : null, querySelectorAll: () => [] };
  api.examBox(root);
  state.boot.user = { faculty: 1, course: '1', stream: 'hist' };
  resolve({ scope, items: [{ summary: 'Чужой экзамен', date: '2026-12-01', start: '10:00' }] });
  await new Promise(done => setImmediate(done));
  assert.equal(box.children.length, 0);
});

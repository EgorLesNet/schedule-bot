import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../web/sw.js', import.meta.url), 'utf8');

test('upgrading discards the legacy shell but leaves other caches and network requests alone', async () => {
  const listeners = new Map();
  const cacheNames = new Set(['schedule-v51', 'unrelated-cache']);
  const calls = [];
  vm.runInNewContext(source, {
    caches: { async delete(name) { calls.push(['delete', name]); return cacheNames.delete(name); } },
    self: {
      addEventListener(name, handler) { listeners.set(name, handler); },
      async skipWaiting() { calls.push(['skipWaiting']); },
      clients: { async claim() { calls.push(['claim']); } },
    },
  });
  async function dispatch(name) {
    const promises = [];
    assert.equal(typeof listeners.get(name), 'function');
    listeners.get(name)({ waitUntil(promise) { promises.push(promise); } });
    assert.ok(promises.length > 0);
    await Promise.all(promises);
  }
  await dispatch('install');
  await dispatch('activate');
  assert.deepEqual(calls, [['skipWaiting'], ['delete', 'schedule-v51'], ['claim']]);
  assert.deepEqual([...cacheNames], ['unrelated-cache']);
  assert.equal(listeners.has('fetch'), false);
});

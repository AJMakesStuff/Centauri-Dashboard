const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function worker() {
  const handlers = {}, removed = [], saved = new Map();
  let online = true, claimed = false, skipped = false;
  const cache = {
    add: async () => { },
    put: async (request, response) => saved.set(request.url, response),
    match: async request => saved.get(request.url)
  };
  const scope = {
    location: { origin: 'http://localhost' },
    addEventListener: (name, fn) => handlers[name] = fn,
    skipWaiting: async () => { skipped = true; },
    clients: { claim: async () => { claimed = true; } }
  };
  vm.runInNewContext(fs.readFileSync('service-worker.js', 'utf8'), {
    self: scope, URL, Request: class { constructor(url) { this.url = url; } },
    caches: { open: async () => cache, delete: async name => removed.push(name) },
    fetch: async () => { if (!online) throw Error('offline'); return new Response('current HTML'); }
  });
  return { handlers, removed, saved, offline() { online = false; }, claimed: () => claimed, skipped: () => skipped };
}
test('worker replaces legacy cache, fetches fresh HTML, and retains offline fallback', async () => {
  const w = worker();
  let pending;
  w.handlers.install({ waitUntil: p => pending = p }); await pending;
  w.handlers.activate({ waitUntil: p => pending = p }); await pending;
  assert.deepEqual(w.removed, ['pwa-cache']);
  assert(w.claimed()); assert(w.skipped());
  const request = { method: 'GET', url: 'http://localhost/dashboard.html' };
  w.saved.set(request.url, new Response('old HTML without Star Wars'));
  w.handlers.fetch({ request, respondWith: p => pending = p });
  assert.equal(await (await pending).text(), 'current HTML');
  w.offline();
  w.handlers.fetch({ request, respondWith: p => pending = p });
  assert.equal(await (await pending).text(), 'current HTML');
});
test('worker leaves camera streams and replay APIs alone', () => {
  const w = worker();
  for (const url of ['http://localhost/api/replay', 'http://printer/video', 'http://localhost/camera']) {
    w.handlers.fetch({ request: { method: 'GET', url }, respondWith() { assert.fail('Unexpected interception'); } });
  }
});

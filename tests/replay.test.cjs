const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('replay.js', 'utf8');
function view(store, search = '') {
  const requests = [], elements = new Map(), events = {};
  const context = vm.createContext({
    crypto: require('node:crypto').webcrypto, URLSearchParams, location: { search },
    localStorage: { getItem: () => JSON.stringify({ printerModel: 'cc1' }) },
    sessionStorage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) },
    document: { getElementById(id) { if (!elements.has(id)) elements.set(id, { value: 0, removeAttribute() {}, addEventListener() {} }); return elements.get(id); } },
    window: {}, setInterval() {}, addEventListener(name, fn) { events[name] = fn; },
    AbortSignal, fetch: async (_, options) => { const body = JSON.parse(options.body); requests.push(body); return { ok: true, json: async () => ({ frames: body.delete ? 0 : 4, seconds: 2, recording: body.active && !body.delete }) }; }
  });
  vm.runInContext(source, context);
  return { update: (...args) => context.window.printReplay.update(...args), requests, events, elements };
}
test('reload reuses recording identity and does not delete footage on pagehide', () => {
  const storage = new Map();
  const first = view(storage);
  first.update(true, 'http://printer/video', 'part.gcode');
  assert.equal(first.events.pagehide, undefined);
  const reloaded = view(storage);
  reloaded.update(true, 'http://printer/video', 'part.gcode');
  assert.equal(reloaded.requests[0].id, first.requests[0].id);
  assert.equal(reloaded.requests[0].active, true);
});

test('completed replay remains visible and can be explicitly deleted', async () => {
  const t = view(new Map());
  t.update(true, 'http://printer/video', 'part');
  await new Promise(setImmediate);
  t.update(false, 'http://printer/video', '');
  await new Promise(setImmediate);
  assert.equal(t.elements.get('replayPanel').hidden, false);
  assert.equal(t.elements.get('replayPlay').disabled, false);
  assert.equal(t.elements.get('replayRecording').hidden, true);
  assert.match(t.elements.get('replayStatus').textContent, /Local replay available/);
  t.elements.get('replayDelete').onclick();
  await new Promise(setImmediate);
  assert.equal(t.requests.at(-1).delete, true);
  assert.equal(t.elements.get('replayPanel').hidden, true);
});

test('an idle dashboard recovers completed footage after reload', async () => {
  const t = view(new Map());
  t.update(false, 'http://printer/video', '');
  await new Promise(setImmediate);
  assert.equal(t.requests.length, 1);
  assert.equal(t.elements.get('replayPanel').hidden, false);
  assert.equal(t.elements.get('replayPlay').disabled, false);
});
test('Both view uses separate persistent identities for each printer', () => {
  const storage = new Map();
  const cc1 = view(storage, '?printer=cc1'), cc2 = view(storage, '?printer=cc2');
  cc1.update(true, 'http://one/video', 'part'); cc2.update(true, 'http://two/video', 'part');
  assert.notEqual(cc1.requests[0].id, cc2.requests[0].id);
  const reload = view(storage, '?printer=cc2');
  reload.update(true, 'http://two/video', 'part');
  assert.equal(reload.requests[0].id, cc2.requests[0].id);
});

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
    document: {
      getElementById(id) {
        if (!elements.has(id)) {
          const classes = new Set();
          elements.set(id, {
            value: 0, removeAttribute() { }, addEventListener() { }, focus() { },
            setAttribute(name, value) { this[name] = value; },
            classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name), toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) }
          });
        }
        return elements.get(id);
      }
    },
    window: {}, setInterval() { }, addEventListener(name, fn) { events[name] = fn; },
    AbortSignal, fetch: async (_, options) => { const body = options.body ? JSON.parse(options.body) : {}; requests.push(body); return { ok: true, json: async () => ({ frames: body.delete ? 0 : 4, seconds: 2, recording: body.active && !body.delete }) }; }
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
  assert.equal(t.elements.get('fullscreenReplayButton').hidden, true);
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

test('fullscreen replay opens paused and closes without discarding the recording', async () => {
  const t = view(new Map());
  t.update(true, 'http://printer/video', 'part');
  await new Promise(setImmediate);
  const button = t.elements.get('fullscreenReplayButton');
  const panel = t.elements.get('replayPanel');
  assert.equal(button.disabled, false);
  assert.equal(button.hidden, false);
  button.onclick();
  assert.equal(panel.classList.contains('fullscreen-replay-open'), true);
  assert.equal(button['aria-expanded'], 'true');
  assert.equal(t.elements.get('replayImage').hidden, false);
  assert.equal(t.elements.get('replayPlay')['aria-label'], 'Play replay');
  t.elements.get('fullscreenReplayClose').onclick();
  assert.equal(panel.classList.contains('fullscreen-replay-open'), false);
  assert.equal(button.disabled, false);
  button.onclick();
  t.events.fullscreenchange();
  assert.equal(panel.classList.contains('fullscreen-replay-open'), false);
  assert.equal(button['aria-expanded'], 'false');
  assert.equal(t.elements.get('replayImage').hidden, true);
  assert.equal(t.elements.get('replayTimeline').hidden, true);
  assert.equal(t.elements.get('replayTime').hidden, true);
  assert.equal(t.elements.get('replayPlay')['aria-label'], 'View replay');
  assert.equal(panel.hidden, false);
  assert.equal(t.requests.some(request => request.delete), false);
});

test('different browser storage sends the same server printer identity', () => {
  const local = view(new Map());
  const remote = view(new Map());
  local.update(true, 'http://192.168.1.2:3031/video', 'part', 'cc1', '192.168.1.2');
  remote.update(true, 'http://192.168.1.2:3031/video', 'part', 'cc1', '192.168.1.2');
  assert.notEqual(local.requests[0].id, remote.requests[0].id);
  assert.equal(local.requests[0].printer, 'cc1:192.168.1.2');
  assert.equal(remote.requests[0].printer, local.requests[0].printer);
});

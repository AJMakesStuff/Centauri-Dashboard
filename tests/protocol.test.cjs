const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');

function setup(settings = {}, secureContext = true, fetch, search = '', sharedStore) {
  const elements = new Map(), clients = [], sockets = [], timers = new Map(), stored = sharedStore || new Map();
  let timerId = 0, time = 100000;
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', style: {}, children: [], parentElement: {}, classList: { toggle() { }, add() { }, remove() { } },
      append(child) { this.children.push(child); child.remove = () => this.children.splice(this.children.indexOf(child), 1); },
      querySelectorAll() { return [...this.children]; },
      setAttribute() { }, removeAttribute() { }, after() { }, showModal() { this.open = true; }, close() { this.open = false; },
      addEventListener(type, fn) { (this.events ||= {})[type] = fn; }
    });
    return elements.get(id);
  };
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(value) { this.sent.push(value); }
    close() { this.readyState = 3; }
  }
  const context = vm.createContext({
    console, fetch, location: { search }, URLSearchParams,
    matchMedia: () => ({ matches: false, addEventListener() { } }),
    crypto: secureContext ? require('node:crypto').webcrypto : {
      getRandomValues: array => require('node:crypto').webcrypto.getRandomValues(array)
    }, WebSocket: Socket,
    Date: class extends Date { static now() { return time; } },
    setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout(id) { timers.delete(id); }, setInterval() { return ++timerId; }, clearInterval() { },
    localStorage: { getItem: key => key === 'dashboard' && !stored.has(key) ? JSON.stringify(settings) : stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
    document: { body: element('body'), createElement: () => ({}), getElementById: element, querySelector: element, addEventListener() { } }, addEventListener() { },
    mqtt: {
      connect(url, options) {
        const client = new EventEmitter();
        Object.assign(client, {
          url, options, connected: true, sent: [],
          subscribe(topics, opts, callback) { this.topics = topics; callback(null, topics.map(topic => ({ topic, qos: 0 }))); },
          publish(topic, payload, opts, callback) { this.sent.push({ topic, data: JSON.parse(payload), opts }); callback?.(); },
          end() { this.connected = false; }
        });
        clients.push(client); return client;
      }
    }
  });
  vm.runInContext(fs.readFileSync('cc2.js', 'utf8') + '\n' + fs.readFileSync('dashboard.js', 'utf8'), context);
  const run = code => vm.runInContext(code, context);
  const tick = () => { time += 2200; run('socket.flush()'); };
  const receive = (data, topic) => clients.at(-1).emit('message', topic || clients.at(-1).topics[1], Buffer.from(JSON.stringify(data)));
  const register = () => {
    const client = clients.at(-1); client.emit('connect');
    receive({ error: 'ok' }, client.topics[0]);
  };
  return { element, clients, sockets, run, tick, receive, register, timers, stored: () => JSON.parse(stored.get('dashboard') || '{}') };
}
const cc2 = { printerModel: 'cc2', printerIp: '192.168.1.50', serialNumber: 'SN123', accessCode: 'test-code' };
test('mobile fullscreen locks landscape and releases orientation on exit', async () => {
  const t = setup(cc2);
  t.run(`globalThis.orientationCalls = [];
    globalThis.screen = { orientation: {
      lock: async value => orientationCalls.push(value),
      unlock: () => orientationCalls.push('unlock')
    } };
    mobileFullscreenQuery.matches = true;
    document.fullscreenElement = document.querySelector('.shell');`);
  await t.run('updateFullscreenOrientation(true)');
  assert.equal(t.run('orientationCalls.join(",")'), 'landscape');
  await t.run('document.fullscreenElement = null; updateFullscreenOrientation(false)');
  assert.equal(t.run('orientationCalls.join(",")'), 'landscape,unlock');
});

test('orientation locking skips desktop and tolerates unsupported mobile browsers', async () => {
  const t = setup(cc2);
  t.run(`globalThis.screen = { orientation: { lock: async () => { throw new Error('Denied'); } } };`);
  await t.run('updateFullscreenOrientation(true)');
  assert.equal(t.run('fullscreenOrientationRequested'), false);
  await t.run('mobileFullscreenQuery.matches = true; updateFullscreenOrientation(true)');
  await t.run('updateFullscreenOrientation(false)');
  await t.run('delete globalThis.screen; updateFullscreenOrientation(true)');
});

test('mobile fullscreen panels collapse independently and restore interaction outside fullscreen', () => {
  const t = setup(cc2);
  t.run('mobileFullscreenQuery.matches = true');
  assert.equal(t.element('statsPanelToggle').hidden, true);
  t.run("document.fullscreenElement = document.querySelector('.shell'); updateFullscreenPanels()");
  assert.equal(t.element('statsPanelToggle').hidden, false);
  t.element('statsPanelToggle').onclick();
  assert.equal(t.element('statsPanelContent').inert, true);
  assert.equal(t.element('controlsPanelContent').inert, false);
  assert.equal(t.element('statsPanelToggle').title, 'Show stats panel');
  t.element('controlsPanelToggle').onclick();
  assert.equal(t.element('controlsPanelContent').inert, true);
  t.element('statsPanelToggle').onclick();
  assert.equal(t.element('statsPanelContent').inert, false);
  t.run('document.fullscreenElement = null; updateFullscreenPanels()');
  assert.equal(t.element('controlsPanelContent').inert, false);
  assert.equal(t.element('controlsPanelToggle').hidden, true);
});

test('removed visibility preferences do not hide panels or mobile collapse controls', () => {
  const t = setup({ ...cc2 });
  t.run("mobileFullscreenQuery.matches = true; document.fullscreenElement = document.querySelector('.shell'); updateFullscreenPanels()");
  assert.equal(t.element('statsPanelToggle').hidden, false);
  assert.equal(t.element('controlsPanelToggle').hidden, false);
  for (const id of ['overlay', 'printControlPanel', 'temperaturesPanel', 'lightToggle']) assert.notEqual(t.element(id).hidden, true);
});

test('saving a second printer preserves the first and enables persistent quick switching', () => {
  const t = setup({ printerIp: '192.168.1.2', serialNumber: 'board', cameraUrl: 'http://cc1/camera' });
  assert.equal(t.element('printerSwitch').hidden, true);
  t.element('settingsButton').onclick();
  t.element('printerModel').value = 'cc2';
  t.element('printerModel').onchange();
  assert.equal(t.element('printerIp').value, '');
  assert.equal(t.element('cameraUrl').value, '');
  for (const key of ['printerIp', 'serialNumber', 'accessCode']) t.element(key).value = cc2[key];
  t.element('settingsForm').onsubmit({ preventDefault() { } });
  assert.equal(t.element('printerSwitch').hidden, false);
  assert.equal(t.sockets[0].readyState, 3);
  t.register();
  assert.match(t.element('camera').src, /192.168.1.50:8080/);
  t.receive({ method: 6000, result: status });
  t.element('switchCC1').onclick();
  assert.equal(t.clients[0].connected, false);
  assert.equal(t.element('pausePrint').disabled, true);
  assert.equal(t.element('nozzle').textContent, '—');
  const socket = t.sockets.at(-1);
  socket.readyState = 1; socket.onopen();
  assert.equal(t.element('camera').src, 'http://cc1/camera');
  assert.equal(JSON.parse(socket.sent[0]).Data.serialNumber, 'board');
  const restored = setup(t.stored());
  assert.equal(restored.element('printerSwitch').hidden, false);
  restored.element('switchCC2').onclick();
  assert.equal(restored.clients[0].options.password, 'test-code');
  assert.equal(restored.stored().printerModel, 'cc2');
});

test('incomplete second profile hides switch and cancelling settings preserves saved profiles', () => {
  const t = setup({ ...cc2, profiles: { cc1: { serialNumber: 'board' } } });
  assert.equal(t.element('printerSwitch').hidden, true);
  t.element('settingsButton').onclick();
  t.element('accessCode').value = 'unsaved';
  t.element('printerModel').value = 'cc1'; t.element('printerModel').onchange();
  t.element('printerModel').value = 'cc2'; t.element('printerModel').onchange();
  assert.equal(t.element('accessCode').value, 'unsaved');
  t.element('closeButton').onclick();
  t.element('settingsButton').onclick();
  assert.equal(t.element('accessCode').value, 'test-code');
});
test('quick switching supports CC1 discovery and retains the discovered ID', () => {
  const t = setup({ ...cc2, profiles: { cc1: { printerIp: '192.168.1.9' } } });
  assert.equal(t.element('printerSwitch').hidden, false);
  t.element('switchCC1').onclick();
  const socket = t.sockets.at(-1);
  socket.readyState = 1; socket.onopen();
  socket.onmessage({ data: JSON.stringify({ Topic: 'sdcp/status/000000000001d354' }) });
  assert.equal(t.stored().profiles.cc1.serialNumber, '000000000001d354');
  t.element('switchCC2').onclick();
  assert.equal(t.clients.at(-1).options.password, 'test-code');
  t.element('switchCC1').onclick();
  const next = t.sockets.at(-1);
  next.readyState = 1; next.onopen();
  assert.equal(JSON.parse(next.sent[0]).Data.serialNumber, '000000000001d354');
});

test('migration preserves recent top-level edits and the other printer profile', () => {
  const t = setup({
    ...cc2, profiles: {
      cc2: { ...cc2, accessCode: 'outdated' },
      cc1: { printerIp: '192.168.1.2', serialNumber: 'board' }
    }
  });
  assert.equal(t.clients[0].options.password, 'test-code');
  t.element('switchCC1').onclick();
  assert.equal(t.stored().profiles.cc2.accessCode, 'test-code');
  assert.equal(t.stored().serialNumber, 'board');
});

test('CC1 over LAN HTTP starts camera and sends requests without randomUUID', () => {
  const t = setup({ printerIp: '192.168.1.2', serialNumber: 'board' }, false);
  const socket = t.sockets[0];
  socket.readyState = 1;
  socket.onopen();
  const requests = socket.sent.map(value => JSON.parse(value));
  assert.deepEqual(requests.map(request => request.Data.Cmd), [0, 1, 386]);
  for (const request of requests) {
    assert.match(request.Id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(request.Id, request.Data.RequestID);
  }
  assert.equal(new Set(requests.map(request => request.Id)).size, 3);
  assert.equal(t.element('camera').src, 'http://192.168.1.2:3031/video');
  assert.equal(t.element('camera').hidden, false);
});
const status = {
  machine_status: { status: 2, sub_status: 2075, progress: 42 },
  print_status: { filename: 'cube.gcode', current_layer: 20, total_layer: 80, print_duration: 50, total_duration: 100, remaining_time_sec: 120 },
  extruder: { temperature: 210, target: 220 }, heater_bed: { temperature: 60, target: 60 }, led: { status: 1 }
};

test('CC2 authenticates and registers before enabling controls; full status and deltas render', () => {
  const t = setup(cc2), client = t.clients[0];
  assert.equal(client.url, 'ws://192.168.1.50:9001/mqtt');
  assert.equal(client.options.username, 'elegoo'); assert.equal(client.options.password, 'test-code');
  assert.equal(t.run('controlsConnected'), false);
  t.register();
  assert.match(client.sent[0].topic, /api_register$/);
  const request = client.sent.find(item => item.data.method === 1002);
  t.receive({ id: request.data.id, result: { error_code: 0, ...status } });
  assert.equal(t.element('progress').textContent, '42%');
  assert.match(t.element('remaining').textContent, /2m left/);
  assert.equal(t.element('pausePrint').disabled, false);
  t.receive({ method: 6000, result: { extruder: { temperature: 211 } } });
  assert.equal(t.element('nozzle').textContent, '211°');
  assert.equal(t.element('nozzleTarget').textContent, '220°');
  assert.equal(t.element('filename').textContent, 'cube.gcode');
  assert.equal(t.element('chamber').textContent, '—');
  assert.match(t.element('camera').src, /:8080/);
});

test('CC2 command mapping, response correlation, paused/terminal states and no command replay', () => {
  const t = setup(cc2); t.register();
  t.receive({ method: 6000, result: status });
  t.element('pausePrint').onclick(); t.tick();
  const pause = t.clients[0].sent.find(item => item.data.method === 1021);
  assert.ok(pause); assert.equal(pause.opts.retain, false);
  t.receive({ id: pause.data.id, method: 6000, result: { error_code: 0 } });
  assert.equal(t.run('Boolean(pendingControl)'), true);
  t.receive({ id: pause.data.id, result: { error_code: 1010 } });
  assert.match(t.element('printControlStatus').textContent, /rejected/);
  t.receive({ method: 6000, result: { machine_status: { sub_status: 2505 } } });
  assert.equal(t.element('resumePrint').disabled, false);
  assert.equal(t.element('pausePrint').disabled, true);
  t.element('resumePrint').onclick(); t.tick();
  const resume = t.clients[0].sent.find(item => item.data.method === 1023);
  t.receive({ id: resume.data.id, result: { error_code: 0 } });
  assert.match(t.element('printControlStatus').textContent, /accepted/);
  t.element('stopPrint').onclick(); t.tick();
  assert.ok(t.clients[0].sent.some(item => item.data.method === 1022));
  t.element('lightToggle').onclick(); t.tick();
  assert.equal(t.clients[0].sent.find(item => item.data.method === 1029).data.params.power, 0);
  t.receive({ method: 6000, result: { machine_status: { sub_status: 2077 } } });
  assert.equal(t.element('stopPrint').disabled, true);
  t.run('socket.send("ping")');
  assert.ok(t.clients[0].sent.some(item => item.data.type === 'PING'));
  t.run('stopConnection(); connect()'); t.register();
  assert.equal(t.clients[1].sent.some(item => [1021, 1022, 1023].includes(item.data.method)), false);
  assert.equal(t.element('resumePrint').disabled, true);
});

test('CC2 failure messages survive disconnect; stale callbacks cannot restore connection', () => {
  const t = setup(cc2); t.clients[0].emit('error', { code: 5 });
  assert.match(t.element('connection').innerHTML, /authentication failed/);
  assert.equal(t.run('controlsConnected'), false);
  t.clients[0].emit('connect');
  assert.equal(t.clients[0].sent.length, 0);
});

test('saved CC1 settings use original SDCP transport and commands', () => {
  const t = setup({ printerIp: '192.168.1.2', serialNumber: 'board' });
  assert.equal(t.clients.length, 0);
  const socket = t.sockets[0]; assert.match(socket.url, /:3030\/websocket$/);
  socket.readyState = 1; socket.onopen();
  socket.onmessage({ data: JSON.stringify({ Status: { CurrentStatus: 1, PrintInfo: { Filename: 'cc1.gcode', Status: 6, CurrentTicks: 10, TotalTicks: 100 } } }) });
  assert.equal(t.element('resumePrint').disabled, false);
  t.element('resumePrint').onclick();
  assert.equal(JSON.parse(socket.sent.at(-1)).Data.Cmd, 131);
  assert.match(t.element('camera').src, /:3031\/video$/);
});

test('missing CC2 credentials open populated settings without connecting; camera override persists', () => {
  const t = setup({ ...cc2, accessCode: '' });
  assert.equal(t.clients.length, 0); assert.equal(t.element('settingsDialog').open, true);
  assert.equal(t.element('printerModel').value, 'cc2'); assert.equal(t.element('accessCode').required, true);
  const u = setup({ ...cc2, cameraUrl: 'http://camera.local/custom' }); u.register(); u.tick(); u.tick();
  const video = u.clients[0].sent.find(item => item.data.method === 1042);
  u.receive({ id: video.data.id, result: { error_code: 0, url: 'http://printer/video' } });
  assert.equal(u.element('camera').src, 'http://camera.local/custom');
});

test('CC1 with no Serial Number adopts the MainboardID from the printer push, then starts its session', () => {
  const t = setup({ printerIp: '192.168.1.2' }), socket = t.sockets[0];
  assert.equal(t.sockets.length, 1);
  assert.match(socket.url, /:3030\/websocket$/);
  socket.readyState = 1; socket.onopen();
  assert.equal(socket.sent.length, 0);
  assert.match(t.element('connection').innerHTML, /identify itself/);
  socket.onmessage({ data: JSON.stringify({ Data: { MainboardID: '000000000001d354' }, Topic: 'sdcp/attributes/000000000001d354' }) });
  assert.deepEqual(socket.sent.map(value => JSON.parse(value).Data.Cmd), [0, 1, 386]);
  assert.equal(JSON.parse(socket.sent[0]).Topic, 'sdcp/request/000000000001d354');
  assert.equal(JSON.parse(socket.sent[0]).Data.serialNumber, '000000000001d354');
  assert.equal(t.stored().serialNumber, '000000000001d354');
  assert.equal(t.element('camera').src, 'http://192.168.1.2:3031/video');
  assert.equal(t.element('connection').parentElement.hidden, true);
});

test('CC1 discovery reads the ID from the frame topic and still renders that frame', () => {
  const t = setup({ printerIp: '192.168.1.2' }), socket = t.sockets[0];
  socket.readyState = 1; socket.onopen();
  socket.onmessage({ data: JSON.stringify({ Status: { CurrentStatus: [1], PrintInfo: { Status: 1, Filename: 'part.gcode', CurrentTicks: 5, TotalTicks: 10 } }, Topic: 'sdcp/status/000000000001d354' }) });
  assert.equal(JSON.parse(socket.sent[0]).Data.serialNumber, '000000000001d354');
  assert.equal(t.element('filename').textContent, 'part.gcode');
  assert.equal(t.element('machineStatus').textContent, 'Printing');
});

test('CC1 discovery gives up into settings with a notice when the printer stays silent', () => {
  const t = setup({ printerIp: '192.168.1.9' }), socket = t.sockets[0];
  socket.readyState = 1; socket.onopen();
  assert.equal(socket.sent.length, 0);
  assert.equal(t.element('serialSpinner').hidden, false);
  const discovery = [...t.timers.values()].find(timer => timer.ms === 8000);
  assert.ok(discovery, 'a discovery timeout is scheduled');
  discovery.fn();
  assert.equal(t.element('serialSpinner').hidden, true);
  assert.equal(t.element('settingsDialog').open, true);
  assert.match(t.element('settingsNotice').textContent, /No printer ID arrived/);
  assert.equal(t.element('serialNumber').required, false);
  assert.equal(t.element('serialHint').hidden, false);
});

test('CC2 still requires its serial number, and never tries CC1 discovery', () => {
  const t = setup({ printerModel: 'cc2', printerIp: '192.168.1.50', accessCode: 'test-code' });
  assert.equal(t.clients.length, 0); assert.equal(t.sockets.length, 0);
  assert.equal(t.element('settingsDialog').open, true);
  assert.equal(t.element('serialNumber').required, true);
  assert.equal(t.element('serialHint').hidden, true);
});

test('settings form patterns are valid under the v flag Chrome uses, and match their input', () => {
  const html = fs.readFileSync('dashboard.html', 'utf8');
  const fields = (html.match(/<(?:input|select|textarea)[^>]*>/g) || [])
    .map(tag => ({ id: (tag.match(/id="([^"]+)"/) || [])[1], pattern: (tag.match(/pattern="([^"]*)"/) || [])[1] }))
    .filter(field => field.id && field.pattern);
  assert.deepEqual(fields.map(field => field.id), ['printerIp', 'serialNumber']);
  for (const { id, pattern } of fields) {
    // Chrome compiles the pattern with the v flag and drops the constraint when it throws.
    const regex = new RegExp(`^(?:${pattern})$`, 'v');
    if (id === 'printerIp') {
      assert.ok(regex.test('192.168.20.129'));
      assert.ok(regex.test('printer.local'));
      assert.equal(regex.test('192.168.20.129/evil'), false);
    }
    if (id === 'serialNumber') {
      assert.ok(regex.test('000000000001d354'));
      assert.equal(regex.test('bad/serial'), false);
    }
  }
});

test('a blocked settings save explains itself instead of silently doing nothing', () => {
  const t = setup({}), form = t.element('settingsForm');
  assert.equal(typeof form.events.invalid, 'function');
  form.events.invalid({ target: { id: 'serialNumber' } });
  assert.equal(t.element('settingsNotice').hidden, false);
  assert.match(t.element('settingsNotice').textContent, /serial number/i);
  form.events.invalid({ target: { id: 'printerIp' } });
  assert.match(t.element('settingsNotice').textContent, /printer IP address/i);
});

test('an empty Serial Number keeps the dialog open with a spinner until the printer identifies itself', () => {
  const t = setup({});
  assert.equal(t.element('settingsDialog').open, true);
  assert.equal(Boolean(t.element('serialSpinner').hidden), true);
  t.element('printerIp').value = '192.168.20.129';
  t.element('settingsForm').onsubmit({ preventDefault() { } });
  assert.equal(t.element('settingsDialog').open, true);
  assert.equal(t.element('serialSpinner').hidden, false);
  const socket = t.sockets.at(-1);
  socket.readyState = 1; socket.onopen();
  assert.equal(t.element('serialSpinner').hidden, false);
  assert.match(t.element('connection').innerHTML, /identify itself/);
  socket.onmessage({ data: JSON.stringify({ MainboardID: '000000000001d354', Topic: 'sdcp/status/000000000001d354' }) });
  assert.equal(t.element('serialSpinner').hidden, true);
  assert.equal(t.element('settingsDialog').open, false);
  assert.equal(t.element('serialNumber').value, '000000000001d354');
  assert.equal(t.element('connection').parentElement.hidden, true);
});

test('discovery that cannot reach the printer says so in the open dialog', () => {
  const t = setup({});
  t.element('printerIp').value = '192.168.20.250';
  t.element('settingsForm').onsubmit({ preventDefault() { } });
  const socket = t.sockets.at(-1);
  socket.readyState = 1; socket.onopen();
  socket.onclose();
  assert.equal(t.element('settingsDialog').open, true);
  assert.match(t.element('settingsNotice').textContent, /Could not reach 192\.168\.20\.250/);
});

test('editing the printer address probes for the ID and fills the field without saving', () => {
  const t = setup({});
  t.element('printerIp').value = '192.168.20.129';
  t.element('printerIp').events.input();
  const debounce = [...t.timers.values()].find(timer => timer.ms === 700);
  assert.ok(debounce, 'the probe is debounced');
  assert.equal(t.sockets.length, 0);
  debounce.fn();
  assert.equal(t.sockets.length, 1);
  assert.equal(t.sockets[0].url, 'ws://192.168.20.129:3030/websocket');
  assert.equal(t.element('serialSpinner').hidden, false);
  t.sockets[0].onmessage({ data: JSON.stringify({ MainboardID: '000000000001d354', Topic: 'sdcp/status/000000000001d354' }) });
  assert.equal(t.element('serialNumber').value, '000000000001d354');
  assert.equal(t.element('serialSpinner').hidden, true);
});

test('a half-typed printer address is not probed', () => {
  const t = setup({});
  t.element('printerIp').value = '192.168.';
  t.element('printerIp').events.input();
  [...t.timers.values()].find(timer => timer.ms === 700).fn();
  assert.equal(t.sockets.length, 0);
  assert.equal(Boolean(t.element('serialSpinner').hidden), true);
});

const settleDiscovery = () => new Promise(resolve => setImmediate(resolve));
test('Docker discovery starts a session without waiting for a printer push', async () => {
  const requests = [];
  const t = setup({ printerIp: '192.168.1.2' }, false, async url => {
    requests.push(url);
    return { ok: true, json: async () => ({ serialNumber: '000000000001d354' }) };
  });
  const socket = t.sockets[0]; socket.readyState = 1; socket.onopen();
  await settleDiscovery();
  assert.deepEqual(requests, ['/api/discover?ip=192.168.1.2']);
  assert.equal(t.stored().serialNumber, '000000000001d354');
  assert.deepEqual(socket.sent.map(value => JSON.parse(value).Data.Cmd), [0, 1, 386]);
});

test('Docker form discovery ignores replies after editing the address', async () => {
  let reply;
  const t = setup({}, true, () => new Promise(resolve => { reply = resolve; }));
  t.element('printerIp').value = '192.168.1.2';
  t.run("probeSerial('192.168.1.2')");
  t.element('printerIp').value = '192.168.1.3';
  t.element('printerIp').events.input();
  reply({ ok: true, json: async () => ({ serialNumber: '000000000001d354' }) });
  await settleDiscovery();
  assert.equal(t.element('serialNumber').value, '');
});

test('missing Docker endpoint leaves WebSocket discovery available', async () => {
  const t = setup({ printerIp: '192.168.1.2' }, true, async () => ({ ok: false }));
  const socket = t.sockets[0]; socket.readyState = 1; socket.onopen();
  await settleDiscovery();
  assert.equal(socket.sent.length, 0);
  socket.onmessage({ data: JSON.stringify({ MainboardID: '000000000001d354' }) });
  assert.equal(t.stored().serialNumber, '000000000001d354');
});


test('Both view stops the single session and returning to a printer closes both panels', () => {
  const t = setup({ ...cc2, profiles: { cc1: { printerIp: '192.168.1.2', serialNumber: 'board' } } });
  t.element('switchBoth').onclick();
  assert.equal(t.clients[0].connected, false);
  const frames = t.element('bothPrinters').children;
  assert.deepEqual(frames.map(frame => frame.src), ['dashboard.html?printer=cc1', 'dashboard.html?printer=cc2']);
  assert.equal(t.stored().viewMode, 'both');
  t.element('switchBoth').onclick();
  assert.equal(frames.length, 2);
  let closed = 0;
  for (const frame of frames) frame.contentWindow = { stopConnection() { closed++; } };
  t.element('switchCC2').onclick();
  assert.equal(closed, 2);
  assert.equal(frames.length, 0);
  assert.equal(t.clients.length, 2);
  assert.equal(t.stored().viewMode, 'single');
});

test('Both view restores without opening an extra parent connection', () => {
  const t = setup({ ...cc2, viewMode: 'both', profiles: { cc1: { printerIp: '192.168.1.2', serialNumber: 'board' } } });
  assert.equal(t.clients.length, 0);
  assert.equal(t.sockets.length, 0);
  assert.equal(t.element('bothPrinters').children.length, 2);
});

test('embedded printers use independent profiles and merge settings without losing other edits', () => {
  const store = new Map([['dashboard', JSON.stringify({
    ...cc2, viewMode: 'both', profiles: {
      cc1: { printerIp: '192.168.1.2', serialNumber: 'board' }, cc2
    }
  })]]);
  const first = setup({}, true, undefined, '?printer=cc1', store);
  const second = setup({}, true, undefined, '?printer=cc2', store);
  assert.equal(first.sockets[0].url, 'ws://192.168.1.2:3030/websocket');
  assert.equal(second.clients.length, 1);
  assert.equal(first.element('printerSwitch').hidden, true);
  const socket = first.sockets[0]; socket.readyState = 1; socket.onopen();
  second.register();
  socket.onmessage({ data: JSON.stringify({ Status: { CurrentStatus: 1, PrintInfo: { Filename: 'first.gcode', Status: 1 } } }) });
  const secondRequests = second.clients[0].sent.length;
  first.element('pausePrint').onclick();
  const command = JSON.parse(socket.sent.at(-1));
  assert.equal(command.Data.Cmd, 129);
  assert.equal(command.Data.serialNumber, 'board');
  assert.equal(second.clients[0].sent.length, secondRequests);

  first.run("saved.cameraUrl = 'http://first/camera'; saveActiveProfile()");
  second.run("saved.cameraUrl = 'http://second/camera'; saveActiveProfile()");
  assert.equal(first.stored().profiles.cc1.cameraUrl, 'http://first/camera');
  assert.equal(first.stored().profiles.cc2.cameraUrl, 'http://second/camera');
  assert.equal(first.stored().cameraUrl, 'http://second/camera');
  assert.equal(first.stored().printerModel, 'cc2');
  assert.equal(first.stored().viewMode, 'both');
  first.element('lockTemperaturesDuringPrint').checked = false;
  first.element('lockTemperaturesDuringPrint').onchange();
  assert.equal(first.stored().lockTemperaturesDuringPrint, false);
});


test('discovery accepts a valid topic or nested ID when another ID field is empty', () => {
  const t = setup({ printerIp: '192.168.1.2' });
  const socket = t.sockets[0]; socket.readyState = 1; socket.onopen();
  socket.onmessage({ data: JSON.stringify({ Data: { MainboardID: '' }, Topic: 'sdcp/status/000000000001d354' }) });
  assert.equal(t.stored().serialNumber, '000000000001d354');
  assert.equal(t.run("mainboardIdFrom({Data: {Data: {MainboardID: '000000000001d354'}}})"), '000000000001d354');
});

test('opening settings starts discovery and an active known CC1 ID is reused', () => {
  const t = setup({ printerIp: '192.168.1.2', serialNumber: '000000000001d354' });
  const socket = t.sockets[0]; socket.readyState = 1; socket.onopen();
  t.element('settingsButton').onclick();
  t.element('serialNumber').value = '';
  t.run("probeSerial('192.168.1.2')");
  assert.equal(t.element('serialNumber').value, '000000000001d354');
  assert.equal(t.sockets.length, 1);
  const u = setup({ printerIp: '192.168.1.3' });
  u.element('settingsButton').onclick();
  assert.ok([...u.timers.values()].some(timer => timer.ms === 700));
});

test('file discovery skips the server and explains a silent WebSocket probe', () => {
  let requests = 0;
  const t = setup({}, true, () => { requests++; });
  t.run("location.protocol = 'file:'; probeSerial('192.168.1.2')");
  assert.equal(requests, 0);
  [...t.timers.values()].find(timer => timer.ms === 8000).fn();
  assert.equal(t.element('serialSpinner').hidden, true);
  assert.match(t.element('settingsNotice').textContent, /WebSocket announcements only/);
  assert.match(t.element('settingsNotice').textContent, /Docker/);
});

test('combined fullscreen keeps parent panel toggles hidden', () => {
  const t = setup({ ...cc2, profiles: { cc1: { printerIp: '192.168.1.2', serialNumber: 'board' } } });
  t.run("showBothPrinters(); document.fullscreenElement = document.querySelector('.shell'); updateFullscreenPanels()");
  assert.equal(t.element('statsPanelToggle').hidden, true);
  assert.equal(t.element('controlsPanelToggle').hidden, true);
});

test('device controls validate CC1 targets, correlate ACKs, and clear on disconnect', () => {
  const t = setup({ printerIp: '192.168.1.2', serialNumber: 'board' });
  const socket = t.sockets[0]; socket.readyState = 1; socket.onopen();
  const count = socket.sent.length;
  for (const value of ['', -1, 321, 1.5, 'NaN']) t.run(`setDeviceControl('nozzle', ${JSON.stringify(value)})`);
  assert.equal(socket.sent.length, count);
  t.run("setDeviceControl('nozzle', 210)");
  const request = JSON.parse(socket.sent.at(-1));
  assert.deepEqual(request.Data.Data, { TempTargetNozzle: 210 });
  assert.equal(t.element('bedApply').disabled, true);
  t.run("handleDeviceResponse({Data:{RequestID:'unrelated',Data:{Ack:0}}})");
  assert.equal(t.element('bedApply').disabled, true);
  t.run(`handleDeviceResponse(${JSON.stringify({ Data: { RequestID: request.Data.RequestID, Data: { Ack: 1 } } })})`);
  assert.match(t.element('deviceControlStatus').textContent, /rejected/);
  t.run("setDeviceControl('boxFan', 75)");
  assert.deepEqual(JSON.parse(socket.sent.at(-1)).Data.Data, { TargetFanSpeed: { BoxFan: 75 } });
  t.run('resetPrintControls(false)');
  assert.equal(t.element('boxFanOff').disabled, true);
  assert.equal(t.run('pendingDevice'), undefined);
});

test('CC2 maps heater and fan commands independently and reports device status', () => {
  const t = setup(cc2); t.register();
  t.run("setDeviceControl('auxFan', 50)"); t.tick();
  let request = t.clients[0].sent.at(-1).data;
  assert.equal(request.method, 1030);
  assert.deepEqual(request.params, { aux_fan: 128 });
  t.receive({ id: request.id, result: { error_code: 0 } });
  assert.match(t.element('deviceControlStatus').textContent, /accepted/);
  t.run("setDeviceControl('bed', 60)"); t.tick();
  request = t.clients[0].sent.at(-1).data;
  assert.equal(request.method, 1028);
  assert.deepEqual(request.params, { heater_bed: 60 });
  t.receive({ id: request.id, result: { error_code: 0 } });
  t.element('nozzleOff').onclick(); t.tick();
  assert.deepEqual(t.clients[0].sent.at(-1).data.params, { extruder: 0 });
  t.receive({ method: 6000, result: { extruder: { target: 210 }, fans: { fan: { speed: 75 } } } });
  assert.equal(t.element('modelFanReported').textContent, 'Current 75%');
  assert.equal(t.element('nozzleReported').textContent, 'Target 210°C');
});

test('temperature lock follows print lifecycle, persists, and blocks commands without locking fans', () => {
  const t = setup({ printerIp: '192.168.1.2', serialNumber: 'board' });
  const socket = t.sockets[0]; socket.readyState = 1; socket.onopen();
  assert.equal(t.element('lockTemperaturesDuringPrint').checked, false);
  const status = code => t.run(`updateStatus({Status:{CurrentStatus:1,PrintInfo:{Status:${code}}}})`);
  status(1);
  assert.equal(t.element('nozzleSetting').disabled, false);
  t.element('lockTemperaturesDuringPrint').checked = true;
  t.element('lockTemperaturesDuringPrint').onchange();
  assert.equal(t.run("JSON.parse(localStorage.getItem('dashboard')).lockTemperaturesDuringPrint"), true);
  for (const code of [1, 5, 6, 7, 12]) {
    status(code);
    for (const key of ['nozzle', 'bed']) {
      for (const suffix of ['Setting', 'Apply', 'Off']) assert.equal(t.element(key + suffix).disabled, true);
    }
    assert.equal(t.element('modelFanSetting').disabled, false);
  }
  const count = socket.sent.length;
  t.run("setDeviceControl('nozzle', 210)");
  t.element('bedOff').onclick();
  assert.equal(socket.sent.length, count);
  t.run('updateStatus({Status:{TempOfNozzle:210}})');
  assert.equal(t.element('nozzleSetting').disabled, true);
  for (const code of [0, 8, 9]) {
    status(code);
    assert.equal(t.element('nozzleSetting').disabled, false);
  }
  status(1);
  t.element('lockTemperaturesDuringPrint').checked = false;
  t.element('lockTemperaturesDuringPrint').onchange();
  assert.equal(t.element('bedApply').disabled, false);
  t.run('resetPrintControls(false)');
  assert.equal(t.element('bedApply').disabled, true);
});

test('saved temperature lock applies to CC2 print status', () => {
  const t = setup({ ...cc2, lockTemperaturesDuringPrint: true }); t.register();
  assert.equal(t.element('lockTemperaturesDuringPrint').checked, true);
  t.receive({ method: 6000, result: { ...status } });
  assert.equal(t.element('nozzleSetting').disabled, true);
  assert.equal(t.element('auxFanApply').disabled, false);
});

test('printing temperature inputs follow measured readings and preserve idle or focused edits', () => {
  const t = setup({ printerIp: '192.168.1.2', serialNumber: 'board' });
  const socket = t.sockets[0]; socket.readyState = 1; socket.onopen();
  t.run('updateStatus({Status:{CurrentStatus:1,PrintInfo:{Status:1},TempOfNozzle:209.6,TempOfHotbed:59.8,TempTargetNozzle:220}})');
  assert.equal(t.element('nozzleSetting').value, '210');
  assert.equal(t.element('bedSetting').value, '60');
  t.run('updateStatus({Status:{TempOfHotbed:61}})');
  assert.equal(t.element('bedSetting').value, '61');
  assert.equal(t.element('nozzleSetting').value, '210');
  t.element('nozzleSetting').value = '225';
  t.run("document.activeElement = $('nozzleSetting'); updateStatus({Status:{TempOfNozzle:211}})");
  assert.equal(t.element('nozzleSetting').value, '225');
  t.element('lockTemperaturesDuringPrint').checked = true;
  t.element('lockTemperaturesDuringPrint').onchange();
  t.run('updateStatus({Status:{PrintInfo:{Status:6},TempOfNozzle:212}})');
  assert.equal(t.element('nozzleSetting').value, '212');
  t.run('updateStatus({Status:{PrintInfo:{Status:9},TempOfNozzle:100}})');
  t.element('nozzleSetting').value = '230';
  t.run('updateStatus({Status:{TempOfNozzle:90}})');
  assert.equal(t.element('nozzleSetting').value, '230');
});

test('fan speeds follow print reports and independent fan lock persists and guards commands', () => {
  const t = setup({ printerIp: '192.168.1.2', serialNumber: 'board' });
  const socket = t.sockets[0]; socket.readyState = 1; socket.onopen();
  assert.equal(t.element('lockFansDuringPrint').checked, false);
  t.run('updateStatus({Status:{CurrentStatus:1,PrintInfo:{Status:1},CurrentFanSpeed:{ModelFan:75,AuxiliaryFan:50,BoxFan:0}}})');
  for (const [key, value] of [['modelFan', '75'], ['auxFan', '50'], ['boxFan', '0']]) {
    assert.equal(t.element(key + 'Setting').value, value);
    assert.equal(t.element(key + 'Setting').disabled, false);
  }
  t.element('modelFanSetting').value = '90';
  t.run("document.activeElement = $('modelFanSetting'); updateStatus({Status:{CurrentFanSpeed:{ModelFan:80}}})");
  assert.equal(t.element('modelFanSetting').value, '90');
  t.element('lockFansDuringPrint').checked = true;
  t.element('lockFansDuringPrint').onchange();
  assert.equal(t.run("JSON.parse(localStorage.getItem('dashboard')).lockFansDuringPrint"), true);
  assert.equal(t.element('nozzleSetting').disabled, false);
  for (const key of ['modelFan', 'auxFan', 'boxFan']) {
    for (const suffix of ['Setting', 'Apply', 'Off']) assert.equal(t.element(key + suffix).disabled, true);
  }
  const count = socket.sent.length;
  t.run("setDeviceControl('modelFan', 100)"); t.element('boxFanOff').onclick();
  assert.equal(socket.sent.length, count);
  t.run('updateStatus({Status:{PrintInfo:{Status:6},CurrentFanSpeed:{ModelFan:81}}})');
  assert.equal(t.element('modelFanSetting').value, '81');
  assert.equal(t.element('modelFanSetting').disabled, true);
  t.run('updateStatus({Status:{CurrentFanSpeed:{AuxiliaryFan:25}}})');
  assert.equal(t.element('auxFanSetting').value, '25');
  assert.equal(t.element('boxFanSetting').value, '0');
  t.element('lockFansDuringPrint').checked = false; t.element('lockFansDuringPrint').onchange();
  assert.equal(t.element('modelFanApply').disabled, false);
  t.element('lockFansDuringPrint').checked = true; t.element('lockFansDuringPrint').onchange();
  t.run('updateStatus({Status:{PrintInfo:{Status:9},CurrentFanSpeed:{AuxiliaryFan:0}}})');
  assert.equal(t.element('auxFanSetting').disabled, false);
  assert.equal(t.element('auxFanSetting').value, '25');
  t.run('resetPrintControls(false)');
  assert.equal(t.element('auxFanSetting').disabled, true);
});

test('saved fan lock applies to CC2 and fan reports update locked inputs', () => {
  const t = setup({ ...cc2, lockFansDuringPrint: true }); t.register();
  assert.equal(t.element('lockFansDuringPrint').checked, true);
  t.receive({ method: 6000, result: { ...status, fans: { fan: { speed: 75 } } } });
  assert.equal(t.element('modelFanSetting').disabled, true);
  assert.equal(t.element('modelFanSetting').value, '75');
  assert.equal(t.element('nozzleSetting').disabled, false);
});

test('fullscreen gauges follow measured temperatures, retain partial readings, and reset offline', () => {
  const t = setup({ printerIp: '192.168.1.2', serialNumber: 'board' });
  t.run('updateStatus({Status:{TempOfNozzle:210,TempOfHotbed:60}})');
  assert.equal(t.element('nozzleGaugeValue').textContent, '210°');
  assert.equal(t.element('bedGaugeValue').textContent, '60°');
  t.run('updateStatus({Status:{TempOfNozzle:211}})');
  assert.equal(t.element('nozzleGaugeValue').textContent, '211°');
  assert.equal(t.element('bedGaugeValue').textContent, '60°');
  t.run('resetPrintControls(false)');
  assert.equal(t.element('nozzleGaugeValue').textContent, '—');
  assert.equal(t.element('bedGaugeValue').textContent, '—');
});

test('mobile fullscreen keeps original panels and restores them when resizing from desktop', () => {
  const t = setup({});
  t.element('devicePanel').open = false;
  t.run('mobileFullscreenQuery.matches = true; layoutFullscreenDock(true)');
  assert.equal(t.element('fullscreenDock').hidden, true);
  assert.equal(t.run('fullscreenDockActive'), false);
  assert.equal(t.element('devicePanel').open, false);
  t.run('mobileFullscreenQuery.matches = false; layoutFullscreenDock(true)');
  assert.equal(t.element('fullscreenDock').hidden, false);
  assert.equal(t.element('devicePanel').open, true);
  t.run('layoutFullscreenDock(true); mobileFullscreenQuery.matches = true; layoutFullscreenDock(true)');
  assert.equal(t.element('fullscreenDock').hidden, true);
  assert.equal(t.element('devicePanel').open, false);
  assert.equal(t.run('fullscreenDockActive'), false);
});

test('desktop fullscreen hides collapse arrows and expands previously collapsed mobile panels', () => {
  const t = setup(cc2);
  t.run("mobileFullscreenQuery.matches = true; document.fullscreenElement = document.querySelector('.shell'); updateFullscreenPanels()");
  t.element('statsPanelToggle').onclick();
  t.element('controlsPanelToggle').onclick();
  t.run('mobileFullscreenQuery.matches = false; updateFullscreenPanels()');
  for (const name of ['stats', 'controls']) {
    assert.equal(t.element(name + 'PanelToggle').hidden, true);
    assert.equal(t.element(name + 'PanelContent').inert, false);
  }
  t.run('mobileFullscreenQuery.matches = true; updateFullscreenPanels()');
  assert.equal(t.element('statsPanelToggle').hidden, false);
  assert.equal(t.element('statsPanelContent').inert, true);
});

test('fullscreen layout button switches immediately, persists, and restores original controls', () => {
  const html = fs.readFileSync('dashboard.html', 'utf8');
  const dashboardScript = fs.readFileSync('dashboard.js', 'utf8');
  assert.doesNotMatch(html, /id="redesignedFullscreen"/);
  assert.match(html, /id="fullscreenLayoutButton"/);
  assert.match(dashboardScript, /\$\('printerSwitch'\)\.before\(\$\('lightToggle'\)\)/);
  const t = setup(cc2);
  assert.equal(t.element('fullscreenLayoutButton').title, 'Use original fullscreen layout');
  t.run("document.fullscreenElement = document.querySelector('.shell'); layoutFullscreenDock(true); updateFullscreenPanels()");
  assert.equal(t.run('fullscreenDockActive'), true);
  t.element('fullscreenLayoutButton').onclick();
  assert.equal(t.run('fullscreenDockActive'), false);
  assert.equal(t.element('fullscreenDock').hidden, true);
  assert.equal(t.element('statsPanelToggle').hidden, false);
  assert.equal(t.stored().redesignedFullscreen, false);
  assert.equal(t.element('fullscreenLayoutButton').title, 'Use redesigned fullscreen layout');
  const restored = setup({ ...cc2, redesignedFullscreen: false });
  assert.equal(restored.element('fullscreenLayoutButton').title, 'Use redesigned fullscreen layout');
  restored.run('layoutFullscreenDock(true)');
  assert.equal(restored.run('fullscreenDockActive'), false);
  t.element('fullscreenLayoutButton').onclick();
  assert.equal(t.run('fullscreenDockActive'), true);
  assert.equal(t.element('statsPanelToggle').hidden, true);
  t.run('mobileFullscreenQuery.matches = true');
  t.element('fullscreenLayoutButton').onclick();
  assert.equal(t.run('fullscreenDockActive'), false);
  assert.equal(t.element('statsPanelToggle').hidden, false);
});

test('replay follows confirmed print lifecycle and ignores connection resets', () => {
  const t = setup();
  t.run('globalThis.window = { printReplay: { update(...args) { (globalThis.replayCalls ||= []).push(args); } } }');
  for (const code of [1, 6, 12, 7, 8, 9, 0]) {
    t.run(`updateStatus({Status: {CurrentStatus: 1, PrintInfo: {Status: ${code}, Filename: 'test.gcode'}}})`);
    assert.equal(t.run('replayCalls.at(-1)[0]'), ![0, 8, 9].includes(code));
  }
  assert.equal(t.run('replayCalls.at(-1)[2]'), 'test.gcode');
  t.run('updateStatus({Status: {CurrentStatus: 0}})');
  assert.equal(t.run('replayCalls.length'), 7);
  t.run('stopConnection()');
  assert.equal(t.run('replayCalls.at(-1)[0]'), false);
});

test('disconnect detaches the view without ending or deleting the replay', () => {
  const t = setup();
  t.run('globalThis.window = { printReplay: { update() { globalThis.deletedReplay = true; }, detach() { globalThis.detachedReplay = true; } } }; globalThis.deletedReplay = false; globalThis.detachedReplay = false; stopConnection(true)');
  assert.equal(t.run('deletedReplay'), false);
  t.run('stopConnection()');
  assert.equal(t.run('deletedReplay'), false);
  assert.equal(t.run('detachedReplay'), true);
});

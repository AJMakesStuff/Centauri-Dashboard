const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');

function setup(settings = {}, secureContext = true) {
  const elements = new Map(), clients = [], sockets = [], timers = new Map();
  let timerId = 0, time = 100000;
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', style: {}, classList: { toggle() { } },
      appendChild(child) { child.parentElement = this; },
      setAttribute() { }, removeAttribute() { }, after() { }, showModal() { this.open = true; }, close() { this.open = false; }
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
    console, crypto: secureContext ? require('node:crypto').webcrypto : {
      getRandomValues: array => require('node:crypto').webcrypto.getRandomValues(array)
    }, WebSocket: Socket,
    Date: class extends Date { static now() { return time; } },
    setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout(id) { timers.delete(id); }, setInterval() { return ++timerId; }, clearInterval() { },
    localStorage: { getItem: () => JSON.stringify(settings), setItem(key, value) { settings = JSON.parse(value); } },
    document: { getElementById: element, querySelector: element, addEventListener() { } }, addEventListener() { },
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
  return { element, clients, sockets, run, tick, receive, register, timers, stored: () => settings };
}
const cc2 = { printerModel: 'cc2', printerIp: '192.168.1.50', serialNumber: 'SN123', accessCode: 'test-code' };
test('fullscreen panels collapse independently and restore interaction outside fullscreen', () => {
  const t = setup(cc2);
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

test('fullscreen arrows respect panels disabled in Settings', () => {
  const t = setup({ ...cc2, showStatsPanel: false, showPrintControls: false });
  t.run("document.fullscreenElement = document.querySelector('.shell'); updateFullscreenPanels()");
  assert.equal(t.element('statsPanelToggle').hidden, true);
  assert.equal(t.element('controlsPanelToggle').hidden, true);
  assert.equal(t.element('overlay').hidden, true);
  assert.equal(t.element('printControlPanel').hidden, true);
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
  const t = setup({ ...cc2, profiles: { cc1: { printerIp: '192.168.1.2' } } });
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

const $ = id => document.getElementById(id);
const saved = JSON.parse(localStorage.getItem('dashboard') || '{}');
const connectionFields = ['printerIp', 'serialNumber', 'cameraUrl', 'accessCode'];
saved.printerModel = saved.printerModel === 'cc2' ? 'cc2' : 'cc1';
saved.profiles ||= {};
// Recent versions saved edits only at the top level; preserve those edits on migration.
saved.profiles[saved.printerModel] = Object.fromEntries(connectionFields.map(key =>
  [key, saved[key] ?? saved.profiles[saved.printerModel]?.[key] ?? '']));
const embeddedModel = typeof location !== 'undefined'
  ? new URLSearchParams(location.search).get('printer') : null;
const embedded = ['cc1', 'cc2'].includes(embeddedModel);
if (embedded) saved.printerModel = embeddedModel;
Object.assign(saved, Object.fromEntries(connectionFields.map(key =>
  [key, saved.profiles[saved.printerModel]?.[key] || ''])));
let bothView = false;
function persistSettings(setting) {
  // Each view owns one profile. Merge writes so another live view's edits survive.
  const latest = JSON.parse(localStorage.getItem('dashboard') || '{}');
  saved.profiles = {
    ...saved.profiles, ...latest.profiles,
    [saved.printerModel]: saved.profiles[saved.printerModel]
  };
  const next = embedded ? { ...latest, profiles: saved.profiles } : saved;
  if (embedded && latest.printerModel === saved.printerModel) {
    for (const key of connectionFields) next[key] = saved[key];
  }
  if (setting) next[setting] = saved[setting];
  localStorage.setItem('dashboard', JSON.stringify(next));
}
function closeBothView(preserveReplay = false) {
  if (!bothView) return;
  for (const frame of $('bothPrinters').querySelectorAll('iframe')) {
    try { frame.contentWindow?.stopConnection(preserveReplay); } catch { /* File origins may be isolated. */ }
    frame.remove();
  }
  Object.assign(saved, JSON.parse(localStorage.getItem('dashboard') || '{}'));
  bothView = false;
  $('bothPrinters').hidden = true;
  document.querySelector('.shell').classList.remove('both-view');
  saved.viewMode = 'single';
}
function showBothPrinters() {
  if (embedded || bothView || !profileReady('cc1') || !profileReady('cc2')) return;
  stopConnection();
  $('camera').removeAttribute('src');
  bothView = true;
  saved.viewMode = 'both';
  persistSettings();
  document.querySelector('.shell').classList.add('both-view');
  $('bothPrinters').hidden = false;
  for (const model of ['cc1', 'cc2']) {
    const frame = document.createElement('iframe');
    frame.title = `${model.toUpperCase()} live printer dashboard`;
    frame.allow = 'fullscreen';
    frame.src = `dashboard.html?printer=${model}`;
    $('bothPrinters').append(frame);
  }
  updatePrinterSwitch();
}
let settingsDrafts, editingModel;
function saveActiveProfile() {
  saved.profiles[saved.printerModel] = Object.fromEntries(connectionFields.map(key => [key, saved[key] || '']));
  persistSettings();
}
function profileReady(model) {
  const profile = saved.profiles[model];
  return Boolean(profile?.printerIp && (model !== 'cc2' || (profile.serialNumber && profile.accessCode)));
}
function updatePrinterSwitch() {
  $('printerSwitch').hidden = embedded || (!bothView && !(profileReady('cc1') && profileReady('cc2')));
  $('switchCC1').disabled = !profileReady('cc1');
  $('switchCC2').disabled = !profileReady('cc2');
  $('switchBoth').disabled = !profileReady('cc1') || !profileReady('cc2');
  $('switchCC1').setAttribute('aria-pressed', String(!bothView && saved.printerModel === 'cc1'));
  $('switchBoth').setAttribute('aria-pressed', String(bothView));
  $('switchCC2').setAttribute('aria-pressed', String(!bothView && saved.printerModel === 'cc2'));
}
function selectPrinter(model) {
  if (embedded || !profileReady(model) || (!bothView && saved.printerModel === model)) return;
  closeBothView();
  cancelSerialProbe(true);
  stopConnection();
  settingsPendingClose = false;
  saveActiveProfile();
  saved.printerModel = model;
  for (const key of connectionFields) saved[key] = saved.profiles[model][key] || '';
  saveActiveProfile();
  retryDelay = 1500;
  updatePrinterSwitch();
  connect();
}
let socket, reconnectTimer, discoveryTimer, heartbeatTimer, connectionVersion = 0, retryDelay = 1500, currentLightOn = false;
const states = { 0: 'Idle', 1: 'Printing', 2: 'Transferring', 3: 'Calibrating', 4: 'Testing' };
let controlsConnected = false, printStatus = null, activePrint = false, pendingControl;
const deviceControls = {
  nozzle: { label: 'Nozzle', max: 320, field: 'TempTargetNozzle' },
  bed: { label: 'Bed', max: 110, field: 'TempTargetHotbed' },
  modelFan: { label: 'Part fan', max: 100, fan: 'ModelFan' },
  auxFan: { label: 'Auxiliary fan', max: 100, fan: 'AuxiliaryFan' },
  boxFan: { label: 'Chamber fan', max: 100, fan: 'BoxFan' }
};
let pendingDevice, devicePrintActive = false;
function deviceControlLocked(control) {
  return Boolean(devicePrintActive && (control.fan ? saved.lockFansDuringPrint : saved.lockTemperaturesDuringPrint));
}
function updateDeviceControls() {
  const ready = controlsConnected && socket?.readyState === WebSocket.OPEN && !pendingDevice;
  for (const key of Object.keys(deviceControls)) {
    const locked = deviceControlLocked(deviceControls[key]);
    for (const suffix of ['Setting', 'Apply', 'Off']) {
      $(key + suffix).disabled = !ready || locked;
      $(key + suffix).title = locked ? (deviceControls[key].fan ? 'Fan' : 'Temperature') + ' controls are locked during a print. Change this in Settings.' : '';
    }
  }
}
function setDeviceControl(key, value) {
  if (!controlsConnected || socket?.readyState !== WebSocket.OPEN || pendingDevice) return;
  const control = deviceControls[key];
  if (!control || deviceControlLocked(control)) return;
  if (String(value).trim() === '' || !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > control.max) {
    show('deviceControlStatus', 'Enter a whole number from 0 to ' + control.max + ' for ' + control.label.toLowerCase() + '.');
    return;
  }
  value = Number(value);
  const request = message(403, control.fan ? { TargetFanSpeed: { [control.fan]: value } } : { [control.field]: value });
  pendingDevice = { id: request.Data.RequestID, label: control.label };
  show('deviceControlStatus', control.label + ': ' + value + (control.fan ? '%' : '°C') + ' requested…');
  updateDeviceControls();
  pendingDevice.timer = setTimeout(() => {
    pendingDevice = undefined;
    show('deviceControlStatus', 'No confirmation received. Check printer status before retrying.');
    updateDeviceControls();
  }, 15000);
  try { socket.send(JSON.stringify(request)); }
  catch {
    clearTimeout(pendingDevice.timer);
    pendingDevice = undefined;
    show('deviceControlStatus', 'Command could not be sent. Reconnect and try again.');
    updateDeviceControls();
  }
}
function handleDeviceResponse(raw) {
  const response = raw.Data;
  if (!pendingDevice || response?.RequestID !== pendingDevice.id || response.Data?.Ack == null) return;
  const { label, timer } = pendingDevice;
  clearTimeout(timer);
  pendingDevice = undefined;
  show('deviceControlStatus', Number(response.Data.Ack) === 0 ? label + ' accepted. Waiting for updated printer status.' : label + ' rejected by printer (code ' + response.Data.Ack + ').');
  updateDeviceControls();
  send(0, {});
}
for (const [key, control] of Object.entries(deviceControls)) {
  const form = document.createElement('form');
  form.className = 'device-control-row';
  form.className += control.fan ? ' fan-control-row' : ' heater-control-row';
  const unit = control.fan ? '%' : '°C';
  form.innerHTML = '<label for="' + key + 'Setting">' + control.label + ' <span id="' + key + 'Reported">—</span></label><div class="device-control-inputs"><input id="' + key + 'Setting" type="number" min="0" max="' + control.max + '" step="1" placeholder="0–' + control.max + '" aria-label="' + control.label + ' target (' + unit + ')" required disabled /><span>' + unit + '</span><button id="' + key + 'Apply" type="submit" disabled>Set</button><button id="' + key + 'Off" type="button" disabled>Off</button></div>';
  if (!control.fan) form.innerHTML = '<div class="temperature-gauge" aria-hidden="true"><svg viewBox="0 0 120 100"><path class="gauge-track" d="M22 82 A48 48 0 1 1 98 82" pathLength="100"/><path id="' + key + 'GaugeArc" class="gauge-arc" d="M22 82 A48 48 0 1 1 98 82" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/></svg><span id="' + key + 'GaugeValue" class="gauge-value">—</span><span class="gauge-name">' + control.label + '</span></div>' + form.innerHTML;
  $('deviceControlRows').append(form);
  form.onsubmit = event => { event.preventDefault(); setDeviceControl(key, $(key + 'Setting').value); };
  $(key + 'Off').onclick = () => setDeviceControl(key, 0);
}
function updatePrintControls() {
  const ready = controlsConnected && socket?.readyState === WebSocket.OPEN && !pendingControl;
  $('resumePrint').disabled = !ready || !activePrint || printStatus !== 6;
  $('pausePrint').disabled = !ready || !activePrint || [5, 6, 7, 12].includes(printStatus);
  $('stopPrint').disabled = !ready || !activePrint || printStatus === 7;
}
function resetPrintControls(connected) {
  controlsConnected = connected;
  devicePrintActive = false;
  clearTimeout(pendingDevice?.timer);
  pendingDevice = undefined;
  updateDeviceControls();
  show('deviceControlStatus', connected ? 'Ready. Choose a target to apply.' : 'Connect to control your printer.');
  for (const key of Object.keys(deviceControls)) {
    $(key + 'Setting').value = '';
    show(key + 'Reported', '—');
    if (!deviceControls[key].fan) {
      show(key + 'GaugeValue', '—');
      $(key + 'GaugeArc').setAttribute('stroke-dashoffset', '100');
    }
  }
  printStatus = null;
  activePrint = false;
  clearTimeout(pendingControl?.timer);
  pendingControl = undefined;
  show('printControlStatus', '');
  updatePrintControls();
}
function controlPrint(cmd, buttonId, label, data = {}) {
  if ($(buttonId).disabled || socket?.readyState !== WebSocket.OPEN) return;
  const request = message(cmd, data);
  pendingControl = { id: request.Data.RequestID, label };
  show('printControlStatus', `${label} requested…`);
  updatePrintControls();
  pendingControl.timer = setTimeout(() => {
    pendingControl = undefined;
    show('printControlStatus', 'No confirmation received. Check printer status before retrying.');
    updatePrintControls();
  }, 10000);
  try { socket.send(JSON.stringify(request)); }
  catch {
    clearTimeout(pendingControl.timer);
    pendingControl = undefined;
    show('printControlStatus', 'Command could not be sent. Reconnect and try again.');
    updatePrintControls();
  }
}
function handlePrintResponse(raw) {
  const response = raw.Data;
  if (!pendingControl || response?.RequestID !== pendingControl.id || response.Data?.Ack == null) return;
  const { label, timer } = pendingControl;
  clearTimeout(timer);
  pendingControl = undefined;
  show('printControlStatus', Number(response.Data.Ack) === 0 ? `${label} accepted. Waiting for updated printer status.` : `${label} rejected by printer (code ${response.Data.Ack}).`);
  updatePrintControls();
  send(0, {});
}
const show = (id, value) => $(id).textContent = value ?? '—';
const degrees = value => value != null && Number.isFinite(Number(value)) ? `${Math.round(Number(value))}°` : '—';
const duration = value => {
  if (!Number.isFinite(value) || value <= 0) return '—';
  const hours = Math.floor(value / 3600), minutes = Math.ceil((value % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};
const finishTime = secondsLeft => {
  if (!Number.isFinite(secondsLeft) || secondsLeft <= 0) return '—';
  const now = new Date(), finish = new Date(Date.now() + secondsLeft * 1000);
  const time = finish.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return finish.toDateString() === now.toDateString() ? time : `tomorrow ${time}`;
};
function setConnection(message, connected = false) {
  resetPrintControls(connected);
  $('connection').innerHTML = connected ? '' : `<b>Offline.</b> ${message}`;
  $('connection').parentElement.hidden = connected;
  $('liveBadge').classList.toggle('online', connected);
  $('lightToggle').disabled = !connected;
  $('liveText').textContent = connected ? 'CONNECTED, SHOWING LIVE FEED' : 'OFFLINE';
}
function updateLightState(on) { currentLightOn = Boolean(on); $('lightToggle').setAttribute('aria-pressed', String(currentLightOn)); }
function requestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // LAN HTTP pages lack randomUUID; getRandomValues also works outside secure contexts.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function message(cmd, data = {}) { const id = requestId(); return { Id: id, Data: { Cmd: cmd, Data: data, RequestID: id, serialNumber: saved.serialNumber, TimeStamp: Math.floor(Date.now() / 1000), From: 0 }, Topic: `sdcp/request/${saved.serialNumber}` }; }
function send(cmd, data, target = socket) { if (target?.readyState === WebSocket.OPEN) target.send(JSON.stringify(message(cmd, data))); }
function normalizeUrl(url) { return /^https?:\/\//.test(url) ? url : `http://${url}`; }
function startCamera(url) { if (!url) return; const img = $('camera'); img.src = normalizeUrl(url); img.hidden = false; $('cameraEmpty').hidden = true; }
function updateStatus(raw) {
  const s = [raw.Status, raw.Data?.Status, raw.Data?.Data?.Status, raw.Data?.Data, raw.Data, raw].find(value => value && typeof value === 'object' && ('PrintInfo' in value || 'CurrentStatus' in value || 'TempOfNozzle' in value || 'TempOfHotbed' in value || 'CurrentFanSpeed' in value));
  if (!s) return;
  for (const [key, field] of [['nozzle', 'TempOfNozzle'], ['bed', 'TempOfHotbed']]) {
    const value = s[field];
    if (value != null && Number.isFinite(Number(value))) {
      show(key + 'GaugeValue', degrees(value));
      $(key + 'GaugeArc').setAttribute('stroke-dashoffset', String(100 - Math.max(0, Math.min(100, Number(value) / deviceControls[key].max * 100))));
    }
  }
  for (const [key, control] of Object.entries(deviceControls)) {
    const value = control.fan ? s.CurrentFanSpeed?.[control.fan] : s[control.field];
    if (value != null && Number.isFinite(Number(value))) show(key + 'Reported', (control.fan ? 'Current ' : 'Target ') + Math.round(Number(value)) + (control.fan ? '%' : '°C'));
  }
  const info = s.PrintInfo || {};
  const total = Number(info.TotalTicks), current = Number(info.CurrentTicks);
  const machineCode = Number(Array.isArray(s.CurrentStatus) ? s.CurrentStatus[0] : s.CurrentStatus);
  const printCode = info.Status == null ? null : Number(info.Status);
  // Only actual print reports drive recording; connection resets are not job endings.
  if (info.Status != null && typeof window !== 'undefined' && window.printReplay) {
    const recording = ![0, 8, 9].includes(printCode) && (machineCode === 1 || [1, 2, 3, 4, 5, 6, 7, 10, 12].includes(printCode));
    window.printReplay.update(recording, $('camera').src || normalizeUrl(saved.cameraUrl || `${saved.printerIp}:${saved.printerModel === 'cc2' ? '8080/?action=stream' : '3031/video'}`), info.Filename || '', saved.printerModel, saved.printerIp);
  }
  const printInProgress = ![0, 8, 9].includes(printCode) && (machineCode === 1 || [1, 2, 3, 4, 5, 6, 7, 10].includes(printCode));
  const hasActiveJob = Boolean(info.Filename) && printInProgress;
  if (s.PrintInfo || 'CurrentStatus' in s) {
    printStatus = printCode;
    activePrint = hasActiveJob;
    devicePrintActive = printInProgress;
    updateDeviceControls();
    updatePrintControls();
  }
  if (devicePrintActive) {
    for (const [key, control] of Object.entries(deviceControls)) {
      const input = $(key + 'Setting');
      const value = control.fan ? s.CurrentFanSpeed?.[control.fan] : s[key === 'nozzle' ? 'TempOfNozzle' : 'TempOfHotbed'];
      if (value != null && Number.isFinite(Number(value)) && (input.disabled || document.activeElement !== input)) {
        input.value = String(Math.round(Number(value)));
      }
    }
  }
  const reportedProgress = info.Progress == null ? NaN : Number(info.Progress);
  const percent = hasActiveJob && Number.isFinite(reportedProgress) ? Math.max(0, Math.min(100, Math.round(reportedProgress))) : hasActiveJob && total > 0 ? Math.min(100, Math.round(current / total * 100)) : null;
  show('machineStatus', hasActiveJob ? ({ 5: 'Pausing', 6: 'Paused', 7: 'Stopping', 12: 'Resuming' }[printCode] || states[machineCode] || 'Printing') : 'Waiting for a print');
  show('filename', hasActiveJob ? info.Filename : 'Waiting for a print…'); show('progress', percent === null ? '—' : `${percent}%`); $('progressFill').style.width = `${percent || 0}%`;
  const remaining = info.RemainingSeconds == null ? total - current : Number(info.RemainingSeconds);
  show('layer', hasActiveJob ? `Layer ${info.CurrentLayer ?? '—'} / ${info.TotalLayer ?? '—'}` : 'Ready when you are'); show('remaining', hasActiveJob ? `Finishes ${finishTime(remaining)} · ${duration(remaining)} left` : 'No print queued');
  show('nozzle', degrees(s.TempOfNozzle)); show('nozzleTarget', degrees(s.TempTargetNozzle));
  show('bed', degrees(s.TempOfHotbed)); show('bedTarget', degrees(s.TempTargetHotbed)); show('chamber', degrees(s.TempOfBox));
  if (s.LightStatus && 'SecondLight' in s.LightStatus) updateLightState(Number(s.LightStatus.SecondLight) === 1 || s.LightStatus.SecondLight === true);
}
// CC1 announces its MainboardID in the topic of the frames it pushes on connect, so the
// dashboard can read it from the printer rather than make the user go and find it.
const SERIAL_DISCOVERY_TIMEOUT = 8000;
function mainboardIdFrom(raw) {
  const topic = typeof raw?.Topic === 'string' ? raw.Topic.replace(/^sdcp\/[a-z]+\//i, '') : '';
  return [raw?.Data?.MainboardID, raw?.Data?.Data?.MainboardID, raw?.MainboardID, topic]
    .find(candidate => typeof candidate === 'string' && /^[0-9a-f]{8,64}$/i.test(candidate));
}
function discoverViaServer(ip, receive) {
  if (typeof fetch !== 'function' || location.protocol === 'file:') return;
  fetch(`/api/discover?ip=${encodeURIComponent(ip)}`, { cache: 'no-store' })
    .then(response => response.ok ? response.json() : null)
    .then(data => {
      const serial = mainboardIdFrom({ MainboardID: data?.serialNumber });
      if (serial) receive(serial);
    }).catch(() => { });
}
function discoveryNotice() {
  return 'No printer ID arrived. ' + (location.protocol === 'file:'
    ? 'Opening dashboard.html directly supports WebSocket announcements only. Run the dashboard with Docker for UDP discovery, or enter the Serial Number manually.'
    : 'Check that the printer is reachable. Without the Docker discovery service, detection depends on WebSocket announcements. You can also enter the Serial Number manually.');
}
let serialProbe, serialProbeDebounce, serialProbeTimeout;
function cancelSerialProbe(pending = false) {
  clearTimeout(serialProbeDebounce); clearTimeout(serialProbeTimeout);
  serialProbeDebounce = serialProbeTimeout = undefined;
  if (serialProbe) { serialProbe.onopen = serialProbe.onmessage = serialProbe.onerror = serialProbe.onclose = null; serialProbe.close(); serialProbe = undefined; }
  if (pending) setDiscoveryPending(false);
}
// Ask the printer for its ID while the form is still open, so the field fills itself in.
function probeSerial(ip) {
  cancelSerialProbe();
  if ($('printerModel').value === 'cc2' || !looksLikeAddress(ip)) return setDiscoveryPending(false);
  // Don't compete for the printer's connection slots with a session that is already live.
  if (saved.printerModel === 'cc1' && socket?.readyState === WebSocket.OPEN && saved.printerIp === ip && saved.serialNumber) {
    if (!$('serialNumber').value.trim()) $('serialNumber').value = saved.serialNumber;
    return setDiscoveryPending(false);
  }
  setDiscoveryPending(true);
  let probe;
  try { probe = new WebSocket(`ws://${ip}:3030/websocket`); } catch { return setDiscoveryPending(false); }
  serialProbe = probe;
  const finish = () => { if (serialProbe === probe) cancelSerialProbe(true); };
  const failed = () => {
    if (serialProbe !== probe) return;
    finish();
    $('settingsNotice').hidden = false;
    $('settingsNotice').textContent = discoveryNotice();
  };
  serialProbeTimeout = setTimeout(failed, SERIAL_DISCOVERY_TIMEOUT);
  const receive = serialNumber => {
    if (serialProbe !== probe) return;
    $('serialNumber').value = serialNumber; $('settingsNotice').hidden = true;
    finish();
  };
  discoverViaServer(ip, receive);
  probe.onmessage = event => {
    if (event.data === 'pong') return;
    let data; try { data = JSON.parse(event.data); } catch { return; }
    const serialNumber = mainboardIdFrom(data);
    if (!serialNumber) return;
    receive(serialNumber);
  };
  probe.onerror = failed; probe.onclose = failed;
}
function scheduleSerialProbe() {
  clearTimeout(serialProbeDebounce); serialProbeDebounce = undefined;
  cancelSerialProbe(true);
  const ip = $('printerIp').value.trim();
  serialProbeDebounce = setTimeout(() => probeSerial(ip), SERIAL_PROBE_DELAY);
}
const SERIAL_PROBE_DELAY = 700;
function looksLikeAddress(value) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value) || /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(value);
}
let settingsPendingClose = false;
function setDiscoveryPending(pending) {
  $('serialSpinner').hidden = !pending;
  $('serialNumber').setAttribute('aria-busy', String(pending));
}
function startSession(active, cc2) {
  setConnection('Receiving live printer status.', true);
  send(0, {}, active); send(1, {}, active); send(386, { Enable: 1 }, active);
  startCamera(saved.cameraUrl || `${saved.printerIp}:${cc2 ? '8080/?action=stream' : '3031/video'}`);
  heartbeatTimer = setInterval(() => { if (socket === active && active.readyState === WebSocket.OPEN) active.send('ping'); }, 15000);
}
function stopConnection(preserveReplay = false) {
  if (!preserveReplay && typeof window !== 'undefined') window.printReplay?.detach?.();
  resetPrintControls(false);
  clearTimeout(reconnectTimer); clearTimeout(discoveryTimer); clearInterval(heartbeatTimer); heartbeatTimer = undefined;
  connectionVersion++;
  if (socket) { socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null; socket.close(); socket = undefined; }
}
function connect() {
  clearTimeout(reconnectTimer);
  cancelSerialProbe();
  const cc2 = saved.printerModel === 'cc2';
  // CC2 needs its serial number up front because it forms part of the MQTT topic it
  // publishes to. CC1 can start with none and ask the printer for it.
  const discovering = !cc2 && !saved.serialNumber;
  if (!saved.printerIp || (cc2 && (!saved.serialNumber || !saved.accessCode))) return openSettings();
  const version = ++connectionVersion;
  clearInterval(heartbeatTimer); heartbeatTimer = undefined;
  if (socket) { socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null; socket.close(); }
  let active;
  let connectionError = '';
  $('camera').removeAttribute('src'); $('camera').hidden = true; $('cameraEmpty').hidden = false;
  updateStatus({ Status: { CurrentStatus: 0 } });
  updateLightState(false);
  try { active = socket = cc2 ? new CC2Connection(saved) : new WebSocket(`ws://${saved.printerIp}:3030/websocket`); } catch { return setConnection('Invalid connection settings or missing protocol library.'); }
  setConnection('Connecting to printer…');
  active.onopen = () => {
    if (version !== connectionVersion) return;
    retryDelay = 1500;
    if (discovering) {
      setDiscoveryPending(true);
      setConnection('Waiting for the printer to identify itself…');
      discoveryTimer = setTimeout(() => {
        if (version !== connectionVersion) return;
        setDiscoveryPending(false); settingsPendingClose = false;
        stopConnection();
        openSettings(discoveryNotice());
      }, SERIAL_DISCOVERY_TIMEOUT);
      discoverViaServer(saved.printerIp, serialNumber => {
        if (version === connectionVersion && active.readyState === WebSocket.OPEN) {
          active.onmessage({ data: JSON.stringify({ MainboardID: serialNumber }) });
        }
      });
      return;
    }
    startSession(active, cc2);
  };
  active.onmessage = e => {
    if (version !== connectionVersion || e.data === 'pong') return;
    try {
      const data = JSON.parse(e.data);
      if (discovering && !saved.serialNumber) {
        const serialNumber = mainboardIdFrom(data);
        if (serialNumber) {
          clearTimeout(discoveryTimer);
          saved.serialNumber = serialNumber;
          saveActiveProfile();
          updatePrinterSwitch();
          $('serialNumber').value = serialNumber;
          setDiscoveryPending(false);
          if (settingsPendingClose) { settingsPendingClose = false; if ($('settingsDialog').open) $('settingsDialog').close(); }
          startSession(active, cc2);
        }
      }
      handlePrintResponse(data); handleDeviceResponse(data); const video = data.Data?.Data?.VideoUrl || data.Data?.VideoUrl; if (video && !saved.cameraUrl) startCamera(video); updateStatus(data);
    } catch { }
  };
  active.onerror = event => { if (version === connectionVersion) { connectionError = cc2 ? event.message || 'CC2 connection failed.' : ''; setConnection(connectionError || 'Connection issue detected; attempting to recover…'); } };
  active.onclose = () => {
    if (version !== connectionVersion) return;
    clearTimeout(discoveryTimer);
    clearInterval(heartbeatTimer); heartbeatTimer = undefined; socket = undefined;
    const wait = retryDelay; retryDelay = Math.min(retryDelay * 2, 30000);
    setConnection(`${connectionError || 'Connection lost.'} Retrying in ${Math.ceil(wait / 1000)} seconds…`);
    if (discovering && $('settingsDialog').open) { $('settingsNotice').hidden = false; $('settingsNotice').textContent = `Could not reach ${saved.printerIp}. Check the address and that the printer is powered on.`; }
    reconnectTimer = setTimeout(connect, wait);
  };
}
const collapsedPanels = { stats: false, controls: false };
const mobileFullscreenQuery = typeof matchMedia === 'function'
  ? matchMedia('(max-width: 720px), (max-width: 960px) and (max-height: 600px)') : null;
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    document.querySelector('.shell').style.setProperty(
      '--controls-panel-height', `${$('printControlPanel').offsetHeight}px`);
  }).observe($('printControlPanel'));
}
function updateFullscreenPanels() {
  const shell = document.querySelector('.shell');
  const fullscreen = !bothView && document.fullscreenElement === shell;
  const collapsible = fullscreen && (Boolean(mobileFullscreenQuery?.matches) || saved.redesignedFullscreen === false);
  shell.classList.toggle('fullscreen-controls-collapsed', collapsible && collapsedPanels.controls);
  for (const [name, panelId] of [
    ['stats', 'overlay'],
    ['controls', 'printControlPanel']
  ]) {
    const collapsed = collapsible && collapsedPanels[name];
    const panel = $(panelId), button = $(`${name}PanelToggle`);
    panel.classList.toggle('fullscreen-collapsed', collapsed);
    $(`${name}PanelContent`).inert = collapsed;
    button.hidden = !collapsible;
    button.setAttribute('aria-expanded', String(!collapsed));
    const label = `${collapsed ? 'Show' : 'Hide'} ${name} panel`;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.textContent = (name === 'stats') !== collapsed ? '‹' : '›';
  }
}
for (const name of ['stats', 'controls']) {
  $(`${name}PanelToggle`).onclick = () => {
    collapsedPanels[name] = !collapsedPanels[name];
    updateFullscreenPanels();
  };
}
updateFullscreenPanels();
function updateFullscreenLayoutButton() {
  const redesigned = saved.redesignedFullscreen !== false;
  const button = $('fullscreenLayoutButton');
  const label = `Use ${redesigned ? 'original' : 'redesigned'} fullscreen layout`;
  button.setAttribute('aria-pressed', String(redesigned));
  button.setAttribute('aria-label', label);
  button.title = label;
}
updateFullscreenLayoutButton();
$('fullscreenLayoutButton').onclick = () => {
  saved.redesignedFullscreen = saved.redesignedFullscreen === false;
  persistSettings('redesignedFullscreen');
  updateFullscreenLayoutButton();
  layoutFullscreenDock(document.fullscreenElement === document.querySelector('.shell') && !bothView);
  updateFullscreenPanels();
};
for (const setting of ['lockTemperaturesDuringPrint', 'lockFansDuringPrint']) {
  $(setting).checked = saved[setting] === true;
  $(setting).onchange = () => {
    saved[setting] = $(setting).checked;
    persistSettings(setting);
    updateDeviceControls();
  };
}
function updateModelSettings() {
  const cc2 = $('printerModel').value === 'cc2';
  $('cc2Settings').hidden = !cc2;
  $('accessCode').required = cc2;
  $('accessCode').disabled = !cc2;
  $('serialLabel').textContent = cc2 ? 'Printer serial number (SN)' : 'Serial Number';
  $('serialNumber').required = cc2;
  $('serialHint').hidden = cc2;
  $('cameraUrl').placeholder = cc2 ? 'http://192.168.1.50:8080/?action=stream' : 'http://192.168.1.50:3031/video';
  if (cc2) cancelSerialProbe(true);
  else if ($('settingsDialog').open && !$('serialNumber').value.trim()) scheduleSerialProbe();
}
function openSettings(notice = '') {
  settingsDrafts = JSON.parse(JSON.stringify(saved.profiles));
  editingModel = saved.printerModel;
  for (const key of connectionFields) $(key).value = saved[key] || '';
  $('printerModel').value = editingModel;
  updateModelSettings();
  $('settingsNotice').hidden = !notice; $('settingsNotice').textContent = notice;
  $('settingsDialog').showModal();
  if (!notice && editingModel === 'cc1' && !$('serialNumber').value.trim()) scheduleSerialProbe();
}
$('printerModel').onchange = () => {
  cancelSerialProbe(true);
  settingsDrafts[editingModel] = Object.fromEntries(connectionFields.map(key => [key, $(key).value]));
  editingModel = $('printerModel').value;
  for (const key of connectionFields) $(key).value = settingsDrafts[editingModel]?.[key] || '';
  $('settingsNotice').hidden = true;
  updateModelSettings();
};
$('switchBoth').onclick = showBothPrinters;
$('switchCC1').onclick = () => selectPrinter('cc1');
$('switchCC2').onclick = () => selectPrinter('cc2');
updatePrinterSwitch();
$('printerIp').addEventListener('input', scheduleSerialProbe);
$('settingsButton').onclick = () => openSettings();
$('lightToggle').onclick = () => { const next = !currentLightOn; updateLightState(next); send(403, { LightStatus: { SecondLight: next ? 1 : 0 } }); };
$('stopPrint').onclick = () => controlPrint(130, 'stopPrint', 'Stop');
$('resumePrint').onclick = () => controlPrint(131, 'resumePrint', 'Resume');
$('pausePrint').onclick = () => controlPrint(129, 'pausePrint', 'Pause');
$('refreshButton').onclick = () => { retryDelay = 1500; setConnection('Refreshing printer connection…'); stopConnection(true); connect(); };
$('fullscreenButton').onclick = async () => {
  try { document.fullscreenElement ? await document.exitFullscreen() : await document.querySelector('.shell').requestFullscreen(); }
  catch { show('printControlStatus', 'Fullscreen is not available in this browser.'); }
};
let fullscreenOrientationRequested = false;
async function updateFullscreenOrientation(fullscreen) {
  const orientation = globalThis.screen?.orientation;
  if (!fullscreen) {
    if (fullscreenOrientationRequested) {
      fullscreenOrientationRequested = false;
      try { orientation?.unlock?.(); } catch { /* Browser may already have released the lock. */ }
    }
    return;
  }
  if (!mobileFullscreenQuery?.matches || !orientation?.lock) return;
  fullscreenOrientationRequested = true;
  try {
    await orientation.lock('landscape');
    if (document.fullscreenElement !== document.querySelector('.shell')) {
      orientation.unlock?.();
      fullscreenOrientationRequested = false;
    }
  } catch { /* Keep fullscreen usable when orientation locking is unsupported or denied. */ }
}
document.addEventListener('fullscreenchange', () => {
  const fullscreen = document.fullscreenElement === document.querySelector('.shell');
  updateFullscreenOrientation(fullscreen);
  $('fullscreenButton').textContent = fullscreen ? '⛶' : '⛶';
  if (fullscreen && !bothView) $('printerSwitch').before($('lightToggle'));
  else $('camera').after($('lightToggle'));
  layoutFullscreenDock(fullscreen && !bothView);
  updateFullscreenPanels();
});
mobileFullscreenQuery?.addEventListener('change', () => {
  layoutFullscreenDock(document.fullscreenElement === document.querySelector('.shell') && !bothView);
  updateFullscreenPanels();
});
let devicePanelWasOpen = false, fullscreenDockActive = false;
function layoutFullscreenDock(fullscreen) {
  const dock = $('fullscreenDock');
  fullscreen = fullscreen && !mobileFullscreenQuery?.matches && saved.redesignedFullscreen !== false;
  document.querySelector('.shell').classList.toggle('desktop-fullscreen', fullscreen);
  if (fullscreen && !fullscreenDockActive) {
    devicePanelWasOpen = $('devicePanel').open;
    $('fullscreenTemperatures').append($('devicePanel'));
    dock.append($('overlay'));
    dock.append($('printControlPanel'));
    $('devicePanel').open = true;
  } else if (!fullscreen && fullscreenDockActive) {
    document.querySelector('.print-controls').after($('devicePanel'));
    document.querySelector('.camera').append($('printControlPanel'));
    $('replayPanel').after($('overlay'));
    $('devicePanel').open = devicePanelWasOpen;
  }
  fullscreenDockActive = fullscreen;
  dock.hidden = !fullscreen;
}
$('settingsDialog').addEventListener('close', () => cancelSerialProbe(true));
$('serialNumber').addEventListener('input', () => cancelSerialProbe(true));
$('closeButton').onclick = () => $('settingsDialog').close();
// Chrome's own validation bubble is easy to miss inside a modal dialog, and a blocked
// submit otherwise looks like the Save button doing nothing.
const settingsRequirements = {
  printerIp: 'Enter the printer IP address.',
  serialNumber: 'Enter the printer serial number, or use the Centauri Carbon (CC1) and let the dashboard detect it.',
  accessCode: 'Enter the CC2 LAN access code from the printer touchscreen.'
};
$('settingsForm').addEventListener('invalid', event => {
  const requirement = settingsRequirements[event.target.id];
  if (requirement) { $('settingsNotice').hidden = false; $('settingsNotice').textContent = requirement; }
}, true);
$('settingsForm').onsubmit = e => {
  e.preventDefault();
  saved.printerModel = embedded ? embeddedModel : $('printerModel').value; saved.accessCode = $('accessCode').value.trim(); saved.printerIp = $('printerIp').value.trim(); saved.serialNumber = $('serialNumber').value.trim(); saved.cameraUrl = $('cameraUrl').value.trim();
  saveActiveProfile();
  updatePrinterSwitch();
  $('settingsNotice').hidden = true;
  // Leave the dialog up while the printer is asked for its ID, so the spinner has somewhere to live.
  const detecting = saved.printerModel !== 'cc2' && !saved.serialNumber;
  settingsPendingClose = detecting; setDiscoveryPending(detecting);
  if (!detecting) $('settingsDialog').close();
  stopConnection(); connect();
};
$('camera').onerror = () => { $('cameraEmpty').hidden = false; $('cameraEmpty').textContent = 'Camera stream unavailable. Check the camera URL or that the printer camera is enabled.'; };
addEventListener('pagehide', () => { stopConnection(true); closeBothView(true); });
if (embedded) {
  document.body.classList.add('embedded-dashboard');
  document.querySelector('h1').textContent = embeddedModel === 'cc1' ? 'Centauri Carbon · CC1' : 'Centauri Carbon 2 · CC2';
  $('printerModel').disabled = true;
  // Match each panel to its contents, including wrapped status messages.
  if (typeof ResizeObserver !== 'undefined' && window.frameElement) {
    new ResizeObserver(() => {
      window.frameElement.style.height = `${document.querySelector('.shell').scrollHeight}px`;
    }).observe(document.querySelector('.shell'));
  }
}
if (!embedded && saved.viewMode === 'both' && profileReady('cc1') && profileReady('cc2')) showBothPrinters();
else connect();


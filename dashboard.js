const $ = id => document.getElementById(id);
const saved = JSON.parse(localStorage.getItem('dashboard') || '{}');
let socket, reconnectTimer, discoveryTimer, heartbeatTimer, connectionVersion = 0, retryDelay = 1500, currentLightOn = false;
const states = { 0: 'Idle', 1: 'Printing', 2: 'Transferring', 3: 'Calibrating', 4: 'Testing' };
let controlsConnected = false, printStatus = null, activePrint = false, pendingControl;
function updatePrintControls() {
  const ready = controlsConnected && socket?.readyState === WebSocket.OPEN && !pendingControl;
  $('resumePrint').disabled = !ready || !activePrint || printStatus !== 6;
  $('pausePrint').disabled = !ready || !activePrint || [5, 6, 7, 12].includes(printStatus);
  $('stopPrint').disabled = !ready || !activePrint || printStatus === 7;
}
function resetPrintControls(connected) {
  controlsConnected = connected;
  printStatus = null;
  activePrint = false;
  clearTimeout(pendingControl?.timer);
  pendingControl = undefined;
  show('printControlStatus', '');
  updatePrintControls();
}
function controlPrint(cmd, buttonId, label) {
  if ($(buttonId).disabled || socket?.readyState !== WebSocket.OPEN) return;
  const request = message(cmd);
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
function setConnection(message, connected = false) { resetPrintControls(connected); $('connection').innerHTML = `<b>${connected ? 'Connected.' : 'Offline.'}</b> ${message}`; $('liveBadge').classList.toggle('online', connected); $('overlay').classList.toggle('connected', connected); $('lightToggle').disabled = !connected; $('liveText').textContent = connected ? 'LIVE' : 'OFFLINE'; }
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
  const s = [raw.Status, raw.Data?.Status, raw.Data?.Data?.Status, raw.Data?.Data, raw.Data, raw].find(value => value && typeof value === 'object' && ('PrintInfo' in value || 'CurrentStatus' in value || 'TempOfNozzle' in value));
  if (!s || typeof s !== 'object' || !('PrintInfo' in s || 'CurrentStatus' in s || 'TempOfNozzle' in s)) return;
  const info = s.PrintInfo || {};
  const total = Number(info.TotalTicks), current = Number(info.CurrentTicks);
  const machineCode = Number(Array.isArray(s.CurrentStatus) ? s.CurrentStatus[0] : s.CurrentStatus);
  const printCode = info.Status == null ? null : Number(info.Status);
  const printInProgress = ![0, 8, 9].includes(printCode) && (machineCode === 1 || [1, 2, 3, 4, 5, 6, 7, 10].includes(printCode));
  const hasActiveJob = Boolean(info.Filename) && printInProgress;
  if (s.PrintInfo || 'CurrentStatus' in s) {
    printStatus = printCode;
    activePrint = hasActiveJob;
    updatePrintControls();
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
  const candidate = raw?.Data?.MainboardID ?? raw?.MainboardID ?? topic;
  return typeof candidate === 'string' && /^[0-9a-f]{8,64}$/i.test(candidate) ? candidate : undefined;
}
function startSession(active, cc2) {
  setConnection('Receiving live printer status.', true);
  send(0, {}, active); send(1, {}, active); send(386, { Enable: 1 }, active);
  startCamera(saved.cameraUrl || `${saved.printerIp}:${cc2 ? '8080/?action=stream' : '3031/video'}`);
  heartbeatTimer = setInterval(() => { if (socket === active && active.readyState === WebSocket.OPEN) active.send('ping'); }, 15000);
}
function stopConnection() {
  resetPrintControls(false);
  clearTimeout(reconnectTimer); clearTimeout(discoveryTimer); clearInterval(heartbeatTimer); heartbeatTimer = undefined;
  connectionVersion++;
  if (socket) { socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null; socket.close(); socket = undefined; }
}
function connect() {
  clearTimeout(reconnectTimer);
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
  try { active = socket = cc2 ? new CC2Connection(saved) : new WebSocket(`ws://${saved.printerIp}:3030/websocket`); } catch { return setConnection('Invalid connection settings or missing protocol library.'); }
  setConnection('Connecting to printer…');
  active.onopen = () => {
    if (version !== connectionVersion) return;
    retryDelay = 1500;
    if (discovering) {
      setConnection('Waiting for the printer to identify itself…');
      discoveryTimer = setTimeout(() => {
        if (version !== connectionVersion) return;
        stopConnection();
        openSettings('No printer ID arrived. The printer only announces itself while it is idle or printing — check that it is powered on, or enter the Serial Number from its interface.');
      }, SERIAL_DISCOVERY_TIMEOUT);
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
        if (serialNumber) { clearTimeout(discoveryTimer); saved.serialNumber = serialNumber; localStorage.setItem('dashboard', JSON.stringify(saved)); startSession(active, cc2); }
      }
      handlePrintResponse(data); const video = data.Data?.Data?.VideoUrl || data.Data?.VideoUrl; if (video && !saved.cameraUrl) startCamera(video); updateStatus(data);
    } catch { }
  };
  active.onerror = event => { if (version === connectionVersion) { connectionError = cc2 ? event.message || 'CC2 connection failed.' : ''; setConnection(connectionError || 'Connection issue detected; attempting to recover…'); } };
  active.onclose = () => {
    if (version !== connectionVersion) return;
    clearInterval(heartbeatTimer); heartbeatTimer = undefined; socket = undefined;
    const wait = retryDelay; retryDelay = Math.min(retryDelay * 2, 30000);
    setConnection(`${connectionError || 'Connection lost.'} Retrying in ${Math.ceil(wait / 1000)} seconds…`);
    reconnectTimer = setTimeout(connect, wait);
  };
}
function applyControlVisibility() {
  const visible = saved.showPrintControls !== false;
  $('printControlPanel').hidden = !visible;
  $('showPrintControls').checked = visible;
  document.querySelector('.shell').classList.toggle('controls-hidden', !visible);
  const temperaturesVisible = saved.showTemperatures !== false;
  $('temperaturesPanel').hidden = !temperaturesVisible;
  $('showTemperatures').checked = temperaturesVisible;
  $('overlay').classList.toggle('temperatures-hidden', !temperaturesVisible);
  $('overlay').hidden = saved.showStatsPanel === false;
  $('showStatsPanel').checked = saved.showStatsPanel !== false;
  $('lightToggle').hidden = saved.showLightToggle === false;
  $('showLightToggle').checked = saved.showLightToggle !== false;
}
for (const setting of ['showPrintControls', 'showTemperatures', 'showStatsPanel', 'showLightToggle']) {
  $(setting).onchange = () => {
    saved[setting] = $(setting).checked;
    localStorage.setItem('dashboard', JSON.stringify(saved));
    applyControlVisibility();
  };
}
applyControlVisibility();
function updateModelSettings() {
  const cc2 = $('printerModel').value === 'cc2';
  $('cc2Settings').hidden = !cc2;
  $('accessCode').required = cc2;
  $('accessCode').disabled = !cc2;
  $('serialLabel').textContent = cc2 ? 'Printer serial number (SN)' : 'Serial Number';
  $('serialNumber').required = cc2;
  $('serialHint').hidden = cc2;
  $('cameraUrl').placeholder = cc2 ? 'http://192.168.1.50:8080/?action=stream' : 'http://192.168.1.50:3031/video';
}
function openSettings(notice = '') {
  for (const key of ['printerIp', 'serialNumber', 'cameraUrl', 'accessCode']) $(key).value = saved[key] || '';
  $('printerModel').value = saved.printerModel === 'cc2' ? 'cc2' : 'cc1';
  updateModelSettings();
  $('settingsNotice').hidden = !notice; $('settingsNotice').textContent = notice;
  $('settingsDialog').showModal();
}
$('printerModel').onchange = updateModelSettings;
$('settingsButton').onclick = () => openSettings();
$('lightToggle').onclick = () => { const next = !currentLightOn; updateLightState(next); send(403, { LightStatus: { SecondLight: next ? 1 : 0 } }); };
$('stopPrint').onclick = () => controlPrint(130, 'stopPrint', 'Stop');
$('resumePrint').onclick = () => controlPrint(131, 'resumePrint', 'Resume');
$('pausePrint').onclick = () => controlPrint(129, 'pausePrint', 'Pause');
$('refreshButton').onclick = () => { retryDelay = 1500; setConnection('Refreshing printer connection…'); stopConnection(); connect(); };
$('fullscreenButton').onclick = async () => {
  try { document.fullscreenElement ? await document.exitFullscreen() : await document.querySelector('.shell').requestFullscreen(); }
  catch { show('printControlStatus', 'Fullscreen is not available in this browser.'); }
};
document.addEventListener('fullscreenchange', () => {
  const fullscreen = document.fullscreenElement === document.querySelector('.shell');
  $('fullscreenButton').textContent = fullscreen ? '⛶' : '⛶';
  if (fullscreen) $('fullscreenButton').after($('lightToggle'));
  else $('camera').after($('lightToggle'));
});
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
$('settingsForm').onsubmit = e => { e.preventDefault(); saved.printerModel = $('printerModel').value; saved.accessCode = $('accessCode').value.trim(); saved.printerIp = $('printerIp').value.trim(); saved.serialNumber = $('serialNumber').value.trim(); saved.cameraUrl = $('cameraUrl').value.trim(); localStorage.setItem('dashboard', JSON.stringify(saved)); $('settingsDialog').close(); stopConnection(); connect(); };
$('camera').onerror = () => { $('cameraEmpty').hidden = false; $('cameraEmpty').textContent = 'Camera stream unavailable. Check the camera URL or that the printer camera is enabled.'; };
addEventListener('pagehide', stopConnection);
connect();

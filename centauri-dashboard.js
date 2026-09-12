const $ = id => document.getElementById(id);
const saved = JSON.parse(localStorage.getItem('centauri-dashboard') || '{}');
let socket, reconnectTimer, heartbeatTimer, connectionVersion = 0, retryDelay = 1500, currentLightOn = false;
const states = {0:'Idle',1:'Printing',2:'Transferring',3:'Calibrating',4:'Testing'};
const show = (id, value) => $(id).textContent = value ?? '—';
const degrees = value => Number.isFinite(Number(value)) ? `${Math.round(Number(value))}°` : '—';
const duration = value => {
  if (!Number.isFinite(value) || value <= 0) return '—';
  const hours = Math.floor(value / 3600), minutes = Math.ceil((value % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};
const finishTime = secondsLeft => {
  if (!Number.isFinite(secondsLeft) || secondsLeft <= 0) return '—';
  const now = new Date(), finish = new Date(Date.now() + secondsLeft * 1000);
  const time = finish.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }).toLowerCase();
  return finish.toDateString() === now.toDateString() ? time : `tomorrow ${time}`;
};
function setConnection(message, connected=false) { $('connection').innerHTML = `<b>${connected ? 'Connected.' : 'Offline.'}</b> ${message}`; $('liveBadge').classList.toggle('online',connected); $('overlay').classList.toggle('connected',connected); $('lightToggle').disabled=!connected; $('liveText').textContent=connected?'LIVE':'OFFLINE'; }
function updateLightState(on) { currentLightOn=Boolean(on); $('lightToggle').setAttribute('aria-pressed',String(currentLightOn)); }
function message(cmd, data={}) { const id=crypto.randomUUID(); return { Id:id, Data:{Cmd:cmd,Data:data,RequestID:id,MainboardID:saved.mainboardId,TimeStamp:Math.floor(Date.now()/1000),From:0}, Topic:`sdcp/request/${saved.mainboardId}` }; }
function send(cmd, data, target = socket) { if (target?.readyState === WebSocket.OPEN) target.send(JSON.stringify(message(cmd,data))); }
function normalizeUrl(url) { return /^https?:\/\//.test(url) ? url : `http://${url}`; }
function startCamera(url) { if (!url) return; const img=$('camera'); img.src=normalizeUrl(url); img.hidden=false; $('cameraEmpty').hidden=true; }
function updateStatus(raw) {
  const s=raw.Status || raw.Data?.Status || raw.Data?.Data?.Status || raw;
  if (!s || typeof s !== 'object') return;
  const info=s.PrintInfo || {};
  const total=Number(info.TotalTicks), current=Number(info.CurrentTicks);
  const machineCode = Array.isArray(s.CurrentStatus) ? s.CurrentStatus[0] : s.CurrentStatus;
  const printCode = Number(info.Status);
  const printInProgress = machineCode === 1 || [1,2,3,4,5,6,7,10].includes(printCode);
  const hasActiveJob = Boolean(info.Filename) && printInProgress;
  const percent=hasActiveJob && total>0 ? Math.min(100,Math.round(current/total*100)) : null;
  show('machineStatus', hasActiveJob ? (states[machineCode] || 'Printing') : 'Waiting for a print');
  show('filename',hasActiveJob ? info.Filename : 'Waiting for a print…'); show('progress',percent===null?'—':`${percent}%`); $('progressFill').style.width=`${percent || 0}%`;
  const remaining = total - current;
  show('layer',hasActiveJob ? `Layer ${info.CurrentLayer ?? '—'} / ${info.TotalLayer ?? '—'}` : 'Ready when you are'); show('remaining',hasActiveJob ? `Finishes ${finishTime(remaining)} · ${duration(remaining)} left` : 'No print queued');
  show('nozzle',degrees(s.TempOfNozzle)); show('nozzleTarget',degrees(s.TempTargetNozzle));
  show('bed',degrees(s.TempOfHotbed)); show('bedTarget',degrees(s.TempTargetHotbed)); show('chamber',degrees(s.TempOfBox));
  if (s.LightStatus && 'SecondLight' in s.LightStatus) updateLightState(Number(s.LightStatus.SecondLight) === 1 || s.LightStatus.SecondLight === true);
}
function stopConnection() {
  clearTimeout(reconnectTimer); clearInterval(heartbeatTimer); heartbeatTimer = undefined;
  connectionVersion++;
  if (socket) { socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null; socket.close(); socket = undefined; }
}
function connect() {
  clearTimeout(reconnectTimer); if (!saved.printerIp || !saved.mainboardId) return $('settingsDialog').showModal();
  const version = ++connectionVersion;
  clearInterval(heartbeatTimer); heartbeatTimer = undefined;
  if (socket) { socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null; socket.close(); }
  let active;
  try { active = socket = new WebSocket(`ws://${saved.printerIp}:3030/websocket`); } catch { return setConnection('Invalid connection settings.'); }
  setConnection('Connecting to printer…');
  active.onopen=()=>{
    if (version !== connectionVersion) return;
    retryDelay = 1500; setConnection('Receiving live printer status.',true);
    send(0, {}, active); send(1, {}, active); send(386, {Enable:1}, active);
    startCamera(saved.cameraUrl || `${saved.printerIp}:3031/video`);
    heartbeatTimer = setInterval(() => { if (socket === active && active.readyState === WebSocket.OPEN) active.send('ping'); }, 15000);
  };
  active.onmessage=e=>{ if (version !== connectionVersion || e.data==='pong') return; try { const data=JSON.parse(e.data); const video=data.Data?.Data?.VideoUrl || data.Data?.VideoUrl; if(video) startCamera(video); updateStatus(data); } catch {} };
  active.onerror=()=>{ if (version === connectionVersion) setConnection('Connection issue detected; attempting to recover…'); };
  active.onclose=()=>{
    if (version !== connectionVersion) return;
    clearInterval(heartbeatTimer); heartbeatTimer = undefined; socket = undefined;
    const wait = retryDelay; retryDelay = Math.min(retryDelay * 2, 30000);
    setConnection(`Connection lost. Retrying in ${Math.ceil(wait / 1000)} seconds…`);
    reconnectTimer=setTimeout(connect, wait);
  };
}
$('settingsButton').onclick=()=>{ $('printerIp').value=saved.printerIp||''; $('mainboardId').value=saved.mainboardId||''; $('cameraUrl').value=saved.cameraUrl||''; $('settingsDialog').showModal(); };
$('lightToggle').onclick=()=>{ const next=!currentLightOn; updateLightState(next); send(403,{LightStatus:{SecondLight:next ? 1 : 0}}); };
$('refreshButton').onclick=()=>{ retryDelay=1500; setConnection('Refreshing printer connection…'); stopConnection(); connect(); };
$('fullscreenButton').onclick=async()=>{
  try { document.fullscreenElement ? await document.exitFullscreen() : await document.querySelector('.shell').requestFullscreen(); }
  catch { setConnection('Fullscreen is not available in this browser.'); }
};
document.addEventListener('fullscreenchange',()=>{ $('fullscreenButton').textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen'; });
$('cancelButton').onclick=()=>$('settingsDialog').close();
$('settingsForm').onsubmit=e=>{ e.preventDefault(); saved.printerIp=$('printerIp').value.trim(); saved.mainboardId=$('mainboardId').value.trim(); saved.cameraUrl=$('cameraUrl').value.trim(); localStorage.setItem('centauri-dashboard',JSON.stringify(saved)); $('settingsDialog').close(); stopConnection(); connect(); };
$('camera').onerror=()=>{ $('cameraEmpty').hidden=false; $('cameraEmpty').textContent='Camera stream unavailable. Check the camera URL or that the printer camera is enabled.'; };
addEventListener('pagehide', stopConnection);
connect();

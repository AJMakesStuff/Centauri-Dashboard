/* Keep the recording identity across reloads and retain footage until explicitly replaced. */
(() => {
  const settings = JSON.parse(localStorage.getItem('dashboard') || '{}');
  const model = new URLSearchParams(location.search).get('printer') || settings.printerModel || 'cc1';
  function tokenFor(printerModel) {
    const storageKey = `printReplay:${printerModel}`;
    let value;
    try { value = sessionStorage.getItem(storageKey); } catch { /* Storage may be disabled. */ }
    try {
      const stored = localStorage.getItem(storageKey);
      if (/^[a-f0-9]{32}$/.test(stored || '')) value = stored;
    } catch { /* Storage may be disabled. */ }
    if (!/^[a-f0-9]{32}$/.test(value || '')) {
      value = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
      try { sessionStorage.setItem(storageKey, value); } catch { /* Replay still works without reload recovery. */ }
    }
    try { localStorage.setItem(storageKey, value); } catch { /* Fall back to tab storage. */ }
    return value;
  }
  let selectedModel = model, token = tokenFor(model);
  const panel = document.getElementById('replayPanel');
  const slider = document.getElementById('replayTimeline');
  const image = document.getElementById('replayImage');
  const status = document.getElementById('replayStatus');
  const play = document.getElementById('replayPlay');
  const live = document.getElementById('replayLive');
  const deleteButton = document.getElementById('replayDelete');
  const recordingIndicator = document.getElementById('replayRecording');
  const timeDisplay = document.getElementById('replayTime');
  let currentSeconds = null, totalSeconds = 0, timeRequest = 0;
  const clockTime = seconds => {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor(value / 60) % 60;
    return `${hours ? hours + ':' + String(minutes).padStart(2, '0') : minutes}:${String(value % 60).padStart(2, '0')}`;
  };
  const showTime = () => { timeDisplay.textContent = `${currentSeconds === null ? '—' : clockTime(currentSeconds)} / ${clockTime(totalSeconds)}`; };
  let lastRecordingUpdate = 0;
  let active = false, url = '', job = '', busy = false, revision = 0, frames = 0, playing = false, lastStatus = 0;
  let hasStatus = false, deletePending = false;
  const draw = async () => {
    const request = ++timeRequest, version = revision;
    const query = `id=${token}&index=${slider.value}`;
    image.src = `/api/replay/frame?${query}`;
    image.hidden = slider.hidden = live.hidden = timeDisplay.hidden = false;
    currentSeconds = null; showTime();
    try {
      const response = await fetch(`/api/replay/time?${query}`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return;
      const data = await response.json();
      if (request !== timeRequest || version !== revision || image.hidden) return;
      currentSeconds = data.seconds; showTime();
    } catch { /* Keep an unavailable timestamp rather than estimating across camera gaps. */ }
  };
  const stop = () => { playing = false; play.textContent = image.hidden ? 'View Replay' : 'Play'; };
  const recordedDuration = seconds => {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const units = [['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
    const first = units.findIndex(([, size]) => total >= size);
    if (first < 0) return '0 seconds';
    return units.slice(first, first + 2).map(([name, size], index) => {
      const count = Math.floor(total / size) % (index ? units[first][1] / size : Infinity);
      return count ? `${count} ${name}${count === 1 ? '' : 's'}` : '';
    }).filter(Boolean).join(' ');
  };
  async function sync() {
    if (busy) return;
    busy = true;
    const version = revision;
    const deleting = deletePending;
    try {
      const response = await fetch('/api/replay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: token, url, active, job, delete: deleting }), signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (version !== revision) return;
      if (!response.ok) throw new Error(data.error || 'Replay unavailable');
      if (deleting) deletePending = false;
      recordingIndicator.hidden = !active || data.recording === false || Boolean(data.error) || data.frames <= frames;
      if (!recordingIndicator.hidden) lastRecordingUpdate = Date.now();
      frames = data.frames;
      panel.hidden = !active && !frames;
      deleteButton.hidden = active || !frames;
      deleteButton.disabled = false;
      if (!frames) { ++timeRequest; image.hidden = slider.hidden = live.hidden = timeDisplay.hidden = true; stop(); image.removeAttribute('src'); }
      totalSeconds = data.seconds || 0;
      showTime();
      slider.max = Math.max(0, frames - 1);
      slider.disabled = play.disabled = !frames;
      status.textContent = data.error || (data.recording === false && active ? 'Replay deleted for this print' : `${active ? 'Local replay recording' : 'Local replay available'} - ${recordedDuration(data.seconds)} recorded`);
    } catch (error) {
      if (version === revision) recordingIndicator.hidden = true;
      if (version === revision) { deletePending = false; deleteButton.disabled = false; status.textContent = `Replay unavailable. ${error.message}`; }
    } finally { busy = false; if (version !== revision && hasStatus) sync(); }
  }
  window.printReplay = {
    detach() { ++revision; ++timeRequest; lastStatus = 0; hasStatus = false; active = false; stop(); panel.hidden = true; recordingIndicator.hidden = true; },
    update(isActive, cameraUrl, jobName = '', printerModel = selectedModel) {
      const modelChanged = printerModel !== selectedModel;
      if (modelChanged) { token = tokenFor(printerModel); selectedModel = printerModel; deletePending = false; }
      lastStatus = Date.now();
      const changed = modelChanged || (isActive && (url !== cameraUrl || job !== jobName));
      const starting = isActive && !active;
      if (starting || changed) deletePending = false;
      url = cameraUrl; job = jobName;
      if (hasStatus && active === isActive && !changed) return;
      hasStatus = true;
      active = isActive; revision++;
      if (active) deleteButton.hidden = true;
      panel.hidden = !active && !frames;
      recordingIndicator.hidden = true;
      if (starting || changed) { image.hidden = slider.hidden = live.hidden = timeDisplay.hidden = true; stop(); image.removeAttribute('src'); frames = 0; slider.value = 0; slider.disabled = play.disabled = true; }
      sync();
    }
  };
  deleteButton.onclick = () => {
    if (active || !frames) return;
    deletePending = true; deleteButton.disabled = true; ++revision; ++timeRequest;
    image.hidden = slider.hidden = live.hidden = timeDisplay.hidden = true;
    stop(); image.removeAttribute('src'); recordingIndicator.hidden = true;
    sync();
  };
  slider.addEventListener('input', () => { draw(); stop(); });
  play.onclick = () => {
    if (!frames) return;
    if (image.hidden) { draw(); stop(); return; }
    playing = !playing;
    play.textContent = playing ? 'Pause' : 'Play';
    if (playing && Number(slider.value) >= frames - 1) slider.value = 0;
    if (playing) draw();
  };
  live.onclick = () => { ++timeRequest; image.hidden = slider.hidden = live.hidden = timeDisplay.hidden = true; stop(); image.removeAttribute('src'); };
  setInterval(() => {
    if (Date.now() - lastRecordingUpdate > 15000) recordingIndicator.hidden = true;
    if (hasStatus && Date.now() - lastStatus < 60000) sync();
  }, 5000);
  setInterval(() => {
    if (!playing || !frames || !image.complete) return;
    if (Number(slider.value) >= frames - 1) return stop();
    slider.value = Number(slider.value) + 1; draw();
  }, 500);
  // Unloading may be a refresh. The server stops stale capture but retains footage.
})();

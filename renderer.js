// renderer.js — full file for MindScribe (capture via preload desktopCapturer API + forward to node forwarder)
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const helloBtn = document.getElementById('helloBtn');
const devToolsBtn = document.getElementById('openDevtools');

// capture control buttons (created dynamically if not present)
let startCapture = document.getElementById('startCaptureBtn');
let stopCapture = document.getElementById('stopCaptureBtn');
if (!startCapture) {
  startCapture = document.createElement('button');
  startCapture.id = 'startCaptureBtn';
  startCapture.innerText = 'Start Capture (select source)';
  startCapture.style.marginLeft = '8px';
  document.body.insertBefore(startCapture, logEl);
}
if (!stopCapture) {
  stopCapture = document.createElement('button');
  stopCapture.id = 'stopCaptureBtn';
  stopCapture.innerText = 'Stop Capture';
  stopCapture.style.marginLeft = '8px';
  document.body.insertBefore(stopCapture, logEl);
}

// simple logger
function log(msg) {
  const time = new Date().toLocaleTimeString();
  if (logEl) logEl.innerText = `[${time}] ${msg}\n` + logEl.innerText;
  console.log(msg);
}

// initial UI messages
log('Renderer loaded successfully.');
if (statusEl) statusEl.innerText = 'Status: ready';

// basic click handlers
if (helloBtn) {
  helloBtn.addEventListener('click', () => {
    if (statusEl) statusEl.innerText = 'Status: Hello clicked!';
    log('Hello button clicked — renderer working.');
  });
}
if (devToolsBtn) {
  devToolsBtn.addEventListener('click', () => {
    log('Open DevTools in main (or press Ctrl+Shift+I).');
  });
}

// ---------------- WebSocket to forwarder ----------------
let ws = null;
function connectWS() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  ws = new WebSocket('ws://localhost:8765');
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    if (statusEl) statusEl.innerText = 'Status: connected to forwarder';
    log('Connected to forwarder WebSocket at ws://localhost:8765');
  };

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'transcript') {
        log(`[TRANSCRIPT] ${msg.text}`);
      } else if (msg.type === 'summary') {
        log(`[SUMMARY]\n${msg.summary}`);
      } else {
        log('Received: ' + ev.data);
      }
    } catch (e) {
      // ignore non-json
    }
  };

  ws.onclose = () => {
    if (statusEl) statusEl.innerText = 'Status: forwarder disconnected';
    log('WebSocket closed');
    // try reconnect after a short delay
    setTimeout(connectWS, 2000);
  };

  ws.onerror = (e) => {
    if (statusEl) statusEl.innerText = 'Status: WS error';
    log('WebSocket error: ' + (e && (e.message || e)));
    console.error(e);
  };
}
connectWS();

// ---------------- Audio capture / streaming ----------------
let audioContext = null;
let sourceNode = null;
let processor = null;
let mediaStream = null;

// helper: convert Float32Array -> Int16Array
function floatTo16BitPCM(float32){
  const l = float32.length;
  const buf = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    buf[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return buf;
}

// Stop capture safely
function stopCaptureFn(){
  try {
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }
    if (processor) { processor.disconnect(); processor.onaudioprocess = null; processor = null; }
    if (sourceNode) { try { sourceNode.disconnect(); } catch(e){} sourceNode = null; }
    if (audioContext) { audioContext.close(); audioContext = null; }
    if (statusEl) statusEl.innerText = 'Status: stopped';
    log('Stopped capture.');
  } catch (err) {
    log('Error stopping capture: ' + ((err && err.message) || err));
    console.error(err);
  }
}

// Wrapper that shows an alert on failure and keeps chooser available
async function startCaptureFromSourceSafe(sourceId) {
  try {
    await startCaptureFromSource(sourceId);
    return true;
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    console.error('startCaptureFromSource failed:', err);
    log('startCaptureFromSource failed: ' + msg);
    alert('Capture failed: ' + msg);
    return false;
  }
}

// Build a small chooser UI listing desktop sources via preload (safe + filtered)
async function buildSourceChooserAndCapture() {
  try {
    if (!window.electronAPI || !window.electronAPI.getDesktopSources) {
      log('Desktop capture API not available. Make sure preload.js is loaded and contextBridge exposes electronAPI.');
      alert('Desktop capture API not available. Restart app or check preload.js.');
      return;
    }

    const sources = await window.electronAPI.getDesktopSources();
    if (!sources || sources.length === 0) {
      log('No desktop sources available.');
      alert('No desktop sources available.');
      return;
    }

    // filter out any source whose name contains mindscribe/electron/devtools to avoid capturing our own window
    const filteredSources = (sources || []).filter(s => {
      const name = String(s.name || '').toLowerCase();
      return !name.includes('mindscribe') && !name.includes('electron') && !name.includes('devtools');
    });
    const listToShow = filteredSources.length ? filteredSources : sources;

    // chooser overlay
    const chooser = document.createElement('div');
    chooser.style.position = 'fixed';
    chooser.style.left = '12px';
    chooser.style.top = '80px';
    chooser.style.background = '#fff';
    chooser.style.border = '1px solid #ddd';
    chooser.style.padding = '8px';
    chooser.style.zIndex = 9999;
    chooser.style.maxHeight = '50vh';
    chooser.style.overflowY = 'auto';
    chooser.style.width = '420px';
    chooser.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)';

    const title = document.createElement('div');
    title.innerText = 'Select source to capture audio from:';
    title.style.fontWeight = '600';
    title.style.marginBottom = '6px';
    chooser.appendChild(title);

    // list sources
    listToShow.forEach(src => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.marginBottom = '6px';

      const name = document.createElement('div');
      name.innerText = src.name || src.id;
      name.style.flex = '1';
      name.style.fontSize = '13px';
      name.style.paddingRight = '8px';

      const btn = document.createElement('button');
      btn.innerText = 'Select';
      btn.onclick = async () => {
        // do NOT immediately remove chooser; keep it until startCaptureFromSource succeeds
        const ok = await startCaptureFromSourceSafe(src.id);
        if (ok) {
          if (chooser.parentElement) chooser.parentElement.removeChild(chooser);
        } else {
          // keep chooser so user can try a different source
        }
      };

      row.appendChild(name);
      row.appendChild(btn);
      chooser.appendChild(row);
    });

    const cancel = document.createElement('button');
    cancel.innerText = 'Cancel';
    cancel.style.marginTop = '6px';
    cancel.onclick = () => { if (chooser.parentElement) chooser.parentElement.removeChild(chooser); };
    chooser.appendChild(cancel);

    document.body.appendChild(chooser);
  } catch (err) {
    log('Error while listing desktop sources: ' + ((err && err.message) || err));
    console.error(err);
    alert('Error while listing desktop sources: ' + ((err && err.message) || err));
  }
}

// start capture for a chosen source id (renderer attempts legacy getUserMedia then falls back to getDisplayMedia)
async function startCaptureFromSource(sourceId) {
  try {
    if (statusEl) statusEl.innerText = 'Status: capturing from selected source...';
    log('Requesting stream for sourceId: ' + sourceId);

    // First try legacy chromeMediaSource constraint (some Electron/Chromium builds accept this)
    let triedLegacy = false;
    try {
      triedLegacy = true;
      const constraints = {
        audio: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId
          }
        },
        video: false
      };
      log('Attempting navigator.mediaDevices.getUserMedia with chromeMediaSource...');
      mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      log('getUserMedia succeeded with chromeMediaSource.');
    } catch (firstErr) {
      log('getUserMedia (chromeMediaSource) failed: ' + ((firstErr && firstErr.message) || firstErr));
      console.warn('getUserMedia (chromeMediaSource) failed:', firstErr);
      // fallback below
    }

    // If legacy failed or returned no audio, try getDisplayMedia fallback
    if (!mediaStream || mediaStream.getAudioTracks().length === 0) {
      if (mediaStream) {
        // stop incomplete stream
        try { mediaStream.getTracks().forEach(t => t.stop()); } catch(e){}
        mediaStream = null;
      }
      try {
        log('Attempting navigator.mediaDevices.getDisplayMedia({ audio:true, video:true }) as fallback...');
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
        if (displayStream && displayStream.getAudioTracks && displayStream.getAudioTracks().length > 0) {
          mediaStream = displayStream;
          log('getDisplayMedia succeeded and returned audio tracks.');
        } else {
          if (displayStream) displayStream.getTracks().forEach(t => t.stop());
          throw new Error('getDisplayMedia returned no audio tracks.');
        }
      } catch (fallbackErr) {
        log('getDisplayMedia fallback failed: ' + ((fallbackErr && fallbackErr.message) || fallbackErr));
        console.error('Both getUserMedia and getDisplayMedia failed:', fallbackErr);
        throw fallbackErr;
      }
    }

    if (!mediaStream) {
      statusEl.innerText = 'Status: capture failed (no stream)';
      log('No mediaStream returned after attempts.');
      throw new Error('No mediaStream returned after attempts.');
    }

    // Create audio context and pipe audio to forwarder
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    } catch (e) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    sourceNode = audioContext.createMediaStreamSource(mediaStream);

    // Use ScriptProcessor to read audio frames
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    sourceNode.connect(processor);

    processor.onaudioprocess = (e) => {
      try {
        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = floatTo16BitPCM(float32);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(int16.buffer);
        }
      } catch (err) {
        console.error('onaudioprocess error', err);
      }
    };

    mediaStream.getTracks().forEach(track => {
      track.onended = () => {
        log('MediaStream track ended');
        stopCaptureFn();
      };
    });

    if (statusEl) statusEl.innerText = 'Status: capturing (streaming...)';
    log('Streaming audio to forwarder...');
  } catch (err) {
    if (statusEl) statusEl.innerText = 'Capture failed: ' + ((err && err.message) || err);
    log('Capture failed: ' + ((err && err.message) || err));
    console.error(err);
    throw err; // bubble up so chooser wrapper alerts user
  }
}

// wire up start/stop buttons
startCapture.onclick = async () => {
  await buildSourceChooserAndCapture();
};
stopCapture.onclick = () => {
  stopCaptureFn();
};

// Expose stop via window for quick dev testing
window.stopCapture = stopCaptureFn;

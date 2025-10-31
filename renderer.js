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
  logEl.innerText = `[${time}] ${msg}\n` + logEl.innerText;
  console.log(msg);
}

// initial UI messages
log('Renderer loaded successfully.');
statusEl.innerText = 'Status: ready';

// basic click handlers
helloBtn.addEventListener('click', () => {
  statusEl.innerText = 'Status: Hello clicked!';
  log('Hello button clicked — renderer working.');
});
devToolsBtn.addEventListener('click', () => {
  log('Open DevTools in main (or press Ctrl+Shift+I).');
});

// ---------------- WebSocket to forwarder ----------------
let ws = null;
function connectWS() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  ws = new WebSocket('ws://localhost:8765');
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    statusEl.innerText = 'Status: connected to forwarder';
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
    statusEl.innerText = 'Status: forwarder disconnected';
    log('WebSocket closed');
    // try reconnect after a short delay
    setTimeout(connectWS, 2000);
  };

  ws.onerror = (e) => {
    statusEl.innerText = 'Status: WS error';
    log('WebSocket error: ' + (e.message || e));
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
    if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
    if (processor) { processor.disconnect(); processor.onaudioprocess = null; processor = null; }
    if (sourceNode) { try { sourceNode.disconnect(); } catch(e){} sourceNode = null; }
    if (audioContext) { audioContext.close(); audioContext = null; }
    statusEl.innerText = 'Status: stopped';
    log('Stopped capture.');
  } catch (err) {
    log('Error stopping capture: ' + err.message || err);
    console.error(err);
  }
}

// Build a small chooser UI listing desktop sources via preload
async function buildSourceChooserAndCapture() {
  try {
    if (!window.electronAPI || !window.electronAPI.getDesktopSources) {
      log('Desktop capture API not available. Make sure preload.js is loaded and contextBridge exposes electronAPI.');
      return;
    }

    const sources = await window.electronAPI.getDesktopSources();
    if (!sources || sources.length === 0) {
      log('No desktop sources available.');
      return;
    }

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
    chooser.style.width = '360px';
    chooser.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)';

    const title = document.createElement('div');
    title.innerText = 'Select source to capture audio from:';
    title.style.fontWeight = '600';
    title.style.marginBottom = '6px';
    chooser.appendChild(title);

    // list sources
    sources.forEach(src => {
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
        try {
          // remove chooser UI
          if (chooser.parentElement) chooser.parentElement.removeChild(chooser);
          await startCaptureFromSource(src.id);
        } catch (err) {
          log('Error starting capture: ' + (err.message || err));
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
    log('Error while listing desktop sources: ' + (err.message || err));
    console.error(err);
  }
}

// start capture for a chosen source id (uses preload API)
async function startCaptureFromSource(sourceId) {
  try {
    statusEl.innerText = 'Status: capturing from selected source...';
    log('Requesting stream for sourceId: ' + sourceId);

    mediaStream = await window.electronAPI.getStreamForSource(sourceId);

    if (!mediaStream) {
      statusEl.innerText = 'Status: capture failed (no stream)';
      log('No mediaStream returned.');
      return;
    }

    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    sourceNode = audioContext.createMediaStreamSource(mediaStream);

    processor = audioContext.createScriptProcessor(4096, 1, 1);
    sourceNode.connect(processor);
    // do not connect processor to destination (avoid echo/playback)
    // processor.connect(audioContext.destination);

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

    // stop automatically if user stops sharing
    mediaStream.getTracks().forEach(track => {
      track.onended = () => {
        stopCaptureFn();
      };
    });

    statusEl.innerText = 'Status: capturing (streaming...)';
    log('Streaming audio to forwarder...');
  } catch (err) {
    statusEl.innerText = 'Capture failed: ' + (err.message || err);
    log('Capture failed: ' + (err.message || err));
    console.error(err);
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

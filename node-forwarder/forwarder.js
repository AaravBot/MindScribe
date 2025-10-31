// forwarder.js
const WebSocket = require('ws');

// WS server for Electron renderer to connect to
const FRONT_PORT = 8765;
const PY_PORT = 8766;

const frontServer = new WebSocket.Server({ port: FRONT_PORT }, () => {
  console.log(`Forwarder: listening for Electron on ws://localhost:${FRONT_PORT}`);
});

// Client socket to Python ASR server (we will connect when Python is available)
let pySocket = null;
function connectToPython() {
  pySocket = new WebSocket(`ws://localhost:${PY_PORT}`);
  pySocket.on('open', () => console.log(`Forwarder: connected to Python ASR on ${PY_PORT}`));
  pySocket.on('message', (msg) => {
    // received JSON from python; forward to all connected front clients
    frontServer.clients.forEach(c => {
      if (c.readyState === WebSocket.OPEN) c.send(msg);
    });
  });
  pySocket.on('close', () => {
    console.log('Forwarder: python socket closed - retrying in 2s');
    setTimeout(connectToPython, 2000);
  });
  pySocket.on('error', (e) => {
    // console.error('pySocket error', e.message);
    setTimeout(() => { /* retry discreetly */ }, 2000);
  });
}
connectToPython();

frontServer.on('connection', (ws) => {
  console.log('Forwarder: renderer connected');
  ws.on('message', (msg) => {
    // binary frames from renderer (Int16Array buffer) -> forward to python
    if (pySocket && pySocket.readyState === WebSocket.OPEN) {
      pySocket.send(msg);
    }
  });
  ws.on('close', () => console.log('Forwarder: renderer disconnected'));
});

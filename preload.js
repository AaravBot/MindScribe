// preload.js — safe bridge: only returns plain serializable desktop source info
const { contextBridge, ipcRenderer } = require('electron');

console.log('PRELOAD: preload.js loaded (ipc)');

contextBridge.exposeInMainWorld('electronAPI', {
  async getDesktopSources() {
    console.log('PRELOAD: getDesktopSources -> invoking main');
    try {
      const sources = await ipcRenderer.invoke('mindscribe-get-sources');
      return (sources || []).map(s => ({
        id: String(s.id),
        name: String(s.name || ''),
        display_id: s.display_id || null
      }));
    } catch (err) {
      console.error('PRELOAD: getDesktopSources error', err && err.stack ? err.stack : err);
      return [];
    }
  }
});


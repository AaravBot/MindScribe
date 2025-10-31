// preload.js — exposes safe desktop capture APIs to renderer
const { contextBridge, desktopCapturer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // returns an array of available sources: {id, name, kind}
  async getDesktopSources() {
    // types: 'window' and 'screen' -> include both
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
    // map to lighter objects we can show in UI
    return sources.map(s => ({ id: s.id, name: s.name, thumbnail: s.thumbnail && s.thumbnail.toDataURL ? s.thumbnail.toDataURL() : null, display_id: s.display_id || null, app: s.appIcon }));
  },

  // get a MediaStream for the given source id
  async getStreamForSource(sourceId) {
    // Electron provides source ids that we can pass to getUserMedia constraints
    // NOTE: audio capture works for screens and some windows (Chrome tab should be captured as a window in many cases)
    try {
      const constraints = {
        audio: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId
          }
        },
        video: false
      };
      // navigator.mediaDevices.getUserMedia works in the renderer context
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      return stream;
    } catch (err) {
      // rethrow to renderer for handling
      throw err;
    }
  }
});

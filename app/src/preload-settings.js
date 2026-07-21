const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('privacySettings', {
  ping: () => true,
  get: () => ipcRenderer.invoke('settings:get'),
  update: (patch) => ipcRenderer.invoke('settings:update', patch),
  completeFirstRun: (presetName) => ipcRenderer.invoke('first-run:complete', presetName),
  getDiagnostics: () => ipcRenderer.invoke('diagnostics:get'),
  exportDiagnostics: () => ipcRenderer.invoke('diagnostics:export'),
  exportSupportBundle: () => ipcRenderer.invoke('diagnostics:export-support'),
  onUpdate: (callback) => {
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on('privacy-settings-updated', listener);
    return () => ipcRenderer.removeListener('privacy-settings-updated', listener);
  }
});

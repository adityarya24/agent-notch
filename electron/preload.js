const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentNotchAPI', {
  setIgnoreMouseEvents: (ignore, options) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore, options);
  },
  getUsageData: () => ipcRenderer.invoke('get-usage-data'),
  triggerHandoff: (modelId) => ipcRenderer.invoke('trigger-handoff', modelId),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setOverlayMode: (mode) => ipcRenderer.invoke('set-overlay-mode', mode),
  probeCli: (bin) => ipcRenderer.invoke('probe-cli', bin),
  suggestCustomClis: () => ipcRenderer.invoke('suggest-custom-clis'),
  onUsageUpdated: (callback) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('usage-updated', subscription);
    return () => ipcRenderer.removeListener('usage-updated', subscription);
  }
});

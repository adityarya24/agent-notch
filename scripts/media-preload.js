const { contextBridge, ipcRenderer } = require('electron');

let state = null;
const listeners = new Set();

ipcRenderer.on('media-state', (_event, next) => {
  state = next;
  for (const listener of listeners) listener(next);
});

contextBridge.exposeInMainWorld('agentNotchAPI', {
  getConfig: async () => state?.config || {},
  getUsageData: async () => state,
  refreshUsageData: async () => state,
  saveConfig: async (config) => {
    state = { ...state, config };
    for (const listener of listeners) listener(state);
    return { success: true, config };
  },
  setOverlayMode: async (mode) => ({ mode }),
  setIgnoreMouseEvents: () => {},
  triggerHandoff: async () => ({ success: false, message: 'Demo fixture' }),
  probeCli: async () => null,
  suggestCustomClis: async () => [],
  onUsageUpdated: (listener) => {
    listeners.add(listener);
    if (state) queueMicrotask(() => listener(state));
    return () => listeners.delete(listener);
  },
  onCollapsedChanged: () => () => {},
  onQuotaAlert: () => () => {}
});

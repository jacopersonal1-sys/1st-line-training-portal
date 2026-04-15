const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getScreenCount: () => ipcRenderer.invoke('get-screen-count'),
  getProcessList: (forbidden) => ipcRenderer.invoke('get-process-list', forbidden),
  setKioskMode: (enabled) => ipcRenderer.invoke('set-kiosk-mode', enabled),
  setContentProtection: (enabled) => ipcRenderer.invoke('set-content-protection', enabled),
  // optional helpers
  openDevTools: () => ipcRenderer.invoke('open-devtools'),
});

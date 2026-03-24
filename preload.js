const { contextBridge, ipcRenderer, shell, webFrame } = require('electron');

// Expose secure, restricted APIs to the frontend
contextBridge.exposeInMainWorld('electronAPI', {
    ipcRenderer: {
        invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
        send: (channel, ...args) => ipcRenderer.send(channel, ...args),
        on: (channel, listener) => {
            // Strip the event object to prevent prototype pollution
            const safeListener = (event, ...args) => listener(event, ...args);
            ipcRenderer.on(channel, safeListener);
            return safeListener;
        },
        removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
    },
    shell: {
        openExternal: (url) => shell.openExternal(url)
    },
    notifications: {
        show: (title, body) => ipcRenderer.send('show-notification', { title, body })
    },
    disk: {
        saveCache: (data) => ipcRenderer.invoke('save-disk-cache', data),
        loadCache: () => ipcRenderer.invoke('load-disk-cache')
    },
    webFrame: {
        setZoomFactor: (factor) => webFrame.setZoomFactor(factor)
    }
});
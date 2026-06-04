const { contextBridge, ipcRenderer, webFrame } = require('electron');

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
    sso: {
        getRedirectUrl: () => ipcRenderer.invoke('get-sso-redirect-url'),
        openAuthWindow: (url) => ipcRenderer.invoke('open-sso-auth-window', url)
    },
    shell: {
        openExternal: (url) => ipcRenderer.invoke('open-external-url', url)
    },
    notifications: {
        show: (title, body) => ipcRenderer.send('show-notification', { title, body })
    },
    disk: {
        saveCache: (data) => ipcRenderer.invoke('save-disk-cache', data),
        loadCache: () => ipcRenderer.invoke('load-disk-cache')
    },
    studyBrowser: {
        clearCache: () => ipcRenderer.invoke('clear-study-browser-cache'),
        openPopout: (payload) => ipcRenderer.invoke('open-study-popout', payload)
    },
    activityMonitor: {
        captureViolationScreenshots: () => ipcRenderer.invoke('capture-violation-screenshots')
    },
    vettingSecurity: {
        getScreenCount: () => ipcRenderer.invoke('get-screen-count'),
        getProcessList: (forbidden) => ipcRenderer.invoke('get-process-list', forbidden),
        setKioskMode: (enabled) => ipcRenderer.invoke('set-kiosk-mode', enabled),
        setContentProtection: (enabled) => ipcRenderer.invoke('set-content-protection', enabled)
    },
    getScreenCount: () => ipcRenderer.invoke('get-screen-count'),
    getProcessList: (forbidden) => ipcRenderer.invoke('get-process-list', forbidden),
    setKioskMode: (enabled) => ipcRenderer.invoke('set-kiosk-mode', enabled),
    setContentProtection: (enabled) => ipcRenderer.invoke('set-content-protection', enabled),
    appWindows: {
        open: (payload) => ipcRenderer.invoke('open-app-window', payload),
        getLaunchPayload: () => ipcRenderer.invoke('get-app-window-launch-payload')
    },
    windowControls: {
        minimize: () => ipcRenderer.send('window-control', 'minimize'),
        maximize: () => ipcRenderer.send('window-control', 'maximize'),
        close: () => ipcRenderer.send('window-control', 'close')
    },
    webFrame: {
        setZoomFactor: (factor) => webFrame.setZoomFactor(factor)
    }
});

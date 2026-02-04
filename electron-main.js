const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

function createWindow() {
    // Create the browser window.
    const mainWindow = new BrowserWindow({
        width: 1920,
        height: 1080,
        title: "1st Line Training Portal",
        icon: path.join(__dirname, 'icon.ico'), // Ensure you have an icon.ico or remove this line
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#1A1410',
            symbolColor: '#e0e0e0',
            height: 60
        },
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false // Needed for some legacy JS interactions
        }
    });

    // Remove the default menu bar (File, Edit, etc.) for a cleaner app look
    mainWindow.setMenuBarVisibility(false);

    // Load your cloud-enabled index.html
    mainWindow.loadFile('index.html');

    // STABILITY FIX: Open external links (target="_blank") in the default system browser
    // This prevents the app from navigating away from the dashboard when clicking study links.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http:') || url.startsWith('https:')) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });

    // NEW: Intercept in-page navigation (clicking links) to open externally
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (url.startsWith('http:') || url.startsWith('https:')) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });

    // AUTO-UPDATE: Check for updates when the window is ready to show
    mainWindow.once('ready-to-show', () => {
        autoUpdater.checkForUpdatesAndNotify();
    });
}

// App Life Cycle
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, we should focus our window.
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        createWindow();
        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// IPC Listener for Manual Update Check
ipcMain.on('manual-update-check', () => {
    autoUpdater.checkForUpdatesAndNotify();
});
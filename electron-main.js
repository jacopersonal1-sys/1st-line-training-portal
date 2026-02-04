const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

// Enable logging for the auto-updater (helps debug "nothing happening")
autoUpdater.logger = console;

let mainWindow; // Define globally so updater events can access it

function createWindow() {
    // Create the browser window.
    mainWindow = new BrowserWindow({
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
    if (!app.isPackaged) {
        // In Dev Mode, just show a message so we know the button works
        if(mainWindow) mainWindow.webContents.send('update-message', { text: '[DEV] Update check triggered', type: 'info' });
    } else {
        // In Production, trigger the actual check
        autoUpdater.checkForUpdates();
    }
});

// IPC Listener for Restart
ipcMain.on('restart-app', () => {
    autoUpdater.quitAndInstall();
});

// --- AUTO-UPDATER EVENTS ---
// Send status updates to the renderer to show in Toasts

autoUpdater.on('checking-for-update', () => {
    if(mainWindow) mainWindow.webContents.send('update-message', { text: 'Checking for updates...', type: 'info' });
});

autoUpdater.on('update-available', (info) => {
    if(mainWindow) mainWindow.webContents.send('update-message', { text: 'Update available. Downloading...', type: 'info' });
});

autoUpdater.on('update-not-available', (info) => {
    if(mainWindow) mainWindow.webContents.send('update-message', { text: 'You are on the latest version.', type: 'success' });
});

autoUpdater.on('error', (err) => {
    if(mainWindow) mainWindow.webContents.send('update-message', { text: 'Update error: ' + (err.message || err), type: 'error' });
});

autoUpdater.on('download-progress', (progressObj) => {
    const log_message = `Downloading update: ${Math.round(progressObj.percent)}%`;
    // Send progress periodically (optional: throttle this if too frequent)
    if(mainWindow) mainWindow.webContents.send('update-message', { text: log_message, type: 'info' });
});

autoUpdater.on('update-downloaded', (info) => {
    if(mainWindow) mainWindow.webContents.send('update-downloaded');
});
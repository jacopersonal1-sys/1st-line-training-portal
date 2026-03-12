const { app, BrowserWindow, shell, ipcMain, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

// Enable logging for the auto-updater (helps debug "nothing happening")
autoUpdater.logger = console;

// SECURITY & SSO: Enable Windows Integrated Auth (NTLM/Kerberos) for SharePoint/Microsoft
app.commandLine.appendSwitch('enable-ntlm-v2');
app.commandLine.appendSwitch('auth-server-whitelist', '*'); // Allow all domains to negotiate auth

// DATA ISOLATION: Separate Dev vs Prod
// This ensures your "Test Version" doesn't use the same LocalStorage/Cache as your "Installed Version".
if (!app.isPackaged) {
    const userDataPath = app.getPath('userData');
    app.setPath('userData', userDataPath + '-Dev');
}

let vettingLockdown = false; // Track lockdown state
let mainWindow; // Define globally so updater events can access it
let updateReady = false; // Track if update is downloaded

function createWindow() {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 1920,
        height: 1080,
        title: app.isPackaged ? "1st Line Training Portal" : "1st Line Training Portal (DEV MODE)",
        icon: path.join(__dirname, 'ico.ico'), // Updated to new icon file
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#1A1410',
            symbolColor: '#e0e0e0',
            height: 35
        },
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false, // Needed for some legacy JS interactions
            webviewTag: true, // ENABLED: Required for SharePoint/External Reference Viewer
            devTools: true // ENABLED: Required for Super Admin access (Shortcuts blocked below)
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

    // SECURITY: Block DevTools shortcuts & Context Menu in Production
    if (app.isPackaged) {
        mainWindow.webContents.on('before-input-event', (event, input) => {
            if (input.control && input.shift && input.key.toLowerCase() === 'i') {
                event.preventDefault();
            }
            if (input.key === 'F12') {
                event.preventDefault();
            }
        });
        
        mainWindow.webContents.on('context-menu', (e) => {
            e.preventDefault();
        });
    }

    // SECURITY: Prevent closing during Vetting Lockdown
    mainWindow.on('close', (e) => {
        if (vettingLockdown) {
            e.preventDefault(); // Block closing
        }
    });
}

// App Life Cycle
const gotTheLock = app.requestSingleInstanceLock();

// SECURITY: Enforce Single Instance Lock in Production (Trainees)
// We allow multiple instances in Dev Mode (!app.isPackaged) for testing.
if (!gotTheLock && app.isPackaged) {
    app.quit();
} else {
    app.on('second-instance', () => {
        // Someone tried to run a second instance, we should focus our window.
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

// IPC Listener for Version
ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

// IPC Listener for Update Status (Check on Load)
ipcMain.handle('get-update-status', () => {
    return updateReady;
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

// IPC Listener for Force Restart (Remote Command)
ipcMain.on('force-restart', () => {
    app.relaunch();
    app.exit(0);
});

// IPC Listener for Update Channel (Staging vs Prod)
ipcMain.on('set-update-channel', (event, channel) => {
    const isStaging = (channel === 'staging');
    if (autoUpdater.allowPrerelease !== isStaging) {
        console.log(`Update Channel switched to: ${isStaging ? 'Staging (Pre-release)' : 'Production'}`);
        autoUpdater.allowPrerelease = isStaging;
        // Trigger a fresh check immediately if we just switched modes
        autoUpdater.checkForUpdatesAndNotify();
    }
});

// IPC Listener for DevTools (Super Admin Only)
ipcMain.on('open-devtools', () => {
    if (mainWindow) mainWindow.webContents.openDevTools();
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
    updateReady = true;
    if(mainWindow) mainWindow.webContents.send('update-downloaded');
});

// --- VETTING ARENA SECURITY IPC ---

ipcMain.handle('get-screen-count', () => {
    const displays = screen.getAllDisplays();
    return displays.length;
});

ipcMain.handle('set-kiosk-mode', (event, enable) => {
    vettingLockdown = enable; // Set lock state
    if (mainWindow) {
        mainWindow.setKiosk(enable);
        mainWindow.setAlwaysOnTop(enable, 'screen-saver'); // Force top
        mainWindow.setClosable(!enable); // Disable close button if enabled
    }
    return true;
});

ipcMain.handle('set-content-protection', (event, enable) => {
    if (mainWindow) {
        // Prevents screenshots/recording on Windows/macOS
        mainWindow.setContentProtection(enable);
    }
    return true;
});

ipcMain.handle('get-process-list', async (event, customTargets) => {
    return new Promise((resolve) => {
        // Windows command to list running apps
        const cmd = process.platform === 'win32' 
            ? 'tasklist /v /fi "STATUS eq RUNNING" /fo csv /nh' 
            : 'ps -e -o comm='; // Linux/Mac fallback

        exec(cmd, (err, stdout, stderr) => {
            if (err) {
                resolve(["Error fetching processes"]);
                return;
            }
            // Simple parsing for Windows CSV
            const targets = (customTargets && Array.isArray(customTargets) && customTargets.length > 0) 
            ? customTargets.map(t => t.toLowerCase())
            : [
                'chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'safari', 
                'waterfox', 'tor', 'duckduckgo', 'maxthon', 'seamonkey', 'avast', 'yandex',
                'whatsapp'
            ];
            const counts = {};
            
            const lines = stdout.split('\r\n')
                .map(l => {
                    // CSV Parse: Handle quotes properly
                    const parts = l.split('","');
                    if (parts.length < 1) return null;
                    // Clean first and last quotes if present
                    const name = parts[0].replace(/^"/, '');
                    // Window Title is usually the last column (Index 8 in /v)
                    // But splitting by "," might be fragile if title has commas.
                    // Robust approach: tasklist /v CSV usually has 9 columns.
                    const title = parts.length >= 9 ? parts[8].replace(/"$/, '') : "N/A";
                    return { name, title };
                })
                .filter(l => l);
            
            lines.forEach(proc => {
                const lowerName = proc.name.toLowerCase();
                const lowerTitle = proc.title ? proc.title.toLowerCase() : "n/a";
                
                // EXCEPTION: Allow WebView2 (Teams) and Updaters
                if (lowerName.includes('webview') || lowerName.includes('update') || lowerName.includes('teams') || lowerName.includes('msteams')) return;

                // EXCEPTION: Ignore Background Processes (No Window Title)
                // "N/A" is the standard tasklist output for processes without a window
                if (lowerTitle === 'n/a' || lowerTitle === '') return;

                targets.forEach(t => {
                    if (lowerName.includes(t)) {
                        counts[t] = (counts[t] || 0) + 1;
                    }
                });
            });

            const result = Object.keys(counts).map(k => {
                return `${k} (${counts[k]})`;
            });
            
            resolve(result);
        });
    });
});

// --- NETWORK DIAGNOSTICS IPC ---

ipcMain.handle('perform-network-test', async (event, target) => {
    return new Promise((resolve) => {
        // Windows uses -n, Linux/Mac uses -c. Timeout 1000ms.
        const cmd = process.platform === 'win32' 
            ? `ping -n 1 -w 1000 ${target}` 
            : `ping -c 1 -W 1 ${target}`;
            
        const start = Date.now();
        exec(cmd, (error, stdout, stderr) => {
            const duration = Date.now() - start;
            if (error) {
                resolve({ success: false, time: null, output: stderr || error.message });
            } else {
                // Attempt to parse actual time from stdout for precision
                let time = duration;
                // Windows: "time=14ms" or "time<1ms"
                const match = stdout.match(/time[=<]([\d\.]+)ms/);
                if (match) time = parseFloat(match[1]);
                
                resolve({ success: true, time: time });
            }
        });
    });
});

ipcMain.handle('get-system-stats', async () => {
    const cpus = os.cpus();
    const load = cpus.reduce((acc, cpu) => {
        const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
        const idle = cpu.times.idle;
        return acc + ((total - idle) / total);
    }, 0) / cpus.length;

    let connectionType = 'Unknown';
    const nets = os.networkInterfaces();
    
    // Heuristic to detect active interface type
    for (const name of Object.keys(nets)) {
        const lower = name.toLowerCase();
        // Skip internal/loopback
        if (nets[name].some(net => !net.internal && net.family === 'IPv4')) {
            if (lower.includes('wi-fi') || lower.includes('wireless') || lower.includes('wlan')) connectionType = 'Wireless';
            else if (lower.includes('ethernet') || lower.includes('eth')) connectionType = 'Ethernet';
        }
    }

    // Basic Disk Check (Windows C:)
    // Uses 'wmic' which is standard on Windows. Safe to fail silently on others.
    let diskUsage = "N/A";
    if (process.platform === 'win32') {
        try {
            const { execSync } = require('child_process');
            // Get Size and FreeSpace for C:
            const output = execSync('wmic logicaldisk where "DeviceID=\'C:\'" get Size,FreeSpace /value', { timeout: 500, encoding: 'utf8' });
            const sizeMatch = output.match(/Size=(\d+)/);
            const freeMatch = output.match(/FreeSpace=(\d+)/);
            if (sizeMatch && freeMatch) {
                const total = parseInt(sizeMatch[1]);
                const free = parseInt(freeMatch[1]);
                const usedPct = Math.round(((total - free) / total) * 100);
                diskUsage = `${usedPct}% (C:)`;
            }
        } catch(e) {}
    }

    return {
        cpu: (load * 100).toFixed(1),
        ram: ((os.totalmem() - os.freemem()) / 1024 / 1024 / 1024).toFixed(2), // GB Used
        ramTotal: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2), // GB Total
        connType: connectionType,
        disk: diskUsage
    };
});

// --- ACTIVE WINDOW TRACKING (Activity Monitor) ---
ipcMain.handle('get-active-window', async () => {
    return new Promise((resolve) => {
        if (process.platform === 'win32') {
            // PowerShell script to get Foreground Window Title and Process Name
            const cmd = `powershell -NoProfile -Command "try { $code = '[DllImport(\\\"user32.dll\\\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\\\"user32.dll\\\")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);'; $type = Add-Type -MemberDefinition $code -Name Win32 -Namespace Win32 -PassThru; $hwnd = $type::GetForegroundWindow(); $pidOut = 0; $type::GetWindowThreadProcessId($hwnd, [ref]$pidOut) | Out-Null; $p = Get-Process -Id $pidOut; if ($p.MainWindowTitle) { $p.MainWindowTitle + ' [' + $p.ProcessName + ']' } else { $p.ProcessName } } catch { 'Unknown External App' }"`;
            
            exec(cmd, (err, stdout, stderr) => {
                if (err) {
                    resolve("External Activity (Unknown)");
                } else {
                    resolve(stdout.trim() || "External Activity");
                }
            });
        } else {
            resolve("External Activity (OS Not Supported)");
        }
    });
});
const { app, BrowserWindow, shell, ipcMain, screen, powerMonitor, Menu, MenuItem, Notification, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');

// Enable logging for the auto-updater (helps debug "nothing happening")
autoUpdater.logger = console;

// SECURITY & SSO: Enable Windows Integrated Auth (NTLM/Kerberos) for SharePoint/Microsoft
app.commandLine.appendSwitch('enable-ntlm-v2');
app.commandLine.appendSwitch('auth-server-whitelist', '*'); // Allow all domains to negotiate auth

// DATA ISOLATION: Separate Dev vs Prod
// This ensures your "Test Version" doesn't use the same LocalStorage/Cache as your "Installed Version".
if (!app.isPackaged) {
    const currentPath = app.getPath('userData');
    if (!currentPath.includes('-Dev')) {
        app.setPath('userData', currentPath + '-Dev');
    }
}

const gotTheLock = app.requestSingleInstanceLock();

let vettingLockdown = false; // Track lockdown state
let mainWindow; // Define globally so updater events can access it
let updateReady = false; // Track if update is downloaded
let studySessionConfigured = false;
let isFlushingStudySession = false;
const STUDY_SESSION_PARTITION = 'persist:study_session';
const STUDY_BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0';

function isTrustedStudyUrl(rawUrl = '') {
    try {
        const parsed = new URL(rawUrl);
        const host = parsed.hostname.toLowerCase();
        return [
            'sharepoint.com',
            'microsoftonline.com',
            'office.com',
            'officeapps.live.com',
            'live.com',
            'onedrive.com',
            'herotel.com',
            'qcontact.com',
            'preseem.com',
            'genially.com'
        ].some(domain => host === domain || host.endsWith(`.${domain}`));
    } catch (error) {
        return false;
    }
}

function configureStudySession() {
    if (studySessionConfigured) return;

    const studySession = session.fromPartition(STUDY_SESSION_PARTITION);

    studySession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
        if (!requestingOrigin || !isTrustedStudyUrl(requestingOrigin)) return false;
        return ['clipboard-read', 'clipboard-sanitized-write', 'clipboard-write', 'fullscreen', 'notifications', 'media'].includes(permission);
    });

    studySession.setPermissionRequestHandler((webContents, permission, callback, details) => {
        const origin = details?.requestingUrl || details?.embeddingOrigin || '';
        const isAllowed = isTrustedStudyUrl(origin) && ['clipboard-read', 'clipboard-sanitized-write', 'clipboard-write', 'fullscreen', 'notifications', 'media'].includes(permission);
        callback(isAllowed);
    });

    studySession.webRequest.onBeforeSendHeaders((details, callback) => {
        if (isTrustedStudyUrl(details.url)) {
            details.requestHeaders['User-Agent'] = STUDY_BROWSER_USER_AGENT;
        }
        callback({ requestHeaders: details.requestHeaders });
    });

    studySessionConfigured = true;
}

async function flushStudySession() {
    if (isFlushingStudySession) return;
    isFlushingStudySession = true;

    try {
        const studySession = session.fromPartition(STUDY_SESSION_PARTITION);
        if (studySession?.cookies?.flushStore) {
            await studySession.cookies.flushStore();
        }
        if (studySession?.flushStorageData) {
            studySession.flushStorageData();
        }
    } catch (error) {
        console.error('Study session flush failed:', error);
    } finally {
        isFlushingStudySession = false;
    }
}

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
            nodeIntegration: false,
            contextIsolation: true, // SECURED: Protects from RCE attacks
            preload: path.join(__dirname, 'preload.js'),
            backgroundThrottling: false, // SHIELD: Prevents CPU throttling when app is minimized
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

    // SECURITY: Block DevTools shortcuts in Production
    if (app.isPackaged) {
        mainWindow.webContents.on('before-input-event', (event, input) => {
            if (input.control && input.shift && input.key.toLowerCase() === 'i') {
                event.preventDefault();
            }
            if (input.key === 'F12') {
                event.preventDefault();
            }
        });
    }

    // CUSTOM CONTEXT MENU: Spellcheck & Copy/Paste Support
    mainWindow.webContents.on('context-menu', (event, params) => {
        event.preventDefault();
        
        const menu = new Menu();
        let hasItems = false;

        // 1. Spellcheck Suggestions
        if (params.dictionarySuggestions && params.dictionarySuggestions.length > 0) {
            for (const suggestion of params.dictionarySuggestions) {
                menu.append(new MenuItem({
                    label: suggestion,
                    click: () => mainWindow.webContents.replaceMisspelling(suggestion)
                }));
            }
            menu.append(new MenuItem({ type: 'separator' }));
            hasItems = true;
        }

        // 2. Add to Dictionary
        if (params.misspelledWord) {
            menu.append(new MenuItem({
                label: `Add "${params.misspelledWord}" to Dictionary`,
                click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
            }));
            menu.append(new MenuItem({ type: 'separator' }));
            hasItems = true;
        }

        // 3. Basic Text Editing
        if (params.isEditable) {
            menu.append(new MenuItem({ role: 'undo' }));
            menu.append(new MenuItem({ role: 'redo' }));
            menu.append(new MenuItem({ type: 'separator' }));
            menu.append(new MenuItem({ role: 'cut' }));
            menu.append(new MenuItem({ role: 'copy' }));
            menu.append(new MenuItem({ role: 'paste' }));
            menu.append(new MenuItem({ role: 'selectAll' }));
            hasItems = true;
        } else if (params.selectionText && params.selectionText.trim().length > 0) {
            menu.append(new MenuItem({ role: 'copy' }));
            hasItems = true;
        }

        // 4. DevTools (Only if NOT packaged)
        if (!app.isPackaged) {
            if (hasItems) menu.append(new MenuItem({ type: 'separator' }));
            menu.append(new MenuItem({
                label: 'Inspect Element',
                click: () => mainWindow.webContents.inspectElement(params.x, params.y)
            }));
            hasItems = true;
        }

        if (hasItems) {
            menu.popup({ window: mainWindow, x: params.x, y: params.y });
        }
    });

    let isSafeToQuit = false;
    // SECURITY & SAFE QUIT: Prevent closing during lockdown or data sync
    mainWindow.on('close', (e) => {
        if (vettingLockdown) {
            e.preventDefault(); // Block closing
            return;
        }
        if (!isSafeToQuit) {
            e.preventDefault();
            if (mainWindow) mainWindow.webContents.send('force-final-sync');
            // Failsafe: force close after 3 seconds if network is hung
            setTimeout(() => {
                isSafeToQuit = true;
                app.quit();
            }, 3000);
        }
    });

    ipcMain.on('final-sync-complete', () => {
        isSafeToQuit = true;
        app.quit();
    });
}

// NEW: Catch Webview Window Spawns at OS Level (Fix for PDF Links)
app.on('web-contents-created', (event, contents) => {
    if (contents.getType() === 'webview') {
        contents.setWindowOpenHandler(({ url }) => {
            if (mainWindow) {
                mainWindow.webContents.send('webview-new-window', url);
            }
            return { action: 'deny' }; // Prevent the external Electron window from opening
        });
    }
});

// App Life Cycle

// SECURITY: Enforce Single Instance Lock in Production (Trainees)
// We allow multiple instances in Dev Mode (!app.isPackaged) for testing.
if (!gotTheLock) {
    if (!app.isPackaged) {
        // MULTI-INSTANCE TESTING FIX:
        // Relaunch the clone with a completely isolated storage directory.
        const clonePath = app.getPath('userData') + '-Clone-' + Date.now();
        app.relaunch({ args: process.argv.slice(1).concat([`--user-data-dir=${clonePath}`]) });
        app.exit(0);
    } else {
        // Production behavior: only one instance allowed
        app.quit();
    }
} else {
    
    // --- AUTO-CLEANUP (Runs only on the Main Instance) ---
    // FIX: Ensure clones don't delete their own data folders!
    if (!app.isPackaged && !app.getPath('userData').includes('-Dev-Clone-')) {
        try {
            const fs = require('fs');
            const baseDir = path.dirname(app.getPath('userData'));
            fs.readdirSync(baseDir).forEach(f => {
                if (f.includes('-Dev-Clone-')) {
                    fs.rm(path.join(baseDir, f), { recursive: true, force: true }, () => {});
                }
            });
        } catch(e) { console.error("Clone cleanup error:", e); }
    }

    app.on('second-instance', () => {
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        configureStudySession();
        createWindow();

        // SHIELD: Hardware Wake/Resume Triggers (The "Sleep Mode" Fix)
        powerMonitor.on('resume', () => {
            if (mainWindow) mainWindow.webContents.send('os-resume');
        });
        powerMonitor.on('unlock-screen', () => {
            if (mainWindow) mainWindow.webContents.send('os-resume');
        });

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });
}

app.on('before-quit', (event) => {
    if (!isFlushingStudySession) {
        event.preventDefault();
        flushStudySession().finally(() => {
            app.quit();
        });
    }
});

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

// IPC Listener for System Idle Time (Activity Monitor)
ipcMain.handle('get-system-idle-time', () => {
    return powerMonitor.getSystemIdleTime();
});

// --- AI API PROXY (CORS FIX) ---
ipcMain.handle('invoke-gemini-api', async (event, { endpoint, apiKey, promptText }) => {
    try {
        // Use global fetch available in Electron's main process
        const response = await fetch(`${endpoint}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }],
                generationConfig: { temperature: 0.2 }
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: { message: `API request failed with status: ${response.status}` } }));
            return { error: errorData.error.message };
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "No insights generated.";
        return { text };

    } catch (e) {
        console.error("Main Process AI Fetch Error:", e);
        return { error: e.message || "A network error occurred in the main process." };
    }
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
        // OPTIMIZATION: tasklist /v is extremely slow (2-10s).
        // Using PowerShell Get-Process with MainWindowHandle natively filters out background tasks in ~100ms.
        const cmd = process.platform === 'win32' 
            ? 'powershell -NoProfile -Command "Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -ExpandProperty Name"' 
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
            
            const lines = stdout.split('\n').map(l => l.trim()).filter(l => l);
            
            lines.forEach(name => {
                const lowerName = name.toLowerCase();
                
                // EXCEPTION: Allow WebView2 (Teams), Updaters, and the Windows Snipping Tool
                if (
                    lowerName.includes('webview') ||
                    lowerName.includes('update') ||
                    lowerName.includes('teams') ||
                    lowerName.includes('msteams') ||
                    lowerName.includes('snippingtool') ||
                    lowerName.includes('screen sketch')
                ) return;

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

// --- HIGH-PERFORMANCE BACKGROUND POLLER ---
let activityMonitorInterval = null;

ipcMain.on('start-activity-monitor', (event) => {
    if (activityMonitorInterval) clearInterval(activityMonitorInterval);
    
    activityMonitorInterval = setInterval(() => {
        if (!mainWindow) return;
        const osIdleSeconds = powerMonitor.getSystemIdleTime();
        
        if (process.platform === 'win32') {
            const cmd = `powershell -NoProfile -Command "try { $code = '[DllImport(\\\"user32.dll\\\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\\\"user32.dll\\\")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);'; $type = Add-Type -MemberDefinition $code -Name Win32 -Namespace Win32 -PassThru; $hwnd = $type::GetForegroundWindow(); $pidOut = 0; $type::GetWindowThreadProcessId($hwnd, [ref]$pidOut) | Out-Null; $p = Get-Process -Id $pidOut; if ($p.MainWindowTitle) { $p.MainWindowTitle + ' [' + $p.ProcessName + ']' } else { $p.ProcessName } } catch { 'Unknown External App' }"`;
            
            exec(cmd, (err, stdout) => {
                const activeWindow = err ? "External Activity (Unknown)" : (stdout.trim() || "External Activity");
                mainWindow.webContents.send('activity-update', { osIdleSeconds, activeWindow });
            });
        } else {
            mainWindow.webContents.send('activity-update', { osIdleSeconds, activeWindow: "External Activity (OS Not Supported)" });
        }
    }, 5000);
});

ipcMain.on('stop-activity-monitor', () => {
    if (activityMonitorInterval) {
        clearInterval(activityMonitorInterval);
        activityMonitorInterval = null;
    }
});

// --- NATIVE OS NOTIFICATIONS ---
ipcMain.on('show-notification', (event, { title, body }) => {
    if (Notification.isSupported()) {
        const notif = new Notification({
            title: title,
            body: body,
            icon: path.join(__dirname, 'ico.ico')
        });
        notif.on('click', () => {
            if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.focus();
            }
        });
        notif.show();
    }
});

// --- NATIVE DISK CACHE (Infinite Storage / Auto-Backup) ---
ipcMain.handle('save-disk-cache', async (event, jsonData) => {
    try {
        const cachePath = path.join(app.getPath('userData'), 'native_cache.json');
        // Write asynchronously to prevent blocking the main thread
        await fs.promises.writeFile(cachePath, jsonData, 'utf8');
        return true;
    } catch(e) {
        console.error("Disk Cache Save Error:", e);
        return false;
    }
});

ipcMain.handle('load-disk-cache', async (event) => {
    try {
        const cachePath = path.join(app.getPath('userData'), 'native_cache.json');
        if (fs.existsSync(cachePath)) {
            return await fs.promises.readFile(cachePath, 'utf8');
        }
        return null;
    } catch(e) { return null; }
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

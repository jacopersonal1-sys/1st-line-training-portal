const { app, BrowserWindow, shell, ipcMain, screen, powerMonitor, Menu, MenuItem, Notification, session, desktopCapturer } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');
const nodemailer = require('nodemailer');

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
let updateCheckInProgress = false;
let queuedUpdateCheck = false;
let latestYmlRetryTimer = null;
let latestYmlRetryAttempts = 0;
let suppressNextLatestYmlErrorToast = false;
let studySessionConfigured = false;
let isFlushingStudySession = false;
let isSafeToQuit = false;
let isScreenLocked = false;
const studyPopoutWindows = new Set();
const appPopoutWindows = new Set();
const appWindowLaunchPayloads = new Map();
const STUDY_SESSION_PARTITION = 'persist:study_session';
const STUDY_BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0';
const UPDATE_RETRY_DELAY_MS = 15000;
const UPDATE_MAX_RETRY_ATTEMPTS = 2;
const UPDATE_FEED_CONFIG = {
    provider: 'github',
    owner: 'jacopersonal1-sys',
    repo: '1st-line-training-portal'
};
const SSO_CALLBACK_URL = 'first-line-training://auth/callback';

Menu.setApplicationMenu(null);

autoUpdater.allowPrerelease = false;

function isLatestYmlMissingError(err) {
    const text = String(err && (err.message || err.stack || err) || '').toLowerCase();
    return text.includes('cannot find latest.yml') || (text.includes('latest.yml') && text.includes('404'));
}

function applyMainUpdateFeed() {
    if (!app.isPackaged) return;
    try {
        autoUpdater.allowPrerelease = false;
        autoUpdater.setFeedURL({ ...UPDATE_FEED_CONFIG, releaseType: 'release' });
    } catch (error) {
        console.error('Failed to apply updater feed:', error);
    }
}

function resetLatestYmlRetryState() {
    latestYmlRetryAttempts = 0;
    suppressNextLatestYmlErrorToast = false;
    if (latestYmlRetryTimer) {
        clearTimeout(latestYmlRetryTimer);
        latestYmlRetryTimer = null;
    }
}

async function runUpdateCheck(options = {}) {
    const isRetry = !!options.isRetry;
    if (!isRetry) latestYmlRetryAttempts = 0;
    applyMainUpdateFeed();

    if (!app.isPackaged) {
        if (mainWindow) {
            mainWindow.webContents.send('update-message', { text: '[DEV] Main update check triggered', type: 'info' });
        }
        return;
    }

    if (updateCheckInProgress) {
        queuedUpdateCheck = true;
        if (mainWindow) {
            mainWindow.webContents.send('update-message', { text: 'An update check is already running. Queued another check...', type: 'info' });
        }
        return;
    }

    updateCheckInProgress = true;
    try {
        await autoUpdater.checkForUpdates();
    } catch (err) {
        // Error toasts/retries are handled in the shared `error` listener below.
    } finally {
        updateCheckInProgress = false;
        if (queuedUpdateCheck) {
            queuedUpdateCheck = false;
            setTimeout(() => { runUpdateCheck(); }, 350);
        }
    }
}

function isSsoCallbackUrl(rawUrl) {
    const url = String(rawUrl || '').trim();
    return !!url && url.toLowerCase().startsWith(SSO_CALLBACK_URL);
}

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

function isCpanelCompatibilityUrl(rawUrl = '') {
    try {
        const parsed = new URL(rawUrl);
        const host = parsed.hostname.toLowerCase();
        const port = String(parsed.port || '').trim();
        const pathName = String(parsed.pathname || '').toLowerCase();
        return (
            host === 'cp1.herotel.com' ||
            host === 'cp2.herotel.com' ||
            (host.endsWith('.herotel.com') && (
                pathName.includes('/cpsess') ||
                pathName.includes('/cpanel') ||
                pathName.includes('/webmail') ||
                pathName.includes('/xfercpanel') ||
                ['2082', '2083', '2086', '2087', '2095', '2096'].includes(port)
            ))
        );
    } catch (error) {
        return false;
    }
}

function isCpanelTransferUrl(rawUrl = '') {
    try {
        const parsed = new URL(rawUrl);
        return parsed.pathname.toLowerCase().includes('/xfercpanel');
    } catch (error) {
        return false;
    }
}

function getStudyChildWindowOptions(parentWindow) {
    return {
        width: 1380,
        height: 900,
        minWidth: 900,
        minHeight: 560,
        parent: parentWindow || undefined,
        modal: false,
        show: true,
        title: 'Study Browser',
        icon: path.join(__dirname, 'ico.ico'),
        backgroundColor: '#ffffff',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            partition: STUDY_SESSION_PARTITION,
            backgroundThrottling: false,
            webviewTag: false,
            devTools: !app.isPackaged
        }
    };
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

async function clearStudyBrowserCache() {
    const studySession = session.fromPartition(STUDY_SESSION_PARTITION);
    if (!studySession) return false;

    try {
        // Clear all web storage/cookies tied to the in-app study browser partition.
        await studySession.clearStorageData({
            storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
        });
        await studySession.clearCache();
        if (typeof studySession.clearAuthCache === 'function') {
            await studySession.clearAuthCache();
        }
        await flushStudySession();
        return true;
    } catch (error) {
        console.error('Study browser cache clear failed:', error);
        return false;
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
        runUpdateCheck();
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

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

function buildStudyPopoutHtml({ url, title, kind }) {
    const safeUrl = escapeAttr(url);
    const safeTitle = escapeHtml(title || 'Study Material');
    const safeKind = escapeHtml(kind === 'notes' ? 'Study Notes' : 'Study Material');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <style>
    :root {
      color-scheme: dark;
      --primary: #f37021;
      --bg-app: #121212;
      --bg-card: #1e1e1e;
      --bg-input: #252525;
      --text-main: #e8e8e8;
      --text-muted: #a8a8a8;
      --border-color: rgba(255,255,255,0.1);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background: var(--bg-app);
      color: var(--text-main);
      font-family: Inter, "Segoe UI", Tahoma, sans-serif;
      border: 1px solid var(--border-color);
    }
    .popout-shell {
      height: 100vh;
      display: flex;
      flex-direction: column;
      min-height: 0;
      background:
        radial-gradient(circle at top right, rgba(243,112,33,0.14), transparent 30%),
        var(--bg-app);
    }
    .popout-titlebar {
      height: 42px;
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 12px;
      padding: 0 8px 0 14px;
      border-bottom: 1px solid var(--border-color);
      background: rgba(0,0,0,0.22);
      -webkit-app-region: drag;
      user-select: none;
      flex: 0 0 auto;
    }
    .popout-title {
      min-width: 0;
      display: flex;
      align-items: baseline;
      gap: 10px;
      overflow: hidden;
    }
    .popout-title strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.92rem;
    }
    .popout-title span {
      color: var(--primary);
      font-size: 0.72rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0;
      flex: 0 0 auto;
    }
    .popout-window-controls {
      display: flex;
      align-items: center;
      gap: 4px;
      -webkit-app-region: no-drag;
    }
    .popout-window-controls button {
      width: 38px;
      height: 30px;
      display: grid;
      place-items: center;
      border: 1px solid transparent;
      border-radius: 8px;
      background: transparent;
      color: var(--text-main);
      cursor: pointer;
      font-size: 15px;
      line-height: 1;
    }
    .popout-window-controls button:hover {
      background: var(--bg-input);
      border-color: var(--border-color);
    }
    .popout-window-controls button.close:hover {
      background: #c42b1c;
      border-color: #c42b1c;
      color: white;
    }
    .popout-browser-controls {
      height: 44px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      border-bottom: 1px solid var(--border-color);
      background: rgba(0,0,0,0.12);
      flex: 0 0 auto;
    }
    .popout-browser-controls button {
      min-width: 36px;
      height: 30px;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      background: var(--bg-card);
      color: var(--text-main);
      cursor: pointer;
    }
    .popout-browser-controls button:hover {
      border-color: rgba(243,112,33,0.55);
      color: var(--primary);
    }
    .popout-url {
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-muted);
      border: 1px solid var(--border-color);
      border-radius: 999px;
      background: var(--bg-input);
      padding: 6px 12px;
      font-size: 0.78rem;
    }
    webview {
      flex: 1 1 auto;
      width: 100%;
      min-height: 0;
      border: 0;
      background: white;
    }
  </style>
</head>
<body>
  <div class="popout-shell">
    <header class="popout-titlebar">
      <div class="popout-title">
        <span>${safeKind}</span>
        <strong id="popout-title">${safeTitle}</strong>
      </div>
      <div class="popout-window-controls">
        <button type="button" onclick="window.electronAPI.windowControls.minimize()" title="Minimize">−</button>
        <button type="button" onclick="window.electronAPI.windowControls.maximize()" title="Maximize">□</button>
        <button type="button" class="close" onclick="window.electronAPI.windowControls.close()" title="Close">×</button>
      </div>
    </header>
    <div class="popout-browser-controls">
      <button type="button" id="back" title="Back">←</button>
      <button type="button" id="forward" title="Forward">→</button>
      <button type="button" id="reload" title="Reload">↻</button>
      <div class="popout-url" id="url-label">${safeUrl}</div>
    </div>
    <webview id="popout-webview" src="${safeUrl}" partition="${STUDY_SESSION_PARTITION}" allowpopups useragent="${STUDY_BROWSER_USER_AGENT}"></webview>
  </div>
  <script>
    const webview = document.getElementById('popout-webview');
    const title = document.getElementById('popout-title');
    const urlLabel = document.getElementById('url-label');
    const back = document.getElementById('back');
    const forward = document.getElementById('forward');
    const isCpanelUrl = (url) => {
      try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        const port = String(parsed.port || '').trim();
        const pathName = String(parsed.pathname || '').toLowerCase();
        return host === 'cp1.herotel.com' ||
          host === 'cp2.herotel.com' ||
          (host.endsWith('.herotel.com') && (
            pathName.includes('/cpsess') ||
            pathName.includes('/cpanel') ||
            pathName.includes('/webmail') ||
            pathName.includes('/xfercpanel') ||
            ['2082', '2083', '2086', '2087', '2095', '2096'].includes(port)
          ));
      } catch (error) {
        return false;
      }
    };
    const updateNav = () => {
      try {
        back.disabled = !webview.canGoBack();
        forward.disabled = !webview.canGoForward();
        const liveUrl = webview.getURL();
        if (liveUrl) urlLabel.textContent = liveUrl;
      } catch (error) {}
    };
    back.onclick = () => { try { if (webview.canGoBack()) webview.goBack(); } catch (error) {} };
    forward.onclick = () => { try { if (webview.canGoForward()) webview.goForward(); } catch (error) {} };
    reload.onclick = () => { try { webview.reload(); } catch (error) {} };
    webview.addEventListener('page-title-updated', (event) => {
      title.textContent = event.title || '${safeTitle}';
      document.title = event.title || '${safeTitle}';
    });
    webview.addEventListener('did-navigate', updateNav);
    webview.addEventListener('did-navigate-in-page', updateNav);
    webview.addEventListener('did-stop-loading', updateNav);
    webview.addEventListener('new-window', (event) => {
      event.preventDefault();
      if (event.url) webview.loadURL(event.url);
    });
    updateNav();
  </script>
</body>
</html>`;
}

function openStudyPopoutWindow(payload = {}) {
    const rawUrl = String(payload.url || '').trim();
    if (!rawUrl) throw new Error('No study URL supplied.');

    const popout = new BrowserWindow({
        width: payload.kind === 'notes' ? 1260 : 1380,
        height: payload.kind === 'notes' ? 860 : 900,
        minWidth: 900,
        minHeight: 560,
        title: payload.title || 'Study Material',
        icon: path.join(__dirname, 'ico.ico'),
        frame: false,
        backgroundColor: '#121212',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            backgroundThrottling: false,
            webviewTag: true,
            devTools: !app.isPackaged
        }
    });

    studyPopoutWindows.add(popout);
    popout.on('closed', () => {
        studyPopoutWindows.delete(popout);
    });

    popout.setMenuBarVisibility(false);
    popout.webContents.setWindowOpenHandler(({ url }) => {
        if (isCpanelTransferUrl(url)) {
            return {
                action: 'allow',
                overrideBrowserWindowOptions: getStudyChildWindowOptions(popout)
            };
        }
        if (url && (url.startsWith('http:') || url.startsWith('https:'))) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'deny' };
    });

    const html = buildStudyPopoutHtml({
        url: rawUrl,
        title: payload.title || 'Study Material',
        kind: payload.kind || 'study-material'
    });
    popout.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
    return true;
}

function openSsoAuthWindow(rawUrl = '') {
    const startUrl = String(rawUrl || '').trim();
    if (!/^https?:\/\//i.test(startUrl)) {
        return Promise.reject(new Error('Invalid Microsoft sign-in URL.'));
    }

    return new Promise((resolve, reject) => {
        let settled = false;
        const authWindow = new BrowserWindow({
            width: 560,
            height: 720,
            minWidth: 460,
            minHeight: 560,
            title: 'Microsoft Sign In',
            icon: path.join(__dirname, 'ico.ico'),
            parent: mainWindow || undefined,
            modal: false,
            show: true,
            backgroundColor: '#111827',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                partition: STUDY_SESSION_PARTITION,
                backgroundThrottling: false,
                devTools: !app.isPackaged
            }
        });

        const finish = (callbackUrl) => {
            if (settled) return;
            settled = true;
            resolve(callbackUrl);
            if (!authWindow.isDestroyed()) authWindow.close();
        };

        const fail = (error) => {
            if (settled) return;
            settled = true;
            reject(error instanceof Error ? error : new Error(String(error || 'Microsoft sign-in failed.')));
            if (!authWindow.isDestroyed()) authWindow.close();
        };

        const inspectNavigation = (event, url) => {
            if (!url) return;
            if (isSsoCallbackUrl(url)) {
                if (event && typeof event.preventDefault === 'function') event.preventDefault();
                finish(url);
                return;
            }
            if (!/^https?:\/\//i.test(url)) {
                if (event && typeof event.preventDefault === 'function') event.preventDefault();
            }
        };

        authWindow.setMenuBarVisibility(false);
        authWindow.webContents.setUserAgent(STUDY_BROWSER_USER_AGENT);
        authWindow.webContents.on('will-navigate', inspectNavigation);
        authWindow.webContents.on('will-redirect', inspectNavigation);
        authWindow.webContents.on('did-start-navigation', inspectNavigation);
        authWindow.webContents.setWindowOpenHandler(({ url }) => {
            if (isSsoCallbackUrl(url)) {
                finish(url);
                return { action: 'deny' };
            }
            if (/^https?:\/\//i.test(String(url || ''))) {
                authWindow.loadURL(url).catch(fail);
            }
            return { action: 'deny' };
        });
        authWindow.on('closed', () => {
            if (!settled) fail(new Error('Microsoft sign-in window was closed before login completed.'));
        });
        authWindow.loadURL(startUrl).catch(fail);
    });
}

function createAppWindowLaunchToken(payload = {}) {
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    appWindowLaunchPayloads.set(token, {
        ...payload,
        launchedAt: new Date().toISOString()
    });
    return token;
}

function getLaunchTokenFromWebContents(contents) {
    try {
        const currentUrl = contents && typeof contents.getURL === 'function' ? contents.getURL() : '';
        if (!currentUrl) return '';
        const parsed = new URL(currentUrl);
        return String(parsed.searchParams.get('app_window_token') || '').trim();
    } catch (error) {
        return '';
    }
}

function isMainAppSender(contents) {
    return !!(mainWindow && contents && !mainWindow.isDestroyed() && contents === mainWindow.webContents);
}

function openAppWindow(payload = {}) {
    const mode = String(payload.mode || 'tab').trim().toLowerCase();
    const user = payload.user && typeof payload.user === 'object' ? payload.user : null;
    const actor = payload.actor && typeof payload.actor === 'object' ? payload.actor : user;
    const actorRole = String(actor && actor.role || '').trim().toLowerCase();
    const tabId = String(payload.tabId || '').trim();

    if (!user || !user.user) throw new Error('No app user supplied.');
    if (actorRole !== 'super_admin') throw new Error('Only Super Admin can open app windows.');
    if (mode === 'tab' && !tabId) throw new Error('No app tab supplied.');

    const token = createAppWindowLaunchToken({
        mode,
        user,
        tabId,
        title: payload.title || (mode === 'impersonate' ? `Impersonating ${user.user}` : 'App Window')
    });

    const child = new BrowserWindow({
        width: mode === 'impersonate' ? 1500 : 1440,
        height: mode === 'impersonate' ? 930 : 900,
        minWidth: 980,
        minHeight: 640,
        title: payload.title || '1st Line Training Portal',
        icon: path.join(__dirname, 'ico.ico'),
        frame: false,
        backgroundColor: '#121212',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            backgroundThrottling: false,
            webviewTag: true,
            devTools: !app.isPackaged
        }
    });

    appPopoutWindows.add(child);
    child.on('closed', () => {
        appPopoutWindows.delete(child);
        appWindowLaunchPayloads.delete(token);
    });
    child.setMenuBarVisibility(false);
    child.webContents.setWindowOpenHandler(({ url }) => {
        if (url && (url.startsWith('http:') || url.startsWith('https:'))) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });
    child.webContents.on('will-navigate', (event, url) => {
        if (url && (url.startsWith('http:') || url.startsWith('https:'))) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });

    child.loadFile('index.html', { query: { app_window_token: token } });
    return true;
}

function normalizePingTarget(rawTarget) {
    const target = String(rawTarget || '').trim();
    if (!target || target.length > 253) return '';
    if (/[^a-zA-Z0-9.-]/.test(target)) return '';
    if (target.includes('..') || target.startsWith('.') || target.endsWith('.')) return '';

    const isIpv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(target);
    if (isIpv4) {
        const parts = target.split('.').map(Number);
        return parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255) ? target : '';
    }

    const labels = target.split('.');
    const isHostname = labels.every(label => (
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)
    ));
    return isHostname ? target : '';
}

// NEW: Catch Webview Window Spawns at OS Level (Fix for PDF Links)
app.on('web-contents-created', (event, contents) => {
    if (contents.getType() === 'webview') {
        contents.setWindowOpenHandler(({ url }) => {
            const ownerWindow = BrowserWindow.fromWebContents(contents.hostWebContents || contents);
            if (isCpanelTransferUrl(url)) {
                return {
                    action: 'allow',
                    overrideBrowserWindowOptions: getStudyChildWindowOptions(ownerWindow || mainWindow)
                };
            }
            if (ownerWindow && studyPopoutWindows.has(ownerWindow)) {
                if (url) shell.openExternal(url);
                return { action: 'deny' };
            }
            if (mainWindow) {
                mainWindow.webContents.send('webview-new-window', url);
            }
            return { action: 'deny' }; // Prevent the external Electron window from opening
        });
        contents.on('did-create-window', (childWindow, details) => {
            if (!childWindow || !isCpanelTransferUrl(details?.url || '')) return;
            childWindow.setMenuBarVisibility(false);
            childWindow.webContents.setWindowOpenHandler(({ url }) => {
                if (isCpanelTransferUrl(url)) {
                    return {
                        action: 'allow',
                        overrideBrowserWindowOptions: getStudyChildWindowOptions(childWindow)
                    };
                }
                if (url && (url.startsWith('http:') || url.startsWith('https:'))) {
                    shell.openExternal(url);
                }
                return { action: 'deny' };
            });
        });
    }
});

ipcMain.handle('open-study-popout', async (event, payload) => {
    openStudyPopoutWindow(payload);
    return true;
});

ipcMain.handle('open-app-window', async (event, payload) => {
    if (!isMainAppSender(event.sender)) {
        throw new Error('App windows can only be opened from the main app window.');
    }
    openAppWindow(payload);
    return true;
});

ipcMain.handle('get-app-window-launch-payload', async (event) => {
    const token = getLaunchTokenFromWebContents(event.sender);
    if (!token) return null;
    return appWindowLaunchPayloads.get(token) || null;
});

ipcMain.handle('open-external-url', async (event, rawUrl) => {
    const url = String(rawUrl || '').trim();
    if (!/^(https?:\/\/|mailto:)/i.test(url)) return false;
    await shell.openExternal(url);
    return true;
});

ipcMain.handle('send-course-request-email', async (event, payload) => {
    const recipients = Array.isArray(payload && payload.to)
        ? payload.to.map(item => String(item || '').trim()).filter(item => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item))
        : [];
    const subject = String((payload && payload.subject) || '').trim().slice(0, 220);
    const body = String((payload && payload.body) || '').trim().slice(0, 8000);

    if (!recipients.length || !subject || !body) {
        return { success: false, error: 'Missing email recipients, subject, or body.' };
    }

    const smtp = payload && payload.smtp && typeof payload.smtp === 'object' ? payload.smtp : null;
    const smtpHost = String((smtp && smtp.host) || '').trim();
    const smtpUser = String((smtp && smtp.user) || '').trim();
    const smtpPass = String((smtp && smtp.pass) || '').trim();
    const smtpFrom = String((smtp && smtp.from) || smtpUser || '').trim();
    const smtpPort = Math.max(1, Math.min(65535, Number((smtp && smtp.port) || 587)));

    if (smtpHost && smtpUser && smtpPass && smtpFrom) {
        try {
            const transporter = nodemailer.createTransport({
                host: smtpHost,
                port: smtpPort,
                secure: smtp && smtp.secure === true,
                auth: { user: smtpUser, pass: smtpPass }
            });
            await transporter.sendMail({
                from: smtpFrom,
                to: recipients.join(', '),
                subject,
                text: body
            });
            return { success: true, method: 'smtp' };
        } catch (error) {
            return { success: false, error: error.message || 'SMTP send failed.' };
        }
    }

    if (os.platform() !== 'win32') {
        return { success: false, error: 'Automatic Outlook send is only available on Windows.' };
    }

    const json = Buffer.from(JSON.stringify({ to: recipients, subject, body }), 'utf8').toString('base64');
    const script = `
        $ErrorActionPreference = 'Stop'
        $payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${json}')) | ConvertFrom-Json
        $outlook = New-Object -ComObject Outlook.Application
        $mail = $outlook.CreateItem(0)
        $mail.To = (@($payload.to) -join ';')
        $mail.Subject = [string]$payload.subject
        $mail.Body = [string]$payload.body
        $mail.Send()
    `;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');

    return await new Promise((resolve) => {
        exec(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, { timeout: 30000 }, (error) => {
            if (error) {
                resolve({ success: false, error: error.message || 'Outlook send failed.' });
                return;
            }
            resolve({ success: true, method: 'outlook' });
        });
    });
});

ipcMain.on('window-control', (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (action === 'minimize') {
        win.minimize();
    } else if (action === 'maximize') {
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
    } else if (action === 'close') {
        win.close();
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

    app.on('second-instance', (event, commandLine) => {
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
        powerMonitor.on('lock-screen', () => {
            isScreenLocked = true;
            if (mainWindow) {
                mainWindow.webContents.send('activity-update', {
                    osIdleSeconds: powerMonitor.getSystemIdleTime(),
                    activeWindow: 'Lock Idle',
                    isScreenLocked: true
                });
            }
        });
        powerMonitor.on('unlock-screen', () => {
            isScreenLocked = false;
            if (mainWindow) mainWindow.webContents.send('os-resume');
        });

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });
}

let studySessionFlushed = false;
app.on('before-quit', (event) => {
    if (!studySessionFlushed) {
        event.preventDefault();
        flushStudySession().finally(() => {
            studySessionFlushed = true;
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
    return {
        ready: updateReady
    };
});

ipcMain.handle('get-sso-redirect-url', async () => {
    return SSO_CALLBACK_URL;
});

ipcMain.handle('open-sso-auth-window', async (event, url) => {
    return await openSsoAuthWindow(url);
});

// IPC Listener for Manual Update Check
ipcMain.on('manual-update-check', () => {
    runUpdateCheck();
});

// IPC Listener for Restart
ipcMain.on('restart-app', () => {
    isSafeToQuit = true;
    autoUpdater.quitAndInstall();
});

// IPC Listener for Force Restart (Remote Command)
ipcMain.on('force-restart', () => {
    app.relaunch();
    app.exit(0);
});

// IPC Listener for DevTools (Super Admin Only)
ipcMain.on('open-devtools', () => {
    if (app.isPackaged) return;
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
    resetLatestYmlRetryState();
    if(mainWindow) mainWindow.webContents.send('update-message', { text: 'Update available. Downloading in the background...', type: 'info' });
});

autoUpdater.on('update-not-available', (info) => {
    resetLatestYmlRetryState();
    if(mainWindow) mainWindow.webContents.send('update-message', { text: 'No update found. You are on the latest version.', type: 'success' });
});

autoUpdater.on('error', (err) => {
    if (!mainWindow) return;

    if (suppressNextLatestYmlErrorToast && isLatestYmlMissingError(err)) {
        suppressNextLatestYmlErrorToast = false;
        return;
    }

    if (isLatestYmlMissingError(err) && latestYmlRetryAttempts < UPDATE_MAX_RETRY_ATTEMPTS) {
        latestYmlRetryAttempts += 1;
        mainWindow.webContents.send('update-message', {
            text: `Update metadata is still publishing. Retrying in ${Math.round(UPDATE_RETRY_DELAY_MS / 1000)}s (${latestYmlRetryAttempts}/${UPDATE_MAX_RETRY_ATTEMPTS})...`,
            type: 'info'
        });

        if (latestYmlRetryTimer) {
            clearTimeout(latestYmlRetryTimer);
            latestYmlRetryTimer = null;
        }

        latestYmlRetryTimer = setTimeout(() => {
            latestYmlRetryTimer = null;
            suppressNextLatestYmlErrorToast = true;
            runUpdateCheck({ isRetry: true });
        }, UPDATE_RETRY_DELAY_MS);
        return;
    }

    if (isLatestYmlMissingError(err)) {
        mainWindow.webContents.send('update-message', {
            text: 'Update metadata is not available on GitHub yet. Please retry in 1-2 minutes.',
            type: 'error'
        });
        return;
    }

    mainWindow.webContents.send('update-message', { text: 'Update error: ' + (err.message || err), type: 'error' });
});

autoUpdater.on('download-progress', (progressObj) => {
    const log_message = `Downloading update: ${Math.round(progressObj.percent)}%`;
    // Send progress periodically (optional: throttle this if too frequent)
    if(mainWindow) mainWindow.webContents.send('update-message', { text: log_message, type: 'info' });
});

autoUpdater.on('update-downloaded', (info) => {
    resetLatestYmlRetryState();
    updateReady = true;
    if(mainWindow) mainWindow.webContents.send('update-downloaded', {});
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
    const safeTarget = normalizePingTarget(target);
    if (!safeTarget) {
        return { success: false, time: null, output: 'Invalid network test target.' };
    }
    return new Promise((resolve) => {
        // Windows uses -n, Linux/Mac uses -c. Timeout 1000ms.
        const cmd = process.platform === 'win32'
            ? `ping -n 1 -w 1000 ${safeTarget}`
            : `ping -c 1 -W 1 ${safeTarget}`;
            
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
        if (isScreenLocked) {
            mainWindow.webContents.send('activity-update', { osIdleSeconds, activeWindow: 'Lock Idle', isScreenLocked: true });
            return;
        }
        if (mainWindow.isFocused()) {
            mainWindow.webContents.send('activity-update', { osIdleSeconds, activeWindow: '1st Line Training Portal [electron]' });
            return;
        }
        
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

ipcMain.handle('capture-violation-screenshots', async () => {
    const displays = screen.getAllDisplays();
    const maxWidth = Math.max(1280, ...displays.map(display => Math.ceil(display.size?.width || 0)));
    const maxHeight = Math.max(720, ...displays.map(display => Math.ceil(display.size?.height || 0)));
    const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: maxWidth, height: maxHeight }
    });

    const screenshots = sources.map((source, index) => {
        const image = source.thumbnail;
        const jpeg = image && !image.isEmpty() ? image.toJPEG(72) : Buffer.alloc(0);
        return {
            name: source.name || `Screen ${index + 1}`,
            displayId: source.display_id || '',
            width: image?.getSize?.().width || 0,
            height: image?.getSize?.().height || 0,
            mime: 'image/jpeg',
            data: jpeg.toString('base64')
        };
    }).filter(item => item.data);

    return {
        capturedAt: new Date().toISOString(),
        screenCount: screenshots.length,
        screenshots
    };
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
async function writeNativeCacheAtomically(cachePath, jsonData) {
    const tmpPath = `${cachePath}.tmp-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    const bakPath = `${cachePath}.bak`;
    let movedToBackup = false;

    try {
        await fs.promises.writeFile(tmpPath, jsonData, 'utf8');

        if (fs.existsSync(cachePath)) {
            try { await fs.promises.unlink(bakPath); } catch (e) {}
            await fs.promises.rename(cachePath, bakPath);
            movedToBackup = true;
        }

        await fs.promises.rename(tmpPath, cachePath);
        if (movedToBackup) {
            try { await fs.promises.unlink(bakPath); } catch (e) {}
        }
        return true;
    } catch (error) {
        try { await fs.promises.unlink(tmpPath); } catch (e) {}
        if (movedToBackup && !fs.existsSync(cachePath)) {
            try { await fs.promises.rename(bakPath, cachePath); } catch (e) {}
        }
        throw error;
    }
}

async function readValidatedCacheFile(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const raw = await fs.promises.readFile(filePath, 'utf8');
    JSON.parse(raw);
    return raw;
}

ipcMain.handle('save-disk-cache', async (event, jsonData) => {
    try {
        const cachePath = path.join(app.getPath('userData'), 'native_cache.json');
        const payload = typeof jsonData === 'string' ? jsonData : JSON.stringify(jsonData || {});
        await writeNativeCacheAtomically(cachePath, payload);
        return true;
    } catch(e) {
        console.error("Disk Cache Save Error:", e);
        return false;
    }
});

ipcMain.handle('load-disk-cache', async (event) => {
    try {
        const cachePath = path.join(app.getPath('userData'), 'native_cache.json');
        const backupPath = `${cachePath}.bak`;

        try {
            const primary = await readValidatedCacheFile(cachePath);
            if (primary) return primary;
        } catch (e) {
            console.warn('Primary native cache file is invalid JSON. Attempting backup restore.');
        }

        try {
            const backup = await readValidatedCacheFile(backupPath);
            if (backup) {
                await writeNativeCacheAtomically(cachePath, backup);
                return backup;
            }
        } catch (e) {
            console.warn('Backup native cache file is invalid JSON.');
        }

        return null;
    } catch(e) { return null; }
});

ipcMain.handle('clear-study-browser-cache', async () => {
    return await clearStudyBrowserCache();
});

// --- ACTIVE WINDOW TRACKING (Activity Monitor) ---
ipcMain.handle('get-active-window', async () => {
    return new Promise((resolve) => {
        if (mainWindow && mainWindow.isFocused()) {
            resolve('1st Line Training Portal [electron]');
            return;
        }
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

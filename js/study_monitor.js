/* ================= STUDY MONITOR & ACTIVITY TRACKER ================= */
/* Handles the internal Study Window and tracks user activity/productivity */

const StudyMonitor = {
    currentActivity: "Idle",
    startTime: Date.now(),
    history: [],
    syncInterval: null,
    clickCount: 0, // New: Track clicks
    isStudyOpen: false,
    activeWebview: null,
    viewMode: 'list', // 'list' or 'summary'
    monitorScope: 'scheduled', // 'scheduled' or 'all'
    monitorSearch: '',
    monitorGroupFilter: '',
    pendingTopic: null, // For classification modal
    activityPoller: null, // Track the interval for global activity monitoring
    queueSelection: new Set(), // Persist selections across refreshes
    violationReviewSelection: new Set(),
    cachedWhitelist: [], // Cache for performance
    lastSyncedPayload: null, // OPTIMIZATION: Track last sync to prevent duplicate pushes
    pendingViolationPrompt: null,
    currentViolationReportId: null,
    studyEngagementPoller: null,
    lastStudyEngagementAt: 0,
    lastStudyProbeSnapshot: null,
    // --- NEW: Tabbed Browser State ---
    browserState: {
        tabs: [],
        activeTabId: null,
        homeUrl: null,
    },
    localPageCacheKey: 'study_page_cache_v1',
    maxLocalPageCacheEntries: 60,
    tabCounter: 0,
    lastSpawnedLink: null,
    studyNotesDockOpen: false,
    studyNotesPopup: null,

    readLocalJson: function(key, fallback) {
        if (typeof safeLocalParse === 'function') return safeLocalParse(key, fallback);
        try {
            const raw = localStorage.getItem(key);
            if (raw === null || raw === undefined || raw === 'undefined') return fallback;
            return JSON.parse(raw);
        } catch (error) {
            return fallback;
        }
    },

    buildTabId: function() {
        this.tabCounter += 1;
        return `tab-${Date.now()}-${this.tabCounter}`;
    },

    loadLocalPageCache: function() {
        const cache = this.readLocalJson(this.localPageCacheKey, {});
        return cache && typeof cache === 'object' && !Array.isArray(cache) ? cache : {};
    },

    saveLocalPageCache: function(cache) {
        try {
            localStorage.setItem(this.localPageCacheKey, JSON.stringify(cache || {}));
        } catch (e) {
            console.warn('Study page cache save skipped:', e);
        }
    },

    getStudyCacheKey: function(url) {
        try {
            const normalized = this.cleanUrl(url);
            const parsed = new URL(normalized, window.location.href);
            if (!['http:', 'https:'].includes(parsed.protocol)) return '';
            return `${parsed.origin}${parsed.pathname}`.toLowerCase();
        } catch (e) {
            return String(url || '').trim().toLowerCase();
        }
    },

    getCachedStudyPage: function(url) {
        const cache = this.loadLocalPageCache();
        const key = this.getStudyCacheKey(url);
        if (key && cache[key]) return cache[key];

        const normalizedUrl = String(url || '').trim().toLowerCase();
        if (!normalizedUrl) return null;
        const fallback = Object.values(cache).find(entry => String((entry && entry.sourceUrl) || '').toLowerCase() === normalizedUrl);
        return fallback || null;
    },

    buildCachedStudyDocument: function(cachedPage, failedUrl, errorDescription) {
        const pageTitle = this.escapeHtml((cachedPage && cachedPage.title) || 'Cached Study Page');
        const sourceUrl = this.escapeHtml((cachedPage && cachedPage.sourceUrl) || failedUrl || '');
        const reason = this.escapeHtml(errorDescription || 'Network unavailable');
        const updatedAt = (cachedPage && cachedPage.updatedAt)
            ? this.escapeHtml(new Date(cachedPage.updatedAt).toLocaleString())
            : 'Unknown';
        const snippet = this.escapeHtml((cachedPage && cachedPage.snippet) || 'No cached preview text is available for this page yet.');

        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle} (Cached)</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, sans-serif;
      background: #0d1117;
      color: #e6edf3;
      line-height: 1.55;
      padding: 28px 20px;
    }
    .card {
      max-width: 980px;
      margin: 0 auto;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 22px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
    }
    h1 { margin: 0 0 10px 0; font-size: 1.3rem; }
    .meta { color: #9fb0c1; font-size: 0.9rem; margin-bottom: 14px; }
    .warn {
      border-left: 4px solid #f59e0b;
      background: rgba(245, 158, 11, 0.12);
      color: #fde68a;
      padding: 10px 12px;
      border-radius: 8px;
      margin: 0 0 16px 0;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: "Segoe UI", Tahoma, sans-serif;
    }
    .source {
      margin-top: 14px;
      color: #9fb0c1;
      font-size: 0.85rem;
      word-break: break-all;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>${pageTitle} (Cached Copy)</h1>
    <div class="meta">Cached locally: ${updatedAt}</div>
    <div class="warn">Live page could not load (${reason}). You are viewing the latest local cached copy.</div>
    <pre>${snippet}</pre>
    <div class="source">Source URL: ${sourceUrl}</div>
  </div>
</body>
</html>`;
    },

    cacheStudyPageLocally: function(tab) {
        const webview = tab?.webview;
        const liveUrl = (webview && typeof webview.getURL === 'function') ? webview.getURL() : tab?.url;
        const pageUrl = String(liveUrl || tab?.url || '').trim();
        if (!webview || !webview.isConnected || !pageUrl) return;
        if (pageUrl.startsWith('data:')) return;
        const cacheKey = this.getStudyCacheKey(pageUrl);
        if (!cacheKey) return;

        // Keep the payload compact to avoid localStorage bloat.
        const snapshotScript = `
            (function() {
                try {
                    const title = (document.title || '').trim().slice(0, 200);
                    const text = ((document.body && document.body.innerText) || '')
                        .replace(/\\s+/g, ' ')
                        .trim()
                        .slice(0, 12000);
                    return { title: title, text: text };
                } catch (e) {
                    return { title: '', text: '' };
                }
            })();
        `;

        webview.executeJavaScript(snapshotScript, true).then((snapshot) => {
            const cache = this.loadLocalPageCache();
            cache[cacheKey] = {
                key: cacheKey,
                sourceUrl: pageUrl,
                title: (snapshot && snapshot.title) ? snapshot.title : (tab.title || 'Study Page'),
                snippet: (snapshot && snapshot.text) ? snapshot.text : '',
                updatedAt: new Date().toISOString()
            };

            const entries = Object.entries(cache).sort((a, b) => {
                const aTime = new Date((a[1] && a[1].updatedAt) || 0).getTime();
                const bTime = new Date((b[1] && b[1].updatedAt) || 0).getTime();
                return bTime - aTime;
            });
            const trimmed = entries.slice(0, this.maxLocalPageCacheEntries);
            const compact = {};
            trimmed.forEach(([urlKey, payload]) => { compact[urlKey] = payload; });
            this.saveLocalPageCache(compact);
        }).catch(() => {
            // Ignore capture failures for protected pages.
        });
    },

    handleSpawnedStudyUrl: function(url, title = "New Tab") {
        if (!url) return;
        const now = Date.now();
        const normalizedUrl = String(url).trim();

        if (
            this.lastSpawnedLink &&
            this.lastSpawnedLink.url === normalizedUrl &&
            (now - this.lastSpawnedLink.time) < 800
        ) {
            return;
        }

        this.lastSpawnedLink = { url: normalizedUrl, time: now };

        if (this.isStudyBrowserUrl(normalizedUrl)) {
            const activeTab = this.getActiveTab();
            const activeUrl = String(activeTab?.url || '').trim();
            if (
                activeTab?.webview &&
                activeTab.webview.isConnected &&
                this.isCpanelCompatibilityUrl(activeUrl) &&
                this.isCpanelCompatibilityUrl(normalizedUrl)
            ) {
                activeTab.usedCachedFallback = false;
                activeTab.url = this.cleanUrl(normalizedUrl);
                activeTab.webview.loadURL(activeTab.url).catch(() => {
                    this.addTab(normalizedUrl, title, true);
                });
                return;
            }
            this.addTab(normalizedUrl, title, true);
        } else {
            this.openExternalUrl(normalizedUrl);
        }
    },

    isStudyBrowserUrl: function(url) {
        try {
            const parsed = new URL(url, window.location.href);
            return ['http:', 'https:', 'blob:', 'data:'].includes(parsed.protocol);
        } catch (e) {
            return false;
        }
    },

    isMicrosoftAuthUrl: function(url) {
        try {
            const parsed = new URL(url, window.location.href);
            const host = parsed.hostname.toLowerCase();
            return host.includes('login.microsoftonline.com') ||
                host.includes('microsoftonline.com') ||
                host.includes('office.com') ||
                host.includes('sharepoint.com') ||
                host.includes('onedrive.com');
        } catch (e) {
            return false;
        }
    },

    isCpanelCompatibilityUrl: function(url) {
        try {
            const parsed = new URL(url, window.location.href);
            const host = parsed.hostname.toLowerCase();
            const port = String(parsed.port || '').trim();
            const path = String(parsed.pathname || '').toLowerCase();
            return (
                host === 'cp1.herotel.com' ||
                host === 'cp2.herotel.com' ||
                (host.endsWith('.herotel.com') && (
                    path.includes('/cpsess') ||
                    path.includes('/cpanel') ||
                    path.includes('/webmail') ||
                    path.includes('/xfercpanel') ||
                    ['2082', '2083', '2086', '2087', '2095', '2096'].includes(port)
                ))
            );
        } catch (e) {
            return false;
        }
    },

    isCpanelTransferUrl: function(url) {
        try {
            const parsed = new URL(url, window.location.href);
            return parsed.pathname.toLowerCase().includes('/xfercpanel');
        } catch (e) {
            return false;
        }
    },

    getCpanelSafeEntryUrl: function(url) {
        try {
            const parsed = new URL(url, window.location.href);
            return `${parsed.protocol}//${parsed.host}/`;
        } catch (e) {
            return 'https://cp1.herotel.com:2087/';
        }
    },

    openCpanelInSystemBrowser: function(url) {
        if (!url) return;
        this.openExternalUrl(url);
        this.track('Study Tool: Hosting/cPanel/Webmail (System Browser)');
        if (typeof showToast === 'function') {
            showToast('Opening cPanel/Webmail in your normal browser for compatibility.', 'info');
        }
    },

    openExternalUrl: function(url) {
        const targetUrl = String(url || '').trim();
        if (!targetUrl) return;
        const openViaBridge = window.electronAPI?.shell?.openExternal;
        if (typeof openViaBridge === 'function') {
            openViaBridge(targetUrl).catch((e) => {
                console.warn("External open failed:", e);
                window.open(targetUrl, '_blank', 'noopener');
            });
            return;
        }
        window.open(targetUrl, '_blank', 'noopener');
    },

    isWebviewReady: function(webview) {
        return Boolean(webview && webview.isConnected && webview.dataset && webview.dataset.navReady === '1');
    },

    getSafeWebviewNavState: function(tabOrWebview) {
        const webview = tabOrWebview?.webview || tabOrWebview;
        const cachedBack = Boolean(tabOrWebview?.canGoBackCached);
        const cachedForward = Boolean(tabOrWebview?.canGoForwardCached);

        if (!this.isWebviewReady(webview)) {
            return { ready: false, canGoBack: false, canGoForward: false };
        }

        try {
            return {
                ready: true,
                canGoBack: webview && typeof webview.canGoBack === 'function' ? Boolean(webview.canGoBack()) : cachedBack,
                canGoForward: webview && typeof webview.canGoForward === 'function' ? Boolean(webview.canGoForward()) : cachedForward
            };
        } catch (error) {
            return { ready: true, canGoBack: cachedBack, canGoForward: cachedForward };
        }
    },

    refreshTabNavigationState: function(tab, retryCount = 0) {
        if (!tab || !tab.webview) return;

        const webview = tab.webview;
        if (!this.isWebviewReady(webview)) return;

        try {
            tab.canGoBackCached = Boolean(webview.canGoBack());
            tab.canGoForwardCached = Boolean(webview.canGoForward());
            if (tab.id === this.browserState.activeTabId) {
                this.updateBrowserChrome();
            }
        } catch (error) {
            if (retryCount < 3) {
                setTimeout(() => this.refreshTabNavigationState(tab, retryCount + 1), 150);
            }
        }
    },

    invokeActiveWebviewAction: function(action, options = {}) {
        const activeTab = this.browserState.tabs.find(t => t.id === this.browserState.activeTabId);
        const webview = activeTab?.webview;
        if (!webview || !webview.isConnected) return;

        const { fallbackUrl = null } = options;
        try {
            if (action === 'goBack') {
                if (activeTab?.canGoBackCached) webview.goBack();
            } else if (action === 'goForward') {
                if (activeTab?.canGoForwardCached) webview.goForward();
            } else if (action === 'reload') {
                webview.reload();
            } else if (action === 'home' && fallbackUrl) {
                webview.loadURL(fallbackUrl);
            }
        } catch (error) {
            console.warn(`Study browser action failed: ${action}`, error);
        } finally {
            setTimeout(() => this.refreshTabNavigationState(activeTab), 100);
        }
    },

    updateBrowserChrome: function() {
        const activeTab = this.browserState.tabs.find(t => t.id === this.browserState.activeTabId) || null;
        this.activeWebview = activeTab ? activeTab.webview : null;
        const navState = this.getSafeWebviewNavState(activeTab);

        const titleEl = document.getElementById('study-current-title');
        if (titleEl) {
            titleEl.textContent = activeTab?.title || 'Secure Study Browser';
            titleEl.title = activeTab?.url || 'Secure Study Browser';
        }

        const backBtn = document.getElementById('study-nav-back');
        const forwardBtn = document.getElementById('study-nav-forward');
        const reloadBtn = document.getElementById('study-nav-reload');
        const homeBtn = document.getElementById('study-nav-home');
        const hasWebview = Boolean(this.activeWebview);

        if (backBtn) backBtn.disabled = !navState.ready || !navState.canGoBack;
        if (forwardBtn) forwardBtn.disabled = !navState.ready || !navState.canGoForward;
        if (reloadBtn) reloadBtn.disabled = !hasWebview;
        if (homeBtn) homeBtn.disabled = !hasWebview || !this.browserState.homeUrl;
    },

    getStudyNotesModuleUrl: function(embedded = true) {
        const basePath = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
        const params = new URLSearchParams();
        params.set('embedded', embedded ? '1' : '0');
        if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.user) {
            try {
                params.set('user', JSON.stringify({ user: CURRENT_USER.user, role: CURRENT_USER.role || 'trainee' }));
            } catch (error) {}
        }
        return `${basePath}/modules/study_notes/index.html?${params.toString()}`;
    },

    canOpenStudyNotes: function(silent = false) {
        if (typeof window.canOpenStudyNotesNow === 'function') {
            return window.canOpenStudyNotesNow({ silent: !!silent });
        }
        return { allowed: true };
    },

    ensureStudyNotesDockFrame: function() {
        const frame = document.getElementById('study-notes-dock-frame');
        if (!frame) return null;
        const targetUrl = this.getStudyNotesModuleUrl(true);
        if (!frame.src || frame.src.indexOf('/modules/study_notes/index.html') === -1) {
            frame.src = targetUrl;
        }
        return frame;
    },

    refreshStudyNotesDock: function() {
        const frame = document.getElementById('study-notes-dock-frame');
        if (!frame) return;
        try {
            if (
                frame.contentWindow &&
                frame.contentWindow.StudyNotesWorkspace &&
                typeof frame.contentWindow.StudyNotesWorkspace.refresh === 'function'
            ) {
                frame.contentWindow.StudyNotesWorkspace.refresh();
            }
        } catch (error) {}
    },

    toggleStudyNotesDock: function(forceOpen = null) {
        const gate = this.canOpenStudyNotes(false);
        if (!gate.allowed) {
            this.closeStudyNotesDock();
            return false;
        }

        const shell = document.getElementById('study-browser-shell');
        const dock = document.getElementById('study-notes-dock');
        const toggleBtn = document.getElementById('study-notes-toggle-btn');
        if (!shell || !dock) return false;

        const currentlyOpen = !dock.classList.contains('hidden');
        const open = (forceOpen === null || forceOpen === undefined) ? !currentlyOpen : !!forceOpen;

        if (open) {
            this.ensureStudyNotesDockFrame();
            dock.classList.remove('hidden');
            shell.classList.add('study-notes-open');
            this.studyNotesDockOpen = true;
            if (toggleBtn) {
                toggleBtn.classList.add('active');
                toggleBtn.innerHTML = '<i class="fas fa-note-sticky"></i> Hide Notes';
            }
            this.refreshStudyNotesDock();
            this.track('Study Tool: Study Notes (Docked)');
            return true;
        }

        this.closeStudyNotesDock();
        return true;
    },

    closeStudyNotesDock: function() {
        const shell = document.getElementById('study-browser-shell');
        const dock = document.getElementById('study-notes-dock');
        const toggleBtn = document.getElementById('study-notes-toggle-btn');
        if (dock) dock.classList.add('hidden');
        if (shell) shell.classList.remove('study-notes-open');
        this.studyNotesDockOpen = false;
        if (toggleBtn) {
            toggleBtn.classList.remove('active');
            toggleBtn.innerHTML = '<i class="fas fa-note-sticky"></i> Study Notes';
        }
    },

    openStudyNotesPopout: function() {
        const gate = this.canOpenStudyNotes(false);
        if (!gate.allowed) return false;

        const popUrl = this.getStudyNotesModuleUrl(false);
        // Use a normal opener-linked popout for notes so the module reads/writes
        // the main app's local Study Notes store instead of a webview partition.
        if (this.studyNotesPopup && !this.studyNotesPopup.closed) {
            try {
                this.studyNotesPopup.focus();
                return true;
            } catch (error) {}
        }

        const features = 'popup=yes,width=1240,height=860,left=80,top=60,resizable=yes,scrollbars=yes';
        const child = window.open(popUrl, 'study_notes_workspace', features);
        if (!child) {
            if (typeof showToast === 'function') showToast('Popup blocked. Allow popups for Study Notes.', 'warning');
            return false;
        }

        this.studyNotesPopup = child;
        this.track('Study Tool: Study Notes (Second Screen)');
        return true;
    },

    popOutActiveTab: function(tabId = null) {
        const tab = tabId
            ? this.browserState.tabs.find(t => t.id === tabId)
            : this.browserState.tabs.find(t => t.id === this.browserState.activeTabId);
        if (!tab) {
            if (typeof showToast === 'function') showToast('No study tab is active.', 'warning');
            return false;
        }

        let liveUrl = tab.url;
        try {
            if (tab.webview && typeof tab.webview.getURL === 'function') {
                liveUrl = tab.webview.getURL() || liveUrl;
            }
        } catch (error) {}

        if (!this.isStudyBrowserUrl(liveUrl)) {
            this.openExternalUrl(liveUrl);
            return false;
        }

        if (window.electronAPI?.studyBrowser?.openPopout) {
            window.electronAPI.studyBrowser.openPopout({
                url: liveUrl,
                title: tab.title || 'Study Material',
                kind: 'study-material'
            }).then(() => {
                this.track(`Study Pop Out: ${tab.title || 'Study Material'}`);
            }).catch((error) => {
                console.warn('Study tab pop-out failed:', error);
                if (typeof showToast === 'function') showToast('Could not pop out this study tab.', 'error');
            });
            return true;
        }

        this.openExternalUrl(liveUrl);
        return false;
    },

    enforceStudyNotesPolicy: function(options = {}) {
        const gate = this.canOpenStudyNotes(true);
        if (gate.allowed) return true;

        this.closeStudyNotesDock();
        if (this.studyNotesPopup && !this.studyNotesPopup.closed) {
            try { this.studyNotesPopup.close(); } catch (error) {}
        }
        this.studyNotesPopup = null;

        if (!options || !options.silent) {
            if (typeof showToast === 'function') {
                showToast(gate.reason || 'Study Notes are locked during active Vetting.', 'warning');
            }
        }
        return false;
    },

    getActiveTab: function() {
        if (!this.browserState.activeTabId) return null;
        return this.browserState.tabs.find(t => t.id === this.browserState.activeTabId) || null;
    },

    goBackActiveTab: function() {
        this.invokeActiveWebviewAction('goBack');
    },

    goForwardActiveTab: function() {
        this.invokeActiveWebviewAction('goForward');
    },

    reloadActiveTab: function() {
        const activeTab = this.getActiveTab();
        const webview = activeTab?.webview;
        if (!webview || !webview.isConnected) return;

        try {
            webview.reload();
        } catch (error) {
            console.warn('Study browser reload failed:', error);
        }
    },

    goHomeActiveTab: function() {
        const activeTab = this.getActiveTab();
        const webview = activeTab?.webview;
        if (!webview || !webview.isConnected || !this.browserState.homeUrl) return;

        try {
            webview.loadURL(this.browserState.homeUrl);
        } catch (error) {
            console.warn('Study browser home action failed:', error);
        }
    },

    clearStudyBrowserCache: async function() {
        if (!confirm("Clear in-app study browser cache and sign-in session cookies?\n\nThis helps fix Microsoft/SharePoint login loops.\nYou may need to sign in again after this.")) return;

        try {
            localStorage.removeItem(this.localPageCacheKey);

            if (window.electronAPI?.studyBrowser?.clearCache) {
                await window.electronAPI.studyBrowser.clearCache();
            }

            if (typeof showToast === 'function') {
                showToast('Study browser cache cleared. Reloading active tab...', 'success');
            }

            const activeTab = this.getActiveTab();
            if (activeTab?.webview && activeTab.webview.isConnected && activeTab.url) {
                activeTab.usedCachedFallback = false;
                activeTab.webview.loadURL(this.cleanUrl(activeTab.url)).catch(() => {
                    activeTab.webview.reload();
                });
            } else if (typeof window.location !== 'undefined') {
                window.location.reload();
            }
        } catch (error) {
            console.error('Study browser cache clear failed:', error);
            if (typeof showToast === 'function') {
                showToast('Could not clear study browser cache.', 'error');
            }
        }
    },
    
    init: async function() {
        if (this.syncInterval) clearInterval(this.syncInterval);

        // 1. RESTORE HISTORY (Persist across reloads)
        if (CURRENT_USER && CURRENT_USER.role === 'trainee') {
            try {
                // Check unsynced first (crash/close recovery)
                const unsynced = localStorage.getItem('monitor_unsynced');
                if (unsynced) {
                    const payload = (typeof safeParse === 'function') ? safeParse(unsynced, null) : JSON.parse(unsynced);
                    if (payload.user === CURRENT_USER.user && Array.isArray(payload.history)) {
                        this.history = payload.history;
                    }
                    localStorage.removeItem('monitor_unsynced');
                } else {
                    // Normal restore
                    const md = this.readLocalJson('monitor_data', {});
                    if (md[CURRENT_USER?.user] && Array.isArray(md[CURRENT_USER?.user]?.history)) {
                        this.history = md[CURRENT_USER?.user]?.history;
                    }
                }
            } catch(e) { console.error("History Restore Error", e); }
        }
        
        // --- DAILY ARCHIVE CHECK ---
        await this.checkDailyReset(); // Await this before starting pollers

        // Start periodic sync (every 10s)
        this.syncInterval = setInterval(() => this.sync(), 10000);
        this.track("System: App Loaded");

        // --- START BULLETPROOF OS-LEVEL ACTIVITY POLLER ---
        if (CURRENT_USER && CURRENT_USER.role === 'trainee') {
            this.startActivityPoller();
            if (!this.studyNotesInputListenerBound) {
                this.studyNotesInputListenerBound = true;
                document.addEventListener('input', (event) => {
                    const target = event && event.target;
                    if (target && typeof target.closest === 'function' && target.closest('#study-notes, #study-notes-dock')) {
                        this.recordStudyEngagement('study-notes-input');
                        if (!String(this.currentActivity || '').startsWith('Study Tool: Study Notes')) {
                            this.track('Study Tool: Study Notes');
                        }
                    }
                }, true);
            }
        }

        // --- NEW: CAPTURE EXIT ---
        window.addEventListener('beforeunload', () => {
            if (CURRENT_USER?.role === 'trainee') {
                if (window.electronAPI?.ipcRenderer) window.electronAPI.ipcRenderer.send('stop-activity-monitor');
                this.track("App Closed / Refreshed");
                // Attempt synchronous local save to ensure data isn't lost
                const payload = {
                    user: CURRENT_USER.user,
                    current: this.currentActivity,
                    since: this.startTime,
                    isStudyOpen: this.isStudyOpen,
                    history: this.history
                };
                
                // Save to emergency key to survive the next Cloud Pull
                localStorage.setItem('monitor_unsynced', JSON.stringify(payload));
                // Also try standard save just in case
                let md = this.readLocalJson('monitor_data', {});
                if (!md || typeof md !== 'object' || Array.isArray(md)) md = {};
                md[CURRENT_USER?.user] = payload;
                localStorage.setItem('monitor_data', JSON.stringify(md));
            }
        });

        // --- NEW: IPC Listener for OS-Level Webview Links (PDF Fix) ---
        if (window.electronAPI?.ipcRenderer) {
            window.electronAPI.ipcRenderer.removeAllListeners('webview-new-window');
            window.electronAPI.ipcRenderer.on('webview-new-window', (e, url) => {
                if (this.isStudyOpen) {
                    if (this.isMicrosoftAuthUrl(url)) {
                        const activeTab = this.getActiveTab();
                        if (activeTab?.webview && activeTab.webview.isConnected) {
                            activeTab.usedCachedFallback = false;
                            activeTab.webview.loadURL(this.cleanUrl(url)).catch(() => {
                                this.handleSpawnedStudyUrl(url, "Sign In");
                            });
                        } else {
                            this.handleSpawnedStudyUrl(url, "Sign In");
                        }
                    } else {
                        this.handleSpawnedStudyUrl(url, "New Tab");
                    }
                } else {
                    this.openExternalUrl(url); // Fallback for TL Hub / other webviews
                }
            });
        }
    },

    getIdleViolationLimitMs: function() {
        return 8 * 60 * 1000;
    },

    getTeamsLimitMs: function() {
        return 8 * 60 * 1000;
    },

    getStudyEngagementIdleMs: function() {
        const config = this.readLocalJson('system_config', {});
        const configured = Number(config?.monitoring?.study_engagement_idle_ms);
        return Number.isFinite(configured) && configured >= 60000 ? configured : 5 * 60 * 1000;
    },

    getTrainingScopeLimitMs: function() {
        return this.getIdleViolationLimitMs();
    },

    isViolationReviewException: function(value) {
        const text = typeof value === 'object' && value
            ? [value.trigger, value.activity, value.reason, value.platform].map(v => String(v || '')).join(' ')
            : String(value || '');
        const normalized = text.toLowerCase().replace(/\s+/g, '');
        return normalized.includes('draw.io') || normalized.includes('[draw.io]') || normalized.includes('drawio') || normalized.includes('diagrams.net');
    },

    shouldCaptureTrainingScopeViolation: function() {
        try {
            const now = new Date();
            const hour = now.getHours();
            if (hour < 8 || hour >= 17 || hour === 12) return false;
            const liveSessions = this.readLocalJson('liveSessions', []);
            const myLive = (Array.isArray(liveSessions) ? liveSessions : []).find(s => s && CURRENT_USER && s.trainee === CURRENT_USER.user && s.active);
            const vSession = this.readLocalJson('vettingSession', {});
            const inVetting = vSession.active && vSession.trainees && CURRENT_USER && vSession.trainees[CURRENT_USER.user];
            return !myLive && !inVetting;
        } catch (error) {
            console.warn('Violation window check failed:', error);
            return false;
        }
    },

    resetGraceTrackedActivities: function(activeKey) {
        if (activeKey !== 'teams') this.teamsFocusStart = null;
        if (activeKey !== 'idle') this.idleViolationPrompted = false;
    },

    // --- OS-AWARE ACTIVITY POLLING ---
    startActivityPoller: function() {
        if (this.activityPoller) clearInterval(this.activityPoller); // Clear legacy timeouts
        
        if (window.electronAPI) {
            window.electronAPI.ipcRenderer.removeAllListeners('activity-update');
            window.electronAPI.ipcRenderer.on('activity-update', (event, data) => {
                try {
                    const osIdleSeconds = data.osIdleSeconds;
                    const activeWindow = data.activeWindow;
                        
                    if (data.isScreenLocked) {
                        this.resetGraceTrackedActivities('idle');
                        const lockIdleMs = Number(osIdleSeconds || 0) * 1000;
                        if (lockIdleMs >= this.getIdleViolationLimitMs() && this.shouldCaptureTrainingScopeViolation()) {
                            const lockTrigger = `Lock Idle for ${Math.floor(lockIdleMs / 60000)} minutes`;
                            const violationLabel = `Violation: ${lockTrigger}`;
                            if (!this.idleViolationPrompted && this.currentActivity !== violationLabel) {
                                this.idleViolationPrompted = true;
                                this.triggerExternalAppWarning(lockTrigger, violationLabel);
                            }
                            if (this.currentActivity !== violationLabel) this.track(violationLabel);
                            return;
                        }

                        if (this.currentActivity !== 'Lock Idle') this.track('Lock Idle');
                        return;
                    }

                    if (osIdleSeconds > 60) {
                        this.resetGraceTrackedActivities('idle');
                        // Allow idling if waiting in Vetting Arena after submission
                        const vSession = this.readLocalJson('vettingSession', {});
                        if (vSession.active && vSession.trainees && CURRENT_USER && vSession.trainees[CURRENT_USER.user]?.status === 'completed') {
                             if (this.currentActivity !== 'Vetting Arena: Waiting for test to end') this.track('Vetting Arena: Waiting for test to end');
                             return;
                        }

                        const idleMs = Number(osIdleSeconds || 0) * 1000;
                        if (idleMs >= this.getIdleViolationLimitMs() && this.shouldCaptureTrainingScopeViolation()) {
                            const idleTrigger = `Idle / Away for ${Math.floor(idleMs / 60000)} minutes`;
                            const violationLabel = `Violation: ${idleTrigger}`;
                            if (!this.idleViolationPrompted && this.currentActivity !== violationLabel) {
                                this.idleViolationPrompted = true;
                                this.triggerExternalAppWarning(idleTrigger, violationLabel);
                            }
                            if (this.currentActivity !== violationLabel) this.track(violationLabel);
                            return;
                        }

                        if (this.currentActivity !== 'Idle') this.track('Idle');
                        return;
                    }

                    let activityLabel = `External: ${activeWindow || 'Unknown App'}`;
                    let isPermitted = false;
                    let isTeamsWindow = false;

                    if (activeWindow) {
                        const normalizedWindow = activeWindow.toLowerCase();
                        if (normalizedWindow.includes('1st line training portal') || normalizedWindow.includes('msedgewebview2')) {
                            isPermitted = true;
                            if (this.isStudyOpen) {
                                this.updateActiveStudyEngagementState();
                                return;
                            }
                            activityLabel = "Portal Navigation: App";
                        } else {
                            const defaultSites = [
                                'acs.herotel.systems', 'crm.herotel.com', 'herotel.qcontact.com',
                                'radius.herotel.com', 'app.preseem.com', 'hosting.herotel.com',
                                'cp1.herotel.com', 'cp2.herotel.com', 'odoo.herotel.com'
                            ];
                            const configuredWorkSites = this.readLocalJson('monitor_whitelist', defaultSites);
                            const workSites = Array.isArray(configuredWorkSites) ? configuredWorkSites : defaultSites;

                            // Ensure all training and program keywords are permitted OS-level
                            const trainingKeywords = ['sharepoint', '.pdf', 'training', 'course', 'document', 'word', 'excel', 'powerpoint', 'onenote', 'odoo', 'genially', 'macvendor', 'draw.io', 'drawio', 'diagrams.net', 'cpanel', 'webmail', 'herotel webmail'];
                            const allPermitted = [...workSites, ...trainingKeywords];

                            // Check if window title contains any of the work sites
                            const matchedSite = allPermitted.find(site => site && normalizedWindow.includes(site.toLowerCase()));
                            
                            if (matchedSite) {
                                activityLabel = this.buildWorkToolStudyLabel(matchedSite);
                                isPermitted = true;
                            } else if (normalizedWindow.includes('teams') || normalizedWindow.includes('microsoft teams')) {
                                isTeamsWindow = true;
                                activityLabel = `Communication: MS Teams`;
                                isPermitted = true;
                            } else if (normalizedWindow.includes('outlook') || normalizedWindow.includes('mail')) {
                                activityLabel = `Study Tool: Email`;
                                isPermitted = true;
                            } else if (normalizedWindow.includes('taskmgr') || normalizedWindow.includes('task manager')) {
                                activityLabel = `System: Task Manager`;
                                isPermitted = true;
                            } else if (['snippingtool', 'snipping tool', 'screen sketch', 'snip & sketch', 'screenclip'].some(app => normalizedWindow.includes(app))) {
                                activityLabel = `System: Snipping Tool`;
                                isPermitted = true;
                            } else if (['explorer', 'searchhost', 'shellexperiencehost', 'taskbar', 'system tray', 'notification center', 'start', 'windows input experience'].some(sysApp => normalizedWindow.includes(sysApp))) {
                                activityLabel = `System: Windows Navigation`;
                                isPermitted = true;
                            }
                        }
                    }

                    if (!isTeamsWindow) this.resetGraceTrackedActivities(null);
                    if (isTeamsWindow) {
                        this.resetGraceTrackedActivities('teams');
                        const nowMs = Date.now();
                        if (!this.teamsFocusStart) this.teamsFocusStart = nowMs;
                        const teamsMs = nowMs - this.teamsFocusStart;
                        if (teamsMs >= this.getTeamsLimitMs() && this.shouldCaptureTrainingScopeViolation()) {
                            activityLabel = `Violation: MS Teams over 8 minutes - ${activeWindow || 'Microsoft Teams'}`;
                            isPermitted = false;
                            if (this.currentActivity !== activityLabel) {
                                this.triggerExternalAppWarning(activeWindow || 'Microsoft Teams over 8 minutes', activityLabel);
                            }
                        }
                    }

                    // Only trigger the warning & violation if it's strictly an external, non-permitted app
                    if (!isPermitted && activeWindow) {
                        const isViolation = this.shouldCaptureTrainingScopeViolation();
                        
                        if (isViolation) {
                            if (!String(activityLabel || '').startsWith('Violation:')) activityLabel = `Violation: External App - ${activeWindow}`;
                            if (this.currentActivity !== activityLabel) {
                                this.triggerExternalAppWarning(activeWindow, activityLabel);
                            }
                        }
                    }

                    // Track the state change
                    if (this.currentActivity !== activityLabel && activityLabel !== "Portal Navigation: App") {
                        this.track(activityLabel);
                    } else if (activityLabel === "Portal Navigation: App" && (this.currentActivity === 'Idle' || this.currentActivity.startsWith('External:') || this.currentActivity.startsWith('Violation:'))) {
                        this.track("Portal Navigation: App");
                    }
                } catch (e) { console.error("External Monitor Error:", e); }
            });
            
            window.electronAPI.ipcRenderer.send('start-activity-monitor');
        }
    },

    getRawViolationReports: function() {
        const reports = this.readLocalJson('violation_reports', []);
        return Array.isArray(reports) ? reports : [];
    },

    getViolationReports: function() {
        return this.getRawViolationReports().filter(report => !this.isViolationReviewException(report));
    },

    getViolationReportTombstoneId: function(reportId) {
        return `violation_report:${String(reportId || '').trim()}`;
    },

    addViolationReportTombstones: function(reportIds) {
        const ids = (Array.isArray(reportIds) ? reportIds : [reportIds])
            .map(id => String(id || '').trim())
            .filter(Boolean);
        if (!ids.length) return [];

        const existing = this.readLocalJson('system_tombstones', []);
        const tombstones = Array.isArray(existing) ? existing : [];
        const seen = new Set(tombstones.map(item => String(item || '')));
        let changed = false;
        ids.forEach(id => {
            const tombstone = this.getViolationReportTombstoneId(id);
            if (!seen.has(tombstone)) {
                tombstones.push(tombstone);
                seen.add(tombstone);
                changed = true;
            }
        });
        if (changed) localStorage.setItem('system_tombstones', JSON.stringify(tombstones));
        return tombstones;
    },

    getDeletedViolationReportIds: function() {
        const tombstones = this.readLocalJson('system_tombstones', []);
        const deleted = new Set();
        (Array.isArray(tombstones) ? tombstones : []).forEach(item => {
            const text = String(item || '').trim();
            if (text.startsWith('violation_report:')) deleted.add(text.replace(/^violation_report:/, ''));
        });
        return deleted;
    },

    writeViolationReports: function(reports) {
        const deletedIds = this.getDeletedViolationReportIds();
        const clean = (Array.isArray(reports) ? reports : [])
            .filter(r => r && r.id && r.user)
            .filter(r => !deletedIds.has(String(r.id || '')))
            .sort((a, b) => new Date(b.detectedAt || b.reportedAt || 0) - new Date(a.detectedAt || a.reportedAt || 0));
        localStorage.setItem('violation_reports', JSON.stringify(clean));
        return clean;
    },

    persistViolationReportDeletion: async function(remainingReports, deletedIds) {
        const deletedSet = new Set((deletedIds || []).map(id => String(id || '')).filter(Boolean));
        const tombstones = this.addViolationReportTombstones(Array.from(deletedSet));
        const localRemaining = this.writeViolationReports(remainingReports);
        const client = window.supabaseClient || (typeof window.initSupabaseClient === 'function' ? window.initSupabaseClient() : null);

        if (!client?.from || deletedSet.size === 0) {
            if (typeof saveToServer === 'function') await saveToServer(['violation_reports', 'system_tombstones'], true, true);
            return localRemaining;
        }

        const remoteKey = localStorage.getItem('DEMO_MODE') === 'true' ? 'demo_violation_reports' : 'violation_reports';
        const tombstoneKey = localStorage.getItem('DEMO_MODE') === 'true' ? 'demo_system_tombstones' : 'system_tombstones';
        const { data: remoteRow, error: fetchErr } = await client
            .from('app_documents')
            .select('content')
            .eq('key', remoteKey)
            .maybeSingle();
        if (fetchErr) throw fetchErr;

        const byId = new Map();
        localRemaining.forEach(report => {
            if (report?.id && !deletedSet.has(String(report.id))) byId.set(String(report.id), report);
        });
        (Array.isArray(remoteRow?.content) ? remoteRow.content : []).forEach(report => {
            const id = String(report?.id || '');
            if (id && !deletedSet.has(id) && !byId.has(id)) byId.set(id, report);
        });

        const finalReports = this.writeViolationReports(Array.from(byId.values()));
        const { data: savedData, error: saveErr } = await client
            .from('app_documents')
            .upsert({
                key: remoteKey,
                content: finalReports,
                updated_at: new Date().toISOString()
            })
            .select();
        if (saveErr) throw saveErr;
        if (savedData && savedData[0]) localStorage.setItem('sync_ts_violation_reports', savedData[0].updated_at);

        const { data: tombstoneData, error: tombstoneErr } = await client
            .from('app_documents')
            .upsert({
                key: tombstoneKey,
                content: tombstones,
                updated_at: new Date().toISOString()
            })
            .select();
        if (tombstoneErr) throw tombstoneErr;
        if (tombstoneData && tombstoneData[0]) localStorage.setItem('sync_ts_system_tombstones', tombstoneData[0].updated_at);
        return finalReports;
    },

    getViolationDropdownOptions: function() {
        return {
            platforms: ['Teams', 'WhatsApp', 'Phone Call', 'In Person'],
            contacts: ['Darren', 'Netta', 'Jaco']
        };
    },

    shouldSkipViolationEvidenceCapture: function(triggerWindow, activityLabel) {
        const text = [triggerWindow, activityLabel]
            .map(value => String(value || '').toLowerCase())
            .join(' ');
        return text.includes('lock idle')
            || text.includes('locked idle')
            || text.includes('screen locked')
            || text.includes('lock-screen')
            || text.includes('lock screen');
    },

    buildSkippedViolationEvidence: function(reason = 'Screenshot capture is not required for lock-idle violations.') {
        return this.buildEmptyViolationEvidence({
            capturedAt: new Date().toISOString(),
            screenCount: 0,
            screenshots: []
        }, {
            storage: 'skipped',
            captureSkipped: true,
            captureSkipReason: reason
        });
    },

    normalizeSkippedViolationEvidence: async function(record, rawEvidence = {}) {
        const skipped = this.buildSkippedViolationEvidence();
        skipped.capturedAt = rawEvidence?.capturedAt || skipped.capturedAt;
        skipped.capturedScreenCount = Number(rawEvidence?.screenCount || rawEvidence?.capturedScreenCount || 0);
        const files = Array.isArray(rawEvidence?.files) ? rawEvidence.files : [];
        if (files.length) {
            await this.deleteViolationEvidenceFiles({ evidence: { files } }, 'lock_idle_capture_discarded');
        }
        return skipped;
    },

    triggerExternalAppWarning: function(triggerWindow, activityLabel) {
        if (document.getElementById('external-app-warning-modal')) return;

        const promptId = `vio_prompt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const detectedAt = Date.now();
        this.pendingViolationPrompt = {
            id: promptId,
            trigger: String(triggerWindow || 'Unknown external app'),
            activity: String(activityLabel || `Violation: ${triggerWindow || 'Unknown external app'}`),
            detectedAt,
            evidence: null
        };
        if (this.shouldSkipViolationEvidenceCapture(triggerWindow, activityLabel)) {
            this.pendingViolationPrompt.evidence = this.buildSkippedViolationEvidence();
        } else {
            this.captureViolationEvidence(promptId);
        }
        const options = this.getViolationDropdownOptions();
        const platformOptions = ['<option value="">-- Select Platform --</option>']
            .concat(options.platforms.map(p => `<option value="${this.escapeHtml(p)}">${this.escapeHtml(p)}</option>`))
            .join('');
        const contactOptions = ['<option value="">-- Select Person --</option>']
            .concat(options.contacts.map(c => `<option value="${this.escapeHtml(c)}">${this.escapeHtml(c)}</option>`))
            .join('');
        const triggerText = this.escapeHtml(triggerWindow || 'Unknown external app');
        const modalHtml = `
            <div id="external-app-warning-modal">
                <div class="modal-box violation-capture-modal">
                    <i class="fas fa-triangle-exclamation" style="font-size: 3rem; color: #ff5252; margin-bottom: 12px;"></i>
                    <h2 style="color:#ff5252; margin-bottom:6px;">Training Scope Violation</h2>
                    <p style="line-height:1.55; color:var(--text-muted); margin-bottom:14px;">
                        You left the approved training workspace during monitored training hours. This must be explained before continuing.
                    </p>
                    <div class="violation-trigger-box">
                        <span>Trigger detected</span>
                        <strong>${triggerText}</strong>
                    </div>
                    <label for="violationReason_${promptId}">Reason for this violation</label>
                    <textarea id="violationReason_${promptId}" placeholder="Explain why you left the training app..." style="height:82px;"></textarea>
                    <div class="grid-2" style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px;">
                        <div>
                            <label for="violationPlatform_${promptId}">Platform Used</label>
                            <select id="violationPlatform_${promptId}">${platformOptions}</select>
                        </div>
                        <div>
                            <label for="violationContact_${promptId}">Person Informed</label>
                            <select id="violationContact_${promptId}">${contactOptions}</select>
                        </div>
                    </div>
                    <button class="btn-danger btn-lg" style="width:100%; margin-top:16px;" onclick="StudyMonitor.submitViolationReason('${promptId}')">
                        <i class="fas fa-lock"></i> Submit Violation Explanation
                    </button>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    },

    captureViolationEvidence: async function(promptId) {
        try {
            const prompt = this.pendingViolationPrompt;
            if (!prompt || prompt.id !== promptId) return;
            const captureFn = window.electronAPI?.activityMonitor?.captureViolationScreenshots
                || (() => window.electronAPI?.ipcRenderer?.invoke?.('capture-violation-screenshots'));
            if (typeof captureFn !== 'function') return;
            const evidence = await captureFn();
            if (!this.pendingViolationPrompt || this.pendingViolationPrompt.id !== promptId) return;
            const screenshots = Array.isArray(evidence?.screenshots) ? evidence.screenshots : [];
            this.pendingViolationPrompt.evidence = {
                capturedAt: evidence?.capturedAt || new Date().toISOString(),
                screenCount: Number(evidence?.screenCount || screenshots.length || 0),
                screenshots,
                visibility: 'admin_only',
                traineeVisible: false
            };
        } catch (error) {
            console.warn('Violation screenshot capture failed:', error);
            if (this.pendingViolationPrompt && this.pendingViolationPrompt.id === promptId) {
                this.pendingViolationPrompt.evidence = {
                    capturedAt: new Date().toISOString(),
                    screenCount: 0,
                    screenshots: [],
                    visibility: 'admin_only',
                    traineeVisible: false,
                    captureError: String(error && error.message || error || 'Unknown capture error')
                };
            }
        }
    },

    getViolationEvidenceBucket: function() {
        return 'violation_evidence';
    },

    getSafeEvidencePathPart: function(value) {
        return String(value || 'unknown')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80) || 'unknown';
    },

    base64ToBlob: function(base64, mime = 'image/jpeg') {
        const clean = String(base64 || '').replace(/^data:[^;]+;base64,/, '');
        const binary = atob(clean);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new Blob([bytes], { type: mime });
    },

    buildEmptyViolationEvidence: function(rawEvidence = {}, extra = {}) {
        const screenshots = Array.isArray(rawEvidence.screenshots) ? rawEvidence.screenshots : [];
        return {
            capturedAt: rawEvidence.capturedAt || new Date().toISOString(),
            screenCount: 0,
            capturedScreenCount: Number(rawEvidence.screenCount || screenshots.length || 0),
            storage: extra.storage || rawEvidence.storage || 'none',
            bucket: this.getViolationEvidenceBucket(),
            visibility: 'admin_only',
            traineeVisible: false,
            screenshots: [],
            files: [],
            captureError: extra.captureError || rawEvidence.captureError || '',
            captureSkipped: !!(extra.captureSkipped || rawEvidence.captureSkipped),
            captureSkipReason: extra.captureSkipReason || rawEvidence.captureSkipReason || ''
        };
    },

    uploadViolationEvidence: async function(record, rawEvidence = {}) {
        if (this.shouldSkipViolationEvidenceCapture(record?.trigger, record?.activity)) {
            return this.normalizeSkippedViolationEvidence(record, rawEvidence);
        }

        const screenshots = Array.isArray(rawEvidence?.screenshots) ? rawEvidence.screenshots : [];
        if (!screenshots.length) return this.buildEmptyViolationEvidence(rawEvidence);

        const client = window.supabaseClient;
        const storage = client?.storage;
        if (!storage?.from) {
            return this.buildEmptyViolationEvidence(rawEvidence, {
                storage: 'unavailable',
                captureError: 'Evidence storage is unavailable in this client session.'
            });
        }

        const bucket = this.getViolationEvidenceBucket();
        const traineePart = this.getSafeEvidencePathPart(record.user);
        const reportPart = this.getSafeEvidencePathPart(record.id);
        const capturedAt = rawEvidence.capturedAt || new Date().toISOString();
        const uploaded = [];

        try {
            for (let index = 0; index < screenshots.length; index++) {
                const shot = screenshots[index] || {};
                const mime = shot.mime || 'image/jpeg';
                const blob = this.base64ToBlob(shot.data || '', mime);
                const evidenceId = `evi_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 9)}`;
                const extension = mime.includes('png') ? 'png' : 'jpg';
                const path = `${traineePart}/${reportPart}/screen-${index + 1}-${evidenceId}.${extension}`;
                const { error } = await storage.from(bucket).upload(path, blob, {
                    contentType: mime,
                    cacheControl: '3600',
                    upsert: false
                });
                if (error) throw error;
                uploaded.push({
                    id: evidenceId,
                    reportId: record.id,
                    trainee: record.user,
                    bucket,
                    path,
                    mime,
                    name: shot.name || `Screen ${index + 1}`,
                    screenIndex: index,
                    capturedAt,
                    width: Number(shot.width || 0),
                    height: Number(shot.height || 0),
                    sizeBytes: blob.size
                });
            }

            if (client?.from && uploaded.length) {
                const rows = uploaded.map(file => ({
                    id: file.id,
                    report_id: file.reportId,
                    trainee: file.trainee,
                    screen_index: file.screenIndex,
                    bucket: file.bucket,
                    path: file.path,
                    mime: file.mime,
                    width: file.width || null,
                    height: file.height || null,
                    size_bytes: file.sizeBytes || null,
                    captured_at: file.capturedAt,
                    status: 'active',
                    metadata: { name: file.name }
                }));
                const { error: tableError } = await client.from('violation_evidence').upsert(rows, { onConflict: 'id' });
                if (tableError) console.warn('Violation evidence metadata save failed:', tableError);
            }

            return {
                capturedAt,
                screenCount: uploaded.length,
                capturedScreenCount: Number(rawEvidence.screenCount || screenshots.length || uploaded.length),
                storage: 'supabase_storage',
                bucket,
                visibility: 'admin_only',
                traineeVisible: false,
                screenshots: [],
                files: uploaded
            };
        } catch (error) {
            if (uploaded.length) {
                await this.deleteViolationEvidenceFiles({ evidence: { files: uploaded } });
            }
            console.warn('Violation evidence upload failed:', error);
            return this.buildEmptyViolationEvidence(rawEvidence, {
                storage: 'upload_failed',
                captureError: String(error && error.message || error || 'Evidence upload failed')
            });
        }
    },

    submitViolationReason: async function(promptId) {
        const prompt = this.pendingViolationPrompt;
        if (!prompt || prompt.id !== promptId) return;

        const reasonEl = document.getElementById(`violationReason_${promptId}`);
        const platformEl = document.getElementById(`violationPlatform_${promptId}`);
        const contactEl = document.getElementById(`violationContact_${promptId}`);
        const reason = String(reasonEl?.value || '').trim();
        const platform = String(platformEl?.value || '').trim();
        const contact = String(contactEl?.value || '').trim();

        if (!reason) return alert("Please provide the reason for this violation.");
        if (!platform || !contact) return alert("Please specify how and who you informed.");

        const skipEvidence = this.shouldSkipViolationEvidenceCapture(prompt.trigger, prompt.activity);
        if (!prompt.evidence && !skipEvidence) {
            await this.captureViolationEvidence(promptId);
        }

        const reports = this.getViolationReports();
        const record = {
            id: `vio_${prompt.detectedAt}_${Math.random().toString(36).slice(2, 8)}`,
            user: CURRENT_USER?.user || 'unknown',
            date: this.getLocalDateString(new Date(prompt.detectedAt)),
            trigger: prompt.trigger,
            activity: prompt.activity,
            reason,
            platform,
            contact,
            detectedAt: new Date(prompt.detectedAt).toISOString(),
            reportedAt: new Date().toISOString(),
            status: 'pending_review',
            reviewed: false,
            reviewedAt: null,
            reviewedBy: '',
            adminComment: '',
            evidence: this.buildEmptyViolationEvidence(prompt.evidence || {})
        };
        record.evidence = skipEvidence
            ? await this.normalizeSkippedViolationEvidence(record, prompt.evidence || {})
            : await this.uploadViolationEvidence(record, prompt.evidence || {});

        reports.push(record);
        this.writeViolationReports(reports);
        this.currentViolationReportId = record.id;
        this.pendingViolationPrompt = null;

        if (typeof saveToServer === 'function') await saveToServer(['violation_reports'], false, true);
        if (typeof updateNotifications === 'function') updateNotifications();

        document.getElementById('external-app-warning-modal')?.remove();
        if (typeof showToast === 'function') showToast("Violation explanation submitted for review.", "warning");
    },

    track: function(activityName) {
        const now = Date.now();
        const duration = now - this.startTime;

        // Log previous activity if it lasted > 1 second
        if (duration > 1000) {
            const previousSegment = {
                activity: this.currentActivity,
                start: this.startTime,
                end: now,
                duration: duration,
                clicks: this.clickCount // Save clicks for this session
            };
            if (String(this.currentActivity || '').startsWith('Violation:') && this.currentViolationReportId) {
                previousSegment.violationReportId = this.currentViolationReportId;
            }
            this.history.push(previousSegment);
        }

        this.currentActivity = activityName;
        this.startTime = now;
        this.clickCount = 0; // Reset click count for new activity
        if (!String(activityName || '').startsWith('Violation:')) {
            this.currentViolationReportId = null;
        }
        
        // SAFETY: Prevent infinite array growth (Memory Protection)
        if (this.history.length > 2000) {
            // Keep start, slice end to maintain recent context
            const first = this.history[0];
            const recent = this.history.slice(-1000);
            this.history = [first, ...recent];
        }

        // Instant local save (optional)
        this.sync(); // Trigger sync check immediately on activity change
    },

    recordClick: function() {
        this.clickCount++;
        // FIX: Ensure study activity counts as global interaction to prevent "Idle" status
        if (typeof window !== 'undefined') window.LAST_INTERACTION = Date.now();
    },

    // --- DEFUSAL 1: PREVENT ADMIN DATA OVERWRITES ---
    reclassifyHistory: function() {
        this.updateWhitelistCache();
        let changed = false;
        
        const applyWhitelist = (activityString) => {
            if ((activityString.startsWith('External: ') || activityString.startsWith('Violation: ')) && !activityString.includes('(Reclassified)')) {
                const raw = activityString.replace(/^(External|Violation):\s*/, '').trim();
                if (this.isViolationReviewException(raw)) {
                    return `Studying: ${raw} (Reclassified)`;
                }
                if (this.cachedWhitelist.some(w => raw.toLowerCase().includes(w.toLowerCase()))) {
                    return `Studying: ${raw} (Reclassified)`;
                }
            }
            return activityString;
        };

        this.history.forEach(h => {
            const newAct = applyWhitelist(h.activity);
            if (newAct !== h.activity) { h.activity = newAct; changed = true; }
        });
        
        const newCurr = applyWhitelist(this.currentActivity);
        if (newCurr !== this.currentActivity) { this.currentActivity = newCurr; changed = true; }
        
        return changed;
    },

    sync: async function() {
        if (!CURRENT_USER || CURRENT_USER.role === 'admin') return; // Don't track admins

        // ROBUSTNESS: Check for day rollover dynamically (e.g. user left app open overnight)
        await this.checkDailyReset();

        // Auto-reconcile history against latest Admin rules before pushing
        this.reclassifyHistory();

        const payload = {
            user: CURRENT_USER.user,
            current: this.currentActivity,
            since: this.startTime,
            isStudyOpen: this.isStudyOpen,
            history: this.history,
            date: this.getLocalDateString() // UPDATED: Use Local Date
        };

        // OPTIMIZATION: Only sync if data changed since last successful push
        const payloadStr = JSON.stringify(payload);
        if (this.lastSyncedPayload === payloadStr) return;

        // We use a specific key in app_documents for monitoring to avoid bloating 'sessions'
        // We read-modify-write the 'monitor_data' object
        if (window.supabaseClient) {
            try {
                // 1. Get current monitor data (Optimistic)
                // Ensure we don't get null if localstorage was wiped
                let monitorData = this.readLocalJson('monitor_data', {}) || {};
                if (!monitorData || typeof monitorData !== 'object' || Array.isArray(monitorData)) monitorData = {};
                
                // 2. Update my entry
                const existingMine = monitorData[CURRENT_USER.user];
                if (existingMine && existingMine.date === payload.date) {
                    payload.history = this.mergeActivitySegments(existingMine.history || [], payload.history || []);
                    this.history = payload.history;
                }
                monitorData[CURRENT_USER.user] = payload;
                localStorage.setItem('monitor_data', JSON.stringify(monitorData));

                // 3. Push to Cloud (Safe Merge handled by data.js logic usually, but here we might overwrite)
                // For high-frequency data, we might want a dedicated table, but sticking to app_documents:
                // We will use a "Blind Write" to a specific key if possible, or just rely on data.js
                // To avoid race conditions with other users, we should ideally use a separate row per user.
                // BUT, sticking to the requested architecture:
                
                // UPDATED: Force a silent background push to ensure Admin sees this.
                // We use 'false' for safe merge and 'true' for silent mode.
                if (typeof saveToServer === 'function') {
                    await saveToServer(['monitor_data'], false, true);
                    this.lastSyncedPayload = payloadStr; // Update cache on success
                }
                
            } catch (e) {
                console.error("Monitor Sync Error", e);
            }
        }
    },

    updateWhitelistCache: function() {
        // Filter out empty strings to prevent false positive matches
        const whitelist = this.readLocalJson('monitor_whitelist', []);
        this.cachedWhitelist = (Array.isArray(whitelist) ? whitelist : []).filter(w => w && w.trim().length > 0);
    },

    buildInAppStudyLabel: function(label) {
        const safeLabel = String(label || 'Study Material').trim();
        return `Study Material: ${safeLabel}`;
    },

    buildWorkToolStudyLabel: function(label) {
        const raw = String(label || 'Work Tool').trim();
        const lower = raw.toLowerCase();
        let name = raw;
        if (lower.includes('qcontact')) name = 'Q-Contact';
        else if (lower.includes('crm')) name = 'CRM';
        else if (lower.includes('radius')) name = 'Radius';
        else if (lower.includes('preseem')) name = 'Preseem';
        else if (lower.includes('acs')) name = 'ACS';
        else if (lower.includes('odoo')) name = 'Odoo';
        else if (lower.includes('cpanel') || lower.includes('cp1') || lower.includes('cp2') || lower.includes('hosting') || lower.includes('webmail')) name = 'Hosting/cPanel/Webmail';
        return `Study Tool: ${name}`;
    },

    buildStudyContextLabel: function(tab) {
        const webview = tab?.webview;
        const title = String((webview && typeof webview.getTitle === 'function' ? webview.getTitle() : '') || tab?.title || 'Study Material').trim();
        const url = String((webview && typeof webview.getURL === 'function' ? webview.getURL() : '') || tab?.url || '').trim();
        const combined = `${title} ${url}`.toLowerCase();
        const toolLabel = this.buildWorkToolStudyLabel(combined);
        if (/(qcontact|crm|radius|preseem|acs|odoo|cpanel|cp1|cp2|hosting|webmail)/i.test(combined)) {
            return toolLabel;
        }
        return this.buildInAppStudyLabel(title || url || 'Study Material');
    },

    recordStudyEngagement: function(reason = 'interaction') {
        this.lastStudyEngagementAt = Date.now();
        this.lastStudyProbeSnapshot = {
            ...(this.lastStudyProbeSnapshot || {}),
            lastReason: reason,
            updatedAt: this.lastStudyEngagementAt
        };
        this.recordClick();
    },

    updateActiveStudyEngagementState: function() {
        if (!this.isStudyOpen) return;
        const tab = this.getActiveTab ? this.getActiveTab() : null;
        if (!tab) return;
        const baseLabel = this.buildStudyContextLabel(tab);
        const lastAt = this.lastStudyEngagementAt || this.startTime || Date.now();
        const inactiveMs = Date.now() - lastAt;
        const label = inactiveMs >= this.getStudyEngagementIdleMs()
            ? `${baseLabel} (Inactive - no page engagement)`
            : baseLabel;
        if (this.currentActivity !== label) this.track(label);
    },

    installStudyEngagementProbe: function(tab) {
        const webview = tab?.webview;
        if (!webview || !webview.isConnected || typeof webview.executeJavaScript !== 'function') return;
        const script = `
            (function() {
                if (!window.__studyMonitorEngagement) {
                    window.__studyMonitorEngagement = { count: 0, lastAt: Date.now(), lastType: 'load' };
                    const mark = function(type) {
                        window.__studyMonitorEngagement.count += 1;
                        window.__studyMonitorEngagement.lastAt = Date.now();
                        window.__studyMonitorEngagement.lastType = type;
                    };
                    let lastMouseAt = 0;
                    ['click', 'keydown', 'input', 'scroll', 'wheel', 'touchstart'].forEach(function(type) {
                        window.addEventListener(type, function() { mark(type); }, { passive: true, capture: true });
                    });
                    window.addEventListener('mousemove', function() {
                        const now = Date.now();
                        if (now - lastMouseAt > 5000) {
                            lastMouseAt = now;
                            mark('mousemove');
                        }
                    });
                    document.addEventListener('visibilitychange', function() { mark('visibility'); }, true);
                    Array.from(document.querySelectorAll('video,audio')).forEach(function(media) {
                        ['play', 'playing', 'timeupdate', 'seeked'].forEach(function(type) {
                            media.addEventListener(type, function() { mark('media-' + type); }, { passive: true });
                        });
                    });
                }
                return window.__studyMonitorEngagement;
            })();
        `;
        webview.executeJavaScript(script, true)
            .then(snapshot => {
                if (snapshot && typeof snapshot.count === 'number') {
                    tab.lastProbeCount = snapshot.count;
                    this.recordStudyEngagement('page-load');
                }
            })
            .catch(() => {});
    },

    startStudyEngagementPoller: function() {
        if (this.studyEngagementPoller) clearInterval(this.studyEngagementPoller);
        this.studyEngagementPoller = setInterval(() => {
            const tab = this.getActiveTab ? this.getActiveTab() : null;
            const webview = tab?.webview;
            if (!this.isStudyOpen || !webview || !webview.isConnected || typeof webview.executeJavaScript !== 'function') return;
            webview.executeJavaScript(`window.__studyMonitorEngagement || null`, true)
                .then(snapshot => {
                    if (snapshot && typeof snapshot.count === 'number' && snapshot.count !== tab.lastProbeCount) {
                        tab.lastProbeCount = snapshot.count;
                        this.recordStudyEngagement(snapshot.lastType || 'page-interaction');
                    }
                    this.updateActiveStudyEngagementState();
                })
                .catch(() => this.updateActiveStudyEngagementState());
        }, 15000);
    },

    stopStudyEngagementPoller: function() {
        if (this.studyEngagementPoller) clearInterval(this.studyEngagementPoller);
        this.studyEngagementPoller = null;
    },

    getSegmentStartMs: function(seg) {
        if (!seg) return 0;
        if (typeof seg.start === 'number') return seg.start;
        if (typeof seg.end === 'number' && typeof seg.duration === 'number') return seg.end - seg.duration;
        return 0;
    },

    getSegmentEndMs: function(seg) {
        if (!seg) return 0;
        if (typeof seg.end === 'number') return seg.end;
        const start = this.getSegmentStartMs(seg);
        if (start && typeof seg.duration === 'number') return start + seg.duration;
        return start;
    },

    getDateStringFromTimestamp: function(timestamp) {
        const d = new Date(timestamp || Date.now());
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    },

    getSegmentDateString: function(seg) {
        return this.getDateStringFromTimestamp(this.getSegmentStartMs(seg));
    },

    filterSegmentsByDate: function(segments, dateStr) {
        return (segments || []).filter(seg => this.getSegmentDateString(seg) === dateStr);
    },

    getSegmentIdentity: function(seg) {
        if (!seg) return '';
        const start = this.getSegmentStartMs(seg);
        const end = this.getSegmentEndMs(seg);
        return [
            String(start || ''),
            String(end || ''),
            String(seg.activity || '').trim().toLowerCase()
        ].join('|');
    },

    mergeActivitySegments: function(...segmentGroups) {
        const seen = new Map();
        segmentGroups.flat().forEach(seg => {
            if (!seg) return;
            const start = this.getSegmentStartMs(seg);
            const end = this.getSegmentEndMs(seg);
            if (!start || !end || end <= start) return;
            const normalized = {
                ...seg,
                start,
                end,
                duration: end - start
            };
            const identity = this.getSegmentIdentity(normalized);
            if (!identity) return;
            const existing = seen.get(identity);
            if (!existing || (normalized.updatedAt || normalized.updated_at || 0) > (existing.updatedAt || existing.updated_at || 0)) {
                seen.set(identity, normalized);
            }
        });
        return Array.from(seen.values()).sort((a, b) => this.getSegmentStartMs(a) - this.getSegmentStartMs(b));
    },

    namesMatch: function(left, right) {
        const clean = (value) => String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[._-]+/g, ' ')
            .replace(/\s+/g, ' ');
        const leftClean = clean(left);
        const rightClean = clean(right);
        const token = (value) => clean(value).replace(/\s+/g, '');
        return !!leftClean && !!rightClean && (
            leftClean === rightClean ||
            token(left) === token(right)
        );
    },

    buildMonitorHistoryId: function(user, dateStr) {
        const safeUser = String(user || 'unknown')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '') || 'unknown';
        return `monitor_history_${safeUser}_${String(dateStr || '').trim()}`;
    },

    getLocalArchivedDay: function(agentName, dateStr) {
        const historyLog = this.readLocalJson('monitor_history', []);
        const matches = (Array.isArray(historyLog) ? historyLog : []).filter(row =>
            this.namesMatch(row && (row.user || row.user_id || row.trainee), agentName)
            && String(row && row.date || '') === dateStr
        );
        return this.mergeArchivedDayRows(matches, agentName, dateStr);
    },

    cacheArchivedDay: function(day) {
        if (!day || !day.user || !day.date) return;
        let historyLog = this.readLocalJson('monitor_history', []);
        if (!Array.isArray(historyLog)) historyLog = [];
        const existingRows = historyLog.filter(row =>
            this.namesMatch(row && (row.user || row.user_id || row.trainee), day.user)
            && String(row && row.date || '') === String(day.date || '')
        );
        const mergedDay = this.mergeArchivedDayRows([...existingRows, day], day.user, day.date) || day;
        const retained = historyLog.filter(row =>
            !(this.namesMatch(row && (row.user || row.user_id || row.trainee), day.user)
            && String(row && row.date || '') === String(day.date || ''))
        );
        retained.push(mergedDay);
        try {
            localStorage.setItem('monitor_history', JSON.stringify(retained));
        } catch (error) {
            console.warn('Unable to cache archived monitor day locally.', error);
        }
    },

    mergeArchivedDayRows: function(rows, agentName = '', dateStr = '') {
        const matches = (Array.isArray(rows) ? rows : []).filter(Boolean);
        if (!matches.length) return null;
        const details = this.mergeActivitySegments(...matches.map(row =>
            Array.isArray(row.details) ? row.details : (Array.isArray(row.history) ? row.history : [])
        ));
        const user = matches.find(row => row.user || row.user_id || row.trainee)?.user
            || matches.find(row => row.user_id)?.user_id
            || matches.find(row => row.trainee)?.trainee
            || agentName;
        const date = matches.find(row => row.date)?.date || dateStr;
        const updatedAt = matches
            .map(row => row.updated_at || row.updatedAt || row.lastModified || '')
            .filter(Boolean)
            .sort()
            .pop() || new Date().toISOString();
        return {
            ...matches[matches.length - 1],
            id: this.buildMonitorHistoryId(user || agentName, date),
            user,
            date,
            summary: this.calculateDailyStats(details),
            details,
            updatedAt
        };
    },

    fetchArchivedDayFromServer: async function(agentName, dateStr) {
        const client = window.supabaseClient || (typeof window.initSupabaseClient === 'function' ? window.initSupabaseClient() : null);
        if (!client || !client.from) return null;
        const normalizeRow = (row) => {
            const base = row && row.data && typeof row.data === 'object' ? row.data : (row || {});
            return {
                id: String(row.id || base.id || ''),
                user: String(base.user || base.trainee || base.username || row.user_id || '').trim(),
                date: String(base.date || '').trim(),
                summary: base.summary && typeof base.summary === 'object' ? base.summary : (base.stats && typeof base.stats === 'object' ? base.stats : {}),
                details: Array.isArray(base.details) ? base.details : (Array.isArray(base.history) ? base.history : []),
                raw: base
            };
        };

        try {
            const collected = [];
            const addRows = (rows) => {
                (Array.isArray(rows) ? rows : []).forEach(row => {
                    if (!row || collected.some(existing => String(existing.id || '') === String(row.id || ''))) return;
                    collected.push(row);
                });
            };

            const direct = await client
                .from('monitor_history')
                .select('id,user_id,updated_at,data')
                .ilike('user_id', agentName)
                .eq('data->>date', dateStr)
                .order('updated_at', { ascending: false })
                .limit(50);

            if (direct.error) console.warn('Archived monitor direct lookup failed, trying fallbacks.', direct.error);
            else addRows(direct.data);

            const canonicalId = this.buildMonitorHistoryId(agentName, dateStr);
            const byId = await client
                .from('monitor_history')
                .select('id,user_id,updated_at,data')
                .eq('id', canonicalId)
                .limit(1);

            if (byId.error) console.warn('Archived monitor canonical lookup failed.', byId.error);
            else addRows(byId.data);

            let rows = collected.map(normalizeRow);
            let matchingRows = rows.filter(row => this.namesMatch(row.user, agentName) && row.date === dateStr);

            if (!matchingRows.length) {
                const fallback = await client
                    .from('monitor_history')
                    .select('id,user_id,updated_at,data')
                    .eq('data->>date', dateStr)
                    .order('updated_at', { ascending: false })
                    .limit(500);
                if (fallback.error) {
                    console.warn('Archived monitor date fallback failed.', fallback.error);
                } else {
                    addRows(fallback.data);
                }
                rows = collected.map(normalizeRow);
                matchingRows = rows.filter(row => this.namesMatch(row.user, agentName) && row.date === dateStr);
            }

            const match = this.mergeArchivedDayRows(matchingRows, agentName, dateStr);
            if (match) this.cacheArchivedDay(match);
            return match;
        } catch (error) {
            console.warn('Unable to fetch archived monitor day from server.', error);
            return null;
        }
    },

    getArchivedSegmentsForDate: async function(agentName, dateStr) {
        const localDay = this.getLocalArchivedDay(agentName, dateStr);
        const serverDay = await this.fetchArchivedDayFromServer(agentName, dateStr);
        const day = this.mergeArchivedDayRows([localDay, serverDay].filter(Boolean), agentName, dateStr) || localDay || serverDay;
        if (day) this.cacheArchivedDay(day);
        return day && Array.isArray(day.details) ? this.filterSegmentsByDate(day.details, dateStr) : [];
    },

    getWorkingWindowBounds: function(dateStr) {
        return {
            workStart: new Date(`${dateStr}T08:00:00`).getTime(),
            meetingStart: new Date(`${dateStr}T11:00:00`).getTime(),
            meetingEnd: new Date(`${dateStr}T12:00:00`).getTime(),
            lunchStart: new Date(`${dateStr}T12:00:00`).getTime(),
            lunchEnd: new Date(`${dateStr}T13:00:00`).getTime(),
            workEnd: new Date(`${dateStr}T17:00:00`).getTime()
        };
    },

    getEffectiveDurationForDate: function(seg, dateStr) {
        const segStart = this.getSegmentStartMs(seg);
        const segEnd = this.getSegmentEndMs(seg);
        if (!segStart || !segEnd) return 0;

        const bounds = this.getWorkingWindowBounds(dateStr);
        const morningOverlap = Math.max(0, Math.min(segEnd, bounds.lunchStart) - Math.max(segStart, bounds.workStart));
        const afternoonOverlap = Math.max(0, Math.min(segEnd, bounds.workEnd) - Math.max(segStart, bounds.lunchEnd));
        return morningOverlap + afternoonOverlap;
    },

    getTimelineAxisBounds: function(dateStr) {
        const bounds = this.getWorkingWindowBounds(dateStr);
        const todayStr = this.getLocalDateString();
        const now = Date.now();
        const isToday = String(dateStr || '') === todayStr;
        let axisEnd = bounds.workEnd;
        if (isToday) {
            axisEnd = Math.max(bounds.workStart, Math.min(now, bounds.workEnd));
        }
        return {
            start: bounds.workStart,
            end: axisEnd,
            workEnd: bounds.workEnd,
            lunchStart: bounds.lunchStart,
            lunchEnd: bounds.lunchEnd
        };
    },

    getTimelineClockSlices: function(seg, dateStr, axisBounds = null) {
        const segStart = this.getSegmentStartMs(seg);
        const segEnd = this.getSegmentEndMs(seg);
        if (!segStart || !segEnd) return [];

        const bounds = this.getWorkingWindowBounds(dateStr);
        const axis = axisBounds || this.getTimelineAxisBounds(dateStr);
        const ranges = [
            [bounds.workStart, bounds.lunchStart],
            [bounds.lunchEnd, axis.end]
        ];

        return ranges.map(([rangeStart, rangeEnd]) => {
            const start = Math.max(segStart, rangeStart, axis.start);
            const end = Math.min(segEnd, rangeEnd, axis.end);
            return end > start ? { start, end, duration: end - start } : null;
        }).filter(Boolean);
    },

    buildTimelineTickHtml: function(dateStr, axisBounds = null) {
        const axis = axisBounds || this.getTimelineAxisBounds(dateStr);
        const total = Math.max(1, axis.end - axis.start);
        const tickStep = 30 * 60 * 1000;
        const ticks = [];
        const firstTick = Math.ceil(axis.start / tickStep) * tickStep;

        for (let ts = firstTick; ts <= axis.end; ts += tickStep) {
            const left = ((ts - axis.start) / total) * 100;
            const d = new Date(ts);
            const label = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            ticks.push(`<span class="timeline-clock-tick" style="left:${left}%;" title="${label}"><em>${label}</em></span>`);
        }

        return ticks.join('');
    },

    getCurrentSegmentForDate: function(activity, dateStr) {
        if (!activity || !activity.since) return null;
        const currentDuration = Date.now() - activity.since;
        if (currentDuration <= 1000) return null;

        const currentSeg = {
            activity: activity.current,
            start: activity.since,
            end: Date.now(),
            duration: currentDuration
        };

        return this.getSegmentDateString(currentSeg) === dateStr ? currentSeg : null;
    },

    getLiveSegmentsForDate: function(activity, dateStr) {
        const dateSegments = this.filterSegmentsByDate(activity?.history || [], dateStr);
        const currentSeg = this.getCurrentSegmentForDate(activity, dateStr);
        if (currentSeg) dateSegments.push(currentSeg);
        return dateSegments.sort((a, b) => this.getSegmentStartMs(a) - this.getSegmentStartMs(b));
    },

    getActivitySegmentsForDate: async function(agentName, dateStr) {
        const data = this.readLocalJson('monitor_data', {});
        const activity = data && data[agentName];
        const liveSegments = activity ? this.getLiveSegmentsForDate(activity, dateStr) : [];
        const archivedSegments = await this.getArchivedSegmentsForDate(agentName, dateStr);
        return this.mergeActivitySegments(liveSegments, archivedSegments)
            .filter(seg => this.getEffectiveDurationForDate(seg, dateStr) > 0);
    },

    // --- HELPER: LOCAL DATE STRING (YYYY-MM-DD) ---
    getLocalDateString: function(date = new Date()) {
        const now = date instanceof Date ? date : new Date(date);
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    },

    // --- HELPER: CENTRALIZED CLASSIFICATION (with Violation) ---
    getCategory: function(activityString) {
        if (!activityString) return 'idle';
        const act = activityString.toLowerCase();
        
        if (this.isViolationReviewException(act)) return 'tool';

        // 0. Violation is always external
        if (act.startsWith('violation:')) return 'external';
        if (act.startsWith('assessment:') || act.startsWith('live assessment:') || act.startsWith('vetting arena:')) return 'assessment';
        if (act.startsWith('portal navigation:') || act.startsWith('navigating:')) return 'portal';
        if (act.startsWith('in-app study:') || act.startsWith('study material:')) {
            return act.includes('(inactive') ? 'idle' : 'material';
        }
        if (act.startsWith('study tool:')) return 'tool';
        if (act.startsWith('communication:')) return 'tool';

        // Define keywords
        const materialKeywords = ['.pdf', '.mp4', 'genially', 'sharepoint', 'course', 'document', 'standards', 'training', 'vetting', 'study material', 'assessment overview', 'draw.io', 'drawio', 'diagrams.net'];
        const toolKeywords = ['qcontact', 'crm', 'radius', 'preseem', 'acs', 'hosting', 'odoo', 'cp1', 'cp2', 'cpanel', 'webmail', 'herotel webmail', 'teams', 'outlook', 'mail', 'notepad', 'onenote', 'macvendor', 'genieacs', 'devices - genieacs'];

        // 1. Check for specific material keywords
        if (materialKeywords.some(m => act.includes(m))) {
            return 'material';
        }

        // 2. Check for specific tool keywords
        if (toolKeywords.some(t => act.includes(t))) {
            return 'tool';
        }

        // 3. Check for generic prefixes
        if (act.startsWith('studying:')) {
            // If it's marked as studying but didn't match above, it's likely a tool or misc work.
            return 'tool';
        }
        if (act.startsWith('system:')) return 'tool';

        // 4. Fallback for whitelisted items that didn't match keywords
        const raw = act.replace(/^(external:\s*|violation:\s*|studying:\s*)/i, '').trim();
        if (this.cachedWhitelist.some(w => raw.includes(w.toLowerCase()))) {
            return 'tool';
        }

        if (act.startsWith('external:') || act.includes('external') || act.includes('background')) return 'external';
        if (act.startsWith('idle')) return 'idle'; // Match "Idle" and "Idle / Away"
        return 'idle'; // Default
    },

    // --- HELPER: CALCULATE DAILY STATS (Working Hours Only) ---
    calculateDailyStats: function(historySegments) {
        let totalMs = 0, materialMs = 0, toolMs = 0, assessmentMs = 0, portalMs = 0, extMs = 0, idleMs = 0;
        
        historySegments.forEach(seg => {
             const dateStr = this.getSegmentDateString(seg);
             const effectiveDuration = this.getEffectiveDurationForDate(seg, dateStr);
             
             if (effectiveDuration <= 0) return;

             totalMs += effectiveDuration;
             const category = this.getCategory(seg.activity);
             const config = this.readLocalJson('system_config', {});
             const TOLERANCE = config.monitoring ? config.monitoring.tolerance_ms : 180000;
             
             if (category === 'material') {
                 materialMs += effectiveDuration;
             } else if (category === 'tool') {
                 toolMs += effectiveDuration;
             } else if (category === 'assessment') {
                 assessmentMs += effectiveDuration;
             } else if (category === 'portal') {
                 portalMs += effectiveDuration;
             } else if (category === 'external') {
                 if (effectiveDuration > TOLERANCE) {
                     toolMs += TOLERANCE;
                     extMs += (effectiveDuration - TOLERANCE);
                 } else {
                     toolMs += effectiveDuration;
                 }
             } else {
                 if (effectiveDuration > TOLERANCE) {
                     toolMs += TOLERANCE;
                     idleMs += (effectiveDuration - TOLERANCE);
                 } else {
                     toolMs += effectiveDuration;
                 }
             }
        });
        
        return { material: materialMs, tool: toolMs, assessment: assessmentMs, portal: portalMs, study: materialMs + toolMs, external: extMs, idle: idleMs, total: totalMs };
    },

    // --- DAILY ARCHIVE LOGIC ---
    checkDailyReset: async function() {
        if (!CURRENT_USER || CURRENT_USER.role === 'admin') return;
        this.updateWhitelistCache(); // Ensure we use latest rules for archiving
        
        let monitorData = this.readLocalJson('monitor_data', {});
        if (!monitorData || typeof monitorData !== 'object' || Array.isArray(monitorData)) monitorData = {};
        let myData = monitorData[CURRENT_USER.user];
        
        if (myData) {
            // Determine Today (Local)
            const today = this.getLocalDateString();
            
            // Determine Last Date (Local) - Handle legacy data
            let lastDate = myData.date;
            if (!lastDate && myData.since) {
                const d = new Date(myData.since);
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                lastDate = `${y}-${m}-${day}`;
            }
            
            if (lastDate !== today) {
                console.log(`New Day Detected (${lastDate} -> ${today}). Archiving Activity Log...`);
                let history = this.readLocalJson('monitor_history', []);
                if (!Array.isArray(history)) history = [];
                
                // Use memory history if available (most recent), else fallback to storage
                const rawSegments = this.history.length > 0 ? this.history : (myData.history || []);
                const segments = this.filterSegmentsByDate(rawSegments, lastDate);
                const stats = this.calculateDailyStats(segments);

                this.cacheArchivedDay({
                    id: this.buildMonitorHistoryId(CURRENT_USER.user, lastDate),
                    date: lastDate,
                    user: CURRENT_USER.user,
                    summary: stats,
                    details: segments, // Archive full details
                    updatedAt: new Date().toISOString()
                });
                history = this.readLocalJson('monitor_history', []);
                if (!Array.isArray(history)) history = [];
                
                // NEW: Retention Policy (Keep last 30 days locally to prevent bloat)
                if (history.length > 30) {
                    history = history.slice(history.length - 30);
                }
                
                // SAFETY: Handle QuotaExceededError (Storage Full)
                try {
                    localStorage.setItem('monitor_history', JSON.stringify(history));
                } catch (e) {
                    console.warn("Storage Quota Exceeded. Stripping details from archive.");
                    // Fallback: Save only summaries, remove details from older entries
                    history.forEach(h => delete h.details);
                    try {
                        localStorage.setItem('monitor_history', JSON.stringify(history));
                    } catch (e2) {
                        console.error("Critical Storage Error: Could not save history.", e2);
                    }
                }
                
                // Reset Live Data for Today
                monitorData[CURRENT_USER.user] = { current: 'System: New Day Start', since: Date.now(), isStudyOpen: false, history: [], date: today };
                localStorage.setItem('monitor_data', JSON.stringify(monitorData));
                
                // RESET MEMORY
                this.history = [];
                this.startTime = Date.now(); // Reset start time for new day
                
                // ROBUSTNESS FIX: Use 'false' (Safe Merge) to prevent overwriting other users' history entries
                if (typeof saveToServer === 'function') await saveToServer(['monitor_data', 'monitor_history'], false);
            }
        }
    },

    // --- STUDY BROWSER REWORK ---
    setStudyOverlayInteractionState: function(isActive) {
        if (!document.body) return;
        document.body.classList.toggle('study-overlay-active', !!isActive);
    },

    setTabWebviewActiveState: function(tab, isActive) {
        const webview = tab && tab.webview ? tab.webview : null;
        if (!webview) return;

        webview.classList.toggle('hidden', !isActive);
        webview.style.pointerEvents = isActive ? 'auto' : 'none';
        webview.style.visibility = isActive ? 'visible' : 'hidden';
        webview.style.opacity = isActive ? '1' : '0';
        webview.style.zIndex = isActive ? '3' : '1';
        webview.style.left = isActive ? '0' : '-200vw';
        webview.style.top = '0';
        webview.style.transform = 'translate3d(0,0,0)';
    },

    openStudyWindow: function(url, title, targetScrollY = null) {
        const overlay = document.getElementById('study-overlay');
        if (!overlay) return;
        if (!this.isStudyBrowserUrl(url)) {
            this.openExternalUrl(url);
            return;
        }
        this.enforceStudyNotesPolicy({ silent: true });

        // Remove restore button if it was floating
        const restoreBtn = document.getElementById('study-restore-btn');
        if (restoreBtn) restoreBtn.remove();

        this.isStudyOpen = true;
        this.lastStudyEngagementAt = Date.now();
        this.track(this.buildInAppStudyLabel(title));
        this.browserState.homeUrl = this.cleanUrl(url);
        this.startStudyEngagementPoller();

        // Build browser shell if it doesn't exist
        if (!document.getElementById('study-browser-shell')) {
            overlay.innerHTML = this.getBrowserShellHTML();
            this.attachNavEvents();
            this.addTab(url, title, true, targetScrollY); // Add and activate the first tab
        } else {
            // Shell exists (was hidden), check if tab already exists to prevent duplicates
            const cleanUrl = this.cleanUrl(url);
            // FIX: Match ONLY by URL to prevent overwriting different tabs with the same generic title
            const existingTab = this.browserState.tabs.find(t => t.url === cleanUrl);
            if (existingTab) {
                this.switchTab(existingTab.id);
                if (targetScrollY && existingTab.webview) {
                    existingTab.webview.executeJavaScript(`window.scrollTo({top: ${targetScrollY}, behavior: 'smooth'})`).catch(()=>{});
                }
            } else {
                this.addTab(url, title, true, targetScrollY);
            }
        }

        overlay.classList.remove('hidden');
        this.setStudyOverlayInteractionState(true);
        this.updateBrowserChrome();
        if (this.studyNotesDockOpen) this.refreshStudyNotesDock();
    },

    minimizeStudyWindow: function() {
        const overlay = document.getElementById('study-overlay');
        if (overlay) overlay.classList.add('hidden');
        this.setStudyOverlayInteractionState(false);
        this.isStudyOpen = false;
        this.track("Portal Navigation: Dashboard (Study Minimized)");
        
        // Add persistent floating button to return to tabs
        if (!document.getElementById('study-restore-btn')) {
            const btn = document.createElement('button');
            btn.id = 'study-restore-btn';
            btn.className = 'btn-primary';
            btn.innerHTML = '<i class="fas fa-book-open"></i> Active Study Session (Click to Return)';
            btn.style.cssText = 'position:fixed; bottom:12px; left:50%; transform:translateX(-50%); width:min(560px, calc(100vw - 48px)); z-index:99999; box-shadow:0 10px 30px rgba(243, 112, 33, 0.45); border-radius:22px; padding:12px 20px; font-weight:bold; font-size:1rem; background: var(--primary); color: white; animation: pulse 2s infinite; border: 2px solid rgba(255,255,255,0.85); cursor: pointer;';
            btn.onclick = () => StudyMonitor.restoreStudyWindow();
            document.body.appendChild(btn);
        }
    },

    restoreStudyWindow: function() {
        const overlay = document.getElementById('study-overlay');
        if (overlay) overlay.classList.remove('hidden');
        this.setStudyOverlayInteractionState(true);
        this.isStudyOpen = true;
        this.enforceStudyNotesPolicy({ silent: true });
        
        const activeTab = this.browserState.tabs.find(t => t.id === this.browserState.activeTabId);
        if (activeTab) {
            this.recordStudyEngagement('restore');
            this.track(this.buildStudyContextLabel(activeTab));
        } else {
            this.track("Portal Navigation: Study Browser");
        }
        
        const btn = document.getElementById('study-restore-btn');
        if (btn) btn.remove();
    },

    closeStudyWindow: function() {
        const overlay = document.getElementById('study-overlay');
        if (overlay) overlay.classList.add('hidden');
        this.setStudyOverlayInteractionState(false);
        this.closeStudyNotesDock();
        
        // Cleanup
        this.isStudyOpen = false;
        this.browserState.tabs = [];
        this.browserState.activeTabId = null;
        this.browserState.homeUrl = null;
        this.stopStudyEngagementPoller();
        if (overlay) overlay.innerHTML = ''; // Destroy webviews and UI

        const btn = document.getElementById('study-restore-btn');
        if (btn) btn.remove();

        this.track("Portal Navigation: Schedule"); // Assume return to schedule
    },

    getBrowserShellHTML: function() {
        const quickLinks = [
            { name: "Q-Contact", url: "https://herotel.qcontact.com/login" },
            { name: "CRM", url: "https://crm.herotel.com" },
            { name: "Radius", url: "https://radius.herotel.com" },
            { name: "Odoo", url: "https://odoo.herotel.com/web#cids=1&menu_id=1040&action=1653" },
            { name: "ACS", url: "https://acs.herotel.systems" },
            { name: "Hosting", url: "https://hosting.herotel.com/login" },
            { name: "Preseem", url: "https://app.preseem.com" }
        ];

        return `
            <div id="study-browser-shell">
                <div class="study-header study-toolbar">
                    <div class="study-location-panel">
                        <div class="study-browser-label"><i class="fas fa-shield-halved"></i> Secure Study Browser</div>
                        <div id="study-current-title" class="study-current-title" title="Secure Study Browser">Secure Study Browser</div>
                    </div>
                </div>
                <div class="study-tabbar">
                    <div class="study-tabs-container">
                        <div id="study-tabs-list"></div>
                    </div>
                </div>
                <div class="study-control-deck">
                    <div class="study-nav-controls">
                        <button type="button" id="study-nav-back" class="study-control-btn" title="Go back"><i class="fas fa-arrow-left"></i><span>Back</span></button>
                        <button type="button" id="study-nav-forward" class="study-control-btn" title="Go forward"><i class="fas fa-arrow-right"></i><span>Forward</span></button>
                        <button type="button" id="study-nav-reload" class="study-control-btn" title="Reload this page"><i class="fas fa-rotate-right"></i><span>Reload</span></button>
                        <button type="button" id="study-nav-home" class="study-control-btn" title="Return to the first study page"><i class="fas fa-house"></i><span>Home</span></button>
                    </div>
                    <div class="study-header-actions">
                        <button type="button" id="study-notes-toggle-btn" class="study-action-btn study-action-secondary" title="Open Study Notes next to your training material">
                            <i class="fas fa-note-sticky"></i> Study Notes
                        </button>
                        <button type="button" id="study-notes-popout-btn" class="study-action-btn study-action-secondary" title="Open Study Notes in a separate window for a second screen">
                            <i class="fas fa-up-right-from-square"></i> Pop Out Notes
                        </button>
                        <button type="button" id="study-tab-popout-btn" class="study-action-btn study-action-secondary" title="Pop out the active study tab into a separate app window">
                            <i class="fas fa-window-restore"></i> Pop Out Tab
                        </button>
                        <button type="button" id="study-bookmark-btn" class="study-action-btn study-action-secondary" title="Mark a specific spot to ask for clarity later">
                            <i class="fas fa-crop-alt"></i> Mark for Clarity
                        </button>
                        <button type="button" id="study-clear-cache-btn" class="study-action-btn study-action-secondary" title="Clear browser cache/cookies for Microsoft sign-in troubleshooting">
                            <i class="fas fa-broom"></i> Clear Browser Cache
                        </button>
                        <button type="button" id="study-min-btn" class="study-action-btn study-action-primary" title="Keep this study session open and return to the dashboard">
                            <i class="fas fa-desktop"></i> Dashboard
                        </button>
                        <label class="study-quick-links-wrap">
                            <span class="study-quick-links-label">Program Links</span>
                            <select id="study-quick-links" class="study-quick-links">
                            <option value="">Program Links</option>
                            ${quickLinks.map(l => `<option value="${l.url}">${l.name}</option>`).join('')}
                            </select>
                        </label>
                        <button type="button" id="study-close-btn" class="study-action-btn study-action-danger" title="Close all study tabs and exit">
                            <i class="fas fa-times"></i> Exit
                        </button>
                    </div>
                </div>
                <div class="study-workspace-layout">
                    <div id="study-webview-container" class="study-webview-stack"></div>
                    <aside id="study-notes-dock" class="study-notes-dock hidden">
                        <div class="study-notes-dock-head">
                            <div class="study-notes-dock-title"><i class="fas fa-note-sticky"></i> Study Notes</div>
                            <div class="study-notes-dock-actions">
                                <button type="button" id="study-notes-dock-popout-btn" class="btn-secondary btn-sm" title="Move notes to a second screen"><i class="fas fa-up-right-from-square"></i></button>
                                <button type="button" id="study-notes-dock-close-btn" class="btn-secondary btn-sm" title="Hide notes panel"><i class="fas fa-times"></i></button>
                            </div>
                        </div>
                        <iframe
                            id="study-notes-dock-frame"
                            src=""
                            title="Study Notes Dock"
                            style="width:100%; height:100%; border:none; background:var(--bg-card);"
                        ></iframe>
                    </aside>
                </div>
            </div>
        `;
    },

    attachNavEvents: function() {
        document.getElementById('study-nav-back').onclick = () => this.goBackActiveTab();
        document.getElementById('study-nav-forward').onclick = () => this.goForwardActiveTab();
        document.getElementById('study-nav-reload').onclick = () => this.reloadActiveTab();
        document.getElementById('study-nav-home').onclick = () => this.goHomeActiveTab();
        document.getElementById('study-notes-toggle-btn').onclick = () => this.toggleStudyNotesDock();
        document.getElementById('study-notes-popout-btn').onclick = () => this.openStudyNotesPopout();
        document.getElementById('study-tab-popout-btn').onclick = () => this.popOutActiveTab();
        document.getElementById('study-notes-dock-popout-btn').onclick = () => this.openStudyNotesPopout();
        document.getElementById('study-notes-dock-close-btn').onclick = () => this.closeStudyNotesDock();
        document.getElementById('study-bookmark-btn').onclick = () => this.startMarkForClarity();
        document.getElementById('study-clear-cache-btn').onclick = () => this.clearStudyBrowserCache();
        document.getElementById('study-min-btn').onclick = () => this.minimizeStudyWindow();
        document.getElementById('study-close-btn').onclick = () => this.closeStudyWindow();
        document.getElementById('study-quick-links').onchange = (event) => this.navigateQuickLink(event.target.value);
        this.closeStudyNotesDock();
        this.updateBrowserChrome();
    },

    navigateQuickLink: function(url) {
        if (!url) return;
        const sel = document.getElementById('study-quick-links');
        const title = sel.options[sel.selectedIndex].text;
        
        // FIX: Always open Quick Links in a new tab to prevent overwriting active study material
        this.addTab(url, title, true);
        
        sel.selectedIndex = 0; // Reset dropdown
    },

    startMarkForClarity: function() {
        const wv = this.getActiveWebview();
        if (!wv) return alert("No active tab to mark.");
        
        const script = `
            (function() {
                if(window.__markActive) return;
                window.__markActive = true;

                var overlay = document.createElement('div');
                overlay.style.position = 'fixed';
                overlay.style.top = '0'; overlay.style.left = '0';
                overlay.style.width = '100vw'; overlay.style.height = '100vh';
                overlay.style.zIndex = '2147483647';
                overlay.style.cursor = 'crosshair';
                overlay.style.background = 'rgba(0,0,0,0.2)';
                
                var banner = document.createElement('div');
                banner.style.position = 'absolute';
                banner.style.top = '20px';
                banner.style.left = '50%';
                banner.style.transform = 'translateX(-50%)';
                banner.style.background = '#f1c40f';
                banner.style.color = '#000';
                banner.style.padding = '10px 20px';
                banner.style.borderRadius = '30px';
                banner.style.fontWeight = 'bold';
                banner.style.fontFamily = 'sans-serif';
                banner.style.pointerEvents = 'none';
                banner.innerText = "Click and drag to mark a specific area for clarity. (Press ESC to cancel)";
                overlay.appendChild(banner);

                document.body.appendChild(overlay);

                var box = document.createElement('div');
                box.style.position = 'absolute';
                box.style.border = '3px dashed #f1c40f';
                box.style.background = 'rgba(241, 196, 15, 0.3)';
                box.style.pointerEvents = 'none';
                document.body.appendChild(box);

                var startX, startY;
                var isDrawing = false;

                var onMouseDown = function(e) {
                    isDrawing = true;
                    startX = e.clientX;
                    startY = e.clientY;
                    box.style.left = startX + 'px';
                    box.style.top = startY + 'px';
                    box.style.width = '0px';
                    box.style.height = '0px';
                };

                var onMouseMove = function(e) {
                    if(!isDrawing) return;
                    var currentX = e.clientX;
                    var currentY = e.clientY;
                    box.style.left = Math.min(currentX, startX) + 'px';
                    box.style.top = Math.min(currentY, startY) + 'px';
                    box.style.width = Math.abs(currentX - startX) + 'px';
                    box.style.height = Math.abs(currentY - startY) + 'px';
                };

                var onMouseUp = function(e) {
                    if(!isDrawing) return;
                    isDrawing = false;
                    
                    var rect = box.getBoundingClientRect();
                    var targetY = window.scrollY + rect.top;
                    var selection = window.getSelection().toString();

                    cleanup();
                    
                    var marker = document.createElement('div');
                    marker.style.position = 'absolute';
                    marker.style.left = '0';
                    marker.style.top = targetY + 'px';
                    marker.style.width = '8px';
                    marker.style.height = Math.max(20, rect.height) + 'px';
                    marker.style.background = '#f1c40f';
                    marker.style.zIndex = '2147483646';
                    marker.style.borderTopRightRadius = '4px';
                    marker.style.borderBottomRightRadius = '4px';
                    marker.title = "Marked for Clarity";
                    document.body.appendChild(marker);

                    console.log('__MARK_CLARITY__:' + JSON.stringify({ scrollY: targetY, selection: selection }));
                };

                var onKeyDown = function(e) {
                    if(e.key === 'Escape') cleanup();
                };

                var cleanup = function() {
                    overlay.removeEventListener('mousedown', onMouseDown);
                    overlay.removeEventListener('mousemove', onMouseMove);
                    overlay.removeEventListener('mouseup', onMouseUp);
                    document.removeEventListener('keydown', onKeyDown);
                    if(overlay.parentNode) overlay.remove();
                    if(box.parentNode) box.remove();
                    window.__markActive = false;
                };

                overlay.addEventListener('mousedown', onMouseDown);
                overlay.addEventListener('mousemove', onMouseMove);
                overlay.addEventListener('mouseup', onMouseUp);
                document.addEventListener('keydown', onKeyDown);
            })();
        `;
        wv.executeJavaScript(script).catch(e => console.error("Mark Script Injection Failed", e));
    },

    processMarkForClarity: async function(dataStr, tabId) {
        const data = JSON.parse(dataStr);
        const tab = this.browserState.tabs.find(t => t.id === tabId);
        if(!tab) return;
        const wv = tab.webview;

        let url = wv.getURL();
        let title = wv.getTitle();
        let scrollY = data.scrollY || 0;
        let selection = data.selection || "";

        // HIDE ENTIRE STUDY OVERLAY TO SHOW PROMPT (Fixes Z-Index and native PDF viewer issues)
        const overlay = document.getElementById('study-overlay');
        if(overlay) overlay.style.display = 'none';
        
        const inputModal = document.getElementById('genericInputModal');
        if(inputModal) inputModal.style.zIndex = '2147483647';
        
        let promptMsg = `Page: ${title}\n\n`;
        if (selection && selection.trim().length > 0) {
            promptMsg += `Highlighted Text: "${selection.substring(0, 100)}..."\n\n`;
        }
        promptMsg += `What do you need clarity on for this marked section? (Required)`;
        
        const note = await customPrompt("Mark for Clarity", promptMsg, "");
        
        // RESTORE OVERLAY IMMEDIATELY
        if(overlay) overlay.style.display = '';

        if (note === null) return; // Cancelled
        if (note.trim() === "") return alert("A clarification question or note is required.");
        
        let finalNote = note.trim();
        if (selection && selection.trim().length > 0) {
            finalNote = `Context: "${selection.substring(0, 100)}"\nQuestion: ${finalNote}`;
        }

        const allBookmarks = this.readLocalJson('trainee_bookmarks', {});
        if (!allBookmarks || typeof allBookmarks !== 'object' || Array.isArray(allBookmarks)) return;
        const bookmarks = allBookmarks[CURRENT_USER.user] || [];
        bookmarks.push({
            id: Date.now(), url: url, title: title.substring(0, 50), note: finalNote, scrollY: scrollY, date: new Date().toISOString()
        });
        
        allBookmarks[CURRENT_USER.user] = bookmarks;
        localStorage.setItem('trainee_bookmarks', JSON.stringify(allBookmarks));
        if (typeof saveToServer === 'function') saveToServer(['trainee_bookmarks'], false);
        
        if (typeof showToast === 'function') showToast("Spot marked for clarity! Check your Dashboard.", "success");
    },

    addTab: function(url, title, activate = false, targetScrollY = null) {
        const tabId = this.buildTabId();
        const cleanUrl = this.cleanUrl(url);
        if (!this.isStudyBrowserUrl(cleanUrl)) {
            this.openExternalUrl(cleanUrl);
            return;
        }
        const webview = document.createElement('webview');
        webview.id = `webview-${tabId}`;
        webview.src = cleanUrl;
        webview.dataset.domReady = '0';
        webview.dataset.navReady = '0';
        webview.style.width = '100%';
        webview.style.height = '100%';
        webview.style.position = 'absolute';
        webview.style.top = '0';
        webview.style.left = '0';
        // REQUIRED: Allows target="_blank" links to fire the 'new-window' event so we can intercept them.
        webview.setAttribute('allowpopups', 'true');
        // DEFUSAL 2: Strict Microsoft Edge Spoofing to bypass SSO Conditional Access blocks
        webview.setAttribute('useragent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0');
        // UX ENHANCEMENT: Force persistent session for cookies to survive app restarts
        webview.setAttribute('partition', 'persist:study_session');
        webview.classList.add('study-webview');
        this.setTabWebviewActiveState({ webview }, !!activate);

        const container = document.getElementById('study-webview-container');
        container.appendChild(webview);

        const newTab = {
            id: tabId,
            title: title.substring(0, 20),
            url: cleanUrl,
            webview: webview,
            targetScrollY: targetScrollY,
            canGoBackCached: false,
            canGoForwardCached: false,
            usedCachedFallback: false,
            cpanelRecoveryAttempted: false
        };
        this.browserState.tabs.push(newTab);

        this.renderTabs();
        this.attachWebviewEvents(newTab);

        if (activate) {
            this.switchTab(tabId);
        } else {
            this.updateBrowserChrome();
        }
    },

    switchTab: function(tabId) {
        this.browserState.activeTabId = tabId;
        this.browserState.tabs.forEach(tab => {
            const isHidden = tab.id !== tabId;
            this.setTabWebviewActiveState(tab, !isHidden);
        });
        const activeTab = this.browserState.tabs.find(t => t.id === tabId);
        if (activeTab && activeTab.webview && typeof activeTab.webview.focus === 'function') {
            setTimeout(() => {
                try { activeTab.webview.focus(); } catch (e) {}
            }, 50);
            this.recordStudyEngagement('tab-switch');
            this.track(this.buildStudyContextLabel(activeTab));
        }
        this.renderTabs();
        this.updateBrowserChrome();
    },

    closeTab: function(tabId) {
        const tabIndex = this.browserState.tabs.findIndex(t => t.id === tabId);
        if (tabIndex === -1) return;

        const tabToClose = this.browserState.tabs[tabIndex];
        tabToClose.webview.remove();

        this.browserState.tabs.splice(tabIndex, 1);

        if (this.browserState.tabs.length === 0) {
            this.closeStudyWindow();
        } else {
            if (this.browserState.activeTabId === tabId) {
                const newActiveIndex = Math.max(0, tabIndex - 1);
                this.switchTab(this.browserState.tabs[newActiveIndex].id);
            }
            this.renderTabs();
            this.updateBrowserChrome();
        }
    },

    renderTabs: function() {
        const tabsList = document.getElementById('study-tabs-list');
        if (!tabsList) return;
        tabsList.innerHTML = this.browserState.tabs.map(tab => {
            const isActive = tab.id === this.browserState.activeTabId;
            return `
                <button type="button" class="study-tab ${isActive ? 'active' : ''}" onclick="StudyMonitor.switchTab('${tab.id}')" title="${this.escapeHtml(tab.title)}">
                    <span class="study-tab-title">${tab.title}</span>
                    <span class="study-tab-popout" role="presentation" title="Pop out this tab" onclick="event.stopPropagation(); StudyMonitor.popOutActiveTab('${tab.id}')"><i class="fas fa-up-right-from-square"></i></span>
                    <span class="study-tab-close" role="presentation" onclick="event.stopPropagation(); StudyMonitor.closeTab('${tab.id}')"><i class="fas fa-times"></i></span>
                </button>
            `;
        }).join('');
    },

    getActiveWebview: function() {
        if (!this.browserState.activeTabId) return null;
        const activeTab = this.browserState.tabs.find(t => t.id === this.browserState.activeTabId);
        return activeTab ? activeTab.webview : null;
    },

    attachWebviewEvents: function(tab) {
        const webview = tab.webview;
        
        webview.addEventListener('did-start-loading', () => {
            webview.dataset.navReady = '0';
            tab.usedCachedFallback = false;
            tab.cpanelRecoveryAttempted = false;
            tab.title = 'Loading...';
            this.recordStudyEngagement('navigation-start');
            this.renderTabs();
            this.updateBrowserChrome();
        });

        webview.addEventListener('did-stop-loading', () => {
            webview.dataset.navReady = '1';
            try {
                const currentUrl = webview.getURL();
                if (currentUrl) tab.url = currentUrl;
            } catch (e) {}
            let newTitle = tab.title || 'Study Tab';
            try {
                newTitle = (webview.getTitle() || tab.title || 'Study Tab').substring(0, 20);
            } catch (error) {
                console.warn('Study webview title unavailable yet:', error);
            }
            tab.title = newTitle;
            this.refreshTabNavigationState(tab);
            this.renderTabs();
            this.updateBrowserChrome();
            this.installStudyEngagementProbe(tab);
            this.recordStudyEngagement('page-loaded');
            if (!String(tab.url || '').startsWith('data:')) {
                this.cacheStudyPageLocally(tab);
            }
            this.recoverCpanelServerError(tab);
            
            // Restore Scroll Position if requested
            if (tab.targetScrollY) {
                setTimeout(() => {
                    webview.executeJavaScript(`window.scrollTo({top: ${tab.targetScrollY}, behavior: 'smooth'})`).catch(()=>{});
                    tab.targetScrollY = null; // Clear after use to prevent re-scrolls on normal navigation
                }, 500);
            }
        });

        // ARCHITECTURAL FIX: SPAs (Single Page Apps like Q-Contact, CRM, SharePoint)
        // change titles dynamically without triggering 'did-navigate'.
        // We must track 'page-title-updated' to capture what they are actually doing inside the app.
        webview.addEventListener('page-title-updated', (e) => {
            tab.title = e.title.substring(0, 20);
            this.refreshTabNavigationState(tab);
            this.renderTabs();
            this.updateBrowserChrome();
            
            if (this.browserState.activeTabId === tab.id) {
                this.recordStudyEngagement('title-updated');
                this.track(this.buildStudyContextLabel(tab));
            }
        });

        webview.addEventListener('did-navigate', (e) => {
            tab.url = e.url;
            if (!String(e.url || '').startsWith('data:')) tab.usedCachedFallback = false;
            this.refreshTabNavigationState(tab);
            this.updateBrowserChrome();
            this.recordStudyEngagement('navigation');
            this.track(this.buildStudyContextLabel(tab));
        });

        webview.addEventListener('did-navigate-in-page', (e) => {
            tab.url = e.url;
            if (!String(e.url || '').startsWith('data:')) tab.usedCachedFallback = false;
            this.refreshTabNavigationState(tab);
            this.updateBrowserChrome();
            this.recordStudyEngagement('in-page-navigation');
        });

        webview.addEventListener('new-window', (e) => {
            if (this.isCpanelTransferUrl(e.url)) {
                return;
            }
            e.preventDefault();
            if (this.isCpanelCompatibilityUrl(e.url)) {
                this.handleSpawnedStudyUrl(e.url, "cPanel");
            } else if (!window.electronAPI?.ipcRenderer) {
                this.handleSpawnedStudyUrl(e.url, "New Tab");
            }
        });

        webview.addEventListener('did-fail-load', (e) => {
            if (e.errorCode === -3) return; // user/navigation cancellation
            const failedUrl = String(e.validatedURL || tab.url || '').trim();
            const canUseFallback = failedUrl && !failedUrl.startsWith('data:') && !tab.usedCachedFallback;
            if (canUseFallback) {
                const cachedPage = this.getCachedStudyPage(failedUrl);
                if (cachedPage) {
                    const cachedHtml = this.buildCachedStudyDocument(cachedPage, failedUrl, e.errorDescription || 'Unknown error');
                    const dataUrl = `data:text/html;charset=UTF-8,${encodeURIComponent(cachedHtml)}`;
                    tab.usedCachedFallback = true;
                    tab.title = 'Cached Copy';
                    this.renderTabs();
                    this.updateBrowserChrome();
                    webview.loadURL(dataUrl).catch(() => {});
                    if (typeof showToast === 'function') {
                        showToast('Loaded local cached copy for this study page.', 'warning');
                    }
                    return;
                }
            }
            tab.title = 'Load Failed';
            tab.canGoBackCached = false;
            tab.canGoForwardCached = false;
            this.renderTabs();
            this.updateBrowserChrome();
            if (typeof showToast === 'function') {
                showToast(`Study page failed to load: ${e.errorDescription || 'Unknown error'}`, 'error');
            }
        });

        webview.addEventListener('crashed', () => {
            this.track("System: Study Window Crashed");
            this.closeTab(tab.id);
        });

        webview.addEventListener('dom-ready', () => {
            webview.dataset.domReady = '1';
            setTimeout(() => this.refreshTabNavigationState(tab), 100);
            this.installStudyEngagementProbe(tab);
            webview.executeJavaScript(`
                document.addEventListener('click', () => { console.log('__STUDY_CLICK__'); });
            `);
        });

        webview.addEventListener('console-message', (e) => {
            if (e.message === '__STUDY_CLICK__') {
                this.recordStudyEngagement('click');
            } else if (typeof e.message === 'string' && e.message.startsWith('__MARK_CLARITY__:')) {
                const dataStr = e.message.substring(17);
                this.processMarkForClarity(dataStr, tab.id);
            }
        });
    },

    recoverCpanelServerError: function(tab) {
        const webview = tab?.webview;
        const currentUrl = String(tab?.url || '').trim();
        if (!webview || !webview.isConnected || !currentUrl || tab.cpanelRecoveryAttempted) return;
        if (!this.isCpanelCompatibilityUrl(currentUrl)) return;
        const safeEntryUrl = this.getCpanelSafeEntryUrl(currentUrl);
        if (currentUrl === safeEntryUrl) return;

        const detectScript = `
            (function() {
                const text = ((document.body && document.body.innerText) || '').slice(0, 1000);
                const title = document.title || '';
                return /Internal Server Error/i.test(text + ' ' + title) && /cpsrvd Server/i.test(text);
            })();
        `;

        webview.executeJavaScript(detectScript, true).then((isCpanelServerError) => {
            if (!isCpanelServerError || tab.cpanelRecoveryAttempted) return;
            tab.cpanelRecoveryAttempted = true;
            tab.url = safeEntryUrl;
            tab.title = 'cPanel Login';
            this.renderTabs();
            this.updateBrowserChrome();
            if (typeof showToast === 'function') {
                showToast('cPanel returned a server error, so the study browser reopened the WHM login page.', 'warning');
            }
            webview.loadURL(safeEntryUrl).catch((error) => {
                console.warn('cPanel recovery navigation failed:', error);
            });
        }).catch(() => {});
    },

    reload: function() {
        const webview = this.getActiveWebview();
        if (webview) {
            webview.reload();
        }
    },

    // --- URL CLEANER (SharePoint & PDF) ---
    cleanUrl: function(url) {
        let working = String(url || '').trim().replace(/^<|>$/g, '');
        if (!working) return '';

        try {
            const parsed = new URL(working, window.location.href);
            const host = parsed.hostname.toLowerCase();
            if (host.includes('safelinks.protection.outlook.com')) {
                const safeTarget = parsed.searchParams.get('url') || parsed.searchParams.get('u') || '';
                if (safeTarget) {
                    let decoded = safeTarget;
                    for (let i = 0; i < 2; i++) {
                        try { decoded = decodeURIComponent(decoded); } catch (e) { break; }
                    }
                    if (/^https?:\/\//i.test(decoded)) return decoded;
                }
            }
            const isMicrosoftLink =
                host.includes('sharepoint.com') ||
                host.includes('onedrive.com') ||
                host.includes('microsoftonline.com') ||
                host.includes('office.com') ||
                host.includes('safelinks.protection.outlook.com');

            // User request: preserve Microsoft links exactly as entered.
            if (isMicrosoftLink) return working;

            // 2. PDF tools: hide browser UI chrome when we can confidently detect PDF content.
            const pathLower = parsed.pathname.toLowerCase();
            const fileParam = (parsed.searchParams.get('file') || '').toLowerCase();
            const sourceParam = decodeURIComponent(parsed.searchParams.get('sourceurl') || '').toLowerCase();
            const looksLikePdf = pathLower.endsWith('.pdf') || fileParam.endsWith('.pdf') || sourceParam.includes('.pdf');
            if (looksLikePdf && !parsed.hash) {
                parsed.hash = 'toolbar=0&navpanes=0&view=FitH';
            }
            return parsed.toString();
        } catch (e) {
            return working; // Ignore invalid URLs; preserve original input.
        }
    },

    // --- WIDGET HELPER: GET SCHEDULED AGENTS ---
    getScheduledAgents: function() {
        const schedules = this.readLocalJson('schedules', {});
        const rosters = this.readLocalJson('rosters', {});
        const scheduledAgents = new Set();
        
        // If isDateInRange is not available (schedule.js not loaded), fallback to all
        const hasDateCheck = typeof isDateInRange === 'function';

        Object.values(schedules || {}).forEach(sched => {
            if (sched.assigned && rosters[sched.assigned]) {
                // Check if this schedule is active TODAY
                let isActiveToday = false;
                if (hasDateCheck && sched.items) {
                    isActiveToday = sched.items.some(item => isDateInRange(item.dateRange, item.dueDate));
                } else {
                    isActiveToday = true; // Fallback
                }

                if (isActiveToday) {
                    rosters[sched.assigned].forEach(agent => scheduledAgents.add(agent));
                }
            }
        });
        return Array.from(scheduledAgents);
    },

    getAllTrainees: function() {
        const users = this.readLocalJson('users', []);
        return (Array.isArray(users) ? users : [])
            .filter(u => u && u.role === 'trainee' && u.user)
            .map(u => u.user)
            .sort((a, b) => a.localeCompare(b));
    },

    getAgentGroupId: function(agentName) {
        const rosters = this.readLocalJson('rosters', {});
        const target = String(agentName || '').trim().toLowerCase();
        if (!target) return '';
        for (const [gid, members] of Object.entries(rosters || {})) {
            if (Array.isArray(members) && members.some(m => String(m || '').trim().toLowerCase() === target)) {
                return String(gid || '');
            }
        }
        return '';
    },

    getGroupLabel: function(groupId) {
        const raw = String(groupId || '').trim();
        if (!raw) return 'No Group';
        const schedules = this.readLocalJson('schedules', {});
        const schedule = Object.values(schedules || {}).find(s => String(s?.assigned || '') === raw);
        const explicitName = String(schedule?.groupName || schedule?.name || '').trim();
        if (explicitName) return explicitName;
        const match = raw.match(/^(\d{4})[-_/]?(\d{1,2})(?:[-_/]?([A-Z]))?$/i);
        if (match) {
            const year = match[1];
            const monthIndex = Math.max(0, Math.min(11, Number(match[2]) - 1));
            const month = new Date(Number(year), monthIndex, 1).toLocaleString('en-ZA', { month: 'short' });
            return `${month} ${year}${match[3] ? ` Group ${match[3].toUpperCase()}` : ''}`;
        }
        return `Group ${raw}`;
    },

    getMonitorGroups: function() {
        const rosters = this.readLocalJson('rosters', {});
        return Object.entries(rosters || {})
            .filter(([, members]) => Array.isArray(members) && members.length > 0)
            .map(([id, members]) => ({ id: String(id), label: this.getGroupLabel(id), count: members.length }))
            .sort((a, b) => a.label.localeCompare(b.label));
    },

    getVisibleAgents: function() {
        const baseAgents = this.monitorScope === 'all' ? this.getAllTrainees() : this.getScheduledAgents();
        const search = String(this.monitorSearch || '').trim().toLowerCase();
        const group = String(this.monitorGroupFilter || '').trim();
        return baseAgents.filter(agent => {
            if (search && !String(agent || '').toLowerCase().includes(search)) return false;
            if (group && this.getAgentGroupId(agent) !== group) return false;
            return true;
        });
    },

    setMonitorScope: function(scope) {
        this.monitorScope = scope === 'all' ? 'all' : 'scheduled';
        this.forceRefresh = true;
        renderActivityMonitorContent();
    },

    setMonitorSearch: function(value) {
        this.monitorSearch = String(value || '');
        renderActivityMonitorContent();
    },

    setMonitorGroupFilter: function(value) {
        this.monitorGroupFilter = String(value || '');
        renderActivityMonitorContent();
    },

    escapeHtml: function(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    formatDuration: function(ms) {
        const safeMs = Math.max(0, Number(ms) || 0);
        const totalSeconds = Math.floor(safeMs / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        if (hours > 0) return `${hours}h ${minutes}m`;
        if (minutes > 0) return `${minutes}m ${seconds}s`;
        return `${seconds}s`;
    },

    isProductiveCategory: function(category) {
        return category === 'material' || category === 'tool';
    },

    getCurrentTaskForAgent: function(agentName) {
        const schedules = this.readLocalJson('schedules', {});
        const rosters = this.readLocalJson('rosters', {});
        let myGroupId = null;

        for (const [gid, members] of Object.entries(rosters || {})) {
            if (Array.isArray(members) && members.some(m => String(m).toLowerCase() === String(agentName).toLowerCase())) {
                myGroupId = gid;
                break;
            }
        }

        if (!myGroupId) return 'No group assigned';

        const schedKey = Object.keys(schedules).find(k => schedules[k]?.assigned === myGroupId);
        if (!schedKey || !Array.isArray(schedules[schedKey]?.items)) return `Group ${myGroupId}`;

        const todayStr = this.getLocalDateString().replace(/-/g, '/');
        const task = schedules[schedKey].items.find(i => {
            if (typeof isDateInRange === 'function') return isDateInRange(i.dateRange, i.dueDate, todayStr);
            return i.dateRange <= todayStr && (i.dueDate ? i.dueDate >= todayStr : i.dateRange >= todayStr);
        });

        return task?.courseName || `Group ${myGroupId}`;
    },

    simplifyActivityName: function(activityString) {
        const raw = String(activityString || '').replace(/^(Studying:\s*|Study Material:\s*|Study Tool:\s*|Communication:\s*|Assessment:\s*|Live Assessment:\s*|Vetting Arena:\s*|Portal Navigation:\s*|External:\s*|Violation:\s*|Idle:\s*|System:\s*|Navigating:\s*)/i, '').trim();
        if (!raw) return 'No activity reported';

        if (raw.includes('sharepoint.com') || raw.includes('microsoftonline.com')) {
            if (raw.includes('.mp4') || raw.toLowerCase().includes('stream.aspx')) return 'SharePoint training video';
            return 'SharePoint training document';
        }
        if (/^(in-app study:|study material:|study tool:)/i.test(String(activityString || ''))) {
            return raw.replace(/\s*\[(.*?)\]\s*$/, '').trim();
        }
        if (raw.toLowerCase().includes('qcontact')) return 'Q-Contact';
        if (raw.toLowerCase().includes('crm')) return 'CRM';
        if (raw.toLowerCase().includes('radius')) return 'Radius';
        if (raw.toLowerCase().includes('preseem')) return 'Preseem';
        if (raw.toLowerCase().includes('odoo')) return 'Odoo';
        if (raw.toLowerCase().includes('teams')) return 'Microsoft Teams';
        if (raw.toLowerCase().includes('outlook') || raw.toLowerCase().includes('mail')) return 'Email';
        return raw.replace(/\s*\[(.*?)\]\s*$/, '').trim();
    },

    getReadableActivity: function(activity) {
        const current = activity?.current || 'No Data';
        const category = this.getCategory(current);
        const pretty = this.simplifyActivityName(current);

        if (current === 'No Data') {
            return {
                headline: 'No live activity reported yet',
                detail: 'This device has not sent a current activity update yet.'
            };
        }
        if (current.startsWith('Violation')) {
            return {
                headline: `Attention needed: ${pretty}`,
                detail: 'This is being treated as outside the approved training or work tools.'
            };
        }
        if (current.startsWith('External')) {
            return {
                headline: `Outside work tools: ${pretty}`,
                detail: 'The active app or window is not currently classified as training or work related.'
            };
        }
        if (current.toLowerCase().startsWith('study material:')) {
            return {
                headline: `Trusted study: ${pretty}`,
                detail: current.toLowerCase().includes('(inactive')
                    ? 'Study material is open, but no recent page engagement was detected.'
                    : 'This activity happened inside the secured in-app study browser and is treated as active study time.'
            };
        }
        if (category === 'assessment') {
            return {
                headline: `Assessment mode: ${pretty}`,
                detail: 'Live assessment and vetting activity is tracked separately from study or idle time.'
            };
        }
        if (category === 'portal') {
            return {
                headline: `Portal navigation: ${pretty}`,
                detail: 'Moving through the app is valid activity, but it is not counted as active studying.'
            };
        }
        if (category === 'material') {
            return {
                headline: `Learning material: ${pretty}`,
                detail: 'Working in study content or training material.'
            };
        }
        if (category === 'tool') {
            return {
                headline: `Work tool: ${pretty}`,
                detail: 'Working inside an approved support or communication tool.'
            };
        }
        if (current.toLowerCase().includes('idle')) {
            return {
                headline: 'Away from desk',
                detail: 'No recent keyboard or mouse activity was detected.'
            };
        }
        return {
            headline: pretty,
            detail: 'Current activity is being tracked normally.'
        };
    },

    getStatusMeta: function(activity) {
        const current = activity?.current || 'No Data';
        const category = this.getCategory(current);

        if (current === 'No Data') return { label: 'No Data Yet', className: 'status-fail', accent: '#95a5a6' };
        if (current.startsWith('Violation')) return { label: 'Attention Needed', className: 'status-fail', accent: '#ff5252' };
        if (current.startsWith('External')) return { label: 'Outside Work', className: 'status-improve', accent: '#f39c12' };
        if (category === 'assessment') return { label: 'Assessment', className: 'status-pass', accent: '#8e44ad' };
        if (this.isProductiveCategory(category)) return { label: 'On Task', className: 'status-pass', accent: '#2ecc71' };
        if (category === 'portal') return { label: 'In Portal', className: 'status-improve', accent: '#f1c40f' };
        if (current.toLowerCase().includes('idle')) return { label: 'Away / Idle', className: 'status-fail', accent: '#95a5a6' };
        return { label: 'In Portal', className: 'status-improve', accent: '#f1c40f' };
    },

    getScopeSummaryStats: function(agentNames, data) {
        return agentNames.reduce((acc, agent) => {
            const activity = data[agent] || { current: 'No Data' };
            const current = activity.current || 'No Data';
            const category = this.getCategory(current);

            acc.total += 1;
            if (current === 'No Data') acc.noData += 1;
            else if (current.startsWith('Violation') || current.startsWith('External')) acc.attention += 1;
            else if (category === 'assessment' || this.isProductiveCategory(category)) acc.onTask += 1;
            else acc.idle += 1;
            return acc;
        }, { total: 0, onTask: 0, attention: 0, idle: 0, noData: 0 });
    },

    getPendingViolationReviewCount: function(agent = null) {
        const target = String(agent || '').trim().toLowerCase();
        return this.getViolationReports().filter(report => {
            if (target && String(report.user || '').trim().toLowerCase() !== target) return false;
            return !report.reviewed && String(report.status || 'pending_review') !== 'reviewed';
        }).length;
    },

    getViolationReportCountForAgent: function(agent) {
        const target = String(agent || '').trim().toLowerCase();
        if (!target) return { total: 0, pending: 0 };
        return this.getViolationReports().reduce((acc, report) => {
            if (String(report.user || '').trim().toLowerCase() !== target) return acc;
            acc.total += 1;
            if (!report.reviewed && String(report.status || 'pending_review') !== 'reviewed') acc.pending += 1;
            return acc;
        }, { total: 0, pending: 0 });
    },

    renderScopeControls: function() {
        const pendingViolations = this.getPendingViolationReviewCount();
        return `
            <div class="btn-group">
                <button class="${this.monitorScope === 'scheduled' ? 'active' : ''}" onclick="StudyMonitor.setMonitorScope('scheduled')">Scheduled Today</button>
                <button class="${this.monitorScope === 'all' ? 'active' : ''}" onclick="StudyMonitor.setMonitorScope('all')">All Trainees</button>
            </div>
            <button class="btn-secondary btn-sm violation-review-btn" onclick="StudyMonitor.openViolationReviewModal()" title="Review submitted violation explanations">
                <i class="fas fa-triangle-exclamation" style="color:#ff5252;"></i>
                ${pendingViolations > 0 ? `<span class="violation-review-count">${pendingViolations}</span>` : ''}
            </button>
        `;
    },

    renderMonitorGroupOptions: function() {
        const groups = this.getMonitorGroups();
        return ['<option value="">All Groups</option>']
            .concat(groups.map(group => `<option value="${this.escapeHtml(group.id)}" ${this.monitorGroupFilter === group.id ? 'selected' : ''}>${this.escapeHtml(group.label)} (${group.count})</option>`))
            .join('');
    }
};

StudyMonitor.toggleSummary = function() {
    this.viewMode = 'summary';
    renderActivityMonitorContent();
};

// --- ADMIN ACTIVITY MONITOR MODAL ---

let ACTIVITY_MONITOR_INTERVAL = null;

window.openActivityMonitorModal = function() {
    StudyMonitor.viewMode = 'summary';
    if (typeof showTab === 'function' && document.getElementById('activity-monitor-view')) {
        showTab('activity-monitor-view');
    }
    renderActivityMonitorContent();
    if(ACTIVITY_MONITOR_INTERVAL) clearInterval(ACTIVITY_MONITOR_INTERVAL);
    ACTIVITY_MONITOR_INTERVAL = setInterval(renderActivityMonitorContent, 180000); // 3 Minutes
};

window.closeActivityMonitorModal = function() {
    const view = document.getElementById('activity-monitor-view');
    if (view && view.classList.contains('active') && typeof showTab === 'function') {
        showTab('dashboard-view');
    }
    if(ACTIVITY_MONITOR_INTERVAL) clearInterval(ACTIVITY_MONITOR_INTERVAL);
};

function renderActivityMonitorContent() {
    const container = document.getElementById('activityMonitorContent');
    if(!container) return;
    renderActivitySummary(container);
}

// --- QUEUE SELECTION HELPERS ---
StudyMonitor.toggleQueueItem = function(val, checked) {
    if (checked) this.queueSelection.add(val);
    else this.queueSelection.delete(val);
    // Update button text
    const btn = document.getElementById('btnBulkClassify');
    if(btn) btn.innerText = `Classify Selected (${this.queueSelection.size})`;
};

StudyMonitor.toggleAgentHistory = function(safeId) {
    const details = document.getElementById(`mon_det_${safeId}`);
    const btn = document.getElementById(`mon_toggle_${safeId}`);
    if (!details || !btn) return;

    const willExpand = details.classList.contains('hidden');
    details.classList.toggle('hidden', !willExpand);
    btn.innerHTML = willExpand
        ? '<i class="fas fa-chevron-up"></i> Hide Recent Activity'
        : '<i class="fas fa-history"></i> Show Recent Activity';
    btn.setAttribute('aria-expanded', willExpand ? 'true' : 'false');
};

function renderReviewQueue(container) {
    const data = StudyMonitor.readLocalJson('monitor_data', {});
    const whitelistRaw = StudyMonitor.readLocalJson('monitor_whitelist', []);
    const reviewedRaw = StudyMonitor.readLocalJson('monitor_reviewed', []);
    const whitelist = (Array.isArray(whitelistRaw) ? whitelistRaw : []).filter(s => s && s.trim());
    const reviewed = (Array.isArray(reviewedRaw) ? reviewedRaw : []).filter(s => s && s.trim());
    const groups = {}; // Group by Process ID [proc]
    const ungrouped = new Set();
    
    Object.values(data || {}).forEach(userActivity => {
        const processItem = (act) => {
            if ((act.startsWith('External: ') || act.startsWith('Violation: ')) && !act.includes('(Reclassified)')) {
                const raw = act.replace(/^(External:\s*|Violation:\s*)/, '').trim();
                
                // Check if already whitelisted (Partial match)
                if (whitelist.some(w => raw.toLowerCase().includes(w.trim().toLowerCase()))) return;
                // Check if already reviewed/dismissed (Partial match)
                if (reviewed.some(r => raw.toLowerCase().includes(r.trim().toLowerCase()))) return;

                const match = raw.match(/\[(.*?)\]$/); // Extract [process]
                if (match) {
                    const proc = match[1].toLowerCase();
                    if (!groups[proc]) groups[proc] = new Set();
                    groups[proc].add(raw);
                } else {
                    ungrouped.add(raw);
                }
            }
        };

        (userActivity.history || []).forEach(h => processItem(h.activity));
        processItem(userActivity.current);
    });
    
    let html = `
        <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <h3>Unclassified Activities (External)</h3>
                <button id="btnBulkClassify" class="btn-primary btn-sm" onclick="StudyMonitor.bulkClassifyAction()">Classify Selected (${StudyMonitor.queueSelection.size})</button>
            </div>
            <p style="color:var(--text-muted); margin-bottom:15px;">Grouped by Application. Classifying a process will whitelist it for everyone.</p>
    `;
    
    const sortedProcs = Object.keys(groups).sort();
    
    if (sortedProcs.length === 0 && ungrouped.size === 0) {
        html += `<div style="text-align:center; padding:20px; color:var(--text-muted);">No unclassified external activities found.</div>`;
    } else {
        // Render Process Groups
        sortedProcs.forEach(proc => {
            const items = Array.from(groups[proc]);
            // Check if all items in this group are selected (optional UI polish, skipping for simplicity)
            
            html += `
            <div style="margin-bottom:15px; border:1px solid var(--border-color); border-radius:6px; overflow:hidden;">
                <div style="background:var(--bg-input); padding:10px; display:flex; justify-content:space-between; align-items:center;">
                    <strong><i class="fas fa-cog"></i> ${proc.toUpperCase()}</strong>
                    <button class="btn-secondary btn-sm" onclick="StudyMonitor.classifyActivity('[${proc}]')">Whitelist App</button>
                </div>
                <div style="padding:5px;">
                    ${items.map(item => {
                        const isChecked = StudyMonitor.queueSelection.has(item) ? 'checked' : '';
                        return `
                        <div style="display:flex; justify-content:space-between; padding:5px; border-bottom:1px dashed var(--border-color); font-size:0.85rem;">
                            <label style="display:flex; align-items:center; gap:10px; cursor:pointer; flex:1; margin:0;"><input type="checkbox" class="q-check" value="${item.replace(/"/g, '&quot;')}" onchange="StudyMonitor.toggleQueueItem(this.value, this.checked)" ${isChecked}> ${item}</label>
                            <button class="btn-secondary btn-sm" style="padding:0 5px; font-size:0.7rem;" onclick="StudyMonitor.classifyActivity('${item.replace(/'/g, "\\'")}')">Classify This</button>
                        </div>
                    `}).join('')}
                </div>
            </div>`;
        });

        // Render Ungrouped
        if (ungrouped.size > 0) {
            html += `<div style="margin-top:15px;"><strong>Other</strong></div>`;
            Array.from(ungrouped).forEach(item => {
                const isChecked = StudyMonitor.queueSelection.has(item) ? 'checked' : '';
                html += `<div style="display:flex; justify-content:space-between; padding:5px; border-bottom:1px solid var(--border-color);">
                    <label style="display:flex; align-items:center; gap:10px; cursor:pointer; flex:1; margin:0;"><input type="checkbox" class="q-check" value="${item.replace(/"/g, '&quot;')}" onchange="StudyMonitor.toggleQueueItem(this.value, this.checked)" ${isChecked}> ${item}</label>
                    <button class="btn-secondary btn-sm" onclick="StudyMonitor.classifyActivity('${item.replace(/'/g, "\\'")}')">Classify</button>
                </div>`;
            });
        }
    }
    
    html += `</div>`;
    container.innerHTML = html;
}

function renderActivityMonitorWorkspace(container) {
    const data = StudyMonitor.readLocalJson('monitor_data', {});
    const targetAgents = StudyMonitor.getVisibleAgents();
    const stats = StudyMonitor.getScopeSummaryStats(targetAgents, data);
    const todayStr = StudyMonitor.getLocalDateString();
    const groupOptions = StudyMonitor.renderMonitorGroupOptions();
    const searchValue = StudyMonitor.escapeHtml(StudyMonitor.monitorSearch || '');
    const activeIds = new Set();

    if (!container.querySelector('.activity-monitor-workspace')) {
        container.innerHTML = `
            <div class="activity-monitor-workspace">
                <div class="activity-monitor-pagebar">
                    <div>
                        <div class="dash-eyebrow">Agent Activity Monitor</div>
                        <h2>Live Activity Timeline</h2>
                        <p>Focused timeline view for study, work tools, assessments, portal movement, idle time, and violations.</p>
                    </div>
                    <div class="activity-monitor-page-actions">
                        <button class="btn-secondary btn-sm" onclick="renderActivityMonitorContent()"><i class="fas fa-rotate"></i> Refresh</button>
                        <button class="btn-secondary btn-sm" onclick="StudyMonitor.openViolationReviewModal()"><i class="fas fa-triangle-exclamation"></i> Violations</button>
                        <button class="btn-secondary btn-sm" onclick="StudyMonitor.archiveLog()"><i class="fas fa-broom"></i> Clear Live Feed</button>
                        <button class="btn-secondary btn-sm" onclick="closeActivityMonitorModal()"><i class="fas fa-arrow-left"></i> Back</button>
                    </div>
                </div>
                <div class="activity-monitor-controls">
                    <label>
                        <span>Search trainee</span>
                        <input id="activityMonitorSearch" type="search" placeholder="Search by name..." value="${searchValue}" oninput="StudyMonitor.setMonitorSearch(this.value)">
                    </label>
                    <label>
                        <span>Group</span>
                        <select id="activityMonitorGroupFilter" onchange="StudyMonitor.setMonitorGroupFilter(this.value)">${groupOptions}</select>
                    </label>
                    <div class="activity-monitor-scope">
                        ${StudyMonitor.renderScopeControls()}
                    </div>
                </div>
                <div class="activity-monitor-stats" id="activity-monitor-stats"></div>
                <div class="activity-monitor-list" id="activityMonitorList"></div>
            </div>
        `;
    } else {
        const search = document.getElementById('activityMonitorSearch');
        if (search && search.value !== StudyMonitor.monitorSearch) search.value = StudyMonitor.monitorSearch || '';
        const group = document.getElementById('activityMonitorGroupFilter');
        if (group) group.innerHTML = groupOptions;
        const scope = container.querySelector('.activity-monitor-scope');
        if (scope) scope.innerHTML = StudyMonitor.renderScopeControls();
    }

    const statsEl = document.getElementById('activity-monitor-stats');
    if (statsEl) {
        statsEl.innerHTML = `
            <div class="activity-monitor-stat-card">
                <span class="activity-monitor-stat-label">Visible Agents</span>
                <strong class="activity-monitor-stat-value">${stats.total}</strong>
            </div>
            <div class="activity-monitor-stat-card">
                <span class="activity-monitor-stat-label">On Task</span>
                <strong class="activity-monitor-stat-value" style="color:#2ecc71;">${stats.onTask}</strong>
            </div>
            <div class="activity-monitor-stat-card">
                <span class="activity-monitor-stat-label">Attention Needed</span>
                <strong class="activity-monitor-stat-value" style="color:#f39c12;">${stats.attention}</strong>
            </div>
            <div class="activity-monitor-stat-card">
                <span class="activity-monitor-stat-label">Away or No Data</span>
                <strong class="activity-monitor-stat-value" style="color:#95a5a6;">${stats.idle + stats.noData}</strong>
            </div>
        `;
    }

    const list = document.getElementById('activityMonitorList');
    if (!list) return;

    if (targetAgents.length === 0) {
        list.innerHTML = `
            <div class="activity-monitor-empty">
                <i class="fas fa-users-slash"></i>
                <div>No trainees match the current filters.</div>
            </div>`;
        return;
    }

    const buildSummary = (agent, activity) => {
        const allSegments = StudyMonitor.getLiveSegmentsForDate(activity, todayStr);
        let totalMs = 0, materialMs = 0, toolMs = 0, assessmentMs = 0, portalMs = 0, extMs = 0, idleMs = 0;
        let timelineHtml = '';
        const config = StudyMonitor.readLocalJson('system_config', {});
        const TOLERANCE = config.monitoring ? config.monitoring.tolerance_ms : 180000;

        allSegments.forEach(seg => {
            const effectiveDuration = StudyMonitor.getEffectiveDurationForDate(seg, todayStr);
            if (effectiveDuration <= 0) return;
            totalMs += effectiveDuration;
            const category = StudyMonitor.getCategory(seg.activity);
            if (category === 'material') materialMs += effectiveDuration;
            else if (category === 'tool') toolMs += effectiveDuration;
            else if (category === 'assessment') assessmentMs += effectiveDuration;
            else if (category === 'portal') portalMs += effectiveDuration;
            else if (category === 'external') {
                if (effectiveDuration > TOLERANCE) extMs += (effectiveDuration - TOLERANCE);
            } else if (effectiveDuration > TOLERANCE) {
                idleMs += (effectiveDuration - TOLERANCE);
            }
        });

        if (totalMs > 0) {
            allSegments.forEach(seg => {
                const effectiveDuration = StudyMonitor.getEffectiveDurationForDate(seg, todayStr);
                if (effectiveDuration <= 0) return;
                const pct = Math.max(0.75, (effectiveDuration / totalMs) * 100);
                const category = StudyMonitor.getCategory(seg.activity);
                let style = '';
                let typeClass = 'seg-idle';
                if (category === 'material') typeClass = 'seg-material';
                else if (category === 'tool') typeClass = 'seg-tool';
                else if (category === 'assessment') style = 'background:#8e44ad;';
                else if (category === 'portal') style = 'background:#f1c40f;';
                else if (category === 'external') typeClass = effectiveDuration > TOLERANCE ? 'seg-ext' : 'seg-tool';
                timelineHtml += `<div class="timeline-seg ${typeClass}" style="width:${pct}%;${style}" title="${StudyMonitor.escapeHtml(seg.activity)} (${StudyMonitor.formatDuration(effectiveDuration)})"></div>`;
            });
        }

        return {
            totalMs,
            materialMs,
            toolMs,
            assessmentMs,
            portalMs,
            extMs,
            idleMs,
            timelineHtml: timelineHtml || '<div class="activity-monitor-no-timeline">No working-hours activity</div>'
        };
    };

    targetAgents.sort().forEach(agent => {
        const activity = data[agent] || { current: 'No Data', since: Date.now(), isStudyOpen: false, history: [] };
        const safeId = agent.replace(/[^a-zA-Z0-9]/g, '_');
        const rowId = `activity_row_${safeId}`;
        activeIds.add(rowId);
        const groupId = StudyMonitor.getAgentGroupId(agent);
        const groupLabel = StudyMonitor.getGroupLabel(groupId);
        const taskLabel = StudyMonitor.getCurrentTaskForAgent(agent);
        const readable = StudyMonitor.getReadableActivity(activity);
        const status = StudyMonitor.getStatusMeta(activity);
        const violationCounts = StudyMonitor.getViolationReportCountForAgent(agent);
        const summary = buildSummary(agent, activity);
        const durationMs = activity.since ? (Date.now() - activity.since) : 0;

        let row = document.getElementById(rowId);
        if (!row) {
            row = document.createElement('article');
            row.id = rowId;
            row.className = 'activity-monitor-row';
            list.appendChild(row);
        }

        row.style.borderLeftColor = status.accent;
        row.innerHTML = `
            <div class="activity-monitor-row-main">
                <div class="activity-monitor-person">
                    <div class="activity-monitor-avatar">${StudyMonitor.escapeHtml(agent.charAt(0).toUpperCase())}</div>
                    <div>
                        <h3>${StudyMonitor.escapeHtml(agent)}</h3>
                        <div>${StudyMonitor.escapeHtml(groupLabel)} · ${StudyMonitor.escapeHtml(taskLabel)}</div>
                    </div>
                </div>
                <div class="activity-monitor-now">
                    <span class="status-badge ${status.className}">${StudyMonitor.escapeHtml(status.label)}</span>
                    <strong>${StudyMonitor.escapeHtml(readable.headline)}</strong>
                    <small>${StudyMonitor.escapeHtml(readable.detail)} · Current for ${StudyMonitor.formatDuration(durationMs)}</small>
                </div>
                <div class="activity-monitor-row-actions">
                    ${violationCounts.total > 0 ? `<button class="activity-monitor-violation-icon ${violationCounts.pending > 0 ? '' : 'reviewed'}" onclick="StudyMonitor.openViolationReviewModal('${agent.replace(/'/g, "\\'")}')" title="Review violation reports for ${StudyMonitor.escapeHtml(agent)}"><i class="fas fa-triangle-exclamation"></i>${violationCounts.pending > 0 ? violationCounts.pending : violationCounts.total}</button>` : ''}
                    <button class="btn-secondary btn-sm" onclick="StudyMonitor.expandTimeline('${agent.replace(/'/g, "\\'")}')"><i class="fas fa-chart-line"></i> Detail</button>
                </div>
            </div>
            <div class="activity-monitor-row-metrics">
                <span><strong>${Math.round(summary.materialMs / 60000)}m</strong> Material</span>
                <span><strong>${Math.round(summary.toolMs / 60000)}m</strong> Tools</span>
                <span><strong>${Math.round(summary.assessmentMs / 60000)}m</strong> Assess</span>
                <span><strong>${Math.round(summary.portalMs / 60000)}m</strong> Portal</span>
                <span><strong>${Math.round(summary.extMs / 60000)}m</strong> External</span>
                <span><strong>${Math.round(summary.idleMs / 60000)}m</strong> Idle</span>
            </div>
            <div class="timeline-visual activity-monitor-row-timeline" onclick="StudyMonitor.expandTimeline('${agent.replace(/'/g, "\\'")}')" title="Open timeline detail">${summary.timelineHtml}</div>
        `;
    });

    Array.from(list.children).forEach(child => {
        if (child.id && child.id.startsWith('activity_row_') && !activeIds.has(child.id)) child.remove();
    });
}

function renderActivitySummary(container) {
    renderActivityMonitorWorkspace(container);
    return;

    StudyMonitor.updateWhitelistCache(); // Refresh cache before rendering
    const data = StudyMonitor.readLocalJson('monitor_data', {});
    const targetAgents = StudyMonitor.getVisibleAgents();
    
    // Ensure container has a grid wrapper if empty
    if (!container.querySelector('.summary-grid')) {
        container.innerHTML = '<div class="summary-grid" id="summaryGridContainer"></div>';
    }
    const grid = document.getElementById('summaryGridContainer');
    
    if(targetAgents.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-muted);">No agents found to summarize.</div>';
        return;
    }

    const activeIds = new Set();
    
    targetAgents.sort().forEach(agent => {
        const activity = (data && data[agent]) || { history: [], current: 'No Data', since: Date.now() };
        const todayStr = StudyMonitor.getLocalDateString();
        const safeId = agent.replace(/[^a-zA-Z0-9]/g, '_');
        
        // --- ADMIN UX: FETCH TODAY'S SCHEDULED TASK ---
        const schedules = StudyMonitor.readLocalJson('schedules', {});
        const rosters = StudyMonitor.readLocalJson('rosters', {});
        let todaysTask = "No Task Assigned";
        let myGroupId = null;
        for (const [gid, members] of Object.entries(rosters || {})) {
            if (Array.isArray(members) && members.some(m => m.toLowerCase() === agent.toLowerCase())) { myGroupId = gid; break; }
        }
        if (myGroupId) {
            const schedKey = Object.keys(schedules).find(k => schedules[k].assigned === myGroupId);
            if (schedKey && schedules[schedKey].items) {
                const todayStr = StudyMonitor.getLocalDateString().replace(/-/g, '/');
                const task = schedules[schedKey].items.find(i => {
                    if (typeof isDateInRange === 'function') return isDateInRange(i.dateRange, i.dueDate, todayStr);
                    return i.dateRange <= todayStr && (i.dueDate ? i.dueDate >= todayStr : i.dateRange >= todayStr);
                });
                if (task) todaysTask = task.courseName;
            }
        }

        // 1. Aggregate Data
        let totalMs = 0, materialMs = 0, toolMs = 0, assessmentMs = 0, portalMs = 0, extMs = 0, idleMs = 0;
        const topicMap = {};
        const allSegments = StudyMonitor.getLiveSegmentsForDate(activity, todayStr);

        allSegments.forEach(seg => {
            // --- WORKING HOURS LOGIC (8am-5pm, Lunch 12-1) ---
            // Calculate effective duration within working hours
            const effectiveDuration = StudyMonitor.getEffectiveDurationForDate(seg, todayStr);
            
            if (effectiveDuration <= 0) return; // Skip non-working hours

            totalMs += effectiveDuration;
            const category = StudyMonitor.getCategory(seg.activity);
            
            // TOLERANCE: Activities < 3 mins are considered "Quick Checks" or "Thinking" (Productive)
            // Only > 3 mins counts as Distraction/Idle (Concern)
            const config = StudyMonitor.readLocalJson('system_config', {});
            const TOLERANCE = config.monitoring ? config.monitoring.tolerance_ms : 180000;
            
            if (category === 'material') {
                materialMs += effectiveDuration;
                let topic = seg.activity.replace(/^(Studying:\s*|Study Material:\s*)/i, '').split('(')[0].trim();
                // URL CLEANUP
                if (topic.includes('sharepoint.com') || topic.includes('microsoftonline.com')) {
                    if (topic.includes('.mp4') || topic.includes('stream.aspx')) topic = 'Training Video (SharePoint)';
                    else topic = 'Training Document (SharePoint)';
                }
                if (!topicMap[topic]) topicMap[topic] = { ms: 0, type: 'material' };
                topicMap[topic].ms += effectiveDuration;
            } else if (category === 'tool') {
                toolMs += effectiveDuration;
                let topic = seg.activity.replace(/^(Studying:\s*|Study Tool:\s*|Communication:\s*)/i, '').split('(')[0].trim();
                if (!topicMap[topic]) topicMap[topic] = { ms: 0, type: 'tool' };
                topicMap[topic].ms += effectiveDuration;
            } else if (category === 'assessment') {
                assessmentMs += effectiveDuration;
                let topic = seg.activity.replace(/^(Assessment:\s*|Live Assessment:\s*|Vetting Arena:\s*)/i, '').split('(')[0].trim() || 'Assessment / Vetting';
                if (!topicMap[topic]) topicMap[topic] = { ms: 0, type: 'assessment' };
                topicMap[topic].ms += effectiveDuration;
            } else if (category === 'portal') {
                portalMs += effectiveDuration;
                let topic = seg.activity.replace(/^(Portal Navigation:\s*|Navigating:\s*)/i, '').split('(')[0].trim() || 'Portal Navigation';
                if (!topicMap[topic]) topicMap[topic] = { ms: 0, type: 'portal' };
                topicMap[topic].ms += effectiveDuration;
            } else if (category === 'external') {
                let topic = seg.activity.replace(/^(External:\s*|Violation:\s*)/i, '').trim();
                const isViolation = seg.activity.toLowerCase().includes('violation');
                
                if (!topicMap[topic]) topicMap[topic] = { ms: 0, type: isViolation ? 'violation' : 'external' }; 
                if (effectiveDuration > TOLERANCE) {
                    // LENIENT MODE: Forgive the first X minutes (TOLERANCE) as "Transition/Setup"
                    toolMs += TOLERANCE;
                    extMs += (effectiveDuration - TOLERANCE);
                    topicMap[topic].type = isViolation ? 'violation' : 'external';
                } else {
                    toolMs += effectiveDuration; // Tolerated
                }
                topicMap[topic].ms += effectiveDuration;
            } else {
                // Track Idle as a topic for visibility in breakdown
                const topic = "Idle / Away";
                if (!topicMap[topic]) topicMap[topic] = { ms: 0, type: 'idle' };

                if (effectiveDuration > TOLERANCE) {
                    toolMs += TOLERANCE; // Thinking time
                    idleMs += (effectiveDuration - TOLERANCE);
                }
                else toolMs += effectiveDuration; // Thinking time
                topicMap[topic].ms += effectiveDuration;
            }
        });

        // 2. Calculate Stats
        // FIX: Handle 0ms (e.g. before 8am) to show N/A instead of 0% Fail
        let focusScore = 0;
        let materialScore = 0;
        let scoreText = 'N/A';
        let matText = 'N/A';
        let scoreColor = 'var(--text-muted)'; // Default Grey

        if (totalMs > 0) {
            focusScore = Math.round(((materialMs + toolMs + assessmentMs) / totalMs) * 100);
            materialScore = Math.round((materialMs / totalMs) * 100);
            scoreText = focusScore + '%';
            matText = materialScore + '%';
            
            if (materialScore < 30) scoreColor = '#ff5252'; 
            else if (materialScore < 60) scoreColor = '#f1c40f';
            else scoreColor = '#3498db'; 
        }

        const matTimeStr = Math.round(materialMs / 60000) + 'm';
        const toolTimeStr = Math.round(toolMs / 60000) + 'm';
        const assessmentTimeStr = Math.round(assessmentMs / 60000) + 'm';
        const portalTimeStr = Math.round(portalMs / 60000) + 'm';
        const extTimeStr = Math.round(extMs / 60000) + 'm';
        const idleTimeStr = Math.round(idleMs / 60000) + 'm';

        // 3. Precise Activity Breakdown
        const matTopics = Object.entries(topicMap).filter(t => t[1].type === 'material').sort((a,b)=>b[1].ms - a[1].ms);
        const toolTopics = Object.entries(topicMap).filter(t => t[1].type === 'tool').sort((a,b)=>b[1].ms - a[1].ms);
        const assessmentTopics = Object.entries(topicMap).filter(t => t[1].type === 'assessment').sort((a,b)=>b[1].ms - a[1].ms);
        const portalTopics = Object.entries(topicMap).filter(t => t[1].type === 'portal').sort((a,b)=>b[1].ms - a[1].ms);
        const extTopics = Object.entries(topicMap).filter(t => t[1].type === 'external').sort((a,b)=>b[1].ms - a[1].ms);
        const vioTopics = Object.entries(topicMap).filter(t => t[1].type === 'violation').sort((a,b)=>b[1].ms - a[1].ms);

        let breakdownHtml = '';
        
        const renderList = (title, items, color, icon) => {
            if (items.length === 0) return '';
            let html = `<div style="font-size:0.75rem; font-weight:bold; color:${color}; margin-top:5px; padding-bottom:2px; border-bottom:1px solid ${color}55;"><i class="fas ${icon}"></i> ${title}</div>`;
            items.forEach(([topic, data]) => {
                const timeStr = data.ms < 60000 ? '< 1m' : Math.round(data.ms/60000) + 'm';
                const actionBtn = (data.type === 'external' || data.type === 'violation') ? `<button class="btn-secondary btn-sm" style="padding:0 4px; font-size:0.6rem; margin-left:5px;" onclick="StudyMonitor.classifyActivity('${topic.replace(/'/g, "\\'")}')" title="Classify Activity"><i class="fas fa-edit"></i></button>` : '';
                html += `<div style="display:flex; justify-content:space-between; font-size:0.8rem; padding:2px 0;">
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:75%;" title="${topic}">${topic}</span>
                    <span>${timeStr}${actionBtn}</span>
                </div>`;
            });
            return html;
        };

        breakdownHtml += renderList('Training Material', matTopics, '#3498db', 'fa-book-open');
        breakdownHtml += renderList('Study / Work Tools', toolTopics, '#2ecc71', 'fa-tools');
        breakdownHtml += renderList('Live Assessment / Vetting', assessmentTopics, '#8e44ad', 'fa-clipboard-check');
        breakdownHtml += renderList('Portal Navigation', portalTopics, '#f1c40f', 'fa-location-arrow');
        breakdownHtml += renderList('External / Browsing', extTopics, '#f39c12', 'fa-external-link-alt');
        breakdownHtml += renderList('Security Violations', vioTopics, '#ff5252', 'fa-exclamation-triangle');
        
        if (matTopics.length===0 && toolTopics.length===0 && assessmentTopics.length===0 && portalTopics.length===0 && extTopics.length===0 && vioTopics.length===0) {
            breakdownHtml += '<div style="color:var(--text-muted); font-style:italic; font-size:0.8rem; text-align:center; padding:10px;">No specific activities logged.</div>';
        }

        // 4. Build Timeline Bar
        // Normalize segments to percentages
        let timelineHtml = '';
        if (totalMs > 0) {
            allSegments.forEach(seg => {
                // --- WORKING HOURS LOGIC (Re-calc for Timeline accuracy) ---
                const segStart = seg.start || (seg.end - seg.duration);
                const segEnd = seg.end || (segStart + seg.duration);
                
                const effectiveDuration = StudyMonitor.getEffectiveDurationForDate(seg, todayStr);
                
                if (effectiveDuration <= 0) return;

                const pct = (effectiveDuration / totalMs) * 100;
                if (pct < 0.5) return; // Skip tiny slivers
                
                const cat = StudyMonitor.getCategory(seg.activity);
                const config = StudyMonitor.readLocalJson('system_config', {});
                const TOLERANCE = config.monitoring ? config.monitoring.tolerance_ms : 180000;
                
                let typeClass = 'seg-idle'; // Default
                let style = `width:${pct}%;`;
                let title = `${seg.activity} (${Math.round(effectiveDuration/1000)}s)`;
                
                if (cat === 'material') {
                    typeClass = 'seg-material';
                } else if (cat === 'tool') {
                    typeClass = 'seg-tool';
                } else if (cat === 'assessment') {
                    typeClass = 'seg-tool';
                    style += `background:#8e44ad;`;
                } else if (cat === 'portal') {
                    typeClass = 'seg-tool';
                    style += `background:#f1c40f;`;
                } else if (cat === 'external') {
                    if (effectiveDuration > TOLERANCE) {
                        typeClass = 'seg-ext';
                    } else {
                        // Tolerated External -> Striped Green/Orange
                        style += `background: repeating-linear-gradient(45deg, #2ecc71, #2ecc71 5px, #f1c40f 5px, #f1c40f 10px);`;
                        title = `[Tolerated] ${seg.activity} (${Math.round(effectiveDuration/1000)}s)`;
                    }
                } else {
                    if (effectiveDuration > TOLERANCE) {
                        typeClass = 'seg-idle';
                    } else {
                        // Tolerated Idle -> Striped Green/Grey
                        style += `background: repeating-linear-gradient(45deg, #2ecc71, #2ecc71 5px, #95a5a6 5px, #95a5a6 10px);`;
                        title = `[Thinking] ${seg.activity} (${Math.round(effectiveDuration/1000)}s)`;
                    }
                }
                
                timelineHtml += `<div class="timeline-seg ${typeClass}" style="${style}" title="${title}"></div>`;
            });
        } else {
            timelineHtml = '<div style="width:100%; text-align:center; font-size:0.7rem; color:var(--text-muted); padding-top:2px;">No activity recorded</div>';
        }

        // 5. DOM Update (Silent / No Flicker)
        const cardId = `sum_card_${safeId}`;
        activeIds.add(cardId);

        let card = document.getElementById(cardId);
        if (!card) {
            // Create Skeleton Structure ONCE
            card = document.createElement('div');
            card.id = cardId;
            card.className = 'summary-card';
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:15px;">
                    <div>
                        <h3 style="margin:0;">${agent}</h3>
                        <div style="font-size:0.75rem; color:var(--primary); font-weight:bold; margin-top:2px;" title="Scheduled Task for Today"><i class="fas fa-bullseye"></i> Target: ${todaysTask}</div>
                        <div id="sum_total_${safeId}" style="font-size:0.8rem; color:var(--text-muted);"></div>
                        <div id="sum_vio_${safeId}"></div>
                    </div>
                    <div style="display:flex; gap:15px; text-align:right;">
                        <div>
                            <div id="sum_mat_score_${safeId}" class="focus-score-large" style="font-size:1.5rem;"></div>
                            <div style="font-size:0.7rem; font-weight:bold; color:var(--primary); text-transform:uppercase;">Material Focus</div>
                        </div>
                        <div style="opacity:0.6;">
                            <div id="sum_score_${safeId}" class="focus-score-large" style="font-size:1.1rem;"></div>
                            <div style="font-size:0.6rem; font-weight:bold; color:var(--text-muted); text-transform:uppercase;">Overall Productive</div>
                        </div>
                    </div>
                </div>
                <div style="display:grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap:8px; text-align:center; font-size:0.85rem; margin-bottom:15px;">
                    <div style="background:rgba(52, 152, 219, 0.1); padding:8px; border-radius:6px; color:#3498db;">
                        <div id="sum_mat_${safeId}" style="font-weight:bold; font-size:1rem;"></div>
                        <div style="font-size:0.65rem; opacity:0.8;">Material</div>
                    </div>
                    <div style="background:rgba(46, 204, 113, 0.1); padding:8px; border-radius:6px; color:#2ecc71;">
                        <div id="sum_tool_${safeId}" style="font-weight:bold; font-size:1rem;"></div>
                        <div style="font-size:0.65rem; opacity:0.8;">Tools</div>
                    </div>
                    <div style="background:rgba(142, 68, 173, 0.1); padding:8px; border-radius:6px; color:#b882d8;">
                        <div id="sum_assess_${safeId}" style="font-weight:bold; font-size:1rem;"></div>
                        <div style="font-size:0.65rem; opacity:0.8;">Assess</div>
                    </div>
                    <div style="background:rgba(241, 196, 15, 0.1); padding:8px; border-radius:6px; color:#f1c40f;">
                        <div id="sum_portal_${safeId}" style="font-weight:bold; font-size:1rem;"></div>
                        <div style="font-size:0.65rem; opacity:0.8;">Portal</div>
                    </div>
                    <div style="background:rgba(231, 76, 60, 0.1); padding:8px; border-radius:6px; color:#e74c3c;">
                        <div id="sum_ext_${safeId}" style="font-weight:bold; font-size:1rem;"></div>
                        <div style="font-size:0.65rem; opacity:0.8;">External</div>
                    </div>
                    <div style="background:var(--bg-input); padding:8px; border-radius:6px; color:var(--text-muted);">
                        <div id="sum_idle_${safeId}" style="font-weight:bold; font-size:1rem;"></div>
                        <div style="font-size:0.65rem; opacity:0.8;">Idle</div>
                    </div>
                </div>
                <div style="margin-bottom:15px;">
                    <div style="font-size:0.75rem; font-weight:bold; color:var(--text-muted); margin-bottom:5px; text-transform:uppercase;">Activity Breakdown</div>
                    <div id="sum_topics_${safeId}" class="topic-breakdown" style="max-height:160px; overflow-y:auto; border:1px solid var(--border-color); border-radius:4px; padding:5px; background:var(--bg-app);"></div>
                </div>
                <div id="sum_timeline_${safeId}" class="timeline-visual" onclick="StudyMonitor.expandTimeline('${agent.replace(/'/g, "\\'")}')" style="cursor:pointer;" title="Click to expand details"></div>
                <div style="display:flex; justify-content:space-between; font-size:0.65rem; color:var(--text-muted); margin-top:4px; font-family:monospace; opacity:0.7;">
                    <span>08:00</span>
                    <span>10:00</span>
                    <span>12:00</span>
                    <span>14:00</span>
                    <span>17:00</span>
                </div>`;
            grid.appendChild(card);
        }

        // Granular Updates (No Flicker)
        document.getElementById(`sum_total_${safeId}`).innerText = `Total Tracked: ${Math.round(totalMs/60000)} mins`;
        document.getElementById(`sum_vio_${safeId}`).innerHTML = vioTopics.length > 0
            ? `<button class="btn-danger btn-sm" style="font-size:0.7rem; padding:3px 8px; margin-top:5px; width:auto; animation:pulse 2s infinite;" onclick="StudyMonitor.viewAgentViolations('${agent.replace(/'/g, "\\'")}')"><i class="fas fa-exclamation-triangle"></i> ${vioTopics.length} Violation(s) - View</button>`
            : '';
        const matScoreEl = document.getElementById(`sum_mat_score_${safeId}`);
        if (matScoreEl) { matScoreEl.innerText = matText; matScoreEl.style.color = scoreColor; }
        
        const scoreEl = document.getElementById(`sum_score_${safeId}`);
        if (scoreEl) { scoreEl.innerText = scoreText; scoreEl.style.color = 'var(--text-muted)'; }
        
        const sumMat = document.getElementById(`sum_mat_${safeId}`);
        if (sumMat) sumMat.innerText = matTimeStr;
        const sumTool = document.getElementById(`sum_tool_${safeId}`);
        if (sumTool) sumTool.innerText = toolTimeStr;
        const sumAssess = document.getElementById(`sum_assess_${safeId}`);
        if (sumAssess) sumAssess.innerText = assessmentTimeStr;
        const sumPortal = document.getElementById(`sum_portal_${safeId}`);
        if (sumPortal) sumPortal.innerText = portalTimeStr;
        const sumExt = document.getElementById(`sum_ext_${safeId}`);
        if (sumExt) sumExt.innerText = extTimeStr;
        const sumIdle = document.getElementById(`sum_idle_${safeId}`);
        if (sumIdle) sumIdle.innerText = idleTimeStr;
        
        // UX SCROLL LOCK: Prevent DOM wipes from resetting scroll position while investigating
        const topicsDiv = document.getElementById(`sum_topics_${safeId}`);
        if (topicsDiv) {
            const scrollPos = topicsDiv.scrollTop;
            topicsDiv.innerHTML = breakdownHtml;
            topicsDiv.scrollTop = scrollPos;
        }
        
        const timelineDiv = document.getElementById(`sum_timeline_${safeId}`);
        if (timelineDiv) timelineDiv.innerHTML = timelineHtml;
    });

    // Cleanup Stale Cards
    Array.from(grid.children).forEach(child => {
        if (child.id && child.id.startsWith('sum_card_') && !activeIds.has(child.id)) {
            child.remove();
        }
    });
}

StudyMonitor.forceShowAll = function() {
    // Temporary override to show all trainees
    const users = StudyMonitor.readLocalJson('users', []);
    const allTrainees = (Array.isArray(users) ? users : []).filter(u => u.role === 'trainee').map(u => u.user);
    
    // Monkey-patch getScheduledAgents temporarily
    this.originalGetScheduled = this.getScheduledAgents;
    this.getScheduledAgents = () => allTrainees;
    
    renderActivityMonitorContent();
};

StudyMonitor.getViolationSegmentsForAgent = function(agent) {
    const data = StudyMonitor.readLocalJson('monitor_data', {});
    const activity = (data && data[agent]) || { history: [], current: 'No Data', since: Date.now() };
    const todayStr = this.getLocalDateString();
    return this.getLiveSegmentsForDate(activity, todayStr)
        .map(seg => ({
            ...seg,
            effectiveDuration: this.getEffectiveDurationForDate(seg, todayStr)
        }))
        .filter(seg => seg.effectiveDuration > 0 && String(seg.activity || '').toLowerCase().includes('violation'))
        .sort((a, b) => (a.start || 0) - (b.start || 0));
};

StudyMonitor.viewAgentViolations = function(agent) {
    const segments = this.getViolationSegmentsForAgent(agent);
    const rows = segments.map(seg => {
        const start = seg.start ? new Date(seg.start).toLocaleTimeString() : '--';
        const end = seg.end ? new Date(seg.end).toLocaleTimeString() : '--';
        const activity = this.escapeHtml(String(seg.activity || '').replace(/^Violation:\s*/i, ''));
        return `<tr>
            <td style="white-space:nowrap;">${start} - ${end}</td>
            <td>${this.formatDuration(seg.effectiveDuration)}</td>
            <td>${activity}</td>
        </tr>`;
    }).join('');

    const html = `<div class="modal-overlay" id="agentViolationModal" style="z-index:10004;">
        <div class="modal-box" style="width:860px; max-height:88vh; display:flex; flex-direction:column;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <div>
                    <h3 style="margin:0; color:#ff5252;"><i class="fas fa-exclamation-triangle"></i> Violations: ${this.escapeHtml(agent)}</h3>
                    <div style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">${segments.length} violation entries for today</div>
                </div>
                <button class="btn-secondary btn-sm" onclick="document.getElementById('agentViolationModal').remove()">&times;</button>
            </div>
            <div class="table-responsive" style="overflow:auto;">
                <table class="admin-table">
                    <thead><tr><th>Time</th><th>Duration</th><th>Violation</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">No violations found for today.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    </div>`;

    const existing = document.getElementById('agentViolationModal');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', html);
};

StudyMonitor.openViolationReviewModal = function(agent = '') {
    if (CURRENT_USER && CURRENT_USER.role === 'trainee') return;
    const reports = this.getViolationReports();
    const users = Array.from(new Set(reports.map(r => r.user).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    const safeAgent = String(agent || '');
    const userOptions = ['<option value="">All Trainees</option>']
        .concat(users.map(u => `<option value="${this.escapeHtml(u)}" ${u === safeAgent ? 'selected' : ''}>${this.escapeHtml(u)}</option>`))
        .join('');

    const html = `<div class="modal-overlay" id="violationReviewModal" style="z-index:10005;">
        <div class="modal-box" style="width:min(1120px, 96vw); max-height:90vh; display:flex; flex-direction:column;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:12px;">
                <div>
                    <h3 style="margin:0; color:#ff5252;"><i class="fas fa-triangle-exclamation"></i> Violation Review</h3>
                    <div style="font-size:0.82rem; color:var(--text-muted); margin-top:4px;">Review mandatory trainee explanations for leaving the approved training workspace.</div>
                </div>
                <button class="btn-secondary btn-sm" onclick="document.getElementById('violationReviewModal').remove()">&times;</button>
            </div>
            <div class="violation-review-filters">
                <div>
                    <label>Status</label>
                    <select id="vioReviewStatus" onchange="StudyMonitor.renderViolationReviewRows()">
                        <option value="pending_review">Pending Review</option>
                        <option value="all">All Statuses</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="not_approved">Not Approved</option>
                    </select>
                </div>
                <div>
                    <label>Trainee</label>
                    <select id="vioReviewUser" onchange="StudyMonitor.renderViolationReviewRows()">${userOptions}</select>
                </div>
                <div>
                    <label>Date</label>
                    <input id="vioReviewDate" type="date" onchange="StudyMonitor.renderViolationReviewRows()">
                </div>
                <div>
                    <label>Search</label>
                    <input id="vioReviewSearch" type="text" placeholder="Trigger, reason, person..." oninput="StudyMonitor.renderViolationReviewRows()">
                </div>
            </div>
            <div class="violation-review-bulkbar">
                <label><input type="checkbox" id="vioReviewSelectAll" onchange="StudyMonitor.toggleAllViolationReviewSelection(this.checked)"> Select visible</label>
                <span id="vioReviewSelectedCount">0 selected</span>
                <button class="btn-danger btn-sm" id="vioReviewDeleteSelected" onclick="StudyMonitor.deleteSelectedViolationReports()" disabled><i class="fas fa-trash"></i> Delete Selected</button>
            </div>
            <div id="violationReviewRows" class="violation-review-list"></div>
        </div>
    </div>`;

    document.getElementById('violationReviewModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', html);
    this.renderViolationReviewRows();
};

StudyMonitor.renderViolationReviewRows = function() {
    const container = document.getElementById('violationReviewRows');
    if (!container) return;

    const status = String(document.getElementById('vioReviewStatus')?.value || 'pending_review');
    const user = String(document.getElementById('vioReviewUser')?.value || '').trim().toLowerCase();
    const date = String(document.getElementById('vioReviewDate')?.value || '').trim();
    const search = String(document.getElementById('vioReviewSearch')?.value || '').trim().toLowerCase();

    const reports = this.getViolationReports().filter(report => {
        const reportStatus = String(report.status || (report.reviewed ? 'reviewed' : 'pending_review'));
        if (status !== 'all' && reportStatus !== status) return false;
        if (user && String(report.user || '').trim().toLowerCase() !== user) return false;
        if (date && String(report.date || '').trim() !== date) return false;
        if (search) {
            const haystack = [report.user, report.trigger, report.activity, report.reason, report.platform, report.contact, report.adminComment]
                .map(v => String(v || '').toLowerCase())
                .join(' ');
            if (!haystack.includes(search)) return false;
        }
        return true;
    });

    const visibleIds = reports.map(report => String(report.id || '')).filter(Boolean);
    this.visibleViolationReviewIds = visibleIds;
    this.violationReviewSelection = new Set(Array.from(this.violationReviewSelection || []).filter(id => visibleIds.includes(id)));

    container.innerHTML = reports.map(report => {
        const detected = report.detectedAt ? new Date(report.detectedAt).toLocaleString() : (report.date || '-');
        const reportStatus = String(report.status || '');
        const isReviewed = !!report.reviewed || reportStatus === 'reviewed' || reportStatus === 'not_approved';
        const statusLabel = reportStatus === 'not_approved' ? 'Not Approved' : (isReviewed ? 'Reviewed' : 'Pending');
        const reviewedMeta = isReviewed
            ? [report.reviewedBy ? `By ${report.reviewedBy}` : '', report.reviewedAt ? new Date(report.reviewedAt).toLocaleString() : ''].filter(Boolean).join(' | ')
            : '';
        const safeId = encodeURIComponent(String(report.id || ''));
        const checked = this.violationReviewSelection.has(String(report.id || '')) ? 'checked' : '';
        const evidence = report.evidence && typeof report.evidence === 'object' ? report.evidence : {};
        const evidenceFiles = Array.isArray(evidence.files) ? evidence.files : [];
        const legacyScreenshots = Array.isArray(evidence.screenshots) ? evidence.screenshots : [];
        const screenshotCount = evidenceFiles.length || legacyScreenshots.length || Number(evidence.screenCount || 0);
        const hasEvidence = evidenceFiles.length > 0 || legacyScreenshots.length > 0;
        const captureErrorText = String(evidence.captureError || '');
        const bucketMissing = /bucket not found/i.test(captureErrorText);
        const shouldIgnoreEvidence = this.shouldSkipViolationEvidenceCapture(report.trigger, report.activity);
        return `<article class="violation-review-card">
            <div class="violation-review-card-main">
                <div class="violation-review-card-head">
                    <div style="display:flex; align-items:flex-start; gap:10px;">
                        <input type="checkbox" class="violation-review-select" ${checked} onchange="StudyMonitor.toggleViolationReviewSelection(decodeURIComponent('${safeId}'), this.checked)" aria-label="Select violation report">
                        <div>
                            <div class="violation-review-agent">${this.escapeHtml(report.user || '-')}</div>
                            <div class="violation-review-meta">${this.escapeHtml(detected)}</div>
                        </div>
                    </div>
                    <span class="status-badge ${isReviewed ? (reportStatus === 'not_approved' ? 'status-fail' : 'status-pass') : 'status-fail'}">${statusLabel}</span>
                </div>
                <div class="violation-review-grid">
                    <div>
                        <span>Trigger</span>
                        <strong>${this.escapeHtml(report.trigger || report.activity || '-')}</strong>
                    </div>
                    <div>
                        <span>Platform / Person Informed</span>
                        <strong>${this.escapeHtml([report.platform, report.contact].filter(Boolean).join(' / ') || '-')}</strong>
                    </div>
                </div>
                <div class="violation-review-reason">
                    <span>Reason</span>
                    <p>${this.escapeHtml(report.reason || '-')}</p>
                </div>
                ${report.adminComment ? `<div class="violation-review-reason"><span>Admin Note</span><p>${this.escapeHtml(report.adminComment)}</p></div>` : ''}
                <div class="violation-review-reason">
                    <span>Admin Evidence</span>
                    <p>${shouldIgnoreEvidence
                        ? 'Screenshot capture skipped: Not required for lock-idle violations.'
                        : (hasEvidence
                        ? `${screenshotCount} screenshot${screenshotCount === 1 ? '' : 's'} captured across connected display${screenshotCount === 1 ? '' : 's'}.`
                        : (evidence.captureSkipped
                            ? `Screenshot capture skipped: ${this.escapeHtml(evidence.captureSkipReason || 'Not required for lock-idle violations.')}`
                            : (bucketMissing
                                ? 'Screenshot evidence unavailable for this report. Existing reports captured before storage was available may not have screenshots attached.'
                                : (captureErrorText ? `Screenshot capture failed: ${this.escapeHtml(captureErrorText)}` : 'No screenshot evidence attached.'))))
                    }</p>
                </div>
            </div>
            <div class="violation-review-actions">
                ${hasEvidence && !shouldIgnoreEvidence ? `<button class="btn-secondary btn-sm" onclick="StudyMonitor.openViolationEvidence(decodeURIComponent('${safeId}'))"><i class="fas fa-image"></i> Evidence</button>` : ''}
                ${isReviewed
                    ? `<span class="violation-review-meta">${this.escapeHtml(reviewedMeta || 'Reviewed')}</span>`
                    : `<button class="btn-success btn-sm" onclick="StudyMonitor.markViolationReviewed(decodeURIComponent('${safeId}'), 'approved')"><i class="fas fa-check"></i> Approve</button>
                       <button class="btn-danger btn-sm" onclick="StudyMonitor.markViolationReviewed(decodeURIComponent('${safeId}'), 'not_approved')"><i class="fas fa-ban"></i> Not Approved</button>`}
            </div>
        </article>`;
    }).join('') || '<div class="violation-review-empty">No violation reports match the current filters.</div>';
    this.updateViolationReviewBulkState();
};

StudyMonitor.toggleViolationReviewSelection = function(reportId, checked) {
    const id = String(reportId || '');
    if (!id) return;
    if (!this.violationReviewSelection) this.violationReviewSelection = new Set();
    if (checked) this.violationReviewSelection.add(id);
    else this.violationReviewSelection.delete(id);
    this.updateViolationReviewBulkState();
};

StudyMonitor.toggleAllViolationReviewSelection = function(checked) {
    if (!this.violationReviewSelection) this.violationReviewSelection = new Set();
    const visible = Array.isArray(this.visibleViolationReviewIds) ? this.visibleViolationReviewIds : [];
    visible.forEach(id => {
        if (checked) this.violationReviewSelection.add(id);
        else this.violationReviewSelection.delete(id);
    });
    document.querySelectorAll('.violation-review-select').forEach(box => { box.checked = !!checked; });
    this.updateViolationReviewBulkState();
};

StudyMonitor.updateViolationReviewBulkState = function() {
    const selected = this.violationReviewSelection ? this.violationReviewSelection.size : 0;
    const count = document.getElementById('vioReviewSelectedCount');
    if (count) count.textContent = `${selected} selected`;
    const deleteBtn = document.getElementById('vioReviewDeleteSelected');
    if (deleteBtn) deleteBtn.disabled = selected === 0;
    const allBox = document.getElementById('vioReviewSelectAll');
    const visible = Array.isArray(this.visibleViolationReviewIds) ? this.visibleViolationReviewIds : [];
    if (allBox) {
        allBox.checked = visible.length > 0 && visible.every(id => this.violationReviewSelection?.has(id));
        allBox.indeterminate = visible.some(id => this.violationReviewSelection?.has(id)) && !allBox.checked;
    }
};

StudyMonitor.deleteViolationEvidenceFiles = async function(report, reason = 'deleted') {
    const evidence = report?.evidence && typeof report.evidence === 'object' ? report.evidence : {};
    const files = Array.isArray(evidence.files) ? evidence.files : [];
    if (!files.length) return;

    const client = window.supabaseClient;
    const storage = client?.storage;
    const bucketGroups = files.reduce((acc, file) => {
        const bucket = file.bucket || evidence.bucket || this.getViolationEvidenceBucket();
        if (!file.path) return acc;
        if (!acc[bucket]) acc[bucket] = [];
        acc[bucket].push(file.path);
        return acc;
    }, {});

    if (storage?.from) {
        for (const [bucket, paths] of Object.entries(bucketGroups)) {
            const { error } = await storage.from(bucket).remove(paths);
            if (error) console.warn('Violation evidence storage delete failed:', error);
        }
    }

    if (client?.from) {
        const ids = files.map(file => file.id).filter(Boolean);
        if (ids.length) {
            const { error } = await client
                .from('violation_evidence')
                .update({
                    status: 'deleted',
                    deleted_at: new Date().toISOString(),
                    reviewed_by: CURRENT_USER?.user || 'admin',
                    reviewed_at: new Date().toISOString(),
                    metadata: { deleted_reason: reason }
                })
                .in('id', ids);
            if (error) console.warn('Violation evidence metadata delete failed:', error);
        }
    }
};

StudyMonitor.deleteSelectedViolationReports = async function() {
    const selected = Array.from(this.violationReviewSelection || []);
    if (selected.length === 0) return;
    if (!confirm(`Delete ${selected.length} selected violation report${selected.length === 1 ? '' : 's'}? This will also remove any attached screenshot evidence.`)) return;
    const selectedSet = new Set(selected);
    const rawReports = this.getRawViolationReports();
    const toDelete = rawReports.filter(report => selectedSet.has(String(report.id || '')));
    for (const report of toDelete) await this.deleteViolationEvidenceFiles(report, 'report_deleted');
    const reports = rawReports.filter(report => !selectedSet.has(String(report.id || '')));
    this.violationReviewSelection.clear();
    try {
        await this.persistViolationReportDeletion(reports, selected);
    } catch (error) {
        console.error('Violation report delete sync failed:', error);
        this.writeViolationReports(reports);
        if (typeof showToast === 'function') showToast('Deleted locally, but cloud sync failed. Please sync again before refreshing.', 'error');
        else alert('Deleted locally, but cloud sync failed. Please sync again before refreshing.');
    }
    this.renderViolationReviewRows();
    renderActivityMonitorContent();
    if (typeof updateNotifications === 'function') updateNotifications();
};

StudyMonitor.openViolationEvidence = async function(reportId) {
    if (CURRENT_USER && CURRENT_USER.role === 'trainee') return;
    const report = this.getRawViolationReports().find(r => String(r.id || '') === String(reportId || ''));
    if (this.shouldSkipViolationEvidenceCapture(report?.trigger, report?.activity)) {
        alert('Screenshot evidence is not captured for lock-idle violations.');
        return;
    }
    const evidence = report?.evidence && typeof report.evidence === 'object' ? report.evidence : {};
    const files = Array.isArray(evidence.files) ? evidence.files : [];
    const screenshots = Array.isArray(evidence.screenshots) ? evidence.screenshots : [];
    if (!files.length && !screenshots.length) {
        alert('No screenshot evidence is attached to this violation.');
        return;
    }
    const html = `<div class="modal-overlay" id="violationEvidenceModal" style="z-index:10010;">
        <div class="modal-box violation-evidence-workspace">
            <div class="violation-evidence-header">
                <div>
                    <h3 style="margin:0;"><i class="fas fa-image"></i> Violation Evidence</h3>
                    <div style="font-size:0.82rem; color:var(--text-muted); margin-top:4px;">Admin-only screenshots for ${this.escapeHtml(report.user || '-')}.</div>
                </div>
                <div class="violation-evidence-toolbar">
                    <button id="violationEvidenceZoomOut" class="btn-secondary btn-sm" type="button" title="Zoom out"><i class="fas fa-search-minus"></i></button>
                    <button id="violationEvidenceZoomReset" class="btn-secondary btn-sm" type="button" title="Reset zoom"><i class="fas fa-compress-arrows-alt"></i> <span id="violationEvidenceZoomLabel">100%</span></button>
                    <button id="violationEvidenceZoomIn" class="btn-secondary btn-sm" type="button" title="Zoom in"><i class="fas fa-search-plus"></i></button>
                    <button id="violationEvidenceClose" class="btn-secondary btn-sm" type="button" title="Close"><i class="fas fa-times"></i></button>
                </div>
            </div>
            <div id="violationEvidenceBody" class="violation-evidence-body" data-zoom="1">
                <div style="color:var(--text-muted);">Loading evidence...</div>
            </div>
        </div>
    </div>`;
    document.getElementById('violationEvidenceModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById('violationEvidenceZoomOut')?.addEventListener('click', () => this.adjustViolationEvidenceZoom(-0.15));
    document.getElementById('violationEvidenceZoomReset')?.addEventListener('click', () => this.resetViolationEvidenceZoom());
    document.getElementById('violationEvidenceZoomIn')?.addEventListener('click', () => this.adjustViolationEvidenceZoom(0.15));
    document.getElementById('violationEvidenceClose')?.addEventListener('click', () => document.getElementById('violationEvidenceModal')?.remove());
    const body = document.getElementById('violationEvidenceBody');
    if (!body) return;

    try {
        let items = [];
        if (files.length) {
            const client = window.supabaseClient;
            if (!client?.storage?.from) throw new Error('Evidence storage is unavailable in this client session.');
            items = await Promise.all(files.map(async (file, index) => {
                const bucket = file.bucket || evidence.bucket || this.getViolationEvidenceBucket();
                const { data, error } = await client.storage.from(bucket).createSignedUrl(file.path, 300);
                if (error) throw error;
                return {
                    src: data.signedUrl,
                    name: file.name || `Screen ${index + 1}`,
                    index
                };
            }));
        } else {
            items = screenshots.map((shot, index) => ({
                src: `data:${shot.mime || 'image/jpeg'};base64,${String(shot.data || '')}`,
                name: shot.name || `Screen ${index + 1}`,
                index
            }));
        }

        body.innerHTML = items.map(item => `<figure class="violation-evidence-figure">
            <div class="violation-evidence-image-frame">
                <img class="violation-evidence-image" alt="Violation evidence screen ${item.index + 1}" src="${this.escapeHtml(item.src)}">
            </div>
            <figcaption>${this.escapeHtml(item.name)}</figcaption>
        </figure>`).join('');
        this.applyViolationEvidenceZoom(1);
    } catch (error) {
        body.innerHTML = `<div class="violation-review-empty">Could not load evidence: ${this.escapeHtml(error && error.message || error || 'Unknown error')}</div>`;
    }
};

StudyMonitor.applyViolationEvidenceZoom = function(zoom) {
    const body = document.getElementById('violationEvidenceBody');
    if (!body) return;
    const nextZoom = Math.max(0.5, Math.min(3, Number(zoom) || 1));
    body.dataset.zoom = String(nextZoom);
    body.querySelectorAll('.violation-evidence-image').forEach(img => {
        img.style.width = `${nextZoom * 100}%`;
        img.style.maxWidth = 'none';
    });
    const label = document.getElementById('violationEvidenceZoomLabel');
    if (label) label.textContent = `${Math.round(nextZoom * 100)}%`;
};

StudyMonitor.adjustViolationEvidenceZoom = function(delta) {
    const body = document.getElementById('violationEvidenceBody');
    const current = Number(body?.dataset?.zoom || 1);
    this.applyViolationEvidenceZoom(current + Number(delta || 0));
};

StudyMonitor.resetViolationEvidenceZoom = function() {
    this.applyViolationEvidenceZoom(1);
};

StudyMonitor.markViolationReviewed = async function(reportId, decision = 'approved') {
    const reports = this.getRawViolationReports();
    const idx = reports.findIndex(r => String(r.id || '') === String(reportId || ''));
    if (idx < 0) return;

    const approved = decision !== 'not_approved';
    const nextEvidence = reports[idx].evidence && typeof reports[idx].evidence === 'object'
        ? { ...reports[idx].evidence }
        : {};
    if (approved && ((Array.isArray(nextEvidence.screenshots) && nextEvidence.screenshots.length > 0) || (Array.isArray(nextEvidence.files) && nextEvidence.files.length > 0))) {
        await this.deleteViolationEvidenceFiles(reports[idx], 'approved_by_admin');
        nextEvidence.deletedAt = new Date().toISOString();
        nextEvidence.deletedReason = 'approved_by_admin';
        nextEvidence.deletedScreenshotCount = (nextEvidence.screenshots || []).length + (nextEvidence.files || []).length;
        nextEvidence.screenshots = [];
        nextEvidence.files = [];
        nextEvidence.screenCount = 0;
    }

    reports[idx] = {
        ...reports[idx],
        reviewed: true,
        status: approved ? 'reviewed' : 'not_approved',
        decision: approved ? 'approved' : 'not_approved',
        reviewedAt: new Date().toISOString(),
        reviewedBy: CURRENT_USER?.user || 'admin',
        evidence: nextEvidence
    };
    this.writeViolationReports(reports);
    if (typeof saveToServer === 'function') await saveToServer(['violation_reports'], false, true);
    this.renderViolationReviewRows();
    renderActivityMonitorContent();
    if (typeof updateNotifications === 'function') updateNotifications();
};

StudyMonitor.archiveLog = async function() {
    if(!confirm("Clear the current live activity feed? Archived history will stay intact.")) return;
    
    localStorage.setItem('monitor_data', '{}');
    if(typeof saveToServer === 'function') await saveToServer(['monitor_data'], true);
    
    renderActivityMonitorContent();
    alert("Live activity feed cleared.");
}

StudyMonitor.classifyActivity = async function(fullActivityString) {
    // Smart Suggestion Logic
    let suggestion = fullActivityString;
    
    // 1. Strip "External: " or "Violation: " prefix if present
    suggestion = suggestion.replace(/^(External:\s*|Violation:\s*)/, '');
    
    // 2. Check for Process ID [proc]
    const procMatch = suggestion.match(/\[(.*?)\]$/);
    if (procMatch) {
        const proc = procMatch[1].toLowerCase();
        const browsers = ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'safari'];
        
        if (browsers.includes(proc)) {
            // Browser: Suggest Title (remove process)
            suggestion = suggestion.replace(/\[(.*?)\]$/, '').trim();
            suggestion = suggestion.replace(/ - \w+$/, '').trim(); // Try remove suffix like " - Google Chrome"
        } else {
            // App: Suggest Process ID for broad matching
            suggestion = `[${proc}]`; 
        }
    }

    // 3. Prompt User
    const keyword = await customPrompt("Classify Activity", "Enter keyword to whitelist (matches any window title containing this):", suggestion);
    if (!keyword) return;

    this.pendingTopic = keyword.trim();
    document.getElementById('classifyTargetName').innerText = keyword;
    document.getElementById('activityClassifyModal').classList.remove('hidden');
};

StudyMonitor.bulkClassifyAction = function() {
    if (this.queueSelection.size === 0) return alert("Please select items to classify.");
    const topics = Array.from(this.queueSelection);
    this.pendingTopic = topics; // Pass array
    document.getElementById('classifyTargetName').innerText = `${topics.length} Selected Items`;
    document.getElementById('activityClassifyModal').classList.remove('hidden');
};

StudyMonitor.confirmClassification = async function() {
    const type = document.getElementById('classifySelect').value;
    // Handle both single string and array of strings
    const topics = Array.isArray(this.pendingTopic) ? this.pendingTopic : [this.pendingTopic];
    
    if (!topics || topics.length === 0) return;
    
    let newPrefix = "";
    if (type === "1") {
        newPrefix = "Study Tool: ";
        // Add to whitelist for future
        let whitelist = this.readLocalJson('monitor_whitelist', []);
        let reviewed = this.readLocalJson('monitor_reviewed', []);
        if (!Array.isArray(whitelist)) whitelist = [];
        if (!Array.isArray(reviewed)) reviewed = [];
        if (whitelist.length === 0) whitelist = ['acs.herotel.systems', 'crm.herotel.com', 'herotel.qcontact.com', 'radius.herotel.com', 'app.preseem.com', 'hosting.herotel.com', 'cp1.herotel.com', 'cp2.herotel.com'];
        
        let wlChanged = false;
        topics.forEach(t => {
            if (!whitelist.includes(t)) {
                whitelist.push(t);
                wlChanged = true;
            }
            // Remove from reviewed if it was previously dismissed
            const revIdx = reviewed.indexOf(t);
            if (revIdx > -1) {
                reviewed.splice(revIdx, 1);
                wlChanged = true;
            }
        });
        
        if (wlChanged) {
            localStorage.setItem('monitor_whitelist', JSON.stringify(whitelist));
            localStorage.setItem('monitor_reviewed', JSON.stringify(reviewed));
            if(typeof saveToServer === 'function') await saveToServer(['monitor_whitelist', 'monitor_reviewed'], false);
        }
    } else if (type === "2" || type === "3") {
        newPrefix = (type === "2") ? "External: " : "Idle: ";
        
        // Add to 'reviewed' list so it doesn't pop up again
        let reviewed = this.readLocalJson('monitor_reviewed', []);
        let whitelist = this.readLocalJson('monitor_whitelist', []);
        if (!Array.isArray(reviewed)) reviewed = [];
        if (!Array.isArray(whitelist)) whitelist = [];
        let revChanged = false;

        topics.forEach(t => {
            if (!reviewed.includes(t)) {
                reviewed.push(t);
                revChanged = true;
            }
            // Remove from whitelist if present
            const wlIdx = whitelist.indexOf(t);
            if (wlIdx > -1) {
                whitelist.splice(wlIdx, 1);
                revChanged = true;
            }
        });

        if (revChanged) {
            localStorage.setItem('monitor_reviewed', JSON.stringify(reviewed));
            localStorage.setItem('monitor_whitelist', JSON.stringify(whitelist));
            if(typeof saveToServer === 'function') await saveToServer(['monitor_reviewed', 'monitor_whitelist'], false);
        }
    } else {
        return;
    }
    
    const data = this.readLocalJson('monitor_data', {});
    let changed = false;
    
    Object.keys(data || {}).forEach(user => {
        const activity = data[user];
        if (activity.history) {
            activity.history.forEach(h => {
                topics.forEach(topicName => {
                    if (h.activity.includes(topicName) && !h.activity.includes('(Reclassified)')) {
                        h.activity = `${newPrefix}${topicName} (Reclassified)`;
                        changed = true;
                    }
                });
            });
        }
        // Also update current if matches
        if (topics.some(t => activity.current.includes(t)) && !activity.current.includes('(Reclassified)')) {
            // Find which topic matched to construct label
            const match = topics.find(t => activity.current.includes(t));
            activity.current = `${newPrefix}${match} (Reclassified)`;
            changed = true;
        }
    });
    
    if (changed) {
        localStorage.setItem('monitor_data', JSON.stringify(data));
        // Mark as locally updated immediately to prevent overwrite on reload if sync is slow
        localStorage.setItem('sync_ts_monitor_data', new Date().toISOString());
        
        // OPTIMISTIC SAVE: Don't await. Let it sync in background to prevent UI freeze.
        if(typeof saveToServer === 'function') saveToServer(['monitor_data'], false); 
    }
    
    // Clear selection
    this.queueSelection.clear();
    
    document.getElementById('activityClassifyModal').classList.add('hidden');
    this.pendingTopic = null;
    this.forceRefresh = true; // Allow refresh to show updates
    renderActivityMonitorContent(); // Refresh UI
};

StudyMonitor.expandTimeline = async function(agentName, targetDateStr = null) {
    const todayStr = this.getLocalDateString();
    const queryDate = targetDateStr || todayStr;

    let modal = document.getElementById('timelineDetailModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'timelineDetailModal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '9999'; // Ensure it appears above the Activity Monitor
        modal.innerHTML = `
            <div class="modal-box" style="width:95%; max-width:1200px; height:85vh; display:flex; flex-direction:column;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid var(--border-color); padding-bottom:10px; flex-wrap:wrap; gap:10px;">
                    <h3 style="margin:0; display:flex; align-items:center; gap:10px;">Activity Detail: <span id="tlDetailName" style="color:var(--primary);"></span>
                        <input type="date" id="tlDetailDate" style="padding:4px 8px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-input); color:var(--text-main); font-size:0.9rem;" title="Select a date to view archived history">
                    </h3>
                    <div style="display:flex; gap:10px;">
                        <button class="btn-primary" id="btn-ai-analyze"><i class="fas fa-robot"></i> AI Analyze</button>
                        <button class="btn-secondary" onclick="document.getElementById('timelineDetailModal').classList.add('hidden')"><i class="fas fa-times"></i> Close</button>
                    </div>
                </div>
                <div id="ai-analysis-result" class="hidden" style="margin-bottom: 20px; padding: 15px; background: var(--bg-input); border-left: 4px solid var(--primary); border-radius: 4px; font-size: 0.9rem; line-height: 1.5; max-height: 250px; overflow-y: auto;"></div>
                <div id="tlDetailLoadingState" class="hidden" style="margin-bottom:12px; padding:10px 12px; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-input); color:var(--text-muted); font-size:0.86rem;">
                    <i class="fas fa-circle-notch fa-spin"></i> Loading activity timeline...
                </div>
                <div style="margin-bottom:20px;">
                    <div id="tlDetailVisual" class="timeline-visual timeline-clock-visual" style="height:40px; border-radius:4px;"></div>
                    <div id="tlDetailTicks" class="timeline-clock-ticks"></div>
                    <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--text-muted); margin-top:5px;">
                        <span>Start of Day</span>
                        <span id="tlDetailAxisEndLabel">Current Time</span>
                    </div>
                </div>
                <div style="flex:1; overflow-y:auto; border:1px solid var(--border-color); border-radius:4px;">
                    <table class="admin-table">
                        <thead style="position:sticky; top:0; background:var(--bg-card); z-index:1;">
                            <tr>
                                <th>Time</th>
                                <th>Duration</th>
                                <th>Activity</th>
                                <th>Category</th>
                            </tr>
                        </thead>
                        <tbody id="tlDetailTable"></tbody>
                    </table>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }

    document.getElementById('tlDetailName').innerText = agentName;
    
    const datePicker = document.getElementById('tlDetailDate');
    datePicker.value = queryDate;
    datePicker.onchange = (e) => { StudyMonitor.expandTimeline(agentName, e.target.value); };

    const aiBtn = document.getElementById('btn-ai-analyze');
    if (aiBtn) aiBtn.onclick = () => StudyMonitor.analyzeWithAI(agentName, queryDate);
    
    const aiResult = document.getElementById('ai-analysis-result');
    if (aiResult) {
        aiResult.classList.add('hidden');
        aiResult.innerHTML = '';
    }

    const visualContainer = document.getElementById('tlDetailVisual');
    const tickContainer = document.getElementById('tlDetailTicks');
    const axisEndLabel = document.getElementById('tlDetailAxisEndLabel');
    const tableContainer = document.getElementById('tlDetailTable');
    const loadingState = document.getElementById('tlDetailLoadingState');
    
    if (loadingState) {
        loadingState.classList.remove('hidden');
        loadingState.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> Loading ${queryDate === todayStr ? 'live and saved' : 'archived'} activity for ${StudyMonitor.escapeHtml(agentName)} on ${StudyMonitor.escapeHtml(queryDate)}...`;
    }
    visualContainer.innerHTML = '<div class="timeline-loading-fill"><i class="fas fa-circle-notch fa-spin"></i> Loading...</div>';
    if (tickContainer) tickContainer.innerHTML = '';
    tableContainer.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:18px; color:var(--text-muted);"><i class="fas fa-circle-notch fa-spin"></i> Loading activity timeline...</td></tr>';

    // --- RECALCULATE SEGMENTS ---
    let allSegments = [];
    
    allSegments = await StudyMonitor.getActivitySegmentsForDate(agentName, queryDate);
    if (loadingState) loadingState.classList.add('hidden');

    tableContainer.innerHTML = '';
    allSegments.sort((a, b) => (a.start || 0) - (b.start || 0));

    const processedSegs = [];
    const axis = StudyMonitor.getTimelineAxisBounds(queryDate);
    
    allSegments.forEach(seg => {
         const segStart = StudyMonitor.getSegmentStartMs(seg);
         const effectiveDuration = StudyMonitor.getEffectiveDurationForDate(seg, queryDate);
         
         if (effectiveDuration <= 0) return;

         const category = StudyMonitor.getCategory(seg.activity);
         const config = StudyMonitor.readLocalJson('system_config', {});
         const TOLERANCE = config.monitoring ? config.monitoring.tolerance_ms : 180000;
         let typeClass = 'seg-idle';
         let catLabel = 'Idle';
         let style = '';
         let rowColor = '';

         if (category === 'material') {
             typeClass = ''; style = 'background:#3498db;';
             catLabel = 'Material'; rowColor = 'color:#3498db; font-weight:bold;';
         } else if (category === 'tool') {
             typeClass = ''; style = 'background:#2ecc71;';
             catLabel = 'Tool/Note'; rowColor = 'color:#2ecc71;';
         } else if (category === 'assessment') {
             typeClass = ''; style = 'background:#8e44ad;';
             catLabel = 'Assessment / Vetting'; rowColor = 'color:#b882d8; font-weight:bold;';
         } else if (category === 'portal') {
             typeClass = ''; style = 'background:#f1c40f;';
             catLabel = 'Portal Navigation'; rowColor = 'color:#f1c40f;';
         } else if (category === 'external') {
             if (effectiveDuration > TOLERANCE) {
                 typeClass = ''; style = 'background:#e74c3c;';
                 catLabel = seg.activity.toLowerCase().includes('violation') ? 'Violation' : 'External';
                 rowColor = 'color:#e74c3c; font-weight:bold;';
             } else {
                 style = `background: repeating-linear-gradient(45deg, #2ecc71, #2ecc71 5px, #f1c40f 5px, #f1c40f 10px);`;
                 typeClass = ''; 
                 catLabel = seg.activity.toLowerCase().includes('violation') ? 'Violation (Tolerated)' : 'External (Tolerated)';
                 rowColor = 'color:#f39c12;';
             }
         } else {
             if (effectiveDuration > TOLERANCE) {
                 typeClass = ''; style = 'background:#95a5a6;';
                 catLabel = 'Idle';
             } else {
                 style = `background: repeating-linear-gradient(45deg, #2ecc71, #2ecc71 5px, #95a5a6 5px, #95a5a6 10px);`;
                 typeClass = '';
                 catLabel = 'Idle (Thinking)';
                 rowColor = 'color:#95a5a6;';
             }
         }
         
         processedSegs.push({
             duration: effectiveDuration,
             activity: seg.activity,
             start: segStart,
             typeClass,
             style,
             catLabel,
             rowColor
         });
    });

    let visualHtml = '';
    let tableHtml = '';

    if (processedSegs.length > 0) {
        const axisDuration = Math.max(1, axis.end - axis.start);
        processedSegs.forEach(p => {
            const slices = StudyMonitor.getTimelineClockSlices(p, queryDate, axis);
            slices.forEach(slice => {
                const left = ((slice.start - axis.start) / axisDuration) * 100;
                const width = Math.max(0.15, ((slice.end - slice.start) / axisDuration) * 100);
                const startLabel = new Date(slice.start).toLocaleTimeString();
                const endLabel = new Date(slice.end).toLocaleTimeString();
                visualHtml += `<div class="timeline-seg timeline-clock-seg" style="left:${left}%; width:${width}%; ${p.style}" title="${p.activity} (${startLabel} - ${endLabel}, ${Math.round(slice.duration/1000)}s)"></div>`;
            });
            
            const timeStr = new Date(p.start).toLocaleTimeString();
            const mins = (p.duration / 60000).toFixed(1) + 'm';
            
            let displayActivity = p.activity;
            if (displayActivity.includes('sharepoint.com') || displayActivity.includes('microsoftonline.com')) {
                 if (displayActivity.includes('.mp4') || displayActivity.includes('stream.aspx')) displayActivity = 'Studying: Training Video (SharePoint)';
                 else displayActivity = 'Studying: Training Document (SharePoint)';
            }

            tableHtml += `
                <tr style="${p.rowColor}">
                    <td>${timeStr}</td>
                    <td>${mins}</td>
                    <td title="${p.activity.replace(/"/g, '&quot;')}">${displayActivity}</td>
                    <td>${p.catLabel}</td>
                </tr>
            `;
        });
    } else {
        visualHtml = '<div style="text-align:center; width:100%; color:var(--text-muted); padding-top:10px;">No data in working hours.</div>';
        tableHtml = '<tr><td colspan="4" style="text-align:center;">No activity recorded during working hours (08:00 - 17:00).</td></tr>';
    }

    visualContainer.innerHTML = visualHtml;
    if (tickContainer) tickContainer.innerHTML = StudyMonitor.buildTimelineTickHtml(queryDate, axis);
    if (axisEndLabel) {
        const endDate = new Date(axis.end);
        axisEndLabel.textContent = queryDate === todayStr
            ? `Current Time (${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')})`
            : 'End of Day';
    }
    tableContainer.innerHTML = tableHtml;
    
    modal.classList.remove('hidden');
};

// --- AI TIMELINE ANALYST ---
StudyMonitor.analyzeWithAI = async function(agentName, dateStr) {
    const resultDiv = document.getElementById('ai-analysis-result');
    const btn = document.getElementById('btn-ai-analyze');
    if (!resultDiv || !btn) return;

    const configStr = localStorage.getItem('system_config');
    const config = configStr ? JSON.parse(configStr) : {};
    if (!config.ai || !config.ai.enabled || !config.ai.apiKey) {
        alert("AI is not configured or enabled in System Settings. Please ask a Super Admin to configure the AI connection.");
        return;
    }

    // 1. Gather Data
    let allSegments = await this.getActivitySegmentsForDate(agentName, dateStr);

    if (allSegments.length === 0) {
        alert("No activity data to analyze for this date.");
        return;
    }

    // 2. Format Data for Prompt
    let promptData = `Activity Log for ${agentName} on ${dateStr}:\n`;
    allSegments.sort((a, b) => (a.start || 0) - (b.start || 0)).forEach(seg => {
        const time = new Date(seg.start || (seg.end - seg.duration)).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const mins = (seg.duration / 60000).toFixed(1);
        promptData += `- [${time}] ${seg.activity} (${mins} mins)\n`;
    });

    // Pre-calculate stats
    const stats = this.calculateDailyStats(allSegments);
    const toMins = (ms) => Math.round(ms / 60000);

    const promptText = `
As an analyst, provide a narrative summary of the employee's workday based on the activity log below.

**Instructions:**
1.  **Narrative Flow:** Start by describing the beginning of the day and walk through the main activities chronologically. Tell a story of their day.
1.5. **Expected Daily Flow:** A normal trainee day starts after clock-in, studying begins in the morning, meetings may happen from 11:00 to 12:00 on some days, lunch is from 12:00 to 13:00, assessments usually become available after lunch, and the day ends at 17:00. Use this only as context, not as a reason to invent facts.
2.  **Time Summary:** Explicitly state the total time spent on:
    - Training Material: ${toMins(stats.material)} minutes
    - Work Tools: ${toMins(stats.tool)} minutes
    - Live Assessment / Vetting: ${toMins(stats.assessment || 0)} minutes
    - Portal Navigation: ${toMins(stats.portal || 0)} minutes
    - External/Distractions: ${toMins(stats.external)} minutes
    - Idle: ${toMins(stats.idle)} minutes
3.  **Idle Time Explanation:** If there is idle time, explain that "Idle time is tracked when there is no mouse or keyboard input for over 60 seconds. Short idle periods are considered 'thinking time' and are counted as productive."
4.  **Violations Explanation:** If there are 'Violation' entries, explain that "Violations are logged when non-work-related external applications are used during working hours (8 AM - 5 PM, excluding lunch)." Mention the specific applications if they are in the log.
5.  **Tone:** Be objective and base the summary strictly on the provided log data. Do not make assumptions or judgments.

**Log Data:**
${promptData}
    `;

    // 3. UI Loading State
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';
    btn.disabled = true;
    resultDiv.classList.remove('hidden');
    resultDiv.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> AI is reviewing the timeline data...';

    // 4. Fetch from Gemini
    try {
        if (!window.electronAPI || !window.electronAPI.ipcRenderer) {
            throw new Error("Electron API bridge not available. Cannot make secure API call.");
        }

        // Dynamically build the endpoint using v1beta and the selected model to ensure maximum region compatibility
        const aiModel = config.ai.model || "gemini-2.5-flash";
        const actualEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${aiModel}:generateContent`;

        const result = await window.electronAPI.ipcRenderer.invoke('invoke-gemini-api', {
            endpoint: actualEndpoint,
            apiKey: config.ai.apiKey,
            promptText: promptText
        });

        if (result.error) {
            throw new Error(result.error);
        }

        const text = result.text || "No insights generated.";
        const formattedText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>');
        resultDiv.innerHTML = `<strong><i class="fas fa-robot" style="color:var(--primary);"></i> AI Insight:</strong><br><br>${formattedText}`;
    } catch (e) {
        console.error("AI Analysis Error:", e);
        // More descriptive error for the user
        resultDiv.innerHTML = `<span style="color:#ff5252;"><i class="fas fa-exclamation-triangle"></i> AI Analysis Failed: ${e.message}.<br><small>Please check your API Key in System Settings and your network connection.</small></span>`;
    } finally {
        btn.innerHTML = '<i class="fas fa-robot"></i> AI Analyze';
        btn.disabled = false;
    }
};

// Hook for dashboard.js to trigger updates if modal is open
StudyMonitor.updateWidget = function() {
    const page = document.getElementById('activity-monitor-view');
    if (page && page.classList.contains('active')) {
        renderActivityMonitorContent();
    }
};

window.StudyMonitor = StudyMonitor;

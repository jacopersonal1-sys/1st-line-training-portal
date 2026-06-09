/* ================= MAIN ENTRY ================= */

// --- NATIVE BRIDGE POLYFILL ---
// Maps legacy require('electron') calls to the new secure contextBridge
if (window.electronAPI) {
    window.require = function(mod) {
        if (mod === 'electron') return window.electronAPI;
        if (mod === 'path') return { join: (...args) => args.join('/') };
        throw new Error(`Module ${mod} is blocked by Context Isolation.`);
    };
    // Mock __dirname for module loaders
        let path = decodeURI(window.location.pathname);
        window.__dirname = path.substring(1, path.lastIndexOf('/'));
}

// --- NATIVE OS WAKE/RESUME LISTENER (Sleep Mode Fix) ---
if (window.electronAPI) {
    window.electronAPI.ipcRenderer.on('os-resume', () => {
        console.log("OS Woke from Sleep. Forcing immediate reconnection and sync...");
        const el = document.getElementById('sync-indicator');
        if(el) { el.style.opacity = '1'; el.innerHTML = '<i class="fas fa-bolt" style="color:#f1c40f;"></i> Waking...'; }
        if (typeof window.updateSyncDiagnostics === 'function') {
            window.updateSyncDiagnostics({
                status: 'syncing',
                statusText: 'Resuming after sleep',
                direction: 'process',
                phase: 'Reconnecting sync tunnel',
                item: 'OS resume event',
                startedAt: Date.now()
            });
        }
        
        // 1. Re-establish Database Client & WebSockets to prevent stale connections
        if (typeof initSupabaseClient === 'function') initSupabaseClient();
        if (typeof setupRealtimeListeners === 'function') setupRealtimeListeners();
        
        // 2. Instantly pull any data missed while the PC was asleep
        if (typeof loadFromServer === 'function') loadFromServer(true);
    });
}

// --- NATIVE OS SAFE QUIT (Final Push Fix) ---
if (window.electronAPI) {
    window.electronAPI.ipcRenderer.on('force-final-sync', async () => {
        console.log("Intercepted Close. Forcing final data sync...");
        const el = document.getElementById('sync-indicator');
        if(el) { el.style.opacity = '1'; el.innerHTML = '<i class="fas fa-save" style="color:#f1c40f;"></i> Finalizing...'; }
        if (typeof window.updateSyncDiagnostics === 'function') {
            window.updateSyncDiagnostics({
                status: 'busy',
                statusText: 'Finalizing before close',
                direction: 'upload',
                phase: 'Flushing pending saves',
                item: 'Application shutdown sync',
                startedAt: Date.now()
            });
        }
        
        if (typeof saveToServer === 'function') {
            // Flush existing queue immediately using delta sync to prevent timeouts
            await saveToServer('FLUSH', false, true);
        }
        
        // Tell main process it is safe to exit
        window.electronAPI.ipcRenderer.send('final-sync-complete');
    });
}

// --- GLOBAL CONSOLE RECORDER (For AI Analysis) ---
// Captures logs, warns, and errors so the AI can analyze app history.
window.CONSOLE_HISTORY = [];
window.UPDATE_DOWNLOADED = false; // Track update status
const MAX_LOG_SIZE = 1200; // Keep deep history for incident debugging

// ARCHITECTURAL FIX: Recursion lock for error reporting
window._IS_REPORTING_ERROR = false;
window._FETCH_LOG_WRAPPED = false;
window._AUTO_REPORT_CACHE = window._AUTO_REPORT_CACHE || {};

const AUTO_REPORT_TYPES = new Set(['error', 'fatal', 'unhandled-rejection', 'resource-error', 'silent-error', 'network-error']);

function mainReadJson(key, fallback) {
    if (typeof safeLocalParse === 'function') return safeLocalParse(key, fallback);
    try {
        const raw = localStorage.getItem(key);
        if (raw === null || raw === undefined || raw === '' || raw === 'undefined' || raw === 'null') return fallback;
        return JSON.parse(raw);
    } catch (e) {
        console.warn(`Main ignored invalid local data for ${key}:`, e);
        return fallback;
    }
}

function mainReadArray(key) {
    const value = mainReadJson(key, []);
    return Array.isArray(value) ? value : [];
}

function mainReadObject(key) {
    const value = mainReadJson(key, {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeStringifyForLog(value) {
    try {
        const seen = new WeakSet();
        return JSON.stringify(value, (key, val) => {
            if (typeof val === 'bigint') return val.toString();
            if (typeof val === 'object' && val !== null) {
                if (seen.has(val)) return '[Circular]';
                seen.add(val);
            }
            return val;
        });
    } catch (err) {
        return `[Unserializable: ${Object.prototype.toString.call(value)}]`;
    }
}

function formatLogArg(arg) {
    if (arg instanceof Error) {
        return arg.toString() + (arg.stack ? '\n' + arg.stack : '');
    }
    if (arg instanceof Event) {
        const target = arg.target && arg.target.tagName ? arg.target.tagName.toLowerCase() : 'unknown';
        return `Event(${arg.type}) target=${target}`;
    }
    if (typeof arg === 'object') return safeStringifyForLog(arg);
    return String(arg);
}

function shouldAutoReport(type, msg) {
    try {
        const cache = window._AUTO_REPORT_CACHE || {};
        const key = `${type}|${String(msg || '').slice(0, 280)}`;
        const now = Date.now();
        const last = cache[key] || 0;
        if ((now - last) < 30000) return false; // 30s dedupe window per signature
        cache[key] = now;

        const keys = Object.keys(cache);
        if (keys.length > 600) {
            keys.sort((a, b) => cache[a] - cache[b]);
            keys.slice(0, 300).forEach(k => delete cache[k]);
        }
        window._AUTO_REPORT_CACHE = cache;
        return true;
    } catch (err) {
        return true;
    }
}

function captureLog(type, args) {
    try {
        const msg = (args || []).map(formatLogArg).join(' ');
        
        window.CONSOLE_HISTORY.push({ type, msg, time: new Date().toISOString() });
        if (window.CONSOLE_HISTORY.length > MAX_LOG_SIZE) window.CONSOLE_HISTORY.shift();

        // --- SILENT CLOUD REPORTING ---
        const strMsg = msg.toString();
        // ARCHITECTURAL FIX: Prevent infinite stack overflow loops if the save function itself throws an error.
        if (AUTO_REPORT_TYPES.has(type) && typeof reportSystemError === 'function' && !window._IS_REPORTING_ERROR &&
            shouldAutoReport(type, strMsg) &&
            !strMsg.includes('Failed to fetch') && !strMsg.includes('NetworkError') && !strMsg.includes('521')) {
            window._IS_REPORTING_ERROR = true;
            reportSystemError(msg, type);
            setTimeout(() => { window._IS_REPORTING_ERROR = false; }, 1000);
        }
    } catch(e) { /* Prevent infinite loops if logging fails */ }
}

const originalConsoleLog = console.log;
console.log = function(...args) { captureLog('log', args); originalConsoleLog.apply(console, args); };

const originalConsoleWarn = console.warn;
console.warn = function(...args) { captureLog('warn', args); originalConsoleWarn.apply(console, args); };

const originalConsoleError = console.error;
console.error = function(...args) { captureLog('error', args); originalConsoleError.apply(console, args); };

const originalConsoleInfo = console.info ? console.info.bind(console) : console.log.bind(console);
console.info = function(...args) { captureLog('info', args); originalConsoleInfo(...args); };

const originalConsoleDebug = console.debug ? console.debug.bind(console) : console.log.bind(console);
console.debug = function(...args) { captureLog('debug', args); originalConsoleDebug(...args); };

window.onerror = function(msg, url, line, col, error) {
    captureLog('fatal', [`${msg} (at ${url}:${line}:${col})`, error]);
    return false; // Let default handler run
};

window.addEventListener('unhandledrejection', (event) => {
    captureLog('unhandled-rejection', ['Unhandled Promise Rejection:', event.reason]);
});

// Some Electron/Chromium builds occasionally lose the editable focus target after
// webview/iframe activity. Remembering and gently restoring the target avoids the
// "textbox will not type until minimize/maximize" failure mode.
window.__lastEditableFocus = null;

function isEditableTarget(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    const tag = String(el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

document.addEventListener('focusin', (event) => {
    if (isEditableTarget(event.target)) window.__lastEditableFocus = event.target;
}, true);

document.addEventListener('pointerdown', (event) => {
    const editable = event.target && event.target.closest ? event.target.closest('input, textarea, select, [contenteditable="true"]') : null;
    if (!editable) return;
    window.__lastEditableFocus = editable;
    setTimeout(() => {
        if (document.activeElement !== editable && editable.isConnected && typeof editable.focus === 'function') {
            editable.focus({ preventScroll: true });
        }
    }, 0);
}, true);

window.addEventListener('focus', () => {
    const editable = window.__lastEditableFocus;
    if (!editable || !editable.isConnected || document.activeElement === editable) return;
    setTimeout(() => {
        if (editable.isConnected && typeof editable.focus === 'function') editable.focus({ preventScroll: true });
    }, 50);
});

// Capture resource failures that often appear as "silent" UI issues (script/css/img/webview assets).
window.addEventListener('error', (event) => {
    try {
        const target = event && event.target;
        if (!target || target === window || !target.tagName) return;
        const tag = String(target.tagName || '').toLowerCase();
        const source = target.src || target.href || target.currentSrc || '(unknown source)';
        captureLog('resource-error', [`Resource failed to load <${tag}>`, source]);
    } catch (err) {
        captureLog('warn', ['Resource error capture failed', err]);
    }
}, true);

// Capture failed network responses and transport exceptions, even when callers do not console.error them.
if (typeof window.fetch === 'function' && !window._FETCH_LOG_WRAPPED) {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function(...args) {
        const input = args[0];
        const reqUrl = (typeof input === 'string')
            ? input
            : (input && typeof input === 'object' && input.url ? input.url : 'unknown_url');
        try {
            const response = await originalFetch(...args);
            if (!response.ok) {
                captureLog('network-error', [`HTTP ${response.status} ${response.statusText || ''}`.trim(), reqUrl]);
            }
            return response;
        } catch (err) {
            captureLog('network-error', [`Fetch failed`, reqUrl, err]);
            throw err;
        }
    };
    window._FETCH_LOG_WRAPPED = true;
}

// Optional helper for caught/swallowed errors in try/catch blocks.
window.captureSilentError = function(error, context = 'Silent error captured') {
    captureLog('silent-error', [context, error]);
};

const REPORT_PROBLEM_MODAL_ID = 'reportProblemModal';
const REPORT_PROBLEM_FAB_ID = 'reportProblemFab';

function formatConsoleHistorySnapshot() {
    const history = Array.isArray(window.CONSOLE_HISTORY) ? window.CONSOLE_HISTORY : [];
    if (history.length === 0) return 'No console history captured yet.';

    return history.map(entry => {
        const ts = entry && entry.time ? entry.time : new Date().toISOString();
        const lvl = entry && entry.type ? String(entry.type).toUpperCase() : 'LOG';
        const msg = entry && entry.msg ? String(entry.msg) : '';
        return `[${ts}] [${lvl}] ${msg}`;
    }).join('\n');
}

function ensureReportProblemUI() {
    if (document.getElementById(REPORT_PROBLEM_FAB_ID)) return;

    const html = `
        <button id="${REPORT_PROBLEM_FAB_ID}" class="report-problem-fab" type="button" title="Report a problem" onclick="openReportProblemModal()">?</button>
        <div id="${REPORT_PROBLEM_MODAL_ID}" class="modal-overlay hidden report-problem-overlay" style="z-index:12000;">
            <div class="modal-box report-problem-box" role="dialog" aria-modal="true" aria-labelledby="reportProblemTitle">
                <div class="report-problem-header">
                    <h3 id="reportProblemTitle"><i class="fas fa-exclamation-circle"></i> Report Problem</h3>
                    <button class="btn-secondary btn-sm" type="button" onclick="closeReportProblemModal()">&times;</button>
                </div>
                <p class="report-problem-copy">Tell us what happened. Console logs are captured automatically at the moment you open this report.</p>
                <label for="reportProblemDetail" class="report-problem-label">Issue Details</label>
                <textarea id="reportProblemDetail" class="report-problem-textarea" placeholder="Describe what you were doing, what you expected, and what happened..." rows="6"></textarea>
                <label for="reportProblemConsole" class="report-problem-label">Console Snapshot (Auto)</label>
                <textarea id="reportProblemConsole" class="report-problem-textarea report-problem-console" rows="10" readonly></textarea>
                <div id="reportProblemMeta" class="report-problem-meta"></div>
                <div class="report-problem-actions">
                    <button class="btn-secondary" type="button" onclick="closeReportProblemModal()">Cancel</button>
                    <button id="reportProblemSubmitBtn" class="btn-danger" type="button" onclick="submitReportProblem()"><i class="fas fa-paper-plane"></i> Submit Report</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    const modal = document.getElementById(REPORT_PROBLEM_MODAL_ID);
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target && e.target.id === REPORT_PROBLEM_MODAL_ID) closeReportProblemModal();
        });
    }
}

window.openReportProblemModal = function() {
    ensureReportProblemUI();
    const modal = document.getElementById(REPORT_PROBLEM_MODAL_ID);
    const detailEl = document.getElementById('reportProblemDetail');
    const consoleEl = document.getElementById('reportProblemConsole');
    const metaEl = document.getElementById('reportProblemMeta');
    if (!modal || !detailEl || !consoleEl || !metaEl) return;

    const snapshot = formatConsoleHistorySnapshot();
    const activeSection = document.querySelector('section.active');
    const activeTab = activeSection ? activeSection.id : 'unknown';
    const user = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.user) ? CURRENT_USER.user : 'Guest';

    detailEl.value = '';
    consoleEl.value = snapshot;
    metaEl.innerText = `Captured: ${new Date().toLocaleString()} | User: ${user} | Tab: ${activeTab} | Version: ${window.APP_VERSION || 'Unknown'}`;

    modal.classList.remove('hidden');
    setTimeout(() => { detailEl.focus(); }, 10);
};

window.closeReportProblemModal = function() {
    const modal = document.getElementById(REPORT_PROBLEM_MODAL_ID);
    if (modal) modal.classList.add('hidden');
};

window.submitReportProblem = async function() {
    const detailEl = document.getElementById('reportProblemDetail');
    const consoleEl = document.getElementById('reportProblemConsole');
    const submitBtn = document.getElementById('reportProblemSubmitBtn');
    if (!detailEl || !consoleEl) return;

    const issueDetail = detailEl.value.trim();
    if (!issueDetail) {
        alert("Please describe the issue before submitting.");
        detailEl.focus();
        return;
    }

    const activeSection = document.querySelector('section.active');
    const activeTab = activeSection ? activeSection.id : 'unknown';
    const summary = issueDetail.length > 240 ? `${issueDetail.substring(0, 240)}...` : issueDetail;
    const payload = {
        source: 'report_problem',
        issueDetail,
        consoleSnapshot: consoleEl.value || formatConsoleHistorySnapshot(),
        pageUrl: window.location.href,
        appVersion: window.APP_VERSION || 'Unknown',
        activeTab
    };

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Submitting...';
    }
    try {
        let result = null;
        if (typeof reportSystemError === 'function') {
            result = await reportSystemError(summary, 'user_report', payload);
        } else {
            const report = {
                id: Date.now() + "_" + Math.random().toString(36).substr(2, 5),
                user: (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.user) ? CURRENT_USER.user : 'Guest',
                role: (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.role) ? CURRENT_USER.role : 'Unknown',
                error: summary,
                type: 'user_report',
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent,
                source: 'report_problem',
                issueDetail: issueDetail,
                consoleSnapshot: payload.consoleSnapshot,
                pageUrl: payload.pageUrl,
                activeTab: payload.activeTab,
                appVersion: payload.appVersion
            };
            const reports = mainReadArray('error_reports');
            reports.push(report);
            if (reports.length > 500) reports.shift();
            localStorage.setItem('error_reports', JSON.stringify(reports));
            result = { saved: true, synced: false, report };
        }

        const saved = !result || result.saved !== false;
        const synced = !result || result.synced !== false;
        if (!saved) throw new Error("Local report write failed.");

        if (typeof showToast === 'function') {
            showToast(
                synced ? "Problem report submitted." : "Problem report saved locally. Cloud sync will retry automatically.",
                synced ? "success" : "warning"
            );
        }
        closeReportProblemModal();
    } catch (err) {
        console.error("Problem report submission failed:", err);
        if (typeof showToast === 'function') showToast("Failed to submit problem report.", "error");
        else alert("Failed to submit problem report.");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = submitBtn.dataset.originalText || '<i class="fas fa-paper-plane"></i> Submit Report';
        }
    }
};

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modal = document.getElementById(REPORT_PROBLEM_MODAL_ID);
        if (modal && !modal.classList.contains('hidden')) closeReportProblemModal();
    }
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureReportProblemUI);
} else {
    ensureReportProblemUI();
}

// Self-heal in case third-party rendering or modal cleanup removes the FAB unexpectedly.
window.ensureReportProblemUI = ensureReportProblemUI;
window.addEventListener('focus', () => {
    if (!document.getElementById(REPORT_PROBLEM_FAB_ID)) ensureReportProblemUI();
});

// Lock to prevent concurrent failovers destroying the boot cycle
window._isSwitchingServers = false;
window._diskCacheRecoveredThisBoot = false;

function isSyncMetadataKey(key) {
    return key.startsWith('sync_ts_') || key.startsWith('row_sync_ts_') || key.startsWith('hash_map_');
}

function isRiskyDiskCacheKey(key) {
    if (!key) return false;
    if (isSyncMetadataKey(key)) return true;
    return key === 'active_server_target' || key === 'last_connected_server';
}

function clearLocalSyncMetadata() {
    Object.keys(localStorage).forEach(k => {
        if (isSyncMetadataKey(k)) localStorage.removeItem(k);
    });
}

async function migrateLocalStateToActiveServer(options = {}) {
    const { silent = false, loaderText = null } = options;

    if (typeof saveToServer !== 'function') return true;

    if (loaderText) {
        const txt = document.getElementById('loader-text');
        if (txt) txt.innerText = loaderText;
    }

    const configKeys = ['system_config'];
    const safeKeys = Object.keys(DB_SCHEMA || {}).filter(k => !configKeys.includes(k));
    const saveResult = await saveToServer(safeKeys, true, silent);

    if (!saveResult) {
        throw new Error("Migration save failed.");
    }

    if (window.supabaseClient) {
        const tables = ['records', 'submissions', 'live_bookings', 'attendance', 'saved_reports', 'insight_reviews', 'link_requests'];
        for (const table of tables) {
            const { data: serverIds } = await window.supabaseClient.from(table).select('id');
            if (serverIds) {
                const localKey = Object.keys(ROW_MAP).find(k => ROW_MAP[k] === table);
                if (localKey) {
                    const localData = mainReadArray(localKey);
                    const localIdSet = new Set(localData.map(i => i.id ? i.id.toString() : null).filter(i => i));
                    const toDelete = serverIds.filter(row => !localIdSet.has(row.id.toString())).map(r => r.id);
                    if (toDelete.length > 0) await window.supabaseClient.from(table).delete().in('id', toDelete);
                }
            }
        }
    }

    return true;
}

function applyRecordSubmissionSyncSafetyPatch() {
    const patchKey = 'v252_sync_safety_patch_records_submissions';
    if (localStorage.getItem(patchKey)) return;

    try {
        ['records', 'submissions'].forEach((key) => {
            const safeArray = mainReadArray(key);

            // Preserve local offline work, but remove obvious duplicate identities before the fresh pull.
            const deduped = (typeof dedupeArrayByIdentity === 'function')
                ? dedupeArrayByIdentity(key, safeArray, 'local_wins')
                : safeArray;

            localStorage.setItem(key, JSON.stringify(deduped));
            localStorage.removeItem(`row_sync_ts_${key}`);
            localStorage.removeItem(`hash_map_${key}`);
        });

        localStorage.setItem(patchKey, 'true');
        console.log("Applied sync safety patch for records/submissions. Fresh reconciliation will run on next load.");
    } catch (error) {
        console.error("Sync safety patch failed:", error);
    }
}

// --- NEW: SILENT BACKGROUND SERVER FAILOVER ---
window.performSilentServerSwitch = async function(newTarget) {
    if (window._isSwitchingServers) return;
    window._isSwitchingServers = true;
    const previousTarget = localStorage.getItem('last_connected_server') || localStorage.getItem('active_server_target') || 'cloud';
    try {
        console.warn(`[Silent Failover] Initiating transition to ${newTarget.toUpperCase()}`);
        if (typeof showToast === 'function') showToast(`Switching to ${newTarget.toUpperCase()} Server...`, 'info');

        const lastTarget = previousTarget;
        localStorage.setItem('active_server_target', newTarget);

        // 1. Clear old Realtime Channels
        if (window.supabaseClient) {
            try { await window.supabaseClient.removeAllChannels(); } catch(e) {}
        }

        // 2. Re-initialize Database Client
        if (typeof initSupabaseClient === 'function') initSupabaseClient();

        if (!window.supabaseClient) {
            if (typeof showToast === 'function') showToast(`Failed to connect to ${newTarget.toUpperCase()}.`, 'error');
            return;
        }

        // 3. Perform Migration Logic (Silent background equivalent of boot migration)
        if (lastTarget !== newTarget) {
            Object.keys(localStorage).forEach(k => {
                if(k.startsWith('hash_map_')) localStorage.removeItem(k);
                if(k.startsWith('sync_ts_')) localStorage.removeItem(k);
                if(k.startsWith('row_sync_ts_')) localStorage.removeItem(k);
            });

            if (window._diskCacheRecoveredThisBoot) {
                console.warn("[Silent Failover] Migration push skipped due to disk-cache recovery on this boot.");
            } else {
                await migrateLocalStateToActiveServer({ silent: true });
            }
            localStorage.setItem('last_connected_server', newTarget);
        }

        // 4. Restart Engine & Pull fresh data
        if (typeof loadFromServer === 'function') await loadFromServer(true);
        if (typeof setupRealtimeListeners === 'function') setupRealtimeListeners();

        // 5. Update Server Indicator Visual
        if (typeof updateSidebarVisibility === 'function') updateSidebarVisibility();
        if (typeof refreshAllDropdowns === 'function') refreshAllDropdowns();

        if (typeof showToast === 'function') showToast(`Successfully connected to ${newTarget.toUpperCase()}.`, 'success');
    } catch (e) {
        console.error(`[Silent Failover] Failed to switch to ${newTarget.toUpperCase()}:`, e);
        localStorage.setItem('active_server_target', previousTarget);
        if (typeof initSupabaseClient === 'function') initSupabaseClient();
        if (typeof setupRealtimeListeners === 'function') setupRealtimeListeners();
        if (typeof showToast === 'function') showToast(`Switch to ${newTarget.toUpperCase()} failed. Staying on ${previousTarget.toUpperCase()}.`, 'error');
    } finally {
        window._isSwitchingServers = false;
    }
};


// --- HELPER: ASYNC SAVE ---
// Ensures initialization data (like default admin) is saved to Supabase before app usage.
async function secureInitSave() {
    // In the Cloud version, we treat initialization saves as critical.
    // We attempt to sync immediately.
    if (typeof saveToServer === 'function') {
        try {
            await saveToServer(['users'], true);
        } catch(e) {
            console.error("Init Cloud Sync Error:", e);
        }
    }
}

// --- GLOBAL CRASH/CLOSE PROTECTION ---
window.addEventListener('beforeunload', () => {
    if (typeof saveAssessmentDraft === 'function') saveAssessmentDraft();
    if (typeof saveBuilderDraft === 'function') saveBuilderDraft();
});

async function readAppWindowLaunchPayload() {
    if (!window.electronAPI?.appWindows?.getLaunchPayload) return null;
    try {
        const payload = await window.electronAPI.appWindows.getLaunchPayload();
        return payload && typeof payload === 'object' ? payload : null;
    } catch (error) {
        console.warn('App child-window launch payload unavailable:', error);
        return null;
    }
}

function applyAppWindowLaunchPayload(payload) {
    if (!payload || typeof payload !== 'object') return;
    const mode = String(payload.mode || '').trim().toLowerCase();
    const user = payload.user && typeof payload.user === 'object' ? payload.user : null;
    const tabId = String(payload.tabId || '').trim();

    window.APP_WINDOW_LAUNCH = payload;
    window.APP_CHILD_WINDOW_MODE = mode || 'tab';
    window.APP_PASSIVE_TAB_WINDOW = mode === 'tab';
    sessionStorage.setItem('app_child_window_mode', window.APP_CHILD_WINDOW_MODE);
    sessionStorage.setItem('app_passive_tab_window', window.APP_PASSIVE_TAB_WINDOW ? 'true' : 'false');
    sessionStorage.removeItem('real_admin_identity');
    sessionStorage.removeItem('impersonating_user');

    if (user && user.user) {
        const normalizedRole = String(user.role || '').trim().toLowerCase();
        const childUser = { ...user, role: normalizedRole || user.role };
        const bootMode = normalizedRole === 'trainee' ? 'trainee' : 'admin';
        sessionStorage.setItem('currentUser', JSON.stringify(childUser));
        sessionStorage.setItem('boot_role_selection', bootMode);
        window.APP_BOOT_MODE = bootMode;
    }

    if (tabId) window.RESTORE_TAB = tabId;
}

function ensureAppChildWindowChrome() {
    if (!window.APP_CHILD_WINDOW_MODE || document.getElementById('app-child-window-controls')) return;
    document.body.classList.add('app-child-window');
    const header = document.querySelector('.top-header');
    if (!header) return;

    const controls = document.createElement('div');
    controls.id = 'app-child-window-controls';
    controls.className = 'app-window-controls';
    controls.innerHTML = `
        <button type="button" onclick="window.electronAPI?.windowControls?.minimize()" title="Minimize"><i class="fas fa-minus"></i></button>
        <button type="button" onclick="window.electronAPI?.windowControls?.maximize()" title="Maximize"><i class="far fa-square"></i></button>
        <button type="button" class="close" onclick="window.electronAPI?.windowControls?.close()" title="Close"><i class="fas fa-times"></i></button>
    `;
    header.appendChild(controls);

    const brand = header.querySelector('.nav-brand');
    if (brand) {
        const label = window.APP_CHILD_WINDOW_MODE === 'impersonate'
            ? `Impersonating ${CURRENT_USER?.user || 'User'}`
            : 'Popout Window';
        brand.setAttribute('title', label);
    }
}

window.onload = async function() {
    applyAppWindowLaunchPayload(await readAppWindowLaunchPayload());
    if (window.APP_CHILD_WINDOW_MODE && typeof ensureAppChildWindowChrome === 'function') {
        ensureAppChildWindowChrome();
    }
    if (typeof refreshAdaptiveViewportLayout === 'function') {
        refreshAdaptiveViewportLayout();
    }
    initSidebarHoverController();
    if (typeof applyUIDensity === 'function') applyUIDensity();
    if (typeof installResponsiveTableCards === 'function') installResponsiveTableCards();
    if (typeof updateViewSyncIndicators === 'function') updateViewSyncIndicators();
    ensureReportProblemUI();
    if (typeof refreshSsoLoginVisibility === 'function') refreshSsoLoginVisibility();

    // --- INJECT GLOBAL VISUAL STYLES ---
    if (!document.getElementById('global-visuals')) {
        // --- CLIENT IDENTITY ---
        if (!localStorage.getItem('client_id')) {
            localStorage.setItem('client_id', 'CL-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 5).toUpperCase());
        }
        // -----------------------

        const style = document.createElement('style');
        style.id = 'global-visuals';
        style.innerHTML = `
            @keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
            @keyframes shake { 0%, 100% { transform: translateX(0); } 10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); } 20%, 40%, 60%, 80% { transform: translateX(5px); } }
            .shake-anim { animation: shake 0.4s cubic-bezier(.36,.07,.19,.97) both; }
            .toast {
                animation: slideInRight 0.3s ease-out forwards;
                position: relative; overflow: hidden;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15); border-radius: 4px;
                display: flex; flex-direction: column; justify-content: center;
            }
            .toast-progress {
                position: absolute; bottom: 0; left: 0; height: 3px;
                background: rgba(255,255,255,0.5); width: 100%;
                transition: width 3s linear;
            }
            /* --- LOGIN SCREEN VISUALS --- */
            .login-input {
                width: 100%; padding: 12px 15px; margin-bottom: 15px;
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 6px; color: white;
                transition: all 0.3s ease;
            }
            .login-input:focus {
                background: rgba(255, 255, 255, 0.1);
                border-color: var(--primary); outline: none;
                box-shadow: 0 0 0 2px rgba(243, 112, 33, 0.2);
            }
            select.login-input {
                appearance: none; cursor: pointer;
                background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23FFFFFF%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E");
                background-repeat: no-repeat; background-position: right .7em top 50%; background-size: .65em auto;
            }
            .login-toggle-container {
                background: rgba(0,0,0,0.3); border-radius: 25px; padding: 4px;
                display: flex; margin-bottom: 20px; position: relative;
            }
            .login-toggle-btn {
                flex: 1; background: transparent; border: none; color: #aaa;
                padding: 8px; border-radius: 20px; cursor: pointer;
                transition: all 0.3s ease; font-weight: 600;
            }
            .login-toggle-btn.active {
                background: var(--primary); color: white;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            }
            .login-btn-main {
                width: 100%; padding: 12px; border: none; border-radius: 6px;
                background: var(--primary); color: white; font-weight: bold;
                cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;
            }
            .login-btn-main:hover {
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(243, 112, 33, 0.3);
            }
            .fade-in-up { animation: fadeInUp 0.3s ease-out forwards; }
            /* --- LOGIN EXIT ANIMATION --- */
            @keyframes loginExit {
                0% { opacity: 1; transform: scale(1); filter: blur(0); }
                100% { opacity: 0; transform: scale(1.2); filter: blur(20px); }
            }
            .login-exit-anim {
                animation: loginExit 1.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                pointer-events: none;
                will-change: opacity, transform, filter;
            }
            
            /* --- STUDY BROWSER --- */
            #study-browser-shell { display: flex; flex-direction: column; height: 100%; background: var(--bg-card); }
            .study-header { display: flex; align-items: center; background: var(--bg-input); padding: 10px 140px 10px 15px; border-bottom: 1px solid var(--border-color); flex-shrink: 0; -webkit-app-region: drag; }
            .study-nav-controls { display: flex; gap: 8px; -webkit-app-region: no-drag; margin-right: 15px; position: relative; z-index: 10; }
            .study-nav-controls button { background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-main); width: 42px; height: 42px; border-radius: 8px; cursor: pointer; display:flex; align-items:center; justify-content:center; font-size:1.2rem; transition: 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .study-nav-controls button:hover { background: var(--primary); color: white; border-color: var(--primary); transform: translateY(-2px); }
            .study-tabs-container { flex: 1; display: flex; overflow-x: auto; padding: 0 10px; -webkit-app-region: no-drag; position: relative; z-index: 10; }
            #study-tabs-list { display: flex; gap: 5px; align-items: flex-end; }
            .study-tab { display: flex; align-items: center; gap: 8px; background: var(--bg-card); padding: 8px 12px; border-radius: 6px 6px 0 0; border: 1px solid var(--border-color); border-bottom: none; cursor: pointer; font-size: 0.8rem; white-space: nowrap; }
            .study-tab.active { background: var(--bg-app); border-bottom: 1px solid var(--bg-app); color: var(--primary); font-weight: bold; }
            .study-tab-close { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 0; width: 16px; height: 16px; line-height: 16px; text-align: center; border-radius: 50%; }
            .study-tab-close:hover { background: var(--bg-hover); color: #ff5252; }
            .study-header-actions { display: flex; gap: 15px; align-items: center; -webkit-app-region: no-drag; position: relative; z-index: 10; }
            #study-quick-links { font-size: 0.9rem; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-main); cursor: pointer; font-weight: bold; }
            #study-close-btn { background: rgba(255, 82, 82, 0.1); color: #ff5252; border: 1px solid #ff5252; padding: 8px 15px; border-radius: 6px; cursor: pointer; font-weight: bold; transition: 0.2s; }
            #study-close-btn:hover { background: #ff5252; color: white; }
            #study-webview-container { flex: 1; position: relative; min-height: 0; overflow: hidden; }
            .study-webview { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none; pointer-events: auto; background: #fff; }
            .study-webview.hidden { visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; left: -200vw !important; }
            
            /* --- EXTERNAL APP WARNING --- */
            #external-app-warning-modal {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.9); z-index: 20000;
                display: flex; align-items: center; justify-content: center;
                animation: fadeIn 0.3s ease;
            }
            #external-app-warning-modal .modal-box {
                max-width: 500px; text-align: center;
                border-top: 5px solid #f1c40f;
            }
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

            /* --- MODERN MINIMALIST LOGIN --- */
            .login-box {
                background: rgba(255, 255, 255, 0.02) !important;
                backdrop-filter: blur(25px);
                border: 1px solid rgba(255, 255, 255, 0.08) !important;
                box-shadow: 0 30px 60px rgba(0,0,0,0.5) !important;
                border-radius: 20px !important;
                padding: 50px 40px !important;
            }
            .login-input {
                background: transparent !important;
                border: none !important;
                border-bottom: 1px solid rgba(255, 255, 255, 0.3) !important;
                border-radius: 0 !important;
                padding: 15px 5px !important;
                font-size: 1.1rem !important;
                margin-bottom: 25px !important;
                transition: all 0.4s ease !important;
            }
            .login-input:focus {
                border-bottom-color: var(--primary) !important;
                background: linear-gradient(to bottom, transparent 95%, rgba(243, 112, 33, 0.1) 100%) !important;
                padding-left: 10px !important;
            }
            .login-btn-main {
                border-radius: 30px !important;
                padding: 15px !important;
                font-size: 1rem !important;
                letter-spacing: 2px;
                text-transform: uppercase;
                background: linear-gradient(135deg, var(--primary), #e67e22) !important;
                box-shadow: 0 10px 30px -10px rgba(243, 112, 33, 0.6) !important;
                margin-top: 10px;
            }
            .login-btn-main:hover {
                transform: translateY(-3px) scale(1.02) !important;
                box-shadow: 0 15px 35px -10px rgba(243, 112, 33, 0.8) !important;
            }
            .login-toggle-container {
                background: rgba(0,0,0,0.3) !important;
                border-radius: 30px !important;
                padding: 5px !important;
                margin-bottom: 30px !important;
            }
            .login-toggle-btn {
                border-radius: 25px !important;
                font-weight: 500 !important;
                letter-spacing: 1px;
            }
            .login-toggle-btn.active {
                background: var(--primary) !important;
                box-shadow: 0 4px 15px rgba(0,0,0,0.3) !important;
            }
            .login-wrapper {
                position: relative;
                z-index: 1; /* Ensure form sits above particles */
            }
            /* --- TAB TRANSITIONS --- */
            @keyframes tabExit {
                0% { opacity: 1; transform: scale(1); filter: blur(0); }
                100% { opacity: 0; transform: scale(0.95); filter: blur(10px); }
            }
            @keyframes tabEnter {
                0% { opacity: 0; transform: translateY(20px) scale(0.98); filter: blur(10px); }
                100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
            }
            .tab-exit-anim { animation: tabExit 0.4s ease-in forwards; pointer-events: none; }
            .tab-enter-anim { animation: tabEnter 0.6s ease-out forwards; }

            /* --- GLOBAL INTERACTIVITY IMPROVEMENTS --- */
            
            /* 1. Table Row Lift & Highlight */
            .admin-table tbody tr {
                transition: transform 0.2s ease, background-color 0.2s, box-shadow 0.2s;
                border-radius: 4px; /* Soften edges */
            }
            .admin-table tbody tr:hover {
                transform: scale(1.01);
                background-color: rgba(255,255,255,0.03) !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                z-index: 1; position: relative; /* Bring to front */
                border-color: transparent; /* Hide border to look like a card */
            }
            
            /* 2. Tactile Button Press */
            button:not(:disabled) {
                transition: transform 0.1s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.2s, box-shadow 0.2s;
            }
            button:not(:disabled):active {
                transform: scale(0.95); /* Physical press feel */
            }

            /* 3. Springy Modal Entrance */
            @keyframes modalSpring {
                0% { opacity: 0; transform: scale(0.8) translateY(20px); }
                100% { opacity: 1; transform: scale(1) translateY(0); }
            }
            .modal-box {
                animation: modalSpring 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
            }

            /* 4. Custom Slim Scrollbars */
            ::-webkit-scrollbar { width: 8px; height: 8px; }
            ::-webkit-scrollbar-track { background: transparent; }
            ::-webkit-scrollbar-thumb { background: rgba(150, 150, 150, 0.3); border-radius: 4px; }
            ::-webkit-scrollbar-thumb:hover { background: var(--primary); }

            /* --- 5. ACTIVE SIDEBAR GLOW --- */
            .nav-item.active {
                background: linear-gradient(90deg, var(--primary-soft) 0%, transparent 100%) !important;
                color: var(--primary) !important;
                border-right: 3px solid var(--primary) !important;
                box-shadow: inset -5px 0 15px -5px var(--primary-soft), 0 0 10px rgba(243, 112, 33, 0.1);
                text-shadow: 0 0 8px rgba(243, 112, 33, 0.4);
                transition: all 0.3s ease;
            }

            /* --- 6. SKELETON LOADER ROWS --- */
            .skeleton-row td {
                position: relative;
                overflow: hidden;
                color: transparent !important;
                pointer-events: none;
            }
            .skeleton-row td::after {
                content: ''; position: absolute; top: 8px; left: 8px; right: 8px; bottom: 8px;
                background: var(--bg-input); border-radius: 4px;
                animation: skeleton-pulse 1.5s infinite ease-in-out;
            }
            @keyframes skeleton-pulse { 0% { opacity: 0.3; } 50% { opacity: 0.6; } 100% { opacity: 0.3; } }

            /* --- 7. MODERN ASSESSMENT BUILDER --- */
            .question-card {
                border: 1px solid var(--border-color); background: var(--bg-card);
                border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);
                transition: all 0.3s ease; overflow: hidden; margin-bottom: 25px;
            }
            .question-card:hover, .question-card:focus-within {
                transform: translateY(-3px);
                box-shadow: 0 12px 30px rgba(0,0,0,0.15);
                border-color: var(--primary-soft);
            }
            .q-header {
                background: linear-gradient(to right, var(--bg-input), var(--bg-card));
                padding: 15px 25px; border-bottom: 1px solid var(--border-color);
                display: flex; justify-content: space-between; align-items: center;
            }
            .opt-row {
                background: var(--bg-input); padding: 8px 15px; border-radius: 8px;
                margin-bottom: 8px; border: 1px solid transparent; transition: 0.2s;
            }
            .opt-row:focus-within { border-color: var(--primary); background: var(--bg-card); }

            /* --- 8. MODERN TEST TAKER VIEW --- */
            .test-paper { max-width: 900px; margin: 0 auto; }
            .taking-card {
                border: none !important; background: var(--bg-card);
                box-shadow: 0 10px 30px rgba(0,0,0,0.08) !important;
                border-radius: 20px !important; padding: 35px !important;
                position: relative; overflow: hidden; margin-bottom: 40px !important;
            }
            .taking-card::before {
                content: ''; position: absolute; top: 0; left: 0; width: 6px; height: 100%;
                background: var(--border-color); transition: 0.3s;
            }
            .taking-card.answered::before { background: #2ecc71; box-shadow: 0 0 15px #2ecc71; }
            
            .taking-radio {
                display: flex !important; align-items: center; padding: 18px 25px !important;
                margin-bottom: 12px; border: 2px solid var(--border-color); border-radius: 12px !important;
                background: var(--bg-input); transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                cursor: pointer; position: relative;
            }
            .taking-radio:hover { border-color: var(--primary); background: var(--bg-hover); transform: translateX(5px); }
            .taking-radio:has(input:checked) {
                border-color: var(--primary); background: var(--primary-soft);
                box-shadow: 0 4px 15px rgba(0,0,0,0.05);
            }
            .taking-radio input { width: 22px; height: 22px; margin-right: 20px; accent-color: var(--primary); cursor: pointer; }
            .taking-radio span { font-size: 1.05rem; font-weight: 500; }

            /* --- 9. DASHBOARD VISUALS (v2.1.53) --- */
            .dash-header {
                background: var(--bg-card);
                border: 1px solid var(--border-color);
                border-radius: 16px;
                padding: 25px 30px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.05);
                position: relative;
                overflow: hidden;
                margin-bottom: 25px;
            }
            .dash-header::before {
                content: ''; position: absolute; top: 0; left: 0; width: 6px; height: 100%;
                background: var(--primary);
            }
            .dash-card {
                background: var(--bg-card);
                border: 1px solid var(--border-color);
                border-radius: 16px;
                padding: 20px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.03);
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                display: flex; flex-direction: column;
                position: relative;
                height: 100%;
            }
            .dash-card:hover {
                transform: translateY(-5px);
                box-shadow: 0 15px 35px rgba(0,0,0,0.1);
                border-color: var(--primary-soft);
            }
            .dash-icon {
                width: 48px; height: 48px;
                border-radius: 12px;
                display: flex; align-items: center; justify-content: center;
                font-size: 1.4rem;
                background: var(--bg-input);
                color: var(--primary);
                transition: 0.3s;
            }
            .dash-card:hover .dash-icon {
                background: var(--primary);
                color: white;
                transform: scale(1.1) rotate(5deg);
            }
            /* Hero Widget (Up Next) */
            .hero-widget {
                background: linear-gradient(135deg, var(--primary), #e67e22) !important;
                border: none !important;
                color: white !important;
            }
            .hero-widget .dash-icon {
                background: rgba(255,255,255,0.2) !important;
                color: white !important;
            }
            .hero-widget h2, .hero-widget h3, .hero-widget p, .hero-widget .text-muted {
                color: rgba(255,255,255,0.9) !important;
            }
            .hero-widget button {
                background: white !important;
                color: var(--primary) !important;
                border: none !important;
                box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            }
            .hero-widget button:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 20px rgba(0,0,0,0.3);
            }
            /* Badge Grid */
            .badge-grid {
                display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 15px; padding: 10px 0;
            }
            .badge-reward {
                display: flex; flex-direction: column; align-items: center; text-align: center;
                padding: 10px; border-radius: 12px; background: var(--bg-input);
                border: 1px solid transparent; transition: 0.3s;
            }
            .badge-reward:hover {
                background: var(--bg-card); box-shadow: 0 5px 15px rgba(0,0,0,0.1); transform: scale(1.05);
            }
            .badge-icon { font-size: 2rem; margin-bottom: 5px; }
            .badge-title { font-size: 0.75rem; font-weight: bold; line-height: 1.2; }
            .badge-gold { border-color: #f1c40f; background: rgba(241, 196, 15, 0.1); }
            .badge-silver { border-color: #bdc3c7; background: rgba(189, 195, 199, 0.1); }
            .badge-bronze { border-color: #d35400; background: rgba(211, 84, 0, 0.1); }
            .badge-mythic { border-color: #9b59b6; background: rgba(155, 89, 182, 0.1); box-shadow: 0 0 10px rgba(155, 89, 182, 0.3); }
            .badge-shame { border-color: #7f8c8d; opacity: 0.7; filter: grayscale(0.5); }

            /* --- LIGHT MODE ACCESSIBILITY FIXES --- */
            body.light-mode {
                --text-main: #111111 !important;
                --text-muted: #444444 !important; /* Slightly softer for less harshness */
                --border-color: #bbbbbb !important; /* Softer borders (was #888) */
                --bg-input: #f4f4f4 !important;
                --bg-hover: #e0e0e0 !important;
            }
            body.light-mode .text-muted { color: #444444 !important; font-weight: 600 !important; }
            body.light-mode small { color: #444444 !important; font-weight: 600 !important; }
            body.light-mode ::placeholder { color: #444444 !important; opacity: 1; font-weight: 500; }

            /* --- THEME TOGGLE SMOOTHING --- */
            body.theme-transitioning,
            body.theme-transitioning .card,
            body.theme-transitioning .dash-card,
            body.theme-transitioning .modal-box,
            body.theme-transitioning input,
            body.theme-transitioning select,
            body.theme-transitioning textarea,
            body.theme-transitioning button,
            body.theme-transitioning .nav-item,
            body.theme-transitioning .sidebar,
            body.theme-transitioning .content-wrapper {
                transition: background-color 0.22s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.22s cubic-bezier(0.4, 0, 0.2, 1), color 0.22s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.22s cubic-bezier(0.4, 0, 0.2, 1);
            }
        `;
        document.head.appendChild(style);
    }

    const loader = document.getElementById('global-loader');
    const isPassiveAppTabWindow = !!window.APP_PASSIVE_TAB_WINDOW;

    const startupBootRole = getStartupBootRoleMode();
    if (!startupBootRole) {
        window.APP_BOOT_MODE = null;
        applyBootRoleUi('');
        if (loader) loader.classList.add('hidden');
        if (typeof initLoginParticles === 'function') initLoginParticles();
        return;
    }

    window.APP_BOOT_MODE = startupBootRole;
    sessionStorage.setItem('boot_role_selection', startupBootRole);
    applyBootRoleUi(startupBootRole);
    const isTraineeBootMode = startupBootRole === 'trainee';

    // SHOW LOADER
    if(loader) loader.classList.remove('hidden');

    // --- NATIVE DISK CACHE RECOVERY ---
    if (!isPassiveAppTabWindow && window.electronAPI && window.electronAPI.disk) {
        // If critical data is missing, the browser cache was likely wiped.
        if (!localStorage.getItem('users') || localStorage.length < 5) {
            console.warn("LocalStorage appears empty/wiped. Attempting native disk recovery...");
            try {
                const cacheData = await window.electronAPI.disk.loadCache();
                if (cacheData) {
                    const parsed = (typeof safeParse === 'function') ? safeParse(cacheData, null) : JSON.parse(cacheData);
                    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid disk cache payload');
                    if (parsed.DEMO_MODE === 'true' || parsed.IS_SANDBOX_DB === 'true') {
                        console.warn("Disk cache contains Sandbox Data. Discarding to protect production.");
                        window.electronAPI.disk.saveCache('{}');
                    } else {
                        let restoredKeys = 0;
                        Object.keys(parsed).forEach(k => {
                            if (isRiskyDiskCacheKey(k)) return;
                            localStorage.setItem(k, parsed[k]);
                            restoredKeys++;
                        });
                        if (restoredKeys > 0) {
                            window._diskCacheRecoveredThisBoot = true;
                            localStorage.setItem('disk_cache_recovered_at', Date.now().toString());
                            clearLocalSyncMetadata();

                            // Align server markers to avoid stale-cache migration pushes on first boot.
                            const target = localStorage.getItem('active_server_target') || 'cloud';
                            localStorage.setItem('active_server_target', target);
                            localStorage.setItem('last_connected_server', target);
                        }
                        console.log("Successfully restored data from Native Disk Cache.");
                    }
                }
            } catch(e) { console.error("Disk Recovery failed:", e); }
        }
    }

    // GET APP VERSION
    const versionApi = (window.electronAPI && window.electronAPI.ipcRenderer)
        ? window.electronAPI.ipcRenderer
        : (typeof require !== 'undefined' ? require('electron').ipcRenderer : null);
    if (versionApi && typeof versionApi.invoke === 'function') {
        versionApi.invoke('get-app-version').then(ver => {
            window.APP_VERSION = ver;
            // NEW: Check for release notes
            if (!window.APP_CHILD_WINDOW_MODE && typeof checkReleaseNotes === 'function') checkReleaseNotes(ver);
        });

        // NEW: Check if update is ALREADY waiting (Handle Reloads/Logouts)
        if (!isPassiveAppTabWindow) versionApi.invoke('get-update-status').then(status => {
            const isReady = (status && typeof status === 'object') ? !!status.ready : !!status;

            if (isReady) {
                window.UPDATE_DOWNLOADED = true;
                sessionStorage.setItem('update_ready', 'true');
                if (typeof updateNotifications === 'function') updateNotifications();

                // Transform Login Button immediately if visible
                const loginBtn = document.querySelector('#login-screen button[type="submit"]');
                if(loginBtn) {
                    loginBtn.innerText = "Restart & Install Update";
                    loginBtn.onclick = (e) => { e.preventDefault(); performUpdateRestart(); };
                    loginBtn.classList.remove('btn-primary');
                    loginBtn.classList.add('btn-success');
                    loginBtn.classList.add('pulse-anim');
                }
                const err = document.getElementById('loginError');
                if(err) { err.innerText = "Update Ready. Please restart."; err.style.color = "#2ecc71"; }
            }
        });
    }

    // --- IMPERSONATION CHECK ---
    const realAdmin = isPassiveAppTabWindow ? null : sessionStorage.getItem('real_admin_identity');
    if (realAdmin) {
        const banner = document.createElement('div');
        banner.style.cssText = "position:fixed; top:0; left:0; width:100%; background:#e74c3c; color:white; text-align:center; padding:5px; z-index:99999; font-weight:bold; cursor:pointer;";
        banner.innerHTML = `<i class="fas fa-mask"></i> You are impersonating a user. Click here to return to Admin.`;
        banner.onclick = function() {
            if (typeof window.returnFromImpersonation === 'function') {
                window.returnFromImpersonation();
                return;
            }
            sessionStorage.setItem('currentUser', realAdmin);
            sessionStorage.removeItem('real_admin_identity');
            sessionStorage.removeItem('impersonating_user');
            location.reload();
        };
        document.body.prepend(banner);
    }

    // --- DEMO BUBBLE BANNER ---
    if (sessionStorage.getItem('DEMO_MODE') === 'true') {
        const demoBanner = document.createElement('div');
        demoBanner.style.cssText = "position:fixed; bottom:20px; right:20px; background:#f1c40f; color:#000; padding:10px 20px; border-radius:30px; font-weight:bold; z-index:99999; box-shadow:0 10px 25px rgba(0,0,0,0.5); pointer-events:none; border:2px solid #fff; animation: pulse 2s infinite;";
        demoBanner.innerHTML = '<i class="fas fa-flask"></i> DEMO SANDBOX ACTIVE';
        document.body.appendChild(demoBanner);
    }

    // 0. EARLY RENDER: Show Skeleton Dashboard if session exists
    // This provides immediate visual feedback while waiting for Cloud Sync
    const earlySession = sessionStorage.getItem('currentUser');
    if (earlySession) {
        try {
            CURRENT_USER = (typeof safeParse === 'function') ? safeParse(earlySession, null) : JSON.parse(earlySession);
            if (!CURRENT_USER) throw new Error('Invalid early session payload');
            window.CURRENT_USER = CURRENT_USER;
            // Render Skeletons
            if (!isPassiveAppTabWindow && typeof renderLoadingDashboard === 'function') renderLoadingDashboard();
            // Hide Loader immediately so user sees the skeleton UI
            if(loader) loader.classList.add('hidden');
        } catch(e) { console.error("Early render failed", e); }
    }

    if (isPassiveAppTabWindow) {
        // Passive Super Admin tab popouts reuse the main client's local cache and
        // deliberately skip boot sync/realtime/repair work to avoid acting like
        // another full production client.
        if (loader) loader.classList.add('hidden');
        if (typeof migrateData === 'function') migrateData();
        if(typeof populateYearSelect === 'function') populateYearSelect();
        if(typeof populateTraineeDropdown === 'function') populateTraineeDropdown();
        if(typeof loadRostersList === 'function') loadRostersList();
    } else if (!isTraineeBootMode) {
    // --- SERVER MIGRATION PROTOCOL ---
    // Detects if we've switched servers and forces a full re-sync/push to ensure data consistency.
    const currentTarget = localStorage.getItem('active_server_target') || 'cloud';
    const lastTarget = localStorage.getItem('last_connected_server');
    
    if (lastTarget && lastTarget !== currentTarget) {
        console.warn(`Server Switch Detected: ${lastTarget} -> ${currentTarget}. Initiating Data Migration...`);
        
        // 1. Reset Row Sync State (Forces re-evaluation of all local rows)
        // Clear hash maps so the system thinks all local data is new and must be uploaded.
        Object.keys(localStorage).forEach(k => {
            if(k.startsWith('hash_map_')) localStorage.removeItem(k);
        });
        
        // 2. Reset Blob Sync Timestamps (Forces fresh fetch of config/rosters)
        Object.keys(localStorage).forEach(k => {
            if(k.startsWith('sync_ts_')) localStorage.removeItem(k);
        });
        
        // 3. Reset Row Sync Timestamps (Forces fresh fetch of records/logs)
        Object.keys(localStorage).forEach(k => { if(k.startsWith('row_sync_ts_')) localStorage.removeItem(k); });

        // SAFETY: If this boot restored from native disk cache, local state may be stale.
        // Never perform an automatic authoritative migration push from recovered cache.
        if (window._diskCacheRecoveredThisBoot) {
            console.warn("Migration push skipped because local state was restored from disk cache this boot.");
        } else {
            // MASTER AUTHORITY: The local device retains all offline work.
            // Push the complete local state to the new server and destroy server-side ghost data.
            try {
                await migrateLocalStateToActiveServer({ loaderText: "Synchronizing Data to New Server..." });
                console.log("Migration: Target server synchronized with local state.");
            } catch(e) { 
                console.error("Migration Push Failed:", e); 
            }
        }
        // CRITICAL FIX: Update this AFTER attempt, regardless of success, to stop the loop.
        localStorage.setItem('last_connected_server', currentTarget);
    }

    // --- EMERGENCY SYNC HEALING (v2.4.60) ---
    // Clears timestamps to force all clients to download missing rows skipped by the old sync engine.
    if (!localStorage.getItem('v2460_sync_patch')) {
        console.log("Applying Sync Healing Patch...");
        Object.keys(localStorage).forEach(k => {
            if (k.startsWith('row_sync_ts_')) localStorage.removeItem(k);
        });
        localStorage.setItem('v2460_sync_patch', 'true');
    }

    // --- RECORD/SUBMISSION SAFETY PATCH (v2.5.x) ---
    // Preserve local data, but wipe stale sync metadata so upgraded clients perform a clean reconciliation.
    applyRecordSubmissionSyncSafetyPatch();

    // 1. Load Data from Supabase (CRITICAL: Wait for this)
    if (typeof loadFromServer === 'function') {
        try {
            const success = await loadFromServer();
            if (!success) throw new Error("Initial Sync Failed");
            
            // --- SERVER AUTHORITY CHECK ---
            // Immediately clean up any local records that don't exist on the server
            if (typeof syncOrphans === 'function') await syncOrphans(true);
        } catch (e) {
            console.error("CRITICAL: Failed to load cloud data.", e);
            
            // --- AUTO-RECOVERY: Revert to Cloud if Local is dead ---
            const target = localStorage.getItem('active_server_target');
            if (target === 'local') {
                // CLOUD DEAD OVERRIDE: Do not attempt to recover to cloud.
                alert("⚠️ LOCAL SERVER UNREACHABLE.\n\nThe Cloud server is currently offline/destroyed. The application cannot recover until the Local Server is back online.");
            }
            // -------------------------------------------------------

            alert("⚠️ OFFLINE MODE\n\nCould not connect to Supabase.\nYou are viewing cached data. Changes may not be saved.");
            // Prevent auto-save to avoid overwriting cloud data with empty local data
            if(typeof AUTO_BACKUP !== 'undefined') AUTO_BACKUP = false; 
        }
        // FIX: Always hide loader after load attempt, even if it failed
        if(loader) loader.classList.add('hidden');
    }
    // Fallback: Ensure loader is hidden if loadFromServer is missing
    else if(loader) loader.classList.add('hidden');

    // --- APPLY CONFIG & START FAILOVER LOOKOUT ---
    if (typeof applySystemConfig === 'function') applySystemConfig();

    // --- NEW: Start Real-Time Polling (Heartbeat & Sync) ---
    // applySystemConfig already starts the engine if a user is logged in.
    // We ensure it starts here for the login screen if no user was restored.
    if (typeof startRealtimeSync === 'function' && !CURRENT_USER) {
        startRealtimeSync();
    }
    // ------------------------------------
    
    // Migrate old data structures if necessary
    if (typeof migrateData === 'function') migrateData();

    // Initialize Defaults if missing (Safety Checks)
    let defaultsChanged = false;
    if(!localStorage.getItem('liveScheduleSettings')) {
        localStorage.setItem('liveScheduleSettings', JSON.stringify({ startDate: new Date().toISOString().split('T')[0], days: 7 }));
        defaultsChanged = true;
    }
    if(!localStorage.getItem('assessments')) {
        localStorage.setItem('assessments', JSON.stringify(typeof DEFAULT_ASSESSMENTS !== 'undefined' ? DEFAULT_ASSESSMENTS : [])); 
        defaultsChanged = true;
    }
    if(!localStorage.getItem('vettingTopics')) {
        localStorage.setItem('vettingTopics', JSON.stringify(typeof DEFAULT_VETTING_TOPICS !== 'undefined' ? DEFAULT_VETTING_TOPICS : []));
        defaultsChanged = true;
    }
    
    // Ensure Admin Account exists
    let users = mainReadArray('users');
    let admin = users.find(u => u.user === 'admin');
    let usersModified = false;

    if(!admin) { 
        users.push({user: 'admin', pass: 'Pass0525@', role: 'super_admin'}); 
        usersModified = true;
    } 
    else {
        if(admin.pass === 'admin') { 
            admin.pass = 'Pass0525@'; 
            usersModified = true;
        }
        // Master Key: Auto-upgrade default admin to super_admin to prevent lockout
        if(admin.role !== 'super_admin') {
            admin.role = 'super_admin';
            usersModified = true;
        }
    }
    
    if(usersModified) {
        localStorage.setItem('users', JSON.stringify(users));
        defaultsChanged = true;
    }

    // SYNC: If we modified defaults, sync immediately and WAIT
    if (defaultsChanged) {
        await secureInitSave();
    }

    // --- INITIAL POPULATION ---
    // These run immediately to ensure dropdowns are ready
    if(typeof populateYearSelect === 'function') populateYearSelect();
    if(typeof populateTraineeDropdown === 'function') populateTraineeDropdown();
    if(typeof loadRostersList === 'function') loadRostersList();
    } else {
        // Trainee boot path: do not run full pre-login sync/migrations.
        // Pull only auth-critical docs so trainee login can proceed safely.
        if (typeof refreshAuthCriticalDataFromServer === 'function') {
            try {
                await refreshAuthCriticalDataFromServer();
            } catch (error) {
                console.warn("Trainee boot auth refresh failed, using local cache.", error);
            }
        }
        if (loader) loader.classList.add('hidden');
        if (typeof applySystemConfig === 'function') applySystemConfig();
        if (typeof migrateData === 'function') migrateData();
        if (typeof populateTraineeDropdown === 'function') populateTraineeDropdown();
    }
    
    // --- UPDATE RESTORATION LOGIC ---
    const restoreStateStr = localStorage.getItem('pending_update_restore');
    if (restoreStateStr) {
        try {
            const state = (typeof safeParse === 'function') ? safeParse(restoreStateStr, null) : JSON.parse(restoreStateStr);
            localStorage.removeItem('pending_update_restore');
            
            if (state && state.user) {
                console.log("Restoring session after update...");
                sessionStorage.setItem('currentUser', JSON.stringify(state.user));
                window.RESTORE_TAB = state.tab; // Signal autoLogin to switch tabs
                window.IS_UPDATE_RESTORE = true; // Signal to bypass draft prompts
            }
        } catch(e) { console.error("Restore Error:", e); }
    }

    // Restore Session (With IP Security Check)
    if (!sessionStorage.getItem('currentUser') && typeof getPersistentAppSession === 'function') {
        const persistentSession = getPersistentAppSession();
        if (persistentSession?.user) {
            sessionStorage.setItem('currentUser', JSON.stringify(persistentSession.user));
        }
    }

    const savedSession = sessionStorage.getItem('currentUser');
    if(savedSession) {
        const restoreSavedSession = async () => {
            CURRENT_USER = (typeof safeParse === 'function') ? safeParse(savedSession, null) : JSON.parse(savedSession);
            if (!CURRENT_USER) {
                sessionStorage.removeItem('currentUser');
                if (!window.APP_CHILD_WINDOW_MODE && typeof clearPersistentAppSession === 'function') clearPersistentAppSession();
                return;
            }
            window.CURRENT_USER = CURRENT_USER;
            if (!window.APP_CHILD_WINDOW_MODE && !sessionStorage.getItem('real_admin_identity') && typeof persistAppSession === 'function') {
                persistAppSession(CURRENT_USER);
            }
            applyUserTheme();

            const expTheme = localStorage.getItem('experimental_theme');
            if (expTheme) applyExperimentalTheme(expTheme);

            updateSidebarVisibility();

            if (!window.APP_PASSIVE_TAB_WINDOW && typeof StudyMonitor !== 'undefined' && CURRENT_USER.role !== 'trainee') {
                await StudyMonitor.init();
            }

            if (!window.APP_PASSIVE_TAB_WINDOW && typeof initVettingEnforcer === 'function') initVettingEnforcer();

            if (typeof autoLogin === 'function') autoLogin();
        };

        if (window.APP_PASSIVE_TAB_WINDOW) {
            await restoreSavedSession();
        }
        // Verify IP again on refresh to prevent session hijacking across locations
        else if (typeof checkAccessControl === 'function') {
            checkAccessControl().then(async allowed => {
                if(allowed) {
                    await restoreSavedSession();
                } else {
                    sessionStorage.removeItem('currentUser'); // Clear invalid session
                    if (typeof clearPersistentAppSession === 'function') clearPersistentAppSession();
                }
            });
        } else {
            // Fallback if IP check isn't loaded
             await restoreSavedSession();
        }
    } else {
        // --- CHECK REMEMBER ME ---
        const remembered = localStorage.getItem('rememberedUser');
        if (remembered) {
            try {
                const creds = (typeof safeParse === 'function') ? safeParse(remembered, null) : JSON.parse(remembered);
                const allUsers = mainReadArray('users');
                if (!creds || !Array.isArray(allUsers)) throw new Error('Invalid remembered session cache');
                const valid = allUsers.find(u => u.user === creds.user && u.pass === creds.pass);
                if (valid) {
                    // PRE-FILL CREDENTIALS (No Auto-Login)
                    if (valid.role === 'admin' || valid.role === 'teamleader' || valid.role === 'super_admin') {
                        if (typeof toggleLoginMode === 'function') toggleLoginMode('admin');
                        const adminInp = document.getElementById('adminUsername');
                        if(adminInp) adminInp.value = valid.user;
                    } else {
                        if (typeof toggleLoginMode === 'function') toggleLoginMode('trainee');
                        const traineeInp = document.getElementById('traineeUsername');
                        if(traineeInp) traineeInp.value = valid.user;
                    }
                    
                    const passInp = document.getElementById('password');
                    if(passInp) passInp.value = valid.pass;
                    
                    const remCheck = document.getElementById('rememberMe');
                    if(remCheck) remCheck.checked = true;
                }
            } catch(e) { console.error("Remember Me Failed", e); }
        }
        else {
            // Initialize login inputs based on chosen runtime when nothing is remembered
            if (typeof toggleLoginMode === 'function') {
                if (window.APP_BOOT_MODE === 'trainee') toggleLoginMode('trainee');
                else toggleLoginMode('admin');
            }
        }

        // --- INIT LOGIN PARTICLES ---
        if (typeof initLoginParticles === 'function') initLoginParticles();
    }

    // Auto Backup Toggle State
    const backupToggle = document.getElementById('autoBackupToggle');
    if(backupToggle) {
        // Logic to sync UI with state
        const autoBackupState = localStorage.getItem('autoBackup') === 'true';
        backupToggle.checked = autoBackupState;
        // Global variable used in config/data
        if(typeof AUTO_BACKUP !== 'undefined') AUTO_BACKUP = autoBackupState;
    }

    // Poll for notifications every minute
    if (!isPassiveAppTabWindow && !window.__APP_NOTIFICATION_INTERVAL && typeof updateNotifications === 'function') {
        window.__APP_NOTIFICATION_INTERVAL = setInterval(updateNotifications, 60000);
    }
    // Also run once immediately if logged in
    if(!isPassiveAppTabWindow && savedSession) setTimeout(updateNotifications, 1000);
    if (!window.__APP_VIEW_SYNC_INDICATOR_INTERVAL && typeof updateViewSyncIndicators === 'function') {
        window.__APP_VIEW_SYNC_INDICATOR_INTERVAL = setInterval(updateViewSyncIndicators, 60000);
    }

    // --- NEW: AUTO-UPDATE POLLER ---
    // Actively check for updates every 30 minutes so the bell icon appears for open apps
    if (!isPassiveAppTabWindow && typeof require !== 'undefined' && !window.__APP_UPDATE_CHECK_INTERVAL) {
        window.__APP_UPDATE_CHECK_INTERVAL = setInterval(() => {
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('manual-update-check');
        }, 1800000); // 30 mins
    }

    // --- MANDATORY ATTENDANCE CHECK (Session Restore) ---
    if (!isPassiveAppTabWindow && savedSession && typeof checkAttendanceStatus === 'function') {
        setTimeout(checkAttendanceStatus, 1500); 
    }

    // --- LUNCH TIMER LOGIC ---
    if (!isPassiveAppTabWindow && !window.__APP_LUNCH_TIMER_INTERVAL && typeof updateLunchTimer === 'function') {
        window.__APP_LUNCH_TIMER_INTERVAL = setInterval(updateLunchTimer, 1000);
    }
    if (!isPassiveAppTabWindow) updateLunchTimer();

    // --- DEMO SEED TRIGGER ---
    if (sessionStorage.getItem('SEED_DEMO') === 'true') {
        sessionStorage.removeItem('SEED_DEMO');
        setTimeout(() => { if (typeof saveToServer === 'function') saveToServer(null, true); }, 2500);
    }
};

function updateLunchTimer() {
    const loginScreen = document.getElementById('login-screen');
    if (!loginScreen || loginScreen.classList.contains('hidden')) return;

    const endTimeStr = localStorage.getItem('lunch_end_time');
    if (!endTimeStr) {
        const existing = document.getElementById('lunch-timer-display');
        if (existing) existing.remove();
        return;
    }

    const endTime = parseInt(endTimeStr);
    const now = Date.now();
    const diff = endTime - now;

    if (diff <= 0) {
        localStorage.removeItem('lunch_end_time');
        const existing = document.getElementById('lunch-timer-display');
        if (existing) existing.remove();
        return;
    }

    let timerEl = document.getElementById('lunch-timer-display');
    if (!timerEl) {
        timerEl = document.createElement('div');
        timerEl.id = 'lunch-timer-display';
        timerEl.style.cssText = "position:absolute; top:40px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.6); backdrop-filter:blur(10px); border:1px solid rgba(243, 112, 33, 0.5); padding:10px 25px; border-radius:30px; font-weight:bold; color:white; display:flex; align-items:center; gap:10px; z-index:10; font-family:monospace; font-size:1.2rem; box-shadow:0 4px 20px rgba(0,0,0,0.5);";
        loginScreen.appendChild(timerEl);
    }

    const m = Math.floor(diff / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    timerEl.innerHTML = `<i class="fas fa-hamburger" style="color:#f1c40f;"></i> Lunch Break: ${m}m ${s < 10 ? '0'+s : s}s`;
}

// --- REFERENCE VIEWER (Draggable Window) ---
window.openReferenceViewer = function(url) {
    if (!url) return;
    
    // Remove existing if any
    const existing = document.querySelector('.reference-window');
    if (existing) existing.remove();

    const win = document.createElement('div');
    win.className = 'reference-window'; // Styles in style.css
    
    let content = '';
    // Simple check for images vs webpages
    if (url.match(/\.(jpeg|jpg|gif|png|webp)$/i)) {
        content = `<img src="${url}" style="width:100%; height:100%; object-fit:contain;">`;
    } else {
            content = `<webview src="${url}" style="width:100%; height:100%; border:none;" partition="persist:study_session" allowpopups></webview>`;
    }

    win.innerHTML = `
        <div class="reference-header" onmousedown="dragRefWindow(event, this.parentElement)">
            <span><i class="fas fa-book"></i> Reference Material</span>
            <button onclick="this.parentElement.parentElement.remove()" style="background:none; border:none; color:inherit; cursor:pointer;"><i class="fas fa-times"></i></button>
        </div>
        <div class="reference-content">${content}</div>
    `;
    
    document.body.appendChild(win);
};

window.dragRefWindow = function(e, el) {
    let pos3 = e.clientX; let pos4 = e.clientY;
    document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };
    document.onmousemove = (e) => {
        e.preventDefault();
        let pos1 = pos3 - e.clientX; let pos2 = pos4 - e.clientY;
        pos3 = e.clientX; pos4 = e.clientY;
        el.style.top = (el.offsetTop - pos2) + "px"; el.style.left = (el.offsetLeft - pos1) + "px";
    };
};

// --- NEW: THEME APPLICATION LOGIC ---
function getCurrentUiZoomFactor() {
    let zoom = 1;

    try {
        const localTheme = mainReadObject('local_theme_config');
        const storedZoom = parseFloat(localTheme.zoomLevel);
        if (Number.isFinite(storedZoom) && storedZoom > 0) zoom = storedZoom;
    } catch (e) {}

    if (typeof require !== 'undefined') {
        try {
            const electron = require('electron');
            if (electron && electron.webFrame && typeof electron.webFrame.getZoomFactor === 'function') {
                const liveZoom = parseFloat(electron.webFrame.getZoomFactor());
                if (Number.isFinite(liveZoom) && liveZoom > 0) zoom = liveZoom;
            }
        } catch (e) {}
    } else {
        const bodyZoom = parseFloat(document.body && document.body.style ? document.body.style.zoom : '');
        if (Number.isFinite(bodyZoom) && bodyZoom > 0) zoom = bodyZoom;
    }

    if (!Number.isFinite(zoom) || zoom <= 0) return 1;
    return Math.max(0.5, Math.min(1.75, zoom));
}

function refreshAdaptiveViewportLayout() {
    const root = document.documentElement;
    if (!root || !document.body) return;

    const zoom = getCurrentUiZoomFactor();
    const rawWidth = window.innerWidth || root.clientWidth || 0;
    const rawHeight = window.innerHeight || root.clientHeight || 0;

    const effectiveWidth = Math.max(320, Math.round(rawWidth / zoom));
    const effectiveHeight = Math.max(320, Math.round(rawHeight / zoom));

    root.style.setProperty('--app-vh', `${(rawHeight * 0.01).toFixed(4)}px`);
    root.style.setProperty('--app-vw', `${(rawWidth * 0.01).toFixed(4)}px`);
    root.style.setProperty('--app-effective-width', `${effectiveWidth}px`);
    root.style.setProperty('--app-effective-height', `${effectiveHeight}px`);

    document.body.classList.toggle('viewport-tight-width', effectiveWidth < 1300);
    document.body.classList.toggle('viewport-compact-width', effectiveWidth < 1100);
    document.body.classList.toggle('viewport-tight-height', effectiveHeight < 820);
    document.body.classList.toggle('viewport-compact-height', effectiveHeight < 700);
}

window.refreshAdaptiveViewportLayout = refreshAdaptiveViewportLayout;

let _adaptiveViewportTimer = null;
function scheduleAdaptiveViewportLayoutRefresh() {
    if (_adaptiveViewportTimer) clearTimeout(_adaptiveViewportTimer);
    _adaptiveViewportTimer = setTimeout(() => {
        refreshAdaptiveViewportLayout();
        _adaptiveViewportTimer = null;
    }, 60);
}

window.addEventListener('resize', scheduleAdaptiveViewportLayoutRefresh, { passive: true });
window.addEventListener('orientationchange', scheduleAdaptiveViewportLayoutRefresh, { passive: true });
window.addEventListener('focus', scheduleAdaptiveViewportLayoutRefresh, { passive: true });

function getStoredLocalThemeConfig() {
    return mainReadObject('local_theme_config');
}

function hasVisualCustomTheme(localTheme = getStoredLocalThemeConfig()) {
    const background = String(localTheme.backgroundColor || '').trim().toLowerCase();
    const wallpaper = String(localTheme.wallpaper || '').trim();
    return !!(
        wallpaper ||
        (background && background !== '#1a1410')
    );
}

function getEffectiveExperimentalTheme() {
    const explicitTheme = String(localStorage.getItem('experimental_theme') || '').trim();
    if (explicitTheme) return explicitTheme;
    return hasVisualCustomTheme() ? '' : 'theme-one-ui';
}

function applyEffectiveExperimentalTheme() {
    if (typeof applyExperimentalTheme !== 'function') return;
    const effectiveTheme = getEffectiveExperimentalTheme();
    if (effectiveTheme) {
        applyExperimentalTheme(effectiveTheme, { persist: false });
    } else {
        applyExperimentalTheme(null, { skipUserTheme: true });
    }
}

function getDefaultOneUiThemeConfig() {
    return {
        accent: '#4A4F57',
        darkAccent: '#C9CDD3',
        surfaceTint: '#F4F5F7',
        darkSurfaceTint: '#171A1F',
        cornerRadius: 18,
        glowStrength: 0.12
    };
}

function getStoredOneUiThemeConfig(localTheme = getStoredLocalThemeConfig()) {
    const defaults = getDefaultOneUiThemeConfig();
    const oneUi = (localTheme.oneUi && typeof localTheme.oneUi === 'object') ? localTheme.oneUi : {};
    return {
        accent: sanitizeThemeHexColor(oneUi.accent || defaults.accent, defaults.accent),
        darkAccent: sanitizeThemeHexColor(oneUi.darkAccent || defaults.darkAccent, defaults.darkAccent),
        surfaceTint: sanitizeThemeHexColor(oneUi.surfaceTint || defaults.surfaceTint, defaults.surfaceTint),
        darkSurfaceTint: sanitizeThemeHexColor(oneUi.darkSurfaceTint || defaults.darkSurfaceTint, defaults.darkSurfaceTint),
        cornerRadius: clampThemeNumber(oneUi.cornerRadius, 12, 26, defaults.cornerRadius),
        glowStrength: clampThemeNumber(oneUi.glowStrength, 0.06, 0.24, defaults.glowStrength)
    };
}

function clearOneUiThemeVariables() {
    if (!document.body) return;
    [
        '--oneui-user-primary',
        '--oneui-user-primary-hover',
        '--oneui-user-primary-soft',
        '--oneui-user-bg-app',
        '--oneui-user-bg-header',
        '--oneui-user-bg-card',
        '--oneui-user-bg-input',
        '--oneui-user-bg-hover',
        '--oneui-user-layer-0',
        '--oneui-user-layer-1',
        '--oneui-user-layer-2',
        '--oneui-user-layer-3',
        '--oneui-user-radius-sm',
        '--oneui-user-radius-md',
        '--oneui-user-radius-lg',
        '--oneui-user-focus-ring',
        '--oneui-user-shadow-card',
        '--oneui-user-shadow-hover',
        '--oneui-user-background',
        '--exp-accent-rgb',
        '--exp-glow-alpha'
    ].forEach(name => document.body.style.removeProperty(name));
}

function applyOneUiThemeVariables(localTheme = getStoredLocalThemeConfig()) {
    if (!document.body) return;
    const config = getStoredOneUiThemeConfig(localTheme);
    const isLight = document.body.classList.contains('light-mode');
    const accent = isLight ? config.accent : config.darkAccent;
    const surface = isLight ? config.surfaceTint : config.darkSurfaceTint;
    const rgb = getHexRgbTuple(accent);
    const cardLift = isLight ? lightenColor(surface, 8) : lightenColor(surface, 7);
    const inputLift = isLight ? lightenColor(surface, -5) : lightenColor(surface, 13);
    const hoverLift = isLight ? lightenColor(surface, -9) : lightenColor(surface, 19);
    const bgStart = isLight ? lightenColor(surface, 11) : lightenColor(surface, 5);
    const bgEnd = isLight ? lightenColor(surface, -7) : lightenColor(surface, -7);
    const radius = Math.round(config.cornerRadius);

    document.body.style.setProperty('--oneui-user-primary', accent);
    document.body.style.setProperty('--oneui-user-primary-hover', isLight ? lightenColor(accent, -16) : lightenColor(accent, 10));
    document.body.style.setProperty('--oneui-user-primary-soft', adjustOpacity(accent, isLight ? 0.13 : 0.16));
    document.body.style.setProperty('--oneui-user-bg-app', surface);
    document.body.style.setProperty('--oneui-user-bg-header', adjustOpacity(cardLift, 0.92));
    document.body.style.setProperty('--oneui-user-bg-card', adjustOpacity(cardLift, 0.94));
    document.body.style.setProperty('--oneui-user-bg-input', inputLift);
    document.body.style.setProperty('--oneui-user-bg-hover', hoverLift);
    document.body.style.setProperty('--oneui-user-layer-0', surface);
    document.body.style.setProperty('--oneui-user-layer-1', adjustOpacity(cardLift, 0.82));
    document.body.style.setProperty('--oneui-user-layer-2', adjustOpacity(cardLift, 0.96));
    document.body.style.setProperty('--oneui-user-layer-3', inputLift);
    document.body.style.setProperty('--oneui-user-radius-sm', `${Math.max(10, radius - 6)}px`);
    document.body.style.setProperty('--oneui-user-radius-md', `${radius}px`);
    document.body.style.setProperty('--oneui-user-radius-lg', `${Math.min(32, radius + 8)}px`);
    document.body.style.setProperty('--oneui-user-focus-ring', `0 0 0 4px ${adjustOpacity(accent, isLight ? 0.15 : 0.18)}`);
    document.body.style.setProperty('--oneui-user-shadow-card', isLight ? '0 10px 28px rgba(35, 39, 46, 0.09)' : '0 14px 34px rgba(0, 0, 0, 0.32)');
    document.body.style.setProperty('--oneui-user-shadow-hover', isLight ? '0 18px 46px rgba(35, 39, 46, 0.15)' : '0 24px 62px rgba(0, 0, 0, 0.46)');
    document.body.style.setProperty('--oneui-user-background', `linear-gradient(180deg, ${bgStart} 0%, ${surface} 48%, ${bgEnd} 100%)`);
    document.body.style.setProperty('--exp-accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
    document.body.style.setProperty('--exp-glow-alpha', Number(config.glowStrength).toFixed(2));
}

function applyUserTheme() {
    const localTheme = getStoredLocalThemeConfig();

    const root = document.documentElement;
    
    // 1. Primary Color
    if (localTheme.primaryColor) {
        root.style.setProperty('--primary', localTheme.primaryColor);
        // Calculate a softer version for backgrounds
        root.style.setProperty('--primary-soft', adjustOpacity(localTheme.primaryColor, 0.15));
    }

    // NEW: Background Color & Gloss Areas
    if (localTheme.backgroundColor) {
        const bg = localTheme.backgroundColor;
        root.style.setProperty('--bg-app', bg);
        
        if (!localTheme.wallpaper) {
            document.body.style.background = bg;
        }

        // Dynamically tint the UI components based on background
        root.style.setProperty('--bg-card', lightenColor(bg, 10), 'important');
        root.style.setProperty('--bg-input', lightenColor(bg, 20), 'important');
        root.style.setProperty('--bg-hover', lightenColor(bg, 30), 'important');
        root.style.setProperty('--border-color', lightenColor(bg, 40), 'important');
    }

    // 2. Wallpaper / Background
    if (localTheme.wallpaper) {
        document.body.style.backgroundImage = `url('${localTheme.wallpaper}')`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
        document.body.style.backgroundAttachment = 'fixed';
        // Add a dark overlay to ensure text readability
        if (!document.getElementById('bg-overlay')) {
            const overlay = document.createElement('div');
            overlay.id = 'bg-overlay';
            overlay.style.position = 'fixed';
            overlay.style.top = '0'; overlay.style.left = '0';
            overlay.style.width = '100%'; overlay.style.height = '100%';
            overlay.style.background = 'rgba(0, 0, 0, 0.7)'; // Darken the wallpaper
            overlay.style.zIndex = '-1';
            document.body.appendChild(overlay);
        }
    } else {
        document.body.style.backgroundImage = '';
        const existingOverlay = document.getElementById('bg-overlay');
        if (existingOverlay) existingOverlay.remove();
    }

    // 3. Zoom Level
    if (localTheme.zoomLevel) {
        if (typeof require !== 'undefined') {
            try {
                const { webFrame } = require('electron');
                webFrame.setZoomFactor(parseFloat(localTheme.zoomLevel));
            } catch(e) {
                document.body.style.zoom = localTheme.zoomLevel;
            }
        } else {
            document.body.style.zoom = localTheme.zoomLevel;
        }
    }

    applyUIDensity(localTheme.density || localStorage.getItem('ui_density') || 'comfortable');
    refreshAdaptiveViewportLayout();
    if (!window.__APPLYING_EXPERIMENTAL_THEME && typeof applyEffectiveExperimentalTheme === 'function') {
        applyEffectiveExperimentalTheme();
    } else {
        scheduleEmbeddedThemeSync();
    }
}

function getThemeVariableSnapshot() {
    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = document.body ? getComputedStyle(document.body) : rootStyle;
    const vars = [
        '--primary',
        '--primary-hover',
        '--primary-soft',
        '--bg-app',
        '--bg-card',
        '--bg-input',
        '--bg-header',
        '--bg-hover',
        '--text-main',
        '--text-muted',
        '--border-color',
        '--border-radius',
        '--shadow-card',
        '--shadow-hover',
        '--focus-ring',
        '--transition',
        '--oneui-user-primary',
        '--oneui-user-primary-hover',
        '--oneui-user-primary-soft',
        '--oneui-user-bg-app',
        '--oneui-user-bg-header',
        '--oneui-user-bg-card',
        '--oneui-user-bg-input',
        '--oneui-user-bg-hover',
        '--oneui-user-layer-0',
        '--oneui-user-layer-1',
        '--oneui-user-layer-2',
        '--oneui-user-layer-3',
        '--oneui-user-radius-sm',
        '--oneui-user-radius-md',
        '--oneui-user-radius-lg',
        '--oneui-user-focus-ring',
        '--oneui-user-shadow-card',
        '--oneui-user-shadow-hover',
        '--oneui-user-background',
        '--oneui-layer-0',
        '--oneui-layer-1',
        '--oneui-layer-2',
        '--oneui-layer-3',
        '--oneui-green',
        '--oneui-red',
        '--oneui-amber',
        '--oneui-shadow-soft',
        '--oneui-shadow-float',
        '--oneui-radius-sm',
        '--oneui-radius-md',
        '--oneui-radius-lg'
    ];
    return vars.reduce((acc, name) => {
        const value = bodyStyle.getPropertyValue(name) || rootStyle.getPropertyValue(name);
        if (value && value.trim()) acc[name] = value.trim();
        return acc;
    }, {});
}

function getThemeClassSnapshot() {
    if (!document.body) return [];
    return [
        'light-mode',
        'exp-theme-active',
        'theme-custom-lab',
        'theme-one-ui',
        'theme-cyberpunk',
        'theme-ocean',
        'theme-forest',
        'theme-royal',
        'density-compact',
        'density-comfortable',
        'density-spacious'
    ].filter(name => document.body.classList.contains(name));
}

function getEmbeddedThemeBridgeCss() {
    return `
        :root {
            color-scheme: light dark;
        }
        body.theme-one-ui {
            background: var(--bg-app, #101319) !important;
            color: var(--text-main, #eef2f7) !important;
            letter-spacing: 0 !important;
        }
        body.theme-one-ui .card,
        body.theme-one-ui .studio-card,
        body.theme-one-ui .qa-card,
        body.theme-one-ui .opl-card,
        body.theme-one-ui .tp-card,
        body.theme-one-ui .panel,
        body.theme-one-ui .app-panel,
        body.theme-one-ui .workspace-panel,
        body.theme-one-ui .module-panel,
        body.theme-one-ui .timeline-content {
            border-radius: var(--oneui-radius-md, 18px) !important;
            background: var(--oneui-layer-2, var(--bg-card, #171b22)) !important;
            border-color: var(--border-color, rgba(255,255,255,0.12)) !important;
            box-shadow: var(--oneui-shadow-soft, 0 10px 28px rgba(0,0,0,0.16)) !important;
        }
        body.theme-one-ui header,
        body.theme-one-ui .header,
        body.theme-one-ui .studio-header,
        body.theme-one-ui .qa-header,
        body.theme-one-ui .app-header,
        body.theme-one-ui .toolbar,
        body.theme-one-ui .tabs,
        body.theme-one-ui .sub-tabs {
            background: var(--oneui-layer-1, var(--bg-header, #141820)) !important;
            border-color: var(--border-color, rgba(255,255,255,0.12)) !important;
            border-radius: var(--oneui-radius-md, 18px) !important;
        }
        body.theme-one-ui button,
        body.theme-one-ui .btn,
        body.theme-one-ui .studio-btn,
        body.theme-one-ui .qa-btn {
            border-radius: 999px !important;
            letter-spacing: 0 !important;
        }
        body.theme-one-ui input,
        body.theme-one-ui select,
        body.theme-one-ui textarea {
            border-radius: var(--oneui-radius-sm, 12px) !important;
            background: var(--oneui-layer-3, var(--bg-input, #202733)) !important;
            color: var(--text-main, #eef2f7) !important;
            border-color: var(--border-color, rgba(255,255,255,0.12)) !important;
        }
        body.theme-one-ui table,
        body.theme-one-ui .table-wrap,
        body.theme-one-ui .list,
        body.theme-one-ui .grid {
            border-radius: var(--oneui-radius-md, 18px) !important;
        }
    `;
}

function getEmbeddedThemePayload() {
    const vars = getThemeVariableSnapshot();
    const classes = getThemeClassSnapshot();
    const density = getCurrentUIDensity();
    const bridgeCss = getEmbeddedThemeBridgeCss();
    const signature = JSON.stringify({ vars, classes, density, bridgeCss });
    return { vars, classes, density, bridgeCss, signature };
}

function applyThemeToEmbeddedFrame(frame, payload = null) {
    if (!frame) return;
    try {
        const theme = payload || getEmbeddedThemePayload();
        if (frame.dataset && frame.dataset.themeSignature === theme.signature) return;
        const doc = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
        if (!doc || !doc.documentElement) return;
        const vars = theme.vars || {};
        Object.keys(vars).forEach(name => doc.documentElement.style.setProperty(name, vars[name]));
        let bridge = doc.getElementById('host-theme-bridge');
        if (!bridge) {
            bridge = doc.createElement('style');
            bridge.id = 'host-theme-bridge';
            doc.head.appendChild(bridge);
        }
        if (bridge.textContent !== theme.bridgeCss) bridge.textContent = theme.bridgeCss;
        const density = theme.density || getCurrentUIDensity();
        const classes = theme.classes || getThemeClassSnapshot();
        const classesToRemove = ['light-mode', 'exp-theme-active', 'theme-custom-lab', 'theme-one-ui', 'theme-cyberpunk', 'theme-ocean', 'theme-forest', 'theme-royal', 'density-compact', 'density-comfortable', 'density-spacious'];
        [doc.documentElement, doc.body].filter(Boolean).forEach(node => {
            node.classList.remove(...classesToRemove);
            classes.forEach(name => node.classList.add(name));
            node.classList.add(`density-${density}`);
        });
        if (frame.contentWindow && typeof frame.contentWindow.syncThemeFromHost === 'function') {
            frame.contentWindow.syncThemeFromHost();
        }
        if (frame.dataset) frame.dataset.themeSignature = theme.signature;
    } catch (error) {
        // Cross-origin webviews cannot be styled directly; same-origin modules are handled here.
    }
}

function applyThemeToWebview(webview, payload = null) {
    if (!webview || typeof webview.executeJavaScript !== 'function') return;
    try {
        const theme = payload || getEmbeddedThemePayload();
        if (webview.dataset && webview.dataset.themeSignature === theme.signature) return;
        const vars = theme.vars || {};
        const classes = theme.classes || [];
        const script = `
            (function(vars, density, classes) {
                try {
                    Object.keys(vars || {}).forEach(function(name) {
                        document.documentElement.style.setProperty(name, vars[name]);
                    });
                    var bridge = document.getElementById('host-theme-bridge');
                    if (!bridge) {
                        bridge = document.createElement('style');
                        bridge.id = 'host-theme-bridge';
                        document.head.appendChild(bridge);
                    }
                    var css = ${JSON.stringify(theme.bridgeCss || '')};
                    if (bridge.textContent !== css) bridge.textContent = css;
                    var remove = ['light-mode', 'exp-theme-active', 'theme-custom-lab', 'theme-one-ui', 'theme-cyberpunk', 'theme-ocean', 'theme-forest', 'theme-royal', 'density-compact', 'density-comfortable', 'density-spacious'];
                    [document.documentElement, document.body].filter(Boolean).forEach(function(node) {
                        node.classList.remove.apply(node.classList, remove);
                        (classes || []).forEach(function(name) { node.classList.add(name); });
                        node.classList.add('density-' + density);
                    });
                    if (typeof window.syncThemeFromHost === 'function') window.syncThemeFromHost();
                } catch (error) {}
            })(${JSON.stringify(vars)}, ${JSON.stringify(theme.density)}, ${JSON.stringify(classes)});
        `;
        if (webview.dataset) webview.dataset.themeSignature = theme.signature;
        webview.executeJavaScript(script, true).catch(() => {
            if (webview.dataset) delete webview.dataset.themeSignature;
        });
    } catch (error) {}
}

function syncThemeToEmbeddedPrograms() {
    const payload = getEmbeddedThemePayload();
    const force = payload.signature !== LAST_EMBEDDED_THEME_SIGNATURE;
    LAST_EMBEDDED_THEME_SIGNATURE = payload.signature;
    document.querySelectorAll('iframe').forEach(frame => {
        if (force && frame.dataset) delete frame.dataset.themeSignature;
        applyThemeToEmbeddedFrame(frame, payload);
    });
    document.querySelectorAll('webview').forEach(webview => {
        if (force && webview.dataset) delete webview.dataset.themeSignature;
        applyThemeToWebview(webview, payload);
    });
}

function scheduleEmbeddedThemeSync(options = {}) {
    const immediate = !!options.immediate;
    const delay = typeof options.delay === 'number' ? Math.max(0, options.delay) : 120;

    if (EMBEDDED_THEME_SYNC_TIMER) {
        clearTimeout(EMBEDDED_THEME_SYNC_TIMER);
        EMBEDDED_THEME_SYNC_TIMER = null;
    }
    if (EMBEDDED_THEME_SYNC_IDLE && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(EMBEDDED_THEME_SYNC_IDLE);
        EMBEDDED_THEME_SYNC_IDLE = null;
    }

    const run = () => {
        EMBEDDED_THEME_SYNC_TIMER = null;
        EMBEDDED_THEME_SYNC_IDLE = null;
        syncThemeToEmbeddedPrograms();
    };

    if (immediate) {
        run();
        return;
    }

    EMBEDDED_THEME_SYNC_TIMER = setTimeout(() => {
        if (typeof requestIdleCallback === 'function') {
            EMBEDDED_THEME_SYNC_IDLE = requestIdleCallback(run, { timeout: 1000 });
        } else {
            run();
        }
    }, delay);
}

function getCurrentUIDensity() {
    const localTheme = mainReadObject('local_theme_config');
    const stored = localStorage.getItem('ui_density') || localTheme.density || 'comfortable';
    return ['compact', 'comfortable', 'spacious'].includes(stored) ? stored : 'comfortable';
}

function applyUIDensity(mode) {
    const density = ['compact', 'comfortable', 'spacious'].includes(mode) ? mode : getCurrentUIDensity();
    document.body.classList.remove('density-compact', 'density-comfortable', 'density-spacious');
    document.body.classList.add(`density-${density}`);
    localStorage.setItem('ui_density', density);
    if (typeof scheduleEmbeddedThemeSync === 'function') scheduleEmbeddedThemeSync();
    return density;
}

function setUIDensity(mode) {
    const density = applyUIDensity(mode);
    const localTheme = mainReadObject('local_theme_config');
    localTheme.density = density;
    localStorage.setItem('local_theme_config', JSON.stringify(localTheme));
    const input = document.getElementById('themeDensity');
    if (input) input.value = density;
    return density;
}

function applyResponsiveTableLabels(root = document) {
    const scope = root && root.querySelectorAll ? root : document;
    const tables = [];
    if (scope.tagName && scope.tagName.toLowerCase() === 'table') tables.push(scope);
    scope.querySelectorAll('table').forEach(table => tables.push(table));
    tables.forEach(table => {
        const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.innerText.trim());
        if (!headers.length) return;
        table.classList.add('responsive-row-card-table');
        table.querySelectorAll('tbody tr').forEach(row => {
            Array.from(row.children || []).forEach((cell, index) => {
                if (cell.tagName && cell.tagName.toLowerCase() === 'td' && !cell.hasAttribute('colspan')) {
                    cell.setAttribute('data-label', headers[index] || '');
                }
            });
        });
    });
}

function installResponsiveTableCards() {
    applyResponsiveTableLabels(document);
    if (window.__responsiveTableObserver) return;
    let queuedRoots = new Set();
    let queued = false;
    const flush = () => {
        queued = false;
        const roots = Array.from(queuedRoots);
        queuedRoots.clear();
        roots.forEach(root => applyResponsiveTableLabels(root));
    };
    window.__responsiveTableObserver = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            (mutation.addedNodes || []).forEach(node => {
                if (!node || node.nodeType !== 1) return;
                const ownTag = node.tagName ? node.tagName.toLowerCase() : '';
                const parentTable = node.closest && node.closest('table');
                if (parentTable) queuedRoots.add(parentTable);
                else if (ownTag === 'table') queuedRoots.add(node);
                else if (node.querySelector && node.querySelector('table')) queuedRoots.add(node);
            });
        });
        if (!queuedRoots.size) return;
        if (queued) return;
        queued = true;
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(flush, { timeout: 500 });
        } else {
            setTimeout(flush, 120);
        }
    });
    window.__responsiveTableObserver.observe(document.body, { childList: true, subtree: true });
}

function getLastSyncTimestamp() {
    const candidates = [
        '_last_full_sync_at',
        'last_full_sync_at',
        'last_server_sync',
        'lastCloudSync',
        'last_sync_at',
        'disk_cache_recovered_at'
    ];
    let latest = 0;
    candidates.forEach(key => {
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const parsed = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
        if (Number.isFinite(parsed) && parsed > latest) latest = parsed;
    });
    if (window._lastSuccessfulServerSyncAt && window._lastSuccessfulServerSyncAt > latest) {
        latest = window._lastSuccessfulServerSyncAt;
    }
    return latest;
}

function formatRelativeTime(timestamp) {
    if (!timestamp) return 'not yet';
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 45) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

function ensureSyncIndicator(container, paused = false) {
    if (!container) return null;
    let indicator = container.querySelector(':scope > .sync-view-indicator');
    if (!indicator) {
        indicator = document.createElement('span');
        indicator.className = 'sync-view-indicator live';
        container.appendChild(indicator);
    }
    indicator.classList.toggle('paused', !!paused);
    indicator.classList.toggle('live', !paused);
    return indicator;
}

function updateViewSyncIndicators() {
    const activeSection = document.querySelector('section.active');
    const lastSync = getLastSyncTimestamp();
    const label = `Last synced ${formatRelativeTime(lastSync)}`;
    const adminHeavyIds = new Set([
        'dashboard-view',
        'monthly',
        'admin-panel',
        'insight-studio',
        'assessment-schedule',
        'live-assessment',
        'manage',
        'capture',
        'superadmin-studio',
        'opl-hub',
        'assessment-studio',
        'content-studio'
    ]);

    document.querySelectorAll('.page-titlebar, .dash-titlebar').forEach(titlebar => {
        const owner = titlebar.closest('section');
        if (owner && (!owner.classList.contains('active') || !adminHeavyIds.has(owner.id))) return;
        const indicator = ensureSyncIndicator(titlebar, false);
        if (indicator) indicator.innerHTML = `<i class="fas fa-rotate"></i> ${label}`;
    });

    const attendanceState = document.getElementById('attAdminRefreshState');
    if (attendanceState) {
        attendanceState.textContent = `Live updates paused while this window is open. ${label}.`;
    }

    if (activeSection && adminHeavyIds.has(activeSection.id) && !activeSection.querySelector('.page-titlebar, .dash-titlebar')) {
        const heading = activeSection.querySelector('h2');
        if (heading && heading.parentElement) {
            const indicator = ensureSyncIndicator(heading.parentElement, false);
            if (indicator) indicator.innerHTML = `<i class="fas fa-rotate"></i> ${label}`;
        }
    }
}

window.getThemeVariableSnapshot = getThemeVariableSnapshot;
window.applyThemeToEmbeddedFrame = applyThemeToEmbeddedFrame;
window.applyThemeToWebview = applyThemeToWebview;
window.syncThemeToEmbeddedPrograms = syncThemeToEmbeddedPrograms;
window.getCurrentUIDensity = getCurrentUIDensity;
window.applyUIDensity = applyUIDensity;
window.setUIDensity = setUIDensity;
window.applyResponsiveTableLabels = applyResponsiveTableLabels;
window.installResponsiveTableCards = installResponsiveTableCards;
window.updateViewSyncIndicators = updateViewSyncIndicators;

// --- HELPER: Lighten/Darken Hex Color ---
function lightenColor(col, amt) {
    let usePound = false;
    if (col[0] === "#") {
        col = col.slice(1);
        usePound = true;
    }
    let num = parseInt(col, 16);
    let r = (num >> 16) + amt;
    let b = ((num >> 8) & 0x00FF) + amt;
    let g = (num & 0x0000FF) + amt;
    if (r > 255) r = 255; else if (r < 0) r = 0;
    if (b > 255) b = 255; else if (b < 0) b = 0;
    if (g > 255) g = 255; else if (g < 0) g = 0;
    return (usePound ? "#" : "") + ((g | (b << 8) | (r << 16)) >>> 0).toString(16).padStart(6, '0');
}

// Helper to create the soft color variant
function adjustOpacity(hex, alpha) {
    // Basic hex to rgba converter
    let c;
    if(/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)){
        c= hex.substring(1).split('');
        if(c.length== 3){
            c= [c[0], c[0], c[1], c[1], c[2], c[2]];
        }
        c= '0x'+c.join('');
        return 'rgba('+[(c>>16)&255, (c>>8)&255, c&255].join(',')+','+alpha+')';
    }
    return hex; // Return original if not hex
}
// ------------------------------------

// --- EXPERIMENTAL THEME LOGIC ---
function sanitizeThemeHexColor(value, fallback) {
    const raw = (value || '').trim();
    if (/^#([A-Fa-f0-9]{6})$/.test(raw)) return raw.toUpperCase();
    if (/^#([A-Fa-f0-9]{3})$/.test(raw)) {
        const r = raw[1];
        const g = raw[2];
        const b = raw[3];
        return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
    }
    return fallback;
}

function clampThemeNumber(value, min, max, fallback) {
    const n = parseFloat(value);
    if (Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function sanitizeThemeWallpaperUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        const parsed = new URL(raw);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        return parsed.toString();
    } catch (e) {
        return '';
    }
}

function getHexRgbTuple(hex) {
    const clean = sanitizeThemeHexColor(hex, '#F37021').replace('#', '');
    const num = parseInt(clean, 16);
    return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255
    };
}

function getDefaultCustomExperimentalThemeConfig() {
    return {
        accent: '#5DB2FF',
        bgApp: '#0B1726',
        bgCard: '#14263C',
        textMain: '#E6F3FF',
        textMuted: '#97B4D1',
        border: '#2F4F72',
        wallpaper: '',
        mood: 'aurora',
        motionSpeed: 1,
        glowStrength: 0.26,
        cornerRadius: 13
    };
}

function sanitizeCustomExperimentalThemeConfig(rawConfig) {
    const defaults = getDefaultCustomExperimentalThemeConfig();
    const config = { ...defaults, ...(rawConfig || {}) };
    const allowedMoods = ['aurora', 'sunset', 'night', 'emerald'];

    config.accent = sanitizeThemeHexColor(config.accent, defaults.accent);
    config.bgApp = sanitizeThemeHexColor(config.bgApp, defaults.bgApp);
    config.bgCard = sanitizeThemeHexColor(config.bgCard, defaults.bgCard);
    config.textMain = sanitizeThemeHexColor(config.textMain, defaults.textMain);
    config.textMuted = sanitizeThemeHexColor(config.textMuted, defaults.textMuted);
    config.border = sanitizeThemeHexColor(config.border, defaults.border);
    config.wallpaper = sanitizeThemeWallpaperUrl(config.wallpaper || '');
    config.mood = allowedMoods.includes(config.mood) ? config.mood : defaults.mood;
    config.motionSpeed = clampThemeNumber(config.motionSpeed, 0.7, 1.5, defaults.motionSpeed);
    config.glowStrength = clampThemeNumber(config.glowStrength, 0.1, 0.5, defaults.glowStrength);
    config.cornerRadius = clampThemeNumber(config.cornerRadius, 8, 22, defaults.cornerRadius);

    return config;
}

function buildCustomExperimentalThemeBackground(config) {
    const accentSoft = adjustOpacity(config.accent, 0.18);
    const accentMid = adjustOpacity(config.accent, 0.28);
    const bgLift = lightenColor(config.bgApp, 14);
    const cardLift = lightenColor(config.bgCard, 8);

    let gradientBase = '';
    if (config.mood === 'sunset') {
        gradientBase = `linear-gradient(145deg, ${lightenColor(config.accent, -22)} 0%, ${bgLift} 38%, ${config.bgApp} 100%)`;
    } else if (config.mood === 'night') {
        gradientBase = `radial-gradient(circle at 20% 0%, ${cardLift} 0%, ${config.bgApp} 62%, #05080E 100%)`;
    } else if (config.mood === 'emerald') {
        const leaf = '#1B6F5F';
        gradientBase = `radial-gradient(circle at 80% 10%, ${adjustOpacity(leaf, 0.65)} 0%, transparent 42%), linear-gradient(140deg, ${bgLift} 0%, ${config.bgApp} 55%, ${lightenColor(config.bgApp, -6)} 100%)`;
    } else {
        gradientBase = `radial-gradient(circle at 15% 5%, ${accentSoft} 0%, transparent 32%), radial-gradient(circle at 88% 18%, ${accentMid} 0%, transparent 40%), linear-gradient(140deg, ${bgLift} 0%, ${config.bgApp} 52%, ${lightenColor(config.bgApp, -8)} 100%)`;
    }

    if (config.wallpaper) {
        const safeWallpaper = config.wallpaper
            .replace(/\\/g, '/')
            .replace(/'/g, '%27')
            .replace(/\(/g, '%28')
            .replace(/\)/g, '%29');
        return `linear-gradient(180deg, rgba(0,0,0,0.62), rgba(0,0,0,0.52)), url('${safeWallpaper}'), ${gradientBase}`;
    }

    return gradientBase;
}

function getStoredCustomExperimentalThemeConfig() {
    const stored = mainReadObject('experimental_theme_custom');
    return sanitizeCustomExperimentalThemeConfig(stored);
}

function saveCustomExperimentalThemeConfig(config) {
    localStorage.setItem('experimental_theme_custom', JSON.stringify(sanitizeCustomExperimentalThemeConfig(config)));
}

function clearCustomExperimentalThemeVariables() {
    const root = document.documentElement;
    [
        '--exp-custom-primary',
        '--exp-custom-primary-hover',
        '--exp-custom-primary-soft',
        '--exp-custom-bg-app',
        '--exp-custom-bg-header',
        '--exp-custom-bg-card',
        '--exp-custom-bg-input',
        '--exp-custom-text-main',
        '--exp-custom-text-muted',
        '--exp-custom-border',
        '--exp-custom-radius',
        '--exp-custom-motion-speed',
        '--exp-custom-glow-alpha',
        '--exp-custom-background',
        '--exp-accent-rgb',
        '--exp-motion-speed',
        '--exp-glow-alpha'
    ].forEach(v => root.style.removeProperty(v));
}

function applyCustomExperimentalThemeVariables(config) {
    const clean = sanitizeCustomExperimentalThemeConfig(config);
    const root = document.documentElement;
    const accentRgb = getHexRgbTuple(clean.accent);
    const bgHead = adjustOpacity(clean.bgApp, 0.92);
    const bgInput = lightenColor(clean.bgCard, 12);
    const accentHover = lightenColor(clean.accent, -18);

    root.style.setProperty('--exp-custom-primary', clean.accent);
    root.style.setProperty('--exp-custom-primary-hover', accentHover);
    root.style.setProperty('--exp-custom-primary-soft', adjustOpacity(clean.accent, 0.19));
    root.style.setProperty('--exp-custom-bg-app', clean.bgApp);
    root.style.setProperty('--exp-custom-bg-header', bgHead);
    root.style.setProperty('--exp-custom-bg-card', adjustOpacity(clean.bgCard, 0.9));
    root.style.setProperty('--exp-custom-bg-input', adjustOpacity(bgInput, 0.9));
    root.style.setProperty('--exp-custom-text-main', clean.textMain);
    root.style.setProperty('--exp-custom-text-muted', clean.textMuted);
    root.style.setProperty('--exp-custom-border', clean.border);
    root.style.setProperty('--exp-custom-radius', `${Math.round(clean.cornerRadius)}px`);
    root.style.setProperty('--exp-custom-motion-speed', clean.motionSpeed.toFixed(2));
    root.style.setProperty('--exp-custom-glow-alpha', clean.glowStrength.toFixed(2));
    root.style.setProperty('--exp-custom-background', buildCustomExperimentalThemeBackground(clean));
    root.style.setProperty('--exp-accent-rgb', `${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}`);
    root.style.setProperty('--exp-motion-speed', clean.motionSpeed.toFixed(2));
    root.style.setProperty('--exp-glow-alpha', clean.glowStrength.toFixed(2));
}

function collectCustomExperimentalThemeFromControls() {
    const controls = {
        accent: document.getElementById('expCustomAccent'),
        bgApp: document.getElementById('expCustomBg'),
        bgCard: document.getElementById('expCustomCard'),
        textMain: document.getElementById('expCustomTextMain'),
        textMuted: document.getElementById('expCustomTextMuted'),
        border: document.getElementById('expCustomBorder'),
        wallpaper: document.getElementById('expCustomWallpaper'),
        mood: document.getElementById('expCustomMood'),
        motionSpeed: document.getElementById('expCustomMotion'),
        glowStrength: document.getElementById('expCustomGlow'),
        cornerRadius: document.getElementById('expCustomRadius')
    };

    if (!controls.accent) {
        return getStoredCustomExperimentalThemeConfig();
    }

    return sanitizeCustomExperimentalThemeConfig({
        accent: controls.accent.value,
        bgApp: controls.bgApp.value,
        bgCard: controls.bgCard.value,
        textMain: controls.textMain.value,
        textMuted: controls.textMuted.value,
        border: controls.border.value,
        wallpaper: controls.wallpaper.value,
        mood: controls.mood.value,
        motionSpeed: controls.motionSpeed.value,
        glowStrength: controls.glowStrength.value,
        cornerRadius: controls.cornerRadius.value
    });
}

function syncCustomThemeControlUI(config) {
    const clean = sanitizeCustomExperimentalThemeConfig(config);
    const setValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    };

    setValue('expCustomAccent', clean.accent);
    setValue('expCustomBg', clean.bgApp);
    setValue('expCustomCard', clean.bgCard);
    setValue('expCustomTextMain', clean.textMain);
    setValue('expCustomTextMuted', clean.textMuted);
    setValue('expCustomBorder', clean.border);
    setValue('expCustomWallpaper', clean.wallpaper || '');
    setValue('expCustomMood', clean.mood);
    setValue('expCustomMotion', clean.motionSpeed.toFixed(2));
    setValue('expCustomGlow', clean.glowStrength.toFixed(2));
    setValue('expCustomRadius', Math.round(clean.cornerRadius));

    const motionReadout = document.getElementById('expCustomMotionReadout');
    if (motionReadout) motionReadout.textContent = `${clean.motionSpeed.toFixed(2)}x`;
    const glowReadout = document.getElementById('expCustomGlowReadout');
    if (glowReadout) glowReadout.textContent = clean.glowStrength.toFixed(2);
    const radiusReadout = document.getElementById('expCustomRadiusReadout');
    if (radiusReadout) radiusReadout.textContent = `${Math.round(clean.cornerRadius)}px`;

    const swatchAccent = document.getElementById('expCustomSwatchAccent');
    if (swatchAccent) swatchAccent.style.background = clean.accent;
    const swatchBg = document.getElementById('expCustomSwatchBg');
    if (swatchBg) swatchBg.style.background = clean.bgApp;
    const swatchCard = document.getElementById('expCustomSwatchCard');
    if (swatchCard) swatchCard.style.background = clean.bgCard;

    const stateBadge = document.getElementById('expThemeCustomState');
    if (stateBadge) {
        const isActive = (localStorage.getItem('experimental_theme') === 'theme-custom-lab');
        stateBadge.textContent = isActive ? 'Custom Active' : 'Draft';
        stateBadge.style.color = isActive ? '#DCFCE7' : '';
        stateBadge.style.background = isActive ? '#14532D' : '';
        stateBadge.style.border = isActive ? '1px solid rgba(34,197,94,0.55)' : '';
    }
}

function loadExperimentalThemeCustomizer() {
    const hasControls = document.getElementById('expCustomAccent');
    if (!hasControls) return;
    syncCustomThemeControlUI(getStoredCustomExperimentalThemeConfig());
}

window.handleCustomExperimentalThemeInput = function() {
    const config = collectCustomExperimentalThemeFromControls();
    syncCustomThemeControlUI(config);

    if (localStorage.getItem('experimental_theme') === 'theme-custom-lab') {
        saveCustomExperimentalThemeConfig(config);
        applyCustomExperimentalThemeVariables(config);
        updateExperimentalThemePickerState();
    }
};

window.previewCustomExperimentalTheme = function() {
    const config = collectCustomExperimentalThemeFromControls();
    saveCustomExperimentalThemeConfig(config);
    applyExperimentalTheme('theme-custom-lab');
    if (typeof showToast === 'function') showToast('Custom Lab preview applied.', 'info');
};

window.saveCustomExperimentalTheme = function() {
    const config = collectCustomExperimentalThemeFromControls();
    saveCustomExperimentalThemeConfig(config);
    applyExperimentalTheme('theme-custom-lab');
    if (typeof showToast === 'function') showToast('Custom Lab theme saved.', 'success');
};

window.resetCustomExperimentalTheme = function() {
    const defaults = getDefaultCustomExperimentalThemeConfig();
    saveCustomExperimentalThemeConfig(defaults);
    syncCustomThemeControlUI(defaults);
    if (localStorage.getItem('experimental_theme') === 'theme-custom-lab') {
        applyExperimentalTheme('theme-custom-lab');
    } else if (typeof showToast === 'function') {
        showToast('Custom Lab preset reset to defaults.', 'info');
    }
};

window.applyCustomExperimentalTheme = function(overrides = {}) {
    const existing = getStoredCustomExperimentalThemeConfig();
    const merged = sanitizeCustomExperimentalThemeConfig({ ...existing, ...(overrides || {}) });
    saveCustomExperimentalThemeConfig(merged);
    applyExperimentalTheme('theme-custom-lab');
    return merged;
};

function updateExperimentalThemePickerState() {
    const storedTheme = localStorage.getItem('experimental_theme') || '';
    const activeTheme = (typeof getEffectiveExperimentalTheme === 'function') ? getEffectiveExperimentalTheme() : storedTheme;
    const labels = {
        'theme-custom-lab': 'Custom Lab',
        'theme-one-ui': 'One UI Clean',
        'theme-cyberpunk': 'Neon Nights',
        'theme-ocean': 'Deep Sea',
        'theme-forest': 'Enchanted Forest',
        'theme-royal': 'Royal Amethyst'
    };

    document.querySelectorAll('.exp-theme-option[data-exp-theme]').forEach(btn => {
        const thisTheme = btn.getAttribute('data-exp-theme');
        const isActive = thisTheme === activeTheme;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    const badge = document.getElementById('expThemeCurrentBadge');
    if (badge) {
        const suffix = activeTheme === 'theme-one-ui' && !storedTheme ? ' (Default)' : '';
        badge.textContent = activeTheme ? `Current: ${labels[activeTheme] || 'Custom Preset'}${suffix}` : 'Current: Original';
    }

    syncCustomThemeControlUI(getStoredCustomExperimentalThemeConfig());
}

function applyExperimentalTheme(themeName, options = {}) {
    window.__APPLYING_EXPERIMENTAL_THEME = true;
    // 1. Remove all experimental classes
    document.body.classList.remove('exp-theme-active', 'exp-theme-wallpaper', 'theme-custom-lab', 'theme-one-ui', 'theme-cyberpunk', 'theme-ocean', 'theme-forest', 'theme-royal');
    clearCustomExperimentalThemeVariables();
    clearOneUiThemeVariables();
    
    if (themeName) {
        const existingOverlay = document.getElementById('bg-overlay');
        if (existingOverlay) existingOverlay.remove();
        document.body.style.background = '';
        document.body.style.backgroundImage = '';
        document.body.style.backgroundSize = '';
        document.body.style.backgroundPosition = '';
        document.body.style.backgroundAttachment = '';
        // 2. Apply new theme
        document.body.classList.add('exp-theme-active');
        if (themeName === 'theme-custom-lab') {
            const customConfig = getStoredCustomExperimentalThemeConfig();
            applyCustomExperimentalThemeVariables(customConfig);
            if (customConfig.wallpaper) {
                document.body.classList.add('exp-theme-wallpaper');
            }
        }
        document.body.classList.add(themeName);
        if (themeName === 'theme-one-ui') {
            applyOneUiThemeVariables(getStoredLocalThemeConfig());
        }
        if (options.persist !== false) localStorage.setItem('experimental_theme', themeName);
    } else {
        // 3. Reset
        localStorage.removeItem('experimental_theme');
        // Re-apply user theme to ensure we go back to normal
        if (!options.skipUserTheme && typeof applyUserTheme === 'function') applyUserTheme();
    }

    window.__APPLYING_EXPERIMENTAL_THEME = false;
    updateExperimentalThemePickerState();
    scheduleEmbeddedThemeSync({ delay: 80 });
}

const ADMIN_NAV_VIEW_KEY = 'admin_nav_view';
const ADMIN_NAV_ADVANCED = 'navigation-map';
const ADMIN_NAV_ORDER_KEY = 'admin_nav_order';
let SIDEBAR_EXPAND_TIMER = null;
let SIDEBAR_COLLAPSE_TIMER = null;

const ADVANCED_ADMIN_NAV_GROUPS = [
    {
        label: 'Home',
        items: [
            { id: 'dashboard-view', title: 'Home / Overview', text: 'Home', icon: 'fas fa-home' },
            { id: 'admin-panel', title: 'Admin Tools', text: 'Admin Tools', icon: 'fas fa-cogs', classes: 'admin-only', subItems: [
                { label: 'Manage Users', type: 'admin', view: 'users' },
                { label: 'Training Topics', type: 'admin', view: 'assessments' },
                { label: 'System Config', type: 'admin', view: 'insight-rules' },
                { label: 'Database', type: 'admin', view: 'data' },
                { label: 'Tool Hosting', type: 'admin', view: 'tool-hosting' },
                { label: 'Access Control', type: 'admin', view: 'access' },
                { label: 'System Status', type: 'admin', view: 'status' },
                { label: 'Updates', type: 'admin', view: 'updates' },
                { label: 'Theme', type: 'admin', view: 'theme' },
                { label: 'Graduated Agents', type: 'admin', view: 'graduates' }
            ] },
            { id: 'network-test', buttonId: 'btn-sidebar-net-test', title: 'Run Network Diagnostics', text: 'Network Test', icon: 'fas fa-wifi', action: 'network' }
        ]
    },
    {
        label: 'Admin Workflow',
        items: [
            { id: 'insight-studio', title: 'Insight', text: 'Insight', icon: 'fas fa-chart-line', classes: 'admin-only', subItems: [
                { label: 'Agent Triggers', type: 'insight', view: 'triggers' },
                { label: 'Agent Progress', type: 'insight', view: 'progress' },
                { label: 'Department Overview', type: 'insight', view: 'department' },
                { label: 'Compare Viewer', type: 'insight', view: 'compare' },
                { label: 'Insight Build', type: 'insight', view: 'build' },
                { label: 'HR Evidence', type: 'insight', view: 'hr-evidence' },
                { label: 'Knowledge Gaps', type: 'insight', view: 'knowledge' }
            ] },
            { id: 'report-card', title: 'Onboard Report', text: 'Onboard Report', icon: 'fas fa-file-invoice', classes: 'admin-only tl-access', subItems: [
                { label: 'New Report', type: 'report', view: 'create' },
                { label: 'Saved Reports', type: 'report', view: 'saved' }
            ] },
            { id: 'opl-hub', title: 'OPL Hub', text: 'OPL Hub', icon: 'fas fa-book-open', classes: 'admin-only', subItems: [
                { label: 'OPL Search', type: 'opl', view: 'opl_search' },
                { label: 'Backend Data', type: 'opl', view: 'backend_data' }
            ] },
            { id: 'qa-hub', title: 'Q&A Hub', text: 'Q&A Hub', icon: 'fas fa-circle-question', classes: 'admin-only' }
        ]
    },
    {
        label: 'Training Content',
        items: [
            { id: 'assessment-studio', title: 'Assessment Studio', text: 'Assessment Studio', icon: 'fas fa-vial-circle-check', classes: 'admin-only', subItems: [
                { label: 'Question Bucket', type: 'assessment-studio', view: 'bucket' },
                { label: 'Test Generator Details', type: 'assessment-studio', view: 'generator' },
                { label: 'Completed Tests', type: 'assessment-studio', view: 'completed' },
                { label: 'Grading Queue', type: 'assessment-studio', view: 'grading' },
                { label: 'Feedback Sessions', type: 'assessment-studio', view: 'feedback' },
                { label: 'Universal Search', type: 'assessment-studio', view: 'search' }
            ] },
            { id: 'content-studio', title: 'Content Creator', text: 'Content Creator', icon: 'fas fa-photo-film', subItems: [
                { label: 'View Content', type: 'content-studio', view: 'view' },
                { label: 'Builder', type: 'content-studio', view: 'builder' },
                { label: 'Engagement', type: 'content-studio', view: 'engagement' },
                { label: 'Files', type: 'content-studio', view: 'files' }
            ] },
            { id: 'assessment-schedule', title: 'Schedule', text: 'Schedule', icon: 'fas fa-list-alt', subItems: [
                { label: 'Timeline View', type: 'schedule-view', view: 'list' },
                { label: 'Calendar View', type: 'schedule-view', view: 'calendar' }
            ] },
            { id: 'test-manage', title: 'Test Engine', text: 'Test Engine', icon: 'fas fa-clipboard-check', classes: 'admin-only', subItems: [
                { label: 'Overview & Manage', type: 'test-engine', view: 'overview' },
                { label: 'Completed History', type: 'test-engine', view: 'history' },
                { label: 'Feedback Sessions', type: 'test-engine', view: 'feedback' },
                { label: 'Integrity Review', type: 'test-engine', view: 'integrity' },
                { label: 'NPS Feedback', type: 'test-engine', view: 'nps' }
            ] }
        ]
    },
    {
        label: 'Arenas',
        items: [
            { id: 'live-assessment', buttonId: 'nav-live-assessment', title: 'Live Assessment Booking', text: 'Live Assessment Booking', icon: 'fas fa-calendar-check', subItems: [
                { label: 'Schedule Grid', type: 'live-booking', view: 'grid' },
                { label: 'Booking Controls', type: 'live-booking', view: 'controls' },
                { label: 'Schedule Settings', type: 'live-booking', view: 'settings' },
                { label: 'Booking Guide', type: 'live-booking', view: 'rules' }
            ] },
            { id: 'live-execution', buttonId: 'btn-live-exec', title: 'Live Session Arena', text: 'Live Session Arena', icon: 'fas fa-satellite-dish' },
            { id: 'vetting-arena', title: 'Vetting Test Arena', text: 'Vetting Test Arena', icon: 'fas fa-shield-halved', classes: 'admin-only', subItems: [
                { label: 'Tabbed View', type: 'vetting-arena', view: 'tabbed' },
                { label: 'Split View', type: 'vetting-arena', view: 'split' }
            ] }
        ]
    },
    {
        label: 'Management Tools',
        items: [
            { id: 'manage', title: 'Add Group', text: 'Add Group', icon: 'fas fa-user-plus', classes: 'admin-only' },
            { id: 'capture', title: 'Capture Scores', text: 'Capture Scores', icon: 'fas fa-edit', classes: 'admin-only' }
        ]
    },
    {
        label: 'Reports',
        items: [
            { id: 'monthly', title: 'Assessment Records', text: 'Assessment Records', icon: 'fas fa-table' },
            { id: 'test-records', title: 'Test Records', text: 'Test Records', icon: 'fas fa-tasks', classes: 'admin-only' },
            { id: 'agent-search', title: 'Agent Search', text: 'Agent Search', icon: 'fas fa-search', classes: 'admin-only tl-access' },
            { id: 'my-tests', buttonId: 'nav-my-tests', title: 'My Assessments', text: 'My Assessments', icon: 'fas fa-pen-fancy' }
        ]
    },
    {
        label: 'Extras',
        items: [
            { id: 'tl-hub', title: 'Teamleader Hub', text: 'Teamleader Hub', icon: 'fas fa-users-cog', subItems: [
                { label: 'Operations Timeline', type: 'teamleader-hub', view: 'timeline' },
                { label: 'My Team', type: 'teamleader-hub', view: 'my_team' },
                { label: 'Insight Overview', type: 'teamleader-hub', view: 'overview' },
                { label: 'Agent Feedback', type: 'teamleader-hub', view: 'agent_feedback' },
                { label: 'Add Team', type: 'teamleader-hub', view: 'roster' },
                { label: 'Backend Data', type: 'teamleader-hub', view: 'backend_data' }
            ] },
            { id: 'superadmin-studio', title: 'Super Admin Data Studio', text: 'Data Studio', icon: 'fas fa-satellite-dish', classes: 'admin-only', subItems: [
                { label: 'Overview', type: 'superadmin-studio', view: 'overview' },
                { label: 'People', type: 'superadmin-studio', view: 'people' },
                { label: 'User Control', type: 'superadmin-studio', view: 'user-control' },
                { label: 'Assessments', type: 'superadmin-studio', view: 'learning' },
                { label: 'Operations', type: 'superadmin-studio', view: 'operations' },
                { label: 'System', type: 'superadmin-studio', view: 'system' },
                { label: 'Raw Explorer', type: 'superadmin-studio', view: 'explorer' }
            ] },
            { id: 'first-line-troubleshooting', title: 'First Line Troubleshooting Tool', text: 'Troubleshooting', icon: 'fas fa-screwdriver-wrench' }
        ]
    }
];

function canUseAdminNavigationView() {
    return !!(CURRENT_USER && ['admin', 'super_admin', 'teamleader'].includes(CURRENT_USER.role));
}

function initSidebarHoverController() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || sidebar.dataset.hoverControllerReady === '1') return;
    sidebar.dataset.hoverControllerReady = '1';

    const expand = () => {
        if (SIDEBAR_COLLAPSE_TIMER) clearTimeout(SIDEBAR_COLLAPSE_TIMER);
        SIDEBAR_COLLAPSE_TIMER = null;
        SIDEBAR_EXPAND_TIMER = setTimeout(() => {
            sidebar.classList.add('is-expanded');
            document.body.classList.add('sidebar-expanded');
        }, 170);
    };

    const collapse = () => {
        if (SIDEBAR_EXPAND_TIMER) clearTimeout(SIDEBAR_EXPAND_TIMER);
        SIDEBAR_EXPAND_TIMER = null;
        SIDEBAR_COLLAPSE_TIMER = setTimeout(() => {
            sidebar.classList.remove('is-expanded');
            document.body.classList.remove('sidebar-expanded');
            document.querySelectorAll('.nav-item-wrap.submenu-open').forEach(wrap => wrap.classList.remove('submenu-open'));
        }, 260);
    };

    sidebar.addEventListener('pointerenter', expand);
    sidebar.addEventListener('pointerleave', collapse);
    sidebar.addEventListener('focusin', () => {
        if (SIDEBAR_COLLAPSE_TIMER) clearTimeout(SIDEBAR_COLLAPSE_TIMER);
        sidebar.classList.add('is-expanded');
        document.body.classList.add('sidebar-expanded');
    });
    sidebar.addEventListener('focusout', () => {
        setTimeout(() => {
            if (!sidebar.contains(document.activeElement)) collapse();
        }, 0);
    });
}

function getStoredAdminNavigationView() {
    const raw = String(localStorage.getItem(ADMIN_NAV_VIEW_KEY) || '').trim();
    if (raw === 'classic') return 'classic';
    if (raw === 'advanced-minimal') return ADMIN_NAV_ADVANCED;
    return ADMIN_NAV_ADVANCED;
}

function escapeNavAttr(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getDefaultAdminNavigationItems() {
    return ADVANCED_ADMIN_NAV_GROUPS.flatMap(group => group.items.map(item => ({ ...item })));
}

function readAdminNavigationOrder() {
    return mainReadArray(ADMIN_NAV_ORDER_KEY).map(id => String(id || '').trim()).filter(Boolean);
}

function getOrderedAdminNavigationItems() {
    const items = getDefaultAdminNavigationItems().map(item => ({
        ...item,
        subItems: getNavigationSubItems(item)
    }));
    const byId = new Map(items.map(item => [item.id, item]));
    const orderedIds = readAdminNavigationOrder();
    const ordered = [];
    orderedIds.forEach(id => {
        if (!byId.has(id)) return;
        ordered.push(byId.get(id));
        byId.delete(id);
    });
    return [...ordered, ...Array.from(byId.values())];
}

function getAdminNavigationOrderSignature() {
    return getOrderedAdminNavigationItems()
        .map(item => `${item.id}:${(item.subItems || []).map(sub => `${sub.type}:${sub.view}:${sub.label}`).join(',')}`)
        .join('|');
}

function readNavigationJson(key, fallback) {
    return mainReadJson(key, fallback);
}

function getNavigationGroupLabel(groupId, count = null) {
    if (typeof getGroupLabel === 'function') return getGroupLabel(groupId, count).replace(/\s*\[[^\]]*\]\s*$/, '').trim();
    return String(groupId || '').trim();
}

function getScheduleNavigationItems() {
    const schedules = readNavigationJson('schedules', {});
    const rosters = readNavigationJson('rosters', {});
    return Object.keys(schedules || {}).sort().map(id => {
        const assigned = schedules[id] && schedules[id].assigned;
        const label = assigned ? getNavigationGroupLabel(assigned, (rosters[assigned] || []).length) : 'Unassigned';
        return { label: `Schedule ${id}: ${label}`, type: 'schedule-id', view: id };
    });
}

function getLiveScheduleNavigationItems() {
    const liveSchedules = readNavigationJson('liveSchedules', {});
    return Object.keys(liveSchedules || {}).sort().map(id => {
        const assigned = liveSchedules[id] && liveSchedules[id].assigned;
        const label = assigned ? getNavigationGroupLabel(assigned) : 'Unassigned';
        return { label: `Live Schedule ${id}: ${label}`, type: 'live-schedule-id', view: id };
    });
}

function getNavigationSubItems(item) {
    const base = Array.isArray(item && item.subItems) ? item.subItems.slice() : [];
    if (!item) return base;
    if (item.id === 'assessment-schedule') {
        return [...base, ...getScheduleNavigationItems()];
    }
    if (item.id === 'live-assessment') {
        return [...base, ...getLiveScheduleNavigationItems()];
    }
    return base;
}

function getNavigationSubItemIcon(sub) {
    const type = String(sub && sub.type || '');
    const view = String(sub && sub.view || '');
    const key = `${type}:${view}`;
    const exact = {
        'admin:users': 'fas fa-users-gear',
        'admin:assessments': 'fas fa-layer-group',
        'admin:insight-rules': 'fas fa-sliders',
        'admin:data': 'fas fa-database',
        'admin:tool-hosting': 'fas fa-cloud-arrow-up',
        'admin:access': 'fas fa-key',
        'admin:status': 'fas fa-heart-pulse',
        'admin:updates': 'fas fa-download',
        'admin:theme': 'fas fa-palette',
        'admin:graduates': 'fas fa-user-graduate',
        'insight:triggers': 'fas fa-bolt',
        'insight:progress': 'fas fa-list-check',
        'insight:department': 'fas fa-building-user',
        'insight:compare': 'fas fa-chart-simple',
        'insight:build': 'fas fa-pen-ruler',
        'insight:hr-evidence': 'fas fa-briefcase',
        'insight:knowledge': 'fas fa-lightbulb',
        'report:create': 'fas fa-file-circle-plus',
        'report:saved': 'fas fa-folder-open',
        'opl:opl_search': 'fas fa-magnifying-glass',
        'opl:backend_data': 'fas fa-table-list',
        'assessment-studio:bucket': 'fas fa-box-archive',
        'assessment-studio:generator': 'fas fa-wand-magic-sparkles',
        'assessment-studio:completed': 'fas fa-clipboard-check',
        'assessment-studio:grading': 'fas fa-pen-to-square',
        'assessment-studio:feedback': 'fas fa-comments',
        'assessment-studio:search': 'fas fa-magnifying-glass',
        'content-studio:view': 'fas fa-eye',
        'content-studio:builder': 'fas fa-hammer',
        'content-studio:engagement': 'fas fa-chart-pie',
        'content-studio:files': 'fas fa-folder-tree',
        'schedule-view:list': 'fas fa-timeline',
        'schedule-view:calendar': 'fas fa-calendar-days',
        'test-engine:overview': 'fas fa-gauge-high',
        'test-engine:history': 'fas fa-clock-rotate-left',
        'test-engine:feedback': 'fas fa-comments',
        'test-engine:integrity': 'fas fa-shield-virus',
        'test-engine:nps': 'fas fa-star-half-stroke',
        'live-booking:grid': 'fas fa-table-cells-large',
        'live-booking:controls': 'fas fa-toggle-on',
        'live-booking:settings': 'fas fa-gear',
        'live-booking:rules': 'fas fa-book',
        'vetting-arena:tabbed': 'fas fa-table-columns',
        'vetting-arena:split': 'fas fa-grip',
        'teamleader-hub:timeline': 'fas fa-timeline',
        'teamleader-hub:my_team': 'fas fa-people-group',
        'teamleader-hub:overview': 'fas fa-chart-line',
        'teamleader-hub:agent_feedback': 'fas fa-comment-dots',
        'teamleader-hub:roster': 'fas fa-user-plus',
        'teamleader-hub:backend_data': 'fas fa-table-list',
        'superadmin-studio:overview': 'fas fa-command',
        'superadmin-studio:people': 'fas fa-users',
        'superadmin-studio:user-control': 'fas fa-user-lock',
        'superadmin-studio:learning': 'fas fa-graduation-cap',
        'superadmin-studio:operations': 'fas fa-diagram-project',
        'superadmin-studio:system': 'fas fa-server',
        'superadmin-studio:explorer': 'fas fa-magnifying-glass-chart'
    };
    if (exact[key]) return exact[key];
    if (type === 'schedule-id') return 'fas fa-calendar-check';
    if (type === 'live-schedule-id') return 'fas fa-video';
    return 'fas fa-arrow-right';
}

function saveAdminNavigationOrder(ids) {
    const validIds = new Set(getDefaultAdminNavigationItems().map(item => item.id));
    const next = (Array.isArray(ids) ? ids : []).filter(id => validIds.has(id));
    getDefaultAdminNavigationItems().forEach(item => {
        if (!next.includes(item.id)) next.push(item.id);
    });
    localStorage.setItem(ADMIN_NAV_ORDER_KEY, JSON.stringify(next));
}

function reorderAdminNavigationItem(draggedId, targetId) {
    if (!draggedId || !targetId || draggedId === targetId) return false;
    const ids = getOrderedAdminNavigationItems().map(item => item.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return false;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    saveAdminNavigationOrder(ids);
    return true;
}

function refreshAdvancedNavigationMap() {
    const menu = document.querySelector('.sidebar-menu');
    if (!menu || menu.dataset.navView !== ADMIN_NAV_ADVANCED) return;
    const active = document.querySelector('section.active');
    renderAdvancedAdminNavigation(menu);
    menu.dataset.navView = ADMIN_NAV_ADVANCED;
    if (active) setActiveNavigationTarget(active.id);
}

function canOpenAppPopoutWindows() {
    return !!(
        !window.APP_CHILD_WINDOW_MODE &&
        CURRENT_USER &&
        CURRENT_USER.role === 'super_admin' &&
        window.electronAPI?.appWindows?.open
    );
}

function getNavigationItemTitle(tabId) {
    const item = getDefaultAdminNavigationItems().find(entry => entry.id === tabId);
    return item ? (item.title || item.text || tabId) : String(tabId || 'App Window');
}

window.openAppTabWindow = async function openAppTabWindow(tabId, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    if (!canOpenAppPopoutWindows()) {
        if (typeof showToast === 'function') showToast('Only Super Admin can open app tabs in a separate window.', 'warning');
        return false;
    }

    const targetTab = String(tabId || '').trim();
    if (!targetTab) return false;

    try {
        await window.electronAPI.appWindows.open({
            mode: 'tab',
            actor: CURRENT_USER,
            user: CURRENT_USER,
            tabId: targetTab,
            title: `${getNavigationItemTitle(targetTab)} - 1st Line Training`
        });
        if (typeof showToast === 'function') showToast(`${getNavigationItemTitle(targetTab)} opened in a new window.`, 'success');
        return true;
    } catch (error) {
        console.error('Failed to open app tab window:', error);
        if (typeof showToast === 'function') showToast('Could not open that tab in a new window.', 'error');
        else alert('Could not open that tab in a new window.');
        return false;
    }
};

window.openCurrentTabWindow = function openCurrentTabWindow(event) {
    const active = document.querySelector('section.active');
    return window.openAppTabWindow(active ? active.id : 'dashboard-view', event);
};

function buildAdvancedNavButton(item) {
    const classes = ['nav-item', item.featured ? 'nav-item--primary' : 'nav-item--compact'].concat(String(item.classes || '').split(/\s+/).filter(Boolean)).join(' ');
    const hasSubmenu = Array.isArray(item.subItems) && item.subItems.length;
    const idAttr = item.buttonId ? ` id="${escapeNavAttr(item.buttonId)}"` : '';
    const onclick = item.action === 'network'
        ? ` onclick="if(window.NetworkDiag&&typeof NetworkDiag.openModal==='function') NetworkDiag.openModal()"`
        : ` onclick="showTab('${escapeNavAttr(item.id)}')"`;
    const submenu = hasSubmenu
        ? `<div class="nav-inline-submenu" id="nav-submenu-${escapeNavAttr(item.id)}" aria-label="${escapeNavAttr(item.text)} quick links">
                <div class="nav-inline-submenu-title"><i class="${escapeNavAttr(item.icon)}"></i><span>${escapeNavAttr(item.text)} shortcuts</span></div>
                ${item.subItems.map(sub => `<button class="nav-subitem" onclick="navigateAdvancedSubMenu('${escapeNavAttr(item.id)}','${escapeNavAttr(sub.type)}','${escapeNavAttr(sub.view)}')"><i class="${escapeNavAttr(getNavigationSubItemIcon(sub))}"></i><span>${escapeNavAttr(sub.label)}</span></button>`).join('')}
           </div>`
        : '';
    const expand = hasSubmenu
        ? `<button type="button" class="nav-submenu-control" title="Show shortcuts" aria-label="${escapeNavAttr(item.text)} shortcuts" onclick="toggleAdvancedNavSubmenu('${escapeNavAttr(item.id)}', event)">
                <i class="fas fa-chevron-down"></i>
           </button>`
        : '';
    const popout = (canOpenAppPopoutWindows() && item.action !== 'network')
        ? `<button type="button" class="nav-popout-control" title="Open in new window" aria-label="Open ${escapeNavAttr(item.text)} in new window" onclick="openAppTabWindow('${escapeNavAttr(item.id)}', event)">
                <i class="fas fa-up-right-from-square"></i>
           </button>`
        : '';
    return `<div class="nav-item-wrap${hasSubmenu ? ' nav-item-wrap--has-submenu' : ''}" draggable="true" data-nav-id="${escapeNavAttr(item.id)}" title="Drag to reorder">
        <div class="nav-item-row">
            <button${idAttr} class="${escapeNavAttr(classes)}"${onclick} title="${escapeNavAttr(item.title)}" data-nav-target="${escapeNavAttr(item.id)}">
                <i class="${escapeNavAttr(item.icon)}"></i><span class="nav-text">${escapeNavAttr(item.text)}</span>
            </button>
            ${expand}
            ${popout}
        </div>
        ${submenu}
    </div>`;
}

window.toggleAdvancedNavSubmenu = function toggleAdvancedNavSubmenu(id, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const safeId = String(id || '');
    const selectorId = (window.CSS && typeof CSS.escape === 'function') ? CSS.escape(safeId) : safeId.replace(/"/g, '\\"');
    const targetWrap = document.querySelector(`.nav-item-wrap[data-nav-id="${selectorId}"]`);
    if (!targetWrap) return;
    const shouldOpen = !targetWrap.classList.contains('submenu-open');
    document.querySelectorAll('.nav-item-wrap.submenu-open').forEach(wrap => {
        if (wrap !== targetWrap) wrap.classList.remove('submenu-open');
    });
    targetWrap.classList.toggle('submenu-open', shouldOpen);
};

window.navigateAdvancedSubMenu = function navigateAdvancedSubMenu(tabId, type, view) {
    const target = String(tabId || '');
    const kind = String(type || '');
    const subView = String(view || '');
    if (!target) return;
    showTab(target);
    setTimeout(() => {
        if (kind === 'admin' && typeof showAdminSub === 'function') {
            const btn = document.querySelector(`#btn-sub-${subView}`) || document.querySelector(`button[onclick*="showAdminSub('${subView}'"]`);
            showAdminSub(subView, btn || null);
        } else if (kind === 'test-engine' && typeof showTestEngineSub === 'function') {
            const btn = document.querySelector(`button[onclick*="showTestEngineSub('${subView}'"]`);
            showTestEngineSub(subView, btn || null);
        } else if (kind === 'report' && typeof showReportSub === 'function') {
            const btnId = subView === 'saved' ? 'btn-rep-saved' : 'btn-rep-new';
            showReportSub(subView, document.getElementById(btnId));
        } else if (kind === 'insight') {
            navigateEmbeddedInsightView(subView);
        } else if (kind === 'opl') {
            navigateOplHubView(subView);
        } else if (kind === 'assessment-studio') {
            navigateGenericWebviewApp('assessment-studio-webview', subView);
        } else if (kind === 'content-studio') {
            navigateGenericWebviewApp('content-studio-webview', subView);
        } else if (kind === 'teamleader-hub') {
            navigateGenericWebviewApp('tl-hub-webview', subView);
        } else if (kind === 'superadmin-studio') {
            navigateGenericWebviewApp('superadmin-data-studio-webview', subView);
        } else if (kind === 'vetting-arena') {
            navigateGenericWebviewScript('vetting-arena-webview', `(() => {
                if (window.App && typeof window.App.setViewMode === 'function') {
                    window.App.setViewMode(${JSON.stringify(subView)});
                    true;
                } else {
                    false;
                }
            })();`);
        } else if (kind === 'schedule-view') {
            navigateScheduleStudio({ view: subView });
        } else if (kind === 'schedule-id') {
            navigateScheduleStudio({ scheduleId: subView });
        } else if (kind === 'live-booking') {
            navigateLiveBookingSection(subView);
        } else if (kind === 'live-schedule-id') {
            navigateLiveBookingSchedule(subView);
        }
    }, 140);
};

function navigateGenericWebviewScript(webviewId, script, attempts = 8) {
    const webview = document.getElementById(webviewId)
        || (webviewId === 'vetting-arena-webview' ? document.querySelector('#vetting-arena-content .vetting-arena-webview') : null);
    if (webview && typeof webview.executeJavaScript === 'function') {
        webview.executeJavaScript(script, true).catch(() => {
            if (attempts > 0) setTimeout(() => navigateGenericWebviewScript(webviewId, script, attempts - 1), 180);
        });
        return;
    }
    if (attempts > 0) setTimeout(() => navigateGenericWebviewScript(webviewId, script, attempts - 1), 180);
}

function navigateGenericWebviewApp(webviewId, view, attempts = 8) {
    const webview = document.getElementById(webviewId);
    const safeView = JSON.stringify(String(view || ''));
    const script = `(() => {
        if (window.App && typeof window.App.setView === 'function') {
            window.App.setView(${safeView});
            true;
        } else {
            false;
        }
    })();`;
    if (webview && typeof webview.executeJavaScript === 'function') {
        webview.executeJavaScript(script, true).catch(() => {
            if (attempts > 0) setTimeout(() => navigateGenericWebviewApp(webviewId, view, attempts - 1), 180);
        });
        return;
    }
    if (attempts > 0) setTimeout(() => navigateGenericWebviewApp(webviewId, view, attempts - 1), 180);
}

function executeInsightScript(script, attempts = 8) {
    const webview = document.getElementById('insight-studio-webview');
    if (webview && typeof webview.executeJavaScript === 'function') {
        webview.executeJavaScript(script, true).catch(() => {
            if (attempts > 0) setTimeout(() => executeInsightScript(script, attempts - 1), 180);
        });
        return;
    }
    if (attempts > 0) setTimeout(() => executeInsightScript(script, attempts - 1), 180);
}

function navigateEmbeddedInsightView(view) {
    const safeView = JSON.stringify(String(view || 'triggers'));
    executeInsightScript(`(() => {
        if (window.InsightApp && typeof window.InsightApp.setViewMode === 'function') {
            window.InsightApp.setViewMode(${safeView});
            true;
        } else {
            false;
        }
    })();`);
}

function executeOplScript(script, attempts = 8) {
    const webview = document.getElementById('opl-hub-webview');
    if (webview && typeof webview.executeJavaScript === 'function') {
        webview.executeJavaScript(script, true).catch(() => {
            if (attempts > 0) setTimeout(() => executeOplScript(script, attempts - 1), 180);
        });
        return;
    }
    if (attempts > 0) setTimeout(() => executeOplScript(script, attempts - 1), 180);
}

function navigateOplHubView(view) {
    const safeView = JSON.stringify(String(view || 'opl_search'));
    executeOplScript(`(() => {
        if (window.App && typeof window.App.setView === 'function') {
            window.App.setView(${safeView});
            true;
        } else {
            false;
        }
    })();`);
}

function navigateScheduleStudio(options = {}, attempts = 8) {
    const frame = document.getElementById('schedule-studio-frame');
    const app = frame && frame.contentWindow && frame.contentWindow.App;
    if (app) {
        if (options.scheduleId && typeof app.setSchedule === 'function') app.setSchedule(String(options.scheduleId));
        if (options.view && typeof app.setView === 'function') app.setView(String(options.view));
        return;
    }
    if (attempts > 0) setTimeout(() => navigateScheduleStudio(options, attempts - 1), 180);
}

function navigateLiveBookingSchedule(id) {
    if (id) {
        try {
            ACTIVE_LIVE_SCHED_ID = String(id);
        } catch (error) {
            window.ACTIVE_LIVE_SCHED_ID = String(id);
        }
    }
    if (typeof renderLiveTable === 'function') renderLiveTable();
    setTimeout(() => {
        const section = document.querySelector('#live-assessment .sched-tabs-container') || document.getElementById('liveBookingBody');
        if (section && typeof section.scrollIntoView === 'function') section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
}

function navigateLiveBookingSection(view) {
    if (typeof renderLiveTable === 'function') renderLiveTable();
    setTimeout(() => {
        const selectors = {
            controls: '#liveBookingSearch',
            settings: '.live-schedule-config-card',
            rules: '.live-booking-rules-panel',
            grid: '#liveBookingBody'
        };
        const el = document.querySelector(selectors[view] || selectors.grid);
        if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
}

function setActiveNavigationTarget(id) {
    if (LAST_ACTIVE_NAV_BUTTON && LAST_ACTIVE_NAV_BUTTON.isConnected) {
        LAST_ACTIVE_NAV_BUTTON.classList.remove('active');
    } else {
        document.querySelectorAll('.nav-item.active').forEach(b => b.classList.remove('active'));
    }
    LAST_ACTIVE_NAV_BUTTON = null;
    if (CURRENT_USER && CURRENT_USER.role === 'trainee') return;
    const safeId = String(id || '');
    const escapedId = (window.CSS && typeof CSS.escape === 'function') ? CSS.escape(safeId) : safeId.replace(/"/g, '\\"');
    const sidebarBtn = document.querySelector(`button.nav-item[data-nav-target="${escapedId}"]`)
        || document.querySelector(`button.nav-item[onclick="showTab('${safeId.replace(/'/g, "\\'")}')"]`);
    if(sidebarBtn) {
        sidebarBtn.classList.add('active');
        LAST_ACTIVE_NAV_BUTTON = sidebarBtn;
    }
}

function renderAdvancedAdminNavigation(menu) {
    const items = getOrderedAdminNavigationItems();
    const featured = [];
    const compact = [];
    items.forEach((item, index) => {
        if (index < 6) featured.push({ ...item, featured: true });
        else compact.push(item);
    });
    menu.innerHTML = `
        <div class="nav-map">
            <div class="nav-map-primary">
                ${featured.map(buildAdvancedNavButton).join('')}
            </div>
            <div class="nav-map-grid">
                ${compact.map(buildAdvancedNavButton).join('')}
            </div>
        </div>
    `;
    document.body.classList.add('admin-nav-advanced');
    menu.dataset.navOrder = getAdminNavigationOrderSignature();
    bindAdvancedNavigationMapDrag(menu);
}

function bindAdvancedNavigationMapDrag(menu) {
    if (!menu) return;
    menu.querySelectorAll('.nav-map .nav-item-wrap').forEach(row => {
        row.addEventListener('dragstart', event => {
            if (event.target && event.target.closest('.nav-submenu-control, .nav-inline-submenu')) {
                event.preventDefault();
                return;
            }
            row.classList.add('nav-map-dragging');
            document.body.classList.add('nav-map-reordering');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', row.dataset.navId || '');
        });
        row.addEventListener('dragend', () => {
            row.classList.remove('nav-map-dragging');
            document.body.classList.remove('nav-map-reordering');
            menu.querySelectorAll('.nav-map-drop-target').forEach(item => item.classList.remove('nav-map-drop-target'));
        });
        row.addEventListener('dragover', event => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            row.classList.add('nav-map-drop-target');
        });
        row.addEventListener('dragleave', () => row.classList.remove('nav-map-drop-target'));
        row.addEventListener('drop', event => {
            event.preventDefault();
            row.classList.remove('nav-map-drop-target');
            const draggedId = event.dataTransfer.getData('text/plain');
            const targetId = row.dataset.navId || '';
            if (reorderAdminNavigationItem(draggedId, targetId)) {
                refreshAdvancedNavigationMap();
            }
        });
    });
}

function applyConfiguredNavigationView() {
    const menu = document.querySelector('.sidebar-menu');
    if (!menu) return;

    if (!window.__classicSidebarMenuHtml) {
        window.__classicSidebarMenuHtml = menu.innerHTML;
    }

    const selectedView = getStoredAdminNavigationView();
    const useAdvanced = selectedView === ADMIN_NAV_ADVANCED && canUseAdminNavigationView();
    const orderSignature = getAdminNavigationOrderSignature();

    if (useAdvanced) {
        if (menu.dataset.navView !== ADMIN_NAV_ADVANCED || menu.dataset.navOrder !== orderSignature) {
            renderAdvancedAdminNavigation(menu);
            menu.dataset.navView = ADMIN_NAV_ADVANCED;
        }
    } else if (menu.dataset.navView === ADMIN_NAV_ADVANCED) {
        menu.innerHTML = window.__classicSidebarMenuHtml;
        menu.dataset.navView = 'classic';
        document.body.classList.remove('admin-nav-advanced');
        const netBtn = document.getElementById('btn-sidebar-net-test');
        if (netBtn) {
            netBtn.onclick = () => {
                if (window.NetworkDiag && typeof NetworkDiag.openModal === 'function') NetworkDiag.openModal();
            };
        }
    } else {
        menu.dataset.navView = 'classic';
        document.body.classList.remove('admin-nav-advanced');
    }

    menu.querySelectorAll('button.nav-item').forEach(btn => {
        if (btn.dataset.navTarget) return;
        const raw = btn.getAttribute('onclick') || '';
        const match = raw.match(/showTab\(['"]([^'"]+)['"]/);
        if (match && match[1]) btn.dataset.navTarget = match[1];
    });
}

window.setAdminNavigationView = function(view) {
    const nextView = (view === ADMIN_NAV_ADVANCED || view === 'advanced-minimal') ? ADMIN_NAV_ADVANCED : 'classic';
    localStorage.setItem(ADMIN_NAV_VIEW_KEY, nextView);
    const localTheme = mainReadObject('local_theme_config');
    localTheme.navigationView = nextView;
    localStorage.setItem('local_theme_config', JSON.stringify(localTheme));
    applyConfiguredNavigationView();
    updateSidebarVisibility();
    const active = document.querySelector('section.active');
    if (active) {
        setActiveNavigationTarget(active.id);
    }
};

function renderNavigationCustomizerList() {
    const list = document.getElementById('navCustomizerList');
    if (!list) return;
    const items = getOrderedAdminNavigationItems();
    list.innerHTML = items.map((item, index) => `
        <div class="nav-customizer-row" draggable="true" data-nav-id="${escapeNavAttr(item.id)}">
            <div class="nav-customizer-handle" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></div>
            <div class="nav-customizer-icon"><i class="${escapeNavAttr(item.icon)}"></i></div>
            <div class="nav-customizer-name">
                <strong>${escapeNavAttr(item.text)}</strong>
                <span>${index < 6 ? 'Priority row' : 'Compact tile'}</span>
            </div>
        </div>
    `).join('');

    list.querySelectorAll('.nav-customizer-row').forEach(row => {
        row.addEventListener('dragstart', event => {
            row.classList.add('dragging');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', row.dataset.navId || '');
        });
        row.addEventListener('dragend', () => row.classList.remove('dragging'));
        row.addEventListener('dragover', event => event.preventDefault());
        row.addEventListener('drop', event => {
            event.preventDefault();
            const draggedId = event.dataTransfer.getData('text/plain');
            const targetId = row.dataset.navId || '';
            if (!draggedId || !targetId || draggedId === targetId) return;
            const ids = getOrderedAdminNavigationItems().map(item => item.id);
            const from = ids.indexOf(draggedId);
            const to = ids.indexOf(targetId);
            if (from < 0 || to < 0) return;
            ids.splice(to, 0, ids.splice(from, 1)[0]);
            saveAdminNavigationOrder(ids);
            renderNavigationCustomizerList();
        });
    });
}

window.moveNavigationCustomizerItem = function moveNavigationCustomizerItem(id, direction) {
    const ids = getOrderedAdminNavigationItems().map(item => item.id);
    const index = ids.indexOf(id);
    if (index < 0) return;
    if (direction === 'top') {
        ids.splice(0, 0, ids.splice(index, 1)[0]);
    } else if (direction === 'up' && index > 0) {
        [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    } else if (direction === 'down' && index < ids.length - 1) {
        [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]];
    }
    saveAdminNavigationOrder(ids);
    renderNavigationCustomizerList();
};

window.resetNavigationMapOrder = function resetNavigationMapOrder() {
    if (!confirm('Reset Navigation Map order to the default layout?')) return;
    localStorage.removeItem(ADMIN_NAV_ORDER_KEY);
    renderNavigationCustomizerList();
};

window.saveNavigationMapOrder = function saveNavigationMapOrder() {
    applyConfiguredNavigationView();
    refreshAdvancedNavigationMap();
    const active = document.querySelector('section.active');
    if (active) setActiveNavigationTarget(active.id);
    const modal = document.getElementById('navCustomizerModal');
    if (modal) modal.remove();
    if (typeof showToast === 'function') showToast('Navigation Map order saved.', 'success');
};

window.openNavigationMapCustomizer = function openNavigationMapCustomizer() {
    if (!canUseAdminNavigationView()) return;
    const existing = document.getElementById('navCustomizerModal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'navCustomizerModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-box nav-customizer-modal">
            <button class="modal-close" type="button" onclick="document.getElementById('navCustomizerModal').remove()">&times;</button>
            <h3>Customize Navigation Map</h3>
            <p class="nav-customizer-note">Drag destinations into your preferred order. The first six positions display as priority rows; the rest display as compact tiles.</p>
            <div id="navCustomizerList" class="nav-customizer-list"></div>
            <div class="nav-customizer-footer">
                <button type="button" class="btn-secondary" onclick="resetNavigationMapOrder()">Reset Order</button>
                <div style="flex:1"></div>
                <button type="button" class="btn-secondary" onclick="document.getElementById('navCustomizerModal').remove()">Cancel</button>
                <button type="button" class="btn-primary" onclick="saveNavigationMapOrder()">Save Layout</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    renderNavigationCustomizerList();
};

// --- SIDEBAR VISIBILITY LOGIC ---
function updateSidebarVisibility() {
    if (!CURRENT_USER) {
        document.body.classList.remove('trainee-runtime');
        return;
    }

    const role = CURRENT_USER.role;
    const isTraineeRuntimeSession = role === 'trainee';
    document.body.classList.toggle('trainee-runtime', isTraineeRuntimeSession);
    if (typeof ensureAppChildWindowChrome === 'function') ensureAppChildWindowChrome();
    applyConfiguredNavigationView();
    
    // --- DYNAMIC LABEL UPDATE ---
    // Rename the hardcoded button based on role
    const liveExecBtn = document.getElementById('btn-live-exec');
    if (liveExecBtn) {
        const span = liveExecBtn.querySelector('.nav-text');
        if (span) {
            span.innerText = (role === 'trainee') ? 'Take Live Assessment' : 'Live Session Arena';
        }
        liveExecBtn.setAttribute('title', (role === 'trainee') ? 'Take Live Assessment' : 'Live Session Arena');
    }

    const homeBtn = document.querySelector('.nav-item[onclick="showTab(\'dashboard-view\')"]');
    if (homeBtn) {
        const span = homeBtn.querySelector('.nav-text');
        if (span) span.innerText = (role === 'trainee') ? 'Trainee Portal' : 'Home';
        homeBtn.setAttribute('title', (role === 'trainee') ? 'Trainee Portal' : 'Home / Overview');
    }

    // --- INJECT SUPER ADMIN BUTTON ---
    // Moved outside the loop to ensure it runs reliably
    const existingSaBtn = document.getElementById('btn-super-admin');
    const existingPopoutBtn = document.getElementById('btn-popout-current-tab');
    
    // Force removal if not super admin
    if (role !== 'super_admin' && existingSaBtn) existingSaBtn.remove();
    if (role !== 'super_admin' && existingPopoutBtn) existingPopoutBtn.remove();

    if (role === 'super_admin') {
        // Robust Retry logic for header injection
        const injectBtn = () => {
            // INJECT SERVER INDICATOR
            const header = document.querySelector('.top-header .nav-brand');
            if (header && !document.getElementById('server-indicator')) {
                const activeTarget = localStorage.getItem('active_server_target') || 'cloud';
                const indicator = document.createElement('span');
                indicator.id = 'server-indicator';
                indicator.style.fontSize = '0.7rem';
                indicator.style.marginLeft = '10px';
                indicator.style.padding = '2px 6px';
                indicator.style.borderRadius = '4px';
                indicator.style.verticalAlign = 'middle';
                
                let label = '<i class="fas fa-cloud"></i> Cloud';
                let color = '#3498db';
                let bg = 'rgba(52, 152, 219, 0.2)';

                if (activeTarget === 'local') {
                    label = '<i class="fas fa-server"></i> Local';
                    color = '#9b59b6';
                    bg = 'rgba(155, 89, 182, 0.2)';
                } else if (activeTarget === 'staging') {
                    label = '<i class="fas fa-flask"></i> Staging';
                    color = '#f1c40f';
                    bg = 'rgba(241, 196, 15, 0.2)';
                }
                
                indicator.style.background = bg;
                indicator.style.color = color;
                indicator.innerHTML = label;
                header.appendChild(indicator);
            }

            const bubbleContent = document.querySelector('.control-bubble .bubble-content');
            const adminToolsBtn = document.getElementById('btn-admin-tools');
            
            if (bubbleContent) {
                if (!window.APP_CHILD_WINDOW_MODE && !document.getElementById('btn-popout-current-tab') && window.electronAPI?.appWindows?.open) {
                    const popBtn = document.createElement('button');
                    popBtn.id = 'btn-popout-current-tab';
                    popBtn.className = 'icon-btn';
                    popBtn.title = 'Open current tab in new window';
                    popBtn.innerHTML = '<i class="fas fa-up-right-from-square"></i>';
                    popBtn.onclick = (event) => openCurrentTabWindow(event);
                    const logoutBtn = bubbleContent.querySelector('.logout');
                    bubbleContent.insertBefore(popBtn, logoutBtn || null);
                }

                if (document.getElementById('btn-super-admin')) return true;

                const btn = document.createElement('button');
                btn.id = 'btn-super-admin';
                btn.className = 'icon-btn';
                btn.title = 'Super Admin Console';
                btn.innerHTML = '<i class="fas fa-user-astronaut"></i>';
                btn.onclick = function() { if(typeof openSuperAdminConfig === 'function') openSuperAdminConfig(); };
                
                // Insert after Admin Tools if present, otherwise prepend
                if (adminToolsBtn && adminToolsBtn.parentNode === bubbleContent) {
                    bubbleContent.insertBefore(btn, adminToolsBtn.nextSibling);
                } else {
                    bubbleContent.prepend(btn);
                }
                return true;
            }
            return false;
        };
        
        // Try immediately, then poll briefly to ensure it catches late DOM renders
        if (!injectBtn()) {
            let attempts = 0;
            const interval = setInterval(() => {
                attempts++;
                if (injectBtn() || attempts > 10) clearInterval(interval);
            }, 500);
        }
    }

    const allNavItems = document.querySelectorAll('.nav-item');

    allNavItems.forEach(btn => {
        // Reset first
        btn.classList.remove('hidden');
        
        if (isTraineeRuntimeSession) {
            btn.classList.add('hidden');
            return;
        }

        // Safety check for onclick attribute
        const clickAttr = btn.getAttribute('onclick');
        if (!clickAttr) return;

        const match = clickAttr.match(/'([^']+)'/);
        const targetTab = match ? match[1] : null;
        
        if (!targetTab) return;
        
        // --- DYNAMIC FEATURE FLAGS ---
        const config = mainReadObject('system_config');
        const features = config.features || {};

        if (features.live_assessments === false && (targetTab === 'live-assessment' || targetTab === 'live-execution')) {
            btn.classList.add('hidden');
            return;
        }
        if (features.vetting_arena === false && targetTab === 'vetting-arena') {
            btn.classList.add('hidden');
            return;
        }
        if (features.content_studio === false && targetTab === 'content-studio') {
            btn.classList.add('hidden');
            return;
        }

        if (targetTab === 'insight-studio' && !['admin', 'super_admin'].includes(role)) {
            btn.classList.add('hidden');
            return;
        }

        // OPL Hub is admin + super_admin only.
        if (targetTab === 'opl-hub' && !['admin', 'super_admin'].includes(role)) {
            btn.classList.add('hidden');
            return;
        }

        // Hide isolated super admin tools from everyone except Super Admin
        if (targetTab === 'superadmin-studio' && role !== 'super_admin') {
            btn.classList.add('hidden');
            return;
        }

        if (targetTab === 'first-line-troubleshooting' && !(typeof canAccessFirstLineTroubleshootingTool === 'function' && canAccessFirstLineTroubleshootingTool())) {
            btn.classList.add('hidden');
            return;
        }

        // Rules
        if (role === 'teamleader') {
            // Team Leaders hide Admin, Test Builder, My Tests, Live Assessment
            // NOTE: 'tl-hub' hidden temporarily while in development
            const hiddenForTL = ['test-manage', 'my-tests', 'study-notes', 'live-assessment', 'live-execution', 'insight-studio', 'manage', 'capture', 'tl-hub', 'superadmin-studio', 'content-studio', 'trainee-portal'];
            if (hiddenForTL.includes(targetTab)) btn.classList.add('hidden');
        }
        else if (role === 'admin') {
            // Admins hide "My Tests" (Take Test) usually, but we keep it visible for testing purposes
            if (targetTab === 'my-tests') btn.classList.add('hidden');
            if (targetTab === 'study-notes') btn.classList.add('hidden');
            if (targetTab === 'trainee-portal') btn.classList.add('hidden');
        } else {
            if (targetTab === 'study-notes') btn.classList.add('hidden');
            if (targetTab === 'trainee-portal') btn.classList.add('hidden');
        }
    });

    const updatesSubBtn = document.getElementById('btn-sub-updates');
    const toolHostingSubBtn = document.getElementById('btn-sub-tool-hosting');
    const canUseUpdateCenter = ['admin', 'super_admin'].includes(role);
    if (updatesSubBtn) {
        updatesSubBtn.classList.toggle('hidden', !canUseUpdateCenter);
    }
    if (toolHostingSubBtn) {
        toolHostingSubBtn.classList.toggle('hidden', !canUseUpdateCenter);
    }

    const updatesView = document.getElementById('admin-view-updates');
    const toolHostingView = document.getElementById('admin-view-tool-hosting');
    if (!canUseUpdateCenter && ((updatesView && updatesView.classList.contains('active')) || (toolHostingView && toolHostingView.classList.contains('active')))) {
        const fallbackBtn = document.getElementById('btn-sub-users');
        showAdminSub('users', fallbackBtn || null);
    }
}

window.APP_BOOT_MODE = window.APP_BOOT_MODE || null;

function normalizeBootRoleMode(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'trainee') return 'trainee';
    if (raw === 'admin' || raw === 'teamleader' || raw === 'super_admin' || raw === 'special_viewer') return 'admin';
    return '';
}

function deriveBootRoleFromUser(userObj) {
    if (!userObj || typeof userObj !== 'object') return '';
    const role = normalizeBootRoleMode(userObj.role || '');
    if (role) return role;
    const explicit = normalizeBootRoleMode(userObj.bootMode || '');
    if (explicit) return explicit;
    return '';
}

function deriveBootRoleFromRemembered() {
    try {
        const rememberedRaw = localStorage.getItem('rememberedUser');
        if (!rememberedRaw) return '';
        const remembered = (typeof safeParse === 'function') ? safeParse(rememberedRaw, null) : JSON.parse(rememberedRaw);
        if (!remembered || typeof remembered !== 'object') return '';

        const rememberedMode = normalizeBootRoleMode(remembered.bootMode || remembered.role || '');
        if (rememberedMode) return rememberedMode;

        const rememberedUser = String(remembered.user || '').trim().toLowerCase();
        if (!rememberedUser) return '';

        const users = mainReadArray('users');
        if (!users.length) return '';
        const hit = users.find(u => String(u && u.user || '').trim().toLowerCase() === rememberedUser);
        return hit ? normalizeBootRoleMode(hit.role || '') : '';
    } catch (e) {
        return '';
    }
}

function getStartupBootRoleMode() {
    const sessionChoice = normalizeBootRoleMode(sessionStorage.getItem('boot_role_selection') || '');
    if (sessionChoice) return sessionChoice;

    const remembered = deriveBootRoleFromRemembered();
    if (remembered) return remembered;

    return '';
}

function applyBootRoleUi(mode) {
    const gate = document.getElementById('boot-role-gate');
    const authPane = document.getElementById('login-auth-pane');
    const selectedHint = document.getElementById('boot-role-selected');
    const selectedHintText = document.getElementById('boot-role-selected-text');
    const switchBtn = document.getElementById('boot-role-switch-btn');
    const loginError = document.getElementById('loginError');
    const toggleWrap = document.querySelector('.login-toggle-wrapper');

    if (loginError) loginError.innerText = '';

    const normalized = normalizeBootRoleMode(mode);
    if (!normalized) {
        if (gate) gate.classList.remove('hidden');
        if (authPane) authPane.classList.add('hidden');
        if (selectedHint) selectedHint.classList.add('hidden');
        if (selectedHintText) selectedHintText.innerText = '';
        if (switchBtn) {
            switchBtn.classList.remove('hidden');
            switchBtn.disabled = false;
            switchBtn.title = 'Switch startup runtime';
        }
        if (toggleWrap) toggleWrap.classList.remove('hidden');
        return;
    }

    if (gate) gate.classList.add('hidden');
    if (authPane) authPane.classList.remove('hidden');

    if (selectedHint) {
        const label = normalized === 'trainee' ? 'Trainee Runtime' : 'Admin / Teamleader Runtime';
        if (selectedHintText) selectedHintText.innerText = `Runtime: ${label}`;
        else selectedHint.innerText = `Runtime: ${label}`;
        selectedHint.classList.remove('hidden');
    }

    let rememberedMode = '';
    try {
        const rememberedRaw = localStorage.getItem('rememberedUser');
        const remembered = rememberedRaw ? JSON.parse(rememberedRaw) : null;
        rememberedMode = normalizeBootRoleMode(remembered && (remembered.bootMode || remembered.role) || '');
    } catch (error) {
        rememberedMode = '';
    }
    const lockRuntimeSwitch = normalized === 'trainee' && rememberedMode === 'trainee';
    if (switchBtn) {
        switchBtn.classList.toggle('hidden', lockRuntimeSwitch);
        switchBtn.disabled = lockRuntimeSwitch;
        switchBtn.title = lockRuntimeSwitch
            ? 'Disable Remember Me to switch startup runtime'
            : 'Switch startup runtime';
    }

    if (normalized === 'trainee') {
        if (toggleWrap) toggleWrap.classList.add('hidden');
        if (typeof toggleLoginMode === 'function') toggleLoginMode('trainee');
    } else {
        if (toggleWrap) toggleWrap.classList.remove('hidden');
        if (typeof toggleLoginMode === 'function') toggleLoginMode('admin');
    }
}

window.selectBootRole = function selectBootRole(mode) {
    const normalized = normalizeBootRoleMode(mode);
    if (!normalized) return;

    sessionStorage.setItem('boot_role_selection', normalized);
    window.APP_BOOT_MODE = normalized;
    applyBootRoleUi(normalized);
    window.location.reload();
};

window.changeBootRoleSelection = function changeBootRoleSelection() {
    try {
        const rememberedRaw = localStorage.getItem('rememberedUser');
        if (rememberedRaw) {
            const remembered = JSON.parse(rememberedRaw);
            const rememberedMode = normalizeBootRoleMode(remembered && (remembered.bootMode || remembered.role) || '');
            if (rememberedMode === 'trainee') {
                const msg = 'Trainee runtime is locked while Remember Me is enabled. Untick Remember Me and sign in again to unlock runtime switching.';
                if (typeof showToast === 'function') showToast(msg, 'warning');
                else alert(msg);
                return;
            }
        }
    } catch (error) {}

    sessionStorage.removeItem('boot_role_selection');
    window.APP_BOOT_MODE = null;
    applyBootRoleUi('');
    const loader = document.getElementById('global-loader');
    if (loader) loader.classList.add('hidden');
};

let TAB_SWITCH_TIMEOUT = null;
let VIEW_SYNC_IN_FLIGHT = false;
let NAV_DEFER_TIMER = null;
let NAV_IDLE_CALLBACK = null;
let EMBEDDED_THEME_SYNC_TIMER = null;
let EMBEDDED_THEME_SYNC_IDLE = null;
let LAST_NAV_REQUEST = { id: null, at: 0 };
let LAST_ACTIVE_NAV_BUTTON = null;
let LAST_EMBEDDED_THEME_SIGNATURE = '';
const VIEW_SYNC_LAST_RUN = {};
const VIEW_RENDERED_ONCE = {};
const HIGH_PRIORITY_SYNC_VIEWS = new Set([
    'trainee-portal',
    'insight-studio',
    'qa-hub'
]);

const HEAVY_EMBEDDED_VIEWS = new Set([
    'insight-studio',
    'opl-hub',
    'assessment-studio',
    'content-studio',
    'tl-hub',
    'assessment-schedule',
    'superadmin-studio',
    'vetting-arena',
    'first-line-troubleshooting',
    'trainee-portal',
    'study-notes'
]);

const HEAVY_VIEW_LOADING_META = {
    'admin-panel': {
        target: '',
        icon: 'fa-screwdriver-wrench',
        title: 'Refreshing Admin Tools',
        detail: 'Reading users, access, system status, and configuration.'
    },
    'insight-studio': {
        target: 'insight-studio-content',
        icon: 'fa-magnifying-glass-chart',
        title: 'Building Insight workspace',
        detail: 'Refreshing integrity, assessment, and trainee signals.'
    },
    'live-assessment': {
        target: 'liveBookingBody',
        icon: 'fa-calendar-check',
        title: 'Synchronizing live bookings',
        detail: 'Checking booking layouts, trainer slots, and current sessions.',
        table: true,
        colspan: 5
    },
    'monthly': {
        target: 'monthlyTableMain',
        icon: 'fa-chart-line',
        title: 'Refreshing monthly data',
        detail: 'Pulling the latest records before rebuilding the reports.',
        tableBody: true,
        colspan: 8
    },
    'qa-hub': {
        target: 'qa-hub-content',
        icon: 'fa-circle-question',
        title: 'Refreshing Q&A Hub',
        detail: 'Loading the latest support and knowledge data.'
    },
    'test-manage': {
        target: 'testListAdmin',
        icon: 'fa-clipboard-check',
        title: 'Refreshing Test Engine',
        detail: 'Updating assessments, marking queues, history, and feedback sessions.'
    },
    'test-records': {
        target: 'testRecordsTable',
        icon: 'fa-folder-open',
        title: 'Refreshing test records',
        detail: 'Pulling assessment results and submission history.',
        tableBody: true,
        colspan: 7
    },
    'trainee-portal': {
        target: 'trainee-portal-content',
        icon: 'fa-user-graduate',
        title: 'Refreshing trainee portal',
        detail: 'Checking assigned assessments, live sessions, and study data.'
    }
};

function escapeAppLoadingText(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

window.getAppLoadingHtml = function getAppLoadingHtml(options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    const icon = escapeAppLoadingText(opts.icon || 'fa-circle-notch');
    const title = escapeAppLoadingText(opts.title || 'Loading workspace');
    const detail = escapeAppLoadingText(opts.detail || 'Fetching the latest data.');
    const phase = escapeAppLoadingText(opts.phase || '');
    const compact = opts.compact ? ' app-loading-card-compact' : '';
    const total = Math.max(Number(opts.progressTotal) || 0, 0);
    const done = Math.max(Math.min(Number(opts.progressDone) || 0, total || Number(opts.progressDone) || 0), 0);
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    const progress = total > 0
        ? `<div class="app-loading-progress" aria-hidden="true"><span style="width:${percent}%;"></span></div><div class="app-loading-count">${done}/${total} synced</div>`
        : `<div class="app-loading-progress app-loading-progress-indeterminate" aria-hidden="true"><span></span></div>`;

    return `
        <div class="app-loading-card${compact}" role="status" aria-live="polite">
            <div class="app-loading-spinner"><i class="fas ${icon}"></i></div>
            <div class="app-loading-copy">
                <strong>${title}</strong>
                <span>${detail}</span>
                ${phase ? `<small>${phase}</small>` : ''}
                ${progress}
            </div>
        </div>
    `;
};

window.showInlineLoading = function showInlineLoading(target, options = {}) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) return false;
    const opts = options && typeof options === 'object' ? options : {};
    const html = window.getAppLoadingHtml(opts);
    if (opts.table) {
        const colspan = Math.max(Number(opts.colspan) || 1, 1);
        el.innerHTML = `<tr class="app-loading-row"><td colspan="${colspan}">${html}</td></tr>`;
    } else {
        el.innerHTML = html;
    }
    return true;
};

function showRouteLoadingState(id, override = {}) {
    const meta = HEAVY_VIEW_LOADING_META[id];
    if (!meta || !meta.target || typeof window.showInlineLoading !== 'function') return false;
    let target = document.getElementById(meta.target);
    if (target && meta.tableBody) {
        target = target.tBodies && target.tBodies[0] ? target.tBodies[0] : target.querySelector('tbody');
    }
    if (!target) return false;
    return window.showInlineLoading(target, { ...meta, ...override, table: meta.table || meta.tableBody });
}

window.showAppBusyOverlay = function showAppBusyOverlay(options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    let overlay = document.getElementById('app-busy-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'app-busy-overlay';
        overlay.className = 'app-busy-overlay hidden';
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = window.getAppLoadingHtml({
        icon: opts.icon || 'fa-cloud-arrow-down',
        title: opts.title || 'Syncing workspace data',
        detail: opts.detail || 'Reading Supabase updates.',
        phase: opts.phase || '',
        progressDone: opts.progressDone,
        progressTotal: opts.progressTotal
    });
    overlay.classList.remove('hidden');
    return overlay;
};

window.updateAppBusyOverlay = function updateAppBusyOverlay(options = {}) {
    const overlay = document.getElementById('app-busy-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    window.showAppBusyOverlay(options);
};

window.hideAppBusyOverlay = function hideAppBusyOverlay() {
    const overlay = document.getElementById('app-busy-overlay');
    if (overlay) overlay.classList.add('hidden');
};

const TRAINEE_ALLOWED_TABS = new Set([
    'dashboard-view',
    'trainee-portal',
    'study-notes',
    'my-tests',
    'test-take-view',
    'assessment-studio-trainee',
    'assessment-schedule',
    'live-assessment',
    'live-execution',
    'vetting-arena'
]);

function normalizeVettingIdentity(value) {
    let v = String(value || '').trim().toLowerCase();
    if (!v) return '';
    if (v.includes('@')) v = v.split('@')[0];
    v = v.replace(/[._-]+/g, ' ');
    return v.replace(/\s+/g, ' ').trim();
}

function getTraineeVettingNotesGate() {
    if (!CURRENT_USER || CURRENT_USER.role !== 'trainee') {
        return { allowed: false, reason: 'Study Notes are available to trainee accounts only.', blocking: true };
    }

    let session = null;
    try {
        session = mainReadObject('vettingSession');
    } catch (error) {
        session = {};
    }

    if (!session || !session.active || !session.trainees || typeof session.trainees !== 'object') {
        return { allowed: true, reason: '', blocking: false, relaxed: false, activeVetting: false };
    }

    const currentUser = String((CURRENT_USER && CURRENT_USER.user) || '').trim();
    const wanted = normalizeVettingIdentity(currentUser);
    if (!wanted) {
        return { allowed: true, reason: '', blocking: false, relaxed: false, activeVetting: false };
    }

    const keys = Object.keys(session.trainees || {});
    const matchKey = keys.find(k => normalizeVettingIdentity(k) === wanted);
    if (!matchKey) {
        return { allowed: true, reason: '', blocking: false, relaxed: false, activeVetting: false };
    }

    const traineeData = session.trainees[matchKey] || {};
    const status = String(traineeData.status || '').trim().toLowerCase();
    const terminal = new Set(['completed', 'cancelled', 'closed', 'ended', 'submitted']);
    const activeVetting = !terminal.has(status);

    let forceGlobalKiosk = false;
    try {
        const cfg = mainReadObject('system_config');
        forceGlobalKiosk = !!(cfg && cfg.security && cfg.security.force_kiosk_global);
    } catch (error) {}

    const relaxed = !!traineeData.relaxed && !forceGlobalKiosk;
    const blocking = activeVetting && !relaxed;
    const reason = blocking
        ? 'Study Notes are locked during active Vetting unless security relax is enabled.'
        : '';

    return {
        allowed: !blocking,
        reason,
        blocking,
        relaxed,
        activeVetting,
        status
    };
}

window.canOpenStudyNotesNow = function canOpenStudyNotesNow(options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    const gate = getTraineeVettingNotesGate();

    if (!gate.allowed && !opts.silent && typeof showToast === 'function') {
        showToast(gate.reason || 'Study Notes are currently locked.', 'warning');
    }
    return gate;
};

window.enforceStudyNotesRestrictionNow = function enforceStudyNotesRestrictionNow(options = {}) {
    const gate = window.canOpenStudyNotesNow({ silent: true });
    if (gate.allowed) return gate;

    if (window.StudyMonitor && typeof window.StudyMonitor.enforceStudyNotesPolicy === 'function') {
        window.StudyMonitor.enforceStudyNotesPolicy({ silent: !!(options && options.silent) });
    }

    const active = document.querySelector('section.active');
    if (active && active.id === 'study-notes' && typeof showTab === 'function') {
        showTab('vetting-arena');
    }
    return gate;
};

window.openStudyNotesAssist = function openStudyNotesAssist(mode = 'tab') {
    const gate = window.canOpenStudyNotesNow({ silent: false });
    if (!gate.allowed) return false;

    const preferredMode = String(mode || 'tab').toLowerCase();
    if (preferredMode === 'popup') {
        if (window.StudyMonitor && typeof window.StudyMonitor.openStudyNotesPopout === 'function') {
            window.StudyMonitor.openStudyNotesPopout();
            return true;
        }
    }
    if (preferredMode === 'dock') {
        if (window.StudyMonitor && typeof window.StudyMonitor.toggleStudyNotesDock === 'function') {
            window.StudyMonitor.toggleStudyNotesDock(true);
            return true;
        }
    }

    if (typeof showTab === 'function') {
        showTab('study-notes');
        return true;
    }
    return false;
};

window.goWorkspaceHome = function goWorkspaceHome() {
    if (CURRENT_USER && CURRENT_USER.role === 'trainee') {
        if (typeof showTab === 'function') showTab('trainee-portal');
        return;
    }
    if (typeof showTab === 'function') showTab('dashboard-view');
};

function isHighPrioritySyncView(id) {
    return HIGH_PRIORITY_SYNC_VIEWS.has(String(id || ''));
}

function applyRealtimeFailoverProfile(id) {
    if (window.APP_PASSIVE_TAB_WINDOW) {
        window.__HIGH_PRIORITY_VIEW_SYNC = false;
        return;
    }
    const highPriority = isHighPrioritySyncView(id);
    window.__HIGH_PRIORITY_VIEW_SYNC = highPriority;

    const baseRate = Number(window.BASE_REALTIME_FAILURE_RATE || window.REALTIME_FAILURE_RATE || 15000);
    const targetRate = Math.max(5000, baseRate);
    if (window.REALTIME_FAILURE_RATE !== targetRate) {
        window.REALTIME_FAILURE_RATE = targetRate;
    }

    if (typeof setFallbackPollingRate === 'function' && window.CURRENT_FALLBACK_RATE > 0 && window.CURRENT_FALLBACK_RATE !== targetRate) {
        setFallbackPollingRate(targetRate);
    }
}

function renderAdminPanelSubViews() {
    const activeView = document.querySelector('#admin-panel .admin-view.active');
    const activeId = activeView ? String(activeView.id || '').replace(/^admin-view-/, '') : 'users';

    if (activeId === 'users' && typeof loadAdminUsers === 'function') loadAdminUsers();
    if (activeId === 'assessments' && typeof loadAdminAssessments === 'function') loadAdminAssessments();
    if (activeId === 'vetting' && typeof loadAdminVetting === 'function') loadAdminVetting();
    if (activeId === 'data' && typeof loadAdminDatabase === 'function') loadAdminDatabase();
    if (activeId === 'access' && typeof loadAdminAccess === 'function') loadAdminAccess();
    if (activeId === 'theme' && typeof loadAdminTheme === 'function') loadAdminTheme();

    const statusView = document.getElementById('admin-view-status');
    if (statusView && statusView.classList.contains('active') && typeof refreshSystemStatus === 'function') {
        refreshSystemStatus();
    }

    const gradView = document.getElementById('admin-view-graduated');
    if (gradView && gradView.classList.contains('active') && typeof loadGraduatedAgents === 'function') {
        loadGraduatedAgents();
    }

    const insightRulesView = document.getElementById('admin-view-insight-rules');
    if (insightRulesView && insightRulesView.classList.contains('active') && typeof loadAdminInsightRules === 'function') {
        loadAdminInsightRules();
    }
}

function renderVettingArenaByRole() {
    const isAdminVettingUser = CURRENT_USER && (
        CURRENT_USER.role === 'admin' ||
        CURRENT_USER.role === 'super_admin' ||
        CURRENT_USER.role === 'special_viewer'
    );

    if (isAdminVettingUser && typeof VettingReworkLoader !== 'undefined' && typeof VettingReworkLoader.renderUI === 'function') {
        VettingReworkLoader.renderUI('vetting-arena-content', { mode: 'production', title: 'Vetting Arena 2.0 Active' });
        return;
    }

    if (CURRENT_USER && CURRENT_USER.role === 'trainee' && window.VettingRuntimeV2 && typeof window.VettingRuntimeV2.loadTraineeArena === 'function') {
        window.VettingRuntimeV2.loadTraineeArena();
    }
}

function renderViewById(id, options = {}) {
    const source = String(options.source || 'switch');

    if (!id) return;
    const renderedBefore = !!VIEW_RENDERED_ONCE[id];
    if (source === 'switch' && renderedBefore && HEAVY_EMBEDDED_VIEWS.has(id)) {
        return;
    }
    if (source === 'switch') VIEW_RENDERED_ONCE[id] = true;

    if (source === 'freshPull') {
        if (id === 'assessment-schedule' && typeof ScheduleStudioLoader !== 'undefined' && typeof ScheduleStudioLoader.refresh === 'function') {
            ScheduleStudioLoader.refresh();
            return;
        }
        if (id === 'trainee-portal' && typeof TraineePortalLoader !== 'undefined' && typeof TraineePortalLoader.refresh === 'function') {
            TraineePortalLoader.refresh();
            return;
        }
        if (id === 'study-notes' && typeof StudyNotesWorkspace !== 'undefined' && typeof StudyNotesWorkspace.refresh === 'function') {
            StudyNotesWorkspace.refresh(false);
            return;
        }
        if (id === 'insight-studio') {
            return;
        }
        if (id === 'qa-hub' && window.QAHub && typeof window.QAHub.renderUI === 'function') {
            window.QAHub.renderUI();
            return;
        }
        if (id === 'assessment-studio' && typeof AssessmentStudioLoader !== 'undefined' && typeof AssessmentStudioLoader.renderUI === 'function') {
            AssessmentStudioLoader.renderUI();
            return;
        }
        if (id === 'assessment-studio-trainee' && typeof renderAssessmentStudioTraineeRuntime === 'function') {
            renderAssessmentStudioTraineeRuntime();
            return;
        }
        if (id === 'test-manage') {
            if (typeof loadManageTests === 'function') loadManageTests();
            if (typeof loadAssessmentDashboard === 'function') loadAssessmentDashboard();
            if (typeof loadMarkingQueue === 'function') loadMarkingQueue();
            return;
        }
        if (id === 'test-records' && typeof loadTestRecords === 'function') {
            loadTestRecords();
            return;
        }
        if (id === 'admin-panel' && typeof loadAdminUsers === 'function') {
            loadAdminUsers();
            return;
        }
        if (id === 'live-assessment' && typeof renderLiveTable === 'function') {
            renderLiveTable();
            return;
        }
        if (id === 'monthly' && typeof loadAllDataViews === 'function') {
            loadAllDataViews();
        }
        return;
    }

    if (source === 'hardRefresh') {
        if (id === 'dashboard-view') {
            if (typeof scheduleDashboardRender === 'function') scheduleDashboardRender({ immediate: true });
            else if (typeof renderDashboard === 'function') renderDashboard();
        }
        if (id === 'trainee-portal' && typeof TraineePortalLoader !== 'undefined' && typeof TraineePortalLoader.refresh === 'function') TraineePortalLoader.refresh();
        if (id === 'study-notes' && typeof StudyNotesWorkspace !== 'undefined' && typeof StudyNotesWorkspace.refresh === 'function') StudyNotesWorkspace.refresh(false);
        if (id === 'assessment-schedule' && typeof renderSchedule === 'function') renderSchedule();
        if (id === 'live-assessment' && typeof renderLiveTable === 'function') renderLiveTable();
        if (id === 'insight-studio' && typeof InsightStudioLoader !== 'undefined' && typeof InsightStudioLoader.refresh === 'function') InsightStudioLoader.refresh({ force: true });
        if (id === 'qa-hub' && window.QAHub && typeof window.QAHub.renderUI === 'function') window.QAHub.renderUI();
        if (id === 'assessment-studio' && typeof AssessmentStudioLoader !== 'undefined' && typeof AssessmentStudioLoader.renderUI === 'function') AssessmentStudioLoader.renderUI();
        if (id === 'assessment-studio-trainee' && typeof renderAssessmentStudioTraineeRuntime === 'function') renderAssessmentStudioTraineeRuntime();
        if (id === 'report-card' && typeof loadReportTab === 'function') loadReportTab();
        if (id === 'agent-search' && typeof loadAgentSearch === 'function') loadAgentSearch();
        if (id === 'admin-panel' && typeof loadAdminUsers === 'function') loadAdminUsers();
        if (id === 'vetting-arena') {
            const isAdminVettingUser = CURRENT_USER && (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin' || CURRENT_USER.role === 'special_viewer');
            if (CURRENT_USER && CURRENT_USER.role === 'trainee' && window.VettingRuntimeV2 && typeof window.VettingRuntimeV2.renderTraineeArena === 'function') {
                window.VettingRuntimeV2.renderTraineeArena();
            }
            if (isAdminVettingUser && typeof VettingReworkLoader !== 'undefined' && typeof VettingReworkLoader.renderUI === 'function') {
                VettingReworkLoader.renderUI('vetting-arena-content', { mode: 'production', title: 'Vetting Arena 2.0 Active' });
            }
        }
        return;
    }

    if (id === 'dashboard-view') {
        if (
            source === 'switch' &&
            typeof isDashboardRenderFresh === 'function' &&
            isDashboardRenderFresh(20000)
        ) {
            if (typeof updateDashboardHealth === 'function') {
                setTimeout(() => updateDashboardHealth(true), 80);
            }
            return;
        }
        if (typeof scheduleDashboardRender === 'function') scheduleDashboardRender({ delay: 40 });
        else if (typeof renderDashboard === 'function') setTimeout(renderDashboard, 0);
        return;
    }

    if (id === 'activity-monitor-view') {
        if (window.StudyMonitor && typeof renderActivityMonitorContent === 'function') {
            window.StudyMonitor.viewMode = 'summary';
            renderActivityMonitorContent();
        }
        return;
    }

    if (id === 'manage') {
        if (typeof loadRostersList === 'function') loadRostersList();
        if (typeof populateYearSelect === 'function') populateYearSelect();
        return;
    }

    if (id === 'capture') {
        if (typeof loadRostersToSelect === 'function') loadRostersToSelect('selectedGroup');
        if (typeof updateAssessmentDropdown === 'function') updateAssessmentDropdown();
        const dateInput = document.getElementById('captureDate');
        if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().split('T')[0];
        return;
    }

    if (id === 'monthly' && typeof loadAllDataViews === 'function') {
        loadAllDataViews();
        return;
    }

    if (id === 'report-card') {
        if (typeof loadReportTab === 'function') loadReportTab();
        if (CURRENT_USER && CURRENT_USER.role === 'teamleader') {
            setTimeout(() => {
                const btnCreate = document.getElementById('btn-rep-new');
                if (btnCreate) btnCreate.style.display = 'none';
                const btnSaved = document.getElementById('btn-rep-saved');
                if (btnSaved) btnSaved.click();
            }, 50);
        }
        return;
    }

    if (id === 'agent-search' && typeof loadAgentSearch === 'function') {
        loadAgentSearch();
        return;
    }

    if (id === 'tl-hub') {
        if (typeof TLTasks !== 'undefined' && typeof TLTasks.renderUI === 'function') {
            TLTasks.renderUI();
        } else {
            console.error('TLTasks module not loaded. Check js/tl_tasks.js');
        }
        return;
    }

    if (id === 'opl-hub') {
        if (typeof OPLHubLoader !== 'undefined' && typeof OPLHubLoader.renderUI === 'function') {
            OPLHubLoader.renderUI();
        } else {
            console.error('OPLHubLoader module not loaded. Check js/opl_hub_loader.js');
        }
        return;
    }

    if (id === 'assessment-studio') {
        if (typeof AssessmentStudioLoader !== 'undefined' && typeof AssessmentStudioLoader.renderUI === 'function') {
            AssessmentStudioLoader.renderUI();
        } else {
            console.error('AssessmentStudioLoader module not loaded. Check js/assessment_studio_loader.js');
        }
        return;
    }

    if (id === 'content-studio') {
        if (typeof ContentStudioLoader !== 'undefined' && typeof ContentStudioLoader.renderUI === 'function') {
            ContentStudioLoader.renderUI();
        } else {
            console.error('ContentStudioLoader module not loaded. Check js/content_studio_loader.js');
        }
        return;
    }

    if (id === 'qa-hub') {
        if (window.QAHub && typeof window.QAHub.renderUI === 'function') {
            window.QAHub.renderUI();
        } else {
            console.error('QAHub module not loaded. Check js/qa_hub.js');
        }
        return;
    }

    if (id === 'trainee-portal') {
        if (typeof TraineePortalLoader !== 'undefined' && typeof TraineePortalLoader.renderUI === 'function') {
            TraineePortalLoader.renderUI();
        }
        return;
    }

    if (id === 'insight-studio') {
        if (typeof InsightStudioLoader !== 'undefined' && typeof InsightStudioLoader.renderUI === 'function') {
            InsightStudioLoader.renderUI();
        } else {
            console.error('InsightStudioLoader module not loaded. Check js/insight_studio_loader.js');
        }
        return;
    }

    if (id === 'live-assessment' && typeof renderLiveTable === 'function') {
        renderLiveTable();
        return;
    }

    if (id === 'assessment-schedule' && typeof renderSchedule === 'function') {
        renderSchedule();
        return;
    }

    if (id === 'live-execution') {
        if (typeof loadLiveExecution === 'function') {
            loadLiveExecution();
        } else {
            setTimeout(() => {
                if (typeof loadLiveExecution === 'function') loadLiveExecution();
                else alert('Error: Live Execution script not loaded. Please refresh.');
            }, 500);
        }
        return;
    }

    if (id === 'admin-panel') {
        renderAdminPanelSubViews();
        return;
    }

    if (id === 'test-manage') {
        if (typeof loadManageTests === 'function') loadManageTests();
        if (typeof loadAssessmentDashboard === 'function') loadAssessmentDashboard();
        if (typeof loadMarkingQueue === 'function') loadMarkingQueue();
        return;
    }

    if (id === 'my-tests' && typeof loadTraineeTests === 'function') {
        loadTraineeTests();
        return;
    }

    if (id === 'assessment-studio-trainee' && typeof renderAssessmentStudioTraineeRuntime === 'function') {
        renderAssessmentStudioTraineeRuntime();
        return;
    }

    if (id === 'study-notes') {
        if (window.StudyNotesWorkspace && typeof window.StudyNotesWorkspace.renderUI === 'function') {
            window.StudyNotesWorkspace.renderUI();
        }
        return;
    }

    if (id === 'test-records' && typeof loadTestRecords === 'function') {
        loadTestRecords();
        return;
    }

    if (id === 'vetting-arena') {
        renderVettingArenaByRole();
        return;
    }

    if (id === 'superadmin-studio') {
        if (typeof SuperAdminDataStudioLoader !== 'undefined' && typeof SuperAdminDataStudioLoader.renderUI === 'function') {
            SuperAdminDataStudioLoader.renderUI();
        } else {
            console.error('SuperAdminDataStudioLoader module not loaded.');
        }
        return;
    }

    if (id === 'first-line-troubleshooting') {
        if (typeof FirstLineTroubleshootingLoader !== 'undefined' && typeof FirstLineTroubleshootingLoader.renderUI === 'function') {
            FirstLineTroubleshootingLoader.renderUI();
        } else {
            console.error('FirstLineTroubleshootingLoader module not loaded.');
        }
    }
}

function rerenderActiveViewAfterFreshPull(id) {
    const active = document.querySelector('section.active');
    if (!active || active.id !== id) return;
    renderViewById(id, { source: 'freshPull' });
}

function scheduleNavigationDeferredWork(id, target) {
    if (NAV_DEFER_TIMER) clearTimeout(NAV_DEFER_TIMER);
    if (NAV_IDLE_CALLBACK && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(NAV_IDLE_CALLBACK);
        NAV_IDLE_CALLBACK = null;
    }
    const run = () => {
        NAV_DEFER_TIMER = null;
        const idleWork = () => {
            NAV_DEFER_TIMER = null;
            NAV_IDLE_CALLBACK = null;
            if (target && target.isConnected && typeof applyResponsiveTableLabels === 'function') {
                applyResponsiveTableLabels(target);
            }
            if (typeof updateViewSyncIndicators === 'function') updateViewSyncIndicators();
            syncFreshDataForView(id);
        };

        if (typeof requestIdleCallback === 'function') {
            NAV_IDLE_CALLBACK = requestIdleCallback(idleWork, { timeout: 900 });
        } else {
            NAV_DEFER_TIMER = setTimeout(idleWork, 120);
        }
    };
    const delay = document.body && document.body.classList.contains('theme-one-ui') ? 220 : 90;
    NAV_DEFER_TIMER = setTimeout(run, delay);
}

async function syncFreshDataForView(id) {
    if (window.APP_PASSIVE_TAB_WINDOW) return;
    if (!isHighPrioritySyncView(id)) return;
    if (id === 'assessment-schedule') return;
    if (typeof loadFromServer !== 'function') return;

    const now = Date.now();
    const last = VIEW_SYNC_LAST_RUN[id] || 0;
    if (VIEW_SYNC_IN_FLIGHT || (now - last) < 30000) return;

    VIEW_SYNC_LAST_RUN[id] = now;
    VIEW_SYNC_IN_FLIGHT = true;
    try {
        if (id !== 'insight-studio' && id !== 'trainee-portal') {
            showRouteLoadingState(id, {
                title: (HEAVY_VIEW_LOADING_META[id] && HEAVY_VIEW_LOADING_META[id].title) || 'Refreshing workspace',
                detail: 'Pulling the latest server data before updating this view.'
            });
        }
        await loadFromServer(true);
        window._lastSuccessfulServerSyncAt = Date.now();
        localStorage.setItem('last_server_sync', String(window._lastSuccessfulServerSyncAt));
    } catch (error) {
        console.warn(`[View Sync] Fresh pull failed for ${id}:`, error);
    } finally {
        VIEW_SYNC_IN_FLIGHT = false;
        if (id === 'insight-studio' && typeof InsightStudioLoader !== 'undefined' && typeof InsightStudioLoader.softRefresh === 'function') {
            InsightStudioLoader.softRefresh();
        } else {
            rerenderActiveViewAfterFreshPull(id);
        }
        if (typeof updateViewSyncIndicators === 'function') updateViewSyncIndicators();
    }
}

function showTab(id, btn) {
  const navNow = Date.now();
  if (LAST_NAV_REQUEST.id === id && (navNow - LAST_NAV_REQUEST.at) < 180) return;
  LAST_NAV_REQUEST = { id, at: navNow };

  applyRealtimeFailoverProfile(id);

  // --- SYNC & REALTIME FLAGS ---
  // Reset one-time sync flags when navigating away from relevant tabs.
  if (id !== 'live-assessment' && window._liveSyncDone) {
      window._liveSyncDone = false;
  }

  // --- REALTIME CLEANUP ---
  // Unsubscribe from live schedule updates if we navigate away from that tab
  if (id !== 'live-assessment' && typeof LIVE_SCHEDULE_REALTIME_UNSUB === 'function' && LIVE_SCHEDULE_REALTIME_UNSUB) {
      try {
          LIVE_SCHEDULE_REALTIME_UNSUB();
          LIVE_SCHEDULE_REALTIME_UNSUB = null;
      } catch(e) {}
  }

  // --- TEAM LEADER RESTRICTIONS (Double Check) ---
  if(CURRENT_USER && CURRENT_USER.role === 'teamleader') {
      // Block specific tabs even if clicked somehow
      const forbidden = ['test-manage', 'my-tests', 'study-notes', 'trainee-portal', 'live-assessment', 'insight-studio', 'qa-hub', 'manage', 'capture', 'superadmin-studio', 'opl-hub', 'assessment-studio', 'content-studio'];
      if(forbidden.includes(id)) {
          return; // Simply do nothing
      }
  }

  if (CURRENT_USER && CURRENT_USER.role === 'trainee' && id === 'dashboard-view') {
      id = 'trainee-portal';
  }

  if (CURRENT_USER && CURRENT_USER.role === 'trainee' && !TRAINEE_ALLOWED_TABS.has(id)) {
      if (typeof showToast === 'function') {
          showToast("This area is not available in Trainee runtime.", "warning");
      }
      id = 'trainee-portal';
  }

  if (CURRENT_USER && CURRENT_USER.role !== 'trainee' && id === 'trainee-portal') {
      if (typeof showToast === 'function') {
          showToast("Trainee Portal is available to trainee sessions.", "warning");
      }
      return;
  }

  if (CURRENT_USER && CURRENT_USER.role !== 'trainee' && id === 'study-notes') {
      if (typeof showToast === 'function') {
          showToast("Study Notes workspace is available to trainees.", "warning");
      }
      return;
  }

  if (CURRENT_USER && CURRENT_USER.role === 'trainee' && id === 'study-notes') {
      const gate = (typeof window.canOpenStudyNotesNow === 'function')
          ? window.canOpenStudyNotesNow({ silent: false })
          : { allowed: true };
      if (!gate.allowed) return;
  }

  if (CURRENT_USER && !['admin', 'super_admin'].includes(CURRENT_USER.role) && id === 'opl-hub') {
      return;
  }

  if (CURRENT_USER && !['admin', 'super_admin'].includes(CURRENT_USER.role) && id === 'content-studio') {
      if (typeof showToast === 'function') {
          showToast("Access denied: Content Creator is restricted to Admin and Super Admin.", "error");
      }
      return;
  }

  if (CURRENT_USER && !['admin', 'super_admin'].includes(CURRENT_USER.role) && id === 'assessment-studio') {
      if (typeof showToast === 'function') {
          showToast("Access denied: Assessment Studio is restricted to Admin and Super Admin.", "error");
      }
      return;
  }

  if (CURRENT_USER && !['admin', 'super_admin'].includes(CURRENT_USER.role) && id === 'insight-studio') {
      if (typeof showToast === 'function') {
          showToast("Access denied: Insight is restricted to Admin and Super Admin.", "error");
      }
      return;
  }

  if (CURRENT_USER && !['admin', 'super_admin'].includes(CURRENT_USER.role) && id === 'qa-hub') {
      if (typeof showToast === 'function') {
          showToast("Access denied: Q&A Hub is restricted to Admin and Super Admin.", "error");
      }
      return;
  }

  if (CURRENT_USER && CURRENT_USER.role !== 'super_admin' && id === 'superadmin-studio') {
      return;
  }

  if (id === 'first-line-troubleshooting' && !(typeof canAccessFirstLineTroubleshootingTool === 'function' && canAccessFirstLineTroubleshootingTool())) {
      if (typeof showToast === 'function') {
          showToast("Access denied: Troubleshooting Tool is restricted to Jaco's Super Admin account.", "error");
      }
      return;
  }

  if (CURRENT_USER && CURRENT_USER.role === 'trainee' && id !== 'live-execution') {
      const liveSessions = mainReadArray('liveSessions');
      const currentUser = String(CURRENT_USER.user || '').trim().toLowerCase();
      const hasActiveLiveSession = Array.isArray(liveSessions) && liveSessions.some(s =>
          s &&
          s.active === true &&
          String(s.trainee || '').trim().toLowerCase() === currentUser
      );
      if (hasActiveLiveSession) {
          if (typeof showToast === 'function') {
              showToast("Live assessment is active. Complete it before leaving the arena.", "warning");
          }
          id = 'live-execution';
      }
  }

  if (CURRENT_USER && CURRENT_USER.role === 'trainee' && id !== 'vetting-arena') {
      const vettingGate = (typeof getTraineeVettingNotesGate === 'function')
          ? getTraineeVettingNotesGate()
          : { activeVetting: false, blocking: false };
      if (vettingGate && vettingGate.activeVetting && vettingGate.blocking) {
          if (typeof showToast === 'function') {
              showToast("Vetting Arena is active. Complete or wait for Admin to end the session before leaving.", "warning");
          }
          id = 'vetting-arena';
      }
  }
  
  // --- ROGUE TIMER PREVENTION ---
  // If we are leaving the test view, kill the active timer to prevent background auto-submits
  if (id !== 'test-take-view' && id !== 'vetting-arena' && window.TEST_TIMER) {
      clearInterval(window.TEST_TIMER);
  }

  if (CURRENT_USER && CURRENT_USER.role === 'trainee' && id === 'vetting-arena') {
      if (typeof window.enforceStudyNotesRestrictionNow === 'function') {
          window.enforceStudyNotesRestrictionNow({ silent: true });
      }
  }

  if (id !== 'vetting-arena' && typeof cleanupVettingArenaWatchers === 'function') {
      cleanupVettingArenaWatchers();
  }

  // Kill Live Arena Poller if leaving the tab
  if (id !== 'live-execution' && window.LIVE_POLLER) {
      clearInterval(window.LIVE_POLLER);
  }
  if (id !== 'live-execution' && window.LIVE_HARD_SYNC_LOOP) {
      clearInterval(window.LIVE_HARD_SYNC_LOOP);
      window.LIVE_HARD_SYNC_LOOP = null;
  }
  if (id !== 'trainee-portal' && typeof TraineePortalLoader !== 'undefined' && typeof TraineePortalLoader.stopAutoRefresh === 'function') {
      TraineePortalLoader.stopAutoRefresh();
  }
  if (id !== 'study-notes' && typeof StudyNotesWorkspace !== 'undefined' && typeof StudyNotesWorkspace.stopAutoRefresh === 'function') {
      StudyNotesWorkspace.stopAutoRefresh();
  }

  if (TAB_SWITCH_TIMEOUT) clearTimeout(TAB_SWITCH_TIMEOUT);

  const current = document.querySelector('section.active');
  if (current && current.id === 'insight-studio' && id !== 'insight-studio' && typeof InsightStudioLoader !== 'undefined' && typeof InsightStudioLoader.clearSessionCache === 'function') {
      InsightStudioLoader.clearSessionCache();
  }
  if (current && current.id === id) {
      if (id === 'insight-studio') {
          if (typeof updateViewSyncIndicators === 'function') updateViewSyncIndicators();
          return;
      }
      if (!window.APP_PASSIVE_TAB_WINDOW) syncFreshDataForView(id);
      if (typeof updateViewSyncIndicators === 'function') updateViewSyncIndicators();
      return;
  }

  const executeSwitch = () => {
      document.body.classList.add('route-transitioning');
      document.body.classList.add('nav-rendering');
      if (typeof refreshAdaptiveViewportLayout === 'function') {
          refreshAdaptiveViewportLayout();
      }

      if (current) {
          current.classList.remove('active');
          current.classList.remove('tab-exit-anim');
          current.classList.remove('tab-enter-anim');
      }
      
      const target = document.getElementById(id);
      if(target) {
          target.classList.add('active');
          target.classList.add('tab-enter-anim');
      }
      
      // Update Sidebar
      setActiveNavigationTarget(id);

      // --- ACTIVITY TRACKING ---
      if (!window.APP_PASSIVE_TAB_WINDOW && CURRENT_USER && CURRENT_USER.role === 'trainee' && typeof StudyMonitor !== 'undefined') {
          if (id === 'live-execution') {
              StudyMonitor.track('Live Assessment: Active');
          } else if (id === 'vetting-arena') {
              StudyMonitor.track('Vetting Arena: Security Check');
          } else {
              StudyMonitor.track(`Portal Navigation: ${id.replace(/-/g, ' ')}`);
          }
      }

      // --- DYNAMIC DATA REFRESH ---
      renderViewById(id, { source: 'switch' });
      scheduleNavigationDeferredWork(id, target || document.getElementById(id) || document);

      setTimeout(() => {
          if (target) target.querySelectorAll('textarea.auto-expand').forEach(el => autoResize(el));
          if (target) target.classList.remove('tab-enter-anim');
          document.body.classList.remove('route-transitioning');
          document.body.classList.remove('nav-rendering');
      }, 160);
  };

  if (current && !document.body.classList.contains('theme-one-ui')) {
      current.classList.add('tab-exit-anim');
      TAB_SWITCH_TIMEOUT = setTimeout(executeSwitch, 120);
  } else {
      executeSwitch();
  }
}

function showAdminSub(viewName, btn) {
  if (viewName === 'updates' && CURRENT_USER && !['admin', 'super_admin'].includes(CURRENT_USER.role)) {
      if (typeof showToast === 'function') showToast('Update Center is available to Admin and Super Admin only.', 'warning');
      return;
  }
  if (viewName === 'insight-rules' && CURRENT_USER && !['admin', 'super_admin'].includes(CURRENT_USER.role)) {
      if (typeof showToast === 'function') showToast('Insight trigger presets are available to Admin and Super Admin only.', 'warning');
      return;
  }
  if (viewName === 'tool-hosting' && CURRENT_USER && !['admin', 'super_admin'].includes(CURRENT_USER.role)) {
      if (typeof showToast === 'function') showToast('Tool Hosting is available to Admin and Super Admin only.', 'warning');
      return;
  }

  document.querySelectorAll('.admin-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('admin-view-' + viewName).classList.add('active');
  if(btn) btn.classList.add('active');
  
  // Trigger specific refresh for sub-tabs
  if(viewName === 'users' && typeof loadAdminUsers === 'function') loadAdminUsers();
  if(viewName === 'assessments' && typeof loadAdminAssessments === 'function') loadAdminAssessments();
  if(viewName === 'vetting' && typeof loadAdminVetting === 'function') loadAdminVetting();
  if(viewName === 'data' && typeof loadAdminDatabase === 'function') loadAdminDatabase();
  if(viewName === 'access' && typeof loadAdminAccess === 'function') loadAdminAccess();
  if(viewName === 'theme' && typeof loadAdminTheme === 'function') loadAdminTheme();
  if(viewName === 'status' && typeof refreshSystemStatus === 'function') {
      refreshSystemStatus();
  }
  if(viewName === 'insight-rules' && typeof loadAdminInsightRules === 'function') {
      loadAdminInsightRules();
  }
  if(viewName === 'updates' && typeof loadAdminUpdates === 'function') {
      loadAdminUpdates();
  }
  if(viewName === 'tool-hosting' && typeof loadHostedHtmlTool === 'function') {
      loadHostedHtmlTool();
  }
  if(viewName === 'attendance' && typeof loadAttendanceDashboard === 'function') {
      loadAttendanceDashboard();
  }
  if((viewName === 'graduates' || viewName === 'graduated') && typeof loadGraduatedAgents === 'function') {
      loadGraduatedAgents();
  }
}

/* ================= HEADER BUTTONS ================= */

let _isHardRefreshRunning = false;

async function flushEmbeddedRuntimeQueues() {
    // Trainee Vetting 2.0 bridge queue (host runtime)
    if (window.VettingRuntimeV2 && typeof window.VettingRuntimeV2.flushNow === 'function') {
        try { await window.VettingRuntimeV2.flushNow(); } catch (e) {}
    }

    // Admin Vetting 2.0 module queue (isolated webview runtime)
    const vettingWebview = document.querySelector('#vetting-arena-content .vetting-arena-webview');
    if (vettingWebview && typeof vettingWebview.executeJavaScript === 'function') {
        try {
            await vettingWebview.executeJavaScript(`
                (async () => {
                    try {
                        if (window.DataService && typeof window.DataService.flushPendingOps === 'function') {
                            await window.DataService.flushPendingOps();
                        }
                        if (window.DataService && typeof window.DataService.pollSessions === 'function') {
                            await window.DataService.pollSessions();
                        }
                        return true;
                    } catch (e) {
                        return false;
                    }
                })();
            `, true);
        } catch (e) {}
    }
}

function clearSyncTimestampsForFreshPull() {
    Object.keys(localStorage).forEach(k => {
        if (k.startsWith('sync_ts_') || k.startsWith('row_sync_ts_')) {
            localStorage.removeItem(k);
        }
    });
}

async function refreshApp() {
    if (_isHardRefreshRunning) return;
    if (window.APP_PASSIVE_TAB_WINDOW) {
        if (typeof showToast === 'function') {
            showToast('This is a passive popout view. Run full refresh from the main app window.', 'info');
        }
        return;
    }
    _isHardRefreshRunning = true;

    const refreshBtn =
        document.getElementById('btn-runtime-refresh') ||
        document.querySelector('[data-action="refresh-app"]') ||
        document.querySelector('button.icon-btn[onclick="refreshApp()"]') ||
        document.querySelector('.icon-btn[title="Refresh"]');
    const icon = refreshBtn ? refreshBtn.querySelector('i') : null;
    if (icon) icon.classList.add('fa-spin');

    try {
        if (typeof showToast === 'function') showToast('Running full sync refresh...', 'info');

        // 1) Flush queued local writes first.
        if (typeof saveToServer === 'function') {
            await saveToServer('FLUSH', false, true);
        }
        if (typeof processPendingDeletes === 'function') {
            await processPendingDeletes();
        }
        await flushEmbeddedRuntimeQueues();

        // 2) Force fresh pull from Supabase for all sections by clearing sync timestamps.
        clearSyncTimestampsForFreshPull();
        if (typeof loadFromServer === 'function') {
            await loadFromServer(false);
        }

        // 3) Refresh major module surfaces.
        if (typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
        if (typeof ScheduleStudioLoader !== 'undefined' && typeof ScheduleStudioLoader.refresh === 'function') {
            ScheduleStudioLoader.refresh();
        }
        if (typeof updateNotifications === 'function') updateNotifications();

        const active = document.querySelector('section.active');
        if (active) renderViewById(active.id, { source: 'hardRefresh' });

        if (typeof showToast === 'function') showToast('Full refresh completed. Latest cloud data loaded.', 'success');
    } catch (e) {
        console.error('Hard refresh failed:', e);
        if (typeof showToast === 'function') showToast('Refresh failed. Please retry.', 'error');
    } finally {
        if (icon) icon.classList.remove('fa-spin');
        _isHardRefreshRunning = false;
    }
}

// triggerUpdateCheck removed - moved to admin_updates.js

function restartAndInstall() {
    try {
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('restart-app');
    } catch(e) {
        console.error("Restart failed:", e);
    }
}

function triggerForceRestart() {
    try {
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('force-restart');
    } catch(e) { location.reload(); }
}

function toggleTheme() {
    document.body.classList.add('theme-transitioning');
    document.body.classList.toggle('light-mode');
    // Save preference
    const isLight = document.body.classList.contains('light-mode');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    if (document.body.classList.contains('theme-one-ui') && typeof applyOneUiThemeVariables === 'function') {
        applyOneUiThemeVariables(getStoredLocalThemeConfig());
    }
    if (typeof scheduleEmbeddedThemeSync === 'function') scheduleEmbeddedThemeSync({ delay: 80 });
    setTimeout(() => document.body.classList.remove('theme-transitioning'), 280);
}

/* ================= NOTIFICATIONS ================= */
function toggleNotifications() {
    const drop = document.getElementById('notificationDropdown');
    drop.classList.toggle('hidden');
    if(!drop.classList.contains('hidden')) updateNotifications();
}

function getLocalProblemReportCount() {
    let rawReports = [];
    try {
        rawReports = mainReadArray('error_reports');
    } catch (err) {
        rawReports = [];
    }

    return (Array.isArray(rawReports) ? rawReports : []).filter(entry => {
        const report = entry && entry.data && typeof entry.data === 'object' ? entry.data : entry;
        if (!report || typeof report !== 'object') return false;
        const type = String(report.type || report.reportType || '').toLowerCase();
        const source = String(report.source || report.origin || '').toLowerCase();
        return type === 'user_report' || source === 'report_problem' || !!report.issueDetail;
    }).length;
}

function getAdminCourseRequestNotifications() {
    if (!CURRENT_USER || !['admin', 'super_admin'].includes(String(CURRENT_USER.role || '').toLowerCase())) return [];
    let rows = [];
    try {
        rows = mainReadArray('admin_notifications');
    } catch (error) {
        rows = [];
    }
    return (Array.isArray(rows) ? rows : [])
        .filter(row => row && String(row.type || '') === 'course_progress_request')
        .filter(row => {
            const roles = Array.isArray(row.targetRoles) ? row.targetRoles.map(role => String(role || '').toLowerCase()) : ['admin', 'super_admin'];
            return roles.includes(String(CURRENT_USER.role || '').toLowerCase());
        })
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function getAdminAssessmentFeedbackNotifications() {
    if (!CURRENT_USER || !['admin', 'super_admin'].includes(String(CURRENT_USER.role || '').toLowerCase())) return [];
    let rows = [];
    try {
        rows = mainReadArray('admin_notifications');
    } catch (error) {
        rows = [];
    }
    return (Array.isArray(rows) ? rows : [])
        .filter(row => row && String(row.type || '') === 'assessment_feedback_request')
        .filter(row => String(row.status || 'open') !== 'closed')
        .filter(row => {
            const roles = Array.isArray(row.targetRoles) ? row.targetRoles.map(role => String(role || '').toLowerCase()) : ['admin', 'super_admin'];
            return roles.includes(String(CURRENT_USER.role || '').toLowerCase());
        })
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function markAdminAssessmentFeedbackNotificationsSeen() {
    const latest = getAdminAssessmentFeedbackNotifications()[0];
    if (latest && latest.createdAt) {
        localStorage.setItem('last_seen_assessment_feedback_notification_at', String(latest.createdAt));
    }
    updateNotifications();
}

function markAdminCourseRequestNotificationsSeen() {
    const latest = getAdminCourseRequestNotifications()[0];
    if (latest && latest.createdAt) {
        localStorage.setItem('last_seen_course_request_notification_at', String(latest.createdAt));
    }
    updateNotifications();
}

function safeNotificationText(value) {
    return (typeof escapeHTML === 'function')
        ? escapeHTML(value)
        : String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function updateNotifications() {
    const notifList = document.getElementById('notifList');
    const badge = document.getElementById('notifBadge');
    if(!notifList || !badge) return; // Safety check

    notifList.innerHTML = '';
    let count = 0;

    // 1. SYSTEM UPDATE NOTIFICATION (Global for all roles)
    if (sessionStorage.getItem('update_ready') === 'true') {
        const isOptionalReady = isCurrentUserUpdateOptional();
        count++;
        notifList.innerHTML += `
        <div class="notif-item" onclick="restartAndInstall()" style="background:rgba(46, 204, 113, 0.1); border-left:3px solid #2ecc71; cursor:pointer;">
            <div style="display:flex; align-items:center; gap:10px;">
                <i class="fas fa-arrow-circle-up" style="color:#2ecc71; font-size:1.2rem;"></i>
                <div>
                    <strong>Update Ready</strong>
                    <div style="font-size:0.8rem; color:var(--text-muted);">${isOptionalReady ? 'Install when your work is at a safe stopping point' : 'Click to restart and install'}</div>
                </div>
            </div>
        </div>`;
    }

    // 2. TRAINEE SPECIFIC NOTIFICATIONS
    if (CURRENT_USER && CURRENT_USER.role === 'trainee') {
        // --- PROGRESS LOGIC ---
        const safeRecords = mainReadArray('records');
        const currentRecords = (typeof filterRowsToCurrentTraineeLifecycle === 'function')
            ? filterRowsToCurrentTraineeLifecycle(safeRecords)
            : safeRecords;
        const myRecords = currentRecords.filter(r => r.trainee === CURRENT_USER.user);
        
        let progress = 0;
        if (typeof calculateAgentStats === 'function') {
            const stats = calculateAgentStats(CURRENT_USER.user, myRecords);
            progress = stats.progress;
        }

        notifList.innerHTML += `
            <div class="notif-item" style="background:var(--bg-input); border-left:3px solid var(--primary); cursor:default;" aria-label="Training Progress Notification">
                <strong>Training Progress</strong>
                <div style="margin-top:5px; height:6px; background:#444; border-radius:3px;">
                    <div style="width:${progress}%; background:var(--primary); height:100%; border-radius:3px; transition:width 0.5s;"></div>
                </div>
                <div style="font-size:0.8rem; margin-top:3px; text-align:right; color:var(--text-muted);">${progress}% Complete</div>
            </div>`;

        // --- LIVE ASSESSMENT UPDATES ---
        const myBookings = mainReadArray('liveBookings').filter(b => b.trainee === CURRENT_USER.user);
        
        myBookings.forEach(b => {
            if(b.status === 'Completed') {
                count++;
                notifList.innerHTML += `
                <div class="notif-item" onclick="showTab('live-assessment')" aria-label="Assessment Completed: ${b.assessment}">
                    <i class="fas fa-check-circle" style="color:#2ecc71;"></i> 
                    Live Assessment <strong>${b.assessment}</strong> marked Complete.
                </div>`;
            }
        });

        // Trigger Invasive Popup Check
        if (typeof checkUrgentNoticesPopup === 'function') {
            checkUrgentNoticesPopup();
        }
    }

    // 3. SUPER ADMIN PROBLEM REPORT NOTIFICATIONS
    if (CURRENT_USER && CURRENT_USER.role === 'super_admin') {
        const problemReportCount = getLocalProblemReportCount();
        const seenProblemReports = parseInt(localStorage.getItem('last_seen_problem_report_count') || '0', 10) || 0;
        const newProblemReports = Math.max(0, problemReportCount - seenProblemReports);

        if (newProblemReports > 0) {
            count += newProblemReports;
            notifList.innerHTML += `
            <div class="notif-item" onclick="viewProblemReports()" style="border-left:3px solid #ff6b6b;" aria-label="${newProblemReports} new problem reports">
                <i class="fas fa-question-circle" style="color:#ff6b6b;"></i>
                <strong>${newProblemReports} New Problem Report${newProblemReports === 1 ? '' : 's'}</strong>
                <div style="font-size:0.8rem; color:var(--text-muted); margin-top:3px;">Open Problem Reports to review.</div>
            </div>`;
        }
    }

    // 4. ACTIVITY VIOLATION REVIEW NOTIFICATIONS
    if (CURRENT_USER && ['super_admin', 'admin', 'teamleader'].includes(String(CURRENT_USER.role || '').toLowerCase())) {
        const pendingViolations = (typeof StudyMonitor !== 'undefined' && StudyMonitor.getPendingViolationReviewCount)
            ? StudyMonitor.getPendingViolationReviewCount()
            : mainReadArray('violation_reports').filter(r => r && !r.reviewed && String(r.status || 'pending_review') !== 'reviewed').length;

        if (pendingViolations > 0) {
            count += pendingViolations;
            notifList.innerHTML += `
            <div class="notif-item" onclick="StudyMonitor.openViolationReviewModal()" style="border-left:3px solid #ff5252;" aria-label="${pendingViolations} pending violation reviews">
                <i class="fas fa-triangle-exclamation" style="color:#ff5252;"></i>
                <strong>${pendingViolations} Violation Review${pendingViolations === 1 ? '' : 's'}</strong>
                <div style="font-size:0.8rem; color:var(--text-muted); margin-top:3px;">Open Activity Monitor violation review.</div>
            </div>`;
        }
    }

    // 5. COURSE MOVE-ON REQUEST NOTIFICATIONS
    if (CURRENT_USER && ['super_admin', 'admin'].includes(String(CURRENT_USER.role || '').toLowerCase())) {
        const courseRequests = getAdminCourseRequestNotifications();
        const lastSeenAt = String(localStorage.getItem('last_seen_course_request_notification_at') || '');
        const newRequests = courseRequests.filter(row => !lastSeenAt || String(row.createdAt || '') > lastSeenAt);

        if (newRequests.length > 0) {
            count += newRequests.length;
            const latest = newRequests[0];
            notifList.innerHTML += `
            <div class="notif-item" onclick="markAdminCourseRequestNotificationsSeen(); showTab('assessment-schedule');" style="border-left:3px solid #3498db;" aria-label="${newRequests.length} course move-on requests">
                <i class="fas fa-arrow-right" style="color:#3498db;"></i>
                <strong>${newRequests.length} Course Move-On Request${newRequests.length === 1 ? '' : 's'}</strong>
                <div style="font-size:0.8rem; color:var(--text-muted); margin-top:3px;">${safeNotificationText(latest.message || 'A trainee submitted a course move-on request.')}</div>
            </div>`;
        }
    }

    // 6. ASSESSMENT FEEDBACK REQUEST NOTIFICATIONS
    if (CURRENT_USER && ['super_admin', 'admin'].includes(String(CURRENT_USER.role || '').toLowerCase())) {
        const feedbackRequests = getAdminAssessmentFeedbackNotifications();
        const lastSeenAt = String(localStorage.getItem('last_seen_assessment_feedback_notification_at') || '');
        const newRequests = feedbackRequests.filter(row => !lastSeenAt || String(row.createdAt || '') > lastSeenAt);

        if (newRequests.length > 0) {
            count += newRequests.length;
            const latest = newRequests[0];
            notifList.innerHTML += `
            <div class="notif-item" onclick="markAdminAssessmentFeedbackNotificationsSeen(); if (typeof openAssessmentFeedbackSessions === 'function') openAssessmentFeedbackSessions(); else showTab('test-manage');" style="border-left:3px solid var(--primary);" aria-label="${newRequests.length} assessment feedback requests">
                <i class="fas fa-comments" style="color:var(--primary);"></i>
                <strong>${newRequests.length} Feedback Request${newRequests.length === 1 ? '' : 's'}</strong>
                <div style="font-size:0.8rem; color:var(--text-muted); margin-top:3px;">${safeNotificationText(latest.message || 'A trainee requested assessment feedback.')}</div>
            </div>`;
        }
    }

    // 7. EMPTY STATE
    if (notifList.innerHTML === '') {
        notifList.innerHTML = '<div style="padding:15px; text-align:center; color:#888;">No new notifications</div>';
    }

    if (count > 0) {
        badge.innerText = count;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

// --- FETCH RECORDS FILTER POPULATION ---
function populateFetchFilters() {
    const select = document.getElementById('filterAssessment');
    if(!select) return;
    
    const currentVal = select.value;
    const assessments = mainReadArray('assessments');
    const records = mainReadArray('records');
    
    // Combine names from Definitions and actual Records (history)
    const names = new Set();
    (Array.isArray(assessments) ? assessments : []).forEach(a => names.add(a.name));
    (Array.isArray(records) ? records : []).forEach(r => { if(r.assessment) names.add(r.assessment); });
    
    const sortedNames = Array.from(names).sort();
    
    select.innerHTML = '<option value="">None</option>';
    sortedNames.forEach(n => {
        select.add(new Option(n, n));
    });
    
    if(currentVal && names.has(currentVal)) select.value = currentVal;
}

// --- GLOBAL UTILS ---
function autoResize(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
}

/* ================= UI UTILS ================= */
function getTableStateHtml(type = 'empty', title = 'No data found.', detail = '', icon = null) {
    const state = ['loading', 'error', 'empty'].includes(type) ? type : 'empty';
    const defaultIcon = state === 'loading' ? 'fa-circle-notch' : state === 'error' ? 'fa-triangle-exclamation' : 'fa-inbox';
    const safeTitle = (typeof escapeHTML === 'function') ? escapeHTML(title) : String(title || '');
    const safeDetail = (typeof escapeHTML === 'function') ? escapeHTML(detail) : String(detail || '');
    return `<div class="table-state ${state}"><i class="fas ${icon || defaultIcon}"></i><strong>${safeTitle}</strong>${safeDetail ? `<span>${safeDetail}</span>` : ''}</div>`;
}

function setTableState(tbodyOrSelector, colspan, type, title, detail, icon = null) {
    const body = typeof tbodyOrSelector === 'string' ? document.querySelector(tbodyOrSelector) : tbodyOrSelector;
    if (!body) return;
    body.innerHTML = `<tr><td colspan="${Number(colspan) || 1}">${getTableStateHtml(type, title, detail, icon)}</td></tr>`;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
            <i class="${type === 'success' ? 'fas fa-check-circle' : (type === 'error' ? 'fas fa-exclamation-circle' : 'fas fa-info-circle')}"></i>
            <span>${message}</span>
        </div>
        <div class="toast-progress"></div>
    `;

    container.appendChild(toast);

    // Trigger progress bar
    setTimeout(() => { const bar = toast.querySelector('.toast-progress'); if(bar) bar.style.width = '0%'; }, 50);

    // Remove after 3 seconds
    setTimeout(() => {
        toast.style.opacity = '0'; toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function isCurrentUserUpdateOptional() {
    const role = String(CURRENT_USER && CURRENT_USER.role || '').toLowerCase();
    return role === 'admin' || role === 'super_admin';
}

// --- GLOBAL UPDATE LISTENERS ---
if (typeof require !== 'undefined') {
    const { ipcRenderer } = require('electron');

    ipcRenderer.on('update-message', (event, message) => {
        // Notify when an update is found and starting download
        if (message.text && message.text.includes('Update available')) {
            if(typeof showToast === 'function') showToast("New update found! Downloading...", "info");
        }
    });

    ipcRenderer.on('update-downloaded', () => {
        window.UPDATE_DOWNLOADED = true;
        
        // NEW: Set flag for notification bell
        sessionStorage.setItem('update_ready', 'true');
        if(typeof updateNotifications === 'function') updateNotifications();

        if (CURRENT_USER && isCurrentUserUpdateOptional()) {
            sessionStorage.removeItem('force_update_active');
            if (typeof showToast === 'function') showToast("Update downloaded. Install from Notifications when you reach a safe stopping point.", "info");
            return;
        }

        // 1. IF LOGGED IN: INTRUSIVE MODAL
        if (CURRENT_USER) {
            // ASSESSMENT PROTECTION LOCK: Do not interrupt active tests
            const isTakingTest = (
                document.getElementById('test-take-view')?.classList.contains('active') ||
                document.getElementById('vetting-arena')?.classList.contains('active') ||
                (document.getElementById('live-execution')?.classList.contains('active') && CURRENT_USER.role === 'trainee')
            );

            if (isTakingTest) {
                if (typeof showToast === 'function') showToast("System update downloaded. Please restart after completing your assessment.", "warning");
            } else {
            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            modal.style.zIndex = '10000';
            modal.style.background = 'rgba(0,0,0,0.9)'; // Darker background
            modal.innerHTML = `
                <div class="modal-box" style="text-align:center; border-left:5px solid #2ecc71; max-width:500px;">
                    <i class="fas fa-arrow-circle-up" style="font-size:4rem; color:#2ecc71; margin-bottom:20px;"></i>
                    <h2 style="margin-top:0;">Update Ready</h2>
                    <p style="font-size:1.1rem; margin-bottom:20px;">A new version of the application has been downloaded.</p>
                    
                    <div style="background:var(--bg-input); padding:15px; border-radius:8px; text-align:left; margin-bottom:25px; border:1px solid var(--border-color);">
                        <strong style="color:var(--primary);">Don't Worry!</strong>
                        <ul style="margin:10px 0 0 20px; color:var(--text-muted);">
                            <li>Your current progress (Assessments, Vetting) will be saved.</li>
                            <li>The app will restart automatically.</li>
                            <li>You will be logged back in exactly where you left off.</li>
                        </ul>
                    </div>

                    <button class="btn-success btn-lg" onclick="performUpdateRestart()" style="width:100%; font-weight:bold; padding:15px;">
                        <i class="fas fa-save"></i> Save State & Restart
                    </button>
                </div>
            `;
            document.body.appendChild(modal);
            }
        } 
        // 2. IF LOGIN SCREEN: BLOCK LOGIN
        else {
            const loginBtn = document.querySelector('#login-screen button[type="submit"]');
            if(loginBtn) {
                loginBtn.innerText = "Restart & Install Update";
                loginBtn.onclick = (e) => { e.preventDefault(); performUpdateRestart(); };
                loginBtn.classList.remove('btn-primary');
                loginBtn.classList.add('btn-success');
                loginBtn.classList.add('pulse-anim'); // Add visual cue
            }
            const err = document.getElementById('loginError');
            if(err) {
                err.innerText = "Update Ready. Please restart to continue.";
                err.style.color = "#2ecc71";
            }
        }

        // Check if this was a Forced Update from Admin (Legacy check)
        if (sessionStorage.getItem('force_update_active') === 'true') {
            sessionStorage.removeItem('force_update_active');
            const isTakingTest = CURRENT_USER && (document.getElementById('test-take-view')?.classList.contains('active') || document.getElementById('vetting-arena')?.classList.contains('active') || (document.getElementById('live-execution')?.classList.contains('active') && CURRENT_USER.role === 'trainee'));
            
            if (!isTakingTest) {
                performUpdateRestart();
            } else if (typeof showToast === 'function') {
                showToast("Admin requested an update. It will apply automatically after your assessment.", "warning");
            }
        }
    });
}

// --- UPDATE RESTART HANDLER ---
window.performUpdateRestart = function() {
    // 1. Save State if Logged In
    if (CURRENT_USER) {
        // Force blur to trigger any pending 'change' events on inputs
        if (document.activeElement) document.activeElement.blur();

        // Trigger Draft Saves
        if (typeof saveAssessmentDraft === 'function') saveAssessmentDraft();
        if (typeof saveBuilderDraft === 'function') saveBuilderDraft();

        const state = {
            user: CURRENT_USER,
            tab: document.querySelector('section.active')?.id,
            timestamp: Date.now()
        };
        localStorage.setItem('pending_update_restore', JSON.stringify(state));
        
        // Attempt authoritative sync (Best effort)
        if (typeof saveToServer === 'function') {
            // Flush pending writes only; avoid force-pushing stale shared keys during restart.
            saveToServer('FLUSH', false, true).catch(e => console.warn("Update Sync Warning:", e));
        }
    }

    // 2. Trigger Restart
    restartAndInstall();
};

/* ================= DRAFT HANDLING ================= */

function checkForDrafts() {
    // If we are auto-restoring from an update, skip the prompts (handled in autoLogin)
    if (window.IS_UPDATE_RESTORE) return;

    // 1. Check Assessment Draft
    const draftAssess = localStorage.getItem('draft_assessment');
    if (draftAssess) {
        if (confirm("⚠️ Unfinished Assessment Found!\n\nYou were logged out while taking a test. Do you want to resume where you left off?")) {
            if (typeof restoreAssessmentDraft === 'function') restoreAssessmentDraft();
        } else {
            localStorage.removeItem('draft_assessment');
        }
    }

    // 2. Check Builder Draft
    const draftBuilder = localStorage.getItem('draft_builder');
    if (draftBuilder && CURRENT_USER.role === 'admin') {
        if (confirm("⚠️ Unsaved Test Draft Found!\n\nYou were logged out while building a test. Do you want to restore your draft?")) {
            if (typeof restoreBuilderDraft === 'function') restoreBuilderDraft();
        } else {
            localStorage.removeItem('draft_builder');
        }
    }
}

// --- RELEASE NOTES SYSTEM ---
function checkReleaseNotes(currentVersion) {
    // Release notes are intentionally suppressed for trainee-facing updates.
    localStorage.setItem('last_seen_version', currentVersion);
}

function showReleaseNotes(version) {
    const modal = document.getElementById('releaseNotesModal');
    const content = document.getElementById('releaseNotesContent');
    const title = document.getElementById('releaseNotesTitle');
    
    if(modal && content) {
        title.innerText = `What's New in v${version}`;
        content.innerHTML = getChangelog(version);
        modal.classList.remove('hidden');
    }
}

function getChangelog(version) {
    const logs = {
        "2.7.17": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Assessment Studio:</strong> Adds the new generated assessment workflow with Question Bucket, generator recipes, sealed trainee snapshots, full-page trainee runtime, Grading Queue, Completed Tests, Feedback Sessions, and Universal Search.</li>
                <li style="margin-bottom: 8px;"><strong>Trainee Flow:</strong> Timeline-linked Assessment Studio tests now generate per trainee, save drafts, submit for admin review, show completed scores in My Assessments, and support feedback requests.</li>
                <li style="margin-bottom: 8px;"><strong>Admin Flow:</strong> Admins can grade generated submissions, adjust auto-scored answers, re-edit scores, manage feedback states, delete Assessment Studio submissions, and preserve legacy Test Engine history separately.</li>
                <li style="margin-bottom: 8px;"><strong>Reliability:</strong> Assessment Studio sync now merges bucket questions, generators, submissions, grades, and feedback states by ID to reduce overwrite risk during production testing.</li>
                <li style="margin-bottom: 8px;"><strong>One UI:</strong> Assessment Studio admin and trainee views now inherit the app theme for a more consistent release-ready experience.</li>
            </ul>`,
        "2.7.4": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Reliability:</strong> Internal release hardening improves monitored training workflows, session state reporting, and review cleanup paths.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Additional safeguards reduce stale state and improve consistency across admin-supervised trainee sessions.</li>
                <li style="margin-bottom: 8px;"><strong>Release:</strong> Version bump to 2.7.4 for stable main-channel rollout.</li>
            </ul>`,
        "2.7.3": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Vetting Grading:</strong> New Vetting Arena submissions now wait for admin grading instead of auto-skipping review, while historical completed Vetting records stay completed.</li>
                <li style="margin-bottom: 8px;"><strong>Grading Queue:</strong> Linked pending rows are repaired back to completed when a permanent record already exists, preventing old reviewed attempts from flooding the queue.</li>
                <li style="margin-bottom: 8px;"><strong>Insight Knowledge Gaps:</strong> Individual view now shows each missed question with full question text, trainee answer, and awarded points; group view now aggregates failed questions by assessment and group.</li>
                <li style="margin-bottom: 8px;"><strong>HR Evidence:</strong> One HR incident can now be linked to multiple evaluation triggers, with edit, delete, and trigger filtering for captured evidence.</li>
                <li style="margin-bottom: 8px;"><strong>Insight Polish:</strong> Assessment breakdown graphs now show assessment names instead of numeric-only axis labels.</li>
                <li style="margin-bottom: 8px;"><strong>Reliability:</strong> Additional cleanup hardens Vetting, Insight, Schedule Studio, dashboard, auth, sync, and embedded module paths used during release operations.</li>
            </ul>`,
        "2.7.2": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Vetting Arena:</strong> Admins now get clearer group selection with month/year names, member counts, and trainee previews before starting a session.</li>
                <li style="margin-bottom: 8px;"><strong>Vetting Tests:</strong> Test selection is split into 1st Vetting, Final Vetting, and Other Vetting sections, with per-group completion tracking to avoid repeating the wrong stage.</li>
                <li style="margin-bottom: 8px;"><strong>Reliability:</strong> Starting a Vetting session now seeds the selected group as waiting, nudges the targeted trainees, and keeps trainee status updates merged so admin monitoring remains accurate.</li>
                <li style="margin-bottom: 8px;"><strong>Trainee Flow:</strong> The secure pre-flight screen no longer re-renders during repeated scans, so passed trainees keep a stable Enter Arena button before taking and submitting the test.</li>
                <li style="margin-bottom: 8px;"><strong>Session Ending:</strong> Ending Vetting now sends an explicit release command to targeted trainees and ignores stale inactive rows if server delete is delayed.</li>
                <li style="margin-bottom: 8px;"><strong>Polish:</strong> Vetting admin and trainee views now use a more focused command-center and secure exam profile.</li>
            </ul>`,
        "2.7.1": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Hotfix:</strong> Live Assessment Arena now stays hidden unless its own tab is active, preventing arena visuals from bleeding into other application views.</li>
                <li style="margin-bottom: 8px;"><strong>Polish:</strong> The active study-session return button is less intrusive and live trainee controls reserve space so action buttons stay visible.</li>
            </ul>`,
        "2.7.0": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Retrain migration and Insight N/A handling are more reliable for agents moved into new training groups.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Admin navigation now uses a cleaner Navigation Map with drag-and-drop ordering and quick submenus.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Live Assessment Arena now adapts question, answer, chat, and action areas better when UI zoom is high.</li>
                <li style="margin-bottom: 8px;"><strong>Performance:</strong> Trainee login, navigation, embedded modules, and heavy admin views now do less blocking work during startup and tab changes.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> App modules now use guarded cache reads so corrupt local data is far less likely to crash login, dashboards, reports, scheduling, vetting, or diagnostics.</li>
            </ul>`,
        "2.6.99": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Trainee Portal no longer gets stuck on the refresh screen during login.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Trainee Portal can recover if its embedded workspace needs to be remounted.</li>
                <li style="margin-bottom: 8px;"><strong>Migration Fix:</strong> Agent migration now handles corrupted local storage values without failing on "undefined" JSON.</li>
                <li style="margin-bottom: 8px;"><strong>Insight Fix:</strong> Insight Studio Migrate now opens the group selector immediately and refreshes data before archiving after confirmation.</li>
                <li style="margin-bottom: 8px;"><strong>Retrain Safety:</strong> Retrying a recent failed retrain migration resumes the existing archive and merges remaining live rows before cleanup.</li>
                <li style="margin-bottom: 8px;"><strong>Official Progress:</strong> Retrain archives now use the Agent Progress Builder checklist and preserve valid N/A marks when agents move between groups.</li>
                <li style="margin-bottom: 8px;"><strong>Navigation:</strong> Admin sidebar advanced mode is now a cleaner Navigation Map with priority rows and compact destination tiles.</li>
                <li style="margin-bottom: 8px;"><strong>Customization:</strong> Navigation Map order can now be changed with drag-and-drop directly from the expanded sidebar.</li>
                <li style="margin-bottom: 8px;"><strong>Quick Menus:</strong> Navigation shortcuts now open as clean inline dropdowns only when requested.</li>
                <li style="margin-bottom: 8px;"><strong>Submenus:</strong> Insight, OPL Hub, Schedule, Live Assessment, Content Creator, Teamleader Hub, Vetting Arena, and Data Studio now expose their key subviews from the Navigation Map.</li>
                <li style="margin-bottom: 8px;"><strong>Performance:</strong> Navigation now avoids repeated embedded-theme injection, full-page responsive-table rescans, hidden Admin Tools renders, and unnecessary forced server refreshes on normal admin tab changes.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Realtime setup now ignores duplicate same-user channel starts, and boot/notification storage reads are hardened against corrupt JSON cache values.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Shared utilities plus Test Builder, Test History, and Capture Scores now handle corrupt local cache values more defensively, and app-wide notification/update/lunch intervals are guarded against duplicate startup registration.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Study Monitor now uses defensive cache reads for monitor data, history, whitelists, schedules, users, and trainee bookmarks so corrupted local storage cannot crash activity views or background tracking.</li>
                <li style="margin-bottom: 8px;"><strong>Performance:</strong> Schedule Studio host rendering no longer performs a full server refresh just because a legacy renderSchedule caller touched the replaced schedule tab.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> The remaining active schedule.js Live Assessment Booking paths now read schedules, live schedules, bookings, live sessions, rosters, records, submissions, and repair archives defensively.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Admin System maintenance/migration tools and Live Assessment Execution now tolerate corrupt local cache values instead of crashing on bad JSON while reading live sessions, row counts, records, users, or system config.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Admin Users, Department Overview analytics, and trainee assessment screens now use defensive cache reads for users, rosters, submissions, schedules, records, notifications, and progress data.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Reporting, Agent Search, AI diagnostics, and Dashboard widgets now use defensive cache reads for saved reports, archives, link requests, notices, bookmarks, tips, and system-wide diagnostic data.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Assessment Admin marking, quick approve, history review, marking leases, and marker note updates now use defensive cache reads for submissions, records, tests, rosters, and sync hash maps.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Main shell, NPS, Vetting runtimes, Insight rules, attendance, and admin assessment workflows now avoid raw local storage JSON parsing in their larger hot paths.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Login/auth, calendar, diagnostics, Content Studio, Team Hub, OPL Hub, Q&A Hub, Insight Studio helpers, and Vetting Arena now use guarded cache reads instead of direct local storage JSON parsing.</li>
            </ul>`,
        "2.6.98": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Trainee Login:</strong> Trainee Portal now opens first while trainee data sync and activity monitoring start in the background.</li>
                <li style="margin-bottom: 8px;"><strong>One UI:</strong> Trainee Portal now inherits One UI theme classes and tokens from the main workspace.</li>
                <li style="margin-bottom: 8px;"><strong>Navigation:</strong> The advanced sidebar expands into a wider compact grid so more tabs fit on-screen.</li>
                <li style="margin-bottom: 8px;"><strong>Quick Menus:</strong> Admin Tools, Test Engine, and Onboard Report now expose direct subview shortcuts from the sidebar.</li>
            </ul>`,
        "2.6.97": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Performance:</strong> Operations Dashboard and sidebar navigation now do less blocking work while keeping the One UI visuals intact.</li>
                <li style="margin-bottom: 8px;"><strong>Performance:</strong> Dashboard and Test Engine realtime refreshes are now debounced/idle-coalesced for smoother editing and navigation.</li>
                <li style="margin-bottom: 8px;"><strong>Sync Hardening:</strong> Feedback requests now use targeted delta uploads instead of forcing full submissions and records uploads.</li>
                <li style="margin-bottom: 8px;"><strong>Loading States:</strong> Uploads, downloads, and heavy view refreshes now show clearer progress screens so the app feels active during server work.</li>
                <li style="margin-bottom: 8px;"><strong>Theme Polish:</strong> One UI styling now bridges into embedded hubs and studio modules more consistently.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Network Diagnostics now opens as a large workspace modal instead of a small bottom sheet.</li>
                <li style="margin-bottom: 8px;"><strong>Polish:</strong> Network Diagnostics modal cards and admin popout now inherit One UI theme tokens and custom accent styling.</li>
            </ul>`,
        "2.6.96": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Trainees can request feedback once per completed assessment from My Assessments.</li>
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Test Engine & History now includes Feedback Sessions for admins to review requests and mark feedback as given.</li>
                <li style="margin-bottom: 8px;"><strong>Notification:</strong> Admin and Super Admin users now receive notification-bell alerts when assessment feedback is requested.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> My Assessments now shows completed live assessments alongside upcoming live bookings.</li>
            </ul>`,
        "2.6.95": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> One UI Clean is now an official workspace theme in profile and admin personalization.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> One UI now has its own customization controls for light/dark accents, light/dark surfaces, corner shape, and depth.</li>
                <li style="margin-bottom: 8px;"><strong>Polish:</strong> The One UI default accent moved from blue to dark grey with deeper styling for controls, tables, dropdowns, embedded app headers, and primary actions.</li>
                <li style="margin-bottom: 8px;"><strong>Performance:</strong> One UI route changes now defer non-critical work and suppress expensive visual effects during the switch.</li>
            </ul>`,
        "2.6.94": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> One UI Clean is now the default adaptive workspace theme when no custom visual theme is configured.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> One UI styling now reaches deeper into shell headers, cards, modals, status chips, segmented controls, tables, toasts, and embedded app title bars.</li>
                <li style="margin-bottom: 8px;"><strong>Performance:</strong> Navigation now skips rebuilding already-loaded embedded workspaces, defers non-critical tab work, and debounces repeated clicks.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Marking queue cleanup keeps actively marked linked pending submissions visible and repairs stale linked pending rows without archiving them.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Admin connectivity testing now handles missing local server fields without throwing.</li>
            </ul>`,
        "2.6.93": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Knowledge Gaps now reads Test Engine question scores correctly and shows clearer failure rates.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> HR Evidence now saves against the trainee's canonical name and appears reliably in Insight Build.</li>
                <li style="margin-bottom: 8px;"><strong>Hardening:</strong> Vetting submissions and admin marking now verify critical server saves more reliably.</li>
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> One UI Clean adds a reversible mobile-inspired experimental theme with brighter surfaces and calmer motion.</li>
            </ul>`,
        "2.6.92": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Insight Studio now includes Insight Build, a dedicated 3 month probation review workspace for trainee deep dives.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Insight Build adds same-group peer comparison, official Assessment/Test breakdowns, day-by-day attendance timelines, focus timelines, and probation review evidence signals.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Attendance timelines now respect trainee start dates, weekdays, and public holidays, while focus timelines can read archived and live monitor study data.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Compare Viewer, Insight Build, and Department Overview now compile on demand and the breakdown graph shows Fail, Improve, and Pass goal bands.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Activity Monitor previous-day timeline detail now fetches archived days from Supabase when the local cache has already been pruned.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Insight Build compile now directly pulls archived focus history for selected trainees and anchors probation windows to first real activity.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Insight Build now includes a sorted Assessment, Vetting, Live Assessment, and Test score list in the review section.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Insight Build timelines are wider and include late-entry and day-by-day focus review tables under the graphs.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Insight Build now includes a test Performance Evaluation Evidence Grid and Training / Resource Engagement section, with an OPL Hub note for future production stats.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Insight Build can now switch between current/live training and detected retrain archive attempts, using archived attendance and focus data for the selected attempt.</li>
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> HR Evidence lets admins capture trainee-level manual performance evidence with proof links or screenshots, and Insight Build shows those rows in the evidence grid.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> HR Evidence trigger selection now includes all performance evaluation areas so admins can add manual proof alongside auto-populated Insight Build evidence.</li>
            </ul>`,
        "2.6.91": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Admin Tools now includes Hosted HTML Tool management with separate Main and Export slots, Supabase Storage uploads, generated browser URLs, and usage tracking.</li>
                <li style="margin-bottom: 8px;"><strong>Infrastructure:</strong> Added the hosted HTML Edge Function and Supabase setup script for rendering uploaded HTML files as browser pages.</li>
            </ul>`,
        "2.6.90": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Course move-on emails now always add course and trainee details automatically while System Config controls only the request message text.</li>
            </ul>`,
        "2.6.89": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Course move-on request email body templates are now editable from System Config with course, user, and request-message placeholders.</li>
            </ul>`,
        "2.6.88": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Course move-on request wording is now editable from System Config and reused for the trainee button and email body.</li>
            </ul>`,
        "2.6.87": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Course move-on requests now support synced SMTP settings and admin notification-bell alerts when a request is sent.</li>
            </ul>`,
        "2.6.86": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Schedule Studio timeline items can now show a trainee move-on request button with configurable recipients, confirmation text, and per-trainee availability exceptions.</li>
            </ul>`,
        "2.6.85": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Insight Compare Viewer Two Graphs mode now lets admins choose a separate group for each Assessment/Test Breakdown graph, making direct group-vs-group comparison possible.</li>
            </ul>`,
        "2.6.84": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Access Change:</strong> Arcade Vault is now disabled for trainee sessions, including hidden logo unlocks and direct open attempts.</li>
            </ul>`,
        "2.6.83": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Insight Compare Viewer now has Single Graph and Two Graphs modes for the Assessment/Test Breakdown graph, allowing dense selections to be split into two readable chart panels.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> The Insight sidebar icon now uses the supported chart-line icon so the view is visually distinguishable in both classic and advanced navigation.</li>
            </ul>`,
        "2.6.82": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Performance:</strong> Insight Compare Viewer now caches built comparison rows for the active session so changing selections, group filters, and compare scopes no longer rebuilds every trainee record from scratch.</li>
                <li style="margin-bottom: 8px;"><strong>Performance:</strong> Compare cache is automatically reset when Insight data is rehydrated or force-refreshed, keeping the faster filter response aligned with current records.</li>
            </ul>`,
        "2.6.81": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Insight now shows an immediate loading screen saying “Fetching and building records” while the workspace snapshot and embedded module are prepared.</li>
                <li style="margin-bottom: 8px;"><strong>Performance:</strong> Insight webview creation is deferred briefly so the loading screen paints before heavier data hydration begins.</li>
            </ul>`,
        "2.6.80": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Insight Compare Viewer now uses a responsive Assessment/Test Breakdown graph that scales inside the card instead of forcing the page wider than the screen.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Compare Viewer cards, filters, chart summaries, and graph headers have been visually tightened for a cleaner modern comparison workspace.</li>
            </ul>`,
        "2.6.79": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Agent Progress Builder now presents Test Engine items as the visible source of truth instead of mixing assessment-list, vetting-topic, and timeline source buckets in the selector.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Legacy assessment, vetting, and timeline names remain available only as fallback/evidence matching so historical trainee submissions can still complete the configured Test Engine progress list.</li>
            </ul>`,
        "2.6.78": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Performance:</strong> Insight now opens from a full in-session host snapshot and skips background fresh-pull re-renders while you remain in the tab.</li>
                <li style="margin-bottom: 8px;"><strong>Performance:</strong> The Insight session cache is cleared when you leave the tab, so the next visit rebuilds from current BuildZone data without carrying stale workspace state.</li>
            </ul>`,
        "2.6.77": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Performance:</strong> Insight refreshes now use a debounced soft data sync instead of reloading the whole embedded webview during background pulls.</li>
                <li style="margin-bottom: 8px;"><strong>Performance:</strong> Insight now sends only changed host data keys after the first load, reducing heavy data injection stalls while keeping filters and stats current.</li>
            </ul>`,
        "2.6.76": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Insight now waits for the embedded webview to be ready before refreshing, preventing the early reload freeze that blocked trainee filters and stats.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Insight now injects the host app's trainee data snapshot into the module and keeps local fallbacks when cloud bootstrap rows are empty, restoring group filters, agent search, and stats across submenus.</li>
            </ul>`,
        "2.6.75": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Added the First Line Troubleshooting Tool V3.4 as a hidden in-app workspace restricted to Jaco's Super Admin account.</li>
            </ul>`,
        "2.6.74": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Insight now renders locally hydrated trainee records immediately across Agent Triggers, Agent Progress, Department Overview, Knowledge Gaps, and Compare Viewer instead of waiting for the cloud pull to finish.</li>
            </ul>`,
        "2.6.73": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Insight Compare Viewer now hydrates people, groups, and comparison data from the local app cache before waiting for the slower cloud pull.</li>
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Q&amp;A Hub now has explicit Save Draft and Publish to Library actions so FAQ answers can be prepared before going live to trainees.</li>
            </ul>`,
        "2.6.72": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Insight now loads faster by using reusable in-memory indexes and a smaller module cache.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Compare Viewer assessment/test graphs now use the Agent Progress Builder list as the scoring source of truth.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Missing assessment scores no longer drop graph lines to 0%; lines stop cleanly until a real score exists.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Attendance comparison now excludes ignored attendance rows from totals and daily grids.</li>
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Admin Tools now includes Save Progress List and Repair Archive Snapshots actions for progress and archive data integrity.</li>
            </ul>`,
        "2.6.71": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Q&amp;A Hub now has an admin workspace for FAQ entries, trainee question submissions, and attached resources.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Trainees now open question submission as an in-widget compose view.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Attached material previews now support image, video, document, audio, and SharePoint link resources more reliably inside the app.</li>
            </ul>`,
        "2.6.70": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Live Assessment Booking has a cleaner schedule workspace and editable booking rules in Admin Tools &gt; System Config.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Live trainee stats now count completed live submissions and records even if a completed booking row is missing.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Study Notes pop-out now opens with the trainee's existing notes instead of an empty isolated store.</li>
            </ul>`,
        "2.6.69": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Insight Compare Viewer breakdown graphs now draw every selected trainee or group instead of only the first 8.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Compare graph line colors now use a generated color sequence so larger selections are easier to tell apart.</li>
            </ul>`,
        "2.6.68": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Insight Compare Viewer now has an Attempt 1 vs Current Live scope to compare selected trainees' first archived attempt against their current live attempt on the same graphs.</li>
            </ul>`,
        "2.6.67": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Test Engine Integrity Review now includes retrain archive snapshots with counts, duplicate/mixed-data flags, and a detail viewer for records, submissions, and attendance.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Admins can filter specifically to Retrain Archives, inspect archive records/submissions/attendance, mark an archive Valid/Review/Invalid, classify it as A1/A2, clear the decision, or delete a confirmed invalid archive snapshot.</li>
            </ul>`,
        "2.6.66": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Moving a trainee to a new group now archives the old attempt and queues exact server deletes for the archived live rows so the new group starts with a clean slate.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Agent Search labels retrain archive attempts by their real attempt number and still shows the current live attempt separately.</li>
            </ul>`,
        "2.6.65": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Test Engine Integrity Review now reviews each assessment attempt as a whole entry instead of presenting it as per-question cleanup.</li>
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Admins can mark entries Valid, Review, or Invalid and classify them as Attempt 1 or Attempt 2 with synced overrides.</li>
            </ul>`,
        "2.6.64": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Test Engine now includes an Integrity Review view for assessments, live assessments, and vetting tests.</li>
                <li style="margin-bottom: 8px;"><strong>Safety:</strong> The review identifies suspicious or invalid entries first and only deletes a selected entry after admin confirmation.</li>
            </ul>`,
        "2.6.63": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Insight Compare Viewer now has an attempt selector for current live data and retrain archive attempts 1 and 2.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Archived comparison stats are capped to valid training attempts 1 and 2 so bad retain-attempt counts do not skew release graphs.</li>
            </ul>`,
        "2.6.62": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Insight Compare Viewer now uses current live roster data only and excludes archived, invalid, blocked, ungrouped, and previous-group rows from comparison graphs.</li>
            </ul>`,
        "2.6.61": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Insight Compare Viewer now has selectable comparison filters, clearer graph labels, thinner lines, direct group-member comparisons, and separate assessment/test, attendance, and focus graphs.</li>
            </ul>`,
        "2.6.60": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Insight Compare Viewer now graphs straight per-agent/per-group lines across the actual breakdown items: assessments, vetting, live assessments, tests, attendance, and focus level.</li>
            </ul>`,
        "2.6.59": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Insight now includes a Compare Viewer for per-person and per-group graph comparisons across assessments, vetting, live assessments, tests, attendance, focus, progress, and activity risk.</li>
            </ul>`,
        "2.6.58": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> External program links now use the native app bridge more reliably, fixing cPanel/Webmail browser launch failures.</li>
            </ul>`,
        "2.6.57": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> cPanel/Webmail program links now open in the normal browser to avoid the embedded app view causing cPanel server errors.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Activity monitoring now recognises cPanel/Webmail as permitted work activity when opened externally.</li>
            </ul>`,
        "2.6.56": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Training Rules now support first-login display, optional every-login display, specific trainee/group targeting, admin rich-text editing, and quick trainee portal access.</li>
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> First-time trainee setup now includes an admin-configured Office dropdown.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Deleting users from groups is hardened against bad local JSON values and partial cloud cleanup failures.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Admin marking, legacy Insight review decisions, and Live Booking date updates now keep their legacy buttons connected to the current workflows.</li>
                <li style="margin-bottom: 8px;"><strong>Release:</strong> The Windows package now uses the correct application icon.</li>
            </ul>`,
        "2.6.55": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Agent Progress Builder now offers only active Test Engine assessments and flags configured items that no longer exist in the active test list.</li>
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Test Engine and History now support assessment title correction with linked history, records, and Insight progress mappings updated together.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> MS Teams and idle activity now allow an 8-minute grace window before a training-scope violation is captured.</li>
            </ul>`,
        "2.6.54": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> The top-left 1st Line logo now unlocks the Arcade Vault after five clicks without triggering app window minimize or maximize behavior.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Main release build scripts now include the default dist alias plus main and beta channel commands.</li>
            </ul>`,
        "2.6.50": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Agent Progress Builder checklist items can now be classified as Assessment, Vetting Test, or Test.</li>
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Checklist items now include report placement ticks for Training Goal Feedback, Assessment Scores, Vetting Test 1, and Final Vetting sections.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Onboard Reports now build those score sections from the configured checklist instead of relying only on static assessment and vetting lists.</li>
            </ul>`,
        "2.6.49": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Study Browser tabs can now pop out into frameless app windows with built-in minimize, maximize, close, navigation, and reload controls.</li>
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Training-scope violations now require a mandatory trainee explanation with trigger, reason, platform, and informed-person capture before continuing.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Activity Monitor now includes violation review notifications, searchable review filters, per-agent violation badges, and reviewed-state tracking.</li>
                <li style="margin-bottom: 8px;"><strong>Polish:</strong> Manage Users now uses one unified searchable list and Study Notes received cleaner dark-theme styling.</li>
            </ul>`,
        "2.6.48": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Final Vetting sessions now resolve roster, email, and contact aliases to the correct trainee accounts before sending arena nudges.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Schedule edit windows now keep Save and Cancel visible on shorter screens.</li>
            </ul>`,
        "2.6.47": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Super Admin minimum-version login enforcement now verifies the real app version before allowing access.</li>
            </ul>`,
        "2.6.46": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Onboard Summary Report now stays hidden outside its own navigation tab for all roles.</li>
            </ul>`,
        "2.6.45": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Onboard Summary Report printing now stays scoped to the report page and no longer appears when printing other app pages.</li>
            </ul>`,
        "2.6.44": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Onboard Summary Report now has a cleaner A4 report workspace with dedicated report controls and saved-report preview actions.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Editable report fields now expand as content grows, wrap long links/text safely, and normalize before save or print.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Saved report printing now targets the opened report preview instead of relying on the generic page print path.</li>
            </ul>`,
        "2.6.43": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Live Assessment Booking now uses a left controls/sidebar workspace with booking stats, rules, and a dedicated schedule grid.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Attendance Register &amp; Review now has pinned review filters and stats on the left with the agent register on the right.</li>
                <li style="margin-bottom: 8px;"><strong>Polish:</strong> Problem Reports and System Error Reports now open in the same admin workspace pattern with triage stats and review guidance.</li>
            </ul>`,
        "2.6.42": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Attendance Register now opens with near-fullscreen admin coverage for easier review.</li>
                <li style="margin-bottom: 8px;"><strong>Polish:</strong> Network Diagnostics and Agent Activity Monitor received larger modern modal shells and cleaner card styling.</li>
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Added Compact, Comfortable, and Spacious interface density settings, responsive row cards for tables on small screens, shared status chip styling, and admin sync indicators.</li>
            </ul>`,
        "2.6.41": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Admin Tools now uses a left-side settings rail instead of a long horizontal subtab row.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Assessment Records now has pinned filters on the left and a dedicated results workspace on the right.</li>
                <li style="margin-bottom: 8px;"><strong>Polish:</strong> Shared table empty/loading/error states were added and applied to key records tables.</li>
            </ul>`,
        "2.6.40": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Admin dashboards now start with a Command Center strip for marking, Insight actions, live bookings, and attendance review.</li>
                <li style="margin-bottom: 8px;"><strong>Polish:</strong> Dashboard headers, cards, and modal shells have a cleaner shared visual style with less jumpy hover movement and better scan density.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Dashboard date counts now use local dates consistently for live bookings and daily tasks.</li>
            </ul>`,
        "2.6.39": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Attendance Register &amp; Review now opens in a larger workspace with summary cards, cleaner agent rows, and manual refresh while the window is open.</li>
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Live Assessment rules now support rich formatting such as bullets, bold, italic, and text sizing from Admin Tools &gt; System Config.</li>
            </ul>`,
        "2.6.38": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Today's Tasks now maps the day more clearly for admins, including grouped schedule items, live bookings, admin actions, and booking records that need review.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Attendance now normalizes one record per trainee per day, reduces approval refresh flicker, and exposes trainee clock-out in the portal widget.</li>
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Live Assessment pre-question rules are now editable from Admin Tools &gt; System Config.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Theme colors are pushed into embedded modules, Network Diagnostics popouts, and isolated program views more consistently.</li>
            </ul>`,
        "2.6.37": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Live Assessment final summary now handles missing or delayed test definitions without crashing, and score/comment saves initialize missing session containers safely.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Problem Reports and System Errors now hide resolved or noisy historical reports by default, with a toggle to review them when needed.</li>
            </ul>`,
        "2.6.36": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Orphan cleanup now checks only local row IDs against Supabase instead of scanning full high-volume tables like error reports, preventing statement timeouts during diagnostics.</li>
                <li style="margin-bottom: 8px;"><strong>Clarification:</strong> Duplicate-row collapse warnings are protective sync cleanup messages, not assessment overwrite errors.</li>
            </ul>`,
        "2.6.35": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Critical explicit saves for assessment records, submissions, live sessions, bookings, users, and test/schedule definitions now fail visibly and stay queued if the server rejects the write.</li>
                <li style="margin-bottom: 8px;"><strong>Verification:</strong> Full app syntax and automated test passes were run across the current release scope.</li>
            </ul>`,
        "2.6.34": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Live Assessment saves now create separate submission-linked records per session, with a repair tool for affected live records and safer snapshot-based marking scores.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Test Engine history, delete, and builder permission safeguards were tightened to avoid same-title record mistakes.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Assessment Records now has admin score-edit safeguards that sync linked submissions and permanent records together.</li>
            </ul>`,
        "2.6.33": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Main-channel rollout for Network Diagnostics, Live Assessment stability, local trainee Study Notes, Activity Monitor summaries, and Problem Report notifications.</li>
            </ul>`,
        "2.6.32": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Realtime Presence is now disabled in favour of the existing database heartbeat to stop repeated CLOSED/SUBSCRIBED reconnect loops during live assessments.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Row uploads now collapse duplicate IDs before batch upsert so records cannot fail with duplicate ON CONFLICT updates.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Trainees are now released from the Live Assessment Arena when a trainer ends the session, even if the realtime delete event is missed.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Network Diagnostics now sends lightweight background reports every 10 minutes, includes scheduled group online counts, and captures broader console/runtime issues.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Problem Reports now refresh from the server directly, trainee-submitted reports sync correctly, and Super Admins get notification-bell alerts for new reports.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Study Notes are now local-only for trainees with a section rail and page-tab workspace that avoids refreshes while typing.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Activity Monitor summaries now let admins open a per-trainee violation view.</li>
            </ul>`,
        "2.6.31": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Network Diagnostics now includes an admin-only second-screen overlay with latency history, DB data health, and agent status filters.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Realtime tunnel handling now uses explicit table subscriptions, separated presence recovery, and targeted Live Assessment/Vetting fallback reads.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Supabase client reuse prevents duplicate auth clients after reconnect or system wake events.</li>
            </ul>`,
        "2.6.30": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Live Assessment Confirm &amp; Submit now closes sessions authoritatively so completed sessions do not re-open as active.</li>
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Live Booking Integrity now includes Recover Stale Sessions to archive stale session payloads and recover missing submission/record data.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Live session stale-guard filtering now suppresses stale rejoin paths for completed/cancelled booking states.</li>
            </ul>`,
        "2.6.29": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Shared helper collisions were cleaned up so global UI helpers stay consistent across modules.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Refresh icon targeting now supports the current header runtime controls more safely.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Recovery/cache backup artifacts are now ignored from source control to keep release scope cleaner.</li>
            </ul>`,
        "2.6.28": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Startup runtime selection now routes trainee sessions directly into the isolated Trainee Portal path.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Trainee Portal and Study Notes refresh flow now uses leaner bridge/event-driven updates to reduce duplicate background polling.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Tab rendering paths were consolidated to reduce duplicate logic and keep view refresh behavior consistent.</li>
            </ul>`,
        "2.6.27": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Released the new Insight workspace with Agent Triggers and Agent Progress flows for admin operations.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Content-linked training playback and linked quiz/document launch reliability were improved across schedule and content runtime paths.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Realtime tunnel fallback and diagnostics handling were hardened to prevent timeout reconnect storms and modal metric crashes.</li>
            </ul>`,
        "2.6.26": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Schedule timelines now load linked Content Creator modules from both canonical and local cache sources for stronger module visibility.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Linked content document and video launch now use resolved storage URLs for more reliable playback and document opening.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Questionnaire launch from Content Creator now includes runtime bridge fallbacks so linked quizzes open correctly across embed contexts.</li>
            </ul>`,
        "2.6.25": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> System update checks were hardened so required updates follow the approved production path.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Update notifications now separate optional install timing from required restart prompts.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Minimum-version enforcement was pinned to production updates for safer fleet rollout.</li>
            </ul>`,
        "2.6.24": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> Linked questionnaires can now open in trainee popup mode for complete-and-submit flow.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Content Creator Builder now includes a stronger Module Manager for open, search, rename, duplicate, and delete actions.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> New module actions were hardened so create and duplicate flows always execute with clear feedback.</li>
            </ul>`,
        "2.6.23": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Added:</strong> System Updates gained clearer delivery controls for approved app releases.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Update logs now show check and download progress more clearly.</li>
                <li style="margin-bottom: 8px;"><strong>Bug Fix:</strong> Added safer updater routing so manual checks do not require code edits.</li>
            </ul>`,
        "2.6.22": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Super Admin Agent Data Explorer:</strong> User Control now includes a folder-style explorer for live and archived agent datasets with per-bucket detail views.</li>
                <li style="margin-bottom: 8px;"><strong>Archive &amp; Restore By Item:</strong> You can now move specific rows live-to-archive and archive-to-live (records, submissions, live bookings, attendance, saved reports, and insight reviews) instead of only bulk attempt actions.</li>
                <li style="margin-bottom: 8px;"><strong>Move Safety Guardrails:</strong> Each explorer move now writes backup snapshots to <code>app_documents.user_control_move_backups</code>, performs validation, and attempts rollback when a live delete fails.</li>
                <li style="margin-bottom: 8px;"><strong>Study Browser Click-Zone Hotfix:</strong> Hardened overlay layering and webview hit-testing to reduce inconsistent unclickable zones in embedded program pages like Q-Contact.</li>
            </ul>`,
        "2.6.20": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Content Studio Module:</strong> Added a new isolated <code>content-studio</code> runtime with View + Builder flows, schedule-linked headers/subjects, and play/document controls.</li>
                <li style="margin-bottom: 8px;"><strong>Engagement Telemetry:</strong> Content Studio now records per-user video plays, watch-time deltas, and skip events for subject-level learning insight.</li>
                <li style="margin-bottom: 8px;"><strong>Super Admin User Control Workspace:</strong> Expanded Data Studio with cross-module user controls for revoke/binding management, archive attempt editing, and one-click archive/reset of live lifecycle rows.</li>
                <li style="margin-bottom: 8px;"><strong>Sync + Identity Hardening:</strong> Added auth-critical pre-login refresh, identity-safe user/roster dedupe, high-priority view fresh-pull behavior, and richer realtime sync diagnostics for safer fleet operations.</li>
            </ul>`,
        "2.6.19": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Retrain Attempt Unlock:</strong> Trainee assessment launcher now auto-ignores legacy attempts from prior groups/move cycles so valid new-group attempts are not blocked.</li>
                <li style="margin-bottom: 8px;"><strong>Legacy Attempt Auto-Archive:</strong> When a stale pre-move submission is detected, it is archived and marked for retake flow instead of hard-blocking test start.</li>
                <li style="margin-bottom: 8px;"><strong>Group-Aware Locking:</strong> Submission lock checks now consider linked <code>records.groupID</code> and latest retrain archive move date before determining if an attempt is current.</li>
                <li style="margin-bottom: 8px;"><strong>Rollout:</strong> Version bumped to 2.6.19 for immediate client hotfix distribution.</li>
            </ul>`,
        "2.6.18": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Trainee Move Reliability:</strong> Hardened retrain/migration cleanup so moved trainees are removed from prior groups case-insensitively with roster dedupe.</li>
                <li style="margin-bottom: 8px;"><strong>Lifecycle Reset Safety:</strong> Move flow now performs case-insensitive cleanup for linked trainee data to prevent stale first-attempt carryover into new groups.</li>
                <li style="margin-bottom: 8px;"><strong>Score Consistency Repair:</strong> Completed history and test views now self-heal score drift from linked <code>records</code> when <code>submissions.score</code> is stale after refresh/relogin.</li>
                <li style="margin-bottom: 8px;"><strong>Rollout:</strong> Version bumped to 2.6.18 for lifecycle and grading reliability patch delivery.</li>
            </ul>`,
        "2.6.17": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Targeted Recovery Command:</strong> Added a new heartbeat command channel action <code>recover_submission:&lt;payload&gt;</code> for trainee-specific submission recovery.</li>
                <li style="margin-bottom: 8px;"><strong>Auto Record Rebuild:</strong> Recovery now restores missing linked <code>records</code> rows from matching local <code>submissions</code> before sync.</li>
                <li style="margin-bottom: 8px;"><strong>Next-Heartbeat Execution:</strong> Commands execute on both heartbeat pull and realtime session command events for faster remote remediation.</li>
                <li style="margin-bottom: 8px;"><strong>Rollout:</strong> Version bumped to 2.6.17 to deliver recovery tooling to trainee fleets.</li>
            </ul>`,
        "2.6.16": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Release Rollout:</strong> Version bumped to 2.6.16 so updater delivery can proceed beyond already-installed 2.6.15 clients.</li>
                <li style="margin-bottom: 8px;"><strong>Digital Script Safety:</strong> Viewer routing remains strict on <code>submissionId</code> to prevent duplicate-attempt misbinding.</li>
                <li style="margin-bottom: 8px;"><strong>Vetting Completion Reliability:</strong> Completion gating now verifies authoritative submission pipeline state before final <code>completed</code> status.</li>
                <li style="margin-bottom: 8px;"><strong>Cache Durability:</strong> Native disk cache uses atomic write + validated backup recovery to prevent truncated cache restores.</li>
            </ul>`,
        "2.6.15": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Vetting Arena Fix:</strong> Fixed an issue where the compliance overlay could repeat and block the Enter/Start button.</li>
                <li style="margin-bottom: 8px;"><strong>Crash Prevention:</strong> Added defensive JSON parsing to prevent crashes from invalid localStorage values.</li>
                <li style="margin-bottom: 8px;"><strong>Data Recovery & Sync:</strong> Improved tombstone/pending-delete handling and duplicate-rework safeguards during import.</li>
                <li style="margin-bottom: 8px;"><strong>Agent Access Recovery:</strong> Addressed client-binding revocation edge-cases and added recovery tooling for revoked clients.</li>
                <li style="margin-bottom: 8px;"><strong>Misc:</strong> General bug fixes and stability improvements.</li>
            </ul>`,
        "2.6.14": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Vetting False-Submit Hotfix:</strong> Fixed stale local trainee session carryover that could incorrectly show "Assessment Submitted" before a trainee starts a new vetting session.</li>
                <li style="margin-bottom: 8px;"><strong>Identity Collision Guard:</strong> Trainee status resolution now prefers non-completed identity matches when alias usernames exist, preventing old completed aliases from overriding active session state.</li>
                <li style="margin-bottom: 8px;"><strong>Session Start Seeding:</strong> New vetting sessions now pre-seed target trainees as <code>waiting</code> and nudges include canonical waiting entries for safer first-sync behavior.</li>
            </ul>`,
        "2.6.13": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Vetting Relax Enforcement Fix:</strong> Hardened trainee runtime identity resolution so admin security relax/override applies correctly during active vetting sessions.</li>
                <li style="margin-bottom: 8px;"><strong>Shared-Key Save Reliability:</strong> Explicit saves for strict shared keys (users/tests/schedules/live state) now flush immediately to reduce post-save rollback windows.</li>
                <li style="margin-bottom: 8px;"><strong>Controlled Restore Safety:</strong> JSON restore now syncs only imported keys instead of force-pushing all keys, preventing stale unrelated data from being republished.</li>
            </ul>`,
        "2.6.10": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Critical Vetting Join Hotfix:</strong> Fixed Vetting 2.0 admin runtime credential targeting so sessions are created on the active server target (cloud/local/staging) instead of always defaulting to cloud.</li>
                <li style="margin-bottom: 8px;"><strong>Trainee Arena Visibility Fix:</strong> Updated trainee arena button visibility checks to include active server-backed <code>adminVettingSessions</code>, preventing false "no session" states when a valid group-targeted session is live.</li>
            </ul>`,
        "2.6.9": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Server-Authority Sync Guardrails:</strong> Shared data keys now enforce server-first behavior so background local autosaves cannot silently republish stale groups, schedules, tests, users, or live assessment state.</li>
                <li style="margin-bottom: 8px;"><strong>Disk Cache Recovery Safety:</strong> Startup recovery now excludes risky server-target/sync metadata keys and skips automatic migration push on recovered boots to prevent stale cache resurrection events.</li>
                <li style="margin-bottom: 8px;"><strong>Group Deletion Integrity Fix:</strong> Group deletes now persist the updated roster snapshot before force sync, with rollback on failure, preventing deleted groups from reappearing.</li>
            </ul>`,
        "2.6.8": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Archive Split (Retrain vs Graduate):</strong> Retraining transfers now save to <code>retrain_archives</code> so graduation reporting stays clean.</li>
                <li style="margin-bottom: 8px;"><strong>Refresh Reliability Upgrade:</strong> Header refresh now flushes pending queues, processes deletes, and then performs a fresh Supabase pull before re-rendering key modules.</li>
                <li style="margin-bottom: 8px;"><strong>Vetting Runtime Sync:</strong> Vetting 2.0 refresh hooks now support forced flush + fallback poll during manual refresh operations.</li>
            </ul>`,
        "2.6.7": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Live Arena 1-Second Hard Sync:</strong> Added a strict 1s targeted live-session refresh loop while Live Execution is open.</li>
                <li style="margin-bottom: 8px;"><strong>Trainee Update Reliability:</strong> Added stronger force-refresh-by-session-id handling for trainer and trainee clients.</li>
            </ul>`,
        "default": `
            <p>Performance improvements and bug fixes.</p>
        `
    };
    return logs[version] || logs["default"];
}

// --- DATABASE HEALTH CHECK ---
function checkDatabaseHealth() {
    let total = 0;
    for(let key in localStorage) {
        if(localStorage.hasOwnProperty(key)) total += localStorage[key].length * 2;
    }
    const mb = total / (1024 * 1024);
    if (mb > 10) {
        if(typeof showToast === 'function') showToast(`⚠️ DB Alert: Storage is heavy (${mb.toFixed(1)} MB). Run cleanup.`, 'warning');
    }
}

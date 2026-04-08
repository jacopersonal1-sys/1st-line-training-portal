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
const MAX_LOG_SIZE = 200; // Keep last 200 entries to manage memory

// ARCHITECTURAL FIX: Recursion lock for error reporting
window._IS_REPORTING_ERROR = false;

function captureLog(type, args) {
    try {
        const msg = args.map(a => {
            if (a instanceof Error) return a.toString() + (a.stack ? '\n' + a.stack : '');
            if (typeof a === 'object') return JSON.stringify(a);
            return String(a);
        }).join(' ');
        
        window.CONSOLE_HISTORY.push({ type, msg, time: new Date().toISOString() });
        if (window.CONSOLE_HISTORY.length > MAX_LOG_SIZE) window.CONSOLE_HISTORY.shift();

        // --- SILENT CLOUD REPORTING ---
        const strMsg = msg.toString();
        // ARCHITECTURAL FIX: Prevent infinite stack overflow loops if the save function itself throws an error.
        if ((type === 'error' || type === 'fatal') && typeof reportSystemError === 'function' && !window._IS_REPORTING_ERROR &&
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

window.onerror = function(msg, url, line, col, error) {
    captureLog('fatal', [`${msg} (at ${url}:${line}:${col})`, error]);
    return false; // Let default handler run
};

// Lock to prevent concurrent failovers destroying the boot cycle
window._isSwitchingServers = false;

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
                    const localData = JSON.parse(localStorage.getItem(localKey) || '[]');
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
            const raw = JSON.parse(localStorage.getItem(key) || '[]');
            const safeArray = Array.isArray(raw) ? raw : [];

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

            await migrateLocalStateToActiveServer({ silent: true });
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

window.onload = async function() {
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
            #study-webview-container { flex: 1; position: relative; }
            .study-webview { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none; }
            .study-webview.hidden { visibility: hidden; }
            
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

            /* --- GLOBAL SMOOTHING --- */
            body, .card, .dash-card, .modal-box, input, select, textarea, button, .nav-item, table, tr, td, th, .sidebar, .content-wrapper {
                transition: background-color 0.4s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.4s cubic-bezier(0.4, 0, 0.2, 1), color 0.4s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            }
        `;
        document.head.appendChild(style);
    }

    // SHOW LOADER
    const loader = document.getElementById('global-loader');
    if(loader) loader.classList.remove('hidden');

    // --- NATIVE DISK CACHE RECOVERY ---
    if (window.electronAPI && window.electronAPI.disk) {
        // If critical data is missing, the browser cache was likely wiped.
        if (!localStorage.getItem('users') || localStorage.length < 5) {
            console.warn("LocalStorage appears empty/wiped. Attempting native disk recovery...");
            try {
                const cacheData = await window.electronAPI.disk.loadCache();
                if (cacheData) {
                    const parsed = JSON.parse(cacheData);
                    if (parsed.DEMO_MODE === 'true' || parsed.IS_SANDBOX_DB === 'true') {
                        console.warn("Disk cache contains Sandbox Data. Discarding to protect production.");
                        window.electronAPI.disk.saveCache('{}');
                    } else {
                        Object.keys(parsed).forEach(k => localStorage.setItem(k, parsed[k]));
                        console.log("Successfully restored data from Native Disk Cache.");
                    }
                }
            } catch(e) { console.error("Disk Recovery failed:", e); }
        }
    }

    // GET APP VERSION
    if (typeof require !== 'undefined') {
        const { ipcRenderer } = require('electron');
        ipcRenderer.invoke('get-app-version').then(ver => {
            window.APP_VERSION = ver;
            // NEW: Check for release notes
            if (typeof checkReleaseNotes === 'function') checkReleaseNotes(ver);
        });

        // NEW: Check if update is ALREADY waiting (Handle Reloads/Logouts)
        ipcRenderer.invoke('get-update-status').then(isReady => {
            if (isReady) {
                window.UPDATE_DOWNLOADED = true;
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

    // --- UPDATE CHANNEL CONFIGURATION ---
    // Tell Electron if we want Beta/Pre-releases based on our Staging status
    if (typeof require !== 'undefined') {
        const { ipcRenderer } = require('electron');
        const target = localStorage.getItem('active_server_target');
        if (target === 'staging') {
            ipcRenderer.send('set-update-channel', 'staging');
        } else {
            ipcRenderer.send('set-update-channel', 'prod');
        }
    }

    // --- IMPERSONATION CHECK ---
    const realAdmin = sessionStorage.getItem('real_admin_identity');
    if (realAdmin) {
        const banner = document.createElement('div');
        banner.style.cssText = "position:fixed; top:0; left:0; width:100%; background:#e74c3c; color:white; text-align:center; padding:5px; z-index:99999; font-weight:bold; cursor:pointer;";
        banner.innerHTML = `<i class="fas fa-mask"></i> You are impersonating a user. Click here to return to Admin.`;
        banner.onclick = function() {
            sessionStorage.setItem('currentUser', realAdmin);
            sessionStorage.removeItem('real_admin_identity');
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
            window.CURRENT_USER = JSON.parse(earlySession);
            // Render Skeletons
            if (typeof renderLoadingDashboard === 'function') renderLoadingDashboard();
            // Hide Loader immediately so user sees the skeleton UI
            if(loader) loader.classList.add('hidden');
        } catch(e) { console.error("Early render failed", e); }
    }

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

        // MASTER AUTHORITY: The local device retains all offline work.
        // Push the complete local state to the new server and destroy server-side ghost data.
        try {
            await migrateLocalStateToActiveServer({ loaderText: "Synchronizing Data to New Server..." });
                console.log("Migration: Target server synchronized with local state.");
        } catch(e) { 
            console.error("Migration Push Failed:", e); 
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
    let users = JSON.parse(localStorage.getItem('users') || '[]');
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
    
    // --- UPDATE RESTORATION LOGIC ---
    const restoreStateStr = localStorage.getItem('pending_update_restore');
    if (restoreStateStr) {
        try {
            const state = JSON.parse(restoreStateStr);
            localStorage.removeItem('pending_update_restore');
            
            if (state.user) {
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
        // Verify IP again on refresh to prevent session hijacking across locations
        if (typeof checkAccessControl === 'function') {
            checkAccessControl().then(async allowed => {
                if(allowed) {
                    CURRENT_USER = JSON.parse(savedSession);
                    if (typeof persistAppSession === 'function') persistAppSession(CURRENT_USER);
                    // --- NEW: Apply User Specific Theme Immediately ---
                    applyUserTheme(); 
                    
                    // Check for experimental theme
                    const expTheme = localStorage.getItem('experimental_theme');
                    if (expTheme) applyExperimentalTheme(expTheme);
                    
                    // --------------------------------------------------
                    // Update Sidebar based on Role
                    updateSidebarVisibility();
                    
                    // --- START ACTIVITY MONITOR ---
                    if (typeof StudyMonitor !== 'undefined') {
                        await StudyMonitor.init();
                    }
                    
                    // --- START VETTING ENFORCER ---
                    if (typeof initVettingEnforcer === 'function') initVettingEnforcer();
                    
                    if (typeof autoLogin === 'function') autoLogin();
                } else {
                    sessionStorage.removeItem('currentUser'); // Clear invalid session
                    if (typeof clearPersistentAppSession === 'function') clearPersistentAppSession();
                }
            });
        } else {
            // Fallback if IP check isn't loaded
             CURRENT_USER = JSON.parse(savedSession);
             if (typeof persistAppSession === 'function') persistAppSession(CURRENT_USER);
             applyUserTheme();
             
             // Check for experimental theme
             const expTheme = localStorage.getItem('experimental_theme');
             if (expTheme) applyExperimentalTheme(expTheme);

             updateSidebarVisibility();
             
             // --- START ACTIVITY MONITOR ---
             if (typeof StudyMonitor !== 'undefined') {
                 await StudyMonitor.init();
             }
             
             // --- START VETTING ENFORCER ---
             if (typeof initVettingEnforcer === 'function') initVettingEnforcer();

             if (typeof autoLogin === 'function') autoLogin();
        }
    } else {
        // --- CHECK REMEMBER ME ---
        const remembered = localStorage.getItem('rememberedUser');
        if (remembered) {
            try {
                const creds = JSON.parse(remembered);
                const allUsers = JSON.parse(localStorage.getItem('users') || '[]');
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
            // FIX: Initialize Login UI State (Admin Default) if nothing remembered
            if (typeof toggleLoginMode === 'function') toggleLoginMode('admin');
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
    setInterval(updateNotifications, 60000);
    // Also run once immediately if logged in
    if(savedSession) setTimeout(updateNotifications, 1000); 

    // --- NEW: AUTO-UPDATE POLLER ---
    // Actively check for updates every 30 minutes so the bell icon appears for open apps
    if (typeof require !== 'undefined') {
        setInterval(() => {
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('manual-update-check');
        }, 1800000); // 30 mins
    }

    // --- MANDATORY ATTENDANCE CHECK (Session Restore) ---
    if (savedSession && typeof checkAttendanceStatus === 'function') {
        setTimeout(checkAttendanceStatus, 1500); 
    }

    // --- LUNCH TIMER LOGIC ---
    setInterval(updateLunchTimer, 1000);
    updateLunchTimer();

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
function applyUserTheme() {
    const localTheme = JSON.parse(localStorage.getItem('local_theme_config') || 'null');
    if (!localTheme) return; // Fallback to CSS defaults

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
}

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
    let stored = {};
    try {
        stored = JSON.parse(localStorage.getItem('experimental_theme_custom') || '{}');
    } catch (e) {}
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
    const activeTheme = localStorage.getItem('experimental_theme') || '';
    const labels = {
        'theme-custom-lab': 'Custom Lab',
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
        badge.textContent = activeTheme ? `Current: ${labels[activeTheme] || 'Custom Preset'}` : 'Current: Original';
    }

    syncCustomThemeControlUI(getStoredCustomExperimentalThemeConfig());
}

function applyExperimentalTheme(themeName) {
    // 1. Remove all experimental classes
    document.body.classList.remove('exp-theme-active', 'exp-theme-wallpaper', 'theme-custom-lab', 'theme-cyberpunk', 'theme-ocean', 'theme-forest', 'theme-royal');
    clearCustomExperimentalThemeVariables();
    
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
        localStorage.setItem('experimental_theme', themeName);
    } else {
        // 3. Reset
        localStorage.removeItem('experimental_theme');
        // Re-apply user theme to ensure we go back to normal
        if (typeof applyUserTheme === 'function') applyUserTheme();
    }

    updateExperimentalThemePickerState();
}

// --- SIDEBAR VISIBILITY LOGIC ---
function updateSidebarVisibility() {
    if (!CURRENT_USER) return;

    const role = CURRENT_USER.role;
    
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

    // --- INJECT SUPER ADMIN BUTTON ---
    // Moved outside the loop to ensure it runs reliably
    const existingSaBtn = document.getElementById('btn-super-admin');
    
    // Force removal if not super admin
    if (role !== 'super_admin' && existingSaBtn) existingSaBtn.remove();

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

            if (document.getElementById('btn-super-admin')) return true;
            
            const bubbleContent = document.querySelector('.control-bubble .bubble-content');
            const adminToolsBtn = document.getElementById('btn-admin-tools');
            
            if (bubbleContent) {
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
        
        // Safety check for onclick attribute
        const clickAttr = btn.getAttribute('onclick');
        if (!clickAttr) return;

        const match = clickAttr.match(/'([^']+)'/);
        const targetTab = match ? match[1] : null;
        
        if (!targetTab) return;
        
        // --- DYNAMIC FEATURE FLAGS ---
        const config = JSON.parse(localStorage.getItem('system_config') || '{}');
        const features = config.features || {};

        if (features.live_assessments === false && (targetTab === 'live-assessment' || targetTab === 'live-execution')) {
            btn.classList.add('hidden');
            return;
        }
        if (features.vetting_arena === false && targetTab === 'vetting-arena') {
            btn.classList.add('hidden');
            return;
        }

        // Hide isolated super admin tools from everyone except Super Admin
        if ((targetTab === 'vetting-rework' || targetTab === 'superadmin-studio') && role !== 'super_admin') {
            btn.classList.add('hidden');
            return;
        }

        // Rules
        if (role === 'trainee') {
            // Trainees hide Admin, Manage, Capture, Monthly, Insights
            const hiddenForTrainee = ['admin-panel', 'manage', 'capture', 'insights', 'test-manage', 'test-records', 'live-assessment', 'vetting-rework', 'superadmin-studio'];
            const visibleForTrainee = ['assessment-schedule', 'my-tests', 'dashboard-view', 'live-assessment', 'vetting-arena', 'live-execution', 'monthly', 'test-records'];
            
            // Special Check for Arena
            if (targetTab === 'vetting-arena') {
                const session = JSON.parse(localStorage.getItem('vettingSession') || '{"active":false}');
                if (!session.active) btn.classList.add('hidden');
                return;
            }
            
            if (!visibleForTrainee.includes(targetTab)) btn.classList.add('hidden');
        } 
        else if (role === 'teamleader') {
            // Team Leaders hide Admin, Test Builder, My Tests, Live Assessment
            // NOTE: 'tl-hub' hidden temporarily while in development
            const hiddenForTL = ['test-manage', 'my-tests', 'live-assessment', 'live-execution', 'insights', 'manage', 'capture', 'tl-hub', 'vetting-rework', 'superadmin-studio'];
            if (hiddenForTL.includes(targetTab)) btn.classList.add('hidden');
        }
        else if (role === 'admin') {
            // Admins hide "My Tests" (Take Test) usually, but we keep it visible for testing purposes
            if (targetTab === 'my-tests') btn.classList.add('hidden');
        }
    });
}

let TAB_SWITCH_TIMEOUT = null;

function showTab(id, btn) {
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
      const forbidden = ['test-manage', 'my-tests', 'live-assessment', 'insights', 'manage', 'capture', 'vetting-rework', 'superadmin-studio'];
      if(forbidden.includes(id)) {
          return; // Simply do nothing
      }
  }

  if (CURRENT_USER && CURRENT_USER.role !== 'super_admin' && id === 'superadmin-studio') {
      return;
  }
  
  // --- ROGUE TIMER PREVENTION ---
  // If we are leaving the test view, kill the active timer to prevent background auto-submits
  if (id !== 'test-take-view' && id !== 'vetting-arena' && window.TEST_TIMER) {
      clearInterval(window.TEST_TIMER);
  }

  // Kill Live Arena Poller if leaving the tab
  if (id !== 'live-execution' && window.LIVE_POLLER) {
      clearInterval(window.LIVE_POLLER);
  }

  if (TAB_SWITCH_TIMEOUT) clearTimeout(TAB_SWITCH_TIMEOUT);

  const current = document.querySelector('section.active');
  if (current && current.id === id) return;

  const executeSwitch = () => {
      // HIDDEN LOGIC: Reset views
      document.querySelectorAll('section').forEach(s => {
          s.classList.remove('active');
          s.classList.remove('tab-exit-anim');
          s.classList.remove('tab-enter-anim');
      });
      
      const target = document.getElementById(id);
      if(target) {
          target.classList.add('active');
          target.classList.add('tab-enter-anim');
      }
      
      // Update Sidebar
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      
      // Find button by onclick attribute (reliable for sidebar navigation)
      const sidebarBtn = document.querySelector(`button.nav-item[onclick="showTab('${id}')"]`);
      if(sidebarBtn) sidebarBtn.classList.add('active');

      // --- ACTIVITY TRACKING ---
      if (typeof StudyMonitor !== 'undefined') {
          StudyMonitor.track(`Navigating: ${id.replace(/-/g, ' ')}`);
      }

      // VISUAL FIX: Auto-resize textareas when tab becomes visible
      setTimeout(() => {
          document.querySelectorAll('textarea.auto-expand').forEach(el => autoResize(el));
      }, 50);
        
      // --- DYNAMIC DATA REFRESH ---
      // Whenever a tab is shown, refresh its specific data/dropdowns

      // NEW: Render Dashboard if Home Tab is clicked
      if(id === 'dashboard-view') {
          if(typeof renderDashboard === 'function') setTimeout(renderDashboard, 0); // Async render to ensure container is ready
          
          // FIX: Force Calendar Widget render (Today's Tasks)
          if(typeof CalendarModule !== 'undefined' && typeof CalendarModule.renderWidget === 'function') {
              setTimeout(() => CalendarModule.renderWidget(), 200);
          }
      }

      // === CORRECTED: Training Insight Tab ===
      if(id === 'insights') {
          // 1. Try to render the full dashboard
          if(typeof renderInsightDashboard === 'function') {
              try {
                renderInsightDashboard();
              } catch (e) {
                console.error("Dashboard Render Failed:", e);
              }
          }
          
          // 2. SAFETY: Explicitly populate the dropdown using the CORRECT function name
          if(typeof populateInsightGroupFilter === 'function') {
              try {
                populateInsightGroupFilter();
              } catch(e) {
                console.error("populateInsightGroupFilter failed:", e);
              }
          }
      }
      
      if(id === 'manage') {
          if(typeof loadRostersList === 'function') loadRostersList();
          if(typeof populateYearSelect === 'function') populateYearSelect(); 
      }
      
      if(id === 'capture') {
          if(typeof loadRostersToSelect === 'function') loadRostersToSelect('selectedGroup');
          if(typeof updateAssessmentDropdown === 'function') updateAssessmentDropdown();
          // Set default date to today
          const dateInput = document.getElementById('captureDate');
          if(dateInput && !dateInput.value) dateInput.value = new Date().toISOString().split('T')[0];
      }
      
      if(id === 'monthly') {
          if(typeof loadAllDataViews === 'function') loadAllDataViews(); 
      }
      
      if(id === 'report-card') {
          if(typeof loadReportTab === 'function') loadReportTab(); 
          
          // TEAM LEADER: Force View to Saved Reports Only
          if(CURRENT_USER && CURRENT_USER.role === 'teamleader') {
              setTimeout(() => {
                  // Hide "Create New" button
                  const btnCreate = document.getElementById('btn-rep-new');
                  if(btnCreate) btnCreate.style.display = 'none';

                  // Automatically click "Saved Reports"
                  const btnSaved = document.getElementById('btn-rep-saved');
                  if(btnSaved) btnSaved.click();
              }, 50);
          }
      }

      if(id === 'agent-search') {
          if(typeof loadAgentSearch === 'function') loadAgentSearch();
      }

      if(id === 'tl-hub') {
          if(typeof TLTasks !== 'undefined' && typeof TLTasks.renderUI === 'function') {
              TLTasks.renderUI();
          } else {
              console.error("TLTasks module not loaded. Check js/tl_tasks.js");
          }
      }

      if(id === 'live-assessment') {
          if(typeof renderLiveTable === 'function') renderLiveTable();
      }
      
      if(id === 'assessment-schedule') {
          if(typeof renderSchedule === 'function') renderSchedule(); 
      }

      if(id === 'live-execution') {
          if(typeof loadLiveExecution === 'function') {
              loadLiveExecution();
          } else {
              // Fallback if script is still loading
              setTimeout(() => {
                  if(typeof loadLiveExecution === 'function') loadLiveExecution();
                  else alert("Error: Live Execution script not loaded. Please refresh.");
              }, 500);
          }
      }
      
      if(id === 'admin-panel') { 
          if(typeof loadAdminUsers === 'function') loadAdminUsers(); 
          if(typeof loadAdminAssessments === 'function') loadAdminAssessments(); 
          if(typeof loadAdminVetting === 'function') loadAdminVetting();
          if(typeof loadAdminDatabase === 'function') loadAdminDatabase(); 
          if(typeof loadAdminAccess === 'function') loadAdminAccess(); 
          if(typeof loadAdminTheme === 'function') loadAdminTheme(); 

          // TRAINEE FILTER: Only show their own user in the list
          if (CURRENT_USER && CURRENT_USER.role === 'trainee' && typeof filterUserListForTrainee === 'function') {
              setTimeout(filterUserListForTrainee, 50); // Small delay to ensure table is populated
          }
          
          // NEW: Refresh System Status if that specific view is open
          const statusView = document.getElementById('admin-view-status');
          if(statusView && statusView.classList.contains('active')) {
              if(typeof refreshSystemStatus === 'function') refreshSystemStatus();
          }
          
          // NEW: Refresh Graduated Agents if that specific view is open
          const gradView = document.getElementById('admin-view-graduated');
          if(gradView && gradView.classList.contains('active')) {
              if(typeof loadGraduatedAgents === 'function') loadGraduatedAgents();
          }
      }
      
      if(id === 'test-manage') {
          if(typeof loadManageTests === 'function') loadManageTests();
          if(typeof loadAssessmentDashboard === 'function') loadAssessmentDashboard();
          if(typeof loadMarkingQueue === 'function') loadMarkingQueue();
      }
      
      if(id === 'my-tests') {
          if(typeof loadTraineeTests === 'function') loadTraineeTests();
      }
      
      if(id === 'test-records') {
          if(typeof loadTestRecords === 'function') loadTestRecords();
      }
      
      if(id === 'vetting-arena') {
          if(typeof loadVettingArena === 'function') loadVettingArena();
      }

      if(id === 'vetting-rework') {
          console.log("[Router] Vetting Rework tab clicked.");
          if(typeof VettingReworkLoader !== 'undefined' && typeof VettingReworkLoader.renderUI === 'function') {
              console.log("[Router] Executing Loader...");
              VettingReworkLoader.renderUI();
          } else {
              console.error("VettingReworkLoader module not loaded.");
          }
      }

      if(id === 'superadmin-studio') {
          console.log("[Router] Super Admin Data Studio tab clicked.");
          if(typeof SuperAdminDataStudioLoader !== 'undefined' && typeof SuperAdminDataStudioLoader.renderUI === 'function') {
              SuperAdminDataStudioLoader.renderUI();
          } else {
              console.error("SuperAdminDataStudioLoader module not loaded.");
          }
      }
  };

  if (current) {
      current.classList.add('tab-exit-anim');
      TAB_SWITCH_TIMEOUT = setTimeout(executeSwitch, 350);
  } else {
      executeSwitch();
  }
}

function showAdminSub(viewName, btn) {
  document.querySelectorAll('.admin-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('admin-view-' + viewName).classList.add('active');
  if(btn) btn.classList.add('active');
  
  // Trigger specific refresh for sub-tabs
  if(viewName === 'status' && typeof refreshSystemStatus === 'function') {
      refreshSystemStatus();
  }
  if(viewName === 'updates' && typeof loadAdminUpdates === 'function') {
      loadAdminUpdates();
  }
  if(viewName === 'attendance' && typeof loadAttendanceDashboard === 'function') {
      loadAttendanceDashboard();
  }
  if(viewName === 'graduated' && typeof loadGraduatedAgents === 'function') {
      loadGraduatedAgents();
  }
}

/* ================= HEADER BUTTONS ================= */

async function refreshApp() {
    // Visual Feedback
    const btn = document.querySelector('.icon-btn[title="Refresh"] i');
    if(btn) btn.classList.add('fa-spin');
    
    // Force Cloud Sync before reloading
    if (typeof loadFromServer === 'function') {
        await loadFromServer(true);
    }
    location.reload();
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
    document.body.classList.toggle('light-mode');
    // Save preference
    const isLight = document.body.classList.contains('light-mode');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
}

/* ================= NOTIFICATIONS ================= */
function toggleNotifications() {
    const drop = document.getElementById('notificationDropdown');
    drop.classList.toggle('hidden');
    if(!drop.classList.contains('hidden')) updateNotifications();
}

function updateNotifications() {
    const notifList = document.getElementById('notifList');
    const badge = document.getElementById('notifBadge');
    if(!notifList || !badge) return; // Safety check

    notifList.innerHTML = '';
    let count = 0;

    // 1. SYSTEM UPDATE NOTIFICATION (Global for all roles)
    if (sessionStorage.getItem('update_ready') === 'true') {
        count++;
        notifList.innerHTML += `
        <div class="notif-item" onclick="restartAndInstall()" style="background:rgba(46, 204, 113, 0.1); border-left:3px solid #2ecc71; cursor:pointer;">
            <div style="display:flex; align-items:center; gap:10px;">
                <i class="fas fa-arrow-circle-up" style="color:#2ecc71; font-size:1.2rem;"></i>
                <div>
                    <strong>Update Ready</strong>
                    <div style="font-size:0.8rem; color:var(--text-muted);">Click to Restart & Install</div>
                </div>
            </div>
        </div>`;
    }

    // 2. TRAINEE SPECIFIC NOTIFICATIONS
    if (CURRENT_USER && CURRENT_USER.role === 'trainee') {
        // --- PROGRESS LOGIC ---
        const records = JSON.parse(localStorage.getItem('records') || '[]');
        const myRecords = records.filter(r => r.trainee === CURRENT_USER.user);
        
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
        const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
        const myBookings = bookings.filter(b => b.trainee === CURRENT_USER.user);
        
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

    // 3. EMPTY STATE
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
    const assessments = JSON.parse(localStorage.getItem('assessments') || '[]');
    const records = JSON.parse(localStorage.getItem('records') || '[]');
    
    // Combine names from Definitions and actual Records (history)
    const names = new Set();
    assessments.forEach(a => names.add(a.name));
    records.forEach(r => { if(r.assessment) names.add(r.assessment); });
    
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

// --- GLOBAL UPDATE LISTENERS ---
if (typeof require !== 'undefined') {
    const { ipcRenderer } = require('electron');

    ipcRenderer.on('update-message', (event, message) => {
        // Notify when an update is found and starting download
        if (message.text && message.text.includes('Update available')) {
            if(typeof showToast === 'function') showToast("New update found! Downloading...", "info");
        }
    });

    ipcRenderer.on('update-downloaded', (event) => {
        window.UPDATE_DOWNLOADED = true;
        
        // NEW: Set flag for notification bell
        sessionStorage.setItem('update_ready', 'true');
        if(typeof updateNotifications === 'function') updateNotifications();

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
            // We don't await here to ensure restart happens even if network is slow
            saveToServer(null, true).catch(e => console.warn("Update Sync Warning:", e));
        }
    }

    // 2. Trigger Restart
    restartAndInstall();
};

/* ================= INACTIVITY & DRAFT HANDLING ================= */

window.cacheAndLogout = async function() {
    console.log("Inactivity detected. Caching and logging out...");
    
    const isDemo = localStorage.getItem('DEMO_MODE') === 'true';

    if (CURRENT_USER && typeof logAccessEvent === 'function') {
        await logAccessEvent(CURRENT_USER.user, 'Timeout');
    }
    
    // 1. Cache Assessment (If taking a test)
    const takingView = document.getElementById('test-take-view');
    if (takingView && takingView.classList.contains('active')) {
        if (typeof saveAssessmentDraft === 'function') saveAssessmentDraft();
    }
    
    // 2. Cache Test Builder (If creating a test)
    const builderView = document.getElementById('test-builder');
    if (builderView && builderView.classList.contains('active')) {
        if (typeof saveBuilderDraft === 'function') saveBuilderDraft();
    }

    const limit = (CURRENT_USER && CURRENT_USER.idleTimeout) ? CURRENT_USER.idleTimeout : 15;
    alert(`You have been logged out due to inactivity (${limit} mins).\n\nYour current work has been cached locally and will be restored when you log back in.`);
    
    sessionStorage.clear();
    if (isDemo) localStorage.clear();
    
    window.location.reload();
};

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
    const lastVersion = localStorage.getItem('last_seen_version');
    const hasUsers = localStorage.getItem('users'); // Check if app was used before (not a fresh install)

    // Show notes if:
    // 1. We have a last version and it differs from current (Standard Update)
    // 2. We have NO last version but we DO have users (Existing user getting this feature for the first time)
    if ((lastVersion && lastVersion !== currentVersion) || (!lastVersion && hasUsers)) {
        showReleaseNotes(currentVersion);
    }
    
    // Update storage to current
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
            "2.6.7": `
                <ul style="padding-left: 20px; margin: 0;">
                    <li style="margin-bottom: 8px;"><strong>Live Arena 1-Second Hard Sync:</strong> Added a strict 1s targeted live-session refresh loop while the Live Execution tab is open to catch updates even during realtime tunnel instability.</li>
                    <li style="margin-bottom: 8px;"><strong>Trainee Update Reliability:</strong> Exposed force-refresh-by-session-id as a shared helper so trainer/trainee clients can continuously confirm the latest question state without logout/login.</li>
                </ul>`,
            "2.6.6": `
                <ul style="padding-left: 20px; margin: 0;">
                    <li style="margin-bottom: 8px;"><strong>Live Arena Command Channel:</strong> Added a guaranteed <code>sessions.pending_action</code> nudge path so trainee clients force-refresh the target live session immediately on trainer question pushes.</li>
                    <li style="margin-bottom: 8px;"><strong>Diagnostic Reliability:</strong> Test Connection now triggers the same live-sync nudge path to reduce false timeouts when <code>live_sessions</code> realtime events are delayed.</li>
                    <li style="margin-bottom: 8px;"><strong>Resync Guardrail:</strong> Added targeted <code>live_sessions</code> fetch-by-session-id handling when a <code>live_sync</code> command arrives, keeping question progression live without requiring trainee logout/login.</li>
                </ul>`,
            "2.6.5": `
                <ul style="padding-left: 20px; margin: 0;">
                    <li style="margin-bottom: 8px;"><strong>Release Rollout Update:</strong> Version increment for stable distribution and deployment alignment.</li>
                    <li style="margin-bottom: 8px;"><strong>Live Arena Baseline:</strong> Carries forward the latest realtime reliability and boot hotfix improvements from v2.6.3/v2.6.4.</li>
                </ul>`,
            "2.6.4": `
                <ul style="padding-left: 20px; margin: 0;">
                    <li style="margin-bottom: 8px;"><strong>Critical Boot Hotfix:</strong> Fixed a JavaScript parsing break in the release notes renderer that could stop app initialization on launch.</li>
                    <li style="margin-bottom: 8px;"><strong>Live Arena Stability:</strong> Preserved the v2.6.3 realtime reliability improvements while correcting release-note formatting to avoid runtime crashes.</li>
                </ul>`,
            "2.6.3": `
                <ul style="padding-left: 20px; margin: 0;">
                    <li style="margin-bottom: 8px;"><strong>Live Arena Realtime Reliability:</strong> Hardened live session propagation so trainee question changes refresh immediately without requiring manual exit/re-entry.</li>
                    <li style="margin-bottom: 8px;"><strong>Partial Realtime Recovery:</strong> Added automatic <code>live_sessions</code> row recovery when Supabase realtime sends partial payloads, preventing missed question updates.</li>
                    <li style="margin-bottom: 8px;"><strong>Deterministic Session Versioning:</strong> Added monotonic live revision and question-push timestamps to improve update ordering and render consistency between trainer and trainee clients.</li>
                    <li style="margin-bottom: 8px;"><strong>Live Cache Event Hooks:</strong> Live Execution now responds directly to <code>liveSessions</code> cache change events for faster UI synchronization under unstable network conditions.</li>
                </ul>`,
            "2.6.2": `
                <ul style="padding-left: 20px; margin: 0;">
                    <li style="margin-bottom: 8px;"><strong>Schedule Studio Templates:</strong> Added admin-managed timeline templates with editable step durations and one-click apply flow directly inside the isolated Schedule Studio module.</li>
                    <li style="margin-bottom: 8px;"><strong>Business-Day Auto Dates:</strong> Timeline start/end windows now auto-calculate from duration days while skipping weekends and configured holidays.</li>
                    <li style="margin-bottom: 8px;"><strong>Timeline Management:</strong> Restored clear Delete Timeline controls in Schedule Studio and tightened module ownership so timeline/template workflows run in Studio.</li>
                    <li style="margin-bottom: 8px;"><strong>Microsoft Link Reliability:</strong> Improved SharePoint/OneDrive URL normalization, including Outlook SafeLinks unwrapping, to reduce blank/error opens in the study browser.</li>
                </ul>`,
            "2.6.1": `
                <ul style="padding-left: 20px; margin: 0;">
                    <li style="margin-bottom: 8px;"><strong>Microsoft Study Links:</strong> Preserved Microsoft/SharePoint links exactly as entered to avoid token loss on valid shared URLs.</li>
                    <li style="margin-bottom: 8px;"><strong>Trainee Schedule Scope:</strong> Fixed trainee schedule visibility so learners only see the schedule assigned to their own group, including calendar mode.</li>
                    <li style="margin-bottom: 8px;"><strong>Profile & Settings Upgrade:</strong> Expanded trainee personalization with Experimental Theme controls, including Custom Lab tuning options.</li>
                    <li style="margin-bottom: 8px;"><strong>Study Browser Recovery:</strong> Added in-browser cache/session clear action to troubleshoot Microsoft sign-in loops directly from the study toolbar.</li>
                </ul>`,
            "2.6.0": `
                <ul style="padding-left: 20px; margin: 0;">
                    <li style="margin-bottom: 8px;"><strong>User Management Reliability:</strong> Hardened delete/edit behavior with case-insensitive tombstones and live username targeting so removed users and profile edits no longer randomly revert after sync or restart.</li>
                    <li style="margin-bottom: 8px;"><strong>Sync Stability:</strong> Reworked incoming realtime queue processing into guarded chunks to reduce heavy main-thread spikes that could make text fields feel unresponsive during high-volume sync bursts.</li>
                    <li style="margin-bottom: 8px;"><strong>Study Browser Local Cache:</strong> Added local page snapshot caching with automatic cached-copy fallback when SharePoint/study pages fail to load.</li>
                    <li style="margin-bottom: 8px;"><strong>Theme Builder Upgrade:</strong> Custom Lab now supports Wallpaper URL overlays directly in the Experimental Theme Builder while keeping one-click revert behavior.</li>
                </ul>`,
            "2.5.9": `
                <ul style="padding-left: 20px; margin: 0;">
                    <li style="margin-bottom: 8px;"><strong>Live Booking Reliability:</strong> Added a new Booking Integrity Check + auto-repair workflow to detect and fix duplicate IDs, slot collisions, invalid statuses, and stale/duplicate trainee bookings before they break downstream views.</li>
                    <li style="margin-bottom: 8px;"><strong>Arena Stability:</strong> Hardened booking normalization so Live Assessment Arena state remains aligned with Live Booking and Assessment Breakdown datasets after admin edits.</li>
                    <li style="margin-bottom: 8px;"><strong>Theme Lab Upgrade:</strong> Rebuilt Experimental Themes with stronger app-wide visual impact (animated backgrounds, richer card/button/nav behavior) and added a full Custom Theme Builder with preview/save/reset controls.</li>
                </ul>`,
            "2.5.8": `
                <ul style="padding-left: 20px; margin: 0;">
                    <li style="margin-bottom: 8px;"><strong>Critical Fix:</strong> Resolved an invisible "zombie process" bug that prevented the app from closing completely, which occasionally blocked auto-updates from installing.</li>
                </ul>`,
            "2.5.7": `
                <ul style="padding-left: 20px; margin: 0;">
                    <li style="margin-bottom: 8px;"><strong>System Update:</strong> Version bump and minor maintenance.</li>
                </ul>`,
            "2.5.6": `
                <ul style="padding-left: 20px; margin: 0;">
                    <li style="margin-bottom: 8px;"><strong>Feature: Super Admin Live Data Studio.</strong> Added a new, fully isolated module exclusively for Super Admins to view and edit live database records securely through a user-friendly interface.</li>
                </ul>`,
            "2.5.5": `
                <ul style="padding-left: 20px; margin: 0;">
                    <li style="margin-bottom: 8px;"><strong>Persistent Login Restore:</strong> The desktop app now restores the last valid app session across full app closes until the user explicitly logs out, instead of forcing repeated sign-ins after each restart.</li>
                    <li style="margin-bottom: 8px;"><strong>Microsoft Study Session Handling:</strong> Hardened the persistent Electron study-browser session for SharePoint and Microsoft sign-in flows so training material behaves more reliably on trainee installs.</li>
                    <li style="margin-bottom: 8px;"><strong>Team Leader Hub Feedback Rebuild:</strong> Replaced the old production feedback flow with the new step-based capture wizard and upgraded the Question Creator to support linked ticket paths, filtering, and search.</li>
                </ul>`,
            "2.5.4": `
                <ul style="padding-left: 20px; margin: 0;">
                    <li style="margin-bottom: 8px;"><strong>Study Browser Controls:</strong> Reworked the in-app study browser toolbar so Back, Forward, Reload, Home, Mark for Clarity, Dashboard, Program Links, and Exit remain usable after opening study links in new tabs.</li>
                    <li style="margin-bottom: 8px;"><strong>Browser UX:</strong> Redesigned the browser shell with a dedicated control deck and stronger tab handling so the controls are easier to click and more stable during normal training use.</li>
                </ul>`,
            "2.5.3": `
                <ul style="padding-left: 20px; margin: 0;">
                    <li style="margin-bottom: 8px;"><strong>Study Browser Hardening:</strong> Fixed the secure in-app browser bridge so Schedule study material stays inside the Electron study overlay instead of falling back to an external browser.</li>
                    <li style="margin-bottom: 8px;"><strong>Browser Reliability:</strong> Improved study tab navigation, reload handling, title updates, and failed-load feedback to make the internal browser more stable during normal use.</li>
                    <li style="margin-bottom: 8px;"><strong>Security Rules:</strong> Preserved the existing OS-level monitoring model while adding a safe exception for the Windows Snipping Tool so it no longer triggers false-positive external app violations.</li>
                </ul>`,
            "2.5.2": `
                <ul style="padding-left: 20px; margin: 0;">
                    <li style="margin-bottom: 8px;"><strong>Data Integrity:</strong> Fixed a critical case-sensitivity bug in the Sync Engine that caused Trainee records and scores to randomly disappear or fail to load.</li>
                    <li style="margin-bottom: 8px;"><strong>Test Engine:</strong> Defused a bug where stale or abandoned Vetting Sessions would violently pull trainees out of their active standard assessments.</li>
                </ul>`,
            "2.5.1": `
                <ul style="padding-left: 20px; margin: 0;">
                    <li style="margin-bottom: 8px;"><strong>Hotfix & Polish:</strong> Resolved a startup crash (SyntaxError) in the release notes viewer and finalized the stable deployment of the new Teamleader Hub Agent Feedback System.</li>
                </ul>`,
        "2.5.0": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature: Agent Feedback System.</strong> Added a comprehensive "Agent Production Feedback" form to the Teamleader Hub for capturing detailed performance notes.</li>
                <li style="margin-bottom: 8px;"><strong>Feature: Feedback Review Dashboard.</strong> Added a new dashboard for reviewing, analyzing, and exporting all captured agent feedback, complete with historical logs and performance summaries.</li>
                <li style="margin-bottom: 8px;"><strong>Data Integrity:</strong> The new feedback system saves all data to a dedicated cloud record ('tl_agent_feedback') and includes robust error handling to prevent data loss.</li>
                <li style="margin-bottom: 8px;"><strong>UX/UI:</strong> The feedback form dropdowns are now configurable on a per-question basis from the "Backend Data" tab for maximum flexibility.</li>
            </ul>`,
        "2.4.77": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Sync Reliability:</strong> Silent server switches now await the full migration push before pulling fresh data, and automatically roll back to the previous target if the migration fails.</li>
                <li style="margin-bottom: 8px;"><strong>Save Safety:</strong> Hardened the mutex save queue so failed uploads are re-queued instead of silently dropping unsynced keys during network or server errors.</li>
                <li style="margin-bottom: 8px;"><strong>Realtime Engine:</strong> Fallback polling is now disabled while the realtime tunnel is healthy, re-enabled at the role-based sync cadence when the tunnel drops, and the incoming queue now re-queues failed realtime batches instead of losing them.</li>
            </ul>`,
        "2.4.76": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Hotfix:</strong> Resolved a fatal SyntaxError during application startup by correctly awaiting the Activity Monitor's initialization sequence.</li>
                <li style="margin-bottom: 8px;"><strong>Log Integrity:</strong> Ensured fresh logins strictly await the completion of the daily log archiving process before recording new data.</li>
            </ul>`,
        "2.4.75": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Log Integrity:</strong> Fixed a startup race condition that caused logs from the previous day to bleed into the current day's timeline.</li>
                <li style="margin-bottom: 8px;"><strong>Activity Classification:</strong> Improved the logic for categorizing activities, correctly identifying training materials (.mp4, .pdf) and preventing them from being misclassified as "Tools".</li>
                <li style="margin-bottom: 8px;"><strong>AI Analysis:</strong> Overhauled the AI prompt to provide a structured, narrative summary of the day's events, including specific explanations for idle time and violations, rather than a generic assessment.</li>
            </ul>`,
        "2.4.74": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>AI Analyst Fix:</strong> Hardened the Gemini API integration to resolve connection errors related to CORS, API versions (v1/v1beta), and regional model availability.</li>
                <li style="margin-bottom: 8px;"><strong>AI Diagnostics:</strong> Added a "Test Connection" tool and a model selector dropdown to the Super Admin console, allowing for dynamic model selection to bypass regional restrictions.</li>
                <li style="margin-bottom: 8px;"><strong>AI Configuration:</strong> Implemented auto-correction for legacy endpoint URLs to prevent configuration-related failures.</li>
            </ul>`,
        "2.4.73": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Study Browser Fix:</strong> Removed the internal domain-blocking firewall. The browser now allows all navigation from trusted training materials, fixing complex login redirects (e.g., Microsoft SSO).</li>
                <li style="margin-bottom: 8px;"><strong>Security Model:</strong> Simplified security to rely on the OS-level Activity Monitor for flagging unauthorized external applications, as the internal browser has no URL bar for manual navigation.</li>
            </ul>`,
        "2.4.72": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Demo Sandbox:</strong> Added a fully isolated, interactive presentation environment. Logging in with 'demo_admin' instantly generates a rich, realistic mock database that never touches your production cloud.</li>
                <li style="margin-bottom: 8px;"><strong>State Protection:</strong> Implemented a 5-layer memory and network isolation shield (including Hard Reloads, Poison Pills, and Native Disk Firewalls) to guarantee sandbox data can never leak into the live environment.</li>
            </ul>`,
        "2.4.71": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Schedule Links:</strong> Added an automatic URL Sanitizer to strip expiring temporary tokens from SharePoint links, preventing study materials from becoming stale over time.</li>
                <li style="margin-bottom: 8px;"><strong>Activity Monitor:</strong> Fixed a wake-from-sleep race condition that occasionally caused the previous day's detailed timeline data to be lost during the morning sync.</li>
            </ul>`,
        "2.4.70": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Hotfix:</strong> Fixed a scrolling reset issue in the Activity Monitor's Detailed Breakdown and Recent History views caused by real-time background updates.</li>
            </ul>`,
        "2.4.69": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Hotfix:</strong> Resolved a dashboard rendering crash caused by variable assignment strictness in the new Activity Monitor URL cleaner.</li>
            </ul>`,
        "2.4.68": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Activity Monitor 3.0:</strong> Completely redesigned the Activity Summary with a 4-tier breakdown (Material, Tools, External, Idle). Added SharePoint URL cleaner, fixed time-scales for the timeline, added an archive date-picker, and locked scroll position during live updates.</li>
                <li style="margin-bottom: 8px;"><strong>Study Browser Firewall:</strong> Sealed the "Trojan Horse" loophole. Trainees can no longer bypass tracking by clicking external links (like YouTube) embedded inside PDF documents.</li>
                <li style="margin-bottom: 8px;"><strong>Performance Optimization:</strong> Parallelized the bootloader sync engine, slashing application startup time by up to 90%.</li>
                <li style="margin-bottom: 8px;"><strong>Assessment Protection:</strong> Incoming system updates will no longer interrupt active assessments with intrusive popups or restarts.</li>
            </ul>`,
        "2.4.67": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Study Browser:</strong> Fixed an issue where PDF viewers would steal focus and prevent the top navigation buttons (Dashboard, Exit, Mark for Clarity) from working on the first click.</li>
                <li style="margin-bottom: 8px;"><strong>Activity Monitor:</strong> Unauthorized external applications are now explicitly flagged as 'Violations' during working hours, with bold red highlighting in the Detailed Timeline and Review Queue.</li>
            </ul>`,
        "2.4.66": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Deep Architectural Hardening:</strong> Defused critical race conditions, state desynchronization bugs, and memory leaks across the platform.</li>
                <li style="margin-bottom: 8px;"><strong>Storage Optimization:</strong> Implemented aggressive client-side Canvas Compression for image uploads to completely eliminate "Quota Exceeded" crashes in LocalStorage.</li>
                <li style="margin-bottom: 8px;"><strong>Time & Attendance:</strong> Added a dynamic Lunch Timer UI and patched double-execution vulnerabilities in the clock-in/out and cancellation workflows.</li>
                <li style="margin-bottom: 8px;"><strong>Exploit Prevention:</strong> Fixed the "Time-Stop" cheat in assessments where users could indefinitely pause the clock by switching tabs.</li>
                <li style="margin-bottom: 8px;"><strong>Live Arena Stability:</strong> Intercepted background question pushes to force an instant save of trainee keystrokes before the screen re-renders, preventing answer loss.</li>
            </ul>`,
        "2.4.65": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Network Resilience:</strong> Hardened the Zero-Latency Real-Time tunnel. The app now silently falls back to high-speed 30-second polling if corporate firewalls block WebSockets, and continuously attempts to rebuild dropped connections to keep your UI instantly synced.</li>
            </ul>`,
        "2.4.64": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Performance Optimization:</strong> Trainee Data Minimization ensures trainees only download their own data, dropping bandwidth usage by 98%.</li>
                <li style="margin-bottom: 8px;"><strong>Zero-Latency Sync:</strong> Live Assessment and Vetting Arena now process WebSockets instantly, bypassing the background queue.</li>
                <li style="margin-bottom: 8px;"><strong>UX Improvements:</strong> Added native right-click context menu with spellcheck suggestions.</li>
            </ul>`,
        "2.4.63": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Performance Optimization:</strong> Drastically reduced database latency and bandwidth by adding SQL indexes to Cloud tables and restricting Activity Monitor payload downloads to Admin roles only.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Added a failsafe to silently discard extremely delayed "ghost" diagnostic popups in the Live Assessment Arena.</li>
            </ul>`,
        "2.4.62": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Study Browser:</strong> Fixed UI overlap causing navigation buttons to become unresponsive. Added Preseem to quick links.</li>
                <li style="margin-bottom: 8px;"><strong>Activity Monitor:</strong> Added whitelist exemptions for MS Teams and Outlook to prevent false violation warnings.</li>
            </ul>`,
        "2.4.61": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Study Monitor:</strong> Upgraded to a full Sandbox Browser with tabs, quick links, and active external app monitoring.</li>
                <li style="margin-bottom: 8px;"><strong>Notes & Bookmarks:</strong> Added cloud-synced Bookmarking with text highlighting and teleportation to exact scroll positions.</li>
                <li style="margin-bottom: 8px;"><strong>Tracking Accuracy:</strong> Activity Monitor now utilizes OS-level hardware tracking for bulletproof idle and active state detection.</li>
            </ul>`,
        "2.4.60": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Sync Engine Fix:</strong> Resolved a critical data truncation bug where background syncing would permanently skip downloading Trainee records. Trainee Dashboards will now fully populate.</li>
            </ul>`,
        "2.4.59": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Emergency Rescue:</strong> Forced stranded clients on the old infrastructure to connect directly to the new Local VM as the primary "Cloud" source.</li>
                <li style="margin-bottom: 8px;"><strong>UI Fix:</strong> Resolved missing data on the Trainee Dashboard caused by case-sensitivity mismatches in user names.</li>
            </ul>`,
        "2.4.58": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Upgraded the Sync Engine with 'Fault Tolerant Sandboxing'. If a specific data table encounters an error or payload limit, the system will now isolate the failure and allow the rest of the app to sync perfectly.</li>
            </ul>`,
        "2.4.57": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>System:</strong> Silenced phantom cloud pings. The app will no longer attempt to reach the destroyed cloud server for background diagnostic tests.</li>
            </ul>`,
        "2.4.55": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Data Integrity:</strong> Converted the 'users' database to Row-Level Sync to prevent Admin race conditions.</li>
                <li style="margin-bottom: 8px;"><strong>Data Integrity:</strong> Implemented global 'Soft Deletes' (Tombstones) to permanently eliminate 'Ghost Data'.</li>
                <li style="margin-bottom: 8px;"><strong>Grading Locks:</strong> Added Optimistic Concurrency Control (OCC) to prevent Admins from overwriting each other's manual score edits.</li>
            </ul>`,
        "2.4.54": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>System:</strong> Version synchronization to resolve GitHub auto-updater pipeline conflicts. Contains all recent stability patches.</li>
            </ul>`,
        "2.4.53": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Hotfix:</strong> Resolved a critical "infinite loop" bug during server failovers that could crash the application.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Added a mutex lock to the silent failover engine to prevent concurrent database connections from colliding.</li>
                <li style="margin-bottom: 8px;"><strong>Dev Tools:</strong> Added safety bypasses for the version checker during local development or bootloader crashes.</li>
            </ul>`,
        "2.4.52": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Hotfix:</strong> Resolved a startup crash on the login screen caused by background sync engines attempting to process Live Assessments before user authentication.</li>
            </ul>`,
        "2.4.51": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Test Engine:</strong> Added a 'Type Filter' to the Assessment Manager to easily isolate Vetting, Live, or Standard tests.</li>
                <li style="margin-bottom: 8px;"><strong>Grading Queue:</strong> Completely redesigned the Marking Queue. Submissions are now cleanly grouped by Trainee with color-coded test type badges for faster grading.</li>
                <li style="margin-bottom: 8px;"><strong>Data Integrity:</strong> Hardened failover logic. Reconnecting to the cloud now actively synchronizes offline local work and explicitly seeks out and destroys cloud "Ghost Data".</li>
            </ul>`,
        "2.4.50": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Performance:</strong> Optimized 'monitor_state' queries to drastically reduce bandwidth and database load.</li>
                <li style="margin-bottom: 8px;"><strong>Admin Tools:</strong> Separated sync rate configurations for Cloud, Local, and Staging environments.</li>
                <li style="margin-bottom: 8px;"><strong>UI/UX:</strong> Upgraded the Global Target server selection to a visual card-based interface in the Super Admin console.</li>
            </ul>`,
        "2.4.49": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Failover Recovery:</strong> Fixed an issue where reconnecting to the Cloud server after an outage could overwrite live data with stale local cache.</li>
                <li style="margin-bottom: 8px;"><strong>Sync Engine:</strong> Implemented a 'Pristine Pull' protocol when migrating to the Cloud server, ensuring absolute data accuracy.</li>
            </ul>`,
        "2.4.48": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Live & Vetting Arenas:</strong> Added 'Test Connection' diagnostic tool and 'Force Refresh' remote commands to help Admins assist stuck trainees instantly.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Added a graceful fallback UI to prevent crashes when a trainee's device hasn't downloaded the latest test definitions yet.</li>
                <li style="margin-bottom: 8px;"><strong>Sync Engine:</strong> Implemented fallback recovery for dropped network connections during live assessments to ensure questions stay in sync.</li>
            </ul>`,
        "2.4.47": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Live Assessments:</strong> Added global popup alerts for trainees when a session starts. Implemented strict duplicate booking prevention.</li>
                <li style="margin-bottom: 8px;"><strong>UI/UX:</strong> Added a dedicated 'Refresh Bookings' button to the Live Schedule. Fixed trainee view sync delays after closing modals.</li>
                <li style="margin-bottom: 8px;"><strong>Sync Engine:</strong> Real-time updates for critical events (Live/Vetting) now instantly bypass anti-typing protections to ensure immediate delivery.</li>
            </ul>`,
        "2.4.46": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Architecture:</strong> Refactored Attendance, Vetting Arena, and Live Execution to use a "Realtime-First" model, eliminating data loss and race conditions.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Patched critical edge cases including offline clock-ins, UI wipes during typing, and drag-and-drop failures.</li>
                <li style="margin-bottom: 8px;"><strong>Performance:</strong> Removed redundant polling from Live/Vetting modules, relying on the central sync engine for immediate, high-priority updates.</li>
            </ul>`,
        "2.4.44": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Live Assessment Stability:</strong> Completely overhauled the Live Assessment grid to prevent race conditions, double-bookings, and mid-interaction UI resets.</li>
                <li style="margin-bottom: 8px;"><strong>Drag & Drop Locks:</strong> Added transactional safety locks to prevent ghost data when scheduling trainers.</li>
            </ul>`,
        "2.4.43": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Critical Stability Fix:</strong> Resolved "Disappearing Data" bug in Live Bookings, Attendance, and Activity Monitor caused by PostgreSQL WAL optimization dropping payload data during bulk syncs.</li>
            </ul>`,
        "2.4.42": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Live Assessment Scheduling:</strong> Resolved race conditions causing drag-and-drop appointment moves to fail or revert.</li>
                <li style="margin-bottom: 8px;"><strong>Admin Tools:</strong> Admins can now manually assign trainees to empty slots directly from the booking grid to recover lost bookings.</li>
            </ul>`,
        "2.4.41": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Grading Queue:</strong> Fixed a critical bug where legitimate retakes were mistakenly flagged as 'Ghost Data' and hidden from the Marking Queue.</li>
                <li style="margin-bottom: 8px;"><strong>Assessment Stats:</strong> Corrected the Test Engine overview to accurately match the number of tests waiting in the Marking Queue.</li>
            </ul>`,
        "2.4.40": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Data Sync Engine:</strong> Implemented a 'Local Edits Shield' to completely eliminate data overwriting race conditions during rapid grading.</li>
                <li style="margin-bottom: 8px;"><strong>Performance:</strong> Fixed a query issue that was causing the app to repeatedly download the entire database history in the background, significantly reducing bandwidth usage and UI freezing.</li>
            </ul>`,
        "2.4.39": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Critical Fix (Grading):</strong> Resolved a race condition where grading one test could overwrite the score of another.</li>
                <li style="margin-bottom: 8px;"><strong>Test History:</strong> Added a 'Phase Filter' to the Completed Assessments view to easily find Vetting vs. Standard tests.</li>
            </ul>`,
        "2.4.38": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Data Sync:</strong> Implemented 'Ghost Slayer' to actively purge local cache of globally deleted items (Tombstones & Revoked Users).</li>
                <li style="margin-bottom: 8px;"><strong>Assessments:</strong> Fixed an issue where graded duplicate tests were invisible in the History tab. Live Assessment booking dropdowns now dynamically sync with the Test Engine.</li>
            </ul>`,
        "2.4.37": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>System Stability:</strong> Resolved a race condition where assessment submissions could get stuck in "Processing" during forced timeouts.</li>
                <li style="margin-bottom: 8px;"><strong>Security Hardening:</strong> Improved the Vetting Arena's background scanner to prevent false positive immediate-kicks. Re-engages kiosk shields automatically when toggled.</li>
            </ul>`,
        "2.4.35": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Vetting Arena:</strong> Fixed an issue where the Admin dropdowns for 'Select Test' and 'Select Group' would disappear or become unclickable during real-time background syncing.</li>
                <li style="margin-bottom: 8px;"><strong>Assessments:</strong> Fixed a critical bug causing test timers to accelerate ("Crazy Timer") and trainee answers to clear unexpectedly during Live/Vetting exams.</li>
            </ul>`,
        "2.4.34": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Hotfix:</strong> Resolved an initialization error with the Vetting Arena Split View.</li>
            </ul>`,
        "2.4.33": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Hotfix:</strong> Resolved authentication initialization crash.</li>
            </ul>`,
        "2.4.32": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Hotfix:</strong> Restored core database synchronization engine.</li>
            </ul>`,
        "2.4.31": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Vetting Arena:</strong> Added "Split View" to seamlessly monitor multiple active testing groups side-by-side.</li>
                <li style="margin-bottom: 8px;"><strong>UI Polish:</strong> Improved active session layout and multi-tasking capabilities for administrators.</li>
            </ul>`,
        "2.4.30": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Vetting Arena:</strong> Upgraded architecture to support running and monitoring multiple live vetting sessions concurrently.</li>
                <li style="margin-bottom: 8px;"><strong>Admin Tools:</strong> Added multi-tab interface for managing parallel test groups securely.</li>
                <li style="margin-bottom: 8px;"><strong>System:</strong> Hardened Kiosk Mode lock/unlock logic to prevent state desynchronization.</li>
            </ul>`,
        "2.4.29": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Team Leader Hub:</strong> Major upgrade to Operations Timeline. Added mandatory comment enforcement for Attendance, Support, and Coaching tasks.</li>
                <li style="margin-bottom: 8px;"><strong>Team Leader Hub:</strong> Enabled multi-entry logging for Network Outages, Handover Problem Tickets, and Bottlenecks.</li>
                <li style="margin-bottom: 8px;"><strong>UX:</strong> Improved validation logic to prevent submitting daily logs with missing mandatory information.</li>
            </ul>`,
        "2.4.28": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Live Assessments:</strong> Fixed a critical bug preventing sessions from being marked as 'Completed'.</li>
                <li style="margin-bottom: 8px;"><strong>Data Integrity:</strong> Implemented a "Deep Clean" delete function in Group Management to permanently remove all of a user's associated data.</li>
                <li style="margin-bottom: 8px;"><strong>Network Tools:</strong> Added a historical view for Admins to review agent network health reports.</li>
            </ul>`,
        "2.4.27": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Fix:</strong> Moved Network Test button to the main sidebar for reliable visibility across all roles.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Fixed a crash in the Network Diagnostics tool caused by a race condition on startup.</li>
                <li style="margin-bottom: 8px;"><strong>Cleanup:</strong> Resolved console warnings related to Supabase client instances.</li>
            </ul>`,
        "2.4.26": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>UX Improvement:</strong> Moved "Network Test" to the main Sidebar for reliable access by all users.</li>
                <li style="margin-bottom: 8px;"><strong>Cleanup:</strong> Removed unreliable header button injection logic.</li>
            </ul>`,
        "2.4.25": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Added Network Diagnostics tool to sidebar for all users.</li>
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Added Admin view to Network Diagnostics to review historical reports.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Fixed crash in Network Diagnostics tool and resolved button visibility issues.</li>
            </ul>`,
        "2.4.24": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature Fix:</strong> Resolved issue where the Network Diagnostics button was not appearing in the header.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Fixed console errors related to the missing 'network_diagnostics' table.</li>
            </ul>`,
        "2.4.23": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Critical Fix (Live Assessments):</strong> Resolved an issue where submitting one agent's live assessment could overwrite the scores of another.</li>
                <li style="margin-bottom: 8px;"><strong>Data Integrity:</strong> Fixed a mismatch where the "Assessment Manager" showed a different number of pending tests than the "Marking Queue".</li>
                <li style="margin-bottom: 8px;"><strong>Admin Tools:</strong> Added a new "Emergency Repair" tool to the Super Admin console to fix local data corruption and sync issues.</li>
            </ul>`,
        "2.4.22": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Fixed app freezing issues by optimizing how heavy logs are synced in the background.</li>
                <li style="margin-bottom: 8px;"><strong>Data Integrity:</strong> Implemented "Tombstone" protocol to permanently prevent deleted items ("Ghost Data") from reappearing.</li>
                <li style="margin-bottom: 8px;"><strong>UX:</strong> Improved Sync Queue indicator to show real-time processing status.</li>
            </ul>`,
        "2.4.21": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Data Integrity:</strong> Resolved an issue where old, marked tests could reappear as "Pending" during a sync.</li>
                <li style="margin-bottom: 8px;"><strong>Live Assessments:</strong> Hardened the booking system to prevent duplicate sessions and provide clearer "Rejoin" options.</li>
                <li style="margin-bottom: 8px;"><strong>Live Assessments:</strong> Implemented instant "Join Now" alerts for trainees when an admin starts a session.</li>
            </ul>`,
        "2.4.20": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Sync Engine:</strong> Optimized Live Assessment sync to use an on-demand "Server Authority" model, drastically reducing background bandwidth and latency.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Resolved issue where some users would see stale booking data while others saw live updates.</li>
            </ul>`,
        "2.4.19": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Sync Engine:</strong> Implemented "Server Authority" mode for critical tables (Live Bookings, Schedules). This forces a full sync from the server to prevent local data inconsistencies.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Fixed issue where local cache would not update correctly for shared resources.</li>
            </ul>`,
        "2.4.19": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Sync Engine:</strong> Implemented "Server Authority" mode for critical tables (Live Bookings, Schedules). This forces a full sync from the server to prevent local data inconsistencies.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Fixed issue where local cache would not update correctly for shared resources.</li>
            </ul>`,
        "2.4.18": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>System:</strong> Implemented an intrusive update system. The app now saves your state and forces a restart when an update is ready.</li>
                <li style="margin-bottom: 8px;"><strong>Assessments:</strong> Progress is now saved automatically on every interaction and restored after a crash or update.</li>
                <li style="margin-bottom: 8px;"><strong>System:</strong> Removed the idle timeout feature completely.</li>
            </ul>`,
        "2.4.17": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Live Assessment:</strong> Implemented Realtime Sync for bookings to prevent double-booking and ensure instant updates across all clients.</li>
                <li style="margin-bottom: 8px;"><strong>Data Integrity:</strong> Fixed "Ghost Data" issues in Attendance Review and Schedule Deletion using authoritative server-first logic.</li>
                <li style="margin-bottom: 8px;"><strong>System:</strong> Added Clock Sync Warning to alert users if their system time drifts significantly from the server.</li>
            </ul>`,
        "2.4.16": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Data Integrity:</strong> Implemented "Authoritative Delete" protocol for Groups, Schedules, and Tests to permanently fix "Ghost Data" issues.</li>
                <li style="margin-bottom: 8px;"><strong>User Management:</strong> Enhanced "Add Group" to use email addresses and automated Outlook templates. Added "Rename User" feature.</li>
            </ul>`,
        "2.4.16": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Data Integrity:</strong> Implemented "Authoritative Delete" protocol for Groups, Schedules, and Tests to permanently fix "Ghost Data" issues.</li>
                <li style="margin-bottom: 8px;"><strong>User Management:</strong> Enhanced "Add Group" to use email addresses and automated Outlook templates. Added "Rename User" feature.</li>
            </ul>`,
        "2.4.15": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Teamleader Hub:</strong> Implemented initial structure for Daily/Weekly Operations Timeline and Roster Management (Currently Admin-Only for testing).</li>
                <li style="margin-bottom: 8px;"><strong>System:</strong> Updated architecture documentation.</li>
            </ul>`,
        "2.4.14": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Sync Engine:</strong> Added time buffer to resolve clock skew issues preventing trainee submissions from appearing.</li>
                <li style="margin-bottom: 8px;"><strong>Dashboard:</strong> Fixed Attendance widget to only count unconfirmed lates for the current day.</li>
                <li style="margin-bottom: 8px;"><strong>Dashboard:</strong> Fixed Insight widget to correctly calculate "Action Required" counts by ignoring retaken/passed tests.</li>
            </ul>`,
        "2.4.13": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Data Integrity:</strong> Implemented "Hard Delete Protocol" to permanently remove deleted items from the cloud and prevent "Ghost Data" reappearance.</li>
                <li style="margin-bottom: 8px;"><strong>Sync Engine:</strong> Added Pending Delete Queue to filter out deleted items during synchronization.</li>
            </ul>`,
        "2.4.12": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Migration Tools:</strong> Finalized Staging Mode and Migration protocols for server switchover.</li>
            </ul>`,
        "2.4.11": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Workflow:</strong> Implemented Staging Mode and Draft Releases for safer deployment.</li>
            </ul>`,
        "2.4.10": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Maintenance:</strong> General stability improvements and version synchronization.</li>
            </ul>`,
        "2.4.7": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Maintenance:</strong> Version bump to resolve deployment conflict. Includes fixes for Schedule Links and Update Notifications.</li>
            </ul>`,
        "2.4.6": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Notifications:</strong> Fixed issue where update notifications (Bell Icon) wouldn't appear unless the app was restarted. Now checks every 30 minutes.</li>
                <li style="margin-bottom: 8px;"><strong>Schedule:</strong> Fixed broken "Study Material" links containing special characters (SharePoint).</li>
                <li style="margin-bottom: 8px;"><strong>Sync:</strong> Forced schedule updates for trainees to ensure new links appear immediately.</li>
            </ul>`,
        "2.4.5": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Fixed login loop issue when Local Server is offline. App now stays in Recovery Mode until manually reset.</li>
            </ul>`,
        "2.4.4": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Security:</strong> Enhanced protection for global system settings to prevent accidental overwrites by older app versions.</li>
            </ul>`,
        "2.3.9": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Data Integrity:</strong> Fixed "Zombie Data" issue where deleted items would reappear after a server switch or sync.</li>
                <li style="margin-bottom: 8px;"><strong>Vetting Arena:</strong> Upgraded to support multiple, concurrent vetting sessions without conflicts.</li>
                <li style="margin-bottom: 8px;"><strong>Live Assessments:</strong> Hardened real-time answer syncing to improve stability for multiple trainers.</li>
            </ul>`,
        "2.3.8": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Critical Fix:</strong> Solved issue where the app would get stuck on a disconnected Local Server. It will now auto-revert to Cloud immediately.</li>
            </ul>`,
        "2.3.7": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Failover Fix:</strong> App now correctly forces a switch back to Cloud if the Local server is unreachable during configuration save.</li>
                <li style="margin-bottom: 8px;"><strong>Permissions:</strong> Fixed Team Leader access rights for the Insight Dashboard.</li>
            </ul>`,
        "2.3.6": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Failover Stability:</strong> Fixed connection loops by verifying server reachability before switching.</li>
                <li style="margin-bottom: 8px;"><strong>Auto-Recovery:</strong> App now automatically reverts to Cloud if the Local server is offline.</li>
            </ul>`,
        "2.3.5": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Server Indicator:</strong> Added a visual indicator in the header to show current server connection (Cloud vs Local).</li>
            </ul>`,
        "2.3.4": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Dual-Server Stability:</strong> Resolved schema conflicts for local Supabase setup, improving reliability when switching servers.</li>
                <li style="margin-bottom: 8px;"><strong>Admin Tools:</strong> Added a "Verify Schema" tool to the Super Admin console to check database compatibility.</li>
                <li style="margin-bottom: 8px;"><strong>Permissions:</strong> Hardened Team Leader role to correctly restrict access to the Insight Dashboard.</li>
            </ul>`,
        "2.3.3": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Vetting Stability:</strong> Fixed an issue where security alerts could freeze the test interface.</li>
                <li style="margin-bottom: 8px;"><strong>False Positives:</strong> Improved detection to ignore background browser processes (e.g., Edge Startup Boost).</li>
                <li style="margin-bottom: 8px;"><strong>Sync Fix:</strong> Deleted records now correctly disappear from all devices.</li>
            </ul>`,
        "2.3.2": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Update Notification:</strong> Added a notification bell alert when a new system update is ready to install.</li>
            </ul>`,
        "2.3.1": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Trainee Portal:</strong> You can now view your Vetting Test history and submissions in the 'Test Records' tab.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Resolved permission issues preventing trainees from accessing their own records.</li>
            </ul>`,
        "2.3.0": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Dual-Server Architecture:</strong> Added support for Local/Cloud server failover.</li>
                <li style="margin-bottom: 8px;"><strong>High Availability:</strong> System now actively monitors for server switch commands to ensure uptime.</li>
                <li style="margin-bottom: 8px;"><strong>Data Safety:</strong> Implemented auto-migration protocol to preserve data when switching servers.</li>
            </ul>`,
        "2.2.15": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>System:</strong> Documentation updated to reflect recent architecture changes (Universal Search, Working Hours Logic).</li>
            </ul>`,
        "2.2.14": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Critical Fix:</strong> Resolved issue where deleted records would reappear after refresh.</li>
                <li style="margin-bottom: 8px;"><strong>System:</strong> Factory Reset now correctly wipes all cloud data tables.</li>
            </ul>`,
        "2.2.13": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Insight Dashboard:</strong> Fixed "Action Required" to correctly update when a trainee retakes and passes a test (Highest Score wins).</li>
                <li style="margin-bottom: 8px;"><strong>Live Assessment:</strong> Fixed issue where old/stale sessions remained visible to trainees.</li>
            </ul>`,
        "2.2.12": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Vetting Arena:</strong> Fixed missing timer display for trainees. Improved timer synchronization for Admins.</li>
            </ul>`,
        "2.2.11": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Critical Fix:</strong> Resolved version comparison bug preventing login (e.g., 2.2.10 being treated as older than 2.2.6).</li>
            </ul>`,
        "2.2.10": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Vetting Arena:</strong> Fixed issue where counters (Connected, In Progress) were not updating.</li>
                <li style="margin-bottom: 8px;"><strong>Assessments:</strong> Prevented double-submission errors by disabling the submit button immediately.</li>
            </ul>`,
        "2.2.9": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Vetting Arena:</strong> Added active server polling for Admins to ensure real-time visibility of trainees.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Resolved "Already Submitted" error by enforcing strict ID matching.</li>
            </ul>`,
        "2.2.8": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Vetting Arena:</strong> Fixed real-time visibility of trainees for Admins. Added tolerance for Microsoft Teams running in the background.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Improved submission reliability and error messaging for assessments.</li>
            </ul>`,
        "2.2.6": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Enforced Background Color theme application to ensure UI components (Cards, Inputs) update correctly.</li>
            </ul>`,
        "2.2.5": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Theme Engine:</strong> Background Color setting now applies to Cards, Inputs, and Sidebars (Gloss Grey areas) for a fully consistent look.</li>
            </ul>`,
        "2.2.4": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Resolved Super Admin Console crash (Syntax Error).</li>
                <li style="margin-bottom: 8px;"><strong>Theme:</strong> Added "Background Color" customization for Dark Mode in Theme Settings.</li>
            </ul>`,
        "2.2.3": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Admin Tools:</strong> Added "Last Sync Time" column to the Row-Level Sync Status table for better visibility.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Resolved issue where custom User Idle Timeout settings were ignored (defaulting to 15 mins).</li>
            </ul>`,
        "2.2.2": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Hotfix:</strong> Resolved login lockout for Admins switching between terminals or Dev/Prod environments.</li>
            </ul>`,
        "2.2.1": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Performance:</strong> Major storage optimization. Reduced local database size by ~90% using lightweight sync checksums.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Fixed "Server Ahead" sync loops and added automatic duplicate cleanup for Records and Archives.</li>
                <li style="margin-bottom: 8px;"><strong>Health Check:</strong> Added database health monitoring and auto-pruning for old Activity Logs.</li>
                <li style="margin-bottom: 8px;"><strong>Admin Tools:</strong> New "Force Pull" and "Local Cleanup" tools in Super Admin Console.</li>
            </ul>`,
        "2.1.61": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Header UI:</strong> Separated Profile Settings (Logo) from Admin Tools (Gear).</li>
                <li style="margin-bottom: 8px;"><strong>Profile:</strong> Added "My Profile" shortcut in Admin User Management.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Resolved Live Assessment booking visibility for Admins/TLs.</li>
            </ul>`,
        "2.1.60": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Zoom Control:</strong> New UI Zoom slider in Theme Settings to scale the interface.</li>
                <li style="margin-bottom: 8px;"><strong>Visual Polish:</strong> Added smooth transitions when switching themes.</li>
                <li style="margin-bottom: 8px;"><strong>Light Mode:</strong> Improved readability with softer borders and text.</li>
            </ul>`,
        "2.1.59": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Super Admin Console 2.0:</strong> Redesigned with Tabs, Raw Data Inspector, and AI Analyst Chat.</li>
                <li style="margin-bottom: 8px;"><strong>Study Monitor 2.0:</strong> Improved "Lenient Scoring" for short interruptions and better Idle Detection.</li>
                <li style="margin-bottom: 8px;"><strong>Vetting Arena:</strong> Added "Waiting for Admin" indicator and fixed idle timeouts during sessions.</li>
                <li style="margin-bottom: 8px;"><strong>Stability:</strong> Enhanced cloud sync reliability and error handling.</li>
            </ul>`,
        "2.1.44": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Filtered out Graduated Agents from the Trainee Login list to prevent confusion.</li>
                <li style="margin-bottom: 8px;"><strong>System:</strong> Prevented auto-regeneration of user accounts if they exist in the Graduated Agents archive.</li>
            </ul>`,
        "2.1.43": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Added 'Daily Tip Management' widget for Admins to customize trainee tips.</li>
                <li style="margin-bottom: 8px;"><strong>System:</strong> Hardened Sync Engine. Removed conflict prompts (Server Wins), added auto-retry for saves, and improved nested object merging.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Resolved Trainee Dashboard rendering crash.</li>
            </ul>`,
        "2.1.42": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Added 'Date Graduated' field to the Agent Search profile for archived users.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Enhanced Onboard Report auto-fill to correctly match assessment scores even if casing differs (Fuzzy Match).</li>
            </ul>`,
        "2.1.41": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Resolved issue where Onboard Reports for Graduated/Archived agents could not be viewed.</li>
                <li style="margin-bottom: 8px;"><strong>System:</strong> Improved 'Graduate Trainee' workflow stability.</li>
            </ul>`,
        "2.1.40": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Added 'Conflict Resolution' modal. You can now choose between Server or Local versions when a data conflict is detected during sync.</li>
                <li style="margin-bottom: 8px;"><strong>System:</strong> Enhanced sync logic to pause and wait for user input on critical data mismatches (Tests, Rosters, Settings).</li>
            </ul>`,
        "2.1.39": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>System:</strong> Major Sync Engine upgrade. Fixed data reversion issues by implementing 'Server-Wins' (Pull) vs 'Local-Wins' (Push) merge strategies.</li>
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Added visual 'Unsaved Changes' indicator and 'Offline' detection with Auto-Recovery.</li>
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Added 'Retry' button with Connection Speed Test for failed syncs.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Improved timestamp accuracy using Server Time to prevent sync loops.</li>
            </ul>`,
        "2.1.38": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Added 'Cleanup Duplicates' tool to Admin Database to remove redundant records.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Resolved issue where viewing assessments opened the wrong submission due to duplicate data.</li>
                <li style="margin-bottom: 8px;"><strong>System:</strong> Enhanced duplicate prevention in Live Assessment saving logic.</li>
            </ul>`,
        "2.1.37": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Resolved Agent Search crash when viewing agents with recent Onboard Reports.</li>
            </ul>`,
        "2.1.36": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Resolved Agent Search loading error.</li>
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Enabled 'Save Note' functionality in Agent Profile.</li>
            </ul>`,
        "2.1.35": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Resolved issue where classified 'External' activities would reappear in the Review Queue.</li>
                <li style="margin-bottom: 8px;"><strong>System:</strong> Implemented 'Reviewed' list to permanently dismiss classified items across all admins.</li>
            </ul>`,
        "2.1.34": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>System:</strong> Improved Activity Monitor robustness (Idle detection & Data retention).</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Resolved data sync conflicts where users could overwrite each other's status.</li>
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Added auto-away status when no mouse/keyboard input is detected for 1 minute.</li>
            </ul>`,
        "2.1.33": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Resolved issue where Pre-Production Feedback persisted between different trainees in Onboard Reports.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Included Live Assessments (e.g. Course 2) in the main Assessment Scores table.</li>
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Added 'Force Update' auto-install capability for remote admin updates.</li>
            </ul>`,
        "2.1.32": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Resolved Activity Monitor list flickering/resetting by implementing Smart Merge sync.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Fixed issue where classified apps would reappear as 'External' after refresh.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Enhanced whitelist logic to prioritize Admin classification over raw trainee logs.</li>
                <li style="margin-bottom: 8px;"><strong>System:</strong> Optimized background data synchronization for stability.</li>
            </ul>`,
        "2.1.31": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Robust 'Retrain' workflow when moving agents to a new group (Archives old data).</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Added 'Reason' field to Graduated Agents list (e.g. Moved vs Graduated).</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Resolved context mismatch issues in Admin User management.</li>
            </ul>`,
        "2.1.30": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Added 'Graduated Agents' tab to Admin Panel for archiving and restoring users.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Enhanced Onboard Report visuals and print formatting.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Auto-mark 'Absent' for weekdays with no login activity in Attendance Register.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Corrected Vetting Test separation in Onboard Report tables.</li>
            </ul>`,
        "2.1.29": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Added 'Graduate Trainee' workflow to archive completed agents.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Corrected answer display for Multiple Choice questions in Live Arena (Admin View).</li>
                <li style="margin-bottom: 8px;"><strong>System:</strong> Implemented robust data archiving for graduated users.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Sorted Agent Progress checklist (Vetting at bottom).</li>
            </ul>`,
        "2.1.28": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Resolved issue where Vetting Tests were missing from Agent Progress checklist.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Corrected Live Assessment Timer visibility for trainees.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Enhanced fuzzy matching for Vetting Topic completion detection.</li>
                <li style="margin-bottom: 8px;"><strong>System:</strong> Removed duplicate code blocks in data sync logic.</li>
            </ul>`,
        "2.1.27": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Resolved issue where input fields froze after submitting scores in Capture Scores.</li>
                <li style="margin-bottom: 8px;"><strong>System:</strong> Improved background user generation to be silent during score capture.</li>
            </ul>`,
        "2.1.26": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Added support for multiple questions in NPS Surveys.</li>
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Added Live Assessment Timer for Admins.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Restored Rich Text Editor visibility in Test Builder.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Enhanced Analytics Dashboard to break down NPS scores per question.</li>
            </ul>`,
        "2.1.25": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Added NPS Rating System for trainee feedback.</li>
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Added NPS Control Panel for Admins (Create, Clone, Preview).</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Enhanced Activity Monitor with precise external app tracking.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Corrected Idle Timeout setting not applying to specific users.</li>
            </ul>`,
        "2.1.24": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Enhanced Department Overview with Effort vs Performance matrix.</li>
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Added Group Knowledge Gap Heatmap with test filtering.</li>
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Individual At-Risk Score and Activity Timeline in Agent Search.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Added fail-safe to prevent overwriting existing manual scores.</li>
            </ul>`,
        "2.1.22": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Restored Admin Panel access for Team Leaders (Profile & Settings).</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Resolved Admin Dashboard rendering error.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Corrected Dashboard layout issues (squashed widgets).</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Enhanced Dashboard customization (drag to empty space).</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Added Date column to Assessment Records view.</li>
            </ul>`,
        "2.1.21": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Team Leader Dashboard overhaul with customizable widgets.</li>
                <li style="margin-bottom: 8px;"><strong>Visuals:</strong> Added Loading Skeleton animations for smoother experience.</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Refined Team Leader permissions for Schedule and Insights.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Resolved display issues in Insight Dashboard.</li>
            </ul>`,
        "2.1.20": `
            <ul style="padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>Feature:</strong> Replaced system prompts with custom modals for better compatibility.</li>
                <li style="margin-bottom: 8px;"><strong>Fix:</strong> Resolved issue where Admins couldn't add links to Assessment Records.</li>
                <li style="margin-bottom: 8px;"><strong>New:</strong> Trainee Dashboard widgets (Daily Tip, Request Help).</li>
                <li style="margin-bottom: 8px;"><strong>Improvement:</strong> Enhanced Activity Monitor reliability.</li>
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

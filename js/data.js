/* ================= DATA & SYNC ================= */

// 1. Central Schema: Defines all keys and their default values
const DB_SCHEMA = {
    records: [], 
    users: [], 
    assessments: [], 
    rosters: {},
    accessControl: { enabled: false, whitelist: [] },
    trainingData: {}, 
    vettingTopics: [],
    schedules: {}, 
    liveBookings: [], 
    cancellationCounts: {}, 
    liveScheduleSettings: {},
    liveSchedules: {}, // NEW: Multi-group Live Assessment Schedules
    tests: [], 
    submissions: [], 
    savedReports: [],
    insightReviews: [], 
    exemptions: [], 
    notices: [],
    attendance_records: [],
    attendance_settings: {
        platforms: ["WhatsApp", "Microsoft Teams", "Call", "SMS"],
        contacts: ["Darren", "Netta", "Jaco", "Claudine"]
    },
    // --- SUPER ADMIN CONFIGURATION ---
    system_config: {
        sync_rates: { admin: 4000, teamleader: 60000, trainee: 15000 },
        heartbeat_rates: { admin: 5000, default: 30000 },
        idle_thresholds: { warning: 60000, logout: 900000 },
        attendance: { work_start: "08:00", late_cutoff: "08:15", work_end: "17:00", reminder_start: "16:45", allow_weekend_login: false },
        security: { maintenance_mode: false, lockdown_mode: false, min_version: "0.0.0", force_kiosk_global: false, allowed_ips: [], banned_clients: [], client_whitelist: [] },
        features: { vetting_arena: true, live_assessments: true, nps_surveys: true, daily_tips: true, disable_animations: false },
        monitoring: { tolerance_ms: 180000, whitelist_strict: false },
        announcement: { active: false, message: "", type: "info" },
        broadcast: { id: 0, message: "" },
        ai: { enabled: true, provider: "gemini", apiKey: "", model: "gemini-pro", endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent" }
    },
    ai_suggestions: [], // Stores background improvement suggestions
    revokedUsers: [], // Added to ensure blacklist syncs
    auditLogs: [], // Critical Action History
    accessLogs: [], // Login/Logout/Timeout History
    vettingSession: { active: false, testId: null, trainees: {} }, // Vetting Arena State
    linkRequests: [], // Requests from TLs for assessment links
    agentNotes: {}, // Private notes on agents { "username": [ { id, author, date, content } ] }
    liveSessions: [], // CHANGED: Array to support multiple concurrent sessions
    forbiddenApps: [], // Dynamic list of blacklisted processes
    monitor_data: {}, // Real-time activity tracking { username: { current, history: [] } }
    monitor_history: [], // Archived daily activity logs
    nps_surveys: [], // Admin defined surveys
    nps_responses: [], // Trainee responses
    graduated_agents: [], // Archived data for graduated trainees
    monitor_whitelist: [], // Custom whitelist for work-related apps
    monitor_reviewed: [], // Apps confirmed as External/Idle (Dismissed from queue)
    dailyTips: [], // Admin controlled daily tips
    error_reports: [] // Centralized error logging for Super Admin
};

// --- HYBRID SYNC CONFIGURATION ---
// Maps local keys to Supabase Tables for Row-Level Sync
const ROW_MAP = {
    'records': 'records',
    'submissions': 'submissions',
    'auditLogs': 'audit_logs',
    'error_reports': 'error_reports',
    'liveBookings': 'live_bookings',
    'monitor_history': 'monitor_history',
    'attendance_records': 'attendance',
    'accessLogs': 'access_logs',
    'savedReports': 'saved_reports',
    'insightReviews': 'insight_reviews',
    'exemptions': 'exemptions',
    'liveSessions': 'live_sessions',
    'nps_responses': 'nps_responses',
    'graduated_agents': 'archived_users',
    'linkRequests': 'link_requests'
};

// --- GLOBAL INTERACTION TRACKER ---
window.LAST_INTERACTION = Date.now();
window.CURRENT_LATENCY = 0; // Track latency for health reporting

// Anti-Jiggle: Only register mouse movement if distance > 5px
let _lastMx = 0, _lastMy = 0;
window.addEventListener('mousemove', (e) => {
    const dist = Math.abs(e.screenX - _lastMx) + Math.abs(e.screenY - _lastMy);
    if (dist > 5) {
        window.LAST_INTERACTION = Date.now();
        _lastMx = e.screenX;
        _lastMy = e.screenY;
    }
}, { passive: true });

['click', 'keydown', 'scroll', 'touchstart'].forEach(evt => {
    window.addEventListener(evt, () => {
        window.LAST_INTERACTION = Date.now();
    }, { passive: true });
});

// --- HELPER: UI PROTECTION (The Fix for Typing Issues) ---
// Checks if the user is currently typing in a field.
// We use this to prevent the background sync from refreshing the UI and stealing focus.
function isUserTyping() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    // Returns true if user is in an Input, Textarea, or Select box
    return (tag === 'input' || tag === 'textarea' || tag === 'select');
}

// --- NETWORK STATE LISTENERS (Auto-Recovery) ---
window.addEventListener('online', () => {
    console.log("Network Online. Resuming sync...");
    updateSyncUI('syncing');
    setTimeout(() => loadFromServer(true), 1500); // Delay to allow connection to stabilize
});
window.addEventListener('offline', () => {
    updateSyncUI('error');
});

// 2. Load Data (UPDATED: HYBRID ROW-LEVEL SYNC)
// Fetches Blobs for config/rosters AND Delta Rows for records/logs
async function loadFromServer(silent = false) {
    try {
        if (window.supabaseClient) updateSyncUI('syncing');
        if (!window.supabaseClient) return;

        const start = Date.now();
        
        // --- PHASE A: BLOB SYNC (Settings, Rosters, Users) ---
        const { data: meta, error } = await supabaseClient
            .from('app_documents')
            .select('key, updated_at');
        window.CURRENT_LATENCY = Date.now() - start; // Measure RTT
        
        if (error) throw error;

        // Identify Stale Blobs
        const keysToFetch = [];
        meta.forEach(row => {
            const localTs = localStorage.getItem('sync_ts_' + row.key);
            // If we don't have it, or server is newer, fetch it
            if (!localTs || new Date(row.updated_at) > new Date(localTs)) {
                keysToFetch.push(row.key);
            }
        });

        // Fetch Stale Blobs
        if (keysToFetch.length > 0) {
            if(!silent) console.log(`Syncing updates for: ${keysToFetch.join(', ')}`);
            
            const { data: docs, error: fetchErr } = await supabaseClient
                .from('app_documents')
                .select('key, content, updated_at')
                .in('key', keysToFetch);
            
            if (fetchErr) throw fetchErr;

            for (const doc of docs) {
                // SMART PULL: Always try to merge JSON data to prevent overwriting local unsaved drafts
                // We use 'server_wins' strategy here: If an item exists in both, Server version is the truth.
                const localVal = JSON.parse(localStorage.getItem(doc.key));
                
                if (localVal && (Array.isArray(localVal) || typeof localVal === 'object')) {
                    let strategy = 'server_wins';
                    
                    const serverObj = { [doc.key]: doc.content };
                    const localObj = { [doc.key]: localVal };
                    const merged = performSmartMerge(serverObj, localObj, strategy);
                    localStorage.setItem(doc.key, JSON.stringify(merged[doc.key]));
                } else {
                    // Fallback for primitives or empty local data
                    localStorage.setItem(doc.key, JSON.stringify(doc.content));
                }
                localStorage.setItem('sync_ts_' + doc.key, doc.updated_at);
            }
            
            if (keysToFetch.includes('system_config')) applySystemConfig();
        }

        // --- PHASE B: ROW SYNC (Records, Submissions, Logs) ---
        // Only fetch rows newer than our last sync timestamp
        for (const [localKey, tableName] of Object.entries(ROW_MAP)) {
            const lastSync = localStorage.getItem(`row_sync_ts_${localKey}`) || '1970-01-01T00:00:00.000Z';
            
            const { data: newRows, error: rowErr } = await supabaseClient
                .from(tableName)
                .select('data, updated_at')
                .gt('updated_at', lastSync)
                .limit(1000); // Batch limit

            if (rowErr) console.warn(`Row sync failed for ${tableName}`, rowErr);
            
            if (newRows && newRows.length > 0) {
                if(!silent) console.log(`Downloaded ${newRows.length} new rows for ${localKey}`);
                
                // Extract data objects
                const serverItems = newRows.map(r => r.data);
                const localItems = JSON.parse(localStorage.getItem(localKey) || '[]');
                
                // Merge using existing logic (Server Wins)
                const serverObj = { [localKey]: serverItems };
                const localObj = { [localKey]: localItems };
                const merged = performSmartMerge(serverObj, localObj, 'server_wins');
                
                localStorage.setItem(localKey, JSON.stringify(merged[localKey]));
                
                // Update Timestamp (Use the newest row's time)
                const newest = newRows.reduce((max, r) => new Date(r.updated_at) > new Date(max) ? r.updated_at : max, lastSync);
                localStorage.setItem(`row_sync_ts_${localKey}`, newest);
                
                // Update Hash Map for these items to prevent re-uploading what we just downloaded
                const hashMap = JSON.parse(localStorage.getItem(`hash_map_${localKey}`) || '{}');
                serverItems.forEach(item => {
                    if(item.id) hashMap[item.id] = JSON.stringify(item);
                });
                localStorage.setItem(`hash_map_${localKey}`, JSON.stringify(hashMap));
            }
        }

        // --- PHASE C: MONITOR STATE SYNC (Real-time Activity) ---
        // Fetch all active user states from the table
        const { data: monRows, error: monErr } = await supabaseClient
            .from('monitor_state')
            .select('user_id, data');
            
        if (monRows) {
            const monData = {};
            monRows.forEach(r => monData[r.user_id] = r.data);
            
            // Preserve MY local state (Optimistic UI) - Don't let server overwrite my own live status
            if (CURRENT_USER) {
                const currentLocal = JSON.parse(localStorage.getItem('monitor_data') || '{}');
                if (currentLocal[CURRENT_USER.user]) {
                    monData[CURRENT_USER.user] = currentLocal[CURRENT_USER.user];
                }
            }
            localStorage.setItem('monitor_data', JSON.stringify(monData));
        }

        // --- PHASE D: POST-SYNC ACTIONS ---
        const config = JSON.parse(localStorage.getItem('system_config') || '{}');
        if (config.security && config.security.lockdown_mode && CURRENT_USER && CURRENT_USER.role !== 'super_admin') {
            alert("⚠️ EMERGENCY LOCKDOWN INITIATED.\n\nYou are being logged out.");
            if(typeof logout === 'function') logout();
        }

        if(silent && typeof refreshAllDropdowns === 'function') {
            const timeSinceInteraction = Date.now() - (window.LAST_INTERACTION || 0);
            if (!isUserTyping() && timeSinceInteraction > 5000) {
                refreshAllDropdowns();
            }
        }
        updateSyncUI('success');

    } catch (err) { 
        updateSyncUI('error');
        if(!silent) {
            console.error("Supabase Load Error:", err);
            // Helper for 401/406 errors to give a clear hint
            if (err.code === 401 || err.status === 401) {
                console.warn("AUTHENTICATION FAILED: Check SUPABASE_ANON_KEY in config.js");
            } else if (err.message && err.message.includes("row level security")) {
                console.warn("DATABASE PERMISSION ERROR: Run the RLS Policy SQL in Supabase to allow access.");
            }
        }
    }
}

// --- HOT RELOAD: APPLY SYSTEM CONFIG ---
function applySystemConfig() {
    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
    
    // 1. Global Announcement
    const bannerId = 'global-announcement-banner';
    let banner = document.getElementById(bannerId);
    
    if (config.announcement && config.announcement.active && config.announcement.message) {
        if (!banner) {
            banner = document.createElement('div');
            banner.id = bannerId;
            banner.style.cssText = "position:fixed; top:0; left:0; width:100%; padding:10px; text-align:center; z-index:99999; font-weight:bold; box-shadow:0 2px 5px rgba(0,0,0,0.2);";
            document.body.prepend(banner);
        }
        
        const typeColors = { info: '#3498db', warning: '#f1c40f', error: '#ff5252', success: '#2ecc71' };
        banner.style.backgroundColor = typeColors[config.announcement.type] || '#3498db';
        banner.style.color = '#fff';
        banner.innerText = config.announcement.message;
        banner.classList.remove('hidden');
    } else if (banner) {
        banner.classList.add('hidden');
    }
    
    // 1.5 Broadcast Popup
    if (config.broadcast && config.broadcast.message && config.broadcast.id) {
        const lastId = localStorage.getItem('last_broadcast_id');
        if (lastId != config.broadcast.id) {
            localStorage.setItem('last_broadcast_id', config.broadcast.id);
            // Show alert
            alert("📢 SYSTEM BROADCAST:\n\n" + config.broadcast.message);
            // Optional: Play sound
            if (config.broadcast.sound) {
                try {
                    const audio = new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');
                    audio.play().catch(e=>{});
                } catch(e){}
            }
        }
    }

    // 2. Restart Sync Engine if rates changed (and we are logged in)
    if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) {
        // We simply restart the engine, it will read the new config values
        if (typeof startRealtimeSync === 'function') startRealtimeSync();
    }
}

// --- ERROR REPORTING SYSTEM ---
async function reportSystemError(msg, type) {
    // Attempt to resolve user identity if global CURRENT_USER is missing
    let user = 'Guest';
    let role = 'Unknown';

    if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) {
        user = CURRENT_USER.user;
        role = CURRENT_USER.role;
    } else {
        // Fallback 1: Check Session Storage (Page Refresh)
        try {
            const session = sessionStorage.getItem('currentUser');
            if (session) {
                const u = JSON.parse(session);
                if (u && u.user) {
                    user = u.user + ' (Restoring)';
                    role = u.role || 'Unknown';
                }
            } else {
                // Fallback 2: Check Remember Me (Login Screen)
                const remembered = localStorage.getItem('rememberedUser');
                if (remembered) {
                    const u = JSON.parse(remembered);
                    if (u && u.user) {
                        user = u.user + ' (Remembered)';
                        role = 'Pending';
                    }
                }
            }
        } catch(e) {}
    }

    const report = {
        id: Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        user: user,
        role: role,
        error: msg,
        type: type,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent
    };

    // Optimistic Load & Save
    const reports = JSON.parse(localStorage.getItem('error_reports') || '[]');
    reports.push(report);
    
    // Keep size manageable (Last 500 errors) - Increased to ensure multi-user history is kept
    if (reports.length > 500) reports.shift();
    
    localStorage.setItem('error_reports', JSON.stringify(reports));
    
    // Silent Sync to Cloud
    if (typeof saveToServer === 'function') {
        await saveToServer(['error_reports'], false, true);
    }
}

function checkErrorAlerts() {
    if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER || CURRENT_USER.role !== 'super_admin') return;
    
    const reports = JSON.parse(localStorage.getItem('error_reports') || '[]');
    const lastCount = parseInt(localStorage.getItem('last_seen_error_count') || '0');
    
    if (reports.length > lastCount) {
        if (typeof showToast === 'function') showToast(`⚠️ ${reports.length - lastCount} New System Errors Reported!`, 'error');
    }
}

// Export for Jest testing (Node.js environment)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        DB_SCHEMA,
        loadFromServer,
        saveToServer,
        performSmartMerge
    };
}

// MIGRATION: One-time move from 'app_data' (Blob) to 'app_documents' (Split)
async function migrateToSplitSchema() {
    console.log("Migrating to Split Schema...");
    // Save all current local keys to the new table
    await saveToServer(null, true); 
    console.log("Migration Complete.");
}

// Helper to manually trigger "Unsaved" state (e.g. during debounce)
function notifyUnsavedChanges() {
    updateSyncUI('pending');
}

// Helper to retry sync manually from the UI
window.retrySync = async function() {
    const el = document.getElementById('sync-indicator');
    
    // 1. Visual Feedback
    if(el) {
        el.style.opacity = '1';
        el.innerHTML = '<i class="fas fa-satellite-dish fa-pulse"></i> Testing...';
    }

    // 2. Latency Test
    const start = Date.now();
    let success = false;
    
    try {
        if (window.supabaseClient) {
            // Ping DB (Lightweight query)
            await window.supabaseClient.from('app_documents').select('key').limit(1);
            success = true;
        }
    } catch(e) { console.error("Ping failed", e); }
    
    const latency = Date.now() - start;

    // 3. Display & Proceed
    if (success) {
        let color = '#2ecc71';
        if (latency > 500) color = '#f1c40f';
        if (latency > 1500) color = '#ff5252';
        
        if(el) el.innerHTML = `<i class="fas fa-wifi" style="color:${color}"></i> ${latency}ms`;
        await new Promise(r => setTimeout(r, 1000)); // Pause to show result
        
        console.log(`Retry Latency: ${latency}ms`);
        await saveToServer(null, false);
    } else {
        if(el) el.innerHTML = '<i class="fas fa-times" style="color:#ff5252"></i> Offline';
        setTimeout(() => updateSyncUI('error'), 2000);
    }
};

// --- SYNC STATUS UI ---
function updateSyncUI(status) {
    const el = document.getElementById('sync-indicator');
    if(!el) return;
    
    // Ensure visibility (Reset transition for instant show)
    el.style.transition = 'none';
    el.style.opacity = '1';

    if(status === 'busy') {
        el.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="color:var(--primary);"></i> Uploading...';
    } else if (status === 'syncing') {
        el.innerHTML = '<i class="fas fa-sync fa-spin" style="color:var(--text-muted);"></i> Syncing...';
    } else if (status === 'success') {
        el.innerHTML = '<i class="fas fa-check" style="color:#2ecc71;"></i> Synced';
        // Fade out after 3 seconds
        setTimeout(() => { 
            if(el.innerHTML.includes('Synced')) {
                el.style.transition = 'opacity 1s';
                el.style.opacity = '0'; 
            }
        }, 2000);
    } else if (status === 'error') {
        // Smart Error Message
        const isOffline = !navigator.onLine;
        const msg = isOffline ? 'Offline' : 'Sync Failed';
        const icon = isOffline ? 'fa-wifi' : 'fa-exclamation-circle';
        el.innerHTML = `<i class="fas ${icon}" style="color:#ff5252;"></i> ${msg} <button onclick="retrySync()" style="background:transparent; border:1px solid #ff5252; color:#ff5252; border-radius:4px; cursor:pointer; font-size:0.7rem; padding:1px 5px; margin-left:5px;">Retry</button>`;
    } else if (status === 'pending') {
        el.innerHTML = '<i class="fas fa-pen" style="color:#f1c40f;"></i> Unsaved...';
    }
}

// --- HELPER: LIGHTWEIGHT CHECKSUM ---
// Reduces hash_map size by 99% (Stores 8-char string instead of full JSON)
function generateChecksum(str) {
    let hash = 5381, i = str.length;
    while(i) hash = (hash * 33) ^ str.charCodeAt(--i);
    return (hash >>> 0).toString(16);
}

// 3. SMART SAVE (UPDATED: HYBRID ROW-LEVEL PUSH)
// Splits data into Blobs (app_documents) and Rows (tables) based on ROW_MAP
async function saveToServer(targetKeys = null, force = false, silent = false, retryCount = 0) {
    try {
        // Legacy support: if first arg is boolean, treat as force for ALL keys
        if (typeof targetKeys === 'boolean') {
            force = targetKeys;
            targetKeys = null; // Save all
        }

        // LOCKDOWN CHECK
        const config = JSON.parse(localStorage.getItem('system_config') || '{}');
        if (config.security && config.security.lockdown_mode && CURRENT_USER && CURRENT_USER.role !== 'super_admin') {
            console.warn("Save blocked by Lockdown Mode.");
            return;
        }

        if (!window.supabaseClient) {
            console.warn("Supabase client not ready. Offline?");
            if(!silent) updateSyncUI('error');
            return;
        }

        const keysToSave = targetKeys || Object.keys(DB_SCHEMA);
        if(!silent) updateSyncUI('busy');

        for (const key of keysToSave) {
            const localContent = JSON.parse(localStorage.getItem(key)) || DB_SCHEMA[key];
            
            // --- STRATEGY A: ROW-LEVEL SYNC (Records, Submissions, Logs) ---
            if (ROW_MAP[key]) {
                const tableName = ROW_MAP[key];
                const hashMapKey = `hash_map_${key}`;
                const hashMap = JSON.parse(localStorage.getItem(hashMapKey) || '{}');
                const itemsToUpload = [];
                
                // 1. Identify Changed Items (Delta)
                if (Array.isArray(localContent)) {
                    localContent.forEach(item => {
                        // Ensure ID exists
                        if (!item.id) item.id = Date.now() + "_" + Math.random().toString(36).substr(2, 9);
                        
                        const currentHash = generateChecksum(JSON.stringify(item));
                        const lastHash = hashMap[item.id];
                        
                        if (currentHash !== lastHash) {
                            itemsToUpload.push(item);
                            hashMap[item.id] = currentHash; // Update hash immediately (Optimistic)
                        }
                    });
                }
                
                // 2. Upload Deltas
                if (itemsToUpload.length > 0) {
                    if(!silent) console.log(`Uploading ${itemsToUpload.length} changed rows to ${tableName}`);
                    
                    // Map to Table Schema
                    const rows = itemsToUpload.map(item => {
                        // Base Object
                        const row = {
                            id: item.id,
                            data: item,
                            updated_at: new Date().toISOString()
                        };
                        
                        // Add specific columns ONLY if the table expects them
                        if (['records', 'submissions', 'live_bookings', 'saved_reports', 'insight_reviews', 'exemptions', 'link_requests'].includes(tableName)) {
                            row.trainee = item.trainee || item.user || null;
                        } 
                        else if (['audit_logs', 'monitor_history', 'attendance', 'access_logs', 'nps_responses', 'archived_users'].includes(tableName)) {
                            row.user_id = item.user || null;
                        }
                        else if (tableName === 'live_sessions') {
                            // Live sessions use 'trainer' as the owner usually, or sessionId as key
                            row.id = item.sessionId || item.id; // Ensure sessionId is used as PK
                            row.trainer = item.trainer || null;
                        }
                        // error_reports only needs id, data, updated_at
                        
                        return row;
                    });

                    const { error } = await supabaseClient.from(tableName).upsert(rows);
                    if (error) throw error;
                    
                    // Save Hash Map only on success
                    localStorage.setItem(hashMapKey, JSON.stringify(hashMap));
                    // Save content back to ensure IDs are persisted locally
                    localStorage.setItem(key, JSON.stringify(localContent));
                }
            } 
            // --- STRATEGY B: MONITOR STATE (Real-time Object -> Table) ---
            else if (key === 'monitor_data') {
                 // Special handling: Write MY entry to monitor_state table
                 // We do NOT save the whole object as a blob anymore.
                 if (CURRENT_USER) {
                     const allMon = JSON.parse(localStorage.getItem('monitor_data') || '{}');
                     const myMon = allMon[CURRENT_USER.user];
                     if (myMon) {
                         await supabaseClient.from('monitor_state').upsert({
                             user_id: CURRENT_USER.user,
                             data: myMon,
                             updated_at: new Date().toISOString()
                         });
                     }
                 }
            }
            // --- STRATEGY C: BLOB SYNC (Config, Rosters, Users) ---
            else {
                let finalContent = localContent;

                // Optimistic Merge (Fetch -> Merge -> Push)
                if (!force) {
                    const { data: remoteRow } = await supabaseClient
                        .from('app_documents')
                        .select('content')
                        .eq('key', key)
                        .single();
                    
                    if (remoteRow && remoteRow.content) {
                        const serverObj = { [key]: remoteRow.content };
                        const localObj = { [key]: localContent };
                        const mergedObj = performSmartMerge(serverObj, localObj, 'local_wins');
                        finalContent = mergedObj[key];
                    }
                }

                const { data: savedData, error: saveErr } = await supabaseClient
                    .from('app_documents')
                    .upsert({ 
                        key: key, 
                        content: finalContent,
                        updated_at: new Date().toISOString()
                    })
                    .select();

                if (saveErr) throw saveErr;
                
                localStorage.setItem(key, JSON.stringify(finalContent));
                if(savedData && savedData[0]) localStorage.setItem('sync_ts_' + key, savedData[0].updated_at);
            }
        }

        if(!silent) updateSyncUI('success');
        if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();

    } catch (err) {
        // RETRY LOGIC: Try once more if it failed (Network blip)
        if (retryCount < 1) {
            console.warn("Sync failed, retrying...", err);
            return saveToServer(targetKeys, force, silent, retryCount + 1);
        }

        if(!silent) updateSyncUI('error');
        console.error("Cloud Sync Error:", err);
        
        let msg = err.message || "Check Console for details";
        // Detect RLS Policy errors and give a clearer message
        if (msg.includes("row level security")) {
            msg = "Database Permission Denied (RLS Policy)";
            console.warn("FIX: Go to Supabase > SQL Editor and run: CREATE POLICY \"Allow All\" ON app_documents FOR ALL USING (true);");
        }
        
        if(typeof showToast === 'function' && !silent) showToast("Save Failed: " + msg, 'error');
    }
}

// --- HELPER: MERGE LOGIC (Crucial for Data Integrity) ---
// UPDATED: Improved deduplication logic to prevent "10 copies" bug
// ADDED: 'strategy' param. 'local_wins' (Pushing) or 'server_wins' (Pulling)
function performSmartMerge(server, local, strategy = 'local_wins') {
    const merged = { ...server }; 
    
    // Safety check for revoked users (Blacklist)
    const blacklist = local.revokedUsers || [];

    Object.keys(DB_SCHEMA).forEach(key => {
        const sVal = server[key];
        const lVal = local[key];

        // Case 1: Arrays (Records, Users, Tests, Notices)
        if (Array.isArray(sVal) && Array.isArray(lVal)) {
            let combined = [...sVal];
            
            lVal.forEach(localItem => {
                // Check if item exists in server data using SPECIFIC unique keys
                // This prevents duplicates when timestamps/hidden fields differ slightly
                const exists = combined.some(serverItem => {
                    // 1. Objects with IDs (Records, Tests, Notices, Bookings)
                    if (localItem.id && serverItem.id) {
                        return localItem.id.toString() === serverItem.id.toString();
                    }
                    
                    // 2. Users (Unique by username)
                    if (key === 'users' && localItem.user && serverItem.user) {
                        return localItem.user.toLowerCase() === serverItem.user.toLowerCase();
                    }

                    // 3. Assessments (Unique by Name) - FIXES ASSESSMENTS DUPLICATION
                    if (key === 'assessments' && localItem.name && serverItem.name) {
                        return localItem.name.trim().toLowerCase() === serverItem.name.trim().toLowerCase();
                    }

                    // 4. Vetting Topics, Whitelist & Reviewed (Strings) - FIXES DUPLICATION
                    if ((key === 'vettingTopics' || key === 'monitor_whitelist' || key === 'monitor_reviewed') && typeof localItem === 'string' && typeof serverItem === 'string') {
                        return localItem.trim().toLowerCase() === serverItem.trim().toLowerCase();
                    }

                    // 5. RECORDS (Composite Key) - FIXES SCORE DUPLICATION
                    // Fallback for legacy records that might not have IDs yet
                    if (key === 'records' && localItem.trainee && serverItem.trainee) {
                        // AGGRESSIVE DEDUPE: Match only on Trainee + Assessment
                        // This prevents duplicates if Group or Phase changes slightly
                        return (
                            localItem.trainee.toLowerCase() === serverItem.trainee.toLowerCase() &&
                            (localItem.assessment||'').toLowerCase() === (serverItem.assessment||'').toLowerCase()
                        );
                    }

                    // 5.5 SUBMISSIONS (Deduplication Fallback)
                    // Prevents duplicates if ID is missing but the submission event is identical
                    if (key === 'submissions' && localItem.trainee && serverItem.trainee && localItem.testId && serverItem.testId) {
                        return (
                            localItem.trainee === serverItem.trainee &&
                            localItem.testId === serverItem.testId &&
                            localItem.timestamp === serverItem.timestamp &&
                            localItem.score === serverItem.score &&
                            localItem.date === serverItem.date
                        );
                    }

                    // 6. Live Sessions (Unique by sessionId) - FIXES LIVE ARENA CRASH
                    if (key === 'liveSessions' && localItem.sessionId && serverItem.sessionId) {
                        return localItem.sessionId === serverItem.sessionId;
                    }

                    // 7. Archived Agents (Unique by user) - FIXES ARCHIVE DUPLICATION
                    if (key === 'graduated_agents' && localItem.user && serverItem.user) {
                        return localItem.user.toLowerCase() === serverItem.user.toLowerCase();
                    }

                    // 8. Link Requests (Unique by recordId)
                    if (key === 'linkRequests' && localItem.recordId && serverItem.recordId) {
                        return localItem.recordId === serverItem.recordId;
                    }

                    // 9. Monitor History (Unique by User + Date) - FIXES BLOAT
                    if (key === 'monitor_history' && localItem.user && serverItem.user && localItem.date && serverItem.date) {
                        return localItem.user === serverItem.user && localItem.date === serverItem.date;
                    }

                    // 7. Fallback: Deep Compare
                    return JSON.stringify(localItem) === JSON.stringify(serverItem);
                });

                if (!exists) {
                    combined.push(localItem); // Keep local item if missing on server
                } else {
                    // CONFLICT RESOLUTION:
                    // If strategy is 'server_wins' (Pulling), we do NOTHING here.
                    // We keep the item currently in 'combined' (which is the Server version).
                    
                    if (strategy === 'local_wins') {
                    const index = combined.findIndex(i => {
                        if (localItem.id && i.id) return localItem.id.toString() === i.id.toString();
                        if (key === 'users' && localItem.user && i.user) return localItem.user.toLowerCase() === i.user.toLowerCase();
                        if (key === 'assessments' && localItem.name && i.name) return localItem.name.toLowerCase() === i.name.toLowerCase();
                        if (key === 'vettingTopics' && typeof localItem === 'string' && typeof i === 'string') return localItem.toLowerCase() === i.toLowerCase();
                        if (key === 'records') {
                            return (
                                localItem.trainee === i.trainee &&
                                localItem.assessment === i.assessment &&
                                localItem.groupID === i.groupID &&
                                localItem.phase === i.phase
                            );
                        }
                        if (key === 'liveSessions' && localItem.sessionId && i.sessionId) return localItem.sessionId === i.sessionId;
                        return JSON.stringify(i) === JSON.stringify(localItem);
                    });
                        if(index > -1) combined[index] = localItem;
                    }
                }
            });

            // --- DELETION FIX: Users ---
            if (key === 'users' && blacklist.length > 0) {
                combined = combined.filter(u => !blacklist.includes(u.user));
            }

            merged[key] = combined;
        } 
        // Case 2a: Vetting Session (Deep Merge Trainees)
        else if (key === 'vettingSession') {
            const safeSVal = sVal || {};
            const safeLVal = lVal || {};
            
            // RESET CHECK: If Server has a different start time, it's a new session.
            // We must discard local stale data (like 'completed' status from previous run).
            if (safeSVal.startTime && safeLVal.startTime && safeSVal.startTime !== safeLVal.startTime) {
                 merged[key] = safeSVal;
            } else {
                // Standard Merge
                if (strategy === 'server_wins') {
                    merged[key] = { ...safeLVal, ...safeSVal }; // Server overwrites Local
                    
                    if (safeSVal.trainees || safeLVal.trainees) {
                        merged[key].trainees = {
                            ...(safeLVal.trainees || {}),
                            ...(safeSVal.trainees || {})
                        };
                    }
                } else {
                    merged[key] = { ...safeSVal, ...safeLVal }; // Local overwrites Server (Default)
                    
                    if (safeSVal.trainees || safeLVal.trainees) {
                        merged[key].trainees = {
                            ...(safeSVal.trainees || {}),
                            ...(safeLVal.trainees || {})
                        };
                    }
                }

                // PROTECTION: If I am a Trainee, my local state is the truth for ME (unless reset above).
                // This prevents background sync from reverting my answers while I type.
                if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.user) {
                    if (safeLVal.trainees && safeLVal.trainees[CURRENT_USER.user]) {
                        if (!merged[key].trainees) merged[key].trainees = {};
                        merged[key].trainees[CURRENT_USER.user] = safeLVal.trainees[CURRENT_USER.user];
                    }
                }
            }
        }
        // Case 2b: Monitor Data (User-Specific Merge)
        // Prevents "War for Data" where local stale data overwrites other users' fresh server data
        else if (key === 'monitor_data' && sVal && typeof sVal === 'object' && lVal && typeof lVal === 'object') {
             // 1. Start with Server data (Source of truth for everyone else)
             merged[key] = { ...sVal };
             
             // 2. Enforce MY local version is kept (Source of truth for me)
             if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.user) {
                 if (lVal[CURRENT_USER.user]) {
                     merged[key][CURRENT_USER.user] = lVal[CURRENT_USER.user];
                 }
             } else {
                 // Fallback: Standard merge if no user logged in
                 merged[key] = { ...sVal, ...lVal };
             }
        }
        // Case 2c: Agent Notes (Deep Merge of Note Arrays)
        // Allows multiple admins to add notes to the same user without overwriting history
        else if (key === 'agentNotes' && lVal && typeof lVal === 'object') {
            const safeSVal = sVal || {};
            merged[key] = { ...safeSVal }; // Start with server state
            
            // Iterate through local users to merge their notes
            Object.keys(lVal).forEach(user => {
                const sNotes = safeSVal[user]; 
                const lNotes = lVal[user]; 
                
                // Helper: Normalize legacy strings to Note Objects
                const toNoteArray = (n) => {
                    if (!n) return [];
                    if (Array.isArray(n)) return n;
                    return [{ id: 'legacy_'+Date.now(), content: n, date: new Date().toISOString(), author: 'Unknown' }];
                };

                const sArr = toNoteArray(sNotes);
                const lArr = toNoteArray(lNotes);
                
                // Merge: Keep all server notes, add local notes if they don't exist (by ID or Content+Date)
                const combined = [...sArr];
                lArr.forEach(lNote => {
                    const exists = combined.some(sNote => 
                        (lNote.id && sNote.id && lNote.id === sNote.id) ||
                        (lNote.content === sNote.content && lNote.date === sNote.date)
                    );
                    if (!exists) combined.push(lNote);
                });
                
                // Sort newest first
                combined.sort((a,b) => new Date(b.date) - new Date(a.date));
                
                merged[key][user] = combined;
            });
        }
        // Case 2: Objects (Rosters, Schedules)
        else if (typeof sVal === 'object' && sVal !== null && typeof lVal === 'object' && lVal !== null) {
            if (strategy === 'server_wins') {
                merged[key] = { ...lVal, ...sVal };
            } else {
                merged[key] = { ...sVal, ...lVal };
            }
        } 
        // Case 3: Primitives / Fallback
        else {
            merged[key] = lVal || sVal;
        }
    });
    
    // Ensure the blacklist itself is preserved
    merged.revokedUsers = blacklist;

    return merged;
}

// 4. SUPABASE: Fetch System Status
async function fetchSystemStatus() {
    try {
        if (!window.supabaseClient) return { error: "No Cloud Connection" };

        const start = Date.now();

        // Estimate storage size from LocalStorage
        let storageSize = 0;
        for(let key in localStorage) {
            if(localStorage.hasOwnProperty(key)) storageSize += localStorage[key].length;
        }
        
        const twoMinutesAgo = new Date(Date.now() - 120000).toISOString();
        
        // OPTIMIZED: Select only specific columns instead of '*' to save bandwidth
        const { data: activeUsers, error } = await supabaseClient
            .from('sessions')
            .select('user, role, version, isIdle, idleTime, lastSeen, clientId')
            .gte('lastSeen', twoMinutesAgo);

        if (error) {
            console.warn("System Status Fetch Warning:", error.message);
            return { error: "Server Error (500)" };
        }

        const end = Date.now();
        const latency = end - start;

        renderSystemHealthUI({
            storageSize,
            latency,
            activeUsers,
            memory: (performance && performance.memory) ? performance.memory.usedJSHeapSize : null
        });

        // RETURN DATA FOR AI / CALLER
        return {
            storage: typeof formatBytes === 'function' ? formatBytes(storageSize) : storageSize,
            latency: latency + " ms",
            activeUsers: activeUsers ? activeUsers.length : 0,
            memory: (performance && performance.memory) ? formatBytes(performance.memory.usedJSHeapSize) : "N/A",
            connection: navigator.connection ? navigator.connection.effectiveType.toUpperCase() : (navigator.onLine ? "ONLINE" : "OFFLINE")
        };

    } catch (e) {
        console.error("Supabase Status fetch error", e);
        return { error: e.message };
    }
}

// --- HELPER: RENDER SYSTEM HEALTH UI ---
function renderSystemHealthUI(metrics) {
    const storageEl = document.getElementById('statusStorage');
    const latencyEl = document.getElementById('statusLatency');
    const activeTable = document.getElementById('activeUsersTable');
    const memoryEl = document.getElementById('statusMemory');
    const connEl = document.getElementById('statusConnection');
    const platformEl = document.getElementById('statusPlatform');

    if (storageEl && typeof formatBytes === 'function') storageEl.innerText = formatBytes(metrics.storageSize);

    if (latencyEl) {
        latencyEl.innerText = metrics.latency + " ms";
        latencyEl.style.color = metrics.latency < 200 ? "#2ecc71" : (metrics.latency < 500 ? "orange" : "#ff5252");
    }

    if (memoryEl && metrics.memory && typeof formatBytes === 'function') {
        memoryEl.innerText = formatBytes(metrics.memory);
    }
    
    if (connEl) {
        // Use browser API instead of pinging Google (Faster/Lighter)
        if (navigator.connection) {
            // Try to get specific interface type (Electron/Mobile)
            const type = navigator.connection.type;
            if (type && type !== 'unknown') {
                connEl.innerText = type.toUpperCase();
            } else {
                // Fallback: effectiveType returns '4g' for fast connections. Display 'ONLINE' instead.
                const eff = navigator.connection.effectiveType;
                connEl.innerText = (eff === '4g') ? "ONLINE" : eff.toUpperCase();
            }
        } else {
            connEl.innerText = navigator.onLine ? "ONLINE" : "OFFLINE";
        }
        connEl.style.color = navigator.onLine ? "#2ecc71" : "#ff5252";
    }
    
    if (platformEl) {
        const os = (navigator.userAgentData && navigator.userAgentData.platform) ? navigator.userAgentData.platform : navigator.platform;
        platformEl.innerText = os;
    }

    if (activeTable) {
        let html = '';
        if(!metrics.activeUsers || metrics.activeUsers.length === 0) {
                html = '<tr><td colspan="6" class="text-center">No active users detected.</td></tr>';
        } else {
            metrics.activeUsers.forEach(u => {
                const idleStr = (u.idleTime !== undefined && u.idleTime !== null)
                    ? (typeof formatDuration === 'function' ? formatDuration(u.idleTime) : (u.idleTime/1000).toFixed(0) + 's')
                    : '-';
                
                const verStr = u.version || '-';
                const roleStr = u.role || '-';
                
                const statusBadge = u.isIdle
                    ? '<span class="status-badge status-fail">Idle</span>'
                    : '<span class="status-badge status-pass">Active</span>';
                
                const rowClass = u.isIdle ? 'user-idle' : '';

                html += `
                    <tr class="${rowClass}">
                        <td><strong>${u.user}</strong></td>
                        <td style="font-size:0.8rem; color:var(--text-muted);">${verStr}</td>
                        <td>${roleStr}</td>
                        <td>${statusBadge}</td>
                        <td>${idleStr}</td>
                        <td>
                            <button class="btn-danger btn-sm" onclick="sendRemoteCommand('${u.user}', 'logout')" title="Force Sign Out"><i class="fas fa-sign-out-alt"></i></button>
                            <button class="btn-warning btn-sm" onclick="sendRemoteCommand('${u.user}', 'restart')" title="Remote Restart"><i class="fas fa-power-off"></i></button>
                            <button class="btn-primary btn-sm" onclick="sendRemoteCommand('${u.user}', 'force_update')" title="Force Update Check"><i class="fas fa-cloud-download-alt"></i></button>
                        </td>
                    </tr>
                `;
            });
        }
        activeTable.innerHTML = html;
    }
}

// --- ACCESS LOGGING (Login/Logout/Timeout) ---
async function logAccessEvent(username, type) {
    if (!username) return;
    
    // 1. Load current logs (Local cache is fine, we merge later)
    const logs = JSON.parse(localStorage.getItem('accessLogs') || '[]');
    
    const newLog = {
        id: Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        user: username,
        type: type, // 'Login', 'Logout', 'Timeout'
        date: new Date().toISOString()
    };
    
    // 2. Prune > 14 days (2 Weeks)
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    
    const filteredLogs = logs.filter(l => new Date(l.date) > twoWeeksAgo);
    filteredLogs.push(newLog);
    
    localStorage.setItem('accessLogs', JSON.stringify(filteredLogs));
    
    // 3. Sync to Cloud (Safe Merge)
    if(typeof saveToServer === 'function') {
        await saveToServer(['accessLogs'], false);
    }
}

async function refreshAccessLogs() {
    const container = document.getElementById('accessLogTable');
    if (!container) return;

    // Pull latest logs from server to ensure we see other users' activity
    await loadFromServer(true);
    
    const logs = JSON.parse(localStorage.getItem('accessLogs') || '[]');
    // Sort newest first
    logs.sort((a,b) => new Date(b.date) - new Date(a.date));
    
    container.innerHTML = logs.map(l => {
        const dateStr = new Date(l.date).toLocaleString();
        return `<tr><td>${dateStr}</td><td>${l.user}</td><td>${l.type}</td></tr>`;
    }).join('');
}

// --- AUDIT LOGGING (Critical Actions) ---
async function logAuditAction(username, action, details) {
    if (!username) return;
    
    // 1. Load current logs
    const logs = JSON.parse(localStorage.getItem('auditLogs') || '[]');
    
    const newLog = {
        id: Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        user: username,
        action: action,
        details: details,
        date: new Date().toISOString()
    };
    
    // 2. Prune > 60 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    
    const filteredLogs = logs.filter(l => new Date(l.date) > cutoff);
    filteredLogs.push(newLog);
    
    localStorage.setItem('auditLogs', JSON.stringify(filteredLogs));
    
    // 3. Sync to Cloud (Safe Merge)
    if(typeof saveToServer === 'function') {
        await saveToServer(['auditLogs'], false);
    }
}

let HEARTBEAT_SAFE_MODE = false; // false | 'safe' | 'minimal'

// 5. SUPABASE: Send Heartbeat
async function sendHeartbeat() {
    if (!CURRENT_USER || !window.supabaseClient) return;
    
    const last = window.LAST_INTERACTION || Date.now();
    const now = Date.now();
    const diff = now - last;
    const limit = (typeof IDLE_THRESHOLD !== 'undefined') ? IDLE_THRESHOLD : 60000;
    const isIdle = diff > limit;
    
    // Get extra info
    const clientId = localStorage.getItem('client_id') || 'unknown';
    let currentActivity = 'Idle';
    if (typeof StudyMonitor !== 'undefined' && StudyMonitor.currentActivity) {
        currentActivity = StudyMonitor.currentActivity;
    }

    try {
        // 1. Try Full Heartbeat (Default)
        if (!HEARTBEAT_SAFE_MODE) {
            const safeActivity = currentActivity.length > 250 ? currentActivity.substring(0, 247) + '...' : currentActivity;
            const fullPayload = {
                user: CURRENT_USER.user,
                role: CURRENT_USER.role,
                version: window.APP_VERSION || 'Unknown',
                idleTime: Math.round(diff),
                isIdle: isIdle,
                lastSeen: new Date().toISOString(),
                clientId: clientId,
                activity: safeActivity
            };
            
            const { error } = await supabaseClient.from('sessions').upsert(fullPayload);
            if (!error) return; // Success
            
            console.warn("Heartbeat Full failed (Schema mismatch?). Downgrading to Safe Mode.");
            HEARTBEAT_SAFE_MODE = 'safe';
        }

        // 2. Safe Mode (Common fields only)
        if (HEARTBEAT_SAFE_MODE === 'safe') {
            const { error } = await supabaseClient.from('sessions').upsert({
                user: CURRENT_USER.user,
                lastSeen: new Date().toISOString(),
                isIdle: isIdle,
                idleTime: Math.round(diff)
            });
            if (!error) return;
            
            console.warn("Heartbeat Safe failed. Downgrading to Minimal.");
            HEARTBEAT_SAFE_MODE = 'minimal';
        }

        // 3. Minimal Mode (Absolute basics)
        if (HEARTBEAT_SAFE_MODE === 'minimal') {
            await supabaseClient.from('sessions').upsert({
                user: CURRENT_USER.user,
                lastSeen: new Date().toISOString()
            });
        }
            
        // 2. Check for Remote Commands (Pending Actions)
        const { data: sessionData } = await supabaseClient
            .from('sessions')
            .select('pending_action')
            .eq('user', CURRENT_USER.user)
            .single();
            
        if (sessionData && sessionData.pending_action) {
            // Clear command first to prevent loops
            await supabaseClient.from('sessions').update({ pending_action: null }).eq('user', CURRENT_USER.user);
            
            if (sessionData.pending_action === 'logout') {
                if (typeof logout === 'function') logout();
            } else if (sessionData.pending_action === 'restart') {
                if (typeof triggerForceRestart === 'function') triggerForceRestart();
            } else if (sessionData.pending_action === 'force_update') {
                if (typeof require !== 'undefined') {
                    // NEW: Set flag so main.js knows to auto-install when download completes
                    sessionStorage.setItem('force_update_active', 'true');
                    const { ipcRenderer } = require('electron');
                    ipcRenderer.send('manual-update-check');
                    if(typeof showToast === 'function') showToast("System Update Check Initiated by Admin", "info");
                }
            } else if (sessionData.pending_action.startsWith('msg:')) {
                const msg = sessionData.pending_action.replace('msg:', '');
                alert("💬 ADMIN MESSAGE:\n\n" + msg);
            }
        }
    } catch (e) { /* Silent fail */ }
}

/* ================= EXPORT / IMPORT (COMPLETE BACKUP) ================= */

function importCSV(input) {
    const file = input.files[0];
    if(!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const lines = text.split('\n').map(l => l.trim()).filter(l => l);
        
        const newRecords = [];
        const startI = lines[0].toLowerCase().includes('trainee') ? 1 : 0;
        
        for(let i=startI; i<lines.length; i++) {
            const cols = lines[i].split(',');
            if(cols.length >= 4) {
                newRecords.push({
                    groupID: cols[0].trim(),
                    trainee: cols[1].trim(),
                    assessment: cols[2].trim(),
                    score: parseFloat(cols[3].trim()) || 0,
                    cycle: cols[4] ? cols[4].trim() : 'New Onboard',
                    phase: cols[5] ? cols[5].trim() : 'Assessment',
                    docSaved: true,
                    videoSaved: false,
                    link: ""
                });
            }
        }
        
        const current = JSON.parse(localStorage.getItem('records') || '[]');
        localStorage.setItem('records', JSON.stringify([...current, ...newRecords]));
        
        if(typeof syncGroupsFromRecords === 'function') syncGroupsFromRecords(false);
        if(typeof handleAutoBackup === 'function') handleAutoBackup();
        
        alert(`Imported ${newRecords.length} records.`);
        location.reload();
    };
    reader.readAsText(file);
}

function downloadCSVTemplate() {
    const csv = "Group,Trainee Name,Assessment Name,Score,Cycle,Phase\n2026-01,John Doe,Course 1: Terms,85,New Onboard,Assessment";
    const b = new Blob([csv],{type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = "import_template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// --- BACKUP & RESTORE (v2.1.48) ---
async function importDatabase(input) {
    const file = input.files[0];
    if(!file) return;
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            
            Object.keys(data).forEach(key => {
                if (key === 'meta') return; // Skip metadata
                
                if (typeof data[key] === 'object') {
                    localStorage.setItem(key, JSON.stringify(data[key]));
                } else {
                    localStorage.setItem(key, data[key]);
                }
            });

            console.log("Restoring backup to cloud...");
            if (typeof saveToServer === 'function') await saveToServer(null, true); // Force save ALL keys

            alert("Database restored successfully.");
            location.reload();
        } catch (err) {
            console.error(err);
            alert("Error restoring database: " + err.message);
        }
    };
    reader.readAsText(file);
}

async function exportDatabase() {
    const btn = document.querySelector('button[onclick="exportDatabase()"]');
    let originalText = "";
    if(btn) { originalText = btn.innerText; btn.innerText = "Syncing..."; btn.disabled = true; }

    try {
        console.log("Initiating Safe Cloud Export...");
        
        // 1. PULL LATEST DATA (Critical Step)
        if(typeof loadFromServer === 'function') {
            await loadFromServer(true);
        }

        // 2. GENERATE EXPORT BLOB
        const d = {};
        
        // Metadata for version tracking
        d.meta = {
            version: window.APP_VERSION || '2.0',
            date: new Date().toISOString(),
            exportedBy: (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) ? CURRENT_USER.user : 'Unknown'
        };

        // Use DB_SCHEMA keys
        const schemaKeys = (typeof DB_SCHEMA !== 'undefined') ? Object.keys(DB_SCHEMA) : ['records','users','assessments','rosters','schedules','liveBookings'];
        
        schemaKeys.forEach(k => {
            d[k] = JSON.parse(localStorage.getItem(k)) || (typeof DB_SCHEMA !== 'undefined' ? DB_SCHEMA[k] : []);
        });
        
        d.theme = localStorage.getItem('theme') || 'dark';
        d.autoBackup = localStorage.getItem('autoBackup') || 'false';
        d.local_theme_config = JSON.parse(localStorage.getItem('local_theme_config') || '{}');
       
        const b = new Blob([JSON.stringify(d,null,2)],{type:'application/json'}); 
        const a = document.createElement('a'); 
        a.href = URL.createObjectURL(b); 
        a.download = "1stLine_Backup_" + new Date().toISOString().slice(0,10) + ".json"; 
        document.body.appendChild(a); 
        a.click(); 
        document.body.removeChild(a); 
        
    } catch(e) {
        console.error("Export Failed:", e);
        alert("Export failed. Please check your internet connection.");
    } finally {
        if(btn) { btn.innerText = originalText || "Export Database"; btn.disabled = false; }
    }
}

/* ================= BACKGROUND SYNC ================= */

function handleAutoBackup() {
    const enabled = localStorage.getItem('autoBackup') === 'true';
    if(enabled) {
        // Auto-backup is risky with split schema, usually better to rely on targeted saves
    }
}

let SYNC_INTERVAL = null;
let HEARTBEAT_INTERVAL_ID = null;

/* ================= REALTIME HELPERS ================= */
// Lightweight wrapper around Supabase Realtime for a single app_documents key.
// We keep this tiny and focused to stay within free-tier constraints.
//
// Usage:
//   const unsub = subscribeToDocKey('vettingSession', (content, payload) => { ... });
//   unsub?.();
//
// Notes:
// - Requires Supabase Realtime to be enabled for Postgres changes.
// - If RLS blocks the table or Realtime isn't configured, callers should fallback to polling.
window.__DOC_REALTIME_SUBS = window.__DOC_REALTIME_SUBS || {};

function subscribeToDocKey(docKey, onContent) {
    try {
        if (!window.supabaseClient || !docKey || typeof onContent !== 'function') return null;

        // Clean up any existing subscription for this key
        if (window.__DOC_REALTIME_SUBS[docKey]) {
            try { window.__DOC_REALTIME_SUBS[docKey].unsubscribe(); } catch (e) {}
            delete window.__DOC_REALTIME_SUBS[docKey];
        }

        const channel = window.supabaseClient
            .channel(`doc_${docKey}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'app_documents', filter: `key=eq.${docKey}` },
                (payload) => {
                    const content = payload?.new?.content;
                    if (content === undefined) return;
                    onContent(content, payload);
                }
            )
            .subscribe((status) => {
                // Status can be: SUBSCRIBED / TIMED_OUT / CLOSED / CHANNEL_ERROR
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.warn(`Realtime subscription issue for ${docKey}:`, status);
                }
            });

        window.__DOC_REALTIME_SUBS[docKey] = channel;

        // Return unsubscribe function
        return () => {
            try { channel.unsubscribe(); } catch (e) {}
            if (window.__DOC_REALTIME_SUBS[docKey] === channel) {
                delete window.__DOC_REALTIME_SUBS[docKey];
            }
        };
    } catch (e) {
        console.warn("subscribeToDocKey failed:", e);
        return null;
    }
}

function startRealtimeSync() {
    if (SYNC_INTERVAL) clearInterval(SYNC_INTERVAL);
    if (HEARTBEAT_INTERVAL_ID) clearInterval(HEARTBEAT_INTERVAL_ID);

    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
    const rates = config.sync_rates || { admin: 10000, teamleader: 300000, trainee: 60000 };
    const beats = config.heartbeat_rates || { admin: 5000, default: 60000 };

    // Default Rates (Trainee/Guest)
    let syncRate = rates.trainee; 
    let beatRate = beats.default;

    // Role-Based Adjustment
    if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) {
        if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin') {
            syncRate = rates.admin; 
            beatRate = beats.admin; 
        } else if (CURRENT_USER.role === 'teamleader') {
            syncRate = rates.teamleader;
        }
    }

    console.log(`Starting Sync Engine. Sync: ${syncRate/1000}s, Heartbeat: ${beatRate/1000}s`);
    
    // 1. DATA SYNC: Poll every 60 Seconds (High Performance / Cohort Safe)
    // Uses "loadFromServer" to pull changes from others (e.g. Trainees to Admin)
    SYNC_INTERVAL = setInterval(async () => {
        await loadFromServer(true); 
    }, syncRate);

    // 2. HEARTBEAT: Poll every 15 seconds
    // Fast updates for "Active User" dashboard status
    HEARTBEAT_INTERVAL_ID = setInterval(() => {
        sendHeartbeat();

        // --- AUTO LOGOUT CHECK ---
        if (CURRENT_USER) {
            const last = window.LAST_INTERACTION || Date.now();
            const idleConf = config.idle_thresholds || { logout: 900000 };
            let limitMs = idleConf.logout;
            
            // FIX: Respect User Override (Minutes to Ms)
            if (CURRENT_USER.idleTimeout && CURRENT_USER.idleTimeout > 0) {
                limitMs = CURRENT_USER.idleTimeout * 60 * 1000;
            }
            
            // EXCEPTION: Vetting Arena (Prevent Logout while waiting)
            const vSession = JSON.parse(localStorage.getItem('vettingSession') || '{}');
            const isVetting = vSession.active && vSession.trainees && vSession.trainees[CURRENT_USER.user];

            if (!isVetting && (Date.now() - last) > limitMs) {
                if (typeof window.cacheAndLogout === 'function') window.cacheAndLogout();
            }
        }
        
        if(CURRENT_USER && (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin')) {
            const statusView = document.getElementById('admin-view-status');
            if(statusView && statusView.offsetParent !== null) {
                fetchSystemStatus();
            }

            // NEW: Refresh Dashboard Widget if visible
            const dashView = document.getElementById('dashboard-view');
            if(dashView && dashView.classList.contains('active')) {
                if(typeof updateDashboardHealth === 'function') updateDashboardHealth();
            }
        }
    }, beatRate);
    
    console.log("Real-time sync & heartbeat engine started (High Performance Mode).");
}

// 6. FACTORY RESET (Cloud & Local)
// This function wipes both Supabase and LocalStorage to prevent "Zombie Data" from re-syncing.
function closeResetModal() {
    const modal = document.getElementById('resetModal');
    if(modal) {
        modal.classList.add('hidden');
        const input = document.getElementById('resetVerify');
        if(input) input.value = '';
    }
}

function performCloudFactoryReset() {
    const modal = document.getElementById('resetModal');
    if(modal) modal.classList.remove('hidden');
}

async function executeFactoryReset() {
    const input = document.getElementById('resetVerify');
    if(!input || input.value !== 'DELETE') {
        alert("Verification failed. Please type 'DELETE' exactly.");
        return;
    }
    closeResetModal();

    console.log("Factory Reset Initiated...");

    try {
        // 1. Construct Clean State
        // Robust Password Handling: Try to hash, fallback to plaintext if auth.js isn't ready
        let defaultPass = "Pass0525@";
        try {
            if(typeof hashPassword === 'function') {
                defaultPass = await hashPassword("Pass0525@");
            } else {
                console.warn("hashPassword function not found. Using plaintext.");
            }
        } catch (e) {
            console.warn("Password hashing failed. Using plaintext.", e);
        }

        const cleanState = {
            records: [], 
            users: [{user: 'admin', pass: defaultPass, role: 'admin', theme: { primaryColor: '#F37021', wallpaper: '' }}], 
            assessments: [], 
            rosters: {},
            accessControl: { enabled: false, whitelist: [] },
            trainingData: {}, 
            vettingTopics: [],
            schedules: { "A": { items: [], assigned: null }, "B": { items: [], assigned: null } }, 
            liveBookings: [], 
            cancellationCounts: {}, 
            liveScheduleSettings: { startDate: new Date().toISOString().split('T')[0], days: 7 },
            tests: [], 
            submissions: [], 
            savedReports: [],
            insightReviews: [], 
            exemptions: [], 
            notices: [],
            revokedUsers: [],
            system_config: DB_SCHEMA.system_config // Reset system settings to defaults
        };

        // 2. Overwrite Supabase Data & Sessions
        if (window.supabaseClient) {
            // A. Wipe documents table
            const { error: deleteErr } = await window.supabaseClient
                .from('app_documents')
                .delete().neq('key', 'placeholder'); 
            
            if (deleteErr) throw deleteErr;

            // B. Re-initialize Admin User
            await saveToServer(['users'], true);
            console.log("Cloud tables wiped.");

            // C. Wipe sessions table to clear active user monitor
            const { error: sessionErr } = await window.supabaseClient
                .from('sessions')
                .delete()
                .neq('user', 'placeholder_to_delete_all'); // Delete all rows

            if (sessionErr) throw sessionErr;
            console.log("Cloud 'sessions' table wiped.");
        } else {
            alert("⚠️ Warning: Not connected to Cloud Database. Only local data will be wiped.");
        }

        // 3. Clear ALL Local & Session Storage
        localStorage.clear();
        sessionStorage.clear(); 
        console.log("Local and session storage wiped.");

        // 4. Reload to a clean login screen
        alert("System has been reset to factory settings. You will be logged out.");
        location.reload();

    } catch (err) {
        console.error("Reset Failed:", err);
        alert("Factory Reset Failed: " + err.message);
    }
}

// Export for Jest testing (Node.js environment)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        DB_SCHEMA,
        loadFromServer,
        saveToServer,
        performSmartMerge,
        notifyUnsavedChanges,
        logAuditAction,
        reportSystemError
    };
}

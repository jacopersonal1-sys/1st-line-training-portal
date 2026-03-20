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
    tl_task_submissions: [], // Team Leader Daily Submissions
    tl_personal_lists: {},   // TL Roster { "tl_user": ["agent1", "agent2"] }
    attendance_records: [],
    attendance_settings: {
        platforms: ["WhatsApp", "Microsoft Teams", "Call", "SMS"],
        contacts: ["Darren", "Netta", "Jaco", "Claudine"]
    },
    // --- SUPER ADMIN CONFIGURATION ---
    system_config: {
        sync_rates: {
            cloud: { admin: 4000, teamleader: 60000, trainee: 15000 },
            local: { admin: 2000, teamleader: 30000, trainee: 5000 },
            staging: { admin: 4000, teamleader: 60000, trainee: 15000 }
        },
        heartbeat_rates: { admin: 5000, default: 30000 },
        idle_thresholds: { warning: 60000, logout: 900000 },
        attendance: { work_start: "08:00", late_cutoff: "08:15", work_end: "17:00", reminder_start: "16:45", allow_weekend_login: false },
        security: { maintenance_mode: false, lockdown_mode: false, min_version: "0.0.0", force_kiosk_global: false, allowed_ips: [], banned_clients: [], client_whitelist: [] },
        features: { vetting_arena: true, live_assessments: true, nps_surveys: true, daily_tips: true, disable_animations: false },
        monitoring: { tolerance_ms: 180000, whitelist_strict: false },
        announcement: { active: false, message: "", type: "info" },
        broadcast: { id: 0, message: "" },
        ai: { enabled: true, provider: "gemini", apiKey: "", model: "gemini-1.5-flash", endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent" },
        // NEW: Server Failover Settings
        server_settings: { active: 'cloud', local_url: '', local_key: '' }
    },
    system_tombstones: [], // Persistent blacklist for deleted item IDs
    ai_suggestions: [], // Stores background improvement suggestions
    revokedUsers: [], // Added to ensure blacklist syncs
    auditLogs: [], // Critical Action History
    network_diagnostics: [], // New: Network Health Reports
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
    calendarEvents: [], // Custom Admin Events
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
    'linkRequests': 'link_requests',
    'calendarEvents': 'calendar_events',
    'network_diagnostics': 'network_diagnostics',
    'tl_task_submissions': 'tl_task_submissions'
};

// --- SERVER AUTHORITY CONFIGURATION ---
// Tables that must always reflect the exact state of the server (No Merging, Full Overwrite).
// This fixes "Ghost Data" and synchronization lag for critical shared resources.
const AUTHORITATIVE_TABLES = [
    'live_sessions',
    'live_bookings',
    'tl_task_submissions',
    'link_requests',
    'calendar_events'
];

// --- NEW: DEBOUNCED SAVE QUEUE (PERFORMANCE) ---
// This prevents the UI from freezing on large data saves by queueing the save
// and processing it a few seconds later in the background.
let SAVE_QUEUE = new Set();
let SAVE_TIMEOUT = null;
const SAVE_DEBOUNCE_MS = 3000; // 3 seconds

// --- NEW: INCOMING DATA QUEUE (STABILITY) ---
let INCOMING_DATA_QUEUE = [];
let QUEUE_PROCESSOR_INTERVAL = null;
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

// --- HARD DELETE PROTOCOL (Ghost Data Fix) ---
const PENDING_DEL_KEY = 'system_pending_deletes';
const TOMBSTONE_KEY = 'system_tombstones'; // New: Persistent Blacklist for Deleted IDs

// Queues a delete operation and attempts to execute it immediately
async function hardDelete(tableName, id) {
    if (!tableName || !id) return;
    
    // 1. Queue it (Persistence)
    const queue = JSON.parse(localStorage.getItem(PENDING_DEL_KEY) || '[]');
    // Avoid duplicates
    if (!queue.some(i => i.type === 'id' && i.table === tableName && i.id === id)) {
        queue.push({ type: 'id', table: tableName, id: id, ts: Date.now() });
        localStorage.setItem(PENDING_DEL_KEY, JSON.stringify(queue));
    }

    // 1.5 Add to Tombstones (Local Blacklist) to prevent immediate reappearance
    const tombstones = JSON.parse(localStorage.getItem(TOMBSTONE_KEY) || '[]');
    if (!tombstones.includes(id)) {
        tombstones.push(id);
        localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(tombstones));
        // FIX: Sync the tombstone list so other clients know about the deletion.
        // Use a silent, non-forced save to run in the background.
        if (typeof saveToServer === 'function') {
            saveToServer(['system_tombstones'], false, true);
        }
    }

    // 2. Try to execute
    return await processPendingDeletes();
}

// Queues a bulk delete by query (e.g. delete all records for user X)
async function hardDeleteByQuery(tableName, column, value) {
    if (!tableName || !column || !value) return;

    const queue = JSON.parse(localStorage.getItem(PENDING_DEL_KEY) || '[]');
    queue.push({ type: 'query', table: tableName, col: column, val: value, ts: Date.now() });
    localStorage.setItem(PENDING_DEL_KEY, JSON.stringify(queue));

    return await processPendingDeletes();
}

// Flushes the delete queue to Supabase
async function processPendingDeletes() {
    if (!window.supabaseClient) return;
    
    const queue = JSON.parse(localStorage.getItem(PENDING_DEL_KEY) || '[]');
    if (queue.length === 0) return;

    console.log(`Processing ${queue.length} pending deletes...`);
    let allSucceeded = true;
    const remaining = [];

    for (const item of queue) {
        try {
            let error = null;
            if (item.type === 'id') {
                ({ error } = await window.supabaseClient.from(item.table).delete().eq('id', item.id));
            } else if (item.type === 'query') {
                ({ error } = await window.supabaseClient.from(item.table).delete().eq(item.col, item.val));
            }
            if (error) throw error;
        } catch (e) {
            // If table doesn't exist, discard the delete op, don't retry.
            if (e.code === 'PGRST205' || (e.message && e.message.includes('does not exist'))) {
                console.warn(`Delete failed because table '${item.table}' does not exist. Discarding operation.`);
                // Do not add to 'remaining' queue.
            } else {
                console.warn("Delete failed, keeping in queue:", e);
                allSucceeded = false;
                remaining.push(item);
            }
        }
    }
    localStorage.setItem(PENDING_DEL_KEY, JSON.stringify(remaining));
    return allSucceeded;
}

// --- NETWORK STATE LISTENERS (Auto-Recovery) ---
window.addEventListener('online', () => {
    console.log("Network Online. Resuming sync...");
    updateSyncUI('syncing');
    setTimeout(async () => {
        // 1. Push any offline changes first (Prevent overwrite)
        if (typeof saveToServer === 'function') await saveToServer(null, false, true);
        // 2. Then pull authoritative state
        loadFromServer(true);
    }, 1500);
});
window.addEventListener('offline', () => {
    updateSyncUI('error');
});

// 2. Load Data (UPDATED: HYBRID ROW-LEVEL SYNC)
// Fetches Blobs for config/rosters AND Delta Rows for records/logs
async function loadFromServer(silent = false) {
    try {
        if (window.supabaseClient) updateSyncUI('syncing');
        if (!window.supabaseClient) {
            if(!silent) console.warn("loadFromServer: Supabase client not initialized.");
            return false;
        }

        // 0. Process Deletes First (Ensure server is clean before we pull)
        await processPendingDeletes();

        let criticalSuccess = false;

        const start = Date.now();
        
        // --- PHASE A: BLOB SYNC (Settings, Rosters, Users) ---
        const { data: meta, error } = await window.supabaseClient
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
            
            const { data: docs, error: fetchErr } = await window.supabaseClient
                .from('app_documents')
                .select('key, content, updated_at')
                .in('key', keysToFetch);
            
            if (fetchErr) throw fetchErr;

            for (const doc of docs) {
                // SMART PULL: Always try to merge JSON data to prevent overwriting local unsaved drafts
                // We use 'server_wins' strategy here: If an item exists in both, Server version is the truth.
                const localVal = JSON.parse(localStorage.getItem(doc.key));
                
                // FIX: For specific Admin keys (Rosters, Schedules, Tests), do NOT merge. 
                // Merging restores deleted items if the server hasn't updated yet or if we are out of sync.
                // We trust the Server's snapshot if it is newer, or our local overwrite if we just saved.
                const noMergeKeys = ['rosters', 'schedules', 'tests', 'vettingTopics', 'liveSchedules', 'assessments'];
                
                if (localVal && (Array.isArray(localVal) || typeof localVal === 'object') && !noMergeKeys.includes(doc.key)) {
                    let strategy = 'server_wins';
                    
                    const serverObj = { [doc.key]: doc.content };
                    const localObj = { [doc.key]: localVal };
                    const merged = performSmartMerge(serverObj, localObj, strategy);
                    localStorage.setItem(doc.key, JSON.stringify(merged[doc.key]));
                } else {
                    // Fallback for primitives OR no-merge keys (Direct Overwrite)
                    localStorage.setItem(doc.key, JSON.stringify(doc.content));
                }
                localStorage.setItem('sync_ts_' + doc.key, doc.updated_at);
            }
            
            if (keysToFetch.includes('system_config')) applySystemConfig();
            criticalSuccess = true; // Config loaded
        } else {
            criticalSuccess = true; // Nothing new, but we have local cache
        }

        // --- PRE-PROCESS: Load Pending Deletes to prevent Ghost Data ---
        const pendingQueue = JSON.parse(localStorage.getItem(PENDING_DEL_KEY) || '[]');
        const pendingIds = new Set(pendingQueue.filter(i => i.type === 'id').map(i => i.id));
        const tombstoneIds = new Set(JSON.parse(localStorage.getItem(TOMBSTONE_KEY) || '[]'));
        const pendingQueries = pendingQueue.filter(i => i.type === 'query');

        // --- PHASE B: ROW SYNC (Records, Submissions, Logs) ---
        // Only fetch rows newer than our last sync timestamp
        // OPTIMIZATION: Skip heavy logs in background sync to prevent freezing
        const heavyTables = ['error_reports', 'accessLogs', 'auditLogs', 'monitor_history'];

        for (const [localKey, tableName] of Object.entries(ROW_MAP)) {
            // Skip heavy tables unless it's a forced full sync (Optimization)
            if (silent && heavyTables.includes(tableName)) {
                continue;
            }

            const lastSync = localStorage.getItem(`row_sync_ts_${localKey}`) || '1970-01-01T00:00:00.000Z';
            
            // CLOCK SKEW FIX: Subtract 10 minutes from lastSync to catch items from clients with lagging clocks
            const safeSyncTime = new Date(new Date(lastSync).getTime() - 600000).toISOString();

            let query = window.supabaseClient.from(tableName).select('data, updated_at');
            
            const isAuthoritative = AUTHORITATIVE_TABLES.includes(tableName);
            const isFullAuthoritativePull = isAuthoritative && !silent;
            
            // If it's a silent background sync, ALWAYS treat it as a normal delta sync.
            // Authoritative full syncs should only be triggered by explicit UI actions (e.g., opening a tab via forceFullSync).
            if (isFullAuthoritativePull) {
                // This block will now rarely be hit by the main sync loop, only by direct calls.
                if (tableName === 'live_sessions') {
                    const yesterday = new Date(Date.now() - 86400000).toISOString();
                    query = query.gt('updated_at', yesterday);
                } else if (tableName === 'live_bookings') {
                    const cutoff = new Date();
                    cutoff.setDate(cutoff.getDate() - 30);
                    query = query.gt('data->>date', cutoff.toISOString().split('T')[0]);
                }
            } else {
                // DELTA SYNC: Only fetch rows updated since our safe clock-skew timestamp
                query = query.gt('updated_at', safeSyncTime);
            }
            
            // Limit batch size (Authoritative tables shouldn't be massive, but safety first)
            // For authoritative, we might need pagination if it grows, but for now 2000 is plenty for bookings.
            // OPTIMIZATION: Reduce limit for background syncs to avoid UI thread blocking
            const fetchLimit = silent ? 200 : 2000;
            const { data: newRows, error: rowErr } = await query.limit(fetchLimit);

            if (rowErr) {
                // ERROR HANDLING: Check if response was actually HTML (Cloudflare Error)
                // PostgREST client might wrap this, but usually it throws a syntax error on JSON parse.
                // If rowErr has no code but has a message, it might be a fetch failure.
                if (rowErr.message && (rowErr.message.includes('<!DOCTYPE') || rowErr.message.includes('521') || rowErr.message.includes('503'))) {
                    console.warn(`Sync Warning: Server returned HTML error (likely down). Skipping.`);
                } else
                // Gracefully handle missing table (404) to prevent sync crash
                if (rowErr.code === 'PGRST205' || rowErr.message.includes('Could not find the table')) {
                    console.warn(`Sync Warning: Table '${tableName}' does not exist on server. Skipping.`);
                } else {
                    console.warn(`Row sync failed for ${tableName}`, rowErr);
                }
            }
            
            if (newRows && newRows.length > 0) {
                if(!silent) console.log(`Downloaded ${newRows.length} rows for ${localKey} (${isFullAuthoritativePull ? 'Full' : 'Delta'})`);
                
                if (isFullAuthoritativePull) {
                    // AUTHORITATIVE SYNC: Server is Truth. Overwrite local.
                    const serverItems = newRows.map(r => r.data);
                    localStorage.setItem(localKey, JSON.stringify(serverItems));
                    // Update timestamp to now (though unused for full sync, good for debug)
                    localStorage.setItem(`row_sync_ts_${localKey}`, new Date().toISOString());
                } else {
                // Extract data objects
                // GHOST DATA FIX: Filter out items that are pending deletion locally
                const serverItems = newRows.filter(r => {
                    const id = r.data.id || r.id;
                    // 1. Check ID-based deletes
                    if (pendingIds.has(id)) return false; 
                    if (tombstoneIds.has(id)) return false; // Check Tombstones

                    // 2. Check Query-based deletes (e.g. "Delete all records for User X")
                    const isQueryDeleted = pendingQueries.some(q => {
                        if (q.table !== tableName) return false;
                        // Map DB column to Local Property (e.g. user_id -> user)
                        let localProp = q.col;
                        if (q.col === 'user_id') localProp = 'user';
                        if (q.col === 'trainee') localProp = 'trainee';
                        
                        const val = r.data[localProp] || r.data[q.col];
                        return val === q.val;
                    });
                    if (isQueryDeleted) return false;
                    return true;
                }).map(r => r.data);

                let localItems = JSON.parse(localStorage.getItem(localKey) || '[]');
                
                const hashMapKey = `hash_map_${localKey}`;
                const hashMap = JSON.parse(localStorage.getItem(hashMapKey) || '{}');
                
                // --- THE GHOST SLAYER (LOCAL PURGE) ---
                // Actively destroy items in the local cache that have been deleted globally,
                // preventing this device from resurrecting them during the next push.
                const revokedUsers = JSON.parse(localStorage.getItem('revokedUsers') || '[]');
                const revokedSet = new Set(revokedUsers.map(u => u.toLowerCase()));

                localItems = localItems.filter(item => {
                    const id = item.id;
                    // 1. Slain by Tombstone (Direct ID Match)
                    if (id && tombstoneIds.has(id.toString())) return false;
                    
                    // 2. Slain by Blacklist (Revoked Users Data Purge)
                    // Obliterates all records, attendance, and logs belonging to deleted users
                    const itemUser = item.trainee || item.user || item.user_id;
                    if (itemUser && revokedSet.has(itemUser.toLowerCase())) return false;

                    return true;
                });
                
                // --- THE LOCAL EDITS SHIELD ---
                // If an item has been edited locally but not yet pushed (hash mismatch),
                // we reject the server's version to prevent loadFromServer from reverting our active work.
                const safeServerItems = serverItems.filter(sItem => {
                    if (!sItem.id) return true;
                    const localMatch = localItems.find(l => l.id === sItem.id);
                    if (localMatch) {
                        const currentLocalHash = generateChecksum(JSON.stringify(localMatch));
                        const syncedHash = hashMap[localMatch.id];
                        if (syncedHash && currentLocalHash !== syncedHash) {
                            return false; // Reject server version, preserve local edits
                        }
                    }
                    return true;
                });

                // Merge using existing logic (Server Wins)
                const serverObj = { [localKey]: safeServerItems };
                const localObj = { [localKey]: localItems };
                const merged = performSmartMerge(serverObj, localObj, 'server_wins');
                
                // CRITICAL FIX: Aggressively prune logs to prevent quota errors
                if (localKey === 'monitor_history') {
                    const cutoff = new Date();
                    cutoff.setDate(cutoff.getDate() - 14); // Keep only last 14 days
                    merged[localKey] = merged[localKey].filter(h => new Date(h.date) > cutoff);
                } else if (localKey === 'accessLogs') {
                    const cutoff = new Date();
                    cutoff.setDate(cutoff.getDate() - 30); // Keep last 30 days
                    merged[localKey] = merged[localKey].filter(l => new Date(l.date) > cutoff);
                } else if (localKey === 'error_reports') {
                    const cutoff = new Date();
                    cutoff.setDate(cutoff.getDate() - 14); // Keep last 14 days
                    merged[localKey] = merged[localKey].filter(r => new Date(r.timestamp) > cutoff);
                } else if (localKey === 'liveSessions') {
                    // Prune old/stale sessions locally (older than 7 days)
                    const cutoff = new Date();
                    cutoff.setDate(cutoff.getDate() - 7);
                    merged[localKey] = merged[localKey].filter(s => {
                        const start = s.startTime || (s.sessionId ? parseInt(s.sessionId.split('_')[0]) : 0);
                        return start > cutoff.getTime();
                    });
                    
                    // FALLBACK RECOVERY: Update UI in case Realtime websocket dropped due to network errors
                    if (typeof processLiveSessionState === 'function') {
                        setTimeout(() => processLiveSessionState(merged[localKey]), 100);
                    }
                }

                localStorage.setItem(localKey, JSON.stringify(merged[localKey]));
                
                // Update Timestamp (Use the newest row's time)
                const newest = newRows.reduce((max, r) => new Date(r.updated_at) > new Date(max) ? r.updated_at : max, lastSync);
                localStorage.setItem(`row_sync_ts_${localKey}`, newest);
                
                // Update Hash Map for these items to prevent re-uploading what we just downloaded
                // For heavy logs, we skip the hash map entirely to save space.
                if (['monitor_history', 'accessLogs', 'error_reports'].includes(localKey)) {
                    localStorage.removeItem(hashMapKey);
                } else {
                    // Update Hash Map for all other tables
                    safeServerItems.forEach(item => {
                        if(item.id) hashMap[item.id] = generateChecksum(JSON.stringify(item));
                    });
                    localStorage.setItem(hashMapKey, JSON.stringify(hashMap));
                }
                }
            } else if (isFullAuthoritativePull && !rowErr) {
                // If authoritative and 0 rows returned, it means table is empty. Clear local.
                if(!silent) console.log(`Clearing ${localKey} (Server Empty)`);
                localStorage.setItem(localKey, '[]');
            }
        }

        // --- PHASE C: MONITOR STATE SYNC (Real-time Activity) ---
        // Fetch only recently active user states (Last 24 hours) to prevent payload bloat
        const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
        const { data: monRows, error: monErr } = await window.supabaseClient
            .from('monitor_state')
            .select('user_id, data')
            .gt('updated_at', oneDayAgo);
            
        if (monRows) {
            // Merge server state into local monitor_data
            const monData = JSON.parse(localStorage.getItem('monitor_data') || '{}');
            monRows.forEach(r => {
                // GHOST DATA FIX: Check if this user is pending deletion
                const isDeleted = pendingQueries.some(q => q.table === 'monitor_state' && q.col === 'user_id' && q.val === r.user_id);
                if (!isDeleted) {
                    monData[r.user_id] = r.data;
                }
            });
            
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
        return true; // Signal Success

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

let SERVER_LOOKOUT_INTERVAL = null;

// --- SERVER LOOKOUT (Dual-Aware Monitoring) ---
// Checks both Cloud and Local servers for a "Switch" command in system_config.
async function startServerLookout() {
    if (SERVER_LOOKOUT_INTERVAL) clearInterval(SERVER_LOOKOUT_INTERVAL);
    // Run every 30 seconds
    SERVER_LOOKOUT_INTERVAL = setInterval(async () => {
        // RECOVERY MODE LOCK: Do not automatically switch servers if we just auto-recovered.
        // The Admin must explicitly save configuration to clear this flag and attempt local again.
        if (sessionStorage.getItem('recovery_mode') === 'true') return;

        const localConfig = JSON.parse(localStorage.getItem('system_config') || '{}');
        const settings = localConfig.server_settings || { active: 'cloud' };

        // Define potential servers
        const servers = [
            { name: 'cloud', url: window.CLOUD_CREDENTIALS.url, key: window.CLOUD_CREDENTIALS.key },
            { name: 'local', url: settings.local_url, key: settings.local_key }
        ];

        for (const srv of servers) {
            const currentTarget = localStorage.getItem('active_server_target') || 'cloud';
            
            // SAFETY: If we are in Staging mode (Test), ignore remote switch commands
            if (currentTarget === 'staging') return;

            // Skip if local server is not configured
            if (srv.name === 'local' && (!srv.url || !srv.key)) continue;

            try {
                // Create temporary lightweight client
                const tempClient = window.supabase.createClient(srv.url, srv.key, {
                    auth: { 
                        persistSession: false, 
                        autoRefreshToken: false,
                        storageKey: 'lookout-' + srv.name + '-' + Date.now() // Unique key per check
                    }
                });

                // Fetch config
                const { data, error } = await tempClient
                    .from('app_documents')
                    .select('content, updated_at')
                    .eq('key', 'system_config')
                    .single();

                if (data && data.content && data.content.server_settings) {
                    const remoteActive = data.content.server_settings.active;
                    
                    // If a server tells us to switch, and we aren't already there
                    if (remoteActive && remoteActive !== currentTarget) {
                        
                        // NEW: Safety Check - If switching TO local, verify it is actually reachable
                        // This prevents infinite loops if Cloud says "Go Local" but Local is down.
                        if (remoteActive === 'local') {
                            const lUrl = settings.local_url;
                            const lKey = settings.local_key;
                            if (!lUrl || !lKey) continue;

                            try {
                                const checkClient = window.supabase.createClient(lUrl, lKey, {
                                    auth: { persistSession: false, autoRefreshToken: false, storageKey: 'ping-check-' + Date.now() }
                                });
                                const { error: pingErr } = await checkClient.from('app_documents').select('key').limit(1);
                                if (pingErr) throw pingErr;
                            } catch (pingEx) {
                                console.warn("Server Lookout: Command to switch to Local ignored because Local is unreachable.", pingEx);
                                continue; // Skip the switch
                            }
                        }

                        console.warn(`Server Switch Detected on ${srv.name}! Switching to ${remoteActive}...`);
                        
                        // Update Local Config to match
                        localStorage.setItem('system_config', JSON.stringify(data.content));
                        
                        if (typeof performSilentServerSwitch === 'function') {
                            performSilentServerSwitch(remoteActive);
                        } else {
                            localStorage.setItem('active_server_target', remoteActive);
                            alert(`System Update: Switching to ${remoteActive.toUpperCase()} Server.`);
                            location.reload();
                        }
                    }
                }
            } catch (e) { /* Ignore connection errors during lookout */ }
        }
    }, 30000);
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

    // 3. Start Server Lookout
    startServerLookout();
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

// --- NEW: DEDICATED FULL SYNC FUNCTION ---
// Performs a one-time, server-authoritative sync for a specific table.
async function forceFullSync(localKey) {
    if (!window.supabaseClient || !localKey) return false;

    const tableName = ROW_MAP[localKey];
    if (!tableName) {
        console.error(`forceFullSync: No table mapping found for key '${localKey}'`);
        return false;
    }

    console.log(`Performing authoritative full sync for '${localKey}'...`);

    try {
        // Fetch ALL rows for this table.
        const { data, error } = await window.supabaseClient.from(tableName).select('data').limit(5000); // High limit for full sync
        if (error) throw error;

        // Overwrite local storage completely.
        const serverItems = data.map(r => r.data);
        localStorage.setItem(localKey, JSON.stringify(serverItems));

        console.log(`Full sync for '${localKey}' complete. ${serverItems.length} items loaded.`);
        return true;
    } catch (e) {
        console.error(`Full sync for '${localKey}' failed:`, e);
        return false;
    }
}

// Export for Jest testing (Node.js environment)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        DB_SCHEMA,
        loadFromServer,
        saveToServer,
        performSmartMerge,
        hardDelete,
        hardDeleteByQuery
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
    } else if (status === 'processing_queue') {
        el.innerHTML = `<i class="fas fa-cogs fa-spin" style="color:var(--primary);"></i> Processing...`;
    }
}

// --- HELPER: LIGHTWEIGHT CHECKSUM ---
// Reduces hash_map size by 99% (Stores 8-char string instead of full JSON)
function generateChecksum(str) {
    let hash = 5381, i = str.length;
    while(i) hash = (hash * 33) ^ str.charCodeAt(--i);
    return (hash >>> 0).toString(16);
}

// 3. SAVE CONTROLLER (Public Function)
// Queues save operations and processes them after a debounce period for performance.
async function saveToServer(targetKeys = null, force = false, silent = false) {
    // Legacy support: if first arg is boolean, treat as force for ALL keys
    if (typeof targetKeys === 'boolean') {
        force = targetKeys;
        targetKeys = null; // Save all
    }

    const keysToQueue = targetKeys || Object.keys(DB_SCHEMA);
    keysToQueue.forEach(k => SAVE_QUEUE.add(k));

    if (!silent) updateSyncUI('pending');

    if (force) {
        if (SAVE_TIMEOUT) clearTimeout(SAVE_TIMEOUT);
        SAVE_TIMEOUT = null;
        // Await the actual processing when forced
        return await _processSaveQueue(force, silent);
    } else {
        if (SAVE_TIMEOUT) clearTimeout(SAVE_TIMEOUT);
        SAVE_TIMEOUT = setTimeout(() => _processSaveQueue(force, silent), SAVE_DEBOUNCE_MS);
        // Return optimistically for debounced saves
        return true;
    }
}

// 4. SAVE PROCESSOR (Internal Function)
// The original saveToServer logic, now processes the queue.
async function _processSaveQueue(force = false, silent = false, retryCount = 0) {
    try {
        // LOCKDOWN CHECK
        const config = JSON.parse(localStorage.getItem('system_config') || '{}');
        if (config.security && config.security.lockdown_mode && CURRENT_USER && CURRENT_USER.role !== 'super_admin') {
            console.warn("Save blocked by Lockdown Mode.");
            return;
        }

        // VERSION GATE: Prevent old clients from pushing bad data
        if (config.security && config.security.min_version && window.APP_VERSION) {
            const currentParts = window.APP_VERSION.split('.').map(Number);
            const minParts = config.security.min_version.split('.').map(Number);
            
            let isOutdated = false;
            for (let i = 0; i < Math.max(currentParts.length, minParts.length); i++) {
                const curr = currentParts[i] || 0;
                const min = minParts[i] || 0;
                if (curr < min) { isOutdated = true; break; }
                if (curr > min) { isOutdated = false; break; }
            }
            
            if (isOutdated) {
                console.error(`Save Blocked: Client Version ${window.APP_VERSION} is below minimum ${config.security.min_version}`);
                if(!silent) updateSyncUI('error'); // Show error state
                return;
            }
        }

        if (!window.supabaseClient) {
            console.warn("Supabase client not ready. Offline?");
            if(!silent) updateSyncUI('error');
            return;
        }

        const keysToSave = Array.from(SAVE_QUEUE);
        if (keysToSave.length === 0) return true; // Nothing to do
        SAVE_QUEUE.clear(); // Clear queue immediately
        if(!silent) updateSyncUI('busy');

        // 0. Process Deletes First (Ensure server is clean before we push)
        await processPendingDeletes();

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
                        // SAFETY: If force=true, ignore hash map and upload everything (Authoritative)
                        const lastHash = force ? null : hashMap[item.id];
                        
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
                        else if (['audit_logs', 'monitor_history', 'attendance', 'access_logs', 'nps_responses', 'archived_users', 'tl_task_submissions'].includes(tableName)) {
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

                    // BATCH UPLOAD: Prevent statement timeouts on large syncs
                    const BATCH_SIZE = 100; 
                    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                        const chunk = rows.slice(i, i + BATCH_SIZE);
                        if(!silent && rows.length > BATCH_SIZE) console.log(`Uploading chunk ${i / BATCH_SIZE + 1} of ${Math.ceil(rows.length / BATCH_SIZE)} to ${tableName}`);

                        try {
                            const { error } = await window.supabaseClient.from(tableName).upsert(chunk);
                            if (error) throw error;
                        } catch (e) {
                            // NETWORK/SERVER ERROR: Pause sync if server is vomiting HTML or 5xx
                            if (e.message && (e.message.includes('<!DOCTYPE') || e.message.includes('521') || e.message.includes('503'))) {
                                console.warn(`Save aborted: Server unavailable (${tableName}).`);
                                if(!silent) updateSyncUI('error');
                                return false; // Stop processing queue
                            }
                            // If table doesn't exist, warn and skip, don't crash the whole sync.
                            if (e.code === 'PGRST205' || (e.message && e.message.includes('does not exist'))) {
                                console.warn(`Save failed for '${key}' because table '${tableName}' does not exist. Skipping.`);
                                break; // Break out of the chunk loop for this table
                            } else throw e; // Re-throw other errors to be caught by the main try/catch
                        }
                    }
                    
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
                         await window.supabaseClient.from('monitor_state').upsert({
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
                    const { data: remoteRow } = await window.supabaseClient
                        .from('app_documents')
                        .select('content')
                        .eq('key', key)
                        .maybeSingle();
                    
                    if (remoteRow && remoteRow.content) {
                        const serverObj = { [key]: remoteRow.content };
                        const localObj = { [key]: localContent };
                        const mergedObj = performSmartMerge(serverObj, localObj, 'local_wins');
                        finalContent = mergedObj[key];
                    }
                }

                const { data: savedData, error: saveErr } = await window.supabaseClient
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
        return true;

    } catch (err) {
        // RETRY LOGIC: Try once more if it failed (Network blip)
        if (retryCount < 1) {
            console.warn("Sync failed, retrying...", err);
            return _processSaveQueue(force, silent, retryCount + 1);
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
        return false;
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

                    // 4. Strings & Tombstones - FIXES DUPLICATION
                    if ((key === 'vettingTopics' || key === 'monitor_whitelist' || key === 'monitor_reviewed' || key === 'system_tombstones') && typeof localItem === 'string' && typeof serverItem === 'string') {
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
                        if ((key === 'vettingTopics' || key === 'system_tombstones' || key === 'monitor_whitelist' || key === 'monitor_reviewed') && typeof localItem === 'string' && typeof i === 'string') return localItem.toLowerCase() === i.toLowerCase();
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
        const { data: activeUsers, error } = await window.supabaseClient
            .from('sessions')
            .select('*') // Fallback to * to avoid column name errors during migration
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
            activeUsers: activeUsers ? activeUsers.length : 0, // activeUsers is array of objects with username
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

                // Handle both 'username' (New) and 'user' (Old) for compatibility
                const uName = u.username || u.user || 'Unknown';

                html += `
                    <tr class="${rowClass}">
                        <td><strong>${uName}</strong></td>
                        <td style="font-size:0.8rem; color:var(--text-muted);">${verStr}</td>
                        <td>${roleStr}</td>
                        <td>${statusBadge}</td>
                        <td>${idleStr}</td>
                        <td>
                            <button class="btn-danger btn-sm" onclick="sendRemoteCommand('${uName}', 'logout')" title="Force Sign Out"><i class="fas fa-sign-out-alt"></i></button>
                            <button class="btn-warning btn-sm" onclick="sendRemoteCommand('${uName}', 'restart')" title="Remote Restart"><i class="fas fa-power-off"></i></button>
                            <button class="btn-primary btn-sm" onclick="sendRemoteCommand('${uName}', 'force_update')" title="Force Update Check"><i class="fas fa-cloud-download-alt"></i></button>
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
                username: CURRENT_USER.user, // New Schema
                role: CURRENT_USER.role,
                version: window.APP_VERSION || 'Unknown',
                idleTime: Math.round(diff),
                isIdle: isIdle,
                lastSeen: new Date().toISOString(),
                clientId: clientId,
                activity: safeActivity
            };
            
            const { error } = await window.supabaseClient.from('sessions').upsert(fullPayload);
            if (!error) return; // Success
            
            // NETWORK ERROR CHECK: Do not downgrade if it's just a timeout or server overload
            const msg = error.message || '';
            if (msg.includes('fetch') || error.code === '503' || msg.includes('timeout') || error.code === 'PGRST002') return;

            console.warn("Heartbeat Full failed (Schema mismatch?). Downgrading to Safe Mode.");
            HEARTBEAT_SAFE_MODE = 'safe';
        }

        // 2. Safe Mode (Common fields only)
        if (HEARTBEAT_SAFE_MODE === 'safe') {
            const { error } = await window.supabaseClient.from('sessions').upsert({
                username: CURRENT_USER.user, // New Schema
                lastSeen: new Date().toISOString(),
                isIdle: isIdle,
                idleTime: Math.round(diff)
            });
            if (!error) return;
            
            // NETWORK ERROR CHECK
            const msg = error.message || '';
            if (msg.includes('fetch') || error.code === '503' || msg.includes('timeout') || error.code === 'PGRST002') return;

            console.warn("Heartbeat Safe failed. Downgrading to Minimal.");
            HEARTBEAT_SAFE_MODE = 'minimal';
        }

        // 3. Minimal Mode (Absolute basics)
        if (HEARTBEAT_SAFE_MODE === 'minimal') {
            await window.supabaseClient.from('sessions').upsert({
                username: CURRENT_USER.user, // New Schema
                lastSeen: new Date().toISOString()
            });
        }
            
        // 2. Check for Remote Commands (Pending Actions)
        const { data: sessionData } = await supabaseClient
            .from('sessions') // supabaseClient is likely defined in scope here if not window., but consistent use is better.
            .select('pending_action')
            .eq('username', CURRENT_USER.user) // New Schema
            .single();
            
        if (sessionData && sessionData.pending_action) {
            // Clear command first to prevent loops
            await window.supabaseClient.from('sessions').update({ pending_action: null }).eq('username', CURRENT_USER.user);
            
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
            } else if (sessionData.pending_action === 'fix_submission') {
                // Silently clear blockages and force submit current draft
                let s = JSON.parse(localStorage.getItem('submissions') || '[]');
                s.forEach(x => x.archived = true);
                localStorage.setItem('submissions', JSON.stringify(s));
                
                if(typeof restoreAssessmentDraft === 'function') restoreAssessmentDraft();
                setTimeout(() => { if(typeof submitTest === 'function') submitTest(true); }, 1000);
                if(typeof showToast === 'function') showToast("System Auto-Recovery: Draft submitted.", "success");
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
    const rawRates = config.sync_rates || {};
    const activeTarget = localStorage.getItem('active_server_target') || 'cloud';
    
    let rates;
    if (typeof rawRates.admin !== 'undefined') {
        rates = rawRates; // Legacy single-tier mode fallback
    } else if (rawRates[activeTarget]) {
        rates = rawRates[activeTarget]; // Per-server mode
    } else {
        rates = { admin: 4000, teamleader: 60000, trainee: 15000 };
    }
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

    // Start the Incoming Queue Processor (Checks every 2 seconds)
    startQueueProcessor();

    console.log(`Starting Sync Engine. Sync: ${syncRate/1000}s, Heartbeat: ${beatRate/1000}s`);
    
    // 1. DATA SYNC: Poll every 60 Seconds (High Performance / Cohort Safe)
    // Uses "loadFromServer" to pull changes from others (e.g. Trainees to Admin)
    SYNC_INTERVAL = setInterval(async () => {
        await loadFromServer(true); 
        
        // AUTOMATED MAINTENANCE (Daily Orphan Cleanup)
        if (typeof performOrphanCleanup === 'function') {
            const lastRun = parseInt(localStorage.getItem('last_orphan_cleanup_ts') || '0');
            if (Date.now() - lastRun > 86400000) { // 24 hours
                performOrphanCleanup(true);
            }
        }
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
    
    // 3. GLOBAL REALTIME SUBSCRIPTIONS (Push Architecture)
    setupRealtimeListeners();
    
    console.log("Real-time sync & heartbeat engine started (High Performance Mode).");
}

// --- REALTIME LISTENERS (The Fix for Live Updates) ---
function setupRealtimeListeners() {
    if (!window.supabaseClient) return;

    // Subscribe to critical tables
    const channel = window.supabaseClient.channel('global_app_changes')
        // 1. MONITOR STATE (Activity Monitor)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'monitor_state' }, (payload) => {
            handleMonitorRealtime(payload);
        })
        // 2. ATTENDANCE (Register)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, (payload) => {
            handleAttendanceRealtime(payload);
        })
        // 3. SESSIONS (Active Users)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, (payload) => {
            // Debounce dashboard update to prevent flickering on every heartbeat
            if (window.DASH_UPDATE_TIMEOUT) clearTimeout(window.DASH_UPDATE_TIMEOUT);
            window.DASH_UPDATE_TIMEOUT = setTimeout(() => {
                if (typeof updateDashboardHealth === 'function') updateDashboardHealth();
            }, 1000);
        })
        // 4. LIVE BOOKINGS (Schedule Updates)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'live_bookings' }, (payload) => {
            handleLiveBookingRealtime(payload);
        })
        // 5. LIVE SESSIONS (Instant Dashboard Alert)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'live_sessions' }, (payload) => {
            handleLiveSessionRealtime(payload);
        })
        // 6. VETTING SESSIONS
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vetting_sessions' }, (payload) => {
            handleVettingRealtime(payload);
        })
        .subscribe();
}

// --- NEW: QUEUE INDICATOR ---
function updateQueueIndicator() {
    const el = document.getElementById('sync-indicator'); // This is the footer indicator
    if (!el) return;

    if (INCOMING_DATA_QUEUE.length > 0) {
        el.style.transition = 'none';
        el.style.opacity = '1';
        el.innerHTML = `<i class="fas fa-inbox" style="color:#3498db;"></i> Queued: ${INCOMING_DATA_QUEUE.length}`;
    } else {
        // If queue is empty, and we are not in another permanent state like 'error', show success.
        const isError = el.innerHTML.includes('Offline') || el.innerHTML.includes('Sync Failed');
        if (!isError) updateSyncUI('success');
    }
}

// --- NEW: QUEUE PROCESSOR ---
function startQueueProcessor() {
    if (QUEUE_PROCESSOR_INTERVAL) clearInterval(QUEUE_PROCESSOR_INTERVAL);
    // Run frequently (2s) to keep data fresh, but gives a buffer window
    QUEUE_PROCESSOR_INTERVAL = setInterval(processIncomingDataQueue, 2000);
}

function processIncomingDataQueue() {
    if (INCOMING_DATA_QUEUE.length === 0) {
        const el = document.getElementById('sync-indicator');
        if (el && (el.innerHTML.includes('Queued:') || el.innerHTML.includes('Processing'))) {
            updateSyncUI('success');
        }
        return;
    }

    // PROTECTION: Don't update if user is actively interacting/typing.
    // OVERRIDE: If user hasn't interacted for 30s, assume they left focus by accident and process anyway.
    // HIGH-PRIORITY OVERRIDE: If the user is in the Vetting or Live Arena, process immediately to prevent interaction lag.
    const isLiveArenaActive = document.getElementById('live-execution')?.classList.contains('active');
    const isVettingArenaActive = document.getElementById('vetting-arena')?.classList.contains('active');
    const isLiveBookingActive = document.getElementById('live-assessment')?.classList.contains('active');

    // CHECK FOR CRITICAL INTERRUPT EVENTS (Live Assessment / Vetting Start)
    // If true, bypasses the typing protection to instantly alert the agent.
    const hasCriticalEvent = INCOMING_DATA_QUEUE.some(item => {
        if ((item.type === 'sessions' || item.type === 'vetting') && item.payload && item.payload.new && item.payload.new.data) {
            const data = item.payload.new.data;
            if (item.type === 'sessions' && data.trainee === CURRENT_USER?.user && data.active) return true;
            if (item.type === 'vetting' && data.active) {
                const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
                if (!data.targetGroup || data.targetGroup === 'all') return true;
                const members = rosters[data.targetGroup] || [];
                if (members.some(m => m.toLowerCase() === CURRENT_USER?.user?.toLowerCase())) return true;
            }
        }
        return false;
    });

    const timeSinceInteraction = Date.now() - (window.LAST_INTERACTION || 0);
    if (!hasCriticalEvent && isUserTyping() && timeSinceInteraction < 30000 && !isLiveArenaActive && !isVettingArenaActive && !isLiveBookingActive) {
        return;
    }

    // Take snapshot of current queue and clear global
    const queue = [...INCOMING_DATA_QUEUE];
    INCOMING_DATA_QUEUE = []; 

    // Show processing status
    const el = document.getElementById('sync-indicator');
    if (el) {
        el.innerHTML = `<i class="fas fa-cogs fa-spin" style="color:var(--primary);"></i> Processing: ${queue.length}`;
    }

    // Batch updates by type to prevent multiple writes/renders
    const batches = {
        monitor: [],
        attendance: [],
        bookings: [],
        sessions: [],
        vetting: []
    };

    queue.forEach(item => {
        if (batches[item.type]) batches[item.type].push(item.payload);
    });

    // 1. Process Monitor
    if (batches.monitor.length > 0) {
        let data = JSON.parse(localStorage.getItem('monitor_data') || '{}');
        batches.monitor.forEach(p => {
            if (p.eventType === 'DELETE') {
                if (p.old && p.old.user_id) delete data[p.old.user_id];
            } else {
                if (p.new && p.new.data !== undefined && p.new.user_id) data[p.new.user_id] = p.new.data;
            }
        });
        localStorage.setItem('monitor_data', JSON.stringify(data));
        if (typeof StudyMonitor !== 'undefined' && typeof StudyMonitor.updateWidget === 'function') {
            StudyMonitor.updateWidget();
        }
    }

    // 2. Process Attendance
    if (batches.attendance.length > 0) {
        let records = JSON.parse(localStorage.getItem('attendance_records') || '[]');
        batches.attendance.forEach(p => {
            if (p.eventType === 'DELETE') {
                records = records.filter(r => r.id !== p.old.id);
            } else {
                const newRow = p.new;
                if (!newRow.data) return; // Ignore Postgres WAL partial updates

                const item = newRow.data;
                item.id = newRow.id;
                item.user = newRow.user_id;
                const idx = records.findIndex(r => r.id === item.id);
                if (idx > -1) records[idx] = item;
                else records.push(item);
            }
        });
        localStorage.setItem('attendance_records', JSON.stringify(records));
        if (typeof updateAttendanceUI === 'function') updateAttendanceUI();
    }

    // 3. Process Bookings
    if (batches.bookings.length > 0) {
        let bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
        batches.bookings.forEach(p => {
            if (p.eventType === 'DELETE') {
                bookings = bookings.filter(b => b.id !== p.old.id);
            } else {
                const newRow = p.new;
                if (!newRow.data) return; // Ignore Postgres WAL partial updates

                const item = newRow.data;
                item.id = newRow.id;
                const idx = bookings.findIndex(b => b.id === item.id);
                if (idx > -1) bookings[idx] = item;
                else bookings.push(item);
            }
        });
        localStorage.setItem('liveBookings', JSON.stringify(bookings));
        if (typeof renderLiveTable === 'function') renderLiveTable();
        if (typeof updateNotifications === 'function') updateNotifications();
    }

    // 4. Process Sessions (Dashboard Banner Only)
    if (batches.sessions.length > 0) {
        let allSessions = JSON.parse(localStorage.getItem('liveSessions') || '[]');
        batches.sessions.forEach(p => {
            if (p.eventType === 'DELETE') {
                allSessions = allSessions.filter(s => s.sessionId !== p.old.id);
            } else {
                if (!p.new.data) return; // Ignore Postgres WAL partial updates
                const newData = p.new.data;
                if (newData) {
                    if (!newData.sessionId) newData.sessionId = p.new.id;
                    allSessions = allSessions.filter(s => s.sessionId !== newData.sessionId);
                    allSessions.push(newData);
                }
            }
        });
        localStorage.setItem('liveSessions', JSON.stringify(allSessions));
        
        // Update Live Execution UI instantly if open
        if (typeof processLiveSessionState === 'function') processLiveSessionState(allSessions);

        // SOFT UPDATE: Only update the banner, do NOT re-render the whole dashboard
        const dashView = document.getElementById('dashboard-view');
        if (dashView && dashView.classList.contains('active') && typeof updateLiveBannerUI === 'function') {
            updateLiveBannerUI();
        }
    }

    // 5. Process Vetting
    if (batches.vetting.length > 0) {
        let sessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
        batches.vetting.forEach(p => {
            if (p.eventType === 'DELETE') {
                sessions = sessions.filter(s => s.sessionId !== p.old.id);
                const local = JSON.parse(localStorage.getItem('vettingSession') || '{}');
                if (local.sessionId === p.old.id && typeof handleVettingUpdate === 'function') {
                    handleVettingUpdate({ active: false });
                }
            } else {
                const newData = p.new.data;
                if (!newData) return;
                const idx = sessions.findIndex(s => s.sessionId === newData.sessionId);
                if (newData.active) {
                    if (idx > -1) sessions[idx] = newData;
                    else sessions.push(newData);
                } else {
                    sessions = sessions.filter(s => s.sessionId !== newData.sessionId);
                }
                if (typeof checkAndHandleSession === 'function') checkAndHandleSession(newData);
            }
        });
        localStorage.setItem('adminVettingSessions', JSON.stringify(sessions));
        
        const activeTab = document.querySelector('section.active');
        if (activeTab && activeTab.id === 'vetting-arena' && typeof renderAdminArena === 'function') {
            renderAdminArena(); // Refresh Admin UI
        }
    }

    // After processing, update the indicator with the current queue state.
    updateQueueIndicator();
}

// --- UPDATED HANDLERS: PUSH TO QUEUE INSTEAD OF PROCESS ---
function handleMonitorRealtime(payload) {
    INCOMING_DATA_QUEUE.push({ type: 'monitor', payload });
    updateQueueIndicator();
}

function handleAttendanceRealtime(payload) {
    INCOMING_DATA_QUEUE.push({ type: 'attendance', payload });
    updateQueueIndicator();
}

function handleLiveBookingRealtime(payload) {
    INCOMING_DATA_QUEUE.push({ type: 'bookings', payload });
    updateQueueIndicator();
}

function handleLiveSessionRealtime(payload) {
    INCOMING_DATA_QUEUE.push({ type: 'sessions', payload });
    updateQueueIndicator();
}

function handleVettingRealtime(payload) {
    INCOMING_DATA_QUEUE.push({ type: 'vetting', payload });
    updateQueueIndicator();
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
                .neq('username', 'placeholder_to_delete_all'); // Delete all rows

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

/* ================= DATA & SYNC ================= */
const DB_SCHEMA = {
    monitor_data: {}, // Real-time activity tracking { username: { current, history: [] } }
    monitor_history: [], // Archived daily activity logs
    nps_surveys: [], // Admin defined surveys
    nps_responses: [], // Trainee responses
    graduated_agents: [], // Archived data for graduated trainees
    retrain_archives: [], // Archived data snapshots for trainees moved to retraining groups
    trainee_notes: {}, // Unified syncable notepad { "username": "text" }
    trainee_bookmarks: {}, // Unified syncable bookmarks { "username": [ { id, url... } ] }
    monitor_whitelist: [], // Custom whitelist for work-related apps
    monitor_reviewed: [], // Apps confirmed as External/Idle (Dismissed from queue)
    dailyTips: [], // Admin controlled daily tips
    calendarEvents: [], // Custom Admin Events
    error_reports: [] // Centralized error logging for Super Admin
};

// --- HYBRID SYNC CONFIGURATION ---
// Maps local keys to Supabase Tables for Row-Level Sync
const ROW_MAP = {
    'users': 'users',
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

// --- DEMO SANDBOX BUBBLE ---
let IS_DEMO_MODE = localStorage.getItem('DEMO_MODE') === 'true';

// --- ORPHAN SANDBOX DETECTION (APP CLOSE LEAK FIX) ---
// If the app was closed during a demo, the session dies. We detect this on boot.
const isDemoSessionActive = typeof sessionStorage !== 'undefined' && !!sessionStorage.getItem('currentUser');
if (!isDemoSessionActive && IS_DEMO_MODE) {
    console.warn("⚠️ Detected orphaned Sandbox data from a closed session. Wiping database to protect production.");
    localStorage.clear();
    IS_DEMO_MODE = false;
}

if (IS_DEMO_MODE) {
    Object.keys(ROW_MAP).forEach(k => delete ROW_MAP[k]); // Force ALL data into isolated blobs
}

// --- SERVER AUTHORITY CONFIGURATION ---
// Tables that must always reflect the exact state of the server (No Merging, Full Overwrite).
// This fixes "Ghost Data" and synchronization lag for critical shared resources.
const AUTHORITATIVE_TABLES = [
    'users',
    'live_sessions',
    'live_bookings',
    'tl_task_submissions',
    'link_requests',
    'calendar_events'
];

// --- STRICT SERVER AUTHORITY (Shared Data) ---
// These keys represent shared/global state. Background autosaves must never push them
// unless the save was an explicit action (targeted key save) or force=true.
const STRICT_SERVER_BLOB_KEYS = new Set([
    'rosters',
    'tests',
    'schedules',
    'liveSchedules',
    'assessments'
]);

const STRICT_SERVER_ROW_KEYS = new Set([
    'users',
    'liveBookings',
    'liveSessions'
]);

const STRICT_SERVER_KEYS = new Set([
    ...Array.from(STRICT_SERVER_BLOB_KEYS),
    ...Array.from(STRICT_SERVER_ROW_KEYS)
]);

// --- NEW: DEBOUNCED SAVE QUEUE (PERFORMANCE) ---
// This prevents the UI from freezing on large data saves by queueing the save
// and processing it a few seconds later in the background.
let SAVE_QUEUE = new Set();
const EXPLICIT_SAVE_KEYS = new Set();
let SAVE_TIMEOUT = null;
window._SAVE_QUEUE_NOT_SILENT = false;
const SAVE_DEBOUNCE_MS = 500; // 500ms (High-Speed Server Authority)

// --- NEW: INCOMING DATA QUEUE (STABILITY) ---
let INCOMING_DATA_QUEUE = [];
let QUEUE_PROCESSOR_INTERVAL = null;
let IS_PROCESSING_INCOMING_QUEUE = false;
const INCOMING_QUEUE_BATCH_SIZE = 120;
const INCOMING_QUEUE_CONTINUE_DELAY_MS = 120;
window.ACTIVE_USERS_CACHE = {}; // Realtime Presence Cache

window.GLOBAL_CHANGES_CHANNEL = null;
window.REALTIME_RECONNECT_TIMER = null;
window.CURRENT_FALLBACK_RATE = 600000;
window.NORMAL_FALLBACK_RATE = 0;
window.REALTIME_FAILURE_RATE = 30000;
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
    // Returns true if user is in an Input, Textarea, Select box, OR Rich Text Editor
    return (tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable);
}

// Safe localStorage JSON parse helper to avoid exceptions when value is invalid
function safeLocalParse(key, fallback = null) {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null || raw === undefined || raw === 'undefined') return fallback;
        return JSON.parse(raw);
    } catch (e) {
        console.warn(`safeLocalParse: failed parsing localStorage['${key}']`);
        return fallback;
    }
}

// Generic safe JSON parse for arbitrary strings (FileReader results, sessionStorage, etc.)
function safeParse(raw, fallback = null) {
    try {
        if (raw === null || raw === undefined || raw === 'undefined') return fallback;
        return JSON.parse(raw);
    } catch (e) {
        return fallback;
    }
}

// --- HARD DELETE PROTOCOL (Ghost Data Fix) ---
const PENDING_DEL_KEY = 'system_pending_deletes';
const TOMBSTONE_KEY = 'system_tombstones'; // New: Persistent Blacklist for Deleted IDs

// Queues a delete operation and attempts to execute it immediately
async function hardDelete(tableName, id) {
    if (!tableName || !id) return;
    
    // 1. Queue it (Persistence)
    const queue = safeLocalParse(PENDING_DEL_KEY, []);
    // Avoid duplicates
    if (!queue.some(i => i.type === 'id' && i.table === tableName && i.id === id)) {
        queue.push({ type: 'id', table: tableName, id: id, ts: Date.now() });
        localStorage.setItem(PENDING_DEL_KEY, JSON.stringify(queue));
    }

    // 1.5 Add to Tombstones (Local Blacklist) to prevent immediate reappearance
    const tombstones = safeLocalParse(TOMBSTONE_KEY, []);
    if (!tombstones.includes(id)) {
        tombstones.push(id);
        localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(tombstones));
        // FIX: Sync the tombstone list so other clients know about the deletion.
        // Use a silent, non-forced save to run in the background.
        if (typeof saveToServer === 'function') {
            saveToServer(['system_tombstones'], true); // Authoritative push for instant soft-delete propagation
        }
    }

    // 2. Try to execute
    return await processPendingDeletes();
}

// Queues a bulk delete by query (e.g. delete all records for user X)
async function hardDeleteByQuery(tableName, column, value) {
    if (!tableName || !column || !value) return;

    const queue = safeLocalParse(PENDING_DEL_KEY, []);
    queue.push({ type: 'query', table: tableName, col: column, val: value, ts: Date.now() });
    localStorage.setItem(PENDING_DEL_KEY, JSON.stringify(queue));

    return await processPendingDeletes();
}

// Flushes the delete queue to Supabase
async function processPendingDeletes() {
    if (!window.supabaseClient) return;
    
    const queue = safeLocalParse(PENDING_DEL_KEY, []);
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
        // 3. Immediately attempt to re-establish the Realtime Tunnel
        if (typeof setupRealtimeListeners === 'function') setupRealtimeListeners();
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

        const pullStartedAt = Date.now();
        let pullProgressDone = 0;
        let pullProgressTotal = 1; // metadata
        let pullBytesDone = 0;
        let pullBytesTotal = 0;
        updateSyncDiagnostics({
            status: 'syncing',
            statusText: 'Syncing from server',
            direction: 'download',
            phase: 'Reading server metadata',
            item: 'app_documents',
            server: getActiveSyncServerLabel(),
            progressDone: pullProgressDone,
            progressTotal: pullProgressTotal,
            bytesDone: pullBytesDone,
            bytesTotal: pullBytesTotal,
            startedAt: pullStartedAt
        });

        // 0. Process Deletes First (Ensure server is clean before we pull)
        await processPendingDeletes();

        let criticalSuccess = false;

        const start = Date.now();
        
        // --- IDENTIFY TRAINEE EARLY ---
        const isTrainee = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.role === 'trainee');
        if (isTrainee) {
            localStorage.removeItem('agentNotes'); // Security & Memory Purge
            localStorage.removeItem('tl_personal_lists');
        }
        
        // --- PHASE A: BLOB SYNC (Settings, Rosters, Users) ---
        let metaQuery = window.supabaseClient.from('app_documents').select('key, updated_at');
        if (IS_DEMO_MODE) metaQuery = metaQuery.like('key', 'demo_%');
        else metaQuery = metaQuery.not('key', 'like', 'demo_%');
        
        const { data: meta, error } = await metaQuery;
        window.CURRENT_LATENCY = Date.now() - start; // Measure RTT
        
        if (error) throw error;

        const metaBytes = estimateSyncPayloadSize(meta);
        pullProgressDone = 1;
        pullBytesDone += metaBytes;
        pullBytesTotal += metaBytes;
        updateSyncDiagnostics({
            phase: 'Metadata received',
            item: `Keys: ${Array.isArray(meta) ? meta.length : 0}`,
            progressDone: pullProgressDone,
            progressTotal: pullProgressTotal,
            bytesDone: pullBytesDone,
            bytesTotal: pullBytesTotal
        });

        // Identify Stale Blobs
        const keysToFetch = [];
        meta.forEach(row => {
            const localKey = IS_DEMO_MODE ? row.key.replace('demo_', '') : row.key;
            // SECURITY & MINIMIZATION: Skip admin-only blobs for trainees
            if (isTrainee && ['agentNotes', 'tl_personal_lists'].includes(localKey)) return;
            // Legacy compatibility guard:
            // if a key is row-synced, ignore blob documents with the same key.
            // This prevents stale app_documents rows from duplicating row-level tables (notably `users`).
            if (ROW_MAP[localKey]) return;
            
            const localTs = localStorage.getItem('sync_ts_' + localKey);
            const isStrictServerBlob = STRICT_SERVER_BLOB_KEYS.has(localKey);
            // If we don't have it, or server is newer, fetch it
            // Shared/global keys are always fetched from server to enforce server truth.
            if (isStrictServerBlob || !localTs || new Date(row.updated_at) > new Date(localTs)) {
                keysToFetch.push(row.key);
            }
        });

        // Fetch Stale Blobs
        pullProgressTotal += keysToFetch.length;
        updateSyncDiagnostics({
            phase: keysToFetch.length > 0 ? 'Downloading document keys' : 'No blob changes',
            item: keysToFetch.length > 0 ? keysToFetch.join(', ') : 'No stale blob docs',
            progressDone: pullProgressDone,
            progressTotal: pullProgressTotal,
            bytesDone: pullBytesDone,
            bytesTotal: pullBytesTotal
        });

        if (keysToFetch.length > 0) {
            if(!silent) console.log(`Syncing updates for: ${keysToFetch.join(', ')}`);
            
            const { data: docs, error: fetchErr } = await window.supabaseClient
                .from('app_documents')
                .select('key, content, updated_at')
                .in('key', keysToFetch);
            
            if (fetchErr) throw fetchErr;

            for (const doc of docs) {
                const localKey = IS_DEMO_MODE ? doc.key.replace('demo_', '') : doc.key;
                // SMART PULL: Always try to merge JSON data to prevent overwriting local unsaved drafts
                // We use 'server_wins' strategy here: If an item exists in both, Server version is the truth.
                const localVal = safeLocalParse(localKey, null);
                
                // FIX: For specific Admin keys (Rosters, Schedules, Tests), do NOT merge. 
                // Merging restores deleted items if the server hasn't updated yet or if we are out of sync.
                // We trust the Server's snapshot if it is newer, or our local overwrite if we just saved.
                const noMergeKeys = ['rosters', 'schedules', 'tests', 'vettingTopics', 'liveSchedules', 'assessments'];
                
                if (localVal && (Array.isArray(localVal) || typeof localVal === 'object') && !noMergeKeys.includes(localKey)) {
                    let strategy = 'server_wins';
                    
                    const serverObj = { [localKey]: doc.content };
                    const localObj = { [localKey]: localVal };
                    const merged = performSmartMerge(serverObj, localObj, strategy);
                    localStorage.setItem(localKey, JSON.stringify(merged[localKey]));
                } else {
                    // Fallback for primitives OR no-merge keys (Direct Overwrite)
                    // Ensure we never store the string "undefined" (causes JSON.parse failures)
                    const serialized = (typeof doc.content === 'undefined') ? JSON.stringify(null) : JSON.stringify(doc.content);
                    localStorage.setItem(localKey, serialized);
                }
                localStorage.setItem('sync_ts_' + localKey, doc.updated_at);
                emitDataChange(localKey, 'load_from_server');

                const docBytes = estimateSyncPayloadSize(doc.content);
                pullProgressDone += 1;
                pullBytesDone += docBytes;
                pullBytesTotal += docBytes;
                updateSyncDiagnostics({
                    phase: 'Downloading documents',
                    item: localKey,
                    progressDone: pullProgressDone,
                    progressTotal: pullProgressTotal,
                    bytesDone: pullBytesDone,
                    bytesTotal: pullBytesTotal
                });
            }
            
            const configKey = IS_DEMO_MODE ? 'demo_system_config' : 'system_config';
            if (keysToFetch.includes(configKey)) applySystemConfig();
            criticalSuccess = true; // Config loaded
        } else {
            criticalSuccess = true; // Nothing new, but we have local cache
        }

        // --- PRE-PROCESS: Load Pending Deletes to prevent Ghost Data ---
        const pendingQueue = safeLocalParse(PENDING_DEL_KEY, []);
        const pendingIds = new Set(pendingQueue.filter(i => i.type === 'id').map(i => i.id));
        const tombstoneIds = new Set(safeLocalParse(TOMBSTONE_KEY, []));
        const pendingQueries = pendingQueue.filter(i => i.type === 'query');
        let revokedUsers = safeLocalParse('revokedUsers', []);
        const currentUsers = safeLocalParse('users', []);
        const activeUserTokens = new Set(
            (Array.isArray(currentUsers) ? currentUsers : [])
                .map(u => normalizeIdentityValue((u && (u.user || u.username)) || ''))
                .filter(Boolean)
        );
        const cleanRevoked = [];
        const seenRevoked = new Set();
        (Array.isArray(revokedUsers) ? revokedUsers : []).forEach(entry => {
            const raw = String(entry || '').trim();
            const token = normalizeIdentityValue(raw);
            if (!token || seenRevoked.has(token) || activeUserTokens.has(token)) return;
            seenRevoked.add(token);
            cleanRevoked.push(raw);
        });
        if (JSON.stringify(cleanRevoked) !== JSON.stringify(Array.isArray(revokedUsers) ? revokedUsers : [])) {
            localStorage.setItem('revokedUsers', JSON.stringify(cleanRevoked));
        }
        revokedUsers = cleanRevoked;
        const revokedSet = new Set(revokedUsers.map(u => normalizeIdentityValue(u)));

        // --- PHASE B: ROW SYNC (Records, Submissions, Logs) ---
        // Only fetch rows newer than our last sync timestamp
        // OPTIMIZATION: Use accurate table names and isolate heavy JSON payloads to prevent V8 memory crashes
        const heavyTables = ['error_reports', 'access_logs', 'audit_logs', 'monitor_history', 'network_diagnostics'];

        const fastTasks = [];
        const heavyTasks = [];
        let plannedRowTables = 0;
        let completedRowTables = 0;

        Object.entries(ROW_MAP).forEach(([localKey, tableName]) => {
            
            // TRAINEE DATA MINIMIZATION: Completely skip Admin-only tables to save bandwidth
            if (isTrainee && ['audit_logs', 'access_logs', 'error_reports', 'nps_responses', 'archived_users', 'network_diagnostics', 'saved_reports', 'insight_reviews', 'tl_task_submissions'].includes(tableName)) {
                return;
            }

            // Skip heavy tables unless it's a forced full sync (Optimization)
            if (silent && heavyTables.includes(tableName)) {
                return;
            }

            plannedRowTables += 1;
            pullProgressTotal += 1;

            const syncTask = async () => {
                updateSyncDiagnostics({
                    phase: 'Syncing row tables',
                    item: `${localKey} (${tableName})`,
                    progressDone: pullProgressDone + completedRowTables,
                    progressTotal: pullProgressTotal,
                    bytesDone: pullBytesDone,
                    bytesTotal: pullBytesTotal
                });

                const lastSync = localStorage.getItem(`row_sync_ts_${localKey}`) || '1970-01-01T00:00:00.000Z';
            
            // CLOCK SKEW FIX: Subtract 10 minutes from lastSync to catch items from clients with lagging clocks
            const safeSyncTime = new Date(new Date(lastSync).getTime() - 600000).toISOString();

            let query = window.supabaseClient.from(tableName).select('id, data, updated_at');
            
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
                // CRITICAL FIX: Must order by updated_at ascending so we don't truncate random rows when hitting the limit!
                query = query.gt('updated_at', safeSyncTime).order('updated_at', { ascending: true });
            }
            
            // TRAINEE DATA MINIMIZATION: Only query my own rows for massive tables
            if (isTrainee) {
                if (['records', 'submissions', 'exemptions', 'link_requests'].includes(tableName)) {
                    query = query.ilike('trainee', CURRENT_USER.user);
                } else if (['attendance', 'monitor_history'].includes(tableName)) {
                    query = query.ilike('user_id', CURRENT_USER.user);
                }
            }
            
                // ARCHITECTURAL FIX: Throttle row limits for heavy JSON tables to prevent OOM crashes
                const fetchLimit = tableName === 'monitor_history' ? 100 : (heavyTables.includes(tableName) ? 500 : 2000);
                const { data: newRows, error: rowErr } = await query.limit(fetchLimit);
                const rowBytes = estimateSyncPayloadSize((newRows || []).map(r => r && r.data ? r.data : null));
                if (rowBytes > 0) {
                    pullBytesDone += rowBytes;
                    pullBytesTotal += rowBytes;
                }

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
                    const serverItems = newRows
                        .filter(r => r && r.data)
                        .map(r => {
                            const item = (r.data && typeof r.data === 'object') ? { ...r.data } : r.data;
                            if (item && typeof item === 'object' && (item.id === undefined || item.id === null) && r.id !== undefined && r.id !== null) {
                                item.id = r.id;
                            }
                            return item;
                        });
                    localStorage.setItem(localKey, JSON.stringify(serverItems));
                    // Update timestamp to now (though unused for full sync, good for debug)
                    localStorage.setItem(`row_sync_ts_${localKey}`, new Date().toISOString());
                } else {
                // Extract data objects
                // GHOST DATA FIX: Filter out items that are pending deletion locally
                const serverItems = newRows.filter(r => {
                    if (!r || !r.data) return false;
                    const rowData = r.data;
                    const id = rowData.id || r.id;
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
                        
                        const val = rowData[localProp] || rowData[q.col];
                        return val === q.val;
                    });
                    if (isQueryDeleted) return false;
                    return true;
                }).map(r => {
                    const item = (r.data && typeof r.data === 'object') ? { ...r.data } : r.data;
                    if (item && typeof item === 'object' && (item.id === undefined || item.id === null) && r.id !== undefined && r.id !== null) {
                        item.id = r.id;
                    }
                    return item;
                });

                let localItems = safeLocalParse(localKey, []);
                
                // --- TRAINEE LOCAL CACHE PURGE (Free up memory from past global syncs) ---
                if (isTrainee) {
                    if (['records', 'submissions', 'exemptions', 'linkRequests'].includes(localKey)) {
                        localItems = localItems.filter(i => (i.trainee || '').toLowerCase() === CURRENT_USER.user.toLowerCase() || (i.user || '').toLowerCase() === CURRENT_USER.user.toLowerCase());
                    } else if (['attendance_records', 'monitor_history'].includes(localKey)) {
                        localItems = localItems.filter(i => (i.user || '').toLowerCase() === CURRENT_USER.user.toLowerCase() || (i.user_id || '').toLowerCase() === CURRENT_USER.user.toLowerCase());
                    }
                }
                
                const hashMapKey = `hash_map_${localKey}`;
                const hashMap = safeLocalParse(hashMapKey, {});
                
                // --- THE GHOST SLAYER (LOCAL PURGE) ---
                // Actively destroy items in the local cache that have been deleted globally,
                // preventing this device from resurrecting them during the next push.

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

                if (['records', 'submissions'].includes(localKey)) {
                    merged[localKey] = dedupeArrayByIdentity(localKey, merged[localKey], 'server_wins');

                    // Reconcile against current server IDs on full/interactive pulls so stale machine-local rows are purged.
                    if (!silent) {
                        try {
                            const { data: serverIndexRows, error: serverIndexErr } = await window.supabaseClient
                                .from(tableName)
                                .select('id')
                                .limit(10000);

                            if (!serverIndexErr && serverIndexRows) {
                                merged[localKey] = reconcileServerIndexedRows(
                                    localKey,
                                    merged[localKey],
                                    hashMap,
                                    serverIndexRows.map(row => row.id)
                                );
                            }
                        } catch (reconcileErr) {
                            console.warn(`Server index reconciliation failed for ${localKey}:`, reconcileErr);
                        }
                    }
                }
                
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
                // ARCHITECTURAL FIX: Keep hash maps for heavy logs so we don't re-upload them continuously.
                safeServerItems.forEach(item => {
                    if(item.id) hashMap[item.id] = generateChecksum(JSON.stringify(item));
                });
                localStorage.setItem(hashMapKey, JSON.stringify(hashMap));
                }
            } else if (isFullAuthoritativePull && !rowErr) {
                // If authoritative and 0 rows returned, it means table is empty. Clear local.
                if(!silent) console.log(`Clearing ${localKey} (Server Empty)`);
                localStorage.setItem(localKey, '[]');
            }

                completedRowTables += 1;
                pullProgressDone += 1;
                updateSyncDiagnostics({
                    phase: `Row sync ${completedRowTables}/${plannedRowTables || 0}`,
                    item: `${localKey} (${tableName})`,
                    progressDone: pullProgressDone,
                    progressTotal: pullProgressTotal,
                    bytesDone: pullBytesDone,
                    bytesTotal: pullBytesTotal
                });
            };

            if (heavyTables.includes(tableName)) {
                heavyTasks.push(syncTask);
            } else {
                fastTasks.push(syncTask());
            }
        });

        // 1. Run lightweight tables in parallel for instant boot
        await Promise.all(fastTasks);

        // 2. Run heavy JSON tables sequentially to prevent network timeout & UI freezing
        for (const task of heavyTasks) {
            await task();
        }

        // --- PHASE C: MONITOR STATE SYNC (Real-time Activity) ---
        // OPTIMIZATION: Only Admins/TeamLeaders need to download the entire company's live activity data.
        if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin' || CURRENT_USER.role === 'teamleader')) {
            pullProgressTotal += 1;
            const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
            const { data: monRows, error: monErr } = await window.supabaseClient
                .from('monitor_state')
                .select('user_id, data')
                .gt('updated_at', oneDayAgo);
                
            if (monRows) {
                // Merge server state into local monitor_data
                const monData = safeLocalParse('monitor_data', {});
                monRows.forEach(r => {
                    const isDeleted = pendingQueries.some(q => q.table === 'monitor_state' && q.col === 'user_id' && q.val === r.user_id);
                    if (!isDeleted) {
                        monData[r.user_id] = r.data;
                    }
                });
                
                // Preserve MY local state (Optimistic UI)
                const currentLocal = safeLocalParse('monitor_data', {});
                if (currentLocal[CURRENT_USER.user]) {
                    monData[CURRENT_USER.user] = currentLocal[CURRENT_USER.user];
                }
                localStorage.setItem('monitor_data', JSON.stringify(monData));
                const monitorBytes = estimateSyncPayloadSize(monRows.map(r => r && r.data ? r.data : null));
                pullBytesDone += monitorBytes;
                pullBytesTotal += monitorBytes;
            }
            pullProgressDone += 1;
            updateSyncDiagnostics({
                phase: 'Monitor state sync complete',
                item: `monitor_state rows: ${Array.isArray(monRows) ? monRows.length : 0}`,
                progressDone: pullProgressDone,
                progressTotal: pullProgressTotal,
                bytesDone: pullBytesDone,
                bytesTotal: pullBytesTotal
            });
        }

        // --- PHASE D: POST-SYNC ACTIONS ---
        const config = safeLocalParse('system_config', {});
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
        updateSyncDiagnostics({
            status: 'success',
            statusText: 'Server pull complete',
            direction: 'download',
            phase: 'Download complete',
            item: '-',
            progressDone: Math.max(pullProgressDone, pullProgressTotal),
            progressTotal: Math.max(pullProgressTotal, pullProgressDone),
            bytesDone: pullBytesDone,
            bytesTotal: Math.max(pullBytesTotal, pullBytesDone),
            lastSuccessAt: Date.now(),
            startedAt: 0
        });
        
        // NATIVE DISK CACHE BACKUP
        if (!IS_DEMO_MODE && window.electronAPI && window.electronAPI.disk) {
            window.electronAPI.disk.saveCache(JSON.stringify(localStorage)).catch(()=>{});
        }
        return true; // Signal Success

    } catch (err) { 
        updateSyncUI('error');
        updateSyncDiagnostics({
            status: 'error',
            statusText: 'Download failed',
            direction: 'download',
            phase: 'Server pull failed',
            item: '-',
            lastError: err && err.message ? err.message : 'Unknown sync error',
            startedAt: 0
        });
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
    // CLOUD DEAD OVERRIDE: Disable Lookout to prevent the app from seeking the dead cloud
    return;

    if (SERVER_LOOKOUT_INTERVAL) clearInterval(SERVER_LOOKOUT_INTERVAL);
    // Run every 30 seconds
    SERVER_LOOKOUT_INTERVAL = setInterval(async () => {
        // RECOVERY MODE LOCK: Do not automatically switch servers if we just auto-recovered.
        // The Admin must explicitly save configuration to clear this flag and attempt local again.
        if (sessionStorage.getItem('recovery_mode') === 'true') return;

        const localConfig = safeLocalParse('system_config', {}) || {};
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
    const config = safeLocalParse('system_config', {}) || {};
    
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
async function reportSystemError(msg, type, meta = null) {
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

    const normalizedMeta = (meta && typeof meta === 'object') ? meta : {};
    const report = {
        id: Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        user: user,
        role: role,
        error: String(msg || ''),
        type: String(type || 'error'),
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        source: normalizedMeta.source || 'system',
        issueDetail: normalizedMeta.issueDetail ? String(normalizedMeta.issueDetail) : '',
        consoleSnapshot: normalizedMeta.consoleSnapshot ? String(normalizedMeta.consoleSnapshot) : '',
        pageUrl: normalizedMeta.pageUrl ? String(normalizedMeta.pageUrl) : (typeof location !== 'undefined' ? location.href : ''),
        activeTab: normalizedMeta.activeTab ? String(normalizedMeta.activeTab) : '',
        appVersion: normalizedMeta.appVersion ? String(normalizedMeta.appVersion) : (window.APP_VERSION || 'Unknown')
    };

    // Optimistic Load & Save
    const reports = safeLocalParse('error_reports', []) || [];
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
    
    const reports = (safeLocalParse('error_reports', []) || []).filter(r => (r.type || '') !== 'user_report');
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

window.SYNC_DIAGNOSTICS = window.SYNC_DIAGNOSTICS || {
    status: 'idle',
    statusText: 'Idle',
    direction: 'idle',
    phase: 'Waiting',
    item: '-',
    server: '-',
    progressDone: 0,
    progressTotal: 0,
    bytesDone: 0,
    bytesTotal: 0,
    queuedIncoming: 0,
    queuedSaves: 0,
    pendingDeletes: 0,
    latencyMs: 0,
    startedAt: 0,
    updatedAt: Date.now(),
    lastSuccessAt: 0,
    lastError: ''
};

function escapeSyncHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function estimateSyncPayloadSize(payload) {
    try {
        const serialized = JSON.stringify(payload === undefined ? null : payload);
        if (!serialized) return 0;
        if (typeof Blob !== 'undefined') {
            return new Blob([serialized]).size;
        }
        return serialized.length * 2;
    } catch (e) {
        return 0;
    }
}

function formatSyncBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getActiveSyncServerLabel() {
    const target = (localStorage.getItem('active_server_target') || 'cloud').toLowerCase();
    if (target === 'local') {
        const settings = safeLocalParse('system_config', {})?.server_settings || {};
        const localUrl = String(settings.local_url || '').trim();
        if (localUrl) {
            try {
                const parsed = new URL(localUrl);
                return `Local (${parsed.host})`;
            } catch (e) {
                return `Local (${localUrl})`;
            }
        }
        return 'Local';
    }
    if (target === 'staging') return 'Staging';
    return 'Cloud';
}

function refreshSyncDiagnosticsCounters() {
    if (!window.SYNC_DIAGNOSTICS) return;
    window.SYNC_DIAGNOSTICS.queuedIncoming = Array.isArray(INCOMING_DATA_QUEUE) ? INCOMING_DATA_QUEUE.length : 0;
    window.SYNC_DIAGNOSTICS.queuedSaves = (SAVE_QUEUE && typeof SAVE_QUEUE.size === 'number') ? SAVE_QUEUE.size : 0;
    const pending = safeLocalParse(PENDING_DEL_KEY, []);
    window.SYNC_DIAGNOSTICS.pendingDeletes = Array.isArray(pending) ? pending.length : 0;
    window.SYNC_DIAGNOSTICS.latencyMs = Number(window.CURRENT_LATENCY || 0);
}

function renderSyncDiagnostics() {
    const indicator = document.getElementById('sync-indicator');
    if (!indicator || !window.SYNC_DIAGNOSTICS) return;

    const state = window.SYNC_DIAGNOSTICS;
    refreshSyncDiagnosticsCounters();

    const total = Math.max(Number(state.progressTotal) || 0, 0);
    const done = Math.max(Math.min(Number(state.progressDone) || 0, total || Number(state.progressDone) || 0), 0);
    const progressPercent = total > 0 ? Math.round((done / total) * 100) : 0;
    const bytesDone = Math.max(Number(state.bytesDone) || 0, 0);
    const bytesTotal = Math.max(Number(state.bytesTotal) || 0, bytesDone);
    const elapsedMs = state.startedAt ? Math.max(0, Date.now() - state.startedAt) : 0;
    const elapsedText = elapsedMs > 0 ? `${(elapsedMs / 1000).toFixed(1)}s` : '-';
    const lastSuccessText = state.lastSuccessAt ? new Date(state.lastSuccessAt).toLocaleTimeString() : '-';

    const tooltipLines = [
        `Status: ${state.statusText || state.status || 'Idle'}`,
        `Direction: ${state.direction || 'idle'}`,
        `Phase: ${state.phase || '-'}`,
        `Item: ${state.item || '-'}`,
        `Server: ${state.server || '-'}`,
        `Progress: ${done}/${total || 0} (${progressPercent}%)`,
        `Transfer: ${formatSyncBytes(bytesDone)} / ${formatSyncBytes(bytesTotal)}`,
        `Queues: incoming ${state.queuedIncoming || 0}, save ${state.queuedSaves || 0}, delete ${state.pendingDeletes || 0}`,
        `Latency: ${state.latencyMs || 0}ms`,
        `Elapsed: ${elapsedText}`,
        `Last success: ${lastSuccessText}`,
        `Last error: ${state.lastError || '-'}`,
        `Updated: ${new Date(state.updatedAt || Date.now()).toLocaleTimeString()}`
    ];
    indicator.title = tooltipLines.join('\n');

    const popover = document.getElementById('sync-detail-popover');
    if (!popover) return;

    popover.innerHTML = `
        <div class="sync-detail-title">Sync Activity</div>
        <div class="sync-detail-grid">
            <span>Status</span><strong>${escapeSyncHtml(state.statusText || state.status || 'Idle')}</strong>
            <span>Direction</span><strong>${escapeSyncHtml(state.direction || 'idle')}</strong>
            <span>Phase</span><strong>${escapeSyncHtml(state.phase || '-')}</strong>
            <span>Item</span><strong>${escapeSyncHtml(state.item || '-')}</strong>
            <span>Server</span><strong>${escapeSyncHtml(state.server || '-')}</strong>
            <span>Progress</span><strong>${done}/${total || 0} (${progressPercent}%)</strong>
            <span>Transfer</span><strong>${formatSyncBytes(bytesDone)} / ${formatSyncBytes(bytesTotal)}</strong>
            <span>Queue</span><strong>IN ${state.queuedIncoming || 0} / SAVE ${state.queuedSaves || 0} / DEL ${state.pendingDeletes || 0}</strong>
            <span>Latency</span><strong>${state.latencyMs || 0}ms</strong>
            <span>Elapsed</span><strong>${elapsedText}</strong>
            <span>Last Success</span><strong>${escapeSyncHtml(lastSuccessText)}</strong>
            <span>Last Error</span><strong>${escapeSyncHtml(state.lastError || '-')}</strong>
        </div>
        <div class="sync-progress-bar"><div class="sync-progress-fill" style="width:${progressPercent}%;"></div></div>
    `;
}

function updateSyncDiagnostics(patch = {}) {
    if (!window.SYNC_DIAGNOSTICS) return;
    const next = { ...window.SYNC_DIAGNOSTICS, ...patch, updatedAt: Date.now() };
    if (!next.server || next.server === '-') next.server = getActiveSyncServerLabel();
    if (!next.statusText) next.statusText = next.status || 'Idle';
    window.SYNC_DIAGNOSTICS = next;
    renderSyncDiagnostics();
}

window.updateSyncDiagnostics = updateSyncDiagnostics;

// --- SYNC STATUS UI ---
function updateSyncUI(status) {
    const el = document.getElementById('sync-indicator');
    if(!el) return;
    
    // Ensure visibility (Reset transition for instant show)
    el.style.transition = 'none';
    el.style.opacity = '1';

    if(status === 'busy') {
        el.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="color:var(--primary);"></i> Uploading...';
        updateSyncDiagnostics({
            status: 'busy',
            statusText: 'Uploading',
            direction: 'upload',
            phase: 'Pushing local changes',
            server: getActiveSyncServerLabel(),
            startedAt: window.SYNC_DIAGNOSTICS?.startedAt || Date.now()
        });
    } else if (status === 'syncing') {
        el.innerHTML = '<i class="fas fa-sync fa-spin" style="color:var(--text-muted);"></i> Syncing...';
        updateSyncDiagnostics({
            status: 'syncing',
            statusText: 'Syncing',
            direction: 'download',
            phase: 'Pulling server updates',
            server: getActiveSyncServerLabel(),
            startedAt: window.SYNC_DIAGNOSTICS?.startedAt || Date.now()
        });
    } else if (status === 'success') {
        el.innerHTML = '<i class="fas fa-check" style="color:#2ecc71;"></i> Synced';
        updateSyncDiagnostics({
            status: 'success',
            statusText: 'Synced',
            direction: 'idle',
            phase: 'Idle',
            item: '-',
            progressDone: Math.max(window.SYNC_DIAGNOSTICS?.progressDone || 0, window.SYNC_DIAGNOSTICS?.progressTotal || 0),
            progressTotal: Math.max(window.SYNC_DIAGNOSTICS?.progressTotal || 0, window.SYNC_DIAGNOSTICS?.progressDone || 0),
            bytesDone: window.SYNC_DIAGNOSTICS?.bytesTotal || window.SYNC_DIAGNOSTICS?.bytesDone || 0,
            bytesTotal: window.SYNC_DIAGNOSTICS?.bytesTotal || window.SYNC_DIAGNOSTICS?.bytesDone || 0,
            lastSuccessAt: Date.now(),
            lastError: '',
            startedAt: 0
        });
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
        updateSyncDiagnostics({
            status: 'error',
            statusText: msg,
            direction: 'error',
            phase: 'Sync interrupted',
            lastError: msg,
            server: getActiveSyncServerLabel()
        });
    } else if (status === 'pending') {
        el.innerHTML = '<i class="fas fa-pen" style="color:#f1c40f;"></i> Unsaved...';
        updateSyncDiagnostics({
            status: 'pending',
            statusText: 'Unsaved changes',
            direction: 'pending',
            phase: 'Waiting to upload',
            server: getActiveSyncServerLabel()
        });
    } else if (status === 'processing_queue') {
        el.innerHTML = `<i class="fas fa-cogs fa-spin" style="color:var(--primary);"></i> Processing...`;
        updateSyncDiagnostics({
            status: 'processing_queue',
            statusText: 'Processing queue',
            direction: 'process',
            phase: 'Applying realtime updates',
            server: getActiveSyncServerLabel()
        });
    }

    renderSyncDiagnostics();
}

function emitDataChange(localKey, source = 'unknown') {
    if (!localKey || typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;

    try {
        window.dispatchEvent(new CustomEvent('buildzone:data-changed', {
            detail: { key: localKey, source, timestamp: Date.now() }
        }));
    } catch (error) {
        console.warn('Failed to dispatch data change event:', error);
    }
}

function applyDataTimestamps(item, options = {}) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;

    const now = options.now || new Date().toISOString();
    const fallbackUser = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER)
        ? (CURRENT_USER.user || CURRENT_USER.email || CURRENT_USER.role || 'system')
        : 'system';
    const modifiedBy = options.modifiedBy || fallbackUser;

    if (!item.createdAt) item.createdAt = item.timestamp || now;
    if (!item.lastModified) item.lastModified = item.createdAt || now;
    if (!item.modifiedBy) item.modifiedBy = modifiedBy;

    if (options.touch) {
        item.lastModified = now;
        item.modifiedBy = modifiedBy;
    }

    return item;
}

window.applyDataTimestamps = applyDataTimestamps;

// --- HELPER: LIGHTWEIGHT CHECKSUM ---
// Reduces hash_map size by 99% (Stores 8-char string instead of full JSON)
function generateChecksum(str) {
    let hash = 5381, i = str.length;
    while(i) hash = (hash * 33) ^ str.charCodeAt(--i);
    return (hash >>> 0).toString(16);
}

function normalizeIdentityValue(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim().toLowerCase();
}

function getArrayItemIdentity(key, item) {
    if (item === undefined || item === null) return null;

    if ((key === 'vettingTopics' || key === 'monitor_whitelist' || key === 'monitor_reviewed' || key === 'system_tombstones') && typeof item === 'string') {
        const normalized = normalizeIdentityValue(item);
        return normalized ? `${key}:${normalized}` : null;
    }

    if (key === 'users' && item.user) {
        return `user:${normalizeIdentityValue(item.user)}`;
    }

    // Support alternative key shapes (some server rows use 'username')
    if (key === 'users' && item.username) {
        return `user:${normalizeIdentityValue(item.username)}`;
    }

    if (key === 'assessments' && item.name) {
        return `assessment:${normalizeIdentityValue(item.name)}`;
    }

    if (key === 'records') {
        if (item.submissionId) return `record-submission:${normalizeIdentityValue(item.submissionId)}`;

        const trainee = normalizeIdentityValue(item.trainee);
        const assessment = normalizeIdentityValue(item.assessment);
        const groupId = normalizeIdentityValue(item.groupID);
        const phase = normalizeIdentityValue(item.phase);
        if (trainee && assessment) {
            return `record:${trainee}|${assessment}|${groupId}|${phase}`;
        }
    }

    if (key === 'submissions') {
        if (item.id !== undefined && item.id !== null) {
            return `submission-id:${normalizeIdentityValue(item.id)}`;
        }

        const trainee = normalizeIdentityValue(item.trainee);
        const testId = normalizeIdentityValue(item.testId);
        const date = normalizeIdentityValue(item.date);
        if (trainee && testId && date) {
            return `submission:${trainee}|${testId}|${date}`;
        }
    }

    if (key === 'liveSessions' && item.sessionId) {
        return `live-session:${normalizeIdentityValue(item.sessionId)}`;
    }

    if (key === 'graduated_agents' && item.user) {
        return `graduated:${normalizeIdentityValue(item.user)}`;
    }

    if (key === 'retrain_archives') {
        if (item.id !== undefined && item.id !== null) {
            return `retrain-id:${normalizeIdentityValue(item.id)}`;
        }
        if (item.user && item.targetGroup && item.movedDate) {
            return `retrain:${normalizeIdentityValue(item.user)}|${normalizeIdentityValue(item.targetGroup)}|${normalizeIdentityValue(item.movedDate)}`;
        }
    }

    if (key === 'linkRequests' && item.recordId) {
        return `link-request:${normalizeIdentityValue(item.recordId)}`;
    }

    if (key === 'monitor_history' && item.user && item.date) {
        return `monitor-history:${normalizeIdentityValue(item.user)}|${normalizeIdentityValue(item.date)}`;
    }

    if (item.id !== undefined && item.id !== null) {
        return `id:${normalizeIdentityValue(item.id)}`;
    }

    return null;
}

function dedupeArrayByIdentity(key, items, strategy = 'server_wins') {
    if (!Array.isArray(items) || items.length < 2) return items;

    const deduped = [];
    const seen = new Map();
    let duplicates = 0;

    items.forEach(item => {
        const identity = getArrayItemIdentity(key, item);
        if (!identity) {
            deduped.push(item);
            return;
        }

        const existingIndex = seen.get(identity);
        if (existingIndex === undefined) {
            seen.set(identity, deduped.length);
            deduped.push(item);
            return;
        }

        duplicates++;
        deduped[existingIndex] = resolveDuplicateArrayItem(key, deduped[existingIndex], item, strategy);
    });

    if (duplicates > 0) console.debug(`[dedupeArrayByIdentity] collapsed ${duplicates} duplicates for key='${key}'`);

    return deduped;
}

function getTimestampPreferenceValue(item) {
    if (!item || typeof item !== 'object') return 0;

    const candidates = [
        item.lastModified,
        item.updatedAt,
        item.lastEditedDate,
        item.modifiedAt,
        item.updated_at,
        item.createdAt,
        item.created_at,
        item.timestamp
    ];

    for (const candidate of candidates) {
        if (candidate === undefined || candidate === null || candidate === '') continue;

        if (typeof candidate === 'number' && Number.isFinite(candidate)) {
            return candidate;
        }

        const parsed = new Date(candidate).getTime();
        if (Number.isFinite(parsed)) return parsed;
    }

    return 0;
}

function resolveDuplicateArrayItem(key, existingItem, incomingItem, strategy = 'server_wins') {
    const existingTs = getTimestampPreferenceValue(existingItem);
    const incomingTs = getTimestampPreferenceValue(incomingItem);

    if (existingTs || incomingTs) {
        if (existingTs && incomingTs && existingTs !== incomingTs) {
            return incomingTs > existingTs ? incomingItem : existingItem;
        }

        if (incomingTs && !existingTs) return incomingItem;
        if (existingTs && !incomingTs) return existingItem;
    }

    return strategy === 'local_wins' ? incomingItem : existingItem;
}

function reconcileServerIndexedRows(localKey, items, hashMap, serverIds) {
    if (!['records', 'submissions'].includes(localKey) || !Array.isArray(items)) {
        return items;
    }

    const serverIdSet = new Set((serverIds || []).map(id => String(id)));

    return items.filter(item => {
        if (!item) return false;
        if (!item.id) return true;

        const itemId = String(item.id);
        if (serverIdSet.has(itemId)) return true;

        const syncedHash = hashMap[item.id];
        const currentHash = generateChecksum(JSON.stringify(item));
        return !syncedHash || currentHash !== syncedHash;
    });
}

// 3. SAVE CONTROLLER (Public Function)
// Queues save operations and processes them after a debounce period for performance.
async function saveToServer(targetKeys = null, force = false, silent = false) {
    // 1. Flush Command (Executes queue immediately using delta sync without adding all keys)
    if (targetKeys === 'FLUSH') {
        if (SAVE_TIMEOUT) clearTimeout(SAVE_TIMEOUT);
        SAVE_TIMEOUT = null;
        const isSilent = !window._SAVE_QUEUE_NOT_SILENT;
        window._SAVE_QUEUE_NOT_SILENT = false;
        
        // SAFE QUIT FIX: If a save is actively processing, wait for it to finish before flushing.
        // This prevents the Mutex from tricking Electron into closing the app before data is secured.
        while (_IS_PROCESSING_SAVE) { await new Promise(r => setTimeout(r, 50)); }
        
        return await _processSaveQueue(false, isSilent);
    }

    // Legacy support: if first arg is boolean, treat as force for ALL keys
    if (typeof targetKeys === 'boolean') {
        force = targetKeys;
        targetKeys = null; // Save all
    }

    const keysToQueue = targetKeys || Object.keys(DB_SCHEMA);
    const hasStrictExplicitTargets = Array.isArray(targetKeys) && targetKeys.some(k => STRICT_SERVER_KEYS.has(k));
    if (Array.isArray(targetKeys)) {
        targetKeys.forEach(k => EXPLICIT_SAVE_KEYS.add(k));
    }
    keysToQueue.forEach(k => SAVE_QUEUE.add(k));

    if (!silent) {
        window._SAVE_QUEUE_NOT_SILENT = true;
        updateSyncUI('pending');
    }

    // Shared strict keys (tests/schedules/users/etc.) must persist immediately to prevent
    // server-authoritative pulls from reverting recent edits during debounce windows.
    if (force || hasStrictExplicitTargets) {
        if (SAVE_TIMEOUT) clearTimeout(SAVE_TIMEOUT);
        SAVE_TIMEOUT = null;
        const isSilent = !window._SAVE_QUEUE_NOT_SILENT;
        window._SAVE_QUEUE_NOT_SILENT = false;
        
        // FAKE SUCCESS FIX: Wait for the Mutex to release so the UI doesn't get a fake "success" before the upload actually finishes
        while (_IS_PROCESSING_SAVE) { await new Promise(r => setTimeout(r, 50)); }
        
        // Await the actual processing when forced
        return await _processSaveQueue(force, isSilent);
    } else {
        if (SAVE_TIMEOUT) clearTimeout(SAVE_TIMEOUT);
        SAVE_TIMEOUT = setTimeout(() => {
            const isSilent = !window._SAVE_QUEUE_NOT_SILENT;
            window._SAVE_QUEUE_NOT_SILENT = false;
            _processSaveQueue(false, isSilent);
        }, SAVE_DEBOUNCE_MS);
        // Return optimistically for debounced saves
        return true;
    }
}

// 4. SAVE PROCESSOR (Internal Function)
// The original saveToServer logic, now processes the queue.
let _IS_PROCESSING_SAVE = false;
let _RETRIGGER_SAVE = false;

async function _processSaveQueue(force = false, silent = false, retryCount = 0) {
    let keysToSave = [];
    let currentKeyIndex = 0;
    let pushProgressDone = 0;
    let pushProgressTotal = 0;
    let pushBytesDone = 0;
    let pushBytesTotal = 0;
    const pushStartedAt = Date.now();

    if (_IS_PROCESSING_SAVE && retryCount === 0) {
        _RETRIGGER_SAVE = true;
        return true;
    }
    _IS_PROCESSING_SAVE = true;

    try {
        // LOCKDOWN CHECK
        const config = safeLocalParse('system_config', {}) || {};
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

        keysToSave = Array.from(SAVE_QUEUE);
        if (keysToSave.length === 0) return true; // Nothing to do
        SAVE_QUEUE.clear(); // Clear queue immediately
        if(!silent) updateSyncUI('busy');
        pushProgressTotal = keysToSave.length;
        updateSyncDiagnostics({
            status: 'busy',
            statusText: 'Uploading changes',
            direction: 'upload',
            phase: 'Preparing upload queue',
            item: '-',
            server: getActiveSyncServerLabel(),
            progressDone: pushProgressDone,
            progressTotal: pushProgressTotal,
            bytesDone: pushBytesDone,
            bytesTotal: pushBytesTotal,
            startedAt: pushStartedAt
        });

        // 0. Process Deletes First (Ensure server is clean before we push)
        await processPendingDeletes();

        for (currentKeyIndex = 0; currentKeyIndex < keysToSave.length; currentKeyIndex++) {
            const key = keysToSave[currentKeyIndex];
            const isStrictServerKey = STRICT_SERVER_KEYS.has(key);
            const hasExplicitSaveRequest = EXPLICIT_SAVE_KEYS.has(key);
            const keyForce = force || (isStrictServerKey && hasExplicitSaveRequest);
            const localContent = safeLocalParse(key, null) || DB_SCHEMA[key];
            const keyBytes = estimateSyncPayloadSize(localContent);
            pushBytesTotal += keyBytes;
            updateSyncDiagnostics({
                status: 'busy',
                statusText: 'Uploading changes',
                direction: 'upload',
                phase: 'Uploading key',
                item: ROW_MAP[key] ? `${key} -> ${ROW_MAP[key]}` : key,
                progressDone: pushProgressDone,
                progressTotal: pushProgressTotal,
                bytesDone: pushBytesDone,
                bytesTotal: pushBytesTotal
            });

            // Shared/global keys are server-authoritative.
            // Ignore background/autosave uploads unless this key was explicitly targeted or force=true.
            if (isStrictServerKey && !keyForce) {
                if (!silent) console.log(`[Sync] Skipping background upload for server-authoritative key: ${key}`);
                pushProgressDone += 1;
                pushBytesDone += keyBytes;
                updateSyncDiagnostics({
                    phase: 'Skipped background key (server-authoritative)',
                    item: key,
                    progressDone: pushProgressDone,
                    progressTotal: pushProgressTotal,
                    bytesDone: pushBytesDone,
                    bytesTotal: pushBytesTotal
                });
                continue;
            }

            try {
            // --- STRATEGY A: ROW-LEVEL SYNC (Records, Submissions, Logs) ---
            if (ROW_MAP[key]) {
                const tableName = ROW_MAP[key];
                const hashMapKey = `hash_map_${key}`;
                const hashMap = safeLocalParse(hashMapKey, {}) || {};
                const itemsToUpload = [];
                const batchTimestamp = new Date().toISOString();
                const modifiedBy = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER)
                    ? (CURRENT_USER.user || CURRENT_USER.email || CURRENT_USER.role || 'system')
                    : 'system';
                
                // 1. Identify Changed Items (Delta)
                    if (Array.isArray(localContent)) {
                    localContent.forEach(item => {
                        // Ensure ID exists
                        if (!item.id) {
                            // Use deterministic IDs for 'users' to avoid duplicate rows across clients
                            if (key === 'users' && (item.user || item.username)) {
                                const nameVal = String(item.user || item.username || '').trim();
                                const normalized = normalizeIdentityValue(nameVal).replace(/\s+/g, '_');
                                item.id = `user_${normalized}`;
                            } else {
                                item.id = Date.now() + "_" + Math.random().toString(36).substr(2, 9);
                            }
                        }

                        const persistedHash = hashMap[item.id];
                        let currentHash = generateChecksum(JSON.stringify(item));
                        const shouldTouch = currentHash !== persistedHash;
                        const needsBaselineTimestamps = item && typeof item === 'object' && !Array.isArray(item)
                            && (!item.createdAt || !item.lastModified || !item.modifiedBy);

                        if (needsBaselineTimestamps || shouldTouch) {
                            applyDataTimestamps(item, {
                                now: batchTimestamp,
                                modifiedBy,
                                touch: shouldTouch
                            });
                            currentHash = generateChecksum(JSON.stringify(item));
                        }

                        if (keyForce || currentHash !== persistedHash) {
                            itemsToUpload.push({ item, currentHash });
                        }
                    });
                }
                
                // 2. Upload Deltas
                if (itemsToUpload.length > 0) {
                    if(!silent) console.log(`Uploading ${itemsToUpload.length} changed rows to ${tableName}`);
                    // Attempt to align local items with existing server rows for small identity-driven tables
                    // This prevents creating duplicate logical rows when clients generate local IDs independently.
                    if (tableName === 'users') {
                        try {
                            const { data: indexRows, error: idxErr } = await window.supabaseClient
                                .from(tableName)
                                .select('id, data->>user as username')
                                .limit(10000);
                            if (!idxErr && Array.isArray(indexRows)) {
                                const serverMap = {};
                                indexRows.forEach(r => {
                                    const uname = (r.username || (r.data && (r.data.user || r.data.username)) || '').toString().trim().toLowerCase();
                                    if (uname) serverMap[uname] = r.id;
                                });

                                itemsToUpload.forEach(entry => {
                                    const it = entry.item;
                                    const uname = String(it.user || it.username || '').trim().toLowerCase();
                                    if (uname && serverMap[uname]) it.id = serverMap[uname];
                                });
                            }
                        } catch (e) {
                            // Non-fatal: proceed with optimistic deterministic IDs
                        }
                    }
                    
                    // Map to Table Schema
                    const rows = itemsToUpload.map(entry => {
                        const item = entry.item;
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
                                throw e;
                            }
                            // If table doesn't exist, warn and skip, don't crash the whole sync.
                            if (e.code === 'PGRST205' || (e.message && e.message.includes('does not exist'))) {
                                console.warn(`Save failed for '${key}' because table '${tableName}' does not exist. Skipping.`);
                                break; // Break out of the chunk loop for this table
                            } else throw e; // Re-throw other errors to be caught by the main try/catch
                        }
                    }
                    
                    itemsToUpload.forEach(entry => {
                        if (entry.item && entry.item.id) hashMap[entry.item.id] = entry.currentHash;
                    });

                    // Save Hash Map only on success
                    localStorage.setItem(hashMapKey, JSON.stringify(hashMap));
                    // Save content back to ensure IDs are persisted locally
                    localStorage.setItem(key, JSON.stringify(localContent));
                    emitDataChange(key, 'save_to_server');
                }
            } 
            // --- STRATEGY B: MONITOR STATE (Real-time Object -> Table) ---
            else if (key === 'monitor_data') {
                 // Special handling: Write MY entry to monitor_state table
                 // We do NOT save the whole object as a blob anymore.
                 if (CURRENT_USER) {
                     const allMon = safeLocalParse('monitor_data', {}) || {};
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
                const remoteKey = IS_DEMO_MODE ? `demo_${key}` : key;

                // Optimistic Merge (Fetch -> Merge -> Push)
                if (!keyForce) {
                    const { data: remoteRow } = await window.supabaseClient
                        .from('app_documents')
                        .select('content')
                        .eq('key', remoteKey)
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
                        key: remoteKey, 
                        content: finalContent,
                        updated_at: new Date().toISOString()
                    })
                    .select();

                if (saveErr) throw saveErr;
                
                localStorage.setItem(key, JSON.stringify(finalContent));
                if(savedData && savedData[0]) localStorage.setItem('sync_ts_' + key, savedData[0].updated_at);
                emitDataChange(key, 'save_to_server');
            }
            if (hasExplicitSaveRequest) EXPLICIT_SAVE_KEYS.delete(key);
            } catch (keyErr) {
                console.warn(`[Sync Sandbox] Failed to process key '${key}':`, keyErr.message || keyErr);
                const msg = keyErr.message || '';
                if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('521') || msg.includes('503')) throw keyErr;
                if (hasExplicitSaveRequest) EXPLICIT_SAVE_KEYS.delete(key);
            }

            pushProgressDone += 1;
            pushBytesDone += keyBytes;
            updateSyncDiagnostics({
                status: 'busy',
                statusText: 'Uploading changes',
                direction: 'upload',
                phase: 'Uploaded key',
                item: ROW_MAP[key] ? `${key} -> ${ROW_MAP[key]}` : key,
                progressDone: pushProgressDone,
                progressTotal: pushProgressTotal,
                bytesDone: pushBytesDone,
                bytesTotal: pushBytesTotal
            });
        }

        currentKeyIndex = keysToSave.length;

        if(!silent) updateSyncUI('success');
        updateSyncDiagnostics({
            status: 'success',
            statusText: 'Upload complete',
            direction: 'upload',
            phase: 'Upload complete',
            item: '-',
            progressDone: pushProgressTotal,
            progressTotal: pushProgressTotal,
            bytesDone: pushBytesDone,
            bytesTotal: Math.max(pushBytesDone, pushBytesTotal),
            lastSuccessAt: Date.now(),
            startedAt: 0
        });
        if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
        
        // NATIVE DISK CACHE BACKUP
        if (!IS_DEMO_MODE && window.electronAPI && window.electronAPI.disk) {
            window.electronAPI.disk.saveCache(JSON.stringify(localStorage)).catch(()=>{});
        }
        return true;

    } catch (err) {
        keysToSave.slice(currentKeyIndex).forEach(k => SAVE_QUEUE.add(k));

        // RETRY LOGIC: Try once more if it failed (Network blip)
        if (retryCount < 1) {
            console.warn("Sync failed, retrying...", err);
                return await _processSaveQueue(force, silent, retryCount + 1);
        }

        if(!silent) updateSyncUI('error');
        updateSyncDiagnostics({
            status: 'error',
            statusText: 'Upload failed',
            direction: 'upload',
            phase: 'Upload failed',
            item: keysToSave[currentKeyIndex] || '-',
            progressDone: pushProgressDone,
            progressTotal: pushProgressTotal,
            bytesDone: pushBytesDone,
            bytesTotal: Math.max(pushBytesDone, pushBytesTotal),
            lastError: err && err.message ? err.message : 'Unknown upload error',
            startedAt: 0
        });
        console.error("Cloud Sync Error:", err);
        
        let msg = err.message || "Check Console for details";
        // Detect RLS Policy errors and give a clearer message
        if (msg.includes("row level security")) {
            msg = "Database Permission Denied (RLS Policy)";
            console.warn("FIX: Go to Supabase > SQL Editor and run: CREATE POLICY \"Allow All\" ON app_documents FOR ALL USING (true);");
        }
        
        if(typeof showToast === 'function' && !silent) showToast("Save Failed: " + msg, 'error');
        return false;
    } finally {
        _IS_PROCESSING_SAVE = false;
        if (_RETRIGGER_SAVE) {
            _RETRIGGER_SAVE = false;
            setTimeout(() => _processSaveQueue(false, true), 100);
        }
    }
}

// --- HELPER: MERGE LOGIC (Crucial for Data Integrity) ---
// UPDATED: Improved deduplication logic to prevent "10 copies" bug
// ADDED: 'strategy' param. 'local_wins' (Pushing) or 'server_wins' (Pulling)
function performSmartMerge(server, local, strategy = 'local_wins') {
    const merged = { ...server }; 
    
    // Safety check for revoked users (Blacklist, case-insensitive union)
    const serverBlacklist = Array.isArray(server.revokedUsers) ? server.revokedUsers : [];
    const localBlacklist = Array.isArray(local.revokedUsers) ? local.revokedUsers : [];
    const blacklist = [];
    const blacklistSet = new Set();
    [...serverBlacklist, ...localBlacklist].forEach((name) => {
        const raw = String(name || '').trim();
        if (!raw) return;
        const normalized = raw.toLowerCase();
        if (!blacklistSet.has(normalized)) {
            blacklistSet.add(normalized);
            blacklist.push(raw);
        }
    });

    const mergeKeys = new Set([
        ...Object.keys(DB_SCHEMA || {}),
        ...Object.keys(server || {}),
        ...Object.keys(local || {})
    ]);

    mergeKeys.forEach(key => {
        const sVal = server[key];
        const lVal = local[key];

        // Case 1: Arrays (Records, Users, Tests, Notices)
        if (Array.isArray(sVal) && Array.isArray(lVal)) {
            let combined = [...sVal];
            
            lVal.forEach(localItem => {
                const localIdentity = getArrayItemIdentity(key, localItem);
                // Check if item exists in server data using SPECIFIC unique keys
                // This prevents duplicates when timestamps/hidden fields differ slightly
                const exists = combined.some(serverItem => {
                    const serverIdentity = getArrayItemIdentity(key, serverItem);
                    if (localIdentity && serverIdentity) {
                        return localIdentity === serverIdentity;
                    }

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
                        const existingIdentity = getArrayItemIdentity(key, i);
                        if (localIdentity && existingIdentity) return localIdentity === existingIdentity;
                        return JSON.stringify(i) === JSON.stringify(localItem);
                    });
                        if(index > -1) {
                            // --- NEW: Deep Merge for Test Questions (Marker Notes) ---
                            if (key === 'tests') {
                                const sTest = combined[index];
                                if (sTest.questions && localItem.questions) {
                                    localItem.questions.forEach((lQ, qIdx) => {
                                        const sQ = sTest.questions[qIdx];
                                        if (sQ && (sQ.adminNotesUpdated || 0) > (lQ.adminNotesUpdated || 0)) {
                                            lQ.adminNotes = sQ.adminNotes;
                                            lQ.adminNotesUpdated = sQ.adminNotesUpdated;
                                        }
                                    });
                                }
                            }
                            // ---------------------------------------------------------
                            combined[index] = localItem;
                        }
                    } else if (strategy === 'server_wins') {
                        // NEW: Preserve newer local marker notes even if server wins overall
                        if (key === 'tests') {
                            const index = combined.findIndex(i => i.id && localItem.id && i.id.toString() === localItem.id.toString());
                            if (index > -1) {
                                const sTest = combined[index];
                                if (sTest.questions && localItem.questions) {
                                    sTest.questions.forEach((sQ, qIdx) => {
                                        const lQ = localItem.questions[qIdx];
                                        if (lQ && (lQ.adminNotesUpdated || 0) > (sQ.adminNotesUpdated || 0)) {
                                            sQ.adminNotes = lQ.adminNotes;
                                            sQ.adminNotesUpdated = lQ.adminNotesUpdated;
                                        }
                                    });
                                }
                            }
                        }
                    }
                }
            });

            // --- DELETION FIX: Users ---
            if (key === 'users' && blacklistSet.size > 0) {
                combined = combined.filter(u => !blacklistSet.has(String((u && u.user) || '').toLowerCase()));
            }

            merged[key] = dedupeArrayByIdentity(key, combined, strategy);
        } 
        // Case 2a: Vetting Session (Deep Merge Trainees)
        else if (key === 'vettingSession') {
            const safeSVal = sVal || {};
            const safeLVal = lVal || {};
            const sessionChanged = !!(
                (safeSVal.sessionId && safeLVal.sessionId && safeSVal.sessionId !== safeLVal.sessionId) ||
                (safeSVal.startTime && safeLVal.startTime && safeSVal.startTime !== safeLVal.startTime)
            );
            
            // RESET CHECK: If Server has a different start time, it's a new session.
            // We must discard local stale data (like 'completed' status from previous run).
            if (sessionChanged) {
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
                    const myLocal = safeLVal.trainees && safeLVal.trainees[CURRENT_USER.user];
                    const myLocalStatus = String((myLocal && myLocal.status) || '').toLowerCase();
                    const canKeepLocal = !!myLocal && myLocalStatus !== 'completed';
                    if (canKeepLocal) {
                        if (!merged[key].trainees) merged[key].trainees = {};
                        merged[key].trainees[CURRENT_USER.user] = myLocal;
                    } else if (myLocalStatus === 'completed' && merged[key].trainees && merged[key].trainees[CURRENT_USER.user]) {
                        const myServerStatus = String((merged[key].trainees[CURRENT_USER.user] && merged[key].trainees[CURRENT_USER.user].status) || '').toLowerCase();
                        if (myServerStatus !== 'completed') delete merged[key].trainees[CURRENT_USER.user];
                    }
                }
            }
        }
        // Case 2b: Monitor Data (User-Specific Merge)
        // Prevents "War for Data" where local stale data overwrites other users' fresh server data
        else if ((key === 'monitor_data' || key === 'trainee_notes' || key === 'trainee_bookmarks') && sVal && typeof sVal === 'object' && lVal && typeof lVal === 'object') {
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
    
    // Ensure blacklist is preserved, but never keep identities that currently exist in active users.
    // This prevents stale local revocation lists from re-revoking restored trainees.
    const activeUserTokens = new Set(
        (Array.isArray(merged.users) ? merged.users : [])
            .map(u => normalizeIdentityValue((u && (u.user || u.username)) || ''))
            .filter(Boolean)
    );
    merged.revokedUsers = blacklist.filter(name => !activeUserTokens.has(normalizeIdentityValue(name)));

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

        // Dummy query to measure latency accurately
        await window.supabaseClient.from('app_documents').select('key').limit(1);

        const end = Date.now();
        const latency = end - start;

        const now = Date.now();
        const presenceUsers = Object.values(window.ACTIVE_USERS_CACHE || {}).filter(u => (now - (u.local_received_at || 0)) < 90000);
        let sessionUsers = [];
        try {
            const recentIso = new Date(now - 180000).toISOString();
            const { data: sessionRows, error: sessionErr } = await window.supabaseClient
                .from('sessions')
                .select('*')
                .gt('lastSeen', recentIso)
                .order('lastSeen', { ascending: false })
                .limit(500);
            if (!sessionErr && Array.isArray(sessionRows)) sessionUsers = sessionRows;
        } catch (sessionReadError) {
            console.warn('Session fallback read failed:', sessionReadError);
        }

        const toIdentity = (value) => String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[._-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\s+/g, '');

        const mergedMap = new Map();
        presenceUsers.forEach(p => {
            const name = p.username || p.user;
            const key = toIdentity(name);
            if (!key) return;
            mergedMap.set(key, {
                ...p,
                username: name,
                user: name
            });
        });

        const idleThreshold = (typeof IDLE_THRESHOLD !== 'undefined' && Number.isFinite(IDLE_THRESHOLD)) ? IDLE_THRESHOLD : 60000;
        sessionUsers.forEach(row => {
            const name = row.username || row.user;
            const key = toIdentity(name);
            if (!key) return;

            const lastSeenTs = row.lastSeen ? new Date(row.lastSeen).getTime() : 0;
            if (!lastSeenTs || (now - lastSeenTs) > 180000) return;

            const existing = mergedMap.get(key);
            const idleFromLastSeen = Math.max(0, now - lastSeenTs);
            const sessionItem = {
                username: name,
                user: name,
                role: row.role || (existing && existing.role) || '-',
                idleTime: Number.isFinite(row.idleTime) ? row.idleTime : ((existing && Number.isFinite(existing.idleTime)) ? existing.idleTime : idleFromLastSeen),
                isIdle: typeof row.isIdle === 'boolean' ? row.isIdle : ((existing && typeof existing.isIdle === 'boolean') ? existing.isIdle : (idleFromLastSeen > idleThreshold)),
                version: row.version || (existing && existing.version) || '-',
                clientId: row.clientId || (existing && existing.clientId) || 'Unknown',
                activity: row.activity || (existing && existing.activity) || '-',
                lastSeen: row.lastSeen || (existing && existing.lastSeen) || new Date(lastSeenTs).toISOString(),
                local_received_at: (existing && existing.local_received_at) || now
            };

            if (!existing) {
                mergedMap.set(key, sessionItem);
                return;
            }

            const existingLastSeen = existing.lastSeen ? new Date(existing.lastSeen).getTime() : 0;
            mergedMap.set(key, (lastSeenTs >= existingLastSeen) ? { ...existing, ...sessionItem } : { ...sessionItem, ...existing });
        });

        const activeUsers = Array.from(mergedMap.values())
            .filter(u => {
                const lastSeenTs = u.lastSeen ? new Date(u.lastSeen).getTime() : 0;
                if (u.local_received_at && (now - u.local_received_at) < 90000) return true;
                return !!lastSeenTs && (now - lastSeenTs) < 180000;
            })
            .sort((a, b) => {
                const aTs = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
                const bTs = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
                return bTs - aTs;
            });

        // If presence tunnel is degraded, seed cache from sessions fallback.
        if (presenceUsers.length === 0 && activeUsers.length > 0) {
            const fallbackCache = {};
            activeUsers.forEach(u => {
                const key = u.username || u.user;
                if (!key) return;
                fallbackCache[key] = {
                    ...u,
                    local_received_at: now
                };
            });
            window.ACTIVE_USERS_CACHE = fallbackCache;
        }

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
    const logs = safeLocalParse('accessLogs', []) || [];
    
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
    
    const logs = safeLocalParse('accessLogs', []) || [];
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
    const logs = safeLocalParse('auditLogs', []) || [];
    
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
async function sendHeartbeat(forceInit = false) {
    if (!CURRENT_USER || !window.supabaseClient) return;
    
    const last = window.LAST_INTERACTION || Date.now();
    const now = Date.now();
    let diff = now - last;
    const limit = (typeof IDLE_THRESHOLD !== 'undefined') ? IDLE_THRESHOLD : 60000;
    
    let isIdle = diff > limit;

    // --- OS-LEVEL IDLE ACCURACY ---
    if (typeof require !== 'undefined') {
        try {
            const { ipcRenderer } = require('electron');
            const osIdleSecs = await ipcRenderer.invoke('get-system-idle-time');
            if (osIdleSecs !== undefined && osIdleSecs !== null) {
                diff = osIdleSecs * 1000; // Use actual hardware idle time
                isIdle = diff > limit;
            }
        } catch(e) {}
    }
    
    // Get extra info
    const clientId = localStorage.getItem('client_id') || 'unknown';
    let currentActivity = 'Idle';
    if (typeof StudyMonitor !== 'undefined' && StudyMonitor.currentActivity) {
        currentActivity = StudyMonitor.currentActivity;
    }

    try {
        const safeActivity = currentActivity.length > 250 ? currentActivity.substring(0, 247) + '...' : currentActivity;
        const payload = {
            username: CURRENT_USER.user,
            role: CURRENT_USER.role,
            version: window.APP_VERSION || 'Unknown',
            idleTime: Math.round(diff),
            isIdle: isIdle,
            lastSeen: new Date().toISOString(),
            clientId: clientId,
            activity: safeActivity
        };

        // 1. SUPABASE PRESENCE (0-Latency, 0 Database impact)
        if (window.PRESENCE_CHANNEL) {
            window.PRESENCE_CHANNEL.track(payload).catch(()=>{});
        }
        
        // 2. BACKUP DB WRITE (Frequent enough to keep active monitor live even if Presence tunnel degrades)
        const lastDbWrite = parseInt(sessionStorage.getItem('last_db_heartbeat') || '0');
        if ((typeof forceInit !== 'undefined' && forceInit) || Date.now() - lastDbWrite > 15000) {
            sessionStorage.setItem('last_db_heartbeat', Date.now().toString());
            try {
                await window.supabaseClient.from('sessions').upsert({
                    username: CURRENT_USER.user,
                    role: CURRENT_USER.role,
                    lastSeen: new Date().toISOString(),
                    idleTime: Math.round(diff),
                    isIdle: isIdle,
                    version: window.APP_VERSION || 'Unknown',
                    clientId: clientId,
                    activity: safeActivity
                });
            } catch (sessionWriteError) {
                // Schema fallback for older environments that only have the basic columns.
                window.supabaseClient.from('sessions').upsert({
                    username: CURRENT_USER.user,
                    role: CURRENT_USER.role,
                    lastSeen: new Date().toISOString()
                }).then(()=>{}).catch(()=>{});
            }
        }
            
        // 3. Remote Commands
        const { data: sessionData } = await window.supabaseClient
            .from('sessions')
            .select('pending_action')
            .eq('username', CURRENT_USER.user) // New Schema
            .single();
            
        if (sessionData && sessionData.pending_action) {
            // Clear command first to prevent loops
            await window.supabaseClient.from('sessions').update({ pending_action: null }).eq('username', CURRENT_USER.user);
            executePendingSessionAction(sessionData.pending_action);
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
        
        const current = safeLocalParse('records', []) || [];
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
            const importedKeys = [];
            
            Object.keys(data).forEach(key => {
                if (key === 'meta') return; // Skip metadata
                
                if (typeof data[key] === 'object') {
                    localStorage.setItem(key, JSON.stringify(data[key]));
                } else {
                    localStorage.setItem(key, data[key]);
                }
                importedKeys.push(key);
            });

            console.log("Restoring backup to cloud...");
            // Controlled restore: sync only imported keys to avoid republishing unrelated stale state.
            if (typeof saveToServer === 'function') {
                await saveToServer(importedKeys, true);
            }

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
            d[k] = safeLocalParse(k, (typeof DB_SCHEMA !== 'undefined' ? DB_SCHEMA[k] : [])) || (typeof DB_SCHEMA !== 'undefined' ? DB_SCHEMA[k] : []);
        });
        
        d.theme = localStorage.getItem('theme') || 'dark';
        d.autoBackup = localStorage.getItem('autoBackup') || 'false';
        d.local_theme_config = safeLocalParse('local_theme_config', {}) || {};
       
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

// --- DYNAMIC FALLBACK POLLER ---
function setFallbackPollingRate(ms) {
    const rate = Number(ms) || 0;
    window.CURRENT_FALLBACK_RATE = rate;
    if (SYNC_INTERVAL) clearInterval(SYNC_INTERVAL);
    SYNC_INTERVAL = null;

    if (rate <= 0) {
        console.log("[Sync Engine] Fallback polling disabled while realtime tunnel is healthy.");
        return;
    }

    SYNC_INTERVAL = setInterval(async () => {
        await loadFromServer(true); 
        if (typeof performOrphanCleanup === 'function') {
            const lastRun = parseInt(localStorage.getItem('last_orphan_cleanup_ts') || '0');
            if (Date.now() - lastRun > 86400000) { performOrphanCleanup(true); }
        }
    }, rate);
    console.log(`[Sync Engine] Fallback polling rate adjusted to ${rate / 1000}s`);
}

function startRealtimeSync() {
    if (SYNC_INTERVAL) clearInterval(SYNC_INTERVAL);
    if (HEARTBEAT_INTERVAL_ID) clearInterval(HEARTBEAT_INTERVAL_ID);

    const config = safeLocalParse('system_config', {}) || {};
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

    window.NORMAL_FALLBACK_RATE = 0;
    const isFastFailoverRole = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER)
        && (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin');
    window.REALTIME_FAILURE_RATE = isFastFailoverRole ? 1000 : Math.max(1000, syncRate);
    window.BASE_REALTIME_FAILURE_RATE = Math.max(1000, syncRate);

    // Start the Incoming Queue Processor (Checks every 2 seconds)
    startQueueProcessor();

    console.log(`Starting Sync Engine. Realtime WebSockets Active. Fallback Polling: off when healthy, ${window.REALTIME_FAILURE_RATE / 1000}s on tunnel failure, Heartbeat: ${beatRate/1000}s`);
    
    // 1. DATA SYNC: Poll until the realtime tunnel confirms it is healthy.
    setFallbackPollingRate(window.REALTIME_FAILURE_RATE);

    // 2. HEARTBEAT: Poll every 15 seconds
    // Fast updates for "Active User" dashboard status
    HEARTBEAT_INTERVAL_ID = setInterval(() => {
        sendHeartbeat();
        
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

    // Cleanup existing channel to prevent duplicate parallel listeners
    if (window.GLOBAL_CHANGES_CHANNEL) {
        window.supabaseClient.removeChannel(window.GLOBAL_CHANGES_CHANNEL).catch(()=>{});
    }

    // Subscribe to the ENTIRE public schema for 0-latency updates
    window.GLOBAL_CHANGES_CHANNEL = window.supabaseClient.channel('global_app_changes')
        .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
            const table = payload.table;
            
            // ISOLATION: Demo mode ONLY listens to app_documents
            if (IS_DEMO_MODE && table !== 'app_documents') return;

            // Route to specific handlers
            if (table === 'monitor_state') handleMonitorRealtime(payload);
            else if (table === 'attendance') handleAttendanceRealtime(payload);
            else if (table === 'sessions') handleSessionRealtime(payload);
            else if (table === 'live_bookings') handleLiveBookingRealtime(payload);
            else if (table === 'live_sessions') handleLiveSessionRealtime(payload);
            else if (table === 'vetting_sessions' || table === 'vetting_sessions_v2') handleVettingRealtime(payload);
            else if (table === 'app_documents') handleAppDocumentRealtime(payload);
            else {
                // Catch all generic data rows (records, submissions, logs, etc.)
                if (Object.values(ROW_MAP).includes(table)) {
                    handleRowRealtime(payload);
                }
            }
        })
        .subscribe((status, err) => {
            console.log(`[Realtime Tunnel] Data Channel Status: ${status}`, err || '');
            const indicator = document.getElementById('sync-indicator');
            
            if (status === 'SUBSCRIBED') {
                if (window.REALTIME_RECONNECT_TIMER) { clearInterval(window.REALTIME_RECONNECT_TIMER); window.REALTIME_RECONNECT_TIMER = null; }
                
                // Zero-polling when the realtime tunnel is healthy.
                if (window.CURRENT_FALLBACK_RATE !== window.NORMAL_FALLBACK_RATE) setFallbackPollingRate(window.NORMAL_FALLBACK_RATE);
                
                if (indicator && indicator.innerHTML.includes('Dropped')) {
                    indicator.style.opacity = '1';
                    indicator.innerHTML = '<i class="fas fa-bolt" style="color:#2ecc71;"></i> Tunnel Restored';
                    setTimeout(() => { if (indicator.innerHTML.includes('Restored')) indicator.style.opacity = '0'; }, 3000);
                }
                updateSyncDiagnostics({
                    status: 'success',
                    statusText: 'Tunnel healthy',
                    direction: 'idle',
                    phase: 'Realtime tunnel connected',
                    item: 'Postgres changes stream',
                    server: getActiveSyncServerLabel(),
                    lastSuccessAt: Date.now()
                });
            } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                // Tunnel collapsed. Fall back to the role-based sync cadence.
                if (window.CURRENT_FALLBACK_RATE !== window.REALTIME_FAILURE_RATE) setFallbackPollingRate(window.REALTIME_FAILURE_RATE);
                
                if (indicator) {
                    indicator.style.opacity = '1';
                    indicator.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:#f1c40f;"></i> Tunnel Dropped (Polling Active)';
                }
                updateSyncDiagnostics({
                    status: 'error',
                    statusText: 'Tunnel dropped (polling active)',
                    direction: 'process',
                    phase: 'Realtime tunnel reconnecting',
                    item: 'Fallback polling enabled',
                    server: getActiveSyncServerLabel(),
                    lastError: `Realtime status: ${status}`
                });
                
                if (!window.REALTIME_RECONNECT_TIMER && navigator.onLine) {
                    window.REALTIME_RECONNECT_TIMER = setInterval(() => { console.warn("Attempting tunnel reconnect..."); setupRealtimeListeners(); }, 15000);
                }
            }
        });
        
    // --- NEW: PRESENCE CHANNEL (0-Latency, 0-DB Cost Heartbeats) ---
    if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) {
        if (window.PRESENCE_CHANNEL) window.supabaseClient.removeChannel(window.PRESENCE_CHANNEL).catch(()=>{});
        window.PRESENCE_CHANNEL = window.supabaseClient.channel('online_users', {
            config: { presence: { key: CURRENT_USER.user } }
        });

        window.PRESENCE_CHANNEL
            .on('presence', { event: 'sync' }, () => {
                const state = window.PRESENCE_CHANNEL.presenceState();
                const nextPresenceCache = {};
                for (const [userKey, presences] of Object.entries(state)) {
                    if (presences && presences.length > 0) {
                        nextPresenceCache[userKey] = {
                            ...presences[0],
                            local_received_at: Date.now()
                        };
                    }
                }
                window.ACTIVE_USERS_CACHE = nextPresenceCache;
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    if (typeof sendHeartbeat === 'function') sendHeartbeat(true);
                }
            });
    }
}

// --- NEW: QUEUE INDICATOR ---
function updateQueueIndicator() {
    const el = document.getElementById('sync-indicator'); // This is the footer indicator
    if (!el) return;

    if (INCOMING_DATA_QUEUE.length > 0) {
        el.style.transition = 'none';
        el.style.opacity = '1';
        el.innerHTML = `<i class="fas fa-inbox" style="color:#3498db;"></i> Queued: ${INCOMING_DATA_QUEUE.length}`;
        updateSyncDiagnostics({
            status: 'processing_queue',
            statusText: 'Realtime queue waiting',
            direction: 'process',
            phase: 'Queued incoming updates',
            item: `${INCOMING_DATA_QUEUE.length} waiting`,
            progressDone: 0,
            progressTotal: INCOMING_DATA_QUEUE.length
        });
    } else {
        // If queue is empty, and we are not in another permanent state like 'error', show success.
        const isError = el.innerHTML.includes('Offline') || el.innerHTML.includes('Sync Failed');
        if (!isError) updateSyncUI('success');
    }
}

function isHighPriorityIncomingPayload(item) {
    if (!item || !item.type) return false;

    if (item.type === 'app_documents') {
        const rawKey = String(item.payload?.new?.key || '').trim();
        const key = IS_DEMO_MODE ? rawKey.replace(/^demo_/, '') : rawKey;
        return ['users', 'rosters', 'schedules', 'tests', 'liveSchedules', 'system_config'].includes(key);
    }

    if (item.type === 'generic_rows') {
        const table = String(item.payload?.table || '').trim();
        return ['users', 'records', 'submissions', 'live_bookings', 'attendance', 'sessions'].includes(table);
    }

    return ['monitor', 'attendance', 'bookings'].includes(item.type);
}

// --- NEW: QUEUE PROCESSOR ---
function startQueueProcessor() {
    if (QUEUE_PROCESSOR_INTERVAL) clearInterval(QUEUE_PROCESSOR_INTERVAL);
    // Run every second so edits from other clients appear faster.
    QUEUE_PROCESSOR_INTERVAL = setInterval(processIncomingDataQueue, 1000);
}

function processIncomingDataQueue() {
    if (IS_PROCESSING_INCOMING_QUEUE) return;

    if (INCOMING_DATA_QUEUE.length === 0) {
        const el = document.getElementById('sync-indicator');
        if (el && (el.innerHTML.includes('Queued:') || el.innerHTML.includes('Processing'))) {
            updateSyncUI('success');
        }
        return;
    }

    // PROTECTION: Don't update if user is actively interacting/typing.
    // OVERRIDE: If user hasn't interacted for 30s, assume they left focus by accident and process anyway.

    // Live Assessment and Vetting are now processed instantly outside of this queue

    const timeSinceInteraction = Date.now() - (window.LAST_INTERACTION || 0);
    // UI PROTECTION: Block queue processing if the user is typing. 
    // Since Vetting/Live Arena handle their own high-priority updates instantly, 
    // it is absolutely safe to block this background queue to prevent DOM wipes and cursor stealing.
    if (isUserTyping() && timeSinceInteraction < 30000) {
        const hasHighPriority = INCOMING_DATA_QUEUE.some(isHighPriorityIncomingPayload);
        if (!hasHighPriority) return;
    }

    IS_PROCESSING_INCOMING_QUEUE = true;

    // Process in chunks to avoid long main-thread stalls that can freeze typing.
    const processingCount = Math.min(INCOMING_QUEUE_BATCH_SIZE, INCOMING_DATA_QUEUE.length);
    const queue = INCOMING_DATA_QUEUE.splice(0, processingCount);
    const queuedRemaining = INCOMING_DATA_QUEUE.length;

    // Show processing status
    const el = document.getElementById('sync-indicator');
    if (el) {
        if (queuedRemaining > 0) {
            el.innerHTML = `<i class="fas fa-cogs fa-spin" style="color:var(--primary);"></i> Processing: ${queue.length} (+${queuedRemaining} queued)`;
        } else {
            el.innerHTML = `<i class="fas fa-cogs fa-spin" style="color:var(--primary);"></i> Processing: ${queue.length}`;
        }
    }
    updateSyncDiagnostics({
        status: 'processing_queue',
        statusText: 'Processing realtime queue',
        direction: 'process',
        phase: 'Applying queued realtime changes',
        item: queuedRemaining > 0 ? `${queue.length} now, ${queuedRemaining} queued` : `${queue.length} now`,
        progressDone: queue.length,
        progressTotal: queue.length + queuedRemaining
    });

    try {
        // Batch updates by type to prevent multiple writes/renders
        const batches = {
            monitor: [],
            attendance: [],
            bookings: [],
            app_documents: [],
            generic_rows: []
        };

        queue.forEach(item => {
            if (batches[item.type]) batches[item.type].push(item.payload);
        });

        // 1. Process Monitor
        if (batches.monitor.length > 0) {
            let data = safeLocalParse('monitor_data', {}) || {};
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
            let records = safeLocalParse('attendance_records', []) || [];
            batches.attendance.forEach(p => {
                if (p.eventType === 'DELETE') {
                    records = records.filter(r => r.id !== p.old.id);
                } else {
                    const newRow = p.new;
                    if (!newRow.data) return; // Ignore Postgres WAL partial updates

                    const item = newRow.data;
                    item.id = newRow.id;
                    item.user = newRow.user_id;
                    
                    // Trainee Minimization
                    if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.role === 'trainee' && item.user !== CURRENT_USER.user) return;

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
            let bookings = safeLocalParse('liveBookings', []) || [];
            batches.bookings.forEach(p => {
                if (p.eventType === 'DELETE') {
                    bookings = bookings.filter(b => String(b.id) !== String(p.old.id));
                } else {
                    const newRow = p.new;
                    if (!newRow.data) return; // Ignore Postgres WAL partial updates

                    const item = (newRow.data && typeof newRow.data === 'object') ? { ...newRow.data } : newRow.data;
                    if (!item || typeof item !== 'object') return;
                    item.id = (item.id !== undefined && item.id !== null) ? item.id : newRow.id;
                    const idx = bookings.findIndex(b => String(b.id) === String(item.id));
                    if (idx > -1) bookings[idx] = item;
                    else bookings.push(item);
                }
            });
            bookings = dedupeArrayByIdentity('liveBookings', bookings, 'server_wins');
            localStorage.setItem('liveBookings', JSON.stringify(bookings));
            if (typeof renderLiveTable === 'function') renderLiveTable();
            if (typeof updateNotifications === 'function') updateNotifications();
        }

        // 4. Process App Documents (Settings, Rosters, Users)
        if (batches.app_documents.length > 0) {
            batches.app_documents.forEach(p => {
                if (p.eventType === 'UPDATE' || p.eventType === 'INSERT') {
                    const rawKey = p.new.key;
                    
                    // ISOLATION BARRIER
                    if (IS_DEMO_MODE && !rawKey.startsWith('demo_')) return;
                    if (!IS_DEMO_MODE && rawKey.startsWith('demo_')) return;
                    
                    const key = IS_DEMO_MODE ? rawKey.replace('demo_', '') : rawKey;
                    if (ROW_MAP[key]) return;
                    const content = p.new.content;
                    
                    // Trainee Data Minimization (Security)
                    const isTrainee = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.role === 'trainee');
                    if (isTrainee && ['agentNotes', 'tl_personal_lists'].includes(key)) return;

                    const localVal = safeLocalParse(key, null);
                    const noMergeKeys = ['rosters', 'schedules', 'tests', 'vettingTopics', 'liveSchedules', 'assessments'];
                    
                    if (localVal && (Array.isArray(localVal) || typeof localVal === 'object') && !noMergeKeys.includes(key)) {
                        const merged = performSmartMerge({[key]: content}, {[key]: localVal}, 'server_wins');
                        localStorage.setItem(key, JSON.stringify(merged[key]));
                    } else {
                        const serialized = (typeof content === 'undefined') ? JSON.stringify(null) : JSON.stringify(content);
                        localStorage.setItem(key, serialized);
                    }
                    if (p.new.updated_at) localStorage.setItem('sync_ts_' + key, p.new.updated_at);
                    emitDataChange(key, 'realtime');
                    if (key === 'system_config') applySystemConfig();
                }
            });
            
            // UI PROTECTION: Block schedule list re-renders if an Admin is actively editing a schedule item.
            // This prevents array index shifting from corrupting data upon save.
            const isEditingSchedule = document.getElementById('scheduleModal') && !document.getElementById('scheduleModal').classList.contains('hidden');
            if (typeof refreshAllDropdowns === 'function' && !isEditingSchedule) {
                refreshAllDropdowns();
            }
        }

        // 5. Process Generic Rows (Records, Submissions, Logs)
        if (batches.generic_rows.length > 0) {
            const tableUpdates = {};
            batches.generic_rows.forEach(p => {
                if (!tableUpdates[p.table]) tableUpdates[p.table] = [];
                tableUpdates[p.table].push(p);
            });

            Object.keys(tableUpdates).forEach(table => {
                const localKey = Object.keys(ROW_MAP).find(k => ROW_MAP[k] === table);
                if (!localKey) return;
                let items = safeLocalParse(localKey, []) || [];
                const isTrainee = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.role === 'trainee');

                tableUpdates[table].forEach(p => {
                    if (p.eventType === 'DELETE') {
                        items = items.filter(i => (i.id && i.id.toString()) !== p.old.id.toString());
                    } else {
                        if (!p.new.data) return;
                        const newItem = p.new.data;
                        if (!newItem.id) newItem.id = p.new.id;
                        
                        if (isTrainee && ['records', 'submissions', 'exemptions', 'linkRequests'].includes(localKey)) {
                            const nTrainee = (newItem.trainee || '').toLowerCase();
                            const nUser = (newItem.user || '').toLowerCase();
                            const cUser = CURRENT_USER.user.toLowerCase();
                            if (nTrainee !== cUser && nUser !== cUser) return;
                        }

                        const idx = items.findIndex(i => (i.id && i.id.toString()) === newItem.id.toString());
                        if (idx > -1) {
                            // Local Edit Shield: Don't overwrite if local item is waiting in the save queue
                            const hashMap = safeLocalParse(`hash_map_${localKey}`, {}) || {};
                            const currentLocalHash = generateChecksum(JSON.stringify(items[idx]));
                            const syncedHash = hashMap[newItem.id];
                            if (syncedHash && currentLocalHash !== syncedHash) return; 
                            items[idx] = newItem;
                        } else {
                            items.push(newItem);
                        }
                    }
                });
                items = dedupeArrayByIdentity(localKey, items, 'server_wins');
                localStorage.setItem(localKey, JSON.stringify(items));
                emitDataChange(localKey, 'realtime');
            });
            
            // Soft UI Refreshes based on active view
            if (typeof loadAdminDatabase === 'function' && document.getElementById('admin-view-data')?.classList.contains('active')) loadAdminDatabase();
            if (typeof renderMonthly === 'function' && document.getElementById('monthly')?.classList.contains('active')) renderMonthly();
            if (typeof loadTestRecords === 'function' && document.getElementById('test-records')?.classList.contains('active')) loadTestRecords();
            if (typeof loadManageTests === 'function' && document.getElementById('test-manage')?.classList.contains('active')) loadManageTests();
            if (typeof loadMarkingQueue === 'function' && document.getElementById('test-manage')?.classList.contains('active')) loadMarkingQueue();
            if (typeof validateActiveMarkingModalLock === 'function') validateActiveMarkingModalLock();
        }

        // After processing, update the indicator with the current queue state.
        updateQueueIndicator();
    } catch (err) {
        INCOMING_DATA_QUEUE = queue.concat(INCOMING_DATA_QUEUE);
        console.error("Incoming realtime queue processing failed:", err);
        updateSyncUI('error');
        updateQueueIndicator();
    } finally {
        IS_PROCESSING_INCOMING_QUEUE = false;
        if (INCOMING_DATA_QUEUE.length > 0) {
            setTimeout(() => processIncomingDataQueue(), INCOMING_QUEUE_CONTINUE_DELAY_MS);
        }
    }
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

async function forceRefreshLiveSessionById(sessionId) {
    if (!sessionId || !window.supabaseClient) return false;
    try {
        const { data: row, error } = await window.supabaseClient
            .from('live_sessions')
            .select('id, data')
            .eq('id', sessionId)
            .maybeSingle();

        if (error || !row || !row.data || typeof row.data !== 'object') return false;

        const refreshed = { ...row.data };
        if (!refreshed.sessionId) refreshed.sessionId = row.id;

        let sessions = safeLocalParse('liveSessions', []) || [];
        sessions = sessions.filter(s => s.sessionId !== refreshed.sessionId);
        sessions.push(refreshed);
        localStorage.setItem('liveSessions', JSON.stringify(sessions));
        emitDataChange('liveSessions', 'session_nudge_refresh');

        if (typeof processLiveSessionState === 'function') processLiveSessionState(sessions);
        return true;
    } catch (err) {
        console.warn('forceRefreshLiveSessionById failed:', err);
        return false;
    }
}
window.forceRefreshLiveSessionById = forceRefreshLiveSessionById;

function applyVettingSessionNudgeCommand(rawAction) {
    try {
        const encoded = String(rawAction || '').replace(/^vetting_force:/, '');
        if (!encoded) return false;

        const payload = safeParse(decodeURIComponent(encoded), null);
        if (!payload || !payload.sessionId || !payload.active) return false;

        const currentUser = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) ? CURRENT_USER.user : '';
        if (!currentUser) return false;
        const normalizeIdentity = (value) => String(value || '').trim().toLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
        const isSameIdentity = (a, b) => {
            const na = normalizeIdentity(a);
            const nb = normalizeIdentity(b);
            if (!na || !nb) return false;
            if (na === nb) return true;
            return na.replace(/\s+/g, '') === nb.replace(/\s+/g, '');
        };

        const sessionData = {
            sessionId: payload.sessionId,
            active: true,
            testId: payload.testId || null,
            targetGroup: payload.targetGroup || 'all',
            startTime: payload.startTime || Date.now(),
            trainees: (payload.trainees && typeof payload.trainees === 'object') ? payload.trainees : {}
        };

        let sessions = safeLocalParse('adminVettingSessions', []) || [];
        sessions = Array.isArray(sessions) ? sessions : [];
        const idx = sessions.findIndex(s => s && s.sessionId === sessionData.sessionId);
        if (idx > -1) sessions[idx] = { ...sessions[idx], ...sessionData };
        else sessions.push(sessionData);
        localStorage.setItem('adminVettingSessions', JSON.stringify(sessions));

        const local = safeLocalParse('vettingSession', { active: false, trainees: {} }) || { active: false, trainees: {} };
        const sameSession = !!(local && local.sessionId && local.sessionId === sessionData.sessionId);
        const mergedTrainees = sameSession
            ? { ...(local.trainees || {}), ...(sessionData.trainees || {}) }
            : { ...(sessionData.trainees || {}) };

        Object.keys(mergedTrainees).forEach(key => {
            if (key !== currentUser && isSameIdentity(key, currentUser)) delete mergedTrainees[key];
        });

        if (!sameSession && mergedTrainees[currentUser] && String(mergedTrainees[currentUser].status || '').toLowerCase() === 'completed') {
            delete mergedTrainees[currentUser];
        }

        const merged = {
            ...local,
            ...sessionData,
            trainees: mergedTrainees
        };
        localStorage.setItem('vettingSession', JSON.stringify(merged));
        emitDataChange('vettingSession', 'command_nudge');

        if (typeof updateSidebarVisibility === 'function') updateSidebarVisibility();
        if (typeof applyRolePermissions === 'function') applyRolePermissions();
        safeRenderVettingArena();

        const myData = merged.trainees ? merged.trainees[currentUser] : null;
        if ((!myData || myData.status !== 'completed') && typeof showTab === 'function') {
            showTab('vetting-arena');
        }
        return true;
    } catch (e) {
        console.warn('Failed to apply vetting force command:', e);
        return false;
    }
}

function parseRecoveryPayload(rawAction) {
    const prefix = 'recover_submission:';
    if (!String(rawAction || '').startsWith(prefix)) return null;
    const raw = String(rawAction || '').slice(prefix.length).trim();
    if (!raw) return {};

    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch (e) {}

    const parsed = safeParse(decoded, null);
    if (parsed && typeof parsed === 'object') return parsed;
    return { testTitle: decoded };
}

function findGroupForUser(username) {
    try {
        const rosters = safeLocalParse('rosters', {}) || {};
        const target = String(username || '').trim().toLowerCase();
        for (const [groupId, members] of Object.entries(rosters)) {
            if (!Array.isArray(members)) continue;
            if (members.some(m => String(m || '').trim().toLowerCase() === target)) return groupId;
        }
    } catch (e) {}
    return 'Unknown';
}

function runTargetedSubmissionRecovery(rawAction) {
    const payload = parseRecoveryPayload(rawAction);
    if (!payload) return false;
    if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER || !CURRENT_USER.user) return false;

    const me = String(CURRENT_USER.user || '').trim().toLowerCase();
    const norm = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');

    let submissions = safeLocalParse('submissions', []) || [];
    if (!Array.isArray(submissions)) submissions = [];

    const wantedTitle = norm(payload.testTitle || '');
    const wantedContains = norm(payload.titleContains || '');
    const wantedTestId = String(payload.testId || '').trim();
    const wantedSubmissionIds = Array.isArray(payload.submissionIds)
        ? new Set(payload.submissionIds.map(v => String(v)))
        : null;
    const includeArchived = !!payload.includeArchived;

    const matches = submissions.filter((s) => {
        if (norm(s.trainee) !== me) return false;
        if (!includeArchived && s.archived) return false;
        if (wantedSubmissionIds && wantedSubmissionIds.size > 0 && !wantedSubmissionIds.has(String(s.id))) return false;
        if (wantedTestId && String(s.testId || '') !== wantedTestId) return false;

        const title = norm(s.testTitle || '');
        if (wantedTitle && title !== wantedTitle) return false;
        if (wantedContains && !title.includes(wantedContains)) return false;
        return true;
    });

    if (!matches.length) {
        if (typeof showToast === 'function') showToast('Recovery command found no local submissions to sync.', 'warning');
        return true;
    }

    const nowIso = new Date().toISOString();
    let records = safeLocalParse('records', []) || [];
    if (!Array.isArray(records)) records = [];

    let changed = false;
    for (const sub of matches) {
        const recordId = `record_${sub.id}`;
        const idx = records.findIndex(r => r && (r.submissionId === sub.id || r.id === recordId));
        if (idx > -1) continue;

        const groupId = findGroupForUser(sub.trainee || CURRENT_USER.user);
        const cycleVal = (typeof getTraineeCycle === 'function')
            ? getTraineeCycle(sub.trainee || CURRENT_USER.user, groupId)
            : 'New Onboard';
        const phaseVal = String(sub.testTitle || '').toLowerCase().includes('vetting') ? 'Vetting' : 'Assessment';
        const createdAt = sub.createdAt || sub.lastModified || nowIso;
        const scoreVal = Number.isFinite(Number(sub.score)) ? Number(sub.score) : 0;

        records.push({
            id: recordId,
            groupID: groupId,
            trainee: sub.trainee || CURRENT_USER.user,
            assessment: sub.testTitle || '',
            score: scoreVal,
            date: sub.date || nowIso.split('T')[0],
            phase: phaseVal,
            cycle: cycleVal,
            link: 'Digital-Assessment',
            docSaved: true,
            submissionId: sub.id,
            createdAt,
            lastModified: nowIso,
            modifiedBy: CURRENT_USER.user
        });
        changed = true;
    }

    if (changed) localStorage.setItem('records', JSON.stringify(records));

    if (typeof saveToServer === 'function') {
        saveToServer(['submissions', 'records'], true, true).catch(() => {});
    }
    if (typeof showToast === 'function') {
        showToast(`Recovery queued ${matches.length} submission(s) for sync.`, 'success');
    }
    return true;
}

function executePendingSessionAction(rawAction) {
    const action = String(rawAction || '');
    if (!action) return false;

    if (action === 'logout') {
        if (typeof logout === 'function') logout();
        return true;
    }
    if (action === 'restart') {
        if (typeof triggerForceRestart === 'function') triggerForceRestart();
        else if (typeof location !== 'undefined') location.reload();
        return true;
    }
    if (action === 'force_update') {
        if (typeof require !== 'undefined') {
            sessionStorage.setItem('force_update_active', 'true');
            require('electron').ipcRenderer.send('manual-update-check');
            if(typeof showToast === 'function') showToast("System Update Check Initiated by Admin", "info");
        }
        return true;
    }
    if (action.startsWith('msg:')) {
        alert("💬 ADMIN MESSAGE:\n\n" + action.replace('msg:', ''));
        return true;
    }
    if (action.startsWith('live_sync:')) {
        const parts = action.split(':');
        const targetSessionId = parts[1] || '';
        if (targetSessionId) forceRefreshLiveSessionById(targetSessionId).catch(()=>{});
        return true;
    }
    if (action.startsWith('vetting_force:')) {
        applyVettingSessionNudgeCommand(action);
        return true;
    }
    if (action === 'fix_submission') {
        let s = safeLocalParse('submissions', []) || [];
        s.forEach(x => x.archived = true);
        localStorage.setItem('submissions', JSON.stringify(s));

        if(typeof restoreAssessmentDraft === 'function') restoreAssessmentDraft();
        setTimeout(() => { if(typeof submitTest === 'function') submitTest(true); }, 1000);
        if(typeof showToast === 'function') showToast("System Auto-Recovery: Draft submitted.", "success");
        return true;
    }
    if (action.startsWith('recover_submission:')) {
        return runTargetedSubmissionRecovery(action);
    }
    return false;
}

function handleSessionRealtime(payload) {
    const eventType = payload.eventType;
    const row = payload.new || payload.old;
    if (row && (row.username || row.user)) {
        const uName = row.username || row.user;

        if (eventType === 'DELETE') {
            if (window.ACTIVE_USERS_CACHE && window.ACTIVE_USERS_CACHE[uName]) {
                delete window.ACTIVE_USERS_CACHE[uName];
            }
        } else {
            if (!window.ACTIVE_USERS_CACHE) window.ACTIVE_USERS_CACHE = {};
            window.ACTIVE_USERS_CACHE[uName] = {
                ...(window.ACTIVE_USERS_CACHE[uName] || {}),
                username: uName,
                user: uName,
                role: row.role || (window.ACTIVE_USERS_CACHE[uName] && window.ACTIVE_USERS_CACHE[uName].role) || '-',
                idleTime: Number.isFinite(row.idleTime) ? row.idleTime : ((window.ACTIVE_USERS_CACHE[uName] && window.ACTIVE_USERS_CACHE[uName].idleTime) || 0),
                isIdle: typeof row.isIdle === 'boolean' ? row.isIdle : ((window.ACTIVE_USERS_CACHE[uName] && window.ACTIVE_USERS_CACHE[uName].isIdle) || false),
                version: row.version || (window.ACTIVE_USERS_CACHE[uName] && window.ACTIVE_USERS_CACHE[uName].version) || '-',
                clientId: row.clientId || (window.ACTIVE_USERS_CACHE[uName] && window.ACTIVE_USERS_CACHE[uName].clientId) || 'Unknown',
                activity: row.activity || (window.ACTIVE_USERS_CACHE[uName] && window.ACTIVE_USERS_CACHE[uName].activity) || '-',
                lastSeen: row.lastSeen || new Date().toISOString(),
                local_received_at: Date.now()
            };
        }

        if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && uName === CURRENT_USER.user) {
            const pendingAction = payload.new && payload.new.pending_action;
            if (pendingAction) {
                if (window.supabaseClient) window.supabaseClient.from('sessions').update({ pending_action: null }).eq('username', uName).then(()=>{});
                executePendingSessionAction(pendingAction);
            }
        }
    }
}

function handleAppDocumentRealtime(payload) {
    INCOMING_DATA_QUEUE.push({ type: 'app_documents', payload });
    updateQueueIndicator();
}

function applyGenericRowRealtimePayload(payload) {
    const localKey = Object.keys(ROW_MAP).find(k => ROW_MAP[k] === payload.table);
    if (!localKey) return false;

    let items = safeLocalParse(localKey, []) || [];
    const isTrainee = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.role === 'trainee');

    if (payload.eventType === 'DELETE') {
        items = items.filter(i => (i.id && i.id.toString()) !== payload.old.id.toString());
    } else {
        if (!payload.new?.data) return false;
        const newItem = payload.new.data;
        if (!newItem.id) newItem.id = payload.new.id;

        if (isTrainee && ['records', 'submissions', 'exemptions', 'linkRequests'].includes(localKey)) {
            const nTrainee = (newItem.trainee || '').toLowerCase();
            const nUser = (newItem.user || '').toLowerCase();
            const cUser = CURRENT_USER.user.toLowerCase();
            if (nTrainee !== cUser && nUser !== cUser) return false;
        }

        const idx = items.findIndex(i => (i.id && i.id.toString()) === newItem.id.toString());
        if (idx > -1) items[idx] = newItem;
        else items.push(newItem);
    }

    items = dedupeArrayByIdentity(localKey, items, 'server_wins');
    localStorage.setItem(localKey, JSON.stringify(items));
    emitDataChange(localKey, 'realtime');
    return true;
}

function refreshSubmissionDrivenUI() {
    if (typeof document === 'undefined') return;

    const isTyping = typeof isUserTyping === 'function' ? isUserTyping() : false;
    const isActiveView = (id) => !!document.getElementById(id)?.classList.contains('active');

    if (isActiveView('dashboard-view') && !isTyping && typeof renderDashboard === 'function') {
        renderDashboard();
    }

    if (isActiveView('my-tests') && typeof loadTraineeTests === 'function') {
        loadTraineeTests();
    }

    if (isActiveView('test-records') && typeof loadTestRecords === 'function') {
        loadTestRecords();
    }

    if (isActiveView('test-manage') && !isTyping) {
        if (typeof loadAssessmentDashboard === 'function') loadAssessmentDashboard();
        if (typeof loadManageTests === 'function') loadManageTests();
        if (typeof loadMarkingQueue === 'function') loadMarkingQueue();
        if (typeof loadCompletedHistory === 'function' && !document.getElementById('engine-view-history')?.classList.contains('hidden')) {
            loadCompletedHistory();
        }
    }

    if (typeof validateActiveMarkingModalLock === 'function') validateActiveMarkingModalLock();
}

function handleRowRealtime(payload) {
    if (payload.table === 'submissions' && applyGenericRowRealtimePayload(payload)) {
        refreshSubmissionDrivenUI();
        updateQueueIndicator();
        return;
    }
    INCOMING_DATA_QUEUE.push({ type: 'generic_rows', payload });
    updateQueueIndicator();
}

const LIVE_SESSION_RECOVERY_WINDOW_MS = 2500;
const LIVE_SESSION_RECOVERY_TS = {};

async function recoverLiveSessionRow(rowId) {
    if (!rowId || !window.supabaseClient) return false;
    const now = Date.now();
    if (LIVE_SESSION_RECOVERY_TS[rowId] && (now - LIVE_SESSION_RECOVERY_TS[rowId]) < LIVE_SESSION_RECOVERY_WINDOW_MS) {
        return false;
    }
    LIVE_SESSION_RECOVERY_TS[rowId] = now;

    try {
        const { data: row, error } = await window.supabaseClient
            .from('live_sessions')
            .select('id, data')
            .eq('id', rowId)
            .maybeSingle();

        if (error || !row || !row.data || typeof row.data !== 'object') {
            return false;
        }

        const recovered = { ...row.data };
        if (!recovered.sessionId) recovered.sessionId = row.id;

        let allSessions = safeLocalParse('liveSessions', []) || [];
        allSessions = allSessions.filter(s => s.sessionId !== recovered.sessionId);
        allSessions.push(recovered);
        localStorage.setItem('liveSessions', JSON.stringify(allSessions));
        window.LIVE_LAST_CACHE_EVENT_AT = Date.now();
        emitDataChange('liveSessions', 'realtime_partial_recovery');

        if (typeof processLiveSessionState === 'function') processLiveSessionState(allSessions);
        return true;
    } catch (err) {
        console.warn('Live session partial recovery failed:', err);
        return false;
    }
}

function handleLiveSessionRealtime(payload) {
    // INSTANT PROCESSING (Bypass Queue for Zero Latency)
    let allSessions = safeLocalParse('liveSessions', []) || [];
    if (payload.eventType === 'DELETE') {
        allSessions = allSessions.filter(s => s.sessionId !== payload.old.id);
    } else {
        const incoming = payload && payload.new ? payload.new : null;
        const hasDataObject = incoming && incoming.data && typeof incoming.data === 'object';
        if (!hasDataObject) {
            const fallbackId = (incoming && incoming.id) || (payload.old && payload.old.id) || null;
            if (fallbackId) recoverLiveSessionRow(fallbackId).catch(() => {});
            return;
        }

        const newData = { ...incoming.data };
        if (!newData.sessionId) newData.sessionId = incoming.id;
        allSessions = allSessions.filter(s => s.sessionId !== newData.sessionId);
        allSessions.push(newData);
    }
    localStorage.setItem('liveSessions', JSON.stringify(allSessions));
    window.LIVE_LAST_CACHE_EVENT_AT = Date.now();
    emitDataChange('liveSessions', 'realtime');
    
    // Update Live Execution UI instantly if open
    if (typeof processLiveSessionState === 'function') processLiveSessionState(allSessions);

    // SOFT UPDATE: Only update the banner
    const dashView = document.getElementById('dashboard-view');
    if (dashView && dashView.classList.contains('active') && typeof updateLiveBannerUI === 'function') {
        updateLiveBannerUI();
    }
}

function handleVettingRealtime(payload) {
    // INSTANT PROCESSING (Bypass Queue for Zero Latency)
    let sessions = safeLocalParse('adminVettingSessions', []) || [];
    if (payload.eventType === 'DELETE') {
        sessions = sessions.filter(s => s.sessionId !== payload.old.id);
        const local = safeLocalParse('vettingSession', {}) || {};
        if (local.sessionId === payload.old.id && typeof handleVettingUpdate === 'function') {
            handleVettingUpdate({ active: false });
        }
    } else {
        const newData = payload.new.data;
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
    localStorage.setItem('adminVettingSessions', JSON.stringify(sessions));
    
    safeRenderVettingArena();
}

let _vettingRenderTimer = null;
function safeRenderVettingArena() {
    const runtimeV2 = document.querySelector('#vetting-arena-content .vetting-rework-webview');
    if (runtimeV2) return; // Vetting Arena 2.0 owns this surface.

    const activeTab = document.querySelector('section.active');
    if (
        activeTab &&
        activeTab.id === 'vetting-arena' &&
        CURRENT_USER &&
        CURRENT_USER.role === 'trainee' &&
        window.VettingRuntimeV2 &&
        typeof window.VettingRuntimeV2.renderTraineeArena === 'function'
    ) {
        if (document.getElementById('arenaTestContainer')) return; // Never wipe active test surface.
        if (isUserTyping()) {
            // Defer non-critical rerenders while user is typing.
            if (_vettingRenderTimer) clearTimeout(_vettingRenderTimer);
            _vettingRenderTimer = setTimeout(safeRenderVettingArena, 1000);
        } else {
            window.VettingRuntimeV2.renderTraineeArena();
        }
    }
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
            retrain_archives: [],
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
        hardDelete,
        hardDeleteByQuery,
        notifyUnsavedChanges,
        logAuditAction,
        reportSystemError,
        forceFullSync
    };
}



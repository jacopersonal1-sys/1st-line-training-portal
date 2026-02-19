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
        sync_rates: { admin: 10000, teamleader: 300000, trainee: 60000 },
        heartbeat_rates: { admin: 5000, default: 60000 },
        idle_thresholds: { warning: 60000, logout: 900000 },
        attendance: { work_start: "08:00", late_cutoff: "08:15", work_end: "17:00", reminder_start: "16:45", allow_weekend_login: false },
        security: { maintenance_mode: false, min_version: "0.0.0", force_kiosk_global: false, allowed_ips: [], banned_clients: [], client_whitelist: [] },
        features: { vetting_arena: true, live_assessments: true, nps_surveys: true, daily_tips: true, disable_animations: false },
        monitoring: { tolerance_ms: 180000, whitelist_strict: false },
        announcement: { active: false, message: "", type: "info" },
        broadcast: { id: 0, message: "" }
    },
    revokedUsers: [], // Added to ensure blacklist syncs
    auditLogs: [], // Critical Action History
    accessLogs: [], // Login/Logout/Timeout History
    vettingSession: { active: false, testId: null, trainees: {} }, // Vetting Arena State
    linkRequests: [], // Requests from TLs for assessment links
    agentNotes: {}, // Private notes on agents { "username": "note content" }
    liveSessions: [], // CHANGED: Array to support multiple concurrent sessions
    forbiddenApps: [], // Dynamic list of blacklisted processes
    monitor_data: {}, // Real-time activity tracking { username: { current, history: [] } }
    monitor_history: [], // Archived daily activity logs
    nps_surveys: [], // Admin defined surveys
    nps_responses: [], // Trainee responses
    graduated_agents: [], // Archived data for graduated trainees
    monitor_whitelist: [], // Custom whitelist for work-related apps
    monitor_reviewed: [], // Apps confirmed as External/Idle (Dismissed from queue)
    dailyTips: [] // Admin controlled daily tips
};

// --- GLOBAL INTERACTION TRACKER ---
window.LAST_INTERACTION = Date.now();
window.CURRENT_LATENCY = 0; // Track latency for health reporting
['click', 'mousemove', 'keydown', 'scroll', 'touchstart'].forEach(evt => {
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

// 2. Load Data (UPDATED: SMART SPLIT SYNC)
// Only downloads keys that have changed on the server.
async function loadFromServer(silent = false) {
    try {
        if (window.supabaseClient) updateSyncUI('syncing');
        if (!window.supabaseClient) return;

        const start = Date.now();
        // A. Fetch Metadata (Timestamps) for all keys
        const { data: meta, error } = await supabaseClient
            .from('app_documents')
            .select('key, updated_at');
        window.CURRENT_LATENCY = Date.now() - start; // Measure RTT
        
        if (error) throw error;

        // B. Migration Check: If new table is empty, try to migrate from old table
        if (!meta || meta.length === 0) {
            await migrateToSplitSchema();
            return;
        }

        // C. Identify Stale Keys
        const keysToFetch = [];
        meta.forEach(row => {
            const localTs = localStorage.getItem('sync_ts_' + row.key);
            // If we don't have it, or server is newer, fetch it
            if (!localTs || new Date(row.updated_at) > new Date(localTs)) {
                keysToFetch.push(row.key);
            }
        });

        // D. Fetch Content for Stale Keys Only
        if (keysToFetch.length > 0) {
            if(!silent) console.log(`Syncing updates for: ${keysToFetch.join(', ')}`);
            
            const { data: docs, error: fetchErr } = await supabaseClient
                .from('app_documents')
                .select('key, content, updated_at')
                .in('key', keysToFetch);
            
            if (fetchErr) throw fetchErr;

            // UPDATED: Use for...of to allow await (Conflict Modal)
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

            // HOT RELOAD: Apply system config changes immediately
            if (keysToFetch.includes('system_config')) applySystemConfig();
            
            // Refresh UI if needed
            if(silent && typeof refreshAllDropdowns === 'function') {
                const timeSinceInteraction = Date.now() - (window.LAST_INTERACTION || 0);
                if (!isUserTyping() && timeSinceInteraction > 5000) {
                    refreshAllDropdowns();
                }
            }
            // STABILITY FIX: Re-apply permissions to show/hide dynamic tabs like Vetting Arena
            if (silent && typeof applyRolePermissions === 'function') {
                applyRolePermissions();
            }
            updateSyncUI('success');
        } else {
            if(!silent) console.log("System up to date.");
            updateSyncUI('success');
        }

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

// 3. SMART SAVE (Using supabaseClient)
// UPDATED: Accepts 'targetKeys' array to save only specific parts (e.g. ['users'])
async function saveToServer(targetKeys = null, force = false, silent = false, retryCount = 0) {
    try {
        // Legacy support: if first arg is boolean, treat as force for ALL keys
        if (typeof targetKeys === 'boolean') {
            force = targetKeys;
            targetKeys = null; // Save all
        }

        if (!window.supabaseClient) {
            console.warn("Supabase client not ready. Offline?");
            if(!silent) updateSyncUI('error');
            return;
        }

        // A. Get Local Data
        // If targetKeys is null, we save EVERYTHING (Heavy, use sparingly)
        const keysToSave = targetKeys || Object.keys(DB_SCHEMA);

        if(!silent) updateSyncUI('busy');

        for (const key of keysToSave) {
            const localContent = JSON.parse(localStorage.getItem(key)) || DB_SCHEMA[key];
            let finalContent = localContent;

            // B. Optimistic Lock / Merge (Per Key)
            if (!force) {
                const { data: remoteRow } = await supabaseClient
                    .from('app_documents')
                    .select('content')
                    .eq('key', key)
                    .single();
                
                if (remoteRow && remoteRow.content) {
                    // Merge just this key's data
                    // We wrap in objects to reuse existing merge logic
                    const serverObj = { [key]: remoteRow.content };
                    const localObj = { [key]: localContent };
                    const mergedObj = performSmartMerge(serverObj, localObj, 'local_wins');
                    finalContent = mergedObj[key];
                }
            }

            // C. Push to Supabase
            // UPDATED: Use .select() to get the REAL server timestamp
            const { data: savedData, error: saveErr } = await supabaseClient
                .from('app_documents')
                .upsert({ 
                    key: key, 
                    content: finalContent,
                    updated_at: new Date().toISOString()
                })
                .select();

            if (saveErr) throw saveErr;
            
            // Update Local Cache Timestamp
            localStorage.setItem(key, JSON.stringify(finalContent));
            
            // ACCURACY FIX: Use Server Time, not Client Time
            if(savedData && savedData[0]) {
                localStorage.setItem('sync_ts_' + key, savedData[0].updated_at);
            } else {
                localStorage.setItem('sync_ts_' + key, new Date().toISOString());
            }
        }

        console.log(`Synced keys: ${keysToSave.join(', ')}`);
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
                        return (
                            localItem.trainee.toLowerCase() === serverItem.trainee.toLowerCase() &&
                            (localItem.assessment||'').toLowerCase() === (serverItem.assessment||'').toLowerCase() &&
                            localItem.groupID === serverItem.groupID &&
                            localItem.phase === serverItem.phase
                        );
                    }

                    // 6. Live Sessions (Unique by sessionId) - FIXES LIVE ARENA CRASH
                    if (key === 'liveSessions' && localItem.sessionId && serverItem.sessionId) {
                        return localItem.sessionId === serverItem.sessionId;
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
        }
        // Case 2b: Monitor Data (User-Specific Merge)
        // Prevents "War for Data" where local stale data overwrites other users' fresh server data
        else if (key === 'monitor_data' && typeof sVal === 'object' && typeof lVal === 'object') {
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
    const start = Date.now();
    try {
        if (!window.supabaseClient) return;

        // Estimate storage size from LocalStorage
        let storageSize = 0;
        for(let key in localStorage) {
            if(localStorage.hasOwnProperty(key)) storageSize += localStorage[key].length;
        }
        
        const twoMinutesAgo = new Date(Date.now() - 120000).toISOString();
        const { data: activeUsers, error } = await supabaseClient
            .from('sessions')
            .select('*')
            .gte('lastSeen', twoMinutesAgo);

        const end = Date.now();
        const latency = end - start;

        if (!error) {
            const storageEl = document.getElementById('statusStorage');
            const latencyEl = document.getElementById('statusLatency');
            const activeTable = document.getElementById('activeUsersTable');

            const memoryEl = document.getElementById('statusMemory');
            const connEl = document.getElementById('statusConnection');
            const platformEl = document.getElementById('statusPlatform');

            if (storageEl && typeof formatBytes === 'function') {
                storageEl.innerText = formatBytes(storageSize);
            }

            if (latencyEl) {
                latencyEl.innerText = latency + " ms";
                latencyEl.style.color = latency < 200 ? "#2ecc71" : (latency < 500 ? "orange" : "#ff5252");
            }

            // --- NEW DIAGNOSTICS ---
            if (memoryEl && performance && performance.memory) {
                const used = performance.memory.usedJSHeapSize;
                memoryEl.innerText = formatBytes(used);
            }
            
            if (connEl && navigator.connection) {
                connEl.innerText = navigator.connection.effectiveType.toUpperCase();
            } else if (connEl) {
                connEl.innerText = navigator.onLine ? "ONLINE" : "OFFLINE";
            }
            
            if (platformEl) {
                const os = (navigator.userAgentData && navigator.userAgentData.platform) ? navigator.userAgentData.platform : navigator.platform;
                platformEl.innerText = os;
            }

            if (activeTable) {
                let html = '';
                if(!activeUsers || activeUsers.length === 0) {
                      html = '<tr><td colspan="6" class="text-center">No active users detected.</td></tr>';
                } else {
                    activeUsers.forEach(u => {
                        const idleStr = typeof formatDuration === 'function' 
                            ? formatDuration(u.idleTime) 
                            : (u.idleTime/1000).toFixed(0) + 's';
                        
                        const verStr = u.version || '-';
                        
                        const statusBadge = u.isIdle
                            ? '<span class="status-badge status-fail">Idle</span>'
                            : '<span class="status-badge status-pass">Active</span>';
                        
                        const rowClass = u.isIdle ? 'user-idle' : '';

                        html += `
                            <tr class="${rowClass}">
                                <td><strong>${u.user}</strong></td>
                                <td style="font-size:0.8rem; color:var(--text-muted);">${verStr}</td>
                                <td>${u.role}</td>
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
    } catch (e) {
        console.error("Supabase Status fetch error", e);
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
        // 1. Send Heartbeat with Version
        await supabaseClient
            .from('sessions')
            .upsert({
                user: CURRENT_USER.user,
                role: CURRENT_USER.role,
                version: window.APP_VERSION || 'Unknown',
                idleTime: diff,
                isIdle: isIdle,
                lastSeen: new Date().toISOString(),
                clientId: clientId,
                activity: currentActivity
            });
            
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
            const limitMs = idleConf.logout;
            if ((Date.now() - last) > limitMs) {
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
        logAuditAction
    };
}

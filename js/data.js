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
    revokedUsers: [] // Added to ensure blacklist syncs
};

// --- GLOBAL INTERACTION TRACKER ---
window.LAST_INTERACTION = Date.now();
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

// 2. Load Data (UPDATED: SMART SPLIT SYNC)
// Only downloads keys that have changed on the server.
async function loadFromServer(silent = false) {
    try {
        if (window.supabaseClient) updateSyncUI('syncing');
        if (!window.supabaseClient) return;

        // A. Fetch Metadata (Timestamps) for all keys
        const { data: meta, error } = await supabaseClient
            .from('app_documents')
            .select('key, updated_at');
        
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

            docs.forEach(doc => {
                localStorage.setItem(doc.key, JSON.stringify(doc.content));
                localStorage.setItem('sync_ts_' + doc.key, doc.updated_at);
            });
            
            // Refresh UI if needed
            if(silent && typeof refreshAllDropdowns === 'function') {
                const timeSinceInteraction = Date.now() - (window.LAST_INTERACTION || 0);
                if (!isUserTyping() && timeSinceInteraction > 5000) {
                    refreshAllDropdowns();
                }
            }
            updateSyncUI('success');
        } else {
            if(!silent) console.log("System up to date.");
            updateSyncUI('success');
        }

    } catch (err) { 
        updateSyncUI('error');
        if(!silent) console.error("Supabase Load Error:", err);
    }
}

// MIGRATION: One-time move from 'app_data' (Blob) to 'app_documents' (Split)
async function migrateToSplitSchema() {
    console.log("Migrating to Split Schema...");
    // Save all current local keys to the new table
    await saveToServer(null, true); 
    console.log("Migration Complete.");
}

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
        el.innerHTML = '<i class="fas fa-exclamation-circle" style="color:#ff5252;"></i> Sync Failed';
    }
}

// 3. SMART SAVE (Using supabaseClient)
// UPDATED: Accepts 'targetKeys' array to save only specific parts (e.g. ['users'])
async function saveToServer(targetKeys = null, force = false) {
    try {
        // Legacy support: if first arg is boolean, treat as force for ALL keys
        if (typeof targetKeys === 'boolean') {
            force = targetKeys;
            targetKeys = null; // Save all
        }

        if (!window.supabaseClient) {
            console.warn("Supabase client not ready. Offline?");
            updateSyncUI('error');
            return;
        }

        // A. Get Local Data
        // If targetKeys is null, we save EVERYTHING (Heavy, use sparingly)
        const keysToSave = targetKeys || Object.keys(DB_SCHEMA);

        updateSyncUI('busy');

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
                    const mergedObj = performSmartMerge(serverObj, localObj);
                    finalContent = mergedObj[key];
                }
            }

            // C. Push to Supabase
            const { error: saveErr } = await supabaseClient
                .from('app_documents')
                .upsert({ 
                    key: key, 
                    content: finalContent,
                    updated_at: new Date().toISOString()
                });

            if (saveErr) throw saveErr;
            
            // Update Local Cache Timestamp
            localStorage.setItem(key, JSON.stringify(finalContent));
            localStorage.setItem('sync_ts_' + key, new Date().toISOString());
        }

        console.log(`Synced keys: ${keysToSave.join(', ')}`);
        updateSyncUI('success');
        if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();

    } catch (err) {
        updateSyncUI('error');
        console.error("Cloud Sync Error:", err);
        if(typeof showToast === 'function') showToast("Save Failed: " + err.message, 'error');
    }
}

// --- HELPER: MERGE LOGIC (Crucial for Data Integrity) ---
// UPDATED: Improved deduplication logic to prevent "10 copies" bug
function performSmartMerge(server, local) {
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

                    // 4. Vetting Topics (Strings) - FIXES TOPIC DUPLICATION
                    if (key === 'vettingTopics' && typeof localItem === 'string' && typeof serverItem === 'string') {
                        return localItem.trim().toLowerCase() === serverItem.trim().toLowerCase();
                    }

                    // 5. RECORDS (Composite Key) - FIXES SCORE DUPLICATION
                    // Fallback for legacy records that might not have IDs yet
                    if (key === 'records' && localItem.trainee && serverItem.trainee) {
                        return (
                            localItem.trainee === serverItem.trainee &&
                            localItem.assessment === serverItem.assessment &&
                            localItem.groupID === serverItem.groupID &&
                            localItem.phase === serverItem.phase
                        );
                    }

                    // 6. Fallback: Deep Compare
                    return JSON.stringify(localItem) === JSON.stringify(serverItem);
                });

                if (!exists) {
                    combined.push(localItem); // Keep local item if missing on server
                } else {
                    // Update: Prefer local version (it might be an edit/status change)
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
                        return JSON.stringify(i) === JSON.stringify(localItem);
                    });
                    if(index > -1) combined[index] = localItem;
                }
            });

            // --- DELETION FIX: Users ---
            if (key === 'users' && blacklist.length > 0) {
                combined = combined.filter(u => !blacklist.includes(u.user));
            }

            merged[key] = combined;
        } 
        // Case 2: Objects (Rosters, Schedules)
        else if (typeof sVal === 'object' && sVal !== null && typeof lVal === 'object' && lVal !== null) {
            merged[key] = { ...sVal, ...lVal };
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

// 5. SUPABASE: Send Heartbeat
async function sendHeartbeat() {
    if (!CURRENT_USER || !window.supabaseClient) return;
    
    const last = window.LAST_INTERACTION || Date.now();
    const now = Date.now();
    const diff = now - last;
    const limit = (typeof IDLE_THRESHOLD !== 'undefined') ? IDLE_THRESHOLD : 60000;
    const isIdle = diff > limit;

    try {
        // 1. Send Heartbeat with Version
        const { error } = await supabaseClient
            .from('sessions')
            .upsert({
                user: CURRENT_USER.user,
                role: CURRENT_USER.role,
                version: window.APP_VERSION || 'Unknown',
                idleTime: diff,
                isIdle: isIdle,
                lastSeen: new Date().toISOString()
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

function importDatabase(input) {
    const file = input.files[0];
    if(!file) return;
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            
            Object.keys(data).forEach(key => {
                if (typeof data[key] === 'object') {
                    localStorage.setItem(key, JSON.stringify(data[key]));
                } else {
                    localStorage.setItem(key, data[key]);
                }
            });

            console.log("Restoring backup to cloud...");
            await saveToServer();

            alert("Database restored successfully.");
            location.reload();
        } catch (err) {
            console.error(err);
            alert("Error parsing JSON file.");
        }
    };
    reader.readAsText(file);
}

function exportDatabase() {
    const d = {};
    Object.keys(DB_SCHEMA).forEach(k => {
        d[k] = JSON.parse(localStorage.getItem(k)) || DB_SCHEMA[k];
    });
    
    d.theme = localStorage.getItem('theme') || 'dark';
    d.autoBackup = localStorage.getItem('autoBackup') || 'false';
  
    const b = new Blob([JSON.stringify(d,null,2)],{type:'application/json'}); 
    const a = document.createElement('a'); 
    a.href = URL.createObjectURL(b); 
    a.download = "1stLine_Backup_" + new Date().toISOString().slice(0,10) + ".json"; 
    document.body.appendChild(a); 
    a.click(); 
    document.body.removeChild(a); 
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

function startRealtimeSync() {
    if (SYNC_INTERVAL) clearInterval(SYNC_INTERVAL);
    if (HEARTBEAT_INTERVAL_ID) clearInterval(HEARTBEAT_INTERVAL_ID);

    // Default Rates (Trainee/Guest)
    let syncRate = 60000; // 1 Minute
    let beatRate = 30000; // 30 Seconds

    // Role-Based Adjustment
    if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) {
        if (CURRENT_USER.role === 'admin') {
            syncRate = 10000; // 10 Seconds (High Speed for Admin)
            beatRate = 15000;
        } else if (CURRENT_USER.role === 'teamleader') {
            syncRate = 300000; // 5 Minutes (Save Bandwidth)
            beatRate = 60000;  // 1 Minute
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
        
        if(CURRENT_USER && CURRENT_USER.role === 'admin') {
            const statusView = document.getElementById('admin-view-status');
            if(statusView && statusView.offsetParent !== null) {
                fetchSystemStatus();
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
            revokedUsers: []
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
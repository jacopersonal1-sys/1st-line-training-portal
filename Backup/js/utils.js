/* ================= UTILITIES & HELPERS ================= */

// --- NEW: Formatters for System Status ---
function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function formatDuration(ms) {
    if (ms < 1000) return "Just now";
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return minutes > 0 
        ? `${minutes}m ${seconds}s` 
        : `${seconds}s`;
}

// --- SECURITY: HASHING HELPER ---
/**
 * Hashes a plaintext password using SHA-256.
 * Returns the hex string of the hash.
 * Used by auth.js and admin_users.js.
 */
async function hashPassword(plainText) {
    if (!plainText) return "";
    const msgBuffer = new TextEncoder().encode(plainText);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- EXISTING UTILITIES ---

function getGroupLabel(groupId, count) {
    if(!groupId) return "Unknown";
    
    // FETCH NAMES: Get the roster to display member names
    // Note: We access localStorage directly because data.js keeps it synced
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    const members = rosters[groupId] || [];
    
    // LOGIC: Create a comma-separated string of names (truncated for safety)
    let namesDisplay = "";
    if (members.length > 0) {
        // Show first 3 names, then "+ X more" to prevent huge dropdowns
        const preview = members.slice(0, 3).join(", ");
        const remaining = members.length - 3;
        const suffix = remaining > 0 ? `, +${remaining} others` : '';
        namesDisplay = ` [${preview}${suffix}]`;
    }

    // Check if it's a date-based ID (YYYY-MM or YYYY-MM-X)
    if(groupId.match(/^\d{4}-\d{2}$/) || groupId.match(/^\d{4}-\d{2}-[A-Z]$/)) {
        const parts = groupId.split('-');
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]);
        const suffix = parts[2] ? ` (Group ${parts[2]})` : '';
        
        const date = new Date(year, month - 1);
        const monthName = date.toLocaleString('default', { month: 'long' });
        
        // Return Month + Year + Suffix + Names
        return `${monthName} ${year}${suffix}${namesDisplay}`;
    }
    
    // Fallback for non-standard IDs
    return `${groupId}${namesDisplay}`;
}

function toggleTheme() {
    const isDark = document.body.classList.toggle('light-mode'); 
    localStorage.setItem('theme', document.body.classList.contains('light-mode') ? 'light' : 'dark');
}

function loadAdminTheme() {
    const theme = localStorage.getItem('theme') || 'dark';
    if (theme === 'light') {
        document.body.classList.add('light-mode');
    } else {
        document.body.classList.remove('light-mode');
    }
}

function refreshApp() {
    location.reload();
}

/* ================= MIGRATION TOOLS ================= */

// UPDATED: Async Migration Save
async function migrateData() {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    let changed = false;
    
    users.forEach(u => {
        if(!u.role) { u.role = 'trainee'; changed = true; }
        // Ensure theme object exists
        if(!u.theme) { u.theme = { primaryColor: '', wallpaper: '' }; changed = true; }
    });
    
    if(changed) {
        localStorage.setItem('users', JSON.stringify(users));
        console.log("Data Migration Applied. Syncing changes to server...");
        
        // --- SECURE SAVE ---
        // Ensure the fixes are written to the server immediately (Force Sync)
        if (typeof saveToServer === 'function') {
            try {
                // UPDATED: Use force=true for instant migration persistence
                await saveToServer(true);
                console.log("Migration synced successfully.");
            } catch(e) {
                console.error("Migration Sync Failed:", e);
            }
        }
    }
}

/* ================= DYNAMIC CYCLE LOGIC ================= */
function getTraineeCycle(traineeName, currentGroupId) {
    if(!traineeName || !currentGroupId) return "New Onboard";

    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    const allGroups = Object.keys(rosters).sort(); 
    
    let previousCount = 0;
    
    for (const gid of allGroups) {
        if (gid === currentGroupId) break; 
        
        if (rosters[gid].includes(traineeName)) {
            previousCount++;
        }
    }

    if (previousCount === 0) return "New Onboard";
    if (previousCount === 1) return "Retrain 1";
    if (previousCount === 2) return "Retrain 2";
    return "Retrain " + previousCount;
}
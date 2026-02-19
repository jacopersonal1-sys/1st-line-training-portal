/* ================= ADMIN: SYSTEM CORE & CONFIGURATION ================= */
/* Responsibility: Global Settings, Database Management, Security, and Helpers */

// --- HELPER: ASYNC SAVE (CORE) ---
// UPDATED: Now performs an "Instant" save (Force Overwrite) as requested.
// This skips the "Fetch & Merge" step to make admin actions faster and authoritative.
async function secureSysSave() {
    if (typeof saveToServer === 'function') {
        const btn = document.activeElement;
        let originalText = "";
        
        if(btn && btn.tagName === 'BUTTON') {
            originalText = btn.innerText;
            btn.innerText = "Saving...";
            btn.disabled = true;
        }

        try {
            // PARAMETER 'true' = FORCE OVERWRITE (Instant / No Pull)
            await saveToServer(['assessments', 'vettingTopics', 'accessControl', 'records'], true); 
        } catch(e) {
            console.error("System Save Error:", e);
        } finally {
            if(btn && btn.tagName === 'BUTTON') {
                btn.innerText = originalText;
                btn.disabled = false;
            }
        }
    }
}

// --- SECTION 1: GLOBAL CONFIGURATION (Assessments & Vetting) ---

function loadAdminAssessments() { 
    const stdList = document.getElementById('assessListStandard');
    const liveList = document.getElementById('assessListLive');
    const vetList = document.getElementById('assessListVetting');
    
    if(!stdList || !liveList || !vetList) return;
    
    const arr = JSON.parse(localStorage.getItem('assessments')||'[]');
    
    let stdHtml = '';
    let liveHtml = '';
    let vetHtml = '';

    arr.forEach((a) => {
        let typeLabel = a.video ? ' <i class="fas fa-video" title="Video Required" style="color:var(--text-muted); font-size:0.8rem;"></i>' : '';
        
        // Robust escaping for onclick handler (handles quotes and backslashes)
        const safeName = a.name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        
        const row = `
            <tr>
                <td>${a.name}${typeLabel}</td>
                <td style="text-align:right;"><button class="btn-danger btn-sm" onclick="remAssess('${safeName}')"><i class="fas fa-trash"></i></button></td>
            </tr>`;
        
        if (a.name.toLowerCase().includes('vetting')) vetHtml += row;
        else if (a.live) liveHtml += row;
        else stdHtml += row;
    });

    stdList.innerHTML = stdHtml;
    liveList.innerHTML = liveHtml;
    vetList.innerHTML = vetHtml;

    // Also load Vetting Topics since they share the view now
    loadAdminVetting();
}

async function addAssessment() { 
    const n = document.getElementById('newAssessName').value.trim(); 
    const v = document.getElementById('newAssessVideo').checked; 
    const l = document.getElementById('newAssessLive').checked; 
    
    if(!n) {
        if(typeof showToast === 'function') showToast("Enter assessment name", "warning");
        return;
    }
    
    const a = JSON.parse(localStorage.getItem('assessments') || '[]'); 
    if(a.find(x => x.name.toLowerCase() === n.toLowerCase())) {
        if(typeof showToast === 'function') showToast("Assessment already exists", "warning");
        return;
    }

    a.push({name:n, video:v, live:l}); 
    localStorage.setItem('assessments', JSON.stringify(a)); 
    
    if(typeof saveToServer === 'function') await saveToServer(['assessments'], false);
    
    document.getElementById('newAssessName').value = '';
    
    // Blur to prevent focus issues before reload
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    loadAdminAssessments(); 
    
    if(typeof updateAssessmentDropdown === 'function') updateAssessmentDropdown(); 
    if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns(); 
    
    if(typeof showToast === 'function') showToast("Assessment added", "success");
}

async function remAssess(name) { 
    if(!confirm(`Remove "${name}" from the list? Existing records will not be deleted.`)) return;
    
    let a = JSON.parse(localStorage.getItem('assessments') || '[]'); 
    const initialLen = a.length;
    
    // Filter by name (Robust Deletion)
    a = a.filter(x => x.name !== name);
    
    if (a.length === initialLen) {
        if(typeof showToast === 'function') showToast("Error: Assessment not found.", "error");
        return;
    }

    localStorage.setItem('assessments', JSON.stringify(a)); 
    
    await secureSysSave();

    // Blur to prevent focus issues
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    loadAdminAssessments(); 
    if(typeof updateAssessmentDropdown === 'function') updateAssessmentDropdown(); 
    if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns(); 
    
    if(typeof showToast === 'function') showToast("Assessment removed", "success");
}

function loadAdminVetting() { 
    const topics = JSON.parse(localStorage.getItem('vettingTopics') || '[]'); 
    const list = document.getElementById('vettingList');
    if(list) {
        list.innerHTML = topics.map((t,i) => `
            <li style="display:flex; justify-content:space-between; align-items:center; padding:5px; border-bottom:1px solid var(--border-color);">
                <span>${t}</span>
                ${CURRENT_USER.role === 'admin' ? `<button class="btn-danger btn-sm" onclick="remVetting(${i})" style="padding:2px 6px;">&times;</button>` : ''}
            </li>
        `).join(''); 
    }

    // Hide Add Section for Special Viewer
    const addSection = document.getElementById('newVettingTopic')?.parentElement;
    if (addSection) {
        if (CURRENT_USER.role === 'special_viewer') addSection.classList.add('hidden');
        else addSection.classList.remove('hidden');
    }
}

async function addVettingTopic() { 
    const t = document.getElementById('newVettingTopic').value.trim(); 
    if(!t) return; 
    
    const topics = JSON.parse(localStorage.getItem('vettingTopics') || '[]'); 
    // Prevent duplicates
    if(topics.some(existing => existing.toLowerCase() === t.toLowerCase())) return alert("Topic exists.");

    topics.push(t); 
    localStorage.setItem('vettingTopics', JSON.stringify(topics)); 
    
    if(typeof saveToServer === 'function') await saveToServer(['vettingTopics'], false);
    
    document.getElementById('newVettingTopic').value = ''; 
    loadAdminVetting(); 
    if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns(); 
}

async function remVetting(i) { 
    if(!confirm("Remove topic?")) return; 
    const topics = JSON.parse(localStorage.getItem('vettingTopics')); 
    topics.splice(i, 1); 
    localStorage.setItem('vettingTopics', JSON.stringify(topics)); 
    
    await secureSysSave();

    loadAdminVetting(); 
    if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns(); 
}

// --- SECTION 2: DATABASE MANAGEMENT (Raw Data) ---

function loadAdminDatabase() { 
    const term = document.getElementById('dbSearch') ? document.getElementById('dbSearch').value.toLowerCase() : '';
    
    // --- INJECT CLEANUP BUTTON ---
    const searchInput = document.getElementById('dbSearch');
    if (searchInput && !document.getElementById('btnCleanupDupes') && CURRENT_USER.role === 'admin') {
        const btn = document.createElement('button');
        btn.id = 'btnCleanupDupes';
        btn.className = 'btn-warning btn-sm';
        btn.style.marginLeft = '10px';
        btn.innerHTML = '<i class="fas fa-broom"></i> Cleanup Duplicates';
        btn.onclick = cleanupDuplicateRecords;
        if (searchInput.parentNode) {
            searchInput.parentNode.insertBefore(btn, searchInput.nextSibling);
        }
    }
    // -----------------------------

    const records = JSON.parse(localStorage.getItem('records') || '[]');
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    
    const validNames = new Set(users.filter(u => u.role === 'trainee').map(u => u.user.toLowerCase()));
    
    document.getElementById('dbTable').innerHTML = records.map((d, i) => {
        // SAFETY CHECK: Skip corrupted records (Ghost entries)
        if (!d.trainee || !d.assessment) return '';

        if (term && !d.trainee.toLowerCase().includes(term) && !d.assessment.toLowerCase().includes(term)) return '';
        
        const isValid = validNames.has(d.trainee.toLowerCase());
        const rowClass = isValid ? '' : 'row-error'; 
        const warning = isValid ? '' : '<i class="fas fa-exclamation-triangle" title="User mismatch"></i> ';
        
        let viewBtn = '';
        if(d.link === 'Digital-Assessment' || d.link === 'Live-Session') {
             // viewCompletedTest is in assessment.js
             // Use submissionId if available, else fallback
             const clickAction = d.submissionId ? `viewCompletedTest('${d.submissionId}', null, 'view')` : `viewCompletedTest('${d.trainee}', '${d.assessment}')`;
             viewBtn = `<button class="btn-secondary" style="padding:2px 6px;" onclick="${clickAction}" title="View Submission"><i class="fas fa-eye"></i></button>`;
        }

        let actions = viewBtn;
        if (CURRENT_USER.role === 'admin') {
            actions += `
                <button class="btn-secondary" style="padding:2px 6px;" onclick="openRecordEdit(${i})"><i class="fas fa-pen"></i></button> 
                <button class="btn-danger" style="padding:2px 6px;" onclick="delRec(${i})"><i class="fas fa-trash"></i></button>
            `;
        }

        return `
        <tr class="${rowClass}">
            <td>${CURRENT_USER.role === 'admin' ? `<input type="checkbox" class="db-check" value="${i}" id="db-chk-${i}">` : ''}</td>
            <td>${warning}${d.trainee}</td>
            <td>${d.assessment}</td>
            <td>${d.score}%</td>
            <td>
                ${actions}
            </td>
        </tr>`;
    }).join(''); 

    // Hide Bulk Actions for Special Viewer
    const bulkActions = document.querySelector('#admin-view-data .card h3')?.nextElementSibling;
    if (bulkActions && bulkActions.tagName === 'DIV') {
         if (CURRENT_USER.role === 'special_viewer') bulkActions.parentElement.classList.add('hidden'); // Hides the whole left panel actually
         // Better: Hide specific buttons
         const leftPanel = document.querySelector('#admin-view-data .grid-2 > div:first-child');
         if (leftPanel) {
             if (CURRENT_USER.role === 'special_viewer') leftPanel.classList.add('hidden');
             else leftPanel.classList.remove('hidden');
         }
    }
}

async function deleteBulkRecords() {
    const checks = document.querySelectorAll('.db-check:checked');
    if(checks.length === 0) return alert("No records selected.");
    if(!confirm(`Permanently delete ${checks.length} records?`)) return;
    
    const records = JSON.parse(localStorage.getItem('records') || '[]');
    // Sort descending to delete from end without shifting indices
    const indicesToDelete = Array.from(checks).map(c => parseInt(c.value)).sort((a,b) => b-a);
    
    indicesToDelete.forEach(idx => { records.splice(idx, 1); });
    
    localStorage.setItem('records', JSON.stringify(records));
    
    await secureSysSave();

    loadAdminDatabase();
    if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
}

let editRecIndex = -1;
function openRecordEdit(index) {
    editRecIndex = index;
    const records = JSON.parse(localStorage.getItem('records')); 
    const r = records[index];
    
    document.getElementById('adminEditTitle').innerText = `Edit Record`;
    document.getElementById('adminEditContent').innerHTML = `
        <label>Trainee Name</label><input type="text" id="editRecName" value="${r.trainee}">
        <label>Assessment</label><input type="text" id="editRecAssess" value="${r.assessment}">
        <label>Score</label><input type="number" id="editRecScore" value="${r.score}">
    `;
    
    document.getElementById('adminEditModal').classList.remove('hidden');
    document.getElementById('adminEditSaveBtn').onclick = saveRecordEdit;
}

async function saveRecordEdit() {
    const records = JSON.parse(localStorage.getItem('records'));
    records[editRecIndex].trainee = document.getElementById('editRecName').value;
    records[editRecIndex].assessment = document.getElementById('editRecAssess').value;
    records[editRecIndex].score = Number(document.getElementById('editRecScore').value);
    
    localStorage.setItem('records', JSON.stringify(records));
    
    await secureSysSave();
    
    document.getElementById('adminEditModal').classList.add('hidden');
    loadAdminDatabase();
    if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
}

async function delRec(i) { 
    if(confirm("Permanently delete?")) { 
        // 1. Force Pull Latest (Prevent overwriting new submissions)
        if(typeof loadFromServer === 'function') await loadFromServer(true);

        // 2. Re-read and Delete
        const r = JSON.parse(localStorage.getItem('records')); 
        r.splice(i,1); 
        localStorage.setItem('records', JSON.stringify(r)); 
        
        // 3. Force Save (Now safe because we just pulled)
        if(typeof saveToServer === 'function') await saveToServer(['records'], true);

        loadAdminDatabase(); 
        if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
    } 
}

async function syncGroupsFromRecords() { 
    const recs = JSON.parse(localStorage.getItem('records') || '[]'); 
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}'); 
    let updatedCount = 0; 
    
    recs.forEach(r => { 
        if(!r.trainee) return; // Skip ghosts
        if(!rosters[r.groupID]) { rosters[r.groupID] = []; } 
        if(!rosters[r.groupID].includes(r.trainee)) { 
            rosters[r.groupID].push(r.trainee); 
            updatedCount++; 
        } 
    }); 
    
    localStorage.setItem('rosters', JSON.stringify(rosters)); 
    
    if(typeof saveToServer === 'function') await saveToServer(['rosters'], true);
    
    if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
    alert(`Sync Complete! Added ${updatedCount} trainees to their respective groups.`); 
}

async function archiveOldSubmissions() {
    if(!confirm("Archive submissions from previous months?\n\nThis moves completed tests older than the current month to a separate storage key ('archive_submissions').\n\nThis significantly reduces bandwidth usage for daily syncs.")) return;

    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const archives = JSON.parse(localStorage.getItem('archive_submissions') || '[]');
    
    const now = new Date();
    // Cutoff: 1st day of the current month (00:00:00)
    const cutoffDate = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const keep = [];
    const move = [];
    
    subs.forEach(s => {
        const sDate = new Date(s.date);
        // Archive if older than current month AND completed
        if (sDate < cutoffDate && s.status === 'completed') {
            move.push(s);
        } else {
            keep.push(s);
        }
    });
    
    if (move.length === 0) {
        if(typeof showToast === 'function') showToast("No old completed submissions found to archive.", "info");
        return;
    }
    
    // Add to archives
    const newArchives = [...archives, ...move];
    
    localStorage.setItem('submissions', JSON.stringify(keep));
    localStorage.setItem('archive_submissions', JSON.stringify(newArchives));
    
    if(typeof saveToServer === 'function') await saveToServer(['submissions', 'archive_submissions'], true);
    
    if(typeof showToast === 'function') showToast(`Archived ${move.length} submissions successfully.`, "success");
    loadAdminDatabase();
}

async function cleanupDuplicateRecords() {
    if(!confirm("Run duplicate cleanup? This will remove duplicate records for the same Trainee + Assessment, keeping the highest score.")) return;

    const records = JSON.parse(localStorage.getItem('records') || '[]');
    const uniqueMap = new Map();
    let duplicatesCount = 0;

    records.forEach(r => {
        if (!r.trainee || !r.assessment) return;
        
        // Create unique key based on Trainee + Assessment
        const key = `${r.trainee.trim().toLowerCase()}|${r.assessment.trim().toLowerCase()}`;
        
        if (uniqueMap.has(key)) {
            const existing = uniqueMap.get(key);
            
            // Logic: Keep Highest Score
            const scoreA = parseFloat(r.score) || 0;
            const scoreB = parseFloat(existing.score) || 0;
            
            let keepNew = false;
            
            if (scoreA > scoreB) {
                keepNew = true;
            } else if (scoreA === scoreB) {
                // If scores equal, keep newest date
                const dateA = new Date(r.date || 0).getTime();
                const dateB = new Date(existing.date || 0).getTime();
                if (dateA > dateB) keepNew = true;
            }
            
            if (keepNew) {
                uniqueMap.set(key, r);
            }
            duplicatesCount++;
        } else {
            uniqueMap.set(key, r);
        }
    });

    if (duplicatesCount === 0) {
        alert("No duplicates found.");
        return;
    }

    const cleanRecords = Array.from(uniqueMap.values());
    
    localStorage.setItem('records', JSON.stringify(cleanRecords));
    
    // Force Sync
    if (typeof saveToServer === 'function') {
        const btn = document.getElementById('btnCleanupDupes');
        if(btn) { btn.innerText = "Syncing..."; btn.disabled = true; }
        await saveToServer(['records'], true);
        if(btn) { btn.innerHTML = '<i class="fas fa-broom"></i> Cleanup Duplicates'; btn.disabled = false; }
    }
    
    loadAdminDatabase();
    if (typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
    
    if(typeof showToast === 'function') showToast(`Cleanup complete. Removed ${duplicatesCount} duplicates.`, "success");
    else alert(`Cleanup complete. Removed ${duplicatesCount} duplicates.`);
}

// --- SECTION 3: IMPORT / EXPORT & BACKUP (OVERRIDES) ---

function toggleAutoBackup() {
    const cb = document.getElementById('autoBackupToggle');
    localStorage.setItem('autoBackup', cb.checked);
}

// OVERRIDE: SAFE IMPORT (Handles Metadata & Force Sync)
window.importDatabase = function(input) {
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
};

// OVERRIDE: SAFE EXPORT (Ensures cloud data is fresh before backup)
// We redefine the global exportDatabase function here to add the 'await loadFromServer' step
window.exportDatabase = async function() {
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
            exportedBy: CURRENT_USER.user
        };

        // Use DB_SCHEMA from data.js or fallback
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

// --- SECTION 4: SECURITY & ACCESS CONTROL ---

async function loadAdminAccess() {
    const ac = JSON.parse(localStorage.getItem('accessControl') || '{"enabled":false, "whitelist":[]}');
    const DEFAULT_IPS = ["102.66.15.0/24", "102.66.15.79"];
    let modified = false;

    DEFAULT_IPS.forEach(ip => {
        if(!ac.whitelist.includes(ip)) {
            ac.whitelist.push(ip);
            modified = true;
        }
    });

    if(modified) {
        localStorage.setItem('accessControl', JSON.stringify(ac));
        await secureSysSave();
    }

    const statusSpan = document.getElementById('acStatus');
    const toggleBtn = document.getElementById('btnToggleAC');
    const list = document.getElementById('ipList');
    const addSection = document.getElementById('newIpInput')?.parentElement;

    if (CURRENT_USER && CURRENT_USER.role === 'special_viewer') {
        if (toggleBtn) toggleBtn.classList.add('hidden');
        if (addSection) addSection.classList.add('hidden');
    } else {
        if (toggleBtn) toggleBtn.classList.remove('hidden');
        if (addSection) addSection.classList.remove('hidden');
    }
    
    if(statusSpan) {
        statusSpan.innerHTML = ac.enabled ? '<span style="color:#27ae60; font-weight:bold;">ENABLED</span>' : '<span style="color:#888; font-weight:bold;">DISABLED</span>';
    }
    if(toggleBtn) {
        toggleBtn.innerText = ac.enabled ? 'Disable Restriction' : 'Enable Restriction';
        toggleBtn.className = ac.enabled ? 'btn-danger' : 'btn-success';
    }
    if(list) {
        if(ac.whitelist.length === 0) {
            list.innerHTML = '<li>No IPs whitelisted.</li>';
        } else {
            list.innerHTML = ac.whitelist.map((ip, i) => `
                <li style="display:flex; justify-content:space-between; align-items:center; padding:5px 0; border-bottom:1px solid #eee;">
                    <span>${ip}</span>
                    ${(CURRENT_USER && CURRENT_USER.role === 'admin') ? `<button class="btn-danger btn-sm" onclick="removeIpAddress(${i})"><i class="fas fa-trash"></i></button>` : ''}
                </li>
            `).join('');
        }
    }
}

async function toggleIpRestriction() {
    const ac = JSON.parse(localStorage.getItem('accessControl') || '{"enabled":false, "whitelist":[]}');
    ac.enabled = !ac.enabled;
    localStorage.setItem('accessControl', JSON.stringify(ac));
    
    await secureSysSave();
    
    loadAdminAccess();
    alert(`Access Control is ${ac.enabled ? 'ENABLED' : 'DISABLED'}.`);
}

async function addIpAddress() {
    const input = document.getElementById('newIpInput');
    const ip = input.value.trim();
    if(!ip) return alert("Enter IP.");
    
    const ac = JSON.parse(localStorage.getItem('accessControl') || '{"enabled":false, "whitelist":[]}');
    if(ac.whitelist.includes(ip)) return alert("IP already exists.");
    
    ac.whitelist.push(ip);
    localStorage.setItem('accessControl', JSON.stringify(ac));
    
    await secureSysSave();
    
    input.value = '';
    loadAdminAccess();
}

async function removeIpAddress(index) {
    if(!confirm("Remove IP?")) return;
    const ac = JSON.parse(localStorage.getItem('accessControl') || '{"enabled":false, "whitelist":[]}');
    ac.whitelist.splice(index, 1);
    localStorage.setItem('accessControl', JSON.stringify(ac));
    
    await secureSysSave();
    
    loadAdminAccess();
}

// --- SECTION 5: THEME & PERSONALIZATION ---

function loadAdminTheme() {
    // Depend on admin_users.js for menu restriction
    if(typeof restrictTraineeMenu === 'function') restrictTraineeMenu();

    // Load from Local Storage (PC specific)
    const localTheme = JSON.parse(localStorage.getItem('local_theme_config') || '{}');
    
    const colorInput = document.getElementById('themeColor');
    const wallInput = document.getElementById('themeWallpaper');
    
    if (colorInput) colorInput.value = localTheme.primaryColor || '#F37021';
    if (wallInput) wallInput.value = localTheme.wallpaper || '';
    
    const cb = document.getElementById('autoBackupToggle');
    if(cb) cb.checked = (localStorage.getItem('autoBackup') === 'true');
}

async function saveThemeSettings() {
    
    const color = document.getElementById('themeColor').value;
    const wallpaper = document.getElementById('themeWallpaper').value;
    
    const themeConfig = {
        primaryColor: color,
        wallpaper: wallpaper
    };
    
    // Save locally only
    localStorage.setItem('local_theme_config', JSON.stringify(themeConfig));
    
    if (typeof applyUserTheme === 'function') applyUserTheme();
    
    alert("Theme Saved (Local PC Only)!");
}

// --- SECTION 6: SYSTEM HEALTH & RESET ---

function refreshSystemStatus() {
    // UPDATED: Calls data.js function which uses supabaseClient
    if(typeof fetchSystemStatus === 'function') {
        fetchSystemStatus(); 
    } else {
        document.getElementById('statusStorage').innerText = "Active";
        document.getElementById('statusLatency').innerText = "OK";
    }
    if(typeof refreshAccessLogs === 'function') {
        refreshAccessLogs();
    }
}

async function sendRemoteCommand(username, action) {
    if(!confirm(`Are you sure you want to remote ${action} for ${username}?`)) return;
    
    if (window.supabaseClient) {
        const { error } = await window.supabaseClient
            .from('sessions')
            .update({ pending_action: action })
            .eq('user', username);
            
        if(error) alert("Command failed: " + error.message);
        else {
            if(typeof logAuditAction === 'function') logAuditAction(CURRENT_USER.user, 'Remote Command', `Sent '${action}' to ${username}`);
            alert(`Command '${action}' sent to ${username}. It will execute on their next heartbeat.`);
        }
    }
}

async function confirmFactoryReset() {
    if (!confirm("CRITICAL WARNING: This will wipe all data, users, and records. The system will reset to factory defaults.\n\nAre you sure?")) return;
    if (!confirm("Final Confirmation: This action cannot be undone. Do you really want to proceed?")) return;

    try {
        console.log("Initiating Supabase Factory Reset...");
        
        // Define the Clean State (Preserving Admin)
        const cleanState = {
            records: [],
            users: [{user: 'admin', pass: 'Pass0525@', role: 'admin'}], 
            assessments: [], rosters: {}, accessControl: { enabled: false, whitelist: [] },
            trainingData: {}, vettingTopics: [], schedules: {}, liveBookings: [],
            cancellationCounts: {}, liveScheduleSettings: {}, tests: [], submissions: [],
            savedReports: [], insightReviews: [], exemptions: [], notices: [],
            revokedUsers: [] // CRITICAL: Reset blacklist to ensure clean slate
        };

        // 1. Reset 'app_data' table
        const { error: resetErr } = await supabaseClient
            .from('app_data')
            .upsert({ id: 1, content: cleanState });

        // 2. Clear 'sessions' table
        const { error: sessionErr } = await supabaseClient
            .from('sessions')
            .delete()
            .neq('user', 'placeholder'); // Delete all rows

        if (!resetErr) {
            if(typeof logAuditAction === 'function') logAuditAction(CURRENT_USER.user, 'Factory Reset', 'System reset to defaults');
            alert("System has been reset successfully. You will now be redirected.");
            localStorage.clear(); 
            location.reload();
        } else {
            alert("Reset Failed: " + resetErr.message);
        }
    } catch (error) {
        console.error("Reset Error:", error);
        alert("An error occurred during reset.");
    }
}

async function resetLiveSessionsKey() {
    if(!confirm("Clear 'liveSessions' array? Use this if the Live Arena is lagging due to data bloat.")) return;
    
    const btn = document.activeElement;
    if(btn) { btn.innerText = "Clearing..."; btn.disabled = true; }

    localStorage.setItem('liveSessions', '[]');
    if (typeof saveToServer === 'function') await saveToServer(['liveSessions'], true);
    
    alert("Live Sessions cleared. Reloading...");
    location.reload();
}

// --- SECTION 7: SUPER ADMIN CONFIGURATION ---

function openSuperAdminConfig() {
    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
    
    // Defaults if missing
    const rates = config.sync_rates || { admin: 10000, teamleader: 300000, trainee: 60000 }; // ms
    const att = config.attendance || { work_start: "08:00", work_end: "17:00", reminder_start: "16:45", late_cutoff: "08:15" };
    const sec = config.security || { maintenance_mode: false, min_version: "0.0.0", banned_clients: [] };
    const feat = config.features || { vetting_arena: true, live_assessments: true, disable_animations: false };
    const ann = config.announcement || { active: false, message: "", type: "info" };
    const banned = sec.banned_clients || [];
    const whitelist = sec.client_whitelist || [];

    const modalHtml = `
        <div id="superAdminModal" class="modal-overlay">
            <div class="modal-box" style="width:800px; max-height:90vh; overflow-y:auto;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h2 style="margin:0; color:#8e44ad;"><i class="fas fa-user-astronaut"></i> Super Admin Console</h2>
                    <button class="btn-secondary" onclick="document.getElementById('superAdminModal').remove()">&times;</button>
                </div>

                <div class="grid-2">
                    <div class="card">
                        <h4><i class="fas fa-sync"></i> Sync Performance</h4>
                        <label>Admin Polling (Seconds)</label><input type="number" id="sa_sync_admin" value="${rates.admin / 1000}">
                        <label>Trainee Polling (Seconds)</label><input type="number" id="sa_sync_trainee" value="${rates.trainee / 1000}">
                        <label>TL Polling (Minutes)</label><input type="number" id="sa_sync_tl" value="${rates.teamleader / 60000}">
                    </div>
                    <div class="card">
                        <h4><i class="fas fa-clock"></i> Attendance Rules</h4>
                        <label>Work Start</label><input type="time" id="sa_att_start" value="${att.work_start}">
                        <label>Late Cutoff (Grace Period)</label><input type="time" id="sa_att_late" value="${att.late_cutoff}">
                        <label>Work End</label><input type="time" id="sa_att_end" value="${att.work_end}">
                        <label>Clock-Out Reminder</label><input type="time" id="sa_att_remind" value="${att.reminder_start}">
                    </div>
                </div>

                <div class="grid-2" style="margin-top:15px;">
                    <div class="card">
                        <h4><i class="fas fa-shield-alt"></i> Security</h4>
                        <label style="display:flex; align-items:center; gap:10px;">
                            <input type="checkbox" id="sa_sec_maint" ${sec.maintenance_mode ? 'checked' : ''}> Maintenance Mode (Block Login)
                        </label>
                        <label style="display:flex; align-items:center; gap:10px;">
                            <input type="checkbox" id="sa_sec_kiosk" ${sec.force_kiosk_global ? 'checked' : ''}> Force Global Kiosk (Emergency)
                        </label>
                        <label>Min App Version</label><input type="text" id="sa_sec_ver" value="${sec.min_version}">
                        <label>Banned Client IDs</label>
                        <div style="display:flex; gap:5px;">
                            <input type="text" id="sa_sec_banned" value="${banned.join(', ')}" placeholder="CL-XXXX, CL-YYYY" style="flex:1;">
                            <button class="btn-secondary btn-sm" onclick="viewBannedClientsReport()"><i class="fas fa-list"></i> Report</button>
                        </div>
                        <label>Client Whitelist (Empty = Allow All)</label><input type="text" id="sa_sec_whitelist" value="${whitelist.join(', ')}" placeholder="CL-XXXX, CL-YYYY">
                    </div>
                    <div class="card">
                        <h4><i class="fas fa-toggle-on"></i> Feature Flags</h4>
                        <label style="display:flex; align-items:center; gap:10px;" title="Enable secure testing environment"><input type="checkbox" id="sa_feat_vet" ${feat.vetting_arena ? 'checked' : ''}> Vetting Arena</label>
                        <label style="display:flex; align-items:center; gap:10px;" title="Enable live trainer interaction"><input type="checkbox" id="sa_feat_live" ${feat.live_assessments ? 'checked' : ''}> Live Assessments</label>
                        <label style="display:flex; align-items:center; gap:10px;" title="Enable feedback surveys"><input type="checkbox" id="sa_feat_nps" ${feat.nps_surveys ? 'checked' : ''}> NPS Surveys</label>
                        <label style="display:flex; align-items:center; gap:10px;" title="Show daily tips on dashboard"><input type="checkbox" id="sa_feat_tips" ${feat.daily_tips !== false ? 'checked' : ''}> Daily Tips</label>
                        <label style="display:flex; align-items:center; gap:10px;" title="Reduce visual effects for performance"><input type="checkbox" id="sa_feat_anim" ${feat.disable_animations ? 'checked' : ''}> Disable Animations</label>
                    </div>
                </div>

                <div class="card" style="margin-top:15px;">
                    <h4><i class="fas fa-bullhorn"></i> Global Announcement</h4>
                    <label style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                        <input type="checkbox" id="sa_ann_active" ${ann.active ? 'checked' : ''}> Show Banner
                    </label>
                    <input type="text" id="sa_ann_msg" placeholder="Message to all users..." value="${ann.message}">
                    <select id="sa_ann_type" style="margin-top:5px;">
                        <option value="info" ${ann.type === 'info' ? 'selected' : ''}>Info (Blue)</option>
                        <option value="warning" ${ann.type === 'warning' ? 'selected' : ''}>Warning (Yellow)</option>
                        <option value="error" ${ann.type === 'error' ? 'selected' : ''}>Critical (Red)</option>
                        <option value="success" ${ann.type === 'success' ? 'selected' : ''}>Success (Green)</option>
                    </select>
                </div>
                
                <div class="card" style="margin-top:15px;">
                    <h4><i class="fas fa-bullhorn"></i> Instant Broadcast</h4>
                    <div style="display:flex; gap:10px;">
                        <input type="text" id="sa_broadcast_msg" placeholder="Popup message to all users..." style="flex:1;">
                        <button class="btn-warning btn-sm" onclick="sendSystemBroadcast()">Send</button>
                        <label style="display:flex; align-items:center; gap:5px; margin:0;"><input type="checkbox" id="sa_broadcast_sound" checked> Sound</label>
                    </div>
                </div>

                <div class="card" style="margin-top:15px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <h4><i class="fas fa-heartbeat"></i> Connected Clients Health</h4>
                        <div style="display:flex; gap:5px;">
                            <button id="btnForceRefreshAll" class="btn-danger btn-sm" onclick="forceRefreshAllClients()" title="Force Reload All Clients"><i class="fas fa-power-off"></i> Refresh All</button>
                            <button class="btn-secondary btn-sm" onclick="refreshClientHealthTable()"><i class="fas fa-sync"></i></button>
                        </div>
                    </div>
                    <div id="sa_client_health_table" style="max-height:200px; overflow-y:auto; margin-top:10px;">Loading...</div>
                </div>

                <button class="btn-primary" style="width:100%; margin-top:20px; background:#8e44ad;" onclick="saveSuperAdminConfig()">
                    <i class="fas fa-save"></i> Push Configuration to All Clients
                </button>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    // Initial Load
    refreshClientHealthTable();
}

async function saveSuperAdminConfig() {
    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
    
    config.sync_rates = {
        admin: parseInt(document.getElementById('sa_sync_admin').value) * 1000,
        teamleader: parseInt(document.getElementById('sa_sync_tl').value) * 60000,
        trainee: parseInt(document.getElementById('sa_sync_trainee').value) * 1000
    };
    
    config.attendance = { ...config.attendance,
        work_start: document.getElementById('sa_att_start').value,
        late_cutoff: document.getElementById('sa_att_late').value,
        work_end: document.getElementById('sa_att_end').value,
        reminder_start: document.getElementById('sa_att_remind').value
    };

    config.security = { ...config.security,
        maintenance_mode: document.getElementById('sa_sec_maint').checked,
        force_kiosk_global: document.getElementById('sa_sec_kiosk').checked,
        min_version: document.getElementById('sa_sec_ver').value,
        banned_clients: document.getElementById('sa_sec_banned').value.split(',').map(s => s.trim()).filter(s => s),
        client_whitelist: document.getElementById('sa_sec_whitelist').value.split(',').map(s => s.trim()).filter(s => s)
    };

    config.features = { ...config.features, vetting_arena: document.getElementById('sa_feat_vet').checked, live_assessments: document.getElementById('sa_feat_live').checked, nps_surveys: document.getElementById('sa_feat_nps').checked, daily_tips: document.getElementById('sa_feat_tips').checked, disable_animations: document.getElementById('sa_feat_anim').checked };
    
    config.announcement = { active: document.getElementById('sa_ann_active').checked, message: document.getElementById('sa_ann_msg').value, type: document.getElementById('sa_ann_type').value };

    localStorage.setItem('system_config', JSON.stringify(config));
    if (typeof saveToServer === 'function') await saveToServer(['system_config'], true);
    
    if(typeof logAuditAction === 'function') logAuditAction(CURRENT_USER.user, 'System Config', 'Updated Super Admin Settings');

    alert("Configuration Pushed. Clients will update on next sync.");
    document.getElementById('superAdminModal').remove();
    if(typeof applySystemConfig === 'function') applySystemConfig();
}

async function sendSystemBroadcast() {
    const msg = document.getElementById('sa_broadcast_msg').value;
    if(!msg) return alert("Enter a message.");
    
    if(!confirm("Send this popup message to ALL active users immediately?")) return;
    
    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
    const sound = document.getElementById('sa_broadcast_sound').checked;
    config.broadcast = { id: Date.now(), message: msg, sound: sound };
    
    localStorage.setItem('system_config', JSON.stringify(config));
    if (typeof saveToServer === 'function') await saveToServer(['system_config'], true);
    alert("Broadcast sent.");
}

async function refreshClientHealthTable() {
    const container = document.getElementById('sa_client_health_table');
    if (!container || !window.supabaseClient) return;

    const { data: sessions, error } = await supabaseClient
        .from('sessions')
        .select('*')
        .order('lastSeen', { ascending: false });

    if (error) {
        container.innerHTML = `<div style="color:#ff5252;">Error fetching health data.</div>`;
        return;
    }

    if (!sessions || sessions.length === 0) {
        container.innerHTML = `<div style="color:var(--text-muted);">No active sessions.</div>`;
        return;
    }

    let html = `<table class="admin-table compressed-table"><thead><tr><th>User</th><th>Client ID</th><th>Activity</th><th>Latency</th><th>Action</th></tr></thead><tbody>`;
    
    sessions.forEach(s => {
        const latency = s.latency || 0;
        let latColor = '#2ecc71';
        if (latency > 500) latColor = '#f1c40f';
        if (latency > 1500) latColor = '#ff5252';
        
        const seenTime = new Date(s.lastSeen).toLocaleTimeString();
        const isOnline = (Date.now() - new Date(s.lastSeen).getTime()) < 90000; // 90s threshold
        const statusDot = isOnline ? `<span style="color:#2ecc71;">●</span>` : `<span style="color:#95a5a6;">○</span>`;
        const clientId = s.clientId || 'Unknown';
        const activity = s.activity || '-';
        
        const banBtn = (clientId !== 'Unknown' && s.role !== 'super_admin') ? `<button class="btn-danger btn-sm" style="padding:0 4px; font-size:0.7rem; margin-left:5px;" onclick="banClient('${clientId}', '${s.user}')" title="Ban Terminal"><i class="fas fa-ban"></i></button>` : '';

        html += `<tr>
            <td>${statusDot} <strong>${s.user}</strong> <span style="font-size:0.7rem; color:var(--text-muted);">(${s.role})</span></td>
            <td style="font-family:monospace; font-size:0.8rem;">${clientId}${banBtn}</td>
            <td style="font-size:0.8rem; max-width:150px; overflow:hidden; text-overflow:ellipsis;" title="${activity}">${activity}</td>
            <td style="color:${latColor}; font-weight:bold;">${latency}ms</td>
            <td>
                <button class="btn-danger btn-sm" style="padding:0 5px;" onclick="sendRemoteCommand('${s.user}', 'logout')" title="Kick"><i class="fas fa-sign-out-alt"></i></button>
                <button class="btn-warning btn-sm" style="padding:0 5px;" onclick="sendRemoteCommand('${s.user}', 'restart')" title="Reload"><i class="fas fa-sync"></i></button>
                <button class="btn-primary btn-sm" style="padding:0 5px;" onclick="promptRemoteMessage('${s.user}')" title="Message"><i class="fas fa-comment"></i></button>
            </td>
        </tr>`;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
}

async function promptRemoteMessage(username) {
    const msg = prompt(`Send private message to ${username}:`);
    if(msg) {
        sendRemoteCommand(username, 'msg:' + msg);
    }
}

async function forceRefreshAllClients() {
    if (!confirm("⚠️ FORCE REFRESH ALL CLIENTS?\n\nThis will command EVERY connected user (including you) to reload the application immediately.\nUnsaved work might be lost if not cached.\n\nAre you sure?")) return;

    const btn = document.getElementById('btnForceRefreshAll');
    if(btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...'; }

    try {
        if (!window.supabaseClient) throw new Error("Not connected to cloud.");

        // Update all sessions to trigger a restart on next heartbeat
        const { error } = await supabaseClient
            .from('sessions')
            .update({ pending_action: 'restart' })
            .neq('user', 'placeholder'); // Safety filter to match all rows

        if (error) throw error;

        if(typeof logAuditAction === 'function') logAuditAction(CURRENT_USER.user, 'Force Refresh', 'Triggered global client refresh');
        alert("Command sent! Clients will refresh on their next heartbeat (within 60s).");
    } catch (e) {
        console.error(e);
        alert("Failed to send command: " + e.message);
    } finally {
        if(btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-power-off"></i> Refresh All'; }
    }
}

// --- KEYBOARD SHORTCUT ---
// Failsafe access to Super Admin Console (Ctrl + Shift + S)
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.role === 'super_admin') {
            openSuperAdminConfig();
        }
    }
});

async function banClient(clientId, username) {
    if(!confirm(`Ban terminal ${clientId} (User: ${username})?\n\nThey will be logged out and blocked from signing in.`)) return;
    
    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
    if (!config.security) config.security = {};
    if (!config.security.banned_clients) config.security.banned_clients = [];
    
    if (!config.security.banned_clients.includes(clientId)) {
        config.security.banned_clients.push(clientId);
        localStorage.setItem('system_config', JSON.stringify(config));
        if (typeof saveToServer === 'function') await saveToServer(['system_config'], true);
        
        // Kick the user immediately
        sendRemoteCommand(username, 'logout');
        alert(`Terminal banned and kick command sent to ${username}.`);
    }
}

// --- BANNED CLIENTS REPORT ---
function viewBannedClientsReport() {
    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
    const banned = (config.security && config.security.banned_clients) ? config.security.banned_clients : [];

    let html = `<div class="modal-overlay" id="bannedReportModal" style="z-index:10001;">
        <div class="modal-box" style="width:500px;">
            <h3><i class="fas fa-ban" style="color:#ff5252;"></i> Banned Clients Report</h3>
            <div class="table-responsive" style="max-height:300px; overflow-y:auto; margin-top:15px;">
                <table class="admin-table">
                    <thead><tr><th>Client ID</th><th>Action</th></tr></thead>
                    <tbody>`;
    
    if (banned.length === 0) {
        html += `<tr><td colspan="2" class="text-center" style="color:var(--text-muted);">No banned clients found.</td></tr>`;
    } else {
        banned.forEach(id => {
            html += `<tr>
                <td style="font-family:monospace;">${id}</td>
                <td style="text-align:right;"><button class="btn-success btn-sm" onclick="unbanClient('${id}')"><i class="fas fa-unlock"></i> Unban</button></td>
            </tr>`;
        });
    }

    html += `</tbody></table></div>
            <div style="text-align:right; margin-top:15px;">
                <button class="btn-secondary" onclick="document.getElementById('bannedReportModal').remove()">Close</button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
}

async function unbanClient(id) {
    if(!confirm(`Unban Client ID: ${id}?`)) return;
    
    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
    if (config.security && config.security.banned_clients) {
        config.security.banned_clients = config.security.banned_clients.filter(c => c !== id);
        localStorage.setItem('system_config', JSON.stringify(config));
        if (typeof saveToServer === 'function') await saveToServer(['system_config'], true);
        
        // Refresh report and main modal input
        document.getElementById('bannedReportModal').remove();
        viewBannedClientsReport();
        
        // Update the input in the main modal if it's open
        const input = document.getElementById('sa_sec_banned');
        if(input) input.value = config.security.banned_clients.join(', ');
        
        if(typeof logAuditAction === 'function') logAuditAction(CURRENT_USER.user, 'Security', `Unbanned Client ID: ${id}`);
    }
}
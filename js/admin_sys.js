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
            <li>
                ${t} 
                ${CURRENT_USER.role === 'admin' ? `<button class="btn-danger btn-sm" style="margin-left:10px;" onclick="remVetting(${i})">X</button>` : ''}
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
    // Refresh Stats
    renderDatabaseStats();

    const term = document.getElementById('dbSearch') ? document.getElementById('dbSearch').value.toLowerCase() : '';
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
             viewBtn = `<button class="btn-secondary" style="padding:2px 6px;" onclick="viewCompletedTest('${d.trainee}', '${d.assessment}')" title="View Submission"><i class="fas fa-eye"></i></button>`;
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

function renderDatabaseStats() {
    const statsContainer = document.getElementById('dbStatsContainer');
    if (!statsContainer) return;

    const recs = JSON.parse(localStorage.getItem('records') || '[]');
    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const arch = JSON.parse(localStorage.getItem('archive_submissions') || '[]');
    const users = JSON.parse(localStorage.getItem('users') || '[]');

    statsContainer.innerHTML = `
        <div class="status-item"><strong>${users.length}</strong> Users</div>
        <div class="status-item"><strong>${recs.length}</strong> Records</div>
        <div class="status-item"><strong>${subs.length}</strong> Active Subs</div>
        <div class="status-item" style="color:var(--text-muted);"><strong>${arch.length}</strong> Archived</div>
    `;
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
        const r = JSON.parse(localStorage.getItem('records')); 
        r.splice(i,1); 
        localStorage.setItem('records', JSON.stringify(r)); 
        
        await secureSysSave();

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
    if(typeof loadCompletedHistory === 'function') loadCompletedHistory();
}

// --- SECTION 3: IMPORT / EXPORT & BACKUP (OVERRIDES) ---

function toggleAutoBackup() {
    const cb = document.getElementById('autoBackupToggle');
    localStorage.setItem('autoBackup', cb.checked);
}

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
        // Use DB_SCHEMA from data.js or fallback
        const schemaKeys = (typeof DB_SCHEMA !== 'undefined') ? Object.keys(DB_SCHEMA) : ['records','users','assessments','rosters','schedules','liveBookings'];
        
        schemaKeys.forEach(k => {
            d[k] = JSON.parse(localStorage.getItem(k)) || [];
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
                    ${CURRENT_USER.role === 'admin' ? `<button class="btn-danger btn-sm" onclick="removeIpAddress(${i})"><i class="fas fa-trash"></i></button>` : ''}
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
        else alert(`Command '${action}' sent to ${username}. It will execute on their next heartbeat.`);
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
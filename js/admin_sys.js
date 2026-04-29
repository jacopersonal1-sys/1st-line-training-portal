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
            await saveToServer(['assessments', 'vettingTopics', 'accessControl'], true); 
            await saveToServer(['records'], false); 
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
             if (d.submissionId) {
                 viewBtn = `<button class="btn-secondary" style="padding:2px 6px;" onclick="viewCompletedTest('${d.submissionId}', null, 'view')" title="View Submission"><i class="fas fa-eye"></i></button>`;
             } else {
                 viewBtn = `<button class="btn-secondary" style="padding:2px 6px; opacity:0.5; cursor:not-allowed;" disabled title="Missing submission ID"><i class="fas fa-eye-slash"></i></button>`;
             }
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
    const indicesToDelete = Array.from(checks).map(c => parseInt(c.value)).sort((a,b) => b-a);
    const idsToDelete = indicesToDelete.map(idx => records[idx] ? records[idx].id : null).filter(id => id);

    // 1. Delete from Server First
    if (typeof hardDelete === 'function' && idsToDelete.length > 0) {
        const btn = document.activeElement;
        if(btn) { btn.disabled = true; btn.innerText = 'Deleting...'; }
        
        let allSucceeded = true;
        for (const id of idsToDelete) {
            const success = await hardDelete('records', id);
            if (!success) allSucceeded = false;
        }
        
        if(btn) { btn.disabled = false; btn.innerText = 'Delete Selected'; }

        if (!allSucceeded) {
            alert("Some records could not be deleted from the server. Please check connection and try again. The UI will not be updated.");
            return;
        }
    }
    
    // 2. Update Local State on Success
    indicesToDelete.forEach(idx => { records.splice(idx, 1); });
    localStorage.setItem('records', JSON.stringify(records));

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
    const originalRec = records[editRecIndex];

    // --- OPTIMISTIC CONCURRENCY CONTROL (OCC) ---
    if (window.supabaseClient && originalRec.id) {
        try {
            const { data } = await window.supabaseClient.from('records').select('data').eq('id', originalRec.id).single();
            if (data && data.data && data.data.lastModified) {
                const serverTime = new Date(data.data.lastModified).getTime();
                const localTime = new Date(originalRec.lastModified || 0).getTime();
                if (serverTime > localTime) {
                    if (!confirm(`⚠️ CONFLICT DETECTED\n\nAdmin '${data.data.modifiedBy || 'Unknown'}' updated this record recently.\nDo you want to forcefully overwrite their changes?`)) {
                        return; // Abort save
                    }
                }
            }
        } catch(e) { console.warn("OCC Check failed, proceeding...", e); }
    }

    records[editRecIndex].trainee = document.getElementById('editRecName').value;
    records[editRecIndex].assessment = document.getElementById('editRecAssess').value;
    records[editRecIndex].score = Number(document.getElementById('editRecScore').value);
    records[editRecIndex].lastModified = new Date().toISOString();
    records[editRecIndex].modifiedBy = CURRENT_USER.user;
    
    localStorage.setItem('records', JSON.stringify(records));
    
    await secureSysSave();
    
    document.getElementById('adminEditModal').classList.add('hidden');
    loadAdminDatabase();
    if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
}

async function delRec(i) { 
    if(confirm("Permanently delete?")) { 
        const r = JSON.parse(localStorage.getItem('records')); 
        const target = r[i];
        
        // 1. Delete from server first
        if (target && target.id && typeof hardDelete === 'function') {
            const success = await hardDelete('records', target.id);
            if (!success) {
                alert("Failed to delete record from server. Please check connection.");
                return;
            }
        }
        
        // 2. Update local state
        r.splice(i,1); 
        localStorage.setItem('records', JSON.stringify(r)); 

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
    
    if(typeof saveToServer === 'function') await saveToServer(['submissions', 'archive_submissions'], false);
    
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
        
        // Create unique key based on Trainee + Assessment + Group + Phase
        const key = `${r.trainee.trim().toLowerCase()}|${r.assessment.trim().toLowerCase()}|${(r.groupID||'').trim().toLowerCase()}|${(r.phase||'').trim().toLowerCase()}`;
        
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
        await saveToServer(['records'], false);
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
            // Explicitly pass all keys to bypass the system_config guard in data.js
            if (typeof saveToServer === 'function') await saveToServer(Object.keys(data), true); 

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
                    ${(CURRENT_USER && (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin')) ? `<button class="btn-danger btn-sm" onclick="removeIpAddress(${i})"><i class="fas fa-trash"></i></button>` : ''}
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
    
    // --- INJECT BACKGROUND COLOR INPUT ---
    if (colorInput && !document.getElementById('themeBgColor')) {
        const div = document.createElement('div');
        div.style.marginBottom = '10px';
        div.innerHTML = `<label>Background Color (Dark Mode)</label><input type="color" id="themeBgColor" value="#1A1410" style="width:100%; height:40px; cursor:pointer; border:1px solid var(--border-color); border-radius:4px;">`;
        if (colorInput.parentNode) colorInput.parentNode.insertBefore(div, colorInput.nextSibling);
    }

    // --- INJECT ZOOM CONTROL ---
    if (colorInput && !document.getElementById('themeZoomContainer')) {
        const container = document.createElement('div');
        container.id = 'themeZoomContainer';
        container.style.marginTop = '20px';
        container.style.paddingTop = '15px';
        container.style.borderTop = '1px dashed var(--border-color)';
        
        container.innerHTML = `
            <label style="display:block; margin-bottom:10px; font-weight:bold;">UI Zoom Level: <span id="themeZoomDisplay" style="color:var(--primary);">100%</span></label>
            <div style="display:flex; align-items:center; gap:10px;">
                <button class="btn-secondary btn-sm" onclick="adjustZoom(-0.1)"><i class="fas fa-minus"></i></button>
                <input type="range" id="themeZoom" min="0.5" max="1.5" step="0.1" value="1" style="flex:1;" oninput="updateZoomPreview(this.value)">
                <button class="btn-secondary btn-sm" onclick="adjustZoom(0.1)"><i class="fas fa-plus"></i></button>
                <button class="btn-secondary btn-sm" onclick="resetZoom()" title="Reset to 100%"><i class="fas fa-undo"></i></button>
            </div>
            <div style="text-align:center; font-size:0.7rem; color:var(--text-muted); margin-top:5px;">50% - 150%</div>
        `;
        
        // Insert after wallpaper input if possible
        if (wallInput && wallInput.parentNode) {
            wallInput.parentNode.insertBefore(container, wallInput.nextSibling);
        } else if (colorInput && colorInput.parentNode) {
            colorInput.parentNode.insertBefore(container, colorInput.nextSibling);
        }
    }

    if (colorInput && !document.getElementById('themeDensityContainer')) {
        const container = document.createElement('div');
        container.id = 'themeDensityContainer';
        container.style.marginTop = '20px';
        container.style.paddingTop = '15px';
        container.style.borderTop = '1px dashed var(--border-color)';
        container.innerHTML = `
            <label for="themeDensity" style="display:block; margin-bottom:10px; font-weight:bold;">Interface Density</label>
            <select id="themeDensity" onchange="setUIDensity(this.value)" style="width:100%; margin-bottom:6px;">
                <option value="compact">Compact</option>
                <option value="comfortable">Comfortable</option>
                <option value="spacious">Spacious</option>
            </select>
            <div style="font-size:0.7rem; color:var(--text-muted);">Controls the spacing used by dashboards, modals, cards, and tables on this PC.</div>
        `;
        const zoomContainer = document.getElementById('themeZoomContainer');
        if (zoomContainer && zoomContainer.parentNode) {
            zoomContainer.parentNode.insertBefore(container, zoomContainer.nextSibling);
        } else if (wallInput && wallInput.parentNode) {
            wallInput.parentNode.insertBefore(container, wallInput.nextSibling);
        } else if (colorInput.parentNode) {
            colorInput.parentNode.insertBefore(container, colorInput.nextSibling);
        }
    }

    if (colorInput) colorInput.value = localTheme.primaryColor || '#F37021';
    if (wallInput) wallInput.value = localTheme.wallpaper || '';
    
    if (document.getElementById('themeBgColor')) {
        document.getElementById('themeBgColor').value = localTheme.backgroundColor || '#1A1410';
    }

    const densityInput = document.getElementById('themeDensity');
    if (densityInput) {
        densityInput.value = (typeof getCurrentUIDensity === 'function') ? getCurrentUIDensity() : (localTheme.density || 'comfortable');
    }
    
    const zoomInput = document.getElementById('themeZoom');
    if (zoomInput) {
        const z = localTheme.zoomLevel || 1.0;
        zoomInput.value = z;
        if(document.getElementById('themeZoomDisplay')) document.getElementById('themeZoomDisplay').innerText = Math.round(z * 100) + '%';
    }

    const cb = document.getElementById('autoBackupToggle');
    if(cb) cb.checked = (localStorage.getItem('autoBackup') === 'true');

    if (typeof updateExperimentalThemePickerState === 'function') {
        updateExperimentalThemePickerState();
    }
    if (typeof loadExperimentalThemeCustomizer === 'function') {
        loadExperimentalThemeCustomizer();
    }
}

// Helper functions for zoom
window.updateZoomPreview = function(val) {
    const v = parseFloat(val);
    document.getElementById('themeZoomDisplay').innerText = Math.round(v * 100) + '%';
    // Live preview
    if (typeof require !== 'undefined') {
        try { require('electron').webFrame.setZoomFactor(v); } catch(e) {}
    } else {
        document.body.style.zoom = v;
    }

    if (typeof window.refreshAdaptiveViewportLayout === 'function') {
        window.refreshAdaptiveViewportLayout();
    }
};

window.adjustZoom = function(delta) {
    const input = document.getElementById('themeZoom');
    if(input) {
        // Fix floating point precision issues
        let newVal = Math.round((parseFloat(input.value) + delta) * 10) / 10;
        newVal = Math.max(0.5, Math.min(1.5, newVal));
        input.value = newVal;
        updateZoomPreview(newVal);
    }
};

window.resetZoom = function() {
    const input = document.getElementById('themeZoom');
    if(input) {
        input.value = 1;
        updateZoomPreview(1);
    }
};

async function saveThemeSettings() {
    
    const color = document.getElementById('themeColor').value;
    const wallpaper = document.getElementById('themeWallpaper').value;
    const bgColor = document.getElementById('themeBgColor') ? document.getElementById('themeBgColor').value : '#1A1410';
    const zoom = document.getElementById('themeZoom') ? parseFloat(document.getElementById('themeZoom').value) : 1.0;
    const density = document.getElementById('themeDensity') ? document.getElementById('themeDensity').value : (localStorage.getItem('ui_density') || 'comfortable');
    
    const themeConfig = {
        primaryColor: color,
        backgroundColor: bgColor,
        wallpaper: wallpaper,
        zoomLevel: zoom,
        density: density
    };
    
    // Save locally only
    localStorage.setItem('local_theme_config', JSON.stringify(themeConfig));
    localStorage.setItem('ui_density', density);
    
    if (typeof applyUserTheme === 'function') applyUserTheme();
    
    alert("Theme & Zoom Saved (Local PC Only)!");
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
    
    // Local Network Ping (Admin Tool Specific)
    const connEl = document.getElementById('statusConnection');
    if(connEl) {
        const startPing = Date.now();
        fetch('https://www.google.com/favicon.ico', { mode: 'no-cors', cache: 'no-store' })
            .then(() => {
                const ping = Date.now() - startPing;
                connEl.innerText = `Online (${ping}ms)`;
                connEl.style.color = ping < 200 ? '#2ecc71' : 'orange';
            })
            .catch(() => {
                connEl.innerText = "Offline";
                connEl.style.color = '#ff5252';
            });
    }

    if(typeof refreshAccessLogs === 'function') {
        refreshAccessLogs();
    }

    if(typeof renderNetworkHealthTable === 'function') {
        renderNetworkHealthTable();
    }
}

async function sendRemoteCommand(username, action) {
    if(!confirm(`Are you sure you want to remote ${action} for ${username}?`)) return;
    
    if (window.supabaseClient) {
        const { data, error } = await window.supabaseClient
            .from('sessions')
            .update({ pending_action: action })
            .ilike('username', username)
            .select('username');
            
        if(error) alert("Command failed: " + error.message);
        else if (!Array.isArray(data) || data.length === 0) {
            alert(`No active session row found for ${username}. The user may be offline.`);
        }
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
            revokedUsers: [], // CRITICAL: Reset blacklist to ensure clean slate
            liveSchedules: {}, // Reset Live Schedules
            system_config: DB_SCHEMA.system_config // Reset system settings to defaults
        };

        // 1. Reset 'app_documents' table (Split Schema)
        const { error: resetErr } = await supabaseClient
            .from('app_documents')
            .delete().neq('key', 'placeholder'); // Delete all rows

        // 2. Clear 'sessions' table
        const { error: sessionErr } = await supabaseClient
            .from('sessions')
            .delete()
            .neq('user', 'placeholder'); // Delete all rows
            
        if (sessionErr) throw sessionErr;
        console.log("Cloud 'sessions' table wiped.");

        // D. Wipe ALL Row-Level Tables (The Big Fix)
        const tables = [
            'records', 'submissions', 'audit_logs', 'live_bookings', 'monitor_history', 
            'attendance', 'access_logs', 'saved_reports', 'archived_users', 'live_sessions', 
            'link_requests', 'calendar_events', 'error_reports', 'insight_reviews', 
            'exemptions', 'nps_responses', 'monitor_state'
        ];
        
        for (const t of tables) {
                await window.supabaseClient.from(t).delete().neq('id', 'placeholder');
        }
        console.log("All data tables wiped.");

        if (!resetErr) {
            // 3. Bootstrap Admin User & Config
            await supabaseClient.from('app_documents').insert([
                { key: 'users', content: cleanState.users, updated_at: new Date().toISOString() },
                { key: 'system_config', content: cleanState.system_config, updated_at: new Date().toISOString() }
            ]);
            
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
    
    // FIX: Explicitly wipe the table for Row-Level Sync
    if (window.supabaseClient) {
        const { error } = await window.supabaseClient
            .from('live_sessions')
            .delete()
            .neq('id', 'placeholder'); // Delete all rows
    }
    
    alert("Live Sessions cleared. Reloading...");
    location.reload();
}

// --- SECTION 7: SUPER ADMIN CONFIGURATION ---

function openSuperAdminConfig() {
    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
    
    // Defaults if missing
    const rawRates = config.sync_rates || {};
    let envRates = rawRates;
    
    // Legacy data migration
    if (typeof rawRates.admin !== 'undefined') {
        envRates = {
            cloud: { admin: rawRates.admin, teamleader: rawRates.teamleader, trainee: rawRates.trainee },
            local: { admin: Math.max(2000, rawRates.admin / 2), teamleader: Math.max(30000, rawRates.teamleader / 2), trainee: Math.max(5000, rawRates.trainee / 2) },
            staging: { admin: rawRates.admin, teamleader: rawRates.teamleader, trainee: rawRates.trainee }
        };
    } else if (!envRates.cloud) {
        envRates = {
            cloud: { admin: 4000, teamleader: 60000, trainee: 15000 },
            local: { admin: 2000, teamleader: 30000, trainee: 5000 },
            staging: { admin: 4000, teamleader: 60000, trainee: 15000 }
        };
    }
    const getR = (env, role, def) => (envRates[env] && envRates[env][role]) ? envRates[env][role] / 1000 : def;
    const att = config.attendance || { work_start: "08:00", work_end: "17:00", reminder_start: "16:45", late_cutoff: "08:15" };
    const sec = config.security || { maintenance_mode: false, min_version: "0.0.0", banned_clients: [] };
    const feat = config.features || {};
    const ann = config.announcement || { active: false, message: "", type: "info" };
    const banned = sec.banned_clients || [];
    const whitelist = sec.client_whitelist || [];
    const ai = config.ai || { enabled: true, apiKey: "" }; // FIX: Default to Enabled
    const lockdown = sec.lockdown_mode || false;
    const srv = config.server_settings || { active: 'cloud', local_url: '', local_key: '' };

    // --- STAGING UI LOGIC ---
    const currentLocalTarget = localStorage.getItem('active_server_target') || 'cloud';
    const isStaging = currentLocalTarget === 'staging';

    let statusBanner = '';
    if (isStaging) {
        statusBanner = `<div style="background:rgba(241, 196, 15, 0.1); border:1px solid #f1c40f; color:#f1c40f; padding:10px; border-radius:6px; margin-bottom:15px; text-align:center; font-weight:bold;">
            <i class="fas fa-flask"></i> THIS TERMINAL IS IN STAGING MODE
        </div>`;
    }

    let stagingBox = '';
    if (isStaging) {
        stagingBox = `
            <div style="margin-top:15px; padding:10px; border:1px dashed #f1c40f; border-radius:6px; background:rgba(241, 196, 15, 0.05);">
                <div style="font-weight:bold; margin-bottom:5px; color:#f1c40f;"><i class="fas fa-flask"></i> Staging Mode Active</div>
                <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:10px;">You are connected to the Test Database and Beta Update Channel.</div>
                <button class="btn-danger btn-sm" onclick="exitStaging()" style="width:100%;">Exit Staging (Revert to Production)</button>
            </div>`;
    } else {
        stagingBox = `
            <div style="margin-top:15px; padding:10px; border:1px dashed #f1c40f; border-radius:6px; background:rgba(241, 196, 15, 0.05);">
                <div style="font-weight:bold; margin-bottom:5px; color:#f1c40f;"><i class="fas fa-flask"></i> Staging / Test Server (Local Override)</div>
                <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:10px;">Enabling Staging Mode connects to the Test Database AND subscribes to Pre-release Updates (Beta Channel).</div>
                <div style="display:flex; gap:10px; margin-bottom:5px;"><input type="text" id="sa_stage_url" placeholder="Staging URL" style="flex:1;"><input type="text" id="sa_stage_key" placeholder="Staging Key" style="flex:1;"></div>
                <button class="btn-warning btn-sm" onclick="switchToStaging()" style="width:100%;">Save & Switch to Staging Mode</button>
            </div>`;
    }

    const modalHtml = `
        <div id="superAdminModal" class="modal-overlay">
            <div class="modal-box" style="width:900px; max-height:90vh; display:flex; flex-direction:column; padding:0;">
                
                <!-- HEADER -->
                <div style="padding:20px; border-bottom:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; background:var(--bg-card);">
                    <h2 style="margin:0; color:#8e44ad;"><i class="fas fa-user-astronaut"></i> Super Admin Console</h2>
                    <button class="btn-secondary" onclick="document.getElementById('superAdminModal').remove()">&times;</button>
                </div>

                <!-- TABS -->
                <div style="display:flex; background:var(--bg-input); border-bottom:1px solid var(--border-color);">
                    <button class="sa-tab-btn active" onclick="switchSaTab('overview', this)"><i class="fas fa-tachometer-alt"></i> Overview</button>
                    <button class="sa-tab-btn" onclick="switchSaTab('config', this)"><i class="fas fa-cogs"></i> Configuration</button>
                    <button class="sa-tab-btn" onclick="switchSaTab('security', this)"><i class="fas fa-shield-alt"></i> Security</button>
                    <button class="sa-tab-btn" onclick="switchSaTab('data', this)"><i class="fas fa-database"></i> Data & Logs</button>
                    <button class="sa-tab-btn" onclick="switchSaTab('patcher', this)"><i class="fas fa-terminal"></i> Data Patcher</button>
                    <button class="sa-tab-btn" onclick="switchSaTab('ai', this)"><i class="fas fa-robot"></i> AI Analyst</button>
                </div>

                <!-- CONTENT AREA -->
                <div style="flex:1; overflow-y:auto; padding:20px;">
                    
                    <!-- TAB: OVERVIEW -->
                    <div id="sa-tab-overview" class="sa-tab-content">
                        <div class="card" style="border-left: 4px solid #4285f4; margin-bottom:20px;">
                            <h4><i class="fas fa-robot"></i> AI System Analyst</h4>
                            <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px;">
                                <label style="margin:0;"><input type="checkbox" id="sa_ai_enabled" ${ai.enabled ? 'checked' : ''}> Enable AI</label>
                                <input type="password" id="sa_ai_key" value="${ai.apiKey || ''}" placeholder="Gemini API Key" style="flex:1;">
                                <select id="sa_ai_model" style="margin:0; width:150px;" title="AI Model">
                                    <option value="gemini-2.5-flash" ${ai.model === 'gemini-2.5-flash' ? 'selected' : ''}>2.5 Flash (Newest)</option>
                                    <option value="gemini-2.0-flash" ${ai.model === 'gemini-2.0-flash' ? 'selected' : ''}>2.0 Flash</option>
                                    <option value="gemini-1.5-flash-latest" ${ai.model === 'gemini-1.5-flash-latest' ? 'selected' : ''}>1.5 Flash (Latest)</option>
                                    <option value="gemini-1.5-pro-latest" ${ai.model === 'gemini-1.5-pro-latest' ? 'selected' : ''}>1.5 Pro (Latest)</option>
                                    <option value="gemini-1.0-pro-latest" ${ai.model === 'gemini-1.0-pro-latest' ? 'selected' : ''}>1.0 Pro (Legacy)</option>
                                </select>
                                <button class="btn-secondary btn-sm" onclick="testGeminiConnection()" title="Test API Key & List Available Models"><i class="fas fa-plug"></i></button>
                            </div>
                            <div style="display:flex; gap:10px;">
                                <button class="btn-secondary btn-sm" onclick="AICore.openConsole()"><i class="fas fa-terminal"></i> Launch Console</button>
                                <button class="btn-danger btn-sm" onclick="viewSystemErrors()"><i class="fas fa-bug"></i> Error Reports</button>
                                <button class="btn-danger btn-sm" style="background:#c0392b;" onclick="viewProblemReports()"><i class="fas fa-question-circle"></i> Problem Reports</button>
                                <button class="btn-warning btn-sm" onclick="openDevTools()"><i class="fas fa-code"></i> DevTools</button>
                            </div>
                        </div>

                        <div class="card" style="margin-bottom:20px;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <h4><i class="fas fa-heartbeat"></i> Connected Clients</h4>
                                <div style="display:flex; gap:5px;">
                                    <button class="btn-danger btn-sm" onclick="forceRefreshAllClients()"><i class="fas fa-power-off"></i> Refresh All</button>
                                    <button class="btn-secondary btn-sm" onclick="refreshClientHealthTable()"><i class="fas fa-sync"></i></button>
                                </div>
                            </div>
                            <div id="sa_client_health_table" style="max-height:200px; overflow-y:auto; margin-top:10px;">Loading...</div>
                        </div>
                        
                        <div class="card" style="border-left: 4px solid #ff5252;">
                            <h4><i class="fas fa-exclamation-triangle"></i> Emergency Controls</h4>
                            <div style="display:flex; gap:15px; align-items:center;">
                                <button class="btn-danger" onclick="toggleLockdown()" style="flex:1;">${lockdown ? 'UNLOCK SYSTEM' : '⚠ INITIATE LOCKDOWN'}</button>
                                <div style="font-size:0.8rem; color:var(--text-muted); flex:2;"><strong>Lockdown Mode:</strong> Freezes logins, blocks saves, and forces logout for non-admins.</div>
                            </div>
                        </div>

                        <div class="card">
                            <h4><i class="fas fa-bullhorn"></i> Instant Broadcast</h4>
                            <div style="display:flex; gap:10px;">
                                <input type="text" id="sa_broadcast_msg" placeholder="Popup message to all users..." style="flex:1;">
                                <button class="btn-warning btn-sm" onclick="sendSystemBroadcast()">Send</button>
                            </div>
                        </div>
                    </div>

                    <!-- TAB: CONFIGURATION -->
                    <div id="sa-tab-config" class="sa-tab-content hidden">
                        <div class="card" style="margin-bottom: 15px;">
                            <h4><i class="fas fa-sync"></i> Sync Rates by Server (Seconds)</h4>
                            <div class="table-responsive">
                                <table class="admin-table compressed-table" style="margin:0;">
                                    <thead><tr><th>Server</th><th>Admin</th><th>Team Leader</th><th>Trainee</th></tr></thead>
                                    <tbody>
                                        <tr>
                                            <td><i class="fas fa-cloud" style="color:#3498db;"></i> Cloud</td>
                                            <td><input type="number" id="sa_sync_cloud_admin" value="${getR('cloud','admin',4)}" style="width:80px; margin:0;"></td>
                                            <td><input type="number" id="sa_sync_cloud_tl" value="${getR('cloud','teamleader',60)}" style="width:80px; margin:0;"></td>
                                            <td><input type="number" id="sa_sync_cloud_trainee" value="${getR('cloud','trainee',15)}" style="width:80px; margin:0;"></td>
                                        </tr>
                                        <tr>
                                            <td><i class="fas fa-server" style="color:#9b59b6;"></i> Local</td>
                                            <td><input type="number" id="sa_sync_local_admin" value="${getR('local','admin',2)}" style="width:80px; margin:0;"></td>
                                            <td><input type="number" id="sa_sync_local_tl" value="${getR('local','teamleader',30)}" style="width:80px; margin:0;"></td>
                                            <td><input type="number" id="sa_sync_local_trainee" value="${getR('local','trainee',5)}" style="width:80px; margin:0;"></td>
                                        </tr>
                                        <tr>
                                            <td><i class="fas fa-flask" style="color:#f1c40f;"></i> Staging</td>
                                            <td><input type="number" id="sa_sync_staging_admin" value="${getR('staging','admin',4)}" style="width:80px; margin:0;"></td>
                                            <td><input type="number" id="sa_sync_staging_tl" value="${getR('staging','teamleader',60)}" style="width:80px; margin:0;"></td>
                                            <td><input type="number" id="sa_sync_staging_trainee" value="${getR('staging','trainee',15)}" style="width:80px; margin:0;"></td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div class="grid-2">
                            <div class="card">
                                <h4><i class="fas fa-clock"></i> Attendance</h4>
                                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                                    <div><label>Start</label><input type="time" id="sa_att_start" value="${att.work_start}"></div>
                                    <div><label>Late Cutoff</label><input type="time" id="sa_att_late" value="${att.late_cutoff}"></div>
                                    <div><label>End</label><input type="time" id="sa_att_end" value="${att.work_end}"></div>
                                    <div><label>Reminder</label><input type="time" id="sa_att_remind" value="${att.reminder_start}"></div>
                                    <div><label>Lunch Start</label><input type="time" id="sa_att_lunch_start" value="${att.lunch_start || '12:00'}"></div>
                                    <div><label>Lunch Dur (m)</label><input type="number" id="sa_att_lunch_dur" value="${att.lunch_duration || 60}" style="width:100%;"></div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="card" style="margin-top:15px; border-left: 4px solid #9b59b6;">
                            <h4><i class="fas fa-server"></i> Server Failover Control</h4>
                            
                            ${statusBanner}
                            
                            <div style="margin-bottom:20px;">
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                                    <label style="margin:0; font-weight:bold;">Global Target (All Users):</label>
                                    <button class="btn-secondary btn-sm" onclick="testServerConnections()"><i class="fas fa-network-wired"></i> Test Connectivity</button>
                                </div>
                                <div style="display:flex; gap:15px;">
                                    <input type="hidden" id="sa_srv_active" value="${srv.active === 'local' ? 'local' : 'cloud'}">
                                    <div id="btn_target_cloud" onclick="setGlobalTarget('cloud')" style="flex:1; cursor:pointer; padding:15px; border-radius:8px; border:2px solid ${srv.active !== 'local' ? '#3498db' : 'var(--border-color)'}; background:${srv.active !== 'local' ? 'rgba(52, 152, 219, 0.1)' : 'var(--bg-input)'}; text-align:center; transition:0.2s;">
                                        <i class="fas fa-cloud" style="font-size:2rem; color:#3498db; margin-bottom:10px;"></i>
                                        <div style="font-weight:bold; color:var(--text-main);">Cloud (Production)</div>
                                    </div>
                                    <div id="btn_target_local" onclick="setGlobalTarget('local')" style="flex:1; cursor:pointer; padding:15px; border-radius:8px; border:2px solid ${srv.active === 'local' ? '#9b59b6' : 'var(--border-color)'}; background:${srv.active === 'local' ? 'rgba(155, 89, 182, 0.1)' : 'var(--bg-input)'}; text-align:center; transition:0.2s;">
                                        <i class="fas fa-server" style="font-size:2rem; color:#9b59b6; margin-bottom:10px;"></i>
                                        <div style="font-weight:bold; color:var(--text-main);">Local (VM Backup)</div>
                                    </div>
                                </div>
                            </div>

                            <div class="grid-2" style="gap:15px;">
                                <div style="border:1px solid var(--border-color); padding:10px; border-radius:6px; position:relative;">
                                    <div style="font-weight:bold; margin-bottom:5px; color:#3498db;">Cloud Server (Main)</div>
                                    <div id="status_cloud" style="position:absolute; top:10px; right:10px; font-size:0.75rem; font-weight:bold; color:var(--text-muted);">Unknown</div>
                                    <label style="font-size:0.8rem;">URL</label><input type="text" value="${window.CLOUD_CREDENTIALS ? window.CLOUD_CREDENTIALS.url : ''}" disabled style="opacity:0.7; cursor:not-allowed;">
                                    <label style="font-size:0.8rem;">Anon Key</label><input type="text" value="${window.CLOUD_CREDENTIALS ? window.CLOUD_CREDENTIALS.key : ''}" disabled style="opacity:0.7; cursor:not-allowed; font-family:monospace; font-size:0.7rem;">
                                </div>
                                <div style="border:1px solid var(--border-color); padding:10px; border-radius:6px; position:relative;">
                                    <div style="font-weight:bold; margin-bottom:5px; color:#9b59b6;">Local Server (VM)</div>
                                    <div id="status_local" style="position:absolute; top:10px; right:10px; font-size:0.75rem; font-weight:bold; color:var(--text-muted);">Unknown</div>
                                    <label style="font-size:0.8rem;">URL</label><input type="text" id="sa_srv_url" value="${srv.local_url || ''}" placeholder="http://192.168.x.x:8000">
                                    <label style="font-size:0.8rem;">Anon Key</label><input type="text" id="sa_srv_key" value="${srv.local_key || ''}" placeholder="eyJh..." style="font-family:monospace; font-size:0.7rem;">
                                </div>
                            </div>
                            
                            ${stagingBox}

                            <div style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--border-color); text-align:right;">
                                <button class="btn-warning btn-sm" onclick="forceMigrationPush()"><i class="fas fa-upload"></i> Force Data Migration</button>
                            </div>
                        </div>

                        <div class="card" style="margin-top:15px;">
                            <h4><i class="fas fa-toggle-on"></i> Features</h4>
                            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                                <label><input type="checkbox" id="sa_feat_vet" ${feat.vetting_arena !== false ? 'checked' : ''}> Vetting Arena</label>
                                <label><input type="checkbox" id="sa_feat_live" ${feat.live_assessments !== false ? 'checked' : ''}> Live Assessments</label>
                                <label><input type="checkbox" id="sa_feat_nps" ${feat.nps_surveys !== false ? 'checked' : ''}> NPS Surveys</label>
                                <label><input type="checkbox" id="sa_feat_tips" ${feat.daily_tips !== false ? 'checked' : ''}> Daily Tips</label>
                                <label><input type="checkbox" id="sa_feat_anim" ${feat.disable_animations ? 'checked' : ''}> Disable Animations</label>
                            </div>
                        </div>
                        <div class="card" style="margin-top:15px;">
                            <h4><i class="fas fa-scroll"></i> Global Banner</h4>
                            <label><input type="checkbox" id="sa_ann_active" ${ann.active ? 'checked' : ''}> Active</label>
                            <input type="text" id="sa_ann_msg" value="${ann.message}" placeholder="Message...">
                            <select id="sa_ann_type">
                                <option value="info" ${ann.type === 'info' ? 'selected' : ''}>Info</option>
                                <option value="warning" ${ann.type === 'warning' ? 'selected' : ''}>Warning</option>
                                <option value="error" ${ann.type === 'error' ? 'selected' : ''}>Critical</option>
                            </select>
                        </div>
                    </div>

                    <!-- TAB: SECURITY -->
                    <div id="sa-tab-security" class="sa-tab-content hidden">
                        <div class="card">
                            <h4><i class="fas fa-lock"></i> Access Control</h4>
                            <label><input type="checkbox" id="sa_sec_maint" ${sec.maintenance_mode ? 'checked' : ''}> Maintenance Mode</label>
                            <label><input type="checkbox" id="sa_sec_kiosk" ${sec.force_kiosk_global ? 'checked' : ''}> Force Global Kiosk</label>
                            <label>Minimum Required Version</label><input type="text" id="sa_sec_ver" value="${sec.min_version || ''}" placeholder="e.g. 2.6.47">
                            <div style="font-size:0.78rem; color:var(--text-muted); margin-top:-6px; margin-bottom:8px;">Users on versions lower than this are blocked at login and their saves are blocked. Leave blank or 0.0.0 to disable.</div>
                        </div>
                        <div class="card" style="margin-top:15px;">
                            <h4><i class="fas fa-ban"></i> Client Management</h4>
                            <label>Banned IDs</label>
                            <div style="display:flex; gap:5px;">
                                <input type="text" id="sa_sec_banned" value="${banned.join(', ')}" style="flex:1;">
                                <button class="btn-secondary btn-sm" onclick="viewBannedClientsReport()">Manage</button>
                            </div>
                            <label>Whitelist</label><input type="text" id="sa_sec_whitelist" value="${whitelist.join(', ')}">
                        </div>

                    <div class="card" style="margin-top:15px; border-left: 4px solid #ff5252;">
                        <h4><i class="fas fa-user-slash"></i> Blacklisted Users (Identity Revoked)</h4>
                        <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:10px;">Users who were Archived or Graduated are placed on this blacklist so the system can destroy their old data. <strong>Remove their name from this list</strong> to allow them to be recreated or log in again.</div>
                        <input type="text" id="sa_sec_revoked" value="${JSON.parse(localStorage.getItem('revokedUsers') || '[]').join(', ')}" style="width:100%;" placeholder="username1, username2...">
                    </div>
                    </div>

                    <!-- TAB: DATA (NEW) -->
                    <div id="sa-tab-data" class="sa-tab-content hidden">
                        <div class="card">
                            <h4><i class="fas fa-code"></i> Raw Data Inspector</h4>
                            <div style="display:flex; gap:10px; margin-bottom:10px;">
                                <select id="sa_data_key" onchange="loadRawDataKey()" style="flex:1;">
                                    <option value="">-- Select Key --</option>
                                    <option value="users">Users</option>
                                    <option value="records">Records</option>
                                    <option value="rosters">Rosters</option>
                                    <option value="system_config">System Config</option>
                                    <option value="auditLogs">Audit Logs</option>
                                    <option value="error_reports">Error Reports</option>
                                </select>
                                <button class="btn-primary btn-sm" onclick="saveRawDataKey()">Save JSON</button>
                            </div>
                            <textarea id="sa_data_editor" style="width:100%; height:300px; font-family:monospace; font-size:0.8rem; background:#1e1e1e; color:#0f0; border:1px solid #333; padding:10px;"></textarea>
                        </div>
                        <div class="card" style="margin-top:15px;">
                            <h4><i class="fas fa-hdd"></i> Storage Visualizer</h4>
                            <div id="sa_storage_viz" style="margin-top:10px;"></div>
                        </div>
                        <div class="card" style="margin-top:15px; border-left: 4px solid #2ecc71;">
                            <h4><i class="fas fa-database"></i> Row-Level Sync Status</h4>
                            <div id="sa_migration_status" style="margin-top:10px; font-size:0.9rem; color:var(--text-muted);">Click check to compare Local vs Cloud Row Counts.</div>
                            <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
                                <button class="btn-secondary btn-sm" onclick="checkRowSyncStatus()"><i class="fas fa-sync"></i> Check Status</button>
                                <button class="btn-warning btn-sm" onclick="performBlobToRowMigration()"><i class="fas fa-upload"></i> Migrate Blobs to Rows</button>
                                <button class="btn-primary btn-sm" onclick="forceResyncRows()"><i class="fas fa-cloud-download-alt"></i> Force Pull Rows</button>
                                <button class="btn-danger btn-sm" onclick="cleanupCloudDuplicates()"><i class="fas fa-broom"></i> Cleanup Cloud Duplicates</button>
                                <button class="btn-danger btn-sm" onclick="cleanupLocalDuplicates()"><i class="fas fa-laptop-medical"></i> Cleanup Local Duplicates</button>
                                <button class="btn-warning btn-sm" onclick="performOrphanCleanup()"><i class="fas fa-link"></i> Sync Check (Orphans)</button>
                                <button class="btn-danger btn-sm" onclick="emergencyDataRepair()"><i class="fas fa-toolbox"></i> Emergency Repair</button>
                                <button class="btn-secondary btn-sm" onclick="verifyServerSchema()"><i class="fas fa-stethoscope"></i> Verify Schema</button>
                            </div>
                        </div>
                    </div>

                    <!-- TAB: AI (NEW) -->
                    <div id="sa-tab-ai" class="sa-tab-content hidden">
                        <div class="card" style="height:100%; display:flex; flex-direction:column; min-height:400px;">
                            <div id="sa_ai_chat_history" style="flex:1; overflow-y:auto; border:1px solid var(--border-color); padding:15px; margin-bottom:15px; background:var(--bg-input); border-radius:4px; font-family:sans-serif;">
                                <div style="color:var(--text-muted); text-align:center; margin-top:20px;">
                                    <i class="fas fa-robot" style="font-size:2rem; margin-bottom:10px;"></i><br>
                                    Ask me anything about the system data.<br>
                                    <small>"How many users are active?" &bull; "Analyze recent errors" &bull; "Check system health"</small>
                                </div>
                            </div>
                            <div style="display:flex; gap:10px;">
                                <textarea id="sa_ai_input" placeholder="Type your question here..." style="flex:1; padding:10px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-card); color:var(--text-main); height: 60px; resize: none; font-family: inherit;" onkeydown="if(event.key==='Enter' && !event.shiftKey) { event.preventDefault(); sendSaAiMessage(); }"></textarea>
                                <button class="btn-primary" onclick="sendSaAiMessage()" style="height: 60px;"><i class="fas fa-paper-plane"></i></button>
                            </div>
                        </div>
                    </div>

                    <!-- TAB: PATCHER (NEW) -->
                    <div id="sa-tab-patcher" class="sa-tab-content hidden">
                        <div class="card" style="background:#1e1e1e; border:1px solid #333;">
                            <h4 style="color:#f1c40f;"><i class="fas fa-code"></i> JavaScript Data Patcher</h4>
                            <p style="color:#aaa; font-size:0.8rem; margin-bottom:10px;">Write JS to modify data in bulk. Available variables: <code>users</code>, <code>records</code>, <code>rosters</code>. Changes are applied to LocalStorage and Synced.</p>
                            <textarea id="sa_patcher_code" style="width:100%; height:200px; font-family:monospace; background:#121212; color:#0f0; border:1px solid #444; padding:10px; margin-bottom:10px;" placeholder="// Example: users.forEach(u => u.active = true);"></textarea>
                            <div style="display:flex; justify-content:space-between;">
                                <div id="sa_patcher_result" style="color:#aaa; font-family:monospace; font-size:0.8rem;">Ready.</div>
                                <button class="btn-warning" onclick="executeDataPatch()">Execute Patch</button>
                            </div>
                        </div>
                    </div>

                </div>

                <!-- FOOTER -->
                <div style="padding:15px; border-top:1px solid var(--border-color); background:var(--bg-card); text-align:right;">
                    <button class="btn-primary" onclick="saveSuperAdminConfig()" style="background:#8e44ad;"><i class="fas fa-save"></i> Push Configuration</button>
                </div>
            </div>
        </div>
        <style>
            .sa-tab-btn { flex:1; padding:15px; background:transparent; border:none; border-bottom:3px solid transparent; cursor:pointer; font-weight:bold; color:var(--text-muted); transition:0.2s; }
            .sa-tab-btn:hover { background:rgba(255,255,255,0.05); color:var(--text-main); }
            .sa-tab-btn.active { border-bottom-color:#8e44ad; color:#8e44ad; background:rgba(142, 68, 173, 0.1); }
            .sa-tab-content.hidden { display:none; }
        </style>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    // Initial Load
    refreshClientHealthTable();
    
    // Load Staging Creds
    const stage = JSON.parse(localStorage.getItem('staging_credentials') || '{}');
    if(document.getElementById('sa_stage_url')) document.getElementById('sa_stage_url').value = stage.url || '';
    if(document.getElementById('sa_stage_key')) document.getElementById('sa_stage_key').value = stage.key || '';

    renderStorageVisualizer();
    setTimeout(testServerConnections, 500);
}

// New Helper Functions for Tabs
window.switchSaTab = function(tabName, btn) {
    document.querySelectorAll('.sa-tab-content').forEach(el => el.classList.add('hidden'));
    document.getElementById(`sa-tab-${tabName}`).classList.remove('hidden');
    
    document.querySelectorAll('.sa-tab-btn').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
};

window.setGlobalTarget = function(target) {
    const hiddenInput = document.getElementById('sa_srv_active');
    if (hiddenInput) hiddenInput.value = target;
    
    const btnCloud = document.getElementById('btn_target_cloud');
    const btnLocal = document.getElementById('btn_target_local');
    
    if (target === 'cloud') {
        if(btnCloud) { btnCloud.style.borderColor = '#3498db'; btnCloud.style.background = 'rgba(52, 152, 219, 0.1)'; }
        if(btnLocal) { btnLocal.style.borderColor = 'var(--border-color)'; btnLocal.style.background = 'var(--bg-input)'; }
    } else {
        if(btnLocal) { btnLocal.style.borderColor = '#9b59b6'; btnLocal.style.background = 'rgba(155, 89, 182, 0.1)'; }
        if(btnCloud) { btnCloud.style.borderColor = 'var(--border-color)'; btnCloud.style.background = 'var(--bg-input)'; }
    }
};

window.loadRawDataKey = function() {
    const key = document.getElementById('sa_data_key').value;
    const editor = document.getElementById('sa_data_editor');
    if (!key) {
        editor.value = '';
        return;
    }
    const data = localStorage.getItem(key);
    try {
        const json = JSON.parse(data);
        editor.value = JSON.stringify(json, null, 2);
    } catch(e) {
        editor.value = data || '';
    }
};

window.saveRawDataKey = async function() {
    const key = document.getElementById('sa_data_key').value;
    const raw = document.getElementById('sa_data_editor').value;
    if (!key) return alert("Select a key first.");
    
    try {
        const json = JSON.parse(raw); // Validate JSON
        if (!confirm(`Overwrite '${key}' with this data? This is irreversible.`)) return;
        
        localStorage.setItem(key, JSON.stringify(json));
        if (typeof saveToServer === 'function') await saveToServer([key], true); // Force push
        
        alert("Data saved and synced.");
    } catch(e) {
        alert("Invalid JSON: " + e.message);
    }
};

window.checkRowSyncStatus = async function() {
    const container = document.getElementById('sa_migration_status');
    if(!container) return;
    
    container.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Checking Cloud Tables...';
    
    try {
        if (!window.supabaseClient) throw new Error("Not connected to Supabase.");

        // Local Counts
        const locRecs = (JSON.parse(localStorage.getItem('records') || '[]')).length;
        const locSubs = (JSON.parse(localStorage.getItem('submissions') || '[]')).length;
        const locLogs = (JSON.parse(localStorage.getItem('auditLogs') || '[]')).length;
        const locLive = (JSON.parse(localStorage.getItem('liveBookings') || '[]')).length;
        const locAtt = (JSON.parse(localStorage.getItem('attendance_records') || '[]')).length;
        const locArch = (JSON.parse(localStorage.getItem('graduated_agents') || '[]')).length;
        const locRep = (JSON.parse(localStorage.getItem('savedReports') || '[]')).length;
        const locReq = (JSON.parse(localStorage.getItem('linkRequests') || '[]')).length;
        const locMon = Object.keys(JSON.parse(localStorage.getItem('monitor_data') || '{}')).length;
        const locTests = (JSON.parse(localStorage.getItem('tests') || '[]')).length;
        
        // Remote Counts (Head Query)
        const { count: remRecs } = await supabaseClient.from('records').select('*', { count: 'exact', head: true });
        const { count: remSubs } = await supabaseClient.from('submissions').select('*', { count: 'exact', head: true });
        const { count: remLogs } = await supabaseClient.from('audit_logs').select('*', { count: 'exact', head: true });
        const { count: remLive } = await supabaseClient.from('live_bookings').select('*', { count: 'exact', head: true });
        const { count: remAtt } = await supabaseClient.from('attendance').select('*', { count: 'exact', head: true });
        const { count: remArch } = await supabaseClient.from('archived_users').select('*', { count: 'exact', head: true });
        const { count: remRep } = await supabaseClient.from('saved_reports').select('*', { count: 'exact', head: true });
        const { count: remReq } = await supabaseClient.from('link_requests').select('*', { count: 'exact', head: true });
        const { count: remCal } = await supabaseClient.from('calendar_events').select('*', { count: 'exact', head: true });
        const { count: remMon } = await supabaseClient.from('monitor_state').select('*', { count: 'exact', head: true });
        const { count: remTests } = await supabaseClient.from('tests').select('*', { count: 'exact', head: true });
        
        const getStatus = (loc, rem) => {
            if (loc === rem) return '<span style="color:#2ecc71; font-weight:bold;">Synced</span>';
            if (loc > rem) return `<span style="color:#f1c40f; font-weight:bold;">Pending Upload (${loc - rem})</span>`;
            return `<span style="color:#3498db; font-weight:bold;">Server Ahead (${rem - loc})</span>`;
        };
        
        const getTs = (key) => {
            const ts = localStorage.getItem('row_sync_ts_' + key);
            if (!ts) return '<span style="color:var(--text-muted);">-</span>';
            return new Date(ts).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
        };
        
        const locCal = (JSON.parse(localStorage.getItem('calendarEvents') || '[]')).length;

        container.innerHTML = `
            <table class="admin-table compressed-table" style="margin-top:5px;">
                <thead><tr><th>Table</th><th>Local</th><th>Cloud</th><th>Status</th><th>Last Sync</th></tr></thead>
                <tbody>
                    <tr><td>Records</td><td>${locRecs}</td><td>${remRecs||0}</td><td>${getStatus(locRecs, remRecs||0)}</td><td>${getTs('records')}</td></tr>
                    <tr><td>Submissions</td><td>${locSubs}</td><td>${remSubs||0}</td><td>${getStatus(locSubs, remSubs||0)}</td><td>${getTs('submissions')}</td></tr>
                    <tr><td>Audit Logs</td><td>${locLogs}</td><td>${remLogs||0}</td><td>${getStatus(locLogs, remLogs||0)}</td><td>${getTs('auditLogs')}</td></tr>
                    <tr><td>Live Bookings</td><td>${locLive}</td><td>${remLive||0}</td><td>${getStatus(locLive, remLive||0)}</td><td>${getTs('liveBookings')}</td></tr>
                    <tr><td>Attendance</td><td>${locAtt}</td><td>${remAtt||0}</td><td>${getStatus(locAtt, remAtt||0)}</td><td>${getTs('attendance_records')}</td></tr>
                    <tr><td>Archives</td><td>${locArch}</td><td>${remArch||0}</td><td>${getStatus(locArch, remArch||0)}</td><td>${getTs('graduated_agents')}</td></tr>
                    <tr><td>Reports</td><td>${locRep}</td><td>${remRep||0}</td><td>${getStatus(locRep, remRep||0)}</td><td>${getTs('savedReports')}</td></tr>
                    <tr><td>Requests</td><td>${locReq}</td><td>${remReq||0}</td><td>${getStatus(locReq, remReq||0)}</td><td>${getTs('linkRequests')}</td></tr>
                    <tr><td>Monitor Live</td><td>${locMon}</td><td>${remMon||0}</td><td>${getStatus(locMon, remMon||0)}</td><td>-</td></tr>
                    <tr><td>Calendar</td><td>${locCal}</td><td>${remCal||0}</td><td>${getStatus(locCal, remCal||0)}</td><td>${getTs('calendarEvents')}</td></tr>
                    <tr><td>Tests</td><td>${locTests}</td><td>${remTests||0}</td><td>${getStatus(locTests, remTests||0)}</td><td>${getTs('tests')}</td></tr>
                </tbody>
            </table>
        `;
    } catch(e) {
        container.innerHTML = `<div style="color:#ff5252;">Error: ${e.message}</div>`;
    }
};

window.forceResyncRows = async function() {
    if(!confirm("Force re-download of all row data? This will merge server data into your local database.")) return;
    
    const btn = document.activeElement;
    if(btn && btn.tagName === 'BUTTON') { btn.disabled = true; btn.innerText = "Syncing..."; }
    
    // Reset timestamps to force full pull
    Object.keys(localStorage).forEach(k => {
        if(k.startsWith('row_sync_ts_')) localStorage.removeItem(k);
    });
    
    if(typeof loadFromServer === 'function') await loadFromServer(false);
    
    if(btn && btn.tagName === 'BUTTON') { btn.disabled = false; btn.innerText = "Force Pull Rows"; }
    checkRowSyncStatus();
    alert("Sync complete.");
};

window.resetPushState = function() {
    // Clears the bloated hash maps so they regenerate as small checksums
    Object.keys(localStorage).forEach(k => {
        if(k.startsWith('hash_map_')) localStorage.removeItem(k);
    });
    console.log("Push state reset. Next sync will regenerate lightweight hashes.");
    if(typeof renderStorageVisualizer === 'function') renderStorageVisualizer();
};

window.cleanupCloudDuplicates = async function() {
    if(!confirm("⚠️ NUCLEAR CLEANUP: RECORDS & ARCHIVES\n\nThis will scan for duplicates in 'Records' and 'Archives'.\nIt keeps the entry with the HIGHEST SCORE or LATEST DATE.\n\nThis fixes the '5x Size' bloat.\n\nProceed?")) return;
    
    const btn = document.activeElement;
    const originalText = btn.innerText;
    btn.disabled = true; btn.innerText = "Cleaning...";
    
    try {
        if (!window.supabaseClient) throw new Error("Not connected.");

        // 1. CLEAN RECORDS (The heavy hitter)
        // Fetch minimal fields to avoid memory crash
        const { data: records, error: recErr } = await supabaseClient.from('records').select('id, trainee, data, updated_at');
        
        if (records && records.length > 0) {
            const uniqueMap = new Map();
            const toDelete = [];
            
            records.forEach(row => {
                // Key: Trainee + Assessment
                const rData = row.data || {};
                const key = `${(rData.trainee||'').toLowerCase()}|${(rData.assessment||'').toLowerCase()}`;
                
                if (uniqueMap.has(key)) {
                    const existing = uniqueMap.get(key);
                    const exData = existing.data || {};
                    
                    // Keep the one with higher score, or newer date
                    const scoreA = parseFloat(rData.score) || 0;
                    const scoreB = parseFloat(exData.score) || 0;
                    
                    if (scoreA > scoreB) {
                        toDelete.push(existing.id); // Delete old, keep new
                        uniqueMap.set(key, row);
                    } else {
                        toDelete.push(row.id); // Delete new, keep old
                    }
                } else {
                    uniqueMap.set(key, row);
                }
            });
            
            if (toDelete.length > 0) {
                // Delete in batches of 1000
                for (let i = 0; i < toDelete.length; i += 1000) {
                    await supabaseClient.from('records').delete().in('id', toDelete.slice(i, i + 1000));
                }
                alert(`Cleaned ${toDelete.length} duplicate records.`);
            }
        }

        // 2. CLEAN ARCHIVES (Dedupe by user_id)
        const { data: archives, error } = await supabaseClient.from('archived_users').select('id, user_id, updated_at');
        if(archives) {
            const seen = new Set();
            const toDelete = [];
            
            // Sort by updated_at desc (keep newest)
            archives.sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at));
            
            archives.forEach(row => {
                if(seen.has(row.user_id)) {
                    toDelete.push(row.id);
                } else {
                    seen.add(row.user_id);
                }
            });
            
            if(toDelete.length > 0) {
                await supabaseClient.from('archived_users').delete().in('id', toDelete);
                console.log(`Removed ${toDelete.length} duplicate archives.`);
                alert(`Removed ${toDelete.length} duplicate archived users.`);
            } else {
                alert("No duplicates found in Archives.");
            }
        }
        checkRowSyncStatus();
    } catch(e) {
        alert("Error: " + e.message);
    } finally {
        btn.disabled = false; btn.innerText = originalText;
    }
};

window.cleanupLocalDuplicates = function() {
    if(!confirm("Optimize Local Storage?\n\n1. Remove duplicates.\n2. Prune old detailed activity logs (keeps summaries).\n3. Reset sync state.")) return;
    
    let totalRemoved = 0;
    const keys = ['records', 'graduated_agents', 'submissions'];
    
    // 1. Standard Deduplication
    keys.forEach(key => {
        const items = JSON.parse(localStorage.getItem(key) || '[]');
        if(items.length === 0) return;
        
        const uniqueMap = new Map();
        let removed = 0;
        
        items.forEach(item => {
            // Create unique signature
            let sig = "";
            if (key === 'records') sig = `${item.trainee}|${item.assessment}`;
            else if (key === 'graduated_agents') sig = `${item.user}`;
            else if (key === 'submissions') sig = `${item.trainee}|${item.testId}`;
            else sig = item.id;
            
            sig = sig.toLowerCase();
            
            if (uniqueMap.has(sig)) {
                // Keep the one with newer data/score
                // For simplicity in local cleanup, we keep the existing (first found) or overwrite if needed.
                // Let's keep the one already in map (First one)
                removed++;
            } else {
                uniqueMap.set(sig, item);
            }
        });
        
        if (removed > 0) {
            localStorage.setItem(key, JSON.stringify(Array.from(uniqueMap.values())));
            totalRemoved += removed;
        }
    });

    // 2. Monitor History Optimization (The Big Fix)
    const history = JSON.parse(localStorage.getItem('monitor_history') || '[]');
    const initialHistLen = history.length;
    const initialHistSize = JSON.stringify(history).length;
    
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const seenHist = new Set();
    const cleanHistory = [];
    
    history.forEach(h => {
        // Dedupe Key: User + Date
        const key = `${h.user}|${h.date}`;
        if(seenHist.has(key)) return; // Skip duplicate
        seenHist.add(key);
        
        // Prune Details if old
        const entryDate = new Date(h.date).getTime();
        if (now - entryDate > sevenDays) {
            if (h.details) delete h.details; // Remove heavy array
        }
        cleanHistory.push(h);
    });
    
    if (history.length !== cleanHistory.length || JSON.stringify(cleanHistory).length !== initialHistSize) {
        localStorage.setItem('monitor_history', JSON.stringify(cleanHistory));
        console.log(`Monitor History optimized. Rows: ${initialHistLen} -> ${cleanHistory.length}`);
    }
    
    // Also reset push state to ensure clean sync
    resetPushState();
    
    alert(`Cleanup complete.\n- Removed ${totalRemoved} general duplicates.\n- Optimized Activity Logs (Pruned details > 7 days).`);
    checkRowSyncStatus();
    renderStorageVisualizer();
};

// --- EMERGENCY DATA REPAIR ---
window.emergencyDataRepair = async function() {
    if (!confirm("Run Emergency Data Repair?\n\nThis tool fixes 'Ghost Data', stuck syncs, and local corruptions.\n\nActions:\n1. Clears pending upload queues.\n2. Wipes volatile cache (Live Sessions).\n3. Forces a fresh download from the server.\n\nProceed?")) return;

    const btn = document.activeElement;
    if(btn) { btn.innerText = "Repairing..."; btn.disabled = true; }

    try {
        // 1. Clear Internal Queues (Stuck uploads/deletes)
        localStorage.removeItem('system_pending_deletes');
        
        // 2. Clear Hash Maps (Forces re-evaluation of all data)
        Object.keys(localStorage).forEach(k => {
            if (k.startsWith('hash_map_')) localStorage.removeItem(k);
        });
        
        // 3. Clear Volatile Data
        localStorage.setItem('liveSessions', '[]'); // Clear cached sessions
        localStorage.setItem('liveSession', '{"active":false}'); // Reset active session state

        // 4. Wipe Sync Timestamps (Forces full fresh pull)
        Object.keys(localStorage).forEach(k => {
            if (k.startsWith('row_sync_ts_')) localStorage.removeItem(k);
        });

        alert("Repair successful. The application will now reload to fetch fresh data.");
        location.reload();

    } catch(e) {
        alert("Repair Error: " + e.message);
        if(btn) { btn.innerText = "Emergency Repair"; btn.disabled = false; }
    }
};

window.performBlobToRowMigration = async function() {
    // Ask for mode
    const mode = confirm("Click OK for REAL MIGRATION (Uploads Data).\nClick CANCEL for DRY RUN (Simulation only).") ? 'real' : 'dry';
    
    if (mode === 'real') {
        if(!confirm("⚠️ FINAL WARNING: You are about to upload all local data to the new tables. Ensure no other admins are running migration simultaneously.")) return;
    }
    
    const btn = document.activeElement;
    const originalText = btn.innerText;
    btn.disabled = true; btn.innerText = mode === 'real' ? "Migrating..." : "Simulating...";
    
    try {
        let log = [];
        const uploadBatch = async (table, items, mapFn) => {
            if (items.length === 0) return;
            log.push(`${mode === 'real' ? 'Uploading' : 'Would upload'} ${items.length} items to '${table}'`);
            if (mode === 'dry') return; // Stop here for dry run
            
            const rows = items.map(mapFn);
            // Batch in chunks of 100
            for (let i = 0; i < rows.length; i += 100) {
                const chunk = rows.slice(i, i + 100);
                const { error } = await supabaseClient.from(table).upsert(chunk);
                if (error) throw error;
            }
        };

        // 0. Users (Row-Level Sync Migration)
        const users = JSON.parse(localStorage.getItem('users') || '[]');
        if(mode === 'real') { users.forEach(u => { if(!u.id) u.id = Date.now()+'_'+Math.random().toString(36).substr(2,9); }); localStorage.setItem('users', JSON.stringify(users)); }
        await uploadBatch('users', users, u => ({ id: u.id, data: u, updated_at: new Date().toISOString() }));

        // 1. Records
        const records = JSON.parse(localStorage.getItem('records') || '[]');
        if(mode === 'real') { records.forEach(r => { if(!r.id) r.id = Date.now()+'_'+Math.random().toString(36).substr(2,9); }); localStorage.setItem('records', JSON.stringify(records)); }
        await uploadBatch('records', records, r => ({ id: r.id || Date.now()+'_'+Math.random().toString(36).substr(2,9), trainee: r.trainee, data: r, updated_at: new Date().toISOString() }));

        // 2. Submissions
        const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
        if(mode === 'real') { subs.forEach(s => { if(!s.id) s.id = Date.now()+'_'+Math.random().toString(36).substr(2,9); }); localStorage.setItem('submissions', JSON.stringify(subs)); }
        await uploadBatch('submissions', subs, s => ({ id: s.id, trainee: s.trainee, data: s, updated_at: new Date().toISOString() }));

        // 3. Audit Logs
        const logs = JSON.parse(localStorage.getItem('auditLogs') || '[]');
        if(mode === 'real') { logs.forEach(l => { if(!l.id) l.id = Date.now()+'_'+Math.random().toString(36).substr(2,9); }); localStorage.setItem('auditLogs', JSON.stringify(logs)); }
        await uploadBatch('audit_logs', logs, l => ({ id: l.id || Date.now()+'_'+Math.random().toString(36).substr(2,9), user_id: l.user, data: l, updated_at: new Date().toISOString() }));

        // 4. Live Bookings
        const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
        if(mode === 'real') { bookings.forEach(b => { if(!b.id) b.id = Date.now()+'_'+Math.random().toString(36).substr(2,9); }); localStorage.setItem('liveBookings', JSON.stringify(bookings)); }
        await uploadBatch('live_bookings', bookings, b => ({ id: b.id, trainee: b.trainee, data: b, updated_at: new Date().toISOString() }));

        // 5. Monitor History
        const history = JSON.parse(localStorage.getItem('monitor_history') || '[]');
        if(mode === 'real') { history.forEach(h => { if(!h.id) h.id = Date.now()+'_'+Math.random().toString(36).substr(2,9); }); localStorage.setItem('monitor_history', JSON.stringify(history)); }
        await uploadBatch('monitor_history', history, h => ({ id: Date.now()+'_'+Math.random().toString(36).substr(2,9), user_id: h.user, data: h, updated_at: new Date().toISOString() }));

        // 6. Attendance
        const att = JSON.parse(localStorage.getItem('attendance_records') || '[]');
        if(mode === 'real') { att.forEach(a => { if(!a.id) a.id = Date.now()+'_'+Math.random().toString(36).substr(2,9); }); localStorage.setItem('attendance_records', JSON.stringify(att)); }
        await uploadBatch('attendance', att, a => ({ id: a.id || Date.now()+'_'+Math.random().toString(36).substr(2,9), user_id: a.user, data: a, updated_at: new Date().toISOString() }));

        // 7. Access Logs
        const access = JSON.parse(localStorage.getItem('accessLogs') || '[]');
        if(mode === 'real') { access.forEach(a => { if(!a.id) a.id = Date.now()+'_'+Math.random().toString(36).substr(2,9); }); localStorage.setItem('accessLogs', JSON.stringify(access)); }
        await uploadBatch('access_logs', access, a => ({ id: a.id || Date.now()+'_'+Math.random().toString(36).substr(2,9), user_id: a.user, data: a, updated_at: new Date().toISOString() }));

        // 8. Saved Reports
        const reports = JSON.parse(localStorage.getItem('savedReports') || '[]');
        if(mode === 'real') { reports.forEach(r => { if(!r.id) r.id = Date.now()+'_'+Math.random().toString(36).substr(2,9); }); localStorage.setItem('savedReports', JSON.stringify(reports)); }
        await uploadBatch('saved_reports', reports, r => ({ id: r.id.toString(), trainee: r.trainee, data: r, updated_at: new Date().toISOString() }));

        // 9. Archived Users
        const archives = JSON.parse(localStorage.getItem('graduated_agents') || '[]');
        if(mode === 'real') { archives.forEach(a => { if(!a.id) a.id = Date.now()+'_'+Math.random().toString(36).substr(2,9); }); localStorage.setItem('graduated_agents', JSON.stringify(archives)); }
        await uploadBatch('archived_users', archives, a => ({ id: a.id || Date.now()+'_'+Math.random().toString(36).substr(2,9), user_id: a.user, data: a, updated_at: new Date().toISOString() }));

        // 10. Live Sessions
        const sessions = JSON.parse(localStorage.getItem('liveSessions') || '[]');
        await uploadBatch('live_sessions', sessions, s => ({ id: s.sessionId || s.id, trainer: s.trainer, data: s, updated_at: new Date().toISOString() }));

        // 11. Link Requests
        const requests = JSON.parse(localStorage.getItem('linkRequests') || '[]');
        if(mode === 'real') { requests.forEach(r => { if(!r.id) r.id = Date.now()+'_'+Math.random().toString(36).substr(2,9); }); localStorage.setItem('linkRequests', JSON.stringify(requests)); }
        await uploadBatch('link_requests', requests, r => ({ id: r.id, trainee: r.trainee, data: r, updated_at: new Date().toISOString() }));

        // 12. Calendar Events
        const events = JSON.parse(localStorage.getItem('calendarEvents') || '[]');
        await uploadBatch('calendar_events', events, e => ({ id: e.id, created_by: e.createdBy, data: e, updated_at: new Date().toISOString() }));

        // 13. Tests (Assessments)
        const tests = JSON.parse(localStorage.getItem('tests') || '[]');
        if(mode === 'real') { tests.forEach(t => { if(!t.id) t.id = Date.now()+'_'+Math.random().toString(36).substr(2,9); }); localStorage.setItem('tests', JSON.stringify(tests)); }
        await uploadBatch('tests', tests, t => ({ id: t.id, title: t.title, type: t.type, data: t, updated_at: new Date().toISOString() }));

        if (mode === 'real') {
            alert("Migration Successful! All data is now in Row-Level tables.");
            checkRowSyncStatus(); // Refresh UI
        } else {
            alert("DRY RUN COMPLETE.\n\n" + log.join('\n'));
        }
    } catch(e) {
        alert("Migration Failed: " + e.message);
    } finally {
        btn.disabled = false; btn.innerText = originalText;
    }
};

window.renderStorageVisualizer = function() {
    const container = document.getElementById('sa_storage_viz');
    if(!container) return;
    
    let total = 0;
    const data = [];
    
    for(let key in localStorage) {
        if(localStorage.hasOwnProperty(key)) {
            const size = localStorage[key].length * 2; // Approx bytes
            total += size;
            data.push({ key, size });
        }
    }
    
    data.sort((a,b) => b.size - a.size);
    
    let html = `<div style="margin-bottom:10px; font-weight:bold;">Total Usage: ${formatBytes(total)}</div>`;
    
    data.slice(0, 8).forEach(item => {
        const pct = Math.round((item.size / total) * 100);
        let color = '#3498db';
        if(pct > 30) color = '#f1c40f';
        if(pct > 50) color = '#ff5252';
        
        html += `
            <div style="margin-bottom:5px; font-size:0.8rem;">
                <div style="display:flex; justify-content:space-between;">
                    <span>${item.key}</span>
                    <span>${formatBytes(item.size)} (${pct}%)</span>
                </div>
                <div style="height:6px; background:#333; border-radius:3px; overflow:hidden;">
                    <div style="width:${pct}%; height:100%; background:${color};"></div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
};

window.executeDataPatch = async function() {
    const code = document.getElementById('sa_patcher_code').value;
    const resultEl = document.getElementById('sa_patcher_result');
    
    if(!code.trim()) return;
    if(!confirm("Execute this patch? This can corrupt data if incorrect.")) return;
    
    try {
        // Load Context
        let users = JSON.parse(localStorage.getItem('users') || '[]');
        let records = JSON.parse(localStorage.getItem('records') || '[]');
        let rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        let system_config = JSON.parse(localStorage.getItem('system_config') || '{}');
        
        // Execute
        eval(code);
        
        // Save Context
        localStorage.setItem('users', JSON.stringify(users));
        localStorage.setItem('records', JSON.stringify(records));
        localStorage.setItem('rosters', JSON.stringify(rosters));
        localStorage.setItem('system_config', JSON.stringify(system_config));
        
        if(typeof saveToServer === 'function') await saveToServer(['users', 'records', 'rosters', 'system_config'], true);
        
        resultEl.innerText = "Patch Executed Successfully.";
        resultEl.style.color = "#2ecc71";
    } catch(e) {
        resultEl.innerText = "Error: " + e.message;
        resultEl.style.color = "#ff5252";
    }
};

window.sendSaAiMessage = async function() {
    const input = document.getElementById('sa_ai_input');
    const history = document.getElementById('sa_ai_chat_history');
    const text = input.value.trim();
    if (!text) return;

    // User Msg
    history.innerHTML += `<div style="margin-bottom:10px; text-align:right;"><span style="background:var(--primary); color:white; padding:8px 12px; border-radius:12px; display:inline-block;">${text}</span></div>`;
    input.value = '';
    history.scrollTop = history.scrollHeight;

    // Loading
    const loadingId = 'ai-loading-' + Date.now();
    history.innerHTML += `<div id="${loadingId}" style="margin-bottom:10px; text-align:left;"><span style="color:var(--text-muted);"><i class="fas fa-circle-notch fa-spin"></i> Thinking...</span></div>`;
    history.scrollTop = history.scrollHeight;

    // Call AI
    if (typeof AICore !== 'undefined' && typeof AICore.processRequest === 'function') {
        const response = await AICore.processRequest(text);
        document.getElementById(loadingId).remove();
        
        const formatted = response.replace(/\n/g, '<br>');
        history.innerHTML += `<div style="margin-bottom:10px; text-align:left;"><div style="background:var(--bg-card); border:1px solid var(--border-color); padding:10px; border-radius:10px; display:inline-block; max-width:90%; line-height:1.5;">${formatted}</div></div>`;
        history.scrollTop = history.scrollHeight;
    } else {
        document.getElementById(loadingId).remove();
        history.innerHTML += `<div style="color:#ff5252;">AI Core not available.</div>`;
    }
};

async function saveSuperAdminConfig() {
    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
    
    // Helper to safely get values without crashing
    const getVal = (id, def) => {
        const el = document.getElementById(id);
        return el ? el.value : def;
    };
    const getCheck = (id) => {
        const el = document.getElementById(id);
        return el ? el.checked : false;
    };

    config.sync_rates = {
        cloud: {
            admin: parseInt(getVal('sa_sync_cloud_admin', '4')) * 1000,
            teamleader: parseInt(getVal('sa_sync_cloud_tl', '60')) * 1000,
            trainee: parseInt(getVal('sa_sync_cloud_trainee', '15')) * 1000
        },
        local: {
            admin: parseInt(getVal('sa_sync_local_admin', '2')) * 1000,
            teamleader: parseInt(getVal('sa_sync_local_tl', '30')) * 1000,
            trainee: parseInt(getVal('sa_sync_local_trainee', '5')) * 1000
        },
        staging: {
            admin: parseInt(getVal('sa_sync_staging_admin', '4')) * 1000,
            teamleader: parseInt(getVal('sa_sync_staging_tl', '60')) * 1000,
            trainee: parseInt(getVal('sa_sync_staging_trainee', '15')) * 1000
        }
    };
    
    config.attendance = { ...config.attendance,
        work_start: getVal('sa_att_start', '08:00'),
        late_cutoff: getVal('sa_att_late', '08:15'),
        work_end: getVal('sa_att_end', '17:00'),
        reminder_start: getVal('sa_att_remind', '16:45'),
        lunch_start: getVal('sa_att_lunch_start', '12:00'),
        lunch_duration: parseInt(getVal('sa_att_lunch_dur', '60')) || 60
    };

    config.security = { ...config.security,
        maintenance_mode: getCheck('sa_sec_maint'),
        lockdown_mode: config.security.lockdown_mode || false, // Preserve lockdown state
        force_kiosk_global: getCheck('sa_sec_kiosk'),
        min_version: getVal('sa_sec_ver', '0.0.0'),
        banned_clients: getVal('sa_sec_banned', '').split(',').map(s => s.trim()).filter(s => s),
        client_whitelist: getVal('sa_sec_whitelist', '').split(',').map(s => s.trim()).filter(s => s)
    };

    config.features = { ...config.features, vetting_arena: getCheck('sa_feat_vet'), live_assessments: getCheck('sa_feat_live'), nps_surveys: getCheck('sa_feat_nps'), daily_tips: getCheck('sa_feat_tips'), disable_animations: getCheck('sa_feat_anim') };
    
    config.announcement = { active: getCheck('sa_ann_active'), message: getVal('sa_ann_msg', ''), type: getVal('sa_ann_type', 'info') };

    // FIX: Ensure default AI properties (endpoint, model) are preserved if local config is stale.
    const defaultAiConfig = (typeof DB_SCHEMA !== 'undefined' && DB_SCHEMA.system_config && DB_SCHEMA.system_config.ai) ? DB_SCHEMA.system_config.ai : {};
    config.ai = { 
        ...defaultAiConfig,
        ...(config.ai || {}),
        enabled: getCheck('sa_ai_enabled'),
        apiKey: getVal('sa_ai_key', '').trim(),
        model: getVal('sa_ai_model', 'gemini-2.5-flash')
    };

    config.server_settings = {
        active: getVal('sa_srv_active', 'cloud'),
        local_url: getVal('sa_srv_url', '').trim(),
        local_key: getVal('sa_srv_key', '').trim()
    };

    const oldTarget = localStorage.getItem('active_server_target');
    const newTarget = config.server_settings.active;

    // IMMEDIATE SWITCH: If Admin changes the target, apply it locally immediately
    // This prevents getting stuck on a dead 'local' server.
    if (newTarget !== oldTarget) {
        sessionStorage.removeItem('recovery_mode'); // Clear safety flag to allow manual switch
        if (typeof performSilentServerSwitch === 'function') {
            performSilentServerSwitch(newTarget);
        } else {
            localStorage.setItem('active_server_target', newTarget);
        }
    }

    localStorage.setItem('system_config', JSON.stringify(config));
    
    // STANDARD SAVE (To currently connected server)
    if (typeof saveToServer === 'function') await saveToServer(['system_config'], true);
    
    // Save Revoked Users Blacklist
    const revokedInput = document.getElementById('sa_sec_revoked');
    if (revokedInput) {
        const newRevoked = revokedInput.value.split(',').map(s => s.trim()).filter(s => s);
        localStorage.setItem('revokedUsers', JSON.stringify(newRevoked));
        if (typeof saveToServer === 'function') await saveToServer(['revokedUsers'], true);
    }

    // DUAL-WRITE: If switching servers, try to update the CLOUD config specifically
    // This ensures that even if we are on Local, the Cloud knows we are on Local (or vice versa).
    // This acts as the "Master Signal" for all clients.
    if (newTarget !== oldTarget && window.CLOUD_CREDENTIALS) {
        try {
            const cloudClient = window.supabase.createClient(window.CLOUD_CREDENTIALS.url, window.CLOUD_CREDENTIALS.key);
            await cloudClient.from('app_documents').upsert({ 
                key: 'system_config', 
                content: config, 
                updated_at: new Date().toISOString() 
            });
            console.log("System Config dual-written to Cloud Master.");
        } catch(e) { console.warn("Could not dual-write config to Cloud:", e); }
    }
    
    if(typeof logAuditAction === 'function') logAuditAction(CURRENT_USER.user, 'System Config', 'Updated Super Admin Settings');

    alert("Configuration Pushed. Clients will update on next sync.");
    document.getElementById('superAdminModal').remove();
    if(typeof applySystemConfig === 'function') applySystemConfig();
}

// --- NEW: AI DIAGNOSTICS TOOL ---
window.testGeminiConnection = async function() {
    const key = document.getElementById('sa_ai_key').value.trim();
    if (!key) return alert("Please enter an API key first.");
    
    const btn = document.activeElement;
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        
        const models = data.models.map(m => m.name.replace('models/', '')).filter(m => m.includes('gemini'));
        alert(`✅ Connection Successful!\n\nYour API Key supports these models:\n\n${models.join('\n')}\n\nPlease select one of these exact names from the dropdown.`);
    } catch (e) {
        alert(`❌ API Key Error:\n\n${e.message}`);
    } finally {
        btn.innerHTML = orig;
        btn.disabled = false;
    }
};

window.toggleLockdown = async function() {
    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
    if(!config.security) config.security = {};
    
    const newState = !config.security.lockdown_mode;
    
    if(newState) {
        if(!confirm("⚠️ ACTIVATE EMERGENCY LOCKDOWN?\n\n- All non-admin users will be logged out.\n- Logins will be disabled.\n- Database writes will be blocked.\n\nProceed?")) return;
    } else {
        if(!confirm("Deactivate Lockdown and restore normal access?")) return;
    }
    
    config.security.lockdown_mode = newState;
    localStorage.setItem('system_config', JSON.stringify(config));
    
    if(typeof saveToServer === 'function') await saveToServer(['system_config'], true);
    
    alert(`Lockdown is now ${newState ? 'ACTIVE' : 'INACTIVE'}.`);
    document.getElementById('superAdminModal').remove();
    openSuperAdminConfig(); // Refresh UI
};

function normalizeAdminIdentity(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[._-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function matchAdminIdentity(left, right) {
    const leftNorm = normalizeAdminIdentity(left).replace(/\s+/g, '');
    const rightNorm = normalizeAdminIdentity(right).replace(/\s+/g, '');
    return !!leftNorm && !!rightNorm && leftNorm === rightNorm;
}

window.returnFromImpersonation = function() {
    const realAdminRaw = sessionStorage.getItem('real_admin_identity');
    if (!realAdminRaw) return false;

    sessionStorage.setItem('currentUser', realAdminRaw);
    sessionStorage.removeItem('real_admin_identity');
    sessionStorage.removeItem('impersonating_user');
    try {
        const parsed = JSON.parse(realAdminRaw);
        if (parsed && typeof persistAppSession === 'function') persistAppSession(parsed);
    } catch (e) {}
    location.reload();
    return true;
};

window.impersonateUser = function(username) {
    if (!CURRENT_USER || CURRENT_USER.role !== 'super_admin') {
        alert("Only Super Admin can impersonate users.");
        return;
    }
    if (!confirm(`Impersonate ${username}? You will see exactly what they see.`)) return;
    
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const target = users.find(u => matchAdminIdentity(u && (u.user || u.username), username));
    
    if(!target) return alert("User not found.");
    if (matchAdminIdentity(target.user, CURRENT_USER.user)) return alert("You are already logged in as this user.");
    
    // Preserve original admin identity only once.
    if (!sessionStorage.getItem('real_admin_identity')) {
        sessionStorage.setItem('real_admin_identity', JSON.stringify(CURRENT_USER));
    }

    sessionStorage.setItem('impersonating_user', JSON.stringify({
        user: target.user,
        startedAt: new Date().toISOString()
    }));
    sessionStorage.setItem('currentUser', JSON.stringify(target));
    location.reload();
};

async function sendSystemBroadcast() {
    const msg = document.getElementById('sa_broadcast_msg').value;
    if(!msg) return alert("Enter a message.");
    
    if(!confirm("Send this popup message to ALL active users immediately?")) return;
    
    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
    const sound = true; // Default to sound on
    config.broadcast = { id: Date.now(), message: msg, sound: sound };
    
    localStorage.setItem('system_config', JSON.stringify(config));
    if (typeof saveToServer === 'function') await saveToServer(['system_config'], true);
    alert("Broadcast sent.");
}

async function refreshClientHealthTable() {
    const container = document.getElementById('sa_client_health_table');
    if (!container) return;

    const now = Date.now();
    const sessions = Object.values(window.ACTIVE_USERS_CACHE || {}).filter(u => (now - (u.local_received_at || 0)) < 90000);

    if (!sessions || sessions.length === 0) {
        container.innerHTML = `<div style="color:var(--text-muted);">No active sessions.</div>`;
        return;
    }

    let html = `<table class="admin-table compressed-table"><thead><tr><th>User</th><th>Client ID</th><th>Activity</th><th>Latency</th><th>Action</th></tr></thead><tbody>`;

    // Sort by last seen desc
    sessions.sort((a,b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());

    sessions.forEach(s => {
        const latency = s.latency || 0;
        let latColor = '#2ecc71';
        if (latency > 500) latColor = '#f1c40f';
        if (latency > 1500) latColor = '#ff5252';
        
        // Determine online status (Cache first, fallback to time)
        let isOnline = false;
        const uName = s.username || s.user || 'Unknown';
        
        if (window.ACTIVE_USERS_CACHE && window.ACTIVE_USERS_CACHE[uName]) {
            isOnline = (now - window.ACTIVE_USERS_CACHE[uName].local_received_at) < 90000;
        } else {
            isOnline = (now - new Date(s.lastSeen).getTime()) < 180000; // 3 min tolerance
        }

        const statusDot = isOnline ? `<span style="color:#2ecc71;">●</span>` : `<span style="color:#95a5a6;">○</span>`;
        const clientId = s.clientId || 'Unknown';
        const activity = s.activity || '-';
        const roleStr = s.role || '?';
        const safeUser = uName.replace(/'/g, "\\'"); 
        
        const banBtn = (clientId !== 'Unknown' && s.role !== 'super_admin') ? `<button class="btn-danger btn-sm" style="padding:0 4px; font-size:0.7rem; margin-left:5px;" onclick="banClient('${clientId}', '${s.username}')" title="Ban Terminal"><i class="fas fa-ban"></i></button>` : '';

        html += `<tr style="${isOnline ? '' : 'opacity:0.6;'}">
            <td>${statusDot} <strong>${uName}</strong> <span style="font-size:0.7rem; color:var(--text-muted);">(${roleStr})</span></td>
            <td style="font-family:monospace; font-size:0.8rem;">${clientId}${banBtn}</td>
            <td style="font-size:0.8rem; max-width:150px; overflow:hidden; text-overflow:ellipsis;" title="${activity}">${activity}</td>
            <td style="color:${latColor}; font-weight:bold;">${latency}ms</td>
            <td>
                <button class="btn-danger btn-sm" style="padding:0 5px;" onclick="sendRemoteCommand('${s.username}', 'logout')" title="Kick"><i class="fas fa-sign-out-alt"></i></button>
                <button class="btn-warning btn-sm" style="padding:0 5px;" onclick="sendRemoteCommand('${s.username}', 'restart')" title="Reload"><i class="fas fa-sync"></i></button>
                <button class="btn-primary btn-sm" style="padding:0 5px;" onclick="promptRemoteMessage('${safeUser}')" title="Message"><i class="fas fa-comment"></i></button>
            </td>
        </tr>`;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
}

// --- NETWORK HEALTH HISTORY (ADMIN VIEW) ---
window.renderNetworkHealthTable = async function() {
    // Container injection logic handled in index.html or dynamic builder below
    const container = document.getElementById('networkHealthTableContainer');
    if (!container) return; // Exit if container not present (will be added via HTML update)

    container.innerHTML = '<div style="color:var(--text-muted); padding:10px;"><i class="fas fa-circle-notch fa-spin"></i> Loading network history...</div>';

    if (!window.supabaseClient) {
        container.innerHTML = '<div style="color:#ff5252;">Offline: Cannot fetch history.</div>';
        return;
    }

    // Fetch last 50 records
    const { data: reports, error } = await window.supabaseClient
        .from('network_diagnostics')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(50);

    if (error) {
        container.innerHTML = `<div style="color:#ff5252;">Error: ${error.message}</div>`;
        return;
    }

    if (!reports || reports.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted); padding:10px;">No network reports found.</div>';
        return;
    }

    let html = `<table class="admin-table compressed-table">
        <thead><tr><th>Time</th><th>User</th><th>Gateway</th><th>Internet</th><th>Type</th><th>Status</th></tr></thead>
        <tbody>`;

    reports.forEach(row => {
        const r = row.data || {};
        const date = new Date(row.updated_at).toLocaleString();
        const gate = r.pings ? r.pings.gateway : '-';
        const net = r.pings ? r.pings.internet : '-';
        
        let status = '<span style="color:#2ecc71">Good</span>';
        if (gate === -1 || gate > 50 || net === -1 || net > 200) status = '<span style="color:#ff5252; font-weight:bold;">Poor</span>';
        else if (gate > 20 || net > 100) status = '<span style="color:#f1c40f">Fair</span>';

        html += `<tr>
            <td style="font-size:0.8rem;">${date}</td>
            <td><strong>${r.user}</strong></td>
            <td style="font-family:monospace;">${gate}ms</td>
            <td style="font-family:monospace;">${net}ms</td>
            <td>${r.stats ? r.stats.connType : '-'}</td>
            <td>${status}</td>
        </tr>`;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
};

async function promptRemoteMessage(username) {
    const msg = await customPrompt("Send Message", `Send private message to ${username}:`);
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
            .neq('username', 'placeholder'); // Safety filter to match all rows

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

// --- SYSTEM ERROR REPORTS ---
function isProblemReportEntry(report) {
    if (!report || typeof report !== 'object') return false;
    const type = String(report.type || report.reportType || '').toLowerCase();
    const source = String(report.source || report.origin || '').toLowerCase();
    return type === 'user_report' || source === 'report_problem' || !!report.issueDetail;
}

function getErrorReportCollections() {
    const parsed = (typeof safeLocalParse === 'function')
        ? safeLocalParse('error_reports', [])
        : JSON.parse(localStorage.getItem('error_reports') || '[]');
    const rawReports = Array.isArray(parsed) ? parsed : [];
    const allReports = rawReports.map(entry => {
        const data = entry && entry.data && typeof entry.data === 'object' ? entry.data : entry;
        return {
            ...(data || {}),
            id: (data && data.id) || (entry && entry.id) || `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            timestamp: (data && (data.timestamp || data.updated_at)) || (entry && (entry.timestamp || entry.updated_at)) || new Date().toISOString()
        };
    }).filter(Boolean);
    const problemReports = allReports.filter(isProblemReportEntry);
    const systemReports = allReports.filter(r => !isProblemReportEntry(r));
    return { allReports, systemReports, problemReports };
}

async function refreshErrorReportsFromServer() {
    if (!window.supabaseClient) return getErrorReportCollections();

    try {
        const { data, error } = await window.supabaseClient
            .from('error_reports')
            .select('id, data, updated_at')
            .order('updated_at', { ascending: false })
            .limit(500);

        if (error) throw error;

        const remoteReports = (Array.isArray(data) ? data : []).map(row => {
            const report = row && row.data && typeof row.data === 'object' ? { ...row.data } : {};
            if (!report.id && row.id) report.id = row.id;
            if (!report.timestamp && row.updated_at) report.timestamp = row.updated_at;
            return report;
        }).filter(report => report && report.id);

        const localReports = getErrorReportCollections().allReports;
        const merged = new Map();
        localReports.concat(remoteReports).forEach(report => {
            if (!report || !report.id) return;
            merged.set(String(report.id), report);
        });

        const ordered = Array.from(merged.values())
            .sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0))
            .slice(-500);

        localStorage.setItem('error_reports', JSON.stringify(ordered));
    } catch (err) {
        console.warn("Problem report refresh failed:", err);
    }

    return getErrorReportCollections();
}

function escapeReportHtml(value) {
    const str = String(value || '');
    if (typeof escapeHTML === 'function') return escapeHTML(str);
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function parseReportVersion(value) {
    const raw = String(value || '').replace(/^v/i, '').trim();
    const parts = raw.split('.').map(n => parseInt(n, 10));
    if (parts.some(n => Number.isNaN(n))) return null;
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function compareReportVersions(left, right) {
    const a = parseReportVersion(left);
    const b = parseReportVersion(right);
    if (!a || !b) return null;
    for (let i = 0; i < 3; i++) {
        if (a[i] < b[i]) return -1;
        if (a[i] > b[i]) return 1;
    }
    return 0;
}

function reportVersionAtMost(report, version) {
    const cmp = compareReportVersions(report && report.appVersion, version);
    return cmp !== null && cmp <= 0;
}

function getReportSearchText(report) {
    return [
        report && report.error,
        report && report.issueDetail,
        report && report.consoleSnapshot,
        report && report.activeTab,
        report && report.pageUrl
    ].map(v => String(v || '').toLowerCase()).join('\n');
}

function classifyResolvedOrNoisyReport(report) {
    const text = getReportSearchText(report);
    const tab = String((report && report.activeTab) || '').toLowerCase();

    if ((text.includes('could not exit') || text.includes('can not exit') || text.includes('still running')) && tab === 'live-execution' && reportVersionAtMost(report, '2.6.29')) {
        return { hidden: true, reason: 'Resolved: live-session release fixed after v2.6.29.' };
    }
    if ((text.includes('kicks me to the top') || text.includes('top of the page') || text.includes('starts syncing')) && tab === 'study-notes' && reportVersionAtMost(report, '2.6.29')) {
        return { hidden: true, reason: 'Resolved: Study Notes no-refresh/local-only behavior is now active.' };
    }
    if ((text.includes("cannot read properties of undefined (reading 'questions')") || text.includes('cannot set properties of undefined')) && text.includes('live') && reportVersionAtMost(report, '2.6.36')) {
        return { hidden: true, reason: 'Resolved: live summary save now guards missing test/session data.' };
    }
    if (text.includes('rest/v1/records') && text.includes('http 500') && reportVersionAtMost(report, '2.6.36')) {
        return { hidden: true, reason: 'Resolved: records upload now dedupes duplicate IDs and fails visibly if rejected.' };
    }
    if (text.includes('pollvettingsession is not defined') && reportVersionAtMost(report, '2.6.29')) {
        return { hidden: true, reason: 'Resolved: legacy Vetting runtime reference from old clients.' };
    }
    if (text.includes('http 503 service unavailable') || text.includes('could not query the database for the schema cache') || text.includes('pgrst002')) {
        return { hidden: true, reason: 'Server availability event, not an app-code fault.' };
    }
    if (text.includes('guest_view_manager_call') || text.includes('err_name_not_resolved') || text.includes('view.genially.com') || text.includes('sharepoint.com')) {
        return { hidden: true, reason: 'External content/network load failure.' };
    }

    return { hidden: false, reason: '' };
}

function shouldHideResolvedReports() {
    return localStorage.getItem('hide_resolved_error_reports') !== 'false';
}

window.toggleResolvedReportVisibility = function() {
    const next = shouldHideResolvedReports() ? 'false' : 'true';
    localStorage.setItem('hide_resolved_error_reports', next);
    const systemModal = document.getElementById('errorReportModal');
    const problemModal = document.getElementById('problemReportModal');
    if (systemModal) {
        systemModal.remove();
        viewSystemErrors();
    }
    if (problemModal) {
        problemModal.remove();
        viewProblemReports();
    }
};

async function viewSystemErrors() {
    const { systemReports: allSystemReports } = await refreshErrorReportsFromServer();
    const hideResolved = shouldHideResolvedReports();
    const resolvedCount = allSystemReports.filter(r => classifyResolvedOrNoisyReport(r).hidden).length;
    const reports = hideResolved
        ? allSystemReports.filter(r => !classifyResolvedOrNoisyReport(r).hidden)
        : allSystemReports;
    
    // Update "Last Seen" count to stop notifications
    localStorage.setItem('last_seen_error_count', allSystemReports.length.toString());

    const uniqueUsers = new Set(reports.map(r => r.user)).size;

    let html = `<div class="modal-overlay" id="errorReportModal" style="z-index:10002;">
        <div class="modal-box report-workspace-modal">
            <div class="modal-header">
                <div>
                    <h3 style="margin:0; color:#ff5252;"><i class="fas fa-bug"></i> System Error Reports</h3>
                    <div style="font-size:0.8rem; color:var(--text-muted); margin-top:5px;">${reports.length} active errors from ${uniqueUsers} unique users${resolvedCount ? ` (${resolvedCount} resolved/noisy hidden)` : ''}</div>
                </div>
                <div style="display:flex; gap:10px;">
                    <button class="btn-secondary btn-sm" onclick="toggleResolvedReportVisibility()">${hideResolved ? 'Show Resolved/Noise' : 'Hide Resolved/Noise'}</button>
                    <button class="btn-warning btn-sm" onclick="clearSystemErrors()">Clear All</button>
                    <button class="btn-secondary btn-sm" onclick="document.getElementById('errorReportModal').remove()">&times;</button>
                </div>
            </div>
            <div class="admin-data-workspace">
                <aside class="admin-data-sidebar">
                    <div class="workspace-stat-grid">
                        <div class="workspace-stat"><span>Active</span><strong>${reports.length}</strong></div>
                        <div class="workspace-stat"><span>Users</span><strong>${uniqueUsers}</strong></div>
                        <div class="workspace-stat"><span>Hidden</span><strong>${resolvedCount}</strong></div>
                        <div class="workspace-stat"><span>Mode</span><strong>${hideResolved ? 'Clean' : 'All'}</strong></div>
                    </div>
                    <div class="workspace-rule-box">
                        <h4>Triage Focus</h4>
                        <ul>
                            <li>Newest reports are shown first.</li>
                            <li>Resolved/noisy items are hidden by default.</li>
                            <li>Use Analyze for app errors that repeat across users.</li>
                        </ul>
                    </div>
                </aside>
                <main class="report-workspace-detail">
            <div class="table-responsive">
                <table class="admin-table">
                    <thead><tr><th>Time</th><th>User</th><th>Error Message</th><th>Action</th></tr></thead>
                    <tbody>`;
    
    if (reports.length === 0) {
        html += `<tr><td colspan="4" class="text-center" style="color:var(--text-muted);">No errors reported.</td></tr>`;
    } else {
        // Show newest first
        reports.slice().reverse().forEach(r => {
            const time = new Date(r.timestamp).toLocaleString();
            const rawMsg = String(r.error || 'Unknown error');
            const classification = classifyResolvedOrNoisyReport(r);
            const safeMsg = rawMsg.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const safeDisplayMsg = escapeReportHtml(rawMsg.length > 180 ? `${rawMsg.slice(0, 180)}...` : rawMsg);
            const safeUser = escapeReportHtml(r.user || 'Unknown');
            const safeRole = escapeReportHtml(r.role || 'Unknown');
            const statusBadge = classification.hidden ? `<br><span style="font-size:0.68rem; color:#f1c40f;">${escapeReportHtml(classification.reason)}</span>` : '';
            
            html += `<tr>
                <td style="font-size:0.8rem; white-space:nowrap;">${time}</td>
                <td><strong>${safeUser}</strong><br><span style="font-size:0.7rem; color:var(--text-muted);">${safeRole}</span></td>
                <td style="font-family:monospace; font-size:0.8rem; color:#ff5252;">${safeDisplayMsg}${statusBadge}</td>
                <td><button class="btn-primary btn-sm" onclick="AICore.analyzeError('${safeMsg}')" title="Ask AI to Diagnose"><i class="fas fa-robot"></i> Analyze</button></td>
            </tr>`;
        });
    }

    html += `</tbody></table></div></main></div></div></div>`;
    document.body.insertAdjacentHTML('beforeend', html);
}

async function clearSystemErrors() {
    if(!confirm("Clear all system error reports?")) return;
    const { allReports, problemReports } = getErrorReportCollections();
    const removed = allReports.filter(r => !isProblemReportEntry(r));
    localStorage.setItem('error_reports', JSON.stringify(problemReports));

    if (window.supabaseClient && removed.length > 0) {
        const ids = removed.map(r => r.id).filter(Boolean);
        const CHUNK = 100;
        for (let i = 0; i < ids.length; i += CHUNK) {
            const slice = ids.slice(i, i + CHUNK);
            await window.supabaseClient.from('error_reports').delete().in('id', slice);
        }
    }

    if (typeof saveToServer === 'function') {
        await saveToServer(['error_reports'], true, true);
    }

    const modal = document.getElementById('errorReportModal');
    if (modal) modal.remove();
    viewSystemErrors();
}

async function viewProblemReports() {
    const { problemReports: allProblemReports } = await refreshErrorReportsFromServer();
    const hideResolved = shouldHideResolvedReports();
    const resolvedCount = allProblemReports.filter(r => classifyResolvedOrNoisyReport(r).hidden).length;
    const reports = hideResolved
        ? allProblemReports.filter(r => !classifyResolvedOrNoisyReport(r).hidden)
        : allProblemReports;
    const uniqueUsers = new Set(reports.map(r => r.user)).size;

    localStorage.setItem('last_seen_problem_report_count', allProblemReports.length.toString());
    if (typeof updateNotifications === 'function') updateNotifications();

    let html = `<div class="modal-overlay" id="problemReportModal" style="z-index:10002;">
        <div class="modal-box report-workspace-modal">
            <div class="modal-header">
                <div>
                    <h3 style="margin:0; color:#ff6b6b;"><i class="fas fa-question-circle"></i> Problem Reports</h3>
                    <div style="font-size:0.8rem; color:var(--text-muted); margin-top:5px;">${reports.length} active reports from ${uniqueUsers} unique users${resolvedCount ? ` (${resolvedCount} resolved/noisy hidden)` : ''}</div>
                </div>
                <div style="display:flex; gap:10px;">
                    <button class="btn-secondary btn-sm" onclick="toggleResolvedReportVisibility()">${hideResolved ? 'Show Resolved/Noise' : 'Hide Resolved/Noise'}</button>
                    <button class="btn-warning btn-sm" onclick="clearProblemReports()">Clear Problem Reports</button>
                    <button class="btn-secondary btn-sm" onclick="document.getElementById('problemReportModal').remove()">&times;</button>
                </div>
            </div>
            <div class="admin-data-workspace">
                <aside class="admin-data-sidebar">
                    <div class="workspace-stat-grid">
                        <div class="workspace-stat"><span>Active</span><strong>${reports.length}</strong></div>
                        <div class="workspace-stat"><span>Users</span><strong>${uniqueUsers}</strong></div>
                        <div class="workspace-stat"><span>Hidden</span><strong>${resolvedCount}</strong></div>
                        <div class="workspace-stat"><span>Mode</span><strong>${hideResolved ? 'Clean' : 'All'}</strong></div>
                    </div>
                    <div class="workspace-rule-box">
                        <h4>Review Flow</h4>
                        <ul>
                            <li>Open details for user wording and console snapshots.</li>
                            <li>Ignore resolved historical noise while checking current problems.</li>
                            <li>Clear only after you are happy the latest release covers it.</li>
                        </ul>
                    </div>
                </aside>
                <main class="report-workspace-detail">
            <div class="table-responsive">
                <table class="admin-table">
                    <thead><tr><th>Time</th><th>User</th><th>Issue</th><th>Context</th><th>Action</th></tr></thead>
                    <tbody>`;

    if (reports.length === 0) {
        html += `<tr><td colspan="5" class="text-center" style="color:var(--text-muted);">No problem reports submitted.</td></tr>`;
    } else {
        reports.slice().reverse().forEach(r => {
            const time = new Date(r.timestamp).toLocaleString();
            const safeUser = escapeReportHtml(r.user || 'Unknown');
            const safeRole = escapeReportHtml(r.role || 'Unknown');
            const issueRaw = String(r.issueDetail || r.error || 'No issue details provided.');
            const classification = classifyResolvedOrNoisyReport(r);
            const issuePreview = issueRaw.length > 150 ? `${issueRaw.slice(0, 150)}...` : issueRaw;
            const safeIssue = escapeReportHtml(issuePreview) + (classification.hidden ? `<br><span style="font-size:0.68rem; color:#f1c40f;">${escapeReportHtml(classification.reason)}</span>` : '');
            const context = `${r.activeTab || 'unknown tab'} | v${r.appVersion || 'Unknown'}`;
            const safeContext = escapeReportHtml(context);
            const safeId = String(r.id || '').replace(/'/g, "\\'");

            html += `<tr>
                <td style="font-size:0.8rem; white-space:nowrap;">${time}</td>
                <td><strong>${safeUser}</strong><br><span style="font-size:0.7rem; color:var(--text-muted);">${safeRole}</span></td>
                <td style="font-size:0.85rem;">${safeIssue}</td>
                <td style="font-size:0.78rem; color:var(--text-muted);">${safeContext}</td>
                <td><button class="btn-primary btn-sm" onclick="viewProblemReportDetails('${safeId}')"><i class="fas fa-eye"></i> Details</button></td>
            </tr>`;
        });
    }

    html += `</tbody></table></div></main></div></div></div>`;
    const existing = document.getElementById('problemReportModal');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', html);
}

function viewProblemReportDetails(reportId) {
    const { problemReports } = getErrorReportCollections();
    const report = problemReports.find(r => String(r.id) === String(reportId));
    if (!report) {
        alert("Problem report not found.");
        return;
    }

    const safeIssueDetail = escapeReportHtml(report.issueDetail || report.error || 'No issue details provided.');
    const safeConsole = escapeReportHtml(report.consoleSnapshot || 'No console snapshot was included.');
    const safeUser = escapeReportHtml(report.user || 'Unknown');
    const safeRole = escapeReportHtml(report.role || 'Unknown');
    const safeTab = escapeReportHtml(report.activeTab || 'unknown');
    const safeVersion = escapeReportHtml(report.appVersion || 'Unknown');
    const safeUrl = escapeReportHtml(report.pageUrl || 'Unknown');
    const submittedAt = new Date(report.timestamp).toLocaleString();

    const html = `<div class="modal-overlay" id="problemReportDetailModal" style="z-index:10003;">
        <div class="modal-box" style="width:980px; max-height:92vh; display:flex; flex-direction:column;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <h3 style="margin:0; color:#ff6b6b;"><i class="fas fa-file-alt"></i> Problem Report Detail</h3>
                <button class="btn-secondary btn-sm" onclick="document.getElementById('problemReportDetailModal').remove()">&times;</button>
            </div>
            <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:10px;">
                <strong>User:</strong> ${safeUser} (${safeRole}) | <strong>Submitted:</strong> ${submittedAt}<br>
                <strong>Tab:</strong> ${safeTab} | <strong>Version:</strong> ${safeVersion}<br>
                <strong>URL:</strong> ${safeUrl}
            </div>
            <label style="font-weight:bold; margin-bottom:6px;">Issue Details</label>
            <textarea readonly style="width:100%; min-height:130px; resize:vertical; margin-bottom:12px;">${safeIssueDetail}</textarea>
            <label style="font-weight:bold; margin-bottom:6px;">Console Snapshot</label>
            <textarea readonly style="width:100%; min-height:320px; resize:vertical; font-family:monospace; font-size:0.78rem;">${safeConsole}</textarea>
            <div style="text-align:right; margin-top:12px;">
                <button class="btn-secondary" onclick="document.getElementById('problemReportDetailModal').remove()">Close</button>
            </div>
        </div>
    </div>`;

    const existing = document.getElementById('problemReportDetailModal');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', html);
}

async function clearProblemReports() {
    if (!confirm("Clear all problem reports?")) return;
    const { allReports, systemReports } = getErrorReportCollections();
    const removed = allReports.filter(isProblemReportEntry);
    localStorage.setItem('error_reports', JSON.stringify(systemReports));

    if (window.supabaseClient && removed.length > 0) {
        const ids = removed.map(r => r.id).filter(Boolean);
        const CHUNK = 100;
        for (let i = 0; i < ids.length; i += CHUNK) {
            const slice = ids.slice(i, i + CHUNK);
            await window.supabaseClient.from('error_reports').delete().in('id', slice);
        }
    }

    if (typeof saveToServer === 'function') {
        await saveToServer(['error_reports'], true, true);
    }

    localStorage.setItem('last_seen_problem_report_count', '0');
    if (typeof updateNotifications === 'function') updateNotifications();

    const modal = document.getElementById('problemReportModal');
    if (modal) modal.remove();
    viewProblemReports();
}

window.testServerConnections = async function() {
    const updateStatus = (id, status, latency) => {
        const el = document.getElementById(id);
        if(!el) return;
        if(status === 'checking') {
            el.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Checking...';
            el.style.color = 'var(--text-muted)';
        } else if (status === 'online') {
            el.innerHTML = `<i class="fas fa-check-circle"></i> Online (${latency}ms)`;
            el.style.color = '#2ecc71';
        } else {
            el.innerHTML = `<i class="fas fa-times-circle"></i> Offline`;
            el.style.color = '#ff5252';
        }
    };

    // Helper: Timeout Wrapper (5s limit)
    const checkWithTimeout = (client, ms = 5000) => {
        return Promise.race([
            client.from('app_documents').select('key').limit(1),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), ms))
        ]);
    };

    // 1. Test Cloud
    updateStatus('status_cloud', 'checking');
    const cloudUrl = window.CLOUD_CREDENTIALS ? window.CLOUD_CREDENTIALS.url : '';
    const cloudKey = window.CLOUD_CREDENTIALS ? window.CLOUD_CREDENTIALS.key : '';
    if(cloudUrl && cloudKey) {
        const start = Date.now();
        try { const client = window.supabase.createClient(cloudUrl, cloudKey, { auth: { persistSession: false, storageKey: 'test-cloud-' + Date.now() } }); await checkWithTimeout(client); updateStatus('status_cloud', 'online', Date.now() - start); } catch(e) { updateStatus('status_cloud', 'offline'); }
    } else { document.getElementById('status_cloud').innerText = "No Config"; }

    // 2. Test Local
    updateStatus('status_local', 'checking');
    const localUrl = document.getElementById('sa_srv_url').value.trim();
    const localKey = document.getElementById('sa_srv_key').value.trim();
    if(localUrl && localKey) {
        const start = Date.now();
        try { const client = window.supabase.createClient(localUrl, localKey, { auth: { persistSession: false, storageKey: 'test-local-' + Date.now() } }); await checkWithTimeout(client); updateStatus('status_local', 'online', Date.now() - start); } catch(e) { updateStatus('status_local', 'offline'); }
    } else { document.getElementById('status_local').innerText = "Not Configured"; }
};

window.switchToStaging = function() {
    let url = document.getElementById('sa_stage_url').value.trim();
    const key = document.getElementById('sa_stage_key').value.trim();
    
    if(!url || !key) return alert("Enter Staging URL and Key.");
    
    // FIX: Auto-prepend http:// if protocol is missing
    if (!url.match(/^https?:\/\//)) url = 'http://' + url;

    localStorage.setItem('staging_credentials', JSON.stringify({ url, key }));
    // Clear recovery mode to ensure it sticks
    sessionStorage.removeItem('recovery_mode');
    
    if (typeof performSilentServerSwitch === 'function') {
        performSilentServerSwitch('staging');
        const modal = document.getElementById('superAdminModal');
        if (modal) modal.remove();
    } else {
        localStorage.setItem('active_server_target', 'staging');
        alert("Switched to Staging Mode. App will reload connected to the test server.");
        location.reload();
    }
};

window.exitStaging = function() {
    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
    const target = (config.server_settings && config.server_settings.active) ? config.server_settings.active : 'cloud';
    
    sessionStorage.removeItem('recovery_mode');
    
    if (typeof performSilentServerSwitch === 'function') {
        performSilentServerSwitch(target);
        const modal = document.getElementById('superAdminModal');
        if (modal) modal.remove();
    } else {
        localStorage.setItem('active_server_target', target);
        alert(`Exiting Staging Mode.\n\nReverting to ${target.toUpperCase()} (Production).`);
        location.reload();
    }
};

window.forceMigrationPush = async function() {
    const target = localStorage.getItem('active_server_target') || 'cloud';
    const targetName = target === 'local' ? 'LOCAL (VM)' : (target === 'staging' ? 'STAGING' : 'CLOUD (Production)');

    if(!confirm(`Force push ALL local data to the ${targetName} server?\n\nThis will OVERWRITE the server data with your local data.\n\nUse this to seed a new server.`)) return;
    
    // SAFETY: Prevent accidental nuke of Cloud
    if (target === 'cloud') {
        const verify = await customPrompt("⚠️ CRITICAL WARNING", "You are about to overwrite the LIVE CLOUD DATABASE.\n\nThis is dangerous if other users are active.\n\nType 'OVERWRITE' to proceed:");
        if (verify !== 'OVERWRITE') return;
    }
    
    const btn = document.activeElement;
    btn.disabled = true; btn.innerText = "Migrating...";
    
    // Reset Hash Maps to force row upload
    Object.keys(localStorage).forEach(k => {
        if(k.startsWith('hash_map_')) localStorage.removeItem(k);
    });
    
    try {
        await saveToServer(null, false);
        
        // --- NEW: MIRROR CLEANUP (Kill Zombies) ---
        // We need to ensure the server doesn't have extra records we deleted locally.
        // This is expensive but necessary for a clean migration.
        if (window.supabaseClient) {
            const tables = ['records', 'submissions', 'live_bookings', 'attendance', 'saved_reports', 'insight_reviews', 'link_requests'];
            
            for (const table of tables) {
                // 1. Get all IDs from server
                const { data: serverIds, error } = await window.supabaseClient.from(table).select('id');
                if (error) continue;
                
                // 2. Get all IDs from local
                // Map table name back to local key (reverse ROW_MAP)
                const localKey = Object.keys(ROW_MAP).find(k => ROW_MAP[k] === table);
                if (!localKey) continue;
                
                const localData = JSON.parse(localStorage.getItem(localKey) || '[]');
                const localIdSet = new Set(localData.map(i => i.id ? i.id.toString() : null).filter(i => i));
                
                // 3. Find IDs on server that are NOT in local
                const toDelete = serverIds.filter(row => !localIdSet.has(row.id.toString())).map(r => r.id);
                
                // 4. Delete them
                if (toDelete.length > 0) {
                    await window.supabaseClient.from(table).delete().in('id', toDelete);
                    console.log(`Mirror Sync: Deleted ${toDelete.length} zombie records from ${table}`);
                }
            }
        }
        
        alert("Migration Push Complete.");
    } catch(e) {
        alert("Migration Failed: " + e.message);
    } finally {
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-upload"></i> Force Data Migration';
    }
};

window.performOrphanCleanup = async function(silent = false) {
    // Use the robust function from data.js if available
    if (typeof syncOrphans === 'function') {
        // FIX: Only hijack UI if NOT silent (User triggered)
        const btn = (!silent && document.activeElement && document.activeElement.tagName === 'BUTTON') ? document.activeElement : null;
        
        if(btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...'; }
        
        const count = await syncOrphans(silent);
        
        // FIX: Update timestamp to prevent infinite loop in background sync
        localStorage.setItem('last_orphan_cleanup_ts', Date.now().toString());
        
        if(btn) { btn.disabled = false; btn.innerText = "Sync Check (Orphans)"; }
        if(!silent && count === 0) alert("Sync Check Complete. Local data is consistent with server.");
        return;
    }

    if(!silent && !confirm("Run Sync Check (Orphan Cleanup)?\n\nThis will compare your local data against the server. Any local items that do not exist on the server (because they were hard-deleted elsewhere) will be removed from this device.\n\nProceed?")) return;

    const btn = (!silent && document.activeElement && document.activeElement.tagName === 'BUTTON') ? document.activeElement : null;
    let originalText = "";
    if(btn) {
        originalText = btn.innerText;
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';
    }

    const map = [
        { key: 'records', table: 'records' },
        { key: 'submissions', table: 'submissions' },
        { key: 'auditLogs', table: 'audit_logs' },
        { key: 'liveBookings', table: 'live_bookings' },
        { key: 'attendance_records', table: 'attendance' },
        { key: 'graduated_agents', table: 'archived_users' },
        { key: 'savedReports', table: 'saved_reports' },
        { key: 'linkRequests', table: 'link_requests' },
        { key: 'calendarEvents', table: 'calendar_events' },
        { key: 'monitor_history', table: 'monitor_history' },
        { key: 'error_reports', table: 'error_reports' },
        { key: 'liveSessions', table: 'live_sessions', idField: 'sessionId' }, // Special case
        { key: 'insightReviews', table: 'insight_reviews' },
        { key: 'exemptions', table: 'exemptions' },
        { key: 'nps_responses', table: 'nps_responses' }
    ];

    let totalRemoved = 0;
    let report = [];

    try {
        if (!window.supabaseClient) throw new Error("Not connected to cloud.");

        for (const item of map) {
            // 1. Load local rows first, then ask the server only about those IDs.
            // Pulling every ID from high-volume telemetry tables can hit Supabase statement timeouts.
            const localData = JSON.parse(localStorage.getItem(item.key) || '[]');
            if (!Array.isArray(localData) || localData.length === 0) continue;

            const idField = item.idField || 'id';
            const localIds = Array.from(new Set(
                localData
                    .map(localItem => localItem && localItem[idField])
                    .filter(localId => localId !== undefined && localId !== null && String(localId).trim() !== '')
                    .map(localId => String(localId))
            ));

            if (localIds.length === 0) continue;

            const allIds = new Set();
            let lookupFailed = false;
            const pageSize = 100;

            for (let i = 0; i < localIds.length; i += pageSize) {
                const chunk = localIds.slice(i, i + pageSize);
                const { data, error } = await window.supabaseClient
                    .from(item.table)
                    .select('id')
                    .in('id', chunk);
                
                if (error) {
                    console.error(`Error fetching IDs for ${item.table}:`, error);
                    lookupFailed = true;
                    break;
                }

                if (Array.isArray(data) && data.length > 0) {
                    data.forEach(row => allIds.add(row.id.toString()));
                }
            }

            // If a lookup failed, leave this table untouched. Orphan cleanup must never guess-delete data.
            if (lookupFailed) continue;

            // 2. Filter Orphans
            const cleanData = localData.filter(localItem => {
                const localId = localItem[idField];
                if (!localId) return true; // Keep items without IDs (unsafe to delete)
                return allIds.has(localId.toString());
            });

            const removedCount = localData.length - cleanData.length;
            
            if (removedCount > 0) {
                localStorage.setItem(item.key, JSON.stringify(cleanData));
                totalRemoved += removedCount;
                report.push(`${item.key}: -${removedCount}`);
            }
        }

        // Update timestamp for automation
        localStorage.setItem('last_orphan_cleanup_ts', Date.now().toString());

        if (totalRemoved > 0) {
            const msg = `Sync Check Complete.\n\nRemoved ${totalRemoved} orphan items:\n${report.join('\n')}`;
            if(!silent) alert(msg);
            else console.log(msg);

            if (typeof checkRowSyncStatus === 'function') checkRowSyncStatus();
            if (typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
        } else {
            if(!silent) alert("Sync Check Complete. Local data is consistent with server.");
        }

    } catch (e) {
        if(!silent) alert("Sync Check Failed: " + e.message);
        else console.error("Background Sync Check Failed:", e);
    } finally {
        if(btn) { btn.disabled = false; btn.innerText = originalText; }
    }
};

window.verifyServerSchema = async function() {
    const btn = document.activeElement;
    if(btn) { btn.innerText = "Checking..."; btn.disabled = true; }

    try {
        if (!window.supabaseClient) throw new Error("Not connected.");

        // Check 'sessions' table for 'username' column
        // We do this by trying to select it. If it fails, schema is wrong.
        const { error } = await window.supabaseClient.from('sessions').select('username').limit(1);
        
        if (error) {
            alert("❌ Schema Mismatch Detected!\n\nThe connected server is missing the 'username' column in the 'sessions' table.\n\nPlease run the migration SQL script on this server.");
        } else {
            alert("✅ Schema Verified.\n\nThe connected server is compatible with this version of the app.");
        }
    } catch (e) {
        alert("Verification Error: " + e.message);
    } finally {
        if(btn) { btn.innerText = "Verify Schema"; btn.disabled = false; }
    }
};

window.openDevTools = function() {
    if (typeof require !== 'undefined') {
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('open-devtools');
    }
};

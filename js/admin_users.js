/* ================= ADMIN: USERS & ROSTERS ================= */
/* Responsibility: Handling Rosters, Users, Groups, and Permissions */

// Global State for User Operations
let userToMove = null;
let editTargetIndex = -1;
let editTargetUsername = '';
let _legacyRetrainArchiveSplitRunning = false;

function isRetrainArchiveEntry(entry) {
    const reason = String((entry && entry.reason) || '').toLowerCase().trim();
    return reason.startsWith('moved to ');
}

function readRetrainArchives() {
    return JSON.parse(localStorage.getItem('retrain_archives') || '[]');
}

async function splitLegacyRetrainArchives() {
    if (_legacyRetrainArchiveSplitRunning) return;
    if (localStorage.getItem('archive_split_v268') === 'true') return;

    _legacyRetrainArchiveSplitRunning = true;
    try {
        const graduates = JSON.parse(localStorage.getItem('graduated_agents') || '[]');
        if (!Array.isArray(graduates) || graduates.length === 0) {
            localStorage.setItem('archive_split_v268', 'true');
            return;
        }

        const retrainLegacy = graduates.filter(isRetrainArchiveEntry);
        if (retrainLegacy.length === 0) {
            localStorage.setItem('archive_split_v268', 'true');
            return;
        }

        const keepGraduates = graduates.filter(g => !isRetrainArchiveEntry(g));
        const currentRetrain = readRetrainArchives();
        const seen = new Set(currentRetrain.map(r => String(r.id || '').trim()).filter(Boolean));

        retrainLegacy.forEach((entry, idx) => {
            const id = entry.id || (`retrain_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`);
            const reason = String(entry.reason || '');
            const targetGroup = reason.replace(/^Moved to\s*/i, '').trim() || 'Unknown';
            if (seen.has(id)) return;
            seen.add(id);
            currentRetrain.push({
                ...entry,
                id,
                archiveType: 'retrain',
                targetGroup,
                movedDate: entry.movedDate || entry.graduatedDate || new Date().toISOString()
            });
        });

        localStorage.setItem('graduated_agents', JSON.stringify(keepGraduates));
        localStorage.setItem('retrain_archives', JSON.stringify(currentRetrain));
        localStorage.setItem('archive_split_v268', 'true');

        if (typeof saveToServer === 'function') {
            await saveToServer(['graduated_agents', 'retrain_archives'], true, true);
        }
    } catch (e) {
        console.warn('Legacy retrain archive split failed:', e);
    } finally {
        _legacyRetrainArchiveSplitRunning = false;
    }
}

// --- HELPER: INSTANT SAVE ---
// Uses force=true to skip the fetch/merge process for Admin actions.
// This ensures deletions and edits are authoritative and instant.
async function secureUserSave() {
    if (typeof saveToServer === 'function') {
        const btn = document.activeElement;
        let originalText = "";
        
        if(btn && btn.tagName === 'BUTTON') {
            originalText = btn.innerText;
            btn.innerText = "Saving...";
            btn.disabled = true;
        }

        try {
            // UPDATED: Use force=true to ensure User/Roster edits are authoritative.
            // This prevents "Ghost Reverts" when changing passwords or updating groups.
            await saveToServer(['users', 'rosters', 'revokedUsers'], true); 
        } catch(e) {
            console.error("User Save Error:", e);
        } finally {
            if(btn && btn.tagName === 'BUTTON') {
                btn.innerText = originalText;
                btn.disabled = false;
            }
        }
    }
}

// --- MENU VISIBILITY CONTROL ---
function restrictTraineeMenu() {
    if(!CURRENT_USER) return;
    const nav = document.querySelector('.admin-sub-nav');
    if(!nav) return;
    
    const btns = nav.querySelectorAll('.sub-tab-btn');
    const isRestricted = (CURRENT_USER.role === 'trainee' || CURRENT_USER.role === 'teamleader');

    btns.forEach(btn => {
        const txt = btn.innerText;
        if(isRestricted) {
            if (txt.includes("Manage Users") || txt.includes("Theme Settings") || txt.includes("System Updates")) {
                btn.style.display = ''; 
            } else {
                btn.style.display = 'none'; 
            }
        } else {
            btn.style.display = ''; 
        }
    });
}

// --- ROSTER / GROUP MANAGEMENT ---

function populateYearSelect() { 
    const s = document.getElementById('newGroupYear'); 
    if (s) { 
        s.innerHTML = ''; 
        const currentYear = new Date().getFullYear();
        for(let i = currentYear + 1; i >= 2021; i--) { 
            s.add(new Option(i,i)); 
        } 
        s.value = currentYear;
    } 
}

function toggleGroupMode() {
    const radio = document.querySelector('input[name="groupMode"]:checked');
    if(!radio) return;

    const mode = radio.value;
    const createDiv = document.getElementById('groupCreateControls');
    const existDiv = document.getElementById('groupExistControls');
    
    if(mode === 'new') {
        createDiv.classList.remove('hidden');
        existDiv.classList.add('hidden');
    } else {
        createDiv.classList.add('hidden');
        existDiv.classList.remove('hidden');
        loadRostersToSelect('addToGroupSelect');
    }
}

async function saveRoster() {
    const radio = document.querySelector('input[name="groupMode"]:checked');
    const mode = radio ? radio.value : 'new';
    
    const rawInput = document.getElementById('newGroupNames').value;
    
    // PARSE EMAILS & EXTRACT NAMES
    // Expected format: username.surname@herotel.com
    const lines = rawInput.split('\n').map(l => l.trim()).filter(l => l);
    
    if(!lines.length) return alert("Please enter at least one trainee email address.");

    const names = [];
    const emails = [];
    const emailMap = {}; // Map Name -> Email for user creation

    lines.forEach(line => {
        // Basic email validation/extraction
        if (line.includes('@')) {
            // Validation Check
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(line)) {
                alert(`Invalid email format detected: "${line}". Please correct it.`);
                throw new Error("Validation Error"); // Break loop and stop execution
            }
            emails.push(line);
            // Extract name: "john.doe@..." -> "John Doe"
            const namePart = line.split('@')[0];
            const fullName = namePart.split(/[._]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
            names.push(fullName);
            emailMap[fullName] = line;
        } else {
            names.push(line); // Fallback for plain names
        }
    });

    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    let targetGroupId = "";

    if (mode === 'new') {
        const y = document.getElementById('newGroupYear').value; 
        const m = document.getElementById('newGroupMonth').value; 
        let baseId = `${y}-${m}`; 
        
        targetGroupId = baseId; 
        if (rosters[baseId]) { 
            let suffixCode = 65; // 'A'
            while (rosters[`${baseId}-${String.fromCharCode(suffixCode)}`]) { 
                suffixCode++; 
            } 
            targetGroupId = `${baseId}-${String.fromCharCode(suffixCode)}`; 
        }
        rosters[targetGroupId] = names;
    } else {
        targetGroupId = document.getElementById('addToGroupSelect').value;
        if(!targetGroupId) return alert("Please select an existing group to add to.");
        
        const currentMembers = rosters[targetGroupId] || [];
        names.forEach(n => {
            if(!currentMembers.includes(n)) currentMembers.push(n);
        });
        rosters[targetGroupId] = currentMembers;
    }

    localStorage.setItem('rosters', JSON.stringify(rosters));

    // 3. Clear Input
    document.getElementById('newGroupNames').value = ''; 
    
    // 1. Generate Users (Safely)
    await scanAndGenerateUsers(false, emailMap); 
    
    // 2. INSTANT SAVE
    await secureUserSave();
    
    refreshAllDropdowns();
    
    // TRIGGER OUTLOOK EMAIL GENERATION
    if (emails.length > 0 && typeof generateOnboardingEmail === 'function') {
        generateOnboardingEmail(emails);
    }

    if(typeof logAuditAction === 'function') logAuditAction(CURRENT_USER.user, 'Roster Update', `${mode === 'new' ? 'Created' : 'Updated'} group ${targetGroupId}`);
    
    alert(`Successfully ${mode === 'new' ? 'created' : 'updated'} group: ${getGroupLabel(targetGroupId, rosters[targetGroupId].length)}`);
}

// Helper to refresh all dropdowns across tabs
function refreshAllDropdowns() {
    // 1. Always update the login screen dropdown (public)
    if(typeof populateTraineeDropdown === 'function') populateTraineeDropdown();

    // 2. STOP if not logged in (Prevents 'cannot read properties of null' errors in renderSchedule)
    if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return;

    // 3. Update Authenticated UI components
    loadRostersList(); 
    loadRostersToSelect('selectedGroup'); // Capture Tab
    loadRostersToSelect('addToGroupSelect'); // Manage Tab
    
    // Schedule Tab Dropdowns
    if(typeof renderSchedule === 'function') renderSchedule();
    
    // Reporting Tab Filters
    if(typeof populateMonthlyFilters === 'function') populateMonthlyFilters();
}

function loadRostersList() { 
    if(document.activeElement && document.activeElement.id === 'newGroupNames') return;

    const r = JSON.parse(localStorage.getItem('rosters') || '{}'); 
    const list = document.getElementById('rosterList');
    if(list) {
        list.innerHTML = Object.keys(r).sort().reverse().map(k => {
            const memberCount = r[k] ? r[k].length : 0;
            const label = (typeof getGroupLabel === 'function') ? getGroupLabel(k, memberCount) : k;
            const safeId = k.replace(/[^a-zA-Z0-9]/g, '_');
            
            // Generate member list HTML
            const members = r[k] || [];
            const membersHtml = members.map(m => {
                const safeName = m.replace(/'/g, "\\'");
                return `<li style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; border-bottom:1px solid var(--border-color); font-size:0.85rem;">
                    <span>${m}</span>
                    <button class="btn-danger btn-sm" onclick="deleteAgentFromSystem('${safeName}', '${safeId}')" style="padding:2px 6px; font-size:0.7rem;" title="Permanently Delete Agent & All Data"><i class="fas fa-trash"></i></button>
                </li>`;
            }).join('');

            return `
            <li style="margin-bottom:10px; background:var(--bg-input); padding:10px; border-radius:6px; border:1px solid var(--border-color);">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>${label}</strong>
                    <div>
                        <button class="btn-secondary btn-sm" onclick="document.getElementById('members_${safeId}').classList.toggle('hidden')" style="margin-right:5px; font-size:0.7rem;">Manage Agents</button>
                        <button class="btn-danger btn-sm" onclick="deleteGroup('${k}')" style="font-size:0.7rem;">Delete Group</button>
                    </div>
                </div>
                <div id="members_${safeId}" class="hidden" style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--border-color);">
                    <ul style="list-style:none; padding:0; margin:0;">
                        ${membersHtml.length > 0 ? membersHtml : '<li style="color:var(--text-muted); font-style:italic;">No agents in this group.</li>'}
                    </ul>
                </div>
            </li>`;
        }).join(''); 
    }
}

async function deleteGroup(groupId) {
    if(!confirm(`Delete group ${groupId} and all associated data? This cannot be undone.`)) return;
    
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    delete rosters[groupId];
    
    // AUTHORITATIVE DELETE: Save to server first.
    if(typeof saveToServer === 'function') {
        const success = await saveToServer(['rosters'], true);
        if (!success) {
            alert("Failed to delete group from server. Please check your connection and try again.");
            return; // Abort on failure
        }
    }
    
    // On success, update local state and UI
    localStorage.setItem('rosters', JSON.stringify(rosters));
    
    if(typeof logAuditAction === 'function') logAuditAction(CURRENT_USER.user, 'Delete Group', `Deleted group ${groupId}`);
    refreshAllDropdowns();
    setTimeout(loadRostersList, 50); // Force reload of the list with slight delay for stability
}

async function deleteAgentFromSystem(agentName, groupKey) {
    // groupKey might be safeId (with underscores), so we need to find the real key if passed incorrectly, 
    // but for rosters, we iterate all groups anyway to be safe.
    if(!confirm(`CRITICAL WARNING:\n\nYou are about to PERMANENTLY DELETE '${agentName}' from the entire system.\n\nThis will remove:\n- User Login & Password\n- Assessment Records & Submissions\n- Attendance History\n- Live Bookings\n- Reports & Notes\n\nThis action CANNOT be undone.\n\nProceed?`)) return;
    
    const btn = document.activeElement;
    if(btn) { btn.disabled = true; btn.innerText = 'Deleting...'; }

    try {
        // 1. Remove from ALL Rosters (just in case they are in multiple)
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        Object.keys(rosters).forEach(gid => {
            if (rosters[gid]) {
                rosters[gid] = rosters[gid].filter(m => m !== agentName);
            }
        });
        localStorage.setItem('rosters', JSON.stringify(rosters));
        
        // 2. Remove User Account
        let users = JSON.parse(localStorage.getItem('users') || '[]');
        users = users.filter(u => u.user !== agentName);
        localStorage.setItem('users', JSON.stringify(users));
        
        // 3. Add to Revoked (Blacklist) to prevent resurrection
        let revoked = JSON.parse(localStorage.getItem('revokedUsers') || '[]');
        if(!revoked.includes(agentName)) {
            revoked.push(agentName);
            localStorage.setItem('revokedUsers', JSON.stringify(revoked));
        }
        
        // 4. Wipe Data (Local)
        const wipeData = (key, userField) => {
            let data = JSON.parse(localStorage.getItem(key) || '[]');
            if(Array.isArray(data)) {
                const originalLen = data.length;
                // Case insensitive check just to be sure
                data = data.filter(item => {
                    const val = item[userField];
                    return !val || val.toLowerCase() !== agentName.toLowerCase();
                });
                if(data.length !== originalLen) localStorage.setItem(key, JSON.stringify(data));
            }
        };
        
        wipeData('records', 'trainee');
        wipeData('submissions', 'trainee');
        wipeData('attendance_records', 'user');
        wipeData('liveBookings', 'trainee');
        wipeData('savedReports', 'trainee');
        wipeData('insightReviews', 'trainee');
        wipeData('exemptions', 'trainee');
        wipeData('linkRequests', 'trainee');
        wipeData('retrain_archives', 'user');
        // Also clean up Monitor History (might be large)
        wipeData('monitor_history', 'user');
        // Also clean up Access Logs
        wipeData('accessLogs', 'user');
        
        // Object based data
        const wipeObjectData = (key) => {
            let data = JSON.parse(localStorage.getItem(key) || '{}');
            if(data[agentName]) {
                delete data[agentName];
                localStorage.setItem(key, JSON.stringify(data));
            }
        };
        wipeObjectData('agentNotes');
        wipeObjectData('monitor_data');
        wipeObjectData('cancellationCounts');
        
        // 4.5. CLOUD WIPE (Critical for Row-Level Sync)
        if (typeof hardDeleteByQuery === 'function') {
            // Fire off deletes in parallel for speed
            const promises = [
                hardDeleteByQuery('records', 'trainee', agentName),
                hardDeleteByQuery('submissions', 'trainee', agentName),
                hardDeleteByQuery('attendance', 'user_id', agentName),
                hardDeleteByQuery('live_bookings', 'trainee', agentName),
                hardDeleteByQuery('saved_reports', 'trainee', agentName),
                hardDeleteByQuery('insight_reviews', 'trainee', agentName),
                hardDeleteByQuery('exemptions', 'trainee', agentName),
                hardDeleteByQuery('link_requests', 'trainee', agentName),
                hardDeleteByQuery('monitor_state', 'user_id', agentName),
                hardDeleteByQuery('tl_task_submissions', 'user_id', agentName),
                hardDeleteByQuery('monitor_history', 'user_id', agentName),
                hardDeleteByQuery('access_logs', 'user_id', agentName)
            ];
            
            await Promise.all(promises);
        }

        // 5. Force Sync (Update Blobs)
        if(typeof saveToServer === 'function') {
            await saveToServer([
                'rosters', 'users', 'revokedUsers', 'records', 'submissions', 
                'attendance_records', 'liveBookings', 'savedReports', 'tl_task_submissions',
                'insightReviews', 'exemptions', 'agentNotes', 'monitor_data', 'linkRequests', 'cancellationCounts', 'retrain_archives',
                'monitor_history', 'accessLogs'
            ], true);
        }
        
        if(typeof logAuditAction === 'function') logAuditAction(CURRENT_USER.user, 'Delete Agent', `Obliterated agent ${agentName}`);
        
        // Refresh UI
        loadRostersList(); // Re-render the list immediately
        if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
        if(typeof showToast === 'function') showToast(`Agent ${agentName} obliterated from system.`, "success");

    } catch (e) {
        console.error("Delete Agent Error:", e);
        alert("Error deleting agent: " + e.message);
    } finally {
        if(btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-trash"></i>'; } // Restore icon button state
    }
}

function loadRostersToSelect(elementId = 'selectedGroup') { 
    const r = JSON.parse(localStorage.getItem('rosters')||'{}'); 
    const s = document.getElementById(elementId); 
    if(!s) return;
    
    const currentVal = s.value; 
    s.innerHTML='<option value="">-- Select Group --</option>'; 
    
    Object.keys(r).sort().reverse().forEach(k => { 
        s.add(new Option(getGroupLabel(k, r[k].length), k)); 
    }); 
    
    if(currentVal && r[currentVal]) s.value = currentVal;
}

function populateTraineeDropdown() { 
    const users = JSON.parse(localStorage.getItem('users') || '[]'); 
    const list = document.getElementById('traineeOptions'); 
    
    if(list) {
        list.innerHTML = ''; 
        users.filter(u => u.user && u.role && u.role.trim().toLowerCase() === 'trainee')
             .sort((a,b) => a.user.localeCompare(b.user))
             .forEach(u => { 
                let opt = document.createElement('option'); 
                opt.value = u.user; 
                list.appendChild(opt); 
             }); 
    }
}

// --- USER & TRAINEE MANAGEMENT ---

async function scanAndGenerateUsers(silent = false, emailMap = {}) { 
    const users = JSON.parse(localStorage.getItem('users') || '[]'); 
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}'); 
    const revoked = JSON.parse(localStorage.getItem('revokedUsers') || '[]');
    const revokedSet = new Set(revoked.map(r => String(r || '').trim().toLowerCase()));

    let allNames = new Set(); 
    
    // Harvest from Rosters
    Object.values(rosters).forEach(g => {
        if(Array.isArray(g)) g.forEach(n => { if(n && n.trim()) allNames.add(n.trim()); });
    }); 
    
    let createdCount = 0; 
    
    allNames.forEach(name => { 
        const normalized = name.toLowerCase();
        // Do not auto-resurrect deleted users; restore must be explicit.
        if (revokedSet.has(normalized)) return;

        // Case-insensitive check
        const exists = users.find(u => String(u.user || '').toLowerCase() === normalized);

        if(!exists) { 
            // Secure native browser RNG
            const arr = new Uint16Array(1);
            window.crypto.getRandomValues(arr);
            const pin = ((arr[0] % 9000) + 1000).toString();
            
            const newUser = { user: name, pass: pin, role: 'trainee', createdBy: 'System Auto-Gen', lastModified: new Date().toISOString() };
            
            // Inject Email if available from Roster creation
            if (emailMap && emailMap[name]) {
                newUser.traineeData = {
                    email: emailMap[name],
                    contact: emailMap[name]
                };
            }
            
            users.push(newUser); 
            createdCount++; 
        } 
    }); 
    
    if(createdCount > 0) { 
        localStorage.setItem('users', JSON.stringify(users)); 

        // FIX: Ensure cloud sync happens immediately
        await secureUserSave();
        if(!silent) alert(`Generated ${createdCount} missing accounts.`); 
        loadAdminUsers(); 
        populateTraineeDropdown(); 
    } else {
        if(!silent) alert("No missing users found based on current Rosters/Records.");
    }
}

function loadAdminUsers() { 
    if(document.activeElement && 
       (document.activeElement.id === 'userSearch' || 
        document.activeElement.id === 'newUserName' || 
        document.activeElement.id === 'newUserPass')) {
        return; 
    }

    restrictTraineeMenu();
    splitLegacyRetrainArchives().catch(() => {});

    const users = JSON.parse(localStorage.getItem('users') || '[]'); 
    const savedReports = JSON.parse(localStorage.getItem('savedReports') || '[]');
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}'); 
    const search = document.getElementById('userSearch') ? document.getElementById('userSearch').value.toLowerCase() : '';
    const roleFilter = document.getElementById('userRoleFilter') ? document.getElementById('userRoleFilter').value : '';
    
    // --- INJECT GROUP FILTER ---
    const controls = document.getElementById('admin-user-controls');
    if (controls && !document.getElementById('userGroupFilter')) {
        const sel = document.createElement('select');
        sel.id = 'userGroupFilter';
        sel.style.cssText = "padding: 5px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-main); max-width: 150px;";
        sel.onchange = () => loadAdminUsers();
        
        // Insert before search input
        const searchInput = document.getElementById('userSearch');
        if(searchInput) controls.insertBefore(sel, searchInput);
        else controls.appendChild(sel);
    }
    
    // Populate Filter
    const groupSelect = document.getElementById('userGroupFilter');
    let groupFilter = '';
    if (groupSelect) {
        if (document.activeElement !== groupSelect) {
            const val = groupSelect.value;
            groupSelect.innerHTML = '<option value="">All Groups</option>';
            Object.keys(rosters).sort().reverse().forEach(gid => {
                const label = (typeof getGroupLabel === 'function') ? getGroupLabel(gid, rosters[gid].length) : gid;
                groupSelect.add(new Option(label, gid));
            });
            groupSelect.value = val;
        }
        groupFilter = groupSelect.value;
    }
    // ---------------------------

    let createContainer = document.getElementById('createUserContainer');
    if (!createContainer) {
        const input = document.getElementById('newUserName');
        if (input) createContainer = input.closest('div');
    }
    const scanBtn = document.getElementById('btnScanUsers');

    let displayUsers = [];
    
    if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin') {
        if(createContainer) createContainer.classList.remove('hidden');
        if(scanBtn) scanBtn.classList.remove('hidden');
        
        // Inject "My Profile" button if missing
        if (!document.getElementById('btnMyProfileAdmin')) {
            const btnHtml = `<button id="btnMyProfileAdmin" class="btn-secondary btn-sm" onclick="openUnifiedProfileSettings()" style="margin-left:10px; vertical-align:middle;"><i class="fas fa-user-cog"></i> My Profile Settings</button>`;
            
            if (scanBtn && scanBtn.parentNode) {
                scanBtn.insertAdjacentHTML('afterend', btnHtml);
            } else if (createContainer) {
                createContainer.insertAdjacentHTML('beforeend', btnHtml);
            } else {
                const searchBox = document.getElementById('userSearch');
                if(searchBox) searchBox.insertAdjacentHTML('afterend', btnHtml);
            }
        }
        displayUsers = users.filter(u => {
            const matchesSearch = u.user.toLowerCase().includes(search);
            const matchesRole = roleFilter ? u.role === roleFilter : true;
            
            let matchesGroup = true;
            if (groupFilter) {
                const members = rosters[groupFilter] || [];
                matchesGroup = members.some(m => m.toLowerCase() === u.user.toLowerCase());
            }

            return matchesSearch && matchesRole && matchesGroup;
        });
    } else if (CURRENT_USER.role === 'special_viewer') {
        if(createContainer) createContainer.classList.add('hidden');
        if(scanBtn) scanBtn.classList.add('hidden');
        // Special viewer sees all users but cannot edit
        displayUsers = users.filter(u => {
            const matchesSearch = u.user.toLowerCase().includes(search);
            const matchesRole = roleFilter ? u.role === roleFilter : true;
            // Note: Group filter logic duplicated here for consistency if needed, 
            // but special viewer logic often simpler. Adding it for completeness:
            let matchesGroup = true;
            if (groupFilter) {
                const members = rosters[groupFilter] || [];
                matchesGroup = members.some(m => m.toLowerCase() === u.user.toLowerCase());
            }
            return matchesSearch && matchesRole && matchesGroup;
        });
    } 
    else {
        if(createContainer) createContainer.classList.add('hidden');
        if(scanBtn) scanBtn.classList.add('hidden');
        displayUsers = users.filter(u => u.user === CURRENT_USER.user);
    }

    displayUsers.sort((a,b) => {
        const roles = { 'admin': 1, 'special_viewer': 1, 'teamleader': 2, 'trainee': 3 };
        return roles[a.role] - roles[b.role];
    });

    const userList = document.getElementById('userList');
    if(userList) {
        // SECURITY: Inject Super Admin option into Create dropdown ONLY if current user is Super Admin
        const createRoleSelect = document.getElementById('newUserRole');
        if (createRoleSelect) {
            const existingOpt = createRoleSelect.querySelector('option[value="super_admin"]');
            if (existingOpt) existingOpt.remove(); // Reset

            if (CURRENT_USER.role === 'super_admin') {
                const opt = document.createElement('option');
                opt.value = 'super_admin';
                opt.innerText = 'Super Admin';
                createRoleSelect.appendChild(opt);
            }
        }

        userList.innerHTML = displayUsers.map((u,i) => {
            let actions = '';
            // Escape single quotes for onclick handler safety
            const safeUser = u.user.replace(/'/g, "\\'");
            const displayUser = (typeof escapeHTML === 'function') ? escapeHTML(u.user) : u.user;
            
            // Generate Avatar
            const initials = u.user.substring(0, 2).toUpperCase();
            let hash = 0;
            for (let j = 0; j < u.user.length; j++) hash = u.user.charCodeAt(j) + ((hash << 5) - hash);
            const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
            const color = "#" + "00000".substring(0, 6 - c.length) + c;
            const avatarHtml = `<div style="width:28px; height:28px; border-radius:50%; background:${color}; color:#fff; display:inline-flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:bold; margin-right:10px; vertical-align:middle; box-shadow:0 2px 4px rgba(0,0,0,0.2);">${initials}</div>`;

            if ((CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin') && u.user !== 'admin') {
                const hasReport = savedReports.some(r => r.trainee.toLowerCase() === u.user.toLowerCase());
                const moveBtn = hasReport 
                    ? `<button class="btn-warning btn-sm" onclick="openMoveUserModal('${safeUser}')" title="Move to another group"><i class="fas fa-exchange-alt"></i></button>`
                    : `<button class="btn-secondary btn-sm" disabled title="Onboard Report Required to Move"><i class="fas fa-exchange-alt" style="opacity:0.5;"></i></button>`;
                
                const impBtn = (CURRENT_USER.role === 'super_admin') ? `<button class="btn-primary btn-sm" onclick="impersonateUser('${safeUser}')" title="Impersonate"><i class="fas fa-mask"></i></button>` : '';

                // NEW: Demote Button (Super Admin Only)
                let demoteBtn = '';
                if (CURRENT_USER.role === 'super_admin' && u.role === 'super_admin') {
                    demoteBtn = `<button class="btn-warning btn-sm" onclick="demoteSuperAdmin('${safeUser}')" title="Demote to Admin"><i class="fas fa-level-down-alt"></i></button>`;
                }

                // FIX: Pass username instead of index to prevent deleting wrong user when sorted
                actions = `${demoteBtn} ${impBtn} ${moveBtn} <button class="btn-secondary btn-sm" onclick="openUserEdit('${safeUser}')"><i class="fas fa-pen"></i></button> <button class="btn-danger btn-sm" onclick="remUser('${safeUser}')"><i class="fas fa-trash"></i></button>`;
            } 
            else if (CURRENT_USER.role === 'special_viewer') {
                actions = `<span style="color:var(--text-muted); font-style:italic;">View Only</span>`;
            } else if (u.user === CURRENT_USER.user) {
                actions = `<button class="btn-secondary btn-sm" onclick="openUserEdit('${safeUser}')"><i class="fas fa-pen"></i> Edit Password</button>`;
            }
            
            let passDisplay = '';
            const isHashed = u.pass && u.pass.length === 64 && /^[0-9a-fA-F]+$/.test(u.pass);

            if (isHashed) {
                passDisplay = `<span style="color:var(--text-muted); font-style:italic; font-size:0.8rem;"><i class="fas fa-lock"></i> Encrypted</span>`;
            } else {
                const passId = `pass-display-${i}`;
                passDisplay = `
                    <span id="${passId}" data-real="${u.pass}" style="font-family:monospace; margin-right:5px; color:var(--primary);">******</span>
                    <button class="btn-secondary btn-sm" style="padding:2px 5px;" onclick="togglePasswordView('${passId}')"><i class="fas fa-eye"></i></button>
                `;
            }

            const email = (u.traineeData && u.traineeData.email) ? u.traineeData.email : '-';
            const phone = (u.traineeData && u.traineeData.phone) ? u.traineeData.phone : '-';

            let roleDisplay = u.role;
            if (u.role === 'super_admin') {
                roleDisplay = `<span style="color:#9b59b6; font-weight:bold; background:rgba(155, 89, 182, 0.1); padding:2px 6px; border-radius:4px;"><i class="fas fa-user-astronaut"></i> Super Admin</span>`;
            } else if (u.role === 'admin') {
                roleDisplay = `<span style="color:var(--primary); font-weight:bold; background:rgba(243, 112, 33, 0.1); padding:2px 6px; border-radius:4px;"><i class="fas fa-user-shield"></i> Admin</span>`;
            } else if (u.role === 'teamleader') {
                roleDisplay = `<span style="color:#2ecc71; font-weight:bold; background:rgba(46, 204, 113, 0.1); padding:2px 6px; border-radius:4px;"><i class="fas fa-users"></i> Team Leader</span>`;
            } else if (u.role === 'trainee') {
                roleDisplay = `<span style="color:var(--text-muted); font-size:0.9rem;">Trainee</span>`;
            }

            return `<tr><td>${avatarHtml}${displayUser}</td><td>${roleDisplay}</td><td>${email}</td><td>${phone}</td><td>${passDisplay}</td><td>${actions}</td></tr>`;
        }).join(''); 
    }
}

function togglePasswordView(elementId) {
    const el = document.getElementById(elementId);
    if(el.innerText === '******') {
        el.innerText = el.getAttribute('data-real');
    } else {
        el.innerText = '******';
    }
}

function openMoveUserModal(username) {
    userToMove = username;
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    let currentGroup = "None";
    
    for (const [gid, members] of Object.entries(rosters)) {
        if (members.includes(username)) {
            currentGroup = getGroupLabel(gid);
            break;
        }
    }
    
    document.getElementById('moveUserTitle').innerText = `Move Agent: ${username}`;
    document.getElementById('moveUserCurrent').innerText = currentGroup;
    
    const select = document.getElementById('moveUserTargetSelect');
    select.innerHTML = '<option value="">-- Select New Group --</option>';
    Object.keys(rosters).sort().reverse().forEach(gid => {
        select.add(new Option(getGroupLabel(gid, rosters[gid].length), gid));
    });

    document.getElementById('moveUserModal').classList.remove('hidden');
}

async function confirmMoveUser() {
    const targetGid = document.getElementById('moveUserTargetSelect').value;
    if(!targetGid) return alert("Please select a destination group.");

    if(!confirm(`Move ${userToMove} to ${targetGid}?\n\nWARNING: This will ARCHIVE all their current progress, records, and attendance to start fresh in the new group (Retrain Mode).\n\nProceed?`)) return;

    const btn = document.querySelector('#moveUserModal .btn-warning');
    if(btn) { btn.innerText = "Moving & Archiving..."; btn.disabled = true; }

    try {
        // 1. ARCHIVE DATA (Snapshot)
        const archiveData = {
            id: `retrain_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            user: userToMove,
            movedDate: new Date().toISOString(),
            archiveType: 'retrain',
            reason: 'Moved to ' + targetGid,
            targetGroup: targetGid,
            records: (JSON.parse(localStorage.getItem('records') || '[]')).filter(r => r.trainee === userToMove),
            submissions: (JSON.parse(localStorage.getItem('submissions') || '[]')).filter(s => s.trainee === userToMove),
            attendance: (JSON.parse(localStorage.getItem('attendance_records') || '[]')).filter(r => r.user === userToMove),
            reports: (JSON.parse(localStorage.getItem('savedReports') || '[]')).filter(r => r.trainee === userToMove),
            reviews: (JSON.parse(localStorage.getItem('insightReviews') || '[]')).filter(r => r.trainee === userToMove),
            notes: (JSON.parse(localStorage.getItem('agentNotes') || '{}'))[userToMove] || null
        };

        let archives = readRetrainArchives();
        archives.push(archiveData);
        localStorage.setItem('retrain_archives', JSON.stringify(archives));

        // 2. WIPE ACTIVE DATA (Clean Slate)
        const wipe = (key, field) => {
            let data = JSON.parse(localStorage.getItem(key) || '[]');
            const newData = data.filter(item => item[field] !== userToMove);
            if (data.length !== newData.length) localStorage.setItem(key, JSON.stringify(newData));
        };
        
        wipe('records', 'trainee');
        wipe('submissions', 'trainee');
        wipe('attendance_records', 'user');
        wipe('savedReports', 'trainee');
        wipe('insightReviews', 'trainee');
        
        let notes = JSON.parse(localStorage.getItem('agentNotes') || '{}');
        if(notes[userToMove]) { delete notes[userToMove]; localStorage.setItem('agentNotes', JSON.stringify(notes)); }

        // 3. MOVE ROSTER
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        for (const gid in rosters) {
            const idx = rosters[gid].indexOf(userToMove);
            if (idx > -1) rosters[gid].splice(idx, 1);
        }
        if(!rosters[targetGid]) rosters[targetGid] = [];
        if(!rosters[targetGid].includes(userToMove)) rosters[targetGid].push(userToMove);
        localStorage.setItem('rosters', JSON.stringify(rosters));

        // 4. SYNC EVERYTHING
        if(typeof saveToServer === 'function') {
            await saveToServer(['rosters', 'retrain_archives', 'records', 'submissions', 'attendance_records', 'savedReports', 'insightReviews', 'agentNotes'], true);
        }

        alert(`${userToMove} moved to ${targetGid}. Previous data archived.`);
        document.getElementById('moveUserModal').classList.add('hidden');
        loadAdminUsers();
        refreshAllDropdowns();

    } catch(e) {
        console.error("Move Error:", e);
        alert("Error moving user: " + e.message);
    } finally {
        if(btn) { btn.innerText = "Confirm Move"; btn.disabled = false; }
    }
}

async function demoteSuperAdmin(username) {
    if (!confirm(`Demote ${username} from Super Admin to Admin?`)) return;

    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const idx = users.findIndex(u => u.user === username);
    
    if (idx > -1) {
        users[idx].role = 'admin';
        localStorage.setItem('users', JSON.stringify(users));
        await secureUserSave();
        loadAdminUsers();
        if (typeof showToast === 'function') showToast(`${username} demoted to Admin.`, "success");
    }
}

function generatePassword() { 
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$";
    let pass = "";
    const arr = new Uint8Array(12);
    window.crypto.getRandomValues(arr);
    for(let i=0; i<12; i++) {
        pass += chars.charAt(arr[i] % chars.length);
    }
    document.getElementById('newUserPass').value = pass; 
}

async function addUser() { 
    const u = document.getElementById('newUserName').value.trim();
    const p = document.getElementById('newUserPass').value;
    const r = document.getElementById('newUserRole').value; 
    const normalizedUser = String(u || '').trim().toLowerCase();
    
    // SECURITY: Prevent Privilege Escalation
    if (r === 'super_admin' && CURRENT_USER.role !== 'super_admin') {
        return alert("Access Denied: Only Super Admins can create Super Admins.");
    }

    if(!u || !p) return; 
    const users = JSON.parse(localStorage.getItem('users') || '[]'); 
    if(users.find(x => String(x.user || '').toLowerCase() === normalizedUser)) return alert("User exists"); 
    
    // --- TOMBSTONE CHECK ---
    // If this user was previously deleted (revoked), remove them from blacklist
    // so they can be re-created successfully.
    let revoked = JSON.parse(localStorage.getItem('revokedUsers') || '[]');
    if(revoked.some(name => String(name || '').toLowerCase() === normalizedUser)) {
        revoked = revoked.filter(name => String(name || '').toLowerCase() !== normalizedUser);
        localStorage.setItem('revokedUsers', JSON.stringify(revoked));
    }

    let finalPass = p;
    if (typeof hashPassword === 'function') {
        finalPass = await hashPassword(p);
    }
    
    users.push({user:u, pass:finalPass, role:r}); 
    localStorage.setItem('users', JSON.stringify(users)); 
    
    await secureUserSave();
    
    document.getElementById('newUserName').value = '';
    document.getElementById('newUserPass').value = '';

    loadAdminUsers(); 
    populateTraineeDropdown(); 
}

// FIXED: Now uses Tombstone (Blacklist) and Instant Save
async function remUser(username) { 
    if(confirm(`Permanently delete user '${username}'?`)) { 
        const target = String(username || '').trim();
        if (!target) return;
        const targetNorm = target.toLowerCase();

        // 1) Remove account (case-insensitive)
        let users = JSON.parse(localStorage.getItem('users') || '[]');
        users = users.filter(u => String(u.user || '').toLowerCase() !== targetNorm);
        localStorage.setItem('users', JSON.stringify(users));

        // 2) Add to blacklist/tombstone (case-insensitive dedupe)
        let revoked = JSON.parse(localStorage.getItem('revokedUsers') || '[]');
        if (!revoked.some(r => String(r || '').toLowerCase() === targetNorm)) {
            revoked.push(target);
        }
        localStorage.setItem('revokedUsers', JSON.stringify(revoked));

        // 3) Remove from all rosters so auto-generation cannot recreate
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        Object.keys(rosters).forEach(gid => {
            if (!Array.isArray(rosters[gid])) return;
            rosters[gid] = rosters[gid].filter(m => String(m || '').toLowerCase() !== targetNorm);
        });
        localStorage.setItem('rosters', JSON.stringify(rosters));

        // 4) Purge common user-linked local data to prevent resurrection side-effects
        const purgeArray = (key, fields) => {
            let arr = JSON.parse(localStorage.getItem(key) || '[]');
            if (!Array.isArray(arr)) return;
            arr = arr.filter(item => {
                return !fields.some(field => String((item && item[field]) || '').toLowerCase() === targetNorm);
            });
            localStorage.setItem(key, JSON.stringify(arr));
        };
        purgeArray('records', ['trainee', 'user', 'user_id']);
        purgeArray('submissions', ['trainee', 'user', 'user_id']);
        purgeArray('attendance_records', ['user', 'user_id']);
        purgeArray('liveBookings', ['trainee', 'user', 'user_id']);
        purgeArray('savedReports', ['trainee', 'user', 'user_id']);
        purgeArray('insightReviews', ['trainee', 'user', 'user_id']);
        purgeArray('exemptions', ['trainee', 'user', 'user_id']);
        purgeArray('linkRequests', ['trainee', 'user', 'user_id']);
        purgeArray('tl_task_submissions', ['trainee', 'user', 'user_id']);
        purgeArray('retrain_archives', ['user']);

        const purgeObjectKey = (key) => {
            const obj = JSON.parse(localStorage.getItem(key) || '{}');
            if (!obj || typeof obj !== 'object') return;
            Object.keys(obj).forEach(k => {
                if (k.toLowerCase() === targetNorm) delete obj[k];
            });
            localStorage.setItem(key, JSON.stringify(obj));
        };
        purgeObjectKey('agentNotes');
        purgeObjectKey('monitor_data');
        purgeObjectKey('cancellationCounts');
        purgeObjectKey('trainee_notes');
        purgeObjectKey('trainee_bookmarks');
        
        // 5) Authoritative sync
        if(typeof saveToServer === 'function') {
            await saveToServer([
                'users', 'revokedUsers', 'rosters', 'records', 'submissions',
                'attendance_records', 'liveBookings', 'savedReports', 'insightReviews',
                'exemptions', 'linkRequests', 'tl_task_submissions',
                'agentNotes', 'monitor_data', 'cancellationCounts', 'retrain_archives',
                'trainee_notes', 'trainee_bookmarks'
            ], true);
        }

        if(typeof logAuditAction === 'function') logAuditAction(CURRENT_USER.user, 'Delete User', `Deleted user ${username}`);
        loadAdminUsers(); 
        populateTraineeDropdown(); 
    } 
}

function openUserEdit(username) {
    const users = JSON.parse(localStorage.getItem('users') || '[]'); 
    const targetNorm = String(username || '').trim().toLowerCase();
    // FIX: Find index by username
    const index = users.findIndex(u => String(u.user || '').toLowerCase() === targetNorm);
    if(index === -1) return;

    editTargetIndex = index;
    editTargetUsername = users[index].user;
    const u = users[index];
    
    const isSuper = CURRENT_USER.role === 'super_admin';
    const safeUser = u.user.replace(/'/g, "\\'");

    const bindingInfo = u.boundClientId 
        ? `<div style="margin-bottom:10px; font-size:0.8rem; color:var(--text-muted);">Bound to Client: <code>${u.boundClientId}</code> <button class="btn-danger btn-sm" onclick="unbindUserClient('${safeUser}')" style="padding:0 5px; margin-left:5px;">Unbind</button></div>` 
        : `<div style="margin-bottom:10px; font-size:0.8rem; color:var(--text-muted);">No Client Binding (Will bind on next login)</div>`;

    document.getElementById('adminEditTitle').innerHTML = `Edit User: ${u.user} <button class="btn-secondary btn-sm" onclick="renameUser('${u.user.replace(/'/g, "\\'")}')" style="font-size:0.7rem; margin-left:10px; padding:2px 8px;">Rename</button>`;
    
    document.getElementById('adminEditContent').innerHTML = `
        <label>Email Address</label>
        <input type="text" id="editUserEmail" value="${(u.traineeData && u.traineeData.email) ? u.traineeData.email : ''}" placeholder="name@example.com">
        <label>Phone Number</label>
        <input type="text" id="editUserPhone" value="${(u.traineeData && u.traineeData.phone) ? u.traineeData.phone : ''}" placeholder="082...">
        <label>Password</label>
        <input type="text" id="editUserPass" placeholder="Enter new password to change..." autocomplete="off">
        <label>Role</label>
        <select id="editUserRole">
            <option value="trainee">Trainee</option>
            <option value="teamleader">Team Leader</option>
            <option value="admin">Admin</option>
            <option value="special_viewer">Special Viewer</option>
            ${isSuper ? '<option value="super_admin">Super Admin</option>' : ''}
        </select>
        ${bindingInfo}`;
    
    if (CURRENT_USER.role !== 'admin' && CURRENT_USER.role !== 'super_admin') {
        const roleSelect = document.getElementById('editUserRole');
        if(roleSelect) roleSelect.disabled = true;
    } else {
        const roleSelect = document.getElementById('editUserRole');
        if(roleSelect) roleSelect.disabled = false;
    }

    document.getElementById('editUserRole').value = u.role;
    document.getElementById('adminEditModal').classList.remove('hidden');
    document.getElementById('adminEditSaveBtn').onclick = saveUserEdit;
}

window.unbindUserClient = async function(username) {
    if(!confirm("Remove Client ID binding? This allows the user to login from a new machine.")) return;
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const targetNorm = String(username || '').trim().toLowerCase();
    const index = users.findIndex(u => String(u.user || '').toLowerCase() === targetNorm);
    if (index === -1) return;
    delete users[index].boundClientId;
    localStorage.setItem('users', JSON.stringify(users));
    await secureUserSave();
    
    // Refresh Modal
    document.getElementById('adminEditModal').classList.add('hidden');
    openUserEdit(users[index].user);
};

window.renameUser = async function(oldName) {
    const newName = await customPrompt("Rename User", `Enter new username for ${oldName}:`, oldName);
    if (!newName || newName === oldName) return;
    
    // Check if exists
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    if (users.some(u => u.user.toLowerCase() === newName.toLowerCase())) return alert("Username already exists.");
    
    if (!confirm(`Rename '${oldName}' to '${newName}'?\n\nThis will update all records, attendance, and reports associated with this user.`)) return;
    
    // Perform Migration
    // 1. Users
    const uIdx = users.findIndex(u => u.user === oldName);
    if (uIdx > -1) users[uIdx].user = newName;
    localStorage.setItem('users', JSON.stringify(users));
    
    // 2. Rosters
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    Object.keys(rosters).forEach(gid => {
        const idx = rosters[gid].indexOf(oldName);
        if (idx > -1) rosters[gid][idx] = newName;
    });
    localStorage.setItem('rosters', JSON.stringify(rosters));
    
    // 3. Records, Submissions, Attendance, etc.
    const migrate = (key, field) => {
        const data = JSON.parse(localStorage.getItem(key) || '[]');
        let changed = false;
        data.forEach(item => {
            if (item[field] === oldName) {
                item[field] = newName;
                changed = true;
            }
        });
        if (changed) localStorage.setItem(key, JSON.stringify(data));
    };
    
    migrate('records', 'trainee');
    migrate('submissions', 'trainee');
    migrate('attendance_records', 'user');
    migrate('liveBookings', 'trainee');
    migrate('savedReports', 'trainee');
    migrate('insightReviews', 'trainee');
    migrate('exemptions', 'trainee');
    migrate('linkRequests', 'trainee');
    migrate('tl_task_submissions', 'user');
    migrate('retrain_archives', 'user');
    
    // Object keys (Agent Notes, Monitor Data)
    const migrateObj = (key) => {
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        if (data[oldName]) {
            data[newName] = data[oldName];
            delete data[oldName];
            localStorage.setItem(key, JSON.stringify(data));
        }
    };
    migrateObj('agentNotes');
    migrateObj('monitor_data');
    migrateObj('cancellationCounts');
    
    // Sync
    if (typeof saveToServer === 'function') {
        await saveToServer(['users', 'rosters', 'records', 'submissions', 'attendance_records', 'liveBookings', 'savedReports', 'insightReviews', 'exemptions', 'linkRequests', 'agentNotes', 'monitor_data', 'cancellationCounts', 'tl_task_submissions', 'retrain_archives'], true);
    }
    
    alert("User renamed successfully.");
    document.getElementById('adminEditModal').classList.add('hidden');
    loadAdminUsers();
};

async function saveUserEdit() {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const targetNorm = String(editTargetUsername || '').trim().toLowerCase();
    const liveIndex = users.findIndex(u => String(u.user || '').toLowerCase() === targetNorm);
    if (liveIndex === -1) {
        alert("User no longer exists. The list will refresh.");
        document.getElementById('adminEditModal').classList.add('hidden');
        loadAdminUsers();
        return;
    }

    editTargetIndex = liveIndex;
    const newPass = document.getElementById('editUserPass').value;
    
    if(newPass && newPass.trim() !== "") {
        if (typeof hashPassword === 'function') {
            users[liveIndex].pass = await hashPassword(newPass);
        } else {
            users[liveIndex].pass = newPass;
        }
    }
    
    if(CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin') {
        const newRole = document.getElementById('editUserRole').value;
        
        // SECURITY: Prevent Privilege Escalation
        if (newRole === 'super_admin' && CURRENT_USER.role !== 'super_admin') {
            alert("Security Alert: Only existing Super Admins can promote users to Super Admin.");
            return;
        }
        
        users[liveIndex].role = newRole;
    }

    // Update Contact Info (traineeData)
    if (!users[liveIndex].traineeData) users[liveIndex].traineeData = {};
    
    const newEmail = document.getElementById('editUserEmail').value.trim();
    const newPhone = document.getElementById('editUserPhone').value.trim();
    
    users[liveIndex].traineeData.email = newEmail;
    users[liveIndex].traineeData.phone = newPhone;
    users[liveIndex].traineeData.contact = `${newEmail} | ${newPhone}`; // Legacy support
    users[liveIndex].lastModified = new Date().toISOString();
    users[liveIndex].modifiedBy = CURRENT_USER.user;

    localStorage.setItem('users', JSON.stringify(users));

    // FIX: Update current session if editing self
    if (CURRENT_USER && String(users[liveIndex].user || '').toLowerCase() === String(CURRENT_USER.user || '').toLowerCase()) {
        CURRENT_USER = { ...CURRENT_USER, ...users[liveIndex] };
        sessionStorage.setItem('currentUser', JSON.stringify(CURRENT_USER));
    }
    
    await secureUserSave();
    
    editTargetUsername = users[liveIndex].user;
    document.getElementById('adminEditModal').classList.add('hidden');
    loadAdminUsers();
}

// --- GRADUATED AGENTS MANAGEMENT ---

function loadGraduatedAgents() {
    const container = document.getElementById('graduateList');
    if (!container) return;

    const graduates = (JSON.parse(localStorage.getItem('graduated_agents') || '[]') || []).filter(g => !isRetrainArchiveEntry(g));
    const search = document.getElementById('graduateSearch') ? document.getElementById('graduateSearch').value.toLowerCase() : '';

    const filtered = graduates.filter(g => g.user.toLowerCase().includes(search));
    
    // Sort by graduation date desc
    filtered.sort((a,b) => new Date(b.graduatedDate) - new Date(a.graduatedDate));

    if (filtered.length === 0) {
        container.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No archived agents found.</td></tr>';
        return;
    }

    container.innerHTML = filtered.map(g => {
        const dateStr = new Date(g.graduatedDate).toLocaleDateString();
        // Try to find group from archived records
        let group = "Unknown";
        if (g.records && g.records.length > 0) group = g.records[0].groupID || "Unknown";
        
        const safeUser = g.user.replace(/'/g, "\\'");

        return `
            <tr>
                <td><strong>${g.user}</strong></td>
                <td>${dateStr}</td>
                <td>${group}</td>
                <td>
                    <button class="btn-warning btn-sm" onclick="restoreAgent('${safeUser}')"><i class="fas fa-undo"></i> Restore</button>
                </td>
            </tr>
        `;
    }).join('');
}

async function restoreAgent(username) {
    if(!confirm(`Restore ${username} to active duty?\n\nThis will move their data back to the active database and re-enable login access.`)) return;

    const graduates = JSON.parse(localStorage.getItem('graduated_agents') || '[]');
    const idx = graduates.findIndex(g => g.user === username);
    
    if (idx === -1) return alert("Agent not found in archive.");
    
    const agentData = graduates[idx];
    
    // 1. Restore Data
    const restore = (key, data) => {
        if (!data || data.length === 0) return;
        const current = JSON.parse(localStorage.getItem(key) || '[]');
        // Merge avoiding duplicates (simple ID check if available, else push)
        data.forEach(item => {
            if (item.id) {
                if (!current.some(c => c.id === item.id)) current.push(item);
            } else {
                current.push(item);
            }
        });
        localStorage.setItem(key, JSON.stringify(current));
    };

    restore('records', agentData.records);
    restore('submissions', agentData.submissions);
    restore('attendance_records', agentData.attendance);
    restore('savedReports', agentData.reports);
    restore('insightReviews', agentData.reviews);
    
    if (agentData.notes) {
        const notes = JSON.parse(localStorage.getItem('agentNotes') || '{}');
        notes[username] = agentData.notes;
        localStorage.setItem('agentNotes', JSON.stringify(notes));
    }

    // 2. Restore User Account (Re-create)
    let users = JSON.parse(localStorage.getItem('users') || '[]');
    if (!users.some(u => u.user === username)) {
        // Generate temp pin
        const pin = Math.floor(1000 + Math.random() * 9000).toString();
        users.push({ user: username, pass: pin, role: 'trainee', lastModified: new Date().toISOString(), modifiedBy: CURRENT_USER.user });
        localStorage.setItem('users', JSON.stringify(users));
        alert(`User restored. Temporary PIN: ${pin}`);
    }

    // 3. Remove from Blacklist
    let revoked = JSON.parse(localStorage.getItem('revokedUsers') || '[]');
    revoked = revoked.filter(u => u !== username);
    localStorage.setItem('revokedUsers', JSON.stringify(revoked));

    // 4. Remove from Archive
    graduates.splice(idx, 1);
    localStorage.setItem('graduated_agents', JSON.stringify(graduates));

    // 5. Sync
    if(typeof saveToServer === 'function') {
        await saveToServer([
            'records', 'submissions', 'attendance_records', 'savedReports', 
            'insightReviews', 'agentNotes', 'users', 'revokedUsers', 'graduated_agents'
        ], true);
    }

    if(typeof logAuditAction === 'function') logAuditAction(CURRENT_USER.user, 'Restore Agent', `Restored ${username} from archive`);
    loadGraduatedAgents();
    if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
    if(typeof showToast === 'function') showToast("Agent restored successfully.", "success");
}

// --- NEW: GRADUATE TRAINEE FUNCTION ---
async function graduateTrainee(username) {
    if(!confirm(`Graduate ${username}?\n\nThis will ARCHIVE all their data and remove their login access.\n\nThey will be moved to the 'Graduated Agents' archive.`)) return;

    const btn = document.activeElement;
    if(btn && btn.tagName === 'BUTTON') {
        btn.innerText = "Graduating...";
        btn.disabled = true;
    }

    try {
        // 1. ARCHIVE DATA (Snapshot)
        const archiveData = {
            user: username,
            graduatedDate: new Date().toISOString(),
            reason: 'Graduated',
            records: (JSON.parse(localStorage.getItem('records') || '[]')).filter(r => r.trainee === username),
            submissions: (JSON.parse(localStorage.getItem('submissions') || '[]')).filter(s => s.trainee === username),
            attendance: (JSON.parse(localStorage.getItem('attendance_records') || '[]')).filter(r => r.user === username),
            reports: (JSON.parse(localStorage.getItem('savedReports') || '[]')).filter(r => r.trainee === username),
            reviews: (JSON.parse(localStorage.getItem('insightReviews') || '[]')).filter(r => r.trainee === username),
            notes: (JSON.parse(localStorage.getItem('agentNotes') || '{}'))[username] || null
        };

        let archives = JSON.parse(localStorage.getItem('graduated_agents') || '[]');
        archives.push(archiveData);
        localStorage.setItem('graduated_agents', JSON.stringify(archives));

        // 2. WIPE ACTIVE DATA
        const wipe = (key, field) => {
            let data = JSON.parse(localStorage.getItem(key) || '[]');
            const newData = data.filter(item => {
                const val = item[field];
                return !val || val.toLowerCase() !== username.toLowerCase();
            });
            if (data.length !== newData.length) localStorage.setItem(key, JSON.stringify(newData));
        };
        
        wipe('records', 'trainee');
        wipe('submissions', 'trainee');
        wipe('attendance_records', 'user');
        wipe('savedReports', 'trainee');
        wipe('insightReviews', 'trainee');
        wipe('liveBookings', 'trainee');
        wipe('linkRequests', 'trainee');
        wipe('exemptions', 'trainee');
        
        let notes = JSON.parse(localStorage.getItem('agentNotes') || '{}');
        if(notes[username]) { delete notes[username]; localStorage.setItem('agentNotes', JSON.stringify(notes)); }

        let monitor = JSON.parse(localStorage.getItem('monitor_data') || '{}');
        if(monitor[username]) { delete monitor[username]; localStorage.setItem('monitor_data', JSON.stringify(monitor)); }

        // 3. REMOVE USER & ROSTER
        let users = JSON.parse(localStorage.getItem('users') || '[]');
        users = users.filter(u => u.user !== username);
        localStorage.setItem('users', JSON.stringify(users));

        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        for (const gid in rosters) {
            rosters[gid] = rosters[gid].filter(m => m.toLowerCase() !== username.toLowerCase());
        }
        localStorage.setItem('rosters', JSON.stringify(rosters));

        // 4. BLACKLIST (Prevent regeneration)
        let revoked = JSON.parse(localStorage.getItem('revokedUsers') || '[]');
        if(!revoked.includes(username)) {
            revoked.push(username);
            localStorage.setItem('revokedUsers', JSON.stringify(revoked));
        }

        // 5. SYNC
        if(typeof saveToServer === 'function') {
            await saveToServer([
                'rosters', 'graduated_agents', 'records', 'submissions', 
                'attendance_records', 'savedReports', 'insightReviews', 
                'agentNotes', 'users', 'revokedUsers', 'liveBookings', 
                'linkRequests', 'exemptions', 'monitor_data'
            ], true);
        }

        if(typeof logAuditAction === 'function') logAuditAction(CURRENT_USER.user, 'Graduate Agent', `Graduated ${username}`);
        alert(`${username} has been graduated and archived.`);
        
        // Refresh UI if on Insight page
        if(typeof renderInsightDashboard === 'function') renderInsightDashboard();

    } catch(e) {
        console.error("Graduation Error:", e);
        alert("Error graduating user: " + e.message);
    } finally {
        if(btn && btn.tagName === 'BUTTON') {
            btn.innerText = "Graduate Trainee"; 
            btn.disabled = false;
        }
    }
}

// --- EMAIL AUTOMATION ---
function generateOnboardingEmail(emails) {
    if (!emails || emails.length === 0) return;

    const toAddress = "systemsupport@herotel.com";
    const ccAddresses = "darren.tupper@herotel.com,jaco.prince@herotel.com,soanette.wilken@herotel.com";
    const subject = "Access Request for New Onboards";
    
    const body = `Good day.

Hope this finds you well.

Kindly assist with acess to the followings programs (the error the onbaords are getting is either there email address is not found or incorrect username & password :

Q-Contact
Corteza (CRM Instance present)
ACS
Radius

Please find the onbaords whom require access below : 
${emails.join('\n')}

Kind regards.`;

    const mailtoLink = `mailto:${toAddress}?cc=${ccAddresses}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoLink;
}

function clearAppCache() {
    if(!confirm("Clear local session cache? This can fix login loops or display issues.\n\n(Your data will not be deleted)")) return;
    sessionStorage.clear();
    localStorage.removeItem('rememberedUser');
    window.location.reload();
}

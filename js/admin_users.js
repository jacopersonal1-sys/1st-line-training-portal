/* ================= ADMIN: USERS & ROSTERS ================= */
/* Responsibility: Handling Rosters, Users, Groups, and Permissions */

// Global State for User Operations
let userToMove = null;
let editTargetIndex = -1;
let editTargetUsername = '';
let _legacyRetrainArchiveSplitRunning = false;
const USER_ROLE_RANK = {
    trainee: 1,
    teamleader: 2,
    special_viewer: 3,
    admin: 4,
    super_admin: 5
};

function normalizeUserIdentityValue(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[._-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getUserIdentityToken(value) {
    return normalizeUserIdentityValue(value).replace(/\s+/g, '');
}

function userIdentityMatches(left, right) {
    const leftToken = getUserIdentityToken(left);
    const rightToken = getUserIdentityToken(right);
    return !!leftToken && !!rightToken && leftToken === rightToken;
}

function getRoleRank(role) {
    return USER_ROLE_RANK[String(role || '').toLowerCase()] || 0;
}

function findUserByIdentityIndex(users, username) {
    const targetToken = getUserIdentityToken(username);
    if (!targetToken || !Array.isArray(users)) return -1;
    return users.findIndex(u => userIdentityMatches(u && (u.user || u.username), username));
}

function mergeUserEntries(existingUser, incomingUser) {
    if (!existingUser) return { ...incomingUser };
    if (!incomingUser) return existingUser;

    const merged = { ...existingUser };
    const mergedRole = getRoleRank(incomingUser.role) >= getRoleRank(existingUser.role)
        ? incomingUser.role
        : existingUser.role;
    merged.role = mergedRole;

    if ((!merged.pass || merged.pass === '') && incomingUser.pass) merged.pass = incomingUser.pass;
    if (!merged.user && incomingUser.user) merged.user = incomingUser.user;
    if (!merged.username && incomingUser.username) merged.username = incomingUser.username;

    if (incomingUser.traineeData && typeof incomingUser.traineeData === 'object') {
        merged.traineeData = { ...(existingUser.traineeData || {}), ...incomingUser.traineeData };
    }

    if (typeof incomingUser.blocked !== 'undefined') merged.blocked = !!incomingUser.blocked;
    if (typeof existingUser.blocked !== 'undefined' && typeof incomingUser.blocked === 'undefined') merged.blocked = !!existingUser.blocked;
    if (incomingUser.status) merged.status = incomingUser.status;
    if (!merged.status) merged.status = merged.blocked ? 'blocked' : 'active';

    if (incomingUser.boundClientId) merged.boundClientId = incomingUser.boundClientId;

    const incomingTs = new Date(incomingUser.lastModified || incomingUser.updatedAt || 0).getTime() || 0;
    const existingTs = new Date(existingUser.lastModified || existingUser.updatedAt || 0).getTime() || 0;
    if (incomingTs >= existingTs) {
        merged.lastModified = incomingUser.lastModified || merged.lastModified;
        merged.modifiedBy = incomingUser.modifiedBy || merged.modifiedBy;
    }

    return merged;
}

function dedupeUsersSnapshot(inputUsers) {
    const users = Array.isArray(inputUsers) ? inputUsers : [];
    const deduped = [];
    const userMap = new Map();

    users.forEach(raw => {
        if (!raw || typeof raw !== 'object') return;
        const originalName = String(raw.user || raw.username || '').trim();
        if (!originalName) return;

        const key = getUserIdentityToken(originalName);
        if (!key) return;

        const candidate = { ...raw, user: raw.user || raw.username || originalName };
        if (!userMap.has(key)) {
            userMap.set(key, deduped.length);
            deduped.push(candidate);
            return;
        }

        const idx = userMap.get(key);
        deduped[idx] = mergeUserEntries(deduped[idx], candidate);
    });

    return deduped;
}

function dedupeRosterSnapshot(inputRosters) {
    const rosters = (inputRosters && typeof inputRosters === 'object') ? { ...inputRosters } : {};
    const result = {};

    Object.entries(rosters).forEach(([groupId, members]) => {
        if (!Array.isArray(members)) {
            result[groupId] = [];
            return;
        }

        const seen = new Set();
        const cleanMembers = [];
        members.forEach(member => {
            const value = String(member || '').trim();
            if (!value) return;
            const key = getUserIdentityToken(value);
            if (!key || seen.has(key)) return;
            seen.add(key);
            cleanMembers.push(value);
        });
        result[groupId] = cleanMembers;
    });

    return result;
}

function sanitizeUsersAndRosters() {
    const rawUsers = JSON.parse(localStorage.getItem('users') || '[]');
    const rawRosters = JSON.parse(localStorage.getItem('rosters') || '{}');

    const users = dedupeUsersSnapshot(rawUsers);
    const rosters = dedupeRosterSnapshot(rawRosters);

    const usersChanged = JSON.stringify(users) !== JSON.stringify(Array.isArray(rawUsers) ? rawUsers : []);
    const rostersChanged = JSON.stringify(rosters) !== JSON.stringify((rawRosters && typeof rawRosters === 'object') ? rawRosters : {});

    if (usersChanged) localStorage.setItem('users', JSON.stringify(users));
    if (rostersChanged) localStorage.setItem('rosters', JSON.stringify(rosters));

    return { users, rosters, usersChanged, rostersChanged };
}

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
    const includeRevoked = arguments.length > 0 ? Boolean(arguments[0]) : false;
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
            const keys = ['users', 'rosters'];
            if (includeRevoked) keys.push('revokedUsers');
            await saveToServer(keys, true); 
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

    const sanitized = sanitizeUsersAndRosters();
    const r = sanitized.rosters; 
    if (sanitized.rostersChanged && typeof saveToServer === 'function') {
        saveToServer(['rosters'], true, true).catch(() => {});
    }
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
    
    const previousRostersJson = localStorage.getItem('rosters') || '{}';
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    delete rosters[groupId];
    localStorage.setItem('rosters', JSON.stringify(rosters));
    
    // AUTHORITATIVE DELETE: Persist updated local state to server.
    if(typeof saveToServer === 'function') {
        const success = await saveToServer(['rosters'], true);
        if (!success) {
            localStorage.setItem('rosters', previousRostersJson);
            alert("Failed to delete group from server. Please check your connection and try again.");
            return; // Abort on failure
        }
    }
    
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
    const targetToken = getUserIdentityToken(agentName);

    try {
        // 1. Remove from ALL Rosters (just in case they are in multiple)
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        Object.keys(rosters).forEach(gid => {
            if (rosters[gid]) {
                rosters[gid] = rosters[gid].filter(m => getUserIdentityToken(m) !== targetToken);
            }
        });
        localStorage.setItem('rosters', JSON.stringify(rosters));
        
        // 2. Remove User Account
        let users = JSON.parse(localStorage.getItem('users') || '[]');
        users = users.filter(u => getUserIdentityToken(u && (u.user || u.username)) !== targetToken);
        localStorage.setItem('users', JSON.stringify(users));
        
        // 3. Add to Revoked (Blacklist) to prevent resurrection
        let revoked = JSON.parse(localStorage.getItem('revokedUsers') || '[]');
        if(!revoked.some(name => getUserIdentityToken(name) === targetToken)) {
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
                    return !val || getUserIdentityToken(val) !== targetToken;
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
            Object.keys(data || {}).forEach(objKey => {
                if (getUserIdentityToken(objKey) === targetToken) delete data[objKey];
            });
            localStorage.setItem(key, JSON.stringify(data));
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
          const seen = new Set();
          users.filter(u => (u.user || u.username) && u.role && u.role.trim().toLowerCase() === 'trainee')
                 .sort((a,b) => (String(a.user || a.username)).localeCompare(String(b.user || b.username)))
                 .forEach(u => { 
                     const uname = String(u.user || u.username || '').trim();
                     if (!uname) return;
                     const key = uname.toLowerCase();
                     if (seen.has(key)) return; // Prevent duplicate options
                     seen.add(key);
                     let opt = document.createElement('option'); 
                     opt.value = uname; 
                     list.appendChild(opt); 
                 }); 
     }
}

// --- USER & TRAINEE MANAGEMENT ---

async function scanAndGenerateUsers(silent = false, emailMap = {}) { 
    const sanitized = sanitizeUsersAndRosters();
    const users = Array.isArray(sanitized.users) ? sanitized.users : [];
    const rosters = (sanitized.rosters && typeof sanitized.rosters === 'object') ? sanitized.rosters : {};
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
        const exists = findUserByIdentityIndex(users, name) > -1;

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

function renderAdminUsersHeaderStats(stats) {
    const box = document.getElementById('adminUsersLiveSummary');
    if (!box) return;

    const items = [
        { label: 'Visible', value: stats.visible },
        { label: 'Accounts', value: stats.accounts },
        { label: 'Trainees', value: stats.trainees },
        { label: 'Groups', value: stats.groups },
        { label: 'Active Now', value: stats.activeNow }
    ];

    box.innerHTML = items.map(item => `
        <div style="flex:1; min-width:110px; background:var(--bg-input); border:1px solid var(--border-color); border-radius:10px; padding:8px 10px;">
            <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em;">${item.label}</div>
            <div style="font-size:1.05rem; font-weight:700; color:var(--text-main);">${item.value}</div>
        </div>
    `).join('');
}

function isUserBlockedAccount(user) {
    if (!user || typeof user !== 'object') return false;
    if (user.blocked === true) return true;
    return String(user.status || '').toLowerCase().trim() === 'blocked';
}

function getUserRoleBadge(role) {
    const normalizedRole = String(role || '').toLowerCase().trim();
    if (normalizedRole === 'super_admin') {
        return `<span style="color:#9b59b6; font-weight:bold; background:rgba(155, 89, 182, 0.1); padding:2px 8px; border-radius:999px;"><i class="fas fa-user-astronaut"></i> Super Admin</span>`;
    }
    if (normalizedRole === 'admin') {
        return `<span style="color:var(--primary); font-weight:bold; background:rgba(243, 112, 33, 0.1); padding:2px 8px; border-radius:999px;"><i class="fas fa-user-shield"></i> Admin</span>`;
    }
    if (normalizedRole === 'teamleader') {
        return `<span style="color:#2ecc71; font-weight:bold; background:rgba(46, 204, 113, 0.1); padding:2px 8px; border-radius:999px;"><i class="fas fa-users"></i> Team Leader</span>`;
    }
    if (normalizedRole === 'special_viewer') {
        return `<span style="color:#00bcd4; font-weight:bold; background:rgba(0, 188, 212, 0.1); padding:2px 8px; border-radius:999px;"><i class="fas fa-eye"></i> Special Viewer</span>`;
    }
    return `<span style="color:var(--text-muted); font-size:0.85rem;">Trainee</span>`;
}

function getUserBucketByRole(role) {
    const normalizedRole = String(role || '').toLowerCase().trim();
    if (normalizedRole === 'trainee') return 'trainees';
    if (normalizedRole === 'teamleader') return 'teamleaders';
    return 'admins';
}

function getUserGroupLabels(username, rosters) {
    const labels = [];
    Object.entries(rosters || {}).forEach(([gid, members]) => {
        if (!Array.isArray(members)) return;
        if (!members.some(member => userIdentityMatches(member, username))) return;
        labels.push(typeof getGroupLabel === 'function' ? getGroupLabel(gid, members.length) : gid);
    });
    return labels;
}

function renderAdminUserCard(u, idx, rosters, savedReports) {
    const safeUser = String(u.user || '').replace(/'/g, "\\'");
    const displayUser = (typeof escapeHTML === 'function') ? escapeHTML(String(u.user || '')) : String(u.user || '');
    const normalizedRole = String(u.role || '').toLowerCase().trim();
    const isBlocked = isUserBlockedAccount(u);
    const isSelf = userIdentityMatches(u.user, CURRENT_USER.user);
    const isCoreAdmin = userIdentityMatches(u.user, 'admin');
    const canManage = CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin';
    const groups = getUserGroupLabels(u.user, rosters);

    const initials = String(u.user || '').substring(0, 2).toUpperCase();
    let hash = 0;
    for (let j = 0; j < String(u.user || '').length; j++) hash = String(u.user || '').charCodeAt(j) + ((hash << 5) - hash);
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    const color = "#" + "00000".substring(0, 6 - c.length) + c;
    const avatarHtml = `<span style="width:28px; height:28px; border-radius:50%; background:${color}; color:#fff; display:inline-flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:bold; box-shadow:0 2px 4px rgba(0,0,0,0.2);">${initials || 'U'}</span>`;

    const email = (u.traineeData && u.traineeData.email) ? u.traineeData.email : '';
    const phone = (u.traineeData && u.traineeData.phone) ? u.traineeData.phone : '';
    const roleChip = getUserRoleBadge(normalizedRole);
    const statusChip = `<span class="admin-user-status-pill ${isBlocked ? 'blocked' : 'active'}">${isBlocked ? 'Blocked' : 'Active'}</span>`;
    const groupText = groups.length > 0 ? groups.join(', ') : 'No Group';
    const contactText = [email, phone].filter(Boolean).join(' | ') || 'No Contact';

    let passDisplay = '';
    const isHashed = u.pass && u.pass.length === 64 && /^[0-9a-fA-F]+$/.test(u.pass);
    if (isHashed) {
        passDisplay = `<span style="color:var(--text-muted); font-style:italic;"><i class="fas fa-lock"></i> Encrypted Password</span>`;
    } else {
        const passId = `pass-display-${getUserIdentityToken(u.user || `user_${idx}`)}-${idx}`;
        const safeRealPass = String(u.pass || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        passDisplay = `
            <span id="${passId}" data-real="${safeRealPass}" style="font-family:monospace; margin-right:5px; color:var(--primary);">******</span>
            <button class="btn-secondary btn-sm" style="padding:2px 5px;" onclick="togglePasswordView('${passId}')"><i class="fas fa-eye"></i></button>
        `;
    }

    let actions = '';
    if (canManage && !isCoreAdmin) {
        const hasReport = savedReports.some(r => userIdentityMatches(r && r.trainee, u.user));
        const moveBtn = hasReport
            ? `<button class="btn-warning btn-sm" onclick="openMoveUserModal('${safeUser}')" title="Move to another group"><i class="fas fa-exchange-alt"></i></button>`
            : `<button class="btn-secondary btn-sm" disabled title="Onboard Report Required to Move"><i class="fas fa-exchange-alt" style="opacity:0.5;"></i></button>`;
        const impBtn = (CURRENT_USER.role === 'super_admin' && !isSelf)
            ? `<button class="btn-primary btn-sm" onclick="impersonateUser('${safeUser}')" title="Impersonate"><i class="fas fa-mask"></i></button>`
            : '';
        let demoteBtn = '';
        if (CURRENT_USER.role === 'super_admin' && normalizedRole === 'super_admin' && !isSelf) {
            demoteBtn = `<button class="btn-warning btn-sm" onclick="demoteSuperAdmin('${safeUser}')" title="Demote to Admin"><i class="fas fa-level-down-alt"></i></button>`;
        }
        const blockBtn = !isSelf
            ? `<button class="${isBlocked ? 'btn-success' : 'btn-warning'} btn-sm" onclick="toggleBlockUser('${safeUser}')" title="${isBlocked ? 'Unblock User' : 'Block User'}"><i class="fas ${isBlocked ? 'fa-unlock' : 'fa-ban'}"></i></button>`
            : '';
        actions = `${demoteBtn} ${impBtn} ${moveBtn} <button class="btn-secondary btn-sm" onclick="openUserEdit('${safeUser}')" title="Advanced Edit"><i class="fas fa-user-edit"></i></button> ${blockBtn} <button class="btn-danger btn-sm" onclick="remUser('${safeUser}')" title="Delete User"><i class="fas fa-trash"></i></button>`;
    } else if (CURRENT_USER.role === 'special_viewer') {
        actions = `<span style="color:var(--text-muted); font-style:italic;">View Only</span>`;
    } else if (isSelf) {
        actions = `<button class="btn-secondary btn-sm" onclick="openUserEdit('${safeUser}')"><i class="fas fa-pen"></i> Edit Password</button>`;
    }

    return `
        <div class="admin-user-row ${isBlocked ? 'row-error' : ''}">
            <div class="admin-user-row-header">
                <div class="admin-user-name">${avatarHtml}<span>${displayUser}</span></div>
                <div class="admin-user-header-right">${roleChip}${statusChip}</div>
            </div>
            <div class="admin-user-meta">
                <span class="admin-user-chip"><i class="fas fa-layer-group"></i> ${groupText}</span>
                <span class="admin-user-chip"><i class="fas fa-address-card"></i> ${contactText}</span>
                <span class="admin-user-chip admin-user-pass-wrap">${passDisplay}</span>
            </div>
            <div class="admin-user-actions">${actions}</div>
        </div>
    `;
}

function loadAdminUsers(forceRender = false) {
    if (!CURRENT_USER) return;

    if (!forceRender && document.activeElement &&
       (document.activeElement.id === 'userSearch' ||
        document.activeElement.id === 'addUserNameModal' ||
        document.activeElement.id === 'addUserPassModal')) {
        return;
    }

    restrictTraineeMenu();
    splitLegacyRetrainArchives().catch(() => {});

    const sanitized = sanitizeUsersAndRosters();
    const users = sanitized.users;
    const savedReports = JSON.parse(localStorage.getItem('savedReports') || '[]');
    const rosters = sanitized.rosters;

    if (sanitized.usersChanged || sanitized.rostersChanged) {
        if (typeof saveToServer === 'function') {
            const keys = [];
            if (sanitized.usersChanged) keys.push('users');
            if (sanitized.rostersChanged) keys.push('rosters');
            if (keys.length > 0) saveToServer(keys, true, true).catch(() => {});
        }
    }

    const search = String(document.getElementById('userSearch')?.value || '').toLowerCase().trim();
    const roleFilter = String(document.getElementById('userRoleFilter')?.value || '').toLowerCase().trim();
    const groupSelect = document.getElementById('userGroupFilter');

    let groupFilter = '';
    if (groupSelect) {
        const existingValue = groupSelect.value;
        if (document.activeElement !== groupSelect || forceRender) {
            groupSelect.innerHTML = '<option value="">All Trainee Groups</option>';
            Object.keys(rosters).sort().reverse().forEach(gid => {
                const label = (typeof getGroupLabel === 'function') ? getGroupLabel(gid, (rosters[gid] || []).length) : gid;
                groupSelect.add(new Option(label, gid));
            });
            groupSelect.value = existingValue;
        }
        groupFilter = groupSelect.value;
    }

    const canManage = CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin';
    const addBtn = document.getElementById('btnAddUserPopup');
    if (addBtn) addBtn.classList.toggle('hidden', !canManage);

    let displayUsers = [];
    if (canManage) {
        displayUsers = users;
    } else if (CURRENT_USER.role === 'special_viewer') {
        displayUsers = users;
    } else {
        displayUsers = users.filter(u => userIdentityMatches(u.user, CURRENT_USER.user));
    }

    displayUsers = displayUsers.filter(u => {
        const role = String(u.role || '').toLowerCase().trim();
        const email = String((u.traineeData && u.traineeData.email) || '').toLowerCase();
        const phone = String((u.traineeData && u.traineeData.phone) || '').toLowerCase();
        const groupLabels = getUserGroupLabels(u.user, rosters).join(' ').toLowerCase();
        const statusText = isUserBlockedAccount(u) ? 'blocked' : 'active';
        const matchesSearch = !search || [u.user, role, email, phone, groupLabels, statusText].some(v => String(v || '').toLowerCase().includes(search));
        const matchesRole = !roleFilter || role === roleFilter;

        let matchesGroup = true;
        if (groupFilter) {
            const members = rosters[groupFilter] || [];
            const inTargetGroup = members.some(member => userIdentityMatches(member, u.user));
            if (role === 'trainee') matchesGroup = inTargetGroup;
            else if (roleFilter === 'trainee') matchesGroup = false;
        }
        return matchesSearch && matchesRole && matchesGroup;
    });

    displayUsers.sort((a, b) => {
        const aRank = getRoleRank(a.role);
        const bRank = getRoleRank(b.role);
        if (aRank !== bRank) return bRank - aRank;
        return String(a.user || '').localeCompare(String(b.user || ''));
    });

    const now = Date.now();
    const activeNow = Object.values(window.ACTIVE_USERS_CACHE || {}).filter(u => (now - (u.local_received_at || 0)) < 90000).length;
    renderAdminUsersHeaderStats({
        visible: displayUsers.length,
        accounts: users.length,
        trainees: users.filter(u => String(u.role || '').toLowerCase() === 'trainee').length,
        groups: Object.keys(rosters || {}).length,
        activeNow
    });

    const bucketEls = {
        admins: document.getElementById('adminUserBucketAdmins'),
        trainees: document.getElementById('adminUserBucketTrainees'),
        teamleaders: document.getElementById('adminUserBucketTeamleaders')
    };

    if (!bucketEls.admins || !bucketEls.trainees || !bucketEls.teamleaders) {
        const userList = document.getElementById('userList');
        if (userList) userList.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">New user manager layout unavailable in this runtime.</td></tr>';
        return;
    }

    const buckets = { admins: [], trainees: [], teamleaders: [] };
    displayUsers.forEach((u, i) => {
        const key = getUserBucketByRole(u.role);
        buckets[key].push(renderAdminUserCard(u, i, rosters, savedReports));
    });

    bucketEls.admins.innerHTML = buckets.admins.length > 0 ? buckets.admins.join('') : '<div class="admin-user-empty">No users in this list.</div>';
    bucketEls.trainees.innerHTML = buckets.trainees.length > 0 ? buckets.trainees.join('') : '<div class="admin-user-empty">No users in this list.</div>';
    bucketEls.teamleaders.innerHTML = buckets.teamleaders.length > 0 ? buckets.teamleaders.join('') : '<div class="admin-user-empty">No users in this list.</div>';

    const countAdmins = document.getElementById('adminUserCountAdmins');
    const countTrainees = document.getElementById('adminUserCountTrainees');
    const countTeamleaders = document.getElementById('adminUserCountTeamleaders');
    if (countAdmins) countAdmins.innerText = String(buckets.admins.length);
    if (countTrainees) countTrainees.innerText = String(buckets.trainees.length);
    if (countTeamleaders) countTeamleaders.innerText = String(buckets.teamleaders.length);
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
        if (Array.isArray(members) && members.some(member => userIdentityMatches(member, username))) {
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
    const normalizedUserToMove = getUserIdentityToken(userToMove);

    if(!confirm(`Move ${userToMove} to ${targetGid}?\n\nWARNING: This will ARCHIVE all their current progress, records, and attendance to start fresh in the new group (Retrain Mode).\n\nProceed?`)) return;

    const btn = document.querySelector('#moveUserModal .btn-warning');
    if(btn) { btn.innerText = "Moving & Archiving..."; btn.disabled = true; }

    try {
        const targetToken = normalizedUserToMove;
        const currentRosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        let previousGroup = 'Ungrouped';
        Object.keys(currentRosters).forEach((gid) => {
            const members = Array.isArray(currentRosters[gid]) ? currentRosters[gid] : [];
            if (members.some(member => getUserIdentityToken(member) === targetToken)) previousGroup = gid;
        });

        // 1. ARCHIVE DATA (Snapshot)
        const existingAttempts = readRetrainArchives().filter(entry => getUserIdentityToken(entry && entry.user) === targetToken).length;
        const attemptNumber = existingAttempts + 1;
        const archiveData = {
            id: `retrain_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            user: userToMove,
            movedDate: new Date().toISOString(),
            attemptNumber,
            attemptLabel: `Attempt ${attemptNumber}`,
            archiveType: 'retrain',
            reason: 'Moved to ' + targetGid,
            fromGroup: previousGroup,
            targetGroup: targetGid,
            records: (JSON.parse(localStorage.getItem('records') || '[]')).filter(r => getUserIdentityToken(r && r.trainee) === targetToken),
            submissions: (JSON.parse(localStorage.getItem('submissions') || '[]')).filter(s => getUserIdentityToken(s && s.trainee) === targetToken),
            attendance: (JSON.parse(localStorage.getItem('attendance_records') || '[]')).filter(r => getUserIdentityToken(r && r.user) === targetToken),
            reports: (JSON.parse(localStorage.getItem('savedReports') || '[]')).filter(r => getUserIdentityToken(r && r.trainee) === targetToken),
            reviews: (JSON.parse(localStorage.getItem('insightReviews') || '[]')).filter(r => getUserIdentityToken(r && r.trainee) === targetToken),
            exemptions: (JSON.parse(localStorage.getItem('exemptions') || '[]')).filter(r => getUserIdentityToken(r && r.trainee) === targetToken),
            liveBookings: (JSON.parse(localStorage.getItem('liveBookings') || '[]')).filter(r => getUserIdentityToken(r && r.trainee) === targetToken),
            linkRequests: (JSON.parse(localStorage.getItem('linkRequests') || '[]')).filter(r => getUserIdentityToken(r && r.trainee) === targetToken),
            monitorHistory: (JSON.parse(localStorage.getItem('monitor_history') || '[]')).filter(r => getUserIdentityToken(r && (r.user || r.user_id)) === targetToken),
            tlTaskSubmissions: (JSON.parse(localStorage.getItem('tl_task_submissions') || '[]')).filter(r => getUserIdentityToken(r && (r.user || r.trainee)) === targetToken),
            notes: (() => {
                const allNotes = JSON.parse(localStorage.getItem('agentNotes') || '{}');
                const key = Object.keys(allNotes).find(k => getUserIdentityToken(k) === targetToken);
                return key ? allNotes[key] : null;
            })()
        };

        let archives = readRetrainArchives();
        archives.push(archiveData);
        localStorage.setItem('retrain_archives', JSON.stringify(archives));

        // 2. WIPE ACTIVE DATA (Clean Slate)
        const wipe = (key, field) => {
            let data = JSON.parse(localStorage.getItem(key) || '[]');
            const newData = data.filter(item => getUserIdentityToken((item && item[field]) || '') !== normalizedUserToMove);
            if (data.length !== newData.length) localStorage.setItem(key, JSON.stringify(newData));
        };
        
        wipe('records', 'trainee');
        wipe('submissions', 'trainee');
        wipe('attendance_records', 'user');
        wipe('savedReports', 'trainee');
        wipe('insightReviews', 'trainee');
        wipe('exemptions', 'trainee');
        wipe('liveBookings', 'trainee');
        wipe('linkRequests', 'trainee');
        wipe('monitor_history', 'user');
        wipe('tl_task_submissions', 'user');
        
        let notes = JSON.parse(localStorage.getItem('agentNotes') || '{}');
        const noteKey = Object.keys(notes).find(k => getUserIdentityToken(k) === normalizedUserToMove);
        if(noteKey) { delete notes[noteKey]; localStorage.setItem('agentNotes', JSON.stringify(notes)); }

        // 3. MOVE ROSTER
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        for (const gid in rosters) {
            if (!Array.isArray(rosters[gid])) continue;
            rosters[gid] = rosters[gid].filter(member => getUserIdentityToken(member) !== normalizedUserToMove);
        }
        if(!rosters[targetGid]) rosters[targetGid] = [];
        rosters[targetGid] = rosters[targetGid].filter((member, idx, arr) => {
            const memberNorm = getUserIdentityToken(member);
            return memberNorm && arr.findIndex(x => getUserIdentityToken(x) === memberNorm) === idx;
        });
        if(!rosters[targetGid].some(member => getUserIdentityToken(member) === normalizedUserToMove)) rosters[targetGid].push(userToMove);
        localStorage.setItem('rosters', JSON.stringify(rosters));

        // 4. SYNC EVERYTHING
        if(typeof saveToServer === 'function') {
            await saveToServer([
                'rosters', 'retrain_archives', 'records', 'submissions', 'attendance_records',
                'savedReports', 'insightReviews', 'agentNotes', 'exemptions', 'liveBookings',
                'linkRequests', 'monitor_history', 'tl_task_submissions'
            ], true);
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
    const idx = findUserByIdentityIndex(users, username);
    
    if (idx > -1) {
        users[idx].role = 'admin';
        localStorage.setItem('users', JSON.stringify(users));
        await secureUserSave();
        loadAdminUsers();
        if (typeof showToast === 'function') showToast(`${username} demoted to Admin.`, "success");
    }
}

function generatePassword(targetInputId = '') {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$";
    let pass = "";
    const arr = new Uint8Array(12);
    window.crypto.getRandomValues(arr);
    for(let i=0; i<12; i++) {
        pass += chars.charAt(arr[i] % chars.length);
    }
    const targetId = targetInputId || (document.getElementById('addUserPassModal') ? 'addUserPassModal' : 'newUserPass');
    const field = document.getElementById(targetId);
    if (field) field.value = pass;
    return pass;
}

function openAddUserModal() {
    if (CURRENT_USER.role !== 'admin' && CURRENT_USER.role !== 'super_admin') {
        alert("You do not have permission to create users.");
        return;
    }

    const allowSuperAdmin = CURRENT_USER.role === 'super_admin';
    const roleOptions = [
        '<option value="trainee">Trainee</option>',
        '<option value="teamleader">Team Leader</option>',
        '<option value="admin">Admin</option>',
        '<option value="special_viewer">Special Viewer</option>',
        allowSuperAdmin ? '<option value="super_admin">Super Admin</option>' : ''
    ].join('');

    document.getElementById('adminEditTitle').innerHTML = 'Add User';
    document.getElementById('adminEditContent').innerHTML = `
        <label>Username</label>
        <input type="text" id="addUserNameModal" placeholder="Username">
        <label>Role</label>
        <select id="addUserRoleModal">${roleOptions}</select>
        <label>Password</label>
        <div style="display:flex; gap:6px;">
            <input type="text" id="addUserPassModal" placeholder="Password" autocomplete="off">
            <button class="btn-secondary" style="width:auto;" onclick="generatePassword('addUserPassModal')">Gen</button>
        </div>
        <label>Email (Optional)</label>
        <input type="text" id="addUserEmailModal" placeholder="name@example.com">
        <label>Phone (Optional)</label>
        <input type="text" id="addUserPhoneModal" placeholder="082...">
    `;
    document.getElementById('adminEditModal').classList.remove('hidden');
    document.getElementById('adminEditSaveBtn').onclick = async () => {
        const userPayload = {
            user: document.getElementById('addUserNameModal')?.value || '',
            pass: document.getElementById('addUserPassModal')?.value || '',
            role: document.getElementById('addUserRoleModal')?.value || 'trainee',
            email: document.getElementById('addUserEmailModal')?.value || '',
            phone: document.getElementById('addUserPhoneModal')?.value || ''
        };
        const created = await addUser(userPayload);
        if (created) document.getElementById('adminEditModal').classList.add('hidden');
    };
}

async function addUser(payload = null) {
    const fromPayload = payload && typeof payload === 'object';
    const u = String(fromPayload ? payload.user : (document.getElementById('newUserName')?.value || '')).trim();
    const p = String(fromPayload ? payload.pass : (document.getElementById('newUserPass')?.value || ''));
    const r = String(fromPayload ? payload.role : (document.getElementById('newUserRole')?.value || 'trainee')).toLowerCase().trim();
    const email = String(fromPayload ? payload.email : '').trim();
    const phone = String(fromPayload ? payload.phone : '').trim();
    const normalizedUser = getUserIdentityToken(u);
    
    // SECURITY: Prevent Privilege Escalation
    if (r === 'super_admin' && CURRENT_USER.role !== 'super_admin') {
        alert("Access Denied: Only Super Admins can create Super Admins.");
        return false;
    }

    if(!u || !p) {
        alert("Username and password are required.");
        return false;
    }
    const users = JSON.parse(localStorage.getItem('users') || '[]'); 
    if(findUserByIdentityIndex(users, u) > -1) {
        alert("User exists");
        return false;
    }
    
    // --- TOMBSTONE CHECK ---
    // If this user was previously deleted (revoked), remove them from blacklist
    // so they can be re-created successfully.
    let revoked = JSON.parse(localStorage.getItem('revokedUsers') || '[]');
    let revokedChanged = false;
    if(revoked.some(name => getUserIdentityToken(name) === normalizedUser)) {
        revoked = revoked.filter(name => getUserIdentityToken(name) !== normalizedUser);
        localStorage.setItem('revokedUsers', JSON.stringify(revoked));
        revokedChanged = true;
    }

    let finalPass = p;
    if (typeof hashPassword === 'function') {
        finalPass = await hashPassword(p);
    }

    const newUser = {
        user: u,
        pass: finalPass,
        role: r,
        blocked: false,
        status: 'active',
        lastModified: new Date().toISOString(),
        modifiedBy: CURRENT_USER.user
    };

    if (email || phone) {
        newUser.traineeData = {
            email,
            phone,
            contact: `${email} | ${phone}`.trim()
        };
    }

    users.push(newUser);
    localStorage.setItem('users', JSON.stringify(users)); 
    
    await secureUserSave(revokedChanged);

    const oldName = document.getElementById('newUserName');
    const oldPass = document.getElementById('newUserPass');
    if (oldName) oldName.value = '';
    if (oldPass) oldPass.value = '';

    loadAdminUsers(); 
    populateTraineeDropdown();
    if (typeof showToast === 'function') showToast(`${u} created successfully.`, "success");
    return true;
}

async function setUserBlocked(username, shouldBlock) {
    const target = String(username || '').trim();
    if (!target) return false;
    if (CURRENT_USER.role !== 'admin' && CURRENT_USER.role !== 'super_admin') {
        alert("You do not have permission to change user status.");
        return false;
    }
    if (userIdentityMatches(target, CURRENT_USER.user)) {
        alert("You cannot block your own account.");
        return false;
    }
    if (userIdentityMatches(target, 'admin')) {
        alert("The default admin account cannot be blocked.");
        return false;
    }

    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const idx = findUserByIdentityIndex(users, target);
    if (idx === -1) {
        alert("User not found.");
        return false;
    }

    users[idx].blocked = !!shouldBlock;
    users[idx].status = shouldBlock ? 'blocked' : 'active';
    users[idx].lastModified = new Date().toISOString();
    users[idx].modifiedBy = CURRENT_USER.user;

    localStorage.setItem('users', JSON.stringify(users));
    await secureUserSave();
    loadAdminUsers(true);
    return true;
}

async function toggleBlockUser(username) {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const idx = findUserByIdentityIndex(users, username);
    if (idx === -1) return;

    const currentlyBlocked = isUserBlockedAccount(users[idx]);
    const actionLabel = currentlyBlocked ? 'unblock' : 'block';
    if (!confirm(`Are you sure you want to ${actionLabel} '${users[idx].user}'?`)) return;

    const changed = await setUserBlocked(users[idx].user, !currentlyBlocked);
    if (changed && typeof showToast === 'function') {
        showToast(`${users[idx].user} ${currentlyBlocked ? 'unblocked' : 'blocked'}.`, currentlyBlocked ? "success" : "warning");
    }
}

// FIXED: Now uses Tombstone (Blacklist) and Instant Save
async function remUser(username) { 
    if(confirm(`Permanently delete user '${username}'?`)) { 
        const target = String(username || '').trim();
        if (!target) return;
        const targetNorm = getUserIdentityToken(target);

        // 1) Remove account (case-insensitive)
        let users = JSON.parse(localStorage.getItem('users') || '[]');
        users = users.filter(u => getUserIdentityToken(u && (u.user || u.username)) !== targetNorm);
        localStorage.setItem('users', JSON.stringify(users));

        // 2) Add to blacklist/tombstone (case-insensitive dedupe)
        let revoked = JSON.parse(localStorage.getItem('revokedUsers') || '[]');
        if (!revoked.some(r => getUserIdentityToken(r) === targetNorm)) {
            revoked.push(target);
        }
        localStorage.setItem('revokedUsers', JSON.stringify(revoked));

        // 3) Remove from all rosters so auto-generation cannot recreate
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        Object.keys(rosters).forEach(gid => {
            if (!Array.isArray(rosters[gid])) return;
            rosters[gid] = rosters[gid].filter(m => getUserIdentityToken(m) !== targetNorm);
        });
        localStorage.setItem('rosters', JSON.stringify(rosters));

        // 4) Purge common user-linked local data to prevent resurrection side-effects
        const purgeArray = (key, fields) => {
            let arr = JSON.parse(localStorage.getItem(key) || '[]');
            if (!Array.isArray(arr)) return;
            arr = arr.filter(item => {
                return !fields.some(field => getUserIdentityToken((item && item[field]) || '') === targetNorm);
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
                if (getUserIdentityToken(k) === targetNorm) delete obj[k];
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
    const targetNorm = getUserIdentityToken(username);
    // FIX: Find index by username
    const index = users.findIndex(u => getUserIdentityToken(u && (u.user || u.username)) === targetNorm);
    if(index === -1) return;

    editTargetIndex = index;
    editTargetUsername = users[index].user;
    const u = users[index];

    const isSuper = CURRENT_USER.role === 'super_admin';
    const canManage = CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin';
    const safeUser = u.user.replace(/'/g, "\\'");
    const safeAttr = (value) => String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const email = (u.traineeData && u.traineeData.email) ? u.traineeData.email : '';
    const phone = (u.traineeData && u.traineeData.phone) ? u.traineeData.phone : '';
    const status = isUserBlockedAccount(u) ? 'blocked' : 'active';
    const groups = getUserGroupLabels(u.user, JSON.parse(localStorage.getItem('rosters') || '{}'));
    const groupDisplay = groups.length > 0 ? groups.join(', ') : 'No Group';
    const lastModified = u.lastModified ? new Date(u.lastModified).toLocaleString() : 'Unknown';
    const modifiedBy = u.modifiedBy || 'Unknown';

    const bindingInfo = u.boundClientId 
        ? `<div style="margin-bottom:10px; font-size:0.8rem; color:var(--text-muted);">Bound to Client: <code>${u.boundClientId}</code> <button class="btn-danger btn-sm" onclick="unbindUserClient('${safeUser}')" style="padding:0 5px; margin-left:5px;">Unbind</button></div>` 
        : `<div style="margin-bottom:10px; font-size:0.8rem; color:var(--text-muted);">No Client Binding (Will bind on next login)</div>`;

    document.getElementById('adminEditTitle').innerHTML = `Advanced Edit: ${u.user} <button class="btn-secondary btn-sm" onclick="renameUser('${u.user.replace(/'/g, "\\'")}')" style="font-size:0.7rem; margin-left:10px; padding:2px 8px;">Rename</button>`;
    
    document.getElementById('adminEditContent').innerHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div>
                <label>Email Address</label>
                <input type="text" id="editUserEmail" value="${safeAttr(email)}" placeholder="name@example.com">
            </div>
            <div>
                <label>Phone Number</label>
                <input type="text" id="editUserPhone" value="${safeAttr(phone)}" placeholder="082...">
            </div>
            <div>
                <label>Password Reset</label>
                <input type="text" id="editUserPass" placeholder="Enter new password to change..." autocomplete="off">
            </div>
            <div>
                <label>Role</label>
                <select id="editUserRole">
                    <option value="trainee">Trainee</option>
                    <option value="teamleader">Team Leader</option>
                    <option value="admin">Admin</option>
                    <option value="special_viewer">Special Viewer</option>
                    ${isSuper ? '<option value="super_admin">Super Admin</option>' : ''}
                </select>
            </div>
            <div>
                <label>Account Status</label>
                <select id="editUserStatus">
                    <option value="active">Active</option>
                    <option value="blocked">Blocked</option>
                </select>
            </div>
            <div>
                <label>Primary Group(s)</label>
                <input type="text" value="${safeAttr(groupDisplay)}" disabled>
            </div>
        </div>
        <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
            ${canManage && !userIdentityMatches(u.user, CURRENT_USER.user) && !userIdentityMatches(u.user, 'admin')
                ? `<button class="${status === 'blocked' ? 'btn-success' : 'btn-warning'} btn-sm" onclick="document.getElementById('editUserStatus').value='${status === 'blocked' ? 'active' : 'blocked'}'">${status === 'blocked' ? 'Mark As Active' : 'Mark As Blocked'}</button>`
                : ''
            }
            <button class="btn-secondary btn-sm" onclick="generatePassword('editUserPass')">Generate Password</button>
        </div>
        <div style="margin-top:10px; font-size:0.8rem; color:var(--text-muted); border-top:1px solid var(--border-color); padding-top:8px;">
            Last Modified: <strong>${safeAttr(lastModified)}</strong> by <strong>${safeAttr(modifiedBy)}</strong>
        </div>
        ${bindingInfo}`;
    
    if (CURRENT_USER.role !== 'admin' && CURRENT_USER.role !== 'super_admin') {
        const roleSelect = document.getElementById('editUserRole');
        if(roleSelect) roleSelect.disabled = true;
    } else {
        const roleSelect = document.getElementById('editUserRole');
        if(roleSelect) roleSelect.disabled = false;
    }

    document.getElementById('editUserRole').value = u.role;
    const editStatus = document.getElementById('editUserStatus');
    if (editStatus) editStatus.value = status;
    document.getElementById('adminEditModal').classList.remove('hidden');
    document.getElementById('adminEditSaveBtn').onclick = saveUserEdit;
}

window.unbindUserClient = async function(username) {
    if(!confirm("Remove Client ID binding? This allows the user to login from a new machine.")) return;
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const targetNorm = getUserIdentityToken(username);
    const index = users.findIndex(u => getUserIdentityToken(u && (u.user || u.username)) === targetNorm);
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
    if (findUserByIdentityIndex(users, newName) > -1) return alert("Username already exists.");
    
    if (!confirm(`Rename '${oldName}' to '${newName}'?\n\nThis will update all records, attendance, and reports associated with this user.`)) return;
    
    // Perform Migration
    // 1. Users
    const oldToken = getUserIdentityToken(oldName);
    const uIdx = users.findIndex(u => getUserIdentityToken(u && (u.user || u.username)) === oldToken);
    if (uIdx > -1) users[uIdx].user = newName;
    localStorage.setItem('users', JSON.stringify(users));
    
    // 2. Rosters
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    Object.keys(rosters).forEach(gid => {
        const idx = Array.isArray(rosters[gid])
            ? rosters[gid].findIndex(member => getUserIdentityToken(member) === oldToken)
            : -1;
        if (idx > -1) rosters[gid][idx] = newName;
        if (Array.isArray(rosters[gid])) {
            const seen = new Set();
            rosters[gid] = rosters[gid].filter(member => {
                const key = getUserIdentityToken(member);
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }
    });
    localStorage.setItem('rosters', JSON.stringify(rosters));
    
    // 3. Records, Submissions, Attendance, etc.
    const migrate = (key, field) => {
        const data = JSON.parse(localStorage.getItem(key) || '[]');
        let changed = false;
        data.forEach(item => {
            if (getUserIdentityToken(item && item[field]) === oldToken) {
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
        let changed = false;
        Object.keys(data).forEach(existingKey => {
            if (getUserIdentityToken(existingKey) === oldToken && existingKey !== newName) {
                data[newName] = data[existingKey];
                delete data[existingKey];
                changed = true;
            }
        });
        if (changed) localStorage.setItem(key, JSON.stringify(data));
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
    const targetNorm = getUserIdentityToken(editTargetUsername);
    const liveIndex = users.findIndex(u => getUserIdentityToken(u && (u.user || u.username)) === targetNorm);
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
        const newStatus = String(document.getElementById('editUserStatus')?.value || 'active').toLowerCase().trim();
        
        // SECURITY: Prevent Privilege Escalation
        if (newRole === 'super_admin' && CURRENT_USER.role !== 'super_admin') {
            alert("Security Alert: Only existing Super Admins can promote users to Super Admin.");
            return;
        }
        if (newStatus === 'blocked' && userIdentityMatches(users[liveIndex].user, CURRENT_USER.user)) {
            alert("You cannot block your own account.");
            return;
        }
        if (newStatus === 'blocked' && userIdentityMatches(users[liveIndex].user, 'admin')) {
            alert("The default admin account cannot be blocked.");
            return;
        }
        
        users[liveIndex].role = newRole;
        users[liveIndex].status = (newStatus === 'blocked') ? 'blocked' : 'active';
        users[liveIndex].blocked = users[liveIndex].status === 'blocked';
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
    if (CURRENT_USER && userIdentityMatches(users[liveIndex].user, CURRENT_USER.user)) {
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
    const targetToken = getUserIdentityToken(username);
    const idx = graduates.findIndex(g => getUserIdentityToken(g && g.user) === targetToken);
    
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
    if (findUserByIdentityIndex(users, username) === -1) {
        // Generate temp pin
        const pin = Math.floor(1000 + Math.random() * 9000).toString();
        users.push({ user: username, pass: pin, role: 'trainee', lastModified: new Date().toISOString(), modifiedBy: CURRENT_USER.user });
        localStorage.setItem('users', JSON.stringify(users));
        alert(`User restored. Temporary PIN: ${pin}`);
    }

    // 3. Remove from Blacklist
    let revoked = JSON.parse(localStorage.getItem('revokedUsers') || '[]');
    const restoreToken = getUserIdentityToken(username);
    revoked = revoked.filter(u => getUserIdentityToken(u) !== restoreToken);
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
        const targetToken = getUserIdentityToken(username);
        const existingAttempts = (JSON.parse(localStorage.getItem('graduated_agents') || '[]') || [])
            .filter(entry => getUserIdentityToken(entry && entry.user) === targetToken).length;
        const attemptNumber = existingAttempts + 1;
        // 1. ARCHIVE DATA (Snapshot)
        const archiveData = {
            user: username,
            graduatedDate: new Date().toISOString(),
            attemptNumber,
            attemptLabel: `Attempt ${attemptNumber}`,
            reason: 'Graduated',
            records: (JSON.parse(localStorage.getItem('records') || '[]')).filter(r => getUserIdentityToken(r && r.trainee) === targetToken),
            submissions: (JSON.parse(localStorage.getItem('submissions') || '[]')).filter(s => getUserIdentityToken(s && s.trainee) === targetToken),
            attendance: (JSON.parse(localStorage.getItem('attendance_records') || '[]')).filter(r => getUserIdentityToken(r && r.user) === targetToken),
            reports: (JSON.parse(localStorage.getItem('savedReports') || '[]')).filter(r => getUserIdentityToken(r && r.trainee) === targetToken),
            reviews: (JSON.parse(localStorage.getItem('insightReviews') || '[]')).filter(r => getUserIdentityToken(r && r.trainee) === targetToken),
            exemptions: (JSON.parse(localStorage.getItem('exemptions') || '[]')).filter(r => getUserIdentityToken(r && r.trainee) === targetToken),
            liveBookings: (JSON.parse(localStorage.getItem('liveBookings') || '[]')).filter(r => getUserIdentityToken(r && r.trainee) === targetToken),
            linkRequests: (JSON.parse(localStorage.getItem('linkRequests') || '[]')).filter(r => getUserIdentityToken(r && r.trainee) === targetToken),
            monitorHistory: (JSON.parse(localStorage.getItem('monitor_history') || '[]')).filter(r => getUserIdentityToken(r && (r.user || r.user_id)) === targetToken),
            tlTaskSubmissions: (JSON.parse(localStorage.getItem('tl_task_submissions') || '[]')).filter(r => getUserIdentityToken(r && (r.user || r.trainee)) === targetToken),
            notes: (() => {
                const allNotes = JSON.parse(localStorage.getItem('agentNotes') || '{}');
                const key = Object.keys(allNotes).find(k => getUserIdentityToken(k) === targetToken);
                return key ? allNotes[key] : null;
            })()
        };

        let archives = JSON.parse(localStorage.getItem('graduated_agents') || '[]');
        archives.push(archiveData);
        localStorage.setItem('graduated_agents', JSON.stringify(archives));

        // 2. WIPE ACTIVE DATA
        const wipe = (key, field) => {
            let data = JSON.parse(localStorage.getItem(key) || '[]');
            const newData = data.filter(item => {
                const val = item[field];
                return !val || getUserIdentityToken(val) !== targetToken;
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
        wipe('monitor_history', 'user');
        wipe('tl_task_submissions', 'user');
        
        let notes = JSON.parse(localStorage.getItem('agentNotes') || '{}');
        Object.keys(notes).forEach(noteKey => {
            if (getUserIdentityToken(noteKey) === targetToken) delete notes[noteKey];
        });
        localStorage.setItem('agentNotes', JSON.stringify(notes));

        let monitor = JSON.parse(localStorage.getItem('monitor_data') || '{}');
        Object.keys(monitor).forEach(monKey => {
            if (getUserIdentityToken(monKey) === targetToken) delete monitor[monKey];
        });
        localStorage.setItem('monitor_data', JSON.stringify(monitor));

        // 3. REMOVE USER & ROSTER
        let users = JSON.parse(localStorage.getItem('users') || '[]');
        users = users.filter(u => getUserIdentityToken(u && (u.user || u.username)) !== targetToken);
        localStorage.setItem('users', JSON.stringify(users));

        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        for (const gid in rosters) {
            rosters[gid] = rosters[gid].filter(m => getUserIdentityToken(m) !== targetToken);
        }
        localStorage.setItem('rosters', JSON.stringify(rosters));

        // 4. BLACKLIST (Prevent regeneration)
        let revoked = JSON.parse(localStorage.getItem('revokedUsers') || '[]');
        if(!revoked.some(entry => getUserIdentityToken(entry) === targetToken)) {
            revoked.push(username);
            localStorage.setItem('revokedUsers', JSON.stringify(revoked));
        }

        // 5. SYNC
        if(typeof saveToServer === 'function') {
            await saveToServer([
                'rosters', 'graduated_agents', 'records', 'submissions', 
                'attendance_records', 'savedReports', 'insightReviews', 
                'agentNotes', 'users', 'revokedUsers', 'liveBookings', 
                'linkRequests', 'exemptions', 'monitor_data', 'monitor_history', 'tl_task_submissions'
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

/* ================= ADMIN: USERS & ROSTERS ================= */
/* Responsibility: Handling Rosters, Users, Groups, and Permissions */

// Global State for User Operations
let userToMove = null;
let editTargetIndex = -1;

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
            // Safe Merge (false) - Blacklist handles deletions safely
            await saveToServer(['users', 'rosters', 'revokedUsers'], false); 
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
    
    if(!lines.length) return alert("Please enter at least one trainee email or name.");

    const names = [];
    const emails = [];

    lines.forEach(line => {
        // Basic email validation/extraction
        if (line.includes('@')) {
            emails.push(line);
            // Extract name: "john.doe@..." -> "John Doe"
            const namePart = line.split('@')[0];
            const fullName = namePart.split(/[._]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
            names.push(fullName);
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
    
    // 1. Generate Users (Safely)
    await scanAndGenerateUsers(); 
    
    // 2. INSTANT SAVE
    await secureUserSave();
    
    // 3. Clear Input
    document.getElementById('newGroupNames').value = ''; 
    
    refreshAllDropdowns();
    
    // TRIGGER OUTLOOK EMAIL GENERATION
    if (emails.length > 0 && typeof generateOnboardingEmail === 'function') {
        generateOnboardingEmail(emails);
    }
    
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
                    <button class="btn-danger btn-sm" onclick="deleteAgentFromSystem('${safeName}', '${k}')" style="padding:2px 6px; font-size:0.7rem;" title="Permanently Delete Agent & Data"><i class="fas fa-trash"></i></button>
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
    localStorage.setItem('rosters', JSON.stringify(rosters));
    
    await secureUserSave();
    
    refreshAllDropdowns();
}

async function deleteAgentFromSystem(agentName, groupId) {
    if(!confirm(`CRITICAL WARNING:\n\nYou are about to permanently delete '${agentName}' from the system.\n\nThis will remove:\n- User Account\n- Assessment Records\n- Attendance History\n- Reports & Notes\n- Everything associated with this agent.\n\nThis action CANNOT be undone.\n\nProceed?`)) return;
    
    // 1. Remove from Roster
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    if(rosters[groupId]) {
        rosters[groupId] = rosters[groupId].filter(m => m !== agentName);
        localStorage.setItem('rosters', JSON.stringify(rosters));
    }
    
    // 2. Remove User Account
    let users = JSON.parse(localStorage.getItem('users') || '[]');
    users = users.filter(u => u.user !== agentName);
    localStorage.setItem('users', JSON.stringify(users));
    
    // 3. Add to Revoked (Blacklist)
    let revoked = JSON.parse(localStorage.getItem('revokedUsers') || '[]');
    if(!revoked.includes(agentName)) {
        revoked.push(agentName);
        localStorage.setItem('revokedUsers', JSON.stringify(revoked));
    }
    
    // 4. Wipe Data
    const wipeData = (key, userField) => {
        let data = JSON.parse(localStorage.getItem(key) || '[]');
        if(Array.isArray(data)) {
            const originalLen = data.length;
            data = data.filter(item => item[userField] !== agentName);
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
    
    // 5. Force Sync
    if(typeof saveToServer === 'function') {
        await saveToServer([
            'rosters', 'users', 'revokedUsers', 'records', 'submissions', 
            'attendance_records', 'liveBookings', 'savedReports', 
            'insightReviews', 'exemptions', 'agentNotes', 'monitor_data', 'linkRequests', 'cancellationCounts'
        ], true);
    }
    
    refreshAllDropdowns();
    if(typeof showToast === 'function') showToast(`Agent ${agentName} obliterated.`, "success");
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
        users.filter(u => u.role === 'trainee')
             .sort((a,b) => a.user.localeCompare(b.user))
             .forEach(u => { 
                let opt = document.createElement('option'); 
                opt.value = u.user; 
                list.appendChild(opt); 
             }); 
    }
}

// --- USER & TRAINEE MANAGEMENT ---

async function scanAndGenerateUsers(silent = false) { 
    const users = JSON.parse(localStorage.getItem('users') || '[]'); 
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}'); 
    const records = JSON.parse(localStorage.getItem('records') || '[]'); 
    const revoked = JSON.parse(localStorage.getItem('revokedUsers') || '[]');

    let allNames = new Set(); 
    
    // Harvest from Rosters
    Object.values(rosters).forEach(g => {
        if(Array.isArray(g)) g.forEach(n => { if(n && n.trim()) allNames.add(n.trim()); });
    }); 
    
    // Harvest from Records (Safety Update: Check if r.trainee exists)
    records.forEach(r => { 
        if(r.trainee && r.trainee.trim()) allNames.add(r.trainee.trim()); 
    }); 
    
    let createdCount = 0; 
    let resurrectedCount = 0;
    
    allNames.forEach(name => { 
        // Case-insensitive check
        const exists = users.find(u => u.user.toLowerCase() === name.toLowerCase());
        const revokedIdx = revoked.findIndex(r => r.toLowerCase() === name.toLowerCase());

        if(!exists) { 
            // If user is in the roster but was previously revoked/deleted, un-revoke them
            if (revokedIdx > -1) {
                revoked.splice(revokedIdx, 1);
                resurrectedCount++;
            }

            let pin = "0000";
            if (typeof require !== 'undefined') {
                const { randomBytes } = require('crypto');
                const buf = randomBytes(2);
                pin = ((buf.readUInt16BE(0) % 9000) + 1000).toString();
            } else {
                pin = Math.floor(1000 + Math.random() * 9000).toString();
            }
            users.push({ user: name, pass: pin, role: 'trainee' }); 
            createdCount++; 
        } 
    }); 
    
    if(createdCount > 0) { 
        localStorage.setItem('users', JSON.stringify(users)); 
        if (resurrectedCount > 0) localStorage.setItem('revokedUsers', JSON.stringify(revoked));

        // FIX: Ensure cloud sync happens immediately
        await secureUserSave();
        if(!silent) alert(`Generated ${createdCount} missing accounts (${resurrectedCount} restored from deletion).`); 
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

    const users = JSON.parse(localStorage.getItem('users') || '[]'); 
    const savedReports = JSON.parse(localStorage.getItem('savedReports') || '[]');
    const search = document.getElementById('userSearch') ? document.getElementById('userSearch').value.toLowerCase() : '';
    
    let createContainer = document.getElementById('createUserContainer');
    if (!createContainer) {
        const input = document.getElementById('newUserName');
        if (input) createContainer = input.closest('div');
    }
    const scanBtn = document.getElementById('btnScanUsers');

    let displayUsers = [];
    
    if (CURRENT_USER.role === 'admin') {
        if(createContainer) createContainer.classList.remove('hidden');
        if(scanBtn) scanBtn.classList.remove('hidden');
        displayUsers = users.filter(u => u.user.toLowerCase().includes(search));
    } else if (CURRENT_USER.role === 'special_viewer') {
        if(createContainer) createContainer.classList.add('hidden');
        if(scanBtn) scanBtn.classList.add('hidden');
        // Special viewer sees all users but cannot edit
        displayUsers = users.filter(u => u.user.toLowerCase().includes(search));
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
        userList.innerHTML = displayUsers.map((u,i) => {
            let actions = '';
            // Escape single quotes for onclick handler safety
            const safeUser = u.user.replace(/'/g, "\\'");
            const displayUser = (typeof escapeHTML === 'function') ? escapeHTML(u.user) : u.user;
            
            if (CURRENT_USER.role === 'admin' && u.user !== 'admin') {
                const hasReport = savedReports.some(r => r.trainee.toLowerCase() === u.user.toLowerCase());
                const moveBtn = hasReport 
                    ? `<button class="btn-warning btn-sm" onclick="openMoveUserModal('${safeUser}')" title="Move to another group"><i class="fas fa-exchange-alt"></i></button>`
                    : `<button class="btn-secondary btn-sm" disabled title="Onboard Report Required to Move"><i class="fas fa-exchange-alt" style="opacity:0.5;"></i></button>`;

                // FIX: Pass username instead of index to prevent deleting wrong user when sorted
                actions = `${moveBtn} <button class="btn-secondary btn-sm" onclick="openUserEdit('${safeUser}')"><i class="fas fa-pen"></i></button> <button class="btn-danger btn-sm" onclick="remUser('${safeUser}')"><i class="fas fa-trash"></i></button>`;
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

            return `<tr><td>${displayUser}</td><td>${u.role}</td><td>${email}</td><td>${phone}</td><td>${passDisplay}</td><td>${actions}</td></tr>`;
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
    
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    let moved = false;

    for (const gid in rosters) {
        const idx = rosters[gid].indexOf(userToMove);
        if (idx > -1) {
            rosters[gid].splice(idx, 1);
        }
    }
    
    if(!rosters[targetGid]) rosters[targetGid] = [];
    if(!rosters[targetGid].includes(userToMove)) {
        rosters[targetGid].push(userToMove);
        moved = true;
    }
    
    if(moved) {
        localStorage.setItem('rosters', JSON.stringify(rosters));
        await secureUserSave();
        alert(`${userToMove} moved successfully.`);
        document.getElementById('moveUserModal').classList.add('hidden');
        loadAdminUsers();
        refreshAllDropdowns();
    } else {
        alert("Error moving user.");
    }
}

function generatePassword() { 
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$";
    let pass = "";
    if (typeof require !== 'undefined') {
        const { randomBytes } = require('crypto');
        const buf = randomBytes(12);
        for(let i=0; i<12; i++) {
            pass += chars.charAt(buf[i] % chars.length);
        }
    } else {
        for(let i=0; i<12; i++) {
            pass += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    }
    document.getElementById('newUserPass').value = pass; 
}

async function addUser() { 
    const u = document.getElementById('newUserName').value;
    const p = document.getElementById('newUserPass').value;
    const r = document.getElementById('newUserRole').value; 
    
    if(!u || !p) return; 
    const users = JSON.parse(localStorage.getItem('users') || '[]'); 
    if(users.find(x => x.user === u)) return alert("User exists"); 
    
    // --- TOMBSTONE CHECK ---
    // If this user was previously deleted (revoked), remove them from blacklist
    // so they can be re-created successfully.
    let revoked = JSON.parse(localStorage.getItem('revokedUsers') || '[]');
    if(revoked.includes(u)) {
        revoked = revoked.filter(name => name !== u);
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
        // 1. Get User
        const users = JSON.parse(localStorage.getItem('users') || '[]');
        // FIX: Find index by username, not table row index
        const i = users.findIndex(u => u.user === username);
        const targetUser = users[i];

        if(!targetUser) return;

        // 2. Add to Blacklist (Tombstone) to prevent merge restoration
        const revoked = JSON.parse(localStorage.getItem('revokedUsers') || '[]');
        if(!revoked.includes(targetUser.user)) {
            revoked.push(targetUser.user);
            localStorage.setItem('revokedUsers', JSON.stringify(revoked));
        }

        // 3. Remove from Local Array
        users.splice(i,1); 
        localStorage.setItem('users',JSON.stringify(users)); 
        
        // 4. FORCE SAVE
        if(typeof saveToServer === 'function') await saveToServer(['users', 'revokedUsers'], true);

        loadAdminUsers(); 
        populateTraineeDropdown(); 
    } 
}

function openUserEdit(username) {
    const users = JSON.parse(localStorage.getItem('users')); 
    // FIX: Find index by username
    const index = users.findIndex(u => u.user === username);
    if(index === -1) return;

    editTargetIndex = index;
    const u = users[index];
    
    document.getElementById('adminEditTitle').innerText = `Edit User: ${u.user}`;
    
    document.getElementById('adminEditContent').innerHTML = `
        <label>Password</label>
        <input type="text" id="editUserPass" placeholder="Enter new password to change..." autocomplete="off">
        <label>Role</label>
        <select id="editUserRole">
            <option value="trainee">Trainee</option>
            <option value="teamleader">Team Leader</option>
            <option value="admin">Admin</option>
        </select>
        <label>Idle Timeout (Minutes)</label>
        <input type="number" id="editUserTimeout" value="${u.idleTimeout || 15}" min="1" placeholder="Default: 15">`;
    
    if (CURRENT_USER.role !== 'admin') {
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

async function saveUserEdit() {
    const users = JSON.parse(localStorage.getItem('users'));
    const newPass = document.getElementById('editUserPass').value;
    
    if(newPass && newPass.trim() !== "") {
        if (typeof hashPassword === 'function') {
            users[editTargetIndex].pass = await hashPassword(newPass);
        } else {
            users[editTargetIndex].pass = newPass;
        }
    }
    
    if(CURRENT_USER.role === 'admin') {
        users[editTargetIndex].role = document.getElementById('editUserRole').value;
    }

    const timeoutVal = parseInt(document.getElementById('editUserTimeout').value);
    users[editTargetIndex].idleTimeout = (timeoutVal && timeoutVal > 0) ? timeoutVal : 15;
    
    localStorage.setItem('users', JSON.stringify(users));

    // FIX: Update current session if editing self
    if (CURRENT_USER && users[editTargetIndex].user === CURRENT_USER.user) {
        CURRENT_USER.idleTimeout = users[editTargetIndex].idleTimeout;
        sessionStorage.setItem('currentUser', JSON.stringify(CURRENT_USER));
    }
    
    await secureUserSave();
    
    document.getElementById('adminEditModal').classList.add('hidden');
    loadAdminUsers();
}

// --- GRADUATED AGENTS MANAGEMENT ---

function loadGraduatedAgents() {
    const container = document.getElementById('graduateList');
    if (!container) return;

    const graduates = JSON.parse(localStorage.getItem('graduated_agents') || '[]');
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
        users.push({ user: username, pass: pin, role: 'trainee' });
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

    loadGraduatedAgents();
    if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
    if(typeof showToast === 'function') showToast("Agent restored successfully.", "success");
}

// --- GRADUATED AGENTS MANAGEMENT ---

function loadGraduatedAgents() {
    const container = document.getElementById('graduateList');
    if (!container) return;

    const graduates = JSON.parse(localStorage.getItem('graduated_agents') || '[]');
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
        users.push({ user: username, pass: pin, role: 'trainee' });
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

    loadGraduatedAgents();
    if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
    if(typeof showToast === 'function') showToast("Agent restored successfully.", "success");
}

// --- EMAIL AUTOMATION ---
function generateOnboardingEmail(emails) {
    if (!emails || emails.length === 0) return;

    const toAddress = "systemsupport@herotel.com";
    const ccAddresses = "darren.tupper@herotel.com,jaco.prince@herotel.com,soanette.wilken@herotel.com";
    const subject = "Access Request for New Onboards";
    
    const body = `Good day.

Hope this finds you well.

Kindly assist with access to the following programs (the error the onboards are getting is either their email address is not found or incorrect username & password):

Q-Contact
Corteza (CRM Instance present)
ACS
Odoo portal

Please find the onboards whom require access below:
${emails.join('\n')}`;

    const mailtoLink = `mailto:${toAddress}?cc=${ccAddresses}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoLink;
}
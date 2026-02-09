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
    const isTrainee = CURRENT_USER.role === 'trainee';

    btns.forEach(btn => {
        const txt = btn.innerText;
        if(isTrainee) {
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
    
    const names = document.getElementById('newGroupNames').value.split('\n').map(n=>n.trim()).filter(n=>n); 
    
    if(!names.length) return alert("Please enter at least one trainee name.");

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
            return `<li><strong>${getGroupLabel(k, r[k].length)}</strong> <button class="btn-danger btn-sm" onclick="deleteGroup('${k}')" style="margin-left:10px; font-size:0.7rem;">Delete</button></li>`;
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

async function scanAndGenerateUsers() { 
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

            users.push({ user: name, pass: Math.floor(1000+Math.random()*9000).toString(), role: 'trainee' }); 
            createdCount++; 
        } 
    }); 
    
    if(createdCount > 0) { 
        localStorage.setItem('users', JSON.stringify(users)); 
        if (resurrectedCount > 0) localStorage.setItem('revokedUsers', JSON.stringify(revoked));

        // FIX: Ensure cloud sync happens immediately
        await secureUserSave();
        if(typeof showToast === 'function') showToast(`Generated ${createdCount} missing accounts (${resurrectedCount} restored).`, "success");
        loadAdminUsers(); 
        populateTraineeDropdown(); 
    } else {
        if(typeof showToast === 'function') showToast("No missing users found.", "info");
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

            return `<tr><td>${u.user}</td><td>${u.role}</td><td>${passDisplay}</td><td>${actions}</td></tr>`;
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
    for(let i=0; i<12; i++) {
        pass += chars.charAt(Math.floor(Math.random() * chars.length));
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
        await secureUserSave();

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
        </select>`;
    
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
    
    localStorage.setItem('users', JSON.stringify(users));
    
    await secureUserSave();
    
    document.getElementById('adminEditModal').classList.add('hidden');
    loadAdminUsers();
}
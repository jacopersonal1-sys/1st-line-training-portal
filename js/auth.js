/* ================= AUTHENTICATION ================= */

// --- HELPER: ASYNC SAVE ---
// Ensures critical user profile updates are saved before proceeding.
async function secureAuthSave() {
    // In the Supabase version, we ensure the cloud sync handles the backup logic
    // We remove the 'autoBackup' check because profile updates are critical.
    // UPDATED: Uses force=true to ensure authoritative overwrite (Instant Save).
    if (typeof saveToServer === 'function') {
        try {
            // PARAMETER 'false' = SAFE MERGE
            await saveToServer(['users'], false);
        } catch(e) {
            console.error("Auth Save Error:", e);
        }
    }
}

// --- CRYPTO SECURITY ---
// Uses Browser Native Web Crypto API for SHA-256 Hashing
async function hashPassword(message) {
    if (!message) return "";
    try {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    } catch (e) {
        console.error("Hashing Error:", e);
        return "";
    }
}

function toggleLoginMode(mode) {
  LOGIN_MODE = mode;
  document.getElementById('loginError').innerText = "";
  const btnAdmin = document.getElementById('btn-admin');
  const btnTrainee = document.getElementById('btn-trainee');
  const inpAdmin = document.getElementById('adminUsername');
  const inpTrainee = document.getElementById('traineeUsername');
  const lblUser = document.getElementById('lbl-username');

  if(mode === 'admin') {
    btnAdmin.classList.add('active');
    btnTrainee.classList.remove('active');
    inpAdmin.classList.remove('hidden');
    inpTrainee.classList.add('hidden');
    lblUser.innerText = "Username";
  } else {
    btnAdmin.classList.remove('active');
    btnTrainee.classList.add('active');
    inpAdmin.classList.add('hidden');
    inpTrainee.classList.remove('hidden');
    lblUser.innerText = "Select Your Name";
    
    // DYNAMIC REFRESH: Ensure the dropdown has the latest users
    if(typeof populateTraineeDropdown === 'function') {
        populateTraineeDropdown();
    }
  }
}

async function attemptLogin() {
  let u = (LOGIN_MODE === 'admin') ? document.getElementById('adminUsername').value : document.getElementById('traineeUsername').value;
  const p = document.getElementById('password').value;
  
  if(!u) { document.getElementById('loginError').innerText = "Enter username."; return; }

  // --- SECURITY CHECK 1: REVOKED ACCESS (Blacklist) ---
  const revoked = JSON.parse(localStorage.getItem('revokedUsers') || '[]');
  if (revoked.includes(u)) {
      document.getElementById('loginError').innerText = "Access has been revoked for this account.";
      document.getElementById('loginError').style.color = "#ff5252";
      return;
  }

  // --- SECURITY CHECK 2: PASSWORD VALIDATION ---
  const users = JSON.parse(localStorage.getItem('users') || '[]');
  
  // Generate hash of input password
  const hashedPassword = await hashPassword(p);
  const doubleHashed = await hashPassword(hashedPassword); // RECOVERY: Check for double-hash

  let needsRepair = false;

  // Validate (Check against Plaintext OR Hash for backward compatibility)
  const validUser = users.find(x => {
      const nameMatch = x.user.toLowerCase() === u.toLowerCase();
      if(nameMatch) {
          if (x.pass === p) return true; // Plaintext match
          if (x.pass === hashedPassword) return true; // Correct Hash match
          if (x.pass === doubleHashed) { // Double Hash match (Bug Recovery)
              needsRepair = true;
              return true;
          }
      }
      return false;
  });
  
  if(validUser) {
    // --- IP ACCESS CONTROL CHECK ---
    const accessGranted = await checkAccessControl();
    if(!accessGranted) return; // Overlay will show, stop login
    // -------------------------------

    if(LOGIN_MODE === 'admin' && (validUser.role === 'trainee')) {
      document.getElementById('loginError').innerText = "Trainees must use Trainee tab."; return;
    }
    
    // REPAIR: Fix double-hashed password in database automatically
    if(needsRepair) {
        console.log("Repairing account password...");
        validUser.pass = hashedPassword;
        const idx = users.findIndex(u => u.user === validUser.user);
        if(idx > -1) users[idx] = validUser;
        localStorage.setItem('users', JSON.stringify(users));
        secureAuthSave();
    }

    // Success
    CURRENT_USER = validUser;
    sessionStorage.setItem('currentUser', JSON.stringify(validUser));
    
    // --- REMEMBER ME LOGIC ---
    const remember = document.getElementById('rememberMe').checked;
    if (remember) {
        localStorage.setItem('rememberedUser', JSON.stringify({ user: validUser.user, pass: validUser.pass }));
    } else {
        localStorage.removeItem('rememberedUser');
    }

    // If the user was using an old plaintext password, upgrade them to hash automatically
    // FIX: Prevent re-hashing if password is already a hash (64 chars) - fixes Remember Me loop
    if (validUser.pass && validUser.pass === p && validUser.pass !== hashedPassword && validUser.pass.length !== 64) {
        console.log("Upgrading user password to hash...");
        validUser.pass = hashedPassword;
        localStorage.setItem('users', JSON.stringify(users));
        secureAuthSave(); // Sync the upgrade to cloud silently
    }

    autoLogin();
  } else {
    document.getElementById('loginError').innerText = "Incorrect credentials.";
  }
}

async function autoLogin() {
  // --- IP ACCESS CONTROL CHECK (Double check for session restore) ---
  const accessGranted = await checkAccessControl();
  if(!accessGranted) return; 
  // ---------------------------------------------------------------

  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').style.display = 'flex';
  document.getElementById('user-footer').innerHTML = `Logged in as: <strong>${CURRENT_USER.user}</strong> (${CURRENT_USER.role}) <span id="sync-indicator" style="margin-left:15px; transition: opacity 0.5s; font-size: 0.9em;"></span>`;
  
  applyRolePermissions();
  checkFirstTimeLogin();
  
  // Trigger Notifications Calculation
  if (typeof updateNotifications === 'function') updateNotifications();
  
  // NEW: Trigger Urgent Notices Update
  if (typeof updateNotices === 'function') updateNotices(CURRENT_USER.role);

  // RESTART SYNC ENGINE (To apply role-based polling rates)
  if (typeof startRealtimeSync === 'function') startRealtimeSync();

  // Redirect based on role
  if(CURRENT_USER.role === 'admin') showTab('dashboard-view'); 
  else if(CURRENT_USER.role === 'trainee') showTab('assessment-schedule');
  else showTab('monthly'); // Team Leader
}

function checkFirstTimeLogin() {
    if (CURRENT_USER.role === 'trainee' && !CURRENT_USER.hasFilledQuestionnaire) {
        document.getElementById('questionnaireModal').classList.remove('hidden');
    }
}

// UPDATED: Async Save for Profile Data
async function saveQuestionnaire() {
    const contact = document.getElementById('questContact').value.trim();
    const knowledge = document.getElementById('questKnowledge').value.trim();
    if(!contact || !knowledge) return alert("Please fill in all fields.");
    
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const userIdx = users.findIndex(u => u.user === CURRENT_USER.user);
    if(userIdx > -1) {
        users[userIdx].hasFilledQuestionnaire = true;
        users[userIdx].traineeData = { contact: contact, knowledge: knowledge };
        localStorage.setItem('users', JSON.stringify(users));
        CURRENT_USER = users[userIdx];
        sessionStorage.setItem('currentUser', JSON.stringify(CURRENT_USER));
        
        // --- SECURE SAVE START ---
        const btn = document.activeElement;
        const originalText = (btn && btn.tagName === 'BUTTON') ? btn.innerText : "";
        if(btn && btn.tagName === 'BUTTON') {
            btn.innerText = "Saving...";
            btn.disabled = true;
        }

        await secureAuthSave(); 

        if(btn && btn.tagName === 'BUTTON') {
            btn.innerText = originalText;
            btn.disabled = false;
        }
        // --- SECURE SAVE END ---
        
        document.getElementById('questionnaireModal').classList.add('hidden');
    }
}

function applyRolePermissions() {
  const adminElems = document.querySelectorAll('.admin-only');
  const tlElems = document.querySelectorAll('.tl-access');
  const filterContainer = document.getElementById('filterContainer');
  const sections = document.querySelectorAll('.admin-only-section');
  const myTestsNav = document.getElementById('nav-my-tests');
  const adminPanelBtn = document.getElementById('btn-admin-tools');

  // Reset visibility
  adminElems.forEach(e => e.classList.add('hidden'));
  tlElems.forEach(e => e.classList.add('hidden'));
  filterContainer.classList.add('hidden');
  if(myTestsNav) myTestsNav.classList.remove('hidden'); // Default visible
  
  // Reset Admin Panel Button (Make visible for everyone now, will act as "Settings")
  if(adminPanelBtn) {
      adminPanelBtn.classList.remove('hidden');
      adminPanelBtn.innerHTML = '<i class="fas fa-cogs"></i>'; // Reset icon
  }

  // --- SUB-MENU CONTROL (New Logic) ---
  const subBtnAssess = document.getElementById('btn-sub-assessments');
  const subBtnVetting = document.getElementById('btn-sub-vetting');
  const subBtnData = document.getElementById('btn-sub-data');
  const subBtnAccess = document.getElementById('btn-sub-access');
  const subBtnStatus = document.getElementById('btn-sub-status');
  const subBtnUpdates = document.getElementById('btn-sub-updates');

  if (CURRENT_USER.role === 'admin') {
    adminElems.forEach(e => e.classList.remove('hidden'));
    tlElems.forEach(e => e.classList.remove('hidden'));
    filterContainer.classList.remove('hidden');
    document.getElementById('overviewTitle').innerText = "Assessment Records";
    if(document.getElementById('filterTraineeDiv')) document.getElementById('filterTraineeDiv').classList.remove('hidden');
    if(document.getElementById('filterMonthDiv')) document.getElementById('filterMonthDiv').classList.remove('hidden');
    
    const newRepBtn = document.getElementById('btn-rep-new');
    if(newRepBtn) newRepBtn.classList.remove('hidden');

    // Admin sees all sub-tabs
    if(subBtnAssess) subBtnAssess.classList.remove('hidden');
    if(subBtnVetting) subBtnVetting.classList.remove('hidden');
    if(subBtnData) subBtnData.classList.remove('hidden');
    if(subBtnAccess) subBtnAccess.classList.remove('hidden');
    if(subBtnStatus) subBtnStatus.classList.remove('hidden');
    if(subBtnUpdates) subBtnUpdates.classList.remove('hidden');

    document.getElementById('admin-create-user-card')?.classList.remove('hidden');
    document.getElementById('admin-user-controls')?.classList.remove('hidden');
    
  } 
  else {
    // === NON-ADMIN (TL & Trainee) ===
    
    // Rename "Admin Tools" bubble button to "Profile"
    if(adminPanelBtn) adminPanelBtn.setAttribute('title', 'Profile & Settings');

    // Hide Advanced Admin Sub-Tabs
    if(subBtnAssess) subBtnAssess.classList.add('hidden');
    if(subBtnVetting) subBtnVetting.classList.add('hidden');
    if(subBtnData) subBtnData.classList.add('hidden');
    if(subBtnAccess) subBtnAccess.classList.add('hidden');
    if(subBtnStatus) subBtnStatus.classList.add('hidden');
    if(subBtnUpdates) subBtnUpdates.classList.add('hidden');

    // Role Specifics
    if (CURRENT_USER.role === 'teamleader') {
        tlElems.forEach(e => e.classList.remove('hidden'));
        filterContainer.classList.remove('hidden');
        document.getElementById('overviewTitle').innerText = "Assessment Records";
        if(document.getElementById('filterTraineeDiv')) document.getElementById('filterTraineeDiv').classList.remove('hidden');
        if(document.getElementById('filterMonthDiv')) document.getElementById('filterMonthDiv').classList.remove('hidden');
        
        // Hide sections except Report Card and now Admin Panel (Settings)
        sections.forEach(s => {
            if(s.id !== 'report-card' && s.id !== 'admin-panel') s.classList.add('hidden'); 
        }); 
        
        if(myTestsNav) myTestsNav.classList.add('hidden');

        const newRepBtn = document.getElementById('btn-rep-new');
        if(newRepBtn) newRepBtn.classList.add('hidden');
        
        const savedRepBtn = document.getElementById('btn-rep-saved');
        if(savedRepBtn) {
            savedRepBtn.classList.remove('hidden');
            savedRepBtn.classList.add('active'); 
        }
        
        const createView = document.getElementById('report-view-create');
        const savedView = document.getElementById('report-view-saved');
        if(createView) createView.classList.add('hidden');
        if(savedView) savedView.classList.remove('hidden');
    }
    else { // Trainee
        filterContainer.classList.remove('hidden');
        if(document.getElementById('filterTraineeDiv')) document.getElementById('filterTraineeDiv').classList.add('hidden');
        if(document.getElementById('filterMonthDiv')) document.getElementById('filterMonthDiv').classList.add('hidden');
        document.getElementById('overviewTitle').innerText = "My Results";
        
        // Hide Admin Sections but KEEP admin-panel visible for settings
        sections.forEach(s => {
            if(s.id !== 'admin-panel') s.classList.add('hidden');
        });

        // Hide Create User & Controls for Trainees
        document.getElementById('admin-create-user-card')?.classList.add('hidden');
        document.getElementById('admin-user-controls')?.classList.add('hidden');
    }
  }
}

function logout() { 
  sessionStorage.removeItem('currentUser');
  // localStorage.removeItem('rememberedUser'); // Keep credentials for pre-fill
  location.reload(); 
}

/* ================= IP ACCESS CONTROL LOGIC ================= */

function isIpInCidr(ip, cidr) {
    try {
        const [range, bits] = cidr.split('/');
        const mask = ~(2**(32-bits) - 1);
        const ip4ToInt = ip => ip.split('.').reduce((int, oct) => (int << 8) + parseInt(oct, 10), 0) >>> 0;
        return (ip4ToInt(ip) & mask) === (ip4ToInt(range) & mask);
    } catch(e) {
        return false;
    }
}

async function checkAccessControl() {
    const ac = JSON.parse(localStorage.getItem('accessControl') || '{"enabled":false, "whitelist":[]}');
    if(!ac.enabled) return true;
    
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        if(!response.ok) throw new Error("IP Service Unavailable");
        
        const data = await response.json();
        const userIp = data.ip;
        
        const isAllowed = ac.whitelist.some(allowedIp => {
            if (allowedIp === userIp) return true; 
            if (allowedIp.includes('/') && isIpInCidr(userIp, allowedIp)) return true;
            return false;
        });

        if(isAllowed) {
            return true; 
        } else {
            showAccessDeniedOverlay(userIp);
            return false; 
        }
    } catch (err) {
        console.warn("Access Control Warning: Could not verify IP. Allowing access.", err);
        return true; 
    }
}

function showAccessDeniedOverlay(ip) {
    const existing = document.querySelector('.fullscreen-overlay');
    if(existing) return;

    const div = document.createElement('div');
    div.className = 'fullscreen-overlay'; 
    div.style.zIndex = '10000';
    div.style.background = 'black';
    div.style.color = 'white';
    div.style.display = 'flex';
    div.style.flexDirection = 'column';
    div.style.position = 'fixed';
    div.style.top = '0'; div.style.left = '0';
    div.style.width = '100vw'; div.style.height = '100vh';
    div.style.alignItems = 'center'; div.style.justifyContent = 'center';

    div.innerHTML = `
        <div style="text-align:center; max-width:600px; padding:20px;">
            <i class="fas fa-ban" style="font-size:4rem; color:#ff5252; margin-bottom:20px;"></i>
            <h1 style="color:#ff5252; font-size:2.5rem; margin-bottom:10px;">ACCESS DENIED</h1>
            <p style="font-size:1.2rem; line-height:1.6;">Your IP Address <strong style="color:var(--primary);">${ip}</strong> is not authorized to access this portal.</p>
            <p style="color:#888; margin-top:20px;">Please contact the System Administrator to whitelist this location.</p>
            <button onclick="location.reload()" class="btn-secondary" style="margin-top:30px; background:transparent; color:white; border:1px solid #555; cursor:pointer; padding:10px 20px;">Check Again</button>
        </div>
    `;
    document.body.appendChild(div);
}

/* ================= PERMISSION CHECKER ================= */
function hasPermission(permission) {
    if (!CURRENT_USER) return false;
    if (CURRENT_USER.role === 'admin') return true;
    if (CURRENT_USER.role === 'teamleader') {
        const allowedPermissions = [
            'test.grade',
            'records.edit',
            'reports.view',
            'reports.create'
        ];
        return allowedPermissions.includes(permission);
    }
    return false;
}

// --- TRAINEE VIEW FILTER ---
function filterUserListForTrainee() {
    const tbody = document.getElementById('userList');
    if (!tbody || !CURRENT_USER) return;
    
    const rows = tbody.querySelectorAll('tr');
    rows.forEach(row => {
        // Hide row if it doesn't contain the current user's name
        if (!row.innerText.includes(CURRENT_USER.user)) {
            row.style.display = 'none';
        }
    });
}
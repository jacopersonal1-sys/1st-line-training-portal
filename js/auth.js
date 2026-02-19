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
  // --- VISUAL ENHANCEMENT: Apply classes dynamically ---
  const ids = ['adminUsername', 'traineeUsername', 'password'];
  ids.forEach(id => {
      const el = document.getElementById(id);
      if(el && !el.classList.contains('login-input')) el.classList.add('login-input');
  });
  
  const btnLogin = document.querySelector('button[onclick="attemptLogin()"]');
  if(btnLogin && !btnLogin.classList.contains('login-btn-main')) btnLogin.classList.add('login-btn-main');

  const btnAdmin = document.getElementById('btn-admin');
  const btnTrainee = document.getElementById('btn-trainee');
  
  // Style the toggle container
  if(btnAdmin && btnAdmin.parentElement && !btnAdmin.parentElement.classList.contains('login-toggle-container')) {
      btnAdmin.parentElement.classList.add('login-toggle-container');
      btnAdmin.classList.add('login-toggle-btn');
      btnTrainee.classList.add('login-toggle-btn');
  }
  // -----------------------------------------------------

  LOGIN_MODE = mode;
  document.getElementById('loginError').innerText = "";
  const inpAdmin = document.getElementById('adminUsername');
  const inpTrainee = document.getElementById('traineeUsername');
  const lblUser = document.getElementById('lbl-username');

  if(mode === 'admin') {
    btnAdmin.classList.add('active');
    btnTrainee.classList.remove('active');
    inpAdmin.classList.remove('hidden');
    inpTrainee.classList.add('hidden');
    
    // Animation
    inpAdmin.classList.remove('fade-in-up');
    void inpAdmin.offsetWidth; // Trigger reflow
    inpAdmin.classList.add('fade-in-up');
    
    lblUser.innerText = "Username";
  } else {
    btnAdmin.classList.remove('active');
    btnTrainee.classList.add('active');
    inpAdmin.classList.add('hidden');
    inpTrainee.classList.remove('hidden');
    
    // Animation
    inpTrainee.classList.remove('fade-in-up');
    void inpTrainee.offsetWidth; // Trigger reflow
    inpTrainee.classList.add('fade-in-up');
    
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

  // --- SECURITY CHECK 1.5: MAINTENANCE MODE & VERSION ---
  const config = JSON.parse(localStorage.getItem('system_config') || '{}');
  if (config.security) {
      // Maintenance Mode
      if (config.security.maintenance_mode && validUser.role !== 'admin' && validUser.role !== 'super_admin') {
          document.getElementById('loginError').innerText = "System is in Maintenance Mode. Admin access only.";
          return;
      }
      // Version Check (Simple String Compare)
      if (config.security.min_version && window.APP_VERSION) {
          if (window.APP_VERSION < config.security.min_version) {
             document.getElementById('loginError').innerText = `Update Required. Min Version: ${config.security.min_version}`;
             return;
          }
      }
      
      // Client ID Security Checks
      const myClientId = localStorage.getItem('client_id');
      
      // 1. Ban List Check
      if (config.security.banned_clients && config.security.banned_clients.includes(myClientId)) {
          document.getElementById('loginError').innerText = "Access Denied: This terminal has been banned.";
          return;
      }

      // 2. Whitelist Check (Only if whitelist is active/not empty)
      if (config.security.client_whitelist && config.security.client_whitelist.length > 0 && !config.security.client_whitelist.includes(myClientId)) {
          document.getElementById('loginError').innerText = "Access Denied: This terminal is not authorized.";
          return;
      }
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

    if(LOGIN_MODE === 'admin' && (validUser.role === 'trainee' && validUser.role !== 'super_admin')) {
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
    // Visual Feedback: Shake
    const box = document.querySelector('.login-box');
    if(box) {
        box.classList.remove('shake-anim'); // Reset
        void box.offsetWidth; // Trigger reflow
        box.classList.add('shake-anim');
    }
  }
}

async function autoLogin() {
  // --- IP ACCESS CONTROL CHECK (Double check for session restore) ---
  const accessGranted = await checkAccessControl();
  if(!accessGranted) return; 
  // ---------------------------------------------------------------

  // --- COOL TRANSITION START ---
  const loginScreen = document.getElementById('login-screen');
  const appScreen = document.getElementById('app');
  
  // Prepare App (Show it behind, invisible first)
  appScreen.style.opacity = '0';
  appScreen.style.display = 'flex';
  
  // Trigger Login Exit Animation
  loginScreen.classList.add('login-exit-anim');
  
  // Fade In App
  setTimeout(() => {
      appScreen.style.transition = 'opacity 1.8s ease-in-out';
      appScreen.style.opacity = '1';
  }, 200);

  // Cleanup after animation finishes
  setTimeout(() => {
      loginScreen.classList.add('hidden');
      loginScreen.classList.remove('login-exit-anim');
      appScreen.style.transition = ''; // Reset
      appScreen.style.opacity = '';
      if(typeof stopLoginParticles === 'function') stopLoginParticles();
  }, 2000);
  // -----------------------------

  document.getElementById('user-footer').innerHTML = `Logged in as: <strong>${CURRENT_USER.user}</strong> (${CURRENT_USER.role}) <span id="sync-indicator" style="margin-left:15px; transition: opacity 0.5s; font-size: 0.9em;"></span>`;
  
  // LOG LOGIN
  if(typeof logAccessEvent === 'function') logAccessEvent(CURRENT_USER.user, 'Login');
  
  // Apply Theme Immediately
  if (typeof applyUserTheme === 'function') applyUserTheme();
  
  // --- WEEKEND LOGIN CHECK ---
  const config = JSON.parse(localStorage.getItem('system_config') || '{}');
  if (config.attendance && config.attendance.allow_weekend_login === false) {
      const day = new Date().getDay();
      if ((day === 0 || day === 6) && CURRENT_USER.role !== 'admin' && CURRENT_USER.role !== 'super_admin') {
          alert("Weekend login is currently disabled by System Administrator.");
          if(typeof logout === 'function') logout();
          return;
      }
  }

  applyRolePermissions();
  checkFirstTimeLogin();
  
  // MANDATORY: Check Attendance on Login
  if (typeof checkAttendanceStatus === 'function') checkAttendanceStatus();
  
  // Trigger Notifications Calculation
  if (typeof updateNotifications === 'function') updateNotifications();
  
  // CHECK FOR SAVED WORK (Inactivity Recovery)
  if (typeof checkForDrafts === 'function') checkForDrafts();

  // RESTART SYNC ENGINE (To apply role-based polling rates)
  if (typeof startRealtimeSync === 'function') startRealtimeSync();

  // --- START ACTIVITY MONITOR (Fresh Login) ---
  if (typeof StudyMonitor !== 'undefined') {
      StudyMonitor.init();
  }

  // Redirect based on role
  if(CURRENT_USER.role === 'admin') showTab('dashboard-view'); 
  else if(CURRENT_USER.role === 'trainee') showTab('dashboard-view');
  else showTab('monthly'); // Team Leader
}

function checkFirstTimeLogin() {
    if (CURRENT_USER.role === 'trainee' && !CURRENT_USER.hasFilledQuestionnaire) {
        document.getElementById('questionnaireModal').classList.remove('hidden');
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

  if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin' || CURRENT_USER.role === 'special_viewer') {
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

    // SUPER ADMIN EXCLUSIVE
    const superBtn = document.getElementById('btn-super-admin');
    if (superBtn) {
        if (CURRENT_USER.role === 'super_admin') superBtn.classList.remove('hidden');
        else superBtn.classList.add('hidden');
    }

    if (CURRENT_USER.role === 'special_viewer') {
        document.getElementById('admin-create-user-card')?.classList.add('hidden');
        // Keep user controls visible for filtering, but actions will be hidden by admin_users.js
    } else {
        document.getElementById('admin-create-user-card')?.classList.remove('hidden');
        document.getElementById('admin-user-controls')?.classList.remove('hidden');
    }
    
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
    if(subBtnUpdates) subBtnUpdates.classList.remove('hidden');

    // --- VETTING ARENA VISIBILITY ---
    const session = JSON.parse(localStorage.getItem('vettingSession') || '{"active":false}');
    const arenaBtn = document.querySelector('button[onclick="showTab(\'vetting-arena\')"]');
    
    if (arenaBtn) {
        let show = false;
        if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin' || CURRENT_USER.role === 'special_viewer') show = true;
        else if (session.active) {
            if (!session.targetGroup || session.targetGroup === 'all') show = true;
            else {
                const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
                const members = rosters[session.targetGroup] || [];
                if (members.includes(CURRENT_USER.user)) show = true;
            }
        }
        
        if (show) arenaBtn.classList.remove('hidden');
        else arenaBtn.classList.add('hidden');
    }

    // Role Specifics
    if (CURRENT_USER.role === 'teamleader') {
        tlElems.forEach(e => e.classList.remove('hidden'));
        filterContainer.classList.remove('hidden');
        document.getElementById('overviewTitle').innerText = "Assessment Records";
        if(document.getElementById('filterTraineeDiv')) document.getElementById('filterTraineeDiv').classList.remove('hidden');
        if(document.getElementById('filterMonthDiv')) document.getElementById('filterMonthDiv').classList.remove('hidden');
        
        // ALLOWED SECTIONS FOR TL: Report Card, Admin Panel (Settings), Test Records, Insights, Agent Search, Capture (No), Manage (No)
        // Note: Monthly, Schedule are public sections so they are visible by default.
        const allowedSections = ['report-card', 'admin-panel', 'test-records', 'insights', 'agent-search'];
        
        sections.forEach(s => {
            if(!allowedSections.includes(s.id)) s.classList.add('hidden'); 
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

async function logout() { 
  if (CURRENT_USER && typeof logAccessEvent === 'function') {
      await logAccessEvent(CURRENT_USER.user, 'Logout');
  }
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
    
    // MERGE SUPER ADMIN IPS
    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
    const superIps = (config.security && config.security.allowed_ips) ? config.security.allowed_ips : [];
    
    if(!ac.enabled && superIps.length === 0) return true;
    
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        if(!response.ok) throw new Error("IP Service Unavailable");
        
        const data = await response.json();
        const userIp = data.ip;
        
        let isAllowed = false;
        
        // Check Local Whitelist (if enabled)
        if (ac.enabled) {
             isAllowed = ac.whitelist.some(allowedIp => {
                if (allowedIp === userIp) return true; 
                if (allowedIp.includes('/') && isIpInCidr(userIp, allowedIp)) return true;
                return false;
            });
        } else {
            isAllowed = true; // Default allow if local AC disabled
        }

        // Check Super Admin Whitelist (Always enforced if present)
        if (superIps.length > 0) {
            const isSuperAllowed = superIps.some(allowedIp => {
                if (allowedIp === userIp) return true; 
                if (allowedIp.includes('/') && isIpInCidr(userIp, allowedIp)) return true;
                return false;
            });
            // If Super Admin list exists, you MUST be in it
            if (!isSuperAllowed) isAllowed = false;
        }

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
    if (CURRENT_USER.role === 'super_admin') return true;
    if (CURRENT_USER.role === 'admin') return true;
    if (CURRENT_USER.role === 'special_viewer') return false; // Read-only
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

/* ================= VISUAL EFFECTS ================= */

let PARTICLE_ID = null;
let LOGIN_MOUSE_MOVE = null;
let LOGIN_MOUSE_LEAVE = null;

function initLoginParticles() {
    const container = document.getElementById('login-screen');
    if(!container) return;
    
    // Prevent duplicates
    if(document.getElementById('login-particles-canvas')) return;

    const canvas = document.createElement('canvas');
    canvas.id = 'login-particles-canvas';
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '0'; // Behind wrapper
    
    // Insert as first child to sit behind content
    container.insertBefore(canvas, container.firstChild);
    
    const ctx = canvas.getContext('2d');
    let width, height;
    const particles = [];
    
    const resize = () => {
        width = canvas.width = container.offsetWidth;
        height = canvas.height = container.offsetHeight;
    };
    window.addEventListener('resize', resize);
    resize();
    
    // Mouse tracking
    let mouse = { x: null, y: null, radius: 150 };
    
    if (LOGIN_MOUSE_MOVE) container.removeEventListener('mousemove', LOGIN_MOUSE_MOVE);
    if (LOGIN_MOUSE_LEAVE) container.removeEventListener('mouseleave', LOGIN_MOUSE_LEAVE);

    LOGIN_MOUSE_MOVE = (e) => {
        const rect = container.getBoundingClientRect();
        mouse.x = e.clientX - rect.left;
        mouse.y = e.clientY - rect.top;
    };
    LOGIN_MOUSE_LEAVE = () => { mouse.x = null; mouse.y = null; };

    container.addEventListener('mousemove', LOGIN_MOUSE_MOVE);
    container.addEventListener('mouseleave', LOGIN_MOUSE_LEAVE);
    
    // Init Particles (Subtle count)
    for(let i=0; i<50; i++) {
        particles.push({
            x: Math.random() * width,
            y: Math.random() * height,
            vx: (Math.random() - 0.5) * 0.3, // Slow movement
            vy: (Math.random() - 0.5) * 0.3,
            size: Math.random() * 2,
            alpha: Math.random() * 0.5 + 0.1
        });
    }
    
    const animate = () => {
        ctx.clearRect(0, 0, width, height);
        
        particles.forEach(p => {
            // Mouse Interaction
            if (mouse.x != null) {
                let dx = mouse.x - p.x;
                let dy = mouse.y - p.y;
                let distance = Math.sqrt(dx*dx + dy*dy);
                if (distance < mouse.radius) {
                    const force = (mouse.radius - distance) / mouse.radius;
                    const angle = Math.atan2(dy, dx);
                    p.x -= Math.cos(angle) * force * 2; // Repel
                    p.y -= Math.sin(angle) * force * 2;
                    
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(255, 255, 255, ${0.2 * force})`;
                    ctx.lineWidth = 0.5;
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(mouse.x, mouse.y);
                    ctx.stroke();
                }
            }

            p.x += p.vx;
            p.y += p.vy;
            
            // Wrap around
            if(p.x < 0) p.x = width;
            if(p.x > width) p.x = 0;
            if(p.y < 0) p.y = height;
            if(p.y > height) p.y = 0;
            
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
            ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha})`;
            ctx.fill();
        });
        
        PARTICLE_ID = requestAnimationFrame(animate);
    };
    animate();
}

function stopLoginParticles() {
    if(PARTICLE_ID) cancelAnimationFrame(PARTICLE_ID);
    const c = document.getElementById('login-particles-canvas');
    if(c) c.remove();
    
    const container = document.getElementById('login-screen');
    if(container && LOGIN_MOUSE_MOVE) container.removeEventListener('mousemove', LOGIN_MOUSE_MOVE);
    if(container && LOGIN_MOUSE_LEAVE) container.removeEventListener('mouseleave', LOGIN_MOUSE_LEAVE);
}
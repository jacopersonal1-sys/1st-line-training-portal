/* ================= AUTHENTICATION ================= */

// Global State
window.LOGIN_MODE = window.LOGIN_MODE || 'admin';
window.PERSISTENT_SESSION_KEY = window.PERSISTENT_SESSION_KEY || 'persistent_app_session';

function persistAppSession(user) {
    if (!user) return;
    try {
        localStorage.setItem(window.PERSISTENT_SESSION_KEY, JSON.stringify({
            user: user,
            savedAt: new Date().toISOString()
        }));
    } catch (e) {
        console.error("Persistent session save failed:", e);
    }
}

function clearPersistentAppSession() {
    try {
        localStorage.removeItem(window.PERSISTENT_SESSION_KEY);
    } catch (e) {
        console.error("Persistent session clear failed:", e);
    }
}

function getPersistentAppSession() {
    try {
        const rememberedRaw = localStorage.getItem('rememberedUser');
        if (!rememberedRaw) return null;
        const raw = localStorage.getItem(window.PERSISTENT_SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.user) {
            clearPersistentAppSession();
            return null;
        }
        return parsed;
    } catch (e) {
        clearPersistentAppSession();
        return null;
    }
}

function normalizeLoginIdentity(value) {
    try {
        if (typeof normalizeIdentityValue === 'function') {
            const normalized = normalizeIdentityValue(value);
            if (normalized) return normalized;
        }
    } catch (e) {
        // Fall through to local normalization
    }

    let v = String(value || '').trim().toLowerCase();
    if (!v) return '';
    if (v.includes('@')) v = v.split('@')[0];
    v = v.replace(/[._-]+/g, ' ');
    v = v.replace(/\s+/g, ' ').trim();
    return v.replace(/\s+/g, '');
}

function isUserRevokedLocally(username) {
    try {
        const token = normalizeLoginIdentity(username);
        if (!token) return false;
        const revoked = JSON.parse(localStorage.getItem('revokedUsers') || '[]');
        if (!Array.isArray(revoked)) return false;
        return revoked.some(entry => {
            const raw = (entry && typeof entry === 'object')
                ? (entry.user || entry.username || entry.name || '')
                : entry;
            return normalizeLoginIdentity(raw) === token;
        });
    } catch (e) {
        return false;
    }
}

function withAuthTimeout(promise, timeoutMs = 5500) {
    let timer = null;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('AUTH_REFRESH_TIMEOUT')), timeoutMs);
        })
    ]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

async function refreshAuthCriticalDataFromServer() {
    if (!window.supabaseClient) return false;
    if (localStorage.getItem('DEMO_MODE') === 'true') return false;

    try {
        const usersQuery = window.supabaseClient
            .from('users')
            .select('id, data, updated_at')
            .order('updated_at', { ascending: true })
            .limit(5000);

        const docsQuery = window.supabaseClient
            .from('app_documents')
            .select('key, content, updated_at')
            .in('key', ['revokedUsers', 'system_config', 'rosters']);

        const [usersResult, docsResult] = await withAuthTimeout(Promise.all([usersQuery, docsQuery]));

        if (usersResult && !usersResult.error && Array.isArray(usersResult.data)) {
            const usersByIdentity = new Map();
            usersResult.data.forEach(row => {
                if (!row || !row.data) return;
                const rowData = (row.data && typeof row.data === 'object') ? { ...row.data } : row.data;
                if (!rowData || typeof rowData !== 'object') return;
                if ((rowData.id === undefined || rowData.id === null) && row.id !== undefined && row.id !== null) {
                    rowData.id = row.id;
                }

                const identity = rowData.user || rowData.username || rowData.id || row.id;
                const token = normalizeLoginIdentity(identity) || `id_${String(row.id || rowData.id || usersByIdentity.size + 1)}`;
                usersByIdentity.set(token, rowData);
            });

            const freshUsers = Array.from(usersByIdentity.values());
            localStorage.setItem('users', JSON.stringify(freshUsers));

            if (usersResult.data.length > 0) {
                const latestTs = usersResult.data
                    .map(r => r && r.updated_at)
                    .filter(Boolean)
                    .sort()
                    .pop();
                if (latestTs) localStorage.setItem('row_sync_ts_users', latestTs);
            }
            if (typeof emitDataChange === 'function') emitDataChange('users', 'auth_refresh');
        }

        if (docsResult && !docsResult.error && Array.isArray(docsResult.data)) {
            docsResult.data.forEach(doc => {
                if (!doc || !doc.key) return;
                const localKey = String(doc.key || '').replace(/^demo_/, '');
                const serialized = (typeof doc.content === 'undefined') ? JSON.stringify(null) : JSON.stringify(doc.content);
                localStorage.setItem(localKey, serialized);
                if (doc.updated_at) localStorage.setItem('sync_ts_' + localKey, doc.updated_at);
                if (typeof emitDataChange === 'function') emitDataChange(localKey, 'auth_refresh');
            });
        }

        if (typeof applySystemConfig === 'function') applySystemConfig();
        if (typeof populateTraineeDropdown === 'function') populateTraineeDropdown();
        return true;
    } catch (e) {
        console.warn('Auth refresh fallback to local cache:', e && e.message ? e.message : e);
        return false;
    }
}

// --- HELPER: ASYNC SAVE ---
// Ensures critical user profile updates are saved before proceeding.
async function secureAuthSave() {
    // In the Supabase version, we ensure the cloud sync handles the backup logic
    // We remove the 'autoBackup' check because profile updates are critical.
    // UPDATED: Uses force=true to ensure authoritative overwrite (Instant Save).
    if (typeof saveToServer === 'function') {
        try {
            // PARAMETER 'false' = SAFE MERGE
            // UPDATED: Use force=true to ensure password/profile changes are authoritative and not overwritten by a background sync.
            await saveToServer(['users'], true); 
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
  
  const btnLogin = document.querySelector('#login-screen button[type="submit"]');
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

  window.LOGIN_MODE = mode;
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
  let u = (window.LOGIN_MODE === 'admin') ? document.getElementById('adminUsername').value : document.getElementById('traineeUsername').value;
  u = String(u || '').trim();
  const p = document.getElementById('password').value;
  
  if(!u) { document.getElementById('loginError').innerText = "Enter username."; return; }

  // --- SANDBOX LEAK PREVENTION ---
  // If the user is NOT a demo user, but the DEMO_MODE flag is set from a
  // previous session (e.g. improper logout, app crash), it's a leak.
  // We must clear the flag and local storage to force a clean, production login.
  const isAttemptingDemoLogin = ['demo_admin', 'demo_tl', 'demo_trainee'].includes(u.toLowerCase());
  const hasOrphanedSandbox = localStorage.getItem('IS_SANDBOX_DB') === 'true';
  if (!isAttemptingDemoLogin && (localStorage.getItem('DEMO_MODE') === 'true' || hasOrphanedSandbox)) {
      console.warn("[Sandbox Leak] Detected and corrected a leaked DEMO_MODE flag for a real user login.");
      localStorage.removeItem('DEMO_MODE');
      localStorage.clear(); // Wipe any leftover demo data to ensure a fresh pull from production
      
      if (window.electronAPI && window.electronAPI.disk) window.electronAPI.disk.saveCache('{}');
      document.getElementById('loginError').innerText = "Cleaning sandbox data... Reloading.";
      setTimeout(() => window.location.reload(), 500);
      return;
  }
  // --- END LEAK PREVENTION ---

  // --- DEMO BUBBLE INTERCEPT ---
  const isDemoAccount = ['demo_admin', 'demo_tl', 'demo_trainee'].includes(u.toLowerCase());
  if (isDemoAccount) {
      if (p !== 'demo123') {
          document.getElementById('loginError').innerText = "Password for demo accounts is 'demo123'";
          return;
      }
      
      // Sever ties with Prod data to prevent cross-contamination
      if (localStorage.getItem('DEMO_MODE') !== 'true') {
          localStorage.clear();
          localStorage.setItem('DEMO_MODE', 'true');
          sessionStorage.setItem('DEMO_MODE', 'true');
          localStorage.setItem('IS_SANDBOX_DB', 'true');
      }
      
      const roleMap = { 'demo_admin': 'super_admin', 'demo_tl': 'teamleader', 'demo_trainee': 'trainee' };
      CURRENT_USER = { user: u.toLowerCase(), role: roleMap[u.toLowerCase()], pass: 'demo123', traineeData: { email: "demo@herotel.com" } };
      window.CURRENT_USER = CURRENT_USER;
      sessionStorage.setItem('currentUser', JSON.stringify(CURRENT_USER));
      persistAppSession(CURRENT_USER);
      
      // Generate a perfect demo state if the bubble is empty
      if (!localStorage.getItem('users')) {
          const t = new Date();
          const td = t.toISOString().split('T')[0];
          const yd = new Date(t.getTime() - 86400000).toISOString().split('T')[0];
          const tm = new Date(t.getTime() + 86400000).toISOString().split('T')[0];

          const mockUsers = [
              { user: 'demo_admin', role: 'super_admin', pass: 'demo123', theme: { primaryColor: '#F37021', wallpaper: '' } },
              { user: 'demo_tl', role: 'teamleader', pass: 'demo123', theme: { primaryColor: '#3498db', wallpaper: '' } },
              { user: 'demo_trainee', role: 'trainee', pass: 'demo123', theme: { primaryColor: '#2ecc71', wallpaper: '' }, traineeData: { email: "demo@herotel.com", phone: "0820000000", contact: "0820000000", knowledge: "Networking Basics", completedDate: yd + "T08:00:00.000Z" }, hasFilledQuestionnaire: true, boundClientId: "CL-DEMO" }
          ];
          
          localStorage.setItem('users', JSON.stringify(mockUsers));
          localStorage.setItem('rosters', JSON.stringify({ "Demo Cohort": ["demo_trainee"] }));
          
          // --- REALISTIC DEMO DATA BASED ON PRODUCTION SCHEMA ---
          const demoTests = [
              {
                  id: "t_std_1", type: "standard", title: "Course 1 - Terms", duration: null,
                  questions: [
                      { id: "q1", text: "There are 2 types of twisted pair cables , name them as well when they are most commonly used.", type: "text", points: 4, modelAnswer: "STP : Outdoor use\nUTP : Indoor use" },
                      { id: "q2", text: "What is the differance between TCP and UDP ?", type: "multi_select", points: 4, options: ["TCP is connection orreinted", "Both TCP & UDP is ideal for VoIP traffic", "UDP send & receives packets without acknowledgements", "TCP adjusts the packets size", "UDP is ideal for sending a email", "TCP provides error checking."], correct: [0, 2, 3, 5] },
                      { id: "q3", text: "Match the function to the equipment that performs it.", type: "matching", pairs: [{ left: "PTMP", right: "A device where multiple other devices can connect to wirelessly" }, { left: "ONT / ONU", right: "The equipment that convers a fibre signal into a copper signal" }], points: 2 }
                  ]
              },
              {
                  id: "t_liv_1", type: "live", title: "Course 2 - Programs & Websites - Q-Contact", shuffle: false, duration: null,
                  questions: [
                      { id: "q4", text: "Scenario: You are working in the field and you need to contact previous customers... Perform the task on check your current open tickets.", type: "live_practical", points: 1, adminNotes: "Agent navigated from overview page to Tickets" },
                      { id: "q5", text: "Create a outbound whatsapp to the customer provided by the trainer", type: "live_practical", points: 2, adminNotes: "1. Created whatsapp from open ticket 2. Used correct snippet" },
                      { id: "q6", text: "True or False: When you are on a paused Status you will not be able to receive any type of interaction in any circumstances.", type: "text", points: 2, modelAnswer: "False - unless its an internal transfer" }
                  ]
              },
              {
                  id: "t_vet_1", type: "vetting", title: "1st Vetting - No internet 1st Vetting test", duration: "60",
                  questions: [
                      { id: "q7", text: "Scenario : A customer contacts in to the first line support department. How must the agent answer the communication ?", type: "multiple_choice", points: 1, options: ["Hello , whats wrong ?", "Good day , support here.", "Hi , yes ?", "Thank you for calling Herotel Technical Support , (Name) speaking."], correct: 3 },
                      { id: "q8", text: "What is the aim of showing empathy towards the customer ?", type: "text", points: 1, adminNotes: "builds trust and rapport with the customer" },
                      { id: "q9", text: "A customer contacts in stating that they do not have internet access. The cables and power for the fibre connection is correct, equipment is powered on, red light flashing on ONT. ONT status on preseem is wire down. What is the next step?", type: "text", points: 2, adminNotes: "Confirm if its a singular customer affected on the PON. Escalate to FO if singular, escalate to C & A if multiple." }
                  ]
              }
          ];
          localStorage.setItem('tests', JSON.stringify(demoTests));
          
          const demoSchedules = {
              "A": {
                  assigned: "Demo Cohort",
                  items: [
                      { dateRange: yd, courseName: "Training Rules", materialLink: "https://hereto.sharepoint.com/:b:/s/CEN_Helpdesk-1stLineTraining/IQCJkVn4sWZGRZndikSP8mozAeaEk9Kxr4Gq_SbHKZgq3nU?e=Oj2lZl", materialAlways: true, ignoreTime: true },
                      { dateRange: td, dueDate: tm, courseName: "Course 1 - Terms", linkedTestId: "t_std_1", openTime: "08:00", closeTime: "17:00", ignoreTime: false, materialLink: "https://view.genially.com/692d76dce9bbbf3795725d38" },
                      { dateRange: td, courseName: "Course 2 - Programs & Websites - Q-Contact", isLive: true, ignoreTime: false },
                      { dateRange: tm, dueDate: tm, courseName: "1st Vetting - No internet 1st Vetting test", linkedTestId: "t_vet_1", isVetting: true, ignoreTime: true, openTime: "08:00", closeTime: "17:00" }
                  ]
              }
          };
          localStorage.setItem('schedules', JSON.stringify(demoSchedules));
          
          const demoLiveSchedules = {
              "A": { assigned: "Demo Cohort", startDate: yd, days: 14, activeSlots: ["1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"], trainers: ["Darren", "Netta", "Jaco"], dailyTrainers: {} }
          };
          localStorage.setItem('liveSchedules', JSON.stringify(demoLiveSchedules));
          
          const demoLiveBookings = [
              { id: "b1", date: yd, time: "1:00 PM", status: "Completed", trainee: "demo_trainee", trainer: "Darren", assessment: "Course 2 - Programs & Websites - Q-Contact", score: 85 },
              { id: "b2", date: td, time: "2:00 PM", status: "Booked", trainee: "demo_trainee", trainer: "Netta", assessment: "Course 2 - Programs & Websites - Corteza" },
              { id: "b3", date: td, time: "3:00 PM", status: "Cancelled", trainee: "demo_trainee", trainer: "Jaco", assessment: "Course 2 - Programs & Websites - Radius Server", cancelledAt: new Date().toISOString(), cancelledBy: "demo_trainee" }
          ];
          localStorage.setItem('liveBookings', JSON.stringify(demoLiveBookings));
          
          const demoRecords = [
              { id: "r1", date: yd, phase: "Assessment", cycle: "New Onboard", score: 92, groupID: "Demo Cohort", trainee: "demo_trainee", assessment: "Course 1 - Terms", docSaved: true, link: "Digital-Assessment", submissionId: "s1" },
              { id: "r2", date: yd, phase: "Assessment", cycle: "Live", score: 85, groupID: "Demo Cohort", trainee: "demo_trainee", assessment: "Course 2 - Programs & Websites - Q-Contact", docSaved: true, link: "Live-Session", bookingId: "b1" },
              { id: "r3", date: yd, phase: "Assessment", cycle: "New Onboard", score: 45, groupID: "Demo Cohort", trainee: "demo_trainee", assessment: "Course 3 - Networking", docSaved: true, link: "Digital-Assessment" }
          ];
          localStorage.setItem('records', JSON.stringify(demoRecords));
          
          const demoSubmissions = [
              { 
                  id: "s1", testId: "t_std_1", testTitle: "Course 1 - Terms", trainee: "demo_trainee", date: yd, status: "completed", score: 92, 
                  answers: { "0": "STP is for outdoor, UTP is for indoor", "1": [0, 2, 3], "2": {"0": "0", "1": "1"} }, 
                  marker: "demo_admin", scores: { "0": 4, "1": 4, "2": 2 }, comments: { "0": "Good", "1": "", "2": "" },
                  testSnapshot: demoTests[0] 
              },
              {
                  id: "s2", testId: "t_liv_1", testTitle: "Course 2 - Programs & Websites - Q-Contact", trainee: "demo_trainee", date: yd, status: "completed", score: 85,
                  marker: "Darren", scores: { "0": 1, "1": 2, "2": 2 },
                  answers: { "0": "Completed", "1": "Completed", "2": "False, unless it's an internal transfer" },
                  comments: { "0": "", "1": "Used correct snippet", "2": "" },
                  testSnapshot: demoTests[1]
              },
              {
                  id: "s3", testId: "t_vet_1", testTitle: "1st Vetting - No internet 1st Vetting test", trainee: "demo_trainee", date: td, status: "pending", score: 0,
                  answers: { "0": 3, "1": "To build rapport.", "2": "Escalate to C & A." },
                  testSnapshot: demoTests[2]
              }
          ];
          localStorage.setItem('submissions', JSON.stringify(demoSubmissions));
          
          const demoAttendance = [
              { id: "a1", user: "demo_trainee", date: yd, clockIn: "07:51:20 AM", clockOut: "4:55:00 PM", isLate: false, lateData: null, lateConfirmed: false, adminComment: "" },
              { id: "a2", user: "demo_trainee", date: td, clockIn: "08:15:12 AM", clockOut: null, isLate: true, lateData: { reason: "Traffic", contact: "demo_tl", informed: true, platform: "WhatsApp" }, lateConfirmed: false, adminComment: "" }
          ];
          localStorage.setItem('attendance_records', JSON.stringify(demoAttendance));
          
          const demoMonitorData = {
              "demo_trainee": { current: "Studying: Course 1 - Terms (SharePoint)", since: t.getTime() - 3600000, isStudyOpen: true, history: [] }
          };
          localStorage.setItem('monitor_data', JSON.stringify(demoMonitorData));
          
          const demoMonitorHistory = [
              { 
                  date: yd, user: "demo_trainee", 
                  summary: { study: 18000000, tool: 3600000, external: 180000, idle: 600000, total: 22380000 }, 
                  details: [
                      { activity: "Studying: Q-Contact (Work System)", start: new Date(`${yd}T08:00:00`).getTime(), duration: 18000000, end: new Date(`${yd}T13:00:00`).getTime() },
                      { activity: "System: Task Manager", start: new Date(`${yd}T14:00:00`).getTime(), duration: 3600000, end: new Date(`${yd}T15:00:00`).getTime() },
                      { activity: "Violation: YouTube", start: new Date(`${yd}T15:00:00`).getTime(), duration: 180000, end: new Date(`${yd}T15:03:00`).getTime() },
                      { activity: "Idle", start: new Date(`${yd}T15:03:00`).getTime(), duration: 600000, end: new Date(`${yd}T15:13:00`).getTime() }
                  ] 
              }
          ];
          localStorage.setItem('monitor_history', JSON.stringify(demoMonitorHistory));
          
          localStorage.setItem('notices', JSON.stringify([
              { id: "n1", message: "Welcome to the Demo Sandbox Environment! All data generated here is isolated and mimics a realistic production state.", targetRole: "all", type: "info", active: true, date: td, acks: [] }
          ]));
          
          localStorage.setItem('SEED_DEMO', 'true');
      }
      
      // CRITICAL ARCHITECTURAL FIX: 
      // We MUST hard-reload the window to guarantee data.js evaluates the IS_DEMO_MODE flag 
      // correctly on boot. Using setTimeout ensures disk writes complete before the renderer tears down.
      setTimeout(() => window.location.reload(), 150);
      return;
  }
  // -----------------------------

  await refreshAuthCriticalDataFromServer();

  // --- SECURITY CHECK 1: REVOKED ACCESS (Blacklist) ---
  if (isUserRevokedLocally(u)) {
      document.getElementById('loginError').innerText = "Access has been revoked for this account.";
      document.getElementById('loginError').style.color = "#ff5252";
      return;
  }

  // --- SECURITY CHECK 1.2: PENDING UPDATE ---
  if (window.UPDATE_DOWNLOADED) {
      document.getElementById('loginError').innerText = "Update Ready. Please restart to install.";
      return;
  }

  // --- SECURITY CHECK 1.5: PRE-AUTH CHECKS (Version, Client ID) ---
  const config = JSON.parse(localStorage.getItem('system_config') || '{}');
  if (config.security) {
      // Version Check (Semantic Comparison)
      if (config.security.min_version) {
          // Fetch dynamically if missing to allow Dev Mode (npm start) logins
          let appVer = window.APP_VERSION;
          if (!appVer) {
              if (typeof require !== 'undefined') {
                  try { appVer = await require('electron').ipcRenderer.invoke('get-app-version'); } catch(e) {}
              }
              if (!appVer) appVer = '999.99.99'; // Fallback for dev mode / crashes
              window.APP_VERSION = appVer;
          }
          
          const currentParts = appVer.split('.').map(Number);
          const minParts = config.security.min_version.split('.').map(Number);
          
          let isOutdated = false;
          for (let i = 0; i < Math.max(currentParts.length, minParts.length); i++) {
              const curr = currentParts[i] || 0;
              const min = minParts[i] || 0;
              if (curr < min) { isOutdated = true; break; }
              if (curr > min) { isOutdated = false; break; }
          }

          if (isOutdated) {
             document.getElementById('loginError').innerText = `Update Required. Min Version: ${config.security.min_version}`;
             // Force check for updates if outdated
             if (typeof require !== 'undefined') {
                 try { require('electron').ipcRenderer.send('manual-update-check', { channel: 'main' }); } catch(e){}
             }
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
      const nameMatch = String((x && (x.user || x.username)) || '').trim().toLowerCase() === u.toLowerCase();
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
    const isBlocked = validUser.blocked === true || String(validUser.status || '').toLowerCase().trim() === 'blocked';
    if (isBlocked) {
        document.getElementById('loginError').innerText = "Account is blocked. Please contact an administrator.";
        return;
    }

    // --- SECURITY CHECK 2.5: MAINTENANCE & LOCKDOWN (Requires User Role) ---
    if (config.security) {
        // Maintenance Mode
        if (config.security.maintenance_mode && validUser.role !== 'admin' && validUser.role !== 'super_admin') {
            document.getElementById('loginError').innerText = "System is in Maintenance Mode. Admin access only.";
            return;
        }
        // Lockdown Check
        if (config.security.lockdown_mode && validUser.role !== 'super_admin') {
            document.getElementById('loginError').innerText = "SYSTEM LOCKDOWN ACTIVE. Access Denied.";
            return;
        }
    }

    // --- IP ACCESS CONTROL CHECK ---
    const accessGranted = await checkAccessControl();
    if(!accessGranted) return; // Overlay will show, stop login
    // -------------------------------

    // --- SECURITY CHECK 3: REVOKED USERS & CLIENT ID BINDING (STRICT) ---
    // 1) Deny access immediately if the username is present in the revokedUsers blacklist
    try {
        const isRevoked = isUserRevokedLocally(validUser.user || validUser.username);
        if (isRevoked) {
            document.getElementById('loginError').innerText = "Account access revoked.";
            return;
        }
    } catch (e) {
        // Ignore parsing errors and continue (no blacklist applied)
    }

    // 2) Client binding: treat empty/null/'undefined' strings as UNBOUND (safe binding)
    const currentClientId = localStorage.getItem('client_id') || '';
    const isRoamingUser = (validUser.role === 'admin' || validUser.role === 'super_admin');

    if (!isRoamingUser) {
        const rawBound = typeof validUser.boundClientId === 'undefined' ? '' : String(validUser.boundClientId || '').trim();
        const isBound = rawBound !== '' && rawBound.toLowerCase() !== 'undefined' && rawBound.toLowerCase() !== 'null';

        if (isBound) {
            // If user is bound, ID MUST match exactly (trimmed)
            if (rawBound !== String(currentClientId || '').trim()) {
                console.error("Security Violation: Client ID Mismatch");
                nukeApplication(); // TERMINATE
                return;
            }
        } else {
            // First time login or explicitly unbound: bind this client ID to the user
            try {
                console.log("Binding user to this Client ID...");
                validUser.boundClientId = String(currentClientId || '').trim();
                const idx = users.findIndex(u => String(u.user || '') === String(validUser.user || ''));
                if (idx > -1) users[idx] = validUser;
                localStorage.setItem('users', JSON.stringify(users));
                secureAuthSave();
            } catch (e) {
                console.warn('Failed to persist boundClientId locally:', e);
            }
        }
    }
    // ----------------------------------------------------

    const userRole = validUser.role ? validUser.role.toLowerCase().trim() : '';
    const activeBootMode = String(window.APP_BOOT_MODE || '').toLowerCase().trim();
    if (activeBootMode === 'trainee' && userRole !== 'trainee') {
      document.getElementById('loginError').innerText = "This startup is locked to Trainee runtime. Restart and choose Admin / Teamleader.";
      return;
    }
    if (activeBootMode === 'admin' && userRole === 'trainee') {
      document.getElementById('loginError').innerText = "This startup is locked to Admin / Teamleader runtime. Restart and choose Trainee.";
      return;
    }
    if(window.LOGIN_MODE === 'admin' && (userRole === 'trainee' && userRole !== 'super_admin')) {
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
    window.CURRENT_USER = CURRENT_USER;
    // Normalize role for session consistency
    if (CURRENT_USER.role) CURRENT_USER.role = CURRENT_USER.role.toLowerCase().trim();
    const sessionBootMode = CURRENT_USER.role === 'trainee' ? 'trainee' : 'admin';
    window.APP_BOOT_MODE = sessionBootMode;
    sessionStorage.setItem('boot_role_selection', sessionBootMode);
    
    sessionStorage.setItem('currentUser', JSON.stringify(validUser));
    persistAppSession(validUser);
    
    // --- REMEMBER ME LOGIC ---
    const remember = document.getElementById('rememberMe').checked;
    if (remember) {
        localStorage.setItem('rememberedUser', JSON.stringify({
            user: validUser.user,
            pass: validUser.pass,
            role: CURRENT_USER.role,
            bootMode: sessionBootMode
        }));
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

function nukeApplication() {
    alert("SECURITY VIOLATION DETECTED\n\nThis account is bound to a different terminal.\nAccess Denied. Application will reset.");
    localStorage.clear();
    sessionStorage.clear();
    if (typeof require !== 'undefined') {
        try { require('electron').ipcRenderer.send('force-restart'); } catch(e) { location.reload(); }
    } else { location.reload(); }
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

  // Revert to Standard Footer (Profile moved to Header)
  document.getElementById('user-footer').innerHTML = `Logged in as: <strong>${CURRENT_USER.user}</strong> (${CURRENT_USER.role}) <span id="sync-indicator-wrap" class="sync-indicator-wrap"><span id="sync-indicator" style="margin-left:15px; transition: opacity 0.5s; font-size: 0.9em;"></span><div id="sync-detail-popover" class="sync-detail-popover hidden"></div></span>`;
  if (typeof window.updateSyncDiagnostics === 'function') {
      window.updateSyncDiagnostics({
          status: 'success',
          statusText: 'Session ready',
          direction: 'idle',
          phase: 'Waiting for next sync event',
          item: '-',
          progressDone: 0,
          progressTotal: 0,
          bytesDone: 0,
          bytesTotal: 0,
          lastSuccessAt: Date.now(),
          startedAt: 0
      });
  }
  
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
  
  // FIX: Ensure sidebar/header buttons (like Super Admin) are updated immediately
  if (typeof updateSidebarVisibility === 'function') updateSidebarVisibility();
  
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
      await StudyMonitor.init();
  }
  
  // --- START VETTING ENFORCER ---
  if (typeof initVettingEnforcer === 'function') initVettingEnforcer();

  if (window.APP_BOOT_MODE === 'trainee' && CURRENT_USER.role === 'trainee' && typeof loadFromServer === 'function') {
      try {
          await loadFromServer(true);
      } catch (error) {
          console.warn("Trainee post-login sync failed:", error);
      }
  }

  // Redirect based on role
  if (window.RESTORE_TAB) {
      showTab(window.RESTORE_TAB);
      window.RESTORE_TAB = null;
      // Auto-restore drafts if this was an update reboot
      if (window.IS_UPDATE_RESTORE) {
          if (typeof restoreAssessmentDraft === 'function') restoreAssessmentDraft();
          if (typeof restoreBuilderDraft === 'function') restoreBuilderDraft();
      }
  } else if(CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin') showTab('dashboard-view'); 
  else if(CURRENT_USER.role === 'trainee') showTab('trainee-portal');
  else showTab('monthly'); // Team Leader
}

function checkFirstTimeLogin() {
    if (CURRENT_USER.role === 'trainee' && !CURRENT_USER.hasFilledQuestionnaire) {
        document.getElementById('questionnaireModal').classList.remove('hidden');
    }
}

function applyRolePermissions() {
  const applyHeaderIconButtonStyle = (button, opts = {}) => {
      if (!button) return;
      const marginLeft = (opts && typeof opts.marginLeft === 'string') ? opts.marginLeft : '5px';
      button.style.padding = '0';
      button.style.width = '40px';
      button.style.height = '40px';
      button.style.display = 'flex';
      button.style.alignItems = 'center';
      button.style.justifyContent = 'center';
      button.style.borderRadius = '50%';
      button.style.overflow = 'visible';
      button.style.marginLeft = marginLeft;
      button.style.border = 'none';
      button.style.background = 'transparent';
      button.style.cursor = 'pointer';
      button.style.zIndex = '100';
  };

  const normalizeIdentity = (value) => {
      let v = String(value || '').trim().toLowerCase();
      if (!v) return '';
      if (v.includes('@')) v = v.split('@')[0];
      v = v.replace(/[._-]+/g, ' ');
      v = v.replace(/\s+/g, ' ').trim();
      return v;
  };
  const identitiesMatch = (a, b) => {
      const na = normalizeIdentity(a);
      const nb = normalizeIdentity(b);
      if (!na || !nb) return false;
      if (na === nb) return true;
      return na.replace(/\s+/g, '') === nb.replace(/\s+/g, '');
  };

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
  
  // --- ADMIN TOOLS BUTTON ---
  if(adminPanelBtn) {
      // Reset to standard Admin Tools appearance
      adminPanelBtn.title = "Admin Panel";
      adminPanelBtn.innerHTML = '<i class="fas fa-cogs"></i>';
      adminPanelBtn.onclick = function() { showTab('admin-panel'); };
      
      // Clear custom avatar styles from previous version
      adminPanelBtn.style.padding = '';
      adminPanelBtn.style.width = '';
      adminPanelBtn.style.height = '';
      adminPanelBtn.style.display = '';
      adminPanelBtn.style.alignItems = '';
      adminPanelBtn.style.justifyContent = '';
      adminPanelBtn.style.borderRadius = '';
      adminPanelBtn.style.overflow = '';

      // Visibility Logic: Only for Admins
      if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin' || CURRENT_USER.role === 'special_viewer') {
          adminPanelBtn.classList.remove('hidden');
      } else {
          adminPanelBtn.classList.add('hidden');
      }
  }

  // --- 2. PROFILE SETTINGS BUTTON ---
  let controlContainer = document.querySelector('.control-bubble .bubble-content');
  if (!controlContainer && adminPanelBtn && adminPanelBtn.parentElement) {
      controlContainer = adminPanelBtn.parentElement;
  }
  
  if (controlContainer) {
      let traineeHomeBtn = document.getElementById('btn-trainee-home');
      if (traineeHomeBtn) traineeHomeBtn.remove();

      // Remove any existing profile buttons to prevent duplicates/stale state
      let profileBtn = document.getElementById('btn-profile-settings');
      if (profileBtn) profileBtn.remove();

      // Create Fresh Button
      profileBtn = document.createElement('button');
      profileBtn.id = 'btn-profile-settings';
      profileBtn.className = 'icon-btn';
      
      // Force Insert at the START of the container
      controlContainer.prepend(profileBtn);

      profileBtn.title = "Profile & Settings";
      profileBtn.innerHTML = '<i class="fas fa-user-gear"></i>';
      
      profileBtn.onclick = function(e) { 
          e.preventDefault();
          if(typeof openUnifiedProfileSettings === 'function') openUnifiedProfileSettings(); 
          else alert("Settings module loading...");
      };
      
      // Ensure visibility for all roles
      profileBtn.classList.remove('hidden', 'admin-only');
      applyHeaderIconButtonStyle(profileBtn, { marginLeft: '5px' });

      if (CURRENT_USER.role === 'trainee') {
          traineeHomeBtn = document.createElement('button');
          traineeHomeBtn.id = 'btn-trainee-home';
          traineeHomeBtn.className = 'icon-btn';
          traineeHomeBtn.title = 'Portal Home';
          traineeHomeBtn.innerHTML = '<i class="fas fa-house"></i>';
          traineeHomeBtn.classList.remove('hidden', 'admin-only');
          traineeHomeBtn.onclick = function(e) {
              e.preventDefault();
              if (typeof showTab === 'function') showTab('trainee-portal');
          };
          applyHeaderIconButtonStyle(traineeHomeBtn, { marginLeft: '0' });

          if (profileBtn.nextSibling) controlContainer.insertBefore(traineeHomeBtn, profileBtn.nextSibling);
          else controlContainer.appendChild(traineeHomeBtn);
      }
  } else {
      console.warn("Profile Button: Control container not found.");
  }

  // --- SUB-MENU CONTROL (New Logic) ---
  const subBtnAssess = document.getElementById('btn-sub-assessments');
  const subBtnInsightRules = document.getElementById('btn-sub-insight-rules');
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
    if(subBtnInsightRules) subBtnInsightRules.classList.remove('hidden');
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
        if(subBtnInsightRules) subBtnInsightRules.classList.add('hidden');
        // Keep user controls visible for filtering, but actions will be hidden by admin_users.js
    } else {
        document.getElementById('admin-create-user-card')?.classList.remove('hidden');
        document.getElementById('admin-user-controls')?.classList.remove('hidden');
    }
    
  } 
  else {
    // === NON-ADMIN (TL & Trainee) ===
    
    // Hide Advanced Admin Sub-Tabs
    if(subBtnAssess) subBtnAssess.classList.add('hidden');
    if(subBtnInsightRules) subBtnInsightRules.classList.add('hidden');
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
        else {
            const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
            const activeSessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
            const isTargeted = (s) => {
                if (!s || !s.active) return false;
                if (!s.targetGroup || s.targetGroup === 'all') return true;
                const members = rosters[s.targetGroup] || [];
                return members.some(m => identitiesMatch(m, CURRENT_USER.user));
            };
            if (session.active && isTargeted(session)) show = true;
            if (!show && Array.isArray(activeSessions) && activeSessions.some(isTargeted)) show = true;
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
        const allowedSections = ['report-card', 'admin-panel', 'test-records', 'agent-search'];
        
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
        
        // Hide Admin Sections but keep the shared admin landing shell visible
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
  const realAdminRaw = sessionStorage.getItem('real_admin_identity');
  if (realAdminRaw) {
      sessionStorage.setItem('currentUser', realAdminRaw);
      sessionStorage.removeItem('real_admin_identity');
      sessionStorage.removeItem('impersonating_user');
      try {
          const parsed = JSON.parse(realAdminRaw);
          if (parsed && typeof persistAppSession === 'function') persistAppSession(parsed);
      } catch (e) {}
      location.reload();
      return;
  }

  const isDemo = localStorage.getItem('DEMO_MODE') === 'true';

  // ARCHITECTURAL FIX: KIOSK MODE TRAP
  // Ensure we drop OS lockdown shields before logging out, otherwise 
  // the user gets trapped on the login screen in full-screen Kiosk mode.
  if (typeof require !== 'undefined') {
      try {
          const { ipcRenderer } = require('electron');
          await ipcRenderer.invoke('set-kiosk-mode', false);
          await ipcRenderer.invoke('set-content-protection', false);
      } catch(e) { console.error("Kiosk unlock failed on logout:", e); }
  }

  if (CURRENT_USER && typeof logAccessEvent === 'function') {
      await logAccessEvent(CURRENT_USER.user, 'Logout');
  }

  CURRENT_USER = null;
  window.CURRENT_USER = null;
  
  // --- NEW: CLEANUP BACKGROUND PROCESSES ---
  if (typeof window.cleanupVettingEnforcer === 'function') {
      window.cleanupVettingEnforcer();
  }

  sessionStorage.clear();
  clearPersistentAppSession();
  if (isDemo) localStorage.clear();

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

/* ================= MAIN ENTRY ================= */

// --- HELPER: ASYNC SAVE ---
// Ensures initialization data (like default admin) is saved to Supabase before app usage.
async function secureInitSave() {
    // In the Cloud version, we treat initialization saves as critical.
    // We attempt to sync immediately.
    if (typeof saveToServer === 'function') {
        try {
            await saveToServer(['users'], true);
        } catch(e) {
            console.error("Init Cloud Sync Error:", e);
        }
    }
}

window.onload = async function() {
    // SHOW LOADER
    const loader = document.getElementById('global-loader');
    if(loader) loader.classList.remove('hidden');

    // GET APP VERSION
    if (typeof require !== 'undefined') {
        const { ipcRenderer } = require('electron');
        ipcRenderer.invoke('get-app-version').then(ver => {
            window.APP_VERSION = ver;
        });
    }

    // 1. Load Data from Supabase (CRITICAL: Wait for this)
    if (typeof loadFromServer === 'function') {
        try {
            await loadFromServer();
        } catch (e) {
            console.error("CRITICAL: Failed to load cloud data.", e);
            alert("⚠️ OFFLINE MODE\n\nCould not connect to Supabase.\nYou are viewing cached data. Changes may not be saved.");
            // Prevent auto-save to avoid overwriting cloud data with empty local data
            if(typeof AUTO_BACKUP !== 'undefined') AUTO_BACKUP = false; 
        }
    }

    // --- NEW: Start Real-Time Polling (Heartbeat & Sync) ---
    // This activates the Supabase polling defined in data.js
    if (typeof startRealtimeSync === 'function') {
        startRealtimeSync();
    }
    // ------------------------------------
    
    // Migrate old data structures if necessary
    if (typeof migrateData === 'function') migrateData();

    // Initialize Defaults if missing (Safety Checks)
    let defaultsChanged = false;
    if(!localStorage.getItem('liveScheduleSettings')) {
        localStorage.setItem('liveScheduleSettings', JSON.stringify({ startDate: new Date().toISOString().split('T')[0], days: 7 }));
        defaultsChanged = true;
    }
    if(!localStorage.getItem('assessments')) {
        localStorage.setItem('assessments', JSON.stringify(DEFAULT_ASSESSMENTS)); 
        defaultsChanged = true;
    }
    if(!localStorage.getItem('vettingTopics')) {
        localStorage.setItem('vettingTopics', JSON.stringify(DEFAULT_VETTING_TOPICS));
        defaultsChanged = true;
    }
    
    // Ensure Admin Account exists
    let users = JSON.parse(localStorage.getItem('users') || '[]');
    let admin = users.find(u => u.user === 'admin');
    let usersModified = false;

    if(!admin) { 
        users.push({user: 'admin', pass: 'Pass0525@', role: 'admin'}); 
        usersModified = true;
    } 
    else if(admin.pass === 'admin') { 
        admin.pass = 'Pass0525@'; 
        usersModified = true;
    }
    
    if(usersModified) {
        localStorage.setItem('users', JSON.stringify(users));
        defaultsChanged = true;
    }

    // SYNC: If we modified defaults, sync immediately and WAIT
    if (defaultsChanged) {
        await secureInitSave();
    }

    // --- INITIAL POPULATION ---
    // These run immediately to ensure dropdowns are ready
    if(typeof populateYearSelect === 'function') populateYearSelect();
    if(typeof populateTraineeDropdown === 'function') populateTraineeDropdown();
    if(typeof loadRostersList === 'function') loadRostersList();
    
    // Load Access Control UI (Ensure IP list is loaded on refresh)
    if(typeof loadAdminAccess === 'function') loadAdminAccess();

    // Restore Session (With IP Security Check)
    const savedSession = sessionStorage.getItem('currentUser');
    if(savedSession) {
        // Verify IP again on refresh to prevent session hijacking across locations
        if (typeof checkAccessControl === 'function') {
            checkAccessControl().then(allowed => {
                if(allowed) {
                    CURRENT_USER = JSON.parse(savedSession);
                    // --- NEW: Apply User Specific Theme Immediately ---
                    applyUserTheme(); 
                    // --------------------------------------------------
                    // Update Sidebar based on Role
                    updateSidebarVisibility();
                    
                    if (typeof autoLogin === 'function') autoLogin();
                } else {
                    sessionStorage.removeItem('currentUser'); // Clear invalid session
                }
            });
        } else {
            // Fallback if IP check isn't loaded
             CURRENT_USER = JSON.parse(savedSession);
             applyUserTheme();
             updateSidebarVisibility();
             if (typeof autoLogin === 'function') autoLogin();
        }
    } else {
        // --- CHECK REMEMBER ME ---
        const remembered = localStorage.getItem('rememberedUser');
        if (remembered) {
            try {
                const creds = JSON.parse(remembered);
                const allUsers = JSON.parse(localStorage.getItem('users') || '[]');
                const valid = allUsers.find(u => u.user === creds.user && u.pass === creds.pass);
                if (valid) {
                    // PRE-FILL CREDENTIALS (No Auto-Login)
                    if (valid.role === 'admin' || valid.role === 'teamleader') {
                        if (typeof toggleLoginMode === 'function') toggleLoginMode('admin');
                        const adminInp = document.getElementById('adminUsername');
                        if(adminInp) adminInp.value = valid.user;
                    } else {
                        if (typeof toggleLoginMode === 'function') toggleLoginMode('trainee');
                        const traineeInp = document.getElementById('traineeUsername');
                        if(traineeInp) traineeInp.value = valid.user;
                    }
                    
                    const passInp = document.getElementById('password');
                    if(passInp) passInp.value = valid.pass;
                    
                    const remCheck = document.getElementById('rememberMe');
                    if(remCheck) remCheck.checked = true;
                }
            } catch(e) { console.error("Remember Me Failed", e); }
        }
    }

    // Auto Backup Toggle State
    const backupToggle = document.getElementById('autoBackupToggle');
    if(backupToggle) {
        // Logic to sync UI with state
        const autoBackupState = localStorage.getItem('autoBackup') === 'true';
        backupToggle.checked = autoBackupState;
        // Global variable used in config/data
        if(typeof AUTO_BACKUP !== 'undefined') AUTO_BACKUP = autoBackupState;
    }

    // Poll for notifications every minute
    setInterval(updateNotifications, 60000);
    // Also run once immediately if logged in
    if(savedSession) setTimeout(updateNotifications, 1000); 

    // HIDE LOADER
    if(loader) loader.classList.add('hidden');
};

// --- NEW: THEME APPLICATION LOGIC ---
function applyUserTheme() {
    const localTheme = JSON.parse(localStorage.getItem('local_theme_config') || 'null');
    if (!localTheme) return; // Fallback to CSS defaults

    const root = document.documentElement;
    
    // 1. Primary Color
    if (localTheme.primaryColor) {
        root.style.setProperty('--primary', localTheme.primaryColor);
        // Calculate a softer version for backgrounds
        root.style.setProperty('--primary-soft', adjustOpacity(localTheme.primaryColor, 0.15));
    }

    // 2. Wallpaper / Background
    if (localTheme.wallpaper) {
        document.body.style.backgroundImage = `url('${localTheme.wallpaper}')`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
        document.body.style.backgroundAttachment = 'fixed';
        // Add a dark overlay to ensure text readability
        if (!document.getElementById('bg-overlay')) {
            const overlay = document.createElement('div');
            overlay.id = 'bg-overlay';
            overlay.style.position = 'fixed';
            overlay.style.top = '0'; overlay.style.left = '0';
            overlay.style.width = '100%'; overlay.style.height = '100%';
            overlay.style.background = 'rgba(0, 0, 0, 0.7)'; // Darken the wallpaper
            overlay.style.zIndex = '-1';
            document.body.appendChild(overlay);
        }
    } else {
        document.body.style.backgroundImage = '';
        const existingOverlay = document.getElementById('bg-overlay');
        if (existingOverlay) existingOverlay.remove();
    }
}

// Helper to create the soft color variant
function adjustOpacity(hex, alpha) {
    // Basic hex to rgba converter
    let c;
    if(/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)){
        c= hex.substring(1).split('');
        if(c.length== 3){
            c= [c[0], c[0], c[1], c[1], c[2], c[2]];
        }
        c= '0x'+c.join('');
        return 'rgba('+[(c>>16)&255, (c>>8)&255, c&255].join(',')+','+alpha+')';
    }
    return hex; // Return original if not hex
}
// ------------------------------------

// --- SIDEBAR VISIBILITY LOGIC ---
function updateSidebarVisibility() {
    if (!CURRENT_USER) return;

    const role = CURRENT_USER.role;
    const allNavItems = document.querySelectorAll('.nav-item');

    allNavItems.forEach(btn => {
        // Reset first
        btn.classList.remove('hidden');
        
        // Safety check for onclick attribute
        const clickAttr = btn.getAttribute('onclick');
        if (!clickAttr) return;

        const match = clickAttr.match(/'([^']+)'/);
        const targetTab = match ? match[1] : null;
        
        if (!targetTab) return;
        
        // Rules
        if (role === 'trainee') {
            // Trainees hide Admin, Manage, Capture, Monthly, Insights
            const hiddenForTrainee = ['admin-panel', 'manage', 'capture', 'monthly', 'insights', 'test-manage', 'test-records', 'live-assessment'];
            const visibleForTrainee = ['assessment-schedule', 'my-tests', 'dashboard-view', 'live-assessment', 'vetting-arena'];
            
            // Special Check for Arena
            if (targetTab === 'vetting-arena') {
                const session = JSON.parse(localStorage.getItem('vettingSession') || '{"active":false}');
                if (!session.active) btn.classList.add('hidden');
                return;
            }
            
            if (!visibleForTrainee.includes(targetTab)) btn.classList.add('hidden');
        } 
        else if (role === 'teamleader') {
            // Team Leaders hide Admin, Test Builder, My Tests, Live Assessment
            const hiddenForTL = ['admin-panel', 'test-manage', 'my-tests', 'live-assessment'];
            if (hiddenForTL.includes(targetTab)) btn.classList.add('hidden');
        }
        else if (role === 'admin') {
            // Admins hide "My Tests" (Take Test) usually, but we keep it visible for testing purposes
            if (targetTab === 'my-tests') btn.classList.add('hidden');
        }
    });
}

function showTab(id, btn) {
  // --- TEAM LEADER RESTRICTIONS (Double Check) ---
  if(CURRENT_USER && CURRENT_USER.role === 'teamleader') {
      // Block specific tabs even if clicked somehow
      const forbidden = ['test-manage', 'my-tests', 'live-assessment', 'admin-panel'];
      if(forbidden.includes(id)) {
          return; // Simply do nothing
      }
  }

  // HIDDEN LOGIC: Reset views
  document.querySelectorAll('section').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if(target) target.classList.add('active');
  
  // Update Sidebar
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  
  // Find button by onclick attribute (reliable for sidebar navigation)
  const sidebarBtn = document.querySelector(`button.nav-item[onclick="showTab('${id}')"]`);
  if(sidebarBtn) sidebarBtn.classList.add('active');
    
  // --- DYNAMIC DATA REFRESH ---
  // Whenever a tab is shown, refresh its specific data/dropdowns

  // NEW: Render Dashboard if Home Tab is clicked
  if(id === 'dashboard-view') {
      if(typeof renderDashboard === 'function') renderDashboard();
  }

  // === CORRECTED: Training Insight Tab ===
  if(id === 'insights') {
      // 1. Try to render the full dashboard
      if(typeof renderInsightDashboard === 'function') {
          try {
            renderInsightDashboard();
          } catch (e) {
            console.error("Dashboard Render Failed:", e);
          }
      }
      
      // 2. SAFETY: Explicitly populate the dropdown using the CORRECT function name
      if(typeof populateInsightGroupFilter === 'function') {
          try {
            populateInsightGroupFilter();
          } catch(e) {
            console.error("populateInsightGroupFilter failed:", e);
          }
      }
  }
  
  if(id === 'manage') {
      if(typeof loadRostersList === 'function') loadRostersList();
      if(typeof populateYearSelect === 'function') populateYearSelect(); 
  }
  
  if(id === 'capture') {
      if(typeof loadRostersToSelect === 'function') loadRostersToSelect('selectedGroup');
      if(typeof updateAssessmentDropdown === 'function') updateAssessmentDropdown();
  }
  
  if(id === 'monthly') {
      if(typeof loadAllDataViews === 'function') loadAllDataViews(); 
      populateFetchFilters();
  }
  
  if(id === 'report-card') {
      if(typeof loadReportTab === 'function') loadReportTab(); 
      
      // TEAM LEADER: Force View to Saved Reports Only
      if(CURRENT_USER && CURRENT_USER.role === 'teamleader') {
          setTimeout(() => {
              // Hide "Create New" button
              const btnCreate = document.getElementById('btn-rep-new');
              if(btnCreate) btnCreate.style.display = 'none';

              // Automatically click "Saved Reports"
              const btnSaved = document.getElementById('btn-rep-saved');
              if(btnSaved) btnSaved.click();
          }, 50);
      }
  }
  
  if(id === 'live-assessment') {
      if(typeof renderLiveTable === 'function') renderLiveTable();
  }
  
  if(id === 'assessment-schedule') {
      if(typeof renderSchedule === 'function') renderSchedule(); 
  }
  
  if(id === 'admin-panel') { 
      if(typeof loadAdminUsers === 'function') loadAdminUsers(); 
      if(typeof loadAdminAssessments === 'function') loadAdminAssessments(); 
      if(typeof loadAdminVetting === 'function') loadAdminVetting();
      if(typeof loadAdminDatabase === 'function') loadAdminDatabase(); 
      if(typeof loadAdminAccess === 'function') loadAdminAccess(); 
      if(typeof loadAdminTheme === 'function') loadAdminTheme(); 

      // TRAINEE FILTER: Only show their own user in the list
      if (CURRENT_USER && CURRENT_USER.role === 'trainee' && typeof filterUserListForTrainee === 'function') {
          setTimeout(filterUserListForTrainee, 50); // Small delay to ensure table is populated
      }
      
      // NEW: Refresh System Status if that specific view is open
      const statusView = document.getElementById('admin-view-status');
      if(statusView && statusView.classList.contains('active')) {
          if(typeof refreshSystemStatus === 'function') refreshSystemStatus();
      }
  }
  
  if(id === 'test-manage') {
      if(typeof loadManageTests === 'function') loadManageTests();
      if(typeof loadAssessmentDashboard === 'function') loadAssessmentDashboard();
      if(typeof loadMarkingQueue === 'function') loadMarkingQueue();
  }
  
  if(id === 'my-tests') {
      if(typeof loadTraineeTests === 'function') loadTraineeTests();
  }
  
  if(id === 'test-records') {
      if(typeof loadTestRecords === 'function') loadTestRecords();
  }
  
  if(id === 'vetting-arena') {
      if(typeof loadVettingArena === 'function') loadVettingArena();
  }
}

function showAdminSub(viewName, btn) {
  document.querySelectorAll('.admin-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('admin-view-' + viewName).classList.add('active');
  if(btn) btn.classList.add('active');
  
  // Trigger specific refresh for sub-tabs
  if(viewName === 'status' && typeof refreshSystemStatus === 'function') {
      refreshSystemStatus();
  }
  if(viewName === 'updates' && typeof loadAdminUpdates === 'function') {
      loadAdminUpdates();
  }
}

/* ================= HEADER BUTTONS ================= */

function refreshApp() {
    location.reload();
}

// triggerUpdateCheck removed - moved to admin_updates.js

function restartAndInstall() {
    try {
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('restart-app');
    } catch(e) {
        console.error("Restart failed:", e);
    }
}

function triggerForceRestart() {
    try {
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('force-restart');
    } catch(e) { location.reload(); }
}

function toggleTheme() {
    document.body.classList.toggle('light-mode');
    // Save preference
    const isLight = document.body.classList.contains('light-mode');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
}

function logout() {
    sessionStorage.removeItem('currentUser');
    window.location.reload();
}


/* ================= NOTIFICATIONS ================= */
function toggleNotifications() {
    const drop = document.getElementById('notificationDropdown');
    drop.classList.toggle('hidden');
    if(!drop.classList.contains('hidden')) updateNotifications();
}

function updateNotifications() {
    // Only for Trainees
    if(!CURRENT_USER || CURRENT_USER.role !== 'trainee') {
        const badge = document.getElementById('notifBadge');
        if(badge) badge.classList.add('hidden');
        return;
    }

    const notifList = document.getElementById('notifList');
    const badge = document.getElementById('notifBadge');
    if(!notifList || !badge) return; // Safety check

    notifList.innerHTML = '';
    let count = 0;

    // --- PROGRESS LOGIC START ---
    // 1. CALCULATE PROGRESS (LINKED TO INSIGHT DASHBOARD)
    // We use the centralized logic from insight.js to ensure the Trainee sees 
    // exactly what the Admin sees on the Insight Dashboard.
    
    const records = JSON.parse(localStorage.getItem('records') || '[]');
    const myRecords = records.filter(r => r.trainee === CURRENT_USER.user);
    
    let progress = 0;
    
    if (typeof calculateAgentStats === 'function') {
        // calculateAgentStats returns { progress, avgScore, etc... }
        // This function resides in insight.js
        const stats = calculateAgentStats(CURRENT_USER.user, myRecords);
        progress = stats.progress;
    } else {
        // Fallback if insight.js is not loaded yet
        progress = 0;
    }

    // Progress Bar Notification
    notifList.innerHTML += `
        <div class="notif-item" style="background:var(--bg-input); border-left:3px solid var(--primary); cursor:default;" aria-label="Training Progress Notification">
            <strong>Training Progress</strong>
            <div style="margin-top:5px; height:6px; background:#444; border-radius:3px;">
                <div style="width:${progress}%; background:var(--primary); height:100%; border-radius:3px; transition:width 0.5s;"></div>
            </div>
            <div style="font-size:0.8rem; margin-top:3px; text-align:right; color:var(--text-muted);">${progress}% Complete</div>
        </div>`;
    // --- PROGRESS LOGIC END ---

    // 2. LIVE ASSESSMENT UPDATES
    const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
    const myBookings = bookings.filter(b => b.trainee === CURRENT_USER.user);
    
    myBookings.forEach(b => {
        if(b.status === 'Completed') {
            count++; // Only increment badge count for concrete updates like this
            notifList.innerHTML += `
            <div class="notif-item" onclick="showTab('live-assessment')" aria-label="Assessment Completed: ${b.assessment}">
                <i class="fas fa-check-circle" style="color:#27ae60;"></i> 
                Live Assessment <strong>${b.assessment}</strong> marked Complete.
            </div>`;
        }
    });

    if (count > 0) {
        badge.innerText = count;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
    
    // NEW: Trigger Invasive Popup Check
    if (typeof checkUrgentNoticesPopup === 'function') {
        checkUrgentNoticesPopup();
    }
}

// --- FETCH RECORDS FILTER POPULATION ---
function populateFetchFilters() {
    const select = document.getElementById('filterAssessment');
    if(!select) return;
    
    const currentVal = select.value;
    const assessments = JSON.parse(localStorage.getItem('assessments') || '[]');
    const records = JSON.parse(localStorage.getItem('records') || '[]');
    
    // Combine names from Definitions and actual Records (history)
    const names = new Set();
    assessments.forEach(a => names.add(a.name));
    records.forEach(r => { if(r.assessment) names.add(r.assessment); });
    
    const sortedNames = Array.from(names).sort();
    
    select.innerHTML = '<option value="">None</option>';
    sortedNames.forEach(n => {
        select.add(new Option(n, n));
    });
    
    if(currentVal && names.has(currentVal)) select.value = currentVal;
}

// --- GLOBAL UTILS ---
function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
}

/* ================= UI UTILS ================= */
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="${type === 'success' ? 'fas fa-check-circle' : (type === 'error' ? 'fas fa-exclamation-circle' : 'fas fa-info-circle')}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    // Remove after 3 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- GLOBAL UPDATE LISTENERS ---
if (typeof require !== 'undefined') {
    const { ipcRenderer } = require('electron');

    ipcRenderer.on('update-message', (event, message) => {
        // Notify when an update is found and starting download
        if (message.text && message.text.includes('Update available')) {
            if(typeof showToast === 'function') showToast("New update found! Downloading...", "info");
        }
    });

    ipcRenderer.on('update-downloaded', (event) => {
        if(typeof showToast === 'function') showToast("Update downloaded. Restart to apply.", "success");
        
        // Add a restart button to the footer for easy access
        const footer = document.getElementById('user-footer');
        if (footer) {
            if (!document.getElementById('btn-footer-restart')) {
                const btn = document.createElement('button');
                btn.id = 'btn-footer-restart';
                btn.className = 'btn-success btn-sm';
                btn.style.marginLeft = '15px';
                btn.innerHTML = '<i class="fas fa-arrow-circle-up"></i> Restart Now';
                btn.onclick = restartAndInstall;
                footer.appendChild(btn);
            }
        }
    });
}

/* ================= INACTIVITY & DRAFT HANDLING ================= */

window.cacheAndLogout = async function() {
    console.log("Inactivity detected. Caching and logging out...");
    
    if (CURRENT_USER && typeof logAccessEvent === 'function') {
        await logAccessEvent(CURRENT_USER.user, 'Timeout');
    }
    
    // 1. Cache Assessment (If taking a test)
    const takingView = document.getElementById('test-take-view');
    if (takingView && takingView.classList.contains('active')) {
        if (typeof saveAssessmentDraft === 'function') saveAssessmentDraft();
    }
    
    // 2. Cache Test Builder (If creating a test)
    const builderView = document.getElementById('test-builder');
    if (builderView && builderView.classList.contains('active')) {
        if (typeof saveBuilderDraft === 'function') saveBuilderDraft();
    }

    alert("You have been logged out due to inactivity (20 mins).\n\nYour current work has been cached locally and will be restored when you log back in.");
    
    sessionStorage.removeItem('currentUser');
    window.location.reload();
};

function checkForDrafts() {
    // 1. Check Assessment Draft
    const draftAssess = localStorage.getItem('draft_assessment');
    if (draftAssess) {
        if (confirm("⚠️ Unfinished Assessment Found!\n\nYou were logged out while taking a test. Do you want to resume where you left off?")) {
            if (typeof restoreAssessmentDraft === 'function') restoreAssessmentDraft();
        } else {
            localStorage.removeItem('draft_assessment');
        }
    }

    // 2. Check Builder Draft
    const draftBuilder = localStorage.getItem('draft_builder');
    if (draftBuilder && CURRENT_USER.role === 'admin') {
        if (confirm("⚠️ Unsaved Test Draft Found!\n\nYou were logged out while building a test. Do you want to restore your draft?")) {
            if (typeof restoreBuilderDraft === 'function') restoreBuilderDraft();
        } else {
            localStorage.removeItem('draft_builder');
        }
    }
}
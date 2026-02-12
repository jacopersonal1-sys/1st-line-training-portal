/* ================= VETTING TEST ARENA ================= */
/* Handles high-security testing environment */

// --- ADMIN CONTROLS ---

let ADMIN_MONITOR_INTERVAL = null;
let TRAINEE_NET_POLLER = null;
let TRAINEE_LOCAL_POLLER = null;
let VETTING_REALTIME_UNSUB = null;
let ADMIN_VETTING_REALTIME_UNSUB = null;

function loadVettingArena() {
    if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'special_viewer') {
        renderAdminArena();
    } else {
        renderTraineeArena();
    }
}

function renderAdminArena() {
    if (ADMIN_MONITOR_INTERVAL) clearTimeout(ADMIN_MONITOR_INTERVAL);
    if (ADMIN_VETTING_REALTIME_UNSUB) { try { ADMIN_VETTING_REALTIME_UNSUB(); } catch (e) {} ADMIN_VETTING_REALTIME_UNSUB = null; }

    const container = document.getElementById('vetting-arena-content');
    const session = JSON.parse(localStorage.getItem('vettingSession') || '{"active":false, "testId":null, "trainees":{}}');
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const vettingTests = tests.filter(t => t.type === 'vetting');
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');

    let controlPanel = '';
    
    if (!session.active) {
        // IDLE STATE
        let options = '<option value="">-- Select Vetting Test --</option>';
        if (vettingTests.length > 0) {
            options += vettingTests.map(t => `<option value="${t.id}">${t.title}</option>`).join('');
        } else {
            options += '<option value="" disabled>No Vetting Tests Available (Create in Test Engine)</option>';
        }
        
        let groupOptions = '<option value="all">All Groups</option>';
        Object.keys(rosters).sort().reverse().forEach(gid => {
             const label = (typeof getGroupLabel === 'function') ? getGroupLabel(gid, rosters[gid].length) : gid;
             groupOptions += `<option value="${gid}">${label}</option>`;
        });

        controlPanel = `
            <div class="card" style="text-align:center; padding:20px;">
                <i class="fas fa-dungeon" style="font-size:3rem; color:var(--text-muted); margin-bottom:20px;"></i>
                <h3>Start Vetting Session</h3>
                <p style="color:var(--text-muted); margin-bottom:20px;">Select a test and target group. This will enable the Vetting Arena tab for them.</p>
                <div style="max-width:500px; margin:0 auto; display:flex; flex-direction:column; gap:10px;">
                    <label style="text-align:left; font-weight:bold;">1. Select Vetting Test</label>
                    <select id="vettingTestSelect" style="margin:0;">${options}</select>
                    <label style="text-align:left; font-weight:bold;">2. Select Target Group</label>
                    <select id="vettingGroupSelect" style="margin:0;" ${CURRENT_USER.role === 'special_viewer' ? 'disabled' : ''}>${groupOptions}</select>
                    <button class="btn-primary" style="margin-top:10px;" onclick="startVettingSession()">PUSH TEST</button>
                </div>
            </div>
        `;
    } else {
        // ACTIVE STATE
        const activeTest = tests.find(t => t.id == session.testId);
        const title = activeTest ? activeTest.title : "Unknown Test";
        const targetGroup = session.targetGroup === 'all' || !session.targetGroup ? 'All Groups' : ((typeof getGroupLabel === 'function') ? getGroupLabel(session.targetGroup) : session.targetGroup);
        
        controlPanel = `
            <div class="card" style="border-left:5px solid #2ecc71;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <h3 style="margin:0; color:#2ecc71;">Session Active: ${title}</h3>
                        <p style="margin:5px 0 0 0; color:var(--text-muted);">Target: <strong>${targetGroup}</strong> | Monitoring Trainees...</p>
                    </div>
                    ${CURRENT_USER.role === 'special_viewer' ? '' : `<button class="btn-danger" onclick="endVettingSession()">END SESSION</button>`}
                </div>
            </div>
            
            <div class="card">
                <h3>Live Monitor</h3>
                <div style="display:flex; justify-content:flex-end; margin-bottom:10px;">
                    <button class="btn-secondary btn-sm" onclick="loadVettingArena()"><i class="fas fa-sync"></i> Refresh</button>
                </div>
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>Trainee</th>
                            <th>Status</th>
                            <th>Time Rem.</th>
                            <th>Screens</th>
                            <th>Apps</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${renderTraineeRows(session.trainees)}
                    </tbody>
                </table>
            </div>
        `;
    }

    container.innerHTML = controlPanel;

    // Prefer Realtime to get instant trainee updates (free-tier friendly: no constant reads).
    // Keep the existing 5s UI refresh as a fallback/monitor tick.
    if (typeof subscribeToDocKey === 'function') {
        ADMIN_VETTING_REALTIME_UNSUB = subscribeToDocKey('vettingSession', (content) => {
            localStorage.setItem('vettingSession', JSON.stringify(content || { active: false, trainees: {} }));
            // Re-render quickly to reflect changes (only if this view is visible)
            const c = document.getElementById('vetting-arena-content');
            if (c && c.offsetParent !== null) renderAdminArena();
        });
    }

    // Auto-Refresh Monitor every 5 seconds if active
    if (session.active) {
        ADMIN_MONITOR_INTERVAL = setTimeout(loadVettingArena, 5000);
    }
}

function renderTraineeRows(trainees) {
    if (!trainees || Object.keys(trainees).length === 0) return '<tr><td colspan="6" class="text-center">No trainees active yet.</td></tr>';
    
    return Object.entries(trainees).map(([user, data]) => {
        let statusBadge = '<span class="status-badge status-improve">Waiting</span>';
        if (data.status === 'started') statusBadge = '<span class="status-badge status-semi">In Progress</span>';
        if (data.status === 'completed') statusBadge = '<span class="status-badge status-pass">Completed</span>';
        if (data.status === 'blocked') {
            statusBadge = data.override 
                ? '<span class="status-badge status-improve">Override Sent</span>' 
                : '<span class="status-badge status-fail">Blocked</span>';
        }
        if (data.status === 'ready') statusBadge = '<span class="status-badge status-pass">Ready</span>';
        
        let securityAlert = '';
        if (data.security) {
            if (data.security.screens > 1) securityAlert += ` <i class="fas fa-desktop" style="color:#ff5252; margin-right:5px;" title="Multiple Screens Detected"></i>`;
            
            // Check for forbidden apps (Browsers/WhatsApp)
            const badApps = data.security.apps || [];
            if (badApps.length > 0) securityAlert += ` <i class="fas fa-exclamation-triangle" style="color:#ff5252;" title="Forbidden Apps Detected"></i>`;
        }

        let actions = '-';
        if (data.status === 'started') {
            if (CURRENT_USER.role === 'special_viewer') actions = 'In Progress';
            else
            actions = `<button class="btn-danger btn-sm" onclick="forceSubmitTrainee('${user}')">Force Stop</button>`;
        } else if (data.status === 'blocked') {
            if (data.override) {
                actions = `<span style="font-size:0.8rem; color:var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> Waiting for agent...</span>`;
            } else {
                actions = `<button class="btn-warning btn-sm" onclick="overrideSecurity('${user}')">Allow / Override</button>`;
            }
            if (CURRENT_USER.role === 'special_viewer') actions = 'Blocked';
        }

        // NEW: Security Switch (Replaces Lock Button)
        const isRelaxed = data.relaxed === true;
        const isSecurityOn = !isRelaxed;
        const disabledAttr = CURRENT_USER.role === 'special_viewer' ? 'disabled' : '';
        
        const switchHtml = `
            <div style="display:flex; align-items:center; gap:8px; margin-top:5px;" title="Toggle Security Rules">
                <label class="switch" style="margin-bottom:0;">
                    <input type="checkbox" ${isSecurityOn ? 'checked' : ''} ${disabledAttr} onchange="toggleSecurity('${user}', !this.checked)">
                    <span class="slider round"></span>
                </label>
                <span style="font-size:0.75rem; color:${isSecurityOn ? '#2ecc71' : '#e67e22'}; font-weight:bold;">
                    ${isSecurityOn ? 'SECURE' : 'OFF'}
                </span>
            </div>
        `;

        if (actions === '-') actions = switchHtml;
        else actions = `<div style="display:flex; flex-direction:column; gap:5px;">${actions}<div>${switchHtml}</div></div>`;

        return `
            <tr>
                <td><strong>${user}</strong></td>
                <td>${statusBadge}</td>
                <td style="font-family:monospace; font-weight:bold;">${data.timer || '--:--'}</td>
                <td>${data.security ? data.security.screens : '-'} ${securityAlert}</td>
                <td><small style="color:#e74c3c;">${data.security && data.security.apps.length > 0 ? data.security.apps.join(', ') : ''}</small></td>
                <td>
                    ${actions}
                </td>
            </tr>
        `;
    }).join('');
}

async function startVettingSession() {
    if (CURRENT_USER.role === 'special_viewer') {
        alert("View Only Mode.");
        return;
    }
    const testId = document.getElementById('vettingTestSelect').value;
    const groupId = document.getElementById('vettingGroupSelect').value;
    if (!testId) return alert("Select a test.");
    
    const session = {
        active: true,
        testId: testId,
        targetGroup: groupId,
        startTime: Date.now(),
        trainees: {}
    };
    
    localStorage.setItem('vettingSession', JSON.stringify(session));
    if(typeof saveToServer === 'function') await saveToServer(['vettingSession'], true); // Force push
    
    loadVettingArena();
    alert("Session Started. Trainees can now access the Vetting Arena.");
}

async function endVettingSession() {
    if(!confirm("End the session? This will close the arena for all trainees.")) return;
    
    const session = JSON.parse(localStorage.getItem('vettingSession'));
    session.active = false;
    
    localStorage.setItem('vettingSession', JSON.stringify(session));
    if(typeof saveToServer === 'function') await saveToServer(['vettingSession'], true);
    
    if (ADMIN_MONITOR_INTERVAL) clearTimeout(ADMIN_MONITOR_INTERVAL);
    loadVettingArena();
}

async function toggleSecurity(username, enable) {
    const session = JSON.parse(localStorage.getItem('vettingSession'));
    if (!session.trainees[username]) session.trainees[username] = {};
    session.trainees[username].relaxed = enable;
    localStorage.setItem('vettingSession', JSON.stringify(session));
    if(typeof saveToServer === 'function') await saveToServer(['vettingSession'], false);
    loadVettingArena();
}

// --- TRAINEE CONTROLS ---

let SECURITY_MONITOR_INTERVAL = null; // Runs DURING test

function renderTraineeArena() {
    // Clear previous pollers to prevent dupes
    stopTraineePollers();

    const container = document.getElementById('vetting-arena-content');
    // Initial load from local cache, then poller takes over
    const session = JSON.parse(localStorage.getItem('vettingSession') || '{"active":false}'); 
    
    if (!session.active) {
        container.innerHTML = `
            <div style="text-align:center; padding:50px;">
                <i class="fas fa-door-closed" style="font-size:4rem; color:var(--text-muted); margin-bottom:20px;"></i>
                <h3>Arena Closed</h3>
                <p style="color:var(--text-muted);">There is no active vetting session at this moment.</p>
            </div>`;
            
        // Start Polling for Session Start (5s)
        TRAINEE_NET_POLLER = setInterval(pollVettingSession, 5000);
        return;
    }

    // CHECK GROUP MEMBERSHIP
    if (session.targetGroup && session.targetGroup !== 'all') {
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        const members = rosters[session.targetGroup] || [];
        if (!members.includes(CURRENT_USER.user)) {
             container.innerHTML = `
                <div style="text-align:center; padding:50px;">
                    <i class="fas fa-user-lock" style="font-size:4rem; color:var(--text-muted); margin-bottom:20px;"></i>
                    <h3>Not Assigned</h3>
                    <p style="color:var(--text-muted);">This vetting session is for a specific group you are not part of.</p>
                </div>`;
            return;
        }
    }

    // Check my status
    const myData = session.trainees[CURRENT_USER.user];
    
    if (myData && myData.status === 'completed') {
        container.innerHTML = `
            <div style="text-align:center; padding:50px;">
                <i class="fas fa-check-circle" style="font-size:4rem; color:#2ecc71; margin-bottom:20px;"></i>
                <h3>Submitted Vetting</h3>
                <p>Please wait for the next test to be pushed.</p>
            </div>`;
        return;
    }

    if (myData && myData.status === 'started') {
        // RESUME / IN-PROGRESS VIEW
        // We rely on openTestTaker to render the questions, but we wrap it here
        container.innerHTML = `<div id="arenaTestContainer"></div>`;
        // Trigger the test engine in "Arena Mode"
        openTestTaker(session.testId, true); 
        startActiveTestMonitoring();
        return;
    }

    // READY TO START
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const test = tests.find(t => t.id == session.testId);
    
    container.innerHTML = `
        <div class="card" style="text-align:center; padding:50px; max-width:600px; margin:0 auto;">
            <i class="fas fa-shield-alt" style="font-size:4rem; color:var(--primary); margin-bottom:20px;"></i>
            <h2 style="color:var(--primary);">Vetting Assessment Ready</h2>
            <h3 style="margin-bottom:20px;">${test ? test.title : 'Assessment'}</h3>
            
            <div style="background:rgba(255, 82, 82, 0.1); border:1px solid #ff5252; padding:15px; border-radius:8px; text-align:left; margin-bottom:30px;">
                <strong style="color:#ff5252;">SECURITY PROTOCOLS:</strong>
                <ul style="margin:10px 0 0 20px; color:var(--text-main);">
                    <li>Full Screen Mode will be enforced.</li>
                    <li>Screenshots and Recording are disabled.</li>
                    <li>Only 1 Monitor is allowed.</li>
                    <li>Background applications are monitored.</li>
                    <li>Your teams camera must stay on at all times during vetting test.</li>
                </ul>
            </div>

            <div style="position:relative;">
                <div id="securityCheckLog" class="security-log-box">
                    <div><i class="fas fa-spinner fa-spin"></i> Checking System Requirements...</div>
                </div>
                <button class="btn-secondary btn-sm" style="position:absolute; top:5px; right:5px;" onclick="checkSystemCompliance()" title="Force Re-check"><i class="fas fa-sync"></i></button>
            </div>

            <button id="btnEnterArena" class="btn-primary btn-lg" disabled onclick="enterArena('${session.testId}')" style="margin-top:15px; opacity:0.5; cursor:not-allowed;">ENTER ARENA & START</button>
        </div>
    `;

    // Start Pre-Flight Checks
    startTraineePreFlight();
}

function stopTraineePollers() {
    if (TRAINEE_NET_POLLER) clearInterval(TRAINEE_NET_POLLER);
    if (TRAINEE_LOCAL_POLLER) clearInterval(TRAINEE_LOCAL_POLLER);
    if (VETTING_REALTIME_UNSUB) { try { VETTING_REALTIME_UNSUB(); } catch (e) {} VETTING_REALTIME_UNSUB = null; }
}

function startTraineePreFlight() {
    // Prefer Realtime for session updates. Fallback to polling if unavailable.
    let usingRealtime = false;
    if (typeof subscribeToDocKey === 'function') {
        VETTING_REALTIME_UNSUB = subscribeToDocKey('vettingSession', (content) => {
            const serverSession = content || { active: false };
            const localSession = JSON.parse(localStorage.getItem('vettingSession') || '{}');

            // Merge only the global session flags + override flag (same logic as poller)
            localSession.active = serverSession.active;
            localSession.testId = serverSession.testId;
            localSession.targetGroup = serverSession.targetGroup;

            if (serverSession.trainees && serverSession.trainees[CURRENT_USER.user]) {
                if (!localSession.trainees) localSession.trainees = {};
                if (!localSession.trainees[CURRENT_USER.user]) localSession.trainees[CURRENT_USER.user] = {};
                localSession.trainees[CURRENT_USER.user].override = serverSession.trainees[CURRENT_USER.user].override;
                localSession.trainees[CURRENT_USER.user].relaxed = serverSession.trainees[CURRENT_USER.user].relaxed;
            }

            const newStr = JSON.stringify(localSession);
            const currentLocal = localStorage.getItem('vettingSession');
            if (currentLocal !== newStr) {
                localStorage.setItem('vettingSession', newStr);

                // If session ended while taking test, force submit/exit
                if (!serverSession.active && document.getElementById('arenaTestContainer')) {
                    if (typeof submitTest === 'function') submitTest(true);
                    return;
                }

                if (!document.getElementById('arenaTestContainer')) {
                    renderTraineeArena();
                }
                if (typeof applyRolePermissions === 'function') applyRolePermissions();
            }
        });
        usingRealtime = !!VETTING_REALTIME_UNSUB;
    }

    // Fallback network poll (5s)
    if (!usingRealtime) {
        TRAINEE_NET_POLLER = setInterval(pollVettingSession, 5000);
    }

    // 2. Local Security Poll (2s) - Check Screens/Apps
    // This prevents the "Stuck" issue by constantly re-evaluating
    LAST_REPORTED_STATUS = null; // Reset so we report presence immediately
    TRAINEE_LOCAL_POLLER = setInterval(checkSystemCompliance, 2000);
    checkSystemCompliance(); // Run immediately
}

// Lightweight Poller for Session State
async function pollVettingSession() {
    if (!window.supabaseClient) return;
    
    // Fetch ONLY the vettingSession row to save bandwidth
    const { data, error } = await supabaseClient
        .from('app_documents')
        .select('content')
        .eq('key', 'vettingSession')
        .single();
        
    if (data && data.content) {
        const serverSession = data.content;
        const localSession = JSON.parse(localStorage.getItem('vettingSession') || '{}');
        
        // Merge Server State (Global) into Local
        localSession.active = serverSession.active;
        localSession.testId = serverSession.testId;
        localSession.targetGroup = serverSession.targetGroup;
        
        // Sync Override flag specifically for current user
        if (serverSession.trainees && serverSession.trainees[CURRENT_USER.user]) {
            if (!localSession.trainees) localSession.trainees = {};
            if (!localSession.trainees[CURRENT_USER.user]) localSession.trainees[CURRENT_USER.user] = {};
            
            // Adopt override if present on server
            localSession.trainees[CURRENT_USER.user].override = serverSession.trainees[CURRENT_USER.user].override;
            localSession.trainees[CURRENT_USER.user].relaxed = serverSession.trainees[CURRENT_USER.user].relaxed;
        }

        const newStr = JSON.stringify(localSession);
        const currentLocal = localStorage.getItem('vettingSession');
        
        // Only re-render if state changed
        if (currentLocal !== newStr) {
            localStorage.setItem('vettingSession', newStr);
            
            // FIX: If session ended while taking test, force submit/exit
            if (!serverSession.active && document.getElementById('arenaTestContainer')) {
                if (typeof submitTest === 'function') await submitTest(true); // Force submit
                return;
            }

            // If we are NOT currently taking the test, refresh the view
            if (!document.getElementById('arenaTestContainer')) {
                renderTraineeArena();
            }
            // FIX: Update sidebar visibility immediately when session state changes
            if (typeof applyRolePermissions === 'function') applyRolePermissions();
        }
    }
}

let LAST_REPORTED_STATUS = null;

async function checkSystemCompliance() {
    const logBox = document.getElementById('securityCheckLog');
    const btn = document.getElementById('btnEnterArena');
    if (!logBox || !btn) return;

    // 1. Check Override
    const session = JSON.parse(localStorage.getItem('vettingSession') || '{}');
    const myData = session.trainees ? session.trainees[CURRENT_USER.user] : null;
    const isOverridden = myData && myData.override;
    const isRelaxed = myData && myData.relaxed;

    let errors = [];
    
    if (!isRelaxed && typeof require !== 'undefined') {
        const { ipcRenderer } = require('electron');
        
        // Check Screens
        const screenCount = await ipcRenderer.invoke('get-screen-count');
        if (screenCount > 1) errors.push(`Multiple Monitors Detected (${screenCount}). Unplug external screens.`);
        
        // Check Apps
        // Load dynamic list or default
        let forbidden = JSON.parse(localStorage.getItem('forbiddenApps') || '[]');
        if (forbidden.length === 0 && typeof DEFAULT_FORBIDDEN_APPS !== 'undefined') {
            forbidden = DEFAULT_FORBIDDEN_APPS;
        }

        const apps = await ipcRenderer.invoke('get-process-list', forbidden);
        if (apps.length > 0) errors.push(`Forbidden Apps Running: ${apps.join(', ')}`);
    }

    // Determine Status
    let currentStatus = 'ready';
    if (errors.length > 0 && !isOverridden && !isRelaxed) {
        currentStatus = 'blocked';
    }

    // Update UI
    if (errors.length === 0) {
        if (isRelaxed) {
            logBox.innerHTML = `<div class="sec-pass" style="color:#e67e22;"><i class="fas fa-unlock"></i> <strong>Security Relaxed.</strong> Strict rules disabled by Admin.</div>`;
        } else {
            logBox.innerHTML = `<div class="sec-pass"><i class="fas fa-check"></i> System Secure. Ready to start.</div>`;
        }
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
    } else if (isOverridden) {
        logBox.innerHTML = `<div class="sec-warn"><i class="fas fa-exclamation-triangle"></i> <strong>Admin Override Active.</strong> Security checks bypassed.</div>` + 
                           errors.map(e => `<div class="sec-fail" style="opacity:0.7;"><i class="fas fa-times"></i> ${e} (Ignored)</div>`).join('');
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
    } else {
        logBox.innerHTML = errors.map(e => `<div class="sec-fail"><i class="fas fa-times"></i> ${e}</div>`).join('');
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
    }

    // Report to Server if Status Changed (e.g. Waiting -> Blocked or Waiting -> Ready)
    if (currentStatus !== LAST_REPORTED_STATUS) {
        LAST_REPORTED_STATUS = currentStatus;
        await updateTraineeStatus(currentStatus);
    }
}

function toggleSidebar(show) {
    const sidebar = document.querySelector('.sidebar');
    const content = document.querySelector('.content-wrapper');
    if (sidebar) sidebar.style.display = show ? '' : 'none';
    if (content) {
        content.style.marginLeft = show ? '' : '0';
        content.style.width = show ? '' : '100%';
    }
}

async function enterArena(testId) {
    // Stop pre-flight polling
    stopTraineePollers();

    // 1. Enforce Security
    const session = JSON.parse(localStorage.getItem('vettingSession') || '{}');
    const myData = session.trainees ? session.trainees[CURRENT_USER.user] : null;
    const isRelaxed = myData && myData.relaxed;

    if (!isRelaxed && typeof require !== 'undefined') {
        const { ipcRenderer } = require('electron');
        await ipcRenderer.invoke('set-kiosk-mode', true);
        await ipcRenderer.invoke('set-content-protection', true);
    }

    // Hide Sidebar for Full Screen Focus
    toggleSidebar(false);

    // 2. Update Status
    await updateTraineeStatus('started');

    // 3. Load UI
    renderTraineeArena();
}

async function updateTraineeStatus(status, timerStr = "") {
    // We avoid full-schema loadFromServer(true) here to reduce reads.
    // saveToServer(['vettingSession'], false) already performs a merge and our merge logic
    // deep-merges trainees, so we won't wipe other trainees/admin changes.
    const session = JSON.parse(localStorage.getItem('vettingSession') || '{"active":false,"trainees":{}}');
    
    // CHECK: Session Ended?
    if (!session.active && status === 'started') {
        if (typeof submitTest === 'function') await submitTest();
        return;
    }
    
    if (!session.trainees) session.trainees = {};
    if (!session.trainees[CURRENT_USER.user]) session.trainees[CURRENT_USER.user] = {};
    
    // Check if security is relaxed for this user
    const isRelaxed = session.trainees[CURRENT_USER.user].relaxed === true;

    session.trainees[CURRENT_USER.user].status = status;
    if (timerStr) session.trainees[CURRENT_USER.user].timer = timerStr;
    
    // Add Security Snapshot
    if (typeof require !== 'undefined') {
        const { ipcRenderer } = require('electron');
        const screens = await ipcRenderer.invoke('get-screen-count');
        
        // Use dynamic forbidden list (same as checkSystemCompliance)
        let forbidden = JSON.parse(localStorage.getItem('forbiddenApps') || '[]');
        if (forbidden.length === 0 && typeof DEFAULT_FORBIDDEN_APPS !== 'undefined') {
            forbidden = DEFAULT_FORBIDDEN_APPS;
        }
        const apps = await ipcRenderer.invoke('get-process-list', forbidden);
        
        session.trainees[CURRENT_USER.user].security = {
            screens: screens,
            apps: apps
        };

        // CHECK: Forbidden Apps during test?
        if (!isRelaxed && apps.length > 0 && status === 'started') {
            alert("Security Violation: Forbidden apps detected (" + apps.join(', ') + "). Test ending.");
            if (typeof submitTest === 'function') await submitTest();
            return; // Stop here, submitTest will handle the rest
        }
    }

    localStorage.setItem('vettingSession', JSON.stringify(session));
    if(typeof saveToServer === 'function') await saveToServer(['vettingSession'], false);
}

function startActiveTestMonitoring() {
    if (SECURITY_MONITOR_INTERVAL) clearInterval(SECURITY_MONITOR_INTERVAL);
    
    // Update status every 30 seconds
    SECURITY_MONITOR_INTERVAL = setInterval(() => {
        const timerEl = document.getElementById('test-timer-bar');
        const timeStr = timerEl ? timerEl.innerText.replace('TIME: ', '') : '';
        updateTraineeStatus('started', timeStr);
    }, 30000);

    // FAST SECURITY POLL (3s) - Detect violations quickly
    // We don't send full status to server every 3s to save bandwidth, 
    // but we check locally and trigger updateTraineeStatus ONLY if violation found.
    setInterval(async () => {
        const session = JSON.parse(localStorage.getItem('vettingSession') || '{}');
        const myData = session.trainees ? session.trainees[CURRENT_USER.user] : null;
        const isRelaxed = myData && myData.relaxed;

        if (isRelaxed) {
            // Ensure Kiosk is OFF if rules are relaxed mid-test
            if (typeof require !== 'undefined') {
                const { ipcRenderer } = require('electron');
                ipcRenderer.invoke('set-kiosk-mode', false).catch(()=>{});
                ipcRenderer.invoke('set-content-protection', false).catch(()=>{});
            }
            return; // Skip checks
        }

        if (typeof require !== 'undefined') {
            const { ipcRenderer } = require('electron');
            
            let forbidden = JSON.parse(localStorage.getItem('forbiddenApps') || '[]');
            if (forbidden.length === 0 && typeof DEFAULT_FORBIDDEN_APPS !== 'undefined') {
                forbidden = DEFAULT_FORBIDDEN_APPS;
            }

            const apps = await ipcRenderer.invoke('get-process-list', forbidden);
            const screens = await ipcRenderer.invoke('get-screen-count');
            if (apps.length > 0 || screens > 1) updateTraineeStatus('started'); // Trigger the kick logic
        }
    }, 3000);
}

// Called by assessment.js when submitting
async function exitArena() {
    stopTraineePollers();
    if (SECURITY_MONITOR_INTERVAL) clearInterval(SECURITY_MONITOR_INTERVAL);
    
    if (typeof require !== 'undefined') {
        const { ipcRenderer } = require('electron');
        try {
            await ipcRenderer.invoke('set-kiosk-mode', false);
            await ipcRenderer.invoke('set-content-protection', false);
        } catch(e) { console.error("Exit Kiosk Error", e); }
    }
    
    // Restore Sidebar
    toggleSidebar(true);

    await updateTraineeStatus('completed');
    renderTraineeArena();
}

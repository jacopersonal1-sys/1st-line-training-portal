/* ================= VETTING TEST ARENA ================= */
/* Handles high-security testing environment */

// --- ADMIN CONTROLS ---

let ADMIN_MONITOR_INTERVAL = null;

function loadVettingArena() {
    if (CURRENT_USER.role === 'admin') {
        renderAdminArena();
    } else {
        renderTraineeArena();
    }
}

function renderAdminArena() {
    if (ADMIN_MONITOR_INTERVAL) clearTimeout(ADMIN_MONITOR_INTERVAL);

    const container = document.getElementById('vetting-arena-content');
    const session = JSON.parse(localStorage.getItem('vettingSession') || '{"active":false, "testId":null, "trainees":{}}');
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const vettingTests = tests.filter(t => t.type === 'vetting');
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');

    let controlPanel = '';
    
    if (!session.active) {
        // IDLE STATE
        const options = vettingTests.map(t => `<option value="${t.id}">${t.title}</option>`).join('');
        
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
                    <label style="text-align:left; font-weight:bold;">1. Select Assessment</label>
                    <select id="vettingTestSelect" style="margin:0;">${options}</select>
                    <label style="text-align:left; font-weight:bold;">2. Select Target Group</label>
                    <select id="vettingGroupSelect" style="margin:0;">${groupOptions}</select>
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
                    <button class="btn-danger" onclick="endVettingSession()">END SESSION</button>
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
        
        let securityAlert = '';
        if (data.security) {
            if (data.security.screens > 1) securityAlert += ` <i class="fas fa-desktop" style="color:#ff5252; margin-right:5px;" title="Multiple Screens Detected"></i>`;
            
            // Check for forbidden apps (Browsers/WhatsApp)
            const badApps = data.security.apps || [];
            if (badApps.length > 0) securityAlert += ` <i class="fas fa-exclamation-triangle" style="color:#ff5252;" title="Forbidden Apps Detected"></i>`;
        }

        return `
            <tr>
                <td><strong>${user}</strong></td>
                <td>${statusBadge}</td>
                <td style="font-family:monospace; font-weight:bold;">${data.timer || '--:--'}</td>
                <td>${data.security ? data.security.screens : '-'} ${securityAlert}</td>
                <td><small style="color:#e74c3c;">${data.security && data.security.apps.length > 0 ? data.security.apps.join(', ') : ''}</small></td>
                <td>
                    ${data.status === 'started' ? `<button class="btn-danger btn-sm" onclick="forceSubmitTrainee('${user}')">Force Stop</button>` : '-'}
                </td>
            </tr>
        `;
    }).join('');
}

async function startVettingSession() {
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

// --- TRAINEE CONTROLS ---

let SECURITY_INTERVAL = null;

function renderTraineeArena() {
    const container = document.getElementById('vetting-arena-content');
    const session = JSON.parse(localStorage.getItem('vettingSession') || '{"active":false}');
    
    if (!session.active) {
        container.innerHTML = `
            <div style="text-align:center; padding:50px;">
                <i class="fas fa-door-closed" style="font-size:4rem; color:var(--text-muted); margin-bottom:20px;"></i>
                <h3>Arena Closed</h3>
                <p style="color:var(--text-muted);">There is no active vetting session at this moment.</p>
            </div>`;
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
                <h3>Test Completed</h3>
                <p>You have submitted your assessment. You may leave the arena.</p>
            </div>`;
        return;
    }

    if (myData && myData.status === 'started') {
        // RESUME / IN-PROGRESS VIEW
        // We rely on openTestTaker to render the questions, but we wrap it here
        container.innerHTML = `<div id="arenaTestContainer"></div>`;
        // Trigger the test engine in "Arena Mode"
        openTestTaker(session.testId, true); 
        startSecurityMonitoring();
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
                </ul>
            </div>

            <button class="btn-primary btn-lg" onclick="enterArena('${session.testId}')">ENTER ARENA & START</button>
        </div>
    `;
}

async function enterArena(testId) {
    // 1. Enforce Security
    if (typeof require !== 'undefined') {
        const { ipcRenderer } = require('electron');
        
        // Check Screens
        const screenCount = await ipcRenderer.invoke('get-screen-count');
        if (screenCount > 1) {
            alert(`Security Violation: ${screenCount} monitors detected.\nPlease disconnect external monitors to proceed.`);
            return;
        }

        // Enable Kiosk & Protection
        await ipcRenderer.invoke('set-kiosk-mode', true);
        await ipcRenderer.invoke('set-content-protection', true);
    }

    // 2. Update Status
    await updateTraineeStatus('started');

    // 3. Load UI
    renderTraineeArena();
}

async function updateTraineeStatus(status, timerStr = "") {
    // We need to fetch latest session to avoid overwriting others
    await loadFromServer(true); 
    const session = JSON.parse(localStorage.getItem('vettingSession'));
    
    if (!session.trainees) session.trainees = {};
    if (!session.trainees[CURRENT_USER.user]) session.trainees[CURRENT_USER.user] = {};
    
    session.trainees[CURRENT_USER.user].status = status;
    if (timerStr) session.trainees[CURRENT_USER.user].timer = timerStr;
    
    // Add Security Snapshot
    if (typeof require !== 'undefined') {
        const { ipcRenderer } = require('electron');
        const screens = await ipcRenderer.invoke('get-screen-count');
        const apps = await ipcRenderer.invoke('get-process-list');
        
        session.trainees[CURRENT_USER.user].security = {
            screens: screens,
            apps: apps
        };
    }

    localStorage.setItem('vettingSession', JSON.stringify(session));
    if(typeof saveToServer === 'function') await saveToServer(['vettingSession'], false);
}

function startSecurityMonitoring() {
    if (SECURITY_INTERVAL) clearInterval(SECURITY_INTERVAL);
    
    // Update status every 30 seconds
    SECURITY_INTERVAL = setInterval(() => {
        const timerEl = document.getElementById('test-timer-bar');
        const timeStr = timerEl ? timerEl.innerText.replace('TIME: ', '') : '';
        updateTraineeStatus('started', timeStr);
    }, 30000);
}

// Called by assessment.js when submitting
async function exitArena() {
    if (SECURITY_INTERVAL) clearInterval(SECURITY_INTERVAL);
    
    if (typeof require !== 'undefined') {
        const { ipcRenderer } = require('electron');
        await ipcRenderer.invoke('set-kiosk-mode', false);
        await ipcRenderer.invoke('set-content-protection', false);
    }
    
    await updateTraineeStatus('completed');
    renderTraineeArena();
}

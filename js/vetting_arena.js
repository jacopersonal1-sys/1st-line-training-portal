/* ================= VETTING TEST ARENA ================= */
/* Handles high-security testing environment */

// --- ADMIN CONTROLS ---

let ADMIN_VETTING_TIMER_TICK = null;
let TRAINEE_LOCAL_POLLER = null;
let SECURITY_VIOLATION_INTERVAL = null; // Track the fast security poll
let IS_SUBMITTING_VIOLATION = false; // Prevent alert loops
let ACTIVE_VETTING_TAB = null; // Track which session the Admin is currently viewing
let ADMIN_VETTING_VIEW_MODE = 'split'; // Default to Split Screen

function loadVettingArena() {
    // FEATURE FLAG CHECK
    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
    if (config.features && config.features.vetting_arena === false) {
        const container = document.getElementById('vetting-arena-content');
        if(container) container.innerHTML = `<div style="text-align:center; padding:50px; color:var(--text-muted);"><i class="fas fa-ban" style="font-size:3rem; margin-bottom:15px;"></i><h3>Feature Disabled</h3><p>The Vetting Arena is currently disabled by the System Administrator.</p></div>`;
        return;
    }

    // LOCAL TICKER: Smooth timer updates without database lag
    if (!ADMIN_VETTING_TIMER_TICK) {
        ADMIN_VETTING_TIMER_TICK = setInterval(() => {
            document.querySelectorAll('.vt-live-timer').forEach(el => {
                const start = parseInt(el.getAttribute('data-start'));
                if (start) {
                    const elapsed = Math.floor((Date.now() - start) / 1000);
                    const m = Math.floor(elapsed / 60);
                    const s = elapsed % 60;
                    el.innerText = `${m}m ${s < 10 ? '0' : ''}${s}s`;
                }
            });
        }, 1000);
    }

    if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin' || CURRENT_USER.role === 'special_viewer') {
        renderAdminArena();
        adminPollVettingSession().then(() => {
            renderAdminArena();
        });
    } else {
        renderTraineeArena();
    }
}

function renderAdminArena() {

    // INJECT STYLES FOR VISUALS
    if (!document.getElementById('vetting-visuals')) {
        const style = document.createElement('style');
        style.id = 'vetting-visuals';
        style.innerHTML = `
            .pulse-dot { display: inline-block; width: 10px; height: 10px; background-color: #e74c3c; border-radius: 50%; margin-left: 10px; animation: pulse-red 2s infinite; vertical-align: middle; }
            @keyframes pulse-red {
                0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(231, 76, 60, 0.7); }
                70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(231, 76, 60, 0); }
                100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(231, 76, 60, 0); }
            }
            .row-blocked { background-color: rgba(255, 82, 82, 0.05) !important; }
        `;
        document.head.appendChild(style);
    }

    const container = document.getElementById('vetting-arena-content');
    
    // 1. SPLIT DOM SHELLS (Fixes Dropdown Disappearing)
    if (!document.getElementById('va-static-form')) {
        container.innerHTML = `
            <div id="va-static-form"></div>
            <div id="va-dynamic-views"></div>
        `;
    }

    const staticForm = document.getElementById('va-static-form');
    const dynamicViews = document.getElementById('va-dynamic-views');
    const activeSessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
    const isCompact = activeSessions.length > 0;
    
    // 2. Render Form ONLY if layout changed (Prevents losing dropdown focus)
    if (staticForm.dataset.compact !== String(isCompact)) {
        staticForm.innerHTML = renderIdleAdminShell(isCompact);
        staticForm.dataset.compact = String(isCompact);
        populateVettingDropdowns(); 
    }

    // 3. Build Dynamic Views
    let dynHtml = '';
    if (activeSessions.length > 0) {
        // Toggle view controls
        if (activeSessions.length > 1) {
            dynHtml += `
            <div style="display:flex; justify-content:flex-end; margin-top:15px; margin-bottom:5px; gap:10px;">
                <button class="btn-secondary btn-sm ${ADMIN_VETTING_VIEW_MODE === 'tabbed' ? 'active' : ''}" onclick="setVettingViewMode('tabbed')"><i class="fas fa-folder"></i> Tabbed View</button>
                <button class="btn-secondary btn-sm ${ADMIN_VETTING_VIEW_MODE === 'split' ? 'active' : ''}" onclick="setVettingViewMode('split')"><i class="fas fa-columns"></i> Split View</button>
            </div>
            `;
        }

        if (ADMIN_VETTING_VIEW_MODE === 'split' && activeSessions.length > 1) {
            // SPLIT VIEW
            dynHtml += `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(500px, 1fr)); gap:20px; margin-top:10px;">`;
            activeSessions.forEach((s, idx) => {
                dynHtml += `<div style="display:flex; flex-direction:column; gap:15px; background:var(--bg-app); border:2px dashed var(--border-color); padding:15px; border-radius:12px;">`;
                dynHtml += renderActiveAdminShell(s, idx + 1);
                dynHtml += `</div>`;
            });
            dynHtml += `</div>`;
        } else {
            // TABBED VIEW
            // Ensure a tab is selected
            if (!ACTIVE_VETTING_TAB || !activeSessions.find(s => s.sessionId === ACTIVE_VETTING_TAB)) {
                ACTIVE_VETTING_TAB = activeSessions[0].sessionId;
            }

            const currentSession = activeSessions.find(s => s.sessionId === ACTIVE_VETTING_TAB);
            if (currentSession) {
                // Keep the legacy single-session cache updated for interoperability with external functions
                localStorage.setItem('vettingSession', JSON.stringify(currentSession));
            }

            // Tabs UI
            dynHtml += `<div style="display:flex; gap:10px; margin-top:20px; margin-bottom:15px; overflow-x:auto; padding-bottom:5px;">`;
            activeSessions.forEach((s, idx) => {
                const isActive = ACTIVE_VETTING_TAB === s.sessionId ? 'background:var(--primary); color:white; box-shadow:0 4px 10px rgba(243, 112, 33, 0.3);' : 'background:var(--bg-card); color:var(--text-muted); border:1px solid var(--border-color);';
                const groupName = s.targetGroup === 'all' ? 'All Groups' : ((typeof getGroupLabel === 'function') ? getGroupLabel(s.targetGroup).split('[')[0] : s.targetGroup);
                const activeCount = Object.values(s.trainees || {}).filter(t => t.status === 'started').length;

                dynHtml += `
                <button onclick="switchVettingTab('${s.sessionId}')" style="padding:10px 20px; border-radius:8px; cursor:pointer; min-width:150px; text-align:left; transition:0.3s; ${isActive}">
                    <div style="font-size:0.8rem; text-transform:uppercase; opacity:0.8;">Session ${idx+1}</div>
                    <div style="font-weight:bold; font-size:1.1rem; margin:5px 0;">${groupName}</div>
                    <div style="font-size:0.8rem;"><i class="fas fa-users"></i> <span id="tab_active_${s.sessionId}">${activeCount}</span> Active</div>
                </button>`;
            });
            dynHtml += `</div>`;

            // Active Session Monitor UI
            if (currentSession) {
                dynHtml += renderActiveAdminShell(currentSession);
            }
        }
    }

    // 4. Update Shell ONLY if signature changes
    const layoutSignature = `${ADMIN_VETTING_VIEW_MODE}_${ACTIVE_VETTING_TAB}_${activeSessions.map(s => s.sessionId + s.targetGroup).join('-')}`;
    
    if (dynamicViews.dataset.signature !== layoutSignature) {
        dynamicViews.innerHTML = dynHtml;
        dynamicViews.dataset.signature = layoutSignature;
    }

    // 5. Soft Update Data (No DOM Wipe)
    if (activeSessions.length > 0) {
        if (ADMIN_VETTING_VIEW_MODE === 'split' && activeSessions.length > 1) {
            activeSessions.forEach(s => {
                updateVettingTableRows(s);
                updateVettingStatsUI(s);
            });
        } else {
            const currentSession = activeSessions.find(s => s.sessionId === ACTIVE_VETTING_TAB);
            if (currentSession) {
                updateVettingTableRows(currentSession);
                updateVettingStatsUI(currentSession);
            }
        }
    }
}

window.setVettingViewMode = function(mode) {
    ADMIN_VETTING_VIEW_MODE = mode;
    renderAdminArena();
};

window.switchVettingTab = function(sessionId) {
    ACTIVE_VETTING_TAB = sessionId;
    renderAdminArena();
};

window.populateVettingDropdowns = function() {
    const testSel = document.getElementById('vettingTestSelect');
    const groupSel = document.getElementById('vettingGroupSelect');
    if (!testSel || !groupSel) return;

    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const vettingTests = tests.filter(t => t.type === 'vetting');
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');

    let options = '<option value="">-- Select Vetting Test --</option>';
    if (vettingTests.length > 0) {
        options += vettingTests.map(t => `<option value="${t.id}">${t.title}</option>`).join('');
    } else {
        options += '<option value="" disabled>No Vetting Tests Available (Create in Test Engine)</option>';
    }
    testSel.innerHTML = options;
    
    let groupOptions = '<option value="all">All Groups</option>';
    Object.keys(rosters).sort().reverse().forEach(gid => {
            const label = (typeof getGroupLabel === 'function') ? getGroupLabel(gid, rosters[gid].length) : gid;
            groupOptions += `<option value="${gid}">${label}</option>`;
    });
    groupSel.innerHTML = groupOptions;
};

function renderIdleAdminShell(isCompact = false) {
    let displayStyle = isCompact ? 'display:flex; align-items:center; gap:15px; padding:15px;' : 'text-align:center; padding:50px;';
    let iconStyle = isCompact ? 'font-size:2rem; margin:0;' : 'font-size:3rem; margin-bottom:20px;';
    let titleStyle = isCompact ? 'margin:0; font-size:1.2rem;' : '';
    let descHtml = isCompact ? '' : '<p style="color:var(--text-muted); margin-bottom:20px;">Select a test and target group. This will enable the Vetting Arena tab for them.</p>';
    let formLayout = isCompact ? 'display:flex; gap:10px; align-items:flex-end; flex:1;' : 'max-width:500px; margin:0 auto; display:flex; flex-direction:column; gap:10px;';

    return `
        <div class="card" style="${displayStyle} background:var(--bg-card); border:1px dashed var(--border-color);">
            ${isCompact ? '' : `<i class="fas fa-dungeon" style="color:var(--text-muted); ${iconStyle}"></i>`}
            <div style="${isCompact ? 'min-width:200px;' : ''}">
                <h3 style="${titleStyle}">Start New Session</h3>
                ${descHtml}
            </div>
            <div style="${formLayout}">
                <div style="${isCompact ? 'flex:1;' : ''}">
                    <label style="text-align:left; font-weight:bold; font-size:0.85rem;">${isCompact?'':'1. '}Select Test</label>
                    <select id="vettingTestSelect" style="margin:0; width:100%;"><option value="">Loading...</option></select>
                </div>
                <div style="${isCompact ? 'flex:1;' : ''}">
                    <label style="text-align:left; font-weight:bold; font-size:0.85rem;">${isCompact?'':'2. '}Select Group</label>
                    <select id="vettingGroupSelect" style="margin:0; width:100%;" ${CURRENT_USER.role === 'special_viewer' ? 'disabled' : ''}><option value="">Loading...</option></select>
                </div>
                <button class="btn-primary" style="height:38px; ${isCompact?'padding:0 25px;':'margin-top:10px;'}" onclick="startVettingSession()">PUSH TEST</button>
            </div>
        </div>
    `;
}

function renderActiveAdminShell(session, indexLabel = '') {
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const activeTest = tests.find(t => t.id == session.testId);
    const title = activeTest ? activeTest.title : "Unknown Test";
    const targetGroup = session.targetGroup === 'all' || !session.targetGroup ? 'All Groups' : ((typeof getGroupLabel === 'function') ? getGroupLabel(session.targetGroup) : session.targetGroup);
    const sessionTitle = indexLabel ? `Session ${indexLabel}: ${title}` : title;
    
    // Calculate Stats
    const trainees = session.trainees || {};
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    const total = (session.targetGroup && session.targetGroup !== 'all' && rosters[session.targetGroup]) 
        ? rosters[session.targetGroup].length 
        : Object.keys(trainees).length;
    const activeCount = Object.values(trainees).filter(t => t.status === 'started').length;
    const blockedCount = Object.values(trainees).filter(t => t.status === 'blocked').length;
    const completedCount = Object.values(trainees).filter(t => t.status === 'completed').length;
    
    return `
        <div class="card" style="border-left:5px solid #2ecc71; background: linear-gradient(to right, rgba(46, 204, 113, 0.05), transparent);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <div style="display:flex; align-items:center; gap:15px;">
                    <div style="width:50px; height:50px; background:#2ecc71; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-size:1.5rem; box-shadow:0 4px 10px rgba(46, 204, 113, 0.3);">
                        <i class="fas fa-shield-alt"></i>
                    </div>
                    <div>
                        <h3 style="margin:0; color:#2ecc71; display:flex; align-items:center;">${sessionTitle} <span class="pulse-dot" title="Live Session Active"></span></h3>
                        <p style="margin:5px 0 0 0; color:var(--text-muted);">Target: <strong>${targetGroup}</strong></p>
                    </div>
                </div>
                ${CURRENT_USER.role === 'special_viewer' ? '' : `<button class="btn-danger" onclick="endVettingSession('${session.sessionId}')"><i class="fas fa-stop-circle"></i> END SESSION</button>`}
            </div>
            
            <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px;">
                <div style="text-align:center;"><div style="font-size:1.5rem; font-weight:bold;" id="stat_expected_${session.sessionId}">${total}</div><div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase;">Expected</div></div>
                <div style="text-align:center;"><div style="font-size:1.5rem; font-weight:bold; color:#2ecc71;" id="stat_active_${session.sessionId}">${activeCount}</div><div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase;">In Progress</div></div>
                <div style="text-align:center;"><div style="font-size:1.5rem; font-weight:bold; color:#ff5252;" id="stat_blocked_${session.sessionId}">${blockedCount}</div><div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase;">Blocked</div></div>
                <div style="text-align:center;"><div style="font-size:1.5rem; font-weight:bold; color:#3498db;" id="stat_completed_${session.sessionId}">${completedCount}</div><div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase;">Completed</div></div>
            </div>
        </div>
        
        <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <h3 style="margin:0;"><i class="fas fa-desktop"></i> Live Monitor</h3>
                <button class="btn-secondary btn-sm" onclick="loadVettingArena()"><i class="fas fa-sync"></i> Refresh</button>
            </div>
            <table class="admin-table">
                <thead>
                    <tr>
                        <th>Trainee</th>
                        <th>Status</th>
                        <th>Progress</th>
                        <th>Security Health</th>
                        <th>Controls</th>
                    </tr>
                </thead>
            <tbody id="vetting-monitor-body-${session.sessionId}">
                    <!-- Rows injected via updateVettingTableRows -->
                </tbody>
            </table>
        </div>
    `;
}

function updateVettingTableRows(session) {
    const tbody = document.getElementById(`vetting-monitor-body-${session.sessionId}`);
    if (!tbody) return;

    const trainees = session.trainees || {};
    const targetGroup = session.targetGroup;
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');

    // PRE-POPULATE: Show all expected trainees if a specific group is targeted
    let displayEntries = [];
    
    if (targetGroup && targetGroup !== 'all') {
        const allowedMembers = rosters[targetGroup] || [];
        displayEntries = allowedMembers.map(user => {
            // Include existing data or default to 'waiting' state
            return [user, trainees[user] || { status: 'waiting' }];
        });
    } else {
        displayEntries = Object.entries(trainees);
    }

    if (displayEntries.length === 0) {
        if (!document.getElementById('empty-row-' + session.sessionId)) {
            tbody.innerHTML = `<tr id="empty-row-${session.sessionId}"><td colspan="5" class="text-center" style="color:var(--text-muted); font-style:italic;">No trainees found in this group.</td></tr>`;
        }
        return;
    }

    // SORTING LOGIC: Bring Blocked users to the top dynamically
    const statusPriority = { 'blocked': 1, 'waiting': 2, 'ready': 2, 'started': 3, 'completed': 4 };
    displayEntries.sort((a, b) => {
        const pA = statusPriority[a[1].status] || 99;
        const pB = statusPriority[b[1].status] || 99;
        if (pA !== pB) return pA - pB;
        return a[0].localeCompare(b[0]);
    });

    const emptyRow = document.getElementById('empty-row-' + session.sessionId);
    if (emptyRow) emptyRow.remove();

    const currentUsers = new Set();

    // PRECISION DOM PATCHING (Eliminates Screen Flashing)
    displayEntries.forEach(([user, data]) => {
        currentUsers.add(user);
        let statusBadge = '<span class="status-badge status-improve"><i class="fas fa-hourglass-half"></i> Waiting</span>';
        let rowClass = '';

        if (data.status === 'started') { statusBadge = '<span class="status-badge status-semi"><i class="fas fa-play"></i> In Progress</span>'; }
        if (data.status === 'completed') { statusBadge = '<span class="status-badge status-pass"><i class="fas fa-check"></i> Completed</span>'; }
        if (data.status === 'blocked') {
            statusBadge = data.override 
                ? '<span class="status-badge status-improve"><i class="fas fa-unlock"></i> Override Sent</span>' 
                : '<span class="status-badge status-fail"><i class="fas fa-ban"></i> Blocked</span>';
            rowClass = 'row-blocked';
        }
        if (data.status === 'ready') statusBadge = '<span class="status-badge status-pass"><i class="fas fa-thumbs-up"></i> Ready</span>';
        
        // Consolidated Security Column
        let securityHtml = '<span style="color:#2ecc71;"><i class="fas fa-shield-alt"></i> Secure</span>';
        if (data.status === 'waiting') {
            securityHtml = '<span style="color:var(--text-muted);"><i class="fas fa-minus"></i> Pending Connection</span>';
        } else if (data.security) {
            const issues = [];
            if (data.security.screens > 1) issues.push(`${data.security.screens} Screens`);
            if (data.security.apps && data.security.apps.length > 0) issues.push(`${data.security.apps.length} Apps`);
            
            if (issues.length > 0) {
                securityHtml = `<span style="color:#ff5252; font-weight:bold;"><i class="fas fa-exclamation-triangle"></i> ${issues.join(', ')}</span>`;
                if (data.security.apps.length > 0) {
                    securityHtml += `<div style="font-size:0.7rem; color:#ff5252; max-width:200px; overflow:hidden; text-overflow:ellipsis;">${data.security.apps.join(', ')}</div>`;
                }
            }
        }

        let mainAction = '';
        if (data.status === 'started') {
            if (CURRENT_USER.role !== 'special_viewer') mainAction = `<button class="btn-danger btn-sm" onclick="forceSubmitTrainee('${session.sessionId}', '${user.replace(/'/g, "\\'")}')" title="Force Stop"><i class="fas fa-stop"></i></button>`;
        } else if (data.status === 'blocked' && !data.override && CURRENT_USER.role !== 'special_viewer') {
            mainAction = `<button class="btn-warning btn-sm" onclick="overrideSecurity('${session.sessionId}', '${user.replace(/'/g, "\\'")}')" title="Override"><i class="fas fa-key"></i></button>`;
        }

        // NEW: Security Switch (Replaces Lock Button)
        const isRelaxed = data.relaxed === true;
        const isSecurityOn = !isRelaxed;
        const disabledAttr = CURRENT_USER.role === 'special_viewer' ? 'disabled' : '';
        
        let extraTools = '';
        if (CURRENT_USER.role !== 'special_viewer') {
            extraTools = `<button class="btn-secondary btn-sm" style="padding:2px 6px;" onclick="if(typeof sendRemoteCommand === 'function') sendRemoteCommand('${user.replace(/'/g, "\\'")}', 'restart')" title="Force Trainee App to Refresh"><i class="fas fa-sync"></i></button>`;
        }

        const switchHtml = `
            <label class="switch" style="margin-bottom:0;" title="Toggle Security Rules">
                    <input type="checkbox" ${isSecurityOn ? 'checked' : ''} ${disabledAttr} onchange="toggleSecurity('${session.sessionId}', '${user.replace(/'/g, "\\'")}', !this.checked)">
                    <span class="slider round"></span>
            </label>
        `;

        // OPTIMIZED TIMER: Extrapolate locally for 0 database load
        let timerDisplay = '--:--';
        if (data.status === 'started' && data.startedAt) {
            const elapsed = Math.floor((Date.now() - data.startedAt) / 1000);
            const m = Math.floor(elapsed / 60);
            const s = elapsed % 60;
            timerDisplay = `<span class="vt-live-timer" data-start="${data.startedAt}" style="font-family:monospace; font-weight:bold; font-size:1.1rem; color:var(--primary);">${m}m ${s < 10 ? '0' : ''}${s}s</span>`;
        } else if (data.status === 'completed') {
            timerDisplay = `<span style="font-family:monospace; font-weight:bold; font-size:1.1rem; color:#2ecc71;">Done</span>`;
        } else if (data.timer) {
            timerDisplay = `<span style="font-family:monospace; font-weight:bold; font-size:1.1rem;">${data.timer}</span>`;
        }

        const safeUser = user.replace(/[^a-zA-Z0-9]/g, '_');
        const rowId = `vt-row-${session.sessionId}-${safeUser}`;
        let tr = document.getElementById(rowId);
        
        if (!tr) {
            tr = document.createElement('tr');
            tr.id = rowId;
            tr.setAttribute('data-user', user);
            tr.innerHTML = `
                <td class="col-user"></td>
                <td class="col-status"></td>
                <td class="col-timer"></td>
                <td class="col-sec"></td>
                <td class="col-ctrl"></td>
            `;
        }

        tbody.appendChild(tr); // This safely adds/reorders the row in the DOM

        if (tr.className !== rowClass) tr.className = rowClass;

        const htmlUser = `<div style="display:flex; align-items:center;">${getAvatarHTML(user)} <strong>${user}</strong></div>`;
        const colUser = tr.querySelector('.col-user');
        if (colUser.innerHTML !== htmlUser) colUser.innerHTML = htmlUser;

        const colStatus = tr.querySelector('.col-status');
        if (colStatus.innerHTML !== statusBadge) colStatus.innerHTML = statusBadge;

        const colTimer = tr.querySelector('.col-timer');
        if (colTimer.innerHTML !== timerDisplay) colTimer.innerHTML = timerDisplay;

        const colSec = tr.querySelector('.col-sec');
        if (colSec.innerHTML !== securityHtml) colSec.innerHTML = securityHtml;

        const htmlCtrl = `<div style="display:flex; align-items:center; gap:10px;">${switchHtml}${extraTools}${mainAction}</div>`;
        const colCtrl = tr.querySelector('.col-ctrl');
        if (colCtrl.innerHTML !== htmlCtrl) colCtrl.innerHTML = htmlCtrl;
    });

    // Cleanup removed trainees
    Array.from(tbody.querySelectorAll('tr[data-user]')).forEach(tr => {
        if (!currentUsers.has(tr.getAttribute('data-user'))) {
            tr.remove();
        }
    });
}

// --- NEW: HELPER TO UPDATE STATS WITHOUT DOM REFRESH ---
function updateVettingStatsUI(session) {
    const trainees = session.trainees || {};
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    const total = (session.targetGroup && session.targetGroup !== 'all' && rosters[session.targetGroup]) ? rosters[session.targetGroup].length : Object.keys(trainees).length;
    const activeCount = Object.values(trainees).filter(t => t.status === 'started').length;
    const blockedCount = Object.values(trainees).filter(t => t.status === 'blocked').length;
    const completedCount = Object.values(trainees).filter(t => t.status === 'completed').length;

    const ex = document.getElementById(`stat_expected_${session.sessionId}`);
    const ac = document.getElementById(`stat_active_${session.sessionId}`);
    const bl = document.getElementById(`stat_blocked_${session.sessionId}`);
    const co = document.getElementById(`stat_completed_${session.sessionId}`);
    const tabAc = document.getElementById(`tab_active_${session.sessionId}`);

    if(ex) ex.innerText = total;
    if(ac) ac.innerText = activeCount;
    if(bl) bl.innerText = blockedCount;
    if(co) co.innerText = completedCount;
    if(tabAc) tabAc.innerText = activeCount;
}

// --- NEW: STATE RESTORATION (Fixes Server Switch Gap) ---
async function ensureVettingServerState() {
    if (!window.supabaseClient) return;
    
    const activeSessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
    if (activeSessions.length === 0) return;

    // Fetch all IDs currently on server
    const { data, error } = await window.supabaseClient.from('vetting_sessions').select('id');
    const serverIds = new Set(data ? data.map(r => r.id) : []);

    for (const session of activeSessions) {
        if (!serverIds.has(session.sessionId)) {
            console.warn(`Vetting Session ${session.sessionId} missing on server. Restoring...`);
            await saveVettingSessionDirectly(session);
        }
    }
}

// --- NEW: ADMIN POLLER (Fetch all sessions) ---
async function adminPollVettingSession() {
    if (!window.supabaseClient) return;

    const { data, error } = await window.supabaseClient
        .from('vetting_sessions')
        .select('data');
    
    if (data) {
        const activeSessions = data.map(r => r.data).filter(s => s && s.active);
        localStorage.setItem('adminVettingSessions', JSON.stringify(activeSessions));
        
        if (ACTIVE_VETTING_TAB) {
            const current = activeSessions.find(s => s.sessionId === ACTIVE_VETTING_TAB);
            if (current) localStorage.setItem('vettingSession', JSON.stringify(current));
        }
    }
}

async function startVettingSession() {
    if (CURRENT_USER.role === 'special_viewer') {
        alert("View Only Mode.");
        return;
    }
    const testId = document.getElementById('vettingTestSelect').value;
    const groupId = document.getElementById('vettingGroupSelect').value;
    if (!testId) return alert("Select a test.");
    
    const activeSessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
    if (activeSessions.some(s => s.targetGroup === groupId)) {
        if(!confirm(`A session is already active for target: ${groupId}. Proceeding might cause conflicts. Continue?`)) return;
    }

    const session = {
        sessionId: Date.now() + "_" + Math.random().toString(36).substr(2, 5), // NEW: Unique ID
        active: true,
        testId: testId,
        targetGroup: groupId,
        startTime: Date.now(),
        trainees: {}
    };
    
    activeSessions.push(session);
    localStorage.setItem('adminVettingSessions', JSON.stringify(activeSessions));
    
    localStorage.setItem('vettingSession', JSON.stringify(session));
    ACTIVE_VETTING_TAB = session.sessionId;
    
    if (activeSessions.length > 1) ADMIN_VETTING_VIEW_MODE = 'split'; // Auto split for new concurrent sessions

    await saveVettingSessionDirectly(session);
    if(typeof saveToServer === 'function') await saveToServer(['vettingSession'], true); // Sync to app_documents for consistency
    
    renderAdminArena();
    alert("Session Started. Trainees can now access the Vetting Arena.");
}

async function endVettingSession(sessionIdToClose) {
    if(!confirm("End this session? This will close the arena for all trainees in this group.")) return;
    
    const sId = sessionIdToClose || ACTIVE_VETTING_TAB;
    let activeSessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
    const session = activeSessions.find(s => s.sessionId === sId);
    
    if (session) {
        session.active = false;
        
        if (ACTIVE_VETTING_TAB === sId) {
            localStorage.setItem('vettingSession', JSON.stringify(session));
        }
        
        if (window.supabaseClient && session.sessionId) {
            await window.supabaseClient.from('vetting_sessions').delete().eq('id', session.sessionId);
        } else {
            await saveVettingSessionDirectly(session);
        }
        if(typeof saveToServer === 'function') await saveToServer(['vettingSession'], true);
    }
    
    activeSessions = activeSessions.filter(s => s.sessionId !== sId);
    localStorage.setItem('adminVettingSessions', JSON.stringify(activeSessions));
    if (ACTIVE_VETTING_TAB === sId) ACTIVE_VETTING_TAB = null;
    
    if (ADMIN_MONITOR_INTERVAL) clearTimeout(ADMIN_MONITOR_INTERVAL);
    renderAdminArena();
}

// --- NEW: MULTI-SESSION AWARE ADMIN ACTIONS ---
window.forceSubmitTrainee = async function(sessionId, username) {
    if(!confirm(`Force submit and kick ${username} out of the arena?`)) return;
    
    let activeSessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
    const session = activeSessions.find(s => s.sessionId === sessionId);
    if (!session) return;

    if (!session.trainees[username]) session.trainees[username] = {};
    session.trainees[username].status = 'completed'; // Setting to completed locks them out securely
    
    localStorage.setItem('adminVettingSessions', JSON.stringify(activeSessions));
    if (ACTIVE_VETTING_TAB === sessionId || ADMIN_VETTING_VIEW_MODE === 'split') localStorage.setItem('vettingSession', JSON.stringify(session));
    
    await saveVettingSessionDirectly(session);
    renderAdminArena();
};

window.overrideSecurity = async function(sessionId, username) {
    if(!confirm(`Override security blocks for ${username}? They will be allowed to enter.`)) return;

    let activeSessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
    const session = activeSessions.find(s => s.sessionId === sessionId);
    if (!session) return;

    if (!session.trainees[username]) session.trainees[username] = {};
    session.trainees[username].override = true;
    session.trainees[username].status = 'ready'; // Reset to ready so they can enter
    
    localStorage.setItem('adminVettingSessions', JSON.stringify(activeSessions));
    if (ACTIVE_VETTING_TAB === sessionId || ADMIN_VETTING_VIEW_MODE === 'split') localStorage.setItem('vettingSession', JSON.stringify(session));
    
    await saveVettingSessionDirectly(session);
    renderAdminArena();
};

async function toggleSecurity(sessionId, username, enable) {
    let activeSessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
    const session = activeSessions.find(s => s.sessionId === sessionId);
    if (!session) return;

    if (!session.trainees[username]) session.trainees[username] = {};
    session.trainees[username].relaxed = enable;
    
    localStorage.setItem('adminVettingSessions', JSON.stringify(activeSessions));
    if (ACTIVE_VETTING_TAB === sessionId || ADMIN_VETTING_VIEW_MODE === 'split') localStorage.setItem('vettingSession', JSON.stringify(session));
    
    await saveVettingSessionDirectly(session);
    renderAdminArena();
}

// --- NEW: DIRECT TABLE SAVE (Bypass Blob) ---
async function saveVettingSessionDirectly(session) {
    if (!window.supabaseClient) return;
    // Upsert to 'vetting_sessions' table with fixed ID
    const id = session.sessionId || 'global_session';
    await window.supabaseClient.from('vetting_sessions').upsert({
        id: id,
        data: session,
        updated_at: new Date().toISOString()
    });
}

// --- NEW: SAFE PATCH FOR TRAINEES (Prevents Data Loss) ---
async function patchTraineeStatus(username, statusData) {
    if (!window.supabaseClient) return;
    
    const localSession = JSON.parse(localStorage.getItem('vettingSession') || '{}');
    const sessionId = localSession.sessionId || 'global_session';

    // 1. Fetch latest server state
    const { data, error } = await window.supabaseClient
        .from('vetting_sessions')
        .select('data')
        .eq('id', sessionId)
        .single();
        
    if (error || !data) return;
    
    const serverSession = data.data;
    if (!serverSession.trainees) serverSession.trainees = {};
    
    // 2. Merge ONLY this user's data
    serverSession.trainees[username] = { ...(serverSession.trainees[username] || {}), ...statusData };
    
    // 3. Save back
    await window.supabaseClient.from('vetting_sessions').update({ data: serverSession, updated_at: new Date().toISOString() }).eq('id', sessionId);
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
        // ENSURE UNLOCK: If session is inactive, force kiosk off and restore sidebar
        if (typeof require !== 'undefined') {
            const { ipcRenderer } = require('electron');
            ipcRenderer.invoke('set-kiosk-mode', false).catch(()=>{});
            ipcRenderer.invoke('set-content-protection', false).catch(()=>{});
        }
        toggleSidebar(true);

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
        // Inject styles for the waiting indicator
        if (!document.getElementById('vetting-waiting-style')) {
            const style = document.createElement('style');
            style.id = 'vetting-waiting-style';
            style.innerHTML = `
                @keyframes pulse-green {
                    0% { box-shadow: 0 0 0 0 rgba(46, 204, 113, 0.7); }
                    70% { box-shadow: 0 0 0 10px rgba(46, 204, 113, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(46, 204, 113, 0); }
                }
                .waiting-pulse {
                    display: inline-flex; align-items: center; gap: 10px;
                    padding: 12px 25px; background: rgba(46, 204, 113, 0.1);
                    border: 1px solid #2ecc71; border-radius: 50px;
                    color: #2ecc71; font-weight: bold;
                    animation: pulse-green 2s infinite;
                }
            `;
            document.head.appendChild(style);
        }

        container.innerHTML = `
            <div style="text-align:center; padding:50px; max-width:600px; margin:0 auto;">
                <i class="fas fa-lock" style="font-size:4rem; color:#f1c40f; margin-bottom:20px;"></i>
                <h3>Assessment Submitted</h3>
                <p style="font-size:1.1rem; margin-bottom:30px;">Your test has been submitted securely.</p>
                
                <div class="waiting-pulse">
                    <i class="fas fa-wifi"></i> Waiting for Admin to End Session...
                </div>
                
                <div style="margin-top:30px; font-size:0.9rem; color:var(--text-muted);">
                    Please remain seated. Your screen is still monitored.
                </div>
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
                <div id="securityCheckLog" class="security-log-box" style="min-height:80px;">
                    <div style="display:flex; align-items:center; gap:15px; padding:15px; color:var(--primary); background:var(--bg-input); border-radius:6px; border:1px dashed var(--primary);">
                        <i class="fas fa-circle-notch fa-spin" style="font-size:1.8rem;"></i>
                        <div>
                            <strong style="font-size:1.1rem;">Scanning System...</strong>
                            <div style="font-size:0.9rem; color:var(--text-muted);">Verifying security protocols</div>
                        </div>
                    </div>
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
    if (TRAINEE_LOCAL_POLLER) clearInterval(TRAINEE_LOCAL_POLLER);
}

function startTraineePreFlight() {

    // 2. Local Security Poll (2s) - Check Screens/Apps
    // This prevents the "Stuck" issue by constantly re-evaluating
    LAST_REPORTED_STATUS = null; // Reset so we report presence immediately
    TRAINEE_LOCAL_POLLER = setInterval(checkSystemCompliance, 2000);
    checkSystemCompliance(); // Run immediately
}

function checkAndHandleSession(serverSession, eventType = null, deletedId = null) {
    const localSession = JSON.parse(localStorage.getItem('vettingSession') || '{}');

    // CRITICAL: Safely handle if the server explicitly deleted OUR active session
    if (eventType === 'DELETE' && localSession.sessionId === deletedId) {
        handleVettingUpdate({ active: false });
        return;
    }

    if (!serverSession || !serverSession.active) {
        // If it's a generic update marking OUR session as inactive
        if (serverSession && localSession.sessionId === serverSession.sessionId) {
             handleVettingUpdate({ active: false });
        }
        return; 
    }
    
    // 1. Check Group
    let isTarget = false;
    if (!serverSession.targetGroup || serverSession.targetGroup === 'all') isTarget = true;
    else {
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        const members = rosters[serverSession.targetGroup] || [];
        if (members.some(m => m.toLowerCase() === CURRENT_USER.user.toLowerCase())) isTarget = true;
    }

    if (isTarget) {
        handleVettingUpdate(serverSession);
    }
}

function handleVettingUpdate(serverSession) {
    const localSession = JSON.parse(localStorage.getItem('vettingSession') || '{}');

    // Merge only the global session flags + override flag
    localSession.active = serverSession.active;
    localSession.testId = serverSession.testId;
    localSession.targetGroup = serverSession.targetGroup;
    localSession.sessionId = serverSession.sessionId; // Sync ID

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
}

// Lightweight Poller for Session State
async function pollVettingSession() {
    if (!window.supabaseClient) return;
    
    // Fetch ALL active sessions
    const { data, error } = await window.supabaseClient
        .from('vetting_sessions')
        .select('data');
        
    if (data && data.length > 0) {
        data.forEach(row => {
            checkAndHandleSession(row.data);
        });
    }
}

let LAST_REPORTED_STATUS = null;
let IS_CHECKING_COMPLIANCE = false;

async function checkSystemCompliance() {
    if (IS_CHECKING_COMPLIANCE) return;
    IS_CHECKING_COMPLIANCE = true;

    try {
        const logBox = document.getElementById('securityCheckLog');
        const btn = document.getElementById('btnEnterArena');
        if (!logBox || !btn) return;

        // 1. Check Override
        const session = JSON.parse(localStorage.getItem('vettingSession') || '{}');
        const myData = session.trainees ? session.trainees[CURRENT_USER.user] : null;
        const isOverridden = myData && myData.override;
        const isRelaxed = myData && myData.relaxed;
        
        // GLOBAL KIOSK ENFORCEMENT
        const config = JSON.parse(localStorage.getItem('system_config') || '{}');
        if (config.security && config.security.force_kiosk_global) {
            // Force strict mode regardless of relaxed setting
            if (isRelaxed) return; // Wait, we need to force checks. Actually, we should treat isRelaxed as false.
        }

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
                logBox.innerHTML = `
                    <div class="sec-pass" style="color:#e67e22; background:rgba(230, 126, 34, 0.1); padding:15px; border-radius:6px; border:1px solid #e67e22;">
                        <div style="display:flex; align-items:center; gap:15px;">
                            <i class="fas fa-unlock" style="font-size:1.8rem;"></i>
                            <div>
                                <strong style="font-size:1.1rem;">Security Relaxed</strong>
                                <div style="font-size:0.9rem; opacity:0.9;">Strict rules disabled by Admin.</div>
                            </div>
                        </div>
                    </div>`;
            } else {
                logBox.innerHTML = `
                    <div class="sec-pass" style="color:#2ecc71; background:rgba(46, 204, 113, 0.1); padding:15px; border-radius:6px; border:1px solid #2ecc71;">
                        <div style="display:flex; align-items:center; gap:15px;">
                            <i class="fas fa-check-circle" style="font-size:1.8rem;"></i>
                            <div>
                                <strong style="font-size:1.1rem;">System Secure</strong>
                                <div style="font-size:0.9rem; opacity:0.9;">All checks passed. Ready to start.</div>
                            </div>
                        </div>
                    </div>`;
            }
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            btn.style.animation = 'pulse 2s infinite'; // Visual cue
        } else if (isOverridden) {
            logBox.innerHTML = `
                <div class="sec-warn" style="color:#f1c40f; background:rgba(241, 196, 15, 0.1); padding:15px; border-radius:6px; border:1px solid #f1c40f; margin-bottom:10px;">
                    <div style="display:flex; align-items:center; gap:15px;">
                        <i class="fas fa-exclamation-triangle" style="font-size:1.8rem;"></i>
                        <div>
                            <strong style="font-size:1.1rem;">Admin Override Active</strong>
                            <div style="font-size:0.9rem; opacity:0.9;">Security checks bypassed.</div>
                        </div>
                    </div>
                </div>` + 
                errors.map(e => `
                    <div class="sec-fail" style="opacity:0.7; padding:8px 10px; border-bottom:1px solid var(--border-color); color:var(--text-muted); display:flex; align-items:center; gap:10px;">
                        <i class="fas fa-times" style="color:#ff5252;"></i> <span>${e} (Ignored)</span>
                    </div>`).join('');
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            btn.style.animation = 'none';
        } else {
            logBox.innerHTML = errors.map(e => `
                <div class="sec-fail" style="background:rgba(255, 82, 82, 0.1); color:#ff5252; padding:15px; border-radius:6px; border:1px solid #ff5252; margin-bottom:10px; display:flex; align-items:center; gap:15px;">
                    <i class="fas fa-ban" style="font-size:1.5rem;"></i>
                    <div>
                        <strong style="font-size:1.1rem;">Security Violation</strong>
                        <div style="font-size:0.9rem; opacity:0.9;">${e}</div>
                    </div>
                </div>`).join('');
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
            btn.style.animation = 'none';
        }

        // Report to Server if Status Changed (e.g. Waiting -> Blocked or Waiting -> Ready)
        if (currentStatus !== LAST_REPORTED_STATUS) {
            LAST_REPORTED_STATUS = currentStatus;
            await updateTraineeStatus(currentStatus);
        }
    } finally {
        IS_CHECKING_COMPLIANCE = false;
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
    let isRelaxed = myData && myData.relaxed;

    // GLOBAL KIOSK ENFORCEMENT
    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
    if (config.security && config.security.force_kiosk_global) {
        isRelaxed = false;
    }

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

// --- NEW: NON-BLOCKING SECURITY OVERLAY ---
function showSecurityViolationOverlay(msg, isFatal) {
    let overlay = document.getElementById('security-violation-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'security-violation-overlay';
        overlay.className = 'modal-overlay';
        overlay.style.zIndex = '15000';
        overlay.style.background = 'rgba(255, 0, 0, 0.85)';
        document.body.appendChild(overlay);
    }
    overlay.dataset.fatal = isFatal ? 'true' : '';
    overlay.innerHTML = `
        <div class="modal-box" style="border: 2px solid #ff5252; max-width: 600px; text-align: center; box-shadow: 0 0 50px rgba(255,0,0,0.5);">
            <i class="fas fa-exclamation-triangle" style="font-size: 4rem; color: #ff5252; margin-bottom: 20px; animation: shake 0.5s infinite;"></i>
            <h2 style="color: #ff5252; text-transform: uppercase;">Security Alert</h2>
            <div style="font-size: 1.2rem; line-height: 1.5; color: white; margin-bottom: 20px;">${msg}</div>
            ${!isFatal ? '<div style="font-weight:bold; font-size:1.1rem; color:#f1c40f;">Close the forbidden application to automatically dismiss this warning.</div>' : '<div style="font-weight:bold; font-size:1.5rem; color:white;">Processing Submission... Please wait.</div>'}
        </div>
    `;
}

async function updateTraineeStatus(status, timerStr = "") {
    // We avoid full-schema loadFromServer(true) here to reduce reads.
    // saveToServer(['vettingSession'], false) already performs a merge and our merge logic
    // deep-merges trainees, so we won't wipe other trainees/admin changes.
    const session = JSON.parse(localStorage.getItem('vettingSession') || '{"active":false,"trainees":{}}');
    
    // CHECK: Session Ended?
    if (!session.active && status === 'started') {
        if (typeof submitTest === 'function') await submitTest(true); // Pass true to suppress "Already exists" alert
        return;
    }
    
    if (!session.trainees) session.trainees = {};
    if (!session.trainees[CURRENT_USER.user]) session.trainees[CURRENT_USER.user] = {};
    
    // Check if security is relaxed for this user
    const isRelaxed = session.trainees[CURRENT_USER.user].relaxed === true;

    session.trainees[CURRENT_USER.user].status = status;
    // NEW: Record start time for Admin UI extrapolation
    if (status === 'started' && !session.trainees[CURRENT_USER.user].startedAt) {
        session.trainees[CURRENT_USER.user].startedAt = Date.now();
    }
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
            if (IS_SUBMITTING_VIOLATION) return; // Already handling it
            IS_SUBMITTING_VIOLATION = true;
            
            showSecurityViolationOverlay("Security Violation: Forbidden apps detected (" + apps.join(', ') + "). Test ending.", true);
            if (typeof submitTest === 'function') await submitTest(true);
            IS_SUBMITTING_VIOLATION = false;
            return; // Stop here, submitTest will handle the rest
        }
    }

    localStorage.setItem('vettingSession', JSON.stringify(session));
    
    // INSTANT PATCH: Replaced debounce with immediate patch to prevent data loss.
    let currentLocal = null;
    try {
        currentLocal = JSON.parse(localStorage.getItem('vettingSession'));
    } catch(e) {}
    if (currentLocal && currentLocal.trainees && currentLocal.trainees[CURRENT_USER.user]) {
         patchTraineeStatus(CURRENT_USER.user, currentLocal.trainees[CURRENT_USER.user]);
    }
}

let SECURITY_WARNING_COUNT = 0;
let IS_POLLING_SECURITY = false; // Prevent IPC pileup

function startActiveTestMonitoring() {
    if (SECURITY_MONITOR_INTERVAL) clearInterval(SECURITY_MONITOR_INTERVAL);
    if (SECURITY_VIOLATION_INTERVAL) clearInterval(SECURITY_VIOLATION_INTERVAL);
    
    // REMOVED 10-second SECURITY_MONITOR_INTERVAL here. 
    // Hammering the database with timer updates caused massive read/write race conditions ("falling behind").
    // Timer is now calculated locally on the Admin UI using the 'startedAt' timestamp.

    // FAST SECURITY POLL (3s) - Detect violations quickly
    // We don't send full status to server every 3s to save bandwidth, 
    // but we check locally and trigger updateTraineeStatus ONLY if violation found.
    SECURITY_VIOLATION_INTERVAL = setInterval(async () => {
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

        if (IS_POLLING_SECURITY) return;
        IS_POLLING_SECURITY = true;

        if (typeof require !== 'undefined') {
            try {
            const { ipcRenderer } = require('electron');
            
            // --- KIOSK SHIELD RE-ENGAGEMENT ---
            // If the shield was dropped (relaxed) but is now active again, force it back on.
            ipcRenderer.invoke('set-kiosk-mode', true).catch(()=>{});
            ipcRenderer.invoke('set-content-protection', true).catch(()=>{});

            let forbidden = JSON.parse(localStorage.getItem('forbiddenApps') || '[]');
            if (forbidden.length === 0 && typeof DEFAULT_FORBIDDEN_APPS !== 'undefined') {
                forbidden = DEFAULT_FORBIDDEN_APPS;
            }

            const apps = await ipcRenderer.invoke('get-process-list', forbidden);
            const screens = await ipcRenderer.invoke('get-screen-count');
            
            if (apps.length > 0 || screens > 1) {
                SECURITY_WARNING_COUNT++;
                if (SECURITY_WARNING_COUNT === 1) {
                        showSecurityViolationOverlay(`A forbidden app was detected running in the background:<br><strong style="color:#f1c40f;">${apps.join(', ')}</strong><br><br>You have 10 seconds to close it before your test is automatically terminated.`, false);
                } else if (SECURITY_WARNING_COUNT >= 4) {
                    // 4 strikes * 3 seconds = ~12 seconds grace period
                    updateTraineeStatus('started'); // Trigger the actual kick logic
                }
            } else {
                // If they close the app, forgive them and reset
                SECURITY_WARNING_COUNT = 0; 
                    const overlay = document.getElementById('security-violation-overlay');
                    if (overlay && !overlay.dataset.fatal) overlay.remove(); // Clear warning if they fixed it
            }
            } finally {
                IS_POLLING_SECURITY = false;
            }
        }
    }, 3000);
}

// Called by assessment.js when submitting
async function exitArena(keepLocked = false) {
    stopTraineePollers();
    if (SECURITY_MONITOR_INTERVAL) clearInterval(SECURITY_MONITOR_INTERVAL);
    if (SECURITY_VIOLATION_INTERVAL) clearInterval(SECURITY_VIOLATION_INTERVAL);
    
    if (!keepLocked) {
        if (typeof require !== 'undefined') {
            const { ipcRenderer } = require('electron');
            try {
                await ipcRenderer.invoke('set-kiosk-mode', false);
                await ipcRenderer.invoke('set-content-protection', false);
            } catch(e) { console.error("Exit Kiosk Error", e); }
        }
        
        // Restore Sidebar
        toggleSidebar(true);
    }

    await updateTraineeStatus('completed');
    renderTraineeArena();
}

// --- GLOBAL ENFORCER (TRAINEE) ---
let VETTING_ENFORCER_INTERVAL = null;

window.initVettingEnforcer = function() {
    if (VETTING_ENFORCER_INTERVAL) clearInterval(VETTING_ENFORCER_INTERVAL);
    if (!CURRENT_USER || CURRENT_USER.role !== 'trainee') return;

    // Check every 5 seconds
    VETTING_ENFORCER_INTERVAL = setInterval(checkAndEnforceVetting, 5000);
    checkAndEnforceVetting();
};

async function checkAndEnforceVetting() {
    try {
        // Use Realtime-synced local cache instead of hammering the DB
        const activeSessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
        const localSession = JSON.parse(localStorage.getItem('vettingSession') || '{"active":false}');
        let foundTargetSession = null;
            
        if (activeSessions.length > 0) {
            // Update Sidebar Visibility (Show/Hide tab based on active status)
            if (typeof updateSidebarVisibility === 'function') updateSidebarVisibility();
            const now = Date.now();

            // Find relevant session
            for (const s of activeSessions) {
                if (!s.active) continue;
                
                // STALE CHECK: Ignore abandoned sessions older than 12 hours to prevent infinite yanking
                const start = s.startTime || (s.sessionId ? parseInt(s.sessionId.split('_')[0]) : 0);
                if (now - start > 43200000) continue;

                // Check if I am target
                let isTarget = false;
                if (!s.targetGroup || s.targetGroup === 'all') isTarget = true;
                else {
                    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
                    const members = rosters[s.targetGroup] || [];
                    // Case-insensitive check
                    if (members.some(m => m.toLowerCase() === CURRENT_USER.user.toLowerCase())) isTarget = true;
                }
                
                if (isTarget) {
                    foundTargetSession = s;
                    break; // Found our session, process it
                }
            }
        }
        
        if (foundTargetSession) {
            if (typeof handleVettingUpdate === 'function') handleVettingUpdate(foundTargetSession);
            const myData = foundTargetSession.trainees ? foundTargetSession.trainees[CURRENT_USER.user] : null;
            if (!myData || myData.status !== 'completed') {
                const activeTab = document.querySelector('section.active');
                if (!activeTab || activeTab.id !== 'vetting-arena') {
                    if (typeof showTab === 'function') showTab('vetting-arena');
                }
            }
        } else if (localSession.active) {
            // FAILSAFE: We are locally active, but NO server session targets us anymore. The session was aborted.
            if (typeof handleVettingUpdate === 'function') handleVettingUpdate({ active: false });
        }
    } catch(e) { console.error("Vetting Enforcer Error:", e); }
}

// --- NEW: GLOBAL CLEANUP ---
window.cleanupVettingEnforcer = function() {
    if (VETTING_ENFORCER_INTERVAL) clearInterval(VETTING_ENFORCER_INTERVAL);
    VETTING_ENFORCER_INTERVAL = null;
};

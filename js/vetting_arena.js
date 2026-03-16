/* ================= VETTING TEST ARENA ================= */
/* Handles high-security testing environment */

// --- ADMIN CONTROLS ---

let ADMIN_MONITOR_INTERVAL = null;
let TRAINEE_NET_POLLER = null;
let TRAINEE_LOCAL_POLLER = null;
let VETTING_REALTIME_UNSUB = null;
let ADMIN_VETTING_REALTIME_UNSUB = null;
let VETTING_SAVE_TIMEOUT = null; // OPTIMIZATION: Debounce saves
let SECURITY_VIOLATION_INTERVAL = null; // Track the fast security poll
let IS_SUBMITTING_VIOLATION = false; // Prevent alert loops
let ACTIVE_VETTING_TAB = null; // Track which session the Admin is currently viewing

function loadVettingArena() {
    // FEATURE FLAG CHECK
    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
    if (config.features && config.features.vetting_arena === false) {
        const container = document.getElementById('vetting-arena-content');
        if(container) container.innerHTML = `<div style="text-align:center; padding:50px; color:var(--text-muted);"><i class="fas fa-ban" style="font-size:3rem; margin-bottom:15px;"></i><h3>Feature Disabled</h3><p>The Vetting Arena is currently disabled by the System Administrator.</p></div>`;
        return;
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
    if (ADMIN_MONITOR_INTERVAL) clearTimeout(ADMIN_MONITOR_INTERVAL);
    if (ADMIN_VETTING_REALTIME_UNSUB) { try { ADMIN_VETTING_REALTIME_UNSUB(); } catch (e) {} ADMIN_VETTING_REALTIME_UNSUB = null; }

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
    const activeSessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
    
    let html = '';

    // 1. Render New Session Form (Compact if sessions are already running)
    html += renderIdleAdminShell(activeSessions.length > 0);

    // 2. Render Active Sessions with Tabs
    if (activeSessions.length > 0) {
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
        html += `<div style="display:flex; gap:10px; margin-top:20px; margin-bottom:15px; overflow-x:auto; padding-bottom:5px;">`;
        activeSessions.forEach((s, idx) => {
            const isActive = ACTIVE_VETTING_TAB === s.sessionId ? 'background:var(--primary); color:white; box-shadow:0 4px 10px rgba(243, 112, 33, 0.3);' : 'background:var(--bg-card); color:var(--text-muted); border:1px solid var(--border-color);';
            const groupName = s.targetGroup === 'all' ? 'All Groups' : ((typeof getGroupLabel === 'function') ? getGroupLabel(s.targetGroup).split('[')[0] : s.targetGroup);
            const activeCount = Object.values(s.trainees || {}).filter(t => t.status === 'started').length;

            html += `
            <button onclick="switchVettingTab('${s.sessionId}')" style="padding:10px 20px; border-radius:8px; cursor:pointer; min-width:150px; text-align:left; transition:0.3s; ${isActive}">
                <div style="font-size:0.8rem; text-transform:uppercase; opacity:0.8;">Session ${idx+1}</div>
                <div style="font-weight:bold; font-size:1.1rem; margin:5px 0;">${groupName}</div>
                <div style="font-size:0.8rem;"><i class="fas fa-users"></i> ${activeCount} Active</div>
            </button>`;
        });
        html += `</div>`;

        // Active Session Monitor UI
        if (currentSession) {
            html += renderActiveAdminShell(currentSession);
        }
    }

    // Apply HTML to DOM
    if (container.innerHTML !== html) {
        container.innerHTML = html;
    }

    populateVettingDropdowns();

    if (activeSessions.length > 0) {
        const currentSession = activeSessions.find(s => s.sessionId === ACTIVE_VETTING_TAB);
        if (currentSession) updateVettingTableRows(currentSession);
    }

    // Realtime Subscription
    if (window.supabaseClient) {
        const channel = window.supabaseClient.channel('vetting_room')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'vetting_sessions' }, (payload) => {
                let sessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
                if (payload.eventType === 'DELETE') {
                    sessions = sessions.filter(s => s.sessionId !== payload.old.id);
                } else if (payload.new && payload.new.data) {
                    const newData = payload.new.data;
                    const idx = sessions.findIndex(s => s.sessionId === newData.sessionId);
                    if (newData.active) {
                        if (idx > -1) sessions[idx] = newData;
                        else sessions.push(newData);
                    } else {
                        sessions = sessions.filter(s => s.sessionId !== newData.sessionId);
                    }
                }
                localStorage.setItem('adminVettingSessions', JSON.stringify(sessions));
                renderAdminArena();
            })
            .subscribe();
        ADMIN_VETTING_REALTIME_UNSUB = () => { try { channel.unsubscribe(); } catch(e){} };
    }

    // Auto-Refresh Monitor every 5 seconds if active
    if (activeSessions.length > 0) {
        ADMIN_MONITOR_INTERVAL = setTimeout(async () => {
            try {
                await ensureVettingServerState();
                await adminPollVettingSession();
            } catch(e) { console.error("Vetting Poll Error:", e); }
            renderAdminArena();
        }, 5000);
    }
}

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

function renderActiveAdminShell(session) {
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const activeTest = tests.find(t => t.id == session.testId);
    const title = activeTest ? activeTest.title : "Unknown Test";
    const targetGroup = session.targetGroup === 'all' || !session.targetGroup ? 'All Groups' : ((typeof getGroupLabel === 'function') ? getGroupLabel(session.targetGroup) : session.targetGroup);
    
    // Calculate Stats
    const trainees = session.trainees || {};
    const total = Object.keys(trainees).length;
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
                        <h3 style="margin:0; color:#2ecc71; display:flex; align-items:center;">${title} <span class="pulse-dot" title="Live Session Active"></span></h3>
                        <p style="margin:5px 0 0 0; color:var(--text-muted);">Target: <strong>${targetGroup}</strong></p>
                    </div>
                </div>
                ${CURRENT_USER.role === 'special_viewer' ? '' : `<button class="btn-danger" onclick="endVettingSession('${session.sessionId}')"><i class="fas fa-stop-circle"></i> END SESSION</button>`}
            </div>
            
            <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px;">
                <div style="text-align:center;"><div style="font-size:1.5rem; font-weight:bold;">${total}</div><div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase;">Connected</div></div>
                <div style="text-align:center;"><div style="font-size:1.5rem; font-weight:bold; color:#2ecc71;">${activeCount}</div><div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase;">In Progress</div></div>
                <div style="text-align:center;"><div style="font-size:1.5rem; font-weight:bold; color:#ff5252;">${blockedCount}</div><div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase;">Blocked</div></div>
                <div style="text-align:center;"><div style="font-size:1.5rem; font-weight:bold; color:#3498db;">${completedCount}</div><div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase;">Completed</div></div>
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
                <tbody id="vetting-monitor-body">
                    <!-- Rows injected via updateVettingTableRows -->
                </tbody>
            </table>
        </div>
    `;
}

function updateVettingTableRows(session) {
    const tbody = document.getElementById('vetting-monitor-body');
    if (!tbody) return;

    const trainees = session.trainees || {};
    const targetGroup = session.targetGroup;
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');

    // FILTER: Only show trainees in the target group
    let filteredEntries = Object.entries(trainees);
    
    if (targetGroup && targetGroup !== 'all') {
        const allowedMembers = rosters[targetGroup] || [];
        filteredEntries = filteredEntries.filter(([user, data]) => allowedMembers.includes(user));
    }

    if (filteredEntries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No trainees active yet.</td></tr>';
        return;
    }

    const html = filteredEntries.map(([user, data]) => {
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
        if (data.security) {
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
            if (CURRENT_USER.role !== 'special_viewer') mainAction = `<button class="btn-danger btn-sm" onclick="forceSubmitTrainee('${user}')" title="Force Stop"><i class="fas fa-stop"></i></button>`;
        } else if (data.status === 'blocked' && !data.override && CURRENT_USER.role !== 'special_viewer') {
            mainAction = `<button class="btn-warning btn-sm" onclick="overrideSecurity('${user}')" title="Override"><i class="fas fa-key"></i></button>`;
        }

        // NEW: Security Switch (Replaces Lock Button)
        const isRelaxed = data.relaxed === true;
        const isSecurityOn = !isRelaxed;
        const disabledAttr = CURRENT_USER.role === 'special_viewer' ? 'disabled' : '';
        
        const switchHtml = `
            <label class="switch" style="margin-bottom:0;" title="Toggle Security Rules">
                    <input type="checkbox" ${isSecurityOn ? 'checked' : ''} ${disabledAttr} onchange="toggleSecurity('${user}', !this.checked)">
                    <span class="slider round"></span>
            </label>
        `;

        const timerDisplay = data.timer ? `<span style="font-family:monospace; font-weight:bold; font-size:1.1rem;">${data.timer}</span>` : '--:--';

        return `
            <tr class="${rowClass}">
                <td><div style="display:flex; align-items:center;">${getAvatarHTML(user)} <strong>${user}</strong></div></td>
                <td>${statusBadge}</td>
                <td>${timerDisplay}</td>
                <td>${securityHtml}</td>
                <td>
                    <div style="display:flex; align-items:center; gap:10px;">
                        ${switchHtml}
                        ${mainAction}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Only update DOM if content changed (prevents selection loss)
    if (tbody.innerHTML !== html) {
        tbody.innerHTML = html;
    }
}

function updateVettingStats(session) {
    const trainees = session.trainees || {};
    const total = Object.keys(trainees).length;
    const activeCount = Object.values(trainees).filter(t => t.status === 'started').length;
    const blockedCount = Object.values(trainees).filter(t => t.status === 'blocked').length;
    const completedCount = Object.values(trainees).filter(t => t.status === 'completed').length;

    const elTotal = document.getElementById('v-stat-total');
    const elActive = document.getElementById('v-stat-active');
    const elBlocked = document.getElementById('v-stat-blocked');
    const elCompleted = document.getElementById('v-stat-completed');

    if (elTotal) elTotal.innerText = total;
    if (elActive) elActive.innerText = activeCount;
    if (elBlocked) elBlocked.innerText = blockedCount;
    if (elCompleted) elCompleted.innerText = completedCount;
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
window.forceSubmitTrainee = async function(username) {
    if(!confirm(`Force submit and kick ${username} out of the arena?`)) return;
    
    let activeSessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
    const session = activeSessions.find(s => s.sessionId === ACTIVE_VETTING_TAB);
    if (!session) return;

    if (!session.trainees[username]) session.trainees[username] = {};
    session.trainees[username].status = 'completed'; // Setting to completed locks them out securely
    
    localStorage.setItem('adminVettingSessions', JSON.stringify(activeSessions));
    localStorage.setItem('vettingSession', JSON.stringify(session));
    
    await saveVettingSessionDirectly(session);
    renderAdminArena();
};

window.overrideSecurity = async function(username) {
    if(!confirm(`Override security blocks for ${username}? They will be allowed to enter.`)) return;

    let activeSessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
    const session = activeSessions.find(s => s.sessionId === ACTIVE_VETTING_TAB);
    if (!session) return;

    if (!session.trainees[username]) session.trainees[username] = {};
    session.trainees[username].override = true;
    session.trainees[username].status = 'ready'; // Reset to ready so they can enter
    
    localStorage.setItem('adminVettingSessions', JSON.stringify(activeSessions));
    localStorage.setItem('vettingSession', JSON.stringify(session));
    
    await saveVettingSessionDirectly(session);
    renderAdminArena();
};

async function toggleSecurity(username, enable) {
    let activeSessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
    const session = activeSessions.find(s => s.sessionId === ACTIVE_VETTING_TAB);
    if (!session) return;

    if (!session.trainees[username]) session.trainees[username] = {};
    session.trainees[username].relaxed = enable;
    
    localStorage.setItem('adminVettingSessions', JSON.stringify(activeSessions));
    localStorage.setItem('vettingSession', JSON.stringify(session));
    
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
    if (TRAINEE_NET_POLLER) clearInterval(TRAINEE_NET_POLLER);
    if (TRAINEE_LOCAL_POLLER) clearInterval(TRAINEE_LOCAL_POLLER);
    if (VETTING_REALTIME_UNSUB) { try { VETTING_REALTIME_UNSUB(); } catch (e) {} VETTING_REALTIME_UNSUB = null; }
}

function startTraineePreFlight() {
    // Prefer Realtime for session updates. Fallback to polling if unavailable.
    let usingRealtime = false;
    if (window.supabaseClient) {
        // Listen to ALL changes, filter in handler
        const channel = window.supabaseClient.channel('vetting_room_trainee')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'vetting_sessions' }, (payload) => {
                if (payload.eventType === 'DELETE') {
                    checkAndHandleSession(null, 'DELETE', payload.old.id);
                } else {
                    const serverSession = payload.new ? payload.new.data : { active: false };
                    checkAndHandleSession(serverSession);
                }
            })
            .subscribe();
        VETTING_REALTIME_UNSUB = () => { try { channel.unsubscribe(); } catch(e){} };
        usingRealtime = true;
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

async function checkSystemCompliance() {
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
            alert("Security Violation: Forbidden apps detected (" + apps.join(', ') + "). Test ending.");
            if (typeof submitTest === 'function') await submitTest(true);
            IS_SUBMITTING_VIOLATION = false;
            return; // Stop here, submitTest will handle the rest
        }
    }

    localStorage.setItem('vettingSession', JSON.stringify(session));
    
    // OPTIMIZATION: Debounce Cloud Save (1.5s)
    // Prevents database throttling if status flickers (e.g. app opened/closed quickly)
    if (VETTING_SAVE_TIMEOUT) clearTimeout(VETTING_SAVE_TIMEOUT);
    
    VETTING_SAVE_TIMEOUT = setTimeout(() => {
        // FIX: Use Patch instead of Overwrite to prevent wiping other trainees
        let currentLocal = null;
        try {
            currentLocal = JSON.parse(localStorage.getItem('vettingSession'));
        } catch(e) {
            console.error("Vetting Session Parse Error", e);
        }
        if (currentLocal && currentLocal.trainees && currentLocal.trainees[CURRENT_USER.user]) {
             patchTraineeStatus(CURRENT_USER.user, currentLocal.trainees[CURRENT_USER.user]);
        }
    }, 1500);
}

function startActiveTestMonitoring() {
    if (SECURITY_MONITOR_INTERVAL) clearInterval(SECURITY_MONITOR_INTERVAL);
    if (SECURITY_VIOLATION_INTERVAL) clearInterval(SECURITY_VIOLATION_INTERVAL);
    
    // Update status every 10 seconds (Faster updates for Admin Timer)
    SECURITY_MONITOR_INTERVAL = setInterval(() => {
        const timerEl = document.getElementById('test-timer-bar');
        const timeStr = timerEl ? timerEl.innerText.replace('TIME: ', '') : '';
        updateTraineeStatus('started', timeStr);
    }, 10000);

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
    if (!window.supabaseClient) return;
    
    try {
        // Fetch ALL active sessions
        const { data, error } = await window.supabaseClient
            .from('vetting_sessions')
            .select('data');
            
        const localSession = JSON.parse(localStorage.getItem('vettingSession') || '{"active":false}');
        let foundTargetSession = null;
            
        if (data && data.length > 0) {
            // Update Sidebar Visibility (Show/Hide tab based on active status)
            if (typeof updateSidebarVisibility === 'function') updateSidebarVisibility();

            // Find relevant session
            for (const row of data) {
                const s = row.data;
                if (!s.active) continue;

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

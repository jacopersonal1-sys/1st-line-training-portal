/* ================= VETTING REWORK CONTROLLER ================= */

// Small UI Helper (Isolated)
function getAvatarHTML(name, size = 35) {
    if (!name) name = "?";
    const initials = name.substring(0, 2).toUpperCase();
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    const color = "#" + "00000".substring(0, 6 - c.length) + c;
    return `<div style="width:${size}px; height:${size}px; background:${color}; border:1px solid var(--border-color); border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#fff; flex-shrink:0; box-shadow:0 2px 4px rgba(0,0,0,0.2);">${initials}</div>`;
}

const App = {
    state: {
        viewMode: 'split',
        activeTabId: null,
        timerTick: null,
        realtimeUnsub: null,
        // --- NEW: Trainee State ---
        traineeSession: null,
        isCheckingCompliance: false,
        securityWarningCount: 0,
        localPoller: null
    },

    init: async function() {
        const container = document.getElementById('app-container');
        try {
        container.innerHTML = '<div style="text-align:center; padding:50px; color:var(--text-muted);"><i class="fas fa-circle-notch fa-spin fa-2x" style="color:var(--primary); margin-bottom:15px;"></i><h3>Booting Sandbox...</h3></div>';

        await DataService.loadInitialData();

        // Route user based on role
        if (AppContext.user && AppContext.user.role === 'trainee') {
            await this.initTrainee();
        } else {
            await this.initAdmin();
        }
        
        } catch(e) {
            container.innerHTML = `<div style="padding:20px; color:#ff5252; background:var(--bg-input); border-radius:8px; border:1px solid #ff5252;"><strong>Sandbox Crashed:</strong><br>${e.message}<br><small>${e.stack}</small></div>`;
        }
    },

    initAdmin: async function() {
        const container = document.getElementById('app-container');
        // Rebuild DOM Shell
        container.innerHTML = '<div id="va-static-form"></div><div id="va-dynamic-views"></div>';

        // 1. Setup Local Timer Ticker (Zero-Lag)
        this.state.timerTick = setInterval(() => {
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

        // 2. Fetch Initial State
        await DataService.pollSessions(); // Now async
        await DataService.ensureServerState(); // Restore lost failover sessions
        this.render();

        // 3. Setup Realtime Listener
        let realtimeRenderDebounce = null;
        this.state.realtimeUnsub = DataService.setupRealtime((payload) => {
            let sessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
            if (payload.eventType === 'DELETE') {
                sessions = sessions.filter(s => s.sessionId !== payload.old.id);
                if (this.state.activeTabId === payload.old.id) this.state.activeTabId = null;
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
            
            // BATCH RENDER: Prevent UI Freeze on mass trainee connections
            if (realtimeRenderDebounce) clearTimeout(realtimeRenderDebounce);
            realtimeRenderDebounce = setTimeout(() => this.render(), 100);
        });
    },

    // ==========================================
    // TRAINEE LOGIC & KIOSK ENGINE
    // ==========================================

    initTrainee: async function() {
        const container = document.getElementById('app-container');
        container.innerHTML = '<div id="va-trainee-view"></div>';
        
        // Initial Fetch
        const sessions = await DataService.pollSessions();
        this.processTraineeSessions(sessions);

        // Setup Realtime Push
        this.state.realtimeUnsub = DataService.setupRealtime((payload) => {
            DataService.pollSessions().then(s => this.processTraineeSessions(s));
        });
    },

    processTraineeSessions: function(sessions) {
        const myName = AppContext.user.user;
        const rosters = DataService.getRosters();
        
        let mySession = null;
        for (const s of sessions) {
            let isTarget = false;
            if (!s.targetGroup || s.targetGroup === 'all') isTarget = true;
            else {
                const members = rosters[s.targetGroup] || [];
                if (members.some(m => m.toLowerCase() === myName.toLowerCase())) isTarget = true;
            }
            if (isTarget) { mySession = s; break; }
        }

        this.state.traineeSession = mySession;
        this.renderTrainee();
    },

    renderTrainee: function() {
        const container = document.getElementById('va-trainee-view');
        if (!container) return;

        if (!this.state.traineeSession) {
            this.stopTraineePollers();
            container.innerHTML = `
                <div style="text-align:center; padding:50px;">
                    <i class="fas fa-door-closed" style="font-size:4rem; color:var(--text-muted); margin-bottom:20px;"></i>
                    <h3>Arena Closed</h3>
                    <p style="color:var(--text-muted);">There is no active Sandbox session for your group.</p>
                </div>`;
            return;
        }

        const session = this.state.traineeSession;
        const myData = session.trainees ? session.trainees[AppContext.user.user] : null;

        if (myData && myData.status === 'completed') {
            this.stopTraineePollers();
            container.innerHTML = `
                <div style="text-align:center; padding:50px;">
                    <i class="fas fa-lock" style="font-size:4rem; color:#f1c40f; margin-bottom:20px;"></i>
                    <h3>Assessment Submitted</h3>
                    <p style="font-size:1.1rem; margin-bottom:30px;">Your sandbox test has been securely submitted.</p>
                </div>`;
            return;
        }

        if (myData && myData.status === 'started') {
            // Kiosk In-Progress View
            container.innerHTML = `
                <div class="card" style="border-left:5px solid #2ecc71; text-align:center;">
                    <h2><i class="fas fa-hammer" style="color:var(--primary);"></i> Sandbox Test Active</h2>
                    <p style="color:var(--text-muted); margin-bottom:30px;">You are locked in the Sandbox Arena. Security monitors are active.</p>
                    <button class="btn-danger btn-lg" onclick="App.exitArena()">Submit & Exit Sandbox</button>
                </div>`;
            this.startActiveTestMonitoring();
            return;
        }

        // Pre-Flight (Waiting/Ready/Blocked)
        const tests = DataService.getTests();
        const test = tests.find(t => t.id == session.testId);

        container.innerHTML = `
            <div class="card" style="text-align:center; max-width:600px; margin:0 auto;">
                <i class="fas fa-shield-alt" style="font-size:4rem; color:var(--primary); margin-bottom:20px;"></i>
                <h2 style="color:var(--primary);">Sandbox Assessment Ready</h2>
                <h3 style="margin-bottom:20px;">${test ? test.title : 'Assessment'}</h3>
                
                <div style="position:relative;">
                    <div id="sandboxSecurityLog" style="background:var(--bg-input); padding:15px; border-radius:6px; border:1px solid var(--border-color); text-align:left; min-height:80px; margin-bottom:20px;">
                        <div style="color:var(--primary);"><i class="fas fa-circle-notch fa-spin"></i> Scanning system...</div>
                    </div>
                </div>

                <button id="btnEnterSandbox" class="btn-primary btn-lg" disabled style="opacity:0.5; cursor:not-allowed;" onclick="App.enterArena()">ENTER SANDBOX KIOSK</button>
            </div>
        `;
        
        this.startTraineePreFlight();
    },

    // --- RENDER ENGINE ---
    render: function() {
        const staticForm = document.getElementById('va-static-form');
        const dynamicViews = document.getElementById('va-dynamic-views');
        
        if (!staticForm || !dynamicViews) return;

        const activeSessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
        const isCompact = activeSessions.length > 0;
        
        // Ensure an active tab is selected
        if (activeSessions.length > 0) {
            if (!this.state.activeTabId || !activeSessions.find(s => s.sessionId === this.state.activeTabId)) {
                this.state.activeTabId = activeSessions[0].sessionId;
            }
        }

        // Render Static Form ONLY if layout structure changes (Prevents focus loss)
        if (staticForm.dataset.compact !== String(isCompact)) {
            staticForm.innerHTML = this.renderIdleShell(isCompact);
            staticForm.dataset.compact = String(isCompact);
            this.populateDropdowns();
        }

        // Render Dynamic Views
        let dynHtml = '';
        if (activeSessions.length > 0) {
            // View Toggles
            if (activeSessions.length > 1) {
                dynHtml += `
                <div style="display:flex; justify-content:flex-end; margin-top:15px; margin-bottom:5px; gap:10px;">
                    <button class="btn-secondary btn-sm ${this.state.viewMode === 'tabbed' ? 'active' : ''}" onclick="App.setViewMode('tabbed')" style="${this.state.viewMode === 'tabbed' ? 'background:var(--primary); color:white;' : ''}"><i class="fas fa-folder"></i> Tabbed View</button>
                    <button class="btn-secondary btn-sm ${this.state.viewMode === 'split' ? 'active' : ''}" onclick="App.setViewMode('split')" style="${this.state.viewMode === 'split' ? 'background:var(--primary); color:white;' : ''}"><i class="fas fa-columns"></i> Split View</button>
                </div>`;
            }

            // Split View Logic
            if (this.state.viewMode === 'split' && activeSessions.length > 1) {
                dynHtml += `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(500px, 1fr)); gap:20px; margin-top:10px;">`;
                activeSessions.forEach((s, idx) => {
                    dynHtml += `<div style="display:flex; flex-direction:column; gap:15px; background:rgba(0,0,0,0.2); border:2px dashed var(--border-color); padding:15px; border-radius:12px;">`;
                    dynHtml += this.renderActiveShell(s, idx + 1);
                    dynHtml += `</div>`;
                });
                dynHtml += `</div>`;
            } 
            // Tabbed View Logic
            else {
                const currentSession = activeSessions.find(s => s.sessionId === this.state.activeTabId);
                
                // Tabs Bar
                dynHtml += `<div style="display:flex; gap:10px; margin-top:20px; margin-bottom:15px; overflow-x:auto; padding-bottom:5px;">`;
                activeSessions.forEach((s, idx) => {
                    const isActive = this.state.activeTabId === s.sessionId ? 'background:var(--primary); color:white; box-shadow:0 4px 10px rgba(243, 112, 33, 0.3); border-color:var(--primary);' : '';
                    const groupName = s.targetGroup === 'all' ? 'All Groups' : s.targetGroup;
                    const activeCount = Object.values(s.trainees || {}).filter(t => t.status === 'started').length;

                    dynHtml += `
                    <button class="btn-secondary" onclick="App.switchTab('${s.sessionId}')" style="padding:10px 20px; text-align:left; min-width:150px; ${isActive}">
                        <div style="font-size:0.75rem; text-transform:uppercase; opacity:0.8;">Session ${idx+1}</div>
                        <div style="font-weight:bold; font-size:1.1rem; margin:5px 0;">${groupName}</div>
                        <div style="font-size:0.8rem;"><i class="fas fa-users"></i> <span id="tab_active_${s.sessionId}">${activeCount}</span> Active</div>
                    </button>`;
                });
                dynHtml += `</div>`;

                if (currentSession) {
                    dynHtml += this.renderActiveShell(currentSession);
                }
            }
        }

        // Update Shell DOM ONLY if the structural signature changes (Prevents layout flashing)
        const layoutSignature = `${this.state.viewMode}_${this.state.activeTabId}_${activeSessions.map(s => s.sessionId + s.targetGroup).join('-')}`;
        if (dynamicViews.dataset.signature !== layoutSignature) {
            dynamicViews.innerHTML = dynHtml;
            dynamicViews.dataset.signature = layoutSignature;
        }

        // Execute Precision DOM Updates for Data (Zero-Flicker)
        if (activeSessions.length > 0) {
            if (this.state.viewMode === 'split' && activeSessions.length > 1) {
                activeSessions.forEach(s => { this.updateTableRows(s); this.updateStatsUI(s); });
            } else {
                const currentSession = activeSessions.find(s => s.sessionId === this.state.activeTabId);
                if (currentSession) { this.updateTableRows(currentSession); this.updateStatsUI(currentSession); }
            }
        }
    },

    // --- HTML GENERATORS ---
    renderIdleShell: function(isCompact) {
        const isViewer = AppContext.user && AppContext.user.role === 'special_viewer';
        
        let displayStyle = isCompact ? 'display:flex; align-items:center; gap:15px; padding:15px;' : 'text-align:center; padding:50px;';
        let iconStyle = isCompact ? 'font-size:2rem; margin:0;' : 'font-size:3rem; margin-bottom:20px;';
        let formLayout = isCompact ? 'display:flex; gap:10px; align-items:flex-end; flex:1;' : 'max-width:500px; margin:0 auto; display:flex; flex-direction:column; gap:10px;';

        return `
            <div class="card" style="${displayStyle} background:rgba(0,0,0,0.1); border:1px dashed var(--primary);">
                ${isCompact ? '' : `<i class="fas fa-hammer" style="color:var(--primary); ${iconStyle}"></i>`}
                <div style="${isCompact ? 'min-width:200px;' : ''}">
                    <h3 style="margin:0; ${isCompact?'font-size:1.1rem;':''}"><i class="fas fa-rocket" style="color:var(--primary);"></i> Start Sandbox Session</h3>
                    ${isCompact ? '' : '<p style="color:var(--text-muted); margin-bottom:20px;">Select a test and group to initialize a sandboxed vetting environment.</p>'}
                </div>
                <div style="${formLayout}">
                    <div style="${isCompact ? 'flex:1;' : ''}">
                        <label style="text-align:left; font-weight:bold; font-size:0.85rem;">Select Test</label>
                        <select id="rwTestSelect" class="va-select"><option value="">Loading...</option></select>
                    </div>
                    <div style="${isCompact ? 'flex:1;' : ''}">
                        <label style="text-align:left; font-weight:bold; font-size:0.85rem;">Select Group</label>
                        <select id="rwGroupSelect" class="va-select" ${isViewer ? 'disabled' : ''}><option value="">Loading...</option></select>
                    </div>
                    <button class="btn-primary" style="height:42px; ${isCompact?'padding:0 25px;':'margin-top:10px;'}" onclick="App.startSession()" ${isViewer ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>START SESSION</button>
                </div>
            </div>
        `;
    },

    renderActiveShell: function(session, indexLabel = '') {
        const tests = DataService.getTests();
        const activeTest = tests.find(t => t.id == session.testId);
        const title = activeTest ? activeTest.title : "Unknown Test";
        const targetGroup = session.targetGroup === 'all' || !session.targetGroup ? 'All Groups' : session.targetGroup;
        const sessionTitle = indexLabel ? `Session ${indexLabel}: ${title}` : title;
        const isViewer = AppContext.user && AppContext.user.role === 'special_viewer';
        
        return `
            <div class="card" style="border-left:5px solid #2ecc71; background: linear-gradient(to right, rgba(46, 204, 113, 0.05), transparent); padding:20px; margin-bottom:15px;">
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
                    ${isViewer ? '' : `<button class="btn-danger" onclick="App.endSession('${session.sessionId}')"><i class="fas fa-stop-circle"></i> END SESSION</button>`}
                </div>
                
                <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px;">
                    <div style="text-align:center;"><div style="font-size:1.5rem; font-weight:bold;" id="stat_expected_${session.sessionId}">-</div><div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase;">Expected</div></div>
                    <div style="text-align:center;"><div style="font-size:1.5rem; font-weight:bold; color:#2ecc71;" id="stat_active_${session.sessionId}">-</div><div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase;">In Progress</div></div>
                    <div style="text-align:center;"><div style="font-size:1.5rem; font-weight:bold; color:#ff5252;" id="stat_blocked_${session.sessionId}">-</div><div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase;">Blocked</div></div>
                    <div style="text-align:center;"><div style="font-size:1.5rem; font-weight:bold; color:#3498db;" id="stat_completed_${session.sessionId}">-</div><div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase;">Completed</div></div>
                </div>
            </div>
            
            <div class="card" style="padding:0; overflow:hidden;">
                <table class="admin-table" style="margin:0;">
                    <thead>
                        <tr>
                            <th>Trainee</th>
                            <th>Status</th>
                            <th>Progress</th>
                            <th>Security Health</th>
                            <th style="text-align:right;">Controls</th>
                        </tr>
                    </thead>
                    <tbody id="vetting-monitor-body-${session.sessionId}">
                        <!-- Rows injected via updateVettingTableRows -->
                    </tbody>
                </table>
            </div>
        `;
    },

    // --- PRECISION DOM PATCHER (The Magic) ---
    updateTableRows: function(session) {
        const tbody = document.getElementById(`vetting-monitor-body-${session.sessionId}`);
        if (!tbody) return;

        const trainees = session.trainees || {};
        const rosters = DataService.getRosters();
        
        // Pre-Populate
        let displayEntries = [];
        if (session.targetGroup && session.targetGroup !== 'all') {
            const allowedMembers = rosters[session.targetGroup] || [];
            displayEntries = allowedMembers.map(user => [user, trainees[user] || { status: 'waiting' }]);
        } else {
            displayEntries = Object.entries(trainees);
        }

        if (displayEntries.length === 0) {
            if (!document.getElementById('empty-row-' + session.sessionId)) {
                tbody.innerHTML = `<tr id="empty-row-${session.sessionId}"><td colspan="5" style="text-align:center; padding:20px; color:var(--text-muted); font-style:italic;">No trainees found in this group.</td></tr>`;
            }
            return;
        }

        const emptyRow = document.getElementById('empty-row-' + session.sessionId);
        if (emptyRow) emptyRow.remove();

        // Dynamic Sort (Blocked to top)
        const statusPriority = { 'blocked': 1, 'waiting': 2, 'ready': 2, 'started': 3, 'completed': 4 };
        displayEntries.sort((a, b) => {
            const pA = statusPriority[a[1].status] || 99;
            const pB = statusPriority[b[1].status] || 99;
            if (pA !== pB) return pA - pB;
            return a[0].localeCompare(b[0]);
        });

        const currentUsers = new Set();

        displayEntries.forEach(([user, data]) => {
            currentUsers.add(user);
            let statusBadge = '<span class="status-badge status-improve"><i class="fas fa-hourglass-half"></i> Waiting</span>';
            let rowClass = '';

            if (data.status === 'started') statusBadge = '<span class="status-badge status-semi"><i class="fas fa-play"></i> In Progress</span>';
            if (data.status === 'completed') statusBadge = '<span class="status-badge status-pass"><i class="fas fa-check"></i> Completed</span>';
            if (data.status === 'ready') statusBadge = '<span class="status-badge status-pass"><i class="fas fa-thumbs-up"></i> Ready</span>';
            if (data.status === 'blocked') {
                statusBadge = data.override ? '<span class="status-badge status-improve"><i class="fas fa-unlock"></i> Override Sent</span>' : '<span class="status-badge status-fail"><i class="fas fa-ban"></i> Blocked</span>';
                rowClass = 'row-blocked';
            }
            
            // Security Column
            let securityHtml = '<span style="color:#2ecc71;"><i class="fas fa-shield-alt"></i> Secure</span>';
            if (data.status === 'waiting') securityHtml = '<span style="color:var(--text-muted);"><i class="fas fa-minus"></i> Pending Connection</span>';
            else if (data.security) {
                const issues = [];
                if (data.security.screens > 1) issues.push(`${data.security.screens} Screens`);
                if (data.security.apps && data.security.apps.length > 0) issues.push(`${data.security.apps.length} Apps`);
                
                if (issues.length > 0) {
                    securityHtml = `<span style="color:#ff5252; font-weight:bold;"><i class="fas fa-exclamation-triangle"></i> ${issues.join(', ')}</span>`;
                    if (data.security.apps.length > 0) securityHtml += `<div style="font-size:0.7rem; color:#ff5252;">${data.security.apps.join(', ')}</div>`;
                }
            }

            // Actions
            const isViewer = AppContext.user && AppContext.user.role === 'special_viewer';
            let mainAction = '';
            const safeUser = user.replace(/'/g, "\\'");
            if (data.status === 'started' && !isViewer) mainAction = `<button class="btn-danger btn-sm" onclick="App.forceSubmitTrainee('${session.sessionId}', '${safeUser}')" title="Force Stop"><i class="fas fa-stop"></i></button>`;
            else if (data.status === 'blocked' && !data.override && !isViewer) mainAction = `<button class="btn-warning btn-sm" onclick="App.overrideSecurity('${session.sessionId}', '${safeUser}')" title="Override"><i class="fas fa-key"></i></button>`;

            const isSecurityOn = !(data.relaxed === true);
            const disabledAttr = isViewer ? 'disabled' : '';
            const switchHtml = `
                <label class="switch" title="Toggle Security Rules">
                    <input type="checkbox" ${isSecurityOn ? 'checked' : ''} ${disabledAttr} onchange="App.toggleSecurity('${session.sessionId}', '${safeUser}', !this.checked)">
                    <span class="slider"></span>
                </label>`;

            // Timer Extrapolation
            let timerDisplay = '--:--';
            if (data.status === 'started' && data.startedAt) {
                const elapsed = Math.floor((Date.now() - data.startedAt) / 1000);
                const m = Math.floor(elapsed / 60);
                const s = elapsed % 60;
                timerDisplay = `<span class="vt-live-timer" data-start="${data.startedAt}" style="font-family:monospace; font-weight:bold; font-size:1.1rem; color:var(--primary);">${m}m ${s < 10 ? '0' : ''}${s}s</span>`;
            } else if (data.status === 'completed') timerDisplay = `<span style="font-family:monospace; font-weight:bold; font-size:1.1rem; color:#2ecc71;">Done</span>`;
            else if (data.timer) timerDisplay = `<span style="font-family:monospace; font-weight:bold; font-size:1.1rem;">${data.timer}</span>`;

            // DOM INJECTION
            const rowId = `vt-row-${session.sessionId}-${user.replace(/[^a-zA-Z0-9]/g, '_')}`;
            let tr = document.getElementById(rowId);
            if (!tr) {
                tr = document.createElement('tr');
                tr.id = rowId;
                tr.setAttribute('data-user', user);
                tr.innerHTML = `<td class="col-user"></td><td class="col-status"></td><td class="col-timer"></td><td class="col-sec"></td><td class="col-ctrl" style="text-align:right;"></td>`;
            }

            tbody.appendChild(tr); // Appends or reorders instantly
            if (tr.className !== rowClass) tr.className = rowClass;

            const htmlUser = `<div style="display:flex; align-items:center; gap:10px;">${getAvatarHTML(user)} <strong>${user}</strong></div>`;
            if (tr.querySelector('.col-user').innerHTML !== htmlUser) tr.querySelector('.col-user').innerHTML = htmlUser;
            if (tr.querySelector('.col-status').innerHTML !== statusBadge) tr.querySelector('.col-status').innerHTML = statusBadge;
            if (tr.querySelector('.col-timer').innerHTML !== timerDisplay) tr.querySelector('.col-timer').innerHTML = timerDisplay;
            if (tr.querySelector('.col-sec').innerHTML !== securityHtml) tr.querySelector('.col-sec').innerHTML = securityHtml;
            
            const htmlCtrl = `<div style="display:flex; align-items:center; justify-content:flex-end; gap:10px;">${switchHtml}${mainAction}</div>`;
            if (tr.querySelector('.col-ctrl').innerHTML !== htmlCtrl) tr.querySelector('.col-ctrl').innerHTML = htmlCtrl;
        });

        // Remove Stale Rows
        Array.from(tbody.querySelectorAll('tr[data-user]')).forEach(tr => {
            if (!currentUsers.has(tr.getAttribute('data-user'))) tr.remove();
        });
    },

    updateStatsUI: function(session) {
        const trainees = session.trainees || {};
        const rosters = DataService.getRosters();
        const total = (session.targetGroup && session.targetGroup !== 'all' && rosters[session.targetGroup]) ? rosters[session.targetGroup].length : Object.keys(trainees).length;
        
        const activeCount = Object.values(trainees).filter(t => t.status === 'started').length;
        const blockedCount = Object.values(trainees).filter(t => t.status === 'blocked').length;
        const completedCount = Object.values(trainees).filter(t => t.status === 'completed').length;

        const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.innerText = txt; };
        setTxt(`stat_expected_${session.sessionId}`, total);
        setTxt(`stat_active_${session.sessionId}`, activeCount);
        setTxt(`stat_blocked_${session.sessionId}`, blockedCount);
        setTxt(`stat_completed_${session.sessionId}`, completedCount);
        setTxt(`tab_active_${session.sessionId}`, activeCount);
    },

    populateDropdowns: function() {
        const tests = DataService.getTests();
        const rosters = DataService.getRosters();
        
        const testSel = document.getElementById('rwTestSelect');
        const groupSel = document.getElementById('rwGroupSelect');
        if (!testSel || !groupSel) return;

        const vettingTests = tests.filter(t => t.type === 'vetting');
        testSel.innerHTML = '<option value="">-- Select Vetting Test --</option>' + 
            (vettingTests.length > 0 ? vettingTests.map(t => `<option value="${t.id}">${t.title}</option>`).join('') : '<option disabled>No Tests Found</option>');

        groupSel.innerHTML = '<option value="all">All Groups</option>' + 
            Object.keys(rosters).sort().reverse().map(gid => `<option value="${gid}">${gid}</option>`).join('');
    },

    // --- ACTIONS ---
    setViewMode: function(mode) { this.state.viewMode = mode; this.render(); },
    switchTab: function(id) { this.state.activeTabId = id; this.render(); },

    startSession: async function() {
        if (AppContext.user && AppContext.user.role === 'special_viewer') {
            alert("Access Denied: View Only Mode.");
            return;
        }
        
        const testId = document.getElementById('rwTestSelect').value;
        const groupId = document.getElementById('rwGroupSelect').value;
        if (!testId) return alert("Select a test.");

        const activeSessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
        if (activeSessions.some(s => s.targetGroup === groupId)) {
            if(!confirm(`A session is already active for group: ${groupId}. Continue?`)) return;
        }

        const session = {
            sessionId: Date.now() + "_" + Math.random().toString(36).substr(2, 5),
            active: true, testId: testId, targetGroup: groupId,
            startTime: Date.now(), trainees: {}
        };
        
        activeSessions.push(session);
        localStorage.setItem('adminVettingSessions', JSON.stringify(activeSessions));
        this.state.activeTabId = session.sessionId;
        if (activeSessions.length > 1) this.state.viewMode = 'split';

        await DataService.saveSessionDirectly(session);
        // No render needed, realtime will trigger it
    },

    endSession: async function(sessionId) {
        if(!confirm("End this session? This will unlock the arena for trainees.")) return;
        
        let activeSessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
        const session = activeSessions.find(s => s.sessionId === sessionId);
        
        if (session) {
            session.active = false;
            await DataService.deleteSession(sessionId); // Now async
        }
        
        activeSessions = activeSessions.filter(s => s.sessionId !== sessionId);
        localStorage.setItem('adminVettingSessions', JSON.stringify(activeSessions));
        if (this.state.activeTabId === sessionId) this.state.activeTabId = null;
        
        this.render();
    },

    forceSubmitTrainee: async function(sessionId, username) {
        if(!confirm(`Force submit and kick ${username}?`)) return;
        await this.patchUser(sessionId, username, { status: 'completed' });
    },

    overrideSecurity: async function(sessionId, username) {
        if(!confirm(`Override security blocks for ${username}?`)) return;
        await this.patchUser(sessionId, username, { override: true, status: 'ready' });
    },

    toggleSecurity: async function(sessionId, username, enable) {
        await this.patchUser(sessionId, username, { relaxed: enable });
    },

    patchUser: async function(sessionId, username, patchData) {
        let activeSessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
        const session = activeSessions.find(s => s.sessionId === sessionId);
        if (!session) return;

        if (!session.trainees[username]) session.trainees[username] = {};
        session.trainees[username] = { ...session.trainees[username], ...patchData };
        
        // 1. Optimistic Local Update (Instant Visual Feedback)
        localStorage.setItem('adminVettingSessions', JSON.stringify(activeSessions));
        this.render(); 
        
        // 2. Safe Server Patch (Prevents race conditions)
        await DataService.patchSessionUser(sessionId, username, patchData);
    },

    // --- TRAINEE SECURITY ACTIONS ---
    stopTraineePollers: function() {
        if (this.state.localPoller) clearInterval(this.state.localPoller);
        this.state.localPoller = null;
    },

    startTraineePreFlight: function() {
        this.stopTraineePollers();
        this.checkSystemCompliance();
        // Poll every 2s for background app closures
        this.state.localPoller = setInterval(() => this.checkSystemCompliance(), 2000);
    },

    startActiveTestMonitoring: function() {
        this.stopTraineePollers();
        // Aggressive polling during active test
        this.state.localPoller = setInterval(() => this.checkActiveSecurity(), 3000);
    },

    checkSystemCompliance: async function() {
        if (this.state.isCheckingCompliance) return;
        this.state.isCheckingCompliance = true;
        
        try {
            const session = this.state.traineeSession;
            if (!session) return;
            
            const myData = session.trainees ? session.trainees[AppContext.user.user] : null;
            const isOverridden = myData && myData.override;
            const isRelaxed = myData && myData.relaxed;
            
            let errors = [];
            
            // Call the core Electron IPC (Inherits WhatsApp/Edge logic automatically)
            if (!isRelaxed && typeof require !== 'undefined') {
                const { ipcRenderer } = require('electron');
                const screenCount = await ipcRenderer.invoke('get-screen-count');
                if (screenCount > 1) errors.push(`Multiple Monitors Detected (${screenCount}). Unplug external screens.`);
                
                const forbidden = JSON.parse(localStorage.getItem('forbiddenApps') || '[]');
                const apps = await ipcRenderer.invoke('get-process-list', forbidden.length > 0 ? forbidden : null);
                if (apps.length > 0) errors.push(`Forbidden Apps Running: ${apps.join(', ')}`);
            }

            const logBox = document.getElementById('sandboxSecurityLog');
            const btn = document.getElementById('btnEnterSandbox');
            if (!logBox || !btn) return;

            let status = 'ready';
            if (errors.length > 0 && !isOverridden && !isRelaxed) status = 'blocked';

            if (errors.length === 0) {
                logBox.innerHTML = `<div style="color:#2ecc71; font-weight:bold;"><i class="fas fa-check-circle" style="font-size:1.5rem; vertical-align:middle; margin-right:10px;"></i> System Secure. Ready to start.</div>`;
                btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; btn.style.animation = 'pulse 2s infinite';
            } else if (isOverridden) {
                logBox.innerHTML = `<div style="color:#f1c40f; font-weight:bold; margin-bottom:10px;"><i class="fas fa-exclamation-triangle"></i> Admin Override Active</div>` + errors.map(e => `<div style="color:var(--text-muted); font-size:0.85rem;">- ${e} (Ignored)</div>`).join('');
                btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; btn.style.animation = 'none';
            } else {
                logBox.innerHTML = errors.map(e => `<div style="color:#ff5252; padding:5px 0;"><i class="fas fa-ban"></i> ${e}</div>`).join('');
                btn.disabled = true; btn.style.opacity = '0.5'; btn.style.cursor = 'not-allowed'; btn.style.animation = 'none';
            }

            // Auto-report status change to Admin
            if (!myData || myData.status !== status) {
                await DataService.patchSessionUser(session.sessionId, AppContext.user.user, { status: status });
            }

        } finally {
            this.state.isCheckingCompliance = false;
        }
    },

    checkActiveSecurity: async function() {
        const session = this.state.traineeSession;
        const myData = session.trainees ? session.trainees[AppContext.user.user] : null;
        if (myData && myData.relaxed) return; // Admin dropped shields mid-test

        if (typeof require !== 'undefined') {
            const { ipcRenderer } = require('electron');
            
            // Ensure shields stay up
            ipcRenderer.invoke('set-kiosk-mode', true).catch(()=>{});
            
            const forbidden = JSON.parse(localStorage.getItem('forbiddenApps') || '[]');
            const apps = await ipcRenderer.invoke('get-process-list', forbidden.length > 0 ? forbidden : null);
            
            if (apps.length > 0) {
                this.state.securityWarningCount++;
                // 4 strikes (~12 seconds) before kick
                if (this.state.securityWarningCount >= 4) {
                    alert("Security Violation: Background App Detected. Test Terminated.");
                    this.exitArena();
                }
            } else {
                this.state.securityWarningCount = 0; // Forgive if they close it quickly
            }
        }
    },

    enterArena: async function() {
        this.stopTraineePollers(); // Stop pre-flight
        if (typeof require !== 'undefined') {
            const { ipcRenderer } = require('electron');
            await ipcRenderer.invoke('set-kiosk-mode', true);
            await ipcRenderer.invoke('set-content-protection', true);
        }
        await DataService.patchSessionUser(this.state.traineeSession.sessionId, AppContext.user.user, { status: 'started', startedAt: Date.now() });
        this.renderTrainee(); // Render active view
    },

    exitArena: async function() {
        this.stopTraineePollers();
        if (typeof require !== 'undefined') {
            const { ipcRenderer } = require('electron');
            await ipcRenderer.invoke('set-kiosk-mode', false);
            await ipcRenderer.invoke('set-content-protection', false);
        }
        await DataService.patchSessionUser(this.state.traineeSession.sessionId, AppContext.user.user, { status: 'completed' });
        this.renderTrainee(); // Render completion screen
    }
};

// Boot when ready
window.onload = () => App.init();
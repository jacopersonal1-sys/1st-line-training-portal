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
        fallbackPollTick: null,
        // --- NEW: Trainee State ---
        traineeSession: null,
        isCheckingCompliance: false,
        securityWarningCount: 0,
        localPoller: null,
        complianceConsecutiveErrors: 0,
        complianceConsecutivePasses: 0,
        lastEnterAttempt: 0,
        preflightScanRateMs: 2000,
        preflightSessionKey: ''
    },

    shouldRenderTraineeSession: function(previousSession, nextSession) {
        const existingShell = document.getElementById('btnEnterSandbox') ||
            document.getElementById('sandbox-active-card') ||
            document.getElementById('sandbox-terminal-card') ||
            document.getElementById('sandbox-submitting-card') ||
            document.getElementById('sandbox-closed-card');
        if (!existingShell) return true;
        if (!previousSession || !nextSession) return true;
        if (previousSession.sessionId !== nextSession.sessionId) return true;
        if (previousSession.testId !== nextSession.testId) return true;
        if (previousSession.targetGroup !== nextSession.targetGroup) return true;

        const previousData = this.getMyTraineeData(previousSession);
        const nextData = this.getMyTraineeData(nextSession);
        const previousStatus = String((previousData && previousData.status) || '').toLowerCase();
        const nextStatus = String((nextData && nextData.status) || '').toLowerCase();
        return previousStatus !== nextStatus;
    },

    resolveCurrentUser: function() {
        if (AppContext.user && AppContext.user.user) return AppContext.user;
        if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.user) return CURRENT_USER;
        if (window.CURRENT_USER && window.CURRENT_USER.user) return window.CURRENT_USER;
        return null;
    },

    getMyUsername: function() {
        const user = this.resolveCurrentUser();
        return user && user.user ? user.user : '';
    },

    readJson: function(key, fallback) {
        if (typeof safeLocalParse === 'function') return safeLocalParse(key, fallback);
        try {
            const raw = localStorage.getItem(key);
            if (raw === null || raw === undefined || raw === '' || raw === 'undefined' || raw === 'null') return fallback;
            return JSON.parse(raw);
        } catch (e) {
            console.warn(`[Vetting Arena] ignored invalid local data for ${key}:`, e);
            return fallback;
        }
    },

    readArray: function(key) {
        const value = this.readJson(key, []);
        return Array.isArray(value) ? value : [];
    },

    readObject: function(key) {
        const value = this.readJson(key, {});
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    },

    getMyTraineeData: function(session) {
        if (!session || !session.trainees) return null;
        const username = this.getMyUsername();
        if (!username) return null;
        if (session.trainees[username]) return session.trainees[username];
        const matchingKeys = Object.keys(session.trainees).filter(k => this.identitiesMatch(k, username));
        if (!matchingKeys.length) return null;
        const nonCompleted = matchingKeys.find(k => {
            const st = String((session.trainees[k] && session.trainees[k].status) || '').toLowerCase();
            return st !== 'completed';
        });
        const matchKey = nonCompleted || matchingKeys[0];
        return matchKey ? session.trainees[matchKey] : null;
    },

    init: async function() {
        const container = document.getElementById('app-container');
        try {
        this.shutdown(false);
        container.innerHTML = '<div style="text-align:center; padding:50px; color:var(--text-muted);"><i class="fas fa-circle-notch fa-spin fa-2x" style="color:var(--primary); margin-bottom:15px;"></i><h3>Booting Sandbox...</h3></div>';

        await DataService.loadInitialData();

        // Route user based on role
        const user = this.resolveCurrentUser();
        if (user && user.role === 'trainee') {
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
            // BATCH RENDER: Prevent UI Freeze on mass trainee connections
            if (realtimeRenderDebounce) clearTimeout(realtimeRenderDebounce);
            realtimeRenderDebounce = setTimeout(async () => {
                if (payload.eventType === 'DELETE' && this.state.activeTabId === payload.old.id) this.state.activeTabId = null;
                if (payload.new && payload.new.data && payload.new.data.active === false && typeof DataService.markSessionEnded === 'function') {
                    DataService.markSessionEnded(payload.new.data.sessionId);
                }
                await DataService.pollSessions();
                this.render();
            }, 100);
        });

        // 4. Hard backup poller - keeps sessions moving even if realtime tunnel degrades.
        this.startFallbackPolling(async () => {
            await DataService.pollSessions();
            await DataService.flushPendingOps();
            this.render();
        });
    },

    normalizeIdentity: function(value) {
        let v = String(value || '').trim().toLowerCase();
        if (!v) return '';
        if (v.includes('@')) v = v.split('@')[0];
        v = v.replace(/[._-]+/g, ' ');
        v = v.replace(/\s+/g, ' ').trim();
        return v;
    },

    identitiesMatch: function(a, b) {
        const na = this.normalizeIdentity(a);
        const nb = this.normalizeIdentity(b);
        if (!na || !nb) return false;
        if (na === nb) return true;
        return na.replace(/\s+/g, '') === nb.replace(/\s+/g, '');
    },

    withTimeout: function(promise, timeoutMs, label) {
        return Promise.race([
            Promise.resolve(promise),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`${label || 'Operation'} timed out`)), timeoutMs);
            })
        ]);
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

        // Backup poller for guaranteed continuity if realtime events pause.
        this.startFallbackPolling(async () => {
            const sessions = await DataService.pollSessions();
            await DataService.flushPendingOps();
            this.processTraineeSessions(sessions);
        });
    },

    startFallbackPolling: function(taskFn) {
        if (this.state.fallbackPollTick) clearInterval(this.state.fallbackPollTick);
        this.state.fallbackPollTick = setInterval(() => {
            Promise.resolve(taskFn()).catch(() => {});
        }, 1000);
    },

    shutdown: function(stopRetry = true) {
        if (this.state.timerTick) clearInterval(this.state.timerTick);
        this.state.timerTick = null;

        if (this.state.fallbackPollTick) clearInterval(this.state.fallbackPollTick);
        this.state.fallbackPollTick = null;

        this.stopTraineePollers();

        if (typeof this.state.realtimeUnsub === 'function') {
            try { this.state.realtimeUnsub(); } catch (e) {}
        }
        this.state.realtimeUnsub = null;

        if (stopRetry && typeof DataService !== 'undefined' && typeof DataService.stopRetryLoop === 'function') {
            DataService.stopRetryLoop();
        }
    },

    processTraineeSessions: function(sessions) {
        const myName = this.getMyUsername();
        if (!myName) return;
        const rosters = DataService.getRosters();
        
        let mySession = null;
        for (const s of sessions) {
            let isTarget = false;
            if (!s.targetGroup || s.targetGroup === 'all') isTarget = true;
            else {
                const members = rosters[s.targetGroup] || [];
                if (members.some(m => this.identitiesMatch(m, myName))) isTarget = true;
            }
            if (isTarget) { mySession = s; break; }
        }

        const previousSession = this.state.traineeSession;
        this.state.traineeSession = mySession;
        if (this.shouldRenderTraineeSession(previousSession, mySession)) {
            this.renderTrainee();
        }
    },

    renderTrainee: function() {
        const container = document.getElementById('va-trainee-view');
        if (!container) return;

        if (!this.state.traineeSession) {
            this.stopTraineePollers();
            container.innerHTML = `
                <div id="sandbox-closed-card" class="vt-trainee-state vt-trainee-state--idle">
                    <i class="fas fa-door-closed"></i>
                    <h3>Arena Closed</h3>
                    <p>There is no active Sandbox session for your group.</p>
                </div>`;
            return;
        }

        const session = this.state.traineeSession;
        const myData = this.getMyTraineeData(session);

        if (myData && myData.status === 'completed') {
            this.stopTraineePollers();
            container.innerHTML = `
                <div id="sandbox-terminal-card" class="vt-trainee-state vt-trainee-state--complete">
                    <i class="fas fa-lock"></i>
                    <h3>Assessment Submitted</h3>
                    <p>Your sandbox test has been securely submitted.</p>
                </div>`;
            return;
        }

        if (myData && myData.status === 'submitting') {
            this.stopTraineePollers();
            const gateReason = myData.completionGate && myData.completionGate.reason
                ? myData.completionGate.reason
                : 'Verifying server-side submission and record state.';
            container.innerHTML = `
                <div id="sandbox-submitting-card" class="vt-trainee-state vt-trainee-state--syncing">
                    <i class="fas fa-cloud-upload-alt"></i>
                    <h3>Submission Sync In Progress</h3>
                    <p>Please stay on this screen while final sync checks complete.</p>
                    <div class="vt-trainee-pill vt-trainee-pill--sync">
                        <i class="fas fa-circle-notch fa-spin"></i> ${gateReason}
                    </div>
                </div>`;
            return;
        }

        if (myData && myData.status === 'started') {
            // Kiosk In-Progress View
            container.innerHTML = `
                <div id="sandbox-active-card" class="vt-trainee-active-card">
                    <div class="vt-trainee-active-icon"><i class="fas fa-hammer"></i></div>
                    <h2>Sandbox Test Active</h2>
                    <p>You are locked in the Sandbox Arena. Security monitors are active.</p>
                    <button class="btn-danger btn-lg" onclick="App.exitArena()">Submit & Exit Sandbox</button>
                </div>`;
            this.startActiveTestMonitoring();
            return;
        }

        // Pre-Flight (Waiting/Ready/Blocked)
        const tests = DataService.getTests();
        const test = tests.find(t => t.id == session.testId);

        container.innerHTML = `
            <div id="sandbox-preflight-card" class="vt-trainee-preflight">
                <div class="vt-trainee-kicker"><i class="fas fa-shield-alt"></i> Secure Vetting Entry</div>
                <h2>Sandbox Assessment Ready</h2>
                <h3>${this.escapeHtml(test ? test.title : 'Assessment')}</h3>
                <div class="vt-protocol-list">
                    <span><i class="fas fa-display"></i> Single screen</span>
                    <span><i class="fas fa-lock"></i> Kiosk lock</span>
                    <span><i class="fas fa-eye"></i> App scan</span>
                </div>
                <div class="vt-preflight-log-wrap">
                    <div id="sandboxSecurityLog" class="vt-security-log">
                        <div class="vt-scan-row"><i class="fas fa-circle-notch fa-spin"></i> Scanning system...</div>
                    </div>
                </div>

                <button id="btnEnterSandbox" class="btn-primary btn-lg vt-enter-btn" disabled onclick="App.enterArena()">ENTER SANDBOX KIOSK</button>
            </div>
        `;
        
        this.startTraineePreFlight();
    },

    // --- RENDER ENGINE ---
    render: function() {
        const staticForm = document.getElementById('va-static-form');
        const dynamicViews = document.getElementById('va-dynamic-views');
        
        if (!staticForm || !dynamicViews) return;

        const activeSessions = this.readArray('adminVettingSessions');
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
                    const groupName = this.formatGroupName(s.targetGroup || 'all');
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
    escapeHtml: function(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    normalizeTestTitle: function(value) {
        return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    },

    getVettingTestStage: function(test) {
        const title = this.normalizeTestTitle(test && (test.title || test.name));
        if (title.includes('final') || title.includes('test 2') || title.includes('second vetting')) return 'final';
        if (title.includes('1st') || title.includes('first') || title.includes('test 1')) return 'first';
        return 'other';
    },

    getVettingStageLabel: function(stage) {
        if (stage === 'first') return '1st Vetting';
        if (stage === 'final') return 'Final Vetting';
        return 'Other Vetting';
    },

    formatGroupName: function(groupId) {
        const raw = String(groupId || '').trim();
        if (!raw || raw === 'all') return 'All Groups';
        const match = raw.match(/^(\d{4})-(\d{2})(?:-([A-Za-z0-9]+))?$/);
        if (!match) return raw;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const suffix = match[3] ? ` Group ${match[3]}` : '';
        const date = new Date(year, month - 1, 1);
        const monthName = date.toLocaleString('en-ZA', { month: 'long' });
        return `${monthName} ${year}${suffix}`;
    },

    getGroupMembers: function(groupId) {
        const rosters = DataService.getRosters();
        if (!groupId || groupId === 'all') {
            return DataService.getUsers()
                .filter(user => String((user && user.role) || '').toLowerCase() === 'trainee')
                .map(user => String(user.user || '').trim())
                .filter(Boolean);
        }
        const members = Array.isArray(rosters[groupId]) ? rosters[groupId] : [];
        return members.map(member => String(member || '').trim()).filter(Boolean);
    },

    renderGroupOptionLabel: function(groupId) {
        const members = this.getGroupMembers(groupId);
        const preview = members.slice(0, 3).join(', ');
        const extra = members.length > 3 ? `, +${members.length - 3} more` : '';
        const memberText = members.length ? ` - ${members.length}: ${preview}${extra}` : ' - no trainees';
        return `${this.formatGroupName(groupId)}${memberText}`;
    },

    getCompletedMembersForTest: function(groupId, test) {
        const members = this.getGroupMembers(groupId);
        const memberTokens = new Set(members.map(member => DataService.normalizeIdentity(member)).filter(Boolean));
        const completed = new Set();
        const testId = String(test && test.id || '');
        const testTitle = this.normalizeTestTitle(test && (test.title || test.name));
        const titleMatches = (value) => {
            const normalized = this.normalizeTestTitle(value);
            return !!normalized && normalized === testTitle;
        };

        this.readArray('records').forEach(record => {
            if (!record) return;
            const trainee = DataService.normalizeIdentity(record.trainee);
            if (!memberTokens.has(trainee)) return;
            if (groupId && groupId !== 'all' && record.groupID && String(record.groupID) !== String(groupId)) return;
            if (titleMatches(record.assessment) || String(record.testId || '') === testId) {
                completed.add(trainee);
            }
        });

        this.readArray('submissions').forEach(submission => {
            if (!submission || String(submission.status || '').toLowerCase() !== 'completed' || submission.archived) return;
            const trainee = DataService.normalizeIdentity(submission.trainee);
            if (!memberTokens.has(trainee)) return;
            if (String(submission.testId || '') === testId || titleMatches(submission.testTitle)) {
                completed.add(trainee);
            }
        });

        return completed;
    },

    renderVettingTrackerHtml: function(groupId, selectedTestId = '') {
        const tests = DataService.getTests().filter(t => t && t.type === 'vetting');
        const members = this.getGroupMembers(groupId);
        const grouped = { first: [], final: [], other: [] };
        tests.forEach(test => grouped[this.getVettingTestStage(test)].push(test));

        const renderBucket = (stage) => {
            const rows = grouped[stage].map(test => {
                const done = this.getCompletedMembersForTest(groupId, test);
                const total = members.length;
                const isSelected = String(test.id || '') === String(selectedTestId || '');
                const statusClass = total > 0 && done.size >= total ? 'complete' : (done.size > 0 ? 'partial' : 'empty');
                const missing = members.filter(member => !done.has(DataService.normalizeIdentity(member)));
                const detail = total === 0
                    ? 'No trainees in group'
                    : `${done.size}/${total} completed${missing.length ? ` - missing: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? `, +${missing.length - 4}` : ''}` : ''}`;
                return `
                    <div class="vt-tracker-row ${statusClass} ${isSelected ? 'selected' : ''}">
                        <div>
                            <strong>${this.escapeHtml(test.title || test.name || 'Untitled Vetting')}</strong>
                            <div>${this.escapeHtml(detail)}</div>
                        </div>
                        <span>${total ? Math.round((done.size / total) * 100) : 0}%</span>
                    </div>`;
            }).join('');

            return `
                <div class="vt-tracker-bucket">
                    <h4>${this.getVettingStageLabel(stage)}</h4>
                    ${rows || '<div class="vt-tracker-empty">No tests in this section.</div>'}
                </div>`;
        };

        const groupTitle = this.formatGroupName(groupId);
        const people = members.length
            ? `${members.length} trainees: ${members.slice(0, 6).join(', ')}${members.length > 6 ? `, +${members.length - 6} more` : ''}`
            : 'No trainees found for this group.';

        return `
            <div class="vt-selection-intel">
                <div class="vt-selection-head">
                    <div>
                        <strong>${this.escapeHtml(groupTitle)}</strong>
                        <span>${this.escapeHtml(people)}</span>
                    </div>
                    <div class="vt-selection-note">Use this to avoid repeating the wrong vetting stage.</div>
                </div>
                <div class="vt-tracker-grid">
                    ${renderBucket('first')}
                    ${renderBucket('final')}
                    ${renderBucket('other')}
                </div>
            </div>`;
    },

    refreshSelectionIntel: function() {
        const groupSel = document.getElementById('rwGroupSelect');
        const testSel = document.getElementById('rwTestSelect');
        const host = document.getElementById('rwSelectionIntel');
        if (!groupSel || !testSel || !host) return;
        host.innerHTML = this.renderVettingTrackerHtml(groupSel.value || 'all', testSel.value || '');
    },

    renderIdleShell: function(isCompact) {
        const isViewer = AppContext.user && AppContext.user.role === 'special_viewer';
        const runtimeLabel = AppContext.mode === 'production' ? 'Vetting Arena 2.0' : 'Sandbox';
        
        let displayStyle = isCompact ? 'padding:15px;' : 'text-align:center; padding:50px;';
        let iconStyle = isCompact ? 'font-size:2rem; margin:0;' : 'font-size:3rem; margin-bottom:20px;';
        let formLayout = isCompact ? 'display:flex; gap:10px; align-items:flex-end; flex:1;' : 'max-width:500px; margin:0 auto; display:flex; flex-direction:column; gap:10px;';

        return `
            <div class="vt-launch-card ${isCompact ? 'is-compact' : ''}" style="${displayStyle}">
                ${isCompact ? '' : `<i class="fas fa-hammer" style="color:var(--primary); ${iconStyle}"></i>`}
                <div style="${isCompact ? 'min-width:200px;' : ''}">
                    <div class="vt-admin-kicker"><i class="fas fa-shield-halved"></i> Controlled Exam Runtime</div>
                    <h3 style="margin:0; ${isCompact?'font-size:1.1rem;':''}">Start ${runtimeLabel} Session</h3>
                    ${isCompact ? '' : '<p style="color:var(--text-muted); margin-bottom:20px;">Select a test and group to initialize the vetting runtime with strict security rules.</p>'}
                </div>
                <div style="${formLayout}">
                    <div style="${isCompact ? 'flex:1;' : ''}">
                        <label style="text-align:left; font-weight:bold; font-size:0.85rem;">Select Test</label>
                        <select id="rwTestSelect" class="va-select" onchange="App.refreshSelectionIntel()"><option value="">Loading...</option></select>
                    </div>
                    <div style="${isCompact ? 'flex:1;' : ''}">
                        <label style="text-align:left; font-weight:bold; font-size:0.85rem;">Select Group</label>
                        <select id="rwGroupSelect" class="va-select" onchange="App.refreshSelectionIntel()" ${isViewer ? 'disabled' : ''}><option value="">Loading...</option></select>
                    </div>
                    <button class="btn-primary" style="height:42px; ${isCompact?'padding:0 25px;':'margin-top:10px;'}" onclick="App.startSession()" ${isViewer ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>START SESSION</button>
                </div>
                <div id="rwSelectionIntel" class="vt-selection-intel-host"></div>
            </div>
        `;
    },

    renderActiveShell: function(session, indexLabel = '') {
        const tests = DataService.getTests();
        const activeTest = tests.find(t => t.id == session.testId);
        const title = activeTest ? activeTest.title : "Unknown Test";
        const targetGroup = this.formatGroupName(session.targetGroup || 'all');
        const sessionTitle = indexLabel ? `Session ${indexLabel}: ${title}` : title;
        const isViewer = AppContext.user && AppContext.user.role === 'special_viewer';
        
        return `
            <div class="vt-session-card">
                <div class="vt-session-header">
                    <div class="vt-session-title-wrap">
                        <div class="vt-session-icon">
                            <i class="fas fa-shield-alt"></i>
                        </div>
                        <div>
                            <div class="vt-admin-kicker">Live Vetting Session</div>
                            <h3>${this.escapeHtml(sessionTitle)} <span class="pulse-dot" title="Live Session Active"></span></h3>
                            <p>Target: <strong>${this.escapeHtml(targetGroup)}</strong></p>
                        </div>
                    </div>
                    ${isViewer ? '' : `<button class="btn-danger" onclick="App.endSession('${session.sessionId}')"><i class="fas fa-stop-circle"></i> END SESSION</button>`}
                </div>
                
                <div class="vt-session-stats">
                    <div><div id="stat_expected_${session.sessionId}">-</div><span>Expected</span></div>
                    <div><div class="stat-active" id="stat_active_${session.sessionId}">-</div><span>In Progress</span></div>
                    <div><div class="stat-blocked" id="stat_blocked_${session.sessionId}">-</div><span>Blocked</span></div>
                    <div><div class="stat-complete" id="stat_completed_${session.sessionId}">-</div><span>Completed</span></div>
                </div>
            </div>
            
            <div class="vt-monitor-card">
                <div class="vt-monitor-toolbar">
                    <strong><i class="fas fa-desktop"></i> Live Monitor</strong>
                    <button class="btn-secondary btn-sm" onclick="App.forceRefreshSession('${session.sessionId}')"><i class="fas fa-sync"></i> Force Refresh</button>
                </div>
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
        const statusPriority = { 'blocked': 1, 'waiting': 2, 'ready': 2, 'started': 3, 'submitting': 4, 'completed': 5 };
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
            if (data.status === 'submitting') statusBadge = '<span class="status-badge status-improve"><i class="fas fa-cloud-upload-alt"></i> Syncing</span>';
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
            const refreshBtn = isViewer ? '' : `<button class="btn-secondary btn-sm" onclick="App.forceRefreshTrainee('${safeUser}')" title="Force Trainee App Refresh"><i class="fas fa-sync"></i></button>`;

            // Timer Extrapolation
            let timerDisplay = '--:--';
            if (data.status === 'started' && data.startedAt) {
                const elapsed = Math.floor((Date.now() - data.startedAt) / 1000);
                const m = Math.floor(elapsed / 60);
                const s = elapsed % 60;
                timerDisplay = `<span class="vt-live-timer" data-start="${data.startedAt}" style="font-family:monospace; font-weight:bold; font-size:1.1rem; color:var(--primary);">${m}m ${s < 10 ? '0' : ''}${s}s</span>`;
            } else if (data.status === 'submitting') {
                timerDisplay = `<span style="font-family:monospace; font-weight:bold; font-size:1.1rem; color:#3498db;">Syncing...</span>`;
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
            
            const excludeBtn = isViewer ? '' : `<button class="btn-outline btn-sm" onclick="App.excludeTrainee('${session.sessionId}', '${safeUser}')" title="Exclude"><i class="fas fa-user-times"></i></button>`;
            const htmlCtrl = `<div style="display:flex; align-items:center; justify-content:flex-end; gap:10px;">${switchHtml}${refreshBtn}${excludeBtn}${mainAction}</div>`;
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
        const buckets = { first: [], final: [], other: [] };
        vettingTests.forEach(test => buckets[this.getVettingTestStage(test)].push(test));
        const renderTestOptions = (stage) => {
            const options = buckets[stage]
                .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))
                .map(t => `<option value="${this.escapeHtml(t.id)}">${this.escapeHtml(t.title || t.name || 'Untitled Vetting')}</option>`)
                .join('');
            return options ? `<optgroup label="${this.getVettingStageLabel(stage)}">${options}</optgroup>` : '';
        };

        testSel.innerHTML = '<option value="">-- Select Vetting Test --</option>' +
            (vettingTests.length > 0
                ? `${renderTestOptions('first')}${renderTestOptions('final')}${renderTestOptions('other')}`
                : '<option disabled>No Tests Found</option>');

        groupSel.innerHTML = `<option value="all">${this.escapeHtml(this.renderGroupOptionLabel('all'))}</option>` +
            Object.keys(rosters)
                .sort()
                .reverse()
                .map(gid => `<option value="${this.escapeHtml(gid)}">${this.escapeHtml(this.renderGroupOptionLabel(gid))}</option>`)
                .join('');
        this.refreshSelectionIntel();
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

        const activeSessions = this.readArray('adminVettingSessions');
        if (activeSessions.some(s => s.targetGroup === groupId)) {
            if(!confirm(`A session is already active for group: ${groupId}. Continue?`)) return;
        }

        const seededTrainees = {};
        DataService.resolveSessionTargets({ targetGroup: groupId }).forEach(username => {
            if (username) seededTrainees[username] = { status: 'waiting' };
        });

        const session = {
            sessionId: Date.now() + "_" + Math.random().toString(36).substr(2, 5),
            active: true, testId: testId, targetGroup: groupId,
            startTime: Date.now(), trainees: seededTrainees
        };
        
        activeSessions.push(session);
        localStorage.setItem('adminVettingSessions', JSON.stringify(activeSessions));
        this.state.activeTabId = session.sessionId;
        if (activeSessions.length > 1) this.state.viewMode = 'split';

        const savedLive = await DataService.saveSessionDirectly(session);
        if (savedLive === false) {
            alert("Vetting session was saved locally but could not be confirmed on the server. Trainees may not see it until the connection recovers.");
        } else {
            await DataService.nudgeTraineesForSession(session);
        }
        // No render needed, realtime will trigger it
    },

    endSession: async function(sessionId) {
        if(!confirm("End this session? This will unlock the arena for trainees.")) return;
        
        let activeSessions = this.readArray('adminVettingSessions');
        const session = activeSessions.find(s => s.sessionId === sessionId);
        
        if (session) {
            session.active = false;
            if (typeof DataService.markSessionEnded === 'function') DataService.markSessionEnded(sessionId);
            try {
                await DataService.saveSessionDirectly(session);
                await DataService.nudgeTraineesForSessionEnd(session);
                await DataService.flushPendingOps();
            } catch (e) {
                console.warn('End-session nudge failed:', e);
            }
            const deletedLive = await DataService.deleteSession(sessionId); // Now async
            if (deletedLive === false) {
                alert("Session ended locally, but the server delete is queued. Trainees may remain locked until sync recovers or you force refresh.");
            }
        }
        
        activeSessions = activeSessions.filter(s => s.sessionId !== sessionId);
        localStorage.setItem('adminVettingSessions', JSON.stringify(activeSessions));
        if (this.state.activeTabId === sessionId) this.state.activeTabId = null;
        
        this.render();
    },

    forceSubmitTrainee: async function(sessionId, username) {
        if(!confirm(`Force submit and kick ${username}?`)) return;
        await this.patchUser(sessionId, username, {
            status: 'submitting',
            forcedSubmitAt: Date.now(),
            completionGate: {
                pending: true,
                reason: 'Admin forced submit. Waiting for trainee app to upload submission evidence.',
                checkedAt: Date.now()
            }
        });
        if (typeof DataService.nudgeTrainee === 'function') {
            try {
                await DataService.nudgeTrainee(username, `vetting_submit:${encodeURIComponent(sessionId)}`);
            } catch (e) {
                console.warn('Force-submit nudge failed:', e);
            }
        }
    },

    overrideSecurity: async function(sessionId, username) {
        if(!confirm(`Override security blocks for ${username}?`)) return;
        await this.patchUser(sessionId, username, { override: true, status: 'ready' });
    },

    toggleSecurity: async function(sessionId, username, enable) {
        await this.patchUser(sessionId, username, { relaxed: enable });
    },

    forceRefreshSession: async function(sessionId) {
        const sessions = this.readArray('adminVettingSessions');
        const session = sessions.find(s => s.sessionId === sessionId);
        if (!session) return;
        try {
            await DataService.saveSessionDirectly(session);
            await DataService.flushPendingOps();
            // Nudge trainees so their runtimes refresh immediately
            if (typeof DataService.nudgeTraineesForSession === 'function') {
                try { await DataService.nudgeTraineesForSession(session); } catch(e) { /* best-effort */ }
            }
            this.render();
        } catch (e) {
            console.warn("Force refresh failed:", e);
        }
    },

    forceRefreshTrainee: function(username) {
        if (typeof sendRemoteCommand === 'function') {
            sendRemoteCommand(username, 'restart');
        }
    },

    patchUser: async function(sessionId, username, patchData) {
        let activeSessions = this.readArray('adminVettingSessions');
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

    excludeTrainee: async function(sessionId, username) {
        if(!confirm(`Exclude ${username} from this session?`)) return;
        let activeSessions = this.readArray('adminVettingSessions');
        const session = activeSessions.find(s => s.sessionId === sessionId);
        if (!session) return;

        // Remove direct key and any alias keys that match
        if (session.trainees && session.trainees[username]) delete session.trainees[username];
        Object.keys(session.trainees || {}).forEach(k => {
            if (k !== username && App.identitiesMatch(k, username)) delete session.trainees[k];
        });

        localStorage.setItem('adminVettingSessions', JSON.stringify(activeSessions));

        try {
            await DataService.saveSessionDirectly(session);
            // Nudge excluded trainee so their client updates immediately
            if (typeof DataService.nudgeTrainee === 'function') {
                try { await DataService.nudgeTrainee(username, `vetting_exclude:${encodeURIComponent(sessionId)}`); } catch(e) {}
            }
            await DataService.flushPendingOps();
        } catch (e) {
            console.warn('Exclude failed:', e);
        }

        this.render();
    },

    // --- TRAINEE SECURITY ACTIONS ---
    stopTraineePollers: function() {
        if (this.state.localPoller) clearInterval(this.state.localPoller);
        this.state.localPoller = null;
    },

    setPreFlightPollerInterval: function(intervalMs) {
        const nextRate = Number(intervalMs) > 0 ? Number(intervalMs) : 2000;
        if (this.state.localPoller) clearInterval(this.state.localPoller);
        this.state.localPoller = setInterval(() => this.checkSystemCompliance().catch(() => {}), nextRate);
        this.state.preflightScanRateMs = nextRate;
    },

    startTraineePreFlight: function() {
        const PREFLIGHT_FAST_SCAN_MS = 2000;
        this.stopTraineePollers();
        const sessionKey = String((this.state.traineeSession && this.state.traineeSession.sessionId) || '');
        if (this.state.preflightSessionKey !== sessionKey) {
            this.state.preflightSessionKey = sessionKey;
            this.state.complianceConsecutiveErrors = 0;
            this.state.complianceConsecutivePasses = 0;
        }
        this.setPreFlightPollerInterval(PREFLIGHT_FAST_SCAN_MS);
        this.checkSystemCompliance().catch(() => {});
    },

    startActiveTestMonitoring: function() {
        this.stopTraineePollers();
        // Aggressive polling during active test
        this.state.complianceConsecutiveErrors = 0;
        this.state.complianceConsecutivePasses = 0;
        this.state.preflightSessionKey = '';
        this.state.preflightScanRateMs = 2000;
        this.state.localPoller = setInterval(() => this.checkActiveSecurity(), 3000);
    },

    checkSystemCompliance: async function(options = {}) {
        if (this.state.isCheckingCompliance) return;
        this.state.isCheckingCompliance = true;
        
        try {
            const strictMode = !!(options && options.strict);
            const PREFLIGHT_FAST_SCAN_MS = 2000;
            const PREFLIGHT_SLOW_SCAN_MS = 7000;
            const PREFLIGHT_BLOCK_THRESHOLD = 2;
            const ENTER_ATTEMPT_GRACE_MS = 8000;

            const session = this.state.traineeSession;
            if (!session) return;
            const username = this.getMyUsername();
            if (!username) return;
            const myData = this.getMyTraineeData(session);
            const isOverridden = myData && myData.override;
            const cfg = this.readObject('system_config');
            const forceGlobalKiosk = !!(cfg.security && cfg.security.force_kiosk_global);
            const isRelaxed = (myData && myData.relaxed) && !forceGlobalKiosk;
            
            let errors = [];
            let scannerWarning = '';
            
            // Call the core Electron IPC (Inherits WhatsApp/Edge logic automatically)
            if (!isRelaxed) {
                try {
                    const forbidden = this.readArray('forbiddenApps');
                    const scanList = forbidden.length > 0 ? forbidden : null;
                    let screenCount = 0;
                    let apps = [];

                    if (window.electronAPI && typeof window.electronAPI.getScreenCount === 'function' && typeof window.electronAPI.getProcessList === 'function') {
                        [screenCount, apps] = await this.withTimeout(Promise.all([
                            window.electronAPI.getScreenCount(),
                            window.electronAPI.getProcessList(scanList)
                        ]), 8000, 'Security scanner');
                    } else if (window.electronAPI && window.electronAPI.ipcRenderer && typeof window.electronAPI.ipcRenderer.invoke === 'function') {
                        [screenCount, apps] = await this.withTimeout(Promise.all([
                            window.electronAPI.ipcRenderer.invoke('get-screen-count'),
                            window.electronAPI.ipcRenderer.invoke('get-process-list', scanList)
                        ]), 8000, 'Security scanner');
                    } else if (typeof require !== 'undefined') {
                        const { ipcRenderer } = require('electron');
                        [screenCount, apps] = await this.withTimeout(Promise.all([
                            ipcRenderer.invoke('get-screen-count'),
                            ipcRenderer.invoke('get-process-list', scanList)
                        ]), 8000, 'Security scanner');
                    } else {
                        scannerWarning = 'Security scanner unavailable. Click Enter to run an immediate check.';
                    }

                    if (screenCount > 1) errors.push(`Multiple Monitors Detected (${screenCount}). Unplug external screens.`);
                    if (apps && apps.length > 0) errors.push(`Forbidden Apps Running: ${apps.join(', ')}`);
                } catch (e) {
                    scannerWarning = 'Security scanner failed temporarily. Rechecking in the background.';
                }
            }

            const logBox = document.getElementById('sandboxSecurityLog');
            const btn = document.getElementById('btnEnterSandbox');
            if (!logBox || !btn) return;

            let status = 'ready';
            const hasBlockingViolations = errors.length > 0 && !isOverridden && !isRelaxed;
            const withinEnterGrace = (Date.now() - this.state.lastEnterAttempt) < ENTER_ATTEMPT_GRACE_MS;
            let shouldBlock = false;

            if (hasBlockingViolations) {
                this.state.complianceConsecutivePasses = 0;
                this.state.complianceConsecutiveErrors += 1;
                shouldBlock = strictMode || (!withinEnterGrace && this.state.complianceConsecutiveErrors >= PREFLIGHT_BLOCK_THRESHOLD);
            } else {
                this.state.complianceConsecutiveErrors = 0;
                this.state.complianceConsecutivePasses += 1;
            }

            status = shouldBlock ? 'blocked' : 'ready';

            if (errors.length === 0) {
                logBox.innerHTML = `<div style="color:#2ecc71; font-weight:bold;"><i class="fas fa-check-circle" style="font-size:1.5rem; vertical-align:middle; margin-right:10px;"></i> System Secure. Ready to start.</div>`;
                if (scannerWarning) {
                    logBox.innerHTML += `<div style="margin-top:10px; color:#f1c40f; font-size:0.9rem;">${scannerWarning}</div>`;
                }
                btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; btn.style.animation = 'pulse 2s infinite';
            } else if (isOverridden) {
                logBox.innerHTML = `<div style="color:#f1c40f; font-weight:bold; margin-bottom:10px;"><i class="fas fa-exclamation-triangle"></i> Admin Override Active</div>` + errors.map(e => `<div style="color:var(--text-muted); font-size:0.85rem;">- ${e} (Ignored)</div>`).join('');
                btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; btn.style.animation = 'none';
            } else if (!shouldBlock) {
                logBox.innerHTML = `<div style="color:#f1c40f; font-weight:bold; margin-bottom:10px;"><i class="fas fa-exclamation-circle"></i> Potential Issue Detected</div>` + errors.map(e => `<div style="color:var(--text-muted); font-size:0.85rem;">- ${e}</div>`).join('');
                btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; btn.style.animation = 'pulse 2s infinite';
            } else {
                logBox.innerHTML = errors.map(e => `<div style="color:#ff5252; padding:5px 0;"><i class="fas fa-ban"></i> ${e}</div>`).join('');
                btn.disabled = true; btn.style.opacity = '0.5'; btn.style.cursor = 'not-allowed'; btn.style.animation = 'none';
            }

            if (!strictMode) {
                if (shouldBlock && this.state.preflightScanRateMs !== PREFLIGHT_FAST_SCAN_MS) {
                    this.setPreFlightPollerInterval(PREFLIGHT_FAST_SCAN_MS);
                } else if (!shouldBlock && this.state.preflightScanRateMs !== PREFLIGHT_SLOW_SCAN_MS) {
                    this.setPreFlightPollerInterval(PREFLIGHT_SLOW_SCAN_MS);
                }
            }

            // Auto-report status change to Admin
            if (!myData || myData.status !== status) {
                await DataService.patchSessionUser(session.sessionId, username, { status: status });
            }

        } finally {
            this.state.isCheckingCompliance = false;
        }
    },

    checkActiveSecurity: async function() {
        const session = this.state.traineeSession;
        if (!session) return;
        const myData = this.getMyTraineeData(session);
        const cfg = this.readObject('system_config');
        const forceGlobalKiosk = !!(cfg.security && cfg.security.force_kiosk_global);
        if (myData && myData.relaxed && !forceGlobalKiosk) {
            this.state.securityWarningCount = 0;
            try {
                if (window.electronAPI && typeof window.electronAPI.setKioskMode === 'function') {
                    window.electronAPI.setKioskMode(false).catch(()=>{});
                    window.electronAPI.setContentProtection(false).catch(()=>{});
                } else if (typeof require !== 'undefined') {
                    const { ipcRenderer } = require('electron');
                    ipcRenderer.invoke('set-kiosk-mode', false).catch(()=>{});
                    ipcRenderer.invoke('set-content-protection', false).catch(()=>{});
                }
            } catch (e) { console.warn('[Vetting] Error dropping shields', e); }
            return; // Admin dropped shields mid-test
        }

        try {
            // Ensure shields stay up
            if (window.electronAPI && typeof window.electronAPI.setKioskMode === 'function') {
                window.electronAPI.setKioskMode(true).catch(()=>{});
                window.electronAPI.setContentProtection(true).catch(()=>{});

                const forbidden = this.readArray('forbiddenApps');
                const apps = await window.electronAPI.getProcessList(forbidden.length > 0 ? forbidden : null).catch(()=>[]);
                const screens = await window.electronAPI.getScreenCount().catch(()=>0);

                if ((apps && apps.length > 0) || (screens && screens > 1)) {
                    this.state.securityWarningCount++;
                    if (this.state.securityWarningCount >= 4) {
                        alert("Security Violation: Background App Detected. Test Terminated.");
                        this.exitArena();
                    }
                } else {
                    this.state.securityWarningCount = 0;
                }
            } else if (typeof require !== 'undefined') {
                const { ipcRenderer } = require('electron');
                ipcRenderer.invoke('set-kiosk-mode', true).catch(()=>{});
                ipcRenderer.invoke('set-content-protection', true).catch(()=>{});

                const forbidden = this.readArray('forbiddenApps');
                const apps = await ipcRenderer.invoke('get-process-list', forbidden.length > 0 ? forbidden : null);
                const screens = await ipcRenderer.invoke('get-screen-count');

                if (apps.length > 0 || screens > 1) {
                    this.state.securityWarningCount++;
                    if (this.state.securityWarningCount >= 4) {
                        alert("Security Violation: Background App Detected. Test Terminated.");
                        this.exitArena();
                    }
                } else {
                    this.state.securityWarningCount = 0; // Forgive if they close it quickly
                }
            }
        } catch (e) { console.warn('[Vetting] checkActiveSecurity error', e); }
    },

    enterArena: async function() {
        await this.checkSystemCompliance({ strict: true });
        const btn = document.getElementById('btnEnterSandbox');
        if (btn && btn.disabled) return;
        this.stopTraineePollers(); // Stop pre-flight
        const username = this.getMyUsername();
        if (!username || !this.state.traineeSession) return;
        this.state.lastEnterAttempt = Date.now();
        this.state.complianceConsecutiveErrors = 0;
        this.state.complianceConsecutivePasses = 0;
        const myData = this.getMyTraineeData(this.state.traineeSession);
        const cfg = this.readObject('system_config');
        const forceGlobalKiosk = !!(cfg.security && cfg.security.force_kiosk_global);
        const isRelaxed = !!(myData && myData.relaxed && !forceGlobalKiosk);
        try {
            if (window.electronAPI && typeof window.electronAPI.setKioskMode === 'function') {
                await window.electronAPI.setKioskMode(!isRelaxed);
                await window.electronAPI.setContentProtection(!isRelaxed);
            } else if (typeof require !== 'undefined') {
                const { ipcRenderer } = require('electron');
                await ipcRenderer.invoke('set-kiosk-mode', !isRelaxed);
                await ipcRenderer.invoke('set-content-protection', !isRelaxed);
            }
        } catch (e) { console.warn('[Vetting] enterArena IPC error', e); }
        await DataService.patchSessionUser(this.state.traineeSession.sessionId, username, { status: 'started', startedAt: Date.now() });
        this.renderTrainee(); // Render active view
    },

    exitArena: async function() {
        this.stopTraineePollers();
        const username = this.getMyUsername();
        if (!username || !this.state.traineeSession) return;
        try {
            if (window.electronAPI && typeof window.electronAPI.setKioskMode === 'function') {
                await window.electronAPI.setKioskMode(false);
                await window.electronAPI.setContentProtection(false);
            } else if (typeof require !== 'undefined') {
                const { ipcRenderer } = require('electron');
                await ipcRenderer.invoke('set-kiosk-mode', false);
                await ipcRenderer.invoke('set-content-protection', false);
            }
        } catch (e) { console.warn('[Vetting] exitArena IPC error', e); }
        await DataService.patchSessionUser(this.state.traineeSession.sessionId, username, { status: 'completed' });
        this.renderTrainee(); // Render completion screen
    }
};

// Boot when ready
window.onload = () => App.init();
window.onbeforeunload = () => App.shutdown();

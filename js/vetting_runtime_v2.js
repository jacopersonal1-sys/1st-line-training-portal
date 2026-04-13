/* ================= VETTING ARENA 2.0 TRAINEE RUNTIME ================= */
/* Host-side trainee bridge while admin runtime stays on webview module. */

(function() {
    const TABLE_PRIMARY = 'vetting_sessions_v2';
    const TABLE_MIRROR = 'vetting_sessions';
    const PATCH_QUEUE_KEY = 'vetting_v2_pending_status_patches';
    const STALE_SESSION_MS = 12 * 60 * 60 * 1000;

    let TRAINEE_LOCAL_POLLER = null;
    let SECURITY_VIOLATION_INTERVAL = null;
    let TRAINEE_SESSION_SYNC_INTERVAL = null;
    let VETTING_PATCH_FLUSH_INTERVAL = null;
    let VETTING_ENFORCER_INTERVAL = null;

    let LAST_REPORTED_STATUS = null;
    let IS_CHECKING_COMPLIANCE = false;
    let SECURITY_WARNING_COUNT = 0;
    let IS_POLLING_SECURITY = false;
    let IS_SUBMITTING_VIOLATION = false;

    function getCurrentUser() {
        if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) return CURRENT_USER;
        if (window.CURRENT_USER) return window.CURRENT_USER;
        return null;
    }

    function isTrainee() {
        const user = getCurrentUser();
        return !!(user && user.role === 'trainee');
    }

    function getUsername() {
        const user = getCurrentUser();
        return user && user.user ? user.user : '';
    }

    function normalizeIdentity(value) {
        let v = String(value || '').trim().toLowerCase();
        if (!v) return '';
        if (v.includes('@')) v = v.split('@')[0];
        v = v.replace(/[._-]+/g, ' ');
        v = v.replace(/\s+/g, ' ').trim();
        return v;
    }

    function identitiesMatch(a, b) {
        const na = normalizeIdentity(a);
        const nb = normalizeIdentity(b);
        if (!na || !nb) return false;
        if (na === nb) return true;
        const ca = na.replace(/\s+/g, '');
        const cb = nb.replace(/\s+/g, '');
        return !!ca && ca === cb;
    }

    function getTraineeData(session, username) {
        if (!session || !session.trainees || !username) return null;
        if (session.trainees[username]) return session.trainees[username];
        const matchingKeys = Object.keys(session.trainees).filter(k => identitiesMatch(k, username));
        if (!matchingKeys.length) return null;
        const nonCompleted = matchingKeys.find(k => {
            const st = String((session.trainees[k] && session.trainees[k].status) || '').toLowerCase();
            return st !== 'completed';
        });
        const matchKey = nonCompleted || matchingKeys[0];
        return matchKey ? session.trainees[matchKey] : null;
    }

    function getLocalSession() {
        try {
            return JSON.parse(localStorage.getItem('vettingSession') || '{"active":false,"trainees":{}}');
        } catch (e) {
            return { active: false, trainees: {} };
        }
    }

    function saveLocalSession(session) {
        localStorage.setItem('vettingSession', JSON.stringify(session || { active: false, trainees: {} }));
    }

    function getAdminSessions() {
        try {
            return JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
        } catch (e) {
            return [];
        }
    }

    function saveAdminSessions(sessions) {
        localStorage.setItem('adminVettingSessions', JSON.stringify(sessions || []));
    }

    function getQueuedPatches() {
        try {
            return JSON.parse(localStorage.getItem(PATCH_QUEUE_KEY) || '[]');
        } catch (e) {
            return [];
        }
    }

    function saveQueuedPatches(queue) {
        localStorage.setItem(PATCH_QUEUE_KEY, JSON.stringify(queue || []));
    }

    function queuePatch(username, statusData, explicitSessionId) {
        if (!username || !statusData) return;
        const local = getLocalSession();
        const sessionId = explicitSessionId || local.sessionId;
        if (!sessionId) return;

        const queue = getQueuedPatches();
        const key = `${sessionId}:${username}`;
        const idx = queue.findIndex(item => `${item.sessionId}:${item.username}` === key);
        if (idx > -1) {
            queue[idx] = {
                ...queue[idx],
                sessionId,
                username,
                statusData: { ...(queue[idx].statusData || {}), ...statusData },
                updatedAt: Date.now()
            };
        } else {
            queue.push({ sessionId, username, statusData: { ...statusData }, updatedAt: Date.now() });
        }
        saveQueuedPatches(queue);
    }

    async function upsertSessionOnTable(table, sessionId, sessionData) {
        const payload = { id: sessionId, data: sessionData, updated_at: new Date().toISOString() };
        const { error } = await window.supabaseClient.from(table).upsert(payload);
        if (error) throw error;
    }

    async function patchTraineeStatus(username, statusData, skipQueue = false, explicitSessionId = null) {
        if (!username || !statusData) return;
        if (!window.supabaseClient) {
            if (!skipQueue) queuePatch(username, statusData, explicitSessionId);
            return;
        }

        const local = getLocalSession();
        const sessionId = explicitSessionId || local.sessionId;
        if (!sessionId) {
            if (!skipQueue) queuePatch(username, statusData, explicitSessionId);
            return;
        }

        try {
            for (const table of [TABLE_PRIMARY, TABLE_MIRROR]) {
                const { data, error } = await window.supabaseClient
                    .from(table)
                    .select('data')
                    .eq('id', sessionId)
                    .maybeSingle();

                if (error) throw error;

                const base = data && data.data
                    ? data.data
                    : (local.sessionId === sessionId ? { ...local } : { sessionId, active: true, trainees: {} });
                if (!base.trainees) base.trainees = {};
                base.trainees[username] = { ...(base.trainees[username] || {}), ...statusData };

                await upsertSessionOnTable(table, sessionId, base);
            }
        } catch (e) {
            if (!skipQueue) queuePatch(username, statusData, explicitSessionId);
            throw e;
        }
    }

    async function flushQueuedPatches() {
        if (!window.supabaseClient) return;
        const queue = getQueuedPatches();
        if (!queue.length) return;

        const keep = [];
        for (const item of queue) {
            try {
                await patchTraineeStatus(item.username, item.statusData, true, item.sessionId);
            } catch (e) {
                keep.push(item);
            }
        }
        saveQueuedPatches(keep);
    }

    function isTargetSessionForUser(session, username) {
        if (!session || !session.active || !username) return false;
        if (!session.targetGroup || session.targetGroup === 'all') return true;
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        const members = rosters[session.targetGroup] || [];
        return members.some(m => identitiesMatch(m, username));
    }

    function mergeActiveSessions(rows) {
        const byId = {};
        rows.forEach(row => {
            if (!row || !row.data || !row.data.sessionId || !row.data.active) return;
            const existing = byId[row.data.sessionId];
            const oldTs = existing && existing.updated_at ? new Date(existing.updated_at).getTime() : 0;
            const newTs = row.updated_at ? new Date(row.updated_at).getTime() : 0;
            if (!existing || newTs >= oldTs) byId[row.data.sessionId] = row;
        });
        return Object.values(byId).map(r => r.data);
    }

    async function pollVettingSession() {
        if (!isTrainee() || !window.supabaseClient) return;

        const readTable = async (table) => {
            const { data, error } = await window.supabaseClient.from(table).select('id,data,updated_at');
            if (error || !Array.isArray(data)) return [];
            return data;
        };

        const [primary, mirror] = await Promise.all([
            readTable(TABLE_PRIMARY),
            readTable(TABLE_MIRROR)
        ]);

        const merged = mergeActiveSessions([...primary, ...mirror]);
        saveAdminSessions(merged);

        const username = getUsername();
        let found = null;
        for (const s of merged) {
            if (isTargetSessionForUser(s, username)) {
                found = s;
                break;
            }
        }

        if (found) {
            checkAndHandleSession(found);
        } else {
            const local = getLocalSession();
            if (local.active) handleVettingUpdate({ active: false, sessionId: local.sessionId });
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

    function stopTraineeLocalPollers() {
        if (TRAINEE_LOCAL_POLLER) clearInterval(TRAINEE_LOCAL_POLLER);
        TRAINEE_LOCAL_POLLER = null;
        if (SECURITY_VIOLATION_INTERVAL) clearInterval(SECURITY_VIOLATION_INTERVAL);
        SECURITY_VIOLATION_INTERVAL = null;
    }

    function startTraineePreFlight() {
        stopTraineeLocalPollers();
        LAST_REPORTED_STATUS = null;
        TRAINEE_LOCAL_POLLER = setInterval(checkSystemCompliance, 2000);
        checkSystemCompliance();
    }

    function startActiveTestMonitoring() {
        stopTraineeLocalPollers();
        SECURITY_WARNING_COUNT = 0;
        SECURITY_VIOLATION_INTERVAL = setInterval(checkActiveSecurity, 3000);
    }

    function showSecurityViolationOverlay(message, isFatal) {
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
            <div class="modal-box" style="border:2px solid #ff5252; max-width:600px; text-align:center; box-shadow:0 0 50px rgba(255,0,0,0.5);">
                <i class="fas fa-exclamation-triangle" style="font-size:4rem; color:#ff5252; margin-bottom:20px;"></i>
                <h2 style="color:#ff5252; text-transform:uppercase;">Security Alert</h2>
                <div style="font-size:1.1rem; line-height:1.5; color:white; margin-bottom:20px;">${message}</div>
                ${!isFatal ? '<div style="font-weight:bold; color:#f1c40f;">Close forbidden apps to dismiss this warning.</div>' : '<div style="font-weight:bold; color:white;">Processing submission...</div>'}
            </div>`;
    }

    async function checkActiveSecurity() {
        if (!isTrainee()) return;

        const session = getLocalSession();
        const username = getUsername();
        const myData = getTraineeData(session, username);
        const cfg = JSON.parse(localStorage.getItem('system_config') || '{}');
        const forceGlobalKiosk = !!(cfg.security && cfg.security.force_kiosk_global);
        const isRelaxed = !!(myData && myData.relaxed && !forceGlobalKiosk);

        if (isRelaxed) {
            if (typeof require !== 'undefined') {
                const { ipcRenderer } = require('electron');
                ipcRenderer.invoke('set-kiosk-mode', false).catch(() => {});
                ipcRenderer.invoke('set-content-protection', false).catch(() => {});
            }
            return;
        }

        if (IS_POLLING_SECURITY) return;
        IS_POLLING_SECURITY = true;

        try {
            if (typeof require === 'undefined') return;
            const { ipcRenderer } = require('electron');

            ipcRenderer.invoke('set-kiosk-mode', true).catch(() => {});
            ipcRenderer.invoke('set-content-protection', true).catch(() => {});

            let forbidden = JSON.parse(localStorage.getItem('forbiddenApps') || '[]');
            if (forbidden.length === 0 && typeof window.DEFAULT_FORBIDDEN_APPS !== 'undefined') {
                forbidden = window.DEFAULT_FORBIDDEN_APPS;
            }

            const [apps, screens] = await Promise.all([
                ipcRenderer.invoke('get-process-list', forbidden),
                ipcRenderer.invoke('get-screen-count')
            ]);

            if ((apps && apps.length > 0) || (screens && screens > 1)) {
                SECURITY_WARNING_COUNT++;
                if (SECURITY_WARNING_COUNT === 1) {
                    showSecurityViolationOverlay(
                        `Forbidden app or monitor detected.<br><strong style="color:#f1c40f;">${(apps || []).join(', ') || 'Policy violation'}</strong>`,
                        false
                    );
                } else if (SECURITY_WARNING_COUNT >= 4) {
                    await updateTraineeStatus('started');
                }
            } else {
                SECURITY_WARNING_COUNT = 0;
                const overlay = document.getElementById('security-violation-overlay');
                if (overlay && !overlay.dataset.fatal) overlay.remove();
            }
        } finally {
            IS_POLLING_SECURITY = false;
        }
    }

    async function updateTraineeStatus(status, timerStr = '') {
        if (!isTrainee()) return;

        const session = getLocalSession();
        const username = getUsername();
        if (!username) return;

        if (!session.active && status === 'started') {
            if (typeof window.submitTest === 'function') await window.submitTest(true);
            return;
        }

        if (!session.trainees) session.trainees = {};
        if (!session.trainees[username]) session.trainees[username] = {};

        const cfg = JSON.parse(localStorage.getItem('system_config') || '{}');
        const forceGlobalKiosk = !!(cfg.security && cfg.security.force_kiosk_global);
        const isRelaxed = session.trainees[username].relaxed === true && !forceGlobalKiosk;

        session.trainees[username].status = status;
        if (status === 'started' && !session.trainees[username].startedAt) {
            session.trainees[username].startedAt = Date.now();
        }
        if (timerStr) session.trainees[username].timer = timerStr;

        if (typeof require !== 'undefined') {
            const { ipcRenderer } = require('electron');
            let forbidden = JSON.parse(localStorage.getItem('forbiddenApps') || '[]');
            if (forbidden.length === 0 && typeof window.DEFAULT_FORBIDDEN_APPS !== 'undefined') {
                forbidden = window.DEFAULT_FORBIDDEN_APPS;
            }

            const [screens, apps] = await Promise.all([
                ipcRenderer.invoke('get-screen-count'),
                ipcRenderer.invoke('get-process-list', forbidden)
            ]);
            session.trainees[username].security = { screens, apps };

            if (!isRelaxed && apps.length > 0 && status === 'started') {
                if (IS_SUBMITTING_VIOLATION) return;
                IS_SUBMITTING_VIOLATION = true;
                showSecurityViolationOverlay(`Security Violation: Forbidden apps detected (${apps.join(', ')}). Test ending.`, true);
                if (typeof window.submitTest === 'function') await window.submitTest(true);
                IS_SUBMITTING_VIOLATION = false;
                // Ensure the fatal overlay used during submission is removed
                // so the UI (Enter/Start buttons) becomes clickable again.
                try {
                    const ov = document.getElementById('security-violation-overlay');
                    if (ov && ov.dataset && ov.dataset.fatal) ov.remove();
                } catch (e) {}
                return;
            }
        }

        saveLocalSession(session);

        const sessions = getAdminSessions();
        const idx = sessions.findIndex(s => s.sessionId === session.sessionId);
        if (idx > -1) {
            sessions[idx] = {
                ...sessions[idx],
                trainees: {
                    ...(sessions[idx].trainees || {}),
                    [username]: { ...((sessions[idx].trainees || {})[username] || {}), ...session.trainees[username] }
                }
            };
            saveAdminSessions(sessions);
        }

        try {
            await patchTraineeStatus(username, session.trainees[username], false, session.sessionId);
        } catch (e) {
            // queued automatically
        }
    }

    async function checkSystemCompliance() {
        if (!isTrainee() || IS_CHECKING_COMPLIANCE) return;
        IS_CHECKING_COMPLIANCE = true;

        try {
            const logBox = document.getElementById('securityCheckLog');
            const btn = document.getElementById('btnEnterArena');
            if (!logBox || !btn) return;

            const session = getLocalSession();
            const username = getUsername();
            const myData = getTraineeData(session, username);
            const isOverridden = !!(myData && myData.override);
            const isRelaxed = !!(myData && myData.relaxed);

            const cfg = JSON.parse(localStorage.getItem('system_config') || '{}');
            const forceGlobalKiosk = !!(cfg.security && cfg.security.force_kiosk_global);
            const effectiveRelaxed = isRelaxed && !forceGlobalKiosk;

            const errors = [];
            if (!effectiveRelaxed && typeof require !== 'undefined') {
                const { ipcRenderer } = require('electron');
                const screenCount = await ipcRenderer.invoke('get-screen-count');
                if (screenCount > 1) errors.push(`Multiple monitors detected (${screenCount}).`);

                let forbidden = JSON.parse(localStorage.getItem('forbiddenApps') || '[]');
                if (forbidden.length === 0 && typeof window.DEFAULT_FORBIDDEN_APPS !== 'undefined') {
                    forbidden = window.DEFAULT_FORBIDDEN_APPS;
                }
                const apps = await ipcRenderer.invoke('get-process-list', forbidden);
                if (apps.length > 0) errors.push(`Forbidden apps running: ${apps.join(', ')}`);
            }

            let currentStatus = 'ready';
            if (errors.length > 0 && !isOverridden && !effectiveRelaxed) currentStatus = 'blocked';

            if (errors.length === 0) {
                logBox.innerHTML = effectiveRelaxed
                    ? '<div style="color:#e67e22; background:rgba(230,126,34,0.1); padding:15px; border-radius:6px; border:1px solid #e67e22;"><strong>Security Relaxed</strong><div style="font-size:0.9rem; opacity:0.9;">Strict rules disabled by admin.</div></div>'
                    : '<div style="color:#2ecc71; background:rgba(46,204,113,0.1); padding:15px; border-radius:6px; border:1px solid #2ecc71;"><strong>System Secure</strong><div style="font-size:0.9rem; opacity:0.9;">All checks passed. Ready to start.</div></div>';
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
                btn.style.animation = 'pulse 2s infinite';
            } else if (isOverridden) {
                logBox.innerHTML = '<div style="color:#f1c40f; background:rgba(241,196,15,0.1); padding:15px; border-radius:6px; border:1px solid #f1c40f;"><strong>Admin Override Active</strong></div>' +
                    errors.map(e => `<div style="opacity:0.7; padding:8px 10px; color:var(--text-muted);">- ${e} (Ignored)</div>`).join('');
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
                btn.style.animation = 'none';
            } else {
                logBox.innerHTML = errors.map(e => `<div style="background:rgba(255,82,82,0.1); color:#ff5252; padding:15px; border-radius:6px; border:1px solid #ff5252; margin-bottom:10px;"><strong>Security Violation</strong><div style="font-size:0.9rem; opacity:0.9;">${e}</div></div>`).join('');
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
                btn.style.animation = 'none';
            }

            if (currentStatus !== LAST_REPORTED_STATUS) {
                LAST_REPORTED_STATUS = currentStatus;
                await updateTraineeStatus(currentStatus);
            }
        } finally {
            IS_CHECKING_COMPLIANCE = false;
        }
    }

    async function enterArena(testId) {
        if (!isTrainee()) return;

        stopTraineeLocalPollers();

        const session = getLocalSession();
        const myData = getTraineeData(session, getUsername());
        let isRelaxed = !!(myData && myData.relaxed);

        const cfg = JSON.parse(localStorage.getItem('system_config') || '{}');
        if (cfg.security && cfg.security.force_kiosk_global) isRelaxed = false;

        if (!isRelaxed && typeof require !== 'undefined') {
            const { ipcRenderer } = require('electron');
            await ipcRenderer.invoke('set-kiosk-mode', true);
            await ipcRenderer.invoke('set-content-protection', true);
        }

        toggleSidebar(false);
        await updateTraineeStatus('started');

        if (testId && typeof window.openTestTaker === 'function') {
            const container = document.getElementById('vetting-arena-content');
            if (container) container.innerHTML = '<div id="arenaTestContainer"></div>';
            window.openTestTaker(testId, true);
            startActiveTestMonitoring();
            return;
        }

        renderTraineeArena();
    }

    async function exitArena(keepLocked = false) {
        if (!isTrainee()) return;
        stopTraineeLocalPollers();

        if (!keepLocked && typeof require !== 'undefined') {
            const { ipcRenderer } = require('electron');
            try {
                await ipcRenderer.invoke('set-kiosk-mode', false);
                await ipcRenderer.invoke('set-content-protection', false);
            } catch (e) {
                console.error('Exit Kiosk Error', e);
            }
        }

        if (!keepLocked) toggleSidebar(true);
        await updateTraineeStatus('completed');

        const activeTab = document.querySelector('section.active');
        if (activeTab && activeTab.id === 'vetting-arena') renderTraineeArena();
    }

    function renderTraineeArena() {
        if (!isTrainee()) return;

        const container = document.getElementById('vetting-arena-content');
        if (!container) return;

        const session = getLocalSession();
        const username = getUsername();

        if (!session.active) {
            if (typeof require !== 'undefined') {
                const { ipcRenderer } = require('electron');
                ipcRenderer.invoke('set-kiosk-mode', false).catch(() => {});
                ipcRenderer.invoke('set-content-protection', false).catch(() => {});
            }
            toggleSidebar(true);
            stopTraineeLocalPollers();

            container.innerHTML = `
                <div style="text-align:center; padding:50px;">
                    <i class="fas fa-door-closed" style="font-size:4rem; color:var(--text-muted); margin-bottom:20px;"></i>
                    <h3>Arena Closed</h3>
                    <p style="color:var(--text-muted);">There is no active vetting session at this moment.</p>
                </div>`;
            return;
        }

        if (session.targetGroup && session.targetGroup !== 'all') {
            const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
            const members = rosters[session.targetGroup] || [];
            const isMember = members.some(m => identitiesMatch(m, username));
            if (!isMember) {
                stopTraineeLocalPollers();
                container.innerHTML = `
                    <div style="text-align:center; padding:50px;">
                        <i class="fas fa-user-lock" style="font-size:4rem; color:var(--text-muted); margin-bottom:20px;"></i>
                        <h3>Not Assigned</h3>
                        <p style="color:var(--text-muted);">This vetting session is for a group you are not part of.</p>
                    </div>`;
                return;
            }
        }

        const myData = getTraineeData(session, username);

        if (myData && myData.status === 'completed') {
            stopTraineeLocalPollers();
            container.innerHTML = `
                <div style="text-align:center; padding:50px; max-width:600px; margin:0 auto;">
                    <i class="fas fa-lock" style="font-size:4rem; color:#f1c40f; margin-bottom:20px;"></i>
                    <h3>Assessment Submitted</h3>
                    <p style="font-size:1.1rem; margin-bottom:30px;">Your test has been submitted securely.</p>
                    <div style="display:inline-flex; align-items:center; gap:10px; padding:12px 25px; background:rgba(46,204,113,0.1); border:1px solid #2ecc71; border-radius:50px; color:#2ecc71; font-weight:bold;">
                        <i class="fas fa-wifi"></i> Waiting for Admin to End Session...
                    </div>
                    <div style="margin-top:30px; font-size:0.9rem; color:var(--text-muted);">Please remain seated. Your screen is still monitored.</div>
                </div>`;
            return;
        }

        if (myData && myData.status === 'started') {
            container.innerHTML = '<div id="arenaTestContainer"></div>';
            if (typeof window.openTestTaker === 'function') window.openTestTaker(session.testId, true);
            startActiveTestMonitoring();
            return;
        }

        const tests = JSON.parse(localStorage.getItem('tests') || '[]');
        const test = tests.find(t => t.id == session.testId);

        container.innerHTML = `
            <div class="card" style="text-align:center; padding:50px; max-width:600px; margin:0 auto;">
                <i class="fas fa-shield-alt" style="font-size:4rem; color:var(--primary); margin-bottom:20px;"></i>
                <h2 style="color:var(--primary);">Vetting Assessment Ready</h2>
                <h3 style="margin-bottom:20px;">${test ? test.title : 'Assessment'}</h3>
                <div style="background:rgba(255,82,82,0.1); border:1px solid #ff5252; padding:15px; border-radius:8px; text-align:left; margin-bottom:30px;">
                    <strong style="color:#ff5252;">SECURITY PROTOCOLS:</strong>
                    <ul style="margin:10px 0 0 20px; color:var(--text-main);">
                        <li>Full-screen mode can be enforced.</li>
                        <li>Screenshots and recording are blocked.</li>
                        <li>Only one monitor is allowed.</li>
                        <li>Background applications are monitored.</li>
                        <li>Camera policy remains mandatory during vetting.</li>
                    </ul>
                </div>
                <div style="position:relative;">
                    <div id="securityCheckLog" class="security-log-box" style="min-height:80px;">
                        <div style="display:flex; align-items:center; gap:15px; padding:15px; color:var(--primary); background:var(--bg-input); border-radius:6px; border:1px dashed var(--primary);">
                            <i class="fas fa-circle-notch fa-spin" style="font-size:1.8rem;"></i>
                            <div>
                                <strong style="font-size:1.1rem;">Scanning system...</strong>
                                <div style="font-size:0.9rem; color:var(--text-muted);">Verifying security protocols</div>
                            </div>
                        </div>
                    </div>
                    <button class="btn-secondary btn-sm" style="position:absolute; top:5px; right:5px;" onclick="checkSystemCompliance()" title="Force Re-check"><i class="fas fa-sync"></i></button>
                </div>
                <button id="btnEnterArena" class="btn-primary btn-lg" disabled onclick="enterArena('${session.testId}')" style="margin-top:15px; opacity:0.5; cursor:not-allowed;">ENTER ARENA & START</button>
            </div>`;

        startTraineePreFlight();
    }

    function handleVettingUpdate(serverSession) {
        if (!isTrainee()) return;

        const username = getUsername();
        const local = getLocalSession();
        const sameSession = !!(
            serverSession &&
            serverSession.sessionId &&
            local &&
            local.sessionId &&
            serverSession.sessionId === local.sessionId
        );
        const localMyData = getTraineeData(local, username);
        const next = {
            ...local,
            active: !!(serverSession && serverSession.active),
            testId: serverSession && serverSession.testId ? serverSession.testId : local.testId,
            targetGroup: serverSession && serverSession.targetGroup ? serverSession.targetGroup : local.targetGroup,
            sessionId: serverSession && serverSession.sessionId ? serverSession.sessionId : local.sessionId,
            trainees: sameSession ? { ...(local.trainees || {}) } : {}
        };

        if (serverSession && serverSession.trainees) {
            const serverMyData = getTraineeData(serverSession, username);
            if (serverMyData) {
                next.trainees[username] = { ...(localMyData || {}), ...serverMyData };
            } else if (localMyData && String(localMyData.status || '').toLowerCase() === 'completed') {
                // Prevent stale local "completed" state from locking first-time attempts.
                delete next.trainees[username];
            }

            // Collapse alias keys for the active user into canonical username key.
            Object.keys(next.trainees || {}).forEach(k => {
                if (k !== username && identitiesMatch(k, username)) delete next.trainees[k];
            });
        } else if (!sameSession && localMyData && String(localMyData.status || '').toLowerCase() === 'completed') {
            delete next.trainees[username];
        }

        if (!next.active) {
            next.trainees = {};
        }

        const oldStr = JSON.stringify(local);
        const newStr = JSON.stringify(next);
        if (oldStr === newStr) return;

        saveLocalSession(next);

        if (!next.active && document.getElementById('arenaTestContainer')) {
            if (typeof window.submitTest === 'function') window.submitTest(true);
            return;
        }

        const activeTab = document.querySelector('section.active');
        if (activeTab && activeTab.id === 'vetting-arena' && !document.getElementById('arenaTestContainer')) {
            renderTraineeArena();
        }

        if (typeof window.applyRolePermissions === 'function') window.applyRolePermissions();
    }

    function checkAndHandleSession(serverSession, eventType = null, deletedId = null) {
        if (!isTrainee()) return;

        const local = getLocalSession();
        if (eventType === 'DELETE' && local.sessionId === deletedId) {
            handleVettingUpdate({ active: false, sessionId: deletedId });
            return;
        }

        if (!serverSession || !serverSession.active) {
            if (serverSession && local.sessionId === serverSession.sessionId) {
                handleVettingUpdate({ active: false, sessionId: serverSession.sessionId });
            }
            return;
        }

        if (isTargetSessionForUser(serverSession, getUsername())) handleVettingUpdate(serverSession);
    }

    async function checkAndEnforceVetting() {
        if (!isTrainee()) return;

        try {
            const activeSessions = getAdminSessions();
            const local = getLocalSession();
            const username = getUsername();
            const now = Date.now();
            let found = null;

            if (typeof window.updateSidebarVisibility === 'function') window.updateSidebarVisibility();

            for (const s of activeSessions) {
                if (!s || !s.active) continue;
                const start = s.startTime || (s.sessionId ? parseInt(String(s.sessionId).split('_')[0], 10) : 0);
                if (start && (now - start > STALE_SESSION_MS)) continue;
                if (isTargetSessionForUser(s, username)) {
                    found = s;
                    break;
                }
            }

            if (found) {
                checkAndHandleSession(found);
                const myData = getTraineeData(found, username);
                if (!myData || myData.status !== 'completed') {
                    const activeTab = document.querySelector('section.active');
                    if (!activeTab || activeTab.id !== 'vetting-arena') {
                        if (typeof window.showTab === 'function') window.showTab('vetting-arena');
                    }
                }
            } else if (local.active) {
                handleVettingUpdate({ active: false, sessionId: local.sessionId });
            }
        } catch (e) {
            console.error('Vetting Enforcer Error:', e);
        }
    }

    function ensureBackgroundLoops() {
        if (!VETTING_PATCH_FLUSH_INTERVAL) {
            VETTING_PATCH_FLUSH_INTERVAL = setInterval(() => {
                flushQueuedPatches().catch(() => {});
            }, 1000);
        }
        if (!TRAINEE_SESSION_SYNC_INTERVAL) {
            TRAINEE_SESSION_SYNC_INTERVAL = setInterval(() => {
                pollVettingSession().catch(() => {});
            }, 1000);
        }
    }

    function loadTraineeArena() {
        if (!isTrainee()) return;
        ensureBackgroundLoops();
        pollVettingSession().catch(() => {});
        flushQueuedPatches().catch(() => {});
        renderTraineeArena();
    }

    async function flushNow() {
        if (!isTrainee()) return;
        ensureBackgroundLoops();
        await flushQueuedPatches().catch(() => {});
        await pollVettingSession().catch(() => {});
    }

    function initVettingEnforcer() {
        if (VETTING_ENFORCER_INTERVAL) clearInterval(VETTING_ENFORCER_INTERVAL);
        if (!isTrainee()) return;
        ensureBackgroundLoops();
        VETTING_ENFORCER_INTERVAL = setInterval(checkAndEnforceVetting, 5000);
        checkAndEnforceVetting();
    }

    function cleanupVettingEnforcer() {
        if (VETTING_ENFORCER_INTERVAL) clearInterval(VETTING_ENFORCER_INTERVAL);
        VETTING_ENFORCER_INTERVAL = null;
    }

    function cleanupVettingArenaWatchers() {
        stopTraineeLocalPollers();
    }

    const api = {
        loadTraineeArena,
        renderTraineeArena,
        initVettingEnforcer,
        cleanupVettingEnforcer,
        cleanupVettingArenaWatchers,
        checkAndHandleSession,
        handleVettingUpdate,
        flushNow,
        checkSystemCompliance,
        enterArena,
        exitArena
    };

    window.VettingRuntimeV2 = api;

    // Compatibility globals used by existing modules.
    window.loadVettingArena = loadTraineeArena;
    window.initVettingEnforcer = initVettingEnforcer;
    window.cleanupVettingEnforcer = cleanupVettingEnforcer;
    window.cleanupVettingArenaWatchers = cleanupVettingArenaWatchers;
    window.checkAndHandleSession = checkAndHandleSession;
    window.handleVettingUpdate = handleVettingUpdate;
    window.checkSystemCompliance = checkSystemCompliance;
    window.enterArena = enterArena;
    window.exitArena = exitArena;
})();

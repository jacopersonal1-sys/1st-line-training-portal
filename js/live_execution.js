/* ================= LIVE ASSESSMENT EXECUTION ENGINE ================= */
/* Handles real-time interaction between Trainer (Admin) and Trainee */

window.LIVE_POLLER = null;
window.LIVE_HARD_SYNC_LOOP = window.LIVE_HARD_SYNC_LOOP || null;
let LAST_RENDERED_Q = -2; // Track rendered state to prevent UI thrashing
let LIVE_CONN_INTERVAL = null;
let LIVE_TIMER_INTERVAL = null;
let LIVE_DATA_EVENT_DEBOUNCE = null;
window.LIVE_DATA_EVENT_HANDLER = window.LIVE_DATA_EVENT_HANDLER || null;
window.LIVE_ADMIN_GAMES = window.LIVE_ADMIN_GAMES || null;

function normalizeLiveText(value) {
    return String(value || '').trim().toLowerCase();
}

function getLiveBookingById(bookingId) {
    const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
    return bookings.find(b => String(b.id) === String(bookingId)) || null;
}

function isLiveSessionBookingOpen(session) {
    if (!session || !session.bookingId) return true;
    const booking = getLiveBookingById(session.bookingId);
    if (!booking) return true;
    const status = String(booking.status || '').trim().toLowerCase();
    return status !== 'completed' && status !== 'cancelled';
}

function cleanupLocalLiveSessionState(sessionId) {
    if (!sessionId) return;

    const currentSessionId = String(localStorage.getItem('currentLiveSessionId') || '');
    if (currentSessionId === String(sessionId)) {
        localStorage.removeItem('currentLiveSessionId');
    }

    let allSessions = JSON.parse(localStorage.getItem('liveSessions') || '[]');
    allSessions = Array.isArray(allSessions) ? allSessions : [];
    const nextSessions = allSessions.filter(s => String((s && s.sessionId) || '') !== String(sessionId));
    localStorage.setItem('liveSessions', JSON.stringify(nextSessions));
    if (typeof emitDataChange === 'function') emitDataChange('liveSessions', 'local_close_cleanup');

    const localSession = JSON.parse(localStorage.getItem('liveSession') || '{}');
    if (localSession && String(localSession.sessionId || '') === String(sessionId)) {
        localStorage.setItem('liveSession', JSON.stringify({ active: false, sessionId }));
    }
}

async function closeLiveSessionAuthoritatively(session) {
    if (!session || !session.sessionId) return;

    // Mark inactive in local proxy immediately.
    const closedSession = { ...session, active: false, endedAt: Date.now() };
    localStorage.setItem('liveSession', JSON.stringify(closedSession));

    // First write inactive state (for realtime listeners), then hard-delete row.
    await updateGlobalSessionArray(closedSession, true);
    if (window.supabaseClient) {
        try {
            const { error } = await window.supabaseClient
                .from('live_sessions')
                .delete()
                .eq('id', closedSession.sessionId);
            if (error) throw error;
        } catch (e) {
            console.warn('Live session delete failed after close marker:', e);
        }
    }

    // Remove ghost references locally regardless of network result.
    cleanupLocalLiveSessionState(closedSession.sessionId);
}

function resolveLiveTestDefinition(tests, assessmentName, assessmentId) {
    if (!Array.isArray(tests)) return null;
    if (assessmentId) {
        const byId = tests.find(t => t.type === 'live' && String(t.id) === String(assessmentId));
        if (byId) return byId;
    }
    if (assessmentName) {
        const byExactTitle = tests.find(t => t.type === 'live' && t.title === assessmentName);
        if (byExactTitle) return byExactTitle;
        const wanted = normalizeLiveText(assessmentName);
        return tests.find(t => t.type === 'live' && normalizeLiveText(t.title) === wanted) || null;
    }
    return null;
}

function getLiveSessionUpdateStamp(session) {
    if (!session || typeof session !== 'object') return 'none';
    const timer = session.timer || {};
    const remote = session.remoteCommand || {};
    const diagRes = session.diagnosticRes || {};
    return [
        session.sessionId || '',
        session.active ? 1 : 0,
        Number.isFinite(session.currentQ) ? session.currentQ : '',
        session.liveRevision || 0,
        session.lastUpdateTs || 0,
        session.lastQuestionPushTs || 0,
        remote.ts || 0,
        session.diagnosticReq || 0,
        diagRes.timestamp || 0,
        timer.active ? 1 : 0,
        timer.start || 0,
        timer.duration || 0,
        JSON.stringify(session.answers || {}),
        JSON.stringify(session.scores || {}),
        JSON.stringify(session.comments || {})
    ].join('|');
}

function bindLiveExecutionRealtimeHooks() {
    if (window.LIVE_DATA_EVENT_HANDLER) return;
    window.LIVE_DATA_EVENT_HANDLER = function(event) {
        if (!event || !event.detail || event.detail.key !== 'liveSessions') return;
        if (LIVE_DATA_EVENT_DEBOUNCE) clearTimeout(LIVE_DATA_EVENT_DEBOUNCE);
        LIVE_DATA_EVENT_DEBOUNCE = setTimeout(() => {
            syncLiveSessionState();
        }, 60);
    };
    window.addEventListener('buildzone:data-changed', window.LIVE_DATA_EVENT_HANDLER);
}

async function sendLiveSyncNudge(session, reason = 'sync') {
    if (!window.supabaseClient || !session || !session.trainee || !session.sessionId) return;
    try {
        const action = `live_sync:${session.sessionId}:${Date.now()}:${reason}`;
        await window.supabaseClient.from('sessions').upsert({
            username: session.trainee,
            role: 'trainee',
            pending_action: action,
            lastSeen: new Date().toISOString()
        });
    } catch (err) {
        console.warn('Live sync nudge failed:', err);
    }
}

function runLiveHardSyncCheck() {
    if (!window.supabaseClient || typeof window.forceRefreshLiveSessionById !== 'function') return;

    const liveTab = document.getElementById('live-execution');
    if (liveTab && !liveTab.classList.contains('active')) return;

    const localSession = JSON.parse(localStorage.getItem('liveSession') || '{}');
    const sessionId = localStorage.getItem('currentLiveSessionId') || localSession.sessionId || '';
    if (!sessionId) return;

    window.forceRefreshLiveSessionById(sessionId).catch(()=>{});
}

function loadLiveExecution() {
    if (window.LIVE_POLLER) clearInterval(window.LIVE_POLLER);
    if (window.LIVE_HARD_SYNC_LOOP) { clearInterval(window.LIVE_HARD_SYNC_LOOP); window.LIVE_HARD_SYNC_LOOP = null; }
    if (LIVE_CONN_INTERVAL) { clearInterval(LIVE_CONN_INTERVAL); LIVE_CONN_INTERVAL = null; }
    
    if (LIVE_TIMER_INTERVAL) clearInterval(LIVE_TIMER_INTERVAL);
    LIVE_TIMER_INTERVAL = setInterval(updateTimerDisplays, 1000);

    const container = document.getElementById('live-execution-content');
    if (!container) return;

    LAST_RENDERED_Q = -2; // Reset on load
    if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin' || CURRENT_USER.role === 'special_viewer') {
        renderAdminLivePanel(container);
    } else {
        renderTraineeLivePanel(container);
    }

    bindLiveExecutionRealtimeHooks();

    // Realtime is now fully managed by data.js INCOMING_DATA_QUEUE
    syncLiveSessionState();
    updateSocketStatusUI();

    // Always check local cache every second for responsive UI updates.
    window.LIVE_POLLER = setInterval(syncLiveSessionState, 1000);

    // Hard 1s server check by sessionId while Live Arena is open (guaranteed fallback path).
    window.LIVE_HARD_SYNC_LOOP = setInterval(runLiveHardSyncCheck, 1000);
    runLiveHardSyncCheck();
}

// --- NEW: GLOBAL REJOIN LOGIC ---
window.rejoinLiveSession = function(sessionId) {
    localStorage.setItem('currentLiveSessionId', sessionId);
    const allSessions = JSON.parse(localStorage.getItem('liveSessions') || '[]');
    const target = allSessions.find(s => s.sessionId === sessionId);
    if (target) {
        localStorage.setItem('liveSession', JSON.stringify(target));
    }
    showTab('live-execution');
};

function enforceTraineeLiveArenaFocus(session) {
    if (!CURRENT_USER || CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin' || CURRENT_USER.role === 'special_viewer') {
        window.__TRAINEE_ACTIVE_LIVE_SESSION_ID = null;
        return;
    }

    const activeSessionId = (session && session.active && session.sessionId) ? session.sessionId : null;
    window.__TRAINEE_ACTIVE_LIVE_SESSION_ID = activeSessionId;

    if (!activeSessionId) {
        window.__TRAINEE_LIVE_LOCK_NOTICE_FOR = null;
        return;
    }

    const activeTabId = document.querySelector('section.active')?.id || '';
    if (activeTabId === 'live-execution') return;

    if (window.__TRAINEE_LIVE_LOCK_NOTICE_FOR !== activeSessionId && typeof showToast === 'function') {
        showToast("Live assessment started. You are being moved to the Live Assessment Arena.", "info");
        window.__TRAINEE_LIVE_LOCK_NOTICE_FOR = activeSessionId;
    }

    const lastJumpTs = Number(window.__TRAINEE_LIVE_AUTO_JUMP_TS || 0);
    if ((Date.now() - lastJumpTs) < 1000) return;

    window.__TRAINEE_LIVE_AUTO_JUMP_TS = Date.now();
    if (typeof showTab === 'function') showTab('live-execution');
}

async function syncLiveSessionState() {
    // READ FROM REALTIME CACHE INSTEAD OF HAMMERING DATABASE
    // The data.js WebSocket listener automatically keeps this array perfectly up to date with 0 latency.
    const allSessions = JSON.parse(localStorage.getItem('liveSessions') || '[]');
    
    processLiveSessionState(allSessions);
}

// --- HELPER: PROCESS STATE (Shared by Poller & Realtime) ---
function processLiveSessionState(allSessions) {
    // SAFETY GUARD: Prevent execution if not logged in (e.g., during initial boot sync on login screen)
    if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return;

    // Guard against stale ghost sessions linked to already completed/cancelled bookings.
    allSessions = Array.isArray(allSessions) ? allSessions : [];
    const sanitizedSessions = allSessions.filter(s => isLiveSessionBookingOpen(s));
    if (sanitizedSessions.length !== allSessions.length) {
        localStorage.setItem('liveSessions', JSON.stringify(sanitizedSessions));
        if (typeof emitDataChange === 'function') emitDataChange('liveSessions', 'stale_booking_guard');
    }
    allSessions = sanitizedSessions;

    // FIND MY RELEVANT SESSION
    let myServerSession = null;
    const localSession = JSON.parse(localStorage.getItem('liveSession') || '{"active":false}');

    if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin' || CURRENT_USER.role === 'special_viewer') {
        // Admin: Prefer the session we are explicitly viewing
        const viewingId = localStorage.getItem('currentLiveSessionId');
        if (viewingId) {
            myServerSession = allSessions.find(s => s.sessionId === viewingId) || null;
            
            // CRITICAL FIX: If the session ID we are trying to view isn't in the server list yet (latency),
            // but matches our local "just started" session, trust the local one.
            // This prevents falling back to an old/stale session ("Rejoin Logic") immediately after starting a new one.
            if (!myServerSession && localSession.sessionId === viewingId && localSession.active) {
                myServerSession = localSession;
            }
        }
        // REJOIN LOGIC: If not found, attach to first active session where this admin is trainer
        if (!myServerSession) {
            myServerSession = allSessions.find(s => s.trainer === CURRENT_USER.user && s.active) || { active: false };
            if (myServerSession && myServerSession.sessionId) {
                localStorage.setItem('currentLiveSessionId', myServerSession.sessionId);
            }
        }
    } else {
        // Trainee: Find the session assigned to me
        // FIX: Filter out stale sessions (>12h) and sort by start time to get the latest
        const now = Date.now();
        const validSessions = allSessions.filter(s => {
            if (s.trainee !== CURRENT_USER.user || !s.active) return false;
            // Determine start time (Fallback to ID timestamp if missing)
            const start = s.startTime || (s.sessionId ? parseInt(s.sessionId.split('_')[0]) : 0);
            // Check staleness (12 hours = 43200000 ms)
            if (now - start > 43200000) return false;
            return true;
        });
        
        // Sort newest first
        validSessions.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));

        const pinnedId = localStorage.getItem('currentLiveSessionId');
        const localSessionId = localSession.sessionId;
        if (pinnedId) {
            myServerSession = validSessions.find(s => s.sessionId === pinnedId) || null;
        }
        if (!myServerSession && localSessionId) {
            myServerSession = validSessions.find(s => s.sessionId === localSessionId) || null;
        }
        if (!myServerSession) {
            myServerSession = validSessions.length > 0 ? validSessions[0] : { active: false };
        }

        if (myServerSession && myServerSession.sessionId) {
            localStorage.setItem('currentLiveSessionId', myServerSession.sessionId);
        }
    }

    if (myServerSession && typeof myServerSession === 'object') {
        // Work with a detached copy so local merge logic never mutates cached session arrays.
        myServerSession = JSON.parse(JSON.stringify(myServerSession));
    }

    enforceTraineeLiveArenaFocus(myServerSession);

    // PRESERVE LOCAL ANSWERS (Trainee Only)
    if (CURRENT_USER.role !== 'admin' && CURRENT_USER.role !== 'super_admin' && CURRENT_USER.role !== 'special_viewer' && myServerSession.active) {
        const currentLocal = JSON.parse(localStorage.getItem('liveSession') || '{}');
        if (currentLocal.answers) {
            myServerSession.answers = { ...myServerSession.answers, ...currentLocal.answers };
        }
    }

    // --- NEW: DIAGNOSTIC INTERCEPTS ---
    if (CURRENT_USER.role !== 'admin' && CURRENT_USER.role !== 'super_admin' && CURRENT_USER.role !== 'special_viewer' && myServerSession.active) {
        // Trainee: Detect Instant Remote Command
        if (myServerSession.remoteCommand && (!localSession.remoteCommand || localSession.remoteCommand.ts !== myServerSession.remoteCommand.ts)) {
            if (myServerSession.remoteCommand.action === 'restart') {
                if (typeof triggerForceRestart === 'function') triggerForceRestart();
                else location.reload();
            }
        }

        // Trainee: Detect Ping Request
        if (myServerSession.diagnosticReq && myServerSession.diagnosticReq !== localSession.diagnosticReq) {
            const netLogs = JSON.parse(localStorage.getItem('network_diagnostics') || '[]');
            myServerSession.diagnosticRes = {
                timestamp: Date.now(),
                network: netLogs.length > 0 ? netLogs[netLogs.length-1] : null
            };
            // Fire & Forget Response back to Admin
            localStorage.setItem('liveSession', JSON.stringify(myServerSession));
            if (typeof updateGlobalSessionArray === 'function') updateGlobalSessionArray(myServerSession, true).catch(()=>{});
        }
    } else if ((CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin') && myServerSession.active) {
        // Admin: Detect Ping Response
        if (myServerSession.diagnosticRes && (!localSession.diagnosticRes || localSession.diagnosticReq !== myServerSession.diagnosticReq)) {
            const rtt = Date.now() - myServerSession.diagnosticReq;
            if (typeof showDiagnosticReport === 'function') showDiagnosticReport(rtt, myServerSession.diagnosticRes.network);
        }
    }
    // ----------------------------------

    // Update the local "Active Session" proxy for UI rendering
    
    // Only update if state actually changed
    const serverStamp = getLiveSessionUpdateStamp(myServerSession);
    const localStamp = getLiveSessionUpdateStamp(localSession);
    if (serverStamp !== localStamp) {
        localStorage.setItem('liveSession', JSON.stringify(myServerSession));
        
        const container = document.getElementById('live-execution-content');
        if (container) {
            if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin' || CURRENT_USER.role === 'special_viewer') {
                // Admin: Update view but try to preserve focus if typing
                if (!document.querySelector('.admin-interaction-active') || myServerSession.currentQ !== localSession.currentQ) {
                    renderAdminLivePanel(container);
                } else {
                    updateAdminLiveView(); 
                }
            } else {
                // Trainee: ONLY re-render if the question changed or session status changed
                const questionMoved = myServerSession.currentQ !== LAST_RENDERED_Q;
                const activeStateChanged = myServerSession.active !== localSession.active;
                const pushedRefresh = (myServerSession.lastQuestionPushTs || 0) !== (localSession.lastQuestionPushTs || 0);
                if (questionMoved || activeStateChanged || pushedRefresh) {
                     
                    // ARCHITECTURAL FIX: FLUSH PENDING KEYSTROKES BEFORE DOM WIPE
                    if (typeof REALTIME_SAVE_TIMEOUT !== 'undefined' && REALTIME_SAVE_TIMEOUT) {
                        clearTimeout(REALTIME_SAVE_TIMEOUT);
                        REALTIME_SAVE_TIMEOUT = null;
                        const sessionToSave = JSON.parse(localStorage.getItem('liveSession') || '{}');
                        if (typeof updateGlobalSessionArray === 'function') updateGlobalSessionArray(sessionToSave, true).catch(()=>{});
                    }

                    const success = renderTraineeLivePanel(container);
                    if (success !== false) LAST_RENDERED_Q = myServerSession.currentQ;
                    else LAST_RENDERED_Q = -2; // Force retry on next tick
                }
            }
        }
    }
    
    // ALWAYS CHECK FOR GLOBAL LIVE ALERT (Trainee POV)
    if (CURRENT_USER.role !== 'admin' && CURRENT_USER.role !== 'super_admin' && CURRENT_USER.role !== 'special_viewer') {
        if (typeof updateGlobalLiveAlert === 'function') {
            updateGlobalLiveAlert(myServerSession);
        }
    }
}

// --- SOCKET STATUS UI HELPER ---
function updateSocketStatusUI() {
    const els = [document.getElementById('socket-status'), document.getElementById('socket-status-trainee')];
    
    let color = '#2ecc71';
    let text = 'Realtime Active';
    let icon = 'fa-bolt';

    if (!window.supabaseClient) { color = '#ff5252'; text = 'Offline'; icon = 'fa-exclamation-triangle'; }
    
    els.forEach(el => {
        if (el) {
            el.innerHTML = `<i class="fas ${icon}" style="color:${color}; margin-right:5px;"></i> ${text}`;
            el.style.borderColor = color;
                el.title = `Socket Status: ${window.supabaseClient ? 'CONNECTED' : 'OFFLINE'}`;
        }
    });
}

// --- NEW: GLOBAL LIVE ALERT (Pops up regardless of current tab) ---
window.updateGlobalLiveAlert = function(session) {
    let el = document.getElementById('global-live-alert');
    
    if (!session || !session.active) {
        if (el) el.remove();
        return;
    }

    // Don't show if they are already inside the Live Execution tab looking at the test
    const isLiveTab = document.getElementById('live-execution')?.classList.contains('active');
    if (isLiveTab) {
        if (el) el.remove();
        return;
    }

    if (!el) {
        el = document.createElement('div');
        el.id = 'global-live-alert';
        el.style.cssText = "position:fixed; top:20px; left:50%; transform:translateX(-50%); z-index:15000; background:linear-gradient(135deg, #2ecc71, #27ae60); color:white; padding:15px 30px; border-radius:30px; box-shadow:0 10px 25px rgba(46, 204, 113, 0.4); display:flex; align-items:center; gap:20px; cursor:pointer; animation: slideInDown 0.5s ease-out, pulse 2s infinite;";
        el.innerHTML = `
            <div style="font-weight:bold; font-size:1.1rem; white-space:nowrap;"><i class="fas fa-satellite-dish"></i> Live Assessment Started!</div>
            <div style="font-size:0.9rem; opacity:0.9; white-space:nowrap;">Your trainer is waiting in the arena.</div>
            <button class="btn-success" style="background:white; color:#2ecc71; border:none; padding:6px 15px; border-radius:15px; font-weight:bold; cursor:pointer; box-shadow:0 2px 5px rgba(0,0,0,0.1);">Join Now</button>
        `;
        
        if (window.electronAPI && window.electronAPI.notifications) {
            window.electronAPI.notifications.show('Live Assessment Started!', 'Your trainer is waiting in the arena. Click here to join.');
        }

        // Anywhere they click on the banner teleports them directly to the Arena
        el.onclick = function() {
            showTab('live-execution');
            el.remove();
        };
        
        document.body.appendChild(el);
    }
}

function ensureLiveAdminGamesState() {
    if (window.LIVE_ADMIN_GAMES) return window.LIVE_ADMIN_GAMES;

    const createBoard = (rows, cols) => Array.from({ length: rows }, () => Array(cols).fill(0));
    const tetrisPieces = [
        [[1, 1, 1, 1]],
        [[1, 0, 0], [1, 1, 1]],
        [[0, 0, 1], [1, 1, 1]],
        [[1, 1], [1, 1]],
        [[0, 1, 1], [1, 1, 0]],
        [[0, 1, 0], [1, 1, 1]],
        [[1, 1, 0], [0, 1, 1]]
    ];

    window.LIVE_ADMIN_GAMES = {
        keybound: false,
        tetris: {
            rows: 20,
            cols: 10,
            cell: 18,
            board: createBoard(20, 10),
            active: false,
            paused: true,
            score: 0,
            lines: 0,
            dropInterval: 500,
            gameOver: false,
            lastTs: 0,
            rafId: null,
            current: null,
            pieces: tetrisPieces,
            colors: ['#2ecc71', '#3498db', '#f39c12', '#f1c40f', '#1abc9c', '#9b59b6', '#e74c3c']
        },
        snake: {
            size: 15,
            cell: 14,
            active: false,
            paused: true,
            score: 0,
            gameOver: false,
            timerId: null,
            speed: 135,
            direction: 'right',
            nextDirection: 'right',
            snake: [{ x: 4, y: 7 }, { x: 3, y: 7 }, { x: 2, y: 7 }],
            food: { x: 10, y: 7 }
        }
    };

    return window.LIVE_ADMIN_GAMES;
}

function renderAdminMiniGamesPanel() {
    return `
        <div id="live-admin-mini-games" style="border:1px solid var(--border-color); border-radius:8px; background:var(--bg-input); padding:10px;">
            <div style="font-weight:700; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
                <span><i class="fas fa-gamepad"></i> Trainer Break Arcade</span>
                <span style="font-size:0.75rem; color:var(--text-muted);">Local-only mini games</span>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(250px,1fr)); gap:10px;">
                <div style="border:1px solid var(--border-color); border-radius:8px; padding:8px; background:var(--bg-card);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <strong>Tetris</strong>
                        <span id="live-tetris-status" style="font-size:0.75rem; color:var(--text-muted);">Paused</span>
                    </div>
                    <canvas id="live-tetris-canvas" width="180" height="360" style="display:block; margin:0 auto 6px; border:1px solid #1f1f1f; background:#0a0a0a;"></canvas>
                    <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:6px;">
                        <span>Score: <strong id="live-tetris-score">0</strong></span>
                        <span>Lines: <strong id="live-tetris-lines">0</strong></span>
                    </div>
                    <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:6px;">
                        <button class="btn-secondary btn-sm" onclick="liveAdminTetrisMove(-1)"><i class="fas fa-arrow-left"></i></button>
                        <button class="btn-secondary btn-sm" onclick="liveAdminTetrisRotate()"><i class="fas fa-rotate"></i></button>
                        <button class="btn-secondary btn-sm" onclick="liveAdminTetrisMove(1)"><i class="fas fa-arrow-right"></i></button>
                        <button class="btn-secondary btn-sm" onclick="liveAdminTetrisSoftDrop()"><i class="fas fa-arrow-down"></i></button>
                        <button class="btn-primary btn-sm" onclick="liveAdminTetrisToggle()">Start / Pause</button>
                        <button class="btn-warning btn-sm" onclick="liveAdminTetrisReset()">Reset</button>
                    </div>
                </div>
                <div style="border:1px solid var(--border-color); border-radius:8px; padding:8px; background:var(--bg-card);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <strong>Snake</strong>
                        <span id="live-snake-status" style="font-size:0.75rem; color:var(--text-muted);">Paused</span>
                    </div>
                    <canvas id="live-snake-canvas" width="210" height="210" style="display:block; margin:0 auto 6px; border:1px solid #1f1f1f; background:#0a0a0a;"></canvas>
                    <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:6px;">
                        <span>Score: <strong id="live-snake-score">0</strong></span>
                        <span>Controls: Arrows</span>
                    </div>
                    <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:6px;">
                        <button class="btn-secondary btn-sm" onclick="liveAdminSnakeTurn('left')"><i class="fas fa-arrow-left"></i></button>
                        <button class="btn-secondary btn-sm" onclick="liveAdminSnakeTurn('up')"><i class="fas fa-arrow-up"></i></button>
                        <button class="btn-secondary btn-sm" onclick="liveAdminSnakeTurn('right')"><i class="fas fa-arrow-right"></i></button>
                        <button class="btn-secondary btn-sm" onclick="liveAdminSnakeTurn('down')"><i class="fas fa-arrow-down"></i></button>
                        <button class="btn-primary btn-sm" onclick="liveAdminSnakeToggle()">Start / Pause</button>
                        <button class="btn-warning btn-sm" onclick="liveAdminSnakeReset()">Reset</button>
                    </div>
                </div>
            </div>
            <div style="margin-top:8px; font-size:0.75rem; color:var(--text-muted);">
                Keyboard: Tetris uses A/D (move), W (rotate), S (drop). Snake uses Arrow keys.
            </div>
        </div>
    `;
}

function drawLiveAdminTetris() {
    const state = ensureLiveAdminGamesState().tetris;
    const canvas = document.getElementById('live-tetris-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const drawCell = (x, y, colorIdx) => {
        const color = state.colors[(colorIdx - 1) % state.colors.length] || '#2ecc71';
        ctx.fillStyle = color;
        ctx.fillRect(x * state.cell, y * state.cell, state.cell - 1, state.cell - 1);
    };

    state.board.forEach((row, y) => row.forEach((val, x) => { if (val) drawCell(x, y, val); }));
    if (state.current) {
        state.current.matrix.forEach((row, y) => row.forEach((val, x) => {
            if (val) drawCell(state.current.x + x, state.current.y + y, state.current.color);
        }));
    }

    const scoreEl = document.getElementById('live-tetris-score');
    const linesEl = document.getElementById('live-tetris-lines');
    const statusEl = document.getElementById('live-tetris-status');
    if (scoreEl) scoreEl.innerText = String(state.score);
    if (linesEl) linesEl.innerText = String(state.lines);
    if (statusEl) statusEl.innerText = state.gameOver ? 'Game Over' : (state.paused ? 'Paused' : 'Running');
}

function makeLiveAdminTetrisPiece() {
    const state = ensureLiveAdminGamesState().tetris;
    const pick = Math.floor(Math.random() * state.pieces.length);
    const matrix = state.pieces[pick].map(r => r.slice());
    return {
        matrix,
        color: pick + 1,
        x: Math.floor((state.cols - matrix[0].length) / 2),
        y: 0
    };
}

function liveAdminTetrisCollision(piece) {
    const state = ensureLiveAdminGamesState().tetris;
    for (let y = 0; y < piece.matrix.length; y++) {
        for (let x = 0; x < piece.matrix[y].length; x++) {
            if (!piece.matrix[y][x]) continue;
            const nx = piece.x + x;
            const ny = piece.y + y;
            if (nx < 0 || nx >= state.cols || ny >= state.rows) return true;
            if (ny >= 0 && state.board[ny][nx]) return true;
        }
    }
    return false;
}

function liveAdminMergeTetrisPiece() {
    const state = ensureLiveAdminGamesState().tetris;
    if (!state.current) return;
    state.current.matrix.forEach((row, y) => row.forEach((val, x) => {
        if (!val) return;
        const by = state.current.y + y;
        const bx = state.current.x + x;
        if (by >= 0 && by < state.rows && bx >= 0 && bx < state.cols) {
            state.board[by][bx] = state.current.color;
        }
    }));
}

function liveAdminClearTetrisLines() {
    const state = ensureLiveAdminGamesState().tetris;
    let cleared = 0;
    for (let y = state.rows - 1; y >= 0; y--) {
        if (state.board[y].every(cell => cell > 0)) {
            state.board.splice(y, 1);
            state.board.unshift(Array(state.cols).fill(0));
            cleared++;
            y++;
        }
    }
    if (cleared > 0) {
        state.lines += cleared;
        state.score += (cleared * cleared) * 100;
        state.dropInterval = Math.max(120, 500 - Math.floor(state.lines / 4) * 30);
    }
}

function liveAdminSpawnTetrisPiece() {
    const state = ensureLiveAdminGamesState().tetris;
    state.current = makeLiveAdminTetrisPiece();
    if (liveAdminTetrisCollision(state.current)) {
        state.gameOver = true;
        state.paused = true;
        state.active = false;
        if (state.rafId) cancelAnimationFrame(state.rafId);
        state.rafId = null;
    }
}

function liveAdminTetrisDropStep() {
    const state = ensureLiveAdminGamesState().tetris;
    if (!state.current || state.gameOver) return;
    state.current.y += 1;
    if (liveAdminTetrisCollision(state.current)) {
        state.current.y -= 1;
        liveAdminMergeTetrisPiece();
        liveAdminClearTetrisLines();
        liveAdminSpawnTetrisPiece();
    }
}

function liveAdminRotateMatrix(matrix) {
    const h = matrix.length;
    const w = matrix[0].length;
    const rotated = Array.from({ length: w }, () => Array(h).fill(0));
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            rotated[x][h - 1 - y] = matrix[y][x];
        }
    }
    return rotated;
}

function runLiveAdminTetrisLoop(ts) {
    const panel = document.getElementById('live-admin-mini-games');
    const state = ensureLiveAdminGamesState().tetris;
    if (!panel) {
        state.active = false;
        state.paused = true;
        state.rafId = null;
        return;
    }
    if (!state.active || state.paused || state.gameOver) {
        state.rafId = null;
        drawLiveAdminTetris();
        return;
    }

    if (!state.lastTs) state.lastTs = ts;
    if (ts - state.lastTs >= state.dropInterval) {
        state.lastTs = ts;
        liveAdminTetrisDropStep();
        drawLiveAdminTetris();
    }
    state.rafId = requestAnimationFrame(runLiveAdminTetrisLoop);
}

function liveAdminTetrisToggle() {
    const state = ensureLiveAdminGamesState().tetris;
    if (state.gameOver && !state.current) liveAdminTetrisReset();
    if (!state.current) liveAdminSpawnTetrisPiece();
    state.active = true;
    state.paused = !state.paused;
    if (!state.paused && !state.rafId) {
        state.lastTs = 0;
        state.rafId = requestAnimationFrame(runLiveAdminTetrisLoop);
    }
    drawLiveAdminTetris();
}

function liveAdminTetrisReset() {
    const state = ensureLiveAdminGamesState().tetris;
    state.board = Array.from({ length: state.rows }, () => Array(state.cols).fill(0));
    state.score = 0;
    state.lines = 0;
    state.dropInterval = 500;
    state.gameOver = false;
    state.active = false;
    state.paused = true;
    state.lastTs = 0;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = null;
    state.current = makeLiveAdminTetrisPiece();
    drawLiveAdminTetris();
}

function liveAdminTetrisMove(delta) {
    const state = ensureLiveAdminGamesState().tetris;
    if (!state.current || state.paused || state.gameOver) return;
    state.current.x += delta;
    if (liveAdminTetrisCollision(state.current)) state.current.x -= delta;
    drawLiveAdminTetris();
}

function liveAdminTetrisRotate() {
    const state = ensureLiveAdminGamesState().tetris;
    if (!state.current || state.paused || state.gameOver) return;
    const old = state.current.matrix;
    state.current.matrix = liveAdminRotateMatrix(old);
    if (liveAdminTetrisCollision(state.current)) state.current.matrix = old;
    drawLiveAdminTetris();
}

function liveAdminTetrisSoftDrop() {
    const state = ensureLiveAdminGamesState().tetris;
    if (!state.current || state.paused || state.gameOver) return;
    liveAdminTetrisDropStep();
    drawLiveAdminTetris();
}

function drawLiveAdminSnake() {
    const state = ensureLiveAdminGamesState().snake;
    const canvas = document.getElementById('live-snake-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(state.food.x * state.cell, state.food.y * state.cell, state.cell - 1, state.cell - 1);

    state.snake.forEach((part, idx) => {
        ctx.fillStyle = idx === 0 ? '#2ecc71' : '#27ae60';
        ctx.fillRect(part.x * state.cell, part.y * state.cell, state.cell - 1, state.cell - 1);
    });

    const scoreEl = document.getElementById('live-snake-score');
    const statusEl = document.getElementById('live-snake-status');
    if (scoreEl) scoreEl.innerText = String(state.score);
    if (statusEl) statusEl.innerText = state.gameOver ? 'Game Over' : (state.paused ? 'Paused' : 'Running');
}

function spawnLiveAdminSnakeFood() {
    const state = ensureLiveAdminGamesState().snake;
    const taken = new Set(state.snake.map(p => `${p.x},${p.y}`));
    let x = 0;
    let y = 0;
    let guard = 0;
    do {
        x = Math.floor(Math.random() * state.size);
        y = Math.floor(Math.random() * state.size);
        guard++;
    } while (taken.has(`${x},${y}`) && guard < 500);
    state.food = { x, y };
}

function tickLiveAdminSnake() {
    const panel = document.getElementById('live-admin-mini-games');
    const state = ensureLiveAdminGamesState().snake;
    if (!panel) {
        liveAdminSnakePause();
        return;
    }
    if (!state.active || state.paused || state.gameOver) {
        drawLiveAdminSnake();
        return;
    }

    state.direction = state.nextDirection;
    const head = { ...state.snake[0] };
    if (state.direction === 'up') head.y -= 1;
    if (state.direction === 'down') head.y += 1;
    if (state.direction === 'left') head.x -= 1;
    if (state.direction === 'right') head.x += 1;

    if (head.x < 0 || head.y < 0 || head.x >= state.size || head.y >= state.size) {
        state.gameOver = true;
        state.paused = true;
        state.active = false;
        liveAdminSnakePause();
        drawLiveAdminSnake();
        return;
    }

    if (state.snake.some(part => part.x === head.x && part.y === head.y)) {
        state.gameOver = true;
        state.paused = true;
        state.active = false;
        liveAdminSnakePause();
        drawLiveAdminSnake();
        return;
    }

    state.snake.unshift(head);
    if (head.x === state.food.x && head.y === state.food.y) {
        state.score += 10;
        spawnLiveAdminSnakeFood();
    } else {
        state.snake.pop();
    }

    drawLiveAdminSnake();
}

function liveAdminSnakePause() {
    const state = ensureLiveAdminGamesState().snake;
    if (state.timerId) {
        clearInterval(state.timerId);
        state.timerId = null;
    }
}

function liveAdminSnakeToggle() {
    const state = ensureLiveAdminGamesState().snake;
    if (state.gameOver) liveAdminSnakeReset();
    state.active = true;
    state.paused = !state.paused;
    if (!state.paused && !state.timerId) {
        state.timerId = setInterval(tickLiveAdminSnake, state.speed);
    } else if (state.paused) {
        liveAdminSnakePause();
    }
    drawLiveAdminSnake();
}

function liveAdminSnakeReset() {
    const state = ensureLiveAdminGamesState().snake;
    state.score = 0;
    state.gameOver = false;
    state.active = false;
    state.paused = true;
    state.direction = 'right';
    state.nextDirection = 'right';
    state.snake = [{ x: 4, y: 7 }, { x: 3, y: 7 }, { x: 2, y: 7 }];
    spawnLiveAdminSnakeFood();
    liveAdminSnakePause();
    drawLiveAdminSnake();
}

function liveAdminSnakeTurn(direction) {
    const state = ensureLiveAdminGamesState().snake;
    const current = state.direction;
    if ((current === 'up' && direction === 'down') ||
        (current === 'down' && direction === 'up') ||
        (current === 'left' && direction === 'right') ||
        (current === 'right' && direction === 'left')) {
        return;
    }
    state.nextDirection = direction;
}

function initAdminMiniGamesUI() {
    const panel = document.getElementById('live-admin-mini-games');
    if (!panel) return;
    ensureLiveAdminGamesState();
    if (!window.LIVE_ADMIN_GAMES.keybound) {
        window.addEventListener('keydown', (event) => {
            if (!document.getElementById('live-admin-mini-games')) return;
            const target = event.target;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;

            const key = String(event.key || '').toLowerCase();
            if (key === 'a') { event.preventDefault(); liveAdminTetrisMove(-1); return; }
            if (key === 'd') { event.preventDefault(); liveAdminTetrisMove(1); return; }
            if (key === 'w') { event.preventDefault(); liveAdminTetrisRotate(); return; }
            if (key === 's') { event.preventDefault(); liveAdminTetrisSoftDrop(); return; }
            if (key === 'arrowup') { event.preventDefault(); liveAdminSnakeTurn('up'); return; }
            if (key === 'arrowdown') { event.preventDefault(); liveAdminSnakeTurn('down'); return; }
            if (key === 'arrowleft') { event.preventDefault(); liveAdminSnakeTurn('left'); return; }
            if (key === 'arrowright') { event.preventDefault(); liveAdminSnakeTurn('right'); return; }
        });
        window.LIVE_ADMIN_GAMES.keybound = true;
    }

    const tetrisState = window.LIVE_ADMIN_GAMES.tetris;
    const snakeState = window.LIVE_ADMIN_GAMES.snake;
    if (!tetrisState.current) tetrisState.current = makeLiveAdminTetrisPiece();
    if (!snakeState.food) spawnLiveAdminSnakeFood();
    drawLiveAdminTetris();
    drawLiveAdminSnake();
}

function stopAdminMiniGamesLoops() {
    const state = ensureLiveAdminGamesState();
    if (state.tetris.rafId) cancelAnimationFrame(state.tetris.rafId);
    state.tetris.rafId = null;
    state.tetris.active = false;
    state.tetris.paused = true;
    liveAdminSnakePause();
    state.snake.active = false;
    state.snake.paused = true;
}

// --- ADMIN VIEW ---

function renderAdminLivePanel(container) {
    // FIX: Do not re-render if we are in the Summary/Finish view
    if (document.getElementById('live-summary-view')) return;

    const session = JSON.parse(localStorage.getItem('liveSession') || '{"active":false}');
    const showMiniGames = (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin');
    
    if (!session.active) {
        stopAdminMiniGamesLoops();
        container.innerHTML = `
            <div style="text-align:center; padding:50px; color:var(--text-muted);">
                <i class="fas fa-satellite-dish" style="font-size:4rem; margin-bottom:20px;"></i>
                <h3>No Active Session</h3>
                <p>Go to the <strong>Live Assessment</strong> tab and click "Start" on a booking to begin.</p>
                <button class="btn-primary" onclick="showTab('live-assessment')">Go to Bookings</button>
            </div>`;
        return;
    }

    // Load Test Data
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const test = tests.find(t => t.id == session.testId);
    
    if (!test) {
        stopAdminMiniGamesLoops();
        container.innerHTML = `<div class="alert alert-danger">Error: Linked Test ID not found. End session and check configuration. <button class="btn-danger btn-sm" onclick="endLiveSession()">End Session</button></div>`;
        return;
    }

    const currentQ = session.currentQ;
    const totalQ = test.questions.length;
    const q = currentQ >= 0 ? test.questions[currentQ] : null;

    // Build Question List Sidebar
    let qListHtml = test.questions.map((q, idx) => {
        let statusIcon = '<i class="far fa-circle"></i>';
        if (idx < currentQ) statusIcon = '<i class="fas fa-check-circle" style="color:green;"></i>';
        if (idx === currentQ) statusIcon = '<i class="fas fa-dot-circle" style="color:var(--primary);"></i>';
        
        return `
            <div class="live-q-item ${idx === currentQ ? 'active' : ''}" onclick="adminJumpToQuestion(${idx})" style="padding:10px; border-bottom:1px solid var(--border-color); cursor:pointer; display:flex; align-items:center; gap:10px;">
                ${statusIcon} <span>Q${idx+1}</span>
            </div>`;
    }).join('');

    // Main Area
    let mainHtml = '';
    if (currentQ === -1) {
        mainHtml = `
            <div style="text-align:center; padding:40px;">
                <h3>Ready to Start</h3>
                <p>Trainee: <strong>${session.trainee}</strong></p>
                <p>Test: <strong>${test.title}</strong></p>
                <button class="btn-primary btn-lg" onclick="adminPushQuestion(0)">Push Question 1</button>
            </div>`;
    } else if (q) {
        const rawAns = session.answers[currentQ];
        // Robust check for 0 (index) which is falsy in JS
        const hasAns = rawAns !== undefined && rawAns !== null && rawAns !== "";
        const traineeAns = hasAns ? (typeof rawAns === 'object' ? JSON.stringify(rawAns) : rawAns) : '<span style="color:var(--text-muted); font-style:italic;">Waiting for answer...</span>';
        const currentScore = session.scores[currentQ] || 0;
        const currentComment = session.comments[currentQ] || '';
        
        // Admin Note Display
        const adminNote = q.adminNotes ? `<div class="live-marker-note"><strong>Marker Note:</strong> ${q.adminNotes}</div>` : '';
        
        // Reference Button
        const refBtn = q.imageLink ? `<button class="btn-secondary btn-sm" onclick="openReferenceViewer('${q.imageLink}')" style="margin-top:5px;"><i class="fas fa-image"></i> View Reference</button>` : '';

        // Timer Logic
        const timer = session.timer || { active: false, duration: 300, start: null };
        const timeLeft = calculateTimeLeft(timer);
        const timerDisplay = formatTimer(timeLeft);

        mainHtml = `
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; height:100%;">
                <div class="card" style="overflow-y:auto;">
                    <h4>Admin Preview (Q${currentQ+1})</h4>
                    <div style="font-size:1.2rem; font-weight:bold; margin-bottom:15px;">${q.text}</div>
                    ${refBtn}
                    ${adminNote}
                    <div style="background:var(--bg-input); padding:10px; border-radius:4px;">
                        <small>Type: ${q.type}</small><br>
                        <small>Points: ${q.points || 1}</small>
                    </div>
                </div>
                
                <div class="card admin-interaction-active" style="display:flex; flex-direction:column; gap:15px;">
                    <div style="background:var(--bg-input); padding:10px; border-radius:4px; border:1px solid var(--border-color);">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                            <label style="font-size:0.8rem; font-weight:bold; margin:0;">Question Timer</label>
                            <span id="adminTimerDisplay" style="font-family:monospace; font-weight:bold; font-size:1.1rem; color:${timer.active ? '#e74c3c' : 'var(--text-main)'};">${timerDisplay}</span>
                        </div>
                        <div style="display:flex; gap:10px; align-items:center;">
                            <input type="number" id="liveTimerInput" value="${Math.ceil(timer.duration/60)}" min="1" style="width:70px; margin:0;" ${timer.active ? 'disabled' : ''}>
                            <span style="font-size:0.8rem; color:var(--text-muted);">min</span>
                            <button class="btn-sm ${timer.active ? 'btn-danger' : 'btn-success'}" onclick="toggleLiveTimer()" style="flex:1;">${timer.active ? 'Stop' : 'Start'}</button>
                        </div>
                    </div>

                    <div id="live-admin-answer-box" style="background:#000; color:#0f0; padding:10px; border-radius:4px; font-family:monospace; min-height:60px;">
                        <strong>TRAINEE ANSWER:</strong><br>
                        ${formatAdminAnswerPreview(q, rawAns)}
                    </div>
                    
                    <div>
                        <label>Score (Max ${q.points||1})</label>
                        <input type="number" id="liveScoreInput" value="${currentScore}" max="${q.points||1}" min="0" onchange="saveLiveScore(${currentQ}, this.value)">
                    </div>
                    
                    <div>
                        <label>Trainer Comment</label>
                        <textarea id="liveCommentInput" rows="3" spellcheck="true" onchange="saveLiveComment(${currentQ}, this.value)">${currentComment}</textarea>
                    </div>
                    
                    ${showMiniGames ? renderAdminMiniGamesPanel() : ''}

                    <div style="margin-top:auto; display:flex; justify-content:space-between;">
                        <button class="btn-secondary" onclick="adminPushQuestion(${currentQ-1})" ${currentQ===0?'disabled':''}>&lt; Prev</button>
                        ${currentQ < totalQ - 1 
                            ? `<button class="btn-primary" onclick="adminPushQuestion(${currentQ+1})">Next Question &gt;</button>` 
                            : `<button class="btn-success" onclick="finishLiveSession()">Finish Assessment</button>`
                        }
                    </div>
                </div>
            </div>`;
    }

    // SMART WRAPPER: Only rebuild the outer shell if we switch sessions or first load
    let wrapper = document.getElementById('admin-live-wrapper');
    if (!wrapper || wrapper.dataset.sessionId !== session.sessionId) {
        container.innerHTML = `
            <div id="admin-live-wrapper" data-session-id="${session.sessionId}" style="display:flex; height:calc(100vh - 180px); gap:10px;">
                <div style="width:200px; background:var(--bg-card); border-right:1px solid var(--border-color); overflow-y:auto; display:flex; flex-direction:column;">
                    <div style="padding:10px; font-weight:bold; background:var(--bg-input); position:sticky; top:0; z-index:1;">Questions</div>
                    <div id="admin-live-sidebar-list" style="flex:1;"></div>
                </div>
                <div style="flex:1; overflow-y:auto; display:flex; flex-direction:column;">
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid var(--border-color); margin-bottom:10px;">
                        <div style="display:flex; align-items:center; gap:15px;">
                            ${getAvatarHTML(session.trainee, 48)}
                            <div>
                                <div style="display:flex; align-items:center; gap:10px;">
                                    <h3 style="margin:0;">Live Session: ${session.trainee}</h3>
                                    <div id="socket-status" style="font-size:0.7rem; padding:2px 6px; border-radius:4px; background:var(--bg-input); border:1px solid var(--border-color);">
                                        <i class="fas fa-bolt"></i> ...
                                    </div>
                                </div>
                                <div style="display:flex; align-items:center; gap:10px; margin-top:3px;">
                                    <div id="live-conn-status" style="font-size:0.85rem; color:var(--text-muted);">
                                        Checking connection...
                                    </div>
                                    <button class="btn-secondary btn-sm" style="padding:2px 8px; font-size:0.75rem;" onclick="runLiveDiagnostics()" title="Send test packet to trainee"><i class="fas fa-satellite-dish"></i> Test Connection</button>
                                    <button class="btn-warning btn-sm" style="padding:2px 8px; font-size:0.75rem;" onclick="forceTraineeRefresh('${session.trainee.replace(/'/g, "\\'")}')" title="Force Trainee App to Refresh"><i class="fas fa-sync"></i> Force Refresh</button>
                                </div>
                            </div>
                        </div>
                        <button class="btn-danger btn-sm" onclick="endLiveSession()">Abort Session</button>
                    </div>
                    <div id="admin-live-main-area" style="flex:1;"></div>
                </div>
            </div>`;

        if (typeof updateLiveConnectionStatus === 'function') {
            updateLiveConnectionStatus(session.trainee);
            if (LIVE_CONN_INTERVAL) clearInterval(LIVE_CONN_INTERVAL);
            LIVE_CONN_INTERVAL = setInterval(() => { updateLiveConnectionStatus(session.trainee); }, 10000);
        }
        updateSocketStatusUI();
    }

    // SMOOTH DOM PATCHING
    document.getElementById('admin-live-sidebar-list').innerHTML = qListHtml;
    
    const mainArea = document.getElementById('admin-live-main-area');
    if (mainArea.dataset.currentQ !== String(currentQ)) {
        mainArea.style.animation = 'none';
        mainArea.offsetHeight; // Reflow
        mainArea.style.animation = 'fadeSlideUp 0.3s ease-out forwards';
        mainArea.innerHTML = mainHtml;
        mainArea.dataset.currentQ = String(currentQ);
    }

    if (showMiniGames && currentQ >= 0) initAdminMiniGamesUI();
}

function updateAdminLiveView() {
    // Helper to update just the answer box without redrawing inputs (preserves focus)
    const session = JSON.parse(localStorage.getItem('liveSession'));
    if (!session || !session.active) return;
    
    // Load current test definition once (used by both answer box and sidebar)
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const test = tests.find(t => t.id == session.testId);
    if (!test) return;

    // Update Timer Button State if changed remotely
    const timer = session.timer || { active: false };
    const timerBtn = document.querySelector('button[onclick="toggleLiveTimer()"]');
    const timerInput = document.getElementById('liveTimerInput');
    if (timerBtn) {
        timerBtn.className = `btn-sm ${timer.active ? 'btn-danger' : 'btn-success'}`;
        timerBtn.innerText = timer.active ? 'Stop' : 'Start';
    }
    if (timerInput) timerInput.disabled = timer.active;
    
    // 1. Update Answer Box (Current Question)
    if (session.currentQ !== -1) {
        const ansBox = document.getElementById('live-admin-answer-box');
        if (ansBox) {
            const ans = session.answers[session.currentQ];
            const hasAns = ans !== undefined && ans !== null && ans !== "";
            const displayAns = hasAns ? formatAdminAnswerPreview(test.questions[session.currentQ], ans) : '<span style="color:var(--text-muted); font-style:italic;">Waiting for answer...</span>';
            const html = `<strong>TRAINEE ANSWER:</strong><br>${displayAns}`;
            if (ansBox.innerHTML !== html) ansBox.innerHTML = html;
        }
    }

    // 2. Update Sidebar Status Icons (Checkmarks)
    // This ensures Admin sees progress without full re-render
    test.questions.forEach((q, idx) => {
        const itemIcon = document.querySelector(`.live-q-item[onclick="adminJumpToQuestion(${idx})"] i`);
        if (itemIcon) {
            const hasAns = session.answers[idx] !== undefined && session.answers[idx] !== null && session.answers[idx] !== "";
            const isCurrent = idx === session.currentQ;
            
            if (isCurrent) { itemIcon.className = "fas fa-dot-circle"; itemIcon.style.color = "var(--primary)"; }
            else if (hasAns) { itemIcon.className = "fas fa-check-circle"; itemIcon.style.color = "green"; }
            else { itemIcon.className = "far fa-circle"; itemIcon.style.color = ""; }
        }
    });
}

// --- CONNECTION HEALTH (ADMIN & TRAINEE VIEW) ---
async function updateLiveConnectionStatus(traineeUser, elementId = 'live-conn-status') {
    const el = document.getElementById(elementId);
    if (!el || !traineeUser) return;

    try {
        const data = window.ACTIVE_USERS_CACHE[traineeUser];

        if (!data) {
            el.innerHTML = '<i class="fas fa-question-circle" style="color:var(--text-muted);"></i> Connection: Unknown';
            return;
        }

        const lastSeen = data.local_received_at || Date.now();
        const now = Date.now();
        const ageMs = now - lastSeen;
        const online = ageMs < 90000; // seen in last 90s (Accommodates 60s heartbeat)
        const idleSecs = Math.round((data.idleTime || 0) / 1000);

        if (!online) {
            el.innerHTML = `<i class="fas fa-times-circle" style="color:#ff5252;"></i> Connection: Offline (last seen ${Math.round(ageMs/1000)}s ago)`;
        } else if (data.isIdle) {
            el.innerHTML = `<i class="fas fa-hourglass-half" style="color:#f1c40f;"></i> Connection: Online (Idle ${idleSecs}s)`;
        } else {
            el.innerHTML = `<i class="fas fa-check-circle" style="color:#2ecc71;"></i> Connection: Online (Active)`;
        }
    } catch (e) {
        el.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:var(--text-muted);"></i> Connection: Error';
    }
}

// --- HELPER: FORMAT ANSWER FOR ADMIN (Matrix/Visuals) ---
function formatAdminAnswerPreview(q, ans) {
    if (!q) return '';
    if (ans === undefined || ans === null || ans === "") return '<span style="color:var(--text-muted); font-style:italic;">Waiting for answer...</span>';

    if (q.type === 'matrix') {
        let html = '<table style="width:100%; border-collapse:collapse; font-size:0.8rem; color:#fff;">';
        (q.rows || []).forEach((r, rIdx) => {
            const userSelection = ans[rIdx];
            const correctSelection = q.correct ? q.correct[rIdx] : null;
            const colName = (q.cols && q.cols[userSelection]) ? q.cols[userSelection] : 'None';
            
            let icon = '';
            if (userSelection == correctSelection) icon = '<span style="color:#2ecc71;">✔</span>';
            else icon = '<span style="color:#ff5252;">✘</span>';
            
            html += `<tr><td style="padding:2px;">${r}</td><td style="padding:2px;">: <strong>${colName}</strong> ${icon}</td></tr>`;
        });
        html += '</table>';
        return html;
    }

    // FIX: Multiple Choice / Multi Select - Show Text instead of Index
    if (q.type === 'multiple_choice' && q.options && q.options[ans] !== undefined) {
        const optText = q.options[ans];
        return `${optText} <span style="color:var(--text-muted); font-size:0.8rem;">(Option ${parseInt(ans)+1})</span>`;
    }

    if (q.type === 'multi_select' && q.options && Array.isArray(ans)) {
        const texts = ans.map(idx => q.options[idx] || `Option ${parseInt(idx)+1}`);
        return texts.join(', ');
    }
    
    if (typeof ans === 'object') return JSON.stringify(ans);
    return ans;
}

// --- TRAINEE VIEW ---

function renderTraineeLivePanel(container) {
    // Set global flag for assessment.js input handlers
    window.IS_LIVE_ARENA = true;

    // Note: This function wipes the container. Only call if question changed.
    const session = JSON.parse(localStorage.getItem('liveSession') || '{"active":false}');
    
    if (!session.active || session.trainee !== CURRENT_USER.user) {
        container.innerHTML = `
            <div style="text-align:center; padding:100px; color:var(--text-muted);">
                <i class="fas fa-hourglass-half" style="font-size:5rem; margin-bottom:20px; opacity:0.5;"></i>
                <h1>Waiting for ${session.trainer || 'Trainer'}...</h1>
                <p>Your live assessment session has not started yet.</p>
            </div>`;
        return;
    }

    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const test = tests.find(t => t.id == session.testId);
    
    // SAFETY GUARD: If test hasn't synced to this device yet (Prevents fatal UI crash)
    if (!test) {
        container.innerHTML = `
            <div style="text-align:center; padding:100px; color:var(--text-muted);">
                <i class="fas fa-cloud-download-alt fa-bounce" style="font-size:4rem; margin-bottom:20px; color:var(--primary);"></i>
                <h2>Syncing Assessment Data...</h2>
                <p>Downloading test materials from the server.</p>
            </div>`;
        
        if (typeof loadFromServer === 'function' && !window._fetchingLiveTest) {
            window._fetchingLiveTest = true;
            loadFromServer(true).then(() => {
                window._fetchingLiveTest = false;
                renderTraineeLivePanel(container);
            });
        }
        return false; // Tell caller to not update LAST_RENDERED_Q
    }

    // SMART WRAPPER: Preserve the outer shell and timer to prevent visual thrashing
    let wrapper = document.getElementById('trainee-live-wrapper');
    if (!wrapper || wrapper.dataset.sessionId !== session.sessionId) {
        const timer = session.timer || { active: false, duration: 300, start: null };
        container.innerHTML = `
            <div id="trainee-live-wrapper" data-session-id="${session.sessionId}" style="max-width:95%; margin:0 auto; padding:20px;">
                <div style="margin-bottom:10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <h2 style="margin:0;">Live Assessment</h2>
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
                            <button class="btn-secondary btn-sm" style="width:auto;" onclick="openStudyNotesAssist('popup')" title="Open Study Notes without leaving this live session">
                                <i class="fas fa-note-sticky"></i> Study Notes
                            </button>
                            <div id="socket-status-trainee" style="font-size:0.7rem; padding:2px 6px; border-radius:4px; background:var(--bg-input); border:1px solid var(--border-color);">
                                <i class="fas fa-bolt"></i> ...
                            </div>
                        </div>
                    </div>
                    <div id="live-conn-status-trainee" style="font-size:0.85rem; color:var(--text-muted); margin-top:3px;">
                        Checking connection...
                    </div>
                    <div id="traineeTimerDisplay" style="text-align:center; font-size:1.5rem; font-weight:bold; color:${timer.active ? '#e74c3c' : 'var(--text-muted)'}; margin-top:10px;">
                        ${formatTimer(calculateTimeLeft(timer))}
                    </div>
                </div>
                <div class="progress-track" style="margin-bottom:20px;">
                    <div id="trainee-live-progress" class="progress-fill" style="width:0%"></div>
                </div>
                <div id="trainee-live-main"></div>
            </div>`;
            
        if (typeof updateLiveConnectionStatus === 'function') {
            updateLiveConnectionStatus(CURRENT_USER.user, 'live-conn-status-trainee');
            if (LIVE_CONN_INTERVAL) clearInterval(LIVE_CONN_INTERVAL);
            LIVE_CONN_INTERVAL = setInterval(() => { updateLiveConnectionStatus(CURRENT_USER.user, 'live-conn-status-trainee'); }, 10000);
        }
        updateSocketStatusUI();
    }

    const mainEl = document.getElementById('trainee-live-main');
    const progressEl = document.getElementById('trainee-live-progress');
    
    if (progressEl && test.questions && test.questions.length > 0) {
        progressEl.style.width = `${((session.currentQ+1)/test.questions.length)*100}%`;
    }

    let mainContent = '';
    let q = null;
    let isSubmitted = false;
    let btnText = '';

    if (session.currentQ === -1) {
        mainContent = `
            <div style="text-align:center; padding:50px; max-width: 800px; margin: 0 auto;">
                <h1>${test.title}</h1>
                <h3>Get Ready!</h3>
                <p>The trainer is about to begin the assessment.</p>
                
                <div style="background:var(--bg-input); border:1px solid var(--border-color); border-radius:8px; padding:20px; margin:30px 0; text-align:left;">
                    <h4 style="margin-top:0; color:var(--primary);"><i class="fas fa-info-circle"></i> Assessment Rules</h4>
                    <ul style="margin-bottom:0; line-height:1.6;">
                        <li>This assessment takes approximately <strong>1 hour</strong> to complete.</li>
                        <li>You are allowed to reference the training material. However, if the material is referenced constantly and it is clear the material was not studied, the live session will be ended.</li>
                        <li>If you are unable to answer a question within <strong>5 minutes</strong> of it being provided, the marks obtained for that question are final & the next question will be provided.</li>
                    </ul>
                </div>
                <div class="loader" style="margin:20px auto;"></div>
                <div style="color:var(--text-muted); font-size:0.9rem;">Waiting for trainer to push the first question...</div>
            </div>`;
    } else {
    q = test.questions[session.currentQ];
    let existingAns = session.answers[session.currentQ];

    // --- FIX: Initialize default answers for complex types if undefined (Prevents Matrix Reset) ---
    if (existingAns === undefined || existingAns === null) {
        if (q.type === 'ranking' || q.type === 'drag_drop') {
            existingAns = [...(q.items || [])];
            // Try to shuffle if helper exists
            if (typeof shuffleArray === 'function') existingAns = shuffleArray(existingAns);
        } else if (q.type === 'matching') {
            existingAns = new Array((q.pairs || []).length).fill("");
        } else if (q.type === 'matrix') {
            existingAns = {};
        } else if (q.type === 'multi_select') {
            existingAns = [];
        }
    }
    // ---------------------------------------------------------------------

    // Reuse renderQuestionInput from assessment.js but wrap for Big UI
    // We need to ensure window.USER_ANSWERS is set for the helper to work or mock it
    if (!window.USER_ANSWERS) window.USER_ANSWERS = {};
    window.USER_ANSWERS[session.currentQ] = existingAns;

    let inputHtml = '';
    if (typeof renderQuestionInput === 'function') {
        inputHtml = renderQuestionInput(q, session.currentQ);
    } else {
        inputHtml = '<p>Error: Input renderer not loaded.</p>';
    }

    isSubmitted = (session.answers[session.currentQ] !== undefined && session.answers[session.currentQ] !== null && session.answers[session.currentQ] !== "");

    btnText = (q.type === 'live_practical') ? 'Done' : (isSubmitted ? 'Update Answer' : 'Submit Answer');
    
    // Reference Button
    const refBtn = q.imageLink ? `<button class="btn-secondary btn-sm" onclick="openReferenceViewer('${q.imageLink}')" style="float:right; margin-left:10px;"><i class="fas fa-image"></i> View Reference</button>` : '';
    
        mainContent = `
        <div class="card" style="padding:40px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: start;">
                <div class="q-text-large" style="font-size:1.5rem; max-height: 65vh; overflow-y: auto; padding-right:15px;">${session.currentQ + 1}. ${q.text} ${refBtn} <span style="font-size:1rem; color:var(--text-muted); font-weight:normal; margin-left:10px;">(${q.points || 1} pts)</span></div>
                <div class="live-input-area" style="font-size:1.2rem; max-height: 65vh; overflow-y: auto; padding-right:15px;">
                    ${inputHtml}
                </div>
            </div>
            <div style="margin-top:40px; text-align:right; display:flex; justify-content:flex-end; align-items:center; gap:15px;">
                ${isSubmitted ? '<span id="submit-status" style="color:#2ecc71; font-weight:bold; font-size:1.1rem;"><i class="fas fa-check-circle"></i> Answer Submitted</span>' : '<span id="submit-status"></span>'}
                <button class="btn-primary btn-lg" onclick="submitLiveAnswer(${session.currentQ})">${btnText}</button>
            </div>
        </div>`;
    }
    
    // SMOOTH DOM PATCHING
    if (mainEl.dataset.currentQ !== String(session.currentQ)) {
        mainEl.style.animation = 'none';
        mainEl.offsetHeight; // Reflow
        mainEl.style.animation = 'fadeSlideUp 0.3s ease-out forwards';
        mainEl.innerHTML = mainContent;
        mainEl.dataset.currentQ = String(session.currentQ);
        
        if (session.currentQ !== -1) attachRealtimeListeners(session.currentQ);
    } else {
        // If same question, just patch the submission status text without wiping user inputs
        const statusSpan = document.getElementById('submit-status');
        if (statusSpan && isSubmitted && !statusSpan.innerHTML.includes('Answer Submitted')) {
             statusSpan.innerHTML = '<i class="fas fa-check-circle"></i> Answer Submitted';
             statusSpan.style.color = '#2ecc71';
             statusSpan.style.fontWeight = 'bold';
             statusSpan.style.fontSize = '1.1rem';
        }
        const btn = mainEl.querySelector('.btn-primary.btn-lg');
        if (btn && q) {
             if (btn.innerText !== btnText) btn.innerText = btnText;
        }
    }
    return true;
}

// --- REAL-TIME SYNC ENGINE ---
let REALTIME_SAVE_TIMEOUT = null;

function attachRealtimeListeners(qIdx) {
    const container = document.querySelector('.live-input-area');
    if(!container) return;

    // Listen to all input types (Text, Radio, Checkbox, Select)
    const inputs = container.querySelectorAll('input, textarea, select');
    inputs.forEach(input => {
        input.addEventListener('input', () => handleRealtimeInput(qIdx));
        input.addEventListener('change', () => handleRealtimeInput(qIdx));
    });
}

function handleRealtimeInput(qIdx) {
    // Wait briefly for assessment_core.js to update the global USER_ANSWERS object
    setTimeout(() => {
        const ans = window.USER_ANSWERS[qIdx];
        const session = JSON.parse(localStorage.getItem('liveSession'));
        
        // Only sync if data actually changed
        if (JSON.stringify(session.answers[qIdx]) !== JSON.stringify(ans)) {
            session.answers[qIdx] = ans;
            localStorage.setItem('liveSession', JSON.stringify(session));
            
            // Notify UI of unsaved changes pending upload
            if (typeof notifyUnsavedChanges === 'function') notifyUnsavedChanges();

            // Debounced Cloud Sync (1 second delay to prevent flooding)
            if (REALTIME_SAVE_TIMEOUT) clearTimeout(REALTIME_SAVE_TIMEOUT);
            REALTIME_SAVE_TIMEOUT = setTimeout(() => {
                updateGlobalSessionArray(session, false);
            }, 1000);
        }
    }, 50);
}

// --- ACTIONS ---

async function initiateLiveSession(bookingId, assessmentName, traineeName, assessmentId) {
    let resolvedAssessment = assessmentName;
    let resolvedTrainee = traineeName;
    let resolvedAssessmentId = assessmentId || null;

    if (bookingId && (!resolvedAssessment || !resolvedTrainee)) {
        const booking = getLiveBookingById(bookingId);
        if (booking) {
            if (booking.status === 'Cancelled') {
                alert("This booking was cancelled and cannot be started.");
                return;
            }
            resolvedAssessment = booking.assessment;
            resolvedTrainee = booking.trainee;
            resolvedAssessmentId = booking.assessmentId || null;
        }
    }

    if (!resolvedTrainee || !resolvedAssessment) {
        alert("Unable to start session. Booking details are missing.");
        return;
    }

    if (!confirm(`Start live session for ${resolvedTrainee}?`)) return;

    // --- ROBUSTNESS FIX: Clean up ALL previous sessions for this TRAINEE ---
    // This prevents loading a completed-but-not-ended session when starting a new one.
    if (window.supabaseClient) {
        const { error: deleteError } = await window.supabaseClient
            .from('live_sessions')
            .delete()
            .eq('data->>trainee', resolvedTrainee); // Target ALL sessions for this trainee
        
        if (deleteError) {
            console.warn("Stale session cleanup failed:", deleteError.message);
        } else {
            console.log(`Cleaned up all previous sessions for trainee: ${resolvedTrainee}.`);
        }
    }
    // --- END FIX ---

    // RACE CONDITION CHECK: Ensure session doesn't already exist
    // (Prevents double-clicks or two admins starting same slot)
    const allSessions = JSON.parse(localStorage.getItem('liveSessions') || '[]');
    const existing = allSessions.find(s => String(s.bookingId) === String(bookingId) && s.active);
    if (existing) {
        alert("A session is already active for this booking. Joining existing session...");
        localStorage.setItem('currentLiveSessionId', existing.sessionId);
        showTab('live-execution');
        loadLiveExecution();
        return;
    }

    // Find the Test Definition
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    // Match by title (assuming Admin named them identically as per instructions)
    const test = resolveLiveTestDefinition(tests, resolvedAssessment, resolvedAssessmentId);
    
    if (!test) {
        alert(`Error: No 'Live Assessment' test found with title '${resolvedAssessment}'.\nPlease create it in the Test Builder first.`);
        return;
    }

    const session = {
        sessionId: Date.now() + "_" + Math.random().toString(36).substr(2, 5), // Unique ID
        active: true,
        bookingId: bookingId,
        testId: test.id,
        assessmentId: test.id,
        startTime: Date.now(), // NEW: Track start time for staleness checks
        trainee: resolvedTrainee,
        trainer: CURRENT_USER.user,
        currentQ: -1,
        liveRevision: 1,
        lastUpdateTs: Date.now(),
        lastQuestionPushTs: 0,
        answers: {},
        scores: {},
        comments: {}
    };

    // 1. Update Local Proxy
    localStorage.setItem('liveSession', JSON.stringify(session));
    localStorage.setItem('currentLiveSessionId', session.sessionId); // Track what Admin is looking at
    
    // 1.5. Clean Local Array Immediately (Prevent Ghosting in UI before sync)
    let currentGlobal = JSON.parse(localStorage.getItem('liveSessions') || '[]');
    currentGlobal = currentGlobal.filter(s => normalizeLiveText(s.trainee) !== normalizeLiveText(resolvedTrainee)); // Remove old trainee sessions
    currentGlobal.push(session); // Add new one
    localStorage.setItem('liveSessions', JSON.stringify(currentGlobal));
    
    // 2. Update Global Array
    await updateGlobalSessionArray(session, false); // Safe Merge to prevent wiping other admins
    sendLiveSyncNudge(session, 'session_start').catch(()=>{});
    console.log(`Live Session Initiated for ${resolvedTrainee} (ID: ${session.sessionId})`);

    showTab('live-execution');
    loadLiveExecution();
}

async function adminPushQuestion(idx) {
    const session = JSON.parse(localStorage.getItem('liveSession'));
    if (!session) return;
    session.currentQ = idx;
    session.lastQuestionPushTs = Date.now();
    
    // Reset Timer on new question
    if (session.timer) {
        session.timer.active = false;
        session.timer.start = null;
    }

    localStorage.setItem('liveSession', JSON.stringify(session));
    
    await updateGlobalSessionArray(session, false);
    sendLiveSyncNudge(session, 'question_push').catch(()=>{});
    
    renderAdminLivePanel(document.getElementById('live-execution-content'));
}

async function adminJumpToQuestion(idx) {
    if(confirm("Jump to this question?")) adminPushQuestion(idx);
}

async function saveLiveScore(idx, val) {
    const session = JSON.parse(localStorage.getItem('liveSession'));
    session.scores[idx] = parseFloat(val);
    localStorage.setItem('liveSession', JSON.stringify(session));
    
    updateGlobalSessionArray(session, false); // Background save
}

async function saveLiveComment(idx, val) {
    const session = JSON.parse(localStorage.getItem('liveSession'));
    session.comments[idx] = val;
    localStorage.setItem('liveSession', JSON.stringify(session));
    
    updateGlobalSessionArray(session, false); // Background save
}

async function submitLiveAnswer(qIdx) {
    // Get answer from window.USER_ANSWERS (populated by renderQuestionInput helpers)
    let ans = window.USER_ANSWERS[qIdx];
    
    // FALLBACK: Scrape DOM if empty (Safety for fast clicks or missed events)
    if (ans === undefined || ans === null || ans === "") {
        const container = document.querySelector('.live-input-area');
        if (container) {
            const textInput = container.querySelector('textarea, input[type="text"]');
            if (textInput) ans = textInput.value;
            
            // Radio/Checkbox (Simple check)
            const checked = container.querySelector('input:checked');
            if (checked && !textInput) ans = checked.value; 
        }
    }

    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const session = JSON.parse(localStorage.getItem('liveSession'));
    const test = tests.find(t => t.id == session.testId);
    const q = test.questions[qIdx];

    // Allow empty for Practical (Auto-fill "Completed")
    if (q.type !== 'live_practical' && (ans === undefined || ans === null || ans === "")) {
        if(!confirm("Submit empty answer?")) return;
    }

    // For practical, if empty, mark as "Completed"
    const finalAns = (q.type === 'live_practical' && !ans) ? "Completed" : ans;
    
    session.answers[qIdx] = finalAns;
    
    // Update Global State to match (so render doesn't revert it)
    window.USER_ANSWERS[qIdx] = finalAns;
    
    localStorage.setItem('liveSession', JSON.stringify(session));
    
    // Force Sync so Admin sees it immediately
    const btn = document.querySelector('.btn-primary.btn-lg');
    if(btn) { btn.innerText = "Sending..."; btn.disabled = true; }
    
    try {
        await updateGlobalSessionArray(session, true); // Force push to ensure admin sees it
    } catch(e) { console.error("Sync Error:", e); }
    
    if(btn) { 
        // Check type to determine text
        const isPractical = q.type === 'live_practical';
        btn.innerText = isPractical ? "Done" : "Update Answer"; 
        btn.disabled = false;
        
        const statusSpan = document.getElementById('submit-status');
        if(statusSpan) {
            statusSpan.innerHTML = '<i class="fas fa-check-circle"></i> Answer Submitted';
            statusSpan.style.color = '#2ecc71';
            statusSpan.style.fontWeight = 'bold';
            statusSpan.style.fontSize = '1.1rem';
        }
    }
}

async function finishLiveSession() {
    // 1. Build Editable Summary View
    const session = JSON.parse(localStorage.getItem('liveSession'));
    
    // FIX: Scrape current inputs if visible (for the last question)
    const currentCommentInput = document.getElementById('liveCommentInput');
    const currentScoreInput = document.getElementById('liveScoreInput');
    if (currentCommentInput && session.currentQ !== -1) {
        session.comments[session.currentQ] = currentCommentInput.value;
    }
    if (currentScoreInput && session.currentQ !== -1) {
        session.scores[session.currentQ] = parseFloat(currentScoreInput.value) || 0;
    }
    localStorage.setItem('liveSession', JSON.stringify(session));

    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const test = tests.find(t => t.id == session.testId);

    let totalScore = 0;
    let maxScore = 0;
    
    let itemsHtml = test.questions.map((q, idx) => {
        const pts = parseFloat(q.points || 1);
        const currentScore = parseFloat(session.scores[idx] || 0);
        const currentComment = session.comments[idx] || '';
        const ans = session.answers[idx];
        const hasAns = ans !== undefined && ans !== null && ans !== "";
        
        maxScore += pts;
        totalScore += currentScore;

        let answerDisplay = '';
        if (q.type === 'live_practical') {
             answerDisplay = `<div style="font-style:italic; color:var(--text-muted);">Practical Task - See Notes below</div>`;
             if(hasAns) answerDisplay += `<div style="margin-top:5px; padding:5px; background:rgba(255,255,255,0.05);">${ans}</div>`;
        } else {
             answerDisplay = hasAns ? formatAdminAnswerPreview(q, ans) : '-';
        }

        return `
        <div class="marking-item" style="background:var(--bg-input); padding:15px; margin-bottom:15px; border-radius:8px; border:1px solid var(--border-color);">
            <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                <strong>Q${idx+1}: ${q.text}</strong>
                <span style="font-size:0.8rem; color:var(--text-muted);">Max: ${pts}</span>
            </div>
            
            <div style="margin-bottom:15px; padding:10px; background:var(--bg-card); border-radius:4px;">
                <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:5px;">TRAINEE ANSWER:</div>
                <div style="font-size:0.9rem;">${answerDisplay}</div>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 2fr; gap:15px;">
                <div>
                    <label style="font-size:0.8rem;">Score</label>
                    <input type="number" class="live-final-score" data-idx="${idx}" value="${currentScore}" max="${pts}" min="0" step="0.5" onchange="saveLiveScore(${idx}, this.value)">
                </div>
                <div>
                    <label style="font-size:0.8rem;">Comment</label>
                    <input type="text" class="live-final-comment" data-idx="${idx}" value="${currentComment}" placeholder="Feedback..." onchange="saveLiveComment(${idx}, this.value)">
                </div>
            </div>
        </div>`;
    }).join('');

    // 2. Inject Summary View (Replaces the Question View)
    const container = document.getElementById('live-execution-content');
    container.innerHTML = `
        <div id="live-summary-view"></div> <!-- Marker for refresh prevention -->
        <div class="card" style="max-width:900px; margin:20px auto; height:calc(100vh - 150px); display:flex; flex-direction:column;">
            <div style="border-bottom:1px solid var(--border-color); padding-bottom:15px; margin-bottom:15px;">
                <h2 style="margin:0;">Assessment Summary: ${session.trainee}</h2>
                <div style="margin-top:5px; color:var(--text-muted);">Review and finalize scores before submitting.</div>
            </div>
            
            <div style="flex:1; overflow-y:auto; padding-right:5px;">
                ${itemsHtml}
            </div>
            
            <div style="border-top:1px solid var(--border-color); padding-top:15px; margin-top:15px; display:flex; justify-content:space-between; align-items:center;">
                <button class="btn-secondary" onclick="document.getElementById('live-summary-view').remove(); loadLiveExecution()">Back to Grading</button>
                <button class="btn-success" onclick="confirmAndSaveLiveSession()">Confirm & Submit</button>
            </div>
        </div>
    `;
}

async function confirmAndSaveLiveSession() {
    const session = JSON.parse(localStorage.getItem('liveSession'));
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const test = tests.find(t => t.id == session.testId);

    // ROBUSTNESS: Scrape inputs to ensure latest edits are captured
    // FIX: Ensure container objects exist before assigning properties
    if (!session.comments) session.comments = {};
    if (!session.scores) session.scores = {};

    // (Fixes issue where comments don't save if user doesn't click away first)
    document.querySelectorAll('.live-final-comment').forEach(input => {
        const idx = input.getAttribute('data-idx');
        if(idx !== null) session.comments[idx] = input.value;
    });
    document.querySelectorAll('.live-final-score').forEach(input => {
        const idx = input.getAttribute('data-idx');
        if(idx !== null) session.scores[idx] = parseFloat(input.value) || 0;
    });

    // Recalculate Score (in case edits were made in summary view)
    let totalScore = 0;
    let maxScore = 0;
    test.questions.forEach((q, idx) => {
        maxScore += parseFloat(q.points || 1); // Default to 1 if missing
        totalScore += parseFloat(session.scores[idx] || 0);
    });
    const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

    // 1. Create Full Submission Record (For "View Completed Test" & Marking Queue)
    const submissions = JSON.parse(localStorage.getItem('submissions') || '[]');
    
    // DEDUPLICATION: Check if this booking/session already has a submission
    const existingSubIdx = submissions.findIndex(s => 
        (session.bookingId && String(s.bookingId) === String(session.bookingId)) || 
        (s.testId == test.id && s.trainee === session.trainee && s.date === new Date().toISOString().split('T')[0] && s.type === 'live')
    );

    const newSub = {
        id: (existingSubIdx > -1) ? submissions[existingSubIdx].id : Date.now().toString(),
        bookingId: session.bookingId, // Link to booking
        testId: test.id,
        testTitle: test.title,
        // SNAPSHOT: store full test definition at time of assessment
        testSnapshot: test,
        trainee: session.trainee,
        date: new Date().toISOString().split('T')[0],
        answers: session.answers,
        status: 'completed',
        score: percentage,
        type: 'live',
        marker: session.trainer,
        comments: session.comments, // Save comments
        scores: session.scores,     // Save individual scores
        assessmentId: test.id
    };

    if (existingSubIdx > -1) {
        submissions[existingSubIdx] = newSub;
    } else {
        submissions.push(newSub);
    }
    localStorage.setItem('submissions', JSON.stringify(submissions));

    // 2. Update Booking Status
    const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
    const booking = bookings.find(b => String(b.id) === String(session.bookingId));
    if (booking && booking.status !== 'Cancelled') {
        booking.status = 'Completed';
        booking.score = percentage;
        booking.assessmentId = booking.assessmentId || test.id;
        booking.lastModified = new Date().toISOString();
        booking.modifiedBy = CURRENT_USER?.user || 'system';
    }
    localStorage.setItem('liveBookings', JSON.stringify(bookings));

    // 3. Create Record (For Dashboard/Progress)
    const records = JSON.parse(localStorage.getItem('records') || '[]');
    
    // Determine Group ID dynamically
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    let groupId = "Live-Session";
    for (const [gid, members] of Object.entries(rosters)) {
        if (members.some(m => m.trim().toLowerCase() === session.trainee.trim().toLowerCase())) { 
            groupId = gid; 
            break; 
        }
    }
    
    // Determine Phase (Vetting vs Assessment)
    const phaseVal = test.title.toLowerCase().includes('vetting') ? 'Vetting' : 'Assessment';
    
    // DEDUPLICATION: Check if record exists
    const existingRecIdx = records.findIndex(r => 
        normalizeLiveText(r.trainee) === normalizeLiveText(session.trainee) &&
        (
            (r.assessmentId && String(r.assessmentId) === String(test.id)) ||
            normalizeLiveText(r.assessment) === normalizeLiveText(test.title)
        )
    );

    const newRecord = {
        id: Date.now() + "_" + Math.random().toString(36).substr(2, 9),
        groupID: groupId,
        trainee: session.trainee,
        assessment: test.title,
        score: percentage,
        date: new Date().toISOString().split('T')[0],
        phase: phaseVal,
        cycle: 'Live',
        link: 'Live-Session',
        docSaved: true,
        submissionId: newSub.id, // Link to specific submission
        assessmentId: test.id
    };

    if (existingRecIdx > -1) {
        records[existingRecIdx] = { ...records[existingRecIdx], ...newRecord, id: records[existingRecIdx].id };
    } else {
        records.push(newRecord);
    }
    localStorage.setItem('records', JSON.stringify(records));

    // 4/5. Close session authoritatively + sync assessment artifacts
    await closeLiveSessionAuthoritatively(session);
    if (typeof saveToServer === 'function') await saveToServer(['liveBookings', 'records', 'submissions'], true);

    if(typeof showToast === 'function') showToast(`Session Completed. Score: ${percentage}%`, "success");
    showTab('live-assessment');
}

async function endLiveSession() {
    if(!confirm("Abort session? Data will be lost.")) return;
    const session = JSON.parse(localStorage.getItem('liveSession'));
    await closeLiveSessionAuthoritatively(session);
    showTab('live-assessment');
}

// --- HELPER: SYNC LOCAL SESSION TO GLOBAL ARRAY ---
window.updateGlobalSessionArray = async function(localSession, force = true) {
    if (!localSession || !localSession.sessionId) return;

    const nowTs = Date.now();
    localSession.liveRevision = Math.max(1, Number(localSession.liveRevision || 0) + 1);
    localSession.lastUpdateTs = nowTs;

    // 1. Update Local Cache (for UI responsiveness)
    let allSessions = JSON.parse(localStorage.getItem('liveSessions') || '[]');
    allSessions = allSessions.filter(s => s.sessionId !== localSession.sessionId);
    allSessions.push(localSession);
    localStorage.setItem('liveSessions', JSON.stringify(allSessions));
    if (typeof emitDataChange === 'function') emitDataChange('liveSessions', 'local_write');
    
    // 2. Direct Table Upsert (More robust than full array push)
    if (window.supabaseClient) {
        const row = {
            id: localSession.sessionId,
            trainer: localSession.trainer,
            data: localSession,
            updated_at: new Date().toISOString()
        };

        // RETRY LOGIC: 3 Attempts with backoff to handle network instability
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const { error } = await window.supabaseClient
                    .from('live_sessions')
                    .upsert(row);
                
                if (error) throw error;
                break; // Success
            } catch (e) {
                console.warn(`Live Session Sync attempt ${attempt} failed:`, e);
                if (attempt === 3) {
                    console.error("Live Session Sync Final Failure:", e);
                    if (typeof showToast === 'function') showToast("Network unstable: Session sync failed.", "error");
                } else {
                    await new Promise(r => setTimeout(r, 500 * attempt)); // Backoff: 500ms, 1000ms
                }
            }
        }
    } else {
        // Fallback for offline/local-only mode
        if (typeof saveToServer === 'function') {
            await saveToServer(['liveSessions'], force);
        }
    }
}

// --- TIMER LOGIC ---

function toggleLiveTimer() {
    const session = JSON.parse(localStorage.getItem('liveSession'));
    if (!session.timer) session.timer = { active: false, duration: 300, start: null };
    
    if (session.timer.active) {
        // Stop
        session.timer.active = false;
        session.timer.start = null;
    } else {
        // Start
        const mins = parseInt(document.getElementById('liveTimerInput').value) || 5;
        session.timer.duration = mins * 60;
        session.timer.start = Date.now();
        session.timer.active = true;
    }
    
    localStorage.setItem('liveSession', JSON.stringify(session));
    updateGlobalSessionArray(session, false);
    
    // Immediate UI update
    const container = document.getElementById('live-execution-content');
    if (container) renderAdminLivePanel(container);
}

function calculateTimeLeft(timer) {
    if (!timer || !timer.active || !timer.start) return timer ? timer.duration : 0;
    const elapsed = Math.floor((Date.now() - timer.start) / 1000);
    return Math.max(0, timer.duration - elapsed);
}

function formatTimer(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function updateTimerDisplays() {
    const session = JSON.parse(localStorage.getItem('liveSession'));
    if (!session || !session.timer) return;
    
    const timeLeft = calculateTimeLeft(session.timer);
    const text = formatTimer(timeLeft);
    
    const adminDisplay = document.getElementById('adminTimerDisplay');
    if (adminDisplay) {
        adminDisplay.innerText = text;
        if (timeLeft === 0 && session.timer.active) adminDisplay.style.color = 'red';
        else if (session.timer.active) adminDisplay.style.color = '#e74c3c';
        else adminDisplay.style.color = 'var(--text-main)';
    }
    
    const traineeDisplay = document.getElementById('traineeTimerDisplay');
    if (traineeDisplay) {
        traineeDisplay.innerText = text;
        if (session.timer.active) {
            traineeDisplay.style.display = 'block';
            if (timeLeft <= 30) traineeDisplay.style.color = 'red'; // Warn last 30s
        } else {
            traineeDisplay.style.display = 'none';
        }
    }
}

// --- NEW: LIVE DIAGNOSTICS ENGINE ---

// --- NEW: GUARANTEED INSTANT FORCE REFRESH ---
window.forceTraineeRefresh = async function(traineeUsername) {
    if(!confirm(`Force ${traineeUsername}'s app to reload immediately?`)) return;
    
    // 1. Try Live Session Stream (Fastest)
    const session = JSON.parse(localStorage.getItem('liveSession'));
    if (session && session.active && session.trainee === traineeUsername) {
        session.remoteCommand = { action: 'restart', ts: Date.now() };
        localStorage.setItem('liveSession', JSON.stringify(session));
        if (typeof updateGlobalSessionArray === 'function') updateGlobalSessionArray(session, true).catch(()=>{});
    }
    
    // 2. Backup: Use Sessions Table (Global Fallback)
    if (window.supabaseClient) {
        window.supabaseClient.from('sessions').update({ pending_action: 'restart' }).eq('username', traineeUsername).then(()=>{});
    }
    if (typeof showToast === 'function') showToast(`Refresh command sent to ${traineeUsername}.`, "success");
};

window.runLiveDiagnostics = async function() {
    const session = JSON.parse(localStorage.getItem('liveSession'));
    if (!session || !session.active) return;
    
    session.diagnosticReq = Date.now();
    session.diagnosticRes = null;
    localStorage.setItem('liveSession', JSON.stringify(session));
    
    const el = document.getElementById('live-conn-status');
    if(el) el.innerHTML = '<i class="fas fa-spinner fa-spin" style="color:var(--primary);"></i> Pinging Trainee...';
    
    await updateGlobalSessionArray(session, true);
    sendLiveSyncNudge(session, 'diagnostic_ping').catch(()=>{});
    
    // Timeout fallback (Extended to 35 seconds to allow HTTP fallback loops if WebSockets are blocked)
    setTimeout(() => {
        const check = JSON.parse(localStorage.getItem('liveSession'));
        if (check.diagnosticReq === session.diagnosticReq && !check.diagnosticRes) {
            if(el) el.innerHTML = '<i class="fas fa-times-circle" style="color:#ff5252;"></i> Ping Timeout (Trainee unreachable)';
        }
    }, 35000);
};

window.showDiagnosticReport = function(rtt, net) {
    // Discard severely delayed ghost responses
    if (rtt > 60000) {
        console.warn(`Discarded stale diagnostic response (RTT: ${rtt}ms)`);
        return;
    }

    // Reset connection status text so it resumes normal polling display
    const session = JSON.parse(localStorage.getItem('liveSession'));
    if(typeof updateLiveConnectionStatus === 'function') updateLiveConnectionStatus(session.trainee);

    const modal = document.getElementById('diagnosticReportModal');
    if (modal) modal.remove();

    let netDetails = '<div style="color:var(--text-muted); font-style:italic;">No detailed network logs found on trainee machine.</div>';
    if (net && net.pings) {
        netDetails = `
            <table class="admin-table compressed-table" style="margin-top:10px;">
                <tr><td>Local Gateway (Router)</td><td style="font-family:monospace; color:${net.pings.gateway > 50 || net.pings.gateway === -1 ? '#ff5252' : '#2ecc71'}">${net.pings.gateway === -1 ? 'LOSS' : net.pings.gateway + ' ms'}</td></tr>
                <tr><td>Internet Connectivity</td><td style="font-family:monospace; color:${net.pings.internet > 150 || net.pings.internet === -1 ? '#ff5252' : '#2ecc71'}">${net.pings.internet === -1 ? 'LOSS' : net.pings.internet + ' ms'}</td></tr>
                <tr><td>Cloud DB (Supabase)</td><td style="font-family:monospace; color:${net.pings.server > 300 || net.pings.server === -1 ? '#ff5252' : '#2ecc71'}">${net.pings.server === -1 ? 'LOSS' : net.pings.server + ' ms'}</td></tr>
                <tr><td>Network Type</td><td>${net.stats?.connType || 'Unknown'}</td></tr>
                <tr><td>CPU / RAM Usage</td><td>${net.stats?.cpu}% / ${net.stats?.ram}GB</td></tr>
            </table>
        `;
    }

    const html = `
        <div id="diagnosticReportModal" class="modal-overlay" style="z-index: 15000;">
            <div class="modal-box" style="width: 500px; max-width: 95%;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid var(--border-color); padding-bottom:10px;">
                    <h3 style="margin:0;"><i class="fas fa-network-wired" style="color:var(--primary);"></i> Trainee Connection Report</h3>
                    <button class="btn-secondary" onclick="document.getElementById('diagnosticReportModal').remove()">&times;</button>
                </div>
                
                <div style="display:flex; align-items:center; justify-content:space-between; background:var(--bg-input); padding:15px; border-radius:8px; border:1px solid var(--border-color);">
                    <div>
                        <div style="font-size:0.8rem; color:var(--text-muted); text-transform:uppercase;">Round Trip Time (RTT)</div>
                        <div style="font-size:0.9rem;">App-layer ping to trainee & back</div>
                    </div>
                    <div style="font-size:2rem; font-weight:bold; color:${rtt > 1000 ? '#ff5252' : (rtt > 500 ? '#f1c40f' : '#2ecc71')}; font-family:monospace;">
                        ${rtt}ms
                    </div>
                </div>
                
                <div style="margin-top:15px;">
                    <strong style="font-size:0.9rem;">Trainee Internal Diagnostics (Last Snapshot):</strong>
                    ${netDetails}
                </div>

                <div style="display:flex; justify-content:space-between; margin-top:20px;">
                    <button class="btn-warning" onclick="if(typeof sendRemoteCommand === 'function') { sendRemoteCommand('${session.trainee}', 'restart'); document.getElementById('diagnosticReportModal').remove(); }"><i class="fas fa-sync"></i> Force Refresh App</button>
                    <button class="btn-primary" onclick="document.getElementById('diagnosticReportModal').remove()">Acknowledge</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
};

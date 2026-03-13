/* ================= LIVE ASSESSMENT EXECUTION ENGINE ================= */
/* Handles real-time interaction between Trainer (Admin) and Trainee */

let LIVE_POLLER = null;
let LAST_RENDERED_Q = -2; // Track rendered state to prevent UI thrashing
let LIVE_REALTIME_UNSUB = null;
let LIVE_FALLBACK_POLLER = null;
let LIVE_CONN_INTERVAL = null;
let LIVE_TIMER_INTERVAL = null;
let CURRENT_SOCKET_STATUS = 'CONNECTING';

function loadLiveExecution() {
    if (LIVE_POLLER) clearInterval(LIVE_POLLER);
    if (LIVE_FALLBACK_POLLER) clearInterval(LIVE_FALLBACK_POLLER);
    if (LIVE_REALTIME_UNSUB) { try { LIVE_REALTIME_UNSUB(); } catch (e) {} LIVE_REALTIME_UNSUB = null; }
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

    // Prefer Realtime (push) to reduce reads on free tier.
    // Fallback to polling if Realtime isn't available/configured.
    let usingRealtime = false;
    if (window.supabaseClient) {
        // NEW: Subscribe to TABLE changes (Row-Level)
        const channel = window.supabaseClient.channel('live_sessions_room')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'live_sessions' }, (payload) => {
                // Use payload directly (Push) instead of re-fetching (Pull)
                handleRealtimeLiveUpdate(payload);
            })
            .subscribe((status) => {
                CURRENT_SOCKET_STATUS = status;
                updateSocketStatusUI();
            });

        LIVE_REALTIME_UNSUB = () => { try { channel.unsubscribe(); } catch(e){} };
        usingRealtime = true;

        // Initial Sync
        syncLiveSessionState();
    }

    /* REMOVED OLD BLOB SUBSCRIPTION LOGIC
    if (typeof subscribeToDocKey === 'function') {
        LIVE_REALTIME_UNSUB = subscribeToDocKey('liveSessions', (content) => {
            // Keep local cache updated
            const allSessions = content || [];
            localStorage.setItem('liveSessions', JSON.stringify(allSessions));

            // Update my local "liveSession" proxy and UI using existing logic
            // (We reuse the same selector logic as the poller).
            let myServerSession = null;
            if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin' || CURRENT_USER.role === 'special_viewer') {
                const viewingId = localStorage.getItem('currentLiveSessionId');
                if (viewingId) {
                    myServerSession = allSessions.find(s => s.sessionId === viewingId) || null;
                }
                // REJOIN LOGIC: if no explicit viewingId or not found, attach to first session
                // where this user is the trainer
                if (!myServerSession) {
                    myServerSession = allSessions.find(s => s.trainer === CURRENT_USER.user && s.active) || { active: false };
                    if (myServerSession && myServerSession.sessionId) {
                        localStorage.setItem('currentLiveSessionId', myServerSession.sessionId);
                    }
                }
            } else {
                myServerSession = allSessions.find(s => s.trainee === CURRENT_USER.user && s.active) || { active: false };
            }

            const localSession = JSON.parse(localStorage.getItem('liveSession') || '{"active":false}');
            if (JSON.stringify(myServerSession) !== JSON.stringify(localSession)) {
                localStorage.setItem('liveSession', JSON.stringify(myServerSession));
                const c = document.getElementById('live-execution-content');
                if (c) {
                    if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin' || CURRENT_USER.role === 'special_viewer') {
                        if (!document.querySelector('.admin-interaction-active') || myServerSession.currentQ !== localSession.currentQ) {
                            renderAdminLivePanel(c);
                        } else {
                            updateAdminLiveView();
                        }
                    } else {
                        if (myServerSession.currentQ !== LAST_RENDERED_Q || myServerSession.active !== localSession.active) {
                            renderTraineeLivePanel(c);
                            LAST_RENDERED_Q = myServerSession.currentQ;
                        }
                    }
                }
            }
        });
        usingRealtime = !!LIVE_REALTIME_UNSUB;
    } */

    if (!usingRealtime) {
        // Start Polling for updates (1s) for immediate updates
        LIVE_POLLER = setInterval(syncLiveSessionState, 1000);
    } else {
        // Safety net: periodic poll (slow) to self-heal if events are missed
        LIVE_FALLBACK_POLLER = setInterval(syncLiveSessionState, 15000);
    }
}

// --- NEW: REALTIME PAYLOAD HANDLER (PUSH) ---
function handleRealtimeLiveUpdate(payload) {
    let allSessions = JSON.parse(localStorage.getItem('liveSessions') || '[]');
    
    if (payload.eventType === 'DELETE') {
        allSessions = allSessions.filter(s => s.sessionId !== payload.old.id);
    } else {
        const newData = payload.new.data;
        // Ensure ID matches row ID
        if (newData) {
            if (!newData.sessionId) newData.sessionId = payload.new.id;
            allSessions = allSessions.filter(s => s.sessionId !== newData.sessionId);
            allSessions.push(newData);
        }
    }
    localStorage.setItem('liveSessions', JSON.stringify(allSessions));
    
    // Update UI from local cache
    processLiveSessionState(allSessions);
}

async function syncLiveSessionState() {
    // TARGETED POLLING (Efficient & Stable)
    // Matches Vetting Arena logic to prevent full re-renders wiping user input
    if (!window.supabaseClient) return;

    // Fetch from TABLE (live_sessions)
    const { data: rows, error } = await window.supabaseClient
        .from('live_sessions')
        .select('data');

    if (rows) {
        // Map rows back to array format
        const allSessions = rows.map(r => r.data);
        localStorage.setItem('liveSessions', JSON.stringify(allSessions));

        processLiveSessionState(allSessions);
    }
}

// --- HELPER: PROCESS STATE (Shared by Poller & Realtime) ---
function processLiveSessionState(allSessions) {
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
        myServerSession = validSessions.length > 0 ? validSessions[0] : { active: false };
    }

    // PRESERVE LOCAL ANSWERS (Trainee Only)
    if (CURRENT_USER.role !== 'admin' && CURRENT_USER.role !== 'super_admin' && CURRENT_USER.role !== 'special_viewer' && myServerSession.active) {
        const currentLocal = JSON.parse(localStorage.getItem('liveSession') || '{}');
        if (currentLocal.answers) {
            myServerSession.answers = { ...myServerSession.answers, ...currentLocal.answers };
        }
    }

    // Update the local "Active Session" proxy for UI rendering
    
    // Only update if state actually changed
    if (JSON.stringify(myServerSession) !== JSON.stringify(localSession)) {
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
                if (myServerSession.currentQ !== LAST_RENDERED_Q || myServerSession.active !== localSession.active) {
                    renderTraineeLivePanel(container);
                    LAST_RENDERED_Q = myServerSession.currentQ;
                }
            }
        }
    }
}

// --- SOCKET STATUS UI HELPER ---
function updateSocketStatusUI() {
    const els = [document.getElementById('socket-status'), document.getElementById('socket-status-trainee')];
    const status = CURRENT_SOCKET_STATUS;
    
    let color = '#95a5a6'; // Grey
    let text = 'Connecting...';
    let icon = 'fa-bolt';
    
    if (status === 'SUBSCRIBED') { color = '#2ecc71'; text = 'Realtime Active'; }
    else if (status === 'TIMED_OUT') { color = '#f1c40f'; text = 'Reconnecting...'; }
    else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') { color = '#ff5252'; text = 'Socket Offline'; icon = 'fa-exclamation-triangle'; }
    
    els.forEach(el => {
        if (el) {
            el.innerHTML = `<i class="fas ${icon}" style="color:${color}; margin-right:5px;"></i> ${text}`;
            el.style.borderColor = color;
            el.title = `Socket Status: ${status}`;
        }
    });
}

// --- ADMIN VIEW ---

function renderAdminLivePanel(container) {
    // FIX: Do not re-render if we are in the Summary/Finish view
    if (document.getElementById('live-summary-view')) return;

    const session = JSON.parse(localStorage.getItem('liveSession') || '{"active":false}');
    
    if (!session.active) {
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

    container.innerHTML = `
        <div style="display:flex; height:calc(100vh - 180px); gap:10px;">
            <div style="width:200px; background:var(--bg-card); border-right:1px solid var(--border-color); overflow-y:auto;">
                <div style="padding:10px; font-weight:bold; background:var(--bg-input);">Questions</div>
                ${qListHtml}
            </div>
            <div style="flex:1; overflow-y:auto;">
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
                            <div id="live-conn-status" style="font-size:0.85rem; color:var(--text-muted); margin-top:3px;">
                                Checking connection...
                            </div>
                        </div>
                    </div>
                    <button class="btn-danger btn-sm" onclick="endLiveSession()">Abort Session</button>
                </div>
                ${mainHtml}
            </div>
        </div>`;

    // Start connection status polling for this trainee
    if (typeof updateLiveConnectionStatus === 'function') {
        updateLiveConnectionStatus(session.trainee);
        if (LIVE_CONN_INTERVAL) clearInterval(LIVE_CONN_INTERVAL);
        LIVE_CONN_INTERVAL = setInterval(() => {
            updateLiveConnectionStatus(session.trainee);
        }, 10000); // every 10s while panel is open
    }
    updateSocketStatusUI();
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
    if (!el || !window.supabaseClient || !traineeUser) return;

    try {
        const { data, error } = await window.supabaseClient
            .from('sessions')
            .select('lastSeen, idleTime, isIdle')
            .eq('username', traineeUser)
            .single();

        if (error || !data) {
            el.innerHTML = '<i class="fas fa-question-circle" style="color:var(--text-muted);"></i> Connection: Unknown';
            return;
        }

        const lastSeen = new Date(data.lastSeen).getTime();
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
    
    if (session.currentQ === -1) {
        container.innerHTML = `
            <div style="text-align:center; padding:50px; max-width: 800px; margin: 0 auto;">
                <h1>${test ? test.title : 'Live Assessment'}</h1>
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
        return;
    }

    const q = test.questions[session.currentQ];
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

    const isSubmitted = (session.answers[session.currentQ] !== undefined && session.answers[session.currentQ] !== null && session.answers[session.currentQ] !== "");

    const btnText = (q.type === 'live_practical') ? 'Done' : (isSubmitted ? 'Update Answer' : 'Submit Answer');
    
    // Reference Button
    const refBtn = q.imageLink ? `<button class="btn-secondary btn-sm" onclick="openReferenceViewer('${q.imageLink}')" style="float:right; margin-left:10px;"><i class="fas fa-image"></i> View Reference</button>` : '';
    
    // Timer
    const timer = session.timer || { active: false, duration: 300, start: null };

    container.innerHTML = `
        <div style="max-width:95%; margin:0 auto; padding:20px;">
            <div style="margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h2 style="margin:0;">Live Assessment</h2>
                    <div id="socket-status-trainee" style="font-size:0.7rem; padding:2px 6px; border-radius:4px; background:var(--bg-input); border:1px solid var(--border-color);">
                        <i class="fas fa-bolt"></i> ...
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
                <div class="progress-fill" style="width:${((session.currentQ+1)/test.questions.length)*100}%"></div>
            </div>
            
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
            </div>
        </div>`;

    // NEW: Attach listeners for Real-time Admin Monitoring (Typing/Selecting)
    attachRealtimeListeners(session.currentQ);

    // Trainee-side connection hint (simple, read-only)
    if (typeof updateLiveConnectionStatus === 'function') {
        updateLiveConnectionStatus(CURRENT_USER.user, 'live-conn-status-trainee');
        if (LIVE_CONN_INTERVAL) clearInterval(LIVE_CONN_INTERVAL);
        LIVE_CONN_INTERVAL = setInterval(() => {
            updateLiveConnectionStatus(CURRENT_USER.user, 'live-conn-status-trainee');
        }, 10000);
    }
    updateSocketStatusUI();
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

async function initiateLiveSession(bookingId, assessmentName, traineeName) {
    if (!confirm(`Start live session for ${traineeName}?`)) return;

    // --- ROBUSTNESS FIX: Clean up ALL previous sessions for this TRAINEE ---
    // This prevents loading a completed-but-not-ended session when starting a new one.
    if (window.supabaseClient) {
        const { error: deleteError } = await window.supabaseClient
            .from('live_sessions')
            .delete()
            .eq('data->>trainee', traineeName); // Target ALL sessions for this trainee
        
        if (deleteError) {
            console.warn("Stale session cleanup failed:", deleteError.message);
        } else {
            console.log(`Cleaned up all previous sessions for trainee: ${traineeName}.`);
        }
    }
    // --- END FIX ---

    // RACE CONDITION CHECK: Ensure session doesn't already exist
    // (Prevents double-clicks or two admins starting same slot)
    const allSessions = JSON.parse(localStorage.getItem('liveSessions') || '[]');
    const existing = allSessions.find(s => s.bookingId === bookingId && s.active);
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
    const test = tests.find(t => t.title === assessmentName && t.type === 'live');
    
    if (!test) {
        alert(`Error: No 'Live Assessment' test found with title '${assessmentName}'.\nPlease create it in the Test Builder first.`);
        return;
    }

    const session = {
        sessionId: Date.now() + "_" + Math.random().toString(36).substr(2, 5), // Unique ID
        active: true,
        bookingId: bookingId,
        testId: test.id,
        startTime: Date.now(), // NEW: Track start time for staleness checks
        trainee: traineeName,
        trainer: CURRENT_USER.user,
        currentQ: -1,
        answers: {},
        scores: {},
        comments: {}
    };

    // 1. Update Local Proxy
    localStorage.setItem('liveSession', JSON.stringify(session));
    localStorage.setItem('currentLiveSessionId', session.sessionId); // Track what Admin is looking at
    
    // 1.5. Clean Local Array Immediately (Prevent Ghosting in UI before sync)
    let currentGlobal = JSON.parse(localStorage.getItem('liveSessions') || '[]');
    currentGlobal = currentGlobal.filter(s => s.trainee !== traineeName); // Remove old trainee sessions
    currentGlobal.push(session); // Add new one
    localStorage.setItem('liveSessions', JSON.stringify(currentGlobal));
    
    // 2. Update Global Array
    await updateGlobalSessionArray(session, false); // Safe Merge to prevent wiping other admins
    console.log(`Live Session Initiated for ${traineeName} (ID: ${session.sessionId})`);

    showTab('live-execution');
    loadLiveExecution();
}

async function adminPushQuestion(idx) {
    const session = JSON.parse(localStorage.getItem('liveSession'));
    session.currentQ = idx;
    
    // Reset Timer on new question
    if (session.timer) {
        session.timer.active = false;
        session.timer.start = null;
    }

    localStorage.setItem('liveSession', JSON.stringify(session));
    
    await updateGlobalSessionArray(session, false);
    
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
        (session.bookingId && s.bookingId === session.bookingId) || 
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
        scores: session.scores      // Save individual scores
    };

    if (existingSubIdx > -1) {
        submissions[existingSubIdx] = newSub;
    } else {
        submissions.push(newSub);
    }
    localStorage.setItem('submissions', JSON.stringify(submissions));

    // 2. Update Booking Status
    const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
    const booking = bookings.find(b => b.id === session.bookingId);
    if (booking && booking.status !== 'Cancelled') {
        booking.status = 'Completed';
        booking.score = percentage;
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
        r.trainee === session.trainee && 
        r.assessment === test.title
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
        submissionId: newSub.id // Link to specific submission
    };

    if (existingRecIdx > -1) {
        records[existingRecIdx] = { ...records[existingRecIdx], ...newRecord, id: records[existingRecIdx].id };
    } else {
        records.push(newRecord);
    }
    localStorage.setItem('records', JSON.stringify(records));

    // 4. Clear Session
    session.active = false;
    localStorage.setItem('liveSession', JSON.stringify(session));

    // 5. Sync All
    await updateGlobalSessionArray(session, false); // Sync session state first
    if (typeof saveToServer === 'function') await saveToServer(['liveBookings', 'records', 'submissions'], false);
    
    // HARD DELETE: Remove completed session from real-time table to prevent bloat
    if (window.supabaseClient && session.sessionId) {
        // Use 'safe' delete (fire and forget) to prevent UI hang on network error
        // We don't await this because the local state is already cleared.
        window.supabaseClient.from('live_sessions').delete().eq('id', session.sessionId).then(() => {});
    }

    if(typeof showToast === 'function') showToast(`Session Completed. Score: ${percentage}%`, "success");
    showTab('live-assessment');
}

async function endLiveSession() {
    if(!confirm("Abort session? Data will be lost.")) return;
    const session = JSON.parse(localStorage.getItem('liveSession'));
    session.active = false;
    localStorage.setItem('liveSession', JSON.stringify(session));
    
    // HARD DELETE: Remove active session row from server to prevent stale data
    if (window.supabaseClient && session.sessionId) {
        await window.supabaseClient.from('live_sessions').delete().eq('id', session.sessionId);
    }

    await updateGlobalSessionArray(session, false);
    showTab('live-assessment');
}

// --- HELPER: SYNC LOCAL SESSION TO GLOBAL ARRAY ---
window.updateGlobalSessionArray = async function(localSession, force = true) {
    // 1. Update Local Cache (for UI responsiveness)
    let allSessions = JSON.parse(localStorage.getItem('liveSessions') || '[]');
    allSessions = allSessions.filter(s => s.sessionId !== localSession.sessionId);
    allSessions.push(localSession);
    localStorage.setItem('liveSessions', JSON.stringify(allSessions));
    
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
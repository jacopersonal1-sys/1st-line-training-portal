/* ================= LIVE ASSESSMENT EXECUTION ENGINE ================= */
/* Handles real-time interaction between Trainer (Admin) and Trainee */

let LIVE_POLLER = null;

function loadLiveExecution() {
    if (LIVE_POLLER) clearInterval(LIVE_POLLER);
    
    const container = document.getElementById('live-execution-content');
    if (!container) return;

    if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'special_viewer') {
        renderAdminLivePanel(container);
    } else {
        renderTraineeLivePanel(container);
    }

    // Start Polling for updates (Real-time sync)
    LIVE_POLLER = setInterval(syncLiveSessionState, 2000);
}

async function syncLiveSessionState() {
    // Pull latest state
    if (typeof loadFromServer === 'function') {
        // We use silent load to update local storage without UI disruption
        // The render functions will react to localStorage changes
        await loadFromServer(true); 
        
        const container = document.getElementById('live-execution-content');
        if (container && !document.querySelector('.admin-interaction-active')) {
            // Only re-render if user isn't actively typing/interacting
            if (CURRENT_USER.role !== 'admin') renderTraineeLivePanel(container);
            else updateAdminLiveView(); // Partial update for Admin
        }
    }
}

// --- ADMIN VIEW ---

function renderAdminLivePanel(container) {
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
        const traineeAns = session.answers[currentQ] ? JSON.stringify(session.answers[currentQ]) : '<span style="color:var(--text-muted); font-style:italic;">Waiting for answer...</span>';
        const currentScore = session.scores[currentQ] || 0;
        const currentComment = session.comments[currentQ] || '';

        mainHtml = `
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; height:100%;">
                <div class="card" style="overflow-y:auto;">
                    <h4>Admin Preview (Q${currentQ+1})</h4>
                    <div style="font-size:1.2rem; font-weight:bold; margin-bottom:15px;">${q.text}</div>
                    <div style="background:var(--bg-input); padding:10px; border-radius:4px;">
                        <small>Type: ${q.type}</small><br>
                        <small>Points: ${q.points || 1}</small>
                    </div>
                </div>
                
                <div class="card admin-interaction-active" style="display:flex; flex-direction:column; gap:15px;">
                    <div style="background:#000; color:#0f0; padding:10px; border-radius:4px; font-family:monospace; min-height:60px;">
                        <strong>TRAINEE ANSWER:</strong><br>
                        ${traineeAns}
                    </div>
                    
                    <div>
                        <label>Score (Max ${q.points||1})</label>
                        <input type="number" id="liveScoreInput" value="${currentScore}" max="${q.points||1}" min="0" onchange="saveLiveScore(${currentQ}, this.value)">
                    </div>
                    
                    <div>
                        <label>Trainer Comment</label>
                        <textarea id="liveCommentInput" rows="3" onchange="saveLiveComment(${currentQ}, this.value)">${currentComment}</textarea>
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
                    <h3 style="margin:0;">Live Session: ${session.trainee}</h3>
                    <button class="btn-danger btn-sm" onclick="endLiveSession()">Abort Session</button>
                </div>
                ${mainHtml}
            </div>
        </div>`;
}

function updateAdminLiveView() {
    // Helper to update just the answer box without redrawing inputs (preserves focus)
    const session = JSON.parse(localStorage.getItem('liveSession'));
    if (!session.active || session.currentQ === -1) return;
    
    const ansBox = document.querySelector('.admin-interaction-active div[style*="background:#000"]');
    if (ansBox) {
        const ans = session.answers[session.currentQ];
        const html = `<strong>TRAINEE ANSWER:</strong><br>${ans ? JSON.stringify(ans) : '<span style="color:var(--text-muted); font-style:italic;">Waiting for answer...</span>'}`;
        if (ansBox.innerHTML !== html) ansBox.innerHTML = html;
    }
}

// --- TRAINEE VIEW ---

function renderTraineeLivePanel(container) {
    const session = JSON.parse(localStorage.getItem('liveSession') || '{"active":false}');
    
    if (!session.active || session.trainee !== CURRENT_USER.user) {
        container.innerHTML = `
            <div style="text-align:center; padding:100px; color:var(--text-muted);">
                <i class="fas fa-hourglass-half" style="font-size:5rem; margin-bottom:20px; opacity:0.5;"></i>
                <h1>Waiting for Trainer...</h1>
                <p>Your live assessment session has not started yet.</p>
            </div>`;
        return;
    }

    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const test = tests.find(t => t.id == session.testId);
    
    if (session.currentQ === -1) {
        container.innerHTML = `
            <div style="text-align:center; padding:100px;">
                <h1>${test ? test.title : 'Live Assessment'}</h1>
                <h3>Get Ready!</h3>
                <p>The trainer is about to begin the assessment.</p>
                <div class="loader" style="margin:20px auto;"></div>
            </div>`;
        return;
    }

    const q = test.questions[session.currentQ];
    const existingAns = session.answers[session.currentQ];

    // Reuse renderQuestionInput from assessment.js but wrap for Big UI
    // We need to ensure window.USER_ANSWERS is set for the helper to work or mock it
    // Mocking window.USER_ANSWERS for the helper
    if (!window.USER_ANSWERS) window.USER_ANSWERS = {};
    window.USER_ANSWERS[session.currentQ] = existingAns;

    let inputHtml = '';
    if (typeof renderQuestionInput === 'function') {
        inputHtml = renderQuestionInput(q, session.currentQ);
    } else {
        inputHtml = '<p>Error: Input renderer not loaded.</p>';
    }

    container.innerHTML = `
        <div style="max-width:800px; margin:0 auto; padding:20px;">
            <div class="progress-track" style="margin-bottom:20px;">
                <div class="progress-fill" style="width:${((session.currentQ+1)/test.questions.length)*100}%"></div>
            </div>
            
            <div class="card" style="padding:40px;">
                <h2 style="font-size:2rem; margin-bottom:30px;">${session.currentQ + 1}. ${q.text}</h2>
                
                <div class="live-input-area" style="font-size:1.2rem;">
                    ${inputHtml}
                </div>

                <div style="margin-top:40px; text-align:right;">
                    <button class="btn-primary btn-lg" onclick="submitLiveAnswer(${session.currentQ})">Submit Answer</button>
                </div>
            </div>
        </div>`;
}

// --- ACTIONS ---

async function initiateLiveSession(bookingId, assessmentName, traineeName) {
    if (!confirm(`Start live session for ${traineeName}?`)) return;

    // Find the Test Definition
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    // Match by title (assuming Admin named them identically as per instructions)
    const test = tests.find(t => t.title === assessmentName && t.type === 'live');
    
    if (!test) {
        alert(`Error: No 'Live Assessment' test found with title '${assessmentName}'.\nPlease create it in the Test Builder first.`);
        return;
    }

    const session = {
        active: true,
        bookingId: bookingId,
        testId: test.id,
        trainee: traineeName,
        trainer: CURRENT_USER.user,
        currentQ: -1,
        answers: {},
        scores: {},
        comments: {}
    };

    localStorage.setItem('liveSession', JSON.stringify(session));
    
    // Force Sync
    if (typeof saveToServer === 'function') await saveToServer(['liveSession'], true);

    showTab('live-execution');
    loadLiveExecution();
}

async function adminPushQuestion(idx) {
    const session = JSON.parse(localStorage.getItem('liveSession'));
    session.currentQ = idx;
    localStorage.setItem('liveSession', JSON.stringify(session));
    
    if (typeof saveToServer === 'function') await saveToServer(['liveSession'], true);
    
    renderAdminLivePanel(document.getElementById('live-execution-content'));
}

async function adminJumpToQuestion(idx) {
    if(confirm("Jump to this question?")) adminPushQuestion(idx);
}

async function saveLiveScore(idx, val) {
    const session = JSON.parse(localStorage.getItem('liveSession'));
    session.scores[idx] = parseFloat(val);
    localStorage.setItem('liveSession', JSON.stringify(session));
    // Background save
    if (typeof saveToServer === 'function') saveToServer(['liveSession'], false);
}

async function saveLiveComment(idx, val) {
    const session = JSON.parse(localStorage.getItem('liveSession'));
    session.comments[idx] = val;
    localStorage.setItem('liveSession', JSON.stringify(session));
    // Background save
    if (typeof saveToServer === 'function') saveToServer(['liveSession'], false);
}

async function submitLiveAnswer(qIdx) {
    // Get answer from window.USER_ANSWERS (populated by renderQuestionInput helpers)
    const ans = window.USER_ANSWERS[qIdx];
    
    if (ans === undefined || ans === null || ans === "") {
        if(!confirm("Submit empty answer?")) return;
    }

    const session = JSON.parse(localStorage.getItem('liveSession'));
    session.answers[qIdx] = ans;
    localStorage.setItem('liveSession', JSON.stringify(session));
    
    // Force Sync so Admin sees it immediately
    const btn = document.querySelector('.btn-primary.btn-lg');
    if(btn) { btn.innerText = "Sending..."; btn.disabled = true; }
    
    if (typeof saveToServer === 'function') await saveToServer(['liveSession'], true);
    
    if(btn) { btn.innerText = "Sent!"; }
}

async function finishLiveSession() {
    if (!confirm("Finish assessment and save results?")) return;

    const session = JSON.parse(localStorage.getItem('liveSession'));
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const test = tests.find(t => t.id == session.testId);

    // Calculate Score
    let totalScore = 0;
    let maxScore = 0;
    test.questions.forEach((q, idx) => {
        maxScore += parseFloat(q.points || 1);
        totalScore += (session.scores[idx] || 0);
    });

    const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

    // 1. Update Booking Status
    const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
    const booking = bookings.find(b => b.id === session.bookingId);
    if (booking) {
        booking.status = 'Completed';
        booking.score = percentage;
    }
    localStorage.setItem('liveBookings', JSON.stringify(bookings));

    // 2. Create Record
    const records = JSON.parse(localStorage.getItem('records') || '[]');
    records.push({
        id: Date.now() + "_" + Math.random().toString(36).substr(2, 9),
        groupID: "Live-Session", // Could lookup real group
        trainee: session.trainee,
        assessment: test.title,
        score: percentage,
        date: new Date().toISOString().split('T')[0],
        phase: 'Live Assessment',
        cycle: 'Live',
        link: 'Live-Session',
        docSaved: true
    });
    localStorage.setItem('records', JSON.stringify(records));

    // 3. Clear Session
    session.active = false;
    localStorage.setItem('liveSession', JSON.stringify(session));

    // Sync All
    if (typeof saveToServer === 'function') await saveToServer(['liveSession', 'liveBookings', 'records'], true);

    alert(`Session Completed. Score: ${percentage}%`);
    showTab('live-assessment');
}

async function endLiveSession() {
    if(!confirm("Abort session? Data will be lost.")) return;
    const session = JSON.parse(localStorage.getItem('liveSession'));
    session.active = false;
    localStorage.setItem('liveSession', JSON.stringify(session));
    if (typeof saveToServer === 'function') await saveToServer(['liveSession'], true);
    showTab('live-assessment');
}
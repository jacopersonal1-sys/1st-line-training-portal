/* ================= LIVE ASSESSMENT EXECUTION ENGINE ================= */
/* Handles real-time interaction between Trainer (Admin) and Trainee */

let LIVE_POLLER = null; // The interval for polling
let ACTIVE_LIVE_SESSION_ID = null; // The bookingId of the session this user is in
let LAST_RENDERED_Q = -2; // Track rendered state to prevent UI thrashing for trainees

function loadLiveExecution() {
    if (LIVE_POLLER) clearInterval(LIVE_POLLER);
    
    const container = document.getElementById('live-execution-content');
    if (!container) return;

    // Determine which session this user belongs to
    const sessions = JSON.parse(localStorage.getItem('liveSessions') || '{}');
    if (CURRENT_USER.role === 'trainee') {
        ACTIVE_LIVE_SESSION_ID = Object.keys(sessions).find(id => sessions[id].active && sessions[id].trainee === CURRENT_USER.user);
    } else {
        // Admin/Trainer can only be in one session at a time
        ACTIVE_LIVE_SESSION_ID = Object.keys(sessions).find(id => sessions[id].active && sessions[id].trainer === CURRENT_USER.user);
    }

    LAST_RENDERED_Q = -2; // Reset on load
    if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'special_viewer') {
        renderAdminLivePanel(container);
    } else {
        renderTraineeLivePanel(container);
    }

    // Start Polling for updates (Real-time sync)
    LIVE_POLLER = setInterval(syncLiveSessionState, 1000);
}

async function syncLiveSessionState() {
    // TARGETED POLLING (Efficient & Stable)
    // Matches Vetting Arena logic to prevent full re-renders wiping user input
    if (!window.supabaseClient) return;

    const { data, error } = await supabaseClient
        .from('app_documents')
        .select('content')
        .eq('key', 'liveSessions')
        .single();

    if (data && data.content) {
        const serverSession = data.content;
        const localSession = JSON.parse(localStorage.getItem('liveSessions') || '{}');
        
        // Only update if state actually changed
        if (JSON.stringify(serverSession) !== JSON.stringify(localSession)) {
            localStorage.setItem('liveSessions', JSON.stringify(serverSession));
            
            const container = document.getElementById('live-execution-content');
            if (container) {
                if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'special_viewer') {
                    // Admin: Update view but try to preserve focus if typing
                    if (!document.querySelector('.admin-interaction-active') || serverSession.currentQ !== localSession.currentQ) {
                        renderAdminLivePanel(container);
                    } else {
                        updateAdminLiveView(); 
                    }
                } else {
                    // Trainee: ONLY re-render if the question changed or session status changed
                    // This fixes the "Selection Disappears" bug
                    const mySession = serverSession[ACTIVE_LIVE_SESSION_ID];
                    if (mySession && (mySession.currentQ !== LAST_RENDERED_Q || mySession.active !== localSession[ACTIVE_LIVE_SESSION_ID]?.active)) {
                        renderTraineeLivePanel(container);
                        LAST_RENDERED_Q = mySession.currentQ;
                    }
                }
            }
        }
    }
}

// --- ADMIN VIEW ---

function renderAdminLivePanel(container) {
    const session = ACTIVE_LIVE_SESSION_ID ? JSON.parse(localStorage.getItem('liveSessions') || '{}')[ACTIVE_LIVE_SESSION_ID] : null;
    
    if (!session || !session.active) {
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
        const adminNote = q.adminNotes ? `<div style="margin-bottom:15px; padding:10px; background:rgba(243, 112, 33, 0.1); border-left:3px solid var(--primary); font-size:0.9rem; white-space: pre-wrap;"><strong>Marker Note:</strong> ${q.adminNotes}</div>` : '';
        
        // Reference Button
        const refBtn = q.imageLink ? `<button class="btn-secondary btn-sm" onclick="openReferenceViewer('${q.imageLink}')" style="margin-top:5px;"><i class="fas fa-image"></i> View Reference</button>` : '';

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
    const session = ACTIVE_LIVE_SESSION_ID ? JSON.parse(localStorage.getItem('liveSessions') || '{}')[ACTIVE_LIVE_SESSION_ID] : null;
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');

    if (!session || !session.active) return;
    
    // 1. Update Answer Box (Current Question)
    const test = tests.find(t => t.id == session.testId);
    if (session.currentQ !== -1) {
        const ansBox = document.getElementById('live-admin-answer-box');
        if (ansBox && test) { // FIX: Ensure test is defined
            const ans = session.answers[session.currentQ];
            const hasAns = ans !== undefined && ans !== null && ans !== "";
            const displayAns = hasAns ? formatAdminAnswerPreview(test.questions[session.currentQ], ans) : '<span style="color:var(--text-muted); font-style:italic;">Waiting for answer...</span>';
            const html = `<strong>TRAINEE ANSWER:</strong><br>${displayAns}`;
            if (ansBox.innerHTML !== html) ansBox.innerHTML = html;
        }
    }

    // 2. Update Sidebar Status Icons (Checkmarks)
    // This ensures Admin sees progress without full re-render
    if (test) {
        test.questions.forEach((q, idx) => {
            // Find the icon inside the sidebar item
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
    
    if (typeof ans === 'object') return JSON.stringify(ans);
    return ans;
}

// --- TRAINEE VIEW ---

function renderTraineeLivePanel(container) {
    // Set global flag for assessment.js input handlers
    window.IS_LIVE_ARENA = true;

    // Note: This function wipes the container. Only call if question changed.
    const session = ACTIVE_LIVE_SESSION_ID ? JSON.parse(localStorage.getItem('liveSessions') || '{}')[ACTIVE_LIVE_SESSION_ID] : null;
    
    if (!session || !session.active || session.trainee !== CURRENT_USER.user) {
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
    let existingAns = session.answers[session.currentQ];

    // --- FIX: Initialize default answers for complex types if undefined ---
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

    container.innerHTML = `
        <div style="max-width:95%; margin:0 auto; padding:20px;">
            <div class="progress-track" style="margin-bottom:20px;">
                <div class="progress-fill" style="width:${((session.currentQ+1)/test.questions.length)*100}%"></div>
            </div>
            
            <div class="card" style="padding:40px;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: start;">
                    <div class="q-text-large" style="font-size:1.5rem; max-height: 65vh; overflow-y: auto; padding-right:15px;">${session.currentQ + 1}. ${q.text} ${refBtn}</div>
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
        bookingId: bookingId,
        testId: test.id,
        trainee: traineeName,
        trainer: CURRENT_USER.user,
        currentQ: -1,
        answers: {},
        scores: {},
        comments: {}
    };

    const sessions = JSON.parse(localStorage.getItem('liveSessions') || '{}');
    sessions[bookingId] = session;
    localStorage.setItem('liveSessions', JSON.stringify(sessions));
    
    // Force Sync
    if (typeof saveToServer === 'function') await saveToServer(['liveSessions'], true);

    showTab('live-execution');
    loadLiveExecution();
}

async function adminPushQuestion(idx) {
    const sessions = JSON.parse(localStorage.getItem('liveSessions') || '{}');
    if (sessions[ACTIVE_LIVE_SESSION_ID]) {
        sessions[ACTIVE_LIVE_SESSION_ID].currentQ = idx;
        localStorage.setItem('liveSessions', JSON.stringify(sessions));
        if (typeof saveToServer === 'function') await saveToServer(['liveSessions'], true);
    }
    
    renderAdminLivePanel(document.getElementById('live-execution-content'));
}

async function adminJumpToQuestion(idx) {
    if(confirm("Jump to this question?")) adminPushQuestion(idx);
}

async function saveLiveScore(idx, val) {
    const sessions = JSON.parse(localStorage.getItem('liveSessions') || '{}');
    if (sessions[ACTIVE_LIVE_SESSION_ID]) {
        if (!sessions[ACTIVE_LIVE_SESSION_ID].scores) sessions[ACTIVE_LIVE_SESSION_ID].scores = {};
        sessions[ACTIVE_LIVE_SESSION_ID].scores[idx] = parseFloat(val);
        localStorage.setItem('liveSessions', JSON.stringify(sessions));
    }
    // Background save
    if (typeof saveToServer === 'function') saveToServer(['liveSessions'], false);
}

async function saveLiveComment(idx, val) {
    const sessions = JSON.parse(localStorage.getItem('liveSessions') || '{}');
    if (sessions[ACTIVE_LIVE_SESSION_ID]) {
        if (!sessions[ACTIVE_LIVE_SESSION_ID].comments) sessions[ACTIVE_LIVE_SESSION_ID].comments = {};
        sessions[ACTIVE_LIVE_SESSION_ID].comments[idx] = val;
        localStorage.setItem('liveSessions', JSON.stringify(sessions));
    }
    // Background save
    if (typeof saveToServer === 'function') saveToServer(['liveSessions'], false);
}

async function submitLiveAnswer(qIdx) {
    // Get answer from window.USER_ANSWERS (populated by renderQuestionInput helpers)
    const ans = window.USER_ANSWERS[qIdx];
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const sessions = JSON.parse(localStorage.getItem('liveSessions') || '{}');
    const session = sessions[ACTIVE_LIVE_SESSION_ID];
    if (!session) return;

    const test = tests.find(t => t.id == session.testId);
    const q = test.questions[qIdx];

    // Allow empty for Practical (Auto-fill "Completed")
    if (q.type !== 'live_practical' && (ans === undefined || ans === null || ans === "")) {
        if(!confirm("Submit empty answer?")) return;
    }

    // For practical, if empty, mark as "Completed"
    session.answers[qIdx] = (q.type === 'live_practical' && !ans) ? "Completed" : ans;
    
    localStorage.setItem('liveSessions', JSON.stringify(sessions));
    
    // Force Sync so Admin sees it immediately
    const btn = document.querySelector('.btn-primary.btn-lg');
    if(btn) { btn.innerText = "Sending..."; btn.disabled = true; }
    
    // UPDATED: Use 'false' (Safe Merge) to prevent overwriting Admin's state updates
    if (typeof saveToServer === 'function') await saveToServer(['liveSessions'], false);
    
    if(btn) { 
        // Check type to determine text
        const isPractical = q.type === 'live_practical';
        btn.innerText = isPractical ? "Done" : "Update Answer"; 
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
    const sessions = JSON.parse(localStorage.getItem('liveSessions') || '{}');
    const session = sessions[ACTIVE_LIVE_SESSION_ID];
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
                    <input type="number" class="live-final-score" value="${currentScore}" max="${pts}" min="0" step="0.5" onchange="saveLiveScore(${idx}, this.value)">
                </div>
                <div>
                    <label style="font-size:0.8rem;">Comment</label>
                    <input type="text" class="live-final-comment" value="${currentComment}" placeholder="Feedback..." onchange="saveLiveComment(${idx}, this.value)">
                </div>
            </div>
        </div>`;
    }).join('');

    // 2. Inject Summary View (Replaces the Question View)
    const container = document.getElementById('live-execution-content');
    container.innerHTML = `
        <div class="card" style="max-width:900px; margin:20px auto; height:calc(100vh - 150px); display:flex; flex-direction:column;">
            <div style="border-bottom:1px solid var(--border-color); padding-bottom:15px; margin-bottom:15px;">
                <h2 style="margin:0;">Assessment Summary: ${session.trainee}</h2>
                <div style="margin-top:5px; color:var(--text-muted);">Review and finalize scores before submitting.</div>
            </div>
            
            <div style="flex:1; overflow-y:auto; padding-right:5px;">
                ${itemsHtml}
            </div>
            
            <div style="border-top:1px solid var(--border-color); padding-top:15px; margin-top:15px; display:flex; justify-content:space-between; align-items:center;">
                <button class="btn-secondary" onclick="loadLiveExecution()">Back to Grading</button>
                <button class="btn-success" onclick="confirmAndSaveLiveSession()">Confirm & Submit</button>
            </div>
        </div>
    `;
}

async function confirmAndSaveLiveSession() {
    const sessions = JSON.parse(localStorage.getItem('liveSessions') || '{}');
    const session = sessions[ACTIVE_LIVE_SESSION_ID];
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const test = tests.find(t => t.id == session.testId);

    // Recalculate Score (in case edits were made in summary view)
    let totalScore = 0;
    let maxScore = 0;
    test.questions.forEach((q, idx) => {
        maxScore += parseFloat(q.points || 1);
        totalScore += parseFloat(session.scores[idx] || 0);
    });
    const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

    // 1. Create Full Submission Record (For "View Completed Test" & Marking Queue)
    const submissions = JSON.parse(localStorage.getItem('submissions') || '[]');
    const newSub = {
        id: Date.now().toString(),
        testId: test.id,
        testTitle: test.title,
        trainee: session.trainee,
        date: new Date().toISOString().split('T')[0],
        answers: session.answers,
        status: 'completed',
        score: percentage,
        type: 'live',
        marker: session.trainer,
        comments: session.comments, // Save comments
        scores: session.scores,     // Save individual scores
        testSnapshot: test          // SNAPSHOT: Save test definition for history
    };
    submissions.push(newSub);
    localStorage.setItem('submissions', JSON.stringify(submissions));

    // 2. Update Booking Status
    const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
    const booking = bookings.find(b => b.id === session.bookingId);
    if (booking) {
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
    
    records.push({
        id: Date.now() + "_" + Math.random().toString(36).substr(2, 9),
        groupID: groupId,
        trainee: session.trainee,
        assessment: test.title,
        score: percentage,
        date: new Date().toISOString().split('T')[0],
        phase: phaseVal,
        cycle: 'Live',
        link: 'Live-Session',
        docSaved: true
    });
    localStorage.setItem('records', JSON.stringify(records));

    // 4. Clear Session
    delete sessions[ACTIVE_LIVE_SESSION_ID];
    localStorage.setItem('liveSessions', JSON.stringify(sessions));

    // 5. Sync All
    if (typeof saveToServer === 'function') await saveToServer(['liveSessions', 'liveBookings', 'records', 'submissions'], true);

    if(typeof showToast === 'function') showToast(`Session Completed. Score: ${percentage}%`, "success");
    showTab('live-assessment');
}

async function endLiveSession() {
    if(!confirm("Abort session? Any unsaved data will be lost.")) return;
    const sessions = JSON.parse(localStorage.getItem('liveSessions') || '{}');
    delete sessions[ACTIVE_LIVE_SESSION_ID];
    localStorage.setItem('liveSessions', JSON.stringify(sessions));
    if (typeof saveToServer === 'function') await saveToServer(['liveSessions'], true);
    showTab('live-assessment');
}
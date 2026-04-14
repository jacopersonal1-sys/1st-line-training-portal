/* ================= ASSESSMENT TRAINEE ================= */
/* Test Taking, Scheduling, and Submission Logic */

function getCurrentTraineeGroupId() {
    if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER || !CURRENT_USER.user) return null;
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    for (const [gid, members] of Object.entries(rosters)) {
        if (!Array.isArray(members)) continue;
        if (members.some(m => String(m || '').trim().toLowerCase() === String(CURRENT_USER.user || '').trim().toLowerCase())) {
            return gid;
        }
    }
    return null;
}

function getLatestRetrainMoveDateForUser(userName) {
    const archives = JSON.parse(localStorage.getItem('retrain_archives') || '[]');
    const normalized = String(userName || '').trim().toLowerCase();
    const movedTimes = archives
        .filter(entry => String(entry?.user || '').trim().toLowerCase() === normalized)
        .map(entry => Date.parse(entry?.movedDate || entry?.graduatedDate || 0))
        .filter(ts => Number.isFinite(ts) && ts > 0);
    if (movedTimes.length === 0) return 0;
    return Math.max(...movedTimes);
}

function resolveSubmissionLinkedRecord(submission, allRecords) {
    if (!submission) return null;
    const records = Array.isArray(allRecords) ? allRecords : JSON.parse(localStorage.getItem('records') || '[]');
    let record = records.find(r => r && r.submissionId === submission.id);
    if (record) return record;
    const subTestTitle = String(submission.testTitle || '').trim().toLowerCase();
    const subTrainee = String(submission.trainee || '').trim().toLowerCase();
    return records.find(r =>
        r &&
        String(r.trainee || '').trim().toLowerCase() === subTrainee &&
        String(r.assessment || '').trim().toLowerCase() === subTestTitle
    ) || null;
}

function isLegacySubmissionForCurrentAttempt(submission, currentGroupId, latestMoveTs, recordsCache) {
    if (!submission) return false;
    if (submission.archived) return true;
    if (String(submission.status || '').toLowerCase() === 'retake_allowed') return true;

    const linkedRecord = resolveSubmissionLinkedRecord(submission, recordsCache);
    if (linkedRecord && currentGroupId && linkedRecord.groupID && String(linkedRecord.groupID) !== String(currentGroupId)) {
        return true;
    }

    if (latestMoveTs > 0) {
        const subTs = Date.parse(submission.lastEditedDate || submission.lastModified || submission.createdAt || submission.date || 0);
        if (Number.isFinite(subTs) && subTs > 0 && subTs <= latestMoveTs) return true;
    }

    return false;
}

/**
 * 3. TRAINEE: VIEWING PERSONAL TEST STATUS
 */
function loadTraineeTests() {
    const container = document.getElementById('myTestsList');
    if (!container) return;

    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const submissions = JSON.parse(localStorage.getItem('submissions') || '[]');

    const schedules = JSON.parse(localStorage.getItem('schedules') || '{}');
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    const records = JSON.parse(localStorage.getItem('records') || '[]');
    const myGroupId = getCurrentTraineeGroupId();
    const latestMoveTs = getLatestRetrainMoveDateForUser(CURRENT_USER.user);

    let allowedTestIds = new Set();
    if (myGroupId) {
        const schedKey = Object.keys(schedules).find(k => schedules[k].assigned === myGroupId);
        if (schedKey && schedules[schedKey].items) {
            schedules[schedKey].items.forEach(item => {
                if (item.linkedTestId) allowedTestIds.add(item.linkedTestId.toString());
            });
        }
    }

    let visibleTests = [];
    
    if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin') visibleTests = tests;
    else visibleTests = tests.filter(t => allowedTestIds.has(t.id.toString()));

    if (visibleTests.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">No assessments available.</div>';
        return;
    }

    container.innerHTML = visibleTests.map(t => {
        const sub = submissions.find(s =>
            s.testId == t.id &&
            s.trainee &&
            s.trainee.trim().toLowerCase() === CURRENT_USER.user.trim().toLowerCase() &&
            !isLegacySubmissionForCurrentAttempt(s, myGroupId, latestMoveTs, records)
        );
        let statusHtml = '<span class="status-badge status-improve">Not Started</span>';
        
        let isLocked = false;
        let lockReason = "Locked";
        
        if (myGroupId && CURRENT_USER.role !== 'admin') { 
            const schedKey = Object.keys(schedules).find(k => schedules[k].assigned === myGroupId);
            if (schedKey) {
                const item = schedules[schedKey].items.find(i => i.linkedTestId == t.id);
                if (item && typeof getScheduleStatus === 'function') {
                    const status = getScheduleStatus(item.dateRange, item.dueDate);
                    if (status === 'upcoming') { isLocked = true; lockReason = "Upcoming"; }
                    else if (status === 'past') { isLocked = true; lockReason = "Closed"; }
                    else if (typeof isAssessmentDay === 'function' && !isAssessmentDay(item.dateRange, item.dueDate)) { isLocked = true; lockReason = "Study Phase"; }
                    else if (typeof checkTimeAccess === 'function' && !checkTimeAccess(item.openTime, item.closeTime, item.ignoreTime)) { isLocked = true; lockReason = "Time Locked"; }
                }
            }
        }

        let actionBtn = isLocked 
            ? `<button class="btn-secondary btn-sm" disabled style="opacity:0.6; cursor:not-allowed;"><i class="fas fa-lock"></i> ${lockReason}</button>`
            : `<button class="btn-primary btn-sm" onclick="openTestTaker('${t.id}')">Start Assessment</button>`;

        if (sub) {
            if (sub.status === 'pending') {
                statusHtml = '<span class="status-badge status-semi">Pending Review</span>';
                actionBtn = `<button class="btn-secondary btn-sm" disabled style="opacity:0.5;">In Review</button>`;
            } else {
                let passLabel = "Fail";
                let passClass = "status-fail";
                if(sub.score >= (typeof PASS !== 'undefined' ? PASS : 90)) { passLabel = "Pass"; passClass = "status-pass"; }
                else if(sub.score >= (typeof IMPROVE !== 'undefined' ? IMPROVE : 60)) { passLabel = "Improve"; passClass = "status-improve"; }
                
                statusHtml = `<span class="status-badge ${passClass}">${passLabel} (${sub.score}%)</span>`;
                actionBtn = `<button class="btn-secondary btn-sm" disabled style="opacity:0.5;">Completed</button>`;
            }
        }

        const typeLabel = t.type === 'vetting'
            ? '<span class="test-type-pill vetting"><i class="fas fa-shield-alt"></i> Vetting</span>'
            : t.type === 'live'
                ? '<span class="test-type-pill live"><i class="fas fa-satellite-dish"></i> Live</span>'
                : '<span class="test-type-pill standard"><i class="fas fa-file-alt"></i> Standard</span>';

        return `
        <div class="test-card-row">
            <div class="test-card-main">
                <strong>${t.title}</strong>
                <div class="test-card-meta">
                    <span><i class="fas fa-list-ol"></i> ${t.questions ? t.questions.length : 0} Questions</span>
                    ${typeLabel}
                </div>
            </div>
            <div class="test-card-actions" style="display:flex; align-items:center; gap:15px;">
                ${statusHtml}
                ${actionBtn}
            </div>
        </div>`;
    }).join('');
}

/**
 * 4. TEST TAKER: UI RENDERING & SUBMISSION
 */
function openTestTaker(testId, isArenaMode = false) {
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const test = tests.find(t => t.id == testId);
    if (!test) return;

    if (test.type === 'vetting' && !isArenaMode && CURRENT_USER.role === 'trainee') {
        if(typeof showToast === 'function') showToast("Vetting tests must be taken in the Vetting Arena.", "error");
        return;
    }

    // --- CRITICAL BUG FIX: Restore Draft Before Wiping Answers ---
    // If a draft exists for THIS test in Arena Mode, restore it instead of resetting.
    const draftStr = localStorage.getItem('draft_assessment');
    if (draftStr && isArenaMode) {
        try {
            const draft = JSON.parse(draftStr);
            if (draft.test && draft.test.id == testId && draft.user === CURRENT_USER.user) {
                window.CURRENT_TEST = draft.test;
                window.USER_ANSWERS = draft.answers || {};
                window.IS_LIVE_ARENA = isArenaMode;
                
                renderTestPaper('arenaTestContainer');
                
                return; // Prevent overwrite
            }
        } catch(e) { console.error("Draft restore failed", e); }
    }
    // -------------------------------------------------------------

    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    
    const myGroupId = getCurrentTraineeGroupId();
    const latestMoveTs = getLatestRetrainMoveDateForUser(CURRENT_USER.user);
    const records = JSON.parse(localStorage.getItem('records') || '[]');

    if (typeof getScheduleStatus === 'function' && CURRENT_USER.role === 'trainee' && !isArenaMode) {
        const schedules = JSON.parse(localStorage.getItem('schedules') || '{}');

        let isScheduled = false;
        if (myGroupId) {
            const schedKey = Object.keys(schedules).find(k => schedules[k].assigned === myGroupId);
            if (schedKey) {
                const item = schedules[schedKey].items.find(i => i.linkedTestId == testId);
                if (item) {
                    isScheduled = true;
                    const status = getScheduleStatus(item.dateRange, item.dueDate);
                    if (status !== 'active') {
                        if(typeof showToast === 'function') showToast("This assessment is currently locked by the schedule.", "warning");
                        return;
                    }
                    
                    if (typeof isAssessmentDay === 'function' && !isAssessmentDay(item.dateRange, item.dueDate)) {
                        if(typeof showToast === 'function') showToast("This assessment is only available on the final day of the schedule item.", "warning");
                        return;
                    }
                    
                    if (typeof checkTimeAccess === 'function') {
                         const isTimeOpen = checkTimeAccess(item.openTime, item.closeTime, item.ignoreTime);
                         if (!isTimeOpen) {
                             if(typeof showToast === 'function') showToast(`This assessment is only available between ${item.openTime} and ${item.closeTime}.`, "warning");
                             return;
                         }
                    }
                }
            }
        }
        
        if (!isScheduled) {
            if(typeof showToast === 'function') showToast("This assessment is not assigned to your schedule.", "error");
            return;
        }
    }

    // FIX: Strict check to prevent false positives ("Already Submitted" error)
    const existing = subs.find(s => 
        s.testId && testId && 
        s.testId.toString() === testId.toString() && 
        s.trainee && s.trainee.trim().toLowerCase() === CURRENT_USER.user.trim().toLowerCase()
    );
    
    if (existing && !existing.archived) {
        // If this is a legacy pre-move attempt, auto-archive and continue.
        if (isLegacySubmissionForCurrentAttempt(existing, myGroupId, latestMoveTs, records)) {
            existing.archived = true;
            existing.status = existing.status === 'completed' ? 'retake_allowed' : existing.status;
            localStorage.setItem('submissions', JSON.stringify(subs));
            if (typeof saveToServer === 'function') saveToServer(['submissions'], true, true);
        } else if (isArenaMode) {
        // FIX: Allow Vetting Arena to override/archive previous attempts automatically
             existing.archived = true;
             localStorage.setItem('submissions', JSON.stringify(subs));
        } else {
            if(typeof showToast === 'function') showToast("You have already completed this assessment. Please contact your Admin if you require a retake.", "info");
            return;
        }
    }

    window.CURRENT_TEST = JSON.parse(JSON.stringify(test)); 
    
    window.CURRENT_TEST.questions.forEach((q, i) => q._originalIndex = i);

    if (window.CURRENT_TEST.shuffle) {
        const questions = window.CURRENT_TEST.questions;
        const groups = [];
        let currentGroup = [];
        
        questions.forEach((q, i) => {
            if (q.linkedToPrevious && i > 0) {
                currentGroup.push(q);
            } else {
                if (currentGroup.length > 0) groups.push(currentGroup);
                currentGroup = [q];
            }
        });
        if (currentGroup.length > 0) groups.push(currentGroup);
        
        window.CURRENT_TEST.questions = shuffleArray(groups).flat();
    }

    window.USER_ANSWERS = {}; 
    window.IS_LIVE_ARENA = isArenaMode;

    window.CURRENT_TEST.questions.forEach((q, idx) => {
        if(q.type === 'ranking' || q.type === 'drag_drop') {
            window.USER_ANSWERS[idx] = shuffleArray([...(q.items || [])]); 
        }
        if(q.type === 'matching') window.USER_ANSWERS[idx] = new Array((q.pairs||[]).length).fill("");
        if(q.type === 'matrix') window.USER_ANSWERS[idx] = {};
        if(q.type === 'multi_select') window.USER_ANSWERS[idx] = [];
    });

    if (isArenaMode) {
        renderTestPaper('arenaTestContainer');
    } else {
        if(typeof showTab === 'function') showTab('test-take-view');
        const titleEl = document.getElementById('takingTitle');
        if(titleEl) titleEl.innerText = window.CURRENT_TEST.title;
        renderTestPaper('takingQuestions');
    }
}

function renderTestPaper(containerId = 'takingQuestions') {
    const content = document.getElementById(containerId);
    if (!content) return;
    content.innerHTML = ''; 

    // Inject Card Styles
    if (!document.getElementById('assessment-card-styles')) {
        const style = document.createElement('style');
        style.id = 'assessment-card-styles';
        style.innerHTML = `
            .taking-card { transition: transform 0.2s, box-shadow 0.2s, border-left-color 0.3s; border-left: 4px solid transparent; position: relative; }
            .taking-card:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
            .taking-card.answered { border-left-color: #2ecc71; }
            .taking-card.answered::after {
                content: '\\f00c'; font-family: 'Font Awesome 5 Free'; font-weight: 900;
                position: absolute; top: 15px; right: 15px; color: #2ecc71; font-size: 1.2rem; opacity: 0.5;
            }
        `;
        document.head.appendChild(style);
    }

    if (window.CURRENT_TEST.type === 'vetting' && window.CURRENT_TEST.duration) {
        // Resume timer if draft exists, else start fresh
        if (window.CURRENT_TEST.remainingSeconds) {
            // Pass seconds directly if we have them
            startTestTimer(window.CURRENT_TEST.remainingSeconds / 60);
        } else {
            startTestTimer(parseInt(window.CURRENT_TEST.duration));
        }
    }

    const totalQuestions = Array.isArray(window.CURRENT_TEST.questions) ? window.CURRENT_TEST.questions.length : 0;
    const typeName = window.CURRENT_TEST.type === 'vetting'
        ? 'Vetting Test'
        : window.CURRENT_TEST.type === 'live'
            ? 'Live Assessment'
            : 'Standard Assessment';

    let html = `
    <div class="test-paper">
        <div class="test-paper-head">
            <div class="test-paper-eyebrow">${typeName}</div>
            <h2 class="test-paper-title">${window.CURRENT_TEST.title}</h2>
            <p class="test-paper-subtitle">Answer all questions below. Your progress is saved automatically.</p>
            <div class="test-paper-meta">
                <span><i class="fas fa-list-ol"></i> ${totalQuestions} Questions</span>
                <span><i class="fas fa-save"></i> Auto-save enabled</span>
            </div>
        </div>
    `;

    window.CURRENT_TEST.questions.forEach((q, idx) => {
        const refBtn = q.imageLink ? `<button class="btn-secondary btn-sm" onclick="openReferenceViewer('${q.imageLink}')" style="float:right; margin-left:10px;"><i class="fas fa-image"></i> View Reference</button>` : '';
        
        // Check initial state
        const ans = window.USER_ANSWERS[idx];
        const isAnswered = (ans !== undefined && ans !== null && ans !== "" && (Array.isArray(ans) ? ans.length > 0 : true));

        html += `
        <div class="taking-card ${isAnswered ? 'answered' : ''}" id="card_q_${idx}" style="margin-bottom:40px;">
            <div class="q-text-large taking-question-title" style="font-weight:700; font-size:1.3rem; margin-bottom:25px; line-height:1.5;">
                ${idx + 1}. ${q.text} ${refBtn} <span class="taking-points-chip" style="font-size:0.8rem; font-weight:normal; color:var(--text-muted); float:right; margin-left:10px;">(${q.points||1} pts)</span>
            </div>
            <div class="question-input-area" id="q_area_${idx}">${renderQuestionInput(q, idx)}</div>
        </div>`;
    });

    html += `
        <div style="text-align:center; margin-top:50px; border-top:1px solid var(--border-color); padding-top:30px;">
            <button class="btn-primary btn-lg" style="width:100%; max-width:400px;" onclick="submitTest()">Finalize & Submit</button>
        </div>
    </div>`;
    
    content.innerHTML = html;

    setTimeout(() => {
        content.querySelectorAll('textarea.auto-expand').forEach(el => autoResize(el));
    }, 0);

    // --- AUTO-SAVE ON INTERACTION ---
    // Save draft immediately whenever the user types or selects an answer
    content.addEventListener('input', () => saveAssessmentDraft());
    content.addEventListener('change', () => saveAssessmentDraft());
    // --------------------------------
}

// --- DRAFT HANDLING (INACTIVITY) ---
function saveAssessmentDraft() {
    if (!window.CURRENT_TEST) return;
    const draft = {
        user: CURRENT_USER.user,
        test: window.CURRENT_TEST,
        answers: window.USER_ANSWERS,
        // Timer state is saved inside window.CURRENT_TEST.remainingSeconds by startTestTimer
        timestamp: Date.now()
    };
    localStorage.setItem('draft_assessment', JSON.stringify(draft));
    console.log("Assessment draft saved.");
}

function restoreAssessmentDraft() {
    const draftStr = localStorage.getItem('draft_assessment');
    if (!draftStr) return;
    
    const draft = JSON.parse(draftStr);
    
    // CRITICAL: Ensure the draft belongs to the currently logged in user
    if (draft.user !== CURRENT_USER.user) return;

    // ARCHITECTURAL FIX: "TIME-STOP" EXPLOIT PREVENTION
    // Calculate how much time passed while the draft was "asleep"
    if (draft.test && draft.test.remainingSeconds) {
        const timeAsleepSeconds = Math.floor((Date.now() - draft.timestamp) / 1000);
        draft.test.remainingSeconds -= timeAsleepSeconds;
        if (draft.test.remainingSeconds <= 0) draft.test.remainingSeconds = 1; // Force 1s to trigger immediate timeout
    }

    window.CURRENT_TEST = draft.test;
    window.USER_ANSWERS = draft.answers || {};
    
    if(typeof showTab === 'function') showTab('test-take-view');
    const titleEl = document.getElementById('takingTitle');
    if(titleEl) titleEl.innerText = window.CURRENT_TEST.title;
    
    renderTestPaper();
}

// UPDATED: Async Submit
async function submitTest(forceSubmit = false) {
    // CONCURRENCY LOCK: Prevent double-execution if Timer and User click at the same time
    if (window.IS_SUBMITTING) return;
    window.IS_SUBMITTING = true;

    const btn = document.querySelector('button[onclick="submitTest()"]');
    if(btn) { btn.disabled = true; btn.innerText = "Processing..."; }

    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    
    try {
    // FIX: Strict check to prevent false positives ("Already Submitted" error)
    const existing = subs.find(s => 
        s.testId && window.CURRENT_TEST.id && 
        s.testId.toString() === window.CURRENT_TEST.id.toString() && 
        s.trainee && s.trainee.trim().toLowerCase() === CURRENT_USER.user.trim().toLowerCase() && 
        !s.archived
    );
    if (existing) {
        // If the test was already successfully completed, DO NOT archive it on a forced timeout/kick
        // This prevents the system from overwriting a good test with a blank/partial one.
        if (forceSubmit && existing.status === 'completed') {
            if (window.TEST_TIMER) clearInterval(window.TEST_TIMER);
            return; // Silently exit, their data is already safe.
        }

        // If forcing (e.g. timeout), we proceed to archive/overwrite instead of blocking
        if (!forceSubmit) { 
            alert("Error: Active submission already exists. Ask your Admin to click 'Allow Retake' on your previous attempt."); 
            if(btn) { btn.disabled = false; btn.innerText = "Finalize & Submit"; }
            return; 
        }
        
        // If forcing, archive the existing one so we can save the new final state
        existing.archived = true;
        localStorage.setItem('submissions', JSON.stringify(subs));
        
        document.getElementById('test-timer-bar')?.remove();
    }

    if (!forceSubmit && !confirm("Finalize your assessment? Answers will be locked for review.")) {
        if(btn) { btn.disabled = false; btn.innerText = "Finalize & Submit"; }
        return;
    }

    if (window.TEST_TIMER) clearInterval(window.TEST_TIMER);
    const bar = document.getElementById('test-timer-bar');
    if (bar) bar.remove();

    const autoResult = (typeof calculateAssessmentAutoResult === 'function')
        ? calculateAssessmentAutoResult(window.CURRENT_TEST, window.USER_ANSWERS)
        : { autoPoints: 0, maxPoints: 0, percent: 0, needsManual: false };

    const finalPercent = autoResult.percent;
    const finalStatus = autoResult.needsManual ? 'pending' : 'completed';

    const remappedAnswers = {};
    window.CURRENT_TEST.questions.forEach((q, currentIdx) => {
        const ans = window.USER_ANSWERS[currentIdx];
        remappedAnswers[q._originalIndex] = ans;
    });

    const originalTestDef = JSON.parse(localStorage.getItem('tests') || '[]').find(t => t.id == window.CURRENT_TEST.id);

    const submissionTime = new Date().toISOString();
    const submission = {
        id: Date.now().toString(),
        testId: window.CURRENT_TEST.id,
        testTitle: window.CURRENT_TEST.title,
        trainee: CURRENT_USER.user,
        date: new Date().toISOString().split('T')[0],
        answers: remappedAnswers, 
        status: finalStatus, 
        score: finalStatus === 'completed' ? finalPercent : 0,
        testSnapshot: originalTestDef || window.CURRENT_TEST,
        createdAt: submissionTime,
        lastModified: submissionTime,
        modifiedBy: CURRENT_USER.user
    };

    subs.push(submission);
    localStorage.setItem('submissions', JSON.stringify(subs));

    localStorage.removeItem('draft_assessment');

    if (finalStatus === 'completed') {
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        let groupId = "Unknown";
        for (const [gid, members] of Object.entries(rosters)) {
            if (members.some(m => m.toLowerCase() === CURRENT_USER.user.toLowerCase())) { groupId = gid; break; }
        }
        
        let cycleVal = 'Digital Onboard';
        if(typeof getTraineeCycle === 'function') cycleVal = getTraineeCycle(CURRENT_USER.user, groupId);
        const phaseVal = window.CURRENT_TEST.title.toLowerCase().includes('vetting') ? 'Vetting' : 'Assessment';

        const records = JSON.parse(localStorage.getItem('records') || '[]');
        const recordId = `record_${submission.id}`;
        
        const existingIdx = records.findIndex(r =>
            r.submissionId === submission.id ||
            r.id === recordId
        );

        const newRecord = {
            id: recordId,
            groupID: groupId,
            trainee: CURRENT_USER.user,
            assessment: window.CURRENT_TEST.title,
            score: finalPercent,
            date: submission.date,
            phase: phaseVal,
            cycle: cycleVal,
            link: 'Digital-Assessment',
            docSaved: true,
            submissionId: submission.id, // Link to submission
            createdAt: submissionTime,
            lastModified: submissionTime,
            modifiedBy: CURRENT_USER.user
        };

        if (existingIdx > -1) {
             records[existingIdx] = {
                 ...records[existingIdx],
                 ...newRecord,
                 id: records[existingIdx].id,
                 createdAt: records[existingIdx].createdAt || newRecord.createdAt
             };
        } else {
             records.push(newRecord);
        }

        localStorage.setItem('records', JSON.stringify(records));
    }

    if (typeof saveToServer === 'function') {
        // Final submissions are business-critical, so do not leave them on the debounced queue.
        await saveToServer(['submissions', 'records'], true);
    }

    if (typeof exitArena === 'function') {
        try {
            // If in Vetting Arena, keep locked (true) until session ends
            await exitArena(window.IS_LIVE_ARENA);
        } catch(e) {
            console.error("Failed to exit arena cleanly:", e);
        }
    }

    if (finalStatus === 'completed') {
        if(typeof showToast === 'function') showToast(`Assessment Complete! You scored: ${finalPercent}%`, "success");
        
        // --- TRIGGER NPS SURVEY ---
        if (typeof NPSSystem !== 'undefined') {
            NPSSystem.triggerCompletionSurvey('assessment', window.CURRENT_TEST.id);
        }
    } else {
        if(typeof showToast === 'function') showToast("Submitted Successfully! Results pending Admin review.", "info");
    }
    
    if(typeof showTab === 'function') showTab('my-tests');
    loadTraineeTests();
    
    } catch (error) {
        console.error("Submission UI Error:", error);
        alert("Your assessment was saved locally, but the screen encountered an error. Returning to dashboard.");
        if(typeof showTab === 'function') showTab('my-tests');
    } finally {
        if(btn) { btn.disabled = false; btn.innerText = "Finalize & Submit"; }
        window.IS_SUBMITTING = false; // Release lock
    }
}

function startTestTimer(mins) {
    // CRITICAL BUG FIX: Clear existing timer to prevent overlapping intervals (Crazy Timer)
    if (window.TEST_TIMER) clearInterval(window.TEST_TIMER);

    let secs = mins * 60;
    let timerBar = document.getElementById('test-timer-bar');
    if(!timerBar) {
        timerBar = document.createElement('div');
        timerBar.id = 'test-timer-bar';
        timerBar.className = 'timer-sticky';
        document.body.appendChild(timerBar);
    }

    // FIX: Ensure visibility with inline styles (High Z-Index)
    timerBar.style.cssText = "position:fixed; top:15px; right:20px; background:#e74c3c; color:white; padding:10px 25px; border-radius:30px; font-weight:bold; font-family:monospace; font-size:1.2rem; z-index:10000; box-shadow:0 4px 15px rgba(0,0,0,0.3); border:2px solid white;";

    window.TEST_TIMER = setInterval(() => {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        timerBar.innerText = `TIME: ${m}:${s < 10 ? '0' + s : s}`;
        if (secs <= 0) {
            clearInterval(window.TEST_TIMER);
            if(typeof showToast === 'function') showToast("Time's up! Submitting automatically.", "warning");
            submitTest(true);
        }
        
        // Update global state for draft saving
        if (window.CURRENT_TEST) window.CURRENT_TEST.remainingSeconds = secs;
        secs--;
    }, 1000);
}

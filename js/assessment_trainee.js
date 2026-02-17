/* ================= ASSESSMENT TRAINEE ================= */
/* Test Taking, Scheduling, and Submission Logic */

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
    let myGroupId = null;
    

    for (const [gid, members] of Object.entries(rosters)) {
        if (!members || !Array.isArray(members)) continue;

        // FIX: Case-insensitive check ensures reliability even if casing differs
        if (members.some(m => m && m.toLowerCase() === CURRENT_USER.user.toLowerCase())) { myGroupId = gid; break; }
    }

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
    
    if (CURRENT_USER.role === 'admin') visibleTests = tests;
    else visibleTests = tests.filter(t => allowedTestIds.has(t.id.toString()));

    if (visibleTests.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">No assessments available.</div>';
        return;
    }

    container.innerHTML = visibleTests.map(t => {
        const sub = submissions.find(s => s.testId == t.id && s.trainee === CURRENT_USER.user && !s.archived);
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

        return `
        <div class="test-card-row">
            <div>
                <strong>${t.title}</strong>
                <div style="font-size:0.8rem; color:var(--text-muted);">${t.questions ? t.questions.length : 0} Questions</div>
            </div>
            <div style="display:flex; align-items:center; gap:15px;">
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

    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    
    if (typeof getScheduleStatus === 'function' && CURRENT_USER.role === 'trainee' && !isArenaMode) {
        const schedules = JSON.parse(localStorage.getItem('schedules') || '{}');
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        let myGroupId = null;
        
        for (const [gid, members] of Object.entries(rosters)) {
            // FIX: Case-insensitive check
            if (members.some(m => m.toLowerCase() === CURRENT_USER.user.toLowerCase())) { myGroupId = gid; break; }
        }

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

    const existing = subs.find(s => s.testId == testId && s.trainee === CURRENT_USER.user);
    
    if (existing && !existing.archived) {
        if(typeof showToast === 'function') showToast("You have already completed this assessment. Please contact your Admin if you require a retake.", "info");
        return;
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

    if (window.CURRENT_TEST.type === 'vetting' && window.CURRENT_TEST.duration) {
        startTestTimer(parseInt(window.CURRENT_TEST.duration));
    }

    let html = `
    <div class="test-paper">
        <div style="text-align:center; margin-bottom:40px; padding-bottom:20px;">
            <p style="color:var(--text-muted);">Answer all questions. Results will be submitted for review.</p>
        </div>
    `;

    window.CURRENT_TEST.questions.forEach((q, idx) => {
        const refBtn = q.imageLink ? `<button class="btn-secondary btn-sm" onclick="openReferenceViewer('${q.imageLink}')" style="float:right; margin-left:10px;"><i class="fas fa-image"></i> View Reference</button>` : '';

        html += `
        <div class="taking-card" style="margin-bottom:40px;">
            <div class="q-text-large" style="font-weight:700; margin-bottom:15px;">
                ${idx + 1}. ${q.text} ${refBtn} <span style="font-size:0.8rem; font-weight:normal; color:var(--text-muted); float:right; margin-left:10px;">(${q.points||1} pts)</span>
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
}

// --- DRAFT HANDLING (INACTIVITY) ---
function saveAssessmentDraft() {
    if (!window.CURRENT_TEST) return;
    const draft = {
        test: window.CURRENT_TEST,
        answers: window.USER_ANSWERS,
        timestamp: Date.now()
    };
    localStorage.setItem('draft_assessment', JSON.stringify(draft));
    console.log("Assessment draft saved.");
}

function restoreAssessmentDraft() {
    const draftStr = localStorage.getItem('draft_assessment');
    if (!draftStr) return;
    
    const draft = JSON.parse(draftStr);
    window.CURRENT_TEST = draft.test;
    window.USER_ANSWERS = draft.answers || {};
    
    if(typeof showTab === 'function') showTab('test-take-view');
    const titleEl = document.getElementById('takingTitle');
    if(titleEl) titleEl.innerText = window.CURRENT_TEST.title;
    
    renderTestPaper();
}

// UPDATED: Async Submit
async function submitTest(forceSubmit = false) {
    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const existing = subs.find(s => s.testId == window.CURRENT_TEST.id && s.trainee === CURRENT_USER.user && !s.archived);
    if (existing) {
        if (!forceSubmit) alert("Error: Active submission already exists.");
        document.getElementById('test-timer-bar')?.remove();
        if(typeof showTab === 'function') showTab('my-tests');
        return;
    }

    if (!forceSubmit && !confirm("Finalize your assessment? Answers will be locked for review.")) return;

    if (window.TEST_TIMER) clearInterval(window.TEST_TIMER);
    const bar = document.getElementById('test-timer-bar');
    if (bar) bar.remove();

    let score = 0;
    let maxScore = 0;
    let needsManual = false;

    window.CURRENT_TEST.questions.forEach((q, idx) => {
        let pts = parseFloat(q.points || 1);
        maxScore += pts;
        let ans = window.USER_ANSWERS[idx];

        if (q.type === 'text') {
            needsManual = true;
        } else {
            if (q.type === 'matching') {
                let correctCount = 0;
                (q.pairs || []).forEach((p, pIdx) => {
                    if (ans && ans[pIdx] === p.right) correctCount++;
                });
                if (correctCount === (q.pairs || []).length) score += pts;
            }
            else if (q.type === 'drag_drop' || q.type === 'ranking') {
                let isExact = true;
                if (!ans || ans.length !== q.items.length) isExact = false;
                else {
                    ans.forEach((item, i) => { if (item !== q.items[i]) isExact = false; });
                }
                if (isExact) score += pts;
            }
            else if (q.type === 'matrix') {
                let correctRows = 0;
                (q.rows || []).forEach((r, rIdx) => {
                    const correctColIdx = q.correct ? q.correct[rIdx] : null;
                    if (ans && ans[rIdx] == correctColIdx) correctRows++;
                });
                
                if ((q.rows || []).length > 0) {
                    let partial = (correctRows / q.rows.length) * pts;
                    score += Math.round(partial * 10) / 10;
                }
            }
            else if (q.type === 'multi_select') {
               const correctArr = (q.correct || []).map(Number);
               const userArr = (ans || []).map(Number);
               let match = 0;
               let incorrect = 0;
               userArr.forEach(a => { 
                   if(correctArr.includes(a)) match++; 
                   else incorrect++;
               });
               
               if(correctArr.length > 0) {
                   let rawScore = ((match - incorrect) / correctArr.length) * pts;
                   score += Math.max(0, rawScore);
               }
            }
            else {
                if (ans == q.correct) score += pts;
            }
        }
    });

    const finalPercent = (maxScore > 0) ? Math.round((score / maxScore) * 100) : 0;
    const finalStatus = needsManual ? 'pending' : 'completed';

    const remappedAnswers = {};
    window.CURRENT_TEST.questions.forEach((q, currentIdx) => {
        const ans = window.USER_ANSWERS[currentIdx];
        remappedAnswers[q._originalIndex] = ans;
    });

    const originalTestDef = JSON.parse(localStorage.getItem('tests') || '[]').find(t => t.id == window.CURRENT_TEST.id);

    const submission = {
        id: Date.now().toString(),
        testId: window.CURRENT_TEST.id,
        testTitle: window.CURRENT_TEST.title,
        trainee: CURRENT_USER.user,
        date: new Date().toISOString().split('T')[0],
        answers: remappedAnswers, 
        status: finalStatus, 
        score: finalStatus === 'completed' ? finalPercent : 0,
        testSnapshot: originalTestDef || window.CURRENT_TEST 
    };

    subs.push(submission);
    localStorage.setItem('submissions', JSON.stringify(subs));

    localStorage.removeItem('draft_assessment');

    if (finalStatus === 'completed') {
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        let groupId = "Unknown";
        for (const [gid, members] of Object.entries(rosters)) {
            if (members.includes(CURRENT_USER.user)) { groupId = gid; break; }
        }
        
        let cycleVal = 'Digital Onboard';
        if(typeof getTraineeCycle === 'function') cycleVal = getTraineeCycle(CURRENT_USER.user, groupId);
        const phaseVal = window.CURRENT_TEST.title.toLowerCase().includes('vetting') ? 'Vetting' : 'Assessment';

        const records = JSON.parse(localStorage.getItem('records') || '[]');
        
        const existingIdx = records.findIndex(r => 
            r.trainee === CURRENT_USER.user && 
            r.assessment === window.CURRENT_TEST.title
        );

        const newRecord = {
            id: Date.now() + "_" + Math.random().toString(36).substr(2, 9),
            groupID: groupId,
            trainee: CURRENT_USER.user,
            assessment: window.CURRENT_TEST.title,
            score: finalPercent,
            date: submission.date,
            phase: phaseVal,
            cycle: cycleVal,
            link: 'Digital-Assessment',
            docSaved: true
        };

        if (existingIdx > -1) {
             records[existingIdx] = { ...records[existingIdx], ...newRecord, id: records[existingIdx].id };
        } else {
             records.push(newRecord);
        }

        localStorage.setItem('records', JSON.stringify(records));
    }

    await secureAssessmentSave(); 

    if (typeof exitArena === 'function') {
        try {
            await exitArena();
        } catch(e) {
            console.error("Failed to exit arena cleanly:", e);
        }
    }

    if (finalStatus === 'completed') {
        if(typeof showToast === 'function') showToast(`Assessment Complete! You scored: %`, "success");
        
        // --- TRIGGER NPS SURVEY ---
        if (typeof NPSSystem !== 'undefined') {
            NPSSystem.triggerCompletionSurvey('assessment', window.CURRENT_TEST.id);
        }
    } else {
        if(typeof showToast === 'function') showToast("Submitted Successfully! Results pending Admin review.", "info");
    }
    
    if(typeof showTab === 'function') showTab('my-tests');
    loadTraineeTests();
}

function startTestTimer(mins) {
    let secs = mins * 60;
    let timerBar = document.getElementById('test-timer-bar');
    if(!timerBar) {
        timerBar = document.createElement('div');
        timerBar.id = 'test-timer-bar';
        timerBar.className = 'timer-sticky';
        document.body.appendChild(timerBar);
    }

    window.TEST_TIMER = setInterval(() => {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        timerBar.innerText = `TIME: :${s < 10 ? '0' + s : s}`;
        if (secs <= 0) {
            clearInterval(window.TEST_TIMER);
            if(typeof showToast === 'function') showToast("Time's up! Submitting automatically.", "warning");
            submitTest(true);
        }
        secs--;
    }, 1000);
}

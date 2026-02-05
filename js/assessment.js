/* ================= ASSESSMENT ENGINE ================= */
/* Responsibility: 
   1. Admin: Building Tests & Marking Digital Submissions
   2. Trainee: Taking Tests & Viewing Results
*/

// Safe Global Declarations
if (typeof window.CURRENT_TEST === 'undefined') window.CURRENT_TEST = null;
if (typeof window.USER_ANSWERS === 'undefined') window.USER_ANSWERS = {};
if (typeof window.TEST_TIMER === 'undefined') window.TEST_TIMER = null;

// --- HELPER: ASYNC SAVE (CRITICAL FOR EXAMS) ---
// UPDATED: Uses force=true to ensure exam submissions and grades are saved immediately.
async function secureAssessmentSave() {
    if (typeof saveToServer === 'function') {
        const btn = document.activeElement;
        let originalText = "";
        if(btn && btn.tagName === 'BUTTON') {
            originalText = btn.innerText;
            btn.innerText = "Syncing...";
            btn.disabled = true;
        }

        try {
            // PARAMETER 'false' = SAFE MERGE (Prevents overwriting other trainees)
            await saveToServer(['submissions', 'records', 'tests'], false); 
        } catch(e) {
            console.error("Assessment Cloud Sync Error:", e);
            alert("Warning: Could not sync to cloud. Data saved locally.");
        } finally {
            if(btn && btn.tagName === 'BUTTON') {
                btn.innerText = originalText;
                btn.disabled = false;
            }
        }
    }
}

/**
 * 1. ADMIN: ASSESSMENT DASHBOARD (OVERVIEW)
 */
function loadAssessmentDashboard() {
    const container = document.getElementById('assessmentDashboard');
    if (!container) return;

    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');

    if (tests.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted); padding:10px;">No assessments created yet. Use the "+ Create New Assessment" button.</p>';
        return;
    }

    let html = `
    <table class="admin-table">
        <thead>
            <tr>
                <th>Assessment Title</th>
                <th style="text-align:center;">Attempts</th>
                <th style="text-align:center; color:var(--primary);">Pending Review</th>
                <th style="text-align:center; color:green;">Completed</th>
            </tr>
        </thead>
        <tbody>`;

    tests.forEach(t => {
        const testSubs = subs.filter(s => s.testId == t.id);
        const pending = testSubs.filter(s => s.status === 'pending').length;
        const completed = testSubs.filter(s => s.status === 'completed').length;

        html += `
            <tr>
                <td><strong>${t.title}</strong></td>
                <td align="center">${testSubs.length}</td>
                <td align="center"><b style="${pending > 0 ? 'color:var(--primary);' : 'opacity:0.5;'}">${pending}</b></td>
                <td align="center"><b style="color:green;">${completed}</b></td>
            </tr>`;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
}

/**
 * 2. ADMIN: MARKING QUEUE & GRADING LOGIC
 */
function loadMarkingQueue() {
    const container = document.getElementById('markingList');
    if (!container) return;

    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const pending = subs.filter(s => s.status === 'pending');

    if (pending.length === 0) {
        container.innerHTML = '<div style="padding:15px; text-align:center; color:var(--text-muted); background:var(--bg-input); border-radius:8px;">No assessments awaiting review.</div>';
        return;
    }

    // UPDATED: Now includes both Quick Approve and Manual Mark buttons
    container.innerHTML = pending.map(s => `
        <div class="test-card-row" style="border-left: 4px solid var(--primary); margin-bottom:10px;">
            <div>
                <strong>${s.trainee}</strong>
                <div style="font-size:0.8rem; color:var(--text-muted);">${s.testTitle} | Submitted: ${s.date} | Score: ${s.score || 0}%</div>
            </div>
            <div style="display:flex; gap:5px;">
                <button class="btn-primary btn-sm" onclick="approveSubmission('${s.id}')" title="Quick Approve"><i class="fas fa-check"></i></button>
                <button class="btn-secondary btn-sm" onclick="openAdminMarking('${s.id}')" title="Detailed Mark">Edit</button>
            </div>
        </div>
    `).join('');
}

// QUICK APPROVE (Restored Feature)
async function approveSubmission(subId) {
    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const sub = subs.find(s => s.id === subId);
    if (!sub) return;

    // 1. Mark as Completed
    sub.status = 'completed';
    localStorage.setItem('submissions', JSON.stringify(subs));

    // 2. Create Permanent Record
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    let targetGroup = 'Manual-Upload';
    
    // Attempt to find the trainee's group (Case Insensitive)
    for (const [gid, members] of Object.entries(rosters)) {
        if (members.some(m => m.toLowerCase() === sub.trainee.toLowerCase())) {
            targetGroup = gid;
            break;
        }
    }

    let cycleVal = 'New Onboard';
    if(typeof getTraineeCycle === 'function') {
        cycleVal = getTraineeCycle(sub.trainee, targetGroup);
    }

    const recs = JSON.parse(localStorage.getItem('records') || '[]');
    const phaseVal = sub.testTitle.toLowerCase().includes('vetting') ? 'Vetting' : 'Assessment';

    // DEDUPLICATION: Check if record exists
    const existingIdx = recs.findIndex(r => 
        r.trainee === sub.trainee && 
        r.assessment === sub.testTitle
    );

    const newRecord = {
        id: Date.now() + "_" + Math.random().toString(36).substr(2, 9),
        trainee: sub.trainee,
        assessment: sub.testTitle,
        score: sub.score,
        date: sub.date,
        phase: phaseVal,
        cycle: cycleVal,
        groupID: targetGroup,
        docSaved: true,
        videoSaved: false,
        link: 'Digital-Assessment'
    };

    if (existingIdx > -1) {
        // Update Existing
        recs[existingIdx].score = sub.score;
        recs[existingIdx].date = sub.date;
        recs[existingIdx].cycle = cycleVal;
        recs[existingIdx].docSaved = true;
        // Preserve ID if it exists
        if(!recs[existingIdx].id) recs[existingIdx].id = newRecord.id;
    } else {
        // Push New
        recs.push(newRecord);
    }

    localStorage.setItem('records', JSON.stringify(recs));
    
    // --- CLOUD SYNC ---
    // secureAssessmentSave handles the specific keys
    await secureAssessmentSave(); 
    
    alert("Approved & Recorded.");
    loadMarkingQueue();
    // Refresh other views
    if(typeof loadTestRecords === 'function') loadTestRecords();
    if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
}

// DETAILED MARKING (Modal)
function openAdminMarking(subId) {
    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const sub = subs.find(s => s.id === subId);
    if (!sub) return alert("Error: Submission data not found.");
    
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const test = tests.find(t => t.id == sub.testId); 
    
    if(!test) return alert("Original Assessment definition seems to be deleted.");

    const modal = document.getElementById('markingModal');
    const container = document.getElementById('markingContainer');
    modal.classList.remove('hidden');
    
    // Check if locked (Completed)
    const isLocked = sub.status === 'completed';
    const lockAttr = 'disabled'; // Always disabled in view mode unless we add an edit mode later

    container.innerHTML = `
        <div style="margin-bottom:20px; border-bottom:2px solid var(--border-color); padding-bottom:10px;">
            <h2 style="margin:0;">Marking: ${sub.trainee}</h2>
            <p style="color:var(--primary); font-weight:bold; margin:5px 0;">${sub.testTitle}</p>
        </div>
    `;

    test.questions.forEach((q, idx) => {
        const userAns = sub.answers[idx];
        const pointsMax = parseFloat(q.points || 1);
        let markHtml = '';
        let autoScore = 0;

        // --- SCORING LOGIC ---
        if (q.type === 'text') {
            markHtml = `
                <div style="background:var(--bg-input); padding:15px; border-radius:8px; margin-top:10px; border:1px solid var(--border-color); text-align:left;">
                    <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:5px;">MODEL ANSWER:</div>
                    <div style="margin-bottom:10px; font-style:italic; opacity:0.8;">${q.modelAnswer || 'N/A'}</div>
                    
                    <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:5px;">AGENT RESPONSE:</div>
                    <div style="white-space:pre-wrap; margin-bottom:15px; font-weight:500;">${userAns || '<i>(No response)</i>'}</div>
                    
                    <div style="display:flex; align-items:center; gap:10px; border-top:1px dashed var(--border-color); padding-top:10px;">
                        <label style="font-weight:bold;">Score (Max ${pointsMax}):</label>
                        <input type="number" class="q-mark" data-idx="${idx}" min="0" max="${pointsMax}" step="0.5" value="${sub.score ? (sub.score/100)*pointsMax : 0}" style="width:80px; padding:5px;" ${isLocked ? 'disabled' : ''}>
                    </div>
                </div>`;
        } 
        else {
            // AUTO SCORING VISUALIZER
            if (q.type === 'matching') {
                let correctCount = 0;
                (q.pairs || []).forEach((p, pIdx) => {
                    if (userAns && userAns[pIdx] === p.right) correctCount++;
                });
                if (correctCount === (q.pairs || []).length) autoScore = pointsMax;
            }
            else if (q.type === 'drag_drop' || q.type === 'ranking') {
                let isExact = true;
                if (!userAns || userAns.length !== q.items.length) isExact = false;
                else {
                    userAns.forEach((item, i) => { if (item !== q.items[i]) isExact = false; });
                }
                if (isExact) autoScore = pointsMax;
            }
            else if (q.type === 'matrix') {
                let correctRows = 0;
                (q.rows || []).forEach((r, rIdx) => {
                    const correctColIdx = q.correct ? q.correct[rIdx] : null;
                    if (userAns && userAns[rIdx] == correctColIdx) correctRows++;
                });
                if (correctRows === (q.rows || []).length) autoScore = pointsMax;
            }
            else if (q.type === 'multi_select') {
               // UPDATED: Partial Credit Logic
               const correctArr = (q.correct || []).map(Number);
               const userArr = (userAns || []).map(Number);
               let match = 0;
               userArr.forEach(a => { if(correctArr.includes(a)) match++; });
               
               // Score = (Matches / Total Correct Options) * Points
               if(correctArr.length > 0) {
                   autoScore = (match / correctArr.length) * pointsMax;
                   // Round to 1 decimal
                   autoScore = Math.round(autoScore * 10) / 10;
               }
            }
            else {
                if (userAns == q.correct) autoScore = pointsMax;
            }
            
            // VISUALIZE ANSWER
            let answerDisplay = `<div style="font-style:italic; color:var(--text-muted);">No Answer</div>`;
            
            if (q.type === 'matrix') {
                answerDisplay = '<div class="table-responsive"><table class="matrix-table" style="width:100%; text-align:center;"><thead><tr><th></th>';
                (q.cols || []).forEach(c => { answerDisplay += `<th>${c}</th>`; });
                answerDisplay += '</tr></thead><tbody>';
                (q.rows || []).forEach((r, rIdx) => {
                    answerDisplay += `<tr><td style="text-align:left; font-weight:bold;">${r}</td>`;
                    (q.cols || []).forEach((c, cIdx) => {
                        const isChecked = (userAns && userAns[rIdx] == cIdx) ? 'checked' : '';
                        answerDisplay += `<td><input type="radio" disabled ${isChecked}></td>`;
                    });
                    answerDisplay += `</tr>`;
                });
                answerDisplay += '</tbody></table></div>';
            }
            else if (q.type === 'matching') {
                answerDisplay = '<div style="display:grid; gap:5px;">';
                (q.pairs || []).forEach((p, pIdx) => {
                    const uAns = (userAns && userAns[pIdx]) ? userAns[pIdx] : '---';
                    const isCorrect = uAns === p.right;
                    const color = isCorrect ? 'green' : 'red';
                    answerDisplay += `<div style="display:flex; justify-content:space-between; background:var(--bg-card); padding:5px; border-radius:4px;"><span>${p.left}</span> <span style="color:${color}; font-weight:bold;">${uAns}</span></div>`;
                });
                answerDisplay += '</div>';
            }
            else if (q.type === 'multiple_choice') {
                answerDisplay = (q.options || []).map((opt, oIdx) => {
                    const isSelected = userAns == oIdx;
                    const isCorrect = q.correct == oIdx;
                    let style = "";
                    if(isSelected) style = "font-weight:bold; color:var(--primary);";
                    if(isCorrect) style += " border:1px solid green;";
                    return `<div style="padding:5px; ${style}">${isSelected ? '●' : '○'} ${opt} ${isCorrect ? ' (Correct)' : ''}</div>`;
                }).join('');
            }
            else if (q.type === 'multi_select') {
                answerDisplay = (q.options || []).map((opt, oIdx) => {
                    const isSelected = userAns && userAns.includes(oIdx);
                    const isCorrect = q.correct && q.correct.includes(oIdx);
                    return `<div style="padding:5px; ${isSelected ? 'color:var(--primary); font-weight:bold;' : ''}">${isSelected ? '☑' : '☐'} ${opt} ${isCorrect ? ' (Correct)' : ''}</div>`;
                }).join('');
            }
            else {
                answerDisplay = JSON.stringify(userAns);
            }

            markHtml = `
                <div style="background:var(--bg-input); padding:10px; border-radius:6px; margin-top:5px; text-align:left;">
                    <div style="margin-bottom:10px;">${answerDisplay}</div>
                    <div style="font-size:0.9rem; border-top:1px solid var(--border-color); padding-top:5px; font-weight:bold;">
                        Auto-Score: <strong>${autoScore} / ${pointsMax}</strong>
                        <input type="hidden" class="q-mark" data-idx="${idx}" value="${autoScore}">
                    </div>
                </div>`;
        }

        container.innerHTML += `
            <div class="marking-item" style="margin-bottom:25px;">
                <div style="font-weight:600;">Q${idx + 1}: ${q.text} <span style="float:right; font-size:0.8rem; color:var(--text-muted);">(${pointsMax} pts)</span></div>
                ${markHtml}
            </div>`;
    });

    // If locked, hide submit button
    const submitBtn = document.getElementById('markingSubmitBtn');
    if(isLocked) {
        submitBtn.style.display = 'none';
    } else {
        submitBtn.style.display = 'inline-block';
        submitBtn.innerText = "Finalize Score & Push to Records";
        submitBtn.onclick = () => finalizeAdminMarking(subId);
    }
}

// Function to View Completed Tests (Called from Test Records)
function viewCompletedTest(trainee, assessment) {
    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const sub = subs.find(s => s.trainee === trainee && s.testTitle === assessment);
    
    if(!sub) {
        alert("Digital submission file not found.");
        return;
    }
    
    openAdminMarking(sub.id);
    
    // Hide the submit button since this is read-only view
    setTimeout(() => {
        const btn = document.getElementById('markingSubmitBtn');
        if(btn) btn.style.display = 'none';
    }, 50);
}

async function finalizeAdminMarking(subId) {
    if (!confirm("Finalize these scores? This will update the trainee's records.")) return;

    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const sub = subs.find(s => s.id === subId);
    
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const test = tests.find(t => t.id == sub.testId);
    let maxScore = 0;
    if(test) test.questions.forEach(q => maxScore += parseFloat(q.points || 1));
    else maxScore = document.querySelectorAll('.q-mark').length; 

    const markInputs = document.querySelectorAll('.q-mark');
    let earnedPoints = 0;
    markInputs.forEach(input => earnedPoints += parseFloat(input.value));

    const percentage = maxScore > 0 ? Math.round((earnedPoints / maxScore) * 100) : 0;

    sub.score = percentage;
    sub.status = 'completed';
    localStorage.setItem('submissions', JSON.stringify(subs));

    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    let groupId = "Unknown";
    // UPDATED: Case-insensitive match for Group ID
    for (const [gid, members] of Object.entries(rosters)) {
        if (members.some(m => m.toLowerCase() === sub.trainee.toLowerCase())) { 
            groupId = gid; 
            break; 
        }
    }
    
    let cycleVal = 'Digital Onboard';
    if(typeof getTraineeCycle === 'function') cycleVal = getTraineeCycle(sub.trainee, groupId);
    const phaseVal = sub.testTitle.toLowerCase().includes('vetting') ? 'Vetting' : 'Assessment';

    const records = JSON.parse(localStorage.getItem('records') || '[]');
    
    // DEDUPLICATION (Fix for Duplicates)
    const existingIdx = records.findIndex(r => 
        r.trainee === sub.trainee && 
        r.assessment === sub.testTitle
    );

    const newRecord = {
        id: Date.now() + "_" + Math.random().toString(36).substr(2, 9),
        groupID: groupId,
        trainee: sub.trainee,
        assessment: sub.testTitle,
        score: percentage,
        date: sub.date,
        phase: phaseVal,
        cycle: cycleVal,
        link: 'Digital-Assessment',
        docSaved: true
    };

    if (existingIdx > -1) {
        records[existingIdx].score = percentage;
        records[existingIdx].cycle = cycleVal;
        records[existingIdx].docSaved = true;
        // Preserve ID
        if(!records[existingIdx].id) records[existingIdx].id = newRecord.id;
    } else {
        records.push(newRecord);
    }
    
    localStorage.setItem('records', JSON.stringify(records));

    // --- SECURE SAVE ---
    await secureAssessmentSave(); // Saves submissions, records, tests

    alert(`Marking Finalized! Trainee scored ${percentage}%`);
    document.getElementById('markingModal').classList.add('hidden');
    
    loadMarkingQueue();
    loadAssessmentDashboard();
    if (typeof renderMonthly === 'function') renderMonthly();
}

/**
 * 3. TRAINEE: VIEWING PERSONAL TEST STATUS
 */
function loadTraineeTests() {
    const container = document.getElementById('myTestsList');
    if (!container) return;

    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const submissions = JSON.parse(localStorage.getItem('submissions') || '[]');

    // --- SCHEDULE FILTERING ---
    // Only show tests that are relevant to the trainee's assigned schedule
    const schedules = JSON.parse(localStorage.getItem('schedules') || '{}');
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    let myGroupId = null;
    
    for (const [gid, members] of Object.entries(rosters)) {
        if (members.includes(CURRENT_USER.user)) { myGroupId = gid; break; }
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

    // Filter tests: Must be in allowed list OR not linked to any schedule (Global)
    // Actually, user requested strict filtering: "only relevent to group assigned"
    // So we only show tests that are explicitly in the schedule.
    const visibleTests = tests.filter(t => allowedTestIds.has(t.id.toString()));

    if (visibleTests.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">No assessments available.</div>';
        return;
    }

    container.innerHTML = visibleTests.map(t => {
        const sub = submissions.find(s => s.testId == t.id && s.trainee === CURRENT_USER.user && !s.archived);
        let statusHtml = '<span class="status-badge status-improve">Not Started</span>';
        let actionBtn = `<button class="btn-primary btn-sm" onclick="openTestTaker('${t.id}')">Start Assessment</button>`;

        if (sub) {
            if (sub.status === 'pending') {
                statusHtml = '<span class="status-badge status-semi">Pending Review</span>';
                actionBtn = `<button class="btn-secondary btn-sm" disabled style="opacity:0.5;">In Review</button>`;
            } else {
                // UPDATED: Show Pass/Fail Status
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

    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    
    // --- SCHEDULE ENFORCEMENT ---
    // Check if this test is linked to a schedule and if that schedule is active
    if (typeof getScheduleStatus === 'function' && CURRENT_USER.role === 'trainee') {
        const schedules = JSON.parse(localStorage.getItem('schedules') || '{}');
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        let myGroupId = null;
        
        // Find user's group
        for (const [gid, members] of Object.entries(rosters)) {
            if (members.includes(CURRENT_USER.user)) { myGroupId = gid; break; }
        }

        if (myGroupId) {
            const schedKey = Object.keys(schedules).find(k => schedules[k].assigned === myGroupId);
            if (schedKey) {
                const item = schedules[schedKey].items.find(i => i.linkedTestId == testId);
                if (item) {
                    const status = getScheduleStatus(item.dateRange, item.openTime, item.closeTime);
                    if (status !== 'active') return alert("This assessment is currently locked by the schedule.");
                }
            }
        }
    }

    const existing = subs.find(s => s.testId == testId && s.trainee === CURRENT_USER.user);
    
    if (existing && !existing.archived) {
        alert("You have already completed this assessment. Please contact your Admin if you require a retake.");
        return;
    }

    window.CURRENT_TEST = JSON.parse(JSON.stringify(test)); 
    window.USER_ANSWERS = {}; 

    window.CURRENT_TEST.questions.forEach((q, idx) => {
        if(q.type === 'ranking' || q.type === 'drag_drop') {
            window.USER_ANSWERS[idx] = shuffleArray([...(q.items || [])]); 
        }
        if(q.type === 'matching') window.USER_ANSWERS[idx] = new Array((q.pairs||[]).length).fill("");
        if(q.type === 'matrix') window.USER_ANSWERS[idx] = {};
        if(q.type === 'multi_select') window.USER_ANSWERS[idx] = [];
    });

    if (isArenaMode) {
        // Render inside the Arena Container
        renderTestPaper('arenaTestContainer');
    } else {
        // Standard View
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
        html += `
        <div class="taking-card" style="margin-bottom:40px;">
            <div class="q-text-large" style="font-weight:700; margin-bottom:15px;">
                ${idx + 1}. ${q.text} <span style="font-size:0.8rem; font-weight:normal; color:var(--text-muted); float:right;">(${q.points||1} pts)</span>
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

function renderQuestionInput(q, idx) {
    if (q.type === 'text') {
        return `<textarea class="taking-input auto-expand" oninput="autoResize(this)" onchange="recordAnswer(${idx}, this.value)" placeholder="Type your answer here..."></textarea>`;
    }
    
    if (q.type === 'matching') {
        const rightOptions = (q.pairs || []).map(p => p.right);
        const shuffledRight = shuffleArray([...rightOptions]); // Randomize right side
        
        let html = '<div style="display:grid; gap:10px;">';
        (q.pairs || []).forEach((p, rowIdx) => {
            html += `
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; align-items:center; background:var(--bg-input); padding:10px; border-radius:4px;">
                <div>${p.left}</div>
                <select onchange="updateMatchingAnswer(${idx}, ${rowIdx}, this.value)" style="margin:0;">
                    <option value="">-- Match --</option>
                    ${shuffledRight.map(opt => `<option value="${opt}">${opt}</option>`).join('')}
                </select>
            </div>`;
        });
        html += '</div>';
        return html;
    }

    if (q.type === 'drag_drop' || q.type === 'ranking') {
        const currentOrder = window.USER_ANSWERS[idx];
        return renderRankingList(idx, currentOrder);
    }

    if (q.type === 'matrix') {
        let html = '<div class="table-responsive"><table class="matrix-table" style="width:100%; text-align:center;"><thead><tr><th></th>';
        (q.cols || []).forEach(c => { html += `<th>${c}</th>`; });
        html += '</tr></thead><tbody>';
        
        (q.rows || []).forEach((r, rIdx) => {
            html += `<tr><td style="text-align:left; font-weight:bold;">${r}</td>`;
            (q.cols || []).forEach((c, cIdx) => {
                html += `<td><input type="radio" style="cursor:pointer;" name="mx_${idx}_${rIdx}" value="${cIdx}" onchange="updateMatrixAnswer(${idx}, ${rIdx}, ${cIdx})"></td>`;
            });
            html += `</tr>`;
        });
        html += '</tbody></table></div>';
        return html;
    }

    if (q.type === 'multi_select') {
        return (q.options || []).map((opt, oIdx) => `
            <label class="taking-radio opt-label-large">
                <input type="checkbox" name="q_${idx}" value="${oIdx}" onchange="updateMultiSelect(${idx}, ${oIdx}, this.checked)">
                <span style="margin-left:8px;">${opt}</span>
            </label>
        `).join('');
    }

    return (q.options || []).map((opt, oIdx) => `
        <label class="taking-radio opt-label-large">
            <input type="radio" name="q_${idx}" value="${oIdx}" onchange="recordAnswer(${idx}, ${oIdx})">
            <span style="margin-left:8px;">${opt}</span>
        </label>
    `).join('');
}

// --- HELPERS ---
function recordAnswer(qIdx, val) { window.USER_ANSWERS[qIdx] = val; }
function updateMatchingAnswer(qIdx, rowIdx, val) {
    if(!window.USER_ANSWERS[qIdx]) window.USER_ANSWERS[qIdx] = [];
    window.USER_ANSWERS[qIdx][rowIdx] = val;
}
function updateMatrixAnswer(qIdx, rowIdx, colIdx) {
    if(!window.USER_ANSWERS[qIdx]) window.USER_ANSWERS[qIdx] = {};
    window.USER_ANSWERS[qIdx][rowIdx] = colIdx;
}
function updateMultiSelect(qIdx, optIdx, isChecked) {
    if(!window.USER_ANSWERS[qIdx]) window.USER_ANSWERS[qIdx] = [];
    if(isChecked) {
        window.USER_ANSWERS[qIdx].push(optIdx);
    } else {
        window.USER_ANSWERS[qIdx] = window.USER_ANSWERS[qIdx].filter(i => i !== optIdx);
    }
}
function moveRankingItem(qIdx, itemIdx, direction) {
    const list = window.USER_ANSWERS[qIdx];
    const newIdx = itemIdx + direction;
    if (newIdx < 0 || newIdx >= list.length) return; 
    const temp = list[itemIdx];
    list[itemIdx] = list[newIdx];
    list[newIdx] = temp;
    const area = document.getElementById(`q_area_${qIdx}`);
    if(area) area.innerHTML = renderRankingList(qIdx, list);
}
function renderRankingList(qIdx, list) {
    if (!list || !Array.isArray(list)) return '<div style="color:var(--text-muted); font-style:italic;">List not initialized.</div>';
    return list.map((item, i) => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-input); padding:10px; margin-bottom:5px; border:1px solid var(--border-color); border-radius:4px;">
            <span>${i+1}. ${item}</span>
            <div>
                <button class="btn-secondary btn-sm" onclick="moveRankingItem(${qIdx}, ${i}, -1)" ${i===0?'disabled':''}><i class="fas fa-arrow-up"></i></button>
                <button class="btn-secondary btn-sm" onclick="moveRankingItem(${qIdx}, ${i}, 1)" ${i===list.length-1?'disabled':''}><i class="fas fa-arrow-down"></i></button>
            </div>
        </div>
    `).join('');
}
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// UPDATED: Async Submit
async function submitTest() {
    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const existing = subs.find(s => s.testId == window.CURRENT_TEST.id && s.trainee === CURRENT_USER.user && !s.archived);
    if (existing) {
        alert("Error: Active submission already exists.");
        document.getElementById('test-timer-bar')?.remove();
        if(typeof showTab === 'function') showTab('my-tests');
        return;
    }

    if (!confirm("Finalize your assessment? Answers will be locked for review.")) return;

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
                if (correctRows === (q.rows || []).length) score += pts;
            }
            else if (q.type === 'multi_select') {
               // UPDATED: Partial Credit Logic
               const correctArr = (q.correct || []).map(Number);
               const userArr = (ans || []).map(Number);
               let match = 0;
               userArr.forEach(a => { if(correctArr.includes(a)) match++; });
               
               if(correctArr.length > 0) {
                   score += (match / correctArr.length) * pts;
               }
            }
            else {
                if (ans == q.correct) score += pts;
            }
        }
    });

    const finalPercent = (maxScore > 0) ? Math.round((score / maxScore) * 100) : 0;
    const finalStatus = needsManual ? 'pending' : 'completed';

    const submission = {
        id: Date.now().toString(),
        testId: window.CURRENT_TEST.id,
        testTitle: window.CURRENT_TEST.title,
        trainee: CURRENT_USER.user,
        date: new Date().toISOString().split('T')[0],
        answers: window.USER_ANSWERS,
        status: finalStatus, 
        score: finalStatus === 'completed' ? finalPercent : 0 
    };

    subs.push(submission);
    localStorage.setItem('submissions', JSON.stringify(subs));

    // Clear Draft on successful submit
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
        
        // DEDUPLICATION (Fix for Auto-Submit Duplicates)
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

    // --- CLOUD SYNC ---
    await secureAssessmentSave(); // Saves submissions, records

    // --- ARENA EXIT ---
    if (typeof exitArena === 'function') {
        await exitArena();
    }

    if (finalStatus === 'completed') {
        alert(`Assessment Complete! You scored: ${finalPercent}%`);
    } else {
        alert("Submitted Successfully! Results pending Admin review.");
    }
    
    if(typeof showTab === 'function') showTab('my-tests');
    loadTraineeTests();
}

/**
 * 5. ADMIN: LIST MANAGEMENT
 */
function loadManageTests() {
    const container = document.getElementById('testListAdmin');
    if (!container) return;
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    container.innerHTML = tests.map(t => `
        <div class="test-card-row">
            <div><strong>${t.title}</strong><br><small>${t.questions.length} Questions</small></div>
            <div>
                <button class="btn-secondary btn-sm" onclick="editTest('${t.id}')"><i class="fas fa-edit"></i></button>
                <button class="btn-danger btn-sm" onclick="deleteTest('${t.id}')"><i class="fas fa-trash"></i></button>
            </div>
        </div>
    `).join('');
}

async function deleteTest(id) {
    if (!confirm("Delete test permanently? Attempt history will be lost.")) return;
    let tests = JSON.parse(localStorage.getItem('tests') || '[]');
    tests = tests.filter(t => t.id != id);
    localStorage.setItem('tests', JSON.stringify(tests));
    
    await secureAssessmentSave();
    
    loadManageTests();
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
        timerBar.innerText = `TIME: ${m}:${s < 10 ? '0' + s : s}`;
        if (secs <= 0) {
            clearInterval(window.TEST_TIMER);
            alert("Time's up! Submitting automatically.");
            submitTest();
        }
        secs--;
    }, 1000);
}
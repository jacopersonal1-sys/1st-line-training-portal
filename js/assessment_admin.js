/* ================= ASSESSMENT ADMIN ================= */
/* Dashboard, Marking Queue, and Grading Logic */

/**
 * 1. ADMIN: ASSESSMENT DASHBOARD (OVERVIEW)
 */
function loadAssessmentDashboard() {
    const container = document.getElementById('assessmentDashboard');
    if (!container) return;
    
    container.innerHTML = '';

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

// QUICK APPROVE
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
        recs[existingIdx].score = sub.score;
        recs[existingIdx].date = sub.date;
        recs[existingIdx].cycle = cycleVal;
        recs[existingIdx].docSaved = true;
        if(!recs[existingIdx].id) recs[existingIdx].id = newRecord.id;
    } else {
        recs.push(newRecord);
    }

    localStorage.setItem('records', JSON.stringify(recs));
    
    await secureAssessmentSave(); 
    
    alert("Approved & Recorded.");
    loadMarkingQueue();
    if(typeof loadTestRecords === 'function') loadTestRecords();
    if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
}

// DETAILED MARKING (Modal)
function openAdminMarking(subId) {
    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const sub = subs.find(s => s.id === subId);
    if (!sub) return alert("Error: Submission data not found.");

    // SNAPSHOT LOGIC: STRICTLY use saved test definition if available (Historical accuracy)
    let test = sub.testSnapshot;
    
    if (!test || !test.questions) {
        const tests = JSON.parse(localStorage.getItem('tests') || '[]');
        test = tests.find(t => t.id == sub.testId); 
    }

    if(!test) return alert("Original Assessment definition seems to be deleted.");

    const modal = document.getElementById('markingModal');
    const container = document.getElementById('markingContainer');
    modal.classList.remove('hidden');
    
    const isLocked = sub.status === 'completed' && CURRENT_USER.role !== 'admin';

    container.innerHTML = `
        <div style="margin-bottom:20px; border-bottom:2px solid var(--border-color); padding-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
            <div><h2 style="margin:0;">Marking: ${sub.trainee}</h2><p style="color:var(--primary); font-weight:bold; margin:5px 0;">${sub.testTitle}</p></div>
            <button class="btn-secondary" onclick="printAssessmentView()"><i class="fas fa-print"></i> Print</button>
        </div>
    `;

    test.questions.forEach((q, idx) => {
        if (!sub.testSnapshot && sub.answers && !Object.prototype.hasOwnProperty.call(sub.answers, idx)) return;

        const userAns = sub.answers[idx];
        const pointsMax = parseFloat(q.points || 1);
        let markHtml = '';
        let autoScore = 0;
        
        let adminNoteHtml = q.adminNotes ? `<div style="margin-bottom:10px; padding:8px; background:rgba(243, 112, 33, 0.1); border-left:3px solid var(--primary); font-size:0.85rem; color:var(--text-main); white-space: pre-wrap;"><strong><i class="fas fa-info-circle"></i> Marker Note:</strong> ${q.adminNotes}</div>` : '';
        
        const refBtn = q.imageLink ? `<button class="btn-secondary btn-sm" onclick="openReferenceViewer('${q.imageLink}')" style="float:right; margin-left:10px;"><i class="fas fa-image"></i> View Reference</button>` : '';

        let trainerCommentHtml = (sub.comments && sub.comments[idx]) ? `<div style="margin-bottom:10px; padding:8px; background:rgba(46, 204, 113, 0.1); border-left:3px solid #2ecc71; font-size:0.85rem; color:var(--text-main);"><strong><i class="fas fa-comment-dots"></i> Trainer Comment:</strong> ${sub.comments[idx]}</div>` : '';

        if (q.type === 'text' || q.type === 'live_practical') {
            markHtml = `
                <div style="background:var(--bg-input); padding:15px; border-radius:8px; margin-top:10px; border:1px solid var(--border-color); text-align:left;">
                    <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:5px;">MODEL ANSWER:</div>
                    <div style="margin-bottom:10px; font-style:italic; opacity:0.8;">${q.modelAnswer || 'N/A'}</div>
                    
                    <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:5px;">AGENT RESPONSE:</div>
                    <div style="white-space:pre-wrap; margin-bottom:15px; font-weight:500;">${userAns || '<i>(No response)</i>'}</div>
                    
                    ${(() => {
                        let val = 0;
                        if (sub.scores && sub.scores[idx] !== undefined && sub.scores[idx] !== null) {
                            val = sub.scores[idx];
                        } else {
                            val = 0; 
                        }
                        return `
                    <div style="display:flex; align-items:center; gap:10px; border-top:1px dashed var(--border-color); padding-top:10px;">
                        <label style="font-weight:bold;">Score (Max ${pointsMax}):</label>
                        <input type="number" class="q-mark" data-idx="${idx}" min="0" max="${pointsMax}" step="0.5" value="${val}" style="width:80px; padding:5px;" ${isLocked ? 'disabled' : ''}>
                    </div>`;
                    })()}
                </div>`;
        } 
        else {
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
                const totalRows = (q.rows || []).length;
                (q.rows || []).forEach((r, rIdx) => {
                    const correctColIdx = q.correct ? q.correct[rIdx] : null;
                    if (userAns && userAns[rIdx] == correctColIdx) correctRows++;
                });
                if (totalRows > 0) {
                    autoScore = (correctRows / totalRows) * pointsMax;
                    autoScore = Math.round(autoScore * 10) / 10;
                }
            }
            else if (q.type === 'multi_select') {
               const correctArr = (q.correct || []).map(Number);
               const userArr = (userAns || []).map(Number);
               let match = 0;
               let incorrect = 0;
               userArr.forEach(a => { 
                   if(correctArr.includes(a)) match++; 
                   else incorrect++;
               });
               if(correctArr.length > 0) {
                   let rawScore = ((match - incorrect) / correctArr.length) * pointsMax;
                   autoScore = Math.max(0, rawScore);
                   autoScore = Math.round(autoScore * 10) / 10;
               }
            }
            else {
                if (userAns == q.correct) autoScore = pointsMax;
            }
            
            let answerDisplay = `<div style="font-style:italic; color:var(--text-muted);">No Answer</div>`;
            
            if (q.type === 'matrix') {
                answerDisplay = '<div class="table-responsive"><table class="matrix-table" style="width:100%; text-align:center;"><thead><tr><th></th>';
                (q.cols || []).forEach(c => { answerDisplay += `<th>${c}</th>`; });
                answerDisplay += '</tr></thead><tbody>';
                (q.rows || []).forEach((r, rIdx) => {
                    answerDisplay += `<tr><td style="text-align:left; font-weight:bold;">${r}</td>`;
                    (q.cols || []).forEach((c, cIdx) => {
                        const isSelected = (userAns && userAns[rIdx] == cIdx);
                        const isCorrect = (q.correct && q.correct[rIdx] == cIdx);
                        let cellContent = '<i class="far fa-circle" style="color:var(--border-color); opacity:0.3;"></i>';
                        let cellStyle = '';
                        if (isSelected) {
                            if (isCorrect) {
                                cellContent = '<i class="fas fa-check-circle" style="color:#2ecc71; font-size:1.2rem;"></i>';
                                cellStyle = 'background:rgba(46, 204, 113, 0.1);';
                            } else {
                                cellContent = '<i class="fas fa-times-circle" style="color:#ff5252; font-size:1.2rem;"></i>';
                                cellStyle = 'background:rgba(255, 82, 82, 0.1);';
                            }
                        } else if (isCorrect) {
                            cellContent = '<i class="fas fa-check" style="color:#2ecc71; opacity:0.5;"></i>';
                            cellStyle = 'border: 2px dashed #2ecc71;';
                        }
                        answerDisplay += `<td style=""></td>`;
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
                    return `<div style="padding:5px; ">${isSelected ? '●' : '○'}  ${isCorrect ? ' (Correct)' : ''}</div>`;
                }).join('');
            }
            else if (q.type === 'multi_select') {
                answerDisplay = (q.options || []).map((opt, oIdx) => {
                    const isSelected = userAns && userAns.includes(oIdx);
                    const isCorrect = q.correct && q.correct.includes(oIdx);
                    return `<div style="padding:5px; ${isSelected ? 'color:var(--primary); font-weight:bold;' : ''}">${isSelected ? '☑' : '☐'}  ${isCorrect ? ' (Correct)' : ''}</div>`;
                }).join('');
            }
            else {
                answerDisplay = JSON.stringify(userAns);
            }

            let currentVal = autoScore;
            if (sub.scores && sub.scores[idx] !== undefined && sub.scores[idx] !== null) {
                currentVal = sub.scores[idx];
            } else if (sub.status === 'completed' && !sub.scores) {
                currentVal = Math.round(((sub.score || 0) / 100) * pointsMax * 2) / 2;
            }

            markHtml = `
                <div style="background:var(--bg-input); padding:10px; border-radius:6px; margin-top:5px; text-align:left;">
                    <div style="margin-bottom:10px;"></div>
                    <div style="font-size:0.9rem; border-top:1px solid var(--border-color); padding-top:5px; font-weight:bold; display:flex; align-items:center; justify-content:space-between;">
                        ${!isLocked ? 
                            `<div style="display:flex; align-items:center; gap:10px; width:100%;">
                                <span style="margin-right:auto; color:var(--text-muted); font-weight:normal; font-size:0.8rem;">(Auto: ${autoScore})</span>
                                <label>Score:</label>
                                <input type="number" class="q-mark" data-idx="${idx}" min="0" max="${pointsMax}" step="0.5" value="${currentVal}" style="width:80px; padding:5px;">
                                <span style="color:var(--text-muted); font-weight:normal;">/ ${pointsMax}</span>
                             </div>` 
                            : 
                            `<span>Score: ${currentVal} / ${pointsMax}</span><input type="hidden" class="q-mark" data-idx="${idx}" value="${currentVal}">`
                        }
                    </div>
                </div>`;
        }

        container.innerHTML += `
            <div class="marking-item" style="margin-bottom:25px;">
                <div style="font-weight:600;">Q${idx + 1}: ${q.text} ${refBtn} <span style="float:right; font-size:0.8rem; color:var(--text-muted);">(${pointsMax} pts)</span></div>
                ${adminNoteHtml}${trainerCommentHtml}${markHtml}
            </div>`;
    });

    const submitBtn = document.getElementById('markingSubmitBtn');
    if(isLocked) {
        submitBtn.style.display = 'none';
    } else {
        submitBtn.style.display = 'inline-block';
        submitBtn.innerText = sub.status === 'completed' ? "Save Changes" : "Finalize Score & Push to Records";
        submitBtn.onclick = () => finalizeAdminMarking(subId);
    }
}

function viewCompletedTest(trainee, assessment, mode = 'view') {
    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const sub = subs.find(s => s.trainee === trainee && s.testTitle === assessment);
    
    if(!sub) {
        alert("Digital submission file not found.");
        return;
    }
    
    openAdminMarking(sub.id);
    
    setTimeout(() => {
        const btn = document.getElementById('markingSubmitBtn');
        if(btn) btn.style.display = 'none';
    }, 50);
    
    if (mode === 'view') {
        setTimeout(() => {
            const btn = document.getElementById('markingSubmitBtn');
            if(btn) btn.style.display = 'none';
        }, 50);
    }
}

async function finalizeAdminMarking(subId) {
    if (!confirm("Save changes to scores? This will update the permanent record.")) return;

    if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
    }

    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const sub = subs.find(s => s.id === subId);
    
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const test = tests.find(t => t.id == sub.testId);
    let maxScore = 0;
    if(test) test.questions.forEach(q => maxScore += parseFloat(q.points || 1));
    else maxScore = document.querySelectorAll('.q-mark').length; 

    const markInputs = document.querySelectorAll('.q-mark');
    let earnedPoints = 0;
    const specificScores = {}; 

    markInputs.forEach(input => {
        const val = parseFloat(input.value) || 0;
        earnedPoints += val;
        const idx = input.getAttribute('data-idx');
        if (idx !== null) specificScores[idx] = val;
    });

    const percentage = maxScore > 0 ? Math.round((earnedPoints / maxScore) * 100) : 0;

    sub.score = percentage;
    sub.status = 'completed';
    sub.scores = specificScores; 
    
    sub.lastEditedBy = CURRENT_USER.user;
    sub.lastEditedDate = new Date().toISOString();

    localStorage.setItem('submissions', JSON.stringify(subs));

    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    let groupId = "Unknown";
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
        if(!records[existingIdx].id) records[existingIdx].id = newRecord.id;
    } else {
        records.push(newRecord);
    }
    
    localStorage.setItem('records', JSON.stringify(records));

    await secureAssessmentSave(); 

    if(typeof showToast === 'function') showToast(`Marking Finalized! Trainee scored ${percentage}%`, "success");
    document.getElementById('markingModal').classList.add('hidden');
    
    loadMarkingQueue();
    loadAssessmentDashboard();
    if (typeof renderMonthly === 'function') renderMonthly();
    if (typeof loadTestRecords === 'function') loadTestRecords();
    if (typeof loadCompletedHistory === 'function') loadCompletedHistory();
}

// --- PRINT HELPER ---
function printAssessmentView() {
    document.body.classList.add('printing-modal');
    window.print();
    document.body.classList.remove('printing-modal');
}

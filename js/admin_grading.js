/* ================= ADMIN: GRADING & RECORDS ================= */
/* Responsibility: Manual Score Capture (Capture Tab) & History (Test Records Tab) */

// --- SECTION 1: MANUAL SCORE CAPTURE (Physical/External) ---

function loadGroupMembers() { 
    const gid = document.getElementById('selectedGroup').value;
    const t = document.getElementById('captureTable'); 
    
    if(!gid) return t.innerHTML='<tr><td colspan="4">Select Group</td></tr>'; 
    
    const rosters = JSON.parse(localStorage.getItem('rosters')||'{}'); 
    const members = rosters[gid] || [];
    
    t.innerHTML = members.map(n => `
        <tr data-trainee="${n}">
            <td><div style="display:flex; align-items:center;">${getAvatarHTML(n)} ${n}</div></td>
            <td><input type="number" class="score-input" min="0" max="100"></td>
            <td align="center"><input type="checkbox" class="doc-input"></td>
            <td align="center" class="video-col hidden"><input type="checkbox" class="video-input"></td>
        </tr>
    `).join(''); 
    
    handleAssessmentChange(); 
}

function updateAssessmentDropdown() { 
    const s = document.getElementById('assessment');
    const arr = JSON.parse(localStorage.getItem('assessments')||'[]'); 
    
    if(s) {
        const currentVal = s.value;
        let html = arr.map(a => `<option value="${a.name}" data-video="${a.video}">${a.name}</option>`).join(''); 
        
        // ROBUSTNESS: Ensure Vetting options exist for manual capture
        if(!arr.some(a => a.name === '1st Vetting Test')) html += `<option value="1st Vetting Test">1st Vetting Test</option>`;
        if(!arr.some(a => a.name === 'Final Vetting Test')) html += `<option value="Final Vetting Test">Final Vetting Test</option>`;
        
        s.innerHTML = html;
        if(currentVal) s.value = currentVal;
        updateAssessmentDropdownLogic(); // Trigger change handler safely
    }
}

// Wrapper to handle initial load vs onchange
function updateAssessmentDropdownLogic() {
    if(typeof handleAssessmentChange === 'function') handleAssessmentChange();
}

function handlePhaseChange() {
    const phase = document.getElementById('phase').value;
    const vettingDiv = document.getElementById('vettingOptions');
    const vettingSelect = document.getElementById('vettingTopic');

    if (phase === '1st Vetting' || phase === 'Final Vetting') {
        vettingDiv.classList.remove('hidden');
        const topics = JSON.parse(localStorage.getItem('vettingTopics') || '[]');
        vettingSelect.innerHTML = '<option value="">-- Select Topic --</option>' + topics.map(t => `<option>${t}</option>`).join('');
    } else {
        vettingDiv.classList.add('hidden');
    }
}

function handleAssessmentChange() { 
    const select = document.getElementById('assessment'); 
    if(!select) return;
    
    const selectedName = select.value; 
    const isVideoReq = select.selectedOptions[0]?.getAttribute('data-video') === 'true'; 
    
    document.querySelectorAll('.video-col').forEach(c => isVideoReq ? c.classList.remove('hidden') : c.classList.add('hidden')); 
}

// UPDATED: Async Save for Manual Scores with Deduplication
async function saveScores() { 
    if (CURRENT_USER.role === 'special_viewer') {
        if(typeof showToast === 'function') showToast("View Only Mode: Cannot save scores.", "error");
        return;
    }

    const gid = document.getElementById('selectedGroup').value; 
    if(!gid) {
        if(typeof showToast === 'function') showToast("Please select a group.", "warning");
        return;
    }
    
    const assessName = document.getElementById('assessment').value; 
    const phase = document.getElementById('phase').value; 
    let finalAssessName = assessName; 

    // NEW: Capture Date from Input
    const dateInput = document.getElementById('captureDate');
    const captureDate = (dateInput && dateInput.value) ? dateInput.value : new Date().toISOString().split('T')[0];
    
    // If Phase is Vetting, construct name from Phase + Topic
    if(phase === '1st Vetting' || phase === 'Final Vetting') { 
        const topic = document.getElementById('vettingTopic').value; 
        if(!topic) {
            if(typeof showToast === 'function') showToast("Please select a Vetting Topic.", "warning");
            return;
        }
        finalAssessName = `${phase} - ${topic}`; 
    } 
    
    const recs = JSON.parse(localStorage.getItem('records')||'[]'); 

    // --- FAIL-SAFE: Check for existing scores to prevent overwrites ---
    const conflicts = [];
    document.querySelectorAll('#captureTable tr').forEach(r => {
        const scInput = r.querySelector('.score-input');
        const sc = scInput ? scInput.value : '';
        
        if(sc !== "" && sc !== undefined && sc !== null) {
            const traineeName = r.dataset.trainee;
            if(traineeName) {
                // Check if a record already exists for this exact combination
                const exists = recs.some(item => 
                    item.trainee.toLowerCase() === traineeName.toLowerCase() && 
                    item.assessment.toLowerCase() === finalAssessName.toLowerCase() && 
                    (item.groupID||'').toLowerCase() === gid.toLowerCase() && 
                    (item.phase||'').toLowerCase() === phase.toLowerCase()
                );
                if(exists) conflicts.push(traineeName);
            }
        }
    });

    if(conflicts.length > 0) {
        alert(`⚠️ SAVE FAILED: SCORES ALREADY EXIST\n\nThe following trainees already have a score for "${finalAssessName}":\n\n${conflicts.join(', ')}\n\nTo prevent accidental overwrites, this action has been blocked.\nPlease edit these records individually in the 'Assessment Records' tab if you intended to update them.`);
        return;
    }
    // -----------------------------------------------------------------

    let savedCount = 0;

    document.querySelectorAll('#captureTable tr').forEach(r => { 
        const scInput = r.querySelector('.score-input');
        const sc = scInput ? scInput.value : ''; 

        // STRICT CHECK: Only save if value is not empty string (0 is allowed)
        if(sc !== "" && sc !== undefined && sc !== null) { 
            const traineeName = r.dataset.trainee;
            let cycleVal = "New Onboard";
            
            // Priority: Dynamic Calculation > Manual Dropdown
            if(typeof getTraineeCycle === 'function') {
                cycleVal = getTraineeCycle(traineeName, gid);
            } else {
                cycleVal = document.getElementById('cycle').value; 
            }

            const docChecked = r.querySelector('.doc-input').checked;
            const videoChecked = r.querySelector('.video-input').checked;

            // DEDUPLICATION: Check if record exists
            const existingIndex = recs.findIndex(item => 
                item.trainee.toLowerCase() === traineeName.toLowerCase() && 
                item.assessment.toLowerCase() === finalAssessName.toLowerCase() &&
                (item.groupID||'').toLowerCase() === gid.toLowerCase() &&
                (item.phase||'').toLowerCase() === phase.toLowerCase()
            );

            if (existingIndex > -1) {
                // UPDATE EXISTING RECORD
                recs[existingIndex].score = Number(sc);
                recs[existingIndex].cycle = cycleVal; // Update cycle if changed
                recs[existingIndex].date = captureDate; // Update date
                recs[existingIndex].docSaved = docChecked;
                recs[existingIndex].videoSaved = videoChecked;
                recs[existingIndex].lastModified = new Date().toISOString();
                recs[existingIndex].modifiedBy = CURRENT_USER.user;
                // Ensure ID exists (Migration for old records)
                if(!recs[existingIndex].id) recs[existingIndex].id = Date.now() + "_" + Math.random().toString(36).substr(2, 9);
            } else {
                // INSERT NEW RECORD (With Unique ID)
                recs.push({ 
                    id: Date.now() + "_" + Math.random().toString(36).substr(2, 9),
                    groupID: gid, 
                    cycle: cycleVal, 
                    phase: phase, 
                    assessment: finalAssessName, 
                    trainee: traineeName, 
                    score: Number(sc), 
                    date: captureDate, // Save selected date
                    docSaved: docChecked, 
                    videoSaved: videoChecked, 
                    link: "",
                    lastModified: new Date().toISOString(),
                    modifiedBy: CURRENT_USER.user
                }); 
            }

            savedCount++;
        } 
    }); 
    
    localStorage.setItem('records', JSON.stringify(recs)); 
    
    // Ensure users exist if we just added records for them
    if(typeof scanAndGenerateUsers === 'function') scanAndGenerateUsers(true); 
    
    // --- CLOUD SYNC START ---
    // OPTIMISTIC SAVE: Don't block the UI. Sync in background.
    if(typeof saveToServer === 'function') {
        saveToServer(['records'], false).catch(err => console.error("Background Sync Failed:", err));
        if(typeof showToast === 'function') showToast("Scores saved. Syncing to cloud...", "info");
    }
    // --- CLOUD SYNC END ---
    
    if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns(); 
    
    if(typeof showToast === 'function') showToast(`Saved/Updated ${savedCount} scores successfully.`, "success");
    
    // Cleanup UI
    // FIX: Blur active element to prevent Electron focus loss on DOM destruction
    if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
    }
    
    // FIX: Increased timeout to 100ms to ensure DOM settles before rebuild
    setTimeout(() => loadGroupMembers(), 100); 
}

// --- SECTION 2: DIGITAL MARKING QUEUE ---
// REMOVED: This logic is now handled in 'assessment.js' (File 8).
// We deleted 'loadMarkingQueue' and 'approveSubmission' here to avoid 
// conflicts with the more advanced grading engine in assessment.js.

// --- SECTION 3: TEST RECORDS & HISTORY ---

function normalizeSubmissionText(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function canonicalizeVettingTestTitle(rawTitle) {
    const original = String(rawTitle || '').trim();
    if (!original) return '';

    const lower = normalizeSubmissionText(original);
    if (!lower.includes('vetting')) return original;

    let phase = '';
    if (lower.includes('final vetting')) phase = 'Final Vetting';
    else if (lower.includes('1st vetting') || lower.includes('first vetting')) phase = '1st Vetting';

    let topic = '';
    if (lower.includes('no internet')) topic = 'No internet';
    else if (lower.includes('slow speed')) topic = 'Slow Speed';
    else if (lower.includes('course 1 - 3') || lower.includes('course 1-3') || lower.includes('course 1 3')) topic = 'Course 1 - 3';
    else if (lower.includes('voip')) topic = 'VoIP';
    else if (lower.includes('email')) topic = 'Email';

    if (!phase || !topic) return original;
    const suffix = phase === 'Final Vetting' ? 'Final Vetting Test' : '1st Vetting Test';
    return `${phase} - ${topic} ${suffix}`;
}

function getSubmissionDisplayKey(title) {
    const normalized = canonicalizeVettingTestTitle(title);
    return normalizeSubmissionText(normalized || title);
}

function getSubmissionRowSortTime(row) {
    if (!row) return 0;
    const directTs = Date.parse(row.lastModified || row.updated_at || row.createdAt || '');
    if (!Number.isNaN(directTs) && directTs > 0) return directTs;

    const idTs = Number(row.id);
    if (!Number.isNaN(idTs) && idTs > 0) return idTs;

    const dateTs = Date.parse(`${row.date || ''}T00:00:00Z`);
    return Number.isNaN(dateTs) ? 0 : dateTs;
}

function dedupeVettingRows(items) {
    const seenById = new Set();
    const stableRows = [];
    const pendingByLogicalAttempt = new Map();

    (items || []).forEach(item => {
        if (!item) return;

        if (item.id) {
            const idKey = `${item.source || 'row'}:${String(item.id)}`;
            if (seenById.has(idKey)) return;
            seenById.add(idKey);
        }

        const isPendingDigital = item.source === 'digital' && String(item.status || '').toLowerCase() === 'pending';
        if (!isPendingDigital) {
            stableRows.push(item);
            return;
        }

        // Anti-flood collapse for duplicated pending rows of the same logical attempt.
        const logicalKey = [
            normalizeSubmissionText(item.trainee),
            item.testKey || getSubmissionDisplayKey(item.testTitle),
            normalizeSubmissionText(item.date)
        ].join('|');

        const previous = pendingByLogicalAttempt.get(logicalKey);
        if (!previous || getSubmissionRowSortTime(item) >= getSubmissionRowSortTime(previous)) {
            pendingByLogicalAttempt.set(logicalKey, item);
        }
    });

    return [...stableRows, ...pendingByLogicalAttempt.values()];
}

function loadTestRecords() {
    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const records = JSON.parse(localStorage.getItem('records') || '[]');
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    const tbody = document.querySelector('#testRecordsTable tbody');
    
    // Hide filters for Trainee to reduce clutter
    const filterDiv = document.querySelector('#test-records .grid-4');
    if (filterDiv) {
        if (CURRENT_USER.role === 'trainee') filterDiv.classList.add('hidden');
        else filterDiv.classList.remove('hidden');
    }

    if (CURRENT_USER.role === 'trainee') {
        if (tbody) {
            if (typeof setTableState === 'function') {
                setTableState(tbody, 7, 'empty', 'Marked scripts are locked after review.', 'Trainees cannot reopen completed marked scripts from this area.', 'fa-lock');
            } else {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#888;">Marked scripts are locked after review and cannot be reopened by trainees.</td></tr>';
            }
        }
        return;
    }
    
    // Filters
    const groupFilter = document.getElementById('filterTestGroup').value;
    const nameFilter = document.getElementById('filterTestName').value;
    const normalizedNameFilter = normalizeSubmissionText(nameFilter);
    const statusFilter = document.getElementById('filterTestStatus').value;
    const traineeFilter = document.getElementById('filterTestTrainee').value.toLowerCase();
    
    // --- 1. MERGE DATA SOURCES (Digital + Manual Vetting) ---
    let combinedData = [];

    // A. Digital Submissions (Vetting Only)
    subs.forEach(s => {
        // Check if it's a vetting test
        const testDef = tests.find(t => t.id == s.testId || t.title === s.testTitle);
        const isVetting = (testDef && testDef.type === 'vetting') || s.testTitle.toLowerCase().includes('vetting');
        
        if (isVetting) {
            const canonicalTitle = canonicalizeVettingTestTitle(s.testTitle);
            const linkedRecord = records.find(r => r && (r.submissionId === s.id || r.id === `record_${s.id}`));
            const normalizedScore = Number(s.score);
            const linkedScore = linkedRecord ? Number(linkedRecord.score) : NaN;
            combinedData.push({
                id: s.id,
                date: s.date,
                trainee: s.trainee,
                testTitle: canonicalTitle || s.testTitle,
                testKey: getSubmissionDisplayKey(canonicalTitle || s.testTitle),
                score: Number.isFinite(normalizedScore) ? normalizedScore : (Number.isFinite(linkedScore) ? linkedScore : 0),
                status: s.status,
                createdAt: s.createdAt,
                lastModified: s.lastModified,
                source: 'digital'
            });
        }
    });

    // B. Manual Records (Vetting Only)
    records.forEach(r => {
        // Only include if phase is Vetting AND it's NOT a digital record (avoid duplicates)
        if (r.phase && r.phase.includes('Vetting') && r.link !== 'Digital-Assessment' && r.link !== 'Live-Session') {
            const canonicalTitle = canonicalizeVettingTestTitle(r.assessment);
            combinedData.push({
                id: r.id,
                date: r.date,
                trainee: r.trainee,
                testTitle: canonicalTitle || r.assessment,
                testKey: getSubmissionDisplayKey(canonicalTitle || r.assessment),
                score: r.score,
                status: 'completed', // Manual records are always completed
                createdAt: r.createdAt,
                lastModified: r.lastModified,
                source: 'manual'
            });
        }
    });

    combinedData = dedupeVettingRows(combinedData);

    // --- 2. POPULATE FILTERS DYNAMICALLY ---
    const nameSelect = document.getElementById('filterTestName');
    const groupSelect = document.getElementById('filterTestGroup');

    if (nameSelect && groupSelect) {
        // Only repopulate if not currently focused (prevents UI glitch while typing/selecting)
        if (document.activeElement !== nameSelect && document.activeElement !== groupSelect) {
            const testMap = new Map();
            combinedData.forEach(d => {
                const key = d.testKey || getSubmissionDisplayKey(d.testTitle);
                if (!key) return;
                if (!testMap.has(key)) testMap.set(key, d.testTitle);
            });
            const uniqueTests = Array.from(testMap.entries()).sort((a, b) => a[1].localeCompare(b[1]));
            const uniqueGroups = Object.keys(rosters).sort().reverse();

            nameSelect.innerHTML = '<option value="">All Tests</option>';
            uniqueTests.forEach(([key, label]) => nameSelect.add(new Option(label, key)));
            if (normalizedNameFilter && testMap.has(normalizedNameFilter)) nameSelect.value = normalizedNameFilter;

            groupSelect.innerHTML = '<option value="">All Groups</option>';
            uniqueGroups.forEach(g => {
                const label = (typeof getGroupLabel === 'function') ? getGroupLabel(g, rosters[g].length) : g;
                groupSelect.add(new Option(label, g));
            });
            if (groupFilter && uniqueGroups.includes(groupFilter)) groupSelect.value = groupFilter;
        }
    }

    if(tbody) {
        tbody.innerHTML = '';
        
        const filtered = combinedData.filter(s => {
            if(normalizedNameFilter && (s.testKey || getSubmissionDisplayKey(s.testTitle)) !== normalizedNameFilter) return false;
            if(statusFilter && s.status !== statusFilter) return false;
            if(traineeFilter && !s.trainee.toLowerCase().includes(traineeFilter)) return false;

            // Trainee Restriction: Only show my own records
            if (CURRENT_USER.role === 'trainee' && s.trainee.toLowerCase() !== CURRENT_USER.user.toLowerCase()) return false;
            
            // Group Filter
            if (groupFilter) {
                const members = rosters[groupFilter] || [];
                if (!members.some(m => m.toLowerCase() === s.trainee.toLowerCase())) return false;
            }
            
            return true;
        });

        if(filtered.length === 0) {
            if (typeof setTableState === 'function') {
                setTableState(tbody, 7, 'empty', 'No vetting submissions found.', 'Try another group, test, status, or trainee search.', 'fa-magnifying-glass');
            } else {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#888;">No records found.</td></tr>';
            }
        } else {
            // Sort by Date Descending
            filtered.sort((a,b) => new Date(b.date) - new Date(a.date));
            
            filtered.forEach(s => {
                // Find Group
                let groupID = "Unknown";
                for (const [gid, members] of Object.entries(rosters)) {
                    if (members.some(m => m.toLowerCase() === s.trainee.toLowerCase())) { 
                        groupID = gid; 
                        break; 
                    }
                }
                
                // Format Group
                let groupDisplay = groupID;
                if (groupID.includes('-')) {
                    const parts = groupID.split('-');
                    if (parts.length >= 2) {
                        const y = parseInt(parts[0]);
                        const m = parseInt(parts[1]);
                        const date = new Date(y, m - 1);
                        groupDisplay = date.toLocaleString('default', { month: 'long', year: 'numeric' });
                        if (parts.length > 2) groupDisplay += ` (Group ${parts[2]})`;
                    }
                }

                const scoreDisplay = s.status === 'completed' ? `<span style="font-weight:bold; color:green;">${s.score}%</span>` : '<span style="color:orange;">Pending</span>';
                const statusBadge = s.status === 'completed' ? '<span class="status-badge status-pass">Completed</span>' : '<span class="status-badge status-semi">Pending</span>';
                
                const safeTrainee = s.trainee.replace(/'/g, "\\'");
                const safeTitle = s.testTitle.replace(/'/g, "\\'");

                let actionBtn = '';

                if (s.source === 'digital') {
                    // Link to 'assessment.js' viewer
                    actionBtn = `<button class="btn-secondary btn-sm" onclick="viewCompletedTest('${s.id}', null, 'view')">View</button>`;
                } else {
                    actionBtn = `<span style="font-size:0.8rem; color:var(--text-muted); font-style:italic;">Manual</span>`;
                }
                
                // ADMIN ONLY ACTIONS
                if ((CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin') && CURRENT_USER.role !== 'teamleader') {
                    if (s.source === 'digital') {
                        actionBtn += ` <button class="btn-primary btn-sm" onclick="viewCompletedTest('${s.id}', null, 'edit')" title="Edit Score"><i class="fas fa-pen"></i></button>`;
                        actionBtn += ` <button class="btn-danger btn-sm" onclick="deleteSubmission('${s.id}')"><i class="fas fa-trash"></i></button>`;
                        
                        // Allow Retake if not already archived
                        if (s.status === 'completed' || s.status === 'pending') {
                            actionBtn += ` <button class="btn-warning btn-sm" onclick="allowRetake('${s.id}')" title="Allow Retake"><i class="fas fa-redo"></i></button>`;
                        }
                    } else {
                        // Manual Record Actions (Limited)
                        // We don't have a direct delete here because it's a record, not a submission.
                        // Users should go to "Assessment Records" to manage manual records.
                    }
                }

                tbody.innerHTML += `<tr><td>${s.date}</td><td>${groupDisplay}</td><td><div style="display:flex; align-items:center;">${getAvatarHTML(s.trainee)} ${s.trainee}</div></td><td>${s.testTitle}</td><td>${scoreDisplay}</td><td>${statusBadge}</td><td>${actionBtn}</td></tr>`;
            });
        }
    }
}

// UPDATED: Async Retake Grant
async function allowRetake(subId) {
    if(!confirm("Allow this user to retake the assessment? This will archive the current attempt.")) return;
    
    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const sub = subs.find(s => s.id == subId);
    
    if(sub) {
        sub.archived = true;
        // 'retake_allowed' flag helps assessment.js know to unlock the test
        sub.status = 'retake_allowed'; 
        localStorage.setItem('submissions', JSON.stringify(subs));
        
        // RESET VETTING SESSION STATUS IF APPLICABLE
        // This ensures the trainee can re-enter the Arena and isn't stuck on "Submitted"
        const session = JSON.parse(localStorage.getItem('vettingSession') || '{}');
        if (session.active && session.testId == sub.testId) {
            if (session.trainees && session.trainees[sub.trainee]) {
                delete session.trainees[sub.trainee]; 
                localStorage.setItem('vettingSession', JSON.stringify(session));
            }
        }

        // --- CLOUD SYNC (Instant) ---
        if(typeof saveToServer === 'function') await saveToServer(['submissions', 'vettingSession'], true);
        
        alert("Retake granted.");
        loadTestRecords();
    }
}

// UPDATED: Async Delete
async function deleteSubmission(id) {
    if(!confirm("Delete submission?")) return;

    let subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const sub = subs.find(s => s.id == id);
    let records = JSON.parse(localStorage.getItem('records') || '[]');
    const targetRecord = sub ? records.find(r => r.submissionId === sub.id)
        || records.find(r => r.id === `record_${sub.id}`)
        || records.find(r => sub.bookingId && r.bookingId === sub.bookingId)
        || records.find(r => sub.liveSessionId && r.liveSessionId === sub.liveSessionId) : null;
    
    // 1. AUTHORITATIVE DELETE (Server First)
    if (typeof hardDelete === 'function') {
        const success = await hardDelete('submissions', id);
        if (!success) {
            alert("Failed to delete submission from server. Please check connection.");
            return;
        }
        if (targetRecord?.id) {
            await hardDelete('records', targetRecord.id);
        }
    }

    // 2. Update Local State
    subs = subs.filter(s => s.id != id);
    localStorage.setItem('submissions', JSON.stringify(subs));

    if (targetRecord?.id) {
        records = records.filter(r => r.id !== targetRecord.id);
        localStorage.setItem('records', JSON.stringify(records));
    }
    
    loadTestRecords();
}

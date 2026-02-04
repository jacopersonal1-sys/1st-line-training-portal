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
            <td>${n}</td>
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
        s.innerHTML = arr.map(a => `<option value="${a.name}" data-video="${a.video}">${a.name}</option>`).join(''); 
        if(currentVal) s.value = currentVal;
        updateAssessmentDropdownLogic(); // Trigger change handler safely
    }
}

// Wrapper to handle initial load vs onchange
function updateAssessmentDropdownLogic() {
    if(typeof handleAssessmentChange === 'function') handleAssessmentChange();
}

function handleAssessmentChange() { 
    const select = document.getElementById('assessment'); 
    if(!select) return;
    
    const selectedName = select.value; 
    const isVideoReq = select.selectedOptions[0]?.getAttribute('data-video') === 'true'; 
    
    document.querySelectorAll('.video-col').forEach(c => isVideoReq ? c.classList.remove('hidden') : c.classList.add('hidden')); 
    
    const vettingDiv = document.getElementById('vettingOptions'); 
    const vettingSelect = document.getElementById('vettingTopic'); 
    
    if(selectedName && selectedName.includes("Vetting Test")) { 
        vettingDiv.classList.remove('hidden'); 
        const topics = JSON.parse(localStorage.getItem('vettingTopics') || '[]'); 
        const currentTopic = vettingSelect.value;
        vettingSelect.innerHTML = '<option value="">-- Select Topic --</option>' + topics.map(t => `<option>${t}</option>`).join(''); 
        if(currentTopic) vettingSelect.value = currentTopic;
    } else { 
        vettingDiv.classList.add('hidden'); 
    } 
}

// UPDATED: Async Save for Manual Scores with Deduplication
async function saveScores() { 
    const gid = document.getElementById('selectedGroup').value; 
    if(!gid) return alert("Select group"); 
    
    const assessName = document.getElementById('assessment').value; 
    const phase = document.getElementById('phase').value; 
    let finalAssessName = assessName; 
    
    const vettingDiv = document.getElementById('vettingOptions'); 
    if(!vettingDiv.classList.contains('hidden')) { 
        const topic = document.getElementById('vettingTopic').value; 
        if(!topic) return alert("Please select a Vetting Topic."); 
        finalAssessName = `${assessName} - ${topic}`; 
    } 
    
    const recs = JSON.parse(localStorage.getItem('records')||'[]'); 
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
                item.trainee === traineeName && 
                item.assessment === finalAssessName &&
                item.groupID === gid &&
                item.phase === phase
            );

            if (existingIndex > -1) {
                // UPDATE EXISTING RECORD
                recs[existingIndex].score = Number(sc);
                recs[existingIndex].cycle = cycleVal; // Update cycle if changed
                recs[existingIndex].docSaved = docChecked;
                recs[existingIndex].videoSaved = videoChecked;
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
                    docSaved: docChecked, 
                    videoSaved: videoChecked, 
                    link: "" 
                }); 
            }

            savedCount++;
        } 
    }); 
    
    localStorage.setItem('records', JSON.stringify(recs)); 
    
    // Ensure users exist if we just added records for them
    if(typeof scanAndGenerateUsers === 'function') scanAndGenerateUsers(); 
    
    // --- CLOUD SYNC START ---
    // OPTIMISTIC SAVE: Don't block the UI. Sync in background.
    if(typeof saveToServer === 'function') {
        saveToServer(true).catch(err => console.error("Background Sync Failed:", err));
        if(typeof showToast === 'function') showToast("Scores saved. Syncing to cloud...", "info");
    }
    // --- CLOUD SYNC END ---
    
    if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns(); 
    
    alert(`Saved/Updated ${savedCount} scores successfully.`); 
    
    // Cleanup UI
    loadGroupMembers(); // Re-render table to fix "untypable" input glitch and clear fields
}

// --- SECTION 2: DIGITAL MARKING QUEUE ---
// REMOVED: This logic is now handled in 'assessment.js' (File 8).
// We deleted 'loadMarkingQueue' and 'approveSubmission' here to avoid 
// conflicts with the more advanced grading engine in assessment.js.

// --- SECTION 3: TEST RECORDS & HISTORY ---

function loadTestRecords() {
    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    
    // Filters
    const nameFilter = document.getElementById('filterTestName').value;
    const statusFilter = document.getElementById('filterTestStatus').value;
    const traineeFilter = document.getElementById('filterTestTrainee').value.toLowerCase();
    
    // Populate Name Dropdown if empty
    const nameSelect = document.getElementById('filterTestName');
    if (nameSelect && nameSelect.options.length === 1) {
        tests.forEach(t => nameSelect.add(new Option(t.title, t.title)));
    }

    const tbody = document.querySelector('#testRecordsTable tbody');
    if(tbody) {
        tbody.innerHTML = '';
        
        const filtered = subs.filter(s => {
            if(nameFilter && s.testTitle !== nameFilter) return false;
            if(statusFilter && s.status !== statusFilter) return false;
            if(traineeFilter && !s.trainee.toLowerCase().includes(traineeFilter)) return false;
            
            // VETTING ONLY FILTER (As requested)
            const testDef = tests.find(t => t.id == s.testId || t.title === s.testTitle);
            if (testDef && testDef.type !== 'vetting') return false;
            if (!testDef && !s.testTitle.toLowerCase().includes('vetting')) return false; // Fallback
            
            return true;
        });

        if(filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#888;">No records found.</td></tr>';
        } else {
            filtered.sort((a,b) => b.id - a.id); // Newest first
            filtered.forEach(s => {
                const scoreDisplay = s.status === 'completed' ? `<span style="font-weight:bold; color:green;">${s.score}%</span>` : '<span style="color:orange;">Pending</span>';
                
                // Link to 'assessment.js' viewer
                // Note: 'viewCompletedTest' calls 'openAdminMarking' in assessment.js
                let actionBtn = `
                    <button class="btn-secondary btn-sm" onclick="viewCompletedTest('${s.trainee}', '${s.testTitle}')">View</button>
                    <button class="btn-danger btn-sm" onclick="deleteSubmission('${s.id}')"><i class="fas fa-trash"></i></button>
                `;
                
                // Allow Retake if not already archived
                if (s.status === 'completed' || s.status === 'pending') {
                    actionBtn += `<button class="btn-warning btn-sm" style="margin-left:5px;" onclick="allowRetake('${s.id}')" title="Allow Retake"><i class="fas fa-redo"></i></button>`;
                }

                tbody.innerHTML += `<tr><td>${s.date}</td><td>${s.trainee}</td><td>${s.testTitle}</td><td>${scoreDisplay}</td><td>${s.status}</td><td>${actionBtn}</td></tr>`;
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
        
        // --- CLOUD SYNC (Instant) ---
        if(typeof saveToServer === 'function') await saveToServer(true);
        
        alert("Retake granted.");
        loadTestRecords();
    }
}

// UPDATED: Async Delete
async function deleteSubmission(id) {
    if(!confirm("Delete submission?")) return;
    let subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    subs = subs.filter(s => s.id != id);
    localStorage.setItem('submissions', JSON.stringify(subs));
    
    // --- CLOUD SYNC (Instant) ---
    if(typeof saveToServer === 'function') await saveToServer(true);
    
    loadTestRecords();
}
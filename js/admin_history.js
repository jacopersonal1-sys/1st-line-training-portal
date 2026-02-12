/* ================= ADMIN: COMPLETED ASSESSMENT HISTORY ================= */
/* Handles the 'Completed Assessments' sub-menu in the Test Engine */

function showTestEngineSub(viewName, btn) {
    // Toggle Views
    document.getElementById('engine-view-overview').classList.add('hidden');
    document.getElementById('engine-view-history').classList.add('hidden');
    
    document.getElementById('engine-view-' + viewName).classList.remove('hidden');
    
    // Toggle Buttons
    const container = btn.parentElement;
    container.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Load Data
    if (viewName === 'history') {
        populateHistoryFilters();
        loadCompletedHistory();
    }
}

function loadCompletedHistory() {
    const container = document.getElementById('completedHistoryList');
    if (!container) return;

    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const search = document.getElementById('historySearch') ? document.getElementById('historySearch').value.toLowerCase() : '';
    const groupFilter = document.getElementById('historyGroupFilter') ? document.getElementById('historyGroupFilter').value : '';
    const testFilter = document.getElementById('historyTestFilter') ? document.getElementById('historyTestFilter').value : '';

    // Filter for Completed items
    let completed = subs.filter(s => s.status === 'completed' && !s.archived);

    // Apply Group Filter
    if (groupFilter) {
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        const members = rosters[groupFilter] || [];
        // Check if trainee is in the selected group (Case Insensitive)
        completed = completed.filter(s => members.some(m => m.toLowerCase() === s.trainee.toLowerCase()));
    }

    // Apply Test Filter
    if (testFilter) {
        completed = completed.filter(s => s.testTitle === testFilter);
    }

    // Apply Search
    if (search) {
        completed = completed.filter(s => 
            s.trainee.toLowerCase().includes(search) || 
            s.testTitle.toLowerCase().includes(search)
        );
    }

    // Sort by Date Descending (Newest First)
    completed.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (completed.length === 0) {
        container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted);">No completed assessments found.</div>';
        return;
    }

    let html = `
    <table class="admin-table">
        <thead>
            <tr>
                <th>Date</th>
                <th>Trainee</th>
                <th>Test Title</th>
                <th>Score</th>
                <th>Last Edited By</th>
                <th>Action</th>
            </tr>
        </thead>
        <tbody>`;
    
    completed.forEach(s => {
        const editedBy = s.lastEditedBy ? `<span style="font-size:0.8rem;">${s.lastEditedBy}<br><span style="color:var(--text-muted);">${new Date(s.lastEditedDate).toLocaleDateString()}</span></span>` : '-';
        
        // Score Color
        let scoreColor = 'var(--text-main)';
        if (s.score >= 90) scoreColor = '#2ecc71'; // Green
        else if (s.score < 80) scoreColor = '#ff5252'; // Red
        
        html += `
            <tr>
                <td>${s.date}</td>
                <td><strong>${s.trainee}</strong></td>
                <td>${s.testTitle}</td>
                <td><span style="font-weight:bold; color:${scoreColor};">${s.score}%</span></td>
                <td>${editedBy}</td>
                <td>
                    <button class="btn-primary btn-sm" onclick="openAdminMarking('${s.id}')" title="Raw Edit Score"><i class="fas fa-pen"></i> Edit</button>
                    <button class="btn-warning btn-sm" onclick="processHistoryRetake('${s.id}')" title="Allow Retake"><i class="fas fa-redo"></i></button>
                    <button class="btn-danger btn-sm" onclick="deleteHistorySubmission('${s.id}')" title="Delete Permanently"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
}

function populateHistoryFilters() {
    const groupSel = document.getElementById('historyGroupFilter');
    const testSel = document.getElementById('historyTestFilter');
    if (!groupSel || !testSel) return;

    // Preserve selection if re-populating
    const selGroup = groupSel.value;
    const selTest = testSel.value;

    // 1. Groups
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    groupSel.innerHTML = '<option value="">All Groups</option>';
    Object.keys(rosters).sort().reverse().forEach(gid => {
        const label = (typeof getGroupLabel === 'function') ? getGroupLabel(gid, rosters[gid].length) : gid;
        groupSel.add(new Option(label, gid));
    });
    if (selGroup) groupSel.value = selGroup;

    // 2. Tests (From Submissions History to include deleted tests)
    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const uniqueTests = [...new Set(subs.map(s => s.testTitle))].sort();
    
    testSel.innerHTML = '<option value="">All Tests</option>';
    uniqueTests.forEach(t => {
        testSel.add(new Option(t, t));
    });
    if (selTest) testSel.value = selTest;
}

async function deleteHistorySubmission(id) {
    if (!confirm("Permanently delete this submission? This will also remove the associated record from the database.")) return;
    
    let subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const sub = subs.find(s => s.id === id);
    
    if (!sub) {
        alert("Submission not found.");
        return;
    }
    
    // 1. Remove from Submissions
    subs = subs.filter(s => s.id !== id);
    localStorage.setItem('submissions', JSON.stringify(subs));
    
    // 2. Remove from Records (Database)
    // Match by Trainee + Assessment Name to ensure the record is also wiped
    let records = JSON.parse(localStorage.getItem('records') || '[]');
    const initialRecLen = records.length;
    
    records = records.filter(r => !(r.trainee === sub.trainee && r.assessment === sub.testTitle));
    
    localStorage.setItem('records', JSON.stringify(records));
    
    // 3. Force Sync to Cloud (Instant Overwrite)
    if (typeof saveToServer === 'function') await saveToServer(['submissions', 'records'], true);
    
    // FIX: Blur active element to prevent Electron focus loss
    if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
    }

    loadCompletedHistory();
    if (typeof showToast === 'function') showToast("Submission and Record deleted.", "success");
    
    // Refresh other views if needed
    if (typeof renderMonthly === 'function') renderMonthly();
}

async function processHistoryRetake(subId) {
    if(!confirm("Allow retake? This archives the current submission and unlocks the test for the trainee.")) return;
    
    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const sub = subs.find(s => s.id == subId);
    
    if(sub) {
        sub.archived = true;
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

        if(typeof saveToServer === 'function') await saveToServer(['submissions', 'vettingSession'], true);
        
        alert("Retake granted.");
        loadCompletedHistory(); // Refresh THIS view
    }
}

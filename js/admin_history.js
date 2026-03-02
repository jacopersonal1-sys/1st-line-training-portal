/* ================= ADMIN: COMPLETED ASSESSMENT HISTORY ================= */
/* Handles the 'Completed Assessments' sub-menu in the Test Engine */

function showTestEngineSub(viewName, btn) {
    // Toggle Views
    document.getElementById('engine-view-overview').classList.add('hidden');
    document.getElementById('engine-view-history').classList.add('hidden');
    if(document.getElementById('engine-view-nps')) document.getElementById('engine-view-nps').classList.add('hidden');
    if(document.getElementById('engine-view-search')) document.getElementById('engine-view-search').classList.add('hidden');
    
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
    if (viewName === 'nps') {
        if (typeof NPSSystem !== 'undefined' && typeof NPSSystem.renderAdminPanel === 'function') {
            NPSSystem.renderAdminPanel();
        }
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
                <td><div style="display:flex; align-items:center;">${getAvatarHTML(s.trainee)} <strong>${s.trainee}</strong></div></td>
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

// --- UNIVERSAL SEARCH ENGINE ---

function initUniversalSearch() {
    // 1. Inject Tab Button
    const parent = document.getElementById('test-manage');
    if (!parent) return;

    let nav = parent.querySelector('.admin-sub-nav');
    // Fallback: Find via existing buttons if class is missing
    if (!nav) {
        const existingBtn = parent.querySelector('button[onclick*="showTestEngineSub"]');
        if (existingBtn) nav = existingBtn.parentElement;
    }

    if (nav) {
        // Try to append to the button group div if it exists
        const btnContainer = nav.querySelector('div') || nav;
        if (!document.getElementById('btn-engine-search')) {
            const btn = document.createElement('button');
            btn.id = 'btn-engine-search';
            btn.className = 'sub-tab-btn';
            btn.innerHTML = '<i class="fas fa-search"></i> Universal Search';
            btn.onclick = function() { showTestEngineSub('search', this); };
            btnContainer.appendChild(btn);
        }
    }

    // 2. Inject View Container
    if (!document.getElementById('engine-view-search')) {
        const div = document.createElement('div');
        div.id = 'engine-view-search';
        div.className = 'hidden';
        div.style.width = '100%';
        div.innerHTML = `
            <div class="card" style="width: 100%; box-sizing: border-box;">
                <div style="display:flex; flex-direction: row; gap:10px; margin-bottom:20px; align-items:center; width: 100%;">
                    <div style="flex: 1; position:relative;">
                        <i class="fas fa-search" style="position:absolute; left:15px; top:50%; transform:translateY(-50%); color:var(--text-muted); font-size:1.2rem; z-index: 1;"></i>
                        <input type="text" id="univSearchInput" placeholder="Search questions, options, titles across ALL assessments..." style="width:100%; padding:15px 15px 15px 50px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-input); color:var(--text-main); font-size:1.2rem; box-sizing: border-box;" onkeydown="if(event.key==='Enter') runUniversalSearch()">
                    </div>
                    <button class="btn-primary" onclick="runUniversalSearch()" style="width: 10%; min-width: 120px; height: 56px; font-size: 1.1rem; white-space: nowrap; padding: 0;">Search</button>
                </div>
                <div id="univSearchResults" style="min-height:60vh;">
                    <div style="text-align:center; color:var(--text-muted); padding:20px;">Enter text to search across Vetting, Live, and Standard assessments.</div>
                </div>
            </div>
        `;
        parent.appendChild(div);
    }
}

function runUniversalSearch() {
    const query = document.getElementById('univSearchInput').value.trim().toLowerCase();
    const container = document.getElementById('univSearchResults');
    
    if (!query) return;
    
    container.innerHTML = '<div style="text-align:center; padding:20px;"><i class="fas fa-circle-notch fa-spin"></i> Searching...</div>';
    
    setTimeout(() => {
        const tests = JSON.parse(localStorage.getItem('tests') || '[]');
        const results = [];

        tests.forEach(test => {
            // 1. Check Title
            if (test.title.toLowerCase().includes(query)) {
                results.push({ type: 'Title Match', test: test, match: test.title, qIdx: null });
            }

            // 2. Check Questions
            if (test.questions) {
                test.questions.forEach((q, idx) => {
                    let matchFound = false;
                    let matchText = '';

                    // Check Text
                    if (q.text && q.text.toLowerCase().includes(query)) {
                        matchFound = true; matchText = q.text;
                    }
                    // Check Options
                    else if (q.options && q.options.some(o => o.toLowerCase().includes(query))) {
                        matchFound = true; matchText = `Option match in: "${q.text.substring(0, 50)}..."`;
                    }
                    // Check Admin Notes
                    else if (q.adminNotes && q.adminNotes.toLowerCase().includes(query)) {
                        matchFound = true; matchText = `Note match: ${q.adminNotes}`;
                    }

                    if (matchFound) {
                        results.push({ type: 'Question', test: test, match: matchText, qIdx: idx });
                    }
                });
            }
        });

        if (results.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">No results found.</div>';
        } else {
            container.innerHTML = results.map(r => {
                const icon = r.test.type === 'vetting' ? '<i class="fas fa-shield-alt" style="color:#9b59b6;"></i>' : (r.test.type === 'live' ? '<i class="fas fa-satellite-dish" style="color:var(--primary);"></i>' : '<i class="fas fa-file-alt"></i>');
                const context = r.qIdx !== null ? `Question ${r.qIdx + 1}` : 'Test Settings';
                
                return `
                <div style="background:var(--bg-input); padding:15px; border-radius:6px; margin-bottom:10px; border-left:4px solid var(--primary); display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-weight:bold; font-size:1rem;">${icon} ${r.test.title} <span style="font-weight:normal; color:var(--text-muted); font-size:0.8rem;">(${context})</span></div>
                        <div style="margin-top:5px; color:var(--text-main); font-size:0.9rem;">${r.match}</div>
                    </div>
                    <button class="btn-secondary btn-sm" onclick="editTest('${r.test.id}', ${r.qIdx})"><i class="fas fa-edit"></i> Edit</button>
                </div>`;
            }).join('');
        }
    }, 100);
}

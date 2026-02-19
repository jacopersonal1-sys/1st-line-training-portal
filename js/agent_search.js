/* ================= AGENT SEARCH & OVERVIEW ================= */

function loadAgentSearch() {
    const input = document.getElementById('agentSearchInput');
    const datalist = document.getElementById('agentSearchList');
    
    if(!input || !datalist) return;
    
    // Populate Datalist
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    const graduates = JSON.parse(localStorage.getItem('graduated_agents') || '[]');
    
    const allAgents = new Set();
    
    // Add from Users
    users.forEach(u => { if(u.role === 'trainee') allAgents.add(u.user); });
    
    // Add from Rosters (in case they haven't logged in yet)
    Object.values(rosters).forEach(list => {
        list.forEach(name => allAgents.add(name));
    });
    
    // Add from Graduates (Archived)
    graduates.forEach(g => allAgents.add(g.user));
    
    datalist.innerHTML = '';
    Array.from(allAgents).sort().forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        datalist.appendChild(opt);
    });
    
    // Focus input
    input.focus();
}

function performAgentSearch(name) {
    if(!name) return;
    
    // Check if archived to update loading message
    const graduates = JSON.parse(localStorage.getItem('graduated_agents') || '[]');
    const isArchived = graduates.some(g => g.user.toLowerCase() === name.toLowerCase());
    
    const loadingMsg = isArchived 
        ? '<div class="spinner"></div><div style="margin-top:10px; color:var(--text-muted);">Fetching from Archive...</div>'
        : '<div class="spinner"></div>';

    const container = document.getElementById('agentSearchResults');
    container.innerHTML = `<div style="text-align:center; padding:50px;">${loadingMsg}</div>`;
    container.classList.remove('hidden');
    
    setTimeout(() => {
        renderAgentDashboard(name);
    }, 300);
}

function renderAgentDashboard(agentName) {
    const container = document.getElementById('agentSearchResults');
    
    // 1. Determine Source (Active vs Archived)
    const graduates = JSON.parse(localStorage.getItem('graduated_agents') || '[]');
    const archivedData = graduates.find(g => g.user.toLowerCase() === agentName.toLowerCase());
    const isArchived = !!archivedData;

    let records, submissions, reports, reviews, attRecords, notesMap;

    if (isArchived) {
        records = archivedData.records || [];
        submissions = archivedData.submissions || [];
        reports = archivedData.reports || [];
        reviews = archivedData.reviews || [];
        attRecords = archivedData.attendance || [];
        // Notes in archive are stored as a single string, handled below
    } else {
        records = JSON.parse(localStorage.getItem('records') || '[]');
        submissions = JSON.parse(localStorage.getItem('submissions') || '[]');
        reports = JSON.parse(localStorage.getItem('savedReports') || '[]');
        reviews = JSON.parse(localStorage.getItem('insightReviews') || '[]');
        attRecords = JSON.parse(localStorage.getItem('attendance_records') || '[]');
        notesMap = JSON.parse(localStorage.getItem('agentNotes') || '{}');
    }

    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    // Filter Data (If active, filter from global. If archived, it's already filtered)
    const agentRecords = isArchived ? records : records.filter(r => r.trainee.toLowerCase() === agentName.toLowerCase());
    const agentSubs = isArchived ? submissions : submissions.filter(s => s.trainee.toLowerCase() === agentName.toLowerCase());
    
    // Reports/Reviews: Active uses .find(), Archive has array
    const agentReport = isArchived ? (reports[0] || null) : reports.find(r => r.trainee.toLowerCase() === agentName.toLowerCase());
    const agentReview = isArchived ? (reviews[0] || null) : reviews.find(r => r.trainee.toLowerCase() === agentName.toLowerCase());
    
    // Find Group
    let group = "Unknown Group";
    if (isArchived) {
        // Try to recover group from records, otherwise generic
        if (agentRecords.length > 0) group = agentRecords[0].groupID || "Graduated";
        else group = "Graduated / Archived";
    } else {
        for (const [gid, members] of Object.entries(rosters)) {
            if (members.some(m => m.toLowerCase() === agentName.toLowerCase())) {
                group = gid;
                break;
            }
        }
    }
    
    // 2. Calculate Stats
    let progress = 0;
    if(typeof calculateAgentStats === 'function') {
        const stats = calculateAgentStats(agentName, agentRecords);
        progress = stats.progress;
    }
    
    let statusObj = { status: 'Pass', failedItems: [] };
    if(typeof calculateAgentStatus === 'function') {
        statusObj = calculateAgentStatus(agentRecords);
    }
    
    // 3. Build UI
    
    const headerBadge = isArchived ? '<span class="status-badge status-pass" style="margin-left:10px; font-size:1rem;"><i class="fas fa-graduation-cap"></i> Graduated</span>' : '';

    // --- HEADER ---
    let headerHtml = `
        <div class="card" style="border-left: 5px solid var(--primary);">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <h2 style="margin:0; border:none;">${agentName}</h2>
                    <h2 style="margin:0; border:none;">${agentName} ${headerBadge}</h2>
                    <div style="color:var(--text-muted); margin-top:5px;">${group}</div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:2rem; font-weight:bold; color:${progress===100 ? '#2ecc71' : 'var(--primary)'};">${progress}%</div>
                    <div style="font-size:0.8rem; color:var(--text-muted);">Completion</div>
                </div>
            </div>
            <div class="progress-track" style="margin-top:15px;"><div class="progress-fill" style="width:${progress}%;"></div></div>
        </div>
    `;
    
    // --- REVIEW STATUS ---
    let statusColor = '#2ecc71'; // Green
    if(statusObj.status === 'Critical' || statusObj.status === 'Fail') statusColor = '#ff5252';
    else if(statusObj.status === 'Semi-Critical') statusColor = '#ff9800';
    else if(statusObj.status === 'Improvement') statusColor = '#f1c40f';
    
    let reviewHtml = `
        <div class="card">
            <h3>Review Status</h3>
            <div style="display:flex; gap:20px; align-items:center;">
                <div style="background:${statusColor}20; color:${statusColor}; padding:10px 20px; border-radius:8px; font-weight:bold; border:1px solid ${statusColor};">
                    ${statusObj.status}
                </div>
                <div style="flex:1;">
                    ${agentReview ? `<strong>Manual Review:</strong> ${agentReview.status}<br><span style="font-size:0.9rem; color:var(--text-muted);">${agentReview.comment}</span>` : '<span style="color:var(--text-muted);">No manual review on file.</span>'}
                </div>
            </div>
            ${statusObj.failedItems.length > 0 ? `<div style="margin-top:15px; padding:10px; background:var(--bg-input); border-radius:6px;"><strong>Flagged Items:</strong><ul style="margin:5px 0 0 20px; color:#ff5252;">${statusObj.failedItems.map(i=>`<li>${i}</li>`).join('')}</ul></div>` : ''}
        </div>
    `;
    
    // --- ASSESSMENTS & VETTING ---
    const assessments = agentRecords.filter(r => r.phase === 'Assessment');
    const vetting = agentRecords.filter(r => r.phase.includes('Vetting'));
    
    const buildTable = (items) => {
        if(items.length === 0) return '<div style="padding:15px; text-align:center; color:var(--text-muted);">No records found.</div>';
        return `<table class="admin-table">
            <thead><tr><th>Name</th><th>Score</th><th>Date</th></tr></thead>
            <tbody>
                ${items.map(i => `<tr>
                    <td>${i.assessment}</td>
                    <td><span class="status-badge ${i.score >= 80 ? 'status-pass' : 'status-fail'}">${i.score}%</span></td>
                    <td>${i.date}</td>
                </tr>`).join('')}
            </tbody>
        </table>`;
    };
    
    let recordsHtml = `
        <div class="grid-2">
            <div class="card">
                <h3>Assessments</h3>
                <div style="max-height:300px; overflow-y:auto;">${buildTable(assessments)}</div>
            </div>
            <div class="card">
                <h3>Vetting Tests</h3>
                <div style="max-height:300px; overflow-y:auto;">${buildTable(vetting)}</div>
            </div>
        </div>
    `;
    
    // --- ONBOARD REPORT ---
    let reportHtml = '';
    if(agentReport) {
        // FIX: Handle both new flat structure (behaviorYes) and legacy nested structure (data.repBehavior)
        const behavior = agentReport.behaviorYes ? 'Yes' : (agentReport.data && agentReport.data.repBehavior ? agentReport.data.repBehavior : 'No');
        const observe = agentReport.observeYes ? 'Yes' : (agentReport.data && agentReport.data.repObserve ? agentReport.data.repObserve : 'No');

        reportHtml = `
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <h3>Onboard Report</h3>
                    <button class="btn-secondary btn-sm" onclick="viewSavedReport('${agentReport.id}')"><i class="fas fa-eye"></i> View Full Report</button>
                </div>
                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:15px;">
                    <div style="background:var(--bg-input); padding:10px; border-radius:6px;">
                        <div style="font-size:0.8rem; color:var(--text-muted);">Generated</div>
                        <div>${new Date(agentReport.date).toLocaleDateString()}</div>
                    </div>
                    <div style="background:var(--bg-input); padding:10px; border-radius:6px;">
                        <div style="font-size:0.8rem; color:var(--text-muted);">Behavioral Issues</div>
                        <div>${behavior}</div>
                    </div>
                    <div style="background:var(--bg-input); padding:10px; border-radius:6px;">
                        <div style="font-size:0.8rem; color:var(--text-muted);">Observations</div>
                        <div>${observe}</div>
                    </div>
                </div>
            </div>
        `;
    } else {
        reportHtml = `<div class="card" style="text-align:center; padding:30px; color:var(--text-muted);">No Onboard Report generated yet.</div>`;
    }
    
    // --- ATTENDANCE HISTORY ---
    const agentAtt = isArchived ? attRecords : attRecords.filter(r => r.user.toLowerCase() === agentName.toLowerCase());
    agentAtt.sort((a,b) => new Date(b.date) - new Date(a.date)); // Newest first
    
    const totalDays = agentAtt.length;
    const lateDays = agentAtt.filter(r => r.isLate).length;
    const onTimeDays = totalDays - lateDays;
    
    let attHtml = `
        <div class="card">
            <h3><i class="fas fa-clock" style="color:var(--primary); margin-right:10px;"></i>Attendance History</h3>
            <div style="display:flex; gap:20px; margin-bottom:15px; justify-content:space-around; background:var(--bg-input); padding:15px; border-radius:8px;">
                <div style="text-align:center;">
                    <div style="font-size:1.5rem; font-weight:bold;">${totalDays}</div>
                    <div style="font-size:0.8rem; color:var(--text-muted);">Days Present</div>
                </div>
                <div style="text-align:center;">
                    <div style="font-size:1.5rem; font-weight:bold; color:#2ecc71;">${onTimeDays}</div>
                    <div style="font-size:0.8rem; color:var(--text-muted);">On Time</div>
                </div>
                <div style="text-align:center;">
                    <div style="font-size:1.5rem; font-weight:bold; color:${lateDays > 0 ? '#ff5252' : 'var(--text-main)'};">${lateDays}</div>
                    <div style="font-size:0.8rem; color:var(--text-muted);">Late</div>
                </div>
            </div>
            <div style="max-height:200px; overflow-y:auto;">
                <table class="admin-table">
                    <thead><tr><th>Date</th><th>In</th><th>Out</th><th>Status</th></tr></thead>
                    <tbody>
                        ${agentAtt.length > 0 ? agentAtt.map(r => `
                            <tr><td>${r.date}</td><td>${r.clockIn}</td><td>${r.clockOut||'-'}</td><td>${r.isLate ? '<span style="color:#ff5252;">Late</span>' : '<span style="color:#2ecc71;">On Time</span>'}</td></tr>
                        `).join('') : '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No attendance records found.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    // --- ACTIVITY HISTORY (NEW) ---
    const history = JSON.parse(localStorage.getItem('monitor_history') || '[]');
    const agentHistory = history.filter(h => h.user === agentName).sort((a,b) => new Date(b.date) - new Date(a.date));
    
    let activityHtml = `
        <div class="card">
            <h3><i class="fas fa-chart-line" style="color:var(--primary); margin-right:10px;"></i>Activity History</h3>
            <div style="max-height:250px; overflow-y:auto;">
                <table class="admin-table">
                    <thead><tr><th>Date</th><th>Study</th><th>External</th><th>Idle</th><th>Focus Score</th></tr></thead>
                    <tbody>
                        ${agentHistory.length > 0 ? agentHistory.map(h => {
                            const s = h.summary;
                            const focus = s.total > 0 ? Math.round((s.study / s.total) * 100) : 0;
                            let scoreColor = '#2ecc71';
                            if(focus < 50) scoreColor = '#ff5252'; else if(focus < 80) scoreColor = '#f1c40f';
                            
                            return `<tr>
                                <td>${h.date}</td>
                                <td>${Math.round(s.study/60000)}m</td>
                                <td>${Math.round(s.external/60000)}m</td>
                                <td>${Math.round(s.idle/60000)}m</td>
                                <td style="font-weight:bold; color:${scoreColor};">${focus}%</td>
                            </tr>`;
                        }).join('') : '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No archived activity logs found.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>`;

    // --- PRIVATE NOTES ---
    const agentNote = isArchived ? (archivedData.notes || "") : (notesMap[agentName] || "");
    const safeName = agentName.replace(/'/g, "\\'"); // Escape quotes for onclick

    let notesHtml = '';
    if (isArchived) {
        notesHtml = `
            <div class="card">
                <h3><i class="fas fa-sticky-note" style="color:var(--primary); margin-right:10px;"></i>Private Notes (Archived)</h3>
                <div style="background:var(--bg-input); padding:15px; border-radius:8px; border:1px solid var(--border-color); min-height:100px; white-space:pre-wrap;">${agentNote || 'No notes archived.'}</div>
            </div>`;
    } else {
        notesHtml = `
            <div class="card">
                <h3><i class="fas fa-sticky-note" style="color:var(--primary); margin-right:10px;"></i>Private Notes</h3>
                <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:10px;">These notes are only visible to Admins and Team Leaders.</p>
                <textarea id="agentPrivateNote" style="width:100%; height:100px; padding:10px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-input); color:var(--text-main); font-family:inherit;" placeholder="Enter notes about this agent...">${agentNote}</textarea>
                <div style="text-align:right; margin-top:10px;">
                    <button class="btn-primary btn-sm" onclick="saveAgentNote('${safeName}')">Save Note</button>
                </div>
            </div>`;
    }
    
    container.innerHTML = headerHtml + reviewHtml + `<div id="agent-analytics-profile"></div>` + recordsHtml + reportHtml + attHtml + activityHtml + notesHtml;

    // Inject Individual Analytics (Risk Score & Timeline)
    if (typeof AnalyticsEngine !== 'undefined' && typeof AnalyticsEngine.renderIndividualProfile === 'function') {
        const profileContainer = document.getElementById('agent-analytics-profile');
        if(profileContainer) AnalyticsEngine.renderIndividualProfile(profileContainer, agentName);
    }
}

async function saveAgentNote(username) {
    const note = document.getElementById('agentPrivateNote').value;
    const notes = JSON.parse(localStorage.getItem('agentNotes') || '{}');
    notes[username] = note;
    localStorage.setItem('agentNotes', JSON.stringify(notes));
    
    if(typeof saveToServer === 'function') {
        const btn = document.activeElement;
        if(btn) { btn.innerText = "Saving..."; btn.disabled = true; }
        await saveToServer(['agentNotes'], false);
        if(btn) { btn.innerText = "Save Note"; btn.disabled = false; }
    }
    
    if(typeof showToast === 'function') showToast("Note saved.", "success");
}

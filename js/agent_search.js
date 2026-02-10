/* ================= AGENT SEARCH & OVERVIEW ================= */

function loadAgentSearch() {
    const input = document.getElementById('agentSearchInput');
    const datalist = document.getElementById('agentSearchList');
    
    if(!input || !datalist) return;
    
    // Populate Datalist
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    
    const allAgents = new Set();
    
    // Add from Users
    users.forEach(u => { if(u.role === 'trainee') allAgents.add(u.user); });
    
    // Add from Rosters (in case they haven't logged in yet)
    Object.values(rosters).forEach(list => {
        list.forEach(name => allAgents.add(name));
    });
    
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
    
    const container = document.getElementById('agentSearchResults');
    container.innerHTML = '<div style="text-align:center; padding:50px;"><div class="spinner"></div></div>';
    container.classList.remove('hidden');
    
    setTimeout(() => {
        renderAgentDashboard(name);
    }, 300);
}

function renderAgentDashboard(agentName) {
    const container = document.getElementById('agentSearchResults');
    
    // 1. Fetch Data
    const records = JSON.parse(localStorage.getItem('records') || '[]');
    const submissions = JSON.parse(localStorage.getItem('submissions') || '[]');
    const reports = JSON.parse(localStorage.getItem('savedReports') || '[]');
    const reviews = JSON.parse(localStorage.getItem('insightReviews') || '[]');
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    const attendance = JSON.parse(localStorage.getItem('attendance_records') || '[]');
    
    // Filter Data
    const agentRecords = records.filter(r => r.trainee.toLowerCase() === agentName.toLowerCase());
    const agentSubs = submissions.filter(s => s.trainee.toLowerCase() === agentName.toLowerCase());
    const agentReport = reports.find(r => r.trainee.toLowerCase() === agentName.toLowerCase());
    const agentReview = reviews.find(r => r.trainee.toLowerCase() === agentName.toLowerCase());
    const agentAttendance = attendance.filter(a => a.user.toLowerCase() === agentName.toLowerCase());
    
    // Find Group
    let group = "Unknown Group";
    for (const [gid, members] of Object.entries(rosters)) {
        if (members.some(m => m.toLowerCase() === agentName.toLowerCase())) {
            group = gid;
            break;
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
    
    // --- HEADER ---
    let headerHtml = `
        <div class="card" style="border-left: 5px solid var(--primary);">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <h2 style="margin:0; border:none;">${agentName}</h2>
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
                        <div>${agentReport.data.repBehavior || 'No'}</div>
                    </div>
                    <div style="background:var(--bg-input); padding:10px; border-radius:6px;">
                        <div style="font-size:0.8rem; color:var(--text-muted);">Observations</div>
                        <div>${agentReport.data.repObserve || 'No'}</div>
                    </div>
                </div>
            </div>
        `;
    } else {
        reportHtml = `<div class="card" style="text-align:center; padding:30px; color:var(--text-muted);">No Onboard Report generated yet.</div>`;
    }

    // --- ATTENDANCE HISTORY ---
    agentAttendance.sort((a,b) => new Date(b.date) - new Date(a.date)); // Newest first
    let attHtml = `
        <div class="card">
            <h3>Attendance History</h3>
            <div style="max-height:200px; overflow-y:auto;">
                <table class="admin-table">
                    <thead><tr><th>Date</th><th>In</th><th>Out</th><th>Status</th></tr></thead>
                    <tbody>
                        ${agentAttendance.length > 0 ? agentAttendance.map(a => `
                            <tr>
                                <td>${a.date}</td>
                                <td>${a.clockIn}</td>
                                <td>${a.clockOut || '-'}</td>
                                <td>${a.isLate ? '<span class="status-badge status-fail">Late</span>' : '<span class="status-badge status-pass">On Time</span>'}</td>
                            </tr>`).join('') : '<tr><td colspan="4" class="text-center">No records found.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>`;
    
    // --- PRIVATE NOTES ---
    const notes = JSON.parse(localStorage.getItem('agentNotes') || '{}');
    const agentNote = notes[agentName] || "";
    const safeName = agentName.replace(/'/g, "\\'"); // Escape quotes for onclick

    let notesHtml = `
        <div class="card">
            <h3><i class="fas fa-sticky-note" style="color:var(--primary); margin-right:10px;"></i>Private Notes</h3>
            <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:10px;">These notes are only visible to Admins and Team Leaders.</p>
            <textarea id="agentPrivateNote" style="width:100%; height:100px; padding:10px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-input); color:var(--text-main); font-family:inherit;" placeholder="Enter notes about this agent...">${agentNote}</textarea>
            <div style="text-align:right; margin-top:10px;">
                <button class="btn-primary btn-sm" onclick="saveAgentNote('${safeName}')">Save Note</button>
            </div>
        </div>
    `;
    
    container.innerHTML = headerHtml + reviewHtml + recordsHtml + attHtml + reportHtml + notesHtml;
}

async function saveAgentNote(agentName) {
    const note = document.getElementById('agentPrivateNote').value;
    const notes = JSON.parse(localStorage.getItem('agentNotes') || '{}');
    
    notes[agentName] = note;
    localStorage.setItem('agentNotes', JSON.stringify(notes));
    
    const btn = document.activeElement;
    if(btn) { btn.innerText = "Saving..."; btn.disabled = true; }
    
    if(typeof saveToServer === 'function') await saveToServer(['agentNotes'], false);
    
    if(btn) { btn.innerText = "Save Note"; btn.disabled = false; }
    if(typeof showToast === 'function') showToast("Note saved successfully.", "success");
}

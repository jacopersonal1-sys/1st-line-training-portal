/* ================= AGENT SEARCH & OVERVIEW ================= */

// FIX: Expose functions globally to prevent ReferenceError from inline HTML handlers
window.loadAgentSearch = loadAgentSearch;
window.performAgentSearch = performAgentSearch;
window.saveAgentNote = saveAgentNote;
window.printAgentProfile = printAgentProfile;
window.copyAgentLink = copyAgentLink;

function loadAgentSearch() {
    const input = document.getElementById('agentSearchInput');
    const datalist = document.getElementById('agentSearchList');
    
    if(!input || !datalist) return;

    // FIX: Ensure input is linked to datalist and has event listeners
    input.setAttribute('list', 'agentSearchList');
    
    // Remove old listeners to prevent duplicates (cloning trick)
    const newInput = input.cloneNode(true);
    // FIX: Remove inline handlers to prevent conflicts/errors
    newInput.removeAttribute('onchange');
    newInput.removeAttribute('onkeydown');
    
    input.parentNode.replaceChild(newInput, input);
    
    newInput.addEventListener('change', (e) => performAgentSearch(e.target.value));
    newInput.addEventListener('keydown', (e) => {
        if(e.key === 'Enter') performAgentSearch(e.target.value);
    });
    
    // FIX: Handle the Search Button explicitly if it exists
    const searchBtns = document.querySelectorAll('button[onclick*="performAgentSearch"]');
    searchBtns.forEach(btn => {
        const newBtn = btn.cloneNode(true);
        newBtn.removeAttribute('onclick');
        newBtn.addEventListener('click', () => performAgentSearch(newInput.value));
        btn.parentNode.replaceChild(newBtn, btn);
    });
    
    // Populate Datalist
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    const graduates = JSON.parse(localStorage.getItem('graduated_agents') || '[]');
    
    const allAgents = new Set();
    
    // Add from Users
    users.forEach(u => { if(u.role === 'trainee') allAgents.add(u.user); });
    
    // Add from Rosters (in case they haven't logged in yet)
    Object.values(rosters).forEach(list => {
        if(Array.isArray(list)) list.forEach(name => allAgents.add(name));
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
    newInput.focus();

    // NEW: Check URL for deep link (Auto-load agent)
    const urlParams = new URLSearchParams(window.location.search);
    const agentParam = urlParams.get('agent');
    if (agentParam && input.value !== agentParam) {
        // Validate agent exists in datalist to avoid searching garbage
        const options = Array.from(datalist.options).map(o => o.value);
        const match = options.find(o => o.toLowerCase() === agentParam.toLowerCase());
        if (match) {
            input.value = match;
            performAgentSearch(match);
        }
    }
}

function performAgentSearch(name) {
    if(!name) return;
    
    // NEW: Update URL for sharing without reloading
    const url = new URL(window.location);
    url.searchParams.set('agent', name);
    window.history.replaceState({}, '', url);

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
    let gradDateHtml = "";

    if (isArchived) {
        // Try to recover group from records, otherwise generic
        if (agentRecords.length > 0) group = agentRecords[0].groupID || "Graduated";
        else group = "Graduated / Archived";
        
        if (archivedData.graduatedDate) {
            gradDateHtml = `<div style="color:var(--text-muted); font-size:0.85rem; margin-top:3px;"><i class="fas fa-calendar-check"></i> Graduated: ${new Date(archivedData.graduatedDate).toLocaleDateString()}</div>`;
        }
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

    // --- AVATAR GENERATION ---
    const getInitials = (name) => name ? name.substring(0, 2).toUpperCase() : '??';
    const getColor = (name) => {
        let hash = 0;
        for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
        const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
        return "#" + "00000".substring(0, 6 - c.length) + c;
    };
    const avatarBg = getColor(agentName);
    const avatarHtml = `<div style="width:64px; height:64px; border-radius:50%; background:${avatarBg}; color:#fff; display:flex; align-items:center; justify-content:center; font-size:1.5rem; font-weight:bold; box-shadow:0 4px 10px rgba(0,0,0,0.2); flex-shrink:0;">${getInitials(agentName)}</div>`;
    
    const headerBadge = isArchived ? '<span class="status-badge status-pass" style="margin-left:10px; font-size:0.8rem; vertical-align:middle;"><i class="fas fa-graduation-cap"></i> Graduated</span>' : '';

    // --- ADMIN ACTIONS ---
    let adminActions = '';
    if (typeof CURRENT_USER !== 'undefined' && (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin')) {
        const safeName = agentName.replace(/'/g, "\\'");
        adminActions = `
            <div style="margin-top:15px; display:flex; gap:10px; justify-content:flex-end; border-top:1px dashed var(--border-color); padding-top:10px;">
                <button class="btn-secondary btn-sm" onclick="openUserEdit('${safeName}')" title="Edit User Account"><i class="fas fa-user-cog"></i> Edit Account</button>
                <button class="btn-secondary btn-sm" onclick="printAgentProfile()" title="Print Profile"><i class="fas fa-print"></i> Print</button>
                <button class="btn-secondary btn-sm" onclick="copyAgentLink('${safeName}')" title="Copy Link"><i class="fas fa-link"></i> Link</button>
            </div>
        `;
    }

    // --- DATA PREPARATION (Moved Up) ---
    const assessments = agentRecords.filter(r => r.phase === 'Assessment');
    const vetting = agentRecords.filter(r => r.phase.includes('Vetting'));
    
    const agentAtt = isArchived ? attRecords : attRecords.filter(r => r.user.toLowerCase() === agentName.toLowerCase());
    agentAtt.sort((a,b) => new Date(b.date) - new Date(a.date)); // Newest first

    // --- HEADER ---
    let headerHtml = `
        <div class="card" style="border-left: 5px solid var(--primary); position:relative; overflow:hidden; margin-bottom:20px;">
            <div style="display:flex; align-items:center;">
                ${avatarHtml}
                <div style="margin-left:20px; flex:1;">
                    <div style="display:flex; justify-content:space-between; align-items:start;">
                        <div>
                            <h2 style="margin:0; border:none; line-height:1.2;">${agentName} ${headerBadge}</h2>
                            <div style="color:var(--text-muted); margin-top:5px; font-size:0.9rem;"><i class="fas fa-users"></i> ${group}</div>
                            ${gradDateHtml}
                        </div>
                        <div style="text-align:right; background:var(--bg-input); padding:8px 15px; border-radius:8px;">
                            <div style="font-size:1.8rem; font-weight:800; color:${progress===100 ? '#2ecc71' : 'var(--primary)'}; line-height:1;">${progress}%</div>
                            <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; margin-top:2px;">Completion</div>
                        </div>
                    </div>
                    <div class="progress-track" style="margin-top:15px; height:8px; background:var(--bg-input);"><div class="progress-fill" style="width:${progress}%; background:linear-gradient(90deg, var(--primary), #f39c12);"></div></div>
                    ${adminActions}
                </div>
            </div>
        </div>
    `;
    
    // --- METRICS CALCULATION ---
    const totalScore = assessments.reduce((acc, r) => acc + r.score, 0);
    const avgScore = assessments.length > 0 ? Math.round(totalScore / assessments.length) : 0;
    
    const attTotal = agentAtt.length;
    const attLate = agentAtt.filter(r => r.isLate).length;
    const attPct = attTotal > 0 ? Math.round(((attTotal - attLate) / attTotal) * 100) : 100;

    let riskScore = 0;
    if (typeof AnalyticsEngine !== 'undefined' && typeof AnalyticsEngine.calculateAtRiskScore === 'function') {
        riskScore = AnalyticsEngine.calculateAtRiskScore(agentName);
    }

    // --- REVIEW STATUS ---
    let statusColor = '#2ecc71'; // Green
    if(statusObj.status === 'Critical' || statusObj.status === 'Fail') statusColor = '#ff5252';
    else if(statusObj.status === 'Semi-Critical') statusColor = '#ff9800';
    else if(statusObj.status === 'Improvement') statusColor = '#f1c40f';
    
    // --- KEY METRICS ROW ---
    let metricsHtml = `
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:15px; margin-bottom:20px;">
            <div class="card" style="text-align:center; padding:15px; margin:0;">
                <div style="font-size:0.8rem; color:var(--text-muted); text-transform:uppercase;">Avg Score</div>
                <div style="font-size:1.8rem; font-weight:bold; color:${avgScore>=90?'#2ecc71':(avgScore>=80?'var(--primary)':'#ff5252')}">${avgScore}%</div>
            </div>
            <div class="card" style="text-align:center; padding:15px; margin:0;">
                <div style="font-size:0.8rem; color:var(--text-muted); text-transform:uppercase;">Attendance</div>
                <div style="font-size:1.8rem; font-weight:bold; color:${attPct>=95?'#2ecc71':(attPct>=90?'var(--primary)':'#ff5252')}">${attPct}%</div>
            </div>
            <div class="card" style="text-align:center; padding:15px; margin:0;">
                <div style="font-size:0.8rem; color:var(--text-muted); text-transform:uppercase;">Risk Score</div>
                <div style="font-size:1.8rem; font-weight:bold; color:${riskScore<40?'#2ecc71':(riskScore<70?'#f1c40f':'#ff5252')}">${riskScore}%</div>
            </div>
            <div class="card" style="text-align:center; padding:15px; margin:0; border-bottom:4px solid ${statusColor};">
                <div style="font-size:0.8rem; color:var(--text-muted); text-transform:uppercase;">Status</div>
                <div style="font-size:1.2rem; font-weight:bold; color:${statusColor}; margin-top:5px;">${statusObj.status}</div>
            </div>
        </div>
    `;

    let reviewHtml = `
        <div class="card">
            <h3><i class="fas fa-user-edit" style="color:${statusColor}; margin-right:10px;"></i>Admin Review</h3>
            <div style="display:flex; gap:20px; align-items:center;">
                <div style="flex:1;">
                    ${agentReview ? `<strong>Status:</strong> ${agentReview.status}<br><span style="font-size:0.9rem; color:var(--text-muted); display:block; margin-top:5px; font-style:italic;">"${agentReview.comment}"</span>` : '<span style="color:var(--text-muted); font-style:italic;">No manual review on file.</span>'}
                </div>
            </div>
            ${statusObj.failedItems.length > 0 ? `<div style="margin-top:15px; padding:10px; background:var(--bg-input); border-radius:6px;"><strong>Flagged Items:</strong><ul style="margin:5px 0 0 20px; color:#ff5252;">${statusObj.failedItems.map(i=>`<li>${i}</li>`).join('')}</ul></div>` : ''}
        </div>
    `;
    
    const buildTable = (items) => {
        if(items.length === 0) return '<div style="padding:15px; text-align:center; color:var(--text-muted); font-style:italic;">No records found.</div>';
        return `<table class="admin-table">
            <thead><tr><th>Name</th><th>Score</th><th>Date</th><th>Action</th></tr></thead>
            <tbody>
                ${items.map(i => {
                    let action = '-';
                    if (i.link === 'Digital-Assessment' || i.link === 'Live-Session') {
                        // Use submissionId if available, else fallback to trainee+assessment lookup
                        const clickAction = i.submissionId ? `viewCompletedTest('${i.submissionId}', null, 'view')` : `viewCompletedTest('${i.trainee.replace(/'/g, "\\'")}', '${i.assessment.replace(/'/g, "\\'")}', 'view')`;
                        action = `<button class="btn-secondary btn-sm" onclick="${clickAction}" title="View Submission"><i class="fas fa-eye"></i></button>`;
                    } else if (i.link && i.link.startsWith('http')) {
                        action = `<a href="${i.link}" target="_blank" class="btn-secondary btn-sm" style="text-decoration:none;"><i class="fas fa-external-link-alt"></i></a>`;
                    }
                    return `<tr>
                    <td>${i.assessment}</td>
                    <td><span class="status-badge ${i.score >= 80 ? 'status-pass' : 'status-fail'}">${i.score}%</span></td>
                    <td>${i.date}</td>
                    <td>${action}</td>
                </tr>`; }).join('')}
            </tbody>
        </table>`;
    };
    
    let recordsHtml = `
        <div class="card">
            <h3><i class="fas fa-clipboard-list" style="color:var(--text-main); margin-right:10px;"></i>Academic Records</h3>
            <div style="margin-bottom:15px;">
                <strong style="color:var(--primary);">Standard Assessments</strong>
                <div style="max-height:200px; overflow-y:auto; margin-top:5px;">${buildTable(assessments)}</div>
            </div>
            <div>
                <strong style="color:#9b59b6;">Vetting Tests</strong>
                <div style="max-height:200px; overflow-y:auto; margin-top:5px;">${buildTable(vetting)}</div>
            </div>
        </div>
    `;
    
    // --- ONBOARD REPORT ---
    let reportHtml = '';
    if(agentReport) {
        // FIX: Handle both new flat structure (behaviorYes) and legacy nested structure (data.repBehavior)
        const behavior = agentReport.behaviorYes ? 'Yes' : (agentReport.data && agentReport.data.repBehavior ? agentReport.data.repBehavior : 'No');
        const observe = agentReport.observeYes ? 'Yes' : (agentReport.data && agentReport.data.repObserve ? agentReport.data.repObserve : 'No');
        
        const behaviorIcon = behavior === 'Yes' ? '<i class="fas fa-exclamation-circle" style="color:#ff5252;"></i> Yes' : '<i class="fas fa-check" style="color:#2ecc71;"></i> No';
        const observeIcon = observe === 'Yes' ? '<i class="fas fa-exclamation-circle" style="color:#ff5252;"></i> Yes' : '<i class="fas fa-check" style="color:#2ecc71;"></i> No';

        reportHtml = `
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <h3><i class="fas fa-file-contract" style="color:#3498db; margin-right:10px;"></i>Report Card</h3>
                    <button class="btn-secondary btn-sm" onclick="viewSavedReport('${agentReport.id}')"><i class="fas fa-eye"></i> View Full Report</button>
                </div>
                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:15px;">
                    <div style="background:var(--bg-input); padding:10px; border-radius:6px;">
                        <div style="font-size:0.8rem; color:var(--text-muted);">Generated</div>
                        <div style="font-weight:bold;">${new Date(agentReport.date).toLocaleDateString()}</div>
                    </div>
                    <div style="background:var(--bg-input); padding:10px; border-radius:6px;">
                        <div style="font-size:0.8rem; color:var(--text-muted);">Behavioral Issues</div>
                        <div style="font-weight:bold;">${behaviorIcon}</div>
                    </div>
                    <div style="background:var(--bg-input); padding:10px; border-radius:6px;">
                        <div style="font-size:0.8rem; color:var(--text-muted);">Observations</div>
                        <div style="font-weight:bold;">${observeIcon}</div>
                    </div>
                </div>
            </div>
        `;
    } else {
        reportHtml = `<div class="card" style="text-align:center; padding:30px; color:var(--text-muted);">No Onboard Report generated yet.</div>`;
    }
    
    // --- ATTENDANCE HISTORY ---
    const totalDays = agentAtt.length;
    const lateDays = agentAtt.filter(r => r.isLate).length;
    const onTimeDays = totalDays - lateDays;
    
    let attHtml = `
        <div class="card">
            <h3><i class="fas fa-clock" style="color:var(--primary); margin-right:10px;"></i>Attendance</h3>
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
            <h3><i class="fas fa-chart-line" style="color:var(--primary); margin-right:10px;"></i>Activity Log</h3>
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
                                <td style="width:140px;">
                                    <div style="display:flex; align-items:center; gap:10px;">
                                        <div style="flex:1; height:6px; background:var(--bg-input); border-radius:3px; overflow:hidden;">
                                            <div style="width:${focus}%; height:100%; background:${scoreColor};"></div>
                                        </div>
                                        <span style="font-weight:bold; color:${scoreColor}; font-size:0.8rem;">${focus}%</span>
                                    </div>
                                </td>
                            </tr>`;
                        }).join('') : '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No archived activity logs found.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>`;

    // --- PRIVATE NOTES ---
    let rawNotes = isArchived ? (archivedData.notes || []) : (notesMap[agentName] || []);
    
    // Normalize to array (Handle legacy string data)
    if (typeof rawNotes === 'string') {
        rawNotes = [{ 
            id: 'legacy', 
            content: rawNotes, 
            date: new Date().toISOString(), 
            author: 'Legacy' 
        }];
    } else if (!Array.isArray(rawNotes)) {
        rawNotes = [];
    }
    
    // Sort by date desc
    rawNotes.sort((a,b) => new Date(b.date) - new Date(a.date));

    const safeName = agentName.replace(/'/g, "\\'"); 

    let notesListHtml = rawNotes.length > 0 ? rawNotes.map(n => `
        <div style="background:var(--bg-input); padding:10px; border-radius:6px; margin-bottom:10px; border-left:3px solid var(--primary);">
            <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:var(--text-muted); margin-bottom:5px;">
                <span>${n.author || 'Unknown'}</span>
                <span>${new Date(n.date).toLocaleString()}</span>
            </div>
            <div style="white-space:pre-wrap; font-size:0.9rem;">${n.content}</div>
        </div>
    `).join('') : '<div style="color:var(--text-muted); font-style:italic; text-align:center; padding:10px;">No notes recorded.</div>';

    let notesHtml = '';
    if (isArchived) {
        notesHtml = `
            <div class="card">
                <h3><i class="fas fa-sticky-note" style="color:var(--primary); margin-right:10px;"></i>Private Notes (Archived)</h3>
                <div style="max-height:300px; overflow-y:auto;">${notesListHtml}</div>
            </div>`;
    } else {
        notesHtml = `
            <div class="card">
                <h3><i class="fas fa-sticky-note" style="color:var(--primary); margin-right:10px;"></i>Private Notes</h3>
                <div style="max-height:300px; overflow-y:auto; margin-bottom:15px;">${notesListHtml}</div>
                
                <div style="border-top:1px solid var(--border-color); padding-top:15px;">
                    <textarea id="agentPrivateNote" style="width:100%; height:80px; padding:10px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-input); color:var(--text-main); font-family:inherit;" placeholder="Add a new note..."></textarea>
                    <div style="text-align:right; margin-top:10px;">
                        <button class="btn-primary btn-sm" onclick="saveAgentNote('${safeName}')">Add Note</button>
                    </div>
                </div>
            </div>`;
    }
    
    // --- FINAL LAYOUT ASSEMBLY ---
    container.innerHTML = `
        ${headerHtml}
        ${metricsHtml}
        <div class="grid-2" style="align-items:start;">
            <div style="display:flex; flex-direction:column; gap:20px;">${recordsHtml}${notesHtml}</div>
            <div style="display:flex; flex-direction:column; gap:20px;">${reviewHtml}${reportHtml}${attHtml}${activityHtml}</div>
        </div>
        <div id="agent-analytics-profile"></div>
    `;

    // Inject Individual Analytics (Risk Score & Timeline)
    if (typeof AnalyticsEngine !== 'undefined' && typeof AnalyticsEngine.renderIndividualProfile === 'function') {
        const profileContainer = document.getElementById('agent-analytics-profile');
        if(profileContainer) AnalyticsEngine.renderIndividualProfile(profileContainer, agentName);
    }
}

async function saveAgentNote(username) {
    const input = document.getElementById('agentPrivateNote');
    const content = input.value.trim();
    if (!content) return;

    const notesMap = JSON.parse(localStorage.getItem('agentNotes') || '{}');
    let userNotes = notesMap[username];

    // Normalize legacy
    if (typeof userNotes === 'string') {
        userNotes = [{ 
            id: 'legacy_' + Date.now(), 
            content: userNotes, 
            date: new Date().toISOString(), 
            author: 'Legacy' 
        }];
    } else if (!Array.isArray(userNotes)) {
        userNotes = [];
    }

    const newNote = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        content: content,
        author: (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) ? CURRENT_USER.user : 'Admin',
        date: new Date().toISOString()
    };

    userNotes.unshift(newNote); // Add to top
    notesMap[username] = userNotes;
    
    localStorage.setItem('agentNotes', JSON.stringify(notesMap));
    
    if(typeof saveToServer === 'function') {
        const btn = document.activeElement;
        if(btn) { btn.innerText = "Saving..."; btn.disabled = true; }
        await saveToServer(['agentNotes'], false);
        if(btn) { btn.innerText = "Add Note"; btn.disabled = false; }
    }
    
    if(typeof showToast === 'function') showToast("Note added.", "success");
    
    // Refresh view to show new note
    renderAgentDashboard(username);
}

// --- HELPERS ---
function printAgentProfile() {
    // Uses global print style from main.js
    document.body.classList.add('printing-modal');
    window.print();
    document.body.classList.remove('printing-modal');
}

function copyAgentLink(name) {
    const url = new URL(window.location);
    url.searchParams.set('agent', name);
    navigator.clipboard.writeText(url.toString()).then(() => {
        if(typeof showToast === 'function') showToast("Profile link copied.", "success");
    });
}

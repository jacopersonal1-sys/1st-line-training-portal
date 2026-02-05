/* ================= REPORTING ================= */

// --- HELPER: INSTANT SAVE ---
// Ensures reports are physically written to disk (Supabase) before confirming success.
async function secureReportSave() {
    // MODIFIED: Removed 'autoBackup' check.
    // Saving a report is an explicit user action and must always sync to the cloud
    // to prevent work loss.
    // UPDATED: Uses force=true to ensure the report is saved immediately (Overwrite).
    if (typeof saveToServer === 'function') {
        try {
            // PARAMETER 'true' = FORCE OVERWRITE (Instant)
            await saveToServer(true);
        } catch(e) {
            console.error("Report Cloud Sync Error:", e);
        }
    }
}

function loadAllDataViews() { 
    populateMonthlyFilters(); 
    renderMonthly(); 
}

function populateMonthlyFilters() {
    const recs = JSON.parse(localStorage.getItem('records') || '[]');
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}'); 
    const groupSel = document.getElementById('filterMonth');
    const assessSel = document.getElementById('filterAssessment');
    
    if(!groupSel || !assessSel) return;

    // --- FOCUS PROTECTION ---
    // If the user is currently interacting with these dropdowns, 
    // do not refresh them, or the menu will close unexpectedly.
    if (document.activeElement && (document.activeElement === groupSel || document.activeElement === assessSel)) {
        return;
    }

    const currentGroup = groupSel.value;
    const currentAssess = assessSel.value;

    // FIX: Filter out null/undefined/empty strings to prevent blank options
    const uniqueGroups = [...new Set(recs.map(r => r.groupID))].filter(g => g && g.trim() !== "").sort().reverse();
    const uniqueAssess = [...new Set(recs.map(r => r.assessment))].filter(a => a && a.trim() !== "").sort();
    
    groupSel.innerHTML = '<option value="">-- None --</option>';
    uniqueGroups.forEach(g => { 
        const count = rosters[g] ? rosters[g].length : 0;
        const label = (typeof getGroupLabel === 'function') ? getGroupLabel(g, count) : g; 
        groupSel.add(new Option(label, g)); 
    });
    
    assessSel.innerHTML = '<option value="">-- None --</option>';
    uniqueAssess.forEach(a => { 
        assessSel.add(new Option(a, a)); 
    });
    
    if(uniqueGroups.includes(currentGroup)) groupSel.value = currentGroup;
    if(uniqueAssess.includes(currentAssess)) assessSel.value = currentAssess;
}

function renderMonthly() {
  const recs = JSON.parse(localStorage.getItem('records')||'[]');
  const fMonth = document.getElementById('filterMonth').value;
  const fAssess = document.getElementById('filterAssessment').value;
  const fPhase = document.getElementById('filterPhase').value;
  const fTrainee = document.getElementById('filterTrainee').value.toLowerCase();
  
  // Filter records to only show 'Assessment' phase, not vetting tests.
  const filteredRecs = recs.filter(r => {
      // Keep records where phase is 'Assessment' or if phase is not defined (legacy/default)
      const phase = r.phase || 'assessment';
      return phase.toLowerCase() === 'assessment';
  });

  const tbody = document.querySelector('#monthlyTableMain tbody');
  const theadRow = document.querySelector('#monthlyTableMain thead tr');

  // FOCUS PROTECTION for the Trainee Search Input in the Monthly View
  // We allow updates while typing to filter results, but ensure we don't clear the input.
  
  if (CURRENT_USER.role === 'admin') {
      // Fix Alignment: Add Checkbox Header
      if (!theadRow.querySelector('.check-col')) {
          const th = document.createElement('th');
          th.className = 'check-col';
          th.innerHTML = '<input type="checkbox" id="selectAllDel" onclick="toggleSelectAll(this)">';
          theadRow.insertBefore(th, theadRow.firstChild);
      }
      
      if (!theadRow.querySelector('.action-col')) {
          const th = document.createElement('th');
          th.className = 'action-col';
          th.innerText = 'Action';
          theadRow.appendChild(th);
      }
  } else {
      const th = theadRow.querySelector('.action-col');
      if(th) th.remove();
      const thCheck = theadRow.querySelector('.check-col');
      if(thCheck) thCheck.remove();
  }
  
  if (CURRENT_USER.role !== 'trainee') {
      if (fMonth === "" && fAssess === "" && fPhase === "" && fTrainee === "") {
          tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="color:var(--text-muted);">Please select a filter to view records.</td></tr>';
          return;
      }
  }
    
  let html = '';
  filteredRecs.forEach((r, originalIndex) => {
    // SAFETY CHECK: Skip corrupted records without trainee names
    if (!r.trainee) return;

    if(CURRENT_USER.role === 'trainee' && r.trainee.toLowerCase() !== CURRENT_USER.user.toLowerCase()) return;
    if(fMonth !== '' && r.groupID !== fMonth) return;
    if(fAssess !== '' && r.assessment !== fAssess) return;
    if(fPhase !== '' && r.phase !== fPhase) return;
    if(fTrainee !== '' && !r.trainee.toLowerCase().includes(fTrainee)) return;
    
    let s = 'fail'; let t = 'Fail';
    const PASS_SCORE = (typeof PASS !== 'undefined') ? PASS : 90;
    const IMPROVE_SCORE = (typeof IMPROVE !== 'undefined') ? IMPROVE : 60;

    if(r.score >= PASS_SCORE) { s = 'pass'; t = 'Pass'; }
    else if(r.score >= IMPROVE_SCORE) { s = 'improve'; t = 'Improve'; }
    
    let checkHtml = (CURRENT_USER.role === 'admin') 
      ? `<td class="admin-only" style="text-align:center;"><input type="checkbox" class="del-check" value="${originalIndex}" aria-label="Select Record for Deletion"></td>` 
      : '';
    
    let actionHtml = '';
    if(CURRENT_USER.role === 'admin') {
        if(r.link === 'Digital-Assessment') {
             // Check if function exists to avoid reference errors
             const clickAction = (typeof window.viewCompletedTest === 'function' || typeof viewCompletedTest === 'function') 
                ? `onclick="viewCompletedTest('${r.trainee}', '${r.assessment}')"` 
                : `onclick="alert('Assessment viewer not loaded.')"`;
             
             actionHtml = `<td><button class="btn-secondary" style="padding:2px 8px; font-size:0.8rem;" ${clickAction} aria-label="View Digital Assessment"><i class="fas fa-eye"></i> View</button></td>`;
        } else {
             actionHtml = `<td><span style="color:#ccc; font-size:0.8rem;">-</span></td>`;
        }
    }
      
    // FIX: Clean Group Display (Month Year only)
    let groupDisplay = r.groupID;
    if (r.groupID && r.groupID.includes('-')) {
        const parts = r.groupID.split('-');
        if (parts.length >= 2) {
            const y = parseInt(parts[0]);
            const m = parseInt(parts[1]);
            if (!isNaN(y) && !isNaN(m)) {
                const date = new Date(y, m - 1);
                groupDisplay = date.toLocaleString('default', { month: 'long', year: 'numeric' });
                if (parts.length > 2) groupDisplay += ` (Group ${parts[2]})`;
            }
        }
    }

    html += `<tr>${checkHtml}<td>${groupDisplay}</td><td><span style="font-weight:600; color:var(--primary);">${r.trainee}</span></td><td>${r.assessment}</td><td>${r.phase}</td><td>${r.score}%</td><td class="status-badge status-${s}">${t}</td>${actionHtml}</tr>`;
  });
  
  if (html === '') tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="color:var(--text-muted);">No records found matching filters.</td></tr>';
  else tbody.innerHTML = html;

  if(CURRENT_USER.role === 'admin') document.querySelectorAll('.admin-only').forEach(e => e.classList.remove('hidden')); 
  else document.querySelectorAll('.admin-only').forEach(e => e.classList.add('hidden'));
}

function loadReportTab() {
  let users = JSON.parse(localStorage.getItem('users') || '[]');
  const select = document.getElementById('reportTraineeSelect');
  if(select) {
      select.innerHTML = '<option value="">-- Select Trainee --</option>';
      users.filter(u => u.role === 'trainee').sort((a,b) => a.user.localeCompare(b.user)).forEach(u => { select.add(new Option(u.user, u.user)); });
  }
  const dateEl = document.getElementById('printDate');
  if(dateEl) dateEl.innerText = new Date().toLocaleDateString();
}

function showReportSub(type, btn) {
    document.getElementById('report-view-create').classList.add('hidden');
    document.getElementById('report-view-saved').classList.add('hidden');
    document.querySelectorAll('.sched-tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('report-view-' + type).classList.remove('hidden');
    if(btn) btn.classList.add('active');
    if(type === 'saved') renderSavedReportsList();
}

function toggleReportDetails(section, isYes) {
    const el = document.getElementById(section + 'Details');
    if (el) {
        if (isYes) el.classList.remove('hidden-print-field'); else el.classList.add('hidden-print-field');
    }
}

/**
 * UPDATED: generateReport now aggregates both manual 'records' and digital 'submissions'
 */
function generateReport() {
  const name = document.getElementById('reportTraineeSelect').value;
  if(!name) return;
  document.getElementById('repName').innerText = name;
  
  const users = JSON.parse(localStorage.getItem('users') || '[]');
  const trainee = users.find(u => u.user === name);
  if(trainee && trainee.traineeData) {
      document.getElementById('repContact').innerText = trainee.traineeData.contact || "";
      document.getElementById('repKnowledge').innerText = trainee.traineeData.knowledge || "";
  } else {
      document.getElementById('repContact').innerText = "Not filled";
      document.getElementById('repKnowledge').innerText = "Not filled";
  }

  const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
  let group = "Unknown";
  for (const [gid, members] of Object.entries(rosters)) {
      if (members.map(m=>m.toLowerCase()).includes(name.toLowerCase())) {
          const parts = gid.split('-');
          if(parts.length >= 2) {
              const y = parseInt(parts[0]); const m = parseInt(parts[1]);
              const startDate = new Date(y, m-1); const endDate = new Date(y, m);
              group = `${startDate.toLocaleString('default', { month: 'long', year: 'numeric' })} to ${endDate.toLocaleString('default', { month: 'long', year: 'numeric' })}`;
          } else { group = gid; }
          break;
      }
  }
  document.getElementById('repPeriod').innerText = group;
  
  // DATA AGGREGATION: Manual Records + Approved Digital Submissions
  const allRecs = JSON.parse(localStorage.getItem('records') || '[]');
  const submissions = JSON.parse(localStorage.getItem('submissions') || '[]');
  
  // Filter for this trainee (Safe check for nulls)
  const myRecs = allRecs.filter(r => r.trainee && r.trainee.toLowerCase() === name.toLowerCase());
  const mySubs = submissions.filter(s => s.trainee && s.trainee.toLowerCase() === name.toLowerCase() && s.status === 'completed');

  const assessList = JSON.parse(localStorage.getItem('assessments') || '[]');
  const standardAssessments = assessList.filter(a => !a.name.includes('Vetting Test'));
  
  let goalHtml = ''; let scoreHtml = '';
  standardAssessments.forEach(a => {
      // Find matching score from either source
      const rec = myRecs.find(r => r.assessment === a.name);
      const sub = mySubs.find(s => s.testTitle === a.name);
      const score = Math.max(rec ? rec.score : -1, sub ? sub.score : -1);

      let g1='', g2='', g3='', s1='', s2='', s3='';
      if(score !== -1) {
          if(score >= 90) { g1 = '&#8226;'; s3 = '&#8226;'; }
          else if(score >= 60) { g2 = '&#8226;'; s2 = '&#8226;'; }
          else { g3 = '&#8226;'; s1 = '&#8226;'; }
      }
      goalHtml += `<tr><td>${a.name}</td><td class="center report-check">${g1}</td><td class="center report-check">${g2}</td><td class="center report-check">${g3}</td></tr>`;
      scoreHtml += `<tr><td>${a.name}</td><td class="center report-check">${s1}</td><td class="center report-check">${s2}</td><td class="center report-check">${s3}</td></tr>`;
  });
  
  document.getElementById('repGoalBody').innerHTML = goalHtml;
  document.getElementById('repScoreBody').innerHTML = scoreHtml;
  
  // Vetting Tables
  renderVettingTable('1st Vetting', [...myRecs, ...mySubs.map(s=>({assessment:s.testTitle, score:s.score}))], 'repVetting1Body');
  renderVettingTable(['Final Vetting', '2nd Vetting'], [...myRecs, ...mySubs.map(s=>({assessment:s.testTitle, score:s.score}))], 'repVetting2Body');

  // PRE-FILL ADMIN DECISIONS (If any)
  const decisions = JSON.parse(localStorage.getItem('adminDecisions') || '{}');
  if(decisions[name]) {
      document.getElementById('repFeedback').innerText = decisions[name].comment || "";
      document.getElementById('repDeploy').innerText = decisions[name].status || "";
  }
}

function renderVettingTable(searchKeys, records, tableId) {
    const keys = Array.isArray(searchKeys) ? searchKeys : [searchKeys];
    const vettingRecs = records.filter(r => r.assessment && keys.some(k => r.assessment.includes(k)));
    let html = '';
    const topics = JSON.parse(localStorage.getItem('vettingTopics') || '[]');
    topics.forEach(topic => {
        const rec = vettingRecs.find(r => r.assessment.includes(topic));
        const score = rec ? rec.score : null;
        let v1='', v2='', v3='', v4='';
        if(score !== null) {
            if(score === 100) v4 = '&#8226;'; else if(score >= 80) v3 = '&#8226;'; else if(score >= 60) v2 = '&#8226;'; else v1 = '&#8226;';
        }
        html += `<tr><td>${topic}</td><td class="center report-check">${v1}</td><td class="center report-check">${v2}</td><td class="center report-check">${v3}</td><td class="center report-check">${v4}</td></tr>`;
    });
    const target = document.getElementById(tableId);
    if(target) target.innerHTML = html;
}

// UPDATED: Async Save (Instant Mode)
async function saveGeneratedReport() {
    const name = document.getElementById('repName').innerText;
    if(!name) return alert("Generate a report first.");
    const reportData = {
        id: Date.now(),
        date: new Date().toLocaleDateString(),
        trainee: name,
        savedBy: CURRENT_USER.user,
        html: document.getElementById('reportContainer').innerHTML,
        behaviorYes: document.querySelector('input[name="repBehavior"][value="Yes"]').checked,
        observeYes: document.querySelector('input[name="repObserve"][value="Yes"]').checked,
        probText: document.getElementById('repProbText').innerHTML,
        probLink: document.getElementById('repProbLink').innerHTML,
        obsText: document.getElementById('repObsText').innerHTML,
        obsLink: document.getElementById('repObsLink').innerHTML,
        feedback: document.getElementById('repFeedback').innerHTML,
        deploy: document.getElementById('repDeploy').innerHTML,
        checks: [document.getElementById('repPass1').checked, document.getElementById('repPass2').checked, document.getElementById('repPass3').checked]
    };
    const saved = JSON.parse(localStorage.getItem('savedReports') || '[]');
    saved.push(reportData);
    localStorage.setItem('savedReports', JSON.stringify(saved));
    
    // --- SECURE SAVE START ---
    const btn = document.activeElement; 
    let originalText = "";
    if(btn && btn.tagName === 'BUTTON') {
        originalText = btn.innerText;
        btn.innerText = "Saving Report...";
        btn.disabled = true;
    }

    await secureReportSave();

    if(btn && btn.tagName === 'BUTTON') {
        btn.innerText = originalText;
        btn.disabled = false;
    }
    // --- SECURE SAVE END ---

    alert("Report saved successfully.");
}

function renderSavedReportsList() {
    // --- FOCUS PROTECTION ---
    // Prevent list refresh if user is searching for a report
    if (document.activeElement && document.activeElement.id === 'savedReportSearch') {
        return;
    }

    const saved = JSON.parse(localStorage.getItem('savedReports') || '[]');
    const search = document.getElementById('savedReportSearch').value.toLowerCase();
    const tbody = document.getElementById('savedReportsList');
    if(!tbody) return;
    tbody.innerHTML = '';
    saved.filter(r => r.trainee.toLowerCase().includes(search)).reverse().forEach(r => {
        tbody.innerHTML += `<tr><td>${r.date}</td><td>${r.trainee}</td><td>${r.savedBy}</td><td><button class="btn-primary" onclick="viewSavedReport(${r.id})" aria-label="View Saved Report for ${r.trainee}">View</button></td></tr>`;
    });
}

function viewSavedReport(id) {
    const saved = JSON.parse(localStorage.getItem('savedReports') || '[]');
    const report = saved.find(r => r.id === id);
    if(!report) return;
    const container = document.getElementById('savedReportContent');
    container.innerHTML = report.html;
    if(report.behaviorYes) {
        container.querySelector('input[name="repBehavior"][value="Yes"]').checked = true;
        container.querySelector('#behaviorDetails').classList.remove('hidden-print-field');
        container.querySelector('#repProbText').innerHTML = report.probText;
        container.querySelector('#repProbLink').innerHTML = report.probLink;
    }
    if(report.observeYes) {
        container.querySelector('input[name="repObserve"][value="Yes"]').checked = true;
        container.querySelector('#observeDetails').classList.remove('hidden-print-field');
        container.querySelector('#repObsText').innerHTML = report.obsText;
        container.querySelector('#repObsLink').innerHTML = report.obsLink;
    }
    container.querySelector('#repFeedback').innerHTML = report.feedback;
    container.querySelector('#repDeploy').innerHTML = report.deploy;
    if(report.checks) {
        if(report.checks[0]) container.querySelector('#repPass1').checked = true;
        if(report.checks[1]) container.querySelector('#repPass2').checked = true;
        if(report.checks[2]) container.querySelector('#repPass3').checked = true;
    }
    document.getElementById('savedReportModal').classList.remove('hidden');
}
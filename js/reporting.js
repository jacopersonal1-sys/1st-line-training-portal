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

// --- HELPER: ASYNC REQUEST SAVE ---
async function secureRequestSave() {
    if (typeof saveToServer === 'function') {
        try {
            // Save requests and records (if admin fulfilled one)
            await saveToServer(['linkRequests', 'records'], false);
        } catch(e) {
            console.error("Request Sync Error:", e);
        }
    }
}

function loadAllDataViews() { 
    populateMonthlyFilters(); 
    // Force sync to ensure trainee sees latest scores immediately
    if (typeof loadFromServer === 'function') {
        // Silent load to update local cache without blocking UI
        loadFromServer(true).then(() => renderMonthly());
    }
    renderMonthly(); 
}

function populateMonthlyFilters() {
    const recs = JSON.parse(localStorage.getItem('records') || '[]');
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}'); 
    const groupSel = document.getElementById('filterMonth');
    const assessSel = document.getElementById('filterAssessment');
    const phaseSel = document.getElementById('filterPhase');
    
    if(!groupSel || !assessSel || !phaseSel) return;

    // --- FOCUS PROTECTION ---
    // If the user is currently interacting with these dropdowns, 
    // do not refresh them, or the menu will close unexpectedly.
    if (document.activeElement && (document.activeElement === groupSel || document.activeElement === assessSel || document.activeElement === phaseSel)) {
        return;
    }

    const currentGroup = groupSel.value;
    const currentAssess = assessSel.value;
    const currentPhase = phaseSel.value;

    // FIX: Filter out null/undefined/empty strings to prevent blank options
    const uniqueGroups = [...new Set(recs.map(r => r.groupID))].filter(g => g && g.trim() !== "").sort().reverse();
    const uniqueAssess = [...new Set(recs.map(r => r.assessment))].filter(a => a && a.trim() !== "").sort();
    const uniquePhases = [...new Set(recs.map(r => r.phase))].filter(p => p && p.trim() !== "").sort();
    
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

    phaseSel.innerHTML = '<option value="">-- None --</option>';
    uniquePhases.forEach(p => {
        phaseSel.add(new Option(p, p));
    });
    
    if(uniqueGroups.includes(currentGroup)) groupSel.value = currentGroup;
    if(uniqueAssess.includes(currentAssess)) assessSel.value = currentAssess;
    if(uniquePhases.includes(currentPhase)) phaseSel.value = currentPhase;
}

function renderMonthly() {
  const recs = JSON.parse(localStorage.getItem('records')||'[]');
  const requests = JSON.parse(localStorage.getItem('linkRequests')||'[]');
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
  
  if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'teamleader' || CURRENT_USER.role === 'special_viewer') {
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
          tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="color:var(--text-muted);">Please select a filter to view records.</td></tr>';
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
    
    // --- ACTION COLUMN LOGIC ---
    let actionHtml = '';
    if(CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'teamleader' || CURRENT_USER.role === 'special_viewer') {
        actionHtml = '<td class="action-cell">';
        
        if(r.link === 'Digital-Assessment' || r.link === 'Live-Session') {
             // Check if function exists to avoid reference errors
             const safeTrainee = r.trainee.replace(/'/g, "\\'");
             const safeAssess = r.assessment.replace(/'/g, "\\'");

             const clickAction = (typeof window.viewCompletedTest === 'function' || typeof viewCompletedTest === 'function') 
                ? `onclick="viewCompletedTest('${safeTrainee}', '${safeAssess}')"` 
                : `onclick="alert('Assessment viewer not loaded.')"`;
             
             actionHtml += `<button class="btn-secondary" style="padding:2px 8px; font-size:0.8rem;" ${clickAction} aria-label="View Digital Assessment"><i class="fas fa-eye"></i> View</button>`;
        } 
        else {
            // SMART LINK BUTTON
            const safeLink = (r.link || "").replace(/'/g, "\\'");
            const safeTrainee = r.trainee.replace(/'/g, "\\'");
            const safeAssess = r.assessment.replace(/'/g, "\\'");
            
            let btnClass = r.link && r.link.startsWith('http') ? 'btn-secondary' : 'btn-warning';
            let btnIcon = r.link && r.link.startsWith('http') ? 'fa-external-link-alt' : 'fa-link';
            let btnText = r.link && r.link.startsWith('http') ? 'Open' : 'Link';
            
            // If Admin, show "Add Link" style if missing
            if (CURRENT_USER.role === 'admin' && !r.link) { btnClass = 'btn-primary'; btnIcon = 'fa-plus'; btnText = 'Add Link'; }

            actionHtml += `<button class="${btnClass} btn-sm" onclick="handleRecordLinkClick('${r.id}', '${safeLink}', '${safeTrainee}', '${safeAssess}')"><i class="fas ${btnIcon}"></i> ${btnText}</button>`;
            
            // Admin Edit Button (Only if link exists)
            if (CURRENT_USER.role === 'admin' && r.link) {
                actionHtml += ` <button class="btn-secondary btn-sm" onclick="updateRecordLink(${originalIndex})" title="Edit Link"><i class="fas fa-pen"></i></button>`;
            }
        }
        actionHtml += '</td>';
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

    html += `<tr>${checkHtml}<td>${r.date || '-'}</td><td>${groupDisplay}</td><td><span style="font-weight:600; color:var(--primary);">${r.trainee}</span></td><td>${r.assessment}</td><td>${r.phase}</td><td>${r.score}%</td><td class="status-badge status-${s}">${t}</td>${actionHtml}</tr>`;
  });
  
  if (html === '') tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="color:var(--text-muted);">No records found matching filters.</td></tr>';
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
  
  // --- 1. RESET FORM FIELDS (Fixes persistence issue) ---
  document.querySelectorAll('input[name="repBehavior"]').forEach(el => el.checked = false);
  document.querySelectorAll('input[name="repObserve"]').forEach(el => el.checked = false);
  if(typeof toggleReportDetails === 'function') {
      toggleReportDetails('behavior', false);
      toggleReportDetails('observe', false);
  }
  ['repProbText', 'repProbLink', 'repObsText', 'repObsLink'].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.innerHTML = '';
  });
  ['repPass1', 'repPass2', 'repPass3'].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.checked = false;
  });

  // --- 2. LOADING STATE ---
  document.getElementById('repName').innerHTML = '<span style="color:var(--text-muted);"><i class="fas fa-circle-notch fa-spin"></i> Generating...</span>';

  // --- 3. EXECUTE (Async to allow UI update) ---
  setTimeout(() => {
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

      // 1. STANDARD ASSESSMENTS (Dynamic)
      const assessList = JSON.parse(localStorage.getItem('assessments') || '[]');
      // Filter out Vetting Tests (Include Live Assessments in main report)
      const standardAssessments = assessList.filter(a => 
          !a.name.toLowerCase().includes('vetting test')
      );
      
      let goalHtml = ''; let scoreHtml = '';
      standardAssessments.forEach(a => {
          // Find matching score from either source (Robust Fuzzy Match)
          const rec = myRecs.find(r => {
              // Exact match
              if (r.assessment === a.name) return true;
              // Fuzzy match (ignore case/trim)
              if (r.assessment.trim().toLowerCase() === a.name.trim().toLowerCase()) return true;
              return false;
          });

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
      
      // 2. VETTING TABLES (Strict Separation)
      renderVettingTable('1st Vetting', myRecs, mySubs, 'repVetting1Body');
      renderVettingTable('Final Vetting', myRecs, mySubs, 'repVetting2Body');

      // PRE-FILL ADMIN DECISIONS (If any)
      const decisions = JSON.parse(localStorage.getItem('adminDecisions') || '{}');
      if(decisions[name]) {
          document.getElementById('repFeedback').innerText = decisions[name].comment || "";
          document.getElementById('repDeploy').innerText = decisions[name].status || "";
      } else {
          // Clear fields if no decision exists to prevent data leakage between trainees
          document.getElementById('repFeedback').innerText = "";
          document.getElementById('repDeploy').innerText = "";
      }
  }, 200);
}

function renderVettingTable(phaseKey, records, submissions, tableId) {
    const topics = JSON.parse(localStorage.getItem('vettingTopics') || '[]');
    let html = '';

    topics.forEach(topic => {
        // FILTER: Ensure topic belongs in this table
        // If topic has "Final Vetting" in name, skip it for "1st Vetting" table
        if (phaseKey === '1st Vetting' && topic.toLowerCase().includes('final vetting')) return;
        // If topic has "1st Vetting" in name, skip it for "Final Vetting" table
        if (phaseKey === 'Final Vetting' && topic.toLowerCase().includes('1st vetting')) return;

        // Clean the topic name for searching (remove any existing prefixes if they exist in the definition)
        // This ensures we search for the core subject name + the specific phase key
        const searchTopic = topic.replace(/1st Vetting - /gi, '').replace(/Final Vetting - /gi, '').trim();

        // Find best score for this Topic + Phase combination
        let score = -1;

        // Check Manual Records
        const rec = records.find(r => {
            if (!r.assessment) return false;
            const name = r.assessment.toLowerCase();
            // STRICT CHECK: Must contain Phase Key AND Topic Name
            return name.includes(phaseKey.toLowerCase()) && name.includes(searchTopic.toLowerCase()) && !name.includes(phaseKey === '1st Vetting' ? 'final' : '1st');
        });
        if (rec) score = Math.max(score, rec.score);

        // Check Digital Submissions
        const sub = submissions.find(s => {
            if (!s.testTitle) return false;
            const name = s.testTitle.toLowerCase();
            // STRICT CHECK: Must contain Phase Key AND Topic Name
            return name.includes(phaseKey.toLowerCase()) && name.includes(searchTopic.toLowerCase()) && !name.includes(phaseKey === '1st Vetting' ? 'final' : '1st');
        });
        if (sub) score = Math.max(score, sub.score);

        if (score === -1) score = null; // No record found

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

    // --- INJECT FILTER DROPDOWN IF MISSING ---
    const searchInput = document.getElementById('savedReportSearch');
    if (searchInput && !document.getElementById('savedReportGroupFilter')) {
        const select = document.createElement('select');
        select.id = 'savedReportGroupFilter';
        select.style.cssText = "padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-input); color: var(--text-main); margin-right: 10px; height: 32px; vertical-align: middle; max-width: 200px;";
        select.onchange = () => renderSavedReportsList();
        
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        select.innerHTML = '<option value="">All Groups</option>';
        Object.keys(rosters).sort().reverse().forEach(gid => {
            const label = (typeof getGroupLabel === 'function') ? getGroupLabel(gid, rosters[gid].length) : gid;
            select.add(new Option(label, gid));
        });

        // Insert before search input
        searchInput.parentNode.insertBefore(select, searchInput);
    }

    const saved = JSON.parse(localStorage.getItem('savedReports') || '[]');
    const search = searchInput ? searchInput.value.toLowerCase() : '';
    const groupFilter = document.getElementById('savedReportGroupFilter') ? document.getElementById('savedReportGroupFilter').value : '';
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');

    const tbody = document.getElementById('savedReportsList');
    if(!tbody) return;
    tbody.innerHTML = '';
    
    const filtered = saved.filter(r => {
        if (search && !r.trainee.toLowerCase().includes(search)) return false;
        if (groupFilter) {
            const members = rosters[groupFilter] || [];
            if (!members.some(m => m.toLowerCase() === r.trainee.toLowerCase())) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No reports found.</td></tr>';
        return;
    }

    filtered.reverse().forEach(r => {
        tbody.innerHTML += `<tr>
            <td>${r.date}</td>
            <td>${r.trainee}</td>
            <td>${r.savedBy}</td>
            <td>
                <button class="btn-primary" onclick="viewSavedReport(${r.id})" aria-label="View Saved Report for ${r.trainee}">View</button>
                <button class="btn-danger" onclick="deleteSavedReport(${r.id})" style="margin-left:5px;" title="Delete Report"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`;
    });
}

async function deleteSavedReport(id) {
    if(!confirm("Are you sure you want to delete this saved report?")) return;
    let saved = JSON.parse(localStorage.getItem('savedReports') || '[]');
    saved = saved.filter(r => r.id !== id);
    localStorage.setItem('savedReports', JSON.stringify(saved));
    await secureReportSave();
    renderSavedReportsList();
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

// --- LINK MANAGEMENT (TL & ADMIN) ---

async function requestRecordLink(recordId, trainee, assessment) {
    if (!confirm(`Request Admin to upload a link for ${trainee}'s ${assessment}?`)) return;
    
    const requests = JSON.parse(localStorage.getItem('linkRequests') || '[]');
    
    // Deduplicate
    if (requests.some(r => r.recordId === recordId && r.status === 'pending')) return alert("Request already pending.");

    requests.push({
        id: Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        recordId: recordId,
        trainee: trainee,
        assessment: assessment,
        requestedBy: CURRENT_USER.user,
        status: 'pending',
        date: new Date().toISOString()
    });
    
    localStorage.setItem('linkRequests', JSON.stringify(requests));
    await secureRequestSave();
    
    renderMonthly(); // Refresh UI
    alert("Request sent to Admin dashboard.");
}

async function updateRecordLink(index) {
    const records = JSON.parse(localStorage.getItem('records') || '[]');
    const r = records[index];
    if (!r) return;

    const newLink = await customPrompt("Update Link", "Enter URL for Assessment (e.g. SharePoint/OneDrive link):", r.link && r.link.startsWith('http') ? r.link : "");
    if (newLink === null) return; // Cancelled

    r.link = newLink.trim();
    localStorage.setItem('records', JSON.stringify(records));
    
    // Check if this fulfills a request
    const requests = JSON.parse(localStorage.getItem('linkRequests') || '[]');
    let reqUpdated = false;
    
    // Find pending request for this record (by ID or composite key if ID missing)
    const pendingIdx = requests.findIndex(req => 
        req.status === 'pending' && 
        (req.recordId === r.id || (req.trainee === r.trainee && req.assessment === r.assessment))
    );

    if (pendingIdx > -1) {
        requests[pendingIdx].status = 'completed';
        requests[pendingIdx].completedBy = CURRENT_USER.user;
        requests[pendingIdx].completedDate = new Date().toISOString();
        localStorage.setItem('linkRequests', JSON.stringify(requests));
        reqUpdated = true;
    }

    // Save
    if (typeof saveToServer === 'function') {
        await saveToServer(reqUpdated ? ['records', 'linkRequests'] : ['records'], false);
    }
    
    renderMonthly();
}
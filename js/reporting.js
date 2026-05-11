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
            // Only sync report blobs here; avoid forcing unrelated shared keys.
            await saveToServer(['savedReports'], true);
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

function normalizeReportingIdentity(value) {
    try {
        if (typeof normalizeIdentityValue === 'function') {
            const normalized = normalizeIdentityValue(value);
            if (normalized) return normalized;
        }
    } catch (e) {}
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[._-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function readReportingJson(key, fallback) {
    try {
        if (typeof safeLocalParse === 'function') return safeLocalParse(key, fallback);
        const parsed = JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
        return parsed === null || typeof parsed === 'undefined' ? fallback : parsed;
    } catch (e) {
        return fallback;
    }
}

function getLiveRosterMembershipSnapshot() {
    const rosters = readReportingJson('rosters', {}) || {};
    const groupIds = new Set();
    const memberGroups = new Map();
    Object.entries(rosters).forEach(([gid, members]) => {
        if (!Array.isArray(members)) return;
        groupIds.add(String(gid || '').trim());
        members.forEach(member => {
            const token = normalizeReportingIdentity(member);
            if (!token) return;
            if (!memberGroups.has(token)) memberGroups.set(token, new Set());
            memberGroups.get(token).add(String(gid || '').trim());
        });
    });
    return { rosters, groupIds, memberGroups };
}

function getAssessmentRecordIntegrity(row, rosterSnapshot) {
    if (!row || typeof row !== 'object') return { valid: false, reason: 'not_object' };
    if (row.archived === true) return { valid: false, reason: 'archived' };
    const status = String(row.status || '').trim().toLowerCase();
    if (['archived', 'deleted', 'invalid', 'retake_allowed'].includes(status)) return { valid: false, reason: status || 'inactive_status' };

    const trainee = String(row.trainee || row.user || row.user_id || '').trim();
    if (!trainee) return { valid: false, reason: 'missing_trainee' };
    const traineeToken = normalizeReportingIdentity(trainee);
    const memberGroups = rosterSnapshot.memberGroups.get(traineeToken);
    if (!memberGroups || memberGroups.size === 0) return { valid: false, reason: 'not_in_live_roster' };

    const groupID = String(row.groupID || row.groupId || row.group || '').trim();
    if (!groupID) return { valid: false, reason: 'missing_group' };
    if (!rosterSnapshot.groupIds.has(groupID)) return { valid: false, reason: 'stale_group' };
    if (!memberGroups.has(groupID)) return { valid: false, reason: 'trainee_not_in_record_group' };

    const assessment = String(row.assessment || row.testTitle || '').trim();
    if (!assessment) return { valid: false, reason: 'missing_assessment' };

    const score = Number(row.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) return { valid: false, reason: 'invalid_score' };

    const dateValue = String(row.date || '').trim();
    if (!dateValue || Number.isNaN(Date.parse(dateValue))) return { valid: false, reason: 'invalid_date' };

    return { valid: true, reason: 'live' };
}

function getCurrentLiveAssessmentRecordRows(recordsInput, options = {}) {
    const allRecords = Array.isArray(recordsInput) ? recordsInput : readReportingJson('records', []);
    const lifecycleRows = (typeof filterRowsToCurrentTraineeLifecycle === 'function')
        ? filterRowsToCurrentTraineeLifecycle(allRecords)
        : allRecords;
    const lifecycleSet = new Set(lifecycleRows);
    const rosterSnapshot = getLiveRosterMembershipSnapshot();
    const diagnostics = { total: allRecords.length, lifecycleExcluded: 0, invalid: 0, archived: 0, reasons: {} };

    const rows = allRecords
        .map((record, sourceIndex) => ({ record, sourceIndex }))
        .filter(({ record }) => {
            if (!lifecycleSet.has(record)) {
                diagnostics.lifecycleExcluded++;
                return false;
            }
            const integrity = getAssessmentRecordIntegrity(record, rosterSnapshot);
            if (!integrity.valid) {
                if (integrity.reason === 'archived') diagnostics.archived++;
                else diagnostics.invalid++;
                diagnostics.reasons[integrity.reason] = (diagnostics.reasons[integrity.reason] || 0) + 1;
                return options.includeInvalid === true;
            }
            return true;
        });

    rows.diagnostics = diagnostics;
    return rows;
}

function getCurrentLiveAssessmentRecords(recordsInput, options = {}) {
    const rows = getCurrentLiveAssessmentRecordRows(recordsInput, options);
    const records = rows.map(row => row.record);
    records.diagnostics = rows.diagnostics;
    return records;
}

function updateAssessmentRecordIntegritySummary(diagnostics, visibleCount) {
    const panel = document.querySelector('.records-results-panel .app-panel-subtitle');
    if (!panel || !diagnostics) return;
    const excluded = Number(diagnostics.lifecycleExcluded || 0) + Number(diagnostics.archived || 0) + Number(diagnostics.invalid || 0);
    const parts = [`Showing ${visibleCount} live valid record${visibleCount === 1 ? '' : 's'}`];
    if (excluded > 0) parts.push(`${excluded} old/archived/invalid row${excluded === 1 ? '' : 's'} excluded`);
    panel.textContent = parts.join(' | ');
}

async function submitInsightReview() {
    const modal = document.getElementById('insightReviewModal');
    const targetName = String(document.getElementById('reviewTargetName')?.textContent || '').trim();
    const status = String(document.getElementById('reviewStatus')?.value || '').trim();
    const comment = String(document.getElementById('reviewComment')?.value || '').trim();

    if (!targetName) return alert("No trainee selected for review.");
    if (!status) return alert("Please select a final status.");

    const decisions = JSON.parse(localStorage.getItem('adminDecisions') || '{}');
    decisions[targetName] = {
        status,
        comment,
        reviewedAt: new Date().toISOString(),
        reviewedBy: (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.user) ? CURRENT_USER.user : 'admin'
    };
    localStorage.setItem('adminDecisions', JSON.stringify(decisions));

    if (typeof saveToServer === 'function') {
        try {
            await saveToServer(['adminDecisions'], false);
        } catch (error) {
            console.warn('Legacy insight review decision sync failed:', error);
        }
    }

    if (modal) modal.classList.add('hidden');
    if (typeof showToast === 'function') showToast('Review decision saved.', 'success');
    if (typeof loadReportTab === 'function') loadReportTab();
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
    const allRecords = readReportingJson('records', []);
    const liveRows = getCurrentLiveAssessmentRecordRows(allRecords);
    const recs = liveRows.map(row => row.record);
    const rosters = readReportingJson('rosters', {});
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
  const allRecords = readReportingJson('records', []);
  const liveRows = getCurrentLiveAssessmentRecordRows(allRecords);
  const fMonth = document.getElementById('filterMonth').value;
  const fAssess = document.getElementById('filterAssessment').value;
  const fPhase = document.getElementById('filterPhase').value;
  const fTrainee = document.getElementById('filterTrainee').value.toLowerCase();
  
  const filteredRows = liveRows.filter(({ record: r }) => {
      if (!r || !r.trainee) return false;
      if(CURRENT_USER.role === 'trainee' && normalizeReportingIdentity(r.trainee) !== normalizeReportingIdentity(CURRENT_USER.user)) return false;
      if(fMonth !== '' && r.groupID !== fMonth) return false;
      if(fAssess !== '' && r.assessment !== fAssess) return false;
      if(fPhase !== '' && String(r.phase || '').trim() !== fPhase) return false;
      if(fTrainee !== '' && !String(r.trainee || '').toLowerCase().includes(fTrainee)) return false;
      return true;
  });
  updateAssessmentRecordIntegritySummary(liveRows.diagnostics, filteredRows.length);

  const tbody = document.querySelector('#monthlyTableMain tbody');
  const theadRow = document.querySelector('#monthlyTableMain thead tr');

  // FOCUS PROTECTION for the Trainee Search Input in the Monthly View
  // We allow updates while typing to filter results, but ensure we don't clear the input.
  
  if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin' || CURRENT_USER.role === 'teamleader' || CURRENT_USER.role === 'special_viewer') {
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
          if (typeof setTableState === 'function') {
              setTableState(tbody, 9, 'empty', 'Select a filter to view records.', 'Use the pinned filters on the left to choose a group, assessment, phase, or trainee.', 'fa-filter');
          } else {
              tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="color:var(--text-muted);">Please select a filter to view records.</td></tr>';
          }
          return;
      }
  }
    
  let html = '';
  filteredRows.forEach(({ record: r, sourceIndex }) => {
    // SAFETY CHECK: Skip corrupted records without trainee names
    if (!r.trainee) return;
    
    let s = 'fail'; let t = 'Fail';
    const PASS_SCORE = (typeof PASS !== 'undefined') ? PASS : 90;
    const IMPROVE_SCORE = (typeof IMPROVE !== 'undefined') ? IMPROVE : 60;

    if(r.score >= PASS_SCORE) { s = 'pass'; t = 'Pass'; }
    else if(r.score >= IMPROVE_SCORE) { s = 'improve'; t = 'Improve'; }
    
    let checkHtml = (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin')
      ? `<td class="admin-only" style="text-align:center;"><input type="checkbox" class="del-check" value="${sourceIndex}" aria-label="Select Record for Deletion"></td>`
      : '';
    
    // --- ACTION COLUMN LOGIC ---
    let actionHtml = '';
    if(CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin' || CURRENT_USER.role === 'teamleader' || CURRENT_USER.role === 'special_viewer') {
        actionHtml = '<td class="action-cell">';
        
        if(r.link === 'Digital-Assessment' || r.link === 'Live-Session') {
             // Check if function exists to avoid reference errors
             const clickAction = (typeof window.viewCompletedTest === 'function' || typeof viewCompletedTest === 'function') 
                ? (r.submissionId ? `onclick="viewCompletedTest('${r.submissionId}', null, 'view')"` : `disabled title="Missing submission ID"`)
                : `onclick="alert('Assessment viewer not loaded.')"`;
             const editAction = (typeof window.viewCompletedTest === 'function' || typeof viewCompletedTest === 'function')
                ? (r.submissionId ? `onclick="viewCompletedTest('${r.submissionId}', null, 'edit')"` : `onclick="updateRecordScore(${sourceIndex})" title="No submission file found; edit permanent record score only"`)
                : `onclick="updateRecordScore(${sourceIndex})"`;
             
             actionHtml += `<button class="btn-secondary" style="padding:2px 8px; font-size:0.8rem;" ${clickAction} aria-label="View Digital Assessment"><i class="fas fa-eye"></i> View</button>`;
             if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin') {
                actionHtml += ` <button class="btn-primary btn-sm" ${editAction} title="Edit Score"><i class="fas fa-pen"></i></button>`;
             }
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
            if ((CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin') && !r.link) { btnClass = 'btn-primary'; btnIcon = 'fa-plus'; btnText = 'Add Link'; }

            actionHtml += `<button class="${btnClass} btn-sm" onclick="handleRecordLinkClick('${r.id}', '${safeLink}', '${safeTrainee}', '${safeAssess}')"><i class="fas ${btnIcon}"></i> ${btnText}</button>`;
            
            // Admin Edit Button (Only if link exists)
            if ((CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin') && r.link) {
                actionHtml += ` <button class="btn-secondary btn-sm" onclick="updateRecordLink(${sourceIndex})" title="Edit Link"><i class="fas fa-pen"></i></button>`;
            }
            if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin') {
                actionHtml += ` <button class="btn-primary btn-sm" onclick="updateRecordScore(${sourceIndex})" title="Edit Score"><i class="fas fa-star"></i></button>`;
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

    html += `<tr>${checkHtml}<td>${r.date || '-'}</td><td>${groupDisplay}</td><td><div style="display:flex; align-items:center;">${getAvatarHTML(r.trainee)} <span style="font-weight:600; color:var(--primary);">${r.trainee}</span></div></td><td>${r.assessment}</td><td>${r.phase}</td><td>${r.score}%</td><td class="status-badge status-${s}">${t}</td>${actionHtml}</tr>`;
  });
  
  if (html === '') {
      if (typeof setTableState === 'function') {
          setTableState(tbody, 9, 'empty', 'No records match these filters.', 'Adjust the filter panel or clear one of the filters to broaden the result set.', 'fa-magnifying-glass');
      } else {
          tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="color:var(--text-muted);">No records found matching filters.</td></tr>';
      }
  }
  else tbody.innerHTML = html;

  if(CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin') document.querySelectorAll('.admin-only').forEach(e => e.classList.remove('hidden')); 
  else document.querySelectorAll('.admin-only').forEach(e => e.classList.add('hidden'));
}

function loadReportTab() {
  let users = JSON.parse(localStorage.getItem('users') || '[]');
  let reports = JSON.parse(localStorage.getItem('savedReports') || '[]');
  const existingTrainees = new Set(reports.map(r => r.trainee.toLowerCase()));

  const select = document.getElementById('reportTraineeSelect');
  if(select) {
      select.innerHTML = '<option value="">-- Select Trainee --</option>';
      users.filter(u => u.role === 'trainee' && !existingTrainees.has(u.user.toLowerCase()))
           .sort((a,b) => a.user.localeCompare(b.user))
           .forEach(u => { select.add(new Option(u.user, u.user)); });
  }
  const dateEl = document.getElementById('printDate');
  if(dateEl) dateEl.innerText = new Date().toLocaleDateString();
  installReportAutoGrow();
  prepareReportForOutput(document.getElementById('reportContainer'));
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
    prepareReportForOutput(document.getElementById('reportContainer'));
}

function getReportEditableFields(scope) {
    const root = scope || document;
    if (!root.querySelectorAll) return [];
    return Array.from(root.querySelectorAll('.report-text-area[contenteditable="true"], .report-input-display[contenteditable="true"]'));
}

function growReportEditableField(el) {
    if (!el) return;
    el.style.height = 'auto';
    if (el.scrollHeight && el.scrollHeight > el.clientHeight) {
        el.style.height = `${el.scrollHeight + 2}px`;
    }
}

function prepareReportForOutput(scope) {
    getReportEditableFields(scope).forEach(growReportEditableField);
}

function installReportAutoGrow() {
    const roots = [
        document.getElementById('reportContainer'),
        document.getElementById('savedReportContent')
    ].filter(Boolean);

    roots.forEach(root => {
        if (root.dataset.autoGrowInstalled === 'true') {
            prepareReportForOutput(root);
            return;
        }
        root.dataset.autoGrowInstalled = 'true';
        root.addEventListener('input', event => {
            if (event.target && event.target.matches('.report-text-area[contenteditable="true"], .report-input-display[contenteditable="true"]')) {
                growReportEditableField(event.target);
            }
        });
        root.addEventListener('paste', event => {
            if (!event.target || !event.target.matches('.report-text-area[contenteditable="true"], .report-input-display[contenteditable="true"]')) return;
            event.preventDefault();
            const text = (event.clipboardData || window.clipboardData).getData('text/plain');
            document.execCommand('insertText', false, text);
            growReportEditableField(event.target);
        });
        prepareReportForOutput(root);
    });
}

function normalizeReportText(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function escapeReportHtml(value) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getConfiguredOnboardReportItems(sectionKey) {
    const readProgressItems = () => {
        if (typeof getInsightProgressRequiredItems === 'function') {
            return getInsightProgressRequiredItems();
        }
        try {
            const cfg = JSON.parse(localStorage.getItem('insight_progress_config') || '{}');
            return Array.isArray(cfg.requiredItems) ? cfg.requiredItems : [];
        } catch (error) {
            return [];
        }
    };

    return readProgressItems()
        .filter(item => item && item.source !== 'auto' && item.reportSections && item.reportSections[sectionKey] === true)
        .map(item => ({
            name: String(item.name || '').trim(),
            type: String(item.type || '').trim().toLowerCase() || 'assessment'
        }))
        .filter(item => item.name);
}

function findReportScore(itemName, records, submissions, options = {}) {
    const target = normalizeReportText(itemName);
    const phaseKey = normalizeReportText(options.phaseKey || '');
    const vettingCore = target
        .replace(/^1st vetting\s*-\s*/i, '')
        .replace(/^final vetting\s*-\s*/i, '')
        .trim();

    const record = records.find(r => {
        const assessment = normalizeReportText(r && r.assessment);
        if (!assessment) return false;
        if (phaseKey && !assessment.includes(phaseKey)) return false;
        if (phaseKey && phaseKey.includes('1st') && assessment.includes('final')) return false;
        if (phaseKey && phaseKey.includes('final') && assessment.includes('1st')) return false;
        return assessment === target || assessment.includes(target) || (vettingCore && assessment.includes(vettingCore));
    });

    const submission = submissions.find(s => {
        const title = normalizeReportText(s && s.testTitle);
        if (!title) return false;
        if (phaseKey && !title.includes(phaseKey)) return false;
        if (phaseKey && phaseKey.includes('1st') && title.includes('final')) return false;
        if (phaseKey && phaseKey.includes('final') && title.includes('1st')) return false;
        return title === target || title.includes(target) || (vettingCore && title.includes(vettingCore));
    });

    const scores = [record ? Number(record.score) : -1, submission ? Number(submission.score) : -1]
        .filter(score => Number.isFinite(score));
    const best = scores.length ? Math.max(...scores) : -1;
    return best >= 0 ? best : null;
}

function createReportSnapshotHtml() {
    const container = document.getElementById('reportContainer');
    if (!container) return '';
    prepareReportForOutput(container);
    const clone = container.cloneNode(true);
    clone.querySelectorAll('.report-text-area, .report-input-display').forEach(el => {
        el.style.height = 'auto';
        el.removeAttribute('data-auto-height');
    });
    return clone.innerHTML;
}

function printGeneratedReport() {
    prepareReportForOutput(document.getElementById('reportContainer'));
    document.body.classList.add('printing-generated-report');
    window.print();
}

function printSavedReport() {
    prepareReportForOutput(document.getElementById('savedReportContent'));
    document.body.classList.add('printing-saved-report');
    window.print();
}

function closeSavedReportModal() {
    document.getElementById('savedReportModal')?.classList.add('hidden');
    document.body.classList.remove('printing-saved-report');
}

window.addEventListener('beforeprint', () => {
    prepareReportForOutput(document.getElementById('reportContainer'));
    prepareReportForOutput(document.getElementById('savedReportContent'));
});

window.addEventListener('afterprint', () => {
    document.body.classList.remove('printing-generated-report');
    document.body.classList.remove('printing-saved-report');
});

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

      // 1. STANDARD ASSESSMENTS (Configured from Agent Progress Builder Insight)
      const assessList = JSON.parse(localStorage.getItem('assessments') || '[]');
      const configuredGoalItems = getConfiguredOnboardReportItems('trainingGoal');
      const configuredScoreItems = getConfiguredOnboardReportItems('assessmentScores');
      const fallbackAssessments = assessList
          .filter(a => a && a.name && !a.name.toLowerCase().includes('vetting test'))
          .map(a => ({ name: a.name, type: 'assessment' }));
      const goalItems = configuredGoalItems.length ? configuredGoalItems : fallbackAssessments;
      const scoreItems = configuredScoreItems.length ? configuredScoreItems : fallbackAssessments;
      
      let goalHtml = '';
      goalItems.forEach(item => {
          const score = findReportScore(item.name, myRecs, mySubs);
          let g1='', g2='', g3='', s1='', s2='', s3='';
          if(score !== null) {
              if(score >= 90) { g1 = '&#8226;'; s3 = '&#8226;'; }
              else if(score >= 60) { g2 = '&#8226;'; s2 = '&#8226;'; }
              else { g3 = '&#8226;'; s1 = '&#8226;'; }
          }
          goalHtml += `<tr><td>${escapeReportHtml(item.name)}</td><td class="center report-check">${g1}</td><td class="center report-check">${g2}</td><td class="center report-check">${g3}</td></tr>`;
      });

      let scoreHtml = '';
      scoreItems.forEach(item => {
          const score = findReportScore(item.name, myRecs, mySubs);
          let s1='', s2='', s3='';
          if(score !== null) {
              if(score >= 90) s3 = '&#8226;';
              else if(score >= 60) s2 = '&#8226;';
              else s1 = '&#8226;';
          }
          scoreHtml += `<tr><td>${escapeReportHtml(item.name)}</td><td class="center report-check">${s1}</td><td class="center report-check">${s2}</td><td class="center report-check">${s3}</td></tr>`;
      });
      
      document.getElementById('repGoalBody').innerHTML = goalHtml;
      document.getElementById('repScoreBody').innerHTML = scoreHtml;
      
      // 2. VETTING TABLES (Strict Separation)
      renderVettingTable('1st Vetting', myRecs, mySubs, 'repVetting1Body', getConfiguredOnboardReportItems('vettingTest1'));
      renderVettingTable('Final Vetting', myRecs, mySubs, 'repVetting2Body', getConfiguredOnboardReportItems('vettingFinal'));

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
      prepareReportForOutput(document.getElementById('reportContainer'));
  }, 200);
}

function renderVettingTable(phaseKey, records, submissions, tableId, configuredItems = []) {
    const topics = JSON.parse(localStorage.getItem('vettingTopics') || '[]');
    const reportTopics = Array.isArray(configuredItems) && configuredItems.length
        ? configuredItems.map(item => String(item.name || '').trim()).filter(Boolean)
        : topics;
    let html = '';

    reportTopics.forEach(topic => {
        // FILTER: Ensure topic belongs in this table
        // If topic has "Final Vetting" in name, skip it for "1st Vetting" table
        if (phaseKey === '1st Vetting' && topic.toLowerCase().includes('final vetting')) return;
        // If topic has "1st Vetting" in name, skip it for "Final Vetting" table
        if (phaseKey === 'Final Vetting' && topic.toLowerCase().includes('1st vetting')) return;

        // Clean the topic name for searching (remove any existing prefixes if they exist in the definition)
        // This ensures we search for the core subject name + the specific phase key
        const searchTopic = topic.replace(/1st Vetting - /gi, '').replace(/Final Vetting - /gi, '').trim();

        const score = findReportScore(`${phaseKey} - ${searchTopic}`, records, submissions, { phaseKey });

        let v1='', v2='', v3='', v4='';
        if(score !== null) {
            if(score === 100) v4 = '&#8226;'; else if(score >= 80) v3 = '&#8226;'; else if(score >= 60) v2 = '&#8226;'; else v1 = '&#8226;';
        }
        html += `<tr><td>${escapeReportHtml(topic)}</td><td class="center report-check">${v1}</td><td class="center report-check">${v2}</td><td class="center report-check">${v3}</td><td class="center report-check">${v4}</td></tr>`;
    });
    const target = document.getElementById(tableId);
    if(target) target.innerHTML = html;
}

// UPDATED: Async Save (Instant Mode)
async function saveGeneratedReport() {
    const selectedName = document.getElementById('reportTraineeSelect')?.value || '';
    const name = document.getElementById('repName').innerText.trim();
    if(!selectedName || !name || name.toLowerCase().includes('generating')) return alert("Generate a report first.");
    prepareReportForOutput(document.getElementById('reportContainer'));
    const reportData = {
        id: Date.now(),
        date: new Date().toLocaleDateString(),
        trainee: name,
        savedBy: CURRENT_USER.user,
        html: createReportSnapshotHtml(),
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
    loadReportTab();
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
            <td data-label="Date Saved">${r.date}</td>
            <td data-label="Trainee">${r.trainee}</td>
            <td data-label="Saved By">${r.savedBy}</td>
            <td data-label="Action">
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
    
    // HARD DELETE: Remove from server table immediately
    if (window.supabaseClient) await window.supabaseClient.from('saved_reports').delete().eq('id', id.toString());
    
    await secureReportSave();
    renderSavedReportsList();
}

function viewSavedReport(id) {
    const saved = JSON.parse(localStorage.getItem('savedReports') || '[]');
    // FIX: Use loose equality (==) to match string ID from HTML with number ID in data
    let report = saved.find(r => r.id == id);

    // NEW: Check Archives if not found in active reports
    if (!report) {
        const allArchiveRows = JSON.parse(localStorage.getItem('graduated_agents') || '[]') || [];
        const graduates = allArchiveRows.filter(g => {
            const reason = String((g && g.reason) || '').toLowerCase().trim();
            return !reason.startsWith('moved to ');
        });
        const retrainArchives = [
            ...(JSON.parse(localStorage.getItem('retrain_archives') || '[]') || []),
            ...allArchiveRows.filter(g => {
                const reason = String((g && g.reason) || '').toLowerCase().trim();
                return reason.startsWith('moved to ');
            })
        ];
        const archiveBuckets = [graduates, retrainArchives];

        for (const bucket of archiveBuckets) {
            if (!Array.isArray(bucket)) continue;
            for (const g of bucket) {
                if (g.reports && Array.isArray(g.reports)) {
                    const found = g.reports.find(r => r.id == id);
                    if (found) {
                        report = found;
                        break;
                    }
                }
            }
            if (report) break;
        }
    }

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
    installReportAutoGrow();
    prepareReportForOutput(container);
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

async function updateRecordScore(index) {
    if (!(CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin')) {
        if (typeof showToast === 'function') showToast("Only Admins can edit assessment scores.", "error");
        return;
    }

    const records = JSON.parse(localStorage.getItem('records') || '[]');
    const record = records[index];
    if (!record) return;

    const currentScore = Number.isFinite(Number(record.score)) ? Number(record.score) : 0;
    const rawValue = (typeof customPrompt === 'function')
        ? await customPrompt("Edit Score", `Enter score for ${record.trainee} - ${record.assessment}`, String(currentScore))
        : prompt(`Enter score for ${record.trainee} - ${record.assessment}`, String(currentScore));
    if (rawValue === null) return;

    const nextScore = Number(rawValue);
    if (!Number.isFinite(nextScore) || nextScore < 0 || nextScore > 100) {
        alert("Please enter a valid score between 0 and 100.");
        return;
    }

    const nowIso = new Date().toISOString();
    record.score = Math.round(nextScore * 10) / 10;
    record.lastModified = nowIso;
    record.modifiedBy = CURRENT_USER.user;
    if (!record.id) record.id = Date.now() + "_" + Math.random().toString(36).substr(2, 9);

    const keysToSave = ['records'];

    if (record.submissionId) {
        const submissions = JSON.parse(localStorage.getItem('submissions') || '[]');
        const submission = submissions.find(s => String(s.id || '') === String(record.submissionId));
        if (submission) {
            submission.score = record.score;
            submission.lastEditedBy = CURRENT_USER.user;
            submission.lastEditedDate = nowIso;
            submission.lastModified = nowIso;
            submission.modifiedBy = CURRENT_USER.user;
            if (!Array.isArray(submission.markingAudit)) submission.markingAudit = [];
            submission.markingAudit.push({
                marker: CURRENT_USER.user,
                action: 'Assessment record score updated',
                score: record.score,
                timestamp: nowIso
            });
            localStorage.setItem('submissions', JSON.stringify(submissions));
            keysToSave.push('submissions');
        }
    }

    localStorage.setItem('records', JSON.stringify(records));

    if (typeof saveToServer === 'function') {
        await saveToServer(keysToSave, true);
    }

    if (typeof showToast === 'function') showToast("Assessment score updated and synced.", "success");
    renderMonthly();
    if (typeof loadCompletedHistory === 'function') loadCompletedHistory();
    if (typeof loadTestRecords === 'function') loadTestRecords();
}

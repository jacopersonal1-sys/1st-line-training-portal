/* ================= ASSESSMENT ADMIN ================= */
/* Dashboard, Marking Queue, and Grading Logic */

const MARKING_LEASE_MS = 3 * 60 * 1000;
const MARKING_HEARTBEAT_MS = 45000;
if (!window.MARKING_SESSION_ID) {
    window.MARKING_SESSION_ID = (window.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`);
}

/**
 * 1. ADMIN: ASSESSMENT DASHBOARD (OVERVIEW)
 */
function loadAssessmentDashboard() {
    const container = document.getElementById('assessmentDashboard');
    if (!container) return;
    
    container.innerHTML = '';

    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');

    if (tests.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted); padding:10px;">No assessments created yet. Use the "+ Create New Assessment" button.</p>';
        return;
    }

    // Calculate Global Stats
    const totalTests = tests.length;
    const totalPending = subs.filter(s => s.status === 'pending' && !s.archived).length;
    const totalCompleted = subs.filter(s => s.status === 'completed' && !s.archived).length;

    let html = `
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:20px;">
            <div class="card" style="text-align:center; padding:15px; display:flex; align-items:center; gap:15px;">
                <div style="width:50px; height:50px; background:var(--bg-input); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:1.5rem; color:var(--primary);"><i class="fas fa-clipboard-list"></i></div>
                <div style="text-align:left;">
                    <div style="font-size:1.8rem; font-weight:bold; line-height:1;">${totalTests}</div>
                    <div style="font-size:0.8rem; color:var(--text-muted);">Active Assessments</div>
                </div>
            </div>
            <div class="card" style="text-align:center; padding:15px; display:flex; align-items:center; gap:15px;">
                <div style="width:50px; height:50px; background:rgba(231, 76, 60, 0.1); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:1.5rem; color:#e74c3c;"><i class="fas fa-highlighter"></i></div>
                <div style="text-align:left;">
                    <div style="font-size:1.8rem; font-weight:bold; line-height:1; color:#e74c3c;">${totalPending}</div>
                    <div style="font-size:0.8rem; color:var(--text-muted);">Pending Review</div>
                </div>
            </div>
            <div class="card" style="text-align:center; padding:15px; display:flex; align-items:center; gap:15px;">
                <div style="width:50px; height:50px; background:rgba(46, 204, 113, 0.1); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:1.5rem; color:#2ecc71;"><i class="fas fa-check-circle"></i></div>
                <div style="text-align:left;">
                    <div style="font-size:1.8rem; font-weight:bold; line-height:1; color:#2ecc71;">${totalCompleted}</div>
                    <div style="font-size:0.8rem; color:var(--text-muted);">Completed Tests</div>
                </div>
            </div>
        </div>
    `;
    container.innerHTML = html;
}

/**
 * 2. ADMIN: MARKING QUEUE & GRADING LOGIC
 */
function loadMarkingQueue() {
    const container = document.getElementById('markingList');
    if (!container) return;

    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const records = JSON.parse(localStorage.getItem('records') || '[]');

    // Filter pending
    let pending = subs.filter(s => s.status === 'pending' && !s.archived);

    // --- AUTO-REPAIR: RECOVER ACCIDENTALLY ARCHIVED PENDING TESTS ---
    // If a test was archived due to a glitch but is still pending, and no valid test exists, restore it.
    let needsRepair = false;
    subs.filter(s => s.status === 'pending' && s.archived).forEach(pa => {
        const hasValid = subs.some(s => s.trainee === pa.trainee && s.testId === pa.testId && !s.archived && (s.status === 'pending' || s.status === 'completed'));
        if (!hasValid) {
            pa.archived = false;
            pending.push(pa);
            needsRepair = true;
        }
    });
    if (needsRepair) {
        localStorage.setItem('submissions', JSON.stringify(subs));
        // Save silently in background
        if (typeof saveToServer === 'function') saveToServer(['submissions'], false, true);
    }

    // GHOST DATA CLEANUP:
    const ghosts = [];
    const validPending = [];

    pending.forEach(s => {
        // Only consider it a ghost if a record is EXPLICITLY linked to this specific submission ID
        // This allows legitimate retakes to appear in the marking queue even if a prior record exists.
        const isLinkedToRecord = records.some(r => r.submissionId === s.id);
        if (isLinkedToRecord) ghosts.push(s);
        else validPending.push(s);
    });

    if (ghosts.length > 0) {
        console.log("Auto-archiving ghost submissions:", ghosts);
        ghosts.forEach(g => { g.status = 'completed'; g.archived = true; });
        localStorage.setItem('submissions', JSON.stringify(subs)); // Save updated state
        if(typeof saveToServer === 'function') saveToServer(['submissions'], false);
    }

    // Update Badge
    const badge = document.getElementById('markingCountBadge');
    if (badge) {
        badge.innerText = validPending.length;
        if (validPending.length > 0) badge.classList.remove('hidden');
        else badge.classList.add('hidden');
    }

    if (validPending.length === 0) {
        container.innerHTML = `
            <div style="padding:15px; text-align:center; color:var(--text-muted); background:var(--bg-input); border-radius:8px;">
                No assessments awaiting review.
                <div style="margin-top:10px;">
                    <button class="btn-secondary btn-sm" onclick="if(typeof forceResyncRows === 'function') forceResyncRows()"><i class="fas fa-sync"></i> Check Server</button>
                </div>
            </div>`;
        return;
    }

    // --- GROUP BY TRAINEE ---
    const grouped = {};
    validPending.forEach(s => {
        if (!grouped[s.trainee]) grouped[s.trainee] = [];
        grouped[s.trainee].push(s);
    });

    const sortedTrainees = Object.keys(grouped).sort();

    container.innerHTML = sortedTrainees.map(trainee => {
        const traineeSubs = grouped[trainee];
        // Sort chronologically
        traineeSubs.sort((a,b) => new Date(a.date) - new Date(b.date));

        const rowsHtml = traineeSubs.map(s => {
            const tType = s.testSnapshot?.type || (s.testTitle.toLowerCase().includes('vetting') ? 'vetting' : 'standard');
            const activeLock = getActiveMarkingLock(s);
            const isLockedByOther = activeLock && !isOwnMarkingLock(activeLock);
            const lockBadge = getMarkingLockBadgeHTML(s);
            let typeBadge = `<span style="font-size:0.75rem; background:var(--bg-input); padding:2px 6px; border-radius:4px; color:var(--text-muted); border:1px solid var(--border-color); margin-left:10px;"><i class="fas fa-file-alt"></i> Standard</span>`;
            
            if (tType === 'vetting') {
                typeBadge = `<span style="font-size:0.75rem; background:rgba(155, 89, 182, 0.1); padding:2px 6px; border-radius:4px; color:#9b59b6; border:1px solid #9b59b6; margin-left:10px;"><i class="fas fa-shield-alt"></i> Vetting</span>`;
            } else if (tType === 'live') {
                typeBadge = `<span style="font-size:0.75rem; background:rgba(243, 112, 33, 0.1); padding:2px 6px; border-radius:4px; color:var(--primary); border:1px solid var(--primary); margin-left:10px;"><i class="fas fa-satellite-dish"></i> Live</span>`;
            } else if (tType === 'quiz') {
                typeBadge = `<span style="font-size:0.75rem; background:rgba(52, 152, 219, 0.1); padding:2px 6px; border-radius:4px; color:#3498db; border:1px solid #3498db; margin-left:10px;"><i class="fas fa-circle-question"></i> Quiz</span>`;
            }

            return `
            <div class="marking-queue-row ${isLockedByOther ? 'locked' : ''}">
                <div>
                    <div style="font-weight:bold; margin-bottom:4px; display:flex; align-items:center; flex-wrap:wrap; gap:6px;">${s.testTitle} ${typeBadge} ${lockBadge}</div>
                    <div style="font-size:0.8rem; color:var(--text-muted);"><i class="fas fa-calendar-alt"></i> Submitted: ${s.date} | Current Score: <span style="color:var(--text-main); font-weight:bold;">${s.score || 0}%</span></div>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="btn-primary btn-sm" onclick="approveSubmission('${s.id}')" title="Quick Approve (Accept Score)" ${isLockedByOther ? 'disabled' : ''}><i class="fas fa-check"></i> Approve</button>
                    <button class="btn-secondary btn-sm" onclick="openAdminMarking('${s.id}')" title="Detailed Grade" ${isLockedByOther ? 'disabled' : ''}><i class="fas fa-highlighter"></i> Grade</button>
                </div>
            </div>`;
        }).join('');

        return `
        <div class="card" style="padding:0; overflow:hidden; margin-bottom:20px; border:1px solid var(--border-color);">
            <div style="background:var(--bg-input); padding:10px 15px; display:flex; align-items:center; gap:10px; border-bottom:1px solid var(--border-color);">
                ${getAvatarHTML(trainee)}
                <h3 style="margin:0;">${trainee}</h3>
                <span class="badge-count" style="position:static; margin-left:auto; background:var(--primary); font-size:0.8rem;">${traineeSubs.length} Pending</span>
            </div>
            <div style="padding:15px; display:flex; flex-direction:column; gap:10px;">
                ${rowsHtml}
            </div>
        </div>`;
    }).join('');
}

function getCurrentMarkerName() {
    if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) {
        return CURRENT_USER.user || CURRENT_USER.name || CURRENT_USER.email || 'Unknown';
    }
    return 'Unknown';
}

function getSubmissionEditTime(submission) {
    if (!submission) return 0;
    return new Date(submission.lastEditedDate || submission.lastModified || submission.submittedAt || submission.date || 0).getTime() || 0;
}

function buildRecordIdForSubmission(submission) {
    return submission?.id ? `record_${submission.id}` : `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function applyServerSubmissionLocally(serverSubmission) {
    if (!serverSubmission?.id) return;
    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const idx = subs.findIndex(s => s.id === serverSubmission.id);
    if (idx > -1) {
        subs[idx] = { ...subs[idx], ...serverSubmission };
    } else {
        subs.push(serverSubmission);
    }
    localStorage.setItem('submissions', JSON.stringify(subs));

    if (typeof generateChecksum === 'function') {
        const hashMap = JSON.parse(localStorage.getItem('hash_map_submissions') || '{}');
        hashMap[serverSubmission.id] = generateChecksum(JSON.stringify(serverSubmission));
        localStorage.setItem('hash_map_submissions', JSON.stringify(hashMap));
    }
}

function getMarkerSessionKey() {
    return `${getCurrentMarkerName()}::${window.MARKING_SESSION_ID}`;
}

function getActiveMarkingLock(submission) {
    const lock = submission?.markingLock;
    if (!lock?.expiresAt) return null;
    return new Date(lock.expiresAt).getTime() > Date.now() ? lock : null;
}

function isOwnMarkingLock(lock) {
    return lock?.markerSession === getMarkerSessionKey();
}

function getMarkingLockBadgeHTML(submission) {
    const lock = getActiveMarkingLock(submission);
    if (!lock) return '<span class="marking-lease-badge available"><i class="fas fa-unlock"></i> Available</span>';
    if (isOwnMarkingLock(lock)) return '<span class="marking-lease-badge mine"><i class="fas fa-pen"></i> You are marking</span>';
    return `<span class="marking-lease-badge locked"><i class="fas fa-lock"></i> ${lock.marker || 'Another admin'} is marking</span>`;
}

function setMarkingInputsDisabled(isDisabled) {
    document.querySelectorAll('#markingContainer .q-mark, #markingContainer .q-comment').forEach(input => {
        input.disabled = isDisabled;
    });
    const submitBtn = document.getElementById('markingSubmitBtn');
    if (submitBtn) submitBtn.disabled = isDisabled;
}

function updateMarkingLeaseBanner(message, tone = 'info') {
    const banner = document.getElementById('markingLeaseBanner');
    if (!banner) return;
    banner.className = `marking-lease-banner ${tone}`;
    banner.innerHTML = message || '';
    banner.classList.toggle('hidden', !message);
}

async function fetchServerSubmissionRow(subId) {
    if (!window.supabaseClient || !subId) return null;
    const { data, error } = await window.supabaseClient
        .from('submissions')
        .select('id,data,updated_at,trainee')
        .eq('id', subId)
        .single();
    if (error) throw error;
    return data;
}

async function writeServerSubmissionFromRow(row, nextSubmission) {
    const payload = {
        data: nextSubmission,
        trainee: nextSubmission.trainee || null,
        updated_at: new Date().toISOString()
    };

    let query = window.supabaseClient
        .from('submissions')
        .update(payload)
        .eq('id', row.id);

    if (row.updated_at) query = query.eq('updated_at', row.updated_at);

    const { data, error } = await query.select('data,updated_at').maybeSingle();
    if (error) throw error;
    if (!data?.data) throw new Error('Submission changed before the marking lease could be saved.');

    applyServerSubmissionLocally(data.data);
    return data.data;
}

async function claimMarkingLease(subId, mode = 'detailed') {
    if (!window.supabaseClient || !subId) return true;

    try {
        const row = await fetchServerSubmissionRow(subId);
        const serverSubmission = row?.data;
        if (!serverSubmission) return true;

        const activeLock = getActiveMarkingLock(serverSubmission);
        if (activeLock && !isOwnMarkingLock(activeLock)) {
            applyServerSubmissionLocally(serverSubmission);
            alert(`${activeLock.marker || 'Another admin'} is already marking this submission. I refreshed your queue so we do not double-mark it.`);
            loadMarkingQueue();
            return false;
        }

        const now = new Date();
        const nextSubmission = {
            ...serverSubmission,
            markingLock: {
                marker: getCurrentMarkerName(),
                markerSession: getMarkerSessionKey(),
                mode,
                claimedAt: activeLock?.claimedAt || now.toISOString(),
                heartbeatAt: now.toISOString(),
                expiresAt: new Date(now.getTime() + MARKING_LEASE_MS).toISOString()
            }
        };

        await writeServerSubmissionFromRow(row, nextSubmission);
        window.ACTIVE_MARKING_SUBMISSION_ID = subId;
        startMarkingLeaseHeartbeat(subId);
        return true;
    } catch (error) {
        console.warn('Unable to claim marking lease:', error);
        alert('I could not reserve this submission on the server. Please try again after the realtime tunnel catches up.');
        return false;
    }
}

async function renewMarkingLease(subId = window.ACTIVE_MARKING_SUBMISSION_ID) {
    if (!window.supabaseClient || !subId) return;

    try {
        const row = await fetchServerSubmissionRow(subId);
        const serverSubmission = row?.data;
        const activeLock = getActiveMarkingLock(serverSubmission);
        if (!activeLock || !isOwnMarkingLock(activeLock) || serverSubmission?.status === 'completed') {
            stopMarkingLeaseHeartbeat();
            validateActiveMarkingModalLock();
            return;
        }

        const now = new Date();
        await writeServerSubmissionFromRow(row, {
            ...serverSubmission,
            markingLock: {
                ...activeLock,
                heartbeatAt: now.toISOString(),
                expiresAt: new Date(now.getTime() + MARKING_LEASE_MS).toISOString()
            }
        });
    } catch (error) {
        console.warn('Marking lease heartbeat failed:', error);
    }
}

function startMarkingLeaseHeartbeat(subId) {
    stopMarkingLeaseHeartbeat(false);
    window.ACTIVE_MARKING_SUBMISSION_ID = subId;
    window.MARKING_LEASE_TIMER = setInterval(() => renewMarkingLease(subId), MARKING_HEARTBEAT_MS);
}

function stopMarkingLeaseHeartbeat(clearActive = true) {
    if (window.MARKING_LEASE_TIMER) {
        clearInterval(window.MARKING_LEASE_TIMER);
        window.MARKING_LEASE_TIMER = null;
    }
    if (clearActive) window.ACTIVE_MARKING_SUBMISSION_ID = null;
}

async function releaseMarkingLease(subId = window.ACTIVE_MARKING_SUBMISSION_ID) {
    if (!subId) {
        stopMarkingLeaseHeartbeat();
        return;
    }

    try {
        if (window.supabaseClient) {
            const row = await fetchServerSubmissionRow(subId);
            const serverSubmission = row?.data;
            const activeLock = getActiveMarkingLock(serverSubmission);
            if (activeLock && isOwnMarkingLock(activeLock)) {
                await writeServerSubmissionFromRow(row, {
                    ...serverSubmission,
                    markingLock: null
                });
            }
        }
    } catch (error) {
        console.warn('Failed to release marking lease:', error);
    } finally {
        stopMarkingLeaseHeartbeat();
    }
}

async function closeAdminMarkingModal() {
    await releaseMarkingLease();
    document.getElementById('markingModal')?.classList.add('hidden');
}

function validateActiveMarkingModalLock() {
    const activeSubId = window.ACTIVE_MARKING_SUBMISSION_ID;
    const modal = document.getElementById('markingModal');
    if (!activeSubId || !modal || modal.classList.contains('hidden')) return;

    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const sub = subs.find(s => s.id === activeSubId);
    const activeLock = getActiveMarkingLock(sub);
    if (activeLock && !isOwnMarkingLock(activeLock)) {
        setMarkingInputsDisabled(true);
        updateMarkingLeaseBanner(`<i class="fas fa-lock"></i> ${activeLock.marker || 'Another admin'} took over this marking session from the server. Reopen the submission to continue safely.`, 'danger');
    } else {
        setMarkingInputsDisabled(false);
        updateMarkingLeaseBanner(`<i class="fas fa-shield-alt"></i> Reserved for you. Other admins will see this submission as locked while you mark.`, 'success');
    }
}

function addMarkingAuditEntry(submission, action, score) {
    if (!submission) return;
    const audit = Array.isArray(submission.markingAudit) ? submission.markingAudit : [];
    audit.push({
        action,
        score,
        marker: getCurrentMarkerName(),
        timestamp: new Date().toISOString()
    });
    submission.markingAudit = audit.slice(-25);
}

function renderMarkingAuditTrail(submission) {
    const audit = Array.isArray(submission?.markingAudit) ? submission.markingAudit.slice(-5).reverse() : [];
    if (audit.length === 0) return '<div class="marking-audit-empty">No marking changes recorded yet.</div>';
    return audit.map(entry => `
        <div class="marking-audit-entry">
            <strong>${entry.action || 'Updated'}</strong>
            <span>${entry.marker || 'Unknown'} &bull; ${entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'No time'} &bull; ${entry.score ?? '-'}%</span>
        </div>
    `).join('');
}

async function confirmSubmissionStillFreshForMarking(localSubmission, actionLabel = 'mark this submission') {
    if (!window.supabaseClient || !localSubmission?.id) return true;

    try {
        const { data, error } = await window.supabaseClient
            .from('submissions')
            .select('data')
            .eq('id', localSubmission.id)
            .single();

        if (error || !data?.data) return true;

        const serverSubmission = data.data;
        const activeLock = getActiveMarkingLock(serverSubmission);
        if (activeLock && !isOwnMarkingLock(activeLock)) {
            applyServerSubmissionLocally(serverSubmission);
            alert(`${activeLock.marker || 'Another admin'} is already marking this submission. I refreshed the local copy instead of ${actionLabel}.`);
            if (typeof loadMarkingQueue === 'function') loadMarkingQueue();
            return false;
        }

        const serverTime = getSubmissionEditTime(serverSubmission);
        const localTime = getSubmissionEditTime(localSubmission);
        const serverMarker = serverSubmission.lastEditedBy || serverSubmission.modifiedBy || 'another marker';

        if (serverTime > localTime) {
            applyServerSubmissionLocally(serverSubmission);
            alert(`This submission was already changed by ${serverMarker} after your local copy loaded. I refreshed the local copy instead of ${actionLabel}. Please reopen it and review the latest server version.`);
            if (typeof loadMarkingQueue === 'function') loadMarkingQueue();
            if (typeof loadCompletedHistory === 'function') loadCompletedHistory();
            return false;
        }
    } catch (error) {
        console.warn('Submission freshness check failed, continuing with local data.', error);
    }

    return true;
}

// QUICK APPROVE
async function approveSubmission(subId) {
    // ARCHITECTURAL FIX: RACE CONDITION PREVENTION
    if (window._isApproving === subId) return;
    window._isApproving = subId;

    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const sub = subs.find(s => s.id === subId);
    if (!sub) {
        window._isApproving = null;
        return;
    }

    const claimed = await claimMarkingLease(subId, 'quick_approve');
    if (!claimed) {
        window._isApproving = null;
        return;
    }

    const isFresh = await confirmSubmissionStillFreshForMarking(sub, 'quick approving it');
    if (!isFresh) {
        window._isApproving = null;
        await releaseMarkingLease(subId);
        return;
    }

    const markerName = getCurrentMarkerName();
    const editTime = new Date().toISOString();

    // 1. Mark as Completed
    sub.status = 'completed';
    sub.archived = false; // Ensure it appears in History
    sub.lastEditedBy = markerName;
    sub.lastEditedDate = editTime;
    sub.lastModified = editTime;
    sub.modifiedBy = markerName;
    sub.markingLock = null;
    addMarkingAuditEntry(sub, 'Quick approve', sub.score);
    localStorage.setItem('submissions', JSON.stringify(subs));

    // 2. Create Permanent Record
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    let targetGroup = 'Manual-Upload';
    
    for (const [gid, members] of Object.entries(rosters)) {
        if (members.some(m => m.toLowerCase() === sub.trainee.toLowerCase())) {
            targetGroup = gid;
            break;
        }
    }

    let cycleVal = 'New Onboard';
    if(typeof getTraineeCycle === 'function') {
        cycleVal = getTraineeCycle(sub.trainee, targetGroup);
    }

    const recs = JSON.parse(localStorage.getItem('records') || '[]');
    const phaseVal = sub.testTitle.toLowerCase().includes('vetting') ? 'Vetting' : 'Assessment';
    const recordId = buildRecordIdForSubmission(sub);

    const existingIdx = recs.findIndex(r =>
        r.submissionId === sub.id ||
        r.id === recordId
    );

    const newRecord = {
        id: recordId,
        trainee: sub.trainee,
        assessment: sub.testTitle,
        score: sub.score,
        date: sub.date,
        phase: phaseVal,
        cycle: cycleVal,
        groupID: targetGroup,
        docSaved: true,
        videoSaved: false,
        link: 'Digital-Assessment',
        submissionId: sub.id,
        createdAt: editTime,
        lastModified: editTime,
        modifiedBy: markerName
    };

    if (existingIdx > -1) {
        recs[existingIdx].score = sub.score;
        recs[existingIdx].date = sub.date;
        recs[existingIdx].cycle = cycleVal;
        recs[existingIdx].docSaved = true;
        recs[existingIdx].submissionId = sub.id;
        recs[existingIdx].lastModified = newRecord.lastModified;
        recs[existingIdx].modifiedBy = markerName;
        if(!recs[existingIdx].id) recs[existingIdx].id = newRecord.id;
    } else {
        recs.push(newRecord);
    }

    localStorage.setItem('records', JSON.stringify(recs));
    
    try {
        if (typeof saveToServer === 'function') await saveToServer(['submissions', 'records'], true);
    } catch (error) {
        console.error("Quick approve sync failed:", error);
        window._isApproving = null;
        alert("The approval was saved locally, but it could not sync to the server. Please check connection before approving more submissions.");
        return;
    }
    
    alert("Approved & Recorded.");
    stopMarkingLeaseHeartbeat();
    loadMarkingQueue();
    if(typeof loadTestRecords === 'function') loadTestRecords();
    if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();

    setTimeout(() => { window._isApproving = null; }, 1000); // Release lock
}

// DETAILED MARKING (Modal)
async function openAdminMarking(subId, options = {}) {
    if (CURRENT_USER?.role === 'trainee') {
        alert("Access denied. Trainees cannot open marked scripts after review.");
        return;
    }

    let subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    let sub = subs.find(s => s.id === subId);
    if (!sub) return alert("Error: Submission data not found.");

    const canEdit = CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin';
    const shouldClaim = options.claim !== false && canEdit;
    if (shouldClaim) {
        const claimed = await claimMarkingLease(subId, sub.status === 'completed' ? 'history_edit' : 'detailed_marking');
        if (!claimed) return;
        subs = JSON.parse(localStorage.getItem('submissions') || '[]');
        sub = subs.find(s => s.id === subId) || sub;
    }

    // SNAPSHOT LOGIC: STRICTLY use saved test definition if available (Historical accuracy)
    let test = sub.testSnapshot;
    
    if (!test || !test.questions) {
        const tests = JSON.parse(localStorage.getItem('tests') || '[]');
        test = tests.find(t => t.id == sub.testId); 
    }

    if(!test) return alert("Original Assessment definition seems to be deleted.");

    const modal = document.getElementById('markingModal');
    const container = document.getElementById('markingContainer');
    modal.classList.remove('hidden');
    
    const isLocked = sub.status === 'completed' && CURRENT_USER.role !== 'admin' && CURRENT_USER.role !== 'super_admin';

    container.innerHTML = `
        <div class="marking-workbench-header">
            <div>
                <div class="marking-eyebrow">Assessment Workbench</div>
                <h2 style="margin:0;">${sub.trainee}</h2>
                <p style="color:var(--primary); font-weight:bold; margin:5px 0;">${sub.testTitle}</p>
                <div class="marking-meta-row">
                    <span><i class="fas fa-calendar-alt"></i> ${sub.date || 'No date'}</span>
                    <span><i class="fas fa-star"></i> Current score: ${sub.score || 0}%</span>
                    ${getMarkingLockBadgeHTML(sub)}
                </div>
            </div>
            <button class="btn-secondary" onclick="printAssessmentView()"><i class="fas fa-print"></i> Print</button>
        </div>
        <div id="markingLeaseBanner" class="marking-lease-banner hidden"></div>
        <div class="marking-workbench-grid">
            <div class="marking-question-stack" id="markingQuestionStack"></div>
            <aside class="marking-side-panel">
                <div class="marking-side-card">
                    <div class="marking-side-label">Marker Safety</div>
                    <p>Opening this review reserves it for you through the realtime tunnel. Other admins see it as locked while the lease is active.</p>
                </div>
                <div class="marking-side-card">
                    <div class="marking-side-label">Audit Trail</div>
                    <div id="markingAuditTrail">${renderMarkingAuditTrail(sub)}</div>
                </div>
            </aside>
        </div>
    `;
    const questionStack = document.getElementById('markingQuestionStack');

    test.questions.forEach((q, idx) => {
        // FIX: Use original index if available (handles shuffled snapshots), else loop index
        const lookupIdx = (q._originalIndex !== undefined) ? q._originalIndex : idx;
        
        // Robust retrieval: try lookupIdx as number and string
        let userAns = undefined;
        if (sub.answers) {
            userAns = sub.answers[lookupIdx];
            if (userAns === undefined) userAns = sub.answers[String(lookupIdx)];
        }
        
        const pointsMax = parseFloat(q.points || 1);
        let markHtml = '';
        let autoScore = 0;
        if (typeof calculateQuestionAutoScore === 'function') {
            autoScore = calculateQuestionAutoScore(q, userAns).score;
        }
        
        const noteText = q.adminNotes || 'No note added';
        const editBtn = `<button class="btn-secondary btn-sm" onclick="editMarkerNote('${sub.testId}', ${lookupIdx}, '${sub.id}')" style="margin-left:10px; padding:2px 6px; font-size:0.7rem;"><i class="fas fa-edit"></i> Edit Note</button>`;
        let adminNoteHtml = `<div style="margin-bottom:10px; padding:8px; background:rgba(243, 112, 33, 0.1); border-left:3px solid var(--primary); font-size:0.85rem; color:var(--text-main);"><strong><i class="fas fa-info-circle"></i> Marker Note:</strong> <span id="marker-note-text-${lookupIdx}">${noteText}</span> ${editBtn}</div>`;
        const reviewSubject = String(q.reviewSubject || '').trim();
        const safeReviewSubject = reviewSubject
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;')
            .replace(/'/g, '&#39;');
        const reviewSubjectHtml = reviewSubject
            ? `<div style="margin-bottom:10px; padding:8px; background:rgba(52, 152, 219, 0.08); border-left:3px solid #3498db; font-size:0.85rem; color:var(--text-main);"><strong><i class="fas fa-route"></i> Review Subject:</strong> ${safeReviewSubject}</div>`
            : '';
        
        const refBtn = q.imageLink ? `<button class="btn-secondary btn-sm" onclick="openReferenceViewer('${q.imageLink}')" style="float:right; margin-left:10px;"><i class="fas fa-image"></i> View Reference</button>` : '';

        // Comment/Note Logic (Shared for ALL types)
        const currentComment = (sub.comments && sub.comments[idx]) ? sub.comments[idx] : '';
        const commentHtml = `
            <div style="margin-top:10px;">
                <label style="font-size:0.8rem; color:var(--text-muted);">Trainer Note / Comment:</label>
                <textarea class="q-comment" data-idx="${idx}" placeholder="Add feedback..." spellcheck="true" style="width:100%; height:50px; font-size:0.85rem; margin-top:5px; border:1px solid var(--border-color); background:var(--bg-card); color:var(--text-main);" ${isLocked ? 'disabled' : ''}>${currentComment}</textarea>
            </div>
        `;

        if (q.type === 'text' || q.type === 'live_practical') {
            markHtml = `
                <div style="background:var(--bg-input); padding:15px; border-radius:8px; margin-top:10px; border:1px solid var(--border-color); text-align:left;">
                    <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:5px;">MODEL ANSWER:</div>
                    <div style="margin-bottom:10px; font-style:italic; opacity:0.8;">${q.modelAnswer || 'N/A'}</div>
                    
                    <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:5px;">AGENT RESPONSE:</div>
                    <div style="white-space:pre-wrap; margin-bottom:15px; font-weight:500;">${userAns || '<i>(No response)</i>'}</div>
                    
                    ${(() => {
                        let val = 0;
                        if (sub.scores && sub.scores[idx] !== undefined && sub.scores[idx] !== null) {
                            val = sub.scores[idx];
                        } else {
                            val = 0; 
                        }
                        return `
                    <div style="display:flex; align-items:center; gap:10px; border-top:1px dashed var(--border-color); padding-top:10px;">
                        <label style="font-weight:bold;">Score (Max ${pointsMax}):</label>
                        <input type="number" class="q-mark" data-idx="${idx}" min="0" max="${pointsMax}" step="0.5" value="${val}" style="width:80px; padding:5px;" ${isLocked ? 'disabled' : ''}>
                    </div>`;
                    })()}
                    ${commentHtml}
                </div>`;
        } 
        else {
            let answerDisplay = `<div style="font-style:italic; color:var(--text-muted);">No Answer</div>`;
            
            if (q.type === 'matrix') {
                answerDisplay = '<div class="table-responsive"><table class="matrix-table" style="width:100%; text-align:center;"><thead><tr><th></th>';
                (q.cols || []).forEach(c => { answerDisplay += `<th>${c}</th>`; });
                answerDisplay += '</tr></thead><tbody>';
                (q.rows || []).forEach((r, rIdx) => {
                    answerDisplay += `<tr><td style="text-align:left; font-weight:bold;">${r}</td>`;
                    (q.cols || []).forEach((c, cIdx) => {
                        const isSelected = (userAns && userAns[rIdx] == cIdx);
                        const isCorrect = (q.correct && q.correct[rIdx] == cIdx);
                        let cellContent = '<i class="far fa-circle" style="color:var(--border-color); opacity:0.3;"></i>';
                        let cellStyle = '';
                        if (isSelected) {
                            if (isCorrect) {
                                cellContent = '<i class="fas fa-check-circle" style="color:#2ecc71; font-size:1.2rem;"></i>';
                                cellStyle = 'background:rgba(46, 204, 113, 0.1);';
                            } else {
                                cellContent = '<i class="fas fa-times-circle" style="color:#ff5252; font-size:1.2rem;"></i>';
                                cellStyle = 'background:rgba(255, 82, 82, 0.1);';
                            }
                        } else if (isCorrect) {
                            cellContent = '<i class="fas fa-check" style="color:#2ecc71; opacity:0.5;"></i>';
                            cellStyle = 'border: 2px dashed #2ecc71;';
                        }
                        answerDisplay += `<td style="${cellStyle}">${cellContent}</td>`;
                    });
                    answerDisplay += `</tr>`;
                });
                answerDisplay += '</tbody></table></div>';
            }
            else if (q.type === 'matching') {
                answerDisplay = '<div style="display:grid; gap:5px;">';
                (q.pairs || []).forEach((p, pIdx) => {
                    const uAns = (userAns && userAns[pIdx]) ? userAns[pIdx] : '---';
                    const isCorrect = uAns === p.right;
                    const color = isCorrect ? 'green' : 'red';
                    answerDisplay += `<div style="display:flex; justify-content:space-between; background:var(--bg-card); padding:5px; border-radius:4px;"><span>${p.left}</span> <span style="color:${color}; font-weight:bold;">${uAns}</span></div>`;
                });
                answerDisplay += '</div>';
            }
            else if (q.type === 'multiple_choice') {
                answerDisplay = (q.options || []).map((opt, oIdx) => {
                    const isSelected = Number(userAns) === Number(oIdx);
                    const isCorrect = Number(q.correct) === Number(oIdx);
                    let style = "";
                    if(isSelected) style = "font-weight:bold; color:var(--primary);";
                    if(isCorrect) style += " border:1px solid green;";
                    return `<div style="padding:5px; ${style}">${isSelected ? '&#9679;' : '&#9675;'} ${opt} ${isCorrect ? ' (Correct)' : ''}</div>`;
                }).join('');
            }
            else if (q.type === 'multi_select') {
                const selectedSet = new Set(Array.isArray(userAns) ? userAns.map(Number) : []);
                const correctSet = new Set((q.correct || []).map(Number));
                answerDisplay = (q.options || []).map((opt, oIdx) => {
                    const isSelected = selectedSet.has(Number(oIdx));
                    const isCorrect = correctSet.has(Number(oIdx));
                    return `<div style="padding:5px; ${isSelected ? 'color:var(--primary); font-weight:bold;' : ''}">${isSelected ? '&#9745;' : '&#9744;'} ${opt} ${isCorrect ? ' (Correct)' : ''}</div>`;
                }).join('');
            }
            else {
                answerDisplay = JSON.stringify(userAns);
            }

            let currentVal = autoScore;
            if (sub.scores && sub.scores[idx] !== undefined && sub.scores[idx] !== null) {
                currentVal = sub.scores[idx];
            } else if (sub.status === 'completed' && !sub.scores) {
                currentVal = Math.round(((sub.score || 0) / 100) * pointsMax * 2) / 2;
            }

            markHtml = `
                <div style="background:var(--bg-input); padding:10px; border-radius:6px; margin-top:5px; text-align:left;">
                    <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:5px;">AGENT RESPONSE:</div>
                    <div style="margin-bottom:15px;">${answerDisplay}</div>
                    <div style="margin-bottom:10px;"></div>
                    <div style="font-size:0.9rem; border-top:1px solid var(--border-color); padding-top:5px; font-weight:bold; display:flex; align-items:center; justify-content:space-between;">
                        ${!isLocked ? 
                            `<div style="display:flex; align-items:center; gap:10px; width:100%;">
                                <span style="margin-right:auto; color:var(--text-muted); font-weight:normal; font-size:0.8rem;">(Auto: ${autoScore})</span>
                                <label>Score:</label>
                                <input type="number" class="q-mark" data-idx="${idx}" min="0" max="${pointsMax}" step="0.5" value="${currentVal}" style="width:80px; padding:5px;">
                                <span style="color:var(--text-muted); font-weight:normal;">/ ${pointsMax}</span>
                             </div>` 
                            : 
                            `<span>Score: ${currentVal} / ${pointsMax}</span><input type="hidden" class="q-mark" data-idx="${idx}" value="${currentVal}">`
                        }
                    </div>
                    ${commentHtml}
                </div>`;
        }

        questionStack.innerHTML += `
            <div class="marking-item" style="margin-bottom:25px;">
                <div style="font-weight:600;">Q${idx + 1}: ${q.text} ${refBtn} <span style="float:right; font-size:0.8rem; color:var(--text-muted);">(${pointsMax} pts)</span></div>
                ${reviewSubjectHtml}${adminNoteHtml}${markHtml}
            </div>`;
    });

    const submitBtn = document.getElementById('markingSubmitBtn');
    if(isLocked) {
        submitBtn.style.display = 'none';
    } else {
        submitBtn.style.display = 'inline-block';
        submitBtn.innerText = sub.status === 'completed' ? "Save Changes" : "Finalize Score & Push to Records";
        submitBtn.onclick = () => finalizeAdminMarking(subId);
    }
    validateActiveMarkingModalLock();
}

function viewCompletedTest(submissionId, arg2, arg3) {
    if (CURRENT_USER?.role === 'trainee') {
        alert("Access denied. Trainees cannot view marked scripts after review.");
        return;
    }

    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    let mode = 'view';

    if (arg3 === 'view' || arg3 === 'edit') mode = arg3;
    else if (arg2 === 'view' || arg2 === 'edit') mode = arg2;

    const safeSubmissionId = String(submissionId || '').trim();
    if (!safeSubmissionId) {
        alert("This record is not linked to a submission ID.");
        return;
    }

    const sub = subs.find(s => s.id === safeSubmissionId);
    if(!sub) {
        alert(`Digital submission file not found for submission ID: ${safeSubmissionId}.`);
        return;
    }
    
    openAdminMarking(sub.id, { claim: mode !== 'view' });
    
    setTimeout(() => {
        const btn = document.getElementById('markingSubmitBtn');
        if(btn) btn.style.display = 'none';
    }, 50);
    
    if (mode === 'view') {
        setTimeout(() => {
            const btn = document.getElementById('markingSubmitBtn');
            if(btn) btn.style.display = 'none';
        }, 50);
    }
}

async function finalizeAdminMarking(subId) {
    if (!confirm("Save changes to scores? This will update the permanent record.")) return;

    if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
    }

    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const sub = subs.find(s => s.id === subId);
    if (!sub) return alert("Submission data not found.");

    const isFresh = await confirmSubmissionStillFreshForMarking(sub, 'finalizing your marking');
    if (!isFresh) return;

    const markerName = getCurrentMarkerName();
    const editTime = new Date().toISOString();

    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const test = tests.find(t => t.id == sub.testId);
    let maxScore = 0;
    if(test) test.questions.forEach(q => maxScore += parseFloat(q.points || 1));
    else maxScore = document.querySelectorAll('.q-mark').length;

    const markInputs = document.querySelectorAll('.q-mark');
    const commentInputs = document.querySelectorAll('.q-comment');
    let earnedPoints = 0;
    const specificScores = {}; 
    const specificComments = sub.comments || {};

    markInputs.forEach(input => {
        const val = parseFloat(input.value) || 0;
        earnedPoints += val;
        const idx = input.getAttribute('data-idx');
        if (idx !== null) specificScores[idx] = val;
    });
    
    commentInputs.forEach(input => {
        const idx = input.getAttribute('data-idx');
        if (idx !== null) specificComments[idx] = input.value;
    });

    const percentage = maxScore > 0 ? Math.round((earnedPoints / maxScore) * 100) : 0;
    const auditAction = sub.status === 'completed' ? 'Score updated' : 'Score finalized';

    sub.score = percentage;
    sub.status = 'completed';
    sub.archived = false; // UN-ARCHIVE when explicitly graded so it appears in History
    sub.scores = specificScores; 
    sub.comments = specificComments;
    
    sub.lastEditedBy = markerName;
    sub.lastEditedDate = editTime;
    sub.lastModified = editTime;
    sub.modifiedBy = markerName;
    sub.markingLock = null;
    addMarkingAuditEntry(sub, auditAction, percentage);

    localStorage.setItem('submissions', JSON.stringify(subs));

    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    let groupId = "Unknown";
    for (const [gid, members] of Object.entries(rosters)) {
        if (members.some(m => m.toLowerCase() === sub.trainee.toLowerCase())) { 
            groupId = gid; 
            break; 
        }
    }
    
    let cycleVal = 'Digital Onboard';
    if(typeof getTraineeCycle === 'function') cycleVal = getTraineeCycle(sub.trainee, groupId);
    const phaseVal = sub.testTitle.toLowerCase().includes('vetting') ? 'Vetting' : 'Assessment';

    const records = JSON.parse(localStorage.getItem('records') || '[]');
    const recordId = buildRecordIdForSubmission(sub);
    
    const existingIdx = records.findIndex(r =>
        r.submissionId === sub.id ||
        r.id === recordId
    );

    const newRecord = {
        id: recordId,
        groupID: groupId,
        trainee: sub.trainee,
        assessment: sub.testTitle,
        score: percentage,
        date: sub.date,
        phase: phaseVal,
        cycle: cycleVal,
        link: 'Digital-Assessment',
        docSaved: true,
        submissionId: sub.id, // Link to submission
        createdAt: editTime,
        lastModified: editTime,
        modifiedBy: markerName
    };

    if (existingIdx > -1) {
        records[existingIdx].score = percentage;
        records[existingIdx].date = sub.date;
        records[existingIdx].cycle = cycleVal;
        records[existingIdx].docSaved = true;
        records[existingIdx].submissionId = sub.id; // Ensure link is updated
        records[existingIdx].lastModified = newRecord.lastModified;
        records[existingIdx].modifiedBy = markerName;
        if(!records[existingIdx].id) records[existingIdx].id = newRecord.id;
    } else {
        records.push(newRecord);
    }
    
    localStorage.setItem('records', JSON.stringify(records));

    try {
        if (typeof saveToServer === 'function') await saveToServer(['submissions', 'records'], true);
    } catch (error) {
        console.error("Final marking sync failed:", error);
        alert("The marking was saved locally, but it could not sync to the server. Please check connection before closing this review.");
        return;
    }

    if(typeof showToast === 'function') showToast(`Marking Finalized! Trainee scored ${percentage}%`, "success");
    stopMarkingLeaseHeartbeat();
    document.getElementById('markingModal').classList.add('hidden');
    
    loadMarkingQueue();
    loadAssessmentDashboard();
    if (typeof renderMonthly === 'function') renderMonthly();
    if (typeof loadTestRecords === 'function') loadTestRecords();
    if (typeof loadCompletedHistory === 'function') loadCompletedHistory();
}

// --- PRINT HELPER ---
function printAssessmentView() {
    document.body.classList.add('printing-modal');
    window.print();
    document.body.classList.remove('printing-modal');
}

// --- NEW: LIVE MARKER NOTE EDITOR ---
window.editMarkerNote = async function(testId, qIdx, subId = null) {
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const test = tests.find(t => t.id == testId);
    
    if (!test || !test.questions[qIdx]) return alert("Master test or question not found.");
    
    const currentNote = test.questions[qIdx].adminNotes || '';
    const newNote = await customPrompt("Edit Marker Note", "Update the admin note for this question. This will update the master test template for everyone.", currentNote);
    
    if (newNote === null) return; // Cancelled
    
    // 1. Update Master Test
    test.questions[qIdx].adminNotes = newNote;
    test.questions[qIdx].adminNotesUpdated = Date.now();
    test.lastModified = new Date().toISOString();
    if (typeof CURRENT_USER !== 'undefined') test.modifiedBy = CURRENT_USER.user;
    
    localStorage.setItem('tests', JSON.stringify(tests));
    
    // 2. Update Submission Snapshot (if marking an existing submission)
    if (subId) {
        const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
        const sub = subs.find(s => s.id === subId);
        if (sub && sub.testSnapshot && sub.testSnapshot.questions[qIdx]) {
            sub.testSnapshot.questions[qIdx].adminNotes = newNote;
            sub.testSnapshot.questions[qIdx].adminNotesUpdated = Date.now();
            localStorage.setItem('submissions', JSON.stringify(subs));
        }
    }
    
    // 3. UI Update (Optimistic visual refresh)
    const span = document.getElementById(`marker-note-text-${qIdx}`);
    if (span) {
        span.innerText = newNote || 'No note added';
        span.style.color = '#2ecc71';
        setTimeout(() => span.style.color = '', 1500);
    }
    
    // 4. Cloud Sync (Safe Merge to invoke timestamp checks)
    if (typeof saveToServer === 'function') {
        const keysToSync = subId ? ['tests', 'submissions'] : ['tests'];
        saveToServer(keysToSync, false);
    }
    
    if (typeof showToast === 'function') showToast("Marker note updated globally.", "success");
};


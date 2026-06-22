/* ================= MANUAL ASSESSMENT ASSIGNMENTS ================= */
const MANUAL_ASSESSMENT_ASSIGNMENTS_KEY = 'manual_assessment_assignments';

function manualAssignmentParse(raw, fallback) {
    try {
        if (raw === null || raw === undefined || raw === '' || raw === 'undefined' || raw === 'null') return fallback;
        return JSON.parse(raw);
    } catch (error) {
        return fallback;
    }
}

function manualAssignmentReadArray(key) {
    const parsed = manualAssignmentParse(localStorage.getItem(key), []);
    return Array.isArray(parsed) ? parsed : [];
}

function manualAssignmentReadObject(key) {
    const parsed = manualAssignmentParse(localStorage.getItem(key), {});
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function manualAssignmentEsc(value) {
    if (typeof escapeHTML === 'function') return escapeHTML(value);
    return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function manualAssignmentIdentity(value) {
    return String(value || '').trim().toLowerCase();
}

function manualAssignmentCurrentUserName() {
    return String((window.CURRENT_USER && window.CURRENT_USER.user) || (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.user) || '').trim();
}

function manualAssignmentMakeId(prefix = 'manual_assess') {
    const rand = (window.crypto && typeof window.crypto.randomUUID === 'function')
        ? window.crypto.randomUUID().replace(/-/g, '').slice(0, 12)
        : Math.random().toString(36).slice(2, 14);
    return `${prefix}_${Date.now()}_${rand}`;
}

function getManualAssessmentAssignments() {
    return manualAssignmentReadArray(MANUAL_ASSESSMENT_ASSIGNMENTS_KEY)
        .filter(item => item && typeof item === 'object')
        .map(item => ({
            ...item,
            id: String(item.id || manualAssignmentMakeId()).trim(),
            type: String(item.type || '').trim(),
            targetTrainee: String(item.targetTrainee || item.trainee || '').trim(),
            targetId: String(item.targetId || item.testId || item.generatorId || '').trim(),
            title: String(item.title || item.assessment || item.testTitle || '').trim(),
            status: String(item.status || 'active').trim() || 'active'
        }));
}

function setManualAssessmentAssignments(assignments) {
    const rows = Array.isArray(assignments) ? assignments : [];
    localStorage.setItem(MANUAL_ASSESSMENT_ASSIGNMENTS_KEY, JSON.stringify(rows));
    if (typeof emitDataChange === 'function') emitDataChange(MANUAL_ASSESSMENT_ASSIGNMENTS_KEY, 'manual_assignment');
    if (typeof updateNotifications === 'function') updateNotifications();
}

async function syncManualAssessmentAssignmentRowOnServer(assignment) {
    if (!window.supabaseClient || !assignment?.id) return false;
    const row = {
        id: assignment.id,
        data: assignment,
        trainee: assignment.targetTrainee || assignment.trainee || null,
        updated_at: new Date().toISOString()
    };
    const { error } = await window.supabaseClient.from('manual_assessment_assignments').upsert(row);
    if (error) throw error;
    return true;
}

function getManualAssignmentsForTrainee(trainee, type = '') {
    const traineeKey = manualAssignmentIdentity(trainee || manualAssignmentCurrentUserName());
    const typeKey = String(type || '').trim();
    if (!traineeKey) return [];
    return getManualAssessmentAssignments()
        .filter(item => item.status !== 'archived' && item.status !== 'cancelled')
        .filter(item => manualAssignmentIdentity(item.targetTrainee) === traineeKey)
        .filter(item => !typeKey || String(item.type || '') === typeKey)
        .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
}

function getManualAssignmentById(id) {
    const cleanId = String(id || '').trim();
    if (!cleanId) return null;
    return getManualAssessmentAssignments().find(item => String(item.id || '') === cleanId) || null;
}

function markManualAssessmentAssignmentStarted(id) {
    const cleanId = String(id || '').trim();
    if (!cleanId) return null;
    const rows = getManualAssessmentAssignments();
    const idx = rows.findIndex(item => String(item.id || '') === cleanId);
    if (idx < 0) return null;
    if (String(rows[idx].status || '') === 'active') rows[idx].status = 'in_progress';
    rows[idx].startedAt = rows[idx].startedAt || new Date().toISOString();
    rows[idx].updatedAt = new Date().toISOString();
    setManualAssessmentAssignments(rows);
    return rows[idx];
}

function markManualAssessmentAssignmentSubmitted(id, submissionId) {
    const cleanId = String(id || '').trim();
    if (!cleanId) return null;
    const rows = getManualAssessmentAssignments();
    const idx = rows.findIndex(item => String(item.id || '') === cleanId);
    if (idx < 0) return null;
    rows[idx].status = 'submitted';
    rows[idx].submissionId = String(submissionId || rows[idx].submissionId || '').trim();
    rows[idx].submittedAt = rows[idx].submittedAt || new Date().toISOString();
    rows[idx].updatedAt = new Date().toISOString();
    setManualAssessmentAssignments(rows);
    return rows[idx];
}

function manualAssignmentGetTrainees() {
    const names = new Set();
    manualAssignmentReadArray('users').forEach(user => {
        const name = String(user && (user.user || user.name || user.username) || '').trim();
        const role = String(user && user.role || '').toLowerCase();
        if (name && (!role || role === 'trainee')) names.add(name);
    });
    Object.values(manualAssignmentReadObject('rosters')).forEach(members => {
        (Array.isArray(members) ? members : []).forEach(name => {
            const clean = String(name || '').trim();
            if (clean) names.add(clean);
        });
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function manualAssignmentGetOptions(filterType = '') {
    const cleanFilter = String(filterType || '').trim();
    const testOptions = manualAssignmentReadArray('tests')
        .filter(test => test && test.id && String(test.type || 'standard').toLowerCase() !== 'vetting')
        .map(test => ({
            value: `test_engine|${test.id}`,
            label: `Test Engine | ${test.title || test.name || test.id}`,
            title: String(test.title || test.name || test.id || '').trim()
        }));
    const studio = manualAssignmentReadObject('assessment_studio_data');
    const studioOptions = (Array.isArray(studio.generators) ? studio.generators : [])
        .filter(generator => generator && generator.id && generator.status !== 'archived')
        .map(generator => ({
            value: `assessment_studio|${generator.id}`,
            label: `Assessment Studio | ${generator.assessment || generator.title || generator.id}`,
            title: String(generator.assessment || generator.title || generator.id || '').trim()
        }));
    const options = cleanFilter === 'assessment_studio'
        ? studioOptions
        : cleanFilter === 'test_engine'
            ? testOptions
            : [...testOptions, ...studioOptions];
    return options.sort((a, b) => a.label.localeCompare(b.label));
}

function renderManualAssessmentPushPanel(config = {}) {
    const mode = String(config.mode || '').trim();
    const assessmentFirst = !!config.assessmentFirst;
    const trainees = manualAssignmentGetTrainees();
    const options = manualAssignmentGetOptions(mode);
    const recent = getManualAssessmentAssignments().slice(0, 6);
    const title = config.title || 'Manual Assessment Push';
    const description = config.description || 'Assign a catch-up Test Engine or Assessment Studio assessment directly to one trainee.';
    const assessmentLabel = mode === 'assessment_studio' ? 'Assessment Studio Test' : 'Assessment';
    const buttonLabel = config.buttonLabel || 'Push Assignment';
    const assessmentControl = `
        <label>${manualAssignmentEsc(assessmentLabel)}
            <select id="manualAssignmentTarget">
                <option value="">Select assessment...</option>
                ${options.map(option => `<option value="${manualAssignmentEsc(option.value)}" data-title="${manualAssignmentEsc(option.title)}">${manualAssignmentEsc(option.label)}</option>`).join('')}
            </select>
        </label>
    `;
    const traineeControl = `
        <label>Trainee
            <select id="manualAssignmentTrainee">
                <option value="">Select trainee...</option>
                ${trainees.map(name => `<option value="${manualAssignmentEsc(name)}">${manualAssignmentEsc(name)}</option>`).join('')}
            </select>
        </label>
    `;
    return `
        <div class="card manual-assignment-card">
            <div class="manual-assignment-head">
                <div>
                    <h3 style="margin:0;">${manualAssignmentEsc(title)}</h3>
                    <p style="margin:4px 0 0; color:var(--text-muted); font-size:0.9rem;">${manualAssignmentEsc(description)}</p>
                </div>
            </div>
            <div class="manual-assignment-grid ${assessmentFirst ? 'manual-assignment-grid--assessment-first' : ''}">
                ${assessmentFirst ? assessmentControl + traineeControl : traineeControl + assessmentControl}
                <label>Note
                    <input id="manualAssignmentNote" placeholder="Optional note for trainee">
                </label>
                <button class="btn-primary" onclick="pushManualAssessmentAssignment()"><i class="fas fa-paper-plane"></i> ${manualAssignmentEsc(buttonLabel)}</button>
            </div>
            <div class="manual-assignment-recent">
                ${recent.length ? recent.map(item => `
                    <span class="manual-assignment-pill">
                        ${manualAssignmentEsc(item.targetTrainee)} - ${manualAssignmentEsc(item.title || item.targetId)} (${manualAssignmentEsc(item.status)})
                    </span>
                `).join('') : '<span style="color:var(--text-muted); font-size:0.85rem;">No manual assignments yet.</span>'}
            </div>
        </div>
    `;
}

function mountManualAssessmentPushPanel(config = {}) {
    const hostId = String(config.hostId || 'manualAssessmentPushPanel');
    const host = document.getElementById(hostId);
    if (!host) return;
    window.__manualAssessmentPanelConfig = { ...config, hostId };
    if (!window.CURRENT_USER || !['admin', 'super_admin'].includes(String(window.CURRENT_USER.role || '').toLowerCase())) {
        host.innerHTML = '';
        return;
    }
    host.innerHTML = renderManualAssessmentPushPanel(config);
}

async function pushManualAssessmentAssignment() {
    const trainee = String(document.getElementById('manualAssignmentTrainee')?.value || '').trim();
    const target = String(document.getElementById('manualAssignmentTarget')?.value || '').trim();
    const note = String(document.getElementById('manualAssignmentNote')?.value || '').trim();
    if (!trainee || !target) {
        if (typeof showToast === 'function') showToast('Choose a trainee and assessment to push.', 'warning');
        return false;
    }
    const [type, targetId] = target.split('|');
    if (!type || !targetId) return false;
    const selected = document.getElementById('manualAssignmentTarget')?.selectedOptions?.[0];
    const title = String(selected?.dataset?.title || selected?.textContent || targetId).replace(/^.*?\|\s*/, '').trim();
    const now = new Date().toISOString();
    const rows = getManualAssessmentAssignments();
    const assignment = {
        id: manualAssignmentMakeId('manual_assess'),
        type,
        targetId,
        title,
        targetTrainee: trainee,
        note,
        status: 'active',
        source: 'manual_push',
        createdBy: String(window.CURRENT_USER?.user || ''),
        createdAt: now,
        updatedAt: now
    };
    rows.unshift(assignment);
    setManualAssessmentAssignments(rows);

    const notifications = manualAssignmentReadArray('admin_notifications');
    notifications.unshift({
        id: `manual_assignment_${assignment.id}`,
        type: 'manual_assessment_assignment',
        source: 'manual_assignment',
        title: 'Assessment Assigned',
        message: `${title} was assigned to you as a catch-up assessment.`,
        targetUsers: [trainee],
        assignmentId: assignment.id,
        assessmentType: type,
        targetId,
        createdAt: now,
        updatedAt: now,
        status: 'open'
    });
    localStorage.setItem('admin_notifications', JSON.stringify(notifications.slice(0, 250)));

    if (typeof saveToServer === 'function') {
        let directSynced = false;
        try {
            directSynced = await syncManualAssessmentAssignmentRowOnServer(assignment);
        } catch (error) {
            console.warn('Manual assignment direct row sync failed:', error);
        }
        const ok = directSynced
            ? await saveToServer(['admin_notifications', MANUAL_ASSESSMENT_ASSIGNMENTS_KEY], false, true)
            : await saveToServer([MANUAL_ASSESSMENT_ASSIGNMENTS_KEY, 'admin_notifications'], true, true);
        if (ok === false) {
            if (typeof showToast === 'function') showToast('Assignment saved locally, but Supabase did not confirm. Retry sync before relying on it.', 'error');
            return false;
        }
    }
    if (window.__manualAssessmentPanelConfig) mountManualAssessmentPushPanel(window.__manualAssessmentPanelConfig);
    else mountManualAssessmentPushPanel();
    if (typeof showToast === 'function') showToast('Manual assessment pushed to trainee.', 'success');
    return true;
}

function getCurrentUserManualAssessmentNotifications() {
    return getManualAssignmentsForTrainee(manualAssignmentCurrentUserName())
        .filter(item => ['active', 'in_progress'].includes(String(item.status || 'active')));
}

function openManualAssessmentAssignment(id) {
    const assignment = getManualAssignmentById(id);
    if (!assignment) {
        if (typeof showToast === 'function') showToast('Manual assessment assignment could not be found. Refresh and try again.', 'error');
        return false;
    }
    if (String(assignment.type) === 'test_engine') {
        if (typeof openTestTaker !== 'function') return false;
        return openTestTaker(assignment.targetId, false, {
            bypassSchedule: true,
            returnTab: 'my-tests',
            manualAssignment: assignment
        });
    }
    if (String(assignment.type) === 'assessment_studio') {
        if (typeof openAssessmentStudioFromManualAssignment === 'function') return openAssessmentStudioFromManualAssignment(assignment.id);
        if (typeof openAssessmentStudioFromSchedule === 'function') return openAssessmentStudioFromSchedule(assignment.targetId, { manualAssignmentId: assignment.id, courseName: assignment.title });
    }
    return false;
}

window.MANUAL_ASSESSMENT_ASSIGNMENTS_KEY = MANUAL_ASSESSMENT_ASSIGNMENTS_KEY;
window.getManualAssessmentAssignments = getManualAssessmentAssignments;
window.getManualAssignmentsForTrainee = getManualAssignmentsForTrainee;
window.getManualAssignmentById = getManualAssignmentById;
window.markManualAssessmentAssignmentStarted = markManualAssessmentAssignmentStarted;
window.markManualAssessmentAssignmentSubmitted = markManualAssessmentAssignmentSubmitted;
window.syncManualAssessmentAssignmentRowOnServer = syncManualAssessmentAssignmentRowOnServer;
window.mountManualAssessmentPushPanel = mountManualAssessmentPushPanel;
window.pushManualAssessmentAssignment = pushManualAssessmentAssignment;
window.getCurrentUserManualAssessmentNotifications = getCurrentUserManualAssessmentNotifications;
window.openManualAssessmentAssignment = openManualAssessmentAssignment;

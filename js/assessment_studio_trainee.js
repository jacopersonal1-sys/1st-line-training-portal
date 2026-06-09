/* ================= ASSESSMENT STUDIO TRAINEE RUNTIME ================= */

const AST_TRAINEE_DATA_KEY = 'assessment_studio_data';
const AST_TRAINEE_LOCAL_KEY = 'assessment_studio_data_local';

const AST_TRAINEE_TYPES = [
    { key: 'multiple_choice', label: 'Multiple Choice' },
    { key: 'multi_select', label: 'Multiple Answer' },
    { key: 'text', label: 'Text Answer' },
    { key: 'matching', label: 'Matching / Pairs' },
    { key: 'ranking', label: 'Ranking Order' },
    { key: 'matrix', label: 'Matrix / Grid' }
];

let AST_ACTIVE_SUBMISSION_ID = '';

function astTraineeEsc(value) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function astTraineeParse(raw, fallback) {
    try {
        if (raw === null || raw === undefined || raw === '' || raw === 'undefined' || raw === 'null') return fallback;
        const parsed = JSON.parse(raw);
        return parsed === undefined || parsed === null ? fallback : parsed;
    } catch (error) {
        return fallback;
    }
}

function astTraineeMakeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function astTraineeNormalize(value) {
    return String(value || '').trim().toLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function astTraineeIdentity(value) {
    return astTraineeNormalize(value).replace(/\s+/g, '');
}

function astTraineeCurrentUserName() {
    return String((window.CURRENT_USER && (CURRENT_USER.user || CURRENT_USER.username || CURRENT_USER.name)) || '').trim();
}

function astTraineeTypeLabel(type) {
    return (AST_TRAINEE_TYPES.find(item => item.key === type) || {}).label || type || 'Question';
}

function astTraineeDefaultStore() {
    return { questionBucket: [], generators: [], submissions: [], groupings: [], tags: [], updatedAt: null, updatedBy: null };
}

function astTraineeNormalizeQuestion(raw) {
    const q = raw && typeof raw === 'object' ? raw : {};
    const points = Number(q.points);
    return {
        ...q,
        id: String(q.id || q.bucketQuestionId || astTraineeMakeId('qb')).trim(),
        bucketQuestionId: String(q.bucketQuestionId || q.id || '').trim(),
        assessment: String(q.assessment || '').trim(),
        phase: String(q.phase || 'Assessment').trim(),
        type: String(q.type || 'multiple_choice').trim(),
        text: String(q.text || q.question || '').trim(),
        points: Number.isFinite(points) && points > 0 ? Math.round(points * 10) / 10 : 1,
        suggestedAnswer: String(q.suggestedAnswer || q.suggested_answer || '').trim(),
        grouping: String(q.grouping || q.group || '').trim(),
        options: Array.isArray(q.options) ? q.options.map(v => String(v || '').trim()).filter(Boolean) : [],
        pairs: Array.isArray(q.pairs) ? q.pairs.map(p => ({ left: String(p.left || '').trim(), right: String(p.right || '').trim() })).filter(p => p.left || p.right) : [],
        items: Array.isArray(q.items) ? q.items.map(v => String(v || '').trim()).filter(Boolean) : [],
        rows: Array.isArray(q.rows) ? q.rows.map(v => String(v || '').trim()).filter(Boolean) : [],
        cols: Array.isArray(q.cols) ? q.cols.map(v => String(v || '').trim()).filter(Boolean) : [],
        matrixCorrect: q.matrixCorrect || q.matrix_correct || q.correctMap || {},
        status: q.status === 'archived' ? 'archived' : 'active'
    };
}

function astTraineeNormalizeGenerator(raw) {
    const g = raw && typeof raw === 'object' ? raw : {};
    const totalPoints = Number(g.totalPoints || g.totalScore);
    const rawLeeway = g.pointLeeway ?? g.pointsLeeway ?? g.leeway;
    const pointLeeway = Number(rawLeeway);
    return {
        ...g,
        id: String(g.id || astTraineeMakeId('gen')).trim(),
        assessment: String(g.assessment || '').trim(),
        phase: String(g.phase || 'Assessment').trim(),
        totalPoints: Number.isFinite(totalPoints) && totalPoints > 0 ? Math.round(totalPoints * 10) / 10 : 100,
        allowedTypes: Array.isArray(g.allowedTypes) && g.allowedTypes.length ? g.allowedTypes.filter(Boolean) : ['multiple_choice', 'multi_select', 'text', 'matching', 'ranking', 'matrix'],
        groupLimits: g.groupLimits && typeof g.groupLimits === 'object' && !Array.isArray(g.groupLimits)
            ? Object.fromEntries(Object.entries(g.groupLimits).map(([key, value]) => [String(key || '').trim(), Math.max(0, Math.floor(Number(value || 0)))]).filter(([key]) => !!key))
            : {},
        pointLeeway: Number.isFinite(pointLeeway) && pointLeeway >= 0 ? Math.round(pointLeeway * 10) / 10 : 7,
        status: g.status === 'archived' ? 'archived' : 'active'
    };
}

function astTraineeNormalizeSubmission(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const snapshot = s.testSnapshot && typeof s.testSnapshot === 'object' ? s.testSnapshot : { questions: [] };
    const questions = Array.isArray(snapshot.questions) ? snapshot.questions.map(astTraineeNormalizeQuestion).filter(q => q.text) : [];
    const maxPoints = Number(s.maxPoints || snapshot.totalPoints || questions.reduce((sum, q) => sum + Number(q.points || 1), 0));
    return {
        ...s,
        id: String(s.id || astTraineeMakeId('ast_sub')).trim(),
        generatorId: String(s.generatorId || snapshot.generatorId || '').trim(),
        trainee: String(s.trainee || snapshot.generatedFor || '').trim(),
        groupID: String(s.groupID || '').trim(),
        assessment: String(s.assessment || snapshot.title || '').trim(),
        phase: String(s.phase || snapshot.phase || 'Assessment').trim(),
        status: String(s.status || 'assigned').trim(),
        feedbackStatus: String(s.feedbackStatus || 'none').trim() || 'none',
        testSnapshot: { ...snapshot, questions },
        answers: s.answers && typeof s.answers === 'object' ? s.answers : {},
        questionScores: s.questionScores && typeof s.questionScores === 'object' ? s.questionScores : {},
        maxPoints: Number.isFinite(maxPoints) && maxPoints > 0 ? Math.round(maxPoints * 10) / 10 : 0,
        earnedPoints: Number.isFinite(Number(s.earnedPoints)) ? Math.round(Number(s.earnedPoints) * 10) / 10 : 0,
        percent: Number.isFinite(Number(s.percent)) ? Number(s.percent) : 0,
        generatedAt: s.generatedAt || s.createdAt || new Date().toISOString(),
        submittedAt: s.submittedAt || null,
        updatedAt: s.updatedAt || s.submittedAt || s.generatedAt || new Date().toISOString()
    };
}

function astTraineeNormalizeStore(raw) {
    const base = raw && typeof raw === 'object' ? raw : astTraineeDefaultStore();
    return {
        questionBucket: Array.isArray(base.questionBucket) ? base.questionBucket.map(astTraineeNormalizeQuestion).filter(q => q.text) : [],
        generators: Array.isArray(base.generators) ? base.generators.map(astTraineeNormalizeGenerator).filter(g => g.assessment) : [],
        submissions: Array.isArray(base.submissions) ? base.submissions.map(astTraineeNormalizeSubmission).filter(s => s.trainee && s.assessment) : [],
        groupings: Array.isArray(base.groupings) ? base.groupings.map(item => ({
            id: String(item.id || astTraineeMakeId('grp')).trim(),
            name: String(item.name || item.label || '').trim(),
            createdAt: item.createdAt || new Date().toISOString(),
            updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
            updatedBy: item.updatedBy || 'System'
        })).filter(item => item.name) : [],
        tags: Array.isArray(base.tags) ? base.tags.map(item => ({
            id: String(item.id || astTraineeMakeId('tag')).trim(),
            name: String(item.name || item.label || '').trim(),
            createdAt: item.createdAt || new Date().toISOString(),
            updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
            updatedBy: item.updatedBy || 'System'
        })).filter(item => item.name) : [],
        updatedAt: base.updatedAt || new Date().toISOString(),
        updatedBy: base.updatedBy || 'System'
    };
}

function astTraineeMergeById(remoteItems, localItems, timeField = 'updatedAt') {
    const map = new Map();
    (Array.isArray(remoteItems) ? remoteItems : []).forEach(item => map.set(String(item.id), item));
    (Array.isArray(localItems) ? localItems : []).forEach(item => {
        const id = String(item.id);
        const current = map.get(id);
        if (!current || String(item[timeField] || item.updatedAt || '') >= String(current[timeField] || current.updatedAt || '')) {
            map.set(id, item);
        }
    });
    return Array.from(map.values());
}

function astTraineeSubmissionStatusRank(status) {
    const value = String(status || '').trim().toLowerCase();
    if (value === 'completed') return 4;
    if (value === 'pending_review') return 3;
    if (value === 'in_progress') return 2;
    if (value === 'assigned') return 1;
    return 0;
}

function astTraineePickSubmission(existing, incoming) {
    if (!existing) return incoming;
    const existingRank = astTraineeSubmissionStatusRank(existing.status);
    const incomingRank = astTraineeSubmissionStatusRank(incoming.status);
    if (incomingRank !== existingRank) return incomingRank > existingRank ? incoming : existing;
    const existingDate = existing.updatedAt || existing.gradedAt || existing.submittedAt || existing.generatedAt || '';
    const incomingDate = incoming.updatedAt || incoming.gradedAt || incoming.submittedAt || incoming.generatedAt || '';
    return String(incomingDate) >= String(existingDate) ? incoming : existing;
}

function astTraineeMergeSubmissions(remoteItems, localItems) {
    const map = new Map();
    (Array.isArray(remoteItems) ? remoteItems : []).forEach(item => {
        if (!item || typeof item !== 'object') return;
        const id = String(item.id || '');
        if (id) map.set(id, item);
    });
    (Array.isArray(localItems) ? localItems : []).forEach(item => {
        if (!item || typeof item !== 'object') return;
        const id = String(item.id || '');
        if (id) map.set(id, astTraineePickSubmission(map.get(id), item));
    });
    return Array.from(map.values());
}

function astTraineeGetStore() {
    const local = astTraineeNormalizeStore(astTraineeParse(localStorage.getItem(AST_TRAINEE_LOCAL_KEY), null));
    const canonical = astTraineeNormalizeStore(astTraineeParse(localStorage.getItem(AST_TRAINEE_DATA_KEY), null));
    return astTraineeNormalizeStore({
        questionBucket: astTraineeMergeById(canonical.questionBucket, local.questionBucket),
        generators: astTraineeMergeById(canonical.generators, local.generators),
        submissions: astTraineeMergeSubmissions(canonical.submissions, local.submissions),
        groupings: astTraineeMergeById(canonical.groupings, local.groupings),
        tags: astTraineeMergeById(canonical.tags, local.tags),
        updatedAt: local.updatedAt || canonical.updatedAt,
        updatedBy: local.updatedBy || canonical.updatedBy
    });
}

async function refreshAssessmentStudioTraineeStoreFromServer() {
    if (!window.supabaseClient || typeof window.supabaseClient.from !== 'function') return false;
    if (window.__AST_TRAINEE_REFRESHING) return false;
    window.__AST_TRAINEE_REFRESHING = true;
    try {
        const { data, error } = await window.supabaseClient
            .from('app_documents')
            .select('content, updated_at')
            .eq('key', AST_TRAINEE_DATA_KEY)
            .maybeSingle();
        if (error) throw error;
        if (data && data.content && typeof data.content === 'object') {
            const remote = astTraineeNormalizeStore(data.content);
            const local = astTraineeNormalizeStore(astTraineeParse(localStorage.getItem(AST_TRAINEE_LOCAL_KEY), null));
            const merged = astTraineeNormalizeStore({
                questionBucket: astTraineeMergeById(remote.questionBucket, local.questionBucket),
                generators: astTraineeMergeById(remote.generators, local.generators),
                submissions: astTraineeMergeSubmissions(remote.submissions, local.submissions),
                groupings: astTraineeMergeById(remote.groupings, local.groupings),
                tags: astTraineeMergeById(remote.tags, local.tags),
                updatedAt: remote.updatedAt || data.updated_at || new Date().toISOString(),
                updatedBy: remote.updatedBy || 'System'
            });
            localStorage.setItem(AST_TRAINEE_DATA_KEY, JSON.stringify(remote));
            localStorage.setItem(AST_TRAINEE_LOCAL_KEY, JSON.stringify(merged));
            return true;
        }
    } catch (error) {
        console.warn('[Assessment Studio Trainee] refresh failed:', error);
    } finally {
        window.__AST_TRAINEE_REFRESHING = false;
    }
    return false;
}

async function astTraineeSaveStore(store, forceSync = false) {
    const next = astTraineeNormalizeStore(store);
    next.updatedAt = new Date().toISOString();
    next.updatedBy = astTraineeCurrentUserName() || 'Trainee';
    localStorage.setItem(AST_TRAINEE_LOCAL_KEY, JSON.stringify(next));
    localStorage.setItem(AST_TRAINEE_DATA_KEY, JSON.stringify(next));

    if (typeof saveToServer === 'function') {
        try {
            await saveToServer([AST_TRAINEE_DATA_KEY], Boolean(forceSync), true);
            return next;
        } catch (error) {
            console.warn('[Assessment Studio Trainee] saveToServer failed:', error);
        }
    }

    if (window.supabaseClient && typeof window.supabaseClient.from === 'function') {
        try {
            await window.supabaseClient.from('app_documents').upsert({
                key: AST_TRAINEE_DATA_KEY,
                content: next,
                updated_at: new Date().toISOString()
            });
        } catch (error) {
            console.warn('[Assessment Studio Trainee] direct cloud save failed:', error);
        }
    }
    return next;
}

function astTraineeCreateFeedbackNotification(submission) {
    if (!submission || !submission.id) return;
    const notifications = astTraineeParse(localStorage.getItem('admin_notifications'), []);
    const list = Array.isArray(notifications) ? notifications : [];
    const now = new Date().toISOString();
    const id = `assessment_studio_feedback_${submission.id}`;
    const payload = {
        id,
        type: 'assessment_studio_feedback_request',
        source: 'assessment_studio',
        title: 'Assessment Studio Feedback Requested',
        message: `${submission.trainee || 'A trainee'} requested feedback for ${submission.assessment || 'an Assessment Studio test'}.`,
        trainee: submission.trainee || '',
        assessment: submission.assessment || '',
        submissionId: submission.id,
        targetRoles: ['admin', 'super_admin'],
        createdAt: submission.feedbackRequestedAt || now,
        updatedAt: now,
        status: 'open'
    };
    const idx = list.findIndex(item => item && String(item.id || '') === id);
    if (idx >= 0) list[idx] = { ...list[idx], ...payload };
    else list.push(payload);
    localStorage.setItem('admin_notifications', JSON.stringify(list));
}

function astTraineeFindGroup(trainee) {
    const rosters = astTraineeParse(localStorage.getItem('rosters'), {});
    const target = astTraineeIdentity(trainee);
    for (const [groupId, members] of Object.entries(rosters || {})) {
        if (Array.isArray(members) && members.some(name => astTraineeIdentity(name) === target)) return groupId;
    }
    return '';
}

function astTraineeShuffle(items, seedText) {
    const arr = [...items];
    let seed = 0;
    String(seedText || '').split('').forEach(ch => { seed = ((seed << 5) - seed + ch.charCodeAt(0)) | 0; });
    const rand = () => {
        seed = (seed * 1664525 + 1013904223) | 0;
        return ((seed >>> 0) / 4294967296);
    };
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function astTraineeGenerateSnapshot(store, generator, trainee, scheduleItem = {}) {
    const pool = store.questionBucket.filter(q =>
        q.status !== 'archived' &&
        astTraineeNormalize(q.assessment) === astTraineeNormalize(generator.assessment) &&
        generator.allowedTypes.includes(q.type)
    );
    if (!pool.length) throw new Error('No Assessment Studio bucket questions match this linked generator.');

    const existingSignatures = new Set(store.submissions
        .filter(s => astTraineeNormalize(s.assessment) === astTraineeNormalize(generator.assessment))
        .map(s => String(s.testSnapshot && s.testSnapshot.signature || '')));

    let picked = [];
    let signature = '';
    const targetPoints = Number(generator.totalPoints || 0);
    const leeway = Number.isFinite(Number(generator.pointLeeway)) ? Number(generator.pointLeeway) : 7;
    const minPoints = Math.max(0, targetPoints - leeway);
    const maxPoints = targetPoints + leeway;
    let best = null;
    for (let attempt = 0; attempt < 24; attempt++) {
        const shuffled = astTraineeShuffle(pool, `${trainee}|${generator.id}|${scheduleItem.courseName || ''}|${Date.now()}|${attempt}`);
        const candidate = [];
        let points = 0;
        const groupCounts = {};
        for (const q of shuffled) {
            const group = String(q.grouping || '').trim();
            const limit = group ? Number((generator.groupLimits || {})[group] || 0) : 0;
            if (limit > 0 && Number(groupCounts[group] || 0) >= limit) continue;
            const qPoints = Number(q.points || 1);
            if (points + qPoints > maxPoints && candidate.length) continue;
            candidate.push({ ...q, bucketQuestionId: q.id });
            if (group) groupCounts[group] = Number(groupCounts[group] || 0) + 1;
            points += qPoints;
            if (points >= minPoints) break;
        }
        const candidateSignature = candidate.map(q => q.id).sort().join('|');
        if (existingSignatures.has(candidateSignature)) continue;
        const inRange = points >= minPoints && points <= maxPoints;
        const distance = Math.abs(targetPoints - points);
        if (!best || (inRange && !best.inRange) || (inRange === best.inRange && distance < best.distance)) {
            best = { questions: candidate, signature: candidateSignature, points, inRange, distance };
        }
        if (inRange) break;
    }
    picked = best && best.questions ? best.questions : [];
    signature = best && best.signature ? best.signature : '';
    if (!picked.length) throw new Error('Assessment Studio could not select any questions.');

    return {
        id: astTraineeMakeId('snapshot'),
        title: generator.assessment,
        phase: generator.phase || 'Assessment',
        generatedFor: trainee,
        generatedAt: new Date().toISOString(),
        generatorId: generator.id,
        scheduleCourseName: scheduleItem.courseName || '',
        scheduleDateRange: scheduleItem.dateRange || '',
        signature,
        targetPoints,
        pointLeeway: leeway,
        totalPoints: picked.reduce((sum, q) => sum + Number(q.points || 1), 0),
        questions: picked
    };
}

async function ensureAssessmentStudioAssignmentForCurrentUser(generatorId, scheduleItem = {}) {
    const cleanGeneratorId = String(generatorId || '').trim();
    const trainee = astTraineeCurrentUserName();
    if (!cleanGeneratorId || !trainee) return null;

    const store = astTraineeGetStore();
    const existing = store.submissions.find(s =>
        String(s.generatorId || '') === cleanGeneratorId &&
        astTraineeIdentity(s.trainee) === astTraineeIdentity(trainee) &&
        String(s.status || '') !== 'archived'
    );
    if (existing) return existing;

    const generator = store.generators.find(g => String(g.id) === cleanGeneratorId && g.status !== 'archived');
    if (!generator) throw new Error('The linked Assessment Studio generator could not be found.');

    const snapshot = astTraineeGenerateSnapshot(store, generator, trainee, scheduleItem);
    const submission = astTraineeNormalizeSubmission({
        id: astTraineeMakeId('ast_sub'),
        generatorId: generator.id,
        trainee,
        groupID: astTraineeFindGroup(trainee),
        assessment: generator.assessment,
        phase: generator.phase || 'Assessment',
        status: 'assigned',
        feedbackStatus: 'none',
        testSnapshot: snapshot,
        maxPoints: snapshot.totalPoints,
        generatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });
    store.submissions.unshift(submission);
    await astTraineeSaveStore(store, true);
    return submission;
}

function getAssessmentStudioAssignmentsForCurrentUser() {
    const trainee = astTraineeCurrentUserName();
    if (!trainee) return [];
    return astTraineeGetStore().submissions
        .filter(s => astTraineeIdentity(s.trainee) === astTraineeIdentity(trainee) && String(s.status || '') !== 'archived')
        .sort((a, b) => String(b.updatedAt || b.generatedAt || '').localeCompare(String(a.updatedAt || a.generatedAt || '')));
}

function renderAssessmentStudioAssignmentsHtml() {
    const assignments = getAssessmentStudioAssignmentsForCurrentUser();
    if (!assignments.length) return '';
    const cards = assignments.map(sub => {
        const status = String(sub.status || 'assigned');
        const feedbackStatus = String(sub.feedbackStatus || 'none').trim().toLowerCase();
        const isOpen = ['assigned', 'in_progress'].includes(status);
        const statusLabel = status === 'pending_review' ? 'Pending Review' : status === 'completed' ? `Completed (${Math.round(Number(sub.percent || 0))}%)` : status === 'in_progress' ? 'In Progress' : 'Not Started';
        const statusClass = status === 'completed' ? 'status-pass' : status === 'pending_review' ? 'status-semi' : 'status-improve';
        const questions = Array.isArray(sub.testSnapshot?.questions) ? sub.testSnapshot.questions.length : 0;
        const feedbackHtml = status === 'completed' && feedbackStatus === 'received'
            ? '<button class="btn-secondary btn-sm" disabled><i class="fas fa-check-circle"></i> Feedback Received</button>'
            : status === 'completed'
            ? `<button class="btn-warning btn-sm" onclick="requestAssessmentStudioFeedback('${astTraineeEsc(sub.id)}')" ${feedbackStatus === 'requested' ? 'disabled' : ''}><i class="fas fa-hand-paper"></i> ${feedbackStatus === 'requested' ? 'Feedback Requested' : 'Request Feedback'}</button>`
            : '';
        return `
            <div class="test-card-row assessment-studio-assignment-row">
                <div class="test-card-main">
                    <strong>${astTraineeEsc(sub.assessment || 'Assessment Studio Test')}</strong>
                    <div class="test-card-meta">
                        <span><i class="fas fa-vial-circle-check"></i> Assessment Studio</span>
                        <span><i class="fas fa-list-ol"></i> ${questions} Questions</span>
                        <span><i class="fas fa-shield-halved"></i> Snapshot ${astTraineeEsc(sub.testSnapshot?.signature || sub.id).slice(0, 12)}</span>
                    </div>
                </div>
                <div class="test-card-actions" style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                    <span class="status-badge ${statusClass}">${astTraineeEsc(statusLabel)}</span>
                    ${isOpen ? `<button class="btn-primary btn-sm" onclick="openAssessmentStudioTraineeRuntime('${astTraineeEsc(sub.id)}')">${status === 'in_progress' ? 'Resume' : 'Start'} Studio Test</button>` : '<button class="btn-secondary btn-sm" disabled>Submitted</button>'}
                    ${feedbackHtml}
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="assessment-studio-assignment-block">
            <div class="assessment-studio-assignment-head">
                <div>
                    <h3>Assessment Studio</h3>
                    <p>New generated assessments with sealed trainee snapshots.</p>
                </div>
            </div>
            ${cards}
        </div>
    `;
}

async function openAssessmentStudioFromSchedule(generatorId, scheduleItem = {}) {
    try {
        const sub = await ensureAssessmentStudioAssignmentForCurrentUser(generatorId, scheduleItem);
        if (!sub) {
            if (typeof showToast === 'function') showToast('Assessment Studio assignment could not be opened.', 'error');
            return false;
        }
        if (!['assigned', 'in_progress'].includes(String(sub.status || ''))) {
            if (typeof showToast === 'function') showToast('This Assessment Studio test has already been submitted and cannot be reopened.', 'warning');
            return false;
        }
        openAssessmentStudioTraineeRuntime(sub.id);
        return true;
    } catch (error) {
        console.error('[Assessment Studio Trainee] open from schedule failed:', error);
        if (typeof showToast === 'function') showToast(error.message || 'Assessment Studio assignment could not be opened.', 'error');
        else alert(error.message || 'Assessment Studio assignment could not be opened.');
        return false;
    }
}

function openAssessmentStudioTraineeRuntime(submissionId) {
    AST_ACTIVE_SUBMISSION_ID = String(submissionId || '').trim();
    const store = astTraineeGetStore();
    const sub = store.submissions.find(item => String(item.id) === AST_ACTIVE_SUBMISSION_ID);
    if (sub && !['assigned', 'in_progress'].includes(String(sub.status || ''))) {
        AST_ACTIVE_SUBMISSION_ID = '';
        if (typeof showToast === 'function') showToast('This Assessment Studio test has already been submitted and cannot be reopened.', 'warning');
        if (typeof showTab === 'function') showTab('my-tests');
        if (typeof loadTraineeTests === 'function') loadTraineeTests();
        return;
    }
    if (sub && sub.status === 'assigned') {
        sub.status = 'in_progress';
        sub.updatedAt = new Date().toISOString();
        astTraineeSaveStore(store, false);
    }
    if (typeof showTab === 'function') showTab('assessment-studio-trainee');
    renderAssessmentStudioTraineeRuntime();
}

function astTraineeGetActiveSubmission() {
    const store = astTraineeGetStore();
    const sub = store.submissions.find(item => String(item.id) === String(AST_ACTIVE_SUBMISSION_ID));
    return { store, sub };
}

function astTraineeAnswerValue(sub, idx) {
    return sub && sub.answers && Object.prototype.hasOwnProperty.call(sub.answers, idx) ? sub.answers[idx] : undefined;
}

function astTraineeAnswerCompleteness(sub) {
    const questions = Array.isArray(sub?.testSnapshot?.questions) ? sub.testSnapshot.questions : [];
    const answered = questions.filter((q, idx) => {
        const value = astTraineeAnswerValue(sub, idx);
        if (q.type === 'multi_select' || q.type === 'ranking') return Array.isArray(value) && value.length > 0;
        if (q.type === 'matching' || q.type === 'matrix') return value && typeof value === 'object' && Object.keys(value).length > 0;
        return value !== undefined && value !== null && String(value).trim() !== '';
    }).length;
    return { answered, total: questions.length };
}

function renderAssessmentStudioTraineeRuntime() {
    const root = document.getElementById('assessmentStudioTraineeRuntime');
    if (!root) return;
    const { sub } = astTraineeGetActiveSubmission();
    if (!sub) {
        root.innerHTML = `
            <div class="ast-trainee-shell">
                <div class="ast-trainee-empty">
                    <h2>Assessment Studio</h2>
                    <p>No Assessment Studio test is currently selected.</p>
                    <button class="btn-secondary" onclick="showTab('my-tests')"><i class="fas fa-arrow-left"></i> Back to My Assessments</button>
                </div>
            </div>
        `;
        return;
    }

    const questions = Array.isArray(sub.testSnapshot?.questions) ? sub.testSnapshot.questions : [];
    const completeness = astTraineeAnswerCompleteness(sub);
    const locked = !['assigned', 'in_progress'].includes(String(sub.status || ''));
    if (locked) {
        const status = String(sub.status || '').trim();
        const isCompleted = status === 'completed';
        root.innerHTML = `
            <div class="ast-trainee-shell">
                <header class="ast-trainee-topbar">
                    <button class="btn-secondary btn-sm" onclick="showTab('my-tests')"><i class="fas fa-arrow-left"></i> My Assessments</button>
                    <div class="ast-trainee-title">
                        <span>Assessment Studio</span>
                        <h2>${astTraineeEsc(sub.assessment || 'Generated Assessment')}</h2>
                    </div>
                    <div class="ast-trainee-score">
                        <strong>${isCompleted ? `${Math.round(Number(sub.percent || 0))}%` : 'Submitted'}</strong>
                        <span>${isCompleted ? 'graded' : 'for review'}</span>
                    </div>
                </header>
                <div class="ast-trainee-empty">
                    <h2>${isCompleted ? 'Assessment Graded' : 'Assessment Submitted'}</h2>
                    <p>${isCompleted ? 'Your result is available in My Assessments.' : 'Your test has been submitted for admin review and cannot be reopened.'}</p>
                    <button class="btn-primary" onclick="showTab('my-tests')"><i class="fas fa-list-check"></i> Back to My Assessments</button>
                </div>
            </div>
        `;
        return;
    }
    root.innerHTML = `
        <div class="ast-trainee-shell">
            <header class="ast-trainee-topbar">
                <button class="btn-secondary btn-sm" onclick="showTab('my-tests')"><i class="fas fa-arrow-left"></i> My Assessments</button>
                <div class="ast-trainee-title">
                    <span>Assessment Studio</span>
                    <h2>${astTraineeEsc(sub.assessment || 'Generated Assessment')}</h2>
                </div>
                <div class="ast-trainee-score">
                    <strong>${completeness.answered}/${completeness.total}</strong>
                    <span>answered</span>
                </div>
            </header>
            <div class="ast-trainee-workspace">
                <aside class="ast-trainee-sidebar">
                    <div class="ast-trainee-meta">
                        <span>${astTraineeEsc(sub.phase || 'Assessment')}</span>
                        <span>${astTraineeEsc(sub.status || 'assigned')}</span>
                        <span>${astTraineeEsc(sub.maxPoints)} pts</span>
                    </div>
                    <div class="ast-trainee-progress-list">
                        ${questions.map((q, idx) => {
                            const value = astTraineeAnswerValue(sub, idx);
                            const done = value !== undefined && value !== null && (typeof value !== 'string' || value.trim() !== '');
                            return `<a href="#astq${idx}" class="${done ? 'done' : ''}">Q${idx + 1}<span>${astTraineeEsc(astTraineeTypeLabel(q.type))}</span></a>`;
                        }).join('')}
                    </div>
                </aside>
                <main class="ast-trainee-paper">
                    ${questions.map((q, idx) => renderAssessmentStudioTraineeQuestion(sub, q, idx, locked)).join('')}
                    <div class="ast-trainee-submitbar">
                        <button class="btn-secondary" onclick="saveAssessmentStudioDraft()" ${locked ? 'disabled' : ''}><i class="fas fa-save"></i> Save Draft</button>
                        <button class="btn-primary" onclick="submitAssessmentStudioTest()" ${locked ? 'disabled' : ''}><i class="fas fa-paper-plane"></i> Submit for Review</button>
                    </div>
                </main>
            </div>
        </div>
    `;
}

function renderAssessmentStudioTraineeQuestion(sub, q, idx, locked) {
    return `
        <article id="astq${idx}" class="ast-trainee-question">
            <div class="ast-trainee-question-head">
                <div>
                    <span>Question ${idx + 1}</span>
                    <h3>${astTraineeEsc(q.text)}</h3>
                </div>
                <div class="ast-trainee-question-meta">${astTraineeEsc(astTraineeTypeLabel(q.type))} | ${astTraineeEsc(q.points)} pts</div>
            </div>
            ${renderAssessmentStudioTraineeInput(sub, q, idx, locked)}
        </article>
    `;
}

function renderAssessmentStudioTraineeInput(sub, q, idx, locked) {
    const answer = astTraineeAnswerValue(sub, idx);
    const disabled = locked ? 'disabled' : '';
    if (q.type === 'multiple_choice') {
        return `<div class="ast-option-list">${(q.options || []).map((opt, optIdx) => `
            <label><input type="radio" name="ast_answer_${idx}" value="${optIdx}" ${Number(answer) === optIdx ? 'checked' : ''} ${disabled} onchange="setAssessmentStudioAnswer(${idx}, Number(this.value))"> ${astTraineeEsc(opt)}</label>
        `).join('')}</div>`;
    }
    if (q.type === 'multi_select') {
        const selected = new Set((Array.isArray(answer) ? answer : []).map(Number));
        return `<div class="ast-option-list">${(q.options || []).map((opt, optIdx) => `
            <label><input type="checkbox" value="${optIdx}" ${selected.has(optIdx) ? 'checked' : ''} ${disabled} onchange="toggleAssessmentStudioMultiAnswer(${idx}, Number(this.value), this.checked)"> ${astTraineeEsc(opt)}</label>
        `).join('')}</div>`;
    }
    if (q.type === 'matching') {
        const choices = astTraineeShuffle((q.pairs || []).map(p => p.right).filter(Boolean), `${sub.id}|${idx}|matching`);
        return `<div class="ast-match-list">${(q.pairs || []).map((pair, pairIdx) => `
            <label><span>${astTraineeEsc(pair.left)}</span><select ${disabled} onchange="setAssessmentStudioObjectAnswer(${idx}, ${pairIdx}, this.value)">
                <option value="">Select match...</option>
                ${choices.map(choice => `<option value="${astTraineeEsc(choice)}" ${answer && answer[pairIdx] === choice ? 'selected' : ''}>${astTraineeEsc(choice)}</option>`).join('')}
            </select></label>
        `).join('')}</div>`;
    }
    if (q.type === 'ranking') {
        const current = Array.isArray(answer) && answer.length ? answer : astTraineeShuffle(q.items || [], `${sub.id}|${idx}|ranking`);
        return `<div class="ast-rank-list">${current.map((item, pos) => `
            <div class="ast-rank-row">
                <span>${pos + 1}</span>
                <select ${disabled} onchange="setAssessmentStudioRankingAnswer(${idx})">
                    ${(q.items || []).map(option => `<option value="${astTraineeEsc(option)}" ${option === item ? 'selected' : ''}>${astTraineeEsc(option)}</option>`).join('')}
                </select>
            </div>
        `).join('')}</div>`;
    }
    if (q.type === 'matrix') {
        return `<div class="ast-matrix-grid">${(q.rows || []).map((row, rowIdx) => `
            <div class="ast-matrix-row">
                <strong>${astTraineeEsc(row)}</strong>
                ${(q.cols || []).map((col, colIdx) => `
                    <label><input type="radio" name="ast_matrix_${idx}_${rowIdx}" value="${colIdx}" ${answer && Number(answer[rowIdx]) === colIdx ? 'checked' : ''} ${disabled} onchange="setAssessmentStudioObjectAnswer(${idx}, ${rowIdx}, Number(this.value))"> ${astTraineeEsc(col)}</label>
                `).join('')}
            </div>
        `).join('')}</div>`;
    }
    return `<textarea rows="5" ${disabled} oninput="setAssessmentStudioAnswer(${idx}, this.value)" placeholder="Enter your answer...">${astTraineeEsc(answer || '')}</textarea>`;
}

function setAssessmentStudioAnswer(idx, value) {
    const { store, sub } = astTraineeGetActiveSubmission();
    if (!sub || !['assigned', 'in_progress'].includes(sub.status)) return;
    sub.answers[String(idx)] = value;
    sub.status = 'in_progress';
    sub.updatedAt = new Date().toISOString();
    astTraineeSaveStore(store, false);
}

function toggleAssessmentStudioMultiAnswer(idx, optionIdx, checked) {
    const { store, sub } = astTraineeGetActiveSubmission();
    if (!sub || !['assigned', 'in_progress'].includes(sub.status)) return;
    const current = new Set((Array.isArray(sub.answers[String(idx)]) ? sub.answers[String(idx)] : []).map(Number));
    if (checked) current.add(optionIdx);
    else current.delete(optionIdx);
    sub.answers[String(idx)] = Array.from(current).sort((a, b) => a - b);
    sub.status = 'in_progress';
    sub.updatedAt = new Date().toISOString();
    astTraineeSaveStore(store, false);
}

function setAssessmentStudioObjectAnswer(idx, key, value) {
    const { store, sub } = astTraineeGetActiveSubmission();
    if (!sub || !['assigned', 'in_progress'].includes(sub.status)) return;
    const current = sub.answers[String(idx)] && typeof sub.answers[String(idx)] === 'object' && !Array.isArray(sub.answers[String(idx)]) ? sub.answers[String(idx)] : {};
    current[String(key)] = value;
    sub.answers[String(idx)] = current;
    sub.status = 'in_progress';
    sub.updatedAt = new Date().toISOString();
    astTraineeSaveStore(store, false);
}

function setAssessmentStudioRankingAnswer(idx) {
    const rows = Array.from(document.querySelectorAll(`#astq${idx} .ast-rank-row select`));
    setAssessmentStudioAnswer(idx, rows.map(select => select.value).filter(Boolean));
}

async function saveAssessmentStudioDraft() {
    const { store, sub } = astTraineeGetActiveSubmission();
    if (!sub) return;
    sub.status = 'in_progress';
    sub.updatedAt = new Date().toISOString();
    await astTraineeSaveStore(store, true);
    if (typeof showToast === 'function') showToast('Assessment Studio draft saved.', 'success');
}

function scoreAssessmentStudioQuestion(q, answer) {
    const max = Number(q.points || 1);
    if (q.type === 'text') return { score: 0, max, manual: true };
    if (q.type === 'multiple_choice') return { score: Number(answer) === Number(q.correct) ? max : 0, max, manual: false };
    if (q.type === 'multi_select') {
        const correct = new Set((Array.isArray(q.correct) ? q.correct : []).map(Number));
        const got = new Set((Array.isArray(answer) ? answer : []).map(Number));
        const ok = correct.size > 0 && correct.size === got.size && Array.from(correct).every(v => got.has(v));
        return { score: ok ? max : 0, max, manual: false };
    }
    if (q.type === 'matching') {
        const pairs = Array.isArray(q.pairs) ? q.pairs : [];
        const correct = pairs.filter((p, pairIdx) => answer && answer[pairIdx] === p.right).length;
        return { score: pairs.length ? Math.round((correct / pairs.length) * max * 10) / 10 : 0, max, manual: false };
    }
    if (q.type === 'ranking') {
        const expected = Array.isArray(q.items) ? q.items : [];
        const got = Array.isArray(answer) ? answer : [];
        return { score: expected.length && expected.length === got.length && expected.every((v, i) => got[i] === v) ? max : 0, max, manual: false };
    }
    if (q.type === 'matrix') {
        const rows = Array.isArray(q.rows) ? q.rows : [];
        const correct = rows.filter((_, rowIdx) => answer && Number(answer[rowIdx]) === Number((q.matrixCorrect || {})[rowIdx])).length;
        return { score: rows.length ? Math.round((correct / rows.length) * max * 10) / 10 : 0, max, manual: false };
    }
    return { score: 0, max, manual: true };
}

async function submitAssessmentStudioTest() {
    const { store, sub } = astTraineeGetActiveSubmission();
    if (!sub || !['assigned', 'in_progress'].includes(sub.status)) return;
    const completeness = astTraineeAnswerCompleteness(sub);
    if (completeness.answered < completeness.total && !confirm(`Only ${completeness.answered}/${completeness.total} questions have answers. Submit anyway?`)) return;

    const scores = {};
    const questions = Array.isArray(sub.testSnapshot?.questions) ? sub.testSnapshot.questions : [];
    questions.forEach((q, idx) => {
        const result = scoreAssessmentStudioQuestion(q, sub.answers[String(idx)]);
        if (!result.manual) scores[String(idx)] = result.score;
    });
    const autoEarned = Object.values(scores).reduce((sum, value) => sum + Number(value || 0), 0);
    const max = questions.reduce((sum, q) => sum + Number(q.points || 1), 0);
    sub.questionScores = scores;
    sub.earnedPoints = Math.round(autoEarned * 10) / 10;
    sub.maxPoints = Math.round(max * 10) / 10;
    sub.percent = max ? Math.round((autoEarned / max) * 100) : 0;
    sub.status = 'pending_review';
    sub.submittedAt = new Date().toISOString();
    sub.updatedAt = sub.submittedAt;
    sub.feedbackStatus = sub.feedbackStatus || 'none';
    await astTraineeSaveStore(store, true);
    if (typeof showToast === 'function') showToast('Assessment submitted to the grading queue.', 'success');
    if (typeof loadTraineeTests === 'function') loadTraineeTests();
    if (typeof showTab === 'function') showTab('my-tests');
}

async function requestAssessmentStudioFeedback(submissionId) {
    const store = astTraineeGetStore();
    const sub = store.submissions.find(item => String(item.id) === String(submissionId));
    if (!sub || sub.status !== 'completed') return;
    const currentStatus = String(sub.feedbackStatus || 'none').trim().toLowerCase();
    if (currentStatus === 'requested' || currentStatus === 'received') return;
    sub.feedbackStatus = 'requested';
    sub.feedbackRequestedAt = new Date().toISOString();
    sub.updatedAt = sub.feedbackRequestedAt;
    astTraineeCreateFeedbackNotification(sub);
    await astTraineeSaveStore(store, true);
    if (typeof saveToServer === 'function') {
        try {
            await saveToServer(['assessment_studio_data', 'admin_notifications'], true, true);
        } catch (error) {
            console.warn('[Assessment Studio Trainee] feedback notification sync failed:', error);
        }
    }
    if (typeof showToast === 'function') showToast('Feedback request sent.', 'success');
    if (typeof loadTraineeTests === 'function') loadTraineeTests();
    if (typeof updateNotifications === 'function') updateNotifications();
}

window.ensureAssessmentStudioAssignmentForCurrentUser = ensureAssessmentStudioAssignmentForCurrentUser;
window.openAssessmentStudioFromSchedule = openAssessmentStudioFromSchedule;
window.openAssessmentStudioTraineeRuntime = openAssessmentStudioTraineeRuntime;
window.renderAssessmentStudioTraineeRuntime = renderAssessmentStudioTraineeRuntime;
window.renderAssessmentStudioAssignmentsHtml = renderAssessmentStudioAssignmentsHtml;
window.requestAssessmentStudioFeedback = requestAssessmentStudioFeedback;
window.refreshAssessmentStudioTraineeStoreFromServer = refreshAssessmentStudioTraineeStoreFromServer;

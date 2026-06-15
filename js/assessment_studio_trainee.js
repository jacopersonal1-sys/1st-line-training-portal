/* ================= ASSESSMENT STUDIO TRAINEE RUNTIME ================= */

const AST_TRAINEE_DATA_KEY = 'assessment_studio_data';
const AST_TRAINEE_LOCAL_KEY = 'assessment_studio_data_local';
const AST_TRAINEE_UPLOAD_STATUS_KEY = 'assessment_studio_upload_status';

const AST_TRAINEE_TYPES = [
    { key: 'multiple_choice', label: 'Multiple Choice' },
    { key: 'multi_select', label: 'Multiple Answer' },
    { key: 'text', label: 'Text Answer' },
    { key: 'matching', label: 'Matching / Pairs' },
    { key: 'ranking', label: 'Ranking Order' },
    { key: 'matrix', label: 'Matrix / Grid' }
];

let AST_ACTIVE_SUBMISSION_ID = '';
let AST_ACTIVE_SUBMISSION_SNAPSHOT = null;
let AST_TRAINEE_PENDING_RENDER = false;
let AST_TRAINEE_RECOVERY_IN_FLIGHT = false;
let AST_TRAINEE_VERIFY_IN_FLIGHT = false;

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

function astTraineeUploadStatusMap() {
    const parsed = astTraineeParse(localStorage.getItem(AST_TRAINEE_UPLOAD_STATUS_KEY), {});
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function astTraineeSetUploadStatus(submissionId, patch) {
    const id = String(submissionId || '').trim();
    if (!id) return;
    const map = astTraineeUploadStatusMap();
    map[id] = {
        ...(map[id] && typeof map[id] === 'object' ? map[id] : {}),
        ...(patch && typeof patch === 'object' ? patch : {}),
        updatedAt: new Date().toISOString()
    };
    localStorage.setItem(AST_TRAINEE_UPLOAD_STATUS_KEY, JSON.stringify(map));
}

function astTraineeClearUploadStatus(submissionId) {
    const id = String(submissionId || '').trim();
    if (!id) return;
    const map = astTraineeUploadStatusMap();
    if (!map[id]) return;
    delete map[id];
    localStorage.setItem(AST_TRAINEE_UPLOAD_STATUS_KEY, JSON.stringify(map));
}

function astTraineeClone(value) {
    return astTraineeParse(JSON.stringify(value || null), null);
}

function astTraineeCanKeepRuntimeOpen(submission) {
    return submission && ['assigned', 'in_progress'].includes(String(submission.status || ''));
}

function astTraineeRememberActiveSubmission(submission) {
    if (!submission || String(submission.id || '') !== String(AST_ACTIVE_SUBMISSION_ID || '')) return;
    AST_ACTIVE_SUBMISSION_SNAPSHOT = astTraineeClone(submission);
}

function astTraineeClearActiveSnapshot() {
    AST_ACTIVE_SUBMISSION_SNAPSHOT = null;
}

function astTraineeIsRuntimeInputFocused() {
    const root = document.getElementById('assessmentStudioTraineeRuntime');
    const active = document.activeElement;
    if (!root || !active || typeof root.contains !== 'function' || !root.contains(active)) return false;
    const tag = String(active.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || !!active.isContentEditable;
}

function astTraineeMakeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function astTraineeNormalize(value) {
    return String(value || '').trim().toLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function astTraineeNormalizeFormattedText(value) {
    return String(value || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[ \t]+$/gm, '')
        .replace(/^\n+|\n+$/g, '');
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

function astTraineeReadObject(key) {
    const parsed = astTraineeParse(localStorage.getItem(key), {});
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
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
        text: astTraineeNormalizeFormattedText(q.text || q.question || ''),
        points: Number.isFinite(points) && points > 0 ? Math.round(points * 10) / 10 : 1,
        suggestedAnswer: astTraineeNormalizeFormattedText(q.suggestedAnswer || q.suggested_answer || ''),
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

function astTraineeQuestionSafetyErrors(question) {
    const q = question && typeof question === 'object' ? question : {};
    const errors = [];
    const type = String(q.type || '').trim();
    const optionTexts = Array.isArray(q.options) ? q.options.map(value => String(value || '').trim()).filter(Boolean) : [];
    const duplicateOption = optionTexts.find((value, idx) => optionTexts.findIndex(other => astTraineeNormalize(other) === astTraineeNormalize(value)) !== idx);
    if (!String(q.assessment || '').trim()) errors.push('A generated question is missing its assessment.');
    if (!String(q.text || '').trim()) errors.push('A generated question is missing its question text.');
    if (!AST_TRAINEE_TYPES.some(item => item.key === type)) errors.push('A generated question has an unsupported type.');
    if (!(Number(q.points) > 0)) errors.push('A generated question has invalid points.');
    if (type === 'multiple_choice') {
        if (!Array.isArray(q.options) || q.options.length < 2) errors.push('A multiple choice question is missing options.');
        if (duplicateOption) errors.push('A multiple choice question has duplicate options.');
        if (astTraineeChoiceIndex(q, q.correct) < 0) errors.push('A multiple choice question is missing its correct answer.');
    }
    if (type === 'multi_select') {
        if (!Array.isArray(q.options) || q.options.length < 2) errors.push('A multiple answer question is missing options.');
        if (!Array.isArray(q.correct) || q.correct.length < 1) errors.push('A multiple answer question is missing correct answers.');
        if (duplicateOption) errors.push('A multiple answer question has duplicate options.');
        const correctIndexes = (Array.isArray(q.correct) ? q.correct : []).map(value => astTraineeChoiceIndex(q, value));
        if (correctIndexes.some(value => value < 0)) errors.push('A multiple answer question has a correct answer that does not match an option.');
        if (new Set(correctIndexes.filter(value => value >= 0)).size !== correctIndexes.filter(value => value >= 0).length) errors.push('A multiple answer question has duplicate correct answers.');
    }
    if (type === 'matching') {
        if (!Array.isArray(q.pairs) || q.pairs.length < 1) errors.push('A matching question is missing pairs.');
        if ((q.pairs || []).some(pair => !String(pair.left || '').trim() || !String(pair.right || '').trim())) errors.push('A matching question has an incomplete pair.');
    }
    if (type === 'ranking') {
        const items = Array.isArray(q.items) ? q.items.map(value => String(value || '').trim()).filter(Boolean) : [];
        const duplicateItem = items.find((value, idx) => items.findIndex(other => astTraineeNormalize(other) === astTraineeNormalize(value)) !== idx);
        if (!Array.isArray(q.items) || q.items.length < 2) errors.push('A ranking question is missing ordered items.');
        if (duplicateItem) errors.push('A ranking question has duplicate ordered items.');
    }
    if (type === 'matrix') {
        const rowCount = Array.isArray(q.rows) ? q.rows.length : 0;
        const colCount = Array.isArray(q.cols) ? q.cols.length : 0;
        const correctCount = q.matrixCorrect && typeof q.matrixCorrect === 'object' ? Object.keys(q.matrixCorrect).length : 0;
        if (!rowCount || !colCount) errors.push('A matrix question is missing rows or columns.');
        if (rowCount && correctCount < rowCount) errors.push('A matrix question is missing correct answers.');
        const invalidMatrix = Array.from({ length: rowCount }).some((_, rowIdx) => {
            const value = astTraineeGetValueAt(q.matrixCorrect || {}, rowIdx);
            const asIndex = Number(value);
            if (Number.isInteger(asIndex)) return asIndex < 0 || asIndex >= colCount;
            return (q.cols || []).findIndex(col => astTraineeNormalize(col) === astTraineeNormalize(value)) < 0;
        });
        if (invalidMatrix) errors.push('A matrix question has a correct answer that does not match a column.');
    }
    return errors;
}

function astTraineeValidateGenerator(store, generator) {
    const errors = [];
    const g = generator && typeof generator === 'object' ? generator : {};
    if (!String(g.id || '').trim()) errors.push('The linked Assessment Studio generator is missing its ID.');
    if (!String(g.assessment || '').trim()) errors.push('The linked Assessment Studio generator is missing its assessment name.');
    if (!(Number(g.totalPoints) > 0)) errors.push('The linked Assessment Studio generator has invalid total points.');
    if (!Array.isArray(g.allowedTypes) || !g.allowedTypes.length) errors.push('The linked Assessment Studio generator has no allowed question types.');
    if (!(Number(g.pointLeeway) >= 0)) errors.push('The linked Assessment Studio generator has invalid point leeway.');
    if (errors.length) return { errors, pool: [] };

    const pool = (store.questionBucket || []).filter(q =>
        q.status !== 'archived' &&
        astTraineeNormalize(q.assessment) === astTraineeNormalize(g.assessment) &&
        g.allowedTypes.includes(q.type)
    );
    if (!pool.length) errors.push('No active bucket questions match this linked Assessment Studio generator.');
    const broken = pool.find(q => astTraineeQuestionSafetyErrors(q).length > 0);
    if (broken) errors.push(`The bucket question "${broken.text || broken.id}" is incomplete.`);
    return { errors, pool };
}

function astTraineeAnswerIsComplete(question, value) {
    const q = question && typeof question === 'object' ? question : {};
    if (q.type === 'multiple_choice') return astTraineeChoiceIndex(q, value) >= 0;
    if (q.type === 'multi_select') {
        const options = Array.isArray(q.options) ? q.options : [];
        return Array.isArray(value) && value.length > 0 && value.every(item => astTraineeChoiceIndex(q, item) >= 0 && astTraineeChoiceIndex(q, item) < options.length);
    }
    if (q.type === 'ranking') {
        const expected = Array.isArray(q.items) ? q.items : [];
        if (!Array.isArray(value) || value.length !== expected.length) return false;
        const expectedSet = new Set(expected.map(astTraineeScoreText));
        const gotSet = new Set(value.map(astTraineeScoreText));
        return expectedSet.size === gotSet.size && Array.from(expectedSet).every(item => gotSet.has(item));
    }
    if (q.type === 'matching') {
        const pairCount = Array.isArray(q.pairs) ? q.pairs.length : 0;
        return value && typeof value === 'object' && Object.keys(value).length >= pairCount && Object.values(value).every(v => String(v || '').trim());
    }
    if (q.type === 'matrix') {
        const rowCount = Array.isArray(q.rows) ? q.rows.length : 0;
        const colCount = Array.isArray(q.cols) ? q.cols.length : 0;
        return value && typeof value === 'object' && Object.keys(value).length >= rowCount && Array.from({ length: rowCount }).every((_, rowIdx) => {
            const answer = astTraineeGetValueAt(value, rowIdx);
            const index = Number(answer);
            if (Number.isInteger(index)) return index >= 0 && index < colCount;
            return (q.cols || []).some(col => astTraineeNormalize(col) === astTraineeNormalize(answer));
        });
    }
    return value !== undefined && value !== null && String(value).trim() !== '';
}

function astTraineeSubmissionSafetyErrors(submission, options = {}) {
    const sub = submission && typeof submission === 'object' ? submission : {};
    const questions = Array.isArray(sub.testSnapshot?.questions) ? sub.testSnapshot.questions : [];
    const errors = [];
    if (!String(sub.trainee || '').trim()) errors.push('This Assessment Studio test is missing the trainee name.');
    if (!String(sub.assessment || '').trim()) errors.push('This Assessment Studio test is missing the assessment name.');
    if (!questions.length) errors.push('This Assessment Studio test has no generated questions.');
    questions.forEach((q, idx) => {
        const questionErrors = astTraineeQuestionSafetyErrors(q);
        if (questionErrors.length) errors.push(`Question ${idx + 1} is incomplete: ${questionErrors[0]}`);
        if (options.requireAnswers && !astTraineeAnswerIsComplete(q, sub.answers ? sub.answers[String(idx)] : undefined)) {
            errors.push(`Question ${idx + 1} still needs an answer.`);
        }
    });
    return errors;
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

function astTraineeSubmissionTime(submission) {
    return Date.parse(submission?.updatedAt || submission?.gradedAt || submission?.submittedAt || submission?.generatedAt || 0) || 0;
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

function astTraineeCompareAssignmentPriority(a, b) {
    const rankDiff = astTraineeSubmissionStatusRank(b && b.status) - astTraineeSubmissionStatusRank(a && a.status);
    if (rankDiff) return rankDiff;
    return astTraineeSubmissionTime(b) - astTraineeSubmissionTime(a);
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

function astTraineeMergeServerStoreWithLocalDrafts(remoteStore, localStore) {
    const remote = astTraineeNormalizeStore(remoteStore);
    const local = astTraineeNormalizeStore(localStore);
    const currentUserToken = astTraineeIdentity(astTraineeCurrentUserName());
    const remoteUpdatedAt = Date.parse(remote.updatedAt || 0) || 0;
    const submissions = astTraineeMergeSubmissions(remote.submissions, local.submissions)
        .filter((item) => {
            const id = String(item && item.id || '');
            if (!id) return false;
            if ((remote.submissions || []).some(remoteItem => String(remoteItem && remoteItem.id || '') === id)) return true;

            const localUpdatedAt = Date.parse(item.updatedAt || item.submittedAt || item.generatedAt || 0) || 0;
            const isMine = currentUserToken && astTraineeIdentity(item.trainee) === currentUserToken;
            const status = String(item.status || '').trim().toLowerCase();
            const hasAnswers = item.answers && typeof item.answers === 'object' && Object.keys(item.answers).length > 0;
            const isActiveRuntimeSubmission = AST_ACTIVE_SUBMISSION_ID && String(item.id || '') === String(AST_ACTIVE_SUBMISSION_ID);
            const isSubmittedOrGraded = ['pending_review', 'completed'].includes(status);
            const isWorkingDraft = ['assigned', 'in_progress'].includes(status) && (hasAnswers || isActiveRuntimeSubmission);
            return isMine && (isSubmittedOrGraded || isWorkingDraft || localUpdatedAt > remoteUpdatedAt);
        });

    return astTraineeNormalizeStore({
        ...remote,
        submissions,
        updatedAt: remote.updatedAt || local.updatedAt,
        updatedBy: remote.updatedBy || local.updatedBy
    });
}

function astTraineeGetStore() {
    const local = astTraineeNormalizeStore(astTraineeParse(localStorage.getItem(AST_TRAINEE_LOCAL_KEY), null));
    const canonical = astTraineeNormalizeStore(astTraineeParse(localStorage.getItem(AST_TRAINEE_DATA_KEY), null));
    return astTraineeMergeServerStoreWithLocalDrafts(canonical, local);
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
            const merged = astTraineeMergeServerStoreWithLocalDrafts(
                { ...remote, updatedAt: remote.updatedAt || data.updated_at || new Date().toISOString() },
                local
            );
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

function astTraineeShouldRecoverLocalSubmission(localSub, remoteSub) {
    if (!localSub || !String(localSub.id || '').trim()) return false;
    const currentUserToken = astTraineeIdentity(astTraineeCurrentUserName());
    if (!currentUserToken || astTraineeIdentity(localSub.trainee) !== currentUserToken) return false;
    const status = String(localSub.status || '').trim();
    if (!['pending_review', 'completed'].includes(status)) return false;
    if (!remoteSub) return true;
    const localRank = astTraineeSubmissionStatusRank(localSub.status);
    const remoteRank = astTraineeSubmissionStatusRank(remoteSub.status);
    if (localRank > remoteRank) return true;
    if (localRank < remoteRank) return false;
    return astTraineeSubmissionTime(localSub) > astTraineeSubmissionTime(remoteSub);
}

async function verifyLocalAssessmentStudioSubmittedUploads({ silent = true } = {}) {
    if (AST_TRAINEE_VERIFY_IN_FLIGHT) return false;
    if (!window.supabaseClient || typeof window.supabaseClient.from !== 'function') return false;
    AST_TRAINEE_VERIFY_IN_FLIGHT = true;
    try {
        const local = astTraineeNormalizeStore(astTraineeParse(localStorage.getItem(AST_TRAINEE_LOCAL_KEY), null));
        const localCandidates = local.submissions.filter(sub => astTraineeShouldRecoverLocalSubmission(sub, null));
        if (!localCandidates.length) return false;

        const { data, error } = await window.supabaseClient
            .from('app_documents')
            .select('content, updated_at')
            .eq('key', AST_TRAINEE_DATA_KEY)
            .maybeSingle();
        if (error) throw error;

        const remote = astTraineeNormalizeStore(data && data.content && typeof data.content === 'object' ? data.content : null);
        const remoteById = new Map(remote.submissions.map(sub => [String(sub.id), sub]));
        let changed = false;
        localCandidates.forEach(sub => {
            const remoteSub = remoteById.get(String(sub.id));
            if (astTraineeShouldRecoverLocalSubmission(sub, remoteSub)) {
                astTraineeSetUploadStatus(sub.id, {
                    state: 'missing',
                    message: 'Submitted locally but not found on Supabase.',
                    checkedAt: new Date().toISOString()
                });
                changed = true;
            } else {
                astTraineeClearUploadStatus(sub.id);
            }
        });
        if (changed && !silent && typeof showToast === 'function') showToast('Some submitted Assessment Studio tests still need upload recovery.', 'warning');
        if (changed && typeof loadTraineeTests === 'function') loadTraineeTests();
        return changed;
    } catch (error) {
        console.warn('[Assessment Studio Trainee] upload verification failed:', error);
        return false;
    } finally {
        AST_TRAINEE_VERIFY_IN_FLIGHT = false;
    }
}

async function recoverLocalAssessmentStudioSubmissionsToServer({ silent = true, submissionId = '' } = {}) {
    if (AST_TRAINEE_RECOVERY_IN_FLIGHT) return false;
    if (!window.supabaseClient || typeof window.supabaseClient.from !== 'function') return false;
    AST_TRAINEE_RECOVERY_IN_FLIGHT = true;
    try {
        const local = astTraineeNormalizeStore(astTraineeParse(localStorage.getItem(AST_TRAINEE_LOCAL_KEY), null));
        const targetId = String(submissionId || '').trim();
        const localCandidates = local.submissions
            .filter(sub => !targetId || String(sub.id) === targetId)
            .filter(sub => astTraineeShouldRecoverLocalSubmission(sub, null));
        if (!localCandidates.length) return false;
        localCandidates.forEach(sub => astTraineeSetUploadStatus(sub.id, { state: 'uploading', message: 'Re-uploading to Supabase.' }));

        const { data, error } = await window.supabaseClient
            .from('app_documents')
            .select('content, updated_at')
            .eq('key', AST_TRAINEE_DATA_KEY)
            .maybeSingle();
        if (error) throw error;

        const remote = astTraineeNormalizeStore(data && data.content && typeof data.content === 'object' ? data.content : null);
        const remoteById = new Map(remote.submissions.map(sub => [String(sub.id), sub]));
        const recoveries = localCandidates.filter(sub => astTraineeShouldRecoverLocalSubmission(sub, remoteById.get(String(sub.id))));
        if (!recoveries.length) {
            localCandidates.forEach(sub => astTraineeClearUploadStatus(sub.id));
            return false;
        }

        recoveries.forEach(sub => {
            const id = String(sub.id);
            const idx = remote.submissions.findIndex(item => String(item.id) === id);
            if (idx >= 0) remote.submissions[idx] = sub;
            else remote.submissions.unshift(sub);
        });
        remote.updatedAt = new Date().toISOString();
        remote.updatedBy = astTraineeCurrentUserName() || 'Trainee recovery';

        const { data: savedData, error: saveError } = await window.supabaseClient
            .from('app_documents')
            .upsert({
                key: AST_TRAINEE_DATA_KEY,
                content: remote,
                updated_at: remote.updatedAt
            })
            .select('updated_at');
        if (saveError) throw saveError;

        localStorage.setItem(AST_TRAINEE_DATA_KEY, JSON.stringify(remote));
        localStorage.setItem(AST_TRAINEE_LOCAL_KEY, JSON.stringify(astTraineeMergeServerStoreWithLocalDrafts(remote, local)));
        const confirmedAt = Array.isArray(savedData) && savedData[0] && savedData[0].updated_at ? savedData[0].updated_at : remote.updatedAt;
        if (confirmedAt) localStorage.setItem(`sync_ts_${AST_TRAINEE_DATA_KEY}`, confirmedAt);
        recoveries.forEach(sub => astTraineeClearUploadStatus(sub.id));
        if (!silent && typeof showToast === 'function') showToast(`Recovered ${recoveries.length} submitted Assessment Studio test(s) to the server.`, 'success');
        if (typeof loadTraineeTests === 'function') loadTraineeTests();
        return true;
    } catch (error) {
        console.warn('[Assessment Studio Trainee] local submission recovery failed:', error);
        const local = astTraineeNormalizeStore(astTraineeParse(localStorage.getItem(AST_TRAINEE_LOCAL_KEY), null));
        const targetId = String(submissionId || '').trim();
        local.submissions
            .filter(sub => !targetId || String(sub.id) === targetId)
            .filter(sub => astTraineeShouldRecoverLocalSubmission(sub, null))
            .forEach(sub => astTraineeSetUploadStatus(sub.id, {
                state: 'failed',
                message: error.message || 'Re-upload to Supabase failed.'
            }));
        if (!silent && typeof showToast === 'function') showToast(error.message || 'Could not recover local Assessment Studio submissions yet.', 'error');
        return false;
    } finally {
        AST_TRAINEE_RECOVERY_IN_FLIGHT = false;
    }
}

async function astTraineeSaveStore(store, forceSync = false) {
    const next = astTraineeNormalizeStore(store);
    next.updatedAt = new Date().toISOString();
    next.updatedBy = astTraineeCurrentUserName() || 'Trainee';
    localStorage.setItem(AST_TRAINEE_LOCAL_KEY, JSON.stringify(next));
    localStorage.setItem(AST_TRAINEE_DATA_KEY, JSON.stringify(next));

    let confirmed = false;
    if (typeof saveToServer === 'function') {
        try {
            const ok = await saveToServer([AST_TRAINEE_DATA_KEY], Boolean(forceSync), true);
            if (ok === false) throw new Error('Assessment Studio cloud save did not confirm.');
            confirmed = true;
            return next;
        } catch (error) {
            console.warn('[Assessment Studio Trainee] saveToServer failed:', error);
        }
    }

    if (window.supabaseClient && typeof window.supabaseClient.from === 'function') {
        try {
            const { data, error } = await window.supabaseClient.from('app_documents').upsert({
                key: AST_TRAINEE_DATA_KEY,
                content: next,
                updated_at: new Date().toISOString()
            }).select('updated_at');
            if (error) throw error;
            const confirmedAt = Array.isArray(data) && data[0] && data[0].updated_at ? data[0].updated_at : '';
            if (confirmedAt) localStorage.setItem(`sync_ts_${AST_TRAINEE_DATA_KEY}`, confirmedAt);
            confirmed = true;
        } catch (error) {
            console.warn('[Assessment Studio Trainee] direct cloud save failed:', error);
        }
    }
    if (forceSync && !confirmed) {
        throw new Error('Assessment Studio could not confirm the save to Supabase. Your local draft is still kept on this device.');
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
    const rosters = astTraineeReadObject('rosters');
    const target = astTraineeIdentity(trainee);
    for (const [groupId, members] of Object.entries(rosters || {})) {
        if (Array.isArray(members) && members.some(name => astTraineeIdentity(name) === target)) return groupId;
    }
    return '';
}

function astTraineeScheduledGeneratorAssignments(store) {
    const trainee = astTraineeCurrentUserName();
    const groupId = astTraineeFindGroup(trainee);
    if (!trainee || !groupId) return [];
    const schedules = astTraineeReadObject('schedules');
    const generators = Array.isArray(store && store.generators) ? store.generators : [];
    const rows = [];

    Object.entries(schedules).forEach(([scheduleId, schedule]) => {
        if (!schedule || String(schedule.assigned || '') !== String(groupId)) return;
        (Array.isArray(schedule.items) ? schedule.items : []).forEach((item, itemIdx) => {
            const generatorId = String(item && item.linkedAssessmentStudioGeneratorId || '').trim();
            if (!generatorId) return;
            const generator = generators.find(g => String(g.id) === generatorId && g.status !== 'archived');
            const label = (generator && generator.assessment) || item.linkedAssessmentStudioLabel || item.title || item.courseName || 'Assessment Studio Test';
            const row = astTraineeNormalizeSubmission({
                id: `ast_schedule_${scheduleId}_${itemIdx}_${generatorId}`,
                generatorId,
                trainee,
                groupID: groupId,
                assessment: label,
                phase: (generator && generator.phase) || 'Assessment',
                status: 'assigned',
                feedbackStatus: 'none',
                testSnapshot: {
                    title: label,
                    generatorId,
                    signature: 'scheduled',
                    questions: []
                },
                maxPoints: Number(generator && generator.totalPoints || 0),
                generatedAt: item.dueDate || item.dateRange || schedule.startDate || new Date().toISOString(),
                updatedAt: item.updatedAt || schedule.updatedAt || item.dueDate || item.dateRange || schedule.startDate || new Date().toISOString()
            });
            row._scheduleOnly = true;
            rows.push(row);
        });
    });

    return rows;
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
    const safety = astTraineeValidateGenerator(store, generator);
    if (safety.errors.length) throw new Error(safety.errors[0]);
    const pool = safety.pool;

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
    if (!best.inRange) {
        throw new Error(`Assessment Studio generated ${Math.round(best.points * 10) / 10} points, outside the allowed ${minPoints}-${maxPoints} point range. Ask an admin to adjust bucket questions or point leeway.`);
    }

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
    if (!cleanGeneratorId) throw new Error('This timeline item is missing its Assessment Studio generator link.');
    if (!trainee) throw new Error('Assessment Studio could not identify the current trainee.');

    const store = astTraineeGetStore();
    const existing = store.submissions
        .filter(s =>
        String(s.generatorId || '') === cleanGeneratorId &&
        astTraineeIdentity(s.trainee) === astTraineeIdentity(trainee) &&
        String(s.status || '') !== 'archived'
        )
        .sort(astTraineeCompareAssignmentPriority)[0];
    if (existing) {
        const existingErrors = astTraineeSubmissionSafetyErrors(existing);
        if (existingErrors.length) throw new Error(existingErrors[0]);
        return existing;
    }

    const generator = store.generators.find(g => String(g.id) === cleanGeneratorId && g.status !== 'archived');
    if (!generator) throw new Error('The linked Assessment Studio generator could not be found.');
    const generatorSafety = astTraineeValidateGenerator(store, generator);
    if (generatorSafety.errors.length) throw new Error(generatorSafety.errors[0]);

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
    verifyLocalAssessmentStudioSubmittedUploads({ silent: true });
    const store = astTraineeGetStore();
    const byGenerator = new Map();
    store.submissions
        .filter(s => astTraineeIdentity(s.trainee) === astTraineeIdentity(trainee) && String(s.status || '') !== 'archived')
        .forEach(sub => {
            const generatorKey = String(sub.generatorId || sub.id || '').trim();
            const key = generatorKey || String(sub.id || '');
            const current = byGenerator.get(key);
            if (!current || astTraineeCompareAssignmentPriority(sub, current) < 0) byGenerator.set(key, sub);
        });
    astTraineeScheduledGeneratorAssignments(store).forEach(sub => {
        const key = String(sub.generatorId || sub.id || '').trim();
        if (key && !byGenerator.has(key)) byGenerator.set(key, sub);
    });
    return Array.from(byGenerator.values())
        .sort((a, b) => String(b.updatedAt || b.generatedAt || '').localeCompare(String(a.updatedAt || a.generatedAt || '')));
}

function renderAssessmentStudioAssignmentsHtml() {
    const assignments = getAssessmentStudioAssignmentsForCurrentUser();
    if (!assignments.length) return '';
    const uploadStatuses = astTraineeUploadStatusMap();
    const cards = assignments.map(sub => {
        const status = String(sub.status || 'assigned');
        const uploadStatus = uploadStatuses[String(sub.id)] || null;
        const uploadState = String(uploadStatus && uploadStatus.state || '').trim();
        const needsUploadRecovery = ['missing', 'failed'].includes(uploadState);
        const isUploadingRecovery = uploadState === 'uploading';
        const feedbackStatus = String(sub.feedbackStatus || 'none').trim().toLowerCase();
        const isOpen = ['assigned', 'in_progress'].includes(status);
        const statusLabel = status === 'pending_review' ? 'Pending Review' : status === 'completed' ? `Completed (${Math.round(Number(sub.percent || 0))}%)` : status === 'in_progress' ? 'In Progress' : 'Not Started';
        const statusClass = status === 'completed' ? 'status-pass' : status === 'pending_review' ? 'status-semi' : 'status-improve';
        const questions = Array.isArray(sub.testSnapshot?.questions) ? sub.testSnapshot.questions.length : 0;
        const questionLabel = sub._scheduleOnly ? 'Ready to generate' : `${questions} Questions`;
        const actionHtml = sub._scheduleOnly
            ? `<button class="btn-primary btn-sm" onclick="openAssessmentStudioFromSchedule('${astTraineeEsc(sub.generatorId)}')">Start Studio Test</button>`
            : isOpen
                ? `<button class="btn-primary btn-sm" onclick="openAssessmentStudioTraineeRuntime('${astTraineeEsc(sub.id)}')">${status === 'in_progress' ? 'Resume' : 'Start'} Studio Test</button>`
                : '<button class="btn-secondary btn-sm" disabled>Submitted</button>';
        const uploadHtml = needsUploadRecovery
            ? `<span class="status-badge status-fail"><i class="fas fa-cloud-exclamation"></i> Upload Failed</span><button class="btn-warning btn-sm" onclick="retryAssessmentStudioSubmissionUpload('${astTraineeEsc(sub.id)}')"><i class="fas fa-cloud-arrow-up"></i> Re-upload</button>`
            : isUploadingRecovery
                ? '<span class="status-badge status-semi"><i class="fas fa-circle-notch fa-spin"></i> Re-uploading</span>'
                : '';
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
                        <span><i class="fas fa-clipboard-list"></i> Assessment Studio</span>
                        <span><i class="fas fa-list-ol"></i> ${astTraineeEsc(questionLabel)}</span>
                        <span><i class="fas fa-shield-halved"></i> Snapshot ${astTraineeEsc(sub.testSnapshot?.signature || sub.id).slice(0, 12)}</span>
                    </div>
                </div>
                <div class="test-card-actions" style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                    <span class="status-badge ${statusClass}">${astTraineeEsc(statusLabel)}</span>
                    ${actionHtml}
                    ${uploadHtml}
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

async function retryAssessmentStudioSubmissionUpload(submissionId) {
    const id = String(submissionId || '').trim();
    if (!id) return false;
    astTraineeSetUploadStatus(id, { state: 'uploading', message: 'Re-uploading to Supabase.' });
    if (typeof loadTraineeTests === 'function') loadTraineeTests();
    const ok = await recoverLocalAssessmentStudioSubmissionsToServer({ silent: false, submissionId: id });
    if (!ok) {
        astTraineeSetUploadStatus(id, { state: 'failed', message: 'Re-upload did not confirm.' });
        if (typeof loadTraineeTests === 'function') loadTraineeTests();
    }
    return ok;
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
    if (!sub) {
        AST_ACTIVE_SUBMISSION_ID = '';
        astTraineeClearActiveSnapshot();
        if (typeof showToast === 'function') showToast('Assessment Studio test could not be found. Refresh My Assessments and try again.', 'error');
        if (typeof showTab === 'function') showTab('my-tests');
        return;
    }
    const safetyErrors = astTraineeSubmissionSafetyErrors(sub);
    if (safetyErrors.length) {
        AST_ACTIVE_SUBMISSION_ID = '';
        astTraineeClearActiveSnapshot();
        if (typeof showToast === 'function') showToast(safetyErrors[0], 'error');
        if (typeof showTab === 'function') showTab('my-tests');
        return;
    }
    if (sub && !['assigned', 'in_progress'].includes(String(sub.status || ''))) {
        AST_ACTIVE_SUBMISSION_ID = '';
        astTraineeClearActiveSnapshot();
        if (typeof showToast === 'function') showToast('This Assessment Studio test has already been submitted and cannot be reopened.', 'warning');
        if (typeof showTab === 'function') showTab('my-tests');
        if (typeof loadTraineeTests === 'function') loadTraineeTests();
        return;
    }
    if (sub && sub.status === 'assigned') {
        sub.status = 'in_progress';
        sub.updatedAt = new Date().toISOString();
        astTraineeRememberActiveSubmission(sub);
        astTraineeSaveStore(store, false);
    }
    astTraineeRememberActiveSubmission(sub);
    if (typeof showTab === 'function') showTab('assessment-studio-trainee');
    renderAssessmentStudioTraineeRuntime({ force: true });
}

function astTraineeGetActiveSubmission() {
    const store = astTraineeGetStore();
    let sub = store.submissions.find(item => String(item.id) === String(AST_ACTIVE_SUBMISSION_ID));
    if (!sub && AST_ACTIVE_SUBMISSION_SNAPSHOT && String(AST_ACTIVE_SUBMISSION_SNAPSHOT.id || '') === String(AST_ACTIVE_SUBMISSION_ID || '')) {
        const snapshot = astTraineeNormalizeSubmission(AST_ACTIVE_SUBMISSION_SNAPSHOT);
        if (astTraineeCanKeepRuntimeOpen(snapshot)) {
            store.submissions.unshift(snapshot);
            localStorage.setItem(AST_TRAINEE_LOCAL_KEY, JSON.stringify(store));
            sub = snapshot;
        }
    }
    if (sub && astTraineeCanKeepRuntimeOpen(sub)) astTraineeRememberActiveSubmission(sub);
    if (sub && !astTraineeCanKeepRuntimeOpen(sub)) astTraineeClearActiveSnapshot();
    return { store, sub };
}

function astTraineeAnswerValue(sub, idx) {
    return sub && sub.answers && Object.prototype.hasOwnProperty.call(sub.answers, idx) ? sub.answers[idx] : undefined;
}

function astTraineeAnswerCompleteness(sub) {
    const questions = Array.isArray(sub?.testSnapshot?.questions) ? sub.testSnapshot.questions : [];
    const answered = questions.filter((q, idx) => {
        const value = astTraineeAnswerValue(sub, idx);
        return astTraineeAnswerIsComplete(q, value);
    }).length;
    return { answered, total: questions.length };
}

function renderAssessmentStudioTraineeRuntime(options = {}) {
    const root = document.getElementById('assessmentStudioTraineeRuntime');
    if (!root) return;
    if (!options.force && astTraineeIsRuntimeInputFocused()) {
        AST_TRAINEE_PENDING_RENDER = true;
        recoverLocalAssessmentStudioSubmissionsToServer({ silent: true });
        return;
    }
    AST_TRAINEE_PENDING_RENDER = false;
    recoverLocalAssessmentStudioSubmissionsToServer({ silent: true });
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
                    <h3 class="ast-trainee-question-text">${astTraineeEsc(q.text)}</h3>
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
        return `<div class="ast-match-list" role="group" aria-label="Matching pairs">${(q.pairs || []).map((pair, pairIdx) => `
            <label class="ast-match-row">
                <span class="ast-match-left">${astTraineeEsc(pair.left)}</span>
                <select ${disabled} onchange="setAssessmentStudioObjectAnswer(${idx}, ${pairIdx}, this.value)" aria-label="Match for ${astTraineeEsc(pair.left)}">
                    <option value="">Select match...</option>
                    ${choices.map(choice => `<option value="${astTraineeEsc(choice)}" ${answer && answer[pairIdx] === choice ? 'selected' : ''}>${astTraineeEsc(choice)}</option>`).join('')}
                </select>
            </label>
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
        const cols = Array.isArray(q.cols) ? q.cols : [];
        return `<div class="ast-matrix-scroll" role="region" aria-label="Matrix question ${idx + 1}">
            <div class="ast-matrix-grid" style="--ast-matrix-cols:${Math.max(cols.length, 1)}">
                <div class="ast-matrix-corner" aria-hidden="true"></div>
                ${cols.map(col => `<div class="ast-matrix-col-head">${astTraineeEsc(col)}</div>`).join('')}
                ${(q.rows || []).map((row, rowIdx) => `
                    <div class="ast-matrix-row-head">${astTraineeEsc(row)}</div>
                    ${cols.map((col, colIdx) => `
                        <label class="ast-matrix-cell">
                            <input type="radio" name="ast_matrix_${idx}_${rowIdx}" value="${colIdx}" ${answer && Number(answer[rowIdx]) === colIdx ? 'checked' : ''} ${disabled} onchange="setAssessmentStudioObjectAnswer(${idx}, ${rowIdx}, Number(this.value))">
                        </label>
                    `).join('')}
                `).join('')}
            </div>
        </div>`;
    }
    return `<textarea rows="5" ${disabled} oninput="setAssessmentStudioAnswer(${idx}, this.value)" placeholder="Enter your answer...">${astTraineeEsc(answer || '')}</textarea>`;
}

function setAssessmentStudioAnswer(idx, value) {
    const { store, sub } = astTraineeGetActiveSubmission();
    if (!sub || !['assigned', 'in_progress'].includes(sub.status)) return;
    sub.answers[String(idx)] = value;
    sub.status = 'in_progress';
    sub.updatedAt = new Date().toISOString();
    astTraineeRememberActiveSubmission(sub);
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
    astTraineeRememberActiveSubmission(sub);
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
    astTraineeRememberActiveSubmission(sub);
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
    astTraineeRememberActiveSubmission(sub);
    try {
        await astTraineeSaveStore(store, true);
        if (typeof showToast === 'function') showToast('Assessment Studio draft saved.', 'success');
    } catch (error) {
        console.warn('[Assessment Studio Trainee] draft save failed:', error);
        if (typeof showToast === 'function') showToast(error.message || 'Assessment Studio draft could not be confirmed.', 'error');
        else alert(error.message || 'Assessment Studio draft could not be confirmed.');
    }
}

function astTraineeScoreRound(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
}

function astTraineeScoreText(value) {
    return String(value === undefined || value === null ? '' : value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function astTraineeGetValueAt(value, key) {
    if (Array.isArray(value)) return value[key];
    if (value && typeof value === 'object') {
        if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
        if (Object.prototype.hasOwnProperty.call(value, String(key))) return value[String(key)];
    }
    return undefined;
}

function astTraineeChoiceIndex(q, value) {
    if (value !== null && value !== undefined && String(value).trim() !== '' && Number.isInteger(Number(value))) return Number(value);
    const wanted = astTraineeScoreText(value);
    if (!wanted) return -1;
    return (q.options || []).findIndex(option => astTraineeScoreText(option) === wanted);
}

function astTraineeChoiceIndexSet(q, values) {
    return new Set((Array.isArray(values) ? values : [])
        .map(value => astTraineeChoiceIndex(q, value))
        .filter(value => Number.isInteger(value) && value >= 0));
}

function scoreAssessmentStudioQuestion(q, answer) {
    const max = Number(q.points || 1);
    if (q.type === 'text') return { score: 0, max, manual: true };
    if (q.type === 'multiple_choice') return { score: astTraineeChoiceIndex(q, answer) === astTraineeChoiceIndex(q, q.correct) ? max : 0, max, manual: false };
    if (q.type === 'multi_select') {
        const correct = astTraineeChoiceIndexSet(q, Array.isArray(q.correct) ? q.correct : []);
        const got = astTraineeChoiceIndexSet(q, Array.isArray(answer) ? answer : []);
        if (!correct.size) return { score: 0, max, manual: false };
        const correctSelected = Array.from(got).filter(v => correct.has(v)).length;
        const wrongSelected = Array.from(got).filter(v => !correct.has(v)).length;
        const unit = max / correct.size;
        const score = Math.max(0, Math.min(max, (correctSelected - wrongSelected) * unit));
        return { score: astTraineeScoreRound(score), max, manual: false };
    }
    if (q.type === 'matching') {
        const pairs = Array.isArray(q.pairs) ? q.pairs : [];
        const correct = pairs.filter((p, pairIdx) => answer && answer[pairIdx] === p.right).length;
        return { score: pairs.length ? Math.round((correct / pairs.length) * max * 10) / 10 : 0, max, manual: false };
    }
    if (q.type === 'ranking') {
        const expected = Array.isArray(q.items) ? q.items : [];
        const got = Array.isArray(answer) ? answer : [];
        if (!expected.length) return { score: 0, max, manual: false };
        const correctPositions = expected.filter((v, i) => astTraineeScoreText(got[i]) === astTraineeScoreText(v)).length;
        return { score: astTraineeScoreRound((correctPositions / expected.length) * max), max, manual: false };
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
    const safetyErrors = astTraineeSubmissionSafetyErrors(sub, { requireAnswers: true });
    if (safetyErrors.length) {
        if (typeof showToast === 'function') showToast(safetyErrors[0], 'warning');
        else alert(safetyErrors[0]);
        return;
    }
    if (completeness.answered < completeness.total) return;

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
    astTraineeRememberActiveSubmission(sub);
    try {
        await astTraineeSaveStore(store, true);
        await recoverLocalAssessmentStudioSubmissionsToServer({ silent: true });
    } catch (error) {
        console.warn('[Assessment Studio Trainee] submit failed:', error);
        astTraineeSetUploadStatus(sub.id, {
            state: 'failed',
            message: error.message || 'Assessment submission could not be confirmed on Supabase.'
        });
        localStorage.setItem(AST_TRAINEE_LOCAL_KEY, JSON.stringify(store));
        localStorage.setItem(AST_TRAINEE_DATA_KEY, JSON.stringify(astTraineeMergeServerStoreWithLocalDrafts(astTraineeGetStore(), store)));
        AST_ACTIVE_SUBMISSION_ID = '';
        astTraineeClearActiveSnapshot();
        if (typeof showToast === 'function') showToast('Assessment submitted locally, but upload failed. Use Re-upload from My Assessments.', 'error');
        else alert(error.message || 'Assessment submission could not be confirmed.');
        if (typeof loadTraineeTests === 'function') loadTraineeTests();
        if (typeof showTab === 'function') showTab('my-tests');
        return;
    }
    if (typeof showToast === 'function') showToast('Assessment submitted to the grading queue.', 'success');
    AST_ACTIVE_SUBMISSION_ID = '';
    astTraineeClearActiveSnapshot();
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
    try {
        await astTraineeSaveStore(store, true);
    } catch (error) {
        console.warn('[Assessment Studio Trainee] feedback request save failed:', error);
        if (typeof showToast === 'function') showToast(error.message || 'Feedback request could not be confirmed.', 'error');
        else alert(error.message || 'Feedback request could not be confirmed.');
        return;
    }
    if (typeof saveToServer === 'function') {
        try {
            const ok = await saveToServer(['assessment_studio_data', 'admin_notifications'], true, true);
            if (ok === false) throw new Error('Assessment Studio feedback sync did not confirm.');
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
window.submitAssessmentStudioTest = submitAssessmentStudioTest;
window.requestAssessmentStudioFeedback = requestAssessmentStudioFeedback;
window.refreshAssessmentStudioTraineeStoreFromServer = refreshAssessmentStudioTraineeStoreFromServer;
window.recoverLocalAssessmentStudioSubmissionsToServer = recoverLocalAssessmentStudioSubmissionsToServer;
window.verifyLocalAssessmentStudioSubmittedUploads = verifyLocalAssessmentStudioSubmittedUploads;
window.retryAssessmentStudioSubmissionUpload = retryAssessmentStudioSubmissionUpload;

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('focusout', (event) => {
        const root = document.getElementById('assessmentStudioTraineeRuntime');
        if (!root || !AST_TRAINEE_PENDING_RENDER || !event || !event.target || typeof root.contains !== 'function' || !root.contains(event.target)) return;
        setTimeout(() => {
            if (AST_TRAINEE_PENDING_RENDER && !astTraineeIsRuntimeInputFocused()) renderAssessmentStudioTraineeRuntime({ force: true });
        }, 150);
    });
}

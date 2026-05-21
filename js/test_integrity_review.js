/* ================= TEST ENGINE: INTEGRITY REVIEW ================= */
/* Review-first assessment/live/vetting data audit. No automatic deletion. */

const TEST_INTEGRITY_DEFAULT_COVERAGE = 80;
const TEST_INTEGRITY_ATTEMPT_GAP_DAYS = 10;
const TEST_INTEGRITY_OVERRIDES_KEY = 'test_integrity_overrides';

function testIntegrityParse(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null || raw === undefined || raw === '' || raw === 'undefined' || raw === 'null') return fallback;
        const parsed = JSON.parse(raw);
        return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (error) {
        return fallback;
    }
}

function testIntegrityEscape(value) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function testIntegrityNormalize(value) {
    return String(value || '').trim().toLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function testIntegrityDateMs(value) {
    const ts = Date.parse(value || '');
    return Number.isFinite(ts) ? ts : 0;
}

function testIntegrityDaysBetween(a, b) {
    const left = testIntegrityDateMs(a);
    const right = testIntegrityDateMs(b);
    if (!left || !right) return 0;
    return Math.round(Math.abs(right - left) / 86400000);
}

function testIntegrityGetSubmissionType(submission, testsById) {
    const snapshotType = testIntegrityNormalize(submission && submission.testSnapshot && submission.testSnapshot.type);
    if (snapshotType) return snapshotType;
    const testId = String(submission && submission.testId || '');
    if (testId && testsById[testId]) return testsById[testId];
    const title = testIntegrityNormalize(submission && submission.testTitle);
    if (title.includes('vetting')) return 'vetting';
    if (title.includes('live')) return 'live';
    if (title.includes('quiz')) return 'quiz';
    return 'standard';
}

function testIntegrityQuestionRequiresManual(question) {
    const type = testIntegrityNormalize(question && question.type);
    return type === 'text' || type === 'live practical' || type === 'live_practical' || type === 'practical';
}

function testIntegrityAnswerHasValue(answer) {
    if (answer === undefined || answer === null) return false;
    if (typeof answer === 'string') return answer.trim() !== '';
    if (Array.isArray(answer)) return answer.length > 0;
    if (typeof answer === 'object') return Object.keys(answer).length > 0;
    return true;
}

function testIntegrityGetAnswer(answers, question, index) {
    if (!answers || typeof answers !== 'object') return undefined;
    const lookupIdx = question && question._originalIndex !== undefined ? question._originalIndex : index;
    if (answers[lookupIdx] !== undefined) return answers[lookupIdx];
    if (answers[String(lookupIdx)] !== undefined) return answers[String(lookupIdx)];
    if (answers[index] !== undefined) return answers[index];
    return answers[String(index)];
}

function testIntegrityFindLinkedRecord(submission, records) {
    if (!submission) return null;
    return (records || []).find(record => record && record.submissionId && String(record.submissionId) === String(submission.id))
        || (records || []).find(record => record && String(record.id || '') === `record_${submission.id}`)
        || (records || []).find(record => record && submission.bookingId && record.bookingId === submission.bookingId)
        || (records || []).find(record => record && submission.liveSessionId && record.liveSessionId === submission.liveSessionId)
        || null;
}

function testIntegrityResolveTest(submission, tests) {
    if (submission && submission.testSnapshot && Array.isArray(submission.testSnapshot.questions)) {
        return submission.testSnapshot;
    }
    return (tests || []).find(test => {
        return String(test && test.id || '') === String(submission && submission.testId || '')
            || testIntegrityNormalize(test && test.title) === testIntegrityNormalize(submission && submission.testTitle);
    }) || null;
}

function testIntegrityStatusTone(status) {
    if (status === 'valid') return 'status-pass';
    if (status === 'review') return 'status-semi';
    return 'status-critical';
}

function testIntegrityEntryKey(rowOrSource, id, recordId) {
    if (rowOrSource && typeof rowOrSource === 'object') {
        return `${rowOrSource.source || 'entry'}:${rowOrSource.id || rowOrSource.recordId || ''}`;
    }
    return `${rowOrSource || 'entry'}:${id || recordId || ''}`;
}

function testIntegrityIdentityToken(value) {
    return testIntegrityNormalize(value).replace(/\s+/g, '');
}

function testIntegrityArchiveDate(entry) {
    return String(entry && (entry.movedDate || entry.graduatedDate || entry.archivedAt || entry.createdAt || entry.date) || '').trim();
}

function testIntegrityRowOwnerToken(row) {
    return testIntegrityIdentityToken(row && (row.trainee || row.user || row.username || row.agent || row.user_id));
}

function testIntegrityRecordKey(row) {
    if (!row) return '';
    if (row.id) return `id:${row.id}`;
    return `${testIntegrityRowOwnerToken(row)}|${testIntegrityNormalize(row.assessment || row.testTitle)}|${row.date || ''}|${row.score || ''}`;
}

function testIntegritySubmissionKey(row) {
    if (!row) return '';
    if (row.id) return `id:${row.id}`;
    return `${testIntegrityRowOwnerToken(row)}|${testIntegrityNormalize(row.testTitle || row.assessment)}|${row.date || ''}|${row.score || ''}`;
}

function testIntegritySameKeySet(left, right, keyFn) {
    const leftSet = new Set((Array.isArray(left) ? left : []).map(keyFn).filter(Boolean));
    const rightSet = new Set((Array.isArray(right) ? right : []).map(keyFn).filter(Boolean));
    if (leftSet.size !== rightSet.size || leftSet.size === 0) return false;
    for (const key of leftSet) {
        if (!rightSet.has(key)) return false;
    }
    return true;
}

function testIntegrityArchiveRowCount(entry, key) {
    return Array.isArray(entry && entry[key]) ? entry[key].length : 0;
}

function getRetrainArchivesForIntegrity() {
    const archives = testIntegrityParse('retrain_archives', []);
    return Array.isArray(archives) ? archives : [];
}

async function saveRetrainArchivesForIntegrity(archives) {
    const next = Array.isArray(archives) ? archives : [];
    localStorage.setItem('retrain_archives', JSON.stringify(next));
    if (typeof saveToServer === 'function') {
        await saveToServer(['retrain_archives'], true);
    }
}

function buildRetrainArchiveIntegrityRows() {
    const archives = getRetrainArchivesForIntegrity();
    const byUser = new Map();
    archives.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') return;
        const archiveType = testIntegrityNormalize(entry.archiveType || '');
        const reason = testIntegrityNormalize(entry.reason || '');
        if (archiveType !== 'retrain' && !reason.includes('retrain') && !reason.startsWith('moved to')) return;
        const userToken = testIntegrityIdentityToken(entry.user || entry.trainee || entry.agent || entry.username);
        if (!userToken) return;
        if (!byUser.has(userToken)) byUser.set(userToken, []);
        byUser.get(userToken).push({ entry, index });
    });

    const rows = [];
    byUser.forEach((items) => {
        items.sort((a, b) => {
            const dateDiff = testIntegrityDateMs(testIntegrityArchiveDate(a.entry)) - testIntegrityDateMs(testIntegrityArchiveDate(b.entry));
            if (dateDiff !== 0) return dateDiff;
            return a.index - b.index;
        });
        const firstEntry = items[0] && items[0].entry;
        items.forEach((item, sequenceIndex) => {
            const entry = item.entry;
            const user = String(entry.user || entry.trainee || entry.agent || entry.username || '').trim();
            const userToken = testIntegrityIdentityToken(user);
            const recordCount = testIntegrityArchiveRowCount(entry, 'records');
            const submissionCount = testIntegrityArchiveRowCount(entry, 'submissions');
            const attendanceCount = testIntegrityArchiveRowCount(entry, 'attendance');
            const mixedRecords = (Array.isArray(entry.records) ? entry.records : []).filter(row => testIntegrityRowOwnerToken(row) && testIntegrityRowOwnerToken(row) !== userToken).length;
            const mixedSubmissions = (Array.isArray(entry.submissions) ? entry.submissions : []).filter(row => testIntegrityRowOwnerToken(row) && testIntegrityRowOwnerToken(row) !== userToken).length;
            const mixedAttendance = (Array.isArray(entry.attendance) ? entry.attendance : []).filter(row => testIntegrityRowOwnerToken(row) && testIntegrityRowOwnerToken(row) !== userToken).length;
            const repeatedRecords = sequenceIndex > 0 && testIntegritySameKeySet(firstEntry && firstEntry.records, entry.records, testIntegrityRecordKey);
            const repeatedSubmissions = sequenceIndex > 0 && testIntegritySameKeySet(firstEntry && firstEntry.submissions, entry.submissions, testIntegritySubmissionKey);
            const archiveStatus = testIntegrityNormalize(entry.archiveReviewStatus || '');
            const reasons = [];
            const warnings = [];

            if (!recordCount && !submissionCount) reasons.push('Archive has no assessment records or submissions.');
            if (mixedRecords || mixedSubmissions || mixedAttendance) {
                reasons.push(`Archive contains rows for another trainee: records ${mixedRecords}, submissions ${mixedSubmissions}, attendance ${mixedAttendance}.`);
            }
            if (sequenceIndex > 0 && repeatedRecords && repeatedSubmissions) warnings.push('Records and submissions repeat the first archive for this trainee.');
            if (sequenceIndex > 1) warnings.push(`This is archive snapshot ${sequenceIndex + 1} for the trainee.`);
            if (archiveStatus) warnings.push(`Admin archive decision: ${archiveStatus}.`);

            let verdict = 'valid';
            if (['valid', 'review', 'invalid'].includes(archiveStatus)) verdict = archiveStatus;
            else if (reasons.length) verdict = 'invalid';
            else if (warnings.length || sequenceIndex > 0) verdict = 'review';

            rows.push({
                source: 'retrain_archive',
                id: String(entry.id || ''),
                recordId: '',
                type: 'archive',
                trainee: user,
                title: String(entry.reason || entry.attemptLabel || 'Retrain archive').trim(),
                date: testIntegrityArchiveDate(entry),
                submittedAt: testIntegrityArchiveDate(entry),
                groupID: String(entry.targetGroup || entry.fromGroup || entry.group || '').trim(),
                status: archiveStatus || 'archive',
                archived: false,
                archiveStatus,
                score: null,
                recordScore: null,
                questionCount: recordCount + submissionCount,
                answeredCount: recordCount + submissionCount,
                coverage: recordCount || submissionCount ? 100 : 0,
                manualCount: 0,
                manualGradedCount: 0,
                reviewedBy: entry.cleanupUpdatedAt || entry.updatedBy || '',
                auditCount: 0,
                inferredAttempt: Number(entry.attemptNumber) || sequenceIndex + 1,
                attemptSource: entry.attemptNumber ? 'archive field' : 'archive order',
                daysSincePrevious: null,
                completenessLabel: `${recordCount} records, ${submissionCount} submissions, ${attendanceCount} attendance`,
                reviewLabel: archiveStatus ? `Archive marked ${archiveStatus}` : 'Retrain archive snapshot',
                evidenceLabel: `From ${entry.fromGroup || 'unknown group'} to ${entry.targetGroup || 'unknown group'}. ID ${entry.id || 'missing'}.`,
                verdict,
                reasons,
                warnings,
                archiveEntry: entry,
                archiveIndex: item.index,
                entryKey: testIntegrityEntryKey('retrain_archive', entry.id || item.index, '')
            });
        });
    });
    return rows;
}

function getTestIntegrityOverrides() {
    const raw = testIntegrityParse(TEST_INTEGRITY_OVERRIDES_KEY, { entries: {} });
    return raw && typeof raw === 'object' && raw.entries && typeof raw.entries === 'object'
        ? raw
        : { entries: {} };
}

async function saveTestIntegrityOverrides(overrides) {
    const next = overrides && typeof overrides === 'object' ? overrides : { entries: {} };
    next.entries = next.entries && typeof next.entries === 'object' ? next.entries : {};
    next.updatedAt = new Date().toISOString();
    next.updatedBy = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.user) ? CURRENT_USER.user : 'Unknown';
    localStorage.setItem(TEST_INTEGRITY_OVERRIDES_KEY, JSON.stringify(next));
    if (typeof saveToServer === 'function') {
        await saveToServer([TEST_INTEGRITY_OVERRIDES_KEY], true);
    }
}

function applyTestIntegrityOverrides(rows) {
    const overrides = getTestIntegrityOverrides();
    (rows || []).forEach((row) => {
        const key = testIntegrityEntryKey(row);
        const override = overrides.entries[key] || null;
        row.entryKey = key;
        row.override = override;
        if (!override) return;

        if (['valid', 'review', 'invalid'].includes(String(override.verdict || '').toLowerCase())) {
            row.autoVerdict = row.verdict;
            row.verdict = String(override.verdict).toLowerCase();
            row.overrideReason = `Admin override: ${row.verdict}${override.note ? ` - ${override.note}` : ''}`;
        }
        if (Number(override.attemptNumber) === 1 || Number(override.attemptNumber) === 2) {
            row.inferredAttempt = Number(override.attemptNumber);
            row.attemptSource = 'manual';
        }
    });
}

function testIntegrityBuildAttemptMap(rows) {
    const buckets = new Map();
    rows.forEach((row) => {
        const key = `${testIntegrityNormalize(row.trainee)}|${testIntegrityNormalize(row.title)}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(row);
    });

    buckets.forEach((items) => {
        items.sort((a, b) => testIntegrityDateMs(a.submittedAt || a.date) - testIntegrityDateMs(b.submittedAt || b.date));
        let attempt = 1;
        let previous = null;
        items.forEach((item) => {
            const itemDate = item.submittedAt || item.date;
            if (previous && testIntegrityDaysBetween(previous, itemDate) >= TEST_INTEGRITY_ATTEMPT_GAP_DAYS) attempt += 1;
            item.inferredAttempt = attempt;
            item.daysSincePrevious = previous ? testIntegrityDaysBetween(previous, itemDate) : null;
            item.attemptSource = item.daysSincePrevious ? 'date-gap' : 'first-seen';
            previous = itemDate;
        });
    });
}

function buildTestIntegrityRows() {
    const tests = testIntegrityParse('tests', []);
    const submissions = testIntegrityParse('submissions', []);
    const records = testIntegrityParse('records', []);
    const users = testIntegrityParse('users', []);
    const rosters = testIntegrityParse('rosters', {});
    const testsById = {};
    (Array.isArray(tests) ? tests : []).forEach(test => {
        if (test && test.id !== undefined) testsById[String(test.id)] = testIntegrityNormalize(test.type || 'standard') || 'standard';
    });

    const rows = [];
    const linkedRecordIds = new Set();

    (Array.isArray(submissions) ? submissions : []).forEach((submission) => {
        if (!submission || typeof submission !== 'object') return;
        const type = testIntegrityGetSubmissionType(submission, testsById);
        if (type === 'quiz') return;
        if (!['standard', 'live', 'vetting'].includes(type)) return;

        const test = testIntegrityResolveTest(submission, tests);
        const questions = test && Array.isArray(test.questions) ? test.questions : [];
        const answers = submission.answers && typeof submission.answers === 'object' ? submission.answers : {};
        const linkedRecord = testIntegrityFindLinkedRecord(submission, records);
        if (linkedRecord && linkedRecord.id) linkedRecordIds.add(String(linkedRecord.id));

        let answeredCount = 0;
        let manualCount = 0;
        let manualGradedCount = 0;
        let maxPoints = 0;
        let scorePointTotal = 0;

        questions.forEach((question, index) => {
            const answer = testIntegrityGetAnswer(answers, question, index);
            const points = Number(question && question.points || 1);
            maxPoints += Number.isFinite(points) ? points : 1;
            if (testIntegrityAnswerHasValue(answer)) answeredCount += 1;
            if (testIntegrityQuestionRequiresManual(question)) {
                manualCount += 1;
                const score = submission.scores && submission.scores[index] !== undefined
                    ? Number(submission.scores[index])
                    : (submission.scores && submission.scores[String(index)] !== undefined ? Number(submission.scores[String(index)]) : NaN);
                if (Number.isFinite(score)) manualGradedCount += 1;
            }
        });

        if (submission.scores && typeof submission.scores === 'object') {
            Object.values(submission.scores).forEach((value) => {
                const score = Number(value);
                if (Number.isFinite(score)) scorePointTotal += score;
            });
        }

        const score = Number(submission.score);
        const recordScore = linkedRecord ? Number(linkedRecord.score) : NaN;
        const coverage = questions.length ? Math.round((answeredCount / questions.length) * 100) : 0;
        const reasons = [];
        const warnings = [];
        const status = testIntegrityNormalize(submission.status || '');
        const archived = submission.archived === true || ['archived', 'deleted', 'invalid', 'retake_allowed'].includes(status);
        const isCompleted = status === 'completed' || status === 'done' || status === 'passed' || status === 'pass';

        if (!test) reasons.push('Missing test definition or saved test snapshot.');
        if (!questions.length) reasons.push('No questions found for this attempt.');
        if (questions.length && coverage < TEST_INTEGRITY_DEFAULT_COVERAGE) reasons.push(`Low answer coverage: ${answeredCount}/${questions.length} questions (${coverage}%).`);
        if (manualCount > 0 && manualGradedCount < manualCount) reasons.push(`Missing admin grading on manual questions: ${manualGradedCount}/${manualCount} graded.`);
        if (!Number.isFinite(score) || score < 0 || score > 100) reasons.push(`Invalid submission score: ${Number.isFinite(score) ? score : 'missing'}.`);
        if (linkedRecord && (!Number.isFinite(recordScore) || recordScore < 0 || recordScore > 100)) reasons.push(`Invalid linked record score: ${Number.isFinite(recordScore) ? recordScore : 'missing'}.`);
        if (linkedRecord && Number.isFinite(score) && Number.isFinite(recordScore) && Math.round(score) !== Math.round(recordScore)) reasons.push(`Submission/record score mismatch: ${score}% vs ${recordScore}%.`);
        if (isCompleted && !linkedRecord) reasons.push('Completed submission has no linked permanent record.');
        if (!isCompleted && !archived) reasons.push(`Not completed/reviewed yet: status '${submission.status || 'missing'}'.`);
        if (isCompleted && Number(score) === 0 && answeredCount > 0) warnings.push('Completed attempt has 0% despite captured answers.');
        if (manualCount > 0 && manualGradedCount === manualCount && (submission.lastEditedBy || submission.modifiedBy || Array.isArray(submission.markingAudit))) {
            warnings.push('Manual questions appear admin-reviewed.');
        }

        let verdict = 'valid';
        if (reasons.length) verdict = 'invalid';
        else if (warnings.some(w => w.includes('0%')) || archived) verdict = 'review';

        rows.push({
            source: 'submission',
            id: String(submission.id || ''),
            recordId: linkedRecord && linkedRecord.id ? String(linkedRecord.id) : '',
            type,
            trainee: String(submission.trainee || '').trim(),
            title: String(submission.testTitle || '').trim(),
            date: String(submission.date || '').trim(),
            submittedAt: String(submission.lastEditedDate || submission.lastModified || submission.createdAt || submission.submittedAt || submission.date || '').trim(),
            groupID: String((linkedRecord && linkedRecord.groupID) || submission.groupID || '').trim(),
            status: submission.status || '',
            archived,
            score: Number.isFinite(score) ? score : null,
            recordScore: Number.isFinite(recordScore) ? recordScore : null,
            questionCount: questions.length,
            answeredCount,
            coverage,
            manualCount,
            manualGradedCount,
            maxPoints,
            scorePointTotal,
            reviewedBy: submission.lastEditedBy || submission.modifiedBy || '',
            auditCount: Array.isArray(submission.markingAudit) ? submission.markingAudit.length : 0,
            completenessLabel: questions.length ? `${answeredCount}/${questions.length} answered (${coverage}%)` : 'No question snapshot',
            reviewLabel: manualCount ? `${manualGradedCount}/${manualCount} manual items graded` : (isCompleted ? 'No manual grading required' : 'Not completed'),
            evidenceLabel: questions.length ? 'Whole attempt checked from saved answers, marking scores, and linked record.' : 'Whole attempt checked from submission/record metadata only.',
            verdict,
            reasons,
            warnings
        });
    });

    (Array.isArray(records) ? records : []).forEach((record) => {
        if (!record || linkedRecordIds.has(String(record.id || ''))) return;
        const title = String(record.assessment || '').trim();
        const phase = testIntegrityNormalize(record.phase || '');
        const link = testIntegrityNormalize(record.link || '');
        const isTarget = phase.includes('vetting') || phase.includes('assessment') || link.includes('live') || link.includes('digital') || title.toLowerCase().includes('vetting');
        if (!isTarget) return;

        const score = Number(record.score);
        const reasons = [];
        const warnings = [];
        if (!record.trainee) reasons.push('Record has no trainee.');
        if (!title) reasons.push('Record has no assessment title.');
        if (!Number.isFinite(score) || score < 0 || score > 100) reasons.push(`Invalid record score: ${Number.isFinite(score) ? score : 'missing'}.`);
        if (Number(score) === 0) warnings.push('Standalone record has 0%; confirm this is a real reviewed mark.');
        if (link.includes('digital') || record.submissionId) reasons.push('Digital-looking record is missing its submission file.');

        rows.push({
            source: 'record',
            id: '',
            recordId: String(record.id || ''),
            type: title.toLowerCase().includes('vetting') || phase.includes('vetting') ? 'vetting' : (link.includes('live') ? 'live' : 'standard'),
            trainee: String(record.trainee || '').trim(),
            title,
            date: String(record.date || '').trim(),
            submittedAt: String(record.lastModified || record.createdAt || record.date || '').trim(),
            groupID: String(record.groupID || '').trim(),
            status: 'record_only',
            archived: record.archived === true,
            score: Number.isFinite(score) ? score : null,
            recordScore: Number.isFinite(score) ? score : null,
            questionCount: 0,
            answeredCount: 0,
            coverage: 0,
            manualCount: 0,
            manualGradedCount: 0,
            reviewedBy: record.modifiedBy || '',
            auditCount: 0,
            verdict: reasons.length ? 'invalid' : 'review',
            reasons,
            warnings,
            completenessLabel: 'Record-only entry',
            reviewLabel: record.modifiedBy ? `Marked by ${record.modifiedBy}` : 'Manual record/no submission evidence',
            evidenceLabel: 'Whole attempt has no submission file, so only the permanent record can be reviewed.'
        });
    });

    if (window.ProgressCatalog && typeof window.ProgressCatalog.getTraineeProgress === 'function') {
        const groupFor = (name) => {
            const token = window.ProgressCatalog.identity(name);
            for (const [gid, members] of Object.entries(rosters || {})) {
                if (!Array.isArray(members)) continue;
                if (members.some(member => window.ProgressCatalog.identity(member) === token)) return gid;
            }
            return '';
        };
        const traineeNames = new Set();
        (Array.isArray(users) ? users : []).forEach(user => {
            if (String(user && user.role || '').toLowerCase() === 'trainee') traineeNames.add(String(user.user || user.username || '').trim());
        });
        (Array.isArray(records) ? records : []).forEach(row => traineeNames.add(String(row && row.trainee || '').trim()));
        (Array.isArray(submissions) ? submissions : []).forEach(row => traineeNames.add(String(row && row.trainee || '').trim()));

        Array.from(traineeNames).filter(Boolean).forEach((trainee) => {
            const groupID = groupFor(trainee);
            const progress = window.ProgressCatalog.getTraineeProgress(trainee, groupID, {
                includeAuto: false,
                data: {
                    records,
                    submissions,
                    liveBookings: testIntegrityParse('liveBookings', []),
                    exemptions: testIntegrityParse('exemptions', [])
                }
            });
            (progress.items || []).forEach((item) => {
                if (item.status !== 'missing') return;
                const type = item.type === 'vetting' ? 'vetting' : (item.type === 'live' ? 'live' : 'standard');
                rows.push({
                    source: 'progress_catalog',
                    id: `missing_${window.ProgressCatalog.identity(trainee)}_${window.ProgressCatalog.identity(item.name)}`,
                    recordId: '',
                    type,
                    trainee,
                    title: item.name,
                    date: '',
                    submittedAt: '',
                    groupID,
                    status: 'missing_required_progress',
                    archived: false,
                    score: null,
                    recordScore: null,
                    questionCount: 0,
                    answeredCount: 0,
                    coverage: 0,
                    manualCount: 0,
                    manualGradedCount: 0,
                    reviewedBy: '',
                    auditCount: 0,
                    verdict: 'review',
                    reasons: ['Official progress catalog expects this item, but no completed submission, record, live booking, or exemption was found.'],
                    warnings: [],
                    completenessLabel: 'Missing official progress item',
                    reviewLabel: 'Needs admin confirmation',
                    evidenceLabel: `Official catalog type: ${item.type || 'assessment'}`
                });
            });
        });
    }

    const archiveRows = buildRetrainArchiveIntegrityRows();
    testIntegrityBuildAttemptMap(rows);
    rows.push(...archiveRows);
    applyTestIntegrityOverrides(rows);
    rows.sort((a, b) => testIntegrityDateMs(b.submittedAt || b.date) - testIntegrityDateMs(a.submittedAt || a.date));
    return rows;
}

function getCurrentTestIntegrityFilters() {
    return {
        verdict: document.getElementById('integrityVerdictFilter')?.value ?? window.__TEST_INTEGRITY_LAST_FILTERS?.verdict ?? 'invalid',
        type: document.getElementById('integrityTypeFilter')?.value ?? window.__TEST_INTEGRITY_LAST_FILTERS?.type ?? '',
        title: document.getElementById('integrityAssessmentFilter')?.value ?? window.__TEST_INTEGRITY_LAST_FILTERS?.title ?? '',
        search: document.getElementById('integritySearch')?.value ?? window.__TEST_INTEGRITY_LAST_FILTERS?.search ?? ''
    };
}

function getFilteredTestIntegrityRows(filters) {
    const activeFilters = filters || getCurrentTestIntegrityFilters();
    const verdict = activeFilters.verdict || '';
    const type = activeFilters.type || '';
    const title = activeFilters.title || '';
    const search = testIntegrityNormalize(activeFilters.search || '');
    return buildTestIntegrityRows().filter((row) => {
        if (verdict && row.verdict !== verdict) return false;
        if (type && row.type !== type) return false;
        if (title && testIntegrityNormalize(row.title) !== title) return false;
        if (search && !testIntegrityNormalize(`${row.trainee} ${row.title} ${row.groupID} ${row.id} ${row.status}`).includes(search)) return false;
        return true;
    });
}

function renderTestIntegrityReview() {
    const container = document.getElementById('testIntegrityReview');
    if (!container) return;

    const filters = getCurrentTestIntegrityFilters();
    window.__TEST_INTEGRITY_LAST_FILTERS = filters;
    const allRows = buildTestIntegrityRows();
    const rows = getFilteredTestIntegrityRows(filters);
    const counts = allRows.reduce((acc, row) => {
        acc[row.verdict] = (acc[row.verdict] || 0) + 1;
        acc.total += 1;
        return acc;
    }, { total: 0, valid: 0, review: 0, invalid: 0 });
    const titleOptions = Array.from(new Map(
        allRows
            .map(row => [testIntegrityNormalize(row.title), row.title])
            .filter(([key, label]) => key && label)
    ).entries()).sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true, sensitivity: 'base' }));

    const esc = testIntegrityEscape;
    container.innerHTML = `
        <div class="card">
            <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
                <div>
                    <h3 style="margin:0 0 4px 0;">Assessment Integrity Review</h3>
                    <p class="test-engine-subtitle" style="margin:0;">Reviews each assessment attempt as a whole entry. Question answers and marking are only used as evidence, and your manual Valid/Invalid/Attempt 1/Attempt 2 decisions override the automated guess.</p>
                </div>
                <button class="btn-secondary btn-sm" onclick="if(typeof forceResyncRows==='function'){forceResyncRows()} else if(typeof loadFromServer==='function'){loadFromServer(true)}"><i class="fas fa-sync"></i> Refresh From Server</button>
            </div>
            <div class="ins-mini-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); margin-top:12px;">
                <div class="ins-mini"><strong>${counts.total}</strong><span class="ins-subtle">Total Entries</span></div>
                <div class="ins-mini"><strong>${counts.invalid}</strong><span class="ins-subtle">Invalid Flags</span></div>
                <div class="ins-mini"><strong>${counts.review}</strong><span class="ins-subtle">Needs Review</span></div>
                <div class="ins-mini"><strong>${counts.valid}</strong><span class="ins-subtle">Looks Valid</span></div>
            </div>
            <div class="grid-4" style="margin-top:14px;">
                <div><label>Result</label><select id="integrityVerdictFilter" onchange="rememberTestIntegrityFilters(); renderTestIntegrityReview()"><option value="invalid">Invalid Only</option><option value="review">Needs Review</option><option value="valid">Valid</option><option value="">All</option></select></div>
                <div><label>Type</label><select id="integrityTypeFilter" onchange="rememberTestIntegrityFilters(); renderTestIntegrityReview()"><option value="">All Types</option><option value="standard">Assessment</option><option value="live">Live Assessment</option><option value="vetting">Vetting</option><option value="archive">Retrain Archives</option></select></div>
                <div><label>Assessment / Vetting / Live</label><select id="integrityAssessmentFilter" onchange="rememberTestIntegrityFilters(); renderTestIntegrityReview()"><option value="">All Assessments</option>${titleOptions.map(([key, label]) => `<option value="${esc(key)}">${esc(label)}</option>`).join('')}</select></div>
                <div><label>Search</label><input id="integritySearch" type="text" placeholder="Trainee, title, group..." onkeyup="rememberTestIntegrityFilters(); renderTestIntegrityReview()" style="margin-bottom:0;"></div>
            </div>
        </div>
        <div class="card" style="margin-top:14px;">
            <div class="table-responsive" style="max-height:680px; overflow:auto;">
                <table class="admin-table compressed-table">
                    <thead>
                        <tr>
                            <th>Verdict</th><th>Date</th><th>Attempt</th><th>Trainee</th><th>Type</th><th>Title</th><th>Score</th><th>Whole Entry Completeness</th><th>Review State</th><th>Why Flagged</th><th>Fix / Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.length ? rows.map(row => {
                            const reasonList = row.overrideReason ? [row.overrideReason, ...row.reasons, ...row.warnings] : [...row.reasons, ...row.warnings];
                            const reasonHtml = reasonList.map(reason => `<div>${esc(reason)}</div>`).join('') || '<span style="color:var(--text-muted);">No issues detected.</span>';
                            const score = row.score === null ? '-' : `${row.score}%`;
                            const recordScore = row.recordScore !== null && row.recordScore !== row.score ? ` / record ${row.recordScore}%` : '';
                            const canDelete = row.source === 'submission' ? row.id : (row.source === 'retrain_archive' ? '' : row.recordId);
                            const overrideBadge = row.override ? '<div class="ins-subtle">Manual override saved</div>' : '';
                            const attemptSource = row.attemptSource === 'manual' ? 'manual' : (row.daysSincePrevious ? `${row.daysSincePrevious}d gap` : 'first seen');
                            const actionHtml = row.source === 'progress_catalog'
                                ? `
                                    <button class="btn-success btn-sm" onclick="setIntegrityVerdictOverride(decodeURIComponent('${encodeURIComponent(row.entryKey)}'), 'valid')" title="Mark this catalog check valid">Valid</button>
                                    <button class="btn-warning btn-sm" onclick="setIntegrityVerdictOverride(decodeURIComponent('${encodeURIComponent(row.entryKey)}'), 'review')" title="Keep catalog check for review">Review</button>
                                    <button class="btn-secondary btn-sm" onclick="clearIntegrityOverride(decodeURIComponent('${encodeURIComponent(row.entryKey)}'))" title="Clear manual override"><i class="fas fa-undo"></i></button>
                                `
                                : row.source === 'retrain_archive'
                                ? `
                                    <button class="btn-secondary btn-sm" onclick="openRetrainArchiveIntegrityModal(decodeURIComponent('${encodeURIComponent(row.id)}'))" title="View archive contents"><i class="fas fa-eye"></i></button>
                                    <button class="btn-success btn-sm" onclick="setRetrainArchiveStatus(decodeURIComponent('${encodeURIComponent(row.id)}'), 'valid')" title="Mark archive valid">Valid</button>
                                    <button class="btn-warning btn-sm" onclick="setRetrainArchiveStatus(decodeURIComponent('${encodeURIComponent(row.id)}'), 'review')" title="Mark archive for review">Review</button>
                                    <button class="btn-danger btn-sm" onclick="setRetrainArchiveStatus(decodeURIComponent('${encodeURIComponent(row.id)}'), 'invalid')" title="Mark archive invalid">Invalid</button>
                                    <button class="btn-secondary btn-sm" onclick="setRetrainArchiveAttempt(decodeURIComponent('${encodeURIComponent(row.id)}'), 1)" title="Classify archive as first attempt">A1</button>
                                    <button class="btn-secondary btn-sm" onclick="setRetrainArchiveAttempt(decodeURIComponent('${encodeURIComponent(row.id)}'), 2)" title="Classify archive as second attempt">A2</button>
                                    <button class="btn-secondary btn-sm" onclick="clearRetrainArchiveDecision(decodeURIComponent('${encodeURIComponent(row.id)}'))" title="Clear archive decision"><i class="fas fa-undo"></i></button>
                                    <button class="btn-danger btn-sm" onclick="deleteRetrainArchiveEntry(decodeURIComponent('${encodeURIComponent(row.id)}'))" title="Delete confirmed invalid archive"><i class="fas fa-trash"></i></button>
                                `
                                : `
                                    ${row.id ? `<button class="btn-secondary btn-sm" onclick="viewCompletedTest(decodeURIComponent('${encodeURIComponent(row.id)}'), null, 'view')" title="View whole attempt"><i class="fas fa-eye"></i></button>` : ''}
                                    <button class="btn-success btn-sm" onclick="setIntegrityVerdictOverride(decodeURIComponent('${encodeURIComponent(row.entryKey)}'), 'valid')" title="Mark whole entry valid">Valid</button>
                                    <button class="btn-warning btn-sm" onclick="setIntegrityVerdictOverride(decodeURIComponent('${encodeURIComponent(row.entryKey)}'), 'review')" title="Keep whole entry for review">Review</button>
                                    <button class="btn-danger btn-sm" onclick="setIntegrityVerdictOverride(decodeURIComponent('${encodeURIComponent(row.entryKey)}'), 'invalid')" title="Mark whole entry invalid">Invalid</button>
                                    <button class="btn-secondary btn-sm" onclick="setIntegrityAttemptOverride(decodeURIComponent('${encodeURIComponent(row.entryKey)}'), 1)" title="Classify as first training attempt">A1</button>
                                    <button class="btn-secondary btn-sm" onclick="setIntegrityAttemptOverride(decodeURIComponent('${encodeURIComponent(row.entryKey)}'), 2)" title="Classify as second training attempt">A2</button>
                                    <button class="btn-secondary btn-sm" onclick="clearIntegrityOverride(decodeURIComponent('${encodeURIComponent(row.entryKey)}'))" title="Clear manual override"><i class="fas fa-undo"></i></button>
                                    ${canDelete ? `<button class="btn-danger btn-sm" onclick="deleteIntegrityEntry(decodeURIComponent('${encodeURIComponent(row.id)}'), decodeURIComponent('${encodeURIComponent(row.recordId)}'), decodeURIComponent('${encodeURIComponent(row.source)}'))" title="Delete confirmed invalid entry"><i class="fas fa-trash"></i></button>` : ''}
                                `;
                            return `
                                <tr>
                                    <td><span class="status-badge ${testIntegrityStatusTone(row.verdict)}">${esc(row.verdict)}</span>${overrideBadge}</td>
                                    <td>${esc(row.date || '-')}</td>
                                    <td>Attempt ${row.inferredAttempt || 1}<div class="ins-subtle">${esc(attemptSource)}</div></td>
                                    <td><strong>${esc(row.trainee || '-')}</strong><div class="ins-subtle">${esc(row.groupID || 'No group')}</div></td>
                                    <td>${esc(row.type)}</td>
                                    <td>${esc(row.title || '-')}<div class="ins-subtle">${esc(row.source)} ${row.archived ? '| archived' : ''}</div></td>
                                    <td><strong>${score}${recordScore}</strong></td>
                                    <td>${esc(row.completenessLabel || '-')}<div class="ins-subtle">${esc(row.evidenceLabel || '')}</div></td>
                                    <td>${esc(row.reviewLabel || '-')}<div class="ins-subtle">${esc(row.reviewedBy || '')}${row.auditCount ? ` | ${row.auditCount} audits` : ''}</div></td>
                                    <td style="min-width:260px;">${reasonHtml}</td>
                                    <td>
                                        <div style="display:flex; gap:5px; flex-wrap:wrap; min-width:210px;">
                                            ${actionHtml}
                                        </div>
                                    </td>
                                </tr>
                            `;
                        }).join('') : '<tr><td colspan="11" style="text-align:center; color:var(--text-muted); padding:20px;">No entries match this filter.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    const verdictFilter = document.getElementById('integrityVerdictFilter');
    const typeFilter = document.getElementById('integrityTypeFilter');
    const titleFilter = document.getElementById('integrityAssessmentFilter');
    const searchInput = document.getElementById('integritySearch');
    if (verdictFilter) verdictFilter.value = filters.verdict || '';
    if (typeFilter) typeFilter.value = filters.type || '';
    if (titleFilter) titleFilter.value = filters.title || '';
    if (searchInput) searchInput.value = filters.search || '';
}

function rememberTestIntegrityFilters() {
    window.__TEST_INTEGRITY_LAST_FILTERS = {
        verdict: document.getElementById('integrityVerdictFilter')?.value || 'invalid',
        type: document.getElementById('integrityTypeFilter')?.value || '',
        title: document.getElementById('integrityAssessmentFilter')?.value || '',
        search: document.getElementById('integritySearch')?.value || ''
    };
}

async function deleteIntegrityEntry(submissionId, recordId, source) {
    const subId = String(submissionId || '').trim();
    const recId = String(recordId || '').trim();
    const kind = String(source || '').trim();
    const label = subId ? `submission ${subId}` : `record ${recId}`;
    if (!subId && !recId) return alert('No linked entry id found for deletion.');
    if (!confirm(`Permanently remove ${label}? This is only for entries you have confirmed are definitely invalid.`)) return;
    if (!confirm('Final confirmation: this will delete the selected invalid entry from Supabase and local cache. Continue?')) return;

    let submissions = testIntegrityParse('submissions', []);
    let records = testIntegrityParse('records', []);

    if (typeof hardDelete === 'function') {
        if (subId) {
            const ok = await hardDelete('submissions', subId);
            if (!ok) return alert('Failed to delete submission from server. Please check connection.');
        }
        if (recId) {
            const ok = await hardDelete('records', recId);
            if (!ok) return alert('Failed to delete linked record from server. Please check connection.');
        }
    }

    if (subId) {
        submissions = submissions.filter(item => String(item && item.id || '') !== subId);
        localStorage.setItem('submissions', JSON.stringify(submissions));
    }
    if (recId) {
        records = records.filter(item => String(item && item.id || '') !== recId);
        localStorage.setItem('records', JSON.stringify(records));
    }

    rememberTestIntegrityFilters();
    renderTestIntegrityReview();
    if (typeof loadCompletedHistory === 'function') loadCompletedHistory();
    if (typeof loadTestRecords === 'function') loadTestRecords();
    if (typeof showToast === 'function') showToast(`Removed invalid ${kind || 'entry'}.`, 'success');
}

function findRetrainArchiveById(archiveId) {
    const id = String(archiveId || '').trim();
    if (!id) return { archives: getRetrainArchivesForIntegrity(), index: -1, entry: null };
    const archives = getRetrainArchivesForIntegrity();
    const index = archives.findIndex(entry => String(entry && entry.id || '') === id);
    return { archives, index, entry: index >= 0 ? archives[index] : null };
}

function summarizeRetrainArchiveItems(items, type) {
    const rows = Array.isArray(items) ? items : [];
    const esc = testIntegrityEscape;
    if (!rows.length) return `<div class="ins-subtle" style="padding:8px 0;">No ${esc(type)} in this archive.</div>`;
    return `
        <div class="table-responsive" style="max-height:240px; overflow:auto; margin-top:8px;">
            <table class="admin-table compressed-table">
                <thead><tr><th>Date</th><th>Trainee/User</th><th>Title / Status</th><th>Score / Time</th></tr></thead>
                <tbody>
                    ${rows.slice(0, 120).map(row => {
                        const title = row.assessment || row.testTitle || row.status || row.reason || '-';
                        const owner = row.trainee || row.user || row.username || row.user_id || '-';
                        const score = row.score !== undefined && row.score !== null
                            ? `${row.score}%`
                            : [row.clockIn || row.in, row.clockOut || row.out].filter(Boolean).join(' - ');
                        return `<tr><td>${esc(row.date || row.createdAt || row.lastModified || '-')}</td><td>${esc(owner)}</td><td>${esc(title)}</td><td>${esc(score || '-')}</td></tr>`;
                    }).join('')}
                </tbody>
            </table>
            ${rows.length > 120 ? `<div class="ins-subtle" style="margin-top:6px;">Showing first 120 of ${rows.length} rows.</div>` : ''}
        </div>
    `;
}

function closeRetrainArchiveIntegrityModal() {
    const modal = document.getElementById('retrainArchiveIntegrityModal');
    if (modal) modal.remove();
}

function openRetrainArchiveIntegrityModal(archiveId) {
    const { entry } = findRetrainArchiveById(archiveId);
    if (!entry) return alert('Archive entry not found. Refresh and try again.');
    closeRetrainArchiveIntegrityModal();
    const esc = testIntegrityEscape;
    const modal = document.createElement('div');
    modal.id = 'retrainArchiveIntegrityModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content wide-modal" style="max-width:1100px;">
            <button class="modal-close" onclick="closeRetrainArchiveIntegrityModal()">&times;</button>
            <h3 style="margin-top:0;">Retrain Archive Detail</h3>
            <div class="ins-mini-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); margin-bottom:12px;">
                <div class="ins-mini"><strong>${esc(entry.user || '-')}</strong><span class="ins-subtle">Trainee</span></div>
                <div class="ins-mini"><strong>${esc(entry.attemptLabel || `Attempt ${entry.attemptNumber || '?'}`)}</strong><span class="ins-subtle">Attempt Label</span></div>
                <div class="ins-mini"><strong>${esc(entry.archiveReviewStatus || 'unreviewed')}</strong><span class="ins-subtle">Decision</span></div>
                <div class="ins-mini"><strong>${esc(testIntegrityArchiveDate(entry) || '-')}</strong><span class="ins-subtle">Archive Date</span></div>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px; margin-bottom:12px;">
                <div><strong>Archive ID</strong><div class="ins-subtle">${esc(entry.id || '-')}</div></div>
                <div><strong>Reason</strong><div class="ins-subtle">${esc(entry.reason || '-')}</div></div>
                <div><strong>From / To Group</strong><div class="ins-subtle">${esc(entry.fromGroup || 'Unknown')} -> ${esc(entry.targetGroup || 'Unknown')}</div></div>
                <div><strong>Cleanup Note</strong><div class="ins-subtle">${esc(entry.cleanupNote || '-')}</div></div>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
                <button class="btn-success btn-sm" onclick="setRetrainArchiveStatus('${esc(entry.id)}', 'valid')">Mark Valid</button>
                <button class="btn-warning btn-sm" onclick="setRetrainArchiveStatus('${esc(entry.id)}', 'review')">Mark Review</button>
                <button class="btn-danger btn-sm" onclick="setRetrainArchiveStatus('${esc(entry.id)}', 'invalid')">Mark Invalid</button>
                <button class="btn-secondary btn-sm" onclick="setRetrainArchiveAttempt('${esc(entry.id)}', 1)">A1</button>
                <button class="btn-secondary btn-sm" onclick="setRetrainArchiveAttempt('${esc(entry.id)}', 2)">A2</button>
                <button class="btn-secondary btn-sm" onclick="clearRetrainArchiveDecision('${esc(entry.id)}')">Clear</button>
                <button class="btn-danger btn-sm" onclick="deleteRetrainArchiveEntry('${esc(entry.id)}')"><i class="fas fa-trash"></i> Delete Archive</button>
            </div>
            <h4>Records (${testIntegrityArchiveRowCount(entry, 'records')})</h4>
            ${summarizeRetrainArchiveItems(entry.records, 'records')}
            <h4>Submissions (${testIntegrityArchiveRowCount(entry, 'submissions')})</h4>
            ${summarizeRetrainArchiveItems(entry.submissions, 'submissions')}
            <h4>Attendance (${testIntegrityArchiveRowCount(entry, 'attendance')})</h4>
            ${summarizeRetrainArchiveItems(entry.attendance, 'attendance rows')}
        </div>
    `;
    document.body.appendChild(modal);
}

async function updateRetrainArchiveEntry(archiveId, updater, successMessage) {
    const { archives, index, entry } = findRetrainArchiveById(archiveId);
    if (!entry || index < 0) return alert('Archive entry not found. Refresh and try again.');
    const updated = typeof updater === 'function' ? updater({ ...entry }) : { ...entry, ...(updater || {}) };
    updated.cleanupUpdatedAt = new Date().toISOString();
    updated.updatedBy = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.user) ? CURRENT_USER.user : 'Unknown';
    archives[index] = updated;
    try {
        await saveRetrainArchivesForIntegrity(archives);
    } catch (error) {
        console.warn('Retrain archive update failed:', error);
        if (typeof showToast === 'function') showToast('Archive update failed to sync. Check connection and retry.', 'warning');
        return;
    }
    closeRetrainArchiveIntegrityModal();
    renderTestIntegrityReview();
    if (typeof showToast === 'function' && successMessage) showToast(successMessage, 'success');
}

async function setRetrainArchiveStatus(archiveId, status) {
    const normalized = testIntegrityNormalize(status || '');
    if (!['valid', 'review', 'invalid'].includes(normalized)) return;
    const note = prompt(`Optional note for marking this retrain archive as ${normalized}:`, '');
    if (note === null) return;
    await updateRetrainArchiveEntry(archiveId, (entry) => ({
        ...entry,
        archiveReviewStatus: normalized,
        cleanupNote: String(note || '').trim() || `Archive marked ${normalized} in Integrity Review.`
    }), `Retrain archive marked ${normalized}.`);
}

async function setRetrainArchiveAttempt(archiveId, attemptNumber) {
    const attempt = Number(attemptNumber);
    if (![1, 2].includes(attempt)) return;
    await updateRetrainArchiveEntry(archiveId, (entry) => ({
        ...entry,
        attemptNumber: attempt,
        attemptLabel: `Attempt ${attempt}`,
        cleanupNote: `Archive classified as Attempt ${attempt} in Integrity Review.`
    }), `Retrain archive classified as Attempt ${attempt}.`);
}

async function clearRetrainArchiveDecision(archiveId) {
    await updateRetrainArchiveEntry(archiveId, (entry) => {
        delete entry.archiveReviewStatus;
        delete entry.cleanupNote;
        return entry;
    }, 'Retrain archive decision cleared.');
}

async function deleteRetrainArchiveEntry(archiveId) {
    const { archives, index, entry } = findRetrainArchiveById(archiveId);
    if (!entry || index < 0) return alert('Archive entry not found. Refresh and try again.');
    const label = `${entry.user || 'Unknown'} / ${entry.reason || entry.id || 'archive'}`;
    if (!confirm(`Delete retrain archive "${label}"?\n\nThis removes only the archive snapshot from retrain history. It does not delete the trainee's current live data.`)) return;
    if (!confirm('Final confirmation: only delete this archive if you have confirmed it is invalid or duplicate. Continue?')) return;
    const next = archives.filter((_, itemIndex) => itemIndex !== index);
    try {
        await saveRetrainArchivesForIntegrity(next);
    } catch (error) {
        console.warn('Retrain archive delete failed:', error);
        if (typeof showToast === 'function') showToast('Archive delete failed to sync. Check connection and retry.', 'warning');
        return;
    }
    closeRetrainArchiveIntegrityModal();
    renderTestIntegrityReview();
    if (typeof showToast === 'function') showToast('Retrain archive deleted.', 'success');
}

async function updateIntegrityOverride(entryKey, patch, options = {}) {
    const key = String(entryKey || '').trim();
    if (!key) return;
    const overrides = getTestIntegrityOverrides();
    const previous = overrides.entries[key] || {};
    overrides.entries[key] = {
        ...previous,
        ...patch,
        updatedAt: new Date().toISOString(),
        updatedBy: (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.user) ? CURRENT_USER.user : 'Unknown'
    };
    try {
        await saveTestIntegrityOverrides(overrides);
    } catch (error) {
        console.warn('Integrity override saved locally but failed to sync:', error);
        if (typeof showToast === 'function') showToast('Saved locally, but cloud sync failed. Refresh/check connection before release cleanup.', 'warning');
    }
    rememberTestIntegrityFilters();
    if (options.verdictFilter !== undefined) {
        window.__TEST_INTEGRITY_LAST_FILTERS = {
            ...(window.__TEST_INTEGRITY_LAST_FILTERS || {}),
            verdict: options.verdictFilter
        };
    }
    renderTestIntegrityReview();
}

async function setIntegrityVerdictOverride(entryKey, verdict) {
    const normalized = String(verdict || '').trim().toLowerCase();
    if (!['valid', 'review', 'invalid'].includes(normalized)) return;
    const note = prompt(`Optional note for marking this whole entry as ${normalized}:`, '');
    if (note === null) return;
    await updateIntegrityOverride(entryKey, { verdict: normalized, note: String(note || '').trim() }, { verdictFilter: normalized });
    if (typeof showToast === 'function') showToast(`Integrity entry marked ${normalized}.`, 'success');
}

async function setIntegrityAttemptOverride(entryKey, attemptNumber) {
    const attempt = Number(attemptNumber);
    if (![1, 2].includes(attempt)) return;
    await updateIntegrityOverride(entryKey, { attemptNumber: attempt });
    if (typeof showToast === 'function') showToast(`Integrity entry classified as attempt ${attempt}.`, 'success');
}

async function clearIntegrityOverride(entryKey) {
    const key = String(entryKey || '').trim();
    if (!key) return;
    const overrides = getTestIntegrityOverrides();
    if (!overrides.entries[key]) return;
    delete overrides.entries[key];
    await saveTestIntegrityOverrides(overrides);
    rememberTestIntegrityFilters();
    renderTestIntegrityReview();
    if (typeof showToast === 'function') showToast('Integrity override cleared.', 'info');
}

document.addEventListener('input', (event) => {
    if (event && event.target && ['integrityVerdictFilter', 'integrityTypeFilter', 'integrityAssessmentFilter', 'integritySearch'].includes(event.target.id)) {
        rememberTestIntegrityFilters();
    }
});

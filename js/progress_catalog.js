/* ================= OFFICIAL TRAINEE PROGRESS CATALOG ================= */
/* Shared helper for the app-wide expected progress checklist. */

(function () {
    const CONFIG_KEY = 'insight_progress_config';
    const AUTO_ITEMS = [
        { name: 'Onboard Report', type: 'report', source: 'auto' },
        { name: 'Insight Review', type: 'review', source: 'auto' }
    ];

    function parseJson(key, fallback) {
        try {
            const parsed = JSON.parse(localStorage.getItem(key) || 'null');
            return parsed === null || parsed === undefined ? fallback : parsed;
        } catch (error) {
            return fallback;
        }
    }

    function normalize(value) {
        return String(value || '').trim().toLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function identity(value) {
        return normalize(value).replace(/\s+/g, '');
    }

    function uniquePush(map, item) {
        const name = String(item && item.name || '').trim();
        if (!name) return;
        const type = inferType(name, item.type);
        const key = `${type}:${normalize(name)}`;
        if (map.has(key)) {
            const existing = map.get(key);
            map.set(key, {
                ...existing,
                ...item,
                name: existing.name || name,
                type,
                sources: Array.from(new Set([...(existing.sources || [existing.source]).filter(Boolean), item.source].filter(Boolean)))
            });
            return;
        }
        map.set(key, {
            ...item,
            name,
            type,
            source: item.source || 'catalog',
            sources: [item.source || 'catalog']
        });
    }

    function inferType(name, explicitType) {
        const type = normalize(explicitType);
        if (['assessment', 'vetting', 'test', 'live', 'report', 'review'].includes(type)) return type;
        const text = normalize(name);
        if (!text) return 'assessment';
        if (text === 'onboard report') return 'report';
        if (text === 'insight review') return 'review';
        if (text.includes('live assessment') || text.includes('live session')) return 'live';
        if (text.startsWith('1st vetting') || text.startsWith('final vetting') || text.includes('vetting')) return 'vetting';
        return 'assessment';
    }

    function sanitizeReportSections(sections, name, type) {
        const raw = sections && typeof sections === 'object' ? sections : {};
        const progressType = inferType(name, type);
        const explicit = ['trainingGoal', 'assessmentScores', 'vettingTest1', 'vettingFinal']
            .some(key => Object.prototype.hasOwnProperty.call(raw, key));
        if (explicit) {
            return {
                trainingGoal: raw.trainingGoal === true,
                assessmentScores: raw.assessmentScores === true,
                vettingTest1: raw.vettingTest1 === true,
                vettingFinal: raw.vettingFinal === true
            };
        }
        return {
            trainingGoal: progressType === 'assessment' || progressType === 'test',
            assessmentScores: progressType === 'assessment' || progressType === 'test' || progressType === 'live',
            vettingTest1: progressType === 'vetting' && !normalize(name).includes('final'),
            vettingFinal: progressType === 'vetting' && !normalize(name).includes('1st')
        };
    }

    function normalizeConfiguredItem(item) {
        if (!item) return null;
        const raw = typeof item === 'string' ? { name: item } : item;
        const name = String(raw.name || '').trim();
        if (!name) return null;
        const type = inferType(name, raw.type);
        return {
            name,
            type,
            source: raw.source || 'manual',
            reportSections: sanitizeReportSections(raw.reportSections, name, type)
        };
    }

    function getConfiguredItems(options = {}) {
        const includeAuto = options.includeAuto !== false;
        const cfg = parseJson(CONFIG_KEY, {});
        const map = new Map();
        if (includeAuto) AUTO_ITEMS.forEach(item => uniquePush(map, item));
        (Array.isArray(cfg.requiredItems) ? cfg.requiredItems : []).forEach(item => {
            const normalized = normalizeConfiguredItem(item);
            if (normalized) uniquePush(map, normalized);
        });
        return sortItems(Array.from(map.values()));
    }

    function addScheduleCandidates(map) {
        const schedules = parseJson('schedules', {});
        Object.values(schedules || {}).forEach(schedule => {
            (Array.isArray(schedule && schedule.items) ? schedule.items : []).forEach(item => {
                const name = String(item.courseName || item.title || item.name || '').trim();
                if (!name) return;
                uniquePush(map, {
                    name,
                    type: item.linkedTestId || item.assessmentLink ? 'assessment' : inferType(name, null),
                    source: 'timeline',
                    scheduleId: schedule.id || ''
                });
            });
        });
    }

    function addAssessmentCandidates(map) {
        const assessments = parseJson('assessments', []);
        (Array.isArray(assessments) ? assessments : []).forEach(item => {
            const name = typeof item === 'string' ? item : (item && (item.name || item.title));
            if (name) uniquePush(map, { name, type: 'assessment', source: 'assessment-list' });
        });

        const tests = parseJson('tests', []);
        (Array.isArray(tests) ? tests : []).forEach(test => {
            const name = String(test && (test.title || test.name) || '').trim();
            if (!name) return;
            const testType = normalize(test.type);
            uniquePush(map, {
                name,
                type: testType === 'live' ? 'live' : (testType === 'vetting' ? 'vetting' : 'test'),
                source: 'test-engine',
                testId: test.id || ''
            });
        });

        const topics = parseJson('vettingTopics', []);
        (Array.isArray(topics) ? topics : []).forEach(topic => {
            const clean = String(topic || '').trim();
            if (!clean) return;
            uniquePush(map, { name: `1st Vetting - ${clean}`, type: 'vetting', source: 'vetting-topics' });
            uniquePush(map, { name: `Final Vetting - ${clean}`, type: 'vetting', source: 'vetting-topics' });
        });
    }

    function getCandidateItems(options = {}) {
        const map = new Map();
        if (options.includeConfigured !== false) getConfiguredItems({ includeAuto: false }).forEach(item => uniquePush(map, item));
        addScheduleCandidates(map);
        addAssessmentCandidates(map);
        if (options.includeAuto) AUTO_ITEMS.forEach(item => uniquePush(map, item));
        return sortItems(Array.from(map.values()));
    }

    function getOfficialItems(options = {}) {
        const configured = getConfiguredItems({ includeAuto: options.includeAuto !== false });
        if (configured.some(item => item.source !== 'auto')) return configured;
        return sortItems([
            ...(options.includeAuto === false ? [] : AUTO_ITEMS),
            ...getCandidateItems({ includeConfigured: false })
        ]);
    }

    function sortItems(items) {
        const rank = { assessment: 1, vetting: 2, live: 3, test: 4, report: 5, review: 6 };
        return (items || []).slice().sort((a, b) => {
            const diff = (rank[a.type] || 9) - (rank[b.type] || 9);
            if (diff !== 0) return diff;
            return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
        });
    }

    function namesMatch(left, right, options = {}) {
        const a = normalize(left);
        const b = normalize(right);
        if (!a || !b) return false;
        if (a === b) return true;
        if (options.loose !== false && (a.includes(b) || b.includes(a))) return true;
        const cleanA = a.replace(/^1st vetting\s*/, '').replace(/^final vetting\s*/, '').trim();
        const cleanB = b.replace(/^1st vetting\s*/, '').replace(/^final vetting\s*/, '').trim();
        return !!cleanA && !!cleanB && (cleanA === cleanB || cleanA.includes(cleanB) || cleanB.includes(cleanA));
    }

    function rowMatchesUser(row, username) {
        const target = identity(username);
        return target && [row && row.trainee, row && row.user, row && row.user_id, row && row.username]
            .some(value => identity(value) === target);
    }

    function isCompletedSubmission(sub) {
        return ['completed', 'pass', 'passed', 'done', 'submitted'].includes(normalize(sub && sub.status));
    }

    function getScore(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    }

    function getItemEvidence(username, item, data = {}) {
        const records = Array.isArray(data.records) ? data.records : parseJson('records', []);
        const submissions = Array.isArray(data.submissions) ? data.submissions : parseJson('submissions', []);
        const savedReports = Array.isArray(data.savedReports) ? data.savedReports : parseJson('savedReports', []);
        const insightReviews = Array.isArray(data.insightReviews) ? data.insightReviews : parseJson('insightReviews', []);
        const liveBookings = Array.isArray(data.liveBookings) ? data.liveBookings : parseJson('liveBookings', []);
        const type = inferType(item && item.name, item && item.type);
        const name = String(item && item.name || '').trim();

        if (type === 'report') {
            const row = savedReports.find(report => rowMatchesUser(report, username));
            return row ? { completed: true, source: 'saved_report', row, score: null } : { completed: false, source: 'missing' };
        }
        if (type === 'review') {
            const row = insightReviews.find(review => rowMatchesUser(review, username));
            return row ? { completed: true, source: 'insight_review', row, score: null } : { completed: false, source: 'missing' };
        }

        const record = records.find(row => rowMatchesUser(row, username) && namesMatch(row.assessment, name));
        const submission = submissions.find(row => rowMatchesUser(row, username) && isCompletedSubmission(row) && namesMatch(row.testTitle || row.assessment || row.title, name));
        const liveBooking = liveBookings.find(row => rowMatchesUser(row, username) && normalize(row.status) === 'completed' && namesMatch(row.assessment, name));
        const row = record || submission || liveBooking || null;
        const score = row ? getScore(row.score) : null;
        return row
            ? { completed: true, source: record ? 'record' : (submission ? 'submission' : 'live_booking'), row, score }
            : { completed: false, source: 'missing' };
    }

    function isItemExempt(username, groupID, itemName, data = {}) {
        const exemptions = Array.isArray(data.exemptions) ? data.exemptions : parseJson('exemptions', []);
        const targetGroup = String(groupID || '').trim();
        return exemptions.some(row => {
            if (!rowMatchesUser(row, username)) return false;
            if (targetGroup && String(row.groupID || '').trim() !== targetGroup) return false;
            return namesMatch(row.item, itemName, { loose: false });
        });
    }

    function getTraineeProgress(username, groupID = '', options = {}) {
        const items = options.items || getOfficialItems({ includeAuto: options.includeAuto !== false });
        const checklist = items.map(item => {
            const exempt = isItemExempt(username, groupID, item.name, options.data || {});
            if (exempt) return { ...item, status: 'exempt', completed: true, evidenceSource: 'exemption' };
            const evidence = getItemEvidence(username, item, options.data || {});
            return {
                ...item,
                status: evidence.completed ? 'completed' : 'missing',
                completed: evidence.completed,
                evidenceSource: evidence.source,
                score: evidence.score,
                evidence: evidence.row || null
            };
        });
        const completedCount = checklist.filter(item => item.status === 'completed' || item.status === 'exempt').length;
        const totalRequired = checklist.length;
        return {
            items: checklist,
            completedCount,
            totalRequired,
            missingCount: Math.max(0, totalRequired - completedCount),
            progress: totalRequired ? Math.round((completedCount / totalRequired) * 100) : 0
        };
    }

    window.ProgressCatalog = {
        CONFIG_KEY,
        AUTO_ITEMS,
        normalize,
        identity,
        inferType,
        sanitizeReportSections,
        getConfiguredItems,
        getCandidateItems,
        getOfficialItems,
        getItemEvidence,
        getTraineeProgress,
        namesMatch
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = window.ProgressCatalog;
    }
})();

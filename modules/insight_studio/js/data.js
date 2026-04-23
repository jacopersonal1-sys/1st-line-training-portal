/* ================= INSIGHT MODULE DATA ================= */

const INSIGHT_MODULE_CACHE_KEY = 'insight_module_cache_v1';
const INSIGHT_FETCH_TIMEOUT_MS = 9000;
const INSIGHT_BOOT_TIMEOUT_MS = 7000;
const INSIGHT_SUBJECT_REVIEW_KEY = 'insight_subject_reviews';
const INSIGHT_PROGRESS_CONFIG_KEY = 'insight_progress_config';

const INSIGHT_AUTO_PROGRESS_ITEMS = [
    { name: 'Onboard Report', type: 'report', source: 'auto' },
    { name: 'Insight Review', type: 'review', source: 'auto' }
];

function insNormalize(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[._-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function insToken(value) {
    return insNormalize(value).replace(/\s+/g, '');
}

function insMatch(a, b) {
    const na = insNormalize(a);
    const nb = insNormalize(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    return na.replace(/\s+/g, '') === nb.replace(/\s+/g, '');
}

function insToNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function insToTs(value) {
    const ts = Date.parse(value || '');
    return Number.isFinite(ts) ? ts : 0;
}

function insUnique(values) {
    const seen = new Set();
    const out = [];
    (values || []).forEach((item) => {
        const text = String(item || '').trim();
        if (!text) return;
        const key = text.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.push(text);
    });
    return out;
}

function insParseJson(key, fallbackValue) {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || 'null');
        if (parsed === null || parsed === undefined) return fallbackValue;
        return parsed;
    } catch (error) {
        return fallbackValue;
    }
}

function insNormalizeSubjectName(label) {
    const raw = String(label || '').trim();
    if (!raw) return '';
    const match = raw.match(/^(.*) \((\d+(?:\.\d+)?)%\)$/);
    if (match && match[1]) return String(match[1]).trim();
    return raw;
}

const INS_SHARED_RECORD_BUCKETS = new Set([
    insNormalize('live-session'),
    insNormalize('digital-assessment'),
    insNormalize('manual-upload'),
    insNormalize('unknown')
]);

function insIsSharedRecordGroup(value) {
    return INS_SHARED_RECORD_BUCKETS.has(insNormalize(value));
}

function insRecordMatchesGroup(record, groupID) {
    const targetGroup = insNormalize(groupID);
    if (!targetGroup || targetGroup === 'all') return true;
    const recordGroup = insNormalize(record && record.groupID);
    if (!recordGroup) return true;
    return recordGroup === targetGroup || insIsSharedRecordGroup(recordGroup);
}

function insInferProgressType(name, explicitType) {
    const normalizedType = insNormalize(explicitType);
    if (['assessment', 'vetting', 'test', 'report', 'review'].includes(normalizedType)) {
        return normalizedType;
    }
    const normalizedName = insNormalize(name);
    if (!normalizedName) return 'assessment';
    if (normalizedName === 'onboard report') return 'report';
    if (normalizedName === 'insight review') return 'review';
    if (normalizedName.startsWith('1st vetting -') || normalizedName.startsWith('final vetting -')) return 'vetting';
    return 'assessment';
}

const InsightDataService = {
    state: {
        users: [],
        rosters: {},
        records: [],
        submissions: [],
        savedReports: [],
        insightReviews: [],
        exemptions: [],
        attendance: [],
        monitorHistory: [],
        tlFeedback: [],
        contentStore: { entries: [], analytics: [], annotations: [] },
        assessments: [],
        vettingTopics: [],
        tests: [],
        ruleConfig: null,
        progressConfig: null,
        subjectReviews: []
    },

    loadCache: function() {
        try {
            const parsed = JSON.parse(localStorage.getItem(INSIGHT_MODULE_CACHE_KEY) || '{}');
            if (!parsed || typeof parsed !== 'object') return null;
            return parsed;
        } catch (error) {
            return null;
        }
    },

    saveCache: function() {
        localStorage.setItem(INSIGHT_MODULE_CACHE_KEY, JSON.stringify(this.state));
    },

    withTimeout: async function(promise, ms, fallbackValue = null, label = 'request') {
        let timer = null;
        try {
            const guarded = new Promise((resolve) => {
                timer = setTimeout(() => {
                    console.warn(`[Insight] ${label} timed out after ${ms}ms.`);
                    resolve({ __timeout: true, value: fallbackValue });
                }, ms);
            });

            const result = await Promise.race([Promise.resolve(promise), guarded]);
            if (result && result.__timeout) return result.value;
            return result;
        } finally {
            if (timer) clearTimeout(timer);
        }
    },

    fetchAllRows: async function(tableName, selectClause = '*') {
        if (!AppContext.supabase) return [];

        const pageSize = 1000;
        let page = 0;
        let all = [];

        while (page < 12) {
            const from = page * pageSize;
            const to = from + pageSize - 1;
            const response = await this.withTimeout(
                AppContext.supabase.from(tableName).select(selectClause).range(from, to),
                INSIGHT_FETCH_TIMEOUT_MS,
                { data: null, error: new Error('timeout') },
                `${tableName} page ${page + 1}`
            );

            const data = response && Array.isArray(response.data) ? response.data : null;
            const error = response && response.error ? response.error : null;
            if (error) {
                console.warn(`[Insight] Failed loading ${tableName}:`, error);
                break;
            }

            if (!Array.isArray(data) || data.length === 0) break;
            all = all.concat(data);
            if (data.length < pageSize) break;
            page += 1;
        }

        return all;
    },

    fetchDocument: async function(key) {
        if (!AppContext.supabase) return null;
        try {
            const response = await this.withTimeout(
                AppContext.supabase
                    .from('app_documents')
                    .select('content')
                    .eq('key', key)
                    .maybeSingle(),
                INSIGHT_FETCH_TIMEOUT_MS,
                { data: null, error: new Error('timeout') },
                `app_documents:${key}`
            );
            const data = response && response.data ? response.data : null;
            const error = response && response.error ? response.error : null;
            if (error) return null;
            return data && data.content ? data.content : null;
        } catch (error) {
            return null;
        }
    },

    normalizeUsers: function(rows) {
        return (rows || []).map((row) => {
            const base = row && typeof row === 'object' && row.data && typeof row.data === 'object' ? row.data : (row || {});
            const userName = String(base.user || base.username || base.name || row.user_id || '').trim();
            return {
                id: String(row.id || base.id || ''),
                user: userName,
                role: String(base.role || '').trim().toLowerCase(),
                badges: Array.isArray(base.badges) ? base.badges.map(v => String(v || '').trim()).filter(Boolean) : [],
                status: String(base.status || '').trim().toLowerCase()
            };
        }).filter(user => !!user.user);
    },

    normalizeRecords: function(rows) {
        return (rows || []).map((row) => {
            const base = row && typeof row === 'object' && row.data && typeof row.data === 'object' ? row.data : (row || {});
            return {
                id: String(base.id || row.id || ''),
                trainee: String(base.trainee || base.user || base.user_id || '').trim(),
                assessment: String(base.assessment || '').trim(),
                score: insToNumber(base.score, 0),
                date: String(base.date || base.createdAt || row.updated_at || '').trim(),
                groupID: String(base.groupID || '').trim(),
                phase: String(base.phase || '').trim(),
                link: String(base.link || '').trim(),
                submissionId: String(base.submissionId || '').trim()
            };
        }).filter(r => !!r.trainee && !!r.assessment);
    },

    normalizeSubmissions: function(rows) {
        return (rows || []).map((row) => {
            const base = row && typeof row === 'object' && row.data && typeof row.data === 'object' ? row.data : (row || {});
            const context = (base.contentStudioContext && typeof base.contentStudioContext === 'object')
                ? base.contentStudioContext
                : ((base.quizMeta && base.quizMeta.context && typeof base.quizMeta.context === 'object') ? base.quizMeta.context : null);

            return {
                id: String(base.id || row.id || ''),
                trainee: String(base.trainee || base.user || base.user_id || '').trim(),
                testTitle: String(base.testTitle || base.title || '').trim(),
                score: insToNumber(base.score, 0),
                status: String(base.status || '').trim().toLowerCase(),
                date: String(base.date || base.createdAt || row.updated_at || '').trim(),
                createdAt: String(base.createdAt || '').trim(),
                lastModified: String(base.lastModified || row.updated_at || '').trim(),
                contentStudioContext: context || null,
                quizMeta: base.quizMeta && typeof base.quizMeta === 'object' ? base.quizMeta : null
            };
        }).filter(s => !!s.trainee);
    },

    normalizeSavedReports: function(rows) {
        return (rows || []).map((row) => {
            const base = row && typeof row === 'object' && row.data && typeof row.data === 'object' ? row.data : (row || {});
            return {
                _rowId: String(row.id || base.id || ''),
                trainee: String(base.trainee || base.user || row.user_id || '').trim(),
                date: String(base.date || base.createdAt || row.updated_at || '').trim(),
                formType: String(base.formType || '').trim().toLowerCase()
            };
        }).filter(item => !!item.trainee);
    },

    normalizeInsightReviews: function(rows) {
        return (rows || []).map((row) => {
            const base = row && typeof row === 'object' && row.data && typeof row.data === 'object' ? row.data : (row || {});
            return {
                _rowId: String(row.id || base.id || ''),
                trainee: String(base.trainee || base.user || row.user_id || '').trim(),
                date: String(base.date || row.updated_at || '').trim(),
                status: String(base.status || '').trim(),
                comment: String(base.comment || '').trim()
            };
        }).filter(item => !!item.trainee);
    },

    normalizeExemptions: function(rows) {
        return (rows || []).map((row) => {
            const base = row && typeof row === 'object' && row.data && typeof row.data === 'object' ? row.data : (row || {});
            return {
                _rowId: String(row.id || base.id || ''),
                trainee: String(base.trainee || base.user || row.user_id || '').trim(),
                groupID: String(base.groupID || '').trim(),
                item: String(base.item || '').trim()
            };
        }).filter(item => !!item.trainee && !!item.item);
    },

    normalizeAttendance: function(rows) {
        return (rows || []).map((row) => {
            const base = row && typeof row === 'object' && row.data && typeof row.data === 'object' ? row.data : (row || {});
            return {
                _rowId: String(row.id || base.id || ''),
                user: String(base.user || row.user_id || base.trainee || '').trim(),
                date: String(base.date || '').trim(),
                clockIn: String(base.clockIn || '').trim(),
                clockOut: String(base.clockOut || '').trim(),
                isLate: !!base.isLate,
                lateConfirmed: !!base.lateConfirmed,
                isIgnored: !!base.isIgnored,
                lateData: base.lateData && typeof base.lateData === 'object' ? { ...base.lateData } : null,
                adminComment: String(base.adminComment || '').trim()
            };
        }).filter(row => !!row.user && !!row.date);
    },

    normalizeMonitorHistory: function(rows) {
        return (rows || []).map((row) => {
            const base = row && typeof row === 'object' && row.data && typeof row.data === 'object' ? row.data : (row || {});
            return {
                id: String(row.id || base.id || ''),
                user: String(base.user || row.user_id || '').trim(),
                date: String(base.date || '').trim(),
                summary: base.summary && typeof base.summary === 'object' ? base.summary : {},
                details: Array.isArray(base.details) ? base.details : []
            };
        }).filter(entry => !!entry.user && !!entry.date);
    },

    normalizeRuleConfig: function(raw) {
        const defaults = {
            defaultScoreThreshold: 60,
            triggerPresets: []
        };
        const cfg = raw && typeof raw === 'object' ? raw : {};

        const map = new Map();
        const fallbackThreshold = Math.max(1, Math.min(100, Math.round(insToNumber(
            cfg.defaultScoreThreshold !== undefined ? cfg.defaultScoreThreshold : cfg.scoreThreshold,
            defaults.defaultScoreThreshold
        ))));
        const clampThreshold = (value) => Math.max(1, Math.min(100, Math.round(insToNumber(value, fallbackThreshold))));
        const pushRule = (name, severity, scoreThreshold) => {
            const cleanName = String(name || '').trim();
            const cleanSeverity = String(severity || '').trim().toLowerCase();
            if (!cleanName) return;
            if (!['critical', 'semi', 'improvement'].includes(cleanSeverity)) return;
            map.set(insNormalize(cleanName), {
                name: cleanName,
                severity: cleanSeverity,
                scoreThreshold: clampThreshold(scoreThreshold)
            });
        };

        if (Array.isArray(cfg.triggerPresets)) {
            cfg.triggerPresets.forEach(rule => pushRule(rule && rule.name, rule && rule.severity, rule && rule.scoreThreshold));
        };

        if (Array.isArray(cfg.severityRules)) {
            cfg.severityRules.forEach(rule => pushRule(rule && rule.name, rule && rule.severity, fallbackThreshold));
        }
        if (Array.isArray(cfg.topicOverrides)) {
            cfg.topicOverrides.forEach(rule => pushRule(rule && rule.name, rule && rule.severity, fallbackThreshold));
        }
        if (Array.isArray(cfg.criticalAssessments)) {
            cfg.criticalAssessments.forEach(name => pushRule(name, 'critical', fallbackThreshold));
        }
        if (Array.isArray(cfg.semiCriticalAssessments)) {
            cfg.semiCriticalAssessments.forEach(name => pushRule(name, 'semi', fallbackThreshold));
        }

        const triggerPresets = Array.from(map.values()).sort((a, b) => {
            const rank = { critical: 1, semi: 2, improvement: 3 };
            const diff = (rank[a.severity] || 9) - (rank[b.severity] || 9);
            if (diff !== 0) return diff;
            return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
        });

        return {
            defaultScoreThreshold: fallbackThreshold,
            triggerPresets,
            scoreThreshold: fallbackThreshold,
            severityRules: triggerPresets.map((item) => ({ name: item.name, severity: item.severity }))
        };
    },

    normalizeProgressConfig: function(raw) {
        const cfg = raw && typeof raw === 'object' ? raw : {};
        const map = new Map();

        const pushItem = (name, type) => {
            const cleanName = String(name || '').trim();
            if (!cleanName) return;
            if (INSIGHT_AUTO_PROGRESS_ITEMS.some(item => insNormalize(item.name) === insNormalize(cleanName))) return;
            map.set(insNormalize(cleanName), {
                name: cleanName,
                type: insInferProgressType(cleanName, type),
                source: 'manual'
            });
        };

        if (Array.isArray(cfg.requiredItems)) {
            cfg.requiredItems.forEach((item) => {
                if (!item) return;
                if (typeof item === 'string') pushItem(item, null);
                else if (typeof item === 'object') pushItem(item.name, item.type);
            });
        }

        const requiredItems = Array.from(map.values()).sort((a, b) => {
            const rank = { assessment: 1, vetting: 2, test: 3, report: 4, review: 5 };
            const rankDiff = (rank[a.type] || 9) - (rank[b.type] || 9);
            if (rankDiff !== 0) return rankDiff;
            return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
        });

        return {
            requiredItems,
            updatedAt: String(cfg.updatedAt || '').trim(),
            updatedBy: String(cfg.updatedBy || '').trim()
        };
    },

    buildDefaultRuleConfigFromCatalog: function() {
        const threshold = 60;
        const criticalKeywords = (typeof INSIGHT_CONFIG !== 'undefined' && Array.isArray(INSIGHT_CONFIG.CRITICAL))
            ? INSIGHT_CONFIG.CRITICAL.map(item => insNormalize(item)).filter(Boolean)
            : [];
        const semiKeywords = (typeof INSIGHT_CONFIG !== 'undefined' && Array.isArray(INSIGHT_CONFIG.SEMI_CRITICAL))
            ? INSIGHT_CONFIG.SEMI_CRITICAL.map(item => insNormalize(item)).filter(Boolean)
            : [];

        const names = [];
        (this.state.assessments || []).forEach((item) => {
            const name = typeof item === 'string' ? item : (item && item.name);
            const clean = String(name || '').trim();
            if (clean) names.push(clean);
        });
        (this.state.vettingTopics || []).forEach((topic) => {
            const clean = String(topic || '').trim();
            if (!clean) return;
            names.push(`1st Vetting - ${clean}`);
            names.push(`Final Vetting - ${clean}`);
        });
        (this.state.tests || []).forEach((item) => {
            const name = typeof item === 'string' ? item : (item && (item.title || item.name));
            const clean = String(name || '').trim();
            if (clean) names.push(clean);
        });

        const presets = [];
        insUnique(names).forEach((name) => {
            const normalized = insNormalize(name);
            if (!normalized) return;
            if (criticalKeywords.some(keyword => normalized.includes(keyword))) {
                presets.push({ name, severity: 'critical', scoreThreshold: threshold });
                return;
            }
            if (semiKeywords.some(keyword => normalized.includes(keyword))) {
                presets.push({ name, severity: 'semi', scoreThreshold: threshold });
            }
        });

        return {
            defaultScoreThreshold: threshold,
            triggerPresets: presets
        };
    },

    normalizeSubjectReviews: function(raw) {
        if (!Array.isArray(raw)) return [];
        return raw.map((item) => {
            return {
                agent: String(item && item.agent || '').trim(),
                subject: insNormalizeSubjectName(item && item.subject || ''),
                decision: String(item && item.decision || '').trim().toLowerCase(),
                note: String(item && item.note || '').trim(),
                updatedAt: String(item && item.updatedAt || '').trim(),
                updatedBy: String(item && item.updatedBy || '').trim()
            };
        }).filter(item => {
            return !!item.agent && !!item.subject && ['improve', 'pass', 'complete_fail'].includes(item.decision);
        });
    },

    loadInitialData: async function() {
        const cached = this.loadCache();
        if (cached) {
            this.state = {
                ...this.state,
                ...cached
            };
        }

        if (!AppContext.supabase) return this.state;

        const bootstrapData = await this.withTimeout(
            Promise.all([
                this.fetchAllRows('users'),
                this.fetchAllRows('records'),
                this.fetchAllRows('submissions'),
                this.fetchAllRows('saved_reports'),
                this.fetchAllRows('insight_reviews'),
                this.fetchAllRows('exemptions'),
                this.fetchAllRows('attendance'),
                this.fetchAllRows('monitor_history'),
                this.fetchDocument('rosters'),
                this.fetchDocument('tl_agent_feedback'),
                this.fetchDocument('content_studio_data'),
                this.fetchDocument('assessments'),
                this.fetchDocument('vettingTopics'),
                this.fetchDocument('tests'),
                this.fetchDocument('insight_rule_config'),
                this.fetchDocument(INSIGHT_PROGRESS_CONFIG_KEY),
                this.fetchDocument(INSIGHT_SUBJECT_REVIEW_KEY)
            ]),
            INSIGHT_BOOT_TIMEOUT_MS,
            null,
            'insight initial data'
        );

        if (!bootstrapData || !Array.isArray(bootstrapData)) {
            return this.state;
        }

        const [
            usersRows,
            recordRows,
            submissionRows,
            savedReportsRows,
            insightReviewRows,
            exemptionRows,
            attendanceRows,
            monitorRows,
            rostersDoc,
            feedbackDoc,
            contentDoc,
            assessmentsDoc,
            topicsDoc,
            testsDoc,
            ruleConfigDoc,
            progressConfigDoc,
            subjectReviewsDoc
        ] = bootstrapData;

        this.state.users = this.normalizeUsers(usersRows);
        this.state.records = this.normalizeRecords(recordRows);
        this.state.submissions = this.normalizeSubmissions(submissionRows);
        const localSavedReports = insParseJson('savedReports', []);
        const localInsightReviews = insParseJson('insightReviews', []);
        const localExemptions = insParseJson('exemptions', []);
        this.state.savedReports = this.normalizeSavedReports(
            (Array.isArray(savedReportsRows) && savedReportsRows.length) ? savedReportsRows : localSavedReports
        );
        this.state.insightReviews = this.normalizeInsightReviews(
            (Array.isArray(insightReviewRows) && insightReviewRows.length) ? insightReviewRows : localInsightReviews
        );
        this.state.exemptions = this.normalizeExemptions(
            (Array.isArray(exemptionRows) && exemptionRows.length) ? exemptionRows : localExemptions
        );
        this.state.attendance = this.normalizeAttendance(attendanceRows);
        const localMonitorHistory = insParseJson('monitor_history', []);
        this.state.monitorHistory = this.normalizeMonitorHistory(
            (Array.isArray(monitorRows) && monitorRows.length) ? monitorRows : localMonitorHistory
        );

        const localRosters = insParseJson('rosters', {});
        this.state.rosters = (rostersDoc && typeof rostersDoc === 'object')
            ? rostersDoc
            : (localRosters && typeof localRosters === 'object' ? localRosters : {});

        const localFeedback = insParseJson('tl_agent_feedback', []);
        this.state.tlFeedback = Array.isArray(feedbackDoc) ? feedbackDoc : (Array.isArray(localFeedback) ? localFeedback : []);

        const localContentCanonical = insParseJson('content_studio_data', null);
        const localContentFallback = insParseJson('content_studio_data_local', null);
        const resolvedContent = (contentDoc && typeof contentDoc === 'object')
            ? contentDoc
            : ((localContentCanonical && typeof localContentCanonical === 'object')
                ? localContentCanonical
                : ((localContentFallback && typeof localContentFallback === 'object') ? localContentFallback : null));
        this.state.contentStore = (resolvedContent && typeof resolvedContent === 'object')
            ? {
                entries: Array.isArray(resolvedContent.entries) ? resolvedContent.entries : [],
                analytics: Array.isArray(resolvedContent.analytics) ? resolvedContent.analytics : [],
                annotations: Array.isArray(resolvedContent.annotations) ? resolvedContent.annotations : []
            }
            : { entries: [], analytics: [], annotations: [] };
        const localAssessments = insParseJson('assessments', []);
        const localTopics = insParseJson('vettingTopics', []);
        const localTests = insParseJson('tests', []);
        this.state.assessments = Array.isArray(assessmentsDoc) ? assessmentsDoc : (Array.isArray(localAssessments) ? localAssessments : []);
        this.state.vettingTopics = Array.isArray(topicsDoc) ? topicsDoc : (Array.isArray(localTopics) ? localTopics : []);
        this.state.tests = Array.isArray(testsDoc) ? testsDoc : (Array.isArray(localTests) ? localTests : []);

        const localRuleConfig = insParseJson('insight_rule_config', null);
        const resolvedRuleConfig = (ruleConfigDoc && typeof ruleConfigDoc === 'object')
            ? ruleConfigDoc
            : ((localRuleConfig && typeof localRuleConfig === 'object') ? localRuleConfig : null);
        const normalizedRuleConfig = this.normalizeRuleConfig(resolvedRuleConfig);
        this.state.ruleConfig = (Array.isArray(normalizedRuleConfig.triggerPresets) && normalizedRuleConfig.triggerPresets.length)
            ? normalizedRuleConfig
            : this.normalizeRuleConfig(this.buildDefaultRuleConfigFromCatalog());
        const localProgressConfig = insParseJson(INSIGHT_PROGRESS_CONFIG_KEY, null);
        const resolvedProgressConfig = (progressConfigDoc && typeof progressConfigDoc === 'object')
            ? progressConfigDoc
            : ((localProgressConfig && typeof localProgressConfig === 'object') ? localProgressConfig : null);
        this.state.progressConfig = this.normalizeProgressConfig(resolvedProgressConfig);
        const localSubjectReviews = insParseJson(INSIGHT_SUBJECT_REVIEW_KEY, []);
        this.state.subjectReviews = this.normalizeSubjectReviews(
            Array.isArray(subjectReviewsDoc) ? subjectReviewsDoc : localSubjectReviews
        );

        localStorage.setItem('insight_rule_config', JSON.stringify(this.state.ruleConfig));
        localStorage.setItem(INSIGHT_PROGRESS_CONFIG_KEY, JSON.stringify(this.state.progressConfig));
        localStorage.setItem('savedReports', JSON.stringify(this.state.savedReports));
        localStorage.setItem('insightReviews', JSON.stringify(this.state.insightReviews));
        localStorage.setItem('exemptions', JSON.stringify(this.state.exemptions));
        localStorage.setItem(INSIGHT_SUBJECT_REVIEW_KEY, JSON.stringify(this.state.subjectReviews));

        this.saveCache();
        return this.state;
    },

    refresh: async function() {
        return this.loadInitialData();
    },

    getGroups: function() {
        return Object.keys(this.state.rosters || {}).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    },

    getAgentGroup: function(agentName) {
        const rosters = this.state.rosters || {};
        for (const groupId of Object.keys(rosters)) {
            const members = Array.isArray(rosters[groupId]) ? rosters[groupId] : [];
            if (members.some(member => insMatch(member, agentName))) return groupId;
        }
        return 'Ungrouped';
    },

    getAgentProfile: function(agentName) {
        return this.state.users.find(user => insMatch(user.user, agentName)) || null;
    },

    getAllAgents: function() {
        const candidates = [];
        this.state.users.forEach(user => {
            if (['trainee', 'teamleader'].includes(user.role)) candidates.push(user.user);
        });

        Object.values(this.state.rosters || {}).forEach((members) => {
            if (!Array.isArray(members)) return;
            members.forEach(member => candidates.push(member));
        });

        this.state.records.forEach(row => candidates.push(row.trainee));
        this.state.attendance.forEach(row => candidates.push(row.user));
        this.state.submissions.forEach(row => candidates.push(row.trainee));
        this.state.savedReports.forEach(row => candidates.push(row.trainee));
        this.state.insightReviews.forEach(row => candidates.push(row.trainee));
        (this.state.tlFeedback || []).forEach(row => candidates.push(row.trainee));

        const seen = new Set();
        const list = [];
        candidates.forEach((name) => {
            const clean = String(name || '').trim();
            if (!clean) return;
            const key = insToken(clean);
            if (!key || seen.has(key)) return;
            seen.add(key);

            const profile = this.getAgentProfile(clean);
            list.push({
                name: clean,
                group: this.getAgentGroup(clean),
                badges: profile && Array.isArray(profile.badges) ? profile.badges : [],
                role: profile ? profile.role : 'trainee',
                blocked: profile ? profile.status === 'blocked' : false
            });
        });

        return list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    },

    getRuleConfig: function() {
        return this.normalizeRuleConfig(this.state.ruleConfig);
    },

    getProgressConfig: function() {
        return this.normalizeProgressConfig(this.state.progressConfig);
    },

    getProgressRequiredItems: function() {
        const progressCfg = this.getProgressConfig();
        const map = new Map();
        INSIGHT_AUTO_PROGRESS_ITEMS.forEach((item) => {
            map.set(insNormalize(item.name), { ...item });
        });
        (progressCfg.requiredItems || []).forEach((item) => {
            if (!item || typeof item !== 'object') return;
            const cleanName = String(item.name || '').trim();
            if (!cleanName) return;
            map.set(insNormalize(cleanName), {
                name: cleanName,
                type: insInferProgressType(cleanName, item.type),
                source: 'manual'
            });
        });
        const out = Array.from(map.values());
        out.sort((a, b) => {
            const rank = { assessment: 1, vetting: 2, test: 3, report: 4, review: 5 };
            const rankDiff = (rank[a.type] || 9) - (rank[b.type] || 9);
            if (rankDiff !== 0) return rankDiff;
            return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
        });
        return out;
    },

    isProgressItemExempt: function(agentName, groupID, itemName) {
        const targetGroup = String(groupID || '').trim();
        const targetItem = insNormalize(itemName);
        return (this.state.exemptions || []).some((row) => {
            if (!insMatch(row.trainee, agentName)) return false;
            if (targetGroup && String(row.groupID || '').trim() !== targetGroup) return false;
            return insNormalize(row.item) === targetItem;
        });
    },

    findProgressExemption: function(agentName, groupID, itemName) {
        const targetGroup = String(groupID || '').trim();
        const targetItem = insNormalize(itemName);
        return (this.state.exemptions || []).find((row) => {
            if (!insMatch(row.trainee, agentName)) return false;
            if (targetGroup && String(row.groupID || '').trim() !== targetGroup) return false;
            return insNormalize(row.item) === targetItem;
        }) || null;
    },

    isProgressItemCompleted: function(agentName, item) {
        const type = insInferProgressType(item && item.name, item && item.type);
        const itemName = String(item && item.name || '').trim();
        const normalizedName = insNormalize(itemName);
        if (!itemName) return false;

        if (type === 'report') {
            return (this.state.savedReports || []).some(row => insMatch(row.trainee, agentName));
        }
        if (type === 'review') {
            return (this.state.insightReviews || []).some(row => insMatch(row.trainee, agentName));
        }

        const records = this.getAgentRecords(agentName);
        if (records.some((row) => insNormalize(row.assessment) === normalizedName)) return true;

        const subs = (this.state.submissions || []).filter(row => insMatch(row.trainee, agentName));
        const hasSubmission = subs.some((row) => {
            const subStatus = insNormalize(row.status);
            if (!['completed', 'pass', 'passed', 'done', 'submitted'].includes(subStatus)) return false;
            return insNormalize(row.testTitle) === normalizedName;
        });
        if (hasSubmission) return true;

        if (type === 'vetting') {
            const base = normalizedName
                .replace(/^1st vetting -\s*/i, '')
                .replace(/^final vetting -\s*/i, '')
                .trim();
            if (!base) return false;

            if (records.some((row) => insNormalize(row.assessment).includes(base))) return true;
            if (subs.some((row) => insNormalize(row.testTitle).includes(base))) return true;
        }

        return false;
    },

    getAgentProgress: function(agentName, groupID) {
        const required = this.getProgressRequiredItems();
        const checklist = required.map((item) => {
            const exempt = this.isProgressItemExempt(agentName, groupID, item.name);
            if (exempt) {
                return { ...item, status: 'exempt' };
            }
            const completed = this.isProgressItemCompleted(agentName, item);
            return { ...item, status: completed ? 'completed' : 'missing' };
        });

        const completedCount = checklist.filter(item => item.status === 'completed' || item.status === 'exempt').length;
        const totalRequired = checklist.length;
        const progress = totalRequired > 0 ? Math.round((completedCount / totalRequired) * 100) : 0;

        return {
            progress,
            totalRequired,
            completedCount,
            items: checklist
        };
    },

    classifyAssessment: function(assessmentName) {
        const ruleConfig = this.getRuleConfig();
        const normalized = insNormalize(assessmentName);

        const override = (ruleConfig.triggerPresets || []).find(item => insNormalize(item.name) === normalized);
        if (override) return override.severity;
        return 'improvement';
    },

    getThresholdForAssessment: function(assessmentName) {
        const ruleConfig = this.getRuleConfig();
        const normalized = insNormalize(assessmentName);
        const override = (ruleConfig.triggerPresets || []).find(item => insNormalize(item.name) === normalized);
        if (override && Number.isFinite(Number(override.scoreThreshold))) {
            return Number(override.scoreThreshold);
        }
        return Math.max(1, Math.min(100, Math.round(insToNumber(ruleConfig.defaultScoreThreshold, 60))));
    },

    getAgentRecords: function(agentName) {
        return this.state.records.filter(row => insMatch(row.trainee, agentName));
    },

    getAgentRecordsForGroup: function(agentName, groupID) {
        return this.getAgentRecords(agentName).filter(row => insRecordMatchesGroup(row, groupID));
    },

    buildStatusFromRecords: function(recordsInput) {
        const records = Array.isArray(recordsInput) ? recordsInput : [];
        const defaultThreshold = this.getRuleConfig().defaultScoreThreshold;
        if (!records.length) {
            return {
                status: 'Pending',
                failedItems: [],
                scoreThreshold: defaultThreshold,
                thresholdLabel: `${defaultThreshold}%`
            };
        }

        const bestByAssessment = {};

        records.forEach((row) => {
            const key = insNormalize(row.assessment);
            if (!key) return;
            if (!bestByAssessment[key] || insToNumber(row.score, 0) > insToNumber(bestByAssessment[key].score, 0)) {
                bestByAssessment[key] = row;
            }
        });

        const failedCritical = [];
        const failedSemi = [];
        const failedImprove = [];
        const failedThresholds = new Set();

        Object.values(bestByAssessment).forEach((row) => {
            const score = insToNumber(row.score, 0);
            const threshold = this.getThresholdForAssessment(row.assessment);
            if (score >= threshold) return;
            const itemLabel = `${row.assessment} (${Math.round(score)}%)`;
            const severity = this.classifyAssessment(row.assessment);
            failedThresholds.add(threshold);
            if (severity === 'critical') failedCritical.push(itemLabel);
            else if (severity === 'semi') failedSemi.push(itemLabel);
            else failedImprove.push(itemLabel);
        });

        const thresholdLabel = failedThresholds.size <= 1
            ? `${(failedThresholds.size ? Array.from(failedThresholds)[0] : defaultThreshold)}%`
            : 'Per preset';

        if (failedCritical.length) return { status: 'Critical', failedItems: [...failedCritical, ...failedSemi, ...failedImprove], scoreThreshold: defaultThreshold, thresholdLabel };
        if (failedSemi.length) return { status: 'Semi-Critical', failedItems: [...failedSemi, ...failedImprove], scoreThreshold: defaultThreshold, thresholdLabel };
        if (failedImprove.length) return { status: 'Improvement', failedItems: failedImprove, scoreThreshold: defaultThreshold, thresholdLabel };
        return { status: 'Pass', failedItems: [], scoreThreshold: defaultThreshold, thresholdLabel: `${defaultThreshold}%` };
    },

    getAgentStatus: function(agentName) {
        return this.buildStatusFromRecords(this.getAgentRecords(agentName));
    },

    getAgentStatusForGroup: function(agentName, groupID) {
        return this.buildStatusFromRecords(this.getAgentRecordsForGroup(agentName, groupID));
    },

    getAgentAttendance: function(agentName) {
        const rows = this.state.attendance.filter(row => insMatch(row.user, agentName));
        rows.sort((a, b) => insToTs(b.date) - insToTs(a.date));
        return rows;
    },

    getAgentActivityBreakdown: function(agentName) {
        const history = this.state.monitorHistory.filter(row => insMatch(row.user, agentName));
        let idleMs = 0;
        let externalMs = 0;
        let studyMs = 0;
        let totalMs = 0;
        let violationCount = 0;

        history.forEach((entry) => {
            const summary = entry.summary || {};
            const summaryIdle = insToNumber(summary.idle, insToNumber(summary.idleMs, 0));
            const summaryExternal = insToNumber(summary.external, insToNumber(summary.externalMs, 0));
            const summaryStudy = insToNumber(summary.study, insToNumber(summary.studyMs, 0));
            const summaryTotal = insToNumber(
                summary.total,
                insToNumber(summary.totalMs, (summaryIdle + summaryExternal + summaryStudy))
            );
            const summaryViolationCount = insToNumber(summary.violations, insToNumber(summary.violationCount, 0));

            idleMs += summaryIdle;
            externalMs += summaryExternal;
            studyMs += summaryStudy;
            totalMs += summaryTotal;
            violationCount += summaryViolationCount;

            if (Array.isArray(entry.details)) {
                entry.details.forEach((detail) => {
                    const activity = String(detail.activity || '').toLowerCase();
                    const detailDuration = insToNumber(
                        detail.duration,
                        insToNumber(detail.durationMs, insToNumber(detail.effectiveDuration, insToNumber(detail.ms, 0)))
                    );
                    if (detailDuration > 0 && summaryTotal <= 0) {
                        totalMs += detailDuration;
                        if (activity.includes('idle')) idleMs += detailDuration;
                        else if (activity.includes('external') || activity.includes('violation')) externalMs += detailDuration;
                        else studyMs += detailDuration;
                    }
                    if (activity.includes('violation')) violationCount += 1;
                });
            }
        });

        const focusScore = totalMs > 0 ? Math.round((studyMs / totalMs) * 100) : 0;
        return {
            daysTracked: history.length,
            idleMinutes: Math.round(idleMs / 60000),
            externalMinutes: Math.round(externalMs / 60000),
            violationCount,
            focusScore,
            history: history.sort((a, b) => insToTs(b.date) - insToTs(a.date))
        };
    },

    getAgentFeedback: function(agentName) {
        return (this.state.tlFeedback || [])
            .filter(item => insMatch(item.trainee, agentName))
            .sort((a, b) => insToTs(b.date || b.createdAt) - insToTs(a.date || a.createdAt));
    },

    getAgentContentEngagement: function(agentName) {
        const target = insNormalize(agentName);
        const contentStore = this.state.contentStore || { entries: [], analytics: [], annotations: [] };
        const subjectMap = {};

        (contentStore.entries || []).forEach((entry) => {
            (entry.subjects || []).forEach((subject) => {
                const id = String(subject.id || '').trim();
                if (!id) return;
                subjectMap[id] = {
                    code: String(subject.code || '').trim(),
                    title: String(subject.textHtml || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
                };
            });
        });

        const bySubject = {};
        (contentStore.analytics || []).forEach((row) => {
            if (!insMatch(row.username, target)) return;
            const subjectId = String(row.subjectId || '').trim();
            if (!subjectId) return;
            if (!bySubject[subjectId]) {
                bySubject[subjectId] = {
                    subjectId,
                    plays: 0,
                    watchSeconds: 0,
                    skips: 0,
                    quizAttempts: 0,
                    quizBestScore: null,
                    failedQuestions: 0
                };
            }
            bySubject[subjectId].plays += insToNumber(row.plays, 0);
            bySubject[subjectId].watchSeconds += insToNumber(row.watchSeconds, 0);
            bySubject[subjectId].skips += insToNumber(row.skips, 0);
        });

        this.state.submissions.forEach((submission) => {
            if (!insMatch(submission.trainee, target)) return;
            const context = submission.contentStudioContext || {};
            const subjectId = String(context.subjectId || '').trim();
            if (!subjectId) return;
            if (!bySubject[subjectId]) {
                bySubject[subjectId] = {
                    subjectId,
                    plays: 0,
                    watchSeconds: 0,
                    skips: 0,
                    quizAttempts: 0,
                    quizBestScore: null,
                    failedQuestions: 0
                };
            }

            const score = insToNumber(submission.score || (submission.quizMeta && submission.quizMeta.percent), 0);
            bySubject[subjectId].quizAttempts += 1;
            if (bySubject[subjectId].quizBestScore === null || score > bySubject[subjectId].quizBestScore) {
                bySubject[subjectId].quizBestScore = score;
            }
            const failedQuestions = submission.quizMeta && Array.isArray(submission.quizMeta.failedQuestions)
                ? submission.quizMeta.failedQuestions.length
                : 0;
            bySubject[subjectId].failedQuestions += failedQuestions;
        });

        const subjects = Object.values(bySubject).map((item) => {
            const subject = subjectMap[item.subjectId] || {};
            return {
                ...item,
                code: subject.code || '-',
                title: subject.title || '-'
            };
        }).sort((a, b) => {
            const quizDiff = insToNumber(b.quizAttempts, 0) - insToNumber(a.quizAttempts, 0);
            if (quizDiff !== 0) return quizDiff;
            return insToNumber(b.watchSeconds, 0) - insToNumber(a.watchSeconds, 0);
        });

        const totals = subjects.reduce((acc, item) => {
            acc.subjectCount += 1;
            acc.totalWatchSeconds += insToNumber(item.watchSeconds, 0);
            acc.totalQuizAttempts += insToNumber(item.quizAttempts, 0);
            acc.failedQuestions += insToNumber(item.failedQuestions, 0);
            return acc;
        }, { subjectCount: 0, totalWatchSeconds: 0, totalQuizAttempts: 0, failedQuestions: 0 });

        return { totals, subjects };
    },

    getAgentTimeline: function(agentName) {
        const events = [];

        this.getAgentRecords(agentName).forEach((record) => {
            events.push({
                ts: insToTs(record.date),
                date: record.date,
                type: 'Assessment',
                detail: `${record.assessment} - ${Math.round(insToNumber(record.score, 0))}%`
            });
        });

        this.state.submissions
            .filter(submission => insMatch(submission.trainee, agentName))
            .forEach((submission) => {
                events.push({
                    ts: insToTs(submission.date || submission.lastModified || submission.createdAt),
                    date: submission.date || submission.lastModified || submission.createdAt,
                    type: 'Quiz Submission',
                    detail: `${submission.testTitle || 'Assessment'} - ${Math.round(insToNumber(submission.score, 0))}% (${submission.status || 'unknown'})`
                });
            });

        this.getAgentAttendance(agentName).forEach((att) => {
            events.push({
                ts: insToTs(att.date),
                date: att.date,
                type: 'Attendance',
                detail: `${att.clockIn || '-'} to ${att.clockOut || '-'}${att.isLate ? ' (Late)' : ''}`
            });
        });

        this.getAgentFeedback(agentName).forEach((feedback) => {
            events.push({
                ts: insToTs(feedback.date || feedback.createdAt),
                date: feedback.date || feedback.createdAt,
                type: 'Production Feedback',
                detail: `${feedback.selectedMedium || 'N/A'} - ${feedback.problemStatement || 'N/A'} (Ticket: ${feedback.ticketNumber || '-'})`
            });
        });

        this.state.monitorHistory
            .filter(history => insMatch(history.user, agentName))
            .forEach((history) => {
                const summary = history.summary || {};
                events.push({
                    ts: insToTs(history.date),
                    date: history.date,
                    type: 'Activity Summary',
                    detail: `Focus ${insToNumber(summary.total, 0) > 0 ? Math.round((insToNumber(summary.study, 0) / insToNumber(summary.total, 0)) * 100) : 0}% | Idle ${Math.round(insToNumber(summary.idle, 0) / 60000)}m`
                });
            });

        return events.sort((a, b) => b.ts - a.ts);
    },

    getAgentSubjectReviewMap: function(agentName) {
        const map = {};
        (this.state.subjectReviews || [])
            .filter(item => insMatch(item.agent, agentName))
            .forEach((item) => {
                const key = insNormalize(item.subject);
                if (!key) return;
                map[key] = {
                    subject: item.subject,
                    decision: item.decision,
                    note: item.note,
                    updatedAt: item.updatedAt,
                    updatedBy: item.updatedBy
                };
            });
        return map;
    },

    getAgentDetail: function(agentName) {
        return {
            profile: this.getAgentProfile(agentName),
            group: this.getAgentGroup(agentName),
            status: this.getAgentStatus(agentName),
            attendance: this.getAgentAttendance(agentName),
            activity: this.getAgentActivityBreakdown(agentName),
            feedback: this.getAgentFeedback(agentName),
            engagement: this.getAgentContentEngagement(agentName),
            timeline: this.getAgentTimeline(agentName),
            subjectReviewMap: this.getAgentSubjectReviewMap(agentName)
        };
    },

    getDepartmentOverview: function(groupFilter, searchText) {
        const normalizedSearch = String(searchText || '').trim().toLowerCase();
        const selectedGroup = String(groupFilter || 'all').trim();
        const inGroup = (agent) => selectedGroup === 'all' || String(agent.group || '') === selectedGroup;

        const agents = this.getAllAgents().filter((agent) => {
            if (String(agent.role || '').toLowerCase() !== 'trainee') return false;
            if (!inGroup(agent)) return false;
            if (normalizedSearch && !String(agent.name || '').toLowerCase().includes(normalizedSearch)) return false;
            return true;
        });

        const statusCounts = { Critical: 0, 'Semi-Critical': 0, Improvement: 0, Pass: 0, Pending: 0 };
        const focusPool = [];
        const scorePool = [];
        const timelineRows = [];
        const effortRows = [];
        const lateRows = [];
        const activityRows = [];
        const engagementRows = [];
        const feedbackRows = [];
        const feedbackMediumMap = {};
        const subjectStatsMap = {};
        const assessmentStatsMap = {};

        let totalLateCount = 0;
        let totalConfirmedLateCount = 0;
        let totalViolationCount = 0;
        let totalIdleMinutes = 0;
        let totalExternalMinutes = 0;
        let totalWatchSeconds = 0;
        let totalQuizAttempts = 0;
        let totalFailedQuestions = 0;
        let totalFeedback = 0;
        let totalFailedSubjects = 0;
        let reviewedFailedSubjects = 0;

        agents.forEach((agent) => {
            const scopedRecords = this.getAgentRecordsForGroup(agent.name, selectedGroup);
            const status = this.buildStatusFromRecords(scopedRecords);
            statusCounts[status.status] = (statusCounts[status.status] || 0) + 1;

            let avgScore = 0;
            if (scopedRecords.length) {
                const sum = scopedRecords.reduce((acc, row) => acc + insToNumber(row.score, 0), 0);
                avgScore = Math.round(sum / scopedRecords.length);
                scorePool.push(...scopedRecords.map(row => insToNumber(row.score, 0)));
            }

            scopedRecords.forEach((row) => {
                const key = insNormalize(row.assessment);
                if (!key) return;
                if (!assessmentStatsMap[key]) {
                    assessmentStatsMap[key] = { assessment: row.assessment, totalScore: 0, attempts: 0, belowThreshold: 0 };
                }
                assessmentStatsMap[key].totalScore += insToNumber(row.score, 0);
                assessmentStatsMap[key].attempts += 1;
                const threshold = this.getThresholdForAssessment(row.assessment);
                if (insToNumber(row.score, 0) < threshold) assessmentStatsMap[key].belowThreshold += 1;
            });

            const attendance = this.getAgentAttendance(agent.name);
            const lateEntries = attendance.filter(item => item.isLate);
            const confirmedLate = lateEntries.filter(item => item.lateConfirmed);
            totalLateCount += lateEntries.length;
            totalConfirmedLateCount += confirmedLate.length;
            if (lateEntries.length) {
                lateRows.push({
                    agent: agent.name,
                    lateCount: lateEntries.length,
                    confirmedCount: confirmedLate.length,
                    lastLateDate: lateEntries[0] ? lateEntries[0].date : ''
                });
            }

            const activity = this.getAgentActivityBreakdown(agent.name);
            totalViolationCount += insToNumber(activity.violationCount, 0);
            totalIdleMinutes += insToNumber(activity.idleMinutes, 0);
            totalExternalMinutes += insToNumber(activity.externalMinutes, 0);
            if (activity.daysTracked > 0) focusPool.push(insToNumber(activity.focusScore, 0));
            activityRows.push({
                agent: agent.name,
                violationCount: insToNumber(activity.violationCount, 0),
                idleMinutes: insToNumber(activity.idleMinutes, 0),
                externalMinutes: insToNumber(activity.externalMinutes, 0),
                focusScore: insToNumber(activity.focusScore, 0)
            });

            const engagement = this.getAgentContentEngagement(agent.name);
            totalWatchSeconds += insToNumber(engagement.totals.totalWatchSeconds, 0);
            totalQuizAttempts += insToNumber(engagement.totals.totalQuizAttempts, 0);
            totalFailedQuestions += insToNumber(engagement.totals.failedQuestions, 0);
            const bestScore = (engagement.subjects || []).reduce((best, item) => {
                const score = item.quizBestScore === null ? null : insToNumber(item.quizBestScore, 0);
                if (score === null) return best;
                if (best === null || score > best) return score;
                return best;
            }, null);
            engagementRows.push({
                agent: agent.name,
                subjectCount: insToNumber(engagement.totals.subjectCount, 0),
                watchSeconds: insToNumber(engagement.totals.totalWatchSeconds, 0),
                quizAttempts: insToNumber(engagement.totals.totalQuizAttempts, 0),
                failedQuestions: insToNumber(engagement.totals.failedQuestions, 0),
                bestScore
            });

            const subjectReviewMap = this.getAgentSubjectReviewMap(agent.name);
            (status.failedItems || []).forEach((failedItem) => {
                const subjectCore = insNormalizeSubjectName(failedItem);
                const key = insNormalize(subjectCore);
                if (!key) return;
                if (!subjectStatsMap[key]) {
                    subjectStatsMap[key] = {
                        subject: subjectCore,
                        failCount: 0,
                        reviewedCount: 0,
                        improveCount: 0,
                        passCount: 0,
                        completeFailCount: 0
                    };
                }
                totalFailedSubjects += 1;
                subjectStatsMap[key].failCount += 1;

                const review = subjectReviewMap[key];
                if (review && review.decision) {
                    reviewedFailedSubjects += 1;
                    subjectStatsMap[key].reviewedCount += 1;
                    const decision = insNormalize(review.decision);
                    if (decision === 'pass') subjectStatsMap[key].passCount += 1;
                    else if (decision === 'complete fail') subjectStatsMap[key].completeFailCount += 1;
                    else subjectStatsMap[key].improveCount += 1;
                }
            });

            const feedback = this.getAgentFeedback(agent.name);
            totalFeedback += feedback.length;
            feedback.forEach((item) => {
                const medium = String(item.selectedMedium || 'Unspecified').trim() || 'Unspecified';
                const mediumKey = medium.toLowerCase();
                feedbackMediumMap[mediumKey] = feedbackMediumMap[mediumKey] || { medium, count: 0 };
                feedbackMediumMap[mediumKey].count += 1;
                feedbackRows.push({
                    agent: agent.name,
                    tl: item.tl || '',
                    date: item.date || item.createdAt || '',
                    selectedMedium: medium,
                    problemStatement: item.problemStatement || '',
                    ticketNumber: item.ticketNumber || ''
                });
            });

            const timeline = this.getAgentTimeline(agent.name).slice(0, 25);
            timeline.forEach((event) => {
                timelineRows.push({
                    agent: agent.name,
                    ts: insToTs(event.date || event.ts),
                    date: event.date || '',
                    type: event.type || 'Event',
                    detail: event.detail || ''
                });
            });

            let effortStatus = 'On Track';
            let effortTone = 'pass';
            const focusScore = insToNumber(activity.focusScore, 0);
            if (!scopedRecords.length) {
                effortStatus = 'No Score Yet';
                effortTone = 'pending';
            } else if (avgScore < 80 && focusScore >= 70) {
                effortStatus = 'Struggling (High Effort)';
                effortTone = 'semi';
            } else if (avgScore < 80) {
                effortStatus = 'At Risk (Low Effort)';
                effortTone = 'critical';
            }

            effortRows.push({
                agent: agent.name,
                avgScore,
                focusScore,
                status: effortStatus,
                tone: effortTone
            });
        });

        const avgScore = scorePool.length
            ? Math.round(scorePool.reduce((acc, value) => acc + insToNumber(value, 0), 0) / scorePool.length)
            : 0;
        const avgFocus = focusPool.length
            ? Math.round(focusPool.reduce((acc, value) => acc + insToNumber(value, 0), 0) / focusPool.length)
            : 0;

        const failedSubjectRows = Object.values(subjectStatsMap)
            .sort((a, b) => {
                const failDiff = insToNumber(b.failCount, 0) - insToNumber(a.failCount, 0);
                if (failDiff !== 0) return failDiff;
                return String(a.subject || '').localeCompare(String(b.subject || ''), undefined, { sensitivity: 'base', numeric: true });
            })
            .slice(0, 12);

        const struggleAreas = Object.values(assessmentStatsMap)
            .map((item) => ({
                assessment: item.assessment,
                avgScore: item.attempts ? Math.round(item.totalScore / item.attempts) : 0,
                attempts: item.attempts,
                belowThreshold: item.belowThreshold
            }))
            .sort((a, b) => {
                const avgDiff = insToNumber(a.avgScore, 0) - insToNumber(b.avgScore, 0);
                if (avgDiff !== 0) return avgDiff;
                return insToNumber(b.attempts, 0) - insToNumber(a.attempts, 0);
            })
            .slice(0, 12);

        lateRows.sort((a, b) => {
            const diff = insToNumber(b.lateCount, 0) - insToNumber(a.lateCount, 0);
            if (diff !== 0) return diff;
            return String(a.agent || '').localeCompare(String(b.agent || ''), undefined, { sensitivity: 'base' });
        });

        activityRows.sort((a, b) => {
            const violationDiff = insToNumber(b.violationCount, 0) - insToNumber(a.violationCount, 0);
            if (violationDiff !== 0) return violationDiff;
            const idleDiff = insToNumber(b.idleMinutes, 0) - insToNumber(a.idleMinutes, 0);
            if (idleDiff !== 0) return idleDiff;
            return String(a.agent || '').localeCompare(String(b.agent || ''), undefined, { sensitivity: 'base' });
        });

        engagementRows.sort((a, b) => {
            const failDiff = insToNumber(b.failedQuestions, 0) - insToNumber(a.failedQuestions, 0);
            if (failDiff !== 0) return failDiff;
            const quizDiff = insToNumber(b.quizAttempts, 0) - insToNumber(a.quizAttempts, 0);
            if (quizDiff !== 0) return quizDiff;
            return insToNumber(b.watchSeconds, 0) - insToNumber(a.watchSeconds, 0);
        });

        feedbackRows.sort((a, b) => insToTs(b.date) - insToTs(a.date));
        const feedbackMediumRows = Object.values(feedbackMediumMap)
            .sort((a, b) => insToNumber(b.count, 0) - insToNumber(a.count, 0));

        timelineRows.sort((a, b) => insToNumber(b.ts, 0) - insToNumber(a.ts, 0));
        const limitedTimeline = timelineRows.slice(0, 120);

        effortRows.sort((a, b) => {
            const scoreDiff = insToNumber(a.avgScore, 0) - insToNumber(b.avgScore, 0);
            if (scoreDiff !== 0) return scoreDiff;
            return insToNumber(a.focusScore, 0) - insToNumber(b.focusScore, 0);
        });

        const reviewCoverage = totalFailedSubjects > 0
            ? Math.round((reviewedFailedSubjects / totalFailedSubjects) * 100)
            : 100;

        return {
            scope: {
                groupFilter: selectedGroup,
                searchText: normalizedSearch,
                agentCount: agents.length
            },
            kpis: {
                criticalCount: statusCounts.Critical || 0,
                semiCount: statusCounts['Semi-Critical'] || 0,
                improvementCount: statusCounts.Improvement || 0,
                passCount: statusCounts.Pass || 0,
                pendingCount: statusCounts.Pending || 0,
                actionRequiredCount: (statusCounts.Critical || 0) + (statusCounts.Improvement || 0),
                avgScore,
                avgFocus,
                totalLateCount,
                totalConfirmedLateCount,
                totalViolationCount,
                totalIdleMinutes,
                totalExternalMinutes,
                totalWatchSeconds,
                totalQuizAttempts,
                totalFailedQuestions,
                totalFeedback,
                totalFailedSubjects,
                reviewedFailedSubjects,
                reviewCoverage,
                timelineEventCount: limitedTimeline.length
            },
            effortRows: effortRows.slice(0, 20),
            struggleAreas,
            lateRows: lateRows.slice(0, 12),
            activityRows: activityRows.slice(0, 12),
            engagementRows: engagementRows.slice(0, 12),
            failedSubjectRows,
            feedbackMediumRows: feedbackMediumRows.slice(0, 8),
            feedbackRecent: feedbackRows.slice(0, 20),
            timelineRows: limitedTimeline
        };
    },

    saveSubjectReview: async function(agentName, subjectLabel, decision, note) {
        const agent = String(agentName || '').trim();
        const subject = insNormalizeSubjectName(subjectLabel);
        const cleanDecision = String(decision || '').trim().toLowerCase();
        if (!agent || !subject) return { ok: false, message: 'Missing agent or subject.' };
        if (!['improve', 'pass', 'complete_fail'].includes(cleanDecision)) {
            return { ok: false, message: 'Invalid decision value.' };
        }

        const updatedAt = new Date().toISOString();
        const updatedBy = AppContext && AppContext.user ? String(AppContext.user.user || '').trim() : 'system';
        const cleanNote = String(note || '').trim();
        const normalizedAgent = insNormalize(agent);
        const normalizedSubject = insNormalize(subject);

        const list = Array.isArray(this.state.subjectReviews) ? this.state.subjectReviews.slice() : [];
        const idx = list.findIndex((item) => {
            return insNormalize(item.agent) === normalizedAgent && insNormalize(item.subject) === normalizedSubject;
        });

        const payload = {
            agent,
            subject,
            decision: cleanDecision,
            note: cleanNote,
            updatedAt,
            updatedBy
        };

        if (idx > -1) list[idx] = payload;
        else list.push(payload);

        this.state.subjectReviews = this.normalizeSubjectReviews(list);
        localStorage.setItem(INSIGHT_SUBJECT_REVIEW_KEY, JSON.stringify(this.state.subjectReviews));
        this.saveCache();

        if (AppContext.supabase) {
            const { error } = await AppContext.supabase.from('app_documents').upsert({
                key: INSIGHT_SUBJECT_REVIEW_KEY,
                content: this.state.subjectReviews,
                updated_at: updatedAt
            });

            if (error) {
                console.warn('[Insight] Failed to sync subject reviews:', error);
                return { ok: false, message: 'Saved locally but failed to sync to cloud.' };
            }
        }

        return { ok: true };
    },

    toggleProgressExemption: async function(agentName, groupID, itemName, shouldExempt) {
        const trainee = String(agentName || '').trim();
        const group = String(groupID || '').trim();
        const item = String(itemName || '').trim();
        if (!trainee || !item) return { ok: false, message: 'Missing exemption details.' };

        const existing = this.findProgressExemption(trainee, group, item);
        const nowIso = new Date().toISOString();
        const actor = AppContext && AppContext.user ? String(AppContext.user.user || '').trim() : 'system';

        if (shouldExempt && !existing) {
            const payload = {
                trainee,
                groupID: group,
                item,
                updatedAt: nowIso,
                updatedBy: actor
            };

            if (AppContext.supabase) {
                const { data, error } = await AppContext.supabase
                    .from('exemptions')
                    .insert({ user_id: trainee, data: payload, updated_at: nowIso })
                    .select('id, data')
                    .maybeSingle();
                if (error) {
                    console.warn('[Insight] Failed adding exemption:', error);
                    return { ok: false, message: 'Failed to save exemption on server.' };
                }
                this.state.exemptions.push({
                    _rowId: String(data && data.id || ''),
                    trainee,
                    groupID: group,
                    item
                });
            } else {
                this.state.exemptions.push({
                    _rowId: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    trainee,
                    groupID: group,
                    item
                });
            }
        }

        if (!shouldExempt && existing) {
            if (AppContext.supabase && existing._rowId) {
                const { error } = await AppContext.supabase
                    .from('exemptions')
                    .delete()
                    .eq('id', existing._rowId);
                if (error) {
                    console.warn('[Insight] Failed removing exemption:', error);
                    return { ok: false, message: 'Failed removing exemption on server.' };
                }
            }
            this.state.exemptions = this.state.exemptions.filter(row => {
                if (existing._rowId) return String(row._rowId || '') !== String(existing._rowId || '');
                return !(insMatch(row.trainee, trainee) && String(row.groupID || '') === group && insNormalize(row.item) === insNormalize(item));
            });
        }

        localStorage.setItem('exemptions', JSON.stringify(this.state.exemptions));
        this.saveCache();
        return { ok: true };
    },

    isAgentLoginActive: function(agentName) {
        const profile = this.getAgentProfile(agentName);
        if (!profile) return false;
        return String(profile.status || '').toLowerCase() !== 'blocked';
    },

    updateLateAttendance: async function(rowId, patch) {
        const targetId = String(rowId || '').trim();
        if (!targetId) return { ok: false, message: 'Missing attendance record ID.' };

        const record = this.state.attendance.find(item => String(item._rowId || '') === targetId);
        if (!record) return { ok: false, message: 'Attendance record was not found.' };

        if (!record.lateData || typeof record.lateData !== 'object') record.lateData = {};

        if (patch && Object.prototype.hasOwnProperty.call(patch, 'reason')) {
            record.lateData.reason = String(patch.reason || '').trim();
        }
        if (patch && Object.prototype.hasOwnProperty.call(patch, 'adminComment')) {
            record.adminComment = String(patch.adminComment || '').trim();
        }
        if (patch && Object.prototype.hasOwnProperty.call(patch, 'lateConfirmed')) {
            record.lateConfirmed = !!patch.lateConfirmed;
        }
        if (patch && Object.prototype.hasOwnProperty.call(patch, 'isLate')) {
            record.isLate = !!patch.isLate;
        }

        const payload = {
            id: targetId,
            user: record.user,
            date: record.date,
            clockIn: record.clockIn,
            clockOut: record.clockOut,
            isLate: !!record.isLate,
            lateConfirmed: !!record.lateConfirmed,
            isIgnored: !!record.isIgnored,
            lateData: record.lateData,
            adminComment: record.adminComment || ''
        };

        if (AppContext.supabase) {
            const { error } = await AppContext.supabase
                .from('attendance')
                .update({ data: payload, updated_at: new Date().toISOString() })
                .eq('id', targetId);

            if (error) {
                console.warn('[Insight] Failed to update attendance:', error);
                return { ok: false, message: 'Failed to update attendance on the server.' };
            }
        }

        this.saveCache();
        return { ok: true };
    }
};

window.InsightDataService = InsightDataService;

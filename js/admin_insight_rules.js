/* ================= ADMIN: INSIGHT RULE PRESETS ================= */

(function() {
    const INSIGHT_RULE_KEY = 'insight_rule_config';
    const INSIGHT_PROGRESS_KEY = 'insight_progress_config';
    const LIVE_RULES_KEY = 'live_assessment_rules_config';
    const LIVE_BOOKING_RULES_KEY = 'live_booking_rules_config';
    const TRAINING_RULES_KEY = 'training_rules_config';
    const DEFAULT_LIVE_ASSESSMENT_RULES = [
        'This assessment takes approximately 1 hour to complete.',
        'You are allowed to reference the training material. However, if the material is referenced constantly and it is clear the material was not studied, the live session will be ended.',
        'If you are unable to answer a question within 5 minutes of it being provided, the marks obtained for that question are final and the next question will be provided.'
    ];
    const DEFAULT_LIVE_ASSESSMENT_RULES_HTML = `<ul>${DEFAULT_LIVE_ASSESSMENT_RULES.map(rule => `<li>${rule}</li>`).join('')}</ul>`;
    const DEFAULT_LIVE_BOOKING_RULES = [
        'Trainees may book only one live assessment session per hour.',
        'Book assessments in the correct training sequence where possible.',
        'Booking times may change depending on facilitator availability.',
        'Cancellation Policy: trainees can cancel one session; further cancellations require admin approval.'
    ];
    const DEFAULT_LIVE_BOOKING_RULES_HTML = `<ul>${DEFAULT_LIVE_BOOKING_RULES.map(rule => `<li>${rule}</li>`).join('')}</ul>`;
    const DEFAULT_TRAINING_RULES = [
        'Be present and ready for training at your scheduled start time.',
        'Keep your contact details, office, and training background up to date.',
        'Use approved training systems and ask your trainer when anything is unclear.'
    ];
    const DEFAULT_TRAINING_RULES_HTML = `<ul>${DEFAULT_TRAINING_RULES.map(rule => `<li>${rule}</li>`).join('')}</ul>`;

    const AUTO_PROGRESS_ITEMS = [
        { name: 'Onboard Report', type: 'report', source: 'auto' },
        { name: 'Insight Review', type: 'review', source: 'auto' }
    ];

    const draftState = {
        loaded: false,
        config: null,
        progressLoaded: false,
        progressConfig: null,
        liveRulesLoaded: false,
        liveRulesConfig: null,
        liveBookingRulesLoaded: false,
        liveBookingRulesConfig: null,
        trainingRulesLoaded: false,
        trainingRulesConfig: null
    };

    function normalizeText(value) {
        return String(value || '').trim().toLowerCase();
    }

    function uniqueStrings(values) {
        const seen = new Set();
        const out = [];
        (values || []).forEach((raw) => {
            const value = String(raw || '').trim();
            if (!value) return;
            const key = normalizeText(value);
            if (seen.has(key)) return;
            seen.add(key);
            out.push(value);
        });
        return out;
    }

    function sanitizeSeverity(value) {
        const normalized = normalizeText(value);
        if (normalized === 'critical') return 'critical';
        if (normalized === 'semi' || normalized === 'semi-critical' || normalized === 'semi_critical') return 'semi';
        if (normalized === 'improvement' || normalized === 'improve') return 'improvement';
        return 'improvement';
    }

    function clampThreshold(value, fallback) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.max(1, Math.min(100, Math.round(parsed)));
    }

    function inferProgressType(name, explicitType) {
        const raw = String(name || '').trim();
        const normalizedType = normalizeText(explicitType);
        if (['assessment', 'vetting', 'test', 'live', 'report', 'review'].includes(normalizedType)) {
            return normalizedType;
        }
        const normalizedName = normalizeText(raw);
        if (!normalizedName) return 'assessment';
        if (normalizedName === 'onboard report') return 'report';
        if (normalizedName === 'insight review') return 'review';
        if (normalizedName.includes('live assessment') || normalizedName.includes('live session')) return 'live';
        if (normalizedName.startsWith('1st vetting -') || normalizedName.startsWith('final vetting -')) return 'vetting';
        return 'assessment';
    }

    function isVettingOneName(name) {
        const normalized = normalizeText(name);
        return normalized.includes('1st vetting') || normalized.includes('test 1');
    }

    function isFinalVettingName(name) {
        const normalized = normalizeText(name);
        return normalized.includes('final vetting') || normalized.includes('test 2') || normalized.includes('final');
    }

    function sanitizeReportSections(rawSections, itemName, itemType) {
        const source = rawSections && typeof rawSections === 'object' ? rawSections : {};
        const type = inferProgressType(itemName, itemType);
        const hasExplicit = ['trainingGoal', 'assessmentScores', 'vettingTest1', 'vettingFinal']
            .some(key => Object.prototype.hasOwnProperty.call(source, key));

        if (hasExplicit) {
            return {
                trainingGoal: source.trainingGoal === true,
                assessmentScores: source.assessmentScores === true,
                vettingTest1: source.vettingTest1 === true,
                vettingFinal: source.vettingFinal === true
            };
        }

        return {
            trainingGoal: type === 'assessment' || type === 'test',
            assessmentScores: type === 'assessment' || type === 'test' || type === 'live',
            vettingTest1: type === 'vetting' && !isFinalVettingName(itemName),
            vettingFinal: type === 'vetting' && !isVettingOneName(itemName)
        };
    }

    function parseArrayFromLocalStorage(key) {
        try {
            const parsed = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    function getAssessmentCatalog() {
        if (window.ProgressCatalog && typeof window.ProgressCatalog.getCandidateItems === 'function') {
            const catalog = window.ProgressCatalog.getCandidateItems({ includeConfigured: false, includeAuto: false });
            if (catalog.length) {
                return catalog
                    .map(item => ({ name: item.name, type: item.type, source: 'Test Engine' }))
                    .filter(item => item.name);
            }
            return window.ProgressCatalog.getCandidateItems({ includeConfigured: true, includeAuto: false, includeLegacy: true })
                .map(item => ({ name: item.name, type: item.type, source: 'Legacy fallback' }))
                .filter(item => item.name);
        }

        const tests = parseArrayFromLocalStorage('tests');
        const names = [];

        if (Array.isArray(tests)) {
            tests.forEach((test) => {
                const title = String((test && (test.title || test.name)) || '').trim();
                if (title) names.push(title);
            });
        }

        return uniqueStrings(names)
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
            .map(name => ({ name, type: inferProgressType(name, null), source: 'test-engine' }));
    }

    function getAssessmentCatalogNameSet() {
        return new Set(getAssessmentCatalog().map(item => normalizeText(item.name || item)));
    }

    function getDefaultThreshold() {
        return (typeof IMPROVE !== 'undefined' && Number.isFinite(Number(IMPROVE)))
            ? Number(IMPROVE)
            : 60;
    }

    function getDefaultInsightRuleConfig() {
        const defaultCriticalKeywords = (typeof INSIGHT_CONFIG !== 'undefined' && Array.isArray(INSIGHT_CONFIG.CRITICAL))
            ? uniqueStrings(INSIGHT_CONFIG.CRITICAL)
            : [];
        const defaultSemiKeywords = (typeof INSIGHT_CONFIG !== 'undefined' && Array.isArray(INSIGHT_CONFIG.SEMI_CRITICAL))
            ? uniqueStrings(INSIGHT_CONFIG.SEMI_CRITICAL)
            : [];

        const fallbackThreshold = getDefaultThreshold();
        const catalog = getAssessmentCatalog();
        const triggerPresets = [];

        catalog.forEach((name) => {
            const normalizedName = normalizeText(name);
            if (defaultCriticalKeywords.some(keyword => normalizedName.includes(normalizeText(keyword)))) {
                triggerPresets.push({ name, severity: 'critical', scoreThreshold: fallbackThreshold });
                return;
            }
            if (defaultSemiKeywords.some(keyword => normalizedName.includes(normalizeText(keyword)))) {
                triggerPresets.push({ name, severity: 'semi', scoreThreshold: fallbackThreshold });
            }
        });

        return {
            defaultScoreThreshold: fallbackThreshold,
            triggerPresets,
            updatedAt: null,
            updatedBy: null
        };
    }

    function getDefaultProgressConfig() {
        return {
            requiredItems: [],
            updatedAt: null,
            updatedBy: null
        };
    }

    function getDefaultLiveRulesConfig() {
        return {
            rules: DEFAULT_LIVE_ASSESSMENT_RULES.slice(),
            rulesHtml: DEFAULT_LIVE_ASSESSMENT_RULES_HTML,
            updatedAt: null,
            updatedBy: null
        };
    }

    function getDefaultLiveBookingRulesConfig() {
        return {
            rules: DEFAULT_LIVE_BOOKING_RULES.slice(),
            rulesHtml: DEFAULT_LIVE_BOOKING_RULES_HTML,
            updatedAt: null,
            updatedBy: null
        };
    }

    function getDefaultTrainingRulesConfig() {
        return {
            rules: DEFAULT_TRAINING_RULES.slice(),
            rulesHtml: DEFAULT_TRAINING_RULES_HTML,
            showOnFirstLogin: true,
            showOnLogin: false,
            targetMode: 'all',
            targetUsers: [],
            targetGroups: [],
            officeOptions: ['Head Office', 'Regional Office', 'Remote'],
            updatedAt: null,
            updatedBy: null
        };
    }

    function pushPreset(map, name, severity, scoreThreshold, defaultThreshold) {
        const cleanName = String(name || '').trim();
        if (!cleanName) return;
        const key = normalizeText(cleanName);
        if (!key) return;
        map.set(key, {
            name: cleanName,
            severity: sanitizeSeverity(severity),
            scoreThreshold: clampThreshold(scoreThreshold, defaultThreshold)
        });
    }

    function sanitizeConfig(rawConfig) {
        const defaults = getDefaultInsightRuleConfig();
        const raw = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
        const defaultScoreThreshold = clampThreshold(
            raw.defaultScoreThreshold !== undefined ? raw.defaultScoreThreshold : raw.scoreThreshold,
            defaults.defaultScoreThreshold
        );

        const presetMap = new Map();

        if (Array.isArray(raw.triggerPresets)) {
            raw.triggerPresets.forEach((item) => {
                if (!item || typeof item !== 'object') return;
                pushPreset(presetMap, item.name, item.severity, item.scoreThreshold, defaultScoreThreshold);
            });
        }

        if (Array.isArray(raw.severityRules)) {
            raw.severityRules.forEach((item) => {
                if (!item || typeof item !== 'object') return;
                pushPreset(presetMap, item.name, item.severity, defaultScoreThreshold, defaultScoreThreshold);
            });
        }

        if (Array.isArray(raw.topicOverrides)) {
            raw.topicOverrides.forEach((item) => {
                if (!item || typeof item !== 'object') return;
                pushPreset(presetMap, item.name, item.severity, defaultScoreThreshold, defaultScoreThreshold);
            });
        }

        if (Array.isArray(raw.criticalAssessments)) {
            raw.criticalAssessments.forEach((name) => pushPreset(presetMap, name, 'critical', defaultScoreThreshold, defaultScoreThreshold));
        }
        if (Array.isArray(raw.semiCriticalAssessments)) {
            raw.semiCriticalAssessments.forEach((name) => pushPreset(presetMap, name, 'semi', defaultScoreThreshold, defaultScoreThreshold));
        }

        const triggerPresets = Array.from(presetMap.values()).sort((a, b) => {
            const severityRank = { critical: 1, semi: 2, improvement: 3 };
            const rankDiff = (severityRank[a.severity] || 9) - (severityRank[b.severity] || 9);
            if (rankDiff !== 0) return rankDiff;
            return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base', numeric: true });
        });

        return {
            defaultScoreThreshold,
            triggerPresets,
            severityRules: triggerPresets.map((item) => ({ name: item.name, severity: item.severity })),
            scoreThreshold: defaultScoreThreshold,
            updatedAt: raw.updatedAt || null,
            updatedBy: raw.updatedBy || null
        };
    }

    function sanitizeProgressConfig(rawConfig) {
        const defaults = getDefaultProgressConfig();
        const raw = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
        const map = new Map();

        const pushItem = (name, type, reportSections) => {
            const cleanName = String(name || '').trim();
            if (!cleanName) return;
            if (AUTO_PROGRESS_ITEMS.some(item => normalizeText(item.name) === normalizeText(cleanName))) return;
            const cleanType = inferProgressType(cleanName, type);
            map.set(normalizeText(cleanName), {
                name: cleanName,
                type: cleanType,
                source: 'manual',
                reportSections: sanitizeReportSections(reportSections, cleanName, cleanType)
            });
        };

        if (Array.isArray(raw.requiredItems)) {
            raw.requiredItems.forEach((item) => {
                if (!item) return;
                if (typeof item === 'string') pushItem(item, null, null);
                else if (typeof item === 'object') pushItem(item.name, item.type, item.reportSections);
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
            updatedAt: raw.updatedAt || defaults.updatedAt,
            updatedBy: raw.updatedBy || defaults.updatedBy
        };
    }

    function sanitizeLiveRulesConfig(rawConfig) {
        const defaults = getDefaultLiveRulesConfig();
        const raw = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
        const rulesHtml = sanitizeLiveRulesHtml(raw.rulesHtml || raw.html || '');
        const sourceRules = Array.isArray(raw.rules)
            ? raw.rules
            : (rulesHtml ? htmlToLiveRuleLines(rulesHtml) : defaults.rules);
        const rules = uniqueStrings(sourceRules.map(rule => String(rule || '').trim())).slice(0, 20);
        return {
            rules: rules.length ? rules : defaults.rules,
            rulesHtml: rulesHtml || rulesToLiveRulesHtml(rules.length ? rules : defaults.rules),
            updatedAt: raw.updatedAt || defaults.updatedAt,
            updatedBy: raw.updatedBy || defaults.updatedBy
        };
    }

    function sanitizeLiveBookingRulesConfig(rawConfig) {
        const defaults = getDefaultLiveBookingRulesConfig();
        const raw = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
        const rulesHtml = sanitizeLiveRulesHtml(raw.rulesHtml || raw.html || '');
        const sourceRules = Array.isArray(raw.rules)
            ? raw.rules
            : (rulesHtml ? htmlToLiveRuleLines(rulesHtml) : defaults.rules);
        const rules = uniqueStrings(sourceRules.map(rule => String(rule || '').trim())).slice(0, 20);
        return {
            rules: rules.length ? rules : defaults.rules,
            rulesHtml: rulesHtml || rulesToLiveRulesHtml(rules.length ? rules : defaults.rules),
            updatedAt: raw.updatedAt || defaults.updatedAt,
            updatedBy: raw.updatedBy || defaults.updatedBy
        };
    }

    function sanitizeTrainingRulesConfig(rawConfig) {
        const defaults = getDefaultTrainingRulesConfig();
        const raw = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
        const rulesHtml = sanitizeLiveRulesHtml(raw.rulesHtml || raw.html || '');
        const sourceRules = Array.isArray(raw.rules)
            ? raw.rules
            : (rulesHtml ? htmlToLiveRuleLines(rulesHtml) : defaults.rules);
        const rules = uniqueStrings(sourceRules.map(rule => String(rule || '').trim())).slice(0, 40);
        const targetMode = ['all', 'users', 'groups'].includes(normalizeText(raw.targetMode)) ? normalizeText(raw.targetMode) : 'all';
        return {
            rules: rules.length ? rules : defaults.rules,
            rulesHtml: rulesHtml || rulesToLiveRulesHtml(rules.length ? rules : defaults.rules),
            showOnFirstLogin: raw.showOnFirstLogin !== false,
            showOnLogin: raw.showOnLogin === true,
            targetMode,
            targetUsers: uniqueStrings(Array.isArray(raw.targetUsers) ? raw.targetUsers : []),
            targetGroups: uniqueStrings(Array.isArray(raw.targetGroups) ? raw.targetGroups : []),
            officeOptions: uniqueStrings(Array.isArray(raw.officeOptions) ? raw.officeOptions : defaults.officeOptions),
            updatedAt: raw.updatedAt || defaults.updatedAt,
            updatedBy: raw.updatedBy || defaults.updatedBy
        };
    }

    function sanitizeLiveRulesHtml(html) {
        const raw = String(html || '').trim();
        if (!raw) return '';
        const template = document.createElement('template');
        template.innerHTML = raw;
        const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'P', 'DIV', 'BR', 'SPAN', 'FONT']);
        const walk = (node) => {
            Array.from(node.childNodes).forEach((child) => {
                if (child.nodeType === Node.TEXT_NODE) return;
                if (child.nodeType !== Node.ELEMENT_NODE || !allowed.has(child.tagName)) {
                    if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') {
                        child.remove();
                        return;
                    }
                    child.replaceWith(...Array.from(child.childNodes));
                    return;
                }
                Array.from(child.attributes).forEach((attr) => {
                    const name = attr.name.toLowerCase();
                    if (child.tagName === 'FONT' && name === 'size') return;
                    if (child.tagName === 'SPAN' && name === 'style' && /^font-size\s*:\s*(0\.\d+|1(\.\d+)?|1\.\d+|2)rem;?$/i.test(attr.value.trim())) return;
                    child.removeAttribute(attr.name);
                });
                walk(child);
            });
        };
        walk(template.content);
        return template.innerHTML.trim();
    }

    function htmlToLiveRuleLines(html) {
        const template = document.createElement('template');
        template.innerHTML = sanitizeLiveRulesHtml(html);
        const listItems = Array.from(template.content.querySelectorAll('li'))
            .map(li => String(li.textContent || '').trim())
            .filter(Boolean);
        if (listItems.length) return listItems;
        return String(template.content.textContent || '')
            .split(/\n+/)
            .map(line => line.trim())
            .filter(Boolean);
    }

    function rulesToLiveRulesHtml(rules) {
        const lines = uniqueStrings(rules || DEFAULT_LIVE_ASSESSMENT_RULES);
        return `<ul>${lines.map(rule => `<li>${escapeHtml(rule)}</li>`).join('')}</ul>`;
    }

    function withAutoProgressItems(requiredItems) {
        const map = new Map();
        AUTO_PROGRESS_ITEMS.forEach((item) => {
            map.set(normalizeText(item.name), {
                name: item.name,
                type: item.type,
                source: 'auto'
            });
        });
        (requiredItems || []).forEach((item) => {
            if (!item || typeof item !== 'object') return;
            const cleanName = String(item.name || '').trim();
            if (!cleanName) return;
            map.set(normalizeText(cleanName), {
                name: cleanName,
                type: inferProgressType(cleanName, item.type),
                source: 'manual',
                reportSections: sanitizeReportSections(item.reportSections, cleanName, item.type)
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
    }

    function getInsightRuleConfig() {
        try {
            const parsed = JSON.parse(localStorage.getItem(INSIGHT_RULE_KEY) || 'null');
            return sanitizeConfig(parsed);
        } catch (error) {
            return sanitizeConfig(null);
        }
    }

    function getInsightProgressConfig() {
        try {
            const parsed = JSON.parse(localStorage.getItem(INSIGHT_PROGRESS_KEY) || 'null');
            return sanitizeProgressConfig(parsed);
        } catch (error) {
            return sanitizeProgressConfig(null);
        }
    }

    function getLiveAssessmentRulesConfig() {
        try {
            return sanitizeLiveRulesConfig(JSON.parse(localStorage.getItem(LIVE_RULES_KEY) || 'null'));
        } catch (error) {
            return getDefaultLiveRulesConfig();
        }
    }

    function getLiveBookingRulesConfig() {
        try {
            return sanitizeLiveBookingRulesConfig(JSON.parse(localStorage.getItem(LIVE_BOOKING_RULES_KEY) || 'null'));
        } catch (error) {
            return getDefaultLiveBookingRulesConfig();
        }
    }

    function getTrainingRulesConfig() {
        try {
            return sanitizeTrainingRulesConfig(JSON.parse(localStorage.getItem(TRAINING_RULES_KEY) || 'null'));
        } catch (error) {
            return getDefaultTrainingRulesConfig();
        }
    }

    function getLiveAssessmentRules() {
        return getLiveAssessmentRulesConfig().rules;
    }

    function getLiveAssessmentRulesHtml() {
        return getLiveAssessmentRulesConfig().rulesHtml;
    }

    function getLiveBookingRulesHtml() {
        return getLiveBookingRulesConfig().rulesHtml;
    }

    function getTrainingRulesHtml() {
        return getTrainingRulesConfig().rulesHtml;
    }

    function getTrainingOfficeOptions() {
        return getTrainingRulesConfig().officeOptions || [];
    }

    function getInsightProgressRequiredItems() {
        const config = getInsightProgressConfig();
        return withAutoProgressItems(config.requiredItems || []);
    }

    function getInsightScoreThreshold() {
        return getInsightRuleConfig().defaultScoreThreshold;
    }

    function findPresetByName(name, configInput) {
        const config = sanitizeConfig(configInput || getInsightRuleConfig());
        const normalizedName = normalizeText(name);
        if (!normalizedName) return null;
        return (config.triggerPresets || []).find(item => normalizeText(item.name) === normalizedName) || null;
    }

    function classifyInsightAssessment(name, configInput) {
        const preset = findPresetByName(name, configInput);
        if (preset) return preset.severity;
        return 'improvement';
    }

    function getInsightThresholdForAssessment(name, configInput) {
        const config = sanitizeConfig(configInput || getInsightRuleConfig());
        const preset = findPresetByName(name, config);
        if (preset && Number.isFinite(Number(preset.scoreThreshold))) {
            return Number(preset.scoreThreshold);
        }
        return config.defaultScoreThreshold;
    }

    function getInsightTriggerPresets() {
        const config = getInsightRuleConfig();
        return Array.isArray(config.triggerPresets) ? config.triggerPresets.slice() : [];
    }

    function getDraftConfig() {
        if (!draftState.loaded || !draftState.config) {
            draftState.config = sanitizeConfig(getInsightRuleConfig());
            draftState.loaded = true;
        }
        return draftState.config;
    }

    function setDraftConfig(config) {
        draftState.config = sanitizeConfig(config);
        draftState.loaded = true;
    }

    function getDraftProgressConfig() {
        if (!draftState.progressLoaded || !draftState.progressConfig) {
            draftState.progressConfig = sanitizeProgressConfig(getInsightProgressConfig());
            draftState.progressLoaded = true;
        }
        return draftState.progressConfig;
    }

    function setDraftProgressConfig(config) {
        draftState.progressConfig = sanitizeProgressConfig(config);
        draftState.progressLoaded = true;
    }

    function getDraftLiveRulesConfig() {
        if (!draftState.liveRulesLoaded || !draftState.liveRulesConfig) {
            draftState.liveRulesConfig = sanitizeLiveRulesConfig(getLiveAssessmentRulesConfig());
            draftState.liveRulesLoaded = true;
        }
        return draftState.liveRulesConfig;
    }

    function setDraftLiveRulesConfig(config) {
        draftState.liveRulesConfig = sanitizeLiveRulesConfig(config);
        draftState.liveRulesLoaded = true;
    }

    function getDraftLiveBookingRulesConfig() {
        if (!draftState.liveBookingRulesLoaded || !draftState.liveBookingRulesConfig) {
            draftState.liveBookingRulesConfig = sanitizeLiveBookingRulesConfig(getLiveBookingRulesConfig());
            draftState.liveBookingRulesLoaded = true;
        }
        return draftState.liveBookingRulesConfig;
    }

    function setDraftLiveBookingRulesConfig(config) {
        draftState.liveBookingRulesConfig = sanitizeLiveBookingRulesConfig(config);
        draftState.liveBookingRulesLoaded = true;
    }

    function getDraftTrainingRulesConfig() {
        if (!draftState.trainingRulesLoaded || !draftState.trainingRulesConfig) {
            draftState.trainingRulesConfig = sanitizeTrainingRulesConfig(getTrainingRulesConfig());
            draftState.trainingRulesLoaded = true;
        }
        return draftState.trainingRulesConfig;
    }

    function setDraftTrainingRulesConfig(config) {
        draftState.trainingRulesConfig = sanitizeTrainingRulesConfig(config);
        draftState.trainingRulesLoaded = true;
    }

    function escapeHtml(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getTrainingConfigUsers() {
        const users = parseArrayFromLocalStorage('users')
            .filter(u => u && String(u.role || '').toLowerCase() === 'trainee')
            .map(u => String(u.user || u.username || '').trim())
            .filter(Boolean);
        return uniqueStrings(users).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }

    function getTrainingConfigGroups() {
        try {
            return Object.keys(JSON.parse(localStorage.getItem('rosters') || '{}') || {})
                .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
        } catch (error) {
            return [];
        }
    }

    function getGroupsForTrainee(username) {
        const target = normalizeText(username);
        if (!target) return [];
        try {
            const rosters = JSON.parse(localStorage.getItem('rosters') || '{}') || {};
            return Object.entries(rosters)
                .filter(([, members]) => Array.isArray(members) && members.some(member => normalizeText(member) === target))
                .map(([gid]) => String(gid));
        } catch (error) {
            return [];
        }
    }

    function isTrainingRulesTargetedToCurrentUser(configInput) {
        const config = sanitizeTrainingRulesConfig(configInput || getTrainingRulesConfig());
        if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER || String(CURRENT_USER.role || '').toLowerCase() !== 'trainee') return false;
        if (config.targetMode === 'all') return true;
        const username = String(CURRENT_USER.user || '').trim();
        if (config.targetMode === 'users') {
            return (config.targetUsers || []).some(user => normalizeText(user) === normalizeText(username));
        }
        if (config.targetMode === 'groups') {
            const myGroups = getGroupsForTrainee(username).map(group => normalizeText(group));
            return (config.targetGroups || []).some(group => myGroups.includes(normalizeText(group)));
        }
        return true;
    }

    function shouldShowTrainingRulesOnLogin(isFirstLogin) {
        const config = getTrainingRulesConfig();
        if (!isTrainingRulesTargetedToCurrentUser(config)) return false;
        if (isFirstLogin && config.showOnFirstLogin !== false) return true;
        return config.showOnLogin === true;
    }

    function openTrainingRulesModal(options = {}) {
        const config = getTrainingRulesConfig();
        const modalId = 'trainingRulesModal';
        document.getElementById(modalId)?.remove();
        const title = options && options.title ? String(options.title) : 'Training Rules';
        const html = `
            <div id="${modalId}" class="modal-overlay" style="z-index:12050;">
                <div class="modal-box" style="width:min(760px, 96vw); max-height:88vh; overflow-y:auto;">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; border-bottom:1px solid var(--border-color); padding-bottom:10px; margin-bottom:14px;">
                        <h3 style="margin:0;"><i class="fas fa-scale-balanced"></i> ${escapeHtml(title)}</h3>
                        ${options && options.blocking ? '' : `<button class="btn-secondary btn-sm" onclick="document.getElementById('${modalId}')?.remove()">&times;</button>`}
                    </div>
                    <div class="rich-content" style="background:var(--bg-input); border:1px solid var(--border-color); border-radius:8px; padding:14px; line-height:1.55;">
                        ${config.rulesHtml || rulesToLiveRulesHtml(config.rules)}
                    </div>
                    <div style="display:flex; justify-content:flex-end; margin-top:14px;">
                        <button class="btn-primary" onclick="document.getElementById('${modalId}')?.remove()">${options && options.blocking ? 'I Understand' : 'Close'}</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
    }

    function maybeShowTrainingRulesOnLogin(isFirstLogin) {
        if (shouldShowTrainingRulesOnLogin(isFirstLogin)) {
            const config = getTrainingRulesConfig();
            const sessionKey = `training_rules_seen_${config.updatedAt || 'default'}`;
            if (sessionStorage.getItem(sessionKey) === 'true') return;
            sessionStorage.setItem(sessionKey, 'true');
            setTimeout(() => openTrainingRulesModal({ title: 'Training Rules', blocking: true }), isFirstLogin ? 450 : 800);
        }
    }

    function renderAssessmentSelector() {
        const select = document.getElementById('insightPresetAssessmentSelect');
        const progressSelect = document.getElementById('insightProgressItemSelect');
        const catalog = getAssessmentCatalog();
        const optionsHtml = catalog.length
            ? catalog.map(item => {
                const label = item.name;
                return `<option value="${escapeHtml(item.name)}" data-type="${escapeHtml(item.type || inferProgressType(item.name, null))}">${escapeHtml(label)}</option>`;
            }).join('')
            : '<option value="">No Test Engine items found</option>';

        if (select) select.innerHTML = optionsHtml;
        if (progressSelect) progressSelect.innerHTML = optionsHtml;
    }

    function renderTrainingRulesControls(config) {
        const targetMode = document.getElementById('trainingRulesTargetMode');
        const targetUsers = document.getElementById('trainingRulesTargetUsers');
        const targetGroups = document.getElementById('trainingRulesTargetGroups');
        const offices = document.getElementById('trainingOfficeOptions');
        const firstLogin = document.getElementById('trainingRulesFirstLogin');
        const everyLogin = document.getElementById('trainingRulesEveryLogin');

        if (targetMode) targetMode.value = config.targetMode || 'all';
        if (firstLogin) firstLogin.checked = config.showOnFirstLogin !== false;
        if (everyLogin) everyLogin.checked = config.showOnLogin === true;

        if (targetUsers) {
            const selected = new Set((config.targetUsers || []).map(normalizeText));
            targetUsers.innerHTML = getTrainingConfigUsers()
                .map(user => `<option value="${escapeHtml(user)}" ${selected.has(normalizeText(user)) ? 'selected' : ''}>${escapeHtml(user)}</option>`)
                .join('') || '<option value="">No trainees found</option>';
        }

        if (targetGroups) {
            const selected = new Set((config.targetGroups || []).map(normalizeText));
            targetGroups.innerHTML = getTrainingConfigGroups()
                .map(group => {
                    let label = group;
                    try {
                        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}') || {};
                        label = (typeof getGroupLabel === 'function') ? getGroupLabel(group, Array.isArray(rosters[group]) ? rosters[group].length : 0) : group;
                    } catch (error) {}
                    return `<option value="${escapeHtml(group)}" ${selected.has(normalizeText(group)) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
                })
                .join('') || '<option value="">No groups found</option>';
        }

        if (offices && document.activeElement !== offices) {
            offices.value = (config.officeOptions || []).join('\n');
        }

        const userBlock = document.getElementById('trainingRulesUserTargetBlock');
        const groupBlock = document.getElementById('trainingRulesGroupTargetBlock');
        if (userBlock) userBlock.style.display = (config.targetMode === 'users') ? 'block' : 'none';
        if (groupBlock) groupBlock.style.display = (config.targetMode === 'groups') ? 'block' : 'none';
    }

    function upsertPreset(name, severity, scoreThreshold) {
        const config = getDraftConfig();
        const cleanName = String(name || '').trim();
        if (!cleanName) return false;

        const nextPreset = {
            name: cleanName,
            severity: sanitizeSeverity(severity),
            scoreThreshold: clampThreshold(scoreThreshold, config.defaultScoreThreshold)
        };

        const presets = Array.isArray(config.triggerPresets) ? config.triggerPresets.slice() : [];
        const idx = presets.findIndex(item => normalizeText(item.name) === normalizeText(cleanName));
        if (idx > -1) presets[idx] = nextPreset;
        else presets.push(nextPreset);

        config.triggerPresets = presets;
        setDraftConfig(config);
        return true;
    }

    function removePreset(name) {
        const config = getDraftConfig();
        const normalizedName = normalizeText(name);
        config.triggerPresets = (config.triggerPresets || []).filter(item => normalizeText(item.name) !== normalizedName);
        setDraftConfig(config);
    }

    function upsertProgressItem(name) {
        const config = getDraftProgressConfig();
        const cleanName = String(name || '').trim();
        if (!cleanName) return false;
        if (AUTO_PROGRESS_ITEMS.some(item => normalizeText(item.name) === normalizeText(cleanName))) return false;
        const select = document.getElementById('insightProgressItemSelect');
        const selectedType = select && select.selectedOptions && select.selectedOptions[0]
            ? select.selectedOptions[0].dataset.type
            : null;
        const type = inferProgressType(cleanName, selectedType);

        const next = {
            name: cleanName,
            type,
            source: 'manual',
            reportSections: sanitizeReportSections(null, cleanName, type)
        };

        const required = Array.isArray(config.requiredItems) ? config.requiredItems.slice() : [];
        const idx = required.findIndex(item => normalizeText(item.name) === normalizeText(cleanName));
        if (idx > -1) required[idx] = next;
        else required.push(next);

        config.requiredItems = required;
        setDraftProgressConfig(config);
        return true;
    }

    function removeProgressItem(name) {
        const config = getDraftProgressConfig();
        const normalizedName = normalizeText(name);
        config.requiredItems = (config.requiredItems || []).filter(item => normalizeText(item.name) !== normalizedName);
        setDraftProgressConfig(config);
    }

    function updateProgressItem(encodedName, patch) {
        const name = decodeURIComponent(String(encodedName || ''));
        const cleanName = String(name || '').trim();
        if (!cleanName) return;
        const config = getDraftProgressConfig();
        const required = Array.isArray(config.requiredItems) ? config.requiredItems.slice() : [];
        const idx = required.findIndex(item => normalizeText(item.name) === normalizeText(cleanName));
        if (idx < 0) return;
        const current = required[idx] || {};
        const nextType = patch && patch.type ? inferProgressType(cleanName, patch.type) : inferProgressType(cleanName, current.type);
        const nextSections = {
            ...sanitizeReportSections(current.reportSections, cleanName, nextType),
            ...((patch && patch.reportSections) || {})
        };
        required[idx] = {
            ...current,
            name: cleanName,
            type: nextType,
            source: 'manual',
            reportSections: sanitizeReportSections(nextSections, cleanName, nextType)
        };
        config.requiredItems = required;
        setDraftProgressConfig(config);
    }

    function persistProgressDraftLocally() {
        const progressConfig = getDraftProgressConfig();
        const stamp = new Date().toISOString();
        const actor = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.user) ? CURRENT_USER.user : 'system';
        const cleanProgress = sanitizeProgressConfig({
            ...progressConfig,
            updatedAt: progressConfig.updatedAt || stamp,
            updatedBy: progressConfig.updatedBy || actor
        });
        localStorage.setItem(INSIGHT_PROGRESS_KEY, JSON.stringify(cleanProgress));
        setDraftProgressConfig(cleanProgress);
        return cleanProgress;
    }

    async function saveInsightProgressConfig() {
        const stamp = new Date().toISOString();
        const actor = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.user) ? CURRENT_USER.user : 'system';
        const progressConfig = sanitizeProgressConfig({
            ...getDraftProgressConfig(),
            updatedAt: stamp,
            updatedBy: actor
        });

        localStorage.setItem(INSIGHT_PROGRESS_KEY, JSON.stringify(progressConfig));
        setDraftProgressConfig(progressConfig);

        let synced = true;
        try {
            if (typeof saveToServer === 'function') {
                synced = await saveToServer([INSIGHT_PROGRESS_KEY], true);
            }
        } catch (error) {
            synced = false;
            console.warn('[Insight Rules] Progress builder cloud sync failed:', error);
        }

        refreshInsightRulesView();

        if (synced === false) {
            if (typeof showToast === 'function') showToast('Progress list saved locally, but cloud sync failed.', 'warning');
            return false;
        }

        if (typeof showToast === 'function') {
            showToast('Agent Progress list saved for all trainees.', 'success');
        }

        const activeSection = document.querySelector('section.active');
        if (activeSection && activeSection.id === 'insight-studio' && typeof InsightStudioLoader !== 'undefined' && typeof InsightStudioLoader.refresh === 'function') {
            InsightStudioLoader.refresh();
        }
        return true;
    }

    function renderMappingTable(config) {
        const body = document.getElementById('insightRulesTableBody');
        if (!body) return;

        const rows = Array.isArray(config.triggerPresets) ? config.triggerPresets.slice() : [];
        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No configured trigger mappings yet. Add one above.</td></tr>';
            return;
        }

        body.innerHTML = rows.map((rule, index) => {
            return `
                <tr>
                    <td>${index + 1}</td>
                    <td>${escapeHtml(rule.name)}</td>
                    <td>
                        <select style="margin:0; width:100%;" onchange="changeInsightRuleSeverity('${encodeURIComponent(rule.name)}', this.value)">
                            <option value="critical" ${rule.severity === 'critical' ? 'selected' : ''}>Critical</option>
                            <option value="semi" ${rule.severity === 'semi' ? 'selected' : ''}>Semi-Critical</option>
                            <option value="improvement" ${rule.severity === 'improvement' ? 'selected' : ''}>Improvement</option>
                        </select>
                    </td>
                    <td>
                        <input type="number" min="1" max="100" step="1" value="${rule.scoreThreshold}" style="margin:0; width:100%;" onchange="changeInsightRuleThreshold('${encodeURIComponent(rule.name)}', this.value)">
                    </td>
                    <td>
                        <button class="btn-danger btn-sm" onclick="removeInsightRuleByName('${encodeURIComponent(rule.name)}')">Remove</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function renderProgressTable(config) {
        const body = document.getElementById('insightProgressTableBody');
        if (!body) return;

        const rows = withAutoProgressItems(Array.isArray(config.requiredItems) ? config.requiredItems : []);
        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--text-muted);">No progress items configured.</td></tr>';
            return;
        }

        const activeCatalogNames = getAssessmentCatalogNameSet();
        body.innerHTML = rows.map((item, index) => {
            const sections = sanitizeReportSections(item.reportSections, item.name, item.type);
            const encodedName = encodeURIComponent(item.name);
            const locked = item.source === 'auto';
            const missingFromTestEngine = !locked && !activeCatalogNames.has(normalizeText(item.name));
            const typeHtml = locked
                ? `<span style="color:var(--text-muted); font-size:0.78rem;">${escapeHtml(String(item.type || '').replace('_', ' '))}</span>`
                : `<select style="margin:0; width:100%;" onchange="changeInsightProgressType('${encodedName}', this.value)">
                    <option value="assessment" ${item.type === 'assessment' ? 'selected' : ''}>Assessment</option>
                    <option value="vetting" ${item.type === 'vetting' ? 'selected' : ''}>Vetting Test</option>
                    <option value="live" ${item.type === 'live' ? 'selected' : ''}>Live Assessment</option>
                    <option value="test" ${item.type === 'test' ? 'selected' : ''}>Test</option>
                </select>`;
            const nameHtml = missingFromTestEngine
                ? `${escapeHtml(item.name)}<div style="margin-top:4px; color:#f1c40f; font-size:0.76rem;">Legacy item - not found in active Test Engine list</div>`
                : escapeHtml(item.name);
            const check = (key, label) => locked
                ? '<span style="color:var(--text-muted); font-size:0.78rem;">-</span>'
                : `<input type="checkbox" ${sections[key] ? 'checked' : ''} aria-label="${escapeHtml(label)} for ${escapeHtml(item.name)}" onchange="toggleInsightProgressReportSection('${encodedName}', '${key}', this.checked)">`;
            const actionHtml = item.source === 'auto'
                ? '<span style="color:var(--text-muted); font-size:0.78rem;">Locked</span>'
                : `<button class="btn-danger btn-sm" onclick="removeInsightProgressItem('${encodedName}')">Remove</button>`;
            return `
                <tr>
                    <td>${index + 1}</td>
                    <td>${nameHtml}</td>
                    <td>${typeHtml}</td>
                    <td style="text-align:center;">${check('trainingGoal', 'Training Goal Feedback')}</td>
                    <td style="text-align:center;">${check('assessmentScores', 'Assessment Scores')}</td>
                    <td style="text-align:center;">${check('vettingTest1', 'Vetting Test 1')}</td>
                    <td style="text-align:center;">${check('vettingFinal', 'Final Vetting')}</td>
                    <td>${actionHtml}</td>
                </tr>
            `;
        }).join('');
    }

    function refreshInsightRulesView() {
        const config = getDraftConfig();
        const progressConfig = getDraftProgressConfig();
        const liveRulesConfig = getDraftLiveRulesConfig();
        const liveBookingRulesConfig = getDraftLiveBookingRulesConfig();
        const trainingRulesConfig = getDraftTrainingRulesConfig();
        renderAssessmentSelector();

        const severitySelect = document.getElementById('insightPresetSeveritySelect');
        if (severitySelect && !severitySelect.value) severitySelect.value = 'critical';

        const thresholdInput = document.getElementById('insightPresetThresholdInput');
        if (thresholdInput && !String(thresholdInput.value || '').trim()) {
            thresholdInput.value = String(config.defaultScoreThreshold);
        }

        renderMappingTable(config);
        renderProgressTable(progressConfig);

        const rulesInput = document.getElementById('liveAssessmentRulesInput');
        if (rulesInput && document.activeElement !== rulesInput && !rulesInput.dataset.dirty) {
            rulesInput.innerHTML = liveRulesConfig.rulesHtml || rulesToLiveRulesHtml(liveRulesConfig.rules);
        }

        const bookingRulesInput = document.getElementById('liveBookingRulesInput');
        if (bookingRulesInput && document.activeElement !== bookingRulesInput && !bookingRulesInput.dataset.dirty) {
            bookingRulesInput.innerHTML = liveBookingRulesConfig.rulesHtml || rulesToLiveRulesHtml(liveBookingRulesConfig.rules);
        }

        renderTrainingRulesControls(trainingRulesConfig);
        const trainingInput = document.getElementById('trainingRulesInput');
        if (trainingInput && document.activeElement !== trainingInput && !trainingInput.dataset.dirty) {
            trainingInput.innerHTML = trainingRulesConfig.rulesHtml || rulesToLiveRulesHtml(trainingRulesConfig.rules);
        }
    }

    function addInsightTriggerPreset() {
        const assessmentSelect = document.getElementById('insightPresetAssessmentSelect');
        const severitySelect = document.getElementById('insightPresetSeveritySelect');
        const thresholdInput = document.getElementById('insightPresetThresholdInput');

        const name = String(assessmentSelect ? assessmentSelect.value : '').trim();
        const severity = severitySelect ? severitySelect.value : 'improvement';
        const threshold = thresholdInput ? thresholdInput.value : getDraftConfig().defaultScoreThreshold;

        if (!name) {
            if (typeof showToast === 'function') showToast('Select an assessment/test first.', 'warning');
            return;
        }

        upsertPreset(name, severity, threshold);
        refreshInsightRulesView();

        if (typeof showToast === 'function') {
            showToast('Trigger preset added to draft list.', 'success');
        }
    }

    function addInsightProgressItem() {
        const select = document.getElementById('insightProgressItemSelect');
        const name = String(select ? select.value : '').trim();
        if (!name) {
            if (typeof showToast === 'function') showToast('Select an assessment/test for Agent Progress.', 'warning');
            return;
        }

        const ok = upsertProgressItem(name);
        if (ok) persistProgressDraftLocally();
        refreshInsightRulesView();
        if (ok && typeof showToast === 'function') {
            showToast('Progress item added. Click Save Progress List to sync it for everyone.', 'success');
        }
    }

    function changeInsightRuleSeverity(encodedName, severity) {
        const name = decodeURIComponent(String(encodedName || ''));
        if (!name) return;
        const config = getDraftConfig();
        const existing = findPresetByName(name, config);
        upsertPreset(name, severity, existing ? existing.scoreThreshold : config.defaultScoreThreshold);
        refreshInsightRulesView();
    }

    function changeInsightRuleThreshold(encodedName, threshold) {
        const name = decodeURIComponent(String(encodedName || ''));
        if (!name) return;
        const config = getDraftConfig();
        const existing = findPresetByName(name, config);
        upsertPreset(name, existing ? existing.severity : 'improvement', threshold);
        refreshInsightRulesView();
    }

    function removeInsightRuleByName(encodedName) {
        const name = decodeURIComponent(String(encodedName || ''));
        if (!name) return;
        removePreset(name);
        refreshInsightRulesView();
    }

    function removeInsightProgressItem(encodedName) {
        const name = decodeURIComponent(String(encodedName || ''));
        if (!name) return;
        removeProgressItem(name);
        persistProgressDraftLocally();
        refreshInsightRulesView();
    }

    function changeInsightProgressType(encodedName, type) {
        updateProgressItem(encodedName, { type });
        persistProgressDraftLocally();
        refreshInsightRulesView();
    }

    function toggleInsightProgressReportSection(encodedName, sectionKey, enabled) {
        if (!['trainingGoal', 'assessmentScores', 'vettingTest1', 'vettingFinal'].includes(sectionKey)) return;
        updateProgressItem(encodedName, { reportSections: { [sectionKey]: enabled === true } });
        persistProgressDraftLocally();
        refreshInsightRulesView();
    }

    async function saveInsightRuleConfig() {
        const config = getDraftConfig();
        const progressConfig = getDraftProgressConfig();
        const thresholdInput = document.getElementById('insightPresetThresholdInput');
        if (thresholdInput) {
            config.defaultScoreThreshold = clampThreshold(thresholdInput.value, config.defaultScoreThreshold);
        }

        const stamp = new Date().toISOString();
        const actor = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.user) ? CURRENT_USER.user : 'system';
        config.updatedAt = stamp;
        config.updatedBy = actor;
        progressConfig.updatedAt = stamp;
        progressConfig.updatedBy = actor;

        const clean = sanitizeConfig(config);
        const cleanProgress = sanitizeProgressConfig(progressConfig);
        localStorage.setItem(INSIGHT_RULE_KEY, JSON.stringify(clean));
        localStorage.setItem(INSIGHT_PROGRESS_KEY, JSON.stringify(cleanProgress));
        setDraftConfig(clean);
        setDraftProgressConfig(cleanProgress);

        try {
            if (typeof saveToServer === 'function') {
                await saveToServer([INSIGHT_RULE_KEY, INSIGHT_PROGRESS_KEY], true);
            }
        } catch (error) {
            console.warn('[Insight Rules] Cloud sync failed:', error);
        }

        if (typeof showToast === 'function') {
            showToast('Insight trigger presets and progress builder saved.', 'success');
        }

        const activeSection = document.querySelector('section.active');
        if (activeSection && activeSection.id === 'insight-studio' && typeof InsightStudioLoader !== 'undefined' && typeof InsightStudioLoader.refresh === 'function') {
            InsightStudioLoader.refresh({ force: true });
        }
    }

    async function saveLiveAssessmentRulesConfig() {
        const input = document.getElementById('liveAssessmentRulesInput');
        const rulesHtml = sanitizeLiveRulesHtml(input ? input.innerHTML : '');
        const lines = htmlToLiveRuleLines(rulesHtml);

        const stamp = new Date().toISOString();
        const actor = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.user) ? CURRENT_USER.user : 'system';
        const clean = sanitizeLiveRulesConfig({ rules: lines, rulesHtml, updatedAt: stamp, updatedBy: actor });

        localStorage.setItem(LIVE_RULES_KEY, JSON.stringify(clean));
        setDraftLiveRulesConfig(clean);
        if (input) {
            input.innerHTML = clean.rulesHtml;
            delete input.dataset.dirty;
        }

        try {
            if (typeof saveToServer === 'function') {
                await saveToServer([LIVE_RULES_KEY], true);
            }
        } catch (error) {
            console.warn('[Live Rules] Cloud sync failed:', error);
        }

        refreshInsightRulesView();
        if (typeof showToast === 'function') showToast('Live assessment rules saved.', 'success');
    }

    async function saveLiveBookingRulesConfig() {
        const input = document.getElementById('liveBookingRulesInput');
        const rulesHtml = sanitizeLiveRulesHtml(input ? input.innerHTML : '');
        const lines = htmlToLiveRuleLines(rulesHtml);

        const stamp = new Date().toISOString();
        const actor = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.user) ? CURRENT_USER.user : 'system';
        const clean = sanitizeLiveBookingRulesConfig({ rules: lines, rulesHtml, updatedAt: stamp, updatedBy: actor });

        localStorage.setItem(LIVE_BOOKING_RULES_KEY, JSON.stringify(clean));
        setDraftLiveBookingRulesConfig(clean);
        if (input) {
            input.innerHTML = clean.rulesHtml;
            delete input.dataset.dirty;
        }

        try {
            if (typeof saveToServer === 'function') {
                await saveToServer([LIVE_BOOKING_RULES_KEY], true);
            }
        } catch (error) {
            console.warn('[Live Booking Rules] Cloud sync failed:', error);
        }

        if (typeof renderLiveBookingRulesPanel === 'function') renderLiveBookingRulesPanel();
        refreshInsightRulesView();
        if (typeof showToast === 'function') showToast('Live booking rules saved.', 'success');
    }

    async function saveTrainingRulesConfig() {
        const input = document.getElementById('trainingRulesInput');
        const rulesHtml = sanitizeLiveRulesHtml(input ? input.innerHTML : '');
        const lines = htmlToLiveRuleLines(rulesHtml);
        const targetMode = String(document.getElementById('trainingRulesTargetMode')?.value || 'all').trim().toLowerCase();
        const targetUsers = Array.from(document.getElementById('trainingRulesTargetUsers')?.selectedOptions || []).map(opt => opt.value);
        const targetGroups = Array.from(document.getElementById('trainingRulesTargetGroups')?.selectedOptions || []).map(opt => opt.value);
        const officeOptions = String(document.getElementById('trainingOfficeOptions')?.value || '')
            .split(/\r?\n|,/)
            .map(item => item.trim())
            .filter(Boolean);

        const stamp = new Date().toISOString();
        const actor = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.user) ? CURRENT_USER.user : 'system';
        const clean = sanitizeTrainingRulesConfig({
            rules: lines,
            rulesHtml,
            showOnFirstLogin: document.getElementById('trainingRulesFirstLogin')?.checked !== false,
            showOnLogin: document.getElementById('trainingRulesEveryLogin')?.checked === true,
            targetMode,
            targetUsers,
            targetGroups,
            officeOptions,
            updatedAt: stamp,
            updatedBy: actor
        });

        localStorage.setItem(TRAINING_RULES_KEY, JSON.stringify(clean));
        setDraftTrainingRulesConfig(clean);
        if (input) {
            input.innerHTML = clean.rulesHtml;
            delete input.dataset.dirty;
        }

        try {
            if (typeof saveToServer === 'function') {
                await saveToServer([TRAINING_RULES_KEY], true);
            }
        } catch (error) {
            console.warn('[Training Rules] Cloud sync failed:', error);
        }

        refreshInsightRulesView();
        if (typeof showToast === 'function') showToast('Training rules and office list saved.', 'success');
    }

    function resetLiveAssessmentRulesDraft() {
        setDraftLiveRulesConfig(getDefaultLiveRulesConfig());
        const input = document.getElementById('liveAssessmentRulesInput');
        if (input) delete input.dataset.dirty;
        refreshInsightRulesView();
    }

    function resetLiveBookingRulesDraft() {
        setDraftLiveBookingRulesConfig(getDefaultLiveBookingRulesConfig());
        const input = document.getElementById('liveBookingRulesInput');
        if (input) delete input.dataset.dirty;
        refreshInsightRulesView();
    }

    function markLiveAssessmentRulesDirty() {
        const input = document.getElementById('liveAssessmentRulesInput');
        if (input) input.dataset.dirty = '1';
    }

    function markLiveBookingRulesDirty() {
        const input = document.getElementById('liveBookingRulesInput');
        if (input) input.dataset.dirty = '1';
    }

    function formatLiveRulesDoc(cmd, value = null) {
        const input = document.getElementById('liveAssessmentRulesInput');
        if (!input) return;
        input.focus();
        document.execCommand(cmd, false, value);
        markLiveAssessmentRulesDirty();
    }

    function formatLiveBookingRulesDoc(cmd, value = null) {
        const input = document.getElementById('liveBookingRulesInput');
        if (!input) return;
        input.focus();
        document.execCommand(cmd, false, value);
        markLiveBookingRulesDirty();
    }

    function resetTrainingRulesDraft() {
        setDraftTrainingRulesConfig(getDefaultTrainingRulesConfig());
        const input = document.getElementById('trainingRulesInput');
        if (input) delete input.dataset.dirty;
        refreshInsightRulesView();
    }

    function markTrainingRulesDirty() {
        const input = document.getElementById('trainingRulesInput');
        if (input) input.dataset.dirty = '1';
    }

    function formatTrainingRulesDoc(cmd, value = null) {
        const input = document.getElementById('trainingRulesInput');
        if (!input) return;
        input.focus();
        document.execCommand(cmd, false, value);
        markTrainingRulesDirty();
    }

    function updateTrainingRulesTargetMode() {
        const config = getDraftTrainingRulesConfig();
        config.targetMode = String(document.getElementById('trainingRulesTargetMode')?.value || 'all').trim().toLowerCase();
        setDraftTrainingRulesConfig(config);
        renderTrainingRulesControls(getDraftTrainingRulesConfig());
    }

    async function resetInsightRuleConfig() {
        if (!confirm('Reset Insight trigger presets and Agent Progress builder to defaults?')) return;

        const stamp = new Date().toISOString();
        const actor = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.user) ? CURRENT_USER.user : 'system';
        const defaults = sanitizeConfig({
            ...getDefaultInsightRuleConfig(),
            updatedAt: stamp,
            updatedBy: actor
        });
        const progressDefaults = sanitizeProgressConfig({
            ...getDefaultProgressConfig(),
            updatedAt: stamp,
            updatedBy: actor
        });

        localStorage.setItem(INSIGHT_RULE_KEY, JSON.stringify(defaults));
        localStorage.setItem(INSIGHT_PROGRESS_KEY, JSON.stringify(progressDefaults));
        setDraftConfig(defaults);
        setDraftProgressConfig(progressDefaults);

        try {
            if (typeof saveToServer === 'function') {
                await saveToServer([INSIGHT_RULE_KEY, INSIGHT_PROGRESS_KEY], true);
            }
        } catch (error) {
            console.warn('[Insight Rules] Reset sync warning:', error);
        }

        refreshInsightRulesView();

        if (typeof showToast === 'function') {
            showToast('Insight presets reset to defaults.', 'info');
        }
    }

    window.getInsightRuleConfig = getInsightRuleConfig;
    window.getInsightScoreThreshold = getInsightScoreThreshold;
    window.classifyInsightAssessment = classifyInsightAssessment;
    window.getInsightThresholdForAssessment = getInsightThresholdForAssessment;
    window.getInsightTriggerPresets = getInsightTriggerPresets;
    window.getInsightProgressConfig = getInsightProgressConfig;
    window.getLiveAssessmentRules = getLiveAssessmentRules;
    window.getLiveAssessmentRulesHtml = getLiveAssessmentRulesHtml;
    window.getLiveAssessmentRulesConfig = getLiveAssessmentRulesConfig;
    window.getLiveBookingRulesConfig = getLiveBookingRulesConfig;
    window.getLiveBookingRulesHtml = getLiveBookingRulesHtml;
    window.getTrainingRulesConfig = getTrainingRulesConfig;
    window.getTrainingRulesHtml = getTrainingRulesHtml;
    window.getTrainingOfficeOptions = getTrainingOfficeOptions;
    window.openTrainingRulesModal = openTrainingRulesModal;
    window.maybeShowTrainingRulesOnLogin = maybeShowTrainingRulesOnLogin;
    window.shouldShowTrainingRulesOnLogin = shouldShowTrainingRulesOnLogin;
    window.getInsightProgressRequiredItems = getInsightProgressRequiredItems;
    window.loadAdminInsightRules = function() {
        setDraftConfig(getInsightRuleConfig());
        setDraftProgressConfig(getInsightProgressConfig());
        setDraftLiveRulesConfig(getLiveAssessmentRulesConfig());
        setDraftLiveBookingRulesConfig(getLiveBookingRulesConfig());
        setDraftTrainingRulesConfig(getTrainingRulesConfig());
        refreshInsightRulesView();
    };
    window.saveInsightRuleConfig = saveInsightRuleConfig;
    window.saveInsightProgressConfig = saveInsightProgressConfig;
    window.saveLiveAssessmentRulesConfig = saveLiveAssessmentRulesConfig;
    window.saveLiveBookingRulesConfig = saveLiveBookingRulesConfig;
    window.saveTrainingRulesConfig = saveTrainingRulesConfig;
    window.resetLiveAssessmentRulesDraft = resetLiveAssessmentRulesDraft;
    window.resetLiveBookingRulesDraft = resetLiveBookingRulesDraft;
    window.resetTrainingRulesDraft = resetTrainingRulesDraft;
    window.markLiveAssessmentRulesDirty = markLiveAssessmentRulesDirty;
    window.markLiveBookingRulesDirty = markLiveBookingRulesDirty;
    window.markTrainingRulesDirty = markTrainingRulesDirty;
    window.formatLiveRulesDoc = formatLiveRulesDoc;
    window.formatLiveBookingRulesDoc = formatLiveBookingRulesDoc;
    window.formatTrainingRulesDoc = formatTrainingRulesDoc;
    window.updateTrainingRulesTargetMode = updateTrainingRulesTargetMode;
    window.resetInsightRuleConfig = resetInsightRuleConfig;
    window.addInsightTriggerPreset = addInsightTriggerPreset;
    window.addInsightProgressItem = addInsightProgressItem;
    window.changeInsightRuleSeverity = changeInsightRuleSeverity;
    window.changeInsightRuleThreshold = changeInsightRuleThreshold;
    window.removeInsightRuleByName = removeInsightRuleByName;
    window.removeInsightProgressItem = removeInsightProgressItem;
    window.changeInsightProgressType = changeInsightProgressType;
    window.toggleInsightProgressReportSection = toggleInsightProgressReportSection;
})();

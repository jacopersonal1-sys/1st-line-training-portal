/* ================= ADMIN: INSIGHT RULE PRESETS ================= */

(function() {
    const INSIGHT_RULE_KEY = 'insight_rule_config';
    const INSIGHT_PROGRESS_KEY = 'insight_progress_config';
    const LIVE_RULES_KEY = 'live_assessment_rules_config';
    const DEFAULT_LIVE_ASSESSMENT_RULES = [
        'This assessment takes approximately 1 hour to complete.',
        'You are allowed to reference the training material. However, if the material is referenced constantly and it is clear the material was not studied, the live session will be ended.',
        'If you are unable to answer a question within 5 minutes of it being provided, the marks obtained for that question are final and the next question will be provided.'
    ];
    const DEFAULT_LIVE_ASSESSMENT_RULES_HTML = `<ul>${DEFAULT_LIVE_ASSESSMENT_RULES.map(rule => `<li>${rule}</li>`).join('')}</ul>`;

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
        liveRulesConfig: null
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
        if (['assessment', 'vetting', 'test', 'report', 'review'].includes(normalizedType)) {
            return normalizedType;
        }
        const normalizedName = normalizeText(raw);
        if (!normalizedName) return 'assessment';
        if (normalizedName === 'onboard report') return 'report';
        if (normalizedName === 'insight review') return 'review';
        if (normalizedName.startsWith('1st vetting -') || normalizedName.startsWith('final vetting -')) return 'vetting';
        return 'assessment';
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
        const assessments = parseArrayFromLocalStorage('assessments');
        const vettingTopics = parseArrayFromLocalStorage('vettingTopics');
        const tests = parseArrayFromLocalStorage('tests');
        const names = [];

        if (Array.isArray(assessments)) {
            assessments.forEach((item) => {
                const name = item && item.name ? String(item.name).trim() : '';
                if (name) names.push(name);
            });
        }

        if (Array.isArray(vettingTopics)) {
            vettingTopics.forEach((topic) => {
                const clean = String(topic || '').trim();
                if (!clean) return;
                names.push(`1st Vetting - ${clean}`);
                names.push(`Final Vetting - ${clean}`);
            });
        }

        if (Array.isArray(tests)) {
            tests.forEach((test) => {
                const title = String((test && (test.title || test.name)) || '').trim();
                if (title) names.push(title);
            });
        }

        return uniqueStrings(names).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
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

        const pushItem = (name, type) => {
            const cleanName = String(name || '').trim();
            if (!cleanName) return;
            if (AUTO_PROGRESS_ITEMS.some(item => normalizeText(item.name) === normalizeText(cleanName))) return;
            const cleanType = inferProgressType(cleanName, type);
            map.set(normalizeText(cleanName), { name: cleanName, type: cleanType, source: 'manual' });
        };

        if (Array.isArray(raw.requiredItems)) {
            raw.requiredItems.forEach((item) => {
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

    function getLiveAssessmentRules() {
        return getLiveAssessmentRulesConfig().rules;
    }

    function getLiveAssessmentRulesHtml() {
        return getLiveAssessmentRulesConfig().rulesHtml;
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

    function escapeHtml(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderAssessmentSelector() {
        const select = document.getElementById('insightPresetAssessmentSelect');
        const progressSelect = document.getElementById('insightProgressItemSelect');
        const catalog = getAssessmentCatalog();
        const optionsHtml = catalog.length
            ? catalog.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')
            : '<option value="">No configured assessments/tests</option>';

        if (select) select.innerHTML = optionsHtml;
        if (progressSelect) progressSelect.innerHTML = optionsHtml;
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

        const next = {
            name: cleanName,
            type: inferProgressType(cleanName, null),
            source: 'manual'
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
            body.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No progress items configured.</td></tr>';
            return;
        }

        body.innerHTML = rows.map((item, index) => {
            const typeLabel = String(item.type || '').replace('_', ' ');
            const sourceLabel = item.source === 'auto' ? 'Auto' : 'Manual';
            const actionHtml = item.source === 'auto'
                ? '<span style="color:var(--text-muted); font-size:0.78rem;">Locked</span>'
                : `<button class="btn-danger btn-sm" onclick="removeInsightProgressItem('${encodeURIComponent(item.name)}')">Remove</button>`;
            return `
                <tr>
                    <td>${index + 1}</td>
                    <td>${escapeHtml(item.name)}</td>
                    <td>${escapeHtml(typeLabel)}</td>
                    <td>${escapeHtml(sourceLabel)}</td>
                    <td>${actionHtml}</td>
                </tr>
            `;
        }).join('');
    }

    function refreshInsightRulesView() {
        const config = getDraftConfig();
        const progressConfig = getDraftProgressConfig();
        const liveRulesConfig = getDraftLiveRulesConfig();
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
        refreshInsightRulesView();
        if (ok && typeof showToast === 'function') {
            showToast('Progress item added to draft list.', 'success');
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
        if (activeSection && activeSection.id === 'insights' && typeof renderInsightDashboard === 'function') {
            renderInsightDashboard();
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

    function resetLiveAssessmentRulesDraft() {
        setDraftLiveRulesConfig(getDefaultLiveRulesConfig());
        const input = document.getElementById('liveAssessmentRulesInput');
        if (input) delete input.dataset.dirty;
        refreshInsightRulesView();
    }

    function markLiveAssessmentRulesDirty() {
        const input = document.getElementById('liveAssessmentRulesInput');
        if (input) input.dataset.dirty = '1';
    }

    function formatLiveRulesDoc(cmd, value = null) {
        const input = document.getElementById('liveAssessmentRulesInput');
        if (!input) return;
        input.focus();
        document.execCommand(cmd, false, value);
        markLiveAssessmentRulesDirty();
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
    window.getInsightProgressRequiredItems = getInsightProgressRequiredItems;
    window.loadAdminInsightRules = function() {
        setDraftConfig(getInsightRuleConfig());
        setDraftProgressConfig(getInsightProgressConfig());
        setDraftLiveRulesConfig(getLiveAssessmentRulesConfig());
        refreshInsightRulesView();
    };
    window.saveInsightRuleConfig = saveInsightRuleConfig;
    window.saveLiveAssessmentRulesConfig = saveLiveAssessmentRulesConfig;
    window.resetLiveAssessmentRulesDraft = resetLiveAssessmentRulesDraft;
    window.markLiveAssessmentRulesDirty = markLiveAssessmentRulesDirty;
    window.formatLiveRulesDoc = formatLiveRulesDoc;
    window.resetInsightRuleConfig = resetInsightRuleConfig;
    window.addInsightTriggerPreset = addInsightTriggerPreset;
    window.addInsightProgressItem = addInsightProgressItem;
    window.changeInsightRuleSeverity = changeInsightRuleSeverity;
    window.changeInsightRuleThreshold = changeInsightRuleThreshold;
    window.removeInsightRuleByName = removeInsightRuleByName;
    window.removeInsightProgressItem = removeInsightProgressItem;
})();

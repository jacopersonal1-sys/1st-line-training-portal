/* ================= ASSESSMENT STUDIO DATA ================= */
const ASSESSMENT_STUDIO_KEY = 'assessment_studio_data';
const ASSESSMENT_STUDIO_LOCAL_KEY = 'assessment_studio_data_local';

const AssessmentStudioData = {
    state: {
        studio: { questionBucket: [], generators: [], submissions: [], groupings: [], tags: [], updatedAt: null, updatedBy: null },
        legacy: { assessments: [], tests: [], submissions: [], records: [], users: [], rosters: {} }
    },

    defaultStudio() {
        return { questionBucket: [], generators: [], submissions: [], groupings: [], tags: [], updatedAt: null, updatedBy: null };
    },

    makeId(prefix) {
        return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
    },

    editor() {
        return AppContext.user && AppContext.user.user ? AppContext.user.user : 'Admin';
    },

    esc(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    normalizeText(value) {
        return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    },

    safeParse(raw, fallback) {
        try {
            if (raw === null || raw === undefined || raw === '' || raw === 'undefined' || raw === 'null') return fallback;
            const parsed = JSON.parse(raw);
            return parsed === undefined || parsed === null ? fallback : parsed;
        } catch (error) {
            return fallback;
        }
    },

    localRead(key, fallback) {
        try {
            return this.safeParse(localStorage.getItem(key), fallback);
        } catch (error) {
            return fallback;
        }
    },

    normalizeQuestion(raw) {
        const q = raw && typeof raw === 'object' ? raw : {};
        const type = String(q.type || 'multiple_choice').trim();
        const points = Number(q.points);
        return {
            id: String(q.id || this.makeId('qb')).trim(),
            assessment: String(q.assessment || '').trim(),
            phase: String(q.phase || 'Assessment').trim(),
            type,
            text: String(q.text || q.question || '').trim(),
            points: Number.isFinite(points) && points > 0 ? Math.round(points * 10) / 10 : 1,
            suggestedAnswer: String(q.suggestedAnswer || q.suggested_answer || '').trim(),
            grouping: String(q.grouping || q.group || '').trim(),
            options: Array.isArray(q.options) ? q.options.map(v => String(v || '').trim()).filter(Boolean) : [],
            correct: q.correct !== undefined ? q.correct : null,
            pairs: Array.isArray(q.pairs) ? q.pairs.map(p => ({ left: String(p.left || '').trim(), right: String(p.right || '').trim() })).filter(p => p.left || p.right) : [],
            items: Array.isArray(q.items) ? q.items.map(v => String(v || '').trim()).filter(Boolean) : [],
            rows: Array.isArray(q.rows) ? q.rows.map(v => String(v || '').trim()).filter(Boolean) : [],
            cols: Array.isArray(q.cols) ? q.cols.map(v => String(v || '').trim()).filter(Boolean) : [],
            matrixCorrect: q.matrixCorrect || q.matrix_correct || q.correctMap || {},
            tags: Array.isArray(q.tags) ? q.tags.map(v => String(v || '').trim()).filter(Boolean) : String(q.tags || '').split(',').map(v => v.trim()).filter(Boolean),
            status: q.status === 'archived' ? 'archived' : 'active',
            createdAt: q.createdAt || new Date().toISOString(),
            updatedAt: q.updatedAt || q.createdAt || new Date().toISOString(),
            updatedBy: q.updatedBy || this.editor()
        };
    },

    normalizeGenerator(raw) {
        const g = raw && typeof raw === 'object' ? raw : {};
        const totalPoints = Number(g.totalPoints || g.totalScore);
        const rawLeeway = g.pointLeeway ?? g.pointsLeeway ?? g.leeway;
        const pointLeeway = Number(rawLeeway);
        return {
            id: String(g.id || this.makeId('gen')).trim(),
            assessment: String(g.assessment || '').trim(),
            phase: String(g.phase || 'Assessment').trim(),
            totalPoints: Number.isFinite(totalPoints) && totalPoints > 0 ? Math.round(totalPoints * 10) / 10 : 100,
            allowedTypes: Array.isArray(g.allowedTypes) ? g.allowedTypes.filter(Boolean) : ['multiple_choice', 'multi_select', 'text', 'matching', 'ranking', 'matrix'],
            groupLimits: g.groupLimits && typeof g.groupLimits === 'object' && !Array.isArray(g.groupLimits)
                ? Object.fromEntries(Object.entries(g.groupLimits).map(([key, value]) => [String(key || '').trim(), Math.max(0, Math.floor(Number(value || 0)))]).filter(([key]) => !!key))
                : {},
            pointLeeway: Number.isFinite(pointLeeway) && pointLeeway >= 0 ? Math.round(pointLeeway * 10) / 10 : 7,
            status: g.status === 'archived' ? 'archived' : 'active',
            createdAt: g.createdAt || new Date().toISOString(),
            updatedAt: g.updatedAt || g.createdAt || new Date().toISOString(),
            updatedBy: g.updatedBy || this.editor()
        };
    },

    normalizeSubmission(raw) {
        const s = raw && typeof raw === 'object' ? raw : {};
        const snapshot = s.testSnapshot && typeof s.testSnapshot === 'object' ? s.testSnapshot : { questions: [] };
        const maxPoints = Number(s.maxPoints || snapshot.totalPoints || 0);
        const earnedPoints = Number(s.earnedPoints || s.pointsEarned || 0);
        return {
            id: String(s.id || this.makeId('ast_sub')).trim(),
            generatorId: String(s.generatorId || '').trim(),
            trainee: String(s.trainee || '').trim(),
            groupID: String(s.groupID || '').trim(),
            assessment: String(s.assessment || snapshot.title || '').trim(),
            phase: String(s.phase || snapshot.phase || 'Assessment').trim(),
            status: String(s.status || 'assigned').trim(),
            feedbackStatus: String(s.feedbackStatus || 'none').trim(),
            testSnapshot: {
                ...snapshot,
                questions: Array.isArray(snapshot.questions) ? snapshot.questions.map(q => this.normalizeQuestion(q)) : []
            },
            answers: s.answers && typeof s.answers === 'object' ? s.answers : {},
            questionScores: s.questionScores && typeof s.questionScores === 'object' ? s.questionScores : {},
            maxPoints: Number.isFinite(maxPoints) && maxPoints > 0 ? Math.round(maxPoints * 10) / 10 : 0,
            earnedPoints: Number.isFinite(earnedPoints) ? Math.round(earnedPoints * 10) / 10 : 0,
            percent: Number.isFinite(Number(s.percent)) ? Number(s.percent) : 0,
            graderNotes: String(s.graderNotes || '').trim(),
            gradingAudit: Array.isArray(s.gradingAudit) ? s.gradingAudit : [],
            gradingLock: s.gradingLock && typeof s.gradingLock === 'object' ? s.gradingLock : null,
            generatedAt: s.generatedAt || s.createdAt || new Date().toISOString(),
            submittedAt: s.submittedAt || null,
            gradedAt: s.gradedAt || null,
            gradedBy: s.gradedBy || '',
            updatedAt: s.updatedAt || s.gradedAt || s.submittedAt || s.generatedAt || new Date().toISOString(),
            updatedBy: s.updatedBy || this.editor()
        };
    },

    normalizeStudio(raw) {
        const base = raw && typeof raw === 'object' ? raw : this.defaultStudio();
        return {
            questionBucket: Array.isArray(base.questionBucket) ? base.questionBucket.map(q => this.normalizeQuestion(q)).filter(q => q.text) : [],
            generators: Array.isArray(base.generators) ? base.generators.map(g => this.normalizeGenerator(g)).filter(g => g.assessment) : [],
            submissions: Array.isArray(base.submissions) ? base.submissions.map(s => this.normalizeSubmission(s)).filter(s => s.trainee && s.assessment) : [],
            groupings: Array.isArray(base.groupings)
                ? base.groupings.map(item => ({
                    id: String(item.id || this.makeId('grp')).trim(),
                    name: String(item.name || item.label || '').trim(),
                    createdAt: item.createdAt || new Date().toISOString(),
                    updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
                    updatedBy: item.updatedBy || this.editor()
                })).filter(item => item.name)
                : [],
            tags: Array.isArray(base.tags)
                ? base.tags.map(item => ({
                    id: String(item.id || this.makeId('tag')).trim(),
                    name: String(item.name || item.label || '').trim(),
                    createdAt: item.createdAt || new Date().toISOString(),
                    updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
                    updatedBy: item.updatedBy || this.editor()
                })).filter(item => item.name)
                : [],
            updatedAt: base.updatedAt || new Date().toISOString(),
            updatedBy: base.updatedBy || 'System'
        };
    },

    mergeById(remoteItems, localItems, timeField = 'updatedAt') {
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
    },

    mergeStudioItems(remoteItems, localItems, remoteDocTime = 0, localDocTime = 0) {
        const remoteMap = new Map();
        const localMap = new Map();
        const itemTime = (item) => Date.parse(item && (item.updatedAt || item.createdAt) || 0) || 0;
        const indexItems = (items, target) => {
            (Array.isArray(items) ? items : []).forEach(item => {
                if (!item || typeof item !== 'object') return;
                const id = String(item.id || '').trim();
                if (!id) return;
                const existing = target.get(id);
                if (!existing || itemTime(item) >= itemTime(existing)) target.set(id, item);
            });
        };

        indexItems(remoteItems, remoteMap);
        indexItems(localItems, localMap);

        const merged = new Map();
        new Set([...remoteMap.keys(), ...localMap.keys()]).forEach(id => {
            const remote = remoteMap.get(id);
            const local = localMap.get(id);
            if (remote && local) {
                merged.set(id, itemTime(local) >= itemTime(remote) ? local : remote);
                return;
            }

            if (remote) {
                if (!localDocTime || itemTime(remote) >= localDocTime) merged.set(id, remote);
                return;
            }

            if (!remoteDocTime || itemTime(local) >= remoteDocTime) merged.set(id, local);
        });

        return Array.from(merged.values());
    },

    submissionStatusRank(status) {
        const value = String(status || '').trim().toLowerCase();
        if (value === 'completed') return 4;
        if (value === 'pending_review') return 3;
        if (value === 'in_progress') return 2;
        if (value === 'assigned') return 1;
        return 0;
    },

    pickSubmission(existing, incoming) {
        if (!existing) return incoming;
        const existingRank = this.submissionStatusRank(existing.status);
        const incomingRank = this.submissionStatusRank(incoming.status);
        if (incomingRank !== existingRank) return incomingRank > existingRank ? incoming : existing;
        const existingDate = existing.updatedAt || existing.gradedAt || existing.submittedAt || existing.generatedAt || '';
        const incomingDate = incoming.updatedAt || incoming.gradedAt || incoming.submittedAt || incoming.generatedAt || '';
        return String(incomingDate) >= String(existingDate) ? incoming : existing;
    },

    mergeSubmissions(remoteItems, localItems) {
        const map = new Map();
        (Array.isArray(remoteItems) ? remoteItems : []).forEach(item => {
            if (!item || typeof item !== 'object') return;
            const id = String(item.id || '');
            if (id) map.set(id, item);
        });
        (Array.isArray(localItems) ? localItems : []).forEach(item => {
            if (!item || typeof item !== 'object') return;
            const id = String(item.id || '');
            if (id) map.set(id, this.pickSubmission(map.get(id), item));
        });
        return Array.from(map.values());
    },

    mergeStudio(remote, local) {
        const a = this.normalizeStudio(remote);
        const b = this.normalizeStudio(local);
        const remoteDocTime = Date.parse(a.updatedAt || 0) || 0;
        const localDocTime = Date.parse(b.updatedAt || 0) || 0;

        if (!remote || !remoteDocTime) return b;
        if (!local || !localDocTime) return a;

        return this.normalizeStudio({
            ...(remoteDocTime >= localDocTime ? b : a),
            ...(remoteDocTime >= localDocTime ? a : b),
            questionBucket: this.mergeStudioItems(a.questionBucket, b.questionBucket, remoteDocTime, localDocTime),
            generators: this.mergeStudioItems(a.generators, b.generators, remoteDocTime, localDocTime),
            submissions: this.mergeSubmissions(a.submissions, b.submissions),
            groupings: this.mergeStudioItems(a.groupings, b.groupings, remoteDocTime, localDocTime),
            tags: this.mergeStudioItems(a.tags, b.tags, remoteDocTime, localDocTime),
            updatedAt: (localDocTime >= remoteDocTime ? b.updatedAt : a.updatedAt) || new Date().toISOString(),
            updatedBy: (localDocTime >= remoteDocTime ? b.updatedBy : a.updatedBy) || this.editor()
        });
    },

    async fetchDocument(key, fallback) {
        if (!AppContext.supabase) return fallback;
        try {
            const { data, error } = await AppContext.supabase
                .from('app_documents')
                .select('content')
                .eq('key', key)
                .maybeSingle();
            if (error) throw error;
            return data && data.content !== undefined ? data.content : fallback;
        } catch (error) {
            console.warn(`[Assessment Studio] Cloud load failed for ${key}:`, error);
            return fallback;
        }
    },

    async load() {
        const localStudio = this.normalizeStudio(this.localRead(ASSESSMENT_STUDIO_LOCAL_KEY, this.defaultStudio()));
        const remoteStudio = await this.fetchDocument(ASSESSMENT_STUDIO_KEY, localStudio);
        this.state.studio = this.mergeStudio(remoteStudio, localStudio);
        localStorage.setItem(ASSESSMENT_STUDIO_LOCAL_KEY, JSON.stringify(this.state.studio));
        localStorage.setItem(ASSESSMENT_STUDIO_KEY, JSON.stringify(this.state.studio));

        const legacyKeys = ['assessments', 'tests', 'submissions', 'records', 'users', 'rosters'];
        const values = await Promise.all(legacyKeys.map(key => this.fetchDocument(key, this.localRead(key, key === 'rosters' ? {} : []))));
        this.state.legacy = {
            assessments: Array.isArray(values[0]) ? values[0] : [],
            tests: Array.isArray(values[1]) ? values[1] : [],
            submissions: Array.isArray(values[2]) ? values[2] : [],
            records: Array.isArray(values[3]) ? values[3] : [],
            users: Array.isArray(values[4]) ? values[4] : [],
            rosters: values[5] && typeof values[5] === 'object' && !Array.isArray(values[5]) ? values[5] : {}
        };
        return this.state;
    },

    async saveStudio() {
        let next = this.normalizeStudio(this.state.studio);
        next.updatedAt = new Date().toISOString();
        next.updatedBy = this.editor();
        this.state.studio = this.normalizeStudio(next);
        localStorage.setItem(ASSESSMENT_STUDIO_LOCAL_KEY, JSON.stringify(next));
        localStorage.setItem(ASSESSMENT_STUDIO_KEY, JSON.stringify(next));
        const hostNotified = this.notifyHostSave(next);

        if (!hostNotified && AppContext.supabase) {
            const { data, error } = await AppContext.supabase.from('app_documents').upsert({
                key: ASSESSMENT_STUDIO_KEY,
                content: this.state.studio,
                updated_at: new Date().toISOString()
            }).select('updated_at');
            if (error) throw error;
            const confirmedAt = Array.isArray(data) && data[0] && data[0].updated_at ? data[0].updated_at : '';
            if (confirmedAt) localStorage.setItem(`sync_ts_${ASSESSMENT_STUDIO_KEY}`, confirmedAt);
        }

        return this.state.studio;
    },

    notifyHostSave(studio) {
        const payload = {
            key: ASSESSMENT_STUDIO_KEY,
            localKey: ASSESSMENT_STUDIO_LOCAL_KEY,
            content: this.normalizeStudio(studio),
            updatedAt: new Date().toISOString()
        };
        try {
            const { ipcRenderer } = require('electron');
            if (ipcRenderer && typeof ipcRenderer.sendToHost === 'function') {
                ipcRenderer.sendToHost('assessment-studio-save', payload);
                return true;
            }
        } catch (error) {}
        try {
            if (window.parent && typeof window.parent.postMessage === 'function') {
                window.parent.postMessage({ type: 'assessment-studio-save', payload }, '*');
                return true;
            }
        } catch (error) {}
        return false;
    }
};

/* ================= Q&A HUB DATA ================= */
const QA_DATA_KEY = 'qa_data';
const QA_LOCAL_CACHE_KEY = 'qa_data_local';

const QAData = {
    defaultStore() {
        return { questions: [], submissions: [], updatedAt: null, updatedBy: null };
    },

    normalize(raw) {
        const store = raw && typeof raw === 'object' ? raw : this.defaultStore();
        if (!Array.isArray(store.questions)) store.questions = [];
        if (!Array.isArray(store.submissions)) store.submissions = [];

        store.questions = store.questions
            .filter(q => q && typeof q === 'object')
            .map(q => ({
                id: q.id || this.makeId('qa'),
                question: String(q.question || '').trim(),
                answer: String(q.answer || '').trim(),
                tags: Array.isArray(q.tags) ? q.tags.map(t => String(t || '').trim()).filter(Boolean) : [],
                status: q.status === 'draft' ? 'draft' : (q.status === 'deleted' ? 'deleted' : 'published'),
                resources: Array.isArray(q.resources) ? q.resources.filter(Boolean).map(resource => ({
                    id: resource.id || this.makeId('resource'),
                    type: resource.type || 'document',
                    label: String(resource.label || resource.name || resource.url || 'Open answer').trim(),
                    url: String(resource.url || '').trim(),
                    name: String(resource.name || '').trim(),
                    mime: String(resource.mime || '').trim(),
                    size: Number(resource.size || 0),
                    dataUrl: String(resource.dataUrl || ''),
                    createdAt: resource.createdAt || new Date().toISOString()
                })) : [],
                createdAt: q.createdAt || new Date().toISOString(),
                updatedAt: q.updatedAt || q.createdAt || new Date().toISOString(),
                updatedBy: q.updatedBy || 'Unknown'
            }))
            .filter(q => q.question);

        store.submissions = store.submissions
            .filter(s => s && typeof s === 'object')
            .map(s => ({
                id: s.id || this.makeId('ask'),
                question: String(s.question || '').trim(),
                trainee: String(s.trainee || 'Unknown trainee').trim(),
                status: s.status === 'reviewed' ? 'reviewed' : 'new',
                createdAt: s.createdAt || new Date().toISOString(),
                reviewedAt: s.reviewedAt || null,
                reviewedBy: s.reviewedBy || ''
            }))
            .filter(s => s.question);

        store.updatedAt = store.updatedAt || new Date().toISOString();
        store.updatedBy = store.updatedBy || 'System';
        return store;
    },

    makeId(prefix) {
        return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    },

    readObject(key) {
        if (typeof safeLocalParse === 'function') {
            const parsed = safeLocalParse(key, {});
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        }
        try {
            const raw = localStorage.getItem(key);
            if (raw === null || raw === undefined || raw === '' || raw === 'undefined' || raw === 'null') return {};
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (error) {
            console.warn(`[Q&A Hub] Ignored invalid local data for ${key}:`, error);
            return {};
        }
    },

    getEditor() {
        return AppContext.user && AppContext.user.user ? AppContext.user.user : 'Admin';
    },

    getStore() {
        return this.normalize(this.readObject(QA_LOCAL_CACHE_KEY));
    },

    setLocal(store) {
        localStorage.setItem(QA_LOCAL_CACHE_KEY, JSON.stringify(this.normalize(store)));
    },

    itemTime(item, fields) {
        const value = fields.map(field => item && item[field]).find(Boolean);
        return Date.parse(value || 0) || 0;
    },

    mergeSubmissions(remoteItems, localItems, remoteDocTime = 0) {
        const map = new Map();
        (Array.isArray(remoteItems) ? remoteItems : []).forEach(item => {
            if (!item || typeof item !== 'object') return;
            const id = String(item.id || '');
            if (id) map.set(id, item);
        });
        (Array.isArray(localItems) ? localItems : []).forEach(item => {
            if (!item || typeof item !== 'object') return;
            const id = String(item.id || '');
            if (!id) return;
            const current = map.get(id);
            if (current) {
                if (this.itemTime(item, ['reviewedAt', 'createdAt']) >= this.itemTime(current, ['reviewedAt', 'createdAt'])) {
                    map.set(id, item);
                }
            } else if (this.itemTime(item, ['reviewedAt', 'createdAt']) > remoteDocTime) {
                map.set(id, item);
            }
        });
        return Array.from(map.values());
    },

    mergeStores(remote, local, mode = 'load') {
        const base = this.normalize(remote || {});
        const incoming = this.normalize(local || {});
        const byUpdated = (a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
        const byCreated = (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
        const remoteDocTime = Date.parse(base.updatedAt || 0) || 0;

        const questions = mode === 'save' ? incoming.questions : base.questions;
        const submissions = this.mergeSubmissions(base.submissions, incoming.submissions, remoteDocTime);

        return this.normalize({
            questions: questions.slice().sort(byUpdated),
            submissions: submissions.sort(byCreated),
            updatedAt: (mode === 'save' ? incoming.updatedAt : base.updatedAt) || incoming.updatedAt,
            updatedBy: (mode === 'save' ? incoming.updatedBy : base.updatedBy) || incoming.updatedBy
        });
    },

    async load() {
        let store = this.getStore();
        if (AppContext.host && AppContext.host.QAHub && typeof AppContext.host.QAHub.getData === 'function') {
            try {
                const hostStore = this.normalize(AppContext.host.QAHub.getData());
                this.setLocal(hostStore);
                return hostStore;
            } catch (error) {
                console.warn('[Q&A Hub] Host bridge load failed:', error);
            }
        }
        if (!AppContext.supabase) return store;

        try {
            const { data, error } = await AppContext.supabase
                .from('app_documents')
                .select('content')
                .eq('key', QA_DATA_KEY)
                .maybeSingle();
            if (error) throw error;
            if (data && data.content) {
                store = this.normalize(data.content);
                this.setLocal(store);
            }
        } catch (error) {
            console.warn('[Q&A Hub] Cloud load failed:', error);
        }
        return store;
    },

    async save(store) {
        let normalized = this.normalize(store);
        normalized.updatedAt = new Date().toISOString();
        normalized.updatedBy = this.getEditor();
        this.setLocal(normalized);

        if (AppContext.host && AppContext.host.QAHub && typeof AppContext.host.QAHub.saveData === 'function') {
            await AppContext.host.QAHub.saveData(normalized);
            return normalized;
        }

        if (AppContext.supabase) {
            const { data: remoteRow, error: loadError } = await AppContext.supabase
                .from('app_documents')
                .select('content')
                .eq('key', QA_DATA_KEY)
                .maybeSingle();
            if (loadError) throw loadError;
            if (remoteRow && remoteRow.content) {
                normalized = this.mergeStores(remoteRow.content, normalized, 'save');
                normalized.updatedAt = new Date().toISOString();
                normalized.updatedBy = this.getEditor();
            }

            const { data, error } = await AppContext.supabase.from('app_documents').upsert({
                key: QA_DATA_KEY,
                content: normalized,
                updated_at: new Date().toISOString()
            }).select('updated_at');
            if (error) throw error;
            const confirmedAt = Array.isArray(data) && data[0] && data[0].updated_at ? data[0].updated_at : '';
            if (!confirmedAt) throw new Error('Q&A Hub save was not confirmed by Supabase.');
            localStorage.setItem(`sync_ts_${QA_DATA_KEY}`, confirmedAt);
        }

        return normalized;
    }
};

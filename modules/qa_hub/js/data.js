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

    mergeStores(remote, local) {
        const base = this.normalize(remote || {});
        const incoming = this.normalize(local || {});
        const byUpdated = (a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
        const byCreated = (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''));

        const questions = new Map();
        base.questions.forEach(item => questions.set(String(item.id), item));
        incoming.questions.forEach(item => {
            const id = String(item.id);
            const current = questions.get(id);
            if (!current || String(item.updatedAt || item.createdAt || '') >= String(current.updatedAt || current.createdAt || '')) {
                questions.set(id, item);
            }
        });

        const submissions = new Map();
        base.submissions.forEach(item => submissions.set(String(item.id), item));
        incoming.submissions.forEach(item => {
            const id = String(item.id);
            const current = submissions.get(id);
            if (!current || String(item.reviewedAt || item.createdAt || '') >= String(current.reviewedAt || current.createdAt || '')) {
                submissions.set(id, item);
            }
        });

        return this.normalize({
            questions: Array.from(questions.values()).sort(byUpdated),
            submissions: Array.from(submissions.values()).sort(byCreated),
            updatedAt: incoming.updatedAt || base.updatedAt,
            updatedBy: incoming.updatedBy || base.updatedBy
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
                normalized = this.mergeStores(remoteRow.content, normalized);
                normalized.updatedAt = new Date().toISOString();
                normalized.updatedBy = this.getEditor();
            }

            const { error } = await AppContext.supabase.from('app_documents').upsert({
                key: QA_DATA_KEY,
                content: normalized,
                updated_at: new Date().toISOString()
            });
            if (error) throw error;
        }

        return normalized;
    }
};

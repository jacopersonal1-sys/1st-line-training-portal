/* ================= OPL HUB DATA LAYER ================= */

const OPL_DATA_KEY = 'opl_hub_data';
const OPL_LOCAL_CACHE_KEY = 'opl_hub_data_local';

function getTodayIsoDate() {
    return new Date().toISOString().split('T')[0];
}

function getCurrentEditorLabel() {
    if (AppContext && AppContext.user) {
        return AppContext.user.user || AppContext.user.email || AppContext.user.name || 'unknown_user';
    }
    return 'system';
}

function touchDocAuditFields(doc) {
    const nowIso = new Date().toISOString();
    const dateEdited = getTodayIsoDate();
    const editedBy = getCurrentEditorLabel();
    if (!Array.isArray(doc.editHistory)) doc.editHistory = [];
    doc.editHistory.push({
        dateEdited,
        editedBy,
        updatedAt: nowIso
    });
    doc.dateEdited = dateEdited;
    doc.editedBy = editedBy;
    doc.updatedAt = nowIso;
    return doc;
}

const DataService = {
    _defaultStore: function() {
        return {
            linkedContents: [],
            classifiers: [],
            documents: []
        };
    },

    _normalizeStore: function(raw) {
        const fallback = this._defaultStore();
        const store = (raw && typeof raw === 'object') ? raw : fallback;

        if (!Array.isArray(store.linkedContents)) store.linkedContents = [];
        if (!Array.isArray(store.classifiers)) store.classifiers = [];
        if (!Array.isArray(store.documents)) store.documents = [];

        store.linkedContents = store.linkedContents
            .map(item => String(item || '').trim())
            .filter(Boolean)
            .filter((value, index, arr) => arr.findIndex(other => other.toLowerCase() === value.toLowerCase()) === index);

        store.classifiers = store.classifiers
            .map(item => String(item || '').trim())
            .filter(Boolean)
            .filter((value, index, arr) => arr.findIndex(other => other.toLowerCase() === value.toLowerCase()) === index);

        store.documents = store.documents
            .filter(item => item && typeof item === 'object')
            .map(item => ({
                id: item.id || ('opl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
                docName: String(item.docName || '').trim(),
                linkedContent: String(item.linkedContent || '').trim(),
                classifier: String(item.classifier || '').trim(),
                reviewDate: item.reviewDate || '',
                dateEdited: item.dateEdited || (item.updatedAt ? String(item.updatedAt).split('T')[0] : getTodayIsoDate()),
                editedBy: item.editedBy || item.modifiedBy || 'Unknown',
                createdAt: item.createdAt || new Date().toISOString(),
                updatedAt: item.updatedAt || new Date().toISOString(),
                editHistory: Array.isArray(item.editHistory) ? item.editHistory : []
            }));

        return store;
    },

    loadInitialData: async function() {
        let local = this._normalizeStore(JSON.parse(localStorage.getItem(OPL_LOCAL_CACHE_KEY) || '{}'));

        if (!localStorage.getItem(OPL_LOCAL_CACHE_KEY)) {
            localStorage.setItem(OPL_LOCAL_CACHE_KEY, JSON.stringify(local));
        }

        if (!AppContext.supabase) return local;

        try {
            const { data, error } = await AppContext.supabase
                .from('app_documents')
                .select('content')
                .eq('key', OPL_DATA_KEY)
                .maybeSingle();

            if (error) throw error;

            if (data && data.content) {
                local = this._normalizeStore(data.content);
                localStorage.setItem(OPL_LOCAL_CACHE_KEY, JSON.stringify(local));
            }
        } catch (err) {
            console.warn('[OPL Hub] Initial cloud load failed:', err);
        }

        return local;
    },

    getStore: function() {
        return this._normalizeStore(JSON.parse(localStorage.getItem(OPL_LOCAL_CACHE_KEY) || '{}'));
    },

    saveStore: async function(store) {
        const normalized = this._normalizeStore(store);
        localStorage.setItem(OPL_LOCAL_CACHE_KEY, JSON.stringify(normalized));
        await this._syncToCloud(normalized);
        return normalized;
    },

    _syncToCloud: async function(payload) {
        if (!AppContext.supabase) return;
        try {
            const { error } = await AppContext.supabase.from('app_documents').upsert({
                key: OPL_DATA_KEY,
                content: payload,
                updated_at: new Date().toISOString()
            });
            if (error) throw error;
        } catch (err) {
            console.error('[OPL Hub] Cloud sync failed:', err);
        }
    },

    getLinkedContents: function() {
        return this.getStore().linkedContents;
    },

    getClassifiers: function() {
        return this.getStore().classifiers;
    },

    addLinkedContent: async function(value) {
        const name = String(value || '').trim();
        if (!name) return { ok: false, message: 'Linked content cannot be empty.' };

        const store = this.getStore();
        const exists = store.linkedContents.some(item => item.toLowerCase() === name.toLowerCase());
        if (exists) return { ok: false, message: 'Linked content already exists.' };

        store.linkedContents.push(name);
        await this.saveStore(store);
        return { ok: true };
    },

    updateLinkedContent: async function(index, value) {
        const name = String(value || '').trim();
        const store = this.getStore();
        if (!store.linkedContents[index]) return { ok: false, message: 'Linked content not found.' };
        if (!name) return { ok: false, message: 'Linked content cannot be empty.' };

        const exists = store.linkedContents.some((item, i) => i !== index && item.toLowerCase() === name.toLowerCase());
        if (exists) return { ok: false, message: 'Linked content already exists.' };

        const previousValue = store.linkedContents[index];
        store.linkedContents[index] = name;
        store.documents = store.documents.map(doc => {
            if ((doc.linkedContent || '').toLowerCase() === previousValue.toLowerCase()) {
                const updated = { ...doc, linkedContent: name };
                return touchDocAuditFields(updated);
            }
            return doc;
        });
        await this.saveStore(store);
        return { ok: true };
    },

    removeLinkedContent: async function(index) {
        const store = this.getStore();
        if (!store.linkedContents[index]) return { ok: false, message: 'Linked content not found.' };
        const removed = store.linkedContents[index];
        store.linkedContents.splice(index, 1);
        store.documents = store.documents.map(doc => {
            if ((doc.linkedContent || '').toLowerCase() === removed.toLowerCase()) {
                const updated = { ...doc, linkedContent: '' };
                return touchDocAuditFields(updated);
            }
            return doc;
        });
        await this.saveStore(store);
        return { ok: true };
    },

    addClassifier: async function(value) {
        const name = String(value || '').trim();
        if (!name) return { ok: false, message: 'Classifier cannot be empty.' };

        const store = this.getStore();
        const exists = store.classifiers.some(item => item.toLowerCase() === name.toLowerCase());
        if (exists) return { ok: false, message: 'Classifier already exists.' };

        store.classifiers.push(name);
        await this.saveStore(store);
        return { ok: true };
    },

    updateClassifier: async function(index, value) {
        const name = String(value || '').trim();
        const store = this.getStore();
        if (!store.classifiers[index]) return { ok: false, message: 'Classifier not found.' };
        if (!name) return { ok: false, message: 'Classifier cannot be empty.' };

        const exists = store.classifiers.some((item, i) => i !== index && item.toLowerCase() === name.toLowerCase());
        if (exists) return { ok: false, message: 'Classifier already exists.' };

        const previousValue = store.classifiers[index];
        store.classifiers[index] = name;
        store.documents = store.documents.map(doc => {
            if ((doc.classifier || '').toLowerCase() === previousValue.toLowerCase()) {
                const updated = { ...doc, classifier: name };
                return touchDocAuditFields(updated);
            }
            return doc;
        });
        await this.saveStore(store);
        return { ok: true };
    },

    removeClassifier: async function(index) {
        const store = this.getStore();
        if (!store.classifiers[index]) return { ok: false, message: 'Classifier not found.' };
        const removed = store.classifiers[index];
        store.classifiers.splice(index, 1);
        store.documents = store.documents.map(doc => {
            if ((doc.classifier || '').toLowerCase() === removed.toLowerCase()) {
                const updated = { ...doc, classifier: '' };
                return touchDocAuditFields(updated);
            }
            return doc;
        });
        await this.saveStore(store);
        return { ok: true };
    },

    getDocuments: function() {
        const docs = this.getStore().documents.slice();
        docs.sort((a, b) => {
            const left = (a.docName || '').toLowerCase();
            const right = (b.docName || '').toLowerCase();
            if (left < right) return -1;
            if (left > right) return 1;
            return 0;
        });
        return docs;
    },

    getDocumentById: function(id) {
        return this.getDocuments().find(doc => doc.id === id) || null;
    },

    upsertDocument: async function(payload) {
        const docName = String(payload.docName || '').trim();
        const linkedContent = String(payload.linkedContent || '').trim();
        const classifier = String(payload.classifier || '').trim();
        const reviewDate = payload.reviewDate || '';

        if (!docName || !linkedContent || !reviewDate) {
            return { ok: false, message: 'Please complete DOC Name, Linked Content, and Review Date.' };
        }

        const store = this.getStore();
        const existingIndex = store.documents.findIndex(doc => doc.id === payload.id);
        const nowIso = new Date().toISOString();

        if (existingIndex > -1) {
            const updated = {
                ...store.documents[existingIndex],
                docName,
                linkedContent,
                classifier,
                reviewDate,
                updatedAt: nowIso
            };
            store.documents[existingIndex] = touchDocAuditFields(updated);
        } else {
            const created = {
                id: 'opl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                docName,
                linkedContent,
                classifier,
                reviewDate,
                createdAt: nowIso,
                updatedAt: nowIso,
                editHistory: []
            };
            store.documents.push(touchDocAuditFields(created));
        }

        await this.saveStore(store);
        return { ok: true };
    },

    deleteDocument: async function(id) {
        const store = this.getStore();
        const before = store.documents.length;
        store.documents = store.documents.filter(doc => doc.id !== id);
        if (store.documents.length === before) return { ok: false, message: 'Document not found.' };
        await this.saveStore(store);
        return { ok: true };
    }
};

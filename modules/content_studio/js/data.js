/* ================= CONTENT STUDIO DATA ================= */

const CONTENT_STUDIO_DATA_KEY = 'content_studio_data';
const CONTENT_STUDIO_LOCAL_CACHE_KEY = 'content_studio_data_local';
const CONTENT_CREATOR_DEFAULT_KEY = 'content_creator_default';
const CONTENT_CREATOR_DEFAULT_LABEL = 'Content Creator';
const CONTENT_CREATOR_VIDEO_BUCKET = 'content_creator_videos';
const CONTENT_CREATOR_DOC_BUCKET = 'content_creator_documents';

function getEditorName() {
    if (AppContext && AppContext.user) {
        return AppContext.user.user || AppContext.user.email || 'unknown_user';
    }
    return 'system';
}

function nowIso() {
    return new Date().toISOString();
}

function normalizeText(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function sanitizeRichHtml(value) {
    return String(value || '')
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
        .replace(/\son\w+=("[^"]*"|'[^']*')/gi, '')
        .trim();
}

function stripHtml(value) {
    return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function sanitizeStorageSegment(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 120) || 'file';
}

function buildScheduleKey(groupId, item) {
    const courseName = String(item.courseName || item.item || item.title || '').trim();
    const dateRange = String(item.dateRange || item.date || '').trim();
    const dueDate = String(item.dueDate || '').trim();
    return `${groupId}::${courseName}::${dateRange}::${dueDate}`;
}

const DataService = {
    _syncTimer: null,

    _defaultStore: function() {
        return {
            entries: [],
            analytics: [],
            annotations: []
        };
    },

    _buildDefaultEntry: function(subjects = [], header = CONTENT_CREATOR_DEFAULT_LABEL) {
        const now = nowIso();
        return {
            id: 'cs_entry_default',
            scheduleKey: CONTENT_CREATOR_DEFAULT_KEY,
            scheduleLabel: CONTENT_CREATOR_DEFAULT_LABEL,
            header: String(header || '').trim(),
            subjects: Array.isArray(subjects) ? subjects : [],
            createdAt: now,
            updatedAt: now,
            editedBy: getEditorName()
        };
    },

    _getDefaultEntryIndex: function(store) {
        return (store.entries || []).findIndex(e => e.scheduleKey === CONTENT_CREATOR_DEFAULT_KEY);
    },

    _ensureDefaultEntry: function(store) {
        if (!store || !Array.isArray(store.entries)) return null;

        const existingDefaultIdx = this._getDefaultEntryIndex(store);
        if (existingDefaultIdx > -1) return store.entries[existingDefaultIdx];

        const legacyEntries = store.entries.slice();
        if (legacyEntries.length === 0) {
            const freshDefault = this._buildDefaultEntry([], CONTENT_CREATOR_DEFAULT_LABEL);
            store.entries.unshift(freshDefault);
            return freshDefault;
        }

        const mergedSubjects = [];
        const seenComposite = new Set();
        const usedIds = new Set();
        let firstHeader = '';

        legacyEntries.forEach(entry => {
            if (!firstHeader && String(entry.header || '').trim()) {
                firstHeader = String(entry.header || '').trim();
            }

            (entry.subjects || []).forEach(subject => {
                const composite = [
                    normalizeText(subject.code),
                    normalizeText(stripHtml(subject.textHtml)),
                    normalizeText(subject.videoUrl),
                    normalizeText(subject.docUrl)
                ].join('|');

                if (composite !== '|||') {
                    if (seenComposite.has(composite)) return;
                    seenComposite.add(composite);
                }

                let subjectId = String(subject.id || ('cs_sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5)));
                while (usedIds.has(subjectId)) {
                    subjectId = 'cs_sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
                }
                usedIds.add(subjectId);

                mergedSubjects.push({
                    id: subjectId,
                    code: String(subject.code || '').trim(),
                    textHtml: sanitizeRichHtml(subject.textHtml || ''),
                    hasVideo: typeof subject.hasVideo === 'boolean' ? subject.hasVideo : !!subject.videoUrl,
                    videoMode: subject.videoMode || (subject.videoPath ? 'upload' : 'url'),
                    videoUrl: String(subject.videoUrl || '').trim(),
                    videoPath: String(subject.videoPath || '').trim(),
                    videoBucket: String(subject.videoBucket || '').trim(),
                    hasDocument: typeof subject.hasDocument === 'boolean' ? subject.hasDocument : !!subject.docUrl,
                    docMode: subject.docMode || (subject.docPath ? 'upload' : 'url'),
                    docUrl: String(subject.docUrl || '').trim(),
                    docPath: String(subject.docPath || '').trim(),
                    docBucket: String(subject.docBucket || '').trim(),
                    createdAt: subject.createdAt || nowIso(),
                    updatedAt: subject.updatedAt || nowIso()
                });
            });
        });

        mergedSubjects.sort((a, b) => {
            const ac = String(a.code || '').trim();
            const bc = String(b.code || '').trim();
            if (!ac && !bc) return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
            if (!ac) return 1;
            if (!bc) return -1;
            return ac.localeCompare(bc, undefined, { numeric: true, sensitivity: 'base' });
        });

        const defaultEntry = this._buildDefaultEntry(mergedSubjects, firstHeader || CONTENT_CREATOR_DEFAULT_LABEL);
        store.entries.unshift(defaultEntry);
        return defaultEntry;
    },

    _normalizeStore: function(raw) {
        const store = (raw && typeof raw === 'object') ? raw : this._defaultStore();
        if (!Array.isArray(store.entries)) store.entries = [];
        if (!Array.isArray(store.analytics)) store.analytics = [];
        if (!Array.isArray(store.annotations)) store.annotations = [];

        store.entries = store.entries
            .filter(e => e && typeof e === 'object')
            .map(e => ({
                id: String(e.id || ('cs_entry_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7))),
                scheduleKey: String(e.scheduleKey || '').trim(),
                scheduleLabel: String(e.scheduleLabel || '').trim(),
                header: String(e.header || '').trim(),
                subjects: Array.isArray(e.subjects) ? e.subjects.map(s => ({
                    id: String(s.id || ('cs_sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6))),
                    code: String(s.code || '').trim(),
                    textHtml: sanitizeRichHtml(s.textHtml || s.text || ''),
                    hasVideo: typeof s.hasVideo === 'boolean' ? s.hasVideo : !!s.videoUrl,
                    videoMode: String(s.videoMode || (s.videoPath ? 'upload' : 'url')).toLowerCase() === 'upload' ? 'upload' : 'url',
                    videoUrl: String(s.videoUrl || '').trim(),
                    videoPath: String(s.videoPath || '').trim(),
                    videoBucket: String(s.videoBucket || '').trim(),
                    hasDocument: typeof s.hasDocument === 'boolean' ? s.hasDocument : !!s.docUrl,
                    docMode: String(s.docMode || (s.docPath ? 'upload' : 'url')).toLowerCase() === 'upload' ? 'upload' : 'url',
                    docUrl: String(s.docUrl || '').trim(),
                    docPath: String(s.docPath || '').trim(),
                    docBucket: String(s.docBucket || '').trim(),
                    createdAt: s.createdAt || nowIso(),
                    updatedAt: s.updatedAt || nowIso()
                })) : [],
                createdAt: e.createdAt || nowIso(),
                updatedAt: e.updatedAt || nowIso(),
                editedBy: e.editedBy || getEditorName()
            }));

        store.analytics = store.analytics
            .filter(a => a && typeof a === 'object')
            .map(a => ({
                id: String(a.id || ''),
                entryId: String(a.entryId || '').trim(),
                subjectId: String(a.subjectId || '').trim(),
                username: String(a.username || '').trim(),
                plays: Number(a.plays || 0),
                watchSeconds: Number(a.watchSeconds || 0),
                skips: Number(a.skips || 0),
                skippedSeconds: Number(a.skippedSeconds || 0),
                skipEvents: Array.isArray(a.skipEvents) ? a.skipEvents.slice(-40) : [],
                lastPosition: Number(a.lastPosition || 0),
                lastPlayedAt: a.lastPlayedAt || null,
                updatedAt: a.updatedAt || nowIso()
            }))
            .filter(a => a.entryId && a.subjectId && a.username);

        store.annotations = store.annotations
            .filter(n => n && typeof n === 'object')
            .map(n => ({
                id: String(n.id || ('cs_note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8))),
                entryId: String(n.entryId || '').trim(),
                subjectId: String(n.subjectId || '').trim(),
                username: String(n.username || '').trim(),
                type: String(n.type || 'note').toLowerCase() === 'question' ? 'question' : 'note',
                text: String(n.text || '').trim(),
                timestampSec: Number(n.timestampSec || 0),
                createdAt: n.createdAt || nowIso(),
                updatedAt: n.updatedAt || n.createdAt || nowIso()
            }))
            .filter(n => n.entryId && n.subjectId && n.username && n.text);

        this._ensureDefaultEntry(store);
        return store;
    },

    loadInitialData: async function() {
        let local = this._normalizeStore(JSON.parse(localStorage.getItem(CONTENT_STUDIO_LOCAL_CACHE_KEY) || '{}'));
        if (!localStorage.getItem(CONTENT_STUDIO_LOCAL_CACHE_KEY)) {
            localStorage.setItem(CONTENT_STUDIO_LOCAL_CACHE_KEY, JSON.stringify(local));
        }

        if (!AppContext.supabase) return local;

        try {
            const { data, error } = await AppContext.supabase
                .from('app_documents')
                .select('content')
                .eq('key', CONTENT_STUDIO_DATA_KEY)
                .maybeSingle();

            if (error) throw error;
            if (data && data.content) {
                local = this._normalizeStore(data.content);
                localStorage.setItem(CONTENT_STUDIO_LOCAL_CACHE_KEY, JSON.stringify(local));
            }
        } catch (err) {
            console.warn('[Content Studio] Initial cloud load failed:', err);
        }

        return local;
    },

    getStore: function() {
        return this._normalizeStore(JSON.parse(localStorage.getItem(CONTENT_STUDIO_LOCAL_CACHE_KEY) || '{}'));
    },

    saveStore: async function(store, deferSync = false) {
        const normalized = this._normalizeStore(store);
        localStorage.setItem(CONTENT_STUDIO_LOCAL_CACHE_KEY, JSON.stringify(normalized));
        if (deferSync) {
            this._queueCloudSync(normalized);
        } else {
            await this._syncToCloud(normalized);
        }
        return normalized;
    },

    _queueCloudSync: function(payload) {
        if (this._syncTimer) clearTimeout(this._syncTimer);
        this._syncTimer = setTimeout(() => {
            this._syncTimer = null;
            this._syncToCloud(payload).catch(() => {});
        }, 1200);
    },

    _syncToCloud: async function(payload) {
        if (!AppContext.supabase) return;
        try {
            const { error } = await AppContext.supabase.from('app_documents').upsert({
                key: CONTENT_STUDIO_DATA_KEY,
                content: payload,
                updated_at: nowIso()
            });
            if (error) throw error;
        } catch (err) {
            console.error('[Content Studio] Cloud sync failed:', err);
        }
    },

    _buildStoragePath: function(category, fileName) {
        const user = (AppContext && AppContext.user && (AppContext.user.user || AppContext.user.email))
            ? (AppContext.user.user || AppContext.user.email)
            : 'unknown_user';
        const safeUser = sanitizeStorageSegment(user);
        const safeName = sanitizeStorageSegment(fileName || 'upload');
        const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        return `${category}/${safeUser}/${stamp}_${safeName}`;
    },

    _getStoragePublicUrl: function(bucket, path) {
        if (!AppContext.supabase || !bucket || !path) return '';
        try {
            const { data } = AppContext.supabase.storage.from(bucket).getPublicUrl(path);
            return (data && data.publicUrl) ? data.publicUrl : '';
        } catch (err) {
            return '';
        }
    },

    uploadVideoFile: async function(file) {
        if (!file) return { ok: false, message: 'No video file selected.' };
        if (!AppContext.supabase) return { ok: false, message: 'Supabase client not available for upload.' };

        const path = this._buildStoragePath('videos', file.name || 'video.mp4');
        try {
            const { error } = await AppContext.supabase.storage
                .from(CONTENT_CREATOR_VIDEO_BUCKET)
                .upload(path, file, {
                    upsert: true,
                    contentType: file.type || 'video/mp4',
                    cacheControl: '3600'
                });

            if (error) throw error;
            const publicUrl = this._getStoragePublicUrl(CONTENT_CREATOR_VIDEO_BUCKET, path);
            return {
                ok: true,
                bucket: CONTENT_CREATOR_VIDEO_BUCKET,
                path,
                url: publicUrl
            };
        } catch (err) {
            return {
                ok: false,
                message: err && err.message ? err.message : 'Video upload failed.'
            };
        }
    },

    uploadDocumentFile: async function(file) {
        if (!file) return { ok: false, message: 'No document file selected.' };
        if (!AppContext.supabase) return { ok: false, message: 'Supabase client not available for upload.' };

        const path = this._buildStoragePath('documents', file.name || 'document.pdf');
        try {
            const { error } = await AppContext.supabase.storage
                .from(CONTENT_CREATOR_DOC_BUCKET)
                .upload(path, file, {
                    upsert: true,
                    contentType: file.type || 'application/pdf',
                    cacheControl: '3600'
                });

            if (error) throw error;
            const publicUrl = this._getStoragePublicUrl(CONTENT_CREATOR_DOC_BUCKET, path);
            return {
                ok: true,
                bucket: CONTENT_CREATOR_DOC_BUCKET,
                path,
                url: publicUrl
            };
        } catch (err) {
            return {
                ok: false,
                message: err && err.message ? err.message : 'Document upload failed.'
            };
        }
    },

    resolveStorageUrl: async function(bucket, path, fallbackUrl = '') {
        const fallback = String(fallbackUrl || '').trim();
        if (!bucket || !path || !AppContext.supabase) return fallback;
        try {
            const { data, error } = await AppContext.supabase.storage.from(bucket).createSignedUrl(path, 7200);
            if (!error && data && data.signedUrl) return data.signedUrl;
        } catch (err) {}
        const publicUrl = this._getStoragePublicUrl(bucket, path);
        return publicUrl || fallback;
    },

    getScheduleOptions: function() {
        // Legacy compatibility: Content Creator is now a single workspace document.
        return [{ key: CONTENT_CREATOR_DEFAULT_KEY, label: CONTENT_CREATOR_DEFAULT_LABEL }];
    },

    getEntries: function() {
        const entries = this.getStore().entries.slice();
        entries.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        return entries;
    },

    getPrimaryEntry: function() {
        const store = this.getStore();
        this._ensureDefaultEntry(store);
        return store.entries.find(e => e.scheduleKey === CONTENT_CREATOR_DEFAULT_KEY) || store.entries[0] || null;
    },

    getEntryByScheduleKey: function(scheduleKey) {
        const key = String(scheduleKey || CONTENT_CREATOR_DEFAULT_KEY).trim() || CONTENT_CREATOR_DEFAULT_KEY;
        const entry = this.getEntries().find(e => e.scheduleKey === key);
        if (entry) return entry;
        return this.getPrimaryEntry();
    },

    upsertEntryMeta: async function(payload) {
        const scheduleKey = String(payload.scheduleKey || CONTENT_CREATOR_DEFAULT_KEY).trim() || CONTENT_CREATOR_DEFAULT_KEY;
        const scheduleLabel = String(payload.scheduleLabel || CONTENT_CREATOR_DEFAULT_LABEL).trim() || CONTENT_CREATOR_DEFAULT_LABEL;
        const header = String(payload.header ?? '');

        const store = this.getStore();
        this._ensureDefaultEntry(store);
        const idx = store.entries.findIndex(e => e.scheduleKey === scheduleKey);
        const now = nowIso();

        if (idx > -1) {
            store.entries[idx] = {
                ...store.entries[idx],
                scheduleLabel: scheduleLabel || store.entries[idx].scheduleLabel,
                header: header,
                updatedAt: now,
                editedBy: getEditorName()
            };
        } else {
            store.entries.push({
                id: 'cs_entry_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                scheduleKey,
                scheduleLabel,
                header,
                subjects: [],
                createdAt: now,
                updatedAt: now,
                editedBy: getEditorName()
            });
        }

        await this.saveStore(store);
        return { ok: true, entry: this.getEntryByScheduleKey(scheduleKey) };
    },

    upsertSubject: async function(scheduleKey, payload) {
        const targetKey = String(scheduleKey || CONTENT_CREATOR_DEFAULT_KEY).trim() || CONTENT_CREATOR_DEFAULT_KEY;
        const entry = this.getEntryByScheduleKey(targetKey);
        if (!entry) return { ok: false, message: 'Workspace not found.' };

        const textHtml = sanitizeRichHtml(payload.textHtml || '');
        const hasVideo = !!payload.hasVideo;
        const hasDocument = !!payload.hasDocument;
        const videoMode = String(payload.videoMode || 'url').toLowerCase() === 'upload' ? 'upload' : 'url';
        const docMode = String(payload.docMode || 'url').toLowerCase() === 'upload' ? 'upload' : 'url';

        const videoUrl = hasVideo ? String(payload.videoUrl || '').trim() : '';
        const videoPath = hasVideo ? String(payload.videoPath || '').trim() : '';
        const videoBucket = hasVideo ? String(payload.videoBucket || '').trim() : '';
        const docUrl = hasDocument ? String(payload.docUrl || '').trim() : '';
        const docPath = hasDocument ? String(payload.docPath || '').trim() : '';
        const docBucket = hasDocument ? String(payload.docBucket || '').trim() : '';

        const store = this.getStore();
        this._ensureDefaultEntry(store);
        const idx = store.entries.findIndex(e => e.scheduleKey === targetKey);
        if (idx < 0) return { ok: false, message: 'Workspace entry not found.' };

        const now = nowIso();
        const subjects = store.entries[idx].subjects || [];
        const subIdx = subjects.findIndex(s => s.id === payload.id);
        let code = String(payload.code || '').trim();

        if (subIdx > -1) {
            subjects[subIdx] = {
                ...subjects[subIdx],
                code,
                textHtml,
                hasVideo,
                videoMode,
                videoUrl,
                videoPath,
                videoBucket,
                hasDocument,
                docMode,
                docUrl,
                docPath,
                docBucket,
                updatedAt: now
            };
        } else {
            if (!code) code = `1.1.${subjects.length + 1}`;
            subjects.push({
                id: 'cs_sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
                code,
                textHtml,
                hasVideo,
                videoMode,
                videoUrl,
                videoPath,
                videoBucket,
                hasDocument,
                docMode,
                docUrl,
                docPath,
                docBucket,
                createdAt: now,
                updatedAt: now
            });
        }

        subjects.sort((a, b) => {
            const ac = String(a.code || '').trim();
            const bc = String(b.code || '').trim();
            if (!ac && !bc) return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
            if (!ac) return 1;
            if (!bc) return -1;
            return ac.localeCompare(bc, undefined, { numeric: true, sensitivity: 'base' });
        });
        store.entries[idx].subjects = subjects;
        store.entries[idx].updatedAt = now;
        store.entries[idx].editedBy = getEditorName();

        await this.saveStore(store);
        return { ok: true, entry: this.getEntryByScheduleKey(targetKey) };
    },

    deleteSubject: async function(scheduleKey, subjectId) {
        const store = this.getStore();
        this._ensureDefaultEntry(store);
        const key = String(scheduleKey || CONTENT_CREATOR_DEFAULT_KEY).trim() || CONTENT_CREATOR_DEFAULT_KEY;
        const idx = store.entries.findIndex(e => e.scheduleKey === key);
        if (idx < 0) return { ok: false, message: 'Workspace entry not found.' };

        const before = store.entries[idx].subjects.length;
        store.entries[idx].subjects = store.entries[idx].subjects.filter(s => s.id !== subjectId);
        if (store.entries[idx].subjects.length === before) return { ok: false, message: 'Subject not found.' };

        store.entries[idx].updatedAt = nowIso();
        store.entries[idx].editedBy = getEditorName();
        await this.saveStore(store);
        return { ok: true, entry: this.getEntryByScheduleKey(key) };
    },

    getSubjectById: function(scheduleKey, subjectId) {
        const entry = this.getEntryByScheduleKey(scheduleKey);
        if (!entry) return null;
        return (entry.subjects || []).find(s => s.id === subjectId) || null;
    },

    _getAnalyticsRow: function(store, entryId, subjectId, username, create = false) {
        const key = `${entryId}:${subjectId}:${username}`;
        let row = store.analytics.find(a => a.id === key);
        if (!row && create) {
            row = {
                id: key,
                entryId,
                subjectId,
                username,
                plays: 0,
                watchSeconds: 0,
                skips: 0,
                skippedSeconds: 0,
                skipEvents: [],
                lastPosition: 0,
                lastPlayedAt: null,
                updatedAt: nowIso()
            };
            store.analytics.push(row);
        }
        return row || null;
    },

    getUserSubjectAnalytics: function(entryId, subjectId, username) {
        const store = this.getStore();
        return this._getAnalyticsRow(store, entryId, subjectId, username, false) || {
            plays: 0,
            watchSeconds: 0,
            skips: 0,
            skippedSeconds: 0,
            lastPosition: 0
        };
    },

    getAllSubjectAnalytics: function(entryId, subjectId) {
        return this.getStore().analytics.filter(a => a.entryId === entryId && a.subjectId === subjectId);
    },

    addVideoAnnotation: async function(entryId, subjectId, username, type, text, timestampSec) {
        const cleanType = String(type || 'note').toLowerCase() === 'question' ? 'question' : 'note';
        const cleanText = String(text || '').trim();
        const sec = Number(timestampSec || 0);
        if (!entryId || !subjectId || !username || !cleanText) {
            return { ok: false, message: 'Missing annotation fields.' };
        }

        const store = this.getStore();
        store.annotations.push({
            id: 'cs_note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            entryId: String(entryId),
            subjectId: String(subjectId),
            username: String(username),
            type: cleanType,
            text: cleanText,
            timestampSec: Math.max(0, Number.isFinite(sec) ? sec : 0),
            createdAt: nowIso(),
            updatedAt: nowIso()
        });
        await this.saveStore(store);
        return { ok: true };
    },

    getSubjectAnnotations: function(entryId, subjectId, username = '') {
        const userFilter = String(username || '').trim().toLowerCase();
        return this.getStore().annotations
            .filter(n => n.entryId === String(entryId) && n.subjectId === String(subjectId))
            .filter(n => !userFilter || String(n.username || '').toLowerCase() === userFilter)
            .sort((a, b) => {
                const d = Number(a.timestampSec || 0) - Number(b.timestampSec || 0);
                if (d !== 0) return d;
                return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
            });
    },

    getEngagementUserBreakdown: function(entryId) {
        const targetEntry = String(entryId || '').trim();
        const store = this.getStore();
        const rows = (store.analytics || []).filter(a => !targetEntry || a.entryId === targetEntry);
        const notes = (store.annotations || []).filter(n => !targetEntry || n.entryId === targetEntry);
        const byUser = {};

        rows.forEach(row => {
            const key = String(row.username || '').trim();
            if (!key) return;
            if (!byUser[key]) {
                byUser[key] = {
                    username: key,
                    plays: 0,
                    watchSeconds: 0,
                    skips: 0,
                    skippedSeconds: 0,
                    subjects: new Set(),
                    lastPlayedAt: null,
                    annotations: 0
                };
            }
            byUser[key].plays += Number(row.plays || 0);
            byUser[key].watchSeconds += Number(row.watchSeconds || 0);
            byUser[key].skips += Number(row.skips || 0);
            byUser[key].skippedSeconds += Number(row.skippedSeconds || 0);
            byUser[key].subjects.add(String(row.subjectId || ''));
            if (!byUser[key].lastPlayedAt || String(row.lastPlayedAt || '') > String(byUser[key].lastPlayedAt || '')) {
                byUser[key].lastPlayedAt = row.lastPlayedAt || byUser[key].lastPlayedAt;
            }
        });

        notes.forEach(note => {
            const key = String(note.username || '').trim();
            if (!key) return;
            if (!byUser[key]) {
                byUser[key] = {
                    username: key,
                    plays: 0,
                    watchSeconds: 0,
                    skips: 0,
                    skippedSeconds: 0,
                    subjects: new Set(),
                    lastPlayedAt: null,
                    annotations: 0
                };
            }
            byUser[key].annotations += 1;
            byUser[key].subjects.add(String(note.subjectId || ''));
        });

        return Object.values(byUser)
            .map(item => ({
                ...item,
                subjectCount: item.subjects.size
            }))
            .sort((a, b) => {
                const watchDiff = Number(b.watchSeconds || 0) - Number(a.watchSeconds || 0);
                if (watchDiff !== 0) return watchDiff;
                return String(a.username || '').localeCompare(String(b.username || ''));
            });
    },

    getUserSubjectEngagement: function(entryId, username) {
        const targetEntry = String(entryId || '').trim();
        const targetUser = String(username || '').trim().toLowerCase();
        if (!targetEntry || !targetUser) return [];

        const entry = this.getEntries().find(e => String(e.id) === targetEntry) || null;
        const subjects = entry && Array.isArray(entry.subjects) ? entry.subjects : [];
        const subjectMap = {};
        subjects.forEach(s => { subjectMap[String(s.id)] = s; });

        const store = this.getStore();
        const rows = (store.analytics || []).filter(a => a.entryId === targetEntry && String(a.username || '').toLowerCase() === targetUser);
        const notes = (store.annotations || []).filter(n => n.entryId === targetEntry && String(n.username || '').toLowerCase() === targetUser);

        const bySubject = {};
        rows.forEach(row => {
            const id = String(row.subjectId || '').trim();
            if (!id) return;
            if (!bySubject[id]) {
                bySubject[id] = {
                    subjectId: id,
                    plays: 0,
                    watchSeconds: 0,
                    skips: 0,
                    skippedSeconds: 0,
                    lastPosition: 0,
                    lastPlayedAt: null,
                    annotations: 0
                };
            }
            bySubject[id].plays += Number(row.plays || 0);
            bySubject[id].watchSeconds += Number(row.watchSeconds || 0);
            bySubject[id].skips += Number(row.skips || 0);
            bySubject[id].skippedSeconds += Number(row.skippedSeconds || 0);
            bySubject[id].lastPosition = Math.max(Number(bySubject[id].lastPosition || 0), Number(row.lastPosition || 0));
            if (!bySubject[id].lastPlayedAt || String(row.lastPlayedAt || '') > String(bySubject[id].lastPlayedAt || '')) {
                bySubject[id].lastPlayedAt = row.lastPlayedAt || bySubject[id].lastPlayedAt;
            }
        });

        notes.forEach(note => {
            const id = String(note.subjectId || '').trim();
            if (!id) return;
            if (!bySubject[id]) {
                bySubject[id] = {
                    subjectId: id,
                    plays: 0,
                    watchSeconds: 0,
                    skips: 0,
                    skippedSeconds: 0,
                    lastPosition: 0,
                    lastPlayedAt: null,
                    annotations: 0
                };
            }
            bySubject[id].annotations += 1;
        });

        return Object.values(bySubject)
            .map(row => {
                const subject = subjectMap[row.subjectId] || {};
                return {
                    ...row,
                    code: String(subject.code || ''),
                    title: stripHtml(subject.textHtml || '').slice(0, 120)
                };
            })
            .sort((a, b) => {
                const watchDiff = Number(b.watchSeconds || 0) - Number(a.watchSeconds || 0);
                if (watchDiff !== 0) return watchDiff;
                return String(a.code || '').localeCompare(String(b.code || ''), undefined, { numeric: true, sensitivity: 'base' });
            });
    },

    recordPlay: function(entryId, subjectId, username) {
        const store = this.getStore();
        const row = this._getAnalyticsRow(store, entryId, subjectId, username, true);
        row.plays += 1;
        row.lastPlayedAt = nowIso();
        row.updatedAt = nowIso();
        this.saveStore(store, true).catch(() => {});
    },

    recordWatchDelta: function(entryId, subjectId, username, seconds, lastPosition) {
        const delta = Number(seconds || 0);
        if (!(delta > 0)) return;
        const store = this.getStore();
        const row = this._getAnalyticsRow(store, entryId, subjectId, username, true);
        row.watchSeconds += delta;
        row.lastPosition = Number(lastPosition || row.lastPosition || 0);
        row.updatedAt = nowIso();
        this.saveStore(store, true).catch(() => {});
    },

    recordSkip: function(entryId, subjectId, username, fromTime, toTime) {
        const from = Number(fromTime || 0);
        const to = Number(toTime || 0);
        const diff = to - from;
        if (!(diff > 2)) return;

        const store = this.getStore();
        const row = this._getAnalyticsRow(store, entryId, subjectId, username, true);
        row.skips += 1;
        row.skippedSeconds += diff;
        row.lastPosition = to;
        row.skipEvents = row.skipEvents || [];
        row.skipEvents.push({
            from: Number(from.toFixed(1)),
            to: Number(to.toFixed(1)),
            skipped: Number(diff.toFixed(1)),
            at: nowIso()
        });
        if (row.skipEvents.length > 40) row.skipEvents = row.skipEvents.slice(-40);
        row.updatedAt = nowIso();
        this.saveStore(store, true).catch(() => {});
    }
};

window.DataService = DataService;
window.ContentStudioUtils = {
    stripHtml,
    sanitizeRichHtml
};

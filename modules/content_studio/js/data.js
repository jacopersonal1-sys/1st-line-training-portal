/* ================= CONTENT STUDIO DATA ================= */

const CONTENT_STUDIO_DATA_KEY = 'content_studio_data';
const CONTENT_STUDIO_LOCAL_CACHE_KEY = 'content_studio_data_local';

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
            analytics: []
        };
    },

    _normalizeStore: function(raw) {
        const store = (raw && typeof raw === 'object') ? raw : this._defaultStore();
        if (!Array.isArray(store.entries)) store.entries = [];
        if (!Array.isArray(store.analytics)) store.analytics = [];

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
                    videoUrl: String(s.videoUrl || '').trim(),
                    docUrl: String(s.docUrl || '').trim(),
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

    getScheduleOptions: function() {
        let schedules = {};
        try { schedules = JSON.parse(localStorage.getItem('schedules') || '{}'); } catch (e) {}

        const options = [];
        Object.entries(schedules || {}).forEach(([groupId, items]) => {
            if (!Array.isArray(items)) return;
            items.forEach((item) => {
                if (!item || typeof item !== 'object') return;
                const courseName = String(item.courseName || item.item || item.title || '').trim();
                const dateRange = String(item.dateRange || item.date || '').trim();
                const dueDate = String(item.dueDate || '').trim();
                if (!courseName) return;

                const key = buildScheduleKey(groupId, item);
                const label = `${groupId} | ${dateRange || dueDate || 'No Date'} | ${courseName}`;
                options.push({ key, groupId, courseName, dateRange, dueDate, label });
            });
        });

        const unique = [];
        const seen = new Set();
        options.forEach(opt => {
            if (seen.has(opt.key)) return;
            seen.add(opt.key);
            unique.push(opt);
        });

        unique.sort((a, b) => a.label.localeCompare(b.label));
        return unique;
    },

    getEntries: function() {
        const entries = this.getStore().entries.slice();
        entries.sort((a, b) => (a.scheduleLabel || '').localeCompare(b.scheduleLabel || ''));
        return entries;
    },

    getEntryByScheduleKey: function(scheduleKey) {
        return this.getEntries().find(e => e.scheduleKey === String(scheduleKey || '')) || null;
    },

    upsertEntryMeta: async function(payload) {
        const scheduleKey = String(payload.scheduleKey || '').trim();
        const scheduleLabel = String(payload.scheduleLabel || '').trim();
        const header = String(payload.header || '').trim();
        if (!scheduleKey) return { ok: false, message: 'Select a schedule timeline item first.' };

        const store = this.getStore();
        const idx = store.entries.findIndex(e => e.scheduleKey === scheduleKey);
        const now = nowIso();

        if (idx > -1) {
            store.entries[idx] = {
                ...store.entries[idx],
                scheduleLabel: scheduleLabel || store.entries[idx].scheduleLabel,
                header: header || store.entries[idx].header || scheduleLabel,
                updatedAt: now,
                editedBy: getEditorName()
            };
        } else {
            store.entries.push({
                id: 'cs_entry_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                scheduleKey,
                scheduleLabel,
                header: header || scheduleLabel,
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
        const entry = this.getEntryByScheduleKey(scheduleKey);
        if (!entry) return { ok: false, message: 'Please save header first to create this timeline content.' };

        const code = String(payload.code || '').trim();
        const textHtml = sanitizeRichHtml(payload.textHtml || '');
        const videoUrl = String(payload.videoUrl || '').trim();
        const docUrl = String(payload.docUrl || '').trim();
        if (!code || !stripHtml(textHtml)) {
            return { ok: false, message: 'Subject code and text are required.' };
        }

        const store = this.getStore();
        const idx = store.entries.findIndex(e => e.scheduleKey === scheduleKey);
        if (idx < 0) return { ok: false, message: 'Timeline entry not found.' };

        const now = nowIso();
        const subjects = store.entries[idx].subjects || [];
        const subIdx = subjects.findIndex(s => s.id === payload.id);

        if (subIdx > -1) {
            subjects[subIdx] = {
                ...subjects[subIdx],
                code,
                textHtml,
                videoUrl,
                docUrl,
                updatedAt: now
            };
        } else {
            subjects.push({
                id: 'cs_sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
                code,
                textHtml,
                videoUrl,
                docUrl,
                createdAt: now,
                updatedAt: now
            });
        }

        subjects.sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }));
        store.entries[idx].subjects = subjects;
        store.entries[idx].updatedAt = now;
        store.entries[idx].editedBy = getEditorName();

        await this.saveStore(store);
        return { ok: true, entry: this.getEntryByScheduleKey(scheduleKey) };
    },

    deleteSubject: async function(scheduleKey, subjectId) {
        const store = this.getStore();
        const idx = store.entries.findIndex(e => e.scheduleKey === String(scheduleKey || ''));
        if (idx < 0) return { ok: false, message: 'Timeline entry not found.' };

        const before = store.entries[idx].subjects.length;
        store.entries[idx].subjects = store.entries[idx].subjects.filter(s => s.id !== subjectId);
        if (store.entries[idx].subjects.length === before) return { ok: false, message: 'Subject not found.' };

        store.entries[idx].updatedAt = nowIso();
        store.entries[idx].editedBy = getEditorName();
        await this.saveStore(store);
        return { ok: true, entry: this.getEntryByScheduleKey(scheduleKey) };
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

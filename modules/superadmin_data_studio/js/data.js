const StudioData = {
    sourceCatalog: {
        users: { id: 'users', label: 'Users', group: 'people', type: 'blob_array', docKey: 'users', keyField: 'user', icon: 'fa-users' },
        rosters: { id: 'rosters', label: 'Groups', group: 'people', type: 'blob_object', docKey: 'rosters', keyField: 'groupName', icon: 'fa-people-group' },
        tests: { id: 'tests', label: 'Assessments', group: 'learning', type: 'blob_array', docKey: 'tests', keyField: 'id', icon: 'fa-file-signature' },
        system_config: { id: 'system_config', label: 'System Config', group: 'system', type: 'document', docKey: 'system_config', icon: 'fa-sliders' },
        archived_users: { id: 'archived_users', label: 'Archived Users', group: 'people', type: 'row', table: 'archived_users', keyField: 'id', packedData: true, icon: 'fa-box-archive' },
        records: { id: 'records', label: 'Records', group: 'learning', type: 'row', table: 'records', keyField: 'id', packedData: true, icon: 'fa-square-poll-vertical' },
        submissions: { id: 'submissions', label: 'Submissions', group: 'learning', type: 'row', table: 'submissions', keyField: 'id', packedData: true, icon: 'fa-inbox' },
        live_bookings: { id: 'live_bookings', label: 'Live Bookings', group: 'learning', type: 'row', table: 'live_bookings', keyField: 'id', packedData: true, icon: 'fa-calendar-check' },
        exemptions: { id: 'exemptions', label: 'Exemptions', group: 'learning', type: 'row', table: 'exemptions', keyField: 'id', packedData: true, icon: 'fa-ban' },
        link_requests: { id: 'link_requests', label: 'Link Requests', group: 'learning', type: 'row', table: 'link_requests', keyField: 'id', packedData: true, icon: 'fa-link' },
        attendance: { id: 'attendance', label: 'Attendance', group: 'operations', type: 'row', table: 'attendance', keyField: 'id', packedData: true, icon: 'fa-user-clock' },
        live_sessions: { id: 'live_sessions', label: 'Live Sessions', group: 'operations', type: 'row', table: 'live_sessions', keyField: 'id', packedData: true, icon: 'fa-broadcast-tower' },
        access_logs: { id: 'access_logs', label: 'Access Logs', group: 'operations', type: 'row', table: 'access_logs', keyField: 'id', packedData: true, icon: 'fa-right-to-bracket' },
        monitor_history: { id: 'monitor_history', label: 'Monitor History', group: 'operations', type: 'row', table: 'monitor_history', keyField: 'id', packedData: true, icon: 'fa-eye' },
        network_diagnostics: { id: 'network_diagnostics', label: 'Network Diagnostics', group: 'operations', type: 'row', table: 'network_diagnostics', keyField: 'id', packedData: true, icon: 'fa-network-wired' },
        error_reports: { id: 'error_reports', label: 'Error Reports', group: 'operations', type: 'row', table: 'error_reports', keyField: 'id', packedData: true, icon: 'fa-triangle-exclamation' },
        saved_reports: { id: 'saved_reports', label: 'Saved Reports', group: 'operations', type: 'row', table: 'saved_reports', keyField: 'id', packedData: true, icon: 'fa-folder-open' },
        insight_reviews: { id: 'insight_reviews', label: 'Insight Reviews', group: 'operations', type: 'row', table: 'insight_reviews', keyField: 'id', packedData: true, icon: 'fa-magnifying-glass-chart' },
        nps_responses: { id: 'nps_responses', label: 'NPS Responses', group: 'operations', type: 'row', table: 'nps_responses', keyField: 'id', packedData: true, icon: 'fa-face-smile' },
        calendar_events: { id: 'calendar_events', label: 'Calendar Events', group: 'operations', type: 'row', table: 'calendar_events', keyField: 'id', packedData: true, icon: 'fa-calendar-days' }
    },

    state: {
        sources: {},
        allDocuments: [],
        lastRefreshAt: null,
        latestEvent: null,
        liveConnected: false,
        refreshCounter: 0,
        loading: false,
        refreshError: null,
        unsubscribe: null,
        refreshTimer: null
    },

    async loadAll(reason = 'manual') {
        if (!AppContext.supabase) throw new Error("Supabase client not available.");

        this.state.loading = true;
        this.state.refreshError = null;

        const blobSources = Object.values(this.sourceCatalog).filter(source => source.type !== 'row');
        const rowSources = Object.values(this.sourceCatalog).filter(source => source.type === 'row');

        try {
            const [docsResult, ...rowResults] = await Promise.all([
                AppContext.supabase.from('app_documents').select('key, content, updated_at'),
                ...rowSources.map(source => AppContext.supabase.from(source.table).select('*'))
            ]);

            const allDocs = Array.isArray(docsResult.data) ? docsResult.data : [];
            const docsByKey = new Map(allDocs.map(row => [row.key, row]));
            const nextSources = {};

            blobSources.forEach(source => {
                const doc = docsByKey.get(source.docKey);
                let value = null;
                if (doc) value = this.clone(doc.content);

                if (source.type === 'blob_array') value = Array.isArray(value) ? value : [];
                if (source.type === 'blob_object' || source.type === 'document') value = (value && typeof value === 'object') ? value : {};

                nextSources[source.id] = {
                    definition: source,
                    rows: source.type === 'blob_array' ? value : [],
                    document: source.type === 'blob_array' ? null : value,
                    meta: {
                        updatedAt: doc ? doc.updated_at : null,
                        error: null
                    }
                };
            });

            rowSources.forEach((source, index) => {
                const result = rowResults[index];
                const normalizedRows = this.normalizeRowsForSource(source, Array.isArray(result.data) ? result.data : []);

                nextSources[source.id] = {
                    definition: source,
                    rows: this.sortRows(normalizedRows.rows),
                    document: null,
                    meta: {
                        updatedAt: null,
                        error: result.error ? result.error.message : null,
                        rawRowsByKey: normalizedRows.rawRowsByKey
                    }
                };
            });

            this.state.sources = nextSources;
            this.state.allDocuments = allDocs
                .map(doc => ({
                    key: doc.key,
                    content: this.clone(doc.content),
                    updated_at: doc.updated_at
                }))
                .sort((a, b) => (a.key || '').localeCompare(b.key || ''));
            this.state.lastRefreshAt = new Date().toISOString();
            this.state.refreshCounter += 1;
            this.state.latestEvent = reason === 'manual'
                ? this.state.latestEvent
                : `Realtime update from ${reason}`;
        } catch (error) {
            this.state.refreshError = error.message || String(error);
            throw error;
        } finally {
            this.state.loading = false;
        }
    },

    setupRealtime(onUpdate) {
        if (!AppContext.supabase) return;
        if (this.state.unsubscribe) this.state.unsubscribe();

        const watchedTables = new Set(['app_documents']);
        Object.values(this.sourceCatalog)
            .filter(source => source.type === 'row')
            .forEach(source => watchedTables.add(source.table));

        const channel = AppContext.supabase
            .channel('superadmin_data_studio_live')
            .on('postgres_changes', { event: '*', schema: 'public' }, payload => {
                const table = payload.table || 'unknown';
                if (!watchedTables.has(table)) return;

                this.state.liveConnected = true;
                this.state.latestEvent = `${payload.eventType} on ${table}`;
                clearTimeout(this.state.refreshTimer);
                this.state.refreshTimer = setTimeout(async () => {
                    try {
                        await this.loadAll(table);
                    } catch (error) {
                        console.error("[Data Studio] Realtime refresh failed:", error);
                    }
                    if (typeof onUpdate === 'function') onUpdate();
                }, 250);
            })
            .subscribe(status => {
                this.state.liveConnected = status === 'SUBSCRIBED';
                if (typeof onUpdate === 'function') onUpdate();
            });

        this.state.unsubscribe = () => {
            try {
                channel.unsubscribe();
            } catch (error) {
                console.warn("[Data Studio] Failed to unsubscribe realtime channel:", error);
            }
        };
    },

    getSource(sourceId) {
        return this.state.sources[sourceId] || null;
    },

    getRows(sourceId) {
        const source = this.getSource(sourceId);
        return source ? this.clone(source.rows || []) : [];
    },

    getDocument(sourceId) {
        const source = this.getSource(sourceId);
        return source ? this.clone(source.document) : null;
    },

    async updateDocument(docKey, nextContent) {
        const { error } = await AppContext.supabase.from('app_documents').upsert({
            key: docKey,
            content: this.clone(nextContent),
            updated_at: new Date().toISOString()
        });

        if (error) throw new Error(error.message || `Failed to save ${docKey}`);
        await this.loadAll(`app_documents:${docKey}`);
    },

    async saveBlobArrayItem(sourceId, nextItem, originalKeyValue = null) {
        const source = this.sourceCatalog[sourceId];
        if (!source || source.type !== 'blob_array') throw new Error("Invalid blob array source.");

        const nextKey = nextItem ? nextItem[source.keyField] : null;
        if (!nextKey && nextKey !== 0) throw new Error(`${source.label} requires "${source.keyField}" to save.`);

        const currentRows = this.getRows(sourceId);
        const lookupKey = originalKeyValue !== null ? originalKeyValue : nextKey;
        const existingIndex = currentRows.findIndex(row => String(row[source.keyField]) === String(lookupKey));
        const copy = this.clone(nextItem);

        if (existingIndex > -1) currentRows[existingIndex] = copy;
        else currentRows.push(copy);

        await this.updateDocument(source.docKey, currentRows);
    },

    async deleteBlobArrayItem(sourceId, keyValue) {
        const source = this.sourceCatalog[sourceId];
        if (!source || source.type !== 'blob_array') throw new Error("Invalid blob array source.");
        const nextRows = this.getRows(sourceId).filter(row => String(row[source.keyField]) !== String(keyValue));
        await this.updateDocument(source.docKey, nextRows);
    },

    async saveBlobObjectEntry(sourceId, entryKey, entryValue, originalKey = null) {
        const source = this.sourceCatalog[sourceId];
        if (!source || source.type !== 'blob_object') throw new Error("Invalid blob object source.");
        if (!entryKey) throw new Error("Entry key is required.");

        const nextDoc = this.getDocument(sourceId) || {};
        const normalizedOriginalKey = originalKey || entryKey;
        if (normalizedOriginalKey !== entryKey) delete nextDoc[normalizedOriginalKey];
        nextDoc[entryKey] = this.clone(entryValue);
        await this.updateDocument(source.docKey, nextDoc);
    },

    async deleteBlobObjectEntry(sourceId, entryKey) {
        const source = this.sourceCatalog[sourceId];
        if (!source || source.type !== 'blob_object') throw new Error("Invalid blob object source.");
        const nextDoc = this.getDocument(sourceId) || {};
        delete nextDoc[entryKey];
        await this.updateDocument(source.docKey, nextDoc);
    },

    async saveRow(sourceId, nextRow, originalKeyValue = null) {
        const source = this.sourceCatalog[sourceId];
        if (!source || source.type !== 'row') throw new Error("Invalid row source.");
        if (!source.keyField) throw new Error(`${source.label} does not expose a safe row key.`);

        const nextKeyValue = nextRow ? nextRow[source.keyField] : null;
        if (nextKeyValue === undefined || nextKeyValue === null || nextKeyValue === '') {
            throw new Error(`${source.label} requires "${source.keyField}" to save.`);
        }

        if (originalKeyValue !== null && String(originalKeyValue) !== String(nextKeyValue)) {
            throw new Error(`Changing "${source.keyField}" is blocked here to prevent duplicate rows.`);
        }

        const payload = this.buildRowPayload(sourceId, nextRow);
        const { error } = await AppContext.supabase.from(source.table).upsert(payload);
        if (error) throw new Error(error.message || `Failed to save ${source.label}`);
        await this.loadAll(source.table);
    },

    async deleteRow(sourceId, keyValue) {
        const source = this.sourceCatalog[sourceId];
        if (!source || source.type !== 'row' || !source.keyField) throw new Error("This source cannot be safely deleted here.");

        const { error } = await AppContext.supabase.from(source.table).delete().eq(source.keyField, keyValue);
        if (error) throw new Error(error.message || `Failed to delete ${source.label}`);
        await this.loadAll(source.table);
    },

    getAllDocuments() {
        return this.clone(this.state.allDocuments);
    },

    listExplorerSources() {
        const docsSource = {
            id: 'app_documents_all',
            label: 'App Documents',
            type: 'documents_index',
            group: 'system',
            icon: 'fa-database'
        };

        return [...Object.values(this.sourceCatalog), docsSource].sort((a, b) => a.label.localeCompare(b.label));
    },

    getExplorerPayload(sourceId) {
        if (sourceId === 'app_documents_all') return this.getAllDocuments();

        const source = this.getSource(sourceId);
        if (!source) return [];
        if (source.definition.type === 'blob_array') return this.clone(source.rows);
        if (source.definition.type === 'row') return this.clone(source.rows);
        if (source.definition.type === 'blob_object') {
            return Object.entries(source.document || {}).map(([key, value]) => ({
                groupName: key,
                members: this.clone(value)
            }));
        }

        return [{
            key: source.definition.docKey,
            content: this.clone(source.document)
        }];
    },

    normalizeRowsForSource(source, rows) {
        const normalized = [];
        const rawRowsByKey = {};

        rows.forEach(row => {
            const normalizedRow = this.normalizeRow(source, row);
            normalized.push(normalizedRow);

            const rowKey = normalizedRow[source.keyField];
            if (rowKey !== undefined && rowKey !== null && rowKey !== '') {
                rawRowsByKey[String(rowKey)] = this.clone(row);
            }
        });

        return { rows: normalized, rawRowsByKey };
    },

    normalizeRow(source, row) {
        const dataPayload = source.packedData && row && row.data && typeof row.data === 'object'
            ? this.clone(row.data)
            : {};

        const merged = {
            ...this.clone(row),
            ...dataPayload
        };

        delete merged.data;

        if ((merged[source.keyField] === undefined || merged[source.keyField] === null || merged[source.keyField] === '') && row[source.keyField] !== undefined) {
            merged[source.keyField] = row[source.keyField];
        }

        if (merged.updated_at === undefined && row.updated_at !== undefined) {
            merged.updated_at = row.updated_at;
        }

        return merged;
    },

    buildRowPayload(sourceId, nextRow) {
        const source = this.sourceCatalog[sourceId];
        const sanitized = this.stripStudioFields(nextRow);

        if (!source.packedData) {
            return sanitized;
        }

        const sourceState = this.getSource(sourceId);
        const rowKey = sanitized[source.keyField];
        const existingRaw = sourceState?.meta?.rawRowsByKey?.[String(rowKey)] || {};
        const payload = this.clone(existingRaw);
        payload[source.keyField] = rowKey;
        payload.updated_at = new Date().toISOString();
        payload.data = sanitized;

        ['trainee', 'user_id', 'user', 'username', 'assessment', 'status', 'group', 'date', 'trainer', 'client_id', 'title'].forEach(field => {
            if (sanitized[field] !== undefined) payload[field] = sanitized[field];
        });

        return payload;
    },

    stripStudioFields(value) {
        if (Array.isArray(value)) {
            return value.map(item => this.stripStudioFields(item));
        }

        if (!value || typeof value !== 'object') {
            return value;
        }

        const cleaned = {};
        Object.entries(value).forEach(([key, item]) => {
            if (!key.startsWith('__')) {
                cleaned[key] = this.stripStudioFields(item);
            }
        });
        return cleaned;
    },

    sortRows(rows) {
        const copy = this.clone(rows);
        const dateFields = ['updated_at', 'created_at', 'timestamp', 'submitted_at', 'date', 'clock_in', 'time'];

        return copy.sort((a, b) => this.extractSortValue(b, dateFields) - this.extractSortValue(a, dateFields));
    },

    extractSortValue(row, candidates) {
        for (const field of candidates) {
            if (row && row[field]) {
                const parsed = new Date(row[field]).getTime();
                if (!Number.isNaN(parsed)) return parsed;
            }
        }

        if (row && typeof row.id === 'number') return row.id;
        return 0;
    },

    clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }
};

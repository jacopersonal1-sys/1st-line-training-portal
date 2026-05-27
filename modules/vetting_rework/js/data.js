/* ================= DATA ABSTRACTION LAYER ================= */

const DataService = {
    TABLE_PRIMARY: 'vetting_sessions_v2',
    TABLE_MIRROR: 'vetting_sessions',
    PENDING_KEY: 'vetting_rework_pending_ops',
    ENDED_KEY: 'vetting_arena_ended_sessions',
    RETRY_MS: 1000,
    retryTimer: null,

    normalizeIdentity: function(value) {
        let v = String(value || '').trim().toLowerCase();
        if (!v) return '';
        if (v.includes('@')) v = v.split('@')[0];
        v = v.replace(/[._-]+/g, ' ');
        v = v.replace(/\s+/g, ' ').trim();
        return v;
    },

    identitiesMatch: function(a, b) {
        const na = this.normalizeIdentity(a);
        const nb = this.normalizeIdentity(b);
        if (!na || !nb) return false;
        if (na === nb) return true;
        return na.replace(/\s+/g, '') === nb.replace(/\s+/g, '');
    },

    readJson: function(key, fallback) {
        if (typeof safeLocalParse === 'function') return safeLocalParse(key, fallback);
        try {
            const raw = localStorage.getItem(key);
            if (raw === null || raw === undefined || raw === '' || raw === 'undefined' || raw === 'null') return fallback;
            return JSON.parse(raw);
        } catch (error) {
            console.warn(`[Vetting Arena] Ignored invalid local data for ${key}:`, error);
            return fallback;
        }
    },

    readArray: function(key) {
        const value = this.readJson(key, []);
        return Array.isArray(value) ? value : [];
    },

    readObject: function(key) {
        const value = this.readJson(key, {});
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    },

    loadInitialData: async function() {
        if (!AppContext.supabase) return;
        const unwrap = (result) => result && result.status === 'fulfilled' ? result.value : null;
        const [testsRes, rostersRes, usersDocRes, usersRowsRes] = await Promise.allSettled([
            AppContext.supabase.from('app_documents').select('content').eq('key', 'tests').single(),
            AppContext.supabase.from('app_documents').select('content').eq('key', 'rosters').single(),
            AppContext.supabase.from('app_documents').select('content').eq('key', 'users').maybeSingle(),
            AppContext.supabase.from('users').select('data').limit(5000)
        ]);

        const tests = unwrap(testsRes);
        const rosters = unwrap(rostersRes);
        const usersDoc = unwrap(usersDocRes);
        const usersRows = unwrap(usersRowsRes);

        if (tests && tests.data) localStorage.setItem('tests', JSON.stringify(tests.data.content || []));
        if (rosters && rosters.data) localStorage.setItem('rosters', JSON.stringify(rosters.data.content || {}));

        const rowUsers = usersRows && Array.isArray(usersRows.data)
            ? usersRows.data.map(r => r && r.data).filter(Boolean)
            : [];
        const docUsers = usersDoc && usersDoc.data && Array.isArray(usersDoc.data.content) ? usersDoc.data.content : [];
        if (rowUsers.length || docUsers.length) localStorage.setItem('users', JSON.stringify(rowUsers.length ? rowUsers : docUsers));

        [tests, rosters].forEach((res, idx) => {
            if (res && res.error) console.warn(`[Vetting Arena] Failed to load ${idx === 0 ? 'tests' : 'rosters'}:`, res.error.message || res.error);
        });
        this.startRetryLoop();
        await this.flushPendingOps();
    },

    getTests: function() {
        return this.readArray('tests');
    },

    getRosters: function() {
        return this.readObject('rosters');
    },

    getUsers: function() {
        return this.readArray('users');
    },

    getUserIdentityCandidates: function(user) {
        if (!user || typeof user !== 'object') return [];
        const traineeData = user.traineeData || {};
        return [
            user.user,
            user.username,
            user.name,
            user.fullName,
            user.displayName,
            user.email,
            user.contact,
            traineeData.email,
            traineeData.contact,
            traineeData.phone
        ].map(v => String(v || '').trim()).filter(Boolean);
    },

    resolveTraineeUsername: function(candidate, users = this.getUsers()) {
        const raw = String(candidate || '').trim();
        if (!raw) return '';
        const trainees = (Array.isArray(users) ? users : [])
            .filter(u => String((u && u.role) || '').toLowerCase() === 'trainee');
        const exact = trainees.find(u => String(u.user || '').trim().toLowerCase() === raw.toLowerCase());
        if (exact && exact.user) return String(exact.user).trim();
        const mapped = trainees.find(u => this.getUserIdentityCandidates(u).some(alias => this.identitiesMatch(alias, raw)));
        return mapped && mapped.user ? String(mapped.user).trim() : raw;
    },

    resolveSessionTargets: function(session) {
        const rosters = this.getRosters();
        const users = this.getUsers();
        const trainees = users.filter(u => String((u && u.role) || '').toLowerCase() === 'trainee');
        const allUsernames = trainees.map(u => String(u.user || '').trim()).filter(Boolean);
        const targetCandidates = (!session || !session.targetGroup || session.targetGroup === 'all')
            ? allUsernames
            : (Array.isArray(rosters[session.targetGroup]) ? rosters[session.targetGroup] : []);

        const resolved = new Set();
        targetCandidates.forEach(candidate => {
            const username = this.resolveTraineeUsername(candidate, users);
            if (username) resolved.add(username);
        });
        return resolved;
    },

    getPendingOps: function() {
        return this.readArray(this.PENDING_KEY);
    },

    savePendingOps: function(ops) {
        localStorage.setItem(this.PENDING_KEY, JSON.stringify(ops || []));
    },

    getEndedSessionMap: function() {
        const ended = this.readObject(this.ENDED_KEY);
        const cutoff = Date.now() - (24 * 60 * 60 * 1000);
        let changed = false;
        Object.entries(ended).forEach(([id, endedAt]) => {
            if (!Number(endedAt) || Number(endedAt) < cutoff) {
                delete ended[id];
                changed = true;
            }
        });
        if (changed) localStorage.setItem(this.ENDED_KEY, JSON.stringify(ended));
        return ended;
    },

    markSessionEnded: function(sessionId) {
        if (!sessionId) return;
        const ended = this.getEndedSessionMap();
        ended[String(sessionId)] = Date.now();
        localStorage.setItem(this.ENDED_KEY, JSON.stringify(ended));
    },

    queueOp: function(op) {
        if (!op || !op.type) return;
        const ops = this.getPendingOps();
        const key = `${op.type}:${op.sessionId || ''}:${op.username || ''}`;
        const existingIdx = ops.findIndex(o => `${o.type}:${o.sessionId || ''}:${o.username || ''}` === key);
        if (existingIdx > -1) {
            ops[existingIdx] = { ...ops[existingIdx], ...op, updatedAt: Date.now() };
        } else {
            ops.push({ ...op, updatedAt: Date.now() });
        }
        this.savePendingOps(ops);
    },

    startRetryLoop: function() {
        if (this.retryTimer) return;
        this.retryTimer = setInterval(() => this.flushPendingOps(), this.RETRY_MS);
    },

    stopRetryLoop: function() {
        if (this.retryTimer) clearInterval(this.retryTimer);
        this.retryTimer = null;
    },

    flushPendingOps: async function() {
        if (!AppContext.supabase) return;
        const ops = this.getPendingOps();
        if (!ops.length) return;

        const keep = [];
        for (const op of ops) {
            try {
                if (op.type === 'upsert_session' && op.session) {
                    await this.upsertSessionToTables(op.session);
                } else if (op.type === 'delete_session' && op.sessionId) {
                    await this.deleteSessionFromTables(op.sessionId);
                } else if (op.type === 'patch_user' && op.sessionId && op.username && op.patchData) {
                    await this.patchSessionUserOnTables(op.sessionId, op.username, op.patchData);
                }
            } catch (e) {
                keep.push(op);
            }
        }
        this.savePendingOps(keep);
    },

    upsertSessionToTables: async function(session) {
        const payload = {
            id: session.sessionId,
            data: session,
            updated_at: new Date().toISOString()
        };

        for (const table of [this.TABLE_PRIMARY, this.TABLE_MIRROR]) {
            const { error } = await AppContext.supabase.from(table).upsert(payload);
            if (error) throw error;
        }
    },

    deleteSessionFromTables: async function(sessionId) {
        for (const table of [this.TABLE_PRIMARY, this.TABLE_MIRROR]) {
            const { error } = await AppContext.supabase.from(table).delete().eq('id', sessionId);
            if (error) throw error;
        }
    },

    patchSessionUserOnTables: async function(sessionId, username, patchData) {
        const patchOneTable = async (table) => {
            const { data, error } = await AppContext.supabase
                .from(table)
                .select('data')
                .eq('id', sessionId)
                .single();
            if (error || !data) throw error || new Error(`Missing session ${sessionId} in ${table}`);

            let serverSession = data.data || {};
            if (!serverSession.trainees) serverSession.trainees = {};

            // Robust key resolution: prefer existing alias key if it matches the username
            const existingKey = Object.keys(serverSession.trainees).find(k => this.identitiesMatch(k, username));
            const keyToUse = existingKey || username;

            serverSession.trainees[keyToUse] = {
                ...(serverSession.trainees[keyToUse] || {}),
                ...patchData
            };

            // Collapse alias keys into the canonical keyToUse to avoid split state across aliases
            Object.keys(serverSession.trainees).forEach(k => {
                if (k !== keyToUse && this.identitiesMatch(k, keyToUse)) {
                    serverSession.trainees[keyToUse] = { ...(serverSession.trainees[k] || {}), ...(serverSession.trainees[keyToUse] || {}) };
                    delete serverSession.trainees[k];
                }
            });

            const { error: updateErr } = await AppContext.supabase
                .from(table)
                .update({ data: serverSession, updated_at: new Date().toISOString() })
                .eq('id', sessionId);
            if (updateErr) throw updateErr;
        };

        await patchOneTable(this.TABLE_PRIMARY);
        await patchOneTable(this.TABLE_MIRROR);
    },

    // Nudge a single trainee by writing a pending_action into the sessions table.
    nudgeTrainee: async function(username, action) {
        if (!AppContext.supabase || !username || !action) return;
        try {
            const { error } = await AppContext.supabase.from('sessions').upsert({ username: username, role: 'trainee', pending_action: action, lastSeen: new Date().toISOString() });
            if (error) throw error;
        } catch (e) {
            try {
                const { error } = await AppContext.supabase.from('sessions').update({ pending_action: action, lastSeen: new Date().toISOString() }).eq('username', username);
                if (error) throw error;
            } catch (err) {
                console.warn(`[Vetting Arena] nudgeTrainee failed for ${username}`, err);
                throw err;
            }
        }
    },

    // --- VETTING SESSION SYNC ---
    pollSessions: async function() {
        if (!AppContext.supabase) return [];

        let hadError = false;
        const mergedById = {};

        const readTable = async (table) => {
            const { data, error } = await AppContext.supabase
                .from(table)
                .select('id,data,updated_at');
            if (error) {
                hadError = true;
                return [];
            }
            return Array.isArray(data) ? data : [];
        };

        const [primaryRows, mirrorRows] = await Promise.all([
            readTable(this.TABLE_PRIMARY),
            readTable(this.TABLE_MIRROR)
        ]);

        const pickLatestTrainee = (current, next, currentRowTs = 0, nextRowTs = 0) => {
            if (!current) return next;
            if (!next) return current;
            const currentTs = Date.parse(current.statusUpdatedAt || current.lastSeen || current.updatedAt || 0) || currentRowTs || 0;
            const nextTs = Date.parse(next.statusUpdatedAt || next.lastSeen || next.updatedAt || 0) || nextRowTs || 0;
            return nextTs >= currentTs ? { ...current, ...next } : { ...next, ...current };
        };

        [...primaryRows, ...mirrorRows].forEach(row => {
            if (!row?.data?.sessionId) return;
            const existing = mergedById[row.data.sessionId];
            const existingTs = existing?.updated_at ? new Date(existing.updated_at).getTime() : 0;
            const nextTs = row.updated_at ? new Date(row.updated_at).getTime() : 0;
            if (!existing) {
                mergedById[row.data.sessionId] = row;
                return;
            }

            const base = nextTs >= existingTs ? { ...row.data } : { ...existing.data };
            const mergedTrainees = { ...((existing.data && existing.data.trainees) || {}) };
            Object.entries((row.data && row.data.trainees) || {}).forEach(([username, statusData]) => {
                const matchingKey = Object.keys(mergedTrainees).find(key => this.identitiesMatch(key, username)) || username;
                mergedTrainees[matchingKey] = pickLatestTrainee(mergedTrainees[matchingKey], statusData, existingTs, nextTs);
            });
            base.trainees = mergedTrainees;
            mergedById[row.data.sessionId] = {
                ...((nextTs >= existingTs) ? row : existing),
                data: base,
                updated_at: new Date(Math.max(existingTs, nextTs)).toISOString()
            };
        });

        const endedSessions = this.getEndedSessionMap();
        let sessions = Object.values(mergedById)
            .map(row => row.data)
            .filter(session => session && session.active !== false && !endedSessions[String(session.sessionId || '')]);
        if (hadError && !sessions.length) {
            sessions = this.readArray('adminVettingSessions')
                .filter(session => session && session.active !== false && !endedSessions[String(session.sessionId || '')]);
        }

        localStorage.setItem('adminVettingSessions', JSON.stringify(sessions));
        return sessions;
    },

    ensureServerState: async function() {
        if (!AppContext.supabase) return;
        const activeSessions = this.readArray('adminVettingSessions');
        if (activeSessions.length === 0) return;

        // Fetch all IDs currently on server
        const { data, error } = await AppContext.supabase.from(this.TABLE_PRIMARY).select('id');
        if (error) return;
        const serverIds = new Set(data ? data.map(r => r.id) : []);

        for (const session of activeSessions) {
            if (!serverIds.has(session.sessionId)) {
                console.warn(`[Vetting Arena] Session ${session.sessionId} missing on primary table. Restoring...`);
                try {
                    await this.upsertSessionToTables(session);
                } catch (e) {
                    this.queueOp({ type: 'upsert_session', sessionId: session.sessionId, session });
                }
            }
        }
    },

    patchSessionUser: async function(sessionId, username, patchData) {
        const patch = {
            ...(patchData || {}),
            lastSeen: new Date().toISOString(),
            statusUpdatedAt: new Date().toISOString()
        };
        if (!AppContext.supabase) {
            this.queueOp({ type: 'patch_user', sessionId, username, patchData: patch });
            return;
        }

        try {
            await this.patchSessionUserOnTables(sessionId, username, patch);
        } catch (e) {
            console.warn("[Vetting Arena] patchSessionUser queued for retry:", e?.message || e);
            this.queueOp({ type: 'patch_user', sessionId, username, patchData: patch });
        }
    },

    saveSessionDirectly: async function(session) {
        // Also update local cache for immediate UI response
        let sessions = this.readArray('adminVettingSessions');
        const idx = sessions.findIndex(s => s.sessionId === session.sessionId);
        if (idx > -1) sessions[idx] = session;
        else sessions.push(session);
        localStorage.setItem('adminVettingSessions', JSON.stringify(sessions));

        if (!AppContext.supabase) {
            this.queueOp({ type: 'upsert_session', sessionId: session.sessionId, session });
            return false;
        }

        try {
            await this.upsertSessionToTables(session);
            return true;
        } catch (e) {
            console.warn("[Vetting Arena] saveSessionDirectly queued for retry:", e?.message || e);
            this.queueOp({ type: 'upsert_session', sessionId: session.sessionId, session });
            return false;
        }
    },

    deleteSession: async function(id) {
        this.markSessionEnded(id);
        // Also update local cache
        let sessions = this.readArray('adminVettingSessions');
        sessions = sessions.filter(s => s.sessionId !== id);
        localStorage.setItem('adminVettingSessions', JSON.stringify(sessions));

        if (!AppContext.supabase) {
            this.queueOp({ type: 'delete_session', sessionId: id });
            return false;
        }

        try {
            await this.deleteSessionFromTables(id);
            return true;
        } catch (e) {
            console.warn("[Vetting Arena] deleteSession queued for retry:", e?.message || e);
            this.queueOp({ type: 'delete_session', sessionId: id });
            return false;
        }
    },

    nudgeTraineesForSession: async function(session) {
        if (!AppContext.supabase || !session || !session.active) return;

        const resolvedTargets = this.resolveSessionTargets(session);

        if (!resolvedTargets.size) return;

        const nudgePayload = {
            sessionId: session.sessionId,
            active: true,
            testId: session.testId,
            targetGroup: session.targetGroup || 'all',
            startTime: session.startTime || Date.now(),
            trainees: {}
        };
        resolvedTargets.forEach(username => {
            nudgePayload.trainees[username] = { status: 'waiting' };
        });
        const action = `vetting_force:${encodeURIComponent(JSON.stringify(nudgePayload))}`;

        for (const username of resolvedTargets) {
            try {
                const { error } = await AppContext.supabase.from('sessions').upsert({
                    username,
                    role: 'trainee',
                    pending_action: action,
                    lastSeen: new Date().toISOString()
                });
                if (error) throw error;
            } catch (e) {
                try {
                    const { error } = await AppContext.supabase
                        .from('sessions')
                        .update({ pending_action: action, lastSeen: new Date().toISOString() })
                        .eq('username', username);
                    if (error) throw error;
                } catch (_) {}
            }
        }
    },

    nudgeTraineesForSessionEnd: async function(session) {
        if (!AppContext.supabase || !session) return;

        const resolvedTargets = this.resolveSessionTargets(session);
        if (!resolvedTargets.size) return;

        const action = `vetting_end:${encodeURIComponent(String(session.sessionId || ''))}`;
        for (const username of resolvedTargets) {
            try {
                await this.nudgeTrainee(username, action);
            } catch (e) {
                // Ending the session must continue even if one trainee nudge fails.
            }
        }
    },

    // --- REALTIME SUBSCRIPTION ---
    setupRealtime: function(onUpdateCallback) {
        if (!AppContext.supabase) return () => {};
        const channel = AppContext.supabase.channel('vetting_rework_v2')
            .on('postgres_changes', { event: '*', schema: 'public', table: this.TABLE_PRIMARY }, payload => {
                onUpdateCallback(payload);
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: this.TABLE_MIRROR }, payload => {
                onUpdateCallback(payload);
            })
            .subscribe();
        return () => { try { channel.unsubscribe(); } catch (e) {} };
    }
};

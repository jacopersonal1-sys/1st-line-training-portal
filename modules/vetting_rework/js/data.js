/* ================= DATA ABSTRACTION LAYER ================= */

const DataService = {
    TABLE_PRIMARY: 'vetting_sessions_v2',
    TABLE_MIRROR: 'vetting_sessions',
    PENDING_KEY: 'vetting_rework_pending_ops',
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

    loadInitialData: async function() {
        if (!AppContext.supabase) return;
        try {
            const [testsRes, rostersRes] = await Promise.all([
                AppContext.supabase.from('app_documents').select('content').eq('key', 'tests').single(),
                AppContext.supabase.from('app_documents').select('content').eq('key', 'rosters').single()
            ]);
            if (testsRes.data) localStorage.setItem('tests', JSON.stringify(testsRes.data.content || []));
            if (rostersRes.data) localStorage.setItem('rosters', JSON.stringify(rostersRes.data.content || {}));
        } catch (e) {
            console.error("Sandbox Initialization Error:", e);
        }
        this.startRetryLoop();
        await this.flushPendingOps();
    },

    getTests: function() {
        return JSON.parse(localStorage.getItem('tests') || '[]');
    },

    getRosters: function() {
        return JSON.parse(localStorage.getItem('rosters') || '{}');
    },

    getPendingOps: function() {
        try {
            return JSON.parse(localStorage.getItem(this.PENDING_KEY) || '[]');
        } catch (e) {
            return [];
        }
    },

    savePendingOps: function(ops) {
        localStorage.setItem(this.PENDING_KEY, JSON.stringify(ops || []));
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

        await AppContext.supabase.from(this.TABLE_PRIMARY).upsert(payload);
        await AppContext.supabase.from(this.TABLE_MIRROR).upsert(payload);
    },

    deleteSessionFromTables: async function(sessionId) {
        await AppContext.supabase.from(this.TABLE_PRIMARY).delete().eq('id', sessionId);
        await AppContext.supabase.from(this.TABLE_MIRROR).delete().eq('id', sessionId);
    },

    patchSessionUserOnTables: async function(sessionId, username, patchData) {
        const patchOneTable = async (table) => {
            const { data, error } = await AppContext.supabase
                .from(table)
                .select('data')
                .eq('id', sessionId)
                .single();
            if (error || !data) throw error || new Error(`Missing session ${sessionId} in ${table}`);

            const serverSession = data.data || {};
            if (!serverSession.trainees) serverSession.trainees = {};
            serverSession.trainees[username] = {
                ...(serverSession.trainees[username] || {}),
                ...patchData
            };

            const { error: updateErr } = await AppContext.supabase
                .from(table)
                .update({ data: serverSession, updated_at: new Date().toISOString() })
                .eq('id', sessionId);
            if (updateErr) throw updateErr;
        };

        await patchOneTable(this.TABLE_PRIMARY);
        await patchOneTable(this.TABLE_MIRROR);
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

        [...primaryRows, ...mirrorRows].forEach(row => {
            if (!row?.data?.sessionId || !row.data.active) return;
            const existing = mergedById[row.data.sessionId];
            const existingTs = existing?.updated_at ? new Date(existing.updated_at).getTime() : 0;
            const nextTs = row.updated_at ? new Date(row.updated_at).getTime() : 0;
            if (!existing || nextTs >= existingTs) mergedById[row.data.sessionId] = row;
        });

        let sessions = Object.values(mergedById).map(row => row.data);
        if (hadError && !sessions.length) {
            sessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
        }

        localStorage.setItem('adminVettingSessions', JSON.stringify(sessions));
        return sessions;
    },

    ensureServerState: async function() {
        if (!AppContext.supabase) return;
        const activeSessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
        if (activeSessions.length === 0) return;

        // Fetch all IDs currently on server
        const { data, error } = await AppContext.supabase.from(this.TABLE_PRIMARY).select('id');
        if (error) return;
        const serverIds = new Set(data ? data.map(r => r.id) : []);

        for (const session of activeSessions) {
            if (!serverIds.has(session.sessionId)) {
                console.warn(`[Vetting Rework] Session ${session.sessionId} missing on primary table. Restoring...`);
                try {
                    await this.upsertSessionToTables(session);
                } catch (e) {
                    this.queueOp({ type: 'upsert_session', sessionId: session.sessionId, session });
                }
            }
        }
    },

    patchSessionUser: async function(sessionId, username, patchData) {
        if (!AppContext.supabase) {
            this.queueOp({ type: 'patch_user', sessionId, username, patchData });
            return;
        }

        try {
            await this.patchSessionUserOnTables(sessionId, username, patchData);
        } catch (e) {
            console.warn("[Vetting Rework] patchSessionUser queued for retry:", e?.message || e);
            this.queueOp({ type: 'patch_user', sessionId, username, patchData });
        }
    },

    saveSessionDirectly: async function(session) {
        // Also update local cache for immediate UI response
        let sessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
        const idx = sessions.findIndex(s => s.sessionId === session.sessionId);
        if (idx > -1) sessions[idx] = session;
        else sessions.push(session);
        localStorage.setItem('adminVettingSessions', JSON.stringify(sessions));

        if (!AppContext.supabase) {
            this.queueOp({ type: 'upsert_session', sessionId: session.sessionId, session });
            return;
        }

        try {
            await this.upsertSessionToTables(session);
        } catch (e) {
            console.warn("[Vetting Rework] saveSessionDirectly queued for retry:", e?.message || e);
            this.queueOp({ type: 'upsert_session', sessionId: session.sessionId, session });
        }
    },

    deleteSession: async function(id) {
        // Also update local cache
        let sessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
        sessions = sessions.filter(s => s.sessionId !== id);
        localStorage.setItem('adminVettingSessions', JSON.stringify(sessions));

        if (!AppContext.supabase) {
            this.queueOp({ type: 'delete_session', sessionId: id });
            return;
        }

        try {
            await this.deleteSessionFromTables(id);
        } catch (e) {
            console.warn("[Vetting Rework] deleteSession queued for retry:", e?.message || e);
            this.queueOp({ type: 'delete_session', sessionId: id });
        }
    },

    nudgeTraineesForSession: async function(session) {
        if (!AppContext.supabase || !session || !session.active) return;

        const rosters = this.getRosters();
        const users = JSON.parse(localStorage.getItem('users') || '[]');

        const allTraineeUsers = (Array.isArray(users) ? users : [])
            .filter(u => String((u && u.role) || '').toLowerCase() === 'trainee')
            .map(u => String(u.user || '').trim())
            .filter(Boolean);

        let targetCandidates = [];
        if (!session.targetGroup || session.targetGroup === 'all') {
            targetCandidates = allTraineeUsers;
        } else {
            targetCandidates = Array.isArray(rosters[session.targetGroup]) ? rosters[session.targetGroup] : [];
        }

        const resolvedTargets = new Set();
        targetCandidates.forEach(candidate => {
            const exact = allTraineeUsers.find(u => String(u).toLowerCase() === String(candidate || '').toLowerCase());
            if (exact) {
                resolvedTargets.add(exact);
                return;
            }
            const mapped = allTraineeUsers.find(u => this.identitiesMatch(u, candidate));
            if (mapped) resolvedTargets.add(mapped);
        });

        if (!resolvedTargets.size) return;

        const nudgePayload = {
            sessionId: session.sessionId,
            active: true,
            testId: session.testId,
            targetGroup: session.targetGroup || 'all',
            startTime: session.startTime || Date.now(),
            trainees: {}
        };
        const action = `vetting_force:${encodeURIComponent(JSON.stringify(nudgePayload))}`;

        for (const username of resolvedTargets) {
            try {
                await AppContext.supabase.from('sessions').upsert({
                    username,
                    role: 'trainee',
                    pending_action: action,
                    lastSeen: new Date().toISOString()
                });
            } catch (e) {
                try {
                    await AppContext.supabase
                        .from('sessions')
                        .update({ pending_action: action, lastSeen: new Date().toISOString() })
                        .eq('username', username);
                } catch (_) {}
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

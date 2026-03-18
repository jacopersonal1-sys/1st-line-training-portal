/* ================= DATA ABSTRACTION LAYER ================= */

const DataService = {
    loadInitialData: async function() {
        if (!AppContext.supabase) return;
        try {
            const [testsRes, rostersRes] = await Promise.all([
                AppContext.supabase.from('app_documents').select('content').eq('key', 'tests').single(),
                AppContext.supabase.from('app_documents').select('content').eq('key', 'rosters').single()
            ]);
            if (testsRes.data) localStorage.setItem('tests', JSON.stringify(testsRes.data.content || []));
            if (rostersRes.data) localStorage.setItem('rosters', JSON.stringify(rostersRes.data.content || {}));
        } catch(e) {
            console.error("Sandbox Initialization Error:", e);
        }
    },

    getTests: function() {
        return JSON.parse(localStorage.getItem('tests') || '[]');
    },
    
    getRosters: function() {
        return JSON.parse(localStorage.getItem('rosters') || '{}');
    },

    // --- VETTING SESSION SYNC ---
    pollSessions: async function() {
        if (!AppContext.supabase) return [];
        const { data, error } = await AppContext.supabase.from('vetting_sessions_v2').select('data');
        if (error) { console.error("Poll sessions error:", error); return []; }
        const sessions = data.map(r => r.data).filter(s => s && s.active);
        localStorage.setItem('adminVettingSessions', JSON.stringify(sessions));
        return sessions;
    },

    ensureServerState: async function() {
        if (!AppContext.supabase) return;
        const activeSessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
        if (activeSessions.length === 0) return;

        // Fetch all IDs currently on server
        const { data, error } = await AppContext.supabase.from('vetting_sessions_v2').select('id');
        const serverIds = new Set(data ? data.map(r => r.id) : []);

        for (const session of activeSessions) {
            if (!serverIds.has(session.sessionId)) {
                console.warn(`[Vetting Rework] Session ${session.sessionId} missing on server. Restoring...`);
                await this.saveSessionDirectly(session);
            }
        }
    },

    patchSessionUser: async function(sessionId, username, patchData) {
        if (!AppContext.supabase) return;
        
        // 1. Fetch latest server state atomically
        const { data, error } = await AppContext.supabase
            .from('vetting_sessions_v2')
            .select('data')
            .eq('id', sessionId)
            .single();
            
        if (error || !data) return;
        
        const serverSession = data.data;
        if (!serverSession.trainees) serverSession.trainees = {};
        
        // 2. Merge ONLY this specific user's data to prevent wiping other changes
        serverSession.trainees[username] = { ...(serverSession.trainees[username] || {}), ...patchData };
        
        // 3. Save back
        await AppContext.supabase.from('vetting_sessions_v2').update({ data: serverSession, updated_at: new Date().toISOString() }).eq('id', sessionId);
    },

    saveSessionDirectly: async function(session) {
        // Also update local cache for immediate UI response
        let sessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
        const idx = sessions.findIndex(s => s.sessionId === session.sessionId);
        if (idx > -1) sessions[idx] = session;
        else sessions.push(session);
        localStorage.setItem('adminVettingSessions', JSON.stringify(sessions));

        if (!AppContext.supabase) return;
        const { error } = await AppContext.supabase.from('vetting_sessions_v2').upsert({
            id: session.sessionId,
            data: session,
            updated_at: new Date().toISOString()
        });
        if (error) console.error("Save session error:", error);
    },

    deleteSession: async function(id) {
        // Also update local cache
        let sessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
        sessions = sessions.filter(s => s.sessionId !== id);
        localStorage.setItem('adminVettingSessions', JSON.stringify(sessions));

        if (!AppContext.supabase) return;
        const { error } = await AppContext.supabase.from('vetting_sessions_v2').delete().eq('id', id);
        if (error) console.error("Delete session error:", error);
    },

    // --- REALTIME SUBSCRIPTION ---
    setupRealtime: function(onUpdateCallback) {
        if (!AppContext.supabase) return () => {};
        const channel = AppContext.supabase.channel('vetting_rework_v2')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'vetting_sessions_v2' }, payload => {
                onUpdateCallback(payload);
            })
            .subscribe();
        return () => { try { channel.unsubscribe(); } catch(e){} };
    }
};
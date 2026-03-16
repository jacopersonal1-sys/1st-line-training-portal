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
        // ISOLATED SANDBOX: We do NOT poll the live database to protect real trainees.
        // We only read from the isolated webview localStorage.
        return JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
    },

    saveSessionDirectly: async function(session) {
        // ISOLATED SANDBOX: Save to local partition only. No Cloud DB writes.
        // This ensures your clicks don't overwrite live environments.
        let sessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
        const idx = sessions.findIndex(s => s.sessionId === session.sessionId);
        if (idx > -1) sessions[idx] = session;
        else sessions.push(session);
        localStorage.setItem('adminVettingSessions', JSON.stringify(sessions));
    },

    deleteSession: async function(id) {
        // ISOLATED SANDBOX: Delete locally only.
        let sessions = JSON.parse(localStorage.getItem('adminVettingSessions') || '[]');
        sessions = sessions.filter(s => s.sessionId !== id);
        localStorage.setItem('adminVettingSessions', JSON.stringify(sessions));
    },

    // --- REALTIME SUBSCRIPTION ---
    setupRealtime: function(onUpdateCallback) {
        // ISOLATED SANDBOX: Realtime disabled so live trainees don't trigger UI updates here.
        return () => {};
    }
};
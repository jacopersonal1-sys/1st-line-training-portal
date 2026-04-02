/* ================= MODULE DATA LAYER ================= */
/* Handles LocalStorage and Cloud Sync for Team Projects */

const DataService = {
    // --- NEW: DATA FETCHER ---
    loadInitialData: async function() {
        if (!AppContext.supabase) return;
        
        console.log("[Team Hub] Fetching initial data from cloud...");
        
        // Fetch all required data blobs in parallel
        const [users, taskSubs, personalLists, backendData, agentFeedback] = await Promise.all([
            AppContext.supabase.from('app_documents').select('content').eq('key', 'users').single(),
            AppContext.supabase.from('app_documents').select('content').eq('key', 'tl_task_submissions').single(),
            AppContext.supabase.from('app_documents').select('content').eq('key', 'tl_personal_lists').single(),
            AppContext.supabase.from('app_documents').select('content').eq('key', 'tl_backend_data').single(),
            AppContext.supabase.from('app_documents').select('content').eq('key', 'tl_agent_feedback').single()
        ]);

        if (users.data) localStorage.setItem('users', JSON.stringify(users.data.content || []));
        if (taskSubs.data) localStorage.setItem('tl_task_submissions', JSON.stringify(taskSubs.data.content || []));
        if (personalLists.data) localStorage.setItem('tl_personal_lists', JSON.stringify(personalLists.data.content || {}));
        if (backendData.data) localStorage.setItem('tl_backend_data', JSON.stringify(backendData.data.content || {}));
        if (agentFeedback.data) localStorage.setItem('tl_agent_feedback', JSON.stringify(agentFeedback.data.content || []));
    },
    
    // Get Submission for specific date
    getSubmission: function(date) {
        if (!AppContext.user) return null;
        const submissions = JSON.parse(localStorage.getItem('tl_task_submissions') || '[]');
        return submissions.find(s => s.user === AppContext.user.user && s.date === date) || { data: {} };
    },

    // Save Submission (Local + Cloud)
    saveSubmission: function(date, data) {
        if (!AppContext.user) return;
        const submissions = JSON.parse(localStorage.getItem('tl_task_submissions') || '[]');
        const idx = submissions.findIndex(s => s.user === AppContext.user.user && s.date === date);

        const payload = {
            id: (idx > -1) ? submissions[idx].id : Date.now() + "_" + Math.random().toString(36).substr(2, 9),
            user: AppContext.user.user,
            date: date,
            lastUpdated: new Date().toISOString(),
            data: data
        };

        if (idx > -1) submissions[idx] = payload;
        else submissions.push(payload);

        localStorage.setItem('tl_task_submissions', JSON.stringify(submissions));
        this.syncTable('tl_task_submissions', submissions);
    },

    // Get Personal Roster
    getMyTeam: function() {
        if (!AppContext.user) return [];
        const lists = JSON.parse(localStorage.getItem('tl_personal_lists') || '{}');
        const list = lists[AppContext.user.user] || [];
        
        // Normalize legacy strings to objects with default role
        return list.map(item => (typeof item === 'string') ? { name: item, role: 'First Line Agent' } : item);
    },

    // Save Personal Roster
    saveMyTeam: function(teamList) {
        if (!AppContext.user) return;
        const lists = JSON.parse(localStorage.getItem('tl_personal_lists') || '{}');
        lists[AppContext.user.user] = teamList;
        localStorage.setItem('tl_personal_lists', JSON.stringify(lists));
        this.syncTable('tl_personal_lists', lists);
    },

    // --- BACKEND DATA (CONFIG) ---
    getBackendData: function() {
        const parsed = JSON.parse(localStorage.getItem('tl_backend_data') || '{}');
        if (!Array.isArray(parsed.outage_areas)) parsed.outage_areas = [];
        if (!Array.isArray(parsed.bottleneck_types)) parsed.bottleneck_types = [];
        if (!Array.isArray(parsed.feedback_questions)) parsed.feedback_questions = [];
        parsed.feedback_questions = parsed.feedback_questions.map((question, index) => {
            if (typeof question === 'string') {
                return {
                    id: `fq_legacy_${index}`,
                    text: question,
                    linkTarget: 'All Tickets'
                };
            }
            return {
                id: question.id || `fq_${index}`,
                text: question.text || '',
                linkTarget: question.linkTarget || question.problemStatement || 'All Tickets'
            };
        });
        return parsed;
    },

    saveBackendData: function(data) {
        if (!AppContext.user) return;
        localStorage.setItem('tl_backend_data', JSON.stringify(data));
        this.syncTable('tl_backend_data', data);
    },

    // --- AGENT FEEDBACK LOGS ---
    getAgentFeedback: function() {
        return JSON.parse(localStorage.getItem('tl_agent_feedback') || '[]');
    },

    saveAgentFeedback: function(data) {
        if (!AppContext.user) return;
        localStorage.setItem('tl_agent_feedback', JSON.stringify(data));
        this.syncTable('tl_agent_feedback', data);
    },

    // --- INTERNAL SYNC HELPER ---
    // Mimics the main app's saveToServer for BLOB data
    syncTable: async function(table, data) {
        if (!AppContext.supabase) return; // Offline mode
        
        try {
            const { error } = await AppContext.supabase.from('app_documents').upsert({
                key: table,
                content: data,
                updated_at: new Date().toISOString()
            });
            if (error) throw error;
        } catch (e) { console.error(`[Module Sync] Failed to sync ${table}:`, e); }
    }
};

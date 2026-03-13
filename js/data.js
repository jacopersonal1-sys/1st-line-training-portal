/* ================= MODULE DATA LAYER ================= */
/* Handles LocalStorage and Cloud Sync for Team Projects */

const DataService = {
    
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
        return lists[AppContext.user.user] || [];
    },

    // Save Personal Roster
    saveMyTeam: function(teamList) {
        if (!AppContext.user) return;
        const lists = JSON.parse(localStorage.getItem('tl_personal_lists') || '{}');
        lists[AppContext.user.user] = teamList;
        localStorage.setItem('tl_personal_lists', JSON.stringify(lists));
        this.syncTable('tl_personal_lists', lists);
    },

    // --- INTERNAL SYNC HELPER ---
    // Mimics the main app's saveToServer but simplified for this module
    syncTable: async function(table, data) {
        if (!AppContext.supabase) return; // Offline mode
        // We save the whole object for 'tl_personal_lists' (Blob) and rows for 'tl_task_submissions'
        // For now, let's just attempt a basic upsert if it's rows
        // NOTE: In main app logic, these tables are handled differently. 
        // This is a placeholder for the full sync logic which we can port if needed.
        // For this step, local persistence + console log is sufficient proof of concept.
        console.log(`[Module Sync] Syncing ${table}... (Supabase Connected: ${!!AppContext.supabase})`);
    }
};
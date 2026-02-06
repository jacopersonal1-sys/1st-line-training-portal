/* ================= FORMS, QUESTIONNAIRES & EXEMPTIONS ================= */

// --- HELPER: ASYNC SAVE ---
// Ensures that profile data and exemptions are physically written to disk (Supabase)
// before the UI proceeds.
async function secureFormSave() {
    // MODIFIED: Removed 'autoBackup' check.
    // Profile data (Questionnaires) and Admin Exemptions are critical state changes.
    // They must always be synced to the cloud immediately to prevent data loss or state loops.
    // UPDATED: Uses force=true to ensure authoritative overwrite (Instant Save).
    if (typeof saveToServer === 'function') {
        try {
            // PARAMETER 'true' = FORCE OVERWRITE
            await saveToServer(true);
        } catch(e) {
            console.error("Form Cloud Sync Error:", e);
        }
    }
}

/**
 * 1. FIRST-TIME SETUP (QUESTIONNAIRE)
 * Logic: Checks if a trainee has provided their contact details and 
 * prior knowledge background. Triggers on their very first login.
 */
function checkQuestionnaire() {
    if (!CURRENT_USER || CURRENT_USER.role !== 'trainee') return;

    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const me = users.find(u => u.user === CURRENT_USER.user);

    // If traineeData object is missing from the user record, open the modal
    if (me && (!me.traineeData || !me.hasFilledQuestionnaire)) {
        const modal = document.getElementById('questionnaireModal');
        if(modal) modal.classList.remove('hidden');
    }
}

// UPDATED: Async Save with Visual Feedback
async function saveQuestionnaire() {
    const contact = document.getElementById('questContact').value.trim();
    const knowledge = document.getElementById('questKnowledge').value.trim();

    if (!contact || !knowledge) {
        return alert("Please complete both fields to finalize your profile.");
    }

    // RELOAD USERS to ensure we have the latest list before modifying
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const idx = users.findIndex(u => u.user === CURRENT_USER.user);

    if (idx > -1) {
        // 1. Save the Data Object
        users[idx].traineeData = {
            contact: contact,
            knowledge: knowledge,
            completedDate: new Date().toISOString()
        };

        // 2. EXPLICITLY SET THE FLAG (Fixes the pop-up loop)
        users[idx].hasFilledQuestionnaire = true;

        localStorage.setItem('users', JSON.stringify(users));
        
        // 3. Sync the current session so the badge/UI updates immediately
        CURRENT_USER.traineeData = users[idx].traineeData;
        CURRENT_USER.hasFilledQuestionnaire = true;
        sessionStorage.setItem('currentUser', JSON.stringify(CURRENT_USER));

        // --- SECURE SAVE START ---
        // Give visual feedback to the user so they know it's working
        const btn = document.activeElement; 
        let originalText = "";
        if(btn && btn.tagName === 'BUTTON') {
            originalText = btn.innerText;
            btn.innerText = "Saving Profile...";
            btn.disabled = true;
        }

        // Wait for the server to confirm receipt (Instant Mode)
        await secureFormSave();

        if(btn && btn.tagName === 'BUTTON') {
            btn.innerText = originalText;
            btn.disabled = false;
        }
        // --- SECURE SAVE END ---
        
        if(typeof showToast === 'function') showToast("Profile saved. You may now start your assessments.", "success");
        document.getElementById('questionnaireModal').classList.add('hidden');
    }
}

/**
 * 3. EXEMPTION STATUS CHECKER
 */
function isExempt(traineeName, assessmentName) {
    const exemptions = JSON.parse(localStorage.getItem('exemptions') || '[]');
    return exemptions.some(e => 
        e.trainee.toLowerCase() === traineeName.toLowerCase() && 
        e.assessment === assessmentName
    );
}

/**
 * 4. DATA RETRIEVAL HELPERS
 */
function getTraineePersonalData(username) {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const user = users.find(u => u.user === username);
    return user ? (user.traineeData || null) : null;
}
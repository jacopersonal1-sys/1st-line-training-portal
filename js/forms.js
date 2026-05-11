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
            // Only sync the key this module mutates to avoid pushing stale shared blobs.
            await saveToServer(['users'], true);
        } catch(e) {
            console.error("Form Cloud Sync Error:", e);
        }
    }
}

function getQuestionnaireIdentity(value) {
    let v = String(value || '').trim().toLowerCase();
    if (!v) return '';
    if (v.includes('@')) v = v.split('@')[0];
    return v.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\s+/g, '');
}

function getCurrentQuestionnaireUser(usersInput) {
    const users = Array.isArray(usersInput) ? usersInput : JSON.parse(localStorage.getItem('users') || '[]');
    const currentToken = getQuestionnaireIdentity(CURRENT_USER && CURRENT_USER.user);
    const idx = users.findIndex(u => getQuestionnaireIdentity(u && (u.user || u.username)) === currentToken);
    return { users, idx, user: idx > -1 ? users[idx] : null };
}

function isTraineeQuestionnaireComplete(user) {
    if (!user || String(user.role || '').trim().toLowerCase() !== 'trainee') return true;
    if (user.hasFilledQuestionnaire === true) return true;
    const data = user.traineeData && typeof user.traineeData === 'object' ? user.traineeData : {};
    return !!(
        String(data.email || '').trim() &&
        String(data.phone || '').trim() &&
        String(data.office || '').trim() &&
        String(data.knowledge || '').trim()
    );
}

function syncCurrentQuestionnaireSession(user) {
    if (!user || !CURRENT_USER) return;
    CURRENT_USER.traineeData = user.traineeData || CURRENT_USER.traineeData || {};
    CURRENT_USER.hasFilledQuestionnaire = user.hasFilledQuestionnaire === true || isTraineeQuestionnaireComplete(user);
    window.CURRENT_USER = CURRENT_USER;
    sessionStorage.setItem('currentUser', JSON.stringify(CURRENT_USER));
    if (typeof persistAppSession === 'function') persistAppSession(CURRENT_USER);
}

/**
 * 1. FIRST-TIME SETUP (QUESTIONNAIRE)
 * Logic: Checks if a trainee has provided their contact details and 
 * prior knowledge background. Triggers on their very first login.
 */
function checkQuestionnaire() {
    if (!CURRENT_USER || CURRENT_USER.role !== 'trainee') return;

    const { users, idx, user: me } = getCurrentQuestionnaireUser();
    if (me && isTraineeQuestionnaireComplete(me)) {
        if (me.hasFilledQuestionnaire !== true && idx > -1) {
            users[idx].hasFilledQuestionnaire = true;
            localStorage.setItem('users', JSON.stringify(users));
            secureFormSave();
        }
        syncCurrentQuestionnaireSession(users[idx] || me);
        return;
    }

    // If traineeData object is missing from the user record, open the modal
    if (me && (!me.traineeData || !me.hasFilledQuestionnaire)) {
        const modal = document.getElementById('questionnaireModal');
        if(modal) {
            populateQuestionnaireOfficeOptions();
            modal.classList.remove('hidden');
        }
    }
}

function populateQuestionnaireOfficeOptions() {
    const select = document.getElementById('questOffice');
    if (!select) return;
    const esc = (value) => String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const options = (typeof getTrainingOfficeOptions === 'function')
        ? getTrainingOfficeOptions()
        : ['Head Office', 'Regional Office', 'Remote'];
    const clean = Array.from(new Set((options || []).map(v => String(v || '').trim()).filter(Boolean)));
    select.innerHTML = '<option value="">-- Select Office --</option>' + clean.map(office => `<option value="${esc(office)}">${esc(office)}</option>`).join('');
}

// UPDATED: Async Save with Visual Feedback
async function saveQuestionnaire() {
    const email = document.getElementById('questEmail').value.trim();
    const phone = document.getElementById('questPhone').value.trim();
    const office = document.getElementById('questOffice') ? document.getElementById('questOffice').value.trim() : '';
    const knowledge = document.getElementById('questKnowledge').value.trim();

    if (!email || !phone || !office || !knowledge) {
        return alert("Please complete all fields to finalize your profile.");
    }

    // RELOAD USERS to ensure we have the latest list before modifying
    const { users, idx } = getCurrentQuestionnaireUser();

    if (idx > -1) {
        // 1. Save the Data Object
        users[idx].traineeData = {
            email: email,
            phone: phone,
            office: office,
            contact: `${email} | ${phone}`, // Backward compatibility
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
        if (typeof persistAppSession === 'function') persistAppSession(CURRENT_USER);

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

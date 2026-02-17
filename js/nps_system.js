/* ================= NPS RATING SYSTEM ================= */
/* Handles creation, display, and recording of Net Promoter Score (NPS) surveys */

const NPSSystem = {
    // --- CONFIGURATION ---
    checkInterval: null,

    init: function() {
        // Check for pending surveys every minute
        if (this.checkInterval) clearInterval(this.checkInterval);
        this.checkInterval = setInterval(() => this.checkForSurveys(), 60000);
        
        // Also check immediately on load
        setTimeout(() => this.checkForSurveys(), 2000);
    },

    // --- CORE LOGIC ---
    checkForSurveys: function() {
        if (!CURRENT_USER || CURRENT_USER.role !== 'trainee') return;

        const surveys = JSON.parse(localStorage.getItem('nps_surveys') || '[]');
        const responses = JSON.parse(localStorage.getItem('nps_responses') || '[]');
        
        // Find active surveys that haven't been answered by this user
        const pending = surveys.filter(s => {
            if (!s.active) return false;
            
            // Check if already answered
            const hasAnswered = responses.some(r => r.surveyId === s.id && r.user === CURRENT_USER.user);
            if (hasAnswered) return false;

            // Check Trigger Condition
            if (s.triggerType === 'time') {
                const now = new Date();
                const triggerTime = new Date(s.triggerTime);
                return now >= triggerTime;
            } 
            // 'completion' triggers are handled by specific events (e.g. submitTest)
            return false;
        });

        if (pending.length > 0) {
            // Show the first pending survey
            this.showSurveyModal(pending[0]);
        }
    },

    triggerCompletionSurvey: function(contextType, contextId) {
        if (!CURRENT_USER || CURRENT_USER.role !== 'trainee') return;

        const surveys = JSON.parse(localStorage.getItem('nps_surveys') || '[]');
        const responses = JSON.parse(localStorage.getItem('nps_responses') || '[]');

        const target = surveys.find(s => 
            s.active && 
            s.triggerType === 'completion' && 
            s.contextType === contextType && 
            s.contextId === contextId
        );

        if (target) {
            const hasAnswered = responses.some(r => r.surveyId === target.id && r.user === CURRENT_USER.user);
            if (!hasAnswered) {
                this.showSurveyModal(target);
            }
        }
    },

    // --- UI RENDERING ---
    showSurveyModal: function(survey) {
        // Prevent stacking
        if (document.getElementById('npsModal')) return;

        const div = document.createElement('div');
        div.id = 'npsModal';
        div.className = 'modal-overlay';
        div.style.zIndex = '6000'; // High z-index for mandatory feel
        div.style.background = 'rgba(0,0,0,0.85)';
        
        div.innerHTML = `
            <div class="modal-box" style="max-width:500px; text-align:center; border-top:5px solid var(--primary); animation: modalPop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);">
                <h3 style="margin-top:0; color:var(--primary);"><i class="fas fa-star"></i> Feedback Required</h3>
                <p style="font-size:1.1rem; margin-bottom:20px;">${survey.question}</p>
                <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:15px;">
                    Topic: <strong>${survey.contextName}</strong>
                </div>
                
                <div style="display:flex; justify-content:center; gap:5px; margin-bottom:20px;">
                    ${Array.from({length: 10}, (_, i) => i + 1).map(n => `
                        <button class="btn-nps" onclick="NPSSystem.selectRating(this, )" style="width:35px; height:35px; border-radius:50%; border:1px solid var(--border-color); background:var(--bg-input); color:var(--text-main); cursor:pointer; transition:0.2s;"></button>
                    `).join('')}
                </div>
                
                <div style="display:flex; justify-content:space-between; font-size:0.7rem; color:var(--text-muted); margin-bottom:20px; padding:0 20px;">
                    <span>Not Likely</span>
                    <span>Extremely Likely</span>
                </div>

                <textarea id="npsComment" placeholder="Optional: Tell us more..." style="width:100%; height:60px; margin-bottom:15px; font-size:0.9rem;"></textarea>
                
                <button id="btnSubmitNPS" class="btn-primary" disabled onclick="NPSSystem.submitResponse('${survey.id}')" style="width:100%; opacity:0.5; cursor:not-allowed;">Submit Feedback</button>
            </div>
        `;
        
        document.body.appendChild(div);
    },

    selectRating: function(btn, rating) {
        // Visual selection
        document.querySelectorAll('.btn-nps').forEach(b => {
            b.style.background = 'var(--bg-input)';
            b.style.color = 'var(--text-main)';
            b.style.borderColor = 'var(--border-color)';
            b.style.transform = 'scale(1)';
        });
        
        // Color scale
        let color = '#ff5252'; // 1-6 Detractor
        if (rating >= 9) color = '#2ecc71'; // 9-10 Promoter
        else if (rating >= 7) color = '#f1c40f'; // 7-8 Passive

        btn.style.background = color;
        btn.style.color = '#fff';
        btn.style.borderColor = color;
        btn.style.transform = 'scale(1.2)';
        
        // Enable submit
        const submitBtn = document.getElementById('btnSubmitNPS');
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        submitBtn.style.cursor = 'pointer';
        submitBtn.dataset.rating = rating;
    },

    submitResponse: async function(surveyId) {
        const btn = document.getElementById('btnSubmitNPS');
        const rating = parseInt(btn.dataset.rating);
        const comment = document.getElementById('npsComment').value;
        
        const response = {
            id: Date.now().toString(),
            surveyId: surveyId,
            user: CURRENT_USER.user,
            rating: rating,
            comment: comment,
            date: new Date().toISOString()
        };
        
        const responses = JSON.parse(localStorage.getItem('nps_responses') || '[]');
        responses.push(response);
        localStorage.setItem('nps_responses', JSON.stringify(responses));
        
        // Force Sync
        if (typeof saveToServer === 'function') await saveToServer(['nps_responses'], false);
        
        document.getElementById('npsModal').remove();
        if (typeof showToast === 'function') showToast("Thank you for your feedback!", "success");
    }
};

// --- ADMIN CONTROL PANEL ---

NPSSystem.renderAdminPanel = function() {
    const container = document.getElementById('npsConfigContainer');
    if (!container) return;

    const surveys = JSON.parse(localStorage.getItem('nps_surveys') || '[]');
    
    let html = `
        <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <h3>NPS Surveys</h3>
                <button class="btn-primary" onclick="NPSSystem.openBuilder()">+ Create Survey</button>
            </div>
            <table class="admin-table">
                <thead>
                    <tr>
                        <th>Question</th>
                        <th>Context</th>
                        <th>Trigger</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
    `;

    if (surveys.length === 0) {
        html += `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No surveys configured.</td></tr>`;
    } else {
        surveys.forEach(s => {
            const triggerDisplay = s.triggerType === 'completion' ? 'On Completion' : `Time: ${new Date(s.triggerTime).toLocaleString()}`;
            const statusBadge = s.active ? '<span class="status-badge status-pass">Active</span>' : '<span class="status-badge status-fail">Inactive</span>';
            
            html += `
                <tr>
                    <td>${s.question}</td>
                    <td>${s.contextName} <span style="font-size:0.8rem; color:var(--text-muted);">(${s.contextType})</span></td>
                    <td>${triggerDisplay}</td>
                    <td>${statusBadge}</td>
                    <td>
                        <button class="btn-secondary btn-sm" onclick="NPSSystem.previewSurvey('${s.id}')" title="Preview"><i class="fas fa-eye"></i></button>
                        <button class="btn-secondary btn-sm" onclick="NPSSystem.toggleStatus('${s.id}')">${s.active ? 'Disable' : 'Enable'}</button>
                        <button class="btn-secondary btn-sm" onclick="NPSSystem.cloneSurvey('${s.id}')" title="Clone"><i class="fas fa-copy"></i></button>
                        <button class="btn-danger btn-sm" onclick="NPSSystem.deleteSurvey('${s.id}')"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `;
        });
    }

    html += `</tbody></table></div>`;
    container.innerHTML = html;
};

NPSSystem.openBuilder = function() {
    const assessments = JSON.parse(localStorage.getItem('assessments') || '[]');
    const schedules = JSON.parse(localStorage.getItem('schedules') || '{}');
    
    let assessOpts = assessments.map(a => `<option value="assessment:${a.name}">${a.name} (Assessment)</option>`).join('');
    
    let schedOpts = '';
    Object.keys(schedules).forEach(k => {
        const items = schedules[k].items || [];
        items.forEach((item, idx) => {
            if (item.courseName) {
                schedOpts += `<option value="schedule:${k}:${idx}">${item.courseName} (Schedule ${k})</option>`;
            }
        });
    });

    const modalHtml = `
        <div id="npsBuilderModal" class="modal-overlay">
            <div class="modal-box">
                <h3>Configure NPS Survey</h3>
                <label>Question</label>
                <input type="text" id="npsQuestion" placeholder="e.g. How would you rate this module?" value="How would you rate this learning experience?">
                <label>Link To (Context)</label>
                <select id="npsContext" onchange="document.getElementById('npsTrigger').disabled = this.value.startsWith('schedule:')">
                    <option value="">-- Select Context --</option>
                    <optgroup label="Assessments">${assessOpts}</optgroup>
                    <optgroup label="Schedule Items">${schedOpts}</optgroup>
                </select>
                <label>Trigger</label>
                <select id="npsTrigger" onchange="document.getElementById('npsTimeConfig').classList.toggle('hidden', this.value !== 'time')">
                    <option value="completion">On Completion (Immediate)</option>
                    <option value="time">Specific Date/Time</option>
                </select>
                <div id="npsTimeConfig" class="hidden">
                    <label>Trigger Date & Time</label>
                    <input type="datetime-local" id="npsDateTime">
                </div>
                <div style="display:flex; gap:10px; margin-top:20px;">
                    <button class="btn-secondary" onclick="document.getElementById('npsBuilderModal').remove()">Cancel</button>
                    <button class="btn-primary" onclick="NPSSystem.saveSurvey()">Save Survey</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
};

NPSSystem.saveSurvey = async function() {
    const question = document.getElementById('npsQuestion').value;
    const contextVal = document.getElementById('npsContext').value;
    const triggerType = document.getElementById('npsTrigger').value;
    
    if (!question || !contextVal) return alert("Please fill all fields.");
    
    let contextType, contextId, contextName;
    
    if (contextVal.startsWith('assessment:')) {
        contextType = 'assessment';
        contextName = contextVal.split(':')[1];
        const assessments = JSON.parse(localStorage.getItem('tests') || '[]');
        const test = assessments.find(t => t.title === contextName);
        contextId = test ? test.id : contextName;
    } else if (contextVal.startsWith('schedule:')) {
        contextType = 'schedule';
        const parts = contextVal.split(':');
        contextId = `${parts[1]}_${parts[2]}`;
        const schedules = JSON.parse(localStorage.getItem('schedules') || '{}');
        contextName = schedules[parts[1]].items[parseInt(parts[2])].courseName;
    }

    const newSurvey = {
        id: Date.now().toString(),
        question, contextType, contextId, contextName, triggerType,
        triggerTime: triggerType === 'time' ? document.getElementById('npsDateTime').value : null,
        active: true,
        created: new Date().toISOString()
    };

    const surveys = JSON.parse(localStorage.getItem('nps_surveys') || '[]');
    surveys.push(newSurvey);
    localStorage.setItem('nps_surveys', JSON.stringify(surveys));
    
    if (typeof saveToServer === 'function') await saveToServer(['nps_surveys'], false);
    
    document.getElementById('npsBuilderModal').remove();
    NPSSystem.renderAdminPanel();
    if (typeof showToast === 'function') showToast("Survey created.", "success");
};

NPSSystem.toggleStatus = async function(id) {
    const surveys = JSON.parse(localStorage.getItem('nps_surveys') || '[]');
    const target = surveys.find(s => s.id === id);
    if (target) {
        target.active = !target.active;
        localStorage.setItem('nps_surveys', JSON.stringify(surveys));
        if (typeof saveToServer === 'function') await saveToServer(['nps_surveys'], false);
        NPSSystem.renderAdminPanel();
    }
};

NPSSystem.cloneSurvey = async function(id) {
    const surveys = JSON.parse(localStorage.getItem('nps_surveys') || '[]');
    const original = surveys.find(s => s.id === id);
    if (!original) return;

    if (!confirm("Clone this survey?")) return;

    const clone = JSON.parse(JSON.stringify(original));
    clone.id = Date.now().toString();
    clone.question += " (Copy)";
    clone.active = false; 
    clone.created = new Date().toISOString();
    
    surveys.push(clone);
    localStorage.setItem('nps_surveys', JSON.stringify(surveys));
    
    if (typeof saveToServer === 'function') await saveToServer(['nps_surveys'], false);
    
    NPSSystem.renderAdminPanel();
    if (typeof showToast === 'function') showToast("Survey cloned.", "success");
};

NPSSystem.previewSurvey = function(id) {
    const surveys = JSON.parse(localStorage.getItem('nps_surveys') || '[]');
    const survey = surveys.find(s => s.id === id);
    if (!survey) return;
    this.showSurveyModal(survey);
};

NPSSystem.deleteSurvey = async function(id) {
    if (!confirm("Delete this survey?")) return;
    let surveys = JSON.parse(localStorage.getItem('nps_surveys') || '[]');
    surveys = surveys.filter(x => x.id !== id);
    localStorage.setItem('nps_surveys', JSON.stringify(surveys));
    if (typeof saveToServer === 'function') await saveToServer(['nps_surveys'], true);
    NPSSystem.renderAdminPanel();
};

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
    if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) {
        NPSSystem.init();
    }
});

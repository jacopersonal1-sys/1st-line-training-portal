/* ================= AGENT FEEDBACK UI ================= */

const FeedbackUI = {
    isCapturing: false,
    selectedTrainee: '',
    selectedDate: new Date().toISOString().split('T')[0],

    questions: [
        "Could have effectively Troubleshooted in acs?",
        "Could have effectively troubleshooted on Preseem?",
        "Navigate and use QContact?",
        "Updated ticket with needed information?",
        "Could have identified what flowcharts to follow?",
        "Could have identified what medium client has?",
        "Could have identified what the account status was?",
        "Was able to assist client effectively on a conversation?",
        "Was the onboard able to identify a possible unreported outages?",
        "Was the onboard able to identify reported outages?"
    ],

    render: function() {
        const backendData = DataService.getBackendData();
        let fbMap = backendData.feedback_categories || {};
        if (Array.isArray(fbMap)) { fbMap = { 0: fbMap }; } // Legacy

        // Fetch trainees from the main app's local storage
        const users = JSON.parse(localStorage.getItem('users') || '[]');
        const trainees = users.filter(u => u.role === 'trainee').sort((a,b) => a.user.localeCompare(b.user));
        const traineeOptions = trainees.map(t => `<option value="${t.user}" ${this.selectedTrainee === t.user ? 'selected' : ''}>${t.user}</option>`).join('');

        if (!this.isCapturing) {
            // --- STEP 1: INITIAL SETUP SCREEN ---
            return `
                <div class="card">
                    <h3>Agent Production Feedback</h3>
                    <p style="color:var(--text-muted); margin-bottom:20px;">Select a trainee and date to begin capturing production feedback.</p>
                    
                    <div style="display:flex; gap:15px; margin-bottom:20px; padding:15px; background:var(--bg-input); border-radius:8px; border:1px solid var(--border-color);">
                        <div style="flex:1;">
                            <label style="font-weight:bold; display:block; margin-bottom:5px;">Trainee</label>
                            <select id="fb_trainee" class="tl-text-input" style="margin:0;">
                                <option value="">-- Select Trainee --</option>
                                ${traineeOptions}
                            </select>
                        </div>
                        <div style="flex:1;">
                            <label style="font-weight:bold; display:block; margin-bottom:5px;">Date</label>
                            <input type="date" id="fb_date" class="tl-text-input" value="${this.selectedDate}" style="margin:0;">
                        </div>
                    </div>
                    
                    <button class="btn-primary" onclick="FeedbackUI.startCapture()"><i class="fas fa-camera"></i> Capture Feedback</button>
                </div>
            `;
        } else {
            // --- STEP 2: CAPTURE FORM SCREEN ---
            const questionBlocks = this.questions.map((q, index) => {
                const id_slug = q.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 20);
                const cats = fbMap[index] || [];
                const feedbackOptions = cats.map(cat => `<option value="${cat.name}">${cat.name}</option>`).join('');
                return this._renderQuestionBlock(q, `${id_slug}_${index}`, feedbackOptions, index);
            }).join('');

            const extraQuestionsHtml = `
                <div class="tl-task-card">
                    <div class="tl-task-label">What additional steps did you show trainee and why?</div>
                    <div class="tl-task-input">
                        <div style="margin-bottom: 15px;">
                            <label style="font-size:0.8rem; font-weight:bold; display:block; margin-bottom:5px;">Ticket Reference/Call</label>
                            <input type="number" id="fb_extra_steps_ticket" class="tl-text-input" placeholder="Enter ticket or call reference number...">
                        </div>
                        <div style="margin-bottom: 15px;">
                            <label style="font-size:0.8rem; font-weight:bold; display:block; margin-bottom:5px;">Steps Shown / Reason</label>
                            <textarea id="fb_extra_steps_desc" class="tl-text-input" placeholder="Describe the steps and why..." style="height:80px; resize:vertical;"></textarea>
                        </div>
                        <div style="background:var(--bg-input); padding:10px; border-radius:6px; border:1px solid var(--border-color);">
                            <label style="font-size:0.8rem; font-weight:bold; display:block; margin-bottom:5px;">Proof (URL/Text or Screenshot)</label>
                            <textarea id="fb_extra_steps_proof_text" class="tl-text-input" placeholder="Enter URL or text..." style="height:60px; resize:vertical; margin-bottom:10px;"></textarea>
                            <div style="display:flex; align-items:center; gap:10px;">
                                <label class="btn-secondary btn-sm" style="cursor:pointer; margin:0;">
                                    <i class="fas fa-paperclip"></i> Upload Screenshot / File
                                    <input type="file" hidden accept="image/*,.pdf,.doc,.docx" onchange="FeedbackUI.handleFileUpload('extra_steps', this)">
                                </label>
                                <span id="fb_file_name_extra_steps" style="font-size:0.8rem; color:var(--text-muted);"></span>
                                <input type="hidden" id="fb_proof_base64_extra_steps">
                            </div>
                        </div>
                    </div>
                </div>

                <div class="tl-task-card">
                    <div class="tl-task-label">How would you describe trainee’s attitude while they were in the production week?</div>
                    <div class="tl-task-input">
                        <div style="display:flex; gap:10px; margin-top:5px; flex-wrap:wrap;">
                            ${[0,1,2,3,4,5].map(n => `<label style="flex:1; min-width:40px; text-align:center; padding:10px; background:var(--bg-card); border:1px solid var(--border-color); border-radius:6px; cursor:pointer; font-weight:bold;"><input type="radio" name="fb_attitude_rating" value="${n}" style="margin-bottom:5px; accent-color:var(--primary); transform:scale(1.2);"><br><span style="display:inline-block; margin-top:5px;">${n}</span></label>`).join('')}
                        </div>
                        <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:var(--text-muted); margin-top:8px; padding:0 5px;">
                            <span>0 - Very Poor</span><span>5 - Excellent</span>
                        </div>
                    </div>
                </div>
            `;

            return `
                <div class="card">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                        <div>
                            <h3 style="margin:0;">Capturing Feedback</h3>
                            <div style="color:var(--primary); font-weight:bold; margin-top:5px;">${this.selectedTrainee} <span style="color:var(--text-muted); font-weight:normal;">on ${this.selectedDate}</span></div>
                        </div>
                        <button class="btn-secondary btn-sm" onclick="FeedbackUI.cancelCapture()">Cancel</button>
                    </div>
                    
                    ${questionBlocks}
                    ${extraQuestionsHtml}

                    <div style="text-align:right; margin-top:20px; padding-top:20px; border-top:1px solid var(--border-color);">
                        <button class="btn-primary btn-lg" onclick="FeedbackUI.saveFeedback()"><i class="fas fa-save"></i> Save Feedback</button>
                    </div>
                </div>
            `;
        }
    },

    _renderQuestionBlock: function(questionText, id, feedbackOptions, index) {
        const proofId = `${id}_mentor_proof`;
        return `
            <div class="tl-task-card">
                <div class="tl-task-label">
                    ${questionText}
                    <i class="fas fa-question-circle" title="If a valid reason is not on this list please message a trainer to add a reason for your Feedback" style="color:var(--primary); cursor:pointer; margin-left:5px;"></i>
                </div>
                <div class="tl-task-input">
                    <div style="margin-bottom: 15px;">
                        <label style="font-size:0.8rem; font-weight:bold; display:block; margin-bottom:5px;">Ticket Reference/Call</label>
                        <input type="number" id="fb_ticket_${index}" class="tl-text-input" placeholder="Enter ticket or call reference number...">
                    </div>

                    <select id="fb_select_${index}" class="tl-text-input" style="margin-bottom: 15px;">
                        <option value="">-- Select Feedback --</option>
                        ${feedbackOptions}
                    </select>
                    
                    <div style="background:var(--bg-input); padding:10px; border-radius:6px; border:1px solid var(--border-color);">
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:bold; margin:0;">
                            <input type="checkbox" id="fb_mentor_${index}" onchange="document.getElementById('${proofId}').style.display = this.checked ? 'block' : 'none'"> 
                            Did you mentor and guide if needed? (Add proof)
                        </label>
                        
                        <div id="${proofId}" style="display:none; margin-top:10px; padding-top:10px; border-top:1px dashed var(--border-color);">
                            <textarea id="fb_proof_desc_${index}" class="tl-text-input" placeholder="Enter text description or paste a URL here..." style="height:60px; resize:vertical; margin-bottom:10px;"></textarea>
                            <div style="display:flex; align-items:center; gap:10px;">
                                <label class="btn-secondary btn-sm" style="cursor:pointer; margin:0;">
                                    <i class="fas fa-paperclip"></i> Upload Screenshot / File
                                    <input type="file" id="fb_proof_file_${index}" hidden accept="image/*,.pdf,.doc,.docx" onchange="FeedbackUI.handleFileUpload(${index}, this)">
                                </label>
                                <span id="fb_file_name_${index}" style="font-size:0.8rem; color:var(--text-muted);"></span>
                                <input type="hidden" id="fb_proof_base64_${index}">
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    // --- FORM ACTIONS ---

    startCapture: function() {
        const trainee = document.getElementById('fb_trainee').value;
        const date = document.getElementById('fb_date').value;

        if (!trainee || !date) return alert("Please select a Trainee and Date first.");
        
        this.selectedTrainee = trainee;
        this.selectedDate = date;
        this.isCapturing = true;
        App.render();
    },

    cancelCapture: function() {
        this.isCapturing = false;
        this.selectedTrainee = '';
        App.render();
    },

    saveFeedback: function() {
        // Collect all data from the generated IDs
        const feedbackData = [];
        let hasData = false;

        this.questions.forEach((q, index) => {
            const ticket = document.getElementById(`fb_ticket_${index}`).value;
            const selection = document.getElementById(`fb_select_${index}`).value;
            const mentored = document.getElementById(`fb_mentor_${index}`).checked;
            const proofDesc = document.getElementById(`fb_proof_desc_${index}`).value;
            const proofFile = document.getElementById(`fb_proof_base64_${index}`).value;
            const fileName = document.getElementById(`fb_file_name_${index}`).innerText;

            if (selection || ticket || mentored) {
                hasData = true;
                feedbackData.push({
                    question: q,
                    ticket: ticket,
                    selection: selection,
                    mentored: mentored,
                    proofDesc: proofDesc,
                    proofFile: proofFile, // Base64 data if uploaded
                    fileName: fileName
                });
            }
        });

        // Capture Extra Custom Questions
        const extraStepsDesc = document.getElementById('fb_extra_steps_desc').value;
        const extraStepsTicket = document.getElementById('fb_extra_steps_ticket').value;
        const extraStepsProofText = document.getElementById('fb_extra_steps_proof_text').value;
        const extraStepsProofFile = document.getElementById('fb_proof_base64_extra_steps').value;
        const extraStepsFileName = document.getElementById('fb_file_name_extra_steps').innerText;

        if (extraStepsDesc || extraStepsTicket || extraStepsProofText || extraStepsProofFile) {
            hasData = true;
            feedbackData.push({
                question: "What additional steps did you show trainee and why?",
                ticket: extraStepsTicket,
                desc: extraStepsDesc,
                proofDesc: extraStepsProofText,
                proofFile: extraStepsProofFile,
                fileName: extraStepsFileName
            });
        }

        const attitudeEl = document.querySelector('input[name="fb_attitude_rating"]:checked');
        if (attitudeEl) {
            hasData = true;
            feedbackData.push({ question: "How would you describe trainee’s attitude while they were in the production week?", rating: attitudeEl.value });
        }

        if (!hasData) return alert("Please provide feedback for at least one question before saving.");

        const payload = {
            id: Date.now() + "_" + Math.random().toString(36).substr(2, 5),
            trainee: this.selectedTrainee,
            date: this.selectedDate,
            tl: AppContext.user ? AppContext.user.user : 'Unknown',
            feedback: feedbackData
        };

        const allFeedback = DataService.getAgentFeedback();
        allFeedback.push(payload);
        DataService.saveAgentFeedback(allFeedback);

        alert("Feedback captured and saved successfully!");
        
        // Reset form
        this.isCapturing = false;
        App.render();
    },

    handleFileUpload: function(index, input) {
        const file = input.files[0];
        if (!file) return;

        // 5MB Limit Check
        if (file.size > 5 * 1024 * 1024) {
            alert("File is too large (Max 5MB). Please use a URL link instead.");
            input.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById(`fb_proof_base64_${index}`).value = e.target.result;
            document.getElementById(`fb_file_name_${index}`).innerText = file.name;
        };
        reader.readAsDataURL(file);
    }
};
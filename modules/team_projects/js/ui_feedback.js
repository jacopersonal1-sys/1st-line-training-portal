/* ================= AGENT FEEDBACK UI ================= */

const FeedbackUI = {
    isCapturing: false,
    currentStep: 0,
    selectedTrainee: '',
    selectedDate: new Date().toISOString().split('T')[0],
    accessMediumOptions: ['Wireless', 'Fiber'],
    valueAddedServiceOptions: ['VoIP', 'Email'],
    problemOptions: ['No Internet', 'Slow Speed'],
    formData: null,

    getEmptyFormData: function() {
        return {
            ticketNumber: '',
            communicationReference: '',
            selectedMedium: '',
            problemStatement: '',
            answers: {}
        };
    },

    getQuestionTargetKey: function() {
        if (!this.formData || !this.formData.selectedMedium) return '';
        if (this.isValueAddedServiceMedium()) return this.formData.selectedMedium;
        if (!this.formData.problemStatement) return '';
        return `${this.formData.problemStatement} > ${this.formData.selectedMedium}`;
    },

    getQuestionList: function() {
        const backendData = DataService.getBackendData();
        const questions = backendData.feedback_questions || [];
        const selectedProblem = this.formData && this.formData.problemStatement ? this.formData.problemStatement : '';
        const selectedTarget = this.getQuestionTargetKey();
        return questions.map((question, index) => {
            if (typeof question === 'string') {
                return { id: `legacy_${index}`, text: question, linkTarget: 'All Tickets' };
            }
            return {
                id: question.id || `question_${index}`,
                text: question.text || '',
                linkTarget: question.linkTarget || question.problemStatement || 'All Tickets'
            };
        }).filter(question => {
            if (!question.text) return false;
            if (!selectedTarget) return question.linkTarget === 'All Tickets';
            return question.linkTarget === 'All Tickets' || question.linkTarget === selectedTarget || (selectedProblem && question.linkTarget === selectedProblem);
        });
    },

    isValueAddedServiceMedium: function() {
        return this.valueAddedServiceOptions.includes(this.formData.selectedMedium);
    },

    needsProblemStep: function() {
        return this.accessMediumOptions.includes(this.formData.selectedMedium);
    },

    render: function() {
        const myTeam = DataService.getMyTeam();
        const trainees = myTeam.slice().sort((a, b) => a.name.localeCompare(b.name));
        const traineeOptions = trainees.length > 0
            ? trainees.map(t => `<option value="${t.name}" ${this.selectedTrainee === t.name ? 'selected' : ''}>${t.name}</option>`).join('')
            : `<option value="">-- Add agents to 'My Team' first --</option>`;

        if (!this.isCapturing) {
            return `
                <div class="card" style="min-height:65vh; display:flex; align-items:center; justify-content:center;">
                    <div style="width:min(560px, 100%); text-align:center;">
                        <div style="margin-bottom:25px;">
                            <h2 style="margin-bottom:10px;">Agent Production Feedback</h2>
                            <p style="color:var(--text-muted); margin:0;">Select a trainee and a date to start a new production feedback capture.</p>
                        </div>

                        <div style="display:grid; gap:16px; text-align:left; background:var(--bg-input); padding:24px; border-radius:16px; border:1px solid var(--border-color);">
                            <div>
                                <label style="font-weight:bold; display:block; margin-bottom:6px;">Trainee</label>
                                <select id="fb_trainee" class="tl-text-input" style="margin:0;">
                                    <option value="">-- Select Trainee --</option>
                                    ${traineeOptions}
                                </select>
                            </div>
                            <div>
                                <label style="font-weight:bold; display:block; margin-bottom:6px;">Date</label>
                                <input type="date" id="fb_date" class="tl-text-input" value="${this.selectedDate}" style="margin:0;">
                            </div>
                            <div style="text-align:center; padding-top:8px;">
                                <button class="btn-primary btn-lg" onclick="FeedbackUI.startCapture()"><i class="fas fa-arrow-right"></i> Submit</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        return `
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:22px;">
                    <div>
                        <h3 style="margin:0 0 6px 0;">Agent Production Feedback</h3>
                        <div style="color:var(--primary); font-weight:bold;">${this.selectedTrainee}</div>
                        <div style="color:var(--text-muted); font-size:0.9rem; margin-top:3px;">${this.selectedDate}</div>
                    </div>
                    <button class="btn-secondary btn-sm" onclick="FeedbackUI.cancelCapture()">Cancel</button>
                </div>

                ${this.renderStepProgress()}
                ${this.renderCurrentStep()}
            </div>
        `;
    },

    renderStepProgress: function() {
        const labels = ['Ticket Details', 'Medium'];
        if (this.needsProblemStep()) labels.push('Problem Statement');
        labels.push('Questions');

        return `
            <div style="display:grid; grid-template-columns:repeat(${labels.length}, minmax(0, 1fr)); gap:10px; margin-bottom:24px;">
                ${labels.map((label, index) => {
                    const isActive = index === this.currentStep;
                    const isComplete = index < this.currentStep;
                    const bg = isActive ? 'var(--primary)' : (isComplete ? 'rgba(74, 111, 165, 0.15)' : 'var(--bg-input)');
                    const color = isActive ? '#fff' : 'var(--text-main)';
                    const border = isActive ? 'transparent' : 'var(--border-color)';
                    return `
                        <div style="padding:12px 10px; text-align:center; border-radius:12px; border:1px solid ${border}; background:${bg}; color:${color}; font-size:0.85rem; font-weight:bold;">
                            ${index + 1}. ${label}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    },

    renderCurrentStep: function() {
        if (this.currentStep === 0) return this.renderTicketStep();
        if (this.currentStep === 1) return this.renderMediumStep();
        if (this.currentStep === 2 && this.needsProblemStep()) return this.renderProblemStep();
        return this.renderQuestionsStep();
    },

    renderTicketStep: function() {
        return `
            <div style="max-width:760px; margin:0 auto;">
                <h4 style="margin-top:0;">Insert ticket details</h4>
                <div style="display:grid; gap:16px;">
                    <div>
                        <label style="font-weight:bold; display:block; margin-bottom:6px;">Insert Ticket number</label>
                        <input type="text" id="fb_ticket_number" class="tl-text-input" value="${this.formData.ticketNumber}" placeholder="Enter ticket number...">
                    </div>
                    <div>
                        <label style="font-weight:bold; display:block; margin-bottom:6px;">Insert Communication Reference</label>
                        <input type="text" id="fb_communication_reference" class="tl-text-input" value="${this.formData.communicationReference}" placeholder="Enter communication reference...">
                    </div>
                </div>
                ${this.renderNavButtons({ nextLabel: 'Next', showBack: false })}
            </div>
        `;
    },

    renderMediumStep: function() {
        return `
            <div style="max-width:760px; margin:0 auto;">
                <h4 style="margin-top:0;">Select Medium</h4>
                <p style="color:var(--text-muted); margin-bottom:16px;">Choose the main medium for this ticket.</p>
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:16px; margin-bottom:18px;">
                    ${this.accessMediumOptions.map(option => this.renderChoiceCard(option, this.formData.selectedMedium, "FeedbackUI.selectMedium('" + option + "')")).join('')}
                </div>
                <div style="border:1px solid var(--border-color); border-radius:16px; background:var(--bg-input); overflow:hidden;">
                    <div style="padding:16px 18px; border-bottom:1px solid var(--border-color); font-weight:bold;">Value Added Services</div>
                    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:16px; padding:18px;">
                        ${this.valueAddedServiceOptions.map(option => this.renderChoiceCard(option, this.formData.selectedMedium, "FeedbackUI.selectMedium('" + option + "')")).join('')}
                    </div>
                </div>
                ${this.renderNavButtons({ nextLabel: 'Next' })}
            </div>
        `;
    },

    renderProblemStep: function() {
        return `
            <div style="max-width:860px; margin:0 auto;">
                <h4 style="margin-top:0;">Choose problem statement of the ticket</h4>
                <p style="color:var(--text-muted); margin-bottom:16px;">Because you selected <strong>${this.formData.selectedMedium}</strong>, choose the matching problem statement below.</p>
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:16px;">
                    ${this.problemOptions.map(option => this.renderChoiceCard(option, this.formData.problemStatement, "FeedbackUI.selectProblemStatement('" + option.replace("'", "\\'") + "')")).join('')}
                </div>
                ${this.renderNavButtons({ nextLabel: 'Next' })}
            </div>
        `;
    },

    renderQuestionsStep: function() {
        const questions = this.getQuestionList();
        const finalHeading = questions.length > 0 ? 'Answer the created feedback questions' : 'No feedback questions created yet';

        return `
            <div style="max-width:900px; margin:0 auto;">
                <h4 style="margin-top:0;">${finalHeading}</h4>
                <p style="color:var(--text-muted); margin-bottom:18px;">Each question uses a fixed <strong>Yes</strong> or <strong>No</strong> answer.</p>
                ${this.getQuestionTargetKey() ? `<div style="margin-bottom:16px; padding:12px 14px; border-radius:12px; background:var(--bg-input); border:1px solid var(--border-color); color:var(--text-muted);">Showing questions linked to <strong style="color:var(--text-main);">${this.getQuestionTargetKey()}</strong>.</div>` : ''}

                ${questions.length > 0 ? questions.map((question, index) => `
                    <div class="tl-task-card">
                        <div class="tl-task-label">${index + 1}. ${question.text}</div>
                        <div class="tl-task-input">
                            <div style="display:flex; flex-wrap:wrap; gap:12px;">
                                ${this.renderAnswerChoice(question.id, 'Yes')}
                                ${this.renderAnswerChoice(question.id, 'No')}
                            </div>
                        </div>
                    </div>
                `).join('') : `
                    <div class="tl-task-card">
                        <div class="tl-task-label">Question Creator needed</div>
                        <div class="tl-task-input">
                            <p style="margin:0; color:var(--text-muted);">There are no questions linked to this ticket path yet. Add them in <strong>Backend Data</strong> under <strong>Question Creator</strong>.</p>
                        </div>
                    </div>
                `}

                ${this.renderNavButtons({ nextLabel: 'Save Feedback', isFinal: true })}
            </div>
        `;
    },

    renderChoiceCard: function(label, selectedValue, onclick) {
        const isSelected = selectedValue === label;
        return `
            <button type="button" class="${isSelected ? 'btn-primary' : 'btn-secondary'}" onclick="${onclick}" style="min-height:88px; border-radius:16px; font-size:1rem; font-weight:bold;">
                ${label}
            </button>
        `;
    },

    renderAnswerChoice: function(questionId, value) {
        const inputId = `fb_answer_${questionId}_${value.toLowerCase()}`;
        const isChecked = this.formData.answers[questionId] === value;
        return `
            <label for="${inputId}" style="flex:1; min-width:160px; display:flex; align-items:center; gap:10px; padding:14px 16px; border-radius:12px; border:1px solid ${isChecked ? 'var(--primary)' : 'var(--border-color)'}; background:${isChecked ? 'rgba(74, 111, 165, 0.12)' : 'var(--bg-input)'}; cursor:pointer;">
                <input type="radio" id="${inputId}" name="fb_answer_${questionId}" value="${value}" ${isChecked ? 'checked' : ''} onchange="FeedbackUI.setAnswer('${questionId}', '${value}')">
                <span style="font-weight:bold;">${value}</span>
            </label>
        `;
    },

    renderNavButtons: function(options) {
        const nextLabel = options.nextLabel || 'Next';
        const showBack = options.showBack !== false;
        const isFinal = options.isFinal === true;

        return `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-top:24px;">
                <div>
                    ${showBack ? `<button class="btn-secondary" onclick="FeedbackUI.goBack()"><i class="fas fa-arrow-left"></i> Back</button>` : ''}
                </div>
                <div>
                    <button class="btn-primary" onclick="${isFinal ? 'FeedbackUI.saveFeedback()' : 'FeedbackUI.goNext()'}">${nextLabel} ${isFinal ? '<i class="fas fa-save"></i>' : '<i class="fas fa-arrow-right"></i>'}</button>
                </div>
            </div>
        `;
    },

    startCapture: function() {
        const trainee = document.getElementById('fb_trainee').value;
        const date = document.getElementById('fb_date').value;

        if (!trainee || !date) return alert("Please select a trainee and date first.");

        this.selectedTrainee = trainee;
        this.selectedDate = date;
        this.isCapturing = true;
        this.currentStep = 0;
        this.formData = this.getEmptyFormData();
        App.render();
    },

    cancelCapture: function() {
        this.isCapturing = false;
        this.currentStep = 0;
        this.selectedTrainee = '';
        this.formData = null;
        App.render();
    },

    goBack: function() {
        if (this.currentStep > 0) {
            this.currentStep -= 1;
            App.render();
        }
    },

    goNext: function() {
        if (!this.validateCurrentStep()) return;

        if (this.currentStep === 1 && this.isValueAddedServiceMedium()) {
            this.formData.problemStatement = this.formData.selectedMedium;
            this.currentStep = 2;
        } else {
            this.currentStep += 1;
        }

        App.render();
    },

    validateCurrentStep: function() {
        if (this.currentStep === 0) {
            const ticketNumber = document.getElementById('fb_ticket_number').value.trim();
            const communicationReference = document.getElementById('fb_communication_reference').value.trim();
            if (!ticketNumber || !communicationReference) {
                alert("Please enter the ticket number and communication reference.");
                return false;
            }
            this.formData.ticketNumber = ticketNumber;
            this.formData.communicationReference = communicationReference;
            return true;
        }

        if (this.currentStep === 1 && !this.formData.selectedMedium) {
            alert("Please select the medium before continuing.");
            return false;
        }

        if (this.currentStep === 2 && this.needsProblemStep() && !this.formData.problemStatement) {
            alert("Please choose the problem statement before continuing.");
            return false;
        }

        return true;
    },

    selectMedium: function(value) {
        this.formData.selectedMedium = value;
        this.formData.problemStatement = this.isValueAddedServiceMedium() ? value : '';
        App.render();
    },

    selectProblemStatement: function(value) {
        this.formData.problemStatement = value;
        App.render();
    },

    setAnswer: function(questionId, value) {
        this.formData.answers[questionId] = value;
    },

    saveFeedback: function() {
        const questions = this.getQuestionList();
        const answers = questions.map(question => ({
            id: question.id,
            question: question.text,
            answer: this.formData.answers[question.id] || ''
        }));

        const payload = {
            id: Date.now() + "_" + Math.random().toString(36).substr(2, 5),
            trainee: this.selectedTrainee,
            date: this.selectedDate,
            tl: AppContext.user ? AppContext.user.user : 'Unknown',
            createdAt: new Date().toISOString(),
            ticketNumber: this.formData.ticketNumber,
            communicationReference: this.formData.communicationReference,
            selectedMedium: this.formData.selectedMedium,
            problemStatement: this.formData.problemStatement,
            questionTarget: this.getQuestionTargetKey(),
            answers: answers
        };

        const allFeedback = DataService.getAgentFeedback();
        allFeedback.push(payload);
        DataService.saveAgentFeedback(allFeedback);

        alert("Production feedback saved successfully!");
        this.isCapturing = false;
        this.currentStep = 0;
        this.selectedTrainee = '';
        this.formData = null;
        App.render();
    }
};

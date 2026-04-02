/* ================= BACKEND DATA UI ================= */
/* Manages configuration data for dropdowns and reference values */

const BackendUI = {
    questionFilter: 'all',
    questionSearch: '',

    getLinkTargetOptions: function() {
        return [
            'All Tickets',
            'No Internet',
            'No Internet > Wireless',
            'No Internet > Fiber',
            'Slow Speed',
            'Slow Speed > Wireless',
            'Slow Speed > Fiber',
            'VoIP',
            'Email'
        ];
    },

    render: function() {
        const data = DataService.getBackendData();
        const areas = data.outage_areas || [];
        const bottlenecks = data.bottleneck_types || [];
        const linkTargetOptions = this.getLinkTargetOptions();
        const questions = (data.feedback_questions || []).map((question, index) => {
            if (typeof question === 'string') {
                return { id: `legacy_${index}`, text: question, linkTarget: 'All Tickets' };
            }
            return {
                id: question.id || `question_${index}`,
                text: question.text || '',
                linkTarget: question.linkTarget || question.problemStatement || 'All Tickets'
            };
        });
        const searchTerm = this.questionSearch.trim().toLowerCase();
        const filteredQuestions = questions.filter(question => {
            const matchesProblem = this.questionFilter === 'all' || question.linkTarget === this.questionFilter;
            const matchesText = !searchTerm || question.text.toLowerCase().includes(searchTerm);
            return matchesProblem && matchesText;
        });

        const areaRows = areas.map((area, index) => `
            <tr>
                <td><input type="text" class="tl-text-input" value="${area.name}" onchange="BackendUI.updateArea(${index}, 'name', this.value)" placeholder="Area Name"></td>
                <td><input type="number" class="tl-text-input" value="${area.count}" onchange="BackendUI.updateArea(${index}, 'count', this.value)" placeholder="Ref Count"></td>
                <td><button class="btn-danger btn-sm" onclick="BackendUI.removeArea(${index})"><i class="fas fa-trash"></i></button></td>
            </tr>
        `).join('');

        const bottleneckRows = bottlenecks.map((type, index) => `
            <tr>
                <td><input type="text" class="tl-text-input" value="${type}" onchange="BackendUI.updateBottleneckType(${index}, this.value)" placeholder="Category Name"></td>
                <td><button class="btn-danger btn-sm" onclick="BackendUI.removeBottleneckType(${index})"><i class="fas fa-trash"></i></button></td>
            </tr>
        `).join('');

        const questionRows = filteredQuestions.map((question, index) => `
            <tr>
                <td style="width:60px; color:var(--text-muted); font-weight:bold;">${index + 1}</td>
                <td><input type="text" class="tl-text-input" value="${question.text}" onchange="BackendUI.updateFeedbackQuestionField('${question.id}', 'text', this.value)" placeholder="Enter the question text..."></td>
                <td>
                    <select class="tl-text-input" onchange="BackendUI.updateFeedbackQuestionField('${question.id}', 'linkTarget', this.value)">
                        ${linkTargetOptions.map(option => `<option value="${option}" ${question.linkTarget === option ? 'selected' : ''}>${option}</option>`).join('')}
                    </select>
                </td>
                <td style="color:var(--text-muted); font-weight:bold;">Yes / No</td>
                <td><button class="btn-danger btn-sm" onclick="BackendUI.removeFeedbackQuestion('${question.id}')"><i class="fas fa-trash"></i></button></td>
            </tr>
        `).join('');

        return `
            <div class="card">
                <h3>Network Outage Configuration</h3>
                <p style="color:var(--text-muted); margin-bottom:15px;">Manage the list of areas and their associated client counts for the "Check Network Outages" task.</p>
                
                <div class="table-responsive">
                    <table class="admin-table">
                        <thead><tr><th>Area Name</th><th>Affected Count (Ref)</th><th>Action</th></tr></thead>
                        <tbody>
                            ${areaRows}
                            <tr>
                                <td colspan="3" style="text-align:center; padding:10px;">
                                    <button class="btn-secondary btn-sm" onclick="BackendUI.addArea()">+ Add New Area</button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="card" style="margin-top:20px;">
                <h3>Bottleneck Categories</h3>
                <p style="color:var(--text-muted); margin-bottom:15px;">Define categories for the "Identify Operational Bottlenecks" drop down.</p>
                
                <div class="table-responsive">
                    <table class="admin-table">
                        <thead><tr><th>Category Name</th><th>Action</th></tr></thead>
                        <tbody>
                            ${bottleneckRows}
                            <tr>
                                <td colspan="2" style="text-align:center; padding:10px;">
                                    <button class="btn-secondary btn-sm" onclick="BackendUI.addBottleneckType()">+ Add New Category</button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="card" style="margin-top:20px;">
                <h3>Question Creator</h3>
                <p style="color:var(--text-muted); margin-bottom:15px;">Create the feedback questions used in Agent Production Feedback. Each question automatically uses <strong>Yes</strong> and <strong>No</strong> as the answer options.</p>

                <div style="display:grid; grid-template-columns:2fr 1fr; gap:14px; margin-bottom:16px;">
                    <div>
                        <label style="font-weight:bold; display:block; margin-bottom:6px;">Search Question</label>
                        <input type="text" class="tl-text-input" value="${this.questionSearch}" oninput="BackendUI.setQuestionSearch(this.value)" placeholder="Search question text..." style="margin:0;">
                    </div>
                    <div>
                        <label style="font-weight:bold; display:block; margin-bottom:6px;">Filter by Linked Ticket Path</label>
                        <select class="tl-text-input" onchange="BackendUI.setQuestionFilter(this.value)" style="margin:0;">
                            <option value="all" ${this.questionFilter === 'all' ? 'selected' : ''}>All Ticket Paths</option>
                            ${linkTargetOptions.filter(option => option !== 'All Tickets').map(option => `<option value="${option}" ${this.questionFilter === option ? 'selected' : ''}>${option}</option>`).join('')}
                        </select>
                    </div>
                </div>

                <div class="table-responsive">
                    <table class="admin-table">
                        <thead><tr><th>#</th><th>Question</th><th>Linked Ticket Path</th><th>Answer Type</th><th>Action</th></tr></thead>
                        <tbody>
                            ${questionRows || '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:24px;">No matching questions found.</td></tr>'}
                            <tr>
                                <td colspan="5" style="text-align:center; padding:10px;">
                                    <button class="btn-secondary btn-sm" onclick="BackendUI.addFeedbackQuestion()">+ Add New Question</button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    addArea: function() {
        const data = DataService.getBackendData();
        if (!data.outage_areas) data.outage_areas = [];
        data.outage_areas.push({ name: "", count: 0 });
        DataService.saveBackendData(data);
        App.render();
    },

    removeArea: function(index) {
        if (!confirm("Remove this area?")) return;
        const data = DataService.getBackendData();
        data.outage_areas.splice(index, 1);
        DataService.saveBackendData(data);
        App.render();
    },

    updateArea: function(index, field, value) {
        const data = DataService.getBackendData();
        data.outage_areas[index][field] = field === 'count' ? parseInt(value, 10) || 0 : value;
        DataService.saveBackendData(data);
    },

    addBottleneckType: function() {
        const data = DataService.getBackendData();
        if (!data.bottleneck_types) data.bottleneck_types = [];
        data.bottleneck_types.push("");
        DataService.saveBackendData(data);
        App.render();
    },

    removeBottleneckType: function(index) {
        if (!confirm("Remove this category?")) return;
        const data = DataService.getBackendData();
        data.bottleneck_types.splice(index, 1);
        DataService.saveBackendData(data);
        App.render();
    },

    updateBottleneckType: function(index, value) {
        const data = DataService.getBackendData();
        data.bottleneck_types[index] = value;
        DataService.saveBackendData(data);
    },

    addFeedbackQuestion: function() {
        const data = DataService.getBackendData();
        if (!Array.isArray(data.feedback_questions)) data.feedback_questions = [];
        data.feedback_questions.push({
            id: 'fq_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            text: '',
            linkTarget: 'All Tickets'
        });
        DataService.saveBackendData(data);
        App.render();
    },

    setQuestionSearch: function(value) {
        this.questionSearch = value;
        App.render();
    },

    setQuestionFilter: function(value) {
        this.questionFilter = value;
        App.render();
    },

    updateFeedbackQuestionField: function(questionId, field, value) {
        const data = DataService.getBackendData();
        if (!Array.isArray(data.feedback_questions)) data.feedback_questions = [];
        const question = data.feedback_questions.find(item => item.id === questionId);
        if (!question) return;
        question[field] = value;
        DataService.saveBackendData(data);
    },

    removeFeedbackQuestion: function(questionId) {
        if (!confirm("Remove this question?")) return;
        const data = DataService.getBackendData();
        if (!Array.isArray(data.feedback_questions)) data.feedback_questions = [];
        data.feedback_questions = data.feedback_questions.filter(item => item.id !== questionId);
        DataService.saveBackendData(data);
        App.render();
    }
};

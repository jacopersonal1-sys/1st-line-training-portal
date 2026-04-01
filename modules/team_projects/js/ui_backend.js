/* ================= BACKEND DATA UI ================= */
/* Manages configuration data for dropdowns and reference values */

const BackendUI = {
    selectedFeedbackQuestion: 0,

    render: function() {
        const data = DataService.getBackendData();
        const areas = data.outage_areas || [];
        const bottlenecks = data.bottleneck_types || [];
        
        let fbMap = data.feedback_categories || {};
        if (Array.isArray(fbMap)) { fbMap = { 0: fbMap }; } // Legacy migration

        const questions = typeof FeedbackUI !== 'undefined' ? FeedbackUI.questions : [];
        const currentQIndex = this.selectedFeedbackQuestion || 0;
        const currentCategories = fbMap[currentQIndex] || [];

        // Generate Table Rows
        const rows = areas.map((area, index) => `
            <tr>
                <td><input type="text" class="tl-text-input" value="${area.name}" onchange="BackendUI.updateArea(${index}, 'name', this.value)" placeholder="Area Name"></td>
                <td><input type="number" class="tl-text-input" value="${area.count}" onchange="BackendUI.updateArea(${index}, 'count', this.value)" placeholder="Ref Count"></td>
                <td><button class="btn-danger btn-sm" onclick="BackendUI.removeArea(${index})"><i class="fas fa-trash"></i></button></td>
            </tr>
        `).join('');

        const bnRows = bottlenecks.map((type, index) => `
            <tr>
                <td><input type="text" class="tl-text-input" value="${type}" onchange="BackendUI.updateBottleneckType(${index}, this.value)" placeholder="Category Name"></td>
                <td><button class="btn-danger btn-sm" onclick="BackendUI.removeBottleneckType(${index})"><i class="fas fa-trash"></i></button></td>
            </tr>
        `).join('');

        const qSelectOptions = questions.map((q, i) => 
            `<option value="${i}" ${currentQIndex == i ? 'selected' : ''}>Question ${i + 1}: ${q}</option>`
        ).join('');

        const fbRows = currentCategories.map((cat, index) => `
            <tr>
                <td><input type="text" class="tl-text-input" value="${cat.name || ''}" onchange="BackendUI.updateFeedbackCategory(${index}, 'name', this.value)" placeholder="Category Name"></td>
                <td>
                    <select class="tl-text-input" onchange="BackendUI.updateFeedbackCategory(${index}, 'classification', this.value)">
                        <option value="Pass" ${cat.classification === 'Pass' ? 'selected' : ''}>Pass</option>
                        <option value="Improve" ${cat.classification === 'Improve' ? 'selected' : ''}>Improve</option>
                        <option value="Fail" ${cat.classification === 'Fail' ? 'selected' : ''}>Fail</option>
                    </select>
                </td>
                <td><button class="btn-danger btn-sm" onclick="BackendUI.removeFeedbackCategory(${index})"><i class="fas fa-trash"></i></button></td>
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
                            ${rows}
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
                            ${bnRows}
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
                <h3>Feedback Categories</h3>
                <p style="color:var(--text-muted); margin-bottom:15px;">Select a question below to define its specific feedback categories.</p>
                
                <div style="margin-bottom: 15px;">
                    <label style="font-weight:bold; font-size:0.85rem;">Select Question to Configure:</label>
                    <select class="tl-text-input" onchange="BackendUI.changeFeedbackQuestion(this.value)">
                        ${qSelectOptions}
                    </select>
                </div>

                <div class="table-responsive">
                    <table class="admin-table">
                        <thead><tr><th>Category Name</th><th>Classification</th><th>Action</th></tr></thead>
                        <tbody>
                            ${fbRows}
                            <tr>
                                <td colspan="3" style="text-align:center; padding:10px;">
                                    <button class="btn-secondary btn-sm" onclick="BackendUI.addFeedbackCategory()">+ Add New Category</button>
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
        if(!data.outage_areas) data.outage_areas = [];
        data.outage_areas.push({ name: "", count: 0 });
        DataService.saveBackendData(data);
        App.render();
    },

    removeArea: function(index) {
        if(!confirm("Remove this area?")) return;
        const data = DataService.getBackendData();
        data.outage_areas.splice(index, 1);
        DataService.saveBackendData(data);
        App.render();
    },

    updateArea: function(index, field, value) {
        const data = DataService.getBackendData();
        data.outage_areas[index][field] = field === 'count' ? parseInt(value) : value;
        DataService.saveBackendData(data);
        // No re-render needed to keep focus
    },

    addBottleneckType: function() {
        const data = DataService.getBackendData();
        if(!data.bottleneck_types) data.bottleneck_types = [];
        data.bottleneck_types.push("");
        DataService.saveBackendData(data);
        App.render();
    },

    removeBottleneckType: function(index) {
        if(!confirm("Remove this category?")) return;
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

    changeFeedbackQuestion: function(index) {
        this.selectedFeedbackQuestion = parseInt(index);
        App.render();
    },

    addFeedbackCategory: function() {
        const data = DataService.getBackendData();
        if (Array.isArray(data.feedback_categories)) data.feedback_categories = { 0: data.feedback_categories };
        if (!data.feedback_categories) data.feedback_categories = {};
        
        const qIdx = this.selectedFeedbackQuestion || 0;
        if (!data.feedback_categories[qIdx]) data.feedback_categories[qIdx] = [];
        
        data.feedback_categories[qIdx].push({ name: "", classification: "Pass" });
        DataService.saveBackendData(data);
        App.render();
    },

    removeFeedbackCategory: function(index) {
        if(!confirm("Remove this category?")) return;
        const data = DataService.getBackendData();
        if (Array.isArray(data.feedback_categories)) data.feedback_categories = { 0: data.feedback_categories };
        
        const qIdx = this.selectedFeedbackQuestion || 0;
        if (data.feedback_categories[qIdx]) {
            data.feedback_categories[qIdx].splice(index, 1);
            DataService.saveBackendData(data);
        }
        App.render();
    },

    updateFeedbackCategory: function(index, field, value) {
        const data = DataService.getBackendData();
        if (Array.isArray(data.feedback_categories)) data.feedback_categories = { 0: data.feedback_categories };
        
        const qIdx = this.selectedFeedbackQuestion || 0;
        if (!data.feedback_categories[qIdx] || !data.feedback_categories[qIdx][index]) return;
        
        data.feedback_categories[qIdx][index][field] = value;
        DataService.saveBackendData(data);
        // No re-render to keep focus
    }
};
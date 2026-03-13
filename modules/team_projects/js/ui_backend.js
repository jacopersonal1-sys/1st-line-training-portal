/* ================= BACKEND DATA UI ================= */
/* Manages configuration data for dropdowns and reference values */

const BackendUI = {
    render: function() {
        const data = DataService.getBackendData();
        const areas = data.outage_areas || [];
        const bottlenecks = data.bottleneck_types || [];

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
    }
};
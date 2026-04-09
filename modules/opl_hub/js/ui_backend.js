/* ================= OPL HUB BACKEND UI ================= */

const BackendUI = {
    form: {
        id: '',
        docName: '',
        linkedContent: '',
        classifier: '',
        reviewDate: ''
    },

    sections: {
        linked_content: false,
        classifier: false,
        backend_entry: false,
        all_entries: false
    },

    setFormField: function(field, value) {
        this.form[field] = value;
    },

    toggleSection: function(sectionKey) {
        if (typeof this.sections[sectionKey] === 'undefined') return;
        this.sections[sectionKey] = !this.sections[sectionKey];
        App.render();
    },

    resetForm: function() {
        this.form = {
            id: '',
            docName: '',
            linkedContent: '',
            classifier: '',
            reviewDate: ''
        };
        App.render();
    },

    editDocument: function(id) {
        const doc = DataService.getDocumentById(id);
        if (!doc) return;
        this.form = {
            id: doc.id,
            docName: doc.docName || '',
            linkedContent: doc.linkedContent || '',
            classifier: doc.classifier || '',
            reviewDate: doc.reviewDate || ''
        };
        App.render();
    },

    saveDocument: async function() {
        const result = await DataService.upsertDocument(this.form);
        if (!result.ok) {
            alert(result.message || 'Failed to save DOC entry.');
            return;
        }
        this.resetForm();
    },

    deleteDocument: async function(id) {
        if (!confirm('Delete this DOC entry?')) return;
        const result = await DataService.deleteDocument(id);
        if (!result.ok) {
            alert(result.message || 'Failed to delete DOC entry.');
            return;
        }
        if (this.form.id === id) this.resetForm();
        App.render();
    },

    addLinkedContent: async function() {
        const input = document.getElementById('opl-linked-content-new');
        const value = input ? input.value : '';
        const result = await DataService.addLinkedContent(value);
        if (!result.ok) {
            alert(result.message || 'Failed to add linked content.');
            return;
        }
        if (input) input.value = '';
        App.render();
    },

    updateLinkedContent: async function(index, value) {
        const result = await DataService.updateLinkedContent(index, value);
        if (!result.ok) {
            alert(result.message || 'Failed to update linked content.');
            App.render();
            return;
        }
    },

    removeLinkedContent: async function(index) {
        if (!confirm('Remove this linked content option?')) return;
        const result = await DataService.removeLinkedContent(index);
        if (!result.ok) {
            alert(result.message || 'Failed to remove linked content.');
            return;
        }
        if (this.form.linkedContent && !DataService.getLinkedContents().includes(this.form.linkedContent)) {
            this.form.linkedContent = '';
        }
        App.render();
    },

    addClassifier: async function() {
        const input = document.getElementById('opl-classifier-new');
        const value = input ? input.value : '';
        const result = await DataService.addClassifier(value);
        if (!result.ok) {
            alert(result.message || 'Failed to add classifier.');
            return;
        }
        if (input) input.value = '';
        App.render();
    },

    updateClassifier: async function(index, value) {
        const result = await DataService.updateClassifier(index, value);
        if (!result.ok) {
            alert(result.message || 'Failed to update classifier.');
            App.render();
            return;
        }
    },

    removeClassifier: async function(index) {
        if (!confirm('Remove this classifier option?')) return;
        const result = await DataService.removeClassifier(index);
        if (!result.ok) {
            alert(result.message || 'Failed to remove classifier.');
            return;
        }
        if (this.form.classifier && !DataService.getClassifiers().includes(this.form.classifier)) {
            this.form.classifier = '';
        }
        App.render();
    },

    renderCollapsibleCard: function(config) {
        const collapsed = !!this.sections[config.key];
        return `
            <div class="opl-card opl-collapsible ${collapsed ? 'is-collapsed' : ''}">
                <button class="opl-collapsible-head" type="button" onclick="BackendUI.toggleSection('${config.key}')">
                    <div>
                        <h3>${config.title}</h3>
                        ${config.subtitle ? `<p class="opl-muted" style="margin-bottom:0;">${config.subtitle}</p>` : ''}
                    </div>
                    <div class="opl-collapsible-meta">
                        ${config.badge ? `<span class="opl-tag">${config.badge}</span>` : ''}
                        <i class="fas fa-chevron-down opl-collapsible-icon"></i>
                    </div>
                </button>
                <div class="opl-collapsible-body">
                    ${config.body}
                </div>
            </div>
        `;
    },

    render: function() {
        const esc = App.escapeHtml;
        const linkedContents = DataService.getLinkedContents();
        const classifiers = DataService.getClassifiers();
        const documents = DataService.getDocuments();

        const editingDoc = this.form.id ? DataService.getDocumentById(this.form.id) : null;

        const linkedRows = linkedContents.map((item, index) => `
            <tr>
                <td>
                    <input
                        type="text"
                        value="${esc(item)}"
                        onchange="BackendUI.updateLinkedContent(${index}, this.value)"
                        placeholder="Linked content label"
                    >
                </td>
                <td style="width:90px;">
                    <button class="btn-danger btn-sm" onclick="BackendUI.removeLinkedContent(${index})"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('');

        const classifierRows = classifiers.map((item, index) => `
            <tr>
                <td>
                    <input
                        type="text"
                        value="${esc(item)}"
                        onchange="BackendUI.updateClassifier(${index}, this.value)"
                        placeholder="Classifier label"
                    >
                </td>
                <td style="width:90px;">
                    <button class="btn-danger btn-sm" onclick="BackendUI.removeClassifier(${index})"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('');

        const docRows = documents.map((doc, index) => `
            <tr>
                <td>${index + 1}</td>
                <td>${esc(doc.docName)}</td>
                <td>${esc(doc.linkedContent)}</td>
                <td>${esc(doc.classifier || '')}</td>
                <td>${esc(doc.reviewDate || '')}</td>
                <td>${esc(doc.dateEdited || '')}</td>
                <td>${esc(doc.editedBy || '')}</td>
                <td class="opl-actions">
                    <button class="btn-secondary btn-sm" onclick="BackendUI.editDocument('${esc(doc.id)}')"><i class="fas fa-pen"></i> Edit</button>
                    <button class="btn-danger btn-sm" onclick="BackendUI.deleteDocument('${esc(doc.id)}')"><i class="fas fa-trash"></i> Delete</button>
                </td>
            </tr>
        `).join('');

        const linkedContentCard = this.renderCollapsibleCard({
            key: 'linked_content',
            title: 'Linked Content Builder',
            subtitle: 'Create and maintain the selectable Linked Content options used in DOC entries.',
            badge: `${linkedContents.length}`,
            body: `
                <div class="opl-grid-2" style="align-items:end;">
                    <div class="opl-field">
                        <label>Add Linked Content</label>
                        <input id="opl-linked-content-new" type="text" placeholder="e.g. Billing SOP, Troubleshooting Guide">
                    </div>
                    <div class="opl-actions">
                        <button class="btn-primary" onclick="BackendUI.addLinkedContent()"><i class="fas fa-plus"></i> Add Option</button>
                    </div>
                </div>
                <div class="opl-scroll-table" style="margin-top:14px;">
                    <table class="admin-table">
                        <thead><tr><th>Linked Content Option</th><th>Action</th></tr></thead>
                        <tbody>
                            ${linkedRows || '<tr><td colspan="2" style="color:var(--text-muted); text-align:center;">No linked content options yet.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            `
        });

        const classifierCard = this.renderCollapsibleCard({
            key: 'classifier',
            title: 'Classifier Builder',
            subtitle: 'Build an optional Classifier list that can be selected on DOC entries.',
            badge: `${classifiers.length}`,
            body: `
                <div class="opl-grid-2" style="align-items:end;">
                    <div class="opl-field">
                        <label>Add Classifier</label>
                        <input id="opl-classifier-new" type="text" placeholder="e.g. Process, Policy, Troubleshooting">
                    </div>
                    <div class="opl-actions">
                        <button class="btn-primary" onclick="BackendUI.addClassifier()"><i class="fas fa-plus"></i> Add Classifier</button>
                    </div>
                </div>
                <div class="opl-scroll-table" style="margin-top:14px;">
                    <table class="admin-table">
                        <thead><tr><th>Classifier Option</th><th>Action</th></tr></thead>
                        <tbody>
                            ${classifierRows || '<tr><td colspan="2" style="color:var(--text-muted); text-align:center;">No classifier options yet.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            `
        });

        const backendEntryCard = this.renderCollapsibleCard({
            key: 'backend_entry',
            title: 'Backend Data Entry',
            subtitle: 'Capture OPL document records for search and review planning.',
            body: `
                <div class="opl-grid-2">
                    <div class="opl-field">
                        <label>DOC Name</label>
                        <input
                            type="text"
                            value="${esc(this.form.docName)}"
                            oninput="BackendUI.setFormField('docName', this.value)"
                            placeholder="Type document name"
                        >
                    </div>
                    <div class="opl-field">
                        <label>Linked Content</label>
                        <select onchange="BackendUI.setFormField('linkedContent', this.value)">
                            <option value="">-- Select Linked Content --</option>
                            ${linkedContents.map(item => `<option value="${esc(item)}" ${this.form.linkedContent === item ? 'selected' : ''}>${esc(item)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="opl-field">
                        <label>Classifier (Optional)</label>
                        <select onchange="BackendUI.setFormField('classifier', this.value)">
                            <option value="">-- Optional Classifier --</option>
                            ${classifiers.map(item => `<option value="${esc(item)}" ${this.form.classifier === item ? 'selected' : ''}>${esc(item)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="opl-field">
                        <label>Review Date</label>
                        <input type="date" value="${esc(this.form.reviewDate)}" onchange="BackendUI.setFormField('reviewDate', this.value)">
                    </div>
                </div>

                <div class="opl-grid-2" style="margin-top:12px;">
                    <div class="opl-field">
                        <label>Date Edited (Auto)</label>
                        <input type="text" value="${esc(editingDoc ? (editingDoc.dateEdited || '') : 'Auto on save') }" readonly>
                    </div>
                    <div class="opl-field">
                        <label>Edited By (Auto)</label>
                        <input type="text" value="${esc(editingDoc ? (editingDoc.editedBy || '') : 'Auto on save') }" readonly>
                    </div>
                </div>

                <div class="opl-actions" style="margin-top:14px;">
                    <button class="btn-primary" onclick="BackendUI.saveDocument()">
                        <i class="fas fa-save"></i> ${this.form.id ? 'Update DOC Entry' : 'Save DOC Entry'}
                    </button>
                    <button class="btn-secondary" onclick="BackendUI.resetForm()"><i class="fas fa-rotate-left"></i> Clear</button>
                </div>
            `
        });

        const allEntriesCard = this.renderCollapsibleCard({
            key: 'all_entries',
            title: 'All Backend Entries',
            subtitle: 'Every DOC item captured above appears here and is searchable under OPL Search.',
            badge: `${documents.length}`,
            body: `
                <div class="opl-scroll-table">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>DOC Name</th>
                                <th>Linked Content</th>
                                <th>Classifier</th>
                                <th>Review Date</th>
                                <th>Date Edited</th>
                                <th>Edited By</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${docRows || '<tr><td colspan="8" style="color:var(--text-muted); text-align:center;">No DOC entries captured yet.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            `
        });

        return `
            <div class="opl-shell">
                ${linkedContentCard}
                ${classifierCard}
                ${backendEntryCard}
                ${allEntriesCard}
            </div>
        `;
    }
};

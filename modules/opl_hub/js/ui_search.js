/* ================= OPL HUB SEARCH UI ================= */

const SearchUI = {
    filters: {
        docName: '',
        linkedContent: '',
        classifier: '',
        reviewDate: '',
        dateEdited: ''
    },

    applySearch: function() {
        const read = (id) => {
            const el = document.getElementById(id);
            return el ? String(el.value || '').trim() : '';
        };

        this.filters = {
            docName: read('opl-search-doc-name'),
            linkedContent: read('opl-search-linked-content'),
            classifier: read('opl-search-classifier'),
            reviewDate: read('opl-search-review-date'),
            dateEdited: read('opl-search-date-edited')
        };
        App.render();
    },

    resetSearch: function() {
        this.filters = {
            docName: '',
            linkedContent: '',
            classifier: '',
            reviewDate: '',
            dateEdited: ''
        };
        App.render();
    },

    getFilteredDocuments: function() {
        const docs = DataService.getDocuments();
        const f = this.filters;

        return docs.filter(doc => {
            const docNameHit = !f.docName || (doc.docName || '').toLowerCase().includes(f.docName.toLowerCase());
            const linkedHit = !f.linkedContent || (doc.linkedContent || '').toLowerCase().includes(f.linkedContent.toLowerCase());
            const classifierHit = !f.classifier || (doc.classifier || '').toLowerCase().includes(f.classifier.toLowerCase());
            const reviewHit = !f.reviewDate || (doc.reviewDate || '') === f.reviewDate;
            const editedHit = !f.dateEdited || (doc.dateEdited || '') === f.dateEdited;
            return docNameHit && linkedHit && classifierHit && reviewHit && editedHit;
        });
    },

    render: function() {
        const esc = App.escapeHtml;
        const allDocs = DataService.getDocuments();
        const linkedOptions = DataService.getLinkedContents();
        const classifierOptions = DataService.getClassifiers();
        const results = this.getFilteredDocuments();

        const uniqueValues = (arr) => arr
            .map(item => String(item || '').trim())
            .filter(Boolean)
            .filter((item, index, src) => src.findIndex(other => other.toLowerCase() === item.toLowerCase()) === index);

        const docNameSuggestions = uniqueValues(allDocs.map(doc => doc.docName));
        const linkedSuggestions = uniqueValues(linkedOptions.concat(allDocs.map(doc => doc.linkedContent)));
        const classifierSuggestions = uniqueValues(classifierOptions.concat(allDocs.map(doc => doc.classifier)));

        const resultRows = results.map((doc, index) => `
            <tr>
                <td>${index + 1}</td>
                <td>${esc(doc.docName)}</td>
                <td>${esc(doc.linkedContent)}</td>
                <td>${esc(doc.classifier || '')}</td>
                <td>${esc(doc.reviewDate || '')}</td>
                <td>${esc(doc.dateEdited || '')}</td>
                <td>${esc(doc.editedBy || '')}</td>
            </tr>
        `).join('');

        return `
            <div class="opl-shell">
                <div class="opl-card">
                    <h3>OPL Search</h3>
                    <p class="opl-muted">Advanced search across DOC Name, Linked Content, Classifier, Review Date, and Date Edited.</p>

                    <div class="opl-grid-5">
                        <div class="opl-field">
                            <label>DOC Name</label>
                            <input id="opl-search-doc-name" list="opl-doc-name-list" type="text" value="${esc(this.filters.docName)}" placeholder="Start typing DOC name...">
                            <datalist id="opl-doc-name-list">
                                ${docNameSuggestions.map(name => `<option value="${esc(name)}"></option>`).join('')}
                            </datalist>
                        </div>
                        <div class="opl-field">
                            <label>Linked Content</label>
                            <input id="opl-search-linked-content" list="opl-linked-content-list" type="text" value="${esc(this.filters.linkedContent)}" placeholder="Start typing linked content...">
                            <datalist id="opl-linked-content-list">
                                ${linkedSuggestions.map(name => `<option value="${esc(name)}"></option>`).join('')}
                            </datalist>
                        </div>
                        <div class="opl-field">
                            <label>Classifier</label>
                            <input id="opl-search-classifier" list="opl-classifier-list" type="text" value="${esc(this.filters.classifier)}" placeholder="Start typing classifier...">
                            <datalist id="opl-classifier-list">
                                ${classifierSuggestions.map(name => `<option value="${esc(name)}"></option>`).join('')}
                            </datalist>
                        </div>
                        <div class="opl-field">
                            <label>Review Date</label>
                            <input id="opl-search-review-date" type="date" value="${esc(this.filters.reviewDate)}">
                        </div>
                        <div class="opl-field">
                            <label>Date Edited</label>
                            <input id="opl-search-date-edited" type="date" value="${esc(this.filters.dateEdited)}">
                        </div>
                    </div>

                    <div class="opl-actions" style="margin-top:14px;">
                        <button class="btn-primary" onclick="SearchUI.applySearch()"><i class="fas fa-search"></i> Search</button>
                        <button class="btn-secondary" onclick="SearchUI.resetSearch()"><i class="fas fa-rotate-left"></i> Reset</button>
                        <span class="opl-tag">${results.length} result(s)</span>
                    </div>
                </div>

                <div class="opl-card">
                    <h3>Search Results</h3>
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
                                </tr>
                            </thead>
                            <tbody>
                                ${resultRows || '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No matching records found.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }
};

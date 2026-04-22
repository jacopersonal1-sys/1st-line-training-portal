/* ================= CONTENT STUDIO FILE MANAGER UI ================= */

const FilesUI = {
    state: {
        search: '',
        type: 'all',
        deletingKey: ''
    },

    setSearch: function(value) {
        this.state.search = String(value || '');
        App.render();
    },

    setType: function(value) {
        const type = String(value || '').trim().toLowerCase();
        this.state.type = (type === 'video' || type === 'document') ? type : 'all';
        App.render();
    },

    formatDateTime: function(value) {
        if (!value) return '-';
        const dt = new Date(value);
        if (Number.isNaN(dt.getTime())) return '-';
        return dt.toLocaleString();
    },

    deleteAsset: async function(key, bucket, path, type, fileName) {
        const safeName = String(fileName || 'file').trim() || 'file';
        if (!confirm(`Delete uploaded ${type} file "${safeName}" from storage and unlink it from subjects?`)) return;

        this.state.deletingKey = String(key || '');
        App.render();
        try {
            const result = await DataService.deleteUploadedAsset(bucket, path, type);
            if (!result || !result.ok) {
                alert(result && result.message ? result.message : 'Could not delete this file.');
                return;
            }

            if (AppContext && AppContext.host && typeof AppContext.host.showToast === 'function') {
                AppContext.host.showToast(result.message || 'File deleted and unlinked.', 'success');
            }
            await DataService.loadInitialData();
        } finally {
            this.state.deletingKey = '';
            App.render();
        }
    },

    render: function() {
        const esc = App.escapeHtml;
        const allFiles = DataService.getLinkedUploadedFiles();
        const term = String(this.state.search || '').trim().toLowerCase();
        const typeFilter = this.state.type;

        const files = allFiles.filter(file => {
            if (typeFilter !== 'all' && String(file.type || '') !== typeFilter) return false;
            if (!term) return true;
            const haystack = [
                file.fileName,
                file.bucket,
                file.path,
                ...(Array.isArray(file.references) ? file.references.map(ref => `${ref.entryLabel} ${ref.subjectCode} ${ref.subjectTitle}`) : [])
            ].join(' ').toLowerCase();
            return haystack.includes(term);
        });

        const totalRefs = allFiles.reduce((sum, file) => sum + (Array.isArray(file.references) ? file.references.length : 0), 0);
        const totalVideos = allFiles.filter(file => String(file.type) === 'video').length;
        const totalDocs = allFiles.filter(file => String(file.type) === 'document').length;

        const rows = files.map((file, idx) => {
            const refs = Array.isArray(file.references) ? file.references : [];
            const firstRef = refs[0] || {};
            const extraRefs = refs.length > 1 ? ` +${refs.length - 1} more` : '';
            const deleting = this.state.deletingKey && this.state.deletingKey === String(file.key || '');
            return `
                <tr>
                    <td>${idx + 1}</td>
                    <td>${esc(file.type === 'video' ? 'Video' : 'Document')}</td>
                    <td>
                        <div style="font-weight:700;">${esc(file.fileName || '-')}</div>
                        <div class="cs-muted" style="font-size:0.78rem;">${esc(file.bucket || '-')} / ${esc(file.path || '-')}</div>
                    </td>
                    <td>${esc(firstRef.entryLabel || '-')}</td>
                    <td>${esc(firstRef.subjectCode || '-')} - ${esc(firstRef.subjectTitle || '-')}<span class="cs-muted">${esc(extraRefs)}</span></td>
                    <td>${refs.length}</td>
                    <td>${esc(this.formatDateTime(file.updatedAt))}</td>
                    <td class="cs-actions-cell">
                        <button class="btn-danger btn-sm" ${deleting ? 'disabled' : ''} onclick="FilesUI.deleteAsset('${esc(file.key)}', '${esc(file.bucket)}', '${esc(file.path)}', '${esc(file.type)}', '${esc(file.fileName)}')">
                            ${deleting ? '<i class="fas fa-circle-notch fa-spin"></i> Deleting...' : '<i class="fas fa-trash"></i> Delete'}
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        return `
            <div class="cs-shell">
                <div class="cs-toolbar">
                    <div class="cs-field">
                        <label>Search Uploaded Files</label>
                        <input type="text" value="${esc(this.state.search || '')}" oninput="FilesUI.setSearch(this.value)" placeholder="Search filename, path, module, or subject">
                    </div>
                    <div class="cs-field">
                        <label>Type Filter</label>
                        <select onchange="FilesUI.setType(this.value)">
                            <option value="all" ${this.state.type === 'all' ? 'selected' : ''}>All Files</option>
                            <option value="video" ${this.state.type === 'video' ? 'selected' : ''}>Videos</option>
                            <option value="document" ${this.state.type === 'document' ? 'selected' : ''}>Documents</option>
                        </select>
                    </div>
                    <div class="cs-file-stats">
                        <div class="cs-file-stat"><span>${allFiles.length}</span><small>Total Files</small></div>
                        <div class="cs-file-stat"><span>${totalVideos}</span><small>Videos</small></div>
                        <div class="cs-file-stat"><span>${totalDocs}</span><small>Documents</small></div>
                        <div class="cs-file-stat"><span>${totalRefs}</span><small>Linked Refs</small></div>
                    </div>
                </div>

                <div class="cs-builder-card">
                    <h3>Uploaded File Manager</h3>
                    <p class="cs-muted">Shows all uploaded files currently linked to Content Creator subjects. Deleting removes the storage file and unlinks it from linked subjects.</p>
                    <div class="cs-table-wrap">
                        <table class="admin-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Type</th>
                                    <th>File</th>
                                    <th>Module</th>
                                    <th>Subject</th>
                                    <th>Links</th>
                                    <th>Updated</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows || '<tr><td colspan="8" style="text-align:center; color:var(--cs-muted);">No uploaded files found for the current filter.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }
};

window.FilesUI = FilesUI;

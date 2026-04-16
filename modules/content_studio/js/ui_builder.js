/* ================= CONTENT STUDIO BUILDER UI ================= */

const BuilderUI = {
    state: {
        uploading: {
            video: false,
            document: false
        },
        form: {
            id: '',
            code: '',
            textHtml: '',
            hasVideo: false,
            videoMode: 'url',
            videoUrl: '',
            videoPath: '',
            videoBucket: '',
            hasDocument: false,
            docMode: 'url',
            docUrl: '',
            docPath: '',
            docBucket: ''
        }
    },

    initDefault: function() {
        const entry = DataService.getPrimaryEntry();
        if (!this.state.form.code) {
            const base = (entry && entry.subjects && entry.subjects.length + 1) || 1;
            this.state.form.code = `1.1.${base}`;
        }
        if (!this.state.form.videoMode) this.state.form.videoMode = 'url';
        if (!this.state.form.docMode) this.state.form.docMode = 'url';
    },

    _syncFormFromInputs: function() {
        const codeInput = document.getElementById('cs-subject-code');
        const editor = document.getElementById('cs-subject-editor');
        const videoInput = document.getElementById('cs-subject-video');
        const docInput = document.getElementById('cs-subject-doc');
        const videoUploaded = document.getElementById('cs-subject-video-uploaded');
        const docUploaded = document.getElementById('cs-subject-doc-uploaded');

        if (codeInput) this.state.form.code = codeInput.value;
        if (editor) this.state.form.textHtml = editor.innerHTML;

        if (this.state.form.videoMode === 'url') {
            if (videoInput) this.state.form.videoUrl = videoInput.value;
            this.state.form.videoPath = '';
            this.state.form.videoBucket = '';
        } else {
            if (videoUploaded) this.state.form.videoUrl = videoUploaded.value;
        }

        if (this.state.form.docMode === 'url') {
            if (docInput) this.state.form.docUrl = docInput.value;
            this.state.form.docPath = '';
            this.state.form.docBucket = '';
        } else {
            if (docUploaded) this.state.form.docUrl = docUploaded.value;
        }
    },

    saveHeader: async function() {
        const headerInput = document.getElementById('cs-header-input');
        const header = headerInput ? headerInput.value : '';
        const result = await DataService.upsertEntryMeta({
            scheduleKey: 'content_creator_default',
            scheduleLabel: 'Content Creator',
            header
        });
        if (!result.ok) {
            alert(result.message || 'Could not save header.');
            return;
        }
        App.render();
    },

    editSubject: function(subjectId) {
        const entry = DataService.getPrimaryEntry();
        if (!entry) return;
        const subject = DataService.getSubjectById(entry.scheduleKey, subjectId);
        if (!subject) return;

        this.state.form = {
            id: subject.id,
            code: subject.code || '',
            textHtml: subject.textHtml || '',
            hasVideo: !!subject.hasVideo,
            videoMode: subject.videoMode || (subject.videoPath ? 'upload' : 'url'),
            videoUrl: subject.videoUrl || '',
            videoPath: subject.videoPath || '',
            videoBucket: subject.videoBucket || '',
            hasDocument: !!subject.hasDocument,
            docMode: subject.docMode || (subject.docPath ? 'upload' : 'url'),
            docUrl: subject.docUrl || '',
            docPath: subject.docPath || '',
            docBucket: subject.docBucket || ''
        };
        App.render();
        const editor = document.getElementById('cs-subject-editor');
        if (editor) editor.innerHTML = this.state.form.textHtml || '';
    },

    resetSubjectForm: function() {
        this.state.form = {
            id: '',
            code: '',
            textHtml: '',
            hasVideo: false,
            videoMode: 'url',
            videoUrl: '',
            videoPath: '',
            videoBucket: '',
            hasDocument: false,
            docMode: 'url',
            docUrl: '',
            docPath: '',
            docBucket: ''
        };
        this.state.uploading.video = false;
        this.state.uploading.document = false;
    },

    setHasVideo: function(flag) {
        this._syncFormFromInputs();
        this.state.form.hasVideo = !!flag;
        if (!flag) {
            this.state.form.videoUrl = '';
            this.state.form.videoPath = '';
            this.state.form.videoBucket = '';
        }
        App.render();
    },

    setHasDocument: function(flag) {
        this._syncFormFromInputs();
        this.state.form.hasDocument = !!flag;
        if (!flag) {
            this.state.form.docUrl = '';
            this.state.form.docPath = '';
            this.state.form.docBucket = '';
        }
        App.render();
    },

    setVideoMode: function(mode) {
        this._syncFormFromInputs();
        this.state.form.videoMode = (mode === 'upload') ? 'upload' : 'url';
        if (this.state.form.videoMode === 'url') {
            this.state.form.videoPath = '';
            this.state.form.videoBucket = '';
        }
        App.render();
    },

    setDocMode: function(mode) {
        this._syncFormFromInputs();
        this.state.form.docMode = (mode === 'upload') ? 'upload' : 'url';
        if (this.state.form.docMode === 'url') {
            this.state.form.docPath = '';
            this.state.form.docBucket = '';
        }
        App.render();
    },

    uploadVideoFile: async function() {
        this._syncFormFromInputs();
        const fileInput = document.getElementById('cs-subject-video-file');
        const file = fileInput && fileInput.files ? fileInput.files[0] : null;
        if (!file) {
            alert('Select a video file first.');
            return;
        }

        this.state.uploading.video = true;
        App.render();
        try {
            const res = await DataService.uploadVideoFile(file);
            if (!res.ok) {
                alert(res.message || 'Video upload failed.');
                return;
            }
            this.state.form.hasVideo = true;
            this.state.form.videoMode = 'upload';
            this.state.form.videoUrl = res.url || '';
            this.state.form.videoPath = res.path || '';
            this.state.form.videoBucket = res.bucket || '';
        } finally {
            this.state.uploading.video = false;
            App.render();
        }
    },

    uploadDocumentFile: async function() {
        this._syncFormFromInputs();
        const fileInput = document.getElementById('cs-subject-doc-file');
        const file = fileInput && fileInput.files ? fileInput.files[0] : null;
        if (!file) {
            alert('Select a PDF file first.');
            return;
        }

        const isPdf = String(file.type || '').toLowerCase() === 'application/pdf'
            || String(file.name || '').toLowerCase().endsWith('.pdf');
        if (!isPdf) {
            alert('Only PDF files are allowed for document upload.');
            return;
        }

        this.state.uploading.document = true;
        App.render();
        try {
            const res = await DataService.uploadDocumentFile(file);
            if (!res.ok) {
                alert(res.message || 'Document upload failed.');
                return;
            }
            this.state.form.hasDocument = true;
            this.state.form.docMode = 'upload';
            this.state.form.docUrl = res.url || '';
            this.state.form.docPath = res.path || '';
            this.state.form.docBucket = res.bucket || '';
        } finally {
            this.state.uploading.document = false;
            App.render();
        }
    },

    saveSubject: async function() {
        this._syncFormFromInputs();

        const payload = {
            id: this.state.form.id || '',
            code: this.state.form.code,
            textHtml: this.state.form.textHtml,
            hasVideo: !!this.state.form.hasVideo,
            videoMode: this.state.form.videoMode,
            videoUrl: this.state.form.videoUrl,
            videoPath: this.state.form.videoPath,
            videoBucket: this.state.form.videoBucket,
            hasDocument: !!this.state.form.hasDocument,
            docMode: this.state.form.docMode,
            docUrl: this.state.form.docUrl,
            docPath: this.state.form.docPath,
            docBucket: this.state.form.docBucket
        };

        const headerInput = document.getElementById('cs-header-input');
        const currentEntry = DataService.getPrimaryEntry();
        if (!currentEntry) {
            await DataService.upsertEntryMeta({
                scheduleKey: 'content_creator_default',
                scheduleLabel: 'Content Creator',
                header: (headerInput && headerInput.value) ? headerInput.value : 'Content Creator'
            });
        }

        const targetEntry = DataService.getPrimaryEntry();
        const targetKey = targetEntry ? targetEntry.scheduleKey : 'content_creator_default';
        const result = await DataService.upsertSubject(targetKey, payload);
        if (!result.ok) {
            alert(result.message || 'Could not save subject.');
            return;
        }

        this.resetSubjectForm();
        App.render();
    },

    deleteSubject: async function(subjectId) {
        if (!confirm('Delete this subject?')) return;
        const entry = DataService.getPrimaryEntry();
        if (!entry) return;
        const result = await DataService.deleteSubject(entry.scheduleKey, subjectId);
        if (!result.ok) {
            alert(result.message || 'Could not delete subject.');
            return;
        }
        if (this.state.form.id === subjectId) this.resetSubjectForm();
        App.render();
    },

    _renderToggleButtons: function(name, isYes, yesFn, noFn) {
        return `
            <div class="cs-toggle-row">
                <span class="cs-toggle-title">${name}</span>
                <div class="cs-toggle-group">
                    <button type="button" class="cs-toggle-btn ${isYes ? 'active' : ''}" onclick="${yesFn}">Yes</button>
                    <button type="button" class="cs-toggle-btn ${!isYes ? 'active' : ''}" onclick="${noFn}">No</button>
                </div>
            </div>
        `;
    },

    render: function() {
        this.initDefault();
        const esc = App.escapeHtml;
        const entry = DataService.getPrimaryEntry();
        const subjects = entry ? (entry.subjects || []) : [];

        const currentCode = this.state.form.code || `1.1.${subjects.length + 1}`;
        const currentHtml = this.state.form.textHtml || '';

        const subjectRows = subjects.map((subject, idx) => {
            const allStats = DataService.getAllSubjectAnalytics(entry.id, subject.id);
            const watch = allStats.reduce((sum, r) => sum + Number(r.watchSeconds || 0), 0);
            const skips = allStats.reduce((sum, r) => sum + Number(r.skips || 0), 0);
            const plays = allStats.reduce((sum, r) => sum + Number(r.plays || 0), 0);

            const videoStatus = subject.hasVideo ? (subject.videoUrl ? 'Enabled' : 'Enabled (No Link)') : 'Disabled';
            const docStatus = subject.hasDocument ? (subject.docUrl ? 'Enabled' : 'Enabled (No Link)') : 'Disabled';

            return `
                <tr>
                    <td>${idx + 1}</td>
                    <td>${esc(subject.code)}</td>
                    <td>${esc(ContentStudioUtils.stripHtml(subject.textHtml).slice(0, 120))}</td>
                    <td>${esc(videoStatus)}</td>
                    <td>${esc(docStatus)}</td>
                    <td>Plays ${plays} | Watch ${Math.round(watch)}s | Skips ${skips}</td>
                    <td class="cs-actions-cell">
                        <button class="btn-secondary btn-sm" onclick="BuilderUI.editSubject('${esc(subject.id)}')"><i class="fas fa-pen"></i></button>
                        <button class="btn-danger btn-sm" onclick="BuilderUI.deleteSubject('${esc(subject.id)}')"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `;
        }).join('');

        const videoControls = this.state.form.hasVideo ? `
            <div class="cs-upload-box">
                <div class="cs-toggle-row">
                    <span class="cs-toggle-title">Video Source</span>
                    <div class="cs-toggle-group">
                        <button type="button" class="cs-toggle-btn ${this.state.form.videoMode === 'url' ? 'active' : ''}" onclick="BuilderUI.setVideoMode('url')">HTTP Link</button>
                        <button type="button" class="cs-toggle-btn ${this.state.form.videoMode === 'upload' ? 'active' : ''}" onclick="BuilderUI.setVideoMode('upload')">Upload</button>
                    </div>
                </div>

                ${this.state.form.videoMode === 'url' ? `
                    <div class="cs-field">
                        <label>Video Link</label>
                        <input id="cs-subject-video" type="text" value="${esc(this.state.form.videoUrl || '')}" placeholder="https://...">
                    </div>
                ` : `
                    <div class="cs-upload-row">
                        <input id="cs-subject-video-file" type="file" accept="video/*">
                        <button type="button" class="btn-secondary" onclick="BuilderUI.uploadVideoFile()" ${this.state.uploading.video ? 'disabled' : ''}>
                            ${this.state.uploading.video ? '<i class="fas fa-circle-notch fa-spin"></i> Uploading...' : '<i class="fas fa-upload"></i> Upload Video'}
                        </button>
                    </div>
                    <div class="cs-field">
                        <label>Uploaded Video URL</label>
                        <input id="cs-subject-video-uploaded" type="text" value="${esc(this.state.form.videoUrl || '')}" readonly>
                    </div>
                `}
            </div>
        ` : '';

        const documentControls = this.state.form.hasDocument ? `
            <div class="cs-upload-box">
                <div class="cs-toggle-row">
                    <span class="cs-toggle-title">Document Source</span>
                    <div class="cs-toggle-group">
                        <button type="button" class="cs-toggle-btn ${this.state.form.docMode === 'url' ? 'active' : ''}" onclick="BuilderUI.setDocMode('url')">HTTP Link</button>
                        <button type="button" class="cs-toggle-btn ${this.state.form.docMode === 'upload' ? 'active' : ''}" onclick="BuilderUI.setDocMode('upload')">Upload PDF</button>
                    </div>
                </div>

                ${this.state.form.docMode === 'url' ? `
                    <div class="cs-field">
                        <label>Document Link</label>
                        <input id="cs-subject-doc" type="text" value="${esc(this.state.form.docUrl || '')}" placeholder="https://...">
                    </div>
                ` : `
                    <div class="cs-upload-row">
                        <input id="cs-subject-doc-file" type="file" accept="application/pdf,.pdf">
                        <button type="button" class="btn-secondary" onclick="BuilderUI.uploadDocumentFile()" ${this.state.uploading.document ? 'disabled' : ''}>
                            ${this.state.uploading.document ? '<i class="fas fa-circle-notch fa-spin"></i> Uploading...' : '<i class="fas fa-upload"></i> Upload PDF'}
                        </button>
                    </div>
                    <div class="cs-field">
                        <label>Uploaded Document URL</label>
                        <input id="cs-subject-doc-uploaded" type="text" value="${esc(this.state.form.docUrl || '')}" readonly>
                    </div>
                `}
            </div>
        ` : '';

        return `
            <div class="cs-shell">
                <div class="cs-toolbar">
                    <div class="cs-field">
                        <label>Header</label>
                        <input id="cs-header-input" type="text" value="${esc((entry && entry.header) || 'Content Creator')}" placeholder="Header goes here">
                    </div>
                    <div class="cs-field cs-field-end">
                        <button class="btn-primary" onclick="BuilderUI.saveHeader()"><i class="fas fa-save"></i> Save Header</button>
                    </div>
                </div>

                <div class="cs-builder-grid">
                    <div class="cs-builder-card">
                        <h3>Subject Builder</h3>
                        <p class="cs-muted">Create subject text, then choose optional video/document support and source type.</p>

                        <div class="cs-field">
                            <label>Subject Number</label>
                            <input id="cs-subject-code" type="text" value="${esc(currentCode)}" placeholder="1.1.1">
                        </div>

                        <div class="cs-field">
                            <label>Subject Text (Custom Rich Text)</label>
                            <div id="cs-subject-editor" class="cs-rich-editor" contenteditable="true">${currentHtml}</div>
                        </div>

                        <div class="cs-feature-section">
                            ${this._renderToggleButtons('Include Video', this.state.form.hasVideo, 'BuilderUI.setHasVideo(true)', 'BuilderUI.setHasVideo(false)')}
                            ${videoControls}
                            ${this._renderToggleButtons('Include Document', this.state.form.hasDocument, 'BuilderUI.setHasDocument(true)', 'BuilderUI.setHasDocument(false)')}
                            ${documentControls}
                        </div>

                        <div class="cs-actions-row">
                            <button class="btn-primary" onclick="BuilderUI.saveSubject()"><i class="fas fa-floppy-disk"></i> ${this.state.form.id ? 'Update Subject' : 'Save Subject'}</button>
                            <button class="btn-secondary" onclick="BuilderUI.resetSubjectForm(); App.render();"><i class="fas fa-rotate-left"></i> Clear</button>
                        </div>
                    </div>

                    <div class="cs-builder-card">
                        <h3>Subjects Built</h3>
                        <p class="cs-muted">Play/Document icons in View appear only when enabled and linked.</p>
                        <div class="cs-table-wrap">
                            <table class="admin-table">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Code</th>
                                        <th>Subject</th>
                                        <th>Video</th>
                                        <th>Document</th>
                                        <th>Engagement</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${subjectRows || '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No subjects yet.</td></tr>'}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
};

window.BuilderUI = BuilderUI;

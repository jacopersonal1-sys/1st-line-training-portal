/* ================= CONTENT STUDIO BUILDER UI ================= */

const BuilderUI = {
    state: {
        selectedScheduleKey: '',
        form: {
            id: '',
            code: '',
            textHtml: '',
            videoUrl: '',
            docUrl: ''
        }
    },

    initDefault: function() {
        const options = DataService.getScheduleOptions();
        if (!this.state.selectedScheduleKey && options.length) {
            this.state.selectedScheduleKey = options[0].key;
        }

        const entry = DataService.getEntryByScheduleKey(this.state.selectedScheduleKey);
        if (!this.state.form.code) {
            const base = (entry && entry.subjects && entry.subjects.length + 1) || 1;
            this.state.form.code = `1.1.${base}`;
        }
    },

    setScheduleKey: function(value) {
        this.state.selectedScheduleKey = value;
        this.resetSubjectForm();
        App.render();
    },

    getSelectedScheduleOption: function() {
        return DataService.getScheduleOptions().find(o => o.key === this.state.selectedScheduleKey) || null;
    },

    saveHeader: async function() {
        const option = this.getSelectedScheduleOption();
        if (!option) {
            alert('Select a schedule timeline item first.');
            return;
        }

        const headerInput = document.getElementById('cs-header-input');
        const header = headerInput ? headerInput.value : '';
        const result = await DataService.upsertEntryMeta({
            scheduleKey: option.key,
            scheduleLabel: option.label,
            header
        });
        if (!result.ok) {
            alert(result.message || 'Could not save header.');
            return;
        }
        App.render();
    },

    editSubject: function(subjectId) {
        const subject = DataService.getSubjectById(this.state.selectedScheduleKey, subjectId);
        if (!subject) return;

        this.state.form = {
            id: subject.id,
            code: subject.code || '',
            textHtml: subject.textHtml || '',
            videoUrl: subject.videoUrl || '',
            docUrl: subject.docUrl || ''
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
            videoUrl: '',
            docUrl: ''
        };
    },

    saveSubject: async function() {
        const option = this.getSelectedScheduleOption();
        if (!option) {
            alert('Select a schedule timeline item first.');
            return;
        }

        const codeInput = document.getElementById('cs-subject-code');
        const videoInput = document.getElementById('cs-subject-video');
        const docInput = document.getElementById('cs-subject-doc');
        const editor = document.getElementById('cs-subject-editor');

        const payload = {
            id: this.state.form.id || '',
            code: codeInput ? codeInput.value : this.state.form.code,
            textHtml: editor ? editor.innerHTML : this.state.form.textHtml,
            videoUrl: videoInput ? videoInput.value : this.state.form.videoUrl,
            docUrl: docInput ? docInput.value : this.state.form.docUrl
        };

        const headerInput = document.getElementById('cs-header-input');
        const currentEntry = DataService.getEntryByScheduleKey(option.key);
        if (!currentEntry) {
            await DataService.upsertEntryMeta({
                scheduleKey: option.key,
                scheduleLabel: option.label,
                header: (headerInput && headerInput.value) ? headerInput.value : option.label
            });
        }

        const result = await DataService.upsertSubject(option.key, payload);
        if (!result.ok) {
            alert(result.message || 'Could not save subject.');
            return;
        }

        this.resetSubjectForm();
        App.render();
    },

    deleteSubject: async function(subjectId) {
        if (!confirm('Delete this subject?')) return;
        const result = await DataService.deleteSubject(this.state.selectedScheduleKey, subjectId);
        if (!result.ok) {
            alert(result.message || 'Could not delete subject.');
            return;
        }
        if (this.state.form.id === subjectId) this.resetSubjectForm();
        App.render();
    },

    render: function() {
        this.initDefault();
        const esc = App.escapeHtml;
        const options = DataService.getScheduleOptions();
        const entry = DataService.getEntryByScheduleKey(this.state.selectedScheduleKey);
        const subjects = entry ? (entry.subjects || []) : [];

        const currentCode = this.state.form.code || `1.1.${subjects.length + 1}`;
        const currentHtml = this.state.form.textHtml || '';

        const subjectRows = subjects.map((subject, idx) => {
            const allStats = DataService.getAllSubjectAnalytics(entry.id, subject.id);
            const watch = allStats.reduce((sum, r) => sum + Number(r.watchSeconds || 0), 0);
            const skips = allStats.reduce((sum, r) => sum + Number(r.skips || 0), 0);
            const plays = allStats.reduce((sum, r) => sum + Number(r.plays || 0), 0);

            return `
                <tr>
                    <td>${idx + 1}</td>
                    <td>${esc(subject.code)}</td>
                    <td>${esc(ContentStudioUtils.stripHtml(subject.textHtml).slice(0, 120))}</td>
                    <td>${esc(subject.videoUrl || '')}</td>
                    <td>${esc(subject.docUrl || '')}</td>
                    <td>Plays ${plays} | Watch ${Math.round(watch)}s | Skips ${skips}</td>
                    <td class="cs-actions-cell">
                        <button class="btn-secondary btn-sm" onclick="BuilderUI.editSubject('${esc(subject.id)}')"><i class="fas fa-pen"></i></button>
                        <button class="btn-danger btn-sm" onclick="BuilderUI.deleteSubject('${esc(subject.id)}')"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `;
        }).join('');

        return `
            <div class="cs-shell">
                <div class="cs-toolbar">
                    <div class="cs-field">
                        <label>Schedule Timeline Item</label>
                        <select onchange="BuilderUI.setScheduleKey(this.value)">
                            <option value="">-- Select Timeline Item --</option>
                            ${options.map(opt => `<option value="${esc(opt.key)}" ${this.state.selectedScheduleKey === opt.key ? 'selected' : ''}>${esc(opt.label)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="cs-field">
                        <label>Header</label>
                        <input id="cs-header-input" type="text" value="${esc((entry && entry.header) || (this.getSelectedScheduleOption() ? this.getSelectedScheduleOption().label : ''))}" placeholder="Header goes here">
                    </div>
                    <div class="cs-field cs-field-end">
                        <button class="btn-primary" onclick="BuilderUI.saveHeader()"><i class="fas fa-save"></i> Save Header</button>
                    </div>
                </div>

                <div class="cs-builder-grid">
                    <div class="cs-builder-card">
                        <h3>Subject Builder</h3>
                        <p class="cs-muted">Create subject text (rich formatting), video link, and document link for this timeline item.</p>

                        <div class="cs-field">
                            <label>Subject Number</label>
                            <input id="cs-subject-code" type="text" value="${esc(currentCode)}" placeholder="1.1.1">
                        </div>

                        <div class="cs-field">
                            <label>Subject Text (Custom Rich Text)</label>
                            <div id="cs-subject-editor" class="cs-rich-editor" contenteditable="true">${currentHtml}</div>
                        </div>

                        <div class="cs-field">
                            <label>Video Link</label>
                            <input id="cs-subject-video" type="text" value="${esc(this.state.form.videoUrl || '')}" placeholder="https://...">
                        </div>

                        <div class="cs-field">
                            <label>Document Link</label>
                            <input id="cs-subject-doc" type="text" value="${esc(this.state.form.docUrl || '')}" placeholder="https://...">
                        </div>

                        <div class="cs-actions-row">
                            <button class="btn-primary" onclick="BuilderUI.saveSubject()"><i class="fas fa-floppy-disk"></i> ${this.state.form.id ? 'Update Subject' : 'Save Subject'}</button>
                            <button class="btn-secondary" onclick="BuilderUI.resetSubjectForm(); App.render();"><i class="fas fa-rotate-left"></i> Clear</button>
                        </div>
                    </div>

                    <div class="cs-builder-card">
                        <h3>Subjects Built</h3>
                        <p class="cs-muted">This list becomes the View document body with play and document buttons.</p>
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

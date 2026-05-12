/* ================= Q&A HUB MODULE ENTRY ================= */
const App = {
    store: QAData.defaultStore(),
    selectedId: null,
    mode: 'new',
    resources: [],

    async init() {
        const root = document.getElementById('qa-app');
        if (!root) return;
        root.innerHTML = '<div class="qa-card loading"><i class="fas fa-circle-notch fa-spin"></i><p>Loading Q&A Hub...</p></div>';
        try {
            this.store = await QAData.load();
            const visibleQuestions = this.store.questions.filter(q => q.status !== 'deleted');
            this.mode = visibleQuestions.length ? 'edit' : 'new';
            this.selectedId = visibleQuestions[0]?.id || null;
            this.resources = this.selectedQuestion()?.resources?.map(r => ({ ...r })) || [];
            this.render();
        } catch (error) {
            this.handleError(error, 'Q&A Hub could not load.');
            this.store = QAData.defaultStore();
            this.mode = 'new';
            this.selectedId = null;
            this.resources = [];
            this.render();
        }
    },

    isAllowed() {
        const role = AppContext.user ? AppContext.user.role : '';
        return role === 'admin' || role === 'super_admin';
    },

    esc(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    selectedQuestion() {
        return this.store.questions.find(q => String(q.id || '') === String(this.selectedId || '') && q.status !== 'deleted') || null;
    },

    iconFor(type) {
        if (type === 'sharepoint_video' || type === 'sharepoint_link') return 'fa-cloud-arrow-up';
        if (type === 'video') return 'fa-circle-play';
        if (type === 'image') return 'fa-image';
        if (type === 'pdf') return 'fa-file-pdf';
        if (type === 'audio') return 'fa-file-audio';
        if (type === 'office') return 'fa-file-word';
        if (type === 'archive') return 'fa-file-zipper';
        return 'fa-file-lines';
    },

    formatDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'Unknown date';
        return date.toLocaleString();
    },

    inferResourceType(file, selectedType, url = '') {
        const mime = String(file?.type || '').toLowerCase();
        const name = String(file?.name || url || '').toLowerCase();
        const selected = String(selectedType || '').toLowerCase();
        if (selected === 'sharepoint_video' || selected === 'sharepoint_link') return selected;
        if (!file && /sharepoint\.com|1drv\.ms|office\.com|microsoftstream\.com|stream\.office\.com/i.test(String(url || ''))) {
            return selected === 'video' ? 'sharepoint_video' : 'sharepoint_link';
        }
        if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(name)) return 'image';
        if (mime.startsWith('video/') || /\.(mp4|webm|ogg|mov|m4v|avi|mkv)$/i.test(name)) return 'video';
        if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)) return 'audio';
        if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
        if (mime.startsWith('text/') || /\.(txt|csv|log|md|json|xml|html|css|js)$/i.test(name)) return 'text';
        if (/\.(docx?|pptx?|xlsx?|odt|ods|odp|rtf)$/i.test(name) || /(word|excel|spreadsheet|powerpoint|presentation|officedocument)/i.test(mime)) return 'office';
        if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return 'archive';
        return selectedType || 'document';
    },

    render() {
        const root = document.getElementById('qa-app');
        if (!root) return;

        if (!this.isAllowed()) {
            root.innerHTML = '<div class="qa-card denied"><h3>Access Restricted</h3><p>Q&A Hub is available to Admin and Super Admin users only.</p></div>';
            return;
        }

        const selected = this.mode === 'new' ? null : this.selectedQuestion();
        const questions = [...this.store.questions]
            .filter(q => q.status !== 'deleted')
            .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        const submissions = [...this.store.submissions].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        const published = questions.filter(q => q.status !== 'draft').length;
        const pending = submissions.filter(s => s.status === 'new').length;

        root.innerHTML = `
            <div class="qa-shell">
                <header class="qa-hero">
                    <div>
                        <h1><i class="fas fa-circle-question"></i> Q&A Hub</h1>
                        <p>Build trainee-facing FAQ answers with document, picture, and video resources.</p>
                    </div>
                    <div class="qa-stats">
                        <span><strong>${questions.length}</strong>Total</span>
                        <span><strong>${published}</strong>Published</span>
                        <span><strong>${pending}</strong>New asks</span>
                    </div>
                </header>

                <main class="qa-layout">
                    <aside class="qa-card qa-library">
                        <div class="qa-card-head">
                            <h2>FAQ Library</h2>
                            <button type="button" class="qa-btn primary" id="qa-new-btn"><i class="fas fa-plus"></i> New</button>
                        </div>
                        <input id="qa-search" type="search" placeholder="Search questions...">
                        <div class="qa-list" id="qa-list">
                            ${questions.length ? questions.map(q => this.renderQuestionRow(q)).join('') : '<div class="qa-empty">No FAQ questions yet. Click New to create one.</div>'}
                        </div>
                    </aside>

                    <section class="qa-card qa-builder">
                        <div class="qa-card-head">
                            <h2>${this.mode === 'new' ? 'New FAQ Question' : 'Edit FAQ Question'}</h2>
                            ${selected ? '<button type="button" class="qa-btn ghost danger" id="qa-delete-btn"><i class="fas fa-trash"></i> Delete</button>' : ''}
                        </div>
                        ${this.renderBuilder(selected)}
                    </section>
                </main>

                <section class="qa-card qa-submissions">
                    <div class="qa-card-head">
                        <h2>Trainee Questions</h2>
                        <button type="button" class="qa-btn ghost" id="qa-refresh-btn"><i class="fas fa-rotate-right"></i> Refresh</button>
                    </div>
                    <div class="qa-submission-list">
                        ${submissions.length ? submissions.map(s => this.renderSubmission(s)).join('') : '<div class="qa-empty">No trainee questions submitted yet.</div>'}
                    </div>
                </section>
            </div>
        `;

        this.bindEvents();
    },

    renderQuestionRow(q) {
        const active = this.mode !== 'new' && String(q.id || '') === String(this.selectedId || '') ? ' active' : '';
        const resources = Array.isArray(q.resources) ? q.resources.length : 0;
        return `
            <button type="button" class="qa-row${active}" data-id="${this.esc(q.id)}" data-search="${this.esc(`${q.question} ${q.answer} ${(q.tags || []).join(' ')}`.toLowerCase())}">
                <span>${this.esc(q.question)}</span>
                <small>${this.esc(q.status)} &middot; ${resources} resource${resources === 1 ? '' : 's'}</small>
            </button>
        `;
    },

    renderBuilder(q) {
        const question = q || { question: '', answer: '', tags: [], status: 'published' };
        return `
            ${this.mode === 'new' ? '<div class="qa-draft"><i class="fas fa-pen"></i> New FAQ draft. Complete the fields and save.</div>' : ''}
            <form id="qa-form" class="qa-form">
                <label>Question</label>
                <textarea id="qa-question" placeholder="Example: How do I access my live assessment?">${this.esc(question.question)}</textarea>
                <label>Answer Summary</label>
                <textarea id="qa-answer" placeholder="Short answer shown before the linked answer resource.">${this.esc(question.answer)}</textarea>
                <div class="qa-two">
                    <div>
                        <label>Tags</label>
                        <input id="qa-tags" type="text" placeholder="booking, live, assessment" value="${this.esc((question.tags || []).join(', '))}">
                    </div>
                    <div>
                        <label>Visibility</label>
                        <select id="qa-status">
                            <option value="published" ${question.status !== 'draft' ? 'selected' : ''}>Published to trainees</option>
                            <option value="draft" ${question.status === 'draft' ? 'selected' : ''}>Draft / hidden</option>
                        </select>
                    </div>
                </div>
                <div class="qa-resource-box">
                    <div class="qa-card-head compact">
                        <h3>Answer Resource</h3>
                        <button type="button" class="qa-btn ghost" id="qa-add-resource"><i class="fas fa-link"></i> Add Resource</button>
                    </div>
                    <div class="qa-two">
                        <div>
                            <label>Type</label>
                            <select id="qa-resource-type">
                                <option value="document">Document / file</option>
                                <option value="video">Video</option>
                                <option value="sharepoint_video">SharePoint video link</option>
                                <option value="sharepoint_link">SharePoint document/link</option>
                                <option value="image">Picture</option>
                                <option value="pdf">PDF</option>
                            </select>
                        </div>
                        <div>
                            <label>Label</label>
                            <input id="qa-resource-label" type="text" placeholder="Open answer guide">
                        </div>
                    </div>
                    <label>URL</label>
                    <input id="qa-resource-url" type="url" placeholder="https://...">
                    <label>File Upload</label>
                    <input id="qa-resource-file" type="file" accept="*/*">
                    <div id="qa-resources" class="qa-resources">${this.renderResources()}</div>
                </div>
                <div class="qa-actions">
                    <button type="submit" class="qa-btn primary"><i class="fas fa-save"></i> Save FAQ Question</button>
                    <button type="button" class="qa-btn ghost" id="qa-clear-btn"><i class="fas fa-plus"></i> Start New</button>
                </div>
            </form>
        `;
    },

    renderResources() {
        if (!this.resources.length) return '<div class="qa-empty compact">No answer resources linked yet.</div>';
        return this.resources.map((r, i) => `
            <div class="qa-resource">
                <i class="fas ${this.esc(this.iconFor(r.type))}"></i>
                <span>${this.esc(r.label || r.name || r.url || 'Resource')}</span>
                <small>${this.esc(r.type || 'document')}</small>
                <button type="button" class="qa-icon-btn" data-resource-index="${i}"><i class="fas fa-xmark"></i></button>
            </div>
        `).join('');
    },

    renderSubmission(s) {
        return `
            <article class="qa-submission ${s.status === 'new' ? 'new' : ''}">
                <div>
                    <strong>${this.esc(s.question)}</strong>
                    <small>${this.esc(s.trainee)} &middot; ${this.esc(this.formatDate(s.createdAt))} &middot; ${this.esc(s.status)}</small>
                </div>
                <div class="qa-actions">
                    <button type="button" class="qa-btn ghost" data-create-submission="${this.esc(s.id)}"><i class="fas fa-wand-magic-sparkles"></i> Create FAQ</button>
                    <button type="button" class="qa-btn ghost" data-toggle-submission="${this.esc(s.id)}">${s.status === 'new' ? 'Mark Reviewed' : 'Reopen'}</button>
                </div>
            </article>
        `;
    },

    bindEvents() {
        const bind = (selector, eventName, handler) => {
            document.querySelectorAll(selector).forEach(el => {
                el.addEventListener(eventName, (event) => {
                    try {
                        handler(event, el);
                    } catch (error) {
                        this.handleError(error, 'Q&A Hub action failed.');
                    }
                });
            });
        };
        const run = (promise, fallback) => {
            Promise.resolve(promise).catch(error => this.handleError(error, fallback || 'Q&A Hub action failed.'));
        };

        bind('#qa-new-btn', 'click', (event) => {
            event.preventDefault();
            this.startNew();
        });
        bind('#qa-clear-btn', 'click', (event) => {
            event.preventDefault();
            this.startNew();
        });
        bind('#qa-refresh-btn', 'click', (event) => {
            event.preventDefault();
            run(this.refresh(), 'Could not refresh Q&A Hub.');
        });
        bind('#qa-delete-btn', 'click', (event) => {
            event.preventDefault();
            run(this.deleteSelected(), 'Could not delete FAQ question.');
        });
        bind('#qa-add-resource', 'click', (event) => {
            event.preventDefault();
            run(this.addResource(), 'Could not add answer resource.');
        });
        bind('#qa-form', 'submit', (event) => {
            event.preventDefault();
            run(this.saveQuestion(), 'Could not save FAQ question.');
        });
        bind('#qa-search', 'input', (event) => {
            this.filterList(event.target.value);
        });
        bind('.qa-row', 'click', (event, row) => {
            event.preventDefault();
            this.selectQuestion(row.dataset.id);
        });
        bind('[data-resource-index]', 'click', (event, button) => {
            event.preventDefault();
            this.removeResource(Number(button.dataset.resourceIndex));
        });
        bind('[data-create-submission]', 'click', (event, button) => {
            event.preventDefault();
            run(this.createFromSubmission(button.dataset.createSubmission), 'Could not create FAQ from queued question.');
        });
        bind('[data-toggle-submission]', 'click', (event, button) => {
            event.preventDefault();
            run(this.toggleSubmission(button.dataset.toggleSubmission), 'Could not update queued question.');
        });
    },

    startNew(prefill = '') {
        this.mode = 'new';
        this.selectedId = null;
        this.resources = [];
        this.render();
        this.focusBuilder();
        const input = document.getElementById('qa-question');
        if (input) input.value = prefill;
    },

    focusBuilder() {
        const builder = document.querySelector('.qa-builder');
        if (builder && typeof builder.scrollIntoView === 'function') {
            builder.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        const input = document.getElementById('qa-question');
        if (input) setTimeout(() => input.focus(), 20);
    },

    selectQuestion(id) {
        const q = this.store.questions.find(item => String(item.id || '') === String(id || '') && item.status !== 'deleted');
        if (!q) return;
        this.mode = 'edit';
        this.selectedId = q.id;
        this.resources = Array.isArray(q.resources) ? q.resources.map(r => ({ ...r })) : [];
        this.render();
        this.focusBuilder();
    },

    async readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('File read failed'));
            reader.readAsDataURL(file);
        });
    },

    async addResource() {
        const url = document.getElementById('qa-resource-url')?.value.trim() || '';
        const file = document.getElementById('qa-resource-file')?.files?.[0] || null;
        if (!url && !file) return this.toast('Add a URL or upload a file first.', 'warn');

        const selectedType = document.getElementById('qa-resource-type')?.value || 'document';
        const resource = {
            id: QAData.makeId('resource'),
            type: this.inferResourceType(file, selectedType, url),
            label: document.getElementById('qa-resource-label')?.value.trim() || (file ? file.name : 'Open answer'),
            url,
            name: file ? file.name : '',
            mime: file ? file.type : '',
            size: file ? file.size : 0,
            createdAt: new Date().toISOString()
        };
        if (file) resource.dataUrl = await this.readFile(file);
        this.resources.push(resource);
        document.getElementById('qa-resources').innerHTML = this.renderResources();
        this.bindResourceButtons();
        const labelEl = document.getElementById('qa-resource-label');
        const urlEl = document.getElementById('qa-resource-url');
        const fileEl = document.getElementById('qa-resource-file');
        if (labelEl) labelEl.value = '';
        if (urlEl) urlEl.value = '';
        if (fileEl) fileEl.value = '';
    },

    removeResource(index) {
        this.resources.splice(index, 1);
        document.getElementById('qa-resources').innerHTML = this.renderResources();
        this.bindResourceButtons();
    },

    bindResourceButtons() {
        document.querySelectorAll('[data-resource-index]').forEach(button => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                try {
                    this.removeResource(Number(button.dataset.resourceIndex));
                } catch (error) {
                    this.handleError(error, 'Could not remove answer resource.');
                }
            });
        });
    },

    async saveQuestion() {
        const question = document.getElementById('qa-question')?.value.trim() || '';
        if (!question) return this.toast('Question text is required.', 'warn');

        const existing = this.mode === 'edit' ? (this.selectedQuestion() || {}) : {};
        const item = {
            ...existing,
            id: existing.id || QAData.makeId('qa'),
            question,
            answer: document.getElementById('qa-answer')?.value.trim() || '',
            tags: (document.getElementById('qa-tags')?.value || '').split(',').map(v => v.trim()).filter(Boolean),
            status: document.getElementById('qa-status')?.value || 'published',
            resources: this.resources.map(r => ({ ...r })),
            createdAt: existing.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            updatedBy: QAData.getEditor()
        };

        const index = this.store.questions.findIndex(q => String(q.id || '') === String(item.id || ''));
        if (index >= 0) this.store.questions[index] = item;
        else this.store.questions.unshift(item);

        this.store = await QAData.save(this.store);
        this.mode = 'edit';
        this.selectedId = item.id;
        this.resources = item.resources.map(r => ({ ...r }));
        this.toast('FAQ question saved.', 'ok');
        this.render();
    },

    async deleteSelected() {
        if (!this.selectedId || !confirm('Delete this FAQ question?')) return;
        const item = this.store.questions.find(q => String(q.id || '') === String(this.selectedId || ''));
        if (item) {
            item.status = 'deleted';
            item.updatedAt = new Date().toISOString();
            item.updatedBy = QAData.getEditor();
        }
        this.store = await QAData.save(this.store);
        this.startNew();
    },

    async toggleSubmission(id) {
        const item = this.store.submissions.find(s => String(s.id || '') === String(id || ''));
        if (!item) return;
        item.status = item.status === 'new' ? 'reviewed' : 'new';
        item.reviewedAt = new Date().toISOString();
        item.reviewedBy = QAData.getEditor();
        this.store = await QAData.save(this.store);
        this.render();
    },

    async createFromSubmission(id) {
        const item = this.store.submissions.find(s => String(s.id || '') === String(id || ''));
        if (item && item.status === 'new') {
            item.status = 'reviewed';
            item.reviewedAt = new Date().toISOString();
            item.reviewedBy = QAData.getEditor();
            try {
                this.store = await QAData.save(this.store);
            } catch (error) {
                console.warn('[Q&A Hub] Could not mark submission reviewed:', error);
                this.toast('FAQ draft opened, but the trainee question could not be marked reviewed.', 'warn');
            }
        }
        this.startNew(item ? item.question : '');
    },

    filterList(term) {
        const value = String(term || '').toLowerCase();
        document.querySelectorAll('.qa-row').forEach(row => {
            row.style.display = !value || String(row.dataset.search || '').includes(value) ? '' : 'none';
        });
    },

    async refresh() {
        try {
            this.store = await QAData.load();
            const selected = this.selectedQuestion();
            if (this.mode === 'edit' && !selected) {
                const visibleQuestions = this.store.questions.filter(q => q.status !== 'deleted');
                this.selectedId = visibleQuestions[0]?.id || null;
                this.mode = this.selectedId ? 'edit' : 'new';
                this.resources = this.selectedQuestion()?.resources?.map(r => ({ ...r })) || [];
            }
            this.render();
        } catch (error) {
            this.handleError(error, 'Could not refresh Q&A Hub.');
        }
    },

    toast(message, type = 'ok') {
        const el = document.createElement('div');
        el.className = `qa-toast ${this.esc(type)}`;
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 2400);
    },

    handleError(error, fallbackMessage = 'Q&A Hub action failed.') {
        console.error('[Q&A Hub]', error);
        const message = error && error.message ? error.message : fallbackMessage;
        this.toast(message || fallbackMessage, 'error');
    }
};

window.App = App;
window.onload = () => App.init();

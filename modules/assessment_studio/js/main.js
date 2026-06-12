/* ================= ASSESSMENT STUDIO APP ================= */
const QUESTION_TYPES = [
    { key: 'multiple_choice', label: 'Multiple Choice (Radio)' },
    { key: 'multi_select', label: 'Multiple Answer (Checkbox)' },
    { key: 'text', label: 'Text Answer' },
    { key: 'matching', label: 'Matching / Pairs' },
    { key: 'ranking', label: 'Ranking Order' },
    { key: 'matrix', label: 'Matrix / Grid' }
];

const AST_GRADING_LEASE_MS = 30 * 60 * 1000;

const App = {
    view: 'bucket',
    selectedSubmissionId: null,
    markerSessionId: `ast_marker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,

    async init() {
        const root = document.getElementById('assessment-studio-app');
        if (!root) return;
        root.innerHTML = '<div class="ast-card ast-loading"><i class="fas fa-circle-notch fa-spin"></i><p>Loading Assessment Studio...</p></div>';
        try {
            await AssessmentStudioData.load();
            this.render();
        } catch (error) {
            this.handleError(error, 'Assessment Studio could not load.');
        }
    },

    isAllowed() {
        const role = String(AppContext.user && AppContext.user.role || '').toLowerCase();
        return role === 'admin' || role === 'super_admin';
    },

    esc(value) {
        return AssessmentStudioData.esc(value);
    },

    normalize(value) {
        return AssessmentStudioData.normalizeText(value);
    },

    typeLabel(type) {
        return (QUESTION_TYPES.find(item => item.key === type) || {}).label || type || 'Question';
    },

    toast(message, type = 'ok') {
        const el = document.createElement('div');
        el.className = `ast-toast ${type}`;
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 2600);
    },

    handleError(error, fallback) {
        console.error('[Assessment Studio]', error);
        this.toast(error && error.message ? error.message : fallback, 'error');
    },

    async setView(view) {
        if (this.view === 'grading' && this.selectedSubmissionId) {
            await this.releaseSubmissionLock(this.selectedSubmissionId);
        }
        this.view = view;
        this.selectedSubmissionId = null;
        this.render();
    },

    async refresh() {
        if (this.view === 'grading' && this.selectedSubmissionId) {
            await this.releaseSubmissionLock(this.selectedSubmissionId);
            this.selectedSubmissionId = null;
        }
        await AssessmentStudioData.load();
        this.render();
    },

    state() {
        return AssessmentStudioData.state;
    },

    assessmentOptions() {
        const names = new Set();
        this.state().legacy.assessments.forEach(item => {
            const name = String(item && (item.name || item.title) || '').trim();
            if (name) names.add(name);
        });
        this.state().legacy.tests.forEach(item => {
            const title = String(item && item.title || '').trim();
            if (title) names.add(title);
        });
        this.state().studio.questionBucket.forEach(item => {
            if (item.assessment) names.add(item.assessment);
        });
        return Array.from(names).sort((a, b) => a.localeCompare(b));
    },

    groupOptions() {
        return Object.keys(this.state().legacy.rosters || {}).sort().reverse();
    },

    bucketStatsByAssessment() {
        const stats = new Map();
        this.state().studio.questionBucket
            .filter(q => q.status !== 'archived')
            .forEach(q => {
                const assessment = String(q.assessment || '').trim();
                if (!assessment) return;
                const current = stats.get(assessment) || { assessment, count: 0, points: 0 };
                current.count += 1;
                current.points += Number(q.points || 0);
                stats.set(assessment, current);
            });
        return Array.from(stats.values()).sort((a, b) => a.assessment.localeCompare(b.assessment, undefined, { sensitivity: 'base', numeric: true }));
    },

    traineeOptions(groupID = '') {
        const users = this.state().legacy.users;
        const rosters = this.state().legacy.rosters || {};
        const names = new Set();
        if (groupID && Array.isArray(rosters[groupID])) {
            rosters[groupID].forEach(name => names.add(String(name || '').trim()));
        } else {
            Object.values(rosters).forEach(members => {
                if (Array.isArray(members)) members.forEach(name => names.add(String(name || '').trim()));
            });
            users.filter(u => String(u && u.role || '').toLowerCase() === 'trainee')
                .forEach(u => names.add(String(u.user || u.username || '').trim()));
        }
        return Array.from(names).filter(Boolean).sort((a, b) => a.localeCompare(b));
    },

    groupingOptions(assessment = '') {
        const names = new Set();
        if (!assessment) {
            this.state().studio.groupings.forEach(item => {
                const name = String(item && item.name || '').trim();
                if (name) names.add(name);
            });
        }
        this.state().studio.questionBucket.forEach(q => {
            const group = String(q && q.grouping || '').trim();
            if (group && (!assessment || this.normalize(q.assessment) === this.normalize(assessment))) names.add(group);
        });
        return Array.from(names).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
    },

    tagOptions() {
        const names = new Set();
        this.state().studio.tags.forEach(item => {
            const name = String(item && item.name || '').trim();
            if (name) names.add(name);
        });
        return Array.from(names).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
    },

    assessmentGroupings(assessment = '') {
        const cleanAssessment = String(assessment || '').trim();
        if (!cleanAssessment) return [];
        return this.groupingOptions(cleanAssessment);
    },

    render() {
        const root = document.getElementById('assessment-studio-app');
        if (!root) return;

        if (!this.isAllowed()) {
            root.innerHTML = '<div class="ast-card ast-denied"><h3>Access Restricted</h3><p>Assessment Studio is available to Admin and Super Admin users only.</p></div>';
            return;
        }

        const stats = this.getStats();
        root.innerHTML = `
            <div class="ast-shell">
                <header class="ast-header">
                    <div>
                        <h1><i class="fas fa-clipboard-list"></i> Assessment Studio</h1>
                    </div>
                    <div class="ast-stats">
                        <span><strong>${stats.questions}</strong>Bucket</span>
                        <span><strong>${stats.generators}</strong>Generators</span>
                        <span><strong>${stats.pending}</strong>Pending</span>
                        <span><strong>${stats.completed}</strong>Completed</span>
                    </div>
                </header>
                <nav class="ast-subnav">
                    ${this.navButton('bucket', 'Question Bucket', 'fa-box-archive')}
                    ${this.navButton('generator', 'Test Generator Details', 'fa-wand-magic-sparkles')}
                    ${this.navButton('completed', 'Completed Tests', 'fa-clipboard-check')}
                    ${this.navButton('grading', 'Grading Queue', 'fa-pen-to-square')}
                    ${this.navButton('feedback', 'Feedback Sessions', 'fa-comments')}
                    ${this.navButton('search', 'Universal Search', 'fa-magnifying-glass')}
                    <button class="ast-btn ghost" onclick="App.refresh()"><i class="fas fa-rotate-right"></i> Refresh</button>
                </nav>
                ${this.renderCurrentView()}
            </div>
        `;
    },

    navButton(view, label, icon) {
        return `<button class="ast-tab ${this.view === view ? 'active' : ''}" onclick="App.setView('${view}')"><i class="fas ${icon}"></i> ${label}</button>`;
    },

    renderCurrentView() {
        if (this.view === 'generator') return this.renderGenerator();
        if (this.view === 'completed') return this.renderCompleted();
        if (this.view === 'grading') return this.renderGradingQueue();
        if (this.view === 'feedback') return this.renderFeedback();
        if (this.view === 'search') return this.renderSearch();
        return this.renderBucket();
    },

    getStats() {
        const studio = this.state().studio;
        return {
            questions: studio.questionBucket.filter(q => q.status !== 'archived').length,
            generators: studio.generators.filter(g => g.status !== 'archived').length,
            pending: studio.submissions.filter(s => s.status === 'pending_review').length,
            completed: studio.submissions.filter(s => s.status === 'completed').length
        };
    },

    questionSafetyErrors(question) {
        const q = question && typeof question === 'object' ? question : {};
        const errors = [];
        const type = String(q.type || '').trim();
        if (!String(q.assessment || '').trim()) errors.push('Choose the Standard Assessment before saving the question.');
        if (!String(q.text || '').trim()) errors.push('Enter the trainee-facing question text.');
        if (!QUESTION_TYPES.some(item => item.key === type)) errors.push('Choose a supported question type.');
        if (!(Number(q.points) > 0)) errors.push('Question points must be greater than zero.');

        if (type === 'multiple_choice') {
            if (!Array.isArray(q.options) || q.options.length < 2) errors.push('Multiple choice questions need at least two options.');
            if (!Number.isInteger(Number(q.correct)) || Number(q.correct) < 0 || Number(q.correct) >= (q.options || []).length) errors.push('Mark one correct multiple choice answer.');
        }
        if (type === 'multi_select') {
            if (!Array.isArray(q.options) || q.options.length < 2) errors.push('Multiple answer questions need at least two options.');
            if (!Array.isArray(q.correct) || q.correct.length < 1) errors.push('Mark at least one correct multiple answer option.');
        }
        if (type === 'matching' && (!Array.isArray(q.pairs) || q.pairs.length < 1)) errors.push('Matching questions need at least one complete pair.');
        if (type === 'ranking' && (!Array.isArray(q.items) || q.items.length < 2)) errors.push('Ranking questions need at least two ordered items.');
        if (type === 'matrix') {
            const rowCount = Array.isArray(q.rows) ? q.rows.length : 0;
            const colCount = Array.isArray(q.cols) ? q.cols.length : 0;
            const correctCount = q.matrixCorrect && typeof q.matrixCorrect === 'object' ? Object.keys(q.matrixCorrect).length : 0;
            if (!rowCount || !colCount) errors.push('Matrix questions need rows and columns.');
            if (rowCount && correctCount < rowCount) errors.push('Select a correct matrix answer for every row.');
        }
        return errors;
    },

    generatorSafetyCheck(generator) {
        const g = generator && typeof generator === 'object' ? generator : {};
        const errors = [];
        if (!String(g.assessment || '').trim()) errors.push('Select the Standard Assessment for this generator.');
        if (!(Number(g.totalPoints) > 0)) errors.push('Total Points / Score must be greater than zero.');
        if (!(Number(g.pointLeeway) >= 0)) errors.push('Point Leeway must be zero or greater.');
        if (!Array.isArray(g.allowedTypes) || !g.allowedTypes.length) errors.push('Choose at least one allowed question type.');
        if (errors.length) return { errors, test: null };

        const pool = this.state().studio.questionBucket.filter(q =>
            q.status !== 'archived' &&
            this.normalize(q.assessment) === this.normalize(g.assessment) &&
            g.allowedTypes.includes(q.type)
        );
        if (!pool.length) return { errors: ['Add active bucket questions for this assessment and the selected question types before saving the generator.'], test: null };

        const invalidQuestion = pool.find(q => this.questionSafetyErrors(q).length > 0);
        if (invalidQuestion) {
            return { errors: [`Fix the bucket question "${invalidQuestion.text || invalidQuestion.id}" before saving this generator.`], test: null };
        }

        try {
            const test = this.evaluateGenerator(g, { ignoreExistingSignatures: true, seed: `${g.assessment}|safety|${g.totalPoints}`, attempts: 160 });
            if (!test.best.inRange) {
                return {
                    errors: [`This generator cannot produce a test inside ${test.minPoints}-${test.maxPoints} points. Closest result is ${Math.round(test.best.points * 10) / 10} points.`],
                    test
                };
            }
            return { errors: [], test };
        } catch (error) {
            return { errors: [error && error.message ? error.message : 'Generator could not produce a valid trainee test.'], test: null };
        }
    },

    submissionSafetyErrors(submission) {
        const sub = submission && typeof submission === 'object' ? submission : {};
        const questions = Array.isArray(sub.testSnapshot?.questions) ? sub.testSnapshot.questions : [];
        const errors = [];
        if (!String(sub.trainee || '').trim()) errors.push('Submission is missing the trainee name.');
        if (!String(sub.assessment || '').trim()) errors.push('Submission is missing the assessment name.');
        if (!questions.length) errors.push('Submission has no generated snapshot questions.');
        questions.forEach((q, idx) => {
            const questionErrors = this.questionSafetyErrors(q);
            if (questionErrors.length) errors.push(`Question ${idx + 1} is incomplete: ${questionErrors[0]}`);
        });
        return errors;
    },

    renderBucket() {
        const assessments = this.assessmentOptions();
        const groupings = this.groupingOptions();
        const tags = this.tagOptions();
        const questions = this.state().studio.questionBucket.filter(q => q.status !== 'archived');
        const stats = this.bucketStatsByAssessment();
        return `
            <main class="ast-single-layout">
                <section class="ast-card">
                    <div class="ast-card-head">
                        <div>
                            <h2>Question Bucket</h2>
                            <p>Reusable questions assigned to Standard Assessments and pulled into generated tests.</p>
                        </div>
                        <div class="ast-actions">
                            <button class="ast-btn" onclick="App.openGroupingManager()"><i class="fas fa-layer-group"></i> View Grouping</button>
                            <button class="ast-btn primary" onclick="App.openQuestionModal()"><i class="fas fa-plus"></i> Add Question</button>
                        </div>
                    </div>
                    <div class="ast-filters">
                        <input id="bucketSearch" type="search" placeholder="Search bucket..." oninput="App.filterBucket()">
                        <select id="bucketAssessmentFilter" onchange="App.filterBucket()"><option value="">All assessments</option>${assessments.map(name => `<option>${this.esc(name)}</option>`).join('')}</select>
                        <select id="bucketTypeFilter" onchange="App.filterBucket()"><option value="">All types</option>${QUESTION_TYPES.map(t => `<option value="${t.key}">${this.esc(t.label)}</option>`).join('')}</select>
                        <select id="bucketGroupingFilter" onchange="App.filterBucket()"><option value="">All groupings</option><option value="__none__">Ungrouped</option>${groupings.map(name => `<option value="${this.esc(name)}">${this.esc(name)}</option>`).join('')}</select>
                        <select id="bucketTagFilter" onchange="App.filterBucket()"><option value="">All question tags</option><option value="__none__">No tag</option>${tags.map(name => `<option value="${this.esc(name)}">${this.esc(name)}</option>`).join('')}</select>
                    </div>
                    <div class="ast-table-wrap">
                        <table class="ast-table">
                            <thead><tr><th>Assessment</th><th>Grouping</th><th>Tag</th><th>Type</th><th>Question</th><th>Points</th><th>Action</th></tr></thead>
                            <tbody id="bucketRows">${questions.length ? questions.map(q => this.renderBucketRow(q)).join('') : '<tr><td colspan="7" class="ast-empty">No bucket questions yet.</td></tr>'}</tbody>
                        </table>
                    </div>
                </section>
                <section class="ast-card">
                    <div class="ast-card-head"><div><h2>Assessment Point Totals</h2><p>Total available bucket points per Standard Assessment.</p></div></div>
                    <div class="ast-table-wrap ast-compact-table">
                        <table class="ast-table">
                            <thead><tr><th>Assessment</th><th>Questions</th><th>Total Points</th></tr></thead>
                            <tbody>${stats.length ? stats.map(row => `<tr><td>${this.esc(row.assessment)}</td><td>${this.esc(row.count)}</td><td>${this.esc(Math.round(row.points * 10) / 10)}</td></tr>`).join('') : '<tr><td colspan="3" class="ast-empty">No assessment point totals yet.</td></tr>'}</tbody>
                        </table>
                    </div>
                </section>
                <div id="questionModalHost"></div>
            </main>
        `;
    },

    renderBucketRow(q) {
        const tags = Array.isArray(q.tags) ? q.tags : [];
        return `
            <tr data-bucket-row data-search="${this.esc(`${q.assessment} ${q.grouping || ''} ${q.type} ${q.text} ${tags.join(' ')}`.toLowerCase())}" data-assessment="${this.esc(q.assessment)}" data-type="${this.esc(q.type)}" data-grouping="${this.esc(q.grouping || '')}" data-tags="${this.esc(tags.join('|'))}">
                <td>${this.esc(q.assessment)}</td>
                <td><span class="ast-chip">${this.esc(q.grouping || 'Ungrouped')}</span></td>
                <td>${tags.length ? tags.map(tag => `<span class="ast-chip">${this.esc(tag)}</span>`).join(' ') : '<span class="ast-muted">-</span>'}</td>
                <td><span class="ast-chip">${this.esc(this.typeLabel(q.type))}</span></td>
                <td>${this.esc(q.text)}</td>
                <td>${this.esc(q.points)}</td>
                <td>
                    <button class="ast-btn small" onclick="App.openQuestionModal('${this.esc(q.id)}')"><i class="fas fa-pen"></i></button>
                    <button class="ast-btn small danger" onclick="App.archiveQuestion('${this.esc(q.id)}')"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;
    },

    openQuestionModal(id = '') {
        const q = id ? this.state().studio.questionBucket.find(item => item.id === id) : null;
        const host = document.getElementById('questionModalHost') || document.body;
        host.innerHTML = this.renderQuestionModal(q);
    },

    closeQuestionModal() {
        const host = document.getElementById('questionModalHost');
        if (host) host.innerHTML = '';
    },

    renderQuestionModal(q = null) {
        const item = q || {};
        const assessments = this.assessmentOptions();
        const selectedGrouping = String(item.grouping || '').trim();
        const selectedTag = String((Array.isArray(item.tags) ? item.tags[0] : '') || '').trim();
        const groupingOptions = this.groupingOptions(item.assessment);
        const tagOptions = this.tagOptions();
        return `
            <div class="ast-modal-backdrop" role="dialog" aria-modal="true">
                <div class="ast-modal-card ast-question-modal">
                    <div class="ast-modal-head">
                        <div>
                            <h2>${item.id ? 'Edit Question' : 'Add Question'}</h2>
                            <p>Build the question the way the trainee will see it, then mark the correct answer inside the options.</p>
                        </div>
                        <button class="ast-btn ghost" onclick="App.closeQuestionModal()"><i class="fas fa-xmark"></i></button>
                    </div>
                    <form id="questionForm" class="ast-form" onsubmit="event.preventDefault(); App.saveQuestion();">
                        <input type="hidden" id="questionId" value="${this.esc(item.id || '')}">
                        <div class="ast-grid-3">
                            <label>Standard Assessment<input id="questionAssessment" list="assessmentNames" value="${this.esc(item.assessment || '')}" placeholder="Assessment name"></label>
                            <label>Question Type<select id="questionType" onchange="App.renderTypeHelp()">${QUESTION_TYPES.map(t => `<option value="${t.key}" ${item.type === t.key ? 'selected' : ''}>${this.esc(t.label)}</option>`).join('')}</select></label>
                            <label>Points<input id="questionPoints" type="number" min="0.5" step="0.5" value="${this.esc(item.points || 1)}"></label>
                        </div>
                        <datalist id="assessmentNames">${assessments.map(name => `<option value="${this.esc(name)}"></option>`).join('')}</datalist>
                        <label>Question Text<textarea id="questionText" rows="3" placeholder="Question shown to trainee">${this.esc(item.text || '')}</textarea></label>
                        <div id="typeHelp">${this.renderTypeHelpHtml(item)}</div>
                        <label>Grouping
                            <select id="questionGrouping" onfocus="this.dataset.previous = this.value" onchange="App.handleQuestionGroupingSelect(this)">
                                <option value="">No grouping</option>
                                ${groupingOptions.map(name => `<option value="${this.esc(name)}" ${selectedGrouping === name ? 'selected' : ''}>${this.esc(name)}</option>`).join('')}
                                <option value="__add_new__">+ Add new grouping...</option>
                            </select>
                        </label>
                        <div id="questionGroupingCreate" class="ast-inline-create hidden">
                            <input id="questionGroupingNewName" placeholder="New grouping name">
                            <button class="ast-btn primary" type="button" onclick="App.saveNewQuestionGrouping()"><i class="fas fa-save"></i> Save Group</button>
                            <button class="ast-btn ghost" type="button" onclick="App.cancelNewQuestionGrouping()"><i class="fas fa-xmark"></i> Cancel</button>
                        </div>
                        <label>Question Tag
                            <select id="questionTag" onfocus="this.dataset.previous = this.value" onchange="App.handleQuestionTagSelect(this)">
                                <option value="">No tag</option>
                                ${tagOptions.map(name => `<option value="${this.esc(name)}" ${selectedTag === name ? 'selected' : ''}>${this.esc(name)}</option>`).join('')}
                                <option value="__add_new__">+ Add new tag...</option>
                            </select>
                        </label>
                        <div id="questionTagCreate" class="ast-inline-create hidden">
                            <input id="questionTagNewName" placeholder="New tag name">
                            <button class="ast-btn primary" type="button" onclick="App.saveNewQuestionTag()"><i class="fas fa-save"></i> Save Tag</button>
                            <button class="ast-btn ghost" type="button" onclick="App.cancelNewQuestionTag()"><i class="fas fa-xmark"></i> Cancel</button>
                        </div>
                        <div class="ast-actions ast-modal-actions">
                            <button class="ast-btn primary" type="submit"><i class="fas fa-save"></i> Save Question</button>
                            <button class="ast-btn ghost" type="button" onclick="App.closeQuestionModal()">Cancel</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    },

    renderTypeHelpHtml(item = {}) {
        const type = document.getElementById('questionType')?.value || item.type || 'multiple_choice';
        if (type === 'matching') return this.renderMatchingBuilder(item);
        if (type === 'ranking') return this.renderRankingBuilder(item);
        if (type === 'matrix') return this.renderMatrixBuilder(item);
        if (type === 'text') {
            return `
                <section class="ast-question-builder">
                    <div class="ast-builder-head"><h3>Text Answer Preview</h3><span>Manual scoring</span></div>
                    <textarea rows="5" disabled placeholder="Trainee will type their answer here..."></textarea>
                    <label>Suggested Answer<textarea id="questionSuggestedAnswer" rows="4" placeholder="Suggested answer to help the admin mark the trainee response">${this.esc(item.suggestedAnswer || '')}</textarea></label>
                    <div class="ast-note">Text answers are manual review only. The suggested answer appears in the Grading Queue for admin marking guidance.</div>
                </section>
            `;
        }
        return this.renderOptionBuilder(item, type);
    },

    renderOptionBuilder(item = {}, type = 'multiple_choice') {
        const options = Array.isArray(item.options) && item.options.length ? item.options : ['', ''];
        const correct = type === 'multi_select'
            ? new Set((Array.isArray(item.correct) ? item.correct : []).map(Number))
            : new Set([Number(item.correct)]);
        return `
            <section class="ast-question-builder">
                <div class="ast-builder-head">
                    <h3>${type === 'multi_select' ? 'Multiple Answer Options' : 'Multiple Choice Options'}</h3>
                    <span>${type === 'multi_select' ? 'Tick every correct answer' : 'Select one correct answer'}</span>
                </div>
                <div id="optionBuilderRows" class="ast-builder-list">
                    ${options.map((option, idx) => this.renderOptionRow(option, idx, type, correct.has(idx))).join('')}
                </div>
                <button class="ast-btn small" type="button" onclick="App.addOptionBuilderRow()"><i class="fas fa-plus"></i> Add Option</button>
            </section>
        `;
    },

    renderOptionRow(option = '', idx = 0, type = 'multiple_choice', checked = false) {
        const inputType = type === 'multi_select' ? 'checkbox' : 'radio';
        const name = type === 'multi_select' ? '' : 'questionCorrectOption';
        return `
            <div class="ast-builder-row" data-option-row>
                <label class="ast-correct-picker"><input class="correct-option" type="${inputType}" ${name ? `name="${name}"` : ''} ${checked ? 'checked' : ''}> Correct</label>
                <input class="option-text" value="${this.esc(option)}" placeholder="Option ${idx + 1}">
                <button class="ast-btn small ghost" type="button" onclick="this.closest('[data-option-row]').remove()"><i class="fas fa-trash"></i></button>
            </div>
        `;
    },

    renderMatchingBuilder(item = {}) {
        const pairs = Array.isArray(item.pairs) && item.pairs.length ? item.pairs : [{ left: '', right: '' }, { left: '', right: '' }];
        return `
            <section class="ast-question-builder">
                <div class="ast-builder-head"><h3>Matching / Pairs</h3><span>Left prompt matched to right answer</span></div>
                <div id="pairBuilderRows" class="ast-builder-list">
                    ${pairs.map(pair => this.renderPairRow(pair)).join('')}
                </div>
                <button class="ast-btn small" type="button" onclick="App.addPairBuilderRow()"><i class="fas fa-plus"></i> Add Pair</button>
            </section>
        `;
    },

    renderPairRow(pair = {}) {
        return `
            <div class="ast-builder-row ast-pair-row" data-pair-row>
                <input class="pair-left" value="${this.esc(pair.left || '')}" placeholder="Trainee sees this">
                <i class="fas fa-arrow-right"></i>
                <input class="pair-right" value="${this.esc(pair.right || '')}" placeholder="Correct match">
                <button class="ast-btn small ghost" type="button" onclick="this.closest('[data-pair-row]').remove()"><i class="fas fa-trash"></i></button>
            </div>
        `;
    },

    renderRankingBuilder(item = {}) {
        const items = Array.isArray(item.items) && item.items.length ? item.items : ['', '', ''];
        return `
            <section class="ast-question-builder">
                <div class="ast-builder-head"><h3>Ranking Order</h3><span>Enter the correct order from top to bottom</span></div>
                <div id="rankingBuilderRows" class="ast-builder-list">
                    ${items.map((value, idx) => this.renderRankingRow(value, idx)).join('')}
                </div>
                <button class="ast-btn small" type="button" onclick="App.addRankingBuilderRow()"><i class="fas fa-plus"></i> Add Step</button>
            </section>
        `;
    },

    renderRankingRow(value = '', idx = 0) {
        return `
            <div class="ast-builder-row ast-ranking-row" data-ranking-row>
                <span>${idx + 1}</span>
                <input class="ranking-item" value="${this.esc(value)}" placeholder="Correct step ${idx + 1}">
                <button class="ast-btn small ghost" type="button" onclick="this.closest('[data-ranking-row]').remove(); App.renumberRankingRows();"><i class="fas fa-trash"></i></button>
            </div>
        `;
    },

    renderMatrixBuilder(item = {}) {
        const rows = Array.isArray(item.rows) && item.rows.length ? item.rows : ['', ''];
        const cols = Array.isArray(item.cols) && item.cols.length ? item.cols : ['', ''];
        const correct = item.matrixCorrect || item.correct || {};
        return `
            <section class="ast-question-builder">
                <div class="ast-builder-head"><h3>Matrix / Grid</h3><span>Build rows and columns, then select each correct cell</span></div>
                <div class="ast-matrix-builder-controls">
                    <div>
                        <h4>Rows</h4>
                        <div id="matrixRowBuilder">${rows.map(value => this.renderMatrixTextRow('row', value)).join('')}</div>
                        <button class="ast-btn small" type="button" onclick="App.addMatrixTextRow('row')"><i class="fas fa-plus"></i> Add Row</button>
                    </div>
                    <div>
                        <h4>Columns</h4>
                        <div id="matrixColBuilder">${cols.map(value => this.renderMatrixTextRow('col', value)).join('')}</div>
                        <button class="ast-btn small" type="button" onclick="App.addMatrixTextRow('col')"><i class="fas fa-plus"></i> Add Column</button>
                    </div>
                </div>
                <div id="matrixPreviewGrid">${this.renderMatrixPreview(rows, cols, correct)}</div>
            </section>
        `;
    },

    renderMatrixTextRow(kind, value = '') {
        return `
            <div class="ast-builder-row" data-matrix-${kind}>
                <input class="matrix-${kind}-text" value="${this.esc(value)}" placeholder="${kind === 'row' ? 'Row label' : 'Column label'}" oninput="App.refreshMatrixPreview()">
                <button class="ast-btn small ghost" type="button" onclick="this.closest('[data-matrix-${kind}]').remove(); App.refreshMatrixPreview();"><i class="fas fa-trash"></i></button>
            </div>
        `;
    },

    renderMatrixPreview(rows = [], cols = [], correct = {}) {
        const safeRows = rows.map(v => String(v || '').trim()).filter(Boolean);
        const safeCols = cols.map(v => String(v || '').trim()).filter(Boolean);
        if (!safeRows.length || !safeCols.length) return '<div class="ast-note">Add at least one row and one column to preview the trainee grid.</div>';
        return `
            <div class="ast-matrix-preview" style="--matrix-cols:${safeCols.length}">
                <div class="ast-matrix-preview-head"></div>
                ${safeCols.map(col => `<div class="ast-matrix-preview-head">${this.esc(col)}</div>`).join('')}
                ${safeRows.map((row, rowIdx) => `
                    <div class="ast-matrix-row-label">${this.esc(row)}</div>
                    ${safeCols.map((_, colIdx) => `<label><input type="radio" name="matrixCorrect_${rowIdx}" value="${colIdx}" ${Number(correct[rowIdx]) === colIdx ? 'checked' : ''}> Correct</label>`).join('')}
                `).join('')}
            </div>
        `;
    },

    renderTypeHelp() {
        const target = document.getElementById('typeHelp');
        if (target) target.innerHTML = this.renderTypeHelpHtml({});
    },

    addOptionBuilderRow() {
        const type = document.getElementById('questionType')?.value || 'multiple_choice';
        const target = document.getElementById('optionBuilderRows');
        if (target) target.insertAdjacentHTML('beforeend', this.renderOptionRow('', target.querySelectorAll('[data-option-row]').length, type, false));
    },

    addPairBuilderRow() {
        document.getElementById('pairBuilderRows')?.insertAdjacentHTML('beforeend', this.renderPairRow({}));
    },

    addRankingBuilderRow() {
        const target = document.getElementById('rankingBuilderRows');
        if (target) target.insertAdjacentHTML('beforeend', this.renderRankingRow('', target.querySelectorAll('[data-ranking-row]').length));
    },

    renumberRankingRows() {
        document.querySelectorAll('[data-ranking-row] span').forEach((span, idx) => { span.textContent = idx + 1; });
    },

    addMatrixTextRow(kind) {
        const id = kind === 'row' ? 'matrixRowBuilder' : 'matrixColBuilder';
        document.getElementById(id)?.insertAdjacentHTML('beforeend', this.renderMatrixTextRow(kind, ''));
        this.refreshMatrixPreview();
    },

    refreshMatrixPreview() {
        const target = document.getElementById('matrixPreviewGrid');
        if (!target) return;
        const rows = Array.from(document.querySelectorAll('.matrix-row-text')).map(input => input.value);
        const cols = Array.from(document.querySelectorAll('.matrix-col-text')).map(input => input.value);
        const correct = {};
        document.querySelectorAll('.ast-matrix-preview input[type="radio"]:checked').forEach(input => {
            const rowIdx = String(input.name || '').split('_')[1];
            if (rowIdx !== undefined) correct[rowIdx] = Number(input.value);
        });
        target.innerHTML = this.renderMatrixPreview(rows, cols, correct);
    },

    async handleQuestionGroupingSelect(select) {
        if (!select || select.value !== '__add_new__') return;
        const box = document.getElementById('questionGroupingCreate');
        const input = document.getElementById('questionGroupingNewName');
        if (box) box.classList.remove('hidden');
        if (input) {
            input.value = '';
            setTimeout(() => input.focus(), 30);
        }
    },

    cancelNewQuestionGrouping() {
        const select = document.getElementById('questionGrouping');
        const box = document.getElementById('questionGroupingCreate');
        if (select) select.value = select.dataset.previous || '';
        if (box) box.classList.add('hidden');
    },

    async saveNewQuestionGrouping() {
        const select = document.getElementById('questionGrouping');
        const input = document.getElementById('questionGroupingNewName');
        const box = document.getElementById('questionGroupingCreate');
        const clean = String(input?.value || '').trim();
        if (!clean) return this.toast('Enter a grouping name first.', 'warn');
        try {
            await this.saveGroupingName(clean);
            if (select) {
                const existing = Array.from(select.options).find(option => this.normalize(option.value) === this.normalize(clean));
                if (existing) {
                    existing.value = clean;
                    existing.textContent = clean;
                    existing.selected = true;
                } else {
                    select.insertBefore(new Option(clean, clean, true, true), select.querySelector('option[value="__add_new__"]'));
                }
                select.value = clean;
                select.dataset.previous = clean;
            }
            if (box) box.classList.add('hidden');
            this.toast('Grouping saved.', 'ok');
        } catch (error) {
            console.error('[Assessment Studio] Inline grouping save failed:', error);
            this.toast(error && error.message ? error.message : 'Grouping could not be saved.', 'error');
        }
    },

    async handleQuestionTagSelect(select) {
        if (!select || select.value !== '__add_new__') return;
        const box = document.getElementById('questionTagCreate');
        const input = document.getElementById('questionTagNewName');
        if (box) box.classList.remove('hidden');
        if (input) {
            input.value = '';
            setTimeout(() => input.focus(), 30);
        }
    },

    cancelNewQuestionTag() {
        const select = document.getElementById('questionTag');
        const box = document.getElementById('questionTagCreate');
        if (select) select.value = select.dataset.previous || '';
        if (box) box.classList.add('hidden');
    },

    async saveNewQuestionTag() {
        const select = document.getElementById('questionTag');
        const input = document.getElementById('questionTagNewName');
        const box = document.getElementById('questionTagCreate');
        const clean = String(input?.value || '').trim();
        if (!clean) return this.toast('Enter a tag name first.', 'warn');
        try {
            await this.saveTagName(clean);
            if (select) {
                const existing = Array.from(select.options).find(option => this.normalize(option.value) === this.normalize(clean));
                if (existing) {
                    existing.value = clean;
                    existing.textContent = clean;
                    existing.selected = true;
                } else {
                    select.insertBefore(new Option(clean, clean, true, true), select.querySelector('option[value="__add_new__"]'));
                }
                select.value = clean;
                select.dataset.previous = clean;
            }
            if (box) box.classList.add('hidden');
            this.toast('Tag saved.', 'ok');
        } catch (error) {
            console.error('[Assessment Studio] Inline tag save failed:', error);
            this.toast(error && error.message ? error.message : 'Tag could not be saved.', 'error');
        }
    },

    async saveTagName(name) {
        const clean = String(name || '').trim();
        if (!clean) return false;
        const studio = this.state().studio;
        studio.tags = Array.isArray(studio.tags) ? studio.tags : [];
        const existing = studio.tags.find(item => this.normalize(item.name) === this.normalize(clean));
        if (existing) {
            existing.name = clean;
            existing.updatedAt = new Date().toISOString();
            existing.updatedBy = AssessmentStudioData.editor();
        } else {
            studio.tags.push({
                id: AssessmentStudioData.makeId('tag'),
                name: clean,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                updatedBy: AssessmentStudioData.editor()
            });
        }
        await AssessmentStudioData.saveStudio();
        return true;
    },

    async saveGroupingName(name) {
        const clean = String(name || '').trim();
        if (!clean) return false;
        const studio = this.state().studio;
        studio.groupings = Array.isArray(studio.groupings) ? studio.groupings : [];
        const existing = studio.groupings.find(item => this.normalize(item.name) === this.normalize(clean));
        if (existing) {
            existing.name = clean;
            existing.updatedAt = new Date().toISOString();
            existing.updatedBy = AssessmentStudioData.editor();
        } else {
            studio.groupings.push({
                id: AssessmentStudioData.makeId('grp'),
                name: clean,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                updatedBy: AssessmentStudioData.editor()
            });
        }
        await AssessmentStudioData.saveStudio();
        return true;
    },

    openGroupingManager() {
        const host = document.getElementById('questionModalHost') || document.body;
        host.innerHTML = this.renderGroupingManager();
    },

    renderGroupingManager() {
        const groups = this.groupingOptions();
        return `
            <div class="ast-modal-backdrop" role="dialog" aria-modal="true">
                <div class="ast-modal-card ast-grouping-modal">
                    <div class="ast-modal-head">
                        <div>
                            <h2>Question Groupings</h2>
                            <p>Manage topic group names used by the question bucket and generator limits.</p>
                        </div>
                        <button class="ast-btn ghost" onclick="App.closeQuestionModal()"><i class="fas fa-xmark"></i></button>
                    </div>
                    <div class="ast-builder-row ast-grouping-add-row">
                        <input id="newGroupingName" placeholder="New grouping name">
                        <button class="ast-btn primary" type="button" onclick="App.addGroupingFromManager()"><i class="fas fa-plus"></i> Add Group</button>
                    </div>
                    <div class="ast-builder-list">
                        ${groups.length ? groups.map(name => this.renderGroupingRow(name)).join('') : '<div class="ast-empty">No groupings yet.</div>'}
                    </div>
                </div>
            </div>
        `;
    },

    renderGroupingRow(name) {
        const count = this.state().studio.questionBucket.filter(q => this.normalize(q.grouping || '') === this.normalize(name)).length;
        const encodedName = encodeURIComponent(name).replace(/'/g, '%27');
        return `
            <div class="ast-builder-row ast-grouping-row" data-grouping-row="${this.esc(name)}">
                <input class="grouping-name-input" value="${this.esc(name)}">
                <span class="ast-muted">${count} question${count === 1 ? '' : 's'}</span>
                <div class="ast-actions">
                    <button class="ast-btn small primary" onclick="App.renameGrouping('${this.esc(encodedName)}', this.closest('[data-grouping-row]').querySelector('.grouping-name-input').value)"><i class="fas fa-save"></i></button>
                    <button class="ast-btn small danger" onclick="App.removeGrouping('${this.esc(encodedName)}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `;
    },

    async addGroupingFromManager() {
        const input = document.getElementById('newGroupingName');
        const clean = String(input?.value || '').trim();
        if (!clean) return this.toast('Enter a grouping name first.', 'warn');
        try {
            await this.saveGroupingName(clean);
            this.toast('Grouping saved.', 'ok');
            this.openGroupingManager();
        } catch (error) {
            console.error('[Assessment Studio] Grouping save failed:', error);
            this.toast(error && error.message ? error.message : 'Grouping could not be saved.', 'error');
        }
    },

    async renameGrouping(encodedOldName, newName) {
        const oldName = decodeURIComponent(String(encodedOldName || ''));
        const clean = String(newName || '').trim();
        if (!oldName || !clean) return this.toast('Grouping name is required.', 'warn');
        const studio = this.state().studio;
        studio.groupings = Array.isArray(studio.groupings) ? studio.groupings : [];
        const row = studio.groupings.find(item => this.normalize(item.name) === this.normalize(oldName));
        if (row) {
            row.name = clean;
            row.updatedAt = new Date().toISOString();
            row.updatedBy = AssessmentStudioData.editor();
        }
        studio.questionBucket.forEach(q => {
            if (this.normalize(q.grouping || '') === this.normalize(oldName)) {
                q.grouping = clean;
                q.updatedAt = new Date().toISOString();
                q.updatedBy = AssessmentStudioData.editor();
            }
        });
        studio.generators.forEach(g => {
            if (g.groupLimits && Object.prototype.hasOwnProperty.call(g.groupLimits, oldName)) {
                g.groupLimits[clean] = g.groupLimits[oldName];
                delete g.groupLimits[oldName];
            }
        });
        await AssessmentStudioData.saveStudio();
        this.toast('Grouping renamed.', 'ok');
        this.openGroupingManager();
    },

    async removeGrouping(encodedName) {
        const name = decodeURIComponent(String(encodedName || ''));
        if (!name || !confirm(`Remove grouping "${name}"? Questions will become ungrouped.`)) return;
        const studio = this.state().studio;
        studio.groupings = (studio.groupings || []).filter(item => this.normalize(item.name) !== this.normalize(name));
        studio.questionBucket.forEach(q => {
            if (this.normalize(q.grouping || '') === this.normalize(name)) {
                q.grouping = '';
                q.updatedAt = new Date().toISOString();
                q.updatedBy = AssessmentStudioData.editor();
            }
        });
        studio.generators.forEach(g => {
            if (g.groupLimits) delete g.groupLimits[name];
        });
        await AssessmentStudioData.saveStudio();
        this.toast('Grouping removed.', 'ok');
        this.openGroupingManager();
    },

    async saveQuestion() {
        const type = document.getElementById('questionType').value;
        const existingId = document.getElementById('questionId').value;
        const isNewQuestion = !existingId;
        const id = existingId || AssessmentStudioData.makeId('qb');
        const grouping = String(document.getElementById('questionGrouping')?.value || '').trim();
        const tag = String(document.getElementById('questionTag')?.value || '').trim();
        const question = {
            id,
            assessment: document.getElementById('questionAssessment').value.trim(),
            type,
            text: document.getElementById('questionText').value.trim(),
            points: Number(document.getElementById('questionPoints').value || 1),
            grouping,
            tags: tag ? [tag] : [],
            status: 'active',
            updatedAt: new Date().toISOString(),
            updatedBy: AssessmentStudioData.editor()
        };
        if (type === 'matching') {
            question.pairs = Array.from(document.querySelectorAll('[data-pair-row]')).map(row => ({
                left: row.querySelector('.pair-left')?.value.trim() || '',
                right: row.querySelector('.pair-right')?.value.trim() || ''
            })).filter(p => p.left && p.right);
        } else if (type === 'ranking') {
            question.items = Array.from(document.querySelectorAll('.ranking-item')).map(input => input.value.trim()).filter(Boolean);
        } else if (type === 'matrix') {
            question.rows = Array.from(document.querySelectorAll('.matrix-row-text')).map(input => input.value.trim()).filter(Boolean);
            question.cols = Array.from(document.querySelectorAll('.matrix-col-text')).map(input => input.value.trim()).filter(Boolean);
            question.matrixCorrect = {};
            document.querySelectorAll('.ast-matrix-preview input[type="radio"]:checked').forEach(input => {
                const rowIdx = String(input.name || '').split('_')[1];
                if (rowIdx !== undefined) question.matrixCorrect[rowIdx] = Number(input.value);
            });
        } else if (type !== 'text') {
            const rows = Array.from(document.querySelectorAll('[data-option-row]'));
            const validRows = rows
                .map(row => ({ text: row.querySelector('.option-text')?.value.trim() || '', correct: !!row.querySelector('.correct-option')?.checked }))
                .filter(row => row.text);
            question.options = validRows.map(row => row.text);
            question.correct = type === 'multi_select'
                ? validRows.map((row, idx) => row.correct ? idx : null).filter(value => value !== null)
                : validRows.findIndex(row => row.correct);
        } else {
            question.suggestedAnswer = String(document.getElementById('questionSuggestedAnswer')?.value || '').trim();
        }

        const questionErrors = this.questionSafetyErrors(question);
        if (questionErrors.length) return this.toast(questionErrors[0], 'warn');

        if (grouping) await this.saveGroupingName(grouping);
        if (tag) await this.saveTagName(tag);
        const studio = this.state().studio;
        const idx = studio.questionBucket.findIndex(q => q.id === id);
        if (idx >= 0) studio.questionBucket[idx] = AssessmentStudioData.normalizeQuestion({ ...studio.questionBucket[idx], ...question });
        else studio.questionBucket.unshift(AssessmentStudioData.normalizeQuestion({ ...question, createdAt: new Date().toISOString() }));
        await AssessmentStudioData.saveStudio();
        this.toast('Question saved.', 'ok');
        if (isNewQuestion) {
            this.resetQuestionModalForNext(question.assessment);
            return;
        }
        this.render();
    },

    resetQuestionModalForNext(assessment) {
        const keepAssessment = String(assessment || '').trim();
        const currentType = document.getElementById('questionType')?.value || 'multiple_choice';
        const modal = document.querySelector('.ast-question-modal');
        if (!modal) {
            this.openQuestionModal();
            setTimeout(() => {
                const assessmentInput = document.getElementById('questionAssessment');
                if (assessmentInput) assessmentInput.value = keepAssessment;
            }, 0);
            return;
        }
        document.getElementById('questionId').value = '';
        document.getElementById('questionAssessment').value = keepAssessment;
        document.getElementById('questionText').value = '';
        document.getElementById('questionPoints').value = '1';
        const typeSelect = document.getElementById('questionType');
        if (typeSelect) typeSelect.value = currentType;
        const groupingSelect = document.getElementById('questionGrouping');
        if (groupingSelect) {
            groupingSelect.value = '';
            groupingSelect.dataset.previous = '';
        }
        const groupingBox = document.getElementById('questionGroupingCreate');
        if (groupingBox) groupingBox.classList.add('hidden');
        const tagSelect = document.getElementById('questionTag');
        if (tagSelect) {
            tagSelect.value = '';
            tagSelect.dataset.previous = '';
        }
        const tagBox = document.getElementById('questionTagCreate');
        if (tagBox) tagBox.classList.add('hidden');
        this.renderTypeHelp();
        setTimeout(() => document.getElementById('questionText')?.focus(), 0);
    },

    loadQuestionForEdit(id) {
        this.openQuestionModal(id);
    },

    clearQuestionForm() {
        this.openQuestionModal();
    },

    async archiveQuestion(id) {
        if (!confirm('Archive this bucket question? Existing generated snapshots will not change.')) return;
        const q = this.state().studio.questionBucket.find(item => item.id === id);
        if (!q) return;
        q.status = 'archived';
        q.updatedAt = new Date().toISOString();
        q.updatedBy = AssessmentStudioData.editor();
        await AssessmentStudioData.saveStudio();
        this.render();
    },

    filterBucket() {
        const term = this.normalize(document.getElementById('bucketSearch')?.value || '');
        const assessment = document.getElementById('bucketAssessmentFilter')?.value || '';
        const type = document.getElementById('bucketTypeFilter')?.value || '';
        const grouping = document.getElementById('bucketGroupingFilter')?.value || '';
        const tag = document.getElementById('bucketTagFilter')?.value || '';
        document.querySelectorAll('[data-bucket-row]').forEach(row => {
            const rowTags = String(row.dataset.tags || '').split('|').filter(Boolean);
            const ok = (!term || String(row.dataset.search || '').includes(term)) &&
                (!assessment || row.dataset.assessment === assessment) &&
                (!type || row.dataset.type === type) &&
                (!grouping || (grouping === '__none__' ? !row.dataset.grouping : row.dataset.grouping === grouping)) &&
                (!tag || (tag === '__none__' ? !rowTags.length : rowTags.includes(tag)));
            row.style.display = ok ? '' : 'none';
        });
    },

    renderGenerator() {
        const generators = this.state().studio.generators.filter(g => g.status !== 'archived');
        const assessments = this.assessmentOptions();
        return `
            <main class="ast-layout">
                <section class="ast-card">
                    <div class="ast-card-head"><div><h2>Test Generator Details</h2><p>Set parameters, then generate sealed trainee-specific snapshots from the bucket.</p></div></div>
                    <form class="ast-form ast-generator-form" onsubmit="event.preventDefault(); App.saveGenerator();">
                        <input type="hidden" id="generatorId">
                        <div class="ast-grid-3">
                            <div><label>Standard Assessment</label><input id="generatorAssessment" list="assessmentNamesGen" placeholder="Assessment name" oninput="App.renderGeneratorGroupingLimits()"><datalist id="assessmentNamesGen">${assessments.map(name => `<option value="${this.esc(name)}"></option>`).join('')}</datalist></div>
                            <div><label>Total Points / Score</label><input id="generatorTotal" type="number" min="1" step="1" value="100"></div>
                            <div><label>Point Leeway</label><input id="generatorLeeway" type="number" min="0" step="0.5" value="7"></div>
                        </div>
                        <label>Question Types Allowed</label>
                        <div class="ast-check-grid">${QUESTION_TYPES.map(t => `<label><input type="checkbox" name="generatorTypes" value="${t.key}" checked> ${this.esc(t.label)}</label>`).join('')}</div>
                        <div id="generatorGroupingLimits" class="ast-generator-groups">
                            <div class="ast-note">Select a Standard Assessment to configure grouping limits.</div>
                        </div>
                        <div class="ast-actions">
                            <button type="button" class="ast-btn" onclick="App.testGeneratorDetails()"><i class="fas fa-flask"></i> Test Generate</button>
                            <button class="ast-btn primary"><i class="fas fa-save"></i> Save Generator</button>
                        </div>
                        <div id="generatorTestResult" class="ast-generator-test hidden"></div>
                    </form>
                    <div class="ast-filters">
                        <input id="generatorSearchFilter" type="search" placeholder="Search generators..." oninput="App.filterGenerators()">
                        <select id="generatorAssessmentFilter" onchange="App.filterGenerators()"><option value="">All assessments</option>${assessments.map(name => `<option>${this.esc(name)}</option>`).join('')}</select>
                        <select id="generatorTypeFilter" onchange="App.filterGenerators()"><option value="">All question types</option>${QUESTION_TYPES.map(t => `<option value="${t.key}">${this.esc(t.label)}</option>`).join('')}</select>
                    </div>
                    <div class="ast-table-wrap">
                        <table class="ast-table"><thead><tr><th>Assessment</th><th>Total Points</th><th>Leeway</th><th>Types</th><th>Action</th></tr></thead><tbody>${generators.length ? generators.map(g => this.renderGeneratorRow(g)).join('') : '<tr><td colspan="5" class="ast-empty">No generator details saved yet.</td></tr>'}</tbody></table>
                    </div>
                </section>
            </main>
        `;
    },

    renderGeneratorRow(g) {
        return `
            <tr data-generator-row data-search="${this.esc(`${g.assessment} ${(g.allowedTypes || []).join(' ')} ${Object.keys(g.groupLimits || {}).join(' ')}`.toLowerCase())}" data-assessment="${this.esc(g.assessment)}" data-types="${this.esc((g.allowedTypes || []).join('|'))}">
                <td>${this.esc(g.assessment)}</td>
                <td>${this.esc(g.totalPoints)}</td>
                <td>${this.esc(`+/- ${Number(g.pointLeeway || 7)} pts`)}</td>
                <td>
                    ${g.allowedTypes.map(t => `<span class="ast-chip">${this.esc(this.typeLabel(t))}</span>`).join(' ')}
                    ${Object.entries(g.groupLimits || {}).filter(([, v]) => Number(v) > 0).map(([name, limit]) => `<span class="ast-chip">${this.esc(name)}: ${this.esc(limit)}</span>`).join(' ')}
                </td>
                <td>
                    <button class="ast-btn small" onclick="App.loadGeneratorForEdit('${this.esc(g.id)}')"><i class="fas fa-pen"></i></button>
                    <button class="ast-btn small danger" onclick="App.archiveGenerator('${this.esc(g.id)}')"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;
    },

    filterGenerators() {
        const term = this.normalize(document.getElementById('generatorSearchFilter')?.value || '');
        const assessment = document.getElementById('generatorAssessmentFilter')?.value || '';
        const type = document.getElementById('generatorTypeFilter')?.value || '';
        document.querySelectorAll('[data-generator-row]').forEach(row => {
            const types = String(row.dataset.types || '').split('|').filter(Boolean);
            const ok = (!term || String(row.dataset.search || '').includes(term)) &&
                (!assessment || row.dataset.assessment === assessment) &&
                (!type || types.includes(type));
            row.style.display = ok ? '' : 'none';
        });
    },

    async saveGenerator() {
        try {
            const generator = {
                ...this.buildGeneratorFromForm(),
                updatedAt: new Date().toISOString(),
                updatedBy: AssessmentStudioData.editor()
            };
            const safety = this.generatorSafetyCheck(generator);
            if (safety.errors.length) return this.toast(safety.errors[0], 'warn');
            const studio = this.state().studio;
            const idx = studio.generators.findIndex(g => g.id === generator.id);
            if (idx >= 0) studio.generators[idx] = AssessmentStudioData.normalizeGenerator({ ...studio.generators[idx], ...generator });
            else studio.generators.unshift(AssessmentStudioData.normalizeGenerator({ ...generator, createdAt: new Date().toISOString() }));
            await AssessmentStudioData.saveStudio();
            this.toast('Generator saved.', 'ok');
            this.render();
        } catch (error) {
            this.handleError(error, 'Generator could not be saved.');
        }
    },

    buildGeneratorFromForm() {
        const rawTotal = Number(document.getElementById('generatorTotal').value || 100);
        const rawLeeway = Number(document.getElementById('generatorLeeway')?.value || 0);
        return {
            id: document.getElementById('generatorId').value || AssessmentStudioData.makeId('gen'),
            assessment: document.getElementById('generatorAssessment').value.trim(),
            totalPoints: Number.isFinite(rawTotal) && rawTotal > 0 ? rawTotal : 100,
            pointLeeway: Number.isFinite(rawLeeway) && rawLeeway >= 0 ? rawLeeway : 7,
            allowedTypes: Array.from(document.querySelectorAll('input[name="generatorTypes"]:checked')).map(el => el.value),
            groupLimits: this.collectGeneratorGroupLimits()
        };
    },

    loadGeneratorForEdit(id) {
        const g = this.state().studio.generators.find(item => item.id === id);
        if (!g) return;
        document.getElementById('generatorId').value = g.id;
        document.getElementById('generatorAssessment').value = g.assessment;
        document.getElementById('generatorTotal').value = g.totalPoints;
        document.getElementById('generatorLeeway').value = Number.isFinite(Number(g.pointLeeway)) ? Number(g.pointLeeway) : 7;
        document.querySelectorAll('input[name="generatorTypes"]').forEach(el => { el.checked = g.allowedTypes.includes(el.value); });
        this.renderGeneratorGroupingLimits(g.groupLimits || {});
        const result = document.getElementById('generatorTestResult');
        if (result) result.classList.add('hidden');
    },

    renderGeneratorGroupingLimits(existingLimits = null) {
        const target = document.getElementById('generatorGroupingLimits');
        if (!target) return;
        const assessment = document.getElementById('generatorAssessment')?.value || '';
        const groups = this.assessmentGroupings(assessment);
        const limits = existingLimits || {};
        if (!assessment) {
            target.innerHTML = '<div class="ast-note">Select a Standard Assessment to configure grouping limits.</div>';
            return;
        }
        if (!groups.length) {
            target.innerHTML = '<div class="ast-note">No groupings exist yet for this Standard Assessment.</div>';
            return;
        }
        target.innerHTML = `
            <section class="ast-question-builder">
                <div class="ast-builder-head"><h3>Grouping Limits</h3><span>Set the maximum number of questions from each grouping</span></div>
                <div class="ast-group-limit-grid">
                    ${groups.map(name => {
                        const count = this.state().studio.questionBucket.filter(q => this.normalize(q.assessment) === this.normalize(assessment) && this.normalize(q.grouping || '') === this.normalize(name)).length;
                        const value = limits[name] !== undefined ? limits[name] : '';
                        return `<label>${this.esc(name)} <small>${count} in bucket</small><input class="generator-group-limit" data-group="${this.esc(name)}" type="number" min="0" step="1" value="${this.esc(value)}" placeholder="No limit"></label>`;
                    }).join('')}
                </div>
            </section>
        `;
    },

    collectGeneratorGroupLimits() {
        const limits = {};
        document.querySelectorAll('.generator-group-limit').forEach(input => {
            const group = String(input.dataset.group || '').trim();
            const value = Math.max(0, Math.floor(Number(input.value || 0)));
            if (group && value > 0) limits[group] = value;
        });
        return limits;
    },

    async archiveGenerator(id) {
        if (!confirm('Archive this generator? Existing generated tests remain intact.')) return;
        const g = this.state().studio.generators.find(item => item.id === id);
        if (!g) return;
        g.status = 'archived';
        g.updatedAt = new Date().toISOString();
        g.updatedBy = AssessmentStudioData.editor();
        await AssessmentStudioData.saveStudio();
        this.render();
    },

    shuffle(items, seedText) {
        const arr = [...items];
        let seed = 0;
        String(seedText || '').split('').forEach(ch => { seed = ((seed << 5) - seed) + ch.charCodeAt(0); seed |= 0; });
        const rand = () => {
            seed = (seed * 1664525 + 1013904223) | 0;
            return ((seed >>> 0) / 4294967296);
        };
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    },

    evaluateGenerator(generator, options = {}) {
        const pool = this.state().studio.questionBucket.filter(q =>
            q.status !== 'archived' &&
            this.normalize(q.assessment) === this.normalize(generator.assessment) &&
            generator.allowedTypes.includes(q.type)
        );
        if (!pool.length) throw new Error('No bucket questions match this generator.');

        const targetPoints = Number(generator.totalPoints || 0);
        const leeway = Math.max(0, Number(generator.pointLeeway || 0));
        const minPoints = Math.max(0, targetPoints - leeway);
        const maxPoints = targetPoints + leeway;
        const existingSignatures = options.ignoreExistingSignatures ? new Set() : new Set(this.state().studio.submissions
            .filter(s => this.normalize(s.assessment) === this.normalize(generator.assessment))
            .map(s => String(s.testSnapshot && s.testSnapshot.signature || '')));

        let best = null;
        const attempts = Number(options.attempts || 72);
        const seedBase = String(options.seed || `${generator.id}|preview`);
        for (let attempt = 0; attempt < attempts; attempt++) {
            const shuffled = this.shuffle(pool, `${seedBase}|${attempt}`);
            const candidate = [];
            let points = 0;
            const groupCounts = {};
            const groupLimits = generator.groupLimits && typeof generator.groupLimits === 'object' ? generator.groupLimits : {};
            for (const q of shuffled) {
                const group = String(q.grouping || '').trim();
                const limit = group ? Number(groupLimits[group] || 0) : 0;
                if (limit > 0 && Number(groupCounts[group] || 0) >= limit) continue;
                const qPoints = Number(q.points || 1);
                if (points + qPoints > maxPoints && candidate.length) continue;
                candidate.push({ ...q, bucketQuestionId: q.id });
                if (group) groupCounts[group] = Number(groupCounts[group] || 0) + 1;
                points += qPoints;
                if (points >= minPoints) break;
            }
            const candidateSignature = candidate.map(q => q.id).sort().join('|');
            if (existingSignatures.has(candidateSignature)) continue;
            const inRange = points >= minPoints && points <= maxPoints;
            const distance = Math.abs(targetPoints - points);
            if (!best || (inRange && !best.inRange) || (inRange === best.inRange && distance < best.distance) || (distance === best.distance && points > best.points)) {
                best = { questions: candidate, signature: candidateSignature, points, inRange, distance };
            }
            if (inRange) break;
        }

        if (!best || !best.questions.length) throw new Error('Generator could not select any questions with the current filters and grouping limits.');
        return {
            pool,
            targetPoints,
            leeway,
            minPoints,
            maxPoints,
            best,
            requiredLeeway: Math.round(Math.abs(targetPoints - best.points) * 10) / 10
        };
    },

    testGeneratorDetails() {
        const result = document.getElementById('generatorTestResult');
        if (!result) return;
        try {
            const generator = this.buildGeneratorFromForm();
            if (!generator.assessment || !generator.allowedTypes.length) {
                result.className = 'ast-generator-test warn';
                result.innerHTML = '<strong>Generator needs an assessment and at least one question type.</strong>';
                return;
            }
            const safety = this.generatorSafetyCheck(generator);
            if (safety.errors.length) {
                result.className = 'ast-generator-test error';
                result.innerHTML = `<strong>${this.esc(safety.errors[0])}</strong>`;
                return;
            }
            const test = this.evaluateGenerator(generator, { ignoreExistingSignatures: true, seed: `${generator.assessment}|${generator.totalPoints}|${Date.now()}`, attempts: 120 });
            const status = test.best.inRange ? 'ok' : 'warn';
            const typeCounts = {};
            const groupCounts = {};
            test.best.questions.forEach(q => {
                typeCounts[q.type] = Number(typeCounts[q.type] || 0) + 1;
                const group = String(q.grouping || 'Ungrouped').trim() || 'Ungrouped';
                groupCounts[group] = Number(groupCounts[group] || 0) + 1;
            });
            result.className = `ast-generator-test ${status}`;
            result.innerHTML = `
                <div class="ast-generator-test-head">
                    <div>
                        <strong>${test.best.inRange ? 'Target is achievable' : 'Closest generated result is outside leeway'}</strong>
                        <span>Target ${this.esc(test.targetPoints)} pts | Current range ${this.esc(test.minPoints)}-${this.esc(test.maxPoints)} pts | Generated ${this.esc(Math.round(test.best.points * 10) / 10)} pts</span>
                    </div>
                    ${test.best.inRange ? '' : `<button type="button" class="ast-btn small" onclick="App.applyGeneratorLeeway(${this.esc(test.requiredLeeway)})">Use ${this.esc(test.requiredLeeway)} leeway</button>`}
                </div>
                <div class="ast-generator-test-grid">
                    <span><strong>${this.esc(test.pool.length)}</strong> matching bucket questions</span>
                    <span><strong>${this.esc(test.best.questions.length)}</strong> selected questions</span>
                    <span><strong>${this.esc(test.requiredLeeway)}</strong> minimum leeway needed</span>
                </div>
                <div class="ast-generator-test-breakdown">
                    ${Object.entries(typeCounts).map(([type, count]) => `<span>${this.esc(this.typeLabel(type))}: ${this.esc(count)}</span>`).join('')}
                    ${Object.entries(groupCounts).map(([group, count]) => `<span>${this.esc(group)}: ${this.esc(count)}</span>`).join('')}
                </div>
            `;
        } catch (error) {
            result.className = 'ast-generator-test error';
            result.innerHTML = `<strong>${this.esc(error.message || 'Test generation failed.')}</strong>`;
        }
    },

    applyGeneratorLeeway(value) {
        const input = document.getElementById('generatorLeeway');
        if (!input) return;
        input.value = Math.max(0, Number(value || 0));
        this.testGeneratorDetails();
    },

    generateSnapshot(generator, trainee) {
        const test = this.evaluateGenerator(generator, { seed: `${trainee}|${generator.id}|${Date.now()}`, attempts: 72 });
        const picked = test.best.questions || [];
        const signature = test.best.signature || '';
        if (!picked.length) throw new Error('Generator could not select any questions.');
        return {
            id: AssessmentStudioData.makeId('snapshot'),
            title: generator.assessment,
            phase: generator.phase || 'Assessment',
            generatedFor: trainee,
            generatedAt: new Date().toISOString(),
            generatorId: generator.id,
            signature,
            targetPoints: test.targetPoints,
            pointLeeway: test.leeway,
            totalPoints: picked.reduce((sum, q) => sum + Number(q.points || 1), 0),
            questions: picked
        };
    },

    findGroupForTrainee(trainee) {
        const target = this.normalize(trainee);
        for (const [gid, members] of Object.entries(this.state().legacy.rosters || {})) {
            if (Array.isArray(members) && members.some(name => this.normalize(name) === target)) return gid;
        }
        return '';
    },

    renderCompleted() {
        const rows = this.getCombinedSubmissions().filter(s => s.source === 'legacy' || ['pending_review', 'completed'].includes(String(s.status || '')));
        return `
            <main class="ast-single-layout">
                <section class="ast-card">
                    <div class="ast-card-head"><div><h2>Completed Tests</h2><p>Submitted Assessment Studio tests and legacy Test Engine history remain visible here for records.</p></div></div>
                    ${this.renderCompletedFilters({ includeSource: true })}
                    <div class="ast-table-wrap">
                        <table class="ast-table"><thead><tr><th>Date</th><th>Group</th><th>Trainee</th><th>Assessment</th><th>Status</th><th>Score</th><th>Action</th></tr></thead><tbody id="completedRows">${rows.length ? rows.map(s => this.renderCompletedRow(s, { gradingAction: false })).join('') : '<tr><td colspan="7" class="ast-empty">No submissions found.</td></tr>'}</tbody></table>
                    </div>
                </section>
            </main>
        `;
    },

    renderGradingQueue() {
        const rows = this.getCombinedSubmissions().filter(s => s.source === 'studio' && ['pending_review', 'completed'].includes(String(s.status || '')));
        const selected = this.selectedSubmissionId ? this.state().studio.submissions.find(s => s.id === this.selectedSubmissionId) : null;
        if (selected) {
            return `
                <main class="ast-grading-full">
                    ${this.renderGrader(selected)}
                </main>
            `;
        }
        return `
            <main class="ast-single-layout">
                <section class="ast-card">
                    <div class="ast-card-head"><div><h2>Grading Queue</h2><p>Dedicated review workspace for generated Assessment Studio submissions.</p></div></div>
                    ${this.renderCompletedFilters({ includeSource: false })}
                    <div class="ast-table-wrap ast-grade-queue-table">
                        <table class="ast-table"><thead><tr><th>Date</th><th>Group</th><th>Trainee</th><th>Assessment</th><th>Status</th><th>Score</th><th>Action</th></tr></thead><tbody id="completedRows">${rows.length ? rows.map(s => this.renderCompletedRow(s, { gradingAction: true })).join('') : '<tr><td colspan="7" class="ast-empty">No Assessment Studio submissions found.</td></tr>'}</tbody></table>
                    </div>
                </section>
            </main>
        `;
    },

    renderCompletedFilters(options = {}) {
        const rows = options.includeSource === false
            ? this.getCombinedSubmissions().filter(s => s.source === 'studio')
            : this.getCombinedSubmissions();
        const assessments = Array.from(new Set(rows.map(s => s.assessment).filter(Boolean))).sort();
        const groups = Array.from(new Set(rows.map(s => s.groupID).filter(Boolean))).sort((a, b) => String(b).localeCompare(String(a), undefined, { numeric: true }));
        return `
            <div class="ast-filters">
                <input id="completedTraineeFilter" type="search" placeholder="Search trainee..." oninput="App.filterCompleted()">
                <select id="completedAssessmentFilter" onchange="App.filterCompleted()"><option value="">All assessments</option>${assessments.map(name => `<option>${this.esc(name)}</option>`).join('')}</select>
                <select id="completedGroupFilter" onchange="App.filterCompleted()"><option value="">All groups</option><option value="__none__">No group</option>${groups.map(group => `<option value="${this.esc(group)}">${this.esc(group)}</option>`).join('')}</select>
                <select id="completedStatusFilter" onchange="App.filterCompleted()"><option value="">All statuses</option><option value="assigned">Assigned</option><option value="pending_review">Pending Review</option><option value="completed">Completed</option><option value="legacy">Legacy</option></select>
                ${options.includeSource === false ? '' : '<select id="completedSourceFilter" onchange="App.filterCompleted()"><option value="">All sources</option><option value="studio">Assessment Studio</option><option value="legacy">Legacy Test Engine</option></select>'}
                <input id="completedDateFromFilter" type="date" title="From date" onchange="App.filterCompleted()">
                <input id="completedDateToFilter" type="date" title="To date" onchange="App.filterCompleted()">
            </div>
        `;
    },

    getCombinedSubmissions() {
        const studioRows = this.state().studio.submissions.map(s => ({ ...s, source: 'studio' }));
        const legacyRows = this.state().legacy.submissions.map(s => ({
            id: s.id,
            trainee: s.trainee,
            groupID: s.groupID || '',
            assessment: s.testTitle || s.assessment || 'Legacy Test',
            status: String(s.status || '').toLowerCase() === 'completed' ? 'completed' : 'legacy',
            percent: Number(s.score || 0),
            generatedAt: s.date || s.submittedAt || s.createdAt || '',
            submittedAt: s.submittedAt || s.date || '',
            feedbackStatus: s.feedbackStatus || 'none',
            source: 'legacy'
        }));
        return [...studioRows, ...legacyRows].sort((a, b) => String(b.submittedAt || b.generatedAt || '').localeCompare(String(a.submittedAt || a.generatedAt || '')));
    },

    markerName() {
        return AssessmentStudioData.editor();
    },

    markerSessionKey() {
        return `${this.markerName()}::${this.markerSessionId}`;
    },

    getActiveGradingLock(submission) {
        if (!submission || String(submission.status || '') !== 'pending_review') return null;
        const lock = submission && submission.gradingLock;
        if (!lock || !lock.expiresAt) return null;
        return new Date(lock.expiresAt).getTime() > Date.now() ? lock : null;
    },

    isOwnGradingLock(lock) {
        return lock && lock.markerSession === this.markerSessionKey();
    },

    gradingLockBadge(submission) {
        const lock = this.getActiveGradingLock(submission);
        if (!lock) return '<span class="ast-lock-badge available"><i class="fas fa-unlock"></i> Available</span>';
        if (this.isOwnGradingLock(lock)) return '<span class="ast-lock-badge mine"><i class="fas fa-pen"></i> You are grading</span>';
        return `<span class="ast-lock-badge locked"><i class="fas fa-lock"></i> ${this.esc(lock.marker || 'Another admin')} is grading</span>`;
    },

    async claimSubmissionLock(id) {
        const sub = this.state().studio.submissions.find(s => s.id === id);
        if (!sub) return false;
        if (String(sub.status || '') !== 'pending_review') return true;
        const activeLock = this.getActiveGradingLock(sub);
        if (activeLock && !this.isOwnGradingLock(activeLock)) {
            this.toast(`${activeLock.marker || 'Another admin'} is already grading this test.`, 'warn');
            return false;
        }
        const now = new Date();
        sub.gradingLock = {
            marker: this.markerName(),
            markerSession: this.markerSessionKey(),
            claimedAt: activeLock?.claimedAt || now.toISOString(),
            heartbeatAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + AST_GRADING_LEASE_MS).toISOString()
        };
        sub.updatedAt = now.toISOString();
        sub.updatedBy = this.markerName();
        await AssessmentStudioData.saveStudio();
        return true;
    },

    async releaseSubmissionLock(id) {
        const sub = this.state().studio.submissions.find(s => s.id === id);
        if (!sub) return;
        const activeLock = this.getActiveGradingLock(sub);
        if (!activeLock || !this.isOwnGradingLock(activeLock)) return;
        sub.gradingLock = null;
        sub.updatedAt = new Date().toISOString();
        sub.updatedBy = this.markerName();
        await AssessmentStudioData.saveStudio();
    },

    async closeGrader() {
        const id = this.selectedSubmissionId;
        if (id) await this.releaseSubmissionLock(id);
        this.selectedSubmissionId = null;
        this.view = 'grading';
        this.render();
    },

    renderCompletedRow(s, options = {}) {
        const date = s.submittedAt || s.generatedAt || '';
        const score = s.status === 'completed' ? `${Math.round(Number(s.percent || 0))}%` : '-';
        const activeLock = s.source === 'studio' ? this.getActiveGradingLock(s) : null;
        const lockedByOther = activeLock && !this.isOwnGradingLock(activeLock);
        const lockBadge = s.source === 'studio' ? this.gradingLockBadge(s) : '';
        const deleteAction = s.source === 'studio'
            ? ` <button class="ast-btn small danger" onclick="App.deleteSubmission('${this.esc(s.id)}')" ${lockedByOther ? 'disabled' : ''}><i class="fas fa-trash"></i></button>`
            : '';
        const action = s.source === 'studio'
            ? (options.gradingAction
                ? `<button class="ast-btn small primary" onclick="App.selectSubmission('${this.esc(s.id)}')" ${lockedByOther ? 'disabled' : ''}><i class="fas fa-pen"></i> Grade</button>${s.status === 'assigned' ? ` <button class="ast-btn small" onclick="App.mockSubmit('${this.esc(s.id)}')">Demo Submit</button>` : ''}${deleteAction}`
                : `<button class="ast-btn small" onclick="App.selectSubmission('${this.esc(s.id)}')"><i class="fas fa-pen-to-square"></i> Open Grading</button>${deleteAction}`)
            : '<span class="ast-muted">Legacy</span>';
        return `
            <tr data-completed-row data-search="${this.esc(`${s.trainee} ${s.assessment} ${s.groupID} ${s.status} ${s.source}`.toLowerCase())}" data-assessment="${this.esc(s.assessment)}" data-group="${this.esc(s.groupID || '')}" data-status="${this.esc(s.source === 'legacy' ? 'legacy' : s.status)}" data-source="${this.esc(s.source || 'studio')}" data-date="${this.esc(String(date).slice(0, 10))}">
                <td>${this.esc(String(date).slice(0, 10) || '-')}</td><td>${this.esc(s.groupID || '-')}</td><td>${this.esc(s.trainee)}</td><td>${this.esc(s.assessment)}${lockBadge ? `<div class="ast-row-lock">${lockBadge}</div>` : ''}</td><td><span class="ast-status ${this.esc(s.status)}">${this.esc(s.source === 'legacy' ? 'legacy' : s.status)}</span></td><td>${score}</td><td>${action}</td>
            </tr>
        `;
    },

    filterCompleted() {
        const term = this.normalize(document.getElementById('completedTraineeFilter')?.value || '');
        const assessment = document.getElementById('completedAssessmentFilter')?.value || '';
        const group = document.getElementById('completedGroupFilter')?.value || '';
        const status = document.getElementById('completedStatusFilter')?.value || '';
        const source = document.getElementById('completedSourceFilter')?.value || '';
        const dateFrom = document.getElementById('completedDateFromFilter')?.value || '';
        const dateTo = document.getElementById('completedDateToFilter')?.value || '';
        document.querySelectorAll('[data-completed-row]').forEach(row => {
            const rowDate = row.dataset.date || '';
            const ok = (!term || String(row.dataset.search || '').includes(term)) &&
                (!assessment || row.dataset.assessment === assessment) &&
                (!group || (group === '__none__' ? !row.dataset.group : row.dataset.group === group)) &&
                (!status || row.dataset.status === status) &&
                (!source || row.dataset.source === source) &&
                (!dateFrom || (rowDate && rowDate >= dateFrom)) &&
                (!dateTo || (rowDate && rowDate <= dateTo));
            row.style.display = ok ? '' : 'none';
        });
    },

    async selectSubmission(id) {
        const sub = this.state().studio.submissions.find(s => s.id === id);
        const safetyErrors = this.submissionSafetyErrors(sub);
        if (safetyErrors.length) {
            this.toast(safetyErrors[0], 'error');
            return;
        }
        const claimed = await this.claimSubmissionLock(id);
        if (!claimed) {
            this.render();
            return;
        }
        this.selectedSubmissionId = id;
        this.view = 'grading';
        this.render();
    },

    async deleteSubmission(id) {
        const studio = this.state().studio;
        const sub = studio.submissions.find(item => item.id === id);
        if (!sub) return this.toast('Assessment Studio submission not found.', 'warn');
        const label = `${sub.trainee || 'Unknown trainee'} - ${sub.assessment || 'Assessment'}`;
        if (!confirm(`Delete this Assessment Studio test?\n\n${label}\n\nThis removes the generated snapshot, trainee answers, grading scores, and feedback state for this record.`)) return;
        sub.gradingLock = null;
        studio.submissions = studio.submissions.filter(item => item.id !== id);
        if (this.selectedSubmissionId === id) this.selectedSubmissionId = null;
        studio.updatedAt = new Date().toISOString();
        studio.updatedBy = AssessmentStudioData.editor();
        await AssessmentStudioData.saveStudio();
        this.toast('Assessment Studio test deleted.', 'ok');
        this.render();
    },

    answerAt(sub, idx) {
        const answers = sub && sub.answers && typeof sub.answers === 'object' ? sub.answers : {};
        if (Object.prototype.hasOwnProperty.call(answers, idx)) return answers[idx];
        return answers[String(idx)];
    },

    scoreAt(sub, q, idx) {
        const auto = this.autoScoreQuestion(q, this.answerAt(sub, idx));
        if (String(sub && sub.status || '') !== 'completed' && !auto.manual) return auto.score;
        const scores = sub && sub.questionScores && typeof sub.questionScores === 'object' ? sub.questionScores : {};
        if (Object.prototype.hasOwnProperty.call(scores, idx)) return scores[idx];
        if (Object.prototype.hasOwnProperty.call(scores, String(idx))) return scores[String(idx)];
        return auto.score;
    },

    valueAt(answer, key) {
        if (Array.isArray(answer)) return answer[key];
        if (answer && typeof answer === 'object') {
            if (Object.prototype.hasOwnProperty.call(answer, key)) return answer[key];
            if (Object.prototype.hasOwnProperty.call(answer, String(key))) return answer[String(key)];
        }
        return undefined;
    },

    normalizeAnswerText(value) {
        return String(value === undefined || value === null ? '' : value).trim().toLowerCase().replace(/\s+/g, ' ');
    },

    choiceIndex(q, value) {
        if (value !== null && value !== undefined && String(value).trim() !== '' && Number.isInteger(Number(value))) return Number(value);
        const wanted = this.normalizeAnswerText(value);
        if (!wanted) return -1;
        return (q.options || []).findIndex(option => this.normalizeAnswerText(option) === wanted);
    },

    choiceIndexSet(q, values) {
        return new Set((Array.isArray(values) ? values : [])
            .map(value => this.choiceIndex(q, value))
            .filter(value => Number.isInteger(value) && value >= 0));
    },

    roundScore(value) {
        return Math.round((Number(value) || 0) * 10) / 10;
    },

    autoScoreQuestion(q, answer) {
        const max = Number(q.points || 1);
        if (q.type === 'text') return { score: 0, max, manual: true };
        if (q.type === 'multiple_choice') {
            const expected = this.choiceIndex(q, q.correct);
            const got = this.choiceIndex(q, answer);
            return { score: expected >= 0 && got === expected ? max : 0, max, manual: false };
        }
        if (q.type === 'multi_select') {
            const correct = this.choiceIndexSet(q, Array.isArray(q.correct) ? q.correct : []);
            const got = this.choiceIndexSet(q, Array.isArray(answer) ? answer : []);
            if (!correct.size) return { score: 0, max, manual: false };
            const correctSelected = Array.from(got).filter(v => correct.has(v)).length;
            const wrongSelected = Array.from(got).filter(v => !correct.has(v)).length;
            const unit = max / correct.size;
            const score = Math.max(0, Math.min(max, (correctSelected - wrongSelected) * unit));
            return { score: this.roundScore(score), max, manual: false };
        }
        if (q.type === 'matching') {
            const pairs = Array.isArray(q.pairs) ? q.pairs : [];
            const correct = pairs.filter((p, idx) => this.normalizeAnswerText(this.valueAt(answer, idx)) === this.normalizeAnswerText(p.right)).length;
            return { score: pairs.length ? Math.round((correct / pairs.length) * max * 10) / 10 : 0, max, manual: false };
        }
        if (q.type === 'ranking') {
            const expected = Array.isArray(q.items) ? q.items : [];
            const got = Array.isArray(answer) ? answer : [];
            if (!expected.length) return { score: 0, max, manual: false };
            const correctPositions = expected.filter((v, i) => this.normalizeAnswerText(got[i]) === this.normalizeAnswerText(v)).length;
            return { score: this.roundScore((correctPositions / expected.length) * max), max, manual: false };
        }
        if (q.type === 'matrix') {
            const rows = Array.isArray(q.rows) ? q.rows : [];
            const cols = Array.isArray(q.cols) ? q.cols : [];
            const correct = rows.filter((_, idx) => {
                const expected = this.valueAt(q.matrixCorrect || {}, idx);
                const got = this.valueAt(answer, idx);
                if (Number.isInteger(Number(expected)) || Number.isInteger(Number(got))) return Number(got) === Number(expected);
                const expectedIndex = cols.findIndex(col => this.normalizeAnswerText(col) === this.normalizeAnswerText(expected));
                const gotIndex = cols.findIndex(col => this.normalizeAnswerText(col) === this.normalizeAnswerText(got));
                return expectedIndex >= 0 && gotIndex === expectedIndex;
            }).length;
            return { score: rows.length ? Math.round((correct / rows.length) * max * 10) / 10 : 0, max, manual: false };
        }
        return { score: 0, max, manual: true };
    },

    renderGrader(sub) {
        const questions = sub.testSnapshot.questions || [];
        const total = questions.reduce((sum, q, idx) => {
            const score = this.scoreAt(sub, q, idx);
            return sum + Number(score || 0);
        }, 0);
        const max = questions.reduce((sum, q) => sum + Number(q.points || 1), 0);
        return `
            <section class="ast-card ast-grader">
            <div class="ast-grader-head">
                <button class="ast-btn" onclick="App.closeGrader()"><i class="fas fa-arrow-left"></i> Queue</button>
                <div class="ast-grader-title">
                    <span>Current Test</span>
                    <h2>${this.esc(sub.trainee)}</h2>
                    <p>${this.esc(sub.assessment)}</p>
                    <div class="ast-grader-meta">
                        <span><i class="fas fa-layer-group"></i> ${this.esc(sub.groupID || '-')}</span>
                        <span><i class="fas fa-clipboard-check"></i> ${this.esc(sub.status)}</span>
                        <span><i class="fas fa-star"></i> ${Math.round(total * 10) / 10}/${max} points</span>
                        ${this.gradingLockBadge(sub)}
                    </div>
                </div>
                <div class="ast-actions">
                    <button class="ast-btn primary" onclick="App.saveGrade('${this.esc(sub.id)}')"><i class="fas fa-save"></i> Save Grade</button>
                    <button class="ast-btn danger" onclick="App.deleteSubmission('${this.esc(sub.id)}')"><i class="fas fa-trash"></i> Delete</button>
                </div>
            </div>
            <div class="ast-grader-list">
                ${questions.map((q, idx) => this.renderGradeQuestion(sub, q, idx)).join('')}
            </div>
            <label>Grader Notes</label>
            <textarea id="graderNotes" rows="4">${this.esc(sub.graderNotes || '')}</textarea>
            </section>
        `;
    },

    renderGradeQuestion(sub, q, idx) {
        const answer = this.answerAt(sub, idx);
        const auto = this.autoScoreQuestion(q, answer);
        const score = this.scoreAt(sub, q, idx);
        return `
            <article class="ast-grade-question">
                <div class="ast-grade-top">
                    <strong>Q${idx + 1}. ${this.esc(q.text)}</strong>
                    <span>${this.esc(this.typeLabel(q.type))} | ${auto.manual ? 'Manual' : `Auto ${this.esc(auto.score)}/${this.esc(auto.max)}`} | Max ${this.esc(q.points)}</span>
                </div>
                ${q.type === 'text' && q.suggestedAnswer ? `<div class="ast-suggested-answer"><strong>Suggested Answer</strong><p>${this.esc(q.suggestedAnswer)}</p></div>` : ''}
                <div class="ast-answer">${this.renderAnswer(q, answer)}</div>
                <label>Score</label>
                <input class="grade-score" data-qidx="${idx}" type="number" min="0" max="${this.esc(q.points)}" step="0.5" value="${this.esc(score)}">
            </article>
        `;
    },

    renderAnswer(q, answer) {
        if (answer === undefined || answer === null || answer === '') return '<span class="ast-muted">No answer captured.</span>';
        if (q.type === 'multiple_choice') return this.renderChoiceAnswer(q, answer, false);
        if (q.type === 'multi_select') return this.renderChoiceAnswer(q, answer, true);
        if (q.type === 'matching') return this.renderMatchingAnswer(q, answer);
        if (q.type === 'ranking') return this.renderRankingAnswer(q, answer);
        if (q.type === 'matrix') return this.renderMatrixAnswer(q, answer);
        return this.esc(answer);
    },

    renderChoiceAnswer(q, answer, isMulti) {
        const options = Array.isArray(q.options) ? q.options : [];
        if (!options.length) return '<span class="ast-muted">No options configured.</span>';
        const selected = isMulti ? this.choiceIndexSet(q, Array.isArray(answer) ? answer : []) : new Set([this.choiceIndex(q, answer)]);
        const correct = isMulti ? this.choiceIndexSet(q, Array.isArray(q.correct) ? q.correct : []) : new Set([this.choiceIndex(q, q.correct)]);
        return `
            <div class="ast-review-choice-list" role="group" aria-label="${isMulti ? 'Multiple answer' : 'Multiple choice'} answer">
                ${options.map((option, optionIdx) => {
                    const isSelected = selected.has(optionIdx);
                    const isCorrect = correct.has(optionIdx);
                    const state = isSelected && isCorrect ? 'correct' : (isSelected && !isCorrect ? 'incorrect' : (isCorrect ? 'expected' : ''));
                    return `
                        <div class="ast-review-choice-row ${state}">
                            <span class="ast-review-choice-dot ${isSelected ? 'selected' : ''}">${isSelected ? '&bull;' : ''}</span>
                            <span class="ast-review-choice-text">${this.esc(option)}</span>
                            <span class="ast-review-choice-mark">${isSelected && isCorrect ? '<i class="fas fa-check"></i>' : (isSelected && !isCorrect ? '<i class="fas fa-xmark"></i>' : (isCorrect ? '<i class="fas fa-check"></i>' : ''))}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    },

    renderMatchingAnswer(q, answer) {
        const pairs = Array.isArray(q.pairs) ? q.pairs : [];
        if (!pairs.length) return '<span class="ast-muted">No matching pairs configured.</span>';
        return `
            <div class="ast-review-match-list" role="group" aria-label="Matching pairs answer">
                ${pairs.map((pair, pairIdx) => {
                    const traineeAnswer = this.valueAt(answer, pairIdx) || '';
                    const isCorrect = traineeAnswer && this.normalizeAnswerText(traineeAnswer) === this.normalizeAnswerText(pair.right);
                    return `
                        <div class="ast-review-match-row ${isCorrect ? 'correct' : (traineeAnswer ? 'incorrect' : '')}">
                            <span class="ast-review-match-left">${this.esc(pair.left || '-')}</span>
                            <span class="ast-review-match-value">${this.esc(traineeAnswer || 'No match selected')}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    },

    renderMatrixAnswer(q, answer) {
        const rows = Array.isArray(q.rows) ? q.rows : [];
        const cols = Array.isArray(q.cols) ? q.cols : [];
        if (!rows.length || !cols.length) return '<span class="ast-muted">No matrix rows or columns configured.</span>';
        return `
            <div class="ast-review-matrix-scroll" role="region" aria-label="Matrix answer">
                <div class="ast-review-matrix-grid" style="--ast-review-matrix-cols:${Math.max(cols.length, 1)}">
                    <div class="ast-review-matrix-corner" aria-hidden="true"></div>
                    ${cols.map(col => `<div class="ast-review-matrix-col-head">${this.esc(col)}</div>`).join('')}
                    ${rows.map((row, rowIdx) => `
                        <div class="ast-review-matrix-row-head">${this.esc(row)}</div>
                        ${cols.map((col, colIdx) => {
                            const selectedValue = this.valueAt(answer, rowIdx);
                            const correctValue = this.valueAt(q.matrixCorrect || {}, rowIdx);
                            const selected = Number(selectedValue) === colIdx || this.normalizeAnswerText(selectedValue) === this.normalizeAnswerText(col);
                            const correct = Number(correctValue) === colIdx || this.normalizeAnswerText(correctValue) === this.normalizeAnswerText(col);
                            const mark = selected && correct ? '<i class="fas fa-check"></i>' : (selected && !correct ? '<i class="fas fa-xmark"></i>' : (correct ? '<i class="fas fa-check"></i>' : ''));
                            return `
                                <div class="ast-review-matrix-cell ${selected ? 'selected' : ''} ${correct ? 'correct' : ''} ${selected && !correct ? 'incorrect' : ''}">
                                    <span class="ast-review-radio" aria-hidden="true">${selected ? '&bull;' : ''}</span>
                                    <span class="ast-review-cell-mark" aria-hidden="true">${mark}</span>
                                </div>
                            `;
                        }).join('')}
                    `).join('')}
                </div>
            </div>
        `;
    },

    renderRankingAnswer(q, answer) {
        const expected = Array.isArray(q.items) ? q.items : [];
        const got = Array.isArray(answer) ? answer : [];
        if (!expected.length) return '<span class="ast-muted">No ranking items configured.</span>';
        const rowCount = Math.max(expected.length, got.length);
        return `
            <div class="ast-review-rank-list" role="group" aria-label="Ranking answer">
                ${Array.from({ length: rowCount }).map((_, idx) => {
                    const trainee = got[idx] || '';
                    const correct = expected[idx] || '';
                    const isCorrect = trainee && this.normalizeAnswerText(trainee) === this.normalizeAnswerText(correct);
                    return `
                        <div class="ast-review-rank-row ${isCorrect ? 'correct' : 'incorrect'}">
                            <span class="ast-review-rank-pos">${idx + 1}</span>
                            <span class="ast-review-rank-answer">${this.esc(trainee || 'No answer')}</span>
                            <span class="ast-review-rank-expected">${this.esc(correct || '-')}</span>
                            <span class="ast-review-rank-mark">${isCorrect ? '<i class="fas fa-check"></i>' : '<i class="fas fa-xmark"></i>'}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    },

    async mockSubmit(id) {
        const sub = this.state().studio.submissions.find(s => s.id === id);
        if (!sub) return;
        const answers = {};
        (sub.testSnapshot.questions || []).forEach((q, idx) => {
            if (q.type === 'multiple_choice') answers[idx] = q.correct;
            else if (q.type === 'multi_select') answers[idx] = Array.isArray(q.correct) ? [...q.correct] : [];
            else if (q.type === 'matching') answers[idx] = (q.pairs || []).map(p => p.right);
            else if (q.type === 'ranking') answers[idx] = [...(q.items || [])];
            else if (q.type === 'matrix') answers[idx] = { ...(q.matrixCorrect || {}) };
            else answers[idx] = 'Demo trainee text answer pending admin review.';
        });
        sub.answers = answers;
        sub.status = 'pending_review';
        sub.submittedAt = new Date().toISOString();
        sub.updatedAt = new Date().toISOString();
        await AssessmentStudioData.saveStudio();
        this.selectSubmission(id);
    },

    async saveGrade(id) {
        const sub = this.state().studio.submissions.find(s => s.id === id);
        if (!sub) return;
        const safetyErrors = this.submissionSafetyErrors(sub);
        if (safetyErrors.length) return this.toast(safetyErrors[0], 'error');
        const activeLock = this.getActiveGradingLock(sub);
        if (!activeLock || !this.isOwnGradingLock(activeLock)) {
            const claimed = await this.claimSubmissionLock(id);
            if (!claimed) return;
        }
        const scores = {};
        const scoreInputs = Array.from(document.querySelectorAll('.grade-score'));
        const questions = Array.isArray(sub.testSnapshot?.questions) ? sub.testSnapshot.questions : [];
        if (scoreInputs.length !== questions.length) return this.toast('Every generated question must have a score before completing grading.', 'warn');
        for (const input of scoreInputs) {
            const rawScore = Number(input.value);
            const maxScore = Number(input.max || 0);
            if (!Number.isFinite(rawScore) || rawScore < 0 || rawScore > maxScore) {
                return this.toast('Every score must be between zero and the question max.', 'warn');
            }
            scores[input.dataset.qidx] = Math.round(rawScore * 10) / 10;
        }
        const earned = Object.values(scores).reduce((sum, value) => sum + Number(value || 0), 0);
        const max = (sub.testSnapshot.questions || []).reduce((sum, q) => sum + Number(q.points || 1), 0);
        if (!(max > 0)) return this.toast('Cannot complete grading because this test has no valid maximum score.', 'error');
        sub.questionScores = scores;
        sub.earnedPoints = Math.round(earned * 10) / 10;
        sub.maxPoints = Math.round(max * 10) / 10;
        sub.percent = max ? Math.round((earned / max) * 100) : 0;
        sub.status = 'completed';
        sub.graderNotes = document.getElementById('graderNotes')?.value || '';
        sub.gradedAt = new Date().toISOString();
        sub.gradedBy = AssessmentStudioData.editor();
        sub.updatedAt = new Date().toISOString();
        sub.updatedBy = AssessmentStudioData.editor();
        sub.gradingLock = null;
        if (!Array.isArray(sub.gradingAudit)) sub.gradingAudit = [];
        sub.gradingAudit.push({ at: sub.gradedAt, by: sub.gradedBy, earned: sub.earnedPoints, max: sub.maxPoints, percent: sub.percent });
        await AssessmentStudioData.saveStudio();
        this.toast('Grade saved. Scores remain editable from this queue.', 'ok');
        this.selectedSubmissionId = null;
        this.render();
    },

    renderFeedback() {
        const rows = this.state().studio.submissions.filter(s => s.status === 'completed' || s.status === 'pending_review');
        const assessments = Array.from(new Set(rows.map(s => s.assessment).filter(Boolean))).sort();
        const groups = Array.from(new Set(rows.map(s => s.groupID).filter(Boolean))).sort((a, b) => String(b).localeCompare(String(a), undefined, { numeric: true }));
        return `
            <section class="ast-card">
                <div class="ast-card-head"><div><h2>Feedback Sessions</h2><p>Default feedback status is none. Update only when feedback is requested or received.</p></div></div>
                <div class="ast-filters">
                    <input id="feedbackSearch" type="search" placeholder="Search trainee or assessment..." oninput="App.filterFeedback()">
                    <select id="feedbackAssessmentFilter" onchange="App.filterFeedback()"><option value="">All assessments</option>${assessments.map(name => `<option>${this.esc(name)}</option>`).join('')}</select>
                    <select id="feedbackGroupFilter" onchange="App.filterFeedback()"><option value="">All groups</option><option value="__none__">No group</option>${groups.map(group => `<option value="${this.esc(group)}">${this.esc(group)}</option>`).join('')}</select>
                    <select id="feedbackReviewStatusFilter" onchange="App.filterFeedback()"><option value="">All review states</option><option value="pending_review">Pending Review</option><option value="completed">Completed</option></select>
                    <select id="feedbackStatusFilter" onchange="App.filterFeedback()"><option value="">All feedback states</option><option value="none">None</option><option value="requested">Requested</option><option value="received">Feedback Received</option></select>
                    <input id="feedbackDateFromFilter" type="date" title="From date" onchange="App.filterFeedback()">
                    <input id="feedbackDateToFilter" type="date" title="To date" onchange="App.filterFeedback()">
                </div>
                <div class="ast-table-wrap"><table class="ast-table"><thead><tr><th>Date</th><th>Group</th><th>Trainee</th><th>Assessment</th><th>Review</th><th>Score</th><th>Feedback</th><th>Action</th></tr></thead><tbody>${rows.length ? rows.map(s => this.renderFeedbackRow(s)).join('') : '<tr><td colspan="8" class="ast-empty">No feedback sessions found.</td></tr>'}</tbody></table></div>
            </section>
        `;
    },

    renderFeedbackRow(s) {
        const date = String(s.submittedAt || s.generatedAt || '').slice(0, 10);
        return `
            <tr data-feedback-row data-search="${this.esc(`${s.trainee} ${s.assessment} ${s.groupID || ''} ${s.status}`.toLowerCase())}" data-assessment="${this.esc(s.assessment)}" data-group="${this.esc(s.groupID || '')}" data-review-status="${this.esc(s.status)}" data-status="${this.esc(s.feedbackStatus || 'none')}" data-date="${this.esc(date)}">
                <td>${this.esc(date || '-')}</td><td>${this.esc(s.groupID || '-')}</td><td>${this.esc(s.trainee)}</td><td>${this.esc(s.assessment)}</td><td><span class="ast-status ${this.esc(s.status)}">${this.esc(s.status)}</span></td><td>${this.esc(s.status === 'completed' ? `${s.percent}%` : 'Pending review')}</td>
                <td><span class="ast-status">${this.esc(s.feedbackStatus || 'none')}</span></td>
                <td>
                    <button class="ast-btn small" onclick="App.setFeedback('${this.esc(s.id)}', 'requested')">Requested</button>
                    <button class="ast-btn small primary" onclick="App.setFeedback('${this.esc(s.id)}', 'received')">Received</button>
                    <button class="ast-btn small ghost" onclick="App.setFeedback('${this.esc(s.id)}', 'none')">None</button>
                </td>
            </tr>
        `;
    },

    filterFeedback() {
        const term = this.normalize(document.getElementById('feedbackSearch')?.value || '');
        const assessment = document.getElementById('feedbackAssessmentFilter')?.value || '';
        const group = document.getElementById('feedbackGroupFilter')?.value || '';
        const reviewStatus = document.getElementById('feedbackReviewStatusFilter')?.value || '';
        const status = document.getElementById('feedbackStatusFilter')?.value || '';
        const dateFrom = document.getElementById('feedbackDateFromFilter')?.value || '';
        const dateTo = document.getElementById('feedbackDateToFilter')?.value || '';
        document.querySelectorAll('[data-feedback-row]').forEach(row => {
            const rowDate = row.dataset.date || '';
            const ok = (!term || String(row.dataset.search || '').includes(term)) &&
                (!assessment || row.dataset.assessment === assessment) &&
                (!group || (group === '__none__' ? !row.dataset.group : row.dataset.group === group)) &&
                (!reviewStatus || row.dataset.reviewStatus === reviewStatus) &&
                (!status || row.dataset.status === status) &&
                (!dateFrom || (rowDate && rowDate >= dateFrom)) &&
                (!dateTo || (rowDate && rowDate <= dateTo));
            row.style.display = ok ? '' : 'none';
        });
    },

    async setFeedback(id, status) {
        const sub = this.state().studio.submissions.find(s => s.id === id);
        if (!sub) return;
        sub.feedbackStatus = status || 'none';
        sub.updatedAt = new Date().toISOString();
        sub.updatedBy = AssessmentStudioData.editor();
        await AssessmentStudioData.saveStudio();
        this.notifyFeedbackStatus(sub);
        this.toast('Feedback status updated.', 'ok');
        this.render();
    },

    notifyFeedbackStatus(submission) {
        try {
            if (window.parent && typeof window.parent.postMessage === 'function') {
                window.parent.postMessage({
                    type: 'assessment-studio-feedback-status',
                    payload: {
                        submissionId: submission.id,
                        feedbackStatus: submission.feedbackStatus || 'none'
                    }
                }, '*');
            }
        } catch (error) {}
    },

    renderSearch() {
        return `
            <section class="ast-card">
                <div class="ast-card-head"><div><h2>Universal Search</h2><p>Search bucket questions, generators, Assessment Studio submissions, and legacy submissions.</p></div></div>
                <input id="universalSearchInput" class="ast-search-xl" type="search" placeholder="Search trainee, assessment, question, tag, status..." oninput="App.runUniversalSearch()">
                <div id="universalSearchResults" class="ast-search-results">${this.renderUniversalResults('')}</div>
            </section>
        `;
    },

    runUniversalSearch() {
        const target = document.getElementById('universalSearchResults');
        if (target) target.innerHTML = this.renderUniversalResults(document.getElementById('universalSearchInput')?.value || '');
    },

    renderUniversalResults(termRaw) {
        const term = this.normalize(termRaw);
        const results = [];
        this.state().studio.questionBucket.forEach(q => results.push({ type: 'Question', title: q.text, meta: `${q.assessment} | ${q.grouping || 'Ungrouped'} | ${this.typeLabel(q.type)} | ${q.points} pts`, hay: `${q.text} ${q.suggestedAnswer || ''} ${q.assessment} ${q.grouping || ''} ${q.type} ${(q.tags || []).join(' ')}` }));
        this.state().studio.generators.forEach(g => results.push({ type: 'Generator', title: g.assessment, meta: `${g.totalPoints} pts | ${g.allowedTypes.map(t => this.typeLabel(t)).join(', ')}`, hay: `${g.assessment} ${g.allowedTypes.join(' ')}` }));
        this.getCombinedSubmissions().forEach(s => results.push({ type: s.source === 'studio' ? 'Studio Submission' : 'Legacy Submission', title: `${s.trainee} - ${s.assessment}`, meta: `${s.status} | ${s.percent || 0}% | ${s.groupID || 'No group'}`, hay: `${s.trainee} ${s.assessment} ${s.status} ${s.groupID}` }));
        const filtered = results.filter(r => !term || this.normalize(r.hay).includes(term)).slice(0, 100);
        if (!filtered.length) return '<div class="ast-empty">No results found.</div>';
        return filtered.map(r => `<article class="ast-result"><span>${this.esc(r.type)}</span><strong>${this.esc(r.title)}</strong><small>${this.esc(r.meta)}</small></article>`).join('');
    }
};

window.App = App;
window.onload = () => App.init();

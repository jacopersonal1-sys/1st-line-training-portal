/* ================= CONTENT STUDIO ENGAGEMENT UI ================= */

const EngagementUI = {
    state: {
        selectedUser: '',
        selectedSubjectId: ''
    },

    formatDuration: function(seconds) {
        const total = Math.max(0, Math.round(Number(seconds || 0)));
        const mins = Math.floor(total / 60);
        const secs = total % 60;
        return `${mins}m ${secs.toString().padStart(2, '0')}s`;
    },

    formatDateTime: function(value) {
        if (!value) return '-';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '-';
        return d.toLocaleString();
    },

    formatScore: function(value) {
        const num = Number(value);
        return Number.isFinite(num) ? `${Math.round(num)}%` : '-';
    },

    setUser: function(username) {
        this.state.selectedUser = String(username || '');
        this.state.selectedSubjectId = '';
        App.render();
    },

    setSubject: function(subjectId) {
        this.state.selectedSubjectId = String(subjectId || '');
        App.render();
    },

    render: function() {
        const esc = App.escapeHtml;
        const entry = (typeof App.getActiveEntry === 'function') ? App.getActiveEntry() : DataService.getPrimaryEntry();
        if (!entry) {
            return `<div class="cs-empty"><h3>No content yet</h3><p>Build subjects first to start tracking engagement.</p></div>`;
        }

        const users = DataService.getEngagementUserBreakdown(entry.id);
        if (!users.length) {
            return `
                <div class="cs-empty">
                    <h3>No engagement data yet</h3>
                    <p>Engagement appears here once users start watching videos or taking linked quizzes.</p>
                </div>
            `;
        }

        if (!this.state.selectedUser || !users.some(u => u.username === this.state.selectedUser)) {
            this.state.selectedUser = users[0].username;
        }

        const selectedUser = this.state.selectedUser;
        const perSubject = DataService.getUserSubjectEngagement(entry.id, selectedUser);

        if (!this.state.selectedSubjectId || !perSubject.some(s => s.subjectId === this.state.selectedSubjectId)) {
            this.state.selectedSubjectId = perSubject.length ? perSubject[0].subjectId : '';
        }

        const selectedSubject = perSubject.find(s => s.subjectId === this.state.selectedSubjectId) || null;
        const failedQuestionRows = (selectedSubject && Array.isArray(selectedSubject.failedQuestions))
            ? selectedSubject.failedQuestions.map((item, idx) => `
                <tr>
                    <td>${idx + 1}</td>
                    <td>${esc(item.questionIndex ? `Q${item.questionIndex}` : (item.questionId || '-'))}</td>
                    <td>${esc(item.text || '-')}</td>
                    <td>${esc(item.reviewSubject || '-')}</td>
                    <td>${Number(item.failCount || 0)}</td>
                </tr>
            `).join('')
            : '';

        const userRows = users.map((u, idx) => `
            <tr class="${selectedUser === u.username ? 'cs-engagement-selected-row' : ''}">
                <td>${idx + 1}</td>
                <td><button class="btn-secondary btn-sm" onclick="EngagementUI.setUser('${esc(u.username)}')">${esc(u.username)}</button></td>
                <td>${u.subjectCount}</td>
                <td>${u.plays}</td>
                <td>${this.formatDuration(u.watchSeconds)}</td>
                <td>${u.skips}</td>
                <td>${u.annotations || 0}</td>
                <td>${u.quizAttempts || 0}</td>
                <td>${this.formatScore(u.quizBestScore)}</td>
                <td>${this.formatDateTime(u.quizLastAttemptAt)}</td>
                <td>${u.quizFailedQuestions || 0}</td>
                <td>${this.formatDateTime(u.lastPlayedAt)}</td>
            </tr>
        `).join('');

        const subjectRows = perSubject.map((s, idx) => `
            <tr class="${this.state.selectedSubjectId === s.subjectId ? 'cs-engagement-selected-row' : ''}">
                <td>${idx + 1}</td>
                <td>${esc(s.code || '-')}</td>
                <td>
                    <button class="btn-secondary btn-sm" onclick="EngagementUI.setSubject('${esc(s.subjectId)}')">${esc(s.title || '-')}</button>
                </td>
                <td>${s.plays}</td>
                <td>${this.formatDuration(s.watchSeconds)}</td>
                <td>${s.skips}</td>
                <td>${s.annotations || 0}</td>
                <td>${s.quizAttempts || 0}</td>
                <td>${this.formatScore(s.quizBestScore)}</td>
                <td>${this.formatScore(s.quizLastScore)}</td>
                <td>${s.failedQuestionCount || 0}</td>
                <td>${this.formatDuration(s.lastPosition || 0)}</td>
                <td>${this.formatDateTime(s.lastPlayedAt)}</td>
            </tr>
        `).join('');

        return `
            <div class="cs-shell">
                <div class="cs-toolbar">
                    <div class="cs-field">
                        <label>Selected User</label>
                        <select onchange="EngagementUI.setUser(this.value)">
                            ${users.map(u => `<option value="${esc(u.username)}" ${u.username === selectedUser ? 'selected' : ''}>${esc(u.username)}</option>`).join('')}
                        </select>
                    </div>
                </div>

                <div class="cs-engagement-grid">
                    <div class="cs-builder-card">
                        <h3>Watchers Breakdown (Per User)</h3>
                        <p class="cs-muted">Tracks video engagement plus linked-quiz attempts and remediation performance.</p>
                        <div class="cs-table-wrap">
                            <table class="admin-table">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>User</th>
                                        <th>Subjects</th>
                                        <th>Plays</th>
                                        <th>Watch Time</th>
                                        <th>Skips</th>
                                        <th>Notes/Q</th>
                                        <th>Quiz Attempts</th>
                                        <th>Quiz Best</th>
                                        <th>Last Quiz</th>
                                        <th>Failed Q Total</th>
                                        <th>Last Activity</th>
                                    </tr>
                                </thead>
                                <tbody>${userRows}</tbody>
                            </table>
                        </div>
                    </div>

                    <div class="cs-builder-card">
                        <h3>User Detail: ${esc(selectedUser)}</h3>
                        <p class="cs-muted">Per-subject watch data and quiz progression.</p>
                        <div class="cs-table-wrap">
                            <table class="admin-table">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Code</th>
                                        <th>Subject</th>
                                        <th>Plays</th>
                                        <th>Watch Time</th>
                                        <th>Skips</th>
                                        <th>Notes/Q</th>
                                        <th>Quiz Attempts</th>
                                        <th>Quiz Best</th>
                                        <th>Quiz Last</th>
                                        <th>Failed Q Total</th>
                                        <th>Last Position</th>
                                        <th>Last Played</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${subjectRows || '<tr><td colspan="13" style="text-align:center; color:var(--cs-muted);">No subject activity for this user yet.</td></tr>'}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div class="cs-builder-card" style="grid-column:1 / -1;">
                        <h3>Failed Questions: ${esc(selectedSubject ? (selectedSubject.code || selectedSubject.title || 'Subject') : 'No Subject Selected')}</h3>
                        <p class="cs-muted">How many times this user has failed each quiz question for the selected subject.</p>
                        <div class="cs-table-wrap">
                            <table class="admin-table">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Question</th>
                                        <th>Text</th>
                                        <th>Review Subject</th>
                                        <th>Fail Count</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${failedQuestionRows || '<tr><td colspan="5" style="text-align:center; color:var(--cs-muted);">No failed quiz questions recorded for this subject yet.</td></tr>'}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
};

window.EngagementUI = EngagementUI;
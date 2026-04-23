/* ================= INSIGHT MODULE UI ================= */

const InsightApp = {
    state: {
        loading: true,
        viewMode: 'triggers',
        groupFilter: 'all',
        search: '',
        selectedAgent: '',
        detail: null,
        progressDetail: null,
        drawerMode: 'triggers',
        drawerOpen: false
    },

    init: async function() {
        const root = document.getElementById('insight-app');
        if (!root) return;

        root.innerHTML = `
            <div class="card" style="text-align:center; padding:46px;">
                <i class="fas fa-circle-notch fa-spin fa-2x"></i>
                <p style="margin-top:14px;">Loading Insight...</p>
            </div>
        `;

        try {
            const cached = InsightDataService.loadCache();
            if (cached && typeof cached === 'object') {
                InsightDataService.state = {
                    ...InsightDataService.state,
                    ...cached
                };
                this.state.loading = false;
                this.render();
            }

            const loadPromise = InsightDataService.loadInitialData();

            const bootGuard = new Promise((resolve) => setTimeout(resolve, 8000));
            await Promise.race([loadPromise, bootGuard]);

            this.state.loading = false;
            this.render();

            Promise.resolve(loadPromise)
                .then(() => {
                    this.state.loading = false;
                    if (this.state.drawerOpen && this.state.selectedAgent) {
                        this.state.detail = InsightDataService.getAgentDetail(this.state.selectedAgent);
                    }
                    this.render();
                })
                .catch((error) => {
                    console.warn('[Insight] Background hydration failed:', error);
                });
        } catch (error) {
            console.warn('[Insight] Init failed:', error);
            this.state.loading = false;
            this.render();
        }
    },

    canAccess: function() {
        const role = AppContext && AppContext.user ? String(AppContext.user.role || '').toLowerCase() : '';
        return role === 'admin' || role === 'super_admin';
    },

    escapeHtml: function(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    statusClass: function(status) {
        const normalized = String(status || '').toLowerCase();
        if (normalized === 'critical') return 'critical';
        if (normalized === 'semi-critical' || normalized === 'semi') return 'semi';
        if (normalized === 'improvement') return 'improvement';
        if (normalized === 'pass') return 'pass';
        return 'pending';
    },

    formatDuration: function(seconds) {
        const total = Math.max(0, Math.round(Number(seconds || 0)));
        const mins = Math.floor(total / 60);
        const secs = total % 60;
        return `${mins}m ${secs.toString().padStart(2, '0')}s`;
    },

    formatDurationCompact: function(seconds) {
        const total = Math.max(0, Math.round(Number(seconds || 0)));
        const hrs = Math.floor(total / 3600);
        const mins = Math.floor((total % 3600) / 60);
        if (hrs > 0) return `${hrs}h ${mins}m`;
        return `${mins}m`;
    },

    hashColor: function(name) {
        const seed = String(name || 'insight');
        let hash = 0;
        for (let i = 0; i < seed.length; i += 1) {
            hash = seed.charCodeAt(i) + ((hash << 5) - hash);
        }
        const color = (hash & 0x00ffffff).toString(16).toUpperCase();
        return `#${'000000'.substring(0, 6 - color.length)}${color}`;
    },

    setGroupFilter: function(value) {
        this.state.groupFilter = String(value || 'all');
        this.render();
    },

    setSearch: function(value) {
        this.state.search = String(value || '');
        this.render();
    },

    setViewMode: function(mode) {
        const normalized = String(mode || '').trim().toLowerCase();
        if (normalized === 'progress') this.state.viewMode = 'progress';
        else if (normalized === 'department' || normalized === 'dept') this.state.viewMode = 'department';
        else this.state.viewMode = 'triggers';
        this.state.drawerOpen = false;
        this.state.selectedAgent = '';
        this.state.detail = null;
        this.state.progressDetail = null;
        this.state.drawerMode = this.state.viewMode;
        this.render();
    },

    isTraineeRole: function(role) {
        const normalized = String(role || '').trim().toLowerCase();
        if (!normalized) return true;
        return normalized === 'trainee';
    },

    isActionRequiredStatus: function(status) {
        const normalized = String(status || '').trim().toLowerCase();
        return normalized === 'critical' || normalized === 'improvement';
    },

    getFilteredAgents: function() {
        const filterGroup = String(this.state.groupFilter || 'all');
        const search = String(this.state.search || '').trim().toLowerCase();
        const rows = [];

        InsightDataService.getAllAgents().forEach((agent) => {
            if (!this.isTraineeRole(agent.role)) return;
            if (filterGroup !== 'all' && String(agent.group || '') !== filterGroup) return;
            if (search && !String(agent.name || '').toLowerCase().includes(search)) return;
            const summary = this.getRowSummary(agent.name);
            if (!this.isActionRequiredStatus(summary.status.status)) return;
            rows.push({ agent, summary });
        });

        return rows.sort((a, b) => String(a.agent.name || '').localeCompare(String(b.agent.name || ''), undefined, { sensitivity: 'base' }));
    },

    getProgressAgents: function() {
        const filterGroup = String(this.state.groupFilter || 'all');
        const search = String(this.state.search || '').trim().toLowerCase();
        const rows = [];

        InsightDataService.getAllAgents().forEach((agent) => {
            if (!this.isTraineeRole(agent.role)) return;
            if (filterGroup !== 'all' && String(agent.group || '') !== filterGroup) return;
            if (search && !String(agent.name || '').toLowerCase().includes(search)) return;
            const progress = InsightDataService.getAgentProgress(agent.name, agent.group || '');
            rows.push({ agent, progress });
        });

        return rows.sort((a, b) => String(a.agent.name || '').localeCompare(String(b.agent.name || ''), undefined, { sensitivity: 'base' }));
    },

    getRowSummary: function(agentName) {
        const records = InsightDataService.getAgentRecords(agentName);
        const status = InsightDataService.getAgentStatus(agentName);
        const attendance = InsightDataService.getAgentAttendance(agentName);
        const activity = InsightDataService.getAgentActivityBreakdown(agentName);
        const engagement = InsightDataService.getAgentContentEngagement(agentName);

        const avgScore = records.length
            ? Math.round(records.reduce((sum, row) => sum + Number(row.score || 0), 0) / records.length)
            : 0;

        const lateCount = attendance.filter(row => row.isLate).length;

        return {
            status,
            avgScore,
            lateCount,
            violationCount: activity.violationCount,
            quizAttempts: engagement.totals.totalQuizAttempts
        };
    },

    openAgent: function(agentName, mode) {
        this.state.selectedAgent = String(agentName || '');
        this.state.drawerMode = String(mode || this.state.viewMode || 'triggers');
        this.state.detail = InsightDataService.getAgentDetail(this.state.selectedAgent);
        this.state.progressDetail = InsightDataService.getAgentProgress(
            this.state.selectedAgent,
            InsightDataService.getAgentGroup(this.state.selectedAgent)
        );
        this.state.drawerOpen = true;
        this.render();
    },

    openAgentByToken: function(encodedName, mode) {
        const decoded = decodeURIComponent(String(encodedName || ''));
        this.openAgent(decoded, mode || 'triggers');
    },

    openProgressAgentByToken: function(encodedName) {
        this.openAgentByToken(encodedName, 'progress');
    },

    closeAgent: function() {
        this.state.drawerOpen = false;
        this.state.selectedAgent = '';
        this.state.detail = null;
        this.state.progressDetail = null;
        this.render();
    },

    refresh: async function() {
        this.state.loading = true;
        this.render();
        await InsightDataService.refresh();
        this.state.loading = false;
        if (this.state.drawerOpen && this.state.selectedAgent) {
            this.state.detail = InsightDataService.getAgentDetail(this.state.selectedAgent);
            this.state.progressDetail = InsightDataService.getAgentProgress(
                this.state.selectedAgent,
                InsightDataService.getAgentGroup(this.state.selectedAgent)
            );
        }
        this.render();
    },

    getReviewDecisionLabel: function(value) {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'pass') return 'Pass';
        if (normalized === 'complete_fail') return 'Complete Fail';
        return 'Improve';
    },

    makeSafeId: function(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 48);
    },

    normalizeLookup: function(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[._-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    },

    failedSubjectCore: function(label) {
        const raw = String(label || '').trim();
        const match = raw.match(/^(.*) \((\d+(?:\.\d+)?)%\)$/);
        if (match && match[1]) return String(match[1]).trim();
        return raw;
    },

    saveFailedSubjectReview: async function(encodedSubject, inputKey) {
        if (!this.state.selectedAgent || !this.state.detail) return;
        const subjectLabel = decodeURIComponent(String(encodedSubject || ''));
        const selectEl = document.getElementById(`ins-subj-decision-${inputKey}`);
        const noteEl = document.getElementById(`ins-subj-note-${inputKey}`);
        if (!selectEl || !noteEl) return;

        const decision = String(selectEl.value || '').trim().toLowerCase();
        const note = String(noteEl.value || '').trim();
        const subjectCore = this.failedSubjectCore(subjectLabel);

        const result = await InsightDataService.saveSubjectReview(this.state.selectedAgent, subjectCore, decision, note);
        if (!result.ok) {
            alert(result.message || 'Failed to save subject review.');
            return;
        }

        this.state.detail = InsightDataService.getAgentDetail(this.state.selectedAgent);
        this.render();
    },

    toggleProgressItemExemption: async function(encodedAgent, encodedGroup, encodedItem, shouldExempt) {
        const agent = decodeURIComponent(String(encodedAgent || ''));
        const group = decodeURIComponent(String(encodedGroup || ''));
        const item = decodeURIComponent(String(encodedItem || ''));
        const result = await InsightDataService.toggleProgressExemption(agent, group, item, !!shouldExempt);
        if (!result.ok) {
            alert(result.message || 'Unable to update this N/A flag.');
            return;
        }
        if (this.state.selectedAgent && this.normalizeLookup(this.state.selectedAgent) === this.normalizeLookup(agent)) {
            this.state.progressDetail = InsightDataService.getAgentProgress(agent, group);
        }
        this.render();
    },

    sendHostAction: function(channel, payload) {
        const safePayload = payload && typeof payload === 'object' ? payload : {};
        try {
            const { ipcRenderer } = require('electron');
            if (ipcRenderer && typeof ipcRenderer.sendToHost === 'function') {
                ipcRenderer.sendToHost(channel, safePayload);
                return true;
            }
        } catch (error) {}
        if (window.parent && typeof window.parent.postMessage === 'function') {
            window.parent.postMessage({ type: channel, payload: safePayload }, '*');
            return true;
        }
        return false;
    },

    requestGraduateFromProgress: function(encodedAgent) {
        const agent = decodeURIComponent(String(encodedAgent || ''));
        if (!agent) return;
        const group = InsightDataService.getAgentGroup(agent);
        const progress = InsightDataService.getAgentProgress(agent, group);
        const loginActive = InsightDataService.isAgentLoginActive(agent);
        if (progress.progress < 100) {
            alert('Graduate is only available when progress is 100%.');
            return;
        }
        if (!loginActive) {
            alert('This agent is already blocked or graduated.');
            return;
        }
        const sent = this.sendHostAction('insight-studio-graduate-agent', { username: agent });
        if (!sent) alert('Graduate action bridge is unavailable in this runtime.');
        if (sent) setTimeout(() => { this.refresh(); }, 900);
    },

    requestMigrateFromProgress: function(encodedAgent) {
        const agent = decodeURIComponent(String(encodedAgent || ''));
        if (!agent) return;
        const sent = this.sendHostAction('insight-studio-migrate-agent', { username: agent });
        if (!sent) alert('Migrate action bridge is unavailable in this runtime.');
        if (sent) setTimeout(() => { this.refresh(); }, 900);
    },

    editLateEntry: async function(rowId) {
        if (!this.state.selectedAgent || !this.state.detail) return;
        const rows = this.state.detail.attendance || [];
        const target = rows.find(row => String(row._rowId || '') === String(rowId || ''));
        if (!target) return;

        const currentReason = target.lateData && target.lateData.reason ? target.lateData.reason : '';
        const currentComment = target.adminComment || '';

        const reason = prompt('Update late-coming reason:', currentReason);
        if (reason === null) return;

        const adminComment = prompt('Update admin comment:', currentComment);
        if (adminComment === null) return;

        const markConfirmed = confirm('Mark this late-coming as confirmed? Click Cancel to keep/unset confirmation.');

        const result = await InsightDataService.updateLateAttendance(target._rowId, {
            reason,
            adminComment,
            lateConfirmed: markConfirmed,
            isLate: true
        });

        if (!result.ok) {
            alert(result.message || 'Unable to update this late-coming record.');
            return;
        }

        this.state.detail = InsightDataService.getAgentDetail(this.state.selectedAgent);
        this.render();
    },

    renderProgressDrawer: function() {
        if (!this.state.drawerOpen || !this.state.selectedAgent) return '';
        const esc = this.escapeHtml;
        const agentName = this.state.selectedAgent;
        const group = InsightDataService.getAgentGroup(agentName);
        const progress = this.state.progressDetail || InsightDataService.getAgentProgress(agentName, group);
        const loginActive = InsightDataService.isAgentLoginActive(agentName);
        const canGraduate = progress.progress >= 100 && loginActive;

        return `
            <div class="ins-drawer">
                <div class="ins-drawer-inner" style="max-width:1100px;">
                    <div class="ins-drawer-head">
                        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                            <div class="ins-avatar" style="background:${this.hashColor(agentName)}; width:40px; height:40px; font-size:0.95rem;">${esc(agentName.slice(0, 2).toUpperCase())}</div>
                            <div>
                                <h2 style="margin:0; font-size:1.05rem;">${esc(agentName)}</h2>
                                <div class="ins-subtle">${esc(group || 'Ungrouped')} | Progress ${progress.progress}%</div>
                            </div>
                        </div>
                        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                            <span class="ins-badge">${progress.completedCount}/${progress.totalRequired} completed</span>
                            <button class="btn-secondary btn-sm" onclick="InsightApp.closeAgent()"><i class="fas fa-times"></i> Close</button>
                        </div>
                    </div>
                    <div class="ins-drawer-body" style="grid-template-columns:1fr;">
                        <div class="ins-card full">
                            <h3>Agent Progress Checklist</h3>
                            <div class="ins-progress-track">
                                <div class="ins-progress-fill" style="width:${progress.progress}%;"></div>
                            </div>
                            <div class="ins-subtle" style="margin-top:7px;">Mark N/A where valid. Checklist items come from Admin Tools -> Insight Triggers -> Agent Progress Builder.</div>
                            <div class="ins-list" style="margin-top:10px; max-height:420px;">
                                ${(progress.items || []).map((item) => {
                                    const itemStatus = String(item.status || 'missing');
                                    const statusClass = itemStatus === 'completed' ? 'pass' : (itemStatus === 'exempt' ? 'semi' : 'critical');
                                    const toggleToExempt = itemStatus !== 'exempt';
                                    const actionLabel = toggleToExempt ? 'Mark N/A' : 'Unmark N/A';
                                    return `
                                        <div class="ins-item">
                                            <div class="ins-item-top">
                                                <strong>${esc(item.name)}</strong>
                                                <span class="ins-status ${statusClass}">${esc(itemStatus === 'exempt' ? 'N/A' : itemStatus)}</span>
                                            </div>
                                            <div class="ins-subtle" style="margin-top:6px;">Type: ${esc(item.type || 'assessment')} | Source: ${esc(item.source || 'manual')}</div>
                                            <div style="margin-top:8px;">
                                                <button class="btn-secondary btn-sm" onclick="InsightApp.toggleProgressItemExemption('${encodeURIComponent(agentName)}','${encodeURIComponent(group || '')}','${encodeURIComponent(item.name)}', ${toggleToExempt ? 'true' : 'false'})">${actionLabel}</button>
                                            </div>
                                        </div>
                                    `;
                                }).join('') || '<div class="ins-item">No progress items configured yet.</div>'}
                            </div>
                        </div>
                        <div class="ins-card full">
                            <h3>Actions</h3>
                            <p class="ins-subtle" style="margin-bottom:10px;">Graduate stays locked until all checklist items are complete or N/A.</p>
                            <div style="display:flex; gap:10px; flex-wrap:wrap;">
                                <button class="btn-success btn-sm" ${canGraduate ? '' : 'disabled'} onclick="InsightApp.requestGraduateFromProgress('${encodeURIComponent(agentName)}')">
                                    <i class="fas fa-graduation-cap"></i> ${loginActive ? 'Graduate Trainee' : 'Graduated / Login Blocked'}
                                </button>
                                <button class="btn-warning btn-sm" onclick="InsightApp.requestMigrateFromProgress('${encodeURIComponent(agentName)}')">
                                    <i class="fas fa-exchange-alt"></i> Migrate Agent
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    renderDetailDrawer: function() {
        if (!this.state.drawerOpen || !this.state.detail || !this.state.selectedAgent) return '';
        if (this.state.drawerMode === 'progress') return this.renderProgressDrawer();

        const esc = this.escapeHtml;
        const detail = this.state.detail;
        const statusClass = this.statusClass(detail.status.status);
        const lateRows = (detail.attendance || []).filter(row => row.isLate);
        const feedbackRows = detail.feedback || [];
        const engagementSubjects = detail.engagement && Array.isArray(detail.engagement.subjects) ? detail.engagement.subjects : [];
        const timelineRows = Array.isArray(detail.timeline) ? detail.timeline.slice(0, 120) : [];
        const badges = detail.profile && Array.isArray(detail.profile.badges) ? detail.profile.badges : [];
        const thresholdLabel = detail.status && detail.status.thresholdLabel
            ? String(detail.status.thresholdLabel)
            : `${(detail.status && Number.isFinite(Number(detail.status.scoreThreshold))) ? detail.status.scoreThreshold : 60}%`;
        const failedItems = Array.isArray(detail.status.failedItems) ? detail.status.failedItems : [];
        const subjectReviewMap = detail.subjectReviewMap && typeof detail.subjectReviewMap === 'object' ? detail.subjectReviewMap : {};

        return `
            <div class="ins-drawer">
                <div class="ins-drawer-inner">
                    <div class="ins-drawer-head">
                        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                            <div class="ins-avatar" style="background:${this.hashColor(this.state.selectedAgent)}; width:40px; height:40px; font-size:0.95rem;">${esc(this.state.selectedAgent.slice(0, 2).toUpperCase())}</div>
                            <div>
                                <h2 style="margin:0; font-size:1.05rem;">${esc(this.state.selectedAgent)}</h2>
                                <div class="ins-subtle">${esc(detail.group || 'Ungrouped')} | Threshold: ${esc(thresholdLabel)}</div>
                            </div>
                            <span class="ins-status ${statusClass}">${esc(detail.status.status)}</span>
                        </div>
                        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                            <div class="ins-badges">
                                ${badges.length ? badges.map(badge => `<span class="ins-badge">${esc(badge)}</span>`).join('') : '<span class="ins-badge">No badges</span>'}
                            </div>
                            <button class="btn-secondary btn-sm" onclick="InsightApp.closeAgent()"><i class="fas fa-times"></i> Close</button>
                        </div>
                    </div>
                    <div class="ins-drawer-body">
                        <div class="ins-card">
                            <h3>Attendance (Late Comings)</h3>
                            <p class="ins-subtle" style="margin-bottom:8px;">Editable late-coming records with latest synced attendance data.</p>
                            <div class="ins-list">
                                ${lateRows.length ? lateRows.map(row => `
                                    <div class="ins-item">
                                        <div class="ins-item-top">
                                            <strong>${esc(row.date)}</strong>
                                            <span class="ins-subtle">${esc(row.clockIn || '-')}</span>
                                        </div>
                                        <div class="ins-subtle" style="margin-top:6px;">Reason: ${esc((row.lateData && row.lateData.reason) || 'No reason captured')}</div>
                                        <div class="ins-subtle">Admin: ${esc(row.adminComment || 'No admin comment')}</div>
                                        <div style="margin-top:7px; display:flex; gap:7px; align-items:center;">
                                            <span class="ins-badge">${row.lateConfirmed ? 'Confirmed' : 'Unconfirmed'}</span>
                                            <button class="btn-secondary btn-sm" onclick="InsightApp.editLateEntry('${esc(row._rowId)}')"><i class="fas fa-pen"></i> Edit</button>
                                        </div>
                                    </div>
                                `).join('') : '<div class="ins-item">No late-coming entries found for this agent.</div>'}
                            </div>
                        </div>

                        <div class="ins-card">
                            <h3>Activity Breakdown</h3>
                            <div class="ins-mini-grid" style="margin-top:8px;">
                                <div class="ins-mini"><strong>${detail.activity.violationCount}</strong><span class="ins-subtle">Violations</span></div>
                                <div class="ins-mini"><strong>${detail.activity.idleMinutes}m</strong><span class="ins-subtle">Idle Time</span></div>
                                <div class="ins-mini"><strong>${detail.activity.externalMinutes}m</strong><span class="ins-subtle">External Time</span></div>
                                <div class="ins-mini"><strong>${detail.activity.focusScore}%</strong><span class="ins-subtle">Focus Score</span></div>
                            </div>
                            <div class="ins-list" style="margin-top:10px; max-height:220px;">
                                ${(detail.activity.history || []).slice(0, 20).map(item => `
                                    <div class="ins-item">
                                        <div class="ins-item-top"><strong>${esc(item.date)}</strong><span class="ins-subtle">${Math.round(Number((item.summary || {}).idle || 0) / 60000)}m idle</span></div>
                                        <div class="ins-subtle">Study ${Math.round(Number((item.summary || {}).study || 0) / 60000)}m | External ${Math.round(Number((item.summary || {}).external || 0) / 60000)}m</div>
                                    </div>
                                `).join('') || '<div class="ins-item">No monitor history captured yet.</div>'}
                            </div>
                        </div>

                        <div class="ins-card full">
                            <h3>Content Creator Engagement</h3>
                            <div class="ins-mini-grid" style="margin-top:8px; margin-bottom:8px; grid-template-columns:repeat(4, minmax(0, 1fr));">
                                <div class="ins-mini"><strong>${detail.engagement.totals.subjectCount}</strong><span class="ins-subtle">Subjects</span></div>
                                <div class="ins-mini"><strong>${this.formatDuration(detail.engagement.totals.totalWatchSeconds)}</strong><span class="ins-subtle">Watch Time</span></div>
                                <div class="ins-mini"><strong>${detail.engagement.totals.totalQuizAttempts}</strong><span class="ins-subtle">Quiz Attempts</span></div>
                                <div class="ins-mini"><strong>${detail.engagement.totals.failedQuestions}</strong><span class="ins-subtle">Failed Questions</span></div>
                            </div>
                            <div class="table-responsive" style="max-height:230px; overflow-y:auto;">
                                <table class="ins-table">
                                    <thead>
                                        <tr>
                                            <th>Subject</th>
                                            <th>Watch</th>
                                            <th>Plays</th>
                                            <th>Quiz Attempts</th>
                                            <th>Best</th>
                                            <th>Failed Q</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${engagementSubjects.length ? engagementSubjects.map(subject => `
                                            <tr>
                                                <td>${esc(subject.code || '-')} ${esc(subject.title || '-')}</td>
                                                <td>${this.formatDuration(subject.watchSeconds)}</td>
                                                <td>${subject.plays}</td>
                                                <td>${subject.quizAttempts}</td>
                                                <td>${subject.quizBestScore === null ? '-' : `${Math.round(subject.quizBestScore)}%`}</td>
                                                <td>${subject.failedQuestions}</td>
                                            </tr>
                                        `).join('') : '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No engagement captured yet.</td></tr>'}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div class="ins-card full">
                            <h3>Action Required Subjects</h3>
                            <div class="ins-list" style="max-height:260px;">
                                ${failedItems.length
                                    ? failedItems.map(item => {
                                        const subjectCore = this.failedSubjectCore(item);
                                        const mapKey = this.normalizeLookup(subjectCore);
                                        const existing = subjectReviewMap[mapKey] || {};
                                        const safeId = this.makeSafeId(`${subjectCore}-${mapKey}`);
                                        const selectedDecision = String(existing.decision || 'improve').toLowerCase();
                                        return `
                                            <div class="ins-item">
                                                <div class="ins-item-top">
                                                    <strong>${esc(item)}</strong>
                                                    <span class="ins-subtle">${existing.updatedAt ? `Reviewed: ${esc(new Date(existing.updatedAt).toLocaleString())}` : 'Not yet reviewed'}</span>
                                                </div>
                                                <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:8px;">
                                                    <select id="ins-subj-decision-${safeId}" style="margin:0; min-width:160px;">
                                                        <option value="improve" ${selectedDecision === 'improve' ? 'selected' : ''}>Improve</option>
                                                        <option value="pass" ${selectedDecision === 'pass' ? 'selected' : ''}>Pass</option>
                                                        <option value="complete_fail" ${selectedDecision === 'complete_fail' ? 'selected' : ''}>Complete Fail</option>
                                                    </select>
                                                    <input id="ins-subj-note-${safeId}" type="text" value="${esc(existing.note || '')}" placeholder="Review note..." style="margin:0; flex:1; min-width:220px;">
                                                    <button class="btn-primary btn-sm" onclick="InsightApp.saveFailedSubjectReview('${encodeURIComponent(item)}', '${safeId}')">Save</button>
                                                </div>
                                                <div class="ins-subtle" style="margin-top:6px;">Decision: ${esc(this.getReviewDecisionLabel(selectedDecision))}${existing.updatedBy ? ` by ${esc(existing.updatedBy)}` : ''}</div>
                                            </div>
                                        `;
                                    }).join('')
                                    : '<div class="ins-item">No failed subjects under current trigger presets.</div>'}
                            </div>
                        </div>

                        <div class="ins-card">
                            <h3>Teamleader Production Feedback</h3>
                            <div class="ins-list">
                                ${feedbackRows.length ? feedbackRows.map(item => `
                                    <div class="ins-item">
                                        <div class="ins-item-top">
                                            <strong>${esc(item.date || item.createdAt || '-')}</strong>
                                            <span class="ins-subtle">${esc(item.tl || 'TL')}</span>
                                        </div>
                                        <div class="ins-subtle" style="margin-top:6px;">${esc(item.selectedMedium || 'N/A')} | ${esc(item.problemStatement || 'N/A')}</div>
                                        <div class="ins-subtle">Ticket: ${esc(item.ticketNumber || '-')}</div>
                                    </div>
                                `).join('') : '<div class="ins-item">No Teamleader production feedback submissions found.</div>'}
                            </div>
                        </div>

                        <div class="ins-card full">
                            <h3>Activity Timeline</h3>
                            <p class="ins-subtle" style="margin-bottom:8px;">Unified training timeline (attendance, assessments, quizzes, feedback, and activity summaries).</p>
                            <div class="ins-timeline">
                                ${timelineRows.length ? timelineRows.map(event => `
                                    <div class="ins-timeline-item">
                                        <div class="ins-timeline-dot"></div>
                                        <div class="ins-timeline-content">
                                            <div class="ins-item-top">
                                                <strong>${esc(event.type)}</strong>
                                                <span class="ins-subtle">${esc(event.date || '-')}</span>
                                            </div>
                                            <div class="ins-subtle" style="margin-top:6px;">${esc(event.detail || '-')}</div>
                                        </div>
                                    </div>
                                `).join('') : '<div class="ins-item">No timeline events found for this agent.</div>'}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    renderDepartmentOverview: function() {
        const esc = this.escapeHtml;
        const summary = InsightDataService.getDepartmentOverview(this.state.groupFilter, this.state.search);
        const kpis = summary.kpis || {};
        const effortRows = Array.isArray(summary.effortRows) ? summary.effortRows : [];
        const struggleAreas = Array.isArray(summary.struggleAreas) ? summary.struggleAreas : [];
        const lateRows = Array.isArray(summary.lateRows) ? summary.lateRows : [];
        const activityRows = Array.isArray(summary.activityRows) ? summary.activityRows : [];
        const engagementRows = Array.isArray(summary.engagementRows) ? summary.engagementRows : [];
        const failedSubjectRows = Array.isArray(summary.failedSubjectRows) ? summary.failedSubjectRows : [];
        const feedbackMediumRows = Array.isArray(summary.feedbackMediumRows) ? summary.feedbackMediumRows : [];
        const feedbackRecent = Array.isArray(summary.feedbackRecent) ? summary.feedbackRecent : [];
        const timelineRows = Array.isArray(summary.timelineRows) ? summary.timelineRows : [];

        return `
            <div class="ins-dept-grid">
                <div class="ins-card full">
                    <h3>Department Health Snapshot</h3>
                    <div class="ins-mini-grid ins-dept-kpi-grid" style="margin-top:8px;">
                        <div class="ins-mini"><strong>${kpis.criticalCount || 0}</strong><span class="ins-subtle">Critical</span></div>
                        <div class="ins-mini"><strong>${kpis.improvementCount || 0}</strong><span class="ins-subtle">Improvement</span></div>
                        <div class="ins-mini"><strong>${kpis.semiCount || 0}</strong><span class="ins-subtle">Semi-Critical</span></div>
                        <div class="ins-mini"><strong>${kpis.passCount || 0}</strong><span class="ins-subtle">Pass</span></div>
                        <div class="ins-mini"><strong>${kpis.pendingCount || 0}</strong><span class="ins-subtle">Pending</span></div>
                        <div class="ins-mini"><strong>${kpis.actionRequiredCount || 0}</strong><span class="ins-subtle">Action Required</span></div>
                        <div class="ins-mini"><strong>${kpis.avgScore || 0}%</strong><span class="ins-subtle">Avg Score</span></div>
                        <div class="ins-mini"><strong>${kpis.avgFocus || 0}%</strong><span class="ins-subtle">Avg Focus</span></div>
                    </div>
                </div>

                <div class="ins-card full">
                    <h3>Operational Metrics</h3>
                    <div class="ins-mini-grid ins-dept-kpi-grid" style="margin-top:8px;">
                        <div class="ins-mini"><strong>${kpis.totalLateCount || 0}</strong><span class="ins-subtle">Late Comings</span></div>
                        <div class="ins-mini"><strong>${kpis.totalConfirmedLateCount || 0}</strong><span class="ins-subtle">Late Confirmed</span></div>
                        <div class="ins-mini"><strong>${kpis.totalViolationCount || 0}</strong><span class="ins-subtle">Violations</span></div>
                        <div class="ins-mini"><strong>${kpis.totalIdleMinutes || 0}m</strong><span class="ins-subtle">Idle Time</span></div>
                        <div class="ins-mini"><strong>${this.formatDurationCompact(kpis.totalWatchSeconds || 0)}</strong><span class="ins-subtle">Watch Time</span></div>
                        <div class="ins-mini"><strong>${kpis.totalQuizAttempts || 0}</strong><span class="ins-subtle">Quiz Attempts</span></div>
                        <div class="ins-mini"><strong>${kpis.totalFailedQuestions || 0}</strong><span class="ins-subtle">Failed Questions</span></div>
                        <div class="ins-mini"><strong>${kpis.totalFeedback || 0}</strong><span class="ins-subtle">TL Feedback</span></div>
                        <div class="ins-mini"><strong>${kpis.reviewedFailedSubjects || 0}/${kpis.totalFailedSubjects || 0}</strong><span class="ins-subtle">Failed Subject Reviews</span></div>
                        <div class="ins-mini"><strong>${kpis.reviewCoverage || 0}%</strong><span class="ins-subtle">Review Coverage</span></div>
                        <div class="ins-mini"><strong>${summary.scope && summary.scope.agentCount ? summary.scope.agentCount : 0}</strong><span class="ins-subtle">Agents In Scope</span></div>
                        <div class="ins-mini"><strong>${kpis.timelineEventCount || 0}</strong><span class="ins-subtle">Timeline Events</span></div>
                    </div>
                </div>

                <div class="ins-card">
                    <h3>Effort vs Performance</h3>
                    <div class="table-responsive" style="max-height:270px; overflow-y:auto;">
                        <table class="ins-table ins-table-compact">
                            <thead><tr><th>Agent</th><th>Focus</th><th>Avg Score</th><th>Status</th></tr></thead>
                            <tbody>
                                ${effortRows.length
                                    ? effortRows.map((row) => `
                                        <tr>
                                            <td>${esc(row.agent)}</td>
                                            <td class="ins-metric">${row.focusScore}%</td>
                                            <td class="ins-metric">${row.avgScore}%</td>
                                            <td><span class="ins-status ${esc(row.tone || 'pending')}">${esc(row.status || 'Pending')}</span></td>
                                        </tr>
                                    `).join('')
                                    : '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No trainee performance data found for this filter.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="ins-card">
                    <h3>Group Struggle Areas</h3>
                    <div class="table-responsive" style="max-height:270px; overflow-y:auto;">
                        <table class="ins-table ins-table-compact">
                            <thead><tr><th>Assessment</th><th>Avg Score</th><th>Below Threshold</th><th>Attempts</th></tr></thead>
                            <tbody>
                                ${struggleAreas.length
                                    ? struggleAreas.map((row) => `
                                        <tr>
                                            <td>${esc(row.assessment)}</td>
                                            <td class="ins-metric">${row.avgScore}%</td>
                                            <td class="ins-metric">${row.belowThreshold}</td>
                                            <td class="ins-metric">${row.attempts}</td>
                                        </tr>
                                    `).join('')
                                    : '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No group struggle areas detected.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="ins-card">
                    <h3>Attendance (Late Comings)</h3>
                    <div class="table-responsive" style="max-height:270px; overflow-y:auto;">
                        <table class="ins-table ins-table-compact">
                            <thead><tr><th>Agent</th><th>Late</th><th>Confirmed</th><th>Last Late</th></tr></thead>
                            <tbody>
                                ${lateRows.length
                                    ? lateRows.map((row) => `
                                        <tr>
                                            <td>${esc(row.agent)}</td>
                                            <td class="ins-metric">${row.lateCount}</td>
                                            <td class="ins-metric">${row.confirmedCount}</td>
                                            <td class="ins-metric">${esc(row.lastLateDate || '-')}</td>
                                        </tr>
                                    `).join('')
                                    : '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No late comings in this scope.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="ins-card">
                    <h3>Activity Breakdown</h3>
                    <div class="table-responsive" style="max-height:270px; overflow-y:auto;">
                        <table class="ins-table ins-table-compact">
                            <thead><tr><th>Agent</th><th>Violations</th><th>Idle</th><th>External</th><th>Focus</th></tr></thead>
                            <tbody>
                                ${activityRows.length
                                    ? activityRows.map((row) => `
                                        <tr>
                                            <td>${esc(row.agent)}</td>
                                            <td class="ins-metric">${row.violationCount}</td>
                                            <td class="ins-metric">${row.idleMinutes}m</td>
                                            <td class="ins-metric">${row.externalMinutes}m</td>
                                            <td class="ins-metric">${row.focusScore}%</td>
                                        </tr>
                                    `).join('')
                                    : '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No activity monitor data found.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="ins-card full">
                    <h3>Content Creator Engagement</h3>
                    <div class="table-responsive" style="max-height:270px; overflow-y:auto;">
                        <table class="ins-table ins-table-compact">
                            <thead><tr><th>Agent</th><th>Subjects</th><th>Watch</th><th>Quiz Attempts</th><th>Best</th><th>Failed Q</th></tr></thead>
                            <tbody>
                                ${engagementRows.length
                                    ? engagementRows.map((row) => `
                                        <tr>
                                            <td>${esc(row.agent)}</td>
                                            <td class="ins-metric">${row.subjectCount}</td>
                                            <td class="ins-metric">${this.formatDurationCompact(row.watchSeconds)}</td>
                                            <td class="ins-metric">${row.quizAttempts}</td>
                                            <td class="ins-metric">${row.bestScore === null ? '-' : `${Math.round(row.bestScore)}%`}</td>
                                            <td class="ins-metric">${row.failedQuestions}</td>
                                        </tr>
                                    `).join('')
                                    : '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No content engagement captured yet.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="ins-card full">
                    <h3>Action Required Subjects</h3>
                    <p class="ins-subtle" style="margin-bottom:8px;">Failure frequency and subject-review outcomes (Improve / Pass / Complete Fail).</p>
                    <div class="table-responsive" style="max-height:280px; overflow-y:auto;">
                        <table class="ins-table ins-table-compact">
                            <thead><tr><th>Subject</th><th>Fails</th><th>Reviewed</th><th>Improve</th><th>Pass</th><th>Complete Fail</th></tr></thead>
                            <tbody>
                                ${failedSubjectRows.length
                                    ? failedSubjectRows.map((row) => `
                                        <tr>
                                            <td>${esc(row.subject)}</td>
                                            <td class="ins-metric">${row.failCount}</td>
                                            <td class="ins-metric">${row.reviewedCount}</td>
                                            <td class="ins-metric">${row.improveCount}</td>
                                            <td class="ins-metric">${row.passCount}</td>
                                            <td class="ins-metric">${row.completeFailCount}</td>
                                        </tr>
                                    `).join('')
                                    : '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No failed subjects in current scope.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="ins-card">
                    <h3>Teamleader Production Feedback Mix</h3>
                    <div class="table-responsive" style="max-height:240px; overflow-y:auto;">
                        <table class="ins-table ins-table-compact">
                            <thead><tr><th>Medium</th><th>Count</th></tr></thead>
                            <tbody>
                                ${feedbackMediumRows.length
                                    ? feedbackMediumRows.map((row) => `
                                        <tr>
                                            <td>${esc(row.medium)}</td>
                                            <td class="ins-metric">${row.count}</td>
                                        </tr>
                                    `).join('')
                                    : '<tr><td colspan="2" style="text-align:center; color:var(--text-muted);">No feedback mediums captured.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="ins-card">
                    <h3>Recent TL Feedback</h3>
                    <div class="table-responsive" style="max-height:240px; overflow-y:auto;">
                        <table class="ins-table ins-table-compact">
                            <thead><tr><th>Agent</th><th>Medium</th><th>Issue</th><th>Ticket</th><th>Date</th></tr></thead>
                            <tbody>
                                ${feedbackRecent.length
                                    ? feedbackRecent.map((row) => `
                                        <tr>
                                            <td>${esc(row.agent)}</td>
                                            <td>${esc(row.selectedMedium || '-')}</td>
                                            <td>${esc(row.problemStatement || '-')}</td>
                                            <td>${esc(row.ticketNumber || '-')}</td>
                                            <td>${esc(row.date || '-')}</td>
                                        </tr>
                                    `).join('')
                                    : '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No Teamleader production feedback found.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="ins-card full">
                    <h3>Activity Timeline</h3>
                    <p class="ins-subtle" style="margin-bottom:8px;">Unified cross-agent timeline (attendance, assessments, quizzes, feedback, and activity summaries).</p>
                    <div class="ins-timeline" style="max-height:360px;">
                        ${timelineRows.length
                            ? timelineRows.map((event) => `
                                <div class="ins-timeline-item">
                                    <div class="ins-timeline-dot"></div>
                                    <div class="ins-timeline-content">
                                        <div class="ins-item-top">
                                            <strong>${esc(event.agent)} | ${esc(event.type)}</strong>
                                            <span class="ins-subtle">${esc(event.date || '-')}</span>
                                        </div>
                                        <div class="ins-subtle" style="margin-top:6px;">${esc(event.detail || '-')}</div>
                                    </div>
                                </div>
                            `).join('')
                            : '<div class="ins-item">No timeline activity found in this scope.</div>'}
                    </div>
                </div>
            </div>
        `;
    },

    render: function() {
        const root = document.getElementById('insight-app');
        if (!root) return;

        if (!this.canAccess()) {
            root.innerHTML = `
                <div class="card" style="max-width:760px; margin:24px auto; text-align:center; border-color:#ff5252;">
                    <h3 style="color:#ff5252; margin-bottom:8px;">Access Denied</h3>
                    <p style="color:var(--text-muted); margin:0;">Insight is restricted to Admin and Super Admin sessions only.</p>
                </div>
            `;
            return;
        }

        if (this.state.loading) {
            root.innerHTML = `
                <div class="card" style="text-align:center; padding:46px;">
                    <i class="fas fa-circle-notch fa-spin fa-2x"></i>
                    <p style="margin-top:14px;">Refreshing Insight data...</p>
                </div>
            `;
            return;
        }

        const esc = this.escapeHtml;
        const groups = InsightDataService.getGroups();
        const isProgressView = this.state.viewMode === 'progress';
        const isDepartmentView = this.state.viewMode === 'department';

        const rowsHtml = isProgressView
            ? this.getProgressAgents().map((row, idx) => {
                const agent = row.agent;
                const progress = row.progress;
                const loginActive = InsightDataService.isAgentLoginActive(agent.name);
                return `
                    <tr>
                        <td>${idx + 1}</td>
                        <td>
                            <div class="ins-user-cell">
                                <div class="ins-avatar" style="background:${this.hashColor(agent.name)};">${esc(agent.name.slice(0, 2).toUpperCase())}</div>
                                <div>
                                    <div><strong>${esc(agent.name)}</strong></div>
                                    <div class="ins-subtle">${esc(agent.group || 'Ungrouped')}</div>
                                </div>
                            </div>
                        </td>
                        <td class="ins-metric">${progress.completedCount}/${progress.totalRequired}</td>
                        <td>
                            <div class="ins-progress-cell">
                                <div class="ins-progress-track"><div class="ins-progress-fill" style="width:${progress.progress}%;"></div></div>
                                <span class="ins-metric">${progress.progress}%</span>
                            </div>
                        </td>
                        <td>
                            <span class="ins-status ${loginActive ? 'pass' : 'semi'}">${loginActive ? 'Login Active' : 'Login Blocked'}</span>
                        </td>
                        <td>
                            <button class="btn-primary btn-sm" onclick="InsightApp.openProgressAgentByToken('${encodeURIComponent(agent.name)}')"><i class="fas fa-expand"></i> Expand</button>
                        </td>
                    </tr>
                `;
            }).join('')
            : this.getFilteredAgents().map((row, idx) => {
                const agent = row.agent;
                const summary = row.summary;
                const statusClass = this.statusClass(summary.status.status);
                return `
                    <tr>
                        <td>${idx + 1}</td>
                        <td>
                            <div class="ins-user-cell">
                                <div class="ins-avatar" style="background:${this.hashColor(agent.name)};">${esc(agent.name.slice(0, 2).toUpperCase())}</div>
                                <div>
                                    <div><strong>${esc(agent.name)}</strong></div>
                                    <div class="ins-subtle">${esc(agent.group || 'Ungrouped')}</div>
                                </div>
                            </div>
                        </td>
                        <td>
                            <span class="ins-status ${statusClass}">${esc(summary.status.status)}</span>
                        </td>
                        <td class="ins-metric">${summary.avgScore}%</td>
                        <td class="ins-metric">${summary.lateCount}</td>
                        <td class="ins-metric">${summary.violationCount}</td>
                        <td class="ins-metric">${summary.quizAttempts}</td>
                        <td>
                            <div class="ins-badges">
                                        ${agent.badges && agent.badges.length ? agent.badges.map(tag => `<span class="ins-badge">${esc(tag)}</span>`).join('') : '<span class="ins-badge">No badges</span>'}
                            </div>
                        </td>
                        <td>
                            <button class="btn-primary btn-sm" onclick="InsightApp.openAgentByToken('${encodeURIComponent(agent.name)}', 'triggers')"><i class="fas fa-expand"></i> Expand</button>
                        </td>
                    </tr>
                `;
            }).join('');

        root.innerHTML = `
            <div class="ins-shell">
                <div class="ins-toolbar">
                    <div class="ins-toolbar-left">
                        <strong>${isDepartmentView ? 'Department Overview' : (isProgressView ? 'Agent Progress' : 'Agent Triggers')}</strong>
                        <span class="ins-subtle">${isDepartmentView
                            ? 'High-level operational overview powered by trigger, engagement, feedback, and timeline signals.'
                            : (isProgressView
                                ? 'Checklist progress with configurable requirements, N/A control, and graduation readiness.'
                                : 'Program-level trainee insight with adjustable action triggers.')}</span>
                        <div style="display:flex; gap:8px; margin-left:6px;">
                            <button class="sub-tab-btn ${this.state.viewMode === 'triggers' ? 'active' : ''}" onclick="InsightApp.setViewMode('triggers')">Agent Triggers</button>
                            <button class="sub-tab-btn ${this.state.viewMode === 'progress' ? 'active' : ''}" onclick="InsightApp.setViewMode('progress')">Agent Progress</button>
                            <button class="sub-tab-btn ${this.state.viewMode === 'department' ? 'active' : ''}" onclick="InsightApp.setViewMode('department')">Department Overview</button>
                        </div>
                    </div>
                    <div class="ins-toolbar-right">
                        <select onchange="InsightApp.setGroupFilter(this.value)">
                            <option value="all" ${this.state.groupFilter === 'all' ? 'selected' : ''}>All Groups</option>
                            ${groups.map(group => `<option value="${esc(group)}" ${this.state.groupFilter === group ? 'selected' : ''}>${esc(group)}</option>`).join('')}
                        </select>
                        <input type="text" placeholder="Search agent..." value="${esc(this.state.search)}" oninput="InsightApp.setSearch(this.value)">
                        <button class="btn-secondary btn-sm" onclick="InsightApp.refresh()"><i class="fas fa-rotate-right"></i> Refresh</button>
                    </div>
                </div>

                ${isDepartmentView
                    ? this.renderDepartmentOverview()
                    : `<div class="ins-table-wrap">
                        <table class="ins-table">
                            <thead>
                                ${isProgressView
                                    ? `<tr>
                                        <th style="width:50px;">#</th>
                                        <th>Agent</th>
                                        <th>Completed</th>
                                        <th>Progress</th>
                                        <th>Access</th>
                                        <th style="width:120px;">Details</th>
                                    </tr>`
                                    : `<tr>
                                        <th style="width:50px;">#</th>
                                        <th>Agent</th>
                                        <th>Status</th>
                                        <th>Avg Score</th>
                                        <th>Late</th>
                                        <th>Violations</th>
                                        <th>Quiz Attempts</th>
                                        <th>Badges</th>
                                        <th style="width:120px;">Review</th>
                                    </tr>`}
                            </thead>
                            <tbody>
                                ${rowsHtml || `<tr><td colspan="${isProgressView ? '6' : '9'}" style="text-align:center; color:var(--text-muted);">${isProgressView ? 'No trainee agents found for this filter.' : 'No trainee agents currently in Improvement or Critical status for this filter.'}</td></tr>`}
                            </tbody>
                        </table>
                    </div>`}
            </div>
            ${isDepartmentView ? '' : this.renderDetailDrawer()}
        `;
    }
};

window.InsightApp = InsightApp;
window.onload = () => InsightApp.init();

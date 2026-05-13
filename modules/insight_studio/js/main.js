/* ================= INSIGHT MODULE UI ================= */

const InsightApp = {
    state: {
        loading: true,
        viewMode: 'triggers',
        knowledgeMode: 'assessment',
        compareMode: 'person',
        compareAttemptScope: 'live',
        compareSelected: [],
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
                if (typeof InsightDataService.resetIndexes === 'function') InsightDataService.resetIndexes();
                this.state.loading = false;
                this.render();
            }

            if (AppContext && AppContext.sessionCacheMode) {
                if (typeof InsightDataService.hydrateFromLocalStorage === 'function') {
                    InsightDataService.hydrateFromLocalStorage();
                }
                this.state.loading = false;
                this.render();
                return;
            }

            const loadPromise = InsightDataService.loadInitialData();
            if (this.hasImmediateInsightData()) {
                this.state.loading = false;
                this.render();
            }

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

    hasImmediateInsightData: function() {
        try {
            const agents = InsightDataService.getAllAgents();
            const groups = InsightDataService.getGroups();
            const state = InsightDataService.state || {};
            return (Array.isArray(agents) && agents.length > 0)
                || (Array.isArray(groups) && groups.length > 0)
                || (Array.isArray(state.records) && state.records.length > 0)
                || (Array.isArray(state.submissions) && state.submissions.length > 0)
                || (Array.isArray(state.attendance) && state.attendance.length > 0);
        } catch (error) {
            return false;
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
        else if (normalized === 'knowledge' || normalized === 'knowledge-gaps') this.state.viewMode = 'knowledge';
        else if (normalized === 'compare' || normalized === 'comparison') this.state.viewMode = 'compare';
        else this.state.viewMode = 'triggers';
        this.state.drawerOpen = false;
        this.state.selectedAgent = '';
        this.state.detail = null;
        this.state.progressDetail = null;
        this.state.drawerMode = this.state.viewMode;
        this.render();
    },

    setKnowledgeMode: function(mode) {
        const normalized = String(mode || '').trim().toLowerCase();
        this.state.knowledgeMode = ['individual', 'group'].includes(normalized) ? normalized : 'assessment';
        this.render();
    },

    setCompareMode: function(mode) {
        const normalized = String(mode || '').trim().toLowerCase();
        this.state.compareMode = normalized === 'group' && this.state.compareMode !== 'group' ? 'group' : 'person';
        this.state.compareSelected = [];
        this.render();
    },

    setCompareAttemptScope: function(scope) {
        const normalized = String(scope || '').trim().toLowerCase();
        this.state.compareAttemptScope = ['attempt_1', 'attempt_2', 'attempt_1_vs_live'].includes(normalized) ? normalized : 'live';
        this.state.compareSelected = [];
        this.render();
    },

    toggleCompareSelection: function(encodedKey) {
        const key = decodeURIComponent(String(encodedKey || ''));
        if (!key) return;
        const current = Array.isArray(this.state.compareSelected) ? this.state.compareSelected : [];
        this.state.compareSelected = current.includes(key)
            ? current.filter(item => item !== key)
            : [...current, key];
        this.render();
    },

    clearCompareSelection: function() {
        this.state.compareSelected = [];
        this.render();
    },

    selectVisibleCompareRows: function() {
        this.state.compareSelected = this.isAttemptVsLiveCompareScope()
            ? this.getComparePickerRows().map(row => row.key)
            : this.getComparisonRows({ ignoreSelection: true }).map(row => row.key);
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
        const status = InsightDataService.buildStatusFromRecords(records);
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
                                <div class="ins-mini"><strong>${detail.activity.hasData && detail.activity.daysTracked > 0 ? `${detail.activity.focusScore}%` : 'No data'}</strong><span class="ins-subtle">Focus Score</span></div>
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

    renderKnowledgeGaps: function() {
        const esc = this.escapeHtml;
        const mode = this.state.knowledgeMode || 'assessment';
        const data = InsightDataService.buildKnowledgeGaps({
            mode: mode === 'individual' ? 'individual' : 'all',
            groupFilter: this.state.groupFilter,
            search: this.state.search
        });
        const stats = data.stats || {};
        const byAssessment = Array.isArray(data.byAssessment) ? data.byAssessment : [];
        const byIndividual = Array.isArray(data.byIndividual) ? data.byIndividual : [];
        const byGroup = Array.isArray(data.byGroup) ? data.byGroup : [];

        const assessmentHtml = byAssessment.length ? byAssessment.map(row => `
            <div class="ins-card full">
                <div class="ins-item-top">
                    <h3 style="margin:0;">${esc(row.assessment)}</h3>
                    <span class="ins-status improvement">${row.failedCount} failed question${row.failedCount === 1 ? '' : 's'} | ${row.agentCount} agent${row.agentCount === 1 ? '' : 's'}</span>
                </div>
                <div class="table-responsive" style="max-height:260px; overflow-y:auto; margin-top:10px;">
                    <table class="ins-table ins-table-compact">
                        <thead><tr><th>Question</th><th>Fails</th><th>Agents</th><th>Lowest</th></tr></thead>
                        <tbody>
                            ${(row.questions || []).slice(0, 25).map(question => `
                                <tr>
                                    <td>${esc(question.question)}</td>
                                    <td class="ins-metric">${question.failCount}</td>
                                    <td class="ins-metric">${question.agentCount}</td>
                                    <td class="ins-metric">${question.lowestScore}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `).join('') : '<div class="ins-card full">No failed question detail found for this scope. This usually means assessments have no question-level marks saved yet.</div>';

        const individualHtml = byIndividual.length ? `
            <div class="ins-card full">
                <h3>Individual Knowledge Gaps</h3>
                <div class="table-responsive" style="max-height:520px; overflow-y:auto;">
                    <table class="ins-table ins-table-compact">
                        <thead><tr><th>Agent</th><th>Group</th><th>Failed Questions</th><th>Assessments</th></tr></thead>
                        <tbody>
                            ${byIndividual.map(row => `
                                <tr>
                                    <td>${esc(row.agent)}</td>
                                    <td>${esc(row.group || 'Ungrouped')}</td>
                                    <td class="ins-metric">${row.failedCount}</td>
                                    <td>${(row.assessments || []).slice(0, 5).map(item => `${esc(item.assessment)} (${item.failCount})`).join('<br>')}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        ` : '<div class="ins-card full">No individual failed question detail found for this scope.</div>';

        const groupHtml = byGroup.length ? `
            <div class="ins-card full">
                <h3>All Groups Knowledge Gaps</h3>
                <div class="table-responsive" style="max-height:520px; overflow-y:auto;">
                    <table class="ins-table ins-table-compact">
                        <thead><tr><th>Group</th><th>Agents</th><th>Failed Questions</th><th>Top Assessments</th></tr></thead>
                        <tbody>
                            ${byGroup.map(row => `
                                <tr>
                                    <td>${esc(row.group || 'Ungrouped')}</td>
                                    <td class="ins-metric">${row.agentCount}</td>
                                    <td class="ins-metric">${row.failedCount}</td>
                                    <td>${(row.assessments || []).slice(0, 6).map(item => `${esc(item.assessment)} (${item.failCount})`).join('<br>')}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        ` : '<div class="ins-card full">No group failed question detail found for this scope.</div>';

        return `
            <div class="ins-dept-grid">
                <div class="ins-card full">
                    <h3>Knowledge Gaps</h3>
                    <p class="ins-subtle" style="margin-bottom:10px;">Any question below full marks is counted as failed, including partial scores such as 1/2.</p>
                    <div class="ins-mini-grid ins-dept-kpi-grid">
                        <div class="ins-mini"><strong>${stats.failedQuestionCount || 0}</strong><span class="ins-subtle">Failed Questions</span></div>
                        <div class="ins-mini"><strong>${stats.assessmentCount || 0}</strong><span class="ins-subtle">Assessments</span></div>
                        <div class="ins-mini"><strong>${stats.individualCount || 0}</strong><span class="ins-subtle">Individuals</span></div>
                        <div class="ins-mini"><strong>${stats.groupCount || 0}</strong><span class="ins-subtle">Groups</span></div>
                    </div>
                    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;">
                        <button class="sub-tab-btn ${mode === 'assessment' ? 'active' : ''}" onclick="InsightApp.setKnowledgeMode('assessment')">Per Assessment</button>
                        <button class="sub-tab-btn ${mode === 'individual' ? 'active' : ''}" onclick="InsightApp.setKnowledgeMode('individual')">Individual</button>
                        <button class="sub-tab-btn ${mode === 'group' ? 'active' : ''}" onclick="InsightApp.setKnowledgeMode('group')">All Groups</button>
                    </div>
                </div>
                ${mode === 'individual' ? individualHtml : (mode === 'group' ? groupHtml : assessmentHtml)}
            </div>
        `;
    },

    clampPercent: function(value) {
        if (value === null || value === undefined || String(value).trim() === '') return null;
        const number = Number(value);
        if (!Number.isFinite(number)) return null;
        return Math.max(0, Math.min(100, Math.round(number)));
    },

    averagePercent: function(values) {
        const clean = (values || []).map(value => this.clampPercent(value)).filter(value => value !== null);
        if (!clean.length) return null;
        return Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length);
    },

    isVettingAssessmentName: function(value) {
        return String(value || '').toLowerCase().includes('vetting');
    },

    isLiveAssessmentRecord: function(row) {
        const text = [
            row && row.assessment,
            row && row.phase,
            row && row.source,
            row && row.type,
            row && row.sessionId,
            row && row.liveSessionId
        ].map(value => String(value || '').toLowerCase()).join(' ');
        return text.includes('live assessment') || text.includes('live-assessment') || text.includes('live session') || text.includes('live-session');
    },

    isCurrentLiveRecord: function(row, agentName, groupID) {
        if (!row || typeof row !== 'object') return false;
        if (row.archived === true) return false;
        const status = String(row.status || '').trim().toLowerCase();
        if (['archived', 'deleted', 'invalid', 'retake_allowed'].includes(status)) return false;
        if (this.normalizeLookup(row.trainee) !== this.normalizeLookup(agentName)) return false;
        const rowGroup = String(row.groupID || '').trim();
        const currentGroup = String(groupID || '').trim();
        if (!currentGroup || currentGroup === 'Ungrouped') return false;
        if (!rowGroup || rowGroup !== currentGroup) return false;
        const score = this.getComparisonScore(row);
        if (score === null) return false;
        const dateValue = String(row.date || '').trim();
        return !!dateValue && !Number.isNaN(Date.parse(dateValue));
    },

    isCurrentLiveSubmission: function(row, agentName, groupID) {
        if (!row || typeof row !== 'object') return false;
        if (this.normalizeLookup(row.trainee) !== this.normalizeLookup(agentName)) return false;
        const status = String(row.status || '').toLowerCase();
        if (!['completed', 'submitted', 'done', 'passed', 'pass'].includes(status)) return false;
        const rowGroup = String(row.groupID || '').trim();
        const currentGroup = String(groupID || '').trim();
        if (!currentGroup || currentGroup === 'Ungrouped') return false;
        if (!rowGroup || rowGroup !== currentGroup) return false;
        return this.getComparisonScore(row) !== null;
    },

    getCompareAttemptNumber: function() {
        const match = String(this.state.compareAttemptScope || 'live').match(/^attempt_(\d+)$/);
        if (!match) return null;
        const attempt = Number(match[1]);
        return attempt === 1 || attempt === 2 ? attempt : null;
    },

    isAttemptVsLiveCompareScope: function() {
        return String(this.state.compareAttemptScope || 'live') === 'attempt_1_vs_live';
    },

    isArchivedCompareScope: function() {
        return this.getCompareAttemptNumber() !== null;
    },

    getArchiveUserName: function(entry) {
        const user = entry && entry.user;
        if (user && typeof user === 'object') {
            return String(user.user || user.username || user.name || user.email || '').trim();
        }
        return String(user || entry && (entry.trainee || entry.agent || entry.username || entry.name) || '').trim();
    },

    getArchiveTimestamp: function(entry) {
        const value = entry && (entry.movedDate || entry.archivedAt || entry.graduatedDate || entry.createdAt || entry.date);
        const ts = Date.parse(value || '');
        return Number.isFinite(ts) ? ts : 0;
    },

    getRetrainArchivesForAgent: function(agentName) {
        const target = this.normalizeLookup(agentName).replace(/\s+/g, '');
        const archives = Array.isArray(InsightDataService.state.retrainArchives)
            ? InsightDataService.state.retrainArchives
            : [];
        return archives
            .filter((entry) => {
                if (!entry || typeof entry !== 'object') return false;
                const archiveUser = this.normalizeLookup(this.getArchiveUserName(entry)).replace(/\s+/g, '');
                if (!archiveUser || archiveUser !== target) return false;
                const archiveType = String(entry.archiveType || '').trim().toLowerCase();
                const reason = String(entry.reason || '').trim().toLowerCase();
                return archiveType === 'retrain' || reason.startsWith('moved to') || reason.includes('retrain');
            })
            .sort((a, b) => {
                const dateDiff = this.getArchiveTimestamp(a) - this.getArchiveTimestamp(b);
                if (dateDiff !== 0) return dateDiff;
                return Number(a.attemptNumber || 999) - Number(b.attemptNumber || 999);
            })
            .map((entry, index) => ({
                ...entry,
                _safeAttemptNumber: index + 1
            }))
            .filter(entry => entry._safeAttemptNumber <= 2);
    },

    getRetrainArchiveAttempt: function(agentName, attemptNumber) {
        return this.getRetrainArchivesForAgent(agentName)
            .find(entry => Number(entry._safeAttemptNumber || 0) === Number(attemptNumber || 0)) || null;
    },

    isArchiveAttemptRecord: function(row, agentName) {
        if (!row || typeof row !== 'object') return false;
        const status = String(row.status || '').trim().toLowerCase();
        if (['deleted', 'invalid', 'retake_allowed'].includes(status)) return false;
        if (this.normalizeLookup(row.trainee) !== this.normalizeLookup(agentName)) return false;
        if (this.getComparisonScore(row) === null) return false;
        const dateValue = String(row.date || '').trim();
        return !dateValue || !Number.isNaN(Date.parse(dateValue));
    },

    isArchiveAttemptSubmission: function(row, agentName) {
        if (!row || typeof row !== 'object') return false;
        if (this.normalizeLookup(row.trainee) !== this.normalizeLookup(agentName)) return false;
        const status = String(row.status || '').toLowerCase();
        if (status && !['completed', 'submitted', 'done', 'passed', 'pass'].includes(status)) return false;
        return this.getComparisonScore(row) !== null;
    },

    buildActivityBreakdownFromRows: function(monitorRows, violationRows, agentName) {
        const history = InsightDataService.normalizeMonitorHistory(monitorRows || [])
            .filter(row => this.normalizeLookup(row.user) === this.normalizeLookup(agentName));
        const violations = Array.isArray(violationRows) ? violationRows : [];
        let idleMs = 0;
        let externalMs = 0;
        let studyMs = 0;
        let totalMs = 0;
        const toMs = (value) => {
            const num = Number(value || 0);
            if (!Number.isFinite(num) || num <= 0) return 0;
            return num < 100000 ? num * 1000 : num;
        };

        history.forEach((entry) => {
            const summary = entry.summary || {};
            const breakdown = summary.breakdown || summary.activityBreakdown || {};
            const idle = toMs(summary.idle || summary.idleMs || summary.idleSeconds || breakdown.idle);
            const external = toMs(summary.external || summary.externalMs || summary.externalSeconds || breakdown.external);
            const study = toMs(summary.study || summary.studyMs || summary.studySeconds || summary.focused || breakdown.study || breakdown.focus);
            let total = toMs(summary.total || summary.totalMs || summary.totalSeconds || summary.activeMs);
            if (total <= 0) total = idle + external + study;
            idleMs += idle;
            externalMs += external;
            studyMs += study;
            totalMs += total;
        });

        return {
            hasData: history.length > 0 || violations.length > 0,
            dataStatus: history.length ? 'ok' : (violations.length ? 'violations_only' : 'no_data'),
            daysTracked: history.length,
            idleMinutes: Math.round(idleMs / 60000),
            externalMinutes: Math.round(externalMs / 60000),
            violationCount: violations.length,
            focusScore: totalMs > 0 ? Math.round((studyMs / totalMs) * 100) : 0,
            history: history.sort((a, b) => Date.parse(b.date || '') - Date.parse(a.date || ''))
        };
    },

    buildComparisonRowFromData: function(agent, source) {
        const records = Array.isArray(source.records) ? source.records : [];
        const submissions = Array.isArray(source.submissions) ? source.submissions : [];
        const attendance = Array.isArray(source.attendance) ? source.attendance : [];
        const activity = source.activity || { hasData: false, daysTracked: 0, violationCount: 0, focusScore: 0, dataStatus: 'no_data' };
        const engagement = source.engagement || { totals: { totalQuizAttempts: 0, totalWatchSeconds: 0 } };
        const progressScore = this.clampPercent(source.progressScore);
        const regularRecords = records.filter(row => !this.isVettingAssessmentName(row.assessment) && !this.isLiveAssessmentRecord(row));
        const vettingRecords = records.filter(row => this.isVettingAssessmentName(row.assessment));
        const liveRecords = records.filter(row => this.isLiveAssessmentRecord(row));
        const countedAttendance = attendance.filter(row => !row.isIgnored);
        const lateCount = countedAttendance.filter(row => row.isLate).length;
        const attendanceDays = countedAttendance.length;
        const attendanceScore = attendanceDays > 0
            ? this.clampPercent(((attendanceDays - lateCount) / attendanceDays) * 100)
            : null;
        const recordMetricKeys = new Set(records
            .map(row => this.getComparisonMetricIdentity(row.assessment))
            .filter(Boolean));
        const standaloneSubmissions = submissions.filter(row => !recordMetricKeys.has(this.getComparisonMetricIdentity(row.testTitle)));
        const focusScore = activity.hasData && activity.daysTracked > 0 ? this.clampPercent(activity.focusScore) : null;
        const metricValueMap = {};
        const officialProgress = source.officialProgress || ((window.ProgressCatalog && typeof window.ProgressCatalog.getTraineeProgress === 'function')
            ? window.ProgressCatalog.getTraineeProgress(agent.name, source.group || agent.group || '', {
                includeAuto: false,
                data: {
                    records,
                    submissions,
                    savedReports: source.savedReports || source.reports || [],
                    insightReviews: source.insightReviews || source.reviews || [],
                    liveBookings: source.liveBookings || [],
                    exemptions: source.exemptions || []
                }
            })
            : null);
        const progressScoreFinal = progressScore !== null ? progressScore : (officialProgress ? officialProgress.progress : null);
        const officialScoreItems = officialProgress
            ? (officialProgress.items || [])
                .map((item) => ({
                    ...item,
                    score: this.clampPercent(item.score),
                    type: String(item.type || '').trim().toLowerCase()
                }))
                .filter(item => item.score !== null && ['assessment', 'vetting', 'live', 'test'].includes(item.type))
            : [];
        const useOfficialScoreItems = officialScoreItems.length > 0;
        const assessmentScore = useOfficialScoreItems
            ? this.averagePercent(officialScoreItems.filter(item => item.type === 'assessment').map(item => item.score))
            : this.averagePercent(regularRecords.map(row => this.getComparisonScore(row)));
        const vettingScore = useOfficialScoreItems
            ? this.averagePercent(officialScoreItems.filter(item => item.type === 'vetting').map(item => item.score))
            : this.averagePercent(vettingRecords.map(row => this.getComparisonScore(row)));
        const liveScore = useOfficialScoreItems
            ? this.averagePercent(officialScoreItems.filter(item => item.type === 'live').map(item => item.score))
            : this.averagePercent(liveRecords.map(row => this.getComparisonScore(row)));
        const testScore = useOfficialScoreItems
            ? this.averagePercent(officialScoreItems.filter(item => item.type === 'test').map(item => item.score))
            : this.averagePercent(standaloneSubmissions.map(row => this.getComparisonScore(row)));

        if (useOfficialScoreItems) {
            officialScoreItems.forEach((item) => {
                const typeLabel = item.type === 'live' ? 'Live' : (item.type === 'vetting' ? 'Vetting' : (item.type === 'test' ? 'Test' : 'Assessment'));
                this.addComparisonMetricValue(metricValueMap, `${typeLabel}: ${item.name}`, item.score);
            });
        } else {
            regularRecords.forEach(row => this.addComparisonMetricValue(metricValueMap, `Assessment: ${row.assessment}`, this.getComparisonScore(row)));
            vettingRecords.forEach(row => this.addComparisonMetricValue(metricValueMap, `Vetting: ${row.assessment}`, this.getComparisonScore(row)));
            liveRecords.forEach(row => this.addComparisonMetricValue(metricValueMap, `Live: ${row.assessment}`, this.getComparisonScore(row)));
            standaloneSubmissions.forEach(row => this.addComparisonMetricValue(metricValueMap, `Test: ${row.testTitle || 'Submission'}`, this.getComparisonScore(row)));
        }
        this.addComparisonMetricValue(metricValueMap, 'Attendance', attendanceScore);
        this.addComparisonMetricValue(metricValueMap, 'Focus Level', focusScore);
        this.addDailyAttendanceMetricValues(metricValueMap, countedAttendance);
        this.addDailyFocusMetricValues(metricValueMap, activity.history || []);

        const overallScore = this.averagePercent([
            assessmentScore,
            vettingScore,
            liveScore,
            testScore,
            attendanceScore,
            focusScore,
            progressScoreFinal
        ]);

        return {
            key: source.key || agent.name,
            personKey: source.personKey || agent.name,
            label: agent.name,
            group: source.group || agent.group || 'Ungrouped',
            type: 'person',
            attemptLabel: source.attemptLabel || 'Current Live Attempt',
            assessmentScore,
            vettingScore,
            liveScore,
            testScore,
            attendanceScore,
            focusScore,
            progressScore: progressScoreFinal,
            overallScore,
            metricMap: this.finalizeComparisonMetricMap(metricValueMap),
            recordCount: records.length,
            testCount: submissions.length,
            attendanceDays,
            lateCount,
            violationCount: Number(activity.violationCount || 0),
            quizAttempts: Number(engagement.totals && engagement.totals.totalQuizAttempts || 0),
            watchSeconds: Number(engagement.totals && engagement.totals.totalWatchSeconds || 0),
            dataStatus: activity.dataStatus || 'no_data'
        };
    },

    buildArchiveComparisonRow: function(agent, attemptNumber, currentGroup) {
        const archive = this.getRetrainArchiveAttempt(agent.name, attemptNumber);
        if (!archive) return null;
        const archiveRecords = InsightDataService.normalizeRecords(Array.isArray(archive.records) ? archive.records : [])
            .filter(row => this.isArchiveAttemptRecord(row, agent.name));
        const archiveSubmissions = InsightDataService.normalizeSubmissions(Array.isArray(archive.submissions) ? archive.submissions : [])
            .filter(row => this.isArchiveAttemptSubmission(row, agent.name));
        const archiveAttendance = InsightDataService.normalizeAttendance(Array.isArray(archive.attendance) ? archive.attendance : []);
        const archiveActivity = this.buildActivityBreakdownFromRows(
            Array.isArray(archive.monitorHistory) ? archive.monitorHistory : (Array.isArray(archive.monitor_history) ? archive.monitor_history : []),
            Array.isArray(archive.violationReports) ? archive.violationReports : (Array.isArray(archive.violation_reports) ? archive.violation_reports : []),
            agent.name
        );
        return this.buildComparisonRowFromData(agent, {
            key: `${agent.name}::attempt_${attemptNumber}`,
            personKey: agent.name,
            group: archive.fromGroup || archive.group || currentGroup,
            attemptLabel: `Training Attempt ${attemptNumber}`,
            records: archiveRecords,
            submissions: archiveSubmissions,
            liveBookings: Array.isArray(archive.liveBookings) ? archive.liveBookings : [],
            exemptions: Array.isArray(archive.exemptions) ? archive.exemptions : [],
            attendance: archiveAttendance,
            activity: archiveActivity,
            officialProgress: archive.officialProgress || null,
            progressScore: null,
            engagement: { totals: { totalQuizAttempts: 0, totalWatchSeconds: 0 } }
        });
    },

    buildCurrentLiveComparisonRow: function(agent, currentGroup, options = {}) {
        const records = InsightDataService.getAgentRecords(agent.name)
            .filter(row => this.isCurrentLiveRecord(row, agent.name, currentGroup));
        const submissions = (InsightDataService.state.submissions || [])
            .filter(row => this.isCurrentLiveSubmission(row, agent.name, currentGroup));
        const attendance = InsightDataService.getAgentAttendance(agent.name);
        const activity = InsightDataService.getAgentActivityBreakdown(agent.name);
        const engagement = InsightDataService.getAgentContentEngagement(agent.name);
        const progress = InsightDataService.getAgentProgress(agent.name, agent.group || '');
        return this.buildComparisonRowFromData(agent, {
            key: options.key || agent.name,
            personKey: agent.name,
            group: currentGroup,
            attemptLabel: options.attemptLabel || 'Current Live Attempt',
            records,
            submissions,
            liveBookings: InsightDataService.state.liveBookings || [],
            exemptions: InsightDataService.state.exemptions || [],
            attendance,
            activity,
            engagement,
            progressScore: progress.progress
        });
    },

    shortenMetricLabel: function(value, maxLength) {
        const clean = String(value || '').replace(/\s+/g, ' ').trim();
        const limit = Math.max(12, Number(maxLength || 28));
        if (clean.length <= limit) return clean;
        return `${clean.slice(0, limit - 1)}...`;
    },

    getComparisonMetricIdentity: function(value) {
        return String(value || '')
            .replace(/^(Assessment|Vetting|Live|Test):\s*/i, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    },

    getComparisonScore: function(row) {
        if (!row || typeof row !== 'object') return null;
        const raw = row.raw && typeof row.raw === 'object' ? row.raw : row;
        const candidates = [];
        if (Object.prototype.hasOwnProperty.call(raw, 'score')) candidates.push(raw.score);
        if (Object.prototype.hasOwnProperty.call(raw, 'percentage')) candidates.push(raw.percentage);
        if (Object.prototype.hasOwnProperty.call(raw, 'percent')) candidates.push(raw.percent);
        if (raw.quizMeta && typeof raw.quizMeta === 'object') {
            if (Object.prototype.hasOwnProperty.call(raw.quizMeta, 'percent')) candidates.push(raw.quizMeta.percent);
            if (Object.prototype.hasOwnProperty.call(raw.quizMeta, 'percentage')) candidates.push(raw.quizMeta.percentage);
        }
        if (!row.raw && Object.prototype.hasOwnProperty.call(row, 'score')) candidates.push(row.score);

        for (const candidate of candidates) {
            if (candidate === null || candidate === undefined || String(candidate).trim() === '') continue;
            const score = this.clampPercent(candidate);
            if (score !== null) return score;
        }
        return null;
    },

    getComparisonDateKey: function(value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        const ts = Date.parse(raw);
        if (!Number.isFinite(ts)) return raw.slice(0, 10);
        return new Date(ts).toISOString().slice(0, 10);
    },

    getActivityEntryFocusScore: function(entry) {
        if (!entry || typeof entry !== 'object') return null;
        const summary = entry.summary || {};
        const raw = entry.raw || {};
        const breakdown = summary.breakdown || summary.activityBreakdown || raw.activityBreakdown || raw.breakdown || {};
        const toMs = (value) => {
            const num = Number(value || 0);
            if (!Number.isFinite(num) || num <= 0) return 0;
            return num < 100000 ? num * 1000 : num;
        };
        const idle = toMs(summary.idle || summary.idleMs || summary.idleSeconds || breakdown.idle);
        const external = toMs(summary.external || summary.externalMs || summary.externalSeconds || breakdown.external);
        const study = toMs(summary.study || summary.studyMs || summary.studySeconds || summary.focused || breakdown.study || breakdown.focus);
        let total = toMs(summary.total || summary.totalMs || summary.totalSeconds || summary.activeMs);

        if (Array.isArray(entry.details)) {
            let detailTotal = 0;
            entry.details.forEach((detail) => {
                detailTotal += toMs(detail && (detail.duration || detail.durationMs || detail.effectiveDuration || detail.ms || detail.seconds));
            });
            if (total <= 0) total = detailTotal;
        }

        if (total <= 0) total = idle + external + study;
        if (total <= 0) return null;
        return this.clampPercent((study / total) * 100);
    },

    addDailyAttendanceMetricValues: function(map, attendanceRows) {
        (attendanceRows || []).forEach((row) => {
            if (!row || row.isIgnored) return;
            const dateKey = this.getComparisonDateKey(row.date);
            if (!dateKey) return;
            this.addComparisonMetricValue(map, `Attendance: ${dateKey}`, row.isLate ? 0 : 100);
        });
    },

    addDailyFocusMetricValues: function(map, historyRows) {
        (historyRows || []).forEach((row) => {
            const dateKey = this.getComparisonDateKey(row && row.date);
            if (!dateKey) return;
            const score = this.getActivityEntryFocusScore(row);
            if (score === null) return;
            this.addComparisonMetricValue(map, `Focus: ${dateKey}`, score);
        });
    },

    addComparisonMetricValue: function(map, label, value) {
        const cleanLabel = String(label || '').replace(/\s+/g, ' ').trim();
        const score = this.clampPercent(value);
        if (!cleanLabel || score === null) return;
        if (!map[cleanLabel]) map[cleanLabel] = [];
        map[cleanLabel].push(score);
    },

    finalizeComparisonMetricMap: function(map) {
        const out = {};
        Object.keys(map || {}).forEach((label) => {
            out[label] = this.averagePercent(map[label]);
        });
        return out;
    },

    getComparisonAgentRows: function() {
        const selectedGroup = String(this.state.groupFilter || 'all');
        const search = String(this.state.search || '').trim().toLowerCase();
        const agents = InsightDataService.getAllAgents().filter((agent) => {
            if (!this.isTraineeRole(agent.role)) return false;
            if (agent.blocked) return false;
            if (!agent.group || agent.group === 'Ungrouped') return false;
            if (selectedGroup !== 'all' && String(agent.group || '') !== selectedGroup) return false;
            if (search && !String(agent.name || '').toLowerCase().includes(search)) return false;
            return true;
        });

        return agents.map((agent) => {
            const currentGroup = String(agent.group || '').trim();
            const attemptNumber = this.getCompareAttemptNumber();
            if (this.isAttemptVsLiveCompareScope()) {
                const archiveRow = this.buildArchiveComparisonRow(agent, 1, currentGroup);
                const currentRow = this.buildCurrentLiveComparisonRow(agent, currentGroup, {
                    key: `${agent.name}::current_live`,
                    attemptLabel: 'Current Live Attempt'
                });
                if (!archiveRow || !currentRow) return null;
                archiveRow.label = `${agent.name} - Attempt 1`;
                currentRow.label = `${agent.name} - Current`;
                return [archiveRow, currentRow];
            }
            if (attemptNumber) {
                return this.buildArchiveComparisonRow(agent, attemptNumber, currentGroup);
            }

            return this.buildCurrentLiveComparisonRow(agent, currentGroup);
        }).flat().filter(Boolean);
    },

    getComparisonRows: function(options = {}) {
        const selectedGroup = String(this.state.groupFilter || 'all');
        const personRows = this.getComparisonAgentRows();
        const applySelection = (rows) => {
            if (options.ignoreSelection) return rows;
            const selected = Array.isArray(this.state.compareSelected) ? this.state.compareSelected : [];
            if (!selected.length) return rows;
            const selectedSet = new Set(selected);
            if (this.isAttemptVsLiveCompareScope()) return rows.filter(row => selectedSet.has(row.personKey || row.key));
            return rows.filter(row => selectedSet.has(row.key));
        };
        if (this.isAttemptVsLiveCompareScope() || this.state.compareMode !== 'group' || selectedGroup !== 'all') {
            return applySelection(personRows.sort((a, b) => {
                const scoreDiff = Number(b.overallScore || 0) - Number(a.overallScore || 0);
                if (scoreDiff !== 0) return scoreDiff;
                return String(a.label || '').localeCompare(String(b.label || ''), undefined, { sensitivity: 'base' });
            }));
        }

        const groups = {};
        personRows.forEach((row) => {
            const group = row.group || 'Ungrouped';
            if (!groups[group]) {
                groups[group] = {
                    key: group,
                    label: group,
                    group,
                    type: 'group',
                    members: [],
                    recordCount: 0,
                    testCount: 0,
                    attendanceDays: 0,
                    lateCount: 0,
                    violationCount: 0,
                    quizAttempts: 0,
                    watchSeconds: 0
                };
            }
            groups[group].members.push(row);
            groups[group].recordCount += Number(row.recordCount || 0);
            groups[group].testCount += Number(row.testCount || 0);
            groups[group].attendanceDays += Number(row.attendanceDays || 0);
            groups[group].lateCount += Number(row.lateCount || 0);
            groups[group].violationCount += Number(row.violationCount || 0);
            groups[group].quizAttempts += Number(row.quizAttempts || 0);
            groups[group].watchSeconds += Number(row.watchSeconds || 0);
        });

        const groupRows = Object.values(groups).map((group) => ({
            ...group,
            memberCount: group.members.length,
            assessmentScore: this.averagePercent(group.members.map(row => row.assessmentScore)),
            vettingScore: this.averagePercent(group.members.map(row => row.vettingScore)),
            liveScore: this.averagePercent(group.members.map(row => row.liveScore)),
            testScore: this.averagePercent(group.members.map(row => row.testScore)),
            attendanceScore: this.averagePercent(group.members.map(row => row.attendanceScore)),
            focusScore: this.averagePercent(group.members.map(row => row.focusScore)),
            progressScore: this.averagePercent(group.members.map(row => row.progressScore)),
            overallScore: this.averagePercent(group.members.map(row => row.overallScore)),
            metricMap: this.buildGroupComparisonMetricMap(group.members)
        })).sort((a, b) => {
            const scoreDiff = Number(b.overallScore || 0) - Number(a.overallScore || 0);
            if (scoreDiff !== 0) return scoreDiff;
            return String(a.label || '').localeCompare(String(b.label || ''), undefined, { sensitivity: 'base' });
        });
        return applySelection(groupRows);
    },

    getComparePickerRows: function() {
        const rows = this.getComparisonRows({ ignoreSelection: true });
        if (!this.isAttemptVsLiveCompareScope()) return rows;
        const people = new Map();
        rows.forEach((row) => {
            const key = row.personKey || row.key;
            if (!key || people.has(key)) return;
            const pairRows = rows.filter(item => (item.personKey || item.key) === key);
            people.set(key, {
                key,
                label: String(key),
                group: row.group || 'Ungrouped',
                attemptLabel: pairRows.map(item => item.attemptLabel).join(' vs '),
                pairCount: pairRows.length
            });
        });
        return Array.from(people.values()).sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { sensitivity: 'base' }));
    },

    buildGroupComparisonMetricMap: function(members) {
        const bucket = {};
        (members || []).forEach((member) => {
            Object.entries(member.metricMap || {}).forEach(([label, value]) => {
                const score = this.clampPercent(value);
                if (score === null) return;
                if (!bucket[label]) bucket[label] = [];
                bucket[label].push(score);
            });
        });
        return this.finalizeComparisonMetricMap(bucket);
    },

    getBreakdownMetricLabels: function(rows, category) {
        const counts = {};
        (rows || []).forEach((row) => {
            Object.keys(row.metricMap || {}).forEach((label) => {
                const clean = String(label || '').toLowerCase();
                if (category === 'performance' && (clean === 'attendance' || clean === 'focus level' || clean.startsWith('attendance:') || clean.startsWith('focus:'))) return;
                if (category === 'attendance' && clean !== 'attendance' && !clean.startsWith('attendance:')) return;
                if (category === 'focus' && clean !== 'focus level' && !clean.startsWith('focus:')) return;
                counts[label] = (counts[label] || 0) + 1;
            });
        });
        if (category === 'attendance' || category === 'focus') {
            const prefix = category === 'attendance' ? 'attendance:' : 'focus:';
            const dated = Object.keys(counts)
                .filter(label => String(label || '').toLowerCase().startsWith(prefix))
                .sort((a, b) => {
                    const aDate = this.getComparisonDateKey(String(a).replace(/^[^:]+:\s*/, ''));
                    const bDate = this.getComparisonDateKey(String(b).replace(/^[^:]+:\s*/, ''));
                    return String(aDate).localeCompare(String(bDate), undefined, { numeric: true, sensitivity: 'base' });
                });
            if (dated.length) return dated;
        }
        const priority = (label) => {
            const clean = String(label || '').toLowerCase();
            if (clean === 'attendance') return 9000;
            if (clean === 'focus level') return 8999;
            if (clean.startsWith('live:')) return 7000;
            if (clean.startsWith('vetting:')) return 6000;
            if (clean.startsWith('test:')) return 5000;
            if (clean.startsWith('assessment:')) return 4000;
            return 1000;
        };
        return Object.keys(counts)
            .sort((a, b) => {
                const countDiff = counts[b] - counts[a];
                if (countDiff !== 0) return countDiff;
                const priorityDiff = priority(b) - priority(a);
                if (priorityDiff !== 0) return priorityDiff;
                return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
            })
            .slice(0, category === 'performance' ? 22 : 1);
    },

    renderMetricBar: function(label, value, tone) {
        const esc = this.escapeHtml;
        const score = this.clampPercent(value);
        const width = score === null ? 0 : score;
        return `
            <div class="ins-compare-metric">
                <div class="ins-item-top"><span>${esc(label)}</span><strong>${score === null ? 'No data' : `${score}%`}</strong></div>
                <div class="ins-compare-track"><div class="ins-compare-fill ${tone || ''}" style="width:${width}%;"></div></div>
            </div>
        `;
    },

    renderComparisonRadar: function(rows) {
        const esc = this.escapeHtml;
        const metrics = [
            ['assessmentScore', 'Assessment'],
            ['vettingScore', 'Vetting'],
            ['liveScore', 'Live'],
            ['testScore', 'Tests'],
            ['attendanceScore', 'Attendance'],
            ['focusScore', 'Focus'],
            ['progressScore', 'Progress']
        ];
        const avg = {};
        metrics.forEach(([key]) => {
            avg[key] = this.averagePercent((rows || []).map(row => row[key])) || 0;
        });

        const cx = 160;
        const cy = 120;
        const radius = 86;
        const points = metrics.map(([key], idx) => {
            const angle = (-Math.PI / 2) + (idx * Math.PI * 2 / metrics.length);
            const valueRadius = radius * (avg[key] / 100);
            return {
                key,
                label: metrics[idx][1],
                axisX: cx + Math.cos(angle) * radius,
                axisY: cy + Math.sin(angle) * radius,
                x: cx + Math.cos(angle) * valueRadius,
                y: cy + Math.sin(angle) * valueRadius,
                textX: cx + Math.cos(angle) * (radius + 22),
                textY: cy + Math.sin(angle) * (radius + 22),
                value: avg[key]
            };
        });
        const polygon = points.map(point => `${point.x},${point.y}`).join(' ');

        return `
            <svg class="ins-radar" viewBox="0 0 320 240" role="img" aria-label="Comparison metric radar">
                <polygon points="${points.map(point => `${point.axisX},${point.axisY}`).join(' ')}" class="ins-radar-grid"></polygon>
                ${points.map(point => `<line x1="${cx}" y1="${cy}" x2="${point.axisX}" y2="${point.axisY}" class="ins-radar-axis"></line>`).join('')}
                <polygon points="${polygon}" class="ins-radar-area"></polygon>
                ${points.map(point => `<circle cx="${point.x}" cy="${point.y}" r="3" class="ins-radar-point"></circle>`).join('')}
                ${points.map(point => `<text x="${point.textX}" y="${point.textY}" text-anchor="middle" class="ins-radar-label">${esc(point.label)} ${point.value}%</text>`).join('')}
            </svg>
        `;
    },

    getComparisonLineColor: function(index) {
        const palette = [
            '#f97316', '#22c55e', '#38bdf8', '#e879f9', '#facc15', '#a78bfa',
            '#fb7185', '#14b8a6', '#60a5fa', '#84cc16', '#f59e0b', '#ec4899',
            '#06b6d4', '#c084fc', '#ef4444', '#10b981'
        ];
        const idx = Math.max(0, Number(index) || 0);
        return palette[idx % palette.length];
    },

    getTrendRowStats: function(row, metricLabels) {
        const values = (metricLabels || [])
            .map(label => this.clampPercent(row && row.metricMap && row.metricMap[label]))
            .filter(value => value !== null);
        if (!values.length) return { avg: null, low: null, high: null, last: null };
        return {
            avg: this.averagePercent(values),
            low: Math.min(...values),
            high: Math.max(...values),
            last: values[values.length - 1]
        };
    },

    renderComparisonTrend: function(rows, category, title) {
        const chartRows = Array.isArray(rows) ? rows : [];
        const metricLabels = this.getBreakdownMetricLabels(chartRows, category || 'performance');
        const compactPerformance = String(category || 'performance') === 'performance';
        const rowPointSets = chartRows.map((row) => {
            return metricLabels
                .map((label) => ({
                    label,
                    value: row.metricMap && row.metricMap[label],
                    score: this.clampPercent(row.metricMap && row.metricMap[label])
                }))
                .filter(point => point.score !== null);
        });
        const axisCount = compactPerformance
            ? Math.max(1, ...rowPointSets.map(points => points.length))
            : metricLabels.length;
        const width = category === 'performance' ? 1040 : 860;
        const height = category === 'performance' ? 330 : 240;
        const pad = 44;
        const rightEdge = width - pad;
        const xFor = (idx) => axisCount <= 1 ? pad : pad + (idx * (rightEdge - pad) / (axisCount - 1));
        const yFor = (value) => height - pad - ((this.clampPercent(value) || 0) * (height - pad * 2) / 100);
        const esc = this.escapeHtml;

        if (!chartRows.length || !metricLabels.length) {
            return `<div class="ins-item">No ${esc(title || 'comparison')} percentages are available for this graph yet.</div>`;
        }

        if (category === 'attendance' || category === 'focus') {
            const datedLabels = metricLabels.filter(label => String(label || '').includes(':'));
            if (datedLabels.length > 1) return this.renderDailyMetricGrid(chartRows, datedLabels, category);
        }

        const pathRows = chartRows.map((row, rowIdx) => {
            const available = (compactPerformance ? rowPointSets[rowIdx] : rowPointSets[rowIdx].map((point) => ({
                ...point,
                idx: metricLabels.indexOf(point.label)
            }))).map((point, pointIdx) => ({
                ...point,
                idx: compactPerformance ? pointIdx : point.idx
            }));
            const points = available.map(point => `${xFor(point.idx)},${yFor(point.score)}`).join(' ');
            const stats = this.getTrendRowStats(row, metricLabels);
            const lastPoint = available.length ? available[available.length - 1] : null;
            return { row, rowIdx, color: this.getComparisonLineColor(rowIdx), available, points, stats, lastPoint };
        }).filter(item => item.points);

        return `
            <div class="ins-trend-scroll ${compactPerformance ? 'performance' : ''}">
                <svg class="ins-line-chart ins-breakdown-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Agent breakdown percentage comparison">
                    <defs>
                        <linearGradient id="insChartWash" x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stop-color="rgba(255,255,255,0.08)"></stop>
                            <stop offset="100%" stop-color="rgba(255,255,255,0.01)"></stop>
                        </linearGradient>
                    </defs>
                    <rect x="${pad}" y="${pad}" width="${rightEdge - pad}" height="${height - pad * 2}" rx="10" fill="url(#insChartWash)"></rect>
                    <line x1="${pad}" y1="${height - pad}" x2="${rightEdge}" y2="${height - pad}" class="ins-chart-axis"></line>
                    <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" class="ins-chart-axis"></line>
                    ${[25,50,75,100].map(mark => `<line x1="${pad}" y1="${yFor(mark)}" x2="${rightEdge}" y2="${yFor(mark)}" class="ins-chart-grid"></line><text x="10" y="${yFor(mark) + 4}" class="ins-chart-label">${mark}%</text>`).join('')}
                    ${pathRows.map((item) => {
                        const titleText = `${item.row.label} | Avg ${item.stats.avg === null ? '-' : `${item.stats.avg}%`} | Low ${item.stats.low === null ? '-' : `${item.stats.low}%`} | High ${item.stats.high === null ? '-' : `${item.stats.high}%`}`;
                        return `<g class="ins-trend-series">
                            <title>${esc(titleText)}</title>
                            <polyline points="${item.points}" fill="none" stroke="${item.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
                            ${item.available.map(point => `<circle cx="${xFor(point.idx)}" cy="${yFor(point.score)}" r="3.4" fill="${item.color}" stroke="rgba(8,13,22,0.82)" stroke-width="1.5"><title>${esc(item.row.label)} | ${esc(point.label.replace(/^(Assessment|Vetting|Live|Test):\s*/i, ''))} | ${point.score}%</title></circle>`).join('')}
                        </g>`;
                    }).join('')}
                    ${Array.from({ length: axisCount }, (_, idx) => `<text x="${xFor(idx)}" y="${height - 15}" text-anchor="middle" class="ins-chart-label">${idx + 1}</text>`).join('')}
                </svg>
            </div>
            <div class="ins-trend-summary">
                ${pathRows.map((item) => `
                    <div class="ins-trend-summary-row">
                        <span><i style="background:${item.color};"></i>${esc(item.row.label)}</span>
                        <strong>Avg ${item.stats.avg === null ? '-' : `${item.stats.avg}%`}</strong>
                        <small>Low ${item.stats.low === null ? '-' : `${item.stats.low}%`} | High ${item.stats.high === null ? '-' : `${item.stats.high}%`}</small>
                    </div>
                `).join('')}
            </div>
            <div class="ins-axis-key">
                ${compactPerformance
                    ? '<span><strong>1...N</strong> Actual scored assessment/test order per person. Lines stop where that person has no further scored item.</span>'
                    : metricLabels.map((label, idx) => `<span><strong>${idx + 1}</strong> ${esc(label.replace(/^(Assessment|Vetting|Live|Test|Attendance|Focus):\s*/i, ''))}</span>`).join('')}
            </div>
        `;
    },

    getDailyMetricColor: function(value, category) {
        const score = this.clampPercent(value);
        if (score === null) return 'rgba(148, 163, 184, 0.12)';
        if (category === 'attendance') {
            if (score >= 95) return 'rgba(34, 197, 94, 0.85)';
            if (score > 0) return 'rgba(245, 158, 11, 0.82)';
            return 'rgba(239, 68, 68, 0.88)';
        }
        if (score >= 80) return 'rgba(34, 197, 94, 0.85)';
        if (score >= 50) return 'rgba(245, 158, 11, 0.82)';
        return 'rgba(239, 68, 68, 0.88)';
    },

    renderDailyMetricGrid: function(rows, metricLabels, category) {
        const esc = this.escapeHtml;
        const labels = Array.isArray(metricLabels) ? metricLabels : [];
        const averageFor = (row) => this.averagePercent(labels.map(label => row.metricMap && row.metricMap[label]));
        const dateText = (label) => String(label || '').replace(/^[^:]+:\s*/, '');

        return `
            <div style="overflow:auto; max-width:100%;">
                <table class="ins-table ins-table-compact" style="min-width:${Math.max(520, 150 + labels.length * 42)}px;">
                    <thead>
                        <tr>
                            <th style="position:sticky; left:0; z-index:2; background:var(--bg-card); min-width:150px;">${category === 'attendance' ? 'Attendance' : 'Focus'}</th>
                            ${labels.map(label => `<th title="${esc(dateText(label))}" style="text-align:center; min-width:38px;">${esc(dateText(label).slice(5))}</th>`).join('')}
                            <th style="text-align:center; min-width:56px;">Avg</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map((row) => {
                            const avg = averageFor(row);
                            return `
                                <tr>
                                    <td style="position:sticky; left:0; z-index:1; background:var(--bg-card); max-width:180px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${esc(row.label)}">${esc(row.label)}</td>
                                    ${labels.map((label) => {
                                        const score = this.clampPercent(row.metricMap && row.metricMap[label]);
                                        const valueText = score === null ? '-' : `${score}%`;
                                        return `<td title="${esc(row.label)} | ${esc(dateText(label))} | ${valueText}" style="text-align:center; padding:4px;">
                                            <span style="display:block; height:20px; border-radius:4px; background:${this.getDailyMetricColor(score, category)}; color:#fff; font-size:0.62rem; line-height:20px; min-width:30px;">${score === null ? '' : score}</span>
                                        </td>`;
                                    }).join('')}
                                    <td class="ins-metric">${avg === null ? '-' : `${avg}%`}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            <div class="ins-chart-legend">
                <span><i style="background:rgba(34, 197, 94, 0.85);"></i>${category === 'attendance' ? 'On time' : '80-100%'}</span>
                <span><i style="background:rgba(245, 158, 11, 0.82);"></i>${category === 'attendance' ? 'Mixed' : '50-79%'}</span>
                <span><i style="background:rgba(239, 68, 68, 0.88);"></i>${category === 'attendance' ? 'Late' : '0-49%'}</span>
            </div>
        `;
    },

    renderComparisonViewer: function() {
        const esc = this.escapeHtml;
        const mode = this.state.compareMode || 'person';
        const attemptScope = this.state.compareAttemptScope || 'live';
        const attemptNumber = this.getCompareAttemptNumber();
        const pairMode = this.isAttemptVsLiveCompareScope();
        const scopeLabel = pairMode ? 'Attempt 1 vs Current Live' : (attemptNumber ? `Training Attempt ${attemptNumber} Archive` : 'Current Live Attempt');
        const rows = this.getComparisonRows();
        const selectableRows = this.getComparePickerRows();
        const groupAggregateMode = !pairMode && mode === 'group' && String(this.state.groupFilter || 'all') === 'all';
        const selected = Array.isArray(this.state.compareSelected) ? this.state.compareSelected : [];
        const selectedSet = new Set(selected);
        const topRows = rows.slice(0, 10);
        const metricAvg = {
            overall: this.averagePercent(rows.map(row => row.overallScore)) || 0,
            assessment: this.averagePercent(rows.map(row => row.assessmentScore)) || 0,
            attendance: this.averagePercent(rows.map(row => row.attendanceScore)) || 0,
            focus: this.averagePercent(rows.map(row => row.focusScore)) || 0
        };

        return `
            <div class="ins-dept-grid">
                <div class="ins-card full ins-compare-hero">
                    <div class="ins-item-top" style="align-items:flex-start;">
                        <div>
                            <h3 style="margin:0 0 4px 0;">Compare Viewer</h3>
                            <p class="ins-subtle">${pairMode ? 'Pick specific trainees to compare their Training Attempt 1 archive against their current live attempt on the same graphs.' : (attemptNumber ? `Compare selected trainees or groups using retrain archive snapshot ${attemptNumber}. Only archive attempts 1 and 2 are surfaced until retain attempt data is cleaned.` : 'Compare selected trainees or groups using current live roster data only. Archived, deleted, invalid, blocked, ungrouped, and previous-group rows are excluded.')}</p>
                        </div>
                        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                            <select onchange="InsightApp.setCompareAttemptScope(this.value)" style="margin:0; min-width:210px;">
                                <option value="live" ${attemptScope === 'live' ? 'selected' : ''}>Current Live Attempt</option>
                                <option value="attempt_1" ${attemptScope === 'attempt_1' ? 'selected' : ''}>Training Attempt 1 Archive</option>
                                <option value="attempt_2" ${attemptScope === 'attempt_2' ? 'selected' : ''}>Training Attempt 2 Archive</option>
                                <option value="attempt_1_vs_live" ${attemptScope === 'attempt_1_vs_live' ? 'selected' : ''}>Attempt 1 vs Current Live</option>
                            </select>
                            ${pairMode ? '' : `<button class="sub-tab-btn ${mode === 'group' ? 'active' : ''}" onclick="InsightApp.setCompareMode('group')">Per Group</button>`}
                        </div>
                    </div>
                    <div class="ins-mini-grid ins-dept-kpi-grid" style="margin-top:12px;">
                        <div class="ins-mini"><strong>${rows.length}</strong><span class="ins-subtle">${groupAggregateMode ? 'Groups' : 'People'} Compared</span></div>
                        <div class="ins-mini"><strong>${metricAvg.overall}%</strong><span class="ins-subtle">Avg Overall</span></div>
                        <div class="ins-mini"><strong>${metricAvg.assessment}%</strong><span class="ins-subtle">Avg Assessment</span></div>
                        <div class="ins-mini"><strong>${metricAvg.attendance}%</strong><span class="ins-subtle">Avg Attendance</span></div>
                        <div class="ins-mini"><strong>${metricAvg.focus}%</strong><span class="ins-subtle">Avg Focus</span></div>
                        <div class="ins-mini"><strong>${rows.reduce((sum, row) => sum + Number(row.violationCount || 0), 0)}</strong><span class="ins-subtle">Violations</span></div>
                        <div class="ins-mini"><strong>${esc(scopeLabel)}</strong><span class="ins-subtle">Attempt Scope</span></div>
                    </div>
                </div>

                <div class="ins-card full ins-compare-filter-card">
                    <div class="ins-item-top" style="align-items:flex-start;">
                        <div>
                            <h3 style="margin:0 0 4px 0;">Filter Result Set</h3>
                            <p class="ins-subtle">${pairMode ? 'Pick one or more trainees. Each selected trainee adds two lines: Attempt 1 and Current Live.' : (groupAggregateMode ? 'Pick one or more groups to compare. Selecting a specific group above switches the result set to people inside that group.' : 'Pick one, two, three, or more trainees. Selecting a group above limits this list to people in that group.')}</p>
                        </div>
                        <div style="display:flex; gap:8px; flex-wrap:wrap;">
                            <button class="btn-secondary btn-sm" onclick="InsightApp.selectVisibleCompareRows()">Select Visible</button>
                            <button class="btn-secondary btn-sm" onclick="InsightApp.clearCompareSelection()">Clear</button>
                        </div>
                    </div>
                    <div class="ins-compare-picker">
                        ${selectableRows.length ? selectableRows.map(row => `
                            <label class="ins-compare-pick ${selectedSet.has(row.key) ? 'active' : ''}">
                                <input type="checkbox" ${selectedSet.has(row.key) ? 'checked' : ''} onchange="InsightApp.toggleCompareSelection('${encodeURIComponent(row.key)}')">
                                <span>${esc(row.label)}</span>
                                <small>${pairMode ? `${esc(row.group || 'Ungrouped')} | Attempt 1 vs Current` : `${groupAggregateMode ? `${row.memberCount || 0} members` : esc(row.group || 'Ungrouped')}${attemptNumber && row.attemptLabel ? ` | ${esc(row.attemptLabel)}` : ''}`}</small>
                            </label>
                        `).join('') : '<div class="ins-item">No available comparison rows for this filter.</div>'}
                    </div>
                </div>

                <div class="ins-card ins-compare-rank-card">
                    <h3>Ranked Overall</h3>
                    <div class="ins-compare-bars">
                        ${topRows.length ? topRows.map(row => `
                            <div class="ins-compare-row">
                                <div class="ins-item-top"><strong>${esc(row.label)}</strong><span>${row.overallScore === null ? 'No data' : `${row.overallScore}%`}</span></div>
                                <div class="ins-compare-track"><div class="ins-compare-fill" style="width:${row.overallScore || 0}%;"></div></div>
                                <div class="ins-subtle">${groupAggregateMode ? `${row.memberCount || 0} members` : esc(row.group || 'Ungrouped')} | ${esc(row.attemptLabel || scopeLabel)} | Late ${row.lateCount || 0} | Violations ${row.violationCount || 0}</div>
                            </div>
                        `).join('') : '<div class="ins-item">No comparison rows found for this filter.</div>'}
                    </div>
                </div>

                <div class="ins-card full ins-graph-card">
                    <div class="ins-graph-head">
                        <div>
                            <h3>Assessment / Test Breakdown Graph</h3>
                            <p class="ins-subtle">Each line is one ${groupAggregateMode ? 'group average' : 'agent'} across scored Test Engine progress items. Missing scores are skipped, so lines stop instead of dropping to 0.</p>
                        </div>
                        <span class="ins-graph-pill">${rows.length} ${groupAggregateMode ? 'groups' : 'people'}</span>
                    </div>
                    ${rows.length ? this.renderComparisonTrend(rows, 'performance', 'assessment/test') : '<div class="ins-item">No data available for graphing.</div>'}
                </div>

                <div class="ins-card ins-graph-card">
                    <div class="ins-graph-head">
                        <div>
                            <h3>Attendance Graph</h3>
                            <p class="ins-subtle">Calculated from captured attendance days minus late-coming days.</p>
                        </div>
                    </div>
                    ${rows.length ? this.renderComparisonTrend(rows, 'attendance', 'attendance') : '<div class="ins-item">No attendance data available for graphing.</div>'}
                </div>

                <div class="ins-card ins-graph-card">
                    <div class="ins-graph-head">
                        <div>
                            <h3>Focus Level Graph</h3>
                            <p class="ins-subtle">Study time versus total tracked time from the activity monitor.</p>
                        </div>
                    </div>
                    ${rows.length ? this.renderComparisonTrend(rows, 'focus', 'focus level') : '<div class="ins-item">No focus data available for graphing.</div>'}
                </div>

                <div class="ins-card full">
                    <h3>Detailed Comparison Matrix</h3>
                    <div class="table-responsive" style="max-height:520px; overflow-y:auto;">
                        <table class="ins-table ins-table-compact">
                            <thead>
                                <tr>
                                    <th>${groupAggregateMode ? 'Group' : 'Person'}</th>
                                    <th>Group</th>
                                    <th>Overall</th>
                                    <th>Assessment</th>
                                    <th>Vetting</th>
                                    <th>Live</th>
                                    <th>Tests</th>
                                    <th>Attendance</th>
                                    <th>Focus</th>
                                    <th>Progress</th>
                                    <th>Late</th>
                                    <th>Violations</th>
                                    <th>Records</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows.length ? rows.map(row => `
                                    <tr>
                                        <td><strong>${esc(row.label)}</strong></td>
                                        <td>${groupAggregateMode ? `${row.memberCount || 0} members` : esc(row.group || 'Ungrouped')}</td>
                                        <td>${this.renderMetricBar('Overall', row.overallScore)}</td>
                                        <td>${row.assessmentScore === null ? '-' : `${row.assessmentScore}%`}</td>
                                        <td>${row.vettingScore === null ? '-' : `${row.vettingScore}%`}</td>
                                        <td>${row.liveScore === null ? '-' : `${row.liveScore}%`}</td>
                                        <td>${row.testScore === null ? '-' : `${row.testScore}%`}</td>
                                        <td>${row.attendanceScore === null ? '-' : `${row.attendanceScore}%`}</td>
                                        <td>${row.focusScore === null ? 'No data' : `${row.focusScore}%`}</td>
                                        <td>${row.progressScore === null ? '-' : `${row.progressScore}%`}</td>
                                        <td class="ins-metric">${row.lateCount || 0}/${row.attendanceDays || 0}</td>
                                        <td class="ins-metric">${row.violationCount || 0}</td>
                                        <td class="ins-metric">${row.recordCount || 0}</td>
                                    </tr>
                                `).join('') : '<tr><td colspan="13" style="text-align:center; color:var(--text-muted);">No comparison data found for this filter.</td></tr>'}
                            </tbody>
                        </table>
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
                                            <td class="ins-metric">${esc(row.focusLabel || `${row.focusScore}%`)}</td>
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
                                            <td class="ins-metric">${row.dataStatus === 'no_data' ? 'No data' : `${row.focusScore}%`}</td>
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
        const isKnowledgeView = this.state.viewMode === 'knowledge';
        const isCompareView = this.state.viewMode === 'compare';

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
                        <strong>${isCompareView ? 'Compare Viewer' : (isKnowledgeView ? 'Knowledge Gaps' : (isDepartmentView ? 'Department Overview' : (isProgressView ? 'Agent Progress' : 'Agent Triggers')))}</strong>
                        <span class="ins-subtle">${isCompareView
                            ? 'Side-by-side graph comparison by person or group across scores, attendance, focus, and progress.'
                            : (isKnowledgeView
                            ? 'Question-level gap analysis grouped by assessment, individual, or all groups.'
                            : (isDepartmentView
                            ? 'High-level operational overview powered by trigger, engagement, feedback, and timeline signals.'
                            : (isProgressView
                                ? 'Checklist progress with configurable requirements, N/A control, and graduation readiness.'
                                : 'Program-level trainee insight with adjustable action triggers.')))}</span>
                        <div style="display:flex; gap:8px; margin-left:6px;">
                            <button class="sub-tab-btn ${this.state.viewMode === 'triggers' ? 'active' : ''}" onclick="InsightApp.setViewMode('triggers')">Agent Triggers</button>
                            <button class="sub-tab-btn ${this.state.viewMode === 'progress' ? 'active' : ''}" onclick="InsightApp.setViewMode('progress')">Agent Progress</button>
                            <button class="sub-tab-btn ${this.state.viewMode === 'department' ? 'active' : ''}" onclick="InsightApp.setViewMode('department')">Department Overview</button>
                            <button class="sub-tab-btn ${this.state.viewMode === 'compare' ? 'active' : ''}" onclick="InsightApp.setViewMode('compare')">Compare Viewer</button>
                            <button class="sub-tab-btn ${this.state.viewMode === 'knowledge' ? 'active' : ''}" onclick="InsightApp.setViewMode('knowledge')">Knowledge Gaps</button>
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

                ${isCompareView
                    ? this.renderComparisonViewer()
                    : (isKnowledgeView
                    ? this.renderKnowledgeGaps()
                    : (isDepartmentView
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
                    </div>`))}
            </div>
            ${isDepartmentView || isKnowledgeView || isCompareView ? '' : this.renderDetailDrawer()}
        `;
    }
};

if (typeof window !== 'undefined') {
    window.InsightApp = InsightApp;
    window.onload = () => InsightApp.init();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = InsightApp;
}

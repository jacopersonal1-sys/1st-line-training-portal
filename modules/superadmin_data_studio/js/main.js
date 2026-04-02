const App = {
    state: {
        view: 'overview',
        searchTerm: '',
        explorerSource: 'users',
        modal: null
    },

    async init() {
        const container = document.getElementById('app-container');
        if (!container) return;

        if (!AppContext.authorized) {
            container.innerHTML = `
                <div class="studio-panel" style="max-width:720px; margin:60px auto; text-align:center;">
                    <h1 class="studio-title">Access Blocked</h1>
                    <p class="studio-subtitle">This module is reserved for authenticated <strong>super_admin</strong> sessions with a live Supabase client.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="studio-panel" style="text-align:center; padding:60px 20px;">
                <i class="fas fa-circle-notch fa-spin" style="font-size:2.2rem; color:var(--studio-accent);"></i>
                <p class="studio-subtitle" style="margin:16px auto 0;">Loading live database view...</p>
            </div>
        `;

        try {
            await StudioData.loadAll('manual');
            StudioData.setupRealtime(() => this.render());
            this.render();
        } catch (error) {
            container.innerHTML = `
                <div class="studio-panel" style="border-color:rgba(255,107,107,0.28);">
                    <h1 class="studio-title">Data Studio failed to boot</h1>
                    <p class="studio-subtitle">${StudioUI.escapeHtml(error.message || String(error))}</p>
                </div>
            `;
        }
    },

    buildSnapshot() {
        return {
            users: StudioData.getRows('users'),
            rosters: StudioData.getDocument('rosters') || {},
            tests: StudioData.getRows('tests'),
            records: StudioData.getRows('records'),
            submissions: StudioData.getRows('submissions'),
            liveBookings: StudioData.getRows('live_bookings'),
            attendance: StudioData.getRows('attendance'),
            liveSessions: StudioData.getRows('live_sessions'),
            accessLogs: StudioData.getRows('access_logs'),
            monitorHistory: StudioData.getRows('monitor_history'),
            networkDiagnostics: StudioData.getRows('network_diagnostics'),
            errorReports: StudioData.getRows('error_reports'),
            archivedUsers: StudioData.getRows('archived_users'),
            systemConfig: StudioData.getDocument('system_config') || {},
            documents: StudioData.getAllDocuments(),
            searchTerm: this.state.searchTerm
        };
    },

    render() {
        const container = document.getElementById('app-container');
        if (!container) return;
        const snapshot = this.buildSnapshot();
        container.innerHTML = `
            <div class="studio-shell">
                ${this.renderHero(snapshot)}
                ${this.renderView(snapshot)}
            </div>
        `;
        this.renderModal();
    },

    renderHero(snapshot) {
        const traineeCount = snapshot.users.filter(user => user.role === 'trainee').length;
        const groupCount = Object.keys(snapshot.rosters).length;
        const pendingReviews = snapshot.submissions.filter(item => String(item.status || '').toLowerCase().includes('pending')).length;

        return `
            <section class="studio-hero">
                <div class="studio-hero-top">
                    <div>
                        <h1 class="studio-title">Super Admin Data Studio</h1>
                        <p class="studio-subtitle">A live, app-shaped view of the portal data. This screen stays wired to Supabase in realtime, but it arranges the information the way an operator thinks about users, assessments, operations, and system health.</p>
                    </div>
                    <div class="studio-pill-row">
                        <span class="studio-pill"><i class="fas fa-user-shield"></i> ${StudioUI.escapeHtml(AppContext.user?.user || 'super_admin')}</span>
                        <span class="studio-pill"><i class="fas fa-satellite-dish"></i> ${StudioData.state.liveConnected ? 'Realtime Connected' : 'Realtime Connecting...'}</span>
                        <span class="studio-pill"><i class="fas fa-clock"></i> Refreshed ${StudioUI.escapeHtml(StudioUI.formatRelative(StudioData.state.lastRefreshAt))}</span>
                    </div>
                </div>

                <div style="height:14px;"></div>

                ${StudioUI.renderMetrics([
                    { label: 'Users', value: String(snapshot.users.length), note: `${traineeCount} trainees currently in the user blob` },
                    { label: 'Groups', value: String(groupCount), note: 'Roster groups from the live document store' },
                    { label: 'Assessments', value: String(snapshot.tests.length), note: `${snapshot.records.length} records currently synced` },
                    { label: 'Pending Reviews', value: String(pendingReviews), note: `${snapshot.liveBookings.length} live bookings tracked` },
                    { label: 'Operational Alerts', value: String(snapshot.errorReports.length), note: `${snapshot.networkDiagnostics.length} network diagnostics stored` }
                ])}

                <div style="height:14px;"></div>

                <div class="studio-controls">
                    <input class="studio-search" type="text" value="${StudioUI.escapeHtml(this.state.searchTerm)}" oninput="App.setSearch(this.value)" placeholder="Search across the currently open view...">
                    <div class="studio-action-row">
                        <button class="studio-btn primary" onclick="App.refreshNow()"><i class="fas fa-rotate-right"></i> Refresh Now</button>
                        <button class="studio-btn secondary" onclick="App.setView('explorer')"><i class="fas fa-code"></i> Raw Explorer</button>
                    </div>
                </div>

                <div style="height:14px;"></div>

                <div class="studio-tab-row">
                    ${this.renderTab('overview', 'Overview')}
                    ${this.renderTab('people', 'People')}
                    ${this.renderTab('learning', 'Assessments')}
                    ${this.renderTab('operations', 'Operations')}
                    ${this.renderTab('system', 'System')}
                    ${this.renderTab('explorer', 'Raw Explorer')}
                </div>
            </section>
        `;
    },

    renderTab(view, label) {
        return `<button class="studio-tab ${this.state.view === view ? 'active' : ''}" onclick="App.setView('${view}')">${StudioUI.escapeHtml(label)}</button>`;
    },

    renderView(snapshot) {
        if (this.state.view === 'overview') return this.renderOverview(snapshot);
        if (this.state.view === 'people') return this.renderPeople(snapshot);
        if (this.state.view === 'learning') return this.renderLearning(snapshot);
        if (this.state.view === 'operations') return this.renderOperations(snapshot);
        if (this.state.view === 'system') return this.renderSystem(snapshot);
        return RawExplorerUI.render(this.state);
    },

    renderOverview(snapshot) {
        const liveSessionCount = snapshot.liveSessions.filter(session => session.active || String(session.status || '').toLowerCase() === 'active').length;
        const usersByRole = snapshot.users.reduce((acc, user) => {
            acc[user.role || 'unknown'] = (acc[user.role || 'unknown'] || 0) + 1;
            return acc;
        }, {});

        const summaryCards = [
            `<div class="studio-kv-card"><div class="studio-kv-label">Role Mix</div><div>${Object.entries(usersByRole).map(([role, count]) => `${StudioUI.escapeHtml(role)}: ${count}`).join(' · ')}</div></div>`,
            `<div class="studio-kv-card"><div class="studio-kv-label">Live Sessions</div><div>${liveSessionCount} active now</div></div>`,
            `<div class="studio-kv-card"><div class="studio-kv-label">Realtime Event</div><div>${StudioUI.escapeHtml(StudioData.state.latestEvent || 'Waiting for first event')}</div></div>`,
            `<div class="studio-kv-card"><div class="studio-kv-label">Last Full Refresh</div><div>${StudioUI.escapeHtml(StudioUI.formatDate(StudioData.state.lastRefreshAt))}</div></div>`
        ].join('');

        return `
            ${StudioUI.renderSection('Control Snapshot', 'This is the command view. It compresses the most important moving parts into one pass.', `<div class="studio-kv">${summaryCards}</div>`)}
            ${StudioUI.renderSection('People Snapshot', 'Live users, roster groups, and archived agents shown in the same language you use inside the app.', `
                ${StudioUI.renderMetrics([
                    { label: 'Total Users', value: String(snapshot.users.length), note: 'From the users document' },
                    { label: 'Roster Groups', value: String(Object.keys(snapshot.rosters).length), note: 'Each group can be edited directly from this screen' },
                    { label: 'Archived Users', value: String(snapshot.archivedUsers.length), note: 'Former trainees and restored history' }
                ])}
            `)}
            ${StudioUI.renderSection('Learning Snapshot', 'Current assessments, submissions, and records as training staff would describe them.', `
                ${StudioUI.renderMetrics([
                    { label: 'Assessments', value: String(snapshot.tests.length), note: 'Definitions in the tests blob' },
                    { label: 'Submissions', value: String(snapshot.submissions.length), note: 'Live table rows from Supabase' },
                    { label: 'Records', value: String(snapshot.records.length), note: 'Final scored outcomes' }
                ])}
                <div style="height:16px;"></div>
                ${StudioUI.renderRowCards('records', snapshot.records, snapshot.searchTerm, 6)}
            `)}
            ${StudioUI.renderSection('Operations Snapshot', 'Recent attendance, access, diagnostics, and system issues.', `
                ${StudioUI.renderMetrics([
                    { label: 'Attendance Rows', value: String(snapshot.attendance.length), note: 'Clock in and clock out history' },
                    { label: 'Network Diagnostics', value: String(snapshot.networkDiagnostics.length), note: 'Health checks reported by clients' },
                    { label: 'Error Reports', value: String(snapshot.errorReports.length), note: 'Client-side runtime problems' }
                ])}
            `)}
        `;
    },

    renderPeople(snapshot) {
        return `
            ${StudioUI.renderSection('Users', 'Login identities, roles, passwords, and personal themes from the users blob.', StudioUI.renderUsers(snapshot.users, snapshot.searchTerm), `
                <button class="studio-btn primary" onclick="App.openNewBlobArrayItem('users')"><i class="fas fa-plus"></i> Add User</button>
            `)}
            ${StudioUI.renderSection('Roster Groups', 'These are the practical team buckets used by the rest of the app.', StudioUI.renderRosters(snapshot.rosters, snapshot.searchTerm), `
                <button class="studio-btn primary" onclick="App.openNewRoster()"><i class="fas fa-plus"></i> Add Group</button>
            `)}
            ${StudioUI.renderSection('Archived Users', 'Historical user records kept after graduation or removal.', StudioUI.renderRowCards('archived_users', snapshot.archivedUsers, snapshot.searchTerm, 12))}
        `;
    },

    renderLearning(snapshot) {
        return `
            ${StudioUI.renderSection('Assessment Definitions', 'Titles, question banks, and special flags from the tests blob.', StudioUI.renderTests(snapshot.tests, snapshot.searchTerm), `
                <button class="studio-btn primary" onclick="App.openNewBlobArrayItem('tests')"><i class="fas fa-plus"></i> Add Assessment</button>
            `)}
            ${StudioUI.renderSection('Training Records', 'Final outcomes that appear as completed scores and history.', StudioUI.renderRowCards('records', snapshot.records, snapshot.searchTerm, 16))}
            ${StudioUI.renderSection('Assessment Submissions', 'Attempts that still exist as raw submission rows before or after review.', StudioUI.renderRowCards('submissions', snapshot.submissions, snapshot.searchTerm, 16))}
            ${StudioUI.renderSection('Live Bookings', 'Scheduled or in-flight live assessment appointments.', StudioUI.renderRowCards('live_bookings', snapshot.liveBookings, snapshot.searchTerm, 12))}
        `;
    },

    renderOperations(snapshot) {
        return `
            ${StudioUI.renderSection('Attendance', 'Daily attendance entries exactly as the live table currently holds them.', StudioUI.renderRowCards('attendance', snapshot.attendance, snapshot.searchTerm, 16))}
            ${StudioUI.renderSection('Live Sessions', 'Current live arena session state, including active sessions and hidden payload details.', StudioUI.renderRowCards('live_sessions', snapshot.liveSessions, snapshot.searchTerm, 12))}
            ${StudioUI.renderSection('Access Logs', 'Who logged in, out, or touched sensitive areas recently.', StudioUI.renderRowCards('access_logs', snapshot.accessLogs, snapshot.searchTerm, 16))}
            ${StudioUI.renderSection('Network Diagnostics', 'Live health reports from agent machines and training terminals.', StudioUI.renderRowCards('network_diagnostics', snapshot.networkDiagnostics, snapshot.searchTerm, 12))}
            ${StudioUI.renderSection('Error Reports', 'Client-side runtime faults as seen by the main app.', StudioUI.renderRowCards('error_reports', snapshot.errorReports, snapshot.searchTerm, 12))}
            ${StudioUI.renderSection('Monitor History', 'Activity-monitor timeline rows currently stored on the server.', StudioUI.renderRowCards('monitor_history', snapshot.monitorHistory, snapshot.searchTerm, 12))}
        `;
    },

    renderSystem(snapshot) {
        return `
            ${StudioUI.renderSection('System Config', 'This is the authoritative document for sync rates, failover, announcements, and security features.', StudioUI.renderConfig(snapshot.systemConfig), `
                <button class="studio-btn primary" onclick="App.openDocumentEditor('system_config')"><i class="fas fa-pen"></i> Edit Config</button>
            `)}
            ${StudioUI.renderSection('Live Document Store', 'Every app document currently present in `app_documents`, including module-specific blobs.', StudioUI.renderDocuments(snapshot.documents, snapshot.searchTerm))}
        `;
    },

    setView(view) {
        this.state.view = view;
        this.render();
    },

    setSearch(value) {
        this.state.searchTerm = value;
        this.render();
    },

    setExplorerSource(sourceId) {
        this.state.explorerSource = sourceId;
        this.state.view = 'explorer';
        this.render();
    },

    async refreshNow() {
        try {
            await StudioData.loadAll('manual');
            this.render();
        } catch (error) {
            alert(error.message || String(error));
        }
    },

    openBlobArrayEditor(sourceId, keyValue) {
        const source = StudioData.sourceCatalog[sourceId];
        const rows = StudioData.getRows(sourceId);
        const item = rows.find(row => String(row[source.keyField]) === String(keyValue));
        if (!item) return alert(`${source.label} item not found.`);

        this.openJsonModal({
            title: `Edit ${source.label.slice(0, -1) || source.label}`,
            helpText: `You are editing the live ${source.label.toLowerCase()} document entry. Keep the "${source.keyField}" stable to avoid duplicates.`,
            initialValue: item,
            async onSave(parsed) {
                await StudioData.saveBlobArrayItem(sourceId, parsed, keyValue);
            }
        });
    },

    openNewBlobArrayItem(sourceId) {
        const source = StudioData.sourceCatalog[sourceId];
        const template = sourceId === 'users'
            ? { user: '', pass: '', role: 'trainee', theme: { primaryColor: '#F37021', wallpaper: '' } }
            : sourceId === 'tests'
                ? { id: Date.now(), title: 'New Assessment', questions: [], duration: 30, isVetting: false, isLive: false }
                : {};

        this.openJsonModal({
            title: `Add ${source.label.slice(0, -1) || source.label}`,
            helpText: `Create a new live ${source.label.toLowerCase()} item. The "${source.keyField}" field is required.`,
            initialValue: template,
            async onSave(parsed) {
                await StudioData.saveBlobArrayItem(sourceId, parsed);
            }
        });
    },

    async deleteBlobArrayItem(sourceId, keyValue) {
        const source = StudioData.sourceCatalog[sourceId];
        if (!confirm(`Delete this ${source.label.slice(0, -1).toLowerCase()} from the live document?`)) return;
        try {
            await StudioData.deleteBlobArrayItem(sourceId, keyValue);
            this.render();
        } catch (error) {
            alert(error.message || String(error));
        }
    },

    openRosterEditor(groupName) {
        const rosters = StudioData.getDocument('rosters') || {};
        const members = rosters[groupName];
        if (!members) return alert("Group not found.");

        this.openJsonModal({
            title: `Edit Group · ${groupName}`,
            helpText: 'Keep this as a plain JSON array of usernames. You can also rename the group using the field below.',
            keyLabel: 'Group Name',
            keyValue: groupName,
            initialValue: members,
            async onSave(parsed, nextKey, originalKey) {
                if (!Array.isArray(parsed)) throw new Error("Roster groups must be saved as an array of usernames.");
                await StudioData.saveBlobObjectEntry('rosters', nextKey, parsed, originalKey);
            }
        });
    },

    openNewRoster() {
        this.openJsonModal({
            title: 'Add Group',
            helpText: 'Create a new roster group as a JSON array of usernames.',
            keyLabel: 'Group Name',
            keyValue: '',
            initialValue: [],
            async onSave(parsed, nextKey) {
                if (!Array.isArray(parsed)) throw new Error("Roster groups must be saved as an array of usernames.");
                await StudioData.saveBlobObjectEntry('rosters', nextKey, parsed);
            }
        });
    },

    async deleteRoster(groupName) {
        if (!confirm(`Delete roster group "${groupName}" from the live document store?`)) return;
        try {
            await StudioData.deleteBlobObjectEntry('rosters', groupName);
            this.render();
        } catch (error) {
            alert(error.message || String(error));
        }
    },

    openDocumentEditor(docKey) {
        const source = StudioData.sourceCatalog[docKey];
        const content = source ? StudioData.getDocument(docKey) : (StudioData.getAllDocuments().find(doc => doc.key === docKey)?.content || {});

        this.openJsonModal({
            title: `Edit Document · ${docKey}`,
            helpText: 'This saves the full JSON document back to `app_documents` immediately.',
            initialValue: content,
            async onSave(parsed) {
                await StudioData.updateDocument(docKey, parsed);
            }
        });
    },

    openRowEditor(sourceId, keyValue) {
        const source = StudioData.sourceCatalog[sourceId];
        const row = StudioData.getRows(sourceId).find(item => String(item[source.keyField]) === String(keyValue));
        if (!row) return alert("Row not found.");

        this.openJsonModal({
            title: `Edit ${source.label} Row`,
            helpText: `This saves directly into the live "${source.table}" table. Changing "${source.keyField}" is blocked here for safety.`,
            initialValue: row,
            async onSave(parsed) {
                await StudioData.saveRow(sourceId, parsed, keyValue);
            }
        });
    },

    openNewRow(sourceId) {
        const source = StudioData.sourceCatalog[sourceId];
        const template = source.keyField === 'id'
            ? { id: Date.now() }
            : { [source.keyField]: '' };

        this.openJsonModal({
            title: `Add ${source.label} Row`,
            helpText: `Create a new row for "${source.table}". Fill in every field this table requires.`,
            initialValue: template,
            async onSave(parsed) {
                await StudioData.saveRow(sourceId, parsed);
            }
        });
    },

    async deleteRow(sourceId, keyValue) {
        const source = StudioData.sourceCatalog[sourceId];
        if (!confirm(`Delete this row from "${source.table}"? This action goes straight to Supabase.`)) return;
        try {
            await StudioData.deleteRow(sourceId, keyValue);
            this.render();
        } catch (error) {
            alert(error.message || String(error));
        }
    },

    openJsonModal(config) {
        this.state.modal = config;
        this.renderModal();
    },

    closeModal() {
        this.state.modal = null;
        this.renderModal();
    },

    renderModal() {
        const root = document.getElementById('studio-modal-root');
        if (!root) return;
        if (!this.state.modal) {
            root.innerHTML = '';
            return;
        }

        const modal = this.state.modal;
        root.innerHTML = `
            <div class="studio-modal-backdrop">
                <div class="studio-modal">
                    <div class="studio-modal-head">
                        <div>
                            <h2 class="studio-modal-title">${StudioUI.escapeHtml(modal.title || 'Edit')}</h2>
                            ${modal.helpText ? `<p class="studio-modal-help">${StudioUI.escapeHtml(modal.helpText)}</p>` : ''}
                        </div>
                        <button class="studio-mini-btn" onclick="App.closeModal()"><i class="fas fa-times"></i></button>
                    </div>
                    ${modal.keyLabel ? `
                        <div style="margin-bottom:12px;">
                            <div class="studio-kv-label">${StudioUI.escapeHtml(modal.keyLabel)}</div>
                            <input id="studioModalKeyInput" class="studio-input" value="${StudioUI.escapeHtml(modal.keyValue || '')}">
                        </div>
                    ` : ''}
                    <textarea id="studioModalTextarea" class="studio-textarea">${StudioUI.escapeHtml(JSON.stringify(modal.initialValue, null, 2))}</textarea>
                    <div class="studio-modal-actions">
                        <button class="studio-btn" onclick="App.closeModal()">Cancel</button>
                        <button class="studio-btn primary" onclick="App.saveModal()">Save Live Changes</button>
                    </div>
                </div>
            </div>
        `;
    },

    async saveModal() {
        if (!this.state.modal) return;
        const textarea = document.getElementById('studioModalTextarea');
        const keyInput = document.getElementById('studioModalKeyInput');

        try {
            const parsed = JSON.parse(textarea.value);
            const nextKey = keyInput ? keyInput.value.trim() : undefined;
            if (keyInput && !nextKey) throw new Error("A name/key is required before saving.");
            await this.state.modal.onSave(parsed, nextKey, this.state.modal.keyValue);
            this.closeModal();
            this.render();
        } catch (error) {
            alert(error.message || String(error));
        }
    }
};

window.App = App;
window.addEventListener('DOMContentLoaded', () => App.init());

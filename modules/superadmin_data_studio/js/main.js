const App = {
    state: {
        view: 'overview',
        searchTerm: '',
        explorerSource: 'users',
        workspaceUser: '',
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
            revokedUsers: Array.isArray(StudioData.getDocument('revokedUsers')) ? StudioData.getDocument('revokedUsers') : [],
            retrainArchives: StudioData.getRows('retrain_archives'),
            graduatedAgents: StudioData.getRows('graduated_agents'),
            tests: StudioData.getRows('tests'),
            records: StudioData.getRows('records'),
            submissions: StudioData.getRows('submissions'),
            liveBookings: StudioData.getRows('live_bookings'),
            attendance: StudioData.getRows('attendance'),
            savedReports: StudioData.getRows('saved_reports'),
            insightReviews: StudioData.getRows('insight_reviews'),
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
                    ${this.renderTab('user-control', 'User Control')}
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
        if (this.state.view === 'user-control') return this.renderUserControl(snapshot);
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

    normalizeIdentity(value) {
        let v = String(value || '').trim().toLowerCase();
        if (!v) return '';
        if (v.includes('@')) v = v.split('@')[0];
        v = v.replace(/[._-]+/g, ' ');
        v = v.replace(/\s+/g, ' ').trim();
        return v.replace(/\s+/g, '');
    },

    identitiesMatch(left, right) {
        const l = this.normalizeIdentity(left);
        const r = this.normalizeIdentity(right);
        return !!l && !!r && l === r;
    },

    collectWorkspaceUsers(snapshot) {
        const add = (set, value) => {
            const raw = String(value || '').trim();
            if (!raw) return;
            const key = this.normalizeIdentity(raw);
            if (!key) return;
            if (!set.has(key)) set.set(key, raw);
        };

        const set = new Map();
        (snapshot.users || []).forEach(u => add(set, u.user || u.username));
        Object.values(snapshot.rosters || {}).forEach(list => (Array.isArray(list) ? list : []).forEach(name => add(set, name)));
        (snapshot.revokedUsers || []).forEach(name => add(set, (name && typeof name === 'object') ? (name.user || name.username || name.name) : name));
        (snapshot.records || []).forEach(row => add(set, row.trainee || row.user || row.user_id));
        (snapshot.submissions || []).forEach(row => add(set, row.trainee || row.user || row.user_id));
        (snapshot.liveBookings || []).forEach(row => add(set, row.trainee || row.user || row.user_id));
        (snapshot.attendance || []).forEach(row => add(set, row.user || row.user_id || row.trainee));
        (snapshot.savedReports || []).forEach(row => add(set, row.trainee || row.user || row.user_id));
        (snapshot.insightReviews || []).forEach(row => add(set, row.trainee || row.user || row.user_id));
        (snapshot.archivedUsers || []).forEach(row => add(set, row.user || row.user_id || row.username));
        (snapshot.retrainArchives || []).forEach(row => add(set, row.user || row.username));
        (snapshot.graduatedAgents || []).forEach(row => add(set, row.user || row.username));

        return Array.from(set.values()).sort((a, b) => String(a).localeCompare(String(b)));
    },

    getRowsForUser(rows, username, fields) {
        const list = Array.isArray(rows) ? rows : [];
        const checks = Array.isArray(fields) ? fields : [fields];
        return list.filter(row => checks.some(field => this.identitiesMatch(row && row[field], username)));
    },

    buildWorkspaceProfile(snapshot, username) {
        const activeUser = (snapshot.users || []).find(u => this.identitiesMatch(u && (u.user || u.username), username)) || null;
        const rosterGroups = Object.entries(snapshot.rosters || {})
            .filter(([, members]) => Array.isArray(members) && members.some(name => this.identitiesMatch(name, username)))
            .map(([groupName]) => groupName);

        const records = this.getRowsForUser(snapshot.records, username, ['trainee', 'user', 'user_id']);
        const submissions = this.getRowsForUser(snapshot.submissions, username, ['trainee', 'user', 'user_id']);
        const liveBookings = this.getRowsForUser(snapshot.liveBookings, username, ['trainee', 'user', 'user_id']);
        const attendance = this.getRowsForUser(snapshot.attendance, username, ['user', 'user_id', 'trainee']);
        const savedReports = this.getRowsForUser(snapshot.savedReports, username, ['trainee', 'user', 'user_id']);
        const insightReviews = this.getRowsForUser(snapshot.insightReviews, username, ['trainee', 'user', 'user_id']);
        const archivedRows = this.getRowsForUser(snapshot.archivedUsers, username, ['user', 'user_id', 'username']);
        const retrainEntries = (Array.isArray(snapshot.retrainArchives) ? snapshot.retrainArchives : [])
            .map((entry, index) => ({ entry, index }))
            .filter(item => this.identitiesMatch(item.entry && (item.entry.user || item.entry.username), username))
            .map(item => ({ ...item.entry, __sourceIndex: item.index }));
        const graduatedEntries = (Array.isArray(snapshot.graduatedAgents) ? snapshot.graduatedAgents : [])
            .map((entry, index) => ({ entry, index }))
            .filter(item => this.identitiesMatch(item.entry && (item.entry.user || item.entry.username), username))
            .map(item => ({ ...item.entry, __sourceIndex: item.index }));
        const revokedEntries = Array.isArray(snapshot.revokedUsers) ? snapshot.revokedUsers : [];
        const isRevoked = revokedEntries.some(entry => {
            const raw = (entry && typeof entry === 'object') ? (entry.user || entry.username || entry.name || '') : entry;
            return this.identitiesMatch(raw, username);
        });

        const attempts = [];
        if (records.length || submissions.length || liveBookings.length || attendance.length || savedReports.length || insightReviews.length || activeUser) {
            attempts.push({
                label: 'Current Active Attempt',
                type: 'active',
                date: '',
                group: rosterGroups.join(', ') || (records[0] && records[0].groupID) || '-',
                records,
                submissions,
                liveBookings,
                attendance,
                reports: savedReports,
                reviews: insightReviews
            });
        }

        retrainEntries.forEach(entry => {
            attempts.push({
                label: 'Archived Retrain Attempt',
                type: 'retrain',
                sourceId: 'retrain_archives',
                sourceIndex: entry.__sourceIndex,
                date: entry.movedDate || entry.graduatedDate || '',
                group: entry.targetGroup || entry.reason || '-',
                records: Array.isArray(entry.records) ? entry.records : [],
                submissions: Array.isArray(entry.submissions) ? entry.submissions : [],
                liveBookings: Array.isArray(entry.liveBookings) ? entry.liveBookings : [],
                attendance: Array.isArray(entry.attendance) ? entry.attendance : [],
                reports: Array.isArray(entry.reports) ? entry.reports : [],
                reviews: Array.isArray(entry.reviews) ? entry.reviews : []
            });
        });

        graduatedEntries.forEach(entry => {
            attempts.push({
                label: 'Archived Graduation Attempt',
                type: 'graduated',
                sourceId: 'graduated_agents',
                sourceIndex: entry.__sourceIndex,
                date: entry.graduatedDate || entry.movedDate || '',
                group: (entry.records && entry.records[0] && entry.records[0].groupID) || entry.reason || '-',
                records: Array.isArray(entry.records) ? entry.records : [],
                submissions: Array.isArray(entry.submissions) ? entry.submissions : [],
                liveBookings: Array.isArray(entry.liveBookings) ? entry.liveBookings : [],
                attendance: Array.isArray(entry.attendance) ? entry.attendance : [],
                reports: Array.isArray(entry.reports) ? entry.reports : [],
                reviews: Array.isArray(entry.reviews) ? entry.reviews : []
            });
        });

        attempts.sort((a, b) => {
            const aTs = Date.parse(a.date || 0) || 0;
            const bTs = Date.parse(b.date || 0) || 0;
            return bTs - aTs;
        });

        return {
            username,
            activeUser,
            rosterGroups,
            records,
            submissions,
            liveBookings,
            attendance,
            savedReports,
            insightReviews,
            archivedRows,
            retrainEntries,
            graduatedEntries,
            attempts,
            isRevoked
        };
    },

    renderUserControl(snapshot) {
        const allUsers = this.collectWorkspaceUsers(snapshot).filter(name => StudioUI.matchesSearch(name, snapshot.searchTerm));
        if (!this.state.workspaceUser || !allUsers.some(name => this.identitiesMatch(name, this.state.workspaceUser))) {
            this.state.workspaceUser = allUsers[0] || '';
        }

        const selected = this.state.workspaceUser;
        const profile = selected ? this.buildWorkspaceProfile(snapshot, selected) : null;
        const selectedSafe = StudioUI.escapeHtml(selected || '');

        const selectorHtml = `
            <div class="studio-controls">
                <input class="studio-search" type="text" value="${StudioUI.escapeHtml(this.state.searchTerm)}" oninput="App.setSearch(this.value)" placeholder="Search trainee / username in all stores...">
                <select class="studio-select" onchange="App.selectWorkspaceUser(this.value)">
                    ${allUsers.length === 0 ? '<option value="">No users found</option>' : allUsers.map(name => `<option value="${StudioUI.escapeHtml(name)}" ${this.identitiesMatch(name, selected) ? 'selected' : ''}>${StudioUI.escapeHtml(name)}</option>`).join('')}
                </select>
            </div>
        `;

        if (!profile) {
            return StudioUI.renderSection('User Data Control', 'Select a user to open full cross-module data controls and archive management.', selectorHtml + '<div class="studio-empty">No matching users found in live data right now.</div>');
        }

        const activeSummary = `
            <div class="studio-kv">
                <div class="studio-kv-card"><div class="studio-kv-label">Username</div><div>${selectedSafe}</div></div>
                <div class="studio-kv-card"><div class="studio-kv-label">Login Role</div><div>${StudioUI.escapeHtml(profile.activeUser?.role || 'No active login')}</div></div>
                <div class="studio-kv-card"><div class="studio-kv-label">Bound Client</div><div>${StudioUI.escapeHtml(profile.activeUser?.boundClientId || 'Unbound')}</div></div>
                <div class="studio-kv-card"><div class="studio-kv-label">Revoked</div><div>${profile.isRevoked ? '<span class="studio-chip bad">Yes</span>' : '<span class="studio-chip good">No</span>'}</div></div>
                <div class="studio-kv-card"><div class="studio-kv-label">Roster Groups</div><div>${StudioUI.escapeHtml(profile.rosterGroups.join(', ') || 'Not in roster')}</div></div>
                <div class="studio-kv-card"><div class="studio-kv-label">Archives</div><div>${profile.retrainEntries.length + profile.graduatedEntries.length} attempts archived (${profile.retrainEntries.length} retrain, ${profile.graduatedEntries.length} graduated)</div></div>
            </div>
            <div class="studio-inline-actions">
                <button class="studio-btn primary" onclick="App.openWorkspaceUserEditor('${selectedSafe}')"><i class="fas fa-user-pen"></i> Edit Login Profile</button>
                ${profile.isRevoked
                    ? `<button class="studio-btn secondary" onclick="App.setWorkspaceRevoked('${selectedSafe}', false)"><i class="fas fa-user-check"></i> Remove From Revoked</button>`
                    : `<button class="studio-btn danger" onclick="App.setWorkspaceRevoked('${selectedSafe}', true)"><i class="fas fa-user-slash"></i> Add To Revoked</button>`}
                ${profile.activeUser?.boundClientId ? `<button class="studio-btn secondary" onclick="App.clearWorkspaceBinding('${selectedSafe}')"><i class="fas fa-unlink"></i> Clear Client Binding</button>` : ''}
                <button class="studio-btn secondary" onclick="App.archiveWorkspaceAttempt('${selectedSafe}', false)"><i class="fas fa-box-archive"></i> Archive Live Rows</button>
                <button class="studio-btn danger" onclick="App.archiveWorkspaceAttempt('${selectedSafe}', true)"><i class="fas fa-rotate-left"></i> Archive + Reset Live Rows</button>
            </div>
        `;

        const liveRows = `
            <div class="studio-grid cards">
                <article class="studio-card" style="grid-column: 1 / -1;">
                    <h3 class="studio-card-title">Move Rows Like Folder Items</h3>
                    <div class="studio-card-meta">Pick which live buckets to move into an archived attempt, then apply with one click.</div>
                    <div class="studio-chip-row">
                        <label class="studio-chip"><input type="checkbox" id="wsMoveRecords" checked> Records</label>
                        <label class="studio-chip"><input type="checkbox" id="wsMoveSubmissions" checked> Submissions</label>
                        <label class="studio-chip"><input type="checkbox" id="wsMoveLiveBookings" checked> Live Bookings</label>
                        <label class="studio-chip"><input type="checkbox" id="wsMoveAttendance" checked> Attendance</label>
                        <label class="studio-chip"><input type="checkbox" id="wsMoveReports" checked> Reports</label>
                        <label class="studio-chip"><input type="checkbox" id="wsMoveReviews" checked> Reviews</label>
                        <label class="studio-chip"><input type="checkbox" id="wsMoveNotes" checked> Notes</label>
                    </div>
                    <div class="studio-card-actions">
                        <button class="studio-mini-btn" onclick="App.archiveWorkspaceFromPicker('${selectedSafe}', false)"><i class="fas fa-box-archive"></i> Archive Selected (Keep Live)</button>
                        <button class="studio-mini-btn danger" onclick="App.archiveWorkspaceFromPicker('${selectedSafe}', true)"><i class="fas fa-folder-minus"></i> Move Selected (Remove Live)</button>
                    </div>
                </article>
                <article class="studio-card">
                    <h3 class="studio-card-title">Assessments / Vetting Records</h3>
                    <div class="studio-card-meta">${profile.records.length} rows</div>
                    <div class="studio-card-actions">${profile.records.slice(0, 8).map(row => `<button class="studio-mini-btn" onclick="App.openRowEditor('records','${StudioUI.escapeHtml(String(row.id || ''))}')">${StudioUI.escapeHtml(row.assessment || row.phase || row.id || 'Record')}</button>`).join('') || '<span class="studio-mini-note">No active records.</span>'}</div>
                </article>
                <article class="studio-card">
                    <h3 class="studio-card-title">Submissions</h3>
                    <div class="studio-card-meta">${profile.submissions.length} rows</div>
                    <div class="studio-card-actions">${profile.submissions.slice(0, 8).map(row => `<button class="studio-mini-btn" onclick="App.openRowEditor('submissions','${StudioUI.escapeHtml(String(row.id || ''))}')">${StudioUI.escapeHtml(row.testTitle || row.assessment || row.id || 'Submission')}</button>`).join('') || '<span class="studio-mini-note">No active submissions.</span>'}</div>
                </article>
                <article class="studio-card">
                    <h3 class="studio-card-title">Live Assessments</h3>
                    <div class="studio-card-meta">${profile.liveBookings.length} bookings</div>
                    <div class="studio-card-actions">${profile.liveBookings.slice(0, 8).map(row => `<button class="studio-mini-btn" onclick="App.openRowEditor('live_bookings','${StudioUI.escapeHtml(String(row.id || ''))}')">${StudioUI.escapeHtml(row.assessment || row.date || row.id || 'Booking')}</button>`).join('') || '<span class="studio-mini-note">No active live bookings.</span>'}</div>
                </article>
                <article class="studio-card">
                    <h3 class="studio-card-title">Attendance</h3>
                    <div class="studio-card-meta">${profile.attendance.length} rows</div>
                    <div class="studio-card-actions">${profile.attendance.slice(0, 8).map(row => `<button class="studio-mini-btn" onclick="App.openRowEditor('attendance','${StudioUI.escapeHtml(String(row.id || ''))}')">${StudioUI.escapeHtml(row.date || row.id || 'Attendance')}</button>`).join('') || '<span class="studio-mini-note">No active attendance rows.</span>'}</div>
                </article>
                <article class="studio-card">
                    <h3 class="studio-card-title">Saved Reports</h3>
                    <div class="studio-card-meta">${profile.savedReports.length} rows</div>
                    <div class="studio-card-actions">${profile.savedReports.slice(0, 8).map(row => `<button class="studio-mini-btn" onclick="App.openRowEditor('saved_reports','${StudioUI.escapeHtml(String(row.id || ''))}')">${StudioUI.escapeHtml(row.id || row.title || 'Report')}</button>`).join('') || '<span class="studio-mini-note">No active reports.</span>'}</div>
                </article>
                <article class="studio-card">
                    <h3 class="studio-card-title">Insight Reviews</h3>
                    <div class="studio-card-meta">${profile.insightReviews.length} rows</div>
                    <div class="studio-card-actions">${profile.insightReviews.slice(0, 8).map(row => `<button class="studio-mini-btn" onclick="App.openRowEditor('insight_reviews','${StudioUI.escapeHtml(String(row.id || ''))}')">${StudioUI.escapeHtml(row.status || row.id || 'Review')}</button>`).join('') || '<span class="studio-mini-note">No active reviews.</span>'}</div>
                </article>
            </div>
        `;

        const archivedTimeline = profile.attempts
            .filter(attempt => attempt.type !== 'active')
            .slice()
            .sort((a, b) => (Date.parse(a.date || 0) || 0) - (Date.parse(b.date || 0) || 0));
        const currentAttempt = profile.attempts.find(attempt => attempt.type === 'active') || null;
        const timeline = [
            ...archivedTimeline.map((attempt, index) => ({ ...attempt, timelineLabel: `Attempt ${index + 1} (Archived)` })),
            ...(currentAttempt ? [{ ...currentAttempt, timelineLabel: `Attempt ${archivedTimeline.length + 1} (Current Live)` }] : [])
        ];

        const attemptsHtml = timeline.length === 0
            ? '<div class="studio-empty">No active or archived attempts found yet for this user.</div>'
            : `<div class="studio-grid cards">
                ${timeline.map(attempt => `
                    <article class="studio-card">
                        <h3 class="studio-card-title">${StudioUI.escapeHtml(attempt.timelineLabel)}</h3>
                        <div class="studio-card-meta">${StudioUI.escapeHtml(attempt.label)} - ${StudioUI.escapeHtml(attempt.date ? StudioUI.formatDate(attempt.date) : 'No date')} - ${StudioUI.escapeHtml(attempt.group || 'No group')}</div>
                        <div class="studio-chip-row">
                            <span class="studio-chip">${attempt.records.length} records</span>
                            <span class="studio-chip">${attempt.submissions.length} submissions</span>
                            <span class="studio-chip">${attempt.liveBookings.length} live</span>
                            <span class="studio-chip">${attempt.attendance.length} attendance</span>
                            <span class="studio-chip">${(attempt.reports || []).length} reports</span>
                            <span class="studio-chip">${(attempt.reviews || []).length} reviews</span>
                        </div>
                        ${attempt.sourceId ? `<div class="studio-card-actions"><button class="studio-mini-btn" onclick="App.openArchiveAttemptEditor('${attempt.sourceId}', ${attempt.sourceIndex})"><i class="fas fa-box-open"></i> Open Archive Payload</button></div>` : ''}
                    </article>
                `).join('')}
            </div>`;

        return `
            ${StudioUI.renderSection('User Data Control', 'Pull one user into one workspace and move live rows to archive attempts with one click (folder-style housekeeping).', selectorHtml + '<div style="height:12px;"></div>' + activeSummary)}
            ${StudioUI.renderSection('Live Rows (Editable)', 'These are the current live table rows for this user. Open any item to edit or delete directly in Supabase.', liveRows)}
            ${StudioUI.renderSection('Attempt Timeline', 'Each retrain/graduation archive payload is listed separately so first and second training cycles stay visible and auditable.', attemptsHtml)}
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

    selectWorkspaceUser(value) {
        this.state.workspaceUser = String(value || '').trim();
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

    openWorkspaceUserEditor(username) {
        const rows = StudioData.getRows('users');
        const userRow = rows.find(row => this.identitiesMatch(row && (row.user || row.username), username));
        if (!userRow) {
            alert("This user does not currently have a live login profile in the users document.");
            return;
        }

        const rowKey = userRow.user || userRow.username;
        this.openJsonModal({
            title: `Edit Login Profile - ${rowKey}`,
            helpText: 'Update role, profile fields, client binding, or revoke flags on this live user record.',
            initialValue: userRow,
            async onSave(parsed) {
                const nextUser = { ...parsed };
                if (!nextUser.user && nextUser.username) nextUser.user = nextUser.username;
                if (!nextUser.user) throw new Error('User profile must include a "user" value.');
                await StudioData.saveBlobArrayItem('users', nextUser, rowKey);
            }
        });
    },

    async setWorkspaceRevoked(username, shouldRevoke) {
        const target = String(username || '').trim();
        if (!target) return;
        const activeRows = StudioData.getRows('users');
        const activeRow = activeRows.find(row => this.identitiesMatch(row && (row.user || row.username), target));
        const canonicalTarget = (activeRow && (activeRow.user || activeRow.username)) ? String(activeRow.user || activeRow.username) : target;

        const revokedDoc = StudioData.getDocument('revokedUsers');
        const revokedList = Array.isArray(revokedDoc) ? revokedDoc : [];
        const getEntryName = entry => {
            if (entry && typeof entry === 'object') return entry.user || entry.username || entry.name || '';
            return entry;
        };

        let nextRevoked;
        if (shouldRevoke) {
            const exists = revokedList.some(entry => this.identitiesMatch(getEntryName(entry), canonicalTarget));
            if (exists) return;
            nextRevoked = [...revokedList, canonicalTarget];
        } else {
            nextRevoked = revokedList.filter(entry => !this.identitiesMatch(getEntryName(entry), canonicalTarget));
            if (nextRevoked.length === revokedList.length) return;
        }

        try {
            await StudioData.updateDocument('revokedUsers', nextRevoked);
            this.render();
        } catch (error) {
            alert(error.message || String(error));
        }
    },

    async clearWorkspaceBinding(username) {
        const users = StudioData.getRows('users');
        const idx = users.findIndex(row => this.identitiesMatch(row && (row.user || row.username), username));
        if (idx < 0) {
            alert("Live user profile not found.");
            return;
        }

        const row = { ...users[idx] };
        if (!Object.prototype.hasOwnProperty.call(row, 'boundClientId')) {
            alert("This user has no client binding to clear.");
            return;
        }

        delete row.boundClientId;
        if (!row.user && row.username) row.user = row.username;
        const originalKey = users[idx].user || users[idx].username;

        try {
            await StudioData.saveBlobArrayItem('users', row, originalKey);
            this.render();
        } catch (error) {
            alert(error.message || String(error));
        }
    },

    async removeWorkspaceRowsByUser(sourceId, username, fields) {
        const source = StudioData.sourceCatalog[sourceId];
        if (!source || source.type !== 'row' || !source.keyField) return 0;

        const rows = StudioData.getRows(sourceId);
        const matches = this.getRowsForUser(rows, username, fields);
        if (!matches.length) return 0;

        const seen = new Set();
        const ids = [];
        matches.forEach(row => {
            const rowId = row[source.keyField];
            if (rowId === undefined || rowId === null || rowId === '') return;
            const key = String(rowId);
            if (seen.has(key)) return;
            seen.add(key);
            ids.push(rowId);
        });
        if (!ids.length) return 0;

        const { error } = await AppContext.supabase.from(source.table).delete().in(source.keyField, ids);
        if (error) throw new Error(error.message || `Failed to clear ${source.label}`);
        return ids.length;
    },

    async clearWorkspaceNotes(username) {
        const notesDoc = StudioData.getAllDocuments().find(doc => doc.key === 'agentNotes' || doc.key === 'agent_notes');
        if (!notesDoc || !notesDoc.content || typeof notesDoc.content !== 'object' || Array.isArray(notesDoc.content)) return 0;

        const nextNotes = { ...notesDoc.content };
        let removed = 0;
        Object.keys(nextNotes).forEach(key => {
            if (!this.identitiesMatch(key, username)) return;
            delete nextNotes[key];
            removed += 1;
        });

        if (!removed) return 0;
        await StudioData.updateDocument(notesDoc.key, nextNotes);
        return removed;
    },

    getWorkspaceMoveSelection() {
        const isChecked = id => {
            const el = document.getElementById(id);
            return !!(el && el.checked);
        };

        return {
            records: isChecked('wsMoveRecords'),
            submissions: isChecked('wsMoveSubmissions'),
            liveBookings: isChecked('wsMoveLiveBookings'),
            attendance: isChecked('wsMoveAttendance'),
            reports: isChecked('wsMoveReports'),
            reviews: isChecked('wsMoveReviews'),
            notes: isChecked('wsMoveNotes')
        };
    },

    archiveWorkspaceFromPicker(username, clearLiveRows = false) {
        const include = this.getWorkspaceMoveSelection();
        return this.archiveWorkspaceAttempt(username, clearLiveRows, include);
    },

    async archiveWorkspaceAttempt(username, clearLiveRows = false, include = null) {
        const selectedUser = String(username || '').trim();
        if (!selectedUser) return;

        const snapshot = this.buildSnapshot();
        const profile = this.buildWorkspaceProfile(snapshot, selectedUser);
        if (!profile) {
            alert("User profile is not available. Refresh and try again.");
            return;
        }

        const includeMap = {
            records: include ? !!include.records : true,
            submissions: include ? !!include.submissions : true,
            liveBookings: include ? !!include.liveBookings : true,
            attendance: include ? !!include.attendance : true,
            reports: include ? !!include.reports : true,
            reviews: include ? !!include.reviews : true,
            notes: include ? !!include.notes : true
        };
        const selectedRows = {
            records: includeMap.records ? profile.records : [],
            submissions: includeMap.submissions ? profile.submissions : [],
            liveBookings: includeMap.liveBookings ? profile.liveBookings : [],
            attendance: includeMap.attendance ? profile.attendance : [],
            reports: includeMap.reports ? profile.savedReports : [],
            reviews: includeMap.reviews ? profile.insightReviews : []
        };
        const totalRows = Object.values(selectedRows).reduce((sum, rows) => sum + rows.length, 0);
        const selectedBucketCount = Object.values(includeMap).filter(Boolean).length;

        if (totalRows === 0) {
            alert(selectedBucketCount === 0
                ? "Choose at least one bucket to move."
                : "No live rows found in the selected buckets.");
            return;
        }

        const actionText = clearLiveRows ? 'archive and reset' : 'archive';
        const confirmText = [
            `Archive current live rows for ${profile.username}?`,
            '',
            `This will ${actionText}:`,
            `- ${selectedRows.records.length} records`,
            `- ${selectedRows.submissions.length} submissions`,
            `- ${selectedRows.liveBookings.length} live bookings`,
            `- ${selectedRows.attendance.length} attendance rows`,
            `- ${selectedRows.reports.length} reports`,
            `- ${selectedRows.reviews.length} reviews`,
            includeMap.notes ? '- notes (if found)' : '- notes (not selected)',
            '',
            clearLiveRows
                ? 'After archiving, these live rows are removed so the new attempt starts clean.'
                : 'Live rows will stay in place (snapshot only).'
        ].join('\n');

        if (!confirm(confirmText)) return;

        const actor = AppContext.user?.user || 'super_admin';
        const canonicalUser = profile.activeUser?.user || profile.activeUser?.username || profile.username;
        const notesDoc = StudioData.getAllDocuments().find(doc => doc.key === 'agentNotes' || doc.key === 'agent_notes');
        let archivedNotes = null;
        if (includeMap.notes && notesDoc && notesDoc.content && typeof notesDoc.content === 'object' && !Array.isArray(notesDoc.content)) {
            const noteKey = Object.keys(notesDoc.content).find(key => this.identitiesMatch(key, canonicalUser));
            if (noteKey) archivedNotes = StudioData.clone(notesDoc.content[noteKey]);
        }

        const archiveEntry = {
            id: `manual_retrain_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            user: canonicalUser,
            movedDate: new Date().toISOString(),
            archiveType: 'retrain',
            reason: clearLiveRows
                ? `Manual archive + reset by ${actor} in Data Studio`
                : `Manual live snapshot by ${actor} in Data Studio`,
            targetGroup: profile.rosterGroups[0] || '',
            records: StudioData.clone(selectedRows.records),
            submissions: StudioData.clone(selectedRows.submissions),
            liveBookings: StudioData.clone(selectedRows.liveBookings),
            attendance: StudioData.clone(selectedRows.attendance),
            reports: StudioData.clone(selectedRows.reports),
            reviews: StudioData.clone(selectedRows.reviews),
            notes: archivedNotes
        };

        try {
            const archives = StudioData.getRows('retrain_archives');
            archives.push(archiveEntry);
            await StudioData.updateDocument('retrain_archives', archives);

            let clearSummary = null;
            if (clearLiveRows) {
                clearSummary = { records: 0, submissions: 0, liveBookings: 0, attendance: 0, reports: 0, reviews: 0 };
                if (includeMap.records) clearSummary.records = await this.removeWorkspaceRowsByUser('records', canonicalUser, ['trainee', 'user', 'user_id']);
                if (includeMap.submissions) clearSummary.submissions = await this.removeWorkspaceRowsByUser('submissions', canonicalUser, ['trainee', 'user', 'user_id']);
                if (includeMap.liveBookings) clearSummary.liveBookings = await this.removeWorkspaceRowsByUser('live_bookings', canonicalUser, ['trainee', 'user', 'user_id']);
                if (includeMap.attendance) clearSummary.attendance = await this.removeWorkspaceRowsByUser('attendance', canonicalUser, ['user', 'user_id', 'trainee']);
                if (includeMap.reports) clearSummary.reports = await this.removeWorkspaceRowsByUser('saved_reports', canonicalUser, ['trainee', 'user', 'user_id']);
                if (includeMap.reviews) clearSummary.reviews = await this.removeWorkspaceRowsByUser('insight_reviews', canonicalUser, ['trainee', 'user', 'user_id']);

                const removedNotes = includeMap.notes ? await this.clearWorkspaceNotes(canonicalUser) : 0;
                if (!removedNotes) {
                    await StudioData.loadAll('workspace_rollover');
                }
                this.render();
                alert([
                    `Archived and reset ${canonicalUser}.`,
                    '',
                    `Moved to archive: ${totalRows} live rows`,
                    `Cleared from live tables: ${Object.values(clearSummary).reduce((sum, value) => sum + Number(value || 0), 0)} rows`
                ].join('\n'));
                return;
            }

            this.render();
            alert(`Archived snapshot created for ${canonicalUser}. Live rows stayed active.`);
        } catch (error) {
            alert(error.message || String(error));
        }
    },

    openArchiveAttemptEditor(sourceId, sourceIndex) {
        const source = StudioData.sourceCatalog[sourceId];
        const index = Number(sourceIndex);
        if (!source || source.type !== 'blob_array') {
            alert("This archive source cannot be edited from this control.");
            return;
        }

        const rows = StudioData.getRows(sourceId);
        if (!Number.isInteger(index) || index < 0 || index >= rows.length) {
            alert("Archive entry no longer exists at this index. Refresh and try again.");
            return;
        }

        this.openJsonModal({
            title: `Edit Archive Payload - ${source.label}`,
            helpText: 'You are editing one archived attempt payload. This save replaces the exact archive item by source index.',
            initialValue: rows[index],
            async onSave(parsed) {
                const latestRows = StudioData.getRows(sourceId);
                if (index < 0 || index >= latestRows.length) {
                    throw new Error("Archive item moved or was removed. Refresh and retry.");
                }
                latestRows[index] = parsed;
                await StudioData.updateDocument(source.docKey, latestRows);
            }
        });
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

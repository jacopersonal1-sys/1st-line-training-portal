const StudioUI = {
    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    formatDate(value) {
        if (!value) return 'Unknown';
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return String(value);
        return parsed.toLocaleString();
    },

    formatRelative(value) {
        if (!value) return 'Never';
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return String(value);
        const diffMs = Date.now() - parsed.getTime();
        const diffMin = Math.round(diffMs / 60000);
        if (Math.abs(diffMin) < 1) return 'just now';
        if (Math.abs(diffMin) < 60) return `${diffMin} min ago`;
        const diffHr = Math.round(diffMin / 60);
        if (Math.abs(diffHr) < 24) return `${diffHr} hr ago`;
        const diffDay = Math.round(diffHr / 24);
        return `${diffDay} day${Math.abs(diffDay) === 1 ? '' : 's'} ago`;
    },

    matchesSearch(value, searchTerm) {
        if (!searchTerm) return true;
        return JSON.stringify(value || {}).toLowerCase().includes(searchTerm.toLowerCase());
    },

    roleChip(role) {
        const safeRole = this.escapeHtml(role || 'unknown');
        return `<span class="studio-chip role-${safeRole.replace(/[^a-z0-9_-]/gi, '_')}">${safeRole}</span>`;
    },

    genericChip(label, tone = 'muted') {
        return `<span class="studio-chip ${tone}">${this.escapeHtml(label)}</span>`;
    },

    renderMetrics(cards) {
        return `
            <div class="studio-grid metrics">
                ${cards.map(card => `
                    <div class="studio-metric">
                        <div class="studio-metric-label">${this.escapeHtml(card.label)}</div>
                        <div class="studio-metric-value">${this.escapeHtml(card.value)}</div>
                        ${card.note ? `<div class="studio-mini-note">${this.escapeHtml(card.note)}</div>` : ''}
                    </div>
                `).join('')}
            </div>
        `;
    },

    renderSection(title, note, body, actionsHtml = '') {
        return `
            <section class="studio-panel">
                <div class="studio-section-head">
                    <div>
                        <h2 class="studio-section-title">${this.escapeHtml(title)}</h2>
                        ${note ? `<p class="studio-section-note">${this.escapeHtml(note)}</p>` : ''}
                    </div>
                    ${actionsHtml || ''}
                </div>
                ${body}
            </section>
        `;
    },

    renderUsers(users, searchTerm) {
        const filtered = users.filter(user => this.matchesSearch(user, searchTerm));
        if (!filtered.length) return '<div class="studio-empty">No matching users in the live cache.</div>';

        return `
            <div class="studio-grid cards">
                ${filtered.map(user => {
                    const theme = user.theme && user.theme.primaryColor ? user.theme.primaryColor : null;
                    return `
                        <article class="studio-card">
                            <h3 class="studio-card-title">${this.escapeHtml(user.user || 'Unnamed User')}</h3>
                            <div class="studio-card-meta">${this.escapeHtml(user.email || 'No email stored')}</div>
                            <div class="studio-chip-row">
                                ${this.roleChip(user.role)}
                                ${user.pass ? this.genericChip('Password set', 'good') : this.genericChip('No password', 'warn')}
                                ${theme ? `<span class="studio-chip" style="border-color:${this.escapeHtml(theme)}; box-shadow: inset 0 0 0 1px ${this.escapeHtml(theme)};">${this.escapeHtml(theme)}</span>` : ''}
                            </div>
                            <div class="studio-card-actions">
                                <button class="studio-mini-btn" onclick="App.openBlobArrayEditor('users', '${this.escapeHtml(String(user.user || ''))}')"><i class="fas fa-pen"></i> Edit</button>
                                <button class="studio-mini-btn danger" onclick="App.deleteBlobArrayItem('users', '${this.escapeHtml(String(user.user || ''))}')"><i class="fas fa-trash"></i> Delete</button>
                            </div>
                        </article>
                    `;
                }).join('')}
            </div>
        `;
    },

    renderRosters(rosters, searchTerm) {
        const entries = Object.entries(rosters || {}).filter(([name, members]) => this.matchesSearch({ name, members }, searchTerm));
        if (!entries.length) return '<div class="studio-empty">No groups matched the current search.</div>';

        return `
            <div class="studio-grid cards">
                ${entries.map(([groupName, members]) => `
                    <article class="studio-card">
                        <h3 class="studio-card-title">${this.escapeHtml(groupName)}</h3>
                        <div class="studio-card-meta">${Array.isArray(members) ? members.length : 0} agents in this group</div>
                        <div class="studio-chip-row">
                            ${(Array.isArray(members) ? members : []).slice(0, 10).map(member => this.genericChip(member)).join('')}
                            ${(Array.isArray(members) && members.length > 10) ? this.genericChip(`+${members.length - 10} more`, 'warn') : ''}
                        </div>
                        <div class="studio-card-actions">
                            <button class="studio-mini-btn" onclick="App.openRosterEditor('${this.escapeHtml(groupName)}')"><i class="fas fa-pen"></i> Edit</button>
                            <button class="studio-mini-btn danger" onclick="App.deleteRoster('${this.escapeHtml(groupName)}')"><i class="fas fa-trash"></i> Delete</button>
                        </div>
                    </article>
                `).join('')}
            </div>
        `;
    },

    renderTests(tests, searchTerm) {
        const filtered = tests.filter(test => this.matchesSearch(test, searchTerm));
        if (!filtered.length) return '<div class="studio-empty">No assessment definitions matched the current search.</div>';

        return `
            <div class="studio-grid cards">
                ${filtered.map(test => {
                    const questionCount = Array.isArray(test.questions) ? test.questions.length : 0;
                    return `
                        <article class="studio-card">
                            <h3 class="studio-card-title">${this.escapeHtml(test.title || test.name || `Assessment ${test.id || ''}`)}</h3>
                            <div class="studio-card-meta">ID: ${this.escapeHtml(test.id || 'Unknown')} | ${questionCount} questions</div>
                            <div class="studio-chip-row">
                                ${test.isVetting ? this.genericChip('Vetting', 'warn') : ''}
                                ${test.isLive ? this.genericChip('Live', 'good') : ''}
                                ${test.duration ? this.genericChip(`${test.duration} min`) : ''}
                            </div>
                            <div class="studio-card-actions">
                                <button class="studio-mini-btn" onclick="App.openBlobArrayEditor('tests', '${this.escapeHtml(String(test.id || ''))}')"><i class="fas fa-pen"></i> Edit</button>
                                <button class="studio-mini-btn danger" onclick="App.deleteBlobArrayItem('tests', '${this.escapeHtml(String(test.id || ''))}')"><i class="fas fa-trash"></i> Delete</button>
                            </div>
                        </article>
                    `;
                }).join('')}
            </div>
        `;
    },

    describeRow(sourceId, row) {
        if (sourceId === 'records') {
            return {
                title: `${row.trainee || 'Unknown trainee'} · ${row.assessment || 'Assessment'}`,
                meta: `${row.score ?? '-'}% · ${row.phase || 'Phase not set'} · ${row.status || 'No status'}`,
                chips: [row.group, row.date].filter(Boolean)
            };
        }

        if (sourceId === 'submissions') {
            return {
                title: `${row.trainee || row.user || 'Unknown'} · ${row.testName || row.assessment || 'Submission'}`,
                meta: `${row.status || 'No status'} · ${row.submitted_at || row.date || 'No date'}`,
                chips: [row.group, row.phase].filter(Boolean)
            };
        }

        if (sourceId === 'live_bookings') {
            return {
                title: `${row.trainee || 'Unknown trainee'} · ${row.assessment || 'Booking'}`,
                meta: `${row.status || 'No status'} · ${row.date || row.slot_date || 'No date set'}`,
                chips: [row.time, row.trainer].filter(Boolean)
            };
        }

        if (sourceId === 'attendance') {
            return {
                title: row.user || row.trainee || 'Attendance Entry',
                meta: `${row.date || 'No day'} · ${row.clock_in || 'No clock in'}${row.clock_out ? ` to ${row.clock_out}` : ''}`,
                chips: [row.group, row.status, row.lateReason ? 'Late reason captured' : null].filter(Boolean)
            };
        }

        if (sourceId === 'error_reports') {
            return {
                title: row.user || row.username || 'Client Error',
                meta: String(row.error || row.message || 'No message').slice(0, 120),
                chips: [row.level, row.date, row.client_id].filter(Boolean)
            };
        }

        if (sourceId === 'access_logs') {
            return {
                title: row.user || row.username || 'Access Log',
                meta: `${row.event || 'Unknown event'} · ${row.time || row.created_at || row.date || 'No timestamp'}`,
                chips: [row.role, row.ip].filter(Boolean)
            };
        }

        if (sourceId === 'live_sessions') {
            return {
                title: row.assessment || row.testName || row.id || 'Live Session',
                meta: `${row.status || 'No status'} · ${row.group || row.targetGroup || 'No group'}`,
                chips: [row.active ? 'Active' : 'Inactive', row.host || row.trainer].filter(Boolean)
            };
        }

        if (sourceId === 'network_diagnostics') {
            return {
                title: row.user || row.username || row.client_id || 'Network Diagnostic',
                meta: `${row.status || row.summary || 'No summary'} · ${row.created_at || row.time || row.date || 'No timestamp'}`,
                chips: [row.gateway_status, row.internet_status].filter(Boolean)
            };
        }

        if (sourceId === 'calendar_events') {
            return {
                title: row.title || 'Calendar Event',
                meta: `${row.date || 'No date'} · ${row.visibility || row.vis || 'Visibility not set'}`,
                chips: [row.target_group, row.target_user].filter(Boolean)
            };
        }

        if (sourceId === 'archived_users') {
            return {
                title: row.user || row.username || row.name || 'Archived User',
                meta: `${row.group || 'No group'} · ${row.graduated_date || row.archived_at || 'No archive date'}`,
                chips: [row.role, row.reason].filter(Boolean)
            };
        }

        return {
            title: row.title || row.name || row.user || row.username || row.id || 'Data Row',
            meta: row.updated_at || row.created_at || row.date || row.status || 'No summary available',
            chips: Object.entries(row || {})
                .slice(0, 3)
                .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
                .map(([key, value]) => `${key}: ${value}`)
        };
    },

    renderRowCards(sourceId, rows, searchTerm, limit = 12) {
        const filtered = rows.filter(row => this.matchesSearch(row, searchTerm)).slice(0, limit);
        if (!filtered.length) return '<div class="studio-empty">No live rows matched the current search.</div>';

        return `
            <div class="studio-grid cards">
                ${filtered.map(row => {
                    const desc = this.describeRow(sourceId, row);
                    const rowKey = row.id ?? '';
                    return `
                        <article class="studio-card">
                            <h3 class="studio-card-title">${this.escapeHtml(desc.title)}</h3>
                            <div class="studio-card-meta">${this.escapeHtml(desc.meta)}</div>
                            <div class="studio-chip-row">
                                ${(desc.chips || []).map(chip => this.genericChip(chip)).join('')}
                            </div>
                            <div class="studio-card-actions">
                                <button class="studio-mini-btn" onclick="App.openRowEditor('${this.escapeHtml(sourceId)}', '${this.escapeHtml(String(rowKey))}')"><i class="fas fa-pen"></i> Edit</button>
                                ${rowKey !== '' ? `<button class="studio-mini-btn danger" onclick="App.deleteRow('${this.escapeHtml(sourceId)}', '${this.escapeHtml(String(rowKey))}')"><i class="fas fa-trash"></i> Delete</button>` : ''}
                            </div>
                        </article>
                    `;
                }).join('')}
            </div>
        `;
    },

    renderConfig(config) {
        const entries = Object.entries(config || {});
        if (!entries.length) return '<div class="studio-empty">`system_config` is empty in the live document store.</div>';

        return `
            <div class="studio-kv">
                ${entries.slice(0, 12).map(([key, value]) => `
                    <div class="studio-kv-card">
                        <div class="studio-kv-label">${this.escapeHtml(key)}</div>
                        <div>${this.escapeHtml(typeof value === 'object' ? JSON.stringify(value).slice(0, 120) : String(value))}</div>
                    </div>
                `).join('')}
            </div>
        `;
    },

    renderDocuments(documents, searchTerm) {
        const filtered = documents.filter(doc => this.matchesSearch(doc, searchTerm));
        if (!filtered.length) return '<div class="studio-empty">No app documents matched the current search.</div>';

        return `
            <div class="studio-grid cards">
                ${filtered.map(doc => `
                    <article class="studio-card">
                        <h3 class="studio-card-title">${this.escapeHtml(doc.key)}</h3>
                        <div class="studio-card-meta">Updated ${this.escapeHtml(this.formatRelative(doc.updated_at))}</div>
                        <div class="studio-code-preview">${this.escapeHtml(JSON.stringify(doc.content, null, 2).slice(0, 700))}</div>
                        <div class="studio-card-actions">
                            <button class="studio-mini-btn" onclick="App.openDocumentEditor('${this.escapeHtml(doc.key)}')"><i class="fas fa-pen"></i> Edit Document</button>
                        </div>
                    </article>
                `).join('')}
            </div>
        `;
    }
};

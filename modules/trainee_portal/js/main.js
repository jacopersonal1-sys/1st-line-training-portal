const TraineePortalApp = {
    refreshTimer: null,
    _boundHostDataListener: null,
    qaComposerOpen: false,
    editMode: false,
    dragWidgetId: null,
    currentLayout: [],
    currentUserName: '',
    defaultLayout: [
        { id: 'up_next', col: 4, row: 1 },
        { id: 'today_tasks', col: 4, row: 2 },
        { id: 'live_bookings', col: 4, row: 2 },
        { id: 'badges', col: 4, row: 2 },
        { id: 'attendance', col: 3, row: 1 },
        { id: 'training_rules', col: 3, row: 1 },
        { id: 'qa_help', col: 6, row: 2 },
        { id: 'available_now', col: 3, row: 1 },
        { id: 'notes_clarity', col: 3, row: 1 },
        { id: 'recent_results', col: 6, row: 2 },
        { id: 'daily_tip', col: 6, row: 1 }
    ],

    init() {
        const container = document.getElementById('app-container');
        if (!container) return;
        container.innerHTML = `
            <div class="portal-card" style="text-align:center;">
                <i class="fas fa-circle-notch fa-spin" style="font-size:1.8rem; color:var(--primary);"></i>
                <p class="portal-subtitle" style="margin-top:10px;">Loading trainee portal...</p>
            </div>
        `;
        this.bindHostListeners();
        this.render();
    },

    getHost() {
        return AppContext.host || window;
    },

    getCurrentUser() {
        const host = this.getHost();
        return host.CURRENT_USER || AppContext.user || null;
    },

    identitiesMatch(a, b) {
        const host = this.getHost();
        if (host && typeof host.identitiesMatch === 'function') {
            return host.identitiesMatch(a, b);
        }
        return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    },

    esc(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    readStorage(key, fallback) {
        try {
            const host = this.getHost();
            const raw = (host.localStorage || localStorage).getItem(key);
            if (!raw) return fallback;
            const parsed = JSON.parse(raw);
            return parsed == null ? fallback : parsed;
        } catch (error) {
            return fallback;
        }
    },

    writeStorage(key, value) {
        try {
            const host = this.getHost();
            (host.localStorage || localStorage).setItem(key, JSON.stringify(value));
        } catch (error) {
            console.warn('[Trainee Portal] Layout save failed:', error);
        }
    },

    readArray(key) {
        const val = this.readStorage(key, []);
        return Array.isArray(val) ? val : [];
    },

    readObject(key) {
        const val = this.readStorage(key, {});
        return val && typeof val === 'object' ? val : {};
    },

    toIsoDate(dateString) {
        const raw = String(dateString || '').trim();
        if (!raw) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
        const parts = raw.split('/');
        if (parts.length === 3) {
            const yyyy = parts[0];
            const mm = String(parts[1] || '').padStart(2, '0');
            const dd = String(parts[2] || '').padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        }
        return '';
    },

    todayIso() {
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    },

    parseScheduleRange(rangeRaw) {
        const raw = String(rangeRaw || '').trim();
        if (!raw || raw.toLowerCase() === 'always available') return null;
        if (raw.includes('-')) {
            const parts = raw.split('-').map((v) => this.toIsoDate(v));
            if (parts.length === 2 && parts[0] && parts[1]) {
                return { start: parts[0], end: parts[1] };
            }
            return null;
        }
        const one = this.toIsoDate(raw);
        if (!one) return null;
        return { start: one, end: one };
    },

    getMyScheduleItems(user) {
        const host = this.getHost();
        const schedules = this.readObject('schedules');
        const userName = String(user || '').trim();
        if (!userName) return [];

        if (host && typeof host.getTraineeScheduleId === 'function') {
            const scheduleId = host.getTraineeScheduleId(userName, schedules);
            if (scheduleId && schedules[scheduleId] && Array.isArray(schedules[scheduleId].items)) {
                return schedules[scheduleId].items;
            }
        }

        for (const key of Object.keys(schedules || {})) {
            const bucket = schedules[key] || {};
            const assigned = Array.isArray(bucket.assigned) ? bucket.assigned : [bucket.assigned];
            const linked = assigned.filter(Boolean).some((entry) => this.identitiesMatch(entry, userName));
            if (linked && Array.isArray(bucket.items)) return bucket.items;
        }

        return [];
    },

    normalizeUserKey(userName) {
        return String(userName || '')
            .trim()
            .toLowerCase()
            .replace(/[^\w]+/g, '_')
            .replace(/^_+|_+$/g, '') || 'unknown';
    },

    getLayoutStorageKey(userName) {
        return `trainee_portal_layout_v2_${this.normalizeUserKey(userName)}`;
    },

    getDefaultLayout() {
        return this.defaultLayout.map(item => ({ ...item }));
    },

    sanitizeLayout(rawLayout) {
        if (!Array.isArray(rawLayout)) return [];
        const validIds = new Set(this.defaultLayout.map(item => item.id));
        const seen = new Set();
        const cleaned = [];

        rawLayout.forEach(item => {
            if (!item || typeof item !== 'object') return;
            const id = String(item.id || '').trim();
            if (!id || !validIds.has(id) || seen.has(id)) return;
            const col = Math.max(2, Math.min(12, Number(item.col) || 3));
            const row = Math.max(1, Math.min(3, Number(item.row) || 1));
            cleaned.push({ id, col, row });
            seen.add(id);
        });

        return cleaned;
    },

    getLayoutForUser(userName) {
        const key = this.getLayoutStorageKey(userName);
        const saved = this.sanitizeLayout(this.readStorage(key, []));
        const defaults = this.getDefaultLayout();

        const used = new Set(saved.map(item => item.id));
        const merged = [...saved];
        defaults.forEach(item => {
            if (!used.has(item.id)) merged.push(item);
        });

        if (merged.length !== saved.length) this.writeStorage(key, merged);
        return merged;
    },

    saveCurrentLayout() {
        if (!this.currentUserName || !Array.isArray(this.currentLayout) || this.currentLayout.length === 0) return;
        this.writeStorage(this.getLayoutStorageKey(this.currentUserName), this.currentLayout);
    },

    resetLayout() {
        if (!this.currentUserName) return;
        this.currentLayout = this.getDefaultLayout();
        this.saveCurrentLayout();
        this.render();
    },

    toggleEditMode() {
        this.editMode = !this.editMode;
        this.render();
    },

    resizeWidget(widgetId, dCol, dRow) {
        const idx = this.currentLayout.findIndex(item => item.id === widgetId);
        if (idx < 0) return;
        const current = this.currentLayout[idx];
        current.col = Math.max(2, Math.min(12, Number(current.col || 3) + Number(dCol || 0)));
        current.row = Math.max(1, Math.min(3, Number(current.row || 1) + Number(dRow || 0)));
        this.currentLayout[idx] = current;
        this.saveCurrentLayout();
        this.render();
    },

    moveWidgetBefore(sourceId, targetId) {
        if (!sourceId || !targetId || sourceId === targetId) return;
        const sourceIndex = this.currentLayout.findIndex(item => item.id === sourceId);
        const targetIndex = this.currentLayout.findIndex(item => item.id === targetId);
        if (sourceIndex < 0 || targetIndex < 0) return;

        const next = [...this.currentLayout];
        const [moved] = next.splice(sourceIndex, 1);
        next.splice(targetIndex, 0, moved);
        this.currentLayout = next;
        this.saveCurrentLayout();
        this.render();
    },

    getTraineeBadges(records, attendance) {
        const safeRecords = Array.isArray(records) ? records : [];
        const safeAttendance = Array.isArray(attendance) ? attendance : [];
        const badges = [];

        const perfectScores = safeRecords.filter(r => Number(r && r.score) === 100).length;
        if (perfectScores >= 1) badges.push({ icon: 'fa-bullseye', title: 'Sharpshooter', desc: 'Scored 100% on a test', type: 'gold' });
        if (perfectScores >= 5) badges.push({ icon: 'fa-crown', title: 'Legend', desc: '5+ perfect scores', type: 'mythic' });

        const passedTests = safeRecords.filter(r => Number(r && r.score) >= 90).length;
        if (passedTests >= 3) badges.push({ icon: 'fa-fire', title: 'On Fire', desc: '3+ distinction passes', type: 'silver' });

        const vettingPassed = safeRecords.some(r => String((r && r.phase) || '').toLowerCase().includes('vetting') && Number(r && r.score) >= 80);
        if (vettingPassed) badges.push({ icon: 'fa-shield-halved', title: 'Guardian', desc: 'Passed a vetting test', type: 'gold' });

        const totalTests = safeRecords.length;
        if (totalTests >= 10) badges.push({ icon: 'fa-book-open-reader', title: 'Scholar', desc: 'Completed 10+ assessments', type: 'bronze' });

        const onTimes = safeAttendance.filter(r => !r || r.isLate !== true).length;
        if (onTimes >= 5) badges.push({ icon: 'fa-clock', title: 'Early Bird', desc: '5 days on time', type: 'bronze' });
        if (onTimes >= 20) badges.push({ icon: 'fa-bolt', title: 'Reliable', desc: '20 days on time', type: 'gold' });

        const lates = safeAttendance.filter(r => !!(r && r.isLate)).length;
        if (lates >= 3) badges.push({ icon: 'fa-person-walking-dashed-line-arrow-right', title: 'Snail', desc: 'Late 3+ times', type: 'shame' });

        const missedClockOuts = safeAttendance.filter(r => !!(r && !r.clockOut)).length;
        if (missedClockOuts >= 3) badges.push({ icon: 'fa-bed', title: 'Zombie', desc: 'Forgot clock-out 3+ times', type: 'shame' });

        return badges;
    },

    buildModel() {
        const currentUser = this.getCurrentUser();
        const userName = String(currentUser?.user || '').trim();
        const userLower = userName.toLowerCase();
        const todayIso = this.todayIso();

        const allItems = this.getMyScheduleItems(userName);
        const timelineItems = allItems
            .map((item) => ({ item, range: this.parseScheduleRange(item?.dateRange) }))
            .filter((row) => !!row.range)
            .sort((a, b) => a.range.start.localeCompare(b.range.start));

        const todayTasks = timelineItems
            .filter((row) => row.range.start <= todayIso && todayIso <= row.range.end)
            .map((row) => row.item);

        let nextItem = null;
        for (const row of timelineItems) {
            if (row.range.end >= todayIso) {
                nextItem = row.item;
                break;
            }
        }

        const records = this.readArray('records')
            .filter((row) => this.identitiesMatch(row?.trainee, userName))
            .sort((a, b) => new Date(b?.date || 0).getTime() - new Date(a?.date || 0).getTime());

        const submissions = this.readArray('submissions')
            .filter((row) => this.identitiesMatch(row?.trainee, userName));

        const availableEntries = submissions.filter((entry) => String(entry?.status || '').toLowerCase() !== 'completed');

        const liveBookings = this.readArray('liveBookings')
            .filter((row) => this.identitiesMatch(row?.trainee, userName))
            .sort((a, b) => {
                const aKey = `${a?.date || ''} ${a?.time || ''}`;
                const bKey = `${b?.date || ''} ${b?.time || ''}`;
                return aKey.localeCompare(bKey);
            });

        const activeLive = this.readArray('liveSessions').find((session) => {
            if (!session || !session.active) return false;
            return this.identitiesMatch(session.trainee, userName);
        }) || null;

        const notes = this.readObject('trainee_notes');
        const noteValue = String(notes[userName] || '').trim();
        const bookmarksByUser = this.readObject('trainee_bookmarks');
        const bookmarks = Array.isArray(bookmarksByUser[userName]) ? bookmarksByUser[userName] : [];

        const tips = this.readArray('dailyTips').map((tip) => String(tip || '').trim()).filter(Boolean);
        const dailyTip = tips.length
            ? tips[Math.abs((new Date().getDate() + userLower.length) % tips.length)]
            : 'Work one topic at a time and capture every unclear point in Study Notes.';

        const attendance = this.readArray('attendance_records')
            .filter((row) => this.identitiesMatch(row?.user, userName));
        const attendanceSorted = [...attendance].sort((a, b) => {
            const ad = String(a?.date || '');
            const bd = String(b?.date || '');
            return bd.localeCompare(ad);
        });
        const attendanceToday = attendanceSorted.find((row) => String(row?.date || '') === todayIso) || null;
        const attendanceRecent = attendanceSorted.slice(0, 30);
        const lateCount = attendanceRecent.filter((row) => !!(row && row.isLate)).length;
        const onTimeCount = attendanceRecent.filter((row) => !!row && row.isLate !== true).length;
        const missedClockOuts = attendanceRecent.filter((row) => !!(row && !row.clockOut)).length;
        const attendancePromptNeeded = !attendanceToday;
        const badges = this.getTraineeBadges(records, attendance);
        const positiveBadgeCount = badges.filter(b => b.type !== 'shame').length;
        const qaData = this.readObject('qa_data');
        const qaQuestions = Array.isArray(qaData.questions)
            ? qaData.questions
                .filter(q => q && !['draft', 'deleted'].includes(String(q.status || 'published')))
                .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
            : [];

        return {
            userName,
            nextItem,
            todayTasks,
            records,
            availableCount: availableEntries.length,
            availableEntries,
            liveBookings: liveBookings.filter((entry) => String(entry?.status || '').toLowerCase() === 'booked'),
            activeLive,
            noteChars: noteValue.length,
            bookmarkCount: bookmarks.length,
            dailyTip,
            attendance,
            attendanceToday,
            attendancePromptNeeded,
            lateCount,
            onTimeCount,
            missedClockOuts,
            badges,
            positiveBadgeCount,
            qaQuestions
        };
    },

    renderRows(items, renderRow, emptyText) {
        if (!Array.isArray(items) || items.length === 0) {
            return `<div class="portal-muted">${this.esc(emptyText)}</div>`;
        }
        return items.map(renderRow).join('');
    },

    getWidgetDefinitions(model) {
        const nextTitle = model.nextItem ? String(model.nextItem.courseName || 'Scheduled Item') : 'All caught up';
        const nextDate = model.nextItem ? String(model.nextItem.dateRange || '') : 'No upcoming scheduled item';
        const liveTarget = model.activeLive ? 'live-execution' : 'live-assessment';
        const liveHint = model.activeLive ? 'Jump back into your active live session.' : 'Open booking and live assessment workspace.';

        const todayTaskRows = this.renderRows(
            model.todayTasks,
            (task) => `
                <div class="portal-row">
                    <span>${this.esc(task?.courseName || 'Task')}</span>
                    <span class="portal-pill">${this.esc(task?.dateRange || '')}</span>
                </div>
            `,
            'No tasks scheduled for today.'
        );

        const liveRows = this.renderRows(
            model.liveBookings.slice(0, 12),
            (booking) => `
                <div class="portal-row">
                    <span>${this.esc(booking?.assessment || 'Live assessment')}</span>
                    <span class="portal-pill">${this.esc(`${booking?.date || ''} ${booking?.time || ''}`.trim())}</span>
                </div>
            `,
            'No upcoming live bookings.'
        );

        const resultRows = this.renderRows(
            model.records,
            (record) => `
                <div class="portal-row">
                    <span>${this.esc(record?.assessment || 'Assessment')}</span>
                    <strong>${Number(record?.score || 0)}%</strong>
                </div>
            `,
            'No results captured yet.'
        );

        const availableRows = this.renderRows(
            model.availableEntries.slice(0, 8),
            (entry) => `
                <div class="portal-row">
                    <span>${this.esc(entry?.testTitle || entry?.testId || 'Assessment')}</span>
                    <span class="portal-pill">${this.esc(String(entry?.status || 'pending'))}</span>
                </div>
            `,
            'No pending assessments right now.'
        );

        const activeLiveBlock = model.activeLive ? `
            <div class="portal-live">
                <strong><i class="fas fa-satellite-dish"></i> Live Session Active</strong>
                <div class="portal-muted" style="margin-top:4px;">You are currently assigned to an active live session.</div>
            </div>
        ` : '';

        const badgeTiles = model.badges && model.badges.length > 0
            ? model.badges.map(b => `
                <div class="portal-badge-tile ${this.esc(b.type)}" title="${this.esc(b.desc || '')}">
                    <div class="portal-badge-icon"><i class="fas ${this.esc(b.icon || 'fa-award')}"></i></div>
                    <div class="portal-badge-title">${this.esc(b.title || 'Badge')}</div>
                </div>
            `).join('')
            : '';

        const badgesBody = badgeTiles
            ? `
                <div class="portal-row">
                    <span>Badges earned</span>
                    <strong>${Number((model.badges || []).length)}</strong>
                </div>
                <div class="portal-row">
                    <span>Positive badges</span>
                    <strong>${Number(model.positiveBadgeCount || 0)}</strong>
                </div>
                <div class="portal-badge-grid">${badgeTiles}</div>
            `
            : `
                <div class="portal-badge-empty">
                    <i class="fas fa-medal"></i>
                    <div>No badges earned yet.</div>
                    <small>Complete tests and keep attendance on track to unlock rewards.</small>
                </div>
            `;
        const qaRows = model.qaQuestions.length
            ? model.qaQuestions.map(q => this.renderQaQuestionRow(q)).join('')
            : '<div class="portal-muted">No Q&A questions have been published yet.</div>';

        return {
            up_next: {
                title: 'Up Next',
                icon: 'fa-hourglass-half',
                nav: 'assessment-schedule',
                hint: 'Open your schedule timeline.',
                className: 'widget-up_next',
                body: `
                    <div style="font-size:1.05rem; font-weight:700; color:var(--primary);">${this.esc(nextTitle)}</div>
                    <div class="portal-muted">${this.esc(nextDate)}</div>
                `
            },
            today_tasks: {
                title: "Today's Tasks",
                icon: 'fa-clipboard-list',
                nav: 'assessment-schedule',
                hint: 'Open full schedule details.',
                className: 'widget-today_tasks',
                body: `<div class="portal-list">${todayTaskRows}</div>`
            },
            live_bookings: {
                title: 'Live Bookings',
                icon: 'fa-calendar-check',
                nav: liveTarget,
                hint: liveHint,
                className: 'widget-live_bookings',
                body: `${activeLiveBlock}<div class="portal-list">${liveRows}</div>`
            },
            badges: {
                title: 'My Badges',
                icon: 'fa-award',
                hint: 'Badge progress updates automatically from your activity.',
                className: 'widget-badges',
                body: badgesBody
            },
            attendance: {
                title: 'Attendance',
                icon: 'fa-user-check',
                hint: 'Quick attendance snapshot for your training day.',
                className: 'widget-attendance',
                body: `
                    <div class="portal-row"><span>Today</span><strong>${model.attendanceToday ? (model.attendanceToday.clockOut ? 'Clocked Out' : 'Clocked In') : 'Not Clocked In'}</strong></div>
                    <div class="portal-row"><span>Late entries (last 30)</span><strong>${Number(model.lateCount || 0)}</strong></div>
                    <div class="portal-row"><span>On-time entries (last 30)</span><strong>${Number(model.onTimeCount || 0)}</strong></div>
                    <div class="portal-row"><span>Missing clock-out</span><strong>${Number(model.missedClockOuts || 0)}</strong></div>
                    ${model.attendancePromptNeeded
                        ? '<button class="portal-btn primary" style="width:auto;" data-action="clock-in"><i class="fas fa-clock"></i> Clock In Now</button>'
                        : (model.attendanceToday && !model.attendanceToday.clockOut)
                            ? '<button class="portal-btn warning" style="width:auto;" data-action="clock-out"><i class="fas fa-right-from-bracket"></i> Clock Out</button>'
                            : '<div class="portal-muted">Attendance status captured for today.</div>'}
                `
            },
            training_rules: {
                title: 'Training Rules',
                icon: 'fa-scale-balanced',
                hint: 'Open the current training rules.',
                className: 'widget-training_rules',
                body: `
                    <div class="portal-muted">Review the rules and expectations for your current training flow.</div>
                    <button class="portal-btn primary" style="width:auto; margin-top:8px;" data-action="training-rules"><i class="fas fa-book"></i> Open Rules</button>
                `
            },
            qa_help: {
                title: 'Q&A Help',
                icon: 'fa-circle-question',
                hint: 'Search published questions or send a new one to the admin team.',
                className: 'widget-qa_help',
                body: `
                    <div class="portal-search-row">
                        <input id="tp-qa-search" type="search" placeholder="Search questions..." autocomplete="off">
                        <button class="portal-link-btn" type="button" data-action="qa-compose-toggle">
                            <i class="fas ${this.qaComposerOpen ? 'fa-xmark' : 'fa-pen-to-square'}"></i>
                            ${this.qaComposerOpen ? 'Close' : 'Ask a question'}
                        </button>
                    </div>
                    <div class="portal-qa-submit ${this.qaComposerOpen ? 'open' : ''}">
                        <textarea id="tp-qa-question-input" rows="3" placeholder="Ask the admin team a question..."></textarea>
                        <div class="portal-qa-submit-actions">
                            <button class="portal-btn primary" type="button" data-action="qa-submit"><i class="fas fa-paper-plane"></i> Submit Question</button>
                        </div>
                    </div>
                    <div class="portal-list portal-qa-list" id="tp-qa-list">${qaRows}</div>
                `
            },
            available_now: {
                title: 'Available Now',
                icon: 'fa-unlock',
                nav: 'my-tests',
                hint: 'Open available assessments.',
                className: 'widget-available_now',
                body: `
                    <div class="portal-big">${Number(model.availableCount || 0)}</div>
                    <div class="portal-muted">Assessments waiting for completion.</div>
                    <div class="portal-list">${availableRows}</div>
                `
            },
            notes_clarity: {
                title: 'Notes & Clarity Marks',
                icon: 'fa-note-sticky',
                nav: 'study-notes',
                hint: 'Open your study notebook.',
                className: 'widget-notes_clarity',
                body: `
                    <div class="portal-row"><span>Saved note characters</span><strong>${Number(model.noteChars || 0)}</strong></div>
                    <div class="portal-row"><span>Captured clarity marks</span><strong>${Number(model.bookmarkCount || 0)}</strong></div>
                    <div class="portal-muted">Build your own sections and pages in Study Notes.</div>
                `
            },
            recent_results: {
                title: 'Recent Results',
                icon: 'fa-trophy',
                nav: 'my-tests',
                hint: 'Open assessments and scripts.',
                className: 'widget-recent_results',
                body: `
                    <div class="portal-muted">Showing all captured test results (${Number(model.records.length || 0)} total).</div>
                    <div class="portal-list">${resultRows}</div>
                `
            },
            daily_tip: {
                title: 'Daily Tip',
                icon: 'fa-lightbulb',
                hint: 'Tip updates daily based on your study flow.',
                className: 'widget-daily_tip',
                body: `<div class="portal-tip">${this.esc(model.dailyTip || '')}</div>`
            }
        };
    },

    renderQaQuestionRow(question) {
        const resources = Array.isArray(question.resources) ? question.resources : [];
        const resourceLinks = resources.length
            ? resources.map((resource, index) => `
                <button class="portal-resource-link" data-action="qa-resource" data-resource-id="${this.esc(resource.id || '')}" data-resource-index="${index}">
                    <i class="fas ${this.esc(this.iconForQaResource(resource.type))}"></i>
                    <span>${this.esc(resource.label || resource.name || 'Open answer')}</span>
                    <small>${this.esc(resource.url || resource.name || resource.type || 'linked material')}</small>
                </button>
            `).join('')
            : '';
        const tags = Array.isArray(question.tags) ? question.tags.join(' ') : String(question.tags || '');
        const resourceSearch = resources.map(resource => [
            resource?.label,
            resource?.name,
            resource?.url,
            resource?.type,
            resource?.mime
        ].filter(Boolean).join(' ')).join(' ');
        const searchable = `${question.question || ''} ${question.answer || ''} ${tags} ${resourceSearch}`.toLowerCase();
        return `
            <article class="portal-qa-item" data-qa-id="${this.esc(question.id || '')}" data-qa-search="${this.esc(searchable)}">
                <button class="portal-qa-question" data-action="qa-toggle">
                    <span>${this.esc(question.question || 'Question')}</span>
                    <i class="fas fa-chevron-down"></i>
                </button>
                <div class="portal-qa-answer">
                    ${question.answer ? `<p>${this.esc(question.answer)}</p>` : '<p class="portal-muted">Open the linked answer resource for details.</p>'}
                    <div class="portal-resource-list">${resourceLinks || '<span class="portal-muted">No answer link has been attached yet.</span>'}</div>
                </div>
            </article>
        `;
    },

    iconForQaResource(type) {
        if (type === 'sharepoint_video' || type === 'sharepoint_link') return 'fa-cloud-arrow-up';
        if (type === 'video') return 'fa-circle-play';
        if (type === 'image') return 'fa-image';
        if (type === 'pdf') return 'fa-file-pdf';
        if (type === 'audio') return 'fa-file-audio';
        if (type === 'office') return 'fa-file-word';
        if (type === 'archive') return 'fa-file-zipper';
        return 'fa-file-lines';
    },

    renderWidgetCard(layoutItem, def) {
        const cardClasses = ['portal-widget'];
        if (this.editMode) cardClasses.push('editing-card');

        const controls = this.editMode ? `
            <div class="portal-widget-controls">
                <button class="portal-control-btn" data-action="grow-w" title="Wider"><i class="fas fa-arrows-alt-h"></i></button>
                <button class="portal-control-btn" data-action="grow-h" title="Taller"><i class="fas fa-arrows-alt-v"></i></button>
                <button class="portal-control-btn" data-action="shrink" title="Shrink"><i class="fas fa-compress"></i></button>
                <button class="portal-control-btn" data-action="drag" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></button>
            </div>
        ` : '';

        const navAttr = def.nav ? ` data-nav="${this.esc(def.nav)}"` : '';
        const hint = def.hint ? `<div class="portal-link-hint"><i class="fas fa-arrow-up-right-from-square"></i> ${this.esc(def.hint)}</div>` : '';

        const extraClass = def.className ? ` ${this.esc(def.className)}` : '';

        return `
            <article
                class="${cardClasses.join(' ')}${extraClass}"
                data-widget-id="${this.esc(layoutItem.id)}"
                style="--col-span:${Number(layoutItem.col || 3)}; --row-span:${Number(layoutItem.row || 1)};"
                ${navAttr}
                draggable="${this.editMode ? 'true' : 'false'}"
            >
                <div class="portal-widget-head">
                    <h3 class="portal-widget-title">
                        <span class="portal-icon-badge"><i class="fas ${this.esc(def.icon || 'fa-cube')}"></i></span>
                        ${this.esc(def.title || layoutItem.id)}
                    </h3>
                    ${controls}
                </div>
                <div class="portal-widget-body">
                    ${def.body || '<div class="portal-muted">No data.</div>'}
                    ${hint}
                </div>
            </article>
        `;
    },

    attachWidgetInteractions() {
        const grid = document.getElementById('tp-widget-grid');
        if (!grid) return;
        const cards = Array.from(grid.querySelectorAll('.portal-widget'));

        cards.forEach(card => {
            const widgetId = String(card.dataset.widgetId || '');
            const navTarget = String(card.dataset.nav || '').trim();
            const controlButtons = Array.from(card.querySelectorAll('.portal-control-btn'));

            controlButtons.forEach(btn => {
                btn.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const action = String(btn.dataset.action || '');
                    if (action === 'grow-w') this.resizeWidget(widgetId, 1, 0);
                    if (action === 'grow-h') this.resizeWidget(widgetId, 0, 1);
                    if (action === 'shrink') this.resizeWidget(widgetId, -1, -1);
                });
            });

            const actionButtons = Array.from(card.querySelectorAll('[data-action]'));
            actionButtons.forEach(btn => {
                btn.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const action = String(btn.dataset.action || '');
                    if (action === 'clock-in') this.openClockInModal();
                    if (action === 'clock-out') this.submitClockOut();
                    if (action === 'training-rules') this.openTrainingRules();
                    if (action === 'qa-compose-toggle') this.toggleQaComposer();
                    if (action === 'qa-submit') this.submitQaQuestion();
                    if (action === 'qa-toggle') this.toggleQaQuestion(btn);
                    if (action === 'qa-resource') this.openQaResource(btn);
                });
            });

            card.addEventListener('click', () => {
                if (this.editMode) return;
                if (navTarget) this.navigate(navTarget);
            });

            if (!this.editMode) return;

            card.addEventListener('dragstart', (event) => {
                this.dragWidgetId = widgetId;
                card.classList.add('dragging');
                if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', widgetId);
                }
            });

            card.addEventListener('dragend', () => {
                this.dragWidgetId = null;
                cards.forEach(c => c.classList.remove('dragging', 'drop-target'));
            });

            card.addEventListener('dragover', (event) => {
                event.preventDefault();
                if (!this.dragWidgetId || this.dragWidgetId === widgetId) return;
                card.classList.add('drop-target');
            });

            card.addEventListener('dragleave', () => {
                card.classList.remove('drop-target');
            });

            card.addEventListener('drop', (event) => {
                event.preventDefault();
                card.classList.remove('drop-target');
                const sourceId = this.dragWidgetId || (event.dataTransfer ? event.dataTransfer.getData('text/plain') : '');
                if (!sourceId || sourceId === widgetId) return;
                this.moveWidgetBefore(sourceId, widgetId);
            });
        });

        const qaSearch = document.getElementById('tp-qa-search');
        if (qaSearch) {
            qaSearch.addEventListener('input', () => this.filterQaQuestions(qaSearch.value));
        }
    },

    render() {
        const container = document.getElementById('app-container');
        if (!container) return;

        const currentUser = this.getCurrentUser();
        AppContext.user = currentUser || null;

        if (!currentUser) {
            container.innerHTML = `<div class="portal-card"><div class="portal-muted">Sign in to open trainee portal.</div></div>`;
            return;
        }

        if (String(currentUser.role || '').toLowerCase() !== 'trainee') {
            container.innerHTML = `<div class="portal-card"><div class="portal-muted">Trainee portal is available to trainee sessions only.</div></div>`;
            return;
        }

        const model = this.buildModel();
        this.currentUserName = model.userName || String(currentUser.user || '');
        this.currentLayout = this.getLayoutForUser(this.currentUserName);
        const widgets = this.getWidgetDefinitions(model);

        const renderedCards = this.currentLayout
            .filter(item => !!widgets[item.id])
            .map(item => this.renderWidgetCard(item, widgets[item.id]))
            .join('');

        container.innerHTML = `
            <div class="portal-shell ${this.editMode ? 'editing' : ''}">
                <div class="portal-card">
                    <div class="portal-header">
                        <div>
                            <h2 class="portal-title">Trainee Portal</h2>
                            <p class="portal-subtitle">Visual, modular workspace. Drag widgets to reorder and resize during customization.</p>
                        </div>
                        <div class="portal-actions">
                            <button class="portal-btn portal-action-btn" id="tp-refresh-btn"><i class="fas fa-rotate-right"></i> Refresh</button>
                            <button class="portal-btn portal-action-btn" id="tp-rules-btn"><i class="fas fa-scale-balanced"></i> Training Rules</button>
                            <button class="portal-btn portal-action-btn" id="tp-notes-btn"><i class="fas fa-book-open"></i> Study Notes</button>
                            <button class="portal-btn portal-action-btn" id="tp-network-btn"><i class="fas fa-network-wired"></i> Network Test</button>
                            <button class="portal-btn portal-action-btn ${this.editMode ? 'success' : ''}" id="tp-edit-toggle-btn">
                                <i class="fas ${this.editMode ? 'fa-check' : 'fa-sliders-h'}"></i> ${this.editMode ? 'Done' : 'Customize'}
                            </button>
                            ${this.editMode ? '<button class="portal-btn portal-action-btn" id="tp-layout-reset-btn"><i class="fas fa-undo"></i> Reset Layout</button>' : ''}
                        </div>
                    </div>
                </div>

                <div class="portal-grid" id="tp-widget-grid">
                    ${renderedCards}
                </div>
            </div>
        `;

        const refreshBtn = document.getElementById('tp-refresh-btn');
        const rulesBtn = document.getElementById('tp-rules-btn');
        const notesBtn = document.getElementById('tp-notes-btn');
        const networkBtn = document.getElementById('tp-network-btn');
        const editToggleBtn = document.getElementById('tp-edit-toggle-btn');
        const resetLayoutBtn = document.getElementById('tp-layout-reset-btn');

        if (refreshBtn) refreshBtn.onclick = () => this.refresh({ forcePull: true });
        if (rulesBtn) rulesBtn.onclick = () => this.openTrainingRules();
        if (notesBtn) notesBtn.onclick = () => this.navigate('study-notes');
        if (networkBtn) networkBtn.onclick = () => this.openNetworkTest();
        if (editToggleBtn) editToggleBtn.onclick = () => this.toggleEditMode();
        if (resetLayoutBtn) resetLayoutBtn.onclick = () => this.resetLayout();

        this.attachWidgetInteractions();
    },

    openNetworkTest() {
        const host = this.getHost();
        if (host && host.NetworkDiag && typeof host.NetworkDiag.openModal === 'function') {
            host.NetworkDiag.openModal();
            return;
        }
        this.notify('Network diagnostics is not available right now.', 'warning');
    },

    openTrainingRules() {
        const host = this.getHost();
        if (host && typeof host.openTrainingRulesModal === 'function') {
            host.openTrainingRulesModal();
            return;
        }
        this.notify('Training rules are not available right now.', 'warning');
    },

    getQaQuestionById(id) {
        const qaData = this.readObject('qa_data');
        const questions = Array.isArray(qaData.questions) ? qaData.questions : [];
        return questions.find(q => String(q.id || '') === String(id || '')) || null;
    },

    toggleQaQuestion(button) {
        const item = button.closest('.portal-qa-item');
        if (!item) return;
        item.classList.toggle('expanded');
    },

    filterQaQuestions(value) {
        const term = String(value || '').trim().toLowerCase();
        document.querySelectorAll('.portal-qa-item').forEach(item => {
            const haystack = String(item.dataset.qaSearch || '').toLowerCase();
            item.style.display = !term || haystack.includes(term) ? '' : 'none';
        });
    },

    toggleQaComposer(open = null) {
        this.qaComposerOpen = open === null ? !this.qaComposerOpen : Boolean(open);
        this.render();
        if (this.qaComposerOpen) {
            setTimeout(() => document.getElementById('tp-qa-question-input')?.focus(), 20);
        }
    },

    openQaResource(button) {
        const item = button.closest('.portal-qa-item');
        const question = this.getQaQuestionById(item ? item.dataset.qaId : '');
        const resourceId = String(button.dataset.resourceId || '');
        const resourceIndex = Number(button.dataset.resourceIndex);
        let resource = question && Array.isArray(question.resources)
            ? question.resources.find(r => String(r.id || '') === resourceId)
            : null;
        if (!resource && question && Array.isArray(question.resources) && Number.isInteger(resourceIndex)) {
            resource = question.resources[resourceIndex] || null;
        }
        if (!resource) {
            this.notify('Answer resource was not found.', 'warning');
            return;
        }
        const target = resource.dataUrl || resource.url || '';
        if (!target) {
            this.notify('Answer resource has no link attached.', 'warning');
            return;
        }
        const host = this.getHost();
        if (host && host.QAHub && typeof host.QAHub.openResource === 'function') {
            host.QAHub.openResource(resource);
            return;
        }
        if (host && typeof host.open === 'function') {
            host.open(target, '_blank', 'noopener');
            return;
        }
        window.open(target, '_blank', 'noopener');
    },

    async submitQaQuestion() {
        const host = this.getHost();
        const input = document.getElementById('tp-qa-question-input');
        let question = String(input ? input.value : '').trim();
        if (!question) {
            if (host && typeof host.customPrompt === 'function') {
                question = await host.customPrompt('Submit a Question', 'What would you like the admin team to answer?', '');
            } else {
                question = prompt('What would you like the admin team to answer?', '');
            }
        }
        question = String(question || '').trim();
        if (!question) return;
        if (host && host.QAHub && typeof host.QAHub.submitTraineeQuestion === 'function') {
            const ok = await host.QAHub.submitTraineeQuestion(question);
            if (ok) {
                if (input) input.value = '';
                this.qaComposerOpen = false;
                this.notify('Question sent to the admin team.', 'success');
                this.refresh({ forcePull: false });
            }
            return;
        }
        const ok = await this.persistQaSubmission(question);
        if (ok) {
            if (input) input.value = '';
            this.qaComposerOpen = false;
            this.notify('Question sent to the admin team.', 'success');
            this.refresh({ forcePull: false });
            return;
        }
        this.notify('Q&A submission is unavailable right now.', 'error');
    },

    async persistQaSubmission(questionText) {
        const text = String(questionText || '').trim();
        if (!text) return false;
        const host = this.getHost();
        const storage = (host && host.localStorage) || localStorage;
        const currentUser = this.getCurrentUser() || {};
        let qaData = {};

        try {
            qaData = JSON.parse(storage.getItem('qa_data') || '{}') || {};
        } catch (error) {
            qaData = {};
        }

        if (!Array.isArray(qaData.questions)) qaData.questions = [];
        if (!Array.isArray(qaData.submissions)) qaData.submissions = [];

        qaData.submissions.unshift({
            id: `ask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            question: text,
            trainee: currentUser.user || currentUser.username || 'Trainee',
            status: 'new',
            createdAt: new Date().toISOString()
        });
        qaData.updatedAt = new Date().toISOString();
        qaData.updatedBy = currentUser.user || currentUser.username || 'Trainee';

        try {
            storage.setItem('qa_data', JSON.stringify(qaData));
            if (host && typeof host.emitDataChange === 'function') host.emitDataChange('qa_data', 'qa_trainee_submit');
            if (host && typeof host.saveToServer === 'function') {
                return await host.saveToServer(['qa_data'], true, false);
            }
            return true;
        } catch (error) {
            console.warn('[Trainee Portal] Q&A fallback submit failed:', error);
            return false;
        }
    },

    openClockInModal() {
        const host = this.getHost();
        if (host && typeof host.openClockInModal === 'function') {
            host.openClockInModal();
            return;
        }
        this.notify('Attendance clock-in is not available right now.', 'warning');
    },

    submitClockOut() {
        const host = this.getHost();
        if (host && typeof host.submitClockOut === 'function') {
            host.submitClockOut();
            return;
        }
        this.notify('Attendance clock-out is not available right now.', 'warning');
    },

    notify(message, type) {
        const host = this.getHost();
        if (host && typeof host.showToast === 'function') {
            host.showToast(message, type || 'info');
        }
    },

    navigate(tabId) {
        const host = this.getHost();
        if (host && typeof host.showTab === 'function') {
            host.showTab(tabId);
            return;
        }
        this.notify('Navigation bridge unavailable in this runtime.', 'warning');
    },

    async refresh(options = {}) {
        const forcePull = Boolean(options.forcePull);
        const host = this.getHost();
        try {
            if (forcePull && host && typeof host.loadFromServer === 'function') {
                await host.loadFromServer(true);
            }
        } catch (error) {
            console.warn('[Trainee Portal] Host refresh failed:', error);
        }
        this.render();
    },

    isVisibleInHost() {
        try {
            const host = this.getHost();
            const section = host.document && host.document.getElementById('trainee-portal');
            return !!(section && section.classList && section.classList.contains('active'));
        } catch (error) {
            return false;
        }
    },

    startAutoRefresh() {
        this.stopAutoRefresh();
        this.refreshTimer = setInterval(() => {
            if (!this.isVisibleInHost()) return;
            this.refresh({ forcePull: false });
        }, 30000);
    },

    stopAutoRefresh() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    },

    bindHostListeners() {
        const host = this.getHost();
        if (!host || typeof host.addEventListener !== 'function' || this._boundHostDataListener) return;

        this._boundHostDataListener = (event) => {
            const key = event?.detail?.key;
            if (!key || !this.isVisibleInHost()) return;
            if (![
                'schedules',
                'records',
                'submissions',
                'liveBookings',
                'liveSessions',
                'trainee_notes',
                'trainee_bookmarks',
                'dailyTips',
                'qa_data',
                'attendance_records'
            ].includes(key)) return;
            this.refresh({ forcePull: false });
        };

        host.addEventListener('buildzone:data-changed', this._boundHostDataListener);
    },

    destroy() {
        this.stopAutoRefresh();
        const host = this.getHost();
        if (this._boundHostDataListener && host && typeof host.removeEventListener === 'function') {
            host.removeEventListener('buildzone:data-changed', this._boundHostDataListener);
            this._boundHostDataListener = null;
        }
    }
};

window.TraineePortalApp = TraineePortalApp;
window.addEventListener('DOMContentLoaded', () => {
    TraineePortalApp.init();
    TraineePortalApp.startAutoRefresh();
});
window.addEventListener('beforeunload', () => {
    TraineePortalApp.destroy();
});

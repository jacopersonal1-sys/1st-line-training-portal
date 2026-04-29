const TraineePortalApp = {
    refreshTimer: null,
    _boundHostDataListener: null,
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
            positiveBadgeCount
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
        const notesBtn = document.getElementById('tp-notes-btn');
        const networkBtn = document.getElementById('tp-network-btn');
        const editToggleBtn = document.getElementById('tp-edit-toggle-btn');
        const resetLayoutBtn = document.getElementById('tp-layout-reset-btn');

        if (refreshBtn) refreshBtn.onclick = () => this.refresh({ forcePull: true });
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

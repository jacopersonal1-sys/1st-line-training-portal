const DEFAULT_SA_HOLIDAYS = [
    '2026-01-01',
    '2026-03-21',
    '2026-04-03',
    '2026-04-06',
    '2026-04-27',
    '2026-05-01',
    '2026-06-16',
    '2026-08-09',
    '2026-08-10',
    '2026-09-24',
    '2026-12-16',
    '2026-12-25',
    '2026-12-26'
];

const SCHEDULE_TEMPLATE_STORAGE_KEY = 'scheduleTemplates';
const SCHEDULE_HOLIDAY_STORAGE_KEY = 'scheduleHolidays';

const ScheduleData = {
    getStorage() {
        if (AppContext.host && AppContext.host.localStorage) return AppContext.host.localStorage;
        return window.localStorage;
    },

    async init() {
        if (AppContext.host && typeof AppContext.host.loadFromServer === 'function') {
            try {
                await AppContext.host.loadFromServer(true);
            } catch (error) {
                console.warn('[Schedule Studio] Initial sync failed:', error);
            }
        }
    },

    getSchedules() {
        let parsed = null;
        try {
            parsed = JSON.parse(this.getStorage().getItem('schedules') || 'null');
        } catch (error) {
            parsed = null;
        }
        if (parsed && Object.keys(parsed).length > 0) return parsed;
        return { A: { items: [], assigned: null }, B: { items: [], assigned: null } };
    },

    getRosters() {
        return JSON.parse(this.getStorage().getItem('rosters') || '{}');
    },

    getTests() {
        return JSON.parse(this.getStorage().getItem('tests') || '[]');
    },

    getCurrentUser() {
        if (AppContext.user) return AppContext.user;
        try {
            const storage = AppContext.host ? AppContext.host.sessionStorage : window.sessionStorage;
            return JSON.parse(storage.getItem('currentUser') || 'null');
        } catch (error) {
            return null;
        }
    },

    getGroupLabel(groupId, count) {
        if (!groupId) return 'Unassigned';
        if (AppContext.host && typeof AppContext.host.getGroupLabel === 'function') {
            return AppContext.host.getGroupLabel(groupId, count);
        }
        return count ? `${groupId} (${count})` : groupId;
    },

    async saveSchedules(schedules, force = true) {
        const storage = this.getStorage();
        const previousSchedules = storage.getItem('schedules');
        storage.setItem('schedules', JSON.stringify(schedules));

        try {
            if (AppContext.host && typeof AppContext.host.saveToServer === 'function') {
                const result = await AppContext.host.saveToServer(['schedules'], force);
                if (result === false) throw new Error('Failed to sync schedules to the server.');
            }
        } catch (error) {
            if (AppContext.host && typeof AppContext.host.loadFromServer === 'function') {
                try {
                    await AppContext.host.loadFromServer(true);
                } catch (reloadError) {
                    console.warn('[Schedule Studio] Failed to restore schedules from server after save error:', reloadError);
                    if (previousSchedules !== null) storage.setItem('schedules', previousSchedules);
                }
            } else if (previousSchedules !== null) {
                storage.setItem('schedules', previousSchedules);
            }
            throw error;
        }

        return true;
    },

    parseRange(item) {
        const raw = String(item?.dateRange || '').trim();
        if (!raw) return { start: '', end: this.normalizeDate(item?.dueDate || '') };

        if (raw.includes(' - ')) {
            const [start, end] = raw.split(' - ').map(part => this.normalizeDate(part));
            return { start, end: this.normalizeDate(item?.dueDate || end) };
        }

        return {
            start: this.normalizeDate(raw),
            end: this.normalizeDate(item?.dueDate || raw)
        };
    },

    parseStrictDate(value) {
        const raw = String(value || '').trim();
        if (!raw) return null;
        const normalized = raw.replace(/\./g, '/').replace(/-/g, '/');
        const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
        if (!match) return null;

        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const candidate = new Date(year, month - 1, day, 12, 0, 0, 0);
        if (
            candidate.getFullYear() !== year ||
            candidate.getMonth() !== month - 1 ||
            candidate.getDate() !== day
        ) {
            return null;
        }
        return candidate;
    },

    toDateSlash(dateObj) {
        if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        return `${year}/${month}/${day}`;
    },

    toDateDash(dateObj) {
        return this.toDateSlash(dateObj).replace(/\//g, '-');
    },

    normalizeDate(value) {
        if (value instanceof Date) return this.toDateSlash(value);
        const parsed = this.parseStrictDate(value);
        if (parsed) return this.toDateSlash(parsed);
        return String(value || '').trim().replace(/-/g, '/');
    },

    normalizeDurationDays(value) {
        const parsed = Number.parseInt(String(value ?? '').trim(), 10);
        if (!Number.isFinite(parsed) || parsed <= 0) return null;
        return parsed;
    },

    getConfiguredHolidays() {
        let configured = [];
        try {
            configured = JSON.parse(this.getStorage().getItem(SCHEDULE_HOLIDAY_STORAGE_KEY) || '[]');
        } catch (error) {
            configured = [];
        }

        const merged = [
            ...new Set([
                ...DEFAULT_SA_HOLIDAYS,
                ...(Array.isArray(configured) ? configured : [])
            ])
        ];
        return new Set(
            merged
                .map(value => this.normalizeDate(value))
                .filter(Boolean)
        );
    },

    isBusinessDay(dateObj) {
        if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return false;
        const day = dateObj.getDay();
        if (day === 0 || day === 6) return false;
        const holidays = this.getConfiguredHolidays();
        return !holidays.has(this.toDateSlash(dateObj));
    },

    moveToBusinessDay(dateObj) {
        if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return null;
        const next = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 12, 0, 0, 0);
        let attempts = 0;
        while (!this.isBusinessDay(next) && attempts < 400) {
            next.setDate(next.getDate() + 1);
            attempts++;
        }
        return next;
    },

    getBusinessDayEndDate(startDateObj, durationDays) {
        const normalizedDuration = this.normalizeDurationDays(durationDays) || 1;
        const start = this.moveToBusinessDay(startDateObj);
        if (!start) return null;

        let end = new Date(start);
        let count = 1;
        let attempts = 0;
        while (count < normalizedDuration && attempts < 4000) {
            end.setDate(end.getDate() + 1);
            if (this.isBusinessDay(end)) count++;
            attempts++;
        }
        return end;
    },

    calculateWindow(startDateInput, durationDays) {
        const startParsed = this.parseStrictDate(startDateInput);
        if (!startParsed) return null;

        const startDate = this.moveToBusinessDay(startParsed);
        if (!startDate) return null;

        const normalizedDuration = this.normalizeDurationDays(durationDays) || 1;
        const endDate = this.getBusinessDayEndDate(startDate, normalizedDuration);
        if (!endDate) return null;

        const startDateSlash = this.toDateSlash(startDate);
        const startDateDash = this.toDateDash(startDate);
        const endDateSlash = this.toDateSlash(endDate);
        const endDateDash = this.toDateDash(endDate);
        return {
            startDateSlash,
            startDateDash,
            endDateSlash,
            endDateDash,
            durationDays: normalizedDuration,
            dateRange: normalizedDuration > 1 ? `${startDateSlash} - ${endDateSlash}` : startDateSlash,
            dueDate: endDateSlash
        };
    },

    getNextBusinessDate(dateObj) {
        if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return null;
        const next = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 12, 0, 0, 0);
        next.setDate(next.getDate() + 1);
        return this.moveToBusinessDay(next);
    },

    getTodayOrNextBusinessDayDash() {
        const next = this.moveToBusinessDay(new Date());
        return next ? this.toDateDash(next) : this.toDateDash(new Date());
    },

    inferDurationDays(item) {
        if (!item || typeof item !== 'object') return null;
        const explicit = this.normalizeDurationDays(item.durationDays);
        if (explicit) return explicit;

        const range = this.parseRange(item);
        const start = this.parseStrictDate(range.start);
        let end = this.parseStrictDate(range.end || range.start);
        if (!start || !end) return null;
        if (end < start) end = new Date(start);

        const cursor = new Date(start);
        let count = 0;
        let attempts = 0;
        while (cursor <= end && attempts < 4000) {
            if (this.isBusinessDay(cursor)) count++;
            cursor.setDate(cursor.getDate() + 1);
            attempts++;
        }
        return count > 0 ? count : 1;
    },

    getTemplates() {
        let templates = [];
        try {
            templates = JSON.parse(this.getStorage().getItem(SCHEDULE_TEMPLATE_STORAGE_KEY) || '[]');
        } catch (error) {
            templates = [];
        }

        if (!Array.isArray(templates)) return [];
        return templates
            .filter(template => template && typeof template === 'object' && Array.isArray(template.items))
            .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    },

    saveTemplates(templates) {
        const safeTemplates = Array.isArray(templates) ? templates : [];
        this.getStorage().setItem(SCHEDULE_TEMPLATE_STORAGE_KEY, JSON.stringify(safeTemplates));
    },

    buildTemplateItemsFromScheduleItems(items) {
        if (!Array.isArray(items)) return [];
        return items.map((item, index) => {
            const cloned = JSON.parse(JSON.stringify(item || {}));
            delete cloned.dateRange;
            delete cloned.dueDate;
            delete cloned.createdAt;
            delete cloned.lastModified;
            delete cloned.modifiedBy;
            cloned.courseName = String(cloned.courseName || '').trim() || `Step ${index + 1}`;
            cloned.durationDays = this.normalizeDurationDays(cloned.durationDays) || this.inferDurationDays(item) || 1;
            return cloned;
        });
    },

    buildScheduleItemsFromTemplateItems(templateItems, timelineStartDate) {
        if (!Array.isArray(templateItems)) return [];

        let cursor = this.moveToBusinessDay(this.parseStrictDate(timelineStartDate));
        if (!cursor) return null;

        return templateItems.map((templateItem, index) => {
            const cloned = JSON.parse(JSON.stringify(templateItem || {}));
            const durationDays = this.normalizeDurationDays(cloned.durationDays) || this.inferDurationDays(cloned) || 1;
            const window = this.calculateWindow(this.toDateDash(cursor), durationDays);
            if (!window) throw new Error('Unable to calculate timeline window from template.');

            cloned.courseName = String(cloned.courseName || '').trim() || `Step ${index + 1}`;
            cloned.durationDays = durationDays;
            cloned.dateRange = window.dateRange;
            cloned.dueDate = window.endDateSlash;
            cloned.openTime = cloned.openTime || '08:00';
            cloned.closeTime = cloned.closeTime || '17:00';
            cloned.ignoreTime = Boolean(cloned.ignoreTime);
            cloned.isVetting = Boolean(cloned.isVetting);
            cloned.isLive = Boolean(cloned.isLive);

            delete cloned.createdAt;
            delete cloned.lastModified;
            delete cloned.modifiedBy;

            const endDate = this.parseStrictDate(window.endDateSlash);
            cursor = endDate ? this.getNextBusinessDate(endDate) : this.moveToBusinessDay(new Date());
            return cloned;
        });
    },

    migrateDurationDaysInSchedules(schedules) {
        if (!schedules || typeof schedules !== 'object') return false;
        let touched = false;

        Object.keys(schedules).forEach(scheduleId => {
            const group = schedules[scheduleId];
            if (!group || !Array.isArray(group.items)) return;
            group.items.forEach(item => {
                if (!item || typeof item !== 'object') return;
                if (this.normalizeDurationDays(item.durationDays)) return;
                const inferred = this.inferDurationDays(item);
                if (inferred) {
                    item.durationDays = inferred;
                    touched = true;
                }
            });
        });

        return touched;
    },

    formatRange(start, end) {
        if (!start && !end) return '';
        if (!end || start === end) return start;
        return `${start} - ${end}`;
    },

    getMyScheduleId(username, schedules) {
        const rosters = this.getRosters();
        const normalizedUser = String(username || '').trim().toLowerCase();
        let myGroup = null;

        Object.entries(rosters).forEach(([groupId, members]) => {
            if (myGroup) return;
            if ((members || []).some(member => String(member || '').trim().toLowerCase() === normalizedUser)) {
                myGroup = groupId;
            }
        });

        if (!myGroup) return null;
        const normalizedGroup = String(myGroup || '').trim().toLowerCase();
        return Object.keys(schedules).find(key => String(schedules[key].assigned || '').trim().toLowerCase() === normalizedGroup) || null;
    }
};

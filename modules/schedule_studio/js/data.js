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
        const parsed = JSON.parse(this.getStorage().getItem('schedules') || 'null');
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

    normalizeDate(value) {
        return String(value || '').trim().replace(/-/g, '/');
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
        return Object.keys(schedules).find(key => schedules[key].assigned === myGroup) || null;
    }
};

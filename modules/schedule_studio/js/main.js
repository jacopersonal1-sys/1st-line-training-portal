const App = {
    state: {
        schedules: {},
        activeScheduleId: 'A',
        view: 'list',
        currentMonth: new Date()
    },

    async init() {
        const container = document.getElementById('app-container');
        if (!container) return;

        container.innerHTML = `
            <div class="studio-panel" style="text-align:center; padding:60px 20px;">
                <i class="fas fa-circle-notch fa-spin" style="font-size:2rem; color:var(--primary);"></i>
                <p class="studio-subtitle" style="margin-top:16px;">Loading schedule studio...</p>
            </div>
        `;

        await ScheduleData.init();
        this.loadState();
        this.render();
    },

    loadState() {
        this.state.schedules = ScheduleData.getSchedules();
        if (!this.state.schedules[this.state.activeScheduleId]) {
            this.state.activeScheduleId = Object.keys(this.state.schedules).sort()[0] || 'A';
        }

        const currentUser = ScheduleData.getCurrentUser();
        if (currentUser && !this.canViewAll()) {
            const myScheduleId = ScheduleData.getMyScheduleId(currentUser.user, this.state.schedules);
            this.state.activeScheduleId = myScheduleId || this.state.activeScheduleId;
        }
    },

    render() {
        const container = document.getElementById('app-container');
        if (!container) return;

        const schedules = this.state.schedules;
        const active = schedules[this.state.activeScheduleId] || { items: [], assigned: null };
        const currentUser = ScheduleData.getCurrentUser();
        const canEdit = this.canEdit();
        const canManage = this.canManage();

        if (currentUser && !this.canViewAll()) {
            const myScheduleId = ScheduleData.getMyScheduleId(currentUser.user, schedules);
            if (!myScheduleId) {
                container.innerHTML = `
                    <div class="studio-panel">
                        <h1 class="studio-title">Assessment Schedule</h1>
                        <p class="studio-subtitle">No timeline has been assigned to your group yet.</p>
                    </div>
                `;
                return;
            }
        }

        container.innerHTML = `
            <div class="studio-shell">
                <div class="studio-panel">
                    <div class="studio-header">
                        <div>
                            <h1 class="studio-title">Schedule Studio</h1>
                            <p class="studio-subtitle">An isolated timeline manager for group schedules. This keeps the schedule engine separated from the rest of the app while preserving the current data structure used by trainees and the test engine.</p>
                        </div>
                        <div class="studio-pill-row">
                            <span class="studio-pill"><i class="fas fa-user"></i> ${TimelineUI.escape(currentUser?.user || 'Guest')}</span>
                            <span class="studio-pill"><i class="fas fa-shield-halved"></i> ${TimelineUI.escape(currentUser?.role || 'unknown')}</span>
                            <span class="studio-pill"><i class="fas fa-layer-group"></i> ${Object.keys(schedules).length} timelines</span>
                        </div>
                    </div>
                    <div class="studio-layout">
                        <aside class="studio-card studio-sidebar">
                            ${TimelineUI.renderScheduleTabs(schedules, this.state.activeScheduleId, canManage)}
                        </aside>
                        <div class="studio-card studio-main-card studio-main">
                            ${TimelineUI.renderToolbar(active, this.state.view, canEdit, canManage)}
                            ${this.state.view === 'calendar'
                                ? CalendarUI.render(active.items || [], this.state.currentMonth)
                                : TimelineUI.renderTimeline(active.items || [], {
                                    canEdit,
                                    totalItems: (active.items || []).length,
                                    getMaterialState: item => this.getMaterialState(item),
                                    getAssessmentState: item => this.getAssessmentState(item)
                                })}
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    canViewAll() {
        const role = ScheduleData.getCurrentUser()?.role;
        return ['admin', 'super_admin', 'special_viewer', 'teamleader'].includes(role);
    },

    canEdit() {
        const role = ScheduleData.getCurrentUser()?.role;
        return ['admin', 'super_admin'].includes(role);
    },

    canManage() {
        return this.canEdit();
    },

    setSchedule(id) {
        this.state.activeScheduleId = id;
        this.render();
    },

    setView(view) {
        this.state.view = view;
        this.render();
    },

    changeMonth(delta) {
        this.state.currentMonth = new Date(this.state.currentMonth.getFullYear(), this.state.currentMonth.getMonth() + delta, 1);
        this.render();
    },

    async persist() {
        await ScheduleData.saveSchedules(this.state.schedules, true);
        this.loadState();
        this.render();
    },

    async createSchedule() {
        if (!this.canManage()) return;
        const keys = Object.keys(this.state.schedules).sort();
        const nextKey = keys.length ? String.fromCharCode(keys[keys.length - 1].charCodeAt(0) + 1) : 'A';
        this.state.schedules[nextKey] = { items: [], assigned: null };
        this.state.activeScheduleId = nextKey;
        await this.persist();
    },

    async deleteSchedule() {
        if (!this.canManage()) return;
        if (!confirm(`Delete Schedule ${this.state.activeScheduleId}?`)) return;

        const schedules = this.state.schedules;
        delete schedules[this.state.activeScheduleId];
        const oldKeys = Object.keys(schedules).sort();
        const nextSchedules = {};

        if (!oldKeys.length) {
            nextSchedules.A = { items: [], assigned: null };
        } else {
            oldKeys.forEach((oldKey, index) => {
                nextSchedules[String.fromCharCode(65 + index)] = schedules[oldKey];
            });
        }

        this.state.schedules = nextSchedules;
        this.state.activeScheduleId = Object.keys(nextSchedules).sort()[0];
        await this.persist();
    },

    async duplicateSchedule() {
        if (!this.canEdit()) return;
        const keys = Object.keys(this.state.schedules).sort();
        const nextKey = String.fromCharCode(keys[keys.length - 1].charCodeAt(0) + 1);
        this.state.schedules[nextKey] = {
            items: JSON.parse(JSON.stringify(this.getActiveSchedule().items || [])),
            assigned: null
        };
        this.state.activeScheduleId = nextKey;
        await this.persist();
    },

    async cloneSchedule() {
        if (!this.canEdit()) return;
        const candidates = Object.keys(this.state.schedules).filter(key => key !== this.state.activeScheduleId);
        if (!candidates.length) return alert('No other timelines to copy from.');
        const sourceId = prompt(`Copy items from which timeline? (${candidates.join(', ')})`);
        if (!sourceId || !this.state.schedules[sourceId]) return;
        if (!confirm(`Overwrite Schedule ${this.state.activeScheduleId} with Schedule ${sourceId}?`)) return;
        this.getActiveSchedule().items = JSON.parse(JSON.stringify(this.state.schedules[sourceId].items || []));
        await this.persist();
    },

    async assignSchedule() {
        if (!this.canEdit()) return;
        const select = document.getElementById('schedule-group-select');
        const groupId = select?.value;
        if (!groupId) return alert('Please select a group.');

        Object.keys(this.state.schedules).forEach(key => {
            if (key !== this.state.activeScheduleId && this.state.schedules[key].assigned === groupId) {
                this.state.schedules[key].assigned = null;
            }
        });

        this.getActiveSchedule().assigned = groupId;
        await this.persist();
    },

    async clearAssignment() {
        if (!this.canEdit()) return;
        if (!confirm('Clear this timeline assignment?')) return;
        this.getActiveSchedule().assigned = null;
        await this.persist();
    },

    async addItem() {
        if (!this.canManage()) return;
        const today = this.todayString();
        this.getActiveSchedule().items.push({
            dateRange: today,
            dueDate: today,
            courseName: 'New Item',
            materialLink: '',
            assessmentLink: '',
            openTime: '08:00',
            closeTime: '17:00',
            ignoreTime: false,
            isVetting: false,
            isLive: false
        });
        await this.persist();
        this.editItem(this.getActiveSchedule().items.length - 1);
    },

    editItem(index) {
        if (!this.canEdit()) return;
        const item = this.getActiveSchedule().items[index];
        const range = ScheduleData.parseRange(item);
        const tests = ScheduleData.getTests();

        document.getElementById('edit-step-index').value = index;
        document.getElementById('edit-start-date').value = this.toInputDate(range.start);
        document.getElementById('edit-end-date').value = this.toInputDate(range.end || range.start);
        document.getElementById('edit-course-name').value = item.courseName || '';
        document.getElementById('edit-material-link').value = item.materialLink || '';
        document.getElementById('edit-assessment-link').value = item.assessmentLink || '';
        document.getElementById('edit-open-time').value = item.openTime || '';
        document.getElementById('edit-close-time').value = item.closeTime || '';
        document.getElementById('edit-ignore-time').checked = Boolean(item.ignoreTime);
        document.getElementById('edit-is-vetting').checked = Boolean(item.isVetting);
        document.getElementById('edit-is-live').checked = Boolean(item.isLive);

        const testSelect = document.getElementById('edit-linked-test');
        testSelect.innerHTML = '<option value="">-- None (Use External Link) --</option>';
        tests.forEach(test => {
            testSelect.add(new Option(test.title, test.id));
        });
        testSelect.value = item.linkedTestId || '';

        document.getElementById('schedule-modal').classList.remove('hidden');
    },

    closeEditor() {
        document.getElementById('schedule-modal').classList.add('hidden');
    },

    async saveEditor() {
        const index = Number(document.getElementById('edit-step-index').value);
        const item = this.getActiveSchedule().items[index];
        if (!item) return;

        const startDate = document.getElementById('edit-start-date').value;
        const endDate = document.getElementById('edit-end-date').value || startDate;
        if (!startDate || !endDate) return alert('Start and end dates are required.');

        item.dateRange = ScheduleData.formatRange(startDate.replace(/-/g, '/'), endDate.replace(/-/g, '/'));
        item.dueDate = endDate.replace(/-/g, '/');
        item.courseName = document.getElementById('edit-course-name').value.trim();
        item.materialLink = document.getElementById('edit-material-link').value.trim();
        item.assessmentLink = document.getElementById('edit-assessment-link').value.trim();
        item.openTime = document.getElementById('edit-open-time').value;
        item.closeTime = document.getElementById('edit-close-time').value;
        item.ignoreTime = document.getElementById('edit-ignore-time').checked;
        item.isVetting = document.getElementById('edit-is-vetting').checked;
        item.isLive = document.getElementById('edit-is-live').checked;

        const linkedTestId = document.getElementById('edit-linked-test').value;
        if (linkedTestId) item.linkedTestId = linkedTestId;
        else delete item.linkedTestId;

        await this.persist();
        this.closeEditor();
    },

    async deleteItem(index) {
        if (!this.canEdit()) return;
        if (!confirm('Delete this timeline item?')) return;
        this.getActiveSchedule().items.splice(index, 1);
        await this.persist();
    },

    async moveItem(index, delta) {
        if (!this.canEdit()) return;
        const items = this.getActiveSchedule().items;
        const targetIndex = index + delta;
        if (targetIndex < 0 || targetIndex >= items.length) return;
        const [item] = items.splice(index, 1);
        items.splice(targetIndex, 0, item);
        await this.persist();
    },

    getActiveSchedule() {
        if (!this.state.schedules[this.state.activeScheduleId]) {
            this.state.schedules[this.state.activeScheduleId] = { items: [], assigned: null };
        }
        return this.state.schedules[this.state.activeScheduleId];
    },

    getMaterialState(item) {
        const range = ScheduleData.parseRange(item);
        if (!range.start) {
            return { enabled: true, label: 'Available' };
        }

        const today = this.todayString();
        if (today < range.start) {
            return { enabled: false, label: `Opens on ${range.start}` };
        }

        return { enabled: true, label: 'Available from start date onward' };
    },

    getAssessmentState(item) {
        const range = ScheduleData.parseRange(item);
        const releaseDate = range.end || range.start;
        const hasLinkedAssessment = Boolean(item.linkedTestId || item.assessmentLink);

        if (!hasLinkedAssessment) {
            return { enabled: false, label: 'No linked assessment', buttonLabel: 'No Assessment' };
        }

        const today = this.todayString();
        if (releaseDate && today < releaseDate) {
            return { enabled: false, label: `Assessment unlocks on ${releaseDate}`, buttonLabel: 'Locked' };
        }

        if (releaseDate && today > releaseDate) {
            return { enabled: false, label: 'Assessment window has closed', buttonLabel: 'Closed' };
        }

        if (item.ignoreTime) {
            return { enabled: true, label: 'Available today', buttonLabel: 'Open Assessment' };
        }

        const nowMinutes = this.currentMinutes();
        const openMinutes = this.timeToMinutes(item.openTime || '00:00');
        const closeMinutes = item.closeTime ? this.timeToMinutes(item.closeTime) : null;

        if (nowMinutes < openMinutes) {
            return { enabled: false, label: `Available today at ${item.openTime || '00:00'}`, buttonLabel: 'Time Locked' };
        }

        if (closeMinutes !== null && nowMinutes > closeMinutes) {
            return { enabled: false, label: `Closed after ${item.closeTime}`, buttonLabel: 'Closed' };
        }

        return { enabled: true, label: 'Available now', buttonLabel: 'Open Assessment' };
    },

    openMaterial(index) {
        const item = this.getActiveSchedule().items[index];
        if (!item?.materialLink) return;
        const state = this.getMaterialState(item);
        if (!state.enabled) return;

        if (AppContext.host && AppContext.host.StudyMonitor && typeof AppContext.host.StudyMonitor.openStudyWindow === 'function') {
            AppContext.host.StudyMonitor.openStudyWindow(item.materialLink, item.courseName || 'Study Material');
            return;
        }

        const role = ScheduleData.getCurrentUser()?.role;
        if (role === 'trainee') {
            alert('Study material can only open through the in-app secure study browser. Please refresh the app and try again.');
            return;
        }

        window.open(item.materialLink, '_blank');
    },

    openAssessment(index) {
        const item = this.getActiveSchedule().items[index];
        if (!item) return;
        const state = this.getAssessmentState(item);
        if (!state.enabled) return;

        if (item.linkedTestId && AppContext.host && typeof AppContext.host.showTab === 'function') {
            AppContext.host.showTab('my-tests');
            return;
        }

        if (item.assessmentLink) {
            window.open(item.assessmentLink, '_blank');
        }
    },

    refresh() {
        this.loadState();
        this.render();
    },

    todayString() {
        return this.toStorageDate(new Date());
    },

    toStorageDate(dateObj) {
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        return `${year}/${month}/${day}`;
    },

    toInputDate(value) {
        return String(value || '').replace(/\//g, '-');
    },

    currentMinutes() {
        const now = new Date();
        return now.getHours() * 60 + now.getMinutes();
    },

    timeToMinutes(timeStr) {
        const [hours, minutes] = String(timeStr || '00:00').split(':').map(Number);
        return (hours || 0) * 60 + (minutes || 0);
    }
};

window.App = App;
window.addEventListener('DOMContentLoaded', () => {
    App.init();
});

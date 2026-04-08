const App = {
    refreshTimer: null,
    state: {
        schedules: {},
        activeScheduleId: 'A',
        view: 'list',
        currentMonth: new Date(),
        templateEditor: {
            selectedTemplateId: '',
            templateName: '',
            items: []
        }
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
        this.bindHostListeners();
        this.loadState();
        await this.runDurationMigrationOnce();
        this.render();
    },

    bindHostListeners() {
        if (!AppContext.host || typeof AppContext.host.addEventListener !== 'function' || this._boundHostDataListener) return;

        this._boundHostDataListener = (event) => {
            const changedKey = event?.detail?.key;
            if (!['schedules', 'rosters', 'tests'].includes(changedKey)) return;

            clearTimeout(this.refreshTimer);
            this.refreshTimer = setTimeout(() => this.refresh(), 120);
        };

        AppContext.host.addEventListener('buildzone:data-changed', this._boundHostDataListener);
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
                            ${TimelineUI.renderToolbar(active, this.state.view, canEdit, canManage, {
                                templateCount: ScheduleData.getTemplates().length,
                                totalSchedules: Object.keys(schedules).length
                            })}
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

    notify(message, type = 'info') {
        if (AppContext.host && typeof AppContext.host.showToast === 'function') {
            AppContext.host.showToast(message, type);
            return;
        }
        console.log(`[Schedule Studio] ${message}`);
    },

    unwrapSafeLink(urlValue) {
        const raw = String(urlValue || '').trim();
        if (!raw) return '';

        try {
            const parsed = new URL(raw);
            const host = parsed.hostname.toLowerCase();
            if (!host.includes('safelinks.protection.outlook.com')) return raw;

            const nestedRaw = parsed.searchParams.get('url') || parsed.searchParams.get('u') || '';
            if (!nestedRaw) return raw;

            let decoded = nestedRaw;
            for (let i = 0; i < 2; i++) {
                try {
                    decoded = decodeURIComponent(decoded);
                } catch (error) {
                    break;
                }
            }

            return /^https?:\/\//i.test(decoded) ? decoded : raw;
        } catch (error) {
            return raw;
        }
    },

    normalizeExternalLink(urlValue) {
        let raw = String(urlValue || '').trim();
        if (!raw) return '';

        raw = raw.replace(/^['"<\s]+|[>'"\s]+$/g, '').replace(/&amp;/gi, '&');
        let cleaned = raw;

        if (AppContext.host && typeof AppContext.host.cleanSharePointUrl === 'function') {
            try {
                cleaned = AppContext.host.cleanSharePointUrl(raw) || raw;
            } catch (error) {
                cleaned = raw;
            }
        }

        cleaned = String(cleaned || '').trim().replace(/^<|>$/g, '').replace(/&amp;/gi, '&');
        cleaned = this.unwrapSafeLink(cleaned);
        if (!cleaned) return '';

        if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(cleaned) && /^www\./i.test(cleaned)) {
            cleaned = `https://${cleaned}`;
        }
        return cleaned;
    },

    async runDurationMigrationOnce() {
        const storage = ScheduleData.getStorage();
        const patchKey = 'v302_schedule_studio_duration_patch';
        if (storage.getItem(patchKey)) return;

        const changed = ScheduleData.migrateDurationDaysInSchedules(this.state.schedules);
        if (changed) {
            try {
                await ScheduleData.saveSchedules(this.state.schedules, false);
                this.notify('Timeline durations were inferred for existing items.', 'success');
            } catch (error) {
                console.warn('[Schedule Studio] Duration migration save failed:', error);
            }
        }

        storage.setItem(patchKey, 'true');
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

    stampEntity(target, touch = false) {
        if (!target || typeof target !== 'object') return target;

        if (AppContext.host && typeof AppContext.host.applyDataTimestamps === 'function') {
            AppContext.host.applyDataTimestamps(target, { touch });
            return target;
        }

        const now = new Date().toISOString();
        const modifiedBy = ScheduleData.getCurrentUser()?.user || ScheduleData.getCurrentUser()?.role || 'system';
        if (!target.createdAt) target.createdAt = now;
        if (!target.lastModified) target.lastModified = target.createdAt;
        if (!target.modifiedBy) target.modifiedBy = modifiedBy;
        if (touch) {
            target.lastModified = now;
            target.modifiedBy = modifiedBy;
        }
        return target;
    },

    stampSchedule(scheduleId, options = {}) {
        const targetId = scheduleId || this.state.activeScheduleId;
        const schedule = this.state.schedules[targetId];
        if (!schedule) return;

        this.stampEntity(schedule, Boolean(options.touchGroup));
        if (!Array.isArray(schedule.items)) return;

        if (options.touchAllItems) {
            schedule.items.forEach(item => this.stampEntity(item, true));
            return;
        }

        if (typeof options.itemIndex === 'number' && schedule.items[options.itemIndex]) {
            this.stampEntity(schedule.items[options.itemIndex], true);
        }
    },

    async persist() {
        try {
            await ScheduleData.saveSchedules(this.state.schedules, true);
            this.loadState();
            this.render();
            return true;
        } catch (error) {
            console.error('[Schedule Studio] Save failed:', error);
            this.loadState();
            this.render();
            alert('Failed to sync the schedule to the server. The latest server version has been restored.');
            return false;
        }
    },

    async createSchedule() {
        if (!this.canManage()) return;
        const keys = Object.keys(this.state.schedules).sort();
        const nextKey = keys.length ? String.fromCharCode(keys[keys.length - 1].charCodeAt(0) + 1) : 'A';
        this.state.schedules[nextKey] = { items: [], assigned: null };
        this.stampSchedule(nextKey, { touchGroup: true });
        this.state.activeScheduleId = nextKey;
        const saved = await this.persist();
        if (saved) {
            this.openNewScheduleTemplatePrompt(nextKey);
        }
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
            this.stampEntity(nextSchedules.A, true);
        } else {
            oldKeys.forEach((oldKey, index) => {
                nextSchedules[String.fromCharCode(65 + index)] = schedules[oldKey];
                if (oldKey !== String.fromCharCode(65 + index)) {
                    this.stampEntity(nextSchedules[String.fromCharCode(65 + index)], true);
                }
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
        this.stampSchedule(nextKey, { touchGroup: true, touchAllItems: true });
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
        this.stampSchedule(this.state.activeScheduleId, { touchGroup: true, touchAllItems: true });
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
                this.stampSchedule(key, { touchGroup: true });
            }
        });

        this.getActiveSchedule().assigned = groupId;
        this.stampSchedule(this.state.activeScheduleId, { touchGroup: true });
        await this.persist();
    },

    async clearAssignment() {
        if (!this.canEdit()) return;
        if (!confirm('Clear this timeline assignment?')) return;
        this.getActiveSchedule().assigned = null;
        this.stampSchedule(this.state.activeScheduleId, { touchGroup: true });
        await this.persist();
    },

    async addItem() {
        if (!this.canManage()) return;
        const defaultStart = ScheduleData.getTodayOrNextBusinessDayDash();
        const defaultWindow = ScheduleData.calculateWindow(defaultStart, 1);
        this.getActiveSchedule().items.push({
            dateRange: defaultWindow ? defaultWindow.dateRange : this.todayString(),
            dueDate: defaultWindow ? defaultWindow.endDateSlash : this.todayString(),
            durationDays: 1,
            courseName: 'New Item',
            materialLink: '',
            assessmentLink: '',
            openTime: '08:00',
            closeTime: '17:00',
            ignoreTime: false,
            isVetting: false,
            isLive: false
        });
        this.stampSchedule(this.state.activeScheduleId, {
            touchGroup: true,
            itemIndex: this.getActiveSchedule().items.length - 1
        });
        await this.persist();
        this.editItem(this.getActiveSchedule().items.length - 1);
    },

    editItem(index) {
        if (!this.canEdit()) return;
        const item = this.getActiveSchedule().items[index];
        const range = ScheduleData.parseRange(item);
        const inferredDuration = ScheduleData.normalizeDurationDays(item.durationDays) || ScheduleData.inferDurationDays(item);
        const tests = ScheduleData.getTests();

        document.getElementById('edit-step-index').value = index;
        document.getElementById('edit-start-date').value = this.toInputDate(range.start);
        document.getElementById('edit-end-date').value = this.toInputDate(range.end || range.start);
        document.getElementById('edit-duration-days').value = inferredDuration || '';
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
        this.previewEditorFromDuration();
    },

    closeEditor() {
        document.getElementById('schedule-modal').classList.add('hidden');
    },

    async saveEditor() {
        const index = Number(document.getElementById('edit-step-index').value);
        const item = this.getActiveSchedule().items[index];
        if (!item) return;

        const startDateInput = document.getElementById('edit-start-date').value;
        const endDateInput = document.getElementById('edit-end-date').value || startDateInput;
        const durationInput = document.getElementById('edit-duration-days').value;
        const durationDays = ScheduleData.normalizeDurationDays(durationInput);

        if (durationDays) {
            const calculated = ScheduleData.calculateWindow(startDateInput, durationDays);
            if (!calculated) return alert('Please provide a valid start date for duration-based scheduling.');

            item.durationDays = durationDays;
            item.dateRange = calculated.dateRange;
            item.dueDate = calculated.endDateSlash;
            document.getElementById('edit-start-date').value = calculated.startDateDash;
            document.getElementById('edit-end-date').value = calculated.endDateDash;
        } else {
            if (!startDateInput || !endDateInput) return alert('Start and end dates are required.');
            const normalizedStart = ScheduleData.normalizeDate(startDateInput);
            const normalizedEnd = ScheduleData.normalizeDate(endDateInput);
            item.dateRange = ScheduleData.formatRange(normalizedStart, normalizedEnd);
            item.dueDate = normalizedEnd;
            delete item.durationDays;
        }

        item.courseName = document.getElementById('edit-course-name').value.trim();
        item.materialLink = this.normalizeExternalLink(document.getElementById('edit-material-link').value);
        item.assessmentLink = this.normalizeExternalLink(document.getElementById('edit-assessment-link').value);
        item.openTime = document.getElementById('edit-open-time').value;
        item.closeTime = document.getElementById('edit-close-time').value;
        item.ignoreTime = document.getElementById('edit-ignore-time').checked;
        item.isVetting = document.getElementById('edit-is-vetting').checked;
        item.isLive = document.getElementById('edit-is-live').checked;

        const linkedTestId = document.getElementById('edit-linked-test').value;
        if (linkedTestId) item.linkedTestId = linkedTestId;
        else delete item.linkedTestId;

        this.stampSchedule(this.state.activeScheduleId, { touchGroup: true, itemIndex: index });
        await this.persist();
        this.closeEditor();
    },

    previewEditorFromDuration() {
        const startEl = document.getElementById('edit-start-date');
        const endEl = document.getElementById('edit-end-date');
        const durationEl = document.getElementById('edit-duration-days');
        if (!startEl || !endEl || !durationEl) return;

        const durationDays = ScheduleData.normalizeDurationDays(durationEl.value);
        if (!durationDays) return;

        const calculated = ScheduleData.calculateWindow(startEl.value, durationDays);
        if (!calculated) return;
        startEl.value = calculated.startDateDash;
        endEl.value = calculated.endDateDash;
    },

    async deleteItem(index) {
        if (!this.canEdit()) return;
        if (!confirm('Delete this timeline item?')) return;
        this.getActiveSchedule().items.splice(index, 1);
        this.stampSchedule(this.state.activeScheduleId, { touchGroup: true });
        await this.persist();
    },

    async moveItem(index, delta) {
        if (!this.canEdit()) return;
        const items = this.getActiveSchedule().items;
        const targetIndex = index + delta;
        if (targetIndex < 0 || targetIndex >= items.length) return;
        const [item] = items.splice(index, 1);
        items.splice(targetIndex, 0, item);
        this.stampSchedule(this.state.activeScheduleId, { touchGroup: true });
        await this.persist();
    },

    openNewScheduleTemplatePrompt(scheduleId) {
        if (!this.canManage()) return;
        const modal = document.getElementById('new-schedule-template-modal');
        const scheduleInput = document.getElementById('new-schedule-template-id');
        const title = document.getElementById('new-schedule-template-title');
        const hint = document.getElementById('new-schedule-template-hint');
        if (!modal || !scheduleInput || !title || !hint) return;

        const templates = ScheduleData.getTemplates();
        scheduleInput.value = scheduleId;
        title.textContent = `Timeline ${scheduleId} Created`;
        hint.textContent = templates.length
            ? `${templates.length} saved template${templates.length === 1 ? '' : 's'} available.`
            : 'No templates saved yet. Click "Edit Templates" to create one.';
        modal.classList.remove('hidden');
    },

    closeNewScheduleTemplatePrompt() {
        const modal = document.getElementById('new-schedule-template-modal');
        if (modal) modal.classList.add('hidden');
    },

    handleNewScheduleEditTemplates() {
        const targetId = document.getElementById('new-schedule-template-id')?.value || this.state.activeScheduleId;
        this.closeNewScheduleTemplatePrompt();
        this.setSchedule(targetId);
        this.openTemplateManager({ defaultName: `Schedule ${targetId} Template` });
    },

    handleNewScheduleAddTemplate() {
        const targetId = document.getElementById('new-schedule-template-id')?.value || this.state.activeScheduleId;
        this.closeNewScheduleTemplatePrompt();
        this.setSchedule(targetId);
        this.openApplyTemplateModal(targetId, { confirmReplace: false });
    },

    openApplyTemplateModal(targetScheduleId = this.state.activeScheduleId, options = {}) {
        if (!this.canManage()) return;
        const templates = ScheduleData.getTemplates();
        if (!templates.length) {
            alert('No saved templates yet. Create one first.');
            this.openTemplateManager({ defaultName: `Schedule ${targetScheduleId} Template` });
            return;
        }

        const modal = document.getElementById('template-apply-modal');
        const targetInput = document.getElementById('template-apply-target-schedule');
        const select = document.getElementById('template-apply-select');
        const startInput = document.getElementById('template-apply-start-date');
        if (!modal || !targetInput || !select || !startInput) return;

        targetInput.value = targetScheduleId;
        select.innerHTML = '';
        templates.forEach(template => {
            const count = Array.isArray(template.items) ? template.items.length : 0;
            select.add(new Option(`${template.name} (${count} step${count === 1 ? '' : 's'})`, template.id));
        });

        const schedule = this.state.schedules[targetScheduleId] || { items: [] };
        const first = Array.isArray(schedule.items) && schedule.items[0] ? ScheduleData.parseRange(schedule.items[0]).start : '';
        const suggestedStart = ScheduleData.toDateDash(ScheduleData.parseStrictDate(first)) || ScheduleData.getTodayOrNextBusinessDayDash();
        startInput.value = suggestedStart;
        modal.dataset.confirmReplace = options.confirmReplace === false ? '0' : '1';
        modal.classList.remove('hidden');
    },

    closeApplyTemplateModal() {
        const modal = document.getElementById('template-apply-modal');
        if (modal) modal.classList.add('hidden');
    },

    async applyTemplateFromModal() {
        if (!this.canManage()) return;
        const modal = document.getElementById('template-apply-modal');
        const targetScheduleId = document.getElementById('template-apply-target-schedule')?.value || this.state.activeScheduleId;
        const templateId = document.getElementById('template-apply-select')?.value;
        const startDate = document.getElementById('template-apply-start-date')?.value;
        if (!templateId) return alert('Please choose a template.');
        if (!startDate) return alert('Please choose a start date.');

        const templates = ScheduleData.getTemplates();
        const selectedTemplate = templates.find(template => String(template.id || '') === String(templateId || ''));
        if (!selectedTemplate) return alert('Template not found.');

        const shouldConfirmReplace = modal?.dataset.confirmReplace !== '0';
        const applied = await this.applyTemplateToScheduleById(targetScheduleId, selectedTemplate, startDate, { confirmReplace: shouldConfirmReplace });
        if (!applied) return;
        this.closeApplyTemplateModal();
    },

    async applyTemplateToScheduleById(targetScheduleId, template, startDateInput, options = {}) {
        if (!this.canManage()) return false;
        const schedule = this.state.schedules[targetScheduleId];
        if (!schedule) return false;

        const normalizedStart = ScheduleData.toDateDash(ScheduleData.parseStrictDate(startDateInput));
        if (!normalizedStart) {
            alert('Invalid start date. Use YYYY-MM-DD.');
            return false;
        }

        if (options.confirmReplace !== false && Array.isArray(schedule.items) && schedule.items.length > 0) {
            if (!confirm(`Applying "${template.name}" will replace all current timeline items in Schedule ${targetScheduleId}. Continue?`)) {
                return false;
            }
        }

        let rebuiltItems = [];
        try {
            rebuiltItems = ScheduleData.buildScheduleItemsFromTemplateItems(template.items || [], normalizedStart) || [];
        } catch (error) {
            console.error('[Schedule Studio] Template apply failed:', error);
            alert('Could not apply template. Please verify template data.');
            return false;
        }

        schedule.items = rebuiltItems;
        this.stampSchedule(targetScheduleId, { touchGroup: true, touchAllItems: true });
        this.state.activeScheduleId = targetScheduleId;
        const saved = await this.persist();
        if (!saved) return false;
        this.notify(`Template "${template.name}" applied to Schedule ${targetScheduleId}.`, 'success');
        return true;
    },

    saveCurrentAsTemplate() {
        if (!this.canManage()) return;
        const schedule = this.getActiveSchedule();
        if (!Array.isArray(schedule.items) || !schedule.items.length) {
            alert('No timeline items to save as a template.');
            return;
        }

        this.openTemplateManager({
            prefillItems: ScheduleData.buildTemplateItemsFromScheduleItems(schedule.items),
            defaultName: `Schedule ${this.state.activeScheduleId} Template`
        });
    },

    async recalculateActiveScheduleDates() {
        if (!this.canManage()) return;
        const schedule = this.getActiveSchedule();
        if (!Array.isArray(schedule.items) || !schedule.items.length) {
            alert('No timeline items to recalculate.');
            return;
        }

        const firstStart = ScheduleData.parseRange(schedule.items[0]).start;
        const suggestion = ScheduleData.toDateDash(ScheduleData.parseStrictDate(firstStart)) || ScheduleData.getTodayOrNextBusinessDayDash();
        const entered = prompt('Enter new timeline start date (YYYY-MM-DD):', suggestion);
        if (entered === null) return;

        const templateLike = {
            id: `temp_${Date.now()}`,
            name: 'Temporary Recalculate Template',
            items: ScheduleData.buildTemplateItemsFromScheduleItems(schedule.items)
        };
        await this.applyTemplateToScheduleById(this.state.activeScheduleId, templateLike, entered, { confirmReplace: false });
    },

    openTemplateManager(options = {}) {
        if (!this.canManage()) return;
        const modal = document.getElementById('template-manager-modal');
        if (!modal) return;
        modal.classList.remove('hidden');

        if (Array.isArray(options.prefillItems) && options.prefillItems.length > 0) {
            this.startNewTemplateDraft({
                prefillItems: options.prefillItems,
                defaultName: options.defaultName || ''
            });
            return;
        }

        const templates = ScheduleData.getTemplates();
        if (templates.length) {
            this.loadTemplateIntoEditor(options.templateId || templates[0].id);
            return;
        }

        this.startNewTemplateDraft({ defaultName: options.defaultName || '' });
    },

    closeTemplateManager() {
        const modal = document.getElementById('template-manager-modal');
        if (modal) modal.classList.add('hidden');
    },

    refreshTemplateSelect(selectedTemplateId = '') {
        const select = document.getElementById('template-select');
        if (!select) return;
        const templates = ScheduleData.getTemplates();
        select.innerHTML = '<option value="">-- New Template --</option>';
        templates.forEach(template => {
            const count = Array.isArray(template.items) ? template.items.length : 0;
            select.add(new Option(`${template.name} (${count} step${count === 1 ? '' : 's'})`, template.id));
        });
        select.value = selectedTemplateId || '';
    },

    startNewTemplateDraft(options = {}) {
        if (!this.canManage()) return;
        const prefillItems = Array.isArray(options.prefillItems) ? options.prefillItems : [];
        const normalizedItems = ScheduleData.buildTemplateItemsFromScheduleItems(prefillItems);
        this.state.templateEditor = {
            selectedTemplateId: '',
            templateName: String(options.defaultName || '').trim(),
            items: normalizedItems.length ? normalizedItems : [{ courseName: 'Step 1', durationDays: 1 }]
        };

        const nameInput = document.getElementById('template-name');
        if (nameInput) nameInput.value = this.state.templateEditor.templateName;
        this.refreshTemplateSelect('');
        this.renderTemplateEditorRows();
    },

    loadTemplateIntoEditor(templateId) {
        if (!this.canManage()) return;
        const safeTemplateId = String(templateId || '').trim();
        if (!safeTemplateId) {
            this.startNewTemplateDraft();
            return;
        }

        const templates = ScheduleData.getTemplates();
        const selected = templates.find(template => String(template.id || '') === safeTemplateId);
        if (!selected) {
            this.startNewTemplateDraft();
            return;
        }

        this.state.templateEditor = {
            selectedTemplateId: selected.id,
            templateName: selected.name || '',
            items: ScheduleData.buildTemplateItemsFromScheduleItems(selected.items || [])
        };

        const nameInput = document.getElementById('template-name');
        if (nameInput) nameInput.value = this.state.templateEditor.templateName;
        this.refreshTemplateSelect(selected.id);
        this.renderTemplateEditorRows();
    },

    syncTemplateEditorFromDom() {
        const editor = this.state.templateEditor || { selectedTemplateId: '', templateName: '', items: [] };
        const nameInput = document.getElementById('template-name');
        if (nameInput) editor.templateName = String(nameInput.value || '').trim();

        const rows = Array.from(document.querySelectorAll('#template-items-container [data-template-row]'));
        const previousItems = Array.isArray(editor.items) ? editor.items : [];
        editor.items = rows.map((row, index) => {
            const base = JSON.parse(JSON.stringify(previousItems[index] || {}));
            const courseName = String(row.querySelector('.template-course-name')?.value || '').trim() || `Step ${index + 1}`;
            const durationDays = ScheduleData.normalizeDurationDays(row.querySelector('.template-duration-days')?.value) || 1;
            base.courseName = courseName;
            base.durationDays = durationDays;
            return base;
        });

        this.state.templateEditor = editor;
    },

    renderTemplateEditorRows() {
        const container = document.getElementById('template-items-container');
        if (!container) return;

        const editor = this.state.templateEditor || { items: [] };
        const safeItems = Array.isArray(editor.items) && editor.items.length
            ? editor.items
            : [{ courseName: 'Step 1', durationDays: 1 }];
        editor.items = safeItems;
        this.state.templateEditor = editor;

        container.innerHTML = safeItems.map((item, index) => `
            <div data-template-row="1" class="studio-grid three" style="margin-bottom:8px; align-items:end;">
                <label style="grid-column: span 2;">
                    <span>Step ${index + 1} Course Name</span>
                    <input type="text" class="template-course-name" value="${TimelineUI.escape(item.courseName || '')}" placeholder="Timeline step name">
                </label>
                <label>
                    <span>Duration (Days)</span>
                    <input type="number" class="template-duration-days" min="1" step="1" value="${ScheduleData.normalizeDurationDays(item.durationDays) || 1}">
                </label>
                <div style="grid-column: 1 / -1; text-align:right;">
                    <button class="studio-btn secondary" onclick="App.removeTemplateRow(${index})"><i class="fas fa-trash"></i> Remove</button>
                </div>
            </div>
        `).join('');
    },

    addTemplateRow() {
        if (!this.canManage()) return;
        this.syncTemplateEditorFromDom();
        const editor = this.state.templateEditor || { selectedTemplateId: '', templateName: '', items: [] };
        const nextIndex = Array.isArray(editor.items) ? editor.items.length : 0;
        if (!Array.isArray(editor.items)) editor.items = [];
        editor.items.push({ courseName: `Step ${nextIndex + 1}`, durationDays: 1 });
        this.state.templateEditor = editor;
        this.renderTemplateEditorRows();
    },

    removeTemplateRow(index) {
        if (!this.canManage()) return;
        this.syncTemplateEditorFromDom();
        const editor = this.state.templateEditor || { items: [] };
        if (!Array.isArray(editor.items) || !editor.items.length) return;
        const safeIndex = Number(index);
        if (!Number.isFinite(safeIndex) || safeIndex < 0 || safeIndex >= editor.items.length) return;
        editor.items.splice(safeIndex, 1);
        if (!editor.items.length) editor.items.push({ courseName: 'Step 1', durationDays: 1 });
        this.state.templateEditor = editor;
        this.renderTemplateEditorRows();
    },

    saveTemplateFromEditor() {
        if (!this.canManage()) return;
        this.syncTemplateEditorFromDom();
        const editor = this.state.templateEditor || { selectedTemplateId: '', templateName: '', items: [] };
        const templateName = String(editor.templateName || '').trim();
        if (!templateName) return alert('Template name is required.');
        if (!Array.isArray(editor.items) || !editor.items.length) return alert('Add at least one template step.');

        const normalizedItems = editor.items.map((item, index) => {
            const cloned = JSON.parse(JSON.stringify(item || {}));
            cloned.courseName = String(cloned.courseName || '').trim() || `Step ${index + 1}`;
            cloned.durationDays = ScheduleData.normalizeDurationDays(cloned.durationDays) || 1;
            return cloned;
        });

        const templates = ScheduleData.getTemplates();
        const selectedId = String(editor.selectedTemplateId || '').trim();
        let existingIndex = selectedId
            ? templates.findIndex(template => String(template.id || '') === selectedId)
            : -1;

        const sameNameIndex = templates.findIndex(template => String(template.name || '').trim().toLowerCase() === templateName.toLowerCase());
        if (sameNameIndex >= 0 && sameNameIndex !== existingIndex) {
            if (!confirm(`Template "${templates[sameNameIndex].name}" already exists. Overwrite it?`)) return;
            existingIndex = sameNameIndex;
        }

        const now = new Date().toISOString();
        const nextTemplate = {
            id: existingIndex >= 0 ? templates[existingIndex].id : `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: templateName,
            sourceScheduleId: this.state.activeScheduleId,
            itemCount: normalizedItems.length,
            items: normalizedItems,
            createdAt: existingIndex >= 0 ? templates[existingIndex].createdAt : now,
            updatedAt: now
        };

        if (existingIndex >= 0) templates[existingIndex] = nextTemplate;
        else templates.push(nextTemplate);

        ScheduleData.saveTemplates(templates);
        this.state.templateEditor = {
            selectedTemplateId: nextTemplate.id,
            templateName,
            items: normalizedItems
        };
        this.refreshTemplateSelect(nextTemplate.id);
        this.renderTemplateEditorRows();
        this.notify(`Template "${templateName}" saved.`, 'success');
        this.render();
    },

    deleteTemplateFromEditor() {
        if (!this.canManage()) return;
        const editor = this.state.templateEditor || {};
        const selectedId = String(editor.selectedTemplateId || '').trim();
        if (!selectedId) return alert('Select a saved template to delete.');

        const templates = ScheduleData.getTemplates();
        const existingIndex = templates.findIndex(template => String(template.id || '') === selectedId);
        if (existingIndex < 0) return alert('Template not found.');
        if (!confirm(`Delete template "${templates[existingIndex].name}"?`)) return;

        const deletedName = templates[existingIndex].name;
        templates.splice(existingIndex, 1);
        ScheduleData.saveTemplates(templates);

        if (templates.length) {
            this.loadTemplateIntoEditor(templates[0].id);
        } else {
            this.startNewTemplateDraft();
        }
        this.notify(`Template "${deletedName}" deleted.`, 'success');
        this.render();
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
        const normalizedUrl = this.normalizeExternalLink(item.materialLink);
        if (!normalizedUrl) {
            alert('This material link is invalid. Please edit the timeline step and re-save the URL.');
            return;
        }

        if (AppContext.host && AppContext.host.StudyMonitor && typeof AppContext.host.StudyMonitor.openStudyWindow === 'function') {
            AppContext.host.StudyMonitor.openStudyWindow(normalizedUrl, item.courseName || 'Study Material');
            return;
        }

        const role = ScheduleData.getCurrentUser()?.role;
        if (role === 'trainee') {
            alert('Study material can only open through the in-app secure study browser. Please refresh the app and try again.');
            return;
        }

        window.open(normalizedUrl, '_blank');
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
            const normalizedUrl = this.normalizeExternalLink(item.assessmentLink);
            if (!normalizedUrl) {
                alert('This assessment link is invalid. Please edit the timeline step and re-save the URL.');
                return;
            }
            window.open(normalizedUrl, '_blank');
        }
    },

    refresh() {
        this.loadState();
        this.render();
    },

    todayString() {
        return ScheduleData.toDateSlash(new Date());
    },

    toStorageDate(dateObj) {
        return ScheduleData.toDateSlash(dateObj);
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

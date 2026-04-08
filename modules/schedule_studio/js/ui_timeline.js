const TimelineUI = {
    renderScheduleTabs(schedules, activeId, canManage) {
        const keys = Object.keys(schedules).sort();

        return `
            <div class="studio-schedule-list">
                ${keys.map(key => {
                    const assigned = schedules[key].assigned;
                    const rosterCount = assigned ? (ScheduleData.getRosters()[assigned] || []).length : 0;
                    return `
                        <button class="studio-schedule-tab ${key === activeId ? 'active' : ''}" onclick="App.setSchedule('${key}')">
                            <div><strong>Schedule ${key}</strong></div>
                            <div class="studio-tab-meta">${assigned ? ScheduleData.getGroupLabel(assigned, rosterCount) : 'Unassigned'}</div>
                        </button>
                    `;
                }).join('')}
                ${canManage ? `<button class="studio-btn primary" onclick="App.createSchedule()"><i class="fas fa-plus"></i> New Timeline</button>` : ''}
            </div>
        `;
    },

    renderToolbar(scheduleData, currentView, canEdit, canManage, options = {}) {
        const rosters = ScheduleData.getRosters();
        const rosterOptions = Object.keys(rosters).sort().reverse().map(groupId => {
            const label = ScheduleData.getGroupLabel(groupId, (rosters[groupId] || []).length);
            return `<option value="${this.escape(groupId)}">${this.escape(label)}</option>`;
        }).join('');
        const templateCount = Number(options.templateCount || 0);
        const totalSchedules = Number(options.totalSchedules || 0);

        return `
            <div class="studio-toolbar">
                <div class="studio-toolbar-left">
                    <button class="studio-tab ${currentView === 'list' ? 'active' : ''}" onclick="App.setView('list')"><i class="fas fa-list"></i> Timeline</button>
                    <button class="studio-tab ${currentView === 'calendar' ? 'active' : ''}" onclick="App.setView('calendar')"><i class="fas fa-calendar-days"></i> Calendar</button>
                </div>
                <div class="studio-toolbar-right">
                    ${canEdit ? `<button class="studio-btn secondary" onclick="App.duplicateSchedule()"><i class="fas fa-clone"></i> Duplicate</button>` : ''}
                    ${canEdit ? `<button class="studio-btn secondary" onclick="App.cloneSchedule()"><i class="fas fa-copy"></i> Copy From</button>` : ''}
                    ${canManage ? `<button class="studio-btn secondary" onclick="App.saveCurrentAsTemplate()"><i class="fas fa-save"></i> Save Template</button>` : ''}
                    ${canManage ? `<button class="studio-btn secondary" onclick="App.openTemplateManager()"><i class="fas fa-pen-ruler"></i> Edit Templates</button>` : ''}
                    ${canManage ? `<button class="studio-btn secondary" onclick="App.openApplyTemplateModal()"><i class="fas fa-layer-group"></i> Add Template</button>` : ''}
                    ${canManage ? `<button class="studio-btn secondary" onclick="App.recalculateActiveScheduleDates()"><i class="fas fa-calendar-check"></i> Recalculate</button>` : ''}
                    ${canManage ? `<button class="studio-btn secondary" onclick="App.deleteSchedule()" ${totalSchedules <= 1 ? 'disabled title="At least one timeline must remain"' : ''}><i class="fas fa-trash"></i> Delete Timeline</button>` : ''}
                    ${canManage ? `<button class="studio-btn primary" onclick="App.addItem()"><i class="fas fa-plus"></i> Add Step</button>` : ''}
                </div>
            </div>
            ${canManage ? `<div class="studio-status" style="margin-bottom:10px;">Saved templates: ${templateCount}</div>` : ''}
            ${scheduleData.assigned ? `
                <div class="studio-banner assigned">
                    <strong>Assigned to:</strong> ${this.escape(ScheduleData.getGroupLabel(scheduleData.assigned, (rosters[scheduleData.assigned] || []).length))}
                    ${canEdit ? `<div class="studio-item-actions" style="margin-top:10px;"><button class="studio-btn secondary" onclick="App.clearAssignment()"><i class="fas fa-link-slash"></i> Unassign</button>${canManage ? `<button class="studio-btn secondary" onclick="App.deleteSchedule()"><i class="fas fa-trash"></i> Delete Timeline</button>` : ''}</div>` : ''}
                </div>
            ` : `
                <div class="studio-banner unassigned">
                    <div><strong>No group assigned</strong></div>
                    <div class="studio-status">A group must be assigned to this timeline before trainees inherit it.</div>
                    ${canEdit ? `
                        <div class="studio-grid two" style="margin-top:12px;">
                            <label>
                                <span>Select Group</span>
                                <select id="schedule-group-select">
                                    <option value="">-- Select Group --</option>
                                    ${rosterOptions}
                                </select>
                            </label>
                            <div style="display:flex; align-items:end;">
                                <button class="studio-btn primary" onclick="App.assignSchedule()">Assign Timeline</button>
                            </div>
                        </div>
                    ` : ''}
                </div>
            `}
        `;
    },

    renderTimeline(items, options) {
        if (!items.length) {
            return `<div class="studio-empty"><i class="fas fa-calendar-plus"></i><div style="margin-top:10px;">No timeline items yet.</div></div>`;
        }

        return `
            <div class="studio-timeline">
                ${items.map((item, index) => this.renderItem(item, index, options)).join('')}
            </div>
        `;
    },

    renderItem(item, index, options) {
        const range = ScheduleData.parseRange(item);
        const durationDays = ScheduleData.normalizeDurationDays(item.durationDays) || ScheduleData.inferDurationDays(item);
        const materialState = options.getMaterialState(item);
        const assessmentState = options.getAssessmentState(item);
        const chips = [
            range.start ? `Start ${range.start}` : '',
            range.end ? `Assessment ${range.end}` : '',
            durationDays ? `${durationDays} day${durationDays === 1 ? '' : 's'}` : '',
            item.isVetting ? 'Vetting' : '',
            item.isLive ? 'Live' : '',
            item.linkedTestId ? 'Linked Test' : '',
            item.assessmentLink ? 'External Assessment' : ''
        ].filter(Boolean);

        return `
            <div class="studio-item">
                <div class="studio-item-top">
                    <div>
                        <div class="studio-item-date">${this.escape(ScheduleData.formatRange(range.start, range.end)) || 'No dates set'}</div>
                        <h4 class="studio-item-title">${this.escape(item.courseName || 'Untitled Step')}</h4>
                        <div class="studio-item-meta">
                            ${chips.map(chip => `<span class="studio-chip">${this.escape(chip)}</span>`).join('')}
                        </div>
                    </div>
                    ${options.canEdit ? `
                        <div class="studio-item-actions">
                            <button class="studio-btn secondary" onclick="App.moveItem(${index}, -1)" ${index === 0 ? 'disabled' : ''}><i class="fas fa-arrow-up"></i></button>
                            <button class="studio-btn secondary" onclick="App.moveItem(${index}, 1)" ${index === options.totalItems - 1 ? 'disabled' : ''}><i class="fas fa-arrow-down"></i></button>
                            <button class="studio-btn secondary" onclick="App.editItem(${index})"><i class="fas fa-pen"></i> Edit</button>
                            <button class="studio-btn secondary" onclick="App.deleteItem(${index})"><i class="fas fa-trash"></i></button>
                        </div>
                    ` : ''}
                </div>

                ${item.materialLink ? `<div class="studio-status">Material: ${this.escape(materialState.label)}</div>` : ''}
                ${(item.linkedTestId || item.assessmentLink) ? `<div class="studio-status">Assessment: ${this.escape(assessmentState.label)}</div>` : ''}

                <div class="studio-item-actions">
                    ${item.materialLink ? `
                        <button class="studio-btn ${materialState.enabled ? 'primary' : 'secondary'}" onclick="App.openMaterial(${index})" ${materialState.enabled ? '' : 'disabled'}>
                            <i class="fas fa-book-open"></i> ${materialState.enabled ? 'Study Material' : 'Material Locked'}
                        </button>
                    ` : ''}
                    ${(item.linkedTestId || item.assessmentLink) ? `
                        <button class="studio-btn ${assessmentState.enabled ? 'primary' : 'secondary'}" onclick="App.openAssessment(${index})" ${assessmentState.enabled ? '' : 'disabled'}>
                            <i class="fas fa-file-signature"></i> ${assessmentState.buttonLabel}
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    },

    escape(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
};

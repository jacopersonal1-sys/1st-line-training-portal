/* ================= TEAMLEADER HUB & TASKS ================= */

const TLTasks = {
    // --- CONFIGURATION ---
    dailyPhases: [
        {
            id: 'start_shift',
            title: 'Start of Shift',
            color: '#f39c12',
            icon: 'fa-sun',
            tasks: [
                { id: 't_attend', label: 'Confirm Staff Attendance', type: 'team_attendance' },
                { id: 't_network', label: 'Check Network Outages', type: 'outage_form' },
                { id: 't_backlog', label: 'Review Ticket Backlog', type: 'dev_placeholder' },
                { id: 't_handover', label: 'Review Handover Notes', type: 'dev_placeholder' },
                { id: 't_assign', label: 'Assign Operational Responsibilities', type: 'dev_placeholder' }
            ]
        },
        {
            id: 'during_shift',
            title: 'During Shift',
            color: '#3498db',
            icon: 'fa-headset',
            tasks: [
                { id: 't_queue', label: 'Monitor Queue Wait Times', type: 'dev_placeholder' },
                { id: 't_support', label: 'Support Agents (Complex Cases)', type: 'team_checklist' },
                { id: 't_coach', label: 'Provide Real-Time Coaching', type: 'team_coaching' },
                { id: 't_metrics', label: 'Track Performance Metrics', type: 'dev_placeholder' }
            ]
        },
        {
            id: 'mid_shift',
            title: 'Mid Shift Review',
            color: '#9b59b6',
            icon: 'fa-chart-line',
            tasks: [
                { id: 't_eval_team', label: 'Evaluate Teams Performance', type: 'dev_placeholder' },
                { id: 't_bottleneck', label: 'Identify Operational Bottlenecks', type: 'dev_placeholder' },
                { id: 't_workload', label: 'Adjust Workload Distribution', type: 'dev_placeholder' }
            ]
        },
        {
            id: 'end_shift',
            title: 'End of Shift',
            color: '#2c3e50',
            icon: 'fa-moon',
            tasks: [
                { id: 't_perf_out', label: 'Review Performance Outcomes', type: 'dev_placeholder' },
                { id: 't_doc_issues', label: 'Document Operational Issues', type: 'dev_placeholder' },
                { id: 't_shift_handover', label: 'Prepare Shift Handover Notes', type: 'dev_placeholder' }
            ]
        }
    ],

    weeklyPhases: [
        {
            id: 'weekly_planning',
            title: 'Weekly Planning',
            color: '#1abc9c',
            icon: 'fa-calendar-alt',
            tasks: [
                { id: 'w_metrics', label: 'Review Weekly Performance Metrics', type: 'dev_placeholder' },
                { id: 'w_issues', label: 'Identify Recurring Operational Issues', type: 'dev_placeholder' },
                { id: 'w_gaps', label: 'Identify Staffing or Training Gaps', type: 'dev_placeholder' }
            ]
        },
        {
            id: 'team_mgmt',
            title: 'Team Management',
            color: '#e67e22',
            icon: 'fa-users-cog',
            tasks: [
                { id: 'w_coaching', label: 'Conduct One-on-One Coaching Sessions', type: 'team_coaching_extended' },
                { id: 'w_recognize', label: 'Recognize Strong Performers', type: 'dev_placeholder' },
                { id: 'w_behavior', label: 'Address Behavioral or Performance Issues', type: 'dev_placeholder' }
            ]
        },
        {
            id: 'op_review',
            title: 'Operational Review',
            color: '#e74c3c',
            icon: 'fa-chart-bar',
            tasks: [
                { id: 'w_qa', label: 'Review Quality Assurance Results', type: 'dev_placeholder' },
                { id: 'w_complaints', label: 'Review Customer Complaints', type: 'dev_placeholder' },
                { id: 'w_ticket_qual', label: 'Review Ticket Quality', type: 'dev_placeholder' }
            ]
        },
        {
            id: 'cont_imp',
            title: 'Continuous Improvement',
            color: '#9b59b6',
            icon: 'fa-rocket',
            tasks: [
                { id: 'w_recurring', label: 'Identify Recurring Support Issues', type: 'dev_placeholder' },
                { id: 'w_docs', label: 'Improve Documentation or Troubleshooting Guides', type: 'dev_placeholder' },
                { id: 'w_improve', label: 'Propose Operational Improvements', type: 'dev_placeholder' }
            ]
        }
    ],

    // --- STATE ---
    currentView: 'timeline', // 'timeline', 'my_team', 'overview', 'roster'
    activeTab: 'daily', // 'daily' or 'weekly'
    timelineViewMode: 'standard', // 'standard', 'compact', 'stepper'
    currentDate: new Date().toISOString().split('T')[0],

    // --- MAIN RENDERER ---
    renderUI: function() {
        const container = document.getElementById('tl-hub-content');
        if (!container) {
            console.error("TL Hub container not found!");
            return;
        }

        // 1. Navigation
        let html = `
            <div class="admin-sub-nav" style="margin-bottom:20px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <button class="sub-tab-btn ${this.currentView === 'timeline' ? 'active' : ''}" onclick="TLTasks.switchView('timeline')">Operations Timeline</button>
                    <button class="sub-tab-btn ${this.currentView === 'my_team' ? 'active' : ''}" onclick="TLTasks.switchView('my_team')">My Team</button>
                    <button class="sub-tab-btn ${this.currentView === 'overview' ? 'active' : ''}" onclick="TLTasks.switchView('overview')">Insight/Overview</button>
                    <button class="sub-tab-btn ${this.currentView === 'roster' ? 'active' : ''}" onclick="TLTasks.switchView('roster')">Add Team</button>
                </div>
                ${this.currentView === 'timeline' ? `
                <div style="display:flex; background:var(--bg-input); border-radius:20px; padding:2px; border:1px solid var(--border-color);">
                    <button class="sub-tab-btn ${this.activeTab === 'daily' ? 'active' : ''}" onclick="TLTasks.switchTab('daily')" style="font-size:0.8rem; padding:5px 15px;">Daily Tasks</button>
                    <button class="sub-tab-btn ${this.activeTab === 'weekly' ? 'active' : ''}" onclick="TLTasks.switchTab('weekly')" style="font-size:0.8rem; padding:5px 15px;">Weekly Tasks</button>
                </div>` : ''}
            </div>
        `;

        // 2. Content
        if (this.currentView === 'timeline') {
            html += this.renderTimeline();
        } else if (this.currentView === 'my_team') {
            html += this.renderMyTeam();
        } else if (this.currentView === 'roster') {
            html += this.renderRoster();
        } else {
            html += this.renderOverview();
        }

        container.innerHTML = html;
    },

    switchView: function(view) {
        this.currentView = view;
        this.renderUI();
    },

    switchTab: function(tab) {
        this.activeTab = tab;
        this.renderUI();
    },

    // --- TIMELINE VIEW ---
    renderTimeline: function() {
        const submission = this.getSubmission(this.currentDate) || { data: {} };
        const data = submission.data || {};

        // View Switcher Controls
        let html = `
            <div style="margin-bottom:20px; display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <label style="margin:0; font-weight:bold;">Date:</label>
                    <input type="date" value="${this.currentDate}" onchange="TLTasks.currentDate = this.value; TLTasks.renderUI();" style="margin:0;">
                </div>
                <div class="btn-group">
                    <button class="btn-secondary btn-sm ${this.timelineViewMode === 'standard' ? 'active' : ''}" onclick="TLTasks.switchTimelineView('standard')" title="Timeline View"><i class="fas fa-stream"></i></button>
                    <button class="btn-secondary btn-sm ${this.timelineViewMode === 'compact' ? 'active' : ''}" onclick="TLTasks.switchTimelineView('compact')" title="Compact Table"><i class="fas fa-table"></i></button>
                    <button class="btn-secondary btn-sm ${this.timelineViewMode === 'stepper' ? 'active' : ''}" onclick="TLTasks.switchTimelineView('stepper')" title="Focus Mode"><i class="fas fa-list-ul"></i></button>
                </div>
            </div>
        `;

        if (this.timelineViewMode === 'compact') {
            html += this.renderTimelineCompact(data);
        } else if (this.timelineViewMode === 'stepper') {
            html += this.renderTimelineStepper(data);
        } else {
            html += this.renderTimelineStandard(data);
        }

        // Submit Day Button
        html += `
            <div style="margin-top:30px; padding-top:20px; border-top:1px solid var(--border-color); text-align:right;">
                <button class="btn-success btn-lg" onclick="TLTasks.submitDay()"><i class="fas fa-check-circle"></i> Submit Day</button>
            </div>
        `;

        return html;
    },

    switchTimelineView: function(mode) {
        this.timelineViewMode = mode;
        this.renderUI();
    },

    // --- VIEW 1: STANDARD TIMELINE ---
    renderTimelineStandard: function(data) {
        const phases = this.activeTab === 'daily' ? this.dailyPhases : this.weeklyPhases;
        let html = '<div class="tl-timeline">';
        
        phases.forEach(phase => {
            const phaseData = data[phase.id] || {};
            let tasksHtml = '';
            if (phase.tasks.length === 0) {
                tasksHtml = `<div style="color:var(--text-muted); font-style:italic; padding:10px;">No tasks configured.</div>`;
            } else {
                tasksHtml = phase.tasks.map(t => `
                    <div class="tl-task-card">
                        <div class="tl-task-label">${t.label}</div>
                        <div class="tl-task-input">${this.renderTaskInput(t, phaseData[t.id], phase.id)}</div>
                    </div>`).join('');
            }

            html += `
                <div class="tl-timeline-item">
                    <div class="tl-timeline-marker" style="background:${phase.color};"><i class="fas ${phase.icon}"></i></div>
                    <div class="tl-timeline-content" style="border-left:4px solid ${phase.color};">
                        <h3 style="color:${phase.color}; margin-top:0;">${phase.title}</h3>
                        <div class="tl-tasks-grid">${tasksHtml}</div>
                    </div>
                </div>`;
        });
        html += '</div>';
        return html;
    },

    // --- VIEW 2: COMPACT TABLE ---
    renderTimelineCompact: function(data) {
        const phases = this.activeTab === 'daily' ? this.dailyPhases : this.weeklyPhases;
        let html = '<div class="card"><table class="admin-table" style="width:100%;">';
        
        phases.forEach(phase => {
            const phaseData = data[phase.id] || {};
            html += `<tr style="background:${phase.color}15; border-left:4px solid ${phase.color};"><td colspan="2" style="font-weight:bold; color:${phase.color}; padding:12px;">${phase.title}</td></tr>`;
            
            if (phase.tasks.length === 0) {
                html += `<tr><td colspan="2" style="color:var(--text-muted); font-style:italic;">No tasks.</td></tr>`;
            } else {
                phase.tasks.forEach(t => {
                    const val = phaseData[t.id];
                    html += `<tr>
                        <td style="width:30%; vertical-align:top; padding-top:15px; font-weight:500;">${t.label}</td>
                        <td style="padding:10px;">${this.renderTaskInput(t, val, phase.id)}</td>
                    </tr>`;
                });
            }
        });
        
        html += '</table></div>';
        return html;
    },

    // --- VIEW 3: STEPPER / FOCUS ---
    renderTimelineStepper: function(data) {
        const phases = this.activeTab === 'daily' ? this.dailyPhases : this.weeklyPhases;
        let html = '<div class="tl-stepper">';
        
        phases.forEach((phase, idx) => {
            const phaseData = data[phase.id] || {};
            // Default open first, others closed
            const isOpen = idx === 0; 
            
            html += `
                <div class="tl-stepper-item" style="margin-bottom:15px; border:1px solid var(--border-color); border-radius:8px; overflow:hidden;">
                    <div class="tl-stepper-header" style="background:var(--bg-card); padding:15px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; border-left:5px solid ${phase.color};" onclick="this.nextElementSibling.classList.toggle('hidden')">
                        <div style="font-weight:bold; font-size:1.1rem; color:${phase.color};"><i class="fas ${phase.icon}" style="margin-right:10px;"></i> ${phase.title}</div>
                        <i class="fas fa-chevron-down" style="color:var(--text-muted);"></i>
                    </div>
                    <div class="tl-stepper-content ${isOpen ? '' : 'hidden'}" style="padding:20px; background:var(--bg-input);">
                        <div class="tl-tasks-grid">
                            ${phase.tasks.map(t => `
                                <div class="tl-task-card">
                                    <div class="tl-task-label">${t.label}</div>
                                    <div class="tl-task-input">${this.renderTaskInput(t, phaseData[t.id], phase.id)}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            `;
        });
        
        html += '</div>';
        return html;
    },

    // --- INPUT RENDERERS ---
    renderTaskInput: function(task, val, phaseId) {
        const myTeam = this.getMyTeam();

        if (task.type === 'dev_placeholder') {
            return `<div style="padding:8px; background:rgba(0,0,0,0.1); border-radius:4px; color:var(--text-muted); font-style:italic; font-size:0.85rem;"><i class="fas fa-code"></i> Under Development</div>`;
        }

        if (task.type === 'team_attendance') {
            if (myTeam.length === 0) return '<div style="color:var(--text-muted);">No agents in "My Team". Add them in the My Team tab.</div>';
            
            const attData = val || {};
            let html = `<div class="tl-team-grid">`;
            
            myTeam.forEach(agent => {
                const aData = attData[agent] || { present: true, comment: '' };
                const isAbsent = aData.present === false;
                
                html += `
                    <div class="tl-team-row ${isAbsent ? 'absent' : ''}">
                        <div style="font-weight:bold; width:150px;">${agent}</div>
                        <label style="display:flex; align-items:center; gap:5px; cursor:pointer; margin:0;">
                            <input type="checkbox" ${!isAbsent ? 'checked' : ''} onchange="TLTasks.updateTeamTask('${phaseId}', '${task.id}', '${agent}', 'present', this.checked)"> Present
                        </label>
                        <input type="text" class="tl-text-input" placeholder="Reason (Mandatory if absent)" value="${aData.comment || ''}" 
                            style="flex:1; display:${isAbsent ? 'block' : 'none'}; border-color:${isAbsent && !aData.comment ? '#ff5252' : ''};" 
                            onchange="TLTasks.updateTeamTask('${phaseId}', '${task.id}', '${agent}', 'comment', this.value)">
                    </div>`;
            });
            html += `</div>`;
            return html;
        }

        if (task.type === 'outage_form') {
            const outData = val || { area: '', count: '', time: '' };
            return `
                <div class="tl-outage-form">
                    <input type="text" class="tl-text-input" placeholder="Listed Area" value="${outData.area || ''}" onchange="TLTasks.updateObjectTask('${phaseId}', '${task.id}', 'area', this.value)">
                    <input type="number" class="tl-text-input" placeholder="Clients Affected" value="${outData.count || ''}" onchange="TLTasks.updateObjectTask('${phaseId}', '${task.id}', 'count', this.value)">
                    <input type="time" class="tl-text-input" value="${outData.time || ''}" onchange="TLTasks.updateObjectTask('${phaseId}', '${task.id}', 'time', this.value)">
                </div>`;
        }

        if (task.type === 'team_checklist') {
            if (myTeam.length === 0) return '<div style="color:var(--text-muted);">No agents in "My Team".</div>';
            const checkData = val || {};
            let html = `<div class="tl-team-grid">`;
            myTeam.forEach(agent => {
                const isChecked = checkData[agent] === true;
                html += `<label class="tl-team-check-row">
                    <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="TLTasks.updateObjectTask('${phaseId}', '${task.id}', '${agent}', this.checked)"> ${agent}
                </label>`;
            });
            html += `</div>`;
            return html;
        }

        if (task.type === 'team_coaching_extended') {
            if (myTeam.length === 0) return '<div style="color:var(--text-muted);">No agents in "My Team".</div>';
            const coachData = val || {};
            let html = `<div class="tl-team-grid">`;
            myTeam.forEach(agent => {
                const cData = coachData[agent] || { coached: false, link: '', notes: '' };
                html += `
                    <div class="tl-team-row" style="flex-direction:column; align-items:stretch;">
                        <label style="display:flex; align-items:center; gap:5px; cursor:pointer; font-weight:bold; margin-bottom:5px;">
                            <input type="checkbox" ${cData.coached ? 'checked' : ''} onchange="TLTasks.updateTeamTask('${phaseId}', '${task.id}', '${agent}', 'coached', this.checked)"> ${agent}
                        </label>
                        ${cData.coached ? `
                            <div style="padding-left:20px; display:flex; flex-direction:column; gap:5px;">
                                <input type="text" class="tl-text-input" placeholder="Coaching Video Link..." value="${cData.link || ''}" onchange="TLTasks.updateTeamTask('${phaseId}', '${task.id}', '${agent}', 'link', this.value)">
                                <textarea class="tl-text-input" placeholder="Core Fixes (Bullet points)..." style="height:60px; resize:none;" onchange="TLTasks.updateTeamTask('${phaseId}', '${task.id}', '${agent}', 'notes', this.value)">${cData.notes || ''}</textarea>
                            </div>
                        ` : ''}
                    </div>`;
            });
            html += `</div>`;
            return html;
        }

        if (task.type === 'team_coaching') {
            if (myTeam.length === 0) return '<div style="color:var(--text-muted);">No agents in "My Team".</div>';
            const coachData = val || {};
            let html = `<div class="tl-team-grid">`;
            myTeam.forEach(agent => {
                const cData = coachData[agent] || { coached: false, link: '' };
                html += `
                    <div class="tl-team-row">
                        <label style="width:150px; display:flex; align-items:center; gap:5px; cursor:pointer; font-weight:bold; margin:0;">
                            <input type="checkbox" ${cData.coached ? 'checked' : ''} onchange="TLTasks.updateTeamTask('${phaseId}', '${task.id}', '${agent}', 'coached', this.checked)"> ${agent}
                        </label>
                        ${cData.coached ? `<input type="text" class="tl-text-input" placeholder="Recording Link..." value="${cData.link || ''}" onchange="TLTasks.updateTeamTask('${phaseId}', '${task.id}', '${agent}', 'link', this.value)">` : ''}
                    </div>`;
            });
            html += `</div>`;
            return html;
        }

        if (task.type === 'sentiment_gauge') {
            const moods = ['😞', '😐', '🙂', '🔥'];
            let html = `<div class="tl-emoji-wrapper">`;
            moods.forEach(m => {
                const isActive = (val && val.value === m);
                html += `<button class="tl-emoji-btn ${isActive ? 'active' : ''}" onclick="TLTasks.updateObjectTask('${phaseId}', '${task.id}', 'value', '${m}')">${m}</button>`;
            });
            html += `</div>`;
            return html;
        }

        if (task.type === 'textarea') {
            const textVal = (val && val.value) ? val.value : (val || '');
            return `<textarea class="tl-text-input" style="height:80px; resize:none;" placeholder="${task.placeholder || ''}" onchange="TLTasks.updateObjectTask('${phaseId}', '${task.id}', 'value', this.value)">${textVal}</textarea>`;
        }

        if (task.type === 'toggle_btn') {
            const isOn = (val && val.value === task.on);
            return `
                <button class="tl-toggle-btn ${isOn ? 'active' : ''}" onclick="TLTasks.updateObjectTask('${phaseId}', '${task.id}', 'value', '${isOn ? task.off : task.on}')">
                    <i class="fas ${isOn ? 'fa-check-circle' : 'fa-circle'}"></i> ${isOn ? task.on : task.off}
                </button>
            `;
        }

        return '';
    },

    // --- DATA HANDLING ---
    getSubmission: function(date) {
        if (!CURRENT_USER) return null;
        const submissions = JSON.parse(localStorage.getItem('tl_task_submissions') || '[]');
        return submissions.find(s => s.user === CURRENT_USER.user && s.date === date) || { data: {} };
    },

    saveSubmission: function(date, data) {
        if (!CURRENT_USER) return;
        const submissions = JSON.parse(localStorage.getItem('tl_task_submissions') || '[]');
        const idx = submissions.findIndex(s => s.user === CURRENT_USER.user && s.date === date);

        const payload = {
            id: (idx > -1) ? submissions[idx].id : Date.now() + "_" + Math.random().toString(36).substr(2, 9),
            user: CURRENT_USER.user,
            date: date,
            lastUpdated: new Date().toISOString(),
            data: data
        };

        if (idx > -1) submissions[idx] = payload;
        else submissions.push(payload);

        localStorage.setItem('tl_task_submissions', JSON.stringify(submissions));
        if (typeof saveToServer === 'function') saveToServer(['tl_task_submissions'], false);
    },

    submitDay: function() {
        if (!confirm("Are you sure all entries are up to standard and all relevant fields are filled in?")) return;
        
        // Save current state (implicitly handled by input changes, but good to ensure)
        // We can add a 'submitted' flag if needed, but for now just moving the date is the request.
        
        // Move to next day
        const d = new Date(this.currentDate);
        d.setDate(d.getDate() + 1);
        this.currentDate = d.toISOString().split('T')[0];
        
        this.renderUI();
        if (typeof showToast === 'function') showToast("Day submitted successfully. Moving to next day.", "success");
    },

    // --- UPDATE HELPERS ---
    updateObjectTask: function(phaseId, taskId, key, val) {
        const sub = this.getSubmission(this.currentDate);
        if (!sub.data[phaseId]) sub.data[phaseId] = {};
        
        const taskData = sub.data[phaseId][taskId] || {};
        taskData[key] = val;
        sub.data[phaseId][taskId] = taskData;

        this.saveSubmission(this.currentDate, sub.data);
        // Re-render to update UI state (e.g. toggle buttons)
        this.renderUI();
    },

    updateTeamTask: function(phaseId, taskId, agent, key, val) {
        const sub = this.getSubmission(this.currentDate);
        if (!sub.data[phaseId]) sub.data[phaseId] = {};
        
        const taskData = sub.data[phaseId][taskId] || {};
        if (!taskData[agent]) taskData[agent] = {};
        
        taskData[agent][key] = val;
        sub.data[phaseId][taskId] = taskData;

        this.saveSubmission(this.currentDate, sub.data);
        this.renderUI();
    },

    // --- ROSTER MANAGER (Formerly My Team) ---
    getMyTeam: function() {
        if (!CURRENT_USER) return [];
        const lists = JSON.parse(localStorage.getItem('tl_personal_lists') || '{}');
        return lists[CURRENT_USER.user] || [];
    },

    renderRoster: function() {
        const myTeam = this.getMyTeam();
        const allUsers = JSON.parse(localStorage.getItem('users') || '[]');
        
        const options = allUsers
            .filter(u => u.role === 'trainee' && !myTeam.includes(u.user))
            .sort((a,b) => a.user.localeCompare(b.user))
            .map(u => `<option value="${u.user}">${u.user}</option>`).join('');

        const listHtml = myTeam.map(agent => `
            <div style="display:flex; justify-content:space-between; padding:10px; border-bottom:1px solid var(--border-color); align-items:center; background:var(--bg-input);">
                <div style="font-weight:bold;">${agent}</div>
                <button class="btn-danger btn-sm" onclick="TLTasks.removeAgent('${agent}')"><i class="fas fa-trash"></i></button>
            </div>
        `).join('') || '<div style="padding:20px; text-align:center; color:var(--text-muted);">Your team list is empty.</div>';

        return `
            <div class="card">
                <h3>Add Team</h3>
                <p style="color:var(--text-muted); margin-bottom:15px;">Add agents to your personal roster. This list populates your daily checklists.</p>
                
                <div style="margin-bottom:20px;">
                    <label style="font-size:0.85rem; font-weight:bold; display:block; margin-bottom:5px;">Select Existing Agent</label>
                    <div style="display:flex; gap:10px;">
                        <select id="tlAgentSelect" style="flex:1;">
                            <option value="">-- Select Agent --</option>
                            ${options}
                        </select>
                        <button class="btn-primary" onclick="TLTasks.addAgent('select')">Add Selected</button>
                    </div>
                </div>

                <div style="margin-bottom:20px; padding-top:15px; border-top:1px dashed var(--border-color);">
                    <label style="font-size:0.85rem; font-weight:bold; display:block; margin-bottom:5px;">Or Add Custom Name</label>
                    <div style="display:flex; gap:10px;">
                        <input type="text" id="tlCustomAgent" placeholder="Enter Name..." class="tl-text-input" style="flex:1; font-size:1.1rem; padding:10px;">
                        <button class="btn-secondary" onclick="TLTasks.addAgent('custom')">Add Custom</button>
                    </div>
                </div>

                <div style="border:1px solid var(--border-color); border-radius:8px; overflow:hidden;">
                    ${listHtml}
                </div>
            </div>
        `;
    },

    addAgent: function(source) {
        const sel = document.getElementById('tlAgentSelect');
        const custom = document.getElementById('tlCustomAgent');
        
        let val = "";
        if (source === 'custom') {
            val = custom.value.trim();
        } else {
            val = sel.value;
        }
        
        if (!val) return alert("Please select an agent or enter a name.");
        
        const lists = JSON.parse(localStorage.getItem('tl_personal_lists') || '{}');
        if (!lists[CURRENT_USER.user]) lists[CURRENT_USER.user] = [];
        
        if (!lists[CURRENT_USER.user].includes(val)) {
            lists[CURRENT_USER.user].push(val);
            localStorage.setItem('tl_personal_lists', JSON.stringify(lists));
            if (typeof saveToServer === 'function') saveToServer(['tl_personal_lists'], false);
        }
        this.renderUI();
    },

    removeAgent: function(name) {
        if (!confirm(`Remove ${name} from your list?`)) return;
        
        const lists = JSON.parse(localStorage.getItem('tl_personal_lists') || '{}');
        if (lists[CURRENT_USER.user]) {
            lists[CURRENT_USER.user] = lists[CURRENT_USER.user].filter(a => a !== name);
            localStorage.setItem('tl_personal_lists', JSON.stringify(lists));
            
            if (typeof saveToServer === 'function') saveToServer(['tl_personal_lists'], false);
            this.renderUI();
        }
    },

    copyPreviousTeam: function() {
        if (!confirm("Replace current team list with agents from your last submission?")) return;

        const submissions = JSON.parse(localStorage.getItem('tl_task_submissions') || '[]');
        const mySubs = submissions.filter(s => s.user === CURRENT_USER.user).sort((a,b) => new Date(b.date) - new Date(a.date));
        
        if (mySubs.length === 0) return alert("No previous submissions found.");

        const lastSub = mySubs[0];
        let agents = [];
        
        // Look for attendance data in start_shift -> t_attend
        if (lastSub.data && lastSub.data.start_shift && lastSub.data.start_shift.t_attend) {
            agents = Object.keys(lastSub.data.start_shift.t_attend);
        }

        if (agents.length === 0) return alert("Could not find team data in your last submission.");

        const lists = JSON.parse(localStorage.getItem('tl_personal_lists') || '{}');
        lists[CURRENT_USER.user] = agents;
        localStorage.setItem('tl_personal_lists', JSON.stringify(lists));
        
        if (typeof saveToServer === 'function') saveToServer(['tl_personal_lists'], false);
        
        this.renderUI();
        if (typeof showToast === 'function') showToast(`Restored ${agents.length} agents from ${lastSub.date}`, "success");
    },

    // --- MY TEAM (Calendar + History List) ---
    renderMyTeam: function() {
        const submissions = JSON.parse(localStorage.getItem('tl_task_submissions') || '[]');
        const mySubs = submissions.filter(s => s.user === CURRENT_USER.user);
        const datesWithData = new Set(mySubs.map(s => s.date));
        
        const current = new Date(this.currentDate);
        const year = current.getFullYear();
        const month = current.getMonth();
        
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();
        const startDay = firstDay.getDay(); // 0=Sun
        
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        let html = `
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h3><i class="fas fa-calendar-alt"></i> Team Calendar</h3>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <button class="btn-secondary btn-sm" onclick="TLTasks.changeMonth(-1)">&lt;</button>
                        <span style="font-weight:bold; width:150px; text-align:center;">${monthNames[month]} ${year}</span>
                        <button class="btn-secondary btn-sm" onclick="TLTasks.changeMonth(1)">&gt;</button>
                    </div>
                </div>
                <div class="tl-calendar-grid">
                    <div class="cal-header">Sun</div><div class="cal-header">Mon</div><div class="cal-header">Tue</div><div class="cal-header">Wed</div><div class="cal-header">Thu</div><div class="cal-header">Fri</div><div class="cal-header">Sat</div>
        `;
        
        // Empty slots
        for(let i=0; i<startDay; i++) html += `<div class="cal-day empty"></div>`;
        
        // Days
        for(let d=1; d<=daysInMonth; d++) {
            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const hasData = datesWithData.has(dateStr);
            const isSelected = dateStr === this.currentDate;
            
            let classes = "cal-day";
            if (hasData) classes += " has-data";
            if (isSelected) classes += " selected";
            
            html += `<div class="${classes}" onclick="TLTasks.selectDate('${dateStr}')">
                <div class="day-num">${d}</div>
                ${hasData ? '<div class="day-dot" title="Data Submitted"></div>' : ''}
            </div>`;
        }
        
        html += `</div>
        </div>`;

        // LIST VIEW BELOW
        // Filter submissions for the selected month (or all?) - User said "all submitted dates"
        // Let's show list for the current month to keep it clean, or just recent.
        // Let's show ALL sorted by date desc.
        
        mySubs.sort((a,b) => new Date(b.date) - new Date(a.date));

        html += `
            <div class="card">
                <h3>Operations History</h3>
                <div class="table-responsive">
                    <table class="admin-table">
                        <thead><tr><th>Date</th><th>Type</th><th>Last Updated</th><th>Action</th></tr></thead>
                        <tbody>
                            ${mySubs.length > 0 ? mySubs.map(s => `
                                <tr>
                                    <td>${s.date}</td>
                                    <td style="text-transform:capitalize;">${s.type || 'Daily'}</td>
                                    <td>${new Date(s.lastUpdated).toLocaleString()}</td>
                                    <td>
                                        <button class="btn-secondary btn-sm" onclick="TLTasks.selectDate('${s.date}')"><i class="fas fa-pen"></i> Edit</button>
                                    </td>
                                </tr>
                            `).join('') : '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No submissions found.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        
        return html;
    },

    // --- INSIGHT / OVERVIEW (Placeholder) ---
    renderOverview: function() {
        return `
            <div style="text-align:center; padding:50px; color:var(--text-muted);">
                <i class="fas fa-hard-hat" style="font-size:4rem; margin-bottom:20px;"></i>
                <h2>Under Construction</h2>
                <p>This module is currently being developed.</p>
            </div>
        `;
    },

    changeMonth: function(delta) {
        const d = new Date(this.currentDate);
        d.setMonth(d.getMonth() + delta);
        this.currentDate = d.toISOString().split('T')[0];
        this.renderUI();
    },

    selectDate: function(date) {
        this.currentDate = date;
        this.switchView('timeline'); // Jump to timeline to edit
    }
};

// Expose globally
window.TLTasks = TLTasks;
console.log("TLTasks Module Loaded");
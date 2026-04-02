/* ================= MODULE ENTRY POINT ================= */

const App = {
    currentView: 'timeline', 
    activeTab: 'daily',
    timelineMode: 'standard',
    currentDate: new Date().toISOString().split('T')[0],
    currentShift: 'Day Shift',

    init: async function() {
        const container = document.getElementById('app-container');
        container.innerHTML = '<div style="text-align:center; padding:50px; color:var(--text-muted);"><i class="fas fa-circle-notch fa-spin fa-2x"></i><p>Loading Team Hub...</p></div>';
        
        await DataService.loadInitialData();
        this.render();
    },

    render: function() {
        const container = document.getElementById('app-container');
        
        // Navigation
        let html = `
            <div class="admin-sub-nav" style="margin-bottom:20px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <button class="sub-tab-btn ${this.currentView === 'timeline' ? 'active' : ''}" onclick="App.setView('timeline')">Operations Timeline</button>
                    <button class="sub-tab-btn ${this.currentView === 'my_team' ? 'active' : ''}" onclick="App.setView('my_team')">My Team</button>
                    <button class="sub-tab-btn ${this.currentView === 'overview' ? 'active' : ''}" onclick="App.setView('overview')">Insight/Overview</button>
                    <button class="sub-tab-btn ${this.currentView === 'agent_feedback' ? 'active' : ''}" onclick="App.setView('agent_feedback')">Agent Production Feedback</button>
                    <button class="sub-tab-btn ${this.currentView === 'roster' ? 'active' : ''}" onclick="App.setView('roster')">Add Team</button>
                    <button class="sub-tab-btn ${this.currentView === 'backend_data' ? 'active' : ''}" onclick="App.setView('backend_data')">Backend Data</button>
                </div>
                ${this.currentView === 'timeline' ? `
                <div style="display:flex; background:var(--bg-input); border-radius:20px; padding:2px; border:1px solid var(--border-color);">
                    <button class="sub-tab-btn ${this.activeTab === 'daily' ? 'active' : ''}" onclick="App.setTab('daily')" style="font-size:0.8rem; padding:5px 15px;">Daily</button>
                    <button class="sub-tab-btn ${this.activeTab === 'weekly' ? 'active' : ''}" onclick="App.setTab('weekly')" style="font-size:0.8rem; padding:5px 15px;">Weekly</button>
                </div>` : ''}
            </div>
        `;

        // Content
        if (this.currentView === 'timeline') {
            const submission = DataService.getSubmission(this.currentDate);
            // Load shift from saved submission if available, else default
            const shift = (submission.data && submission.data.shift) ? submission.data.shift : this.currentShift;
            html += TimelineUI.render(this.timelineMode, this.activeTab, this.currentDate, submission.data || {}, shift);
        } else if (this.currentView === 'my_team') {
            html += TeamUI.renderCalendar(this.currentDate);
        } else if (this.currentView === 'agent_feedback') {
            html += FeedbackUI.render();
        } else if (this.currentView === 'roster') {
            html += TeamUI.renderRoster();
        } else if (this.currentView === 'backend_data') {
            html += BackendUI.render();
        } else { // Default/Fallback for 'overview' and any other new tabs
            html += `<div style="text-align:center; padding:50px; color:var(--text-muted);">
                <i class="fas fa-hard-hat" style="font-size:4rem; margin-bottom:20px;"></i>
                <h2>Under Construction</h2>
                <p>This module is currently being developed.</p>
            </div>`;
        }

        container.innerHTML = html;
    },

    setView: function(view) { this.currentView = view; this.render(); },
    setTab: function(tab) { this.activeTab = tab; this.render(); },
    setTimelineMode: function(mode) { this.timelineMode = mode; this.render(); },
    setDate: function(date) { this.currentDate = date; this.render(); },
    setShift: function(shift) { 
        this.currentShift = shift; 
        // Persist shift immediately to current day's submission data so it sticks
        this.updateObjectTask('meta', 'shift', 'value', shift);
        this.render(); 
    },

    updateObjectTask: function(phase, task, key, val) {
        const sub = DataService.getSubmission(this.currentDate);
        if (!sub.data[phase]) sub.data[phase] = {};
        if (!sub.data[phase][task]) sub.data[phase][task] = {};
        sub.data[phase][task][key] = val;
        DataService.saveSubmission(this.currentDate, sub.data);
        // No re-render to keep focus on text inputs
    },

    // --- ACTION PROXIES ---

    toggleAttendance: function(phase, task, agent, isPresent) {
        const sub = DataService.getSubmission(this.currentDate);
        const agentData = sub.data?.[phase]?.[task]?.[agent] || {};
        
        // If marking as absent AND there's no comment yet
        if (!isPresent && !agentData.comment) {
            const reason = prompt(`A reason is mandatory for ${agent}'s absence:`);
            if (!reason || !reason.trim()) {
                this.render(); // Re-render to revert checkbox state if prompt is cancelled
                return;
            }
            // Save the reason first
            this.updateTeamTask(phase, task, agent, 'comment', reason);
        }
        
        // Now update presence status and re-render
        this.updateTeamTask(phase, task, agent, 'present', isPresent, true); // Pass true to force render
    },

    toggleHandoverProblem: function(phase, task, isChecked) {
        const sub = DataService.getSubmission(this.currentDate);
        if (!sub.data[phase]) sub.data[phase] = {};
        if (!sub.data[phase][task]) sub.data[phase][task] = {};
        sub.data[phase][task].hasProblem = isChecked;
        DataService.saveSubmission(this.currentDate, sub.data);
        this.render(); // Re-render to show/hide fields
    },
    
    updateTeamTask: function(phase, task, agent, key, val, forceRender = false) {
        const sub = DataService.getSubmission(this.currentDate);
        if (!sub.data[phase]) sub.data[phase] = {};
        if (!sub.data[phase][task]) sub.data[phase][task] = {};
        if (!sub.data[phase][task][agent]) sub.data[phase][task][agent] = {};
        sub.data[phase][task][agent][key] = val;
        DataService.saveSubmission(this.currentDate, sub.data);
        if (forceRender) {
            this.render();
        }
    },

    addOutageEntry: function(phase, task) {
        const sub = DataService.getSubmission(this.currentDate);
        if (!sub.data[phase]) sub.data[phase] = {};
        if (!Array.isArray(sub.data[phase][task])) sub.data[phase][task] = [];
        sub.data[phase][task].push({ area: '', count: '', time: '' });
        DataService.saveSubmission(this.currentDate, sub.data);
        this.render();
    },
    removeOutageEntry: function(phase, task, index) {
        const sub = DataService.getSubmission(this.currentDate);
        if (sub.data?.[phase]?.[task]?.[index]) {
            sub.data[phase][task].splice(index, 1);
            DataService.saveSubmission(this.currentDate, sub.data);
            this.render();
        }
    },
    updateOutageEntry: function(phase, task, index, key, value) {
        const sub = DataService.getSubmission(this.currentDate);
        if (!sub.data?.[phase]?.[task]?.[index]) return;
        
        sub.data[phase][task][index][key] = value;

        // Auto-fill count if area is changed
        if (key === 'area') {
            const backend = DataService.getBackendData();
            const matchedArea = (backend.outage_areas || []).find(a => a.name === value);
            sub.data[phase][task][index]['count'] = matchedArea ? matchedArea.count : 0;
        }

        DataService.saveSubmission(this.currentDate, sub.data);
        if (key === 'area') this.render(); // Re-render to show new count
    },

    addProblemTicket: function(phase, task) {
        const sub = DataService.getSubmission(this.currentDate);
        if (!sub.data[phase]) sub.data[phase] = {};
        if (!sub.data[phase][task]) sub.data[phase][task] = {};
        if (!Array.isArray(sub.data[phase][task].problemTickets)) sub.data[phase][task].problemTickets = [];
        sub.data[phase][task].problemTickets.push({ number: '', link: '', desc: '' });
        DataService.saveSubmission(this.currentDate, sub.data);
        this.render();
    },
    removeProblemTicket: function(phase, task, index) {
        const sub = DataService.getSubmission(this.currentDate);
        if (sub.data?.[phase]?.[task]?.problemTickets?.[index]) {
            sub.data[phase][task].problemTickets.splice(index, 1);
            DataService.saveSubmission(this.currentDate, sub.data);
            this.render();
        }
    },
    updateProblemTicketField: function(phase, task, index, key, val) {
        const sub = DataService.getSubmission(this.currentDate);
        if (!sub.data?.[phase]?.[task]?.problemTickets?.[index]) return;
        sub.data[phase][task].problemTickets[index][key] = val;
        DataService.saveSubmission(this.currentDate, sub.data);
        // no re-render to keep focus
    },

    updateSupportAgentTask: function(phase, task, agent, key, val) {
        const sub = DataService.getSubmission(this.currentDate);
        if (!sub.data[phase]) sub.data[phase] = {};
        if (!sub.data[phase][task]) sub.data[phase][task] = {};
        if (!sub.data[phase][task][agent]) sub.data[phase][task][agent] = {};
        
        sub.data[phase][task][agent][key] = val;
        
        // If unchecking, clear the description
        if (key === 'supported' && val === false) {
            sub.data[phase][task][agent]['desc'] = '';
        }

        DataService.saveSubmission(this.currentDate, sub.data);
        
        // Re-render only when checkbox is toggled to show/hide textarea
        if (key === 'supported') {
            this.render();
        }
    },

    addBottleneckEntry: function() {
        const sub = DataService.getSubmission(this.currentDate);
        const phase = 'mid_shift';
        const task = 't_bottleneck';
        if (!sub.data[phase]) sub.data[phase] = {};
        if (!Array.isArray(sub.data[phase][task])) sub.data[phase][task] = [];
        sub.data[phase][task].push({ type: '', desc: '', time: '', link: '', fileName: '' });
        DataService.saveSubmission(this.currentDate, sub.data);
        this.render();
    },
    removeBottleneckEntry: function(index) {
        const sub = DataService.getSubmission(this.currentDate);
        const phase = 'mid_shift';
        const task = 't_bottleneck';
        if (sub.data?.[phase]?.[task]?.[index]) {
            sub.data[phase][task].splice(index, 1);
            DataService.saveSubmission(this.currentDate, sub.data);
            this.render();
        }
    },
    updateBottleneckEntry: function(index, key, value) {
        const sub = DataService.getSubmission(this.currentDate);
        const phase = 'mid_shift';
        const task = 't_bottleneck';
        if (!sub.data?.[phase]?.[task]?.[index]) return;
        sub.data[phase][task][index][key] = value;
        DataService.saveSubmission(this.currentDate, sub.data);
        // no re-render
    },

    moveOpResponsibility: function(phase, task, agent, targetRole) {
        // 1. Check Global Limits if moving TO restricted group
        if (targetRole === 'AM Group' || targetRole === 'CX Group') {
            const limit = 2;
            const allSubs = JSON.parse(localStorage.getItem('tl_task_submissions') || '[]');
            let count = 0;
            allSubs.forEach(s => {
                if (s.date === this.currentDate && s.data && s.data.start_shift && s.data.start_shift.t_assign) {
                    Object.values(s.data.start_shift.t_assign).forEach(r => { if (r === targetRole) count++; });
                }
            });
            
            if (count >= limit) {
                alert(`Cannot assign ${agent} to ${targetRole}. Global limit of ${limit} reached.`);
                return;
            }
        }

        // 2. Update Assignment
        const sub = DataService.getSubmission(this.currentDate);
        if (!sub.data[phase]) sub.data[phase] = {};
        if (!sub.data[phase][task]) sub.data[phase][task] = {};
        sub.data[phase][task][agent] = targetRole;
        
        DataService.saveSubmission(this.currentDate, sub.data);
        this.render();
    },

    openWorkloadAdjustmentModal: function(agent, currentRole, phaseId, taskId, preSelectedRole = null) {
        let modal = document.getElementById('workloadAdjustModal');
        if (modal) modal.remove();

        const roles = ['VIP Q', 'AM Group', 'CX Group'];
        const rolesHtml = roles.map(r => `
            <label style="display:block; margin-bottom:5px; cursor:pointer;">
                <input type="radio" name="new_op_role" value="${r}" ${currentRole === r ? 'disabled' : ''} ${(preSelectedRole === r) ? 'checked' : ''}> ${r}
            </label>
        `).join('');

        modal = document.createElement('div');
        modal.id = 'workloadAdjustModal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-box" style="width:450px;">
                <h3 style="margin-top:0;">Adjust Duty for: ${agent}</h3>
                <p style="color:var(--text-muted);">Current Duty: <strong>${currentRole}</strong></p>
                
                <input type="hidden" id="wa_agent" value="${agent.replace(/"/g, '&quot;')}">
                <input type="hidden" id="wa_current_role" value="${currentRole}">
                <input type="hidden" id="wa_phase_id" value="${phaseId}">
                <input type="hidden" id="wa_task_id" value="${taskId}">

                <div style="margin-bottom:15px;">
                    <label style="font-weight:bold;">New Duty:</label>
                    <div style="padding:10px; background:var(--bg-input); border-radius:4px;">${rolesHtml}</div>
                </div>

                <label style="font-weight:bold;">Reason for Change (Mandatory)</label>
                <textarea id="wa_reason" placeholder="e.g., Covering for sick leave, workload balancing..." style="width:100%; height:80px; resize:vertical;"></textarea>

                <div style="margin-top:20px; text-align:right;">
                    <button class="btn-secondary" onclick="document.getElementById('workloadAdjustModal').remove()">Cancel</button>
                    <button class="btn-primary" style="margin-left:10px;" onclick="App.confirmWorkloadAdjustment()">Confirm Adjustment</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    },

    confirmWorkloadAdjustment: function() {
        const agent = document.getElementById('wa_agent').value;
        const currentRole = document.getElementById('wa_current_role').value;
        const phaseId = document.getElementById('wa_phase_id').value;
        const taskId = document.getElementById('wa_task_id').value;
        const reason = document.getElementById('wa_reason').value.trim();
        const newRoleEl = document.querySelector('input[name="new_op_role"]:checked');

        if (!newRoleEl) return alert("Please select a new duty.");
        if (!reason) return alert("A reason for the adjustment is mandatory.");

        const newRole = newRoleEl.value;

        // Log the change specifically to mid_shift -> t_workload
        // This ensures it appears in the "Adjust Workload Distribution" log, regardless of where the button was clicked
        const logPhase = 'mid_shift';
        const logTask = 't_workload';
        
        const sub = DataService.getSubmission(this.currentDate);
        if (!sub.data[logPhase]) sub.data[logPhase] = {};
        if (!sub.data[logPhase][logTask]) sub.data[logPhase][logTask] = {};
        if (!sub.data[logPhase][logTask].logs) sub.data[logPhase][logTask].logs = [];
        
        sub.data[logPhase][logTask].logs.push({
            agent: agent, from: currentRole, to: newRole, reason: reason, time: new Date().toISOString()
        });
        DataService.saveSubmission(this.currentDate, sub.data);

        // Perform the Move (this will re-render)
        this.moveOpResponsibility('start_shift', 't_assign', agent, newRole);

        // Close modal
        const modal = document.getElementById('workloadAdjustModal');
        if (modal) modal.remove();
    },

    handleBottleneckUpload: function(index, input) {
        const file = input.files[0];
        if (!file) return;

        // Size check (e.g. 5MB limit for local storage sanity)
        if (file.size > 5 * 1024 * 1024) {
            alert("File is too large (Max 5MB). Please use a link instead.");
            input.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = e.target.result;
            
            const phaseId = 'mid_shift';
            const taskId = 't_bottleneck';
            
            const sub = DataService.getSubmission(this.currentDate);
            if (!sub.data?.[phaseId]?.[taskId]?.[index]) return;
            
            sub.data[phaseId][taskId][index].fileData = base64;
            sub.data[phaseId][taskId][index].fileName = file.name;
            
            DataService.saveSubmission(this.currentDate, sub.data);
            this.render();
        };
        reader.readAsDataURL(file);
    },

    addAgent: function(source) {
        let name = "";
        let role = "First Line Agent";

        if (source === 'select') {
            const sel = document.getElementById('tlAgentSelect');
            if (sel) name = sel.value;
        } else if (source === 'custom') {
            const inp = document.getElementById('tlNewAgentName');
            const roleSel = document.getElementById('tlNewAgentRole');
            if (inp) name = inp.value.trim();
            if (roleSel) role = roleSel.value;
        }
        
        if (!name) return alert("Please select or enter an agent name.");
        
        const myTeam = DataService.getMyTeam();
        // Check for duplicates by name
        if (!myTeam.some(a => a.name.toLowerCase() === name.toLowerCase())) {
            myTeam.push({ name: name, role: role });
            DataService.saveMyTeam(myTeam);
        } else {
            alert("Agent already in your team.");
        }
        this.render();
    },

    removeAgent: function(name) {
        if(confirm("Remove?")) {
            // Filter by name property
            DataService.saveMyTeam(DataService.getMyTeam().filter(n => n.name !== name));
            this.render();
        }
    },

    copyPreviousTeam: function() {
        if (!confirm("Replace current team list with agents from your last submission?")) return;
        const submissions = JSON.parse(localStorage.getItem('tl_task_submissions') || '[]');
        const mySubs = submissions.filter(s => s.user === AppContext.user.user).sort((a,b) => new Date(b.date) - new Date(a.date));
        if (mySubs.length === 0) return alert("No previous submissions found.");
        const lastSub = mySubs[0];
        let agents = [];
        if (lastSub.data && lastSub.data.start_shift && lastSub.data.start_shift.t_attend) {
            agents = Object.keys(lastSub.data.start_shift.t_attend);
        }
        if (agents.length === 0) return alert("Could not find team data in your last submission.");
        
        // Convert string names to objects with default role
        const agentObjs = agents.map(name => ({ name: name, role: 'First Line Agent' }));
        DataService.saveMyTeam(agentObjs);
        this.render();
    },

    changeMonth: function(delta) { const d = new Date(this.currentDate); d.setMonth(d.getMonth() + delta); this.currentDate = d.toISOString().split('T')[0]; this.render(); },
    selectDate: function(date) { this.currentDate = date; this.setView('timeline'); },

    // --- REPORTING & SUBMISSION ---
    validateSubmission: function() {
        const sub = DataService.getSubmission(this.currentDate);
        const data = sub.data || {};
        const errors = [];

        // 1. Check Attendance (Start of Shift)
        const attData = data.start_shift?.t_attend || {};
        Object.entries(attData).forEach(([agent, val]) => {
            if (val.present === false && (!val.comment || !val.comment.trim())) {
                errors.push(`Attendance: ${agent} is absent but has no reason provided.`);
            }
        });

        // 2. Check Support Agents (During Shift)
        const supportData = data.during_shift?.t_support || {};
        Object.entries(supportData).forEach(([agent, val]) => {
            if (val.supported === true && (!val.desc || !val.desc.trim())) {
                errors.push(`Support: ${agent} was supported but no description was entered.`);
            }
        });

        // 3. Check Coaching (During Shift)
        const coachData = data.during_shift?.t_coach || {};
        Object.entries(coachData).forEach(([agent, val]) => {
            if (val.coached === true && (!val.desc || !val.desc.trim())) {
                errors.push(`Coaching: ${agent} was coached but no description was entered.`);
            }
        });

        // 4. Check Extended Coaching (Weekly - if applicable)
        const extCoachData = data.team_mgmt?.w_coaching || {};
        Object.entries(extCoachData).forEach(([agent, val]) => {
            if (val.coached === true && (!val.desc || !val.desc.trim())) {
                errors.push(`1-on-1 Coaching: ${agent} was coached but no description was entered.`);
            }
        });

        return errors;
    },

    submitDay: function() {
        const errors = this.validateSubmission();
        if (errors.length > 0) {
            alert("Cannot submit day. Please fix the following:\n\n- " + errors.join("\n- "));
            return;
        }

        if (!confirm("Confirm submission for " + this.currentDate + "?")) return;
        const d = new Date(this.currentDate);
        d.setDate(d.getDate() + 1);
        this.currentDate = d.toISOString().split('T')[0];
        this.render();
        alert("Day submitted. Moving to next day.");
    },

    generateReport: function() {
        const submission = DataService.getSubmission(this.currentDate);
        if (!submission || !submission.data) return alert("No data found for this date.");
        
        const data = submission.data;
        const phases = this.activeTab === 'daily' ? TimelineUI.dailyPhases : TimelineUI.weeklyPhases;
        let report = `SHIFT REPORT - ${this.currentDate} (${this.activeTab.toUpperCase()})\n`;
        report += `Team Leader: ${AppContext.user ? AppContext.user.user : 'Unknown'}\n`;
        report += `Generated: ${new Date().toLocaleString()}\n\n`;

        phases.forEach(p => {
            const pData = data[p.id] || {};
            let hasContent = false;
            let sectionText = `--- ${p.title.toUpperCase()} ---\n`;
            
            p.tasks.forEach(t => {
                const val = pData[t.id];
                if (val) {
                    hasContent = true;
                    sectionText += `[x] ${t.label}: `;
                    if (typeof val === 'object') {
                        if (val.value) sectionText += val.value;
                        else if (t.type.includes('team')) {
                            const count = Object.keys(val).length;
                            sectionText += `${count} entries (See dashboard for details)`;
                        } else {
                            sectionText += JSON.stringify(val);
                        }
                    } else {
                        sectionText += val;
                    }
                    sectionText += '\n';
                }
            });
            if (hasContent) report += sectionText + '\n';
        });

        const blob = new Blob([report], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Shift_Report_${this.currentDate}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
};

window.onload = () => App.init();

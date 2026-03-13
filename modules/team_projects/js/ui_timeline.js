/* ================= TIMELINE UI RENDERER ================= */

const TimelineUI = {
    // --- CONFIGURATION (Ported from tl_tasks.js) ---
    dailyPhases: [
        { id: 'start_shift', title: 'Start of Shift', color: '#f39c12', icon: 'fa-sun', tasks: [
            { id: 't_attend', label: 'Confirm Staff Attendance', type: 'team_attendance' },
            { id: 't_network', label: 'Check Network Outages', type: 'outage_form' },
            { id: 't_backlog', label: 'Review Ticket Backlog', type: 'ticket_backlog' },
            { id: 't_handover', label: 'Review Handover Notes', type: 'handover_notes' },
            { id: 't_assign', label: 'Assign Operational Responsibilities', type: 'op_responsibilities' }
        ]},
        { id: 'during_shift', title: 'During Shift', color: '#3498db', icon: 'fa-headset', tasks: [
            { id: 't_queue', label: 'Monitor Queue Wait Times', type: 'dev_placeholder' },
            { id: 't_support', label: 'Support Agents', type: 'team_checklist' },
            { id: 't_coach', label: 'Provide Real-Time Coaching', type: 'team_coaching' },
            { id: 't_metrics', label: 'Track Performance Metrics', type: 'dev_placeholder' }
        ]},
        { id: 'mid_shift', title: 'Mid Shift Review', color: '#9b59b6', icon: 'fa-chart-line', tasks: [
            { id: 't_eval_team', label: 'Evaluate Performance', type: 'dev_placeholder' },
            { id: 't_bottleneck', label: 'Identify Operational Bottlenecks', type: 'bottleneck_form' },
            { id: 't_workload', label: 'Adjust Workload Distribution', type: 'workload_adjustment' }
        ]},
        { id: 'end_shift', title: 'End of Shift', color: '#2c3e50', icon: 'fa-moon', tasks: [
            { id: 't_perf_out', label: 'Review Outcomes', type: 'dev_placeholder' },
            { id: 't_doc_issues', label: 'Document Issues', type: 'dev_placeholder' },
            { id: 't_shift_handover', label: 'Shift Handover', type: 'dev_placeholder' }
        ]}
    ],

    weeklyPhases: [
        { id: 'weekly_planning', title: 'Weekly Planning', color: '#1abc9c', icon: 'fa-calendar-alt', tasks: [
            { id: 'w_metrics', label: 'Review Weekly Metrics', type: 'dev_placeholder' },
            { id: 'w_issues', label: 'Identify Recurring Issues', type: 'dev_placeholder' },
            { id: 'w_gaps', label: 'Identify Gaps', type: 'dev_placeholder' }
        ]},
        { id: 'team_mgmt', title: 'Team Management', color: '#e67e22', icon: 'fa-users-cog', tasks: [
            { id: 'w_coaching', label: 'One-on-One Coaching', type: 'team_coaching_extended' },
            { id: 'w_recognize', label: 'Recognize Performers', type: 'dev_placeholder' },
            { id: 'w_behavior', label: 'Address Issues', type: 'dev_placeholder' }
        ]},
        { id: 'op_review', title: 'Operational Review', color: '#e74c3c', icon: 'fa-chart-bar', tasks: [
            { id: 'w_qa', label: 'Review QA Results', type: 'dev_placeholder' },
            { id: 'w_complaints', label: 'Review Complaints', type: 'dev_placeholder' },
            { id: 'w_ticket_qual', label: 'Review Ticket Quality', type: 'dev_placeholder' }
        ]},
        { id: 'cont_imp', title: 'Continuous Improvement', color: '#9b59b6', icon: 'fa-rocket', tasks: [
            { id: 'w_recurring', label: 'Identify Recurring Issues', type: 'dev_placeholder' },
            { id: 'w_docs', label: 'Improve Documentation', type: 'dev_placeholder' },
            { id: 'w_improve', label: 'Propose Improvements', type: 'dev_placeholder' }
        ]}
    ],

    render: function(mode, tab, date, data, shift) {
        const phases = tab === 'daily' ? this.dailyPhases : this.weeklyPhases;
        const currentShift = shift || 'Day Shift';
        
        let html = `
            <div style="margin-bottom:20px; display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <label style="margin:0; font-weight:bold;">Date:</label>
                    <input type="date" value="${date}" onchange="App.setDate(this.value)" style="margin:0;">
                    
                    <select onchange="App.setShift(this.value)" style="margin:0; padding:5px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-input); color:var(--text-main);">
                        <option value="Morning Shift" ${currentShift === 'Morning Shift' ? 'selected' : ''}>Morning Shift</option>
                        <option value="Day Shift" ${currentShift === 'Day Shift' ? 'selected' : ''}>Day Shift</option>
                        <option value="Mid Day Shift" ${currentShift === 'Mid Day Shift' ? 'selected' : ''}>Mid Day Shift</option>
                        <option value="Late Shift" ${currentShift === 'Late Shift' ? 'selected' : ''}>Late Shift</option>
                    </select>
                </div>
                <div class="btn-group">
                    <button class="btn-secondary btn-sm ${mode === 'standard' ? 'active' : ''}" onclick="App.setTimelineMode('standard')"><i class="fas fa-stream"></i></button>
                    <button class="btn-secondary btn-sm ${mode === 'compact' ? 'active' : ''}" onclick="App.setTimelineMode('compact')"><i class="fas fa-table"></i></button>
                    <button class="btn-secondary btn-sm ${mode === 'stepper' ? 'active' : ''}" onclick="App.setTimelineMode('stepper')"><i class="fas fa-list-ul"></i></button>
                </div>
            </div>
        `;

        if (mode === 'compact') html += this.renderCompact(phases, data);
        else if (mode === 'stepper') html += this.renderStepper(phases, data);
        else html += this.renderStandard(phases, data);

        html += `
            <div style="margin-top:30px; padding-top:20px; border-top:1px solid var(--border-color); text-align:right;">
                <button class="btn-secondary btn-lg" onclick="App.generateReport()" style="margin-right:10px;"><i class="fas fa-file-alt"></i> Shift Report</button>
                <button class="btn-success btn-lg" onclick="App.submitDay()"><i class="fas fa-check-circle"></i> Submit Day</button>
            </div>`;
        return html;
    },

    renderStandard: function(phases, data) {
        let html = '<div class="tl-timeline">';
        phases.forEach(phase => {
            const phaseData = data[phase.id] || {};
            let tasksHtml = '';
            if (phase.tasks.length === 0) tasksHtml = `<div style="color:var(--text-muted);">No tasks.</div>`;
            else {
                tasksHtml = phase.tasks.map(t => `
                    <div class="tl-task-card">
                        <div class="tl-task-label">${t.label}</div>
                        <div class="tl-task-input">${this.renderInput(t, phaseData[t.id], phase.id)}</div>
                    </div>`).join('');
            }
            html += `<div class="tl-timeline-item"><div class="tl-timeline-marker" style="background:${phase.color};"><i class="fas ${phase.icon}"></i></div><div class="tl-timeline-content" style="border-left:4px solid ${phase.color};"><h3 style="color:${phase.color}; margin-top:0;">${phase.title}</h3><div class="tl-tasks-grid">${tasksHtml}</div></div></div>`;
        });
        return html + '</div>';
    },

    renderCompact: function(phases, data) {
        let html = '<div class="card"><table class="admin-table" style="width:100%;">';
        phases.forEach(phase => {
            const phaseData = data[phase.id] || {};
            html += `<tr style="background:${phase.color}15; border-left:4px solid ${phase.color};"><td colspan="2" style="font-weight:bold; color:${phase.color}; padding:12px;">${phase.title}</td></tr>`;
            phase.tasks.forEach(t => {
                html += `<tr><td style="width:30%; vertical-align:top; padding-top:15px; font-weight:500;">${t.label}</td><td style="padding:10px;">${this.renderInput(t, phaseData[t.id], phase.id)}</td></tr>`;
            });
        });
        return html + '</table></div>';
    },

    renderStepper: function(phases, data) {
        let html = '<div class="tl-stepper">';
        phases.forEach((phase, idx) => {
            const phaseData = data[phase.id] || {};
            html += `<div class="tl-stepper-item" style="margin-bottom:15px; border:1px solid var(--border-color); border-radius:8px; overflow:hidden;"><div class="tl-stepper-header" style="background:var(--bg-card); padding:15px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; border-left:5px solid ${phase.color};" onclick="this.nextElementSibling.classList.toggle('hidden')"><div style="font-weight:bold; font-size:1.1rem; color:${phase.color};"><i class="fas ${phase.icon}" style="margin-right:10px;"></i> ${phase.title}</div><i class="fas fa-chevron-down"></i></div><div class="tl-stepper-content ${idx===0?'':'hidden'}" style="padding:20px; background:var(--bg-input);"><div class="tl-tasks-grid">${phase.tasks.map(t => `<div class="tl-task-card"><div class="tl-task-label">${t.label}</div><div class="tl-task-input">${this.renderInput(t, phaseData[t.id], phase.id)}</div></div>`).join('')}</div></div></div>`;
        });
        return html + '</div>';
    },

    renderInput: function(task, val, phaseId) {
        const myTeam = DataService.getMyTeam();
        
        if (task.type === 'dev_placeholder') return `<div style="padding:8px; background:rgba(0,0,0,0.1); border-radius:4px; color:var(--text-muted); font-style:italic;">Under Development</div>`;
        
        if (task.type === 'team_attendance') {
            if (myTeam.length === 0) return '<div style="color:var(--text-muted);">No agents in My Team. Add them in the My Team tab.</div>';
            const attData = val || {};
            let html = `<div class="tl-team-grid">`;
            myTeam.forEach(member => {
                const agent = member.name; // Extract name from object
                const aData = attData[agent] || { present: true, comment: '' };
                const isAbsent = aData.present === false; // A reason is mandatory if absent
                html += `<div class="tl-team-row ${isAbsent ? 'absent' : ''}"><div style="font-weight:bold; width:150px;">${agent}</div><label style="display:flex; align-items:center; gap:5px; cursor:pointer; margin:0;"><input type="checkbox" ${!isAbsent ? 'checked' : ''} onchange="App.toggleAttendance('${phaseId}', '${task.id}', '${agent.replace(/'/g, "\\'")}', this.checked)"> Present</label><input type="text" class="tl-text-input" placeholder="Reason for absence (mandatory)" value="${aData.comment || ''}" style="flex:1; display:${isAbsent ? 'block' : 'none'};" onchange="App.updateTeamTask('${phaseId}', '${task.id}', '${agent.replace(/'/g, "\\'")}', 'comment', this.value)"></div>`;
            });
            return html + `</div>`;
        }
        
        if (task.type === 'outage_form') {
            // Ensure data is an array for multi-entry support
            const outDataArr = Array.isArray(val) ? val : (val && val.area ? [val] : []);
            const backend = DataService.getBackendData();
            const areas = backend.outage_areas || [];
            const datalistId = `list_areas_${phaseId}`;
            const options = areas.map(a => `<option value="${a.name}">${a.name}</option>`).join('');

            let formsHtml = outDataArr.map((outData, index) => {
                return `
                <div class="tl-outage-form" style="grid-template-columns: 2fr 1fr 2fr auto; margin-bottom: 5px;">
                    <input type="text" class="tl-text-input" list="${datalistId}" placeholder="Select Area..." value="${outData.area || ''}" onchange="App.updateOutageEntry('${phaseId}', '${task.id}', ${index}, 'area', this.value)">
                    <input type="number" class="tl-text-input" placeholder="Count" value="${outData.count || ''}" readonly style="background:var(--bg-card); opacity:0.7; cursor:not-allowed;" title="Auto-filled from Backend Data">
                    <input type="datetime-local" class="tl-text-input" value="${outData.time || ''}" onchange="App.updateOutageEntry('${phaseId}', '${task.id}', ${index}, 'time', this.value)">
                    <button class="btn-danger btn-sm" onclick="App.removeOutageEntry('${phaseId}', '${task.id}', ${index})"><i class="fas fa-trash"></i></button>
                </div>`;
            }).join('');

            return `
                <div>
                    <datalist id="${datalistId}">${options}</datalist>
                    ${formsHtml.length > 0 ? formsHtml : '<div style="color:var(--text-muted); font-style:italic; margin-bottom:5px;">No outages logged.</div>'}
                    <button class="btn-secondary btn-sm" onclick="App.addOutageEntry('${phaseId}', '${task.id}')" style="margin-top:5px;">+ Add Outage</button>
                </div>`;
        }

        if (task.type === 'ticket_backlog') {
            const backData = val || { total: '', oldest: '' };
            return `
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; align-items:center;">
                    <div style="display:flex; flex-direction:column;">
                        <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:2px;">Total Tickets in Backlog</label>
                        <input type="number" class="tl-text-input" placeholder="e.g. 15" value="${backData.total || ''}" onchange="App.updateObjectTask('${phaseId}', '${task.id}', 'total', this.value)">
                    </div>
                    <div style="display:flex; flex-direction:column;">
                        <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:2px;">Date of the oldest ticket</label>
                        <input type="date" class="tl-text-input" value="${backData.oldest || ''}" onchange="App.updateObjectTask('${phaseId}', '${task.id}', 'oldest', this.value)">
                    </div>
                </div>`;
        }
        
        if (task.type === 'handover_notes') {
            const hData = val || { count: '', comment: '', hasProblem: false, problemTickets: [] };
            const pTickets = hData.problemTickets || [];
            
            let problemFormsHtml = pTickets.map((pData, index) => {
                return `
                <div style="padding:10px; background:rgba(231, 76, 60, 0.1); border:1px solid #e74c3c; border-radius:4px; margin-bottom:10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <strong style="color:#c0392b;">Problem Ticket #${index + 1}</strong>
                        <button class="btn-danger btn-sm" onclick="App.removeProblemTicket('${phaseId}', '${task.id}', ${index})"><i class="fas fa-trash"></i></button>
                    </div>
                    <div style="display:flex; gap:10px; margin-bottom:10px;">
                        <input type="number" class="tl-text-input" placeholder="Ticket Nr" value="${pData.number || ''}" style="flex:1;" onchange="App.updateProblemTicketField('${phaseId}', '${task.id}', ${index}, 'number', this.value)">
                        <input type="text" class="tl-text-input" placeholder="Hyperlink to ticket" value="${pData.link || ''}" style="flex:2;" onchange="App.updateProblemTicketField('${phaseId}', '${task.id}', ${index}, 'link', this.value)">
                    </div>
                    <textarea class="tl-text-input" placeholder="General description of the ticket..." style="height:60px; resize:none;" onchange="App.updateProblemTicketField('${phaseId}', '${task.id}', ${index}, 'desc', this.value)">${pData.desc || ''}</textarea>
                </div>`;
            }).join('');
            
            return `
                <div class="tl-handover-form">
                    <div style="display:flex; gap:10px; margin-bottom:10px;">
                        <input type="number" class="tl-text-input" placeholder="Total Handovers" value="${hData.count || ''}" style="width:150px;" onchange="App.updateObjectTask('${phaseId}', '${task.id}', 'count', this.value)">
                        <input type="text" class="tl-text-input" placeholder="General Overview Coment of Shift Handover Tickets" value="${hData.comment || ''}" style="flex:1;" onchange="App.updateObjectTask('${phaseId}', '${task.id}', 'comment', this.value)">
                    </div>
                    
                    <label style="display:flex; align-items:center; gap:5px; cursor:pointer; font-weight:bold; margin-bottom:10px;">
                        <input type="checkbox" ${hData.hasProblem ? 'checked' : ''} onchange="App.toggleHandoverProblem('${phaseId}', '${task.id}', this.checked)"> Problematic Shift handover ticket
                    </label>
                    
                    <div class="${hData.hasProblem ? '' : 'hidden'}">
                        ${problemFormsHtml}
                        <button class="btn-secondary btn-sm" onclick="App.addProblemTicket('${phaseId}', '${task.id}')">+ Add Problem Ticket</button>
                    </div>
                </div>`;
        }
        
        if (task.type === 'op_responsibilities') {
            const assignments = val || {}; // { "AgentName": "AM Group" }
            // Get only ESAs from my team
            const myTeam = DataService.getMyTeam().filter(m => m.role === 'ESA');
            
            if (myTeam.length === 0) return '<div style="color:var(--text-muted);">No ESAs in your team to assign. Add agents with role "ESA" in My Team tab.</div>';

            // Calculate Global Counts from ALL submissions for today
            const allSubs = JSON.parse(localStorage.getItem('tl_task_submissions') || '[]');
            // Filter for current date (handled by App.currentDate context in main)
            // We need to pass date to renderInput or assume App.currentDate is available via App context, 
            // but TimelineUI.render receives date. renderInput doesn't receive date directly but we can use App.currentDate if needed or parse from data.
            // Since we are in renderInput, let's look up data via DataService safely.
            
            let amCount = 0; 
            let cxCount = 0;
            const date = App.currentDate;

            allSubs.forEach(s => {
                if (s.date === date && s.data && s.data.start_shift && s.data.start_shift.t_assign) {
                    const assignData = s.data.start_shift.t_assign;
                    Object.values(assignData).forEach(role => {
                        if (role === 'AM Group') amCount++;
                        if (role === 'CX Group') cxCount++;
                    });
                }
            });

            // Render Columns
            const roles = ['VIP Q', 'AM Group', 'CX Group'];
            const limits = { 'VIP Q': 999, 'AM Group': 2, 'CX Group': 2 };
            const counts = { 'VIP Q': 'Dynamic', 'AM Group': amCount, 'CX Group': cxCount };

            let gridHtml = `<div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px;">`;
            
            roles.forEach(role => {
                const limit = limits[role];
                const current = counts[role];
                const isFull = current >= limit;
                
                let agentsInRole;
                // Default to VIP Q if not assigned
                if (role === 'VIP Q') {
                    // "Every left over esa"
                    // We check if they are NOT in AM or CX
                    agentsInRole = myTeam.filter(a => !assignments[a.name] || assignments[a.name] === 'VIP Q');
                } else {
                    agentsInRole = myTeam.filter(a => assignments[a.name] === role);
                }

                gridHtml += `
                    <div style="border:1px solid var(--border-color); border-radius:6px; background:var(--bg-card);">
                        <div style="padding:10px; background:var(--bg-input); border-bottom:1px solid var(--border-color); font-weight:bold; text-align:center;">
                            ${role} <span style="font-size:0.8rem; color:${isFull ? '#e74c3c' : '#2ecc71'};">(${current}/${limit === 999 ? '∞' : limit})</span>
                        </div>
                        <div style="padding:10px; min-height:100px;">
                            ${agentsInRole.map(a => `
                                <div class="op-resp-agent"
                                     style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px; padding:5px; background:var(--bg-input); border-radius:4px; font-size:0.85rem;">
                                    <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-grow: 1;">${a.name}</span>
                                    ${role === 'VIP Q' 
                                        ? `<div style="display:flex; gap:2px; flex-shrink:0;">
                                            <button class="btn-secondary btn-sm" style="padding:0 4px;" onclick="App.openWorkloadAdjustmentModal('${a.name.replace(/'/g, "\\'")}', '${role}', '${phaseId}', '${task.id}', 'AM Group')" title="Move to AM">AM</button>
                                            <button class="btn-secondary btn-sm" style="padding:0 4px;" onclick="App.openWorkloadAdjustmentModal('${a.name.replace(/'/g, "\\'")}', '${role}', '${phaseId}', '${task.id}', 'CX Group')" title="Move to CX">CX</button>
                                           </div>`
                                        : `<button class="btn-danger btn-sm" style="padding:0 4px; flex-shrink:0;" onclick="App.openWorkloadAdjustmentModal('${a.name.replace(/'/g, "\\'")}', '${role}', '${phaseId}', '${task.id}', 'VIP Q')" title="Remove">x</button>`
                                    }
                                </div>
                            `).join('')}
                            ${role === 'VIP Q' && agentsInRole.length === 0 ? '<div style="font-style:italic; color:var(--text-muted); font-size:0.8rem;">No agents</div>' : ''}
                        </div>
                    </div>
                `;
            });
            gridHtml += `</div>`;
            return gridHtml;
        }

        if (task.type === 'workload_adjustment') {
            // This view mirrors assignments but requires justification for changes
            const submission = DataService.getSubmission(App.currentDate);
            const assignments = (submission.data && submission.data.start_shift && submission.data.start_shift.t_assign) ? submission.data.start_shift.t_assign : {};
            const logs = val && val.logs ? val.logs : [];
            
            const myTeam = DataService.getMyTeam().filter(m => m.role === 'ESA');
            if (myTeam.length === 0) return '<div style="color:var(--text-muted);">No ESAs available to adjust.</div>';

            let listHtml = `<table class="admin-table compressed-table" style="width:100%; margin-bottom:15px;"><thead><tr><th>ESA</th><th>Current Duty</th><th>Action</th></tr></thead><tbody>`;
            
            myTeam.forEach(a => {
                const currentRole = assignments[a.name] || 'VIP Q';
                listHtml += `<tr>
                    <td>${a.name}</td>
                    <td><span class="status-badge status-${currentRole === 'VIP Q' ? 'success' : 'improve'}">${currentRole}</span></td>
                    <td>
                        <button class="btn-secondary btn-sm" onclick="App.openWorkloadAdjustmentModal('${a.name}', '${currentRole}', '${phaseId}', '${task.id}')">Adjust</button>
                    </td>
                </tr>`;
            });
            listHtml += `</tbody></table>`;

            let logsHtml = logs.length > 0 ? `<div style="font-size:0.8rem; font-weight:bold; margin-bottom:5px;">Change Log:</div>` + 
                logs.map(l => `<div style="font-size:0.75rem; border-left:2px solid var(--primary); padding-left:5px; margin-bottom:5px;"><strong>${l.agent}</strong>: ${l.from} &rarr; ${l.to}<br><span style="color:var(--text-muted);">"${l.reason}" (${new Date(l.time).toLocaleTimeString()})</span></div>`).join('') 
                : '<div style="font-size:0.8rem; color:var(--text-muted); font-style:italic;">No adjustments made yet.</div>';

            return listHtml + `<div style="background:var(--bg-input); padding:10px; border-radius:4px;">${logsHtml}</div>`;
        }

        if (task.type === 'team_checklist') {
            if (myTeam.length === 0) return '<div style="color:var(--text-muted);">No agents in My Team.</div>';
            const checkData = val || {};
            let html = `<div class="tl-team-grid">`;
            myTeam.forEach(member => {
                const agent = member.name;
                const agentData = checkData[agent] || { supported: false, desc: '' };
                const isChecked = agentData.supported === true;
                html += `
                    <div class="tl-team-row" style="flex-direction:column; align-items:stretch; background: ${isChecked ? 'rgba(46, 204, 113, 0.05)' : 'transparent'};">
                        <label style="display:flex; align-items:center; gap:5px; cursor:pointer; font-weight:bold; margin-bottom:5px;">
                            <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="App.updateSupportAgentTask('${phaseId}', '${task.id}', '${agent.replace(/'/g, "\\'")}', 'supported', this.checked)"> ${agent}
                        </label>
                        ${isChecked ? `
                            <div style="padding-left:20px;">
                                <textarea class="tl-text-input" placeholder="Brief description of support given (mandatory)..." style="height:40px; resize:none;" onchange="App.updateSupportAgentTask('${phaseId}', '${task.id}', '${agent.replace(/'/g, "\\'")}', 'desc', this.value)">${agentData.desc || ''}</textarea>
                            </div>
                        ` : ''}
                    </div>`;
            });
            return html + `</div>`;
        }
        
        if (task.type === 'team_coaching_extended') {
            if (myTeam.length === 0) return '<div style="color:var(--text-muted);">No agents in "My Team".</div>';
            const coachData = val || {};
            let html = `<div class="tl-team-grid">`;
            myTeam.forEach(member => {
                const agent = member.name;
                const cData = coachData[agent] || { coached: false, desc: '', notes: '' };
                html += `
                    <div class="tl-team-row" style="flex-direction:column; align-items:stretch; background: ${cData.coached ? 'rgba(46, 204, 113, 0.05)' : 'transparent'};">
                        <label style="display:flex; align-items:center; gap:5px; cursor:pointer; font-weight:bold; margin-bottom:5px;">
                            <input type="checkbox" ${cData.coached ? 'checked' : ''} onchange="App.updateTeamTask('${phaseId}', '${task.id}', '${agent.replace(/'/g, "\\'")}', 'coached', this.checked, true)"> ${agent}
                        </label>
                        ${cData.coached ? `
                            <div style="padding-left:20px; display:flex; flex-direction:column; gap:5px;">
                                <textarea class="tl-text-input" placeholder="Brief description of coaching given (mandatory)..." style="height:60px; resize:none;" onchange="App.updateTeamTask('${phaseId}', '${task.id}', '${agent.replace(/'/g, "\\'")}', 'desc', this.value)">${cData.desc || ''}</textarea>
                            </div>
                        ` : ''}
                    </div>`;
            });
            return html + `</div>`;
        }

        if (task.type === 'team_coaching') {
            if (myTeam.length === 0) return '<div style="color:var(--text-muted);">No agents in "My Team".</div>';
            const coachData = val || {};
            let html = `<div class="tl-team-grid">`;
            myTeam.forEach(member => {
                const agent = member.name;
                const cData = coachData[agent] || { coached: false, desc: '' };
                html += `
                    <div class="tl-team-row" style="flex-direction:column; align-items:stretch; background: ${cData.coached ? 'rgba(46, 204, 113, 0.05)' : 'transparent'};">
                        <label style="display:flex; align-items:center; gap:5px; cursor:pointer; font-weight:bold; margin-bottom:5px;">
                            <input type="checkbox" ${cData.coached ? 'checked' : ''} onchange="App.updateTeamTask('${phaseId}', '${task.id}', '${agent.replace(/'/g, "\\'")}', 'coached', this.checked, true)"> ${agent}
                        </label>
                        ${cData.coached ? `
                            <div style="padding-left:20px;"><textarea class="tl-text-input" placeholder="Brief description of coaching given (mandatory)..." style="height:60px; resize:none;" onchange="App.updateTeamTask('${phaseId}', '${task.id}', '${agent.replace(/'/g, "\\'")}', 'desc', this.value)">${cData.desc || ''}</textarea></div>
                        ` : ''}
                    </div>
                `;
            });
            return html + `</div>`;
        }

        if (task.type === 'sentiment_gauge') {
            const moods = ['😞', '😐', '🙂', '🔥'];
            let html = `<div class="tl-emoji-wrapper">`;
            moods.forEach(m => {
                const isActive = (val && val.value === m);
                html += `<button class="tl-emoji-btn ${isActive ? 'active' : ''}" onclick="App.updateObjectTask('${phaseId}', '${task.id}', 'value', '${m}')">${m}</button>`;
            });
            return html + `</div>`;
        }

        if (task.type === 'textarea') {
            const textVal = (val && val.value) ? val.value : (val || '');
            return `<textarea class="tl-text-input" style="height:80px; resize:none;" placeholder="${task.placeholder || ''}" onchange="App.updateObjectTask('${phaseId}', '${task.id}', 'value', this.value)">${textVal}</textarea>`;
        }

        if (task.type === 'bottleneck_form') {
            const backend = DataService.getBackendData();
            const types = backend.bottleneck_types || [];
            const bDataArr = Array.isArray(val) ? val : (val && val.type ? [val] : []);

            let formsHtml = bDataArr.map((bData, index) => {
                let fileLabel = bData.fileName ? `File: ${bData.fileName}` : 'Upload File';
                let linkVal = bData.link || '';
                return `
                <div style="display:grid; grid-template-columns: 1fr 2fr 1fr 1fr auto; gap:10px; align-items:start; margin-bottom:10px; padding-bottom:10px; border-bottom: 1px dashed var(--border-color);">
                    <select class="tl-text-input" onchange="App.updateBottleneckEntry(${index}, 'type', this.value)">
                        <option value="">-- Select Type --</option>
                        ${types.map(t => `<option value="${t}" ${bData.type === t ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                    
                    <textarea class="tl-text-input" style="height:120px; resize:vertical;" placeholder="Brief description of bottleneck..." onchange="App.updateBottleneckEntry(${index}, 'desc', this.value)">${bData.desc || ''}</textarea>
                    
                    <input type="datetime-local" class="tl-text-input" value="${bData.time || ''}" onchange="App.updateBottleneckEntry(${index}, 'time', this.value)">
                    
                    <div style="display:flex; flex-direction:column; gap:5px;">
                        <input type="text" class="tl-text-input" placeholder="Hyperlink URL" value="${linkVal}" onchange="App.updateBottleneckEntry(${index}, 'link', this.value)">
                        <label class="btn-secondary btn-sm" style="text-align:center; cursor:pointer; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">
                            <i class="fas fa-paperclip"></i> ${fileLabel}
                            <input type="file" hidden accept=".pdf,.doc,.docx,.jpg,.png,.jpeg,audio/*,video/*" onchange="App.handleBottleneckUpload(${index}, this)">
                        </label>
                    </div>
                    <button class="btn-danger btn-sm" onclick="App.removeBottleneckEntry(${index})"><i class="fas fa-trash"></i></button>
                </div>`;
            }).join('');

            return `
                <div>
                    ${formsHtml.length > 0 ? formsHtml : '<div style="color:var(--text-muted); font-style:italic; margin-bottom:5px;">No bottlenecks logged.</div>'}
                    <button class="btn-secondary btn-sm" onclick="App.addBottleneckEntry()">+ Add Bottleneck</button>
                </div>`;
        }

        return '';
    }
};
/* ================= TEAM & ROSTER UI ================= */

const TeamUI = {
    renderRoster: function() {
        const myTeam = DataService.getMyTeam();
        const allUsers = JSON.parse(localStorage.getItem('users') || '[]');
        
        const options = allUsers
            .filter(u => u.role === 'trainee' && !myTeam.some(m => m.name === u.user))
            .sort((a,b) => a.user.localeCompare(b.user))
            .map(u => `<option value="${u.user}">${u.user}</option>`).join('');

        const listHtml = myTeam.map(agent => {
            const name = agent.name;
            const role = agent.role || 'First Line Agent';
            const badgeColor = role === 'ESA' ? '#e74c3c' : '#3498db';
            const badge = `<span style="background:${badgeColor}; color:white; padding:2px 6px; border-radius:4px; font-size:0.7rem; margin-left:10px;">${role === 'ESA' ? 'ESA' : 'FLA'}</span>`;

            return `
            <div style="display:flex; justify-content:space-between; padding:10px; border-bottom:1px solid var(--border-color); align-items:center; background:var(--bg-input);">
                <div style="font-weight:bold; display:flex; align-items:center;">${name} ${badge}</div>
                <button class="btn-danger btn-sm" onclick="App.removeAgent('${name.replace(/'/g, "\\'")}')"><i class="fas fa-trash"></i></button>
            </div>
            `;
        }).join('') || '<div style="padding:20px; text-align:center; color:var(--text-muted);">Your team list is empty.</div>';

        return `
            <div class="card">
                <h3>Manage My Team</h3>
                <p style="color:var(--text-muted); margin-bottom:15px;">Add agents to your personal roster.</p>
                
                <div style="margin-bottom:20px;">
                    <label style="font-size:0.85rem; font-weight:bold; display:block; margin-bottom:5px;">Select Existing Agent</label>
                    <div style="display:flex; gap:10px;">
                        <select id="tlAgentSelect" style="flex:1;">
                            <option value="">-- Select Agent --</option>
                            ${options}
                        </select>
                        <button class="btn-primary" onclick="App.addAgent('select')">Add Selected</button>
                    </div>
                </div>

                <div style="margin-bottom:20px; padding-top:15px; border-top:1px dashed var(--border-color);">
                    <label style="font-size:0.85rem; font-weight:bold; display:block; margin-bottom:5px;">Create New Agent</label>
                    <div style="display:flex; gap:10px;">
                        <input type="text" id="tlNewAgentName" placeholder="Agent Name" class="tl-text-input" style="flex:2;">
                        <select id="tlNewAgentRole" class="tl-text-input" style="flex:1;">
                            <option value="First Line Agent">First Line Agent</option>
                            <option value="ESA">ESA</option>
                        </select>
                        <button class="btn-secondary" onclick="App.addAgent('custom')">Create</button>
                    </div>
                </div>

                <div style="margin-bottom:20px; padding-top:15px; border-top:1px dashed var(--border-color);">
                    <button class="btn-secondary btn-sm" onclick="App.copyPreviousTeam()">Copy From Last Submission</button>
                </div>

                <div style="border:1px solid var(--border-color); border-radius:8px; overflow:hidden;">
                    <div style="padding:10px; background:var(--bg-input); font-weight:bold;">Current Roster</div>
                    ${listHtml}
                </div>
            </div>
        `;
    },

    renderCalendar: function(currentDate) {
        const submissions = JSON.parse(localStorage.getItem('tl_task_submissions') || '[]');
        const mySubs = submissions.filter(s => s.user === AppContext.user.user);
        const datesWithData = new Set(mySubs.map(s => s.date));
        
        const current = new Date(currentDate);
        const year = current.getFullYear();
        const month = current.getMonth();
        
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();
        const startDayOfWeek = firstDay.getDay();
        
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        return `
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h3><i class="fas fa-calendar-alt"></i> Team Calendar</h3>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <button class="btn-secondary btn-sm" onclick="App.changeMonth(-1)">&lt;</button>
                        <span style="font-weight:bold; width:150px; text-align:center;">${monthNames[month]} ${year}</span>
                        <button class="btn-secondary btn-sm" onclick="App.changeMonth(1)">&gt;</button>
                    </div>
                </div>
                <div class="tl-calendar-grid">
                    <div class="cal-header">Sun</div><div class="cal-header">Mon</div><div class="cal-header">Tue</div><div class="cal-header">Wed</div><div class="cal-header">Thu</div><div class="cal-header">Fri</div><div class="cal-header">Sat</div>
                    ${Array.from({length: startDayOfWeek}, () => `<div class="cal-day empty"></div>`).join('')}
                    ${Array.from({length: daysInMonth}, (_, i) => {
                        const d = i + 1;
                        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                        const hasData = datesWithData.has(dateStr);
                        const isSelected = dateStr === currentDate;
                        return `<div class="cal-day ${hasData ? 'has-data' : ''} ${isSelected ? 'selected' : ''}" onclick="App.selectDate('${dateStr}')"><div class="day-num">${d}</div>${hasData ? '<div class="day-dot"></div>' : ''}</div>`;
                    }).join('')}
                </div>
            </div>
            <div class="card">
                <h3>Operations History</h3>
                <div class="table-responsive">
                    <table class="admin-table">
                        <thead><tr><th>Date</th><th>Type</th><th>Last Updated</th><th>Action</th></tr></thead>
                        <tbody>
                            ${mySubs.length > 0 ? mySubs.sort((a,b) => new Date(b.date) - new Date(a.date)).map(s => `
                                <tr>
                                    <td>${s.date}</td>
                                    <td style="text-transform:capitalize;">${s.type || 'Daily'}</td>
                                    <td>${new Date(s.lastUpdated).toLocaleString()}</td>
                                    <td><button class="btn-secondary btn-sm" onclick="App.selectDate('${s.date}')"><i class="fas fa-pen"></i> Edit</button></td>
                                </tr>`).join('') : '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No submissions found.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }
};
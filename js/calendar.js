/* ================= CALENDAR & TASK ENGINE ================= */
/* Aggregates Schedules, Live Bookings, and Custom Events */

const CalendarModule = {
    
    // --- CORE: GET UNIFIED EVENTS ---
    getEvents: function() {
        const events = [];
        if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return events;
        const role = CURRENT_USER.role;
        const user = CURRENT_USER.user;
        const normalizedUser = String(user || '').toLowerCase();
        
        // 1. SCHEDULE ITEMS (Timeline)
        const schedules = JSON.parse(localStorage.getItem('schedules') || '{}');
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        
        Object.keys(schedules).forEach(schedId => {
            const sched = schedules[schedId];
            // Visibility Check
            let isVisible = false;
            if (role === 'admin' || role === 'super_admin' || role === 'special_viewer' || role === 'teamleader') isVisible = true;
            else if (role === 'trainee') {
                const myGroup = Object.keys(rosters).find(gid =>
                    Array.isArray(rosters[gid]) && rosters[gid].some(member => String(member || '').toLowerCase() === normalizedUser)
                );
                if (String(sched.assigned || '').toLowerCase() === String(myGroup || '').toLowerCase()) isVisible = true;
            }

            if (isVisible) {
                (sched.items || []).forEach(item => {
                    const safeRange = String(item.dateRange || '').trim();
                    if (!safeRange) return;

                    let start = safeRange;
                    let end = safeRange;
                    if (safeRange.includes('-')) {
                        const parts = safeRange.split('-');
                        start = parts[0].trim();
                        end = parts[1].trim();
                    }
                    
                    let type = 'study';
                    let color = '#3498db'; // Blue
                    if (item.isVetting) { type = 'vetting'; color = '#e74c3c'; } // Red
                    else if (item.isLive) { type = 'live'; color = '#2ecc71'; } // Green
                    else if (item.linkedTestId) { type = 'test'; color = '#f39c12'; } // Orange

                    events.push({
                        title: `${item.courseName} (Sched ${schedId})`,
                        start: start,
                        end: end,
                        color: color,
                        type: type,
                        source: `Schedule ${schedId}`
                    });
                });
            }
        });

        // 2. LIVE BOOKINGS
        const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
        bookings.forEach(b => {
            if (b.status === 'Cancelled') return;
            let isVisible = false;
            if (role === 'admin' || role === 'super_admin' || role === 'special_viewer') isVisible = true;
            else if (String(b.trainee || '').toLowerCase() === normalizedUser || String(b.trainer || '').toLowerCase() === normalizedUser) isVisible = true;

            if (isVisible) {
                events.push({
                    title: `Live: ${b.assessment} (${b.trainee})`,
                    start: b.date,
                    end: b.date,
                    color: '#9b59b6',
                    type: 'booking',
                    source: b.time
                });
            }
        });

        // 3. CUSTOM EVENTS
        const custom = JSON.parse(localStorage.getItem('calendarEvents') || '[]');
        custom.forEach(ev => {
            let isVisible = false;
            if (role === 'admin' || role === 'super_admin') isVisible = true;
            else {
                if (ev.visibility === 'all') isVisible = true;
                else if (ev.visibility === 'trainee' && role === 'trainee') isVisible = true;
                else if (ev.visibility === 'group') {
                    const myGroup = Object.keys(rosters).find(gid =>
                        Array.isArray(rosters[gid]) && rosters[gid].some(member => String(member || '').toLowerCase() === normalizedUser)
                    );
                    if (String(ev.targetGroup || '').toLowerCase() === String(myGroup || '').toLowerCase()) isVisible = true;
                }
                else if (ev.visibility === 'user' && String(ev.targetUser || '').toLowerCase() === normalizedUser) isVisible = true;
            }

            if (isVisible) {
                events.push({
                    title: ev.title,
                    start: ev.date,
                    end: ev.date,
                    color: '#95a5a6',
                    type: 'custom',
                    source: 'Event'
                });
            }
        });

        return events;
    },

    getTasks: function() {
        const events = this.getEvents();
        const today = new Date().toISOString().split('T')[0].replace(/-/g, '/');
        
        const todaysEvents = events.filter(e => {
            const s = e.start.replace(/-/g, '/');
            const end = e.end.replace(/-/g, '/');
            return today >= s && today <= end;
        });

        // ADMIN TASKS (Marking & Attendance)
        if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin') {
            const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
            const pendingMarking = subs.filter(s => s.status === 'pending').length;
            if (pendingMarking > 0) {
                todaysEvents.push({ title: `${pendingMarking} Assessments to Mark`, color: '#e74c3c', type: 'admin_task', action: "showTab('test-manage')" });
            }

            const att = JSON.parse(localStorage.getItem('attendance_records') || '[]');
            const unconfirmed = att.filter(r => r.isLate && !r.lateConfirmed && !r.isIgnored).length;
            if (unconfirmed > 0) {
                todaysEvents.push({ title: `${unconfirmed} Late Arrivals to Review`, color: '#f1c40f', type: 'admin_task', action: "openAttendanceRegister()" });
            }
        }

        return todaysEvents;
    },

    renderWidget: function() {
        const container = document.getElementById('calendar-widget-content');
        if (!container) return;
        
        // FIX: Ensure container fills height and uses flex to expand list
        container.style.height = '100%';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';

        const tasks = this.getTasks();

        if (tasks.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted); flex:1;">No tasks for today.</div>`;
        } else {
            let html = `<div class="task-list" style="flex:1; overflow-y:auto; min-height:0;">`;
            tasks.forEach(t => {
                let icon = 'fa-circle';
                if (t.type === 'vetting') icon = 'fa-shield-alt';
                if (t.type === 'live') icon = 'fa-video';
                if (t.type === 'booking') icon = 'fa-calendar-check';
                if (t.type === 'admin_task') icon = 'fa-exclamation-circle';
                
                const onclick = t.action ? `onclick="${t.action}; event.stopPropagation();"` : '';

                html += `<div style="display:flex; align-items:center; gap:10px; padding:8px; border-bottom:1px solid var(--border-color); font-size:0.9rem; ${t.action ? 'cursor:pointer;' : ''}" ${onclick}>
                        <i class="fas ${icon}" style="color:${t.color};"></i>
                        <div style="flex:1;"><div style="font-weight:bold;">${t.title}</div><div style="font-size:0.75rem; color:var(--text-muted);">${t.source || 'System'}</div></div>
                    </div>`;
            });
            html += `</div>`;
            container.innerHTML = html;
        }
        
        if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin') {
            if (!document.getElementById('btn-add-cal-event')) {
                const btn = document.createElement('div');
                btn.id = 'btn-add-cal-event';
                btn.style.textAlign = 'center';
                btn.style.marginTop = '10px';
                btn.innerHTML = `<button class="btn-secondary btn-sm" onclick="event.stopPropagation(); CalendarModule.openAddModal()">+ Add Event</button>`;
                container.appendChild(btn);
            }
        }
    },
    
    openAddModal: function() {
        const modal = document.getElementById('calendarModal');
        if (modal) modal.classList.remove('hidden');
        const select = document.getElementById('calEventGroup');
        if (select) {
            const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
            select.innerHTML = '<option value="">-- Select Group --</option>';
            Object.keys(rosters).sort().reverse().forEach(gid => { select.add(new Option(gid, gid)); });
        }
    },

    saveEvent: async function() {
        const title = document.getElementById('calEventTitle').value;
        const date = document.getElementById('calEventDate').value;
        const visibility = document.getElementById('calEventVis').value;
        const group = document.getElementById('calEventGroup').value;
        const user = document.getElementById('calEventUser').value;
        if (!title || !date) return alert("Title and Date are required.");
        const newEvent = { id: Date.now() + "_" + Math.random().toString(36).substr(2, 5), title: title, date: date.replace(/-/g, '/'), visibility: visibility, targetGroup: group, targetUser: user, createdBy: CURRENT_USER.user };
        const events = JSON.parse(localStorage.getItem('calendarEvents') || '[]');
        events.push(newEvent);
        localStorage.setItem('calendarEvents', JSON.stringify(events));
        if (typeof saveToServer === 'function') await saveToServer(['calendarEvents'], false);
        document.getElementById('calendarModal').classList.add('hidden');
        this.renderWidget();
        if (document.getElementById('assessment-schedule').classList.contains('active') && typeof renderSchedule === 'function') renderSchedule();
        alert("Event added.");
    },

    toggleVisInputs: function() {
        const vis = document.getElementById('calEventVis').value;
        document.getElementById('calGroupDiv').classList.add('hidden');
        document.getElementById('calUserDiv').classList.add('hidden');
        if (vis === 'group') document.getElementById('calGroupDiv').classList.remove('hidden');
        if (vis === 'user') document.getElementById('calUserDiv').classList.remove('hidden');
    }
};
window.CalendarModule = CalendarModule;

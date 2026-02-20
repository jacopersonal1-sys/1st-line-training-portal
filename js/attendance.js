/* ================= ATTENDANCE SYSTEM ================= */
/* Handles Clock In/Out, Late Validation, and Admin Reporting */

// --- TRAINEE LOGIC ---

let attendanceMonitorInterval = null;

function checkAttendanceStatus() {
    if (!CURRENT_USER || CURRENT_USER.role !== 'trainee') return;

    // Start Clock-Out Monitor if not running
    if (!attendanceMonitorInterval) {
        attendanceMonitorInterval = setInterval(checkClockOutReminder, 60000);
    }

    const now = new Date();
    const day = now.getDay(); // 0=Sun, 6=Sat
    const hour = now.getHours();

    // DYNAMIC CONFIG
    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
    const endHour = config.attendance ? parseInt(config.attendance.work_end.split(':')[0]) : 17;

    // RESTRICTION: Only pop up Mon-Fri (1-5)
    if (day === 0 || day === 6) return; 
    // CHANGED: Allow prompt until 1 hour before work end
    if (hour >= (endHour - 1)) return;

    const today = now.toISOString().split('T')[0];
    const records = JSON.parse(localStorage.getItem('attendance_records') || '[]');
    
    // Check if already clocked in today
    const myRecord = records.find(r => r.user === CURRENT_USER.user && r.date === today);
    
    if (!myRecord) {
        // Not clocked in yet -> Force Modal
        openClockInModal();
    } else if (!myRecord.clockOut) {
        // Clocked in, but not out. Show "Clock Out" button in dashboard/header if needed.
        // For now, we just ensure the modal is closed.
        const modal = document.getElementById('attendanceModal');
        if(modal) modal.classList.add('hidden');
    }
}

function checkClockOutReminder() {
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();
    const min = now.getMinutes();

    if (day === 0 || day === 6) return;

    // DYNAMIC CONFIG
    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
    const remindTime = config.attendance ? config.attendance.reminder_start : "16:45";
    const [remindH, remindM] = remindTime.split(':').map(Number);
    const endH = config.attendance ? parseInt(config.attendance.work_end.split(':')[0]) : 17;

    // Reminder Window: From Reminder Start until Work End
    if (hour === remindH && min >= remindM) {
        const today = now.toISOString().split('T')[0];
        const records = JSON.parse(localStorage.getItem('attendance_records') || '[]');
        const myRecord = records.find(r => r.user === CURRENT_USER.user && r.date === today);

        if (myRecord && !myRecord.clockOut) {
            // Trigger every 5 mins
            if (min % 5 === 0) {
                if (typeof showToast === 'function') showToast(`⚠️ REMINDER: Please Clock Out before ${endH}:00!`, "warning");
                // Stern Popup 5 mins before end
                if (min >= (60 - 5)) alert(`⚠️ URGENT REMINDER\n\nPlease Clock Out now before the ${endH}:00 cutoff.`);
            }
        }
    }
}

function openClockInModal() {
    const modal = document.getElementById('attendanceModal');
    if (!modal) return;

    // Reset Fields
    document.getElementById('lateReasonSection').classList.add('hidden');
    document.getElementById('attLateReason').value = '';
    document.getElementById('attInformed').checked = false;
    document.getElementById('attInformedDetails').classList.add('hidden');
    
    // Check Time (8:00 AM Cutoff)
    const now = new Date();
    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
    const startStr = config.attendance ? config.attendance.work_start : "08:00";
    const [startH, startM] = startStr.split(':').map(Number);
    const cutoff = new Date();
    cutoff.setHours(startH, startM, 0, 0);

    if (now > cutoff) {
        document.getElementById('lateReasonSection').classList.remove('hidden');
        populateAttendanceDropdowns();
    }

    modal.classList.remove('hidden');
}

function populateAttendanceDropdowns() {
    const settings = JSON.parse(localStorage.getItem('attendance_settings') || '{"platforms":[], "contacts":[]}');
    
    const platSel = document.getElementById('attPlatform');
    const contactSel = document.getElementById('attContact');
    
    if (platSel) {
        platSel.innerHTML = '<option value="">-- Select Platform --</option>';
        settings.platforms.forEach(p => platSel.add(new Option(p, p)));
    }
    
    if (contactSel) {
        contactSel.innerHTML = '<option value="">-- Select Person --</option>';
        settings.contacts.forEach(c => contactSel.add(new Option(c, c)));
    }
}

function toggleInformedDetails() {
    const checked = document.getElementById('attInformed').checked;
    const details = document.getElementById('attInformedDetails');
    if (checked) details.classList.remove('hidden');
    else details.classList.add('hidden');
}

async function submitClockIn() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const timeStr = now.toLocaleTimeString();
    
    // Late Check
    const cutoff = new Date();
    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
    const startStr = config.attendance ? config.attendance.work_start : "08:00";
    const [startH, startM] = startStr.split(':').map(Number);
    cutoff.setHours(startH, startM, 0, 0);
    const isLate = now > cutoff;

    let lateData = null;

    if (isLate) {
        const reason = document.getElementById('attLateReason').value.trim();
        if (!reason) return alert("Please provide a valid reason for being late.");
        
        const informed = document.getElementById('attInformed').checked;
        let platform = "";
        let contact = "";

        if (informed) {
            platform = document.getElementById('attPlatform').value;
            contact = document.getElementById('attContact').value;
            if (!platform || !contact) return alert("Please specify how and who you informed.");
        }

        lateData = {
            reason: reason,
            informed: informed,
            platform: platform,
            contact: contact
        };
    }

    const newRecord = {
        id: Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        user: CURRENT_USER.user,
        date: today,
        clockIn: timeStr,
        clockOut: null,
        isLate: isLate,
        lateData: lateData
    };

    const records = JSON.parse(localStorage.getItem('attendance_records') || '[]');
    records.push(newRecord);
    localStorage.setItem('attendance_records', JSON.stringify(records));

    // Force Sync
    if (typeof saveToServer === 'function') await saveToServer(['attendance_records'], true);

    document.getElementById('attendanceModal').classList.add('hidden');
    if (typeof showToast === 'function') showToast("Clocked In Successfully", "success");
}

async function submitClockOut() {
    if (!confirm("Are you sure you want to Clock Out?")) return;

    const today = new Date().toISOString().split('T')[0];
    const records = JSON.parse(localStorage.getItem('attendance_records') || '[]');
    const idx = records.findIndex(r => r.user === CURRENT_USER.user && r.date === today);

    if (idx > -1) {
        records[idx].clockOut = new Date().toLocaleTimeString();
        localStorage.setItem('attendance_records', JSON.stringify(records));
        if (typeof saveToServer === 'function') await saveToServer(['attendance_records'], true);
        if (typeof showToast === 'function') showToast("Clocked Out Successfully", "success");
        // Redirect to login or just show status? Usually logout implies clockout, but this is explicit.
        // For now, just update state.
    } else {
        alert("No Clock In record found for today.");
    }
}

// --- ADMIN LOGIC ---

function openAttendanceRegister() {
    const modal = document.getElementById('attendanceAdminModal');
    if(modal) {
        modal.classList.remove('hidden');
        populateAttendanceGroupSelect();
        renderAttendanceRegister();
    }
}

function populateAttendanceGroupSelect() {
    const sel = document.getElementById('attAdminGroupSelect');
    if(!sel) return;
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    const schedules = JSON.parse(localStorage.getItem('schedules') || '{}');
    sel.innerHTML = '';
    Object.keys(rosters).sort().reverse().forEach(gid => {
        const label = (typeof getGroupLabel === 'function') ? getGroupLabel(gid, rosters[gid].length) : gid;
        sel.add(new Option(label, gid));
    });
    
    // Add Active Schedules Filter
    const activeGroups = new Set();
    Object.values(schedules).forEach(s => {
        if(s.assigned) activeGroups.add(s.assigned);
    });
    if(activeGroups.size > 0) {
        const opt = new Option("--- Active Schedules ---", "active_schedules");
        sel.add(opt, 0); // Add to top
    }
}

function renderAttendanceRegister() {
    const container = document.getElementById('attAdminContent');
    const gid = document.getElementById('attAdminGroupSelect').value;
    if(!container || !gid) return;

    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    const records = JSON.parse(localStorage.getItem('attendance_records') || '[]');
    let members = [];

    if (gid === 'active_schedules') {
        const schedules = JSON.parse(localStorage.getItem('schedules') || '{}');
        Object.values(schedules).forEach(s => {
            if(s.assigned && rosters[s.assigned]) {
                members = [...members, ...rosters[s.assigned]];
            }
        });
        // Deduplicate
        members = [...new Set(members)];
    } else {
        members = rosters[gid] || [];
    }
    
    members.sort();

    let html = `<div class="card"><table class="admin-table"><thead><tr><th>Agent</th><th>Total Days</th><th>Lates</th><th>Unconfirmed Lates</th><th>Action</th></tr></thead><tbody>`;

    members.forEach(m => {
        const myRecs = records.filter(r => r.user === m);
        const total = myRecs.length;
        const lates = myRecs.filter(r => r.isLate && !r.isIgnored).length;
        // Unconfirmed: Late AND (lateConfirmed is undefined or false)
        const unconfirmed = myRecs.filter(r => r.isLate && !r.lateConfirmed && !r.isIgnored);
        
        const safeUser = m.replace(/'/g, "\\\\'");
        
        const unconfDisplay = unconfirmed.length > 0 
            ? `<span class="badge-count" style="position:static; background:#ff5252; font-size:0.85rem; padding:2px 8px; border-radius:12px;">${unconfirmed.length}</span>` 
            : `<span style="color:var(--text-muted); opacity:0.5;">-</span>`;

        let actionBtn = `<button class="btn-secondary btn-sm" onclick="manageAgentAttendance('${safeUser}')">View/Edit</button>`;

        if(unconfirmed.length > 0) {
            // Pass the first unconfirmed ID for simplicity, or handle bulk
            actionBtn = `
                <button class="btn-warning btn-sm" onclick="confirmLate('${unconfirmed[0].id}')" title="Review Reason">Review</button>
                <button class="btn-danger btn-sm" onclick="deleteLateEntry('${unconfirmed[0].id}')" style="margin-left:5px;" title="Delete Entry"><i class="fas fa-trash"></i></button>
                <button class="btn-secondary btn-sm" onclick="manageAgentAttendance('${safeUser}')" style="margin-left:5px;">View/Edit</button>
            `;
        }

        html += `<tr>
            <td><div style="display:flex; align-items:center; gap:10px;"><div style="width:30px; height:30px; background:var(--bg-input); border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; color:var(--primary);">${m.charAt(0)}</div> <strong>${m}</strong></div></td>
            <td>${total}</td>
            <td>${lates > 0 ? `<span style="color:#f1c40f; font-weight:bold;">${lates}</span>` : lates}</td>
            <td>${unconfDisplay}</td>
            <td>${actionBtn}</td>
        </tr>`;
    });
    html += `</tbody></table></div>`;
    container.innerHTML = html;
}

async function confirmLate(recordId) {
    const records = JSON.parse(localStorage.getItem('attendance_records') || '[]');
    const rec = records.find(r => r.id === recordId);
    
    if(!rec) return;
    
    const reason = rec.lateData ? rec.lateData.reason : "No reason provided.";
    const informed = rec.lateData && rec.lateData.informed ? `Informed: ${rec.lateData.contact}` : "Did not inform.";
    
    const message = `Review Late Entry for ${rec.user}:\n\nDate: ${rec.date}\nTime: ${rec.clockIn}\nReason: ${reason}\n${informed}\n\nEnter Admin Comment (Optional):`;
    const comment = await customPrompt("Confirm Late Entry", message, "");

    if(comment !== null) {
        rec.lateConfirmed = true;
        rec.adminComment = comment; // Save persistent comment
        localStorage.setItem('attendance_records', JSON.stringify(records));
        if(typeof saveToServer === 'function') await saveToServer(['attendance_records'], true);
        
        renderAttendanceRegister();
        if(typeof checkMissingClockIns === 'function') checkMissingClockIns(); // Refresh badge
    }
}

async function deleteLateEntry(recordId) {
    if(!confirm("Delete this late entry? It will be removed from the record.")) return;
    const records = JSON.parse(localStorage.getItem('attendance_records') || '[]');
    const idx = records.findIndex(r => r.id === recordId);
    if(idx > -1) {
        records.splice(idx, 1);
        localStorage.setItem('attendance_records', JSON.stringify(records));
        if(typeof saveToServer === 'function') await saveToServer(['attendance_records'], true);
        renderAttendanceRegister();
        if(typeof checkMissingClockIns === 'function') checkMissingClockIns();
    }
}

function manageAgentAttendance(username) {
    const container = document.getElementById('attAdminContent');
    const records = JSON.parse(localStorage.getItem('attendance_records') || '[]');
    let myRecs = records.filter(r => r.user === username);
    
    // --- AUTO-GENERATE ABSENTEEISM ---
    // Scan last 30 days for missing weekdays
    const today = new Date();
    const cutoff = new Date();
    cutoff.setDate(today.getDate() - 30); // Look back 30 days

    const existingDates = new Set(myRecs.map(r => r.date));
    const absents = [];

    for (let d = new Date(cutoff); d < today; d.setDate(d.getDate() + 1)) {
        const dayOfWeek = d.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) continue; // Skip Sat/Sun
        
        const dateStr = d.toISOString().split('T')[0];
        if (!existingDates.has(dateStr)) {
            absents.push({
                id: 'absent_' + dateStr,
                date: dateStr,
                user: username,
                clockIn: '-',
                clockOut: '-',
                isAbsent: true
            });
        }
    }
    
    // Merge real records with generated absents
    myRecs = [...myRecs, ...absents];
    
    myRecs.sort((a,b) => new Date(b.date) - new Date(a.date));

    let html = `
        <div class="card" style="border-top: 4px solid var(--primary);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; padding-bottom:10px; border-bottom:1px solid var(--border-color);">
                <h3 style="margin:0;"><i class="fas fa-history"></i> Attendance History: <span style="color:var(--primary);">${username}</span></h3>
                <button class="btn-secondary btn-sm" onclick="renderAttendanceRegister()">&larr; Back to Register</button>
            </div>
            <div class="table-responsive" style="max-height:60vh; overflow-y:auto;">
            <table class="admin-table">
                <thead><tr><th>Date</th><th>Clock In</th><th>Clock Out</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>
    `;
    
    if (myRecs.length === 0) {
        html += `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No records found.</td></tr>`;
    } else {
        myRecs.forEach(r => {
            let status = '';
            if (r.isAbsent) status = '<span style="color:#e74c3c; font-weight:bold;">Absent</span>';
            else if (r.isIgnored) status = '<span style="color:var(--text-muted);">Ignored</span>';
            else if (r.isLate) status = '<span style="color:#ff5252;">Late</span>';
            else status = '<span style="color:#2ecc71;">On Time</span>';

            const safeUser = username.replace(/'/g, "\\\\'");
            const commentHtml = r.adminComment ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px; font-style:italic;">Admin: ${r.adminComment}</div>` : '';
            html += `
                <tr>
                    <td>${r.date}</td>
                    <td>${r.clockIn}</td>
                    <td>${r.clockOut || '-'}</td>
                    <td>${status}${commentHtml}</td>
                    <td>
                        <button class="btn-secondary btn-sm" onclick="editAttendanceRecord('${r.id}', '${safeUser}')" title="Edit Record"><i class="fas fa-pen"></i></button>
                        ${!r.isAbsent ? `<button class="btn-danger btn-sm" onclick="deleteAttendanceRecord('${r.id}', '${safeUser}')" title="Delete Record"><i class="fas fa-trash"></i></button>` : ''}
                    </td>
                </tr>
            `;
        });
    }
    
    html += `</tbody></table></div></div>`;
    container.innerHTML = html;
}

function editAttendanceRecord(id, username) {
    const records = JSON.parse(localStorage.getItem('attendance_records') || '[]');
    let rec = records.find(r => r.id === id);

    // Handle Generated Absent Record (Create temporary object for editing)
    if (!rec && id.startsWith('absent_')) {
        const dateStr = id.replace('absent_', '');
        rec = {
            id: id,
            date: dateStr,
            clockIn: '',
            clockOut: '',
            isAbsent: true,
            user: username
        };
    }

    if(!rec) return;

    // Helper to convert time string (e.g. "8:00:00 AM") to input format "HH:mm"
    const toInputTime = (str) => {
        if(!str) return '';
        if(str.match(/^\d{2}:\d{2}$/)) return str; // Already HH:mm
        try {
            const d = new Date('1970-01-01 ' + str);
            if(isNaN(d.getTime())) return '';
            return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
        } catch(e) { return ''; }
    };

    const safeUser = username.replace(/'/g, "\\\\'");

    const modal = document.createElement('div');
    modal.id = 'attendanceEditModal'; // Unique ID to prevent closing wrong modal
    modal.className = 'modal-overlay';
    modal.style.zIndex = '11000'; // Ensure it sits above the register view
    modal.innerHTML = `
        <div class="modal-box">
            <h3>Edit Attendance: ${username}</h3>
            <label>Date</label><input type="date" id="editAttDate" value="${rec.date}">
            <label>Clock In</label><input type="time" id="editAttIn" value="${toInputTime(rec.clockIn)}">
            <label>Clock Out</label><input type="time" id="editAttOut" value="${toInputTime(rec.clockOut)}">
            <label>Status Override</label>
            <select id="editAttStatus">
                <option value="normal" ${(!rec.isLate && !rec.isIgnored) ? 'selected' : ''}>Normal (On Time)</option>
                <option value="late" ${rec.isLate && !rec.isIgnored ? 'selected' : ''}>Late</option>
                <option value="ignored" ${rec.isIgnored ? 'selected' : ''}>Ignored (Excused)</option>
            </select>
            <div style="margin-top:15px; text-align:right;">
                <button class="btn-secondary" onclick="document.getElementById('attendanceEditModal').remove()">Cancel</button>
                <button class="btn-primary" onclick="saveAttendanceEdit('${id}', '${safeUser}')">Save</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

window.saveAttendanceEdit = async function(id, username) {
    let records = JSON.parse(localStorage.getItem('attendance_records') || '[]');
    let rec = records.find(r => r.id === id);

    const dateVal = document.getElementById('editAttDate').value;
    const inVal = document.getElementById('editAttIn').value;
    const outVal = document.getElementById('editAttOut').value;
    const statusVal = document.getElementById('editAttStatus').value;

    // If editing a generated absent record, create a new real record
    if (!rec && id.startsWith('absent_')) {
        rec = {
            id: Date.now() + "_" + Math.random().toString(36).substr(2, 5),
            user: username,
            date: dateVal,
            clockIn: inVal,
            clockOut: outVal,
            isLate: statusVal === 'late',
            isIgnored: statusVal === 'ignored',
            isAbsent: false // Converted from Absent to Present/Late
        };
        records.push(rec);
    } else if (rec) {
        // Update existing
        rec.date = dateVal;
        rec.clockIn = inVal;
        rec.clockOut = outVal;
        rec.isLate = (statusVal === 'late');
        rec.isIgnored = (statusVal === 'ignored');
        rec.isAbsent = false; // Ensure it's no longer marked absent
    }

    localStorage.setItem('attendance_records', JSON.stringify(records));
    
    // Close modal FIRST to ensure UI responsiveness
    const modal = document.getElementById('attendanceEditModal');
    if(modal) modal.remove();
    
    manageAgentAttendance(username);

    // Sync in background
    if(typeof saveToServer === 'function') await saveToServer(['attendance_records'], true);
}

async function deleteAttendanceRecord(id, username) {
    if(!confirm("Permanently delete this attendance entry?")) return;
    
    const records = JSON.parse(localStorage.getItem('attendance_records') || '[]');
    const idx = records.findIndex(r => r.id === id);
    
    if(idx > -1) {
        records.splice(idx, 1);
        localStorage.setItem('attendance_records', JSON.stringify(records));
        if(typeof saveToServer === 'function') await saveToServer(['attendance_records'], true);
        
        manageAgentAttendance(username);
        if(typeof checkMissingClockIns === 'function') checkMissingClockIns();
    }
}

function checkMissingClockIns() {
    // Admin Alert Widget Logic
    const records = JSON.parse(localStorage.getItem('attendance_records') || '[]');
    
    // Count Unconfirmed Lates
    const unconfirmedCount = records.filter(r => r.isLate && !r.lateConfirmed).length;
    
    const widget = document.getElementById('attAlertWidget');
    // We don't use the widget anymore, we use the Dashboard Badge.
    // But we can update the badge here if called.
    const badge = document.getElementById('badgeAtt');
    if(badge) {
        if(unconfirmedCount > 0) {
            badge.innerText = unconfirmedCount;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
}

// --- SETTINGS MANAGEMENT ---
async function saveAttendanceSettings() {
    const platforms = document.getElementById('setAttPlatforms').value.split(',').map(s => s.trim()).filter(s => s);
    const contacts = document.getElementById('setAttContacts').value.split(',').map(s => s.trim()).filter(s => s);
    
    const settings = {
        platforms: platforms,
        contacts: contacts
    };
    
    localStorage.setItem('attendance_settings', JSON.stringify(settings));
    if (typeof saveToServer === 'function') await saveToServer(['attendance_settings'], true);
    
    if (typeof showToast === 'function') showToast("Attendance settings saved.", "success");
}

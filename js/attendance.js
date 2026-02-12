/* ================= ATTENDANCE SYSTEM ================= */
/* Handles Clock In/Out, Late Validation, and Admin Reporting */

// --- TRAINEE LOGIC ---

function checkAttendanceStatus() {
    if (!CURRENT_USER || CURRENT_USER.role !== 'trainee') return;

    const today = new Date().toISOString().split('T')[0];
    const records = JSON.parse(localStorage.getItem('attendance_records') || '[]');
    
    // Check if already clocked in today
    const myRecord = records.find(r => r.user === CURRENT_USER.user && r.date === today);
    
    if (!myRecord) {
        // Not clocked in yet -> Force Modal
        openClockInModal();
    } else if (!myRecord.clockOut) {
        // Clocked in, but not out. Show "Clock Out" button in dashboard/header if needed.
        // For now, we just ensure the modal is closed.
        document.getElementById('attendanceModal').classList.add('hidden');
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
    const cutoff = new Date();
    cutoff.setHours(8, 0, 0, 0);

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
    cutoff.setHours(8, 0, 0, 0);
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
    sel.innerHTML = '';
    Object.keys(rosters).sort().reverse().forEach(gid => {
        const label = (typeof getGroupLabel === 'function') ? getGroupLabel(gid, rosters[gid].length) : gid;
        sel.add(new Option(label, gid));
    });
}

function renderAttendanceRegister() {
    const container = document.getElementById('attAdminContent');
    const gid = document.getElementById('attAdminGroupSelect').value;
    if(!container || !gid) return;

    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    const records = JSON.parse(localStorage.getItem('attendance_records') || '[]');
    const members = rosters[gid] || [];

    let html = `<table class="admin-table"><thead><tr><th>Agent</th><th>Total Days</th><th>Lates</th><th>Unconfirmed Lates</th><th>Action</th></tr></thead><tbody>`;

    members.forEach(m => {
        const myRecs = records.filter(r => r.user === m);
        const total = myRecs.length;
        const lates = myRecs.filter(r => r.isLate).length;
        // Unconfirmed: Late AND (lateConfirmed is undefined or false)
        const unconfirmed = myRecs.filter(r => r.isLate && !r.lateConfirmed);
        
        const safeUser = m.replace(/'/g, "\\'");
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
            <td>${m}</td>
            <td>${total}</td>
            <td>${lates}</td>
            <td style="${unconfirmed.length > 0 ? 'color:#ff5252; font-weight:bold;' : ''}">${unconfirmed.length}</td>
            <td>${actionBtn}</td>
        </tr>`;
    });
    html += `</tbody></table>`;
    container.innerHTML = html;
}

async function confirmLate(recordId) {
    const records = JSON.parse(localStorage.getItem('attendance_records') || '[]');
    const rec = records.find(r => r.id === recordId);
    
    if(!rec) return;
    
    const reason = rec.lateData ? rec.lateData.reason : "No reason provided.";
    const informed = rec.lateData && rec.lateData.informed ? `Informed: ${rec.lateData.contact}` : "Did not inform.";
    
    if(confirm(`Review Late Entry for ${rec.user}:\n\nDate: ${rec.date}\nTime: ${rec.clockIn}\nReason: ${reason}\n${informed}\n\nConfirm this late entry?`)) {
        rec.lateConfirmed = true;
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
    const myRecs = records.filter(r => r.user === username);
    
    myRecs.sort((a,b) => new Date(b.date) - new Date(a.date));

    let html = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <h4>Attendance History: ${username}</h4>
            <button class="btn-secondary btn-sm" onclick="renderAttendanceRegister()">&larr; Back to Register</button>
        </div>
        <div style="max-height:50vh; overflow-y:auto;">
        <table class="admin-table">
            <thead><tr><th>Date</th><th>Clock In</th><th>Clock Out</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
    `;
    
    if (myRecs.length === 0) {
        html += `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No records found.</td></tr>`;
    } else {
        myRecs.forEach(r => {
            const status = r.isLate ? '<span style="color:#ff5252;">Late</span>' : '<span style="color:#2ecc71;">On Time</span>';
            const safeUser = username.replace(/'/g, "\\'");
            html += `
                <tr>
                    <td>${r.date}</td>
                    <td>${r.clockIn}</td>
                    <td>${r.clockOut || '-'}</td>
                    <td>${status}</td>
                    <td>
                        <button class="btn-danger btn-sm" onclick="deleteAttendanceRecord('${r.id}', '${safeUser}')" title="Delete Record"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `;
        });
    }
    
    html += `</tbody></table></div>`;
    container.innerHTML = html;
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

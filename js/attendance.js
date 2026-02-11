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

function loadAttendanceDashboard() {
    const container = document.getElementById('attendanceList');
    if (!container) return;

    const records = JSON.parse(localStorage.getItem('attendance_records') || '[]');
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    const today = new Date().toISOString().split('T')[0];
    
    // Update Alert Widget
    if(typeof checkMissingClockIns === 'function') checkMissingClockIns();
    
    // Group by Roster
    let html = '';
    
    Object.keys(rosters).sort().reverse().forEach(gid => {
        const members = rosters[gid];
        if (!members || members.length === 0) return;

        const groupLabel = (typeof getGroupLabel === 'function') ? getGroupLabel(gid, members.length) : gid;
        
        html += `<div class="card" style="margin-bottom:20px;">
            <h4 style="margin-top:0; border-bottom:1px solid var(--border-color); padding-bottom:10px; color:var(--primary);">${groupLabel}</h4>
            <table class="admin-table">
                <thead>
                    <tr>
                        <th>Trainee</th>
                        <th>Total Days</th>
                        <th>Lates</th>
                        <th>Today's Status</th>
                        <th>Last Seen</th>
                    </tr>
                </thead>
                <tbody>`;
        
        members.forEach(member => {
            // Get all records for this user
            const userRecords = records.filter(r => r.user === member);
            const totalDays = userRecords.length;
            const lates = userRecords.filter(r => r.isLate).length;
            
            // Sort to find last seen
            userRecords.sort((a,b) => new Date(b.date) - new Date(a.date));
            const lastRecord = userRecords[0];
            
            // Check Today
            const todayRecord = userRecords.find(r => r.date === today);
            let todayStatus = '<span class="status-badge status-fail" style="opacity:0.5;">Absent</span>';
            
            if (todayRecord) {
                if (todayRecord.clockOut) {
                    todayStatus = '<span class="status-badge status-pass">Clocked Out</span>';
                } else {
                    todayStatus = '<span class="status-badge status-improve">Active</span>';
                }
                
                if (todayRecord.isLate) {
                     todayStatus += ' <span style="font-size:0.7rem; color:#ff5252;">(Late)</span>';
                }
            }

            const lastSeenStr = lastRecord ? `${lastRecord.date} (${lastRecord.clockIn})` : '-';

            html += `<tr>
                <td><strong>${member}</strong></td>
                <td>${totalDays}</td>
                <td style="${lates > 0 ? 'color:#ff5252; font-weight:bold;' : ''}">${lates}</td>
                <td>${todayStatus}</td>
                <td style="font-size:0.85rem; color:var(--text-muted);">${lastSeenStr}</td>
            </tr>`;
        });
        
        html += `</tbody></table></div>`;
    });

    container.innerHTML = html;
}

function checkMissingClockIns() {
    // Admin Alert Widget Logic
    const records = JSON.parse(localStorage.getItem('attendance_records') || '[]');
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const today = new Date().toISOString().split('T')[0];
    
    const trainees = users.filter(u => u.role === 'trainee');
    const clockedIn = records.filter(r => r.date === today).map(r => r.user);
    
    const missing = trainees.filter(t => !clockedIn.includes(t.user));
    
    const widget = document.getElementById('attAlertWidget');
    if (widget) {
        if (missing.length > 0) {
            widget.innerHTML = `<div style="padding:10px; background:rgba(255, 82, 82, 0.1); border-left:4px solid #ff5252; border-radius:4px;">
                <strong><i class="fas fa-user-clock"></i> Missing Clock-Ins (${missing.length})</strong>
                <div style="font-size:0.8rem; margin-top:5px; max-height:60px; overflow-y:auto;">${missing.map(u => u.user).join(', ')}</div>
            </div>`;
            widget.classList.remove('hidden');
        } else {
            widget.classList.add('hidden');
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
```

### 3. c:\BuildZone\index.html
Adding the modal, admin view, and script reference.

```diff
    </div>
</div>

<div id="attendanceModal" class="modal-overlay hidden" style="z-index: 4000; background: rgba(0,0,0,0.9);">
    <div class="modal-box">
        <h3><i class="fas fa-clock"></i> Daily Clock In</h3>
        <p style="color:var(--text-muted); margin-bottom:20px;">Please confirm your attendance for today.</p>
        
        <div id="lateReasonSection" class="hidden" style="background:rgba(255, 82, 82, 0.1); padding:15px; border-radius:8px; border:1px solid #ff5252; margin-bottom:20px;">
            <strong style="color:#ff5252; display:block; margin-bottom:10px;">You are clocking in after 08:00 AM.</strong>
            
            <label for="attLateReason">Valid Reason for Lateness</label>
            <textarea id="attLateReason" placeholder="Explain why you are late..." style="height:60px;"></textarea>
            
            <div style="margin-top:10px;">
                <label style="cursor:pointer; display:flex; align-items:center;">
                    <input type="checkbox" id="attInformed" onchange="toggleInformedDetails()" style="width:auto; margin-right:10px;"> 
                    Did you inform a Trainer/Team Leader?
                </label>
            </div>
            
            <div id="attInformedDetails" class="hidden" style="margin-top:10px; padding-left:20px; border-left:2px solid var(--border-color);">
                <label>Platform Used</label><select id="attPlatform"></select>
                <label>Person Informed</label><select id="attContact"></select>
            </div>
        </div>

        <button class="btn-primary btn-lg" style="width:100%;" onclick="submitClockIn()">Confirm Clock In</button>
    </div>
</div>

<div id="bookingModal" class="modal-overlay hidden">
  <div class="modal-box">
    <h3>Confirm Booking</h3>
            <button class="sub-tab-btn" id="btn-sub-data" onclick="showAdminSub('data', this)">Database</button>
            <button class="sub-tab-btn" id="btn-sub-access" onclick="showAdminSub('access', this)">Access Control</button>
            <button class="sub-tab-btn" id="btn-sub-status" onclick="showAdminSub('status', this)">System Status</button>
            <button class="sub-tab-btn" id="btn-sub-attendance" onclick="showAdminSub('attendance', this)">Attendance</button>
            <button class="sub-tab-btn" id="btn-sub-updates" onclick="showAdminSub('updates', this)">System Updates</button>
            <button class="sub-tab-btn" id="btn-sub-theme" onclick="showAdminSub('theme', this)">Theme Settings</button> 
        </div>
            </div>
        </div>

        <div id="admin-view-attendance" class="admin-view">
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h3>Attendance Register</h3>
                    <input type="date" id="attDateFilter" onchange="loadAttendanceDashboard()" style="margin:0;">
                </div>
                <div id="attAlertWidget" class="hidden" style="margin-bottom:20px;"></div>
                <div id="attendanceList"></div>
                
                <div style="margin-top:30px; padding-top:20px; border-top:1px solid var(--border-color);">
                    <h4>Settings (Dropdown Options)</h4>
                    <label>Platforms (Comma separated)</label><input type="text" id="setAttPlatforms" value="WhatsApp, Microsoft Teams, Call, SMS">
                    <label>Contacts (Comma separated)</label><input type="text" id="setAttContacts" value="Darren, Netta, Jaco, Claudine">
                    <button class="btn-secondary" onclick="saveAttendanceSettings()">Save Settings</button>
                </div>
            </div>
        </div>

        <div id="admin-view-updates" class="admin-view">
            <div class="card">
                <h3>System Updates</h3>
<script src="js/live_execution.js"></script>
<script src="js/agent_search.js"></script>
<script src="js/admin_history.js"></script>
<script src="js/attendance.js"></script>

<script src="js/main.js"></script>

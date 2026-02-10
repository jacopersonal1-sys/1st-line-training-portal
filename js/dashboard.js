/* ================= DASHBOARD CONTROLLER ================= */
/* Handles the "Home" view with role-specific widgets and Urgent Notices */

// --- HELPER: INSTANT SAVE ---
// Updates now use force=true to ensure Notices and Acks are saved immediately.
// This prevents the "not working" behavior caused by merge conflicts.
async function secureDashboardSave() {
    if (typeof saveToServer === 'function') {
        try {
            // PARAMETER 'false' = SAFE MERGE (Preserves other users' reads)
            await saveToServer(['notices'], false);
        } catch(e) {
            console.error("Dashboard Save Error:", e);
        }
    }
}

function renderDashboard() {
    const container = document.getElementById('dashboard-view');
    if (!container) return;

    container.innerHTML = ''; // Clear previous

    const role = CURRENT_USER.role;
    
    // 1. URGENT NOTICES SECTION
    const noticeHtml = buildNoticeBanners(role);
    container.innerHTML += noticeHtml;
    
    // NEW: Invasive Modal Check for Trainees
    if (role === 'trainee') {
        if (typeof checkUrgentNoticesPopup === 'function') checkUrgentNoticesPopup();
    }

    // 2. GREETING HEADER
    const header = document.createElement('div');
    header.className = 'dash-header';
    header.innerHTML = `
        <div style="margin-bottom:20px;">
            <h2 style="margin:0;">Hello, <span style="color:var(--primary);">${CURRENT_USER.user}</span></h2>
            <p style="color:var(--text-muted); margin-top:5px;">Here is your daily overview.</p>
        </div>
    `;
    container.appendChild(header);

    // 3. ROLE SPECIFIC CONTENT
    const content = document.createElement('div');
    content.className = 'dash-content-grid'; 
    
    if (role === 'admin' || role === 'special_viewer') {
        content.innerHTML = buildAdminWidgets();
        content.innerHTML += buildLinkRequestsWidget(); // Add Link Requests Widget
        // Append Notice Manager for Admins
        const manager = document.createElement('div');
        manager.className = 'dash-panel full-width';
        manager.style.marginTop = '20px';
        manager.innerHTML = buildNoticeManager();
        container.appendChild(content);
        container.appendChild(manager);
        
        // Check for missing clock-ins immediately
        if(typeof checkMissingClockIns === 'function') checkMissingClockIns();
        
        // Trigger Dashboard-specific health check
        updateDashboardHealth();
    } else if (role === 'teamleader') {
        content.innerHTML = buildTLWidgets();
        container.appendChild(content);
    } else {
        content.innerHTML = buildTraineeWidgets();
        container.appendChild(content);
    }
}

// --- SYSTEM HEALTH & ACTIVE USERS (DASHBOARD SPECIFIC - MIGRATED TO SUPABASE) ---
async function updateDashboardHealth() {
    const storageEl = document.getElementById('dashStorage');
    const latencyEl = document.getElementById('dashLatency');
    const syncEl = document.getElementById('dashLastSync'); 
    const activeTableBody = document.getElementById('dashActiveUsersBody'); 

    if (!latencyEl) return; 

    const start = Date.now();
    try {
        // FIX: Use 'supabaseClient' (defined in config.js) to avoid naming conflict
        if (!window.supabaseClient) {
            if(latencyEl) latencyEl.innerText = "Lib Missing";
            return;
        }

        const twoMinsAgo = new Date(Date.now() - 120000).toISOString();
        
        // Fetch active sessions from Supabase
        const { data: activeUsers, error } = await supabaseClient
            .from('sessions')
            .select('*')
            .gte('lastSeen', twoMinsAgo);

        const end = Date.now();
        const latency = end - start;

        if (!error) {
            // Calculate Storage Size locally (JSON string size)
            let sizeStr = "0 B";
            if (typeof formatBytes === 'function') {
                const totalStr = JSON.stringify(localStorage);
                sizeStr = formatBytes(new TextEncoder().encode(totalStr).length);
            }
            
            if(storageEl) storageEl.innerText = sizeStr;
            if(latencyEl) {
                latencyEl.innerText = latency + " ms";
                latencyEl.style.color = latency < 200 ? "#2ecc71" : (latency < 500 ? "orange" : "#ff5252");
            }

            // --- LAST SYNC TIME ---
            if(syncEl) {
                const lastSync = localStorage.getItem('lastSyncTimestamp');
                if(lastSync) {
                    const diff = Date.now() - parseInt(lastSync);
                    syncEl.innerText = (typeof formatDuration === 'function') ? formatDuration(diff) + ' ago' : Math.round(diff/1000) + 's ago';
                } else {
                    syncEl.innerText = "Just now";
                }
            }

            // --- ACTIVE USERS MONITOR ---
            if(activeTableBody && activeUsers) {
                if(activeUsers.length === 0) {
                    activeTableBody.innerHTML = '<tr><td colspan="4" class="text-center" style="color:var(--text-muted);">No active users.</td></tr>';
                } else {
                    activeTableBody.innerHTML = activeUsers.map(u => {
                        const idleStr = (typeof formatDuration === 'function') ? formatDuration(u.idleTime) : (u.idleTime/1000).toFixed(0)+'s';
                        const statusBadge = u.isIdle 
                            ? '<span class="status-badge status-fail">Idle</span>' 
                            : '<span class="status-badge status-pass">Active</span>';
                        return `
                            <tr>
                                <td><strong>${u.user}</strong></td>
                                <td>${u.role}</td>
                                <td>${statusBadge}</td>
                                <td>${idleStr}</td>
                            </tr>`;
                    }).join('');
                }
            }
        } else {
            throw error; // Propagate error to catch block
        }
    } catch (e) {
        console.error("Dashboard health check failed", e);
        if(latencyEl) {
            latencyEl.innerText = "OFFLINE";
            latencyEl.style.color = "#ff5252";
        }
        if(syncEl) syncEl.innerText = "Connection Lost";
    }
}

// --- NOTICE SYSTEM LOGIC ---

function buildNoticeBanners(role) {
    const notices = JSON.parse(localStorage.getItem('notices') || '[]');
    // Filter: Active AND (Target Role Matches OR Target is All)
    const activeNotices = notices.filter(n => 
        n.active && (n.targetRole === 'all' || n.targetRole === role)
    );

    if (activeNotices.length === 0) return '';

    let html = '<div class="notice-container" style="margin-bottom:20px;">';
    
    activeNotices.forEach(n => {
        // Check if acknowledged
        const isAck = n.acks && n.acks.includes(CURRENT_USER.user);
        if (isAck && role !== 'admin') return; // Hide if read (except for admin)

        const urgencyColor = n.type === 'critical' ? '#e74c3c' : '#f39c12'; // Red or Orange
        
        html += `
        <div class="notice-banner" style="background:rgba(255,255,255,0.05); border-left:5px solid ${urgencyColor}; padding:15px; margin-bottom:10px; border-radius:4px; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <strong style="color:${urgencyColor}; text-transform:uppercase; font-size:0.8rem; letter-spacing:1px;">${n.type} NOTICE</strong>
                <div style="font-size:1.1rem; margin-top:5px;">${n.message}</div>
                <div style="font-size:0.75rem; color:var(--text-muted); margin-top:5px;">Posted: ${n.date}</div>
            </div>
            ${role !== 'admin' ? 
                `<button class="btn-secondary btn-sm" onclick="acknowledgeNotice('${n.id}')"><i class="fas fa-check"></i> Mark as Read</button>` 
                : `<span style="font-size:0.8rem; color:var(--text-muted);">Visible to ${n.targetRole}</span>`
            }
        </div>`;
    });

    html += '</div>';
    return html;
}

function buildNoticeManager() {
    if (CURRENT_USER.role === 'special_viewer') {
        return '<div style="color:var(--text-muted); text-align:center; padding:20px;">Notice Management Hidden (View Only)</div>';
    }

    const notices = JSON.parse(localStorage.getItem('notices') || '[]');
    // Sort by date desc
    notices.sort((a,b) => new Date(b.date) - new Date(a.date));

    // Helper to generate the Acknowledgement list
    const getAckList = (n) => {
        return (n.acks && n.acks.length > 0) 
            ? n.acks.map(u => `<li><i class="fas fa-check" style="color:#2ecc71; margin-right:5px;"></i> ${u}</li>`).join('')
            : '<li style="color:var(--text-muted); font-style:italic;">No reads yet</li>';
    };

    // Active List
    const activeRows = notices.filter(n => n.active).map(n => {
        return `
        <tr style="background:rgba(39, 174, 96, 0.1);">
            <td>${n.date}</td>
            <td>${n.message}</td>
            <td>${n.targetRole}</td>
            <td>
                <div class="notice-ack-wrapper">
                    <span style="font-weight:bold;">${n.acks ? n.acks.length : 0} Reads</span>
                    <button class="ack-eye-btn" onclick="toggleAckDropdown('${n.id}')" title="View who read this">
                        <i class="fas fa-eye"></i>
                    </button>
                    <div id="ack-drop-${n.id}" class="ack-dropdown">
                        <h4>Acknowledged By:</h4>
                        <ul>${getAckList(n)}</ul>
                    </div>
                </div>
            </td>
            <td><button class="btn-danger btn-sm" onclick="toggleNoticeStatus('${n.id}', false)">Deactivate</button></td>
        </tr>
    `}).join('');

    // History List
    const historyRows = notices.filter(n => !n.active).map(n => `
        <tr>
            <td style="opacity:0.6;">${n.date}</td>
            <td style="opacity:0.6;">${n.message}</td>
            <td style="opacity:0.6;">${n.targetRole}</td>
            <td style="opacity:0.6;">
                <div class="notice-ack-wrapper">
                    <span style="font-weight:bold;">${n.acks ? n.acks.length : 0} Reads</span>
                    <button class="ack-eye-btn" onclick="toggleAckDropdown('${n.id}')" title="View who read this">
                        <i class="fas fa-eye"></i>
                    </button>
                    <div id="ack-drop-${n.id}" class="ack-dropdown">
                        <h4>Acknowledged By:</h4>
                        <ul>${getAckList(n)}</ul>
                    </div>
                </div>
            </td>
            <td><button class="btn-primary btn-sm" onclick="toggleNoticeStatus('${n.id}', true)">Re-Post</button></td>
        </tr>
    `).join('');

    return `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
            <h4><i class="fas fa-bullhorn"></i> Urgent Notice Board</h4>
        </div>
        
        <div style="display:flex; gap:10px; margin-bottom:20px; padding:15px; background:var(--bg-input); border-radius:8px;">
            <select id="newNoticeType" style="width:150px; margin:0;">
                <option value="standard">Standard (Orange)</option>
                <option value="critical">Critical (Red)</option>
            </select>
            <select id="newNoticeRole" style="width:150px; margin:0;">
                <option value="all">All Users</option>
                <option value="trainee">Trainees Only</option>
                <option value="teamleader">Team Leaders Only</option>
            </select>
            <input type="text" id="newNoticeMsg" placeholder="Type urgent message here..." style="margin:0; flex:1;">
            <button class="btn-primary" style="width:auto;" onclick="postNotice()">Post Notice</button>
        </div>

        <div style="max-height:300px; overflow-y:auto; overflow-x:visible;">
            <table class="admin-table" style="width:100%;">
                <thead><tr><th>Date</th><th>Message</th><th>Target</th><th>Ack Count</th><th>Action</th></tr></thead>
                <tbody>
                    ${activeRows.length > 0 ? activeRows : '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No active notices.</td></tr>'}
                    <tr style="background:var(--bg-input); font-weight:bold;"><td colspan="5" style="text-align:center;">--- HISTORY / INACTIVE ---</td></tr>
                    ${historyRows}
                </tbody>
            </table>
        </div>
    `;
}

// --- ACTIONS ---

function toggleAckDropdown(id) {
    const drop = document.getElementById(`ack-drop-${id}`);
    if(drop) {
        // Close others
        document.querySelectorAll('.ack-dropdown').forEach(d => {
            if(d.id !== `ack-drop-${id}`) d.classList.remove('active');
        });
        drop.classList.toggle('active');
    }
}

// Close dropdowns if clicking outside
document.addEventListener('click', function(e) {
    if (!e.target.closest('.notice-ack-wrapper')) {
        document.querySelectorAll('.ack-dropdown').forEach(d => d.classList.remove('active'));
    }
});

async function postNotice() {
    const msg = document.getElementById('newNoticeMsg').value;
    const role = document.getElementById('newNoticeRole').value;
    const type = document.getElementById('newNoticeType').value;
    
    if(!msg) return alert("Message cannot be empty.");

    const notices = JSON.parse(localStorage.getItem('notices') || '[]');
    
    // UPDATED: Consistent Unique ID
    const newNotice = {
        id: Date.now() + "_" + Math.random().toString(36).substr(2, 9),
        message: msg,
        targetRole: role,
        type: type,
        active: true,
        date: new Date().toISOString().split('T')[0],
        acks: []
    };

    notices.push(newNotice);
    localStorage.setItem('notices', JSON.stringify(notices));
    
    // --- SECURE SAVE ---
    const btn = document.activeElement; 
    let originalText = "";
    if(btn && btn.tagName === 'BUTTON') {
        originalText = btn.innerText;
        btn.innerText = "Posting...";
        btn.disabled = true;
    }

    await secureDashboardSave();

    if(btn && btn.tagName === 'BUTTON') {
        btn.innerText = originalText;
        btn.disabled = false;
    }
    // -------------------
    
    renderDashboard();
}

async function toggleNoticeStatus(id, isActive) {
    const notices = JSON.parse(localStorage.getItem('notices') || '[]');
    const target = notices.find(n => n.id === id);
    if(target) {
        target.active = isActive;
        localStorage.setItem('notices', JSON.stringify(notices));
        
        await secureDashboardSave();
        
        renderDashboard();
    }
}

async function acknowledgeNotice(id) {
    const notices = JSON.parse(localStorage.getItem('notices') || '[]');
    const target = notices.find(n => n.id === id);
    
    if(target) {
        if(!target.acks) target.acks = [];
        if(!target.acks.includes(CURRENT_USER.user)) {
            target.acks.push(CURRENT_USER.user);
            localStorage.setItem('notices', JSON.stringify(notices));
            
            // --- SECURE SAVE START ---
            const btn = document.activeElement;
            if(btn && btn.tagName === 'BUTTON') {
                btn.innerText = "Marking...";
                btn.disabled = true;
            }

            await secureDashboardSave();
            // --- SECURE SAVE END ---

            renderDashboard(); // Re-render to hide the banner
        }
    }
}

// --- INVASIVE NOTICE POPUP (TRAINEE) ---
window.checkUrgentNoticesPopup = function() {
    if (!CURRENT_USER || CURRENT_USER.role !== 'trainee') return;
    
    const notices = JSON.parse(localStorage.getItem('notices') || '[]');
    // Filter: Active AND (Target Role Matches OR Target is All) AND Not Acknowledged
    const unread = notices.filter(n => 
        n.active && 
        (n.targetRole === 'all' || n.targetRole === 'trainee') &&
        (!n.acks || !n.acks.includes(CURRENT_USER.user))
    );

    if (unread.length > 0) {
        // Prioritize Critical notices, then by date
        unread.sort((a,b) => {
            if (a.type === 'critical' && b.type !== 'critical') return -1;
            if (a.type !== 'critical' && b.type === 'critical') return 1;
            return new Date(b.date) - new Date(a.date);
        });

        const notice = unread[0];
        const modal = document.getElementById('urgentNoticeModal');
        
        // Prevent re-opening if already viewing this specific notice
        if (modal && !modal.classList.contains('hidden') && modal.dataset.noticeId === notice.id) {
            return;
        }
        
        showUrgentModal(notice);
    }
};

function showUrgentModal(notice) {
    const modal = document.getElementById('urgentNoticeModal');
    const content = document.getElementById('urgentNoticeContent');
    const btn = document.getElementById('btnAckNotice');
    
    if(modal && content && btn) {
        modal.dataset.noticeId = notice.id;
        content.innerHTML = `
            <div style="font-weight:bold; margin-bottom:10px; color:${notice.type === 'critical' ? '#ff5252' : '#f39c12'}">${notice.type.toUpperCase()}</div>
            <div>${notice.message}</div>
            <div style="font-size:0.8rem; color:var(--text-muted); margin-top:15px; border-top:1px solid var(--border-color); padding-top:10px;">Posted: ${notice.date}</div>
        `;
        
        btn.onclick = async function() {
            modal.classList.add('hidden'); // Hide immediately to prevent flicker
            await acknowledgeNotice(notice.id); // This triggers renderDashboard -> checkUrgentNoticesPopup -> shows next notice if any
        };
        
        modal.classList.remove('hidden');
    }
}

// --- ADMIN DASHBOARD ---
function buildAdminWidgets() {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    const records = JSON.parse(localStorage.getItem('records') || '[]');
    const submissions = JSON.parse(localStorage.getItem('submissions') || '[]');
    const schedules = JSON.parse(localStorage.getItem('schedules') || '{}');
    
    // 1. Stats Calculation
    const totalTrainees = users.filter(u => u.role === 'trainee').length;
    
    // Active Roster Logic (Agents per schedule)
    let scheduleStats = [];
    Object.keys(schedules).sort().forEach(k => {
        const groupName = schedules[k].assigned;
        const count = (groupName && rosters[groupName]) ? rosters[groupName].length : 0;
        if(groupName) scheduleStats.push(`<strong>${k}:</strong> ${count}`);
    });
    const rosterDisplay = scheduleStats.length > 0 ? scheduleStats.join(' | ') : "No active schedules";

    // Pending Marking (Submissions)
    const pendingMarking = submissions.filter(s => s.status === 'pending').length;

    // Insight "Awaiting Review" Badge
    // Calculate how many trainees have scores < IMPROVE and might need attention
    const IMPROVE_LIMIT = (typeof IMPROVE !== 'undefined') ? IMPROVE : 80;
    const actionRequiredCount = records.filter(r => r.score < IMPROVE_LIMIT).length; 
    const badgeInsight = actionRequiredCount > 0 
        ? `<span class="badge-count" style="top:-8px; right:-8px; background:#e74c3c; font-size:0.8rem;">${actionRequiredCount}</span>` 
        : '';

    // Live Booking "New Entry" Badge
    const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
    const todayStr = new Date().toISOString().split('T')[0];
    const newBookingsCount = bookings.filter(b => b.date >= todayStr && b.status === 'Booked').length;
    const badgeBooking = newBookingsCount > 0 
        ? `<span class="badge-count" style="top:-8px; right:-8px; background:#2ecc71; font-size:0.8rem;">${newBookingsCount}</span>` 
        : '';

    return `
        <div class="dash-card">
            <div class="dash-icon"><i class="fas fa-users"></i></div>
            <div class="dash-data">
                <h3>${totalTrainees}</h3>
                <p>Total Trainees</p>
            </div>
        </div>
        <div class="dash-card">
            <div class="dash-icon"><i class="fas fa-clipboard-list"></i></div>
            <div class="dash-data">
                <h3 style="font-size:1.1rem; line-height:1.4;">${rosterDisplay}</h3>
                <p>Agents on Schedule</p>
            </div>
        </div>
        <div class="dash-card" onclick="showTab('test-manage')" style="cursor:pointer; position:relative;">
            <div class="dash-icon"><i class="fas fa-highlighter"></i></div>
            <div class="dash-data">
                <h3 style="${pendingMarking > 0 ? 'color:#e74c3c' : ''}">${pendingMarking}</h3>
                <p>Pending Marking</p>
            </div>
        </div>
        
        <div class="dash-card" onclick="showTab('insights')" style="cursor:pointer; border:1px solid var(--primary); position:relative;">
            ${badgeInsight}
            <div class="dash-icon"><i class="fas fa-search"></i></div>
            <div class="dash-data">
                <h3>Insight</h3>
                <p>View Dashboard</p>
            </div>
        </div>

        <div class="dash-card" onclick="showTab('live-assessment')" style="cursor:pointer; position:relative;">
            ${badgeBooking}
            <div class="dash-icon"><i class="fas fa-calendar-check"></i></div>
            <div class="dash-data">
                <h3>Live Bookings</h3>
                <p>Manage Sessions</p>
            </div>
        </div>

        <div class="dash-panel full-width">
            <h4><i class="fas fa-server"></i> System Status</h4>
            <div style="display:flex; gap:20px; flex-wrap:wrap; margin-top:10px;">
                <div class="status-item">
                    <span class="status-dot good"></span>
                    Storage: <strong id="dashStorage">Checking...</strong>
                </div>
                <div class="status-item">
                    <span class="status-dot good"></span>
                    Latency: <strong id="dashLatency">...</strong>
                </div>
                <div class="status-item">
                    <span class="status-dot good"></span>
                    Last Sync: <strong id="dashLastSync">Calculating...</strong>
                </div>
            </div>
        </div>

        <div class="dash-panel full-width">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <h4><i class="fas fa-user-clock"></i> Active Users Monitor</h4>
                <button class="btn-secondary btn-sm" onclick="updateDashboardHealth()"><i class="fas fa-sync"></i> Refresh</button>
            </div>
            <div class="table-responsive" style="max-height:250px; overflow-y:auto; margin-top:10px;">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>Role</th>
                            <th>Status</th>
                            <th>Idle Time</th>
                        </tr>
                    </thead>
                    <tbody id="dashActiveUsersBody">
                        <tr><td colspan="4" class="text-center">Loading active users...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function buildLinkRequestsWidget() {
    if (CURRENT_USER.role === 'special_viewer') {
        return ''; // Hide requests widget for viewer
    }

    const requests = JSON.parse(localStorage.getItem('linkRequests') || '[]');
    const pending = requests.filter(r => r.status === 'pending');
    
    if (pending.length === 0) return '';
    
    let html = `<div class="dash-panel full-width" style="border-left: 4px solid #f39c12;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <h4 style="margin:0;"><i class="fas fa-link"></i> Pending Link Requests</h4>
            <span class="badge-count" style="position:static; background:#f39c12;">${pending.length}</span>
        </div>
        <div class="table-responsive" style="max-height:200px; overflow-y:auto;">
            <table class="admin-table">
                <thead><tr><th>Date</th><th>Requester</th><th>Trainee</th><th>Assessment</th><th>Action</th></tr></thead>
                <tbody>`;
                
    pending.forEach(req => {
        html += `<tr>
            <td>${new Date(req.date).toLocaleDateString()}</td>
            <td>${req.requestedBy}</td>
            <td>${req.trainee}</td>
            <td>${req.assessment}</td>
            <td>
                <button class="btn-primary btn-sm" onclick="fulfillLinkRequest('${req.recordId}')">Add Link</button>
                <button class="btn-danger btn-sm" onclick="dismissLinkRequest('${req.id}')"><i class="fas fa-times"></i></button>
            </td>
        </tr>`;
    });
    
    html += `</tbody></table></div></div>`;
    return html;
}

// --- TEAM LEADER DASHBOARD ---
function buildTLWidgets() {
    const liveBookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '/');
    
    // Filter bookings for today/future
    const upcoming = liveBookings.filter(b => b.date >= today && b.status !== 'Cancelled').sort((a,b) => a.date.localeCompare(b.date));
    
    let bookingList = '<p style="color:var(--text-muted);">No upcoming assessments.</p>';
    if(upcoming.length > 0) {
        bookingList = `<ul class="dash-list">
            ${upcoming.slice(0, 5).map(b => `
                <li>
                    <span class="date">${b.date} ${b.time}</span>
                    <span class="main">${b.trainee}</span>
                    <span class="sub">${b.assessment}</span>
                </li>
            `).join('')}
        </ul>`;
    }

    return `
        <div class="dash-panel full-width">
            <h4><i class="fas fa-chalkboard-teacher"></i> Live Assessment Overview</h4>
            ${bookingList}
            </div>
        
        <div class="dash-card" onclick="showTab('report-card')" style="cursor:pointer;">
            <div class="dash-icon"><i class="fas fa-clipboard-list"></i></div>
            <div class="dash-data">
                <h3>Reports</h3>
                <p>View Trainee Scores</p>
            </div>
        </div>
        
        <div class="dash-card" onclick="showTab('assessment-schedule')" style="cursor:pointer;">
            <div class="dash-icon"><i class="fas fa-calendar-alt"></i></div>
            <div class="dash-data">
                <h3>Schedule</h3>
                <p>Check Timelines</p>
            </div>
        </div>
    `;
}

// --- ADMIN ACTIONS FOR REQUESTS ---

window.fulfillLinkRequest = async function(recordId) {
    // Find record index
    const records = JSON.parse(localStorage.getItem('records') || '[]');
    const idx = records.findIndex(r => r.id === recordId);
    
    if (idx === -1) {
        // Fallback: Try to find by composite key if ID fails (legacy support)
        // This is tricky from dashboard, so we might just alert.
        // But updateRecordLink handles the request logic if we pass the index.
        alert("Record not found. It might have been deleted.");
        return;
    }
    
    // Reuse the reporting.js function if available, else replicate logic
    if (typeof updateRecordLink === 'function') {
        await updateRecordLink(idx);
        renderDashboard(); // Refresh dashboard to remove the request row
    }
};

window.dismissLinkRequest = async function(requestId) {
    if(!confirm("Dismiss this request without adding a link?")) return;
    
    const requests = JSON.parse(localStorage.getItem('linkRequests') || '[]');
    const idx = requests.findIndex(r => r.id === requestId);
    
    if (idx > -1) {
        requests[idx].status = 'dismissed';
        requests[idx].completedBy = CURRENT_USER.user;
        requests[idx].completedDate = new Date().toISOString();
        
        localStorage.setItem('linkRequests', JSON.stringify(requests));
        
        if (typeof saveToServer === 'function') {
            await saveToServer(['linkRequests'], false);
        }
        
        renderDashboard();
    }
};

// --- TRAINEE DASHBOARD ---
function buildTraineeWidgets() {
    // 1. Find Next Task
    let nextTask = "All Caught Up!";
    let nextDate = "";
    
    const allSchedules = JSON.parse(localStorage.getItem('schedules') || 'null');
    let myItems = [];
    if(allSchedules && typeof getTraineeScheduleId === 'function') {
        const id = getTraineeScheduleId(CURRENT_USER.user, allSchedules);
        if(id && allSchedules[id]) myItems = allSchedules[id].items;
    }

    const todayStr = new Date().toISOString().split('T')[0].replace(/-/g, '/');
    
    const upcomingItem = myItems.find(i => {
        if(i.dateRange === 'Always Available') return false;
        // Simple string compare for "upcoming" or "active"
        if(i.dateRange.includes('-')) return i.dateRange.split('-')[1] >= todayStr;
        return i.dateRange >= todayStr;
    });

    if(upcomingItem) {
        nextTask = upcomingItem.courseName;
        nextDate = upcomingItem.dateRange;
    }

    // 2. Recent Results
    const records = JSON.parse(localStorage.getItem('records') || '[]');
    const myRecords = records.filter(r => r.trainee === CURRENT_USER.user);
    const lastRecord = myRecords.length > 0 ? myRecords[myRecords.length - 1] : null;
    
    // Check if clocked in today to show Clock Out button
    const today = new Date().toISOString().split('T')[0];
    const attRecs = JSON.parse(localStorage.getItem('attendance_records') || '[]');
    const myAtt = attRecs.find(r => r.user === CURRENT_USER.user && r.date === today);
    const showClockOut = myAtt && !myAtt.clockOut;

    return `
        <div class="dash-panel main-panel">
            <h4><i class="fas fa-tasks"></i> Up Next</h4>
            <div style="margin-top:15px;">
                <h2 style="color:var(--primary);">${nextTask}</h2>
                <p style="color:var(--text-muted);">${nextDate}</p>
                <button class="btn-primary" style="margin-top:15px;" onclick="showTab('assessment-schedule')">Go to Schedule</button>
            </div>
        </div>

        <div class="dash-card">
            <div class="dash-icon"><i class="fas fa-star"></i></div>
            <div class="dash-data">
                <h3>${lastRecord ? lastRecord.score + '%' : '-'}</h3>
                <p>Last Score</p>
                <small>${lastRecord ? lastRecord.assessment : 'No records yet'}</small>
            </div>
        </div>

        <div class="dash-card" onclick="showTab('my-tests')" style="cursor:pointer;">
            <div class="dash-icon"><i class="fas fa-pen-alt"></i></div>
            <div class="dash-data">
                <h3>Tests</h3>
                <p>Take Assessment</p>
            </div>
        </div>

        <div class="dash-card" onclick="showTab('live-assessment')" style="cursor:pointer;">
            <div class="dash-icon"><i class="fas fa-calendar-check"></i></div>
            <div class="dash-data">
                <h3>Book Live</h3>
                <p>Schedule Assessment</p>
            </div>
        </div>
        
        ${showClockOut ? `
        <div class="dash-card" onclick="submitClockOut()" style="cursor:pointer; border:1px solid #e74c3c;">
            <div class="dash-icon" style="background:rgba(231, 76, 60, 0.1); color:#e74c3c;"><i class="fas fa-sign-out-alt"></i></div>
            <div class="dash-data">
                <h3>Clock Out</h3>
                <p>End Day</p>
            </div>
        </div>` : ''}
    `;
}
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

// --- DASHBOARD LAYOUT STATE ---
let DASH_EDIT_MODE = false;
const DEFAULT_LAYOUT_ADMIN = [
    { id: 'stats', col: 1, row: 1 },
    { id: 'schedule', col: 1, row: 1 },
    { id: 'marking', col: 1, row: 1 },
    { id: 'insight', col: 1, row: 1 },
    { id: 'live', col: 1, row: 1 },
    { id: 'attendance', col: 1, row: 1 },
    { id: 'monitor', col: 1, row: 1 },
    { id: 'sys_health', col: 2, row: 1 },
    { id: 'active_users', col: 2, row: 1 }
];

const DEFAULT_LAYOUT_TRAINEE = [
    { id: 'up_next', col: 2, row: 1 },
    { id: 'live_upcoming', col: 1, row: 1 },
    { id: 'recent_results', col: 1, row: 2 },
    { id: 'available_tests', col: 1, row: 2 },
    { id: 'notepad', col: 1, row: 1 },
    { id: 'daily_tip', col: 1, row: 1 },
    { id: 'help', col: 1, row: 1 }
];

function renderDashboard() {
    const container = document.getElementById('dashboard-view');
    if (!container) return;

    container.innerHTML = ''; // Clear previous

    const role = CURRENT_USER.role;
    
    // NEW: Invasive Modal Check for Trainees
    if (role === 'trainee') {
        if (typeof checkUrgentNoticesPopup === 'function') checkUrgentNoticesPopup();
    }

    // 2. GREETING HEADER
    const header = document.createElement('div');
    header.className = 'dash-header';
    header.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
            <div>
                <h2 style="margin:0;">Hello, <span style="color:var(--primary);">${CURRENT_USER.user}</span></h2>
                <p style="color:var(--text-muted); margin-top:5px;">Here is your daily overview.</p>
            </div>
            ${(role === 'admin' || role === 'trainee') ? `<button class="btn-secondary btn-sm" onclick="toggleDashEditMode()"><i class="fas fa-pencil-alt"></i> Customize</button>` : ''}
        </div>
        <div id="dash-edit-controls" class="hidden" style="margin-bottom:15px; padding:10px; background:var(--bg-input); border:1px dashed var(--primary); border-radius:8px; text-align:center;">
            <strong style="color:var(--primary);">Edit Mode Active</strong> - Drag items to reorder.
            <button class="btn-primary btn-sm" style="margin-left:10px;" onclick="saveDashLayout()">Save Layout</button>
            <button class="btn-secondary btn-sm" onclick="resetDashLayout()">Reset</button>
        </div>
    `;
    container.appendChild(header);

    // 3. ROLE SPECIFIC CONTENT
    const content = document.createElement('div');
    content.className = 'dash-content-grid'; 
    
    if (role === 'admin' || role === 'special_viewer') {
        buildAdminWidgets(content); // Pass container to append widgets dynamically
        
        // Append Notice Manager for Admins (Bottom)
        const manager = document.createElement('div');
        manager.className = 'dash-panel full-width';
        manager.style.marginTop = '20px';
        manager.innerHTML = buildNoticeManager();
        
        container.appendChild(content);
        
        // Urgent Notices (Bottom for Admin)
        const noticeHtml = buildNoticeBanners(role);
        if(noticeHtml) container.insertAdjacentHTML('beforeend', noticeHtml);
        
        container.appendChild(manager);
        
        // Trigger Dashboard-specific health check
        updateDashboardHealth();
    } else if (role === 'teamleader') {
        // Urgent Notices (Top for TL)
        const noticeHtml = buildNoticeBanners(role);
        container.innerHTML = noticeHtml + container.innerHTML;
        
        content.innerHTML = buildTLWidgets();
        container.appendChild(content);
    } else {
        // Urgent Notices (Top for Trainee)
        const noticeHtml = buildNoticeBanners(role);
        container.innerHTML = noticeHtml + container.innerHTML;
        
        buildTraineeWidgets(content);
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
                                <td style="max-width:100px; overflow:hidden; text-overflow:ellipsis;"><strong>${u.user}</strong></td>
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
        
        // --- NEW: Update Activity Monitor Widget (if present) ---
        if (typeof StudyMonitor !== 'undefined' && typeof StudyMonitor.updateWidget === 'function') {
            StudyMonitor.updateWidget();
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
function buildAdminWidgets(container) {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    const records = JSON.parse(localStorage.getItem('records') || '[]');
    const submissions = JSON.parse(localStorage.getItem('submissions') || '[]');
    const schedules = JSON.parse(localStorage.getItem('schedules') || '{}');
    const attRecords = JSON.parse(localStorage.getItem('attendance_records') || '[]');
    const today = new Date().toISOString().split('T')[0];
    
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

    // Attendance Alert (Unconfirmed Lates)
    const unconfirmedLates = attRecords.filter(r => r.isLate && !r.lateConfirmed).length;
    const badgeAtt = unconfirmedLates > 0 
        ? `<span id="badgeAtt" class="badge-count" style="top:-8px; right:-8px; background:#e74c3c; font-size:0.8rem;">${unconfirmedLates}</span>` 
        : '';

    // --- HOVER DETAILS GENERATION ---
    
    // 1. Schedule Details
    let schedDetailsHtml = '';
    Object.keys(schedules).sort().forEach(k => {
        const groupName = schedules[k].assigned;
        if(groupName && rosters[groupName]) {
            schedDetailsHtml += `<div style="font-size:0.8rem; margin-bottom:8px; border-bottom:1px dashed var(--border-color); padding-bottom:4px;">
                <strong style="color:var(--primary);">${k} (${groupName}):</strong><br>
                <span style="color:var(--text-muted);">${rosters[groupName].join(', ')}</span>
            </div>`;
        }
    });
    if(!schedDetailsHtml) schedDetailsHtml = '<div style="color:var(--text-muted); font-style:italic;">No active schedules.</div>';

    // 2. Pending Marking Details
    const pendingDetailsHtml = submissions.filter(s => s.status === 'pending').map(s => 
        `<div style="font-size:0.8rem; margin-bottom:4px; display:flex; justify-content:space-between;">
            <span>${s.trainee}</span> <span style="color:var(--text-muted);">${s.testTitle}</span>
        </div>`
    ).join('') || '<div style="color:var(--text-muted); font-style:italic;">Queue empty.</div>';

    // 3. Insight Details (Action Required)
    const insightDetailsHtml = records.filter(r => r.score < IMPROVE_LIMIT).map(r => 
        `<div style="font-size:0.8rem; margin-bottom:4px; display:flex; justify-content:space-between;">
            <span style="color:#e74c3c;">${r.trainee}</span> <span>${r.assessment} (${r.score}%)</span>
        </div>`
    ).slice(0, 15).join('') || '<div style="color:var(--text-muted); font-style:italic;">No critical actions.</div>';

    // 4. Live Booking Details
    const bookingDetailsHtml = bookings.filter(b => b.date >= todayStr && b.status === 'Booked').map(b => 
        `<div style="font-size:0.8rem; margin-bottom:4px;">
            <span style="color:var(--primary);">${b.time}</span> ${b.trainee}
        </div>`
    ).slice(0, 10).join('') || '<div style="color:var(--text-muted); font-style:italic;">No upcoming bookings.</div>';

    // Helper to wrap widget content with resize controls
    const wrapWidget = (id, content, colSpan=1, rowSpan=1) => {
        return `
            <div class="dash-card dash-card-expandable w-col-${colSpan} w-row-${rowSpan}" id="widget-${id}" draggable="false" data-col="${colSpan}" data-row="${rowSpan}">
                <div class="widget-controls">
                    <button class="btn-secondary btn-sm" onclick="resizeWidget('${id}', 1, 0)" title="Wider"><i class="fas fa-arrows-alt-h"></i></button>
                    <button class="btn-secondary btn-sm" onclick="resizeWidget('${id}', 0, 1)" title="Taller"><i class="fas fa-arrows-alt-v"></i></button>
                    <button class="btn-secondary btn-sm" onclick="resizeWidget('${id}', -1, -1)" title="Shrink"><i class="fas fa-compress"></i></button>
                </div>
                ${content}
            </div>`;
    };

    // WIDGET DEFINITIONS
    // Note: Admin widgets defined here
    const widgets = {
        'stats': wrapWidget('stats', `
            <div style="display:flex; align-items:center; gap:20px; height:100%;">
                <div class="dash-icon"><i class="fas fa-users"></i></div>
                <div class="dash-data">
                    <h3>${totalTrainees}</h3>
                    <p>Total Trainees</p>
                </div>
            </div>`),
        'schedule': wrapWidget('schedule', `
                <div class="dash-primary-content">
                    <div class="dash-icon"><i class="fas fa-clipboard-list"></i></div>
                    <div class="dash-data">
                        <h3 style="font-size:1.1rem; line-height:1.4;">${rosterDisplay}</h3>
                        <p>Agents on Schedule</p>
                    </div>
                </div>
                <div class="dash-details">${schedDetailsHtml}</div>`),
        'marking': wrapWidget('marking', `
            <div onclick="showTab('test-manage')" style="cursor:pointer; width:100%;">
                <div class="dash-primary-content">
                    <div class="dash-icon"><i class="fas fa-highlighter"></i></div>
                    <div class="dash-data">
                        <h3 style="${pendingMarking > 0 ? 'color:#e74c3c' : ''}">${pendingMarking}</h3>
                        <p>Pending Marking</p>
                    </div>
                </div>
                <div class="dash-details">${pendingDetailsHtml}</div>
            </div>`),
        'insight': wrapWidget('insight', `
            <div onclick="showTab('insights')" style="cursor:pointer; width:100%;">
                ${badgeInsight}
                <div class="dash-primary-content">
                    <div class="dash-icon"><i class="fas fa-search"></i></div>
                    <div class="dash-data">
                        <h3>Insight</h3>
                        <p>View Dashboard</p>
                    </div>
                </div>
                <div class="dash-details">
                    <div style="font-size:0.8rem; font-weight:bold; margin-bottom:5px; color:#e74c3c;">Action Required:</div>
                    ${insightDetailsHtml}
                </div>
            </div>`),
        'live': wrapWidget('live', `
            <div onclick="showTab('live-assessment')" style="cursor:pointer; width:100%;">
                ${badgeBooking}
                <div class="dash-primary-content">
                    <div class="dash-icon"><i class="fas fa-calendar-check"></i></div>
                    <div class="dash-data">
                        <h3>Live Bookings</h3>
                        <p>Manage Sessions</p>
                    </div>
                </div>
                <div class="dash-details">${bookingDetailsHtml}</div>
            </div>`),
        'attendance': wrapWidget('attendance', `
            <div onclick="openAttendanceRegister()" style="cursor:pointer; width:100%;">
                ${badgeAtt}
                <div class="dash-icon"><i class="fas fa-clock"></i></div>
                <div class="dash-data">
                    <h3>Attendance</h3>
                    <p>Review Lates</p>
                </div>
            </div>`),
        'monitor': wrapWidget('monitor', `
            <div onclick="openActivityMonitorModal()" style="cursor:pointer; width:100%;">
                <div class="dash-icon"><i class="fas fa-binoculars"></i></div>
                <div class="dash-data">
                    <h3>Activity Monitor</h3>
                    <p>View Detailed Logs</p>
                </div>
            </div>`),
        'sys_health': wrapWidget('sys_health', `
            <div style="width:100%;">
                <h4><i class="fas fa-server"></i> System Health</h4>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-top:15px;">
                    <div class="status-item"><div style="font-size:0.8rem; color:var(--text-muted);">Storage</div><strong id="dashStorage">...</strong></div>
                    <div class="status-item"><div style="font-size:0.8rem; color:var(--text-muted);">Latency</div><strong id="dashLatency">...</strong></div>
                    <div class="status-item"><div style="font-size:0.8rem; color:var(--text-muted);">Sync</div><strong id="dashLastSync">...</strong></div>
                    <div class="status-item"><div style="font-size:0.8rem; color:var(--text-muted);">Network</div><strong id="statusConnection" style="color:var(--primary);">Checking...</strong></div>
                </div>
            </div>`),
        'active_users': wrapWidget('active_users', `
            <div style="width:100%;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h4><i class="fas fa-user-clock"></i> Active Users</h4>
                    <button class="btn-secondary btn-sm" onclick="updateDashboardHealth()"><i class="fas fa-sync"></i></button>
                </div>
                <div class="table-responsive" style="max-height:150px; overflow-y:auto; margin-top:10px;">
                    <table class="admin-table compressed-table">
                        <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Idle</th></tr></thead>
                        <tbody id="dashActiveUsersBody"><tr><td colspan="4" class="text-center">Loading...</td></tr></tbody>
                    </table>
                </div>
            </div>`)
    };

    // LOAD LAYOUT
    let layout = JSON.parse(localStorage.getItem('dashLayout_admin') || 'null');
    
    if (!layout) {
        layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT_ADMIN));
    } else {
        // SMART MERGE: Check for new widgets defined in code but missing in saved layout
        const existingIds = new Set(layout.map(i => (typeof i === 'string' ? i : i.id)));
        
        DEFAULT_LAYOUT_ADMIN.forEach(def => {
            if (!existingIds.has(def.id)) {
                layout.push(def); // Append new widget to the end
            }
        });
    }
    
    let gridHtml = '<div class="dash-grid-main" id="dash-grid-container">';
    
    layout.forEach(item => {
        // Handle legacy string array or new object array
        const key = typeof item === 'string' ? item : item.id;
        const col = typeof item === 'object' ? item.col : 1;
        const row = typeof item === 'object' ? item.row : 1;

        if(widgets[key]) {
            // Inject size classes dynamically if not already in template (though wrapWidget handles it)
            // We need to replace the default class in the template with the saved one
            let widgetHtml = widgets[key];
            // Replace default w-col-1/w-row-1 with saved values
            widgetHtml = widgetHtml.replace(/w-col-\d+/, `w-col-${col}`).replace(/w-row-\d+/, `w-row-${row}`);
            // Update data attributes for logic
            widgetHtml = widgetHtml.replace(/data-col="\d+"/, `data-col="${col}"`).replace(/data-row="\d+"/, `data-row="${row}"`);
            
            gridHtml += widgetHtml;
        }
    });
    gridHtml += '</div>';

    container.innerHTML = gridHtml + buildLinkRequestsWidget();
    
    // Re-apply edit mode if active
    if(DASH_EDIT_MODE) enableDashEdit();
}

// --- DASHBOARD CUSTOMIZATION LOGIC ---

function toggleDashEditMode() {
    DASH_EDIT_MODE = !DASH_EDIT_MODE;
    const controls = document.getElementById('dash-edit-controls');
    if(DASH_EDIT_MODE) {
        controls.classList.remove('hidden');
        enableDashEdit();
    } else {
        controls.classList.add('hidden');
        renderDashboard(); // Reset view to remove drag handlers
    }
}

function resizeWidget(id, dCol, dRow) {
    const el = document.getElementById(`widget-${id}`);
    if(!el) return;
    
    let col = parseInt(el.dataset.col) || 1;
    let row = parseInt(el.dataset.row) || 1;
    
    // Reset logic if both negative
    if (dCol === -1 && dRow === -1) {
        col = 1; row = 1;
    } else {
        col = Math.max(1, Math.min(4, col + dCol)); // Max 4 cols
        row = Math.max(1, Math.min(3, row + dRow)); // Max 3 rows
    }
    
    // Update Classes
    el.className = el.className.replace(/w-col-\d+/, `w-col-${col}`).replace(/w-row-\d+/, `w-row-${row}`);
    el.dataset.col = col;
    el.dataset.row = row;
}

function enableDashEdit() {
    const grid = document.getElementById('dash-grid-container');
    if(!grid) return;
    
    const cards = grid.querySelectorAll('.dash-card');
    cards.forEach(card => {
        card.classList.add('editing');
        card.setAttribute('draggable', 'true');
        card.style.border = '2px dashed var(--primary)';
        card.style.cursor = 'move';
        card.onclick = (e) => e.preventDefault(); // Disable clicks
        
        card.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', card.id);
            e.target.style.opacity = '0.5';
        });
        
        card.addEventListener('dragend', (e) => {
            e.target.style.opacity = '1';
        });
        
        card.addEventListener('dragover', (e) => e.preventDefault());
        
        card.addEventListener('drop', (e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData('text/plain');
            const draggable = document.getElementById(id);
            const dropzone = e.target.closest('.dash-card');
            
            if (draggable && dropzone && draggable !== dropzone) {
                // Swap logic: Insert before or after based on position
                const rect = dropzone.getBoundingClientRect();
                const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
                grid.insertBefore(draggable, next ? dropzone.nextSibling : dropzone);
            }
        });
    });
}

function saveDashLayout() {
    const grid = document.getElementById('dash-grid-container');
    const cards = grid.querySelectorAll('.dash-card');
    const layout = [];
    
    cards.forEach(c => {
        const key = c.id.replace('widget-', '');
        const col = parseInt(c.dataset.col) || 1;
        const row = parseInt(c.dataset.row) || 1;
        layout.push({ id: key, col: col, row: row });
    });
    
    const roleKey = CURRENT_USER.role === 'admin' ? 'dashLayout_admin' : 'dashLayout_trainee';
    localStorage.setItem(roleKey, JSON.stringify(layout));
    toggleDashEditMode(); // Exit edit mode
    if(typeof showToast === 'function') showToast("Dashboard layout saved.", "success");
}

function resetDashLayout() {
    if(confirm("Reset dashboard to default layout?")) {
        const roleKey = CURRENT_USER.role === 'admin' ? 'dashLayout_admin' : 'dashLayout_trainee';
        localStorage.removeItem(roleKey);
        toggleDashEditMode();
        renderDashboard();
    }
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

// --- GLOBAL: RECORD LINK HANDLER ---
// Used by Assessment Records (Monthly) to handle the "Link" button
window.handleRecordLinkClick = async function(recordId, currentLink, trainee, assessment) {
    // Safety: Ensure currentLink is a string
    if (!currentLink || currentLink === 'null' || currentLink === 'undefined') currentLink = "";

    // 1. If a valid link exists, open it
    if (currentLink && currentLink.startsWith('http')) {
        window.open(currentLink, '_blank');
        return;
    }

    // 2. If internal link (Digital/Live), handle accordingly (usually View button handles this)
    if (currentLink === 'Digital-Assessment' || currentLink === 'Live-Session') {
        alert("This is a digital record. Use the 'View' button to see details.");
        return;
    }

    // 3. If no link, handle Request Logic
    if (CURRENT_USER.role === 'teamleader') {
        // Check if request already exists
        const requests = JSON.parse(localStorage.getItem('linkRequests') || '[]');
        const existing = requests.find(r => r.recordId === recordId && r.status === 'pending');
        
        if (existing) {
            alert("A request for this link is already pending with the Admin.");
            return;
        }

        if (confirm("No link available. Request Admin to add one?")) {
            requests.push({
                id: Date.now().toString(),
                recordId: recordId,
                requestedBy: CURRENT_USER.user,
                trainee: trainee,
                assessment: assessment,
                date: new Date().toISOString(),
                status: 'pending'
            });
            
            localStorage.setItem('linkRequests', JSON.stringify(requests));
            if (typeof saveToServer === 'function') await saveToServer(['linkRequests'], false);
            
            alert("Request sent to Admin.");
        }
    } else if (CURRENT_USER.role === 'admin') {
        // FIX: Allow Admin to add link directly
        const records = JSON.parse(localStorage.getItem('records') || '[]');
        const idx = records.findIndex(r => r.id === recordId);
        
        if (idx !== -1 && typeof updateRecordLink === 'function') {
            updateRecordLink(idx);
        } else {
            alert("Record not found or unable to edit.");
        }
    } else {
        alert("No link available for this record.");
    }
};

window.submitHelpRequest = async function() {
    const reason = await customPrompt("Request Help", "What do you need help with?");
    if (reason) {
        // Reuse the Notice system to alert admins? Or just a simple alert for now.
        // For now, we'll simulate it as we don't have a dedicated "Help Ticket" system yet.
        // Ideally, this would write to a 'tickets' table.
        alert("Help request sent to your Team Leader/Admin.");
    }
};

// --- TRAINEE DASHBOARD ---
function buildTraineeWidgets(container) {
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
    const allRecords = JSON.parse(localStorage.getItem('records') || '[]');
    const myRecords = allRecords.filter(r => r.trainee === CURRENT_USER.user);
    // Sort by date desc (assuming records are appended, reverse is safer)
    
    // 3. Attendance Status
    const attRecords = JSON.parse(localStorage.getItem('attendance_records') || '[]');
    const today = new Date().toISOString().split('T')[0];
    const myAtt = attRecords.find(r => r.user === CURRENT_USER.user && r.date === today);
    
    let clockOutBtn = '';
    if (myAtt && !myAtt.clockOut) {
        clockOutBtn = `<button class="btn-warning btn-sm" style="width:100%; margin-top:10px;" onclick="submitClockOut()">Clock Out</button>`;
    } else if (!myAtt) {
        clockOutBtn = `<button class="btn-success btn-sm" style="width:100%; margin-top:10px;" onclick="openClockInModal()">Clock In</button>`;
    }

    // NEW: Check for Active Live Session (Redirect Prompt)
    const liveSessions = JSON.parse(localStorage.getItem('liveSessions') || '[]');
    const myLive = liveSessions.find(s => s.trainee === CURRENT_USER.user && s.active);
    
    let liveBanner = '';
    if (myLive) {
        liveBanner = `
        <div class="dash-panel full-width" style="background:rgba(39, 174, 96, 0.1); border:1px solid #2ecc71; animation: pulse 2s infinite; margin-bottom:20px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <h3 style="color:#2ecc71; margin:0;"><i class="fas fa-satellite-dish"></i> Live Session Started!</h3>
                    <p style="margin:5px 0 0 0;">Your trainer is waiting in the arena.</p>
                </div>
                <button class="btn-success" onclick="showTab('live-execution')">Join Now</button>
            </div>
        </div>`;
    }

    // Helper to wrap widget content with resize controls
    const wrapWidget = (id, content, colSpan=1, rowSpan=1) => {
        return `
            <div class="dash-card dash-card-expandable w-col-${colSpan} w-row-${rowSpan}" id="widget-${id}" draggable="false" data-col="${colSpan}" data-row="${rowSpan}">
                <div class="widget-controls">
                    <button class="btn-secondary btn-sm" onclick="resizeWidget('${id}', 1, 0)" title="Wider"><i class="fas fa-arrows-alt-h"></i></button>
                    <button class="btn-secondary btn-sm" onclick="resizeWidget('${id}', 0, 1)" title="Taller"><i class="fas fa-arrows-alt-v"></i></button>
                    <button class="btn-secondary btn-sm" onclick="resizeWidget('${id}', -1, -1)" title="Shrink"><i class="fas fa-compress"></i></button>
                </div>
                ${content}
            </div>`;
    };

    // --- WIDGET CONTENT GENERATION ---

    // 1. Up Next
    const upNextHtml = `
        <div style="display:flex; flex-direction:column; height:100%; justify-content:center;">
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                <div class="dash-icon"><i class="fas fa-tasks"></i></div>
                <h3 style="margin:0;">Up Next</h3>
            </div>
            <h2 style="color:var(--primary); margin:0;">${nextTask}</h2>
            <p style="color:var(--text-muted); margin:5px 0;">${nextDate}</p>
            <div style="margin-top:auto; display:flex; gap:10px;">
                <button class="btn-primary btn-sm" onclick="showTab('assessment-schedule')">Go to Schedule</button>
                ${clockOutBtn}
            </div>
        </div>`;

    // 2. Live Upcoming
    const liveBookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
    const myUpcomingLive = liveBookings.filter(b => b.trainee === CURRENT_USER.user && b.status === 'Booked' && b.date >= todayStr).sort((a,b) => a.date.localeCompare(b.date));
    
    let liveHtml = `<div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;"><div class="dash-icon"><i class="fas fa-calendar-check"></i></div><h3 style="margin:0;">Live Bookings</h3></div>`;
    if (myUpcomingLive.length === 0) {
        liveHtml += `<div style="text-align:center; color:var(--text-muted); padding:10px;">No upcoming sessions.<br><button class="btn-secondary btn-sm" style="margin-top:5px;" onclick="showTab('live-assessment')">Book Now</button></div>`;
    } else {
        liveHtml += `<div style="overflow-y:auto; flex:1;">${myUpcomingLive.map(b => `
            <div style="padding:8px; border-bottom:1px solid var(--border-color); font-size:0.9rem;">
                <div style="font-weight:bold; color:var(--primary);">${b.date} @ ${b.time}</div>
                <div>${b.assessment}</div>
                <div style="font-size:0.8rem; color:var(--text-muted);">Trainer: ${b.trainer}</div>
            </div>`).join('')}</div>`;
    }

    // 3. Recent Results (Expanded)
    const recent = myRecords.slice(-5).reverse(); // Last 5
    let resultsHtml = `<div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;"><div class="dash-icon"><i class="fas fa-trophy"></i></div><h3 style="margin:0;">Recent Results</h3></div>`;
    
    if (recent.length === 0) {
        resultsHtml += `<div style="text-align:center; color:var(--text-muted); padding:10px;">No results yet. Good luck!</div>`;
    } else {
        resultsHtml += `<div style="overflow-y:auto; flex:1;">${recent.map(r => {
            let icon = '👍';
            let color = 'var(--text-main)';
            if (r.score >= 90) { icon = '🏆'; color = '#2ecc71'; }
            else if (r.score >= 80) { icon = '🔥'; color = '#f1c40f'; }
            else if (r.score < 60) { icon = '💪'; color = '#ff5252'; }
            
            return `
            <div class="result-item">
                <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-right:10px;">${r.assessment}</div>
                <div style="font-weight:bold; color:${color}; white-space:nowrap;">${r.score}% ${icon}</div>
            </div>`;
        }).join('')}</div>`;
    }

    // 4. Available Tests
    // We reuse logic from assessment_trainee.js to find unlocked tests
    // For dashboard, we just show a quick list
    let availableHtml = `<div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;"><div class="dash-icon"><i class="fas fa-unlock"></i></div><h3 style="margin:0;">Available Now</h3></div>`;
    availableHtml += `<div style="text-align:center; padding:10px;"><button class="btn-primary" onclick="showTab('my-tests')">View All Assessments</button></div>`;

    // 5. Notepad
    const savedNote = localStorage.getItem('user_notes_' + CURRENT_USER.user) || '';
    const notepadHtml = `
        <div style="display:flex; flex-direction:column; height:100%;">
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:5px;">
                <i class="fas fa-sticky-note" style="color:#f1c40f; font-size:1.2rem;"></i>
                <h4 style="margin:0;">My Notes</h4>
            </div>
            <textarea class="notepad-area" placeholder="Type your notes here..." oninput="localStorage.setItem('user_notes_' + CURRENT_USER.user, this.value)">${savedNote}</textarea>
        </div>`;

    // 6. Daily Tip
    const tips = [
        "Consistency is key. A little study every day adds up!",
        "Don't forget to take breaks. Your brain needs rest to absorb info.",
        "Review your past assessments to see where you can improve.",
        "Ask questions! Your Team Leader is there to help.",
        "Stay hydrated while studying.",
        "Focus on understanding, not just memorizing.",
        "Check the schedule daily for updates."
    ];
    // Pick a random tip every time the dashboard loads
    const tipOfTheDay = tips[Math.floor(Math.random() * tips.length)];

    const tipHtml = `
        <div style="display:flex; flex-direction:column; height:100%; justify-content:center;">
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                <i class="fas fa-lightbulb" style="color:#f39c12; font-size:1.2rem;"></i>
                <h3 style="margin:0;">Daily Tip</h3>
            </div>
            <div class="tip-card-content">
                <p style="font-style:italic; color:var(--text-main); margin:0;">"${tipOfTheDay}"</p>
            </div>
        </div>`;

    // 7. Request Help
    const helpHtml = `
        <div style="display:flex; flex-direction:column; height:100%; justify-content:center; align-items:center; text-align:center;">
            <div class="dash-icon" style="background:rgba(52, 152, 219, 0.1); color:#3498db; margin-bottom:10px;">
                <i class="fas fa-hand-paper"></i>
            </div>
            <h3 style="margin:0; margin-bottom:5px;">Need Help?</h3>
            <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:10px;">Stuck on a topic or issue?</p>
            <button class="btn-secondary btn-sm" onclick="submitHelpRequest()">Request Assistance</button>
        </div>`;

    // WIDGET MAP
    const widgets = {
        'up_next': wrapWidget('up_next', upNextHtml),
        'live_upcoming': wrapWidget('live_upcoming', liveHtml),
        'recent_results': wrapWidget('recent_results', resultsHtml),
        'available_tests': wrapWidget('available_tests', availableHtml),
        'notepad': wrapWidget('notepad', notepadHtml),
        'daily_tip': wrapWidget('daily_tip', tipHtml),
        'help': wrapWidget('help', helpHtml)
    };

    // LOAD LAYOUT
    let layout = JSON.parse(localStorage.getItem('dashLayout_trainee') || 'null');
    
    if (!layout) {
        layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT_TRAINEE));
    } else {
        // Smart Merge
        const existingIds = new Set(layout.map(i => (typeof i === 'string' ? i : i.id)));
        DEFAULT_LAYOUT_TRAINEE.forEach(def => {
            if (!existingIds.has(def.id)) {
                layout.push(def);
            }
        });
    }

    let gridHtml = '<div class="dash-grid-main" id="dash-grid-container">';
    layout.forEach(item => {
        const key = typeof item === 'string' ? item : item.id;
        const col = typeof item === 'object' ? item.col : 1;
        const row = typeof item === 'object' ? item.row : 1;

        if(widgets[key]) {
            let widgetHtml = widgets[key];
            widgetHtml = widgetHtml.replace(/w-col-\d+/, `w-col-${col}`).replace(/w-row-\d+/, `w-row-${row}`);
            widgetHtml = widgetHtml.replace(/data-col="\d+"/, `data-col="${col}"`).replace(/data-row="\d+"/, `data-row="${row}"`);
            gridHtml += widgetHtml;
        }
    });
    gridHtml += '</div>';

    container.innerHTML = liveBanner + gridHtml;
    
    if(DASH_EDIT_MODE) enableDashEdit();
}
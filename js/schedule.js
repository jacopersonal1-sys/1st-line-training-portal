/* ================= SCHEDULE & BOOKING ENGINE ================= */

// State Tracker for Timeline
let ACTIVE_SCHED_ID = 'A'; 
let ACTIVE_LIVE_SCHED_ID = 'A'; // NEW: Track Live Schedule Tab
let VIEW_MODE = 'list'; // 'list' or 'calendar'
let LIVE_SCHEDULE_REALTIME_UNSUB = null; // Realtime subscription handler
let DRAG_SRC_INDEX = null; // Track item being dragged
let CALENDAR_MONTH = new Date();
window.IS_DRAGGING_LIVE = false; // Global lock for drag operations

// --- SA PUBLIC HOLIDAYS (2026 Reference) ---
// Used to skip these dates in the Live Assessment Schedule
const SA_HOLIDAYS = [
    "2026-01-01", // New Year
    "2026-03-21", // Human Rights
    "2026-04-03", // Good Friday
    "2026-04-06", // Family Day
    "2026-04-27", // Freedom Day
    "2026-05-01", // Workers Day
    "2026-06-16", // Youth Day
    "2026-08-09", // Women's Day
    "2026-08-10", // Public Holiday (Observed)
    "2026-09-24", // Heritage Day
    "2026-12-16", // Day of Reconciliation
    "2026-12-25", // Christmas
    "2026-12-26"  // Day of Goodwill
];

// --- GLOBAL NAV HELPER ---
window.openFullCalendar = function() {
    showTab('assessment-schedule');
    switchViewMode('calendar');
};

// --- HELPER: ASYNC SAVE & SYNC ---
async function secureScheduleSave() {
    // MODIFIED: Removed 'autoBackup' check. 
    // Schedule changes (Bookings/Assignments) are critical and must sync to Supabase immediately.
    // We use force=true to ensure the save is authoritative and instant.
    if (typeof saveToServer === 'function') {
        const btn = document.activeElement;
        let originalText = "";
        if(btn && btn.tagName === 'BUTTON') {
            originalText = btn.innerText;
            btn.innerText = "Saving...";
            btn.disabled = true;
        }

        try {
            // CRITICAL FIX: Changed to force=true to make saving INSTANT and authoritative.
            // This completely eliminates the "3 attempts to drag and drop" bug.
            await saveToServer(['schedules', 'liveBookings', 'cancellationCounts', 'liveSchedules'], true); 
        } catch(e) {
            console.error("Schedule Cloud Sync Error:", e);
        } finally {
            if(btn && btn.tagName === 'BUTTON') {
                btn.innerText = originalText;
                btn.disabled = false;
            }
        }
    }
}

// --- PART A: ASSESSMENT TIMELINE (STANDARD) ---

function renderSchedule() {
    // --- SAFETY CHECK: Stop if user not logged in (Fixes Console Error) ---
    if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return;

    const container = document.getElementById('assessment-schedule');
    if (!container) return;

    // --- FORCE SYNC FOR TRAINEES ---
    // Ensure they see the latest links immediately when opening the tab
    if (CURRENT_USER.role === 'trainee' && typeof loadFromServer === 'function' && !window._schedSyncDone) {
        window._schedSyncDone = true; // Run once per session/tab-load to prevent loops
        loadFromServer(true).then(() => { renderSchedule(); }); // Re-render with new data
    }

    let schedules = JSON.parse(localStorage.getItem('schedules') || 'null');

    // Initialization Logic
    if (!schedules || Object.keys(schedules).length === 0) {
        const oldA = JSON.parse(localStorage.getItem('trainingSchedule_A') || '[]');
        const oldB = JSON.parse(localStorage.getItem('trainingSchedule_B') || '[]');
        const oldMaps = JSON.parse(localStorage.getItem('scheduleMappings') || '{}');
        const assignA = Object.keys(oldMaps).find(k => oldMaps[k] === 'A') || null;
        const assignB = Object.keys(oldMaps).find(k => oldMaps[k] === 'B') || null;

        if (oldA.length > 0 || oldB.length > 0) {
            schedules = { "A": { items: oldA, assigned: assignA }, "B": { items: oldB, assigned: assignB } };
        } else {
            schedules = { "A": { items: [], assigned: null }, "B": { items: [], assigned: null } };
        }
        localStorage.setItem('schedules', JSON.stringify(schedules));
        // Initial save uses standard sync to establish baseline
        if(typeof saveToServer === 'function') saveToServer(['schedules'], true);
    }

    if (!schedules[ACTIVE_SCHED_ID]) {
        const keys = Object.keys(schedules).sort();
        if (keys.length > 0) ACTIVE_SCHED_ID = keys[0];
        else {
            schedules["A"] = { items: [], assigned: null };
            ACTIVE_SCHED_ID = "A";
            localStorage.setItem('schedules', JSON.stringify(schedules));
        }
    }

    const isAdmin = (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin' || CURRENT_USER.role === 'special_viewer' || CURRENT_USER.role === 'teamleader');
    const isTL = (CURRENT_USER.role === 'teamleader');
    
    if (!isAdmin && !isTL) {
        const mySchedId = getTraineeScheduleId(CURRENT_USER.user, schedules);
        if (!mySchedId) {
            container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-muted);"><i class="fas fa-calendar-times" style="font-size:3rem; margin-bottom:15px;"></i><br>No schedule has been assigned to your group yet.</div>`;
            return;
        }
        ACTIVE_SCHED_ID = mySchedId;
    }

    const tabsHtml = buildTabs(schedules, isAdmin);
    const toolbarHtml = buildToolbar(schedules[ACTIVE_SCHED_ID], isAdmin);
    
    // View Switcher
    const viewToggler = `
        <div style="display:flex; justify-content:flex-end; margin-bottom:10px; gap:5px;">
            <button class="btn-secondary ${VIEW_MODE==='list'?'active':''}" onclick="switchViewMode('list')" style="padding:5px 10px;"><i class="fas fa-list"></i> List</button>
            <button class="btn-secondary ${VIEW_MODE==='calendar'?'active':''}" onclick="switchViewMode('calendar')" style="padding:5px 10px;"><i class="fas fa-calendar-alt"></i> Calendar</button>
        </div>
    `;

    let contentHtml = '';
    if(VIEW_MODE === 'calendar') {
        contentHtml = buildCalendar(schedules[ACTIVE_SCHED_ID].items, isAdmin);
    } else {
        contentHtml = buildTimeline(schedules[ACTIVE_SCHED_ID].items, isAdmin);
    }

    container.innerHTML = `
        <div class="sched-tabs-container" style="display:flex; gap:5px; border-bottom:1px solid var(--border-color); padding-bottom:10px; margin-bottom:15px; overflow-x:auto;">${tabsHtml}</div>
        ${viewToggler}
        <div class="sched-toolbar-wrapper" style="margin-bottom:20px;">${toolbarHtml}</div>
        <div id="scheduleTimeline" class="timeline-container">${contentHtml}</div>
    `;

    if (isAdmin && !schedules[ACTIVE_SCHED_ID].assigned) {
        populateScheduleDropdown('schedAssignSelect');
    }
}

function buildTabs(schedules, isAdmin) {
    if (!isAdmin && CURRENT_USER.role !== 'teamleader') return ''; 
    const keys = Object.keys(schedules).sort();
    let html = keys.map(key => {
        const isActive = key === ACTIVE_SCHED_ID ? 'active' : '';
        const data = schedules[key];
        let subLabel = "Unassigned";
        if (data.assigned) {
            subLabel = (typeof getGroupLabel === 'function') ? getGroupLabel(data.assigned).split('[')[0] : data.assigned;
        }
        return `<button class="sched-tab-btn ${isActive}" onclick="switchScheduleTab('${key}')" style="padding: 8px 15px; border:1px solid var(--border-color); background:var(--bg-card); cursor:pointer; border-radius:6px; min-width:100px; text-align:left;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:bold; font-size:0.9rem;">Schedule ${key}</span>
                ${isAdmin && CURRENT_USER.role !== 'special_viewer' && CURRENT_USER.role !== 'teamleader' ? `<i class="fas fa-times" onclick="event.stopPropagation(); deleteSchedule('${key}')" style="font-size:0.8rem; color:#ff5252; opacity:0.6; transition:0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6" title="Delete Schedule"></i>` : ''}
            </div>
            <div style="font-size:0.75rem; color:${data.assigned ? 'var(--primary)' : 'var(--text-muted)'};">${subLabel}</div>
        </button>`;
    }).join('');
    if (isAdmin && CURRENT_USER.role !== 'special_viewer' && CURRENT_USER.role !== 'teamleader') html += `<button onclick="createNewSchedule()" style="padding: 8px 12px; border:1px dashed var(--border-color); background:transparent; cursor:pointer; border-radius:6px; color:var(--primary);" title="Create New Schedule Group"><i class="fas fa-plus"></i></button>`;
    return html;
}

function buildToolbar(scheduleData, isAdmin) {
    if (!isAdmin) {
        if (scheduleData.assigned) return `<div style="padding:10px; background:var(--bg-input); border-left:4px solid var(--primary); border-radius:4px;">Currently viewing schedule for: <strong>${(typeof getGroupLabel === 'function') ? getGroupLabel(scheduleData.assigned) : scheduleData.assigned}</strong></div>`;
        return '';
    }
    if (scheduleData.assigned) {
        const label = (typeof getGroupLabel === 'function') ? getGroupLabel(scheduleData.assigned) : scheduleData.assigned;
        return `<div style="display:flex; justify-content:space-between; align-items:center; padding:15px; background:rgba(39, 174, 96, 0.1); border:1px solid #27ae60; border-radius:6px;"><div><i class="fas fa-check-circle" style="color:#27ae60; margin-right:5px;"></i> Assigned to: <strong>${label}</strong></div><div>${(CURRENT_USER.role === 'special_viewer' || CURRENT_USER.role === 'teamleader') ? '<span style="color:var(--text-muted);">View Only</span>' : `<button class="btn-secondary btn-sm" onclick="duplicateCurrentSchedule()" title="Duplicate this schedule to new" style="margin-right:5px;"><i class="fas fa-clone"></i> Duplicate</button><button class="btn-secondary btn-sm" onclick="cloneSchedule('${ACTIVE_SCHED_ID}')" title="Copy from another schedule" style="margin-right:5px;"><i class="fas fa-copy"></i> Copy From...</button><button class="btn-danger btn-sm" onclick="deleteSchedule('${ACTIVE_SCHED_ID}')" title="Delete Schedule"><i class="fas fa-trash"></i></button><button class="btn-danger btn-sm" onclick="clearAssignment('${ACTIVE_SCHED_ID}')" style="margin-left:5px;">Unassign</button>`}</div></div>`;
    } else {
        return `<div style="display:flex; gap:10px; align-items:center; padding:15px; background:var(--bg-card); border:1px dashed var(--border-color); border-radius:6px;"><i class="fas fa-exclamation-circle" style="color:orange;"></i><span style="margin-right:auto;">This schedule is currently empty/inactive. Assign a roster to start.</span>${(CURRENT_USER.role === 'special_viewer' || CURRENT_USER.role === 'teamleader') ? '<span style="color:var(--text-muted);">View Only</span>' : `<select id="schedAssignSelect" class="form-control" style="width:250px; margin:0;"><option value="">Loading Groups...</option></select><button class="btn-primary btn-sm" onclick="assignRosterToSchedule('${ACTIVE_SCHED_ID}')">Assign Roster</button><button class="btn-secondary btn-sm" onclick="duplicateCurrentSchedule()" title="Duplicate this schedule to new"><i class="fas fa-clone"></i></button><button class="btn-secondary btn-sm" onclick="cloneSchedule('${ACTIVE_SCHED_ID}')" title="Copy from another schedule"><i class="fas fa-copy"></i></button><button class="btn-danger btn-sm" onclick="deleteSchedule('${ACTIVE_SCHED_ID}')" title="Delete Schedule"><i class="fas fa-trash"></i></button>`}</div>`;
    }
}

function buildTimeline(items, isAdmin) {
    let timelineHTML = '';
    if (!items || items.length === 0) {
        timelineHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted);">No timeline items yet.</div>`;
    } else {
        timelineHTML = items.map((item, index) => {
            const status = getScheduleStatus(item.dateRange, item.dueDate);
            let timelineClass = 'schedule-upcoming';
            if (status === 'active') timelineClass = 'schedule-active';
            else if (status === 'past') timelineClass = 'schedule-past';

            let actions = '';
            if (isAdmin) {
                if (CURRENT_USER.role === 'special_viewer' || CURRENT_USER.role === 'teamleader') {
                    actions = '';
                } else {
                    actions = `
                        <span style="cursor:grab; color:var(--text-muted); margin-right:10px;" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></span>
                        <button class="btn-edit-sched" onclick="editTimelineItem(${index})" aria-label="Edit Item"><i class="fas fa-pen"></i></button>
                        <button class="btn-danger btn-sm" onclick="deleteTimelineItem(${index})" aria-label="Delete Item" style="margin-left:5px;"><i class="fas fa-trash"></i></button>
                    `;
                }
            } else {
                if (item.linkedTestId) {
                    const isTimeOpen = checkTimeAccess(item.openTime, item.closeTime, item.ignoreTime);
                    const isDayMatch = isAssessmentDay(item.dateRange, item.dueDate);
                    
                    if (status === 'upcoming') actions = `<button class="btn-start-test disabled" aria-label="Locked"><i class="fas fa-lock"></i> Locked</button>`;
                    else if (status === 'past') actions = `<button class="btn-start-test disabled" aria-label="Closed"><i class="fas fa-history"></i> Closed</button>`;
                    else if (!isDayMatch) actions = `<button class="btn-start-test disabled" aria-label="Study Phase"><i class="fas fa-book-reader"></i> Study Phase</button>`;
                    else if (!isTimeOpen) actions = `<button class="btn-start-test disabled" aria-label="Time Locked"><i class="fas fa-clock"></i> ${item.openTime} - ${item.closeTime}</button>`;
                    else actions = `<button class="btn-start-test" onclick="goToTest('${item.linkedTestId}')" aria-label="Take Test">Take Assessment</button>`;
                } else if (item.assessmentLink) {
                    const isTimeOpen = checkTimeAccess(item.openTime, item.closeTime, item.ignoreTime);
                    const isDayMatch = isAssessmentDay(item.dateRange, item.dueDate);

                    if (status === 'upcoming') {
                           actions = `<span class="btn-link-external disabled" style="opacity:0.5; cursor:not-allowed;">Locked <i class="fas fa-lock"></i></span>`;
                    } else {
                           if (!isDayMatch && status === 'active') actions = `<span class="btn-link-external disabled" style="opacity:0.5; cursor:not-allowed;">Study Phase <i class="fas fa-book-reader"></i></span>`;
                           else if (!isTimeOpen && status === 'active') actions = `<span class="btn-link-external disabled" style="opacity:0.5; cursor:not-allowed;"><i class="fas fa-clock"></i> ${item.openTime} - ${item.closeTime}</span>`;
                           else actions = `<a href="${item.assessmentLink}" target="_blank" class="btn-link-external" aria-label="External Link">Open Link <i class="fas fa-external-link-alt"></i></a>`;
                    }
                }
            }

            // Hide access time if restrictions are disabled
            const timeInfo = ((item.openTime || item.closeTime) && !item.ignoreTime) ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;"><i class="fas fa-clock"></i> Access: ${item.openTime || '00:00'} - ${item.closeTime || '23:59'}</div>` : '';
            const dueInfo = item.dueDate ? `<span style="font-size:0.75rem; color:#e74c3c; margin-left:10px;">Due: ${item.dueDate}</span>` : '';

            // --- MATERIAL LINK LOGIC (UPDATED) ---
            let materialLinkHtml = '';
            if (item.materialLink) {
                // Material is available if date range is valid OR always open flag is set
                const isMaterialOpen = item.materialAlways || isDateInRange(item.dateRange, item.dueDate);
                if (!isMaterialOpen && !isAdmin) {
                    // Render as disabled non-clickable text for Trainees
                    materialLinkHtml = `<div style="margin-top:10px;"><span class="btn-link" style="font-size:0.9rem; cursor:not-allowed; opacity:0.5; color:var(--text-muted);"><i class="fas fa-lock"></i> Study Material (Locked)</span></div>`;
                } else {
                    // Render standard link
                    // UPDATED: Use StudyMonitor to open internally
                    // FIX: Escape URL to prevent syntax errors with SharePoint links containing quotes
                    const safeLink = item.materialLink.replace(/'/g, "\\'");
                    const safeTitle = item.courseName.replace(/'/g, "\\'");
                    materialLinkHtml = `<div style="margin-top:10px;"><button onclick="StudyMonitor.openStudyWindow('${safeLink}', '${safeTitle}')" class="btn-link" style="font-size:0.9rem; cursor:pointer; background:transparent; border:1px solid var(--border-color); color:var(--text-main);"><i class="fas fa-book-open"></i> Study Material</button></div>`;
                }
            }
            // -------------------------------------

            return `<div class="timeline-item ${timelineClass}" draggable="${isAdmin && CURRENT_USER.role !== 'teamleader'}" ondragstart="schedDragStart(event, ${index})" ondragover="schedDragOver(event)" ondrop="schedDrop(event, ${index})" style="position:relative; padding-left:20px; border-left:2px solid var(--border-color); margin-bottom:20px;">
                <div class="timeline-marker"></div>
                <div class="timeline-content" style="background:var(--bg-input); padding:15px; border-radius:8px; border:1px solid var(--border-color);">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <div><span class="timeline-date" style="font-size:0.8rem; font-weight:bold; color:var(--primary);">${item.dateRange} ${dueInfo}</span><h4 style="margin:5px 0;">${item.courseName}</h4>${timeInfo}</div>
                        <div>${actions}</div>
                    </div>
                    ${materialLinkHtml}
                </div>
            </div>`;
        }).join('');
    }

    if (isAdmin && CURRENT_USER.role !== 'special_viewer' && CURRENT_USER.role !== 'teamleader') {
        timelineHTML += `<div style="text-align:center; margin-top:20px;"><button class="btn-secondary" onclick="addTimelineItem()">+ Add Timeline Item</button></div>`;
    }

    return timelineHTML;
}

// --- CALENDAR VIEW LOGIC ---

function switchViewMode(mode) {
    VIEW_MODE = mode;
    renderSchedule();
}

function changeCalendarMonth(delta) {
    CALENDAR_MONTH.setMonth(CALENDAR_MONTH.getMonth() + delta);
    renderSchedule();
}

function buildCalendar(items, isAdmin) {
    // NEW: Use aggregated events if available
    let allEvents = items; // Fallback
    if (typeof CalendarModule !== 'undefined' && typeof CalendarModule.getEvents === 'function') {
        allEvents = CalendarModule.getEvents();
    }

    const year = CALENDAR_MONTH.getFullYear();
    const month = CALENDAR_MONTH.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay(); // 0 = Sunday

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    let html = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; background:var(--bg-input); padding:10px; border-radius:8px;">
            <button class="btn-secondary" onclick="changeCalendarMonth(-1)">&lt; Prev</button>
            <h3 style="margin:0;">${monthNames[month]} ${year}</h3>
            <button class="btn-secondary" onclick="changeCalendarMonth(1)">Next &gt;</button>
        </div>
        <div class="calendar-grid" style="display:grid; grid-template-columns: repeat(7, 1fr); gap:5px;">
            <div style="font-weight:bold; text-align:center;">Sun</div>
            <div style="font-weight:bold; text-align:center;">Mon</div>
            <div style="font-weight:bold; text-align:center;">Tue</div>
            <div style="font-weight:bold; text-align:center;">Wed</div>
            <div style="font-weight:bold; text-align:center;">Thu</div>
            <div style="font-weight:bold; text-align:center;">Fri</div>
            <div style="font-weight:bold; text-align:center;">Sat</div>
    `;

    // Empty slots for previous month
    for (let i = 0; i < startDayOfWeek; i++) {
        html += `<div style="background:transparent;"></div>`;
    }

    // Days
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}/${String(month + 1).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
        const todayStr = new Date().toISOString().split('T')[0].replace(/-/g, '/');
        const isToday = dateStr === todayStr;
        
        // Find items for this day
        // Note: CalendarModule events use 'start' and 'end' (YYYY/MM/DD)
        let dayItems = [];
        if (typeof CalendarModule !== 'undefined') {
            dayItems = allEvents.filter(e => {
                 const s = e.start.replace(/-/g, '/');
                 const end = e.end.replace(/-/g, '/');
                 return dateStr >= s && dateStr <= end;
            });
        } else {
            // Fallback for raw schedule items
            dayItems = items.filter(item => isDateInRange(item.dateRange, item.dueDate, dateStr));
        }
        
        let itemsHtml = dayItems.map(e => `
            <div style="font-size:0.7rem; background:${e.color || 'var(--primary)'}20; color:${e.color || 'var(--primary)'}; padding:2px 4px; border-radius:3px; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; border-left:2px solid ${e.color || 'var(--primary)'};" title="${e.title || e.courseName}">
                ${e.title || e.courseName}
            </div>
        `).join('');

        html += `
            <div style="background:var(--bg-card); border:1px solid var(--border-color); min-height:80px; padding:5px; border-radius:4px; ${isToday ? 'border:2px solid var(--primary);' : ''}">
                <div style="text-align:right; font-size:0.8rem; font-weight:bold; color:var(--text-muted);">${d}</div>
                ${itemsHtml}
            </div>
        `;
    }

    html += `</div>`;
    return html;
}

// --- PART B: LIVE ASSESSMENT BOOKING (REWORKED) ---

function isBusinessDay(dateObj) {
    const day = dateObj.getDay();
    // 0 = Sunday, 6 = Saturday
    if (day === 0 || day === 6) return false;
    
    // Check Holidays
    const dateStr = dateObj.toISOString().split('T')[0];
    if (SA_HOLIDAYS.includes(dateStr)) return false;
    
    return true;
}

function getNextBusinessDays(startDateStr, count) {
    let days = [];
    let current = new Date(startDateStr);
    
    // Safety Break to prevent infinite loop if data is bad
    let attempts = 0;
    while (days.length < count && attempts < 1000) {
        if (isBusinessDay(current)) {
            days.push(new Date(current));
        }
        current.setDate(current.getDate() + 1);
        attempts++;
    }
    return days;
}

// --- FORCE LIVE SYNC ---
window.forceLiveSync = async function(btn) {
    if (btn) {
        btn.innerHTML = '<i class="fas fa-sync fa-spin"></i> Refreshing...';
        btn.disabled = true;
    }
    if (typeof loadFromServer === 'function') {
        await loadFromServer(true); // Pull fresh layout settings (liveSchedules)
    }
    if (typeof forceFullSync === 'function') {
        await forceFullSync('liveBookings');
    }
    await renderLiveTable();
    if (btn) {
        btn.innerHTML = '<i class="fas fa-sync"></i> Refresh Bookings';
        btn.disabled = false;
    }
};

async function renderLiveTable() {
    const tbody = document.getElementById('liveBookingBody');
    if(!tbody) return;

    // --- FOCUS & INTERACTION PROTECTION (TIMEBOMB 2 FIX) ---
    if (window.IS_DRAGGING_LIVE) return; // Prevent DOM wipe during drag
    if (!document.getElementById('bookingModal').classList.contains('hidden')) return;

    // Inject global refresh button for the table if missing
    let refreshContainer = document.getElementById('liveRefreshContainer');
    if (!refreshContainer) {
        refreshContainer = document.createElement('div');
        refreshContainer.id = 'liveRefreshContainer';
        refreshContainer.style.cssText = 'display:flex; justify-content:flex-end; margin-bottom:10px;';
        refreshContainer.innerHTML = `<button class="btn-secondary btn-sm" onclick="forceLiveSync(this)"><i class="fas fa-sync"></i> Refresh Bookings</button>`;
        const table = tbody.closest('table');
        if (table && table.parentNode) {
            table.parentNode.insertBefore(refreshContainer, table);
        }
    }

    // --- AUTHORITATIVE SYNC ON LOAD ---
    // On first load of this tab, perform a full sync of bookings to get the source of truth.
    // Subsequent updates will be handled by the lightweight real-time listener.
    if (!window._liveSyncDone) {
        window._liveSyncDone = true; // Prevent loops
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--text-muted);"><i class="fas fa-circle-notch fa-spin fa-2x"></i><br><br>Synchronizing Live Bookings...</td></tr>';
        if (typeof loadFromServer === 'function') {
            await loadFromServer(true); // Ensure schedules layout is fresh
        }
        if (typeof forceFullSync === 'function') {
            await forceFullSync('liveBookings');
        }
    }

    // 1. MIGRATION & INIT
    let liveSchedules = JSON.parse(localStorage.getItem('liveSchedules') || 'null');
    if (!liveSchedules) {
        const oldSettings = JSON.parse(localStorage.getItem('liveScheduleSettings') || '{}');
        liveSchedules = {
            "A": {
                startDate: oldSettings.startDate || new Date().toISOString().split('T')[0],
                days: oldSettings.days || 5,
                activeSlots: oldSettings.activeSlots || ["1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"],
                trainers: ["Trainer 1", "Trainer 2"], // Default
                dailyTrainers: {}, // NEW: Per-day overrides
                assigned: null
            }
        };
        localStorage.setItem('liveSchedules', JSON.stringify(liveSchedules));
        // Save migration immediately
        if(typeof saveToServer === 'function') saveToServer(['liveSchedules'], true);
    }

    // 2. DETERMINE ACTIVE SCHEDULE
    const isAdmin = (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin' || CURRENT_USER.role === 'special_viewer' || CURRENT_USER.role === 'teamleader');
    
    if (!isAdmin) {
        // Trainee: Auto-select assigned schedule
        const mySchedId = getTraineeLiveScheduleId(CURRENT_USER.user, liveSchedules);
        if (!mySchedId) {
             const container = document.getElementById('live-assessment');
             if(container) container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-muted);"><i class="fas fa-calendar-times" style="font-size:3rem; margin-bottom:15px;"></i><br>No live assessment schedule assigned to your group.</div>`;
             return;
        }
        ACTIVE_LIVE_SCHED_ID = mySchedId;
    } else {
        // Admin: Ensure active ID exists
        if (!liveSchedules[ACTIVE_LIVE_SCHED_ID]) {
            ACTIVE_LIVE_SCHED_ID = Object.keys(liveSchedules).sort()[0] || 'A';
        }
    }

    const currentSched = liveSchedules[ACTIVE_LIVE_SCHED_ID];
    const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
    const allLiveSessions = JSON.parse(localStorage.getItem('liveSessions') || '[]');
    
    // 3. RENDER ADMIN CONTROLS (TABS & TOOLBAR)
    if(isAdmin) {
        const adminPanel = document.querySelector('#live-assessment .admin-only');
        if(adminPanel) {
            adminPanel.classList.remove('hidden');
            
            // Inject Tabs & Toolbar
            let controlsHtml = buildLiveTabs(liveSchedules) + buildLiveToolbar(currentSched, isAdmin);
            
            // Inject Settings Form (Existing inputs)
            controlsHtml += `
                <div class="card" style="margin-top:15px; background:var(--bg-input);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <h4 style="margin:0;"><i class="fas fa-cogs"></i> Schedule Configuration</h4>
                        <button class="btn-secondary btn-sm" onclick="openLiveStatsModal()"><i class="fas fa-chart-pie"></i> View Trainee Stats Breakdown</button>
                    </div>
                    <div style="display:flex; gap:15px; align-items:end; margin-bottom:10px;">
                        <div><label>Start Date</label><input type="date" id="liveStartDate" value="${currentSched.startDate}"></div>
                        <div><label>Days</label><input type="number" id="liveNumDays" value="${currentSched.days}" min="1" max="30" style="width:80px;"></div>
                        <div style="flex:1;"><label>Default Trainers</label><input type="text" id="liveTrainersInput" value="${(currentSched.trainers || ['Trainer 1', 'Trainer 2']).join(', ')}" placeholder="Trainer 1, Trainer 2..."></div>
                        <button class="btn-primary" onclick="saveLiveScheduleSettings()" style="height:38px;">Update Settings</button>
                    </div>
                    <div id="liveSlotConfig" style="margin-top:10px; display:flex; gap:15px; flex-wrap:wrap;">
                        <label style="font-size:0.9rem; font-weight:bold;">Active Hours:</label>
                        ${["1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"].map(slot => `
                            <label style="cursor:pointer;">
                                <input type="checkbox" id="slot_${slot.replace(/[: ]/g, '')}" ${currentSched.activeSlots && currentSched.activeSlots.includes(slot) ? 'checked' : ''}> ${slot}
                            </label>
                        `).join('')}
                        <button class="btn-danger btn-sm" onclick="clearLiveBookings()" style="margin-left:auto;">Reset / Clear</button>
                    </div>
                </div>
            `;
            
            adminPanel.innerHTML = controlsHtml;
            
            // Populate Dropdown if unassigned
            if (!currentSched.assigned) {
                populateScheduleDropdown('liveAssignSelect');
            }
        }
    } else {
        const adminPanel = document.querySelector('#live-assessment .admin-only');
        if(adminPanel) adminPanel.classList.add('hidden');
    }

    // 4. GENERATE TABLE
    const startDate = currentSched.startDate;
    const daysCount = parseInt(currentSched.days) || 5;
    const activeSlots = currentSched.activeSlots || ["1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"];
    
    const validDays = getNextBusinessDays(startDate, daysCount);
    const defaultTrainers = currentSched.trainers || ["Trainer 1", "Trainer 2"];
    const searchTerm = document.getElementById('liveBookingSearch') ? document.getElementById('liveBookingSearch').value.toLowerCase() : '';

    let html = '';

    validDays.forEach(d => {
        const dayStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const dateKey = d.toISOString().split('T')[0];

        // DETERMINE TRAINERS FOR THIS SPECIFIC DAY
        // Priority: Daily Override > Default List
        let dayTrainers = defaultTrainers;
        if (currentSched.dailyTrainers && currentSched.dailyTrainers[dateKey]) {
            dayTrainers = currentSched.dailyTrainers[dateKey];
        }
        
        const trainerCountInfo = `<div style="font-size:0.7rem; color:var(--text-muted); margin-top:5px;">${dayTrainers.length} Trainers</div>`;

        html += `<tr><td style="background:var(--bg-input); border-right:2px solid var(--border-color); vertical-align:middle;">
            <strong>${dayStr}</strong><br><span style="font-size:0.8rem; color:var(--text-muted);">${dateKey}</span>
            ${isAdmin ? `<button class="btn-secondary btn-sm" style="display:block; margin-top:8px; width:100%; font-size:0.7rem;" onclick="editDailyTrainers('${dateKey}')"><i class="fas fa-user-edit"></i> Edit Trainers</button>` : ''}
        </td>`;

        activeSlots.forEach(time => {
            html += `<td style="vertical-align:top; padding:5px;">`;
            
            // SMART TRAINER LIST: Merge Config + Actual Bookings
            // This ensures if a trainer is removed from settings, their existing booking stays visible.
            const slotBookings = bookings.filter(b => b.date === dateKey && b.time === time && b.status !== 'Cancelled');
            const bookedTrainerNames = slotBookings.map(b => b.trainer);
            
            // Combine Day Config list with any extras found in bookings (Legacy/Removed trainers)
            const effectiveTrainers = [...new Set([...dayTrainers, ...bookedTrainerNames])];

            effectiveTrainers.forEach(trainer => {
                const slotId = `${dateKey}_${time}_${trainer.replace(' ','')}`;
                
                // DROP ZONE WRAPPER
                // We wrap the slot in a div that accepts drops.
                // data attributes store the target coordinates.
                html += `<div class="live-drop-zone" data-date="${dateKey}" data-time="${time}" data-trainer="${trainer}" 
                    ondragover="liveDragOver(event)" ondragleave="liveDragLeave(event)" ondrop="liveDrop(event)"
                    style="min-height:50px; border:2px dashed transparent; border-radius:4px; padding:4px; transition:0.2s; margin-bottom:5px;">`;
                
                // Find booking for this SPECIFIC slot (Trainer + Time + Date)
                // We already filtered slotBookings above, just find the match
                const booking = slotBookings.find(b => b.trainer === trainer);

                const isTaken = !!booking;
                const isMine = booking && booking.trainee === CURRENT_USER.user;
                const isCompleted = booking && booking.status === 'Completed';

                let highlightClass = '';
                if (isTaken && searchTerm) {
                    if (booking.trainee.toLowerCase().includes(searchTerm) || booking.assessment.toLowerCase().includes(searchTerm)) {
                        highlightClass = 'search-match';
                    }
                }

                let slotHtml = '';
                
                // HEADER FOR TRAINER
                html += `<div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:2px; font-weight:bold; text-transform:uppercase;">${trainer}</div>`;

                if (isTaken) {
                    // BOOKED STATE
                    let statusClass = isMine ? 'mine' : 'taken';
                    if (isCompleted) statusClass = 'completed';

                    // Info Display
                    let info = '';
                    if (isMine || ['admin', 'super_admin', 'teamleader', 'special_viewer'].includes(CURRENT_USER.role)) {
                        info = `<div style="font-weight:bold; font-size:0.85rem;">${booking.trainee}</div>
                                <div style="font-size:0.75rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${booking.assessment}</div>`;
                    } else {
                        info = `<div style="font-style:italic; color:var(--text-muted);">Booked</div>`;
                    }

                    // Actions
                    let actions = '';
                    if ((CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin') && CURRENT_USER.role !== 'special_viewer') {
                        // Admin: Cancel OR Mark Complete
                        const existingSession = allLiveSessions.find(s => s.bookingId === booking.id && s.active);

                        if(!isCompleted) {
                            if (existingSession) {
                                actions += `<button class="btn-warning btn-sm" style="padding:2px 6px; margin-right:5px;" onclick="showTab('live-execution')" title="Rejoin Active Session"><i class="fas fa-sign-in-alt"></i> Rejoin</button>`;
                            } else {
                                actions += `<button class="btn-primary btn-sm" style="padding:2px 6px; margin-right:5px;" onclick="initiateLiveSession('${booking.id}', '${booking.assessment}', '${booking.trainee}')" title="Start Live Session"><i class="fas fa-play"></i> Start</button>`;
                                actions += `<button class="btn-success btn-sm" style="padding:2px 6px; margin-right:5px;" onclick="markBookingComplete('${booking.id}')" title="Mark Complete"><i class="fas fa-check"></i></button>`;
                            }
                        }
                        actions += `<button class="btn-danger btn-sm" style="padding:2px 6px;" onclick="cancelBooking('${booking.id}')" title="Cancel"><i class="fas fa-times"></i></button>`;
                    } else if (isMine && !isCompleted) {
                        // User: Cancel only
                        actions += `<button class="btn-cancel" onclick="cancelBooking('${booking.id}')">Cancel</button>`;
                    }

                    // DRAGGABLE ATTRIBUTES (Admin Only)
                    const dragAttr = isAdmin ? `draggable="true" ondragstart="liveDragStart(event, '${booking.id}')" style="cursor:grab;"` : '';

                    html += `
                        <div class="slot-item ${statusClass} ${highlightClass}" ${dragAttr} style="margin-bottom:8px;">
                            ${info}
                            <div style="margin-top:4px;">${actions}</div>
                        </div>`;

                } else {
                    // FREE STATE
                    // Check Logic: Can user book here?
                    // Rule: "Agent is only allowed to book 1 session per hour on either trainer"
                    // Check if this user has ANY booking at this DATE + TIME (regardless of trainer)
                    const userBookedThisHour = bookings.some(b => 
                        b.date === dateKey && 
                        b.time === time && 
                        b.trainee === CURRENT_USER.user && 
                        b.status !== 'Cancelled'
                    );

                    if (CURRENT_USER.role === 'trainee') {
                        if (userBookedThisHour) {
                            // User is already booked in the other trainer slot for this hour
                            html += `<div style="padding:5px; background:var(--bg-input); border-radius:4px; color:var(--text-muted); font-size:0.75rem; text-align:center; margin-bottom:8px;">Slot Limit</div>`;
                        } else {
                            // Available to book
                            html += `<button class="btn-slot btn-book" style="margin-bottom:8px;" onclick="openBookingModal('${dateKey}', '${time}', '${trainer}')">+ Book</button>`;
                        }
                    } else {
                         // Admin can manually assign a trainee
                         html += `<button class="btn-slot" style="margin-bottom:8px; border:1px dashed var(--border-color); color:var(--text-muted); background:transparent;" onclick="openAdminBookingModal('${dateKey}', '${time}', '${trainer}')" title="Manually add a trainee to this slot">+ Assign Trainee</button>`;
                    }
                }

                html += `</div>`; // Close Drop Zone
            });

            html += `</td>`;
        });
        html += `</tr>`;
    });

    tbody.innerHTML = html;
}

// --- NEW: PER-DAY TRAINER EDIT ---
window.editDailyTrainers = async function(dateKey) {
    const liveSchedules = JSON.parse(localStorage.getItem('liveSchedules'));
    const current = liveSchedules[ACTIVE_LIVE_SCHED_ID];
    
    const defaults = current.trainers || ["Trainer 1", "Trainer 2"];
    const currentOverride = (current.dailyTrainers && current.dailyTrainers[dateKey]) ? current.dailyTrainers[dateKey] : defaults;
    
    const input = await customPrompt("Edit Trainers for " + dateKey, "Enter trainer names separated by commas (e.g. Jaco, Darren, Netta):", currentOverride.join(', '));
    
    if (input !== null) {
        const newTrainers = input.split(',').map(t => t.trim()).filter(t => t.length > 0);
        if (newTrainers.length === 0) return alert("Must have at least one trainer.");
        
        if (!current.dailyTrainers) current.dailyTrainers = {};
        current.dailyTrainers[dateKey] = newTrainers;
        
        localStorage.setItem('liveSchedules', JSON.stringify(liveSchedules));
        await secureScheduleSave();
        renderLiveTable();
    }
};

// --- DRAG AND DROP HANDLERS (LIVE) ---
window.liveDragStart = function(e, id) {
    window.IS_DRAGGING_LIVE = true;
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    e.target.style.opacity = '0.5';
};

window.liveDragOver = function(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const zone = e.target.closest('.live-drop-zone');
    if (zone) zone.style.borderColor = 'var(--primary)';
    if (zone) zone.style.background = 'rgba(243, 112, 33, 0.1)';
};

window.liveDragLeave = function(e) {
    const zone = e.target.closest('.live-drop-zone');
    if (zone) {
        zone.style.borderColor = 'transparent';
        zone.style.background = 'transparent';
    }
};

window.liveDrop = function(e) { // No longer async
    e.preventDefault();
    window.IS_DRAGGING_LIVE = false;
    const zone = e.target.closest('.live-drop-zone');
    if (!zone) return;
    
    // Reset visual
    zone.style.borderColor = 'transparent';
    zone.style.background = 'transparent';

    const bookingId = e.dataTransfer.getData("text/plain");
    const targetDate = zone.dataset.date;
    const targetTime = zone.dataset.time;
    const targetTrainer = zone.dataset.trainer;

    if (!bookingId || !targetDate || !targetTime || !targetTrainer) return;
    
    // No UI lock needed, moveLiveBooking is now optimistic
    moveLiveBooking(bookingId, targetDate, targetTime, targetTrainer);
};

// Global failsafe for drag release outside targets
document.addEventListener('dragend', (e) => { 
    window.IS_DRAGGING_LIVE = false; 
    if (e.target && e.target.style) e.target.style.opacity = '1';
});

async function moveLiveBooking(id, date, time, trainer) {
    const originalBookingsJSON = localStorage.getItem('liveBookings') || '[]';
    const bookings = JSON.parse(originalBookingsJSON);
    const targetBooking = bookings.find(b => b.id === id);
    
    if (!targetBooking) return;

    // Check Target Availability
    const conflict = bookings.find(b => b.date === date && b.time === time && b.trainer === trainer && b.status !== 'Cancelled' && b.id !== id);
    if (conflict) {
        if(typeof showToast === 'function') showToast("Target slot is already occupied.", "error");
        return;
    }

    targetBooking.date = date;
    targetBooking.time = time;
    targetBooking.trainer = trainer;
    
    // Optimistic UI Update
    localStorage.setItem('liveBookings', JSON.stringify(bookings));
    renderLiveTable();

    try {
        if (window.supabaseClient) {
            const { error } = await window.supabaseClient
                .from('live_bookings')
                .update({ data: targetBooking })
                .eq('id', id);
            if (error) throw error; // Throw to be caught by catch block
        }
    } catch (e) {
        // REVERT UI on failure
        console.error("Failed to move booking, reverting UI.", e);
        if (typeof showToast === 'function') showToast("Move failed. Reverting.", "error");
        
        localStorage.setItem('liveBookings', originalBookingsJSON); // Restore snapshot
        renderLiveTable(); // Re-render to snap back
    }
}

// --- NEW: LIVE ASSESSMENT STATS MODAL ---
window.openLiveStatsModal = function() {
    const liveSchedules = JSON.parse(localStorage.getItem('liveSchedules') || '{}');
    const currentSched = liveSchedules[ACTIVE_LIVE_SCHED_ID];
    
    if (!currentSched || !currentSched.assigned) {
        alert("No group assigned to this schedule.");
        return;
    }

    const groupId = currentSched.assigned;
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    const trainees = rosters[groupId] || [];
    
    // Get Data
    const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    
    // Calculate Total Available Live Assessments
    const liveNames = new Set();
    tests.forEach(t => { if(t.type === 'live') liveNames.add(t.title); });
    const totalAvailable = liveNames.size;
    const uniqueLiveTests = Array.from(liveNames);

    let rows = '';
    
    // Aggregate stats per trainee
    trainees.sort().forEach(t => {
        // Filter bookings for this trainee
        // Note: We don't filter by date here, we look at ALL history for completion status
        const myBookings = bookings.filter(b => b.trainee === t && b.status !== 'Cancelled');
        
        let completedCount = 0;
        let bookedCount = 0;

        uniqueLiveTests.forEach(testName => {
            const relatedBookings = myBookings.filter(b => b.assessment === testName);
            if (relatedBookings.length > 0) {
                if (relatedBookings.some(b => b.status === 'Completed')) {
                    completedCount++;
                } else if (relatedBookings.some(b => b.status === 'Booked')) {
                    bookedCount++;
                }
            }
        });

        const remaining = Math.max(0, totalAvailable - completedCount);
        
        // Calculate progress percentage
        const pct = totalAvailable > 0 ? Math.round((completedCount / totalAvailable) * 100) : 0;
        let statusColor = '#f1c40f'; // Orange
        if (pct >= 100) statusColor = '#2ecc71'; // Green
        else if (pct === 0) statusColor = '#e74c3c'; // Red

        rows += `
            <tr>
                <td><div style="display:flex; align-items:center;">${getAvatarHTML(t, 24)} <strong>${t}</strong></div></td>
                <td class="text-center">${bookedCount}</td>
                <td class="text-center" style="font-weight:bold; color:#2ecc71;">${completedCount}</td>
                <td class="text-center">${remaining}</td>
                <td>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div style="flex:1; height:6px; background:#333; border-radius:3px; overflow:hidden;">
                            <div style="width:${pct}%; background:${statusColor}; height:100%;"></div>
                        </div>
                        <span style="font-size:0.8rem; width:35px;">${pct}%</span>
                    </div>
                </td>
                <td class="text-right">
                    <button class="btn-secondary btn-sm" onclick="viewTraineeLiveDetails('${t}')"><i class="fas fa-eye"></i> Details</button>
                </td>
            </tr>
        `;
    });

    const modalHtml = `
        <div id="liveStatsModal" class="modal-overlay">
            <div class="modal-box" style="width:800px; max-width:95%;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid var(--border-color); padding-bottom:10px;">
                    <h3 style="margin:0;"><i class="fas fa-chart-pie"></i> Assessment Breakdown: ${groupId}</h3>
                    <button class="btn-secondary" onclick="document.getElementById('liveStatsModal').remove()">&times;</button>
                </div>
                <div style="margin-bottom:15px; font-size:0.9rem; color:var(--text-muted);">
                    <strong>Total Live Assessments Available:</strong> ${totalAvailable}
                </div>
                <div class="table-responsive" style="max-height:60vh; overflow-y:auto;">
                    <table class="admin-table">
                        <thead><tr><th>Trainee</th><th class="text-center">Booked</th><th class="text-center">Completed</th><th class="text-center">Remaining</th><th>Progress</th><th>Action</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
        </div>`;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
};

window.viewTraineeLiveDetails = function(trainee) {
    // Get Definitions
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const liveNames = new Set();
    tests.forEach(t => { if(t.type === 'live') liveNames.add(t.title); });
    const uniqueLiveTests = Array.from(liveNames).sort();
    
    // Get Data
    const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
    const myBookings = bookings.filter(b => b.trainee === trainee && b.status !== 'Cancelled');
    
    let rows = '';
    
    uniqueLiveTests.forEach(testName => {
        const relatedBookings = myBookings.filter(b => b.assessment === testName);
        let booking = null;
        if (relatedBookings.length > 0) {
            booking = relatedBookings.find(b => b.status === 'Completed') || relatedBookings.find(b => b.status === 'Booked') || relatedBookings[0];
        }
        
        let statusHtml = '<span class="status-badge" style="background:var(--bg-input); color:var(--text-muted);">Not Started</span>';
        let details = '-';
        
        if (booking) {
            if (booking.status === 'Completed') {
                statusHtml = `<span class="status-badge status-pass">Completed</span>`;
                details = `<div style="font-size:0.8rem;">Score: <strong>${booking.score || 0}%</strong></div><div style="font-size:0.75rem; color:var(--text-muted);">${booking.date}</div>`;
            } else {
                statusHtml = `<span class="status-badge status-improve">Booked</span>`;
                details = `<div style="font-size:0.8rem;">${booking.date} @ ${booking.time}</div><div style="font-size:0.75rem; color:var(--text-muted);">Trainer: ${booking.trainer}</div>`;
            }
        }
        
        rows += `
            <tr>
                <td>${testName}</td>
                <td>${statusHtml}</td>
                <td>${details}</td>
            </tr>
        `;
    });
    
    const modalHtml = `
        <div id="liveDetailsModal" class="modal-overlay" style="z-index:10005;">
            <div class="modal-box" style="width:600px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid var(--border-color); padding-bottom:10px;">
                    <h3 style="margin:0;"><i class="fas fa-list"></i> ${trainee} - Live Assessments</h3>
                    <button class="btn-secondary" onclick="document.getElementById('liveDetailsModal').remove()">&times;</button>
                </div>
                <div class="table-responsive">
                    <table class="admin-table">
                        <thead><tr><th>Assessment</th><th>Status</th><th>Details</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
        </div>`;
        
    document.body.insertAdjacentHTML('beforeend', modalHtml);
};

// --- LIVE SCHEDULE HELPERS ---

function buildLiveTabs(liveSchedules) {
    const keys = Object.keys(liveSchedules).sort();
    let html = '<div class="sched-tabs-container" style="display:flex; gap:5px; border-bottom:1px solid var(--border-color); padding-bottom:10px; margin-bottom:15px; overflow-x:auto;">';
    
    html += keys.map(key => {
        const isActive = key === ACTIVE_LIVE_SCHED_ID ? 'active' : '';
        const data = liveSchedules[key];
        let subLabel = "Unassigned";
        if (data.assigned) {
            subLabel = (typeof getGroupLabel === 'function') ? getGroupLabel(data.assigned).split('[')[0] : data.assigned;
        }
        return `<button class="sched-tab-btn ${isActive}" onclick="switchLiveScheduleTab('${key}')" style="padding: 8px 15px; border:1px solid var(--border-color); background:var(--bg-card); cursor:pointer; border-radius:6px; min-width:100px; text-align:left;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:bold; font-size:0.9rem;">Live Schedule ${key}</span>
                ${CURRENT_USER.role !== 'special_viewer' && CURRENT_USER.role !== 'teamleader' ? `<i class="fas fa-times" onclick="event.stopPropagation(); deleteLiveSchedule('${key}')" style="font-size:0.8rem; color:#ff5252; opacity:0.6; transition:0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6" title="Delete Schedule"></i>` : ''}
            </div>
            <div style="font-size:0.75rem; color:${data.assigned ? 'var(--primary)' : 'var(--text-muted)'};">${subLabel}</div>
        </button>`;
    }).join('');

    if (CURRENT_USER.role !== 'special_viewer' && CURRENT_USER.role !== 'teamleader') {
        html += `<button onclick="createNewLiveSchedule()" style="padding: 8px 12px; border:1px dashed var(--border-color); background:transparent; cursor:pointer; border-radius:6px; color:var(--primary);" title="Create New Live Schedule"><i class="fas fa-plus"></i></button>`;
    }
    html += '</div>';
    return html;
}

function buildLiveToolbar(scheduleData, isAdmin) {
    if (scheduleData.assigned) {
        const label = (typeof getGroupLabel === 'function') ? getGroupLabel(scheduleData.assigned) : scheduleData.assigned;
        return `<div style="display:flex; justify-content:space-between; align-items:center; padding:10px 15px; background:rgba(39, 174, 96, 0.1); border:1px solid #27ae60; border-radius:6px;">
            <div><i class="fas fa-check-circle" style="color:#27ae60; margin-right:5px;"></i> Assigned to: <strong>${label}</strong></div>
            <div>
                <button class="btn-danger btn-sm" onclick="assignRosterToLiveSchedule('${ACTIVE_LIVE_SCHED_ID}', null)">Unassign</button>
            </div>
        </div>`;
    } else {
        return `<div style="display:flex; gap:10px; align-items:center; padding:15px; background:var(--bg-card); border:1px dashed var(--border-color); border-radius:6px;">
            <i class="fas fa-exclamation-circle" style="color:orange;"></i>
            <span style="margin-right:auto;">This schedule is currently unassigned.</span>
            <select id="liveAssignSelect" class="form-control" style="width:250px; margin:0;"><option value="">Loading Groups...</option></select>
            <button class="btn-primary btn-sm" onclick="assignRosterToLiveSchedule('${ACTIVE_LIVE_SCHED_ID}', document.getElementById('liveAssignSelect').value)">Assign Roster</button>
        </div>`;
    }
}

function switchLiveScheduleTab(id) {
    ACTIVE_LIVE_SCHED_ID = id;
    renderLiveTable();
}

async function createNewLiveSchedule() {
    const liveSchedules = JSON.parse(localStorage.getItem('liveSchedules'));
    const keys = Object.keys(liveSchedules).sort();
    const lastKey = keys[keys.length - 1];
    const nextKey = String.fromCharCode(lastKey.charCodeAt(0) + 1);
    
    if (confirm(`Create new Live Schedule '${nextKey}'?`)) {
        liveSchedules[nextKey] = { 
            startDate: new Date().toISOString().split('T')[0],
            days: 5,
            activeSlots: ["1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"],
            trainers: ["Trainer 1", "Trainer 2"],
            assigned: null 
        };
        localStorage.setItem('liveSchedules', JSON.stringify(liveSchedules));
        // Force save to ensure creation is authoritative
        if(typeof saveToServer === 'function') await saveToServer(['liveSchedules'], true);
        ACTIVE_LIVE_SCHED_ID = nextKey;
        renderLiveTable();
    }
}

async function deleteLiveSchedule(id) {
    if (!confirm(`Delete Live Schedule ${id}?`)) return;
    const liveSchedules = JSON.parse(localStorage.getItem('liveSchedules'));
    delete liveSchedules[id];
    
    if (Object.keys(liveSchedules).length === 0) {
        liveSchedules["A"] = { startDate: new Date().toISOString().split('T')[0], days: 5, activeSlots: [], assigned: null };
    }
    
    localStorage.setItem('liveSchedules', JSON.stringify(liveSchedules));
    await secureScheduleSave();
    ACTIVE_LIVE_SCHED_ID = Object.keys(liveSchedules).sort()[0];
    renderLiveTable();
}

async function assignRosterToLiveSchedule(schedId, groupId) {
    const liveSchedules = JSON.parse(localStorage.getItem('liveSchedules'));
    
    // Check conflict
    if (groupId) {
        const conflict = Object.keys(liveSchedules).find(k => liveSchedules[k].assigned === groupId);
        if (conflict) {
            if (!confirm(`Group '${groupId}' is already assigned to Live Schedule ${conflict}. Move it here?`)) return;
            liveSchedules[conflict].assigned = null;
        }
    }

    liveSchedules[schedId].assigned = groupId;
    localStorage.setItem('liveSchedules', JSON.stringify(liveSchedules));
    // FIX: Use authoritative save to ensure assignment sticks immediately
    if (typeof saveToServer === 'function') {
        await saveToServer(['liveSchedules'], true);
    }
    renderLiveTable();
}

function getTraineeLiveScheduleId(username, liveSchedules) {
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    let myGroupId = null;
    for (const [gid, members] of Object.entries(rosters)) {
        if (members.some(m => m.toLowerCase() === username.toLowerCase())) { myGroupId = gid; break; }
    }
    if (!myGroupId) return null;
    return Object.keys(liveSchedules).find(key => liveSchedules[key].assigned === myGroupId) || null;
}

// --- LIVE SCHEDULE HELPERS ---

function buildLiveTabs(liveSchedules) {
    const keys = Object.keys(liveSchedules).sort();
    let html = '<div class="sched-tabs-container" style="display:flex; gap:5px; border-bottom:1px solid var(--border-color); padding-bottom:10px; margin-bottom:15px; overflow-x:auto;">';
    
    html += keys.map(key => {
        const isActive = key === ACTIVE_LIVE_SCHED_ID ? 'active' : '';
        const data = liveSchedules[key];
        let subLabel = "Unassigned";
        if (data.assigned) {
            subLabel = (typeof getGroupLabel === 'function') ? getGroupLabel(data.assigned).split('[')[0] : data.assigned;
        }
        return `<button class="sched-tab-btn ${isActive}" onclick="switchLiveScheduleTab('${key}')" style="padding: 8px 15px; border:1px solid var(--border-color); background:var(--bg-card); cursor:pointer; border-radius:6px; min-width:100px; text-align:left;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:bold; font-size:0.9rem;">Live Schedule ${key}</span>
                ${CURRENT_USER.role !== 'special_viewer' && CURRENT_USER.role !== 'teamleader' ? `<i class="fas fa-times" onclick="event.stopPropagation(); deleteLiveSchedule('${key}')" style="font-size:0.8rem; color:#ff5252; opacity:0.6; transition:0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6" title="Delete Schedule"></i>` : ''}
            </div>
            <div style="font-size:0.75rem; color:${data.assigned ? 'var(--primary)' : 'var(--text-muted)'};">${subLabel}</div>
        </button>`;
    }).join('');

    if (CURRENT_USER.role !== 'special_viewer' && CURRENT_USER.role !== 'teamleader') {
        html += `<button onclick="createNewLiveSchedule()" style="padding: 8px 12px; border:1px dashed var(--border-color); background:transparent; cursor:pointer; border-radius:6px; color:var(--primary);" title="Create New Live Schedule"><i class="fas fa-plus"></i></button>`;
    }
    html += '</div>';
    return html;
}

function buildLiveToolbar(scheduleData) {
    if (scheduleData.assigned) {
        const label = (typeof getGroupLabel === 'function') ? getGroupLabel(scheduleData.assigned) : scheduleData.assigned;
        return `<div style="display:flex; justify-content:space-between; align-items:center; padding:15px; background:rgba(39, 174, 96, 0.1); border:1px solid #27ae60; border-radius:6px;">
            <div><i class="fas fa-check-circle" style="color:#27ae60; margin-right:5px;"></i> Assigned to: <strong>${label}</strong></div>
            <div><button class="btn-danger btn-sm" onclick="assignRosterToLiveSchedule('${ACTIVE_LIVE_SCHED_ID}', null)">Unassign</button></div>
        </div>`;
    } else {
        return `<div style="display:flex; gap:10px; align-items:center; padding:15px; background:var(--bg-card); border:1px dashed var(--border-color); border-radius:6px;">
            <i class="fas fa-exclamation-circle" style="color:orange;"></i>
            <span style="margin-right:auto;">This schedule is currently unassigned.</span>
            <select id="liveAssignSelect" class="form-control" style="width:250px; margin:0;"><option value="">Loading Groups...</option></select>
            <button class="btn-primary btn-sm" onclick="assignRosterToLiveSchedule('${ACTIVE_LIVE_SCHED_ID}', document.getElementById('liveAssignSelect').value)">Assign Roster</button>
        </div>`;
    }
}

function switchLiveScheduleTab(id) {
    ACTIVE_LIVE_SCHED_ID = id;
    renderLiveTable();
}

async function createNewLiveSchedule() {
    const liveSchedules = JSON.parse(localStorage.getItem('liveSchedules'));
    const keys = Object.keys(liveSchedules).sort();
    const lastKey = keys[keys.length - 1];
    const nextKey = String.fromCharCode(lastKey.charCodeAt(0) + 1);
    
    if (confirm(`Create new Live Schedule '${nextKey}'?`)) {
        liveSchedules[nextKey] = { 
            startDate: new Date().toISOString().split('T')[0],
            days: 5,
            activeSlots: ["1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"],
            assigned: null 
        };
        localStorage.setItem('liveSchedules', JSON.stringify(liveSchedules));
        await secureScheduleSave();
        ACTIVE_LIVE_SCHED_ID = nextKey;
        renderLiveTable();
    }
}

async function deleteLiveSchedule(id) {
    if (!confirm(`Delete Live Schedule ${id}?`)) return;
    const liveSchedules = JSON.parse(localStorage.getItem('liveSchedules'));
    delete liveSchedules[id];
    
    // Re-index keys to ensure continuity (A, B, C...)
    const oldKeys = Object.keys(liveSchedules).sort();
    const newSchedules = {};

    if (oldKeys.length === 0) {
        newSchedules["A"] = { startDate: new Date().toISOString().split('T')[0], days: 5, activeSlots: [], assigned: null };
    } else {
        oldKeys.forEach((oldKey, index) => {
            const newKey = String.fromCharCode(65 + index); // 65 = 'A'
            newSchedules[newKey] = liveSchedules[oldKey];
        });
    }
    
    localStorage.setItem('liveSchedules', JSON.stringify(newSchedules));
    // FIX: Use force=true to prevent ghost data (merge restoring deleted schedule)
    if(typeof saveToServer === 'function') await saveToServer(['liveSchedules'], true);
    ACTIVE_LIVE_SCHED_ID = Object.keys(newSchedules).sort()[0];
    renderLiveTable();
}

async function assignRosterToLiveSchedule(schedId, groupId) {
    const liveSchedules = JSON.parse(localStorage.getItem('liveSchedules'));
    
    // Check conflict
    if (groupId) {
        const conflict = Object.keys(liveSchedules).find(k => liveSchedules[k].assigned === groupId);
        if (conflict) {
            if (!confirm(`Group '${groupId}' is already assigned to Live Schedule ${conflict}. Move it here?`)) return;
            liveSchedules[conflict].assigned = null;
        }
    }

    liveSchedules[schedId].assigned = groupId;
    localStorage.setItem('liveSchedules', JSON.stringify(liveSchedules));
    await secureScheduleSave();
    renderLiveTable();
}

function getTraineeLiveScheduleId(username, liveSchedules) {
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    let myGroupId = null;
    for (const [gid, members] of Object.entries(rosters)) {
        if (members.includes(username)) { myGroupId = gid; break; }
    }
    if (!myGroupId) return null;
    return Object.keys(liveSchedules).find(key => liveSchedules[key].assigned === myGroupId) || null;
}

// --- BOOKING LOGIC ---

let PENDING_BOOKING = null;

function openBookingModal(date, time, trainer) {
    PENDING_BOOKING = { date, time, trainer };
    const modal = document.getElementById('bookingModal');
    
    document.getElementById('bookingDetailsText').innerHTML = `
        Booking with <strong style="color:var(--primary);">${trainer}</strong><br>
        ${date} @ ${time}`;
    
    // Populate Assessments
    // PULLS DYNAMICALLY FROM TEST ENGINE (Only tests with type 'live')
    const assessSelect = document.getElementById('bookingAssessment');
    assessSelect.innerHTML = '';
    
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    
    const liveNames = new Set();
    tests.forEach(t => { if(t.type === 'live') liveNames.add(t.title); });
    
    let availableList = Array.from(liveNames);
    
    // FILTER FOR TRAINEES
    if (CURRENT_USER.role === 'trainee') {
        // Ensure user is assigned to a schedule (already checked in renderLiveTable, but safe to double check)
        const liveSchedules = JSON.parse(localStorage.getItem('liveSchedules') || '{}');
        const schedId = getTraineeLiveScheduleId(CURRENT_USER.user, liveSchedules);
        
        if (!schedId) availableList = [];
        if (!schedId) {
            availableList = [];
        } else {
            // FILTER OUT ALREADY BOOKED/COMPLETED ASSESSMENTS
            const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
            const myTaken = bookings.filter(b => b.trainee === CURRENT_USER.user && b.status !== 'Cancelled').map(b => b.assessment);
            availableList = availableList.filter(name => !myTaken.includes(name));
        }
    }
    
    if(availableList.length === 0) {
        assessSelect.innerHTML = '<option>No Available Assessments</option>';
    } else {
        availableList.sort().forEach(name => {
            assessSelect.add(new Option(name, name));
        });
    }

    modal.classList.remove('hidden');
}

function closeBookingModal() {
    document.getElementById('bookingModal').classList.add('hidden');
    PENDING_BOOKING = null;
    
    const extraDiv = document.getElementById('adminBookingExtra');
    if (extraDiv) extraDiv.innerHTML = '';
    
    const confirmBtn = document.querySelector('#bookingModal .btn-primary');
    if (confirmBtn) confirmBtn.setAttribute('onclick', 'confirmBooking()');
    
    // Catch up on any background updates that arrived while modal was open
    renderLiveTable();
}

// --- NEW: ADMIN MANUAL ASSIGNMENT ---
window.openAdminBookingModal = function(date, time, trainer) {
    PENDING_BOOKING = { date, time, trainer };
    const modal = document.getElementById('bookingModal');
    
    document.getElementById('bookingDetailsText').innerHTML = `
        Assigning to <strong style="color:var(--primary);">${trainer}</strong><br>
        ${date} @ ${time}`;
    
    const assessSelect = document.getElementById('bookingAssessment');
    assessSelect.innerHTML = '';
    
    let traineeSelectHtml = `<label style="font-weight:bold; display:block; margin-top:10px; margin-bottom:5px;">Select Trainee:</label>
                             <select id="adminBookingTrainee" style="width:100%; padding:10px; margin-bottom:15px;">`;
                             
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    const liveSchedules = JSON.parse(localStorage.getItem('liveSchedules') || '{}');
    const currentSched = liveSchedules[ACTIVE_LIVE_SCHED_ID];
    
    let trainees = [];
    if (currentSched && currentSched.assigned && rosters[currentSched.assigned]) {
        trainees = rosters[currentSched.assigned];
    } else {
        const users = JSON.parse(localStorage.getItem('users') || '[]');
        trainees = users.filter(u => u.role === 'trainee').map(u => u.user);
    }
    
    trainees.sort().forEach(t => { traineeSelectHtml += `<option value="${t}">${t}</option>`; });
    traineeSelectHtml += `</select>`;
    
    let extraDiv = document.getElementById('adminBookingExtra');
    if (!extraDiv) {
        extraDiv = document.createElement('div');
        extraDiv.id = 'adminBookingExtra';
        assessSelect.parentNode.insertBefore(extraDiv, assessSelect);
    }
    extraDiv.innerHTML = traineeSelectHtml;

    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const liveNames = new Set();
    tests.forEach(t => { if(t.type === 'live') liveNames.add(t.title); });
    
    Array.from(liveNames).sort().forEach(name => {
        assessSelect.add(new Option(name, name));
    });

    const confirmBtn = document.querySelector('#bookingModal .btn-primary');
    confirmBtn.setAttribute('onclick', 'confirmAdminBooking()');

    modal.classList.remove('hidden');
};

window.confirmAdminBooking = async function() {
    if(!PENDING_BOOKING) return;
    
    const trainee = document.getElementById('adminBookingTrainee').value;
    const assess = document.getElementById('bookingAssessment').value;
    
    if (!trainee) return alert("Select a trainee.");
    if (!assess) return alert("Select an assessment.");

    const btn = document.querySelector('#bookingModal .btn-primary');
    if(btn) { btn.innerText = "Assigning..."; btn.disabled = true; }

    try {
        // Check for conflicts directly on the server
        const { data: conflict } = await window.supabaseClient.from('live_bookings').select('id').eq('data->>date', PENDING_BOOKING.date).eq('data->>time', PENDING_BOOKING.time).eq('data->>trainer', PENDING_BOOKING.trainer).neq('data->>status', 'Cancelled');
        if (conflict && conflict.length > 0) return alert("This slot is already taken.");
        
        // Check for duplicate assessment for this trainee directly on the server
        const { data: dupAssess } = await window.supabaseClient.from('live_bookings')
            .select('id')
            .eq('data->>trainee', trainee)
            .eq('data->>assessment', assess)
            .neq('data->>status', 'Cancelled');
            
        if (dupAssess && dupAssess.length > 0) return alert(`Agent ${trainee} already has a booking for '${assess}'.`);

        const newBooking = {
            id: Date.now().toString(),
            date: PENDING_BOOKING.date,
            time: PENDING_BOOKING.time,
            trainer: PENDING_BOOKING.trainer,
            trainee: trainee,
            assessment: assess,
            status: 'Booked'
        };
        
        // Optimistic UI Update
        const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
        bookings.push(newBooking);
        localStorage.setItem('liveBookings', JSON.stringify(bookings));
        closeBookingModal();
        renderLiveTable();

        // Direct Supabase call
        if (window.supabaseClient) {
            const { error } = await window.supabaseClient.from('live_bookings').insert({ id: newBooking.id, data: newBooking, trainee: newBooking.trainee });
            if (error) throw error;
        }
        

    } catch(e) {
        console.error(e);
        alert("Failed to assign trainee.");
    } finally {
        if(btn) { btn.innerText = "Confirm"; btn.disabled = false; }
    }
};
// UPDATED: CONFIRM BOOKING WITH CONFLICT DETECTION
async function confirmBooking() {
    if(!PENDING_BOOKING) return;
    
    const assess = document.getElementById('bookingAssessment').value;
    if(!assess) return alert("Select an assessment.");

    // UI FEEDBACK: Prevent double clicks
    const btn = document.querySelector('#bookingModal .btn-primary');
    if(btn) { btn.innerText = "Checking Availability..."; btn.disabled = true; }

    try {
        // 1. ATOMIC COLLISION CHECK (TIMEBOMB 3 FIX)
        // Bypass slow queue and query Supabase directly for this exact slot
        if (window.supabaseClient) {
            const { data: conflict, error } = await window.supabaseClient.from('live_bookings')
                .select('id')
                .eq('data->>date', PENDING_BOOKING.date)
                .eq('data->>time', PENDING_BOOKING.time)
                .eq('data->>trainer', PENDING_BOOKING.trainer)
                .neq('data->>status', 'Cancelled');
                
            if (conflict && conflict.length > 0) {
                alert("This slot was just taken by another user. Please choose another time.");
                closeBookingModal();
                if(typeof loadFromServer === 'function') await loadFromServer(true); // Heal local state
                renderLiveTable(); 
                return;
            }
            
            // ATOMIC DUPLICATE ASSESSMENT CHECK
            const { data: dupAssess } = await window.supabaseClient.from('live_bookings')
                .select('id')
                .eq('data->>trainee', CURRENT_USER.user)
                .eq('data->>assessment', assess)
                .neq('data->>status', 'Cancelled');
                
            if (dupAssess && dupAssess.length > 0) {
                alert(`You already have an active or completed booking for '${assess}'.`);
                closeBookingModal();
                return;
            }
        }

        // 2. Read Data
        const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
        
        // VALIDATION 2: User booking > 1 session per hour?
        const isUserBookedThisHour = bookings.some(b => 
            b.date === PENDING_BOOKING.date && 
            b.time === PENDING_BOOKING.time && 
            b.trainee === CURRENT_USER.user && 
            b.status !== 'Cancelled'
        );
        if(isUserBookedThisHour) {
            alert("You have already booked a session for this hour with the other trainer.\nYou are only allowed 1 session per hour.");
            return;
        }

        // VALIDATION 3: Duplicate Assessment?
        const existingBooking = bookings.find(b => 
            b.trainee === CURRENT_USER.user && 
            b.assessment === assess && 
            b.status !== 'Cancelled'
        );
        
        if(existingBooking) {
            alert(`You already have an active booking for '${assess}'.\n\nFound active booking on: ${existingBooking.date} at ${existingBooking.time}.\n\nPlease check the schedule.`);
            return;
        }

        // CREATE BOOKING
        const newBooking = {
            id: Date.now().toString(),
            date: PENDING_BOOKING.date,
            time: PENDING_BOOKING.time,
            trainer: PENDING_BOOKING.trainer,
            trainee: CURRENT_USER.user,
            assessment: assess,
            status: 'Booked'
        };

        // Optimistic UI Update
        bookings.push(newBooking);
        localStorage.setItem('liveBookings', JSON.stringify(bookings));
        closeBookingModal();
        renderLiveTable();

        // Direct Supabase call
        if (window.supabaseClient) {
            const { error } = await window.supabaseClient.from('live_bookings').insert({ id: newBooking.id, data: newBooking, trainee: newBooking.trainee });
            if (error) throw error;
        }

        if(typeof updateNotifications === 'function') updateNotifications();

    } catch (e) {
        console.error("Booking Error:", e);
        alert("An error occurred while connecting to the schedule server. Please try again.");
    } finally {
        if(btn) { btn.innerText = "Confirm Booking"; btn.disabled = false; }
    }
}

async function cancelBooking(id) {
    if(!confirm("Are you sure you want to cancel this booking?")) return;

    // CHECK CANCELLATION POLICY
    if(CURRENT_USER.role === 'trainee') {
        const counts = JSON.parse(localStorage.getItem('cancellationCounts') || '{}');
        const myCount = counts[CURRENT_USER.user] || 0;
        
        if(myCount >= 1) {
            alert("Cancellation Limit Reached.\n\nPlease contact your trainer to change this booking.");
            return;
        }
        
        counts[CURRENT_USER.user] = myCount + 1;
        localStorage.setItem('cancellationCounts', JSON.stringify(counts));
    }

    let bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
    const target = bookings.find(b => b.id === id);
    if(target) {
        target.status = 'Cancelled';
        target.cancelledBy = CURRENT_USER.user;
        target.cancelledAt = new Date().toISOString();

        // Optimistic UI Update
        localStorage.setItem('liveBookings', JSON.stringify(bookings));
        renderLiveTable();

        // Direct Supabase call
        if (window.supabaseClient) {
            const { error } = await window.supabaseClient.from('live_bookings').update({ data: target }).eq('id', id);
            if (error) { 
                alert("Failed to cancel booking."); 
                console.error(error); 
                if(typeof loadFromServer === 'function') await loadFromServer(true); // Revert
                renderLiveTable();
                return; 
            }
        }
        
        // Also save cancellation counts authoritatively
        if(typeof saveToServer === 'function') {
            await saveToServer(['cancellationCounts'], true);
        }
    }
}

async function markBookingComplete(id) {
    let bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
    const target = bookings.find(b => b.id === id);
    if(target) {
        target.status = 'Completed';
        
        // Optimistic UI Update
        localStorage.setItem('liveBookings', JSON.stringify(bookings));
        renderLiveTable();

        // Direct Supabase call
        if (window.supabaseClient) {
            const { error } = await window.supabaseClient.from('live_bookings').update({ data: target }).eq('id', id);
            if (error) { 
                alert("Failed to update booking."); 
                console.error(error); 
                if(typeof loadFromServer === 'function') await loadFromServer(true); // Revert
                renderLiveTable();
                return; 
            }
        }
    }
}

// --- ADMIN SETTINGS ---

async function saveLiveScheduleSettings() {
    const start = document.getElementById('liveStartDate').value;
    const days = document.getElementById('liveNumDays').value;
    const trainersStr = document.getElementById('liveTrainersInput').value;
    
    if(!start || !days) return alert("Please fill in start date and duration.");
    
    // Parse Trainers
    const trainers = trainersStr.split(',').map(t => t.trim()).filter(t => t.length > 0);
    if (trainers.length === 0) return alert("Please specify at least one trainer.");

    // Capture Active Slots
    const activeSlots = [];
    ["1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"].forEach(slot => {
        const cb = document.getElementById(`slot_${slot.replace(/[: ]/g, '')}`);
        if(cb && cb.checked) activeSlots.push(slot);
    });

    if(activeSlots.length === 0) return alert("Please select at least one time slot.");

    const liveSchedules = JSON.parse(localStorage.getItem('liveSchedules'));
    liveSchedules[ACTIVE_LIVE_SCHED_ID].startDate = start;
    liveSchedules[ACTIVE_LIVE_SCHED_ID].days = days;
    liveSchedules[ACTIVE_LIVE_SCHED_ID].activeSlots = activeSlots;
    liveSchedules[ACTIVE_LIVE_SCHED_ID].trainers = trainers;

    localStorage.setItem('liveSchedules', JSON.stringify(liveSchedules));
    
    await secureScheduleSave();
    renderLiveTable();
    alert("Schedule settings updated.");
}

async function clearLiveBookings() {
    if(!confirm("Are you sure? This will remove ALL booking history.")) return;

    const btn = document.activeElement;
    if(btn) { btn.disabled = true; btn.innerText = 'Clearing...'; }

    try {
        const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
        if (bookings.length > 0 && typeof hardDelete === 'function') {
            for (const booking of bookings) {
                // This will send a standard DELETE event for each booking, which all clients can process.
                await hardDelete('live_bookings', booking.id);
            }
        }
        
        localStorage.setItem('liveBookings', '[]');
        localStorage.setItem('cancellationCounts', '{}'); 
        
        if(typeof saveToServer === 'function') await saveToServer(['cancellationCounts'], true);
        
        renderLiveTable();
        alert("Bookings cleared.");
    } finally {
        if(btn) { btn.disabled = false; btn.innerText = 'Reset All Bookings'; }
    }
}

// --- UTILS & HELPERS FOR SCHEDULE ---

function switchScheduleTab(id) {
    ACTIVE_SCHED_ID = id;
    renderSchedule();
}

async function createNewSchedule() {
    const schedules = JSON.parse(localStorage.getItem('schedules'));
    const keys = Object.keys(schedules).sort();
    const lastKey = keys[keys.length - 1];
    const nextKey = String.fromCharCode(lastKey.charCodeAt(0) + 1);
    
    if (confirm(`Create new Schedule Group '${nextKey}'?`)) {
        schedules[nextKey] = { items: [], assigned: null };
        localStorage.setItem('schedules', JSON.stringify(schedules));
        await secureScheduleSave();
        ACTIVE_SCHED_ID = nextKey;
        renderSchedule();
    }
}

async function assignRosterToSchedule(schedId) {
    const select = document.getElementById('schedAssignSelect');
    const groupId = select.value;
    if (!groupId) return alert("Please select a group.");

    const schedules = JSON.parse(localStorage.getItem('schedules'));
    const conflict = Object.keys(schedules).find(k => schedules[k].assigned === groupId);
    if (conflict) {
        if (!confirm(`Group '${groupId}' is already assigned to Schedule ${conflict}. Move it here?`)) return;
        schedules[conflict].assigned = null; 
    }

    schedules[schedId].assigned = groupId;
    localStorage.setItem('schedules', JSON.stringify(schedules));
    await secureScheduleSave();
    renderSchedule();
}

async function clearAssignment(schedId) {
    if(!confirm("Clear assignment?")) return;
    const schedules = JSON.parse(localStorage.getItem('schedules'));
    schedules[schedId].assigned = null;
    localStorage.setItem('schedules', JSON.stringify(schedules));
    await secureScheduleSave();
    renderSchedule();
}

function populateScheduleDropdown(elementId) {
    const select = document.getElementById(elementId);
    if(!select) return;
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    select.innerHTML = '<option value="">-- Select Group --</option>';
    Object.keys(rosters).sort().reverse().forEach(gid => {
        const label = (typeof getGroupLabel === 'function') ? getGroupLabel(gid, rosters[gid].length) : gid;
        select.add(new Option(label, gid));
    });
}

function getTraineeScheduleId(username, schedules) {
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    let myGroupId = null;
    for (const [gid, members] of Object.entries(rosters)) {
        if (members.some(m => m.toLowerCase() === username.toLowerCase())) { myGroupId = gid; break; }
    }
    if (!myGroupId) return null;
    return Object.keys(schedules).find(key => schedules[key].assigned === myGroupId) || null;
}

// Timeline Item Editing (CRUD)
async function addTimelineItem() {
    const schedules = JSON.parse(localStorage.getItem('schedules'));
    schedules[ACTIVE_SCHED_ID].items.push({
        dateRange: new Date().toISOString().split('T')[0].replace(/-/g, '/'),
        courseName: "New Item", materialLink: "", dueDate: "", openTime: "08:00", closeTime: "17:00"
    });
    localStorage.setItem('schedules', JSON.stringify(schedules));
    // Force save new item
    if(typeof saveToServer === 'function') await saveToServer(['schedules'], true);
    renderSchedule();
    editTimelineItem(schedules[ACTIVE_SCHED_ID].items.length - 1);
}

async function deleteTimelineItem(index) {
    if(!confirm("Delete this item?")) return;
    const schedules = JSON.parse(localStorage.getItem('schedules'));
    schedules[ACTIVE_SCHED_ID].items.splice(index, 1);
    localStorage.setItem('schedules', JSON.stringify(schedules));
    // FIX: Use force=true to prevent ghost data (merge restoring deleted item)
    if(typeof saveToServer === 'function') await saveToServer(['schedules'], true);
    renderSchedule();
}

function editTimelineItem(index) {
    const schedules = JSON.parse(localStorage.getItem('schedules'));
    const item = schedules[ACTIVE_SCHED_ID].items[index];
    document.getElementById('editStepIndex').value = index;
    document.getElementById('editStepType').value = ACTIVE_SCHED_ID; 
    document.getElementById('editDateRange').value = item.dateRange;
    document.getElementById('editCourseName').value = item.courseName;
    document.getElementById('editMaterialLink').value = item.materialLink;
    document.getElementById('editMaterialAlways').checked = item.materialAlways || false;
    document.getElementById('editDueDate').value = item.dueDate;
    document.getElementById('editAssessmentLink').value = item.assessmentLink || "";
    document.getElementById('editStartTime').value = item.openTime || "";
    document.getElementById('editEndTime').value = item.closeTime || "";
    document.getElementById('editIgnoreTime').checked = item.ignoreTime || false;
    
    // NEW: Vetting/Live Flags
    const chkVetting = document.getElementById('editIsVetting');
    const chkLive = document.getElementById('editIsLive');
    if(chkVetting) chkVetting.checked = item.isVetting || false;
    if(chkLive) chkLive.checked = item.isLive || false;

    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const select = document.getElementById('editLinkedTest');
    select.innerHTML = '<option value="">-- None (External) --</option>';
    tests.forEach(t => select.add(new Option(t.title, t.id)));
    if (item.linkedTestId) select.value = item.linkedTestId;

    document.getElementById('scheduleModal').classList.remove('hidden');
}

async function saveScheduleItem() {
    const index = document.getElementById('editStepIndex').value;
    const schedId = document.getElementById('editStepType').value;
    const schedules = JSON.parse(localStorage.getItem('schedules'));
    const item = schedules[schedId].items[index];

    item.dateRange = document.getElementById('editDateRange').value;
    item.courseName = document.getElementById('editCourseName').value;
    item.materialLink = document.getElementById('editMaterialLink').value;
    item.materialAlways = document.getElementById('editMaterialAlways').checked;
    item.dueDate = document.getElementById('editDueDate').value;
    item.assessmentLink = document.getElementById('editAssessmentLink').value;
    item.openTime = document.getElementById('editStartTime').value;
    item.closeTime = document.getElementById('editEndTime').value;
    item.ignoreTime = document.getElementById('editIgnoreTime').checked;
    
    // NEW: Save Flags
    item.isVetting = document.getElementById('editIsVetting').checked;
    item.isLive = document.getElementById('editIsLive').checked;
    
    const linked = document.getElementById('editLinkedTest').value;
    if (linked) item.linkedTestId = linked; else delete item.linkedTestId;

    localStorage.setItem('schedules', JSON.stringify(schedules));
    await secureScheduleSave();
    document.getElementById('scheduleModal').classList.add('hidden');
    renderSchedule();
}

async function cloneSchedule(targetId) {
    const schedules = JSON.parse(localStorage.getItem('schedules'));
    const sources = Object.keys(schedules).filter(k => k !== targetId);
    if(sources.length === 0) return alert("No other schedules to copy from.");
    const sourceId = await customPrompt("Clone Schedule", `Enter the Schedule Letter to copy FROM (${sources.join(', ')}):`);
    if(!sourceId || !schedules[sourceId]) return alert("Invalid source.");

    if(confirm(`Overwrite Schedule ${targetId} with content from Schedule ${sourceId}?`)) {
        schedules[targetId].items = JSON.parse(JSON.stringify(schedules[sourceId].items));
        localStorage.setItem('schedules', JSON.stringify(schedules));
        await secureScheduleSave();
        renderSchedule();
        alert("Schedule cloned successfully.");
    }
}

async function duplicateCurrentSchedule() {
    const schedules = JSON.parse(localStorage.getItem('schedules'));
    const keys = Object.keys(schedules).sort();
    const lastKey = keys[keys.length - 1];
    const nextKey = String.fromCharCode(lastKey.charCodeAt(0) + 1);

    if(confirm(`Duplicate Schedule ${ACTIVE_SCHED_ID} to new Schedule ${nextKey}?`)) {
        schedules[nextKey] = { items: JSON.parse(JSON.stringify(schedules[ACTIVE_SCHED_ID].items)), assigned: null };
        localStorage.setItem('schedules', JSON.stringify(schedules));
        await secureScheduleSave();
        switchScheduleTab(nextKey);
    }
}

function isDateInRange(dateRangeStr, dueDateStr, specificDateStr) {
    if (dateRangeStr === "Always Available") return true;
    
    // Determine target date: specificDateStr if provided (Calendar), else today (Timeline)
    let target = "";
    if (specificDateStr) {
        target = specificDateStr.replace(/-/g, '/');
    } else {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        target = `${y}/${m}/${d}`;
    }

    let start = "", end = "";
    if (dateRangeStr.includes('-') && dateRangeStr.length > 11) {
        const parts = dateRangeStr.split('-').map(s => s.trim().replace(/-/g, '/'));
        start = parts[0]; end = parts[1];
    } else if (dateRangeStr.trim()) {
        start = dateRangeStr.trim().replace(/-/g, '/');
        end = start;
    }

    if (dueDateStr) {
        end = dueDateStr.trim().replace(/-/g, '/');
    }

    return target >= start && target <= end;
}

function getScheduleStatus(dateRangeStr, dueDateStr) {
    if (dateRangeStr === "Always Available") return 'active';
    
    // Normalize dates to YYYY/MM/DD for consistent string comparison
    const normalize = (d) => d ? d.replace(/-/g, '/').trim() : '';
    
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const today = `${y}/${m}/${d}`;
    
    let start = "", end = "";
    if (dateRangeStr.includes('-') && dateRangeStr.length > 11) {
        const parts = dateRangeStr.split('-').map(s => normalize(s));
        start = parts[0]; end = parts[1];
    } else {
        start = normalize(dateRangeStr); end = normalize(dateRangeStr);
    }

    if (dueDateStr) {
        end = normalize(dueDateStr);
    }

    if (today < start) return 'upcoming';
    if (today > end) return 'past';
    
    return 'active';
}

function isAssessmentDay(dateRangeStr, dueDateStr) {
    if (dateRangeStr === "Always Available") return true;
    
    const normalize = (d) => d ? d.replace(/-/g, '/').trim() : '';
    
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const today = `${y}/${m}/${d}`;
    
    let end = "";
    if (dateRangeStr.includes('-') && dateRangeStr.length > 11) {
        const parts = dateRangeStr.split('-').map(s => normalize(s));
        end = parts[1];
    } else {
        end = normalize(dateRangeStr);
    }

    if (dueDateStr) {
        end = normalize(dueDateStr);
    }
    
    return today === end;
}

function checkTimeAccess(openStr, closeStr, ignoreTime) {
    if (openStr && closeStr && !ignoreTime) {
        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        const [openH, openM] = openStr.split(':').map(Number);
        const [closeH, closeM] = closeStr.split(':').map(Number);
        const openMinutes = openH * 60 + openM;
        const closeMinutes = closeH * 60 + closeM;
        if (currentMinutes < openMinutes || currentMinutes > closeMinutes) return false;
    }
    return true;
}

function goToTest(testId) {
    if(CURRENT_USER.role === 'teamleader') return;
    showTab('my-tests');
}

// --- DELETE SCHEDULE ---
async function deleteSchedule(id) {
    if (!confirm(`Are you sure you want to delete Schedule ${id} and all its items? This cannot be undone.`)) return;
    
    const schedules = JSON.parse(localStorage.getItem('schedules'));
    delete schedules[id];
    
    const oldKeys = Object.keys(schedules).sort();
    const newSchedules = {};
    if (oldKeys.length === 0) {
        newSchedules["A"] = { items: [], assigned: null };
    } else {
        oldKeys.forEach((oldKey, index) => {
            const newKey = String.fromCharCode(65 + index); // 65 = 'A'
            newSchedules[newKey] = schedules[oldKey];
        });
    }
    
    // AUTHORITATIVE DELETE: Save to server first.
    if(typeof saveToServer === 'function') {
        const success = await saveToServer(['schedules'], true);
        if (!success) {
            alert("Failed to delete schedule from server. Please check connection.");
            return; // Abort on failure
        }
    }

    localStorage.setItem('schedules', JSON.stringify(newSchedules));
    
    // Switch to first available
    ACTIVE_SCHED_ID = Object.keys(newSchedules).sort()[0];
    renderSchedule();
}

// --- DRAG AND DROP HANDLERS ---
function schedDragStart(e, index) {
    DRAG_SRC_INDEX = index;
    e.dataTransfer.effectAllowed = 'move';
    e.target.style.opacity = '0.4';
}

function schedDragOver(e) {
    if (e.preventDefault) e.preventDefault(); // Necessary. Allows us to drop.
    e.dataTransfer.dropEffect = 'move';
    return false;
}

async function schedDrop(e, targetIndex) {
    if (e.stopPropagation) e.stopPropagation();
    if (DRAG_SRC_INDEX !== null && DRAG_SRC_INDEX !== targetIndex) {
        const schedules = JSON.parse(localStorage.getItem('schedules'));
        const items = schedules[ACTIVE_SCHED_ID].items;
        const item = items[DRAG_SRC_INDEX];
        items.splice(DRAG_SRC_INDEX, 1); // Remove from old
        items.splice(targetIndex, 0, item); // Insert at new
        localStorage.setItem('schedules', JSON.stringify(schedules));
        await secureScheduleSave();
        renderSchedule();
    }
    return false;
}
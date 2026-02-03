/* ================= SCHEDULE & BOOKING ENGINE ================= */

// State Tracker for Timeline
let ACTIVE_SCHED_ID = 'A'; 
let VIEW_MODE = 'list'; // 'list' or 'calendar'
let CALENDAR_MONTH = new Date();

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
            // PARAMETER 'true' = FORCE OVERWRITE (Instant)
            await saveToServer(true); 
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
        if(typeof saveToServer === 'function') saveToServer();
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

    const isAdmin = (CURRENT_USER.role === 'admin');
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
            <div style="font-weight:bold; font-size:0.9rem;">Schedule ${key}</div>
            <div style="font-size:0.75rem; color:${data.assigned ? 'var(--primary)' : 'var(--text-muted)'};">${subLabel}</div>
        </button>`;
    }).join('');
    if (isAdmin) html += `<button onclick="createNewSchedule()" style="padding: 8px 12px; border:1px dashed var(--border-color); background:transparent; cursor:pointer; border-radius:6px; color:var(--primary);" title="Create New Schedule Group"><i class="fas fa-plus"></i></button>`;
    return html;
}

function buildToolbar(scheduleData, isAdmin) {
    if (!isAdmin) {
        if (scheduleData.assigned) return `<div style="padding:10px; background:var(--bg-input); border-left:4px solid var(--primary); border-radius:4px;">Currently viewing schedule for: <strong>${(typeof getGroupLabel === 'function') ? getGroupLabel(scheduleData.assigned) : scheduleData.assigned}</strong></div>`;
        return '';
    }
    if (scheduleData.assigned) {
        const label = (typeof getGroupLabel === 'function') ? getGroupLabel(scheduleData.assigned) : scheduleData.assigned;
        return `<div style="display:flex; justify-content:space-between; align-items:center; padding:15px; background:rgba(39, 174, 96, 0.1); border:1px solid #27ae60; border-radius:6px;"><div><i class="fas fa-check-circle" style="color:#27ae60; margin-right:5px;"></i> Assigned to: <strong>${label}</strong></div><button class="btn-danger btn-sm" onclick="clearAssignment('${ACTIVE_SCHED_ID}')">Completed / Clear</button></div>`;
    } else {
        return `<div style="display:flex; gap:10px; align-items:center; padding:15px; background:var(--bg-card); border:1px dashed var(--border-color); border-radius:6px;"><i class="fas fa-exclamation-circle" style="color:orange;"></i><span style="margin-right:auto;">This schedule is currently empty/inactive. Assign a roster to start.</span><select id="schedAssignSelect" class="form-control" style="width:250px; margin:0;"><option value="">Loading Groups...</option></select><button class="btn-primary btn-sm" onclick="assignRosterToSchedule('${ACTIVE_SCHED_ID}')">Assign Roster</button><button class="btn-secondary btn-sm" onclick="cloneSchedule('${ACTIVE_SCHED_ID}')" title="Copy from another schedule"><i class="fas fa-copy"></i></button></div>`;
    }
}

function buildTimeline(items, isAdmin) {
    let timelineHTML = '';
    if (!items || items.length === 0) {
        timelineHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted);">No timeline items yet.</div>`;
    } else {
        timelineHTML = items.map((item, index) => {
            const status = getScheduleStatus(item.dateRange, item.openTime, item.closeTime);
            let timelineClass = 'schedule-upcoming';
            if (status === 'active') timelineClass = 'schedule-active';
            else if (status === 'past') timelineClass = 'schedule-past';

            let actions = '';
            if (isAdmin) {
                actions = `
                    <button class="btn-edit-sched" onclick="editTimelineItem(${index})" aria-label="Edit Item"><i class="fas fa-pen"></i></button>
                    <button class="btn-danger btn-sm" onclick="deleteTimelineItem(${index})" aria-label="Delete Item" style="margin-left:5px;"><i class="fas fa-trash"></i></button>
                `;
            } else {
                if (item.linkedTestId) {
                    if (status === 'upcoming') actions = `<button class="btn-start-test disabled" aria-label="Locked"><i class="fas fa-lock"></i> Locked</button>`;
                    else if (status === 'past') actions = `<button class="btn-start-test disabled" aria-label="Closed"><i class="fas fa-history"></i> Closed</button>`;
                    else actions = `<button class="btn-start-test" onclick="goToTest(${item.linkedTestId})" aria-label="Take Test">Take Assessment</button>`;
                } else if (item.assessmentLink) {
                    if (status === 'upcoming') {
                           actions = `<span class="btn-link-external disabled" style="opacity:0.5; cursor:not-allowed;">Locked <i class="fas fa-lock"></i></span>`;
                    } else {
                           actions = `<a href="${item.assessmentLink}" target="_blank" class="btn-link-external" aria-label="External Link">Open Link <i class="fas fa-external-link-alt"></i></a>`;
                    }
                }
            }

            const timeInfo = (item.openTime || item.closeTime) ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;"><i class="fas fa-clock"></i> Access: ${item.openTime || '00:00'} - ${item.closeTime || '23:59'}</div>` : '';

            // --- MATERIAL LINK LOGIC (UPDATED) ---
            let materialLinkHtml = '';
            if (item.materialLink) {
                if (status === 'upcoming' && !isAdmin) {
                    // Render as disabled non-clickable text for Trainees
                    materialLinkHtml = `<div style="margin-top:10px;"><span class="btn-link" style="font-size:0.9rem; cursor:not-allowed; opacity:0.5; color:var(--text-muted);"><i class="fas fa-lock"></i> Study Material (Locked)</span></div>`;
                } else {
                    // Render standard link
                    materialLinkHtml = `<div style="margin-top:10px;"><a href="${item.materialLink}" target="_blank" class="btn-link" style="font-size:0.9rem;"><i class="fas fa-book-open"></i> Study Material</a></div>`;
                }
            }
            // -------------------------------------

            return `<div class="timeline-item ${timelineClass}" style="position:relative; padding-left:20px; border-left:2px solid var(--border-color); margin-bottom:20px;">
                <div class="timeline-marker"></div> 
                <div class="timeline-content" style="background:var(--bg-input); padding:15px; border-radius:8px; border:1px solid var(--border-color);">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <div><span class="timeline-date" style="font-size:0.8rem; font-weight:bold; color:var(--primary);">${item.dateRange}</span><h4 style="margin:5px 0;">${item.courseName}</h4>${timeInfo}</div>
                        <div>${actions}</div>
                    </div>
                    ${materialLinkHtml}
                </div>
            </div>`;
        }).join('');
    }

    if (isAdmin) {
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
        const dayItems = items.filter(item => isDateInRange(item.dateRange, dateStr));
        
        let itemsHtml = dayItems.map(item => `
            <div style="font-size:0.7rem; background:var(--primary-soft); color:var(--primary); padding:2px 4px; border-radius:3px; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${item.courseName}">
                ${item.courseName}
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

function renderLiveTable() {
    const tbody = document.getElementById('liveBookingBody');
    if(!tbody) return;
    
    // --- FOCUS PROTECTION ---
    // If the booking modal is open, do not re-render the table underneath it,
    // as it might cause visual glitches.
    if (!document.getElementById('bookingModal').classList.contains('hidden')) {
        return;
    }

    // 1. Get Settings & Data
    const settings = JSON.parse(localStorage.getItem('liveScheduleSettings') || '{"days":5}');
    const startDate = settings.startDate ? settings.startDate : new Date().toISOString().split('T')[0];
    const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
    
    // 2. Admin Controls Visibility
    if(CURRENT_USER.role === 'admin') {
        document.querySelector('#live-assessment .admin-only').classList.remove('hidden');
        document.getElementById('liveStartDate').value = startDate;
        document.getElementById('liveNumDays').value = settings.days;
    } else {
        document.querySelector('#live-assessment .admin-only').classList.add('hidden');
    }

    // 3. Generate Valid Dates (Skipping Weekends/Holidays)
    const validDays = getNextBusinessDays(startDate, parseInt(settings.days) || 5);

    // 4. Define Slots
    const timeSlots = ["1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"];
    const trainers = ["Trainer 1", "Trainer 2"];

    let html = '';

    validDays.forEach(d => {
        const dayStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const dateKey = d.toISOString().split('T')[0];

        html += `<tr><td style="background:var(--bg-input); border-right:2px solid var(--border-color); vertical-align:middle;">
            <strong>${dayStr}</strong><br><span style="font-size:0.8rem; color:var(--text-muted);">${dateKey}</span>
        </td>`;

        timeSlots.forEach(time => {
            html += `<td style="vertical-align:top; padding:5px;">`;
            
            // Render Both Trainer Slots per Time Cell
            trainers.forEach(trainer => {
                const slotId = `${dateKey}_${time}_${trainer.replace(' ','')}`;
                
                // Find booking for this SPECIFIC slot (Trainer + Time + Date)
                const booking = bookings.find(b => 
                    b.date === dateKey && 
                    b.time === time && 
                    b.trainer === trainer &&
                    b.status !== 'Cancelled'
                );

                const isTaken = !!booking;
                const isMine = booking && booking.trainee === CURRENT_USER.user;
                const isCompleted = booking && booking.status === 'Completed';

                let slotHtml = '';
                
                // HEADER FOR TRAINER
                slotHtml += `<div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:2px; font-weight:bold; text-transform:uppercase;">${trainer}</div>`;

                if (isTaken) {
                    // BOOKED STATE
                    let statusClass = isMine ? 'mine' : 'taken';
                    if (isCompleted) statusClass = 'completed';

                    // Info Display
                    let info = '';
                    if (isMine || CURRENT_USER.role === 'admin') {
                        info = `<div style="font-weight:bold; font-size:0.85rem;">${booking.trainee}</div>
                                <div style="font-size:0.75rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${booking.assessment}</div>`;
                    } else {
                        info = `<div style="font-style:italic; color:var(--text-muted);">Booked</div>`;
                    }

                    // Actions
                    let actions = '';
                    if (CURRENT_USER.role === 'admin') {
                        // Admin: Cancel OR Mark Complete
                        if(!isCompleted) {
                            actions += `<button class="btn-success btn-sm" style="padding:2px 6px; margin-right:5px;" onclick="markBookingComplete('${booking.id}')" title="Mark Complete"><i class="fas fa-check"></i></button>`;
                        }
                        actions += `<button class="btn-danger btn-sm" style="padding:2px 6px;" onclick="cancelBooking('${booking.id}')" title="Cancel"><i class="fas fa-times"></i></button>`;
                    } else if (isMine && !isCompleted) {
                        // User: Cancel only
                        actions += `<button class="btn-cancel" onclick="cancelBooking('${booking.id}')">Cancel</button>`;
                    }

                    slotHtml += `
                        <div class="slot-item ${statusClass}" style="margin-bottom:8px;">
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
                            slotHtml += `<div style="padding:5px; background:var(--bg-input); border-radius:4px; color:var(--text-muted); font-size:0.75rem; text-align:center; margin-bottom:8px;">Slot Limit</div>`;
                        } else {
                            // Available to book
                            slotHtml += `<button class="btn-slot btn-book" style="margin-bottom:8px;" onclick="openBookingModal('${dateKey}', '${time}', '${trainer}')">+ Book</button>`;
                        }
                    } else {
                         // Admin sees empty
                         slotHtml += `<div style="padding:10px; border:1px dashed var(--border-color); border-radius:4px; margin-bottom:8px; text-align:center; color:var(--text-muted); font-size:0.7rem;">Available</div>`;
                    }
                }

                html += slotHtml;
            });

            html += `</td>`;
        });
        html += `</tr>`;
    });

    tbody.innerHTML = html;
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
    // PULLS DYNAMICALLY FROM ADMIN-EDITABLE LIST
    const assessSelect = document.getElementById('bookingAssessment');
    assessSelect.innerHTML = '';
    const assessments = JSON.parse(localStorage.getItem('assessments') || '[]');
    const liveAssessments = assessments.filter(a => a.live); 
    
    if(liveAssessments.length === 0) {
        assessSelect.innerHTML = '<option>No Live Assessments Configured</option>';
    } else {
        liveAssessments.forEach(a => {
            assessSelect.add(new Option(a.name, a.name));
        });
    }

    modal.classList.remove('hidden');
}

function closeBookingModal() {
    document.getElementById('bookingModal').classList.add('hidden');
    PENDING_BOOKING = null;
}

// UPDATED: CONFIRM BOOKING WITH CONFLICT DETECTION
async function confirmBooking() {
    if(!PENDING_BOOKING) return;
    
    const assess = document.getElementById('bookingAssessment').value;
    if(!assess) return alert("Select an assessment.");

    // UI FEEDBACK: Prevent double clicks
    const btn = document.querySelector('#bookingModal .btn-primary');
    if(btn) { btn.innerText = "Checking Availability..."; btn.disabled = true; }

    try {
        // 1. CRITICAL: Force Sync before validating to prevent double-booking
        // This pulls the very latest bookings from the cloud (Smart Merge).
        if(typeof loadFromServer === 'function') {
            await loadFromServer(true); 
        }

        // 2. Re-Read Data (It might have changed after the sync)
        const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
        
        // VALIDATION 1: Slot Taken? (Specific Trainer Slot)
        const isSlotTaken = bookings.some(b => 
            b.date === PENDING_BOOKING.date && 
            b.time === PENDING_BOOKING.time && 
            b.trainer === PENDING_BOOKING.trainer &&
            b.status !== 'Cancelled'
        );
        if(isSlotTaken) {
            alert("This slot was just taken by another user. Please choose another time.");
            closeBookingModal(); renderLiveTable(); return;
        }

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

        bookings.push(newBooking);
        localStorage.setItem('liveBookings', JSON.stringify(bookings));
        
        // --- CLOUD SYNC (INSTANT OVERWRITE) ---
        await secureScheduleSave();
        
        closeBookingModal();
        renderLiveTable();
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
    }
    
    localStorage.setItem('liveBookings', JSON.stringify(bookings));
    await secureScheduleSave();
    renderLiveTable();
}

async function markBookingComplete(id) {
    let bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
    const target = bookings.find(b => b.id === id);
    if(target) {
        target.status = 'Completed';
    }
    localStorage.setItem('liveBookings', JSON.stringify(bookings));
    await secureScheduleSave();
    renderLiveTable();
}

// --- ADMIN SETTINGS ---

async function generateLiveTable() {
    const start = document.getElementById('liveStartDate').value;
    const days = document.getElementById('liveNumDays').value;
    
    if(!start || !days) return alert("Please fill in start date and duration.");
    
    const settings = { startDate: start, days: days };
    localStorage.setItem('liveScheduleSettings', JSON.stringify(settings));
    
    await secureScheduleSave();
    renderLiveTable();
    alert("Schedule settings updated.");
}

async function clearLiveBookings() {
    if(!confirm("Are you sure? This will remove ALL booking history.")) return;
    
    // BUG FIX: Aggressive wipe for "Reset Persistence"
    localStorage.setItem('liveBookings', '[]');
    localStorage.setItem('cancellationCounts', '{}'); 
    
    await secureScheduleSave();
    
    renderLiveTable();
    alert("Bookings cleared.");
}

// --- UTILS & HELPERS FOR SCHEDULE ---

function switchScheduleTab(id) {
    ACTIVE_SCHED_ID = id;
    renderSchedule();
}

async function createNewSchedule() {
    const schedules = JSON.parse(localStorage.getItem('schedules'));
    const keys = Object.keys(schedules);
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
        if (members.includes(username)) { myGroupId = gid; break; }
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
    await secureScheduleSave();
    renderSchedule();
    editTimelineItem(schedules[ACTIVE_SCHED_ID].items.length - 1);
}

async function deleteTimelineItem(index) {
    if(!confirm("Delete this item?")) return;
    const schedules = JSON.parse(localStorage.getItem('schedules'));
    schedules[ACTIVE_SCHED_ID].items.splice(index, 1);
    localStorage.setItem('schedules', JSON.stringify(schedules));
    await secureScheduleSave();
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
    document.getElementById('editDueDate').value = item.dueDate;
    document.getElementById('editAssessmentLink').value = item.assessmentLink || "";
    document.getElementById('editStartTime').value = item.openTime || "";
    document.getElementById('editEndTime').value = item.closeTime || "";

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
    item.dueDate = document.getElementById('editDueDate').value;
    item.assessmentLink = document.getElementById('editAssessmentLink').value;
    item.openTime = document.getElementById('editStartTime').value;
    item.closeTime = document.getElementById('editEndTime').value;
    
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
    const sourceId = prompt(`Enter the Schedule Letter to copy FROM (${sources.join(', ')}):`);
    if(!sourceId || !schedules[sourceId]) return alert("Invalid source.");

    if(confirm(`Overwrite Schedule ${targetId} with content from Schedule ${sourceId}?`)) {
        schedules[targetId].items = JSON.parse(JSON.stringify(schedules[sourceId].items));
        localStorage.setItem('schedules', JSON.stringify(schedules));
        await secureScheduleSave();
        renderSchedule();
        alert("Schedule cloned successfully.");
    }
}

function isDateInRange(dateRangeStr, specificDateStr) {
    if (dateRangeStr === "Always Available") return true;
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '/');
    if (dateRangeStr.includes('-')) {
        const parts = dateRangeStr.split('-').map(s => s.trim());
        if(parts.length === 2) { return today >= parts[0] && today <= parts[1]; }
    } else if (dateRangeStr.trim()) {
        return dateRangeStr.trim() === today || specificDateStr === today;
    }
    return false;
}

function getScheduleStatus(dateRangeStr, openStr, closeStr) {
    if (dateRangeStr === "Always Available") return 'active';
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '/');
    let start = "", end = "";
    if (dateRangeStr.includes('-')) {
        const parts = dateRangeStr.split('-').map(s => s.trim());
        start = parts[0]; end = parts[1];
    } else {
        start = dateRangeStr.trim(); end = dateRangeStr.trim();
    }

    if (today < start) return 'upcoming';
    if (today > end) return 'past';
    
    if (openStr && closeStr) {
        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        const [openH, openM] = openStr.split(':').map(Number);
        const [closeH, closeM] = closeStr.split(':').map(Number);
        const openMinutes = openH * 60 + openM;
        const closeMinutes = closeH * 60 + closeM;

        if (currentMinutes < openMinutes) return 'upcoming';
        if (currentMinutes > closeMinutes) return 'past';
    }
    return 'active';
}

function goToTest(testId) {
    if(CURRENT_USER.role === 'teamleader') return;
    showTab('my-tests');
}
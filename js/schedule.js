/* ================= SCHEDULE & BOOKING ENGINE ================= */
/* NOTE: Timeline editing UI now runs in modules/schedule_studio via schedule_studio_loader.js.
   This file remains authoritative for legacy helpers and Live Assessment Booking behavior. */

// State Tracker for Timeline
let ACTIVE_SCHED_ID = 'A'; 
let ACTIVE_LIVE_SCHED_ID = 'A'; // NEW: Track Live Schedule Tab
let VIEW_MODE = 'list'; // 'list' or 'calendar'
let LIVE_SCHEDULE_REALTIME_UNSUB = null; // Realtime subscription handler
let DRAG_SRC_INDEX = null; // Track item being dragged
let CALENDAR_MONTH = new Date();
window.IS_DRAGGING_LIVE = false; // Global lock for drag operations

// --- NEW: URL CLEANER FOR SHAREPOINT ---
function cleanSharePointUrl(url) {
    const raw = String(url || '').trim().replace(/^<|>$/g, '');
    if (!raw) return '';

    try {
        const parsed = new URL(raw);
        const host = parsed.hostname.toLowerCase();
        if (host.includes('safelinks.protection.outlook.com')) {
            const safeTarget = parsed.searchParams.get('url') || parsed.searchParams.get('u') || '';
            if (safeTarget) {
                let decoded = safeTarget;
                for (let i = 0; i < 2; i++) {
                    try { decoded = decodeURIComponent(decoded); } catch (e) { break; }
                }
                if (/^https?:\/\//i.test(decoded)) return decoded;
            }
        }
        const isMicrosoftLink =
            host.includes('sharepoint.com') ||
            host.includes('onedrive.com') ||
            host.includes('microsoftonline.com') ||
            host.includes('office.com') ||
            host.includes('safelinks.protection.outlook.com');

        // User request: keep Microsoft links exactly as provided.
        if (isMicrosoftLink) return raw;
        return parsed.toString();
    } catch (e) {
        return raw; // Return original if URL is malformed
    }
}

function migrateLegacySharePointLinksInSchedules() {
    try {
        const schedules = JSON.parse(localStorage.getItem('schedules') || '{}');
        if (!schedules || typeof schedules !== 'object') return;

        let touched = false;
        Object.keys(schedules).forEach(key => {
            const group = schedules[key];
            if (!group || !Array.isArray(group.items)) return;
            group.items.forEach(item => {
                if (!item || typeof item !== 'object') return;
                const nextMaterial = cleanSharePointUrl(item.materialLink || '');
                const nextAssessment = cleanSharePointUrl(item.assessmentLink || '');
                if (nextMaterial !== (item.materialLink || '')) {
                    item.materialLink = nextMaterial;
                    touched = true;
                }
                if (nextAssessment !== (item.assessmentLink || '')) {
                    item.assessmentLink = nextAssessment;
                    touched = true;
                }
            });
        });

        if (touched) {
            localStorage.setItem('schedules', JSON.stringify(schedules));
            if (typeof saveToServer === 'function') saveToServer(['schedules'], false);
        }
    } catch (e) {
        console.warn('Schedule URL migration skipped:', e);
    }
}

function migrateScheduleDurationMetadata() {
    try {
        const schedules = JSON.parse(localStorage.getItem('schedules') || '{}');
        if (!schedules || typeof schedules !== 'object') return;

        let touched = false;
        Object.keys(schedules).forEach(key => {
            const group = schedules[key];
            if (!group || !Array.isArray(group.items)) return;

            group.items.forEach(item => {
                if (!item || typeof item !== 'object') return;
                if (normalizeDurationDays(item.durationDays)) return;
                const inferred = inferScheduleDurationDays(item);
                if (inferred) {
                    item.durationDays = inferred;
                    touched = true;
                }
            });
        });

        if (touched) {
            localStorage.setItem('schedules', JSON.stringify(schedules));
            if (typeof saveToServer === 'function') saveToServer(['schedules'], false);
        }
    } catch (e) {
        console.warn('Schedule duration migration skipped:', e);
    }
}

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
const SCHEDULE_TEMPLATE_STORAGE_KEY = 'scheduleTemplates';
const SCHEDULE_HOLIDAY_STORAGE_KEY = 'scheduleHolidays';
const SCHEDULE_TEMPLATE_MANAGER_MODAL_ID = 'scheduleTemplateManagerModal';
const NEW_SCHEDULE_TEMPLATE_PROMPT_ID = 'newScheduleTemplatePromptModal';
let SCHEDULE_TEMPLATE_EDITOR_STATE = null;

function isScheduleTemplateAdmin() {
    return !!(CURRENT_USER && (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin'));
}

function ensureScheduleTemplateAdmin(actionText) {
    if (isScheduleTemplateAdmin()) return true;
    alert(`Only admins can ${actionText || 'manage schedule templates'}.`);
    return false;
}

function formatScheduleDateDash(dateObj) {
    if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatScheduleDateSlash(dateObj) {
    return formatScheduleDateDash(dateObj).replace(/-/g, '/');
}

function parseScheduleDateStrict(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const normalized = raw.replace(/\./g, '/').replace(/-/g, '/');
    const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const candidate = new Date(year, month - 1, day);
    if (
        candidate.getFullYear() !== year ||
        candidate.getMonth() !== (month - 1) ||
        candidate.getDate() !== day
    ) {
        return null;
    }
    candidate.setHours(12, 0, 0, 0);
    return candidate;
}

function normalizeScheduleDateString(value, separator = '/') {
    const parsed = parseScheduleDateStrict(value);
    if (!parsed) return '';
    return separator === '-' ? formatScheduleDateDash(parsed) : formatScheduleDateSlash(parsed);
}

function extractScheduleDates(dateRangeStr) {
    const raw = String(dateRangeStr || '').trim();
    if (!raw) return [];
    if (/^always available$/i.test(raw) || /^no dates set$/i.test(raw)) return [];
    const matches = raw.match(/\d{4}[\/-]\d{1,2}[\/-]\d{1,2}/g);
    return matches && matches.length ? matches : [raw];
}

function getScheduleStartDateFromRange(dateRangeStr, outputSeparator = '-') {
    const dateTokens = extractScheduleDates(dateRangeStr);
    if (!dateTokens.length) return '';
    return normalizeScheduleDateString(dateTokens[0], outputSeparator);
}

function normalizeDurationDays(value) {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function getConfiguredScheduleHolidays() {
    let saved = [];
    try {
        saved = JSON.parse(localStorage.getItem(SCHEDULE_HOLIDAY_STORAGE_KEY) || '[]');
    } catch (e) {
        saved = [];
    }
    if (!Array.isArray(saved) || saved.length === 0) return new Set(SA_HOLIDAYS);
    const merged = [...new Set([...SA_HOLIDAYS, ...saved.map(v => String(v || '').trim()).filter(Boolean)])];
    return new Set(merged);
}

function moveToBusinessDay(dateObj) {
    if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return null;
    const current = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 12, 0, 0, 0);
    let attempts = 0;
    while (!isBusinessDay(current) && attempts < 370) {
        current.setDate(current.getDate() + 1);
        attempts++;
    }
    return current;
}

function getBusinessDayEndDate(startDateObj, durationDays) {
    const normalizedDuration = normalizeDurationDays(durationDays) || 1;
    const start = moveToBusinessDay(startDateObj);
    if (!start) return null;

    let end = new Date(start);
    let counted = 1;
    let attempts = 0;
    while (counted < normalizedDuration && attempts < 4000) {
        end.setDate(end.getDate() + 1);
        if (isBusinessDay(end)) counted++;
        attempts++;
    }
    return end;
}

function calculateScheduleWindow(startDateInput, durationDays) {
    const parsedStart = parseScheduleDateStrict(startDateInput);
    if (!parsedStart) return null;

    const startDate = moveToBusinessDay(parsedStart);
    if (!startDate) return null;

    const normalizedDuration = normalizeDurationDays(durationDays) || 1;
    const endDate = getBusinessDayEndDate(startDate, normalizedDuration);
    if (!endDate) return null;

    const startDateDash = formatScheduleDateDash(startDate);
    const startDateSlash = formatScheduleDateSlash(startDate);
    const endDateDash = formatScheduleDateDash(endDate);
    const endDateSlash = formatScheduleDateSlash(endDate);
    const dateRange = normalizedDuration > 1 ? `${startDateSlash} - ${endDateSlash}` : startDateSlash;
    return {
        startDateDash,
        startDateSlash,
        endDateDash,
        endDateSlash,
        dateRange,
        dueDate: endDateSlash
    };
}

function getNextBusinessDate(dateObj) {
    if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return null;
    const next = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 12, 0, 0, 0);
    next.setDate(next.getDate() + 1);
    return moveToBusinessDay(next);
}

function inferScheduleDurationDays(item) {
    if (!item || typeof item !== 'object') return null;
    const explicit = normalizeDurationDays(item.durationDays);
    if (explicit) return explicit;

    const dateTokens = extractScheduleDates(item.dateRange);
    const startDate = parseScheduleDateStrict(dateTokens[0] || '');
    if (!startDate) return null;

    const endToken = item.dueDate || dateTokens[1] || dateTokens[0];
    let endDate = parseScheduleDateStrict(endToken);
    if (!endDate) return null;
    if (endDate < startDate) endDate = new Date(startDate);

    const cursor = new Date(startDate);
    let count = 0;
    let attempts = 0;
    while (cursor <= endDate && attempts < 4000) {
        if (isBusinessDay(cursor)) count++;
        cursor.setDate(cursor.getDate() + 1);
        attempts++;
    }
    return count > 0 ? count : 1;
}

function getTodayScheduleDateDash() {
    return formatScheduleDateDash(new Date());
}

function getTodayOrNextBusinessDateDash() {
    const next = moveToBusinessDay(new Date());
    return next ? formatScheduleDateDash(next) : getTodayScheduleDateDash();
}

// One-time repair and data enrichment patches.
if (!localStorage.getItem('v259_schedule_link_sanitizer_patch')) {
    migrateLegacySharePointLinksInSchedules();
    localStorage.setItem('v259_schedule_link_sanitizer_patch', 'true');
}
if (!localStorage.getItem('v260_schedule_link_unwrap_patch')) {
    migrateLegacySharePointLinksInSchedules();
    localStorage.setItem('v260_schedule_link_unwrap_patch', 'true');
}
if (!localStorage.getItem('v261_schedule_duration_patch')) {
    migrateScheduleDurationMetadata();
    localStorage.setItem('v261_schedule_duration_patch', 'true');
}

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

function isLiveBookingManager() {
    return !!(CURRENT_USER && (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin'));
}

function isLiveBookingViewer() {
    return !!(CURRENT_USER && ['admin', 'super_admin', 'teamleader', 'special_viewer'].includes(CURRENT_USER.role));
}

function normalizeScheduleText(value) {
    return String(value || '').trim().toLowerCase();
}

function isSameScheduleValue(a, b) {
    return normalizeScheduleText(a) === normalizeScheduleText(b);
}

function createLiveBookingId() {
    return `lb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeHtmlAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

function escapeInlineJs(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r?\n/g, ' ');
}

function buildLiveAssessmentCatalog() {
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const byId = new Map();
    const byTitle = new Map();

    tests.forEach(test => {
        if (!test || test.type !== 'live') return;
        const id = String(test.id || '');
        const title = String(test.title || '').trim();
        if (!title) return;

        const key = normalizeScheduleText(title);
        const entry = { id, title, key };
        byId.set(id, entry);

        if (!byTitle.has(key)) {
            byTitle.set(key, entry);
        }
    });

    return { byId, byTitle };
}

function getSelectedAssessmentMeta(selectEl) {
    if (!selectEl) return { id: null, title: '' };
    const selected = selectEl.options[selectEl.selectedIndex];
    if (!selected) return { id: null, title: '' };
    return {
        id: selected.dataset.testId || null,
        title: selected.value || selected.text || ''
    };
}

function hydrateBookingAssessmentIds(bookings, catalog) {
    if (!Array.isArray(bookings) || !catalog) return false;
    let touched = false;
    bookings.forEach(booking => {
        if (!booking || booking.assessmentId) return;
        const mapped = catalog.byTitle.get(normalizeScheduleText(booking.assessment));
        if (mapped && mapped.id) {
            booking.assessmentId = mapped.id;
            touched = true;
        }
    });
    return touched;
}

function bookingMatchesTrainee(booking, traineeName) {
    return isSameScheduleValue(booking && booking.trainee, traineeName);
}

function bookingMatchesAssessment(booking, assessmentMeta) {
    if (!booking || !assessmentMeta) return false;
    if (assessmentMeta.id && booking.assessmentId && String(booking.assessmentId) === String(assessmentMeta.id)) return true;
    return isSameScheduleValue(booking.assessment, assessmentMeta.title);
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

    const isStaffScheduleViewer = (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin' || CURRENT_USER.role === 'special_viewer' || CURRENT_USER.role === 'teamleader');
    const isTrainee = CURRENT_USER.role === 'trainee';

    let visibleScheduleIds = Object.keys(schedules).sort();
    if (isTrainee) {
        const mySchedId = getTraineeScheduleId(CURRENT_USER.user, schedules);
        if (!mySchedId) {
            container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-muted);"><i class="fas fa-calendar-times" style="font-size:3rem; margin-bottom:15px;"></i><br>No schedule has been assigned to your group yet.</div>`;
            return;
        }
        visibleScheduleIds = [mySchedId];
        ACTIVE_SCHED_ID = mySchedId;
    }

    const visibleSchedules = {};
    visibleScheduleIds.forEach(id => {
        if (schedules[id]) visibleSchedules[id] = schedules[id];
    });

    const tabsHtml = buildTabs(visibleSchedules, isStaffScheduleViewer);
    const toolbarHtml = buildToolbar(schedules[ACTIVE_SCHED_ID], isStaffScheduleViewer);
    
    // View Switcher
    const viewToggler = `
        <div style="display:flex; justify-content:flex-end; margin-bottom:10px; gap:5px;">
            <button class="btn-secondary ${VIEW_MODE==='list'?'active':''}" onclick="switchViewMode('list')" style="padding:5px 10px;"><i class="fas fa-list"></i> List</button>
            <button class="btn-secondary ${VIEW_MODE==='calendar'?'active':''}" onclick="switchViewMode('calendar')" style="padding:5px 10px;"><i class="fas fa-calendar-alt"></i> Calendar</button>
        </div>
    `;

    let contentHtml = '';
    if(VIEW_MODE === 'calendar') {
        contentHtml = buildCalendar(schedules[ACTIVE_SCHED_ID].items, isStaffScheduleViewer, { useGlobalEvents: !isTrainee });
    } else {
        contentHtml = buildTimeline(schedules[ACTIVE_SCHED_ID].items, isStaffScheduleViewer);
    }

    container.innerHTML = `
        <div class="sched-tabs-container" style="display:flex; gap:5px; border-bottom:1px solid var(--border-color); padding-bottom:10px; margin-bottom:15px; overflow-x:auto;">${tabsHtml}</div>
        ${viewToggler}
        <div class="sched-toolbar-wrapper" style="margin-bottom:20px;">${toolbarHtml}</div>
        <div id="scheduleTimeline" class="timeline-container">${contentHtml}</div>
    `;

    if (isStaffScheduleViewer && !schedules[ACTIVE_SCHED_ID].assigned) {
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

function buildScheduleAutomationActions() {
    // Timeline/template automation now lives in modules/schedule_studio.
    // Keep legacy schedule.js focused on live booking behavior.
    return '';
}

function buildToolbar(scheduleData, isAdmin) {
    if (!isAdmin) {
        if (scheduleData.assigned) return `<div style="padding:10px; background:var(--bg-input); border-left:4px solid var(--primary); border-radius:4px;">Currently viewing schedule for: <strong>${(typeof getGroupLabel === 'function') ? getGroupLabel(scheduleData.assigned) : scheduleData.assigned}</strong></div>`;
        return '';
    }
    if (scheduleData.assigned) {
        const label = (typeof getGroupLabel === 'function') ? getGroupLabel(scheduleData.assigned) : scheduleData.assigned;
        return `<div style="display:flex; justify-content:space-between; align-items:center; padding:15px; background:rgba(39, 174, 96, 0.1); border:1px solid #27ae60; border-radius:6px;"><div><i class="fas fa-check-circle" style="color:#27ae60; margin-right:5px;"></i> Assigned to: <strong>${label}</strong></div><div>${(CURRENT_USER.role === 'special_viewer' || CURRENT_USER.role === 'teamleader') ? '<span style="color:var(--text-muted);">View Only</span>' : `<button class="btn-secondary btn-sm" onclick="duplicateCurrentSchedule()" title="Duplicate this schedule to new" style="margin-right:5px;"><i class="fas fa-clone"></i> Duplicate</button><button class="btn-secondary btn-sm" onclick="cloneSchedule('${ACTIVE_SCHED_ID}')" title="Copy from another schedule" style="margin-right:5px;"><i class="fas fa-copy"></i> Copy From...</button><button class="btn-danger btn-sm" onclick="deleteSchedule('${ACTIVE_SCHED_ID}')" title="Delete Schedule"><i class="fas fa-trash"></i></button><button class="btn-danger btn-sm" onclick="clearAssignment('${ACTIVE_SCHED_ID}')" style="margin-left:5px;">Unassign</button>`}</div></div>${buildScheduleAutomationActions()}`;
    } else {
        return `<div style="display:flex; gap:10px; align-items:center; padding:15px; background:var(--bg-card); border:1px dashed var(--border-color); border-radius:6px;"><i class="fas fa-exclamation-circle" style="color:orange;"></i><span style="margin-right:auto;">This schedule is currently empty/inactive. Assign a roster to start.</span>${(CURRENT_USER.role === 'special_viewer' || CURRENT_USER.role === 'teamleader') ? '<span style="color:var(--text-muted);">View Only</span>' : `<select id="schedAssignSelect" class="form-control" style="width:250px; margin:0;"><option value="">Loading Groups...</option></select><button class="btn-primary btn-sm" onclick="assignRosterToSchedule('${ACTIVE_SCHED_ID}')">Assign Roster</button><button class="btn-secondary btn-sm" onclick="duplicateCurrentSchedule()" title="Duplicate this schedule to new"><i class="fas fa-clone"></i></button><button class="btn-secondary btn-sm" onclick="cloneSchedule('${ACTIVE_SCHED_ID}')" title="Copy from another schedule"><i class="fas fa-copy"></i></button><button class="btn-danger btn-sm" onclick="deleteSchedule('${ACTIVE_SCHED_ID}')" title="Delete Schedule"><i class="fas fa-trash"></i></button>`}</div>${buildScheduleAutomationActions()}`;
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
            const durationDays = inferScheduleDurationDays(item);
            const durationInfo = durationDays ? `<span style="font-size:0.75rem; color:var(--text-muted); margin-left:10px;"><i class="fas fa-business-time"></i> ${durationDays} day${durationDays === 1 ? '' : 's'}</span>` : '';

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
                        <div><span class="timeline-date" style="font-size:0.8rem; font-weight:bold; color:var(--primary);">${item.dateRange} ${dueInfo} ${durationInfo}</span><h4 style="margin:5px 0;">${item.courseName}</h4>${timeInfo}</div>
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

function buildCalendar(items, isAdmin, options = {}) {
    // Staff can use unified event feeds; trainees stay scoped to their own schedule items.
    const useGlobalEvents = Boolean(options && options.useGlobalEvents);
    let allEvents = items; // Fallback
    if (useGlobalEvents && typeof CalendarModule !== 'undefined' && typeof CalendarModule.getEvents === 'function') {
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
    if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return false;
    const day = dateObj.getDay();
    // 0 = Sunday, 6 = Saturday
    if (day === 0 || day === 6) return false;
    
    // Check Holidays
    const dateStr = formatScheduleDateDash(dateObj);
    const holidays = getConfiguredScheduleHolidays();
    if (holidays.has(dateStr)) return false;
    
    return true;
}

function getNextBusinessDays(startDateStr, count) {
    let days = [];
    const parsedStart = parseScheduleDateStrict(startDateStr) || new Date(startDateStr);
    let current = Number.isNaN(parsedStart.getTime()) ? new Date() : new Date(parsedStart);
    
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

    // Inject global refresh button for legacy layouts if missing
    let refreshContainer = document.getElementById('liveRefreshContainer');
    if (!refreshContainer && !document.querySelector('#live-assessment .workspace-table-panel')) {
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
    const canManageLive = isLiveBookingManager();
    const canViewLive = isLiveBookingViewer();
    
    if (!canViewLive) {
        // Trainee: Auto-select assigned schedule
        const mySchedId = getTraineeLiveScheduleId(CURRENT_USER.user, liveSchedules);
        if (!mySchedId) {
             const container = document.getElementById('live-assessment');
             if(container) container.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:12px;">
                    <h2 style="margin:0;">Live Assessment Booking</h2>
                    <button class="btn-secondary btn-sm" onclick="goWorkspaceHome()"><i class="fas fa-house"></i> Home</button>
                </div>
                <div style="text-align:center; padding:40px; color:var(--text-muted);">
                    <i class="fas fa-calendar-times" style="font-size:3rem; margin-bottom:15px;"></i><br>
                    No live assessment schedule assigned to your group.
                </div>
             `;
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
    if (canViewLive) {
        const adminPanel = document.querySelector('#live-assessment .admin-only');
        if(adminPanel) {
            adminPanel.classList.remove('hidden');
            
            // Inject Tabs & Toolbar
            let controlsHtml = buildLiveTabs(liveSchedules) + buildLiveToolbar(currentSched);
            
            // Inject Settings Form (Existing inputs)
            controlsHtml += `
                <div class="card" style="margin-top:15px; background:var(--bg-input);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <h4 style="margin:0;"><i class="fas fa-cogs"></i> Schedule Configuration</h4>
                        <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
                            <button class="btn-secondary btn-sm" onclick="openLiveStatsModal()"><i class="fas fa-chart-pie"></i> View Trainee Stats Breakdown</button>
                            ${canManageLive ? '<button class="btn-secondary btn-sm" onclick="openLiveBookingIntegrityModal()"><i class="fas fa-shield-alt"></i> Booking Integrity Check</button>' : ''}
                        </div>
                    </div>
                    <div style="display:flex; gap:15px; align-items:end; margin-bottom:10px;">
                        <div><label>Start Date</label><input type="date" id="liveStartDate" value="${currentSched.startDate}" ${canManageLive ? '' : 'disabled'}></div>
                        <div><label>Days</label><input type="number" id="liveNumDays" value="${currentSched.days}" min="1" max="30" style="width:80px;" ${canManageLive ? '' : 'disabled'}></div>
                        <div style="flex:1;"><label>Default Trainers</label><input type="text" id="liveTrainersInput" value="${(currentSched.trainers || ['Trainer 1', 'Trainer 2']).join(', ')}" placeholder="Trainer 1, Trainer 2..." ${canManageLive ? '' : 'disabled'}></div>
                        ${canManageLive ? '<button class="btn-primary" onclick="saveLiveScheduleSettings()" style="height:38px;">Update Settings</button>' : '<span style="font-size:0.85rem; color:var(--text-muted);">Read Only</span>'}
                    </div>
                    <div id="liveSlotConfig" style="margin-top:10px; display:flex; gap:15px; flex-wrap:wrap;">
                        <label style="font-size:0.9rem; font-weight:bold;">Active Hours:</label>
                        ${["1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"].map(slot => `
                            <label style="cursor:pointer;">
                                <input type="checkbox" id="slot_${slot.replace(/[: ]/g, '')}" ${currentSched.activeSlots && currentSched.activeSlots.includes(slot) ? 'checked' : ''} ${canManageLive ? '' : 'disabled'}> ${slot}
                            </label>
                        `).join('')}
                        ${canManageLive ? '<button class="btn-danger btn-sm" onclick="clearLiveBookings()" style="margin-left:auto;">Reset / Clear</button>' : ''}
                    </div>
                </div>
            `;
            
            adminPanel.innerHTML = controlsHtml;
            
            // Populate Dropdown if unassigned
            if (!currentSched.assigned && canManageLive) {
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
    updateLiveBookingWorkspaceStats(bookings, currentSched, validDays);

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
        
        html += `<tr><td style="background:var(--bg-input); border-right:2px solid var(--border-color); vertical-align:middle;">
            <strong>${dayStr}</strong><br><span style="font-size:0.8rem; color:var(--text-muted);">${dateKey}</span>
            ${canManageLive ? `<button class="btn-secondary btn-sm" style="display:block; margin-top:8px; width:100%; font-size:0.7rem;" onclick="editDailyTrainers('${dateKey}')"><i class="fas fa-user-edit"></i> Edit Trainers</button>` : ''}
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
                const safeTrainerAttr = escapeHtmlAttr(trainer);
                const safeTrainerJs = escapeInlineJs(trainer);
                
                // DROP ZONE WRAPPER
                // We wrap the slot in a div that accepts drops.
                // data attributes store the target coordinates.
                html += `<div class="live-drop-zone" data-date="${dateKey}" data-time="${time}" data-trainer="${safeTrainerAttr}" 
                    ondragover="liveDragOver(event)" ondragleave="liveDragLeave(event)" ondrop="liveDrop(event)"
                    style="min-height:50px; border:2px dashed transparent; border-radius:4px; padding:4px; transition:0.2s; margin-bottom:5px;">`;
                
                // Find booking for this SPECIFIC slot (Trainer + Time + Date)
                // We already filtered slotBookings above, just find the match
                const booking = slotBookings.find(b => b.trainer === trainer);

                const isTaken = !!booking;
                const isMine = booking && bookingMatchesTrainee(booking, CURRENT_USER.user);
                const isCompleted = booking && booking.status === 'Completed';

                let highlightClass = '';
                if (isTaken && searchTerm) {
                    if (normalizeScheduleText(booking.trainee).includes(searchTerm) || normalizeScheduleText(booking.assessment).includes(searchTerm)) {
                        highlightClass = 'search-match';
                    }
                }
                
                // HEADER FOR TRAINER
                html += `<div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:2px; font-weight:bold; text-transform:uppercase;">${escapeHtml(trainer)}</div>`;

                if (isTaken) {
                    // BOOKED STATE
                    let statusClass = isMine ? 'mine' : 'taken';
                    if (isCompleted) statusClass = 'completed';

                    // Info Display
                    let info = '';
                    if (isMine || ['admin', 'super_admin', 'teamleader', 'special_viewer'].includes(CURRENT_USER.role)) {
                        info = `<div style="font-weight:bold; font-size:0.85rem;">${escapeHtml(booking.trainee)}</div>
                                <div style="font-size:0.75rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(booking.assessment)}</div>`;
                    } else {
                        info = `<div style="font-style:italic; color:var(--text-muted);">Booked</div>`;
                    }

                    // Actions
                    let actions = '';
                    if (canManageLive) {
                        // Admin: Cancel OR Mark Complete
                        const existingSession = (booking.status === 'Completed' || booking.status === 'Cancelled')
                            ? null
                            : allLiveSessions.find(s => String((s && s.bookingId) || '') === String(booking.id) && !!(s && s.active));

                        if(!isCompleted) {
                            if (existingSession) {
                                actions += `<button class="btn-warning btn-sm" style="padding:2px 6px; margin-right:5px;" onclick="rejoinLiveSession('${existingSession.sessionId}')" title="Rejoin Active Session"><i class="fas fa-sign-in-alt"></i> Rejoin</button>`;
                            } else {
                                actions += `<button class="btn-primary btn-sm" style="padding:2px 6px; margin-right:5px;" onclick="initiateLiveSession('${escapeInlineJs(booking.id)}')" title="Start Live Session"><i class="fas fa-play"></i> Start</button>`;
                                actions += `<button class="btn-success btn-sm" style="padding:2px 6px; margin-right:5px;" onclick="markBookingComplete('${booking.id}')" title="Mark Complete"><i class="fas fa-check"></i></button>`;
                            }
                        }
                        actions += `<button class="btn-danger btn-sm" style="padding:2px 6px;" onclick="cancelBooking('${booking.id}')" title="Cancel"><i class="fas fa-times"></i></button>`;
                    } else if (isMine && !isCompleted) {
                        // User: Cancel only
                        actions += `<button class="btn-cancel" onclick="cancelBooking('${booking.id}')">Cancel</button>`;
                    }

                    // DRAGGABLE ATTRIBUTES (Admin Only)
                    const dragAttr = canManageLive && !isCompleted ? `draggable="true" ondragstart="liveDragStart(event, '${escapeInlineJs(booking.id)}')" style="cursor:grab;"` : '';

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
                        bookingMatchesTrainee(b, CURRENT_USER.user) && 
                        b.status !== 'Cancelled'
                    );

                    if (CURRENT_USER.role === 'trainee') {
                        if (userBookedThisHour) {
                            // User is already booked in the other trainer slot for this hour
                            html += `<div style="padding:5px; background:var(--bg-input); border-radius:4px; color:var(--text-muted); font-size:0.75rem; text-align:center; margin-bottom:8px;">Slot Limit</div>`;
                        } else {
                            // Available to book
                            html += `<button class="btn-slot btn-book" style="margin-bottom:8px;" onclick="openBookingModal('${dateKey}', '${time}', '${safeTrainerJs}')">+ Book</button>`;
                        }
                    } else if (canManageLive) {
                         // Admin can manually assign a trainee
                         html += `<button class="btn-slot" style="margin-bottom:8px; border:1px dashed var(--border-color); color:var(--text-muted); background:transparent;" onclick="openAdminBookingModal('${dateKey}', '${time}', '${safeTrainerJs}')" title="Manually add a trainee to this slot">+ Assign Trainee</button>`;
                    } else {
                         html += `<div style="padding:5px; background:var(--bg-input); border-radius:4px; color:var(--text-muted); font-size:0.75rem; text-align:center; margin-bottom:8px;">Open Slot</div>`;
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
    if (!isLiveBookingManager()) return;
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
    if (!isLiveBookingManager()) return;

    const originalBookingsJSON = localStorage.getItem('liveBookings') || '[]';
    const bookings = JSON.parse(originalBookingsJSON);
    const targetBooking = bookings.find(b => String(b.id) === String(id));
    
    if (!targetBooking) return;
    if (targetBooking.status === 'Completed' || targetBooking.status === 'Cancelled') {
        if (typeof showToast === 'function') showToast("Only active booked slots can be moved.", "error");
        return;
    }
    if (targetBooking.date === date && targetBooking.time === time && targetBooking.trainer === trainer) return;

    const localConflict = bookings.some(b =>
        String(b.id) !== String(id) &&
        b.status !== 'Cancelled' &&
        bookingMatchesTrainee(b, targetBooking.trainee) &&
        b.date === date &&
        b.time === time
    );
    if (localConflict) {
        if (typeof showToast === 'function') showToast("This trainee already has another booking in that hour.", "error");
        return;
    }

    // ARCHITECTURAL FIX: ATOMIC COLLISION CHECK FOR DRAG & DROP
    // Ensure another admin didn't take this slot fractions of a second ago.
    if (window.supabaseClient) {
        const { data: remoteConflict, error: remoteConflictErr } = await window.supabaseClient.from('live_bookings')
            .select('id')
            .eq('data->>date', date)
            .eq('data->>time', time)
            .eq('data->>trainer', trainer)
            .neq('data->>status', 'Cancelled')
            .neq('id', id);
        if (remoteConflictErr) {
            console.error(remoteConflictErr);
            if (typeof showToast === 'function') showToast("Unable to validate slot right now. Please try again.", "error");
            return;
        }
             
        if (remoteConflict && remoteConflict.length > 0) {
            if(typeof showToast === 'function') showToast("Target slot was just taken by another Admin.", "error");
            if (typeof loadFromServer === 'function') await loadFromServer(true);
            renderLiveTable();
            return;
        }

        const { data: remoteHourConflict, error: remoteHourErr } = await window.supabaseClient.from('live_bookings')
            .select('id')
            .eq('data->>date', date)
            .eq('data->>time', time)
            .ilike('data->>trainee', targetBooking.trainee)
            .neq('data->>status', 'Cancelled')
            .neq('id', id);
        if (remoteHourErr) {
            console.error(remoteHourErr);
            if (typeof showToast === 'function') showToast("Unable to validate trainee conflicts right now. Please try again.", "error");
            return;
        }

        if (remoteHourConflict && remoteHourConflict.length > 0) {
            if(typeof showToast === 'function') showToast("This trainee already has another booking in that hour.", "error");
            if (typeof loadFromServer === 'function') await loadFromServer(true);
            renderLiveTable();
            return;
        }
    }

    targetBooking.date = date;
    targetBooking.time = time;
    targetBooking.trainer = trainer;
    targetBooking.lastModified = new Date().toISOString();
    targetBooking.modifiedBy = CURRENT_USER?.user || 'system';
    
    // Optimistic UI Update
    localStorage.setItem('liveBookings', JSON.stringify(bookings));
    renderLiveTable();

    try {
        if (window.supabaseClient) {
            const { error } = await window.supabaseClient
                .from('live_bookings')
                .update({ data: targetBooking, updated_at: new Date().toISOString() })
                .eq('id', targetBooking.id);
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
    const catalog = buildLiveAssessmentCatalog();
    const liveAssessments = Array.from(catalog.byTitle.values()).sort((a, b) => a.title.localeCompare(b.title));
    const totalAvailable = liveAssessments.length;

    if (hydrateBookingAssessmentIds(bookings, catalog)) {
        localStorage.setItem('liveBookings', JSON.stringify(bookings));
    }

    let rows = '';
    
    // Aggregate stats per trainee
    trainees.sort().forEach(t => {
        // Filter bookings for this trainee
        // Note: We don't filter by date here, we look at ALL history for completion status
        const myBookings = bookings.filter(b => bookingMatchesTrainee(b, t) && b.status !== 'Cancelled');
        
        let completedCount = 0;
        let bookedCount = 0;

        liveAssessments.forEach(assessment => {
            const relatedBookings = myBookings.filter(b => {
                if (assessment.id && b.assessmentId) return String(b.assessmentId) === String(assessment.id);
                return isSameScheduleValue(b.assessment, assessment.title);
            });
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
                <td><div style="display:flex; align-items:center;">${getAvatarHTML(t, 24)} <strong>${escapeHtml(t)}</strong></div></td>
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
                    <button class="btn-secondary btn-sm" onclick="viewTraineeLiveDetails('${escapeInlineJs(t)}')"><i class="fas fa-eye"></i> Details</button>
                </td>
            </tr>
        `;
    });

    const modalHtml = `
        <div id="liveStatsModal" class="modal-overlay">
            <div class="modal-box" style="width:800px; max-width:95%;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid var(--border-color); padding-bottom:10px;">
                    <h3 style="margin:0;"><i class="fas fa-chart-pie"></i> Assessment Breakdown: ${escapeHtml(groupId)}</h3>
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
    const catalog = buildLiveAssessmentCatalog();
    const liveAssessments = Array.from(catalog.byTitle.values()).sort((a, b) => a.title.localeCompare(b.title));
    
    // Get Data
    const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
    if (hydrateBookingAssessmentIds(bookings, catalog)) {
        localStorage.setItem('liveBookings', JSON.stringify(bookings));
    }
    const myBookings = bookings.filter(b => bookingMatchesTrainee(b, trainee) && b.status !== 'Cancelled');
    
    let rows = '';
    
    liveAssessments.forEach(assessment => {
        const relatedBookings = myBookings.filter(b => {
            if (assessment.id && b.assessmentId) return String(b.assessmentId) === String(assessment.id);
            return isSameScheduleValue(b.assessment, assessment.title);
        });
        let booking = null;
        if (relatedBookings.length > 0) {
            booking = relatedBookings.find(b => b.status === 'Completed') || relatedBookings.find(b => b.status === 'Booked') || relatedBookings[0];
        }
        
        let statusHtml = '<span class="status-badge" style="background:var(--bg-input); color:var(--text-muted);">Not Started</span>';
        let details = '-';
        
        if (booking) {
            if (booking.status === 'Completed') {
                statusHtml = `<span class="status-badge status-pass">Completed</span>`;
                details = `<div style="font-size:0.8rem;">Score: <strong>${booking.score || 0}%</strong></div><div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(booking.date)}</div>`;
            } else {
                statusHtml = `<span class="status-badge status-improve">Booked</span>`;
                details = `<div style="font-size:0.8rem;">${escapeHtml(booking.date)} @ ${escapeHtml(booking.time)}</div><div style="font-size:0.75rem; color:var(--text-muted);">Trainer: ${escapeHtml(booking.trainer)}</div>`;
            }
        }
        
        rows += `
            <tr>
                <td>${escapeHtml(assessment.title)}</td>
                <td>${statusHtml}</td>
                <td>${details}</td>
            </tr>
        `;
    });
    
    const modalHtml = `
        <div id="liveDetailsModal" class="modal-overlay" style="z-index:10005;">
            <div class="modal-box" style="width:600px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid var(--border-color); padding-bottom:10px;">
                    <h3 style="margin:0;"><i class="fas fa-list"></i> ${escapeHtml(trainee)} - Live Assessments</h3>
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

function getLiveBookingRecencyValue(booking) {
    if (!booking || typeof booking !== 'object') return 0;
    const candidates = [
        booking.lastModified,
        booking.updatedAt,
        booking.updated_at,
        booking.createdAt,
        booking.cancelledAt
    ];
    for (const candidate of candidates) {
        if (!candidate) continue;
        const ts = new Date(candidate).getTime();
        if (Number.isFinite(ts)) return ts;
    }
    return 0;
}

function pickPrimaryBooking(bookings) {
    if (!Array.isArray(bookings) || bookings.length === 0) return null;
    return bookings.slice().sort((a, b) => {
        const aCompleted = a.status === 'Completed' ? 1 : 0;
        const bCompleted = b.status === 'Completed' ? 1 : 0;
        if (aCompleted !== bCompleted) return bCompleted - aCompleted;
        return getLiveBookingRecencyValue(b) - getLiveBookingRecencyValue(a);
    })[0];
}

function buildLiveBookingIntegrityReport(bookings) {
    const safeBookings = Array.isArray(bookings) ? bookings : [];
    const activeBookings = safeBookings.filter(b => b && b.status !== 'Cancelled');

    const report = {
        total: safeBookings.length,
        active: activeBookings.length,
        missingIds: [],
        duplicateIds: [],
        slotConflicts: [],
        traineeHourConflicts: [],
        duplicateAssessments: [],
        unknownAssessments: [],
        invalidStatuses: []
    };

    const validStatuses = new Set(['Booked', 'Completed', 'Cancelled']);
    const catalog = buildLiveAssessmentCatalog();

    const byId = new Map();
    const bySlot = new Map();
    const byTraineeHour = new Map();
    const byAssessment = new Map();

    safeBookings.forEach((booking, index) => {
        if (!booking || typeof booking !== 'object') return;

        if (!booking.id) report.missingIds.push({ index, booking });
        if (!validStatuses.has(booking.status || '')) {
            report.invalidStatuses.push({ index, booking, status: booking.status || '(empty)' });
        }

        const assessmentResolved = booking.assessmentId
            ? catalog.byId.get(String(booking.assessmentId))
            : catalog.byTitle.get(normalizeScheduleText(booking.assessment));
        if (!assessmentResolved && booking.status !== 'Cancelled') {
            report.unknownAssessments.push({ index, booking });
        }

        if (booking.id) {
            const idKey = String(booking.id);
            if (!byId.has(idKey)) byId.set(idKey, []);
            byId.get(idKey).push(booking);
        }

        if (booking.status === 'Cancelled') return;

        if (booking.date && booking.time && booking.trainer) {
            const slotKey = `${booking.date}|${booking.time}|${normalizeScheduleText(booking.trainer)}`;
            if (!bySlot.has(slotKey)) bySlot.set(slotKey, []);
            bySlot.get(slotKey).push(booking);
        }

        if (booking.date && booking.time && booking.trainee) {
            const traineeHourKey = `${normalizeScheduleText(booking.trainee)}|${booking.date}|${booking.time}`;
            if (!byTraineeHour.has(traineeHourKey)) byTraineeHour.set(traineeHourKey, []);
            byTraineeHour.get(traineeHourKey).push(booking);
        }

        if (booking.trainee) {
            const assessmentKeyPart = booking.assessmentId
                ? `id:${String(booking.assessmentId)}`
                : `name:${normalizeScheduleText(booking.assessment)}`;
            const assessKey = `${normalizeScheduleText(booking.trainee)}|${assessmentKeyPart}`;
            if (!byAssessment.has(assessKey)) byAssessment.set(assessKey, []);
            byAssessment.get(assessKey).push(booking);
        }
    });

    byId.forEach((group, id) => { if (group.length > 1) report.duplicateIds.push({ id, group }); });
    bySlot.forEach((group, key) => { if (group.length > 1) report.slotConflicts.push({ key, group }); });
    byTraineeHour.forEach((group, key) => { if (group.length > 1) report.traineeHourConflicts.push({ key, group }); });
    byAssessment.forEach((group, key) => { if (group.length > 1) report.duplicateAssessments.push({ key, group }); });

    report.totalIssues =
        report.missingIds.length +
        report.duplicateIds.length +
        report.slotConflicts.length +
        report.traineeHourConflicts.length +
        report.duplicateAssessments.length +
        report.unknownAssessments.length +
        report.invalidStatuses.length;

    return report;
}

const LIVE_SESSION_RECOVERY_ARCHIVE_KEY = 'liveSessionRecoveryArchive';
const LIVE_SESSION_STALE_MS = 12 * 60 * 60 * 1000;

function updateLiveBookingWorkspaceStats(bookings, schedule, validDays) {
    const container = document.getElementById('liveBookingStats');
    if (!container) return;
    const safeBookings = Array.isArray(bookings) ? bookings : [];
    const visibleDates = new Set((validDays || []).map(d => d.toISOString().split('T')[0]));
    const scopedBookings = safeBookings.filter(b => !visibleDates.size || visibleDates.has(String(b.date || '')));
    const active = scopedBookings.filter(b => b && b.status === 'Booked').length;
    const completed = scopedBookings.filter(b => b && b.status === 'Completed').length;
    const cancelled = scopedBookings.filter(b => b && b.status === 'Cancelled').length;
    const integrity = buildLiveBookingIntegrityReport(safeBookings);
    const slots = Array.isArray(schedule && schedule.activeSlots) ? schedule.activeSlots.length : 4;
    const trainers = Array.isArray(schedule && schedule.trainers) ? schedule.trainers.length : 2;
    const capacity = (validDays || []).length * slots * trainers;

    container.innerHTML = `
        <div class="workspace-stat"><span>Active</span><strong>${active}</strong></div>
        <div class="workspace-stat"><span>Completed</span><strong>${completed}</strong></div>
        <div class="workspace-stat"><span>Capacity</span><strong>${capacity}</strong></div>
        <div class="workspace-stat"><span>Issues</span><strong class="${integrity.totalIssues ? 'status-critical' : ''}">${integrity.totalIssues || 0}</strong></div>
        ${cancelled ? `<div class="workspace-stat"><span>Cancelled</span><strong>${cancelled}</strong></div>` : ''}
    `;
}

function buildLiveSessionStaleReport() {
    const sessions = JSON.parse(localStorage.getItem('liveSessions') || '[]');
    const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
    const bookingById = new Map(
        (Array.isArray(bookings) ? bookings : [])
            .filter(b => b && b.id)
            .map(b => [String(b.id), b])
    );

    const now = Date.now();
    const items = [];

    (Array.isArray(sessions) ? sessions : []).forEach(session => {
        if (!session || !session.active) return;

        const sessionId = String(session.sessionId || '');
        const bookingId = String(session.bookingId || '');
        const booking = bookingId ? bookingById.get(bookingId) : null;
        const bookingStatus = String((booking && booking.status) || '').trim().toLowerCase();
        const startTs = Number(session.startTime || 0) || 0;
        const ageMs = startTs > 0 ? Math.max(0, now - startTs) : 0;
        const ageMinutes = Math.round(ageMs / 60000);

        let reason = '';
        if (bookingStatus === 'completed') reason = 'booking_completed';
        else if (bookingStatus === 'cancelled') reason = 'booking_cancelled';
        else if (bookingId && !booking) reason = 'booking_missing';
        else if (startTs > 0 && ageMs > LIVE_SESSION_STALE_MS) reason = 'stale_age';

        if (!reason) return;
        items.push({
            sessionId,
            trainee: session.trainee || 'Unknown',
            trainer: session.trainer || 'Unknown',
            bookingId: bookingId || '(none)',
            bookingStatus: bookingStatus || 'unknown',
            reason,
            ageMinutes,
            recoverable: reason === 'booking_completed' || reason === 'booking_cancelled'
        });
    });

    const countByReason = items.reduce((acc, item) => {
        acc[item.reason] = (acc[item.reason] || 0) + 1;
        return acc;
    }, {});

    const recoverable = items.filter(i => i.recoverable).length;
    return {
        total: items.length,
        recoverable,
        counts: countByReason,
        items
    };
}

function renderLiveSessionStaleRows(report) {
    const rows = (report.items || []).slice(0, 8).map(item => {
        const reasonLabel = item.reason.replace(/_/g, ' ');
        return `<div style="display:flex; justify-content:space-between; gap:10px; margin-bottom:6px;">
            <span>${escapeHtml(item.trainee)} (${escapeHtml(item.sessionId)})</span>
            <span style="color:var(--text-muted);">${escapeHtml(reasonLabel)}</span>
        </div>`;
    }).join('');

    const moreCount = Math.max(0, (report.items || []).length - 8);
    const moreHtml = moreCount > 0
        ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">+${moreCount} more stale sessions</div>`
        : '';

    return `
        <div style="padding:10px 12px; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-input);">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong>Stale Live Sessions</strong>
                <span class="status-badge" style="${report.total > 0 ? 'background:#7f1d1d; color:#fecaca;' : 'background:#14532d; color:#bbf7d0;'}">${report.total}</span>
            </div>
            ${rows ? `<div style="margin-top:8px; font-size:0.82rem;">${rows}${moreHtml}</div>` : '<div style="margin-top:8px; font-size:0.82rem; color:var(--text-muted);">No stale live sessions detected.</div>'}
        </div>
    `;
}

function getLiveSessionRecoveryArchive() {
    const data = JSON.parse(localStorage.getItem(LIVE_SESSION_RECOVERY_ARCHIVE_KEY) || '[]');
    return Array.isArray(data) ? data : [];
}

function saveLiveSessionRecoveryArchive(entries) {
    const safeEntries = Array.isArray(entries) ? entries.slice(0, 500) : [];
    localStorage.setItem(LIVE_SESSION_RECOVERY_ARCHIVE_KEY, JSON.stringify(safeEntries));
}

function renderLiveBookingIntegrityRows(report) {
    const sections = [];
    const pushSection = (title, count, detailsHtml) => {
        sections.push(`
            <div style="padding:10px 12px; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-input);">
                <div style="display:flex; justify-content:space-between; gap:10px; align-items:center;">
                    <strong>${title}</strong>
                    <span class="status-badge" style="${count > 0 ? 'background:#7f1d1d; color:#fecaca;' : 'background:#14532d; color:#bbf7d0;'}">${count}</span>
                </div>
                ${detailsHtml || ''}
            </div>
        `);
    };

    const smallList = (items, formatter) => {
        if (!items || items.length === 0) return '';
        const rows = items.slice(0, 4).map(formatter).join('');
        const more = items.length > 4 ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">+${items.length - 4} more</div>` : '';
        return `<div style="margin-top:8px; font-size:0.8rem; color:var(--text-muted);">${rows}${more}</div>`;
    };

    pushSection(
        "Missing IDs",
        report.missingIds.length,
        smallList(report.missingIds, i => `<div>- ${escapeHtml(i.booking?.trainee || 'Unknown')} / ${escapeHtml(i.booking?.assessment || 'Unknown')}</div>`)
    );
    pushSection(
        "Duplicate IDs",
        report.duplicateIds.length,
        smallList(report.duplicateIds, i => `<div>- ${escapeHtml(i.id)} (${i.group.length} entries)</div>`)
    );
    pushSection(
        "Slot Collisions",
        report.slotConflicts.length,
        smallList(report.slotConflicts, i => `<div>- ${escapeHtml(i.key)} (${i.group.length} entries)</div>`)
    );
    pushSection(
        "Trainee Hour Collisions",
        report.traineeHourConflicts.length,
        smallList(report.traineeHourConflicts, i => `<div>- ${escapeHtml(i.key)} (${i.group.length} entries)</div>`)
    );
    pushSection(
        "Duplicate Trainee Assessments",
        report.duplicateAssessments.length,
        smallList(report.duplicateAssessments, i => `<div>- ${escapeHtml(i.key)} (${i.group.length} entries)</div>`)
    );
    pushSection(
        "Unknown Assessments",
        report.unknownAssessments.length,
        smallList(report.unknownAssessments, i => `<div>- ${escapeHtml(i.booking?.trainee || 'Unknown')} / ${escapeHtml(i.booking?.assessment || 'Unknown')}</div>`)
    );
    pushSection(
        "Invalid Status Values",
        report.invalidStatuses.length,
        smallList(report.invalidStatuses, i => `<div>- ${escapeHtml(i.status)} for ${escapeHtml(i.booking?.trainee || 'Unknown')}</div>`)
    );

    return sections.join('');
}

window.closeLiveBookingIntegrityModal = function() {
    const modal = document.getElementById('liveBookingIntegrityModal');
    if (modal) modal.remove();
};

window.openLiveBookingIntegrityModal = function() {
    if (!isLiveBookingManager()) return;
    const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
    const report = buildLiveBookingIntegrityReport(bookings);
    const staleReport = buildLiveSessionStaleReport();

    closeLiveBookingIntegrityModal();
    const modalHtml = `
        <div id="liveBookingIntegrityModal" class="modal-overlay" style="z-index:10020;">
            <div class="modal-box" style="width:860px; max-width:96%;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid var(--border-color); padding-bottom:10px;">
                    <h3 style="margin:0;"><i class="fas fa-shield-alt" style="color:var(--primary);"></i> Live Booking Integrity Check</h3>
                    <button class="btn-secondary" onclick="closeLiveBookingIntegrityModal()">&times;</button>
                </div>
                <div style="display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:10px; margin-bottom:12px;">
                    <div style="padding:10px; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-input);">
                        <div style="font-size:0.75rem; color:var(--text-muted);">Total Bookings</div>
                        <div style="font-size:1.15rem; font-weight:700;">${report.total}</div>
                    </div>
                    <div style="padding:10px; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-input);">
                        <div style="font-size:0.75rem; color:var(--text-muted);">Active Bookings</div>
                        <div style="font-size:1.15rem; font-weight:700;">${report.active}</div>
                    </div>
                    <div style="padding:10px; border:1px solid var(--border-color); border-radius:8px; background:${report.totalIssues > 0 ? 'rgba(127,29,29,0.18)' : 'rgba(20,83,45,0.18)'}; border-color:${report.totalIssues > 0 ? '#7f1d1d' : '#14532d'};">
                        <div style="font-size:0.75rem; color:var(--text-muted);">Integrity Issues</div>
                        <div style="font-size:1.15rem; font-weight:700;">${report.totalIssues}</div>
                    </div>
                    <div style="padding:10px; border:1px solid var(--border-color); border-radius:8px; background:${staleReport.total > 0 ? 'rgba(127,29,29,0.18)' : 'rgba(20,83,45,0.18)'}; border-color:${staleReport.total > 0 ? '#7f1d1d' : '#14532d'};">
                        <div style="font-size:0.75rem; color:var(--text-muted);">Stale Sessions</div>
                        <div style="font-size:1.15rem; font-weight:700;">${staleReport.total}</div>
                    </div>
                </div>
                <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; max-height:52vh; overflow:auto; padding-right:3px;">
                    ${renderLiveBookingIntegrityRows(report)}
                    ${renderLiveSessionStaleRows(staleReport)}
                </div>
                <div style="display:flex; justify-content:space-between; gap:10px; margin-top:14px;">
                    <button class="btn-secondary" onclick="openLiveBookingIntegrityModal()"><i class="fas fa-sync"></i> Refresh Scan</button>
                    <div style="display:flex; gap:10px;">
                        <button class="btn-warning" onclick="runLiveSessionStaleRecovery()"><i class="fas fa-life-ring"></i> Recover Stale Sessions</button>
                        <button class="btn-secondary" onclick="runLiveRecordLinkRepair()"><i class="fas fa-link"></i> Repair Live Records</button>
                        <button class="btn-danger" onclick="runLiveBookingAutoRepair()"><i class="fas fa-wrench"></i> Auto-Repair Issues</button>
                        <button class="btn-primary" onclick="closeLiveBookingIntegrityModal()">Close</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
};

window.runLiveSessionStaleRecovery = async function() {
    if (!isLiveBookingManager()) return;

    const staleReport = buildLiveSessionStaleReport();
    if (staleReport.total === 0) {
        if (typeof showToast === 'function') showToast('No stale live sessions found.', 'success');
        return;
    }

    const recoverableItems = (staleReport.items || []).filter(i => i.recoverable);
    if (recoverableItems.length === 0) {
        if (typeof showToast === 'function') showToast('Stale sessions found, but none are safe for auto-recovery.', 'warning');
        return;
    }

    if (!confirm(`Recover ${recoverableItems.length} stale live session(s)?\n\nThis will archive session payloads first, recover missing submissions/records where needed, then close stale sessions.`)) return;

    let sessions = JSON.parse(localStorage.getItem('liveSessions') || '[]');
    sessions = Array.isArray(sessions) ? sessions : [];
    let bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
    bookings = Array.isArray(bookings) ? bookings : [];
    let submissions = JSON.parse(localStorage.getItem('submissions') || '[]');
    submissions = Array.isArray(submissions) ? submissions : [];
    let records = JSON.parse(localStorage.getItem('records') || '[]');
    records = Array.isArray(records) ? records : [];
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    const nowIso = new Date().toISOString();

    const bookingById = new Map(bookings.filter(b => b && b.id).map(b => [String(b.id), b]));
    const testById = new Map((Array.isArray(tests) ? tests : []).filter(t => t && t.id).map(t => [String(t.id), t]));
    const archive = getLiveSessionRecoveryArchive();

    let archivedCount = 0;
    let closedCount = 0;
    let recoveredSubmissionCount = 0;
    let recoveredRecordCount = 0;

    const findGroupForTrainee = (traineeName) => {
        const normalized = normalizeScheduleText(traineeName);
        for (const [groupId, members] of Object.entries(rosters || {})) {
            if (!Array.isArray(members)) continue;
            if (members.some(m => normalizeScheduleText(m) === normalized)) return groupId;
        }
        return 'Live-Session';
    };

    for (const item of recoverableItems) {
        const session = sessions.find(s => String((s && s.sessionId) || '') === String(item.sessionId));
        if (!session) continue;

        const booking = session.bookingId ? bookingById.get(String(session.bookingId)) : null;
        const test = testById.get(String(session.testId || ''));

        archive.unshift({
            id: `live_recovery_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            recoveredAt: nowIso,
            recoveredBy: CURRENT_USER?.user || 'system',
            reason: item.reason,
            sessionSnapshot: session,
            bookingSnapshot: booking || null
        });
        archivedCount++;

        const canRebuildArtifacts = item.reason === 'booking_completed';
        if (canRebuildArtifacts) {
            let score = Number(booking && booking.score);
            if (!Number.isFinite(score)) {
                const questions = Array.isArray(test && test.questions) ? test.questions : [];
                const maxScore = questions.reduce((sum, q) => sum + (parseFloat(q?.points || 1) || 0), 0);
                const totalScore = questions.reduce((sum, q, idx) => sum + (parseFloat((session.scores && session.scores[idx]) || 0) || 0), 0);
                score = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
            }
            if (!Number.isFinite(score)) score = 0;

            const existingSubIdx = submissions.findIndex(s =>
                (session.bookingId && String(s.bookingId || '') === String(session.bookingId)) ||
                String(s.liveSessionId || '') === String(session.sessionId)
            );

            const subId = existingSubIdx > -1 ? submissions[existingSubIdx].id : Date.now().toString() + '_' + Math.random().toString(36).slice(2, 6);
            const testTitle = (test && test.title) || (booking && booking.assessment) || 'Live Assessment';
            const submissionPayload = {
                id: subId,
                bookingId: session.bookingId || null,
                liveSessionId: session.sessionId,
                testId: session.testId || (booking && booking.assessmentId) || null,
                assessmentId: session.testId || (booking && booking.assessmentId) || null,
                testTitle,
                testSnapshot: test || null,
                trainee: session.trainee || (booking && booking.trainee) || '',
                date: nowIso.split('T')[0],
                answers: session.answers || {},
                status: 'completed',
                score,
                type: 'live',
                marker: session.trainer || CURRENT_USER?.user || 'system',
                comments: session.comments || {},
                scores: session.scores || {},
                lastModified: nowIso,
                modifiedBy: CURRENT_USER?.user || 'system',
                recoveryTag: 'stale_live_session_recovery'
            };

            if (existingSubIdx > -1) {
                submissions[existingSubIdx] = { ...submissions[existingSubIdx], ...submissionPayload };
            } else {
                submissions.push(submissionPayload);
                recoveredSubmissionCount++;
            }

            const groupId = findGroupForTrainee(submissionPayload.trainee);
            const existingRecordIdx = records.findIndex(r =>
                String(r.submissionId || '') === String(subId) ||
                String(r.id || '') === String(`record_${subId}`) ||
                (submissionPayload.bookingId && String(r.bookingId || '') === String(submissionPayload.bookingId)) ||
                (submissionPayload.liveSessionId && String(r.liveSessionId || '') === String(submissionPayload.liveSessionId))
            );

            const recordPayload = {
                id: existingRecordIdx > -1 ? records[existingRecordIdx].id : `record_${subId}`,
                groupID: groupId,
                trainee: submissionPayload.trainee,
                assessment: submissionPayload.testTitle,
                score,
                date: submissionPayload.date,
                phase: submissionPayload.testTitle.toLowerCase().includes('vetting') ? 'Vetting' : 'Assessment',
                cycle: 'Live',
                link: 'Live-Session',
                docSaved: true,
                submissionId: subId,
                assessmentId: submissionPayload.assessmentId,
                bookingId: submissionPayload.bookingId || null,
                liveSessionId: submissionPayload.liveSessionId || null,
                createdAt: existingRecordIdx > -1 ? (records[existingRecordIdx].createdAt || nowIso) : nowIso,
                lastModified: nowIso,
                modifiedBy: CURRENT_USER?.user || 'system'
            };

            if (existingRecordIdx > -1) {
                records[existingRecordIdx] = { ...records[existingRecordIdx], ...recordPayload };
            } else {
                records.push(recordPayload);
                recoveredRecordCount++;
            }
        }

        sessions = sessions.filter(s => String((s && s.sessionId) || '') !== String(session.sessionId));
        if (String(localStorage.getItem('currentLiveSessionId') || '') === String(session.sessionId)) {
            localStorage.removeItem('currentLiveSessionId');
        }
        const currentLocalSession = JSON.parse(localStorage.getItem('liveSession') || '{}');
        if (String(currentLocalSession.sessionId || '') === String(session.sessionId)) {
            localStorage.setItem('liveSession', JSON.stringify({ active: false, sessionId: session.sessionId, endedAt: Date.now() }));
        }

        if (window.supabaseClient) {
            try {
                await window.supabaseClient.from('live_sessions').delete().eq('id', session.sessionId);
            } catch (e) {
                console.warn('Failed to delete stale live session row:', session.sessionId, e);
            }
        }
        closedCount++;
    }

    saveLiveSessionRecoveryArchive(archive);
    localStorage.setItem('liveSessions', JSON.stringify(sessions));
    localStorage.setItem('submissions', JSON.stringify(submissions));
    localStorage.setItem('records', JSON.stringify(records));
    if (typeof emitDataChange === 'function') emitDataChange('liveSessions', 'stale_recovery_cleanup');

    if (typeof saveToServer === 'function') {
        await saveToServer(['liveSessions', 'submissions', 'records'], true);
    }

    if (typeof renderLiveTable === 'function') renderLiveTable();
    if (typeof showToast === 'function') {
        showToast(`Recovered ${closedCount} stale session(s). Archived ${archivedCount}, rebuilt ${recoveredSubmissionCount} submission(s), ${recoveredRecordCount} record(s).`, 'success');
    }
    openLiveBookingIntegrityModal();
};

window.runLiveRecordLinkRepair = async function() {
    if (!isLiveBookingManager()) return;
    if (!confirm("Repair live assessment records from saved live submissions?\n\nThis will create any missing permanent records and relink completed live bookings without changing trainee answers.")) return;

    if (typeof forceFullSync === 'function') {
        await forceFullSync('submissions');
        await forceFullSync('records');
        await forceFullSync('liveBookings');
    }

    const nowIso = new Date().toISOString();
    const submissions = JSON.parse(localStorage.getItem('submissions') || '[]');
    let records = JSON.parse(localStorage.getItem('records') || '[]');
    let bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
    records = Array.isArray(records) ? records : [];
    bookings = Array.isArray(bookings) ? bookings : [];

    const liveSubs = (Array.isArray(submissions) ? submissions : []).filter(sub => {
        if (!sub || String(sub.status || '').toLowerCase() !== 'completed') return false;
        return String(sub.type || '').toLowerCase() === 'live' || !!sub.bookingId || !!sub.liveSessionId;
    });

    const findGroupForTrainee = (traineeName) => {
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        const normalized = normalizeScheduleText(traineeName);
        for (const [gid, members] of Object.entries(rosters)) {
            if (!Array.isArray(members)) continue;
            if (members.some(member => normalizeScheduleText(member) === normalized)) return gid;
        }
        return 'Live-Session';
    };

    let created = 0;
    let updated = 0;
    let bookingUpdates = 0;

    liveSubs.forEach(sub => {
        const recordId = `record_${sub.id}`;
        const existingIdx = records.findIndex(record =>
            String(record?.submissionId || '') === String(sub.id) ||
            String(record?.id || '') === recordId ||
            (sub.bookingId && String(record?.bookingId || '') === String(sub.bookingId)) ||
            (sub.liveSessionId && String(record?.liveSessionId || '') === String(sub.liveSessionId))
        );

        const score = Number.isFinite(Number(sub.score)) ? Number(sub.score) : 0;
        const payload = {
            id: existingIdx > -1 ? records[existingIdx].id : recordId,
            groupID: findGroupForTrainee(sub.trainee),
            trainee: sub.trainee || '',
            assessment: sub.testTitle || 'Live Assessment',
            score,
            date: sub.date || nowIso.split('T')[0],
            phase: String(sub.testTitle || '').toLowerCase().includes('vetting') ? 'Vetting' : 'Assessment',
            cycle: 'Live',
            link: 'Live-Session',
            docSaved: true,
            submissionId: sub.id,
            assessmentId: sub.assessmentId || sub.testId || null,
            bookingId: sub.bookingId || null,
            liveSessionId: sub.liveSessionId || null,
            createdAt: existingIdx > -1 ? (records[existingIdx].createdAt || sub.createdAt || sub.lastModified || nowIso) : (sub.createdAt || sub.lastModified || nowIso),
            lastModified: nowIso,
            modifiedBy: CURRENT_USER?.user || 'live_record_repair'
        };

        if (existingIdx > -1) {
            records[existingIdx] = { ...records[existingIdx], ...payload, id: records[existingIdx].id };
            updated++;
        } else {
            records.push(payload);
            created++;
        }

        if (sub.bookingId) {
            const booking = bookings.find(b => String(b?.id || '') === String(sub.bookingId));
            if (booking) {
                let changed = false;
                if (String(booking.status || '').toLowerCase() !== 'completed') {
                    booking.status = 'Completed';
                    changed = true;
                }
                if (Number(booking.score) !== score) {
                    booking.score = score;
                    changed = true;
                }
                if (changed) {
                    booking.lastModified = nowIso;
                    booking.modifiedBy = CURRENT_USER?.user || 'live_record_repair';
                    bookingUpdates++;
                }
            }
        }
    });

    localStorage.setItem('records', JSON.stringify(records));
    localStorage.setItem('liveBookings', JSON.stringify(bookings));

    if (typeof saveToServer === 'function') {
        await saveToServer(['records', 'liveBookings'], true);
    }

    if (typeof showToast === 'function') {
        showToast(`Live record repair complete. Created ${created}, updated ${updated}, booking fixes ${bookingUpdates}.`, 'success');
    }
    openLiveBookingIntegrityModal();
};

window.runLiveBookingAutoRepair = async function() {
    if (!isLiveBookingManager()) return;
    if (!confirm("Run auto-repair on live bookings? This will normalize bad records and cancel conflicting duplicates.")) return;

    const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]').map((b, idx) => ({ ...(b || {}), __tmpKey: `row_${idx}` }));
    const catalog = buildLiveAssessmentCatalog();
    const nowIso = new Date().toISOString();
    const validStatuses = new Set(['Booked', 'Completed', 'Cancelled']);
    let changeCount = 0;

    const markChanged = () => { changeCount++; };
    const cancelForRepair = (booking, reason) => {
        if (!booking || booking.status === 'Cancelled') return;
        booking.status = 'Cancelled';
        booking.cancelledBy = 'system_auto_repair';
        booking.cancelledAt = nowIso;
        booking.cancelledReason = reason;
        booking.lastModified = nowIso;
        booking.modifiedBy = CURRENT_USER?.user || 'system_auto_repair';
        markChanged();
    };

    bookings.forEach(booking => {
        if (!booking.id) {
            booking.id = createLiveBookingId();
            markChanged();
        }
        if (!validStatuses.has(booking.status || '')) {
            booking.status = 'Booked';
            markChanged();
        }
        if (!booking.assessmentId) {
            const mapped = catalog.byTitle.get(normalizeScheduleText(booking.assessment));
            if (mapped && mapped.id) {
                booking.assessmentId = mapped.id;
                markChanged();
            }
        }
        booking.lastModified = booking.lastModified || nowIso;
        booking.modifiedBy = booking.modifiedBy || (CURRENT_USER?.user || 'system_auto_repair');
    });

    // Deduplicate identical IDs by keeping strongest/latest record
    const byId = new Map();
    bookings.forEach(booking => {
        const idKey = String(booking.id);
        if (!byId.has(idKey)) byId.set(idKey, []);
        byId.get(idKey).push(booking);
    });

    const removedKeys = new Set();
    byId.forEach(group => {
        if (group.length <= 1) return;
        const keeper = pickPrimaryBooking(group);
        group.forEach(item => {
            if (item.__tmpKey !== keeper.__tmpKey) removedKeys.add(item.__tmpKey);
        });
        markChanged();
    });
    let repaired = bookings.filter(b => !removedKeys.has(b.__tmpKey));

    // Resolve slot conflicts
    const slotMap = new Map();
    repaired.forEach(b => {
        if (b.status === 'Cancelled' || !b.date || !b.time || !b.trainer) return;
        const key = `${b.date}|${b.time}|${normalizeScheduleText(b.trainer)}`;
        if (!slotMap.has(key)) slotMap.set(key, []);
        slotMap.get(key).push(b);
    });
    slotMap.forEach(group => {
        if (group.length <= 1) return;
        const keeper = pickPrimaryBooking(group);
        group.forEach(item => {
            if (item.__tmpKey !== keeper.__tmpKey) cancelForRepair(item, 'slot-conflict-auto-repair');
        });
    });

    // Resolve trainee-hour conflicts
    const traineeHourMap = new Map();
    repaired.forEach(b => {
        if (b.status === 'Cancelled' || !b.date || !b.time || !b.trainee) return;
        const key = `${normalizeScheduleText(b.trainee)}|${b.date}|${b.time}`;
        if (!traineeHourMap.has(key)) traineeHourMap.set(key, []);
        traineeHourMap.get(key).push(b);
    });
    traineeHourMap.forEach(group => {
        if (group.length <= 1) return;
        const keeper = pickPrimaryBooking(group);
        group.forEach(item => {
            if (item.__tmpKey !== keeper.__tmpKey) cancelForRepair(item, 'trainee-hour-conflict-auto-repair');
        });
    });

    // Resolve duplicate trainee assessments
    const assessmentMap = new Map();
    repaired.forEach(b => {
        if (b.status === 'Cancelled' || !b.trainee) return;
        const assessmentPart = b.assessmentId ? `id:${String(b.assessmentId)}` : `name:${normalizeScheduleText(b.assessment)}`;
        const key = `${normalizeScheduleText(b.trainee)}|${assessmentPart}`;
        if (!assessmentMap.has(key)) assessmentMap.set(key, []);
        assessmentMap.get(key).push(b);
    });
    assessmentMap.forEach(group => {
        if (group.length <= 1) return;
        const keeper = pickPrimaryBooking(group);
        group.forEach(item => {
            if (item.__tmpKey !== keeper.__tmpKey) cancelForRepair(item, 'duplicate-assessment-auto-repair');
        });
    });

    repaired.forEach(b => delete b.__tmpKey);
    localStorage.setItem('liveBookings', JSON.stringify(repaired));
    renderLiveTable();

    if (typeof saveToServer === 'function') {
        await saveToServer(['liveBookings'], true);
    }

    if (typeof showToast === 'function') {
        showToast(changeCount > 0 ? `Auto-repair completed (${changeCount} changes).` : "No integrity issues required repair.", "success");
    }
    openLiveBookingIntegrityModal();
};

// --- LIVE SCHEDULE HELPERS ---

function buildLiveTabs(liveSchedules) {
    const canManage = isLiveBookingManager();
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
                ${canManage ? `<i class="fas fa-times" onclick="event.stopPropagation(); deleteLiveSchedule('${key}')" style="font-size:0.8rem; color:#ff5252; opacity:0.6; transition:0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6" title="Delete Schedule"></i>` : ''}
            </div>
            <div style="font-size:0.75rem; color:${data.assigned ? 'var(--primary)' : 'var(--text-muted)'};">${subLabel}</div>
        </button>`;
    }).join('');

    if (canManage) {
        html += `<button onclick="createNewLiveSchedule()" style="padding: 8px 12px; border:1px dashed var(--border-color); background:transparent; cursor:pointer; border-radius:6px; color:var(--primary);" title="Create New Live Schedule"><i class="fas fa-plus"></i></button>`;
    }
    html += '</div>';
    return html;
}

function buildLiveToolbar(scheduleData) {
    const canManage = isLiveBookingManager();
    if (scheduleData.assigned) {
        const label = (typeof getGroupLabel === 'function') ? getGroupLabel(scheduleData.assigned) : scheduleData.assigned;
        return `<div style="display:flex; justify-content:space-between; align-items:center; padding:10px 15px; background:rgba(39, 174, 96, 0.1); border:1px solid #27ae60; border-radius:6px;">
            <div><i class="fas fa-check-circle" style="color:#27ae60; margin-right:5px;"></i> Assigned to: <strong>${escapeHtml(label)}</strong></div>
            <div>
                ${canManage ? `<button class="btn-danger btn-sm" onclick="assignRosterToLiveSchedule('${ACTIVE_LIVE_SCHED_ID}', null)">Unassign</button>` : `<span style="color:var(--text-muted); font-size:0.85rem;">Read Only</span>`}
            </div>
        </div>`;
    } else {
        return `<div style="display:flex; gap:10px; align-items:center; padding:15px; background:var(--bg-card); border:1px dashed var(--border-color); border-radius:6px;">
            <i class="fas fa-exclamation-circle" style="color:orange;"></i>
            <span style="margin-right:auto;">This schedule is currently unassigned.</span>
            ${canManage ? `<select id="liveAssignSelect" class="form-control" style="width:250px; margin:0;"><option value="">Loading Groups...</option></select>
            <button class="btn-primary btn-sm" onclick="assignRosterToLiveSchedule('${ACTIVE_LIVE_SCHED_ID}', document.getElementById('liveAssignSelect').value)">Assign Roster</button>` : `<span style="color:var(--text-muted); font-size:0.85rem;">Read Only</span>`}
        </div>`;
    }
}

function switchLiveScheduleTab(id) {
    ACTIVE_LIVE_SCHED_ID = id;
    renderLiveTable();
}

async function createNewLiveSchedule() {
    if (!isLiveBookingManager()) return;
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
            dailyTrainers: {},
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
    if (!isLiveBookingManager()) return;
    if (!confirm(`Delete Live Schedule ${id}?`)) return;
    const liveSchedules = JSON.parse(localStorage.getItem('liveSchedules'));
    delete liveSchedules[id];
    
    if (Object.keys(liveSchedules).length === 0) {
        liveSchedules["A"] = {
            startDate: new Date().toISOString().split('T')[0],
            days: 5,
            activeSlots: ["1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"],
            trainers: ["Trainer 1", "Trainer 2"],
            dailyTrainers: {},
            assigned: null
        };
    }
    
    localStorage.setItem('liveSchedules', JSON.stringify(liveSchedules));
    await secureScheduleSave();
    ACTIVE_LIVE_SCHED_ID = Object.keys(liveSchedules).sort()[0];
    renderLiveTable();
}

async function assignRosterToLiveSchedule(schedId, groupId) {
    if (!isLiveBookingManager()) return;
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
    const normalizedUser = normalizeScheduleText(username);
    let myGroupId = null;
    for (const [gid, members] of Object.entries(rosters)) {
        if (Array.isArray(members) && members.some(m => normalizeScheduleText(m) === normalizedUser)) {
            myGroupId = gid;
            break;
        }
    }
    if (!myGroupId) return null;
    const normalizedGroup = normalizeScheduleText(myGroupId);
    return Object.keys(liveSchedules).find(key => normalizeScheduleText(liveSchedules[key] && liveSchedules[key].assigned) === normalizedGroup) || null;
}

// --- BOOKING LOGIC ---

let PENDING_BOOKING = null;

function openBookingModal(date, time, trainer) {
    PENDING_BOOKING = { date, time, trainer };
    const modal = document.getElementById('bookingModal');
    
    document.getElementById('bookingDetailsText').innerHTML = `
        Booking with <strong style="color:var(--primary);">${escapeHtml(trainer)}</strong><br>
        ${escapeHtml(date)} @ ${escapeHtml(time)}`;
    
    const assessSelect = document.getElementById('bookingAssessment');
    assessSelect.innerHTML = '';
    const catalog = buildLiveAssessmentCatalog();
    let availableList = Array.from(catalog.byTitle.values()).sort((a, b) => a.title.localeCompare(b.title));
    
    // FILTER FOR TRAINEES
    if (CURRENT_USER.role === 'trainee') {
        // Ensure user is assigned to a schedule (already checked in renderLiveTable, but safe to double check)
        const liveSchedules = JSON.parse(localStorage.getItem('liveSchedules') || '{}');
        const schedId = getTraineeLiveScheduleId(CURRENT_USER.user, liveSchedules);
        
        if (!schedId) {
            availableList = [];
        } else {
            // FILTER OUT ALREADY BOOKED/COMPLETED ASSESSMENTS
            const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
            if (hydrateBookingAssessmentIds(bookings, catalog)) {
                localStorage.setItem('liveBookings', JSON.stringify(bookings));
            }
            const myTaken = bookings.filter(b => bookingMatchesTrainee(b, CURRENT_USER.user) && b.status !== 'Cancelled');
            availableList = availableList.filter(assessment => {
                return !myTaken.some(booking => bookingMatchesAssessment(booking, assessment));
            });
        }
    }
    
    if(availableList.length === 0) {
        assessSelect.innerHTML = '<option value="">No Available Assessments</option>';
    } else {
        availableList.forEach(assessment => {
            const opt = new Option(assessment.title, assessment.title);
            if (assessment.id) opt.dataset.testId = assessment.id;
            assessSelect.add(opt);
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
    if (!isLiveBookingManager()) return;
    PENDING_BOOKING = { date, time, trainer };
    const modal = document.getElementById('bookingModal');
    
    document.getElementById('bookingDetailsText').innerHTML = `
        Assigning to <strong style="color:var(--primary);">${escapeHtml(trainer)}</strong><br>
        ${escapeHtml(date)} @ ${escapeHtml(time)}`;
    
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
    
    trainees.sort().forEach(t => { traineeSelectHtml += `<option value="${escapeHtmlAttr(t)}">${escapeHtml(t)}</option>`; });
    traineeSelectHtml += `</select>`;
    
    let extraDiv = document.getElementById('adminBookingExtra');
    if (!extraDiv) {
        extraDiv = document.createElement('div');
        extraDiv.id = 'adminBookingExtra';
        assessSelect.parentNode.insertBefore(extraDiv, assessSelect);
    }
    extraDiv.innerHTML = traineeSelectHtml;

    const catalog = buildLiveAssessmentCatalog();
    const liveAssessments = Array.from(catalog.byTitle.values()).sort((a, b) => a.title.localeCompare(b.title));
    liveAssessments.forEach(assessment => {
        const opt = new Option(assessment.title, assessment.title);
        if (assessment.id) opt.dataset.testId = assessment.id;
        assessSelect.add(opt);
    });

    const confirmBtn = document.querySelector('#bookingModal .btn-primary');
    confirmBtn.setAttribute('onclick', 'confirmAdminBooking()');

    modal.classList.remove('hidden');
};

window.confirmAdminBooking = async function() {
    if (!isLiveBookingManager()) return;
    if(!PENDING_BOOKING) return;
    
    const trainee = document.getElementById('adminBookingTrainee').value;
    const assessMeta = getSelectedAssessmentMeta(document.getElementById('bookingAssessment'));
    const assess = assessMeta.title;
    
    if (!trainee) return alert("Select a trainee.");
    if (!assess) return alert("Select an assessment.");

    const btn = document.querySelector('#bookingModal .btn-primary');
    if(btn) { btn.innerText = "Assigning..."; btn.disabled = true; }
    let optimisticSnapshot = null;

    try {
        if (window.supabaseClient) {
            // Check for conflicts directly on the server
            const { data: conflict, error: conflictErr } = await window.supabaseClient.from('live_bookings').select('id').eq('data->>date', PENDING_BOOKING.date).eq('data->>time', PENDING_BOOKING.time).eq('data->>trainer', PENDING_BOOKING.trainer).neq('data->>status', 'Cancelled');
            if (conflictErr) throw conflictErr;
            if (conflict && conflict.length > 0) return alert("This slot is already taken.");
            
            // Check for duplicate assessment for this trainee directly on the server
            let dupAssess = null;
            if (assessMeta.id) {
                const res = await window.supabaseClient.from('live_bookings')
                    .select('id')
                    .ilike('data->>trainee', trainee)
                    .eq('data->>assessmentId', String(assessMeta.id))
                    .neq('data->>status', 'Cancelled');
                    if (res.error) throw res.error;
                dupAssess = res.data;
            }
            if (!dupAssess || dupAssess.length === 0) {
                const res = await window.supabaseClient.from('live_bookings')
                .select('id')
                .ilike('data->>trainee', trainee)
                .ilike('data->>assessment', assess)
                .neq('data->>status', 'Cancelled');
                if (res.error) throw res.error;
                dupAssess = res.data;
            }
                
            if (dupAssess && dupAssess.length > 0) return alert(`Agent ${trainee} already has a booking for '${assess}'.`);
        }

        const existingBookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
        const localSlotConflict = existingBookings.some(b =>
            b.status !== 'Cancelled' &&
            b.date === PENDING_BOOKING.date &&
            b.time === PENDING_BOOKING.time &&
            b.trainer === PENDING_BOOKING.trainer
        );
        if (localSlotConflict) return alert("This slot is already taken.");

        const localHourConflict = existingBookings.some(b =>
            b.status !== 'Cancelled' &&
            bookingMatchesTrainee(b, trainee) &&
            b.date === PENDING_BOOKING.date &&
            b.time === PENDING_BOOKING.time
        );
        if (localHourConflict) return alert(`Agent ${trainee} already has another booking in this hour.`);

        const localDupAssess = existingBookings.some(b =>
            b.status !== 'Cancelled' &&
            bookingMatchesTrainee(b, trainee) &&
            bookingMatchesAssessment(b, assessMeta)
        );
        if (localDupAssess) return alert(`Agent ${trainee} already has a booking for '${assess}'.`);

        const nowIso = new Date().toISOString();
        const newBooking = {
            id: createLiveBookingId(),
            date: PENDING_BOOKING.date,
            time: PENDING_BOOKING.time,
            trainer: PENDING_BOOKING.trainer,
            trainee: trainee,
            assessment: assess,
            assessmentId: assessMeta.id || null,
            status: 'Booked',
            createdAt: nowIso,
            lastModified: nowIso,
            modifiedBy: CURRENT_USER?.user || 'system'
        };
        
        // Optimistic UI Update
        const bookings = existingBookings;
        optimisticSnapshot = JSON.stringify(bookings);
        bookings.push(newBooking);
        localStorage.setItem('liveBookings', JSON.stringify(bookings));
        closeBookingModal();
        renderLiveTable();

        // Direct Supabase call
        if (window.supabaseClient) {
            const { error } = await window.supabaseClient.from('live_bookings').insert({ id: newBooking.id, data: newBooking, trainee: newBooking.trainee, updated_at: new Date().toISOString() });
            if (error) throw error;
        }
        if (typeof updateNotifications === 'function') updateNotifications();

    } catch(e) {
        console.error(e);
        if (typeof showToast === 'function') showToast("Failed to assign trainee. Reverting local change.", "error");
        if (optimisticSnapshot) {
            localStorage.setItem('liveBookings', optimisticSnapshot);
            renderLiveTable();
        }
        if (typeof loadFromServer === 'function') {
            await loadFromServer(true);
        }
        alert("Failed to assign trainee.");
    } finally {
        if(btn) { btn.innerText = "Confirm"; btn.disabled = false; }
    }
};
// UPDATED: CONFIRM BOOKING WITH CONFLICT DETECTION
async function confirmBooking() {
    if(!PENDING_BOOKING) return;
    
    const assessMeta = getSelectedAssessmentMeta(document.getElementById('bookingAssessment'));
    const assess = assessMeta.title;
    if(!assess) return alert("Select an assessment.");

    // UI FEEDBACK: Prevent double clicks
    const btn = document.querySelector('#bookingModal .btn-primary');
    if(btn) { btn.innerText = "Checking Availability..."; btn.disabled = true; }
    let optimisticSnapshot = null;

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
                
            if (error) throw error;
            if (conflict && conflict.length > 0) {
                alert("This slot was just taken by another user. Please choose another time.");
                closeBookingModal();
                if(typeof loadFromServer === 'function') await loadFromServer(true); // Heal local state
                renderLiveTable(); 
                return;
            }
            
            // ATOMIC DUPLICATE ASSESSMENT CHECK
            let dupAssess = null;
            if (assessMeta.id) {
                const res = await window.supabaseClient.from('live_bookings')
                    .select('id')
                    .ilike('data->>trainee', CURRENT_USER.user)
                    .eq('data->>assessmentId', String(assessMeta.id))
                    .neq('data->>status', 'Cancelled');
                if (res.error) throw res.error;
                dupAssess = res.data;
            }
            if (!dupAssess || dupAssess.length === 0) {
                const res = await window.supabaseClient.from('live_bookings')
                    .select('id')
                    .ilike('data->>trainee', CURRENT_USER.user)
                    .ilike('data->>assessment', assess)
                    .neq('data->>status', 'Cancelled');
                if (res.error) throw res.error;
                dupAssess = res.data;
            }
                
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
            bookingMatchesTrainee(b, CURRENT_USER.user) && 
            b.status !== 'Cancelled'
        );
        if(isUserBookedThisHour) {
            alert("You have already booked a session for this hour with the other trainer.\nYou are only allowed 1 session per hour.");
            return;
        }

        // VALIDATION 3: Duplicate Assessment?
        const existingBooking = bookings.find(b => 
            bookingMatchesTrainee(b, CURRENT_USER.user) &&
            bookingMatchesAssessment(b, assessMeta) &&
            b.status !== 'Cancelled'
        );
        
        if(existingBooking) {
            alert(`You already have an active booking for '${assess}'.\n\nFound active booking on: ${existingBooking.date} at ${existingBooking.time}.\n\nPlease check the schedule.`);
            return;
        }

        // CREATE BOOKING
        const nowIso = new Date().toISOString();
        const newBooking = {
            id: createLiveBookingId(),
            date: PENDING_BOOKING.date,
            time: PENDING_BOOKING.time,
            trainer: PENDING_BOOKING.trainer,
            trainee: CURRENT_USER.user,
            assessment: assess,
            assessmentId: assessMeta.id || null,
            status: 'Booked',
            createdAt: nowIso,
            lastModified: nowIso,
            modifiedBy: CURRENT_USER?.user || 'system'
        };

        // Optimistic UI Update
        optimisticSnapshot = JSON.stringify(bookings);
        bookings.push(newBooking);
        localStorage.setItem('liveBookings', JSON.stringify(bookings));
        closeBookingModal();
        renderLiveTable();

        // Direct Supabase call
        if (window.supabaseClient) {
            const { error } = await window.supabaseClient.from('live_bookings').insert({ id: newBooking.id, data: newBooking, trainee: newBooking.trainee, updated_at: new Date().toISOString() });
            if (error) throw error;
        }

        if(typeof updateNotifications === 'function') updateNotifications();

    } catch (e) {
        console.error("Booking Error:", e);
        if (typeof showToast === 'function') showToast("Booking failed. Reverting local change.", "error");
        if (optimisticSnapshot) {
            localStorage.setItem('liveBookings', optimisticSnapshot);
            renderLiveTable();
        }
        if (typeof loadFromServer === 'function') {
            await loadFromServer(true);
        } else {
            renderLiveTable();
        }
        alert("An error occurred while connecting to the schedule server. Please try again.");
    } finally {
        if(btn) { btn.innerText = "Confirm Booking"; btn.disabled = false; }
    }
}

async function cancelBooking(id) {
    // ARCHITECTURAL FIX: DOUBLE-CLICK CANCELLATION RACE CONDITION
    if (window._isCancelling === id) return;
    window._isCancelling = id;
    const lockId = id;
    let bookingSnapshot = null;
    try {
        if(!confirm("Are you sure you want to cancel this booking?")) return;

        const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
        const target = bookings.find(b => String(b.id) === String(id));
        if (!target) return;

        const canManage = isLiveBookingManager();
        const isOwner = bookingMatchesTrainee(target, CURRENT_USER.user);
        if (!canManage && !isOwner) {
            alert("You do not have permission to cancel this booking.");
            return;
        }

        // CHECK CANCELLATION POLICY
        const countSnapshot = localStorage.getItem('cancellationCounts') || '{}';
        if(CURRENT_USER.role === 'trainee' && !canManage) {
            const counts = JSON.parse(countSnapshot);
            const myCount = counts[CURRENT_USER.user] || 0;
            if(myCount >= 1) {
                alert("Cancellation Limit Reached.\n\nPlease contact your trainer to change this booking.");
                return;
            }
        }

        bookingSnapshot = JSON.stringify(bookings);
        target.status = 'Cancelled';
        target.cancelledBy = CURRENT_USER.user;
        target.cancelledAt = new Date().toISOString();
        target.lastModified = new Date().toISOString();
        target.modifiedBy = CURRENT_USER?.user || 'system';

        // Optimistic UI Update
        localStorage.setItem('liveBookings', JSON.stringify(bookings));
        renderLiveTable();

        // Direct Supabase call
        if (window.supabaseClient) {
            const { error } = await window.supabaseClient.from('live_bookings').update({ data: target, updated_at: new Date().toISOString() }).eq('id', target.id);
            if (error) throw error;
        }
        
        // Increment cancellation count only after successful cancel write
        if(CURRENT_USER.role === 'trainee' && !canManage) {
            const counts = JSON.parse(countSnapshot);
            const myCount = counts[CURRENT_USER.user] || 0;
            counts[CURRENT_USER.user] = myCount + 1;
            localStorage.setItem('cancellationCounts', JSON.stringify(counts));
            if(typeof saveToServer === 'function') await saveToServer(['cancellationCounts'], true);
        }
        if (typeof updateNotifications === 'function') updateNotifications();
    } catch (error) {
        console.error(error);
        alert("Failed to cancel booking.");
        if (typeof bookingSnapshot === 'string') {
            localStorage.setItem('liveBookings', bookingSnapshot);
        }
        if (typeof loadFromServer === 'function') await loadFromServer(true);
        renderLiveTable();
    } finally {
        setTimeout(() => {
            if (window._isCancelling === lockId) window._isCancelling = null;
        }, 300);
    }
}

async function markBookingComplete(id) {
    if (!isLiveBookingManager()) return;
    const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');
    const target = bookings.find(b => String(b.id) === String(id));
    if(!target) return;

    const snapshot = JSON.stringify(bookings);
    target.status = 'Completed';
    target.lastModified = new Date().toISOString();
    target.modifiedBy = CURRENT_USER?.user || 'system';
    
    // Optimistic UI Update
    localStorage.setItem('liveBookings', JSON.stringify(bookings));
    renderLiveTable();

    try {
        if (window.supabaseClient) {
            const { error } = await window.supabaseClient.from('live_bookings').update({ data: target, updated_at: new Date().toISOString() }).eq('id', target.id);
            if (error) throw error;
        }
        if (typeof updateNotifications === 'function') updateNotifications();
    } catch (error) {
        alert("Failed to update booking.");
        console.error(error);
        localStorage.setItem('liveBookings', snapshot);
        if(typeof loadFromServer === 'function') await loadFromServer(true);
        renderLiveTable();
    }
}

// --- ADMIN SETTINGS ---

async function saveLiveScheduleSettings() {
    if (!isLiveBookingManager()) return;
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
    if (!isLiveBookingManager()) return;
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

function stampScheduleEntity(target, touch = false) {
    if (!target || typeof target !== 'object') return target;
    if (typeof applyDataTimestamps === 'function') {
        applyDataTimestamps(target, { touch });
        return target;
    }

    const now = new Date().toISOString();
    if (!target.createdAt) target.createdAt = now;
    if (!target.lastModified) target.lastModified = target.createdAt;
    if (!target.modifiedBy) target.modifiedBy = (CURRENT_USER && (CURRENT_USER.user || CURRENT_USER.role)) || 'system';
    if (touch) {
        target.lastModified = now;
        target.modifiedBy = (CURRENT_USER && (CURRENT_USER.user || CURRENT_USER.role)) || 'system';
    }
    return target;
}

function stampScheduleGroup(group, options = {}) {
    if (!group || typeof group !== 'object') return;

    stampScheduleEntity(group, Boolean(options.touchGroup));
    if (!Array.isArray(group.items)) return;

    if (options.touchAllItems) {
        group.items.forEach(item => stampScheduleEntity(item, true));
        return;
    }

    if (typeof options.itemIndex === 'number' && group.items[options.itemIndex]) {
        stampScheduleEntity(group.items[options.itemIndex], true);
    }
}

function getScheduleTemplates() {
    const raw = JSON.parse(localStorage.getItem(SCHEDULE_TEMPLATE_STORAGE_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(t => t && typeof t === 'object' && Array.isArray(t.items))
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function saveScheduleTemplates(templates) {
    localStorage.setItem(SCHEDULE_TEMPLATE_STORAGE_KEY, JSON.stringify(Array.isArray(templates) ? templates : []));
}

function normalizeTemplateEditorItem(item, index) {
    const cloned = JSON.parse(JSON.stringify(item || {}));
    delete cloned.dateRange;
    delete cloned.dueDate;
    delete cloned.createdAt;
    delete cloned.lastModified;
    delete cloned.modifiedBy;
    cloned.courseName = String(cloned.courseName || '').trim() || `Step ${index + 1}`;
    cloned.durationDays = normalizeDurationDays(cloned.durationDays) || inferScheduleDurationDays(cloned) || 1;
    return cloned;
}

function sanitizeTemplateEditorItems(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item, index) => normalizeTemplateEditorItem(item, index));
}

function ensureScheduleTemplateManagerModal() {
    let modal = document.getElementById(SCHEDULE_TEMPLATE_MANAGER_MODAL_ID);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = SCHEDULE_TEMPLATE_MANAGER_MODAL_ID;
    modal.className = 'modal-overlay hidden';
    modal.style.zIndex = '12010';
    modal.innerHTML = `
        <div class="modal-box" style="width:860px; max-width:95%;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <h3 style="margin:0;">Schedule Template Manager</h3>
                <button class="btn-secondary btn-sm" onclick="closeScheduleTemplateManager()"><i class="fas fa-times"></i></button>
            </div>
            <div style="display:grid; grid-template-columns:1fr 180px; gap:10px; margin-bottom:10px;">
                <div>
                    <label for="scheduleTemplateSelect">Template</label>
                    <select id="scheduleTemplateSelect" onchange="loadScheduleTemplateIntoEditor(this.value)"></select>
                </div>
                <div style="display:flex; align-items:flex-end;">
                    <button class="btn-secondary" style="width:100%;" onclick="startNewScheduleTemplateDraft()">+ New Template</button>
                </div>
            </div>
            <label for="scheduleTemplateNameInput">Template Name</label>
            <input type="text" id="scheduleTemplateNameInput" placeholder="e.g. Month 1 Intake">
            <div style="margin:10px 0; padding:10px; border:1px dashed var(--border-color); border-radius:8px; font-size:0.85rem; color:var(--text-muted);">
                Editable fields per timeline step: <strong>Course Name</strong> and <strong>Duration (Business Days)</strong>. Start/end dates are auto-calculated when a template is applied.
            </div>
            <div id="scheduleTemplateRows" style="max-height:48vh; overflow:auto; padding-right:4px;"></div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px;">
                <button class="btn-secondary btn-sm" onclick="addScheduleTemplateEditorRow()"><i class="fas fa-plus"></i> Add Timeline Step</button>
                <div style="display:flex; gap:8px;">
                    <button class="btn-danger btn-sm" onclick="deleteScheduleTemplateFromEditor()"><i class="fas fa-trash"></i> Delete Template</button>
                    <button class="btn-secondary" onclick="closeScheduleTemplateManager()">Close</button>
                    <button class="btn-primary" onclick="saveScheduleTemplateFromEditor()">Save Template</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}

function syncScheduleTemplateEditorStateFromInputs() {
    if (!SCHEDULE_TEMPLATE_EDITOR_STATE) return;
    const nameInput = document.getElementById('scheduleTemplateNameInput');
    if (nameInput) {
        SCHEDULE_TEMPLATE_EDITOR_STATE.templateName = String(nameInput.value || '').trim();
    }

    const rowsContainer = document.getElementById('scheduleTemplateRows');
    if (!rowsContainer) return;

    const rowEls = Array.from(rowsContainer.querySelectorAll('[data-template-row]'));
    const previousItems = Array.isArray(SCHEDULE_TEMPLATE_EDITOR_STATE.items) ? SCHEDULE_TEMPLATE_EDITOR_STATE.items : [];
    SCHEDULE_TEMPLATE_EDITOR_STATE.items = rowEls.map((rowEl, rowIndex) => {
        const prior = JSON.parse(JSON.stringify(previousItems[rowIndex] || {}));
        const nameEl = rowEl.querySelector('.tpl-course-name');
        const durationEl = rowEl.querySelector('.tpl-duration-days');
        prior.courseName = String(nameEl ? nameEl.value : '').trim() || `Step ${rowIndex + 1}`;
        prior.durationDays = normalizeDurationDays(durationEl ? durationEl.value : '') || 1;
        return normalizeTemplateEditorItem(prior, rowIndex);
    });
}

function renderScheduleTemplateEditorRows() {
    const rowsContainer = document.getElementById('scheduleTemplateRows');
    if (!rowsContainer || !SCHEDULE_TEMPLATE_EDITOR_STATE) return;

    const safeItems = sanitizeTemplateEditorItems(SCHEDULE_TEMPLATE_EDITOR_STATE.items);
    SCHEDULE_TEMPLATE_EDITOR_STATE.items = safeItems;
    rowsContainer.innerHTML = safeItems.map((item, idx) => `
        <div data-template-row="1" style="display:grid; grid-template-columns:65px minmax(0, 1fr) 180px 115px; gap:8px; align-items:end; margin-bottom:8px; padding:8px; border:1px solid var(--border-color); border-radius:6px; background:var(--bg-input);">
            <div style="font-size:0.85rem; color:var(--text-muted);">Step ${idx + 1}</div>
            <div>
                <label style="font-size:0.8rem;">Course Name</label>
                <input type="text" class="tpl-course-name" value="${escapeHtml(item.courseName || '')}" placeholder="Timeline title">
            </div>
            <div>
                <label style="font-size:0.8rem;">Duration (Days)</label>
                <input type="number" class="tpl-duration-days" min="1" step="1" value="${item.durationDays || 1}">
            </div>
            <button class="btn-danger btn-sm" onclick="removeScheduleTemplateEditorRow(${idx})"><i class="fas fa-trash"></i></button>
        </div>
    `).join('');
}

function refreshScheduleTemplateSelect(selectedTemplateId = '') {
    const select = document.getElementById('scheduleTemplateSelect');
    if (!select) return;

    const templates = getScheduleTemplates();
    select.innerHTML = '<option value="">-- New Template --</option>';
    templates.forEach(template => {
        const count = Array.isArray(template.items) ? template.items.length : 0;
        const label = `${template.name} (${count} step${count === 1 ? '' : 's'})`;
        select.add(new Option(label, template.id));
    });
    select.value = selectedTemplateId || '';
}

window.startNewScheduleTemplateDraft = function(options = {}) {
    if (!ensureScheduleTemplateAdmin('create schedule templates')) return;
    const prefillItems = Array.isArray(options.prefillItems) ? options.prefillItems : [];
    const normalizedPrefill = sanitizeTemplateEditorItems(prefillItems);
    SCHEDULE_TEMPLATE_EDITOR_STATE = {
        selectedTemplateId: '',
        templateName: String(options.defaultName || '').trim(),
        items: normalizedPrefill.length > 0 ? normalizedPrefill : [{ courseName: 'Step 1', durationDays: 1 }]
    };

    const nameInput = document.getElementById('scheduleTemplateNameInput');
    if (nameInput) nameInput.value = SCHEDULE_TEMPLATE_EDITOR_STATE.templateName;
    refreshScheduleTemplateSelect('');
    renderScheduleTemplateEditorRows();
};

window.loadScheduleTemplateIntoEditor = function(templateId) {
    if (!ensureScheduleTemplateAdmin('edit schedule templates')) return;
    const trimmedId = String(templateId || '').trim();
    if (!trimmedId) {
        window.startNewScheduleTemplateDraft();
        return;
    }

    const templates = getScheduleTemplates();
    const picked = templates.find(template => String(template.id || '') === trimmedId);
    if (!picked) {
        window.startNewScheduleTemplateDraft();
        return;
    }

    SCHEDULE_TEMPLATE_EDITOR_STATE = {
        selectedTemplateId: picked.id,
        templateName: picked.name || '',
        items: sanitizeTemplateEditorItems(picked.items || [])
    };

    const nameInput = document.getElementById('scheduleTemplateNameInput');
    if (nameInput) nameInput.value = SCHEDULE_TEMPLATE_EDITOR_STATE.templateName;
    refreshScheduleTemplateSelect(picked.id);
    renderScheduleTemplateEditorRows();
};

window.addScheduleTemplateEditorRow = function() {
    if (!ensureScheduleTemplateAdmin('edit schedule templates')) return;
    syncScheduleTemplateEditorStateFromInputs();
    if (!SCHEDULE_TEMPLATE_EDITOR_STATE) {
        SCHEDULE_TEMPLATE_EDITOR_STATE = { selectedTemplateId: '', templateName: '', items: [] };
    }
    const nextIndex = SCHEDULE_TEMPLATE_EDITOR_STATE.items.length;
    SCHEDULE_TEMPLATE_EDITOR_STATE.items.push({
        courseName: `Step ${nextIndex + 1}`,
        durationDays: 1
    });
    renderScheduleTemplateEditorRows();
};

window.removeScheduleTemplateEditorRow = function(index) {
    if (!ensureScheduleTemplateAdmin('edit schedule templates')) return;
    syncScheduleTemplateEditorStateFromInputs();
    if (!SCHEDULE_TEMPLATE_EDITOR_STATE || !Array.isArray(SCHEDULE_TEMPLATE_EDITOR_STATE.items)) return;
    const safeIndex = Number(index);
    if (!Number.isFinite(safeIndex) || safeIndex < 0 || safeIndex >= SCHEDULE_TEMPLATE_EDITOR_STATE.items.length) return;
    SCHEDULE_TEMPLATE_EDITOR_STATE.items.splice(safeIndex, 1);
    if (SCHEDULE_TEMPLATE_EDITOR_STATE.items.length === 0) {
        SCHEDULE_TEMPLATE_EDITOR_STATE.items.push({ courseName: 'Step 1', durationDays: 1 });
    }
    renderScheduleTemplateEditorRows();
};

window.closeScheduleTemplateManager = function() {
    const modal = document.getElementById(SCHEDULE_TEMPLATE_MANAGER_MODAL_ID);
    if (modal) modal.classList.add('hidden');
};

window.manageScheduleTemplates = function(options = {}) {
    if (!ensureScheduleTemplateAdmin('manage schedule templates')) return;
    const modal = ensureScheduleTemplateManagerModal();
    modal.classList.remove('hidden');

    if (Array.isArray(options.prefillItems) && options.prefillItems.length > 0) {
        window.startNewScheduleTemplateDraft({
            prefillItems: options.prefillItems,
            defaultName: options.defaultName || ''
        });
        return;
    }

    const templates = getScheduleTemplates();
    const preferredId = String(options.templateId || '').trim();
    const initialTemplateId = preferredId && templates.some(t => String(t.id || '') === preferredId)
        ? preferredId
        : (templates[0] ? templates[0].id : '');

    if (initialTemplateId) {
        window.loadScheduleTemplateIntoEditor(initialTemplateId);
    } else {
        window.startNewScheduleTemplateDraft({
            defaultName: options.defaultName || ''
        });
    }
};

window.saveScheduleTemplateFromEditor = function() {
    if (!ensureScheduleTemplateAdmin('save schedule templates')) return;
    syncScheduleTemplateEditorStateFromInputs();
    if (!SCHEDULE_TEMPLATE_EDITOR_STATE) return;

    const name = String(SCHEDULE_TEMPLATE_EDITOR_STATE.templateName || '').trim();
    if (!name) {
        alert('Template name cannot be empty.');
        return;
    }

    const items = sanitizeTemplateEditorItems(SCHEDULE_TEMPLATE_EDITOR_STATE.items || []);
    if (items.length === 0) {
        alert('Add at least one timeline step to save a template.');
        return;
    }

    const templates = getScheduleTemplates();
    const selectedId = String(SCHEDULE_TEMPLATE_EDITOR_STATE.selectedTemplateId || '').trim();
    let existingIndex = selectedId
        ? templates.findIndex(template => String(template.id || '') === selectedId)
        : -1;

    const nameCollisionIndex = templates.findIndex(template => normalizeScheduleText(template.name) === normalizeScheduleText(name));
    if (nameCollisionIndex >= 0 && nameCollisionIndex !== existingIndex) {
        if (!confirm(`Template "${templates[nameCollisionIndex].name}" already exists. Overwrite it?`)) return;
        existingIndex = nameCollisionIndex;
    }

    const now = new Date().toISOString();
    const templateId = existingIndex >= 0
        ? templates[existingIndex].id
        : `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const nextTemplate = {
        id: templateId,
        name,
        sourceScheduleId: ACTIVE_SCHED_ID,
        itemCount: items.length,
        items,
        createdAt: existingIndex >= 0 ? templates[existingIndex].createdAt : now,
        updatedAt: now
    };

    if (existingIndex >= 0) templates[existingIndex] = nextTemplate;
    else templates.push(nextTemplate);

    saveScheduleTemplates(templates);
    SCHEDULE_TEMPLATE_EDITOR_STATE = {
        selectedTemplateId: templateId,
        templateName: name,
        items: sanitizeTemplateEditorItems(items)
    };
    refreshScheduleTemplateSelect(templateId);
    renderScheduleTemplateEditorRows();
    if (typeof showToast === 'function') showToast(`Template "${name}" saved.`, 'success');
};

window.deleteScheduleTemplateFromEditor = function() {
    if (!ensureScheduleTemplateAdmin('delete schedule templates')) return;
    if (!SCHEDULE_TEMPLATE_EDITOR_STATE || !SCHEDULE_TEMPLATE_EDITOR_STATE.selectedTemplateId) {
        alert('Select a saved template to delete.');
        return;
    }

    const templates = getScheduleTemplates();
    const selectedId = String(SCHEDULE_TEMPLATE_EDITOR_STATE.selectedTemplateId);
    const existingIndex = templates.findIndex(template => String(template.id || '') === selectedId);
    if (existingIndex < 0) {
        alert('Template not found.');
        return;
    }

    const picked = templates[existingIndex];
    if (!confirm(`Delete template "${picked.name}"?`)) return;
    templates.splice(existingIndex, 1);
    saveScheduleTemplates(templates);

    const nextTemplateId = templates[0] ? templates[0].id : '';
    if (nextTemplateId) {
        window.loadScheduleTemplateIntoEditor(nextTemplateId);
    } else {
        window.startNewScheduleTemplateDraft();
    }
    if (typeof showToast === 'function') showToast(`Template "${picked.name}" deleted.`, 'success');
};

function buildTemplateItemsFromScheduleItems(items) {
    if (!Array.isArray(items)) return [];
    return items.map(item => {
        const cloned = JSON.parse(JSON.stringify(item || {}));
        delete cloned.dateRange;
        delete cloned.dueDate;
        delete cloned.createdAt;
        delete cloned.lastModified;
        delete cloned.modifiedBy;
        cloned.durationDays = normalizeDurationDays(cloned.durationDays) || inferScheduleDurationDays(item) || 1;
        return cloned;
    });
}

function buildScheduleItemsFromTemplateItems(templateItems, timelineStartDate) {
    if (!Array.isArray(templateItems)) return [];
    const parsedStart = parseScheduleDateStrict(timelineStartDate);
    if (!parsedStart) return null;

    let cursor = moveToBusinessDay(parsedStart);
    if (!cursor) return null;

    return templateItems.map(sourceItem => {
        const cloned = JSON.parse(JSON.stringify(sourceItem || {}));
        const durationDays = normalizeDurationDays(cloned.durationDays) || inferScheduleDurationDays(cloned) || 1;
        const window = calculateScheduleWindow(formatScheduleDateDash(cursor), durationDays);
        if (!window) throw new Error('Unable to calculate schedule dates from template.');

        cloned.durationDays = durationDays;
        cloned.dateRange = window.dateRange;
        cloned.dueDate = window.endDateSlash;

        delete cloned.createdAt;
        delete cloned.lastModified;
        delete cloned.modifiedBy;

        const endDate = parseScheduleDateStrict(window.endDateDash);
        cursor = endDate ? getNextBusinessDate(endDate) : moveToBusinessDay(new Date());
        return cloned;
    });
}

function resolveScheduleTemplateSelection(input, templates) {
    const value = String(input || '').trim();
    if (!value) return null;

    if (/^\d+$/.test(value)) {
        const idx = Number.parseInt(value, 10) - 1;
        if (idx >= 0 && idx < templates.length) return templates[idx];
    }

    const normalizedValue = normalizeScheduleText(value);
    return templates.find(t => normalizeScheduleText(t.name) === normalizedValue) || null;
}

async function promptForTemplateSelection() {
    if (!ensureScheduleTemplateAdmin('apply schedule templates')) return null;
    const templates = getScheduleTemplates();
    if (templates.length === 0) {
        alert('No saved templates found yet. Save a schedule as template first.');
        return null;
    }

    const optionsText = templates
        .map((template, i) => `${i + 1}. ${template.name} (${(template.items || []).length} items)`)
        .join('\n');

    const selection = await customPrompt(
        'Apply Schedule Template',
        `Choose template by number or name:\n${optionsText}`,
        '1'
    );
    if (selection === null) return null;

    const picked = resolveScheduleTemplateSelection(selection, templates);
    if (!picked) {
        alert('Template selection not recognized.');
        return null;
    }
    return picked;
}

async function applyTemplateToScheduleById(targetScheduleId, template, startDateInput) {
    const schedules = JSON.parse(localStorage.getItem('schedules') || '{}');
    const group = schedules[targetScheduleId];
    if (!group) return false;

    const normalizedStart = normalizeScheduleDateString(startDateInput, '-');
    if (!normalizedStart) {
        alert('Invalid start date. Use YYYY-MM-DD or YYYY/MM/DD.');
        return false;
    }

    let rebuiltItems = [];
    try {
        rebuiltItems = buildScheduleItemsFromTemplateItems(template.items || [], normalizedStart) || [];
    } catch (error) {
        console.error('Failed to apply schedule template:', error);
        alert('Could not apply template. Please validate template items and try again.');
        return false;
    }

    group.items = rebuiltItems;
    stampScheduleGroup(group, { touchGroup: true, touchAllItems: true });
    localStorage.setItem('schedules', JSON.stringify(schedules));
    await secureScheduleSave();

    const requestedStartSlash = normalizeScheduleDateString(normalizedStart, '/');
    const actualStartSlash = rebuiltItems.length > 0 ? getScheduleStartDateFromRange(rebuiltItems[0].dateRange, '/') : requestedStartSlash;
    if (actualStartSlash && requestedStartSlash && actualStartSlash !== requestedStartSlash && typeof showToast === 'function') {
        showToast(`Start date shifted to next business day: ${actualStartSlash}`, 'warning');
    }
    return true;
}

async function promptAndApplyTemplateToSchedule(targetScheduleId, options = {}) {
    if (!ensureScheduleTemplateAdmin('apply schedule templates')) return false;
    const schedules = JSON.parse(localStorage.getItem('schedules') || '{}');
    const group = schedules[targetScheduleId];
    if (!group) return false;

    if (options.confirmReplace !== false && Array.isArray(group.items) && group.items.length > 0) {
        if (!confirm('Applying a template will replace all current timeline items for this schedule. Continue?')) return false;
    }

    const selectedTemplate = await promptForTemplateSelection();
    if (!selectedTemplate) return false;

    const currentStart = Array.isArray(group.items) && group.items[0] ? getScheduleStartDateFromRange(group.items[0].dateRange, '-') : '';
    const suggestedStart = currentStart || getTodayOrNextBusinessDateDash();
    const requestedStart = await customPrompt(
        'Template Start Date',
        'Enter timeline start date (YYYY-MM-DD). Weekends and holidays are skipped automatically.',
        suggestedStart
    );
    if (requestedStart === null) return false;

    const applied = await applyTemplateToScheduleById(targetScheduleId, selectedTemplate, requestedStart);
    if (!applied) return false;

    if (typeof showToast === 'function') {
        showToast(`Template "${selectedTemplate.name}" applied to Schedule ${targetScheduleId}.`, 'success');
    }
    ACTIVE_SCHED_ID = targetScheduleId;
    renderSchedule();
    return true;
}

window.saveCurrentScheduleAsTemplate = async function() {
    alert('Timeline templates are now managed inside Schedule Studio (Assessment Schedule tab).');
};

window.applyTemplateToCurrentSchedule = async function() {
    alert('Use Schedule Studio to add templates to timelines.');
};

window.recalculateCurrentScheduleDates = async function() {
    alert('Use Schedule Studio to recalculate timeline dates.');
};

window.previewScheduleDateFromDuration = function() {
    const startInputEl = document.getElementById('editStartDate');
    const durationInputEl = document.getElementById('editDurationDays');
    const rangeInputEl = document.getElementById('editDateRange');
    const dueInputEl = document.getElementById('editDueDate');
    if (!startInputEl || !durationInputEl || !rangeInputEl || !dueInputEl) return;

    const durationDays = normalizeDurationDays(durationInputEl.value);
    if (!durationDays) return;

    const seedDate =
        startInputEl.value ||
        getScheduleStartDateFromRange(rangeInputEl.value, '-') ||
        normalizeScheduleDateString(dueInputEl.value, '-');
    if (!seedDate) return;

    const calculated = calculateScheduleWindow(seedDate, durationDays);
    if (!calculated) return;

    rangeInputEl.value = calculated.dateRange;
    dueInputEl.value = calculated.endDateSlash;
    startInputEl.value = calculated.startDateDash;
};

async function promptTemplateActionForNewSchedule(scheduleId) {
    if (!isScheduleTemplateAdmin()) return false;
    const templates = getScheduleTemplates();
    const hasTemplates = templates.length > 0;

    return new Promise(resolve => {
        const existing = document.getElementById(NEW_SCHEDULE_TEMPLATE_PROMPT_ID);
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = NEW_SCHEDULE_TEMPLATE_PROMPT_ID;
        modal.className = 'modal-overlay';
        modal.style.zIndex = '12020';
        modal.innerHTML = `
            <div class="modal-box" style="max-width:520px;">
                <h3 style="margin-top:0;">Schedule ${scheduleId} Created</h3>
                <p style="font-size:0.95rem; color:var(--text-muted); margin-bottom:14px;">
                    Add a template now to auto-calculate timeline start/end dates from duration days. Weekends and configured holidays are skipped.
                </p>
                ${hasTemplates ? '' : '<p style="font-size:0.85rem; color:#e67e22; margin-top:-4px; margin-bottom:12px;">No saved templates yet. Use Edit Templates to create one.</p>'}
                <div style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;">
                    <button class="btn-secondary" id="btnNewSchedManageTpl"><i class="fas fa-pen-ruler"></i> Edit Templates</button>
                    <button class="btn-secondary" id="btnNewSchedSkipTpl">Skip for Now</button>
                    <button class="btn-primary" id="btnNewSchedApplyTpl"><i class="fas fa-layer-group"></i> Add Template</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const cleanup = () => {
            const target = document.getElementById(NEW_SCHEDULE_TEMPLATE_PROMPT_ID);
            if (target) target.remove();
        };

        const skipBtn = modal.querySelector('#btnNewSchedSkipTpl');
        const applyBtn = modal.querySelector('#btnNewSchedApplyTpl');
        const manageBtn = modal.querySelector('#btnNewSchedManageTpl');

        skipBtn.onclick = () => {
            cleanup();
            resolve(false);
        };
        manageBtn.onclick = () => {
            cleanup();
            window.manageScheduleTemplates();
            resolve(false);
        };
        applyBtn.onclick = async () => {
            cleanup();
            if (!hasTemplates) {
                window.manageScheduleTemplates({
                    defaultName: `Schedule ${scheduleId} Template`
                });
                resolve(false);
                return;
            }
            const applied = await promptAndApplyTemplateToSchedule(scheduleId, { confirmReplace: false });
            resolve(Boolean(applied));
        };
    });
}

async function createNewSchedule() {
    const schedules = JSON.parse(localStorage.getItem('schedules') || '{}');
    if (!schedules || typeof schedules !== 'object') return;

    const keys = Object.keys(schedules).sort();
    const lastKey = keys.length > 0 ? keys[keys.length - 1] : 'A';
    const nextKey = keys.length > 0 ? String.fromCharCode(lastKey.charCodeAt(0) + 1) : 'A';
    
    if (confirm(`Create new Schedule Group '${nextKey}'?`)) {
        schedules[nextKey] = { items: [], assigned: null };
        stampScheduleGroup(schedules[nextKey], { touchGroup: true });
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
        stampScheduleGroup(schedules[conflict], { touchGroup: true });
    }

    schedules[schedId].assigned = groupId;
    stampScheduleGroup(schedules[schedId], { touchGroup: true });
    localStorage.setItem('schedules', JSON.stringify(schedules));
    await secureScheduleSave();
    renderSchedule();
}

async function clearAssignment(schedId) {
    if(!confirm("Clear assignment?")) return;
    const schedules = JSON.parse(localStorage.getItem('schedules'));
    schedules[schedId].assigned = null;
    stampScheduleGroup(schedules[schedId], { touchGroup: true });
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
    const normalizedUser = normalizeScheduleText(username);
    let myGroupId = null;
    for (const [gid, members] of Object.entries(rosters)) {
        if (Array.isArray(members) && members.some(m => normalizeScheduleText(m) === normalizedUser)) {
            myGroupId = gid;
            break;
        }
    }
    if (!myGroupId) return null;
    const normalizedGroup = normalizeScheduleText(myGroupId);
    return Object.keys(schedules).find(key => normalizeScheduleText(schedules[key] && schedules[key].assigned) === normalizedGroup) || null;
}

// Timeline Item Editing (CRUD)
async function addTimelineItem() {
    const schedules = JSON.parse(localStorage.getItem('schedules'));
    const defaultStart = getTodayOrNextBusinessDateDash();
    const defaultWindow = calculateScheduleWindow(defaultStart, 1);
    schedules[ACTIVE_SCHED_ID].items.push({
        dateRange: defaultWindow ? defaultWindow.dateRange : formatScheduleDateSlash(new Date()),
        courseName: "New Item",
        materialLink: "",
        dueDate: defaultWindow ? defaultWindow.endDateSlash : "",
        durationDays: 1,
        openTime: "08:00",
        closeTime: "17:00"
    });
    stampScheduleGroup(schedules[ACTIVE_SCHED_ID], {
        touchGroup: true,
        itemIndex: schedules[ACTIVE_SCHED_ID].items.length - 1
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
    stampScheduleGroup(schedules[ACTIVE_SCHED_ID], { touchGroup: true });
    localStorage.setItem('schedules', JSON.stringify(schedules));
    // FIX: Use force=true to prevent ghost data (merge restoring deleted item)
    if(typeof saveToServer === 'function') await saveToServer(['schedules'], true);
    renderSchedule();
}

function editTimelineItem(index) {
    const schedules = JSON.parse(localStorage.getItem('schedules'));
    const item = schedules[ACTIVE_SCHED_ID].items[index];
    const inferredDuration = inferScheduleDurationDays(item);
    const startDateDash = getScheduleStartDateFromRange(item.dateRange, '-');
    document.getElementById('editStepIndex').value = index;
    document.getElementById('editStepType').value = ACTIVE_SCHED_ID; 
    document.getElementById('editDateRange').value = item.dateRange || '';
    document.getElementById('editCourseName').value = item.courseName || '';
    document.getElementById('editMaterialLink').value = item.materialLink || '';
    document.getElementById('editMaterialAlways').checked = item.materialAlways || false;
    document.getElementById('editDueDate').value = item.dueDate || '';
    const startDateEl = document.getElementById('editStartDate');
    if (startDateEl) startDateEl.value = startDateDash || '';
    const durationEl = document.getElementById('editDurationDays');
    if (durationEl) durationEl.value = normalizeDurationDays(item.durationDays) || inferredDuration || '';
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
    const startInputEl = document.getElementById('editStartDate');
    const durationInputEl = document.getElementById('editDurationDays');
    const manualDateRange = String(document.getElementById('editDateRange').value || '').trim();
    const manualDueDate = String(document.getElementById('editDueDate').value || '').trim();
    const durationDays = durationInputEl ? normalizeDurationDays(durationInputEl.value) : null;

    if (durationDays) {
        const startSeed =
            (startInputEl && startInputEl.value) ||
            getScheduleStartDateFromRange(manualDateRange, '-') ||
            normalizeScheduleDateString(manualDueDate, '-');
        if (!startSeed) {
            alert('Please provide a valid start date when duration is enabled.');
            return;
        }
        const calculated = calculateScheduleWindow(startSeed, durationDays);
        if (!calculated) {
            alert('Could not calculate dates. Please verify start date and duration.');
            return;
        }
        item.durationDays = durationDays;
        item.dateRange = calculated.dateRange;
        item.dueDate = calculated.endDateSlash;
        if (startInputEl) startInputEl.value = calculated.startDateDash;
        document.getElementById('editDateRange').value = calculated.dateRange;
        document.getElementById('editDueDate').value = calculated.endDateSlash;
    } else {
        item.dateRange = manualDateRange;
        item.dueDate = normalizeScheduleDateString(manualDueDate, '/') || manualDueDate;
        delete item.durationDays;
    }

    item.courseName = document.getElementById('editCourseName').value;
    item.materialLink = cleanSharePointUrl(document.getElementById('editMaterialLink').value);
    item.materialAlways = document.getElementById('editMaterialAlways').checked;
    item.assessmentLink = cleanSharePointUrl(document.getElementById('editAssessmentLink').value);
    item.openTime = document.getElementById('editStartTime').value;
    item.closeTime = document.getElementById('editEndTime').value;
    item.ignoreTime = document.getElementById('editIgnoreTime').checked;
    
    // NEW: Save Flags
    item.isVetting = document.getElementById('editIsVetting').checked;
    item.isLive = document.getElementById('editIsLive').checked;
    
    const linked = document.getElementById('editLinkedTest').value;
    if (linked) item.linkedTestId = linked; else delete item.linkedTestId;

    stampScheduleGroup(schedules[schedId], { touchGroup: true, itemIndex: Number(index) });
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
        stampScheduleGroup(schedules[targetId], { touchGroup: true, touchAllItems: true });
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
        stampScheduleGroup(schedules[nextKey], { touchGroup: true, touchAllItems: true });
        localStorage.setItem('schedules', JSON.stringify(schedules));
        await secureScheduleSave();
        switchScheduleTab(nextKey);
    }
}

function isDateInRange(dateRangeStr, dueDateStr, specificDateStr) {
    const safeRange = String(dateRangeStr || '').trim();
    if (safeRange === "Always Available") return true;
    
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
    if (safeRange.includes('-') && safeRange.length > 11) {
        const parts = safeRange.split('-').map(s => s.trim().replace(/-/g, '/'));
        start = parts[0]; end = parts[1];
    } else if (safeRange) {
        start = safeRange.replace(/-/g, '/');
        end = start;
    }

    if (dueDateStr) {
        end = dueDateStr.trim().replace(/-/g, '/');
    }

    return target >= start && target <= end;
}

function getScheduleStatus(dateRangeStr, dueDateStr) {
    const safeRange = String(dateRangeStr || '').trim();
    if (safeRange === "Always Available") return 'active';
    if (!safeRange) return 'upcoming';
    
    // Normalize dates to YYYY/MM/DD for consistent string comparison
    const normalize = (d) => d ? d.replace(/-/g, '/').trim() : '';
    
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const today = `${y}/${m}/${d}`;
    
    let start = "", end = "";
    if (safeRange.includes('-') && safeRange.length > 11) {
        const parts = safeRange.split('-').map(s => normalize(s));
        start = parts[0]; end = parts[1];
    } else {
        start = normalize(safeRange); end = normalize(safeRange);
    }

    if (dueDateStr) {
        end = normalize(dueDateStr);
    }

    if (today < start) return 'upcoming';
    if (today > end) return 'past';
    
    return 'active';
}

function isAssessmentDay(dateRangeStr, dueDateStr) {
    const safeRange = String(dateRangeStr || '').trim();
    if (safeRange === "Always Available") return true;
    if (!safeRange) return false;
    
    const normalize = (d) => d ? d.replace(/-/g, '/').trim() : '';
    
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const today = `${y}/${m}/${d}`;
    
    let end = "";
    if (safeRange.includes('-') && safeRange.length > 11) {
        const parts = safeRange.split('-').map(s => normalize(s));
        end = parts[1];
    } else {
        end = normalize(safeRange);
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
    
    const previousSchedulesJson = localStorage.getItem('schedules');
    const schedules = JSON.parse(previousSchedulesJson);
    delete schedules[id];
    
    const oldKeys = Object.keys(schedules).sort();
    const newSchedules = {};
    if (oldKeys.length === 0) {
        newSchedules["A"] = { items: [], assigned: null };
        stampScheduleGroup(newSchedules["A"], { touchGroup: true });
    } else {
        oldKeys.forEach((oldKey, index) => {
            const newKey = String.fromCharCode(65 + index); // 65 = 'A'
            newSchedules[newKey] = schedules[oldKey];
            if (oldKey !== newKey) stampScheduleGroup(newSchedules[newKey], { touchGroup: true });
        });
    }
    
    localStorage.setItem('schedules', JSON.stringify(newSchedules));

    // AUTHORITATIVE DELETE: Push the new snapshot, and roll back local state if the save fails.
    if(typeof saveToServer === 'function') {
        const success = await saveToServer(['schedules'], true);
        if (!success) {
            if (previousSchedulesJson) localStorage.setItem('schedules', previousSchedulesJson);
            alert("Failed to delete schedule from server. Please check connection.");
            return; // Abort on failure
        }
    }
    
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
        stampScheduleGroup(schedules[ACTIVE_SCHED_ID], { touchGroup: true });
        localStorage.setItem('schedules', JSON.stringify(schedules));
        await secureScheduleSave();
        renderSchedule();
    }
    return false;
}

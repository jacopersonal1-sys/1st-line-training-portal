/* ================= STUDY MONITOR & ACTIVITY TRACKER ================= */
/* Handles the internal Study Window and tracks user activity/productivity */

const StudyMonitor = {
    currentActivity: "Idle",
    startTime: Date.now(),
    history: [],
    syncInterval: null,
    clickCount: 0, // New: Track clicks
    isStudyOpen: false,
    activeWebview: null,
    viewMode: 'list', // 'list' or 'summary'

    init: function() {
        if (this.syncInterval) clearInterval(this.syncInterval);
        
        // Start periodic sync (every 10s)
        this.syncInterval = setInterval(() => this.sync(), 10000);
        this.track("System: App Loaded");

        // --- DAILY ARCHIVE CHECK ---
        this.checkDailyReset();

        // --- FAIL-SAFE: RECOVER UNSYNCED EXIT DATA ---
        // If the app closed before syncing the last event, recover it now.
        const unsynced = localStorage.getItem('monitor_unsynced');
        if (unsynced) {
            try {
                const payload = JSON.parse(unsynced);
                // Merge into current data
                let monitorData = JSON.parse(localStorage.getItem('monitor_data') || '{}');
                monitorData[payload.user] = payload;
                localStorage.setItem('monitor_data', JSON.stringify(monitorData));
                
                // Clear the emergency flag and force sync
                localStorage.removeItem('monitor_unsynced');
                this.sync(); 
            } catch(e) { console.error("Monitor Recovery Failed", e); }
        }

        // --- TRACK EXTERNAL ACTIVITY ---
        window.addEventListener('blur', () => {
            if (CURRENT_USER && CURRENT_USER.role === 'trainee') {
                this.track("External Activity (App Backgrounded)");
            }
        });
        window.addEventListener('focus', () => {
            if (CURRENT_USER && CURRENT_USER.role === 'trainee') {
                this.track("Resumed App Activity");
            }
        });

        // --- NEW: CAPTURE EXIT ---
        window.addEventListener('beforeunload', () => {
            if (CURRENT_USER && CURRENT_USER.role === 'trainee') {
                this.track("App Closed / Refreshed");
                // Attempt synchronous local save to ensure data isn't lost
                const payload = {
                    user: CURRENT_USER.user,
                    current: this.currentActivity,
                    since: this.startTime,
                    isStudyOpen: this.isStudyOpen,
                    history: this.history
                };
                
                // Save to emergency key to survive the next Cloud Pull
                localStorage.setItem('monitor_unsynced', JSON.stringify(payload));
                // Also try standard save just in case
                let md = JSON.parse(localStorage.getItem('monitor_data') || '{}');
                md[CURRENT_USER.user] = payload;
                localStorage.setItem('monitor_data', JSON.stringify(md));
            }
        });
    },

    // --- CORE TRACKING ---
    track: function(activityName) {
        const now = Date.now();
        const duration = now - this.startTime;

        // Log previous activity if it lasted > 1 second
        if (duration > 1000) {
            this.history.push({
                activity: this.currentActivity,
                start: this.startTime,
                end: now,
                duration: duration,
                clicks: this.clickCount // Save clicks for this session
            });
        }

        // Prune history (Keep last 50 entries to save bandwidth)
        if (this.history.length > 50) this.history.shift();

        this.currentActivity = activityName;
        this.startTime = now;
        this.clickCount = 0; // Reset click count for new activity
        
        // Instant local save (optional)
        // this.sync(); 
    },

    recordClick: function() {
        this.clickCount++;
    },

    sync: async function() {
        if (!CURRENT_USER || CURRENT_USER.role === 'admin') return; // Don't track admins

        const payload = {
            user: CURRENT_USER.user,
            current: this.currentActivity,
            since: this.startTime,
            isStudyOpen: this.isStudyOpen,
            history: this.history
        };

        // We use a specific key in app_documents for monitoring to avoid bloating 'sessions'
        // We read-modify-write the 'monitor_data' object
        if (window.supabaseClient) {
            try {
                // 1. Get current monitor data (Optimistic)
                let monitorData = JSON.parse(localStorage.getItem('monitor_data') || '{}');
                
                // 2. Update my entry
                monitorData[CURRENT_USER.user] = payload;
                localStorage.setItem('monitor_data', JSON.stringify(monitorData));

                // 3. Push to Cloud (Safe Merge handled by data.js logic usually, but here we might overwrite)
                // For high-frequency data, we might want a dedicated table, but sticking to app_documents:
                // We will use a "Blind Write" to a specific key if possible, or just rely on data.js
                // To avoid race conditions with other users, we should ideally use a separate row per user.
                // BUT, sticking to the requested architecture:
                
                // UPDATED: Force a silent background push to ensure Admin sees this.
                // We use 'false' for safe merge and 'true' for silent mode.
                if (typeof saveToServer === 'function') saveToServer(['monitor_data'], false, true);
                
            } catch (e) {
                console.error("Monitor Sync Error", e);
            }
        }
    },

    // --- DAILY ARCHIVE LOGIC ---
    checkDailyReset: async function() {
        if (!CURRENT_USER || CURRENT_USER.role === 'admin') return;
        
        let monitorData = JSON.parse(localStorage.getItem('monitor_data') || '{}');
        let myData = monitorData[CURRENT_USER.user];
        
        if (myData) {
            // Check if data is from a previous day
            const lastDate = myData.date || new Date(myData.since).toISOString().split('T')[0];
            const today = new Date().toISOString().split('T')[0];
            
            if (lastDate !== today) {
                console.log("New Day Detected. Archiving Activity Log...");
                let history = JSON.parse(localStorage.getItem('monitor_history') || '[]');
                
                // Calculate summary stats for the archive
                let totalMs = 0, studyMs = 0, extMs = 0, idleMs = 0;
                (myData.history || []).forEach(h => {
                    totalMs += h.duration;
                    if(h.activity.toLowerCase().includes('studying')) studyMs += h.duration;
                    else if(h.activity.toLowerCase().includes('external')) extMs += h.duration;
                    else idleMs += h.duration;
                });

                history.push({
                    date: lastDate,
                    user: CURRENT_USER.user,
                    summary: { study: studyMs, external: extMs, idle: idleMs, total: totalMs },
                    details: myData.history // Archive full details
                });
                
                localStorage.setItem('monitor_history', JSON.stringify(history));
                
                // Reset Live Data for Today
                monitorData[CURRENT_USER.user] = { current: 'System: New Day Start', since: Date.now(), isStudyOpen: false, history: [], date: today };
                localStorage.setItem('monitor_data', JSON.stringify(monitorData));
                
                // ROBUSTNESS FIX: Use 'false' (Safe Merge) to prevent overwriting other users' history entries
                if (typeof saveToServer === 'function') await saveToServer(['monitor_data', 'monitor_history'], false);
            }
        }
    },

    // --- STUDY WINDOW UI ---
    openStudyWindow: function(url, title) {
        const overlay = document.getElementById('study-overlay');
        const container = document.getElementById('study-webview-container');
        const titleEl = document.getElementById('study-title');

        if (!overlay || !container) return;

        this.isStudyOpen = true;
        this.track(`Studying: ${title}`);

        this.clickCount = 0; // Reset for this material
        titleEl.innerText = title;
        container.innerHTML = ''; // Clear previous

        // Create Webview
        const webview = document.createElement('webview');
        webview.src = this.cleanUrl(url);
        webview.partition = 'persist:study'; // ENABLE PERSISTENCE (Microsoft Login)
        webview.style.width = '100%';
        webview.style.height = '100%';
        webview.setAttribute('allowpopups', 'true');
        
        this.activeWebview = webview;
        
        // Event Listeners for Tracking
        webview.addEventListener('did-start-loading', () => {
            titleEl.innerHTML = `${title} <small>(Loading...)</small>`;
        });

        webview.addEventListener('did-stop-loading', () => {
            titleEl.innerText = title;
        });

        webview.addEventListener('did-navigate', (e) => {
            // Track internal navigation (e.g. clicking links in Genially/SharePoint)
            // We try to extract a meaningful name from the URL
            let subPage = "Content";
            if (e.url.includes('.pdf')) subPage = "PDF Document";
            else if (e.url.includes('sharepoint')) subPage = "SharePoint Doc";
            else if (e.url.includes('genially')) subPage = "Interactive Flow";
            
            this.track(`Studying: ${title} (${subPage})`);
            
            // Auto-fix SharePoint redirects that add ?web=1
            if (e.url.includes('web=1') && e.url.toLowerCase().includes('.pdf')) {
                const clean = this.cleanUrl(e.url);
                if (clean !== e.url) webview.src = clean;
            }
        });

        // Force new windows to open in the same webview (Keep them captured)
        webview.addEventListener('new-window', (e) => {
            e.preventDefault();
            webview.src = this.cleanUrl(e.url);
        });

        // --- NEW: CLICK TRACKING INJECTION ---
        webview.addEventListener('dom-ready', () => {
            // Inject script to detect clicks and log a specific message
            webview.executeJavaScript(`
                document.addEventListener('click', () => { console.log('__STUDY_CLICK__'); });
            `);
        });

        webview.addEventListener('console-message', (e) => {
            if (e.message === '__STUDY_CLICK__') {
                this.recordClick();
            }
        });

        container.appendChild(webview);
        overlay.classList.remove('hidden');
    },

    reload: function() {
        if (this.activeWebview) {
            this.activeWebview.reload();
        }
    },

    // --- URL CLEANER (SharePoint & PDF) ---
    cleanUrl: function(url) {
        try {
            // 1. SharePoint: Remove ?web=1 to force raw view (Extract PDF)
            if (url.includes('sharepoint.com') || url.includes('onedrive.com')) {
                const u = new URL(url);
                if (u.searchParams.get('web') === '1') {
                    u.searchParams.delete('web');
                    url = u.toString();
                }
            }
            // 2. PDF Tools: Hide sidebar/toolbar
            if (url.toLowerCase().includes('.pdf') && !url.includes('#')) {
                url += '#toolbar=0&navpanes=0&view=FitH';
            }
        } catch (e) { /* Ignore invalid URLs */ }
        return url;
    },

    closeStudyWindow: function() {
        const overlay = document.getElementById('study-overlay');
        const container = document.getElementById('study-webview-container');
        
        if (overlay) overlay.classList.add('hidden');
        if (container) container.innerHTML = ''; // Kill webview process

        this.isStudyOpen = false;
        this.activeWebview = null;
        this.track("Navigating: Schedule"); // Assume return to schedule
    },
    
    // --- WIDGET HELPER: GET SCHEDULED AGENTS ---
    getScheduledAgents: function() {
        const schedules = JSON.parse(localStorage.getItem('schedules') || '{}');
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        const scheduledAgents = new Set();
        
        // If isDateInRange is not available (schedule.js not loaded), fallback to all
        const hasDateCheck = typeof isDateInRange === 'function';

        Object.values(schedules).forEach(sched => {
            if (sched.assigned && rosters[sched.assigned]) {
                // Check if this schedule is active TODAY
                let isActiveToday = false;
                if (hasDateCheck && sched.items) {
                    isActiveToday = sched.items.some(item => isDateInRange(item.dateRange, item.dueDate));
                } else {
                    isActiveToday = true; // Fallback
                }

                if (isActiveToday) {
                    rosters[sched.assigned].forEach(agent => scheduledAgents.add(agent));
                }
            }
        });
        return Array.from(scheduledAgents);
    }
};

StudyMonitor.toggleSummary = function() {
    this.viewMode = this.viewMode === 'list' ? 'summary' : 'list';
    renderActivityMonitorContent();
};

// --- ADMIN ACTIVITY MONITOR MODAL ---

let ACTIVITY_MONITOR_INTERVAL = null;

window.openActivityMonitorModal = function() {
    const modal = document.getElementById('activityMonitorModal');
    if(modal) {
        modal.classList.remove('hidden');
        renderActivityMonitorContent();
        // Start 30s auto-refresh
        if(ACTIVITY_MONITOR_INTERVAL) clearInterval(ACTIVITY_MONITOR_INTERVAL);
        ACTIVITY_MONITOR_INTERVAL = setInterval(renderActivityMonitorContent, 30000);
    }
};

window.closeActivityMonitorModal = function() {
    const modal = document.getElementById('activityMonitorModal');
    if(modal) modal.classList.add('hidden');
    if(ACTIVITY_MONITOR_INTERVAL) clearInterval(ACTIVITY_MONITOR_INTERVAL);
};

function renderActivityMonitorContent() {
    const container = document.getElementById('activityMonitorContent');
    if(!container) return;

    // Redirect to Summary View if active
    if (StudyMonitor.viewMode === 'summary') {
        renderActivitySummary(container);
        return;
    }

    // 1. Fetch Data
    const data = JSON.parse(localStorage.getItem('monitor_data') || '{}');
    const targetAgents = StudyMonitor.getScheduledAgents();
    
    if(targetAgents.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding:20px; color:var(--text-muted);">
                <i class="fas fa-calendar-times" style="font-size:2rem; margin-bottom:10px;"></i><br>
                No agents scheduled for today.<br>
                <button class="btn-secondary btn-sm" style="margin-top:10px;" onclick="StudyMonitor.forceShowAll()">Show All Agents Anyway</button>
            </div>`;
        return;
    }

    const activeIds = new Set();

    targetAgents.sort().forEach(agent => {
        const activity = data[agent] || { current: 'No Data', since: Date.now(), isStudyOpen: false, history: [] };
        const durationMs = Date.now() - activity.since;
        const durationStr = Math.floor(durationMs / 60000) + 'm ' + Math.floor((durationMs % 60000) / 1000) + 's';
        
        // Safe ID for DOM elements
        const safeId = agent.replace(/[^a-zA-Z0-9]/g, '_');
        activeIds.add(`mon_card_${safeId}`);

        // Status Indicator
        let statusBadge = '<span class="status-badge status-fail">Offline/Idle</span>';
        if (activity.isStudyOpen) statusBadge = '<span class="status-badge status-pass">Studying</span>';
        else if (!activity.current.includes('Idle') && activity.current !== 'No Data') statusBadge = '<span class="status-badge status-improve">Navigating App</span>';

        // Timestamp
        const startTime = new Date(activity.since).toLocaleTimeString();

        // Clicks (Current)
        const clicks = StudyMonitor.clickCount || 0;

        // Check if card exists to update IN PLACE (prevents blinking)
        let card = document.getElementById(`mon_card_${safeId}`);
        
        if (!card) {
            // Create new card structure
            card = document.createElement('div');
            card.id = `mon_card_${safeId}`;
            card.className = 'card';
            card.style.marginBottom = '15px';
            card.style.padding = '15px';
            card.style.cursor = 'pointer';
            card.onclick = function(e) {
                // Toggle details if not clicking a button
                if(e.target.tagName !== 'BUTTON') {
                    const det = document.getElementById(`mon_det_${safeId}`);
                    if(det) det.classList.toggle('hidden');
                }
            };

            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <h4 style="margin:0;">${agent}</h4>
                        <div id="mon_curr_${safeId}" style="font-size:0.8rem; color:var(--text-muted);"></div>
                    </div>
                    <div id="mon_badge_${safeId}"></div>
                </div>
                <div id="mon_det_${safeId}" class="hidden" style="margin-top:15px; padding-top:10px; border-top:1px solid var(--border-color);">
                    <strong style="font-size:0.8rem; color:var(--text-muted); display:block; margin-bottom:5px;">Activity History</strong>
                    <div id="mon_hist_${safeId}" style="background:var(--bg-input); padding:10px; border-radius:6px; max-height:200px; overflow-y:auto;"></div>
                </div>
            `;
            container.appendChild(card);
        }

        // Update Content
        document.getElementById(`mon_curr_${safeId}`).innerHTML = `Current: <strong>${activity.current}</strong> <span style="opacity:0.7;">(Since ${startTime})</span> for ${durationStr}`;
        document.getElementById(`mon_badge_${safeId}`).innerHTML = statusBadge;

        // Update History (Only if details are visible to save DOM ops, or always?)
        // Let's update always for now so it's ready when expanded
        const histContainer = document.getElementById(`mon_hist_${safeId}`);
        if (activity.history && activity.history.length > 0) {
            const recent = activity.history.slice().reverse(); // Show all history
            histContainer.innerHTML = `<ul style="list-style:none; padding:0; margin:0; font-size:0.85rem;">
                ${recent.map(h => {
                    const dur = Math.round(h.duration / 1000) + 's';
                    const time = new Date(h.start).toLocaleTimeString();
                    const clickInfo = h.clicks ? ` | <i class="fas fa-mouse-pointer" style="font-size:0.7rem;"></i> ${h.clicks}` : '';
                    return `<li style="border-bottom:1px solid var(--border-color); padding:4px 0; display:flex; justify-content:space-between;">
                        <span>${h.activity}</span>
                        <span style="color:var(--text-muted); font-family:monospace;">${time} (${dur}${clickInfo})</span>
                    </li>`;
                }).join('')}
            </ul>`;
        } else {
            histContainer.innerHTML = '<div style="font-style:italic; color:var(--text-muted);">No history recorded yet.</div>';
        }
    });

    // Cleanup Stale Cards (Agents no longer in filter)
    Array.from(container.children).forEach(child => {
        if (child.id && child.id.startsWith('mon_card_') && !activeIds.has(child.id)) {
            child.remove();
        }
    });
}

function renderActivitySummary(container) {
    const data = JSON.parse(localStorage.getItem('monitor_data') || '{}');
    const targetAgents = StudyMonitor.getScheduledAgents();
    
    // Ensure container has a grid wrapper if empty
    if (!container.querySelector('.summary-grid')) {
        container.innerHTML = '<div class="summary-grid" id="summaryGridContainer"></div>';
    }
    const grid = document.getElementById('summaryGridContainer');
    
    if(targetAgents.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-muted);">No agents found to summarize.</div>';
        return;
    }

    const activeIds = new Set();
    
    targetAgents.sort().forEach(agent => {
        const activity = data[agent] || { history: [], current: 'No Data', since: Date.now() };
        const safeId = agent.replace(/[^a-zA-Z0-9]/g, '_');
        // 1. Aggregate Data
        let totalMs = 0;
        let studyMs = 0;
        let extMs = 0;
        let idleMs = 0;
        const topicMap = {};
        
        // Combine history + current active session
        const allSegments = [...(activity.history || [])];
        
        // Add current session as a segment
        const currentDuration = Date.now() - activity.since;
        if (currentDuration > 1000) {
            allSegments.push({
                activity: activity.current,
                duration: currentDuration,
            });
        }

        allSegments.forEach(seg => {
            totalMs += seg.duration;
            const act = seg.activity.toLowerCase();
            if (act.includes('studying')) {
                studyMs += seg.duration;
                // Track specific topics
                const topic = seg.activity.replace('Studying: ', '').split('(')[0].trim();
                topicMap[topic] = (topicMap[topic] || 0) + seg.duration;
            } else if (act.includes('external') || act.includes('background')) {
                extMs += seg.duration;
            } else {
                idleMs += seg.duration;
            }
        });

        // 2. Calculate Stats
        const focusScore = totalMs > 0 ? Math.round((studyMs / totalMs) * 100) : 0;
        const studyTimeStr = Math.round(studyMs / 60000) + 'm';
        const extTimeStr = Math.round(extMs / 60000) + 'm';
        const idleTimeStr = Math.round(idleMs / 60000) + 'm';
        
        let scoreColor = '#2ecc71';
        if (focusScore < 50) scoreColor = '#ff5252';
        else if (focusScore < 80) scoreColor = '#f1c40f';

        // 3. Top Activities Breakdown
        const sortedTopics = Object.entries(topicMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3); // Top 3
            
        let breakdownHtml = '<div class="topic-breakdown">';
        if (sortedTopics.length > 0) {
            breakdownHtml += sortedTopics.map(([topic, ms]) => 
                `<div class="topic-row">
                    <span class="topic-name" title="${topic}">${topic}</span>
                    <span class="topic-time">${Math.round(ms/60000)}m</span>
                </div>`
            ).join('');
        } else {
            breakdownHtml += '<div style="color:var(--text-muted); font-style:italic; font-size:0.8rem;">No study activity recorded.</div>';
        }
        breakdownHtml += '</div>';

        // 4. Build Timeline Bar
        // Normalize segments to percentages
        let timelineHtml = '';
        if (totalMs > 0) {
            allSegments.forEach(seg => {
                const pct = (seg.duration / totalMs) * 100;
                if (pct < 1) return; // Skip tiny slivers
                
                let typeClass = 'seg-idle';
                const act = seg.activity.toLowerCase();
                if (act.includes('studying')) typeClass = 'seg-study';
                else if (act.includes('external')) typeClass = 'seg-ext';
                
                timelineHtml += `<div class="timeline-seg ${typeClass}" style="width:${pct}%;" title="${seg.activity} (${Math.round(seg.duration/1000)}s)"></div>`;
            });
        } else {
            timelineHtml = '<div style="width:100%; text-align:center; font-size:0.7rem; color:var(--text-muted); padding-top:2px;">No activity recorded</div>';
        }

        // 5. DOM Update (Silent / No Flicker)
        const cardId = `sum_card_${safeId}`;
        activeIds.add(cardId);

        let card = document.getElementById(cardId);
        if (!card) {
            // Create Skeleton Structure ONCE
            card = document.createElement('div');
            card.id = cardId;
            card.className = 'summary-card';
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:15px;">
                    <div>
                        <h3 style="margin:0;">${agent}</h3>
                        <div id="sum_total_${safeId}" style="font-size:0.8rem; color:var(--text-muted);"></div>
                    </div>
                    <div style="text-align:right;">
                        <div id="sum_score_${safeId}" class="focus-score-large"></div>
                        <div style="font-size:0.7rem; font-weight:bold; color:var(--text-muted); text-transform:uppercase;">Focus Score</div>
                    </div>
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px; text-align:center; font-size:0.85rem; margin-bottom:15px;">
                    <div style="background:rgba(46, 204, 113, 0.1); padding:8px; border-radius:6px; color:#2ecc71;">
                        <div id="sum_study_${safeId}" style="font-weight:bold; font-size:1.1rem;"></div>
                        <div style="font-size:0.7rem; opacity:0.8;">Study</div>
                    </div>
                    <div style="background:rgba(231, 76, 60, 0.1); padding:8px; border-radius:6px; color:#e74c3c;">
                        <div id="sum_ext_${safeId}" style="font-weight:bold; font-size:1.1rem;"></div>
                        <div style="font-size:0.7rem; opacity:0.8;">External</div>
                    </div>
                    <div style="background:var(--bg-input); padding:8px; border-radius:6px; color:var(--text-muted);">
                        <div id="sum_idle_${safeId}" style="font-weight:bold; font-size:1.1rem;"></div>
                        <div style="font-size:0.7rem; opacity:0.8;">Idle</div>
                    </div>
                </div>
                <div style="margin-bottom:15px;">
                    <div style="font-size:0.75rem; font-weight:bold; color:var(--text-muted); margin-bottom:5px; text-transform:uppercase;">Top Activities</div>
                    <div id="sum_topics_${safeId}" class="topic-breakdown"></div>
                </div>
                <div id="sum_timeline_${safeId}" class="timeline-visual"></div>
                <div style="display:flex; justify-content:space-between; font-size:0.7rem; color:var(--text-muted); margin-top:5px;">
                    <span>Start</span>
                    <span>Current</span>
                </div>`;
            grid.appendChild(card);
        }

        // Granular Updates (No Flicker)
        document.getElementById(`sum_total_${safeId}`).innerText = `Total Tracked: ${Math.round(totalMs/60000)} mins`;
        const scoreEl = document.getElementById(`sum_score_${safeId}`);
        scoreEl.innerText = `${focusScore}%`;
        scoreEl.style.color = scoreColor;
        
        document.getElementById(`sum_study_${safeId}`).innerText = studyTimeStr;
        document.getElementById(`sum_ext_${safeId}`).innerText = extTimeStr;
        document.getElementById(`sum_idle_${safeId}`).innerText = idleTimeStr;
        
        // InnerHTML for complex children is fine if container is stable
        document.getElementById(`sum_topics_${safeId}`).innerHTML = breakdownHtml;
        document.getElementById(`sum_timeline_${safeId}`).innerHTML = timelineHtml;
    });

    // Cleanup Stale Cards
    Array.from(grid.children).forEach(child => {
        if (child.id && child.id.startsWith('sum_card_') && !activeIds.has(child.id)) {
            child.remove();
        }
    });
}

StudyMonitor.forceShowAll = function() {
    // Temporary override to show all trainees
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const allTrainees = users.filter(u => u.role === 'trainee').map(u => u.user);
    
    // Monkey-patch getScheduledAgents temporarily
    this.originalGetScheduled = this.getScheduledAgents;
    this.getScheduledAgents = () => allTrainees;
    
    renderActivityMonitorContent();
};

StudyMonitor.archiveLog = async function() {
    if(!confirm("Clear all activity history? This cannot be undone.")) return;
    
    localStorage.setItem('monitor_data', '{}');
    if(typeof saveToServer === 'function') await saveToServer(['monitor_data'], true);
    
    renderActivityMonitorContent();
    alert("Activity logs cleared.");
}

// Hook for dashboard.js to trigger updates if modal is open
StudyMonitor.updateWidget = function() {
    const modal = document.getElementById('activityMonitorModal');
    if (modal && !modal.classList.contains('hidden')) {
        renderActivityMonitorContent();
    }
};
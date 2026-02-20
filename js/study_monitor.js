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
    pendingTopic: null, // For classification modal
    externalPoller: null, // Track the interval for external monitoring
    queueSelection: new Set(), // Persist selections across refreshes
    cachedWhitelist: [], // Cache for performance

    init: function() {
        if (this.syncInterval) clearInterval(this.syncInterval);

        // 1. RESTORE HISTORY (Persist across reloads)
        if (CURRENT_USER && CURRENT_USER.role === 'trainee') {
            try {
                // Check unsynced first (crash/close recovery)
                const unsynced = localStorage.getItem('monitor_unsynced');
                if (unsynced) {
                    const payload = JSON.parse(unsynced);
                    if (payload.user === CURRENT_USER.user && Array.isArray(payload.history)) {
                        this.history = payload.history;
                    }
                    localStorage.removeItem('monitor_unsynced');
                } else {
                    // Normal restore
                    const md = JSON.parse(localStorage.getItem('monitor_data') || '{}');
                    if (md[CURRENT_USER.user] && Array.isArray(md[CURRENT_USER.user].history)) {
                        this.history = md[CURRENT_USER.user].history;
                    }
                }
            } catch(e) { console.error("History Restore Error", e); }
        }
        
        // Start periodic sync (every 10s)
        this.syncInterval = setInterval(() => this.sync(), 10000);
        this.track("System: App Loaded");

        // --- DAILY ARCHIVE CHECK ---
        this.checkDailyReset();

        // --- TRACK EXTERNAL ACTIVITY ---
        window.addEventListener('blur', () => {
            if (CURRENT_USER && CURRENT_USER.role === 'trainee') {
                this.track("External Activity (App Backgrounded)");
                this.startExternalMonitoring();
            }
        });
        window.addEventListener('focus', () => {
            if (CURRENT_USER && CURRENT_USER.role === 'trainee') {
                this.track("Resumed App Activity");
                this.stopExternalMonitoring();
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

    // --- EXTERNAL APP POLLING ---
    startExternalMonitoring: function() {
        if (this.externalPoller) clearInterval(this.externalPoller);
        
        // Poll every 5 seconds to check what app they are using
        this.externalPoller = setInterval(async () => {
            if (typeof require !== 'undefined') {
                try {
                    const { ipcRenderer } = require('electron');
                    const activeWindow = await ipcRenderer.invoke('get-active-window');
                    
                    // NEW: Check Idle State from Global Tracker
                    // We use the global LAST_INTERACTION timestamp updated by data.js
                    const lastInteract = window.LAST_INTERACTION || Date.now();
                    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
                    const idleThreshold = config.idle_thresholds ? config.idle_thresholds.warning : 60000;
                    
                    const isPhysicallyIdle = (Date.now() - lastInteract) > idleThreshold;

                    // Only track if it's different from current to avoid spamming history
                    let activityLabel = `External: ${activeWindow || 'Unknown App'}`;

                    if (isPhysicallyIdle) {
                        activityLabel = "Idle: Away (No Input)";
                    } else {
                        // --- WORK SITES WHITELIST ---
                        const defaultSites = [
                            'acs.herotel.systems', 'crm.herotel.com', 'herotel.qcontact.com',
                            'radius.herotel.com', 'app.preseem.com', 'hosting.herotel.com',
                            'cp1.herotel.com', 'cp2.herotel.com'
                        ];
                        const workSites = JSON.parse(localStorage.getItem('monitor_whitelist') || JSON.stringify(defaultSites));

                        // Check if window title contains any of the work sites
                        const matchedSite = workSites.find(site => activeWindow.toLowerCase().includes(site.toLowerCase()));
                        
                        if (matchedSite) {
                            // Classify as "Studying" (or Work) so it counts towards Focus Score
                            activityLabel = `Studying: ${matchedSite} (Work System)`;
                        }
                    }

                    if (this.currentActivity !== activityLabel) {
                        this.track(activityLabel);
                    }
                } catch (e) { console.error("External Monitor Error:", e); }
            }
        }, 5000);
    },

    stopExternalMonitoring: function() {
        if (this.externalPoller) clearInterval(this.externalPoller);
        this.externalPoller = null;
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

        this.currentActivity = activityName;
        this.startTime = now;
        this.clickCount = 0; // Reset click count for new activity
        
        // SAFETY: Prevent infinite array growth (Memory Protection)
        if (this.history.length > 2000) {
            // Keep start, slice end to maintain recent context
            const first = this.history[0];
            const recent = this.history.slice(-1000);
            this.history = [first, ...recent];
        }

        // Instant local save (optional)
        // this.sync(); 
    },

    recordClick: function() {
        this.clickCount++;
        // FIX: Ensure study activity counts as global interaction to prevent "Idle" status
        if (typeof window !== 'undefined') window.LAST_INTERACTION = Date.now();
    },

    sync: async function() {
        if (!CURRENT_USER || CURRENT_USER.role === 'admin') return; // Don't track admins

        // ROBUSTNESS: Check for day rollover dynamically (e.g. user left app open overnight)
        await this.checkDailyReset();

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
                // Ensure we don't get null if localstorage was wiped
                let monitorData = JSON.parse(localStorage.getItem('monitor_data')) || {};
                
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

    updateWhitelistCache: function() {
        // Filter out empty strings to prevent false positive matches
        this.cachedWhitelist = (JSON.parse(localStorage.getItem('monitor_whitelist') || '[]')).filter(w => w && w.trim().length > 0);
    },

    // --- HELPER: CENTRALIZED CLASSIFICATION ---
    getCategory: function(activityString) {
        if (!activityString) return 'idle';
        const act = activityString.toLowerCase();
        
        // 1. Dynamic Whitelist Check (Overrides "External" label)
        // Strip prefixes to match raw content against whitelist
        const raw = act.replace(/^external:\s*/, '').replace(/^studying:\s*/, '').trim();
        if (this.cachedWhitelist.some(w => raw.includes(w.toLowerCase()))) {
            return 'study';
        }

        // STRICT MODE CHECK
        const config = JSON.parse(localStorage.getItem('system_config') || '{}');
        if (config.monitoring && config.monitoring.whitelist_strict) {
            // If strict, and not whitelisted (passed above), and not explicitly 'idle', assume external
            if (!act.startsWith('idle:')) return 'external';
        }
        
        if (act.startsWith('studying:') || (act.includes('studying') && !act.startsWith('external:')) || act.includes('system:') || act.includes('navigating:')) return 'study';
        if (act.startsWith('external:') || act.includes('external') || act.includes('background')) return 'external';
        if (act.startsWith('idle:')) return 'idle';
        return 'idle'; // Default
    },

    // --- DAILY ARCHIVE LOGIC ---
    checkDailyReset: async function() {
        if (!CURRENT_USER || CURRENT_USER.role === 'admin') return;
        this.updateWhitelistCache(); // Ensure we use latest rules for archiving
        
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
                    const cat = this.getCategory(h.activity);
                    if (cat === 'study') studyMs += h.duration;
                    else if (cat === 'external') extMs += h.duration;
                    else idleMs += h.duration;
                });

                history.push({
                    date: lastDate,
                    user: CURRENT_USER.user,
                    summary: { study: studyMs, external: extMs, idle: idleMs, total: totalMs },
                    details: myData.history // Archive full details
                });
                
                // NEW: Retention Policy (Keep last 30 days locally to prevent bloat)
                if (history.length > 30) {
                    history = history.slice(history.length - 30);
                }
                
                // SAFETY: Handle QuotaExceededError (Storage Full)
                try {
                    localStorage.setItem('monitor_history', JSON.stringify(history));
                } catch (e) {
                    console.warn("Storage Quota Exceeded. Stripping details from archive.");
                    // Fallback: Save only summaries, remove details from older entries
                    history.forEach(h => delete h.details);
                    try {
                        localStorage.setItem('monitor_history', JSON.stringify(history));
                    } catch (e2) {
                        console.error("Critical Storage Error: Could not save history.", e2);
                    }
                }
                
                // Reset Live Data for Today
                monitorData[CURRENT_USER.user] = { current: 'System: New Day Start', since: Date.now(), isStudyOpen: false, history: [], date: today };
                localStorage.setItem('monitor_data', JSON.stringify(monitorData));
                
                // RESET MEMORY
                this.history = [];
                
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
        // webview.partition = 'persist:study'; // REMOVED: Use default session for better OS/SSO integration
        webview.style.width = '100%';
        webview.style.height = '100%';
        webview.setAttribute('allowpopups', 'true');
        // Fix for SharePoint/Microsoft 365 blank pages (Spoof standard Chrome UA)
        webview.setAttribute('useragent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
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

        // SAFETY: Handle Crashes
        webview.addEventListener('crashed', () => {
            this.track("System: Study Window Crashed");
            this.closeStudyWindow();
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
                // STRICTER CHECK: Only strip web=1 if it ends in .pdf. Do not touch .aspx or other pages.
                if (u.pathname.toLowerCase().endsWith('.pdf') && u.searchParams.get('web') === '1') {
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
        ACTIVITY_MONITOR_INTERVAL = setInterval(renderActivityMonitorContent, 180000); // 3 Minutes
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

    // STOP AUTO-REFRESH if in Queue Mode to prevent losing selections
    if (StudyMonitor.viewMode === 'queue' && !StudyMonitor.forceRefresh) return;

    // Redirect to Summary View if active
    if (StudyMonitor.viewMode === 'summary') {
        renderActivitySummary(container);
        return;
    }
    if (StudyMonitor.viewMode === 'queue') {
        renderReviewQueue(container);
        return;
    }

    // 1. Fetch Data
    const data = JSON.parse(localStorage.getItem('monitor_data') || '{}');
    const targetAgents = StudyMonitor.getScheduledAgents();
    
    if(targetAgents.length === 0) {
        // Clear grid if it exists
        if (container.querySelector('.monitor-grid')) {
            container.querySelector('.monitor-grid').innerHTML = '';
        }
        container.innerHTML = `
            <div style="text-align:center; padding:20px; color:var(--text-muted);">
                <i class="fas fa-calendar-times" style="font-size:2rem; margin-bottom:10px;"></i><br>
                No agents scheduled for today.<br>
                <button class="btn-secondary btn-sm" style="margin-top:10px;" onclick="StudyMonitor.forceShowAll()">Show All Agents Anyway</button>
            </div>`;
        return;
    }

    // Ensure container has a grid wrapper if empty
    if (!container.querySelector('.monitor-grid')) {
        container.innerHTML = '<div class="monitor-grid" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap:20px;"></div>';
    }
    const grid = container.querySelector('.monitor-grid');

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
            card.className = 'card monitor-card';
            card.style.marginBottom = '0'; // Grid handles gap
            card.style.padding = '20px';
            card.style.borderLeft = '4px solid transparent';
            card.style.transition = 'all 0.3s ease';

            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:15px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div style="width:35px; height:35px; background:var(--bg-input); border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; color:var(--text-muted);">${agent.charAt(0)}</div>
                        <h4 style="margin:0; font-size:1.1rem;">${agent}</h4>
                    </div>
                    <div id="mon_badge_${safeId}"></div>
                </div>
                
                <div style="background:var(--bg-input); padding:12px; border-radius:8px; margin-bottom:15px; border:1px solid var(--border-color);">
                    <div id="mon_curr_${safeId}" style="font-size:0.9rem; line-height:1.5;"></div>
                </div>

                <button class="btn-secondary btn-sm" style="width:100%;" onclick="event.stopPropagation(); document.getElementById('mon_det_${safeId}').classList.toggle('hidden')">
                    <i class="fas fa-history"></i> View History
                </button>
                
                <div id="mon_det_${safeId}" class="hidden" style="margin-top:15px; padding-top:10px; border-top:1px dashed var(--border-color);">
                    <strong style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; display:block; margin-bottom:8px;">Recent Activity</strong>
                    <div id="mon_hist_${safeId}" style="max-height:150px; overflow-y:auto; padding-right:5px;"></div>
                </div>
            `;
            grid.appendChild(card);
        }

        // Dynamic Border Color update
        if (activity.isStudyOpen) card.style.borderLeftColor = '#2ecc71';
        else if (activity.current.includes('Idle')) card.style.borderLeftColor = '#95a5a6';
        else if (activity.current.includes('External')) card.style.borderLeftColor = '#ff5252';
        else card.style.borderLeftColor = '#f1c40f';

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
    Array.from(grid.children).forEach(child => {
        if (child.id && child.id.startsWith('mon_card_') && !activeIds.has(child.id)) {
            child.remove();
        }
    });
    
    StudyMonitor.forceRefresh = false; // Reset flag
}

// --- QUEUE SELECTION HELPERS ---
StudyMonitor.toggleQueueItem = function(val, checked) {
    if (checked) this.queueSelection.add(val);
    else this.queueSelection.delete(val);
    // Update button text
    const btn = document.getElementById('btnBulkClassify');
    if(btn) btn.innerText = `Classify Selected (${this.queueSelection.size})`;
};

function renderReviewQueue(container) {
    const data = JSON.parse(localStorage.getItem('monitor_data') || '{}');
    const whitelist = JSON.parse(localStorage.getItem('monitor_whitelist') || '[]');
    const reviewed = JSON.parse(localStorage.getItem('monitor_reviewed') || '[]');
    const groups = {}; // Group by Process ID [proc]
    const ungrouped = new Set();
    
    Object.values(data).forEach(userActivity => {
        const processItem = (act) => {
            if (act.startsWith('External: ') && !act.includes('(Reclassified)')) {
                const raw = act.replace('External: ', '').trim();
                
                // Check if already whitelisted (Partial match)
                if (whitelist.some(w => raw.toLowerCase().includes(w.trim().toLowerCase()))) return;
                // Check if already reviewed/dismissed (Partial match)
                if (reviewed.some(r => raw.toLowerCase().includes(r.trim().toLowerCase()))) return;

                const match = raw.match(/\[(.*?)\]$/); // Extract [process]
                if (match) {
                    const proc = match[1].toLowerCase();
                    if (!groups[proc]) groups[proc] = new Set();
                    groups[proc].add(raw);
                } else {
                    ungrouped.add(raw);
                }
            }
        };

        (userActivity.history || []).forEach(h => processItem(h.activity));
        processItem(userActivity.current);
    });
    
    let html = `
        <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <h3>Unclassified Activities (External)</h3>
                <button id="btnBulkClassify" class="btn-primary btn-sm" onclick="StudyMonitor.bulkClassifyAction()">Classify Selected (${StudyMonitor.queueSelection.size})</button>
            </div>
            <p style="color:var(--text-muted); margin-bottom:15px;">Grouped by Application. Classifying a process will whitelist it for everyone.</p>
    `;
    
    const sortedProcs = Object.keys(groups).sort();
    
    if (sortedProcs.length === 0 && ungrouped.size === 0) {
        html += `<div style="text-align:center; padding:20px; color:var(--text-muted);">No unclassified external activities found.</div>`;
    } else {
        // Render Process Groups
        sortedProcs.forEach(proc => {
            const items = Array.from(groups[proc]);
            // Check if all items in this group are selected (optional UI polish, skipping for simplicity)
            
            html += `
            <div style="margin-bottom:15px; border:1px solid var(--border-color); border-radius:6px; overflow:hidden;">
                <div style="background:var(--bg-input); padding:10px; display:flex; justify-content:space-between; align-items:center;">
                    <strong><i class="fas fa-cog"></i> ${proc.toUpperCase()}</strong>
                    <button class="btn-secondary btn-sm" onclick="StudyMonitor.classifyActivity('[${proc}]')">Whitelist App</button>
                </div>
                <div style="padding:5px;">
                    ${items.map(item => {
                        const isChecked = StudyMonitor.queueSelection.has(item) ? 'checked' : '';
                        return `
                        <div style="display:flex; justify-content:space-between; padding:5px; border-bottom:1px dashed var(--border-color); font-size:0.85rem;">
                            <label style="display:flex; align-items:center; gap:10px; cursor:pointer; flex:1; margin:0;"><input type="checkbox" class="q-check" value="${item.replace(/"/g, '&quot;')}" onchange="StudyMonitor.toggleQueueItem(this.value, this.checked)" ${isChecked}> ${item}</label>
                            <button class="btn-secondary btn-sm" style="padding:0 5px; font-size:0.7rem;" onclick="StudyMonitor.classifyActivity('${item.replace(/'/g, "\\'")}')">Classify This</button>
                        </div>
                    `}).join('')}
                </div>
            </div>`;
        });

        // Render Ungrouped
        if (ungrouped.size > 0) {
            html += `<div style="margin-top:15px;"><strong>Other</strong></div>`;
            Array.from(ungrouped).forEach(item => {
                const isChecked = StudyMonitor.queueSelection.has(item) ? 'checked' : '';
                html += `<div style="display:flex; justify-content:space-between; padding:5px; border-bottom:1px solid var(--border-color);">
                    <label style="display:flex; align-items:center; gap:10px; cursor:pointer; flex:1; margin:0;"><input type="checkbox" class="q-check" value="${item.replace(/"/g, '&quot;')}" onchange="StudyMonitor.toggleQueueItem(this.value, this.checked)" ${isChecked}> ${item}</label>
                    <button class="btn-secondary btn-sm" onclick="StudyMonitor.classifyActivity('${item.replace(/'/g, "\\'")}')">Classify</button>
                </div>`;
            });
        }
    }
    
    html += `</div>`;
    container.innerHTML = html;
}

function renderActivitySummary(container) {
    StudyMonitor.updateWhitelistCache(); // Refresh cache before rendering
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
                start: activity.since, // Need start time for working hours calc
                end: Date.now(),
                duration: currentDuration
            });
        }

        allSegments.forEach(seg => {
            // --- WORKING HOURS LOGIC (8am-5pm, Lunch 12-1) ---
            // Calculate effective duration within working hours
            const segStart = seg.start || (seg.end - seg.duration);
            const segEnd = seg.end || (segStart + seg.duration);
            
            const dateStr = new Date(segStart).toISOString().split('T')[0];
            const workStart = new Date(`${dateStr}T08:00:00`).getTime();
            const lunchStart = new Date(`${dateStr}T12:00:00`).getTime();
            const lunchEnd = new Date(`${dateStr}T13:00:00`).getTime();
            const workEnd = new Date(`${dateStr}T17:00:00`).getTime();

            // 1. Morning Session (08:00 - 12:00)
            const morningOverlap = Math.max(0, Math.min(segEnd, lunchStart) - Math.max(segStart, workStart));
            // 2. Afternoon Session (13:00 - 17:00)
            const afternoonOverlap = Math.max(0, Math.min(segEnd, workEnd) - Math.max(segStart, lunchEnd));
            
            const effectiveDuration = morningOverlap + afternoonOverlap;
            
            if (effectiveDuration <= 0) return; // Skip non-working hours

            totalMs += effectiveDuration;
            const category = StudyMonitor.getCategory(seg.activity);
            
            // TOLERANCE: Activities < 3 mins are considered "Quick Checks" or "Thinking" (Productive)
            // Only > 3 mins counts as Distraction/Idle (Concern)
            const config = JSON.parse(localStorage.getItem('system_config') || '{}');
            const TOLERANCE = config.monitoring ? config.monitoring.tolerance_ms : 180000;
            
            if (category === 'study') {
                studyMs += effectiveDuration;
                // Track specific topics
                const topic = seg.activity.replace('Studying: ', '').split('(')[0].trim();
                if (!topicMap[topic]) topicMap[topic] = { ms: 0, type: 'study' };
                topicMap[topic].ms += effectiveDuration;
            } else if (category === 'external') {
                let topic = seg.activity.replace('External: ', '').trim();
                if (!topicMap[topic]) topicMap[topic] = { ms: 0, type: 'study' }; // Default to neutral
                
                if (effectiveDuration > TOLERANCE) {
                    extMs += effectiveDuration;
                    topicMap[topic].type = 'external'; // Flag as concern
                } else {
                    studyMs += effectiveDuration; // Tolerated
                }
                topicMap[topic].ms += effectiveDuration;
            } else {
                if (effectiveDuration > TOLERANCE) idleMs += effectiveDuration;
                else studyMs += effectiveDuration; // Thinking time
            }
        });

        // 2. Calculate Stats
        // FIX: Handle 0ms (e.g. before 8am) to show N/A instead of 0% Fail
        let focusScore = 0;
        let scoreText = 'N/A';
        let scoreColor = 'var(--text-muted)'; // Default Grey

        if (totalMs > 0) {
            focusScore = Math.round((studyMs / totalMs) * 100);
            scoreText = focusScore + '%';
            if (focusScore < 50) scoreColor = '#ff5252';
            else if (focusScore < 80) scoreColor = '#f1c40f';
            else scoreColor = '#2ecc71';
        }

        const studyTimeStr = Math.round(studyMs / 60000) + 'm';
        const extTimeStr = Math.round(extMs / 60000) + 'm';
        const idleTimeStr = Math.round(idleMs / 60000) + 'm';

        // 3. Top Activities Breakdown
        const sortedTopics = Object.entries(topicMap)
            .sort((a, b) => b[1].ms - a[1].ms)
            .slice(0, 3); // Top 3
            
        let breakdownHtml = '<div class="topic-breakdown">';
        if (sortedTopics.length > 0) {
            breakdownHtml += sortedTopics.map(([topic, data]) => {
                const isExternal = data.type === 'external';
                const ms = data.ms;
                
                const actionBtn = isExternal 
                    ? `<button class="btn-secondary btn-sm" style="padding:0 4px; font-size:0.6rem;" onclick="StudyMonitor.classifyActivity('${topic.replace(/'/g, "\\'")}')" title="Classify Activity"><i class="fas fa-edit"></i></button>`
                    : '';
                
                return `<div class="topic-row">
                    <span class="topic-name" title="${topic}">${topic}</span>
                    <div style="display:flex; align-items:center; gap:5px;">
                        <span class="topic-time">${ms < 60000 ? '< 1m' : Math.round(ms/60000) + 'm'}</span>
                        ${actionBtn}
                    </div>
                </div>`;
            }).join('');
        } else {
            breakdownHtml += '<div style="color:var(--text-muted); font-style:italic; font-size:0.8rem;">No study activity recorded.</div>';
        }
        breakdownHtml += '</div>';

        // 4. Build Timeline Bar
        // Normalize segments to percentages
        let timelineHtml = '';
        if (totalMs > 0) {
            allSegments.forEach(seg => {
                // --- WORKING HOURS LOGIC (Re-calc for Timeline accuracy) ---
                const segStart = seg.start || (seg.end - seg.duration);
                const segEnd = seg.end || (segStart + seg.duration);
                
                const dateStr = new Date(segStart).toISOString().split('T')[0];
                const workStart = new Date(`${dateStr}T08:00:00`).getTime();
                const lunchStart = new Date(`${dateStr}T12:00:00`).getTime();
                const lunchEnd = new Date(`${dateStr}T13:00:00`).getTime();
                const workEnd = new Date(`${dateStr}T17:00:00`).getTime();

                const morningOverlap = Math.max(0, Math.min(segEnd, lunchStart) - Math.max(segStart, workStart));
                const afternoonOverlap = Math.max(0, Math.min(segEnd, workEnd) - Math.max(segStart, lunchEnd));
                
                const effectiveDuration = morningOverlap + afternoonOverlap;
                
                if (effectiveDuration <= 0) return;

                const pct = (effectiveDuration / totalMs) * 100;
                if (pct < 0.5) return; // Skip tiny slivers
                
                const cat = StudyMonitor.getCategory(seg.activity);
                const config = JSON.parse(localStorage.getItem('system_config') || '{}');
                const TOLERANCE = config.monitoring ? config.monitoring.tolerance_ms : 180000;
                
                let typeClass = 'seg-idle'; // Default
                let style = `width:${pct}%;`;
                let title = `${seg.activity} (${Math.round(effectiveDuration/1000)}s)`;
                
                if (cat === 'study') {
                    typeClass = 'seg-study';
                } else if (cat === 'external') {
                    if (effectiveDuration > TOLERANCE) {
                        typeClass = 'seg-ext';
                    } else {
                        // Tolerated External -> Striped Green/Orange
                        style += `background: repeating-linear-gradient(45deg, #2ecc71, #2ecc71 5px, #f1c40f 5px, #f1c40f 10px);`;
                        title = `[Tolerated] ${seg.activity} (${Math.round(effectiveDuration/1000)}s)`;
                    }
                } else {
                    if (effectiveDuration > TOLERANCE) {
                        typeClass = 'seg-idle';
                    } else {
                        // Tolerated Idle -> Striped Green/Grey
                        style += `background: repeating-linear-gradient(45deg, #2ecc71, #2ecc71 5px, #95a5a6 5px, #95a5a6 10px);`;
                        title = `[Thinking] ${seg.activity} (${Math.round(effectiveDuration/1000)}s)`;
                    }
                }
                
                timelineHtml += `<div class="timeline-seg ${typeClass}" style="${style}" title="${title}"></div>`;
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
                <div id="sum_timeline_${safeId}" class="timeline-visual" onclick="StudyMonitor.expandTimeline('${agent.replace(/'/g, "\\'")}')" style="cursor:pointer;" title="Click to expand details"></div>
                <div style="display:flex; justify-content:space-between; font-size:0.7rem; color:var(--text-muted); margin-top:5px;">
                    <span>Start</span>
                    <span>Current</span>
                </div>`;
            grid.appendChild(card);
        }

        // Granular Updates (No Flicker)
        document.getElementById(`sum_total_${safeId}`).innerText = `Total Tracked: ${Math.round(totalMs/60000)} mins`;
        const scoreEl = document.getElementById(`sum_score_${safeId}`);
        scoreEl.innerText = scoreText;
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

StudyMonitor.classifyActivity = async function(fullActivityString) {
    // Smart Suggestion Logic
    let suggestion = fullActivityString;
    
    // 1. Strip "External: " prefix if present
    suggestion = suggestion.replace(/^External:\s*/, '');
    
    // 2. Check for Process ID [proc]
    const procMatch = suggestion.match(/\[(.*?)\]$/);
    if (procMatch) {
        const proc = procMatch[1].toLowerCase();
        const browsers = ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'safari'];
        
        if (browsers.includes(proc)) {
            // Browser: Suggest Title (remove process)
            suggestion = suggestion.replace(/\[(.*?)\]$/, '').trim();
            suggestion = suggestion.replace(/ - \w+$/, '').trim(); // Try remove suffix like " - Google Chrome"
        } else {
            // App: Suggest Process ID for broad matching
            suggestion = `[${proc}]`; 
        }
    }

    // 3. Prompt User
    const keyword = await customPrompt("Classify Activity", "Enter keyword to whitelist (matches any window title containing this):", suggestion);
    if (!keyword) return;

    this.pendingTopic = keyword.trim();
    document.getElementById('classifyTargetName').innerText = keyword;
    document.getElementById('activityClassifyModal').classList.remove('hidden');
};

StudyMonitor.bulkClassifyAction = function() {
    if (this.queueSelection.size === 0) return alert("Please select items to classify.");
    const topics = Array.from(this.queueSelection);
    this.pendingTopic = topics; // Pass array
    document.getElementById('classifyTargetName').innerText = `${topics.length} Selected Items`;
    document.getElementById('activityClassifyModal').classList.remove('hidden');
};

StudyMonitor.confirmClassification = async function() {
    const type = document.getElementById('classifySelect').value;
    // Handle both single string and array of strings
    const topics = Array.isArray(this.pendingTopic) ? this.pendingTopic : [this.pendingTopic];
    
    if (!topics || topics.length === 0) return;
    
    let newPrefix = "";
    if (type === "1") {
        newPrefix = "Studying: ";
        // Add to whitelist for future
        let whitelist = JSON.parse(localStorage.getItem('monitor_whitelist') || '[]');
        let reviewed = JSON.parse(localStorage.getItem('monitor_reviewed') || '[]');
        if (whitelist.length === 0) whitelist = ['acs.herotel.systems', 'crm.herotel.com', 'herotel.qcontact.com', 'radius.herotel.com', 'app.preseem.com', 'hosting.herotel.com', 'cp1.herotel.com', 'cp2.herotel.com'];
        
        let wlChanged = false;
        topics.forEach(t => {
            if (!whitelist.includes(t)) {
                whitelist.push(t);
                wlChanged = true;
            }
            // Remove from reviewed if it was previously dismissed
            const revIdx = reviewed.indexOf(t);
            if (revIdx > -1) {
                reviewed.splice(revIdx, 1);
                wlChanged = true;
            }
        });
        
        if (wlChanged) {
            localStorage.setItem('monitor_whitelist', JSON.stringify(whitelist));
            localStorage.setItem('monitor_reviewed', JSON.stringify(reviewed));
            if(typeof saveToServer === 'function') await saveToServer(['monitor_whitelist', 'monitor_reviewed'], false);
        }
    } else if (type === "2" || type === "3") {
        newPrefix = (type === "2") ? "External: " : "Idle: ";
        
        // Add to 'reviewed' list so it doesn't pop up again
        let reviewed = JSON.parse(localStorage.getItem('monitor_reviewed') || '[]');
        let whitelist = JSON.parse(localStorage.getItem('monitor_whitelist') || '[]');
        let revChanged = false;

        topics.forEach(t => {
            if (!reviewed.includes(t)) {
                reviewed.push(t);
                revChanged = true;
            }
            // Remove from whitelist if present
            const wlIdx = whitelist.indexOf(t);
            if (wlIdx > -1) {
                whitelist.splice(wlIdx, 1);
                revChanged = true;
            }
        });

        if (revChanged) {
            localStorage.setItem('monitor_reviewed', JSON.stringify(reviewed));
            localStorage.setItem('monitor_whitelist', JSON.stringify(whitelist));
            if(typeof saveToServer === 'function') await saveToServer(['monitor_reviewed', 'monitor_whitelist'], false);
        }
    } else {
        return;
    }
    
    const data = JSON.parse(localStorage.getItem('monitor_data') || '{}');
    let changed = false;
    
    Object.keys(data).forEach(user => {
        const activity = data[user];
        if (activity.history) {
            activity.history.forEach(h => {
                topics.forEach(topicName => {
                    if (h.activity.includes(topicName) && !h.activity.includes('(Reclassified)')) {
                        h.activity = `${newPrefix}${topicName} (Reclassified)`;
                        changed = true;
                    }
                });
            });
        }
        // Also update current if matches
        if (topics.some(t => activity.current.includes(t)) && !activity.current.includes('(Reclassified)')) {
            // Find which topic matched to construct label
            const match = topics.find(t => activity.current.includes(t));
            activity.current = `${newPrefix}${match} (Reclassified)`;
            changed = true;
        }
    });
    
    if (changed) {
        localStorage.setItem('monitor_data', JSON.stringify(data));
        // Mark as locally updated immediately to prevent overwrite on reload if sync is slow
        localStorage.setItem('sync_ts_monitor_data', new Date().toISOString());
        
        // OPTIMISTIC SAVE: Don't await. Let it sync in background to prevent UI freeze.
        if(typeof saveToServer === 'function') saveToServer(['monitor_data'], false); 
    }
    
    // Clear selection
    this.queueSelection.clear();
    
    document.getElementById('activityClassifyModal').classList.add('hidden');
    this.pendingTopic = null;
    this.forceRefresh = true; // Allow refresh to show updates
    renderActivityMonitorContent(); // Refresh UI
};

StudyMonitor.toggleReviewQueue = function() {
    if (this.viewMode === 'queue') {
        this.viewMode = 'list';
    } else {
        this.viewMode = 'queue';
        this.forceRefresh = true; // Force initial render of queue
    }
    renderActivityMonitorContent();
};

StudyMonitor.expandTimeline = function(agentName) {
    const data = JSON.parse(localStorage.getItem('monitor_data') || '{}');
    const activity = data[agentName];
    if (!activity) return alert("No data for this agent.");

    let modal = document.getElementById('timelineDetailModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'timelineDetailModal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '9999'; // Ensure it appears above the Activity Monitor
        modal.innerHTML = `
            <div class="modal-box" style="width:95%; max-width:1200px; height:85vh; display:flex; flex-direction:column;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid var(--border-color); padding-bottom:10px;">
                    <h3 style="margin:0;">Activity Detail: <span id="tlDetailName" style="color:var(--primary);"></span></h3>
                    <button class="btn-secondary" onclick="document.getElementById('timelineDetailModal').classList.add('hidden')"><i class="fas fa-times"></i> Close</button>
                </div>
                <div style="margin-bottom:20px;">
                    <div id="tlDetailVisual" class="timeline-visual" style="height:40px; border-radius:4px; overflow:hidden; display:flex;"></div>
                    <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--text-muted); margin-top:5px;">
                        <span>Start of Day</span>
                        <span>Current Time</span>
                    </div>
                </div>
                <div style="flex:1; overflow-y:auto; border:1px solid var(--border-color); border-radius:4px;">
                    <table class="admin-table">
                        <thead style="position:sticky; top:0; background:var(--bg-card); z-index:1;">
                            <tr>
                                <th>Time</th>
                                <th>Duration</th>
                                <th>Activity</th>
                                <th>Category</th>
                            </tr>
                        </thead>
                        <tbody id="tlDetailTable"></tbody>
                    </table>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }

    document.getElementById('tlDetailName').innerText = agentName;
    const visualContainer = document.getElementById('tlDetailVisual');
    const tableContainer = document.getElementById('tlDetailTable');
    
    visualContainer.innerHTML = '';
    tableContainer.innerHTML = '';

    // --- RECALCULATE SEGMENTS ---
    const allSegments = [...(activity.history || [])];
    const currentDuration = Date.now() - activity.since;
    if (currentDuration > 1000) {
        allSegments.push({
            activity: activity.current,
            start: activity.since,
            end: Date.now(),
            duration: currentDuration
        });
    }

    allSegments.sort((a, b) => (a.start || 0) - (b.start || 0));

    let totalMs = 0;
    const processedSegs = [];
    
    allSegments.forEach(seg => {
         const segStart = seg.start || (seg.end - seg.duration);
         const segEnd = seg.end || (segStart + seg.duration);
         
         const dateStr = new Date(segStart).toISOString().split('T')[0];
         const workStart = new Date(`${dateStr}T08:00:00`).getTime();
         const lunchStart = new Date(`${dateStr}T12:00:00`).getTime();
         const lunchEnd = new Date(`${dateStr}T13:00:00`).getTime();
         const workEnd = new Date(`${dateStr}T17:00:00`).getTime();

         const morningOverlap = Math.max(0, Math.min(segEnd, lunchStart) - Math.max(segStart, workStart));
         const afternoonOverlap = Math.max(0, Math.min(segEnd, workEnd) - Math.max(segStart, lunchEnd));
         const effectiveDuration = morningOverlap + afternoonOverlap;
         
         if (effectiveDuration <= 0) return;

         totalMs += effectiveDuration;

         const category = StudyMonitor.getCategory(seg.activity);
         const config = JSON.parse(localStorage.getItem('system_config') || '{}');
         const TOLERANCE = config.monitoring ? config.monitoring.tolerance_ms : 180000;
         let typeClass = 'seg-idle';
         let catLabel = 'Idle';
         let style = '';
         let rowColor = '';

         if (category === 'study') {
             typeClass = 'seg-study';
             catLabel = 'Study';
         } else if (category === 'external') {
             if (effectiveDuration > TOLERANCE) {
                 typeClass = 'seg-ext';
                 catLabel = 'External';
                 rowColor = 'color:#e74c3c; font-weight:bold;';
             } else {
                 style = `background: repeating-linear-gradient(45deg, #2ecc71, #2ecc71 5px, #f1c40f 5px, #f1c40f 10px);`;
                 typeClass = 'seg-study'; 
                 catLabel = 'External (Tolerated)';
                 rowColor = 'color:#f39c12;';
             }
         } else {
             if (effectiveDuration > TOLERANCE) {
                 typeClass = 'seg-idle';
                 catLabel = 'Idle';
             } else {
                 style = `background: repeating-linear-gradient(45deg, #2ecc71, #2ecc71 5px, #95a5a6 5px, #95a5a6 10px);`;
                 typeClass = 'seg-study';
                 catLabel = 'Idle (Thinking)';
                 rowColor = 'color:#95a5a6;';
             }
         }
         
         processedSegs.push({
             duration: effectiveDuration,
             activity: seg.activity,
             start: segStart,
             typeClass,
             style,
             catLabel,
             rowColor
         });
    });

    let visualHtml = '';
    let tableHtml = '';

    if (totalMs > 0) {
        processedSegs.forEach(p => {
            const pct = (p.duration / totalMs) * 100;
            visualHtml += `<div class="timeline-seg ${p.typeClass}" style="width:${pct}%; ${p.style}" title="${p.activity} (${Math.round(p.duration/1000)}s)"></div>`;
            
            const timeStr = new Date(p.start).toLocaleTimeString();
            const mins = (p.duration / 60000).toFixed(1) + 'm';
            
            tableHtml += `
                <tr style="${p.rowColor}">
                    <td>${timeStr}</td>
                    <td>${mins}</td>
                    <td>${p.activity}</td>
                    <td>${p.catLabel}</td>
                </tr>
            `;
        });
    } else {
        visualHtml = '<div style="text-align:center; width:100%; color:var(--text-muted); padding-top:10px;">No data in working hours.</div>';
        tableHtml = '<tr><td colspan="4" style="text-align:center;">No activity recorded during working hours (08:00 - 17:00).</td></tr>';
    }

    visualContainer.innerHTML = visualHtml;
    tableContainer.innerHTML = tableHtml;
    
    modal.classList.remove('hidden');
};

// Hook for dashboard.js to trigger updates if modal is open
StudyMonitor.updateWidget = function() {
    const modal = document.getElementById('activityMonitorModal');
    if (modal && !modal.classList.contains('hidden')) {
        renderActivityMonitorContent();
    }
};
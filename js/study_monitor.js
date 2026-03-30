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
    activityPoller: null, // Track the interval for global activity monitoring
    queueSelection: new Set(), // Persist selections across refreshes
    cachedWhitelist: [], // Cache for performance
    lastSyncedPayload: null, // OPTIMIZATION: Track last sync to prevent duplicate pushes
    // --- NEW: Tabbed Browser State ---
    browserState: {
        tabs: [],
        activeTabId: null,
        homeUrl: null,
    },
    
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

        // --- START BULLETPROOF OS-LEVEL ACTIVITY POLLER ---
        if (CURRENT_USER && CURRENT_USER.role === 'trainee') {
            this.startActivityPoller();
        }

        // --- NEW: CAPTURE EXIT ---
        window.addEventListener('beforeunload', () => {
            if (CURRENT_USER && CURRENT_USER.role === 'trainee') {
                if (window.electronAPI) window.electronAPI.ipcRenderer.send('stop-activity-monitor');
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

        // --- NEW: IPC Listener for OS-Level Webview Links (PDF Fix) ---
        if (typeof require !== 'undefined') {
            const { ipcRenderer } = require('electron');
            ipcRenderer.removeAllListeners('webview-new-window');
            ipcRenderer.on('webview-new-window', (e, url) => {
                if (this.isStudyOpen) {
                    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:') || url.startsWith('data:')) {
                        this.addTab(url, "New Tab", true);
                    } else {
                        require('electron').shell.openExternal(url);
                    }
                } else {
                    require('electron').shell.openExternal(url); // Fallback for TL Hub / other webviews
                }
            });
        }
    },

    // --- OS-AWARE ACTIVITY POLLING ---
    startActivityPoller: function() {
        if (this.activityPoller) clearInterval(this.activityPoller); // Clear legacy timeouts
        
        if (window.electronAPI) {
            window.electronAPI.ipcRenderer.removeAllListeners('activity-update');
            window.electronAPI.ipcRenderer.on('activity-update', (event, data) => {
                try {
                    const osIdleSeconds = data.osIdleSeconds;
                    const activeWindow = data.activeWindow;
                        
                    if (osIdleSeconds > 60) {
                        // Allow idling if waiting in Vetting Arena after submission
                        const vSession = JSON.parse(localStorage.getItem('vettingSession') || '{}');
                        if (vSession.active && vSession.trainees && CURRENT_USER && vSession.trainees[CURRENT_USER.user]?.status === 'completed') {
                             if (this.currentActivity !== 'Vetting: Waiting') this.track('Vetting: Waiting');
                             return;
                        }

                        if (this.currentActivity !== 'Idle') this.track('Idle');
                        return;
                    }

                    
                    let activityLabel = `External: ${activeWindow || 'Unknown App'}`;
                    let isPermitted = false;

                    if (activeWindow) {
                        if (activeWindow.includes('1st Line Training Portal')) {
                            isPermitted = true;
                            if (this.isStudyOpen) return; // Specific activity handled by webview events
                            activityLabel = "Navigating Portal";
                        } else {
                            const defaultSites = [
                                'acs.herotel.systems', 'crm.herotel.com', 'herotel.qcontact.com',
                                'radius.herotel.com', 'app.preseem.com', 'hosting.herotel.com',
                                'cp1.herotel.com', 'cp2.herotel.com', 'odoo.herotel.com'
                            ];
                            const workSites = JSON.parse(localStorage.getItem('monitor_whitelist') || JSON.stringify(defaultSites));

                            // Ensure all training and program keywords are permitted OS-level
                            const trainingKeywords = ['sharepoint', '.pdf', 'training', 'course', 'document', 'word', 'excel', 'powerpoint', 'onenote', 'odoo', 'genially', 'macvendor'];
                            const allPermitted = [...workSites, ...trainingKeywords];

                            // Check if window title contains any of the work sites
                            const matchedSite = allPermitted.find(site => site && activeWindow.toLowerCase().includes(site.toLowerCase()));
                            
                            if (matchedSite) {
                                // Classify as "Studying" (or Work) so it counts towards Focus Score
                                activityLabel = `Studying: ${matchedSite} (Work System)`;
                                isPermitted = true;
                            } else if (activeWindow.toLowerCase().includes('teams') || activeWindow.toLowerCase().includes('microsoft teams')) {
                                activityLabel = `Studying: MS Teams (Communication)`;
                                isPermitted = true;
                            } else if (activeWindow.toLowerCase().includes('outlook') || activeWindow.toLowerCase().includes('mail')) {
                                activityLabel = `Studying: Email (Communication)`;
                                isPermitted = true;
                            } else if (activeWindow.toLowerCase().includes('taskmgr') || activeWindow.toLowerCase().includes('task manager')) {
                                activityLabel = `System: Task Manager`;
                                isPermitted = true;
                            } else if (['explorer', 'searchhost', 'shellexperiencehost', 'taskbar', 'system tray', 'notification center', 'start', 'windows input experience'].some(sysApp => activeWindow.toLowerCase().includes(sysApp))) {
                                activityLabel = `System: Windows Navigation`;
                                isPermitted = true;
                            }
                        }
                    }

                    // Only trigger the warning & violation if it's strictly an external, non-permitted app
                    if (!isPermitted && activeWindow) {
                        const now = new Date();
                        const hour = now.getHours();
                        let isViolation = false;
                        
                        // Check Working Hours & Exclusions
                        if (hour >= 8 && hour < 17 && hour !== 12) {
                            const liveSessions = JSON.parse(localStorage.getItem('liveSessions') || '[]');
                            const myLive = liveSessions.find(s => s.trainee === CURRENT_USER.user && s.active);
                            const vSession = JSON.parse(localStorage.getItem('vettingSession') || '{}');
                            const inVetting = vSession.active && vSession.trainees && vSession.trainees[CURRENT_USER.user];
                            if (!myLive && !inVetting) isViolation = true;
                        }
                        
                        if (isViolation) {
                            activityLabel = `Violation: ${activeWindow}`;
                            this.triggerExternalAppWarning();
                        }
                    }

                    // Track the state change
                    if (this.currentActivity !== activityLabel && activityLabel !== "Navigating Portal") {
                        this.track(activityLabel);
                    } else if (activityLabel === "Navigating Portal" && (this.currentActivity === 'Idle' || this.currentActivity.startsWith('External:') || this.currentActivity.startsWith('Violation:'))) {
                        this.track("Navigating Portal");
                    }
                } catch (e) { console.error("External Monitor Error:", e); }
            });
            
            window.electronAPI.ipcRenderer.send('start-activity-monitor');
        }
    },

    triggerExternalAppWarning: function() {
        // DEFUSAL 3: Prevent infinite stacking of warning modals
        if (document.getElementById('external-app-warning-modal')) return;

        // Throttle: show once every 5 minutes max
        const lastWarning = sessionStorage.getItem('last_ext_warn');
        if (lastWarning && (Date.now() - parseInt(lastWarning) < 300000)) {
            return;
        }

        // Validation is now handled upstream in startActivityPoller
        
        sessionStorage.setItem('last_ext_warn', Date.now().toString());

        const modalHtml = `
            <div id="external-app-warning-modal">
                <div class="modal-box">
                    <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #f1c40f; margin-bottom: 15px;"></i>
                    <h2 style="color: #f1c40f;">Attention</h2>
                    <p style="line-height: 1.6;">
                        Moving outside of the scope of your Training Period is Prohibited during your study times.
                        <br><br>
                        <strong>Exceptions:</strong> Lunch, Live Assessments (if Required), or before 8 AM and after 5 PM.
                        <br><br>
                        <strong style="color: #ff5252;">Violation of this Protocol will be noted for Disciplinary action.</strong>
                    </p>
                    <button class="btn-primary" style="margin-top: 20px;" onclick="document.getElementById('external-app-warning-modal').remove()">I Understand</button>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    },

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
        this.sync(); // Trigger sync check immediately on activity change
    },

    recordClick: function() {
        this.clickCount++;
        // FIX: Ensure study activity counts as global interaction to prevent "Idle" status
        if (typeof window !== 'undefined') window.LAST_INTERACTION = Date.now();
    },

    // --- DEFUSAL 1: PREVENT ADMIN DATA OVERWRITES ---
    reclassifyHistory: function() {
        this.updateWhitelistCache();
        let changed = false;
        
        const applyWhitelist = (activityString) => {
            if ((activityString.startsWith('External: ') || activityString.startsWith('Violation: ')) && !activityString.includes('(Reclassified)')) {
                const raw = activityString.replace(/^(External|Violation):\s*/, '').trim();
                if (this.cachedWhitelist.some(w => raw.toLowerCase().includes(w.toLowerCase()))) {
                    return `Studying: ${raw} (Reclassified)`;
                }
            }
            return activityString;
        };

        this.history.forEach(h => {
            const newAct = applyWhitelist(h.activity);
            if (newAct !== h.activity) { h.activity = newAct; changed = true; }
        });
        
        const newCurr = applyWhitelist(this.currentActivity);
        if (newCurr !== this.currentActivity) { this.currentActivity = newCurr; changed = true; }
        
        return changed;
    },

    sync: async function() {
        if (!CURRENT_USER || CURRENT_USER.role === 'admin') return; // Don't track admins

        // ROBUSTNESS: Check for day rollover dynamically (e.g. user left app open overnight)
        await this.checkDailyReset();

        // Auto-reconcile history against latest Admin rules before pushing
        this.reclassifyHistory();

        const payload = {
            user: CURRENT_USER.user,
            current: this.currentActivity,
            since: this.startTime,
            isStudyOpen: this.isStudyOpen,
            history: this.history,
            date: this.getLocalDateString() // UPDATED: Use Local Date
        };

        // OPTIMIZATION: Only sync if data changed since last successful push
        const payloadStr = JSON.stringify(payload);
        if (this.lastSyncedPayload === payloadStr) return;

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
                if (typeof saveToServer === 'function') {
                    await saveToServer(['monitor_data'], false, true);
                    this.lastSyncedPayload = payloadStr; // Update cache on success
                }
                
            } catch (e) {
                console.error("Monitor Sync Error", e);
            }
        }
    },

    updateWhitelistCache: function() {
        // Filter out empty strings to prevent false positive matches
        this.cachedWhitelist = (JSON.parse(localStorage.getItem('monitor_whitelist') || '[]')).filter(w => w && w.trim().length > 0);
    },

    // --- HELPER: LOCAL DATE STRING (YYYY-MM-DD) ---
    getLocalDateString: function() {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    },

    // --- HELPER: CENTRALIZED CLASSIFICATION (with Violation) ---
    getCategory: function(activityString) {
        if (!activityString) return 'idle';
        const act = activityString.toLowerCase();
        
        // 0. Violation is always external
        if (act.startsWith('violation:')) return 'external';

        // 1. Dynamic Whitelist Check
        const raw = act.replace(/^(external:\s*|violation:\s*|studying:\s*)/i, '').trim();
        if (this.cachedWhitelist.some(w => raw.includes(w.toLowerCase()))) {
            if (raw.includes('sharepoint') || raw.includes('training')) return 'material';
            return 'tool';
        }
        
        const toolsKeywords = ['qcontact', 'crm', 'radius', 'preseem', 'acs', 'hosting', 'odoo', 'cp1', 'cp2', 'teams', 'outlook', 'mail', 'notepad', 'onenote', 'macvendor'];
        if (toolsKeywords.some(t => act.includes(t))) return 'tool';

        // 2. STRICT MODE CHECK
        const config = JSON.parse(localStorage.getItem('system_config') || '{}');
        if (config.monitoring && config.monitoring.whitelist_strict) {
            if (!act.startsWith('idle:')) return 'external';
        }
        
        // Distinguish between actual course material and supportive tools
        if (act.includes('sharepoint') || act.includes('course') || act.includes('navigating portal') || act.includes('vetting:')) return 'material';
        if (act.startsWith('studying:') || act.includes('system:') || act.includes('navigating:')) return 'tool';

        if (act.startsWith('external:') || act.includes('external') || act.includes('background')) return 'external';
        if (act.startsWith('idle:')) return 'idle';
        return 'idle'; // Default
    },

    // --- HELPER: CALCULATE DAILY STATS (Working Hours Only) ---
    calculateDailyStats: function(historySegments) {
        let totalMs = 0, materialMs = 0, toolMs = 0, extMs = 0, idleMs = 0;
        
        historySegments.forEach(seg => {
             const segStart = seg.start || (seg.end - seg.duration);
             const segEnd = seg.end || (segStart + seg.duration);
             
             // Local Date Construction for Boundaries
             const d = new Date(segStart);
             const dateStr = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
             
             const workStart = new Date(`${dateStr}T08:00:00`).getTime();
             const lunchStart = new Date(`${dateStr}T12:00:00`).getTime();
             const lunchEnd = new Date(`${dateStr}T13:00:00`).getTime();
             const workEnd = new Date(`${dateStr}T17:00:00`).getTime();

             // 1. Morning Session (08:00 - 12:00)
             const morningOverlap = Math.max(0, Math.min(segEnd, lunchStart) - Math.max(segStart, workStart));
             // 2. Afternoon Session (13:00 - 17:00)
             const afternoonOverlap = Math.max(0, Math.min(segEnd, workEnd) - Math.max(segStart, lunchEnd));
             
             const effectiveDuration = morningOverlap + afternoonOverlap;
             
             if (effectiveDuration <= 0) return;

             totalMs += effectiveDuration;
             const category = this.getCategory(seg.activity);
             const config = JSON.parse(localStorage.getItem('system_config') || '{}');
             const TOLERANCE = config.monitoring ? config.monitoring.tolerance_ms : 180000;
             
             if (category === 'material') {
                 materialMs += effectiveDuration;
             } else if (category === 'tool') {
                 toolMs += effectiveDuration;
             } else if (category === 'external') {
                 if (effectiveDuration > TOLERANCE) {
                     toolMs += TOLERANCE;
                     extMs += (effectiveDuration - TOLERANCE);
                 } else {
                     toolMs += effectiveDuration;
                 }
             } else {
                 if (effectiveDuration > TOLERANCE) {
                     toolMs += TOLERANCE;
                     idleMs += (effectiveDuration - TOLERANCE);
                 } else {
                     toolMs += effectiveDuration;
                 }
             }
        });
        
        return { material: materialMs, tool: toolMs, study: materialMs + toolMs, external: extMs, idle: idleMs, total: totalMs };
    },

    // --- DAILY ARCHIVE LOGIC ---
    checkDailyReset: async function() {
        if (!CURRENT_USER || CURRENT_USER.role === 'admin') return;
        this.updateWhitelistCache(); // Ensure we use latest rules for archiving
        
        let monitorData = JSON.parse(localStorage.getItem('monitor_data') || '{}');
        let myData = monitorData[CURRENT_USER.user];
        
        if (myData) {
            // Determine Today (Local)
            const today = this.getLocalDateString();
            
            // Determine Last Date (Local) - Handle legacy data
            let lastDate = myData.date;
            if (!lastDate && myData.since) {
                const d = new Date(myData.since);
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                lastDate = `${y}-${m}-${day}`;
            }
            
            if (lastDate !== today) {
                console.log(`New Day Detected (${lastDate} -> ${today}). Archiving Activity Log...`);
                let history = JSON.parse(localStorage.getItem('monitor_history') || '[]');
                
                // Use memory history if available (most recent), else fallback to storage
                const segments = this.history.length > 0 ? this.history : (myData.history || []);
                const stats = this.calculateDailyStats(segments);

                history.push({
                    date: lastDate,
                    user: CURRENT_USER.user,
                    summary: stats,
                    details: segments // Archive full details
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
                this.startTime = Date.now(); // Reset start time for new day
                
                // ROBUSTNESS FIX: Use 'false' (Safe Merge) to prevent overwriting other users' history entries
                if (typeof saveToServer === 'function') await saveToServer(['monitor_data', 'monitor_history'], false);
            }
        }
    },

    // --- STUDY BROWSER REWORK ---
    openStudyWindow: function(url, title, targetScrollY = null) {
        const overlay = document.getElementById('study-overlay');
        if (!overlay) return;

        // Remove restore button if it was floating
        const restoreBtn = document.getElementById('study-restore-btn');
        if (restoreBtn) restoreBtn.remove();

        this.isStudyOpen = true;
        this.track(`Studying: ${title}`);
        this.browserState.homeUrl = this.cleanUrl(url);

        // Build browser shell if it doesn't exist
        if (!document.getElementById('study-browser-shell')) {
            overlay.innerHTML = this.getBrowserShellHTML();
            this.attachNavEvents();
            this.addTab(url, title, true, targetScrollY); // Add and activate the first tab
        } else {
            // Shell exists (was hidden), check if tab already exists to prevent duplicates
            const cleanUrl = this.cleanUrl(url);
            // FIX: Match ONLY by URL to prevent overwriting different tabs with the same generic title
            const existingTab = this.browserState.tabs.find(t => t.url === cleanUrl);
            if (existingTab) {
                this.switchTab(existingTab.id);
                if (targetScrollY && existingTab.webview) {
                    existingTab.webview.executeJavaScript(`window.scrollTo({top: ${targetScrollY}, behavior: 'smooth'})`).catch(()=>{});
                }
            } else {
                this.addTab(url, title, true, targetScrollY);
            }
        }
        
        overlay.classList.remove('hidden');
    },

    minimizeStudyWindow: function() {
        const overlay = document.getElementById('study-overlay');
        if (overlay) overlay.classList.add('hidden');
        this.isStudyOpen = false;
        this.track("Navigating: Dashboard (Study Minimized)");
        
        // Add persistent floating button to return to tabs
        if (!document.getElementById('study-restore-btn')) {
            const btn = document.createElement('button');
            btn.id = 'study-restore-btn';
            btn.className = 'btn-primary';
            btn.innerHTML = '<i class="fas fa-book-open"></i> Active Study Session (Click to Return)';
            btn.style.cssText = 'position:fixed; bottom:40px; right:40px; z-index:99999; box-shadow:0 10px 30px rgba(243, 112, 33, 0.6); border-radius:30px; padding:15px 30px; font-weight:bold; font-size:1.2rem; background: var(--primary); color: white; animation: pulse 2s infinite; border: 3px solid white; cursor: pointer;';
            btn.onclick = () => StudyMonitor.restoreStudyWindow();
            document.body.appendChild(btn);
        }
    },

    restoreStudyWindow: function() {
        const overlay = document.getElementById('study-overlay');
        if (overlay) overlay.classList.remove('hidden');
        this.isStudyOpen = true;
        
        const activeTab = this.browserState.tabs.find(t => t.id === this.browserState.activeTabId);
        if (activeTab) {
            this.track(`Studying: ${activeTab.title}`);
        } else {
            this.track("Navigating: Study Browser");
        }
        
        const btn = document.getElementById('study-restore-btn');
        if (btn) btn.remove();
    },

    closeStudyWindow: function() {
        const overlay = document.getElementById('study-overlay');
        if (overlay) overlay.classList.add('hidden');
        
        // Cleanup
        this.isStudyOpen = false;
        this.browserState.tabs = [];
        this.browserState.activeTabId = null;
        this.browserState.homeUrl = null;
        if (overlay) overlay.innerHTML = ''; // Destroy webviews and UI

        const btn = document.getElementById('study-restore-btn');
        if (btn) btn.remove();

        this.track("Navigating: Schedule"); // Assume return to schedule
    },

    getBrowserShellHTML: function() {
        const quickLinks = [
            { name: "Q-Contact", url: "https://herotel.qcontact.com/login" },
            { name: "CRM", url: "https://crm.herotel.com" },
            { name: "Radius", url: "https://radius.herotel.com" },
            { name: "Odoo", url: "https://odoo.herotel.com/web#cids=1&menu_id=1040&action=1653" },
            { name: "ACS", url: "https://acs.herotel.systems" },
            { name: "Hosting", url: "https://hosting.herotel.com/login" },
            { name: "Preseem", url: "https://app.preseem.com" }
        ];

        return `
            <div id="study-browser-shell">
                <div class="study-header">
                    <div class="study-nav-controls">
                        <button id="study-nav-back" title="Back"><i class="fas fa-arrow-left"></i></button>
                        <button id="study-nav-forward" title="Forward"><i class="fas fa-arrow-right"></i></button>
                        <button id="study-nav-reload" title="Reload"><i class="fas fa-sync-alt"></i></button>
                        <button id="study-nav-home" title="Home"><i class="fas fa-home"></i></button>
                    </div>
                    <div class="study-tabs-container">
                        <div id="study-tabs-list"></div>
                    </div>
                    <div class="study-header-actions">
                    <button id="study-bookmark-btn" class="btn-secondary" onmousedown="StudyMonitor.startMarkForClarity()" title="Drag a box to mark a spot for clarity" style="padding: 8px 15px; font-weight:bold; border-color:#f1c40f; color:#f1c40f;"><i class="fas fa-crop-alt"></i> Mark for Clarity</button>
                    <button id="study-min-btn" class="btn-primary" onmousedown="StudyMonitor.minimizeStudyWindow()" title="Keep tabs open and return to Dashboard" style="padding: 8px 15px; font-weight:bold;"><i class="fas fa-desktop"></i> Dashboard</button>
                        <select id="study-quick-links" onchange="StudyMonitor.navigateQuickLink(this.value)">
                            <option value="">Program Links</option>
                            ${quickLinks.map(l => `<option value="${l.url}">${l.name}</option>`).join('')}
                        </select>
                    <button id="study-close-btn" onmousedown="StudyMonitor.closeStudyWindow()" title="Close all tabs and exit"><i class="fas fa-times"></i> Exit</button>
                    </div>
                </div>
                <div id="study-webview-container"></div>
            </div>
        `;
    },

    attachNavEvents: function() {
        document.getElementById('study-nav-back').onmousedown = () => this.getActiveWebview()?.goBack();
        document.getElementById('study-nav-forward').onmousedown = () => this.getActiveWebview()?.goForward();
        document.getElementById('study-nav-reload').onmousedown = () => this.getActiveWebview()?.reload();
        document.getElementById('study-nav-home').onmousedown = () => this.getActiveWebview()?.loadURL(this.browserState.homeUrl);
    },

    navigateQuickLink: function(url) {
        if (!url) return;
        const sel = document.getElementById('study-quick-links');
        const title = sel.options[sel.selectedIndex].text;
        
        // FIX: Always open Quick Links in a new tab to prevent overwriting active study material
        this.addTab(url, title, true);
        
        sel.selectedIndex = 0; // Reset dropdown
    },

    startMarkForClarity: function() {
        const wv = this.getActiveWebview();
        if (!wv) return alert("No active tab to mark.");
        
        const script = `
            (function() {
                if(window.__markActive) return;
                window.__markActive = true;

                var overlay = document.createElement('div');
                overlay.style.position = 'fixed';
                overlay.style.top = '0'; overlay.style.left = '0';
                overlay.style.width = '100vw'; overlay.style.height = '100vh';
                overlay.style.zIndex = '2147483647';
                overlay.style.cursor = 'crosshair';
                overlay.style.background = 'rgba(0,0,0,0.2)';
                
                var banner = document.createElement('div');
                banner.style.position = 'absolute';
                banner.style.top = '20px';
                banner.style.left = '50%';
                banner.style.transform = 'translateX(-50%)';
                banner.style.background = '#f1c40f';
                banner.style.color = '#000';
                banner.style.padding = '10px 20px';
                banner.style.borderRadius = '30px';
                banner.style.fontWeight = 'bold';
                banner.style.fontFamily = 'sans-serif';
                banner.style.pointerEvents = 'none';
                banner.innerText = "Click and drag to mark a specific area for clarity. (Press ESC to cancel)";
                overlay.appendChild(banner);

                document.body.appendChild(overlay);

                var box = document.createElement('div');
                box.style.position = 'absolute';
                box.style.border = '3px dashed #f1c40f';
                box.style.background = 'rgba(241, 196, 15, 0.3)';
                box.style.pointerEvents = 'none';
                document.body.appendChild(box);

                var startX, startY;
                var isDrawing = false;

                var onMouseDown = function(e) {
                    isDrawing = true;
                    startX = e.clientX;
                    startY = e.clientY;
                    box.style.left = startX + 'px';
                    box.style.top = startY + 'px';
                    box.style.width = '0px';
                    box.style.height = '0px';
                };

                var onMouseMove = function(e) {
                    if(!isDrawing) return;
                    var currentX = e.clientX;
                    var currentY = e.clientY;
                    box.style.left = Math.min(currentX, startX) + 'px';
                    box.style.top = Math.min(currentY, startY) + 'px';
                    box.style.width = Math.abs(currentX - startX) + 'px';
                    box.style.height = Math.abs(currentY - startY) + 'px';
                };

                var onMouseUp = function(e) {
                    if(!isDrawing) return;
                    isDrawing = false;
                    
                    var rect = box.getBoundingClientRect();
                    var targetY = window.scrollY + rect.top;
                    var selection = window.getSelection().toString();

                    cleanup();
                    
                    var marker = document.createElement('div');
                    marker.style.position = 'absolute';
                    marker.style.left = '0';
                    marker.style.top = targetY + 'px';
                    marker.style.width = '8px';
                    marker.style.height = Math.max(20, rect.height) + 'px';
                    marker.style.background = '#f1c40f';
                    marker.style.zIndex = '2147483646';
                    marker.style.borderTopRightRadius = '4px';
                    marker.style.borderBottomRightRadius = '4px';
                    marker.title = "Marked for Clarity";
                    document.body.appendChild(marker);

                    console.log('__MARK_CLARITY__:' + JSON.stringify({ scrollY: targetY, selection: selection }));
                };

                var onKeyDown = function(e) {
                    if(e.key === 'Escape') cleanup();
                };

                var cleanup = function() {
                    overlay.removeEventListener('mousedown', onMouseDown);
                    overlay.removeEventListener('mousemove', onMouseMove);
                    overlay.removeEventListener('mouseup', onMouseUp);
                    document.removeEventListener('keydown', onKeyDown);
                    if(overlay.parentNode) overlay.remove();
                    if(box.parentNode) box.remove();
                    window.__markActive = false;
                };

                overlay.addEventListener('mousedown', onMouseDown);
                overlay.addEventListener('mousemove', onMouseMove);
                overlay.addEventListener('mouseup', onMouseUp);
                document.addEventListener('keydown', onKeyDown);
            })();
        `;
        wv.executeJavaScript(script).catch(e => console.error("Mark Script Injection Failed", e));
    },

    processMarkForClarity: async function(dataStr, tabId) {
        const data = JSON.parse(dataStr);
        const tab = this.browserState.tabs.find(t => t.id === tabId);
        if(!tab) return;
        const wv = tab.webview;

        let url = wv.getURL();
        let title = wv.getTitle();
        let scrollY = data.scrollY || 0;
        let selection = data.selection || "";

        // HIDE ENTIRE STUDY OVERLAY TO SHOW PROMPT (Fixes Z-Index and native PDF viewer issues)
        const overlay = document.getElementById('study-overlay');
        if(overlay) overlay.style.display = 'none';
        
        const inputModal = document.getElementById('genericInputModal');
        if(inputModal) inputModal.style.zIndex = '2147483647';
        
        let promptMsg = `Page: ${title}\n\n`;
        if (selection && selection.trim().length > 0) {
            promptMsg += `Highlighted Text: "${selection.substring(0, 100)}..."\n\n`;
        }
        promptMsg += `What do you need clarity on for this marked section? (Required)`;
        
        const note = await customPrompt("Mark for Clarity", promptMsg, "");
        
        // RESTORE OVERLAY IMMEDIATELY
        if(overlay) overlay.style.display = '';

        if (note === null) return; // Cancelled
        if (note.trim() === "") return alert("A clarification question or note is required.");
        
        let finalNote = note.trim();
        if (selection && selection.trim().length > 0) {
            finalNote = `Context: "${selection.substring(0, 100)}"\nQuestion: ${finalNote}`;
        }

        const allBookmarks = JSON.parse(localStorage.getItem('trainee_bookmarks') || '{}');
        const bookmarks = allBookmarks[CURRENT_USER.user] || [];
        bookmarks.push({
            id: Date.now(), url: url, title: title.substring(0, 50), note: finalNote, scrollY: scrollY, date: new Date().toISOString()
        });
        
        allBookmarks[CURRENT_USER.user] = bookmarks;
        localStorage.setItem('trainee_bookmarks', JSON.stringify(allBookmarks));
        if (typeof saveToServer === 'function') saveToServer(['trainee_bookmarks'], false);
        
        if (typeof showToast === 'function') showToast("Spot marked for clarity! Check your Dashboard.", "success");
    },

    addTab: function(url, title, activate = false, targetScrollY = null) {
        const tabId = `tab-${Date.now()}`;
        const cleanUrl = this.cleanUrl(url);

        const webview = document.createElement('webview');
        webview.id = `webview-${tabId}`;
        webview.src = cleanUrl;
        webview.style.width = '100%';
        webview.style.height = '100%';
        // REQUIRED: Allows target="_blank" links to fire the 'new-window' event so we can intercept them.
        webview.setAttribute('allowpopups', 'true');
        // DEFUSAL 2: Strict Microsoft Edge Spoofing to bypass SSO Conditional Access blocks
        webview.setAttribute('useragent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0');
        // UX ENHANCEMENT: Force persistent session for cookies to survive app restarts
        webview.setAttribute('partition', 'persist:study_session');
        webview.classList.add('study-webview');
        if (!activate) webview.classList.add('hidden');

        const container = document.getElementById('study-webview-container');
        container.appendChild(webview);

        const newTab = { id: tabId, title: title.substring(0, 20), url: cleanUrl, webview: webview, targetScrollY: targetScrollY };
        this.browserState.tabs.push(newTab);

        this.renderTabs();
        this.attachWebviewEvents(newTab);

        if (activate) {
            this.switchTab(tabId);
        }
    },

    switchTab: function(tabId) {
        this.browserState.activeTabId = tabId;
        this.browserState.tabs.forEach(tab => {
            const isHidden = tab.id !== tabId;
            tab.webview.classList.toggle('hidden', isHidden);
        });
        this.renderTabs();
    },

    closeTab: function(tabId) {
        const tabIndex = this.browserState.tabs.findIndex(t => t.id === tabId);
        if (tabIndex === -1) return;

        const tabToClose = this.browserState.tabs[tabIndex];
        tabToClose.webview.remove();

        this.browserState.tabs.splice(tabIndex, 1);

        if (this.browserState.tabs.length === 0) {
            this.closeStudyWindow();
        } else {
            if (this.browserState.activeTabId === tabId) {
                const newActiveIndex = Math.max(0, tabIndex - 1);
                this.switchTab(this.browserState.tabs[newActiveIndex].id);
            }
            this.renderTabs();
        }
    },

    renderTabs: function() {
        const tabsList = document.getElementById('study-tabs-list');
        if (!tabsList) return;
        tabsList.innerHTML = this.browserState.tabs.map(tab => {
            const isActive = tab.id === this.browserState.activeTabId;
            return `
                <div class="study-tab ${isActive ? 'active' : ''}" onmousedown="StudyMonitor.switchTab('${tab.id}')">
                    <span class="study-tab-title">${tab.title}</span>
                    <button class="study-tab-close" onmousedown="event.stopPropagation(); StudyMonitor.closeTab('${tab.id}')"><i class="fas fa-times"></i></button>
                </div>
            `;
        }).join('');
    },

    getActiveWebview: function() {
        if (!this.browserState.activeTabId) return null;
        const activeTab = this.browserState.tabs.find(t => t.id === this.browserState.activeTabId);
        return activeTab ? activeTab.webview : null;
    },

    attachWebviewEvents: function(tab) {
        const webview = tab.webview;
        
        webview.addEventListener('did-start-loading', () => {
            const tabEl = document.querySelector(`.study-tab[onclick*="${tab.id}"] .study-tab-title`);
            if (tabEl) tabEl.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Loading...`;
        });

        webview.addEventListener('did-stop-loading', () => {
            const newTitle = webview.getTitle().substring(0, 20);
            tab.title = newTitle;
            this.renderTabs();
            
            // Restore Scroll Position if requested
            if (tab.targetScrollY) {
                setTimeout(() => {
                    webview.executeJavaScript(`window.scrollTo({top: ${tab.targetScrollY}, behavior: 'smooth'})`).catch(()=>{});
                    tab.targetScrollY = null; // Clear after use to prevent re-scrolls on normal navigation
                }, 500);
            }
        });

        // ARCHITECTURAL FIX: SPAs (Single Page Apps like Q-Contact, CRM, SharePoint)
        // change titles dynamically without triggering 'did-navigate'.
        // We must track 'page-title-updated' to capture what they are actually doing inside the app.
        webview.addEventListener('page-title-updated', (e) => {
            tab.title = e.title.substring(0, 20);
            this.renderTabs();
            
            if (this.browserState.activeTabId === tab.id) {
                this.track(`Studying: ${e.title.substring(0, 50)}`);
            }
        });

        webview.addEventListener('did-navigate', (e) => {
            tab.url = e.url;

            this.track(`Studying: ${webview.getTitle().substring(0, 50)}`);
        });

        webview.addEventListener('new-window', (e) => {
            e.preventDefault();
            // DEFUSAL 2 (Part B): Catch standard links + SharePoint blobs, send Native OS triggers (mailto/ms-auth) outward
            // Note: This is kept as a fallback, but the IPC listener above now handles the heavy lifting for PDFs.
            if (e.url.startsWith('http://') || e.url.startsWith('https://') || e.url.startsWith('blob:') || e.url.startsWith('data:')) {
                this.addTab(e.url, "New Tab", true);
            } else {
                if (typeof require !== 'undefined') require('electron').shell.openExternal(e.url);
            }
        });

        webview.addEventListener('crashed', () => {
            this.track("System: Study Window Crashed");
            this.closeTab(tab.id);
        });

        webview.addEventListener('dom-ready', () => {
            webview.executeJavaScript(`
                document.addEventListener('click', () => { console.log('__STUDY_CLICK__'); });
            `);
        });

        webview.addEventListener('console-message', (e) => {
            if (e.message === '__STUDY_CLICK__') {
                this.recordClick();
            } else if (typeof e.message === 'string' && e.message.startsWith('__MARK_CLARITY__:')) {
                const dataStr = e.message.substring(17);
                this.processMarkForClarity(dataStr, tab.id);
            }
        });
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
        else if (activity.current.startsWith('Violation')) statusBadge = '<span class="status-badge" style="background:#ff5252; color:white; font-weight:bold; padding:2px 8px;"><i class="fas fa-exclamation-triangle"></i> Violation</span>';
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
        else if (activity.current.includes('Violation')) card.style.borderLeftColor = '#ff0000';
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
            let histHtml = `<ul style="list-style:none; padding:0; margin:0; font-size:0.85rem;">
                ${recent.map(h => {
                    const dur = Math.round(h.duration / 1000) + 's';
                    const time = new Date(h.start).toLocaleTimeString();
                    const clickInfo = h.clicks ? ` | <i class="fas fa-mouse-pointer" style="font-size:0.7rem;"></i> ${h.clicks}` : '';
                    const isVio = h.activity.startsWith('Violation');
                    return `<li style="border-bottom:1px solid var(--border-color); padding:4px 0; display:flex; justify-content:space-between; ${isVio ? 'color:#ff5252; font-weight:bold;' : ''}">
                        <span>${isVio ? '<i class="fas fa-exclamation-triangle"></i> ' : ''}${h.activity}</span>
                        <span style="color:var(--text-muted); font-family:monospace;">${time} (${dur}${clickInfo})</span>
                    </li>`;
                }).join('')}
            </ul>`;
            if (histContainer) {
                const scrollPos = histContainer.scrollTop;
                histContainer.innerHTML = histHtml;
                histContainer.scrollTop = scrollPos;
            }
        } else {
            if (histContainer) histContainer.innerHTML = '<div style="font-style:italic; color:var(--text-muted);">No history recorded yet.</div>';
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
    const whitelist = JSON.parse(localStorage.getItem('monitor_whitelist') || '[]').filter(s => s && s.trim());
    const reviewed = JSON.parse(localStorage.getItem('monitor_reviewed') || '[]').filter(s => s && s.trim());
    const groups = {}; // Group by Process ID [proc]
    const ungrouped = new Set();
    
    Object.values(data).forEach(userActivity => {
        const processItem = (act) => {
            if ((act.startsWith('External: ') || act.startsWith('Violation: ')) && !act.includes('(Reclassified)')) {
                const raw = act.replace(/^(External:\s*|Violation:\s*)/, '').trim();
                
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
        
        // --- ADMIN UX: FETCH TODAY'S SCHEDULED TASK ---
        const schedules = JSON.parse(localStorage.getItem('schedules') || '{}');
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        let todaysTask = "No Task Assigned";
        let myGroupId = null;
        for (const [gid, members] of Object.entries(rosters)) {
            if (members.some(m => m.toLowerCase() === agent.toLowerCase())) { myGroupId = gid; break; }
        }
        if (myGroupId) {
            const schedKey = Object.keys(schedules).find(k => schedules[k].assigned === myGroupId);
            if (schedKey && schedules[schedKey].items) {
                const todayStr = new Date().toISOString().split('T')[0].replace(/-/g, '/');
                const task = schedules[schedKey].items.find(i => {
                    if (typeof isDateInRange === 'function') return isDateInRange(i.dateRange, i.dueDate, todayStr);
                    return i.dateRange <= todayStr && (i.dueDate ? i.dueDate >= todayStr : i.dateRange >= todayStr);
                });
                if (task) todaysTask = task.courseName;
            }
        }

        // 1. Aggregate Data
        let totalMs = 0, materialMs = 0, toolMs = 0, extMs = 0, idleMs = 0;
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
            
            if (category === 'material') {
                materialMs += effectiveDuration;
                let topic = seg.activity.replace('Studying: ', '').split('(')[0].trim();
                // URL CLEANUP
                if (topic.includes('sharepoint.com') || topic.includes('microsoftonline.com')) {
                    if (topic.includes('.mp4') || topic.includes('stream.aspx')) topic = 'Training Video (SharePoint)';
                    else topic = 'Training Document (SharePoint)';
                }
                if (!topicMap[topic]) topicMap[topic] = { ms: 0, type: 'material' };
                topicMap[topic].ms += effectiveDuration;
            } else if (category === 'tool') {
                toolMs += effectiveDuration;
                let topic = seg.activity.replace('Studying: ', '').split('(')[0].trim();
                if (topic.includes('System:') || topic.includes('Navigating:')) topic = 'System Navigation';
                if (!topicMap[topic]) topicMap[topic] = { ms: 0, type: 'tool' };
                topicMap[topic].ms += effectiveDuration;
            } else if (category === 'external') {
                let topic = seg.activity.replace(/^(External:\s*|Violation:\s*)/i, '').trim();
                const isViolation = seg.activity.toLowerCase().includes('violation');
                
                if (!topicMap[topic]) topicMap[topic] = { ms: 0, type: isViolation ? 'violation' : 'external' }; 
                if (effectiveDuration > TOLERANCE) {
                    // LENIENT MODE: Forgive the first X minutes (TOLERANCE) as "Transition/Setup"
                    toolMs += TOLERANCE;
                    extMs += (effectiveDuration - TOLERANCE);
                    topicMap[topic].type = isViolation ? 'violation' : 'external';
                } else {
                    toolMs += effectiveDuration; // Tolerated
                }
                topicMap[topic].ms += effectiveDuration;
            } else {
                // Track Idle as a topic for visibility in breakdown
                const topic = "Idle / Away";
                if (!topicMap[topic]) topicMap[topic] = { ms: 0, type: 'idle' };

                if (effectiveDuration > TOLERANCE) {
                    toolMs += TOLERANCE; // Thinking time
                    idleMs += (effectiveDuration - TOLERANCE);
                }
                else toolMs += effectiveDuration; // Thinking time
                topicMap[topic].ms += effectiveDuration;
            }
        });

        // 2. Calculate Stats
        // FIX: Handle 0ms (e.g. before 8am) to show N/A instead of 0% Fail
        let focusScore = 0;
        let materialScore = 0;
        let scoreText = 'N/A';
        let matText = 'N/A';
        let scoreColor = 'var(--text-muted)'; // Default Grey

        if (totalMs > 0) {
            focusScore = Math.round(((materialMs + toolMs) / totalMs) * 100);
            materialScore = Math.round((materialMs / totalMs) * 100);
            scoreText = focusScore + '%';
            matText = materialScore + '%';
            
            if (materialScore < 30) scoreColor = '#ff5252'; 
            else if (materialScore < 60) scoreColor = '#f1c40f';
            else scoreColor = '#3498db'; 
        }

        const matTimeStr = Math.round(materialMs / 60000) + 'm';
        const toolTimeStr = Math.round(toolMs / 60000) + 'm';
        const extTimeStr = Math.round(extMs / 60000) + 'm';
        const idleTimeStr = Math.round(idleMs / 60000) + 'm';

        // 3. Precise Activity Breakdown
        const matTopics = Object.entries(topicMap).filter(t => t[1].type === 'material').sort((a,b)=>b[1].ms - a[1].ms);
        const toolTopics = Object.entries(topicMap).filter(t => t[1].type === 'tool').sort((a,b)=>b[1].ms - a[1].ms);
        const extTopics = Object.entries(topicMap).filter(t => t[1].type === 'external').sort((a,b)=>b[1].ms - a[1].ms);
        const vioTopics = Object.entries(topicMap).filter(t => t[1].type === 'violation').sort((a,b)=>b[1].ms - a[1].ms);

        let breakdownHtml = '';
        
        const renderList = (title, items, color, icon) => {
            if (items.length === 0) return '';
            let html = `<div style="font-size:0.75rem; font-weight:bold; color:${color}; margin-top:5px; padding-bottom:2px; border-bottom:1px solid ${color}55;"><i class="fas ${icon}"></i> ${title}</div>`;
            items.forEach(([topic, data]) => {
                const timeStr = data.ms < 60000 ? '< 1m' : Math.round(data.ms/60000) + 'm';
                const actionBtn = (data.type === 'external' || data.type === 'violation') ? `<button class="btn-secondary btn-sm" style="padding:0 4px; font-size:0.6rem; margin-left:5px;" onclick="StudyMonitor.classifyActivity('${topic.replace(/'/g, "\\'")}')" title="Classify Activity"><i class="fas fa-edit"></i></button>` : '';
                html += `<div style="display:flex; justify-content:space-between; font-size:0.8rem; padding:2px 0;">
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:75%;" title="${topic}">${topic}</span>
                    <span>${timeStr}${actionBtn}</span>
                </div>`;
            });
            return html;
        };

        breakdownHtml += renderList('Training Material', matTopics, '#3498db', 'fa-book-open');
        breakdownHtml += renderList('Support Tools', toolTopics, '#2ecc71', 'fa-tools');
        breakdownHtml += renderList('External / Browsing', extTopics, '#f39c12', 'fa-external-link-alt');
        breakdownHtml += renderList('Security Violations', vioTopics, '#ff5252', 'fa-exclamation-triangle');
        
        if (matTopics.length===0 && toolTopics.length===0 && extTopics.length===0 && vioTopics.length===0) {
            breakdownHtml += '<div style="color:var(--text-muted); font-style:italic; font-size:0.8rem; text-align:center; padding:10px;">No specific activities logged.</div>';
        }

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
                        <div style="font-size:0.75rem; color:var(--primary); font-weight:bold; margin-top:2px;" title="Scheduled Task for Today"><i class="fas fa-bullseye"></i> Target: ${todaysTask}</div>
                        <div id="sum_total_${safeId}" style="font-size:0.8rem; color:var(--text-muted);"></div>
                        <div id="sum_vio_${safeId}"></div>
                    </div>
                    <div style="display:flex; gap:15px; text-align:right;">
                        <div>
                            <div id="sum_mat_score_${safeId}" class="focus-score-large" style="font-size:1.5rem;"></div>
                            <div style="font-size:0.7rem; font-weight:bold; color:var(--primary); text-transform:uppercase;">Material Focus</div>
                        </div>
                        <div style="opacity:0.6;">
                            <div id="sum_score_${safeId}" class="focus-score-large" style="font-size:1.1rem;"></div>
                            <div style="font-size:0.6rem; font-weight:bold; color:var(--text-muted); text-transform:uppercase;">Overall Productive</div>
                        </div>
                    </div>
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap:8px; text-align:center; font-size:0.85rem; margin-bottom:15px;">
                    <div style="background:rgba(52, 152, 219, 0.1); padding:8px; border-radius:6px; color:#3498db;">
                        <div id="sum_mat_${safeId}" style="font-weight:bold; font-size:1rem;"></div>
                        <div style="font-size:0.65rem; opacity:0.8;">Material</div>
                    </div>
                    <div style="background:rgba(46, 204, 113, 0.1); padding:8px; border-radius:6px; color:#2ecc71;">
                        <div id="sum_tool_${safeId}" style="font-weight:bold; font-size:1rem;"></div>
                        <div style="font-size:0.65rem; opacity:0.8;">Tools/Notes</div>
                    </div>
                    <div style="background:rgba(231, 76, 60, 0.1); padding:8px; border-radius:6px; color:#e74c3c;">
                        <div id="sum_ext_${safeId}" style="font-weight:bold; font-size:1rem;"></div>
                        <div style="font-size:0.65rem; opacity:0.8;">External</div>
                    </div>
                    <div style="background:var(--bg-input); padding:8px; border-radius:6px; color:var(--text-muted);">
                        <div id="sum_idle_${safeId}" style="font-weight:bold; font-size:1rem;"></div>
                        <div style="font-size:0.65rem; opacity:0.8;">Idle</div>
                    </div>
                </div>
                <div style="margin-bottom:15px;">
                    <div style="font-size:0.75rem; font-weight:bold; color:var(--text-muted); margin-bottom:5px; text-transform:uppercase;">Activity Breakdown</div>
                    <div id="sum_topics_${safeId}" class="topic-breakdown" style="max-height:160px; overflow-y:auto; border:1px solid var(--border-color); border-radius:4px; padding:5px; background:var(--bg-app);"></div>
                </div>
                <div id="sum_timeline_${safeId}" class="timeline-visual" onclick="StudyMonitor.expandTimeline('${agent.replace(/'/g, "\\'")}')" style="cursor:pointer;" title="Click to expand details"></div>
                <div style="display:flex; justify-content:space-between; font-size:0.65rem; color:var(--text-muted); margin-top:4px; font-family:monospace; opacity:0.7;">
                    <span>08:00</span>
                    <span>10:00</span>
                    <span>12:00</span>
                    <span>14:00</span>
                    <span>17:00</span>
                </div>`;
            grid.appendChild(card);
        }

        // Granular Updates (No Flicker)
        document.getElementById(`sum_total_${safeId}`).innerText = `Total Tracked: ${Math.round(totalMs/60000)} mins`;
        document.getElementById(`sum_vio_${safeId}`).innerHTML = vioTopics.length > 0 ? `<div style="background:#ff5252; color:white; font-size:0.7rem; font-weight:bold; padding:2px 8px; border-radius:12px; margin-top:5px; display:inline-block; animation: pulse 2s infinite;"><i class="fas fa-exclamation-triangle"></i> ${vioTopics.length} Violation(s) Detected</div>` : '';
        const matScoreEl = document.getElementById(`sum_mat_score_${safeId}`);
        if (matScoreEl) { matScoreEl.innerText = matText; matScoreEl.style.color = scoreColor; }
        
        const scoreEl = document.getElementById(`sum_score_${safeId}`);
        if (scoreEl) { scoreEl.innerText = scoreText; scoreEl.style.color = 'var(--text-muted)'; }
        
        const sumMat = document.getElementById(`sum_mat_${safeId}`);
        if (sumMat) sumMat.innerText = matTimeStr;
        const sumTool = document.getElementById(`sum_tool_${safeId}`);
        if (sumTool) sumTool.innerText = toolTimeStr;
        const sumExt = document.getElementById(`sum_ext_${safeId}`);
        if (sumExt) sumExt.innerText = extTimeStr;
        const sumIdle = document.getElementById(`sum_idle_${safeId}`);
        if (sumIdle) sumIdle.innerText = idleTimeStr;
        
        // UX SCROLL LOCK: Prevent DOM wipes from resetting scroll position while investigating
        const topicsDiv = document.getElementById(`sum_topics_${safeId}`);
        if (topicsDiv) {
            const scrollPos = topicsDiv.scrollTop;
            topicsDiv.innerHTML = breakdownHtml;
            topicsDiv.scrollTop = scrollPos;
        }
        
        const timelineDiv = document.getElementById(`sum_timeline_${safeId}`);
        if (timelineDiv) timelineDiv.innerHTML = timelineHtml;
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
    
    // 1. Strip "External: " or "Violation: " prefix if present
    suggestion = suggestion.replace(/^(External:\s*|Violation:\s*)/, '');
    
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

StudyMonitor.expandTimeline = function(agentName, targetDateStr = null) {
    const todayStr = this.getLocalDateString();
    const queryDate = targetDateStr || todayStr;

    let modal = document.getElementById('timelineDetailModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'timelineDetailModal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '9999'; // Ensure it appears above the Activity Monitor
        modal.innerHTML = `
            <div class="modal-box" style="width:95%; max-width:1200px; height:85vh; display:flex; flex-direction:column;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid var(--border-color); padding-bottom:10px; flex-wrap:wrap; gap:10px;">
                    <h3 style="margin:0; display:flex; align-items:center; gap:10px;">Activity Detail: <span id="tlDetailName" style="color:var(--primary);"></span>
                        <input type="date" id="tlDetailDate" style="padding:4px 8px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-input); color:var(--text-main); font-size:0.9rem;" title="Select a date to view archived history">
                    </h3>
                    <div style="display:flex; gap:10px;">
                        <button class="btn-primary" id="btn-ai-analyze"><i class="fas fa-robot"></i> AI Analyze</button>
                        <button class="btn-secondary" onclick="document.getElementById('timelineDetailModal').classList.add('hidden')"><i class="fas fa-times"></i> Close</button>
                    </div>
                </div>
                <div id="ai-analysis-result" class="hidden" style="margin-bottom: 20px; padding: 15px; background: var(--bg-input); border-left: 4px solid var(--primary); border-radius: 4px; font-size: 0.9rem; line-height: 1.5; max-height: 250px; overflow-y: auto;"></div>
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
    
    const datePicker = document.getElementById('tlDetailDate');
    datePicker.value = queryDate;
    datePicker.onchange = (e) => { StudyMonitor.expandTimeline(agentName, e.target.value); };

    const aiBtn = document.getElementById('btn-ai-analyze');
    if (aiBtn) aiBtn.onclick = () => StudyMonitor.analyzeWithAI(agentName, queryDate);
    
    const aiResult = document.getElementById('ai-analysis-result');
    if (aiResult) {
        aiResult.classList.add('hidden');
        aiResult.innerHTML = '';
    }

    const visualContainer = document.getElementById('tlDetailVisual');
    const tableContainer = document.getElementById('tlDetailTable');
    
    visualContainer.innerHTML = '';
    tableContainer.innerHTML = '';

    // --- RECALCULATE SEGMENTS ---
    let allSegments = [];
    
    if (queryDate === todayStr) {
        const data = JSON.parse(localStorage.getItem('monitor_data') || '{}');
        const activity = data[agentName];
        if (activity) {
            allSegments = [...(activity.history || [])];
            const currentDuration = Date.now() - activity.since;
            if (currentDuration > 1000) {
                allSegments.push({
                    activity: activity.current,
                    start: activity.since,
                    end: Date.now(),
                    duration: currentDuration
                });
            }
        }
    } else {
        const historyLog = JSON.parse(localStorage.getItem('monitor_history') || '[]');
        const pastDay = historyLog.find(h => h.user === agentName && h.date === queryDate);
        if (pastDay && pastDay.details) {
            allSegments = [...pastDay.details];
        }
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

         if (category === 'material') {
             typeClass = ''; style = 'background:#3498db;';
             catLabel = 'Material'; rowColor = 'color:#3498db; font-weight:bold;';
         } else if (category === 'tool') {
             typeClass = ''; style = 'background:#2ecc71;';
             catLabel = 'Tool/Note'; rowColor = 'color:#2ecc71;';
         } else if (category === 'external') {
             if (effectiveDuration > TOLERANCE) {
                 typeClass = ''; style = 'background:#e74c3c;';
                 catLabel = seg.activity.toLowerCase().includes('violation') ? 'Violation' : 'External';
                 rowColor = 'color:#e74c3c; font-weight:bold;';
             } else {
                 style = `background: repeating-linear-gradient(45deg, #2ecc71, #2ecc71 5px, #f1c40f 5px, #f1c40f 10px);`;
                 typeClass = ''; 
                 catLabel = seg.activity.toLowerCase().includes('violation') ? 'Violation (Tolerated)' : 'External (Tolerated)';
                 rowColor = 'color:#f39c12;';
             }
         } else {
             if (effectiveDuration > TOLERANCE) {
                 typeClass = ''; style = 'background:#95a5a6;';
                 catLabel = 'Idle';
             } else {
                 style = `background: repeating-linear-gradient(45deg, #2ecc71, #2ecc71 5px, #95a5a6 5px, #95a5a6 10px);`;
                 typeClass = '';
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
            visualHtml += `<div class="timeline-seg" style="width:${pct}%; ${p.style}" title="${p.activity} (${Math.round(p.duration/1000)}s)"></div>`;
            
            const timeStr = new Date(p.start).toLocaleTimeString();
            const mins = (p.duration / 60000).toFixed(1) + 'm';
            
            let displayActivity = p.activity;
            if (displayActivity.includes('sharepoint.com') || displayActivity.includes('microsoftonline.com')) {
                 if (displayActivity.includes('.mp4') || displayActivity.includes('stream.aspx')) displayActivity = 'Studying: Training Video (SharePoint)';
                 else displayActivity = 'Studying: Training Document (SharePoint)';
            }

            tableHtml += `
                <tr style="${p.rowColor}">
                    <td>${timeStr}</td>
                    <td>${mins}</td>
                    <td title="${p.activity.replace(/"/g, '&quot;')}">${displayActivity}</td>
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

// --- AI TIMELINE ANALYST ---
StudyMonitor.analyzeWithAI = async function(agentName, dateStr) {
    const resultDiv = document.getElementById('ai-analysis-result');
    const btn = document.getElementById('btn-ai-analyze');
    if (!resultDiv || !btn) return;

    const configStr = localStorage.getItem('system_config');
    const config = configStr ? JSON.parse(configStr) : {};
    if (!config.ai || !config.ai.enabled || !config.ai.apiKey) {
        alert("AI is not configured or enabled in System Settings. Please ask a Super Admin to configure the AI connection.");
        return;
    }

    // 1. Gather Data
    const todayStr = this.getLocalDateString();
    let allSegments = [];
    if (dateStr === todayStr) {
        const data = JSON.parse(localStorage.getItem('monitor_data') || '{}');
        const activity = data[agentName];
        if (activity) {
            allSegments = [...(activity.history || [])];
            const currentDuration = Date.now() - activity.since;
            if (currentDuration > 1000) {
                allSegments.push({ activity: activity.current, start: activity.since, end: Date.now(), duration: currentDuration });
            }
        }
    } else {
        const historyLog = JSON.parse(localStorage.getItem('monitor_history') || '[]');
        const pastDay = historyLog.find(h => h.user === agentName && h.date === dateStr);
        if (pastDay && pastDay.details) allSegments = [...pastDay.details];
    }

    if (allSegments.length === 0) {
        alert("No activity data to analyze for this date.");
        return;
    }

    // 2. Format Data for Prompt
    let promptData = `Activity Log for ${agentName} on ${dateStr}:\n`;
    allSegments.sort((a, b) => (a.start || 0) - (b.start || 0)).forEach(seg => {
        const time = new Date(seg.start || (seg.end - seg.duration)).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const mins = (seg.duration / 60000).toFixed(1);
        promptData += `- [${time}] ${seg.activity} (${mins} mins)\n`;
    });

    const promptText = `Analyze the following activity log for an employee named ${agentName}. Provide a concise, professional summary breakdown of their day, highlighting their main focus, any potential security/compliance violations, excessive idle times, and an overall productivity assessment. Be brief but insightful. Format with clear headings and bullet points.\n\n${promptData}`;

    // 3. UI Loading State
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';
    btn.disabled = true;
    resultDiv.classList.remove('hidden');
    resultDiv.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> AI is reviewing the timeline data...';

    // 4. Fetch from Gemini
    try {
        if (!window.electronAPI || !window.electronAPI.ipcRenderer) {
            throw new Error("Electron API bridge not available. Cannot make secure API call.");
        }

        // Dynamically build the endpoint using v1beta and the selected model to ensure maximum region compatibility
        const aiModel = config.ai.model || "gemini-2.5-flash";
        const actualEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${aiModel}:generateContent`;

        const result = await window.electronAPI.ipcRenderer.invoke('invoke-gemini-api', {
            endpoint: actualEndpoint,
            apiKey: config.ai.apiKey,
            promptText: promptText
        });

        if (result.error) {
            throw new Error(result.error);
        }

        const text = result.text || "No insights generated.";
        const formattedText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>');
        resultDiv.innerHTML = `<strong><i class="fas fa-robot" style="color:var(--primary);"></i> AI Insight:</strong><br><br>${formattedText}`;
    } catch (e) {
        console.error("AI Analysis Error:", e);
        // More descriptive error for the user
        resultDiv.innerHTML = `<span style="color:#ff5252;"><i class="fas fa-exclamation-triangle"></i> AI Analysis Failed: ${e.message}.<br><small>Please check your API Key in System Settings and your network connection.</small></span>`;
    } finally {
        btn.innerHTML = '<i class="fas fa-robot"></i> AI Analyze';
        btn.disabled = false;
    }
};

// Hook for dashboard.js to trigger updates if modal is open
StudyMonitor.updateWidget = function() {
    const modal = document.getElementById('activityMonitorModal');
    if (modal && !modal.classList.contains('hidden')) {
        // Only refresh if we are NOT in queue mode (to prevent losing selections)
        if (StudyMonitor.viewMode !== 'queue') {
            renderActivityMonitorContent();
        }
    }
};
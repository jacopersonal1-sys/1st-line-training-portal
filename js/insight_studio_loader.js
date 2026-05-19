/* ================= INSIGHT STUDIO LOADER ================= */
/* HOST LOADER: Launches the isolated Insight module */

const InsightStudioLoader = {
    _windowMessageBound: false,
    _webviewReady: false,
    _pendingRefresh: false,
    _refreshTimer: null,
    _snapshotSignatures: {},
    _sessionSnapshot: null,
    _renderTimer: null,

    renderLoadingScreen: function(container) {
        container.innerHTML = `
            <div class="insight-loader-shell" style="min-height:calc(100vh - 210px); display:grid; place-items:center; padding:24px;">
                <div class="card" style="width:min(620px, 100%); text-align:center; padding:34px; border-radius:10px; background:linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015)), var(--bg-card);">
                    <i class="fas fa-circle-notch fa-spin fa-2x" style="color:var(--primary);"></i>
                    <h3 style="margin:16px 0 6px 0;">Fetching and building records</h3>
                    <p style="color:var(--text-muted); margin:0;">Preparing the Insight workspace from the latest trainee, progress, attendance, and assessment data.</p>
                    <div style="height:8px; border-radius:999px; background:rgba(255,255,255,0.08); border:1px solid var(--border-color); overflow:hidden; margin-top:18px;">
                        <div style="width:42%; height:100%; border-radius:inherit; background:linear-gradient(90deg, var(--primary), #60a5fa); animation: insightLoaderPulse 1.4s ease-in-out infinite;"></div>
                    </div>
                    <style>
                        @keyframes insightLoaderPulse {
                            0% { transform: translateX(-110%); }
                            55% { transform: translateX(120%); }
                            100% { transform: translateX(120%); }
                        }
                    </style>
                </div>
            </div>
        `;
    },

    createValueSignature: function(value) {
        if (typeof value !== 'string') return 'missing';
        const length = value.length;
        const step = Math.max(1, Math.floor(length / 24));
        let checksum = 0;
        for (let i = 0; i < length; i += step) {
            checksum = ((checksum << 5) - checksum + value.charCodeAt(i)) | 0;
        }
        return `${length}:${checksum}:${value.slice(0, 32)}:${value.slice(-32)}`;
    },

    getLocalSnapshot: function(options = {}) {
        const changedOnly = !!options.changedOnly;
        if (!changedOnly && this._sessionSnapshot) {
            return this._sessionSnapshot;
        }
        const keys = [
            'users',
            'rosters',
            'records',
            'submissions',
            'savedReports',
            'insightReviews',
            'exemptions',
            'liveBookings',
            'attendance_records',
            'monitor_history',
            'violation_reports',
            'tl_agent_feedback',
            'content_studio_data',
            'content_studio_data_local',
            'assessments',
            'vettingTopics',
            'tests',
            'schedules',
            'retrain_archives',
            'insight_rule_config',
            'insight_progress_config',
            'insight_hr_evidence',
            'insight_subject_reviews'
        ];
        const snapshot = {};
        keys.forEach(key => {
            try {
                const value = localStorage.getItem(key);
                if (value === null) return;
                const signature = this.createValueSignature(value);
                if (changedOnly && this._snapshotSignatures[key] === signature) return;
                this._snapshotSignatures[key] = signature;
                snapshot[key] = value;
            } catch (error) {
                console.warn(`[Insight Loader] Could not read local key "${key}"`, error);
            }
        });
        if (!changedOnly) this._sessionSnapshot = snapshot;
        return snapshot;
    },

    syncHostDataToWebview: function(webview, options = {}) {
        if (!webview || !webview.isConnected || typeof webview.executeJavaScript !== 'function') {
            return Promise.resolve(false);
        }
        const snapshot = this.getLocalSnapshot({ changedOnly: !!options.changedOnly });
        if (!Object.keys(snapshot).length && !options.forceRender) {
            return Promise.resolve(true);
        }
        const script = `
            (() => {
                const snapshot = ${JSON.stringify(snapshot)};
                const shouldRender = ${options.forceRender ? 'true' : 'false'};
                Object.entries(snapshot).forEach(([key, value]) => {
                    if (typeof value === 'string') localStorage.setItem(key, value);
                });
                if (window.InsightDataService && typeof window.InsightDataService.hydrateFromLocalStorage === 'function') {
                    if (Object.keys(snapshot).length) {
                        window.InsightDataService.hydrateFromLocalStorage();
                    }
                    if (typeof window.InsightDataService.resetIndexes === 'function') {
                        window.InsightDataService.resetIndexes();
                    }
                }
                if (window.InsightApp && window.InsightApp.state) {
                    if (typeof window.InsightApp.resetCompareCache === 'function') {
                        window.InsightApp.resetCompareCache();
                    }
                    window.InsightApp.state.loading = false;
                    if (shouldRender && typeof window.InsightApp.render === 'function') window.InsightApp.render();
                }
                true;
            })();
        `;
        return webview.executeJavaScript(script, true).catch(error => {
            console.warn('[Insight Loader] Host data sync failed.', error);
            return false;
        });
    },

    launchGraduate: async function(payload) {
        const username = payload && payload.username ? String(payload.username).trim() : '';
        if (!username) return;
        if (typeof graduateTrainee === 'function') {
            await graduateTrainee(username);
            return;
        }
        if (typeof showToast === 'function') {
            showToast('Graduate action is unavailable in this runtime.', 'error');
        }
    },

    launchMigrate: function(payload) {
        const username = payload && payload.username ? String(payload.username).trim() : '';
        if (!username) return;
        if (typeof openMoveUserModal === 'function') {
            openMoveUserModal(username);
            return;
        }
        if (typeof showToast === 'function') {
            showToast('Migrate action is unavailable in this runtime.', 'error');
        }
    },

    bindWindowMessageBridge: function() {
        if (this._windowMessageBound) return;
        this._windowMessageBound = true;
        window.addEventListener('message', (event) => {
            const data = event && event.data ? event.data : null;
            if (!data || !data.type) return;
            if (data.type === 'insight-studio-graduate-agent') {
                this.launchGraduate(data.payload || null);
                return;
            }
            if (data.type === 'insight-studio-migrate-agent') {
                this.launchMigrate(data.payload || null);
            }
        });
    },

    renderUI: function() {
        const container = document.getElementById('insight-studio-content');
        if (!container) {
            console.error('[Insight Loader] Container not found.');
            return;
        }
        this._webviewReady = false;
        this._snapshotSignatures = {};
        this._sessionSnapshot = null;
        if (this._refreshTimer) {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = null;
        }
        if (this._renderTimer) {
            clearTimeout(this._renderTimer);
            this._renderTimer = null;
        }

        if (!CURRENT_USER) {
            container.innerHTML = `
                <div class="card" style="max-width:760px; margin:24px auto; text-align:center; border-color:#ff5252;">
                    <h3 style="color:#ff5252; margin-bottom:8px;">Session Required</h3>
                    <p style="color:var(--text-muted); margin:0;">Please sign in to open Insight.</p>
                </div>
            `;
            return;
        }

        const role = String(CURRENT_USER.role || '').trim().toLowerCase();
        if (!['admin', 'super_admin'].includes(role)) {
            container.innerHTML = `
                <div class="card" style="max-width:760px; margin:24px auto; text-align:center; border-color:#ff5252;">
                    <h3 style="color:#ff5252; margin-bottom:8px;">Access Denied</h3>
                    <p style="color:var(--text-muted); margin:0;">Insight is restricted to Admin and Super Admin sessions only.</p>
                </div>
            `;
            return;
        }

        const userStr = typeof CURRENT_USER !== 'undefined' ? JSON.stringify(CURRENT_USER) : '{}';
        const credsStr = (window.CLOUD_CREDENTIALS) ? JSON.stringify(window.CLOUD_CREDENTIALS) : '{}';
        const userParam = encodeURIComponent(userStr);
        const credsParam = encodeURIComponent(credsStr);

        const basePath = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
        const modulePath = basePath + '/modules/insight_studio/index.html';

        this.renderLoadingScreen(container);
        this._renderTimer = setTimeout(() => {
            this._renderTimer = null;
            this.attachWebview(container, modulePath, userParam, credsParam);
        }, 80);
    },

    attachWebview: function(container, modulePath, userParam, credsParam) {
        if (!container || !container.isConnected) return;
        container.innerHTML = `
            <div class="embedded-program-shell">
            <div class="embedded-program-header">
                <div>
                    <div class="embedded-program-title"><i class="fas fa-chart-line"></i> Insight</div>
                    <div class="embedded-program-subtitle">Analytics workspace running with the current portal theme.</div>
                </div>
                <div class="embedded-program-actions">
                    <button class="btn-secondary btn-sm" onclick="goWorkspaceHome()"><i class="fas fa-house"></i> Home</button>
                    <button class="btn-secondary btn-sm" onclick="InsightStudioLoader.refresh({ force: true })"><i class="fas fa-rotate-right"></i> Refresh</button>
                </div>
            </div>
            <webview
                id="insight-studio-webview"
                class="embedded-program-frame"
                src="${modulePath}?user=${userParam}&creds=${credsParam}&sessionCache=1"
                style="height:calc(100vh - 230px);"
                webpreferences="nodeIntegration=yes, contextIsolation=no"
                partition="persist:insight_studio"
                allowpopups
            ></webview>
            </div>
        `;

        const webview = document.getElementById('insight-studio-webview');
        if (webview) {
            webview.addEventListener('dom-ready', () => {
                this._webviewReady = true;
                if (typeof applyThemeToWebview === 'function') applyThemeToWebview(webview);
                this.syncHostDataToWebview(webview, { changedOnly: false, forceRender: true }).finally(() => {
                    if (!this._pendingRefresh) return;
                    this._pendingRefresh = false;
                    this.refresh();
                });
            });
            webview.addEventListener('ipc-message', (event) => {
                if (!event || !event.channel) return;
                const payload = Array.isArray(event.args) ? event.args[0] : null;
                if (event.channel === 'insight-studio-graduate-agent') {
                    this.launchGraduate(payload);
                    return;
                }
                if (event.channel === 'insight-studio-migrate-agent') {
                    this.launchMigrate(payload);
                }
            });
        }

        this.bindWindowMessageBridge();
    },

    clearSessionCache: function() {
        this._pendingRefresh = false;
        this._webviewReady = false;
        this._snapshotSignatures = {};
        this._sessionSnapshot = null;
        if (this._refreshTimer) {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = null;
        }
        if (this._renderTimer) {
            clearTimeout(this._renderTimer);
            this._renderTimer = null;
        }
        const webview = document.getElementById('insight-studio-webview');
        if (webview && webview.isConnected && typeof webview.executeJavaScript === 'function') {
            const keys = [
                'insight_module_cache_v1',
                'users',
                'rosters',
                'records',
                'submissions',
                'savedReports',
                'insightReviews',
                'exemptions',
                'liveBookings',
                'attendance_records',
                'monitor_history',
                'violation_reports',
                'tl_agent_feedback',
                'content_studio_data',
                'content_studio_data_local',
                'assessments',
                'vettingTopics',
                'tests',
                'schedules',
                'retrain_archives',
                'insight_rule_config',
                'insight_progress_config',
                'insight_subject_reviews'
            ];
            const script = `
                (() => {
                    ${JSON.stringify(keys)}.forEach((key) => localStorage.removeItem(key));
                    true;
                })();
            `;
            webview.executeJavaScript(script, true).catch(error => {
                console.warn('[Insight Loader] Session cache cleanup failed.', error);
            });
        }
    },

    refresh: function(options = {}) {
        if (!options.force) return;
        this.clearSessionCache();
        this.renderUI();
    },

    softRefresh: function() {
        const webview = document.getElementById('insight-studio-webview');
        if (webview && webview.isConnected && typeof webview.executeJavaScript === 'function') {
            if (!this._webviewReady) {
                this._pendingRefresh = true;
                return;
            }
            if (this._refreshTimer) clearTimeout(this._refreshTimer);
            this._refreshTimer = setTimeout(() => {
                this._refreshTimer = null;
                this.syncHostDataToWebview(webview, { changedOnly: true, forceRender: true });
            }, 350);
            return;
        }
        this.renderUI();
    }
};

window.InsightStudioLoader = InsightStudioLoader;

/* ================= INSIGHT STUDIO LOADER ================= */
/* HOST LOADER: Launches the isolated Insight module */

const InsightStudioLoader = {
    _windowMessageBound: false,

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

        container.innerHTML = `
            <webview
                id="insight-studio-webview"
                src="${modulePath}?user=${userParam}&creds=${credsParam}"
                style="width:100%; height:calc(100vh - 190px); border:none; background:transparent;"
                webpreferences="nodeIntegration=yes, contextIsolation=no"
                partition="persist:insight_studio"
                allowpopups
            ></webview>
        `;

        const webview = document.getElementById('insight-studio-webview');
        if (webview) {
            webview.addEventListener('dom-ready', () => {
                if (typeof applyThemeToWebview === 'function') applyThemeToWebview(webview);
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

    refresh: function() {
        const webview = document.getElementById('insight-studio-webview');
        if (webview && typeof webview.reload === 'function') {
            webview.reload();
            return;
        }
        this.renderUI();
    }
};

window.InsightStudioLoader = InsightStudioLoader;

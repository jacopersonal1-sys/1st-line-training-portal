/* ================= OPL HUB LOADER ================= */
/* HOST LOADER: Launches the isolated OPL Hub module */

const OPLHubLoader = {
    renderUI: function() {
        const container = document.getElementById('opl-hub-content');
        if (!container) {
            console.error("[OPL Hub Loader] Container not found.");
            return;
        }

        if (!CURRENT_USER || !['admin', 'super_admin'].includes(CURRENT_USER.role)) {
            container.innerHTML = `
                <div class="card" style="max-width:760px; margin:24px auto; text-align:center; border-color:#ff5252;">
                    <h3 style="color:#ff5252; margin-bottom:8px;">Access Denied</h3>
                    <p style="color:var(--text-muted); margin:0;">OPL Hub is restricted to Admin and Super Admin sessions only.</p>
                </div>
            `;
            return;
        }

        const userStr = typeof CURRENT_USER !== 'undefined' ? JSON.stringify(CURRENT_USER) : '{}';
        const credsStr = (window.CLOUD_CREDENTIALS) ? JSON.stringify(window.CLOUD_CREDENTIALS) : '{}';
        const userParam = encodeURIComponent(userStr);
        const credsParam = encodeURIComponent(credsStr);

        const basePath = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
        const modulePath = basePath + '/modules/opl_hub/index.html';

        container.innerHTML = `
            <div class="embedded-program-shell">
            <div class="embedded-program-header">
                <div>
                    <div class="embedded-program-title"><i class="fas fa-book-open"></i> OPL Hub</div>
                    <div class="embedded-program-subtitle">Operational learning resources in an isolated workspace.</div>
                </div>
                <div class="embedded-program-actions">
                    <button class="btn-secondary btn-sm" onclick="goWorkspaceHome()"><i class="fas fa-house"></i> Home</button>
                    <button class="btn-secondary btn-sm" onclick="OPLHubLoader.renderUI()"><i class="fas fa-rotate-right"></i> Refresh</button>
                </div>
            </div>
            <webview
                id="opl-hub-webview"
                class="embedded-program-frame"
                src="${modulePath}?user=${userParam}&creds=${credsParam}"
                style="height:calc(100vh - 230px);"
                webpreferences="nodeIntegration=yes, contextIsolation=no"
                partition="persist:opl_hub"
                allowpopups
            ></webview>
            </div>
        `;
        const webview = document.getElementById('opl-hub-webview');
        if (webview) {
            webview.addEventListener('dom-ready', () => {
                if (typeof applyThemeToWebview === 'function') applyThemeToWebview(webview);
            });
        }
    }
};

window.OPLHubLoader = OPLHubLoader;

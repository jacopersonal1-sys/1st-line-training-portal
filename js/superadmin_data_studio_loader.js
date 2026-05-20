/* ================= SUPER ADMIN DATA STUDIO LOADER ================= */

const SuperAdminDataStudioLoader = {
    renderUI: function() {
        const container = document.getElementById('superadmin-studio-content');
        if (!container) {
            console.error("[Data Studio Loader] Container not found.");
            return;
        }

        if (!CURRENT_USER || CURRENT_USER.role !== 'super_admin') {
            container.innerHTML = `
                <div class="card" style="max-width:700px; margin:30px auto; text-align:center; border-color:#ff5252;">
                    <h3 style="color:#ff5252;">Access Denied</h3>
                    <p style="color:var(--text-muted);">This studio is restricted to super admin sessions.</p>
                </div>
            `;
            return;
        }

        if (document.getElementById('superadmin-data-studio-webview')) return;

        const userStr = typeof CURRENT_USER !== 'undefined' ? JSON.stringify(CURRENT_USER) : '{}';
        const credsStr = window.CLOUD_CREDENTIALS ? JSON.stringify(window.CLOUD_CREDENTIALS) : '{}';
        const userParam = encodeURIComponent(userStr);
        const credsParam = encodeURIComponent(credsStr);
        const basePath = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
        const modulePath = basePath + '/modules/superadmin_data_studio/index.html';

        container.innerHTML = `
            <div class="embedded-program-shell">
            <div class="embedded-program-header">
                <div>
                    <div class="embedded-program-title"><i class="fas fa-satellite-dish"></i> Live Supabase Studio</div>
                    <div class="embedded-program-subtitle">Direct data studio hosted as an isolated admin program.</div>
                </div>
                <div class="embedded-program-actions">
                    <button class="btn-secondary btn-sm" onclick="document.getElementById('superadmin-data-studio-webview').openDevTools()"><i class="fas fa-bug"></i> Inspect Studio</button>
                </div>
            </div>
            <div class="embedded-program-frame-wrap">
                <div id="superadmin-data-studio-loading" class="embedded-program-loading">
                    ${typeof window.getAppLoadingHtml === 'function'
                        ? window.getAppLoadingHtml({
                            icon: 'fa-database',
                            title: 'Opening Data Studio',
                            detail: 'Preparing the isolated Supabase workspace.',
                            phase: 'Connecting to the embedded program'
                        })
                        : '<div class="table-state loading"><i class="fas fa-circle-notch fa-spin"></i><span>Opening Data Studio...</span></div>'}
                </div>
                <webview
                    id="superadmin-data-studio-webview"
                    class="embedded-program-frame"
                    src="${modulePath}?user=${userParam}&creds=${credsParam}"
                    style="height:calc(100vh - 230px);"
                    webpreferences="nodeIntegration=yes, contextIsolation=no"
                    partition="persist:superadmin_data_studio"
                    allowpopups
                ></webview>
            </div>
            </div>
        `;
        const webview = document.getElementById('superadmin-data-studio-webview');
        if (webview) {
            const hideLoading = () => {
                const loader = document.getElementById('superadmin-data-studio-loading');
                if (loader) loader.classList.add('hidden');
            };
            webview.addEventListener('dom-ready', () => {
                if (typeof applyThemeToWebview === 'function') applyThemeToWebview(webview);
                hideLoading();
            });
            webview.addEventListener('did-finish-load', hideLoading);
        }
    }
};

window.SuperAdminDataStudioLoader = SuperAdminDataStudioLoader;

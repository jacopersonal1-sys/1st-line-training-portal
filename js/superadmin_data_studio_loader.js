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
            <div style="background:var(--bg-input); padding:10px; border-radius:8px; margin-bottom:15px; display:flex; justify-content:space-between; align-items:center; border:1px solid var(--primary);">
                <div style="color:var(--primary); font-weight:bold;"><i class="fas fa-satellite-dish"></i> Live Supabase Studio</div>
                <button class="btn-secondary btn-sm" onclick="document.getElementById('superadmin-data-studio-webview').openDevTools()"><i class="fas fa-bug"></i> Inspect Studio</button>
            </div>
            <webview
                id="superadmin-data-studio-webview"
                src="${modulePath}?user=${userParam}&creds=${credsParam}"
                style="width:100%; height:calc(100vh - 210px); border:none; background:var(--bg-card); box-shadow:0 0 15px rgba(0,0,0,0.45); border-radius:12px;"
                webpreferences="nodeIntegration=yes, contextIsolation=no"
                partition="persist:superadmin_data_studio"
                allowpopups
            ></webview>
        `;
    }
};

window.SuperAdminDataStudioLoader = SuperAdminDataStudioLoader;

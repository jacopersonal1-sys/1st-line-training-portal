/* ================= TEAMLEADER HUB & TASKS ================= */
/* HOST LOADER: Launches the isolated Team Projects Module */

const TLTasks = {
    renderUI: function() {
        const container = document.getElementById('tl-hub-content');
        if (!container) {
            console.error("TL Hub container not found!");
            return;
        }

        // Pack Context for the isolated module
        // We assume CURRENT_USER and CLOUD_CREDENTIALS exist in the main window scope
        const userStr = typeof CURRENT_USER !== 'undefined' ? JSON.stringify(CURRENT_USER) : '{}';
        const credsStr = (window.CLOUD_CREDENTIALS) ? JSON.stringify(window.CLOUD_CREDENTIALS) : '{}';
        
        // Encode to pass via URL safely
        const userParam = encodeURIComponent(userStr);
        const credsParam = encodeURIComponent(credsStr);

        // Load the isolated module
        container.innerHTML = `
            <div class="embedded-program-shell">
            <div class="embedded-program-header">
                <div>
                    <div class="embedded-program-title"><i class="fas fa-users-cog"></i> Teamleader Hub</div>
                    <div class="embedded-program-subtitle">Team project tools running in their own workspace.</div>
                </div>
                <div class="embedded-program-actions">
                    <button class="btn-secondary btn-sm" onclick="goWorkspaceHome()"><i class="fas fa-house"></i> Home</button>
                    <button class="btn-secondary btn-sm" onclick="TLTasks.renderUI()"><i class="fas fa-rotate-right"></i> Refresh</button>
                </div>
            </div>
            <webview 
                id="tl-hub-webview" 
                class="embedded-program-frame"
                src="modules/team_projects/index.html?user=${userParam}&creds=${credsParam}" 
                style="height:calc(100vh - 230px);"
                webpreferences="nodeIntegration=yes, contextIsolation=no"
                allowpopups
            ></webview>
            </div>
        `;
        const webview = document.getElementById('tl-hub-webview');
        if (webview) {
            webview.addEventListener('dom-ready', () => {
                if (typeof applyThemeToWebview === 'function') applyThemeToWebview(webview);
            });
        }
    }
};
window.TLTasks = TLTasks;

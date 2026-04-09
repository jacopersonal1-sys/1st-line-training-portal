/* ================= VETTING REWORK SANDBOX LOADER ================= */
/* HOST LOADER: Launches the isolated Vetting 2.0 Module */

const VettingReworkLoader = {
    renderUI: function(targetContainerId = 'vetting-rework-content', options = {}) {
        console.log("[Sandbox Loader] Activating Vetting Rework UI...");
        const container = document.getElementById(targetContainerId);
        if (!container) {
            console.error(`[Sandbox Loader] Error: '${targetContainerId}' div not found in index.html`);
            return;
        }

        const mode = options.mode || 'sandbox';
        const title = options.title || (mode === 'production' ? 'Vetting Arena 2.0 Active' : 'Sandbox Container Active');
        const badgeIcon = mode === 'production' ? 'fa-shield-alt' : 'fa-hammer';
        const partitionName = mode === 'production' ? 'persist:vetting_runtime_v2' : 'persist:vetting_sandbox';

        // Avoid re-rendering if already exists, but allow refresh
        const existing = container.querySelector('.vetting-rework-webview');
        if (existing && options.force !== true) {
            console.log("[Sandbox Loader] Sandbox already active. Skipping re-render.");
            return; 
        }

        const userStr = typeof CURRENT_USER !== 'undefined' ? JSON.stringify(CURRENT_USER) : '{}';
        const credsStr = (window.CLOUD_CREDENTIALS) ? JSON.stringify(window.CLOUD_CREDENTIALS) : '{}';
        
        const userParam = encodeURIComponent(userStr);
        const credsParam = encodeURIComponent(credsStr);

        // Derive the absolute path based on the current window location safely
        const basePath = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
        const modulePath = basePath + '/modules/vetting_rework/index.html';

        console.log("[Sandbox Loader] Injecting Webview mapped to:", modulePath);

        container.innerHTML = `
            <div style="background:var(--bg-input); padding:10px; border-radius:8px; margin-bottom:15px; display:flex; justify-content:space-between; align-items:center; border:1px solid var(--primary);">
                <div style="color:var(--primary); font-weight:bold;"><i class="fas ${badgeIcon}"></i> ${title}</div>
                <button class="btn-secondary btn-sm" onclick="this.closest('section, div').querySelector('.vetting-rework-webview')?.openDevTools()"><i class="fas fa-bug"></i> Inspect Runtime</button>
            </div>
            <webview 
                class="vetting-rework-webview"
                src="${modulePath}?user=${userParam}&creds=${credsParam}&mode=${encodeURIComponent(mode)}" 
                style="width:100%; height:calc(100vh - 200px); border:none; background:var(--bg-card); box-shadow:0 0 15px rgba(0,0,0,0.5);"
                webpreferences="nodeIntegration=yes, contextIsolation=no"
                partition="${partitionName}"
                allowpopups></webview>`;
    }
};
window.VettingReworkLoader = VettingReworkLoader;

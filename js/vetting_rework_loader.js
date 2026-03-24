/* ================= VETTING REWORK SANDBOX LOADER ================= */
/* HOST LOADER: Launches the isolated Vetting 2.0 Module */

const VettingReworkLoader = {
    renderUI: function() {
        console.log("[Sandbox Loader] Activating Vetting Rework UI...");
        const container = document.getElementById('vetting-rework-content');
        if (!container) {
            console.error("[Sandbox Loader] Error: 'vetting-rework-content' div not found in index.html");
            return;
        }

        // Avoid re-rendering if already exists, but allow refresh
        if (document.getElementById('vetting-rework-webview')) {
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
                <div style="color:var(--primary); font-weight:bold;"><i class="fas fa-hammer"></i> Sandbox Container Active</div>
                <button class="btn-secondary btn-sm" onclick="document.getElementById('vetting-rework-webview').openDevTools()"><i class="fas fa-bug"></i> Inspect Sandbox</button>
            </div>
            <webview 
                id="vetting-rework-webview" 
                src="${modulePath}?user=${userParam}&creds=${credsParam}" 
                style="width:100%; height:calc(100vh - 200px); border:none; background:var(--bg-card); box-shadow:0 0 15px rgba(0,0,0,0.5);"
                webpreferences="nodeIntegration=yes, contextIsolation=no"
                partition="persist:vetting_sandbox"
                allowpopups></webview>`;
    }
};
window.VettingReworkLoader = VettingReworkLoader;
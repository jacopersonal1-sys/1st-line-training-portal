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
            <webview 
                id="tl-hub-webview" 
                src="modules/team_projects/index.html?user=${userParam}&creds=${credsParam}" 
                style="width:100%; height:calc(100vh - 150px); border:none; background:transparent;"
                webpreferences="nodeIntegration=yes, contextIsolation=no"
                allowpopups
            ></webview>
        `;
    }
};
window.TLTasks = TLTasks;
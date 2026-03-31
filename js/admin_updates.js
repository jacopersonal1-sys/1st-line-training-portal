/* ================= ADMIN: SYSTEM UPDATES ================= */

let ADMIN_UPDATE_LISTENERS_BOUND = false;

function getAdminUpdateIpc() {
    return window.electronAPI && window.electronAPI.ipcRenderer ? window.electronAPI.ipcRenderer : null;
}

function bindAdminUpdateListeners() {
    const ipcRenderer = getAdminUpdateIpc();
    if (!ipcRenderer || ADMIN_UPDATE_LISTENERS_BOUND) return;

    ADMIN_UPDATE_LISTENERS_BOUND = true;

    ipcRenderer.on('update-message', (event, message) => {
        if (!message || !message.text) return;

        // Filter out progress messages from log to avoid spam, handle them separately
        if (message.text.includes('Downloading')) {
            const match = message.text.match(/(\d+)%/);
            const progressContainer = document.getElementById('updateProgressContainer');
            const progressBar = document.getElementById('updateProgressBar');
            const progressText = document.getElementById('updateProgressText');
            const statusText = document.getElementById('updateStatusText');

            if (match && progressContainer && progressBar && progressText && statusText) {
                const percent = match[1];
                progressContainer.classList.remove('hidden');
                progressBar.style.width = percent + '%';
                progressText.innerText = percent + '%';
                statusText.innerText = "Downloading Update...";
            }
        } else {
            let msg = message.text;
            if (msg.includes("No published versions")) {
                msg = "⚠️ No published releases found.\n(Drafts are invisible. Go to GitHub > Releases and click 'Publish'.)";
            }
            appendUpdateLog(msg, message.type);
        }
    });

    ipcRenderer.on('update-downloaded', () => {
        appendUpdateLog("Update downloaded successfully.", 'success');

        const statusText = document.getElementById('updateStatusText');
        const installBtn = document.getElementById('btnInstallUpdate');
        const checkBtn = document.getElementById('btnCheckUpdates');

        if (statusText) statusText.innerText = "Download Complete";
        if (installBtn) installBtn.classList.remove('hidden');
        if (checkBtn) checkBtn.classList.add('hidden');
    });
}

function loadAdminUpdates() {
    bindAdminUpdateListeners();

    // 1. Get Current Version
    const ipcRenderer = getAdminUpdateIpc();
    if (ipcRenderer) {
        ipcRenderer.invoke('get-app-version').then(ver => {
            const el = document.getElementById('currentVersionDisplay');
            if(el) el.innerText = ver;
        });
    }

    // 2. Reset UI
    const log = document.getElementById('updateLog');
    if(log && log.innerHTML === '') {
        appendUpdateLog("Update Center initialized.", 'info');
        appendUpdateLog("Click 'Check for Updates' to begin.", 'info');
    }
}

function triggerManualUpdate() {
    const ipcRenderer = getAdminUpdateIpc();
    if (!ipcRenderer) {
        appendUpdateLog("Electron update bridge is unavailable.", 'error');
        return;
    }

    appendUpdateLog("Checking for updates...", 'info');
    
    // Reset Progress
    document.getElementById('updateProgressContainer')?.classList.add('hidden');
    document.getElementById('btnInstallUpdate')?.classList.add('hidden');
    
    ipcRenderer.send('manual-update-check');
}

function appendUpdateLog(msg, type='info') {
    const log = document.getElementById('updateLog');
    if(!log) return;
    
    const color = type === 'error' ? '#ff5252' : (type === 'success' ? '#2ecc71' : 'var(--text-muted)');
    const time = new Date().toLocaleTimeString();
    
    log.innerHTML += `<div style="color:${color}; margin-bottom:5px; font-family:monospace; font-size:0.85rem;">[${time}] ${msg}</div>`;
    log.scrollTop = log.scrollHeight;
}

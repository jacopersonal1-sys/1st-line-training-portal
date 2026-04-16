/* ================= ADMIN: SYSTEM UPDATES ================= */

let ADMIN_UPDATE_LISTENERS_BOUND = false;
let ADMIN_UPDATE_CHANNEL = 'main';

function getAdminUpdateIpc() {
    return window.electronAPI && window.electronAPI.ipcRenderer ? window.electronAPI.ipcRenderer : null;
}

function normalizeUpdateChannel(value) {
    const raw = String(value || '').trim().toLowerCase();
    return (raw === 'beta' || raw === 'staging' || raw === 'prerelease' || raw === 'pre-release') ? 'beta' : 'main';
}

function renderUpdateChannelState() {
    const badge = document.getElementById('updateChannelDisplay');
    if (!badge) return;

    const isBeta = ADMIN_UPDATE_CHANNEL === 'beta';
    badge.innerText = isBeta ? 'Active Channel: Beta (Pre-release)' : 'Active Channel: Main (Inline)';
    badge.style.color = isBeta ? '#f1c40f' : 'var(--primary)';
}

async function syncUpdateChannelState() {
    const ipcRenderer = getAdminUpdateIpc();
    if (!ipcRenderer) return;
    try {
        const channel = await ipcRenderer.invoke('get-update-channel');
        ADMIN_UPDATE_CHANNEL = normalizeUpdateChannel(channel);
    } catch (e) {
        ADMIN_UPDATE_CHANNEL = 'main';
    }
    renderUpdateChannelState();
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

    ipcRenderer.on('update-channel-changed', (event, payload) => {
        ADMIN_UPDATE_CHANNEL = normalizeUpdateChannel(payload && payload.channel);
        renderUpdateChannelState();
    });

    ipcRenderer.on('update-downloaded', () => {
        appendUpdateLog("Update downloaded successfully.", 'success');

        const statusText = document.getElementById('updateStatusText');
        const installBtn = document.getElementById('btnInstallUpdate');
        const checkMainBtn = document.getElementById('btnCheckMainUpdates');
        const checkBetaBtn = document.getElementById('btnCheckBetaUpdates');

        if (statusText) statusText.innerText = "Download Complete";
        if (installBtn) installBtn.classList.remove('hidden');
        if (checkMainBtn) checkMainBtn.classList.add('hidden');
        if (checkBetaBtn) checkBetaBtn.classList.add('hidden');
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
    syncUpdateChannelState();

    // 2. Reset UI
    const log = document.getElementById('updateLog');
    if(log && log.innerHTML === '') {
        appendUpdateLog("Update Center initialized.", 'info');
        appendUpdateLog("Use Main for normal rollout and Beta for optional pre-release checks.", 'info');
    }
}

function triggerManualUpdate(channel = 'main') {
    const ipcRenderer = getAdminUpdateIpc();
    if (!ipcRenderer) {
        appendUpdateLog("Electron update bridge is unavailable.", 'error');
        return;
    }

    ADMIN_UPDATE_CHANNEL = normalizeUpdateChannel(channel);
    renderUpdateChannelState();
    appendUpdateLog(`Checking ${ADMIN_UPDATE_CHANNEL} updates...`, 'info');
    
    // Reset Progress
    document.getElementById('updateProgressContainer')?.classList.add('hidden');
    document.getElementById('btnInstallUpdate')?.classList.add('hidden');
    
    ipcRenderer.send('manual-update-check', { channel: ADMIN_UPDATE_CHANNEL });
}

function appendUpdateLog(msg, type='info') {
    const log = document.getElementById('updateLog');
    if(!log) return;
    
    const color = type === 'error' ? '#ff5252' : (type === 'success' ? '#2ecc71' : 'var(--text-muted)');
    const time = new Date().toLocaleTimeString();
    
    log.innerHTML += `<div style="color:${color}; margin-bottom:5px; font-family:monospace; font-size:0.85rem;">[${time}] ${msg}</div>`;
    log.scrollTop = log.scrollHeight;
}

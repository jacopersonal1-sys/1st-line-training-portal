/* ================= ADMIN: SYSTEM UPDATES ================= */

function loadAdminUpdates() {
    // 1. Get Current Version
    if (typeof require !== 'undefined') {
        const { ipcRenderer } = require('electron');
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
    const { ipcRenderer } = require('electron');
    appendUpdateLog("Checking for updates...", 'info');
    
    // Reset Progress
    document.getElementById('updateProgressContainer').classList.add('hidden');
    document.getElementById('btnInstallUpdate').classList.add('hidden');
    
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

// --- LISTENERS ---
if (typeof require !== 'undefined') {
    const { ipcRenderer } = require('electron');

    // Listen for messages from Main Process
    ipcRenderer.on('update-message', (event, message) => {
        // Filter out progress messages from log to avoid spam, handle them separately
        if (message.text.includes('Downloading')) {
            const match = message.text.match(/(\d+)%/);
            if (match) {
                const percent = match[1];
                document.getElementById('updateProgressContainer').classList.remove('hidden');
                document.getElementById('updateProgressBar').style.width = percent + '%';
                document.getElementById('updateProgressText').innerText = percent + '%';
                document.getElementById('updateStatusText').innerText = "Downloading Update...";
            }
        } else {
            appendUpdateLog(message.text, message.type);
        }
    });

    ipcRenderer.on('update-downloaded', () => {
        appendUpdateLog("Update downloaded successfully.", 'success');
        document.getElementById('updateStatusText').innerText = "Download Complete";
        document.getElementById('btnInstallUpdate').classList.remove('hidden');
        
        // Hide Check Button to prevent double click
        document.getElementById('btnCheckUpdates').classList.add('hidden');
    });
}

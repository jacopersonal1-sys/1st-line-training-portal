/* ================= UTILITIES & HELPERS ================= */

// --- NEW: Formatters for System Status ---
function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function formatDuration(ms) {
    if (ms < 1000) return "Just now";
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return minutes > 0 
        ? `${minutes}m ${seconds}s` 
        : `${seconds}s`;
}

// --- UI: AVATAR GENERATOR ---
function getAvatarHTML(name, size = 32) {
    if(!name) return '';
    const initials = name.substring(0, 2).toUpperCase();
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    const color = "#" + "00000".substring(0, 6 - c.length) + c;
    
    // --- NEW: Ring Color for Current User ---
    let boxShadow = '0 2px 4px rgba(0,0,0,0.1)'; // Default shadow

    if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && name === CURRENT_USER.user) {
        const localTheme = JSON.parse(localStorage.getItem('local_theme_config') || '{}');
        if (localTheme && localTheme.showRing && localTheme.profileRingColor) {
            boxShadow = `0 0 0 3px ${localTheme.profileRingColor}`;
        }
    }

    return `<div style="width:${size}px; height:${size}px; border-radius:50%; background:${color}; color:#fff; display:inline-flex; align-items:center; justify-content:center; font-size:${size*0.4}px; font-weight:bold; margin-right:10px; flex-shrink:0; box-shadow:${boxShadow}; vertical-align:middle;">${initials}</div>`;
}

// --- UI: SKELETON LOADER GENERATOR ---
function getSkeletonRows(cols = 4, rows = 3) {
    let html = '';
    for(let i=0; i<rows; i++) {
        html += `<tr class="skeleton-row">`;
        for(let j=0; j<cols; j++) html += `<td></td>`;
        html += `</tr>`;
    }
    return html;
}

// --- SECURITY: HASHING HELPER ---
/**
 * Hashes a plaintext password using SHA-256.
 * Returns the hex string of the hash.
 * Used by auth.js and admin_users.js.
 */
async function hashPassword(plainText) {
    if (!plainText) return "";
    const msgBuffer = new TextEncoder().encode(plainText);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- SECURITY: HTML SANITIZER ---
window.escapeHTML = function(str) {
    if (!str) return "";
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag]));
};

// --- UI: CUSTOM PROMPT (Electron Compatible) ---
window.customPrompt = function(title, message, defaultValue = "") {
    return new Promise((resolve) => {
        const modal = document.getElementById('genericInputModal');
        if (!modal) {
            console.error("Generic Input Modal not found in DOM");
            alert("Error: Input modal missing. Cannot prompt for input.");
            resolve(null);
            return;
        }

        const titleEl = document.getElementById('genericInputTitle');
        const msgEl = document.getElementById('genericInputMessage');
        const inputEl = document.getElementById('genericInputValue');
        const confirmBtn = document.getElementById('btnGenericInputConfirm');
        const cancelBtn = document.getElementById('btnGenericInputCancel');

        titleEl.innerText = title;
        msgEl.innerText = message;
        inputEl.value = defaultValue;

        const cleanup = () => {
            modal.classList.add('hidden');
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
            inputEl.onkeydown = null;
        };

        const confirmAction = () => {
            const val = inputEl.value;
            cleanup();
            resolve(val);
        };

        const cancelAction = () => {
            cleanup();
            resolve(null);
        };

        confirmBtn.onclick = confirmAction;
        cancelBtn.onclick = cancelAction;
        
        inputEl.onkeydown = (e) => {
            if(e.key === 'Enter') confirmAction();
            if(e.key === 'Escape') cancelAction();
        };

        modal.classList.remove('hidden');
        setTimeout(() => inputEl.focus(), 50);
    });
};

// --- EXISTING UTILITIES ---

function getGroupLabel(groupId, count) {
    if(!groupId) return "Unknown";
    
    // FETCH NAMES: Get the roster to display member names
    // Note: We access localStorage directly because data.js keeps it synced
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    const members = rosters[groupId] || [];
    
    // LOGIC: Create a comma-separated string of names (truncated for safety)
    let namesDisplay = "";
    if (members.length > 0) {
        // Show first 3 names, then "+ X more" to prevent huge dropdowns
        const preview = members.slice(0, 3).join(", ");
        const remaining = members.length - 3;
        const suffix = remaining > 0 ? `, +${remaining} others` : '';
        namesDisplay = ` [${preview}${suffix}]`;
    }

    // Check if it's a date-based ID (YYYY-MM or YYYY-MM-X)
    if(groupId.match(/^\d{4}-\d{2}$/) || groupId.match(/^\d{4}-\d{2}-[A-Z]$/)) {
        const parts = groupId.split('-');
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]);
        const suffix = parts[2] ? ` (Group ${parts[2]})` : '';
        
        const date = new Date(year, month - 1);
        const monthName = date.toLocaleString('default', { month: 'long' });
        
        // Return Month + Year + Suffix + Names
        return `${monthName} ${year}${suffix}${namesDisplay}`;
    }
    
    // Fallback for non-standard IDs
    return `${groupId}${namesDisplay}`;
}

function toggleTheme() {
    const isDark = document.body.classList.toggle('light-mode'); 
    localStorage.setItem('theme', document.body.classList.contains('light-mode') ? 'light' : 'dark');
}

function loadAdminTheme() {
    const theme = localStorage.getItem('theme') || 'dark';
    if (theme === 'light') {
        document.body.classList.add('light-mode');
    } else {
        document.body.classList.remove('light-mode');
    }
}

function refreshApp() {
    location.reload();
}

/* ================= MIGRATION TOOLS ================= */

// UPDATED: Async Migration Save
async function migrateData() {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    let changed = false;
    
    users.forEach(u => {
        if(!u.role) { u.role = 'trainee'; changed = true; }
        // Ensure theme object exists
        if(!u.theme) { u.theme = { primaryColor: '', wallpaper: '' }; changed = true; }
    });
    
    if(changed) {
        localStorage.setItem('users', JSON.stringify(users));
        console.log("Data Migration Applied. Syncing changes to server...");
        
        // --- SECURE SAVE ---
        // Ensure the fixes are written to the server immediately (Force Sync)
        if (typeof saveToServer === 'function') {
            try {
                // UPDATED: Use force=true for instant migration persistence
                await saveToServer(true);
                console.log("Migration synced successfully.");
            } catch(e) {
                console.error("Migration Sync Failed:", e);
            }
        }
    }
}

/* ================= DYNAMIC CYCLE LOGIC ================= */
function getTraineeCycle(traineeName, currentGroupId) {
    if(!traineeName || !currentGroupId) return "New Onboard";

    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    const allGroups = Object.keys(rosters).sort(); 
    
    let previousCount = 0;
    
    for (const gid of allGroups) {
        if (gid === currentGroupId) break; 
        
        if (rosters[gid].includes(traineeName)) {
            previousCount++;
        }
    }

    if (previousCount === 0) return "New Onboard";
    if (previousCount === 1) return "Retrain 1";
    if (previousCount === 2) return "Retrain 2";
    return "Retrain " + previousCount;
}

// --- CONFETTI FX ---
window.triggerConfetti = function() {
    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '9999';
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    let w = canvas.width = window.innerWidth;
    let h = canvas.height = window.innerHeight;
    
    const particles = [];
    const colors = ['#f1c40f', '#e74c3c', '#3498db', '#2ecc71', '#9b59b6'];
    
    for(let i=0; i<200; i++) {
        particles.push({
            x: Math.random() * w,
            y: Math.random() * h - h, // Start above screen
            vx: Math.random() * 4 - 2,
            vy: Math.random() * 5 + 2,
            color: colors[Math.floor(Math.random() * colors.length)],
            size: Math.random() * 10 + 5,
            rot: Math.random() * 360,
            rotSpeed: Math.random() * 10 - 5
        });
    }

    function animate() {
        if(!document.body.contains(canvas)) return;
        ctx.clearRect(0, 0, w, h);
        let active = false;
        
        particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.rot += p.rotSpeed;
            
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot * Math.PI / 180);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
            ctx.restore();
            
            if(p.y < h) active = true;
        });
        
        if(active) requestAnimationFrame(animate);
        else canvas.remove();
    }
    
    animate();
    
    // Safety cleanup
    setTimeout(() => { if(document.body.contains(canvas)) canvas.remove(); }, 8000);
};

/* ================= AI INTEGRATION HELPERS ================= */

async function generateAIResponse(systemPrompt, userPrompt) {
    const config = JSON.parse(localStorage.getItem('system_config') || '{}');
    
    if (!config.ai || !config.ai.enabled) {
        console.warn("AI is disabled in System Config.");
        return null;
    }

    try {
        // Works for OpenAI and Local Ollama (if endpoint is http://localhost:11434/v1/chat/completions)
        const response = await fetch(config.ai.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.ai.apiKey || 'dummy-key'}` // Ollama ignores key
            },
            body: JSON.stringify({
                model: config.ai.model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                temperature: 0.7
            })
        });

        const data = await response.json();
        return data.choices[0].message.content;
    } catch (e) {
        console.error("AI Request Failed:", e);
        if(typeof showToast === 'function') showToast("AI Request Failed. Check Console.", "error");
        return null;
    }
}

// --- PROFILE SETTINGS MODAL (Global) ---
window.openUnifiedProfileSettings = function() {
    const localTheme = JSON.parse(localStorage.getItem('local_theme_config') || '{}');
    
    const modalHtml = `
        <div id="profileSettingsModal" class="modal-overlay" style="z-index:10005;">
            <div class="modal-box" style="width:500px; max-width:95%;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; border-bottom:1px solid var(--border-color); padding-bottom:10px;">
                    <h3 style="margin:0;"><i class="fas fa-user-circle"></i> Profile & Settings</h3>
                    <button class="btn-secondary" onclick="document.getElementById('profileSettingsModal').remove()">&times;</button>
                </div>
                
                <div class="card" style="margin-bottom:15px;">
                    <h4 style="margin-top:0;"><i class="fas fa-palette"></i> Personalization</h4>
                    <div class="grid-2" style="margin-bottom:10px;">
                        <div>
                            <label style="font-size:0.8rem;">Accent Color</label>
                            <input type="color" id="profThemeColor" value="${localTheme.primaryColor || '#F37021'}" style="width:100%; height:35px; cursor:pointer; border:none; padding:0; background:none;">
                        </div>
                        <div>
                            <label style="font-size:0.8rem; display:flex; align-items:center; gap:5px;"><input type="checkbox" id="profShowRing" ${localTheme.showRing ? 'checked' : ''}> Avatar Ring</label>
                            <input type="color" id="profRingColor" value="${localTheme.profileRingColor || localTheme.primaryColor || '#F37021'}" style="width:100%; height:35px; cursor:pointer; border:none; padding:0; background:none;">
                        </div>
                    </div>
                    <label style="font-size:0.8rem;">Wallpaper URL</label>
                    <input type="text" id="profWallpaper" value="${localTheme.wallpaper || ''}" placeholder="https://..." style="margin-bottom:10px;">
                    
                    <label style="font-size:0.8rem;">UI Zoom: <span id="profZoomDisplay" style="color:var(--primary); font-weight:bold;">${Math.round((localTheme.zoomLevel || 1)*100)}%</span></label>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <button class="btn-secondary btn-sm" onclick="adjustProfileZoom(-0.1)"><i class="fas fa-minus"></i></button>
                        <input type="range" id="profZoom" min="0.5" max="1.5" step="0.1" value="${localTheme.zoomLevel || 1}" style="flex:1;" oninput="updateProfileZoom(this.value)">
                        <button class="btn-secondary btn-sm" onclick="adjustProfileZoom(0.1)"><i class="fas fa-plus"></i></button>
                        <button class="btn-secondary btn-sm" onclick="resetProfileZoom()" title="Reset"><i class="fas fa-undo"></i></button>
                    </div>
                </div>

                <div class="card" style="margin-bottom:15px;">
                    <h4 style="margin-top:0;"><i class="fas fa-cloud-download-alt"></i> System Update</h4>
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <div style="font-size:0.8rem; color:var(--text-muted);">Current Version</div>
                            <div style="font-weight:bold;">v${window.APP_VERSION || 'Unknown'}</div>
                        </div>
                        <button id="btnProfileCheckUpdate" class="btn-secondary btn-sm" onclick="triggerProfileUpdateCheck()">Check for Updates</button>
                    </div>
                </div>

                <div class="card">
                    <h4 style="margin-top:0;"><i class="fas fa-key"></i> Security</h4>
                    <label style="font-size:0.8rem;">Change Password</label>
                    <div style="display:flex; gap:10px;">
                        <input type="password" id="profNewPass" placeholder="New Password" style="margin:0; flex:1;">
                        <button class="btn-warning btn-sm" onclick="saveProfilePassword()">Update</button>
                    </div>
                </div>

                <div style="text-align:right; margin-top:20px; border-top:1px solid var(--border-color); padding-top:15px;">
                    <button class="btn-secondary" onclick="document.getElementById('profileSettingsModal').remove()" style="margin-right:10px;">Close</button>
                    <button class="btn-primary" onclick="saveProfileSettings()">Save Changes</button>
                    <button class="btn-danger btn-sm" onclick="logout()" style="float:left;"><i class="fas fa-sign-out-alt"></i> Log Out</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
};

window.triggerProfileUpdateCheck = function() {
    if (typeof require !== 'undefined') {
        const { ipcRenderer } = require('electron');
        const btn = document.getElementById('btnProfileCheckUpdate');
        if(btn) {
            btn.innerText = "Checking...";
            btn.disabled = true;
        }
        ipcRenderer.send('manual-update-check');
        // Reset if no response (timeout fallback)
        setTimeout(() => {
            if(btn && btn.disabled) { btn.innerText = "Check for Updates"; btn.disabled = false; }
        }, 5000);
    } else {
        alert("Updates are managed by the browser in web mode.");
    }
};

window.updateProfileZoom = function(val) {
    const v = parseFloat(val);
    const disp = document.getElementById('profZoomDisplay');
    if(disp) disp.innerText = Math.round(v * 100) + '%';
    if (typeof require !== 'undefined') {
        try { require('electron').webFrame.setZoomFactor(v); } catch(e) {}
    } else {
        document.body.style.zoom = v;
    }
};

window.adjustProfileZoom = function(delta) {
    const input = document.getElementById('profZoom');
    if(input) {
        let newVal = Math.round((parseFloat(input.value) + delta) * 10) / 10;
        newVal = Math.max(0.5, Math.min(1.5, newVal));
        input.value = newVal;
        updateProfileZoom(newVal);
    }
};

window.resetProfileZoom = function() {
    const input = document.getElementById('profZoom');
    if(input) {
        input.value = 1;
        updateProfileZoom(1);
    }
};

window.saveProfileSettings = function() {
    try {
        const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
        const getChecked = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };

        const themeConfig = {
            primaryColor: getVal('profThemeColor') || '#F37021',
            showRing: getChecked('profShowRing'),
            profileRingColor: getVal('profRingColor') || '#F37021',
            wallpaper: getVal('profWallpaper') || '',
            zoomLevel: parseFloat(getVal('profZoom') || 1)
        };
        
        localStorage.setItem('local_theme_config', JSON.stringify(themeConfig));
        
        if (typeof applyUserTheme === 'function') applyUserTheme();
        
        // Force refresh footer avatar
        if (typeof CURRENT_USER !== 'undefined' && document.getElementById('user-footer')) {
             // Trigger a re-render of the footer content if possible, or reload page
             // Simple reload is safest to apply all theme changes cleanly
             if(confirm("Settings saved. Reload to apply changes fully?")) location.reload();
        } else {
             if(typeof showToast === 'function') showToast("Settings Saved!", "success");
             document.getElementById('profileSettingsModal').remove();
        }
    } catch(e) {
        alert("Error saving settings: " + e.message);
    }
};

window.saveProfilePassword = async function() {
    const newPass = document.getElementById('profNewPass').value;
    if(!newPass) return alert("Please enter a new password.");
    
    if(!confirm("Are you sure you want to change your password?")) return;
    
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const idx = users.findIndex(u => u.user === CURRENT_USER.user);
    
    if(idx > -1) {
        let finalPass = newPass;
        if (typeof hashPassword === 'function') {
            finalPass = await hashPassword(newPass);
        }
        
        users[idx].pass = finalPass;
        localStorage.setItem('users', JSON.stringify(users));
        
        // Update current session
        CURRENT_USER.pass = finalPass;
        sessionStorage.setItem('currentUser', JSON.stringify(CURRENT_USER));
        
        // Sync
        if(typeof secureAuthSave === 'function') await secureAuthSave();
        else if(typeof saveToServer === 'function') await saveToServer(['users'], false);
        
        alert("Password updated successfully.");
        document.getElementById('profNewPass').value = '';
    } else {
        alert("Error: User record not found.");
    }
};